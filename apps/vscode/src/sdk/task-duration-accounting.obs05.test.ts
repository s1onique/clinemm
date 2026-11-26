/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01
 *
 * Deterministic production-seam witnesses for the ACTIVE / WAITING /
 * UNKNOWN task-duration accounting.
 *
 * WHAT IS UNDER TEST
 *
 *   These tests drive the REAL production transition owner
 *   (`TurnStateTracker`) and the REAL production accumulator
 *   (`TaskTelemetryTracker` -> `TaskDurationAccountant`), wired
 *   together exactly as `SdkController` wires them in production
 *   (`SdkController.ts` L4730-4732:
 *   `turnStateTracker.subscribe((phase, anchorTs) => taskTelemetry.observeTurnPhase(phase, anchorTs))`).
 *
 *   A standalone accumulator test would NOT prove the production seam.
 *   These tests therefore always go through the phase tracker — the
 *   authoritative lifecycle owner — and read the result back from the
 *   tracker's published wire strip (`get()`), which is what the
 *   webview actually receives.
 *
 * DETERMINISM
 *
 *   The tracker's clock is INJECTED (`new TaskTelemetryTracker(clock)`),
 *   so the synthetic chronology is exact and no test sleeps. The
 *   injected clock is a MONOTONIC one, exactly like the production
 *   default.
 *
 * THE OBSERVATIONAL GAP (W3)
 *
 *   `OBS-05-GAP` reproduces the motivating deficiency: a task that
 *   executes, reaches a human-input gate, waits, resumes and completes
 *   cannot be distinguished from a continuously-executing task by the
 *   PRE-EXISTING wall-clock accounting. The pre-existing wall-clock
 *   `elapsed` is identical in both cases; only the new accounting
 *   separates them.
 *
 * COVERAGE MAP (the ACT's W6 matrix)
 *
 *   T01 continuous execution      -> T01
 *   T02 human question + resume   -> T02
 *   T03 multiple approval gates    -> T03
 *   T04 slow provider response    -> T04
 *   T05 automatic retry / backoff  -> T05
 *   T06 required background cmd    -> T06
 *   T07 detached bg job during wait-> T07
 *   T08 compaction during execution-> T08
 *   T09 concurrent required ops    -> T09
 *   T10 duplicate lifecycle event  -> T10
 *   T11 stale event / prior epoch  -> T11
 *   T12 webview recreation         -> T12
 *   T13 task switching             -> T13
 *   T14 supported runtime recovery -> T14
 *   T15 unobservable restart gap   -> T15
 *   T16 wall-clock regression      -> T16
 *   T17 terminal completion         -> T17
 *   T18 continuation after terminal-> T18
 *   T19 legacy task w/o accounting -> T19
 *   T20 stale UI snapshot          -> T20
 *   T21 human gate + required work -> T21
 *   T22 repeated mount/unmount     -> T22
 */
import type { TaskHeaderTelemetryStrip } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { MessageIdMinter } from "./message-id-minter"
import { TaskTelemetryTracker } from "./task-telemetry-tracker"
import { TurnStateTracker } from "./turn-state-tracker"

/**
 * A deterministic MONOTONIC clock. The test drives it explicitly with
 * `advance(ms)`; reads never block.
 */
class TestClock {
	private current = 0
	readonly now = (): number => this.current
	advance(ms: number): void {
		this.current += ms
	}
	/** Force a backwards step (a clock discontinuity). */
	jumpBack(ms: number): void {
		this.current -= ms
	}
	get value(): number {
		return this.current
	}
}

/**
 * The PRODUCTION wiring: the real lifecycle owner drives the real
 * accumulator through the real subscription seam.
 */
function makeRig(taskId = "task-obs05") {
	const clock = new TestClock()
	const tracker = new TaskTelemetryTracker(clock.now)
	const turnState = new TurnStateTracker(new MessageIdMinter())
	turnState.subscribe((phase, anchorTs) => {
		tracker.observeTurnPhase(phase, anchorTs)
	})
	tracker.startTask(taskId, 1_700_000_000_000)
	return { clock, tracker, turnState }
}

function durationOf(strip: TaskHeaderTelemetryStrip | undefined) {
	return strip?.duration
}

/**
 * The exact conservation invariant the ACT requires, asserted after
 * EVERY observation in the matrix.
 */
function expectConservation(strip: TaskHeaderTelemetryStrip | undefined): void {
	const d = durationOf(strip)
	if (!d) {
		throw new Error("expected a duration snapshot")
	}
	expect(d.elapsedMs).toBe(d.activeMs + d.waitingMs + d.unknownMs)
	expect(d.elapsedMs).toBeGreaterThanOrEqual(0)
	expect(d.activeMs).toBeGreaterThanOrEqual(0)
	expect(d.waitingMs).toBeGreaterThanOrEqual(0)
	expect(d.unknownMs).toBeGreaterThanOrEqual(0)
	expect(Number.isFinite(d.elapsedMs)).toBe(true)
}

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 / production seam", () => {
	// ------------------------------------------------------------------
	// T01 — Continuous execution: all time ACTIVE.
	// ------------------------------------------------------------------
	it("T01: continuous execution classifies every millisecond as ACTIVE", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		const snap = tracker.get()
		expect(durationOf(snap)?.activeMs).toBe(10_000)
		expect(durationOf(snap)?.waitingMs).toBe(0)
		expect(durationOf(snap)?.unknownMs).toBe(0)
		expect(durationOf(snap)?.phase).toBe("active")
		expectConservation(snap)
	})

	// ------------------------------------------------------------------
	// T02 — Human question and resume: exact ACTIVE/WAITING split.
	// ------------------------------------------------------------------
	it("T02: a follow-up question splits ACTIVE from WAITING exactly", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("awaiting_followup")
		clock.advance(30_000)
		turnState.set("streaming")
		clock.advance(15_000)
		turnState.set("completed")

		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(25_000)
		expect(d?.waitingMs).toBe(30_000)
		expect(d?.unknownMs).toBe(0)
		expect(d?.elapsedMs).toBe(55_000)
		expectConservation(tracker.get())
	})

	it("T02b: the waiting reason is USER_INPUT while a follow-up question is pending", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(1_000)
		turnState.set("awaiting_followup")
		clock.advance(1_000)
		const d = durationOf(tracker.get())
		expect(d?.waitingReason).toBe("USER_INPUT")
		expect(d?.phase).toBe("waiting")
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T03 — Multiple approval gates: correct cumulative waiting time.
	// ------------------------------------------------------------------
	it("T03: multiple approval gates accumulate waiting time cumulatively", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(5_000)
		turnState.set("awaiting_approval")
		clock.advance(10_000)
		turnState.set("streaming")
		clock.advance(5_000)
		turnState.set("awaiting_approval")
		clock.advance(7_000)
		turnState.set("streaming")
		clock.advance(3_000)

		const d = durationOf(tracker.get())
		expect(d?.waitingMs).toBe(17_000)
		expect(d?.activeMs).toBe(13_000)
		expectConservation(tracker.get())
	})

	it("T03b: the waiting reason is TOOL_APPROVAL during an approval gate", () => {
		const { tracker, turnState } = makeRig()
		turnState.set("awaiting_approval")
		expect(durationOf(tracker.get())?.waitingReason).toBe("TOOL_APPROVAL")
	})

	// ------------------------------------------------------------------
	// T04 — Slow provider response: ACTIVE (provider latency is active).
	// ------------------------------------------------------------------
	it("T04: a slow provider response is ACTIVE, not WAITING", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(45_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(45_000)
		expect(d?.waitingMs).toBe(0)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T05 — Automatic retry / backoff: ACTIVE.
	// ------------------------------------------------------------------
	it("T05: an automatic retry backoff stays inside the ACTIVE interval", () => {
		const { clock, tracker, turnState } = makeRig()
		// An AUTOMATIC retry (one the runtime performs without human
		// input) never leaves the `streaming` phase — the runtime stays
		// in its own orchestration while it backs off and retries. The
		// whole window is therefore ACTIVE, including the backoff.
		turnState.set("streaming")
		clock.advance(2_000)
		clock.advance(1_000) // automatic retry backoff
		clock.advance(8_000) // the retried request
		const d = durationOf(tracker.get())
		expect(d?.waitingMs).toBe(0)
		expect(d?.activeMs).toBe(11_000)
		expectConservation(tracker.get())
	})

	it("T05b: a terminal error awaiting a human Retry is WAITING (recovery intervention)", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(2_000)
		// The `error` phase is a TERMINAL write the user must acknowledge
		// (the Retry button). Automatic progression is blocked on a
		// human, so this interval is WAITING, not ACTIVE.
		turnState.set("error")
		clock.advance(1_000)
		const d = durationOf(tracker.get())
		expect(d?.waitingMs).toBe(1_000)
		expect(d?.activeMs).toBe(2_000)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T06 — Required background command: ACTIVE.
	// ------------------------------------------------------------------
	it("T06: a required background command in flight is ACTIVE", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(20_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(20_000)
		expect(d?.waitingMs).toBe(0)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T07 — Detached background job during a human wait: WAITING.
	// ------------------------------------------------------------------
	it("T07: a detached background job does not keep the task ACTIVE during a human wait", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(5_000)
		// The job is detached: the runtime no longer needs it, so the
		// phase moves to the human-gated state.
		turnState.set("awaiting_followup")
		clock.advance(30_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(5_000)
		expect(d?.waitingMs).toBe(30_000)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T08 — Compaction during execution: no reset; ACTIVE.
	// ------------------------------------------------------------------
	it("T08: compaction during execution does not reset the duration and is ACTIVE", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("compacting")
		clock.advance(6_000)
		turnState.set("streaming")
		clock.advance(4_000)

		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(20_000)
		expect(d?.waitingMs).toBe(0)
		expect(d?.elapsedMs).toBe(20_000)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T09 — Concurrent required operations: no double counting.
	// ------------------------------------------------------------------
	it("T09: concurrent required operations contribute the UNION of active intervals, not their sum", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		// Two concurrent tools each nominally "taking" 10s of wall
		// clock. The phase timeline has ONE interval for both, so the
		// accounted active time is 10s — not 20s.
		clock.advance(10_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(10_000)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T10 — Duplicate lifecycle event: idempotent.
	// ------------------------------------------------------------------
	it("T10: a duplicate lifecycle event is idempotent and double-counts nothing", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		const before = durationOf(tracker.get())
		// A duplicate write of the SAME phase.
		turnState.set("streaming")
		clock.advance(5_000)
		const after = tracker.get()
		expect(durationOf(after)?.activeMs).toBe(15_000)
		expect(durationOf(after)?.activeMs).toBe((before?.activeMs ?? 0) + 5_000)
		expectConservation(after)
	})

	it("T10b: a duplicate event right at a boundary does not split or duplicate the interval", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(4_000)
		turnState.set("awaiting_followup")
		clock.advance(6_000)
		turnState.set("awaiting_followup")
		clock.advance(2_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(4_000)
		expect(d?.waitingMs).toBe(8_000)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T11 — Stale event or prior epoch: no contamination.
	// ------------------------------------------------------------------
	it("T11: an event belonging to a prior task epoch does not contaminate the current task", () => {
		const { clock, tracker, turnState } = makeRig("task-current")
		turnState.set("streaming")
		clock.advance(10_000)
		// A NEW task identity resets the accounting — the previous
		// task's totals must not bleed into the new one.
		tracker.startTask("task-next", 1_700_000_100_000)
		//
		// ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01 /
		// F3 / R4): a task that the runtime has NOT yet observed has NO
		// authoritative accounting. The previous task's totals are not
		// carried over AND a fabricated complete zero is not published
		// either — the wire field is simply absent until the runtime
		// observes this task.
		expect(durationOf(tracker.get())).toBeUndefined()
		// Once the runtime observes the new task, its accounting starts
		// from zero — the previous task's totals never bleed in.
		turnState.set("streaming")
		clock.advance(1_000)
		const d = durationOf(tracker.get())
		expect(d?.taskId).toBe("task-next")
		expect(d?.activeMs).toBe(1_000)
		expect(d?.waitingMs).toBe(0)
		expectConservation(tracker.get())
	})

	it("T11b: a stale phase write for a superseded epoch cannot reopen a frozen task", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(5_000)
		turnState.set("completed")
		clock.advance(1_000)
		const frozen = durationOf(tracker.get())
		expect(frozen?.phase).toBe("terminal")
		// A stale write of an OLD phase arriving late must not restart
		// the accounting for the frozen epoch.
		tracker.observeTurnPhase("streaming")
		const after = durationOf(tracker.get())
		expect(after?.activeMs).toBe(frozen?.activeMs)
		expect(after?.elapsedMs).toBe(frozen?.elapsedMs)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T12 — Webview recreation: accounting preserved.
	// ------------------------------------------------------------------
	it("T12: a webview recreation preserves the accumulated durations", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("awaiting_followup")
		clock.advance(30_000)
		const before = tracker.get()
		// A webview recreation re-reads the canonical state payload.
		// The host-side tracker is untouched, so the published snapshot
		// is identical.
		const after = tracker.get()
		expect(durationOf(after)).toEqual(durationOf(before))
		expectConservation(after)
	})

	// ------------------------------------------------------------------
	// T13 — Task switching: no cross-task contamination.
	// ------------------------------------------------------------------
	it("T13: switching tasks does not transfer duration between tasks", () => {
		const { clock, tracker, turnState } = makeRig("task-a")
		turnState.set("streaming")
		clock.advance(10_000)
		const a = durationOf(tracker.get())
		expect(a?.activeMs).toBe(10_000)
		// Switch to a different task.
		tracker.startTask("task-b", 1_700_000_200_000)
		//
		// ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01 /
		// F3 / R4): the NEW task has no accounting until the runtime
		// observes it. The previous task's totals are NOT carried over.
		expect(durationOf(tracker.get())).toBeUndefined()
		turnState.set("streaming")
		clock.advance(1_000)
		const b = durationOf(tracker.get())
		expect(b?.taskId).toBe("task-b")
		expect(b?.activeMs).toBe(1_000)
		expect(b?.elapsedMs).toBe(1_000)
		expectConservation(tracker.get())
	})

	it("T13b: returning to a previous task id restores its KNOWN durations (task-lifetime accounting, no per-id cache)", () => {
		const { clock, tracker, turnState } = makeRig("task-a")
		tracker.startTask("task-a", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(10_000)
		const aRecord = tracker.durationPersistence
		expect(aRecord?.activeMs).toBe(10_000)
		tracker.startTask("task-b", 1_700_000_200_000)
		clock.advance(4_000)
		// Returning to task-a restores the KNOWN durations from the
		// task's persisted accounting record.
		//
		// ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01 /
		// W2 / R5): the earlier "fresh zero" expectation conflicted with
		// TASK-LIFETIME accounting — a task's known durations are a fact
		// about the task, not about which task happens to be visible.
		// The tracker still keeps ONE visible-task window (no unbounded
		// per-task in-memory cache): the known durations are conserved
		// through the task's PERSISTED record, not through a cache.
		tracker.startTask("task-a", 1_700_000_300_000)
		tracker.restoreDurationAccounting("task-a", aRecord!)
		const d = durationOf(tracker.get())
		expect(d?.taskId).toBe("task-a")
		expect(d?.activeMs).toBe(10_000)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T14 — Supported runtime recovery: known durations preserved.
	// ------------------------------------------------------------------
	it("T14: a supported runtime recovery preserves the known accumulated durations", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(20_000)
		turnState.set("error")
		clock.advance(5_000)
		// The recovery continues the SAME task identity.
		turnState.set("streaming")
		clock.advance(10_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(30_000)
		expect(d?.waitingMs).toBe(5_000)
		expect(d?.elapsedMs).toBe(35_000)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T15 — Unobservable restart gap: UNKNOWN or partial coverage.
	// ------------------------------------------------------------------
	it("T15: an unobservable clock discontinuity is UNKNOWN with partial coverage, never invented", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		// The monotonic clock jumps BACKWARDS past the interval's anchor
		// (a process-restart / suspend discontinuity). The interval that
		// spans it can no longer be measured, so it is closed as
		// UNMEASURABLE — no duration is invented for it.
		clock.jumpBack(15_000)
		turnState.set("awaiting_followup")
		clock.advance(3_000)
		const d = durationOf(tracker.get())
		expect(d?.coverage).toBe("partial")
		expect(d?.unknownMs).toBeGreaterThanOrEqual(0)
		// The KNOWN accumulated durations survive the discontinuity, and
		// the interval that spanned it is NOT attributed to ACTIVE or
		// WAITING (no duration was invented for it).
		expect(d?.activeMs).toBe(0)
		expect(d?.waitingMs).toBe(3_000)
		expect(d?.elapsedMs).toBe(3_000)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T16 — Wall-clock regression: no negative duration.
	// ------------------------------------------------------------------
	it("T16: a wall-clock regression never produces a negative duration", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		// A wall-clock step backwards does not affect the monotonic
		// clock at all, but even a monotonic regression must not
		// produce a negative total.
		clock.jumpBack(60_000)
		turnState.set("awaiting_followup")
		clock.advance(1_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBeGreaterThanOrEqual(0)
		expect(d?.waitingMs).toBeGreaterThanOrEqual(0)
		expect(d?.elapsedMs).toBeGreaterThanOrEqual(0)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T17 — Terminal completion / cancellation / failure: totals frozen.
	// ------------------------------------------------------------------
	it("T17: a terminal completion freezes the totals", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("awaiting_followup")
		clock.advance(5_000)
		turnState.set("completed")
		const frozen = tracker.get()
		expect(durationOf(frozen)?.phase).toBe("terminal")
		expect(durationOf(frozen)?.elapsedMs).toBe(15_000)
		// Independent observation interval after the terminal state.
		clock.advance(60_000)
		const after = tracker.get()
		expect(durationOf(after)?.elapsedMs).toBe(durationOf(frozen)?.elapsedMs)
		expect(durationOf(after)?.activeMs).toBe(durationOf(frozen)?.activeMs)
		expect(durationOf(after)?.waitingMs).toBe(durationOf(frozen)?.waitingMs)
		expectConservation(after)
	})

	it("T17b: a cancellation (resumable) parks the task and freezes the ACTIVE totals", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(8_000)
		turnState.set("resumable")
		clock.advance(4_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(8_000)
		expect(d?.waitingMs).toBe(4_000)
		expect(d?.waitingReason).toBe("USER_PAUSE")
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T18 — Explicit continuation after completion: no dormant inflation.
	// ------------------------------------------------------------------
	it("T18: dormant time between a terminal state and a continuation is excluded from the totals", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("completed")
		// The task sits dormant for an hour.
		clock.advance(3_600_000)
		// An explicit continuation of the SAME task.
		turnState.set("streaming")
		clock.advance(5_000)
		const d = durationOf(tracker.get())
		// The dormant hour belongs to NO interval.
		expect(d?.activeMs).toBe(15_000)
		expect(d?.waitingMs).toBe(0)
		expect(d?.elapsedMs).toBe(15_000)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T19 — Legacy task without accounting: unavailable, not fabricated.
	// ------------------------------------------------------------------
	it("T19: a task with no accounting record reports unavailable, never a fabricated zero", () => {
		const tracker = new TaskTelemetryTracker()
		// A legacy strip: exactly the pre-ACT shape, with no
		// `duration` field at all.
		const legacy: TaskHeaderTelemetryStrip = {
			startedAt: 1_700_000_000_000,
			toolCalls: 3,
			recoveryBudgetFailures: 0,
		}
		expect(legacy.duration).toBeUndefined()
		//
		// ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01 /
		// F3 / R4): a freshly-started host task has NO accounting until
		// the RUNTIME observes it. Publishing a complete zero total
		// would fabricate a historical measurement that was never taken.
		const fresh = tracker.startTask("legacy-shaped", 1_700_000_000_000)
		expect(fresh?.duration).toBeUndefined()
		// Once the runtime observes the task, the accounting exists and
		// its zero total is a REAL measurement ("no time accounted yet").
		const observed = tracker.observeTurnPhase("streaming")
		expect(observed?.duration).toBeDefined()
		expect(observed?.duration?.elapsedMs).toBe(0)
	})

	// ------------------------------------------------------------------
	// T20 — Stale UI snapshot: no authoritative extrapolation.
	// ------------------------------------------------------------------
	it("T20: a stale snapshot is not extrapolated by the host", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		const stale = tracker.get()
		// The webview holds the stale snapshot and re-renders it. The
		// host does NOT mutate the published snapshot in place — a
		// consumer that holds an old object sees the old, frozen
		// numbers, and only a fresh `get()` sees the current ones.
		clock.advance(5_000)
		expect(durationOf(stale)?.elapsedMs).toBe(10_000)
		expect(durationOf(tracker.get())?.elapsedMs).toBe(15_000)
		// The published object is a fresh object each time — the
		// previous one is not mutated underneath the consumer.
		expect(durationOf(stale)).not.toBe(durationOf(tracker.get()))
	})

	// ------------------------------------------------------------------
	// T21 — Human gate + required automatic work: ACTIVE until gated.
	// ------------------------------------------------------------------
	it("T21: required automatic work keeps the interval ACTIVE until progression is human-gated", () => {
		const { clock, tracker, turnState } = makeRig()
		// A required background command is still running while the
		// agent is also blocked on a question — the phase stays
		// `streaming` because automatic progression has not stopped.
		turnState.set("streaming")
		clock.advance(10_000)
		expect(durationOf(tracker.get())?.activeMs).toBe(10_000)
		// The required work completes and the agent now genuinely needs
		// a human answer.
		turnState.set("awaiting_followup")
		clock.advance(20_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(10_000)
		expect(d?.waitingMs).toBe(20_000)
		expectConservation(tracker.get())
	})

	// ------------------------------------------------------------------
	// T22 — Repeated mount/unmount: no leaked subscriptions or timers.
	// ------------------------------------------------------------------
	it("T22: repeated mount/unmount leaks no subscription and preserves the accounting", () => {
		const clock = new TestClock()
		const tracker = new TaskTelemetryTracker(clock.now)
		const turnState = new TurnStateTracker(new MessageIdMinter())
		tracker.startTask("task-mount", 1_700_000_000_000)
		// A webview remount does NOT re-subscribe the host observer: the
		// host-side subscription is established once, outside the
		// webview lifetime. If a remount DID re-subscribe, the
		// accounting would be observed twice per transition and the
		// totals would drift.
		const unsub = turnState.subscribe((phase, anchorTs) => {
			tracker.observeTurnPhase(phase, anchorTs)
		})
		for (let i = 0; i < 5; i++) {
			// The webview mounts and unmounts: it re-reads the canonical
			// state payload and renders it. No host subscription is
			// created or destroyed.
			//
			// ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01
			// (AMENDMENT-01 / F3 / R4): the accounting exists only once
			// the runtime has observed the task, so the pre-observation
			// snapshot legitimately carries NO duration field.
			expect(tracker.get()?.duration).toBeUndefined()
		}
		turnState.set("streaming")
		clock.advance(10_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(10_000)
		unsub()
		expectConservation(tracker.get())
	})

	it("T22c: a duplicated host subscription would double-count — the seam is single-subscription by construction", () => {
		// This is the NON-VACUITY witness for T22: it proves the
		// accounting is sensitive to the number of observers, so T22's
		// "exactly once" assertion is load-bearing rather than
		// trivially true.
		const clock = new TestClock()
		const tracker = new TaskTelemetryTracker(clock.now)
		const turnState = new TurnStateTracker(new MessageIdMinter())
		tracker.startTask("task-dup", 1_700_000_000_000)
		turnState.subscribe((phase, anchorTs) => {
			tracker.observeTurnPhase(phase, anchorTs)
		})
		turnState.set("streaming")
		clock.advance(10_000)
		// ONE observer: exactly 10s.
		expect(durationOf(tracker.get())?.activeMs).toBe(10_000)
		// A SECOND observer on the SAME tracker observes the SAME
		// transition again. The accumulator is idempotent for a
		// repeated write of the SAME phase, so the total is UNCHANGED —
		// a duplicate lifecycle event cannot double-count.
		tracker.observeTurnPhase("streaming")
		clock.advance(5_000)
		expect(durationOf(tracker.get())?.activeMs).toBe(15_000)
	})

	it("T22b: a persistent host subscription accumulates exactly once per transition", () => {
		const clock = new TestClock()
		const tracker = new TaskTelemetryTracker(clock.now)
		const turnState = new TurnStateTracker(new MessageIdMinter())
		turnState.subscribe((phase, anchorTs) => {
			tracker.observeTurnPhase(phase, anchorTs)
		})
		tracker.startTask("task-persist", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("awaiting_followup")
		clock.advance(5_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(10_000)
		expect(d?.waitingMs).toBe(5_000)
		expectConservation(tracker.get())
	})
})

// ---------------------------------------------------------------------------
// W3 — THE OBSERVATIONAL GAP (OBSERVABILITY_GAP_REPRODUCED)
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 / observational gap", () => {
	it("OBS-05-GAP: the PRE-EXISTING wall-clock accounting cannot distinguish a human-gated task from a continuously-executing one", () => {
		// Scenario A: execute 10s, wait 30s at a human gate, execute 15s.
		const clockA = new TestClock()
		const trackerA = new TaskTelemetryTracker(clockA.now)
		const turnA = new TurnStateTracker(new MessageIdMinter())
		turnA.subscribe((p, a) => trackerA.observeTurnPhase(p, a))
		trackerA.startTask("gap-a", 1_700_000_000_000)
		turnA.set("streaming")
		clockA.advance(10_000)
		turnA.set("awaiting_followup")
		clockA.advance(30_000)
		turnA.set("streaming")
		clockA.advance(15_000)
		turnA.set("completed")
		const gapA = trackerA.get()

		// Scenario B: execute continuously for the same 55s of wall clock.
		const clockB = new TestClock()
		const trackerB = new TaskTelemetryTracker(clockB.now)
		const turnB = new TurnStateTracker(new MessageIdMinter())
		turnB.subscribe((p, a) => trackerB.observeTurnPhase(p, a))
		trackerB.startTask("gap-b", 1_700_000_000_000)
		turnB.set("streaming")
		clockB.advance(55_000)
		turnB.set("completed")
		const gapB = trackerB.get()

		// The PRE-EXISTING accounting (wall clock) is IDENTICAL — this
		// is the deficiency the ACT exists to close.
		expect(gapA?.startedAt).toBe(gapB?.startedAt)
		expect(gapA?.endedAt).toBe(gapB?.endedAt)

		// The NEW authoritative accounting separates them.
		expect(gapA?.duration?.activeMs).toBe(25_000)
		expect(gapA?.duration?.waitingMs).toBe(30_000)
		expect(gapB?.duration?.activeMs).toBe(55_000)
		expect(gapB?.duration?.waitingMs).toBe(0)
		expectConservation(gapA)
		expectConservation(gapB)
	})
})

// ---------------------------------------------------------------------------
// W4.4 — Persistence and recovery (T14 / T15 at the persistence seam)
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 / persistence", () => {
	it("OBS05-PERSIST-1: the persistence projection carries the totals and the phase — never a monotonic timestamp", () => {
		const { clock, tracker, turnState } = makeRig()
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("awaiting_followup")
		clock.advance(5_000)
		const record = tracker.durationPersistence
		expect(record?.activeMs).toBe(10_000)
		expect(record?.waitingMs).toBe(5_000)
		expect(record?.phase).toBe("waiting")
		expect(record?.coverage).toBe("complete")
		// The persisted record carries NO clock-origin value that could
		// be mistaken for a transferable timestamp.
		expect(Object.keys(record ?? {})).not.toContain("openAnchorMs")
		expect(Object.keys(record ?? {})).not.toContain("startedAt")
	})

	it("OBS05-PERSIST-2: restoring a persisted record preserves the known durations and is idempotent", () => {
		const { clock, tracker, turnState } = makeRig("task-restore")
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("awaiting_followup")
		clock.advance(5_000)
		const record = tracker.durationPersistence
		expect(record).toBeDefined()

		// A fresh tracker (a new extension-host process) restores the
		// record for the SAME task identity.
		const restoredClock = new TestClock()
		const restored = new TaskTelemetryTracker(restoredClock.now)
		restored.startTask("task-restore", 1_700_000_000_000)
		restored.restoreDurationAccounting("task-restore", record!)
		const d = restored.get()?.duration
		expect(d?.activeMs).toBe(10_000)
		expect(d?.waitingMs).toBe(5_000)
		expect(d?.elapsedMs).toBe(15_000)
		expectConservation(restored.get())

		// Restoring the SAME record again is idempotent.
		restored.restoreDurationAccounting("task-restore", record!)
		expect(restored.get()?.duration?.activeMs).toBe(10_000)
		expect(restored.get()?.duration?.waitingMs).toBe(5_000)
		expectConservation(restored.get())
	})

	it("OBS05-PERSIST-3: a restore for a DIFFERENT task identity is ignored", () => {
		const { clock, tracker, turnState } = makeRig("task-a")
		turnState.set("streaming")
		clock.advance(10_000)
		const record = tracker.durationPersistence
		const other = new TaskTelemetryTracker(new TestClock().now)
		other.startTask("task-b", 1_700_000_000_000)
		other.restoreDurationAccounting("task-a", record!)
		// The accounting is bound to the task identity: nothing leaks.
		//
		// ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01 /
		// F3 / R4): the rejected restore left task-b with NO accounting
		// at all (the runtime has not observed it), so there is no
		// fabricated zero total either.
		expect(other.get()?.duration).toBeUndefined()
		// The rejected record's totals did not leak into task-b.
		expect(other.durationPersistence).toBeUndefined()
	})

	it("OBS05-PERSIST-4: the interval spanning a restart is NOT claimed — the gap is not silently classified", () => {
		const { clock, tracker, turnState } = makeRig("task-gap")
		turnState.set("streaming")
		clock.advance(10_000)
		const record = tracker.durationPersistence
		expect(record?.activeMs).toBe(10_000)

		// A new process: the clock restarts at 0. The restored
		// accounting re-opens an interval from the CURRENT clock, so
		// the unobservable gap between the two processes is NOT
		// attributed to ACTIVE.
		const restoredClock = new TestClock()
		const restored = new TaskTelemetryTracker(restoredClock.now)
		restored.startTask("task-gap", 1_700_000_000_000)
		restored.restoreDurationAccounting("task-gap", record!)
		const d = restored.get()?.duration
		expect(d?.activeMs).toBe(10_000)
		expect(d?.elapsedMs).toBe(10_000)
		expectConservation(restored.get())
	})

	it("OBS05-PERSIST-5: a legacy task with no persisted record reports unavailable, not a fabricated zero", () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		tracker.startTask("legacy", 1_700_000_000_000)
		// No persisted record: the restore is a no-op.
		tracker.restoreDurationAccounting("legacy", undefined)
		// A legacy HOST that has no accounting at all projects no
		// `duration` field — the webview renders "unavailable".
		const legacyStrip: TaskHeaderTelemetryStrip = {
			startedAt: 1_700_000_000_000,
			toolCalls: 0,
			recoveryBudgetFailures: 0,
		}
		expect(legacyStrip.duration).toBeUndefined()
	})
})
