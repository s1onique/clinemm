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
 *   3. Recovery-intervention count — incremented by the positive-delta
 *      clamp of `RecoverySnapshot.tracker.currentRepairAttempts`,
 *      `episodeFailures`, and `circuitNoticeCount`.
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
 * Privacy: emits nothing more than bounded integers and timestamps.
 */
import type { AgentRuntimeRecoverySnapshot } from "@cline/shared"
import type { TaskHeaderTelemetryStrip } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"

/**
 * The three externally-meaningful counters we fold into the cumulative
 * recovery-interventions count. See `countRecoveryDelta`.
 */
interface RecoveryCounters {
	currentRepairAttempts: number
	episodeFailures: number
	circuitNoticeCount: number
}

function readRecoveryCounters(recovery: AgentRuntimeRecoverySnapshot): RecoveryCounters {
	return {
		currentRepairAttempts: recovery.tracker.currentRepairAttempts,
		episodeFailures: recovery.episodeFailures,
		circuitNoticeCount: recovery.circuitNoticeCount,
	}
}

/**
 * Sum the positive-delta across the three counters (a clamp, not a
 * sum: a counter that DECREASES does not subtract). This protects the
 * UI against transient counter resets that happen when a family
 * succeeds (`resetActiveFamily` zeroes `currentRepairAttempts`) — those
 * resets are NOT interventions to display, only the FORWARD jumps are.
 */
function countRecoveryDelta(prev: RecoveryCounters, next: RecoveryCounters): number {
	let delta = 0
	if (next.currentRepairAttempts > prev.currentRepairAttempts) {
		delta += next.currentRepairAttempts - prev.currentRepairAttempts
	}
	if (next.episodeFailures > prev.episodeFailures) {
		delta += next.episodeFailures - prev.episodeFailures
	}
	if (next.circuitNoticeCount > prev.circuitNoticeCount) {
		delta += next.circuitNoticeCount - prev.circuitNoticeCount
	}
	return delta
}

export class TaskTelemetryTracker {
	private currentTaskId: string | undefined
	private startedAt: number | undefined
	private endedAt: number | undefined
	private toolCalls = 0
	private recoveryInterventions = 0
	private prevRecovery: RecoveryCounters = {
		currentRepairAttempts: 0,
		episodeFailures: 0,
		circuitNoticeCount: 0,
	}

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
		this.recoveryInterventions = 0
		this.prevRecovery = {
			currentRepairAttempts: 0,
			episodeFailures: 0,
			circuitNoticeCount: 0,
		}
		return this.get()
	}

	/**
	 * Freeze the task at a terminal phase. Idempotent.
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
	 * Clear all telemetry (called when no task is active).
	 */
	clear(): TaskHeaderTelemetryStrip | undefined {
		this.currentTaskId = undefined
		this.startedAt = undefined
		this.endedAt = undefined
		this.toolCalls = 0
		this.recoveryInterventions = 0
		this.prevRecovery = {
			currentRepairAttempts: 0,
			episodeFailures: 0,
			circuitNoticeCount: 0,
		}
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
	 * Folds the positive deltas of the three externally-meaningful
	 * counters into the cumulative `recoveryInterventions`.
	 */
	observeRecovery(recovery: AgentRuntimeRecoverySnapshot): TaskHeaderTelemetryStrip | undefined {
		if (this.currentTaskId === undefined) {
			this.prevRecovery = readRecoveryCounters(recovery)
			return this.get()
		}
		const next = readRecoveryCounters(recovery)
		this.recoveryInterventions += countRecoveryDelta(this.prevRecovery, next)
		this.prevRecovery = next
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
			recoveryInterventions: this.recoveryInterventions,
		}
	}

	/**
	 * Current task identity (test hook).
	 */
	get currentTask(): string | undefined {
		return this.currentTaskId
	}
}
