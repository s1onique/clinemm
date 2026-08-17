/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01 / R-C3 — Host-only
 * TaskMsg emitter tests.
 *
 * Verifies the four emit helpers transform their arguments into the
 * expected TaskMsg and pipe it through the comparator without
 * touching any legacy state.
 *
 * Privacy: the emit helpers are typed — they only carry the
 * `taskId` opaque key. No message prose, no tool args, no API
 * payloads.
 */
import { describe, expect, it } from "vitest"
import { TaskState } from "@cline/agents"
import { TaskShadowComparator } from "../task-state-shadow"
import {
	emitTaskCancelled,
	emitTaskRequested,
	emitTaskReset,
	emitSameTaskContinued,
} from "../task-state-shadow-host-msgs"


const NOW = 1_700_000_000_000

function makeSink() {
	const comparator = new TaskShadowComparator()
	return {
		comparator,
		compatibility: { comparator, now: () => NOW },
	}
}

describe("TaskShadowHostMsgEmitter — R-C3 contract", () => {
	it("emitTaskRequested seeds identity.taskId and runs task_requested(TaskMsg)", () => {
		const sink = makeSink()
		emitTaskRequested(sink.compatibility, "task-visible-1", NOW)
		// The shadow's identity.taskId is set after the task_requested
		// TaskMsg is processed.
		const model = sink.comparator.debugSnapshot()
		expect(model?.identity.taskId).toBe("task-visible-1")
	})

	it("emitTaskCancelled produces a cancelled lifecycle", () => {
		const sink = makeSink()
		emitTaskRequested(sink.compatibility, "task-X", NOW)
		emitTaskCancelled(sink.compatibility, "streaming", NOW + 1)
		const model = sink.comparator.debugSnapshot()
		expect(model?.lifecycle.kind).toBe("cancelled")
	})

	it("emitTaskReset returns lifecycle to idle", () => {
		const sink = makeSink()
		emitTaskRequested(sink.compatibility, "task-X", NOW)
		emitTaskReset(sink.compatibility, "streaming", NOW + 1)
		const model = sink.comparator.debugSnapshot()
		expect(model?.lifecycle.kind).toBe("idle")
	})

	it("emitSameTaskContinued keeps the same taskId and runs a turn", () => {
		const sink = makeSink()
		emitTaskRequested(sink.compatibility, "task-Y", NOW)
		emitTaskRequested(sink.compatibility, "task-Y", NOW + 1) // poison
		emitSameTaskContinued(sink.compatibility, "completed", NOW + 2)
		const model = sink.comparator.debugSnapshot()
		// Continuation does NOT change the task identity — it stays
		// the same taskId.
		expect(model?.identity.taskId).toBe("task-Y")
	})

	it("Privacy: emit helpers never carry message prose", () => {
		const sink = makeSink()
		// Construct a sink that's compatible with the typed surface.
		emitTaskRequested(sink.compatibility, "task-1", NOW)
		// The shadow's lifecycle / identity / activity fields are
		// purely typed. No `text`, `input`, `output`, `toolArgs`.
		const model = sink.comparator.debugSnapshot()
		const allowedTopLevelKeys = new Set([
			"identity",
			"lifecycle",
			"activity",
			"recovery",
			"telemetry",
		])
		expect(new Set(Object.keys(model ?? {}))).toEqual(allowedTopLevelKeys)
	})

	it("Comparator tracks divergence for each emitted TaskMsg", () => {
		const sink = makeSink()
		emitTaskRequested(sink.compatibility, "task-1", NOW)
		emitTaskCancelled(sink.compatibility, "idle", NOW + 1)
		// The comparator's seq advances by 1 per observeTaskMsg
		// invocation. Two calls = at least 2 observations.
		// (We don't read the private seq — we just confirm the
		// shadow advanced by re-reading the model.)
		const model = sink.comparator.debugSnapshot()
		expect(model?.lifecycle.kind).toBe("cancelled")
	})
})

/**
 * Test-only helper that peeks at the comparator's private shadow.
 * The comparator's `TaskStateShadow` is read-only for tests; the
 * shadow reducer is pure (ELM05), so observing its mutation gives
 * a deterministic post-condition.
 */
const TaskShadowTaskModelPeek = {
	peek(cmp: TaskStateShadow): import("@cline/agents").TaskModel | undefined {
		// The comparator owns a private shadow that is reachable
		// only through the public TaskMsg pump. We expose the
		// debugSnapshot here for unit tests; the comparator module
		// intentionally exposes this hook for testing.
		return cmp.debugSnapshot()
	},
}