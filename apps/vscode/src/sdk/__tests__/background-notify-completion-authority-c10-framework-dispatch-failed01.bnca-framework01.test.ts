/**
 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 / CORRECTION03
 *
 * BNCA-FRAMEWORK-DISPATCH-FAILED-01: load-bearing GREEN test for the
 * dispatch-FAILED branch of the framework-level C10 completion-commit
 * barrier (HALT_WAKE_DELIVERY_ACK_PROMOTED).
 *
 * The pre-CORRECTION03 defect: ROUND 2 marked
 * `wakeDeliveredJobIds(J) = true` SYNCHRONOUSLY at the callback
 * invocation moment. This conflated REQUESTED with DELIVERED. If
 * the async sdkHost.send then REJECTED, the originating turn had
 * already been SUPPRESSED and NO wake-driven turn would ever fire
 * — semantic terminal completion count dropped to 0.
 *
 * CORRECTION03 distinguishes three states (REQUESTED / DELIVERED /
 * FAILED). When the dispatch FAILED, the C10 barrier ALLOWS the
 * originating turn's completion commit because no wake-driven turn
 * will fire.
 */

import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
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

interface DispatchFailedHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	notifyCoordinator: BackgroundNotifyCoordinator
	manager: CommandJobManager
	activeSessionId: string
	activeTaskId: string
	completionCommitCount: () => number
	rejectPendingDispatch: (error: Error) => void
	resolvePendingDispatch: () => void
	hasPendingDispatch: () => boolean
}

function makeHarness(): DispatchFailedHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "sess-bnca-framework01-dispatch-failed"
	const activeTaskId = "task-bnca-framework01-dispatch-failed"

	let completionCommitCount = 0
	let pendingReject: ((error: Error) => void) | undefined
	let pendingResolve: ((value: { kind: "delivered" }) => void) | undefined

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => {
			return new Promise<{ kind: "delivered" | "rejected" | "session_gone" }>((resolve, reject) => {
				pendingResolve = resolve
				pendingReject = reject
			})
		},
		now: () => Date.now(),
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {},
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
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => false,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: (sessionId: string | undefined, taskId: string | undefined) =>
			notifyCoordinator.activeNotifyCountForOwner(sessionId ?? activeSessionId, taskId ?? activeTaskId),
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
		wasWakeDelivered: (jobId: string) => notifyCoordinator.wasWakeDelivered(jobId),
		wasWakeDispatchRequested: (jobId: string) => notifyCoordinator.wasWakeDispatchRequested(jobId),
		wasWakeDispatchFailed: (jobId: string) => notifyCoordinator.wasWakeDispatchFailed(jobId),
		isWakeAuthoritySettled: (jobId: string) => notifyCoordinator.isWakeAuthoritySettled(jobId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	const manager = new CommandJobManager()

	return {
		coordinator,
		tracker,
		translatorState,
		notifyCoordinator,
		manager,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => completionCommitCount,
		rejectPendingDispatch: (error: Error) => {
			if (!pendingReject) throw new Error("no pending dispatch")
			pendingReject(error)
			pendingReject = undefined
			pendingResolve = undefined
		},
		resolvePendingDispatch: () => {
			if (!pendingResolve) throw new Error("no pending dispatch")
			pendingResolve({ kind: "delivered" })
			pendingResolve = undefined
			pendingReject = undefined
		},
		hasPendingDispatch: () => pendingReject !== undefined || pendingResolve !== undefined,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

async function emitCompletionTurn(
	coordinator: SdkSessionEventCoordinator,
	sessionId: string,
	translatorState: MessageTranslatorState,
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

describe("ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 / CORRECTION03", () => {
	describe("BNCA-FRAMEWORK-DISPATCH-FAILED-01: dispatch-FAILED branch (HALT_WAKE_DELIVERY_ACK_PROMOTED)", () => {
		it("ALLOWS originating completion when wake dispatch fails (no wake-driven turn will fire)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})

			// Spawn a real background job and register the notify marker.
			const start = await h.manager.start({
				command: "/bin/sh -c 'sleep 0.05; exit 0'",
				waitBudgetMs: 5,
				executionDeadlineMs: 30_000,
				cwd: process.cwd(),
			})
			expect(start.state).toBe("running")
			h.notifyCoordinator.registerMarker({
				jobId: start.jobId,
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			h.translatorState.recordLaunchedBackgroundJob(start.jobId)

			// Attach the per-job wake listener. The listener calls
			// consumeTerminal which will (synchronously) invoke the
			// pending-promise enqueueTerminalWake callback (REQUESTED
			// state). The promise stays pending until the test
			// resolves or rejects it.
			start.terminalPromise.then(async () => {
				const status = await h.manager.status({ jobId: start.jobId, waitMs: 0 })
				if (!status.ok) return
				const snapshot = status.snapshot
				h.notifyCoordinator.consumeTerminal({
					jobId: start.jobId,
					terminalState: snapshot.state,
					exitCode: snapshot.exitCode,
					reason: snapshot.signal,
					isContainmentFailed: snapshot.state === "containment_failed",
					outputTail: snapshot.stdout?.slice(-1024),
				})
			})

			// Step 1: first turn_complete (BEFORE terminal fires).
			//   hasActiveNotify(J) -> true => HOLD.
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0) // still held by marker

			// Wait for the terminal event to land.
			await start.terminalPromise
			// Yield for the consumeTerminal microtask
			await new Promise((r) => setTimeout(r, 30))

			// Verify the three-state trackers
			expect(h.notifyCoordinator.wasWakeDispatchRequested(start.jobId)).toBe(true)
			expect(h.notifyCoordinator.wasWakeDelivered(start.jobId)).toBe(false)
			expect(h.notifyCoordinator.wasWakeDispatchFailed(start.jobId)).toBe(false)
			expect(h.hasPendingDispatch()).toBe(true)

			// Step 2: another turn_complete while ack pending.
			//   case 2: wasWakeDispatchRequested + !delivered + !failed => HOLD.
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0) // still held by ack-pending

			// Step 3: dispatch FAILS (transport rejection).
			h.rejectPendingDispatch(new Error("transport connection lost"))
			// Yield for the .then() handler
			await new Promise((r) => setTimeout(r, 30))

			expect(h.notifyCoordinator.wasWakeDispatchFailed(start.jobId)).toBe(true)
			expect(h.notifyCoordinator.wasWakeDelivered(start.jobId)).toBe(false)
			expect(h.notifyCoordinator.wasWakeDispatchRequested(start.jobId)).toBe(false)

			// Step 4: another turn_complete AFTER dispatch-failed.
			//   case 4: wasWakeDispatchFailed => ALLOW.
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(1) // ALLOWED — semantic count for J is 1
		})

		it("does NOT hold originator when dispatch-failed ack resolves BEFORE the second commit attempt", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})

			const start = await h.manager.start({
				command: "/bin/sh -c 'sleep 0.05; exit 0'",
				waitBudgetMs: 5,
				executionDeadlineMs: 30_000,
				cwd: process.cwd(),
			})
			h.notifyCoordinator.registerMarker({
				jobId: start.jobId,
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			h.translatorState.recordLaunchedBackgroundJob(start.jobId)
			start.terminalPromise.then(async () => {
				const status = await h.manager.status({ jobId: start.jobId, waitMs: 0 })
				if (!status.ok) return
				const snapshot = status.snapshot
				h.notifyCoordinator.consumeTerminal({
					jobId: start.jobId,
					terminalState: snapshot.state,
					exitCode: snapshot.exitCode,
					reason: snapshot.signal,
					isContainmentFailed: snapshot.state === "containment_failed",
					outputTail: snapshot.stdout?.slice(-1024),
				})
			})

			await start.terminalPromise
			await new Promise((r) => setTimeout(r, 30))

			// Reject immediately (before any commit attempt).
			h.rejectPendingDispatch(new Error("immediate failure"))
			await new Promise((r) => setTimeout(r, 30))
			expect(h.notifyCoordinator.wasWakeDispatchFailed(start.jobId)).toBe(true)

			// Now the originating turn commits.
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(1)
		})

		it("SUPPRESSES when dispatch DELIVERED (control case — wake-driven turn owns completion)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})

			const start = await h.manager.start({
				command: "/bin/sh -c 'sleep 0.05; exit 0'",
				waitBudgetMs: 5,
				executionDeadlineMs: 30_000,
				cwd: process.cwd(),
			})
			h.notifyCoordinator.registerMarker({
				jobId: start.jobId,
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			h.translatorState.recordLaunchedBackgroundJob(start.jobId)
			start.terminalPromise.then(async () => {
				const status = await h.manager.status({ jobId: start.jobId, waitMs: 0 })
				if (!status.ok) return
				const snapshot = status.snapshot
				h.notifyCoordinator.consumeTerminal({
					jobId: start.jobId,
					terminalState: snapshot.state,
					exitCode: snapshot.exitCode,
					reason: snapshot.signal,
					isContainmentFailed: snapshot.state === "containment_failed",
					outputTail: snapshot.stdout?.slice(-1024),
				})
			})

			await start.terminalPromise
			await new Promise((r) => setTimeout(r, 30))

			// Resolve with delivered
			h.resolvePendingDispatch()
			await new Promise((r) => setTimeout(r, 30))
			expect(h.notifyCoordinator.wasWakeDelivered(start.jobId)).toBe(true)
			expect(h.notifyCoordinator.wasWakeDispatchFailed(start.jobId)).toBe(false)

			// Try to commit — should be SUPPRESSED (case 3)
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0) // SUPPRESSED — wake-driven turn owns
		})
	})
})
