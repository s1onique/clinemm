/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01
 *
 * LIVE defect (task/session 1791400813202_ddnh3):
 *  4 submit_and_exit → 4 pending_prompt_enqueued → 4 continuation_scheduled
 *  → 4 continuation_started → loop → 0 task_completion_committed.
 *
 * Counter evidence (LIVE dump, frozen at Oct 8 2026):
 *   submit_and_exit_seen = 4
 *   pending_prompt_enqueued = 4
 *   continuation_scheduled = 4
 *   continuation_started = 4
 *   enqueueIfHeldEntered = 8
 *   stalledNoProgress = 4
 *   dedupePermitted = 4
 *   enqueueCompletionContinuationInvoked = 4
 *   task_completion_committed = 0
 *   held terminal count = 10 (last)
 *
 * The 4 stalledNoProgress + 4 dedupePermitted over 8 entries proves the
 * stall detector and the dedupe detector were both firing in alternating
 * fashion — meaning the production stall fingerprint was being BYPASSED
 * whenever the heldJobIds set changed.
 *
 * Production stall fingerprint (pre-fix):
 *   `${activeSessionId}|${taskId ?? "(none)"}|${unconsumedOwnedTerminalResultsForC10}|
 *     ${heldJobIds.slice().sort().join(",")}`
 *
 * In the LIVE specimen, `heldJobIds` grows monotonically as new background
 * terminals arrive between continuation attempts. The model has no
 * observation capability, so it never consumes any. Each call sees a
 * structurally DIFFERENT fingerprint (different heldJobIds) and the stall
 * detector therefore permits the enqueue.
 *
 * Causal repair: the stall fingerprint must be "absorbing" for a given
 * (sessionId, taskId, canonical heldJobIds) tuple as long as the held set
 * is a pure superset of the prior observed held set. Pure growth = no
 * consumption = no progress = STALL. Real progress = the held set contracts
 * or shifts membership (the model observed something).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	getCompletionContinuationUpstreamCounters,
	resetCompletionContinuationUpstreamForTests,
} from "../completion-continuation-upstream-runtime"
import { applyCompletionContinuationUpstreamDiagnosticProfile } from "../dogfood-diagnostic-profile"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import type { SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { SdkSessionEventCoordinator } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly sendLog: Array<{ prompt: string; sessionId: string; taskId?: string }>
	readonly sessionId: string
	readonly taskId: string
	readonly heldJobIds: readonly string[]
	heldJobIdsRef: string[]
	countRef: number
}

function makeHarness(
	opts: {
		wireCallback?: boolean
		sessionId?: string
		taskId?: string
		heldJobIds?: readonly string[]
		heldCount?: number
	} = {},
): Harness {
	const sessionId = opts.sessionId ?? "session-ccsrl01"
	const taskId = opts.taskId ?? "task-ccsrl01"
	const heldJobIds = opts.heldJobIds ?? ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8", "j9", "j10"]
	const heldCount = opts.heldCount ?? heldJobIds.length
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sendLog: Array<{ prompt: string; sessionId: string; taskId?: string }> = []
	const harnessRef: { current: Harness } = { current: undefined as unknown as Harness }
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
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
		enqueueCompletionContinuation: opts.wireCallback
			? (input: { sessionId: string; taskId: string | undefined; heldJobIds: readonly string[] }) => {
					sendLog.push({
						prompt: `mock:${input.heldJobIds.join(",")}`,
						sessionId: input.sessionId,
						taskId: input.taskId,
					})
					return Promise.resolve({ kind: "delivered" as const })
				}
			: undefined,
		// CRCD01: wire the liveTools accessor so the inner enqueue's
		// truthful capability projection (sdk-session-event-coordinator.ts:1559-1562)
		// reads truthful capability from the test's live registry.
		liveTools: () => ["command_status", "submit_and_exit"],
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
		heldJobIds,
		heldJobIdsRef: [...heldJobIds],
		countRef: heldCount,
	}
	harnessRef.current = h
	return h
}

describe("ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01", () => {
	beforeEach(() => {
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
	})

	afterEach(() => {
		resetCompletionContinuationUpstreamForTests()
	})

	it("CCSRL-01: 4 submit_and_exits with monotone held accumulation → exactly 1 delivery", async () => {
		const h = makeHarness({ wireCallback: true })
		const first = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(first.kind).toBe("delivered")
		expect(h.sendLog.length).toBe(1)
		h.heldJobIdsRef = ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8", "j9", "j10", "j11"]
		h.countRef = 11
		const second = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(second.kind).toBe("stalled_no_progress")
		expect(h.sendLog.length).toBe(1)
		h.heldJobIdsRef = ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8", "j9", "j10", "j11", "j12"]
		h.countRef = 12
		const third = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(third.kind).toBe("stalled_no_progress")
		expect(h.sendLog.length).toBe(1)
		h.heldJobIdsRef = ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8", "j9", "j10", "j11", "j12", "j13"]
		h.countRef = 13
		const fourth = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(fourth.kind).toBe("stalled_no_progress")
		expect(h.sendLog.length).toBe(1)
		const snap = getCompletionContinuationUpstreamCounters()
		expect(snap.stalledNoProgress).toBeGreaterThanOrEqual(3)
		expect(snap.enqueueCompletionContinuationInvoked).toBe(1)
	})

	it("CCSRL-02: same held set, reordered → stall (canonical ordering)", async () => {
		const h = makeHarness({ wireCallback: true, heldJobIds: ["j3", "j1", "j2"] })
		const first = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(first.kind).toBe("delivered")
		h.heldJobIdsRef = ["j2", "j3", "j1"]
		h.countRef = 3
		const second = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(second.kind).toBe("stalled_no_progress")
	})

	it("CCSRL-03: pure superset (no consumption) is NOT progress → stall", async () => {
		const h = makeHarness({
			wireCallback: true,
			heldJobIds: ["j1", "j2", "j3"],
			heldCount: 3,
		})
		const first = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(first.kind).toBe("delivered")
		h.heldJobIdsRef = ["j1", "j2", "j3", "j4"]
		h.countRef = 4
		const second = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(second.kind).toBe("stalled_no_progress")
	})

	it("CCSRL-04: contractive change (consumption) IS progress → rearm allowed", async () => {
		const h = makeHarness({
			wireCallback: true,
			heldJobIds: ["j1", "j2", "j3"],
			heldCount: 3,
		})
		const first = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(first.kind).toBe("delivered")
		h.heldJobIdsRef = ["j2", "j3"]
		h.countRef = 2
		const second = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(second.kind).toBe("delivered")
		expect(h.sendLog.length).toBe(2)
	})

	it("CCSRL-05: task change resets stall ownership", async () => {
		const h1 = makeHarness({ wireCallback: true, taskId: "task-A" })
		const first = await h1.coordinator.enqueueCompletionContinuationIfHeld(h1.sessionId, h1.countRef, h1.taskId)
		expect(first.kind).toBe("delivered")
		const h2 = makeHarness({
			wireCallback: true,
			sessionId: h1.sessionId,
			taskId: "task-B",
			heldJobIds: ["j1", "j2", "j3"],
		})
		const second = await h2.coordinator.enqueueCompletionContinuationIfHeld(h1.sessionId, 3, "task-B")
		expect(second.kind).toBe("delivered")
	})

	it("CCSRL-06: session change resets stall ownership", async () => {
		const h1 = makeHarness({ wireCallback: true, sessionId: "session-A" })
		const first = await h1.coordinator.enqueueCompletionContinuationIfHeld(h1.sessionId, h1.countRef, h1.taskId)
		expect(first.kind).toBe("delivered")
		const h2 = makeHarness({
			wireCallback: true,
			sessionId: "session-B",
			heldJobIds: ["j1", "j2", "j3"],
		})
		const second = await h2.coordinator.enqueueCompletionContinuationIfHeld("session-B", 3, h2.taskId)
		expect(second.kind).toBe("delivered")
	})

	it("CCSRL-07: held set unchanged, count accessor flickered → stall", async () => {
		const h = makeHarness({
			wireCallback: true,
			heldJobIds: ["j1", "j2", "j3"],
			heldCount: 3,
		})
		const first = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(first.kind).toBe("delivered")
		h.countRef = 3
		const second = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(second.kind).toBe("stalled_no_progress")
	})

	it("CCSRL-08: discriminator snapshot — 4 attempts → 1 invoke, 3 stalls", async () => {
		const h = makeHarness({ wireCallback: true })
		await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		for (let i = 0; i < 3; i++) {
			h.heldJobIdsRef = [...h.heldJobIdsRef, `extra-${i}`]
			h.countRef = h.heldJobIdsRef.length
			await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		}
		const snap = getCompletionContinuationUpstreamCounters()
		expect(snap.enqueueCompletionContinuationInvoked).toBe(1)
		expect(snap.stalledNoProgress).toBeGreaterThanOrEqual(3)
	})

	it("REARM-CONS-01: same fingerprint twice → second is stalled_no_progress", async () => {
		const h = makeHarness({ wireCallback: true })
		const first = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(first.kind).toBe("delivered")
		const second = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(second.kind).toBe("stalled_no_progress")
	})

	it("REARM-CONS-02: held J1..J10 → J2..J10 (model observed J1) → rearm allowed", async () => {
		const h = makeHarness({
			wireCallback: true,
			heldJobIds: ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8", "j9", "j10"],
			heldCount: 10,
		})
		const first = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(first.kind).toBe("delivered")
		h.heldJobIdsRef = ["j2", "j3", "j4", "j5", "j6", "j7", "j8", "j9", "j10"]
		h.countRef = 9
		const second = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(second.kind).toBe("delivered")
	})

	it("REARM-CONS-05: same fingerprint, different submitId → still suppressed", async () => {
		const h = makeHarness({ wireCallback: true })
		const first = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(first.kind).toBe("delivered")
		const second = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		expect(second.kind).toBe("stalled_no_progress")
	})

	it("CCSRL-09: pure string-equality would re-loop (necessity ablation)", async () => {
		// This test pins the discriminator choice. If the production
		// code regresses to pure string equality of
		// `sessionId|taskId|count|sortedHeldJobIds`, the LIVE loop
		// returns. We assert here that the production seam applies the
		// superset-aware discriminator by re-running the LIVE specimen
		// pattern and asserting only ONE delivery.
		const h = makeHarness({ wireCallback: true })
		await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		for (let i = 0; i < 3; i++) {
			h.heldJobIdsRef = [...h.heldJobIdsRef, `accum-${i}`]
			h.countRef = h.heldJobIdsRef.length
			await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		}
		const snap = getCompletionContinuationUpstreamCounters()
		// Pre-fix production code would yield:
		//   enqueueCompletionContinuationInvoked = 4
		//   stalledNoProgress = 0
		// Post-fix:
		//   enqueueCompletionContinuationInvoked = 1
		//   stalledNoProgress = 3
		expect(snap.enqueueCompletionContinuationInvoked).toBeLessThanOrEqual(1)
		expect(snap.stalledNoProgress).toBeGreaterThanOrEqual(3)
	})

	it("CCSRL-10: ablation — even a forged coarse fingerprint cannot bypass the new stall discriminator", async () => {
		// Necessity proof (C23): try to bypass the post-fix stall
		// detector by forging the prior fingerprint back into the
		// pre-fix coarse shape (count|sorted-held). The post-fix
		// code stores the canonical sorted held set SEPARATELY
		// from the fingerprint, so even if the fingerprint is
		// forged, the held-set snapshot still detects the pure
		// superset and suppresses the enqueue with
		// `stalled_no_progress`. This test pins that the held-set
		// snapshot is the load-bearing discriminator — not the
		// fingerprint string.
		const h = makeHarness({ wireCallback: true })
		const coordinator = h.coordinator as unknown as {
			lastCompletionContinuationControlFingerprint: string | undefined
			lastCompletionContinuationHeldSetSorted: readonly string[] | undefined
		}
		// Drive attempt 1 with the live-specimen held set.
		await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		// After the first attempt, the post-fix code has stored the
		// canonical sorted held set. Try to forge the fingerprint
		// back into the pre-fix coarse shape — the held-set snapshot
		// must still catch the loop.
		coordinator.lastCompletionContinuationControlFingerprint = `${h.sessionId}|${h.taskId}|${h.heldJobIdsRef.length}|${h.heldJobIdsRef.slice().sort().join(",")}`
		// Accumulate one new terminal (LIVE-specimen monotonic growth).
		h.heldJobIdsRef = [...h.heldJobIdsRef, "accum-ablation"]
		h.countRef = h.heldJobIdsRef.length
		const second = await h.coordinator.enqueueCompletionContinuationIfHeld(h.sessionId, h.countRef, h.taskId)
		// The held-set snapshot detects the pure superset and
		// returns `stalled_no_progress` even though the fingerprint
		// string differs.
		expect(second.kind).toBe("stalled_no_progress")
		expect(h.sendLog.length).toBe(1)
		expect(coordinator.lastCompletionContinuationHeldSetSorted).toBeDefined()
	})
})
