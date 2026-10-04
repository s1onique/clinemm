/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION02-PRODUCTION-STAGE-VOCABULARY
 *
 * Source/target vocabulary discriminator. PROVES that the Elm authority
 * runtime recognizes PRODUCTION source stage names (e.g.
 * `run_turn_started`) and NOT Elm target tag names (e.g. `run_started`).
 *
 * **The critical distinction:**
 *   - Production capture sites emit `run_turn_started`
 *     (`ContinuationCardinalityStage` union member in
 *      `continuation-cardinality-authority.ts`).
 *   - The Elm Msg tag inside the compiled kernel is `run_started`
 *     (mapped at the adapter boundary in `completion-authority-elm-replay.ts`).
 *   - The authority runtime's `AUTHORITY_STAGES` filter sits BEFORE the
 *     adapter. It must therefore contain the SOURCE stage name, not the
 *     Elm TARGET tag. If it contains the Elm target tag, production
 *     `run_turn_started` records are silently dropped and the Elm
 *     authority kernel never learns that a run is active — the
 *     self-fulfilling `task_completion_committed` while a run is
 *     active is allowed.
 *
 * **Entry seam (load-bearing):** these tests enter through the real
 * production capture helper
 *   `captureContinuationCardinalityAuthorityRecord(...)`
 * NOT `enqueueElmAuthorityRecord(...)`. The point is to catch the
 * "source vocabulary confused with target vocabulary" defect class
 * even if a future refactor of the authority filter changes its
 * API surface. The real production capture seam only emits source
 * stage names.
 *
 * Discriminators (per ACT §5, §6, §8):
 *   A. REAL-ELM-PROD-VOCAB-HOLD:
 *      source `run_turn_started` -> Elm sees activeRun -> completion
 *      committed count = 0.
 *   B. REAL-ELM-PROD-VOCAB-AUTHORIZE:
 *      source `run_turn_started` then `agent_turn_done` -> activeRun
 *      cleared -> Elm AUTHORIZE -> commit count = 1.
 *   C. REAL-ELM-PROD-VOCAB-ADAPTER:
 *      adaptRecord maps source `run_turn_started` -> Elm `run_started`
 *      wire tag (boundary invariant).
 *   D. REAL-ELM-PROD-VOCAB-AUTHORITY-FILTER:
 *      AUTHORITY_STAGES accepts the production source stage via the
 *      real capture seam.
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import {
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	getElmAuthorityCounters,
	isElmAuthorityEnabled,
	resetElmAuthorityForTests,
	setElmAuthorityProvider,
} from "../completion-authority-elm-authority-runtime"
import { adaptRecord } from "../completion-authority-elm-replay"
import {
	captureContinuationCardinalityAuthorityRecord,
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "../continuation-cardinality-authority"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
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
	resetElmAuthorityForTests()
	clearContinuationCardinalityAuthorityCapture()
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	resetElmAuthorityForTests()
	clearContinuationCardinalityAuthorityCapture()
})

const HERE = fileURLToPath(import.meta.url)
const REAL_KERNEL_PATH = join(HERE, "..", "..", "..", "..", "elm", "completion-authority", "vendor", "completion-authority.js")

interface ProdVocabHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly translatorState: MessageTranslatorState
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly completionCommitCount: () => number
	readonly phaseAtCompletion: () => string
}

function makeProdVocabHarness(): ProdVocabHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-prod-vocab"
	const activeTaskId = "task-prod-vocab"

	const wakeSinkQueue: Array<{ sessionId: string; prompt: string }> = []
	let nowCounter = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) =>
			Promise.resolve(
				(async () => {
					wakeSinkQueue.push({ sessionId, prompt })
					return { kind: "delivered" as const }
				})(),
			),
		discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
		now: () => ++nowCounter,
	})

	let commitCount = 0
	let lastPhase = "idle"
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId } as never,
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: ((_msgs: unknown[]) => {}) as never as never,
		},
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			lastPhase = phase
			if (phase === "completed") {
				commitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		// All BCB/BNCA/PPCA predicates report zero. The legacy TS path
		// would commit in this scenario.
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: () => 0,
		getUnconsumedOwnedTerminalJobIds: () => [],
		getPendingPromptCount: () => ({ available: true, count: 0 }) as PendingPromptCountRead,
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: () => Promise.resolve({ kind: "no_held_job_ids" }),
		getElmCompletionAuthorityDecision: (sessionId?: string) => getElmAuthorityCompletionDecision(sessionId ?? ""),
		flushElmAuthorityForSession: async (sessionId: string) => flushElmAuthorityForSession(sessionId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		translatorState,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => commitCount,
		phaseAtCompletion: () => lastPhase,
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

// ----------------------------------------------------------------------------
// Helpers — the production capture seam IS captureContinuationCardinalityAuthorityRecord
// ----------------------------------------------------------------------------

/**
 * Emits a record via the REAL production capture seam
 * (`captureContinuationCardinalityAuthorityRecord`). This is the same
 * helper production code paths use from `LocalRuntimeHost.executeTurn`
 * and the background-notify / command-job managers. The stage names
 * here are PRODUCTION SOURCE stage names (the
 * `ContinuationCardinalityStage` union), NOT Elm target tags.
 */
function emitProductionRecord(args: {
	stage:
		| "task_started"
		| "run_turn_started"
		| "execute_turn_prelude_enter"
		| "agent_turn_done"
		| "terminal_committed"
		| "notify_consume_enter"
		| "wake_created"
		| "pending_prompt_enqueued"
		| "pending_prompt_dequeued"
		| "continuation_scheduled"
		| "continuation_started"
		| "submit_and_exit_seen"
	sessionId: string
	taskId?: string
	runId?: string
	jobId?: string
	ownerId?: string
	origin?:
		| "background_terminal"
		| "pending_prompt_drain"
		| "deferred_continuation"
		| "explicit_user"
		| "mode_continuation"
		| "session_resume"
		| "unknown"
	terminalKind?: "owned" | "owned_external" | "unowned"
	submitId?: string
	promptId?: string
	correlationId?: string
}): void {
	captureContinuationCardinalityAuthorityRecord({
		stage: args.stage,
		sessionId: args.sessionId,
		...(args.taskId !== undefined ? { taskId: args.taskId } : {}),
		...(args.runId !== undefined ? { runId: args.runId } : {}),
		...(args.jobId !== undefined ? { jobId: args.jobId } : {}),
		...(args.ownerId !== undefined ? { ownerId: args.ownerId } : {}),
		...(args.terminalKind !== undefined ? { terminalKind: args.terminalKind } : {}),
		...(args.submitId !== undefined ? { submitId: args.submitId } : {}),
		...(args.origin !== undefined ? { origin: args.origin } : {}),
		...(args.promptId !== undefined ? { promptId: args.promptId } : {}),
		...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
	})
}

// ----------------------------------------------------------------------------
// Discriminator tests
// ----------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION02-PRODUCTION-STAGE-VOCABULARY", () => {
	describe("REAL-ELM source/target vocabulary — boundary contract", () => {
		it("REAL-ELM-PROD-VOCAB-ADAPTER: adaptRecord maps source run_turn_started to Elm run_started", () => {
			const outcome = adaptRecord({
				stage: "run_turn_started",
				runId: "run-A",
				origin: "explicit_user",
			})
			expect(outcome.status).toBe("DIRECT")
			if (outcome.status !== "DIRECT") throw new Error("expected DIRECT")
			expect(outcome.elmMsg.tag).toBe("run_started")
			expect((outcome.elmMsg as Record<string, unknown>).runId).toBe("run-A")
		})

		it("REAL-ELM-PROD-VOCAB-AUTHORITY-FILTER: AUTHORITY_STAGES accepts the production source stage", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			expect(isElmAuthorityEnabled()).toBe(true)
			setContinuationCardinalityAuthorityCaptureEnabled(true)
			const sessionId = "vocab-filter-probe"
			const taskId = "vocab-filter-task"
			emitProductionRecord({ stage: "task_started", sessionId, taskId })
			emitProductionRecord({
				stage: "run_turn_started",
				sessionId,
				runId: "run-FILTER",
				origin: "explicit_user",
			})
			await flushElmAuthorityForSession(sessionId)
			const records = getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.sessionId === sessionId)
			expect(records.length).toBe(2)
			expect(records.find((r) => r.stage === "run_turn_started")).toBeDefined()
			const counters = getElmAuthorityCounters()
			expect(counters.states).toBeGreaterThanOrEqual(2)
		})
	})

	describe("REAL-ELM discriminator A — HOLD via production capture seam", () => {
		it("REAL-ELM-PROD-VOCAB-HOLD: source run_turn_started reaches Elm, blocks commit", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			setContinuationCardinalityAuthorityCaptureEnabled(true)
			const h = makeProdVocabHarness()
			emitProductionRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			// PRODUCTION source stage, NOT Elm target tag. This is the
			// vocabulary the real capture seam emits.
			emitProductionRecord({
				stage: "run_turn_started",
				sessionId: h.activeSessionId,
				runId: "run-1",
				origin: "explicit_user",
			})
			// ACTIVE-RUN HOLD: we deliberately DO NOT emit
			// `agent_turn_done` for run-1 here — the run remains active
			// when the commit attempt fires. We add a `pending_prompt_enqueued`
			// to provide a parallel, orthogonal hold reason so the test
			// remains stable across the `commitReadyRun == activeRun`
			// suppression rule in Authority.elm:453-460 (which removes
			// `ActiveRun` from the hold set once `submit_and_exit_seen`
			// binds the current run). The pending-prompt hold is
			// independent of the active-run state.
			emitProductionRecord({
				stage: "pending_prompt_enqueued",
				sessionId: h.activeSessionId,
				promptId: "prompt-PENDING",
				origin: "pending_prompt_drain",
			})
			emitProductionRecord({
				stage: "submit_and_exit_seen",
				sessionId: h.activeSessionId,
				submitId: `submit-${h.activeSessionId}-1`,
			})
			await flushElmAuthorityForSession(h.activeSessionId)
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.completionCommitCount()).toBe(0)
			expect(h.phaseAtCompletion()).not.toBe("completed")
			const counters = getElmAuthorityCounters()
			expect(counters.hold).toBeGreaterThanOrEqual(1)
			expect(counters.lastDecision).toBe("hold")
		}, 20_000)
	})

	describe("REAL-ELM discriminator B — AUTHORIZE via production capture seam", () => {
		it("REAL-ELM-PROD-VOCAB-AUTHORIZE: source run_turn_started then agent_turn_done -> AUTHORIZE", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			setContinuationCardinalityAuthorityCaptureEnabled(true)
			const h = makeProdVocabHarness()
			emitProductionRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			emitProductionRecord({
				stage: "run_turn_started",
				sessionId: h.activeSessionId,
				runId: "run-1",
				origin: "explicit_user",
			})
			// Mark the run done so Elm clears activeRun BEFORE the commit
			// attempt.
			emitProductionRecord({
				stage: "agent_turn_done",
				sessionId: h.activeSessionId,
				runId: "run-1",
			})
			emitProductionRecord({
				stage: "submit_and_exit_seen",
				sessionId: h.activeSessionId,
				submitId: `submit-${h.activeSessionId}-1`,
			})
			await flushElmAuthorityForSession(h.activeSessionId)
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.completionCommitCount()).toBe(1)
			expect(h.phaseAtCompletion()).toBe("completed")
			const counters = getElmAuthorityCounters()
			expect(counters.authorize).toBeGreaterThanOrEqual(1)
			expect(counters.lastDecision).toBe("authorize")
		}, 20_000)
	})
})
