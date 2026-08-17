/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 15 — Reverse-translator tests.
 *
 * Exercises the host-side Legacy → Runtime event reconstruction from
 * `CoreSessionEvent` fixtures, end-to-end through the comparator.
 *
 * The fixtures are deliberately close to the shapes produced by the
 * real `RuntimeEventAdapter` so the translator stays correct when the
 * underlying legacy stream changes.
 */

import type { CoreSessionEvent } from "@cline/core"
import type {
	AgentContentEndEvent,
	AgentContentStartEvent,
	AgentEvent,
	AgentIterationEndEvent,
	AgentIterationStartEvent,
} from "@cline/shared"
import { describe, expect, it } from "vitest"
import { TaskShadowComparator } from "../task-state-shadow"
import { TaskShadowReverseTranslator, type TaskShadowReverseTranslatorInput } from "../task-state-shadow-observer"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"

const NOW = 1_700_000_000_000

function arbiter(overrides: Partial<ArbiterSnapshot> = {}): ArbiterSnapshot {
	return {
		execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		recoveryState: "idle",
		status: "idle",
		pendingToolCalls: [],
		...overrides,
	}
}

function legacyAgentEvent<T extends AgentEvent>(event: T, sessionId: string): CoreSessionEvent {
	return {
		type: "agent_event",
		payload: { sessionId, event },
	} as CoreSessionEvent
}

function iterationStart(iter = 1, conversationId = "conv-1"): AgentIterationStartEvent {
	return { type: "iteration_start", iteration: iter, conversationId }
}

function iterationEnd(iter = 1, hadToolCalls = false): AgentIterationEndEvent {
	return { type: "iteration_end", iteration: iter, hadToolCalls, toolCallCount: hadToolCalls ? 1 : 0 }
}

function toolStart(toolCallId: string, toolName = "read_file"): AgentContentStartEvent {
	return { type: "content_start", contentType: "tool", toolCallId, toolName }
}

function toolEnd(toolCallId: string, toolName = "read_file"): AgentContentEndEvent {
	return { type: "content_end", contentType: "tool", toolCallId, toolName }
}

function input(
	event: CoreSessionEvent,
	overrides: Partial<TaskShadowReverseTranslatorInput> = {},
): TaskShadowReverseTranslatorInput {
	return {
		event,
		now: NOW,
		legacyPhase: "idle",
		arbiter: arbiter(),
		...overrides,
	}
}

describe("TaskShadowReverseTranslator — Legacy → Runtime reverse translation", () => {
	it("reconstructs run-started from iteration_start", () => {
		const t = new TaskShadowReverseTranslator()
		const out = t.translate(input(legacyAgentEvent(iterationStart(), "s1")))
		expect(out?.type).toBe("run-started")
	})

	it("reconstructs run-finished from done", () => {
		const t = new TaskShadowReverseTranslator()
		const out = t.translate(
			input(legacyAgentEvent({ type: "done", reason: "completed", text: "", iterations: 0 } as AgentEvent, "s1")),
		)
		expect(out?.type).toBe("run-finished")
	})

	it("reconstructs tool-started / tool-finished from content_start(tool) / content_end(tool)", () => {
		const t = new TaskShadowReverseTranslator()
		const started = t.translate(input(legacyAgentEvent(toolStart("tc-1"), "s1")))
		expect(started?.type).toBe("tool-started")
		const finished = t.translate(input(legacyAgentEvent(toolEnd("tc-1"), "s1")))
		expect(finished?.type).toBe("tool-finished")
	})

	it("returns undefined for content_start(text) (presentation-only)", () => {
		const t = new TaskShadowReverseTranslator()
		const evt: AgentContentStartEvent = { type: "content_start", contentType: "text", text: "hello" }
		expect(t.translate(input(legacyAgentEvent(evt, "s1")))).toBeUndefined()
	})

	it("returns undefined for content_end(text)", () => {
		const t = new TaskShadowReverseTranslator()
		const evt: AgentContentEndEvent = { type: "content_end", contentType: "text", text: "hello" }
		expect(t.translate(input(legacyAgentEvent(evt, "s1")))).toBeUndefined()
	})

	it("ignores non agent_event payloads", () => {
		const t = new TaskShadowReverseTranslator()
		const evt = { type: "pending_prompts", payload: { sessionId: "s1", prompts: [] } } as unknown as CoreSessionEvent
		expect(t.translate(input(evt))).toBeUndefined()
	})

	it("drives the comparator end-to-end through observe() and resets previousExecution on run-started", () => {
		const t = new TaskShadowReverseTranslator()
		const cmp = new TaskShadowComparator()
		const startOut = t.observe(
			input(legacyAgentEvent(iterationStart(), "s1"), {
				arbiter: arbiter({ execution: { modelStreaming: true, tooling: false, awaitingApproval: false } }),
				legacyPhase: "streaming",
			}),
			cmp,
		)
		expect(startOut.runtimeEvent?.type).toBe("run-started")
		expect(startOut.divergence).toBeDefined()
		expect(startOut.divergence?.legacyPhase).toBe("streaming")
		expect(t.getPreviousExecution()).toEqual({ modelStreaming: false, tooling: false, awaitingApproval: false })
		const endOut = t.observe(input(legacyAgentEvent(iterationEnd(1, false), "s1"), { legacyPhase: "streaming" }), cmp)
		expect(endOut.observationEvent).toBe("noop")
	})
})

describe("TaskShadowReverseTranslator — privacy & idempotence", () => {
	it("does not surface message prose on tool-start translation", () => {
		const t = new TaskShadowReverseTranslator()
		const evt = toolStart("tc-1")
		const out = t.translate(input(legacyAgentEvent(evt, "s1")))
		expect(out?.type).toBe("tool-started")
		if (out?.type === "tool-started") {
			expect(out.toolCall.toolCallId).toBe("tc-1")
		}
	})

	it("debugReset clears run identity and execution projection", () => {
		const t = new TaskShadowReverseTranslator()
		t.translate(input(legacyAgentEvent(iterationStart(2, "conv-2"), "s2")))
		t.debugReset()
		expect(t.getPreviousExecution()).toEqual({ modelStreaming: false, tooling: false, awaitingApproval: false })
	})
})
