// ============================================================================
// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01 / TCL-PARENT-ADVERSARIAL01
//
// RED CONTRACT for the bounded generation-fence repair (per Factory
// reviewer's CORRECTION03 directive, Phase 1):
//
//   "Add bounded adversarial cases:
//      A. init A superseded by clear
//      B. init A superseded by init B
//      C. clear during host.start
//      D. stale A host.start resolves AFTER B is current
//         → A must not replace B
//      E. stale-start cleanup failure
//         → B/current state still conserved; cleanup error observable"
//
// All five must be RED at HEAD (pre-fix). After Phase 2 (fence GREEN)
// they MUST be GREEN. After Phase 4 (ablation), case A must be RED
// again when the generation check is removed.
//
// CORRECTED PHASE 2 CONTRACT (per Factory reviewer's
// post-Phase1a design corrections):
//
//   1. Pass the originating generation token EXPLICITLY into
//      startNewSession. Do not have the lifecycle capture "current"
//      — stale A would otherwise adopt B's generation.
//
//   2. Do not let initTask's internal clearTask allocate a new
//      generation. One top-level intent gets one token; internal
//      steps inherit it.
//
//   3. A superseded init must NOT call global setTask(undefined).
//      That would erase B's TaskProxy in adversarial B/D. The stale
//      operation cleans up only resources it uniquely owns and
//      returns.
//
// INVARIANT (TASK_SESSION_PAIR_INVARIANT) is asserted at every
// settled boundary:
//   At externally settled task-control boundaries:
//     (task == none && activeSession == none)
//   OR
//     (task != none
//      && activeSession != none
//      && task.taskId == activeSession.sessionId)
//   A superseded async task start must never install either half of
//   an obsolete pair.
//
// All five tests use the production owner (REAL SdkTaskStartCoordinator
// + REAL SdkTaskControlCoordinator + REAL SdkSessionLifecycle) and a
// controllable host.start resolver, mirroring the parent test fixture.
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest"
import { Logger } from "@/shared/services/Logger"
import { SdkMessageCoordinator } from "../sdk-message-coordinator"
import { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import { SdkTaskControlCoordinator, type SdkTaskControlCoordinatorOptions } from "../sdk-task-control-coordinator"
import { SdkTaskStartCoordinator, type SdkTaskStartCoordinatorOptions } from "../sdk-task-start-coordinator"

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

interface HostHandle {
	host: {
		start: ReturnType<typeof vi.fn>
		subscribe: ReturnType<typeof vi.fn>
		send: ReturnType<typeof vi.fn>
		abort: ReturnType<typeof vi.fn>
		stop: ReturnType<typeof vi.fn>
		dispose: ReturnType<typeof vi.fn>
	}
	/** Manual resolvers queued in start() order. Each start() resolves the HEAD. */
	resolverQueue: Array<{ resolve: (sessionId: string) => void; promise: Promise<{ sessionId: string }> }>
}

function makeControllableHost(): HostHandle {
	const resolverQueue: HostHandle["resolverQueue"] = []
	return {
		host: {
			start: vi.fn().mockImplementation(() => {
				const entry = {
					resolve: (sessionId: string) => {},
					promise: Promise.resolve({ sessionId: "never-resolved" }),
				}
				resolverQueue.push(entry)
				entry.promise = new Promise<{ sessionId: string }>((resolve) => {
					entry.resolve = (sessionId) => resolve({ sessionId })
				})
				return entry.promise
			}),
			subscribe: vi.fn().mockReturnValue(vi.fn()),
			send: vi.fn().mockResolvedValue(undefined),
			abort: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		resolverQueue,
	}
}

interface SharedState {
	task?: {
		taskId: string
		messageStateHandler: { clear: ReturnType<typeof vi.fn>; addMessages: ReturnType<typeof vi.fn> }
	}
	sessionId?: string
}

interface AdversarialFixture {
	state: SharedState
	lifecycle: SdkSessionLifecycle
	taskControl: SdkTaskControlCoordinator
	taskStart: SdkTaskStartCoordinator
	messages: SdkMessageCoordinator
	hostHandle: HostHandle
	startOptions: { sessionConfigBuilder: { build: ReturnType<typeof vi.fn> } }
}

function makeFixture(): AdversarialFixture {
	const state: SharedState = {}

	const hostHandle = makeControllableHost()
	mockCreateSessionHost.mockResolvedValue(hostHandle.host)

	const lifecycle = new SdkSessionLifecycle({
		mcpHub: {} as never,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onSendComplete: vi.fn(),
		onSendError: vi.fn(),
	})

	const messages = new SdkMessageCoordinator({ getTask: () => state.task as never })

	const controlOptions: SdkTaskControlCoordinatorOptions = {
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
		setTurnPhase: vi.fn(),
		raiseCancelFence: vi.fn(),
	}

	const taskControl = new SdkTaskControlCoordinator(controlOptions)

	const startOptions = {
		stateManager: { getGlobalSettingsKey: () => "act" },
		sessions: lifecycle,
		messages: { appendAndEmit: vi.fn(), emitSessionEvents: vi.fn() },
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			updateTaskHistoryItem: vi.fn().mockResolvedValue(undefined),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue({
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				apiKey: "test-api-key-placeholder",
				sessionId: "session-A",
			}),
		},
		buildStartSessionInput: vi.fn((cfg) => ({ config: cfg, interactive: true })),
		createHistoryItemFromSession: vi.fn((sid) => ({
			id: sid,
			task: "test",
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		})),
		clearTask: vi.fn(async () => {
			await taskControl.clearTask()
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
		setTurnPhase: vi.fn(),
	} as unknown as SdkTaskStartCoordinatorOptions

	const taskStart = new SdkTaskStartCoordinator(startOptions)

	return {
		state,
		lifecycle,
		taskControl,
		taskStart,
		messages,
		hostHandle,
		startOptions: startOptions as unknown as { sessionConfigBuilder: { build: ReturnType<typeof vi.fn> } },
	}
}

/** Drain microtasks so initTask has reached the awaited host.start. */
async function awaitInitTaskPaused() {
	await new Promise<void>((r) => setTimeout(r, 0))
}

function expectInvariant(task: SharedState["task"], activeSession: { sessionId: string } | undefined) {
	const bothUndefined = !task && !activeSession
	const bothPresentAndEqual = task !== undefined && activeSession !== undefined && task.taskId === activeSession.sessionId
	return { ok: bothUndefined || bothPresentAndEqual, bothUndefined, bothPresentAndEqual }
}

describe("ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01 / TCL-PARENT-ADVERSARIAL01", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// ==========================================================================
	// ADVERSARIAL A — init A superseded by clear
	// Setup: initTask(A) begins; concurrent taskControl.clearTask runs
	// while A is awaiting host.start. A's start resolves AFTER clear.
	// Expected invariant after both settle:
	//   (task == none) && (activeSession == none)
	// ==========================================================================
	it("ADVERSARIAL A: init A superseded by clear must leave neither half installed", async () => {
		const fx = makeFixture()

		const initAPromise = fx.taskStart.initTask("prompt A", undefined, undefined, undefined, undefined)
		await awaitInitTaskPaused()
		expect(fx.state.task?.taskId).toBe("session-A")
		expect(fx.lifecycle.getActiveSession()).toBeUndefined()

		// Concurrent clear (the supersession).
		await fx.taskControl.clearTask()

		// Release host.start AFTER clear. Without the fence, initTask
		// would resume and install activeSession A while task is gone.
		const aResolver = fx.hostHandle.resolverQueue[0]
		aResolver.resolve("session-A")
		await initAPromise

		const task = fx.state.task
		const activeSession = fx.lifecycle.getActiveSession() as { sessionId: string } | undefined
		const inv = expectInvariant(task, activeSession)

		expect(
			inv.bothUndefined,
			`TASK_SESSION_PAIR_INVARIANT violated: A was not fenced off. task=${
				task === undefined ? "undefined" : `defined(${task.taskId})`
			}, activeSession=${
				activeSession === undefined ? "undefined" : `defined(${activeSession.sessionId})`
			}. The fence must prevent A from installing either half after a concurrent clear.`,
		).toBe(true)
	})
	// ==========================================================================
	// ADVERSARIAL B — init A superseded by init B
	// Setup: initTask(A) awaits host.start; initTask(B) supersedes.
	// B's clearTask runs, B's createAndSetTask installs TaskProxy B,
	// B awaits B's own host.start. A's host.start resolves AFTER B's
	// session is current.
	// Expected invariant:
	//   (task == task-B) && (activeSession == session-B)
	// ==========================================================================
	it("ADVERSARIAL B: init A superseded by init B must leave B current; A abandoned", async () => {
		const fx = makeFixture()

		const initAPromise = fx.taskStart.initTask("prompt A", undefined, undefined, undefined, undefined)
		await awaitInitTaskPaused()
		expect(fx.state.task?.taskId).toBe("session-A")
		expect(fx.lifecycle.getActiveSession()).toBeUndefined()

		// B supersedes A. Reconfigure sessionConfigBuilder for B.
		fx.startOptions.sessionConfigBuilder.build.mockResolvedValueOnce({
			providerId: "anthropic",
			modelId: "claude-sonnet-4",
			apiKey: "test-api-key-placeholder",
			sessionId: "session-B",
		})

		const initBPromise = fx.taskStart.initTask("prompt B", undefined, undefined, undefined, undefined)
		await awaitInitTaskPaused()

		expect(fx.state.task?.taskId).toBe("session-B")
		expect(fx.lifecycle.getActiveSession()).toBeUndefined()

		// Release B's host.start first.
		const bResolver = fx.hostHandle.resolverQueue[1]
		bResolver.resolve("session-B")
		await initBPromise

		expect(fx.state.task?.taskId).toBe("session-B")
		expect(fx.lifecycle.getActiveSession()?.sessionId).toBe("session-B")

		// NOW release A's host.start. Without the fence, A would
		// overwrite activeSession with session-A, breaking identity.
		const aResolver = fx.hostHandle.resolverQueue[0]
		aResolver.resolve("session-A")
		await initAPromise

		const task = fx.state.task
		const activeSession = fx.lifecycle.getActiveSession() as { sessionId: string } | undefined
		const inv = expectInvariant(task, activeSession)

		expect(
			inv.bothPresentAndEqual && task?.taskId === "session-B",
			`TASK_SESSION_PAIR_INVARIANT violated: A overwrote B. task=${
				task === undefined ? "undefined" : `defined(${task.taskId})`
			}, activeSession=${
				activeSession === undefined ? "undefined" : `defined(${activeSession.sessionId})`
			}. The fence must prevent A from installing session-A after B is current.`,
		).toBe(true)
	})

	// ==========================================================================
	// ADVERSARIAL C — clear during host.start
	// Setup: initTask begins; clear runs after initTask has incremented
	// but before its host.start resolves. Then initTask's host.start
	// resolves. Expected: neither half installed.
	// ==========================================================================
	it("ADVERSARIAL C: clear during host.start must leave neither half installed", async () => {
		const fx = makeFixture()

		const initAPromise = fx.taskStart.initTask("prompt A", undefined, undefined, undefined, undefined)
		await awaitInitTaskPaused()
		expect(fx.state.task?.taskId).toBe("session-A")

		const clearPromise = fx.taskControl.clearTask()
		await clearPromise

		// Task should be undefined at this point (clear ran).
		expect(fx.state.task).toBeUndefined()

		// Now resolve host.start. Without the fence, A's
		// createAndSetTask already ran BEFORE the clear, so the
		// wedge would form (task=undefined, activeSession=A).
		const aResolver = fx.hostHandle.resolverQueue[0]
		aResolver.resolve("session-A")
		await initAPromise

		const task = fx.state.task
		const activeSession = fx.lifecycle.getActiveSession() as { sessionId: string } | undefined
		const inv = expectInvariant(task, activeSession)

		expect(
			inv.bothUndefined,
			`TASK_SESSION_PAIR_INVARIANT violated: A's host.start resolved after clear, leaving an orphan session-A. task=${
				task === undefined ? "undefined" : `defined(${task.taskId})`
			}, activeSession=${activeSession === undefined ? "undefined" : `defined(${activeSession.sessionId})`}.`,
		).toBe(true)
	})
	// ==========================================================================
	// ADVERSARIAL D — stale A host.start resolves AFTER B is current
	// Setup: A awaits host.start. B fully completes (clears A,
	// installs B, sets activeSession=B). THEN A's host.start resolves.
	// Expected: B remains current; A does not replace.
	// ==========================================================================
	it("ADVERSARIAL D: stale A host.start resolves AFTER B is current must NOT replace B", async () => {
		const fx = makeFixture()

		const initAPromise = fx.taskStart.initTask("prompt A", undefined, undefined, undefined, undefined)
		await awaitInitTaskPaused()

		fx.startOptions.sessionConfigBuilder.build.mockResolvedValueOnce({
			providerId: "anthropic",
			modelId: "claude-sonnet-4",
			apiKey: "test-api-key-placeholder",
			sessionId: "session-B",
		})
		const initBPromise = fx.taskStart.initTask("prompt B", undefined, undefined, undefined, undefined)
		await awaitInitTaskPaused()

		const bResolver = fx.hostHandle.resolverQueue[1]
		bResolver.resolve("session-B")
		await initBPromise

		expect(fx.state.task?.taskId).toBe("session-B")
		expect(fx.lifecycle.getActiveSession()?.sessionId).toBe("session-B")

		// A's host.start NOW resolves. Without the fence, this would
		// clobber activeSession with session-A.
		const aResolver = fx.hostHandle.resolverQueue[0]
		aResolver.resolve("session-A")
		await initAPromise

		const task = fx.state.task
		const activeSession = fx.lifecycle.getActiveSession() as { sessionId: string } | undefined
		const inv = expectInvariant(task, activeSession)

		expect(
			inv.bothPresentAndEqual && task?.taskId === "session-B",
			`TASK_SESSION_PAIR_INVARIANT violated: stale A overwrote B. task=${
				task === undefined ? "undefined" : `defined(${task.taskId})`
			}, activeSession=${
				activeSession === undefined ? "undefined" : `defined(${activeSession.sessionId})`
			}. The fence must prevent late A resolution from replacing current B.`,
		).toBe(true)
	})

	// ==========================================================================
	// ADVERSARIAL E — stale-start cleanup failure
	// Setup: A's host.start resolves late. When the lifecycle tries
	// to dispose A's just-started session, sdkHost.stop() rejects.
	// B/current state MUST still be conserved; cleanup error MUST be
	// observable (Logger.warn).
	// ==========================================================================
	it("ADVERSARIAL E: stale-start cleanup failure must conserve B/current state; error observable", async () => {
		const fx = makeFixture()

		const initAPromise = fx.taskStart.initTask("prompt A", undefined, undefined, undefined, undefined)
		await awaitInitTaskPaused()

		fx.startOptions.sessionConfigBuilder.build.mockResolvedValueOnce({
			providerId: "anthropic",
			modelId: "claude-sonnet-4",
			apiKey: "test-api-key-placeholder",
			sessionId: "session-B",
		})
		const initBPromise = fx.taskStart.initTask("prompt B", undefined, undefined, undefined, undefined)
		await awaitInitTaskPaused()

		const bResolver = fx.hostHandle.resolverQueue[1]
		bResolver.resolve("session-B")
		await initBPromise
		expect(fx.state.task?.taskId).toBe("session-B")
		expect(fx.lifecycle.getActiveSession()?.sessionId).toBe("session-B")

		// Make A's cleanup fail: stop() rejects.
		const cleanupError = new Error("simulated host.stop failure")
		;(fx.hostHandle.host.stop as ReturnType<typeof vi.fn>).mockRejectedValueOnce(cleanupError)

		const beforeWarn = (Logger.warn as ReturnType<typeof vi.fn>).mock.calls.length
		const beforeError = (Logger.error as ReturnType<typeof vi.fn>).mock.calls.length

		const aResolver = fx.hostHandle.resolverQueue[0]
		aResolver.resolve("session-A")
		await initAPromise

		const task = fx.state.task
		const activeSession = fx.lifecycle.getActiveSession() as { sessionId: string } | undefined
		const inv = expectInvariant(task, activeSession)

		expect(
			inv.bothPresentAndEqual && task?.taskId === "session-B",
			`Cleanup failure corrupted B's state. task=${
				task === undefined ? "undefined" : `defined(${task.taskId})`
			}, activeSession=${activeSession === undefined ? "undefined" : `defined(${activeSession.sessionId})`}.`,
		).toBe(true)

		const afterWarn = (Logger.warn as ReturnType<typeof vi.fn>).mock.calls.length
		const afterError = (Logger.error as ReturnType<typeof vi.fn>).mock.calls.length
		const newDiagnostic = afterWarn - beforeWarn + (afterError - beforeError)

		expect(
			newDiagnostic,
			"stale-start cleanup failure did not surface a Logger.warn/error; the failure was silently swallowed.",
		).toBeGreaterThan(0)
	})
})
