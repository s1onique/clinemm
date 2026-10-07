/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-REARM01 — REARM01
 *
 * LIVE defect (task/session 1791358295080_gno3g):
 *
 *   submit_and_exit_seen → held=true → continuation K scheduled
 *   → delivered → started → submit_and_exit_seen → held=true (terminals
 *   STILL present from K) → enqueueCompletionContinuationIfHeld
 *   called from the K submit_and_exit handler → dedupeSuppressed
 *   (because lastCompletionContinuationSessionEpoch already pinned
 *   to "S|T|E" by K) → NO K+1 successor scheduled → agent_turn_done
 *   of K → reevaluateDeferredCompletionBarrier → count still > 0
 *   → enqueueCompletionContinuationIfHeld invoked AGAIN → STILL
 *   deduped → lost re-arm → no task_completion_committed.
 *
 * C0/C1/C2 RECON has identified the EXACT boundary:
 *
 *   apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1234-1240
 *     if (this.lastCompletionContinuationSessionEpoch ===
 *         continuationSessionEpoch) {
 *       recordDedupeSuppressed()
 *       return Promise.resolve({ kind: "already_sent", ... })
 *     }
 *
 *   The dedupe key is `${activeSessionId}|${taskId ?? "(none)"}|${epoch}`.
 *   The minter's `epoch` only advances on task boundaries (clear / history
 *   open / reinit / cancel — see apps/vscode/src/sdk/message-id-minter.ts:65),
 *   NOT on agent_turn_done, so continuation K and the SUCCESSOR
 *   continuation K+1 (fired from K's submit_and_exit → barrier re-register
 *   → enqueueCompletionContinuationIfHeld) share the SAME dedupe key.
 *
 * Frozen LIVE cardinality from the specimen dump (UTC):
 *   task_started=2, submit_and_exit_seen=4, agent_turn_done=4,
 *   task_completion_committed=1   ← the second task never committed.
 *
 * Test plan (RED → ABLATION → REPAIR):
 *
 *   REARM-01: K scheduled by terminal-idle, K reaches submit_and_exit
 *             with held=3, K's submit_and_exit handler →
 *             enqueueCompletionContinuationIfHeld → currently
 *             dedupeSuppressed; K+1 successor MUST be enqueued
 *             exactly once. (LIVE defect.)
 *
 *   REARM-02: K's agent_turn_done fires → reevaluateDeferredCompletionBarrier
 *             with held=3 → must NOT lose the re-arm obligation (a
 *             subsequent submit_and_exit_seen must still be able to
 *             re-arm K+1).
 *
 *   REARM-05: held count transitions 3→1→0 between K's submit_and_exit
 *             and K's agent_turn_done → final state may commit
 *             task_completion_committed exactly once (no K+1 if
 *             held drained to 0).
 *
 *   REARM-12: K → K+1 → K+2 chain eventually drains; exactly one
 *             task_completion_committed event fires.
 *
 *   REARM-AB-01: ablation — if we neutralise the dedupe ownership
 *             condition (lastCompletionContinuationSessionEpoch), the
 *             successor IS enqueued in the same scenario, proving
 *             the dedupe lifetime is the discriminating cause.
 *
 * Conservation (no regression of existing semantics):
 *
 *   REARM-CONS-01: same-session, same-task, same-epoch, two
 *                    enqueueCompletionContinuationIfHeld calls within
 *                    ONE submit_and_exit (the LIVE "duplicate
 *                    requests while K is running" case) → exactly
 *                    ONE invocation of the underlying callback.
 *
 *   REARM-CONS-04: cross-session/task/epoch trip: epoch supersession
 *                    (forced via coordinator.bumpEpochForTesting)
 *                    releases the dedupe; subsequent fires are
 *                    permitted.
 */

import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
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

interface ContinuationSend {
	readonly sessionId: string
	readonly taskId?: string | undefined
	readonly prompt: string
	readonly delivery: "queue"
	readonly jobId?: string
}

interface ProductionHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	notifyCoordinator: BackgroundNotifyCoordinator
	activeSessionId: string
	activeTaskId: string
	sendLog: ContinuationSend[]
	completionCommitCount: () => number
	ownedJobs: { jobId: string; notify: boolean }[]
	unconsumedOverride: { value: number }
	bumpEpoch: () => number
	getEpoch: () => number
	clearCompletionContinuationSentForTesting: () => void
}

function makeHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-rearm01"
	const activeTaskId = opts.activeTaskId ?? "task-rearm01"

	const sendLog: ContinuationSend[] = []
	let now = 0
	const ownedJobs: { jobId: string; notify: boolean }[] = []

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "rejected" as const }),
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => ++now,
	})

	const unconsumedOverride: { value: number } = { value: 0 }

	let completionCommitCount = 0
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {
					send: (input: { sessionId: string; prompt: string; delivery: "queue"; jobId?: string }) => {
						sendLog.push({ ...input })
						return Promise.resolve()
					},
				},
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		pendingPromptsController: {
			enqueue: () => ({ id: "fake" }),
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		},
		pendingPromptAuthorityAvailable: true,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasRunningBackgroundJobForOwner: () => ownedJobs.length > 0,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return unconsumedOverride.value > 0
				? unconsumedOverride.value
				: notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, activeTaskId)
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) => {
			if (sid !== activeSessionId) return []
			return notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, tid)
		},
		hasActiveNotify: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getLaunchedBackgroundJobIds: () => ownedJobs.map((j) => j.jobId),
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			if (input.heldJobIds.length === 0) {
				return Promise.resolve({ kind: "no_held_job_ids" as const })
			}
			sendLog.push({
				sessionId: input.sessionId,
				taskId: input.taskId,
				prompt: `COALESCED continuation for jobIds=${input.heldJobIds.join(",")}`,
				delivery: "queue",
			})
			return Promise.resolve({ kind: "delivered" as const })
		},
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		notifyCoordinator,
		activeSessionId,
		activeTaskId,
		sendLog,
		completionCommitCount: () => completionCommitCount,
		ownedJobs: ownedJobs as { jobId: string; notify: boolean }[],
		unconsumedOverride,
		bumpEpoch: () => minter.bumpEpoch(),
		getEpoch: () => minter.epoch,
		clearCompletionContinuationSentForTesting: () => coordinator.clearCompletionContinuationSentForTesting(),
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as CoreSessionEvent

/**
 * Drive submit_and_exit through the REAL production seam
 * (handleSessionEvent with a `done` agent_event with
 * `wasTerminalResponseCommittedThisTurn === true`). This is the
 * load-bearing "submit_and_exit_seen" producer — NOT a direct
 * method call. The dedupe lives in this seam.
 */
async function emitSubmitAndExit(
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
}

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

/**
 * REARM-01 — RED: K reaches submit_and_exit with held=3; the
 * `enqueueCompletionContinuationIfHeld` invoked from the
 * `submit_and_exit_seen` handler is currently dedupeSuppressed
 * because lastCompletionContinuationSessionEpoch is already pinned
 * from K's original send. K+1 must be enqueued exactly once.
 */
describe("REARM-01 — K's own submit_and_exit with held>0 must enqueue K+1 exactly once", () => {
	it("fires K+1 even though dedupe keys collide (LIVE chronology)", async () => {
		const h = makeHarness()
		h.ownedJobs.push({ jobId: "J1", notify: false })
		h.ownedJobs.push({ jobId: "J2", notify: false })
		h.ownedJobs.push({ jobId: "J3", notify: false })
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		expect(h.sendLog.length).toBe(0)
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J2",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J3",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.ownedJobs.length = 0
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(1)
		expect(h.sendLog[0].prompt).toContain("J1")
		expect(h.sendLog[0].prompt).toContain("J2")
		expect(h.sendLog[0].prompt).toContain("J3")
		// LIVE BUG: K's submit_and_exit with held=3 must enqueue K+1.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(2)
		expect(h.sendLog[1].prompt).toContain("J1")
		expect(h.sendLog[1].prompt).toContain("J2")
		expect(h.sendLog[1].prompt).toContain("J3")
	})
})

/**
 * REARM-02 — RED: K's agent_turn_done must NOT lose the re-arm
 * obligation. K's eventual submit_and_exit must still be able to
 * fire K+1.
 */
describe("REARM-02 — K's agent_turn_done must preserve the re-arm obligation", () => {
	it("after K's agent_turn_done the dedupe marker is no longer blocking K+1", async () => {
		const h = makeHarness()
		h.ownedJobs.push({ jobId: "J1", notify: false })
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.ownedJobs.length = 0
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(1)
		await h.coordinator.notifyAgentTurnDone(h.activeSessionId)
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(1)
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(2)
		expect(h.sendLog[1].prompt).toContain("J1")
	})
})

/**
 * REARM-05 — held drains to 0 between K's submit_and_exit and
 * reevaluate → no K+1 fires.
 */
describe("REARM-05 — held drains to 0 → no K+1", () => {
	it("K emits submit_and_exit with held=0 (drained); no successor fires", async () => {
		const h = makeHarness()
		h.ownedJobs.push({ jobId: "J1", notify: false })
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.ownedJobs.length = 0
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(1)
		h.notifyCoordinator.consumeNonNotifyTerminalObservation({
			jobId: "J1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(1)
	})
})

/**
 * REARM-12 — K → K+1 → K+2 chain eventually drains.
 */
describe("REARM-12 — full chain K → K+1 → K+2 eventually drains", () => {
	it("3-turn chain with held draining → 3 continuations, no K+3", async () => {
		const h = makeHarness()
		h.ownedJobs.push({ jobId: "J1", notify: false })
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.ownedJobs.length = 0
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(1)
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(2)
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(3)
		h.notifyCoordinator.consumeNonNotifyTerminalObservation({
			jobId: "J1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(3)
	})
})

/**
 * REARM-AB-01 — ABLATION: same scenario as REARM-01 but with
 * the dedupe ownership condition neutralised. K+1 IS enqueued,
 * proving the dedupe lifetime is the discriminating cause.
 */
describe("REARM-AB-01 — ablation: neutralise the dedupe ownership → K+1 IS enqueued", () => {
	it("clearing lastCompletionContinuationSessionEpoch lets K+1 through", async () => {
		const h = makeHarness()
		h.ownedJobs.push({ jobId: "J1", notify: false })
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.ownedJobs.length = 0
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(1)
		h.clearCompletionContinuationSentForTesting()
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(2)
		expect(h.sendLog[1].prompt).toContain("J1")
	})
})

/**
 * REARM-CONS-01 — conservation: dedupe duplicate work within the
 * SAME submit_and_exit must still coalesce to one callback.
 */
describe("REARM-CONS-01 — same-epoch dedupe within a single submit_and_exit is preserved", () => {
	it("two same-epoch enqueue calls within one K run → only one callback fires", async () => {
		const h = makeHarness()
		h.ownedJobs.push({ jobId: "J1", notify: false })
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.ownedJobs.length = 0
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(1)
		const beforeCount = h.sendLog.length
		const first = await h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 1, h.activeTaskId)
		const second = await h.coordinator.enqueueCompletionContinuationIfHeld(h.activeSessionId, 1, h.activeTaskId)
		// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION01-STRUCTURAL-BOUNDARY:
		// Production stall fingerprint fires BEFORE the epoch
		// dedupe for tighter same-state detection. Both
		// branches agree "no second callback"; the label is
		// "stalled_no_progress" because the heldJobIds +
		// sessionId + taskId + count are bit-identical to the
		// prior enqueue.
		expect(first.kind).toBe("stalled_no_progress")
		expect(second.kind).toBe("stalled_no_progress")
		expect(h.sendLog.length).toBe(beforeCount)
	})
})

/**
 * REARM-CONS-04 — epoch supersession still works after the repair.
 */
describe("REARM-CONS-04 — epoch supersession still clears the dedupe", () => {
	it("bumping the epoch releases the dedupe and lets the next enqueue proceed", async () => {
		const h = makeHarness()
		h.ownedJobs.push({ jobId: "J1", notify: false })
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.ownedJobs.length = 0
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setImmediate(r))
		expect(h.sendLog.length).toBe(1)
		h.bumpEpoch()
		const newE = h.getEpoch()
		expect(h.coordinator.wasCompletionContinuationSentForTesting(h.activeSessionId, h.activeTaskId, newE)).toBe(false)
	})
})
