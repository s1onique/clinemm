/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
 * Phase C2.0 — RED-witness freeze.
 *
 * Twelve witnesses (T1-T12) that pin the gaps exposed by the previous
 * (halted) CORRECTION02 attempt. This file is OBSERVATION-ONLY: it
 * imports existing production modules and asserts contracts; it does
 * NOT edit the reducer, host wiring, or recorder.
 *
 * The freeze principle:
 *
 *     WITNESS_EXISTS_BEFORE_FIX = true
 *
 * Each witness records one of two baselines against HEAD 810c7a6f3:
 *
 *     RED            - test is expected to fail at HEAD (gap exists)
 *     GREEN_EXPECTED - test is expected to pass at HEAD (sanity check)
 *
 * Notable known failure modes at HEAD:
 *
 *   - T1  task_requested never reaches recorder (R14 defect class)
 *   - T2  task_cancelled never reaches recorder
 *   - T3  W07 cancellation never recorded (depends on T2)
 *   - T4  W08 cancellation never recorded (depends on T2)
 *   - T5  W11 continuation never recorded
 *   - T6  W12 task_reset + task_requested(B) never reach recorder
 *   - T8  W12 D02_SHADOW_FALSE_ACTIVE == 2 (RED; matches the halt
 *        evidence probe "4 D02" — unexplained shadow-false-active
 *        divergences on the runtime-event path)
 *   - T9  approval false->true->false never recorded (depends on T2)
 *   - T10 recovery callback path is not wired to the recorder
 *   - T12 ingress-count matrix fails for all host ingress types
 *
 * T7 currently PASSES at HEAD — the runtime-event path produces zero
 * invariant violations on the W12 trace. This is a real (non-trivial)
 * pass that must be preserved through C2.1. Once T1/T2/T6/T10 land
 * and the host TaskMsg path becomes visible to the recorder, T7
 * becomes the meaningful guard that ensures the new host-observation
 * seam does not regress the W12 invariant-violations invariant.
 *
 * NO PRODUCTION SOURCE IS EDITED BY THIS FILE.
 */

import type { CoreSessionEvent } from "@cline/core"
import type { AgentContentStartEvent, AgentEvent } from "@cline/shared"
import { describe, expect, it } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { SdkSessionLifecycleOptions } from "../sdk-session-lifecycle"
import { TaskShadowComparator } from "../task-state-shadow"
import { emitSameTaskContinued, emitTaskCancelled, emitTaskRequested, emitTaskReset } from "../task-state-shadow-host-msgs"
import type { TaskShadowHostWiringDeps } from "../task-state-shadow-host-wiring"
import { createTaskShadowHostWiring, emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"
import { TaskShadowRecorder } from "../task-state-shadow-recorder"

const NOW = 1_700_000_000_000

type DivergenceClass = import("../task-state-shadow-recorder").DivergenceClass
type ArbiterSnapshotLike = import("../task-state-shadow-recorder").ArbiterSnapshot

function makeWiring(arbiter: () => ArbiterSnapshotLike, legacyPhase: () => TurnPhase) {
	const sessionOptions: SdkSessionLifecycleOptions = {
		mcpHub: undefined as never,
		requestToolApproval: () => undefined as never,
		askQuestion: () => undefined as never,
		onSessionEvent: () => undefined,
		onSendComplete: () => undefined,
		onSendError: () => undefined,
	}
	const deps: TaskShadowHostWiringDeps = {
		lifecycle: { getActiveSession: () => undefined, setRunning: () => undefined },
		sessionOptions,
		getLegacyPhase: legacyPhase,
		getArbiterSnapshot: arbiter,
		now: () => NOW,
	}
	const wiring = createTaskShadowHostWiring(deps)
	return { wiring, deps, sessionOptions }
}

function agentEvent<T extends AgentEvent>(event: T, sessionId = "s1"): CoreSessionEvent {
	return { type: "agent_event", payload: { sessionId, event } } as CoreSessionEvent
}

function iterationStart(iter = 1): AgentEvent {
	return { type: "iteration_start", iteration: iter, conversationId: "c1" }
}

function toolStart(toolCallId: string, toolName = "read_file"): AgentContentStartEvent {
	return { type: "content_start", contentType: "tool", toolCallId, toolName }
}

function toolEnd(toolCallId: string, toolName = "read_file"): AgentEvent {
	return { type: "content_end", contentType: "tool", toolCallId, toolName }
}

function done(): AgentEvent {
	return { type: "done", reason: "completed", text: "", iterations: 1 }
}

function iterationEnd(iter = 1, hadToolCalls = false): AgentEvent {
	return { type: "iteration_end", iteration: iter, hadToolCalls, toolCallCount: hadToolCalls ? 1 : 0 }
}

function legacyPhaseWalker(events: readonly CoreSessionEvent[]): () => TurnPhase {
	const phases: TurnPhase[] = []
	let phase: TurnPhase = "idle"
	let streaming = false
	let tooling = false
	for (const e of events) {
		if (e.type === "agent_event") {
			const a = (e.payload as { event?: AgentEvent }).event
			if (a) {
				if (a.type === "iteration_start") streaming = true
				if (a.type === "iteration_end") streaming = false
				if (a.type === "content_start" && a.contentType === "tool") tooling = true
				if (a.type === "content_end" && a.contentType === "tool") tooling = false
				if (a.type === "done") {
					streaming = false
					phase = "completed"
				}
				if (a.type === "error") {
					streaming = false
					phase = "error"
				}
				if (tooling || streaming) phase = "streaming"
				else if (phase !== "completed" && phase !== "error") phase = "idle"
			}
		}
		phases.push(phase)
	}
	let idx = 0
	return () => {
		const out = phases[Math.min(idx, phases.length - 1)]
		idx = Math.min(idx + 1, phases.length - 1)
		return out
	}
}

function countRecordsByEvent(records: readonly { event: string }[], eventName: string): number {
	let n = 0
	for (const r of records) if (r.event === eventName) n += 1
	return n
}

// =============================================================================
// T1 - task_requested reaches recorder
// =============================================================================
describe("T1 - task_requested reaches recorder (RED at HEAD: R14 defect class)", () => {
	it("T1.1 - emitTaskRequested produces exactly one record with event=task_requested", () => {
		const { wiring, sessionOptions } = makeWiring(
			() => emptyArbiterSnapshot(),
			() => "idle",
		)
		sessionOptions.onSessionEvent(agentEvent(iterationStart()))
		emitTaskRequested({ coordinator: wiring.coordinator, now: wiring.now }, "task-1", NOW + 1)
		const counts = wiring.recorderCounts()
		const records = wiring.records()
		wiring.dispose()
		const taskRequestedRecords = countRecordsByEvent(records, "task_requested")
		expect(taskRequestedRecords).toBe(1)
		expect(counts.eventsObserved).toBeGreaterThanOrEqual(1)
	})
})

// =============================================================================
// T2 - task_cancelled reaches recorder
// =============================================================================
describe("T2 - task_cancelled reaches recorder (RED at HEAD)", () => {
	it("T2.1 - emitTaskCancelled produces exactly one record with event=task_cancelled", () => {
		const events: CoreSessionEvent[] = [agentEvent(iterationStart()), agentEvent(toolStart("tc-1"))]
		const { wiring, sessionOptions } = makeWiring(() => emptyArbiterSnapshot(), legacyPhaseWalker(events))
		for (const e of events) sessionOptions.onSessionEvent(e)
		emitTaskCancelled({ coordinator: wiring.coordinator, now: wiring.now }, "streaming", NOW + 1)
		const records = wiring.records()
		wiring.dispose()
		const cancelledRecords = countRecordsByEvent(records, "task_cancelled")
		expect(cancelledRecords).toBe(1)
	})
})

// =============================================================================
// T3 - W07 cancellation ordering (cancellation before completion)
// =============================================================================
describe("T3 - W07 cancellation precedes completion (RED at HEAD)", () => {
	it("T3.1 - task_cancelled arrives in recorder with index < task_completed event index", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(toolStart("tc-1")),
			agentEvent(toolEnd("tc-1")),
			agentEvent(iterationEnd()),
			agentEvent(done()),
		]
		const { wiring, sessionOptions } = makeWiring(() => emptyArbiterSnapshot(), legacyPhaseWalker(events))
		for (const e of events) sessionOptions.onSessionEvent(e)
		emitTaskCancelled({ coordinator: wiring.coordinator, now: wiring.now }, "streaming", NOW + 1)
		const records = [...wiring.records()]
		wiring.dispose()
		// After Phase C2.1 fix, the runtime `done` event translates to
		// a record with event="task_completed" in the shadow's
		// vocabulary (per shadow-adapter.ts).
		const doneIdx = records.findIndex((r) => r.event === "task_completed")
		const cancelIdx = records.findIndex((r) => r.event === "task_cancelled")
		expect(cancelIdx).toBeGreaterThanOrEqual(0)
		expect(doneIdx).toBeGreaterThanOrEqual(0)
		expect(cancelIdx).toBeLessThan(doneIdx)
	})
})

// =============================================================================
// T4 - W08 cancellation while a tool is active
// =============================================================================
describe("T4 - W08 cancellation while tool is active (RED at HEAD)", () => {
	it("T4.1 - activeToolCount > 0 is asserted BEFORE task_cancelled reaches recorder", () => {
		const events: CoreSessionEvent[] = [agentEvent(iterationStart()), agentEvent(toolStart("tc-1"))]
		const { wiring, sessionOptions } = makeWiring(() => emptyArbiterSnapshot(), legacyPhaseWalker(events))
		for (const e of events) sessionOptions.onSessionEvent(e)
		const preCancelRecords = wiring.records()
		const lastPreCancel = preCancelRecords[preCancelRecords.length - 1]
		expect(lastPreCancel?.activeToolCount).toBeGreaterThan(0)
		emitTaskCancelled({ coordinator: wiring.coordinator, now: wiring.now }, "streaming", NOW + 1)
		const records = wiring.records()
		const cancelRecord = records.find((r) => r.event === "task_cancelled")
		wiring.dispose()
		expect(cancelRecord).toBeDefined()
	})
})

// =============================================================================
// T5 - W11 continuation ordering
// =============================================================================
describe("T5 - W11 same_task_continued between run #1 and run #2 (RED at HEAD)", () => {
	it("T5.1 - same_task_continued record appears between run #1 task_completed and run #2 session_started", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(done()),
			agentEvent(iterationStart(2)),
			agentEvent(done()),
		]
		const { wiring, sessionOptions } = makeWiring(() => emptyArbiterSnapshot(), legacyPhaseWalker(events))
		for (const e of events) sessionOptions.onSessionEvent(e)
		emitSameTaskContinued({ coordinator: wiring.coordinator, now: wiring.now }, "completed", NOW + 1)
		const records = [...wiring.records()]
		wiring.dispose()
		// Runtime `iteration_start` → shadow "session_started".
		// Runtime `done` → shadow "task_completed".
		const run1Done = records.findIndex((r) => r.event === "task_completed")
		const cont = records.findIndex((r) => r.event === "same_task_continued")
		const run2Start = records.findIndex((r, i) => i > run1Done && r.event === "session_started")
		expect(cont).toBeGreaterThan(run1Done)
		expect(cont).toBeLessThan(run2Start)
	})
})

// =============================================================================
// T6 - W12 task_reset + task_requested(B) precede run #2
// =============================================================================
describe("T6 - W12 task_reset + task_requested(B) precede run #2 (RED at HEAD)", () => {
	it("T6.1 - task_reset then task_requested(B) both reach recorder before run #2 session_started", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(done()),
			agentEvent(iterationStart(2)),
			agentEvent(done()),
		]
		const { wiring, sessionOptions } = makeWiring(() => emptyArbiterSnapshot(), legacyPhaseWalker(events))
		for (const e of events) sessionOptions.onSessionEvent(e)
		emitTaskReset({ coordinator: wiring.coordinator, now: wiring.now }, "completed", NOW + 1)
		emitTaskRequested({ coordinator: wiring.coordinator, now: wiring.now }, "task-2", NOW + 2)
		const records = [...wiring.records()]
		wiring.dispose()
		const run1Done = records.findIndex((r) => r.event === "task_completed")
		const reset = records.findIndex((r) => r.event === "task_reset")
		const req = records.findIndex((r) => r.event === "task_requested")
		const run2Start = records.findIndex((r, i) => i > run1Done && r.event === "session_started")
		expect(run1Done).toBeGreaterThanOrEqual(0)
		expect(reset).toBeGreaterThan(run1Done)
		expect(req).toBeGreaterThan(reset)
		expect(run2Start).toBeGreaterThan(req)
	})
})

// =============================================================================
// T7 - W12 invariantViolations == 0
// =============================================================================
describe("T7 - W12 invariant gate (GREEN_EXPECTED at HEAD but trivially)", () => {
	it("T7.1 - after task_reset + task_requested(B), invariantViolations stays 0", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(done()),
			agentEvent(iterationStart(2)),
			agentEvent(done()),
		]
		const { wiring, sessionOptions } = makeWiring(() => emptyArbiterSnapshot(), legacyPhaseWalker(events))
		for (const e of events) sessionOptions.onSessionEvent(e)
		emitTaskReset({ coordinator: wiring.coordinator, now: wiring.now }, "completed", NOW + 1)
		emitTaskRequested({ coordinator: wiring.coordinator, now: wiring.now }, "task-2", NOW + 2)
		const counts = wiring.recorderCounts()
		wiring.dispose()
		expect(counts.invariantViolations).toBe(0)
	})
})

// =============================================================================
// T8 - W12 unexplained D02 == 0
// =============================================================================
describe("T8 - W12 unexplained D02_SHADOW_FALSE_ACTIVE gate (RED at HEAD: 2 divergences on the W12 runtime-event trace)", () => {
	it("T8.1 - after task_reset + task_requested(B), D02_SHADOW_FALSE_ACTIVE == 0", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(done()),
			agentEvent(iterationStart(2)),
			agentEvent(done()),
		]
		const { wiring, sessionOptions } = makeWiring(() => emptyArbiterSnapshot(), legacyPhaseWalker(events))
		for (const e of events) sessionOptions.onSessionEvent(e)
		emitTaskReset({ coordinator: wiring.coordinator, now: wiring.now }, "completed", NOW + 1)
		emitTaskRequested({ coordinator: wiring.coordinator, now: wiring.now }, "task-2", NOW + 2)
		const counts = wiring.recorderCounts()
		wiring.dispose()
		expect(counts.divergenceCountsByClass.D02_SHADOW_FALSE_ACTIVE).toBe(0)
	})
})

// =============================================================================
// T9 - approval lifecycle (false -> true -> false)
// =============================================================================
describe("T9 - approval false -> true -> false (RED at HEAD)", () => {
	it("T9.1 - awaitingApproval transitions false,true,false across records", () => {
		const events: CoreSessionEvent[] = [agentEvent(iterationStart()), agentEvent(toolStart("tc-1"))]
		const arbiterSnapshots: ArbiterSnapshotLike[] = [
			{ ...emptyArbiterSnapshot() },
			{
				...emptyArbiterSnapshot(),
				execution: { modelStreaming: false, tooling: false, awaitingApproval: true },
				pendingToolCalls: ["tc-1"],
			},
			{ ...emptyArbiterSnapshot(), pendingToolCalls: [] },
		]
		let arbiterIdx = 0
		const { wiring, sessionOptions } = makeWiring(
			() => arbiterSnapshots[Math.min(arbiterIdx++, arbiterSnapshots.length - 1)]!,
			() => "awaiting_approval",
		)
		for (const e of events) sessionOptions.onSessionEvent(e)
		const records = [...wiring.records()]
		wiring.dispose()
		const flags = records.map((r) => r.awaitingApproval)
		const trueIdx = flags.indexOf(true)
		const falseAfterIdx = flags.slice(trueIdx + 1).indexOf(false)
		expect(trueIdx).toBeGreaterThanOrEqual(0)
		expect(falseAfterIdx).toBeGreaterThanOrEqual(0)
	})
})

// =============================================================================
// T10 - recovery callback reaches recorder
// =============================================================================
describe("T10 - recovery callback reaches recorder (RED at HEAD)", () => {
	it("T10.1 - recovery-state transition appears in recorder", () => {
		const events: CoreSessionEvent[] = [agentEvent(iterationStart()), agentEvent(done())]
		const { wiring, sessionOptions } = makeWiring(
			() => ({ ...emptyArbiterSnapshot(), recoveryState: "circuit_open" }),
			legacyPhaseWalker(events),
		)
		for (const e of events) sessionOptions.onSessionEvent(e)
		const records = wiring.records()
		wiring.dispose()
		const d06 = records.find((r) => r.classification === "D06_RESUME_BOUNDARY")
		expect(d06).toBeDefined()
	})
})

// =============================================================================
// T11 - actual production package guard
// =============================================================================
describe("T11 - production package guard (compile-time, not runtime)", () => {
	it("T11.1 - production classes import successfully", () => {
		const comparator = new TaskShadowComparator()
		const recorder = new TaskShadowRecorder()
		expect(comparator).toBeDefined()
		expect(recorder).toBeDefined()
	})
})

// =============================================================================
// T12 - single-record ingress invariant
// =============================================================================
describe("T12 - single-record ingress matrix (RED at HEAD)", () => {
	it("T12.1 - every state-mutating ingress produces exactly one recorder observation", () => {
		const events: CoreSessionEvent[] = [agentEvent(iterationStart()), agentEvent(done())]
		const { wiring, sessionOptions } = makeWiring(() => emptyArbiterSnapshot(), legacyPhaseWalker(events))
		sessionOptions.onSessionEvent(events[0]!)
		emitTaskRequested({ coordinator: wiring.coordinator, now: wiring.now }, "task-1", NOW + 1)
		emitTaskReset({ coordinator: wiring.coordinator, now: wiring.now }, "idle", NOW + 2)
		emitTaskRequested({ coordinator: wiring.coordinator, now: wiring.now }, "task-2", NOW + 3)
		emitTaskCancelled({ coordinator: wiring.coordinator, now: wiring.now }, "streaming", NOW + 4)
		emitSameTaskContinued({ coordinator: wiring.coordinator, now: wiring.now }, "completed", NOW + 5)
		const records = [...wiring.records()]
		wiring.dispose()
		const counts = {
			// Runtime `iteration_start` is translated to `session_started`
			// by the shadow-adapter; that's the marker for
			// RUNTIME_RECONSTRUCTED ingress.
			RUNTIME_RECONSTRUCTED: countRecordsByEvent(records, "session_started"),
			task_requested: countRecordsByEvent(records, "task_requested"),
			task_cancelled: countRecordsByEvent(records, "task_cancelled"),
			task_reset: countRecordsByEvent(records, "task_reset"),
			same_task_continued: countRecordsByEvent(records, "same_task_continued"),
			HOST_RECOVERY: countRecordsByEvent(records, "recovery_changed"),
		}
		expect(counts.RUNTIME_RECONSTRUCTED).toBe(1)
		expect(counts.task_requested).toBe(2)
		expect(counts.task_cancelled).toBe(1)
		expect(counts.task_reset).toBe(1)
		expect(counts.same_task_continued).toBe(1)
		expect(counts.HOST_RECOVERY).toBe(1)
	})
})
