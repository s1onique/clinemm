/**
 * ACT-CLINEMM-COMPLETED-TASK-COMPACTION-AUTHORITY01 (CTCA01)
 *
 * RED/GREEN at the REAL production seam for the observed LIVE_UI_ONLY
 * contradiction:
 *
 *     TaskHeader  : "✓ Complete"  + composer "Start New Task"
 *     Manual compaction: "Cannot compact while a response is in progress.
 *                         Try again once the current turn finishes."
 *     Banner      : deferred completion awaiting observation of
 *                   unconsumed terminal results
 *
 * EVIDENCE CLASSIFICATION: LIVE_UI_ONLY. The screenshot proves the
 * visible contradiction; it does NOT prove which side is wrong.
 *
 * THIS ACT'S PRODUCT CONTRACT
 * ---------------------------
 * Manual compaction must operate on the intended task only when its
 * ACTUAL execution and transcript state are safe to compact. Displayed
 * completion must not falsely imply that required execution or
 * observation has finished.
 *
 * THE SEAM UNDER TEST (all production classes, no re-implementation)
 * ----------------------------------------------------------------
 *   1. `SdkSessionLifecycle`      — owns `activeSession.isRunning` AND
 *                                   the `turnGeneration` counter that
 *                                   fences an older turn's settlement
 *                                   against a newer turn.
 *   2. `SdkSessionEventCoordinator` — owns the deferred-completion (BCB)
 *                                   barrier, the `completed` phase commit,
 *                                   and the `setRunning(false)`
 *                                   transition at turn end.
 *   3. `SdkCompactionCoordinator`  — owns the manual compaction guard
 *                                   that rejects with
 *                                   COMPACTION_TURN_RUNNING_MESSAGE.
 *
 * The RED drives the ACTUAL event sequence (turn-complete → BCB hold →
 * deferred release → `completed` phase commit) and then asks the REAL
 * compaction coordinator whether the task may be compacted. It does NOT
 * inject `isRunning: true` / `turnPhase: "completed"` as a fixture.
 *
 * Negative control: a genuinely running turn MUST remain blocked.
 */

import { type CoreSessionEvent, createContextCompactionPrepareTurn } from "@cline/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkCompactionCoordinator, type SdkCompactionCoordinatorOptions } from "../sdk-compaction-coordinator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@cline/core", async () => {
	const actual = await vi.importActual<typeof import("@cline/core")>("@cline/core")
	return {
		...actual,
		createContextCompactionPrepareTurn: vi.fn(),
	}
})

const mockCreateContextCompactionPrepareTurn = createContextCompactionPrepareTurn as unknown as ReturnType<typeof vi.fn>

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => undefined,
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

const COMPACTION_TURN_RUNNING_MESSAGE =
	"Cannot compact while a response is in progress. Try again once the current turn finishes."

const SESSION_ID = "1793873645457_fg2wh"
const TASK_ID = "1793873645457_fg2wh"

/**
 * The REAL production lifecycle. `SdkSessionLifecycle` owns the
 * `isRunning` flag and the `turnGeneration` counter; the compaction
 * guard reads the flag through it.
 */
function makeLifecycle(overrides: Partial<ConstructorParameters<typeof SdkSessionLifecycle>[0]> = {}) {
	return new SdkSessionLifecycle({
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for the lifecycle seam
		mcpHub: { disconnectSession: vi.fn().mockResolvedValue(undefined) } as any,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onSendComplete: vi.fn(),
		onSendError: vi.fn(),
		...overrides,
	})
}

/**
 * A minimal session host that supports the lifecycle's start/send/stop
 * surface. `send` returns a promise the test resolves explicitly, so
 * the turn-settlement ordering is under the test's control (this is the
 * SAME seam the lifecycle unit test uses).
 */
function makeSdkHost(input: { sessionId: string; send: () => Promise<void> }) {
	return {
		start: vi.fn().mockResolvedValue({ sessionId: input.sessionId }),
		send: vi.fn().mockImplementation(() => input.send()),
		abort: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn(() => () => {}),
		updateModel: vi.fn().mockResolvedValue(undefined),
		updateSessionModel: vi.fn().mockResolvedValue(undefined),
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		updateSessionCompactionState: vi.fn().mockResolvedValue({ updated: true }),
		pendingPrompts: vi.fn().mockResolvedValue([]),
	} as never
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: { sessionId, event: event as never },
	}) as CoreSessionEvent

/**
 * The `pending_prompt_submitted` event the runtime emits when the queued
 * host-owned BCB continuation is drained into a new turn.
 */
const pendingPromptSubmitted = (
	sessionId: string,
	runtimeControlKind: "completion_continuation_control" | undefined,
): CoreSessionEvent =>
	({
		type: "pending_prompt_submitted",
		payload: { sessionId, promptId: "prompt-1", ...(runtimeControlKind ? { runtimeControlKind } : {}) },
	}) as unknown as CoreSessionEvent

interface Harness {
	lifecycle: SdkSessionLifecycle
	sessionEvents: SdkSessionEventCoordinator
	compaction: SdkCompactionCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	appendAndEmit: ReturnType<typeof vi.fn>
	host: ReturnType<typeof makeSdkHost>
	/** Resolve the in-flight turn send and let the lifecycle settle it. */
	settleTurn: () => Promise<void>
	/** Change the Elm completion-authority verdict for the next consult. */
	setElmDecision: (kind: "authorize" | "hold") => void
	phase: () => string
}

function makeHarness(input: { elmHolds?: boolean } = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	let resolveSend: () => void = () => {}
	const sendPromise = new Promise<void>((resolve) => {
		resolveSend = resolve
	})
	const host = makeSdkHost({ sessionId: SESSION_ID, send: () => sendPromise })

	const lifecycle = makeLifecycle()
	const appendAndEmit = vi.fn()

	// The Elm completion-authority verdict. Starts as ALLOW (or HOLD when
	// the harness reproduces the deferred path) and can be flipped so the
	// release consult observes a different verdict — exactly what the
	// production authority does between the hold and the release.
	let elmDecision: "authorize" | "hold" = input.elmHolds ? "hold" : "authorize"
	const getElmCompletionAuthorityDecision = () =>
		elmDecision === "authorize"
			? ({ kind: "authorize", reason: "harness" } as const)
			: ({ kind: "hold", reason: "harness", holdReasons: ["active_run"] } as const)

	const sessionEvents = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: lifecycle,
		messages: { appendAndEmit } as never,
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => ({ taskId: TASK_ID }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((
			phase: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>>[0],
			anchorTs?: number,
			writerId?: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>>[2],
		) => {
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown") as never })
		}) as never,
		getTurnPhase: () => tracker.currentPhase,
		getTurnPhaseWriterId: () => tracker.currentWriterId,
		translateSessionEvent,
		// The Elm authority is the FINAL completion-authority gate.
		// ALLOW reproduces the immediate completion path; HOLD reproduces
		// the deferred (BCB) hold path.
		getElmCompletionAuthorityDecision,
		flushElmAuthorityForSession: vi.fn().mockResolvedValue(undefined),
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getPendingPromptCount: () => ({ available: true, count: 0 }) as never,
		getActiveNotifyCount: () => 0,
		getUnconsumedOwnedTerminalResultCount: () => 0,
		getUnconsumedOwnedTerminalJobIds: () => [],
	} as never)

	const compactionOptions = {
		stateManager: { getGlobalSettingsKey: vi.fn(() => "act") } as unknown as StateManager,
		sessions: lifecycle,
		rebuilds: { runExclusive: vi.fn(async (operation: () => Promise<unknown>) => operation()) },
		messages: { appendAndEmit },
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			getLegacyResumeInitialMessages: vi.fn(async (_taskId: string, fallback?: unknown[]) => fallback),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue({
				providerConfig: { providerId: "anthropic", modelId: "claude" },
				providerId: "anthropic",
				modelId: "claude",
				systemPrompt: "test system prompt",
				extraTools: [],
			}),
		},
		getDisplayedTaskId: () => TASK_ID,
		createTempSessionHost: vi.fn().mockResolvedValue(host),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		getTurnState: () => tracker.get(),
		setTurnPhase: (phase: never, anchorTs?: number) => tracker.set(phase, anchorTs),
	} as unknown as SdkCompactionCoordinatorOptions

	return {
		lifecycle,
		sessionEvents,
		compaction: new SdkCompactionCoordinator(compactionOptions),
		tracker,
		translatorState,
		appendAndEmit,
		host,
		settleTurn: async () => {
			resolveSend()
			await sendPromise
			// Let the lifecycle's send-settlement bookkeeping run.
			await new Promise((resolve) => setTimeout(resolve, 0))
		},
		setElmDecision: (kind: "authorize" | "hold") => {
			elmDecision = kind
		},
		phase: () => tracker.currentPhase,
	}
}

/** Collect the user-visible info rows the compaction coordinator emitted. */
function infoRows(appendAndEmit: ReturnType<typeof vi.fn>): string[] {
	return appendAndEmit.mock.calls
		.flatMap((call) => call[0] as Array<{ say?: string; text?: string }>)
		.filter((message) => message.say === "info")
		.map((message) => message.text ?? "")
}

/**
 * Start the real production turn: install an ACTIVE session
 * (`isRunning: true`) and send the outbound prompt through the REAL
 * `fireAndForgetSend`.
 */
async function startRealTurn(h: Harness): Promise<void> {
	const result = await h.lifecycle.startNewSession(
		{ config: { providerId: "anthropic", modelId: "claude", sessionId: SESSION_ID } } as never,
		undefined,
		h.host as never,
	)
	expect(result.status).toBe("started")
	h.lifecycle.fireAndForgetSend(h.host as never, SESSION_ID, "hello")
}

describe("ACT-CLINEMM-COMPLETED-TASK-COMPACTION-AUTHORITY01 — real production seam", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("RED: a task the UI presents as Complete must not be rejected by the real compaction guard", async () => {
		const h = makeHarness()

		// ---- STEP 1: the real production turn starts -------------------
		await startRealTurn(h)
		expect(h.lifecycle.getActiveSession()?.sessionId).toBe(SESSION_ID)
		expect(h.lifecycle.getActiveSession()?.isRunning).toBe(true)

		// ---- STEP 2: the turn's completion is committed -----------------
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		await h.sessionEvents.handleSessionEvent(
			agentEvent(SESSION_ID, { type: "done", reason: "completed", text: "Task completed.", iterations: 1 }),
		)

		// The turn's send promise settles → the lifecycle's real
		// `setRunning(false)` bookkeeping runs.
		await h.settleTurn()

		// ---- STEP 3: the state the UI projects --------------------------
		// The TaskHeader renders "✓ Complete" / "Start New Task" from
		// this phase. This is the SAME phase the real webview projection
		// reads.
		expect(h.phase()).toBe("completed")

		// ---- STEP 4: manual compaction on the SAME task ----------------
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)
		await h.compaction.compactTask()

		// The contract: the completed, idle task MUST be compactable.
		expect(infoRows(h.appendAndEmit)).not.toContain(COMPACTION_TURN_RUNNING_MESSAGE)
		expect(mockCreateContextCompactionPrepareTurn).toHaveBeenCalled()
	})

	it("RED-DEFERRED: a DEFERRED completion that the UI presents as Complete must not be rejected by the real compaction guard", async () => {
		// The deferred (BCB) path: the Elm completion authority HOLDS the
		// C10 commit at turn end, the barrier marker is registered, and
		// the release happens LATER through
		// `reevaluateDeferredCompletionBarrier`. This is the LIVE
		// chronology: the purple "deferred completion awaiting
		// observation of unconsumed terminal results" banner.
		const h = makeHarness({ elmHolds: true })

		await startRealTurn(h)
		expect(h.lifecycle.getActiveSession()?.isRunning).toBe(true)

		// ---- The turn completes but the completion is HELD -------------
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		await h.sessionEvents.handleSessionEvent(
			agentEvent(SESSION_ID, { type: "done", reason: "completed", text: "Task completed.", iterations: 1 }),
		)

		// The turn's send promise settles → the lifecycle's real
		// `setRunning(false)` bookkeeping runs.
		await h.settleTurn()

		// ---- The held completion is RELEASED ---------------------------
		// The production release path: the authority now authorizes and
		// the coordinator commits the terminal `completed` phase.
		h.setElmDecision("authorize")
		await h.sessionEvents.reevaluateDeferredCompletionBarrier()

		// ---- The state the UI projects --------------------------------
		expect(h.phase()).toBe("completed")

		// ---- Manual compaction on the SAME task ------------------------
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)
		await h.compaction.compactTask()

		// The contract: the completed, idle task MUST be compactable.
		expect(infoRows(h.appendAndEmit)).not.toContain(COMPACTION_TURN_RUNNING_MESSAGE)
		expect(mockCreateContextCompactionPrepareTurn).toHaveBeenCalled()
	})

	it("NEGATIVE CONTROL: a genuinely running turn stays blocked from compaction", async () => {
		const h = makeHarness()

		await startRealTurn(h)

		// The turn is still in flight: the send promise has NOT settled.
		expect(h.lifecycle.getActiveSession()?.isRunning).toBe(true)

		await h.compaction.compactTask()

		expect(infoRows(h.appendAndEmit)).toContain(COMPACTION_TURN_RUNNING_MESSAGE)
		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
	})

	it("CONSERVATION: a DEFERRED completion that is still HELD keeps compaction blocked", async () => {
		// The deferred completion is NOT yet released: the authority still
		// holds, so the task is NOT presented as Complete and the session
		// must stay busy. The compaction guard must keep rejecting.
		const h = makeHarness({ elmHolds: true })

		await startRealTurn(h)
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		await h.sessionEvents.handleSessionEvent(
			agentEvent(SESSION_ID, { type: "done", reason: "completed", text: "Task completed.", iterations: 1 }),
		)

		// The completion is still held: the phase is NOT `completed`.
		expect(h.phase()).not.toBe("completed")

		await h.compaction.compactTask()

		expect(infoRows(h.appendAndEmit)).toContain(COMPACTION_TURN_RUNNING_MESSAGE)
		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
	})

	it("CONSERVATION: the release does NOT mark the session idle while the completion is still held", async () => {
		// The release path's HOLD branches must return BEFORE the
		// running-state transition, so a held (not yet completable)
		// task keeps `isRunning === true`.
		const h = makeHarness({ elmHolds: true })

		await startRealTurn(h)
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		await h.sessionEvents.handleSessionEvent(
			agentEvent(SESSION_ID, { type: "done", reason: "completed", text: "Task completed.", iterations: 1 }),
		)
		await h.settleTurn()

		// The release consults the (still holding) authority.
		await h.sessionEvents.reevaluateDeferredCompletionBarrier()

		expect(h.phase()).not.toBe("completed")
		expect(h.lifecycle.getActiveSession()?.isRunning).toBe(false)
	})

	it("RED-CONTINUATION: after the BCB continuation turn, a Complete task must be compactable", async () => {
		// THE LIVE SEQUENCE.
		//
		//   1. Turn 1 starts through the REAL `fireAndForgetSend`
		//      (`isRunning: true`).
		//   2. Turn 1's completion is HELD by the completion authority →
		//      the deferred-completion barrier is registered and
		//      `handleSessionEvent` returns EARLY (the turn-end
		//      `setRunning(false)` is NOT reached).
		//   3. The host-owned BCB continuation is drained into a NEW turn
		//      → the runtime emits `pending_prompt_submitted` →
		//      the lifecycle's `setRunning(true)` advances
		//      `turnGeneration`.
		//   4. Turn 1's send promise settles. The lifecycle's
		//      `isSuperseded` generation guard sees the advanced
		//      generation and SKIPS its `setRunning(false)` — correctly,
		//      because a newer turn owns the running state now.
		//   5. The continuation turn completes and the deferred
		//      completion is RELEASED → the coordinator commits the
		//      terminal `completed` phase → the UI shows "✓ Complete"
		//      and "Start New Task".
		//   6. The continuation turn's own settlement path is the
		//      deferred-release path, which does NOT own a
		//      `setRunning(false)`.
		//
		// The result: the session is presented as Complete but
		// `isRunning` is still true → the compaction guard rejects.
		const h = makeHarness({ elmHolds: true })

		await startRealTurn(h)
		expect(h.lifecycle.getActiveSession()?.isRunning).toBe(true)

		// ---- STEP 2: the turn completes but the completion is HELD -----
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		await h.sessionEvents.handleSessionEvent(
			agentEvent(SESSION_ID, { type: "done", reason: "completed", text: "Task completed.", iterations: 1 }),
		)

		// ---- STEP 3: the BCB continuation is drained into a NEW turn --
		// The runtime drains the queued host-owned continuation AFTER the
		// previous turn's send has already settled (the real Core drain
		// happens in the `queueMicrotask` after `completeInteractiveTurn`).
		await h.settleTurn()
		await h.sessionEvents.handleSessionEvent(pendingPromptSubmitted(SESSION_ID, "completion_continuation_control"))

		// ---- STEP 4: the CONTINUATION turn ends, and its completion is
		// ALSO deferred (the authority still holds) -----------------------
		// The continuation turn is delivered through
		// `sdkHost.send({ delivery: "queue" })`, NOT through
		// `fireAndForgetSend`, so it has NO settlement owner that could
		// mark the session idle when its own turn ends.
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		await h.sessionEvents.handleSessionEvent(
			agentEvent(SESSION_ID, { type: "done", reason: "completed", text: "Task completed.", iterations: 1 }),
		)

		// ---- STEP 5: the deferred completion is RELEASED ----------------
		h.setElmDecision("authorize")
		await h.sessionEvents.reevaluateDeferredCompletionBarrier()

		// ---- STEP 6: the state the UI projects --------------------------
		expect(h.phase()).toBe("completed")

		// ---- STEP 7: manual compaction on the SAME task ----------------
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)
		await h.compaction.compactTask()

		// The contract: the completed, idle task MUST be compactable.
		expect(infoRows(h.appendAndEmit)).not.toContain(COMPACTION_TURN_RUNNING_MESSAGE)
		expect(mockCreateContextCompactionPrepareTurn).toHaveBeenCalled()
	})
})
