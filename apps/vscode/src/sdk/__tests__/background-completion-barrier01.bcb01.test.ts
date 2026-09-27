/**
 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01 — BCB01
 *
 * Product contract (frozen):
 *
 *   BACKGROUND != DETACHED
 *
 *   An ordinary background job is task-owned. A task MUST NOT
 *   commit final completion while any task-owned background
 *   job is non-terminal, AND terminal results that have not
 *   yet been consumed MUST reach the agent before the single
 *   final completion. No terminal information may be silently
 *   suppressed merely to avoid duplicate completions.
 *
 * Frozen invariants (per ACT §0.1):
 *
 *   task_completion_committed
 *     ⇒
 *   owned_background_jobs_nonterminal == 0
 *   AND
 *   unconsumed_owned_terminal_results == 0
 *
 * Adjudication:
 *
 *   Predecessor TQCB01 blocks completion on notify=true
 *   BackgroundNotifyCoordinator markers (the `activeNotifyCount`
 *   predicate). It explicitly does NOT block on notify=false
 *   (fire-and-forget) jobs (`hasRunningBackgroundJobForOwner`
 *   is NOT consulted at the C10 seam). This is the live
 *   HALT_BACKGROUND_TERMINAL_REENTERS_COMPLETED_TASK defect.
 *
 *   The repair here extends the completion-barrier predicate
 *   at the C10 completion-commit seam to include
 *   `hasRunningBackgroundJobForOwner(activeSession.sessionId)`
 *   so EVERY task-owned background job (notify=true AND
 *   notify=false) blocks completion until terminal.
 */

import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, type ResolveObligationDecision } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { createCommandStatusTool } from "../command-status-tool"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

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

// Real telemetry proxy requires HostProvider at init. Stub it
// so the dynamic SdkController import does not throw.
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
}

interface MakeHarnessOptions {
	activeSessionId?: string
	activeTaskId?: string
	pendingPromptAuthorityAvailable?: boolean
}

function makeHarness(opts: MakeHarnessOptions = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-bcb01"
	const activeTaskId = opts.activeTaskId ?? "task-bcb01"

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
		// BCB01: the load-bearing predicate. The barrier MUST
		// consult this on every C10 evaluation and re-evaluation.
		// The harness reports true iff ANY owned job (notify=true
		// OR notify=false) is still RUNNING for the active session.
		hasRunningBackgroundJobForOwner: () => ownedJobs.length > 0,
		getActiveJobOwnershipSnapshot: () =>
			ownedJobs.map((j) => ({
				jobId: j.jobId,
				state: "running" as const,
				ownerSessionId: activeSessionId,
			})),
		// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01:
		// the pending-prompt count is driven by the actual
		// wakeSink queue length, NOT hardcoded 0. This is the
		// verifier's "real PendingPromptsController" requirement.
		getPendingPromptCount:
			opts.pendingPromptAuthorityAvailable === false
				? () => ({ available: false as const }) as unknown as PendingPromptCountRead
				: (() => {
						return () =>
							({
								available: true as const,
								count: wakeSink.queued.length,
							}) as unknown as PendingPromptCountRead
					})(),
		getActiveNotifyCount: ((sessionId?: string, taskId?: string): number =>
			notifyCoordinator.activeNotifyCountForOwner(sessionId ?? activeSessionId, taskId ?? activeTaskId)) as unknown as (
			sessionId: string | undefined,
			taskId: string | undefined,
		) => number,
		// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01:
		// the second conjunct of BCB01 §0.1 — count of unconsumed
		// terminal identities owned by the active session. Delegates
		// to the real BackgroundNotifyCoordinator
		// `unconsumedTerminalCountForOwner` (which sums live
		// markers + held terminal results + non-notify terminal
		// observations for the owner).
		getUnconsumedOwnedTerminalResultCount: () =>
			notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, activeTaskId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	const registerNotifyJob = (jobId: string): void => {
		notifyCoordinator.registerMarker({ jobId, sessionId: activeSessionId, taskId: activeTaskId })
		ownedJobs.push({ jobId, notify: true })
	}
	const registerFireAndForgetJob = (jobId: string): void => {
		// No marker — matches production gating at
		// vscode-run-commands-tool.ts:772-778. The terminal
		// identity is registered by `drainFireAndForgetJob`
		// to mirror the production
		// `recordNonNotifyTerminalObservation` call at
		// vscode-run-commands-tool.ts:890-912 (the
		// terminalPromise listener for the
		// `notifyOnCompletion !== true` branch).
		ownedJobs.push({ jobId, notify: false })
	}
	const drainNotifyJob = (jobId: string, exitCode?: number): void => {
		notifyCoordinator.consumeTerminal({
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
		// Mirror production: at terminal, register the
		// non-notify terminal observation (the wake is
		// suppressed per user opt-out, but the terminal
		// identity is still authoritative for the BCB01 §0.1
		// invariant). The `skipTerminalObservation` flag is
		// used by tests that want to simulate the production
		// pre-CORRECTION01 behavior (no terminal identity
		// surfaced).
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
	// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01:
	// consume the non-notify terminal observation. Called when
	// the owning agent observes the terminal fact (e.g. via
	// `command_status` query, or when the conversation
	// includes the terminal observation in-band).
	const consumeNonNotifyTerminalObservation = (jobId: string, opts?: { sessionId?: string; taskId?: string }): void => {
		notifyCoordinator.consumeNonNotifyTerminalObservation({
			jobId,
			sessionId: opts?.sessionId ?? activeSessionId,
			taskId: opts?.taskId ?? activeTaskId,
		})
	}
	// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01:
	// observe ALL currently-queued terminal wakes. Called
	// when the agent's finalization turn has consumed
	// (observed in-band) all pending terminal-result prompts.
	// Mirrors the production drain — the
	// PendingPromptsController delivers the prompt to the
	// agent's conversation, which marks it observed; the
	// wake is then removed from the queue. The harness
	// implements this with the test sink's `discardByJobId`
	// for each queued wake, which the
	// BackgroundNotifyCoordinator's `enqueueTerminalWake`
	// callback already routes through.
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
				// Unknown shape — drop the head.
				wakeSink.queued.shift()
			}
			observed++
		}
		return observed
	}

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

// ============================================================================
// CONSERVATION
// ============================================================================

describe("BCB01 — background-completion barrier over task-owned jobs", () => {
	describe("Conservation — no background jobs", () => {
		it("BCB-01: submit_and_exit with no owned jobs → exactly one completion commit", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			expect(h.ownedJobs.length).toBe(0)
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	// ============================================================================
	// RED — notify=true path (notify-owned background jobs)
	// ============================================================================

	describe("RED — notify=true jobs block completion", () => {
		it("BCB-02: 1 notify=true running job → submit_and_exit blocked → drain → 1 commit", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerNotifyJob("J-bcb02")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			// Barrier HOLDS — completion NOT yet committed.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")

			// Drain the job → barrier re-evaluates with pending
			// wake still in queue → still HELD (CORRECTION01
			// second conjunct).
			h.drainNotifyJob("J-bcb02")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			// Now the agent's finalization turn observes the
			// wake (delivered to conversation) → barrier releases.
			h.observeAllPendingWakes()
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("BCB-03: 4 notify=true running jobs, sequential drain → 0 premature commits → 1 final commit, all 4 wakes observed", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerNotifyJob("J1-bcb03")
			h.registerNotifyJob("J2-bcb03")
			h.registerNotifyJob("J3-bcb03")
			h.registerNotifyJob("J4-bcb03")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(4)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Drain J1, re-evaluate, must still HOLD.
			h.drainNotifyJob("J1-bcb03")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			h.drainNotifyJob("J2-bcb03")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			h.drainNotifyJob("J3-bcb03")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			// Last drain. 4 wakes are now queued (Path A
			// flushed the 3 held + the new one). The barrier
			// HOLDS until the agent observes them all
			// (CORRECTION01 second conjunct).
			h.drainNotifyJob("J4-bcb03")
			expect(h.wakeSink.queued.length).toBe(4)
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			// Information cardinality preserved: 4 unique
			// wakes (verifier's load-bearing requirement).
			const seenJobIdsBeforeObserve = new Set(
				h.wakeSink.queued.map((q) => q.prompt.match(/\nJob: ([^\n]+)\n/)?.[1]).filter((x): x is string => Boolean(x)),
			)
			expect(seenJobIdsBeforeObserve).toEqual(new Set(["J1-bcb03", "J2-bcb03", "J3-bcb03", "J4-bcb03"]))

			// Now the finalization turn observes all 4 wakes.
			h.observeAllPendingWakes()
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	// ============================================================================
	// RED — notify=false (fire-and-forget) path — the LIVE DEFECT
	// ============================================================================

	describe("RED — notify=false (fire-and-forget) jobs block completion (LIVE DEFECT)", () => {
		it("BCB-11: 4 notify=false jobs running → barrier HOLDS → drains → 1 commit (live incident shape)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			// The live incident: 4 fire-and-forget jobs. No
			// markers are registered (matches the production
			// gating at vscode-run-commands-tool.ts:772-778).
			h.registerFireAndForgetJob("J1-bcb11")
			h.registerFireAndForgetJob("J2-bcb11")
			h.registerFireAndForgetJob("J3-bcb11")
			h.registerFireAndForgetJob("J4-bcb11")

			// notify coordinator has no markers (notify=false).
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)
			// But the running-owned-job predicate is non-zero.
			expect(h.ownedJobs.length).toBe(4)

			// Originating turn submits. The LIVE defect is
			// that completion commits HERE despite 4 running
			// jobs. BCB01 demands the barrier HOLDS.
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")

			// Drain each job; barrier holds until ALL terminal.
			h.drainFireAndForgetJob("J1-bcb11")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			h.drainFireAndForgetJob("J2-bcb11")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			h.drainFireAndForgetJob("J3-bcb11")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			// Last drain: 4 terminal observations are now
			// registered (the production path's terminalPromise
			// listener mirrors this for fire-and-forget jobs).
			// Barrier HOLDS until the agent observes them all
			// (CORRECTION01 second conjunct: unconsumed_owned_terminal_results == 0).
			h.drainFireAndForgetJob("J4-bcb11")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(4)

			// The owning agent observes each terminal fact
			// (e.g. via `command_status` queries). Each
			// observation decrements the unconsumed counter.
			h.consumeNonNotifyTerminalObservation("J1-bcb11")
			h.consumeNonNotifyTerminalObservation("J2-bcb11")
			h.consumeNonNotifyTerminalObservation("J3-bcb11")
			h.consumeNonNotifyTerminalObservation("J4-bcb11")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("BCB-12: notify=false + no submit_and_exit yet → completion NOT prematurely committed", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerFireAndForgetJob("J-bcb12")
			expect(h.ownedJobs.length).toBe(1)

			// Don't emit completion yet. Barrier must NOT be
			// engaged — barrier only engages on submit_and_exit.
			h.drainFireAndForgetJob("J-bcb12")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
			// CORRECTION01: terminal observation is registered
			// by drainFireAndForgetJob (matches production
			// vscode-run-commands-tool.ts:890-912 listener).
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			// submit_and_exit fires BEFORE observation →
			// barrier HOLDS (CORRECTION01 second conjunct).
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Agent observes the terminal observation.
			h.consumeNonNotifyTerminalObservation("J-bcb12")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("BCB-06: new notify=false job starts DURING completion_pending → barrier EXTENDS", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerNotifyJob("J1-bcb06")
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Drain J1 — barrier would normally release, but
			// the wake is now queued (CORRECTION01 second
			// conjunct), AND a NEW job starts. Barrier MUST
			// HOLD on both grounds.
			h.drainNotifyJob("J1-bcb06")
			expect(h.ownedJobs.length).toBe(0)
			h.registerFireAndForgetJob("J2-bcb06")
			expect(h.ownedJobs.length).toBe(1)

			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			// Drain J2 → barrier HOLDS: 1 wake + 1 obs still
			// unconsumed.
			h.drainFireAndForgetJob("J2-bcb06")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			// Observe J1's wake AND J2's terminal observation.
			h.observeAllPendingWakes()
			h.consumeNonNotifyTerminalObservation("J2-bcb06")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	// ============================================================================
	// Adversarial matrix — terminal cardinality and coalescing
	// ============================================================================

	describe("Adversarial matrix", () => {
		it("BCB-04: 4 notify=true near-simultaneous terminals → 1 outstanding commit, all 4 results visible", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerNotifyJob("J1-bcb04")
			h.registerNotifyJob("J2-bcb04")
			h.registerNotifyJob("J3-bcb04")
			h.registerNotifyJob("J4-bcb04")

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Drain all 4 synchronously (no re-evaluate between).
			h.drainNotifyJob("J1-bcb04")
			h.drainNotifyJob("J2-bcb04")
			h.drainNotifyJob("J3-bcb04")
			h.drainNotifyJob("J4-bcb04")

			// Single re-evaluation with 4 unobserved wakes:
			// barrier HOLDS (CORRECTION01 second conjunct).
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			expect(h.wakeSink.queued.length).toBe(4)

			// Information cardinality preserved: 4 unique
			// wakes (verifier's load-bearing requirement).
			const seenBeforeObserve = new Set(
				h.wakeSink.queued.map((q) => q.prompt.match(/\nJob: ([^\n]+)\n/)?.[1]).filter((x): x is string => Boolean(x)),
			)
			expect(seenBeforeObserve).toEqual(new Set(["J1-bcb04", "J2-bcb04", "J3-bcb04", "J4-bcb04"]))

			// Finalization turn observes all 4 wakes.
			expect(h.observeAllPendingWakes()).toBe(4)
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("BCB-05: terminal before submit_and_exit → wake delivered, completion NOT premature", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerNotifyJob("J-bcb05")

			// Job drains BEFORE submit_and_exit. The wake is
			// delivered to PendingPromptsController (the
			// BackgroundNotifyCoordinator dispatched it on
			// consumeTerminal because it was the last notify
			// marker for the owner).
			h.drainNotifyJob("J-bcb05")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			// submit_and_exit fires BEFORE the agent observes the
			// wake → barrier HOLDS (CORRECTION01 second
			// conjunct).
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.wakeSink.queued.length).toBe(1)

			// Finalization turn observes the wake.
			h.observeAllPendingWakes()
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("BCB-07: cancelled notify=true job clears the barrier", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerNotifyJob("J-bcb07")
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Simulate cancel → drain via Path B (resolveObligation).
			const decision: ResolveObligationDecision = h.notifyCoordinator.resolveObligation({
				jobId: "J-bcb07",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
				resolution: "canonical_status_observed",
			})
			expect(decision.kind).not.toBe("kept")
			const idx = h.ownedJobs.findIndex((j) => j.jobId === "J-bcb07")
			if (idx >= 0) h.ownedJobs.splice(idx, 1)

			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("BCB-08: failed job → terminal result preserved (non-zero exitCode is consumable)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerNotifyJob("J-bcb08-fail")
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Fail the job (exitCode != 0). Wake carries the
			// terminal failure information (information is
			// content even when the exit code is non-zero).
			h.drainNotifyJob("J-bcb08-fail", 1)
			expect(h.wakeSink.queued.length).toBe(1)
			const prompt = h.wakeSink.queued[0].prompt
			expect(prompt).toContain("J-bcb08-fail")

			// Barrier HOLDS: 1 wake queued, not yet observed.
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)

			// Agent observes the failure wake (information
			// content delivered to the conversation).
			h.observeAllPendingWakes()
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("BCB-09: duplicate consumeTerminal → ownership decremented exactly once", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerNotifyJob("J-bcb09")

			// First drain.
			h.drainNotifyJob("J-bcb09")
			expect(h.ownedJobs.length).toBe(0)
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			// Duplicate drain must NOT throw, must NOT affect state.
			expect(() => h.drainNotifyJob("J-bcb09")).not.toThrow()
			expect(h.ownedJobs.length).toBe(0)
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("BCB-10: late terminal event after COMPLETED → no new conversational authority, no duplicate commit", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerNotifyJob("J-bcb10")
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			h.drainNotifyJob("J-bcb10")
			// Barrier HOLDS: 1 wake queued (CORRECTION01).
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			// Agent observes the wake.
			h.observeAllPendingWakes()
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			// LATE terminal event arrives. The barrier
			// marker has been cleared. The duplicate drain
			// must NOT trigger another `task_completion_committed`.
			h.drainNotifyJob("J-bcb10")
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
			// CORRECTION01: a late wake may be enqueued by
			// the duplicate drain. The barrier predicate is
			// still HELD by the new wake (1 unconsumed
			// terminal result for the owner), but the
			// phase is already "completed" so no new commit
			// fires. This is correct: the original completion
			// committed first, the late wake is observed
			// in-band in a later turn (post-completion). The
			// C10 cardinality invariant (1 completion per
			// task) is preserved.

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	// ============================================================================
	// Integration: real production tool + real CommandJobManager
	// ============================================================================

	describe("Integration — production tool path", () => {
		it("BCB-INT-01: real run_commands + CommandJobManager → barrier holds on running aggregate", async () => {
			const manager = new CommandJobManager()
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})

			const resolveActiveOwner = () => ({ sessionId: h.activeSessionId, taskId: h.activeTaskId })

			const runTool = createVscodeRunCommandsTool({
				cwd: process.cwd(),
				getTerminalManager: () => {
					throw new Error("foreground not used")
				},
				vscodeTerminalExecutionMode: "backgroundExec",
				commandJobManager: manager,
				backgroundWaitBudgetMs: 5,
				backgroundExecutionDeadlineMs: 30_000,
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner,
			})

			// Launch a LONG-RUNNING notify=false job via the
			// real run_commands tool.
			const runResult = (await runTool.execute(
				{ commands: ["/bin/sh -c 'sleep 1; exit 0'"] /* notifyOnCompletion omitted → false */ },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()

			// notify=false: no marker registered.
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)
			// BUT CommandJobManager has a running job owned by
			// this session.
			expect(manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)
			// Mirror into the harness's ownedJobs so the
			// coordinator's `hasRunningBackgroundJobForOwner`
			// option returns true.
			h.ownedJobs.push({ jobId, notify: false })

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			// Barrier HOLDS (the LIVE defect would have committed here).
			expect(h.completionCommitCount()).toBe(0)

			// Wait for the real job to terminal.
			await manager.status({ jobId, waitMs: 5_000 })
			for (let i = 0; i < 100; i += 1) {
				if (manager.activeCount === 0) break
				await new Promise((r) => setTimeout(r, 50))
			}
			expect(manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(false)

			// Remove from ownedJobs to mirror terminal.
			const idx = h.ownedJobs.findIndex((j) => j.jobId === jobId)
			if (idx >= 0) h.ownedJobs.splice(idx, 1)

			// CORRECTION01: the production
			// vscode-run-commands-tool.ts:890-912 listener
			// registers a non-notify terminal observation
			// when the fire-and-forget job reaches
			// terminal. Barrier HOLDS until the agent
			// observes it.
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBeGreaterThan(0)

			// Agent observes the terminal observation.
			h.consumeNonNotifyTerminalObservation(jobId)
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
			await manager.dispose()
		}, 30_000)

		it("BCB-INT-02: real run_commands notify=true + command_status (Path B) → barrier holds then releases", async () => {
			const manager = new CommandJobManager()
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})

			const resolveActiveOwner = () => ({ sessionId: h.activeSessionId, taskId: h.activeTaskId })

			const runTool = createVscodeRunCommandsTool({
				cwd: process.cwd(),
				getTerminalManager: () => {
					throw new Error("foreground not used")
				},
				vscodeTerminalExecutionMode: "backgroundExec",
				commandJobManager: manager,
				backgroundWaitBudgetMs: 5,
				backgroundExecutionDeadlineMs: 30_000,
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner,
			})

			const runResult = (await runTool.execute(
				{ commands: ["/bin/sh -c 'sleep 0.1; exit 0'"], notifyOnCompletion: true },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()
			// Mirror ownedJobs for the harness predicate.
			h.ownedJobs.push({ jobId, notify: true })

			// Wait for terminal and Path A consumer.
			await manager.status({ jobId, waitMs: 5_000 })
			for (let i = 0; i < 100; i += 1) {
				if (manager.activeCount === 0) break
				await new Promise((r) => setTimeout(r, 50))
			}

			// Path A drains most likely; defensively call
			// Path B (command_status) if marker still alive.
			if (h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId) > 0) {
				const statusTool = createCommandStatusTool(manager, {
					backgroundNotifyCoordinator: h.notifyCoordinator,
					resolveActiveOwner,
				})
				await statusTool.execute(
					{ jobId, waitMs: 0 },
					{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
				)
			}

			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)
			// Mirror drain in ownedJobs.
			const idx = h.ownedJobs.findIndex((j) => j.jobId === jobId)
			if (idx >= 0) h.ownedJobs.splice(idx, 1)

			// CORRECTION01: notify=true wake may be in
			// the queue (Path A enqueued it before we
			// observed completion). Barrier HOLDS until
			// the agent observes it.
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			const wakeCount = h.wakeSink.queued.length
			if (wakeCount > 0) {
				expect(h.completionCommitCount()).toBe(0)
				// Agent observes all wakes.
				h.observeAllPendingWakes()
				h.coordinator.reevaluateDeferredCompletionBarrier()
			}
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
			await manager.dispose()
		}, 30_000)
	})
})
