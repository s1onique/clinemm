/**
 * ACT-CLINEMM-C10-FILTER-ABLATION01
 *
 * BASELINE characterization of current C10 message-layer
 * completion_result suppression behavior. Pins what the C10
 * message filter does TODAY so any ablation decision can be
 * compared against the current production contract.
 *
 * Two layers must be kept separate:
 *
 *   LAYER F — FRAMEWORK COMPLETION AUTHORITY (SEAM B)
 *     setTurnPhase("completed", ...) lifecycle seam.
 *     The newer BNCA repair. NOT under ablation. Must remain intact.
 *
 *   LAYER M — MESSAGE / PRESENTATION COMPLETION RESULT (SEAM A)
 *     `say: "completion_result"` row filtering at the
 *     appendAndEmit boundary. The older C10 mechanism under ablation.
 *
 * C10-BASELINE-01: notify-owned originating completion -> completion_result row FILTERED (current production contract).
 * C10-BASELINE-02: ordinary non-notify completion -> completion_result row VISIBLE (current production contract).
 * C10-BASELINE-03: wake-driven completion (no owned jobs in flight) -> completion_result row VISIBLE.
 */

import type { CoreSessionEvent, SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
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

let supervisorPid = 90000
function fakeSupervisor(): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: ++supervisorPid,
		pgid: supervisorPid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "started\nfinished\n", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
}

class TestPendingPromptQueue {
	private readonly items: { id: string; sessionId: string; prompt: string; jobId?: string }[] = []
	enqueue(input: { sessionId: string; prompt: string; jobId?: string }): string {
		const id = `pp-${this.items.length + 1}`
		this.items.push({
			id,
			sessionId: input.sessionId,
			prompt: input.prompt,
			...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
		})
		return id
	}
	countForSession(sessionId: string): number {
		return this.items.filter((q) => q.sessionId === sessionId).length
	}
}

function makeSdkHost(queue: TestPendingPromptQueue) {
	return {
		pendingPrompts: (action: string, input: { sessionId: string } | undefined) => {
			if (action === "count") {
				return { available: true as const, count: queue.countForSession(input?.sessionId ?? "") }
			}
			throw new Error(`Unhandled pendingPrompts action: ${action}`)
		},
	}
}

interface Harness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	notifyCoordinator: BackgroundNotifyCoordinator
	queue: TestPendingPromptQueue
	activeSessionId: string
	activeTaskId: string
	jobId: string
	appendAndEmit: ReturnType<typeof vi.fn>
	completionCommitCount: () => number
}

function makeHarness(): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-c10-baseline"
	const activeTaskId = "task-c10-baseline"
	const jobId = "cmd_c10_baseline"

	const supervisor = fakeSupervisor()
	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: () => supervisor,
	})

	const queue = new TestPendingPromptQueue()
	const sdkHost = makeSdkHost(queue)

	let now = 0
	let completionCommitCount = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: async ({ sessionId, prompt, jobId: jid }) => {
			queue.enqueue({ sessionId, prompt, ...(jid !== undefined ? { jobId: jid } : {}) })
			return { kind: "delivered" as const }
		},
		now: () => ++now,
	})

	const appendAndEmit = vi.fn()
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
		messages: { appendAndEmit },
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
		hasRunningBackgroundJobForOwner: () => manager.hasRunningBackgroundJobForOwner(activeSessionId),
		getPendingPromptCount: (ownerSessionId: string | undefined) =>
			sdkHost.pendingPrompts("count", { sessionId: ownerSessionId ?? "" }),
		getActiveNotifyCount: () => notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId),
		hasActiveNotify: (j: string) => notifyCoordinator.hasActiveNotify(j),
		wasWakeDelivered: (j: string) => notifyCoordinator.wasWakeDelivered(j),
		isWakeAuthoritySettled: (j: string) => notifyCoordinator.isWakeAuthoritySettled(j),
	} as never)

	return {
		coordinator,
		tracker,
		translatorState,
		manager,
		notifyCoordinator,
		queue,
		activeSessionId,
		activeTaskId,
		jobId,
		appendAndEmit,
		completionCommitCount: () => completionCommitCount,
	}
}

async function emitCompletionTurn(
	harness: Harness,
	params: {
		turnId: string
		resultText: string
		isRunningDuringTurn: boolean
	},
): Promise<void> {
	const coordinator = harness.coordinator as unknown as {
		options: { sessions: { getActiveSession: () => { isRunning: boolean } | undefined } }
	}
	coordinator.options.sessions.getActiveSession = () => ({
		sessionId: harness.activeSessionId,
		sdkHost: makeSdkHost(harness.queue),
		unsubscribe: vi.fn(),
		startResult: { sessionId: harness.activeSessionId },
		isRunning: params.isRunningDuringTurn,
	})

	// Drive content_start(content_end) for the completion tool so the
	// translator emits say:"completion_result" rows (the surface C10
	// filters).
	await harness.coordinator.handleSessionEvent({
		type: "agent_event",
		payload: {
			sessionId: harness.activeSessionId,
			event: {
				type: "content_start",
				contentType: "tool",
				toolName: "attempt_completion",
				toolCallId: `tc-${params.turnId}`,
				input: { result: params.resultText },
			},
		},
	} as unknown as CoreSessionEvent)

	await harness.coordinator.handleSessionEvent({
		type: "agent_event",
		payload: {
			sessionId: harness.activeSessionId,
			event: {
				type: "content_end",
				contentType: "tool",
				toolName: "attempt_completion",
				toolCallId: `tc-${params.turnId}`,
			},
		},
	} as unknown as CoreSessionEvent)

	await harness.coordinator.handleSessionEvent({
		type: "agent_event",
		payload: {
			sessionId: harness.activeSessionId,
			event: {
				type: "done",
				reason: "completed",
				text: params.resultText,
				iterations: 1,
			},
		},
	} as unknown as CoreSessionEvent)

	coordinator.options.sessions.getActiveSession = () => ({
		sessionId: harness.activeSessionId,
		sdkHost: makeSdkHost(harness.queue),
		unsubscribe: vi.fn(),
		startResult: { sessionId: harness.activeSessionId },
		isRunning: false,
	})
}

function collectCompletionRows(
	appendAndEmit: ReturnType<typeof vi.fn>,
): Array<{ text?: string; say?: string; ts?: number; partial?: boolean }> {
	const all = appendAndEmit.mock.calls.flatMap(
		(c) => c[0] as Array<{ text?: string; say?: string; ts?: number; partial?: boolean }>,
	)
	return all.filter((m) => m.say === "completion_result")
}

/**
 * Count VISIBLE completion rows (the final, non-partial row with the
 * completion box). The webview treats a partial+final pair with the
 * SAME ts as ONE visible row (in-place replacement). One completion
 * call → 1 visible row (the partial is replaced by the final).
 */
function countVisibleCompletionBoxes(appendAndEmit: ReturnType<typeof vi.fn>): {
	finalRows: number
	partialRows: number
	distinctTimestamps: number
} {
	const rows = collectCompletionRows(appendAndEmit)
	const final = rows.filter((r) => r.partial !== true)
	const partial = rows.filter((r) => r.partial === true)
	const distinctTs = new Set(rows.map((r) => r.ts))
	return {
		finalRows: final.length,
		partialRows: partial.length,
		distinctTimestamps: distinctTs.size,
	}
}

describe("ACT-CLINEMM-C10-FILTER-ABLATION01 / C10-BASELINE (current production contract)", () => {
	it("C10-BASELINE-01: notify-owned originating completion -> completion_result row FILTERED", async () => {
		const h = makeHarness()
		h.notifyCoordinator.registerMarker({
			jobId: h.jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.translatorState.recordLaunchedBackgroundJob(h.jobId)

		// Frame: explicit_user turn is RUNNING.
		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "Started command, will report back.",
			isRunningDuringTurn: true,
		})

		const completionRows = collectCompletionRows(h.appendAndEmit)
		const visible = countVisibleCompletionBoxes(h.appendAndEmit)
		// C10 message filter strips ALL completion_result rows
		// (partial + final) when an owned job is still outstanding.
		expect(completionRows).toHaveLength(0)
		expect(visible.finalRows).toBe(0)
		expect(visible.partialRows).toBe(0)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)

	it("C10-BASELINE-02: ordinary non-notify completion -> completion_result row VISIBLE", async () => {
		const h = makeHarness()

		// No notify marker, no launchedBackgroundJobIds.
		await emitCompletionTurn(h, {
			turnId: "plain",
			resultText: "Plain task done.",
			isRunningDuringTurn: false,
		})

		const completionRows = collectCompletionRows(h.appendAndEmit)
		expect(completionRows).toHaveLength(2) // partial + final
		const visible = countVisibleCompletionBoxes(h.appendAndEmit)
		expect(visible.finalRows).toBe(1)
		expect(visible.partialRows).toBe(1)
		expect(visible.distinctTimestamps).toBe(1) // same ts → 1 visible box
		expect(completionRows[1].text).toBe("Plain task done.")

		// Framework barrier ALLOWed: completionCommitCount === 1.
		expect(h.completionCommitCount()).toBe(1)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)

	it("C10-BASELINE-03: wake-driven completion (no owned jobs in flight) -> completion_result row VISIBLE", async () => {
		const h = makeHarness()

		// No notify marker, no launchedBackgroundJobIds. The wake-driven
		// turn is the canonical terminal authority for some other job
		// (the originating turn's job was already cleaned up by the time
		// the wake-driven turn runs). The C10 filter does NOT strip.
		await emitCompletionTurn(h, {
			turnId: "wake",
			resultText: "Terminal result from background command.",
			isRunningDuringTurn: false,
		})

		const completionRows = collectCompletionRows(h.appendAndEmit)
		expect(completionRows).toHaveLength(2) // partial + final
		const visible = countVisibleCompletionBoxes(h.appendAndEmit)
		expect(visible.finalRows).toBe(1)
		expect(visible.partialRows).toBe(1)
		expect(visible.distinctTimestamps).toBe(1)
		expect(completionRows[1].text).toBe("Terminal result from background command.")

		// Framework barrier ALLOWed (no outstanding work).
		expect(h.completionCommitCount()).toBe(1)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)
})
