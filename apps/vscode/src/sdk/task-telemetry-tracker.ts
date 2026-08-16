/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A
 *
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION02:
 *  - `recoveryFailures` renamed to `recoveryBudgetFailures` on the
 *    wire (faithful to `episodeFailures`' actual bounded-recovery
 *    semantics, not "all recoverable failures").
 *  - Terminal freeze is now reopenable: `streaming` /
 *    `awaiting_approval` on the same task clears `endedAt` so a
 *    same-task follow-up resumes ticking. "First terminal wins"
 *    means "first terminal within the current stopped interval".
 *
 * Host-owned task telemetry accumulator.
 *
 * Tracks three cumulative metrics for the **visible task** (the one the
 * TaskHeader renders):
 *
 *   1. Elapsed time — derived from `startedAt` (and frozen `endedAt`
 *      during a stopped interval; cleared on same-task continuation).
 *   2. Tool-call count — incremented exactly once per canonical
 *      `tool-started` runtime event.
 *   3. Recovery-budget-failure count — incremented by the positive
 *      delta clamp of `RecoverySnapshot.episodeFailures`. This is a
 *      bounded-recovery episode-budget metric, not a total of all
 *      recoverable tool failures; the wire name and tooltip reflect
 *      that. (NB: deliberately NOT named "control-plane" — control
 *      plane outcomes are a separate thing entirely: host DENY,
 *      user_rejected, runtime_skipped, runtime_aborted. This metric
 *      is a recovery-policy budget counter.)
 *
 * The tracker is a pure OBSERVER. It NEVER reads or modifies recovery
 * policy, tool-execution gating, or turn-phase transitions. It has no
 * outbound effect on the runtime — only an inbound read on the event
 * stream the host already subscribes to.
 *
 * Lifetime semantics:
 *
 *   - A new task identity resets all counters and re-stamps `startedAt`.
 *   - Follow-ups on the same visible task keep the original `startedAt`
 *     (and accumulate counters).
 *   - Webview reconnect / React remount does NOT reset: the tracker is
 *     host-owned and persists across `getStateToPostToWebview` calls.
 *   - The tracker's `get()` is a pure snapshot — no allocation, no
 *     React coupling.
 *
 * Terminal-phase freeze (CORRECTION02 reopenable):
 *
 *   - `error` / `resumable` / `completed` transitions on the
 *     `TurnStateTracker` call `observeTurnPhase` and freeze `endedAt`
 *     at the FIRST occurrence within the current stopped interval
 *     (idempotent).
 *   - `streaming` / `awaiting_approval` transitions on the SAME task
 *     clear `endedAt` so the clock resumes ticking. This covers
 *     `askResponse()` follow-ups, `reinitExistingTaskFromId()`
 *     resumes, and retry-after-error flows — all of which are
 *     same-task continuations.
 *   - `awaiting_followup` does NOT freeze — the agent is paused
 *     waiting for user input, but the same visible task continues once
 *     the user replies, so the elapsed clock keeps ticking to
 *     represent "task duration since creation".
 *
 * Privacy: emits nothing more than bounded integers and timestamps.
 */
import type { AgentRuntimeRecoverySnapshot } from "@cline/shared"
import type { TaskHeaderTelemetryStrip } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"

/**
 * Phases that freeze the elapsed clock. `awaiting_followup` is NOT in
 * this set — the same task continues when the user replies.
 */
const TERMINAL_PHASES = new Set(["error", "resumable", "completed"])

/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION02:
 *
 * Phases that REOPEN the elapsed clock on the same task. These are
 * the active-task phases — when the agent is being driven again on
 * the same task identity, the previously frozen `endedAt` is cleared
 * so the clock resumes ticking while preserving `startedAt` and the
 * cumulative counters.
 */
const CONTINUATION_PHASES = new Set(["streaming", "awaiting_approval"])

/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01:
 *
 * The chosen authority for the bounded-recovery episode-budget UI
 * metric. Note that this is NOT the same as "every recoverable tool
 * failure observed during this task" — `episodeFailures` only
 * increments while the recovery second stage is `idle`. Once the
 * second stage is `armed` or `terminating`, additional recoverable
 * failures do not increment it (the bounded-continuation turn is
 * consumed but not counted). The wire field is therefore
 * `recoveryBudgetFailures` (see CORRECTION02).
 *
 * Why this single authority and not the other recovery counters:
 *
 * - `currentRepairAttempts` describes family-level pressure; it can
 *   be non-zero even when no individual tool call failed in this
 *   episode (a family may be in a long retry loop driven by
 *   transient downstream errors that the model eventually succeeds
 *   on). Including it in the same metric as `episodeFailures` would
 *   double-count the same recovery fact.
 *
 * - `circuitNoticeCount` is a bounded-recovery exhaustion notice — a
 *   LATER consequence of the same failure that already incremented
 *   `episodeFailures`, not an independent intervention.
 */
function readEpisodeFailures(recovery: AgentRuntimeRecoverySnapshot): number {
	return recovery.episodeFailures
}

/**
 * Monotone clamp on `episodeFailures`. A decrease (episode reset on a
 * new family) does not subtract; only forward jumps accumulate. This
 * keeps a task-lifetime cumulative count of the bounded-recovery
 * episode-budget counter across the lifetime of the visible task.
 */
function countRecoveryDelta(prev: number, next: number): number {
	if (next > prev) {
		return next - prev
	}
	return 0
}

export class TaskTelemetryTracker {
	private currentTaskId: string | undefined
	private startedAt: number | undefined
	private endedAt: number | undefined
	private toolCalls = 0
	private recoveryBudgetFailures = 0
	private prevEpisodeFailures = 0

	/**
	 * Start (or re-start) a task's telemetry window.
	 *
	 * - First call ever: stamp `startedAt = Date.now()` for the new task.
	 * - Same task identity as the prior window: do nothing — follow-ups
	 *   on the same visible task must keep accumulating against the
	 *   original start. The `recovery-snapshot` baseline is preserved so
	 *   intra-task recovery counters are NOT zeroed out.
	 * - Different task identity: full reset; stamp a fresh `startedAt`,
	 *   zero all counters, and reset the recovery baseline so the new
	 *   task's positive deltas are measured against its own zero.
	 */
	startTask(taskId: string, startedAt?: number): TaskHeaderTelemetryStrip | undefined {
		const now = startedAt ?? Date.now()
		if (this.currentTaskId === taskId) {
			return this.get()
		}
		this.currentTaskId = taskId
		this.startedAt = now
		this.endedAt = undefined
		this.toolCalls = 0
		this.recoveryBudgetFailures = 0
		this.prevEpisodeFailures = 0
		return this.get()
	}

	/**
	 * Freeze the task at a terminal phase. Idempotent: the FIRST call
	 * after `startTask` stamps `endedAt`; later calls are no-ops.
	 *
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01:
	 * `cancelTask()` may still call this directly to ensure the clock
	 * freezes at cancellation time even before the turn coordinator
	 * transitions to `resumable` (defensive; the turn-state subscription
	 * is the canonical observer).
	 *
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION02:
	 * this primitive is still correct for the cancel-fence path, but
	 * for same-task continuation (user reply on a `completed` task)
	 * the canonical seam is now `observeTurnPhase("streaming")`,
	 * which clears `endedAt` instead of stamping it.
	 */
	endTask(endedAt?: number): TaskHeaderTelemetryStrip | undefined {
		if (this.currentTaskId === undefined) {
			return this.get()
		}
		if (this.endedAt === undefined) {
			this.endedAt = endedAt ?? Date.now()
		}
		return this.get()
	}

	/**
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION02:
	 *
	 * Canonical turn-phase observer. Called from the
	 * `TurnStateTracker.subscribe` hook whenever the UI phase changes.
	 *
	 *  - Terminal phases (`error` / `resumable` / `completed`) freeze
	 *    the elapsed clock at the FIRST occurrence within the current
	 *    stopped interval (idempotent).
	 *  - Active-task phases (`streaming` / `awaiting_approval`) clear
	 *    `endedAt` to reopen the clock — the same visible task is
	 *    being driven again (a user reply on a `completed` task, a
	 *    resume on a `resumable` task, a retry on an `error` task).
	 *    `startedAt` and the cumulative counters are preserved.
	 *  - The other non-terminal phases (`idle` / `awaiting_followup`)
	 *    leave `endedAt` alone. `idle` only appears when no task is
	 *    active (the tracker is already cleared); `awaiting_followup`
	 *    was deliberately not frozen in CORRECTION01 and likewise
	 *    should not unfreeze.
	 *
	 * "First terminal wins" therefore means: first terminal
	 * transition within the CURRENT stopped interval. A subsequent
	 * active-task transition reopens the interval, and a further
	 * terminal transition freezes again with the new anchorTs.
	 */
	observeTurnPhase(phase: string, anchorTs?: number): TaskHeaderTelemetryStrip | undefined {
		if (this.currentTaskId === undefined) {
			return this.get()
		}
		if (TERMINAL_PHASES.has(phase)) {
			if (this.endedAt === undefined) {
				this.endedAt = anchorTs ?? Date.now()
			}
		} else if (CONTINUATION_PHASES.has(phase)) {
			// Same-task continuation: unfreeze the elapsed clock while
			// preserving startedAt and the cumulative counters.
			this.endedAt = undefined
		}
		return this.get()
	}

	/**
	 * Clear all telemetry (called when no task is active).
	 */
	clear(): TaskHeaderTelemetryStrip | undefined {
		this.currentTaskId = undefined
		this.startedAt = undefined
		this.endedAt = undefined
		this.toolCalls = 0
		this.recoveryBudgetFailures = 0
		this.prevEpisodeFailures = 0
		return this.get()
	}

	/**
	 * Record a canonical `tool-started` runtime event.
	 *
	 * Idempotent across parallel siblings: two parallel tools count as
	 * two `tool-started` events, each incrementing the counter by one.
	 */
	recordToolStarted(): TaskHeaderTelemetryStrip | undefined {
		if (this.currentTaskId === undefined) {
			Logger.debug("[TaskTelemetryTracker] recordToolStarted called before startTask; ignored")
			return this.get()
		}
		this.toolCalls += 1
		return this.get()
	}

	/**
	 * Observe a recovery snapshot from the runtime.
	 *
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01:
	 * Only `episodeFailures` is folded into the cumulative counter.
	 * `currentRepairAttempts` and `circuitNoticeCount` are tracked on
	 * the runtime side but are NOT projected to the UI metric because
	 * they describe overlapping consequences of the same recoverable
	 * failure (family pressure / bounded-exhaustion notices), not
	 * independent interventions.
	 *
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION02:
	 * `episodeFailures` is itself a bounded-recovery episode-budget
	 * metric — it only increments while the recovery second stage is
	 * `idle` and stops growing once it is `armed` or `terminating`.
	 * (Deliberately described as an "episode-budget metric", NOT a
	 * "control-plane metric": control-plane outcomes are
	 * host-policy / user / runtime / aborted categorical outcomes,
	 * which are explicitly excluded from this UI metric.)
	 * The wire field is therefore renamed from `recoveryFailures` to
	 * `recoveryBudgetFailures`, and the tooltip / metadata describe
	 * it as "failures counted toward bounded-recovery episode limits"
	 * rather than "recoverable tool failures observed", which would
	 * overclaim what the counter actually represents.
	 */
	observeRecovery(recovery: AgentRuntimeRecoverySnapshot): TaskHeaderTelemetryStrip | undefined {
		const next = readEpisodeFailures(recovery)
		if (this.currentTaskId === undefined) {
			this.prevEpisodeFailures = next
			return this.get()
		}
		this.recoveryBudgetFailures += countRecoveryDelta(this.prevEpisodeFailures, next)
		this.prevEpisodeFailures = next
		return this.get()
	}

	/**
	 * Pure snapshot of the current telemetry state. Returns
	 * `undefined` when no task has ever been started.
	 */
	get(): TaskHeaderTelemetryStrip | undefined {
		if (this.currentTaskId === undefined || this.startedAt === undefined) {
			return undefined
		}
		return {
			startedAt: this.startedAt,
			...(this.endedAt !== undefined ? { endedAt: this.endedAt } : {}),
			toolCalls: this.toolCalls,
			recoveryBudgetFailures: this.recoveryBudgetFailures,
		}
	}

	/**
	 * Current task identity (test hook).
	 */
	get currentTask(): string | undefined {
		return this.currentTaskId
	}
}
