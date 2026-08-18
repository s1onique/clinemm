/**
 * ELM-02F F1-CORRECTION03 — SdkController production-path lifecycle
 * owner test.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1-CORRECTION03
 *
 * The previous F1-CORRECTION02 test still mirrored the controller's
 * re-attach *behavior* (`unsubA()` then re-subscribe) locally. This
 * test exercises the *production owner object*
 * (`CanonicalRuntimeShadowSubscription`) that
 * `SdkController.attachCanonicalRuntimeEventSubscription` delegates
 * to. There is no local mirror — every assertion is a property of
 * the production owner itself.
 *
 * Witnesses:
 *
 *   F1-LC-1 (pre-session no-op):
 *     host.subscribeRuntimeEvents exists from the start
 *     sessions = 0
 *     owner.attach(A) returns no observation (subscribe attaches
 *     to zero sessions because no session currently exists)
 *
 *   F1-LC-2 (post-session reattach):
 *     session A appears
 *     owner.attach(A) — production reattach
 *     event A -> exactly 1 observation
 *
 *   F1-LC-3 (disposal disposes the previous subscription):
 *     owner.attach(B) — production replacement
 *     OLD unsubscribe called exactly once (captured via the
 *     host listener removal map)
 *     event A -> 0 additional observations
 *     event B -> exactly 1 additional observation
 *
 *   F1-LC-4 (reinit replaces the old subscription):
 *     single owner
 *     owner.attach(A), owner.attach(B) -> ACTIVE_LISTENERS = 1
 *     OLD_SESSION_AFTER_REINIT = 0
 *     NEW_SESSION_AFTER_REINIT = 1
 *
 *   F1-LC-5 (stale-session filter):
 *     owner.attach(A); deliver event tagged session-B
 *     -> 0 observations (filter)
 *
 *   F1-LC-6 (controller dispose drops the subscription):
 *     owner.dispose(); deliver event
 *     -> 0 additional observations
 *
 *   F1-LC-7 (exactly one shadow observation per canonical event):
 *     owner.attach(A); deliver exec + recovery
 *     -> exactly 2 shadow observations, no double-counting
 *
 *   F1-LC-8 (replacement is required: detach-then-reattach):
 *     without owner.attach(B), event A is still observed
 *     (demonstrates the production reattach invariant
 *      REQUIREMENT, not auto-discovery)
 */
import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import { CanonicalRuntimeShadowSubscription, type RuntimeEventHost } from "../canonical-event-subscription"
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

// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01:
// the wiring's NO_ACTIVE_SESSION guard (line 393) refuses events
// when `getActiveSession()` returns undefined. The F1-CORRECTION03
// tests pre-fix relied on the vacuous guard. The fixture now
// returns a session matching whatever sessionId is currently
// active in the test's session cell. The test's `addSession`
// call updates the cell, mirroring the production lifecycle.
function makeWiringDeps(activeSession: { current: string | undefined }): TaskShadowHostWiringDeps {
	return {
		lifecycle: {
			getActiveSession: () => (activeSession.current ? { sessionId: activeSession.current } : undefined) as never,
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

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01:
 * shared session cell for the F1-CORRECTION03 test set. Updated by
 * each test's `addSession` call to mirror the production session
 * lifecycle. The wiring's `getActiveSession` reads from this cell.
 */
const sessionA: { current: string | undefined } = { current: undefined }

/**
 * A faithful `POINT_IN_TIME` host fixture:
 *   - `subscribeRuntimeEvents` exists from the start (no toggling).
 *   - `addSession(sessionId)` registers a session; subsequent
 *     `subscribeRuntimeEvents` calls attach a listener to that
 *     session (and ONLY that session, reflecting the host's
 *     point-in-time contract).
 *   - `removeSession(sessionId)` unregisters a session; all
 *     listeners for that session are removed.
 */
function makeHost() {
	const sessionListeners = new Map<string, Set<(event: AgentRuntimeEvent) => void>>()
	const globalListeners = new Set<(sessionId: string, event: AgentRuntimeEvent) => void>()
	let subscribeCalls = 0
	let unsubscribeCalls = 0
	return {
		host: {
			subscribeRuntimeEvents: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => {
				subscribeCalls++
				globalListeners.add(listener)
				// Walk currently active sessions and attach.
				for (const [sid, set] of sessionListeners.entries()) {
					set.add((event) => listener(sid, event))
				}
				return () => {
					unsubscribeCalls++
					globalListeners.delete(listener)
					for (const set of sessionListeners.values()) {
						set.clear()
					}
				}
			},
		} satisfies RuntimeEventHost,
		api: {
			addSession(sessionId: string) {
				const set = new Set<(event: AgentRuntimeEvent) => void>()
				sessionListeners.set(sessionId, set)
				// POINT_IN_TIME: existing global listeners do NOT
				// see the newly added session. They subscribed to the
				// snapshot of sessions that existed at subscribe time.
				// A subsequent subscribe call (a re-attach) WILL see
				// the new session because subscribe walks the
				// currently active sessions.
			},
			removeSession(sessionId: string) {
				sessionListeners.delete(sessionId)
			},
			deliver(sessionId: string, event: AgentRuntimeEvent) {
				const set = sessionListeners.get(sessionId)
				if (!set) return
				for (const l of set) l(event)
			},
			stats() {
				return {
					subscribeCalls,
					unsubscribeCalls,
					activeListeners: globalListeners.size,
					activeSessions: sessionListeners.size,
				}
			},
		},
	}
}

function makeExecEvent(): AgentRuntimeEvent {
	return {
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
}

function makeRecoveryEvent(): AgentRuntimeEvent {
	return {
		type: "recovery-state-changed",
		snapshot: {
			...makeSnapshot(),
			recovery: {
				state: "recovering",
				tracker: {
					state: "recovering",
					currentRepairAttempts: 0,
					equivalentRepeatCount: 0,
					blockedExactKeys: [],
					blockedFamilies: [],
				},
				secondStage: "idle",
				episodeFailures: 1,
				maxEpisodeFailures: 5,
				circuitNoticeCount: 0,
			},
		},
		previousRecovery: {
			state: "idle",
			tracker: {
				state: "idle",
				currentRepairAttempts: 0,
				equivalentRepeatCount: 0,
				blockedExactKeys: [],
				blockedFamilies: [],
			},
			secondStage: "idle",
			episodeFailures: 0,
			maxEpisodeFailures: 5,
			circuitNoticeCount: 0,
		},
	}
}

describe("ELM-02F F1-CORRECTION03 — SdkController production-path lifecycle owner", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01-CLOSURE-FIXUP:
		// the wiring's NO_ACTIVE_SESSION guard (line 393) reads
		// `sessionA.current` once per event. The shared mutable
		// cell must be reset to `undefined` between tests so the
		// legacy post-fix F1-LC-* fixtures do not leak session
		// state from one test to the next. Without this reset,
		// reordering the test file could change the observed
		// outcome of `eventsObserved === 1` assertions.
		sessionA.current = undefined
	})

	it("F1-LC-1 + F1-LC-2: pre-session no-op -> post-session reattach observes exactly once", () => {
		const { host, api } = makeHost()
		const wiring = createTaskShadowHostWiring(makeWiringDeps(sessionA))
		const owner = new CanonicalRuntimeShadowSubscription()

		// Stage 1: no sessions; owner.attach() returns without
		// observation (point-in-time contract: method exists, no
		// active sessions to attach to).
		sessionA.current = "session-A"
		owner.attach(host, wiring, "session-A")
		expect(owner.hasActiveListener()).toBe(true)
		expect(api.stats().subscribeCalls).toBe(1)
		expect(wiring.recorderCounts().eventsObserved).toBe(0)

		// Stage 2: session A appears. Without re-attach, the prior
		// subscription does NOT see it.
		sessionA.current = "session-A"
		api.addSession("session-A")
		api.deliver("session-A", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(0)

		// Stage 3: production reattach. Now the new listener sees
		// session A and only session A.
		sessionA.current = "session-A"
		owner.attach(host, wiring, "session-A")
		expect(api.stats().unsubscribeCalls).toBe(1) // old listener disposed
		expect(api.stats().subscribeCalls).toBe(2) // new listener attached
		expect(owner.hasActiveListener()).toBe(true)

		api.deliver("session-A", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(1)

		owner.dispose()
		wiring.dispose()
	})

	it("F1-LC-3: attach(B) disposes the previous listener; event A no longer observed; event B observed exactly once", () => {
		const { host, api } = makeHost()
		const wiring = createTaskShadowHostWiring(makeWiringDeps(sessionA))
		const owner = new CanonicalRuntimeShadowSubscription()

		sessionA.current = "session-A"
		api.addSession("session-A")
		sessionA.current = "session-A"
		owner.attach(host, wiring, "session-A")
		expect(api.stats().activeListeners).toBe(1)

		// Deliver: observed once.
		api.deliver("session-A", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(1)

		// Replace with session B.
		sessionA.current = "session-B"
		api.addSession("session-B")
		sessionA.current = "session-B"
		owner.attach(host, wiring, "session-B")
		expect(api.stats().unsubscribeCalls).toBe(1) // previous listener disposed exactly once
		expect(api.stats().activeListeners).toBe(1) // exactly one active listener
		expect(api.stats().subscribeCalls).toBe(2) // second listener attached

		// event A no longer reaches the shadow.
		api.deliver("session-A", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(1) // unchanged

		// event B reaches the shadow.
		api.deliver("session-B", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(2)

		owner.dispose()
		wiring.dispose()
	})

	it("F1-LC-4: reinit pattern — single owner, replace on task transition; exactly one active listener at all times", () => {
		const { host, api } = makeHost()
		const wiring = createTaskShadowHostWiring(makeWiringDeps(sessionA))
		const owner = new CanonicalRuntimeShadowSubscription()

		// Initial task.
		sessionA.current = "session-A"
		api.addSession("session-A")
		sessionA.current = "session-A"
		owner.attach(host, wiring, "session-A")
		expect(api.stats().activeListeners).toBe(1)

		// Reinit: new session replaces the old one.
		sessionA.current = "session-B"
		api.addSession("session-B")
		sessionA.current = "session-B"
		owner.attach(host, wiring, "session-B")
		expect(api.stats().activeListeners).toBe(1)
		expect(api.stats().unsubscribeCalls).toBe(1)
		expect(api.stats().subscribeCalls).toBe(2)

		// Strict replacement assertions.
		api.deliver("session-A", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(0) // OLD_SESSION_AFTER_REINIT
		api.deliver("session-B", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(1) // NEW_SESSION_AFTER_REINIT

		owner.dispose()
		wiring.dispose()
	})

	it("F1-LC-5: stale-session filter — events from a different sessionId are dropped at the listener", () => {
		const { host, api } = makeHost()
		const wiring = createTaskShadowHostWiring(makeWiringDeps(sessionA))
		const owner = new CanonicalRuntimeShadowSubscription()

		sessionA.current = "session-A"
		api.addSession("session-A")
		sessionA.current = "session-B"
		api.addSession("session-B")
		sessionA.current = "session-A"
		owner.attach(host, wiring, "session-A")

		// event tagged session-B: dropped (host only delivers to
		// session-A's listener set; even if it leaked through, the
		// sessionId guard in the helper would drop it).
		api.deliver("session-B", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(0)

		// event tagged session-A: reaches the shadow.
		api.deliver("session-A", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(1)

		owner.dispose()
		wiring.dispose()
	})

	it("F1-LC-6: owner.dispose() drops the active listener; subsequent events are not observed", () => {
		const { host, api } = makeHost()
		const wiring = createTaskShadowHostWiring(makeWiringDeps(sessionA))
		const owner = new CanonicalRuntimeShadowSubscription()

		sessionA.current = "session-A"
		api.addSession("session-A")
		sessionA.current = "session-A"
		owner.attach(host, wiring, "session-A")
		expect(owner.hasActiveListener()).toBe(true)

		owner.dispose()
		expect(owner.hasActiveListener()).toBe(false)
		expect(api.stats().unsubscribeCalls).toBe(1)

		api.deliver("session-A", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(0)

		// Idempotent.
		owner.dispose()
		expect(owner.hasActiveListener()).toBe(false)
		expect(api.stats().unsubscribeCalls).toBe(1)

		wiring.dispose()
	})

	it("F1-LC-7: exactly one shadow observation per canonical event (execution + recovery)", () => {
		const { host, api } = makeHost()
		const wiring = createTaskShadowHostWiring(makeWiringDeps(sessionA))
		const owner = new CanonicalRuntimeShadowSubscription()

		sessionA.current = "session-A"
		api.addSession("session-A")
		sessionA.current = "session-A"
		owner.attach(host, wiring, "session-A")

		api.deliver("session-A", makeExecEvent())
		api.deliver("session-A", makeRecoveryEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(2)

		const cmp = wiring.comparator as unknown as {
			getDivergences(): ReadonlyArray<{
				shadowPhase: string
				legacyPhase: string
			}>
		}
		const divergences = cmp.getDivergences()
		expect(divergences.length).toBeGreaterThanOrEqual(1)

		owner.dispose()
		wiring.dispose()
	})

	it("F1-LC-8: without owner.attach(B) the event from the new session is NOT observed — production reattach is required", () => {
		const { host, api } = makeHost()
		const wiring = createTaskShadowHostWiring(makeWiringDeps(sessionA))
		const owner = new CanonicalRuntimeShadowSubscription()

		sessionA.current = "session-A"
		api.addSession("session-A")
		sessionA.current = "session-A"
		owner.attach(host, wiring, "session-A")
		api.deliver("session-A", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(1)

		// A new session is created. The current subscription does
		// NOT observe it without an explicit reattach.
		sessionA.current = "session-B"
		api.addSession("session-B")
		api.deliver("session-B", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(1)

		// Now reattach to session-B.
		sessionA.current = "session-B"
		owner.attach(host, wiring, "session-B")
		expect(api.stats().unsubscribeCalls).toBe(1)
		expect(api.stats().subscribeCalls).toBe(2)

		api.deliver("session-A", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(1) // filtered (sessionId guard)
		api.deliver("session-B", makeExecEvent())
		expect(wiring.recorderCounts().eventsObserved).toBe(2)

		owner.dispose()
		wiring.dispose()
	})

	it("F1-LC-9: active listener count is exactly 1 after each replacement; 0 after dispose", () => {
		const { host, api } = makeHost()
		const wiring = createTaskShadowHostWiring(makeWiringDeps(sessionA))
		const owner = new CanonicalRuntimeShadowSubscription()

		sessionA.current = "session-A"
		api.addSession("session-A")
		sessionA.current = "session-A"
		owner.attach(host, wiring, "session-A")
		expect(api.stats().activeListeners).toBe(1)

		sessionA.current = "session-B"
		api.addSession("session-B")
		sessionA.current = "session-B"
		owner.attach(host, wiring, "session-B")
		expect(api.stats().activeListeners).toBe(1)

		sessionA.current = "session-C"
		api.addSession("session-C")
		sessionA.current = "session-C"
		owner.attach(host, wiring, "session-C")
		expect(api.stats().activeListeners).toBe(1)

		owner.dispose()
		expect(api.stats().activeListeners).toBe(0)
		expect(api.stats().unsubscribeCalls).toBe(3) // one per attach + the final dispose
		// dispose() is idempotent: a fourth call must NOT add another unsubscribe.
		owner.dispose()
		expect(api.stats().unsubscribeCalls).toBe(3)

		wiring.dispose()
	})
})
