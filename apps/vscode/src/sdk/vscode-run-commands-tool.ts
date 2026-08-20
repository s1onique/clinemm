/**
 * Custom `run_commands` tool that replaces the SDK's built-in version.
 *
 * This is an IDE-level feature built on top of the SDK, NOT part of the SDK.
 * It supports two execution modes, switchable dynamically per invocation:
 *
 *   - **Foreground (vscodeTerminal):** Uses VscodeTerminalManager for visible
 *     VS Code terminals with shell integration.
 *
 *   - **Background (backgroundExec):** Host-owned supervised execution via
 *     the `CommandJobManager`. The wait budget (how long the tool waits
 *     before returning control to the model) is decoupled from the
 *     execution deadline (how long the host keeps the command alive).
 *     Long-running work stays alive past the wait budget and is queried
 *     via the `command_status` tool. See command-job-manager.ts.
 */

import {
	CommandExitError,
	createShellTool,
	MAX_COMMAND_OUTPUT_CHARS,
	type ShellExecutor,
	type StructuredCommandInput,
	truncateCommandOutput,
} from "@cline/core"
import type { AgentTool } from "@cline/shared"
import { TerminalUserInterventionAction, telemetryService } from "@services/telemetry"
import { ClineTempManager } from "@services/temp"
import * as fs from "fs"
import { StateManager } from "@/core/storage/StateManager"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { MAX_UNRETRIEVED_LINES } from "@/integrations/terminal/constants"
import {
	getUnobservedTerminalCommandDisposition,
	type ITerminalProcess,
	type TerminalCompletionDetails,
} from "@/integrations/terminal/types"
import { Logger } from "@/shared/services/Logger"
import { getShellForProfile } from "@/utils/shell"
import {
	CommandJobManager,
	DEFAULT_EXECUTION_DEADLINE_MS,
	DEFAULT_WAIT_BUDGET_MS,
	MAX_RESPONSE_OUTPUT_CHARS,
} from "./command-job-manager"
import type { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShellCommand = string | StructuredCommandInput
type VscodeTerminalExecutionMode = "vscodeTerminal" | "backgroundExec"

/** Foreground VS Code terminals cannot be forcibly terminated; give long-running commands room to finish. */
export const VSCODE_FOREGROUND_RUN_COMMANDS_TIMEOUT_MS = 60 * 60 * 1000

/** Release the agent turn if a foreground command is still running after 300 seconds. */
export const FOREGROUND_COMMAND_AUTO_PROCEED_MS = 300 * 1000

/**
 * Cap on the "Proceed While Running" log file. A detached devserver can log
 * for days; once the cap is hit we stop appending and note the truncation.
 * ClineTempManager's periodic cleanup (age + total-size caps) is the backstop
 * for the files themselves.
 */
export const PROCEED_LOG_MAX_BYTES = 10 * 1024 * 1024
const PROCEED_LOG_FINAL_MESSAGE_MAX_CHARS = 4096

/** Options for creating the VSCode run_commands tool. */
export interface VscodeRunCommandsToolOptions {
	/** Workspace root directory. */
	cwd: string
	/** Lazy factory for the VscodeTerminalManager. Called once on first foreground use. */
	getTerminalManager: () => VscodeTerminalManager
	/** Timeout passed to the SDK shell tool wrapper and timeout telemetry. */
	bashTimeoutMs?: number
	/** Terminal execution mode captured when this session's tool set is built. */
	vscodeTerminalExecutionMode?: VscodeTerminalExecutionMode
	/**
	 * Registry of in-flight foreground executions, owned by SdkController.
	 * When provided, each foreground command can be detached via the
	 * "Proceed While Running" button. Foreground-only: background (SDK
	 * child_process) executions cannot be detached — their abort signal
	 * kills the process tree.
	 */
	foregroundCommands?: SdkForegroundCommandCoordinator
	/**
	 * Host-owned command-job manager (only used by the background path).
	 * Required when `vscodeTerminalExecutionMode === "backgroundExec"` —
	 * it owns execution lifetime, separates the wait budget from the
	 * execution deadline, and exposes a stable job id.
	 */
	commandJobManager?: CommandJobManager
	/** Wait budget for the background path. Defaults to DEFAULT_WAIT_BUDGET_MS. */
	backgroundWaitBudgetMs?: number
	/** Execution deadline for the background path. Defaults to DEFAULT_EXECUTION_DEADLINE_MS. */
	backgroundExecutionDeadlineMs?: number
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: lifecycle callback for the
	 * background execution path. Fires when the tool returns RUNNING
	 * (with the active jobId) and again when the command reaches a terminal
	 * state on the same call (with undefined). The host owns this seam —
	 * the projection is wired here so the webview's TaskHeader and
	 * Cancel button can arbitrate the in-flight background command.
	 */
	onBackgroundStateChange?: (running: boolean, jobId: string | undefined) => void
}

// ---------------------------------------------------------------------------
// Foreground execution — VscodeTerminalManager
// ---------------------------------------------------------------------------

function quoteShellArg(arg: string): string {
	if (arg.length === 0) {
		return "''"
	}
	if (!/[\s"'\\$`!&|;<>(){}[\]*?~]/.test(arg)) {
		return arg
	}
	return `'${arg.replace(/'/g, `'\\''`)}'`
}

export function formatCommandForTerminal(command: ShellCommand): string {
	if (typeof command === "string") {
		return command
	}
	if (!("args" in command)) {
		return command.command
	}
	return [command.command, ...(command.args ?? [])].map(quoteShellArg).join(" ")
}

/**
 * Stream the rest of a detached command's output to a log file: write the
 * lines buffered so far, then append each further 'line' event until
 * 'completed'. The write volume is capped at PROCEED_LOG_MAX_BYTES; the
 * stream is closed when the command completes or its process/acquisition
 * fails. Completion covers command end, Ctrl+C, terminal close, and the
 * markerless fallback.
 */
interface DetachedCommandLog {
	path: string
	attach(process: ITerminalProcess): void
	fail(error: unknown): void
}

function createDetachedCommandLog(terminalCommand: string, existingLines: string[]): DetachedCommandLog {
	const logFilePath = ClineTempManager.createTempFilePath("proceed-while-running")
	const stream = fs.createWriteStream(logFilePath, { flags: "a" })
	const sizeCapMessage = `[Log size cap of ${PROCEED_LOG_MAX_BYTES} bytes reached; further output is not logged.]`
	stream.on("error", (error) => {
		Logger.error(`[VscodeRunCommands] Failed writing proceed-while-running log ${logFilePath}:`, error)
	})

	let bytesWritten = 0
	const tryWriteLine = (line: string): boolean => {
		const chunk = `${line}\n`
		const chunkBytes = Buffer.byteLength(chunk)
		if (bytesWritten + chunkBytes > PROCEED_LOG_MAX_BYTES) {
			return false
		}
		bytesWritten += chunkBytes
		stream.write(chunk)
		return true
	}

	let sizeCapReached = !tryWriteLine(`[Running command: ${terminalCommand}]`)
	for (const line of existingLines) {
		if (!tryWriteLine(line)) {
			sizeCapReached = true
			break
		}
	}

	let settled = false
	let removeAttachedListeners = (): void => {}
	const end = (message: string): void => {
		if (settled) {
			return
		}
		settled = true
		removeAttachedListeners()
		// Output obeys the strict cap, but reserve a small bounded allowance for
		// the terminal status so a full log never hides completion or failure.
		stream.write(`${message.slice(0, PROCEED_LOG_FINAL_MESSAGE_MAX_CHARS)}\n`)
		stream.end()
	}

	return {
		path: logFilePath,
		attach: (process) => {
			const onLine = (line: string): void => {
				// Check the cap before writing: a single huge line (e.g. a dumped
				// binary blob or minified bundle) must not blow past the cap.
				if (!tryWriteLine(line)) {
					tryWriteLine(sizeCapMessage)
					process.removeListener("line", onLine)
				}
			}
			const onCompleted = (details?: TerminalCompletionDetails): void => {
				const exitCode = details?.exitCode
				end(
					details?.terminalClosed
						? "[Terminal closed while the command was running; output may be incomplete]"
						: details?.unobservedCommand
							? "[Command completion could not be observed; the command may still be running]"
							: exitCode !== undefined && exitCode !== null
								? `[Command completed with exit code ${exitCode}]`
								: "[Command completed]",
				)
			}
			const onError = (error: Error): void => end(`[Command failed after detaching: ${error.message}]`)
			removeAttachedListeners = () => {
				process.removeListener("line", onLine)
				process.removeListener("completed", onCompleted)
				process.removeListener("error", onError)
			}
			if (sizeCapReached) {
				tryWriteLine(sizeCapMessage)
			} else {
				process.on("line", onLine)
			}
			process.once("completed", onCompleted)
			process.once("error", onError)
		},
		fail: (error) => {
			const message = error instanceof Error ? error.message : String(error)
			end(`[Command failed before log capture completed: ${message}]`)
		},
	}
}

type DetachReason = "user" | "timeout"

function formatDetachedResult(logFilePath: string, output: string, reason: DetachReason): string {
	return [
		reason === "user"
			? "The user chose to proceed while the command is starting or still running in their terminal."
			: `The command was still starting or running after ${FOREGROUND_COMMAND_AUTO_PROCEED_MS / 1000} seconds, so Cline automatically proceeded while leaving it running in the terminal.`,
		`This is partial output; further output is being redirected to this file, which you can read to check progress: ${logFilePath}`,
		output.length > 0 ? `Output so far:\n${output}` : "No output so far.",
	].join("\n")
}

type PreStartControl = "detach" | "abort"

/** Exported for direct unit testing of the CommandExitError/terminalClosed mapping. */
export async function executeForeground(
	command: ShellCommand,
	cwd: string,
	terminalManager: VscodeTerminalManager,
	maxOutputChars: number,
	abortSignal?: AbortSignal,
	foregroundCommands?: SdkForegroundCommandCoordinator,
	terminalProfileId?: string,
): Promise<string> {
	const terminalCommand = formatCommandForTerminal(command)

	// "Proceed While Running": register a per-invocation handle so the user can
	// detach this command. If they do not act, automatically detach after 300
	// seconds so a long-running command cannot block the agent turn indefinitely.
	// Detaching redirects the remaining output to a log file and resolves the
	// awaited promise; the command keeps running in the user's terminal (and the
	// terminal stays busy until it completes).
	//
	// Registered BEFORE terminal acquisition so every command in a parallel
	// run_commands batch is registered before the user can click the button.
	// A command still awaiting its terminal when the user detaches records the
	// request and applies it the moment its process starts — otherwise that
	// late command would re-block the turn the button just released.
	const state: { phase: "waiting" | "started" | "detached" | "aborted" } = { phase: "waiting" }
	let detachedLog: DetachedCommandLog | undefined
	let detachReason: DetachReason | undefined
	let applyDetach: ((reason: DetachReason) => void) | undefined
	let resolvePreStartControl!: (control: PreStartControl) => void
	const preStartControl = new Promise<PreStartControl>((resolve) => {
		resolvePreStartControl = resolve
	})
	const requestDetach = (reason: DetachReason): void => {
		if (state.phase === "waiting") {
			state.phase = "detached"
			detachReason = reason
			detachedLog = createDetachedCommandLog(terminalCommand, [])
			if (reason === "user") {
				telemetryService.captureTerminalUserIntervention(TerminalUserInterventionAction.PROCESS_WHILE_RUNNING, "vscode")
			}
			resolvePreStartControl("detach")
		} else if (state.phase === "started") {
			applyDetach?.(reason)
		}
	}
	const unregister = foregroundCommands?.register({
		detach: () => requestDetach("user"),
	})
	const autoProceedTimer = setTimeout(() => requestDetach("timeout"), FOREGROUND_COMMAND_AUTO_PROCEED_MS)
	const onAbort = (): void => {
		if (state.phase === "waiting") {
			state.phase = "aborted"
			resolvePreStartControl("abort")
		} else if (state.phase === "started") {
			applyAbort?.()
		}
	}
	let applyAbort: (() => void) | undefined
	abortSignal?.addEventListener("abort", onAbort, { once: true })
	if (abortSignal?.aborted) {
		onAbort()
	}

	try {
		const terminalPromise = terminalManager.getOrCreateTerminal(cwd, terminalProfileId)
		const startDetached = (terminalInfo: Awaited<typeof terminalPromise>, log: DetachedCommandLog): void => {
			try {
				const process = terminalManager.runCommand(terminalInfo, terminalCommand)
				log.attach(process)
				void process.catch((error) => log.fail(error))
				process.detach()
			} catch (error) {
				log.fail(error)
			}
		}
		const acquisition = terminalPromise.then(
			(terminalInfo) => ({ type: "terminal" as const, terminalInfo }),
			(error: unknown) => ({ type: "error" as const, error }),
		)
		const finishDetachedAcquisition = (outcome: Awaited<typeof acquisition>, log: DetachedCommandLog): void => {
			if (outcome.type === "terminal") {
				startDetached(outcome.terminalInfo, log)
			} else {
				log.fail(outcome.error)
			}
		}
		const finishAbortedAcquisition = (outcome: Awaited<typeof acquisition>): void => {
			if (outcome.type === "terminal") {
				terminalManager.releaseTerminalReservation(outcome.terminalInfo)
			}
		}
		const firstOutcome = await Promise.race([
			acquisition,
			preStartControl.then((control) => ({ type: "control" as const, control })),
		])

		if (firstOutcome.type === "control") {
			if (firstOutcome.control === "abort") {
				// Acquisition is already in flight and may return a synchronously
				// reserved terminal after this tool result settles. Consume it so a
				// pre-start cancellation cannot leave that terminal permanently busy.
				void acquisition.then(finishAbortedAcquisition)
				throw new Error("Command execution aborted")
			}

			const log = detachedLog
			if (!log) {
				throw new Error("Detached command log was not initialized")
			}
			void acquisition.then((outcome) => finishDetachedAcquisition(outcome, log))
			return formatDetachedResult(log.path, "", detachReason ?? "timeout")
		}

		// Acquisition and a user action can resolve in the same microtask turn.
		// Re-check the invocation phase after the await so an already-queued
		// terminal outcome cannot overwrite a detach or abort that happened while
		// the promise continuation was pending.
		if (state.phase === "aborted") {
			finishAbortedAcquisition(firstOutcome)
			throw new Error("Command execution aborted")
		}
		if (state.phase === "detached") {
			const log = detachedLog
			if (!log) {
				throw new Error("Detached command log was not initialized")
			}
			finishDetachedAcquisition(firstOutcome, log)
			return formatDetachedResult(log.path, "", detachReason ?? "timeout")
		}
		if (firstOutcome.type === "error") {
			throw firstOutcome.error
		}

		state.phase = "started"
		const { terminalInfo } = firstOutcome

		const process = terminalManager.runCommand(terminalInfo, terminalCommand)
		const outputLines: string[] = []
		let droppedLines = 0

		// Accumulate output lines to return the full output once the command completes.
		// The chat shows command output at completion, not incrementally.
		//
		// This is a second buffer on top of the process's own `fullOutput` (capped at
		// MAX_FULL_OUTPUT_SIZE — see VscodeTerminalProcess), so it needs its own cap:
		// a long-running command emitting many lines must not accumulate them here
		// without bound. Once the cap is hit, keep only the head and tail — matching
		// truncateCommandOutput's own head/tail strategy below — since build/test
		// failures usually appear at the end of output.
		const maxBufferedLines = MAX_UNRETRIEVED_LINES
		const bufferLine = (line: string): void => {
			if (outputLines.length < maxBufferedLines) {
				outputLines.push(line)
			} else {
				outputLines.shift()
				outputLines.push(line)
				droppedLines++
			}
		}
		process.on("line", bufferLine)

		try {
			applyAbort = () => {
				// A cancelled task must actually stop the running command, not just
				// stop observing it. VS Code has no API to kill a terminal's
				// foreground process, so send Ctrl+C (SIGINT) before detaching our
				// listeners; continue() alone would leave the command running in the
				// user's terminal after cancellation.
				try {
					terminalManager.sendInterrupt(terminalInfo)
				} catch (error) {
					Logger.warn(
						`[VscodeRunCommands] Failed to interrupt command on cancellation: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
				}
				process.continue()
			}

			applyDetach = (reason) => {
				if (detachedLog !== undefined) {
					return
				}
				detachReason = reason
				detachedLog = createDetachedCommandLog(terminalCommand, outputLines)
				detachedLog.attach(process)
				if (reason === "user") {
					telemetryService.captureTerminalUserIntervention(
						TerminalUserInterventionAction.PROCESS_WHILE_RUNNING,
						"vscode",
					)
				}
				// detach() flushes any partial line (reaching both bufferLine and
				// the log) before resolving the awaited promise. After that the
				// partial output is final: stop buffering so the remaining
				// (log-only) output doesn't mutate outputLines while it's read.
				process.detach()
				process.removeListener("line", bufferLine)
			}

			// Wait for completion (or detach, which also resolves the promise)
			await process

			if (abortSignal?.aborted) {
				throw new Error("Command execution aborted")
			}

			const bufferedOutput =
				droppedLines > 0
					? [...outputLines, `\n... (${droppedLines} earlier lines dropped) ...\n`].join("\n")
					: outputLines.join("\n")
			const output = truncateCommandOutput(bufferedOutput.trim(), {
				maxChars: maxOutputChars,
			})

			if (detachedLog !== undefined) {
				return formatDetachedResult(detachedLog.path, output, detachReason ?? "timeout")
			}

			const completionDetails = process.getCompletionDetails?.()

			// A terminal closed mid-command has no exit code and no reliable output —
			// whatever the command was doing (e.g. running a test suite) was interrupted,
			// so this must never look like success to the agent.
			if (completionDetails?.terminalClosed) {
				const result =
					output.length > 0
						? `[Terminal closed while the command was running; output may be incomplete]\n${output}`
						: "[Terminal closed while the command was running; no output was captured]"
				throw new CommandExitError(1, result)
			}

			if (completionDetails?.unobservedCommand) {
				const disposition = getUnobservedTerminalCommandDisposition(completionDetails.unobservedCommand)
				const lifecycle =
					disposition === "disposeBeforeNextTerminalAcquisition"
						? "The terminal remains open for now, but starting another foreground command will attempt to close it, stopping the command if it is still running."
						: "The terminal has been left open and will not be closed automatically."
				const result =
					output.length > 0
						? `[Command completion could not be observed; the command may still be running and must not be assumed to have succeeded. ${lifecycle}]\n${output}`
						: `[Command completion could not be observed; the command may still be running and must not be assumed to have succeeded. ${lifecycle}]`
				throw new CommandExitError(1, result)
			}

			// Plumb the exit code from onDidEndTerminalShellExecution through to the tool
			// result. When shell integration reports a non-zero exit code, throw
			// CommandExitError so the SDK's shell tool wrapper marks the result as
			// `success: false` and includes the exit code in the error message —
			// matching the background (child_process) executor's behavior.
			// If no exit code was captured after an observed completion, return the
			// output as-is. Unobserved completion is handled explicitly above.
			const exitCode = completionDetails?.exitCode
			if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
				const result =
					output.length > 0
						? `[Command exited with code ${exitCode}]\n${output}`
						: `[Command exited with code ${exitCode}]`
				throw new CommandExitError(exitCode, result)
			}

			return output
		} finally {
			process.removeListener("line", bufferLine)
		}
	} finally {
		clearTimeout(autoProceedTimer)
		abortSignal?.removeEventListener("abort", onAbort)
		unregister?.()
	}
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * The shell selected by the user's terminal profile setting at one moment:
 * the profile ID for foreground terminal creation and the shell executable
 * it resolves to for background spawning and description building.
 */
interface ShellSnapshot {
	profileId: string
	shell: string
}

/** Resolves the shell the user's terminal profile setting selects right now. */
function takeShellSnapshot(): ShellSnapshot {
	// The setting is typed string, but guard empty values the same way the
	// settings handlers do (they skip persisting "" but older stores may hold one).
	const profileId = StateManager.get().getGlobalSettingsKey("defaultTerminalProfile") || "default"
	return { profileId, shell: getShellForProfile(profileId) }
}

/**
 * Creates the custom `run_commands` tool for the VSCode extension.
 *
 * This tool suppresses and replaces the SDK's built-in `run_commands` tool.
 * The terminal execution mode is captured when the session's tool set is
 * built; switching modes rebuilds the active SDK session so the tool timeout
 * and execution path follow it.
 *
 * The shell is snapshotted each time the runtime reads the tool description,
 * which happens when a model request is built. Tool calls produced by that
 * request execute with the same snapshot, so changing the terminal profile
 * while the model is generating does not change the shell under commands the
 * model has already planned: the new shell is named in the next request (the
 * one carrying these tool results) and used by the commands it produces.
 */
export function createVscodeRunCommandsTool(options: VscodeRunCommandsToolOptions): AgentTool {
	const state = { snapshot: takeShellSnapshot() }
	return createShellTool(createVscodeShellExecutor(options, state), {
		cwd: options.cwd,
		bashTimeoutMs: options.bashTimeoutMs,
		shell: () => {
			state.snapshot = takeShellSnapshot()
			return state.snapshot.shell
		},
	})
}

function createVscodeShellExecutor(options: VscodeRunCommandsToolOptions, state: { snapshot: ShellSnapshot }): ShellExecutor {
	const { cwd, getTerminalManager } = options
	const executionMode = options.vscodeTerminalExecutionMode ?? "vscodeTerminal"

	// Lazy-init terminal manager reference
	let terminalManager: VscodeTerminalManager | undefined

	return async (command, commandCwd, context): Promise<string> => {
		Logger.log(`[VscodeRunCommands] Executing command in ${executionMode} mode`)

		// Execute with the shell named in the model request that produced this
		// tool call, not the setting's current value (see createVscodeRunCommandsTool).
		const { profileId, shell } = state.snapshot

		if (executionMode === "backgroundExec") {
			// Background path — host-owned supervised execution.
			//
			// WAIT_BUDGET_MS (default 15s) controls how long this tool
			// invocation waits before returning control to the model.
			// Expiry does NOT terminate the process — the tool returns
			// RUNNING + jobId.
			//
			// EXECUTION_DEADLINE_MS (default 10 min) is the host-owned
			// maximum lifetime. Expiry terminates the owned process tree
			// and records DEADLINE_EXCEEDED. The model may follow up via
			// the `command_status` tool.
			//
			// The job manager is required for this path; if the host did
			// not provide one, we fail loudly (this branch is gated by the
			// builder that supplies the manager).
			const manager = options.commandJobManager
			if (!manager) {
				throw new Error("[VscodeRunCommands] backgroundExec mode requires commandJobManager")
			}
			const waitBudgetMs = options.backgroundWaitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS
			const executionDeadlineMs = options.backgroundExecutionDeadlineMs ?? DEFAULT_EXECUTION_DEADLINE_MS
			// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: lifecycle callback. Fires
			// once when the tool returns RUNNING (with the active jobId) and
			// once when the command reaches a terminal state on the same call
			// (with undefined). The host owns the projection — the projection
			// is dead state until this fires.
			const notifyBackgroundStateChange = (running: boolean, jobId: string | undefined): void => {
				try {
					options.onBackgroundStateChange?.(running, jobId)
				} catch (error) {
					Logger.warn(
						`[VscodeRunCommands] onBackgroundStateChange callback threw (running=${running}, jobId=${jobId}): ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
				}
			}

			try {
				const start = await manager.start(
					{
						command,
						cwd: commandCwd || cwd,
						shell,
						// Set SHELL env to match the shell we're spawning so
						// child processes see the correct value instead of
						// the inherited parent's.
						env: { SHELL: shell },
						waitBudgetMs,
						executionDeadlineMs,
						maxOutputChars: MAX_RESPONSE_OUTPUT_CHARS,
					},
					context,
				)
				telemetryService.captureTerminalExecution(true, "vscode", "child_process", {
					...(start.exitCode !== undefined ? { exitCode: start.exitCode } : {}),
					terminalExecutionMode: "backgroundExec",
				})
				// Combine stderr into stdout for the model-facing terminal
				// result so diagnostics written to stderr are not silently
				// lost. Mirrors the bash executor's combineOutput behavior.
				const combinedOutput = start.stderr.length > 0 ? `${start.stdout}\n[stderr]\n${start.stderr}` : start.stdout
				// RUNNING returns a structured snapshot so the model can
				// observe status + jobId. Terminal results retain the
				// existing stdout/exitCode shape for backward compatibility.
				if (start.state === "running") {
					// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: the projection
					// flips to true here — the host owns an in-flight
					// background command. The webview's TaskHeader can show
					// "Working" and the Cancel button can route the cancel.
					notifyBackgroundStateChange(true, start.jobId)
					// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: attach an async
					// listener so the projection flips back to false when the
					// process completes asynchronously (after this tool call
					// returns). Without this listener, the projection would
					// stay true forever — the in-tool callback chain closes
					// the moment the tool returns RUNNING, and the
					// `command_status`/`cancel_command` paths are
					// observation-only / mutating, not state-broadcasters.
					// The terminalPromise is derived from the manager's
					// `exitTransitions` map — it never rejects, so a
					// no-arg `.then()` is safe.
					start.terminalPromise.then(() => {
						notifyBackgroundStateChange(false, undefined)
					})
					const runningPayload = {
						status: "running" as const,
						jobId: start.jobId,
						elapsedMs: start.elapsedMs,
						deadlineRemainingMs: start.deadlineRemainingMs,
						outputTruncated: start.outputTruncated,
						stdout: start.stdout,
					}
					return JSON.stringify(runningPayload)
				}
				// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: terminal path —
				// the command completed before the wait budget expired.
				// The projection resets to false; the taskId is cleared
				// so the next start can re-populate it.
				notifyBackgroundStateChange(false, undefined)
				// Terminal path. Preserve existing CommandExitError so the
				// SDK wrapper records the existing telemetry; for success,
				// return stdout as before.
				if (start.state === "exited" && start.exitCode === 0) {
					return combinedOutput
				}
				if (start.state === "deadline_exceeded") {
					const text =
						combinedOutput.length > 0
							? `[Command exceeded the host execution deadline]\n${combinedOutput}`
							: `[Command exceeded the host execution deadline]`
					throw new CommandExitError(start.exitCode ?? 1, text)
				}
				if (start.state === "cancelled") {
					const text =
						combinedOutput.length > 0 ? `[Command was cancelled]\n${combinedOutput}` : `[Command was cancelled]`
					throw new CommandExitError(start.exitCode ?? 1, text)
				}
				if (start.state === "spawn_failed") {
					throw new Error(start.signal ?? "Command failed to spawn")
				}
				// exited with non-zero — preserve CommandExitError shape.
				throw new CommandExitError(
					start.exitCode ?? 1,
					combinedOutput.length > 0
						? `[Command exited with code ${start.exitCode ?? 1}]\n${combinedOutput}`
						: `[Command exited with code ${start.exitCode ?? 1}]`,
				)
			} catch (error) {
				// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: on any thrown error
				// (CommandExitError, spawn_failed, etc.) the background
				// command is no longer in-flight. Reset the projection so the
				// host's TaskHeader / Cancel button reflect the true terminal
				// state. The RUNNING branch above already notified true+jobId,
				// so the caller can see the projection flip true→false on
				// failure without a separate start-side hook.
				notifyBackgroundStateChange(false, undefined)
				telemetryService.captureTerminalExecution(false, "vscode", "child_process", {
					...(error instanceof CommandExitError && { exitCode: error.exitCode }),
					terminalExecutionMode: "backgroundExec",
				})
				throw error
			}
		}

		// Foreground path — use VscodeTerminalManager
		if (!terminalManager) {
			terminalManager = getTerminalManager()
		}
		return await executeForeground(
			command,
			commandCwd || cwd,
			terminalManager,
			MAX_COMMAND_OUTPUT_CHARS,
			context.signal,
			options.foregroundCommands,
			profileId,
		)
	}
}
