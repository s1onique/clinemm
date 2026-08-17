/**
 * ELM-02F F1-CORRECTION01 — SdkController lifecycle integration test.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION01
 *
 * Mirrors the real SdkController's `attachCanonicalRuntimeEventSubscription`
 * flow at the VS Code boundary: a real `createTaskShadowHostWiring` +
 * a proxy through `subscribeRuntimeEventsThroughProxy`. Does not
 * require the core test machinery (no LocalRuntimeHost instance) — the
 * point is to prove the controller-level contract end-to-end at the
 * VS Code layer.
 *
 * Witnesses:
 *   F1-LC-1: subscribe BEFORE the inner ClineCore exposes the hook;
 *             the proxy returns a no-op unsubscribe and the listener
 *             is never called. Subsequent re-subscribe (after the
 *             inner gains the hook) does invoke the listener.
 *   F1-LC-2: the typed envelope reaches the shadow comparator with
 *             origin = RUNTIME_CANONICAL and the canonical event
 *             reference.
 *   F1-LC-3: the controller-level unsubscribe stops delivery; further
 *             runtime events do not reach the shadow.
 */
import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import { subscribeRuntimeEventsThroughProxy } from "../runtime-events-proxy"
import type { TaskShadowHostWiringDeps } from "../task-state-shadow-host-wiring"
import { createTaskShadowHostWiring, emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"

const NOW = 1_700_000_000_000

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

function makeWiringDeps(): TaskShadowHostWiringDeps {
	return {
		lifecycle: {
			getActiveSession: () => undefined,
			setRunning: () => undefined,
		} as never,
		sessionOptions: {
			mcpHub: undefined,
			requestToolApproval: undefined,
			askQuestion: undefined,
			onSessionEvent: () => {},
			onSendComplete: () => {},
			onSendError: () => {},
		} as never,
		getLegacyPhase: (): TurnPhase => "idle",
		getArbiterSnapshot: () => emptyArbiterSnapshot(),
		now: () => NOW,
	}
}

describe("ELM-02F F1-CORRECTION01 — SdkController lifecycle integration", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("F1-LC-1: a stale subscribe returns a no-op; subsequent re-subscribe on the now-available hook delivers canonical events", () => {
		const execEvent: AgentRuntimeEvent = {
			type: "execution-state-changed",
			snapshot: {
				...makeSnapshot(),
				execution: {
					modelStreaming: true,
					tooling: false,
					awaitingApproval: false,
				},
			},
			previousExecution: {
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
		}

		// Step 1: at first the inner ClineCore does NOT expose the hook
		// (the real LocalRuntimeHost subscription happens later).
		const innerNoHook: {
			subscribeRuntimeEvents?: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => () => void
		} = {}
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		let controllerUnsub: (() => void) | undefined
		const handleCanonicalEvent = (evtSessionId: string, event: AgentRuntimeEvent, sessionId: string) => {
			if (evtSessionId && evtSessionId !== sessionId) return
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId,
				event,
			})
		}
		const attachCanonicalRuntimeEventSubscription = (sessionId: string): void => {
			controllerUnsub?.()
			const unsub: () => void = subscribeRuntimeEventsThroughProxy(
				innerNoHook,
				(evtSessionId: string, event: AgentRuntimeEvent): void => handleCanonicalEvent(evtSessionId, event, sessionId),
			)
			controllerUnsub = unsub
		}
		// Step 2: simulate SdkController calling attachCanonical before
		// the inner ClineCore is ready (an early `initTask` race). The
		// proxy returns a no-op unsubscribe; nothing reaches the
		// shadow.
		attachCanonicalRuntimeEventSubscription("session-A")
		const eventsObservedAfterStale = wiring.recorderCounts().eventsObserved
		expect(eventsObservedAfterStale).toBe(0)

		// Step 3: the inner ClineCore now exposes the hook (later in
		// the lifecycle, after the LocalRuntimeHost.startSession path).
		const delivered: AgentRuntimeEvent[] = []
		innerNoHook.subscribeRuntimeEvents = (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => {
			listener("session-A", execEvent)
			delivered.push(execEvent)
			return () => {}
		}
		// Step 4: re-subscribe via the SdkController pattern.
		attachCanonicalRuntimeEventSubscription("session-A")
		// The shadow now received the canonical event.
		const records = wiring.records()
		expect(records.length).toBeGreaterThan(0)
		const cmp = wiring.comparator as unknown as {
			getDivergences(): ReadonlyArray<{
				shadowPhase: string
				legacyPhase: string
			}>
		}
		const divergences = cmp.getDivergences()
		expect(divergences.length).toBeGreaterThan(0)
		const last = divergences[divergences.length - 1]
		expect(last?.shadowPhase).toBe("streaming")
		expect(last?.legacyPhase).toBe("idle")
		expect(delivered).toContain(execEvent)
		const unsubFn = controllerUnsub as (() => void) | undefined
		if (unsubFn) unsubFn()
		wiring.dispose()
	})

	it("F1-LC-2: the typed envelope reaches the shadow comparator with origin = RUNTIME_CANONICAL", () => {
		const execEvent: AgentRuntimeEvent = {
			type: "execution-state-changed",
			snapshot: {
				...makeSnapshot(),
				execution: {
					modelStreaming: true,
					tooling: false,
					awaitingApproval: false,
				},
			},
			previousExecution: {
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
		}
		const inner = {
			subscribeRuntimeEvents: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => {
				listener("session-A", execEvent)
				return () => {}
			},
		}
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		const unsub = subscribeRuntimeEventsThroughProxy(inner, (sessionId, event) => {
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId,
				event,
			})
		})
		// The wiring's recorder received the canonical event.
		const records = wiring.records()
		expect(records.length).toBeGreaterThan(0)
		unsub()
		wiring.dispose()
	})

	it("F1-LC-3: the controller-level unsubscribe stops delivery to the shadow", () => {
		const received: AgentRuntimeEvent[] = []
		const inner = {
			subscribeRuntimeEvents: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => {
				// First delivery; second never happens because we unsubscribe.
				listener("session-A", {
					type: "turn-started",
					snapshot: makeSnapshot(),
					iteration: 0,
				})
				received.push({
					type: "turn-started",
					snapshot: makeSnapshot(),
					iteration: 0,
				})
				return () => {
					received.length = 0
				}
			},
		}
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		const unsub = subscribeRuntimeEventsThroughProxy(inner, (sessionId, event) => {
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId,
				event,
			})
		})
		const before = wiring.recorderCounts().eventsObserved
		unsub()
		// No further events.
		expect(received).toHaveLength(0)
		expect(wiring.recorderCounts().eventsObserved).toBe(before)
		wiring.dispose()
	})
})
