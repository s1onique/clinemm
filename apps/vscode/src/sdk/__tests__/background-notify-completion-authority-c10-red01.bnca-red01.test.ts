/**
 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01
 *
 * BNCA-RED-02: load-bearing framework-seam defect proof.
 *
 * The H1 advisory fix (`command_status` returns `notification:"pending"`)
 * is a comment-only convention. The model CAN still call
 * `submit_and_exit` claiming the notify-owned job's terminal result.
 * The persistent LIVE transcript (SHA-256 fe1b6bc7...4ae36,
 * taskId=1790335441241_5g7oe) proves the defect: TWO `submit_and_exit`
 * calls for ONE notify-owned jobId cmd_mugvhy92x7rm527e.
 *
 * This test pins the live defect at the C10 completion-commit seam
 * (sdk-session-event-coordinator.ts:691-733):
 *
 *   notify-owned J with active marker
 *     -> originating turn calls submit_and_exit
 *     -> framework MUST NOT commit task completion
 *     -> barrier MUST register a deferredCompletionBarrier marker
 *     -> completionCommitCount MUST remain 0
 *
 * The TRUE framework gap is: the originating turn calls
 * `command_status(J, waitMs>0)` AFTER Path A has drained the marker
 * (live transcript pattern) — the marker is GONE — the barrier
 * predicate `activeNotifyCount > 0` is 0 — completion commits —
 * THEN the wake-driven turn fires a second submit_and_exit.
 *
 * The H1 advisory tries to prevent this by returning state=running
 * for waitMs>0, but does NOT prevent the model from calling
 * `submit_and_exit` anyway.
 *
 * This test exercises the LIVE shape end-to-end at the C10 framework
 * seam (real SdkSessionEventCoordinator + real
 * BackgroundNotifyCoordinator + real command_status tool).
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
}

function makeHarness(): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "sess-bnca-c10-red"
	const activeTaskId = "task-bnca-c10-red"

	let completionCommitCount = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: async () => {
			// Wake sink: no-op for this test (Path A drained the
			// marker; the wake doesn't matter for the C10 assertion).

			return { kind: "delivered" as const }
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

describe("ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 / BNCA-RED-02 (C10 framework seam)", () => {
	it("BNCA-RED-02: notify-owned J + H1 short-circuit + immediate submit_and_exit -> framework MUST hold completion (marker J alive)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// Spawn a real background job and register the notify marker
		// (mirror run_commands(notifyOnCompletion=true) seam).
		const start = await h.manager.start({
			command: "/bin/sh -c 'sleep 1; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		expect(start.state).toBe("running")
		h.notifyCoordinator.registerMarker({
			jobId: start.jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		expect(h.notifyCoordinator.hasActiveNotify(start.jobId)).toBe(true)
		expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

		// Attach the per-job wake listener (mirror of vscode-run-commands-tool.ts:808).
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

		// Originating turn calls command_status(J, waitMs>0) BEFORE
		// the job exits. H1 short-circuit fires: returns immediately
		// with state=running + notification=pending. Path B is
		// suppressed. Marker J is preserved.
		const statusTool = createCommandStatusTool(h.manager, {
			backgroundNotifyCoordinator: h.notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: h.activeSessionId, taskId: h.activeTaskId }),
		})
		const result = (await statusTool.execute(
			{ jobId: start.jobId, waitMs: 30_000 },
			{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
		)) as Array<Record<string, unknown>>
		expect(result[0].state).toBe("running")
		expect(result[0].notification).toBe("pending")
		expect(h.notifyCoordinator.hasActiveNotify(start.jobId)).toBe(true)

		// Model IMMEDIATELY invokes submit_and_exit (the LIVE defect
		// pattern -- model misaligned with the H1 advisory).
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

		// Load-bearing assertion: framework MUST NOT have committed
		// completion while marker J is alive. The barrier predicate
		// `activeNotifyCount > 0` (TQCB01) IS > 0 here, so this
		// MUST hold. The H1 advisory doesn't change this.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")

		// Wait for the job to exit and Path A to drain the marker.
		for (let i = 0; i < 60; i += 1) {
			if (h.manager.activeCount === 0) break
			await new Promise((r) => setTimeout(r, 100))
		}
		// Allow async listener to call consumeTerminal.
		for (let i = 0; i < 50; i += 1) {
			if (!h.notifyCoordinator.hasActiveNotify(start.jobId)) break
			await new Promise((r) => setTimeout(r, 50))
		}
		expect(h.notifyCoordinator.hasActiveNotify(start.jobId)).toBe(false)

		// Now the barrier releases (deferredCompletionBarrier fires
		// via reevaluateDeferredCompletionBarrier).
		h.coordinator.reevaluateDeferredCompletionBarrier()
		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 30_000)
})
