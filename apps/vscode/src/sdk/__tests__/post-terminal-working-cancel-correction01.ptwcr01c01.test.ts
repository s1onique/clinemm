/**
 * ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
 * (PTWCR01C01)
 *
 * R1 — the SAFETY RED for the bounded repair of the LIVE incident
 * `1792958891945_k2wrd` / epoch 12.
 *
 * THE DEFECT (established by the predecessor ACT
 * ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01)
 *
 *   A terminated runtime turn whose completion is HELD by the BCB is
 *   falsely presented as `Working` / `Cancel`.
 *
 *   The LIVE chronology (re-verified in this ACT's R0 evidence)
 *   proves BOTH boundaries are load-bearing:
 *
 *     1792961423170  BCB hold (4 real held terminal observations)
 *                    -> registers the deferred-completion marker and
 *                       RETURNS WITHOUT publishing any terminal phase
 *     1792961423228  `pending_prompt_submitted`
 *                    -> writes `streaming` UNCONDITIONALLY
 *                       (committed seq 132499 — the LAST writer)
 *
 *   The runtime was already `aborted` (from 1792961416077) with zero
 *   model streaming and zero pending tools, so no later event could
 *   ever supply the missing terminal transition. The phase stayed
 *   `streaming` for the whole capture window (59 s).
 *
 * THE BOUNDED REPAIR UNDER TEST (two boundaries, both minimal)
 *
 *   B1 — the BCB hold path publishes a TRUTHFUL NON-RUNNING phase.
 *        The EXISTING `resumable` phase (the established "the run was
 *        abandoned" affordance, already used by the containment-failure
 *        hold and by the cancel path). NO new phase. NO `completed`.
 *        The BCB HOLD, the Elm authority, the containment guards and
 *        the epoch identity triple are all UNTOUCHED.
 *
 *   B2 — the `pending_prompt_submitted` writer does NOT re-assert
 *        `streaming` while the deferred-completion BARRIER HOLDS the
 *        active turn's completion. The discriminator is the EXISTING
 *        BCB barrier authority (the identity triple `sessionId` /
 *        `taskId` / `epoch`), NOT the phase and NOT the runtime
 *        status. A LEGITIMATE new turn (no live barrier) still
 *        activates `streaming` — the PINNED T-08a/T-08b/T-08c
 *        contract is PRESERVED.
 *
 * WHAT THIS SUITE PROVES
 *
 *   PTWCR01C01-R1-01  (RED) the phase after the LIVE sequence is
 *                     `resumable` — NOT `streaming`.
 *   PTWCR01C01-R1-02  the conservation invariants hold: ZERO `completed`
 *                     commits, ZERO C10 `task_completion_committed`
 *                     records, and the deferred marker is PRESERVED.
 *                     (The negative witness for premature `completed`.)
 *   PTWCR01C01-R1-03  the deferred marker is still registered (the
 *                     hold is a HOLD, not a release).
 *   PTWCR01C01-R1-04  the projection seams now render the truthful
 *                     affordance: TaskHeader selects `host/resumable`
 *                     and the action button is NOT `Cancel`.
 *   PTWCR01C01-R1-05  B2 — a LEGITIMATE new turn (no prior terminal
 *                     phase) still activates `streaming`. The repair
 *                     does NOT suppress legitimate activation.
 *   PTWCR01C01-R1-06  B2 — the BCB-hold guard does NOT clobber an
 *                     existing `completed` phase (the guard is scoped
 *                     to the live-barrier case).
 *   PTWCR01C01-R1-06b the PINNED T-08a contract is PRESERVED: a
 *                     `pending_prompt_submitted` over `completed` with
 *                     NO live barrier still activates `streaming`.
 *   PTWCR01C01-R1-07  a STALE session/task/epoch notification cannot
 *                     alter the current task.
 *   PTWCR01C01-R1-08  a provider ERROR still reaches the `error`
 *                     phase (the repair does not mask real failures).
 *
 * EVIDENCE LEVEL
 *
 *   REAL_PRODUCTION_SEAM — the REAL `SdkSessionEventCoordinator`, the
 *   REAL `TurnStateTracker`, the REAL `MessageTranslatorState`, the
 *   REAL Elm projection kernel and the REAL webview button selector.
 *   The Elm COMPLETION-authority decision is INJECTED at the existing
 *   provider boundary (the same INJECTED_DECISION posture as the
 *   predecessor ACT); it is NOT live Elm execution and is not reported
 *   as such.
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
	const activeSessionId = opts.activeSessionId ?? "session-ptwcr01c01"
	const activeTaskId = opts.activeTaskId ?? "task-ptwcr01c01"

	const obligations: Obligations = { ...NO_OBLIGATIONS }
	let elmDecision: ElmCompletionAuthorityDecision = { kind: "authorize", reason: "ptwcr01c01-default-authorize" }
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
			id: "pending-ptwcr01c01",
			prompt: "continue",
			delivery: "queue",
			attachmentCount: 0,
		},
	} as unknown as CoreSessionEvent)
}

const c9Records = () => getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "submit_and_exit_seen")
const c10Records = () =>
	getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "task_completion_committed")

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
// R1 — THE SAFETY RED
// ---------------------------------------------------------------------------

describe("PTWCR01C01 R1 — a terminated, BCB-held turn projects a TRUTHFUL non-running phase", () => {
	it("PTWCR01C01-R1-01 (RED): the phase is `resumable` — NOT the false `streaming` `Working`", async () => {
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

		// THE RED ASSERTION: the authoritative host phase must be a
		// TRUTHFUL NON-RUNNING phase. `streaming` claims ACTIVE work
		// while the runtime is dead — the LIVE defect.
		expect(h.tracker.currentPhase).toBe("resumable")

		// NO `completed` was fabricated.
		expect(h.tracker.currentPhase).not.toBe("completed")
	})

	it("PTWCR01C01-R1-02: the conservation invariants hold — ZERO `completed` commits, ZERO C10 records", async () => {
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

	it("PTWCR01C01-R1-03: the deferred-completion marker is PRESERVED (the hold is a HOLD, not a release)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		await emitPendingPromptSubmitted(h)

		const marker = h.deferredMarker() as { sessionId?: string; epoch?: number } | undefined
		expect(marker).toBeDefined()
		expect(marker?.sessionId).toBe(h.activeSessionId)
	})

	it("PTWCR01C01-R1-04: the projection seams render the TRUTHFUL affordance (not `Working` / `Cancel`)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		await emitPendingPromptSubmitted(h)

		// The Elm TaskHeader selector now selects the HOST authority
		// (the terminal host phase) instead of the stale legacy
		// `streaming` SCAR.
		const facts = buildFactsJson({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: h.tracker.currentPhase,
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

		// The action button is NOT `Cancel`.
		const config = buttonsForPhase({ phase: h.tracker.currentPhase, seq: 132499 }, undefined)
		expect(config.secondaryAction).not.toBe("cancel")
	})

	it("PTWCR01C01-R1-05: B2 — a LEGITIMATE new turn still activates `streaming` (the repair does NOT suppress activation)", async () => {
		const h = makeHarness()
		// NO prior terminal phase: the phase is `idle` (a fresh task).
		h.tracker.setWithWriter("idle", undefined, { writerId: "task-start-init-task" })

		await emitPendingPromptSubmitted(h)

		// The legitimate new-turn activation is PRESERVED.
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(h.phaseWrites.at(-1)?.writerId).toBe("session-event-pending-prompt-submitted")
	})

	it("PTWCR01C01-R1-06: B2 — the BCB-hold guard does NOT clobber an existing `completed` phase", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// The BCB obligation is REAL, so the deferred-completion barrier
		// is LIVE and holds this turn's completion.
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		// The runtime TERMINATES (aborted) -> the BCB hold registers the
		// deferred-completion-barrier marker (and, with B1, publishes the
		// truthful `resumable`).
		await emitAbortedTurnDone(h)
		expect(h.deferredMarker()).toBeDefined()

		// The task has since reached a TERMINAL phase.
		h.tracker.setWithWriter("completed", undefined, { writerId: "session-event-turn-complete-completed" })

		await emitPendingPromptSubmitted(h)

		// The barrier-hold guard suppresses the `streaming` re-assertion,
		// so the already-terminal `completed` phase is NOT clobbered.
		expect(h.tracker.currentPhase).toBe("completed")
		// The suppressed writer is the ONLY thing that was skipped: no
		// `session-event-pending-prompt-submitted` write was committed.
		expect(h.phaseWrites.map((w) => w.writerId)).not.toContain("session-event-pending-prompt-submitted")
	})

	it("PTWCR01C01-R1-06b: the pinned T-08a contract is PRESERVED — a `pending_prompt_submitted` over `completed` with NO live barrier still activates `streaming`", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("completed", undefined, { writerId: "session-event-turn-complete-completed" })

		// NO BCB obligation -> NO live barrier -> this is the ORDINARY
		// user follow-up / T-08a case.
		await emitPendingPromptSubmitted(h)

		// T-08a (`completed` -> `streaming` on `pending_prompt_submitted`)
		// is a PINNED contract, verified by
		// `turn-phase-contract01.tpc01.test.ts`. The B2 guard is scoped to
		// the BCB-hold case and MUST NOT suppress it.
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(h.phaseWrites.at(-1)?.writerId).toBe("session-event-pending-prompt-submitted")
	})

	it("PTWCR01C01-R1-07: a STALE session notification cannot alter the current task", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await emitAbortedTurnDone(h)
		await emitPendingPromptSubmitted(h)

		const before = h.tracker.get()

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

	it("PTWCR01C01-R1-08: a provider ERROR still reaches the `error` phase (the repair does NOT mask real failures)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({
			unconsumedTerminalCount: LIVE_HELD_JOB_IDS.length,
			heldTerminalJobIds: LIVE_HELD_JOB_IDS,
		})

		await h.coordinator.handleSessionEvent(
			agentEvent(h.activeSessionId, {
				type: "done",
				reason: "error",
				text: "provider failed",
				iterations: 1,
			}),
		)
		expect(h.tracker.currentPhase).toBe("error")
	})
})
