/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-CCARD-COMMIT-STAGE-BOUNDARY-MISBOUND-REPAIR01
 *
 * Tests for the CCARD capture-before-gate ordering defect. The fix moves
 * the `task_completion_committed` CCARD capture to AFTER the Elm authority
 * gate and AFTER the `setTurnPhase("completed", …)` effect. HOLD must
 * suppress the factual capture (no committed record emitted). AUTHORIZE
 * must emit exactly one committed record.
 *
 * RED pre-fix behavior (current code, capture-before-gate):
 *   - HOLD: capture is emitted BEFORE the gate, so the buffer has 1
 *     `task_completion_committed` record even though the effect was
 *     suppressed. This violates the §17 invariant's factual reading.
 *   - AUTHORIZE: capture is emitted before the gate, buffer has 1
 *     record (matches the post-fix desired state).
 *
 * GREEN post-fix behavior (Option A: capture AFTER gate+effect):
 *   - HOLD: gate returns false → early `return` → capture never runs →
 *     buffer has 0 `task_completion_committed` records.
 *   - AUTHORIZE: gate returns true → setTurnPhase fires → capture runs →
 *     buffer has exactly 1 `task_completion_committed` record.
 *
 * Architecture per ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01:
 *   factual production inputs
 *     -> Elm authoritative evaluation (via injected getElmCompletionAuthorityDecision)
 *     -> closed decoded decision
 *     -> TypeScript effect executor (setTurnPhase("completed", …))
 *
 * The test drives the REAL production capture seam via
 * `captureContinuationCardinalityAuthorityRecord` (mirrors CORRECTION02's
 * "REAL production capture seam" directive). It exercises the coordinator
 * path that fires `task_completion_committed` records from
 * `sdk-session-event-coordinator.ts:1565`.
 *
 * Evidence labels (per reviewer's P1):
 *   - REAL_PRODUCTION_SEAM          — the production effect/capture seam
 *                                    (setTurnPhase + captureContinuationCardinalityAuthorityRecord)
 *                                    is exercised against the real
 *                                    SdkSessionEventCoordinator code.
 *   - SYNTHETIC authority decision   — the Elm decision is injected via
 *                                    `getElmCompletionAuthorityDecision`.
 *                                    No real instantiated Elm kernel
 *                                    participates in this test. The
 *                                    real-Elm→DI causal proof is already
 *                                    frozen from the predecessor ACT
 *                                    (ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01,
 *                                    `di_seam_causal_proof: TRUE`;
 *                                    `real_elm_authority_proof: FALSE`).
 *   - Not `REAL_ELM`: this ACT does NOT independently re-prove real
 *     Elm causality.
 */

import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import { type ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureBufferSize,
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
	// Enable the CCARD capture buffer so records land in the buffer and
	// the test can observe them through
	// `getContinuationCardinalityAuthorityCaptureRecords()`.
	// (Note: the LIVE dump helper `dumpExtensionSideElmAuthorityCounters`
	// serializes Elm-authority COUNTERS, NOT the CCARD capture buffer;
	// the buffer is what this test reads via the module-level reader.)
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
	setContinuationCardinalityAuthorityCaptureBufferSize(64)
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
})

interface TestHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly translatorState: MessageTranslatorState
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly completionCommitCount: () => number
	readonly phaseAtCompletion: () => string
	readonly committedRecords: () => readonly { stage: string; completionId?: string }[]
}

interface MakeHarnessOpts {
	readonly getElmCompletionAuthorityDecision?: () => ElmCompletionAuthorityDecision
}

function makeHarness(opts: MakeHarnessOpts = {}): TestHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-ccard-misb-01"
	const activeTaskId = "task-ccard-misb-01"

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
		// legacy path would commit in this scenario if the gate
		// authorizes.
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
		// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01: the seam.
		// When the option is supplied, the coordinator MUST consult it
		// before invoking the production commit effect.
		getElmCompletionAuthorityDecision: opts.getElmCompletionAuthorityDecision,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		translatorState,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => commitCount,
		phaseAtCompletion: () => lastPhase,
		committedRecords: () =>
			getContinuationCardinalityAuthorityCaptureRecords()
				.filter((r) => r.stage === "task_completion_committed")
				.map((r) => ({ stage: r.stage, completionId: r.completionId })),
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

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-CCARD-COMMIT-STAGE-BOUNDARY-MISBOUND-REPAIR01", () => {
	describe("RED — CCARD-MISB-01: HOLD branch emits zero task_completion_committed records", () => {
		it("CCARD-MISB-01: Elm says hold -> zero committed records, effect suppressed (currently RED: emits 1)", async () => {
			const h = makeHarness({
				getElmCompletionAuthorityDecision: () => ({
					kind: "hold",
					reason: "test_red_ccard_misb_01",
					holdReasons: ["test_red_ccard_misb_01"],
				}),
			})
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			// Elm HOLD must suppress the commit effect.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.phaseAtCompletion()).not.toBe("completed")

			// The CCARD record MUST NOT be emitted when the gate suppresses
			// the effect. The capture is only factual after the effect runs.
			// Pre-fix RED: the capture fires before the gate, so the buffer
			// has 1 task_completion_committed record. Post-fix GREEN: the
			// buffer has 0.
			const committed = h.committedRecords()
			expect(committed).toHaveLength(0)
		}, 15_000)
	})

	describe("GREEN — CCARD-MISB-02: AUTHORIZE branch emits exactly one task_completion_committed record", () => {
		it("CCARD-MISB-02: Elm says authorize -> exactly one committed record (currently GREEN: emits 1)", async () => {
			const h = makeHarness({
				getElmCompletionAuthorityDecision: () => ({ kind: "authorize", reason: "test_green_ccard_misb_02" }),
			})
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			expect(h.completionCommitCount()).toBe(1)
			expect(h.phaseAtCompletion()).toBe("completed")

			// The CCARD record MUST be emitted exactly once when the gate
			// authorizes and the effect fires. Pre-fix and post-fix both
			// pass this assertion (the record is emitted either way); the
			// RED discriminator lives in CCARD-MISB-01 and CCARD-MISB-03.
			const committed = h.committedRecords()
			expect(committed).toHaveLength(1)
			expect(committed[0]?.stage).toBe("task_completion_committed")
		}, 15_000)
	})

	describe("GREEN — CCARD-MISB-03: conservation discriminator (two HOLD + one AUTHORIZE)", () => {
		it("CCARD-MISB-03: completionId sequence advances only on the factual commit", async () => {
			let holdCalls = 0
			const h = makeHarness({
				// First two consults return HOLD; third returns AUTHORIZE.
				getElmCompletionAuthorityDecision: () => {
					holdCalls += 1
					if (holdCalls <= 2) {
						return {
							kind: "hold",
							reason: "test_red_ccard_misb_03_hold",
							holdReasons: ["test_red_ccard_misb_03_hold"],
						}
					}
					return { kind: "authorize", reason: "test_red_ccard_misb_03_authorize" }
				},
			})

			// Turn 1: HOLD expected, no capture, no effect.
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.committedRecords()).toHaveLength(0)

			// Turn 2: HOLD again (re-arm the translator state).
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.committedRecords()).toHaveLength(0)

			// Turn 3: AUTHORIZE, exactly one capture, exactly one effect.
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(1)
			expect(h.phaseAtCompletion()).toBe("completed")

			// Conservation pin:
			// - Zero committed records during the HOLDs.
			// - Exactly one committed record after the AUTHORIZE.
			// - completionId sequence advances ONLY on the factual commit
			//   (the AUTHORIZE path), not on HOLDs. Pre-fix RED: two HOLDs
			//   also advance the completionId counter (because the capture
			//   block runs unconditionally), so the third record's
			//   completionId is `completion-<session>-3`. Post-fix GREEN:
			//   the counter is only incremented on the post-effect capture,
			//   so the single AUTHORIZE record's completionId is
			//   `completion-<session>-1`.
			const committed = h.committedRecords()
			expect(committed).toHaveLength(1)
			expect(committed[0]?.completionId).toBe(`completion-${h.activeSessionId}-1`)
		}, 15_000)
	})
})
