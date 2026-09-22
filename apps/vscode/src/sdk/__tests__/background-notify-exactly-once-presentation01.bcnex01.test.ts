/**
 * ACT-CLINEMM-BACKGROUND-NOTIFY-EXACTLY-ONCE-PRESENTATION01 / BCNEX01
 *
 * Cardinality-based RED + GREEN discriminator for the
 * "duplicate completion presentation" defect deferred from
 * ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01.
 *
 * Per the ACT §7 classification matrix, the production chain
 * CommandJobManager → BackgroundNotifyCoordinator →
 * PendingPromptsController → AgentRuntime → MessageTranslator is
 * single-writer per jobId at every layer EXCEPT the
 * PRESENTATION seam (DX7_PRESENTATION_DUPLICATED).
 *
 * Specifically, when a background command with
 * `notifyOnCompletion: true` reaches terminal state:
 *
 *   1. BackgroundNotifyCoordinator generates exactly ONE wake
 *      prompt (single-writer — `notificationMarkers.delete` first).
 *   2. The wake is enqueued via PendingPromptsController.enqueue
 *      exactly ONCE.
 *   3. The drain fires runTurn ONCE.
 *   4. The agent produces ONE assistant response.
 *
 * The duplication is at the PRESENTATION seam:
 *
 *   5a. The `pending_prompt_submitted` event carries the wake
 *       prompt text to the message translator. The translator
 *       pushes a `say: "user_feedback"` row with the wake text
 *       (visible to the user).
 *   5b. The agent's assistant response (step 4) is rendered as
 *       a separate visible message.
 *
 * → TWO visible completion messages per ONE logical terminal
 *   event. The wake should be transcript-hidden (like
 *   TASK_RESUMPTION / ACT_MODE_CONTINUATION_PROMPT) — see
 *   `sdk-user-message-mapping.ts:50-66`.
 *
 * LOAD-BEARING ASSERTIONS:
 *   BCNEX-RED-01:
 *     Given a wake prompt (formatTerminalWakePrompt output),
 *     translateSessionEvent must NOT emit a user_feedback row.
 *     (Pre-fix: emits a user_feedback row containing the wake
 *     text — RED.)
 *
 *   BCNEX-ABLATION-01:
 *     With the wake prompt recognized as a synthetic prompt,
 *     translateSessionEvent emits zero messages (matches the
 *     TASK_RESUMPTION behavior at message-translator.test.ts:232).
 *
 *   BCNEX-CTL-01..15: see 07-conservation.txt
 */

import type { CoreSessionEvent, SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, formatTerminalWakePrompt } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn() },
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

let supervisorPid = 70000
function fakeSupervisor(): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: ++supervisorPid,
		pgid: supervisorPid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "started\nfinished\n", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
}

class TestPendingPromptQueue {
	private readonly items: { id: string; sessionId: string; prompt: string }[] = []
	enqueue(input: { sessionId: string; prompt: string }): string {
		const id = `pp-${this.items.length + 1}`
		this.items.push({ id, ...input })
		return id
	}
	countForSession(sessionId: string): number {
		return this.items.filter((q) => q.sessionId === sessionId).length
	}
}

function makeSdkHost(queue: TestPendingPromptQueue) {
	return {
		pendingPrompts: (action: string, input: { sessionId: string } | undefined) => {
			if (action === "count") {
				return { available: true, count: queue.countForSession(input?.sessionId ?? "") }
			}
			throw new Error(`Unhandled pendingPrompts action: ${action}`)
		},
	}
}

interface Harness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	notifyCoordinator: BackgroundNotifyCoordinator
	queue: TestPendingPromptQueue
	activeSessionId: string
	activeTaskId: string
}

function makeHarness(): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-bcnex01"
	const activeTaskId = "task-bcnex01"

	const supervisor = fakeSupervisor()
	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: () => supervisor,
	})

	const queue = new TestPendingPromptQueue()
	const sdkHost = makeSdkHost(queue)

	let now = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) => {
			queue.enqueue({ sessionId, prompt })
		},
		now: () => ++now,
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost,
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
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => manager.hasRunningBackgroundJobForOwner(activeSessionId),
		getPendingPromptCount: (ownerSessionId: string | undefined) =>
			sdkHost.pendingPrompts("count", { sessionId: ownerSessionId ?? "" }).count,
		getActiveNotifyCount: () => notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId),
	} as never)

	return { coordinator, tracker, translatorState, manager, notifyCoordinator, queue, activeSessionId, activeTaskId }
}

describe("ACT-CLINEMM-BACKGROUND-NOTIFY-EXACTLY-ONCE-PRESENTATION01 / BCNEX01", () => {
	describe("BCNEX-RED-01: wake prompt MUST be transcript-hidden", () => {
		it("pending_prompt_submitted carrying a terminal wake prompt produces ZERO user_feedback rows", () => {
			// The wake prompt format is the EXACT shape produced by
			// `formatTerminalWakePrompt` in production
			// (`background-notify-coordinator.ts:107-148`). It starts
			// with the bounded-output delimiters as a unique
			// fingerprint.
			const wakePrompt = formatTerminalWakePrompt({
				jobId: "J-test",
				terminalState: "exited",
				reason: "natural",
				exitCode: 0,
				outputTail: "started\nfinished\n",
			})

			// Sanity: the wake prompt IS the synthetic format
			// (bounded-output delimiters always present).
			expect(wakePrompt).toContain("<bounded-output>")
			expect(wakePrompt).toContain("</bounded-output>")

			// The `pending_prompt_submitted` event is the EXACT shape
			// the message translator receives when the wake drains
			// from the pending-prompt queue (`message-translator.ts:2303-2332`).
			const state = new MessageTranslatorState()
			const event: CoreSessionEvent = {
				type: "pending_prompt_submitted",
				payload: {
					sessionId: "session-bcnex01",
					id: "pp-1",
					prompt: wakePrompt,
					delivery: "queue",
					attachmentCount: 0,
				},
			}

			const result = translateSessionEvent(event, state)

			// RED ASSERTION (pre-fix): the wake prompt leaks as a
			// user_feedback row → exactly-one-job / two-visible-messages.
			// The wake MUST be filtered (matches TASK_RESUMPTION /
			// ACT_MODE_CONTINUATION_PROMPT synthetic-prompt semantics).
			const userFeedbackRows = result.messages.filter((m) => m.say === "user_feedback")
			expect(userFeedbackRows).toEqual([])
		})

		it("synthetic resumption prompts remain filtered (conservation — TASK_RESUMPTION precedent)", () => {
			// The TASK_RESUMPTION prompt IS filtered today. This
			// test pins the existing behavior so the BCNEX repair
			// does not regress it.
			const state = new MessageTranslatorState()
			const event: CoreSessionEvent = {
				type: "pending_prompt_submitted",
				payload: {
					sessionId: "session-bcnex01",
					id: "pp-1",
					prompt: "[TASK RESUMPTION] Please continue where you left off.",
					delivery: "queue",
					attachmentCount: 0,
				},
			}

			const result = translateSessionEvent(event, state)

			const userFeedbackRows = result.messages.filter((m) => m.say === "user_feedback")
			expect(userFeedbackRows).toEqual([])
		})
	})

	describe("BCNEX-ABLATION-01: synthetic-prompt predicate eliminates the wake row", () => {
		it("with isSyntheticUserPrompt recognizing the bounded-output wake, no user_feedback row is emitted", () => {
			const wakePrompt = formatTerminalWakePrompt({
				jobId: "J-abl",
				terminalState: "exited",
				reason: "natural",
				exitCode: 0,
				outputTail: "started\n",
			})

			const state = new MessageTranslatorState()
			const event: CoreSessionEvent = {
				type: "pending_prompt_submitted",
				payload: {
					sessionId: "session-bcnex01",
					id: "pp-1",
					prompt: wakePrompt,
					delivery: "queue",
					attachmentCount: 0,
				},
			}

			// Post-fix: synthetic prompt predicate filters the
			// wake, so the translator produces zero rows.
			const result = translateSessionEvent(event, state)
			expect(result.messages).toEqual([])
		})
	})
})
