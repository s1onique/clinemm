/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION01-REAL-ELM-PROVIDER
 *
 * Real-Elm authority discriminator
 *
 * Goal: prove the CAUSAL relationship between a REAL compiled Elm
 * kernel application instance and the TypeScript completion-commit
 * effect. The provider in the DI seam must originate from an actual
 * `Elm.Main.init({})` instance — NOT a synthetic function that
 * returns an Elm-shaped object.
 *
 * Discriminators (per ACT §12-§14):
 *   A. HOLD     -> 0 commit effect calls (when the legacy TS predicate
 *                  WOULD commit).
 *   B. AUTHORIZE -> 1 commit effect call.
 *   C. FAILURE  -> 0 commit effect calls + explicit classification
 *                  (no silent TS fallback).
 *
 * The provider module being tested is
 * `completion-authority-elm-authority-runtime.ts`. It is wired exactly
 * the way the production extension.ts:activate wires it.
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import {
	enqueueElmAuthorityRecord,
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	getElmAuthorityCounters,
	isElmAuthorityAvailable,
	resetElmAuthorityForTests,
	setElmAuthorityProvider,
} from "../completion-authority-elm-authority-runtime"
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
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	resetElmAuthorityForTests()
})

const HERE = fileURLToPath(import.meta.url)
const REAL_KERNEL_PATH = join(HERE, "..", "..", "..", "..", "elm", "completion-authority", "vendor", "completion-authority.js")

interface RealElmHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly translatorState: MessageTranslatorState
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly completionCommitCount: () => number
	readonly phaseAtCompletion: () => string
}

function makeRealElmHarness(): RealElmHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-elm-real-provider"
	const activeTaskId = "task-elm-real-provider"

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

// =============================================================================
// REAL-ELM discriminator tests
// =============================================================================

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION01-REAL-ELM-PROVIDER", () => {
	describe("REAL ELM kernel loading", () => {
		it("REAL-ELM-LOAD: compiled kernel loads; runtime reports enabled", () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			expect(isElmAuthorityAvailable()).toBe(true)
		}, 15_000)
	})

	describe("REAL-ELM discriminator A — HOLD", () => {
		it("REAL-ELM-HOLD: factual records induce Elm HOLD; commit suppressed", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const elmHarness = makeRealElmHarness()
			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: elmHarness.activeSessionId,
				taskId: elmHarness.activeTaskId,
			})
			// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION02:
			// the AUTHORITY_STAGES filter consumes SOURCE stage names
			// (production capture vocabulary), NOT Elm target tags.
			// Production emits `run_turn_started` (mapped to Elm
			// `run_started` inside adaptRecord). The previous version
			// of this test injected the Elm target tag directly, which
			// accidentally matched a buggy filter rather than the real
			// production capture seam.
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: elmHarness.activeSessionId,
				runId: "run-1",
				origin: "explicit_user",
			})
			await enqueueElmAuthorityRecord({
				stage: "agent_turn_done",
				sessionId: elmHarness.activeSessionId,
				runId: "run-1",
			})
			await enqueueElmAuthorityRecord({
				stage: "terminal_committed",
				sessionId: elmHarness.activeSessionId,
				jobId: "job-1",
				ownerId: elmHarness.activeSessionId,
				terminalKind: "owned",
			})
			// JOB-1 IS STILL RUNNING (lifecycle=running). No
			// notify_consume_enter/wake_created. Elm kernel:
			// jobRunningCount > 0 -> HoldCompletion running_background_job.
			await enqueueElmAuthorityRecord({
				stage: "submit_and_exit_seen",
				sessionId: elmHarness.activeSessionId,
				submitId: `submit-${elmHarness.activeSessionId}-1`,
			})
			elmHarness.translatorState.setAttemptCompletionSeen()
			elmHarness.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(elmHarness.coordinator, elmHarness.activeSessionId, elmHarness.translatorState)

			expect(elmHarness.completionCommitCount()).toBe(0)
			expect(elmHarness.phaseAtCompletion()).not.toBe("completed")
			const counters = getElmAuthorityCounters()
			expect(counters.hold).toBeGreaterThanOrEqual(1)
			expect(counters.lastDecision).toBe("hold")
		}, 20_000)
	})

	describe("REAL-ELM discriminator B — AUTHORIZE", () => {
		it("REAL-ELM-AUTHORIZE: factual clean state → Elm AUTHORIZE → exactly one commit", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeRealElmHarness()
			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "submit_and_exit_seen",
				sessionId: h.activeSessionId,
				submitId: `submit-${h.activeSessionId}-1`,
			})
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

	describe("REAL-ELM discriminator C — FAILURE", () => {
		it("REAL-ELM-FAILURE: bad kernel path → decision=failure → 0 commit", async () => {
			setElmAuthorityProvider("/nonexistent/path/to/kernel.js")
			const h = makeRealElmHarness()
			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "submit_and_exit_seen",
				sessionId: h.activeSessionId,
				submitId: `submit-${h.activeSessionId}-1`,
			})
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.completionCommitCount()).toBe(0)
			const counters = getElmAuthorityCounters()
			expect(counters.failure).toBeGreaterThanOrEqual(1)
			expect(counters.lastDecision).toBe("failure")
		}, 20_000)
	})

	describe("REAL-ELM chronology discipline (ACT §8)", () => {
		it("REAL-ELM-CHRONO: authority kernel never receives task_completion_committed", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeRealElmHarness()
			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "submit_and_exit_seen",
				sessionId: h.activeSessionId,
				submitId: `submit-${h.activeSessionId}-1`,
			})
			// The POST-DECISION stage MUST be silently dropped.
			await enqueueElmAuthorityRecord({
				stage: "task_completion_committed",
				sessionId: h.activeSessionId,
				completionId: "C-1",
			})
			await flushElmAuthorityForSession(h.activeSessionId)
			const decision = getElmAuthorityCompletionDecision(h.activeSessionId)
			expect(decision.kind).toBe("authorize")
		}, 20_000)
	})
})
