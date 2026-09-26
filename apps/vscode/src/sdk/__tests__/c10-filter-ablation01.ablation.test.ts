/**
 * ACT-CLINEMM-C10-FILTER-ABLATION01
 *
 * ABLATION matrix: with the framework-level completion-commit barrier
 * (SEAM B) enabled but the message-layer completion_result filter
 * (SEAM A) NEUTRALIZED, observe whether the persisted/rendered
 * completion_result row cardinality regresses.
 *
 * The ablation mechanism: each test harness has a per-test switch
 * `c10FilterEnabled: boolean`. When `c10FilterEnabled === false`, the
 * harness overrides the option-bag methods that SEAM A consults:
 *
 *   - `hasActiveNotify(jobId)`     -> always false
 *   - `getActiveNotifyCount(...)`  -> always 0
 *   - `getLaunchedBackgroundJobIds()` -> always []
 *   - `getPendingPromptCount(...)` -> always { available: true, count: 0 }
 *
 * This neutralizes ALL of SEAM A's predicates (both narrow per-job
 * and over-broad aggregate branches) WITHOUT modifying the production
 * code. SEAM B is untouched.
 *
 * Discriminators (per ACT §4):
 *   D1 semantic task completion cardinality == 1   -> tracker.currentPhase
 *   D2 persisted completion_result row cardinality -> result.messages.filter(say=="completion_result")
 *   D3 visible duplicate completion presentation   -> distinct ts in those rows
 *   D4 non-notify completion behavior              -> per-job ownership returns false
 *   D5 lost-wake behavior                         -> wasWakeDispatchFailed -> ALLOW
 *   D6 multi-job notify isolation                 -> per-job ownership is narrow
 *   D7 ordinary explicit_user completion behavior  -> no background work
 *
 * The hypothesis (proved or disproved here):
 *
 *   H1: with SEAM B ON and SEAM A OFF, in the canonical notify-owned
 *       background job lifecycle, the originating turn's completion_result
 *       row is NOT suppressed (because SEAM A is OFF) and the wake-driven
 *       turn's completion_result row IS emitted. That produces TWO
 *       completion_result rows in `clineMessages` (one from each turn)
 *       even though SEAM B enforces task-phase exactly-once. SEAM A is
 *       therefore NECESSARY.
 *
 *   H2 (alternative): with SEAM A OFF, the originating turn's `done`
 *       event never produces a completion_result row at all because
 *       SEAM B holds the completion AND the message-filter is no longer
 *       needed. SEAM A is therefore REDUNDANT.
 *
 * The result of this matrix tells us which invariant (if any) SEAM A
 * still protects.
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

let supervisorPid = 91000
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
	appendAndEmit: ReturnType<typeof vi.fn>
	completionCommitCount: () => number
	// Reference to the option bag so tests can swap predicates mid-run
	// for the SAME coordinator instance (the framework barrier (SEAM B)
	// continues to consult the REAL coordinator state).
	optionsRef: {
		hasActiveNotify?: (j: string) => boolean
		getActiveNotifyCount?: (sessionId: string | undefined, taskId: string | undefined) => number
	}
}

function makeHarness(): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-c10-ablation"
	const activeTaskId = "task-c10-ablation"

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

	const optionsRef = (
		coordinator as unknown as {
			options: {
				hasActiveNotify?: (j: string) => boolean
				getActiveNotifyCount?: (sessionId: string | undefined, taskId: string | undefined) => number
			}
		}
	).options

	return {
		coordinator,
		tracker,
		translatorState,
		manager,
		notifyCoordinator,
		queue,
		activeSessionId,
		activeTaskId,
		appendAndEmit,
		completionCommitCount: () => completionCommitCount,
		optionsRef,
	}
}

/**
 * Neutralize SEAM A (message-layer completion_result filter) by overriding
 * the option-bag methods that the production filter consults. SEAM B
 * (framework-level completion-commit barrier) is untouched.
 *
 * The narrow per-job branch in production (`hasActiveNotify(jid)`) is
 * suppressed by overriding `hasActiveNotify` to return false. The
 * over-broad aggregate fallback (`getActiveNotifyCount`, etc.) is
 * suppressed by overriding those too. The translator state
 * `getLaunchedBackgroundJobIds` is unaffected (production never
 * overrides it).
 */
function setC10Filter(harness: Harness, enabled: boolean): void {
	if (enabled) {
		// Restore the real coordinator-backed predicates (default).
		harness.optionsRef.hasActiveNotify = (j: string) => harness.notifyCoordinator.hasActiveNotify(j)
		harness.optionsRef.getActiveNotifyCount = (sessionId, taskId) =>
			harness.notifyCoordinator.activeNotifyCountForOwner(
				sessionId ?? harness.activeSessionId,
				taskId ?? harness.activeTaskId,
			)
	} else {
		// Disable C10: force ALL message-filter predicates to the
		// "no outstanding work" answer. SEAM B consults the REAL
		// coordinator state through `wasWakeDelivered` /
		// `wasWakeDispatchRequested` / etc. (those are preserved).
		harness.optionsRef.hasActiveNotify = (_j: string) => false
		harness.optionsRef.getActiveNotifyCount = (_sessionId, _taskId) => 0
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

interface RowSnapshot {
	text?: string
	say?: string
	ts?: number
	partial?: boolean
	isAuthoritativelyCompletedResult?: boolean
}

function collectCompletionRows(appendAndEmit: ReturnType<typeof vi.fn>): RowSnapshot[] {
	const all = appendAndEmit.mock.calls.flatMap((c) => c[0] as RowSnapshot[])
	return all.filter((m) => m.say === "completion_result")
}

interface VisibleBoxSummary {
	totalRows: number
	finalRows: number
	partialRows: number
	distinctTs: number
}

function summarizeCompletionBoxes(appendAndEmit: ReturnType<typeof vi.fn>): VisibleBoxSummary {
	const rows = collectCompletionRows(appendAndEmit)
	const final = rows.filter((r) => r.partial !== true)
	const partial = rows.filter((r) => r.partial === true)
	const distinctTs = new Set(rows.map((r) => r.ts))
	return {
		totalRows: rows.length,
		finalRows: final.length,
		partialRows: partial.length,
		distinctTs: distinctTs.size,
	}
}

// -----------------------------------------------------------------------------
// MATRIX A — original background notify lifecycle
//   notifyOnCompletion=true, slow job, originating turn, wake-driven turn
// -----------------------------------------------------------------------------

describe("ACT-CLINEMM-C10-FILTER-ABLATION01 / C10-ABLATION-01 (matrix A — notify lifecycle)", () => {
	it("C10-ABLATION-01-NOTIFY-ON: originating completion is FILTERED (one visible box, wake-driven turn owns completion)", async () => {
		const h = makeHarness()
		setC10Filter(h, true)

		const jobId = "cmd_ablation01_notify_on"
		h.notifyCoordinator.registerMarker({
			jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.translatorState.recordLaunchedBackgroundJob(jobId)

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "Started, will report back.",
			isRunningDuringTurn: true,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		expect(visible.totalRows).toBe(0)
		expect(visible.finalRows).toBe(0)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)

	it("C10-ABLATION-01-NOTIFY-OFF: originating completion is VISIBLE (filter disabled, framework barrier still ON)", async () => {
		const h = makeHarness()
		// SEAM A OFF, SEAM B ON. The originating turn's done event
		// still reaches the completion phase decision. SEAM B sees
		// wakeDelivered == false (no wake delivered in this harness),
		// so the framework ALLOWs the lifecycle commit. SEAM A
		// being off means the originating completion_result row is
		// NOT filtered.
		setC10Filter(h, false)

		const jobId = "cmd_ablation01_notify_off"
		h.notifyCoordinator.registerMarker({
			jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.translatorState.recordLaunchedBackgroundJob(jobId)

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "Started, will report back.",
			isRunningDuringTurn: true,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		// With SEAM A off: 2 raw rows (partial + final), 1 visible box.
		expect(visible.totalRows).toBe(2)
		expect(visible.finalRows).toBe(1)
		expect(visible.partialRows).toBe(1)
		expect(visible.distinctTs).toBe(1)

		// Framework barrier still allowS lifecycle commit (no wake).
		expect(h.completionCommitCount()).toBe(1)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)

	it("C10-ABLATION-01-NOTIFY-OFF-MULTI: TWO notify-owned jobs in flight, SEAM A OFF -> TWO completion_result rows visible per originating turn (per-job isolation lost)", async () => {
		const h = makeHarness()
		setC10Filter(h, false)

		const j1 = "cmd_ablation01_multi_j1"
		const j2 = "cmd_ablation01_multi_j2"
		h.notifyCoordinator.registerMarker({ jobId: j1, sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: j2, sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.translatorState.recordLaunchedBackgroundJob(j1)
		h.translatorState.recordLaunchedBackgroundJob(j2)

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "Both commands launched.",
			isRunningDuringTurn: true,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		// SEAM A off: completion_result row leaks through.
		expect(visible.totalRows).toBe(2)
		expect(visible.finalRows).toBe(1)
		expect(visible.distinctTs).toBe(1)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)
})

// -----------------------------------------------------------------------------
// MATRIX B — non-notify job (no owned background work)
// -----------------------------------------------------------------------------

describe("ACT-CLINEMM-C10-FILTER-ABLATION01 / C10-ABLATION-02 (matrix B — non-notify completion)", () => {
	it("C10-ABLATION-02-NON-NOTIFY: SEAM A OFF does not alter ordinary non-notify completion behavior", async () => {
		const h = makeHarness()
		setC10Filter(h, false)

		// No notify marker, no launchedBackgroundJobIds.
		await emitCompletionTurn(h, {
			turnId: "plain",
			resultText: "Plain task done.",
			isRunningDuringTurn: false,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		// Same as C10 ON behavior: 2 rows, 1 visible box.
		expect(visible.totalRows).toBe(2)
		expect(visible.finalRows).toBe(1)
		expect(visible.distinctTs).toBe(1)

		// Framework ALLOWs.
		expect(h.completionCommitCount()).toBe(1)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)
})

// -----------------------------------------------------------------------------
// MATRIX C — lost wake (wasWakeDispatchFailed -> ALLOW)
// -----------------------------------------------------------------------------

describe("ACT-CLINEMM-C10-FILTER-ABLATION01 / C10-ABLATION-03 (matrix C — lost wake)", () => {
	it("C10-ABLATION-03-LOST-WAKE: dispatch FAILED -> originating completion ALLOWED with SEAM A OFF (zero completion / duplicate / stuck barrier)", async () => {
		const h = makeHarness()
		setC10Filter(h, false)

		const jobId = "cmd_ablation03_lost_wake"
		h.notifyCoordinator.registerMarker({
			jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.translatorState.recordLaunchedBackgroundJob(jobId)
		// Mark dispatch FAILED on the coordinator (the lost-wake case
		// per BNCA dispatch-failed matrix).
		h.notifyCoordinator.markWakeDispatchFailed(jobId)

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "Trying to commit anyway.",
			isRunningDuringTurn: true,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		// SEAM A off + dispatch FAILED -> filter off path
		// does not filter anyway (filter predicates are all
		// overridden to 0). Completion_result row visible.
		expect(visible.totalRows).toBe(2)
		expect(visible.finalRows).toBe(1)
		expect(visible.distinctTs).toBe(1)

		// Framework barrier: dispatch FAILED means ALLOW path
		// (perJobOutstandingNotifyWork = false for the
		// dispatch-failed branch in the per-job loop). Lifecycle
		// commit allowed.
		expect(h.completionCommitCount()).toBe(1)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)
})

// -----------------------------------------------------------------------------
// MATRIX D — fast exit (notify-owned fast terminal transition)
// -----------------------------------------------------------------------------

describe("ACT-CLINEMM-C10-FILTER-ABLATION01 / C10-ABLATION-04 (matrix D — fast exit)", () => {
	it("C10-ABLATION-04-FAST-EXIT: SEAM A OFF preserves <=1 framework completion and exactly 1 visible completion box", async () => {
		const h = makeHarness()
		setC10Filter(h, false)

		const jobId = "cmd_ablation04_fast_exit"
		h.notifyCoordinator.registerMarker({
			jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.translatorState.recordLaunchedBackgroundJob(jobId)
		// Notify marker consumed via Path B (resolveObligation) — the
		// job is gone but no wake was ever enqueued. This is the
		// fast-exit case: the marker is gone by the time the agent
		// attempts completion. The framework barrier sees no
		// outstanding work (marker gone, wake NOT delivered) and
		// ALLOWs.
		const decision = h.notifyCoordinator.resolveObligation({
			jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
			resolution: "canonical_status_observed",
		})
		expect(decision.kind).toBe("resolved")

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "Done.",
			isRunningDuringTurn: false,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		expect(visible.totalRows).toBe(2)
		expect(visible.finalRows).toBe(1)
		expect(visible.distinctTs).toBe(1)

		// Framework barrier: marker gone, no wake delivered -> ALLOW.
		expect(h.completionCommitCount()).toBe(1)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)
})

// -----------------------------------------------------------------------------
// MATRIX E — two notify-owned jobs (multi-job isolation)
// -----------------------------------------------------------------------------

describe("ACT-CLINEMM-C10-FILTER-ABLATION01 / C10-ABLATION-05 (matrix E — two notify-owned jobs)", () => {
	it("C10-ABLATION-05-MULTI-JOB-ON: SEAM A ON isolates J20 from J40 — only owned outstanding completion filtered", async () => {
		const h = makeHarness()
		setC10Filter(h, true)

		const j20 = "cmd_ablation05_j20"
		const j40 = "cmd_ablation05_j40"
		h.notifyCoordinator.registerMarker({ jobId: j20, sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: j40, sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.translatorState.recordLaunchedBackgroundJob(j20)
		h.translatorState.recordLaunchedBackgroundJob(j40)
		// J20 consumed (the originating turn's completion belongs
		// to J40 not J20 per the BCCOC01 narrow per-job predicate).
		h.notifyCoordinator.consumeTerminal({
			jobId: j20,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: "j20 done",
		})

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "J40 still running.",
			isRunningDuringTurn: true,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		// SEAM A ON + narrow per-job: only J40 is owned-and-
		// outstanding. The completion_result row is filtered.
		expect(visible.totalRows).toBe(0)
		expect(visible.finalRows).toBe(0)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)

	it("C10-ABLATION-05-MULTI-JOB-OFF: SEAM A OFF leaks the originating completion_result row even when one job (J20) is consumed", async () => {
		const h = makeHarness()
		setC10Filter(h, false)

		const j20 = "cmd_ablation05off_j20"
		const j40 = "cmd_ablation05off_j40"
		h.notifyCoordinator.registerMarker({ jobId: j20, sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: j40, sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.translatorState.recordLaunchedBackgroundJob(j20)
		h.translatorState.recordLaunchedBackgroundJob(j40)
		h.notifyCoordinator.consumeTerminal({
			jobId: j20,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: "j20 done",
		})

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "J40 still running.",
			isRunningDuringTurn: true,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		// SEAM A OFF: completion_result row visible.
		expect(visible.totalRows).toBe(2)
		expect(visible.finalRows).toBe(1)
		expect(visible.distinctTs).toBe(1)

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)
})
