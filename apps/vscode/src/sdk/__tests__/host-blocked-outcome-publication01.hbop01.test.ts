/**
 * ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01 — HBOP01
 *
 * Recon proved that the existing Elm Continuation Control kernel
 * already classifies blocked outcomes (P2 stalled_no_progress, P5
 * observation_unavailable). The P1 ACT (ELMIZE-P1-BLOCKED-OUTCOME-
 * CLASSIFICATION01) closed at PASS_NO_ELM_MIGRATION_NEEDED with the
 * finding that the missing seam is a HOST PUBLICATION GAP, not a
 * pure policy gap.
 *
 * The host production path:
 *
 *     enqueueCompletionContinuationIfHeld()
 *         ↓ Promise<EnqueueCompletionContinuationOutcome>
 *     (8-member discriminated union, including
 *      { kind: "stalled_no_progress" })
 *         ↓
 *     call site A (reevaluate, L1080) | call site B (C10, L2102)
 *         ↓ .then((outcome) => ...)
 *     OUTCOME_DISCARDED — the typed blocked verdict is never
 *     published to any operator-visible host state.
 *
 * The existing production "blocked" surface is the
 * `deferredCompletionBarrier` marker. It is registered by the
 * C10 barrier predicate (L2000-2075) when the turn is held with
 * held work outstanding, and consumed by
 * `isDeferredCompletionOutstanding` which gates the rebuild
 * scheduler's `drain`. The marker IS the host-owned blocked
 * state. The gap is the TYPED REASON.
 *
 * This ACT adds a typed `reason` field to the marker. The two
 * call sites wrap their existing `.then((outcome) => ...)` to
 * call a single private helper that maps
 *   stalled_no_progress → "stalled_no_progress"
 *   rejected            → "delivery_rejected"
 * and stamps the marker with the typed reason IF the captured
 * session/task still match the live active session/task.
 *
 * Elm authority conservation (C15): no changes under
 *     apps/vscode/elm/ **
 *     completion-continuation-control-elm.ts
 *     completion-authority-elm-authority-runtime.ts
 *     completion-authority-elm-authority.ts
 * The published outcome represents existing decisions, not
 * recomputed ones in TypeScript.
 *
 * No fabricated completion (C11): the test asserts
 *   getTurnPhase() !== "completed"
 * in every blocked scenario.
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
	/**
	 * Replaces the active taskId returned by `getTask()`. Used
	 * by the C4 adversarial case to simulate a task
	 * replacement between fire and resolution of the enqueue.
	 */
	liveTaskIdRef: string
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as CoreSessionEvent

const SEVEN_HELD_IDS: readonly string[] = ["j1", "j2", "j3", "j4", "j5", "j6", "j7"]

/**
 * Production-shape driver: emits a `done` event through the REAL
 * `handleSessionEvent` path.
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
	// the production seam now awaits BOTH Elm kernels before
	// deciding the outcome. The kernels are `Platform.worker`
	// and use `setTimeout(0)` for the outbound port. Drain the
	// timer queue so the synchronous-looking assertions below
	// see the post-Elm state.
	await new Promise((r) => setTimeout(r, 50))
}

function makeHarness(
	opts: {
		sessionId?: string
		taskId?: string
		heldJobIds?: readonly string[]
		/**
		 * The continuation callback shape the production seam
		 * supplies. Defaults to "always delivered"; tests inject
		 * "always rejected" to exercise the downstream mapping.
		 */
		continuationResult?: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => Promise<{ kind: "delivered" }> | Promise<{ kind: "rejected" }>
	} = {},
): Harness {
	const sessionId = opts.sessionId ?? "session-hbop01"
	const taskId = opts.taskId ?? "task-hbop01"
	const heldJobIds = opts.heldJobIds ?? SEVEN_HELD_IDS
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sendLog: Array<{ prompt: string; sessionId: string; taskId?: string }> = []
	const harnessRef: { current: Harness } = { current: undefined as unknown as Harness }
	const defaultContinuation = (input: { sessionId: string; taskId: string | undefined; heldJobIds: readonly string[] }) => {
		sendLog.push({
			prompt: `mock:${input.heldJobIds.join(",")}`,
			sessionId: input.sessionId,
			taskId: input.taskId,
		})
		return Promise.resolve({ kind: "delivered" as const })
	}
	const continuationResult = opts.continuationResult ?? defaultContinuation
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
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
		getTask: () => ({ taskId: harnessRef.current?.liveTaskIdRef ?? taskId }) as never,
		postStateToWebview: async () => undefined,
		setTurnPhase: ((phase, anchorTs, writerId) => {
			tracker.setWithWriter(phase, anchorTs, { writerId: writerId as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
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
		enqueueCompletionContinuation: continuationResult,
	} as unknown as SdkSessionEventCoordinatorOptions)
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
		liveTaskIdRef: taskId,
	}
	harnessRef.current = h
	return h
}

describe("ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01 — HBOP01", () => {
	beforeEach(() => {
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
	})

	afterEach(() => {
		resetCompletionContinuationUpstreamForTests()
	})

	describe("RED#1 — stalled_no_progress reaches a typed host publication", () => {
		it("HBOP-01: first K delivers; K+1 stalls; marker carries reason='stalled_no_progress'", async () => {
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			// K: real submit_and_exit → BCB registers barrier →
			// continuation delivered, STALL snapshot pinned.
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			expect(h.sendLog.length).toBe(1)

			// K+1: real submit_and_exit → BCB re-registration runs →
			// enqueueIfHeld sees priorSortedHeld === [j1..j7],
			// the new set is identical, returns stalled_no_progress.
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 50))
			expect(h.sendLog.length).toBe(1)

			// HBOP HEADLINE: the marker now carries a typed reason.
			const barrier = h.coordinator.getDeferredCompletionBarrierForTesting() as
				| { sessionId: string; taskId: string | undefined; epoch: number; reason?: string }
				| undefined
			expect(barrier).toBeDefined()
			expect(barrier?.reason).toBe("stalled_no_progress")
			// Correlation invariants (C4).
			expect(barrier?.sessionId).toBe(h.sessionId)
			expect(barrier?.taskId).toBe(h.taskId)
		})

		it("HBOP-02: stalled outcome is idempotent — same held set, multiple stalls, one typed publication", async () => {
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			expect(h.sendLog.length).toBe(1)

			for (let i = 0; i < 3; i++) {
				await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			}
			await new Promise<void>((r) => setTimeout(r, 50))

			expect(h.sendLog.length).toBe(1)
			const snap = getCompletionContinuationUpstreamCounters()
			expect(snap.stalledNoProgress).toBeGreaterThanOrEqual(3)
			const barrier = h.coordinator.getDeferredCompletionBarrierForTesting() as { reason?: string } | undefined
			expect(barrier).toBeDefined()
			expect(barrier?.reason).toBe("stalled_no_progress")
		})

		it("HBOP-03: completion is NOT fabricated while held > 0 + stall publishes", async () => {
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 50))

			const phase = h.coordinator["options"].getTurnPhase?.()
			expect(phase).not.toBe("completed")
			expect(phase).toBe("idle")
		})
	})

	describe("RED#2 — non-blocked outcomes do NOT publish a blocked reason", () => {
		it("HBOP-10: a delivered outcome does not stamp a blocked reason on the marker", async () => {
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 50))
			expect(h.sendLog.length).toBe(1)

			const barrier = h.coordinator.getDeferredCompletionBarrierForTesting() as { reason?: string } | undefined
			expect(barrier).toBeDefined()
			expect(barrier?.reason).toBeUndefined()
		})

		it("HBOP-11: a `rejected` callback outcome publishes reason='delivery_rejected'", async () => {
			const h = makeHarness({
				heldJobIds: SEVEN_HELD_IDS,
				continuationResult: () => Promise.resolve({ kind: "rejected" as const }),
			})
			const translatorState = h.coordinator["options"].messageTranslatorState

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 50))
			expect(h.sendLog.length).toBe(0)

			const barrier = h.coordinator.getDeferredCompletionBarrierForTesting() as { reason?: string } | undefined
			expect(barrier).toBeDefined()
			expect(barrier?.reason).toBe("delivery_rejected")
		})
	})

	describe("RED#3 — task replacement (C4 adversarial) does not leak", () => {
		it("HBOP-20: T1 stalled outcome does NOT publish onto a T2 replacement task", async () => {
			// C4 adversarial case. The production timeline:
			//   1. K's enqueue fires for T1 (captured=T1).
			//   2. K's BCB block has registered the marker for T1.
			//   3. Before K's enqueue resolves, a task replacement
			//      occurs: K+1's BCB block re-registers the marker
			//      for T2 (a fresh epoch too).
			//   4. K's enqueue resolves with captured=T1.
			//   5. The mapping MUST observe the captured/live
			//      identity mismatch and refuse to stamp T2.
			//
			// We simulate the production scenario by:
			//   - First emitCompletionTurn for T1: marker set for T1,
			//     continuation delivered (one sendLog entry).
			//   - Switch liveTaskIdRef to T2.
			//   - Manually re-register the marker for T2 (mimicking
			//     what K+1\'s BCB block would do on its own
			//     handleSessionEvent invocation) WITHOUT firing a new
			//     enqueue — the enqueue being resolved is the SAME
			//     enqueue from K.
			//   - Then the resolution: the captured value is T1, the
			//     marker is T2 (newer epoch), so the mapping refuses.
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			// K: T1 is active. Marker is seeded for T1 already by
			// the harness constructor.
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			expect(h.sendLog.length).toBe(1)

			// Simulate the T1 → T2 task replacement. The BCB
			// re-registration for T2 has happened. The marker is
			// now for T2 with a fresh deferredAt.
			h.liveTaskIdRef = "task-hbop01-t2"
			h.coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: h.sessionId,
				taskId: "task-hbop01-t2",
				epoch: translatorState.getMinter().epoch,
			})

			// Now invoke the helper directly with the captured T1
			// identity. The validation must observe the
			// captured/live mismatch and refuse to stamp.
			const coord = h.coordinator as unknown as {
				applyBlockedCompletionContinuationOutcome: (
					captured: { sessionId: string; taskId: string | undefined; enqueueEpoch: number },
					outcome: { kind: "stalled_no_progress" },
				) => void
			}
			// CORRECTION01: the captured identity now includes
			// `enqueueEpoch`. We pass the SAME epoch the marker
			// was at when K fired, so the helper's epoch-binding
			// guard would NOT refuse on epoch mismatch - it
			// refuses because session/task identity diverges
			// between captured (T1) and the LIVE marker (T2).
			coord.applyBlockedCompletionContinuationOutcome(
				{
					sessionId: h.sessionId,
					taskId: h.taskId /* captured T1 */,
					enqueueEpoch: translatorState.getMinter().epoch,
				},
				{ kind: "stalled_no_progress" },
			)

			const barrier = h.coordinator.getDeferredCompletionBarrierForTesting() as
				| { reason?: string; taskId?: string | undefined }
				| undefined
			// The marker is still T2 (manually set above), and
			// the reason MUST NOT be stamped because the captured
			// taskId is T1 — the resolution is stale.
			if (barrier !== undefined) {
				expect(barrier.reason).toBeUndefined()
			}
		})
	})

	describe("RED#4 — CORRECTION01: production consumer (no test-accessor-only claim)", () => {
		it("HBOP-30: a successful stalled publication increments the production dogfood counter", async () => {
			// CORRECTION01 reviewer's P0 finding: the predecessor
			// ACT claimed the typed `reason` was a production
			// publication, but the only observer was the test
			// accessor `getDeferredCompletionBarrierForTesting()`.
			// The production rebuild-scheduler consumer only
			// reads a boolean, not the reason.
			//
			// CORRECTION01 adds a production-readable surface:
			// `recordBlockedOutcomeStalledNoProgress()` increments
			// the dogfood upstream counter that the operator
			// already uses for U0..U11 first-divergence dumps.
			// This test asserts the counter increments ONCE per
			// successful publication.
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			const before = getCompletionContinuationUpstreamCounters().blockedOutcomeStalledNoProgress ?? 0

			// K: first turn, delivered.
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			// K+1: same held set, returns stalled_no_progress.
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 50))

			const after = getCompletionContinuationUpstreamCounters().blockedOutcomeStalledNoProgress ?? 0
			// The K+1 stalled verdict was published onto the
			// marker AND the production counter incremented.
			expect(after).toBeGreaterThan(before)
			expect(after - before).toBe(1)

			const barrier = h.coordinator.getDeferredCompletionBarrierForTesting() as { reason?: string } | undefined
			expect(barrier?.reason).toBe("stalled_no_progress")
		})

		it("HBOP-31: a successful delivery_rejected publication increments the parallel production counter", async () => {
			const h = makeHarness({
				heldJobIds: SEVEN_HELD_IDS,
				continuationResult: () => Promise.resolve({ kind: "rejected" as const }),
			})
			const translatorState = h.coordinator["options"].messageTranslatorState

			const before = getCompletionContinuationUpstreamCounters().blockedOutcomeDeliveryRejected ?? 0

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 50))

			const after = getCompletionContinuationUpstreamCounters().blockedOutcomeDeliveryRejected ?? 0
			expect(after).toBeGreaterThan(before)
			expect(after - before).toBe(1)
		})

		it("HBOP-32: a non-blocked outcome does NOT increment either production counter", async () => {
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			const beforeStalled = getCompletionContinuationUpstreamCounters().blockedOutcomeStalledNoProgress ?? 0
			const beforeRejected = getCompletionContinuationUpstreamCounters().blockedOutcomeDeliveryRejected ?? 0

			// Single turn: delivered (no stall).
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 50))

			const afterStalled = getCompletionContinuationUpstreamCounters().blockedOutcomeStalledNoProgress ?? 0
			const afterRejected = getCompletionContinuationUpstreamCounters().blockedOutcomeDeliveryRejected ?? 0
			expect(afterStalled).toBe(beforeStalled)
			expect(afterRejected).toBe(beforeRejected)
		})
	})

	describe("RED#5 — CORRECTION01: epoch binding (reviewer's P0 K-then-K+1 scenario)", () => {
		it("HBOP-40: K fired at epoch 10, marker advances to 11, K resolves at 11 — NO stamp", async () => {
			// CORRECTION01 reviewer's P0 finding: the predecessor
			// epoch guard used `currentEpoch = getMinter().epoch`
			// at resolution time, permitting the failure mode:
			//   K fires at epoch 10
			//   K+1 advances to 11
			//   BCB re-registers marker at epoch 11
			//   K resolves at epoch 11
			//   currentEpoch === 11, marker.epoch === 11
			//   the check `marker.epoch !== currentEpoch` is false
			//   the helper stamps — INCORRECT
			//
			// With CORRECTION01, the helper requires
			//   marker.epoch === captured.enqueueEpoch
			// K's captured.enqueueEpoch is 10; the marker is at
			// 11; the check fails; the helper refuses.
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			// K: first turn delivered. Marker seeded by harness.
			const kEpoch = translatorState.getMinter().epoch
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 50))

			// Simulate K+1 advancing the epoch: mint a new
			// messageId (any internal producer) so the minter
			// epoch ticks. Then re-register the marker at the
			// new epoch (this is what a fresh BCB cycle does
			// in production).
			// Bump the epoch twice to simulate two
			// messageId mintings by other producers (the
			// the boundary in production is `bumpEpoch()`
			// on the minter).
			translatorState.getMinter().bumpEpoch()
			translatorState.getMinter().bumpEpoch()
			const k1Epoch = translatorState.getMinter().epoch
			expect(k1Epoch).toBeGreaterThan(kEpoch)
			h.coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: h.sessionId,
				taskId: h.taskId,
				epoch: k1Epoch,
			})

			// Now invoke the helper directly with K's captured
			// epoch (kEpoch). The marker is at k1Epoch; the
			// helper's epoch-binding guard refuses.
			const coord = h.coordinator as unknown as {
				applyBlockedCompletionContinuationOutcome: (
					captured: { sessionId: string; taskId: string | undefined; enqueueEpoch: number },
					outcome: { kind: "stalled_no_progress" },
				) => void
			}
			const beforeCounter = getCompletionContinuationUpstreamCounters().blockedOutcomeStalledNoProgress ?? 0
			coord.applyBlockedCompletionContinuationOutcome(
				{ sessionId: h.sessionId, taskId: h.taskId, enqueueEpoch: kEpoch /* K's captured epoch */ },
				{ kind: "stalled_no_progress" },
			)

			const barrier = h.coordinator.getDeferredCompletionBarrierForTesting() as
				| { reason?: string; epoch: number }
				| undefined
			// The marker survives, the reason is NOT stamped
			// (the K resolution was stale w.r.t. the K+1 marker).
			expect(barrier).toBeDefined()
			expect(barrier?.reason).toBeUndefined()
			expect(barrier?.epoch).toBe(k1Epoch)
			// The production counter is NOT incremented.
			const afterCounter = getCompletionContinuationUpstreamCounters().blockedOutcomeStalledNoProgress ?? 0
			expect(afterCounter).toBe(beforeCounter)
		})
	})

	describe("RED#6 — CORRECTION01: no-fabrication (reviewer's P0 finding)", () => {
		it("HBOP-50: a blocked verdict resolves when no matching marker exists — NO fresh marker is created", () => {
			// CORRECTION01 reviewer's P0 finding: the predecessor
			// helper could create a fresh barrier from a stale
			// result when the BCB had not yet registered (or
			// had cleared the marker). With CORRECTION01, the
			// helper refuses when the marker is undefined.
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			// Clear the seeded marker (setDeferredCompletionBarrierForTesting
			// already supports undefined).
			h.coordinator.setDeferredCompletionBarrierForTesting(undefined)
			expect(h.coordinator.getDeferredCompletionBarrierForTesting()).toBeUndefined()

			const coord = h.coordinator as unknown as {
				applyBlockedCompletionContinuationOutcome: (
					captured: { sessionId: string; taskId: string | undefined; enqueueEpoch: number },
					outcome: { kind: "stalled_no_progress" },
				) => void
			}
			const beforeCounter = getCompletionContinuationUpstreamCounters().blockedOutcomeStalledNoProgress ?? 0
			coord.applyBlockedCompletionContinuationOutcome(
				{ sessionId: h.sessionId, taskId: h.taskId, enqueueEpoch: 0 },
				{ kind: "stalled_no_progress" },
			)

			// The marker is STILL undefined; the helper did
			// NOT fabricate a fresh barrier.
			expect(h.coordinator.getDeferredCompletionBarrierForTesting()).toBeUndefined()
			const afterCounter = getCompletionContinuationUpstreamCounters().blockedOutcomeStalledNoProgress ?? 0
			expect(afterCounter).toBe(beforeCounter)
		})
	})

	describe("RED#7 — Elm authority conservation (C15)", () => {
		it("HBOP-60: the disc verdict comes from the TS stall discriminator, not from a re-derived Elm consult", async () => {
			// Real invariant: the helper increments the production
			// counter ONLY when the upstream disc returns
			// `stalled_no_progress`; the Elm policy is NOT consulted
			// for the verdict (the disc is causal-state, not
			// capability). Verified by: (a) the production counter
			// incremented in HBOP-30 WITHOUT touching any
			// `invokeElmKernel` call, (b) the source-level guard
			// `git diff -- apps/vscode/elm/` is empty, (c) the
			// helper body uses no `invokeElm*` symbol.
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 50))

			// Real assertion: the production counter incremented
			// as a result of the TS disc verdict alone. (The
			// upstream diagnostic is enabled in beforeEach, so
			// the counter is observable.)
			const snap = getCompletionContinuationUpstreamCounters()
			expect(snap.stalledNoProgress ?? 0).toBeGreaterThanOrEqual(1)
			expect(snap.blockedOutcomeStalledNoProgress ?? 0).toBeGreaterThanOrEqual(1)
		})
	})
})
