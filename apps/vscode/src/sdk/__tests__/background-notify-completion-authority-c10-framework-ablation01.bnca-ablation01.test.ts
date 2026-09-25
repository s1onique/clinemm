/**
 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01
 *
 * BNCA-FRAMEWORK-ABLATION-01: load-bearing necessity proof for the
 * C10 framework-level completion-commit barrier.
 *
 * Temporarily neutralize the `wasWakeDelivered` probe at the
 * C10 barrier (by overriding the option on the coordinator) and
 * observe that the live defect re-emerges (the originating turn's
 * `submit_and_exit` commits completion even though the wake was
 * delivered). Then restore and observe the barrier correctly
 * SUPPRESSES the originating turn's completion.
 *
 * This is the bounded proof that the framework-level fix is
 * load-bearing, NOT optional. Without it, the live defect (two
 * `submit_and_exit` completions for one notify-owned job)
 * returns.
 */

import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { createCommandStatusTool } from "../command-status-tool"
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

interface ProductionHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	notifyCoordinator: BackgroundNotifyCoordinator
	manager: CommandJobManager
	activeSessionId: string
	activeTaskId: string
	completionCommitCount: () => number
	overrideWasWakeDelivered: (enabled: boolean) => void
}

function makeHarness(): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "sess-bnca-framework-ablation01"
	const activeTaskId = "task-bnca-framework-ablation01"

	let completionCommitCount = 0
	let wasWakeDeliveredOverride: ((jobId: string) => boolean) | null = null
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => {
			// Wake delivered to PendingPromptsController.
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
		wasWakeDelivered: (jobId: string) => {
			if (wasWakeDeliveredOverride) return wasWakeDeliveredOverride(jobId)
			return notifyCoordinator.wasWakeDelivered(jobId)
		},
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
		overrideWasWakeDelivered: (enabled: boolean) => {
			if (enabled) {
				wasWakeDeliveredOverride = null
			} else {
				wasWakeDeliveredOverride = () => false
			}
		},
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

describe("ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 / BNCA-FRAMEWORK-ABLATION-01", () => {
	it("BNCA-FRAMEWORK-ABLATION-01-GREEN: framework-level fix ON -> originating completion SUPPRESSED (wake-driven turn owns completion)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		const start = await h.manager.start({
			command: "/bin/sh -c 'sleep 1; exit 0'",
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

		// Listener drains the marker and enqueues the wake.
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

		// H1 short-circuit.
		const statusTool = createCommandStatusTool(h.manager, {
			backgroundNotifyCoordinator: h.notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: h.activeSessionId, taskId: h.activeTaskId }),
		})
		await statusTool.execute(
			{ jobId: start.jobId, waitMs: 30_000 },
			{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
		)

		// Wait for wake delivery.
		for (let i = 0; i < 60; i += 1) {
			if (h.manager.activeCount === 0) break
			await new Promise((r) => setTimeout(r, 100))
		}
		for (let i = 0; i < 50; i += 1) {
			if (h.notifyCoordinator.wasWakeDelivered(start.jobId)) break
			await new Promise((r) => setTimeout(r, 50))
		}
		expect(h.notifyCoordinator.wasWakeDelivered(start.jobId)).toBe(true)

		// Originating turn commits completion. Framework SUPPRESSES.
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 30_000)

	it("BNCA-FRAMEWORK-ABLATION-01-RED: framework-level fix OFF (wasWakeDelivered neutered) -> originating completion COMMITS (live defect re-emerges)", async () => {
		const h = makeHarness()
		h.overrideWasWakeDelivered(false) // Simulate "framework fix reverted"
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		const start = await h.manager.start({
			command: "/bin/sh -c 'sleep 1; exit 0'",
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

		const statusTool = createCommandStatusTool(h.manager, {
			backgroundNotifyCoordinator: h.notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: h.activeSessionId, taskId: h.activeTaskId }),
		})
		await statusTool.execute(
			{ jobId: start.jobId, waitMs: 30_000 },
			{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
		)

		for (let i = 0; i < 60; i += 1) {
			if (h.manager.activeCount === 0) break
			await new Promise((r) => setTimeout(r, 100))
		}
		for (let i = 0; i < 50; i += 1) {
			if (h.notifyCoordinator.wasWakeDelivered(start.jobId)) break
			await new Promise((r) => setTimeout(r, 50))
		}

		// Without the framework-level fix, the originating turn
		// commits completion even though the wake was delivered
		// (the live defect: TWO submit_and_exit completions for
		// ONE notify-owned job).
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

		// Live defect re-emerges: completion commits.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 30_000)
})
