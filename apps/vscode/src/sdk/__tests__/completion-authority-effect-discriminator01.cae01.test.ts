/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-EFFECT-DISCRIMINATOR01
 *
 * Composite-witness RED/GREEN test that binds the COMPLETE chain:
 *
 *   deferredCompletionBarrier present
 *     -> notifyAgentTurnDone flush
 *     -> reevaluateDeferredCompletionBarrier
 *     -> checkElmCompletionAuthority
 *     -> setTurnPhase("completed", ...)
 *     -> captureContinuationCardinalityAuthorityRecord(task_completion_committed)
 *
 * This is the load-bearing composite witness the LIVE specimen
 * (`run_qpi4eTiw`, session `1791222861936_ay61p`) failed to produce:
 *
 *   LIVE Elm authority: authorize=1, hold=1
 *   LIVE CCARD:         task_completion_committed = 0
 *   LIVE reevaluation:  reached authority_check_reached
 *
 * The previous ACT proved `setTurnPhase("completed", ...)` is invoked
 * by the deferred reevaluation path; this test proves the FULL
 * effect seam — including the factual `task_completion_committed`
 * CCARD record — fires exactly once.
 *
 * Frozen composite witness (ACT §7):
 *   {
 *     authorityCalls,
 *     hold,
 *     authorize,
 *     authorizeDecisions,      // aggregate count of Elm decisions that returned `authorize`
 *                             // — P1 HYGIENE: NOT the boolean returned by the
 *                             //   specific `checkElmCompletionAuthority(...)` consult
 *                             //   for THIS call. The causal composition is still
 *                             //   proven because `setTurnPhaseCalls=1` downstream
 *                             //   proves the caller traversed the AUTHORIZE branch.
 *     setTurnPhaseCalls,
 *     completedPhaseCalls,
 *     committedRecords,        // count of `task_completion_committed`
 *     completionIds,           // unique completionIds captured
 *     markerPresentAfter,      // deferredCompletionBarrier cleared?
 *   }
 *
 * Expected GREEN:
 *   authorityCalls          >= 2
 *   hold                    = 1
 *   authorize               = 1
 *   authorizeDecisions      = 1
 *   setTurnPhaseCalls       = 1
 *   completedPhaseCalls     = 1
 *   committedRecords        = 1
 *   unique completionIds    = 1
 *   markerPresentAfter      = false
 *
 * Controls (ACT §8-§9):
 *   CAE-CONTROL-HOLD        - no agent_turn_done -> 0 commit (HOLD preserved)
 *   CAE-CONTROL-OFF         - Elm OFF (legacy default) -> byte-identical
 *
 * Discriminators (ACT §10-§14) — pinpoint WHICH transition fails:
 *
 *     authorityCalls === 2 but authorizeDecisions === 0
 *       -> CLASS A: AUTHORITY_CORRELATION. Stale/wrong per-session consult.
 *     authorizeDecisions === 1 but setTurnPhaseCalls === 0
 *       -> CLASS B: EFFECT_WIRING_MISSING. setTurnPhase is absent.
 *     setTurnPhaseCalls === 1 but committedRecords === 0
 *       -> CLASS D: POST_EFFECT_CAPTURE_FAILED. CCARD seam absent at this site.
 *     setTurnPhaseCalls === 1 but completedPhaseCalls === 0
 *       -> CLASS C: EFFECT_FAILED. setTurnPhase threw or mutated wrong phase.
 *     setTurnPhaseCalls === 2
 *       -> HALT_CARDINALITY_REGRESSION.
 *
 * Run:
 *   bun run test:unit -- completion-authority-effect-discriminator01
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import {
	enqueueElmAuthorityRecord,
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	getElmAuthorityCounters,
	isElmAuthorityEnabled,
	resetElmAuthorityForTests,
	setElmAuthorityProvider,
} from "../completion-authority-elm-authority-runtime"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	getContinuationCardinalityAuthorityCounters,
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
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	resetElmAuthorityForTests()
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
})

const HERE = fileURLToPath(import.meta.url)
const REAL_KERNEL_PATH = join(HERE, "..", "..", "..", "..", "elm", "completion-authority", "vendor", "completion-authority.js")

interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly translatorState: MessageTranslatorState
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly setTurnPhaseCalls: () => number
	readonly completedPhaseCalls: () => number
	readonly phaseAtCompletion: () => string
	readonly setTurnPhasePresent: () => boolean
}

function makeHarness(opts: { activeSessionId: string; activeTaskId: string }): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const wakeSinkQueue: Array<{ sessionId: string; prompt: string }> = []
	let nowCounter = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: opts.activeSessionId, taskId: opts.activeTaskId }),
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

	let setTurnPhaseCallsCount = 0
	let completedPhaseCallsCount = 0
	let lastPhase = "idle"
	let setTurnPhasePresent = false
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: opts.activeSessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: opts.activeSessionId } as never,
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: ((_msgs: unknown[]) => {}) as never as never,
		},
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => ({ taskId: opts.activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			setTurnPhasePresent = true
			setTurnPhaseCallsCount += 1
			if (phase === "completed") {
				completedPhaseCallsCount += 1
			}
			lastPhase = phase
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
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
		activeSessionId: opts.activeSessionId,
		activeTaskId: opts.activeTaskId,
		setTurnPhaseCalls: () => setTurnPhaseCallsCount,
		completedPhaseCalls: () => completedPhaseCallsCount,
		phaseAtCompletion: () => lastPhase,
		setTurnPhasePresent: () => setTurnPhasePresent,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent => ({
	type: "agent_event",
	payload: {
		sessionId,
		event: event as never,
	},
})

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

/**
 * Read the live composite witness from the production capture seams.
 * Returns the §7 frozen shape.
 */
function readWitness(h: Harness): {
	authorityCalls: number
	hold: number
	authorize: number
	authorizeDecisions: number
	setTurnPhaseCalls: number
	completedPhaseCalls: number
	committedRecords: number
	completionIds: readonly string[]
	markerPresentAfter: boolean
} {
	const elmCounters = getElmAuthorityCounters()
	const ccardCounters = getContinuationCardinalityAuthorityCounters()
	const ccardRecords = getContinuationCardinalityAuthorityCaptureRecords()
	const completionRecords = ccardRecords.filter((r) => r.stage === "task_completion_committed")
	const completionIds = Array.from(new Set(completionRecords.map((r) => r.completionId).filter((v): v is string => !!v)))
	// authorityCalls: count of Elm consults (aggregate, per-extension-host).
	const authorityCalls = elmCounters.total
	// P1 HYGIENE: `authorizeDecisions` is the aggregate count of Elm
	// decisions that returned `authorize`. It is NOT a per-call read
	// of the boolean returned by `checkElmCompletionAuthority(...)` for
	// THIS consult. The causal composition is still proven because
	// `setTurnPhaseCalls=1` downstream proves the caller traversed
	// the AUTHORIZE branch (the only kind that returns true).
	const authorizeDecisions = elmCounters.authorize
	const markerPresent = h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()
	return {
		authorityCalls,
		hold: elmCounters.hold,
		authorize: elmCounters.authorize,
		authorizeDecisions,
		setTurnPhaseCalls: h.setTurnPhaseCalls(),
		completedPhaseCalls: h.completedPhaseCalls(),
		committedRecords: ccardCounters.stages.task_completion_committed.count,
		completionIds,
		markerPresentAfter: markerPresent,
	}
}

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-EFFECT-DISCRIMINATOR01", () => {
	describe("CAE-01 - real AUTHORIZE path with composite witness", () => {
		it("after Elm HOLD at submit, agent_turn_done reevaluates to AUTHORIZE -> setTurnPhase + CCARD committed once", async () => {
			expect(isElmAuthorityEnabled()).toBe(false)
			setElmAuthorityProvider(REAL_KERNEL_PATH)

			const h = makeHarness({
				activeSessionId: "session-cae01-green",
				activeTaskId: "task-cae01-green",
			})

			// CHRONOLOGY MIRRORS LIVE SPECIMEN:
			//   seq 1 task_started
			//   seq 2 run_turn_started
			//   seq 3 submit_and_exit_seen (Elm HOLD active_run)
			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: h.activeSessionId,
				runId: "run-cae01-1",
				origin: "explicit_user",
			})

			// Drive submit_and_exit_seen via the production completion path.
			// The C10 commit attempt fires the deferred-barrier check
			// (which holds because Elm says HOLD on active_run).
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completedPhaseCalls()).toBe(0)
			expect(h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()).toBe(true)
			expect(getElmAuthorityCounters().lastDecision).toBe("hold")

			// CHRONOLOGY MIRRORS LIVE SPECIMEN:
			//   seq 4 agent_turn_done (factual, from
			//        LocalRuntimeHost.runTurn post-resolution)
			// notifyAgentTurnDone MUST flush the agent_turn_done record
			// into the live Elm kernel BEFORE consulting the second decision.
			await enqueueElmAuthorityRecord({
				stage: "agent_turn_done",
				sessionId: h.activeSessionId,
				runId: "run-cae01-1",
			})

			// CHRONOLOGY MIRRORS LIVE SPECIMEN:
			//   seq 5 notifyAgentTurnDone fires -> reevaluate
			await h.coordinator.notifyAgentTurnDone(h.activeSessionId)

			// Read the COMPOSITE WITNESS.
			const w = readWitness(h)

			// biome-ignore lint/suspicious/noConsole: ACT report (§31) requires the witness to be printed on failure.
			console.log("[CAE-01] composite witness:", JSON.stringify(w, null, 2))

			// ASSERT - frozen GREEN contract (ACT §7):
			expect(w.authorityCalls).toBeGreaterThanOrEqual(2)
			expect(w.hold).toBe(1)
			expect(w.authorize).toBe(1)
			expect(w.authorizeDecisions).toBe(1)
			expect(w.setTurnPhaseCalls).toBe(1)
			expect(w.completedPhaseCalls).toBe(1)
			expect(w.committedRecords).toBe(1)
			expect(w.completionIds.length).toBe(1)
			expect(w.markerPresentAfter).toBe(false)

			// And the final observable phase MUST be the canonical
			// "completed" state (no silent straggler phase):
			expect(h.phaseAtCompletion()).toBe("completed")
		}, 20_000)
	})

	describe("CAE-02 - HOLD control (no agent_turn_done)", () => {
		it("submit_and_exit_seen only -> Elm HOLD -> 0 setTurnPhase, 0 committed", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				activeSessionId: "session-cae02-hold",
				activeTaskId: "task-cae02-hold",
			})

			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: h.activeSessionId,
				runId: "run-cae02-1",
				origin: "explicit_user",
			})
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			const w = readWitness(h)
			expect(w.authorizeDecisions).toBe(0)
			expect(w.setTurnPhaseCalls).toBe(0)
			expect(w.completedPhaseCalls).toBe(0)
			expect(w.committedRecords).toBe(0)
			expect(w.completionIds.length).toBe(0)
			expect(w.markerPresentAfter).toBe(true)
		}, 20_000)
	})

	describe("CAE-03 - OFF conservation (Elm authority OFF)", () => {
		it("OFF path -> defaultGetElmCompletionAuthorityDecision -> legacy TS commit, no Elm consult", async () => {
			// Do NOT call setElmAuthorityProvider - runtime stays OFF.
			expect(isElmAuthorityEnabled()).toBe(false)
			const h = makeHarness({
				activeSessionId: "session-cae03-off",
				activeTaskId: "task-cae03-off",
			})

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)

			const w = readWitness(h)
			// OFF path: legacy TS predicate chain is the sole authority,
			// the C10 commit fires (no outstanding obligations in this
			// minimal harness), exactly one setTurnPhase + one CCARD
			// committed. NO Elm consults occurred (authorityCalls === 0).
			expect(w.authorityCalls).toBe(0)
			expect(w.setTurnPhaseCalls).toBe(1)
			expect(w.completedPhaseCalls).toBe(1)
			expect(w.committedRecords).toBe(1)
			expect(w.completionIds.length).toBe(1)
			expect(w.markerPresentAfter).toBe(false)
		}, 20_000)
	})
})
