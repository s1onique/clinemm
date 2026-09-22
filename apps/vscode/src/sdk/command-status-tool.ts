/**
 * Host-owned follow-up APIs for supervised commands.
 *
 * Two distinct tools, two distinct security classes:
 *
 *   - `command_status` is OBSERVATION ONLY. Read-only by construction:
 *     it has no way to terminate the child. The model can poll for
 *     progress / completion without going through the command-policy
 *     adapter. Safe to auto-approve.
 *
 *   - `cancel_command` is the mutating path. It calls
 *     `manager.cancel(...)` which terminates the owned process tree.
 *     It MUST be subject to the same command-policy adapter as
 *     `run_commands`: ALLOW/ASK/DENY with the user's
 *     `executeSafeCommands` preference. The runtime builder adds it to
 *     the SDK toolPolicies registry so `requestToolApproval` fires.
 *
 * This split exists because a single tool whose security class depends
 * on a boolean buried in input is easy to get wrong. Two tools, two
 * capability boundaries.
 */
import { type AgentTool, createTool } from "@cline/shared"
import type { BackgroundNotifyCoordinator } from "./background-notify-coordinator"
import { CommandJobManager, MAX_STATUS_WAIT_MS } from "./command-job-manager"
import { Logger } from "@/shared/services/Logger"

export interface CommandStatusInput {
	jobId: string
	/** Optional wall-clock budget in ms (clamped to MAX_STATUS_WAIT_MS). 0 returns current state immediately. */
	waitMs?: number
}

export interface CommandStatusOutput {
	ok: boolean
	jobId?: string
	state?: string
	elapsedMs?: number
	deadlineRemainingMs?: number
	stdout?: string
	stderr?: string
	outputTruncated?: boolean
	exitCode?: number
	signal?: string
	error?: string
}

export interface CancelCommandInput {
	jobId: string
}

export interface CancelCommandOutput {
	ok: boolean
	jobId?: string
	state?: string
	stdout?: string
	stderr?: string
	elapsedMs?: number
	error?: string
}

function readStringField(record: Record<string, unknown>, key: string): string {
	const v = record[key]
	if (typeof v !== "string" || v.length === 0) {
		throw new Error(`${key} must be a non-empty string`)
	}
	return v
}

function readOptionalFiniteNumber(record: Record<string, unknown>, key: string): number | undefined {
	const v = record[key]
	if (v === undefined) return undefined
	if (typeof v !== "number" || !Number.isFinite(v)) {
		throw new Error(`${key} must be a finite number when provided`)
	}
	return v
}

function readStatusInput(input: unknown): CommandStatusInput {
	if (input === null || typeof input !== "object") {
		throw new Error("command_status input must be an object")
	}
	const record = input as Record<string, unknown>
	return {
		jobId: readStringField(record, "jobId"),
		waitMs: readOptionalFiniteNumber(record, "waitMs"),
	}
}

function readCancelInput(input: unknown): CancelCommandInput {
	if (input === null || typeof input !== "object") {
		throw new Error("cancel_command input must be an object")
	}
	const record = input as Record<string, unknown>
	return { jobId: readStringField(record, "jobId") }
}

/**
 * ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01:
 * Path B seam (canonical_status_observed). When `command_status`
 * observes a terminal state on a job that was registered with
 * `notifyOnCompletion=true`, the tool resolves the
 * BackgroundNotifyCoordinator's obligation marker so the
 * completion-barrier can release the held `completed` phase. The
 * marker is consumed iff (a) the snapshot's state is terminal,
 * (b) the optional `backgroundNotifyCoordinator` and
 * `resolveActiveOwner` callbacks were wired by the host, and
 * (c) the marker's owner triple matches the active owner.
 */
export interface CreateCommandStatusToolOptions {
	backgroundNotifyCoordinator?: BackgroundNotifyCoordinator
	resolveActiveOwner?: () => { sessionId: string; taskId: string | undefined } | undefined
}

/**
 * `command_status` — observation only. Cannot terminate the child.
 * Auto-approved by the SDK (no entry in toolPolicies). The tool
 * description is explicit about that boundary so the model does not
 * attempt to use it as a cancel substitute.
 *
 * ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01:
 * When the optional `backgroundNotifyCoordinator` and
 * `resolveActiveOwner` are wired, the tool ALSO resolves the
 * coordinator's obligation marker on terminal observation (the
 * canonical Path B source). Idempotent — the coordinator's
 * `resolveObligation` is itself idempotent.
 */
export function createCommandStatusTool(
	manager: CommandJobManager,
	options: CreateCommandStatusToolOptions = {},
): AgentTool {
	return createTool({
		name: "command_status",
		description:
			"Inspect the state of a long-running shell command previously launched via run_commands. " +
			"Pass the jobId returned by run_commands. Optional waitMs (clamped to " +
			MAX_STATUS_WAIT_MS +
			"ms) blocks until the job reaches a terminal state or the budget elapses; " +
			"the call returns whatever state is observed. This tool is OBSERVATION ONLY; " +
			"it cannot terminate the child. To terminate a running command, use cancel_command.",
		inputSchema: {
			type: "object",
			properties: {
				jobId: { type: "string", description: "Job identifier returned by run_commands." },
				waitMs: {
					type: "number",
					description:
						"How long to wait for a state transition. Clamped to [0, " +
						MAX_STATUS_WAIT_MS +
						"]. 0 means return current state immediately.",
				},
			},
			required: ["jobId"],
		},
		timeoutMs: MAX_STATUS_WAIT_MS + 5_000,
		retryable: false,
		maxRetries: 0,
		execute: async (input: unknown) => {
			let typed: CommandStatusInput
			try {
				typed = readStatusInput(input)
			} catch (error) {
				return [{ ok: false, error: error instanceof Error ? error.message : String(error) }]
			}
			const waitMs = Math.max(0, Math.min(typed.waitMs ?? 0, MAX_STATUS_WAIT_MS))
			const status = await manager.status({ jobId: typed.jobId, waitMs })
			if (!status.ok) {
				return [{ ok: false, error: `unknown_job: ${typed.jobId}` }]
			}
			const snap = status.snapshot
			// ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01:
			// Path B resolution. When this status call observes a
			// TERMINAL state on a job that was registered with
			// notifyOnCompletion=true, drain the obligation marker so
			// the completion-barrier can release the held `completed`
			// phase. `containment_failed` is the explicit "no wake"
			// trigger (matches the Path A consumer at
			// `vscode-run-commands-tool.ts`).
			//
			// Owner identity is resolved from the active session so a
			// stale poll from a different session cannot drain a marker
			// it does not own. This matches the Path A consumeTerminal
			// owner-mismatch check at
			// `background-notify-coordinator.ts:382-388`.
			if (
				options.backgroundNotifyCoordinator &&
				options.resolveActiveOwner &&
				snap.state !== "running" &&
				snap.state !== "containment_failed"
			) {
				const activeOwner = options.resolveActiveOwner()
				if (activeOwner) {
					const decision = options.backgroundNotifyCoordinator.resolveObligation({
						jobId: typed.jobId,
						sessionId: activeOwner.sessionId,
						taskId: activeOwner.taskId,
						resolution: "canonical_status_observed",
					})
					if (decision.kind === "resolved") {
						Logger.warn(
							`[command_status] Path B resolution drained marker for jobId=${typed.jobId} (session=${activeOwner.sessionId}); terminal-state=${snap.state}`,
						)
					}
				}
			}
			return [
				{
					ok: true,
					jobId: snap.id,
					state: snap.state,
					elapsedMs: snap.elapsedMs,
					deadlineRemainingMs: snap.deadlineRemainingMs,
					stdout: snap.stdout,
					stderr: snap.stderr,
					outputTruncated: snap.outputTruncated,
					...(snap.exitCode !== undefined ? { exitCode: snap.exitCode } : {}),
					...(snap.signal !== undefined ? { signal: snap.signal } : {}),
				},
			]
		},
	})
}

/**
 * `cancel_command` — terminates the owned process tree. MUST be
 * registered through the command-policy adapter: the runtime builder
 * adds `cancel_command` to `toolPolicies` so `requestToolApproval` is
 * invoked, then the existing `getCommandHostAuthorization` flow decides
 * ALLOW / ASK / DENY based on the user's executeSafeCommands setting.
 */
export function createCancelCommandTool(manager: CommandJobManager): AgentTool {
	return createTool({
		name: "cancel_command",
		description:
			"Terminate a long-running shell command previously launched via run_commands. " +
			"Pass the jobId returned by run_commands. The owned process tree is terminated via " +
			"SIGTERM, escalating to SIGKILL after a short grace period. Idempotent: " +
			"re-cancelling an already-terminal or already-cancelled job is a no-op.",
		inputSchema: {
			type: "object",
			properties: {
				jobId: { type: "string", description: "Job identifier returned by run_commands." },
			},
			required: ["jobId"],
		},
		timeoutMs: 10_000,
		retryable: false,
		maxRetries: 0,
		execute: async (input: unknown) => {
			let typed: CancelCommandInput
			try {
				typed = readCancelInput(input)
			} catch (error) {
				return [{ ok: false, error: error instanceof Error ? error.message : String(error) }]
			}
			const result = await manager.cancel({ jobId: typed.jobId })
			if (!result.ok) {
				return [{ ok: false, error: `unknown_job: ${typed.jobId}` }]
			}
			// Observe post-cancel state to surface partial output and
			// exit information to the model.
			const status = await manager.status({ jobId: typed.jobId, waitMs: 0 })
			const out: CancelCommandOutput = {
				ok: true,
				jobId: typed.jobId,
				state: result.state,
			}
			if (status.ok) {
				out.stdout = status.snapshot.stdout
				out.stderr = status.snapshot.stderr
				out.elapsedMs = status.snapshot.elapsedMs
			}
			return [out]
		},
	})
}
