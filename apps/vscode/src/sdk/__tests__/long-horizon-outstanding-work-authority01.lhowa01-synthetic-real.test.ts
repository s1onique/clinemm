/**
 * ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 / LHOWA01
 *
 * SYNTHETIC_REAL primary RED + GREEN discriminator for the
 * "Your turn" false-positive defect.
 *
 * The defect (Shape D in `03-turn-authority-map.md`):
 *
 *   1. agent starts run_commands(notifyOnCompletion: true) → J1 RUNNING
 *   2. J1 terminates BEFORE the model emits done-without-completion
 *   3. BackgroundNotifyCoordinator.consumeTerminal(J1) DRAINS — enqueues
 *      a wake into PendingPromptsController via the production transport
 *   4. agent emits done-without-completion
 *   5. Q5 composition seam (Branch 4):
 *      guard = hasRunningBackgroundJobForOwner(activeSessionId) === false
 *      → setTurnPhase("awaiting_followup", ...)
 *      → webview shows "Your turn"
 *      BUT the queued wake is sitting in PendingPromptsController.
 *
 * Production seams exercised: CommandJobManager, BackgroundNotifyCoordinator,
 * SdkSessionEventCoordinator, TurnStateTracker, MessageTranslatorState.
 *
 * RED (defect reproduced): after a terminal-wake is enqueued and the
 * agent emits done-without-completion, the Q5 commit fires
 * awaiting_followup. This is the false-positive "Your turn".
 *
 * GREEN (after bounded repair): the Q5 commit is SUPPRESSED because
 * outstandingAutonomousWork === true (a queued wake is present).
 * A DeferredContinuation marker is registered so the BTCONT01
 * terminal-idle re-evaluation commits awaiting_followup exactly once
 * after the wake has been delivered to the next turn.
 */

import { type CoreSessionEvent, type SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
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

let supervisorPid = 70000

function fakeSupervisor(opts: { pid: number; pgid: number }): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: opts.pid,
		pgid: opts.pgid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return {
				treeTerminated: true,
				escalatedToKill: false,
				epermDetected: false,
			}
		},
		stdoutSnapshot: () => ({ text: "started\nfinished\n", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
}

// =============================================================================
// Test-local pending-prompt sink (mirrors SdkController's enqueueTerminalWake)
// =============================================================================

interface QueuedPrompt {
	readonly sessionId: string
	readonly prompt: string
}

class TestPendingPromptsSink {
	public readonly queued: QueuedPrompt[] = []
	enqueue(input: { sessionId: string; prompt: string }): void {
		this.queued.push({ sessionId: input.sessionId, prompt: input.prompt })
	}
	pendingCountForSession(sessionId: string): number {
		return this.queued.filter((q) => q.sessionId === sessionId).length
	}
}

// =============================================================================
// Harness
// =============================================================================

interface ProductionHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	notifyCoordinator: BackgroundNotifyCoordinator
	wakeSink: TestPendingPromptsSink
	activeSessionId: string
	activeTaskId: string
	getPendingPromptCount: ReturnType<typeof vi.fn> & ((sessionId?: string) => number)
	getActiveNotifyCount: ReturnType<typeof vi.fn> & ((sessionId?: string, taskId?: string) => number)
	registerMarker: (jobId: string) => void
}

interface MakeHarnessOptions {
	activeSessionId?: string
	activeTaskId?: string
}

function makeHarness(opts: MakeHarnessOptions = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-lhowa01"
	const activeTaskId = opts.activeTaskId ?? "task-lhowa01-live"

	const supervisor = fakeSupervisor({ pid: ++supervisorPid, pgid: ++supervisorPid })
	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: () => supervisor,
	})

	const wakeSink = new TestPendingPromptsSink()
	let now = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) => wakeSink.enqueue({ sessionId, prompt }),
		now: () => ++now,
	})

	const getPendingPromptCount = vi.fn(
		(_sessionId?: string): number => 0,
	) as ReturnType<typeof vi.fn> & ((sessionId?: string) => number)
	const getActiveNotifyCount = vi.fn(
		(_sessionId?: string, _taskId?: string): number => 0,
	) as ReturnType<typeof vi.fn> & ((sessionId?: string, taskId?: string) => number)

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
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => manager.hasRunningBackgroundJobForOwner(activeSessionId),
		getPendingPromptCount: getPendingPromptCount as unknown as (
			sessionId: string | undefined,
		) => number,
		getActiveNotifyCount: getActiveNotifyCount as unknown as (
			sessionId: string | undefined,
			taskId: string | undefined,
		) => number,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		manager,
		notifyCoordinator,
		wakeSink,
		activeSessionId,
		activeTaskId,
		getPendingPromptCount,
		getActiveNotifyCount,
		registerMarker: (jobId: string) => {
			notifyCoordinator.registerMarker({
				jobId,
				sessionId: activeSessionId,
				taskId: activeTaskId,
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

async function emitDoneWithoutCompletion(
	coordinator: SdkSessionEventCoordinator,
	sessionId: string,
): Promise<void> {
	const doneEvent = agentEvent(sessionId, {
		type: "done",
		reason: "completed",
		text: "Some text without commit.",
		iterations: 1,
	})
	await coordinator.handleSessionEvent(doneEvent)
}

async function startAndCompleteBackgroundJob(
	harness: ProductionHarness,
	opts: { notifyOnCompletion?: boolean } = {},
): Promise<{ jobId: string }> {
	const start = await harness.manager.start(
		{
			command: "sleep 0.05",
			cwd: process.cwd(),
			shell: "/bin/sh",
			env: { SHELL: "/bin/sh" },
			waitBudgetMs: 5,
			executionDeadlineMs: 60_000,
			maxOutputChars: 4096,
		},
		{ sessionId: harness.activeSessionId, agentId: "test-agent", iteration: 1 },
	)
	if (start.state !== "running") {
		throw new Error(`expected state=running, got state=${start.state}`)
	}
	if (opts.notifyOnCompletion !== false) {
		harness.registerMarker(start.jobId)
	}

	// Cancel + wait for terminal promise (mirrors production flow).
	await harness.manager.cancel({ jobId: start.jobId })
	await start.terminalPromise

	// Manually call consumeTerminal with a synthetic terminalState.
	harness.notifyCoordinator.consumeTerminal({
		jobId: start.jobId,
		terminalState: "exited",
		exitCode: 0,
		reason: "natural",
		isContainmentFailed: false,
		outputTail: "started\nfinished\n",
	})

	return { jobId: start.jobId }
}

// =============================================================================
// Tests
// =============================================================================

describe("ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 / LHOWA01", () => {
	describe("Shape D — terminal-wake already enqueued before done-without-completion", () => {
		it("LHOWA01-GREEN: pendingPromptCount > 0 + done-without-completion → Q5 seam DEFERS (preserves streaming)", async () => {
			// POST-FIX GREEN: the bounded repair has wired
			// `getPendingPromptCount` + `getActiveNotifyCount` into the
			// Q5 guard chain. When the wake has already been enqueued
			// but no RUNNING job remains, the `outstandingAutonomousWork`
			// predicate is true (pendingPromptCount > 0) and the Q5
			// seam defers (does NOT commit awaiting_followup). The
			// BTCONT01 terminal-idle re-evaluation will commit
			// awaiting_followup exactly once after the wake has been
			// delivered to the next turn.

			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			expect(h.tracker.currentPhase).toBe("streaming")

			// 1. Start + terminate a background job (notify-on-terminal
			//    registered). Mirrors T0+T1 in the ACT chronology.
			await startAndCompleteBackgroundJob(h, {
				notifyOnCompletion: true,
			})

			// 2. The wake transport must have enqueued the wake into
			//    the sink (mirrors PendingPromptsController.enqueue).
			expect(h.wakeSink.pendingCountForSession(h.activeSessionId)).toBe(1)

			// 3. Wire the Q5 guard chain to consult the real sink.
			h.getPendingPromptCount.mockImplementation(() =>
				h.wakeSink.pendingCountForSession(h.activeSessionId),
			)

			// 4. The Q5 composition seam should now DEFER because
			// pendingPromptCount > 0. The phase stays at "streaming"
			// (preserved); the next turn will consume the queued wake.
			await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

			// GREEN ASSERTION: the Q5 seam DEFERS (preserves "streaming")
			// instead of committing awaiting_followup. This is the
			// bounded repair's correct behavior.
			expect(h.tracker.currentPhase).not.toBe("awaiting_followup")
			expect(h.tracker.currentPhase).toBe("streaming")

			// Cleanup.
			await h.manager.dispose()
		}, 15_000)
	})

	describe("Conservation: pre-existing guards unchanged", () => {
		it("LHOWA01-CONSERVE-1: Shape A (RUNNING job) still defers via BCAFG01 path", async () => {
			// Pre-fix GREEN (existing BCAFG01): RUNNING job → defer.
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			expect(h.tracker.currentPhase).toBe("streaming")

			// Start a background job WITHOUT completing it — RUNNING.
			const start = await h.manager.start(
				{
					command: "sleep 60",
					cwd: process.cwd(),
					shell: "/bin/sh",
					env: { SHELL: "/bin/sh" },
					waitBudgetMs: 5,
					executionDeadlineMs: 60_000,
					maxOutputChars: 4096,
				},
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)
			if (start.state !== "running") throw new Error("expected running")
			expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

			await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

			// The phase must NOT be awaiting_followup while a job is RUNNING.
			expect(h.tracker.currentPhase).not.toBe("awaiting_followup")

			// Cleanup.
			await h.manager.cancel({ jobId: start.jobId })
			await h.manager.dispose()
		}, 15_000)

		it("LHOWA01-CONSERVE-2: Shape F (no outstanding work) still commits awaiting_followup", async () => {
			// Pre-fix GREEN (no outstanding work): genuine operator handoff.
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			expect(h.tracker.currentPhase).toBe("streaming")

			// No background job. No queued prompt. No notify markers.
			expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(false)
			expect(h.getPendingPromptCount()).toBe(0)
			expect(h.getActiveNotifyCount()).toBe(0)

			await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

			// Genuine operator handoff: awaiting_followup IS the correct
			// phase when nothing is outstanding.
			expect(h.tracker.currentPhase).toBe("awaiting_followup")
			await h.manager.dispose()
		}, 15_000)
	})

	describe("Discriminator — operator-demand signals", () => {
		it("LHOWA01-DISCRIM-1: wasErrorSeen() === true → error phase (NOT awaiting_followup)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.translatorState.setErrorSeen()

			await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
			expect(h.tracker.currentPhase).toBe("error")
			await h.manager.dispose()
		}, 15_000)

		it("LHOWA01-DISCRIM-2: wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn() → completed phase", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()

			await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
			expect(h.tracker.currentPhase).toBe("completed")
			await h.manager.dispose()
		}, 15_000)
	})
})
