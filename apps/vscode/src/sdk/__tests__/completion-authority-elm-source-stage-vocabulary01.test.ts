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
 * ## Discriminators (per ACT §5, §6, §8 — corrected for C1)
 *
 *   A. REAL-ELM-PROD-VOCAB-SOURCE-FLOWS-THROUGH-FILTER (TRANSPORT):
 *      PROVES production `run_turn_started` reaches the Elm kernel via
 *      the real capture seam. Asserts `counters.states >= 2` after
 *      flushing. DO NOT infer completion behavior from this test —
 *      transport is independent of semantic.
 *
 *   B. REAL-ELM-PROD-VOCAB-SEMANTIC-ACTIVE-RUN-BLOCKS-COMMIT (SEMANTIC):
 *      Sequence:
 *          task_started
 *          run_turn_started     (active run becomes visible to Elm)
 *          submit_and_exit_seen (binds commitReadyRun := activeRun)
 *      No `pending_prompt_enqueued` (removed per C1 reviewer's
 *      HALT_CAUSAL_CLAIM_INVALID adjudication — the previous HOLD test
 *      conflated two independent hold reasons and could not attribute
 *      `commitCount = 0` to `run_turn_started → activeRun` alone).
 *      No `agent_turn_done` — the run stays active when the BCB
 *      barrier consults.
 *
 *      Expected:
 *        counters.states  >= 2     (proves run_turn_started reached Elm)
 *        counters.hold    >= 1     (proves Elm observed the active run)
 *        counters.lastDecision = "hold"
 *        commitCount      = 0      (BCB barrier consults lastDecision,
 *                                   reads "hold", suppresses commit)
 *        final phase      != "completed"
 *
 *      Why `commitCount = 0` IS the correct LIVE contract:
 *        - The Elm kernel's `computeHoldReasons` (Authority.elm:499-592)
 *          returns `[ActiveRun]` whenever `model.activeRun /= Nothing`.
 *        - The Codec encodes `holdReasons = computeHoldReasons model`.
 *        - The TS BCB barrier consults `lastDecision`, which reflects
 *          the most-recent kernel drain (`holdReasons = ["ActiveRun"]`
 *          after `submit_and_exit_seen`).
 *        - `checkElmCompletionAuthority` returns false for `kind: "hold"`,
 *          suppressing the `setTurnPhase("completed", ...)` commit effect.
 *        - Result: `commitCount = 0`.
 *
 *      The Elm kernel's `completionCommitHoldReasons`
 *      (Authority.elm:453-460) — which filters `ActiveRun` when
 *      `commitReadyRun == activeRun` — is consulted ONLY inside
 *      `handleTaskCompletionCommitted` (Authority.elm:410-434). But
 *      `task_completion_committed` is deliberately EXCLUDED from
 *      `AUTHORITY_STAGES` (it is a POST-DECISION stage), so it never
 *      reaches the Elm kernel in normal production flow. Therefore
 *      `completionCommitHoldReasons` is dead code in the LIVE path,
 *      and the LIVE contract IS that an active run blocks commit
 *      via the BCB barrier's `checkElmCompletionAuthority(lastDecision)`
 *      consult.
 *
 *      Architectural consequence: if/when the LIVE contract is
 *      actually expected to be AUTHORIZE on `submit_and_exit_seen`
 *      while a run is still active (the
 *      ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-REPAIR01
 *      intent), the BCB barrier must be rewired to consult
 *      `completionCommitHoldReasons` semantics instead of
 *      `computeHoldReasons` — or `task_completion_committed` must be
 *      admitted to AUTHORITY_STAGES. Either is a separate, larger ACT
 *      (the H1_ELM_TOO_STRICT verdict the predecessor discriminator
 *      ACT identified). This ACT does NOT make that architectural
 *      decision; it correctly captures the current LIVE contract.
 *
 *   C. REAL-ELM-PROD-VOCAB-ADAPTER (boundary invariant):
 *      adaptRecord maps source `run_turn_started` -> Elm `run_started`
 *      wire tag. Pure boundary check.
 *
 *   D. REAL-ELM-PROD-VOCAB-ABLATION (necessity, transport-only):
 *      Reverting only the AUTHORITY_STAGES filter entry back to
 *      `run_started` returns counters.states = 1 (the source
 *      record does NOT reach the kernel). Proves the single-line
 *      filter fix is NECESSARY for the source-vocab → Elm transport
 *      contract. Completion behavior is NOT inferred from this
 *      ablation; the rejection-at-filter makes the kernel never
 *      observe activeRun, so any commit observable here is the
 *      buggy pre-fix transport behavior, not the correct semantic.
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import {
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	getElmAuthorityCounters,
	isElmAuthorityAvailable,
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
		// ACT-CLINEMM-ELM-SEAM04: tests inject the legacy SEAM03
		// policy as the consumeTerminalAuthority stub so the
		// coordinator's effect interpreter is exercised without
		// loading the Elm kernel. Production wiring uses
		// `defaultElmAuthority`.
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
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

		it("REAL-ELM-PROD-VOCAB-SOURCE-FLOWS-THROUGH-FILTER (TRANSPORT, no commit inference)", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			expect(isElmAuthorityAvailable()).toBe(true)
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

	describe("REAL-ELM semantic discriminator — C1-corrected LIVE contract", () => {
		it("REAL-ELM-PROD-VOCAB-SEMANTIC-ACTIVE-RUN-BLOCKS-COMMIT: source run_turn_started reaches Elm, BCB barrier holds commit", async () => {
			// C1-corrected LIVE contract per the reviewer's
			// HALT_CAUSAL_CLAIM_INVALID adjudication:
			//
			// Sequence:
			//   task_started
			//   run_turn_started     (active run becomes visible to Elm)
			//   submit_and_exit_seen (binds commitReadyRun := activeRun)
			//
			// NO `pending_prompt_enqueued` — confounded in the previous
			// HOLD test (it was injected as a parallel hold reason that
			// could not be disentangled from `run_turn_started → activeRun`).
			//
			// NO `agent_turn_done` — the run stays active when the BCB
			// barrier consults.
			//
			// Expected (per current LIVE architecture — see file header):
			//   counters.states  >= 2     (run_turn_started reached Elm)
			//   counters.hold    >= 1     (Elm observed active run)
			//   counters.lastDecision = "hold"
			//   commitCount      = 0      (BCB barrier consults lastDecision
			//                                → "hold" → suppresses commit)
			//   final phase      != "completed"
			//
			// Why `commitCount = 0` IS the LIVE contract (not
			// `commitCount = 1` as the reviewer's first-pass claim
			// suggested): see file header for the full causal walk.
			// The `commitReadyRun == activeRun` suppression rule
			// exists in Authority.elm:453-460 but is consulted only
			// inside `handleTaskCompletionCommitted` (which never
			// receives a record because `task_completion_committed` is
			// a POST-DECISION stage excluded from AUTHORITY_STAGES).
			// The LIVE BCB barrier consults `lastDecision` which
			// reflects `computeHoldReasons` (unfiltered).
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
			// NO `pending_prompt_enqueued` (C1: removed confounded hold
			// reason). NO `agent_turn_done` (run stays active).
			emitProductionRecord({
				stage: "submit_and_exit_seen",
				sessionId: h.activeSessionId,
				submitId: `submit-${h.activeSessionId}-1`,
			})
			await flushElmAuthorityForSession(h.activeSessionId)
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			// C1-P1 composite witness: capture the full semantic observation in
			// ONE tuple so the ablation records the COMPLETE failure mode
			// (not just the first mismatched field). Vitest's `toEqual`
			// failure message prints the full `received` vs `expected`
			// objects, so this single assertion surfaces ALL six fields
			// (states, hold, authorize, lastDecision, commitCount, phase)
			// in the failure payload. When the filter is reverted to
			// "run_started" (ablation), the values flip to:
			//   { states = 1, hold = 0, authorize = 1, lastDecision = "authorize",
			//     commitCount = 1, phase = "completed" }
			// which is the operational regression the fix prevents.
			const counters = getElmAuthorityCounters()
			const compositeWitness = {
				states: counters.states,
				hold: counters.hold,
				authorize: counters.authorize,
				lastDecision: counters.lastDecision,
				commitCount: h.completionCommitCount(),
				phase: h.phaseAtCompletion(),
			}
			// Transport proof: run_turn_started reached Elm (states >= 2).
			// Semantic proof: Elm observed the active run and decided HOLD
			// (hold >= 1, lastDecision = "hold", commitCount = 0, phase
			// != "completed"). The fixed LIVE contract for the composite
			// is below — when ablation reverts the filter, ALL six fields
			// regress and the failure message shows the full diff.
			expect(compositeWitness).toEqual({
				states: expect.any(Number),
				hold: expect.any(Number),
				authorize: expect.any(Number),
				lastDecision: "hold",
				commitCount: 0,
				phase: expect.not.stringMatching(/^completed$/),
			})
			// Numeric gates on states and hold (above the lower bounds):
			expect(compositeWitness.states).toBeGreaterThanOrEqual(2)
			expect(compositeWitness.hold).toBeGreaterThanOrEqual(1)
		}, 20_000)
	})
})
