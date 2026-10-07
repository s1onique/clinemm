// ============================================================================
// ACT-CLINEMM-ELMIZE-P0-TASK-HEADER-TERMINAL-CONVERGENCE01
//
// LIVE-FAILURE-FROZEN RED suite. The LIVE specimen (taskId
// 1791353462887_gwhde) shows a final completion committed and displayed,
// `TurnStateTracker` subsequently committing `completed / 5517` via
// writerId `session-event-turn-complete-completed`, but no webview
// publication carrying the new seq. The TaskHeader stays on
// `streaming / legacy / 5426` because the webview's `applyTurnState`
// gate (highest-seq wins) never receives a publication whose
// `turnState.seq >= 5517`.
//
// RED invariant (ACT §C7):
//   terminalCommit.seq = X
//     ⇒
//   exists subsequent publication P
//     where P's `turnState.seq` >= X
// ============================================================================

import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { type ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { StatePostDebouncer } from "../state-post-debouncer"
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

interface TerminalConvergenceHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly tracker: TurnStateTracker
	readonly translatorState: MessageTranslatorState
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly postTerminalCallCount: () => number
	readonly terminalCommitSeq: () => number
	readonly postTerminalPublishedSeqs: () => readonly number[]
	readonly callOrder: () => readonly string[]
}

interface MakeTerminalConvergenceOpts {
	readonly getElmCompletionAuthorityDecision?: () => ElmCompletionAuthorityDecision
}

function makeTerminalConvergenceHarness(opts: MakeTerminalConvergenceOpts = {}): TerminalConvergenceHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-tc-01"
	const activeTaskId = "task-tc-01"

	const wakeSinkQueue: Array<{ sessionId: string; prompt: string }> = []
	let nowCounter = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) =>
			Promise.resolve(
				(async () => {
					wakeSinkQueue.push({ sessionId, prompt })
					return { kind: "delivered" as const }
				})(),
			),
		discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
		now: () => ++nowCounter,
	})

	const callOrder: string[] = []
	const postTerminalPublishedSeqs: number[] = []
	let postTerminalCallCount = 0
	let terminalCommitSeq = 0

	const setTurnPhaseImpl = (phase: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>>[0]) => {
		if (phase === "completed") {
			tracker.setWithWriter(phase, undefined, {
				writerId: "session-event-turn-complete-completed" as never,
			})
			terminalCommitSeq = tracker.get().seq
			callOrder.push(`setTurnPhase:completed:${terminalCommitSeq}`)
		} else {
			tracker.setWithWriter(phase, undefined, {
				writerId: "test-other-writer" as never,
			})
			callOrder.push(`setTurnPhase:${phase}:${tracker.get().seq}`)
		}
	}

	const postStateToWebviewImpl = async () => {
		postTerminalCallCount += 1
		const snapshotSeq = tracker.get().seq
		postTerminalPublishedSeqs.push(snapshotSeq)
		callOrder.push(`postStateToWebview:${snapshotSeq}`)
	}

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId } as never,
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: ((_msgs: unknown[]) => {}) as never as never,
		},
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: postStateToWebviewImpl,
		setTurnPhase: setTurnPhaseImpl as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: () => 0,
		getUnconsumedOwnedTerminalJobIds: () => [],
		getPendingPromptCount: () => ({ available: true, count: 0 }) as PendingPromptCountRead,
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: () => Promise.resolve({ kind: "no_held_job_ids" }),
		getElmCompletionAuthorityDecision: opts.getElmCompletionAuthorityDecision,
	} as unknown as SdkSessionEventCoordinatorOptions)

	void notifyCoordinator

	return {
		coordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		postTerminalCallCount: () => postTerminalCallCount,
		terminalCommitSeq: () => terminalCommitSeq,
		postTerminalPublishedSeqs: () => postTerminalPublishedSeqs,
		callOrder: () => callOrder,
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

describe("ACT-CLINEMM-ELMIZE-P0-TASK-HEADER-TERMINAL-CONVERGENCE01", () => {
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

	describe("RED — TERMINAL-PUB-01: post-C10 publication must carry the terminal seq", () => {
		it("TERMINAL-PUB-01-A: Elm AUTHORIZE — at least one postStateToWebview fires after the C10 commit, and its snapshot seq is >= the C10 commit seq", async () => {
			const h = makeTerminalConvergenceHarness({
				getElmCompletionAuthorityDecision: () => ({
					kind: "authorize",
					reason: "test_live_authorize_5517",
				}),
			})

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			const commitSeq = h.terminalCommitSeq()
			expect(commitSeq).toBeGreaterThan(0)

			const postPubs = h.postTerminalPublishedSeqs()
			expect(postPubs.length).toBeGreaterThan(0)
			for (const pubSeq of postPubs) {
				expect(pubSeq).toBeGreaterThanOrEqual(commitSeq)
			}

			const order = h.callOrder()
			const completedIdx = order.findIndex((s) => s.startsWith("setTurnPhase:completed:"))
			const postPubIdx = order.findIndex((s) => s.startsWith("postStateToWebview:"))
			expect(completedIdx).toBeGreaterThanOrEqual(0)
			expect(postPubIdx).toBeGreaterThanOrEqual(0)
			expect(completedIdx).toBeLessThan(postPubIdx)
		})
	})

	describe("RED — TERMINAL-PUB-02: Elm HOLD does not require a committed-phase publication", () => {
		it("TERMINAL-PUB-02: Elm HOLD — no C10 commit, no completed-phase publication is required", async () => {
			const h = makeTerminalConvergenceHarness({
				getElmCompletionAuthorityDecision: () => ({
					kind: "hold",
					reason: "test_hold_no_pub_required",
					holdReasons: ["test_hold_no_pub_required"],
				}),
			})

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			const order = h.callOrder()
			expect(order.some((s) => s.startsWith("setTurnPhase:completed:"))).toBe(false)
		})
	})

	describe("RED — TERMINAL-PUB-03: with the REAL debouncer, the post-C10 flush snapshot is committed", () => {
		it("TERMINAL-PUB-03: after the 50ms debounce flush, the published snapshot carries the post-C10 seq (REAL debouncer path)", async () => {
			// The production `postStateToWebview` is debounced 50ms via
			// `StatePostDebouncer`. The C10 commit may complete BEFORE
			// the debounce window fires, in which case the flush MUST
			// observe the post-C10 tracker snapshot, not the
			// pre-C10 one. This test exercises the REAL debouncer
			// (not a synchronous mock) to verify the production
			// wiring carries the post-C10 state through the flush.
			const minter = new MessageIdMinter()
			const tracker = new TurnStateTracker(minter)
			const translatorState = new MessageTranslatorState(minter)
			const activeSessionId = "session-tc-03"
			const activeTaskId = "task-tc-03"

			const wakeSinkQueue: Array<{ sessionId: string; prompt: string }> = []
			let nowCounter = 0
			const notifyCoordinator = new BackgroundNotifyCoordinator({
				resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
				enqueueTerminalWake: ({ sessionId, prompt }) =>
					Promise.resolve(
						(async () => {
							wakeSinkQueue.push({ sessionId, prompt })
							return { kind: "delivered" as const }
						})(),
					),
				discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
				now: () => ++nowCounter,
			})

			const publishedSnapshots: number[] = []

			const flush = async () => {
				publishedSnapshots.push(tracker.get().seq)
			}

			const debouncer = new StatePostDebouncer({ debounceMs: 5, flush })

			const coordinator = new SdkSessionEventCoordinator({
				messageTranslatorState: translatorState,
				sessions: {
					getActiveSession: () => ({
						sessionId: activeSessionId,
						sdkHost: {} as never,
						unsubscribe: vi.fn(),
						startResult: { sessionId: activeSessionId } as never,
						isRunning: false,
					}),
					setRunning: vi.fn(),
				},
				messages: {
					appendAndEmit: ((_msgs: unknown[]) => {}) as never as never,
				},
				taskHistory: { updateTaskUsage: vi.fn() } as never,
				getTask: () => ({ taskId: activeTaskId }) as never,
				postStateToWebview: () => debouncer.post(),
				setTurnPhase: ((
					phase: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>>[0],
					anchorTs: number | undefined,
					writerId: string | undefined,
				) => {
					tracker.setWithWriter(phase, anchorTs, {
						writerId: (writerId ?? "unknown-legacy-writer") as never,
					})
				}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
				getTurnPhase: () => tracker.currentPhase,
				translateSessionEvent,
				hasRunningBackgroundJobForOwner: () => false,
				getActiveJobOwnershipSnapshot: () => [],
				getActiveSessionHost: () => undefined,
				getUnconsumedOwnedTerminalResultCount: () => 0,
				getUnconsumedOwnedTerminalJobIds: () => [],
				getPendingPromptCount: () => ({ available: true, count: 0 }) as PendingPromptCountRead,
				getActiveNotifyCount: () => 0,
				hasActiveNotify: () => false,
				wasWakeDispatchRequested: () => false,
				wasWakeDelivered: () => false,
				wasWakeDispatchFailed: () => false,
				getOutstandingAutonomousWork: () => false,
				getLaunchedBackgroundJobIds: () => [],
				enqueueCompletionContinuation: () => Promise.resolve({ kind: "no_held_job_ids" }),
				getElmCompletionAuthorityDecision: () => ({
					kind: "authorize" as const,
					reason: "test_tc_03_authorize",
				}),
			} as unknown as SdkSessionEventCoordinatorOptions)

			void notifyCoordinator

			translatorState.setAttemptCompletionSeen()
			translatorState.setTerminalResponseCommittedThisTurn()

			const doneEvent: CoreSessionEvent = {
				type: "agent_event",
				payload: {
					sessionId: activeSessionId,
					event: { type: "done", reason: "completed", text: "ok", iterations: 1 } as never,
				},
			} as CoreSessionEvent

			await coordinator.handleSessionEvent(doneEvent)

			// Wait long enough for the debouncer to flush.
			await new Promise((r) => setTimeout(r, 30))
			await debouncer.dispose()

			// The terminal commit seq is the tracker's CURRENT seq
			// (set by `setWithWriter` inside `setTurnPhase`).
			const commitSeq = tracker.get().seq
			expect(commitSeq).toBeGreaterThan(0)

			// At least one publication primitive must have fired,
			// and the snapshot it observed MUST be at the terminal
			// seq (since the debouncer flush runs AFTER the C10
			// commit completes synchronously).
			expect(publishedSnapshots.length).toBeGreaterThan(0)
			for (const pubSeq of publishedSnapshots) {
				expect(pubSeq).toBeGreaterThanOrEqual(commitSeq)
			}
		})
	})

	describe("RED — TERMINAL-PUB-04: deferred-barrier reevaluation commit MUST also fire a publication", () => {
		it("TERMINAL-PUB-04: when the C10 commit happens via the deferred-barrier reevaluation path (line ~1060), a publication MUST follow", async () => {
			// LIVE defect: **Type B (missing terminal publication) on
			// the DEFERRED path**. The main `done` handler at line
			// 1855 can DEFER the C10 commit. The C10 then fires on
			// the deferred path at line 1060 (via
			// `reevaluateDeferredCompletionBarrier`), and the
			// function returns at line 1088 WITHOUT firing
			// `postStateToWebview()`. The webview keeps the stale
			// `streaming / 5426` snapshot.
			const minter = new MessageIdMinter()
			const tracker = new TurnStateTracker(minter)
			const translatorState = new MessageTranslatorState(minter)
			const activeSessionId = "session-tc-04"
			const activeTaskId = "task-tc-04"

			const wakeSinkQueue: Array<{ sessionId: string; prompt: string }> = []
			let nowCounter = 0
			const notifyCoordinator = new BackgroundNotifyCoordinator({
				resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
				enqueueTerminalWake: ({ sessionId, prompt }) =>
					Promise.resolve(
						(async () => {
							wakeSinkQueue.push({ sessionId, prompt })
							return { kind: "delivered" as const }
						})(),
					),
				discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
				now: () => ++nowCounter,
			})

			const callOrder: string[] = []
			const postTerminalPublishedSeqs: number[] = []
			let postTerminalCallCount = 0
			let terminalCommitSeq = 0

			const setTurnPhaseImpl = (phase: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>>[0]) => {
				if (phase === "completed") {
					tracker.setWithWriter(phase, undefined, {
						writerId: "session-event-turn-complete-completed" as never,
					})
					terminalCommitSeq = tracker.get().seq
					callOrder.push(`setTurnPhase:completed:${terminalCommitSeq}`)
				} else {
					tracker.setWithWriter(phase, undefined, {
						writerId: "test-other-writer" as never,
					})
					callOrder.push(`setTurnPhase:${phase}:${tracker.get().seq}`)
				}
			}

			const postStateToWebviewImpl = async () => {
				postTerminalCallCount += 1
				const snapshotSeq = tracker.get().seq
				postTerminalPublishedSeqs.push(snapshotSeq)
				callOrder.push(`postStateToWebview:${snapshotSeq}`)
			}

			let elmConsults = 0
			const getElmCompletionAuthorityDecision = (): ElmCompletionAuthorityDecision => {
				elmConsults += 1
				if (elmConsults === 1) {
					return {
						kind: "hold",
						reason: "test_tc_04_initial_hold",
						holdReasons: ["test_tc_04_initial_hold"],
					}
				}
				return { kind: "authorize", reason: "test_tc_04_deferred_authorize" }
			}

			const coordinator = new SdkSessionEventCoordinator({
				messageTranslatorState: translatorState,
				sessions: {
					getActiveSession: () => ({
						sessionId: activeSessionId,
						sdkHost: {} as never,
						unsubscribe: vi.fn(),
						startResult: { sessionId: activeSessionId } as never,
						isRunning: false,
					}),
					setRunning: vi.fn(),
				},
				messages: {
					appendAndEmit: ((_msgs: unknown[]) => {}) as never as never,
				},
				taskHistory: { updateTaskUsage: vi.fn() } as never,
				getTask: () => ({ taskId: activeTaskId }) as never,
				postStateToWebview: postStateToWebviewImpl,
				setTurnPhase: setTurnPhaseImpl as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
				getTurnPhase: () => tracker.currentPhase,
				translateSessionEvent,
				hasRunningBackgroundJobForOwner: () => false,
				getActiveJobOwnershipSnapshot: () => [],
				getActiveSessionHost: () => undefined,
				getUnconsumedOwnedTerminalResultCount: () => 0,
				getUnconsumedOwnedTerminalJobIds: () => [],
				getPendingPromptCount: () => ({ available: true, count: 0 }) as PendingPromptCountRead,
				getActiveNotifyCount: () => 0,
				hasActiveNotify: () => false,
				wasWakeDispatchRequested: () => false,
				wasWakeDelivered: () => false,
				wasWakeDispatchFailed: () => false,
				getOutstandingAutonomousWork: () => false,
				getLaunchedBackgroundJobIds: () => [],
				enqueueCompletionContinuation: () => Promise.resolve({ kind: "no_held_job_ids" }),
				flushElmAuthorityForSession: async () => {},
				getElmCompletionAuthorityDecision,
			} as unknown as SdkSessionEventCoordinatorOptions)

			void notifyCoordinator

			translatorState.setAttemptCompletionSeen()
			translatorState.setTerminalResponseCommittedThisTurn()

			const doneEvent: CoreSessionEvent = {
				type: "agent_event",
				payload: {
					sessionId: activeSessionId,
					event: { type: "done", reason: "completed", text: "ok", iterations: 1 } as never,
				},
			} as CoreSessionEvent

			await coordinator.handleSessionEvent(doneEvent)
			await coordinator.notifyAgentTurnDone(activeSessionId)

			expect(terminalCommitSeq).toBeGreaterThan(0)
			expect(postTerminalCallCount).toBeGreaterThan(0)
			for (const pubSeq of postTerminalPublishedSeqs) {
				expect(pubSeq).toBeGreaterThanOrEqual(terminalCommitSeq)
			}
			const completedIdx = callOrder.findIndex((s) => s.startsWith("setTurnPhase:completed:"))
			const postPubIdx = callOrder.findIndex((s) => s.startsWith("postStateToWebview:"))
			expect(completedIdx).toBeGreaterThanOrEqual(0)
			expect(postPubIdx).toBeGreaterThanOrEqual(0)
			expect(completedIdx).toBeLessThan(postPubIdx)
		})
	})
})
