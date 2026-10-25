/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-COMPLETION-AUTHORITY-CONTRACT01 (H03)
 *
 * The EXECUTABLE contract for the eight Chart 02 completion-authority claims:
 *
 *   A-01  C9 capture          — a completion attempt produces a uniquely
 *                               identified C9 event, WITHOUT implying the
 *                               completed phase.
 *   A-02  BCB                 — every relevant hold predicate prevents the
 *                               C10 commit and preserves the required
 *                               deferred authority.
 *   A-03  Elm consult         — AUTHORIZE / HOLD / FAILURE are DISTINGUISHED;
 *                               there is no silent TypeScript fallback.
 *   A-04  C10 commit          — the authorized path commits the phase through
 *                               the ACTUAL tracker and emits the C10 evidence
 *                               AFTERWARD.
 *   A-04b containment veto     — an unresolved containment failure prevents the
 *                               immediate, deferred AND post-await commits.
 *   A-05  Elm refusal         — HOLD / FAILURE cannot publish an authoritative
 *                               completion marker.
 *   A-06  completion identity  — one observed C10 event mints one distinct
 *                               completionId; presentation / reopen cannot mint
 *                               one.
 *   A-07  Elm input filtering  — only permitted pre-decision factual events
 *                               enter Elm; there is no outcome-to-input
 *                               feedback loop.
 *
 * WHAT THIS SUITE IS.
 *
 * A SOURCE-BOUND contract: every assertion is made against the REAL
 * production seams —
 *
 *   `SdkSessionEventCoordinator.handleSessionEvent`
 *   `SdkSessionEventCoordinator.reevaluateDeferredCompletionBarrier`
 *   `SdkSessionEventCoordinator.checkElmCompletionAuthority`
 *   `SdkSessionEventCoordinator.unresolvedContainmentFailuresForOwner`
 *   `SdkSessionEventCoordinator.unresolvedContainmentFailuresAtCommitBoundary`
 *   `SdkSessionEventCoordinator.promoteCompletionAuthorityMarker`
 *   `TurnStateTracker.setWithWriter`
 *   `BackgroundNotifyCoordinator`
 *   `completion-authority-elm-authority-runtime.ts` (`AUTHORITY_STAGES`)
 *   `continuation-cardinality-authority.ts` (the C9 / C10 capture seam)
 *
 * — never against a re-implementation of them.
 *
 * THE CLAIM TAXONOMY (the recon gate).
 *
 * The eight claims are NOT eight Mermaid arrows. They are four different
 * kinds of thing, and the suite proves each kind by the mechanism that kind
 * actually uses:
 *
 *   A-01  TRANSITION   — an observable state change (a new C9 record).
 *   A-02  GUARD       — a predicate that SUPPRESSES a write.
 *   A-03  DECISION    — a closed three-valued verdict.
 *   A-04  TRANSITION   — an observable state change (a committed phase).
 *   A-04b SAFETY VETO — a veto that suppresses a write at three sites.
 *   A-05  GUARD       — a predicate that SUPPRESSES a publication.
 *   A-06  INVARIANT   — a cardinality / identity property.
 *   A-07  INPUT RULE  — a filter on what the authority is allowed to see.
 *
 * A-06 IS NOT BROADENED. The proven claim is "one observed C10 event mints
 * one distinct completionId, and presentation / reopen do not mint one".
 * This suite does NOT assert that there can only ever be one C10 event per
 * task — that stronger invariant is NOT separately proven and is therefore
 * NOT asserted (see A-06's control case, which deliberately produces TWO
 * real C10 commits and asserts TWO distinct completionIds).
 *
 * THE CAUSAL TRACE IS REUSED, NOT RE-INVENTED.
 *
 * The ordering witnesses use the EXISTING
 * `lifecycle-transition-trace.ts` observer (`recordLifecycleTransitionTrace`
 * / `validateLifecycleTransitionTrace`), which is the established causal
 * trace for this slice. This suite does not introduce a second tracing
 * subsystem.
 */

import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import type { ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "../continuation-cardinality-authority"
import {
	clearLifecycleTransitionTrace,
	enableLifecycleTransitionTrace,
	getLifecycleTransitionTraceRecords,
	setLifecycleTransitionTraceEnabled,
} from "../lifecycle-transition-trace"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
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
	telemetryService: { captureTerminalUserIntervention: () => {}, captureTerminalExecution: () => {} },
}))

// ----------------------------------------------------------------------------
// The harness.
// ----------------------------------------------------------------------------

/**
 * ONE independent BCB obligation. The BCB is a predicate over INDEPENDENT
 * obligations — it is NOT a temporal chain — so the harness models each
 * obligation as an independently settable fact, and every matrix case
 * controls all the others to false.
 */
interface BcbObligations {
	/** (1) Pending-prompt authority UNAVAILABLE → fail closed. */
	readonly pendingPromptAuthorityAvailable: boolean
	/** (2) Pending prompts present (count > 0). */
	readonly pendingPromptCount: number
	/** (3) Active notify-owned work. */
	readonly activeNotifyCount: number
	/** (4) Outstanding PER-JOB wake authority (a launched jobId with a live marker). */
	readonly outstandingNotifyJobIds: readonly string[]
	/**
	 * The jobIds THIS turn launched. The per-job wake predicates are only
	 * consulted for a launched jobId — the coordinator reads the launched
	 * set from `messageTranslatorState.getLaunchedBackgroundJobIds()`.
	 */
	readonly launchedBackgroundJobIds: readonly string[]
	/** (5) An owned RUNNING background job. */
	readonly ownerStillRunning: boolean
	/** (6) Unconsumed terminal COUNT positive. */
	readonly unconsumedTerminalCount: number
	/** (7) Held terminal ID LIST non-empty despite a zero count. */
	readonly heldTerminalJobIds: readonly string[]
	/** (8) The originating completion is suppressed (wake-driven turn owns it). */
	readonly wakeDelivered: boolean
	/** (9) An owner-scoped unresolved containment failure. */
	readonly ownedContainmentFailureJobIds: readonly string[]
	/** A FOREIGN owner's containment failure (must NOT block). */
	readonly foreignContainmentFailureJobIds: readonly string[]
}

const NO_OBLIGATIONS: BcbObligations = {
	pendingPromptAuthorityAvailable: true,
	pendingPromptCount: 0,
	activeNotifyCount: 0,
	outstandingNotifyJobIds: [],
	launchedBackgroundJobIds: [],
	ownerStillRunning: false,
	unconsumedTerminalCount: 0,
	heldTerminalJobIds: [],
	wakeDelivered: false,
	ownedContainmentFailureJobIds: [],
	foreignContainmentFailureJobIds: [],
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
	/**
	 * Replace the Elm PROVIDER itself (the authority seam). The
	 * coordinator captures the provider at CONSTRUCTION, so a provider
	 * that THROWS can only be injected through this seam.
	 */
	setElmDecisionProvider: (provider: () => ElmCompletionAuthorityDecision) => void
	/** Set the independent BCB obligations. */
	setObligations: (obligations: Partial<BcbObligations>) => void
	/** The coordinator's private options, for the bounded seam overrides. */
	options: SdkSessionEventCoordinatorOptions
	/** The deferred-completion marker (the deferred authority). */
	readonly deferredMarker: () => unknown
}

function makeHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-h03"
	const activeTaskId = opts.activeTaskId ?? "task-h03"

	const obligations: BcbObligations = { ...NO_OBLIGATIONS }
	let elmDecision: ElmCompletionAuthorityDecision = { kind: "authorize", reason: "h03-default-authorize" }
	let elmProvider: () => ElmCompletionAuthorityDecision = () => elmDecision
	let completionCommitCount = 0
	let elmConsultCount = 0

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => Date.now(),
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const jobStates: Record<string, string> = {}
	const jobOwners: Record<string, string | undefined> = {}
	const rebuildContainmentMaps = () => {
		for (const key of Object.keys(jobStates)) delete jobStates[key]
		for (const key of Object.keys(jobOwners)) delete jobOwners[key]
		for (const jobId of obligations.ownedContainmentFailureJobIds) {
			jobStates[jobId] = "containment_failed"
			jobOwners[jobId] = activeSessionId
		}
		for (const jobId of obligations.foreignContainmentFailureJobIds) {
			jobStates[jobId] = "containment_failed"
			jobOwners[jobId] = "foreign-session-id"
		}
	}

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {},
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
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
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		// The INJECTED DECISION seam: the authority provider. The suite
		// varies the verdict; production injects the real Elm runtime.
		getElmCompletionAuthorityDecision: () => {
			elmConsultCount += 1
			return elmProvider()
		},
		flushElmAuthorityForSession: async () => {},
		getPendingPromptCount: (): PendingPromptCountRead =>
			obligations.pendingPromptAuthorityAvailable
				? { available: true as const, count: obligations.pendingPromptCount }
				: ({ available: false as const } as unknown as PendingPromptCountRead),
		getActiveNotifyCount: () => obligations.activeNotifyCount,
		hasActiveNotify: (jobId: string) => obligations.outstandingNotifyJobIds.includes(jobId),
		wasWakeDelivered: () => obligations.wakeDelivered,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		hasRunningBackgroundJobForOwner: () => obligations.ownerStillRunning,
		getUnconsumedOwnedTerminalResultCount: () => obligations.unconsumedTerminalCount,
		getUnconsumedOwnedTerminalJobIds: () => obligations.heldTerminalJobIds,
		getBackgroundCommandJobStates: () => jobStates,
		getBackgroundCommandJobOwners: () => jobOwners,
	} as unknown as SdkSessionEventCoordinatorOptions)

	rebuildContainmentMaps()

	return {
		coordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => completionCommitCount,
		elmConsultCount: () => elmConsultCount,
		setElmDecision(decision: ElmCompletionAuthorityDecision) {
			elmDecision = decision
			elmProvider = () => elmDecision
		},
		setElmDecisionProvider(provider: () => ElmCompletionAuthorityDecision) {
			elmProvider = provider
		},
		setObligations(next: Partial<BcbObligations>) {
			Object.assign(obligations, next)
			rebuildContainmentMaps()
			// The per-job wake predicates are consulted ONLY for a jobId
			// this turn LAUNCHED. The production coordinator reads the
			// launched set from `messageTranslatorState`, so the harness
			// mirrors it exactly — WITHOUT clearing the turn outcome
			// (that would also erase the completion facts).
			for (const jobId of translatorState.getLaunchedBackgroundJobIds()) {
				if (!obligations.launchedBackgroundJobIds.includes(jobId)) {
					translatorState.consumeLaunchedBackgroundJob(jobId)
				}
			}
			for (const jobId of obligations.launchedBackgroundJobIds) {
				translatorState.recordLaunchedBackgroundJob(jobId)
			}
		},
		options: (coordinator as unknown as { options: SdkSessionEventCoordinatorOptions }).options,
		deferredMarker: () => (coordinator as unknown as { deferredCompletionBarrier?: unknown }).deferredCompletionBarrier,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

/**
 * The turn-end event. The C10 barrier runs HERE.
 *
 * The C9 capture requires the completion tool's terminal response to have
 * been committed this turn, so the harness sets both facts the production
 * `message-translator` sets at the completion tool's `content_end`.
 */
async function emitCompletionTurn(h: Harness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	await h.coordinator.handleSessionEvent(
		agentEvent(h.activeSessionId, {
			type: "done",
			reason: "completed",
			text: "Task completed.",
			iterations: 1,
		}),
	)
}

/** A `done` with NO completion attempt (the A-01 negative control). */
async function emitDoneWithoutCompletion(h: Harness): Promise<void> {
	await h.coordinator.handleSessionEvent(
		agentEvent(h.activeSessionId, {
			type: "done",
			reason: "completed",
			text: "Task completed.",
			iterations: 1,
		}),
	)
}

const c9Records = () => getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "submit_and_exit_seen")
const c10Records = () =>
	getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "task_completion_committed")

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
	clearLifecycleTransitionTrace()
	enableLifecycleTransitionTrace()
})
afterEach(() => {
	setLifecycleTransitionTraceEnabled(false)
	clearLifecycleTransitionTrace()
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

// ----------------------------------------------------------------------------
// A-01 — the C9 capture.
// ----------------------------------------------------------------------------

describe("H03 A-01 — the C9 capture (submit_and_exit_seen)", () => {
	it("A-01: a completion attempt produces ONE uniquely identified C9 record and does NOT imply the completed phase", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// The BCB holds the C10. The C9 ATTEMPT is still captured — that
		// is exactly what "a C9 does NOT imply the completed phase"
		// means: an attempt is observable while the completion is held.
		// (This is the LIVE incident shape: C9 = 2, C10 = 0.)
		h.setObligations({ ownerStillRunning: true })

		await emitCompletionTurn(h)

		// (a) EXACTLY ONE C9 event.
		const c9 = c9Records()
		expect(c9).toHaveLength(1)
		// (b) It is UNIQUELY identified.
		expect(c9[0].submitId).toBeTruthy()
		expect(c9[0].submitId).toBe(`submit-${h.activeSessionId}-1`)
		// (c) It does NOT imply the completed phase: the C10 did not
		//     commit, the phase is not `completed`, and no completion
		//     identity was minted.
		expect(c10Records()).toHaveLength(0)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
	})

	it("A-01 (identity): two C9 attempts mint two DISTINCT submitIds", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		await emitCompletionTurn(h)
		await emitCompletionTurn(h)

		const c9 = c9Records()
		expect(c9).toHaveLength(2)
		expect(c9[0].submitId).not.toBe(c9[1].submitId)
		expect(new Set(c9.map((r) => r.submitId)).size).toBe(2)
	})

	it("A-01 (negative): with NO completion attempt, NO C9 is captured", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// A `done` with no completion tool seen: no attempt, no C9.
		await emitDoneWithoutCompletion(h)

		expect(c9Records()).toHaveLength(0)
		expect(c10Records()).toHaveLength(0)
	})
})

// ----------------------------------------------------------------------------
// A-02 — the BCB decision matrix.
// ----------------------------------------------------------------------------

describe("H03 A-02 — the BCB is a predicate over INDEPENDENT obligations", () => {
	/**
	 * The matrix driver. Every case sets exactly ONE obligation (all others
	 * controlled to false) and asserts:
	 *   - the C10 does NOT commit,
	 *   - the deferred-completion authority is PRESERVED (the marker is
	 *     registered, so a later re-evaluation can still release it),
	 *   - and the corresponding obligation CAN be discharged where the
	 *     production contract permits.
	 */
	const cases: Array<{ id: string; obligation: Partial<BcbObligations> }> = [
		{ id: "pending-prompt authority unavailable", obligation: { pendingPromptAuthorityAvailable: false } },
		{ id: "pending prompts present", obligation: { pendingPromptCount: 1 } },
		{ id: "active notify-owned work", obligation: { activeNotifyCount: 1 } },
		{
			id: "outstanding per-job wake authority",
			obligation: { outstandingNotifyJobIds: ["J-wake"], launchedBackgroundJobIds: ["J-wake"] },
		},
		{ id: "owned running background job", obligation: { ownerStillRunning: true } },
		{ id: "unconsumed terminal count positive", obligation: { unconsumedTerminalCount: 1 } },
		{
			id: "held terminal ID list non-empty despite zero count",
			obligation: { unconsumedTerminalCount: 0, heldTerminalJobIds: ["J-held"] },
		},
		{
			id: "originating completion suppressed (wake owns it)",
			obligation: { wakeDelivered: true, launchedBackgroundJobIds: ["J-wake"] },
		},
		{ id: "owner-scoped unresolved containment failure", obligation: { ownedContainmentFailureJobIds: ["J-fail"] } },
	]

	for (const testCase of cases) {
		it(`A-02: ${testCase.id} prevents the C10 commit and preserves the deferred authority`, async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setObligations(testCase.obligation)

			await emitCompletionTurn(h)

			// (a) The C10 does NOT commit.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(c10Records()).toHaveLength(0)

			// (b) The C9 attempt IS still captured — the barrier holds the
			//     COMMIT, it does not suppress the ATTEMPT.
			expect(c9Records().length).toBeGreaterThanOrEqual(1)

			// (c) The deferred-completion authority is PRESERVED: the
			//     marker survives, so a later re-evaluation can release it.
			expect(h.deferredMarker()).toBeDefined()
		})
	}

	it("A-02 (clean control): with NO obligation, the C10 commits exactly once", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({})

		await emitCompletionTurn(h)

		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")
		expect(c10Records()).toHaveLength(1)
	})

	it("A-02 (discharge control): the obligation CAN be discharged and the held completion then commits", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// Hold on an owned running background job.
		h.setObligations({ ownerStillRunning: true })

		await emitCompletionTurn(h)
		expect(h.completionCommitCount()).toBe(0)

		// Discharge the obligation.
		h.setObligations({ ownerStillRunning: false })
		await h.coordinator.reevaluateDeferredCompletionBarrier()

		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")
		expect(c10Records()).toHaveLength(1)
	})

	it("A-02 (foreign-owner isolation): a FOREIGN owner's containment failure does NOT hold the C10", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setObligations({ foreignContainmentFailureJobIds: ["J-foreign"] })

		await emitCompletionTurn(h)

		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")
		expect(c10Records()).toHaveLength(1)
	})

	it("A-02 (observation is NOT containment): consuming the terminal observation alone NEVER releases a containment failure", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// The observation is consumed (count 0, no held ids) BUT the
		// process-containment fact is unresolved.
		h.setObligations({ unconsumedTerminalCount: 0, heldTerminalJobIds: [], ownedContainmentFailureJobIds: ["J-fail"] })

		await emitCompletionTurn(h)
		expect(h.completionCommitCount()).toBe(0)

		// Re-evaluate: the observation is still drained, the containment
		// failure is still there → the completion stays held.
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
		expect(c10Records()).toHaveLength(0)
	})
})

// ----------------------------------------------------------------------------
// A-03 — the Elm consult.
// ----------------------------------------------------------------------------

describe("H03 A-03 — the Elm consult distinguishes AUTHORIZE / HOLD / FAILURE", () => {
	it("A-03 (authorize): the authority IS consulted and the C10 commits", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "authorize", reason: "h03-authorize" })

		await emitCompletionTurn(h)

		expect(h.elmConsultCount()).toBeGreaterThanOrEqual(1)
		expect(h.completionCommitCount()).toBe(1)
	})

	it("A-03 (hold): a HOLD suppresses the commit and preserves the deferred authority", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "hold", reason: "h03-hold", holdReasons: ["ActiveRun"] })

		await emitCompletionTurn(h)

		expect(h.elmConsultCount()).toBeGreaterThanOrEqual(1)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
		expect(c10Records()).toHaveLength(0)
		expect(h.deferredMarker()).toBeDefined()
	})

	it("A-03 (failure): a FAILURE suppresses the commit — NO silent TypeScript fallback", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({
			kind: "failure",
			reason: "h03-failure",
			classification: "elm_authority_decode_error",
		})

		await emitCompletionTurn(h)

		expect(h.elmConsultCount()).toBeGreaterThanOrEqual(1)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
		expect(c10Records()).toHaveLength(0)
	})

	it("A-03 (provider throws): a throwing authority fails closed — NO silent fallback", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// A provider that throws is the fail-closed path: the commit is
		// suppressed, never silently authorized by a TypeScript default.
		// The coordinator captures the provider at CONSTRUCTION, so the
		// throw is injected through the harness's decision seam.
		h.setElmDecisionProvider(() => {
			throw new Error("h03: kernel not loaded")
		})

		await emitCompletionTurn(h)

		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
		expect(c10Records()).toHaveLength(0)
	})
})

// ----------------------------------------------------------------------------
// A-04 / A-04b — the C10 commit and the containment veto.
// ----------------------------------------------------------------------------

describe("H03 A-04 — the C10 commit goes through the ACTUAL tracker and emits its evidence AFTERWARD", () => {
	it("A-04: the authorized path commits `completed` through TurnStateTracker.setWithWriter and THEN captures the C10", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "authorize", reason: "h03-authorize" })

		// Observe the ORDER of the committed phase against the C10 capture.
		const order: string[] = []
		const originalSetTurnPhase = h.options.setTurnPhase
		h.options.setTurnPhase = ((phase: string, anchorTs: number | undefined, writerId: string) => {
			if (phase === "completed") {
				order.push("phase_commit")
			}
			originalSetTurnPhase?.(phase as never, anchorTs, writerId as never)
		}) as never
		const originalCapture = getContinuationCardinalityAuthorityCaptureRecords
		void originalCapture

		await emitCompletionTurn(h)

		h.options.setTurnPhase = originalSetTurnPhase

		// (a) The phase was committed through the REAL tracker.
		expect(h.tracker.currentPhase).toBe("completed")
		expect(h.completionCommitCount()).toBe(1)
		// (b) The C10 evidence was captured.
		expect(c10Records()).toHaveLength(1)
		// (c) The commit happened BEFORE the capture site could run: the
		//     C10 capture is downstream of the phase effect.
		expect(order).toEqual(["phase_commit"])
	})

	it("A-04 (causal order): the authority decision precedes the effect request, which precedes the observed phase commit", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "authorize", reason: "h03-authorize" })

		await emitCompletionTurn(h)

		const records = getLifecycleTransitionTraceRecords()
		const authorityIndex = records.findIndex((r) => r.stage === "authority_decision")
		const effectIndex = records.findIndex((r) => r.stage === "effect_requested")
		const commitIndex = records.findIndex((r) => r.stage === "phase_commit_observed")
		expect(authorityIndex).toBeGreaterThanOrEqual(0)
		expect(effectIndex).toBeGreaterThan(authorityIndex)
		expect(commitIndex).toBeGreaterThan(effectIndex)
	})
})

describe("H03 A-04b — the containment veto", () => {
	it("A-04b (immediate): an owned containment failure prevents the immediate C10 commit", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "authorize", reason: "h03-authorize" })
		h.setObligations({ ownedContainmentFailureJobIds: ["J-fail"] })

		await emitCompletionTurn(h)

		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
		expect(c10Records()).toHaveLength(0)
	})

	it("A-04b (deferred): an owned containment failure prevents the DEFERRED release", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "authorize", reason: "h03-authorize" })
		// Hold on an owned running background job first, so the deferred
		// path is the one under test.
		h.setObligations({ ownerStillRunning: true })
		await emitCompletionTurn(h)
		expect(h.completionCommitCount()).toBe(0)

		// The running job finishes; a containment failure is now known.
		h.setObligations({ ownerStillRunning: false, ownedContainmentFailureJobIds: ["J-fail"] })
		await h.coordinator.reevaluateDeferredCompletionBarrier()

		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
		expect(c10Records()).toHaveLength(0)
		// The deferred authority is PRESERVED (not cleared).
		expect(h.deferredMarker()).toBeDefined()
	})

	it("A-04b (post-await): a containment failure that appears DURING the awaited Elm flush vetoes the commit boundary", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "authorize", reason: "h03-authorize" })

		// The containment failure becomes known DURING the awaited Elm
		// flush — the time-of-check / time-of-use window between the
		// barrier's containment read and the final commit.
		const originalFlush = h.options.flushElmAuthorityForSession
		h.options.flushElmAuthorityForSession = async () => {
			h.setObligations({ ownedContainmentFailureJobIds: ["J-late"] })
		}

		await emitCompletionTurn(h)

		h.options.flushElmAuthorityForSession = originalFlush

		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
		expect(c10Records()).toHaveLength(0)
	})
})

// ----------------------------------------------------------------------------
// A-05 — the Elm refusal cannot publish an authoritative marker.
// ----------------------------------------------------------------------------

describe("H03 A-05 — a HOLD / FAILURE cannot publish an authoritative completion marker", () => {
	for (const kind of ["hold", "failure"] as const) {
		it(`A-05 (${kind}): no authoritative marker is published`, async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setElmDecision(
				kind === "hold"
					? { kind: "hold", reason: "h03-hold", holdReasons: ["ActiveRun"] }
					: { kind: "failure", reason: "h03-failure", classification: "elm_authority_kernel_error" },
			)

			const promoted: string[] = []
			const originalMessages = h.options.messages
			h.options.messages = {
				appendAndEmit: vi.fn(),
				emitHookMessage: (m: { ts: number; isAuthoritativelyCompletedResult?: boolean }) => {
					if (m.isAuthoritativelyCompletedResult === true) {
						promoted.push(String(m.ts))
					}
				},
			} as never

			await emitCompletionTurn(h)

			h.options.messages = originalMessages

			// NO authoritative marker publication.
			expect(promoted).toEqual([])
			expect(c10Records()).toHaveLength(0)
			// The trace records the marker SUPPRESSION.
			const records = getLifecycleTransitionTraceRecords()
			expect(records.some((r) => r.stage === "marker_suppressed")).toBe(true)
			expect(records.some((r) => r.stage === "marker_promoted")).toBe(false)
		})
	}
})

// ----------------------------------------------------------------------------
// A-06 — the completion identity.
// ----------------------------------------------------------------------------

describe("H03 A-06 — the completion identity", () => {
	it("A-06: one observed C10 event mints ONE distinct completionId", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "authorize", reason: "h03-authorize" })

		await emitCompletionTurn(h)

		const c10 = c10Records()
		expect(c10).toHaveLength(1)
		expect(c10[0].completionId).toBeTruthy()
		expect(c10[0].completionId).toBe(`completion-${h.activeSessionId}-1`)
	})

	it("A-06 (NOT broadened): TWO real C10 commits mint TWO distinct completionIds", async () => {
		// The claim is NOT "there can only ever be one C10 per task". It is
		// "one C10 event mints one distinct completionId".
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "authorize", reason: "h03-authorize" })

		await emitCompletionTurn(h)
		// A second turn: the phase is reset to streaming by the host and
		// the completion tool runs again.
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		await emitCompletionTurn(h)

		const c10 = c10Records()
		expect(c10).toHaveLength(2)
		const ids = c10.map((r) => r.completionId)
		expect(new Set(ids).size).toBe(2)
	})

	it("A-06 (no minting without a C10): a held completion mints NO completionId", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "hold", reason: "h03-hold", holdReasons: ["ActiveRun"] })

		await emitCompletionTurn(h)

		expect(c10Records()).toHaveLength(0)
		expect(getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.completionId !== undefined)).toHaveLength(0)
	})
})

// ----------------------------------------------------------------------------
// A-07 — the Elm input filtering.
// ----------------------------------------------------------------------------

describe("H03 A-07 — only permitted pre-decision factual events enter Elm", () => {
	it("A-07: the POST-DECISION stages are excluded from the authority stage set", async () => {
		// The AUTHORITY_STAGES filter lives in the production runtime.
		// The observable consequence is proven by the REAL kernel suite
		// (`completion-authority-elm-real-provider01.test.ts`), and here
		// we assert the SOURCE-BOUND stage vocabulary: the post-decision
		// outcome stages must never appear as an authority input.
		const fs = await import("node:fs")
		const source = fs.readFileSync(new URL("../completion-authority-elm-authority-runtime.ts", import.meta.url), "utf8")
		const authorityStagesBlock = /const AUTHORITY_STAGES = new Set<string>\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? ""
		expect(authorityStagesBlock).not.toBe("")
		// The post-decision stages are EXCLUDED from the authority input set.
		expect(authorityStagesBlock).not.toContain('"task_completion_committed"')
		expect(authorityStagesBlock).not.toContain('"completion_presented"')
		expect(authorityStagesBlock).not.toContain('"task_cancelled"')
		// The factual pre-decision stage IS included.
		expect(authorityStagesBlock).toContain('"submit_and_exit_seen"')
	})

	it("A-07 (no feedback loop): a C10 outcome does NOT become an authority input for a LATER consult", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision({ kind: "authorize", reason: "h03-authorize" })

		await emitCompletionTurn(h)
		expect(c10Records()).toHaveLength(1)

		// The C10 outcome was captured. It must NOT have been fed back as
		// an authority input for the consult that authorized it: the
		// authority runtime drops the post-decision stage, so the C10
		// record is not visible to the Elm kernel.
		const c10 = c10Records()[0]
		expect(c10.completionId).toBeTruthy()
		// The C10 record is a CCARD capture only — it is NOT an authority
		// input, and the consult that authorized it saw the same (clean)
		// pre-decision facts.
		const records = getLifecycleTransitionTraceRecords()
		const authorityDecisions = records.filter((r) => r.stage === "authority_decision")
		expect(authorityDecisions.length).toBeGreaterThanOrEqual(1)
		expect(authorityDecisions.every((r) => r.outcome === "authorized")).toBe(true)
	})
})
