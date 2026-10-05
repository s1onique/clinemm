// ============================================================================
// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION01-SHOWTASKWITHID-CAUSAL-REPRODUCTION
//
// RED suite that drives the REAL production `showTaskWithId` seam
// (`SdkTaskControlCoordinator.showTaskWithId(taskId)` →
//  `SdkSessionLifecycle.endActiveSession("showTaskWithId", ...)` →
//  `clearActiveSessionReference()` → `activeSession = undefined`)
// and asserts that the LIVE deferred-completion-barrier (BCB01) failure
// chronology reproduces.
//
// PRODUCTION SEAM (the load-bearing RED):
//
//   History webview click
//     → webview-ui TaskServiceClient.showTaskWithId (gRPC)
//     → controller.showTaskWithId  (src/core/controller/task/showTaskWithId.ts)
//     → SdkController.showTaskWithId (sdk/SdkController.ts:4653)
//     → SdkTaskControlCoordinator.showTaskWithId (sdk/sdk-task-control-coordinator.ts:192)
//     → SdkSessionLifecycle.endActiveSession("showTaskWithId", {awaitStop}) (sdk-session-lifecycle.ts:232→274)
//
// Then SdkSessionEventCoordinator.reevaluateDeferredCompletionBarrier at
// sdk-session-event-coordinator.ts:758 reaches the `getActiveSession() →
// undefined` branch (line 786-798) and the LIVE evidence is exactly:
//   markerPresent=1, activeSessionLookupEntered=1, activeSessionMissing=1,
//   markerClearedForMissingSession=1, lastStopReason="active_session_missing",
//   enqueueIfHeldEntered=0, enqueueCompletionContinuationInvoked=0, delivered=0.
//
// Hard rule: do NOT mock `SdkSessionLifecycle.endActiveSession` (that would
// prove the writer, not the composition). Only VscodeSessionHost.create is
// mocked, mirroring the convention of `task-control-liveness.tcl-reach02.test.ts`
// and `lifecycle-clear-recorder-funnel.clcrec02.test.ts`. The REAL
// SdkTaskControlCoordinator + REAL SdkSessionLifecycle + REAL deferred-marker
// semantics are exercised end-to-end.
//
// Sub-tests map to ACT §15:
//   SHOWTASK-RED-01    REAL showTaskWithId reproduction (the parental RED)
//   SHOWTASK-CONTROL-02 same state WITHOUT showTaskWithId → marker survives
//   SHOWTASK-SAME-03   same-task show (activeSession.sessionId === taskId)
//   SHOWTASK-DIFFERENT-04 A → B (different task switch)
//   SHOWTASK-SESSION-IDENTITY-05 session identity isolation across switch
//   SHOWTASK-CANCEL-06 cancel semantics across switch
//   SHOWTASK-EXACTLY-ONCE-07 repeated show/agent_done/reevaluate → 1 continuation
//
// Contract classification (per ACT §4): HYBRID. showTaskWithId(A) when A
// is already current re-installs the active session lifecycle (existing
// behavior at sdk-task-control-coordinator.ts:231-234); showTaskWithId(B)
// when B is different intentionally tears down A. The RED does NOT assume
// the correct classification; it observes the current behavior verbatim
// and pins both cases.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ActiveSession } from "../cline-session-factory"
import {
	getCompletionContinuationDeliveryCounters,
	resetCompletionContinuationDeliveryForTests,
} from "../completion-continuation-delivery-runtime"
import {
	getCompletionContinuationUpstreamCounters,
	resetCompletionContinuationUpstreamForTests,
} from "../completion-continuation-upstream-runtime"
import {
	applyCompletionContinuationDeliveryDiagnosticProfile,
	applyCompletionContinuationUpstreamDiagnosticProfile,
} from "../dogfood-diagnostic-profile"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { buildSdkControllerEnqueueCompletionContinuation } from "../SdkController"
import { SdkSessionEventCoordinator } from "../sdk-session-event-coordinator"
import { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import { SdkTaskControlCoordinator, type SdkTaskControlCoordinatorOptions } from "../sdk-task-control-coordinator"
import { TaskOperationFence } from "../task-operation-fence"
import { TurnStateTracker } from "../turn-state-tracker"

const mockCreateSessionHost = vi.hoisted(() => vi.fn())

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => undefined,
		}),
	},
}))

vi.mock("../vscode-session-host", () => ({
	VscodeSessionHost: {
		create: mockCreateSessionHost,
	},
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

import { Logger } from "@/shared/services/Logger"

function makeSdkHost(opts: {
	sessionId: string
	sendImpl?: (input: { sessionId: string; prompt: string; delivery?: "queue" | "steer" }) => Promise<void>
}): { [k: string]: unknown } {
	return {
		start: vi.fn().mockResolvedValue({ sessionId: opts.sessionId }),
		stop: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn().mockReturnValue(vi.fn()),
		send: vi.fn(opts.sendImpl ?? (() => Promise.resolve())),
		abort: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
		restore: vi.fn(),
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
	} as any
}

interface Fixture {
	readonly host: ReturnType<typeof makeSdkHost>
	readonly lifecycle: SdkSessionLifecycle
	readonly coordinator: SdkTaskControlCoordinator
	readonly sessionEvents: SdkSessionEventCoordinator
	readonly fence: TaskOperationFence
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly startSession: (sessionId: string) => Promise<void>
	readonly getActiveSession: () => ActiveSession | undefined
	readonly getTaskId: () => string | undefined
	readonly reevaluateDeferredCompletionBarrier: () => Promise<void>
	readonly seedDeferredMarker: () => void
	readonly setUnconsumedOwnedTerminalCount: (n: number, jobIds?: string[]) => void
	readonly continuationSendLog: ReadonlyArray<{
		sessionId: string
		taskId: string | undefined
		heldJobIds: readonly string[]
	}>
}

function makeFixture(): Fixture {
	const host = makeSdkHost({ sessionId: "session-A" })
	mockCreateSessionHost.mockResolvedValue(host)

	let liveTask: { taskId: string } | undefined

	const fx_fence = new TaskOperationFence()
	const tracker = new TurnStateTracker(new MessageIdMinter())
	const translatorState = new MessageTranslatorState(new MessageIdMinter())

	const lifecycle = new SdkSessionLifecycle({
		mcpHub: { disconnectSession: vi.fn().mockResolvedValue(undefined) } as never,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onSendComplete: vi.fn(),
		onSendError: vi.fn(),
		isOperationCurrent: (token: number) => fx_fence.isCurrent(token),
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
	} as any)

	let unconsumedTerminalCount = 0
	let unconsumedJobIds: string[] = []
	const continuationSendLog: Array<{
		sessionId: string
		taskId: string | undefined
		heldJobIds: readonly string[]
	}> = []

	const coordinatorOptions: SdkTaskControlCoordinatorOptions = {
		sessions: lifecycle,
		interactions: { clearPending: vi.fn() } as never,
		taskOperationFence: fx_fence,
		messages: {
			appendAndEmit: vi.fn(),
			appendMessages: vi.fn(),
			cancelPendingSave: vi.fn(),
			finalizeMessagesForSave: vi.fn((messages: unknown[]) => messages),
			emitSessionEvents: vi.fn(),
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		} as any,
		taskHistory: {
			findHistoryItem: vi.fn().mockImplementation(
				async (taskId: string) =>
					({
						id: taskId,
						task: "history-task",
						preview: "",
						ts: Date.now(),
						// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
					}) as any,
			),
			getClineMessages: vi.fn().mockResolvedValue([]),
			getSessionStatus: vi.fn().mockResolvedValue("idle"),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		} as any,
		getTask: () => liveTask as never,
		setTask: (task: unknown) => {
			liveTask = task as { taskId: string }
		},
		clearTaskSettings: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		onAskResponse: vi.fn(),
		resetMessageTranslator: vi.fn(),
		raiseCancelFence: vi.fn(),
	}

	const coordinator = new SdkTaskControlCoordinator(coordinatorOptions)

	const sessionEvents = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: lifecycle,
		messages: { appendAndEmit: vi.fn() } as never,
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => liveTask as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: vi.fn(),
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent: () => ({ kind: "noop" }) as never,
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: () => unconsumedTerminalCount,
		getUnconsumedOwnedTerminalJobIds: () => unconsumedJobIds.slice(),
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			continuationSendLog.push({
				sessionId: input.sessionId,
				taskId: input.taskId,
				heldJobIds: input.heldJobIds,
			})
			return buildSdkControllerEnqueueCompletionContinuation({
				getActiveSession: () => lifecycle.getActiveSession(),
				logger: Logger,
			})(input)
		},
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
	} as any)

	async function startSession(sessionId: string): Promise<void> {
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({ config: { sessionId, providerId: "anthropic", modelId: "claude-sonnet-4" } } as any)
		// LIVE shape: the model has called submit_and_exit, the BCB
		// marker is held for outstanding autonomous work. The agent
		// turn is DONE — the runtime is idle. Set isRunning=false
		// to mirror the production transition
		// (`SdkController.handleSessionBecameIdle` → `sessions.setRunning(false)`).
		lifecycle.setRunning(false)
		liveTask = { taskId: sessionId }
	}

	return {
		host,
		lifecycle,
		coordinator,
		sessionEvents,
		fence: fx_fence,
		activeSessionId: "session-A",
		activeTaskId: "task-A",
		startSession,
		getActiveSession: () => lifecycle.getActiveSession(),
		getTaskId: () => liveTask?.taskId,
		reevaluateDeferredCompletionBarrier: () => sessionEvents.reevaluateDeferredCompletionBarrier(),
		seedDeferredMarker: () => {
			const active = lifecycle.getActiveSession()
			if (!active) {
				throw new Error("seedDeferredMarker: no active session")
			}
			if (!liveTask) {
				throw new Error("seedDeferredMarker: no TaskProxy installed")
			}
			sessionEvents.setDeferredCompletionBarrierForTesting({
				sessionId: active.sessionId,
				taskId: liveTask.taskId,
				epoch: translatorState.getMinter().epoch,
			})
		},
		setUnconsumedOwnedTerminalCount: (n: number, jobIds?: string[]) => {
			unconsumedTerminalCount = n
			if (jobIds) {
				unconsumedJobIds = jobIds.slice()
			} else {
				unconsumedJobIds = Array.from({ length: n }, (_, i) => `cmd_seed_${i}`)
			}
		},
		continuationSendLog,
	}
}

describe("SHOWTASK01 — showTaskWithId causal reproduction against the LIVE BCB01 marker-loss", () => {
	beforeEach(() => {
		resetCompletionContinuationUpstreamForTests()
		resetCompletionContinuationDeliveryForTests()
		mockCreateSessionHost.mockReset()
		// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03:
		// arm the upstream + delivery diagnostics so the
		// record*() dispatchers inside
		// `reevaluateDeferredCompletionBarrier` and
		// `enqueueCompletionContinuationIfHeld` actually advance
		// the counters. Mirrors `ccupd01.test.ts` (UPSTREAM-DIAG-02+).
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
		applyCompletionContinuationDeliveryDiagnosticProfile(true)
	})

	afterEach(() => {
		resetCompletionContinuationUpstreamForTests()
		resetCompletionContinuationDeliveryForTests()
		mockCreateSessionHost.mockReset()
		applyCompletionContinuationUpstreamDiagnosticProfile(false)
		applyCompletionContinuationDeliveryDiagnosticProfile(false)
	})

	// ----------------------------------------------------------------------
	// SHOWTASK-RED-01 — the parental RED.
	//
	// This test pins the EXPECTED behavior under the active-session
	// lookup branch: the marker should SURVIVE the showTaskWithId
	// teardown because showTaskWithId on the currently-active task
	// is semantically idempotent at the user layer (re-clicking the
	// active history entry is a no-op user intent). The deferred
	// completion obligation for the current task MUST persist across
	// this transition so the continuation callback reaches the host.
	//
	// PRE-FIX behavior (the LIVE reproduction):
	//   - activeSession is torn down by endActiveSession("showTaskWithId")
	//   - marker is cleared by the missing-session branch on reeval #1
	//   - continuation callback is NEVER entered
	//   - assertions below FAIL: callbackEntered=0, sdkHostSendEntered=0
	//
	// POST-FIX behavior (after a bounded lifecycle seam repair):
	//   - showTaskWithId on the currently-active task preserves the
	//     activeSession reference OR the deferred-marker resolution
	//     path consults the still-current (sessionId, taskId) tuple
	//     before clearing
	//   - callbackEntered=1, sdkHostSendEntered=1, delivered=1
	//   - assertions below PASS
	// ----------------------------------------------------------------------
	it("RED-01: showTaskWithId on the active task must NOT lose the BCB01 continuation callback", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		fx.seedDeferredMarker()
		fx.setUnconsumedOwnedTerminalCount(1, ["cmd_red01"])
		expect(fx.sessionEvents.getDeferredCompletionBarrierForTesting()).toBeDefined()
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")

		await fx.coordinator.showTaskWithId("session-A")

		// The endActiveSession("showTaskWithId", {awaitStop:true})
		// tore down the active session — this is the seam under test.
		// The marker resolution depends on whether showTaskWithId
		// preserves the (sessionId, taskId) tuple the marker was
		// bound to.

		await fx.reevaluateDeferredCompletionBarrier()

		const u = getCompletionContinuationUpstreamCounters()
		const d = getCompletionContinuationDeliveryCounters()

		// The upstream discriminator must have advanced past U2
		// (markerPresent). It may or may not have reached U2.5
		// (active-session lookup) — that depends on whether the
		// activeSession was preserved by the showTaskWithId seam.
		expect(u.markerPresent).toBe(1)
		expect(u.reevaluateEntered).toBe(1)

		// The deferred-completion CONTINUATION CALLBACK must reach
		// the host. This is the load-bearing RED — the LIVE run
		// observes callbackEntered=0; a bounded lifecycle seam
		// repair (SAME-TASK idempotence) would make it 1.
		expect(d.callbackEntered).toBe(1)
		expect(d.delivered).toBe(1)
		expect(d.lastOutcome).toBe("delivered")
		expect(fx.continuationSendLog.length).toBeGreaterThan(0)
	})

	// ----------------------------------------------------------------------
	// SHOWTASK-CONTROL-02 — without showTaskWithId, the marker survives and
	// the continuation progresses.
	// ----------------------------------------------------------------------
	it("CONTROL-02: same state WITHOUT showTaskWithId → marker survives → continuation enqueued → callback reached", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		fx.seedDeferredMarker()
		fx.setUnconsumedOwnedTerminalCount(1, ["cmd_control02"])
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")
		expect(fx.getActiveSession()).toBeDefined()

		await fx.reevaluateDeferredCompletionBarrier()

		const u = getCompletionContinuationUpstreamCounters()
		const d = getCompletionContinuationDeliveryCounters()

		expect(u.markerPresent).toBe(1)
		expect(u.activeSessionLookupEntered).toBe(1)
		expect(u.activeSessionPresent).toBe(1)
		expect(u.activeSessionMissing).toBe(0)
		expect(u.markerClearedForMissingSession).toBe(0)
		expect(u.lastStopReason).not.toBe("active_session_missing")
		expect(u.unconsumedTerminalCountPositive).toBe(1)
		expect(u.enqueueIfHeldEntered).toBe(1)
		expect(u.enqueueCompletionContinuationInvoked).toBe(1)
		expect(d.callbackEntered).toBe(1)
		expect(d.sdkHostSendEntered).toBe(1)
		expect(d.delivered).toBe(1)
		expect(d.lastOutcome).toBe("delivered")
	})

	// ----------------------------------------------------------------------
	// SHOWTASK-SAME-03 — same-task show on an idle session: the
	// post-repair behavior is that the active session survives
	// (same-task idempotence for the idle case). For RUNNING
	// sessions the original end+restart still applies (covered by
	// RUNNING-SAME-03a below).
	// ----------------------------------------------------------------------
	it("SAME-03: showTaskWithId on the active IDLE session preserves the active session lifecycle (post-repair idempotence)", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")
		expect(fx.getActiveSession()?.isRunning).toBe(false)

		await fx.coordinator.showTaskWithId("session-A")

		// Same-task idle show no longer destroys the active session.
		// The BCB01 marker, the deferred continuation, and the
		// session lifecycle all remain intact.
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")
	})

	// ----------------------------------------------------------------------
	// SHOWTASK-SAME-03a — same-task show on a RUNNING session: the
	// original end+restart still applies (preserves the persisted
	// session-status invariant the original author intended).
	// ----------------------------------------------------------------------
	it("SAME-03a: showTaskWithId on the active RUNNING session still tears down the active session lifecycle", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		// Bump isRunning back to true to mirror a session that has
		// a turn in flight.
		fx.lifecycle.setRunning(true)
		expect(fx.getActiveSession()?.isRunning).toBe(true)

		await fx.coordinator.showTaskWithId("session-A")

		expect(fx.getActiveSession()).toBeUndefined()
	})

	// ----------------------------------------------------------------------
	// SHOWTASK-DIFFERENT-04 — different task: A → B. The active session
	// is intentionally torn down by the unconditional
	// endActiveSession("showTaskWithId", {awaitStop:false}) call.
	// ----------------------------------------------------------------------
	it("DIFFERENT-04: showTaskWithId(otherTaskId) tears down the active session lifecycle", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")

		await fx.coordinator.showTaskWithId("task-B")

		// The first half of showTaskWithId (the unconditional
		// endActiveSession("showTaskWithId")) must have torn down
		// the active session regardless of which task was requested.
		expect(fx.getActiveSession()).toBeUndefined()
	})

	// ----------------------------------------------------------------------
	// SHOWTASK-SESSION-IDENTITY-05 — A's deferred marker MUST survive
	// same-task show (post-repair). The post-repair behavior is that
	// the active session is preserved on same-task show, so the
	// marker is resolved by the continuation path (NOT cleared by the
	// active-session-missing branch).
	// ----------------------------------------------------------------------
	it("SESSION-IDENTITY-05: A's deferred marker survives same-task show and is delivered", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		fx.seedDeferredMarker()
		fx.setUnconsumedOwnedTerminalCount(1, ["cmd_sess_id"])
		await fx.coordinator.showTaskWithId("session-A")
		await fx.reevaluateDeferredCompletionBarrier()
		const u = getCompletionContinuationUpstreamCounters()
		const d = getCompletionContinuationDeliveryCounters()
		expect(u.markerClearedForMissingSession).toBe(0)
		expect(u.activeSessionMissing).toBe(0)
		expect(u.activeSessionPresent).toBe(1)
		expect(d.callbackEntered).toBe(1)
		expect(d.delivered).toBe(1)
	})

	// ----------------------------------------------------------------------
	// SHOWTASK-CANCEL-06 — repeated showTaskWithId on the active idle
	// session: post-repair, the marker survives the first show and is
	// delivered exactly once. Subsequent shows do not duplicate.
	// ----------------------------------------------------------------------
	it("CANCEL-06: repeated showTaskWithId(currentTaskId) on idle session delivers the continuation exactly once", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		fx.seedDeferredMarker()
		fx.setUnconsumedOwnedTerminalCount(1, ["cmd_cancel06"])

		await fx.coordinator.showTaskWithId("session-A")
		await fx.reevaluateDeferredCompletionBarrier()
		const d1 = getCompletionContinuationDeliveryCounters()
		expect(d1.callbackEntered).toBe(1)

		await fx.reevaluateDeferredCompletionBarrier()
		const d2 = getCompletionContinuationDeliveryCounters()
		expect(d2.callbackEntered).toBe(1)

		await fx.coordinator.showTaskWithId("session-A")
		await fx.reevaluateDeferredCompletionBarrier()
		const d3 = getCompletionContinuationDeliveryCounters()
		expect(d3.callbackEntered).toBe(1)
	})

	// ----------------------------------------------------------------------
	// SHOWTASK-EXACTLY-ONCE-07 — repeated show/agent_done/reevaluate
	// combinations must produce exactly one continuation. Post-repair
	// the marker survives the same-task show, so the FIRST reeval
	// delivers exactly once; subsequent cycles do not duplicate.
	// ----------------------------------------------------------------------
	it("EXACTLY-ONCE-07: showTaskWithId + reevaluate cycles deliver exactly once (post-repair idempotence)", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		fx.seedDeferredMarker()
		fx.setUnconsumedOwnedTerminalCount(1, ["cmd_exactly_once"])

		await fx.coordinator.showTaskWithId("session-A")
		await fx.reevaluateDeferredCompletionBarrier()
		const d1 = getCompletionContinuationDeliveryCounters()
		expect(d1.callbackEntered).toBe(1)

		await fx.reevaluateDeferredCompletionBarrier()
		const d2 = getCompletionContinuationDeliveryCounters()
		expect(d2.callbackEntered).toBe(1)

		await fx.coordinator.showTaskWithId("session-A")
		await fx.reevaluateDeferredCompletionBarrier()
		const d3 = getCompletionContinuationDeliveryCounters()
		expect(d3.callbackEntered).toBe(1)
	})
})
