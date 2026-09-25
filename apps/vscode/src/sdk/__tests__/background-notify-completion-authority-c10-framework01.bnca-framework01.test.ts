/**
 * ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01
 *
 * BNCA-FRAMEWORK-01: load-bearing GREEN test for the framework-level
 * C10 completion-commit barrier.
 *
 * The live defect (SHA-256 fe1b6bc7...4ae36, taskId=
 * 1790335441241_5g7oe): two `submit_and_exit` calls for one
 * notify-owned background job. The H1 advisory fix
 * (command_status returns `notification: "pending"`) is a
 * comment-only convention the model MAY ignore.
 *
 * The framework-level fix: at the C10 completion-commit seam
 * (`sdk-session-event-coordinator.ts:691-733`), the originating
 * turn's `setTurnPhase("completed", ...)` call is SUPPRESSED
 * when ANY notify-owned jobId launched by THIS turn has its wake
 * authority delivered to PendingPromptsController. The
 * wake-driven turn owns terminal completion for J in that case.
 *
 * This test exercises the full causal chain at the production
 * wire (real SdkSessionEventCoordinator + real
 * BackgroundNotifyCoordinator + real command_status tool + real
 * CommandJobManager):
 *
 *   1. originating turn launches notify-owned J
 *   2. originating turn calls command_status(J, waitMs>0)
 *      (H1 short-circuit: returns immediately, notification=pending)
 *   3. job exits; Path A listener calls consumeTerminal(J)
 *      (marker drained, wake enqueued into pendingPrompts)
 *   4. originating turn tries to commit completion (submit_and_exit)
 *   5. ASSERT: completion is SUPPRESSED (deferredCompletionBarrier
 *      set, completionCommitCount === 0) because the wake-driven
 *      turn owns terminal completion for J
 *   6. wake-driven turn eventually runs and commits its own
 *      completion (the canonical authority for that turn)
 *
 * The load-bearing assertion is `completionCommitCount() === 0`
 * at step 5: the framework REFUSES to commit completion because
 * the wake was delivered. This is the
 * `semantic_terminal_completion_count(J) == 1` invariant from the
 * live transcript — closed at the framework seam, NOT at a
 * comment-only advisory.
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
	const activeSessionId = "sess-bnca-framework01"
	const activeTaskId = "task-bnca-framework01"

	let completionCommitCount = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => {
			// Wake delivered to PendingPromptsController (mirror of
			// SdkController.ts:738 fire-and-forget send).
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
		wasWakeDelivered: (jobId: string) => notifyCoordinator.wasWakeDelivered(jobId),
		isWakeAuthoritySettled: (jobId: string) => notifyCoordinator.isWakeAuthoritySettled(jobId),
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

describe("ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 / BNCA-FRAMEWORK-01 (C10 framework enforcement)", () => {
	it("BNCA-FRAMEWORK-01a: notify-owned J + H1 short-circuit + wake delivered -> originating completion SUPPRESSED (wake-driven turn owns completion)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// Spawn a real background job and register the notify marker.
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
		// Per-turn ownership hint: the run_commands tool records
		// the launched jobId at the same seam as registerMarker.
		// The C10 barrier consults getLaunchedBackgroundJobIds.
		h.translatorState.recordLaunchedBackgroundJob(start.jobId)

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

		// Originating turn calls command_status(J, waitMs>0). H1
		// short-circuit: returns immediately with state=running +
		// notification=pending. Path B suppressed. Marker J preserved.
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

		// Wait for the job to exit AND the listener to call
		// consumeTerminal (Path A drains the marker and enqueues
		// the wake into PendingPromptsController).
		for (let i = 0; i < 60; i += 1) {
			if (h.manager.activeCount === 0) break
			await new Promise((r) => setTimeout(r, 100))
		}
		for (let i = 0; i < 50; i += 1) {
			if (!h.notifyCoordinator.hasActiveNotify(start.jobId)) break
			await new Promise((r) => setTimeout(r, 50))
		}
		expect(h.notifyCoordinator.hasActiveNotify(start.jobId)).toBe(false)
		expect(h.notifyCoordinator.wasWakeDelivered(start.jobId)).toBe(true)

		// Now the originating turn tries to commit completion
		// (submit_and_exit #1) — but the wake was DELIVERED so the
		// wake-driven turn owns terminal completion for J.
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

		// Load-bearing assertion: the originating turn's
		// completion commit is SUPPRESSED (deferredCompletionBarrier
		// is set, completionCommitCount === 0). The framework
		// refuses to commit completion because the wake-driven
		// turn owns terminal completion for J.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
		expect(h.coordinator.getDeferredCompletionBarrierForTesting()).toBeDefined()

		// Re-evaluation also MUST NOT release the barrier
		// (the wake was delivered; wake-driven turn owns completion).
		h.coordinator.reevaluateDeferredCompletionBarrier()
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 30_000)

	it("BNCA-FRAMEWORK-01b: notify-owned J + H1 short-circuit + wake DISCARDED -> originating completion ALLOWED (Path B won)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// Spawn a real background job.
		const start = await h.manager.start({
			command: "/bin/sh -c 'sleep 1; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		h.notifyCoordinator.registerMarker({
			jobId: start.jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.translatorState.recordLaunchedBackgroundJob(start.jobId)

		// H1 short-circuit: command_status returns immediately,
		// marker preserved.
		const statusTool = createCommandStatusTool(h.manager, {
			backgroundNotifyCoordinator: h.notifyCoordinator,
			resolveActiveOwner: () => ({ sessionId: h.activeSessionId, taskId: h.activeTaskId }),
		})
		const result = (await statusTool.execute(
			{ jobId: start.jobId, waitMs: 30_000 },
			{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
		)) as Array<Record<string, unknown>>
		expect(result[0].state).toBe("running")
		expect(h.notifyCoordinator.hasActiveNotify(start.jobId)).toBe(true)

		// Simulate Path B winning: marker drained WITHOUT a wake
		// being enqueued. The originating turn's command_status
		// is non-blocking (waitMs==0) AFTER Path A would have
		// fired; Path B drains the marker and the wake is
		// definitively NOT in flight.
		// Wait for the job to exit first.
		for (let i = 0; i < 60; i += 1) {
			if (h.manager.activeCount === 0) break
			await new Promise((r) => setTimeout(r, 100))
		}
		// Drive consumeTerminal then resolveObligation to drain
		// the marker (Path A fires first to deliver the wake, then
		// Path B would discard it). We bypass that flow by directly
		// draining via resolveObligation while marker is still
		// alive (Path A hasn't fired yet at this point — actually
		// it may have; the listener is async).
		//
		// For this test we exercise the settled-via-discard shape:
		// consumeTerminal fires (wake delivered), THEN
		// resolveObligation drains any duplicate. Since the wake
		// sink is a no-op, the discard returns "discarded" because
		// the wake is NOT in any queue.
		//
		// But actually consumeTerminal will mark wakeDelivered=true
		// which is the SUPPRESS case. To exercise the settled-via-
		// discard shape cleanly we need Path A to NOT enqueue
		// (e.g., containment_failed) OR Path B to drain before
		// Path A.
		//
		// The simplest deterministic shape: drain via
		// resolveObligation BEFORE Path A fires (the listener
		// hasn't run yet because terminalPromise.then is async).
		// Path B sees the marker, deletes it, marks
		// wakeAuthoritySettledJobIds because no wake was ever
		// enqueued.
		const decision = h.notifyCoordinator.resolveObligation({
			jobId: start.jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
			resolution: "canonical_status_observed",
		})
		expect(decision.kind).toBe("resolved")
		expect(h.notifyCoordinator.hasActiveNotify(start.jobId)).toBe(false)
		expect(h.notifyCoordinator.wasWakeDelivered(start.jobId)).toBe(false)
		expect(h.notifyCoordinator.isWakeAuthoritySettled(start.jobId)).toBe(true)

		// Now the originating turn tries to commit completion.
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

		// The originating turn's completion commit is ALLOWED
		// (Path B won — wake authority settled via marker drain,
		// no wake delivered). completionCommitCount === 1.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 30_000)

	it("BNCA-FRAMEWORK-01c: NO notify-owned jobs -> originating completion ALLOWED (unrelated path)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// No markers registered, no launchedBackgroundJobIds.
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

		// Completion commits normally — no notify-owned jobs to
		// gate on.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)
})
