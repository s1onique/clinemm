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
import { Logger } from "@/shared/services/Logger"
import type { BackgroundNotifyCoordinator } from "./background-notify-coordinator"
import { CommandJobManager, MAX_STATUS_WAIT_MS } from "./command-job-manager"

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
	/**
	 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 (H1):
	 * When `"pending"`, the originating turn attempted a blocking wait
	 * on a notify-owned background job. The wake-driven turn owns
	 * terminal-completion authority for this jobId. The model MUST NOT
	 * call `submit_and_exit` claiming this jobId's terminal result;
	 * the wake will provide the terminal result. Absent on non-notify
	 * jobs and on non-blocking (waitMs==0) status reads.
	 */
	notification?: "pending"
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
 *
 * ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01:
 * the per-call `onRunningObserved` callback fires when this tool
 * observes a `state: "running"` snapshot. The host (production
 * `SdkController` via the `vscode-runtime-builder.ts` wiring)
 * reconciles the `backgroundCommandJobStates` projection map
 * from a stale terminal value back to `running` so the chat row's
 * `liveProjectionTerminalReason` does not retain a "Run failed"
 * pill (the `containment_failed` projection under
 * `CommandStatusMap.containment_failed === "Run failed"` in
 * `apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx:367`)
 * after a nonterminal canonical observation. The callback fires
 * ONLY for `state: "running"` snapshots; terminal observations
 * pass through unchanged and do NOT invoke this seam (the
 * existing Path A / B / C / C' terminal drain is the terminal
 * authority).
 */
export interface CreateCommandStatusToolOptions {
	backgroundNotifyCoordinator?: BackgroundNotifyCoordinator
	resolveActiveOwner?: () => { sessionId: string; taskId: string | undefined } | undefined
	/**
	 * ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01:
	 * optional per-call callback fired with the observed
	 * `jobId` when the manager snapshot's `state` is
	 * `"running"`. Production wiring (see
	 * `vscode-runtime-builder.ts:277-282`) forwards this to
	 * the host's `updateBackgroundCommandState(true, jobId)`
	 * (idempotent — already-running entries are a no-op).
	 */
	onRunningObserved?: (jobId: string) => void
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
export function createCommandStatusTool(manager: CommandJobManager, options: CreateCommandStatusToolOptions = {}): AgentTool {
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
			const requestedWaitMs = Math.max(0, Math.min(typed.waitMs ?? 0, MAX_STATUS_WAIT_MS))

			// ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01
			// (H1): for a notify-owned active job, the originating turn
			// MUST NOT synchronously wait the job to terminal state. The
			// wake-driven turn is the sole terminal-completion authority.
			// The originating turn's blocking-wait attempt is the live
			// defect that produces two `submit_and_exit` completions for
			// ONE notify-owned background job. See `02-recon.md` and
			// `04-authority-discriminator.md` for the full causal
			// analysis.
			//
			// H1 short-circuit contract:
			//   - when `BackgroundNotifyCoordinator.hasActiveNotify(J)`
			//     returns true AND `waitMs > 0`, fall back to a
			//     non-blocking snapshot (manager.status with waitMs=0).
			//   - the snapshot is returned truthfully (state may be
			//     "running" or already terminal if the listener is
			//     microtasks behind).
			//   - Path B (resolveObligation) is SUPPRESSED for this
			//     call. The wake listener owns the marker drain; if the
			//     marker is still present the wake is pending, if the
			//     marker is gone the wake has already fired or the
			//     listener is microtasks from firing.
			//   - the response carries `notification: "pending"` as a
			//     structured signal that the wake owns terminal
			//     completion for this jobId.
			//
			// H1 invariant: under the H1 contract the originating turn
			// cannot claim `submit_and_exit` for J's terminal completion
			// via this code path. The wake is the single authority.
			//
			// Conservation (R4/R5): `command_status(J, waitMs == 0)`
			// and command_status on a NON-notify-owned job both pass
			// through unchanged. notify=false default produces zero
			// state delta.
			const notifyOwned =
				!!options.backgroundNotifyCoordinator && options.backgroundNotifyCoordinator.hasActiveNotify(typed.jobId)
			const suppressPathB = notifyOwned && requestedWaitMs > 0
			const waitMs = suppressPathB ? 0 : requestedWaitMs

			const status = await manager.status({ jobId: typed.jobId, waitMs })
			if (!status.ok) {
				return [{ ok: false, error: `unknown_job: ${typed.jobId}` }]
			}
			const snap = status.snapshot
			// ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01:
			// Nonterminal-observation reconciliation. When the manager
			// snapshot's state is `"running"`, fire the host's
			// `onRunningObserved` callback so the
			// `backgroundCommandJobStates` projection map is reconciled
			// from any stale terminal value (e.g. a one-shot
			// `command_job_containment_failed` emit that fired while the
			// job was actually still alive) back to `"running"`. The
			// callback is OPTIONAL: production code wires it via
			// `vscode-runtime-builder.ts:277-282` and the host's
			// `SdkController.updateBackgroundCommandState(true, jobId)`
			// semantics. The callback is FIRE-AND-FORGET (no awaited
			// promise) so the tool's return payload is not blocked on
			// the projection reconciliation; the next
			// `getStateToPostToWebview()` post picks up the change.
			// Terminal observations do NOT fire the callback — the
			// existing Path A / B / C / C' terminal drain is the
			// terminal authority, and reasserting `running` would
			// race the terminal listener.
			if (snap.state === "running") {
				options.onRunningObserved?.(typed.jobId)
			}
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
			//
			// ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01
			// (H1): when the originating turn's call is the notify-owned
			// blocking-wait shape (waitMs>0 + hasActiveNotify=true),
			// Path B is SUPPRESSED. The wake listener owns the marker
			// drain. Suppressing Path B eliminates the fire-and-forget
			// race between consumeTerminal (Path A) and
			// resolveObligation (Path B) — both call paths can no longer
			// race to drain the marker for the same originating turn.
			if (
				!suppressPathB &&
				options.backgroundNotifyCoordinator &&
				options.resolveActiveOwner &&
				snap.state !== "running" &&
				snap.state !== "containment_failed"
			) {
				const activeOwner = options.resolveActiveOwner()
				if (activeOwner) {
					// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01:
					// Path A — drain the live notify marker if any (the
					// notify=true obligation). This is the existing
					// notify-owned drain path.
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
					// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION02:
					// Path C — drain the non-notify (fire-and-forget)
					// terminal observation if any. This is the bounded
					// production consumer seam that closes the
					// `HALT_NON_NOTIFY_CONSUMER_NOT_WIRED` reviewer halt.
					//
					// The act of returning the terminal snapshot to the
					// agent IS the consumption event — `command_status`
					// is the only production path through which a
					// notify=false owner learns about a terminal
					// job (the wake itself is suppressed per user
					// opt-out). The drain is idempotent
					// (`consumeNonNotifyTerminalObservation` deletes
					// by jobId; if no observation exists it is a
					// no-op).
					//
					// Owner-mismatch check is enforced by
					// `BackgroundNotifyCoordinator.consumeNonNotifyTerminalObservation`,
					// which validates that the (jobId, sessionId,
					// taskId) triple matches the registered owner
					// before deleting. A stale cross-session
					// observation cannot drain a marker it does not
					// own; the active-owner check above ensures the
					// `(sessionId, taskId)` triple we pass is the
					// SAME owner that registered the observation.
					// This matches the Path A owner-mismatch check
					// at `background-notify-coordinator.ts:382-388`.
					// The drain is keyed by `jobId`, so a single
					// observation is consumed exactly once across
					// parallel `command_status` callers (no global
					// "any owner" drain).
					if (!options.backgroundNotifyCoordinator.hasActiveNotify(typed.jobId)) {
						options.backgroundNotifyCoordinator.consumeNonNotifyTerminalObservation({
							jobId: typed.jobId,
							sessionId: activeOwner.sessionId,
							taskId: activeOwner.taskId,
						})
						Logger.warn(
							`[command_status] Path C drained non-notify terminal observation for jobId=${typed.jobId} (session=${activeOwner.sessionId}); terminal-state=${snap.state}`,
						)
					}
				}
			}
			// ACT-CLINEMM-POST-CONSUMPTION-COMPLETION-AUTHORITY01:
			// Path C' — drain the non-notify terminal observation
			// EVEN when `snap.state === "containment_failed"`. The
			// `vscode-run-commands-tool.ts:892-912` non-notify record
			// path registers the observation UNCONDITIONALLY for
			// every terminal state, including containment_failed.
			// Path B above keeps the containment_failed exclusion
			// because the notify=true wake has no listener for that
			// terminal class (the wake consumer remains the
			// load-bearing authority for notify=true
			// containment_failed jobs). The non-notify observation,
			// however, has no parallel wake — the owning agent MUST
			// observe the terminal fact (the BCB01 §0.1 second
			// conjunct) before completion can commit. Without this
			// branch the live chronology
			// (HALT_POST_CONSUMPTION_COMPLETION_AUTHORITY) shows
			// the BCB barrier held forever on
			// `unconsumedOwnedTerminalResultsForC10 > 0` for the
			// held containment_failed job, and the second
			// `submit_and_exit` never reaches
			// `task_completion_committed`.
			//
			// Owner-mismatch check is enforced by
			// `BackgroundNotifyCoordinator.consumeNonNotifyTerminalObservation`
			// (same as Path C above).
			if (options.backgroundNotifyCoordinator && options.resolveActiveOwner && snap.state === "containment_failed") {
				const activeOwner = options.resolveActiveOwner()
				if (activeOwner) {
					if (!options.backgroundNotifyCoordinator.hasActiveNotify(typed.jobId)) {
						options.backgroundNotifyCoordinator.consumeNonNotifyTerminalObservation({
							jobId: typed.jobId,
							sessionId: activeOwner.sessionId,
							taskId: activeOwner.taskId,
						})
						Logger.warn(
							`[command_status] Path C' drained non-notify terminal observation for containment_failed jobId=${typed.jobId} (session=${activeOwner.sessionId})`,
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
					// ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01
					// (H1): when the originating turn attempted a
					// notify-owned blocking wait, signal that the wake
					// owns terminal completion. The model MUST NOT call
					// `submit_and_exit` claiming this jobId's terminal
					// result; the wake will provide the terminal result.
					...(suppressPathB ? { notification: "pending" as const } : {}),
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
