/**
 * ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 / CORRECTION02
 *
 * PRODUCTION COMPOSITION RED + GREEN discriminator.
 *
 * Per seventy-ninth-pass Factory reviewer (CORRECTION02):
 *
 * > The direction is right, but the closure is NOT yet proven.
 * > The production implementation does not read live
 * > PendingPromptsController state at Q5. It reads:
 * >   lastKnownPendingPromptCountBySession.get(...) ?? 0
 * > and that cache is only refreshed from pendingPrompts("list")
 * > inside getStateToPostToWebview().
 *
 * > Your own evidence says that chronology is the defect. There
 * > is no executable proof that getStateToPostToWebview()
 * > necessarily runs between enqueue and Q5.
 *
 * The reviewer prescribed ONE bounded correction:
 *
 *   Do NOT derive orchestration authority from
 *   getStateToPostToWebview(). Give the Q5 seam a synchronous
 *   authoritative pending-work projection maintained at the queue
 *   mutation boundary.
 *
 * This test is the executable proof of that fix. The wire adapter is
 * the SAME shape as the production `SdkController.getPendingPromptCount`
 * (SdkController.ts:2143-2146):
 *
 *     getPendingPromptCount: (ownerSessionId) =>
 *         activeSession.sdkHost.pendingPromptsCount?.(ownerSessionId) ?? 0
 *
 * That adapter reaches `VscodeSessionHost.pendingPromptsCount` →
 * `ClineCore.getPendingPromptsCount` → `LocalRuntimeHost.getPendingPromptsCount`
 * → `session.pendingPrompts.length`. NO cache; the read is synchronous
 * at the call site.
 */
import { type CoreSessionEvent, type SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
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

let supervisorPid = 80000

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
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "started\nfinished\n", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
}

// Real pending-prompt queue. Mutates synchronously in push/pop;
// `length` is the authoritative count.
class TestPendingPromptQueue {
	private readonly items: { sessionId: string; prompt: string }[] = []
	enqueue(input: { sessionId: string; prompt: string }): void {
		this.items.push(input)
	}
	consume(sessionId: string): { sessionId: string; prompt: string } | undefined {
		const idx = this.items.findIndex((q) => q.sessionId === sessionId)
		if (idx < 0) return undefined
		const [item] = this.items.splice(idx, 1)
		return item
	}
	countForSession(sessionId: string | undefined): number {
		if (!sessionId) return 0
		return this.items.filter((q) => q.sessionId === sessionId).length
	}
	get length(): number {
		return this.items.length
	}
}

// Production-shape SdkSessionHost stub with synchronous authoritative
// pendingPrompts service accessor — mirrors VscodeSessionHost.pendingPrompts
// (the "count" action) which reaches ClineCore.pendingPrompts.count →
// LocalRuntimeHost.pendingPrompts.count → session.pendingPrompts.length.
//
// ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01 /
// CORRECTION01:
// The previous `pendingPromptsCount?(sessionId)` accessor on
// SdkSessionHost has been removed. The count accessor is reached
// through the canonical `pendingPrompts` service boundary (per the
// upstream architecture rule at ARCHITECTURE.md lines 454-460).
// The CORRECTION01 `count(...)` returns the new
// `PendingPromptCountRead` discriminated union: `{ available: true;
// count }` when authority is known (LocalRuntimeHost is always
// `available: true`), and `{ available: false }` otherwise.
function makeSdkHostWithPendingCount(queue: TestPendingPromptQueue) {
	return {
		pendingPrompts: (action: string, input: { sessionId: string } | undefined) => {
			if (action === "count") {
				// LocalRuntimeHost is unconditionally available: every
				// read produces `{ available: true; count }`.
				return {
					available: true,
					count: queue.countForSession(input?.sessionId),
				}
			}
			throw new Error(`Unhandled pendingPrompts action in test stub: ${action}`)
		},
	}
}

interface WireHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	notifyCoordinator: BackgroundNotifyCoordinator
	queue: TestPendingPromptQueue
	activeSessionId: string
	activeTaskId: string
}

function makeWireHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): WireHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-lhowa01-wire"
	const activeTaskId = opts.activeTaskId ?? "task-lhowa01-wire-live"

	const supervisor = fakeSupervisor({ pid: ++supervisorPid, pgid: ++supervisorPid })
	const manager = new CommandJobManager({ maxWaitBudgetMs: 50, spawnFactory: () => supervisor })

	const queue = new TestPendingPromptQueue()
	const sdkHost = makeSdkHostWithPendingCount(queue)

	let now = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) =>
			Promise.resolve(queue.enqueue({ sessionId, prompt })).then(() => ({ kind: "delivered" as const })),
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
		// PRODUCTION ADAPTER (mirrors SdkController.getPendingPromptCount
		// wired in production at SdkController.ts:2160-2166): the
		// authoritative count is read through the canonical `pendingPrompts`
		// service boundary (`pendingPrompts("count", { sessionId })`), NOT
		// through a `RuntimeHost` primitive.
		getPendingPromptCount: (ownerSessionId: string | undefined) =>
			sdkHost.pendingPrompts("count", { sessionId: ownerSessionId ?? "" }),
		getActiveNotifyCount: (ownerSessionId: string | undefined, taskId: string | undefined) =>
			notifyCoordinator.activeNotifyCountForOwner(ownerSessionId ?? "", taskId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	return { coordinator, tracker, translatorState, manager, notifyCoordinator, queue, activeSessionId, activeTaskId }
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

async function emitDoneWithoutCompletion(coordinator: SdkSessionEventCoordinator, sessionId: string): Promise<void> {
	const doneEvent = agentEvent(sessionId, {
		type: "done",
		reason: "completed",
		text: "Some text without commit.",
		iterations: 1,
	})
	await coordinator.handleSessionEvent(doneEvent)
}

async function startAndCompleteBackgroundJob(
	h: WireHarness,
	opts: { notifyOnCompletion?: boolean } = {},
): Promise<{ jobId: string }> {
	const start = await h.manager.start(
		{
			command: "sleep 0.05",
			cwd: process.cwd(),
			shell: "/bin/sh",
			env: { SHELL: "/bin/sh" },
			waitBudgetMs: 5,
			executionDeadlineMs: 60_000,
			maxOutputChars: 4096,
		},
		{ sessionId: h.activeSessionId, agentId: "test-agent", iteration: 1 },
	)
	if (start.state !== "running") {
		throw new Error(`expected state=running, got state=${start.state}`)
	}
	if (opts.notifyOnCompletion !== false) {
		h.notifyCoordinator.registerMarker({
			jobId: start.jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
	}
	await h.manager.cancel({ jobId: start.jobId })
	await start.terminalPromise
	h.notifyCoordinator.consumeTerminal({
		jobId: start.jobId,
		terminalState: "exited",
		exitCode: 0,
		reason: "natural",
		isContainmentFailed: false,
		outputTail: "started\nfinished\n",
	})
	return { jobId: start.jobId }
}

describe("ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 / CORRECTION02", () => {
	describe("LHOWA01-WIRE-01: synchronous authoritative adapter at Q5", () => {
		it("enqueue wake → done-without-completion (no cache refresh) → Q5 DEFERS", async () => {
			// THE discriminator test. The pending-prompt authority
			// reaches the Q5 writer through a synchronous
			// authoritative accessor — NOT through a cached projection
			// populated by getStateToPostToWebview.
			//
			// Pre-fix CORRECTION01 (cached) would observe
			//   pendingPromptCount = 0
			// because the cache had not been refreshed by the
			// getStateToPostToWebview() call between enqueue and Q5.
			// → awaiting_followup (RED — false positive).
			//
			// Post-fix CORRECTION02 (synchronous authoritative)
			// observes the live queue.length at the Q5 boundary,
			// independent of any webview-state-push interval.
			// → defer (GREEN — bounded repair works).

			const h = makeWireHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			expect(h.tracker.currentPhase).toBe("streaming")

			// T0: enqueue terminal wake. Mirrors the production
			//     BackgroundNotifyCoordinator.consumeTerminal path:
			//     enqueueTerminalWake({ sessionId, prompt }) →
			//     queue.push(...) synchronous.
			await startAndCompleteBackgroundJob(h, { notifyOnCompletion: true })

			// The wake has been pushed to the queue SYNCHRONOUSLY.
			// NO `getStateToPostToWebview` call between now and Q5.
			expect(h.queue.countForSession(h.activeSessionId)).toBe(1)

			// T2: emit done-without-completion.
			await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

			// GREEN ASSERTION: the Q5 writer DEFERS because the
			// synchronous authoritative accessor reads queue.length
			// directly at the call site (NOT from a cache).
			expect(h.tracker.currentPhase).not.toBe("awaiting_followup")
			expect(h.tracker.currentPhase).toBe("streaming")

			// T6: consume the queued prompt (mirrors the next turn
			// draining the queue).
			const consumed = h.queue.consume(h.activeSessionId)
			expect(consumed).toBeDefined()
			expect(h.queue.countForSession(h.activeSessionId)).toBe(0)

			// T7: re-evaluation. Now that the queue is empty,
			// BTCONT01's terminal-idle re-evaluation commits
			// awaiting_followup exactly once (genuine handoff).
			h.coordinator.reevaluateDeferredContinuation?.()
			expect(h.tracker.currentPhase).toBe("awaiting_followup")

			await h.manager.dispose()
		}, 15_000)

		it("no wake + done-without-completion → Q5 COMMITS awaiting_followup (Shape F)", async () => {
			// Conservation: when no outstanding autonomous work,
			// the Q5 seam commits awaiting_followup (genuine operator
			// handoff). Guards against an over-eager defer.

			const h = makeWireHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			expect(h.queue.countForSession(h.activeSessionId)).toBe(0)

			await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

			expect(h.tracker.currentPhase).toBe("awaiting_followup")
			await h.manager.dispose()
		}, 15_000)
	})
})
