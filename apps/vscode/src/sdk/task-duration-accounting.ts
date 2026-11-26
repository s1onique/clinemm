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
		return () => proc.hrtime()[0] * 1e3 + proc.hrtime()[1] / 1e6
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
	/** The phase of the currently-committed lifecycle state. */
	currentPhase: TurnPhase | undefined
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
		currentPhase: undefined,
		frozen: false,
		partial: false,
	}

	constructor(private readonly clock: MonotonicClock = defaultMonotonicClock()) {}

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
			currentPhase: undefined,
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
	 * The record's `coverage` is carried forward: a record that was
	 * written with partial coverage stays partial.
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
		s.activeMs = Math.max(0, Math.floor(record.activeMs))
		s.waitingMs = Math.max(0, Math.floor(record.waitingMs))
		s.unknownMs = Math.max(0, Math.floor(record.unknownMs))
		s.partial = record.coverage === "partial"
		s.currentPhase = undefined
		s.openPhase = undefined
		s.openAnchorMs = undefined
		if (record.phase === "terminal") {
			// The task was terminal when the record was written. No
			// interval is open, so nothing accumulates until an explicit
			// continuation reopens one.
			s.openCategory = undefined
			s.frozen = true
			return
		}
		s.frozen = false
		s.openCategory = record.phase
		s.openAnchorMs = this.clock()
		s.openPhase = undefined
	}

	/**
	 * The persistence projection of the current accounting.
	 *
	 * The totals are the ACCUMULATED totals of the CLOSED intervals
	 * plus the elapsed portion of the currently-open interval, so the
	 * persisted record is coherent with the published snapshot.
	 */
	persistenceProjection(): {
		activeMs: number
		waitingMs: number
		unknownMs: number
		phase: "active" | "waiting" | "unknown" | "terminal"
		waitingReason?: TaskDurationWaitingReason
		coverage: "complete" | "partial"
	} {
		const snapshot = this.snapshot("projection")
		if (!snapshot) {
			return {
				activeMs: 0,
				waitingMs: 0,
				unknownMs: 0,
				phase: "terminal",
				coverage: "complete",
			}
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
			waitingReason: s.openCategory === "waiting" ? waitingReasonForPhase(s.openPhase as TurnPhase) : undefined,
			coverage,
		}
	}
}
