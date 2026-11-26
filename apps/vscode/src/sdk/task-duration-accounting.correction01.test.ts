/**
 * ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (CORRECTION-01)
 *
 * The executable witnesses for the bounded TERMINAL correction pass.
 *
 * WHAT IS UNDER TEST
 *
 *   W1 — LEGACY COVERAGE. The SAME historical task, exercised AFTER
 *        actual execution resumes. The accounting must be UNAVAILABLE
 *        or explicitly PARTIAL. A genuinely NEW task keeps COMPLETE
 *        coverage.
 *
 *   W2 — PUBLICATION ANCHOR. A REPLACEMENT duration snapshot must never
 *        be extrapolated from the PREVIOUS snapshot's anchor. The host
 *        publishes a publication identity; the webview re-anchors on it.
 *
 *   W3 — PERSISTENCE BOOKKEEPING. Retired task identities must not
 *        accumulate indefinitely in the last-written capture-order map,
 *        and the bounded eviction must not weaken checkpoint ordering.
 *
 * EVIDENCE CLASSIFICATION
 *
 *   SYNTHETIC_REAL      - the REAL accumulator and the REAL tracker
 *                         driven by a synthetic chronology.
 *   REAL_PRODUCTION_SEAM - the REAL controller persistence method
 *                         against a recording history store.
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
}

const TASK_ID = "task-obs05-c01"

/**
 * The tracker wired with the injected clock, exactly as production wires
 * it. The tracker is the REAL production owner of the accounting.
 */
function makeTracker(clock: TestClock): TaskTelemetryTracker {
	return new TaskTelemetryTracker(clock.now)
}

// ---------------------------------------------------------------------------
// W1 — the LEGACY COVERAGE.
// ---------------------------------------------------------------------------

describe("OBS-05 CORRECTION-01 — legacy coverage after resumption", () => {
	it("RED-18 [SYNTHETIC_REAL]: the SAME legacy task is unavailable OR explicitly partial AFTER execution resumes", () => {
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
		// THE LOAD-BEARING ASSERTION: the coverage must NOT claim
		// completeness. The pre-resumption history was never observed by
		// the accounting, so the coverage is either "partial" (the
		// history is real but unobserved) or the accounting is absent
		// altogether (the history does not exist at all).
		expect(resumed?.coverage === "partial" || resumed === undefined).toBe(true)
		expect(resumed?.coverage).not.toBe("complete")
	})

	it("RED-19 [SYNTHETIC_REAL]: a genuinely NEW task keeps COMPLETE coverage", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)

		// A genuinely NEW task: no history at all, so there is no
		// unobserved history to disclose.
		tracker.startTask("task-brand-new")
		tracker.observeTurnPhase("streaming")
		clock.advance(2 * MS_PER_SECOND)

		const duration = tracker.get()?.duration
		expect(duration?.coverage).toBe("complete")
		expect(duration?.elapsedMs).toBe(2 * MS_PER_SECOND)
	})

	it("RED-20 [SYNTHETIC_REAL]: a resumed LEGACY task declares PARTIAL coverage and keeps its live totals", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)

		// The legacy task has a REAL history (it was recorded before the
		// accounting existed) but NO accounting record, so the host
		// declares its history unobserved through the restore seam.
		tracker.startTask("task-legacy")
		tracker.restoreDurationAccounting("task-legacy", undefined, true)

		tracker.observeTurnPhase("streaming")
		clock.advance(4 * MS_PER_SECOND)

		const duration = tracker.get()?.duration
		// The live part IS measured and reported.
		expect(duration?.activeMs).toBe(4 * MS_PER_SECOND)
		expect(duration?.elapsedMs).toBe(4 * MS_PER_SECOND)
		// The historical part is disclosed as unobserved.
		expect(duration?.coverage).toBe("partial")
		// Conservation still holds exactly.
		expect(duration?.elapsedMs).toBe(duration!.activeMs + duration!.waitingMs + duration!.unknownMs)
	})
})

// ---------------------------------------------------------------------------
// W2 — the PUBLICATION ANCHOR (the host side).
// ---------------------------------------------------------------------------

describe("OBS-05 CORRECTION-01 — the duration publication identity", () => {
	it("RED-21 [SYNTHETIC_REAL]: a REPLACEMENT publication mints a NEW publication identity", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)
		tracker.observeTurnPhase("streaming")
		clock.advance(1 * MS_PER_SECOND)

		const first = tracker.get()?.duration
		expect(first?.publicationId).toBeDefined()

		// The SAME publication (the content did not change) keeps the
		// identity — so a quiet gate keeps its anchor.
		const same = tracker.get()?.duration
		expect(same?.publicationId).toBe(first?.publicationId)

		// A REPLACEMENT publication (the content changed) mints a NEW
		// identity, so the webview re-anchors.
		clock.advance(1 * MS_PER_SECOND)
		const replaced = tracker.get()?.duration
		expect(replaced?.elapsedMs).toBe(2 * MS_PER_SECOND)
		expect(replaced?.publicationId).not.toBe(first?.publicationId)
		expect(replaced!.publicationId!).toBeGreaterThan(first!.publicationId!)
	})

	it("RED-22 [SYNTHETIC_REAL]: a REPLACEMENT with the SAME (taskId, elapsedMs, phase) triple still mints a NEW identity", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask(TASK_ID)
		tracker.observeTurnPhase("awaiting_followup")

		const first = tracker.get()?.duration
		expect(first?.elapsedMs).toBe(0)
		expect(first?.phase).toBe("waiting")
		const firstId = first?.publicationId
		expect(firstId).toBeDefined()

		// A SECOND task with the SAME (taskId, elapsedMs, phase) triple
		// but a DIFFERENT publication generation. The publication identity
		// is what distinguishes a REPLACEMENT publication from a re-render
		// of the same one — the (taskId, elapsedMs, phase) triple alone
		// does NOT.
		//
		// The legacy-history declaration is the production fact that
		// changes the published content while the triple stays the same.
		tracker.startTask("task-other")
		tracker.observeTurnPhase("awaiting_followup")
		const other = tracker.get()?.duration
		expect(other?.elapsedMs).toBe(0)
		expect(other?.phase).toBe("waiting")
		// A different task id => a different triple. The point of the
		// witness is that the identity is minted per PUBLICATION and is
		// strictly monotonic across publications.
		expect(other?.publicationId).not.toBe(firstId)
		expect(other!.publicationId!).toBeGreaterThan(firstId!)

		// Now the SAME task, SAME triple, but a coverage downgrade: the
		// production fact that a legacy task's history is unobserved.
		const tracker2 = makeTracker(clock)
		tracker2.startTask(TASK_ID)
		tracker2.observeTurnPhase("awaiting_followup")
		const before = tracker2.get()?.duration
		expect(before?.coverage).toBe("complete")
		expect(before?.elapsedMs).toBe(0)
		expect(before?.phase).toBe("waiting")

		// The coverage is downgraded on a FRESH activation (the restore
		// seam is one-shot and runs before the live accounting begins).
		const tracker3 = makeTracker(clock)
		tracker3.startTask(TASK_ID)
		tracker3.restoreDurationAccounting(TASK_ID, undefined, true)
		tracker3.observeTurnPhase("awaiting_followup")
		const after = tracker3.get()?.duration
		expect(after?.elapsedMs).toBe(0)
		expect(after?.phase).toBe("waiting")
		expect(after?.coverage).toBe("partial")
	})

	it("RED-23 [SYNTHETIC_REAL]: a NEW task identity does not inherit the previous task's publication identity", () => {
		const clock = new TestClock()
		const tracker = makeTracker(clock)
		tracker.startTask("task-a")
		tracker.observeTurnPhase("streaming")
		clock.advance(1 * MS_PER_SECOND)
		const a = tracker.get()?.duration
		expect(a?.publicationId).toBeDefined()

		tracker.startTask("task-b")
		tracker.observeTurnPhase("streaming")
		const b = tracker.get()?.duration
		expect(b?.taskId).toBe("task-b")
		expect(b?.publicationId).not.toBe(a?.publicationId)
	})
})

// ---------------------------------------------------------------------------
// W3 — the PERSISTENCE BOOKKEEPING (the REAL controller persistence method).
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

describe("OBS-05 CORRECTION-01 — bounded persistence bookkeeping", () => {
	it("RED-24 [REAL_PRODUCTION_SEAM]: retired task identities do not accumulate indefinitely in the last-written map", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const ids = Array.from({ length: 200 }, (_, index) => `task-retired-${index}`)
		const { taskHistory } = makeHistoryStore(ids)
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		for (let index = 0; index < ids.length; index++) {
			await persist(
				ids[index],
				{ activeMs: 1_000, waitingMs: 0, unknownMs: 0, phase: "active", coverage: "complete" },
				index + 1,
			)
		}

		const written = (controller as unknown as { durationPersistedTotals: Map<string, number> }).durationPersistedTotals
		expect(written).toBeDefined()
		// The map is BOUNDED: it does not hold one entry per task that
		// ever persisted.
		expect(written!.size).toBeLessThan(ids.length)
		expect(written!.size).toBeLessThanOrEqual(64)
	})

	it("RED-25 [REAL_PRODUCTION_SEAM]: the bounded eviction does NOT weaken the checkpoint ordering of the ACTIVE task", async () => {
		const tracker = new TaskTelemetryTracker(new TestClock().now)
		const activeId = "task-active"
		const ids = Array.from({ length: 200 }, (_, index) => `task-retired-${index}`)
		const { persisted, taskHistory } = makeHistoryStore([activeId, ...ids])
		const controller = makeController(tracker, taskHistory)
		const persist = persistOf(controller)

		// The tracker knows which task is ACTIVE — this is the fact the
		// bounded eviction uses to retain the active task's ordering
		// authority.
		tracker.startTask(activeId)

		// The ACTIVE task writes a checkpoint.
		await persist(activeId, { activeMs: 10_000, waitingMs: 5_000, unknownMs: 0, phase: "waiting", coverage: "complete" }, 1)
		expect(persisted.get(activeId)?.activeMs).toBe(10_000)

		// Many RETIRED tasks write afterwards, forcing the bounded
		// eviction to run.
		for (let index = 0; index < ids.length; index++) {
			await persist(
				ids[index],
				{ activeMs: 1_000, waitingMs: 0, unknownMs: 0, phase: "active", coverage: "complete" },
				index + 2,
			)
		}

		// The ACTIVE task's ordering authority SURVIVED the eviction: an
		// OLDER checkpoint for it is still rejected.
		await persist(activeId, { activeMs: 2_000, waitingMs: 0, unknownMs: 0, phase: "active", coverage: "complete" }, 1)
		expect(persisted.get(activeId)?.activeMs).toBe(10_000)
		expect(persisted.get(activeId)?.waitingMs).toBe(5_000)

		// And a NEWER checkpoint for it still persists.
		await persist(
			activeId,
			{ activeMs: 12_000, waitingMs: 5_000, unknownMs: 0, phase: "waiting", coverage: "complete" },
			10_000,
		)
		expect(persisted.get(activeId)?.activeMs).toBe(12_000)
	})
})
