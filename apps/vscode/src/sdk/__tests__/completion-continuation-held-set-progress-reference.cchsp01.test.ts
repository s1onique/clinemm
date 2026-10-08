/**
 * ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C4) — RED REFERENCE MATRIX
 *
 * Exercising the REAL production TS classifier (the predecessor
 * `isStrictSupersetOf` + the inlined `priorSortedHeld === [j1..j7]`
 * comparison) against the Elm kernel's `classifyHeldSetProgress`
 * decision. The reference matrix is the live STALLED-REARM-LOOP01
 * defect (4 × submit_and_exit with monotone held accumulation
 * under no observation capability) plus the candidate held-set
 * transition domain from ACT §C2.
 *
 * The TS reference is REPRODUCED here (without depending on the
 * production source — we exercise the algorithm directly so the
 * test is migration-stable). After the migration, the production
 * source no longer contains the inlined classifier; the test stays
 * valid because it asserts the closed-domain semantic contract,
 * not a particular source location.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
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
	readonly jobId?: string
}

interface HchspHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly sendLog: ContinuationSend[]
	readonly sessionId: string
	readonly taskId: string
	heldJobIdsRef: string[]
	countRef: number
}

function makeHchspHarness(opts: { heldJobIds?: readonly string[] } = {}): HchspHarness {
	const sessionId = "session-cchsp01"
	const taskId = "task-cchsp01"
	const heldJobIds = opts.heldJobIds ?? ["j1", "j2", "j3"]
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sendLog: ContinuationSend[] = []
	const harnessRef: { current: HchspHarness | undefined } = { current: undefined }
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () =>
				({
					sessionId: harnessRef.current?.sessionId ?? sessionId,
					sdkHost: {
						send: (input: { sessionId: string; prompt: string; delivery: "queue"; jobId?: string }) => {
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
	const h: HchspHarness = {
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

async function flushElmKernels(): Promise<void> {
	// ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C5 / C7):
	// the production seam now awaits BOTH Elm kernels
	// (Completion Authority + Continuation Control) before
	// deciding the outcome. The kernels are `Platform.worker`
	// and use `setTimeout(0)` for the outbound port. Drain the
	// timer queue so the synchronous-looking assertions below
	// see the post-Elm state.
	await new Promise((r) => setTimeout(r, 50))
}

async function callEnqueueIfHeld(h: HchspHarness): Promise<{ kind: string }> {
	const result = await h.coordinator.enqueueCompletionContinuationIfHeld(
		h.sessionId,
		h.countRef,
		h.taskId,
	)
	await flushElmKernels()
	return result
}

describe("ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 (C4) — RED REFERENCE MATRIX", () => {
	beforeEach(() => {
		// Default no-op; tests may override per-case.
	})

	afterEach(() => {
		// Reset per-test fixtures. The coordinator's dedupe marker
		// is at-most-one per instance; we create a fresh harness
		// per test so the marker does not leak.
	})

	describe("C4-01: identical held set (NoProgress) → TS stalls", () => {
		it("emits stalled_no_progress when next set is identical to prior", async () => {
			const h = makeHchspHarness({ heldJobIds: ["j1", "j2", "j3"] })
			const first = await callEnqueueIfHeld(h)
			expect(first.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(1)
			const second = await callEnqueueIfHeld(h)
			expect(second.kind).toBe("stalled_no_progress")
			expect(h.sendLog.length).toBe(1)
		})
	})

	describe("C4-02: strict superset (PassiveAccumulation) → TS stalls (LIVE defect)", () => {
		it("emits stalled_no_progress under monotone held accumulation", async () => {
			const h = makeHchspHarness({ heldJobIds: ["j1", "j2", "j3"] })
			const first = await callEnqueueIfHeld(h)
			expect(first.kind).toBe("delivered")
			// K+1: pure superset (passive accumulation; the model
			// did not consume anything). This is the live
			// STALLED-REARM-LOOP01 defect shape.
			h.heldJobIdsRef = ["j1", "j2", "j3", "j4"]
			h.countRef = 4
			const second = await callEnqueueIfHeld(h)
			expect(second.kind).toBe("stalled_no_progress")
			expect(h.sendLog.length).toBe(1)
		})
	})

	describe("C4-03: real progress (contraction) → TS releases REARM, delivers K+1", () => {
		it("emits delivered when held set contracts (model observed J1)", async () => {
			const h = makeHchspHarness({ heldJobIds: ["j1", "j2", "j3"] })
			const first = await callEnqueueIfHeld(h)
			expect(first.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(1)
			h.heldJobIdsRef = ["j2", "j3"]
			h.countRef = 2
			const second = await callEnqueueIfHeld(h)
			expect(second.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(2)
		})
	})

	describe("C4-04: membership shift → TS releases REARM, delivers K+1", () => {
		it("emits delivered when held set shifts (J1 cleared, J4 arrived)", async () => {
			const h = makeHchspHarness({ heldJobIds: ["j1", "j2"] })
			const first = await callEnqueueIfHeld(h)
			expect(first.kind).toBe("delivered")
			h.heldJobIdsRef = ["j2", "j4"]
			h.countRef = 2
			const second = await callEnqueueIfHeld(h)
			expect(second.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(2)
		})
	})

	describe("C4-05: empty held set (no obligations) → TS not_held", () => {
		it("returns not_held when the held count is 0", async () => {
			const h = makeHchspHarness({ heldJobIds: [] })
			h.countRef = 0
			const result = await callEnqueueIfHeld(h)
			expect(result.kind).toBe("not_held")
		})
	})

	describe("C4-06: empty prior + non-empty current (first call) → TS delivers", () => {
		it("returns delivered on the first call (no prior snapshot)", async () => {
			const h = makeHchspHarness({ heldJobIds: ["j1", "j2"] })
			const result = await callEnqueueIfHeld(h)
			expect(result.kind).toBe("delivered")
			expect(h.sendLog.length).toBe(1)
		})
	})

	describe("C4-07: empty prior + empty current (first call, no held) → TS not_held", () => {
		it("returns not_held on the first call when nothing is held", async () => {
			const h = makeHchspHarness({ heldJobIds: [] })
			const result = await callEnqueueIfHeld(h)
			expect(result.kind).toBe("not_held")
		})
	})

	describe("C4-08: all cleared (contraction to empty) → TS delivers (no held obligation)", () => {
		it("returns not_held when the held set empties between K and K+1", async () => {
			const h = makeHchspHarness({ heldJobIds: ["j1", "j2"] })
			const first = await callEnqueueIfHeld(h)
			expect(first.kind).toBe("delivered")
			h.heldJobIdsRef = []
			h.countRef = 0
			const second = await callEnqueueIfHeld(h)
			expect(second.kind).toBe("not_held")
		})
	})

	describe("C4-09: order permutation (canonical set equality) → TS stalls", () => {
		it("returns stalled_no_progress when the only difference is job order", async () => {
			const h = makeHchspHarness({ heldJobIds: ["j1", "j2", "j3"] })
			const first = await callEnqueueIfHeld(h)
			expect(first.kind).toBe("delivered")
			// Same canonical set, permuted. The kernel's
			// classifyHeldSetProgress operates on sorted lists
			// (host pre-sorts); the structural equality holds.
			h.heldJobIdsRef = ["j3", "j1", "j2"]
			h.countRef = 3
			const second = await callEnqueueIfHeld(h)
			expect(second.kind).toBe("stalled_no_progress")
			expect(h.sendLog.length).toBe(1)
		})
	})

	describe("C4-10: duplicate ids in current (multiset equality) → TS stalls", () => {
		it("returns stalled_no_progress when the multiset is unchanged", async () => {
			const h = makeHchspHarness({ heldJobIds: ["j1", "j1"] })
			const first = await callEnqueueIfHeld(h)
			expect(first.kind).toBe("delivered")
			// Same multiset (still [j1, j1]). The kernel's
			// walk treats the list as a sorted multiset.
			h.heldJobIdsRef = ["j1", "j1"]
			h.countRef = 2
			const second = await callEnqueueIfHeld(h)
			expect(second.kind).toBe("stalled_no_progress")
		})
	})
})
