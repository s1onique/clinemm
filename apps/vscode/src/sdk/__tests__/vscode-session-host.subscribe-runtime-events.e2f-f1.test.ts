/**
 * ELM-02F F1 — VscodeSessionHost.subscribeRuntimeEvents production
 * proxy test.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1
 *
 * CORRECTION01: the previous test re-implemented the proxy in
 * the test file. That was a synthetic mirror — a regression in
 * production code would not have been caught. This test now calls
 * the SAME function `VscodeSessionHost.subscribeRuntimeEvents`
 * delegates to: `subscribeRuntimeEventsThroughProxy`. There is only
 * one implementation.
 *
 * Witnesses:
 *   F1-V1-C1: when the inner ClineCore exposes
 *              `subscribeRuntimeEvents`, the proxy forwards the
 *              listener and returns the inner unsubscribe (NOT a
 *              no-op).
 *   F1-V1-C2: the canonical event is delivered verbatim (same
 *              object reference; no copying, no invented fields).
 *   F1-V2-C1: when the inner ClineCore LACKS
 *              `subscribeRuntimeEvents`, the proxy returns a
 *              no-op unsubscribe and the listener is NEVER called.
 *   F1-V2-C2: the no-op unsubscribe is idempotent (calling it
 *              twice is harmless).
 */
import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { describe, expect, it, vi } from "vitest"
import { subscribeRuntimeEventsThroughProxy } from "../runtime-events-proxy"

function makeSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status: "running",
		iteration: 0,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as readonly string[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

function makeRecoveryEvent(previousState: "idle" | "recovering"): AgentRuntimeEvent {
	return {
		type: "recovery-state-changed",
		snapshot: {
			...makeSnapshot(),
			recovery: {
				state: previousState,
				tracker: {
					state: previousState,
					currentRepairAttempts: 0,
					equivalentRepeatCount: 0,
					blockedExactKeys: [],
					blockedFamilies: [],
				},
				secondStage: "idle",
				episodeFailures: previousState === "recovering" ? 1 : 0,
				maxEpisodeFailures: 5,
				circuitNoticeCount: 0,
			},
		},
		previousRecovery: {
			state: previousState,
			tracker: {
				state: previousState,
				currentRepairAttempts: 0,
				equivalentRepeatCount: 0,
				blockedExactKeys: [],
				blockedFamilies: [],
			},
			secondStage: "idle",
			episodeFailures: previousState === "recovering" ? 1 : 0,
			maxEpisodeFailures: 5,
			circuitNoticeCount: 0,
		},
	}
}

describe("ELM-02F F1 — VscodeSessionHost.subscribeRuntimeEvents production proxy", () => {
	// ------------------------------------------------------------------------
	// F1-V1 — inner has hook; proxy forwards and preserves fidelity
	// ------------------------------------------------------------------------

	it("F1-V1-C1: forwards the listener to the inner ClineCore and returns its unsubscribe", () => {
		const unsubscribeMock = vi.fn()
		const inner = {
			subscribeRuntimeEvents: (_listener: (sessionId: string, event: AgentRuntimeEvent) => void) => unsubscribeMock,
		}
		const unsub = subscribeRuntimeEventsThroughProxy(inner, () => {})
		// The returned unsubscribe is the *inner's* unsubscribe —
		// not a no-op function.
		expect(unsub).toBe(unsubscribeMock)
	})

	it("F1-V1-C2: a literal canonical event reaches the listener with the same object reference", () => {
		const execEvent: AgentRuntimeEvent = {
			type: "execution-state-changed",
			snapshot: makeSnapshot(),
			previousExecution: {
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
		}
		const received: { sessionId: string; event: AgentRuntimeEvent }[] = []
		const inner = {
			subscribeRuntimeEvents: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => {
				// Host-delivery pattern: inner calls listener with
				// (sessionId, originalEvent).
				listener("session-XYZ", execEvent)
				return () => {}
			},
		}
		subscribeRuntimeEventsThroughProxy(inner, (sessionId, event) => received.push({ sessionId, event }))
		expect(received).toHaveLength(1)
		expect(received[0].sessionId).toBe("session-XYZ")
		expect(received[0].event).toBe(execEvent)
	})

	it("F1-V1-C3: a literal recovery event reaches the listener with the same object reference", () => {
		const recoveryEvent = makeRecoveryEvent("recovering")
		const received: AgentRuntimeEvent[] = []
		const inner = {
			subscribeRuntimeEvents: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => {
				listener("session-XYZ", recoveryEvent)
				return () => {}
			},
		}
		subscribeRuntimeEventsThroughProxy(inner, (_sessionId, event) => {
			if (event.type === "recovery-state-changed") received.push(event)
		})
		expect(received).toHaveLength(1)
		expect(received[0]).toBe(recoveryEvent)
		// And the snapshot is exactly what the inner passed (no
		// host-synthesized reconstruction).
		const asRecovery = received[0] as Extract<AgentRuntimeEvent, { type: "recovery-state-changed" }>
		expect(asRecovery.previousRecovery.state).toBe("recovering")
		expect(asRecovery.snapshot.recovery?.episodeFailures).toBe(1)
	})

	// ------------------------------------------------------------------------
	// F1-V2 — inner lacks hook; proxy no-ops without calling listener
	// ------------------------------------------------------------------------

	it("F1-V2-C1: returns a no-op unsubscribe when the inner ClineCore lacks the hook; listener is never invoked", () => {
		const inner = {} // subscribeRuntimeEvents deliberately absent
		let listenerCalls = 0
		const unsub = subscribeRuntimeEventsThroughProxy(inner, () => {
			listenerCalls += 1
		})
		// Calling the no-op unsubscribe is harmless.
		expect(() => unsub()).not.toThrow()
		expect(() => unsub()).not.toThrow()
		// And the listener was never called.
		expect(listenerCalls).toBe(0)
	})
})
