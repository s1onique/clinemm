/**
 * ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 / TQCB01
 *
 * RED + GREEN tests for the completion-barrier over notify-enabled
 * background obligations. The defect is that submit_and_exit commits
 * task completion WITHOUT consulting whether completion-relevant
 * autonomous work has been resolved — leading to a duplicate
 * autonomous continuation when a queued wake reaches
 * PendingPromptsController after the task already committed.
 *
 * Production seams exercised:
 *   - BackgroundNotifyCoordinator (real production class)
 *   - SdkSessionEventCoordinator (real production class)
 *   - MessageTranslatorState (real production class)
 *   - TurnStateTracker (real production class)
 *   - MessageIdMinter (real production class)
 */

import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, type ResolveObligationDecision } from "../background-notify-coordinator"
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
	/**
	 * ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 /
	 * CORRECTION02: dual-delivery arbitration test seam. Remove
	 * the queued wake for `jobId` (by parsing the prompt's
	 * `Job: <jobId>` line). Mirrors the production
	 * `discardQueuedWakeForJobIdOnHost` logic for tests.
	 */
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

interface ProductionHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	notifyCoordinator: BackgroundNotifyCoordinator
	wakeSink: TestPendingPromptsSink
	activeSessionId: string
	activeTaskId: string
	completionCommitCount: () => number
	registerMarker: (jobId: string) => void
	resolveObligation: (jobId: string) => ResolveObligationDecision
	discardCalls: () => Array<{ sessionId: string; jobId: string }>
}

interface MakeHarnessOptions {
	activeSessionId?: string
	activeTaskId?: string
	/**
	 * TQCB01 P1-1 (fail-closed authority): when true, the harness
	 * simulates a pending-prompt transport that REPORTS its
	 * authority as UNAVAILABLE. The production PPAT01 invariant
	 * requires the deferral predicate to HOLD in this case. When
	 * undefined or false, the harness reports `available: true,
	 * count: 0` (the pre-ACT GREEN baseline).
	 */
	pendingPromptAuthorityAvailable?: boolean
	/**
	 * TQCB01 P1-2 (notify=false fire-and-forget): when true, the
	 * harness simulates an unrelated notify=false background
	 * job that is STILL RUNNING at re-evaluation time. The
	 * completion-barrier re-evaluation MUST NOT block on this
	 * job — only notify=true obligations are completion-
	 * relevant.
	 */
	simulateNotifyFalseSiblingRunning?: boolean
}

function makeHarness(opts: MakeHarnessOptions = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-tqcb01"
	const activeTaskId = opts.activeTaskId ?? "task-tqcb01-live"

	const wakeSink = new TestPendingPromptsSink()
	let now = 0
	// ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 /
	// CORRECTION02: dual-delivery arbitration test seam. Track
	// every discard call so RED tests can assert the host was
	// actually invoked when Path B supersedes Path A.
	const discardCalls: Array<{ sessionId: string; jobId: string }> = []
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) => wakeSink.enqueue({ sessionId, prompt }),
		discardQueuedWake: ({ sessionId, jobId }) => {
			discardCalls.push({ sessionId, jobId })
			const removed = wakeSink.discardByJobId(sessionId, jobId)
			return removed
				? { kind: "discarded", jobId, promptId: undefined }
				: { kind: "not_found", jobId }
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
		// TQCB01 P1-2: when simulating a notify=false sibling
		// RUNNING job, return true so we can prove the
		// completion-barrier re-evaluation does NOT consult
		// aggregate liveness (only the same predicate as
		// admission).
		hasRunningBackgroundJobForOwner: () => opts.simulateNotifyFalseSiblingRunning === true,
		// TQCB01 P1-1: pending-prompt authority availability
		// is fail-closed — when unavailable, completion must
		// be held. The harness returns a `PendingPromptCountRead`
		// shape (matching the production type) so the
		// availability-aware predicate can be exercised.
		getPendingPromptCount: opts.pendingPromptAuthorityAvailable === false
			? (() => ({ available: false as const }) as unknown as PendingPromptCountRead)
			: (() => ({ available: true as const, count: 0 }) as unknown as PendingPromptCountRead),
		getActiveNotifyCount: ((sessionId?: string, taskId?: string): number =>
			notifyCoordinator.activeNotifyCountForOwner(
				sessionId ?? activeSessionId,
				taskId ?? activeTaskId,
			)) as unknown as (sessionId: string | undefined, taskId: string | undefined) => number,
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
		discardCalls: () => discardCalls.slice(),
		registerMarker: (jobId: string) => {
			notifyCoordinator.registerMarker({
				jobId,
				sessionId: activeSessionId,
				taskId: activeTaskId,
			})
		},
		resolveObligation: (jobId: string) => {
			return notifyCoordinator.resolveObligation({
				jobId,
				sessionId: activeSessionId,
				taskId: activeTaskId,
				resolution: "canonical_status_observed",
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
describe("TQCB01 — completion barrier over notify-enabled background obligations", () => {
	describe("RED tests — premature completion", () => {
		it("TQCB-RED-01: unresolved running notify=true obligation blocks completion", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			expect(h.tracker.currentPhase).toBe("streaming")

			h.registerMarker("J-red01")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.completionCommitCount()).toBe(0)

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("TQCB-RED-02: direct command_status observation resolves obligation (LIVE bug discriminator)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("J-red02")

			h.resolveObligation("J-red02")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("TQCB-RED-03: two jobs partial resolution holds completion", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("A-red03")
			h.registerMarker("B-red03")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(2)

			h.resolveObligation("A-red03")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.completionCommitCount()).toBe(0)

			h.notifyCoordinator.consumeTerminal({
				jobId: "B-red03",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)
	})

	describe("Control tests — conservation and edge cases", () => {
		it("TQCB-CTL-01: notify=false does not block (no marker → no barrier)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})

			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		it("TQCB-CTL-03: terminal wake incorporation (Path A) resolves", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("J-ctl03")

			h.notifyCoordinator.consumeTerminal({
				jobId: "J-ctl03",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		// =====================================================================
		// TQCB01 P0 correction
		// (HALT_TQCB_PRODUCTION_COMPOSITION_INCOMPLETE):
		// the `command_status` tool drains the marker via the
		// production seam. NO manual `resolveObligation`
		// call inside the test body.
		// =====================================================================
		it("TQCB-COMPOSE-PATH-B-01: real command_status → marker resolution (production wiring)", async () => {
			const { CommandJobManager } = await import("../command-job-manager")
			const { createCommandStatusTool } = await import("../command-status-tool")
			const { createVscodeRunCommandsTool } = await import("../vscode-run-commands-tool")

			const manager = new CommandJobManager()
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			const resolveActiveOwner = () => ({ sessionId: h.activeSessionId, taskId: h.activeTaskId })

			// Spawn a real job via the production run_commands
			// tool with notify=true. Marker is registered by
			// the tool.
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
				{ commands: ["/bin/sh -c 'exit 0'"], notifyOnCompletion: true },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ result?: string }>
			const jobId = JSON.parse(runResult[0]?.result ?? "{}").jobId as string
			expect(jobId).toBeTruthy()
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)

			// Wait for terminal and Path A consumer.
			await manager.status({ jobId, waitMs: 5_000 })
			for (let i = 0; i < 100; i += 1) {
				if (manager.activeCount === 0) break
				await new Promise((r) => setTimeout(r, 50))
			}
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			// Completion commits cleanly (Path A drained the
			// marker).
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			// REAL Path B test: spawn a job via manager
			// directly (no auto-attach), register a marker
			// manually, wait for terminal, then invoke the
			// REAL command_status tool — Path B logic must
			// drain the marker.
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			const start2 = await manager.start({
				command: "/bin/sh -c 'exit 0'",
				waitBudgetMs: 5,
				executionDeadlineMs: 30_000,
				cwd: process.cwd(),
			})
			h.registerMarker(start2.jobId)
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)
			await manager.status({ jobId: start2.jobId, waitMs: 5_000 })
			for (let i = 0; i < 100; i += 1) {
				if (manager.activeCount === 0) break
				await new Promise((r) => setTimeout(r, 50))
			}
			const statusTool = createCommandStatusTool(manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner,
			})
			await statusTool.execute(
				{ jobId: start2.jobId, waitMs: 0 },
				{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
			)
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(2)

			h.notifyCoordinator.dispose()
			await manager.dispose()
		}, 30_000)

		// =====================================================================
		// TQCB01 P1-1 correction: pending-prompt authority
		// unavailable must FAIL CLOSED.
		// =====================================================================
		it("TQCB-CTL-AUTHORITY-UNKNOWN: pending prompt authority unavailable → completion MUST remain held", async () => {
			const h = makeHarness({ pendingPromptAuthorityAvailable: false })
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			// Pre-correction: completion would commit
			// (fail-open). Post-correction: completion MUST
			// be held (fail-closed).
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.completionCommitCount()).toBe(0)
			expect(h.coordinator.getDeferredCompletionBarrierForTesting()).toBeDefined()
			expect(h.coordinator.getDeferredCompletionBarrierForTesting()?.sessionId).toBe(h.activeSessionId)

			h.notifyCoordinator.dispose()
		}, 15_000)

		// =====================================================================
		// TQCB01 P1-2 correction: notify=false sibling job
		// (fire-and-forget) MUST NOT block completion.
		// =====================================================================
		it("TQCB-CTL-MIXED-FIRE-AND-FORGET: notify=true J resolved + notify=false D running → completion releases", async () => {
			const h = makeHarness({ simulateNotifyFalseSiblingRunning: true })
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("J-mixed")
			// Marker → held.
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.completionCommitCount()).toBe(0)
			expect(h.coordinator.getDeferredCompletionBarrierForTesting()).toBeDefined()

			// Resolve notify=true marker via Path A. The
			// notify=false sibling D is STILL RUNNING.
			h.notifyCoordinator.consumeTerminal({
				jobId: "J-mixed",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			// Terminal-idle re-eval: notify=false sibling
			// MUST NOT block.
			h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)
			expect(h.coordinator.getDeferredCompletionBarrierForTesting()).toBeUndefined()

			h.notifyCoordinator.dispose()
		}, 15_000)

		// =====================================================================
		// ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 /
		// CORRECTION02: dual-delivery arbitration (Path A vs Path B).
		//
		// The LIVE bug: when Path A (terminalPromise.then → consumeTerminal
		// → wake enqueued) and Path B (command_status → resolveObligation)
		// race to deliver the same terminal result, the marker layer is
		// first-writer-wins (correct) but the wake layer is NOT
		// arbitrated. The completion barrier commits COMPLETED on the
		// marker-drain signal, but a redundant wake is left in the queue
		// and starts a SECOND autonomous turn → second submit_and_exit →
		// second COMPLETED.
		//
		// Acceptance matrix (from Factory reviewer):
		//
		//   | command_status first, wake not yet enqueued → wake never
		//     becomes actionable
		//   | wake enqueued first, command_status second → queued wake
		//     becomes redundant and cannot start a turn
		//   | wake consumed first → continuation proceeds once; later
		//     status read harmless
		//   | notify=false → unaffected
		//   | two jobs A/B → arbitration is per jobId, never global
		// =====================================================================

		// TQCB-CTL-DUAL-1: command_status first, wake not yet enqueued.
		// Path B drains the marker; subsequent Path A consumeTerminal
		// returns no_marker (no wake enqueued). The completion barrier
		// commits COMPLETED on the first path; no duplicate wake exists.
		it("TQCB-CTL-DUAL-1: command_status first → Path A becomes no-op, no second wake", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("J-A")
			h.resolveObligation("J-A")
			expect(h.notifyCoordinator.activeNotifyCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)

			const decision = h.notifyCoordinator.consumeTerminal({
				jobId: "J-A",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(decision.kind).toBe("no_marker")
			expect(h.wakeSink.countForSession(h.activeSessionId)).toBe(0)
			expect(h.discardCalls()).toEqual([])

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		// TQCB-CTL-DUAL-2: wake enqueued first, command_status second.
		// Path A fires consumeTerminal and enqueues a wake. Path B then
		// fires resolveObligation: the coordinator detects the queued
		// wake for the same jobId and calls the discard seam to remove
		// it BEFORE runTurn can consume it. Completion commits ONCE.
		it("TQCB-CTL-DUAL-2: wake enqueued first → command_status discards queued wake", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("J-B")

			h.notifyCoordinator.consumeTerminal({
				jobId: "J-B",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(h.wakeSink.countForSession(h.activeSessionId)).toBe(1)
			expect(h.notifyCoordinator.diagnosticWakeEnqueuedJobIds()).toContain("J-B")

			const decision = h.resolveObligation("J-B")
			expect(decision.kind).toBe("resolved")

			const calls = h.discardCalls()
			expect(calls).toEqual([{ sessionId: h.activeSessionId, jobId: "J-B" }])
			expect(h.wakeSink.countForSession(h.activeSessionId)).toBe(0)
			expect(h.notifyCoordinator.diagnosticWakeEnqueuedJobIds()).not.toContain("J-B")

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		// TQCB-CTL-DUAL-3: command_status first, then a late wake that
		// races AFTER completion committed. The late wake must NOT
		// start a turn (the marker is gone, the tracker is empty, and
		// consumeTerminal returns no_marker).
		it("TQCB-CTL-DUAL-3: command_status first → late terminalPromise.then becomes no-op", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("J-C")

			h.resolveObligation("J-C")

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			const decision = h.notifyCoordinator.consumeTerminal({
				jobId: "J-C",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(decision.kind).toBe("no_marker")
			expect(h.wakeSink.countForSession(h.activeSessionId)).toBe(0)

			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		// TQCB-CTL-DUAL-4: two jobs A and B; arbitration is per-jobId,
		// never global. Path B for A must NOT discard B's wake, and
		// vice versa.
		it("TQCB-CTL-DUAL-4: two jobs → arbitration is per jobId, never global", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("J-A")
			h.registerMarker("J-B")

			h.notifyCoordinator.consumeTerminal({
				jobId: "J-A",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			h.notifyCoordinator.consumeTerminal({
				jobId: "J-B",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(h.wakeSink.countForSession(h.activeSessionId)).toBe(2)

			h.resolveObligation("J-A")

			const calls = h.discardCalls()
			expect(calls).toEqual([{ sessionId: h.activeSessionId, jobId: "J-A" }])

			expect(h.wakeSink.countForSession(h.activeSessionId)).toBe(1)
			const remaining = h.wakeSink.queued[0]
			expect(remaining).toBeDefined()
			expect(remaining?.prompt).toContain("Job: J-B")

			h.resolveObligation("J-B")
			expect(h.wakeSink.countForSession(h.activeSessionId)).toBe(0)

			expect(h.notifyCoordinator.diagnosticWakeEnqueuedJobIds()).toEqual([])

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		// TQCB-CTL-DUAL-5: notify=false jobs are unaffected by the
		// arbitration. A notify=false job never registers a marker, so
		// the dual-delivery tracker never observes it and no discard
		// is invoked.
		it("TQCB-CTL-DUAL-5: notify=false is unaffected — no marker, no wake, no discard", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			// Simulate notify=false: just call consumeTerminal
			// without ever registering a marker. consumeTerminal
			// will return no_marker and MUST NOT enqueue any wake.
			const decision = h.notifyCoordinator.consumeTerminal({
				jobId: "J-D-notifyfalse",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(decision.kind).toBe("no_marker")
			expect(h.wakeSink.countForSession(h.activeSessionId)).toBe(0)
			expect(h.discardCalls()).toEqual([])
			expect(h.notifyCoordinator.diagnosticWakeEnqueuedJobIds()).toEqual([])

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)

			h.notifyCoordinator.dispose()
		}, 15_000)

		// TQCB-CTL-DUAL-6: dispose clears the wake tracker
		// (EPHEMERAL_ONLY invariant).
		it("TQCB-CTL-DUAL-6: dispose clears wakeEnqueuedJobIds tracker", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.registerMarker("J-F")
			h.notifyCoordinator.consumeTerminal({
				jobId: "J-F",
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
			expect(h.notifyCoordinator.diagnosticWakeEnqueuedJobIds()).toContain("J-F")

			h.notifyCoordinator.dispose()
			expect(h.notifyCoordinator.diagnosticWakeEnqueuedJobIds()).toEqual([])
			expect(h.notifyCoordinator.diagnosticDisposed()).toBe(true)
		}, 15_000)
	})
})
