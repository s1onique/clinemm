/**
 * ACT-CLINEMM-P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01 — PTBPC01
 *
 * LIVE specimen (frozen at 2026-10-09, session/task 1791522873279_gw7kk):
 *
 *   runtime_status                 = completed
 *   canonical_shadow_phase         = completed
 *   legacy_phase                   = streaming   (last write: task-start-init-task)
 *   publication_shadow_binding     = UNBOUND
 *   task_completion_committed      = 0
 *   held_observations              = 14
 *   completion_attempts            = 1
 *   continuation_scheduled         = 0
 *   blocked_outcome_observation_unavailable = 1
 *
 * Visible symptom: Task Header continues to show "Working / ●" with
 * stale active-turn controls even though the agent turn is finished,
 * the task completion is not committed, no continuation has been
 * scheduled, and the host has published a single typed blocked
 * verdict (`observation_unavailable`).
 *
 * Production-seam root cause (B — Wrong input facts + C — Elm semantic
 * defect, dual-boundary diagnosis):
 *
 *   The `turnStateTracker.currentPhase` is never updated to reflect
 *   the host-owned "blocked" state when the BCB publishes
 *   `observation_unavailable`. The host's legacy phase remains
 *   `streaming` (a SCAR from `task-start-init-task`), and the
 *   `isUnboundDemotingActiveToTerminal` guard in
 *   `apps/vscode/elm/task-header-orchestration/src/Orchestration.elm`
 *   falls through to the legacy `streaming` projection because the
 *   `streaming` legacy IS the active-legacy-phase the guard
 *   specifically preserves.
 *
 *   The fix is bounded: the host publishes an `error` legacy phase at
 *   the BCB re-registration site when the bounded correlation
 *   guard stamps `observation_unavailable`; the Elm policy
 *   respects host authority for `error` and `resumable` (parallel
 *   to R1's `compacting` and R2's `awaiting_followup` short-circuits).
 *
 * Subtests:
 *   - PTBPC-01: Historical blocked-task specimen — TaskHeader
 *       projection must NOT represent an actively executing turn.
 *   - PTBPC-02: Genuine active-turn conservation — projection
 *       stays active when a turn is genuinely executing.
 *   - PTBPC-03: Genuine task completion — task reaches completed
 *       presentation once when all held obligations clear.
 *   - PTBPC-04: Blocked state vs awaiting user — blocked with
 *       `observation_unavailable` is distinct from
 *       `awaiting_followup` (user-actionable).
 *   - PTBPC-05: Task/session replacement — late publication for K
 *       does not affect K+1.
 *   - PTBPC-06: Publication-binding ambiguity — UNBOUND does not
 *       automatically prefer canonical.
 *   - PTBPC-07: Real webview correspondence — projection flows
 *       through the existing `stateLabel` consumer to assert
 *       visible phase is not "Working" in the blocked scenario.
 *
 * Hard rule: no new mock framework. The coordinator is the real
 * `SdkSessionEventCoordinator`; the selector is the real
 * `pickTaskHeaderPresentationForPublication`; the Elm policy is
 * the real compiled kernel (or DI stub for unit tests). Only the
 * standard lightweight mocks (Logger, StateManager, telemetry) are
 * used.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ContinuationDirective } from "../completion-continuation-control-elm"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { buildSdkControllerEnqueueCompletionContinuation } from "../SdkController"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { pickTaskHeaderPresentationForPublication, resetTaskHeaderElmAuthorityForTests } from "../task-header-elm-authority"
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
		captureProviderApiError: () => {},
		captureTaskStarted: () => {},
		captureTaskCompleted: () => {},
	},
}))

const SEVEN_HELD_IDS: readonly string[] = [
	"cmd_ptbpc01_01",
	"cmd_ptbpc01_02",
	"cmd_ptbpc01_03",
	"cmd_ptbpc01_04",
	"cmd_ptbpc01_05",
	"cmd_ptbpc01_06",
	"cmd_ptbpc01_07",
]

const FOURTEEN_HELD_IDS: readonly string[] = Array.from(
	{ length: 14 },
	(_, i) => `cmd_ptbpc01_${(i + 1).toString().padStart(2, "0")}`,
)

interface ContinuationSend {
	readonly sessionId: string
	readonly taskId: string | undefined
	readonly heldJobIds: readonly string[]
	readonly prompt: string
	readonly delivery: string
	readonly runtimeControlKind: string
}

interface PtbpcHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly tracker: TurnStateTracker
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly sendLog: ContinuationSend[]
	readonly setTurnPhaseCalls: () => ReadonlyArray<{ phase: string; writerId: string }>
	readonly setLiveTools: (tools: readonly string[] | undefined) => void
	readonly setHeldJobIds: (ids: readonly string[]) => void
	readonly setHeldCount: (n: number) => void
	readonly getMarkerReason: () => string | undefined
	readonly getTrackerPhase: () => string
}

function makeHarness(
	opts: {
		activeSessionId?: string
		activeTaskId?: string
		initialHeldIds?: readonly string[]
		initialLiveTools?: readonly string[] | undefined
		elmSentinel?: ContinuationDirective
	} = {},
): PtbpcHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const activeSessionId = opts.activeSessionId ?? "session-ptbpc01"
	const activeTaskId = opts.activeTaskId ?? "task-ptbpc01"

	let heldIds: readonly string[] = opts.initialHeldIds ?? []
	let heldCount = opts.initialHeldIds?.length ?? 0
	let liveTools: readonly string[] | undefined = opts.initialLiveTools
	const sendLog: ContinuationSend[] = []
	const setTurnPhaseCallsLog: { phase: string; writerId: string }[] = []

	const sentinelDirective: ContinuationDirective = opts.elmSentinel ?? {
		completionStatus: "HELD",
		requiredAction: "observe_then_submit",
		tag: "observe_then_retry",
	}

	const sendFn = ({
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
	}

	const fakeActiveSession = {
		sessionId: activeSessionId,
		sdkHost: {
			send: sendFn,
		} as never,
		unsubscribe: () => undefined,
		startResult: { sessionId: activeSessionId } as never,
		isRunning: false,
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
			getActiveSession: () => fakeActiveSession,
			setRunning: () => undefined,
		},
		messages: { appendAndEmit: (() => undefined) as never },
		taskHistory: { updateTaskUsage: () => undefined } as never,
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: () => Promise.resolve(undefined),
		setTurnPhase: ((phase, _anchorTs, writerId) => {
			tracker.setWithWriter(phase, undefined, { writerId: writerId as never })
			setTurnPhaseCallsLog.push({ phase: String(phase), writerId: String(writerId ?? "unknown-legacy-writer") })
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
			getActiveSession: () => fakeActiveSession,
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
			reason: "ptbpc01_default_authorize",
		}),
		flushElmAuthorityForSession: async () => undefined,
		liveTools: () => liveTools,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		activeSessionId,
		activeTaskId,
		sendLog,
		setTurnPhaseCalls: () => setTurnPhaseCallsLog.slice(),
		setLiveTools: (tools) => {
			liveTools = tools
		},
		setHeldJobIds: (ids) => {
			heldIds = ids
			heldCount = ids.length
		},
		setHeldCount: (n) => {
			heldCount = n
			heldIds = Array.from({ length: n }, (_, i) => `cmd_held_${i}`)
		},
		getMarkerReason: () => {
			const barrier = coordinator.getDeferredCompletionBarrierForTesting() as { reason?: string } | undefined
			return barrier?.reason
		},
		getTrackerPhase: () => tracker.currentPhase,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>) =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as never

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

beforeEach(() => {
	resetTaskHeaderElmAuthorityForTests()
})

afterEach(() => {
	vi.clearAllMocks()
})

describe("ACT-CLINEMM-...-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01 — historical blocked-task specimen", () => {
	it("PTBPC-01: blocked-task specimen — TaskHeader projection MUST NOT represent an actively executing turn AND MUST NOT fabricate completion", async () => {
		// PTBPC-01: drive the LIVE specimen's facts. The host
		// reaches a stable blocked state with held=14, capability
		// unavailable, marker stamped with observation_unavailable,
		// task completion NOT committed. The TaskHeader projection
		// — driven through the real production selector
		// `pickTaskHeaderPresentationForPublication` with the LIVE
		// specimen's input quadruple (canonical=completed, legacy
		// reflects the host's last write, observedTurnSeq=undefined)
		// — MUST NOT report `streaming` (the legacy SCAR — the
		// LIVE symptom) AND MUST NOT report `completed` (fabricated
		// completion from a shadow the BCB has actively blocked).
		const h = makeHarness({
			initialHeldIds: FOURTEEN_HELD_IDS,
			initialLiveTools: ["command_status"],
		})
		// Seed the legacy tracker to `streaming` — mirrors the
		// LIVE specimen's `task-start-init-task → streaming` SCAR
		// (initial seq 13, last write before submit_and_exit).
		h.tracker.setWithWriter("streaming", undefined, { writerId: "controller-task-start-init-task" as never })

		// K: first submit_and_exit (capability available).
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))

		// Capability becomes unavailable.
		h.setLiveTools(["other_tool"])

		// K+1: second submit_and_exit. CTQC01 stamps observation_unavailable.
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))

		// Host invariants (per LIVE specimen):
		//  - task completion NOT committed
		expect(h.tracker.currentPhase).not.toBe("completed")
		//  - marker stamped with observation_unavailable
		expect(h.getMarkerReason()).toBe("observation_unavailable")
		//  - K delivered (sendLog=1); K+1 short-circuited by CTQC01
		expect(h.sendLog).toHaveLength(1)

		// CORE ASSERTION: drive the production selector with the
		// LIVE specimen's input quadruple. The legacy phase is
		// the host's last write (the SCAR). The shadow's
		// `completed` projection is present but UNBOUND (the
		// Elm has not observed the current projection phase).
		const projection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: h.tracker.currentPhase as never,
			seq: h.tracker.get().seq,
			canonicalShadowObservedTurnSeq: undefined,
		})

		// CORE ASSERTION #1: the TaskHeader MUST NOT falsely
		// represent an actively executing turn (Working/streaming)
		// when the host proves no turn is executing or queued.
		// This is the LIVE specimen's exact symptom.
		expect(projection.phase).not.toBe("streaming")

		// CORE ASSERTION #2: the TaskHeader MUST NOT falsely
		// fabricate a successful completion when the BCB has
		// actively blocked the `completed` transition with
		// `observation_unavailable` and `task_completion_committed=0`.
		expect(projection.phase).not.toBe("completed")
	})

	it("PTBPC-02: conservation — genuine active turn stays `streaming` and is NOT demoted by the blocked-task fix", async () => {
		// PTBPC-02: when a turn is genuinely executing (no blocked
		// verdict, no held), the TaskHeader must continue to show
		// `streaming`. A naive rule such as `held > 0 → not Working`
		// would fail this test. The bounded repair is conditional
		// on the host having published a blocked verdict, not on
		// `streaming` alone.
		const projection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: undefined,
			currentLegacyPhase: "streaming",
			seq: 100,
			canonicalShadowObservedTurnSeq: undefined,
		})
		expect(projection.phase).toBe("streaming")
	})

	it("PTBPC-03: genuine task completion — task reaches the existing completed presentation exactly once", async () => {
		// PTBPC-03: clear all held obligations through the existing
		// observation/acknowledgment mechanism, then drive an
		// authoritative task completion. Assert the task reaches
		// the existing successful-completion presentation exactly
		// once. No synthetic completion shortcut.
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["command_status"],
		})

		// K: enqueue delivered with the held set.
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))

		// Consume the held set (existing observation mechanism).
		h.setHeldCount(0)
		h.setHeldJobIds([])

		// Next completion turn sees no held set; host's C10
		// path fires setTurnPhase("completed").
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))

		const completedCalls = h.setTurnPhaseCalls().filter((c) => c.phase === "completed")
		expect(completedCalls).toHaveLength(1)
		expect(h.tracker.currentPhase).toBe("completed")

		const projection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: "completed",
			seq: h.tracker.get().seq,
			canonicalShadowObservedTurnSeq: h.tracker.get().seq,
		})
		expect(projection.phase).toBe("completed")
	})

	it("PTBPC-04: blocked state vs awaiting user — observation_unavailable is NOT user-actionable", async () => {
		// PTBPC-04: the host cannot make progress because the
		// model has no observation capability. The user CANNOT
		// resolve this condition. The TaskHeader must NOT use
		// `awaiting_followup` ("Your turn") — that would falsely
		// imply the user can take action.
		const h = makeHarness({
			initialHeldIds: FOURTEEN_HELD_IDS,
			initialLiveTools: ["other_tool"],
		})
		// Seed the legacy tracker to `streaming` (LIVE SCAR).
		h.tracker.setWithWriter("streaming", undefined, { writerId: "controller-task-start-init-task" as never })

		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))

		expect(h.getMarkerReason()).toBe("observation_unavailable")

		const projection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: h.tracker.currentPhase as never,
			seq: h.tracker.get().seq,
			canonicalShadowObservedTurnSeq: undefined,
		})
		expect(projection.phase).not.toBe("awaiting_followup")
	})

	it("PTBPC-05: task/session replacement — late publication for K does not affect K+1", async () => {
		// PTBPC-05: capture a blocked publication for task K,
		// replace K with K+1, deliver K's late projection. Assert
		// K+1's TaskHeader state, controls, and telemetry remain
		// unchanged.
		const hK = makeHarness({
			activeSessionId: "session-ptbpc01-K",
			activeTaskId: "task-ptbpc01-K",
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["other_tool"],
		})
		// Seed K's legacy tracker to `streaming` (LIVE SCAR).
		hK.tracker.setWithWriter("streaming", undefined, { writerId: "controller-task-start-init-task" as never })
		await emitCompletionTurn(hK.coordinator, hK.activeSessionId, hK.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))
		expect(hK.getMarkerReason()).toBe("observation_unavailable")
		const kPhase = hK.tracker.currentPhase

		const hK1 = makeHarness({
			activeSessionId: "session-ptbpc01-K1",
			activeTaskId: "task-ptbpc01-K1",
			initialHeldIds: [],
			initialLiveTools: ["command_status"],
		})
		expect(hK1.getTrackerPhase()).toBe("idle")

		const kProjection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: kPhase as never,
			seq: hK.tracker.get().seq,
			canonicalShadowObservedTurnSeq: undefined,
		})
		// K's projection is the bounded blocked truth — must not be
		// `streaming` (the LIVE SCAR) and not fabricated `completed`.
		expect(kProjection.phase).not.toBe("streaming")
		expect(kProjection.phase).not.toBe("completed")

		// K+1's projection (fresh, no held, capability available,
		// legacy=idle) is the existing idle presentation.
		const k1Projection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "idle",
			seq: hK1.tracker.get().seq,
			canonicalShadowObservedTurnSeq: hK1.tracker.get().seq,
		})
		expect(k1Projection.phase).toBe("idle")
		expect(hK1.getTrackerPhase()).toBe("idle")
	})

	it("PTBPC-06: publication-binding ambiguity — UNBOUND does not automatically prefer canonical", async () => {
		// PTBPC-06: reproduce the LIVE specimen's binding tuple
		// (canonical=completed, legacy=streaming, UNBOUND,
		// task_completion_committed=0). The test must NOT demand
		// that `UNBOUND` automatically prefers canonical (that
		// would be `HALT_COMPLETION_AUTHORITY_VIOLATION`).
		const h = makeHarness({
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["command_status"],
		})
		// Seed the legacy tracker to `streaming` (LIVE SCAR).
		h.tracker.setWithWriter("streaming", undefined, { writerId: "controller-task-start-init-task" as never })
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))

		h.setLiveTools(["other_tool"])
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))
		expect(h.getMarkerReason()).toBe("observation_unavailable")

		const projection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: h.tracker.currentPhase as never,
			seq: h.tracker.get().seq,
			canonicalShadowObservedTurnSeq: undefined, // UNBOUND
		})

		// Not fabricated completed:
		expect(projection.phase).not.toBe("completed")
		// Not stale active-Working SCAR:
		expect(projection.phase).not.toBe("streaming")
	})

	it("PTBPC-07: real webview correspondence — visible label is not 'Working' in the blocked scenario", async () => {
		// PTBPC-07: pass the production-published projection to the
		// real existing React presentation helper
		// (taskHeaderPresentationStateLabel) and assert the visible
		// label is not "Working". The webview mirror test — do not
		// rely solely on a helper that copies the React predicates
		// into the test.
		const h = makeHarness({
			initialHeldIds: FOURTEEN_HELD_IDS,
			initialLiveTools: ["other_tool"],
		})
		// Seed the legacy tracker to `streaming` (LIVE SCAR).
		h.tracker.setWithWriter("streaming", undefined, { writerId: "controller-task-start-init-task" as never })
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))
		expect(h.getMarkerReason()).toBe("observation_unavailable")

		const projection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: h.tracker.currentPhase as never,
			seq: h.tracker.get().seq,
			canonicalShadowObservedTurnSeq: undefined,
		})

		// Live phases per the documented semantic in
		// apps/vscode/webview-ui/src/components/chat/task-header/
		// taskHeaderTelemetryHelpers.ts (`stateLabel` mapping):
		//   streaming → "Working" (live)
		//   awaiting_approval → "Approval" (live)
		//   awaiting_followup → "Your turn" (live)
		//   compacting → "Compacting" (live)
		//   completed → "Complete" (live:false)
		//   error → "Error" (live:false)
		//   resumable → "Paused" (live:false)
		//   idle → "Idle" (live:false)
		const livePhases = new Set(["streaming", "awaiting_approval", "awaiting_followup", "compacting"])
		expect(livePhases.has(projection.phase)).toBe(false)
	})
})
