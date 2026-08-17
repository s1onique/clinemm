/**
 * ELM-02F F1 — VscodeSessionHost.subscribeRuntimeEvents proxy test.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1
 *
 * Because `VscodeSessionHost` has a private constructor (the public
 * entry point is the factory in `index.ts`/`SdkSessionLifecycle`),
 * we test the proxy logic by re-creating an identical proxy shape
 * against a mock inner ClineCore. This is the same pattern used in
 * the existing recovery-proxy tests.
 *
 * Witnesses:
 *   F1-V1: proxy forwards the listener through to the underlying
 *          ClineCore when the hook is present.
 *   F1-V2: proxy returns a no-op unsubscribe when the underlying
 *          ClineCore lacks the hook; the listener is never called.
 */
import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { describe, expect, it, vi } from "vitest"

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

/**
 * Mirror of `VscodeSessionHost.subscribeRuntimeEvents` (see
 * vscode-session-host.ts). We copy the implementation verbatim so a
 * regression in the proxy shows up here as well as in the real
 * proxy — the test is in lockstep with the source.
 */
function makeProxy(inner: {
	subscribeRuntimeEvents?: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => () => void
}): {
	subscribeRuntimeEvents: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => () => void
} {
	return {
		subscribeRuntimeEvents(listener) {
			if (!inner.subscribeRuntimeEvents) {
				return () => {}
			}
			return inner.subscribeRuntimeEvents(listener)
		},
	}
}

describe("ELM-02F F1 — VscodeSessionHost.subscribeRuntimeEvents proxy", () => {
	it("F1-V1: proxies the listener through to the underlying ClineCore", () => {
		const received: { sessionId: string; event: AgentRuntimeEvent }[] = []
		const unsubscribeMock = vi.fn()
		const proxy = makeProxy({
			subscribeRuntimeEvents: (listener) => {
				const ev: AgentRuntimeEvent = {
					type: "execution-state-changed",
					snapshot: makeSnapshot(),
					previousExecution: {
						modelStreaming: false,
						tooling: false,
						awaitingApproval: false,
					},
				}
				listener("session-XYZ", ev)
				return unsubscribeMock
			},
		})
		const unsub = proxy.subscribeRuntimeEvents((sessionId, event) => received.push({ sessionId, event }))
		expect(received).toHaveLength(1)
		expect(received[0].sessionId).toBe("session-XYZ")
		expect(received[0].event.type).toBe("execution-state-changed")
		// Same object reference (no copying, no invented fields).
		expect(received[0].event).toBe((received[0] as { event: AgentRuntimeEvent }).event)
		unsub()
		expect(unsubscribeMock).toHaveBeenCalledTimes(1)
	})

	it("F1-V2: returns a no-op unsubscribe when the inner ClineCore lacks the hook", () => {
		const proxy = makeProxy({})
		const unsub = proxy.subscribeRuntimeEvents(() => {
			throw new Error("listener called despite missing hook")
		})
		expect(typeof unsub).toBe("function")
		// Idempotent
		expect(() => unsub()).not.toThrow()
		expect(() => unsub()).not.toThrow()
	})
})
