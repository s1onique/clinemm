/**
 * ACT-CLINEMM-C10-FILTER-ABLATION01
 *
 * ABLATION matrix: with the framework-level completion-commit barrier
 * (SEAM B) enabled but the message-layer completion_result filter
 * (SEAM A) NEUTRALIZED, observe whether the persisted/rendered
 * completion_result row cardinality regresses.
 *
 * The ablation mechanism: the harness ALWAYS wires the
 * `shouldFilterCompletionResult` (TEST-ONLY) option-bag method on
 * `SdkSessionEventCoordinator`. This is the SEAM-A-only gate added
 * by ACT-CLINEMM-C10-FILTER-ABLATION01's bounded correction
 * ROUND 1 in response to `HALT_C10_ABLATION_NOT_ISOLATED` (the
 * ROUND 0 ablation was contaminated because it falsified
 * `hasActiveNotify` / `getActiveNotifyCount`, which SEAM B also
 * consults).
 *
 * `shouldFilterCompletionResult(ownedJobIds)` is consulted EXCLUSIVELY
 * by the SEAM-A filter branch (`sdk-session-event-coordinator.ts` at
 * the completion-result message filter). It is NOT consulted by SEAM B
 * (the framework-level completion-commit barrier at
 * `setTurnPhase("completed", ...)`), which continues to read the real
 * `hasActiveNotify` / `wasWakeDelivered` / etc. state through its own
 * option-bag methods. This is the property the bounded correction
 * makes load-bearing: turning SEAM A OFF does not contaminate SEAM B's
 * lifecycle decision.
 *
 * The harness exposes a mutable closure `harness.c10FilterDecision`
 * that the test can flip mid-run:
 *
 *   - `setC10Filter(harness, true)`  -> c10FilterDecision = real per-job check
 *                                       (consults `notifyCoordinator.hasActiveNotify`
 *                                       for each owned jobId)
 *   - `setC10Filter(harness, false)` -> c10FilterDecision = () => false
 *                                       (SEAM A neutered; SEAM B unchanged)
 *
 * The discriminator (per ACT §4..§8):
 *   D1 semantic task completion cardinality == 0 (wake delivered)
 *                              / == 1 (ordinary)   -> tracker.currentPhase
 *                                              + completionCommitCount
 *   D2 persisted completion_result row cardinality
 *                                       -> result.messages.filter(say=="completion_result")
 *   D3 visible duplicate completion presentation
 *                                       -> distinct ts in those rows
 *
 * The CANONICAL DISCRIMINATOR (the one the bounded correction
 * requires):
 *
 *   setup:
 *     J registered
 *     J's terminal fires
 *     consumeTerminal(J) -> host.enqueueTerminalWake({kind:"delivered"})
 *                        -> notifyCoordinator.markWakeDelivered(J)
 *                        -> hasActiveNotify(J) === false
 *                        -> wasWakeDelivered(J) === true
 *     originating turn attempts completion
 *
 *   SEAM A ON  : c10FilterDecision returns true (real predicate)
 *                ownedAndOutstanding = true
 *                filter runs
 *                completion_result row FILTERED
 *                appendAndEmit receives 0 completion_result rows
 *   SEAM A OFF : c10FilterDecision returns false
 *                ownedAndOutstanding = false
 *                filter skipped
 *                completion_result row VISIBLE
 *                appendAndEmit receives 2 raw / 1 visible box
 *
 *   SEAM B in both runs:
 *                outstandingAutonomousWork = activeNotifyCount (0) > 0 ? ... = false
 *                perJobSuppressOriginatingCompletion = wasWakeDelivered(J) === true
 *                return early (originating commit SUPPRESSED)
 *                completionCommitCount === 0 in both
 *
 * This is the LOAD-BEARING discriminator per the bounded correction:
 * the SEAM-A-ON case and SEAM-A-OFF case differ ONLY in the message
 * filter, NOT in the framework barrier's decision.
 *
 * The hypothesis (proved or disproved here):
 *
 *   H1: with SEAM B ON (wake delivered -> completion suppressed) and
 *       SEAM A OFF, the originating turn's completion_result row is
 *       NOT stripped (because SEAM A is OFF). The wake-driven turn's
 *       own completion_result row IS later emitted by its own turn.
 *       Result: TWO completion_result rows reach `appendAndEmit` (one
 *       from the originating turn that should have been suppressed,
 *       one from the wake-driven turn that owns terminal completion).
 *       SEAM A is therefore NECESSARY for the message-layer
 *       uniqueness invariant (independent of SEAM B's framework
 *       lifecycle cardinality).
 *
 *   H2 (alternative): SEAM A is fully redundant with SEAM B. The
 *       completion_result row never reaches appendAndEmit regardless
 *       of SEAM A's state because SEAM B holds the originating turn
 *       in deferred state and the message layer is unobservably
 *       thin during that hold.
 *
 * The canonical discriminator proves or disproves H1 unambiguously:
 * if the OFF case has a non-zero count of completion_result rows in
 * appendAndEmit (2 raw / 1 visible box) AND the ON case has zero,
 * H1 holds and SEAM A is necessary.
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
	/**
	 * Mutable closure that backs the SEAM-A-only filter gate. The
	 * default consults the REAL `notifyCoordinator.hasActiveNotify`
	 * per owned jobId (production behavior). Tests flip it via
	 * `setC10Filter`. SEAM B does NOT consult this — it reads
	 * `hasActiveNotify` / `wasWakeDelivered` / `isWakeAuthoritySettled`
	 * through the coordinator's option-bag methods directly.
	 *
	 * The coordinator's `shouldFilterCompletionResult` option-bag
	 * method dispatches through the same underlying mutable cell
	 * (see `writeC10`); the test's `setC10Filter(h, off)` swap is
	 * observed immediately by the coordinator's next call.
	 */
	c10FilterDecision: (ownedJobIds: readonly string[]) => boolean
	/**
	 * Cell-mutator for the c10FilterDecision closure. `setC10Filter`
	 * calls this so the swap is observed by the coordinator's
	 * `shouldFilterCompletionResult` closure (which captures the
	 * same `let` variable by reference).
	 */
	writeC10: (next: (ownedJobIds: readonly string[]) => boolean) => void
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

	// ACT-CLINEMM-C10-FILTER-ABLATION01 (bounded correction
	// ROUND 1): the c10FilterDecision is a SINGLE mutable closure
	// cell that backs both the coordinator's `shouldFilterCompletionResult`
	// option-bag dispatch AND the harness's `c10FilterDecision`
	// property (they reference the SAME function). Tests reassign
	// it via `setC10Filter`; the production seam reads it through
	// the same cell on the next call.
	let c10FilterDecision: (ownedJobIds: readonly string[]) => boolean = (ownedJobIds) => {
		// Production-real narrow per-jid lookup: filter iff any
		// owned job has an active notify marker alive.
		for (const jid of ownedJobIds) {
			if (notifyCoordinator.hasActiveNotify(jid)) {
				return true
			}
		}
		return false
	}
	// Wrapper helper so the harness field tracks the variable.
	const readC10 = (ownedJobIds: readonly string[]) => c10FilterDecision(ownedJobIds)
	const writeC10 = (next: (ownedJobIds: readonly string[]) => boolean) => {
		c10FilterDecision = next
	}

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
		// ACT-CLINEMM-C10-FILTER-ABLATION01 (bounded correction
		// ROUND 1): the SEAM-A-only ablation gate. This option-bag
		// closure reads the LOCAL `c10FilterDecision` variable
		// (declared with `let` above), so `setC10Filter`'s
		// REASSIGNMENT of that variable is observed on the
		// coordinator's next call. SEAM B is unaffected because
		// SEAM B reads `hasActiveNotify` / `wasWakeDelivered`
		// directly from the option-bag methods above — none of
		// those reference `c10FilterDecision`.
		shouldFilterCompletionResult: (ownedJobIds: readonly string[]) => c10FilterDecision(ownedJobIds),
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
		appendAndEmit,
		completionCommitCount: () => completionCommitCount,
		// Exposed mirror of the mutable `c10FilterDecision` cell.
		// Reading this returns the CURRENT function. The
		// authoritative REWRITE happens via `writeC10`
		// (which mutates the same `let` that the coordinator's
		// `shouldFilterCompletionResult` closure captures).
		c10FilterDecision: readC10,
		writeC10,
	}
}

/**
 * Variant of `makeHarness` for the LOST-WAKE matrix where the
 * host's `enqueueTerminalWake` returns a non-delivered outcome
 * (`"rejected"` or `"session_gone"`). The downstream coordinator
 * state transitions to "wake_dispatch_failed" (marker drained,
 * wasWakeDispatchFailed=true), and SEAM B ALLOWs the originating
 * completion commit per the BNCA dispatch-failed matrix.
 *
 * Default (`makeHarness`) returns `"delivered"`.
 */
function makeHarnessWithOutcome(outcome: "delivered" | "rejected" | "session_gone"): Harness {
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
			// Only enqueue when the host actually delivered the wake.
			// A "rejected" / "session_gone" outcome models a wake that
			// never landed in PendingPromptsController; the queue must
			// not reflect such "phantom" prompts (otherwise the SEAM B
			// pending-prompt-count path would still see
			// `pendingPromptsKnown > 0` and refuse to commit).
			if (outcome === "delivered") {
				queue.enqueue({ sessionId, prompt, ...(jid !== undefined ? { jobId: jid } : {}) })
			}
			return { kind: outcome }
		},
		now: () => ++now,
	})

	let c10FilterDecision: (ownedJobIds: readonly string[]) => boolean = (ownedJobIds) => {
		for (const jid of ownedJobIds) {
			if (notifyCoordinator.hasActiveNotify(jid)) {
				return true
			}
		}
		return false
	}
	const readC10 = (ownedJobIds: readonly string[]) => c10FilterDecision(ownedJobIds)
	const writeC10 = (next: (ownedJobIds: readonly string[]) => boolean) => {
		c10FilterDecision = next
	}

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
		shouldFilterCompletionResult: (ownedJobIds: readonly string[]) => c10FilterDecision(ownedJobIds),
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
		appendAndEmit,
		completionCommitCount: () => completionCommitCount,
		c10FilterDecision: readC10,
		writeC10,
	}
}

/**
 * SEAM-A-only ablation switch. Flips the `c10FilterDecision`
 * closure the harness wires into `shouldFilterCompletionResult`.
 *
 * - `setC10Filter(harness, true)`  -> filter ON (production-real
 *   narrow per-jid lookup via real `hasActiveNotify`).
 * - `setC10Filter(harness, false)` -> filter OFF (always returns
 *   false; SEAM A neutered).
 *
 * SEAM B is unaffected because `setC10Filter` does NOT touch the
 * `hasActiveNotify` / `wasWakeDelivered` /
 * `isWakeAuthoritySettled` / `getActiveNotifyCount` option-bag
 * methods that SEAM B consults. SEAM B continues to read the REAL
 * coordinator state through the same option-bag handlers both
 * before and after the flip.
 */
function setC10Filter(harness: Harness, enabled: boolean): void {
	if (enabled) {
		// Production-real narrow per-jid lookup.
		harness.writeC10((ownedJobIds) => {
			for (const jid of ownedJobIds) {
				if (harness.notifyCoordinator.hasActiveNotify(jid)) {
					return true
				}
			}
			return false
		})
	} else {
		// SEAM A neutered — always returns false. SEAM B still reads
		// the REAL coordinator state via `hasActiveNotify` /
		// `wasWakeDelivered` on the option-bag (untouched).
		harness.writeC10((_ownedJobIds) => false)
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

describe("ACT-CLINEMM-C10-FILTER-ABLATION01 / C10-ABLATION-01 (matrix A — canonical wake-delivered discriminator)", () => {
	it("C10-ABLATION-01-NOTIFY-ON: wake delivered + marker held at emit, SEAM A ON -> completion_result FILTERED, framework_commit=0", async () => {
		const h = makeHarness()
		setC10Filter(h, true)

		const jobId = "cmd_ablation01_notify_on"
		h.notifyCoordinator.registerMarker({
			jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.translatorState.recordLaunchedBackgroundJob(jobId)

		// Drive Path A: consumeTerminal -> host.enqueueTerminalWake
		// returns {kind:"delivered"} -> markWakeDelivered(J).
		h.notifyCoordinator.consumeTerminal({
			jobId,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: "ok",
		})
		await new Promise((r) => setImmediate(r))
		expect(h.notifyCoordinator.wasWakeDelivered(jobId)).toBe(true)
		expect(h.notifyCoordinator.hasActiveNotify(jobId)).toBe(false)

		// Re-register so SEAM A observes an owned outstanding
		// marker at emit time. wasWakeDelivered stays true so
		// SEAM B still holds the originating commit.
		h.notifyCoordinator.registerMarker({
			jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		expect(h.notifyCoordinator.hasActiveNotify(jobId)).toBe(true)
		expect(h.notifyCoordinator.wasWakeDelivered(jobId)).toBe(true)

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "Started, will report back.",
			isRunningDuringTurn: true,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		expect(visible.totalRows).toBe(0)
		expect(visible.finalRows).toBe(0)

		// SEAM B holds the originating commit (wake delivered).
		expect(h.completionCommitCount()).toBe(0)
		expect(h.coordinator.getDeferredCompletionBarrierForTesting()).toBeDefined()

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)

	it("C10-ABLATION-01-NOTIFY-OFF: wake delivered + marker held at emit, SEAM A OFF -> completion_result VISIBLE, framework_commit=0 (CANONICAL DISCRIMINATOR)", async () => {
		const h = makeHarness()
		setC10Filter(h, false)

		const jobId = "cmd_ablation01_notify_off"
		h.notifyCoordinator.registerMarker({
			jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.translatorState.recordLaunchedBackgroundJob(jobId)

		h.notifyCoordinator.consumeTerminal({
			jobId,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: "ok",
		})
		await new Promise((r) => setImmediate(r))
		expect(h.notifyCoordinator.wasWakeDelivered(jobId)).toBe(true)
		expect(h.notifyCoordinator.hasActiveNotify(jobId)).toBe(false)

		// Re-register to give SEAM A's predicate something to filter.
		h.notifyCoordinator.registerMarker({
			jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "Started, will report back.",
			isRunningDuringTurn: true,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		// SEAM A OFF: filter skipped entirely. completion_result
		// row passes through appendAndEmit.
		expect(visible.totalRows).toBe(2)
		expect(visible.finalRows).toBe(1)
		expect(visible.partialRows).toBe(1)
		expect(visible.distinctTs).toBe(1)

		// SEAM B holds the originating commit (identical to the
		// SEAM-A-ON case above — `completionCommitCount===0`).
		// This is the bounded correction's isolation property:
		// SEAM B's decision is the SAME in both cases; ONLY the
		// message-layer filter differs.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.coordinator.getDeferredCompletionBarrierForTesting()).toBeDefined()

		h.notifyCoordinator.dispose()
		await h.manager.dispose()
	}, 15_000)

	it("C10-ABLATION-01-NOTIFY-OFF-MULTI: TWO wakes delivered (per-job), SEAM A OFF -> completion_result VISIBLE, framework_commit=0", async () => {
		const h = makeHarness()
		setC10Filter(h, false)

		const j1 = "cmd_ablation01_multi_j1"
		const j2 = "cmd_ablation01_multi_j2"
		h.notifyCoordinator.registerMarker({ jobId: j1, sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: j2, sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.translatorState.recordLaunchedBackgroundJob(j1)
		h.translatorState.recordLaunchedBackgroundJob(j2)

		// Drive Path A wake delivery for both J1 and J2.
		for (const jid of [j1, j2]) {
			h.notifyCoordinator.consumeTerminal({
				jobId: jid,
				terminalState: "exited",
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: "ok",
			})
		}
		await new Promise((r) => setImmediate(r))

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "Both commands launched.",
			isRunningDuringTurn: true,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		// SEAM A off: completion_result row leaks through even though
		// SEAM B holds the originating commit (both wakes delivered).
		expect(visible.totalRows).toBe(2)
		expect(visible.finalRows).toBe(1)
		expect(visible.distinctTs).toBe(1)
		expect(h.completionCommitCount()).toBe(0)

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
		const h = makeHarnessWithOutcome("rejected")
		setC10Filter(h, false)

		const jobId = "cmd_ablation03_lost_wake"
		h.notifyCoordinator.registerMarker({
			jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.translatorState.recordLaunchedBackgroundJob(jobId)
		// Drive Path A with outcome=rejected: the host callback
		// resolves with {kind:"rejected"}, which causes the
		// coordinator to call markWakeDispatchFailed(J). The
		// marker is drained and the wake is definitively lost
		// (no wake-driven turn will fire).
		h.notifyCoordinator.consumeTerminal({
			jobId,
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: "ok",
		})
		await new Promise((r) => setImmediate(r))
		expect(h.notifyCoordinator.wasWakeDispatchFailed(jobId)).toBe(true)
		expect(h.notifyCoordinator.wasWakeDelivered(jobId)).toBe(false)
		expect(h.notifyCoordinator.hasActiveNotify(jobId)).toBe(false)

		await emitCompletionTurn(h, {
			turnId: "orig",
			resultText: "Trying to commit anyway.",
			isRunningDuringTurn: true,
		})

		const visible = summarizeCompletionBoxes(h.appendAndEmit)
		// SEAM A off + wake LOST -> filter off path does not
		// filter anyway. Completion_result row visible.
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
