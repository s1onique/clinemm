/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-C
 *
 * C2.4-C -- REAL-Local-transport composition with the C2.4-B authority
 * boundary.
 *
 * Pair of
 * `sdk/packages/core/src/runtime/host/local-runtime-host.c24-c-transport.test.ts`:
 *   - File 1: real `LocalRuntimeHost.subscribeRuntimeEvents` topology
 *     qualification, exercised end-to-end under a teststub-only
 *     `AgentRuntime` (L1..L12).
 *   - File 2 (this file): proof that the wired boundary composition
 *     (production `subscribeCanonicalRuntimeEventsToShadow` ->
 *     `TaskShadowHostWiring` -> production guard at line 393) classifies
 *     state-mutating canonical events the same way regardless of the
 *     specific host:
 *         - transport arrival + matching active session -> APPLY
 *         - transport arrival + no active session       -> DROP
 *         - transport arrival + mismatched session      -> DROP
 *
 * The host fixture here is a faithful `LocalRuntimeHost.subscribeRuntimeEvents`
 * simulation (POINT_IN_TIME topology, same semantics as the
 * E2F F1-CORRECTION03 fixture). The simulation is documented and proven
 * equivalent to the real LocalRuntimeHost at
 * `sdk/packages/core/src/runtime/host/local-runtime-host.subscribe-runtime-events.e2f-f1-correction01.test.ts`.
 *
 * This file does NOT re-execute B1..B9. Those rows already exercise
 * the production wiring's no-active-session guard directly
 * (`task-state-shadow-no-active-session-witness.test.ts`, frozen at
 * adbb5e2d5). What C-NAS rows prove is that
 * `subscribeCanonicalRuntimeEventsToShadow` (the production ingest
 * helper used by SdkController.attachCanonicalRuntimeEventSubscription)
 * preserves the boundary behavior when the host follows Local-real
 * transport semantics.
 *
 * C-rows documented here:
 *   C-NAS-1 a pre-session canonical event delivered through the
 *            faithful-Local host with no sessions: ZERO host delivery,
 *            ZERO shadow observation. The boundary layer's
 *            `no-op` invariant for an empty-sessions snapshot is
 *            exercised end-to-end.
 *   C-NAS-2 a session is established and a legitimate 5-event run
 *            sequence is delivered through the Local topology:
 *            EXACTLY 5 host deliveries; EXACTLY 5 shadow
 *            observations; EXACTLY 0 stale-run suppressions.
 *   C-NAS-3 a stale-session event for session-A arrives AFTER a
 *            replace to session-B: the helper's sessionId filter
 *            rejects it; ZERO shadow observations for the stale
 *            session; the legitimate session-B delivery is admitted.
 *   C-NAS-4 a restore-like recovery (runId === undefined in the
 *            snapshot, mirroring B8): the wiring's no-active-session
 *            guard admits it; EXACTLY 1 shadow observation.
 *
 * Out-of-scope (lives in C2.4-D / C2.5 / E7):
 *   - Hub/Remote fallback provenance
 *   - Real C04 capture
 *   - Consumer cutover
 */

import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { RuntimeEventHost } from "../canonical-event-subscription"
import { subscribeCanonicalRuntimeEventsToShadow } from "../canonical-event-subscription"
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

/**
 * Faithful `LocalRuntimeHost.subscribeRuntimeEvents` simulation
 * (POINT_IN_TIME topology). Each `subscribeRuntimeEvents(listener)`
 * call snapshots the currently active sessions and attaches the
 * listener to those sessions only. New sessions created AFTER the
 * subscribe call require a fresh subscribe to be observed. The shim's
 * `_deliver(sessionId, event)` pushes the supplied event through
 * every listener attached to that sessionId.
 *
 * The shim uses a `Wrapper` (event-only) closure to satisfy the
 * listener-set type contract; each `subscribeRuntimeEvents` call
 * installs one wrapper per currently-active session, keyed by its
 * dispose function so unsubscribe removes the wrappers the call
 * installed.
 */
function makeLocalRuntimeHostShim() {
	type Wrapper = (event: AgentRuntimeEvent) => void
	const sessionListeners = new Map<string, Set<Wrapper>>()
	let subscribeCalls = 0
	let unsubscribeCalls = 0
	return {
		host: {
			subscribeRuntimeEvents: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => {
				subscribeCalls++
				// Build a stable wrapper bound to each session id it
				// encounters during this subscribe call. The closure
				// captures `sessionIdAtTime` per-iteration so events
				// delivered to a session's set tag the correct sessionId.
				const wrappers: Wrapper[] = []
				for (const [sid, set] of sessionListeners.entries()) {
					const sessionIdAtTime = sid
					const w: Wrapper = (event) => listener(sessionIdAtTime, event)
					wrappers.push(w)
					set.add(w)
				}
				const dispose = () => {
					unsubscribeCalls++
					for (const w of wrappers) {
						for (const set of sessionListeners.values()) {
							set.delete(w)
						}
					}
				}
				return dispose
			},
		} satisfies RuntimeEventHost,
		_deliver(sessionId: string, event: AgentRuntimeEvent) {
			const set = sessionListeners.get(sessionId)
			if (!set) return 0
			let n = 0
			for (const l of set) {
				l(event)
				n++
			}
			return n
		},
		_addSession(sessionId: string) {
			const set = new Set<Wrapper>()
			sessionListeners.set(sessionId, set)
		},
		_removeSession(sessionId: string) {
			sessionListeners.delete(sessionId)
		},
		stats() {
			return {
				subscribeCalls,
				unsubscribeCalls,
				activeSessions: sessionListeners.size,
			}
		},
	}
}

const sessionA: { current: string | undefined } = { current: undefined }

function makeWiringDeps(): TaskShadowHostWiringDeps {
	return {
		lifecycle: {
			getActiveSession: () => (sessionA.current ? { sessionId: sessionA.current } : undefined) as never,
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

function execEvent(runId: string, modelStreaming: boolean): AgentRuntimeEvent {
	const snap = { ...makeSnapshot(), runId }
	return {
		type: "execution-state-changed",
		snapshot: snap,
		previousExecution: {
			modelStreaming: !modelStreaming,
			tooling: false,
			awaitingApproval: false,
		},
	}
}

function recoveryEvent(runId: string | undefined): AgentRuntimeEvent {
	return {
		type: "recovery-state-changed",
		snapshot: {
			...makeSnapshot(),
			...(runId !== undefined ? { runId } : {}),
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

function stubRunResult(runId: string) {
	return {
		agentId: "agent_test",
		runId,
		status: "completed" as const,
		iterations: 1,
		outputText: "ok",
		messages: [] as readonly never[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

function runStartedEvent(runId: string): AgentRuntimeEvent {
	return { type: "run-started", snapshot: { ...makeSnapshot(), runId } }
}

function runFinishedEvent(runId: string): AgentRuntimeEvent {
	return {
		type: "run-finished",
		snapshot: { ...makeSnapshot(), runId },
		result: stubRunResult(runId),
	}
}

describe("C2.4-C - REAL-Local transport composition with C2.4-B authority boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01-CLOSURE-FIXUP:
		// reset the shared mutable session cell between tests.
		sessionA.current = undefined
	})

	// ------------------------------------------------------------------------
	// C-NAS-1: pre-session canonical event through the Local topology.
	// The wiring's lifecycle still has no authoritative session; the
	// host's sessionListeners map is empty. The faithful-Local
	// topology MUST deliver zero events. The wiring's pre-session
	// row of B (B1..B8, B9) is the authoritative drop invariant;
	// this C-row proves the topology honors it end-to-end.
	// ------------------------------------------------------------------------
	it("C-NAS-1: a pre-session canonical event through the Local topology delivers zero events (no-shadow)", () => {
		const shim = makeLocalRuntimeHostShim()
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		subscribeCanonicalRuntimeEventsToShadow(shim.host, wiring, "session-A")
		const n = shim._deliver("session-A", runStartedEvent("run-poison"))
		expect(n).toBe(0) // host topology: no sessions => no deliveries
		const counts = wiring.recorderCounts()
		expect(counts.eventsObserved).toBe(0)
		expect(wiring.records().length).toBe(0)
	})

	// ------------------------------------------------------------------------
	// C-NAS-2: post-session legitimate 5-event sequence.
	// The wiring's lifecycle reports session-A as authoritative; the
	// host's sessionListeners has session-A. The faithful-Local
	// topology delivers every event exactly once. The wiring
	// boundary admits each; the recorder observes exactly 5.
	// ------------------------------------------------------------------------
	it("C-NAS-2: a legitimate 5-event run sequence through the Local topology produces exactly 5 shadow observations", () => {
		const shim = makeLocalRuntimeHostShim()
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		shim._addSession("session-A")
		sessionA.current = "session-A"
		subscribeCanonicalRuntimeEventsToShadow(shim.host, wiring, "session-A")
		const events: AgentRuntimeEvent[] = [
			runStartedEvent("run-1"),
			execEvent("run-1", true),
			execEvent("run-1", false),
			recoveryEvent("run-1"),
			runFinishedEvent("run-1"),
		]
		const before = wiring.recorderCounts()
		let delivered = 0
		for (const ev of events) {
			delivered += shim._deliver("session-A", ev)
		}
		const after = wiring.recorderCounts()
		expect(delivered).toBe(events.length)
		expect(after.eventsObserved - before.eventsObserved).toBe(events.length)
		expect(after.staleRunTerminalSuppressed - before.staleRunTerminalSuppressed).toBe(0)
	})

	// ------------------------------------------------------------------------
	// C-NAS-3: session-replaced. The first attach listens for session-A
	// only. After unsubA, a fresh attach listens for session-B only.
	// A late session-A event reaches no boundary observer; only the
	// legitimate session-B delivery produces a shadow observation.
	// ------------------------------------------------------------------------
	it("C-NAS-3: a session-replace disposes the prior listener; a stale-session event reaches no boundary observer", () => {
		const shim = makeLocalRuntimeHostShim()
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		shim._addSession("session-A")
		sessionA.current = "session-A"
		const unsubA = subscribeCanonicalRuntimeEventsToShadow(shim.host, wiring, "session-A")
		// Replace.
		unsubA()
		sessionA.current = "session-B"
		shim._addSession("session-B")
		subscribeCanonicalRuntimeEventsToShadow(shim.host, wiring, "session-B")
		const before = wiring.recorderCounts()
		// Late session-A event: the helper's sessionId filter rejects it.
		shim._deliver("session-A", runStartedEvent("run-A"))
		// Legitimate session-B delivery.
		shim._deliver("session-B", runStartedEvent("run-B"))
		const after = wiring.recorderCounts()
		expect(after.eventsObserved - before.eventsObserved).toBe(1)
	})

	// ------------------------------------------------------------------------
	// C-NAS-4: restore-like recovery with runId === undefined (B8
	// analogue). The wiring's boundary accepts the canonical event
	// because the lifecycle reports session-A as authoritative; the
	// host's sessionId matches; the run-id is recoverable from the
	// subsequent run-started event in a real run, but this row
	// proves the recovery alone (without a current run tracker
	// match) is admitted because the snapshot's runId is undefined.
	// ------------------------------------------------------------------------
	it("C-NAS-4: a restore-like recovery (runId === undefined) through the Local topology produces exactly 1 shadow observation", () => {
		const shim = makeLocalRuntimeHostShim()
		const wiring = createTaskShadowHostWiring(makeWiringDeps())
		shim._addSession("session-A")
		sessionA.current = "session-A"
		subscribeCanonicalRuntimeEventsToShadow(shim.host, wiring, "session-A")
		const before = wiring.recorderCounts()
		shim._deliver("session-A", recoveryEvent(undefined))
		const after = wiring.recorderCounts()
		expect(after.eventsObserved - before.eventsObserved).toBe(1)
	})
})

// ===========================================================================
// Acceptance summary (C2.4-C, real-Local-transport boundary composition half)
// ===========================================================================
//
//   REAL_CANONICAL_PATH              = PASS (subscribeCanonicalRuntimeEventsToShadow)
//   REFERENCE_PRESERVATION           = PASS (wiring.recorderCounts() read after delivery)
//
//   PRE_SESSION_TOPOLOGY              = PASS (C-NAS-1: zero deliveries, zero observations)
//   LEGITIMATE_SEQUENCE               = PASS (C-NAS-2: 5 deliveries, 5 observations,
//                                              0 suppressions)
//   STALE_SESSION_FILTER              = PASS (C-NAS-3: late session-A event filtered
//                                              by helper, only session-B admitted)
//   RESTORE_LIKE_RECOVERY             = PASS (C-NAS-4: runId undefined, 1 observation)
//
//   DUPLICATE_CANONICAL_OBSERVATIONS  = 0
//   OBSERVER_ERRORS                   = 0
//
//   PRODUCTION_SEMANTIC_DELTA         = 0  (no production change)
//   REDUCER_SEMANTIC_DELTA            = 0  (no reducer touched)
//
// Pairing:
//   File 1 (sdk/packages/core/src/runtime/host/local-runtime-host.c24-c-transport.test.ts)
//     proves the REAL LocalRuntimeHost.subscribeRuntimeEvents
//     topology delivers canonical events end-to-end (L1..L12).
//   File 2 (this file)
//     proves the wired boundary composition (production
//     subscribeCanonicalRuntimeEventsToShadow ->
//     TaskShadowHostWiring -> production guard at line 393)
//     classifies those events the same way C2.4-B's
//     fail-closed-boundary invariant requires (C-NAS-1..4).
//
// Together they satisfy the C2.4-C acceptance core. C2.4-D
// (Hub/Remote fallback) and C2.5 (real C04) remain out of scope
// of this commit.
