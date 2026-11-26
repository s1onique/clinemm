/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02)
 *
 * Executable witnesses for the CHECKPOINT-CONSERVATION repair.
 *
 * WHAT AMENDMENT-02 REPAIRS
 *
 *   RED-01 - STALE ACTIVE CHECKPOINT DURING A HUMAN GATE. Restoring an
 *            OLDER persistence checkpoint into a LIVE accounting context
 *            rewrote the live phase (active -> waiting), reset the
 *            interval anchor and rolled the accumulated totals back
 *            through per-bucket `Math.max`.
 *
 *   RED-02 - RESTORE OF A LIVE CHECKPOINT. Restoring the CURRENT
 *            persistence projection duplicated the open interval
 *            (elapsed 1000 -> 2000 ms).
 *
 *   RED-03 - STALE TERMINAL CHECKPOINT AFTER CONTINUATION. Restoring an
 *            OLDER terminal checkpoint after an authorized continuation
 *            re-froze the live accounting.
 *
 *   RED-04 - EQUAL-DURATION CHECKPOINT ORDERING. The persistence guard
 *            used the ACCUMULATED TOTALS as its freshness token, so an
 *            equal-duration lifecycle change (active -> terminal,
 *            complete -> partial coverage, a waiting-reason transition)
 *            was DROPPED.
 *
 *   RED-05 - MISSING HISTORY ITEM. A persistence attempt before the
 *            `HistoryItem` exists silently returned, so the accounting
 *            was never written and the retry after the item exists was
 *            blocked by the "already written" bookkeeping.
 *
 *   RED-06 - PERSISTENCE CHAIN LEAK. The per-task promise chain
 *            retained its tail entry after the chain drained.
 *
 * EVIDENCE CLASSIFICATION (W5)
 *
 *   SYNTHETIC_REAL      - the REAL accumulator and the REAL tracker
 *                         driven by a synthetic chronology.
 *   REAL_PRODUCTION_SEAM - the REAL controller persistence method.
 *
 *   Every `it()` below declares its own class in its name.
 */
import type { TaskDurationPersistence } from "@shared/HistoryItem"
import { describe, expect, it } from "vitest"
import { Controller as SdkController } from "./SdkController"
import { TaskTelemetryTracker } from "./task-telemetry-tracker"

const MS_PER_SECOND = 1_000

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

const TASK_ID = "task-obs05-am02"

/**
 * The tracker wired with the injected clock, exactly as production wires
 * it. The tracker is the REAL production owner of the accounting.
 */
function makeTracker(clock: TestClock): TaskTelemetryTracker {
	return new TaskTelemetryTracker(clock.now)
}

describe("OBS-05 AMENDMENT-02 — checkpoint conservation", () => {
	// -------------------------------------------------------------------
	// RED-01 — stale active checkpoint during a human gate
	// -------------------------------------------------------------------
	it("RED-01 [SYNTHETIC_REAL]: a stale active checkpoint restored during a human gate does not alter the live accounting", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)

		// Execute for 10 seconds.
		tracker.observeTurnPhase("streaming")
		clock.advance(10 * MS_PER_SECOND)

		// Capture the persistence checkpoint (the accumulated totals + phase).
		const checkpoint = tracker.durationPersistence
		expect(checkpoint).toBeDefined()
		expect(checkpoint?.phase).toBe("active")
		expect(checkpoint?.activeMs).toBe(10 * MS_PER_SECOND)

		// Enter awaiting_followup.
		tracker.observeTurnPhase("awaiting_followup")

		// Advance five seconds.
		clock.advance(5 * MS_PER_SECOND)

		const beforeRestore = tracker.get()?.duration
		expect(beforeRestore?.activeMs).toBe(10 * MS_PER_SECOND)
		expect(beforeRestore?.waitingMs).toBe(5 * MS_PER_SECOND)
		expect(beforeRestore?.elapsedMs).toBe(15 * MS_PER_SECOND)
		expect(beforeRestore?.phase).toBe("waiting")
		expect(beforeRestore?.waitingReason).toBe("USER_INPUT")

		// Attempt restoration of the EARLIER checkpoint.
		tracker.restoreDurationAccounting(TASK_ID, checkpoint)

		const afterRestore = tracker.get()?.duration
		expect(afterRestore?.activeMs).toBe(10 * MS_PER_SECOND)
		expect(afterRestore?.waitingMs).toBe(5 * MS_PER_SECOND)
		expect(afterRestore?.elapsedMs).toBe(15 * MS_PER_SECOND)
		expect(afterRestore?.phase).toBe("waiting")
		expect(afterRestore?.waitingReason).toBe("USER_INPUT")

		// Advance another three seconds: the wait keeps accruing into
		// WAITING, so the interval anchor was NOT reset by the restore.
		clock.advance(3 * MS_PER_SECOND)
		const final = tracker.get()?.duration
		expect(final?.waitingMs).toBe(8 * MS_PER_SECOND)
		expect(final?.elapsedMs).toBe(18 * MS_PER_SECOND)
		expect(final?.activeMs).toBe(10 * MS_PER_SECOND)
		expect(final?.phase).toBe("waiting")
	})

	// -------------------------------------------------------------------
	// RED-02 — restore of a live checkpoint
	// -------------------------------------------------------------------
	it("RED-02 [SYNTHETIC_REAL]: restoring the live persistence projection does not duplicate the open interval", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)

		tracker.observeTurnPhase("streaming")
		clock.advance(1 * MS_PER_SECOND)

		const live = tracker.durationPersistence
		expect(live).toBeDefined()
		expect(live?.activeMs).toBe(1 * MS_PER_SECOND)

		// Attempt to restore it into the SAME live accounting context.
		tracker.restoreDurationAccounting(TASK_ID, live)

		const afterRestore = tracker.get()?.duration
		expect(afterRestore?.elapsedMs).toBe(1 * MS_PER_SECOND)
		expect(afterRestore?.activeMs).toBe(1 * MS_PER_SECOND)

		// The next second produces exactly 2000 ms elapsed.
		clock.advance(1 * MS_PER_SECOND)
		const next = tracker.get()?.duration
		expect(next?.elapsedMs).toBe(2 * MS_PER_SECOND)
		expect(next?.activeMs).toBe(2 * MS_PER_SECOND)
	})

	// -------------------------------------------------------------------
	// RED-03 — stale terminal checkpoint after continuation
	// -------------------------------------------------------------------
	it("RED-03 [SYNTHETIC_REAL]: a stale terminal checkpoint restored after an authorized continuation does not re-freeze the live accounting", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)

		tracker.observeTurnPhase("streaming")
		clock.advance(10 * MS_PER_SECOND)
		tracker.observeTurnPhase("completed")

		const terminalCheckpoint = tracker.durationPersistence
		expect(terminalCheckpoint?.phase).toBe("terminal")
		expect(terminalCheckpoint?.activeMs).toBe(10 * MS_PER_SECOND)

		// Authorize a continuation.
		tracker.observeTurnPhase("streaming")
		clock.advance(2 * MS_PER_SECOND)

		const beforeRestore = tracker.get()?.duration
		expect(beforeRestore?.activeMs).toBe(12 * MS_PER_SECOND)
		expect(beforeRestore?.phase).toBe("active")

		// Attempt restoration of the OLDER terminal checkpoint.
		tracker.restoreDurationAccounting(TASK_ID, terminalCheckpoint)

		const afterRestore = tracker.get()?.duration
		expect(afterRestore?.activeMs).toBe(12 * MS_PER_SECOND)
		expect(afterRestore?.phase).toBe("active")

		// The next second produces exactly 13000 ms active.
		clock.advance(1 * MS_PER_SECOND)
		const next = tracker.get()?.duration
		expect(next?.activeMs).toBe(13 * MS_PER_SECOND)
		expect(next?.phase).toBe("active")
	})

	// -------------------------------------------------------------------
	// RED-04 — legacy task: unavailable before and after resumption
	// -------------------------------------------------------------------
	it("RED-04 [SYNTHETIC_REAL]: a legacy task stays unavailable before and after resumption", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)

		// A legacy task has NO persisted record: the accounting stays
		// absent and the wire field is withheld entirely.
		expect(tracker.hasDurationAccounting).toBe(false)
		expect(tracker.get()?.duration).toBeUndefined()

		// The resumption of the same legacy task must NOT fabricate a
		// historical total either.
		tracker.restoreDurationAccounting(TASK_ID, undefined)
		expect(tracker.hasDurationAccounting).toBe(false)
		expect(tracker.get()?.duration).toBeUndefined()
		expect(tracker.durationPersistence).toBeUndefined()
	})

	// -------------------------------------------------------------------
	// RED-05 — the authoritative restore happens ONCE, at activation
	// -------------------------------------------------------------------
	it("RED-05 [SYNTHETIC_REAL]: an initial nonterminal restore with partial coverage re-opens the recorded category", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)

		const record: TaskDurationPersistence = {
			activeMs: 4_000,
			waitingMs: 0,
			unknownMs: 0,
			phase: "active",
			coverage: "complete",
		}
		tracker.restoreDurationAccounting(TASK_ID, record)

		const restored = tracker.get()?.duration
		expect(restored?.activeMs).toBe(4_000)
		expect(restored?.phase).toBe("active")
		// The restart gap is UNOBSERVABLE, so the coverage is partial.
		expect(restored?.coverage).toBe("partial")

		// The reopened interval accrues from the CURRENT clock.
		clock.advance(1 * MS_PER_SECOND)
		expect(tracker.get()?.duration?.activeMs).toBe(5_000)
	})

	it("RED-06 [SYNTHETIC_REAL]: an initial terminal restore freezes the totals", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)

		const record: TaskDurationPersistence = {
			activeMs: 7_000,
			waitingMs: 1_000,
			unknownMs: 0,
			phase: "terminal",
			coverage: "complete",
		}
		tracker.restoreDurationAccounting(TASK_ID, record)

		const restored = tracker.get()?.duration
		expect(restored?.phase).toBe("terminal")
		expect(restored?.activeMs).toBe(7_000)
		expect(restored?.waitingMs).toBe(1_000)
		expect(restored?.elapsedMs).toBe(8_000)

		// Terminal values remain frozen.
		clock.advance(5 * MS_PER_SECOND)
		const later = tracker.get()?.duration
		expect(later?.elapsedMs).toBe(8_000)
		expect(later?.phase).toBe("terminal")
	})

	it("RED-07 [SYNTHETIC_REAL]: the waiting reason of a restored waiting record is conserved", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)

		const record: TaskDurationPersistence = {
			activeMs: 0,
			waitingMs: 2_000,
			unknownMs: 0,
			phase: "waiting",
			waitingReason: "TOOL_APPROVAL",
			coverage: "complete",
		}
		tracker.restoreDurationAccounting(TASK_ID, record)

		const restored = tracker.get()?.duration
		expect(restored?.phase).toBe("waiting")
		expect(restored?.waitingReason).toBe("TOOL_APPROVAL")
		expect(restored?.waitingMs).toBe(2_000)
	})
})

// ---------------------------------------------------------------------------
// W3 — the CHECKPOINT ORDERING (the REAL controller persistence method)
// ---------------------------------------------------------------------------

/**
 * A partial controller harness carrying the REAL production
 * collaborators. The method under test is the REAL `SdkController`
 * prototype method (invoked through the prototype, not re-implemented).
 */
function makeController(tracker: TaskTelemetryTracker, taskHistory: unknown): SdkController {
	return Object.assign(Object.create(SdkController.prototype) as SdkController, {
		taskTelemetry: tracker,
		taskHistory,
	})
}

function persistOf(controller: SdkController) {
	return (
		controller as unknown as {
			persistDurationAccounting: (
				taskId: string | undefined,
				record: TaskDurationPersistence | undefined,
				captureSeq?: number,
			) => Promise<void>
		}
	).persistDurationAccounting.bind(controller)
}

/**
 * A recording history store. `items` holds the `HistoryItem`s that
 * exist; `persisted` records what was written.
 */
function makeHistoryStore(known: string[] = []) {
	const persisted = new Map<string, TaskDurationPersistence>()
	const items = new Map<string, { id: string; duration?: TaskDurationPersistence }>()
	for (const id of known) {
		items.set(id, { id })
	}
	return {
		persisted,
		items,
		taskHistory: {
			findHistoryItem: async (taskId: string) => items.get(taskId) as never,
			updateTaskHistoryItem: async (item: { id: string; duration?: TaskDurationPersistence }) => {
				items.set(item.id, { ...item })
				if (item.duration) {
					persisted.set(item.id, item.duration)
				}
			},
		},
	}
}

describe("OBS-05 AMENDMENT-02 — checkpoint ordering", () => {
	// -------------------------------------------------------------------
	// RED-08 — an ACTIVE checkpoint followed by a TERMINAL checkpoint with
	//          IDENTICAL duration totals.
	// -------------------------------------------------------------------
	it("RED-08 [REAL_PRODUCTION_SEAM]: an equal-duration TERMINAL checkpoint persists after an ACTIVE one", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const { persisted, taskHistory } = makeHistoryStore(["task-equal-terminal"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		const totals = { activeMs: 10_000, waitingMs: 0, unknownMs: 0 }
		// The ACTIVE checkpoint.
		await persist("task-equal-terminal", { ...totals, phase: "active", coverage: "complete" }, 1)
		expect(persisted.get("task-equal-terminal")?.phase).toBe("active")

		// The TERMINAL checkpoint has the IDENTICAL duration totals.
		await persist("task-equal-terminal", { ...totals, phase: "terminal", coverage: "complete" }, 2)
		expect(persisted.get("task-equal-terminal")?.phase).toBe("terminal")
		expect(persisted.get("task-equal-terminal")?.activeMs).toBe(10_000)
	})

	// -------------------------------------------------------------------
	// RED-09 — COMPLETE coverage followed by PARTIAL coverage with
	//          IDENTICAL duration totals.
	// -------------------------------------------------------------------
	it("RED-09 [REAL_PRODUCTION_SEAM]: an equal-duration PARTIAL coverage checkpoint persists after a COMPLETE one", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const { persisted, taskHistory } = makeHistoryStore(["task-equal-coverage"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		const totals = { activeMs: 4_000, waitingMs: 2_000, unknownMs: 0 }
		await persist("task-equal-coverage", { ...totals, phase: "waiting", coverage: "complete" }, 1)
		expect(persisted.get("task-equal-coverage")?.coverage).toBe("complete")

		await persist("task-equal-coverage", { ...totals, phase: "waiting", coverage: "partial" }, 2)
		expect(persisted.get("task-equal-coverage")?.coverage).toBe("partial")
		expect(persisted.get("task-equal-coverage")?.activeMs).toBe(4_000)
		expect(persisted.get("task-equal-coverage")?.waitingMs).toBe(2_000)
	})

	// -------------------------------------------------------------------
	// RED-10 — an equal-duration waiting-reason transition.
	// -------------------------------------------------------------------
	it("RED-10 [REAL_PRODUCTION_SEAM]: an equal-duration waiting-reason transition persists", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const { persisted, taskHistory } = makeHistoryStore(["task-equal-reason"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		const totals = { activeMs: 0, waitingMs: 3_000, unknownMs: 0, phase: "waiting" as const }
		await persist("task-equal-reason", { ...totals, waitingReason: "USER_INPUT", coverage: "complete" }, 1)
		expect(persisted.get("task-equal-reason")?.waitingReason).toBe("USER_INPUT")

		await persist("task-equal-reason", { ...totals, waitingReason: "TOOL_APPROVAL", coverage: "complete" }, 2)
		expect(persisted.get("task-equal-reason")?.waitingReason).toBe("TOOL_APPROVAL")
		expect(persisted.get("task-equal-reason")?.waitingMs).toBe(3_000)
	})

	// -------------------------------------------------------------------
	// RED-11 — an OLDER checkpoint cannot replace a NEWER one.
	// -------------------------------------------------------------------
	it("RED-11 [REAL_PRODUCTION_SEAM]: an older checkpoint cannot replace a newer one", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const { persisted, taskHistory } = makeHistoryStore(["task-order-guard"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		await persist(
			"task-order-guard",
			{ activeMs: 10_000, waitingMs: 5_000, unknownMs: 0, phase: "waiting", coverage: "complete" },
			20,
		)
		expect(persisted.get("task-order-guard")?.activeMs).toBe(10_000)

		// An OLDER observation completes afterwards.
		await persist(
			"task-order-guard",
			{ activeMs: 2_000, waitingMs: 0, unknownMs: 0, phase: "active", coverage: "complete" },
			10,
		)
		expect(persisted.get("task-order-guard")?.activeMs).toBe(10_000)
		expect(persisted.get("task-order-guard")?.waitingMs).toBe(5_000)
	})

	// -------------------------------------------------------------------
	// RED-12 — a persistence attempt BEFORE the HistoryItem exists,
	//          followed by a successful retry.
	// -------------------------------------------------------------------
	it("RED-12 [REAL_PRODUCTION_SEAM]: a persistence attempt before the HistoryItem exists is not durable and a later retry succeeds", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const { persisted, items, taskHistory } = makeHistoryStore([])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		const record: TaskDurationPersistence = {
			activeMs: 5_000,
			waitingMs: 0,
			unknownMs: 0,
			phase: "active",
			coverage: "complete",
		}

		// The HistoryItem does not exist yet.
		await persist("task-late-history", record, 1)
		expect(persisted.has("task-late-history")).toBe(false)

		// The HistoryItem appears, and the accounting is retried with the
		// SAME capture order.
		//
		// This is the load-bearing assertion: a skipped write must NOT be
		// marked durable, so the very same checkpoint is still eligible
		// for the retry. If the skipped write advanced the freshness
		// bookkeeping, this retry (capture order 1, not strictly newer
		// than the recorded 1) would be DROPPED and the accounting would
		// never reach the history slot.
		items.set("task-late-history", { id: "task-late-history" })
		await persist("task-late-history", record, 1)
		expect(persisted.get("task-late-history")?.activeMs).toBe(5_000)
	})

	// -------------------------------------------------------------------
	// RED-13 — a persistence chain that DRAINS must not leak its entry.
	// -------------------------------------------------------------------
	it("RED-13 [REAL_PRODUCTION_SEAM]: a drained persistence chain removes its map entry", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const { taskHistory } = makeHistoryStore(["task-drain"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		await persist("task-drain", { activeMs: 1_000, waitingMs: 0, unknownMs: 0, phase: "active", coverage: "complete" }, 1)

		const chains = (controller as unknown as { durationChains: Map<string, Promise<unknown>> }).durationChains
		expect(chains.size).toBe(0)
	})

	// -------------------------------------------------------------------
	// RED-14 — the capture order travels with the bound pair.
	// -------------------------------------------------------------------
	it("RED-14 [SYNTHETIC_REAL]: the bound persistence pair carries the capture order", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)
		tracker.observeTurnPhase("streaming")

		const first = tracker.boundDurationPersistence
		const second = tracker.boundDurationPersistence
		expect(first?.captureSeq).toBeDefined()
		expect(second?.captureSeq).toBeDefined()
		// The capture order is strictly monotonic across captures.
		expect(second!.captureSeq).toBeGreaterThan(first!.captureSeq)
	})
})

// ---------------------------------------------------------------------------
// W5 — the UNKNOWN-PHASE handling and the task/epoch authority
// ---------------------------------------------------------------------------

describe("OBS-05 AMENDMENT-02 — unknown phase and task authority", () => {
	it("RED-15 [SYNTHETIC_REAL]: an unrecognized authoritative phase does NOT silently continue the previous classification", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)

		tracker.observeTurnPhase("awaiting_followup")
		clock.advance(5 * MS_PER_SECOND)

		const before = tracker.get()?.duration
		expect(before?.phase).toBe("waiting")
		expect(before?.waitingMs).toBe(5 * MS_PER_SECOND)

		// An UNRECOGNIZED authoritative phase.
		tracker.observeTurnPhase("some_future_phase")

		const after = tracker.get()?.duration
		// The classification moves to the explicit uncertainty mechanism.
		expect(after?.phase).toBe("unknown")
		// The previous category did NOT grow: the time is not attributed
		// to it.
		expect(after?.waitingMs).toBe(5 * MS_PER_SECOND)
		expect(after?.activeMs).toBe(0)

		// The time after the unrecognized phase accrues as UNKNOWN.
		clock.advance(3 * MS_PER_SECOND)
		const later = tracker.get()?.duration
		expect(later?.unknownMs).toBe(3 * MS_PER_SECOND)
		expect(later?.waitingMs).toBe(5 * MS_PER_SECOND)
		// Conservation still holds exactly.
		expect(later?.elapsedMs).toBe(later!.activeMs + later!.waitingMs + later!.unknownMs)
	})

	it("RED-16 [SYNTHETIC_REAL]: a task switch never inherits another task's accounting", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)

		tracker.startTask("task-a")
		tracker.observeTurnPhase("streaming")
		clock.advance(7 * MS_PER_SECOND)
		expect(tracker.get()?.duration?.activeMs).toBe(7 * MS_PER_SECOND)

		// A NEW task identity resets the accounting.
		tracker.startTask("task-b")
		tracker.observeTurnPhase("streaming")
		clock.advance(2 * MS_PER_SECOND)

		const b = tracker.get()?.duration
		expect(b?.taskId).toBe("task-b")
		expect(b?.activeMs).toBe(2 * MS_PER_SECOND)
	})

	it("RED-17 [SYNTHETIC_REAL]: a stale phase write from a superseded epoch cannot reopen the accounting", () => {
		const clock = new TestClock()
		let currentEpoch = 5
		const tracker = new TaskTelemetryTracker(clock.now, () => currentEpoch)
		tracker.startTask(TASK_ID)

		tracker.observeTurnPhase("streaming", undefined, 5)
		clock.advance(4 * MS_PER_SECOND)
		expect(tracker.get()?.duration?.activeMs).toBe(4 * MS_PER_SECOND)

		// The epoch fence advances.
		currentEpoch = 6
		// A write from the SUPERSEDED epoch is rejected.
		tracker.observeTurnPhase("awaiting_followup", undefined, 5)
		const after = tracker.get()?.duration
		expect(after?.phase).toBe("active")
		expect(after?.waitingMs).toBe(0)
		expect(after?.activeMs).toBe(4 * MS_PER_SECOND)

		// A write from the CURRENT epoch IS accepted.
		tracker.observeTurnPhase("awaiting_followup", undefined, 6)
		expect(tracker.get()?.duration?.phase).toBe("waiting")
	})
})

// ---------------------------------------------------------------------------
// W2 — the LEGACY RESUME COVERAGE: the SAME legacy task, before and after
//      resumption.
// ---------------------------------------------------------------------------

describe("OBS-05 AMENDMENT-02 — legacy resume coverage", () => {
	it("RED-18 [SYNTHETIC_REAL]: the SAME legacy task is unavailable BEFORE and AFTER resumption", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)

		// BEFORE the resumption: the legacy task is activated. It has NO
		// persisted accounting record (it was recorded before the
		// accounting existed).
		tracker.startTask("task-legacy")
		expect(tracker.hasDurationAccounting).toBe(false)
		expect(tracker.get()?.duration).toBeUndefined()
		expect(tracker.durationPersistence).toBeUndefined()
		expect(tracker.boundDurationPersistence).toBeUndefined()

		// The task then runs, so the accounting BECOMES available for the
		// live part of this session.
		tracker.observeTurnPhase("streaming")
		clock.advance(3 * MS_PER_SECOND)
		expect(tracker.hasDurationAccounting).toBe(true)
		expect(tracker.get()?.duration?.activeMs).toBe(3 * MS_PER_SECOND)

		// AFTER the resumption: the SAME legacy task is re-activated and
		// the production restoration path reads its (absent) record.
		//
		// The production resumption switches away and back, so the
		// accounting is reset by the task-identity change and the
		// restoration path runs against the (absent) record.
		tracker.startTask("task-other")
		tracker.startTask("task-legacy")
		expect(tracker.hasDurationAccounting).toBe(false)
		expect(tracker.get()?.duration).toBeUndefined()
		// The production restoration path ALSO reports that the task has
		// a REAL history that was never measured (the third argument is
		// the production fact the controller passes when the
		// `HistoryItem` exists but carries no accounting record).
		tracker.restoreDurationAccounting("task-legacy", undefined, true)
		expect(tracker.hasDurationAccounting).toBe(false)
		expect(tracker.get()?.duration).toBeUndefined()
		expect(tracker.durationPersistence).toBeUndefined()

		// The legacy task NEVER claims a complete historical accounting:
		// it is unavailable, not a fabricated zero.
		tracker.observeTurnPhase("streaming")
		clock.advance(1 * MS_PER_SECOND)
		const resumed = tracker.get()?.duration
		// The live part of the resumed session IS accounted, but the
		// historical part is NOT claimed.
		expect(resumed?.activeMs).toBe(1 * MS_PER_SECOND)
		expect(resumed?.elapsedMs).toBe(1 * MS_PER_SECOND)
		// ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01
		// (CORRECTION-01 / W1): the COVERAGE is asserted. The legacy
		// task's pre-resumption history was NEVER observed by the
		// accounting, so the accounting must NOT claim COMPLETE
		// coverage: it is either UNAVAILABLE (no accounting at all) or
		// explicitly PARTIAL (the live part is measured, the history is
		// disclosed as unobserved).
		//
		// This assertion is the load-bearing part of RED-18: without it
		// the witness only proved that the legacy task is unavailable
		// BEFORE the resumption, and a resumed legacy task could have
		// published "complete" coverage without any witness noticing.
		expect(resumed?.coverage === "partial" || resumed === undefined).toBe(true)
		expect(resumed?.coverage).not.toBe("complete")
	})
})
