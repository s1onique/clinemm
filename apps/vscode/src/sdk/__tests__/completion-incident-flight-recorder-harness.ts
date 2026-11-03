/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01
 *
 * Shared test harness for the completion-incident causal flight
 * recorder suites.
 *
 * The harness drives the REAL `SdkSessionEventCoordinator` seam — it
 * is not a re-implementation of the barrier predicates. Every test in
 * the suite therefore observes the production decision chain.
 *
 * The harness is intentionally shaped like
 * `bcb-observation-unavailable-capture.bcapt01.test.ts` so the two
 * suites read the same way.
 */

import type { CoreSessionEvent } from "@cline/core"
import { vi } from "vitest"
import { MessageIdMinter } from "@/sdk/message-id-minter"
import { MessageTranslatorState } from "@/sdk/message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "@/sdk/sdk-session-event-coordinator"
import { TurnStateTracker } from "@/sdk/turn-state-tracker"

export const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

export interface FlightRecorderHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	/** The session id the coordinator currently reports as active. */
	activeSessionId: string
	/** The task id the coordinator currently reports as active. */
	activeTaskId: string
	/** Switch the coordinator to a different active session/task. */
	switchTo: (sessionId: string, taskId: string) => void
	completionCommitCount: () => number
	allCommittedPhases: () => string[]
	allCommittedWriterIds: () => string[]
	finalPhase: () => string
	finalWriterId: () => string
	/** Overrides for the BCB predicate providers. */
	pendingPromptRead: { value: { available: boolean; count?: number } }
	activeNotifyCount: { value: number }
	ownerStillRunning: { value: boolean }
	unconsumedCount: { value: number }
	unconsumedJobIds: { value: readonly string[] }
	liveTools: { value: readonly string[] | undefined }
	/** The Elm authority decision the coordinator will read. */
	elmDecision: { value: { kind: "authorize" } | { kind: "hold"; reason: string } | { kind: "failure"; classification: string } }
	/** The recorded continuation enqueue attempts. */
	enqueueAttempts: { sessionId: string; taskId: string | undefined; epoch: number }[]
}

export function makeFlightRecorderHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): FlightRecorderHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	let activeSessionId = opts.activeSessionId ?? "session-fr01"
	let activeTaskId = opts.activeTaskId ?? "task-fr01"

	let completionCommitCount = 0
	const allCommittedPhases: string[] = []
	const allCommittedWriterIds: string[] = []
	const enqueueAttempts: { sessionId: string; taskId: string | undefined; epoch: number }[] = []

	const pendingPromptRead: { value: { available: boolean; count?: number } } = { value: { available: true, count: 0 } }
	const activeNotifyCount: { value: number } = { value: 0 }
	const ownerStillRunning: { value: boolean } = { value: false }
	const unconsumedCount: { value: number } = { value: 0 }
	const unconsumedJobIds: { value: readonly string[] } = { value: [] }
	const liveTools: { value: readonly string[] | undefined } = {
		value: ["command_status", "read_files", "run_commands", "submit_and_exit"],
	}
	const elmDecision: {
		value: { kind: "authorize" } | { kind: "hold"; reason: string } | { kind: "failure"; classification: string }
	} = { value: { kind: "hold", reason: "test_default_hold" } }

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() } as never,
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			allCommittedPhases.push(phase)
			allCommittedWriterIds.push(String(writerId ?? "unknown-legacy-writer"))
			if (phase === "completed") {
				completionCommitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		getElmCompletionAuthorityDecision: () => elmDecision.value as never,
		flushElmAuthorityForSession: async () => {},
		hasRunningBackgroundJobForOwner: () => ownerStillRunning.value,
		getUnconsumedOwnedTerminalResultCount: () => unconsumedCount.value,
		getUnconsumedOwnedTerminalJobIds: () => unconsumedJobIds.value,
		getPendingPromptCount: () =>
			pendingPromptRead.value.available
				? { available: true as const, count: pendingPromptRead.value.count ?? 0 }
				: { available: false as const },
		getActiveNotifyCount: () => activeNotifyCount.value,
		hasActiveNotify: () => false,
		getLaunchedBackgroundJobIds: () => [],
		liveTools: () => liveTools.value,
		onEnqueueCompletionContinuation: undefined,
		enqueueCompletionContinuation: (async (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			enqueueAttempts.push({
				sessionId: input.sessionId,
				taskId: input.taskId,
				epoch: translatorState.getMinter().epoch,
			})
			return { kind: "delivered" as const }
		}) as never,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		get activeSessionId() {
			return activeSessionId
		},
		get activeTaskId() {
			return activeTaskId
		},
		switchTo: (sessionId: string, taskId: string) => {
			activeSessionId = sessionId
			activeTaskId = taskId
		},
		completionCommitCount: () => completionCommitCount,
		allCommittedPhases: () => allCommittedPhases,
		allCommittedWriterIds: () => allCommittedWriterIds,
		finalPhase: () => tracker.currentPhase,
		finalWriterId: () => allCommittedWriterIds[allCommittedWriterIds.length - 1] ?? "none",
		pendingPromptRead,
		activeNotifyCount,
		ownerStillRunning,
		unconsumedCount,
		unconsumedJobIds,
		liveTools,
		elmDecision,
		enqueueAttempts,
	}
}

/**
 * Drive the C10 completion attempt boundary: the runtime sees
 * `submit_and_exit` and the turn ends.
 */
export async function emitSubmitAndExit(h: FlightRecorderHarness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	const doneEvent = agentEvent(h.activeSessionId, {
		type: "done",
		reason: "completed",
		text: "Task completed.",
		iterations: 1,
	})
	await h.coordinator.handleSessionEvent(doneEvent)
}

/**
 * Drive the re-evaluation boundary directly (the post-run authority
 * re-evaluation trigger).
 */
export async function emitAgentTurnDone(h: FlightRecorderHarness): Promise<void> {
	await h.coordinator.notifyAgentTurnDone(h.activeSessionId)
}

/**
 * Let any fire-and-forget microtasks settle.
 */
export async function flush(): Promise<void> {
	await new Promise<void>((r) => setImmediate(r))
}
