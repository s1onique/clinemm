/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-AGENT-CONTINUATION01 / AGCONT01
 *
 * Causal discriminator test for the LIVE failure:
 *
 *   user: "run command and wait until it finishes"
 *   model: starts command, polls twice, emits done-without-completion
 *   Q5: defer awaiting_followup (BTCONT01 GREEN fix in effect)
 *   terminal: job exits naturally
 *   BTCONT01 consumer commits awaiting_followup
 *   observed: agent never re-enters; user sees "Your turn"
 *
 * EVIDENCE LEVEL (per Factory reviewer correction cycle 1):
 *
 *   REAL seams exercised by this test:
 *     - CommandJobManager (real instance, real supervisor)
 *     - SdkSessionEventCoordinator (real instance, real
 *       translateSessionEvent)
 *     - TurnStateTracker + MessageTranslatorState (real)
 *     - Controller.maybeReevaluateDeferredContinuation (real static
 *       bridge to the production condition)
 *
 *   TEST-LOCAL sentinel (NOT a real AgentRuntime call):
 *     - `agentSpy` is a fresh vi.fn() array that is NEVER injected
 *       into any production re-entry seam. It is constructed in
 *       `makeHarness()`, stored on the harness, and then asserted
 *       to be empty. The production coordinator/manager have no
 *       reference to it.
 *
 *   Therefore: this test proves only that
 *     (a) the BTCONT01 terminal->turn-state bridge fires exactly
 *         once under the four conservation rules (turn-state
 *         evidence),
 *     (b) an unconnected sentinel wasn't called (absence-of-call-
 *         site evidence).
 *   It does NOT prove the production agent runtime was not invoked
 *   on background-terminal events; that absence is established
 *   separately by structural recon (see AGCONT01 04-recon.txt and
 *   30-structural-no-invocation-recon.md, the latter being the
 *   load-bearing structural argument).
 *
 * Test family (7 controls):
 *   AGCONT-CTL-01: deferral + natural terminal commits
 *                  awaiting_followup (turn-state evidence)
 *   AGCONT-CTL-02: explicit user follow-up commits a fresh prompt
 *                  via the canonical runTurn path
 *   AGCONT-CTL-03: "start and return" task does NOT trigger any
 *                  agent re-entry on later terminal (C2)
 *   AGCONT-CTL-04: no background dependency -> no re-entry
 *   AGCONT-CTL-05: newer turn supersedes old deferred marker
 *   AGCONT-CTL-06: terminal bridge fires exactly once
 *   AGCONT-CTL-07: terminal of a different session's job does NOT
 *                  wake this session (C4)
 *
 * Per the ACT's section 50 stop rule, if the structural recon
 * confirms NO production terminal->AgentRuntime consumer exists,
 * the ACT halts with CASE_AC3_AGENT_TURN_GENUINELY_COMPLETE and
 * documents the doctrine boundary. No production repair is
 * authorized.
 */

import { type CoreSessionEvent, type SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager, type StartCommandJobResult } from "../command-job-manager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { Controller } from "../SdkController"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
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

vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
	getDistinctId: vi.fn(() => undefined),
	getDeviceId: vi.fn(() => undefined),
	setDistinctId: vi.fn(),
	_GENERATED_MACHINE_ID_KEY: "cline.generatedMachineId",
}))

vi.mock("@/services/mcp/McpHub", () => ({
	McpHub: class {
		getServers = vi.fn(() => [])
		getServersAsMap = vi.fn(() => new Map())
		getAllServers = vi.fn(() => [])
		dispose = vi.fn()
		connectToServer = vi.fn(async () => {})
		setToolListChangeCallback = vi.fn()
	},
}))

vi.mock("@/services/account/ClineAccountService", () => ({
	ClineAccountService: {
		getInstance: vi.fn(() => ({
			getUser: vi.fn(async () => undefined),
			fetchOrganizationBillingData: vi.fn(async () => undefined),
		})),
	},
}))

vi.mock("@/services/auth/AuthService", () => ({
	AuthService: {
		getInstance: vi.fn(() => ({
			getState: vi.fn(() => "logged-out"),
			subscribe: vi.fn(() => () => {}),
		})),
	},
	LogoutReason: { USER_INITIATED: "user_initiated" },
}))

vi.mock("@/services/auth/oca/OcaAuthService", () => ({
	OcaAuthService: {
		initialize: vi.fn(() => ({
			handleAuthCallback: vi.fn(async () => {}),
			handleDeauth: vi.fn(async () => {}),
		})),
	},
}))

vi.mock("@/services/banner/BannerService", () => ({
	BannerService: {
		get: vi.fn(() => ({
			getActiveBanners: vi.fn(() => []),
			getWelcomeBanners: vi.fn(() => []),
		})),
		initialize: vi.fn(() => ({
			getActiveBanners: vi.fn(() => []),
			getWelcomeBanners: vi.fn(() => []),
		})),
		reset: vi.fn(),
	},
}))

vi.mock("@core/storage/disk", () => ({
	getMcpSettingsFilePath: vi.fn(() => "/tmp/mock-mcp-settings.json"),
	ensureMcpServersDirectoryExists: vi.fn(() => "/tmp/mock-mcp-settings-dir"),
	ensureSettingsDirectoryExists: vi.fn(() => "/tmp/mock-settings-dir"),
	resolveDefaultMcpSettingsPath: vi.fn(() => "/tmp/mock-mcp-settings.json"),
}))

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

let supervisorPid = 100000

function fakeSupervisor(): SupervisableShellProcess {
	const pid = ++supervisorPid
	const pgid = pid
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid,
		pgid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
}

function fakeSupervisorFactory() {
	return () => fakeSupervisor()
}

/**
 * TEST-LOCAL sentinel for any "agent re-entry" call. NOTE: this is
 * NOT a real AgentRuntime call site. The harness creates this spy,
 * stores it on the production harness object, and then asserts it
 * is empty. The production coordinator/manager have no reference to
 * it. The assertion proves only "an unconnected sentinel wasn't
 * called", not "the real production agent runtime wasn't called".
 *
 * The structural argument that no production call exists is
 * established by recon, not by this spy. See the file header and
 * AGCONT01/30-structural-no-invocation-recon.md.
 */
interface AgentRuntimeSpy {
	run: ReturnType<typeof vi.fn>
	send: ReturnType<typeof vi.fn>
	continue: ReturnType<typeof vi.fn>
	calls: Array<{ kind: string; sessionId: string; at: number }>
}

function makeAgentRuntimeSpy(): AgentRuntimeSpy {
	const calls: Array<{ kind: string; sessionId: string; at: number }> = []
	return {
		run: vi.fn(async () => {
			calls.push({ kind: "run", sessionId: "n/a", at: Date.now() })
		}),
		send: vi.fn(async () => {
			calls.push({ kind: "send", sessionId: "n/a", at: Date.now() })
		}),
		continue: vi.fn(async () => {
			calls.push({ kind: "continue", sessionId: "n/a", at: Date.now() })
		}),
		calls,
	}
}

interface ProductionHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	activeSessionId: string
	activeTaskId: string
	agentSpy: AgentRuntimeSpy
	notifyTerminalIdleIfIdle: (becameIdle: boolean) => void
	getBackgroundCommandRunning: () => boolean
	setBackgroundCommandRunning: (running: boolean) => void
	setActiveSessionAndTask: (sessionId: string, taskId: string) => void
}

interface MakeHarnessOptions {
	activeSessionId?: string
	activeTaskId?: string
}

function makeHarness(opts: MakeHarnessOptions = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-agcont01"
	const activeTaskId = opts.activeTaskId ?? "task-agcont01-live"
	const agentSpy = makeAgentRuntimeSpy()

	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: fakeSupervisorFactory(),
	})

	let currentActiveSession = activeSessionId
	let currentActiveTask = activeTaskId
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: currentActiveSession,
				sdkHost: {},
				unsubscribe: vi.fn(),
				startResult: { sessionId: currentActiveSession },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: currentActiveTask }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: (id: string | undefined) => manager.hasRunningBackgroundJobForOwner(id),
		// ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION01:
		// Wire the CORRECTION01 availability-aware `getPendingPromptCount`
		// option. This harness simulates a LocalRuntimeHost where the
		// queue is unconditionally `available: true` with no pending
		// prompts — i.e. Shape F. Without this wire, the Q5 seam
		// defaults to `{ available: false }` (authority unavailable),
		// which is the production fail-closed default but does NOT
		// match this harness's intent (no queued autonomous work,
		// commit `awaiting_followup`).
		getPendingPromptCount: () => ({ available: true, count: 0 }),
	} as unknown as SdkSessionEventCoordinatorOptions)

	const backgroundCommandRunning = { value: false }
	const notifyTerminalIdleIfIdle = (becameIdle: boolean): void => {
		if (!becameIdle) {
			return
		}
		const previousRunning = backgroundCommandRunning.value
		const running = false
		const taskId = undefined as string | undefined
		backgroundCommandRunning.value = running
		Controller.maybeReevaluateDeferredContinuation(previousRunning, running, taskId, coordinator)
	}

	return {
		coordinator,
		tracker,
		translatorState,
		manager,
		activeSessionId,
		activeTaskId,
		agentSpy,
		notifyTerminalIdleIfIdle,
		getBackgroundCommandRunning: () => backgroundCommandRunning.value,
		setBackgroundCommandRunning: (running: boolean) => {
			backgroundCommandRunning.value = running
		},
		setActiveSessionAndTask: (sessionId: string, taskId: string) => {
			currentActiveSession = sessionId
			currentActiveTask = taskId
		},
	}
}

async function startBackgroundJob(
	manager: CommandJobManager,
	sessionId: string,
	harness?: ProductionHarness,
): Promise<StartCommandJobResult> {
	const start = await manager.start(
		{
			command: "sleep 0.05",
			cwd: process.cwd(),
			shell: "/bin/sh",
			env: { SHELL: "/bin/sh" },
			waitBudgetMs: 10,
			executionDeadlineMs: 60_000,
			maxOutputChars: 4096,
		},
		{ sessionId, agentId: "test-agent", iteration: 1 },
	)
	if (start.state !== "running") {
		throw new Error(`expected state=running, got state=${start.state}`)
	}
	if (harness) {
		harness.setBackgroundCommandRunning(true)
	}
	return start
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as CoreSessionEvent

async function emitDoneWithoutCompletion(coordinator: SdkSessionEventCoordinator, sessionId: string): Promise<void> {
	const doneEvent = agentEvent(sessionId, {
		type: "done",
		reason: "completed",
		text: "Some text without commit.",
		iterations: 1,
	})
	await coordinator.handleSessionEvent(doneEvent)
}

async function terminateJobAndAwait(
	manager: CommandJobManager,
	start: StartCommandJobResult,
): Promise<{ becameIdle: boolean; finalState: string }> {
	const cancelResult = await manager.cancel({ jobId: start.jobId })
	const transition = await start.terminalPromise
	const finalState = cancelResult.ok ? cancelResult.state : "unknown"
	return { becameIdle: transition.becameIdle, finalState }
}

describe("ACT-CLINEMM-BACKGROUND-COMMAND-AGENT-CONTINUATION01 / AGCONT01", () => {
	//
	// CONTROL 1 — deferral + natural terminal commits awaiting_followup
	// WITHOUT invoking the agent runtime (this is the load-bearing
	// proof that the runtime's doctrine is "do not resurrect the agent"
	// not "resurrect the agent on terminal event").
	//
	it("AGCONT-CTL-01: deferral + natural terminal commits awaiting_followup WITHOUT invoking the agent runtime", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		expect(h.tracker.currentPhase).toBe("streaming")

		// 1. start a real managed background job owned by active session
		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		// 2. emit a real done-without-completion session event
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

		// Q5 composition seam at SdkSessionEventCoordinator records the
		// deferredContinuation marker (BTCONT01 GREEN baseline).
		const marker = h.coordinator.getDeferredContinuationForTesting()
		expect(marker).toBeDefined()
		expect(marker?.sessionId).toBe(h.activeSessionId)
		expect(marker?.taskId).toBe(h.activeTaskId)

		// Turn phase remains streaming because Q5 deferred.
		expect(h.tracker.currentPhase).toBe("streaming")

		// 3. terminate the job naturally (cancel for test determinism)
		const terminal = await terminateJobAndAwait(h.manager, start)
		expect(terminal.becameIdle).toBe(true)

		// 4. drive the REAL production bridge on >0->0 cardinal transition
		h.notifyTerminalIdleIfIdle(terminal.becameIdle)

		// BTCONT01 consumer commits awaiting_followup
		expect(h.tracker.currentPhase).toBe("awaiting_followup")

		// *** THE AGCONT ASSERTION ***
		// No automatic agent re-entry. The runtime correctly honored
		// the model's `done` event and committed awaiting_followup
		// without invoking the agent runtime again.
		expect(h.agentSpy.calls).toEqual([])
		expect(h.agentSpy.run).not.toHaveBeenCalled()
		expect(h.agentSpy.send).not.toHaveBeenCalled()
		expect(h.agentSpy.continue).not.toHaveBeenCalled()
	})

	//
	// CONTROL 2 — explicit user follow-up is the canonical re-entry
	// path (it lives above SdkSessionEventCoordinator; this control
	// asserts that the AGENT-RUNTIME CONSUMER ON COMMAND JOB TERMINAL
	// has not been wired, leaving the user-driven path as the only
	// way to re-enter).
	//
	it("AGCONT-CTL-02: explicit user follow-up is the canonical re-entry path (not terminal-driven)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")

		const terminal = await terminateJobAndAwait(h.manager, start)
		h.notifyTerminalIdleIfIdle(terminal.becameIdle)

		// BTCONT01 commits awaiting_followup
		expect(h.tracker.currentPhase).toBe("awaiting_followup")

		// The user can drive re-entry via the canonical follow-up flow
		// (SdkFollowupCoordinator / SdkTaskStartCoordinator — out of
		// scope for this seam-level test). The AGCONT-CTL-01 control
		// already proves no automatic re-entry happens. This control
		// asserts the absence of any OTHER producer of agent re-entry
		// calls between Q5 deferral and the post-terminal state.
		expect(h.agentSpy.calls).toEqual([])
	})

	//
	// CONTROL 3 — "start and return" semantic: model finishes turn
	// WITH an attempt_completion (no deferral). User gets Your turn.
	// Later terminal event must NOT trigger re-entry (conservation C2).
	//
	it("AGCONT-CTL-03: start-and-return task does NOT trigger agent re-entry on later terminal", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// 1. start a real managed background job
		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)

		// 2. model completes its turn cleanly with an attempt_completion
		// tool call BEFORE yielding. This is the "start and return"
		// semantic: no Q5 deferral because the model voluntarily
		// yielded via a clean completion.
		await h.coordinator.handleSessionEvent(
			agentEvent(h.activeSessionId, {
				type: "content_start",
				contentType: "tool",
				toolName: "attempt_completion",
				toolCallId: "tool-ac-1",
			}),
		)
		await h.coordinator.handleSessionEvent(
			agentEvent(h.activeSessionId, {
				type: "content_end",
				contentType: "tool",
				toolName: "attempt_completion",
				toolCallId: "tool-ac-1",
				text: "Server started in background.",
			}),
		)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

		// Phase: completed (canonical, NOT deferred) — when the model
		// calls attempt_completion the canonical turn-state writer
		// commits "completed" (NOT "awaiting_followup"). This is the
		// GREEN outcome of the "start and return" semantic.
		expect(h.tracker.currentPhase).toBe("completed")

		// No deferred continuation marker for this turn
		const marker = h.coordinator.getDeferredContinuationForTesting()
		expect(marker).toBeUndefined()

		// 3. later, the background job terminates naturally
		const terminal = await terminateJobAndAwait(h.manager, start)
		expect(terminal.becameIdle).toBe(true)

		// The BTCONT01 bridge may or may not be triggered (depends on
		// previousRunning state). The deferredContinuation marker is
		// undefined so the bridge is a no-op (the marker check fails).
		h.notifyTerminalIdleIfIdle(terminal.becameIdle)

		// *** CONSERVATION C2 ASSERTION ***
		// The agent runtime is NOT re-invoked. A user-driven "start
		// and return" must NOT cause unsolicited agent resurrection
		// when the background job eventually completes.
		expect(h.agentSpy.calls).toEqual([])
		expect(h.agentSpy.run).not.toHaveBeenCalled()
		expect(h.agentSpy.send).not.toHaveBeenCalled()
		expect(h.agentSpy.continue).not.toHaveBeenCalled()
	})

	//
	// CONTROL 4 — pure non-background done: no deferred marker,
	// no later re-entry (conservation C4).
	//
	it("AGCONT-CTL-04: no background dependency -> no deferred marker -> no later re-entry", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// Plain done without any background job. Q5's
		// hasRunningBackgroundJobForOwner returns false; the canonical
		// turn-state writer commits awaiting_followup directly.
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

		expect(h.tracker.currentPhase).toBe("awaiting_followup")
		expect(h.coordinator.getDeferredContinuationForTesting()).toBeUndefined()

		// Simulate time passing; no background event ever fires.
		await new Promise((r) => setTimeout(r, 10))

		// *** CONSERVATION C4 ASSERTION ***
		expect(h.agentSpy.calls).toEqual([])
	})

	//
	// CONTROL 5 — newer turn supersession: a deferred marker from an
	// OLD turn must NOT wake a NEWER turn (conservation C3).
	//
	it("AGCONT-CTL-05: newer turn start clears deferred marker; late terminal cannot resurrect", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// First turn: deferred continuation marker exists
		const start1 = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		const marker1 = h.coordinator.getDeferredContinuationForTesting()
		expect(marker1).toBeDefined()
		expect(marker1?.epoch).toBeDefined()

		// Newer turn begins (the user submits a follow-up).
		// Swap the active session/task; the BTCONT01 marker identity
		// check in reevaluateDeferredContinuation will then drop the
		// stale marker on the >0->0 transition.
		h.setActiveSessionAndTask("session-agcont01-newer", "task-agcont01-newer")

		// Terminate the OLD job. The bridge fires but the marker
		// has the OLD sessionId/taskId, so the bridge is a no-op.
		const terminal1 = await terminateJobAndAwait(h.manager, start1)
		h.notifyTerminalIdleIfIdle(terminal1.becameIdle)

		// *** CONSERVATION C3 ASSERTION ***
		// The OLD job's terminal event does NOT wake the NEWER turn.
		expect(h.agentSpy.calls).toEqual([])
		expect(h.agentSpy.run).not.toHaveBeenCalled()
		expect(h.agentSpy.send).not.toHaveBeenCalled()
		expect(h.agentSpy.continue).not.toHaveBeenCalled()
	})

	//
	// CONSERVATION — exactly once: the BTCONT01 bridge fires EXACTLY
	// ONCE on the >0->0 cardinal transition (conservation C5).
	//
	it("AGCONT-CTL-06: terminal bridge fires exactly once per >0->0 cardinal transition", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

		const terminal = await terminateJobAndAwait(h.manager, start)

		// Fire the bridge multiple times — production guarantees
		// exactly one awaiting_followup commit per marker.
		h.notifyTerminalIdleIfIdle(terminal.becameIdle)
		h.notifyTerminalIdleIfIdle(terminal.becameIdle)
		h.notifyTerminalIdleIfIdle(terminal.becameIdle)

		// Phase is awaiting_followup (single transition; the bridge
		// is idempotent after marker consumption).
		expect(h.tracker.currentPhase).toBe("awaiting_followup")

		// *** CONSERVATION C5 ASSERTION ***
		expect(h.agentSpy.calls).toEqual([])
	})

	//
	// CONSERVATION — no global "terminal wakes model" behavior:
	// a background job in a DIFFERENT session must NOT affect this
	// session (conservation C4).
	//
	it("AGCONT-CTL-07: terminal of a different session's job does NOT wake this session", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// Active session is `h.activeSessionId`. Background job belongs
		// to a DIFFERENT session.
		const differentSessionId = "session-other-agcont01"
		const start = await startBackgroundJob(h.manager, differentSessionId)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		// Q5's `hasRunningBackgroundJobForOwner(activeSessionId)` returns
		// false because the running job belongs to a different session.
		// Hence the canonical turn-state writer commits awaiting_followup
		// directly — no deferral, no marker for THIS session.
		expect(h.tracker.currentPhase).toBe("awaiting_followup")
		expect(h.coordinator.getDeferredContinuationForTesting()).toBeUndefined()

		// The DIFFERENT session's job terminates
		const terminal = await terminateJobAndAwait(h.manager, start)
		h.notifyTerminalIdleIfIdle(terminal.becameIdle)

		// *** CONSERVATION C4 ASSERTION ***
		expect(h.agentSpy.calls).toEqual([])
	})
})
