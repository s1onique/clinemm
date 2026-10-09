/**
 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01 — BCB01-C
 *
 * Product contract (frozen per BCB01 §0.1):
 *
 *   task_completion_committed
 *     ⇒
 *   owned_background_jobs_nonterminal == 0
 *   AND
 *   unconsumed_owned_terminal_results == 0
 *
 * BCB01 (parent ACT) enforced only the first conjunct (the
 * running-job barrier). The CORRECTION01 ACT enforces the
 * second conjunct (the terminal-result consumption barrier).
 *
 * BCB01-C tests are the load-bearing evidence for the second
 * conjunct: completion MUST NOT commit while any task-owned
 * terminal identity remains unobserved by the agent.
 *
 * Key seam: `getUnconsumedOwnedTerminalResultCount` option
 * (added by CORRECTION01) consulted at the C10 completion-commit
 * predicate (sdk-session-event-coordinator.ts:~1025-1043) and
 * the re-evaluation seam (~575-579).
 *
 * Source of authority: `BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner`
 * which sums:
 *   - live notify markers (Path A in flight / Path B pending)
 *   - held terminal results (terminal came in while other
 *     notify jobs were still in flight)
 *   - non-notify terminal observations (fire-and-forget jobs
 *     whose wake is suppressed but whose terminal identity
 *     must still be observed by the owning agent)
 *
 * Scenarios covered:
 *
 *   BCB-13: 4 notify=true terminals + 0 consumed → HELD
 *   BCB-14: 4 notify=true terminals + all 4 consumed → 1 commit
 *   BCB-15: 4 notify=false terminals + 0 consumed → HELD (production path surfaces terminal identity)
 *   BCB-16: 2 notify=true + 2 notify=false mixed, all 6 terminal + 0 consumed → HELD
 *   BCB-17: cancelled jobs NOT counted as unconsumed
 *   BCB-18: failed jobs (non-zero exitCode) terminal IS counted
 *   BCB-19: MAX_OUTSTANDING_TERMINAL_CONTINUATIONS = 1 — even with 4 unconsumed terminals, only 1 outstanding conversational authority
 *   BCB-20: real PendingPromptsController (getPendingPromptCount driven by wakeSink.queued.length) — pendingPromptCount == wakeSink.queued.length
 */

import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
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

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
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
	readonly id: string
}

class TestPendingPromptsSink {
	public readonly queued: QueuedPrompt[] = []
	private nextId = 0
	enqueue(input: { sessionId: string; prompt: string }): void {
		const id = `pending_test_${++this.nextId}`
		this.queued.push({ sessionId: input.sessionId, prompt: input.prompt, id })
	}
	countForSession(sessionId: string): number {
		return this.queued.filter((q) => q.sessionId === sessionId).length
	}
	discardByJobId(sessionId: string, jobId: string): boolean {
		const idx = this.queued.findIndex(
			(q) =>
				q.sessionId === sessionId &&
				q.prompt.startsWith("A background command you asked to be notified about has reached a terminal state.") &&
				q.prompt.includes(`\nJob: ${jobId}\n`),
		)
		if (idx < 0) {
			return false
		}
		this.queued.splice(idx, 1)
		return true
	}
}

interface OwnedJobEntry {
	readonly jobId: string
	readonly notify: boolean
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
	ownedJobs: OwnedJobEntry[]
	registerNotifyJob: (jobId: string) => void
	registerFireAndForgetJob: (jobId: string) => void
	drainNotifyJob: (jobId: string, exitCode?: number) => void
	drainFireAndForgetJob: (jobId: string, opts?: { skipTerminalObservation?: boolean }) => void
	consumeNonNotifyTerminalObservation: (jobId: string, opts?: { sessionId?: string; taskId?: string }) => void
	observeAllPendingWakes: () => number
	getUnconsumedCount: () => number
	getPendingPromptCountRead: () => number
}

function makeHarness(): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-bcb01c"
	const activeTaskId = "task-bcb01c"

	const wakeSink = new TestPendingPromptsSink()
	let now = 0
	const ownedJobs: OwnedJobEntry[] = []

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) =>
			Promise.resolve(wakeSink.enqueue({ sessionId, prompt })).then(() => ({ kind: "delivered" as const })),
		discardQueuedWake: ({ sessionId, jobId }) => {
			const removed = wakeSink.discardByJobId(sessionId, jobId)
			return removed ? { kind: "discarded", jobId, promptId: undefined } : { kind: "not_found", jobId }
		},
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
		hasRunningBackgroundJobForOwner: () => ownedJobs.length > 0,
		getActiveJobOwnershipSnapshot: () =>
			ownedJobs.map((j) => ({
				jobId: j.jobId,
				state: "running" as const,
				ownerSessionId: activeSessionId,
			})),
		getPendingPromptCount: () =>
			({
				available: true as const,
				count: wakeSink.queued.length,
			}) as unknown as PendingPromptCountRead,
		getActiveNotifyCount: ((sessionId?: string, taskId?: string): number =>
			notifyCoordinator.activeNotifyCountForOwner(sessionId ?? activeSessionId, taskId ?? activeTaskId)) as unknown as (
			sessionId: string | undefined,
			taskId: string | undefined,
		) => number,
		getUnconsumedOwnedTerminalResultCount: () =>
			notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, activeTaskId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	const registerNotifyJob = (jobId: string): void => {
		notifyCoordinator.registerMarker({ jobId, sessionId: activeSessionId, taskId: activeTaskId })
		ownedJobs.push({ jobId, notify: true })
	}
	const registerFireAndForgetJob = (jobId: string): void => {
		ownedJobs.push({ jobId, notify: false })
	}
	const drainNotifyJob = async (jobId: string, exitCode?: number): Promise<void> => {
		await notifyCoordinator.consumeTerminal({
			jobId,
			terminalState: "exited",
			exitCode: exitCode ?? 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		const idx = ownedJobs.findIndex((j) => j.jobId === jobId)
		if (idx >= 0) ownedJobs.splice(idx, 1)
	}
	const drainFireAndForgetJob = (jobId: string, opts?: { skipTerminalObservation?: boolean }): void => {
		if (!opts?.skipTerminalObservation) {
			notifyCoordinator.recordNonNotifyTerminalObservation({
				jobId,
				sessionId: activeSessionId,
				taskId: activeTaskId,
			})
		}
		const idx = ownedJobs.findIndex((j) => j.jobId === jobId)
		if (idx >= 0) ownedJobs.splice(idx, 1)
	}
	const consumeNonNotifyTerminalObservation = (jobId: string, opts?: { sessionId?: string; taskId?: string }): void => {
		notifyCoordinator.consumeNonNotifyTerminalObservation({
			jobId,
			sessionId: opts?.sessionId ?? activeSessionId,
			taskId: opts?.taskId ?? activeTaskId,
		})
	}
	const observeAllPendingWakes = (): number => {
		let observed = 0
		while (wakeSink.queued.length > 0) {
			const w = wakeSink.queued[0]
			if (!w) break
			const match = w.prompt.match(/\nJob: ([^\n]+)\n/)
			const jobId = match?.[1]
			if (jobId) {
				wakeSink.discardByJobId(activeSessionId, jobId)
			} else {
				wakeSink.queued.shift()
			}
			observed++
		}
		return observed
	}
	const getUnconsumedCount = (): number => notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, activeTaskId)
	const getPendingPromptCountRead = (): number => wakeSink.queued.length

	return {
		coordinator,
		tracker,
		translatorState,
		notifyCoordinator,
		wakeSink,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => completionCommitCount,
		ownedJobs: ownedJobs as OwnedJobEntry[],
		registerNotifyJob,
		registerFireAndForgetJob,
		drainNotifyJob,
		drainFireAndForgetJob,
		consumeNonNotifyTerminalObservation,
		observeAllPendingWakes,
		getUnconsumedCount,
		getPendingPromptCountRead,
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

describe("BCB01-C — CORRECTION01 — second-conjunct enforcement", () => {
	// ==========================================================================
	// BCB-13/14: notify=true consumption barrier
	// ==========================================================================
	describe("notify=true consumption barrier", () => {
		it("BCB-13: 4 notify=true terminals + 0 consumed → HELD (second conjunct)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.registerNotifyJob("J1-bcb13")
			h.registerNotifyJob("J2-bcb13")
			h.registerNotifyJob("J3-bcb13")
			h.registerNotifyJob("J4-bcb13")

			// submit_and_exit first, THEN drain the jobs.
			// The barrier HOLDS on running jobs (first
			// conjunct) AND on the consumption counter
			// (second conjunct) once jobs reach terminal.
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Drain all 4 — wakes queued (4), running jobs == 0.
			await await h.drainNotifyJob("J1-bcb13")
			await await h.drainNotifyJob("J2-bcb13")
			await await h.drainNotifyJob("J3-bcb13")
			await await h.drainNotifyJob("J4-bcb13")
			expect(h.ownedJobs.length).toBe(0)
			expect(h.wakeSink.queued.length).toBe(4)
			expect(h.getPendingPromptCountRead()).toBe(4)

			// Even with 0 running jobs, the barrier HOLDS on
			// the 4 unobserved wakes. CRITICAL test — this is
			// the live-defect shape that BCB01 (parent) missed.
			// The C10 predicate consults BOTH
			// `getPendingPromptCount` (the 4 wakes here) AND
			// `getUnconsumedOwnedTerminalResultCount`
			// (the non-notify path). For the notify=true
			// case the wakes-in-queue counter is the
			// load-bearing check.
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("BCB-14: 4 notify=true terminals + all 4 consumed → 1 commit", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.registerNotifyJob("J1-bcb14")
			h.registerNotifyJob("J2-bcb14")
			h.registerNotifyJob("J3-bcb14")
			h.registerNotifyJob("J4-bcb14")

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			await await h.drainNotifyJob("J1-bcb14")
			await await h.drainNotifyJob("J2-bcb14")
			await await h.drainNotifyJob("J3-bcb14")
			await await h.drainNotifyJob("J4-bcb14")
			expect(h.wakeSink.queued.length).toBe(4)

			// Barrier still HELD (4 unobserved).
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			// Agent observes all 4.
			expect(h.observeAllPendingWakes()).toBe(4)
			expect(h.getPendingPromptCountRead()).toBe(0)
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	// ==========================================================================
	// BCB-15: notify=false consumption barrier — production surfaces terminal ID
	// ==========================================================================
	describe("notify=false consumption barrier (production surfaces terminal identity)", () => {
		it("BCB-15: 4 notify=false terminals + 0 consumed → HELD (live-defect shape)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.registerFireAndForgetJob("J1-bcb15")
			h.registerFireAndForgetJob("J2-bcb15")
			h.registerFireAndForgetJob("J3-bcb15")
			h.registerFireAndForgetJob("J4-bcb15")
			expect(h.ownedJobs.length).toBe(4)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Drain all 4 → production's
			// vscode-run-commands-tool.ts:890-912 listener
			// has registered 4 non-notify terminal observations.
			h.drainFireAndForgetJob("J1-bcb15")
			h.drainFireAndForgetJob("J2-bcb15")
			h.drainFireAndForgetJob("J3-bcb15")
			h.drainFireAndForgetJob("J4-bcb15")
			expect(h.ownedJobs.length).toBe(0)
			// 4 terminal observations registered.
			expect(h.getUnconsumedCount()).toBe(4)

			// Even with 0 running jobs, barrier HOLDS on
			// the 4 unobserved terminal identities.
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			// Agent observes each terminal observation.
			h.consumeNonNotifyTerminalObservation("J1-bcb15")
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			h.consumeNonNotifyTerminalObservation("J2-bcb15")
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			h.consumeNonNotifyTerminalObservation("J3-bcb15")
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			h.consumeNonNotifyTerminalObservation("J4-bcb15")
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	// ==========================================================================
	// BCB-16: mixed notify=true + notify=false
	// ==========================================================================
	describe("mixed notify=true + notify=false consumption barrier", () => {
		it("BCB-16: 2 notify=true + 2 notify=false, all 6 unconsumed → HELD", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.registerNotifyJob("N1-bcb16")
			h.registerNotifyJob("N2-bcb16")
			h.registerFireAndForgetJob("F1-bcb16")
			h.registerFireAndForgetJob("F2-bcb16")

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			await await h.drainNotifyJob("N1-bcb16")
			await await h.drainNotifyJob("N2-bcb16")
			h.drainFireAndForgetJob("F1-bcb16")
			h.drainFireAndForgetJob("F2-bcb16")
			expect(h.ownedJobs.length).toBe(0)

			// Mixed: 2 notify wakes + 2 non-notify
			// observations = 4 unconsumed terminal IDs.
			expect(h.wakeSink.queued.length).toBe(2)
			expect(h.getPendingPromptCountRead()).toBe(2)
			expect(h.getUnconsumedCount()).toBe(2) // the 2 non-notify observations

			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			// Observe wakes + consume observations.
			h.observeAllPendingWakes()
			h.consumeNonNotifyTerminalObservation("F1-bcb16")
			h.consumeNonNotifyTerminalObservation("F2-bcb16")
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	// ==========================================================================
	// BCB-17: cancelled jobs NOT counted
	// ==========================================================================
	describe("cancelled jobs are NOT unconsumed terminal results", () => {
		it("BCB-17: cancelled job → no terminal observation registered, barrier releases cleanly", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.registerFireAndForgetJob("J-bcb17-cancel")

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Simulate cancellation: drain with no terminal
			// observation (the production path would not call
			// recordNonNotifyTerminalObservation for
			// `cancel`-resolved jobs because there is no
			// information content to consume).
			h.drainFireAndForgetJob("J-bcb17-cancel", { skipTerminalObservation: true })
			expect(h.getUnconsumedCount()).toBe(0)
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	// ==========================================================================
	// BCB-18: failed jobs ARE counted
	// ==========================================================================
	describe("failed jobs ARE unconsumed terminal results (information content)", () => {
		it("BCB-18: failed notify=true (exitCode=1) → wake carries failure info → BARRIER HOLDS until observed", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.registerNotifyJob("J-bcb18-fail")

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Drain with exitCode=1 — wake carries failure.
			await await h.drainNotifyJob("J-bcb18-fail", 1)
			expect(h.wakeSink.queued.length).toBe(1)
			const prompt = h.wakeSink.queued[0].prompt
			expect(prompt).toContain("J-bcb18-fail")
			expect(prompt).toContain("ExitCode: 1")

			// Barrier HOLDS: failed result IS information.
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			expect(h.getPendingPromptCountRead()).toBe(1)

			// Agent observes the failure wake.
			h.observeAllPendingWakes()
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	// ==========================================================================
	// BCB-19: MAX_OUTSTANDING_TERMINAL_CONTINUATIONS = 1
	// ==========================================================================
	describe("MAX_OUTSTANDING_TERMINAL_CONTINUATIONS = 1", () => {
		it("BCB-19: 4 unconsumed terminals → 1 outstanding commit, no duplicate fires", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.registerNotifyJob("J1-bcb19")
			h.registerNotifyJob("J2-bcb19")
			h.registerNotifyJob("J3-bcb19")
			h.registerNotifyJob("J4-bcb19")

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			await await h.drainNotifyJob("J1-bcb19")
			await await h.drainNotifyJob("J2-bcb19")
			await await h.drainNotifyJob("J3-bcb19")
			await await h.drainNotifyJob("J4-bcb19")

			// 4 wakes queued.
			expect(h.wakeSink.queued.length).toBe(4)
			expect(h.getPendingPromptCountRead()).toBe(4)

			// Reevaluate twice — only 1 commit when wakes are
			// consumed, not 2.
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			h.observeAllPendingWakes()
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			// Second reevaluate MUST NOT commit again.
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	// ==========================================================================
	// BCB-20: getPendingPromptCount wired to wakeSink.queued.length
	// ==========================================================================
	describe("getPendingPromptCount reflects real PendingPromptsController queue", () => {
		it("BCB-20: pendingPromptCount == wakeSink.queued.length at all times", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.registerNotifyJob("J1-bcb20")
			h.registerNotifyJob("J2-bcb20")
			h.registerNotifyJob("J3-bcb20")

			expect(h.getPendingPromptCountRead()).toBe(0)

			await await h.drainNotifyJob("J1-bcb20")
			expect(h.getPendingPromptCountRead()).toBe(0) // held, not queued

			await await h.drainNotifyJob("J2-bcb20")
			expect(h.getPendingPromptCountRead()).toBe(0) // held, not queued

			await await h.drainNotifyJob("J3-bcb20") // last drain flushes ALL held + this one
			expect(h.getPendingPromptCountRead()).toBe(3)

			// After observing all wakes.
			h.observeAllPendingWakes()
			expect(h.getPendingPromptCountRead()).toBe(0)

			h.notifyCoordinator.dispose()
		}, 15_000)
	})
})
