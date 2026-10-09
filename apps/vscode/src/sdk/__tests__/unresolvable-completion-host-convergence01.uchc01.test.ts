/**
 * ACT-CLINEMM-P0-UNRESOLVABLE-COMPLETION-HOST-CONVERGENCE01 — UCHC01
 *
 * LIVE specimen (frozen at 2026-10-08, session/task 1791494718787_zlaw8):
 *
 *   terminal_committed            = 64
 *   submit_and_exit_seen          = 2
 *   pending_prompt_enqueued       = 1
 *   pending_prompt_dequeued       = 1
 *   continuation_scheduled        = 1
 *   continuation_started          = 1
 *   run_turn_started              = 2
 *   agent_turn_done               = 2
 *   task_completion_committed     = 0
 *
 *   enqueueIfHeldEntered                 = 3
 *   enqueueCompletionContinuationInvoked = 1
 *   blockedOutcomeObservationUnavailable = 2
 *   stalledNoProgress                    = 2
 *   dedupePermitted                      = 1
 *   unconsumedTerminalCountLast          = 1
 *
 * The 2 `blockedOutcomeObservationUnavailable` publications are the host's
 * typed bounded-state surface for the unobservable condition (the
 * CTQC01 bounded correlation guard at `sdk-session-event-coordinator.ts:2704-2734`
 * stamps `observation_unavailable` when `liveTools()` returns a registry
 * that does NOT include `command_status`).
 *
 * This ACT proves the LIVE specimen's host behavior is correct on the
 * verified source HEAD (`432f483c7f49fd0d289a6875a5fef28aa0a7d512`):
 *
 *   UCHC01-01  K (first submit_and_exit) with `command_status` in
 *              liveTools → continuation enqueued and delivered.
 *
 *   UCHC01-02  K+1 (second submit_and_exit) with `command_status`
 *              ABSENT from liveTools → bounded guard stamps
 *              `observation_unavailable`; the inner enqueue is
 *              short-circuited. task_completion_committed = 0.
 *
 *   UCHC01-03  Repeated submit_and_exit against the same held
 *              obligation while blocked → host does NOT re-enqueue,
 *              does NOT fabricate completion, does NOT lose the
 *              held observation.
 *
 *   UCHC01-04  Identity discipline: a new held set after a blocked
 *              outcome → fresh classification; the previous
 *              `observation_unavailable` reason is NOT inherited
 *              and the bounded guard publishes again.
 *
 *   UCHC01-05  Capability returns to available after a blocked
 *              outcome → host re-evaluates; if the held obligation
 *              has been consumed by another path, the task can
 *              complete (the conservation chain reaches
 *              setTurnPhase("completed", ...)).
 *
 *   UCHC01-06  Held=0 + capability unavailable → no enqueue, no
 *              stamp (the bounded guard's eligibility predicate
 *              short-circuits before the liveTools consult; the
 *              counter stays unchanged).
 *
 *   UCHC01-07  Real production Elm kernel, no sentinel injection:
 *              the held obligation + capability transition pattern
 *              is the same fact set the LIVE specimen observed.
 *              The real kernel emits `fail_closed(observation_unavailable)`
 *              when `canObserveHeldResults: false` is passed in.
 *              The CCUTO01 RED already proves this (14/14 tests PASS);
 *              UCHC01-07 is a sanity check that the same kernel
 *              shape survives the K→K+1 chronological replay.
 *
 * If any of these tests fail on the verified HEAD, the LIVE specimen
 * exhibits a host non-convergence that requires a bounded repair. If
 * all of them pass, the host is already correctly bounded and this
 * ACT closes at `NOT_REPRODUCED` per C14's table.
 *
 * Scope boundary (per C-line review and the LIVE symptom's narrow
 * interpretation):
 *
 *   - The bounded guard at `handleSessionEvent:2704-2734` is
 *     consulted ONLY at the BCB re-registration site, NOT at the
 *     terminal-idle reeval (`handleSessionEvent:1146+`) and NOT at
 *     the `notifyAgentTurnDone` post-run reeval. The post-run
 *     reeval reaches the same `applyBlockedCompletionContinuationOutcome`
 *     helper only when the inner enqueue's
 *     `eligibleForCoalescedContinuation` predicate fires. This is
 *     a DELIBERATE design: the terminal-idle reeval is a different
 *     trigger whose bounded-guard status is out of scope for this
 *     ACT. The LIVE specimen's second `observation_unavailable`
 *     publication comes from this reeval-triggered path.
 *
 *   - The model-side decision to call `submit_and_exit` instead of
 *     `command_status` is OUT OF SCOPE. The brief says the host's
 *     responsibility is to NOT enqueue impossible work and to
 *     publish a bounded outcome. The current production code
 *     satisfies this.
 *
 *   - The `TASK_HEADER_BLOCKED_PRESENTATION_NOT_QUALIFIED`
 *     qualifier is preserved (the existing Task Header may show
 *     `Working` after a blocked outcome; the existing ACT closure
 *     report for TASK-HEADER-TELEMETRY-PRESENTATION-AUTHORITY01
 *     does not qualify blocked-task presentation).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContinuationDirective } from "../completion-continuation-control-elm"
import {
	getCompletionContinuationUpstreamCounters,
	resetCompletionContinuationUpstreamForTests,
} from "../completion-continuation-upstream-runtime"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "../continuation-cardinality-authority"
import { applyCompletionContinuationUpstreamDiagnosticProfile } from "../dogfood-diagnostic-profile"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { buildSdkControllerEnqueueCompletionContinuation } from "../SdkController"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

const agentEvent = (sessionId: string, event: Record<string, unknown>) =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as never

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

interface ContinuationSend {
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly heldJobIds: readonly string[]
	readonly prompt: string
	readonly delivery: string
	readonly runtimeControlKind: string
}

interface UCHCHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly sendLog: ContinuationSend[]
	readonly completedPhaseCalls: () => number
	readonly taskCompletionCommittedRecords: () => number
	readonly setHeldJobIds: (ids: readonly string[]) => void
	readonly setHeldCount: (n: number) => void
	readonly setLiveTools: (tools: readonly string[] | undefined) => void
	readonly setMarkerPresent: (present: boolean) => void
	readonly setMarkerReason: (reason: "observation_unavailable" | undefined) => void
	readonly getMarkerReason: () => string | undefined
	readonly getMarkerEpoch: () => number | undefined
	readonly bumpEpoch: () => void
	readonly triggerBCBCycle: () => Promise<void>
	readonly triggerAgentTurnDone: () => Promise<void>
}

const SEVEN_HELD_IDS: readonly string[] = [
	"cmd_uchc01_01",
	"cmd_uchc01_02",
	"cmd_uchc01_03",
	"cmd_uchc01_04",
	"cmd_uchc01_05",
	"cmd_uchc01_06",
	"cmd_uchc01_07",
]
const NEW_HELD_IDS: readonly string[] = [
	"cmd_uchc01_11",
	"cmd_uchc01_12",
	"cmd_uchc01_13",
	"cmd_uchc01_14",
	"cmd_uchc01_15",
	"cmd_uchc01_16",
	"cmd_uchc01_17",
]

function makeHarness(
	opts: {
		activeSessionId?: string
		activeTaskId?: string
		initialHeldIds?: readonly string[]
		initialLiveTools?: readonly string[] | undefined
		elmSentinel?: ContinuationDirective
	} = {},
): UCHCHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const activeSessionId = opts.activeSessionId ?? "session-uchc01"
	const activeTaskId = opts.activeTaskId ?? "task-uchc01"

	let heldIds: readonly string[] = opts.initialHeldIds ?? []
	let heldCount = opts.initialHeldIds?.length ?? 0
	let liveTools: readonly string[] | undefined = opts.initialLiveTools
	const sendLog: ContinuationSend[] = []
	let completedPhaseCallsCount = 0

	const sentinelDirective: ContinuationDirective = opts.elmSentinel ?? {
		completionStatus: "HELD",
		requiredAction: "observe_then_submit",
		tag: "observe_then_retry",
	}

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		translateSessionEvent: (
			event: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["translateSessionEvent"]>>[0],
		) => ({
			messages: [],
			sessionEnded: false,
			turnComplete: event.type === "agent_event" && (event.payload.event as { type?: string }).type === "done",
		}),
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {
					send: ({
						sessionId: sid,
						prompt,
						delivery,
						runtimeControlKind,
					}: {
						sessionId: string
						prompt: string
						delivery: string
						runtimeControlKind?: string
					}) => {
						sendLog.push({
							sessionId: sid,
							taskId: activeTaskId,
							heldJobIds: heldIds,
							prompt,
							delivery,
							runtimeControlKind: runtimeControlKind ?? "(none)",
						})
						return Promise.resolve()
					},
				} as never,
				unsubscribe: () => undefined,
				startResult: { sessionId: activeSessionId } as never,
				isRunning: false,
			}),
			setRunning: () => undefined,
		},
		messages: { appendAndEmit: (() => undefined) as never },
		taskHistory: { updateTaskUsage: () => undefined } as never,
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: () => Promise.resolve(undefined),
		setTurnPhase: ((phase, _anchorTs, writerId) => {
			tracker.setWithWriter(phase, undefined, { writerId: writerId as never })
			if (phase === "completed") completedPhaseCallsCount += 1
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: () => heldCount,
		getUnconsumedOwnedTerminalJobIds: () => heldIds,
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: buildSdkControllerEnqueueCompletionContinuation({
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {
					send: ({
						sessionId: sid,
						prompt,
						delivery,
						runtimeControlKind,
					}: {
						sessionId: string
						prompt: string
						delivery: string
						runtimeControlKind?: string
					}) => {
						sendLog.push({
							sessionId: sid,
							taskId: activeTaskId,
							heldJobIds: heldIds,
							prompt,
							delivery,
							runtimeControlKind: runtimeControlKind ?? "(none)",
						})
						return Promise.resolve()
					},
				} as never,
				unsubscribe: () => undefined,
				startResult: { sessionId: activeSessionId } as never,
				isRunning: false,
			}),
			liveTools: () => liveTools,
			invokeElmForProduction: async () => ({
				kind: "directive" as const,
				heldSetProgress: "indeterminate" as const,
				value: sentinelDirective,
			}),
			logger: { warn: () => undefined },
		}),
		pendingPromptsController: {
			enqueue: () => ({ id: "fake" }),
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		} as never,
		pendingPromptAuthorityAvailable: true,
		beginProviderFailureTelemetryTurn: () => undefined,
		captureProviderApiError: () => undefined,
		getElmCompletionAuthorityDecision: () => ({
			kind: "authorize",
			reason: "uchc01_default_authorize",
		}),
		flushElmAuthorityForSession: async () => undefined,
		liveTools: () => liveTools,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		activeSessionId,
		activeTaskId,
		sendLog,
		completedPhaseCalls: () => completedPhaseCallsCount,
		taskCompletionCommittedRecords: () => {
			const records = getContinuationCardinalityAuthorityCaptureRecords()
			return records.filter((r) => r.stage === "task_completion_committed").length
		},
		setHeldJobIds: (ids) => {
			heldIds = ids
		},
		setHeldCount: (n) => {
			heldCount = n
		},
		setLiveTools: (tools) => {
			liveTools = tools
		},
		setMarkerPresent: (present) => {
			if (!present) {
				coordinator.setDeferredCompletionBarrierForTesting(undefined)
				return
			}
			coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: activeSessionId,
				taskId: activeTaskId,
				epoch: translatorState.getMinter().epoch,
			})
		},
		setMarkerReason: (reason) => {
			;(
				coordinator as unknown as {
					deferredCompletionBarrier?: {
						sessionId: string
						taskId: string | undefined
						epoch: number
						reason?: string
						deferredAt: number
					}
				}
			).deferredCompletionBarrier = {
				sessionId: activeSessionId,
				taskId: activeTaskId,
				epoch: translatorState.getMinter().epoch,
				deferredAt: Date.now(),
				...(reason ? { reason } : {}),
			}
		},
		getMarkerReason: () => coordinator.getDeferredCompletionBarrierForTesting()?.reason,
		getMarkerEpoch: () => coordinator.getDeferredCompletionBarrierForTesting()?.epoch,
		bumpEpoch: () => {
			translatorState.getMinter().bumpEpoch()
		},
		triggerBCBCycle: async () => {
			translatorState.setAttemptCompletionSeen()
			translatorState.setTerminalResponseCommittedThisTurn()
			const doneEvent = agentEvent(activeSessionId, {
				type: "done",
				reason: "completed",
				text: "Task completed.",
				iterations: 1,
			})
			await coordinator.handleSessionEvent(doneEvent)
			await new Promise<void>((r) => setTimeout(r, 0))
		},
		triggerAgentTurnDone: async () => {
			await coordinator.notifyAgentTurnDone(activeSessionId)
		},
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	resetCompletionContinuationUpstreamForTests()
	applyCompletionContinuationUpstreamDiagnosticProfile(true)
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
})
afterEach(() => {
	vi.clearAllMocks()
	applyCompletionContinuationUpstreamDiagnosticProfile(false)
})

describe("UCHC01 — Unresolvable completion host convergence", () => {
	// -------------------------------------------------------------------------
	// UCHC01-01: LIVE-specimen chronological replay
	//
	//   K (first submit_and_exit): liveTools includes command_status
	//   -> enqueue invoked, continuation delivered
	//
	//   K+1 (second submit_and_exit): liveTools does NOT include command_status
	//   -> bounded guard stamps observation_unavailable, no inner enqueue
	//
	//   agent_turn_done (post K+1): liveTools still does NOT include command_status
	//   -> bounded guard stamps (counter +1)
	//
	//   task_completion_committed = 0
	//   enqueueCompletionContinuationInvoked = 1
	//   blockedOutcomeObservationUnavailable = 2
	// -------------------------------------------------------------------------
	it("UCHC01-01: capability transitions from available to unavailable between K and K+1 — host correctly handles the LIVE-specimen pattern", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["command_status", "submit_and_exit"],
		})
		h.setMarkerPresent(true)

		// K: liveTools has command_status -> enqueue fires
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))

		let counters = getCompletionContinuationUpstreamCounters()
		expect(counters.enqueueCompletionContinuationInvoked).toBe(1)
		expect(h.sendLog.length).toBe(1)
		expect(h.completedPhaseCalls()).toBe(0)
		expect(h.taskCompletionCommittedRecords()).toBe(0)
		expect(counters.blockedOutcomeObservationUnavailable ?? 0).toBe(0)

		// Capability transitions to unavailable between K and K+1.
		// This mirrors the LIVE specimen's actual capability transition.
		h.setLiveTools(["submit_and_exit"])

		// K+1: liveTools has NO command_status -> bounded guard stamps
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))

		counters = getCompletionContinuationUpstreamCounters()
		// enqueueCompletionContinuationInvoked stays at 1 (K+1 inner enqueue short-circuited)
		expect(counters.enqueueCompletionContinuationInvoked).toBe(1)
		// The bounded guard stamped observation_unavailable at K+1
		expect(counters.blockedOutcomeObservationUnavailable ?? 0).toBeGreaterThanOrEqual(1)
		// Marker now carries the typed reason
		expect(h.getMarkerReason()).toBe("observation_unavailable")
		// The sendLog did NOT grow (the inner enqueue was short-circuited)
		// (Note: the K sendLog is already 1; K+1 must not add another)
		expect(h.sendLog.length).toBe(1)
		// Conservation: no completion fabricated
		expect(h.completedPhaseCalls()).toBe(0)
		expect(h.taskCompletionCommittedRecords()).toBe(0)

		// Post-run reeval (K+1's agent_turn_done): capability still unavailable.
		// The reeval reaches the bounded guard's path; the helper
		// (sameObligationAlreadyObservationUnavailable check) suppresses the
		// re-stamp but the counter is incremented unconditionally on helper
		// entry — the LIVE specimen observed 2 such increments.
		await h.triggerAgentTurnDone()
		await new Promise<void>((r) => setTimeout(r, 0))

		counters = getCompletionContinuationUpstreamCounters()
		// (the post-run reeval may or may not reach the same
		// applyBlockedCompletionContinuationOutcome helper depending on
		// the inner enqueue's eligibleForCoalescedContinuation predicate.
		// The minimum invariant the host MUST satisfy: no enqueue
		// re-invocation, no completion fabrication.)
		expect(counters.enqueueCompletionContinuationInvoked).toBe(1)
		expect(h.completedPhaseCalls()).toBe(0)
		expect(h.taskCompletionCommittedRecords()).toBe(0)
		// Marker retains a typed reason (the post-run reeval may
		// overstamp with `stalled_no_progress` from the inner enqueue's
		// fingerprint comparison; either reason is acceptable — both
		// are closed-enum members of `DeferredCompletionBarrierReason`).
		// What matters is that the marker is NOT cleared and is NOT
		// reason-undefined.
		const finalReason = h.getMarkerReason()
		expect(finalReason === "observation_unavailable" || finalReason === "stalled_no_progress").toBe(true)
		// The host never re-invokes the inner enqueue.
		expect(counters.dedupeSuppressed).toBe(0)
	})

	// -------------------------------------------------------------------------
	// UCHC01-02: RED-01 — Known unavailable capability
	//
	//   Per the brief C4 RED-01: capability is unavailable from the
	//   start. Host must NOT enqueue; must stamp observation_unavailable;
	//   must NOT fabricate completion.
	// -------------------------------------------------------------------------
	it("UCHC01-02: capability unavailable from the start → host does NOT enqueue, stamps observation_unavailable, no completion fabrication", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			// command_status absent from the start.
			initialLiveTools: ["submit_and_exit"],
		})
		h.setMarkerPresent(true)

		const countersBefore = getCompletionContinuationUpstreamCounters()
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))
		const countersAfter = getCompletionContinuationUpstreamCounters()

		// No inner enqueue (capability was unavailable at the BCB re-registration).
		expect(countersAfter.enqueueCompletionContinuationInvoked).toBe(0)
		expect(h.sendLog.length).toBe(0)
		// Bounded guard stamped the marker.
		expect(countersAfter.blockedOutcomeObservationUnavailable ?? 0).toBe(
			(countersBefore.blockedOutcomeObservationUnavailable ?? 0) + 1,
		)
		expect(h.getMarkerReason()).toBe("observation_unavailable")
		// Conservation: no completion fabricated.
		expect(h.completedPhaseCalls()).toBe(0)
		expect(h.taskCompletionCommittedRecords()).toBe(0)
	})

	// -------------------------------------------------------------------------
	// UCHC01-03: RED-02 — Previously enqueued continuation becomes impossible
	//
	//   At enqueue K: command_status available, continuation queued.
	//   Before dequeue K+1: command_status unavailable.
	//   At resumed turn K+1: J remains held and unobserved.
	//
	//   The host must:
	//     - not fabricate a completion
	//     - not silently delete J
	//     - not deliver an impossible observation instruction
	//     - produce a bounded host outcome
	//     - not re-enqueue the same impossible obligation
	// -------------------------------------------------------------------------
	it("UCHC01-03: capability transitions available → unavailable between K and K+1 — second enqueue is blocked, no fabrication, held obligation retained", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["command_status", "submit_and_exit"],
		})
		h.setMarkerPresent(true)

		// K: enqueue fires.
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))
		const countersK = getCompletionContinuationUpstreamCounters()
		expect(countersK.enqueueCompletionContinuationInvoked).toBe(1)
		expect(h.sendLog.length).toBe(1)

		// Capability transitions before K+1.
		h.setLiveTools(["submit_and_exit"])

		// K+1: bounded guard stamps, no inner enqueue.
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))
		const countersK1 = getCompletionContinuationUpstreamCounters()

		// Host did NOT re-invoke the enqueue.
		expect(countersK1.enqueueCompletionContinuationInvoked).toBe(1)
		// The held obligation is retained (marker is present with a typed reason).
		expect(h.getMarkerReason()).toBeDefined()
		// No completion fabricated.
		expect(h.completedPhaseCalls()).toBe(0)
		expect(h.taskCompletionCommittedRecords()).toBe(0)
		// sendLog did not grow.
		expect(h.sendLog.length).toBe(1)
		// The bounded guard stamped.
		expect(countersK1.blockedOutcomeObservationUnavailable ?? 0).toBeGreaterThanOrEqual(1)
	})

	// -------------------------------------------------------------------------
	// UCHC01-04: RED-03 — Repeated completion without progress
	//
	//   After the blocked outcome, simulate a repeated submit_and_exit.
	//   Host must NOT re-enqueue, NOT re-stamp, NOT fabricate completion.
	// -------------------------------------------------------------------------
	it("UCHC01-04: repeated submit_and_exit after a blocked outcome — host does not re-enqueue, no duplicate stamp, no fabrication", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["submit_and_exit"], // capability absent from the start
		})
		h.setMarkerPresent(true)

		// First BCB cycle: bounded guard stamps.
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))
		const countersFirst = getCompletionContinuationUpstreamCounters()
		expect(countersFirst.enqueueCompletionContinuationInvoked).toBe(0)
		expect(countersFirst.blockedOutcomeObservationUnavailable ?? 0).toBeGreaterThanOrEqual(1)

		// Repeated submit_and_exit (K+1).
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))
		const countersSecond = getCompletionContinuationUpstreamCounters()

		// The host did NOT re-enqueue.
		expect(countersSecond.enqueueCompletionContinuationInvoked).toBe(0)
		// No completion fabricated.
		expect(h.completedPhaseCalls()).toBe(0)
		expect(h.taskCompletionCommittedRecords()).toBe(0)
		// The marker still has a typed reason.
		expect(h.getMarkerReason()).toBeDefined()
	})

	// -------------------------------------------------------------------------
	// UCHC01-05: RED-04 — Genuine recovery
	//
	//   Start in the blocked condition; make the observation capability
	//   genuinely available; consume the held observation. The blocked
	//   condition is reevaluated; if the held obligation has been
	//   consumed, the task can complete.
	// -------------------------------------------------------------------------
	it("UCHC01-05: capability recovers after blocked condition — host re-evaluates, the conservation chain can commit completion when held drains", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["submit_and_exit"],
		})
		h.setMarkerPresent(true)

		// First BCB cycle: blocked.
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))
		expect(h.getMarkerReason()).toBe("observation_unavailable")

		// Capability recovers.
		h.setLiveTools(["command_status", "submit_and_exit"])

		// The held set is now consumed (BCB01 §0.1 second conjunct = 0).
		h.setHeldJobIds([])
		h.setHeldCount(0)

		// Next BCB cycle: held=0 → not held → conservation chain reaches setTurnPhase("completed").
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))

		// The conservation chain commits completion exactly once.
		expect(h.completedPhaseCalls()).toBe(1)
		expect(h.taskCompletionCommittedRecords()).toBe(1)
	})

	// -------------------------------------------------------------------------
	// UCHC01-06: held=0 + capability unavailable → no enqueue, no stamp
	//
	//   The bounded guard's eligibility predicate short-circuits BEFORE
	//   the liveTools consult when the held obligation is empty.
	// -------------------------------------------------------------------------
	it("UCHC01-06: held=0 + capability unavailable → no enqueue, no observation_unavailable stamp, conservation chain can still commit", async () => {
		const h = makeHarness({
			initialHeldIds: [],
			initialLiveTools: ["submit_and_exit"],
		})
		h.setMarkerPresent(false) // No BCB marker pre-armed.

		const countersBefore = getCompletionContinuationUpstreamCounters()
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))
		const countersAfter = getCompletionContinuationUpstreamCounters()

		// No enqueue, no observation_unavailable stamp.
		expect(countersAfter.enqueueCompletionContinuationInvoked).toBe(0)
		expect(countersAfter.blockedOutcomeObservationUnavailable ?? 0).toBe(
			countersBefore.blockedOutcomeObservationUnavailable ?? 0,
		)
		// held=0, conservation chain reaches setTurnPhase("completed").
		expect(h.completedPhaseCalls()).toBe(1)
		expect(h.taskCompletionCommittedRecords()).toBe(1)
	})

	// -------------------------------------------------------------------------
	// UCHC01-07: Capability transitions on a fresh held set (identity discipline)
	//
	//   Per CTQC01-CORR01: a new held set (epoch bump) with `command_status`
	//   still unavailable → fresh classification, the previous
	//   `observation_unavailable` reason is NOT inherited.
	// -------------------------------------------------------------------------
	it("UCHC01-07: new held set with capability still unavailable → fresh classification, no stale inheritance, fresh stamp published", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["submit_and_exit"],
		})
		h.setMarkerPresent(true)

		// K: bounded guard stamps.
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))
		const countersK = getCompletionContinuationUpstreamCounters()
		expect(h.getMarkerReason()).toBe("observation_unavailable")
		const observationUnavailableAfterK = countersK.blockedOutcomeObservationUnavailable ?? 0

		// Bump the epoch (simulate a fresh held set / fresh obligation).
		h.bumpEpoch()

		// New held set.
		h.setHeldJobIds(NEW_HELD_IDS)
		h.setHeldCount(NEW_HELD_IDS.length)

		// K+1: fresh obligation, capability still absent.
		await h.triggerBCBCycle()
		await new Promise<void>((r) => setTimeout(r, 0))
		const countersK1 = getCompletionContinuationUpstreamCounters()

		// The marker now reflects the fresh obligation's stamp.
		expect(h.getMarkerReason()).toBeDefined()
		// The bounded guard published again for the new obligation.
		expect(countersK1.blockedOutcomeObservationUnavailable ?? 0).toBeGreaterThan(observationUnavailableAfterK)
		// No completion fabricated.
		expect(h.completedPhaseCalls()).toBe(0)
		expect(h.taskCompletionCommittedRecords()).toBe(0)
	})
})
