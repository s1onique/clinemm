/**
 * ACT-CLINEMM-POST-CONSUMPTION-COMPLETION-AUTHORITY01 — PCCA01
 *
 * Repair target: the live P0
 *   HALT_POST_CONSUMPTION_COMPLETION_AUTHORITY
 *
 * Observed in session 1790582070333_vq1sf:
 *
 *   submit_and_exit #1
 *     → pending_prompt_enqueued
 *     → agent turn ends
 *     → pending_prompt_dequeued
 *     → continuation_scheduled
 *     → finalization run starts
 *     → command_status observes held job
 *     → submit_and_exit #2
 *     → agent turn ends
 *     → NO task_completion_committed
 *     → UI remains Working / Cancel
 *
 * Uploaded counters proved the continuation path itself executed:
 *
 *   pending_prompt_enqueued   = 1
 *   pending_prompt_dequeued   = 1
 *   continuation_scheduled    = 1
 *   submit_and_exit_seen      = 2
 *   task_completion_committed = 0
 *
 * Frozen expected shape after the fix:
 *
 *   initial submit → held (BCB barrier holds; deferred marker set)
 *   command_status(J) returns terminal result AND drains observation
 *   second submit → one commit (task_completion_committed = 1)
 *
 * Root cause: at `apps/vscode/src/sdk/command-status-tool.ts:240-246` the
 * Path B / Path C drain block carries a guard
 *
 *   snap.state !== "running" &&
 *   snap.state !== "containment_failed"
 *
 * The `containment_failed` exclusion was inherited from the Path A wake
 * consumer comment (a notify=true wake has no listener for
 * containment_failed jobs, so Path B skip makes sense there). But the
 * `vscode-run-commands-tool.ts:892-912` non-notify record path registers
 * the observation UNCONDITIONALLY for every terminal state, including
 * containment_failed. The `command_status` Path C drain was meant to be
 * the production consumer for these observations; the inherited guard
 * skips the drain for containment_failed, leaving the observation
 * registered with the BackgroundNotifyCoordinator indefinitely. The
 * BCB barrier (SEAM B in sdk-session-event-coordinator.ts) holds on
 * `unconsumedOwnedTerminalResultsForC10 > 0` and the second submit
 * therefore never commits.
 *
 * The fix is a single bounded removal of `containment_failed` from the
 * consumer guard for the **non-notify observation** path (Path C). Path
 * B (the notify=true resolveObligation call) keeps the guard intact
 * because the wake consumer remains the load-bearing authority for
 * notify=true containment_failed jobs.
 *
 * Tests:
 *   - PCCA-01: containment_failed notify=false job — command_status MUST
 *     drain the non-notify observation; second submit MUST commit.
 *   - PCCA-02: containment_failed notify=true job — command_status MUST
 *     NOT call resolveObligation (wake owns authority); the BCB barrier
 *     remains held (conservation).
 *   - PCCA-03: containment_failed non-notify idempotency — second call
 *     is a no-op (conservation).
 *   - PCCA-05: full chronology with real `command_status` →
 *     submit_and_exit_seen=2 and task_completion_committed=1.
 */

import { type CoreSessionEvent, type SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { createCommandStatusTool } from "../command-status-tool"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
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
	enqueue(input: { sessionId: string; prompt: string }): QueuedPrompt {
		const id = `pending_test_${++this.nextId}`
		const queued = { sessionId: input.sessionId, prompt: input.prompt, id }
		this.queued.push(queued)
		return queued
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
	ownedJobs: { jobId: string; notify: boolean }[]
	hasRunningBackgroundJobForOwner: () => boolean
}

function makeHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-pcca01"
	const activeTaskId = opts.activeTaskId ?? "task-pcca01"

	const wakeSink = new TestPendingPromptsSink()
	let now = 0
	const ownedJobs: { jobId: string; notify: boolean }[] = []

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) =>
			Promise.resolve(wakeSink.enqueue({ sessionId, prompt })).then(() => ({ kind: "delivered" as const })),
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
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
		pendingPromptsController: {
			enqueue: ({ sessionId, prompt }: { sessionId: string; prompt: string }) => {
				wakeSink.enqueue({ sessionId, prompt })
				return { id: "fake" }
			},
			getPendingPromptCountRead: () => wakeSink.queued.length,
			hasPendingPrompts: () => wakeSink.countForSession(activeSessionId) > 0,
			discardByPredicate: () => true,
		},
		pendingPromptAuthorityAvailable: true,
		getPendingPromptCount: () =>
			({
				available: true as const,
				count: wakeSink.queued.length,
			}) as unknown as { available: true; count: number },
		getActiveNotifyCount: ((sessionId?: string, taskId?: string): number =>
			notifyCoordinator.activeNotifyCountForOwner(sessionId ?? activeSessionId, taskId ?? activeTaskId)) as unknown as (
			sessionId: string | undefined,
			taskId: string | undefined,
		) => number,
		hasRunningBackgroundJobForOwner: () => ownedJobs.length > 0,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, activeTaskId)
		},
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
		ownedJobs: ownedJobs as { jobId: string; notify: boolean }[],
		hasRunningBackgroundJobForOwner: () => ownedJobs.length > 0,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: { sessionId, event: event as never },
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

function makeContainmentFailedSupervisor(pid: number, pgid: number): SupervisableShellProcess {
	let exitResolve: ((v: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | null = null
	const exit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((r) => {
		exitResolve = r
	})
	return {
		pid,
		pgid,
		exit,
		killTree: async () => {},
		terminateTree: async () => {
			setImmediate(() => {
				exitResolve?.({ exitCode: null, signal: "SIGKILL" })
			})
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	} as unknown as SupervisableShellProcess
}
// =============================================================================
// PCCA01 — POST-CONSUMPTION COMPLETION AUTHORITY
// =============================================================================

describe("PCCA01 — POST-CONSUMPTION COMPLETION AUTHORITY", () => {
	it("PCCA-01: containment_failed notify=false — command_status drains observation; second submit commits", async () => {
		const manager = new CommandJobManager({
			spawnFactory: () => makeContainmentFailedSupervisor(81001, 81001),
			terminalPostconditionProbe: () => "alive",
		})
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

		const statusTool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: h.notifyCoordinator,
			resolveActiveOwner,
		})

		try {
			const runResult = (await runTool.execute(
				{ commands: ["/bin/sh -c 'sleep 60'"] },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()
			h.ownedJobs.push({ jobId, notify: false })

			const cancelResult = await manager.cancel({ jobId })
			expect(cancelResult.ok).toBe(true)

			for (let i = 0; i < 200; i += 1) {
				const status = await manager.status({ jobId, waitMs: 0 })
				if (status.ok && status.snapshot.state !== "running") break
				await new Promise((r) => setTimeout(r, 25))
			}
			const terminalStatus = await manager.status({ jobId, waitMs: 0 })
			expect(terminalStatus.ok).toBe(true)
			if (terminalStatus.ok) {
				expect(terminalStatus.snapshot.state).toBe("containment_failed")
			}

			const idx = h.ownedJobs.findIndex((j) => j.jobId === jobId)
			if (idx >= 0) h.ownedJobs.splice(idx, 1)

			await h.coordinator.reevaluateDeferredCompletionBarrier()

			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)
			expect(h.completionCommitCount()).toBe(0)

			const statusResult = (await statusTool.execute(
				{ jobId, waitMs: 0 },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(statusResult[0]?.ok).toBe(true)
			expect(statusResult[0]?.state).toBe("containment_failed")

			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		} finally {
			h.notifyCoordinator.dispose()
			await manager.dispose()
		}
	}, 30_000)
	it("PCCA-02: containment_failed notify=true — command_status does NOT call resolveObligation (wake owns authority)", async () => {
		const manager = new CommandJobManager({
			spawnFactory: () => makeContainmentFailedSupervisor(81002, 81002),
			terminalPostconditionProbe: () => "alive",
		})
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

		const statusTool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: h.notifyCoordinator,
			resolveActiveOwner,
		})

		try {
			const runResult = (await runTool.execute(
				{ commands: ["/bin/sh -c 'sleep 60'"], notifyOnCompletion: true },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()
			h.ownedJobs.push({ jobId, notify: true })

			await manager.cancel({ jobId })
			for (let i = 0; i < 200; i += 1) {
				const status = await manager.status({ jobId, waitMs: 0 })
				if (status.ok && status.snapshot.state !== "running") break
				await new Promise((r) => setTimeout(r, 25))
			}
			const terminalStatus = await manager.status({ jobId, waitMs: 0 })
			expect(terminalStatus.ok).toBe(true)
			if (terminalStatus.ok) {
				expect(terminalStatus.snapshot.state).toBe("containment_failed")
			}

			const idx = h.ownedJobs.findIndex((j) => j.jobId === jobId)
			if (idx >= 0) h.ownedJobs.splice(idx, 1)

			const statusResult = (await statusTool.execute(
				{ jobId, waitMs: 0 },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string; notification?: string }>
			expect(statusResult[0]?.ok).toBe(true)
			expect(statusResult[0]?.state).toBe("containment_failed")

			expect(h.completionCommitCount()).toBe(0)
		} finally {
			h.notifyCoordinator.dispose()
			await manager.dispose()
		}
	}, 30_000)
	it("PCCA-03: containment_failed non-notify idempotency — second command_status is a no-op", async () => {
		const manager = new CommandJobManager({
			spawnFactory: () => makeContainmentFailedSupervisor(81003, 81003),
			terminalPostconditionProbe: () => "alive",
		})
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

		const statusTool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: h.notifyCoordinator,
			resolveActiveOwner,
		})

		try {
			const runResult = (await runTool.execute(
				{ commands: ["/bin/sh -c 'sleep 60'"] },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()
			h.ownedJobs.push({ jobId, notify: false })

			await manager.cancel({ jobId })
			for (let i = 0; i < 200; i += 1) {
				const status = await manager.status({ jobId, waitMs: 0 })
				if (status.ok && status.snapshot.state !== "running") break
				await new Promise((r) => setTimeout(r, 25))
			}

			const idx = h.ownedJobs.findIndex((j) => j.jobId === jobId)
			if (idx >= 0) h.ownedJobs.splice(idx, 1)

			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			await statusTool.execute({ jobId, waitMs: 0 }, { sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 })
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			const second = (await statusTool.execute(
				{ jobId, waitMs: 0 },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(second[0]?.ok).toBe(true)
			expect(second[0]?.state).toBe("containment_failed")
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)
		} finally {
			h.notifyCoordinator.dispose()
			await manager.dispose()
		}
	}, 30_000)
	it("PCCA-05: full chronology — submit_and_exit_seen=2 and task_completion_committed=1", async () => {
		const manager = new CommandJobManager({
			spawnFactory: () => makeContainmentFailedSupervisor(81004, 81004),
			terminalPostconditionProbe: () => "alive",
		})
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

		const statusTool = createCommandStatusTool(manager, {
			backgroundNotifyCoordinator: h.notifyCoordinator,
			resolveActiveOwner,
		})

		try {
			const runResult = (await runTool.execute(
				{ commands: ["/bin/sh -c 'sleep 60'"] },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()
			h.ownedJobs.push({ jobId, notify: false })

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			await manager.cancel({ jobId })
			for (let i = 0; i < 200; i += 1) {
				const status = await manager.status({ jobId, waitMs: 0 })
				if (status.ok && status.snapshot.state !== "running") break
				await new Promise((r) => setTimeout(r, 25))
			}

			const idx = h.ownedJobs.findIndex((j) => j.jobId === jobId)
			if (idx >= 0) h.ownedJobs.splice(idx, 1)

			await h.coordinator.reevaluateDeferredCompletionBarrier()

			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)
			expect(h.completionCommitCount()).toBe(0)

			await statusTool.execute({ jobId, waitMs: 0 }, { sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 })
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		} finally {
			h.notifyCoordinator.dispose()
			await manager.dispose()
		}
	}, 30_000)
})
