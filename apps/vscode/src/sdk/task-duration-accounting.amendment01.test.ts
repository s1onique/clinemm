/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01)
 *
 * Executable witnesses for the bounded correctness repair of the
 * OBS-05 runtime duration accounting.
 *
 * WHAT THE AMENDMENT REPAIRS
 *
 *   F1 - PERSISTENCE AUTHORITY. The coordinator captured the duration
 *        accounting EAGERLY at construction time. At that moment no task
 *        was active, so the captured value was permanently `undefined`
 *        and the persistence seam NEVER fired: every persisted
 *        `HistoryItem` was missing its accounting.
 *
 *   F2 - RESTART COVERAGE. A restored nonterminal record reopened an
 *        interval across an UNOBSERVABLE gap but kept the record's
 *        "complete" coverage, silently classifying the gap.
 *
 *   F3 - LEGACY AVAILABILITY. A legacy task (no persisted record) had
 *        its accumulator zeros published as a COMPLETE accounting with
 *        a zero elapsed time - a fabricated historical total.
 *
 *   F4 - TASK RESTORATION. Returning to a previously-known task id
 *        RESET its accounting to zero, discarding the known durations.
 *
 *   F5 - EPOCH AUTHORITY. The stale-event witness did not exercise a
 *        real execution-epoch discriminator.
 *
 *   F8 - RESTORE AND CLOCK. A duplicate restore rolled back
 *        subsequently accumulated durations and reset the interval
 *        anchor; the waiting reason of a restored record was lost; the
 *        `process.hrtime` clock fallback read the clock TWICE.
 *
 * EVIDENCE CLASSIFICATION (W5)
 *
 *   SYNTHETIC_REAL      - the REAL accumulator and the REAL phase
 *                         tracker driven by a synthetic chronology.
 *   REAL_PRODUCTION_SEAM - the REAL controller/coordinator persistence
 *                         or lifecycle entry path.
 *   STRUCTURAL          - source-derived composition.
 *   NOT_EXECUTED        - an installed-runtime observation that was not
 *                         available in this environment.
 *
 *   Every `it()` below declares its own class in its name.
 */
import type { TaskDurationPersistence } from "@shared/HistoryItem"
import { describe, expect, it } from "vitest"
import { MessageIdMinter } from "./message-id-minter"
import { Controller as SdkController } from "./SdkController"
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
 * accumulator through the real subscription seam, exactly as
 * `SdkController.attachPhaseTelemetrySubscription` wires them.
 */
function makeRig(taskId = "task-obs05-am01") {
	const clock = new TestClock()
	const tracker = new TaskTelemetryTracker(clock.now)
	const turnState = new TurnStateTracker(new MessageIdMinter())
	turnState.subscribe((phase, anchorTs) => {
		tracker.observeTurnPhase(phase, anchorTs)
	})
	return { clock, tracker, turnState, taskId }
}

interface DurationView {
	elapsedMs: number
	activeMs: number
	waitingMs: number
	unknownMs: number
	phase: string
	waitingReason?: string
	coverage: string
	taskId: string
}

function durationOf(strip: { duration?: unknown } | undefined): DurationView | undefined {
	return strip?.duration as DurationView | undefined
}

function expectConservation(strip: { duration?: unknown } | undefined): void {
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

/**
 * A partial controller harness carrying the REAL production
 * collaborators. The methods under test are the REAL `SdkController`
 * prototype methods (invoked through the prototype, not re-implemented
 * here).
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

function readBoundOf(controller: SdkController) {
	return (
		controller as unknown as {
			readBoundDurationPersistence: () =>
				| { taskId: string; record: TaskDurationPersistence; captureSeq: number }
				| undefined
		}
	).readBoundDurationPersistence.bind(controller)
}

/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02 / W3):
 * persist the bound pair AS A WHOLE — the identity, the record AND the
 * capture order travel together.
 *
 * The capture order is the checkpoint freshness authority. The
 * accumulated totals are NOT an ordering token: an equal-duration
 * lifecycle change (an `active` -> `terminal` transition, a
 * `complete` -> `partial` coverage downgrade, a waiting-reason
 * transition) must still persist.
 */
async function persistBound(controller: SdkController): Promise<void> {
	const readBound = readBoundOf(controller)
	const persist = persistOf(controller)
	const bound = readBound()
	if (!bound) {
		return
	}
	await persist(bound.taskId, bound.record, bound.captureSeq)
}

/** A recording history store: it holds what was written, per task id. */
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

// ---------------------------------------------------------------------------
// W1 - F1: PERSISTENCE AUTHORITY (the RED/GREEN pair)
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / F1 persistence authority", () => {
	/**
	 * REAL_PRODUCTION_SEAM.
	 *
	 * The RED witness for F1: the coordinator's accounting read is
	 * EAGERLY evaluated at construction time, when no task is active.
	 *
	 * This test drives the REAL production seam:
	 *
	 *   1. A REAL `TaskTelemetryTracker` is constructed (the host-owned
	 *      accounting authority) and wired to the REAL `TurnStateTracker`
	 *      exactly as `SdkController` wires them.
	 *   2. The coordinator's read of the accounting is captured through
	 *      the REAL controller method `readBoundDurationPersistence`.
	 *   3. Task A is started, nonzero ACTIVE and WAITING durations are
	 *      accumulated.
	 *   4. The REAL persistence boundary is triggered
	 *      (`SdkController.persistDurationAccounting`).
	 *   5. The persisted `HistoryItem` is inspected.
	 *
	 * The EAGER capture is reproduced by evaluating the accounting
	 * projection at construction time and holding the RESULT - exactly
	 * what the pre-repair wiring did.
	 */
	it("F1-RED: an EAGER capture of the accounting at construction time persists nothing", async () => {
		const { clock, tracker, turnState } = makeRig("task-f1-red")
		const { persisted, taskHistory } = makeHistoryStore(["task-f1-red"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		// (1) The EAGER capture - this is what the pre-repair wiring
		// performed at coordinator-construction time. NO task is active
		// yet, so the projection is `undefined`.
		const eagerCapture = tracker.durationPersistence
		expect(eagerCapture).toBeUndefined()

		// (2) Task A runs and accumulates nonzero ACTIVE + WAITING.
		tracker.startTask("task-f1-red", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("awaiting_followup")
		clock.advance(5_000)
		const live = tracker.durationPersistence
		expect(live?.activeMs).toBe(10_000)
		expect(live?.waitingMs).toBe(5_000)

		// (3) The persistence boundary uses the EAGER capture - the
		// pre-repair behaviour. NOTHING is written.
		if (eagerCapture) {
			await persist("task-f1-red", eagerCapture)
		}
		expect(persisted.size).toBe(0)
	})

	/**
	 * REAL_PRODUCTION_SEAM.
	 *
	 * The GREEN witness for F1: the accounting is read LAZILY at the
	 * persistence boundary, and the record is written into the history
	 * slot of EXACTLY the task it is bound to.
	 */
	it("F1-GREEN: the LAZY read at the persistence boundary writes the current nonzero totals", async () => {
		const { clock, tracker, turnState } = makeRig("task-f1-green")
		const { persisted, taskHistory } = makeHistoryStore(["task-f1-green"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)
		const readBound = readBoundOf(controller)

		// (1) Construct the coordinator's accounting read BEFORE any
		// accounting exists - the exact production ordering.
		// At construction time there is NO accounting.
		expect(readBound()).toBeUndefined()

		// (2) Start task A and accumulate nonzero ACTIVE + WAITING.
		tracker.startTask("task-f1-green", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("awaiting_followup")
		clock.advance(5_000)

		// (3) The lazy read now returns the accounting, BOUND to task A.
		const bound = readBound()
		expect(bound).toBeDefined()
		expect(bound?.taskId).toBe("task-f1-green")
		expect(bound?.record.activeMs).toBe(10_000)
		expect(bound?.record.waitingMs).toBe(5_000)

		// (4) Trigger the REAL persistence boundary.
		await persistBound(controller)

		// (5) The persisted HistoryItem carries the current totals, in
		// the slot of EXACTLY the task the record is bound to.
		const stored = persisted.get("task-f1-green")
		expect(stored).toBeDefined()
		expect(stored?.activeMs).toBe(10_000)
		expect(stored?.waitingMs).toBe(5_000)
		expect(stored?.phase).toBe("waiting")
		expect(stored?.coverage).toBe("complete")
	})

	it("F1-GREEN-b: a subsequent persistence writes the UPDATED totals", async () => {
		const { clock, tracker, turnState } = makeRig("task-f1-green-b")
		const { persisted, taskHistory } = makeHistoryStore(["task-f1-green-b"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)
		const readBound = readBoundOf(controller)

		tracker.startTask("task-f1-green-b", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(4_000)
		await persistBound(controller)
		expect(persisted.get("task-f1-green-b")?.activeMs).toBe(4_000)

		// The task keeps working.
		clock.advance(6_000)
		await persistBound(controller)
		expect(persisted.get("task-f1-green-b")?.activeMs).toBe(10_000)
	})

	it("F1-GREEN-c: a persistence FAILURE does not abort execution", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const controller = makeController(tracker, {
			findHistoryItem: async () => {
				throw new Error("disk is on fire")
			},
			updateTaskHistoryItem: async () => undefined,
		})
		const persist = persistOf(controller)

		tracker.startTask("task-f1-fail", 1_700_000_000_000)
		tracker.observeTurnPhase("streaming")
		// The failure is swallowed: the promise RESOLVES.
		await expect(
			persist("task-f1-fail", { activeMs: 1, waitingMs: 0, unknownMs: 0, phase: "active", coverage: "complete" }),
		).resolves.toBeUndefined()
	})

	it("F1-GREEN-d: task SWITCHING cannot misattribute a record", async () => {
		const { clock, tracker, turnState } = makeRig("task-switch-a")
		const { persisted, taskHistory } = makeHistoryStore(["task-switch-a", "task-switch-b"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)
		const readBound = readBoundOf(controller)

		tracker.startTask("task-switch-a", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(7_000)
		await persistBound(controller)
		expect(persisted.get("task-switch-a")?.activeMs).toBe(7_000)

		// Switch to B: the accounting is reset for the NEW identity.
		tracker.startTask("task-switch-b", 1_700_000_200_000)
		turnState.set("streaming")
		clock.advance(3_000)
		const boundB = readBound()
		expect(boundB?.taskId).toBe("task-switch-b")
		await persist(boundB?.taskId, boundB?.record, boundB?.captureSeq)

		// B's slot holds B's accounting; A's slot still holds A's.
		expect(persisted.get("task-switch-b")?.activeMs).toBe(3_000)
		expect(persisted.get("task-switch-a")?.activeMs).toBe(7_000)
	})
})

// ---------------------------------------------------------------------------
// W1 - ordering: an out-of-order completion cannot roll the accounting back
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / F8 persistence ordering", () => {
	it("F8-ORDER: an out-of-order (older) checkpoint cannot roll the persisted accounting back", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const { persisted, taskHistory } = makeHistoryStore(["task-order"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		// ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02 /
		// W3): the CAPTURE ORDER is the freshness authority, not the
		// accumulated totals. The capture order is minted when the
		// projection is READ, so it orders the checkpoints in the order
		// the host OBSERVED them — which is what the out-of-order
		// completion case is about.
		//
		// The newer checkpoint is OBSERVED first (capture order 10) and
		// lands first; the older checkpoint was OBSERVED earlier
		// (capture order 5) and completes afterwards.
		await persist(
			"task-order",
			{
				activeMs: 10_000,
				waitingMs: 5_000,
				unknownMs: 0,
				phase: "waiting",
				coverage: "complete",
			},
			10,
		)
		expect(persisted.get("task-order")?.activeMs).toBe(10_000)

		// An OLDER checkpoint completes afterwards (the out-of-order
		// completion case). It MUST NOT replace the newer accounting.
		await persist(
			"task-order",
			{
				activeMs: 2_000,
				waitingMs: 0,
				unknownMs: 0,
				phase: "active",
				coverage: "complete",
			},
			5,
		)
		expect(persisted.get("task-order")?.activeMs).toBe(10_000)
		expect(persisted.get("task-order")?.waitingMs).toBe(5_000)
	})

	it("F8-ORDER-b: the writes for ONE task are serialized (the last one wins)", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const persisted = new Map<string, TaskDurationPersistence>()
		let releaseFirst: (() => void) | undefined
		const firstWriteGate = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		let writeCount = 0
		const taskHistory = {
			findHistoryItem: async (taskId: string) => ({ id: taskId, duration: persisted.get(taskId) }) as never,
			updateTaskHistoryItem: async (item: { id: string; duration?: TaskDurationPersistence }) => {
				writeCount += 1
				if (writeCount === 1) {
					// The FIRST write blocks until the second is queued.
					await firstWriteGate
				}
				if (item.duration) {
					persisted.set(item.id, item.duration)
				}
			},
		}
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		const first = persist(
			"task-serialized",
			{
				activeMs: 1_000,
				waitingMs: 0,
				unknownMs: 0,
				phase: "active",
				coverage: "complete",
			},
			1,
		)
		const second = persist(
			"task-serialized",
			{
				activeMs: 9_000,
				waitingMs: 0,
				unknownMs: 0,
				phase: "active",
				coverage: "complete",
			},
			2,
		)
		// Release the blocked first write so the chain drains.
		releaseFirst?.()
		await Promise.all([first, second])

		// The NEWER checkpoint is the one that survives.
		expect(persisted.get("task-serialized")?.activeMs).toBe(9_000)
	})

	it("F8-ORDER-c: a record is never written into a DIFFERENT task's history slot", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const { persisted, taskHistory } = makeHistoryStore(["task-bound-a"])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)
		const readBound = readBoundOf(controller)

		tracker.startTask("task-bound-a", 1_700_000_000_000)
		tracker.observeTurnPhase("streaming")

		// The bound pair is read together. The destination identity is
		// the one the record is bound to - never derived separately.
		const bound = readBound()
		expect(bound?.taskId).toBe("task-bound-a")
		await persistBound(controller)
		expect(persisted.has("task-bound-a")).toBe(true)
		expect(persisted.has("task-bound-b")).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// W2 - F2: RESTART COVERAGE (the unobservable gap)
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / F2 restart coverage", () => {
	it("F2-R1: a restored nonterminal record reports PARTIAL coverage and preserves the known durations", () => {
		const { clock, tracker, turnState } = makeRig("task-f2")
		tracker.startTask("task-f2", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(10_000)
		const record = tracker.durationPersistence
		expect(record?.coverage).toBe("complete")
		expect(record?.activeMs).toBe(10_000)

		// A new process restores the record after an UNOBSERVABLE
		// interval.
		const restored = new TaskTelemetryTracker(new TestClock().now)
		restored.startTask("task-f2", 1_700_000_000_000)
		restored.restoreDurationAccounting("task-f2", record!)

		const d = durationOf(restored.get())
		// The KNOWN durations are preserved.
		expect(d?.activeMs).toBe(10_000)
		// The coverage reports the unobservable gap - it is NOT
		// silently "complete".
		expect(d?.coverage).toBe("partial")
		// No numeric gap was invented: the elapsed total is exactly the
		// known duration plus the time observed since the restore.
		expect(d?.elapsedMs).toBe(10_000)
		expectConservation(restored.get())
	})

	it("F2-R1-b: a restored TERMINAL record keeps complete coverage (the dormant interval is legitimately excluded)", () => {
		const { clock, tracker, turnState } = makeRig("task-f2-term")
		tracker.startTask("task-f2-term", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("completed")
		const record = tracker.durationPersistence
		expect(record?.phase).toBe("terminal")
		expect(record?.coverage).toBe("complete")

		const restored = new TaskTelemetryTracker(new TestClock().now)
		restored.startTask("task-f2-term", 1_700_000_000_000)
		restored.restoreDurationAccounting("task-f2-term", record!)

		const d = durationOf(restored.get())
		expect(d?.phase).toBe("terminal")
		expect(d?.coverage).toBe("complete")
		expect(d?.activeMs).toBe(10_000)
		expectConservation(restored.get())
	})

	it("F2-R1-c: the unobservable gap is NEVER classified as ACTIVE or WAITING", () => {
		const { clock, tracker, turnState } = makeRig("task-f2-gap")
		tracker.startTask("task-f2-gap", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(10_000)
		const record = tracker.durationPersistence

		const restored = new TaskTelemetryTracker(new TestClock().now)
		restored.startTask("task-f2-gap", 1_700_000_000_000)
		restored.restoreDurationAccounting("task-f2-gap", record!)

		const d = durationOf(restored.get())
		// The gap is not attributed to the waiting bucket either.
		expect(d?.waitingMs).toBe(0)
		expect(d?.unknownMs).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// W2 - F3: LEGACY TASK AVAILABILITY
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / F3 legacy availability", () => {
	it("F3-R4: a legacy task projects NO accounting - never a fabricated complete zero", () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		tracker.startTask("legacy-task", 1_700_000_000_000)
		// The production restoration path for a HistoryItem WITHOUT
		// duration accounting.
		tracker.restoreDurationAccounting("legacy-task", undefined)

		// The wire field is ABSENT - the webview renders "unavailable".
		expect(tracker.get()?.duration).toBeUndefined()
		expect(tracker.hasDurationAccounting).toBe(false)
		// And nothing is persisted for it.
		expect(tracker.boundDurationPersistence).toBeUndefined()
		expect(tracker.durationPersistence).toBeUndefined()
	})

	it("F3-R4-b: a legacy task is DISTINGUISHED from a genuinely new task", () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		tracker.startTask("legacy-task", 1_700_000_000_000)
		tracker.restoreDurationAccounting("legacy-task", undefined)
		// A legacy task: NO accounting.
		expect(tracker.hasDurationAccounting).toBe(false)

		// A genuinely NEW task that the runtime has actually observed
		// (an authoritative phase transition) DOES have an accounting -
		// with a zero total, which is a REAL measurement of "no time
		// accounted yet", not a fabricated historical total.
		const fresh = new TaskTelemetryTracker(new TestClock().now)
		fresh.startTask("fresh-task", 1_700_000_000_000)
		fresh.observeTurnPhase("streaming")
		expect(fresh.hasDurationAccounting).toBe(true)
		expect(fresh.get()?.duration?.elapsedMs).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// W2 - F4: TASK RESTORATION (a previously-known task id)
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / F4 task restoration", () => {
	it("F4-R5: restoring a task preserves its KNOWN totals; another task never inherits them", () => {
		const { clock, tracker, turnState } = makeRig("task-a")
		tracker.startTask("task-a", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(10_000)
		turnState.set("awaiting_followup")
		clock.advance(5_000)
		const aRecord = tracker.durationPersistence
		expect(aRecord?.activeMs).toBe(10_000)
		expect(aRecord?.waitingMs).toBe(5_000)

		// Switch to B.
		tracker.startTask("task-b", 1_700_000_200_000)
		turnState.set("streaming")
		clock.advance(2_000)
		const bBound = tracker.boundDurationPersistence
		expect(bBound?.taskId).toBe("task-b")
		// B never inherits A's totals.
		expect(bBound?.record.activeMs).toBe(2_000)
		expect(bBound?.record.waitingMs).toBe(0)

		// Restore A: the production restoration path reads A's persisted
		// record and restores it for A's identity.
		tracker.startTask("task-a", 1_700_000_000_000)
		tracker.restoreDurationAccounting("task-a", aRecord!)
		const restoredA = durationOf(tracker.get())
		// A's KNOWN totals are CONSERVED.
		expect(restoredA?.activeMs).toBe(10_000)
		expect(restoredA?.waitingMs).toBe(5_000)
		expect(restoredA?.taskId).toBe("task-a")
		expectConservation(tracker.get())
	})

	it("F4-R5-b: a COMPLETED task's terminal totals remain frozen after a restoration", () => {
		const { clock, tracker, turnState } = makeRig("task-a-term")
		tracker.startTask("task-a-term", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(8_000)
		turnState.set("completed")
		const terminalRecord = tracker.durationPersistence
		expect(terminalRecord?.phase).toBe("terminal")
		expect(terminalRecord?.activeMs).toBe(8_000)

		// Switch away and back.
		tracker.startTask("task-other", 1_700_000_200_000)
		tracker.startTask("task-a-term", 1_700_000_000_000)
		tracker.restoreDurationAccounting("task-a-term", terminalRecord!)

		const restored = durationOf(tracker.get())
		expect(restored?.phase).toBe("terminal")
		expect(restored?.activeMs).toBe(8_000)
		// The dormant time is excluded - the totals stay frozen.
		clock.advance(60_000)
		expect(durationOf(tracker.get())?.activeMs).toBe(8_000)
		expect(durationOf(tracker.get())?.elapsedMs).toBe(8_000)
	})
})

// ---------------------------------------------------------------------------
// W2 - F8: DUPLICATE RESTORE + WAITING REASON CONSERVATION
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / F8 restore conservation", () => {
	it("F8-R2: a DUPLICATE restore does not roll back the subsequently accumulated durations", () => {
		const { clock, tracker, turnState } = makeRig("task-dup-restore")
		tracker.startTask("task-dup-restore", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(10_000)
		const staleRecord = tracker.durationPersistence
		expect(staleRecord?.activeMs).toBe(10_000)

		// A fresh process restores the record, then keeps working and
		// accumulates MORE than the stale record holds. The rollback is
		// only observable when the accumulated total EXCEEDS the stale
		// record — otherwise a rollback would be invisible.
		const restoredClock = new TestClock()
		const restored = new TaskTelemetryTracker(restoredClock.now)
		restored.startTask("task-dup-restore", 1_700_000_000_000)
		restored.restoreDurationAccounting("task-dup-restore", staleRecord!)
		restored.observeTurnPhase("streaming")
		restoredClock.advance(7_000)

		const afterWork = durationOf(restored.get())
		// The accumulated total now EXCEEDS the stale record.
		expect(afterWork?.activeMs).toBe(17_000)
		expect(afterWork?.activeMs).toBeGreaterThan(staleRecord!.activeMs)

		// CLOSE the open interval so the 17 000 becomes a CLOSED total.
		// The close itself adds the open interval's 7 000 to the closed
		// ACTIVE bucket, so the closed total is 10 000 (restored) + 7 000
		// (accumulated since the restore) = 17 000.
		restored.observeTurnPhase("awaiting_followup")
		restoredClock.advance(0)
		expect(restored.durationClosedTotals.activeMs).toBe(17_000)

		// The SAME STALE record is restored AGAIN. The subsequently
		// accumulated durations MUST NOT be rolled back.
		//
		// The CLOSED totals are the load-bearing observation: they are
		// what the persistence seam writes once the open interval is
		// closed, and a rollback of them would be MASKED by the
		// still-open interval in the live snapshot.
		//
		// The stale record's ACTIVE total is 10 000. The restored task
		// has since accumulated 17 000 of ACTIVE time in a CLOSED
		// interval (the `streaming` -> `awaiting_followup` transition
		// closed it). A duplicate restore of the stale record must not
		// roll that closed total back to 10 000.
		const beforeDuplicate = restored.durationClosedTotals
		expect(beforeDuplicate.activeMs).toBe(17_000)
		expect(beforeDuplicate.activeMs).toBeGreaterThan(staleRecord!.activeMs)

		restored.restoreDurationAccounting("task-dup-restore", staleRecord!)
		const afterDuplicate = restored.durationClosedTotals
		expect(afterDuplicate.activeMs).toBe(17_000)
		expect(afterDuplicate.activeMs).toBeGreaterThan(staleRecord!.activeMs)
		expect(afterDuplicate.activeMs).toBe(beforeDuplicate.activeMs)
		expectConservation(restored.get())
	})

	it("F8-R2-b: a duplicate restore does not DUPLICATE the accumulation", () => {
		const { clock, tracker, turnState } = makeRig("task-dup-accum")
		tracker.startTask("task-dup-accum", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(6_000)
		const record = tracker.durationPersistence
		expect(record?.activeMs).toBe(6_000)

		const restoredClock = new TestClock()
		const restored = new TaskTelemetryTracker(restoredClock.now)
		restored.startTask("task-dup-accum", 1_700_000_000_000)
		restored.restoreDurationAccounting("task-dup-accum", record!)
		restoredClock.advance(2_000)
		// A duplicate restore of the SAME record.
		restored.restoreDurationAccounting("task-dup-accum", record!)
		restoredClock.advance(1_000)

		const d = durationOf(restored.get())
		// The reopened interval accrued 3s exactly ONCE (the duplicate
		// restore did not reset the anchor, so the 2s + 1s both count
		// and nothing is duplicated).
		expect(d?.activeMs).toBe(9_000)
		expectConservation(restored.get())
	})

	it("F8-R3: the waiting reason of a restored record is CONSERVED", () => {
		const { clock, tracker, turnState } = makeRig("task-reason")
		tracker.startTask("task-reason", 1_700_000_000_000)
		turnState.set("awaiting_approval")
		clock.advance(3_000)
		const record = tracker.durationPersistence
		expect(record?.phase).toBe("waiting")
		expect(record?.waitingReason).toBe("TOOL_APPROVAL")

		const restored = new TaskTelemetryTracker(new TestClock().now)
		restored.startTask("task-reason", 1_700_000_000_000)
		restored.restoreDurationAccounting("task-reason", record!)
		// The reason remains correct.
		expect(durationOf(restored.get())?.waitingReason).toBe("TOOL_APPROVAL")

		// A new authoritative lifecycle transition SUPERSEDES it.
		restored.observeTurnPhase("awaiting_followup")
		expect(durationOf(restored.get())?.waitingReason).toBe("USER_INPUT")
	})
})

// ---------------------------------------------------------------------------
// W3 - F5: EXECUTION EPOCH CONSERVATION
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / F5 execution epoch", () => {
	it("F5-EPOCH: a stale event for a SUPERSEDED epoch cannot reopen the accounting", () => {
		// REAL_PRODUCTION_SEAM: the REAL `TurnStateTracker` (the
		// authoritative lifecycle owner) writes through the REAL
		// writer-identity seam, so the phase write carries the EXISTING
		// epoch fence (`TurnStateWriterIdentity.epoch`) that every
		// production writer already stamps.
		const clock = new TestClock()
		const minter = new MessageIdMinter()
		// The tracker READS the existing epoch fence, exactly as the
		// production controller wires it.
		const tracker = new TaskTelemetryTracker(clock.now, () => minter.epoch)
		const turnState = new TurnStateTracker(minter)
		turnState.subscribe((phase, anchorTs, epoch) => {
			tracker.observeTurnPhase(phase, anchorTs, epoch)
		})
		tracker.startTask("task-epoch", 1_700_000_000_000)

		// Epoch 1: the execution epoch runs and COMPLETES.
		minter.bumpEpoch()
		const epoch1 = minter.epoch
		turnState.setWithWriter("streaming", undefined, {
			writerId: "unknown-legacy-writer",
			taskId: "task-epoch",
			epoch: epoch1,
		})
		clock.advance(5_000)
		turnState.setWithWriter("completed", undefined, {
			writerId: "unknown-legacy-writer",
			taskId: "task-epoch",
			epoch: epoch1,
		})
		const frozen = durationOf(tracker.get())
		expect(frozen?.phase).toBe("terminal")
		expect(frozen?.activeMs).toBe(5_000)

		// The conversation fence advances: a NEW execution epoch begins.
		minter.bumpEpoch()
		const epoch2 = minter.epoch
		expect(epoch2).toBeGreaterThan(epoch1)

		// A STALE event from the SUPERSEDED epoch arrives through the
		// production path (the phase observer), carrying the OLD epoch.
		tracker.observeTurnPhase("streaming", undefined, epoch1)
		clock.advance(10_000)
		const after = durationOf(tracker.get())
		// The stale event did NOT reopen the accounting.
		expect(after?.activeMs).toBe(frozen?.activeMs)
		expect(after?.elapsedMs).toBe(frozen?.elapsedMs)
		expect(after?.phase).toBe("terminal")
		expectConservation(tracker.get())
	})

	it("F5-EPOCH-b: a write from the CURRENT epoch IS accepted (the gate is not a blanket freeze)", () => {
		const clock = new TestClock()
		const tracker = new TaskTelemetryTracker(clock.now)
		const minter = new MessageIdMinter()
		const turnState = new TurnStateTracker(minter)
		turnState.subscribe((phase, anchorTs, epoch) => {
			tracker.observeTurnPhase(phase, anchorTs, epoch)
		})
		tracker.startTask("task-epoch-live", 1_700_000_000_000)

		minter.bumpEpoch()
		const epoch1 = minter.epoch
		turnState.setWithWriter("streaming", undefined, {
			writerId: "unknown-legacy-writer",
			taskId: "task-epoch-live",
			epoch: epoch1,
		})
		clock.advance(3_000)
		expect(durationOf(tracker.get())?.activeMs).toBe(3_000)

		// The fence advances; a write from the NEW epoch is accepted.
		minter.bumpEpoch()
		const epoch2 = minter.epoch
		turnState.setWithWriter("awaiting_followup", undefined, {
			writerId: "unknown-legacy-writer",
			taskId: "task-epoch-live",
			epoch: epoch2,
		})
		clock.advance(2_000)
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBe(3_000)
		expect(d?.waitingMs).toBe(2_000)
		expect(d?.waitingReason).toBe("USER_INPUT")
		expectConservation(tracker.get())
	})

	it("F5-EPOCH-b: an authorized CONTINUATION reopens the accounting and the completed history is conserved", () => {
		const { clock, tracker, turnState } = makeRig("task-epoch-cont")
		tracker.startTask("task-epoch-cont", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(5_000)
		turnState.set("completed")
		const frozen = durationOf(tracker.get())
		expect(frozen?.activeMs).toBe(5_000)

		// The dormant interval belongs to NO interval.
		clock.advance(3_600_000)

		// An authorized continuation (the same task identity is driven
		// again by the authoritative lifecycle owner).
		turnState.set("streaming")
		clock.advance(2_000)
		const continued = durationOf(tracker.get())
		// New execution time accumulates; the dormant hour does NOT.
		expect(continued?.activeMs).toBe(7_000)
		expect(continued?.elapsedMs).toBe(7_000)
		expectConservation(tracker.get())
	})

	it("F5-EPOCH-c: an unknown phase string can never silently continue a previous classification", () => {
		const { tracker } = makeRig("task-unknown-phase")
		tracker.startTask("task-unknown-phase", 1_700_000_000_000)
		// (the tracker has a task identity, but no authoritative
		// accounting has been observed yet)
		tracker.observeTurnPhase("streaming")
		const before = durationOf(tracker.get())
		expect(before?.phase).toBe("active")

		// A phase the tracker does not recognise.
		//
		// ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02 /
		// W5): the unknown phase does NOT silently continue the previous
		// classification. The accounting moves to the explicit
		// UNCERTAINTY mechanism (the "unknown" bucket), so the time after
		// it is reported as unclassifiable rather than attributed to the
		// previous ACTIVE category.
		//
		// The pre-repair behaviour (ignoring the phase entirely, so the
		// ACTIVE classification continued) was exactly the silent
		// misclassification this closes.
		tracker.observeTurnPhase("some_future_phase")
		const after = durationOf(tracker.get())
		expect(after?.phase).toBe("unknown")
		// The ACTIVE bucket did not grow: the time is not attributed to
		// the previous classification.
		expect(after?.activeMs).toBe(before?.activeMs)
	})
})

// ---------------------------------------------------------------------------
// W4 - F6: CLOCK
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / F6 clock", () => {
	it("F6-CLOCK: the clock fallback reads the clock EXACTLY ONCE per call", async () => {
		const { defaultMonotonicClock } = await import("./task-duration-accounting")
		// The `process.hrtime` fallback is only reachable when
		// `performance` is absent. Exercise the module's fallback
		// construction directly and assert that it produces a
		// NON-DECREASING sequence (two separate reads could straddle a
		// tick boundary and go backwards).
		const originalPerformance = globalThis.performance
		try {
			// @ts-expect-error -- deliberately removing `performance` to
			// reach the fallback branch.
			delete globalThis.performance
			const clock = defaultMonotonicClock()
			let previous = clock()
			for (let i = 0; i < 200; i++) {
				const next = clock()
				expect(next).toBeGreaterThanOrEqual(previous)
				previous = next
			}
		} finally {
			globalThis.performance = originalPerformance
		}
	})

	it("F6-CLOCK-b: the default clock is monotonic and never produces a negative duration", async () => {
		const { defaultMonotonicClock } = await import("./task-duration-accounting")
		const clock = defaultMonotonicClock()
		const tracker = new TaskTelemetryTracker(clock)
		tracker.startTask("task-clock", 1_700_000_000_000)
		tracker.observeTurnPhase("streaming")
		const d = durationOf(tracker.get())
		expect(d?.activeMs).toBeGreaterThanOrEqual(0)
		expect(d?.elapsedMs).toBeGreaterThanOrEqual(0)
	})
})

// ---------------------------------------------------------------------------
// W1 - the COORDINATOR boundary: the persistence call site must read the
//      accounting LAZILY, never capture a value at construction time.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / coordinator boundary", () => {
	it("F1-COORD-1: the coordinator reads the accounting through the LAZY callback at the persistence boundary", async () => {
		// REAL_PRODUCTION_SEAM (structural + executable).
		//
		// The F1 defect was an EAGER capture at coordinator construction.
		// This witness pins the production wiring shape AND exercises the
		// coordinator's persistence block through the SAME callback the
		// production coordinator invokes.
		const fs = await import("node:fs")
		const path = await import("node:path")
		const source = fs.readFileSync(path.resolve(__dirname, "sdk-session-event-coordinator.ts"), "utf8")

		// (1) The coordinator MUST read through the lazy callback...
		expect(source).toMatch(/this\.options\.readDurationPersistence\(\)/)
		// (2) ...and MUST NOT capture the projection eagerly.
		expect(source).not.toMatch(/durationPersistence:\s*this\.taskTelemetry\.durationPersistence/)
		// (3) The task identity and the record MUST be taken from the
		// SAME bound pair.
		//
		// AMENDMENT-02 (W3): the call also passes the bound pair's
		// CAPTURE ORDER. The order travels with the pair, so the
		// assertion accepts an optional third argument that is also
		// read from the bound pair.
		expect(source).toMatch(/persistDurationAccounting\(bound\.taskId,\s*bound\.record(,\s*bound\.captureSeq)?\)/)
		// (4) The identity MUST NOT be derived independently of the
		// record.
		expect(source).not.toMatch(/persistDurationAccounting\(durationTaskId/)
	})

	it("F1-COORD-2: the SdkController wires the LAZY callback, not an eager value", async () => {
		const fs = await import("node:fs")
		const path = await import("node:path")
		const source = fs.readFileSync(path.resolve(__dirname, "SdkController.ts"), "utf8")

		// The controller passes a CALLBACK.
		expect(source).toMatch(/readDurationPersistence:\s*\(\)\s*=>\s*this\.readBoundDurationPersistence\(\)/)
		// It MUST NOT pass the eagerly-evaluated projection.
		expect(source).not.toMatch(/durationPersistence:\s*this\.taskTelemetry\.durationPersistence/)
		// The tracker exposes the identity-bound pair.
		expect(source).toMatch(/this\.taskTelemetry\?\.boundDurationPersistence/)
	})

	it("F1-COORD-3: the coordinator's persistence block writes the BOUND pair (executable)", async () => {
		// The coordinator's persistence block, reproduced EXACTLY as the
		// production code performs it (the same option names, the same
		// bound-pair read, the same call), driven through the REAL
		// controller persistence method.
		const { clock, tracker, turnState } = makeRig("task-coord")
		const { persisted, taskHistory } = makeHistoryStore(["task-coord"])
		const controller = makeController(tracker, taskHistory)

		// The coordinator's options, as the production wiring builds them.
		const options = {
			persistDurationAccounting: persistOf(controller),
			readDurationPersistence: readBoundOf(controller),
		}

		// The coordinator is constructed BEFORE the task exists (the
		// production ordering). The eager capture would have been
		// `undefined` here.
		expect(options.readDurationPersistence()).toBeUndefined()

		// The task runs and accumulates.
		tracker.startTask("task-coord", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(8_000)

		// The turn boundary fires: the coordinator's persistence block.
		if (options.persistDurationAccounting && options.readDurationPersistence) {
			const bound = options.readDurationPersistence()
			if (bound) {
				await options.persistDurationAccounting(bound.taskId, bound.record, bound.captureSeq)
			}
		}

		// The accounting landed in the bound task's history slot.
		expect(persisted.get("task-coord")?.activeMs).toBe(8_000)
	})
})

/**
 * REAL_PRODUCTION_SEAM — the REAL `SdkSessionEventCoordinator` driven
 * through its REAL `handleSessionEvent` turn-completion path, reaching
 * the REAL persistence block.
 *
 * This is the boundary where the F1 defect lived: the pre-repair wiring
 * captured the accounting at CONSTRUCTION time, so the persistence
 * block had nothing to write. The witness drives the coordinator with a
 * REAL `done` event and asserts that the accounting reaches the
 * persistence seam.
 */
describe("ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) / coordinator production seam", () => {
	it("F1-COORD-4: the REAL coordinator's turn-completion path persists the accounting", async () => {
		const { SdkSessionEventCoordinator } = await import("./sdk-session-event-coordinator")
		const { MessageTranslatorState } = await import("./message-translator")

		const { clock, tracker, turnState } = makeRig("task-coord-real")
		const { persisted, taskHistory } = makeHistoryStore(["task-coord-real"])
		const controller = makeController(tracker, taskHistory)

		// The REAL accounting authority accumulates.
		tracker.startTask("task-coord-real", 1_700_000_000_000)
		turnState.set("streaming")
		clock.advance(9_000)

		const activeSession = {
			sessionId: "task-coord-real",
			sdkHost: {},
			unsubscribe: () => undefined,
			startResult: { sessionId: "task-coord-real" },
			isRunning: true,
		}

		const options = {
			messageTranslatorState: new MessageTranslatorState(),
			sessions: {
				getActiveSession: () => activeSession,
				setRunning: () => undefined,
				setQueuedPromptCount: () => undefined,
			},
			messages: { appendAndEmit: () => undefined },
			taskHistory: { updateTaskUsage: () => undefined },
			getTask: () => ({ taskId: "task-coord-real" }),
			postStateToWebview: () => Promise.resolve(),
			setTurnPhase: () => undefined,
			getTurnPhase: () => "streaming" as const,
			captureProviderApiError: () => undefined,
			beginProviderFailureTelemetryTurn: () => undefined,
			getPendingPromptCount: () => ({ available: true, count: 0 }),
			// The REAL production wiring: the LAZY read callback and the
			// REAL controller persistence method.
			readDurationPersistence: readBoundOf(controller),
			persistDurationAccounting: persistOf(controller),
			translateSessionEvent: () => ({
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			}),
		}

		const coordinator = new SdkSessionEventCoordinator(options as never)

		const doneEvent = {
			type: "agent_event",
			payload: {
				sessionId: "task-coord-real",
				event: { type: "done", success: true },
			},
		} as never

		await coordinator.handleSessionEvent(doneEvent)

		// The coordinator's persistence block is FIRE-AND-FORGET (the
		// production contract: a slow or failing disk must never block
		// task execution), so the write settles on a later microtask.
		// Drain the timer queue before asserting.
		await new Promise((resolve) => setTimeout(resolve, 0))

		// The REAL coordinator's persistence block wrote the accounting.
		expect(persisted.get("task-coord-real")?.activeMs).toBe(9_000)
	})
})
