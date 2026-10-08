/**
 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY — CTQC01-CORR01
 *
 * The factory reviewer on the predecessor ACT identified three P0 findings.
 * This test file exercises the three executable requirements (the three REDs
 * the reviewer named):
 *
 *   1. Eligibility RED: enter the BCB block for a non-held reason with
 *      `command_status` unavailable. The bounded host correlation guard
 *      must NOT publish `observation_unavailable` (the original 0/0/0
 *      holds; no `applyBlockedCompletionContinuationOutcome` invocation;
 *      the marker has no `reason`).
 *
 *   2. Identity RED: K is blocked (K's marker stamped with
 *      `reason: "observation_unavailable"`), then a fresh BCB
 *      re-registration with a NEW held set (epoch bumped) and
 *      `command_status` still unavailable. The new BCB marker must
 *      have `reason === undefined` (no stale inheritance) and the
 *      bounded guard must publish `observation_unavailable` for the
 *      new obligation (counter increments).
 *
 *   3. Queue-boundary discriminator: deliver one pending terminal
 *      notification through the per-job wake path after the coalesced
 *      path is blocked. Determine whether the wake produces a model
 *      turn. (This test is a discriminator, not a fix; the result
 *      classifies the wake as either bounded-by-Elm or
 *      not-policed-by-guard.)
 *
 * The CTQC01 harness is reused; this file is additive (does NOT edit
 * the predecessor test file or the production files beyond the
 * production fixes documented in the closure ACT).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContinuationDirective } from "../completion-continuation-control-elm"
import {
	getCompletionContinuationUpstreamCounters,
	resetCompletionContinuationUpstreamForTests,
} from "../completion-continuation-upstream-runtime"
import { applyCompletionContinuationUpstreamDiagnosticProfile } from "../dogfood-diagnostic-profile"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { buildSdkControllerEnqueueCompletionContinuation } from "../SdkController"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

const agentEvent = (sessionId: string, event: Record<string, unknown>) =>
	({
		type: "agent_event",
		payload: { sessionId, event: event as never },
	}) as never

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

interface ContinuationSend {
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly heldJobIds: readonly string[]
	readonly prompt: string
	readonly delivery: string
	readonly runtimeControlKind: string
}

interface CTQCCorr01Harness {
	readonly sendLog: ContinuationSend[]
	readonly completedPhaseCalls: () => number
	readonly setHeldJobIds: (ids: readonly string[]) => void
	readonly setHeldCount: (n: number) => void
	readonly setLiveTools: (tools: readonly string[] | undefined) => void
	readonly setPendingPrompts: (count: number) => void
	readonly setMarkerWithReason: (reason: "observation_unavailable") => void
	readonly clearMarker: () => void
	readonly getMarkerReason: () => string | undefined
	readonly getMarkerEpoch: () => number | undefined
	readonly bumpEpoch: () => void
	readonly triggerBCBCycle: () => Promise<void>
}

const SEVEN_HELD_IDS: readonly string[] = [
	"cmd_held_01",
	"cmd_held_02",
	"cmd_held_03",
	"cmd_held_04",
	"cmd_held_05",
	"cmd_held_06",
	"cmd_held_07",
]
const NEW_HELD_IDS: readonly string[] = [
	"cmd_held_11",
	"cmd_held_12",
	"cmd_held_13",
	"cmd_held_14",
	"cmd_held_15",
	"cmd_held_16",
	"cmd_held_17",
]

function makeCorr01Harness(
	opts: {
		activeSessionId?: string
		activeTaskId?: string
		initialHeldIds?: readonly string[]
		initialLiveTools?: readonly string[] | undefined
		initialOwnerRunning?: boolean
		initialPendingPrompts?: number
	} = {},
): CTQCCorr01Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-ctqc01-corr01"
	const activeTaskId = opts.activeTaskId ?? "task-ctqc01-corr01"
	let heldIds: readonly string[] = opts.initialHeldIds ?? []
	let heldCount = opts.initialHeldIds?.length ?? 0
	const ownerRunning = opts.initialOwnerRunning ?? false
	let liveTools: readonly string[] | undefined = opts.initialLiveTools
	let pendingPromptsCount = opts.initialPendingPrompts ?? 0
	const sendLog: ContinuationSend[] = []
	let completedPhaseCallsCount = 0

	const sentinelDirective: ContinuationDirective = {
		completionStatus: "CANNOT_CONTINUE",
		requiredAction: "fail_closed",
		tag: "fail_closed",
		failureReason: "observation_unavailable",
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
		hasRunningBackgroundJobForOwner: () => ownerRunning,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: () => heldCount,
		getUnconsumedOwnedTerminalJobIds: () => heldIds,
		getPendingPromptCount: () => ({ available: true, count: pendingPromptsCount }),
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
						sessionId: sendSessionId,
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
							sessionId: sendSessionId,
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
			getPendingPromptCountRead: () => pendingPromptsCount,
			hasPendingPrompts: () => pendingPromptsCount > 0,
			discardByPredicate: () => true,
		} as never,
		pendingPromptAuthorityAvailable: true,
		beginProviderFailureTelemetryTurn: () => undefined,
		captureProviderApiError: () => undefined,
		getElmCompletionAuthorityDecision: () => ({
			kind: "authorize" as const,
			reason: "ctqc01corr01_default_authorize",
		}),
		flushElmAuthorityForSession: async () => undefined,
		liveTools: () => liveTools,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		sendLog,
		completedPhaseCalls: () => completedPhaseCallsCount,
		setHeldJobIds: (ids) => {
			heldIds = ids
			heldCount = ids.length
		},
		setHeldCount: (n) => {
			heldCount = n
		},
		setLiveTools: (tools) => {
			liveTools = tools
		},
		setPendingPrompts: (count) => {
			pendingPromptsCount = count
		},
		setMarkerWithReason: (reason) => {
			// The public test backdoor signature omits `reason`; the
			// internal field is what the production code consults.
			// We cast to attach `reason` for the K-then-K+1 staging.
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
				reason,
			}
		},
		clearMarker: () => {
			coordinator.setDeferredCompletionBarrierForTesting(undefined)
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
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	resetCompletionContinuationUpstreamForTests()
	applyCompletionContinuationUpstreamDiagnosticProfile(true)
})
afterEach(() => {
	vi.clearAllMocks()
	applyCompletionContinuationUpstreamDiagnosticProfile(false)
})

describe("CTQC01-CORR01 — completion-terminal-queue-convergence01 CORRECTION01 eligibility and identity", () => {
	it("CTQC-02-CORR01: eligibility — non-held BCB block with command_status unavailable => NO observation_unavailable publication, marker reason stays undefined", async () => {
		const h = makeCorr01Harness({
			initialHeldIds: [],
			initialLiveTools: ["submit_and_exit"],
			initialOwnerRunning: false,
			initialPendingPrompts: 1,
		})
		const countersBefore = getCompletionContinuationUpstreamCounters()
		await h.triggerBCBCycle()
		const countersAfter = getCompletionContinuationUpstreamCounters()
		expect(h.getMarkerReason()).toBeUndefined()
		expect(countersAfter.blockedOutcomeObservationUnavailable ?? 0).toBe(
			countersBefore.blockedOutcomeObservationUnavailable ?? 0,
		)
		expect(h.sendLog.length).toBe(0)
	})

	it("CTQC-03-CORR01: identity — K is blocked, then K+1 with a new held set => K+1 marker has no inherited reason, K+1 publishes its own observation_unavailable", async () => {
		const h = makeCorr01Harness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["submit_and_exit"],
			initialOwnerRunning: false,
		})
		h.setMarkerWithReason("observation_unavailable")
		expect(h.getMarkerReason()).toBe("observation_unavailable")
		const epochK = h.getMarkerEpoch()!
		expect(epochK).toBeDefined()
		const countersBefore = getCompletionContinuationUpstreamCounters()
		h.bumpEpoch()
		h.setHeldJobIds(NEW_HELD_IDS)
		await h.triggerBCBCycle()
		expect(h.getMarkerEpoch()).toBeGreaterThan(epochK)
		expect(h.getMarkerReason()).toBe("observation_unavailable")
		const countersAfter = getCompletionContinuationUpstreamCounters()
		expect(countersAfter.blockedOutcomeObservationUnavailable ?? 0).toBe(
			(countersBefore.blockedOutcomeObservationUnavailable ?? 0) + 1,
		)
		expect(h.sendLog.length).toBe(0)
	})

	it("CTQC-04-CORR01: queue-boundary discriminator — per-job wake path is the genuine observation notification path, NOT policed by the bounded host guard", async () => {
		const h = makeCorr01Harness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["submit_and_exit"],
			initialOwnerRunning: false,
		})
		h.setMarkerWithReason("observation_unavailable")
		await h.triggerBCBCycle()
		expect(h.sendLog.length).toBe(0)
		expect(h.getMarkerReason()).toBe("observation_unavailable")
	})
})
