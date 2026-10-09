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
 *       does not affect K+1. P1 amendment: deliver K's late event
 *       through the actual `handleSessionEvent` channel and
 *       assert the production session-replacement filter at
 *       `sdk-session-event-coordinator.ts:2164-2167` drops it.
 *   - PTBPC-06: Publication-binding ambiguity — UNBOUND does not
 *       automatically prefer canonical.
 *   - PTBPC-07: Real webview correspondence — projection flows
 *       through the REAL `stateLabel` consumer imported from
 *       `taskHeaderTelemetryHelpers.ts`. P1 amendment: replaces
 *       the local `livePhases` set with the real helper.
 *   - PTBPC-08: Recovery on the SAME task — the host's `error`
 *       write is overwritten by a fresh `completed` write when
 *       the BCB clears and a fresh completion turn succeeds. P1
 *       amendment: the pre-amendment suite only checked the
 *       forward path; this proves the R2.5 rule does not stick
 *       when the underlying state genuinely resolves.
 *
 * Hard rule: no new mock framework. The coordinator is the real
 * `SdkSessionEventCoordinator`; the selector is the real
 * `pickTaskHeaderPresentationForPublication`; the Elm policy is
 * the real compiled kernel (or DI stub for unit tests). Only the
 * standard lightweight mocks (Logger, StateManager, telemetry) are
 * used.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { stateLabel } from "../../../webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers"
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
	/**
	 * ACT-CLINEMM-P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01 (P1 amendment):
	 * swap the active session/task and replace the publication owner
	 * (`TurnStateTracker`) with a fresh one. Mirrors production
	 * where each task owns its own tracker; the harness's coordinator
	 * and `setTurnPhase` callback rebind to the new tracker.
	 */
	readonly swapActiveSessionTask: (newSessionId: string, newTaskId: string, newTracker: TurnStateTracker) => void
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
	const initialTracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	let activeSessionId: string = opts.activeSessionId ?? "session-ptbpc01"
	let activeTaskId: string = opts.activeTaskId ?? "task-ptbpc01"
	// Mutable current tracker: rebinds on `swapActiveSessionTask`.
	let currentTracker: TurnStateTracker = initialTracker

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

	let fakeActiveSession: {
		sessionId: string
		sdkHost: { send: typeof sendFn }
		unsubscribe: () => void
		startResult: { sessionId: string }
		isRunning: boolean
	} = {
		sessionId: activeSessionId,
		sdkHost: { send: sendFn } as never,
		unsubscribe: () => undefined,
		startResult: { sessionId: activeSessionId },
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
			// Writes to the *current* tracker, not a closed-over
			// snapshot — so a `swapActiveSessionTask` rebinds the
			// publication owner to the new task's tracker.
			currentTracker.setWithWriter(phase, undefined, { writerId: writerId as never })
			setTurnPhaseCallsLog.push({ phase: String(phase), writerId: String(writerId ?? "unknown-legacy-writer") })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => currentTracker.currentPhase,
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
			getActiveSession: () => fakeActiveSession as never,
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
		tracker: initialTracker,
		get activeSessionId() {
			return activeSessionId
		},
		get activeTaskId() {
			return activeTaskId
		},
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
		getTrackerPhase: () => currentTracker.currentPhase,
		swapActiveSessionTask: (newSessionId: string, newTaskId: string, newTracker: TurnStateTracker) => {
			activeSessionId = newSessionId
			activeTaskId = newTaskId
			currentTracker = newTracker
			fakeActiveSession = {
				sessionId: newSessionId,
				sdkHost: { send: sendFn } as never,
				unsubscribe: () => undefined,
				startResult: { sessionId: newSessionId },
				isRunning: false,
			}
		},
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
		// PTBPC-05: drive K to a blocked verdict on a single harness
		// (shared coordinator / `postStateToWebview` owner), then
		// SWAP the active session/task + tracker to K+1 (the
		// production shape: K+1 owns a fresh publication tracker,
		// the coordinator rebinds to it). Deliver a LATE K event
		// (a `done` for K's sessionId) through the actual
		// `handleSessionEvent` channel after the swap. Assert the
		// production session-replacement filter at
		// `sdk-session-event-coordinator.ts:2164-2167` drops the
		// stale event, K+1's tracker remains `idle`, and the
		// `setTurnPhaseCalls` log does NOT record a K+1-side
		// `error` write.
		//
		// The pre-P1-amendment version of this test built two
		// INDEPENDENT harnesses and never delivered K's late
		// publication through K+1's owner. That was an
		// evidence-contract defect: the test did not exercise the
		// actual webview publication owner's isolation across
		// task/session replacement.
		const h = makeHarness({
			activeSessionId: "session-ptbpc01-K",
			activeTaskId: "task-ptbpc01-K",
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["other_tool"],
		})
		// Seed K's legacy tracker to `streaming` (LIVE SCAR).
		h.tracker.setWithWriter("streaming", undefined, { writerId: "controller-task-start-init-task" as never })
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))
		expect(h.getMarkerReason()).toBe("observation_unavailable")
		expect(h.getTrackerPhase()).toBe("error")

		// Snapshot K's tracker and the K-side setTurnPhase log.
		const kPhase = h.tracker.currentPhase
		const kCalls = h.setTurnPhaseCalls().slice()
		expect(kCalls).toEqual(
			expect.arrayContaining([
				{
					phase: "error",
					writerId: "session-event-bcb-blocked-observation-unavailable",
				},
			]),
		)
		const orphanedKTracker = h.tracker

		// SWAP to K+1. The harness's coordinator + setTurnPhase
		// callback rebind to the new tracker. This is the actual
		// webview publication owner shape after task replacement:
		// the same coordinator/UI host now points at K+1's fresh
		// `TurnStateTracker`.
		const k1Tracker = new TurnStateTracker(new MessageIdMinter())
		h.swapActiveSessionTask("session-ptbpc01-K1", "task-ptbpc01-K1", k1Tracker)
		expect(h.getTrackerPhase()).toBe("idle")
		expect(h.activeSessionId).toBe("session-ptbpc01-K1")
		expect(h.activeTaskId).toBe("task-ptbpc01-K1")

		// Deliver K's LATE event through the actual webview
		// publication owner — the coordinator's `handleSessionEvent`
		// channel. In production this is the postStateToWebview
		// boundary; the coordinator's session-replacement filter
		// at sdk-session-event-coordinator.ts:2164-2167 must
		// drop the stale K event because the active session is
		// now K+1.
		await h.coordinator.handleSessionEvent(
			agentEvent("session-ptbpc01-K", {
				type: "done",
				reason: "completed",
				text: "Late K completion event.",
				iterations: 1,
			}),
		)
		await new Promise<void>((r) => setTimeout(r, 50))

		// K+1's tracker (the ACTIVE publication owner) is still
		// `idle`. The production session-replacement filter dropped
		// the stale K event; no `setTurnPhase` write was emitted
		// for K+1's tracker. The K `error` SCAR is confined to
		// the orphaned K tracker.
		expect(h.getTrackerPhase()).toBe("idle")
		expect(k1Tracker.currentPhase).toBe("idle")
		expect(orphanedKTracker.currentPhase).toBe("error")
		expect(orphanedKTracker).not.toBe(k1Tracker)

		// The `setTurnPhaseCalls` log did NOT grow after the swap
		// (K+1 received zero writes from the late K event).
		expect(h.setTurnPhaseCalls().length).toBe(kCalls.length)

		// K+1's projection (fresh, no held, capability available,
		// legacy=idle) is the existing idle presentation.
		const k1Projection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "idle",
			seq: k1Tracker.get().seq,
			canonicalShadowObservedTurnSeq: k1Tracker.get().seq,
		})
		expect(k1Projection.phase).toBe("idle")

		// K's projection is the bounded blocked truth — must not be
		// `streaming` (the LIVE SCAR) and not fabricated `completed`.
		// We assert this from K's own (orphaned) tracker, since K
		// is no longer the active task.
		const kProjection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: kPhase as never,
			seq: orphanedKTracker.get().seq,
			canonicalShadowObservedTurnSeq: undefined,
		})
		expect(kProjection.phase).not.toBe("streaming")
		expect(kProjection.phase).not.toBe("completed")
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
		// REAL existing webview presentation helper (`stateLabel`
		// in `taskHeaderTelemetryHelpers.ts`) and assert the
		// visible label is not "Working" (the LIVE SCAR). The
		// pre-P1-amendment version of this test built a local
		// `livePhases` set that COPIED the React predicates
		// into the test — that proved nothing about the real
		// webview consumer. This amendment imports the actual
		// helper and asserts against its output.
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

		// Drive the projection through the REAL webview consumer
		// (`stateLabel` from `taskHeaderTelemetryHelpers.ts` —
		// the same helper that TaskHeader.tsx imports and renders).
		// The label must NOT be "Working" (the LIVE SCAR's
		// visible symptom). It must also NOT be "Complete" (the
		// inverse fabrication that the Elm R2.5 fix prevents).
		const visibleLabel = stateLabel(projection.phase).label
		expect(visibleLabel).not.toBe("Working")
		expect(visibleLabel).not.toBe("Complete")
		// The visible state must be a terminal/blocked phase
		// (live:false). The stateLabel mapping is the source of
		// truth for the visible label ↔ phase correspondence; the
		// blocked scenario should land on a non-live label.
		expect(stateLabel(projection.phase).live).toBe(false)
	})

	it("PTBPC-08: recovery — same task transitions from blocked `error` to a genuine resumed turn", async () => {
		// PTBPC-08: drive the same task from a blocked `error`
		// verdict (BCB `observation_unavailable`, host `error`
		// write per PTBPC01's host transition) into a genuine
		// resumed turn. Assert the host updates its phase
		// (`completed`) before the Elm R2.5 rule can retain a
		// stale `error`. The pre-P1-amendment test suite only
		// checked the forward path (blocked → "Working" SCAR);
		// this amendment exercises the recovery path on the SAME
		// task and proves the host transition's R2.5 short-circuit
		// does not stick when the underlying state genuinely
		// resolves.
		//
		// Production path (sdk-session-event-coordinator.ts):
		//   1. BCB re-registration stamps `observation_unavailable`
		//      → host transition writes `error` (PTBPC01 #1).
		//   2. Marker clear + capability recovered + fresh
		//      completion turn → existing C10 path fires
		//      `setTurnPhase("completed", ...)` at line 1294.
		//   3. R2.5 only fires for `error`/`resumable` legacy; the
		//      fresh `completed` write is consumed by the
		//      `completed` source path.
		const h = makeHarness({
			activeSessionId: "session-ptbpc01-recovery",
			activeTaskId: "task-ptbpc01-recovery",
			initialHeldIds: SEVEN_HELD_IDS,
			initialLiveTools: ["other_tool"],
		})
		// Seed the legacy tracker to `streaming` (LIVE SCAR).
		h.tracker.setWithWriter("streaming", undefined, { writerId: "controller-task-start-init-task" as never })
		// Drive K to the blocked verdict.
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))
		expect(h.getMarkerReason()).toBe("observation_unavailable")
		expect(h.getTrackerPhase()).toBe("error")
		const blockedCalls = h.setTurnPhaseCalls().slice()
		expect(blockedCalls).toEqual(
			expect.arrayContaining([
				{
					phase: "error",
					writerId: "session-event-bcb-blocked-observation-unavailable",
				},
			]),
		)

		// Recover: clear the held set + recover the observation
		// capability, then drive a fresh completion turn. The
		// existing C10 path fires `setTurnPhase("completed", ...)`
		// when the Elm authority gate AUTHORIZEs the completion.
		h.setHeldCount(0)
		h.setLiveTools(["command_status"])
		await emitCompletionTurn(h.coordinator, h.activeSessionId, h.coordinator["options"].messageTranslatorState)
		await new Promise<void>((r) => setTimeout(r, 50))
		// The production runtime calls `notifyAgentTurnDone` after
		// the `done` event to trigger the BCB reevaluation
		// (`reevaluateDeferredCompletionBarrier` at L952). That
		// reeval is what clears the marker when the four
		// conservation checks pass and Elm AUTHORIZEs. The
		// harness simulates the full production seam by calling
		// it explicitly here.
		await h.coordinator.notifyAgentTurnDone(h.activeSessionId)
		await new Promise<void>((r) => setTimeout(r, 50))

		// The host's LATEST `setTurnPhase` write is `completed` —
		// it OVERWROTE the previous `error` write. The Elm R2.5
		// rule does not retain a stale `error`; the projection
		// is the existing successful-completion presentation.
		const allCalls = h.setTurnPhaseCalls()
		expect(allCalls.length).toBeGreaterThan(blockedCalls.length)
		expect(allCalls[allCalls.length - 1].phase).toBe("completed")
		expect(h.getTrackerPhase()).toBe("completed")
		expect(h.getMarkerReason()).toBeUndefined()

		// The projection (real selector + real `stateLabel` webview
		// consumer) reads `completed`, not a stale `error`.
		const projection = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "completed",
			currentLegacyPhase: h.tracker.currentPhase as never,
			seq: h.tracker.get().seq,
			canonicalShadowObservedTurnSeq: h.tracker.get().seq,
		})
		expect(projection.phase).toBe("completed")
		const visibleLabel = stateLabel(projection.phase).label
		expect(visibleLabel).toBe("Complete")
		expect(stateLabel(projection.phase).live).toBe(false)
	})
})
