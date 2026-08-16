/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A
 *
 * Host-owned task telemetry accumulator.
 *
 * Tracks three cumulative metrics for the **visible task** (the one the
 * TaskHeader renders):
 *
 *   1. Elapsed time — derived from `startedAt` (and frozen `endedAt`).
 *   2. Tool-call count — incremented exactly once per canonical
 *      `tool-started` runtime event.
 *   3. Recovery-failure count — incremented by the positive-delta
 *      clamp of `RecoverySnapshot.episodeFailures` only.
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
 * Terminal-phase freeze:
 *
 *   - `error` / `resumable` / `completed` transitions on the
 *     `TurnStateTracker` call `endTask()` exactly once (the FIRST
 *     terminal transition freezes the clock; later transitions are
 *     idempotent). `awaiting_followup` does NOT freeze — the agent
 *     is paused waiting for user input, but the same visible task
 *     continues once the user replies, so the elapsed clock must keep
 *     ticking to represent "task duration since creation".
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
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01:
 *
 * The single canonical recovery counter we fold into the UI metric.
 * `currentRepairAttempts` describes family-level pressure; it can be
 * non-zero even when no individual tool call failed in this episode
 * (a family may be in a long retry loop driven by transient
 * downstream errors that the model eventually succeeds on). Including
 * it in the same metric as `episodeFailures` would double-count
 * the same recovery fact.
 *
 * `circuitNoticeCount` is a bounded-recovery exhaustion notice — a
 * LATER consequence of the same failure that already incremented
 * `episodeFailures`, not an independent intervention.
 *
 * The only counter that uniquely captures "an additional recoverable
 * tool failure was observed during this task" is `episodeFailures`.
 */
function readEpisodeFailures(recovery: AgentRuntimeRecoverySnapshot): number {
	return recovery.episodeFailures
}

/**
 * Monotone clamp on the single `episodeFailures` counter. A decrease
 * (episode reset on a new family) does not subtract; only forward
 * jumps accumulate. This preserves family-success resets as not
 * interventions, while keeping a task-lifetime cumulative count of
 * recoverable-failure observations.
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
	private recoveryFailures = 0
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
		this.recoveryFailures = 0
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
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01:
	 *
	 * Canonical terminal-phase observer. Called from the
	 * `TurnStateTracker.subscribe` hook whenever the UI phase changes.
	 * Only the terminal phases (`error` / `resumable` / `completed`)
	 * freeze the elapsed clock; other phases (including
	 * `awaiting_followup`) are ignored.
	 *
	 * The freeze is idempotent (the FIRST terminal call wins), so even
	 * if `cancelTask()` has already called `endTask()` and then the
	 * turn coordinator later sets `resumable`, the original
	 * cancellation timestamp is preserved.
	 */
	observeTurnPhase(phase: string, anchorTs?: number): TaskHeaderTelemetryStrip | undefined {
		if (!TERMINAL_PHASES.has(phase)) {
			return this.get()
		}
		if (this.currentTaskId === undefined) {
			return this.get()
		}
		if (this.endedAt === undefined) {
			this.endedAt = anchorTs ?? Date.now()
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
		this.recoveryFailures = 0
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
	 */
	observeRecovery(recovery: AgentRuntimeRecoverySnapshot): TaskHeaderTelemetryStrip | undefined {
		const next = readEpisodeFailures(recovery)
		if (this.currentTaskId === undefined) {
			this.prevEpisodeFailures = next
			return this.get()
		}
		this.recoveryFailures += countRecoveryDelta(this.prevEpisodeFailures, next)
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
			recoveryFailures: this.recoveryFailures,
		}
	}

	/**
	 * Current task identity (test hook).
	 */
	get currentTask(): string | undefined {
		return this.currentTaskId
	}
}
