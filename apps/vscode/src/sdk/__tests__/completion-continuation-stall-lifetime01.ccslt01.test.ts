/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01-CORRECTION01-STALL-LIFETIME
 *
 * LIVE defect (LIVE recurrence, post-STALLED-REARM-LOOP01 fix):
 *
 *   Predecessor STALLED-REARM-LOOP01 fixed the held-set
 *   discriminator (the superset-aware STALL snapshot). It did NOT
 *   fix the LIFETIME of that snapshot. The production BCB
 *   re-registration block at
 *   `sdk-session-event-coordinator.ts:2015-2049` (inside
 *   `handleSessionEvent` for a `done`-with-held-results event)
 *   clears three fields together:
 *
 *     lastCompletionContinuationSessionEpoch       (REARM dedupe)
 *     lastCompletionContinuationControlFingerprint (STALL fingerprint)
 *     lastCompletionContinuationHeldSetSorted      (STALL held-set)
 *
 *   The first field is attempt-scoped (a new submit_and_exit may
 *   legitimately need a new continuation). The latter two are
 *   causal-state-scoped — they must survive a new attempt
 *   because the held set is unchanged. Clearing them makes every
 *   successor K+1 see `priorSortedHeld === undefined`, which the
 *   superset-aware discriminator treats as "first observation /
 *   no prior to compare against" ⇒ a new continuation is permitted.
 *
 *   The predecessor's synthetic RED/GREEN suite called
 *   `enqueueCompletionContinuationIfHeld()` directly, which
 *   never traversed the BCB re-registration seam that clears the
 *   state. This file exercises the REAL `handleSessionEvent` BCB
 *   re-registration path using the same
 *   `emitCompletionTurn` pattern as the predecessor's
 *   `background-completion-barrier01.bcb01.test.ts:358-375`.
 *
 * Architectural invariant for this ACT:
 *
 *   REARM ownership
 *     may reset when a legitimate new completion attempt begins.
 *
 *   STALL ownership
 *     survives that new attempt
 *     until CAUSAL PROGRESS or lifecycle replacement occurs.
 *
 *   A `submit_and_exit` re-call, a new BCB registration, a new
 *   pending prompt, a new runId, a new timestamp, and a new epoch
 *   are NOT causal progress and must NOT clear STALL authority.
 *
 * RED plan (C5/C6):
 *
 *   S/T active
 *   held = [J1]
 *
 *   K: emit done-with-held-results through real handleSessionEvent
 *      → continuation delivered (K=1)
 *      → STALL snapshot present (lastCompletionContinuationHeldSetSorted
 *        === [J1])
 *
 *   K+1: emit same done-with-held-results through real
 *        handleSessionEvent again → BCB re-registration happens
 *        → held still [J1] (no observation)
 *
 *   Pre-fix expected actual result:
 *     STALL snapshot cleared (lastCompletionContinuationHeldSetSorted
 *       === undefined)
 *     REARM marker cleared (lastCompletionContinuationSessionEpoch
 *       === undefined)
 *     K+1 enters enqueueCompletionContinuationIfHeld
 *     → priorSortedHeld === undefined
 *     → cannot classify same/superset as stalled
 *     → new continuation emitted (K=2)
 *     ⇒ loop.
 *
 *   Post-fix expected:
 *     STALL snapshot preserved
 *     REARM marker cleared
 *     K+1 enters enqueueCompletionContinuationIfHeld
 *     → priorSortedHeld === [J1]
 *     → held set unchanged ⇒ STALL
 *     → no continuation emitted
 *     ⇒ loop converges.
 */

import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	getCompletionContinuationUpstreamCounters,
	resetCompletionContinuationUpstreamForTests,
} from "../completion-continuation-upstream-runtime"
import { applyCompletionContinuationUpstreamDiagnosticProfile } from "../dogfood-diagnostic-profile"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import type { SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { SdkSessionEventCoordinator } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
	},
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => "default",
			getGlobalStateKey: () => undefined,
			setGlobalState: vi.fn(),
		}),
	},
}))

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly sendLog: Array<{ prompt: string; sessionId: string; taskId?: string }>
	readonly sessionId: string
	readonly taskId: string
	heldJobIdsRef: string[]
	countRef: number
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as CoreSessionEvent

function makeHarness(opts: { sessionId?: string; taskId?: string; heldJobIds?: readonly string[] } = {}): Harness {
	const sessionId = opts.sessionId ?? "session-ccslt01"
	const taskId = opts.taskId ?? "task-ccslt01"
	const heldJobIds = opts.heldJobIds ?? ["j1"]
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sendLog: Array<{ prompt: string; sessionId: string; taskId?: string }> = []
	const harnessRef: { current: Harness } = { current: undefined as unknown as Harness }
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		// The stall-lifetime seam lives in handleSessionEvent. Wire the
		// REAL production translator so the done event flows through
		// the production predicate chain that reaches BCB
		// re-registration.
		translateSessionEvent,
		sessions: {
			getActiveSession: () =>
				({
					sessionId: harnessRef.current?.sessionId ?? sessionId,
					sdkHost: {
						send: (input: { sessionId: string; prompt: string; delivery: "queue" }) => {
							const h = harnessRef.current
							sendLog.push({
								prompt: input.prompt,
								sessionId: input.sessionId,
								taskId: h?.taskId,
							})
							return Promise.resolve()
						},
					},
					unsubscribe: () => undefined,
					startResult: { sessionId },
					isRunning: false,
				}) as never,
			setRunning: () => undefined,
		},
		messages: { appendAndEmit: () => undefined },
		taskHistory: { updateTaskUsage: () => undefined },
		getTask: () => ({ taskId: harnessRef.current?.taskId ?? taskId }) as never,
		postStateToWebview: async () => undefined,
		setTurnPhase: ((phase, anchorTs, writerId) => {
			tracker.setWithWriter(phase, anchorTs, { writerId: writerId as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		pendingPromptsController: {
			enqueue: () => ({ id: "fake" }),
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		} as never,
		pendingPromptAuthorityAvailable: true,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasRunningBackgroundJobForOwner: () => false,
		// THE LOAD-BEARING PREDICATE FOR THE BCB RE-REGISTRATION SEAM:
		// unconsumedOwnedTerminalResultsForC10 > 0 forces the BCB
		// block at lines 2000-2075 to register a fresh
		// deferredCompletionBarrier AND clear the dedupe/stall
		// fields at 2029, 2040, 2049. This is exactly the path the
		// predecessor's synthetic suite skipped.
		getUnconsumedOwnedTerminalResultCount: () => {
			const ref = harnessRef.current
			return ref?.countRef ?? 0
		},
		getUnconsumedOwnedTerminalJobIds: () => {
			const ref = harnessRef.current
			return ref ? [...ref.heldJobIdsRef] : []
		},
		hasActiveNotify: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			sendLog.push({
				prompt: `mock:${input.heldJobIds.join(",")}`,
				sessionId: input.sessionId,
				taskId: input.taskId,
			})
			return Promise.resolve({ kind: "delivered" as const })
		},
		// CRCD01: wire the liveTools accessor so the inner enqueue's
		// truthful capability projection (sdk-session-event-coordinator.ts:1559-1562)
		// reads truthful capability from the test's live registry.
		// The test exercises the BCB re-registration with held=1 and
		// the model has the available tools, so capability=true.
		liveTools: () => ["command_status", "submit_and_exit"],
	} as unknown as SdkSessionEventCoordinatorOptions)
	// Seed the initial deferredCompletionBarrier so the FIRST BCB
	// re-registration actually runs (the BCB predicate checks
	// `outstandingAutonomousWork || ... || unconsumedOwnedTerminalResultsForC10 > 0`,
	// which is already true from the harness count callback).
	coordinator.setDeferredCompletionBarrierForTesting({
		sessionId,
		taskId,
		epoch: translatorState.getMinter().epoch,
	})
	const h: Harness = {
		coordinator,
		sendLog,
		sessionId,
		taskId,
		heldJobIdsRef: [...heldJobIds],
		countRef: heldJobIds.length,
	}
	harnessRef.current = h
	return h
}

/**
 * Production-shape driver: emits a `done` event through the REAL
 * `handleSessionEvent` path. The translator must have observed
 * the completion tool (via setAttemptCompletionSeen +
 * setTerminalResponseCommittedThisTurn) for the C10 path to
 * reach the BCB block at line 2015.
 */
async function emitCompletionTurn(
	coordinator: SdkSessionEventCoordinator,
	translatorState: MessageTranslatorState,
	sessionId: string,
): Promise<void> {
	translatorState.setAttemptCompletionSeen()
	translatorState.setTerminalResponseCommittedThisTurn()
	const doneEvent = agentEvent(sessionId, {
		type: "done",
		reason: "completed",
		text: "Task completed.",
		iterations: 1,
	})
	await coordinator.handleSessionEvent(doneEvent)
	// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C5 / C7):
	// the production seam now awaits BOTH Elm kernels (Completion
	// Authority + Continuation Control) before deciding the
	// outcome. The kernels are `Platform.worker` and use
	// `setTimeout(0)` for the outbound port. Drain the timer
	// queue so the synchronous-looking assertions below see
	// the post-Elm state. The previous test driver
	// (pre-HELD-SET-PROGRESS-AUTHORITY01) was synchronous
	// because the held-set comparison was inlined; the new
	// driver is async because Elm owns the comparison.
	await new Promise((r) => setTimeout(r, 50))
}

describe("ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01-CORRECTION01-STALL-LIFETIME", () => {
	beforeEach(() => {
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
	})

	afterEach(() => {
		resetCompletionContinuationUpstreamForTests()
	})

	it("STALL-LIFETIME-02: real handleSessionEvent BCB re-registration preserves STALL post-fix", async () => {
		// This test drives the REAL production path. Before the
		// bounded fix, the BCB re-registration block at
		// lines 2029, 2040, 2049 cleared BOTH the REARM marker
		// AND the STALL fields. This test pins that the BCB
		// re-registration seam is the LIFETIME boundary the
		// predecessor's synthetic suite missed.
		//
		// Pre-fix expected:
		//   after K+1 BCB re-registration:
		//     STALL snapshot cleared (lastCompletionContinuationHeldSetSorted
		//       === undefined)
		//     ⇒ K+1 → enqueueIfHeld sees priorSortedHeld === undefined
		//     ⇒ cannot classify same/superset as stalled
		//     ⇒ K+1 delivers
		//     ⇒ sendLog.length === 2 (loop)
		//
		// Post-fix expected:
		//   after K+1 BCB re-registration:
		//     STALL snapshot preserved ([J1])
		//     ⇒ K+1 → enqueueIfHeld sees priorSortedHeld === [J1]
		//     ⇒ held set unchanged ⇒ STALL
		//     ⇒ no new continuation
		//     ⇒ sendLog.length === 1
		//     ⇒ stalledNoProgress >= 1
		const h = makeHarness({ heldJobIds: ["j1"] })
		const coordinator = h.coordinator as unknown as {
			lastCompletionContinuationHeldSetSorted: readonly string[] | undefined
		}
		const translatorState = h.coordinator["options"].messageTranslatorState
		// K: real submit_and_exit → BCB registers the barrier →
		//     continuation delivered, STALL snapshot pinned.
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		// After K: STALL held-set pinned to [j1].
		expect(coordinator.lastCompletionContinuationHeldSetSorted).toEqual(["j1"])
		expect(h.sendLog.length).toBe(1)
		// K+1: real submit_and_exit → BCB re-registration runs.
		// Post-fix invariant: STALL snapshot must SURVIVE; the
		// enqueue that follows then sees priorSortedHeld === [j1]
		// and returns stalled_no_progress.
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		expect(coordinator.lastCompletionContinuationHeldSetSorted).toEqual(["j1"])
		expect(h.sendLog.length).toBe(1)
		const snap = getCompletionContinuationUpstreamCounters()
		expect(snap.enqueueCompletionContinuationInvoked).toBe(1)
		expect(snap.stalledNoProgress).toBeGreaterThanOrEqual(1)
	})

	it("STALL-LIFETIME-01: same J1 over 4 real BCB attempts → 1 delivery", async () => {
		const h = makeHarness({ heldJobIds: ["j1"] })
		const translatorState = h.coordinator["options"].messageTranslatorState
		for (let i = 0; i < 4; i++) {
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		}
		expect(h.sendLog.length).toBe(1)
		const snap = getCompletionContinuationUpstreamCounters()
		expect(snap.enqueueCompletionContinuationInvoked).toBe(1)
		expect(snap.stalledNoProgress).toBeGreaterThanOrEqual(3)
	})

	it("STALL-LIFETIME-09: STALL snapshot preserved across BCB re-registration; only 1 delivery", async () => {
		// Headline assertion per C17: the architectural boundary.
		// After K+1's BCB re-registration, the STALL snapshot
		// must SURVIVE. The enqueue that follows then sees
		// priorSortedHeld === [j1] and returns stalled_no_progress,
		// so the REARM marker is NOT re-pinned by an emission
		// (it stays cleared by the BCB clear at line 2029, and
		// the stalled branch in enqueueIfHeld returns before
		// line 1443's assignment).
		const h = makeHarness({ heldJobIds: ["j1"] })
		const coordinator = h.coordinator as unknown as {
			lastCompletionContinuationSessionEpoch: string | undefined
			lastCompletionContinuationControlFingerprint: string | undefined
			lastCompletionContinuationHeldSetSorted: readonly string[] | undefined
		}
		const translatorState = h.coordinator["options"].messageTranslatorState
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		// STALL authority preserved across BCB re-registration:
		expect(coordinator.lastCompletionContinuationControlFingerprint).toBeDefined()
		expect(coordinator.lastCompletionContinuationHeldSetSorted).toEqual(["j1"])
		// No new continuation emitted (K+1 was stalled):
		expect(h.sendLog.length).toBe(1)
		// REARM marker cleared at BCB, never re-pinned (the
		// stall branch in enqueueIfHeld returns before line
		// 1443's assignment).
		expect(coordinator.lastCompletionContinuationSessionEpoch).toBeUndefined()
	})

	it("STALL-LIFETIME-03: same J1, 4 attempts via real BCB → 1 delivery, 3 stalls", async () => {
		// Pin the exact recurrence that defeated the first
		// repair. 4 attempts of [J1] through real BCB
		// re-registration must yield exactly 1 delivery.
		const h = makeHarness({ heldJobIds: ["j1"] })
		const translatorState = h.coordinator["options"].messageTranslatorState
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		for (let i = 0; i < 3; i++) {
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		}
		expect(h.sendLog.length).toBe(1)
		const snap = getCompletionContinuationUpstreamCounters()
		expect(snap.enqueueCompletionContinuationInvoked).toBe(1)
		expect(snap.stalledNoProgress).toBeGreaterThanOrEqual(3)
	})

	it("STALL-LIFETIME-04: monotone superset accumulation still stalls through real BCB", async () => {
		// Monotone accumulation (LIVE shape) must remain stalled
		// through the real BCB re-registration path.
		const h = makeHarness({ heldJobIds: ["j1"] })
		const translatorState = h.coordinator["options"].messageTranslatorState
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		expect(h.sendLog.length).toBe(1)
		for (let i = 2; i <= 5; i++) {
			h.heldJobIdsRef.push(`accum-${i}`)
			h.countRef = h.heldJobIdsRef.length
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		}
		expect(h.sendLog.length).toBe(1)
		const snap = getCompletionContinuationUpstreamCounters()
		expect(snap.enqueueCompletionContinuationInvoked).toBe(1)
		expect(snap.stalledNoProgress).toBeGreaterThanOrEqual(4)
	})

	it("STALL-LIFETIME-05: contractive held set through real BCB permits successor", async () => {
		// STALL persistence must yield to real progress. The
		// predecessor's CCSRL-04 covered this at the enqueue
		// seam; this test pins it through the REAL BCB
		// re-registration path.
		const h = makeHarness({ heldJobIds: ["j1", "j2", "j3"] })
		const translatorState = h.coordinator["options"].messageTranslatorState
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		expect(h.sendLog.length).toBe(1)
		// Contract: model observed j1.
		h.heldJobIdsRef = ["j2", "j3"]
		h.countRef = 2
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		// Successor continuation permitted.
		expect(h.sendLog.length).toBe(2)
	})

	it("STALL-LIFETIME-06: explicit test reset clears both REARM and STALL", async () => {
		const h = makeHarness({ heldJobIds: ["j1"] })
		const coordinator = h.coordinator as unknown as {
			lastCompletionContinuationSessionEpoch: string | undefined
			lastCompletionContinuationControlFingerprint: string | undefined
			lastCompletionContinuationHeldSetSorted: readonly string[] | undefined
		}
		const translatorState = h.coordinator["options"].messageTranslatorState
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		expect(coordinator.lastCompletionContinuationHeldSetSorted).toEqual(["j1"])
		// Test reset backdoor: the ONLY legitimate boundary for
		// clearing STALL authority outside causal progress or
		// lifecycle replacement.
		h.coordinator.clearCompletionContinuationSentForTesting()
		expect(coordinator.lastCompletionContinuationSessionEpoch).toBeUndefined()
		expect(coordinator.lastCompletionContinuationControlFingerprint).toBeUndefined()
		expect(coordinator.lastCompletionContinuationHeldSetSorted).toBeUndefined()
	})

	it("STALL-LIFETIME-NECESSITY: simulate the pre-fix STALL clear → loop returns", async () => {
		// Necessity ablation. If a future refactor reunifies
		// the lifetimes (re-adds the STALL clear to the BCB
		// block), this test re-detects the regression by
		// manually performing the BAD clear that the production
		// code used to do, then driving K+1.
		const h = makeHarness({ heldJobIds: ["j1"] })
		const translatorState = h.coordinator["options"].messageTranslatorState
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		expect(h.sendLog.length).toBe(1)
		const coordinator = h.coordinator as unknown as {
			lastCompletionContinuationControlFingerprint: string | undefined
			lastCompletionContinuationHeldSetSorted: readonly string[] | undefined
		}
		// SIMULATE the pre-fix BCB re-registration that ALSO
		// cleared STALL authority. This MUST reintroduce the
		// loop. The next real BCB attempt then emits a new
		// continuation.
		coordinator.lastCompletionContinuationControlFingerprint = undefined
		coordinator.lastCompletionContinuationHeldSetSorted = undefined
		await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
		// Pre-fix behavior: a new continuation was emitted.
		expect(h.sendLog.length).toBe(2)
	})

	it("STALL-LIFETIME-07: task replacement (new coordinator instance) clears STALL authority", async () => {
		// C14 / §C2 architectural claim: STALL authority must
		// not leak across task replacement. The production
		// comment at the BCB block (line ~2055) lists "task
		// replacement (new coordinator instance)" as a
		// legitimate STALL-clear boundary. This test proves
		// that claim by driving the real BCB re-registration
		// seam across a fresh coordinator instance with a new
		// taskId. If coordinator replacement genuinely gives
		// fresh state, this passes with ZERO production
		// changes. If it fails, we have a real cross-task
		// state leak.
		const taskA = "task-A-ccslt01"
		const taskB = "task-B-ccslt01"
		const sharedSession = "session-ccslt07-shared"
		// Establish stall for taskA on coordinator C1.
		const h1 = makeHarness({ sessionId: sharedSession, taskId: taskA, heldJobIds: ["j1"] })
		const t1 = h1.coordinator["options"].messageTranslatorState
		await emitCompletionTurn(h1.coordinator, t1, h1.sessionId)
		const c1 = h1.coordinator as unknown as {
			lastCompletionContinuationHeldSetSorted: readonly string[] | undefined
		}
		expect(c1.lastCompletionContinuationHeldSetSorted).toEqual(["j1"])
		expect(h1.sendLog.length).toBe(1)
		// Task replacement: fresh coordinator C2 with a new
		// taskId. The architectural claim is that the new
		// coordinator has its own STALL state.
		const h2 = makeHarness({ sessionId: sharedSession, taskId: taskB, heldJobIds: ["j1"] })
		const c2 = h2.coordinator as unknown as {
			lastCompletionContinuationHeldSetSorted: readonly string[] | undefined
		}
		// Fresh coordinator ⇒ no inherited STALL.
		expect(c2.lastCompletionContinuationHeldSetSorted).toBeUndefined()
		// First T2 emit must NOT be suppressed by T1's stall
		// state (and the BCB barrier is freshly seeded for
		// the new coordinator so the BCB block fires).
		const t2 = h2.coordinator["options"].messageTranslatorState
		await emitCompletionTurn(h2.coordinator, t2, h2.sessionId)
		expect(h2.sendLog.length).toBe(1)
	})

	it("STALL-LIFETIME-08: session replacement (new coordinator instance) clears STALL authority", async () => {
		// Same claim as STALL-LIFETIME-07 but for session
		// replacement. Establish stall for session S1 on
		// coordinator C1; replace with fresh coordinator C2
		// running session S2; first S2 emission must not be
		// suppressed by S1's stall state.
		const sessionA = "session-A-ccslt08"
		const sessionB = "session-B-ccslt08"
		const sharedTask = "task-ccslt08-shared"
		const h1 = makeHarness({ sessionId: sessionA, taskId: sharedTask, heldJobIds: ["j1"] })
		const t1 = h1.coordinator["options"].messageTranslatorState
		await emitCompletionTurn(h1.coordinator, t1, h1.sessionId)
		const c1 = h1.coordinator as unknown as {
			lastCompletionContinuationHeldSetSorted: readonly string[] | undefined
		}
		expect(c1.lastCompletionContinuationHeldSetSorted).toEqual(["j1"])
		expect(h1.sendLog.length).toBe(1)
		// Session replacement: fresh coordinator C2 with a
		// new sessionId.
		const h2 = makeHarness({ sessionId: sessionB, taskId: sharedTask, heldJobIds: ["j1"] })
		const c2 = h2.coordinator as unknown as {
			lastCompletionContinuationHeldSetSorted: readonly string[] | undefined
		}
		expect(c2.lastCompletionContinuationHeldSetSorted).toBeUndefined()
		const t2 = h2.coordinator["options"].messageTranslatorState
		await emitCompletionTurn(h2.coordinator, t2, h2.sessionId)
		expect(h2.sendLog.length).toBe(1)
	})
})
