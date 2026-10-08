/**
 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01 — CTQC01
 *
 * LIVE specimen (per ACT C0/C3, with `UNAVAILABLE_FROM_TRACE` where the
 * capture did not survive):
 *
 *   submit_and_exit_seen = 11
 *   task_completion_committed = 0
 *   continuation_started = 8
 *   stalledNoProgress = 21
 *   blockedOutcomeStalledNoProgress = 11
 *   held terminal observations = 1
 *   observation mechanism = unavailable
 *   model still prompted to complete
 *
 * Causal discriminator (C7): Variant A. The Continuation Control Elm
 * kernel is the semantic authority and correctly returns
 * `FailClosed StalledNoProgress` (P2) on subsequent attempts. The bounded
 * C11 host-only repair prevents the COALESCED continuation from being
 * re-handed to the model when the model has no observation capability.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContinuationDirective } from "../completion-continuation-control-elm"
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

interface CTQCHarness {
	readonly sendLog: ContinuationSend[]
	readonly completedPhaseCalls: () => number
	readonly setHeldJobIds: (ids: readonly string[]) => void
	readonly setHeldCount: (n: number) => void
	readonly setLiveTools: (tools: readonly string[] | undefined) => void
	readonly setMarkerPresent: (present: boolean) => void
	readonly getMarkerReason: () => string | undefined
	readonly getHeldJobIds: () => readonly string[]
	readonly clearDeliveryDedupe: () => void
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

function makeHarness(
	opts: {
		activeSessionId?: string
		activeTaskId?: string
		initialHeldIds?: readonly string[]
		initialLiveTools?: readonly string[] | undefined
		initialOwnerRunning?: boolean
		elmSentinel?: ContinuationDirective
	} = {},
): CTQCHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-ctqc01"
	const activeTaskId = opts.activeTaskId ?? "task-ctqc01"
	let heldIds: readonly string[] = opts.initialHeldIds ?? []
	let heldCount = opts.initialHeldIds?.length ?? 0
	const ownerRunning = opts.initialOwnerRunning ?? false
	let liveTools: readonly string[] | undefined = opts.initialLiveTools
	const sendLog: ContinuationSend[] = []
	let completedPhaseCallsCount = 0

	const sentinelDirective: ContinuationDirective = opts.elmSentinel ?? {
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
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		} as never,
		pendingPromptAuthorityAvailable: true,
		beginProviderFailureTelemetryTurn: () => undefined,
		captureProviderApiError: () => undefined,
		getElmCompletionAuthorityDecision: () => ({
			kind: "authorize" as const,
			reason: "ctqc01_default_authorize",
		}),
		flushElmAuthorityForSession: async () => undefined,
		// ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01:
		// CTQC01 bounded host correlation accessor. The test
		// harness wires the same `liveTools` projection that
		// production SdkController exposes (SdkController.ts:2517)
		// so the bounded correlation guard at the BCB
		// re-registration site can consult the live tool
		// registry. The harness setter `setLiveTools(...)`
		// mutates the closure-captured `liveTools` so each
		// test can stage a different capability state.
		liveTools: () => liveTools,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		sendLog,
		completedPhaseCalls: () => completedPhaseCallsCount,
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
		getMarkerReason: () => coordinator.getDeferredCompletionBarrierForTesting()?.reason,
		getHeldJobIds: () => heldIds,
		clearDeliveryDedupe: () => {
			coordinator.clearCompletionContinuationSentForTesting()
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
})
afterEach(() => {
	vi.clearAllMocks()
})

describe("CTQC01 — completion-terminal-queue-convergence01", () => {
	it("CTQC-01: held set + no observation tool + 11 BCB cycles => coalesced continuation re-handed zero times (LIVE re-handed 8 times)", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["submit_and_exit"],
			initialOwnerRunning: false,
		})
		h.setMarkerPresent(true)
		// Pre-fix this re-hands the model the continuation prompt
		// 8 times (LIVE: continuation_started=8 over 11 BCB cycles).
		// Post-fix the bounded correlation guard publishes a
		// SINGLE typed blocked outcome on the first cycle (the
		// model has no observation capability, so the kernel
		// returns P5 `fail_closed(observation_unavailable)`,
		// the marker is stamped with that reason, and the next
		// 10 cycles see the marker reason and suppress the
		// enqueue). The kernel's fail-closed on P5 is
		// already the production behavior at the
		// `enqueueCompletionContinuationIfHeld` site (L1581-1584);
		// the CTQC01 bounded correlation guard adds the
		// one-delivery-then-suppress semantic at the BCB
		// re-registration site.
		for (let i = 0; i < 11; i++) {
			h.clearDeliveryDedupe()
			await h.triggerBCBCycle()
		}
		// Bounded invariant: the host MUST NOT keep re-handing the
		// model a coalesced continuation prompt it cannot act on.
		// Pre-fix the LIVE shows 8 deliveries; post-fix zero.
		expect(h.sendLog.length).toBe(0)
		// The marker carries the typed reason.
		expect(h.getMarkerReason()).toBe("observation_unavailable")
	})

	it("CTQC-02: host publishes typed blocked outcome (reason: 'observation_unavailable') on the first non-progress cycle", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["submit_and_exit"],
			initialOwnerRunning: false,
		})
		h.setMarkerPresent(true)
		await h.triggerBCBCycle()
		h.clearDeliveryDedupe()
		await h.triggerBCBCycle()
		// The marker carries the typed reason.
		expect(h.getMarkerReason()).toBe("observation_unavailable")
	})

	it("CTQC-03: held set + no observation tool + repeated cycles => task_completion_committed remains 0", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["submit_and_exit"],
			initialOwnerRunning: false,
		})
		h.setMarkerPresent(true)
		for (let i = 0; i < 5; i++) {
			h.clearDeliveryDedupe()
			await h.triggerBCBCycle()
		}
		expect(h.completedPhaseCalls()).toBe(0)
	})

	it("CTQC-04: held set remains held across BCB re-registrations (LIVE shows held terminal observations = 1 preserved)", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["submit_and_exit"],
			initialOwnerRunning: false,
		})
		h.setMarkerPresent(true)
		for (let i = 0; i < 5; i++) {
			h.clearDeliveryDedupe()
			await h.triggerBCBCycle()
		}
		// The held set is unchanged across cycles — the host has
		// not silently cleared the held obligation. The test
		// harness exposes `getHeldJobIds()` (read-only) for this
		// assertion. The sendLog is empty (no coalesced
		// continuation re-handed) because the bounded correlation
		// guard short-circuits on the first cycle.
		expect(h.getHeldJobIds()).toEqual(SEVEN_HELD_IDS)
		// The marker carries the typed reason.
		expect(h.getMarkerReason()).toBe("observation_unavailable")
	})

	it("CTQC-05: held set + observation becomes available => coalesced continuation is allowed (LIVE has no recovery path)", async () => {
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["submit_and_exit"],
			initialOwnerRunning: false,
		})
		h.setMarkerPresent(true)
		await h.triggerBCBCycle()
		const afterFirstNoObs = h.sendLog.length
		// Add observation capability. The next cycle should re-evaluate
		// the coalesced continuation.
		h.setLiveTools(["command_status", "submit_and_exit"])
		h.clearDeliveryDedupe()
		await h.triggerBCBCycle()
		// Post-fix: a new continuation is delivered when observation
		// becomes available. The bounded correlation guard only fires
		// when observation is unavailable; it does NOT permanently
		// freeze the queue.
		expect(h.sendLog.length).toBeGreaterThan(afterFirstNoObs)
	})
})
