/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01
 *
 * Authoritative task-duration accounting.
 *
 * The module is a PURE, interval-based accumulator. It is owned by the
 * host-side `TaskTelemetryTracker` (which is already wired to the
 * authoritative `TurnStateTracker` lifecycle owner in production) and
 * is driven by the same authoritative `TurnPhase` transition stream.
 *
 * Why interval-based and not `now - startedAt`:
 *
 *   The TaskHeader already exposes a wall-clock "elapsed" number. That
 *   number cannot answer the question this ACT exists to answer:
 *   "how much of this task's duration was the agent actually working?"
 *   A task that spent three hours blocked on a human question and one
 *   hour executing is indistinguishable from a task that executed for
 *   four hours straight — which is exactly the comparison the elapsed
 *   number is being used for and cannot support.
 *
 *   To classify the elapsed time, the accumulator must know the
 *   category of EVERY interval. The authoritative source of that
 *   category is the runtime phase at the time. So the accumulator
 *   closes one interval per phase transition and opens the next one.
 *   The sum of the closed intervals is the elapsed time; the sum per
 *   category is the active / waiting / unknown split.
 *
 *   A side effect of the interval model is that the dormant gap
 *   between a terminal write and a later continuation write belongs to
 *   NO interval — so it is excluded from the totals, which is the
 *   epoch semantics the ACT requires.
 *
 * Conservation invariant (exact, at the accumulator's own precision):
 *
 *   elapsedMs === activeMs + waitingMs + unknownMs
 *
 * and every component is a finite, non-negative integer.
 *
 * Clock authority:
 *
 *   Interval arithmetic uses a MONOTONIC clock. A wall-clock
 *   adjustment (NTP step, DST, user changing the system clock) can
 *   therefore never produce a negative duration, and no duration is
 *   ever computed by subtracting timestamps from unrelated clock
 *   origins.
 *
 *   The clock is INJECTABLE so the deterministic tests can drive an
 *   exact synthetic chronology without sleeping. The default is the
 *   host's monotonic time source.
 *
 * Discontinuity handling:
 *
 *   When the monotonic clock is observed to move BACKWARDS, the
 *   interval is NOT silently classified as ACTIVE or WAITING. The
 *   snapshot's coverage is downgraded to "partial" and no numeric
 *   duration is invented for the gap.
 *
 * Persistence:
 *
 *   The persisted form is the accumulated totals plus a wall-clock
 *   anchor — never a process-local monotonic timestamp, which is not
 *   transferable across processes. See `TaskDurationSnapshot` for the
 *   exact wire shape.
 */
import type { TaskDurationSnapshot, TaskDurationWaitingReason, TurnPhase } from "@shared/ExtensionMessage"

/**
 * The category an interval belongs to.
 *
 * `active`   — the agent is progressing automatically (or awaiting a
 *               dependency required for automatic progression).
 * `waiting`  — automatic progression is blocked by a human decision
 *               or input.
 * `unknown`  — the interval could not be classified from
 *               authoritative runtime evidence.
 * `terminal` — the task reached a terminal state; totals are frozen.
 */
export type TaskDurationCategory = "active" | "waiting" | "unknown" | "terminal"

/**
 * The phase -> category mapping. This is the ACT's semantic contract
 * applied to the ACTUAL runtime phases, and it is the ONLY place the
 * mapping lives.
 *
 *   streaming          — model producing content, tool running,
 *                        required background command in flight,
 *                        automatic retry / backoff, runtime
 *                        orchestration. -> ACTIVE
 *   compacting         — automatic compaction / PCK / R2 processing.
 *                        An internal SYSTEM transition owns the next
 *                        progress step; no user action is actionable
 *                        while it runs. -> ACTIVE
 *   awaiting_approval  — a human tool approval is pending. -> WAITING
 *   awaiting_followup  — the agent yielded awaiting the user's
 *                        answer. -> WAITING
 *   resumable          — the task is parked until a human resumes
 *                        it. -> WAITING
 *   idle               — no active turn. Not an execution interval.
 *   completed / error  — terminal. -> terminal freeze
 *
 * `resumable` appears in BOTH the WAITING and the terminal rows: it is
 * WAITING as a held state (the task is parked until a human resumes
 * it) and terminal as a write (the write itself closes the interval).
 * The interval that ENDS at the write is classified by the phase that
 * was live BEFORE it; the phase itself opens the next interval. This
 * mirrors the existing "first terminal wins, reopenable" contract of
 * the `endedAt` model and introduces no second terminality notion.
 */
export function classifyTurnPhase(phase: TurnPhase): TaskDurationCategory {
	switch (phase) {
		case "streaming":
		case "compacting":
			return "active"
		case "awaiting_approval":
		case "awaiting_followup":
		case "resumable":
			return "waiting"
		case "error":
			// A terminal ERROR is not the end of the task — it parks the
			// task awaiting a human Retry / Resume decision. Automatic
			// progression is blocked on a human, so the held interval is
			// WAITING (RECOVERY_INTERVENTION), not ACTIVE and not
			// dropped.
			return "waiting"
		case "completed":
			return "terminal"
		case "idle":
		default:
			return "unknown"
	}
}

/**
 * The waiting reason for a phase. Only human-gated phases carry one.
 *
 * The two reserved reasons (`RECOVERY_INTERVENTION`, `OTHER_HUMAN_GATE`)
 * are part of the wire union for forward compatibility but are NOT
 * produced by the current phase set — the ACT does not speculatively
 * implement successor consumers.
 */
export function waitingReasonForPhase(phase: TurnPhase): TaskDurationWaitingReason | undefined {
	switch (phase) {
		case "awaiting_followup":
			return "USER_INPUT"
		case "awaiting_approval":
			return "TOOL_APPROVAL"
		case "resumable":
			return "USER_PAUSE"
		case "error":
			// The task is parked awaiting a human Retry / Resume decision.
			return "RECOVERY_INTERVENTION"
		default:
			return undefined
	}
}

/**
 * A monotonic clock source. Returns milliseconds since an arbitrary
 * but FIXED process-local origin; the value MUST be non-decreasing
 * across calls.
 */
export type MonotonicClock = () => number

/**
 * The default monotonic clock. `performance.now()` is monotonic and
 * unaffected by wall-clock adjustments; `Date.now()` is NOT.
 *
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01 / F6):
 * every fallback reads the clock EXACTLY ONCE per call. The previous
 * `process.hrtime` fallback called `proc.hrtime()` TWICE (once for the
 * seconds component, once for the nanoseconds component) — two separate
 * readings that can straddle a tick boundary and produce a value that
 * is not the reading the caller asked for. A single reading is the only
 * correct form.
 */
export function defaultMonotonicClock(): MonotonicClock {
	if (typeof performance !== "undefined" && typeof performance.now === "function") {
		return () => performance.now()
	}
	// Extremely defensive fallback for hosts without `performance`.
	// `process.hrtime` is monotonic; `Date.now()` is a last resort whose
	// non-monotonicity is handled by the continuity check in
	// `closeInterval` (a backwards step downgrades coverage to
	// "partial" instead of producing a negative duration).
	const proc = globalThis.process
	if (proc && typeof proc.hrtime === "function") {
		// ONE reading, decomposed afterwards.
		return () => {
			const [seconds, nanoseconds] = proc.hrtime()
			return seconds * 1e3 + nanoseconds / 1e6
		}
	}
	return () => Date.now()
}

/**
 * The internal accounting state.
 *
 * Persisted form: the three totals plus the open-interval anchor. The
 * open interval's monotonic anchor is process-local and is NOT
 * transferable across processes.
 */
interface TaskDurationAccumulatorState {
	activeMs: number
	waitingMs: number
	unknownMs: number
	/** The category of the currently-open interval, or undefined when no interval is open. */
	openCategory: TaskDurationCategory | undefined
	/** The monotonic anchor of the currently-open interval. */
	openAnchorMs: number | undefined
	/** The phase that opened the currently-open interval (for the waiting reason). */
	openPhase: TurnPhase | undefined
	/**
	 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01 / W2
	 * R3): the waiting reason CONSERVED from a restored record.
	 *
	 * A restored interval has no live `openPhase` (the phase that opened
	 * it was in a previous process), so the reason is carried
	 * explicitly. It remains correct until a new authoritative
	 * lifecycle transition supersedes it.
	 */
	restoredWaitingReason: TaskDurationWaitingReason | undefined
	/**
	 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01 / W2
	 * R4): whether an authoritative accounting EXISTS for this task.
	 *
	 * A task that was recorded BEFORE the accounting existed (a legacy
	 * task) has NO accounting. Its accumulator holds zeros, but those
	 * zeros are NOT a measurement — they are the absence of a
	 * measurement. Projecting them as a "complete" accounting with a
	 * zero elapsed time would fabricate a historical total that was
	 * never observed.
	 *
	 * The flag is therefore false until an authoritative phase
	 * transition is observed or a persisted record is restored, and the
	 * tracker uses it to withhold the `duration` field entirely (the
	 * webview then renders "unavailable").
	 */
	accountingAvailable: boolean
	/** The phase of the currently-committed lifecycle state. */
	currentPhase: TurnPhase | undefined
	/**
	 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02 / W2):
	 * true once an authoritative phase transition has been observed.
	 *
	 * This is the RESTORE AUTHORITY: the live accounting begins at the
	 * first authoritative transition, and a persisted record can only be
	 * applied BEFORE that point. After it, every record is an
	 * observation of the past and is explicitly REJECTED.
	 */
	liveAccountingStarted: boolean
	/**
	 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02 / W2):
	 * true once a persisted record has been applied to this task's
	 * accounting.
	 *
	 * The restore authorization is CONSUMED by the first restore: a
	 * second restore is rejected even when no phase transition has been
	 * observed yet, because it would re-establish the open interval's
	 * anchor and lose the time accrued since the first restore.
	 */
	restoreConsumed: boolean
	/** True once a terminal write has closed the last interval. */
	frozen: boolean
	/** True when at least one interval could not be measured reliably. */
	partial: boolean
}

/**
 * The classification + accumulation engine.
 *
 * Pure with respect to everything except the injected clock: it holds
 * no I/O, no timers, no React coupling and no global state.
 */
export class TaskDurationAccountant {
	private state: TaskDurationAccumulatorState = {
		activeMs: 0,
		waitingMs: 0,
		unknownMs: 0,
		openCategory: undefined,
		openAnchorMs: undefined,
		openPhase: undefined,
		restoredWaitingReason: undefined,
		accountingAvailable: false,
		currentPhase: undefined,
		liveAccountingStarted: false,
		restoreConsumed: false,
		frozen: false,
		partial: false,
	}

	constructor(private readonly clock: MonotonicClock = defaultMonotonicClock()) {}

	/**
	 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02 / W2):
	 * has an authoritative lifecycle transition been observed for this
	 * task?
	 *
	 * The LIVE accounting begins at the FIRST authoritative phase
	 * transition. From that moment on, a persisted record is an
	 * OBSERVATION OF THE PAST and can no longer be applied to the live
	 * accounting: the live accounting already holds a NEWER lifecycle
	 * phase and a NEWER interval anchor.
	 *
	 * This flag is the restore authority. It replaces the old
	 * per-bucket `Math.max` merge, which could not distinguish "a
	 * record that is older but equal" from "a record that is newer".
	 */
	get liveAccountingStarted(): boolean {
		return this.state.liveAccountingStarted
	}

	/**
	 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02 / W2):
	 * would a restore of a persisted record be REJECTED?
	 *
	 * True when the restore authorization has been consumed (a record was
	 * already applied) OR when the live accounting has already begun (an
	 * authoritative phase transition was observed). In both cases the
	 * persisted record is an observation of the past and must not be
	 * applied to the live accounting.
	 */
	get restoreRejected(): boolean {
		return this.state.restoreConsumed || this.state.liveAccountingStarted
	}

	/**
	 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01 / W2
	 * R2): the CLOSED-interval totals.
	 *
	 * These are the accumulated totals of the CLOSED intervals only — the
	 * currently-open interval is NOT included. They are the state a
	 * restore must never roll back, and they are the state the
	 * persistence seam would write once the open interval is closed.
	 *
	 * Read-only. Exposed so a witness can observe the conservation
	 * property directly instead of inferring it from a snapshot that
	 * includes the open interval (which would MASK a rollback).
	 */
	get closedTotals(): { activeMs: number; waitingMs: number; unknownMs: number } {
		return { activeMs: this.state.activeMs, waitingMs: this.state.waitingMs, unknownMs: this.state.unknownMs }
	}

	/**
	 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01 / W2
	 * R4): whether an authoritative accounting EXISTS.
	 *
	 * False for a task that has never been observed by an authoritative
	 * lifecycle transition and has never had a persisted record restored
	 * — i.e. a legacy task whose accounting was never measured.
	 */
	get accountingAvailable(): boolean {
		return this.state.accountingAvailable
	}

	/**
	 * Reset the accounting for a NEW task identity. The accumulated
	 * totals are discarded together with the task's other telemetry —
	 * a new task never inherits another task's duration.
	 */
	reset(): void {
		this.state = {
			activeMs: 0,
			waitingMs: 0,
			unknownMs: 0,
			openCategory: undefined,
			openAnchorMs: undefined,
			openPhase: undefined,
			restoredWaitingReason: undefined,
			accountingAvailable: false,
			currentPhase: undefined,
			liveAccountingStarted: false,
			restoreConsumed: false,
			frozen: false,
			partial: false,
		}
	}

	/**
	 * Restore a persisted accounting record for the SAME task identity.
	 *
	 * The persisted record carries the three accumulated totals plus the
	 * phase the task was in. The restored accounting re-opens an
	 * interval in that category, so the task does not silently stop
	 * being accounted for after a recovery.
	 *
	 * NO monotonic timestamp is restored: monotonic values are
	 * process-local and are not transferable across processes. The
	 * interval anchor is re-established from the CURRENT monotonic
	 * clock, which means the interval spanning the restart is NOT
	 * claimed — an unobservable gap is never silently classified.
	 *
	 * AMENDMENT-01 (W2) — the four conservation rules:
	 *
	 *   R1 (restart coverage). A restored record re-opens an interval,
	 *       so the interval spanning the restart is UNOBSERVABLE. The
	 *       restored coverage is therefore downgraded to "partial"
	 *       unless the record was TERMINAL (a terminal task opens no
	 *       interval, so nothing is unobservable and the completed
	 *       task's dormant interval remains legitimately excluded).
	 *       The record's own "partial" coverage is carried forward.
	 *       A numeric gap is NEVER invented and the gap is NEVER
	 *       silently classified as ACTIVE or WAITING.
	 *
	 *   R2 (duplicate restore). The restore is MONOTONIC with respect
	 *       to the accumulated totals: the known durations already
	 *       accumulated are NEVER rolled back by a stale record, and
	 *       a duplicate restore does not reset the interval anchor
	 *       through a second reopening. Only the totals are merged;
	 *       the anchor is re-established exactly once per restore
	 *       "generation".
	 *
	 *   R3 (waiting reason). The waiting reason of a restored WAITING
	 *       record is CONSERVED from the record itself, so it remains
	 *       correct until a new authoritative lifecycle transition
	 *       supersedes it.
	 *
	 *   R4 (legacy task). A task WITHOUT a persisted record has NO
	 *       accounting at all — the caller must not restore anything
	 *       (see `TaskTelemetryTracker.restoreDurationAccounting`).
	 *
	 * AMENDMENT-02 (W2) — the RESTORE OWNERSHIP SIMPLIFICATION.
	 *
	 *   The per-bucket `Math.max` merge above did NOT establish temporal
	 *   conservation: it could not tell an OLDER record from a NEWER one
	 *   that happens to have the same or a larger total. A merge of two
	 *   incoherent observations is not a restore — it is an average of
	 *   two timelines, and it silently produced the three reproduced
	 *   defects (a stale record during a human gate, a live record
	 *   duplicating the open interval, and a stale terminal record
	 *   re-freezing a live accounting).
	 *
	 *   The repair REMOVES the merge and replaces it with ONE
	 *   authoritative rule:
	 *
	 *     THE RESTORE IS AUTHORIZED EXACTLY ONCE, AT TASK ACTIVATION,
	 *     BEFORE THE LIVE ACCOUNTING BEGINS.
	 *
	 *   The live accounting begins at the FIRST authoritative phase
	 *   transition (`observePhase`). From that moment on the live
	 *   accounting owns a NEWER lifecycle phase, a NEWER interval anchor
	 *   and NEWER accumulated totals than any persisted record can
	 *   carry, so a record applied then is an OBSERVATION OF THE PAST
	 *   and is explicitly REJECTED.
	 *
	 *   The authorization is CONSUMED BY THE FIRST RESTORE: a second
	 *   restore is rejected even when no phase transition has been
	 *   observed yet, because a second restore would re-establish the
	 *   open interval's anchor and lose the time accrued since the first
	 *   restore.
	 *
	 *   Consequences (each one is a reproduced defect, now closed):
	 *
	 *     - A stale record during a human gate cannot rewrite the live
	 *       phase, cannot roll the waiting bucket back and cannot reset
	 *       the open interval's anchor.
	 *     - Restoring the CURRENT live projection cannot duplicate the
	 *       open interval (there is no second reopening).
	 *     - A stale terminal record cannot re-freeze a live accounting
	 *       that has already been continued.
	 *
	 *   What a rejected restore does: NOTHING. It is not an error and
	 *   it does not degrade the accounting — the live accounting is
	 *   simply left exactly as it is.
	 *
	 *   The restore is applied AS A WHOLE: the three accumulated totals,
	 *   the phase, the waiting reason and the coverage of the record
	 *   become the accounting's state together. No overlapping interval
	 *   is merged, and no open anchor is reset through an obsolete
	 *   restore.
	 */
	restore(record: {
		activeMs: number
		waitingMs: number
		unknownMs: number
		phase: "active" | "waiting" | "unknown" | "terminal"
		waitingReason?: TaskDurationWaitingReason
		coverage: "complete" | "partial"
	}): void {
		const s = this.state
		// AMENDMENT-02 (W2): the RESTORE AUTHORITY.
		//
		// The restore is authorized EXACTLY ONCE, at task activation,
		// BEFORE the live accounting has begun:
		//
		//   - `restoreConsumed` — the authorization is consumed by the
		//     FIRST restore. A second restore is rejected even when no
		//     phase transition has been observed yet, because it would
		//     re-establish the open interval's anchor and lose the time
		//     accrued since the first restore.
		//   - `liveAccountingStarted` — after the first authoritative
		//     phase transition the live accounting is strictly newer
		//     than any persisted record, so the record is REJECTED.
		//
		// A rejected restore touches NOTHING: it does not alter an
		// accumulated total, does not change the lifecycle phase, does
		// not reset an open interval's anchor and does not freeze a live
		// accounting.
		if (s.restoreConsumed || s.liveAccountingStarted) {
			return
		}
		s.restoreConsumed = true
		// A restored persisted record IS an authoritative accounting
		// (AMENDMENT-01 / W2 R4): the availability flag is set.
		s.accountingAvailable = true
		s.activeMs = Math.max(0, Math.floor(record.activeMs))
		s.waitingMs = Math.max(0, Math.floor(record.waitingMs))
		s.unknownMs = Math.max(0, Math.floor(record.unknownMs))

		// R3 (waiting reason conservation): the record's waiting reason
		// is carried into the reopened interval. It remains correct
		// until a new authoritative lifecycle transition supersedes it.
		const restoredWaitingReason = record.phase === "waiting" ? record.waitingReason : undefined

		if (record.phase === "terminal") {
			// The task was terminal when the record was written. No
			// interval is open, so nothing accumulates until an explicit
			// continuation reopens one.
			//
			// A terminal record opens NO interval, so there is no
			// unobservable interval to report — the completed task's
			// dormant interval remains legitimately excluded and the
			// record's own coverage is carried forward verbatim.
			s.partial = record.coverage === "partial"
			s.currentPhase = undefined
			s.openPhase = undefined
			s.openAnchorMs = undefined
			s.openCategory = undefined
			s.restoredWaitingReason = undefined
			s.frozen = true
			return
		}

		// R1 (unobservable restart gap): the reopened interval spans an
		// unobservable gap, so the coverage is downgraded to "partial".
		// No numeric gap is invented, and the gap is never silently
		// classified as ACTIVE or WAITING.
		s.partial = true

		s.frozen = false
		s.currentPhase = undefined
		s.openCategory = record.phase
		s.openAnchorMs = this.clock()
		s.openPhase = undefined
		s.restoredWaitingReason = restoredWaitingReason
	}

	/**
	 * The persistence projection of the current accounting.
	 *
	 * The totals are the ACCUMULATED totals of the CLOSED intervals
	 * plus the elapsed portion of the currently-open interval, so the
	 * persisted record is coherent with the published snapshot.
	 */
	persistenceProjection():
		| {
				activeMs: number
				waitingMs: number
				unknownMs: number
				phase: "active" | "waiting" | "unknown" | "terminal"
				waitingReason?: TaskDurationWaitingReason
				coverage: "complete" | "partial"
		  }
		| undefined {
		const snapshot = this.snapshot("projection")
		if (!snapshot) {
			// AMENDMENT-01 (W2 / R4): NO authoritative accounting exists
			// (a legacy task that was never observed). The projection is
			// `undefined`, NOT a fabricated zero record — a zero total
			// would claim "this task ran for no measurable time", which
			// was never observed.
			return undefined
		}
		return {
			activeMs: snapshot.activeMs,
			waitingMs: snapshot.waitingMs,
			unknownMs: snapshot.unknownMs,
			phase: snapshot.phase,
			waitingReason: snapshot.waitingReason,
			coverage: snapshot.coverage,
		}
	}

	/**
	 * Observe an authoritative phase transition.
	 *
	 * Idempotent for a repeated write of the SAME phase: the open
	 * interval is not closed and not reopened, so a duplicate lifecycle
	 * event cannot double-count time and cannot split an interval.
	 *
	 * A terminal phase closes the open interval and freezes the totals.
	 * A subsequent ACTIVE phase (an explicit continuation of the same
	 * task) reopens a NEW interval; the previously accumulated totals
	 * are preserved and the dormant gap between the terminal write and
	 * the continuation belongs to no interval.
	 */
	observePhase(phase: TurnPhase): void {
		const s = this.state
		// AMENDMENT-01 (W2 / R4): an authoritative lifecycle transition
		// IS an accounting measurement — the accounting exists from now
		// on, even if its accumulated total is still zero.
		s.accountingAvailable = true
		// AMENDMENT-02 (W2): the FIRST authoritative transition starts
		// the LIVE accounting. From here on a persisted record is an
		// observation of the past and is rejected by `restore`.
		s.liveAccountingStarted = true
		if (s.currentPhase === phase && s.openCategory !== undefined) {
			// Duplicate / no-op transition: the open interval keeps
			// accruing into the same category. Nothing is closed and
			// nothing is reopened, so no time is lost or duplicated.
			return
		}
		if (s.openCategory !== undefined) {
			this.closeInterval()
		}
		s.currentPhase = phase
		// AMENDMENT-01 (W2 / R3): an authoritative lifecycle transition
		// SUPERSEDES the conserved waiting reason of a restored record.
		s.restoredWaitingReason = undefined
		const category = classifyTurnPhase(phase)
		if (category === "terminal") {
			// The terminal write has closed the last interval. No
			// interval is open, so nothing can accumulate until an
			// explicit continuation reopens one.
			s.openCategory = undefined
			s.openAnchorMs = undefined
			s.openPhase = undefined
			s.frozen = true
			return
		}
		s.frozen = false
		s.openCategory = category
		s.openAnchorMs = this.clock()
		s.openPhase = phase
	}

	/**
	 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02 / W5):
	 * observe an UNRECOGNIZED authoritative phase.
	 *
	 * The pre-repair behaviour was to IGNORE an unknown phase string, so
	 * the PREVIOUS classification silently continued: a task that was
	 * waiting on a human would keep accruing WAITING time even though
	 * the authoritative phase had become something the accounting does
	 * not understand. That is a silent misclassification.
	 *
	 * The repair closes the current interval and opens an UNKNOWN one, so
	 * the time after the unrecognized phase is reported as
	 * UNCLASSIFIABLE rather than attributed to the previous category.
	 * The existing "unknown" bucket is the explicit uncertainty
	 * mechanism; no new category is introduced.
	 *
	 * The same-phase idempotence still holds: a repeated unrecognized
	 * phase keeps the same UNKNOWN interval open.
	 */
	observeUnclassifiedPhase(): void {
		const s = this.state
		s.accountingAvailable = true
		s.liveAccountingStarted = true
		if (s.openCategory === "unknown" && s.openAnchorMs !== undefined) {
			// A repeated unrecognized phase: the UNKNOWN interval keeps
			// accruing. Nothing is closed and nothing is reopened.
			return
		}
		if (s.openCategory !== undefined) {
			this.closeInterval()
		}
		s.currentPhase = undefined
		s.restoredWaitingReason = undefined
		s.frozen = false
		s.openCategory = "unknown"
		s.openAnchorMs = this.clock()
		s.openPhase = undefined
	}

	/**
	 * Close the currently-open interval, attributing its measured
	 * duration to the category that owned it.
	 *
	 * The measurement is the difference between the current monotonic
	 * reading and the interval's anchor. A NEGATIVE difference means
	 * the monotonic clock moved backwards — the interval's duration
	 * cannot be established. It is NOT attributed to ACTIVE or
	 * WAITING; the snapshot is downgraded to partial coverage and no
	 * numeric duration is invented for it.
	 */
	private closeInterval(): void {
		const s = this.state
		const category = s.openCategory
		const anchor = s.openAnchorMs
		if (category === undefined || anchor === undefined) {
			return
		}
		const now = this.clock()
		const delta = now - anchor
		s.openCategory = undefined
		s.openAnchorMs = undefined
		s.openPhase = undefined
		s.restoredWaitingReason = undefined
		if (!Number.isFinite(delta) || delta < 0) {
			// Unmeasurable / non-monotonic interval: mark coverage
			// partial. The gap is NOT invented and NOT attributed.
			s.partial = true
			return
		}
		const whole = Math.floor(delta)
		switch (category) {
			case "active":
				s.activeMs += whole
				break
			case "waiting":
				s.waitingMs += whole
				break
			case "unknown":
			default:
				s.unknownMs += whole
				break
		}
	}

	/**
	 * The current coherent snapshot.
	 *
	 * `elapsedMs` is the sum of the CLOSED intervals plus the
	 * currently-open interval's elapsed portion, so a live task's
	 * elapsed keeps growing without needing a phase write. The open
	 * interval's portion is attributed to its own category, which keeps
	 * the conservation identity exact at all times.
	 */
	snapshot(taskId: string | undefined): TaskDurationSnapshot | undefined {
		const s = this.state
		if (taskId === undefined) {
			return undefined
		}
		// AMENDMENT-01 (W2 / R4): a task with NO authoritative accounting
		// (a legacy task recorded before the accounting existed) projects
		// NO snapshot at all. The zero totals the accumulator holds are
		// the ABSENCE of a measurement, not a measurement of zero — so
		// publishing them would fabricate a complete historical total
		// that was never observed. The tracker withholds the `duration`
		// wire field and the webview renders "unavailable".
		if (!s.accountingAvailable) {
			return undefined
		}
		let activeMs = s.activeMs
		let waitingMs = s.waitingMs
		let unknownMs = s.unknownMs
		let phase: TaskDurationSnapshot["phase"] = "terminal"
		let coverage: TaskDurationSnapshot["coverage"] = s.partial ? "partial" : "complete"

		if (s.openCategory !== undefined && s.openAnchorMs !== undefined) {
			const delta = this.clock() - s.openAnchorMs
			if (Number.isFinite(delta) && delta >= 0) {
				const whole = Math.floor(delta)
				switch (s.openCategory) {
					case "active":
						activeMs += whole
						break
					case "waiting":
						waitingMs += whole
						break
					default:
						unknownMs += whole
						break
				}
			} else {
				coverage = "partial"
			}
			phase = s.openCategory === "waiting" ? "waiting" : s.openCategory === "active" ? "active" : "unknown"
		} else if (s.frozen) {
			phase = "terminal"
		}

		const elapsedMs = activeMs + waitingMs + unknownMs
		return {
			taskId,
			elapsedMs,
			activeMs,
			waitingMs,
			unknownMs,
			phase,
			// AMENDMENT-01 (W2 / R3): a restored interval has no live
			// `openPhase`, so the conserved reason of the restored record
			// is used. A live phase always wins over the conserved
			// reason — the phase is the authoritative source.
			waitingReason:
				s.openCategory === "waiting"
					? (waitingReasonForPhase(s.openPhase as TurnPhase) ?? s.restoredWaitingReason)
					: undefined,
			coverage,
		}
	}
}
