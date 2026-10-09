/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01
 *
 * First production Elm authority seam — completion commit eligibility.
 *
 * Goal: prove the CAUSAL relationship between Elm's decision and the
 * TypeScript completion-commit effect.
 *
 * Architecture (per ACT §2):
 *   factual production inputs
 *     -> Elm authoritative evaluation
 *     -> closed decoded decision
 *     -> TypeScript effect executor
 *
 * Elm OWNS:
 *   - completion lifecycle model relevant to this seam
 *   - whether completion commit is presently allowed
 *   - rejection / not-ready / violation result for this seam
 *
 * TypeScript OWNS:
 *   - filesystem
 *   - queues
 *   - the actual side-effect execution
 *
 * Discriminators (per ACT §9):
 *   A. NOT_READY  -> 0 commit effect calls (when the legacy TS predicate
 *                    WOULD commit).
 *   B. COMMIT     -> 1 commit effect call (when the legacy TS predicate
 *                    commits).
 *   C. failure    -> 0 commit effect calls + explicit classification
 *                    emitted (no silent TS fallback).
 *
 * RED: this test asserts (A) - the Elm NOT_READY decision MUST suppress
 * the real production commit effect. Currently TS owns the decision and
 * the effect fires unconditionally, so this test RED-fails on the
 * baseline (no Elm authority wiring yet).
 */

import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import { type ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"
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
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

interface TestHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly translatorState: MessageTranslatorState
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly completionCommitCount: () => number
	readonly phaseAtCompletion: () => string
}

interface MakeHarnessOpts {
	readonly getElmCompletionAuthorityDecision?: () => ElmCompletionAuthorityDecision
}

function makeHarness(opts: MakeHarnessOpts = {}): TestHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-elm-seam01"
	const activeTaskId = "task-elm-seam01"

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
		// All BCB/BNCA/PPCA predicates report zero (no holds). The TS
		// legacy path would commit in this scenario.
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
		// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
		// the legacy silent default-Authorize fallback has been
		// removed. The provider is REQUIRED. The harness passes the
		// supplied `opts.getElmCompletionAuthorityDecision`; if no
		// provider is supplied, an authorize-by-default provider is
		// injected so existing tests (which exercised the OFF path
		// in the predecessor ACT) remain byte-identical to legacy
		// TS behavior.
		getElmCompletionAuthorityDecision:
			opts.getElmCompletionAuthorityDecision ?? (() => ({ kind: "authorize", reason: "test_default_authorize" })),
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
// RED tests (C1) — discriminator A
// =============================================================================

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01 — first production authority seam", () => {
	describe("RED — discriminator A: Elm NOT_READY suppresses the real production commit", () => {
		it("EAS01-RED-A: TS legacy path commits; Elm-wired hold suppresses effect", async () => {
			// CONTROL: same scenario without Elm wiring, TS commits.
			const controlHarness = makeHarness()
			controlHarness.translatorState.setAttemptCompletionSeen()
			controlHarness.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(controlHarness.coordinator, controlHarness.activeSessionId, controlHarness.translatorState)
			expect(controlHarness.completionCommitCount()).toBe(1)

			// EXPERIMENT: same scenario, Elm says NOT_READY.
			const elmHarness = makeHarness({
				getElmCompletionAuthorityDecision: () => ({
					kind: "hold",
					reason: "test_red",
					holdReasons: ["test_red"],
				}),
			})
			elmHarness.translatorState.setAttemptCompletionSeen()
			elmHarness.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(elmHarness.coordinator, elmHarness.activeSessionId, elmHarness.translatorState)

			// The Elm hold MUST suppress the commit effect.
			expect(elmHarness.completionCommitCount()).toBe(0)
			expect(elmHarness.phaseAtCompletion()).not.toBe("completed")
		}, 15_000)
	})

	describe("GREEN — discriminator B: Elm COMMIT preserves the existing effect (no regression)", () => {
		it("EAS01-GREEN-B: Elm says authorize -> exactly one production commit effect fires", async () => {
			const h = makeHarness({
				getElmCompletionAuthorityDecision: () => ({ kind: "authorize", reason: "no_hold_reasons" }),
			})
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.completionCommitCount()).toBe(1)
			expect(h.phaseAtCompletion()).toBe("completed")
		}, 15_000)

		it("EAS01-GREEN-B-pair: Elm off-by-default produces exactly one commit (byte-identical to legacy)", async () => {
			// No getElmCompletionAuthorityDecision passed -> default -> legacy TS path.
			const h = makeHarness()
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.completionCommitCount()).toBe(1)
			expect(h.phaseAtCompletion()).toBe("completed")
		}, 15_000)
	})

	describe("RED — discriminator C: Elm failure (no session / decode / kernel) suppresses the effect with no silent TS fallback", () => {
		it("EAS01-RED-C1: Elm says failure(elm_authority_no_session) -> 0 commit effect calls, explicit classification", async () => {
			const h = makeHarness({
				getElmCompletionAuthorityDecision: () => ({
					kind: "failure",
					reason: "elm_authority_no_session",
					classification: "elm_authority_no_session",
				}),
			})
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.completionCommitCount()).toBe(0)
			expect(h.phaseAtCompletion()).not.toBe("completed")
		}, 15_000)

		it("EAS01-RED-C2: Elm says failure(elm_authority_decode_error) -> 0 commit effect calls", async () => {
			const h = makeHarness({
				getElmCompletionAuthorityDecision: () => ({
					kind: "failure",
					reason: "elm_authority_decode_error",
					classification: "elm_authority_decode_error",
				}),
			})
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.completionCommitCount()).toBe(0)
		}, 15_000)

		it("EAS01-RED-C3: Elm decision provider throws -> 0 commit effect calls, no silent fallback", async () => {
			const h = makeHarness({
				getElmCompletionAuthorityDecision: () => {
					throw new Error("kernel not loaded")
				},
			})
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.completionCommitCount()).toBe(0)
		}, 15_000)
	})
})
