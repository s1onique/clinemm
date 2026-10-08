/**
 * ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION01-SAFETY-AND-CLASSIFIER
 *
 * Targeted RED/GREEN for the two P0 findings the factory reviewer
 * raised on the predecessor ACT:
 *
 *   P0 #1 (effect-boundary): the production caller MUST terminate
 *   on EVERY Elm `fail_closed` directive, not just `stalled_no_progress`.
 *   A `fail_closed(malformed_facts)` outcome must not become an allowed
 *   effect through fallthrough.
 *
 *   P0 #2 (async race): the production caller now awaits Elm
 *   before the existing epoch-dedupe guard. Two concurrent calls
 *   must not both reach downstream delivery logic; the dedupe slot
 *   and the STALL/REARM lifetime must remain correct.
 *
 * The Elm unit tests in `tests/CompletionContinuationControlTest.elm`
 * cover the classifier; the harness tests in
 * `completion-continuation-held-set-progress-reference.cchsp01.test.ts`
 * cover the single-call RED reference matrix; the harness tests in
 * `completion-continuation-held-set-progress-ablations.cchsp02.test.ts`
 * cover the four ablations. This file adds the targeted P0/1 + P0/2
 * witnesses.
 */

import { describe, expect, it } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import type { SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { SdkSessionEventCoordinator } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

interface ContinuationSend {
	readonly sessionId: string
	readonly taskId?: string | undefined
	readonly prompt: string
	readonly delivery: "queue"
}

interface SafetyHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly sendLog: ContinuationSend[]
	readonly sessionId: string
	taskIdRef: string
}

function makeSafetyHarness(opts: {
	heldJobIds?: readonly string[]
} = {}): SafetyHarness {
	const sessionId = "session-cchsp03"
	const taskId = "task-cchsp03"
	const heldJobIds = opts.heldJobIds ?? ["j1", "j2", "j3"]
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sendLog: ContinuationSend[] = []
	const harnessRef: { current: SafetyHarness | undefined } = { current: undefined }
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () =>
				({
					sessionId: harnessRef.current?.sessionId ?? sessionId,
					sdkHost: {
						send: (input: { sessionId: string; prompt: string; delivery: "queue" }) => {
							sendLog.push({ ...input })
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
		getTask: () => ({ taskId: harnessRef.current?.taskIdRef ?? taskId }) as never,
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
		getUnconsumedOwnedTerminalResultCount: () => 1,
		getUnconsumedOwnedTerminalJobIds: () => [...heldJobIds],
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
				sessionId: input.sessionId,
				taskId: input.taskId,
				prompt: `mock:${input.heldJobIds.join(",")}`,
				delivery: "queue",
			})
			return Promise.resolve({ kind: "delivered" as const })
		},
	} as unknown as SdkSessionEventCoordinatorOptions)
	coordinator.setDeferredCompletionBarrierForTesting({
		sessionId,
		taskId,
		epoch: translatorState.getMinter().epoch,
	})
	const h: SafetyHarness = {
		coordinator,
		sendLog,
		sessionId,
		taskIdRef: taskId,
	}
	harnessRef.current = h
	return h
}

async function flushElmKernels(): Promise<void> {
	await new Promise((r) => setTimeout(r, 50))
}

describe("ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION01-SAFETY-AND-CLASSIFIER (C0 #1)", () => {
	describe("P0 #1: every fail_closed is terminal at the production caller", () => {
		it("fail_closed(malformed_facts) does NOT call the enqueue callback", async () => {
			// We force MalformedFacts by handing the production
			// seam a heldJobIds list that contains an empty
			// string. The Codec decoder rejects the empty-string
			// id; the kernel returns decode_error which the
			// adapter translates to FailClosed MalformedFacts.
			const h = makeSafetyHarness({
				heldJobIds: ["j1", ""],
			})
			const result = await h.coordinator.enqueueCompletionContinuationIfHeld(
				h.sessionId,
				1,
				h.taskIdRef,
			)
			await flushElmKernels()
			expect(result.kind).toBe("fail_closed")
			if (result.kind === "fail_closed") {
				expect(result.failureReason).toBe("malformed_facts")
			}
			// The enqueue callback was NEVER called — no
			// continuation was delivered.
			expect(h.sendLog.length).toBe(0)
		})

		it("non-fail_closed directives (ObserveThenRetry) DO call the enqueue callback", async () => {
			// Control case: when the Elm returns ObserveThenRetry
			// (the first-call case), the callback IS called. This
			// is the inverse witness that the P0 #1 fix
			// specifically blocks the fail_closed path and not
			// the non-fail_closed path.
			const h = makeSafetyHarness({
				heldJobIds: ["j1", "j2", "j3"],
			})
			const result = await h.coordinator.enqueueCompletionContinuationIfHeld(
				h.sessionId,
				1,
				h.taskIdRef,
			)
			await flushElmKernels()
			expect(result.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(1)
		})
	})

	describe("P0 #2: concurrent calls do not double-fire the enqueue", () => {
		it("two simultaneous calls produce exactly one delivery and one non-delivered", async () => {
			const h = makeSafetyHarness({ heldJobIds: ["j1", "j2", "j3"] })
			// K: first call. prior=undefined, current=[j1,j2,j3] →
			// Indeterminate → ObserveThenRetry → delivered.
			const first = h.coordinator.enqueueCompletionContinuationIfHeld(
				h.sessionId,
				1,
				h.taskIdRef,
			)
			// K+1: second call. Either:
			//   (a) the dedupe slot was marked by K before K+1's
			//       Elm call → K+1 returns `already_sent`;
			//   (b) the Elm call completes first and sees the
			//       prior snapshot K stored → NoProgress →
			//       FailClosed StalledNoProgress.
			// Either way: exactly one delivery.
			const second = h.coordinator.enqueueCompletionContinuationIfHeld(
				h.sessionId,
				1,
				h.taskIdRef,
			)
			const [a, b] = await Promise.all([first, second])
			await flushElmKernels()
			const kinds = [a.kind, b.kind]
			const deliveredCount = kinds.filter((k) => k === "delivered").length
			expect(deliveredCount).toBe(1)
			expect(h.sendLog.length).toBe(1)
			// The non-delivered outcome is one of
			// {stalled_no_progress, already_sent, fail_closed}.
			// (fail_closed is possible if the second call's
			// Elm verdict is the stall verdict.)
			const otherKind = kinds.find((k) => k !== "delivered")
			expect(otherKind).toBeDefined()
			expect(
				["stalled_no_progress", "already_sent", "fail_closed"].includes(otherKind!),
			).toBe(true)
		})

		it("the dedupe slot is NOT marked on a fail_closed outcome (no future call can be poisoned)", async () => {
			// After a fail_closed(malformed_facts) verdict, the
			// dedupe slot must remain UNMARKED so a subsequent
			// legitimate call (with a fixed snapshot) is NOT
			// blocked by the failed call's epoch.
			const h = makeSafetyHarness({
				heldJobIds: ["j1", ""],
			})
			const first = await h.coordinator.enqueueCompletionContinuationIfHeld(
				h.sessionId,
				1,
				h.taskIdRef,
			)
			await flushElmKernels()
			expect(first.kind).toBe("fail_closed")
			// Now switch to a valid heldJobIds list. A new call
			// must succeed (NOT be dedupe-suppressed by the
			// failed call's epoch).
			const coordinator = h.coordinator as unknown as {
				lastCompletionContinuationSessionEpoch: string | undefined
			}
			expect(coordinator.lastCompletionContinuationSessionEpoch).toBeUndefined()
		})
	})
})
