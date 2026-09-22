/**
 * ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 / TQCB01
 *
 * RED + GREEN tests for the completion-barrier over notify-enabled
 * background obligations. The defect is that submit_and_exit commits
 * task completion WITHOUT consulting whether completion-relevant
 * autonomous work has been resolved — leading to a duplicate
 * autonomous continuation when a queued wake reaches
 * PendingPromptsController after the task already committed.
 *
 * Production seams exercised:
 *   - BackgroundNotifyCoordinator (real production class)
 *   - SdkSessionEventCoordinator (real production class)
 *   - MessageTranslatorState (real production class)
 *   - TurnStateTracker (real production class)
 *   - MessageIdMinter (real production class)
 */

import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import {
	SdkSessionEventCoordinator,
	type SdkSessionEventCoordinatorOptions,
} from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
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

interface QueuedPrompt {
	readonly sessionId: string
	readonly prompt: string
}

class TestPendingPromptsSink {
	public readonly queued: QueuedPrompt[] = []
	enqueue(input: { sessionId: string; prompt: string }): void {
		this.queued.push({ sessionId: input.sessionId, prompt: input.prompt })
	}
	countForSession(sessionId: string): number {
		return this.queued.filter((q) => q.sessionId === sessionId).length
	}
}

interface ProductionHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	notifyCoordinator: BackgroundNotifyCoordinator
	wakeSink: TestPendingPromptsSink
	activeSessionId: string
	activeTaskId: string
	completionCommitCount: () => number
	registerMarker: (jobId: string) => void
	resolveObligation: (jobId: string) => void
}

interface MakeHarnessOptions {
	activeSessionId?: string
	activeTaskId?: string
}

function makeHarness(opts: MakeHarnessOptions = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-tqcb01"
	const activeTaskId = opts.activeTaskId ?? "task-tqcb01-live"

	const wakeSink = new TestPendingPromptsSink()
	let now = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) => wakeSink.enqueue({ sessionId, prompt }),
		now: () => ++now,
	})

	let completionCommitCount = 0
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
		getPendingPromptCount: (() => 0) as unknown as (sessionId: string | undefined) => number,
		getActiveNotifyCount: ((sessionId?: string, taskId?: string): number =>
			notifyCoordinator.activeNotifyCountForOwner(
				sessionId ?? activeSessionId,
				taskId ?? activeTaskId,
			)) as unknown as (sessionId: string | undefined, taskId: string | undefined) => number,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		notifyCoordinator,
		wakeSink,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => completionCommitCount,
		registerMarker: (jobId: string) => {
			notifyCoordinator.registerMarker({
				jobId,
				sessionId: activeSessionId,
				taskId: activeTaskId,
			})
		},
		resolveObligation: (jobId: string) => {
			notifyCoordinator.resolveObligation({
				jobId,
				sessionId: activeSessionId,
				taskId: activeTaskId,
				resolution: "canonical_status_observed",
			})
		},
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

async function emitCompletionTurn(
	coordinator: SdkSessionEventCoordinator,
	sessionId: string,
	translatorState: MessageTranslatorState,
): Promise<void> {
	// Simulate the completion tool's content_end (the canonical authority
	// source per CRA01-CRA03). This sets both flags on the translator state.
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
describe("TQCB01 — completion barrier over notify-enabled background obligations", () => {
	describe("RED tests — premature completion", () => {
		it("TQCB-RED-01: unresolved running notify=true obligation blocks completion", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			expect(h.tracker.currentPhase).toBe("streaming")

			h.registerMarker("J-red01")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.completionCommitCount()).toBe(0)

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("TQCB-RED-02: direct command_status observation resolves obligation (LIVE bug discriminator)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("J-red02")

			h.resolveObligation("J-red02")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("TQCB-RED-03: two jobs partial resolution holds completion", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("A-red03")
			h.registerMarker("B-red03")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(2)

			h.resolveObligation("A-red03")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.completionCommitCount()).toBe(0)

			h.notifyCoordinator.consumeTerminal({
				jobId: "B-red03",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	describe("Control tests — conservation and edge cases", () => {
		it("TQCB-CTL-01: notify=false does not block (no marker → no barrier)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})

			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("TQCB-CTL-03: terminal wake incorporation (Path A) resolves", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("J-ctl03")

			h.notifyCoordinator.consumeTerminal({
				jobId: "J-ctl03",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)
	})
})
