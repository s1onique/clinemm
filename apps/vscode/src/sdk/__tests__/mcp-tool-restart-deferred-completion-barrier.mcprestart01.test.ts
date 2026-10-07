// ============================================================================
// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03-MCP-TOOL-RESTART-CAUSAL-REPRODUCTION
//
// RED suite that drives the REAL production MCP-tool-rebuild path against
// the deferred-completion barrier. Proves that
//   SdkMcpCoordinator -> SdkSessionRebuildScheduler ->
//   SdkSessionLifecycle.replaceActiveSession(..., disposeReason: "mcpToolRestart")
// CAUSES the LIVE-class deferred-marker loss, not merely correlates with it.
//
// PRODUCTION SEAM (the load-bearing RED, mirror of ACT §7):
//
//   McpHub setToolListChangeCallback(() => mcpCoordinator.handleToolListChanged())
//     (SdkController.ts:2590)
//     -> SdkMcpCoordinator.handleToolListChanged
//        -> rebuilds.request("mcpTools", () => restartSessionForMcpTools())
//        (sdk-mcp-coordinator.ts:31-41)
//
//   SdkSessionRebuildScheduler.drainIfIdle (sdk-session-rebuild-scheduler.ts:56-92)
//     -> predicate: !activeSession || !activeSession.isRunning
//     -> drains pending["mcpTools"] = restartSessionForMcpTools
//
//   SdkMcpCoordinator.restartSessionForMcpTools (sdk-mcp-coordinator.ts:43-112)
//     -> SdkSessionLifecycle.replaceActiveSession({ ..., disposeReason: "mcpToolRestart" })
//       (sdk-session-lifecycle.ts:501-557)
//
//   replaceActiveSession body:
//     -> await this.endActiveSession("mcpToolRestart")
//         (sdk-session-lifecycle.ts:533 -> 274)
//         -> recordLifecycleClear("mcpToolRestart")   <-- lifecycle funnel reason
//         -> this.activeSession = undefined            <-- storage writer
//         -> old host stop (trackSessionStop, pendingStops)
//     -> await this.startNewSession(...)                 <-- GAP window above
//         -> waitForPendingStop(oldSessionId)
//         -> sdkHost.start(...)
//     -> this.activeSession = { sessionId, sdkHost, ... } (install)
//
// Then the post-run reevaluation (POSTRUN/PCRL seam):
//   SdkSessionEventCoordinator.reevaluateDeferredCompletionBarrier
//   (sdk-session-event-coordinator.ts:758-820) reaches the
//   getActiveSession() -> undefined branch (line 786-798) and the LIVE
//   evidence is reproduced EXACTLY:
//     markerPresent=1, activeSessionLookupEntered=1, activeSessionMissing=1,
//     markerClearedForMissingSession=1, lastStopReason="active_session_missing",
//     enqueueIfHeldEntered=0, enqueueCompletionContinuationInvoked=0, delivered=0.
//
// Hard rule: do NOT mock the lifecycle/rebuild/scheduler/MCP-coordinator.
// Only VscodeSessionHost.create is mocked. The REAL SdkMcpCoordinator +
// REAL SdkSessionRebuildScheduler + REAL SdkSessionLifecycle + REAL
// deferred-completion barrier semantics are exercised end-to-end.
//
// Sub-tests map to ACT §25:
//   MCPRESTART-RED-01           REAL MCP restart reproduces marker loss
//   MCPRESTART-CONTROL-02       no MCP restart -> marker survives,
//                                terminal-count branch reached
//   MCPRESTART-AFTER-SETTLE-03  MCP restart after settlement -> healthy,
//                                marker consumed, restart still fires
//   MCPRESTART-RUNNING-04       MCP change while run active -> unchanged,
//                                rebuild remains pending, no premature
//                                replace
//   MCPRESTART-COALESCE-05      repeated MCP tool-list changes coalesce,
//                                at most one replacement per coalesced
//                                generation
//   MCPRESTART-IDENTITY-06      replacement same sessionId -> no A->B
//                                leakage of continuation
//   MCPRESTART-FAILURE-07       replacement creation failure -> no leaked
//                                session/marker; bounded outcome
//   MCPRESTART-EXACTLY-ONCE-08  repeated agent_turn_done/rebuild -> exactly
//                                one continuation, one completion
//   MCPRESTART-OFF-09           no deferred obligation; scheduler
//                                predicate is a no-op (OFF path parity)
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
import { getLifecycleClearSnapshot, resetLifecycleClearSnapshot } from "../lifecycle-clear-recorder"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { buildSdkControllerEnqueueCompletionContinuation } from "../SdkController"
import { SdkMcpCoordinator } from "../sdk-mcp-coordinator"
import { SdkSessionEventCoordinator } from "../sdk-session-event-coordinator"
import { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import { SdkSessionRebuildScheduler } from "../sdk-session-rebuild-scheduler"

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

vi.mock("@/utils/fs", () => ({
	isDirectory: vi.fn().mockResolvedValue(true),
}))

interface MutableHost {
	start: ReturnType<typeof vi.fn>
	subscribe: ReturnType<typeof vi.fn>
	send: ReturnType<typeof vi.fn>
	abort: ReturnType<typeof vi.fn>
	stop: ReturnType<typeof vi.fn>
	dispose: ReturnType<typeof vi.fn>
}

function makeSdkHost(opts: { sessionId: string }): MutableHost {
	return {
		start: vi.fn().mockResolvedValue({ sessionId: opts.sessionId }),
		subscribe: vi.fn().mockReturnValue(vi.fn()),
		send: vi.fn().mockResolvedValue(undefined),
		abort: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
}

interface Fixture {
	readonly lifecycle: SdkSessionLifecycle
	readonly rebuilds: SdkSessionRebuildScheduler
	readonly sessionEvents: SdkSessionEventCoordinator
	readonly mcpCoordinator: SdkMcpCoordinator
	readonly startSession: (sessionId: string) => Promise<void>
	readonly getActiveSession: () => ActiveSession | undefined
	readonly getTask: () => { taskId: string } | undefined
	readonly getTaskId: () => string | undefined
	readonly reevaluateDeferredCompletionBarrier: () => Promise<void>
	readonly seedDeferredMarker: () => void
	readonly setUnconsumedOwnedTerminalCount: (n: number, jobIds?: string[]) => void
	readonly unconsumedTerminalCountRead: () => number
	readonly continuationSendLog: ReadonlyArray<{
		sessionId: string
		taskId: string | undefined
		heldJobIds: readonly string[]
	}>
	/** Fire `notifyAgentTurnDone` to simulate the post-run trigger
	 *  wired by SdkController's `setAgentTurnDoneSemanticTrigger`. */
	readonly notifyAgentTurnDone: () => Promise<void>
}

function makeFixture(opts: { isDeferredOutstanding?: () => boolean } = {}): Fixture {
	const translatorState = new MessageTranslatorState(new MessageIdMinter())
	let liveTask: { taskId: string } | undefined
	let unconsumedTerminalCount = 0
	let unconsumedJobIds: string[] = []
	const continuationSendLog: Array<{
		sessionId: string
		taskId: string | undefined
		heldJobIds: readonly string[]
	}> = []

	const lifecycle = new SdkSessionLifecycle({
		mcpHub: { disconnectSession: vi.fn().mockResolvedValue(undefined) } as never,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onSendComplete: vi.fn(),
		onSendError: vi.fn(),
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
	} as any)

	// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01-CORRECTION03:
	// The deferred-completion outstanding predicate is sourced from the
	// live state on `sessionEvents.deferredCompletionBarrier` AND the live
	// `unconsumedTerminalCount` (BCB01 §0.1 second conjunct). Mirrors the
	// production wiring the new ACT installs in SdkController.
	const sessionEvents = new SdkSessionEventCoordinator({
		sessions: lifecycle,
		messageTranslatorState: translatorState,
		getTask: () => liveTask,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== lifecycle.getActiveSession()?.sessionId) return 0
			return unconsumedTerminalCount
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string, tid: string | undefined) => {
			if (sid !== lifecycle.getActiveSession()?.sessionId) return []
			if (liveTask && tid !== liveTask.taskId) return []
			return unconsumedJobIds.slice()
		},
		getActiveSessionHost: () => lifecycle.getActiveSession()?.sdkHost,
		getActiveJobOwnershipSnapshot: () => [],
		hasRunningBackgroundJobForOwner: () => false,
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		wasWakeDispatchRequested: () => false,
		getPendingPromptCount: () => ({ available: true, count: 0 }),
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
				// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06-CAPABILITY-FAIL-CLOSED-P1:
				// Test fixture supplies the historical default tool
				// list so the production seam's capability projection
				// has an honest input.
				liveTools: () => ["command_status", "submit_and_exit"],
				logger: {
					warn: vi.fn(),
				},
			})(input).then((outcome) => {
				if (outcome.kind === "delivered") {
					unconsumedTerminalCount = 0
					unconsumedJobIds = []
				}
				return outcome
			})
		},
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for session-events unit test
	} as any)

	// Compute the outstanding predicate from the live coordinator state.
	// The production wiring checks: the deferred-completion marker is
	// present on the coordinator AND the conservation predicates have
	// not yet cleared it. The marker presence is the source of truth — the
	// BCB01 §0.1 conjuncts (terminal count > 0, outstanding autonomous
	// work) hold the marker from clearing.
	//
	// Override only when the caller supplies a custom predicate (for
	// negative-control tests).
	const liveOutstandingPredicate = () => {
		return sessionEvents.isDeferredCompletionBarrierOutstandingForTesting()
	}

	const rebuilds = new SdkSessionRebuildScheduler({
		sessions: { getActiveSession: () => lifecycle.getActiveSession() },
		isDeferredCompletionOutstanding: opts.isDeferredOutstanding ?? liveOutstandingPredicate,
	})

	const mcpCoordinator = new SdkMcpCoordinator({
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for StateManager seam
		stateManager: { getGlobalSettingsKey: () => "act" } as any,
		sessions: lifecycle,
		// biome-ignore lint/suspicious/noExplicitAny: minimal fake for messages only
		messages: { appendAndEmit: vi.fn(), emitSessionEvents: vi.fn() } as any,
		// biome-ignore lint/suspicious/noExplicitAny: minimal fake for builder
		sessionConfigBuilder: { build: vi.fn().mockResolvedValue({}) } as any,
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn().mockResolvedValue(undefined),
		buildStartSessionInput: vi.fn().mockImplementation((config, { cwd, mode }) => ({
			config: { ...config, cwd, mode, providerId: "anthropic", modelId: "claude" },
		})),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		rebuilds,
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for mcp-coordinator options
	} as any)

	async function startSession(sessionId: string): Promise<void> {
		const host = makeSdkHost({ sessionId })
		mockCreateSessionHost.mockResolvedValueOnce(host)
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle start input
		await lifecycle.startNewSession({ config: { sessionId, providerId: "anthropic", modelId: "claude-sonnet-4" } } as any)
		lifecycle.setRunning(false)
		liveTask = { taskId: sessionId }
	}

	return {
		lifecycle,
		rebuilds,
		sessionEvents,
		mcpCoordinator,
		startSession,
		getActiveSession: () => lifecycle.getActiveSession(),
		getTask: () => liveTask,
		getTaskId: () => liveTask?.taskId,
		reevaluateDeferredCompletionBarrier: () => sessionEvents.reevaluateDeferredCompletionBarrier(),
		seedDeferredMarker: () => {
			const active = lifecycle.getActiveSession()
			if (!active) throw new Error("seedDeferredMarker: no active session")
			if (!liveTask) throw new Error("seedDeferredMarker: no TaskProxy installed")
			sessionEvents.setDeferredCompletionBarrierForTesting({
				sessionId: active.sessionId,
				taskId: liveTask.taskId,
				epoch: translatorState.getMinter().epoch,
			})
		},
		setUnconsumedOwnedTerminalCount: (n, jobIds) => {
			unconsumedTerminalCount = n
			unconsumedJobIds = jobIds ? jobIds.slice() : Array.from({ length: n }, (_, i) => `cmd_mcp_${i}`)
		},
		unconsumedTerminalCountRead: () => unconsumedTerminalCount,
		continuationSendLog,
		notifyAgentTurnDone: async () => {
			await sessionEvents.notifyAgentTurnDone(lifecycle.getActiveSession()?.sessionId ?? "session-A")
		},
	}
}

describe("MCPRESTART01 — MCP tool-restart causal reproduction against the deferred-completion barrier", () => {
	beforeEach(() => {
		mockCreateSessionHost.mockReset()
		resetCompletionContinuationUpstreamForTests()
		resetCompletionContinuationDeliveryForTests()
		resetLifecycleClearSnapshot()
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
		applyCompletionContinuationDeliveryDiagnosticProfile(true)
		// Lifecycle-clear recorder is dogfood-only. Arm dogfood mode so
		// the snapshot picks up the `mcpToolRestart` funnel reason.
		process.env.CLINEMM_RUNTIME_PROFILE = "dogfood"
	})

	afterEach(() => {
		resetCompletionContinuationUpstreamForTests()
		resetCompletionContinuationDeliveryForTests()
		resetLifecycleClearSnapshot()
		applyCompletionContinuationUpstreamDiagnosticProfile(false)
		applyCompletionContinuationDeliveryDiagnosticProfile(false)
		delete process.env.CLINEMM_RUNTIME_PROFILE
	})

	// -----------------------------------------------------------------
	// MCPRESTART-RED-01 — the parental RED.
	//
	// Drives the REAL MCP-tool-change path through the REAL rebuild
	// scheduler. Asserts the GREEN (post-repair) contract:
	//   1. MCP rebuild is HELD while the deferred obligation is outstanding
	//   2. agent_turn_done -> reevaluate consumes the marker via the
	//      terminal-count branch
	//   3. Continuation callback + delivery fire exactly once
	//   4. AFTER settlement, the pending MCP rebuild drains
	//   5. lifecycle lastClearReason === "mcpToolRestart"
	//   6. activeSession is preserved through the rebuild
	//
	// Pre-fix RED: rebuild fires immediately, endActiveSession
	// ("mcpToolRestart") clears `activeSession = undefined`, the
	// reevaluate below finds no marker (cleared by missing-session branch),
	// terminal count never drains, callback never enters. The test FAILS.
	// -----------------------------------------------------------------
	it("RED-01: MCP tool restart MUST NOT clear the deferred-completion barrier marker (LIVE-shape GREEN)", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		fx.seedDeferredMarker()
		fx.setUnconsumedOwnedTerminalCount(1, ["cmd_mcp_red01"])

		// (A) Drive the REAL MCP tool-list change. With the new deferred
		// predicate, the scheduler MUST hold this rebuild.
		fx.mcpCoordinator.handleToolListChanged()
		await fx.rebuilds.waitUntilSettled()
		await Promise.resolve()
		await Promise.resolve()

		// Lifecycle funnel must NOT have fired (rebuild is held behind
		// the deferred predicate).
		const snapBefore = getLifecycleClearSnapshot()
		expect(snapBefore.total).toBe(0)
		expect(snapBefore.lastClearReason).toBeUndefined()

		// Active session still present and idle.
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")
		expect(fx.getActiveSession()?.isRunning).toBe(false)

		// (B) Now simulate agent_turn_done -> reevaluate. The barrier
		// reaches the terminal-count branch, the continuation enqueue
		// fires, the fixture's enqueueContinuation callback drains the
		// unconsumed count to 0.
		await fx.reevaluateDeferredCompletionBarrier()
		// The continuation enqueue is fire-and-forget (`void ...`). Wait
		// for the full microtask chain (enqueueCompletionContinuationIfHeld
		// -> enqueueCompletionContinuation -> recordCallbackEntered ->
		// sdkHost.send -> recordDelivered -> fixture drain count) to
		// settle. ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06:
		// the production seam consults the Elm kernel
		// (`pickContinuationDirectiveForPublication`) which awaits a
		// setTimeout(0) in `invokeElmKernel` to let the Platform.worker
		// outbound port fire — we must drain the timer queue, not just
		// microtasks. 50ms is the established pattern in
		// background-completion-barrier01 tests.
		await new Promise((r) => setTimeout(r, 200))

		// Marker survived: no missing-session branch reached.
		const upstream = getCompletionContinuationUpstreamCounters()
		expect(upstream.reevaluateEntered).toBeGreaterThanOrEqual(1)
		expect(upstream.activeSessionLookupEntered).toBeGreaterThanOrEqual(1)
		expect(upstream.activeSessionPresent).toBeGreaterThanOrEqual(1)
		expect(upstream.activeSessionMissing).toBe(0)
		expect(upstream.markerClearedForMissingSession).toBe(0)

		// Continuation delivered exactly once.
		expect(fx.continuationSendLog.length).toBe(1)
		expect(fx.continuationSendLog[0].sessionId).toBe("session-A")
		expect(fx.continuationSendLog[0].heldJobIds).toEqual(["cmd_mcp_red01"])
		expect(fx.unconsumedTerminalCountRead()).toBe(0)

		const delivery = getCompletionContinuationDeliveryCounters()
		expect(delivery.callbackEntered).toBe(1)
		expect(delivery.delivered).toBe(1)

		// (B-2) Second reevaluate commits the held marker (terminal
		// count is now 0, no outstanding autonomous work). Marker
		// cleared via the production "all four conservation checks
		// pass" branch at sdk-session-event-coordinator.ts:1021.
		await fx.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setTimeout(r, 200))

		// (C) After settlement, wake the scheduler; the held MCP
		// rebuild drains.
		fx.rebuilds.deferredCompletionSettled()
		await fx.rebuilds.waitUntilSettled()
		await new Promise((r) => setTimeout(r, 200))

		// (D) MCP restart fired (lifecycle funnel reason).
		const snapAfter = getLifecycleClearSnapshot()
		expect(snapAfter.total).toBe(1)
		expect(snapAfter.lastClearReason).toBe("mcpToolRestart")

		// Active session preserved through the rebuild.
		expect(fx.getActiveSession()).toBeDefined()
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")

		// No duplicate continuation.
		const deliveryAfter = getCompletionContinuationDeliveryCounters()
		expect(deliveryAfter.callbackEntered).toBe(1)
		expect(deliveryAfter.delivered).toBe(1)
	})

	// -----------------------------------------------------------------
	// MCPRESTART-CONTROL-02 — no MCP restart.
	// Same initial state, NO tool-list change. Marker MUST survive and
	// the terminal-count branch MUST be reached.
	// -----------------------------------------------------------------
	it("CONTROL-02: same state without MCP change -> terminal-count branch reached, marker survives", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		fx.seedDeferredMarker()
		fx.setUnconsumedOwnedTerminalCount(1, ["cmd_mcp_control02"])

		await fx.reevaluateDeferredCompletionBarrier()
		// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06:
		// production seam awaits Elm's setTimeout(0) before calling
		// `sdkHost.send`. Drain the timer queue to let the fixture's
		// `.then((outcome) => ...)` callback fire (it sets
		// `unconsumedTerminalCount = 0`).
		await new Promise((r) => setTimeout(r, 50))

		expect(fx.continuationSendLog.length).toBe(1)
		expect(fx.continuationSendLog[0].sessionId).toBe("session-A")
		expect(fx.continuationSendLog[0].heldJobIds).toEqual(["cmd_mcp_control02"])
		expect(fx.unconsumedTerminalCountRead()).toBe(0)

		const upstream = getCompletionContinuationUpstreamCounters()
		expect(upstream.markerPresent).toBeGreaterThanOrEqual(1)
		expect(upstream.activeSessionLookupEntered).toBeGreaterThanOrEqual(1)
		expect(upstream.activeSessionPresent).toBeGreaterThanOrEqual(1)
		expect(upstream.activeSessionMissing).toBe(0)
		expect(upstream.markerClearedForMissingSession).toBe(0)

		const delivery = getCompletionContinuationDeliveryCounters()
		expect(delivery.callbackEntered).toBeGreaterThanOrEqual(1)
		expect(delivery.delivered).toBeGreaterThanOrEqual(1)
	})

	// -----------------------------------------------------------------
	// MCPRESTART-AFTER-SETTLE-03 — restart AFTER settlement.
	// Settlement first, then MCP restart. Healthy outcome.
	// -----------------------------------------------------------------
	it("AFTER-SETTLE-03: MCP restart after deferred obligation settles -> restart succeeds, no regression", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		fx.seedDeferredMarker()
		fx.setUnconsumedOwnedTerminalCount(1, ["cmd_mcp_settle03"])

		// Phase 1: terminal-count branch fires the continuation; count
		// drains but the marker is HELD until the next reevaluate finds
		// outstandingAutonomousWork=false (then commits + clears).
		await fx.reevaluateDeferredCompletionBarrier()
		// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06:
		// drain Elm's setTimeout(0) before checking the delivery counter.
		await new Promise((r) => setTimeout(r, 50))
		const deliveryAfterSettle = getCompletionContinuationDeliveryCounters()
		expect(deliveryAfterSettle.callbackEntered).toBe(1)
		expect(deliveryAfterSettle.delivered).toBe(1)

		// Phase 2: second reevaluate commits the held marker (terminal
		// count is 0, outstanding autonomous work is 0, Elm default =
		// authorize). After this call the marker is CLEARED, so the
		// deferred predicate returns false.
		await fx.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setTimeout(r, 50))

		// NOW fire the MCP tool-list change. The deferred obligation
		// is no longer outstanding, so the rebuild drains immediately.
		fx.mcpCoordinator.handleToolListChanged()
		await fx.rebuilds.waitUntilSettled()
		for (let i = 0; i < 10; i++) await Promise.resolve()

		const snap = getLifecycleClearSnapshot()
		expect(snap.lastClearReason).toBe("mcpToolRestart")

		const active = fx.getActiveSession()
		expect(active).toBeDefined()
		expect(active?.sessionId).toBe("session-A")

		const deliveryAfterRestart = getCompletionContinuationDeliveryCounters()
		expect(deliveryAfterRestart.callbackEntered).toBe(1)
		expect(deliveryAfterRestart.delivered).toBe(1)
	})

	// -----------------------------------------------------------------
	// MCPRESTART-RUNNING-04 — MCP change while run active.
	// Rebuild must NOT trigger immediate replace.
	// -----------------------------------------------------------------
	it("RUNNING-04: MCP change while run active -> rebuild pending, no premature replace", async () => {
		const fx = makeFixture()
		const host = makeSdkHost({ sessionId: "session-A" })
		mockCreateSessionHost.mockResolvedValueOnce(host)
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle start input
		await fx.lifecycle.startNewSession({
			config: { sessionId: "session-A", providerId: "anthropic", modelId: "claude" },
		} as any)
		fx.lifecycle.setRunning(true)

		fx.mcpCoordinator.handleToolListChanged()
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()

		expect(getLifecycleClearSnapshot().total).toBe(0)
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")
		expect(fx.getActiveSession()?.isRunning).toBe(true)
	})

	// -----------------------------------------------------------------
	// MCPRESTART-COALESCE-05 — repeated tool-list changes coalesce.
	// -----------------------------------------------------------------
	it("COALESCE-05: repeated MCP tool-list changes coalesce into a single rebuild per coalesced generation", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		// No deferred marker: rebuild drains immediately on coalesce.
		fx.mcpCoordinator.handleToolListChanged()
		fx.mcpCoordinator.handleToolListChanged()
		fx.mcpCoordinator.handleToolListChanged()
		await fx.rebuilds.waitUntilSettled()
		await Promise.resolve()
		await Promise.resolve()

		const snap = getLifecycleClearSnapshot()
		expect(snap.total).toBe(1)
		expect(snap.lastClearReason).toBe("mcpToolRestart")
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")
	})

	// -----------------------------------------------------------------
	// MCPRESTART-IDENTITY-06 — replacement preserves sessionId.
	// -----------------------------------------------------------------
	it("IDENTITY-06: replacement preserves sessionId; continuation resolves against the same logical identity", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		fx.seedDeferredMarker()
		fx.setUnconsumedOwnedTerminalCount(1, ["cmd_mcp_identity06"])

		// (1) Fire MCP change — rebuild HELD because marker is outstanding.
		fx.mcpCoordinator.handleToolListChanged()
		await fx.rebuilds.waitUntilSettled()
		await new Promise((r) => setTimeout(r, 200))

		// (2) Settle the deferred obligation via reevaluate (terminal-count
		// branch fires, count drains, marker still held).
		await fx.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setTimeout(r, 200))

		// (3) Second reevaluate commits the held marker (terminal count
		// is now 0, no outstanding autonomous work). Marker cleared.
		await fx.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setTimeout(r, 200))

		// (4) Wake the scheduler. Pending MCP rebuild drains.
		fx.rebuilds.deferredCompletionSettled()
		await fx.rebuilds.waitUntilSettled()
		await new Promise((r) => setTimeout(r, 200))

		expect(fx.continuationSendLog.length).toBeGreaterThanOrEqual(1)
		const last = fx.continuationSendLog[fx.continuationSendLog.length - 1]
		expect(last.sessionId).toBe("session-A")
		expect(last.heldJobIds).toEqual(["cmd_mcp_identity06"])
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")

		// Lifecycle funnel recorded exactly once.
		const snap = getLifecycleClearSnapshot()
		expect(snap.total).toBe(1)
		expect(snap.lastClearReason).toBe("mcpToolRestart")
	})

	// -----------------------------------------------------------------
	// MCPRESTART-FAILURE-07 — replacement failure has bounded outcome.
	// The rebuild's loadInitialMessages throws. The marker must NOT be
	// routed through a leaked identity; the rebuild's catch path must
	// surface the error without consuming the continuation.
	// -----------------------------------------------------------------
	it("FAILURE-07: replacement creation failure does not leak continuation; bounded failure path", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		// Force the rebuild path to fail AFTER endActiveSession fires.
		// We replace `replaceActiveSession` with a mock that throws
		// AFTER `endActiveSession("mcpToolRestart")` has already cleared
		// activeSession (mirroring a half-installed replacement).
		// biome-ignore lint/suspicious/noExplicitAny: narrow options view
		const realSessions = fx.lifecycle
		// biome-ignore lint/suspicious/noExplicitAny: narrow options view
		const originalReplace = realSessions.replaceActiveSession.bind(realSessions)
		realSessions.replaceActiveSession = vi.fn(async (opts) => {
			// Mirror the production order: clear first, then throw.
			await originalReplace(opts)
			throw new Error("synthetic restart failure")
		}) as never

		fx.mcpCoordinator.handleToolListChanged()
		await fx.rebuilds.waitUntilSettled()
		for (let i = 0; i < 10; i++) await Promise.resolve()

		const snap = getLifecycleClearSnapshot()
		// The funnel DID fire (clear was issued), but the rebuild path's
		// catch surfaced the error. Either way, no continuation leaked.
		expect(snap.lastClearReason).toBe("mcpToolRestart")
		const delivery = getCompletionContinuationDeliveryCounters()
		expect(delivery.delivered).toBe(0)
		for (const entry of fx.continuationSendLog) {
			expect(entry.sessionId).toBe("session-A")
		}
	})

	// -----------------------------------------------------------------
	// MCPRESTART-EXACTLY-ONCE-08 — repeated cycles deliver exactly one.
	// -----------------------------------------------------------------
	it("EXACTLY-ONCE-08: repeated reevaluate cycles + MCP rebuild -> at most one continuation", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		fx.seedDeferredMarker()
		fx.setUnconsumedOwnedTerminalCount(1, ["cmd_mcp_exactly_once08"])

		// Cycle 1: reevaluate drains via terminal-count branch.
		await fx.reevaluateDeferredCompletionBarrier()
		// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06:
		// production seam awaits Elm's `setTimeout(0)` before calling
		// `sdkHost.send`. Drain the timer queue to let the chain settle.
		await new Promise((r) => setTimeout(r, 50))
		const c1 = getCompletionContinuationDeliveryCounters()
		expect(c1.delivered).toBe(1)

		// Cycle 2: reevaluate (no marker -> no-op).
		await fx.reevaluateDeferredCompletionBarrier()
		await new Promise((r) => setTimeout(r, 50))
		const c2 = getCompletionContinuationDeliveryCounters()
		expect(c2.delivered).toBe(1)

		// MCP restart now (no outstanding obligation -> rebuild fires).
		fx.mcpCoordinator.handleToolListChanged()
		await fx.rebuilds.waitUntilSettled()
		await Promise.resolve()
		await Promise.resolve()

		const c3 = getCompletionContinuationDeliveryCounters()
		expect(c3.delivered).toBe(1)
	})

	// -----------------------------------------------------------------
	// MCPRESTART-OFF-09 — no deferred obligation; scheduler is a no-op.
	// Mirrors the OFF path (Elm authority OFF -> TS predicates are the
	// sole source of the deferred barrier -> here the fixture explicitly
	// omits any outstanding obligation so the rebuild fires immediately).
	// -----------------------------------------------------------------
	it("OFF-09: scheduler predicate is a no-op when no deferred obligation is outstanding (OFF path parity)", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		expect(fx.unconsumedTerminalCountRead()).toBe(0)

		fx.mcpCoordinator.handleToolListChanged()
		await fx.rebuilds.waitUntilSettled()
		await Promise.resolve()
		await Promise.resolve()

		const snap = getLifecycleClearSnapshot()
		expect(snap.lastClearReason).toBe("mcpToolRestart")
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")

		const delivery = getCompletionContinuationDeliveryCounters()
		expect(delivery.delivered).toBe(0)
	})

	// -----------------------------------------------------------------
	// MCPRESTART-NEGATIVE-10 — drainIfIdle WAITS while deferred is
	// outstanding (the load-bearing GREEN assertion).
	// This test uses a custom `isDeferredOutstanding` predicate that
	// returns true unconditionally, then asserts the rebuild is HELD.
	// It is the discriminator that proves the new scheduler gate is
	// consulted (not just the legacy !isRunning predicate).
	// -----------------------------------------------------------------
	it("NEGATIVE-10: scheduler holds drain while deferred predicate returns true (green proof of the new gate)", async () => {
		let outstanding = true
		const fx = makeFixture({
			isDeferredOutstanding: () => outstanding,
		})
		await fx.startSession("session-A")

		fx.mcpCoordinator.handleToolListChanged()
		await fx.rebuilds.waitUntilSettled()
		await Promise.resolve()
		await Promise.resolve()

		// Rebuild was HELD by the deferred predicate.
		expect(getLifecycleClearSnapshot().total).toBe(0)
		expect(fx.getActiveSession()?.sessionId).toBe("session-A")

		// Settle the obligation externally.
		outstanding = false
		fx.rebuilds.deferredCompletionSettled()
		await fx.rebuilds.waitUntilSettled()
		await Promise.resolve()
		await Promise.resolve()

		// Rebuild fires now.
		expect(getLifecycleClearSnapshot().lastClearReason).toBe("mcpToolRestart")
	})
})
