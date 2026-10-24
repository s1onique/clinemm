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
import { captureBackgroundJobLivenessAuthorityRecord, getDiagnosticManagerId } from "./background-job-liveness-authority"
import {
	CommandJobManager,
	type CommandJobState,
	DEFAULT_EXECUTION_DEADLINE_MS,
	DEFAULT_WAIT_BUDGET_MS,
	MAX_RESPONSE_OUTPUT_CHARS,
} from "./command-job-manager"
import { triggerExtensionHostAllocationProfilerOnFirstQualifyingJob } from "./extension-host-allocation-profiler"
import { triggerExtensionHostCpuProfilerOnFirstQualifyingJob } from "./extension-host-cpu-profiler"
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

/**
 * ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
 * (CORR-POST-START-FAILURE-01): bounded wait for the
 * supervised-lifecycle settlement of a just-started job that
 * the host is about to cancel due to a post-launch admission
 * failure. The cap is intentionally small (5 seconds per
 * stage) so the fail-closed path does not block the tool
 * response indefinitely on an unkillable process; the
 * manager's own deadline watchdog remains the authoritative
 * termination guarantor after this wait elapses.
 *
 * ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
 * (CORR-POST-START-TIMEOUT-01): the cap is a CAP ON THE
 * TOOL'S WAIT, not on the supervised job. A timer that fires
 * is NOT a verified terminal settlement. The post-launch
 * failure containment distinguishes three outcomes and only
 * releases the reservation slot on a verified `terminal`
 * settlement; a `timeout` (or a `cancel_error`) leaves the
 * permit held and reports a "containment pending" error so
 * the host can decide whether to wait for the manager's own
 * deadline watchdog (the real authoritative termination
 * guarantor after this cap elapses). The conserved permit
 * keeps the admission slot occupied, so a fresh
 * observation-bearing launch is refused at the BCB's capacity
 * check (see POST-START-TIMEOUT-01 INVARIANT 5); the host
 * CANNOT admit another job while the supervised one is
 * still unowned. The slot is released only by the auto-
 * release hook (CORR-POST-START-LATE-TERMINAL-01) when the
 * manager's deadline watchdog reaches terminality, or by
 * coordinator disposal.
 *
 * The cancel and the settle race each get this cap (so the
 * total bounded wait is ~2x the cap). The cancel cap is
 * intentionally larger than the manager's TERM_GRACE_MS
 * (5000ms; see command-job-manager.ts:878) so the production
 * happy path (where the cancel waits for the process death)
 * has enough headroom. The settle cap is the original 5s
 * (the post-cancel wait for the terminalPromise to resolve).
 */
const POST_LAUNCH_FAIL_CLOSED_CANCEL_TIMEOUT_MS = 10_000
const POST_LAUNCH_FAIL_CLOSED_SETTLE_TIMEOUT_MS = 5_000

/**
 * ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
 * (CORR-POST-START-TIMEOUT-01): discriminated outcome of the
 * post-launch failure containment. The single critical
 * invariant is
 *
 *   Timeout ≠ terminal_observed ≠ cancel_error
 *
 * - `terminal_observed`  : the supervised job's `terminalPromise`
 *                          resolved before the bounded wait
 *                          elapsed. The permit MAY be released.
 * - `timeout`            : the bounded wait elapsed WITHOUT a
 *                          terminal settlement. The permit MUST
 *                          stay held; the supervised job may
 *                          still be running.
 * - `cancel_error`       : `manager.cancel(...)` rejected (the
 *                          supervised lifecycle's termination
 *                          call itself failed). The permit MUST
 *                          stay held; the supervised job's
 *                          terminality is UNKNOWN.
 *
 * The 3 cases are not interchangeable. A timer that fires
 * tells the tool to stop waiting; it does NOT establish that
 * the supervised job has terminated.
 */
type PostLaunchSettlementOutcome =
	| { kind: "terminal_observed"; terminalTransition: { becameIdle: boolean; jobId: string; terminalState: string } }
	| { kind: "timeout" }
	| { kind: "cancel_error"; error: unknown }
	| { kind: "cancel_settled_ok" }

/**
 * ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
 * (CORR-POST-START-TIMEOUT-01): the post-launch failure
 * containment throws this error class so the outer
 * try/catch (which would otherwise release the permit
 * on any thrown error) can distinguish the fail-closed
 * throw from other launch-time throws.
 *
 * The `permitReleasedOnThrow` field carries the
 * permit-release decision made by the fail-closed path:
 *   - `true`  : the fail-closed path already released
 *               the permit (the `terminal_observed` happy
 *               path of the post-launch repair). The
 *               outer catch MUST NOT release again.
 *   - `false` : the fail-closed path conserved the
 *               permit (the `timeout` / `cancel_error`
 *               paths of the post-launch repair). The
 *               outer catch MUST NOT release (the permit
 *               stays held; the supervised job's
 *               terminality is UNKNOWN).
 *
 * Without this distinction, the outer catch's
 * `releaseReservation(permitId)` would silently
 * re-release a permit that the fail-closed path
 * deliberately conserved — restoring the original
 * P0 conservation gap (timeout ≠ terminal ≠
 * authorized release).
 */
class PostLaunchFailClosedError extends Error {
	readonly permitReleasedOnThrow: boolean
	constructor(message: string, permitReleasedOnThrow: boolean) {
		super(message)
		this.name = "PostLaunchFailClosedError"
		this.permitReleasedOnThrow = permitReleasedOnThrow
	}
}

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
	onBackgroundStateChange?: (
		running: boolean,
		jobId: string | undefined,
		/**
		 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
		 * (correction01): per-job terminal reason. Present ONLY
		 * when `running === false && jobId !== undefined`. The
		 * host-owned `CommandJobManager` is the authority for the
		 * value (one of `exited`/`cancelled`/`deadline_exceeded`/
		 * `spawn_failed`/`containment_failed`). The runner forwards
		 * it verbatim so the projection can render the exact
		 * terminal pill reason (Cancelled / Deadline exceeded /
		 * etc.) rather than collapsing everything to "Completed".
		 */
		terminalState?: Exclude<CommandJobState, "running">,
		/**
		 * ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01
		 * (RCNC02-05/06): the monotonicity evidence. When the
		 * bounded fix's `onRunningObserved(jobId)` callback (from
		 * `command-status-tool.ts:262-264`) fires, it passes
		 * `{ isLiveInManager: true }` so the controller can
		 * distinguish a STALE-by-causal-ordering direct
		 * invocation (no evidence — refuse to overwrite a terminal
		 * projection) from a NONTERMINAL observation that
		 * confirms the job is alive in the manager (reconcile a
		 * stale terminal projection back to `"running"`). The
		 * runner's start-side and terminal-side calls (this
		 * file's `notifyBackgroundStateChange`) leave
		 * `evidence` undefined: the start side writes a fresh
		 * jobId whose projection is `undefined`; the terminal
		 * side writes the per-job terminal reason (not a
		 * `running` write) and the guard below does not fire.
		 */
		evidence?: { isLiveInManager?: boolean },
		/**
		 * ACT-CLINEMM-P0-PREMATURE-HANDOFF-CONTAINMENT-FAILURE01
		 * (PHCF01 / PHCF17 -- OWNER ISOLATION): the LAUNCH-TIME
		 * OWNER SESSION ID of the job
		 * (`CommandJob.ownerSessionId`).
		 *
		 * The host's per-job terminal projection is
		 * CONTROLLER-LEVEL and session-LESS, so a containment
		 * failure recorded for a job owned by a PREVIOUS session
		 * would otherwise be indistinguishable from one owned by
		 * the active session. The owner id is the real job-owner
		 * identity and lets the host scope the projection by owner.
		 *
		 * Captured at LAUNCH time (not terminal time) so the owner
		 * reflects the session that launched the job even if the
		 * active session has since changed.
		 */
		ownerSessionId?: string,
	) => void
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01:
	 * coordinator-owned opt-in notify-on-terminal marker set.
	 * When supplied, the background path registers a marker on
	 * `start.state === "running" && notifyOnCompletion === true`
	 * and consumes the per-job terminal event after the tool
	 * returns. The coordinator owns the lifetime, hold/drain
	 * FIFO, and prompt-bounded wake. This option is OPTIONAL —
	 * production code MUST continue to work when it is omitted
	 * (notify=false is the default and produces zero state
	 * delta).
	 */
	backgroundNotifyCoordinator?: import("./background-notify-coordinator").BackgroundNotifyCoordinator
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01:
	 * resolve the active owner (sessionId, taskId) at marker
	 * registration time. Returned values must match the
	 * coordinator's owner-key invariants (sessionId + taskId;
	 * NO epoch). The tool calls this synchronously in the
	 * RUNNING branch BEFORE attaching the terminal listener so
	 * the marker is bound to the same owner the rest of the
	 * host sees.
	 */
	resolveActiveOwner?: () => { sessionId: string; taskId: string | undefined } | undefined
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
	 *
	 * OPTIONAL hook fired at the SAME seam as the marker registration
	 * below — i.e., when `start.state === "running" &&
	 * notifyOnCompletion === true` and the owner is resolvable. The
	 * hook receives the just-allocated `jobId` so the
	 * MessageTranslatorState (the turn-local ownership hint consulted by
	 * the C10 completion-result filter in
	 * `SdkSessionEventCoordinator`) can record which jobs were launched
	 * by THIS turn. The hook is OPTIONAL — production code MUST continue
	 * to work when it is omitted (the BCTPA-P7b RED witness then
	 * remains observable as a degraded mode, mirroring the
	 * `backgroundNotifyCoordinator` option's "fire-and-forget path with
	 * zero state delta" pattern).
	 */
	recordLaunchedBackgroundJob?: (jobId: string) => void
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
export function createVscodeRunCommandsTool(options: VscodeRunCommandsToolOptions): AgentTool<unknown, unknown> {
	const state = { snapshot: takeShellSnapshot() }
	const tool = createShellTool(createVscodeShellExecutor(options, state), {
		cwd: options.cwd,
		bashTimeoutMs: options.bashTimeoutMs,
		shell: () => {
			state.snapshot = takeShellSnapshot()
			return state.snapshot.shell
		},
	})
	// ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01: `createShellTool` now
	// returns `AgentTool<RunCommandsInput, ToolOperationResult[]>`. The
	// public surface here is intentionally `AgentTool<unknown, unknown>`
	// because the SDK runtime treats tool inputs as `unknown` at the
	// boundary. The narrow type is preserved on the runtime side via the
	// `validateInput` method that the canonical schema produces.
	return tool as AgentTool<unknown, unknown>
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
			// again when the command reaches a terminal state on the same call
			// (with undefined). The host owns the projection — the projection
			// is dead state until this fires.
			//
			// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
			// (correction01 / Factory
			// HALT_TERMINAL_CARD_MULTI_JOB_PROJECTION_FALSE_GREEN):
			// the terminal notification MUST carry the terminating
			// jobId (and the exact terminal reason) so the host
			// projection can flip a SINGLE job in a multi-job
			// session. The previous implementation fired
			// `(false, undefined)` ONLY on the >0->0 cardinal
			// transition, which silently left every other running
			// sibling in "running" state forever. The new contract:
			//   (true,  jobId)                → states[jobId] = "running"
			//   (false, jobId, terminalState) → states[jobId] = terminalState
			//                                    (e.g. "exited",
			//                                    "cancelled",
			//                                    "deadline_exceeded")
			// The aggregate >0->0 signal is derived by the host from
			// the count of "running" entries in the map; BTCONT is
			// gated on the derived scalar in the same way it was
			// gated on the >0->0 flip before.
			const notifyBackgroundStateChange = (
				running: boolean,
				jobId: string | undefined,
				terminalState?: Exclude<CommandJobState, "running">,
				ownerSessionId?: string,
			): void => {
				// ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01:
				// BJLA diagnostic — capture `background_state_change_published`
				// BEFORE invoking the host's projection callback. This is the
				// load-bearing T-projection timestamp for the LA3
				// discriminator (runner publishes `false` but UI projection
				// stays `true`). The manager-instance identity is the
				// correlation token for LA2 / LA5. No semantic delta when
				// capture is OFF.
				captureBackgroundJobLivenessAuthorityRecord({
					event: "background_state_change_published",
					capturedAt: Date.now(),
					managerInstance: getDiagnosticManagerId(manager),
					running,
					jobId: jobId ?? null,
				})
				try {
					options.onBackgroundStateChange?.(running, jobId, terminalState, undefined, ownerSessionId)
				} catch (error) {
					Logger.warn(
						`[VscodeRunCommands] onBackgroundStateChange callback threw (running=${running}, jobId=${jobId}, terminalState=${terminalState ?? "n/a"}): ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
				}
			}

			let start: Awaited<ReturnType<typeof manager.start>> | undefined
			// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION:
			// Reserve 1 observation-capacity slot BEFORE
			// `manager.start()` is called. The reservation is the
			// load-bearing seam: if the BCB cannot guarantee a
			// backing slot for the eventual obligation, the
			// command MUST NOT be launched (HTEC01 design
			// blocker / CORR04 documented this as the bounded
			// repair). The reservation is released on:
			//   - fast-path terminal in-band (no obligation)
			//   - launch failure (no job exists)
			//   - successful consumption (Path A/B/C/C')
			//   - coordinator disposal
			// The reservation is attached to the jobId on
			// `registerMarker` (notify=true) or
			// `recordNonNotifyTerminalObservation` (notify=false).
			// Fail-closed semantics: when the BCB or
			// `resolveActiveOwner` is missing in production, an
			// observation-bearing launch is refused (no
			// silent capacity bypass). See
			// `apps/vscode/src/sdk/background-notify-coordinator.ts`
			// for the synchronous, atomic-in-the-JS-event-loop
			// admission contract.
			const notifyRequested = context.metadata?.notifyOnCompletion === true
			let permitId: string | undefined
			const ownerResolution = options.resolveActiveOwner?.() ?? undefined
			const requiresObservationContract = true
			const admissionResult = requiresObservationContract
				? options.backgroundNotifyCoordinator?.tryReserveObservationCapacity({
						owner: ownerResolution,
					})
				: undefined
			if (
				requiresObservationContract &&
				notifyRequested &&
				(!options.backgroundNotifyCoordinator || !options.resolveActiveOwner || !ownerResolution)
			) {
				// Fail-closed: an observation-bearing launch
				// without the admission authority is a bypass.
				// This is the load-bearing invariant (ADM-21).
				throw new Error(
					"[Observation-capacity admission failed: a notify-enabled background command was attempted without the BCB admission authority. This is a fail-closed refusal, NOT a transient error; the host (SdkController) is expected to provide backgroundNotifyCoordinator + resolveActiveOwner in production.]",
				)
			}
			if (admissionResult?.kind === "at_capacity") {
				throw new Error(
					`[Observation-capacity admission refused: at_capacity (used=${admissionResult.capacity.used}/total=${admissionResult.capacity.total}). The runtime cannot guarantee a terminal-observation backing slot for a new background command. Existing obligations are preserved. Retry after the model observes one of the held terminal results via command_status.]`,
				)
			}
			if (admissionResult?.kind === "invalid_owner") {
				throw new Error(
					"[Observation-capacity admission refused: invalid_owner (no active session/task at launch). The host owns the disposition; this is a fail-closed refusal for an observation-bearing launch with no resolvable owner.]",
				)
			}
			if (admissionResult?.kind === "disposed") {
				throw new Error(
					"[Observation-capacity admission refused: disposed (the BCB has been disposed). The host must not admit new background commands after disposal.]",
				)
			}
			if (admissionResult?.kind === "reserved") {
				permitId = admissionResult.permitId
			}
			try {
				start = await manager.start(
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
				// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION:
				// fast-path terminal in-band: the command finished within
				// the wait budget, the model receives the terminal result
				// synchronously via `combinedOutput` / `CommandExitError`,
				// and NO observation obligation is created. Release the
				// pre-launch permit immediately so the slot is free for
				// the next admission. The fast-path case is the only case
				// where the permit is released WITHOUT creating a marker /
				// non-notify observation.
				if (start.state !== "running" && permitId !== undefined) {
					options.backgroundNotifyCoordinator?.releaseReservation(permitId)
					permitId = undefined
				}
				// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
				// (CORR-POST-START-FAILURE-01 + CORR-POST-START-TIMEOUT-01):
				// bounded post-launch failure containment. When a
				// post-launch admission step fails (attach /
				// register / record), the job has ALREADY been
				// started via `manager.start()` and is running.
				// The pre-fix code released the permit and threw,
				// leaving the job running unowned by the BCB. The
				// bounded repair:
				//
				//   1. Run two concurrent operations: the
				//      `manager.cancel(...)` call (which goes
				//      through the production termination path —
				//      SIGTERM -> escalate -> SIGKILL ->
				//      `terminalPromise` resolves) AND a bounded
				//      race between the supervised job's
				//      `terminalPromise` and a
				//      POST_LAUNCH_FAIL_CLOSED_SETTLE_TIMEOUT_MS
				//      timer.
				//   2. The settlement is observed by ONE of
				//      three outcomes:
				//        - `terminal_observed`: the supervised
				//          job's terminalPromise resolved; the
				//          permit MAY be released.
				//        - `timeout`: the bounded wait elapsed
				//          without observing terminality; the
				//          permit MUST stay held; the manager's
				//          own deadline watchdog is the
				//          authoritative termination guarantor.
				//        - `cancel_error`: the cancel call itself
				//          rejected; the supervised job's
				//          terminality is UNKNOWN; the permit
				//          MUST stay held.
				//   3. Release the permit ONLY on
				//      `terminal_observed`. The other two
				//      outcomes conserve the slot so a later
				//      admission cannot consume it. The host
				//      (SdkController) decides what to do next
				//      (cancel via a different channel, wait
				//      for the manager's deadline watchdog,
				//      etc.).
				//   4. Throw the fail-closed error. The error
				//      message identifies the phase, the detail,
				//      and the bounded-repair outcome so the
				//      host's diagnostic capture can attribute
				//      the failure correctly.
				//
				// This is the LOAD-BEARING repair for the
				// post-launch orphan hazard. It is applied at
				// all four post-launch failure sites (notify
				// attach, notify register, non-notify attach,
				// non-notify record). The helper is
				// `async () => Promise<never>` -- it always
				// throws, so TypeScript narrows the caller's
				// code after the `await` to unreachable (no
				// fallthrough to the downstream registration
				// / projection logic).
				//
				// Bind `start` to a narrowed local so the helper
				// closure sees a non-undefined type. The outer
				// `start` is declared as
				// `Awaited<...> | undefined` (line 761); after the
				// `await manager.start()` it is defined, but the
				// closure would not see that narrowing. `startedJob`
				// is the narrowed handle.
				const startedJob = start
				// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
				// (CORR-POST-START-TIMEOUT-01): the post-launch
				// failure containment is split into a settlement
				// step (run BEFORE `failClosedPostLaunch` is
				// invoked) and a reporting step. The settlement
				// step returns a `PostLaunchSettlementOutcome`
				// and the reporting step decides whether to
				// release the permit. Splitting the two ensures
				// the permit-release decision is gated on the
				// actual observed terminality, not on a timer.
				//
				// (CORR-POST-START-LATE-TERMINAL-01): a
				// LATE-arriving terminal settlement (after the
				// bounded wait elapses with `timeout` or after
				// a hung `cancel` produces `cancel_error`) MUST
				// release the permit exactly once. The helper
				// itself only knows the settlement observed
				// during the bounded wait; a settlement arriving
				// later must be handled by an exactly-once
				// cleanup hook attached to the supervised job's
				// `terminalPromise` BEFORE the helper engages.
				// The hook is installed unconditionally here
				// (regardless of which settlement branch wins)
				// because the supervisor's deadline watchdog
				// is the authoritative termination guarantor
				// and will reach terminality eventually. The
				// hook is fire-and-forget; the helper does NOT
				// await it (the helper returns immediately
				// after the bounded wait). Idempotency: the
				// BCB's `releaseReservation` returns `not_found`
				// for a re-release, so the hook is safe even
				// if it fires after the helper already released
				// the permit on the `terminal_observed` happy
				// path. Disposal: the hook handles
				// `{ kind: "disposed" }` gracefully (no-op).
				// Job identity: the hook validates
				// `transition.jobId === startedJob.jobId` to
				// guarantee it does not release another owner's
				// permit if the supervised job's terminal
				// transition is somehow for a different job
				// (defense in depth).
				//
				// The implementation runs two concurrent
				// operations:
				//
				//   1. `cancelTask` — calls `manager.cancel(...)`
				//      and writes the result to `cancelSettled`
				//      when it resolves OR rejects.
				//   2. `settleRace` — races the supervised job's
				//      `terminalPromise` against a bounded timer
				//      (POST_LAUNCH_FAIL_CLOSED_SETTLE_TIMEOUT_MS).
				//      On every outcome the timer is cleared so
				//      the Node timer queue does not retain a
				//      leaked handle past this scope.
				//
				// The two run concurrently; whichever settles
				// first determines the outcome. The
				// POST-START-TIMEOUT-02 test covers the case
				// where `cancelTask` itself never resolves: in
				// that case `settleRace` wins on the timer and
				// we report `timeout` (NOT a hung tool).
				//
				// Order of outcome precedence:
				//   terminal_observed > cancel_error > timeout
				// because `terminal_observed` is the only state
				// that authorizes a permit release; `cancel_error`
				// indicates the supervised-lifecycle call itself
				// failed; `timeout` indicates we lost the race
				// without seeing either terminality or a cancel
				// rejection.
				// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
				// (CORR-POST-START-TIMEOUT-01): the post-launch
				// failure containment is split into a settlement
				// step (run BEFORE `failClosedPostLaunch` is
				// invoked) and a reporting step. The settlement
				// step returns a `PostLaunchSettlementOutcome`
				// and the reporting step decides whether to
				// release the permit. Splitting the two ensures
				// the permit-release decision is gated on the
				// actual observed terminality, not on a timer.
				//
				// The implementation runs the cancel and the
				// settle race as TWO STAGES with INDEPENDENT
				// bounds:
				//
				//   Stage 1: cancel with bounded wait.
				//     `manager.cancel(...)` is awaited. The
				//     cancel itself is bounded by a timer
				//     (POST_LAUNCH_FAIL_CLOSED_SETTLE_TIMEOUT_MS)
				//     so a hung cancel does NOT block the tool.
				//     The cancel timer is cleared on every
				//     outcome (success, error, or timer fire).
				//
				//   Stage 2: settle race (post-cancel).
				//     AFTER the cancel settles "ok", the
				//     settle race begins. The settle race
				//     races the supervised job's
				//     `terminalPromise` against a bounded
				//     timer. The settle timer is cleared on
				//     every outcome.
				//
				// Total budget: ~2x the per-stage bound
				// (cancel-time + settle-time). For the
				// production happy path, the cancel settles
				// when the supervised process death
				// resolves the terminalPromise in the same
				// code path, and the settle race is
				// near-instant. For the unhappy paths, the
				// per-stage caps bound the tool's response
				// time.
				//
				// Order of outcome precedence:
				//   terminal_observed > cancel_error > timeout
				// because `terminal_observed` is the only
				// state that authorizes a permit release;
				// `cancel_error` indicates the supervised-
				// lifecycle call itself failed; `timeout`
				// indicates the settle race's bounded wait
				// elapsed without observing terminality.
				// `cancel_settled_ok` is the internal
				// sentinel that signals "stage 1 done, run
				// stage 2"; it is consumed by the outer
				// code and never reaches the reporter.
				const cancelSettled: { error: unknown; ok: boolean; timedOut: boolean } = {
					error: undefined,
					ok: false,
					timedOut: false,
				}
				// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
				// (CORR-POST-START-TIMEOUT-01): the settlement
				// step is LAZY — it is only computed when
				// `failClosedPostLaunch` is invoked (i.e. when
				// a post-launch admission step fails). On the
				// happy path, no cancel is issued and the
				// settle race is never run; the
				// `settlementOutcome` is undefined and the
				// marker registration proceeds immediately
				// after `manager.start()` returns. On the
				// post-launch failure path, the lazy function
				// is invoked, the cancel is issued, the settle
				// race is run, and the result is consumed by
				// the reporter.
				const computeSettlement = async (): Promise<PostLaunchSettlementOutcome> => {
					// Stage 1: cancel with a bounded wait. The
					// cancel timer is cleared on every outcome.
					const cancelSettle: PostLaunchSettlementOutcome = await (async () => {
						let cancelTimerHandle: ReturnType<typeof setTimeout> | undefined
						const cancelTimerPromise = new Promise<"timeout">((resolve) => {
							cancelTimerHandle = setTimeout(() => resolve("timeout"), POST_LAUNCH_FAIL_CLOSED_CANCEL_TIMEOUT_MS)
						})
						const cancelPromise = manager
							.cancel({
								jobId: startedJob.jobId,
								origin: "other:host_admission_failure",
							})
							.then(
								(): "ok" => {
									cancelSettled.ok = true
									return "ok"
								},
								(error): "error" => {
									cancelSettled.error = error
									return "error"
								},
							)
						const cancelOutcome = await Promise.race([cancelPromise, cancelTimerPromise])
						if (cancelTimerHandle !== undefined) {
							clearTimeout(cancelTimerHandle)
						}
						if (cancelOutcome === "timeout") {
							// The cancel itself hung. The
							// supervised job's terminality
							// is UNKNOWN. The permit MUST
							// stay held.
							cancelSettled.timedOut = true
							return {
								kind: "cancel_error",
								error: new Error(
									`manager.cancel() did not settle within the bounded wait (${POST_LAUNCH_FAIL_CLOSED_CANCEL_TIMEOUT_MS}ms)`,
								),
							}
						}
						if (cancelOutcome === "error") {
							// The cancel threw. The
							// supervised job's terminality
							// is UNKNOWN. The permit MUST
							// stay held.
							return { kind: "cancel_error", error: cancelSettled.error }
						}
						// Cancel settled "ok". Move to Stage 2.
						return { kind: "cancel_settled_ok" as const }
					})()
					// Stage 2: settle race (post-cancel). The
					// settle race is the ONLY authoritative
					// terminality signal: it races the
					// supervised job's `terminalPromise`
					// against a bounded timer. Runs ONLY
					// after the cancel has settled "ok";
					// otherwise the stage-1 outcome is the
					// settlement.
					return await (async (): Promise<PostLaunchSettlementOutcome> => {
						if (cancelSettle.kind !== "cancel_settled_ok") {
							return cancelSettle
						}
						let settleTimerHandle: ReturnType<typeof setTimeout> | undefined
						const settleTimerPromise = new Promise<"timeout">((resolve) => {
							settleTimerHandle = setTimeout(() => resolve("timeout"), POST_LAUNCH_FAIL_CLOSED_SETTLE_TIMEOUT_MS)
						})
						// The supervised job's
						// `terminalPromise` is the ONLY
						// authoritative terminality
						// signal. It is guaranteed to
						// resolve (it never rejects —
						// see
						// `command-job-manager.ts:218-220`);
						// the `.catch` is defense-in-depth.
						const terminalSettled = startedJob.terminalPromise.then(
							(transition): PostLaunchSettlementOutcome => ({
								kind: "terminal_observed",
								terminalTransition: {
									becameIdle: transition.becameIdle,
									jobId: transition.jobId,
									terminalState: transition.terminalState as string,
								},
							}),
							(error): PostLaunchSettlementOutcome => ({ kind: "cancel_error", error }),
						)
						const outcome = await Promise.race([
							terminalSettled,
							settleTimerPromise.then((): PostLaunchSettlementOutcome => ({ kind: "timeout" })),
						])
						// Clear the settle timer on every
						// outcome; the race may have settled
						// via `terminal_observed` and the
						// timer would otherwise remain armed
						// in the Node timer queue.
						if (settleTimerHandle !== undefined) {
							clearTimeout(settleTimerHandle)
						}
						return outcome
					})()
				}
				const failClosedPostLaunch = async (phase: "attach" | "register" | "record", detail: string): Promise<never> => {
					// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
					// (CORR-POST-START-LATE-TERMINAL-01): install the
					// exactly-once auto-release hook on the supervised
					// job's `terminalPromise` BEFORE the bounded
					// settlement step runs. The hook is the ONLY
					// release path for the fail-closed case because
					// the BCB's normal consume path is unreachable
					// (the post-launch admission step rejected the
					// obligation registration, so the consume paths
					// cannot find this jobId). The hook fires
					// fire-and-forget on the supervised job's eventual
					// terminal transition. It validates the expected
					// jobId (defense in depth: avoids releasing
					// another owner's permit if the manager ever
					// produces a transition for a different job),
					// is exactly-once via a closure flag, and is
					// dispose-safe (handles the BCB's `disposed`
					// result as a no-op). Idempotency: a re-release
					// of the same permit is a BCB `not_found`
					// no-op, so the hook is safe even when the
					// bounded-settlement branch already released
					// the permit on the `terminal_observed` happy
					// path (the closure flag short-circuits the
					// second call entirely).
					if (permitId !== undefined && startedJob.terminalPromise) {
						let lateTerminalReleased = false
						const expectedPermitId = permitId
						const expectedJobId = startedJob.jobId
						startedJob.terminalPromise.then((transition) => {
							if (lateTerminalReleased) {
								return
							}
							lateTerminalReleased = true
							if (transition.jobId !== expectedJobId) {
								// Defense in depth: the manager's contract
								// is one terminalPromise per jobId, so
								// this should never fire. If it does,
								// do not release the permit (it belongs
								// to a different owner).
								return
							}
							const result = options.backgroundNotifyCoordinator?.releaseReservation(expectedPermitId)
							// `released` : the permit was held; we
							// successfully recovered the slot. The
							// late terminal settlement is now
							// reflected in the BCB's bookkeeping.
							// `not_found` : the permit was already
							// released (by the bounded-settlement
							// branch on the `terminal_observed` happy
							// path, or by coordinator disposal). No-op.
							// `disposed` : the BCB was disposed between
							// the helper's fail-closed throw and the
							// supervised job's terminality. No-op.
							void result
						})
					}
					// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
					// (CORR-POST-START-TIMEOUT-01): the permit-release
					// decision is gated on the SETTLEMENT OUTCOME, not
					// on a timer.
					//
					// - `terminal_observed` : the supervised job's
					//   terminalPromise resolved before the bounded
					//   wait. The job is now in the manager's
					//   terminal map. Release the permit.
					//
					// - `timeout` : the bounded wait elapsed WITHOUT
					//   observing terminality. The supervised job
					//   may still be running. DO NOT release the
					//   permit. Throw a "containment pending" error
					//   so the host knows the slot is conserved.
					//   The manager's own deadline watchdog
					//   (executionDeadlineMs, default 30s) remains
					//   the authoritative termination guarantor
					//   after this wait.
					//
					// - `cancel_error` : `manager.cancel(...)` itself
					//   rejected. The supervised job's terminality
					//   is UNKNOWN. DO NOT release the permit. Throw
					//   a "containment pending" error.
					//
					// A late-arriving terminal settlement (after
					// this function returns) is handled by the
					// auto-release hook installed at the TOP of
					// this helper (CORR-POST-START-LATE-TERMINAL-01).
					// The hook attaches a single exactly-once
					// `.then()` to the supervised job's
					// `terminalPromise` BEFORE the bounded
					// settlement step runs. When the supervisor
					// eventually reaches terminality (whether
					// during the bounded wait or after it), the
					// hook releases the permit exactly once,
					// independent of the settlement outcome. The
					// fail-closed path does NOT register an
					// obligation with the BCB (the obligation
					// registration was rejected at the
					// post-launch admission step), so the BCB's
					// normal consume path cannot release the
					// permit; the hook is the ONLY release path
					// for this fail-closed case. The hook is
					// fire-and-forget: the helper does NOT
					// await it. The hook is exactly-once via a
					// closure flag. The hook is dispose-safe
					// (handles { kind: 'disposed' } gracefully).
					// The hook validates the expected jobId
					// (defense in depth).
					// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
					// (CORR-POST-START-TIMEOUT-01): the settlement
					// is computed LAZILY here. On the happy
					// path (post-launch admission succeeds),
					// this function is never called, so the
					// settlement is never computed and the
					// supervised job is NOT cancelled. The
					// settlement is only computed when a
					// post-launch admission step fails AND
					// the fail-closed repair is engaged.
					// The settlement step ran and returned a
					// discriminated outcome. The auto-release
					// hook (CORR-POST-START-LATE-TERMINAL-01)
					// has already been installed above; this
					// is the bounded-settlement branch only.
					const settlementOutcome = await computeSettlement()
					if (settlementOutcome.kind === "terminal_observed" && permitId !== undefined) {
						options.backgroundNotifyCoordinator?.releaseReservation(permitId)
						permitId = undefined
					}
					// Build the error message. The text is
					// intentionally distinct between the three
					// outcomes:
					//
					// - terminal_observed: "cancelled through the
					//   supervised lifecycle and the permit has
					//   been released" (preserved verbatim so the
					//   existing happy-path test
					//   POST-START-FAILURE-01 still passes).
					//
					// - timeout: NO "cancelled" claim, NO
					//   "permit has been released" claim. The
					//   message identifies the bounded-wait
					//   timeout and the containment-pending
					//   disposition so the host's diagnostic
					//   capture can attribute the failure
					//   correctly.
					//
					// - cancel_error: similar to timeout but
					//   identifies the cancel-call failure as
					//   the cause of the unknown-state outcome.
					if (settlementOutcome.kind === "terminal_observed") {
						throw new PostLaunchFailClosedError(
							`[Observation-capacity admission failed: post-launch ${phase} refused (${detail}). The runtime cannot guarantee a terminal-observation backing slot for a job that was already started. The job has been cancelled through the supervised lifecycle and the permit has been released. This is a fail-closed refusal, NOT a transient error; the host owns the disposition.]`,
							true,
						)
					}
					if (settlementOutcome.kind === "timeout") {
						// Containment pending. The bounded wait
						// elapsed; the supervised job MAY still
						// be running. The reservation slot
						// stays held. The host is the only
						// authority that can decide the next
						// action.
						throw new PostLaunchFailClosedError(
							`[Observation-capacity admission failed: post-launch ${phase} refused (${detail}). The runtime cannot guarantee a terminal-observation backing slot for a job that was already started. The post-launch settlement bounded wait (${POST_LAUNCH_FAIL_CLOSED_SETTLE_TIMEOUT_MS}ms) elapsed WITHOUT observing the supervised job's terminal state (containment pending); the manager's own deadline watchdog remains the authoritative termination guarantor. The reservation slot has been CONSERVED (not released) because timeout does not establish that the supervised job has terminated. This is a fail-closed refusal, NOT a transient error; the host owns the disposition.]`,
							false,
						)
					}
					// cancel_error
					if (settlementOutcome.kind !== "cancel_error") {
						// `cancel_settled_ok` is consumed
						// internally by stage 2; it MUST
						// NOT reach this reporter. If it
						// does, treat it as a defensive
						// fallback (throw a timeout-style
						// error; do not release the
						// permit). This branch is
						// unreachable in normal
						// operation; the type narrowing
						// makes it a static guarantee.
						throw new PostLaunchFailClosedError(
							`[Observation-capacity admission failed: post-launch ${phase} refused (${detail}). The runtime cannot guarantee a terminal-observation backing slot for a job that was already started. Internal invariant violation: the post-launch settlement returned an unexpected outcome (kind=${settlementOutcome.kind}). The reservation slot has been CONSERVED (not released) as a defensive measure. This is a fail-closed refusal, NOT a transient error; the host owns the disposition.]`,
							false,
						)
					}
					const errMessage =
						settlementOutcome.error instanceof Error
							? settlementOutcome.error.message
							: String(settlementOutcome.error)
					throw new PostLaunchFailClosedError(
						`[Observation-capacity admission failed: post-launch ${phase} refused (${detail}). The runtime cannot guarantee a terminal-observation backing slot for a job that was already started. The supervised-lifecycle cancel call itself failed (${errMessage}); the supervised job's terminality is UNKNOWN and the reservation slot has been CONSERVED (not released). This is a fail-closed refusal, NOT a transient error; the host owns the disposition.]`,
						false,
					)
				}
				// RUNNING returns a structured snapshot so the model can
				// observe status + jobId. Terminal results retain the
				// existing stdout/exitCode shape for backward compatibility.
				// ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01:
				// The marker registration + wake-consumer listener
				// is bound to the genuine background handoff
				// (`start.state === "running"`). When the command
				// finishes within the wait budget (FAST-PATH), the
				// model already receives the synchronous terminal
				// result via `combinedOutput` / `CommandExitError`
				// below; registering a marker + wake in that case
				// would produce a DUPLICATE wake (synchronous tool
				// result + later notification). The frozen contract
				// is notify-on-terminal for a BACKGROUND handoff —
				// synchronous terminality is observable in-band and
				// needs no wake. (Correction01 closes the
				// overpromoted "fast-path never registered" claim:
				// fast-path = synchronous; running = detached.)
				if (
					start.state === "running" &&
					notifyRequested &&
					options.backgroundNotifyCoordinator &&
					options.resolveActiveOwner &&
					permitId !== undefined
				) {
					// ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01: observational trigger for the V8 allocation sampler. Fires exactly once per process (state-machine guard). NEVER throws; NEVER alters command semantics.
					triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
					// ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01: sibling observational trigger for the rolling V8 CPU profiler. Shares the same trigger seam (notify-enabled background command) but uses an INDEPENDENT state machine + env knob (CLINEMM_DIAG_CPU_PROFILE). NEVER throws; NEVER alters command semantics.
					triggerExtensionHostCpuProfilerOnFirstQualifyingJob()
					// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
					// (CORR-OWNER-HANDOFF-01): the reservation was issued
					// against the LAUNCH-TIME owner (S1/T1) before
					// `manager.start()`. After the await, the active
					// owner may have switched (e.g. S2/T2) — the
					// owner-switch hazard repaired in HTEC01. The
					// notify path MUST attach/register the marker
					// under the SAME owner that the permit was reserved
					// for, NOT the current active owner. Re-resolving
					// the owner here recreates the HTEC01 hazard
					// (admit under S1, register under S2, BCB rejects
					// on owner_mismatch, the job is now in flight
					// without an obligation).
					const owner = ownerResolution
					if (owner) {
						// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION:
						// attach the permit to the jobId BEFORE the
						// marker is registered. The BCB will reject
						// the registration if the permit is not
						// attached to this exact jobId.
						const attachResult = options.backgroundNotifyCoordinator.attachReservationToJob({
							permitId,
							jobId: start.jobId,
							owner,
						})
						if (attachResult.kind !== "attached" && attachResult.kind !== "already_attached") {
							// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
							// (CORR-POST-START-FAILURE-01): the permit
							// could not be attached. The job is
							// ALREADY running (manager.start() returned
							// running). The bounded repair cancels the
							// job through the supervised lifecycle,
							// awaits settlement, releases the permit,
							// and throws fail-closed -- the job does
							// NOT continue untracked. See
							// `failClosedPostLaunch` defined above.
							await failClosedPostLaunch("attach", `permit attach refused (${attachResult.kind})`)
						}
						const registerResult = options.backgroundNotifyCoordinator.registerMarker({
							jobId: start.jobId,
							sessionId: owner.sessionId,
							taskId: owner.taskId,
							permitId,
						})
						if (registerResult.kind === "permit_not_attached") {
							// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
							// (CORR-POST-START-FAILURE-01): defense in
							// depth -- the attach step above should
							// have already succeeded, so this is
							// only reachable if the BCB state
							// changed in between. The bounded repair
							// cancels the job, awaits settlement,
							// releases the permit, and throws
							// fail-closed.
							await failClosedPostLaunch(
								"register",
								"permit was not attached at registerMarker time (BCB state changed between attach and register)",
							)
						}
						// ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
						// Record this jobId in the per-turn
						// `MessageTranslatorState` ownership hint at the
						// SAME seam as the marker registration so the C10
						// completion-result filter knows this completion
						// belongs to a job THIS turn launched. The hook is
						// optional — production code MUST continue to work
						// when it is omitted (the BCTPA-P7b RED witness
						// then remains observable as a degraded mode).
						options.recordLaunchedBackgroundJob?.(start.jobId)
						// Attach the per-job wake consumer to the
						// terminalPromise. The listener fetches
						// terminal classification via manager.status
						// AFTER terminalPromise resolves (so the
						// status() lookup sees a stable terminal
						// record) and forwards the fact to the
						// coordinator's consumeTerminal method.
						const jobId = start.jobId
						start.terminalPromise.then(async () => {
							const status = await manager.status({ jobId, waitMs: 0 })
							if (!status.ok) {
								// Job evaporated between terminalPromise
								// resolving and our status() call. Mark
								// as a no-wake so the consumer cannot
								// resurrect the agent. The coordinator
								// treats this as "no_marker" anyway
								// (the marker was already consumed or
								// never existed) but logging is useful
								// for diagnostics.
								return
							}
							const snapshot = status.snapshot
							const terminalState = snapshot.state
							const exitCode = snapshot.exitCode
							// containment_failed is the "no wake"
							// trigger per N9. The manager exposes
							// the verdict as snapshot.state ===
							// "containment_failed" (CORRECTION03)
							// OR via snapshot.containmentFailed
							// (the postcondition discriminator).
							// We treat the state itself as the
							// authority and forward it as the
							// `isContainmentFailed` flag.
							const isContainmentFailed = terminalState === "containment_failed"
							// ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY:
							// NEEDS-EXPLICIT-CUTOVER. The Elm kernel shadow
							// (apps/vscode/elm/background-notify-authority) is
							// now in place and the BNAEC01 differential
							// correspondence test passes 19/19. The TypeScript
							// consumeTerminal method remains the LIVE authority
							// at this call site. The next ACT
							// (ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-
							// AUTHORITY-CUTOVER) is the explicit successor for
							// the live cutover. Until that ACT lands, the TS
							// path remains authoritative. Do not invoke the
							// Elm adapter here.
							options.backgroundNotifyCoordinator!.consumeTerminal({
								jobId,
								terminalState,
								exitCode,
								reason: snapshot.signal,
								isContainmentFailed,
								outputTail: snapshot.stdout?.slice(-1024),
							})
						})
					}
				}

				// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
				// (CORR-NONNOTIFY-HANDOFF-01): non-notify fire-and-forget
				// background jobs MUST establish their observation obligation
				// at the RUNNING handoff, NOT at terminality. The previous
				// placement inside `terminalPromise.then(...)` (which only
				// fires once the job has reached terminal state) had three
				// failure modes:
				//
				//   1. Between `manager.start()` returning "running" and the
				//      job reaching terminality, the BCB has no obligation
				//      for this jobId. A `command_status` call cannot find
				//      a non-notify observation to consume; the BCB01 §0.1
				//      second conjunct (unconsumed terminal results == 0)
				//      cannot be evaluated while the job is running.
				//   2. If the active owner switches between the running
				//      handoff and the terminal handoff, the attach on the
				//      terminal side re-resolves the owner and can fail
				//      owner_mismatch — at which point the permit is
				//      released, but the running job's obligation ownership
				//      was never established. The slot is freed but the
				//      terminal fact is now unowned.
				//   3. The fast-path "release on attach failure" inside the
				//      terminal callback is the dangerous sequence called
				//      out in the review: the in-flight job has no
				//      observation ownership, and the permit has been
				//      returned. A follow-up `command_status` finds nothing
				//      to consume.
				//
				// The corrected placement establishes the obligation while
				// the job is running (after `manager.start()` returns
				// "running", with a captured launch-time owner). On any
				// failure, the permit is released and the host is fail-
				// closed (refuses to start the marker). The terminal
				// callback no longer creates the obligation; it only
				// forwards the terminal fact to the projection.
				if (
					start.state === "running" &&
					!notifyRequested &&
					options.backgroundNotifyCoordinator &&
					permitId !== undefined &&
					ownerResolution
				) {
					const owner = ownerResolution
					// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
					// (CORR-OWNER-HANDOFF-01): attach the permit to the
					// jobId under the LAUNCH-TIME owner (S1/T1) — the
					// same owner the permit was reserved for. The
					// current active owner may have switched (S2/T2);
					// re-resolving would recreate the HTEC01 hazard.
					const attachResult = options.backgroundNotifyCoordinator.attachReservationToJob({
						permitId,
						jobId: start.jobId,
						owner,
					})
					if (attachResult.kind !== "attached" && attachResult.kind !== "already_attached") {
						// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
						// (CORR-POST-START-FAILURE-01): the permit
						// could not be attached at the running
						// handoff. The job is ALREADY running.
						// The bounded repair cancels the job
						// through the supervised lifecycle, awaits
						// settlement, releases the permit, and
						// throws fail-closed. See
						// `failClosedPostLaunch` defined above.
						await failClosedPostLaunch("attach", `non-notify permit attach refused (${attachResult.kind})`)
					}
					// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01:
					// register the non-notify terminal observation
					// at the running handoff so the BCB01 §0.1
					// invariant (unconsumed terminal results == 0)
					// is observable as soon as the job is admitted.
					// The owning agent observes the terminal fact
					// through `command_status` (the canonical
					// production consumer at
					// `command-status-tool.ts:289-298`).
					const recordResult = options.backgroundNotifyCoordinator.recordNonNotifyTerminalObservation({
						jobId: start.jobId,
						sessionId: owner.sessionId,
						taskId: owner.taskId,
						permitId,
					})
					if (recordResult.kind === "permit_not_attached") {
						// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
						// (CORR-POST-START-FAILURE-01): defense in
						// depth -- the attach step above should
						// have already succeeded, so this is
						// only reachable if the BCB state changed
						// in between. The bounded repair cancels
						// the job, awaits settlement, releases the
						// permit, and throws fail-closed.
						await failClosedPostLaunch(
							"record",
							"non-notify permit was not attached at recordNonNotifyTerminalObservation time (BCB state changed between attach and record)",
						)
					}
				}

				if (start.state === "running") {
					// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
					// (correction01 / Factory
					// HALT_MULTI_JOB_START_SIGNAL_DROPPED): the start
					// notification MUST fire per RUNNING job, regardless
					// of aggregate 0->1 cardinality. The earlier
					// `becameActive` gate silently dropped the start
					// signal for any concurrent 1->2+ start (e.g. J2
					// started while J1 was already running). That left
					// the projection map missing J2's "running" entry
					// and broke the per-job derivation of
					// `backgroundCommandRunning` and `backgroundCommandTaskId`.
					//
					// The terminal side was already corrected to fire
					// per-job (see the terminalPromise listener below).
					// This brings the start side to the same symmetry:
					//
					//   every job for which run_commands returns
					//   status:"running" emits exactly one
					//   (true, thatJobId) BEFORE any terminal tuple for
					//   that job.
					notifyBackgroundStateChange(true, start.jobId, undefined, ownerResolution?.sessionId)
					// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03:
					// attach an async listener so the projection flips
					// back to false when the process completes
					// asynchronously (after this tool call returns). The
					// listener reads `becameIdle` from the resolved
					// `terminalPromise` — race-safe under concurrent
					// terminal-completions. If `becameIdle` is false,
					// this completion was a 2->1 (or higher) transition;
					// another job is still active and the projection must
					// stay true (no-op).
					// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
					// (correction01 / Factory
					// HALT_TERMINAL_CARD_MULTI_JOB_PROJECTION_FALSE_GREEN):
					// the listener MUST fire per-job, regardless of
					// `becameIdle`. The aggregate >0->0 signal is now
					// derived from the host's running-count of the
					// projection map (the host's scalar field stays in
					// sync via `updateBackgroundCommandState`'s recompute).
					// The terminal reason (`terminalState`) is forwarded
					// verbatim so the projection renders the exact pill
					// (Cancelled / Deadline exceeded / etc.) instead of
					// collapsing every terminal into "Completed".
					start.terminalPromise.then(({ jobId, terminalState }) => {
						notifyBackgroundStateChange(false, jobId, terminalState, ownerResolution?.sessionId)
						// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
						// (CORR-NONNOTIFY-HANDOFF-01): the non-notify
						// observation obligation is now established at the
						// RUNNING handoff (above), not at terminality. By the
						// time this terminal callback fires, the BCB already
						// owns the obligation for this jobId under the
						// LAUNCH-TIME owner (CORR-OWNER-HANDOFF-01). The
						// canonical production consumer (the `command_status`
						// tool, Path C) drains the obligation when the agent
						// observes the terminal fact; this callback only
						// forwards the terminal pill to the projection map.
					})
					// ACT-CLINEMM-BACKGROUND-COMMAND-PROCEED-WHILE-RUNNING-ABORT-OWNERSHIP-RELEASE01:
					// The foreground->background handoff is irrevocably true
					// at this point. Per the upstream
					// `sdk/ARCHITECTURE.md §proceed-while-running` contract,
					// the executor must release its abort ownership: a later
					// caller-supplied abort on the same `context.signal` MUST
					// NOT cancel the detached managed job. Release the
					// listener installed by `CommandJobManager.start()` at
					// command-job-manager.ts:1986-2010. The release is a
					// no-op when no caller signal was attached.
					manager.releaseForegroundAbortOwnership(start.jobId)
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
				// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03:
				// terminal path — the command completed before the
				// wait budget expired. Use the terminalPromise with
				// `becameIdle` (race-safe transition metadata from the
				// manager's `finalize()` seam). For fast-path commands,
				// the promise is already resolved and the `.then()`
				// fires in the next microtask; for slow-path commands
				// that completed during the wait-budget race, the
				// `.then()` fires the same way (the manager's
				// `exitTransition` resolves before `makeStartResult`).
				//
				// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
				// (correction01): fire the per-job terminal signal
				// UNCONDITIONALLY (not gated on `becameIdle`) so the
				// host projection can flip a SINGLE job in a multi-job
				// session. The aggregate >0->0 signal is derived from
				// the host's running-count of the projection map, not
				// from the runner's callback cardinality. This site
				// stays a no-op when the manager never reached the
				// RUNNING branch (the fast-path case where the tool
				// returned terminal synchronously) — the synchronous
				// terminal state is already handled by the early-return
				// paths below; no projection update is required.
				//
				// (Guarded by `start.becameActive` — the flag that
				// indicates the job actually entered the manager's
				// active Map. The RUNNING handler at line 822 only
				// fires `(true, jobId)` when `becameActive === true`;
				// the matching per-job terminal signal must be
				// gated by the same condition so the projection
				// map does not accumulate phantom entries for
				// synchronous-fast-path terminals that never had a
				// corresponding start signal.)
				if (start.becameActive) {
					start.terminalPromise.then(({ jobId, terminalState }) => {
						notifyBackgroundStateChange(false, jobId, terminalState, ownerResolution?.sessionId)
					})
				}
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
				// ACT-CLINEMM-HTEC02-PRELAUNCH-OBSERVATION-CAPACITY-ADMISSION
				// (CORR-POST-START-TIMEOUT-01): when the
				// `failClosedPostLaunch` helper throws, the
				// throw carries the permit-release decision
				// via the `permitReleasedOnThrow` flag. The
				// outer catch MUST honor that decision:
				//   - `true`  : the fail-closed path already
				//               released the permit (the
				//               `terminal_observed` happy
				//               path). The outer catch MUST
				//               NOT release again.
				//   - `false` : the fail-closed path conserved
				//               the permit (the `timeout` /
				//               `cancel_error` paths of the
				//               post-launch repair). The
				//               outer catch MUST NOT release
				//               either; the permit stays
				//               held because the supervised
				//               job's terminality is UNKNOWN
				//               (timeout) or the cancel
				//               call itself failed
				//               (cancel_error).
				//   - The throw is NOT a `PostLaunchFailClosedError`
				//     (e.g. the launch-time pre-cancel throw,
				//     or a `CommandExitError` from the fast
				//     path). The pre-cancel throws happen
				//     BEFORE any settlement step; the
				//     `failClosedPostLaunch` helper was
				//     never called; the permit was never
				//     attached to an obligation. The catch
				//     releases the permit (this matches
				//     the original pre-fix behavior).
				const isFailClosedThrow = error instanceof PostLaunchFailClosedError
				if (permitId !== undefined && (!isFailClosedThrow || error.permitReleasedOnThrow)) {
					options.backgroundNotifyCoordinator?.releaseReservation(permitId)
					permitId = undefined
				}
				// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03:
				// on any thrown error (CommandExitError, spawn_failed,
				// etc.) the background command is no longer in-flight.
				// Use the terminalPromise with `becameIdle` so the
				// projection flip is race-safe under concurrent
				// terminal-completions. The RUNNING branch above already
				// attached a listener for the async case; we add another
				// here for the catch path (errors can also fire after
				// manager.start() returns).
				//
				// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
				// (correction01): fire per-job (not gated on
				// `becameIdle`) so multi-job projection stays
				// accurate. The terminal reason (`terminalState`)
				// is forwarded so cancelled/deadline_exceeded
				// render correctly in the chat row. Same
				// `becameActive` guard as the fast-path branch
				// above — only fire if the job had a
				// corresponding start signal.
				if (start?.terminalPromise && start.becameActive) {
					start.terminalPromise.then(({ jobId, terminalState }) => {
						notifyBackgroundStateChange(false, jobId, terminalState, ownerResolution?.sessionId)
					})
				}
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
