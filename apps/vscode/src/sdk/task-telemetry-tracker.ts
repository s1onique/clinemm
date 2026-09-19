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
 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01:
 *  - Adds a fourth cumulative metric: `runtimeErrorCount`, the number
 *    of structured ClineMM runtime error incidents attributable to
 *    the current visible task session (EPERM during process-tree
 *    termination, EACCES, ENOENT, spawn failure, helper IPC failure,
 *    bounded subprocess timeout, …). The webview renders this as a
 *    compact "⚠ N" glyph next to the existing recovery-interventions
 *    strip.
 *  - Monotonic within a task, resets only on new task identity,
 *    saturates at `Number.MAX_SAFE_INTEGER` (so a runaway burst can
 *    never wrap). The increment is a pure observer operation — no
 *    React coupling, no functional updater side effects, no log
 *    scraping.
 *
 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01-CORRECTION01:
 *  - Narrows the contract from "task-scoped" to "current visible
 *    task session". Concretely: `startTask(newId)` is destructive —
 *    the previous task's count is NOT retained, and a subsequent
 *    `startTask` to a previously-incident-bearing task starts at 0.
 *    This matches the existing pattern of every other counter on
 *    this tracker (`toolCalls`, `recoveryBudgetFailures`,
 *    `prevEpisodeFailures`, `mechanism`): they all reset on a new
 *    task identity and there is no per-id cache. The tracker is a
 *    single session-global instance owned by the SdkController for
 *    the controller's lifetime; durable task telemetry lives in
 *    `state.ts` / `taskHistory.json`, which currently does NOT
 *    project this counter. REC-06 (unit) and REC-BE-13 (composition)
 *    pin this contract.
 *
 * Host-owned task telemetry accumulator.
 *
 * Tracks four cumulative metrics for the **visible task** (the one the
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
 *   4. Runtime-error count — incremented by `recordRuntimeError()`
 *      exactly once per structured ClineMM runtime error incident
 *      attributable to the current task. Helper-recovery success does
 *      NOT subtract: an EPERM that was successfully resolved by the
 *      LaunchAgent fallback still counts as a runtime incident
 *      (the user-visible "this task hit a runtime error" fact).
 *      Expected control-flow errno (e.g. ESRCH from a
 *      `kill(-pgid, 0)` probe on an already-departed group) is
 *      filtered at the call site and never reaches the recorder.
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
import type { RuntimeErrorIncident, TaskHeaderTelemetryStrip, ToolMechanismSummary } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { recordMechanism as accumulateMechanism, emptyMechanismSummary } from "./tool-mechanism-classifier"

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
	// ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01:
	// bounded mechanism projection (edit / command / search / read / mcp /
	// other) derived from the canonical toolName of every `tool-started`
	// runtime event. `total` in this summary is conserved against the
	// `toolCalls` counter; see the TES-IMPL-01 contract.
	private mechanism: ToolMechanismSummary = emptyMechanismSummary()
	// ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01: cumulative count of
	// structured ClineMM runtime error incidents attributable to the
	// current task. Saturates at `Number.MAX_SAFE_INTEGER` so a runaway
	// burst (e.g. a busy-loop helper-fallback race) cannot wrap to a
	// negative or lossy integer. The field is added to the wire strip
	// only when non-zero (see `get()`); the webview treats absence as
	// zero, so a Hub/Remote host that hasn't projected the field yet
	// still renders a clean header.
	private runtimeErrorCount = 0
	// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
	// Live ownership gauge — number of ClineMM-owned command
	// containment units currently alive. Set by the host via
	// `recordActiveCommandJobs(n)` whenever the
	// CommandJobManager's active map changes. Saturates at MAX_SAFE
	// like the runtime-error counter; the wire emits only when > 0
	// (see `get()`).
	private activeCommandJobs = 0

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
		this.mechanism = emptyMechanismSummary()
		// ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01: zero the
		// runtime-error counter on a new task identity. Same-task
		// continuation preserves it (the early-return above); only a
		// different task id resets it. This is the load-bearing
		// branch for TASK_ERROR_COUNTER_ISOLATION.
		//
		// ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01-CORRECTION01:
		// this is also where the "current visible task session"
		// contract is enforced destructively. A subsequent
		// startTask() to a previously-incident-bearing task id will
		// start at 0 (no per-id cache). REC-06 + REC-BE-13 pin this.
		this.runtimeErrorCount = 0
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
		// zero the live ownership gauge on a new task identity —
		// same-task continuation preserves it.
		this.activeCommandJobs = 0
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
		this.mechanism = emptyMechanismSummary()
		this.runtimeErrorCount = 0
		return this.get()
	}

	/**
	 * Record a canonical `tool-started` runtime event.
	 *
	 * Idempotent across parallel siblings: two parallel tools count as
	 * two `tool-started` events, each incrementing the counter by one.
	 *
	 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01:
	 * This overload retains the legacy no-arg signature for backwards
	 * compatibility (existing tests assert `recordToolStarted()`
	 * directly). The production seam is
	 * `recordToolStartedWithName(toolName)` (wired from
	 * `SdkController.onToolStarted` once the runtime hands us the
	 * canonical `AgentContentStartEvent`); callers without a
	 * toolName still get the cumulative `toolCalls` increment and
	 * contribute to the `other` mechanism bucket so the projection
	 * stays conserved.
	 */
	recordToolStarted(): TaskHeaderTelemetryStrip | undefined {
		return this.recordToolStartedWithName(undefined)
	}

	/**
	 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01:
	 *
	 * Production seam: record a canonical `tool-started` runtime event
	 * with its `toolName` (the structured identity on the
	 * `AgentContentStartEvent`). Increments the cumulative
	 * `toolCalls` counter AND the matching mechanism bucket in the
	 * `mechanism` summary. Conservation holds:
	 *
	 *   mechanism.total === toolCalls === sum(mechanism buckets)
	 *
	 * If the tracker has no active task (`currentTaskId === undefined`)
	 * the call is logged and dropped — mirrors the pre-existing
	 * defensive behavior of `recordToolStarted()` so we never
	 * fabricate counts against an unowned task identity.
	 */
	recordToolStartedWithName(toolName: string | undefined): TaskHeaderTelemetryStrip | undefined {
		if (this.currentTaskId === undefined) {
			Logger.debug("[TaskTelemetryTracker] recordToolStartedWithName called before startTask; ignored")
			return this.get()
		}
		this.toolCalls += 1
		this.mechanism = accumulateMechanism(this.mechanism, toolName)
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
	 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01:
	 *
	 * Production seam: record one structured ClineMM runtime error
	 * incident attributable to the current task. Increments the
	 * cumulative `runtimeErrorCount` by exactly 1; saturates at
	 * `Number.MAX_SAFE_INTEGER` so a runaway burst (e.g. a busy-loop
	 * helper-fallback race) cannot wrap to a negative or lossy integer.
	 *
	 * Identity contract:
	 *
	 *   - Monotonic within a task. NEVER decremented.
	 *   - Resets to 0 ONLY on a new task identity (`startTask` with a
	 *     different id than the current one). It is NOT reset by
	 *     `endTask`, by `observeTurnPhase`, by helper recovery success,
	 *     by retry, by UI collapse/expand, or by webview reload.
	 *   - When the tracker has no active task (`currentTaskId ===
	 *     undefined`) the call is logged and dropped — mirrors the
	 *     pre-existing defensive behavior of `recordToolStarted()` so
	 *     we never fabricate counts against an unowned task identity.
	 *
	 * V1 cardinality rule:
	 *
	 *   "ONE RUNTIME INCIDENT → AT MOST ONE COUNT INCREMENT."
	 *
	 * Call sites are responsible for:
	 *
	 *   1. Filtering out expected control-flow errno (e.g. ESRCH from
	 *      a `kill(-pgid, 0)` probe on an already-departed group;
	 *      `DENY_LEADER_NOT_FOUND` from a helper "already gone"
	 *      response) BEFORE calling this method.
	 *   2. Filtering out ordinary nonzero command exits (the child
	 *      process itself decided to fail; the runtime behaved
	 *      correctly). A failing test or build is NOT a ClineMM
	 *      runtime error.
	 *   3. NOT calling this method multiple times for one logical
	 *      incident. The TERM→KILL escalation on the same process tree
	 *      that hit EPERM is ONE incident; calling twice here would
	 *      inflate the user-visible "⚠ N" counter.
	 *
	 * The structured payload (`errorClass`, `source`,
	 * `correlationId`) is captured for forensic / future-details-UI
	 * purposes but is NOT projected to the wire in V1 — the counter
	 * is the only thing the webview renders. Logging the full
	 * classification at INFO preserves future inspectability without
	 * expanding the wire surface.
	 */
	recordRuntimeError(incident: RuntimeErrorIncident): TaskHeaderTelemetryStrip | undefined {
		if (this.currentTaskId === undefined) {
			Logger.debug(
				`[TaskTelemetryTracker] recordRuntimeError called before startTask; ignored (class=${incident.errorClass}, source=${incident.source})`,
			)
			return this.get()
		}
		// Saturate at Number.MAX_SAFE_INTEGER rather than wrap. We
		// use `Math.min` against the next value so a burst that would
		// otherwise overflow stays bounded and the user-visible
		// counter remains accurate (e.g. ⚠ 9007199254740991 is still
		// "a very large number of incidents", not a wrap to a
		// negative or lossy integer).
		if (this.runtimeErrorCount < Number.MAX_SAFE_INTEGER) {
			this.runtimeErrorCount = Math.min(this.runtimeErrorCount + 1, Number.MAX_SAFE_INTEGER)
		}
		Logger.info(
			`[TaskTelemetryTracker] runtime error recorded (class=${incident.errorClass}, source=${incident.source}, correlationId=${incident.correlationId ?? "<none>"}, cumulative=${this.runtimeErrorCount})`,
		)
		return this.get()
	}

	/**
	 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01:
	 *
	 * Read-only test seam that exposes the current cumulative count
	 * WITHOUT requiring a task identity. Returns 0 when no task is
	 * active. Mirrors the same defensive pattern as `recordToolStarted`
	 * (which returns `this.get()` rather than the raw count) so
	 * callers don't reach into private state.
	 */
	get currentRuntimeErrorCount(): number {
		return this.runtimeErrorCount
	}

	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
	 *
	 * Update the live ownership gauge. Called by the host whenever
	 * the CommandJobManager's active map changes (i.e. on every
	 * `start()` and every `finalize()`). Saturates at
	 * `Number.MAX_SAFE_INTEGER` so a runaway burst cannot wrap.
	 *
	 * When no task is active the call is logged and dropped,
	 * mirroring the existing defensive pattern for runtime-error
	 * recording (the tracker never fabricates counts against an
	 * unowned task identity).
	 *
	 * @param count the new gauge value (must be >= 0; non-finite
	 * values are clamped to 0).
	 */
	recordActiveCommandJobs(count: number): TaskHeaderTelemetryStrip | undefined {
		if (this.currentTaskId === undefined) {
			Logger.debug(`[TaskTelemetryTracker] recordActiveCommandJobs called before startTask; ignored (count=${count})`)
			return this.get()
		}
		const safe = typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : 0
		this.activeCommandJobs = Math.min(safe, Number.MAX_SAFE_INTEGER)
		return this.get()
	}

	/**
	 * Read-only test seam that exposes the current live ownership
	 * gauge WITHOUT requiring a task identity. Returns 0 when no
	 * task is active. Mirrors `currentRuntimeErrorCount`.
	 */
	get currentActiveOwnedCommandJobs(): number {
		return this.activeCommandJobs
	}

	/**
	 * Pure snapshot of the current telemetry state. Returns
	 * `undefined` when no task has ever been started.
	 *
	 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01: `runtimeErrorCount`
	 * is emitted ONLY when > 0 (uses the same spread-conditional
	 * pattern as `endedAt`). The webview treats absence as zero, so a
	 * zero-task state (and a Hub/Remote host that hasn't projected
	 * the field) renders a clean header with no "⚠" glyph.
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
			// ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01:
			// the per-mechanism cumulative projection. Webview renders
			// it as the compact `🔧N · ✏️E · >_C · 👁R · 🔍S · 🔌M · ❓O`
			// strip when present; Hub/Remote hosts that have not yet
			// received the new field simply omit it from the strip.
			mechanism: this.mechanism,
			// ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01: cumulative
			// structured runtime error incidents. Emitted only when > 0
			// so the wire strip stays minimal in the common (zero-error)
			// case and Hub/Remote hosts that haven't projected the field
			// still render cleanly (they simply omit it; the webview
			// normalizes absence to zero at the TaskHeader seam).
			...(this.runtimeErrorCount > 0 ? { runtimeErrorCount: this.runtimeErrorCount } : {}),
			// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
			// live ownership gauge. Emitted only when > 0; webview
			// renders `⎇ N` in the telemetry strip when this field is
			// present. Conservation invariant: terminal task/job
			// implies activeCommandJobs === 0.
			...(this.activeCommandJobs > 0 ? { activeCommandJobs: this.activeCommandJobs } : {}),
		}
	}

	/**
	 * Current task identity (test hook).
	 */
	get currentTask(): string | undefined {
		return this.currentTaskId
	}
}
