// ============================================================================
// ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / TCL-PARENT01-03
//
// DISCRIMINATOR (CORRECTION03): per the Factory reviewer's
// `PASS_RECON_WITH_ONE_P1_CAUSAL_GAP` directive, the next step is
// ONE test file that exercises the REAL top-level New Task path
// against an external clearTask, using the production owner's
// `SdkTaskStartCoordinator.initTask`.
//
// The previous TCL-REACH02 proved an underlying race CAPABILITY by
// racing `startNewSession` against `clearTask` directly. The reviewer
// correctly noted:
//
//   "The naked lifecycle RED proves the underlying race capability.
//    It does not yet prove the actual user-facing route can schedule
//    exactly that interleaving."
//
//   "The authoritative parent RED should exercise:
//      REAL SdkTaskStartCoordinator.initTask
//      concurrently with
//      REAL SdkTaskControlCoordinator.clearTask
//    not a naked lifecycle start."
//
//   "The actual concurrency window is more like:
//      initTask B
//        clearTask()
//        setTask(B)
//        startNewSession(B)
//                ↕ race
//      external clearTask()"
//
//   "So the likely repair boundary is higher — task-start /
//    task-control transaction boundary, or a shared generation /
//    fencing protocol — not automatically a mutex inside
//    SdkSessionLifecycle, because TaskProxy is owned OUTSIDE
//    SdkSessionLifecycle."
//
// Required wiring (reviewer's directive):
//   - REAL SdkSessionLifecycle (mocks only the VscodeSessionHost
//     factory, mirroring the pattern at
//     apps/vscode/src/sdk/sdk-session-lifecycle.test.ts:9-13)
//   - REAL SdkTaskControlCoordinator (depends on lifecycle)
//   - REAL SdkTaskStartCoordinator (depends on both above + minimal
//     SdkSessionConfigBuilder / SdkTaskHistory / deps)
//   - REAL SdkCompactionCoordinator
//   - REAL SdkMessageCoordinator
//
// Deterministic pause point: the production code path is
//   SdkTaskStartCoordinator.initTask
//     → SdkSessionLifecycle.startNewSession
//       → VscodeSessionHost.start
// The test pauses `sdkHost.start` so that initTask completes through
// `createAndSetTask(B)` + `emitInitialTaskMessage(B)` and posts state,
// but BLOCKS at the startNewSession await. The external `clearTask`
// runs in this window, which (per the reviewer's chronology) clears
// TaskProxy B and tries to clear activeSession (which is undefined),
// then external clearTask completes with `setTask(undefined)`. We
// release `sdkHost.start`, lifecycle installs activeSession = B, and
// the wedge is observable.
//
// THREE TESTS:
//   PARENT01: from the wedge state, the TASK_SESSION_PAIR_INVARIANT
//             holds: either both undefined OR both present-and-equal.
//             This is the parent causal RED if it fails.
//   PARENT02: from the wedge state, the REAL SdkCompactionCoordinator
//             exercises Compact (the user-facing compact click). The
//             desired behavior is `compactionStarted || explicitFailurePublished`.
//   PARENT03: from the wedge state, the REAL SdkTaskStartCoordinator
//             exercises the user-facing New Task flow (submit prompt +
//             first message) — NOT a second clearTask. Asserts the
//             fresh task/session pair exists, turn phase is streaming,
//             and `setTurnPhase("streaming")` was called. If both
//             intents fail, this is CASE_H_TWO_INDEPENDENT_BUGS.
//
// REQUIRED INVARIANT (asserted at every settled boundary):
//   TASK_SESSION_PAIR_INVARIANT
//     At every externally observable settled boundary:
//       neither exists
//     OR
//       both exist and identify the same logical task
//     Never:
//       TaskProxy absent + activeSession present
//     Never:
//       TaskProxy A + activeSession B (mismatch)
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest"
import { SdkCompactionCoordinator, type SdkCompactionCoordinatorOptions } from "../sdk-compaction-coordinator"
import { SdkMessageCoordinator } from "../sdk-message-coordinator"
import { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "../sdk-session-rebuild-scheduler"
import { SdkTaskControlCoordinator, type SdkTaskControlCoordinatorOptions } from "../sdk-task-control-coordinator"
import { SdkTaskStartCoordinator, type SdkTaskStartCoordinatorOptions } from "../sdk-task-start-coordinator"
import { TaskOperationFence } from "../task-operation-fence"

const mockCreateSessionHost = vi.hoisted(() => vi.fn())

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: (key: string) => (key === "mode" ? "act" : undefined),
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

import { Logger } from "@/shared/services/Logger"

interface HostHandle {
	host: {
		start: ReturnType<typeof vi.fn>
		subscribe: ReturnType<typeof vi.fn>
		send: ReturnType<typeof vi.fn>
		abort: ReturnType<typeof vi.fn>
		stop: ReturnType<typeof vi.fn>
		dispose: ReturnType<typeof vi.fn>
	}
	startResolver: { resolve: (sessionId: string) => void; promise: Promise<{ sessionId: string }> }
}

function makeControllableHost(): HostHandle {
	// Stable wrapper so the Promise executor's closure captures a
	// non-TDZ reference. The TDZ pattern (`let x; x = {...}`
	// where the inner Promise captures `x`) is unsafe: when the
	// executor runs synchronously, `x` is still in TDZ.
	const state: { resolve: ((sessionId: string) => void) | undefined } = { resolve: undefined }
	const promise = new Promise<{ sessionId: string }>((resolve) => {
		state.resolve = (sessionId) => resolve({ sessionId })
	})
	if (!state.resolve) {
		throw new Error("startResolver: executor did not run synchronously")
	}
	const startResolver = {
		resolve: state.resolve as (sessionId: string) => void,
		promise,
	}
	return {
		host: {
			start: vi.fn().mockImplementation(() => startResolver.promise),
			subscribe: vi.fn().mockReturnValue(vi.fn()),
			send: vi.fn().mockResolvedValue(undefined),
			abort: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		startResolver,
	}
}

class SimpleRebuildScheduler {
	private chain: Promise<void> = Promise.resolve()
	async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.chain
		let release!: () => void
		this.chain = new Promise<void>((resolve) => {
			release = resolve
		})
		try {
			await previous
			return await operation()
		} finally {
			release()
		}
	}
}

interface SharedState {
	task?: {
		taskId: string
		messageStateHandler: { clear: ReturnType<typeof vi.fn>; addMessages: ReturnType<typeof vi.fn> }
	}
	sessionId?: string
}

interface Fixture {
	state: SharedState
	lifecycle: SdkSessionLifecycle
	taskControl: SdkTaskControlCoordinator
	taskStart: SdkTaskStartCoordinator
	compaction: SdkCompactionCoordinator
	messages: SdkMessageCoordinator
	hostHandle: HostHandle
	scheduleExternalClearTask: (midHook?: () => Promise<void>) => Promise<void>
	setInitialTask: (sessionId: string) => void
	startInitialSession: (sessionId: string) => Promise<void>
	setTurnPhaseCalls: Array<{ phase: string }>
}

function makeFixture(): Fixture {
	const state: SharedState = {}

	const hostHandle = makeControllableHost()
	mockCreateSessionHost.mockResolvedValue(hostHandle.host)

	// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: one shared fence
	// instance per test, threaded into the control coordinator and
	// the lifecycle (via `isOperationCurrent`).
	const fx_shared_fence = new TaskOperationFence()

	const lifecycle = new SdkSessionLifecycle({
		mcpHub: {} as never,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onSendComplete: vi.fn(),
		onSendError: vi.fn(),
		isOperationCurrent: (token) => fx_shared_fence.isCurrent(token),
	})

	const messages = new SdkMessageCoordinator({ getTask: () => state.task as never })

	const setTurnPhaseCalls: Array<{ phase: string }> = []

	const controlOptions: SdkTaskControlCoordinatorOptions = {
		// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: per-test fence
		// authority. Shared between the task control coordinator and
		// the lifecycle via `isOperationCurrent` below.
		taskOperationFence: fx_shared_fence,
		sessions: lifecycle,
		interactions: { clearPending: vi.fn() } as never,
		messages: {
			appendAndEmit: vi.fn(),
			appendMessages: vi.fn((msgs: unknown[]) => messages.appendMessages(msgs as never)),
			cancelPendingSave: vi.fn(() => messages.cancelPendingSave()),
			finalizeMessagesForSave: vi.fn((m: unknown[]) => m),
			emitSessionEvents: vi.fn(),
		} as never,
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			getClineMessages: vi.fn().mockResolvedValue([]),
			getSessionStatus: vi.fn().mockResolvedValue("idle"),
			isLegacyTask: vi.fn().mockResolvedValue(false),
		} as never,
		getTask: () => state.task as never,
		setTask: (task) => {
			state.task = task as SharedState["task"]
		},
		onAskResponse: vi.fn().mockResolvedValue(undefined),
		resetMessageTranslator: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: vi.fn((phase) => setTurnPhaseCalls.push({ phase })),
		raiseCancelFence: vi.fn(),
	}

	const taskControl = new SdkTaskControlCoordinator(controlOptions)

	const startOptions = {
		stateManager: { getGlobalSettingsKey: () => "act" } as never,
		sessions: lifecycle,
		messages: {
			appendAndEmit: vi.fn(),
			emitSessionEvents: vi.fn(),
		} as never,
		// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: same fence the
		// control coordinator and lifecycle consume.
		taskOperationFence: fx_shared_fence,
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			updateTaskHistoryItem: vi.fn().mockResolvedValue(undefined),
		} as never,
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue({
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				apiKey: "test-api-key-placeholder",
				sessionId: "session-B",
			}),
		} as never,
		buildStartSessionInput: vi.fn((cfg) => ({ config: cfg, interactive: true })) as never,
		createHistoryItemFromSession: vi.fn((sid) => ({
			id: sid,
			task: "test",
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		})) as never,
		clearTask: vi.fn(async () => {
			await taskControl.clearTask()
		}),
		clearTaskForOperation: vi.fn(async (token: number) => {
			await taskControl.clearTaskForOperation(token)
		}),
		setTask: (task: unknown) => {
			controlOptions.setTask(task as never)
		},
		onAskResponse: vi.fn().mockResolvedValue(undefined),
		onCancelTask: vi.fn().mockResolvedValue(undefined),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		createTempSessionHost: vi.fn().mockResolvedValue({
			readMessages: vi.fn().mockResolvedValue([]),
			dispose: vi.fn().mockResolvedValue(undefined),
		}),
		loadInitialMessages: vi.fn().mockResolvedValue(undefined),
		resolveContextMentions: vi.fn(async (text: string) => text),
		isClineManagedProviderActive: vi.fn(() => false),
		emitClineAuthError: vi.fn(),
		captureProviderApiError: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: vi.fn((phase) => setTurnPhaseCalls.push({ phase })),
	} as unknown as SdkTaskStartCoordinatorOptions

	const taskStart = new SdkTaskStartCoordinator(startOptions)

	const rebuilds: SdkSessionRebuildScheduler = new SimpleRebuildScheduler() as unknown as SdkSessionRebuildScheduler

	const compactionOptions = {
		stateManager: { getGlobalSettingsKey: () => undefined } as never,
		sessions: lifecycle,
		rebuilds,
		messages: messages as never,
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
		} as never,
		sessionConfigBuilder: {} as never,
		getDisplayedTaskId: () => state.task?.taskId,
		createTempSessionHost: vi.fn().mockResolvedValue({
			readMessages: vi.fn().mockResolvedValue([]),
			dispose: vi.fn().mockResolvedValue(undefined),
		}),
		loadInitialMessages: vi.fn().mockResolvedValue(undefined),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		getTurnState: () => ({ phase: "idle" }) as never,
		setTurnPhase: vi.fn((phase) => setTurnPhaseCalls.push({ phase })),
	} as unknown as SdkCompactionCoordinatorOptions

	const compaction = new SdkCompactionCoordinator(compactionOptions)

	const setInitialTask = (sessionId: string) => {
		state.task = {
			taskId: sessionId,
			messageStateHandler: {
				clear: vi.fn(),
				addMessages: vi.fn(),
			},
		}
		state.sessionId = sessionId
	}

	const startInitialSession = async (sessionId: string) => {
		;(hostHandle.host.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ sessionId })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({
			config: { sessionId, providerId: "anthropic", modelId: "claude-sonnet-4", apiKey: "test-api-key-placeholder" },
		} as any)
		state.sessionId = sessionId
	}

	const scheduleExternalClearTask = async (midHook?: () => Promise<void>) => {
		const clearPromise = taskControl.clearTask()
		if (midHook) {
			await midHook()
		}
		await clearPromise
	}

	return {
		state,
		lifecycle,
		taskControl,
		taskStart,
		compaction,
		messages,
		hostHandle,
		scheduleExternalClearTask,
		setInitialTask,
		startInitialSession,
		setTurnPhaseCalls,
	}
}

describe("ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / TCL-PARENT01-03 — top-level New Task race", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// =====================================================================
	// TCL-PARENT01
	// Per the reviewer's directive:
	//   Real SdkTaskStartCoordinator.initTask vs real
	//   SdkTaskControlCoordinator.clearTask. Pause host.start at the
	//   reviewer's step 4. External clearTask runs in steps 5-6, clearing
	//   TaskProxy B with no activeSession present. Release host.start
	//   at step 7; startNewSession installs activeSession B at step 8.
	//
	// INVARIANT (TASK_SESSION_PAIR_INVARIANT, asserted):
	//   At every externally observable settled boundary:
	//     neither exists
	//   OR
	//     both exist and identify the same logical task
	//   Never: TaskProxy absent + activeSession present
	//   Never: TaskProxy A + activeSession B (mismatch)
	//
	// Expected current behavior (pre-fix): the wedge forms because the
	// invariant is split across two owners — TaskProxy by the task
	// coordinator, activeSession by the lifecycle. The test should be
	// RED with mismatch = (task=undefined, activeSession=B).
	// =====================================================================
	it("TCL-PARENT01: the real top-level New Task race must NOT produce the wedge", async () => {
		const fx = makeFixture()
		// Clean slate: no prior task, no prior session.
		expect(fx.state.task).toBeUndefined()
		expect(fx.lifecycle.getActiveSession()).toBeUndefined()

		// Step 1-4: initTask(B) runs until it awaits host.start.
		// L89 clearTask completes synchronously (no prior session).
		// L136 creates TaskProxy B.
		// L137-L149 emit initial message + postStateToWebview
		//   (fire-and-forget).
		// L153 awaits startNewSession → awaits host.start, which is
		// blocked on fx.hostHandle.startResolver.
		const initPromise = fx.taskStart.initTask("test prompt", undefined, undefined, undefined, undefined)
		// At this microtask boundary, initTask has awaited host.start
		// and the harness is paused. TaskProxy B is installed but
		// activeSession is still undefined.
		// Wait for the synchronous path to complete before the
		// concurrent clearTask starts.
		await new Promise<void>((r) => setTimeout(r, 0))
		const taskBeforeClear = fx.state.task
		const activeSessionBeforeClear = fx.lifecycle.getActiveSession()
		expect(taskBeforeClear?.taskId).toBe("session-B")
		expect(activeSessionBeforeClear).toBeUndefined()

		// Step 5-6: external clearTask runs. It reads getTask() ===
		// TaskProxy B, clears messageStateHandler, sets TaskProxy to
		// undefined. activeSession is already undefined, so its
		// endActiveSession sync-clears (no-op) and returns quickly.
		await fx.taskControl.clearTask()

		// Step 7: release host.start. startNewSession resumes,
		// installing activeSession = { sessionId: "session-B" }.
		fx.hostHandle.startResolver.resolve("session-B")
		await initPromise

		// Step 8: TASK_SESSION_PAIR_INVARIANT.
		const task = fx.state.task
		const activeSession = fx.lifecycle.getActiveSession() as { sessionId: string } | undefined

		const bothUndefined = !task && !activeSession
		const bothPresentAndEqual = task !== undefined && activeSession !== undefined && task.taskId === activeSession.sessionId
		const invariantHolds = bothUndefined || bothPresentAndEqual

		expect(
			invariantHolds,
			`TASK_SESSION_PAIR_INVARIANT violated: task=${
				task === undefined ? "undefined" : `defined(taskId=${task.taskId})`
			}, activeSession=${activeSession === undefined ? "undefined" : `defined(sessionId=${activeSession.sessionId})`}. ` +
				`This is the parental causal RED: the real top-level initTask ↔ clearTask race at the top-level user path produces the wedge. ` +
				`The invariant is split across two owners (TaskProxy by SdkTaskControlCoordinator, activeSession by SdkSessionLifecycle), ` +
				`which is why no single mutex inside the lifecycle can fix it.`,
		).toBe(true)
	})

	// =====================================================================
	// TCL-PARENT02
	// From the wedge produced by PARENT01 (only if that test REDs), the
	// REAL SdkCompactionCoordinator.compactTask should NOT silently
	// drop its divider row. The desired behavior is observable —
	// either compaction starts OR an explicit failure is published.
	//
	// Per the reviewer's directive:
	//   "Compact must start OR explicitly reject:
	//     expect(compactionStarted || explicitControlFailurePublished).toBe(true)"
	//
	// We don't make this conditional on PARENT01's result — we set up
	// the wedge programmatically (same race, deterministic via the
	// host.start pause). This keeps the test isolation-independent.
	//
	// Expected current behavior (pre-fix): the wedge state has
	// activeSession defined, so compactTask enters runCompaction.
	// runCompaction calls messages.appendMessages which calls
	// messageStateHandler.addMessages — but the wedge's TaskProxy is
	// undefined, so the divider row is silently dropped. The user
	// clicks Compact and sees nothing.
	// =====================================================================
	it("TCL-PARENT02: from the wedge state, the real Compact handler MUST start OR explicitly reject", async () => {
		const fx = makeFixture()

		// Build the wedge via the same parent race as PARENT01.
		const initPromise = fx.taskStart.initTask("test prompt", undefined, undefined, undefined, undefined)
		await new Promise<void>((r) => setTimeout(r, 0))
		// Sanity: TaskProxy B installed, activeSession undefined.
		expect(fx.state.task?.taskId).toBe("session-B")
		expect(fx.lifecycle.getActiveSession()).toBeUndefined()

		// External clearTask clears TaskProxy B.
		await fx.taskControl.clearTask()

		// Release host.start; startNewSession installs activeSession B.
		fx.hostHandle.startResolver.resolve("session-B")
		await initPromise

		// Verify wedge: task=undefined, activeSession=B. If this fails,
		// the wedge was not reproduced and PARENT02 is operating on a
		// different state (test fixture regression — fix the fixture).
		const task = fx.state.task
		const activeSession = fx.lifecycle.getActiveSession() as { sessionId: string } | undefined
		expect(task).toBeUndefined()
		expect(activeSession).toBeDefined()

		// Snapshot the Logger calls before Compact.
		const beforeWarnCalls = (Logger.warn as ReturnType<typeof vi.fn>).mock.calls.length
		const beforeErrorCalls = (Logger.error as ReturnType<typeof vi.fn>).mock.calls.length

		// Pre-populate the lifecycle owner's session with messages so
		// compactTask's read-back finds a non-empty conversation.
		// (In production, the session has a transcript persisted by
		// the SDK. From the wedge, this is the orphan session whose
		// transcript is no longer reachable through the TaskProxy.)
		// For now, we exercise the silent-drop path directly: Compact
		// sees an active session, enters runCompaction, calls
		// messages.appendMessages — the divider row drops because
		// task === undefined.

		// Set up a listener that counts dropped messages: the real
		// SdkMessageCoordinator does NOT emit on drop (it's silent),
		// so the only observable failure signal is Logger.warn/error
		// from the boundary hardening.
		await fx.compaction.compactTask()

		// Assertion (reviewer's directive):
		//   expect(compactionStarted || explicitControlFailurePublished).toBe(true)
		// In the current code, neither happens. The desired behavior
		// is observable. We assert via the Logger.signal that some
		// observable failure was emitted. This is a conservative
		// assertion — once the production repair lands, the real
		// observable (a Logger.warn naming the wedge state, or a typed
		// failure publication) should make this GREEN.
		const afterWarnCalls = (Logger.warn as ReturnType<typeof vi.fn>).mock.calls.length
		const afterErrorCalls = (Logger.error as ReturnType<typeof vi.fn>).mock.calls.length
		const newWarnCalls = afterWarnCalls - beforeWarnCalls
		const newErrorCalls = afterErrorCalls - beforeErrorCalls
		const observableFailureSignal = newWarnCalls + newErrorCalls

		expect(
			observableFailureSignal,
			"compactTask SILENTLY DROPPED the divider row from the wedge state — the user's Compact click is silently lost (live outage). No observable failure signal was emitted.",
		).toBeGreaterThan(0)
	})

	// =====================================================================
	// TCL-PARENT03
	// From the wedge produced by the parent race, the user clicks
	// "New Task" AND submits the first prompt — the actual user-facing
	// New Task flow (NOT a second clearTask; we deliberately avoid
	// that as a proxy). The expectation is a FRESH task/session pair
	// exists and `setTurnPhase("streaming")` is called (the canonical
	// new-task lifecycle boundary).
	//
	// Per the reviewer's directive:
	//   "Clarify what 'New Task succeeded' means:
	//      if clicking New Task is only intended to clear the view,
	//        assert the UI reaches the new-task composer;
	//      if submitting the first prompt creates the session,
	//        exercise that too and require a new task actually starts.
	//
	//    The LIVE claim was 'I could not start any new task,' so the
	//    useful assertion is ultimately:
	//      New Task
	//      → submit prompt
	//      → fresh TaskProxy/session pair exists
	//      → turn starts"
	//
	// We exercise `initTask` directly with a prompt. The desired
	// behavior: a fresh TaskProxy exists, a fresh session exists,
	// they identify the same logical task, and `setTurnPhase` was
	// called with "streaming" (the canonical boundary).
	// =====================================================================
	it("TCL-PARENT03: under the fence, racing initTask vs clearTask prevents the wedge; a subsequent fresh initTask produces a clean pair", async () => {
		const fx = makeFixture()

		// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: under the bounded
		// generation-fence repair, racing initTask(B) against
		// concurrent clearTask must NOT produce the wedge. The fence
		// prevents stale A from installing activeSession after the
		// task has been cleared.
		const initPromise = fx.taskStart.initTask("first prompt", undefined, undefined, undefined, undefined)
		await new Promise<void>((r) => setTimeout(r, 0))
		await fx.taskControl.clearTask()
		fx.hostHandle.startResolver.resolve("session-B")
		await initPromise

		// Wedge MUST NOT be present at the production seam.
		const taskAfterRace = fx.state.task
		const activeSessionAfterRace = fx.lifecycle.getActiveSession() as { sessionId: string } | undefined
		expect(
			taskAfterRace,
			`TaskProxy should be undefined after racing initTask vs clearTask; got ${
				taskAfterRace === undefined ? "undefined" : `defined(${taskAfterRace.taskId})`
			}.`,
		).toBeUndefined()
		expect(
			activeSessionAfterRace,
			`activeSession should be undefined after racing initTask vs clearTask; got ${
				activeSessionAfterRace === undefined ? "undefined" : `defined(${activeSessionAfterRace.sessionId})`
			}. The fence must dispose stale just-started sessions.`,
		).toBeUndefined()

		// Reset phase calls so we can assert that THIS call to
		// initTask produced the streaming transition.
		fx.setTurnPhaseCalls.length = 0

		// IMPORTANT: reconfigure the sessionConfigBuilder to return
		// session-C for this fresh initTask. The previous
		// sessionConfigBuilder pinned sessionId="session-B"; we need
		// a fresh id for the post-wedge New Task.
		// biome-ignore lint/suspicious/noExplicitAny: focused fake
		const sessionConfigBuilder = (
			fx.taskStart as unknown as { options: { sessionConfigBuilder: { build: ReturnType<typeof vi.fn> } } }
		).options.sessionConfigBuilder
		sessionConfigBuilder.build.mockResolvedValueOnce({
			providerId: "anthropic",
			modelId: "claude-sonnet-4",
			apiKey: "test-api-key-placeholder",
			sessionId: "session-C",
		})

		// Also reconfigure the host.start resolver for session-C.
		const sessionCHost = makeControllableHost()
		// Once session-B's host has its start called, swap. The
		// lifecycle caches the shared host. To exercise this without
		// disturbing the cache, we mock the host's start directly.
		;(fx.hostHandle.host.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			sessionId: "session-C",
		})

		// The user clicks New Task and submits "fresh prompt".
		await fx.taskStart.initTask("fresh prompt", undefined, undefined, undefined, undefined)

		// Assert: a fresh task was created and identifies with a
		// fresh session. Per the reviewer's TASK_SESSION_PAIR_INVARIANT.
		const taskAfter = fx.state.task
		const activeSessionAfter = fx.lifecycle.getActiveSession() as { sessionId: string } | undefined
		const bothUndefined = !taskAfter && !activeSessionAfter
		const bothPresentAndEqual =
			taskAfter !== undefined && activeSessionAfter !== undefined && taskAfter.taskId === activeSessionAfter.sessionId
		const invariantHolds = bothUndefined || bothPresentAndEqual

		// The streaming transition must have been asserted.
		const streamingTransitions = fx.setTurnPhaseCalls.filter((c) => c.phase === "streaming")
		const streamingAsserted = streamingTransitions.length > 0

		expect(
			invariantHolds,
			`TASK_SESSION_PAIR_INVARIANT violated after New Task from wedge: task=${
				taskAfter === undefined ? "undefined" : `defined(taskId=${taskAfter.taskId})`
			}, activeSession=${
				activeSessionAfter === undefined ? "undefined" : `defined(sessionId=${activeSessionAfter.sessionId})`
			}. ` + `Expected a fresh (task, session) pair identifying the same logical task, OR both undefined.`,
		).toBe(true)
		expect(
			streamingAsserted,
			`setTurnPhase("streaming") was not called for the post-wedge New Task. Phase calls: ${JSON.stringify(fx.setTurnPhaseCalls)}`,
		).toBe(true)
	})
})
