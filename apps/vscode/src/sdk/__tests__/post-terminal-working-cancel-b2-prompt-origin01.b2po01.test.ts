/**
 * ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01-PROMPT-ORIGIN01
 * / B2PO01
 *
 * THE BOUNDED PROBE DIRECTED BY THE REVIEW OF `86adc504b`
 * (`HALT_B2_PROMPT_ORIGIN_UNVERIFIED`).
 *
 * THE QUESTION
 *
 *   The predecessor ACT (PTWCR01C01) added boundary B2 to
 *   `SdkSessionEventCoordinator.handleSessionEvent`: a
 *   `pending_prompt_submitted` event no longer re-asserts `streaming`
 *   while the deferred-completion BARRIER holds the active turn's
 *   completion.
 *
 *   The B2 discriminator is the barrier's IDENTITY TRIPLE
 *   (`sessionId` / `taskId` / `epoch`) — NOT the prompt's origin:
 *
 *     apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3400
 *       const barrierHoldsThisTurn =
 *         this.isDeferredCompletionBarrierLiveFor(activeSession.sessionId)
 *
 *   The reviewer's concern (source-confirmed, NOT yet a reproduced
 *   runtime defect):
 *
 *     The coordinator treats "a matching deferred-completion barrier
 *     exists" as evidence that the incoming `pending_prompt_submitted`
 *     belongs to the BCB's OWN continuation. But
 *
 *     - `PendingPromptService.drain()` can dispatch ANY queued prompt
 *       (a user-typed follow-up) while a session can start a run;
 *     - `PendingPromptService.emitSubmitted()` fires BEFORE the actual
 *       `deps.send(...)` (`pending-prompt-service.ts:557-558` vs
 *       `:586`);
 *     - the emitted `pending_prompt_submitted` payload carries NO
 *       `runtimeControlKind` or equivalent origin discriminator
 *       (`sdk/packages/core/src/types/events.ts:55-63`), even though
 *       `PendingPromptEntry.runtimeControlKind` EXISTS
 *       (`pending-prompt-service.ts:65`) and is surfaced at C5/C6 and
 *       forwarded to `deps.send`. `snapshotPrompt` DROPS it
 *       (`pending-prompt-service.ts:681-691`).
 *
 *   So the coordinator CANNOT tell a BCB continuation from an
 *   independent user prompt at the B2 seam. The possible opposite
 *   inconsistency is:
 *
 *     legitimate prompt dispatched + BCB still held
 *       -> runtime running + UI remains `resumable`
 *
 *   The existing R1-05 test verifies legitimate activation WITHOUT a
 *   live barrier. It does NOT exercise the BCB-held case.
 *
 * WHAT THIS PROBE DOES (the reviewer's four scenarios, verbatim)
 *
 *   | Scenario | Required observation |
 *   | --- | --- |
 *   | S1 BCB held, runtime terminated, no new run | `resumable`, never false Working |
 *   | S2 BCB held, real queued continuation starts a new model run | eventually truthful active phase |
 *   | S3 BCB held, independent user prompt starts a new model run | legitimate activation is not indefinitely hidden |
 *   | S4 BCB-published `resumable`, then explicit Cancel and late `done` | cancellation authority preserved; no fabricated C10 |
 *
 * REAL PRODUCTION BOUNDARIES exercised (no synthetic stand-ins for the
 * load-bearing seams):
 *
 *   - the REAL `PendingPromptsController` / `PendingPromptService`
 *     (the REAL queue consumer: enqueue -> scheduleDrain -> drain ->
 *     emitSubmitted -> deps.send)
 *   - the REAL `SdkSessionEventCoordinator` (the REAL phase writer)
 *   - the REAL `TurnStateTracker` (the REAL committed phase)
 *   - the REAL `MessageTranslatorState` / `MessageIdMinter`
 *
 * The ASSERTIONS are on ACTUAL RUNTIME DISPATCH (the `send` spy fired
 * with the real prompt) and the COMMITTED PHASE (the real tracker's
 * committed snapshot) — NOT merely on event receipt.
 *
 * VERDICT MAPPING
 *
 *   NOT_REPRODUCED — no scenario exhibits the inconsistency; every
 *                   scenario's required observation holds.
 *   REPRODUCED     — a scenario exhibits the inconsistency; the
 *                   responsible phase-activation boundary is identified.
 *
 * EVIDENCE LEVEL
 *
 *   REAL_PRODUCTION_SEAM for the queue consumer, the coordinator and the
 *   tracker. The Elm COMPLETION-authority decision is INJECTED at the
 *   existing provider boundary (the same INJECTED_DECISION posture as
 *   the predecessor ACT); it is NOT live Elm execution. The model
 *   provider is a STUB: "a new model run" is observed at the REAL
 *   `deps.send` dispatch seam and the REAL agent-run seam, NOT at an
 *   actual provider request.
 */

import type { PendingPromptCountRead } from "@cline-internal/core/runtime/host/runtime-host"
import { PendingPromptsController } from "@cline-internal/core/runtime/turn-queue/pending-prompt-service"
import type { CoreSessionEvent } from "@cline-internal/core/types/events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import type { ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "../continuation-cardinality-authority"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

/**
 * The BCB obligation set the LIVE specimen carried (the four held
 * terminal observations named by the LIVE
 * `bcb-observation-unavailable-capture.jsonl` record).
 */
const LIVE_HELD_JOB_IDS = [
	"cmd_mvo9fosf9tyu4xb3",
	"cmd_mvo9fosftrej06ye",
	"cmd_mvo9fosfbixo2qfc",
	"cmd_mvo9hvbop47y3i42",
] as const

const ACTIVE_SESSION_ID = "session-b2po01"
const ACTIVE_TASK_ID = "task-b2po01"

/** The BCB's OWN continuation prompt (host runtime-control). */
const BCB_CONTINUATION_PROMPT = "[runtime-control:completion-continuation] continue the held obligation"
/** An INDEPENDENT user-typed follow-up. */
const INDEPENDENT_USER_PROMPT = "actually, please also update the README"

// ---------------------------------------------------------------------------
// HARNESS
// ---------------------------------------------------------------------------

interface Obligations {
	readonly pendingPromptAuthorityAvailable: boolean
	readonly pendingPromptCount: number
	readonly activeNotifyCount: number
	readonly ownerStillRunning: boolean
	readonly unconsumedTerminalCount: number
	readonly heldTerminalJobIds: readonly string[]
}

const NO_OBLIGATIONS: Obligations = {
	pendingPromptAuthorityAvailable: true,
	pendingPromptCount: 0,
	activeNotifyCount: 0,
	ownerStillRunning: false,
	unconsumedTerminalCount: 0,
	heldTerminalJobIds: [],
}

interface PhaseWrite {
	readonly phase: string
	readonly writerId: string | undefined
}

interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly tracker: TurnStateTracker
	readonly translatorState: MessageTranslatorState
	readonly minter: MessageIdMinter
	readonly phaseWrites: readonly PhaseWrite[]
	/** The REAL `PendingPromptsController` driving the REAL queue. */
	readonly pendingPrompts: PendingPromptsController
	/** The REAL runtime dispatch seam (`deps.send`). */
	readonly sendSpy: ReturnType<typeof vi.fn>
	/** The REAL agent-run seam (a NEW model run actually began). */
	readonly agentRunSpy: ReturnType<typeof vi.fn>
	/** The number of committed `completed` phases. */
	readonly completionCommitCount: () => number
	/** Set the independent BCB obligations. */
	setObligations: (obligations: Partial<Obligations>) => void
	/** The deferred-completion marker (the deferred authority). */
	readonly deferredMarker: () => unknown
	/** The runtime's `isRunning` flag as the coordinator sees it. */
	readonly isRunning: () => boolean
	/** Mirror the production `sessions.setRunning(...)`. */
	readonly setRunning: (running: boolean) => void
	/** Raise the canonical cancel fence (bump the epoch). */
	readonly raiseCancelFence: () => void
	/**
	 * ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01-PROMPT-ORIGIN01
	 * / B2PO01 (S2): hold the REAL dispatch seam so a dispatched model run
	 * stays IN FLIGHT (the real turn has not ended).
	 */
	readonly holdDispatch: (on: boolean) => void
	/** Release the held REAL dispatch seam. */
	readonly releaseDispatch: () => void
}

function makeHarness(): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const obligations: Obligations = { ...NO_OBLIGATIONS }
	const elmDecision: ElmCompletionAuthorityDecision = { kind: "authorize", reason: "b2po01-default-authorize" }
	let completionCommitCount = 0
	const phaseWrites: PhaseWrite[] = []

	// The runtime's liveness flag. `pending_prompt_submitted` sets it TRUE
	// (the production `sessions.setRunning(true)` at
	// sdk-session-event-coordinator.ts:3346) EVEN when the B2 guard
	// suppresses the `streaming` write — this is the very asymmetry the
	// reviewer flagged.
	let running = false

	new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: ACTIVE_SESSION_ID, taskId: ACTIVE_TASK_ID }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
		now: () => Date.now(),
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: ACTIVE_SESSION_ID,
				sdkHost: {},
				unsubscribe: vi.fn(),
				startResult: { sessionId: ACTIVE_SESSION_ID },
				isRunning: running,
			}),
			setRunning: (next: boolean) => {
				running = next
			},
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: ACTIVE_TASK_ID }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			phaseWrites.push({ phase, writerId })
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01-PROMPT-ORIGIN01
		// / B2PO01: mirror the PRODUCTION wiring
		// (`SdkController` -> `getTurnPhaseWriterId: () =>
		// this.turnStateTracker.currentWriterId`).
		getTurnPhaseWriterId: () => tracker.currentWriterId,
		translateSessionEvent,
		getElmCompletionAuthorityDecision: () => elmDecision,
		flushElmAuthorityForSession: async () => {},
		getPendingPromptCount: () =>
			obligations.pendingPromptAuthorityAvailable
				? { available: true as const, count: obligations.pendingPromptCount }
				: ({ available: false as const } as unknown as PendingPromptCountRead),
		getActiveNotifyCount: () => obligations.activeNotifyCount,
		hasActiveNotify: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		hasRunningBackgroundJobForOwner: () => obligations.ownerStillRunning,
		getUnconsumedOwnedTerminalResultCount: () => obligations.unconsumedTerminalCount,
		getUnconsumedOwnedTerminalJobIds: () => obligations.heldTerminalJobIds,
		getBackgroundCommandJobStates: () => ({}),
		getBackgroundCommandJobOwners: () => ({}),
		// The LIVE specimen's capability probe DID include
		// `command_status`, so `canObserveHeldResults === true` and the
		// BCB took the ENQUEUE branch (not the `observation_unavailable`
		// blocked branch).
		liveTools: () => ["run_commands", "command_status"],
	} as unknown as SdkSessionEventCoordinatorOptions)

	// -------------------------------------------------------------------------
	// THE REAL QUEUE CONSUMER
	// -------------------------------------------------------------------------
	//
	// `PendingPromptsController` is the PRODUCTION class the runtime
	// installs on every session. Its `drain()` performs the real:
	//
	//   shiftNext -> emitPrompts -> emitSubmitted -> deps.send
	//
	// sequence, and `emitSubmitted` is the EXACT producer of the
	// `pending_prompt_submitted` event the coordinator consumes. Using
	// the REAL class is what makes the probe's "actual runtime dispatch"
	// claim meaningful (the reviewer's explicit requirement).
	// The REAL dispatch seam. The spy records the ACTUAL dispatch (the
	// input carries the prompt text, so the assertion is on the real
	// dispatched prompt, not on a hand-built stand-in).
	const sendSpy = vi.fn(async (_input: { sessionId: string; prompt: string }) => ({ finishReason: "completed" as const }))
	const agentRunSpy = vi.fn(async (_input: { sessionId: string; prompt: string }) => ({ finishReason: "completed" as const }))

	// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01-PROMPT-ORIGIN01
	// / B2PO01 (S2): the RESUME-CONCURRENCY control.
	//
	// A REAL model run is LONG-LIVED: the dispatch seam returns a promise
	// that settles only when the turn ends. The S2 concurrency proof needs
	// the BCB continuation's run to still be IN FLIGHT while the user's
	// Resume prompt is enqueued, because the mutual-exclusion property
	// under test is exactly "a second prompt cannot start a concurrent
	// run while the first is running".
	//
	// `holdDispatch` makes the REAL `deps.send` seam block until the test
	// releases it, so the runtime's `canStartRun()` gate is observed in
	// its true state (a run in flight) rather than a synthetic one.
	//
	// TWO DISTINCT FLAGS — do not conflate them:
	//
	//   `running`      — the SESSION's liveness flag. The coordinator
	//                    reads it through `activeSession.isRunning`, and
	//                    the host sets it TRUE when a queued prompt is
	//                    submitted (`sessions.setRunning(true)`). It is
	//                    NOT the runtime's in-flight flag.
	//   `runInFlight`  — the RUNTIME's in-flight flag. It is what
	//                    `SessionRuntimeOrchestrator.canStartRun()`
	//                    negates (`!this.running && !this.shutdownCalled`)
	//                    and therefore what gates the queue drain. It is
	//                    TRUE only while a dispatched model run has not
	//                    yet ended.
	let releaseDispatch: (() => void) | undefined
	let holdDispatch = false
	let runInFlight = false

	// The fake `ActiveSession` the controller reads. Only the fields the
	// queue consumer touches are real.
	const fakeSession = {
		sessionId: ACTIVE_SESSION_ID,
		pendingPrompts: [] as unknown[],
		drainingPendingPrompts: false,
		aborting: false,
		status: "running" as const,
		agent: {
			// The REAL gate the queue consumer consults before draining.
			// This is the runtime's OWN in-flight predicate, so it
			// refuses a drain while a model run is still executing.
			canStartRun: () => !runInFlight,
		},
	}

	const pendingPrompts = new PendingPromptsController({
		getSession: (sessionId: string) => (sessionId === ACTIVE_SESSION_ID ? (fakeSession as never) : undefined),
		// The REAL event seam: every event the queue consumer emits is
		// delivered to the REAL coordinator, exactly as the VSCode
		// adapter does.
		emit: (event: CoreSessionEvent) => {
			void coordinator.handleSessionEvent(event)
		},
		// The REAL dispatch seam. The spy records the ACTUAL dispatch.
		send: async (input) => {
			sendSpy(input)
			// A NEW MODEL RUN actually begins at the agent-run seam.
			agentRunSpy(input)
			// The runtime is now running.
			running = true
			// The model run is IN FLIGHT until the turn ends. This is
			// what the runtime's `canStartRun()` gate observes.
			runInFlight = true
			if (holdDispatch) {
				// The run is IN FLIGHT (the real turn has not ended yet).
				// In PRODUCTION `deps.send` IS `runTurn`, which awaits the
				// whole agent run, so the queue's `drainingPendingPrompts`
				// latch is held for the duration of the run too. The
				// harness models the same shape.
				await new Promise<void>((resolve) => {
					releaseDispatch = resolve
				})
			}
			// The turn ENDED: the runtime's in-flight flag clears, which
			// re-opens the `canStartRun()` gate for the NEXT queued
			// prompt. This mirrors the production `fireAndForgetSend`
			// settle path (`sdk-session-lifecycle.ts:863`).
			runInFlight = false
			return { finishReason: "completed" as const }
		},
	})

	return {
		coordinator,
		tracker,
		translatorState,
		minter,
		phaseWrites,
		pendingPrompts,
		sendSpy,
		agentRunSpy,
		completionCommitCount: () => completionCommitCount,
		setObligations(next) {
			Object.assign(obligations, next)
		},
		deferredMarker: () => (coordinator as unknown as { deferredCompletionBarrier?: unknown }).deferredCompletionBarrier,
		isRunning: () => running,
		setRunning: (next: boolean) => {
			running = next
		},
		raiseCancelFence: () => {
			translatorState.clearApprovedToolMessageTs()
			minter.bumpEpoch()
		},
		// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01-PROMPT-ORIGIN01
		// / B2PO01 (S2): the RESUME-CONCURRENCY control.
		holdDispatch: (on: boolean) => {
			holdDispatch = on
		},
		releaseDispatch: () => {
			const release = releaseDispatch
			releaseDispatch = undefined
			release?.()
		},
	}
}

// ---------------------------------------------------------------------------
// DRIVERS
// ---------------------------------------------------------------------------

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

/**
 * The RUNTIME TERMINATION. `done(reason: "aborted")` is the event
 * `LocalRuntimeHost.completeAbortedInteractiveTurn` dispatches when a
 * turn is aborted. The LIVE specimen's final completion message was
 * FINALIZED, so both completion facts are set before the `done`.
 */
async function emitAbortedTurnDone(h: Harness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	await h.coordinator.handleSessionEvent(
		agentEvent(ACTIVE_SESSION_ID, {
			type: "done",
			reason: "aborted",
			text: "",
			iterations: 1,
		}),
	)
}

/**
 * Drive the REAL queue consumer: enqueue a prompt and let the REAL
 * drain microtask dispatch it. The `pending_prompt_submitted` event is
 * produced by the REAL `emitSubmitted` and delivered to the REAL
 * coordinator.
 */
async function drainRealQueue(h: Harness, prompt: string, opts: { runtimeControlKind?: "completion_continuation_control" } = {}) {
	h.pendingPrompts.enqueue(ACTIVE_SESSION_ID, {
		prompt,
		delivery: "queue",
		...(opts.runtimeControlKind ? { runtimeControlKind: opts.runtimeControlKind } : {}),
	})
	// The REAL `scheduleDrain` uses `queueMicrotask`; let it run and
	// then let the coordinator's async `handleSessionEvent` settle.
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const c10Records = () =>
	getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "task_completion_committed")

// ---------------------------------------------------------------------------
// THE PROBE
// ---------------------------------------------------------------------------

describe("B2PO01 — the B2 BCB-hold guard and PROMPT ORIGIN", () => {
	const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	beforeEach(() => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		clearContinuationCardinalityAuthorityCapture()
	})
	afterEach(() => {
		setContinuationCardinalityAuthorityCaptureEnabled(false)
		clearContinuationCardinalityAuthorityCapture()
		if (originalSandbox === undefined) {
			delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		} else {
			process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
		}
	})

	// -------------------------------------------------------------------------
	// S1
	// -------------------------------------------------------------------------
	it("B2PO01-S1: BCB held, runtime terminated, no new run -> `resumable`, never a false Working", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)

		// The BCB hold registered the marker and published the truthful
		// non-running phase.
		expect(h.deferredMarker()).toBeDefined()
		expect(h.tracker.currentPhase).toBe("resumable")

		// NO new run: the runtime stays inactive and NO dispatch happened.
		expect(h.sendSpy).not.toHaveBeenCalled()
		expect(h.agentRunSpy).not.toHaveBeenCalled()
		expect(h.isRunning()).toBe(false)

		// The phase is NEVER `streaming` (the false Working projection).
		expect(h.tracker.currentPhase).not.toBe("streaming")
		expect(h.phaseWrites.map((w) => w.writerId)).not.toContain("session-event-pending-prompt-submitted")
	})

	// -------------------------------------------------------------------------
	// S2
	// -------------------------------------------------------------------------
	it("B2PO01-S2: BCB held, the REAL queued continuation reaches the model-run dispatch seam while the phase stays `resumable`", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		expect(h.tracker.currentPhase).toBe("resumable")

		// The BCB's OWN continuation, enqueued through the REAL queue
		// consumer with the REAL host runtime-control discriminator.
		await drainRealQueue(h, BCB_CONTINUATION_PROMPT, { runtimeControlKind: "completion_continuation_control" })

		// The REAL runtime dispatch actually happened.
		expect(h.sendSpy).toHaveBeenCalledTimes(1)
		expect(h.agentRunSpy).toHaveBeenCalledTimes(1)

		// The BCB's OWN continuation is (by design) suppressed by the B2
		// guard: the completion is still HELD, so the phase stays
		// `resumable` and the barrier's release path remains the only
		// writer of a terminal phase.
		expect(h.phaseWrites.map((w) => w.writerId)).not.toContain("session-event-pending-prompt-submitted")
		expect(h.tracker.currentPhase).toBe("resumable")

		// The completion authority was NOT consulted and NO `completed`
		// was fabricated.
		expect(h.completionCommitCount()).toBe(0)
		expect(c10Records()).toHaveLength(0)
	})

	// -------------------------------------------------------------------------
	// S2c — THE RESUME-AFFORDANCE CONCURRENCY PROOF
	// -------------------------------------------------------------------------
	//
	// THE REVIEW'S S2 QUESTION
	//
	//   "the real queued BCB continuation reaches the model-run dispatch
	//    seam while the phase remains `resumable`. Establish whether
	//    control-only model execution is intentionally non-active from the
	//    user's perspective. If so, prove the Resume affordance cannot
	//    cause unsafe concurrent dispatch."
	//
	// THE ESTABLISHMENT (the S2 answer)
	//
	//   The BCB continuation is NOT user-visible work. It is HOST-OWNED
	//   CONTROL TRAFFIC:
	//
	//     - the prompt is stamped `runtimeControlKind:
	//       "completion_continuation_control"`, which the runtime
	//       converts into a BRAND-GATED, `role:"user"` envelope that the
	//       orchestrator promotes onto the model's PRIVILEGED
	//       `instructions` channel
	//       (`sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1014`),
	//       so it is NEVER a visible user turn; and
	//     - the BCB-hold `resumable` is the EXISTING, established
	//       non-running affordance for "the completion is HELD, the run
	//       produced no terminal response" — the same phase the
	//       containment-failure hold and the cancel path publish, and
	//       the webview button map already renders it
	//       (`resumable -> BUTTON_CONFIGS.resume_task`).
	//
	//   So the phase remaining `resumable` while the control continuation
	//   executes is INTENTIONAL non-active presentation: the user is not
	//   being shown a "Working" spinner for traffic they did not ask
	//   for and cannot influence.
	//
	//   The consequence that MUST be proven is therefore the CONCURRENCY
	//   one, and this witness proves it at the REAL queue-consumer seam.
	//
	// THE MUTUAL-EXCLUSION CHAIN (all REAL production code):
	//
	//   1. The user's Resume is NOT a direct dispatch. The `resumable`
	//      phase renders "Resume Task" -> `primaryAction: "proceed"` ->
	//      `askResponse("yesButtonClicked")` ->
	//      `SdkFollowupCoordinator.askResponse`. Because the session IS
	//      running (`activeSession.isRunning === true` — the BCB
	//      continuation's `pending_prompt_submitted` set it), the
	//      follow-up takes the `queueToActiveSession` branch, which
	//      sends with `delivery: "queue"` — NOT an immediate dispatch.
	//   2. `LocalRuntimeHost.runTurn` short-circuits a `queue` delivery
	//      into `PendingPromptsController.enqueue` and returns WITHOUT
	//      running anything.
	//   3. `PendingPromptsController.drain()` refuses to dispatch
	//      unless `session.agent.canStartRun()` is true, and
	//      `SessionRuntimeOrchestrator.canStartRun()` is
	//      `!this.running && !this.shutdownCalled` — the runtime's own
	//      in-flight flag.
	//   4. `drain()` is single-slot: the `drainingPendingPrompts` latch
	//      plus the `finally` re-drain loop make the queue a SERIAL
	//      pipeline, not a fan-out.
	//
	//   Therefore the Resume affordance CANNOT cause an unsafe
	//   concurrent dispatch: it is enqueued behind the in-flight control
	//   continuation and drains only after that run ends.
	// -------------------------------------------------------------------------
	it("B2PO01-S2c: the Resume affordance CANNOT cause an unsafe concurrent dispatch while the BCB control continuation is in flight", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		expect(h.tracker.currentPhase).toBe("resumable")

		// The BCB continuation's model run is IN FLIGHT (the real turn has
		// not ended). The dispatch seam is held so the runtime's
		// `canStartRun()` gate is observed in its true state.
		h.holdDispatch(true)
		h.pendingPrompts.enqueue(ACTIVE_SESSION_ID, {
			prompt: BCB_CONTINUATION_PROMPT,
			delivery: "queue",
			runtimeControlKind: "completion_continuation_control",
		})
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		await new Promise<void>((resolve) => setTimeout(resolve, 0))

		// The BCB continuation DID reach the model-run dispatch seam and
		// its run is IN FLIGHT.
		expect(h.sendSpy).toHaveBeenCalledTimes(1)
		expect(h.agentRunSpy).toHaveBeenCalledTimes(1)
		expect(h.isRunning()).toBe(true)

		// THE USER'S RESUME. The `resumable` phase renders "Resume Task"
		// -> `proceed` -> `askResponse` -> `queueToActiveSession` ->
		// `delivery: "queue"`. It arrives on the SAME queue.
		h.pendingPrompts.enqueue(ACTIVE_SESSION_ID, {
			prompt: INDEPENDENT_USER_PROMPT,
			delivery: "queue",
		})
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		await new Promise<void>((resolve) => setTimeout(resolve, 0))

		// THE CONCURRENCY ASSERTION: the Resume did NOT start a
		// concurrent model run. The runtime's `canStartRun()` gate
		// refused the drain while the control continuation was running.
		expect(h.agentRunSpy).toHaveBeenCalledTimes(1)
		expect(h.sendSpy).toHaveBeenCalledTimes(1)

		// The Resume is still QUEUED — it was not dropped either.
		const queued = h.pendingPrompts.list(ACTIVE_SESSION_ID)
		expect(queued.map((p) => p.prompt)).toContain(INDEPENDENT_USER_PROMPT)

		// When the control continuation's run ENDS, the queued Resume
		// drains — SERIALLY, one dispatch at a time. This is the
		// "queued, then dispatched after" shape, never "dispatched
		// concurrently".
		h.releaseDispatch()
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		await new Promise<void>((resolve) => setTimeout(resolve, 0))

		expect(h.agentRunSpy).toHaveBeenCalledTimes(2)
		expect(h.sendSpy).toHaveBeenCalledTimes(2)
		expect((h.sendSpy.mock.calls[1]?.[0] as { prompt: string }).prompt).toBe(INDEPENDENT_USER_PROMPT)

		// And the queued Resume is now a LEGITIMATE activation: the
		// barrier no longer holds the phase as the BCB's own
		// continuation (the drained prompt carries NO
		// `runtimeControlKind`), so `streaming` is re-asserted.
		expect(h.tracker.currentPhase).toBe("streaming")
	})

	// -------------------------------------------------------------------------
	// S2d — THE `canStartRun()` GATE, PROVED DIRECTLY.
	// -------------------------------------------------------------------------
	//
	// S2c above proves the CONCURRENCY OUTCOME through the production
	// `PendingPromptsController` with the production shape (the dispatch
	// seam is held for the duration of the model run, so the queue's
	// `drainingPendingPrompts` latch is also held).
	//
	// S2d isolates the SECOND, INDEPENDENT line of defence so the
	// conclusion does not rest on the latch alone: the RUNTIME's own
	// in-flight gate.
	//
	// The shape here is the one the runtime reaches immediately AFTER the
	// drain latch is released but BEFORE the model run has ended — the
	// window in which `deps.send` has been issued and the run is still
	// executing. In that window:
	//
	//   - `session.drainingPendingPrompts` is FALSE (the drain finished),
	//   - `session.agent.canStartRun()` is FALSE (a run is in flight).
	//
	// The ONLY thing standing between the queued Resume and a concurrent
	// dispatch is `canStartRun()`. The witness asserts that the queued
	// prompt is NOT dispatched.
	it("B2PO01-S2d: the runtime's own `canStartRun()` in-flight gate alone refuses a concurrent dispatch", async () => {
		// THE REAL runtime in-flight predicate, verbatim:
		//   `SessionRuntimeOrchestrator.canStartRun()` is
		//   `!this.running && !this.shutdownCalled`.
		let runtimeRunning = true
		const runtimeShutdownCalled = false

		const sendSpy = vi.fn(async (_input: { sessionId: string; prompt: string }) => ({ finishReason: "completed" as const }))
		const sessionId = "session-b2po01-s2d"
		const fakeSession = {
			sessionId,
			pendingPrompts: [] as unknown[],
			// The drain latch is RELEASED — this witness isolates the
			// runtime's in-flight gate, not the latch.
			drainingPendingPrompts: false,
			aborting: false,
			status: "running" as const,
			agent: {
				canStartRun: () => !runtimeRunning && !runtimeShutdownCalled,
			},
		}

		const pendingPrompts = new PendingPromptsController({
			getSession: (id: string) => (id === sessionId ? (fakeSession as never) : undefined),
			emit: () => {},
			send: async (input) => {
				sendSpy(input)
				return { finishReason: "completed" as const }
			},
		})

		// The user's Resume is queued while the runtime cannot start a run.
		pendingPrompts.enqueue(sessionId, { prompt: INDEPENDENT_USER_PROMPT, delivery: "queue" })
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		await new Promise<void>((resolve) => setTimeout(resolve, 0))

		// THE ASSERTION: the runtime's in-flight gate refused the
		// dispatch. The prompt is still QUEUED, not dispatched.
		expect(sendSpy).not.toHaveBeenCalled()
		expect(pendingPrompts.list(sessionId).map((p) => p.prompt)).toContain(INDEPENDENT_USER_PROMPT)

		// When the runtime's run ends, the gate re-opens and the queued
		// prompt drains — SERIALLY.
		runtimeRunning = false
		pendingPrompts.update({
			sessionId,
			promptId: pendingPrompts.list(sessionId)[0]?.id ?? "",
			prompt: INDEPENDENT_USER_PROMPT,
		})
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		await new Promise<void>((resolve) => setTimeout(resolve, 0))

		expect(sendSpy).toHaveBeenCalledTimes(1)
		expect((sendSpy.mock.calls[0]?.[0] as { prompt: string }).prompt).toBe(INDEPENDENT_USER_PROMPT)
	})

	// S3 — THE P0 CONCERN
	// -------------------------------------------------------------------------
	it("B2PO01-S3: BCB held, an INDEPENDENT user prompt starts a new model run -> the legitimate activation is NOT indefinitely hidden", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		expect(h.tracker.currentPhase).toBe("resumable")

		// An INDEPENDENT user-typed follow-up, enqueued through the REAL
		// queue consumer. No `runtimeControlKind` — this is the user path.
		await drainRealQueue(h, INDEPENDENT_USER_PROMPT)

		// The REAL runtime dispatch actually happened: a NEW MODEL RUN
		// started.
		expect(h.sendSpy).toHaveBeenCalledTimes(1)
		expect(h.agentRunSpy).toHaveBeenCalledTimes(1)
		expect(h.isRunning()).toBe(true)

		// THE OBSERVATION THE REVIEWER ASKED FOR.
		//
		// The runtime is NOW RUNNING (the user prompt genuinely started
		// a new model run). The B2 guard MUST NOT suppress the
		// `streaming` write here: the barrier identity triple still
		// matches, but the drained prompt is NOT the BCB's own
		// continuation (it carries NO `runtimeControlKind`), so the
		// legitimate activation is preserved.
		//
		// The phase after the dispatch:
		const phaseAfterDispatch = h.tracker.currentPhase
		const suppressed = !h.phaseWrites.some((w) => w.writerId === "session-event-pending-prompt-submitted")

		// The FIXED behaviour: the runtime is running AND the committed
		// phase is the truthful ACTIVE `streaming`.
		expect({
			runtimeRunning: h.isRunning(),
			phase: phaseAfterDispatch,
			streamingSuppressed: suppressed,
		}).toStrictEqual({
			runtimeRunning: true,
			phase: "streaming",
			streamingSuppressed: false,
		})

		// The later runtime event must NOT regress the phase away from
		// the truthful ACTIVE state.
		await h.coordinator.handleSessionEvent(
			agentEvent(ACTIVE_SESSION_ID, {
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "working on it" }],
			}),
		)
		const phaseAfterRuntimeEvent = h.tracker.currentPhase

		// Record the CONSERVATION OUTCOME. The reviewer asked for the
		// ACTUAL committed phase, not the event receipt.
		expect({
			phaseAfterDispatch,
			phaseAfterRuntimeEvent,
			streamingEverWritten: h.phaseWrites.some((w) => w.phase === "streaming"),
			completionCommitCount: h.completionCommitCount(),
		}).toStrictEqual({
			// The legitimate activation is NOT hidden.
			phaseAfterDispatch: "streaming",
			// ... and it is NOT regressed by a later runtime event.
			phaseAfterRuntimeEvent: "streaming",
			// The `streaming` phase WAS written for the new run.
			streamingEverWritten: true,
			// No fabricated completion.
			completionCommitCount: 0,
		})
	})

	// -------------------------------------------------------------------------
	// S4
	// -------------------------------------------------------------------------
	//
	// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01-PROMPT-ORIGIN01
	// / B2PO01: THE CANCELLATION WRITER / FENCE SEMANTICS.
	//
	// The predecessor's S4 only simulated the cancel as "bump the epoch +
	// set not-running". It NEVER performed the production PHASE WRITE,
	// so it never exercised the fact that the cancel REPLACES the
	// committed phase (and, after the B2PO01 repair, the committed
	// WRITER IDENTITY) with the CANCEL's own.
	//
	// This version drives the ACTUAL production semantics:
	//
	//   `SdkController.cancelTask()`
	//     (a) this.turnStateTracker.setWithWriter(
	//           "resumable", undefined,
	//           this.writerIdentity("controller-cancel-task"))
	//         -- a DIRECT tracker write, NOT a coordinator write;
	//     (b) await this.taskControl.cancelTask()
	//           -> raiseCancelFence()   (bumpEpoch — the epoch fence)
	//           -> await sdkHost.abort(sessionId)
	//           -> sessions.setRunning(false)
	//
	// The dedicated companion suite
	// (`post-terminal-working-cancel-b2po01-s4-cancel-fence.test.ts`)
	// drives the SAME sequence through the REAL `SdkTaskControlCoordinator`
	// and proves the cancellation straggler guard stays ACTIVE.
	it("B2PO01-S4: BCB-published `resumable`, then an explicit Cancel (production writer + fence) and a late `done` -> cancellation authority preserved, no fabricated C10", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		expect(h.tracker.currentPhase).toBe("resumable")
		// The committed `resumable` is the BCB HOLD's.
		expect(h.tracker.currentWriterId).toBe("session-event-bcb-hold-resumable")
		const phaseWritesAtHold = h.phaseWrites.length

		// -------------------------------------------------------------------
		// THE EXPLICIT CANCEL — the ACTUAL production writer/fence sequence.
		// -------------------------------------------------------------------
		//
		// (a) the production PHASE WRITE. `SdkController.cancelTask` writes
		//     the tracker DIRECTLY (the coordinator is NOT consulted), so
		//     the committed phase AND the committed writer identity are
		//     both replaced by the cancel's.
		h.tracker.setWithWriter("resumable", undefined, { writerId: "controller-cancel-task" as never })

		// (b) the production FENCE + abort + not-running sequence. The
		//     fence (the epoch bump) is raised BEFORE the abort is awaited.
		h.raiseCancelFence()
		h.setRunning(false)

		// The committed phase is now the CANCEL's, and the committed
		// writer is the CANCEL's — the BCB-hold classification can no
		// longer describe it.
		expect(h.tracker.currentPhase).toBe("resumable")
		expect(h.tracker.currentWriterId).toBe("controller-cancel-task")
		expect(h.tracker.currentWriterId).not.toBe("session-event-bcb-hold-resumable")

		// The LATE `done` — a straggling completion from the cancelled
		// turn. It arrives AFTER the fence was raised.
		await h.coordinator.handleSessionEvent(
			agentEvent(ACTIVE_SESSION_ID, {
				type: "done",
				reason: "aborted",
				text: "",
				iterations: 1,
			}),
		)

		// The cancellation authority is preserved: the phase is still the
		// truthful non-running `resumable` and NO `completed` was
		// fabricated.
		expect(h.tracker.currentPhase).toBe("resumable")
		expect(h.completionCommitCount()).toBe(0)
		expect(c10Records()).toHaveLength(0)

		// The straggler did NOT write a terminal phase of its own, and it
		// did not re-publish the BCB hold either — the cancellation
		// straggler guard was ACTIVE (it suppressed the write entirely).
		const writesAfterHold = h.phaseWrites.slice(phaseWritesAtHold)
		expect(writesAfterHold.filter((w) => w.phase === "completed")).toHaveLength(0)
		expect(writesAfterHold).toHaveLength(0)
	})
})
