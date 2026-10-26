/**
 * ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01 (PTWCR01)
 *
 * R1 — CONTROLLED PRODUCTION-SEAM RED for the LIVE incident
 * `1792958891945_k2wrd` / epoch 12.
 *
 * ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
 * (PTWCR01C01) — THE REPAIRED (GREEN) FORM OF THIS SUITE
 *
 *   This file was committed by the predecessor ACT as a RED
 *   REPRODUCTION: its assertions stated that the LIVE defect was
 *   PRESENT (the phase stayed `streaming`, no terminal phase was ever
 *   produced). The successor ACT repaired the defect, so those
 *   assertions are now INVERTED IN PLACE — the test IDs and their
 *   causal roles are PRESERVED, and only the asserted OUTCOME changes,
 *   from "the defect is present" to "the defect is absent". The suite
 *   therefore remains the regression guard for this exact LIVE
 *   sequence, and the repository is not left with a permanently-red
 *   suite.
 *
 *   The repair (see the successor ACT for the full contract):
 *     B1 — the BCB hold path publishes the EXISTING truthful
 *          non-running `resumable` phase (the "the run was abandoned"
 *          affordance) instead of publishing NO phase at all. NO new
 *          phase; NO `completed` fabricated; the Elm completion
 *          authority is NOT consulted; the barrier's own release path
 *          (`reevaluateDeferredCompletionBarrier`) remains the ONLY
 *          writer of a terminal phase for the held obligation.
 *     B2 — the `pending_prompt_submitted` writer does NOT re-assert
 *          `streaming` while the deferred-completion BARRIER holds the
 *          active turn's completion (the discriminator is the EXISTING
 *          BCB barrier authority, not the phase and not the runtime
 *          status). The PINNED T-08a/T-08b/T-08c contract (a
 *          `pending_prompt_submitted` from a terminal phase activates
 *          `streaming`) is PRESERVED when no barrier holds.
 *
 * THE LIVE SYMPTOM (as captured — the defect this suite now guards
 * against REGRESSION)
 *
 *   Final host phase    : `streaming` (seq 132499), last writer
 *                          `session-event-pending-prompt-submitted`.
 *   Runtime status      : `aborted`; shadow status `aborted`;
 *                          shadow recovery `recovering`; no model
 *                          streaming, no pending tool.
 *   C9 / C10            : two `submit_and_exit_seen`, ZERO
 *                          `task_completion_committed`.
 *   BCB                 : four held terminal observations
 *                          (`unconsumedOwnedTerminalResultsForC10 = 4`),
 *                          `heldObligationForC10 = true`.
 *   Presentation        : TaskHeader selects `legacy/streaming`;
 *                          shadow binding `UNBOUND`; the action
 *                          selector returns `Cancel`.
 *
 * THE CAUSAL CHAIN UNDER TEST (as CAPTURED — the defect the successor
 * ACT repaired)
 *
 *   runtime termination (`done(reason:"aborted")`)
 *     -> the turn-end handler sees `attemptCompletionSeen` +
 *        `terminalResponseCommittedThisTurn` and captures C9
 *     -> the BCB HOLDS the C10 (held terminal observations > 0)
 *        and registers a deferred-completion-barrier marker
 *     -> NO phase write happens on the hold path (the phase stays
 *        whatever it was: `streaming`)
 *     -> the `pending_prompt_submitted` event arrives and writes
 *        `streaming` UNCONDITIONALLY
 *        (`sdk-session-event-coordinator.ts:3279`)
 *     -> the runtime is DEAD: no further `done` / `ended` event can
 *        ever arrive to move the phase to a terminal projection
 *     -> the phase is stuck at `streaming` FOREVER, and the webview
 *        renders it as an actively-Working turn with a `Cancel`
 *        button.
 *
 * WHAT THIS SUITE PROVES
 *
 *   PTWCR01-R1-01  The RED: after a terminal runtime plus a
 *                  `pending_prompt_submitted` event, the REAL
 *                  coordinator + REAL `TurnStateTracker` commit
 *                  `streaming`, and NO terminal phase is ever
 *                  produced — while the runtime is inactive and
 *                  the BCB still holds a real obligation.
 *
 *   PTWCR01-R1-02  The conservation violation is a STATE /
 *                  PRESENTATION violation, NOT a completion
 *                  violation: a `task_completion_committed` C10 was
 *                  NOT fabricated and `completed` was NOT reached.
 *                  (The negative witness for premature `completed`.)
 *
 *   PTWCR01-R1-03  The held obligation is REAL and INDEPENDENTLY
 *                  OBSERVABLE: the BCB marker exists and the four
 *                  held jobIds are named. The case is therefore NOT
 *                  "legitimately pending work with a truthful held
 *                  projection" — the projection is untruthful
 *                  because it claims ACTIVE work.
 *
 *   PTWCR01-R1-04  The ablated control: with the BCB obligation
 *                  REMOVED, the same `done` event DOES reach a
 *                  terminal projection — proving the missing
 *                  transition is caused by the HOLD + the missing
 *                  terminal-phase publication, not by the
 *                  coordinator being unable to write a terminal
 *                  phase at all.
 *
 *   PTWCR01-R1-05  The negative witness for premature `completed`:
 *                  in EVERY case the suite asserts that `completed`
 *                  is never reached while the BCB holds.
 *
 *   PTWCR01-R1-06  The abort-vs-failed discriminator: a `done` with
 *                  `reason: "error"` reaches the `error` phase, a
 *                  `done` with `reason: "aborted"` does not — the
 *                  abort reason is the discriminator the LIVE run
 *                  lacked.
 *
 * THE HARNESS
 *
 * The REAL `SdkSessionEventCoordinator` and the REAL
 * `TurnStateTracker` are driven. Only the OUTER world (the session
 * lifecycle, the Elm authority verdict, the BCB obligations, the
 * background-notify coordinator) is stubbed — those are the inputs
 * the coordinator is DESIGNED to consult. No production seam is
 * re-implemented.
 *
 * This is a REPRODUCTION suite: it asserts the CURRENT production
 * behavior so the defect is pinned as an executable RED. The
 * bounded repair ACT (R4) will flip the RED assertions to GREEN.
 */

import type { CoreSessionEvent, PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buttonsForPhase } from "../../../webview-ui/src/components/chat/chat-view/shared/buttonConfig"
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
import { buildFactsJson, invokeElmKernel } from "../task-header-elm-shadow"
import { TurnStateTracker } from "../turn-state-tracker"

// ---------------------------------------------------------------------------
// HARNESS
// ---------------------------------------------------------------------------

/**
 * The BCB obligation set the LIVE specimen carried. The four held
 * jobIds are the exact identities named by the LIVE
 * `bcb-observation-unavailable-capture.jsonl` record
 * (`ownedTerminalJobIdsForC10`).
 */
const LIVE_HELD_JOB_IDS = [
	"cmd_mvo9fosf9tyu4xb3",
	"cmd_mvo9fosftrej06ye",
	"cmd_mvo9fosfbixo2qfc",
	"cmd_mvo9hvbop47y3i42",
] as const

interface Obligations {
	/** (1) Pending-prompt authority UNAVAILABLE -> fail closed. */
	readonly pendingPromptAuthorityAvailable: boolean
	/** (2) Pending prompts present (count > 0). */
	readonly pendingPromptCount: number
	/** (3) Active notify-owned work. */
	readonly activeNotifyCount: number
	/** (5) An owned RUNNING background job. */
	readonly ownerStillRunning: boolean
	/** (6) Unconsumed terminal COUNT positive. */
	readonly unconsumedTerminalCount: number
	/** (7) Held terminal ID LIST non-empty despite a zero count. */
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

interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly tracker: TurnStateTracker
	readonly translatorState: MessageTranslatorState
	readonly activeSessionId: string
	readonly activeTaskId: string
	/** The number of committed `completed` phases (the REAL tracker commit). */
	readonly completionCommitCount: () => number
	/** The Elm consult count (the authority was actually consulted). */
	readonly elmConsultCount: () => number
	/** Override the Elm decision (the injected-decision seam). */
	setElmDecision: (decision: ElmCompletionAuthorityDecision) => void
	/** Set the independent BCB obligations. */
	setObligations: (obligations: Partial<Obligations>) => void
	/** The deferred-completion marker (the deferred authority). */
	readonly deferredMarker: () => unknown
	/** The phase-writing calls observed, in order. */
	readonly phaseWrites: readonly { phase: string; writerId: string | undefined }[]
}

function makeHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-ptwcr01"
	const activeTaskId = opts.activeTaskId ?? "task-ptwcr01"

	const obligations: Obligations = { ...NO_OBLIGATIONS }
	let elmDecision: ElmCompletionAuthorityDecision = { kind: "authorize", reason: "ptwcr01-default-authorize" }
	let completionCommitCount = 0
	let elmConsultCount = 0
	const phaseWrites: { phase: string; writerId: string | undefined }[] = []

	new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => Date.now(),
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {},
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				// The LIVE runtime is INACTIVE (`aborted`) at the moment the
				// `pending_prompt_submitted` event is delivered.
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			phaseWrites.push({ phase, writerId })
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		// The INJECTED DECISION seam: the authority provider. The suite
		// varies the verdict; production injects the real Elm runtime.
		getElmCompletionAuthorityDecision: () => {
			elmConsultCount += 1
			return elmDecision
		},
		flushElmAuthorityForSession: async () => {},
		getPendingPromptCount: (): PendingPromptCountRead =>
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
		// BCB took the ENQUEUE branch (not the
		// `observation_unavailable` blocked branch).
		liveTools: () => ["run_commands", "command_status"],
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => completionCommitCount,
		elmConsultCount: () => elmConsultCount,
		setElmDecision(decision) {
			elmDecision = decision
		},
		setObligations(next) {
			Object.assign(obligations, next)
		},
		deferredMarker: () => (coordinator as unknown as { deferredCompletionBarrier?: unknown }).deferredCompletionBarrier,
		phaseWrites,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

/**
 * The RUNTIME TERMINATION. `done(reason: "aborted")` is the event
 * `LocalRuntimeHost.completeAbortedInteractiveTurn` dispatches
 * (`sdk/packages/core/src/runtime/host/local-runtime-host.ts:2351`)
 * when a turn is aborted.
 *
 * The LIVE specimen's final completion message was FINALIZED
 * (`partial: false`), so the completion tool's `content_end` DID
 * commit the terminal response before the abort. The harness mirrors
 * that exactly: both completion facts are set before the `done`.
 */
async function emitAbortedTurnDone(h: Harness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	await h.coordinator.handleSessionEvent(
		agentEvent(h.activeSessionId, {
			type: "done",
			reason: "aborted",
			text: "",
			iterations: 1,
		}),
	)
}

/**
 * The PENDING-PROMPT CONTINUATION RE-ENTRY. This is the exact LIVE
 * event shape delivered by `PendingPromptService` after the drain
 * (`sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:658`).
 */
async function emitPendingPromptSubmitted(h: Harness): Promise<void> {
	await h.coordinator.handleSessionEvent({
		type: "pending_prompt_submitted",
		payload: {
			sessionId: h.activeSessionId,
			id: "pending-ptwcr01",
			prompt: "continue",
			delivery: "queue",
			attachmentCount: 0,
		},
	} as unknown as CoreSessionEvent)
}

const c9Records = () => getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "submit_and_exit_seen")
const c10Records = () =>
	getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "task_completion_committed")

/** The held jobIds the coordinator actually consulted. */
function heldJobIdsOf(h: Harness): readonly string[] {
	const options = (h.coordinator as unknown as { options: SdkSessionEventCoordinatorOptions }).options
	return options.getUnconsumedOwnedTerminalJobIds?.(h.activeSessionId, h.activeTaskId) ?? []
}

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

// ---------------------------------------------------------------------------
// R1 — THE CONTROLLED PRODUCTION-SEAM RED
// ---------------------------------------------------------------------------

describe("PTWCR01 R1 — post-terminal Working/Cancel after runtime termination", () => {
	it("PTWCR01-R1-01 (REPAIRED): an inactive runtime is published as a TRUTHFUL non-running phase — the presentation no longer claims active work", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// The BCB obligation is REAL (the LIVE specimen's four held
		// terminal observations).
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		// (a) The runtime TERMINATES (aborted).
		await emitAbortedTurnDone(h)

		// (b) A pending-prompt continuation re-enters.
		await emitPendingPromptSubmitted(h)

		// THE REPAIRED ASSERTION: the authoritative host phase is
		// `resumable` — a TRUTHFUL non-running phase — even though the
		// BCB still holds a real obligation.
		//
		// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
		// (PTWCR01C01): the predecessor ACT's RED assertion was
		// `expect(...).toBe("streaming")` — i.e. the defect REPRODUCED.
		// The repair (B1: the BCB hold publishes `resumable`; B2: the
		// pending-prompt writer does not re-assert `streaming` while
		// the barrier holds) INVERTS that assertion. The test ID and
		// its causal role are PRESERVED; only the asserted outcome
		// changes, from "the defect is present" to "the defect is
		// absent". The suite remains the regression guard for this
		// exact LIVE sequence.
		expect(h.tracker.currentPhase).toBe("resumable")

		// The `streaming` re-assertion is GONE: the pending-prompt
		// writer did not commit a phase over the held turn.
		expect(h.phaseWrites.some((w) => w.writerId === "session-event-pending-prompt-submitted")).toBe(false)

		// The TRUTHFUL terminal phase was produced by the BCB hold
		// path (NOT by the pending-prompt writer).
		const terminalPhases = h.phaseWrites.filter((w) =>
			["completed", "error", "resumable", "awaiting_followup"].includes(w.phase),
		)
		expect(terminalPhases.map((w) => w.phase)).toEqual(["resumable"])
		expect(h.phaseWrites.at(-1)?.writerId).toBe("session-event-bcb-hold-resumable")
	})

	it("PTWCR01-R1-02: the conservation violation is presentation, NOT completion — no C10 was fabricated and `completed` was never reached", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		await emitPendingPromptSubmitted(h)

		// ONE C9 attempt, ZERO C10 commits — the LIVE signature.
		expect(c9Records()).toHaveLength(1)
		expect(c10Records()).toHaveLength(0)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
	})

	it("PTWCR01-R1-03: the held obligation is REAL and independently observable (the BCB marker + the four named jobIds)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)

		// The deferred-completion-barrier marker EXISTS: the BCB
		// holds the completion and registers the deferred authority.
		const marker = h.deferredMarker() as { sessionId?: string; epoch?: number } | undefined
		expect(marker).toBeDefined()
		expect(marker?.sessionId).toBe(h.activeSessionId)

		// The held obligation is exactly the four LIVE jobIds — the
		// obligation is real, not a zero-count artifact.
		expect(heldJobIdsOf(h)).toEqual([...LIVE_HELD_JOB_IDS])
	})

	it("PTWCR01-R1-04 (ABLATION): with the BCB obligation REMOVED the same terminal event DOES reach a terminal projection", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// NO held obligation: the BCB does NOT hold.
		h.setObligations({ unconsumedTerminalCount: 0, heldTerminalJobIds: [] })

		await emitAbortedTurnDone(h)

		// The Elm authority was consulted and authorized; the C10
		// commit fired and the phase became `completed`.
		expect(h.elmConsultCount()).toBeGreaterThan(0)
		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")

		// And the pending-prompt re-entry AFTER the terminal phase
		// ALSO proves the writer is not itself the problem: the
		// coordinator's `pending_prompt_submitted` branch is
		// unconditional, so it clobbers the terminal phase too. This
		// is the SECOND half of the causal story — the writer is
		// unguarded, but the load-bearing cause of the LIVE symptom
		// is that the HOLD path leaves NO terminal phase behind for
		// the unconditional writer to clobber.
		await emitPendingPromptSubmitted(h)
		expect(h.phaseWrites.at(-1)?.writerId).toBe("session-event-pending-prompt-submitted")
	})

	it("PTWCR01-R1-05 (NEGATIVE WITNESS): `completed` is never reached while the BCB holds, whatever the Elm verdict", async () => {
		for (const verdict of ["authorize", "hold", "failure"] as const) {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setObligations({
				unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
				heldTerminalJobIds: LIVE_HELD_JOB_IDS,
			})
			h.setElmDecision(
				verdict === "authorize"
					? { kind: "authorize", reason: "ptwcr01-authorize" }
					: verdict === "hold"
						? { kind: "hold", reason: "ptwcr01-hold", holdReasons: ["active_run"] }
						: {
								kind: "failure",
								reason: "ptwcr01-failure",
								classification: "elm_authority_unavailable",
							},
			)

			await emitAbortedTurnDone(h)
			await emitPendingPromptSubmitted(h)

			expect(h.completionCommitCount()).toBe(0)
			expect(c10Records()).toHaveLength(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
		}
	})

	it("PTWCR01-R1-06: an ABORTED runtime is distinguishable from a FAILED one — only `error` reaches the `error` phase", async () => {
		// The LIVE specimen's runtime status is `aborted`. The
		// `done(reason: "aborted")` event is the runtime's truthful
		// terminal signal. The suite proves the coordinator does not
		// currently distinguish the abort reason at the phase seam.
		const aborted = makeHarness()
		aborted.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		aborted.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})
		await emitAbortedTurnDone(aborted)
		await emitPendingPromptSubmitted(aborted)
		// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
		// (PTWCR01C01): the abort path now publishes the TRUTHFUL
		// non-running `resumable` phase (the BCB hold), NOT the false
		// ACTIVE `streaming`. The abort reason is STILL distinguishable
		// from a failure — see the CONTROL below, which still reaches
		// `error`.
		expect(aborted.tracker.currentPhase).toBe("resumable")
		expect(aborted.tracker.currentPhase).not.toBe("error")

		// CONTROL: a `done(reason: "error")` (a genuine provider
		// failure) DOES produce the `error` phase. The `error` branch
		// is reached through `wasErrorSeen()`, which the `done`
		// handler sets for `reason === "error"` only. So the abort
		// reason is the discriminator that the LIVE run lacked.
		const errored = makeHarness()
		errored.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		errored.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})
		await errored.coordinator.handleSessionEvent(
			agentEvent(errored.activeSessionId, {
				type: "done",
				reason: "error",
				text: "provider failed",
				iterations: 1,
			}),
		)
		expect(errored.tracker.currentPhase).toBe("error")
	})
})

// ---------------------------------------------------------------------------
// R2 / R3 — THE PROJECTION-SIDE DISCRIMINATORS
// ---------------------------------------------------------------------------

/**
 * R2/R3 — the LIVE capture's projection facts are REPRODUCIBLE from
 * the reproduced host state.
 *
 * The LIVE capture recorded:
 *   canonicalShadowPhase    = "completed"
 *   currentLegacyPhase      = "streaming"
 *   publicationShadowBinding= "UNBOUND"
 *   selectedPhase           = "streaming"
 *   selectedSource          = "legacy"
 *   buttonConfig.secondary  = "Cancel"
 *
 * The suite proves each of these is a DETERMINISTIC FUNCTION of the
 * reproduced host state. That localizes the defect: the projection
 * seams are NOT misbehaving — they faithfully render a host phase
 * that is itself wrong. The defect is therefore UPSTREAM of the
 * projection (the missing terminal phase transition), NOT in the
 * TaskHeader selector and NOT in the webview button selector.
 */
describe("PTWCR01 R2/R3 — the projection seams faithfully render the reproduced (wrong) host state", () => {
	it("PTWCR01-R2-01: the Elm TaskHeader selector returns `legacy/streaming` for the LIVE fact tuple (shadow=completed, legacy=streaming, UNBOUND)", async () => {
		// The LIVE `task-header-selector-input-capture.jsonl` tuple:
		//   canonicalShadowPhase = "completed"  (the canonical shadow
		//     DID observe a terminal state — the runtime is dead)
		//   currentLegacyPhase   = "streaming"   (the host SCAR)
		//   publicationShadowBinding = "UNBOUND" (no TurnState-domain
		//     observation stamp — `canonicalShadowObservedTurnSeq` is
		//     undefined, exactly like the LIVE capture)
		const facts = buildFactsJson({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: "streaming",
			seq: 132499,
			canonicalShadowObservedTurnSeq: undefined,
		})
		const decision = await invokeElmKernel(facts)
		expect(decision.kind).toBe("presentation")
		if (decision.kind !== "presentation") {
			throw new Error(`ELM_DECODE_ERROR: ${JSON.stringify(decision)}`)
		}
		// The LIVE selected projection.
		expect(decision.value.phase).toBe("streaming")
		expect(decision.value.source).toBe("legacy")
		expect(decision.value.seq).toBe(132499)
	})

	it("PTWCR01-R2-02: the webview action-button selector returns `Cancel` for the reproduced `streaming` phase", () => {
		const config = buttonsForPhase({ phase: "streaming", seq: 132499 }, undefined)
		expect(config.secondaryText).toBe("Cancel")
		expect(config.secondaryAction).toBe("cancel")
		expect(config.sendingDisabled).toBe(true)
	})

	it("PTWCR01-R2-03: ABLATION — the projection seams are NOT the defect: a terminal host phase produces the truthful projection", async () => {
		// Same shadow fact, but the host phase is terminal
		// (`resumable` — the honest "abandoned run" projection the
		// repair must produce). The selector then returns the host
		// authority (R2.5), NOT the stale legacy `streaming`.
		const facts = buildFactsJson({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: "resumable",
			seq: 132499,
			canonicalShadowObservedTurnSeq: undefined,
		})
		const decision = await invokeElmKernel(facts)
		expect(decision.kind).toBe("presentation")
		if (decision.kind !== "presentation") {
			throw new Error(`ELM_DECODE_ERROR: ${JSON.stringify(decision)}`)
		}
		expect(decision.value.phase).toBe("resumable")
		expect(decision.value.source).toBe("host")

		// And the button selector then offers the truthful affordance
		// (Resume), NOT `Cancel`.
		const config = buttonsForPhase({ phase: "resumable", seq: 132499 }, undefined)
		expect(config.secondaryAction).not.toBe("cancel")
	})

	it("PTWCR01-R2-04: ABLATION — with a BOUND shadow observation stamp the shadow wins (so the fix must NOT rely on the shadow)", async () => {
		// When the shadow carries a TurnState-domain observation stamp
		// at or after the current seq, the shadow branch wins and the
		// projection is `shadow/completed`. This proves the LIVE
		// `legacy/streaming` outcome was NOT caused by a broken
		// selector — it was caused by the UNBOUND shape plus an
		// ACTIVE legacy phase, i.e. by the host state.
		const facts = buildFactsJson({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: "streaming",
			seq: 132499,
			canonicalShadowObservedTurnSeq: 132499,
		})
		const decision = await invokeElmKernel(facts)
		expect(decision.kind).toBe("presentation")
		if (decision.kind !== "presentation") {
			throw new Error(`ELM_DECODE_ERROR: ${JSON.stringify(decision)}`)
		}
		expect(decision.value.phase).toBe("completed")
		expect(decision.value.source).toBe("shadow")
	})
})

// ---------------------------------------------------------------------------
// R3 — NECESSITY / ABLATION (one condition varied at a time)
// ---------------------------------------------------------------------------

describe("PTWCR01 R3 — necessity: which condition preserves the stale `streaming` phase", () => {
	it("PTWCR01-R3-01 (ABLATION A): REMOVE the BCB obligation -> the stale `streaming` phase does NOT survive", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// The ONLY varied condition: no held obligation.
		h.setObligations({ unconsumedTerminalCount: 0, heldTerminalJobIds: [] })

		await emitAbortedTurnDone(h)
		await emitPendingPromptSubmitted(h)

		// Without the hold the terminal event produces a terminal
		// phase... but the UNGUARDED pending-prompt writer STILL
		// clobbers it. This is the second, independent defect the
		// ablation exposes. See R3-02.
		expect(h.tracker.currentPhase).toBe("streaming")
		// ... but the terminal phase WAS produced (and the C10
		// committed) in between.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.phaseWrites.some((w) => w.phase === "completed")).toBe(true)
	})

	it("PTWCR01-R3-02 (ABLATION B): with the BCB obligation PRESENT the hold publishes ONLY a truthful non-running phase — never `completed`", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		await emitPendingPromptSubmitted(h)

		// The BCB HOLD is what removes the terminal phase. The hold
		// registers the deferred marker and publishes ONLY the truthful
		// non-running `resumable` phase — it NEVER publishes `completed`
		// (the Elm/C10 authority is not consulted on the hold path).
		//
		// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
		// (PTWCR01C01): the predecessor's assertion was
		// `expect(no terminal phase at all).toBe(true)`. The repair
		// (B1) publishes `resumable` — a TRUTHFUL non-running phase —
		// so the assertion is INVERTED to the load-bearing invariant:
		// the hold never publishes a COMPLETION phase.
		expect(h.phaseWrites.some((w) => w.phase === "completed")).toBe(false)
		expect(h.phaseWrites.some((w) => w.phase === "error")).toBe(false)
		expect(h.phaseWrites.some((w) => w.phase === "awaiting_followup")).toBe(false)
		expect(h.phaseWrites.some((w) => w.phase === "resumable")).toBe(true)
		expect(h.deferredMarker()).toBeDefined()
	})

	it("PTWCR01-R3-03 (ABLATION C): the deferred marker EXISTS but a re-evaluation cannot release it while the obligation remains", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		await emitPendingPromptSubmitted(h)

		// The re-evaluation RUNS (the production entry point), and it
		// correctly HOLDS — the obligation is still there.
		await h.coordinator.reevaluateDeferredCompletionBarrier()

		// The phase is STILL the truthful non-running `resumable`: the
		// re-evaluation is correctly conservative, and it publishes NO
		// completion phase while the obligation remains.
		//
		// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
		// (PTWCR01C01): the predecessor's assertion was
		// `expect(...).toBe("streaming")` — the load-bearing fact was
		// "the deferred marker alone does not produce a truthful
		// projection". The repair (B1) makes the projection TRUTHFUL,
		// so the assertion is INVERTED: the phase is `resumable`, and
		// the re-evaluation still publishes NO completion phase.
		expect(h.tracker.currentPhase).toBe("resumable")
		expect(h.phaseWrites.some((w) => w.phase === "completed")).toBe(false)
		expect(h.phaseWrites.some((w) => w.phase === "error")).toBe(false)
		// The marker is PRESERVED (the hold is not a release).
		expect(h.deferredMarker()).toBeDefined()
	})

	it("PTWCR01-R3-04 (ABLATION D): once the obligation is CONSUMED the re-evaluation commits through the Elm/C10 authority", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		await emitPendingPromptSubmitted(h)

		// The obligation is CONSUMED (the agent observed the held
		// terminal facts via `command_status`).
		h.setObligations({ unconsumedTerminalCount: 0, heldTerminalJobIds: [] })

		// The re-evaluation now releases the held completion through
		// the Elm authority -> C10 commit.
		await h.coordinator.reevaluateDeferredCompletionBarrier()

		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")
		expect(h.deferredMarker()).toBeUndefined()
	})

	it("PTWCR01-R3-05 (ABLATION E): a STALE epoch/session notification cannot alter the current task", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		await emitPendingPromptSubmitted(h)

		const before = h.tracker.get()

		// A notification for a DIFFERENT session must not alter the
		// current task's phase.
		await h.coordinator.notifyAgentTurnDone("some-other-session")
		expect(h.tracker.get()).toStrictEqual(before)

		// A `pending_prompt_submitted` for a DIFFERENT session is
		// IGNORED by the session-identity guard at the top of
		// `handleSessionEvent`.
		await h.coordinator.handleSessionEvent({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: "some-other-session",
				id: "pending-stale",
				prompt: "continue",
				delivery: "queue",
				attachmentCount: 0,
			},
		} as unknown as CoreSessionEvent)
		expect(h.tracker.get()).toStrictEqual(before)
	})
})
