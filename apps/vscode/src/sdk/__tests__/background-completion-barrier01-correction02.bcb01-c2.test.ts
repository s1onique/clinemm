/**
 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION02 — BCB01-C2
 *
 * Repair target: the production consumer seam for non-notify terminal
 * observations. The CORRECTION01 producer-side repair added
 * `BackgroundNotifyCoordinator.recordNonNotifyTerminalObservation` at the
 * `vscode-run-commands-tool.ts:890` seam, and extended the C10 barrier
 * predicate to consult `unconsumedOwnedTerminalResultsForC10`. But no
 * production code path actually DRAINS the non-notify observation —
 * tests manually call `notifyCoordinator.consumeNonNotifyTerminalObservation`
 * from the harness, which masks the absence.
 *
 * The bounded fix: extend `command_status`'s existing Path B seam
 * (`command-status-tool.ts:240-261`) to ALSO call
 * `backgroundNotifyCoordinator.consumeNonNotifyTerminalObservation(...)`
 * when the snapshot's state is terminal AND there is no active notify
 * marker for the job. The act of returning the terminal result to the
 * agent IS the consumption event.
 *
 * Frozen invariant: real command_status on a terminal fire-and-forget
 * job MUST drain the observation exactly once, and the barrier MUST be
 * releasable on the next reevaluation.
 *
 * Tests:
 *  - BCB-21: command_status drains non-notify observation (notify-owned=false + state=terminal)
 *  - BCB-22: command_status does NOT drain when state=running
 *  - BCB-23: command_status idempotency — second call is no-op
 *  - BCB-24: command_status owner-mismatch — stale session cannot drain
 *  - BCB-25: REAL integration — real run_commands + real command_status → barrier releases → exactly 1 commit
 */

import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
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
	enqueue(input: { sessionId: string; prompt: string }): void {
		const id = `pending_test_${++this.nextId}`
		this.queued.push({ sessionId: input.sessionId, prompt: input.prompt, id })
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
	const activeSessionId = opts.activeSessionId ?? "session-bcb01-c2"
	const activeTaskId = opts.activeTaskId ?? "task-bcb01-c2"

	const wakeSink = new TestPendingPromptsSink()
	let now = 0
	const ownedJobs: { jobId: string; notify: boolean }[] = []

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) =>
			Promise.resolve(wakeSink.enqueue({ sessionId, prompt })).then(() => ({ kind: "delivered" as const })),
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => ++now,
		// ACT-CLINEMM-ELM-SEAM04: tests inject the legacy SEAM03
		// policy as the consumeTerminalAuthority stub so the
		// coordinator's effect interpreter is exercised without
		// loading the Elm kernel. Production wiring uses
		// `defaultElmAuthority`.
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
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
		// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01:
		// pending-prompt count is driven by the actual wakeSink queue
		// length, NOT hardcoded 0. Mirrors BCB01 harness wiring.
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
		// Authority bridge is wired only via the standard interface — no manual drains.
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

// ============================================================================
// BCB01-C2 — REAL consumer seam (production path, not harness manual drain)
// ============================================================================

describe("BCB01-C2 — CORRECTION02 — real production consumer seam", () => {
	describe("Unit — command_status Path B drains non-notify observations", () => {
		it("BCB-21: command_status on terminal notify=false job drains observation exactly once", async () => {
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

			const statusTool = createCommandStatusTool(manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner,
			})

			// 1. Launch notify=false job.
			const runResult = (await runTool.execute(
				{ commands: ["/bin/sh -c 'sleep 0.05; exit 0'"] /* notifyOnCompletion omitted → false */ },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()

			h.ownedJobs.push({ jobId, notify: false })

			// 2. Wait for terminal.
			await manager.status({ jobId, waitMs: 5_000 })
			for (let i = 0; i < 100; i += 1) {
				if (manager.activeCount === 0) break
				await new Promise((r) => setTimeout(r, 50))
			}
			expect(manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(false)

			// Production Path A seam already drained the running-jobs
			// aggregate (via CommandJobManager) AND registered the
			// non-notify terminal observation.
			const idx = h.ownedJobs.findIndex((j) => j.jobId === jobId)
			if (idx >= 0) h.ownedJobs.splice(idx, 1)

			// The non-notify terminal observation MUST be recorded.
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			// 3. Agent calls command_status (REAL production tool).
			const statusResult = (await statusTool.execute(
				{ jobId, waitMs: 0 },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(statusResult[0]?.ok).toBe(true)
			expect(statusResult[0]?.state).not.toBe("running")

			// 4. THE BOUNDED FIX: command_status Path B MUST drain the
			//    non-notify terminal observation. The act of returning
			//    the terminal result to the agent IS the consumption event.
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			// 5. Barrier can now release on next reevaluation.
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
			await manager.dispose()
		}, 30_000)

		it("BCB-22: command_status does NOT drain when state=running (no terminal fact delivered)", async () => {
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

			const statusTool = createCommandStatusTool(manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner,
			})

			// Launch a LONG-RUNNING notify=false job (sleep 5s).
			const runResult = (await runTool.execute(
				{ commands: ["/bin/sh -c 'sleep 5; exit 0'"] },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()

			h.ownedJobs.push({ jobId, notify: false })

			// command_status with waitMs=0 returns immediately with state=running.
			const statusResult = (await statusTool.execute(
				{ jobId, waitMs: 0 },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(statusResult[0]?.ok).toBe(true)
			expect(statusResult[0]?.state).toBe("running")

			// No terminal fact was delivered → no observation is drained.
			// (No observation was ever registered yet either, since the job
			// is still running.)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			// Barrier still holds (running job).
			expect(h.hasRunningBackgroundJobForOwner()).toBe(true)

			// Cleanup.
			h.notifyCoordinator.dispose()
			await manager.dispose()
		}, 30_000)

		it("BCB-23: command_status idempotency — second call on already-drained observation is a no-op", async () => {
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

			const statusTool = createCommandStatusTool(manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner,
			})

			const runResult = (await runTool.execute(
				{ commands: ["/bin/sh -c 'sleep 0.05; exit 0'"] },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()

			h.ownedJobs.push({ jobId, notify: false })

			await manager.status({ jobId, waitMs: 5_000 })
			for (let i = 0; i < 100; i += 1) {
				if (manager.activeCount === 0) break
				await new Promise((r) => setTimeout(r, 50))
			}

			const idx = h.ownedJobs.findIndex((j) => j.jobId === jobId)
			if (idx >= 0) h.ownedJobs.splice(idx, 1)

			// 1st command_status: drains the observation.
			await statusTool.execute({ jobId, waitMs: 0 }, { sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 })
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			// 2nd command_status: idempotent no-op (does not crash, does not
			// affect state, returns the terminal snapshot).
			const statusResult = (await statusTool.execute(
				{ jobId, waitMs: 0 },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(statusResult[0]?.ok).toBe(true)
			expect(statusResult[0]?.state).not.toBe("running")
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			h.notifyCoordinator.dispose()
			await manager.dispose()
		}, 30_000)

		it("BCB-24: command_status owner-mismatch — stale session cannot drain observation", async () => {
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

			const statusTool = createCommandStatusTool(manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner,
			})

			const runResult = (await runTool.execute(
				{ commands: ["/bin/sh -c 'sleep 0.05; exit 0'"] },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()

			h.ownedJobs.push({ jobId, notify: false })

			await manager.status({ jobId, waitMs: 5_000 })
			for (let i = 0; i < 100; i += 1) {
				if (manager.activeCount === 0) break
				await new Promise((r) => setTimeout(r, 50))
			}

			const idx = h.ownedJobs.findIndex((j) => j.jobId === jobId)
			if (idx >= 0) h.ownedJobs.splice(idx, 1)

			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			// Owner-mismatch scenario: imagine the active session
			// changes between observation recording and command_status
			// call. The `resolveActiveOwner` callback is the canonical
			// authority — if it returns a different sessionId than the
			// recording owner, the Path B drain MUST be skipped.
			//
			// We simulate this by temporarily swapping the
			// resolveActiveOwner callback. The original recording
			// owner is h.activeSessionId. The simulated new session is
			// "session-bcb01-c2-other".
			//
			// Since createCommandStatusTool captures resolveActiveOwner
			// by reference at execute time, we mutate the coordinator's
			// internal callback indirectly by re-creating the status
			// tool with a different resolver.
			const statusToolOther = createCommandStatusTool(manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner: () => ({ sessionId: "session-bcb01-c2-other", taskId: "task-other" }),
			})

			// First, the resolveActiveOwner-mismatch status call must
			// NOT drain the observation (since the new resolver
			// doesn't match the original recording owner).
			await statusToolOther.execute(
				{ jobId, waitMs: 0 },
				{ sessionId: "session-bcb01-c2-other", agentId: "test-agent", iteration: 1 },
			)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			// The owner-correct status call drains.
			await statusTool.execute({ jobId, waitMs: 0 }, { sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 })
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			h.notifyCoordinator.dispose()
			await manager.dispose()
		}, 30_000)

		it("BCB-25: REAL integration — run_commands + command_status → barrier releases → exactly 1 commit", async () => {
			// This test is the live-defect shape, exercised end-to-end
			// without ANY manual drain in the harness. Every consumer
			// call goes through real production code.
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

			const statusTool = createCommandStatusTool(manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner,
			})

			// Launch 4 fire-and-forget jobs.
			const jobIds: string[] = []
			for (let i = 0; i < 4; i += 1) {
				const runResult = (await runTool.execute(
					{ commands: [`/bin/sh -c 'sleep 0.${i + 1}; exit 0'`] },
					{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
				)) as Array<{ result?: string }>
				const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
				jobIds.push(jobId)
				h.ownedJobs.push({ jobId, notify: false })
			}

			// First submit_and_exit attempt: barrier holds (4 unconsumed).
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Wait for all jobs to terminal.
			for (const jobId of jobIds) {
				await manager.status({ jobId, waitMs: 5_000 })
			}
			for (let i = 0; i < 200; i += 1) {
				if (manager.activeCount === 0) break
				await new Promise((r) => setTimeout(r, 50))
			}
			expect(manager.activeCount).toBe(0)

			// All owned jobs drained from running aggregate.
			h.ownedJobs.length = 0

			// Producer-side: 4 non-notify terminal observations recorded.
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(4)

			// Second submit_and_exit attempt: still held (4 unconsumed).
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			// Agent observes all 4 via REAL command_status.
			for (const jobId of jobIds) {
				const r = (await statusTool.execute(
					{ jobId, waitMs: 0 },
					{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
				)) as Array<{ ok: boolean; state?: string }>
				expect(r[0]?.ok).toBe(true)
				expect(r[0]?.state).not.toBe("running")
			}

			// All 4 observations consumed.
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			// Third submit_and_exit attempt: barrier releases, exactly 1 commit.
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			h.notifyCoordinator.dispose()
			await manager.dispose()
		}, 60_000)
	})
})
