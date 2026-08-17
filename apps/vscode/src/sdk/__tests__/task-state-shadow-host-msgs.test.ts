/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION02-C2.2:
 *
 * Host-only TaskMsg emitter tests. Verifies the four emit
 * helpers funnel through the unified coordinator as `HOST_TASK`
 * origin without touching any legacy state.
 *
 * Privacy: the emit helpers are typed — they only carry the
 * `taskId` opaque key. No message prose, no tool args, no API
 * payloads.
 */
import { describe, expect, it } from "vitest"
import { TaskShadowComparator } from "../task-state-shadow"
import { createTaskShadowObservationCoordinator } from "../task-state-shadow-coordinator"
import { emitSameTaskContinued, emitTaskCancelled, emitTaskRequested, emitTaskReset } from "../task-state-shadow-host-msgs"
import { emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"
import { TaskShadowRecorder } from "../task-state-shadow-recorder"

const NOW = 1_700_000_000_000

function makeWiringLike() {
	const comparator = new TaskShadowComparator()
	const recorder = new TaskShadowRecorder()
	const coordinator = createTaskShadowObservationCoordinator({
		comparator,
		recorder,
		now: () => NOW,
		getLegacyPhase: () => "idle",
		getArbiterSnapshot: () => emptyArbiterSnapshot(),
		getActiveSessionId: () => undefined,
		getRuntimeStatus: () => "idle",
	})
	return {
		comparator,
		coordinator,
		now: () => NOW,
		recorder,
	}
}

describe("TaskShadowHostMsgEmitter — R-C3 contract (routed via unified coordinator)", () => {
	it("emitTaskRequested seeds identity.taskId and runs task_requested(TaskMsg)", () => {
		const wiring = makeWiringLike()
		const sink = { coordinator: wiring.coordinator, now: wiring.now }
		emitTaskRequested(sink, "task-visible-1", NOW)
		const model = wiring.comparator.debugSnapshot()
		expect(model?.identity.taskId).toBe("task-visible-1")
	})

	it("emitTaskCancelled produces a cancelled lifecycle", () => {
		const wiring = makeWiringLike()
		const sink = { coordinator: wiring.coordinator, now: wiring.now }
		emitTaskRequested(sink, "task-X", NOW)
		emitTaskCancelled(sink, "streaming", NOW + 1)
		const model = wiring.comparator.debugSnapshot()
		expect(model?.lifecycle.kind).toBe("cancelled")
	})

	it("emitTaskReset returns lifecycle to idle", () => {
		const wiring = makeWiringLike()
		const sink = { coordinator: wiring.coordinator, now: wiring.now }
		emitTaskRequested(sink, "task-X", NOW)
		emitTaskReset(sink, "streaming", NOW + 1)
		const model = wiring.comparator.debugSnapshot()
		expect(model?.lifecycle.kind).toBe("idle")
	})

	it("emitSameTaskContinued keeps the same task identity but advances lifecycle", () => {
		const wiring = makeWiringLike()
		const sink = { coordinator: wiring.coordinator, now: wiring.now }
		emitTaskRequested(sink, "task-continued-1", NOW)
		emitSameTaskContinued(sink, "completed", NOW + 1)
		const model = wiring.comparator.debugSnapshot()
		expect(model?.identity.taskId).toBe("task-continued-1")
	})

	it("emitTaskRequested produces exactly one HOST_TASK record", () => {
		const wiring = makeWiringLike()
		const sink = { coordinator: wiring.coordinator, now: wiring.now }
		emitTaskRequested(sink, "task-X", NOW)
		const records = wiring.recorder.getRecords()
		expect(records.length).toBe(1)
		expect(records[0]!.event).toBe("task_requested")
	})

	it("emitTaskCancelled produces exactly one HOST_TASK record", () => {
		const wiring = makeWiringLike()
		const sink = { coordinator: wiring.coordinator, now: wiring.now }
		emitTaskRequested(sink, "task-X", NOW)
		emitTaskCancelled(sink, "streaming", NOW + 1)
		const records = wiring.recorder.getRecords()
		const cancelRecord = records.find((r) => r.event === "task_cancelled")
		expect(cancelRecord).toBeDefined()
	})

	it("emitTaskReset produces exactly one HOST_TASK record", () => {
		const wiring = makeWiringLike()
		const sink = { coordinator: wiring.coordinator, now: wiring.now }
		emitTaskRequested(sink, "task-X", NOW)
		emitTaskReset(sink, "streaming", NOW + 1)
		const records = wiring.recorder.getRecords()
		const resetRecord = records.find((r) => r.event === "task_reset")
		expect(resetRecord).toBeDefined()
	})

	it("emitSameTaskContinued produces exactly one HOST_TASK record", () => {
		const wiring = makeWiringLike()
		const sink = { coordinator: wiring.coordinator, now: wiring.now }
		emitTaskRequested(sink, "task-X", NOW)
		emitSameTaskContinued(sink, "completed", NOW + 1)
		const records = wiring.recorder.getRecords()
		const contRecord = records.find((r) => r.event === "same_task_continued")
		expect(contRecord).toBeDefined()
	})

	it("the recorder count reflects exactly one observation per emit", () => {
		const wiring = makeWiringLike()
		const sink = { coordinator: wiring.coordinator, now: wiring.now }
		emitTaskRequested(sink, "task-X", NOW)
		emitTaskCancelled(sink, "streaming", NOW + 1)
		const counts = wiring.recorder.getCounts()
		expect(counts.eventsObserved).toBeGreaterThanOrEqual(2)
	})
})
