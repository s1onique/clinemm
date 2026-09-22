/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01 / BTCONT01
 *
 * Reproduction + bounded repair test for the LIVE failure:
 *
 *   done-like session event for session S
 *   + hasRunningBackgroundJobForOwner(S) === true
 *   -> Q5 composition seam at SdkSessionEventCoordinator:265-378
 *      SUPPRESSES awaiting_followup (the BCAFG01 GREEN baseline)
 *   -> phase stays streaming
 *   -> later, asynchronously, the final matching managed
 *      background CommandJob reaches a terminal state
 *      (job_active_removed, becameIdle: true)
 *   -> NO canonical turn-state writer runs
 *   -> task remains stranded in phase=streaming indefinitely
 *
 * The LIVE specimen at task 1789935070156_oneah / job
 * cmd_mua94lrk2w8jyomn reproduced exactly this sequence; the
 * only path that unblocked the stranded streaming phase was a
 * manual operator-driven cancel + resume cycle (TSWPD writers
 * controller-cancel-task + controller-ask-response), proving
 * that the canonical Q5 logic is healthy and ONLY the
 * automatic continuation consumer is missing.
 *
 * Production seams under test:
 *   - CommandJobManager (the lifecycle producer + active-map owner)
 *   - SdkSessionEventCoordinator (the canonical Q5 owner)
 *   - TurnStateTracker (the canonical turn-phase store)
 *
 * What this test proves:
 *
 *   1. BTCONT-RED-01: starting a real background CommandJob owned
 *      by the active session, emitting a done-without-completion
 *      session event, then letting the same job reach a terminal
 *      state via its real terminalPromise WITHOUT sending another
 *      user/model/session event leaves phase=streaming forever.
 *      This is the defect.
 *
 *   2. BTCONT-CTL-01 (manual wake-up control): same setup, then
 *      drive a fresh done-like event after the job terminated -
 *      the canonical Q5 path must now commit awaiting_followup.
 *      This proves the completion logic is healthy; only the
 *      automatic continuation consumer is absent.
 *
 *   3. BTCONT-CTL-02 (job still running): deferral must persist
 *      while the matching job remains running.
 *
 *   4. BTCONT-CTL-03 (newer epoch supersedes): if a newer turn
 *      legitimately starts (phase=streaming owned by a different
 *      writer) after the deferral, a late terminal event for the
 *      old deferred continuation must not mutate the newer epoch.
 *
 *   5. BTCONT-CTL-05 (different session): an unrelated job in
 *      session B terminating must NOT affect session A's stranded
 *      deferral.
 *
 * Hypothesis mapping (per ACT section 11):
 *
 *   TC1 = missing terminal continuation consumer.
 *     Discriminator: BTCONT-RED-01 proves the terminal event
 *     never re-drives Q5. If the GREEN baseline (BTCONT-CTL-01)
 *     passes with the same wiring, the only missing piece is
 *     the continuation consumer.
 *
 *   TC2 = terminal event identity loss.
 *     Discriminator: BTCONT-CTL-05 proves the per-owner
 *     ownership identity is preserved end-to-end (a job owned
 *     by session B terminating does not affect session A).
 *     TC2 REFUTED.
 *
 *   TC3 = deferred continuation not represented.
 *     Discriminator: the GREEN-side implementation MUST record
 *     a bounded "deferredContinuation" fact (sessionId +
 *     epoch/generation) at Q5 deferral so the terminal listener
 *     can verify the deferred decision still applies. Without it,
 *     BTCONT-CTL-03 (newer epoch supersedes) cannot be enforced.
 *
 *   TC4 = continuation guard false-negative.
 *     Discriminator: BTCONT-CTL-02 must observe NO continuation
 *     while the matching job is still alive.
 *
 *   TC5 = terminal continuation authority split.
 *     Discriminator: production wiring places the canonical
 *     authority on the active session host's CommandJobManager;
 *     the terminalPromise is the race-safe cardinal signal.
 *
 *   TC6 = other proven cause.
 *     Discriminator: reserved.
 *
 * No production code is changed by this ACT's RED phase.
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

// vi.mock -- heavyweight Controller deps. Same proven set used by
// AOC02 / AOPC02 (no new mock additions). Required because
// `Controller.maybeReevaluateDeferredContinuation` (the production
// bridge under test) lives on the `Controller` class exported from
// SdkController.ts; importing SdkController pulls in McpHub,
// AuthService, OcaAuthService, etc.

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
	ensureMcpServersDirectoryExists: vi.fn(() => "/tmp/mock-mcp-servers"),
	ensureSettingsDirectoryExists: vi.fn(() => "/tmp/mock-settings"),
	resolveDefaultMcpSettingsPath: vi.fn(() => "/tmp/mock-mcp-settings.json"),
}))

// Disable the experimental sandbox so the test does not require a
// kernel substrate (BCAFG01 / BCCO01 precedent).
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

/**
 * Per-call supervisor factory. The CommandJobManager calls
 * `spawnFactory` once per `manager.start`, so a shared supervisor
 * reference would cause the second job's exit promise to
 * overwrite the first's. This factory creates a fresh supervisor
 * for every job so BTCONT-CTL-04 (multi-job) and BTCONT-CTL-05
 * (different session) tests can run concurrent jobs without
 * supervisor aliasing.
 */
function fakeSupervisorFactory(): () => SupervisableShellProcess {
	return () => fakeSupervisor()
}

interface ProductionHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	activeSessionId: string
	activeTaskId: string
	minter: MessageIdMinter
	/**
	 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01:
	 * Invokes the REAL production bridge
	 * `Controller.maybeReevaluateDeferredContinuation` from
	 * SdkController.ts (the static method that
	 * `updateBackgroundCommandState` calls). The arguments match
	 * what `updateBackgroundCommandState` computes: previousRunning,
	 * running, taskId. This is the same call sequence the production
	 * host performs when it sees
	 * `onBackgroundStateChange(false, undefined)` after
	 * `becameIdle === true`.
	 *
	 * Tests invoke this AFTER terminating a managed background job to
	 * simulate the live signal that fires on the production seam.
	 */
	/**
	 * Production-mirror of the >0->0 cardinal transition that
	 * `vscode-run-commands-tool.ts:697-698` guards on
	 * (`becameIdle === true`). The test must pass the value from
	 * the manager's `terminalPromise.becameIdle` so the production
	 * bridge condition is exercised with the same gate. When
	 * `becameIdle === false`, the bridge does NOT fire — matching
	 * the production guard at
	 * `vscode-run-commands-tool.ts:697-698`.
	 */
	notifyTerminalIdleIfIdle: (becameIdle: boolean) => void
	/**
	 * Mutable projection state that `notifyTerminalIdle` reads to
	 * determine `previousRunning`. Mirrors `Controller.backgroundCommandRunning`
	 * exactly (the test cannot construct a real `Controller` because
	 * its constructor pulls in McpHub/AuthService/etc).
	 */
	getBackgroundCommandRunning: () => boolean
	/**
	 * Mirror the Controller's projection state flip. Tests call this
	 * after starting a background job (production would do
	 * `updateBackgroundCommandState(true, jobId)`) so the harness's
	 * `notifyTerminalIdle` observes the correct `previousRunning` on
	 * the >0->0 cardinal transition.
	 */
	setBackgroundCommandRunning: (running: boolean) => void
	/**
	 * Swap the active session and task the coordinator sees.
	 * Used by BTCONT-CTL-06 to verify the same-coordinator guard.
	 */
	setActiveSessionAndTask: (sessionId: string, taskId: string) => void
}

interface MakeHarnessOptions {
	activeSessionId?: string
	activeTaskId?: string
	/**
	 * When true (default), the harness's `notifyTerminalIdle` is wired
	 * to coordinator.reevaluateDeferredContinuation() — the
	 * production-mirroring consumer. When false, no consumer is wired
	 * and the harness reproduces the pre-ACT defect (BTCONT-RED-01
	 * original witness). The BTCONT-RED-01 test uses the unwired
	 * variant for the RED assertion and the wired variant for the
	 * GREEN assertion (BTCONT-CTL-01).
	 */
	wireTerminalConsumer?: boolean
}

function makeHarness(opts: MakeHarnessOptions = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-btcont01"
	const activeTaskId = opts.activeTaskId ?? "1789935070156_oneah"

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
		// Wire the REAL hasRunningBackgroundJobForOwner so the
		// Q5 composition seam sees the same lookup logic the
		// production SdkController threads in.
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

	// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01:
	// Drive the REAL production bridge from `SdkController`:
	//   `Controller.maybeReevaluateDeferredContinuation(
	//     previousRunning, running, taskId, this.sessionEvents,
	//   )`
	// which is the static method that `updateBackgroundCommandState`
	// invokes. This is the same call site as production, with the
	// same condition (`previousRunning && !running && taskId === undefined`).
	// The harness mirrors the Controller's projection state
	// (`backgroundCommandRunning`) so the previousRunning argument
	// reflects what the Controller would have recorded.
	const backgroundCommandRunning = { value: false }
	const notifyTerminalIdleIfIdle = (becameIdle: boolean): void => {
		if (opts.wireTerminalConsumer === false) {
			return
		}
		// Production gate: vscode-run-commands-tool.ts:697-698 fires
		// `onBackgroundStateChange(false, undefined)` ONLY when
		// `becameIdle === true` (the >0->0 cardinal transition).
		// Mirror that here so the production condition is exercised
		// with the same gate.
		if (!becameIdle) {
			return
		}
		const previousRunning = backgroundCommandRunning.value
		const running = false
		const taskId = undefined as string | undefined
		// Production sets running=false, taskId=undefined on the >0->0
		// cardinal transition. Flip the projection AFTER computing
		// previousRunning so the test exercises the same race-free
		// ordering as production.
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
		minter,
		notifyTerminalIdleIfIdle,
		getBackgroundCommandRunning: () => backgroundCommandRunning.value,
		setBackgroundCommandRunning: (running: boolean) => {
			backgroundCommandRunning.value = running
		},
		/**
		 * Swap the active session and task the coordinator sees.
		 * Used by BTCONT-CTL-06 to verify that a late terminal
		 * event arriving AFTER the active session has changed (in
		 * the SAME coordinator instance) does not affect the new
		 * session.
		 */
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
			command: "sleep 120",
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
	// Mirror production's `updateBackgroundCommandState(true, jobId)`
	// flip on the projection state so the harness's `notifyTerminalIdle`
	// observes the correct `previousRunning` on the >0->0 cardinal
	// transition. Without this the production bridge condition
	// (`previousRunning && !running && taskId === undefined`) would
	// never fire, and BTCONT-CTL-02 / BTCONT-RED-01-GREEN would never
	// commit a continuation.
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

describe("ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01 / BTCONT01", () => {
	//
	// RED - REPRODUCE THE DEFECT
	//
	it("BTCONT-RED-01 (UNWIRED): deferral + terminality without terminal consumer leaves phase=streaming (DEFECT)", async () => {
		// Production defect witness: with NO terminal consumer wired,
		// the >0->0 cardinal transition has no consumer, so the
		// phase remains stranded. This is the pre-ACT failure that
		// BTCONT01 reproduces and repairs.
		const h = makeHarness({ wireTerminalConsumer: false })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		expect(h.tracker.currentPhase).toBe("streaming")

		// 1. start managed background job owned by active session
		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		// 2. deliver the done-without-completion session event - Q5
		//    should defer (BOCOR guard=true)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming") // suppressed

		// 3. terminate the matching background job through the
		//    REAL manager.cancel path. The manager's terminalPromise
		//    resolves with becameIdle: true (the race-safe cardinal
		//    signal computed inside finalize()).
		const { becameIdle, finalState } = await terminateJobAndAwait(h.manager, start)
		expect(becameIdle).toBe(true)
		expect(finalState).toBe("cancelled")

		// The job should no longer be reported as RUNNING for this owner
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(false)

		// 4. NO terminal consumer is wired. No fresh done event.
		// Wait one tick to give any pending microtasks / continuation
		// consumer a chance to run.
		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))

		// CURRENT (defect): phase remains stranded in streaming.
		// This is the pre-ACT failure witness.
		expect(h.tracker.currentPhase).toBe("streaming")

		await h.manager.dispose()
	}, 15_000)

	it("BTCONT-RED-01-GREEN: same setup, terminal consumer wired -> phase commits awaiting_followup", async () => {
		// GREEN-side witness of the BTCONT-RED-01 defect: with the
		// production-mirroring terminal consumer wired
		// (SdkController.updateBackgroundCommandState -> coordinator
		// .reevaluateDeferredContinuation), the >0->0 cardinal
		// transition triggers the canonical
		// `session-event-turn-complete-resumable-straggler-preserve`
		// commit, taking phase from streaming -> awaiting_followup.
		const h = makeHarness({ wireTerminalConsumer: true })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		expect(h.tracker.currentPhase).toBe("streaming")

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming") // suppressed

		const { becameIdle, finalState } = await terminateJobAndAwait(h.manager, start)
		expect(becameIdle).toBe(true)
		expect(finalState).toBe("cancelled")
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(false)

		// Simulate the production SdkController wiring:
		// onBackgroundStateChange(false, undefined) -> notifyTerminalIdleIfIdle
		h.notifyTerminalIdleIfIdle(becameIdle)

		// The phase MUST exit stranded streaming.
		expect(h.tracker.currentPhase).toBe("awaiting_followup")

		await h.manager.dispose()
	}, 15_000)

	//
	// CONTROL - manual wake-up proves the completion logic is healthy
	//
	it("BTCONT-CTL-01: drive a fresh done event after terminality - Q5 commits awaiting_followup", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")

		// Wait for the job to terminate through the manager
		const { becameIdle } = await terminateJobAndAwait(h.manager, start)
		expect(becameIdle).toBe(true)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(false)

		// Now drive a fresh done event after terminality. This is
		// the manual wake-up control (mirrors the operator's
		// cancel + resume path that unblocked the LIVE specimen).
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("awaiting_followup")

		await h.manager.dispose()
	}, 15_000)

	//
	// CONTROL - deferral persists while the matching job is still running
	//
	it("BTCONT-CTL-02: deferral persists while matching job is still running", async () => {
		const h = makeHarness({ wireTerminalConsumer: true })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		// While the job is still RUNNING, no continuation fires.
		// Even with the wired terminal consumer, no signal has
		// been observed (no >0->0 cardinal transition yet) so
		// the deferred marker stays intact.
		await new Promise((resolve) => setImmediate(resolve))
		expect(h.tracker.currentPhase).toBe("streaming")

		// Cleanup: terminate the still-running job
		const { becameIdle: cleanupBecameIdle } = await terminateJobAndAwait(h.manager, start)
		h.notifyTerminalIdleIfIdle(cleanupBecameIdle)
		await h.manager.dispose()
	}, 15_000)

	//
	// CONTROL - newer epoch supersedes old deferred continuation
	//
	it("BTCONT-CTL-04: multi-job matching - J1 terminal while J2 still running; J2 terminal commits continuation", async () => {
		const h = makeHarness({ wireTerminalConsumer: true })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// Start TWO matching managed background jobs J1 + J2 owned by the
		// active session.
		const start1 = await startBackgroundJob(h.manager, h.activeSessionId, h)
		const start2 = await startBackgroundJob(h.manager, h.activeSessionId, h)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming") // Q5 deferred

		// Terminate J1 while J2 is still running. The terminal event
		// for J1 fires but J2 is still alive, so the
		// hasRunningBackgroundJobForOwner lookup returns true and
		// the continuation MUST NOT commit.
		const { becameIdle: becameIdleJ1 } = await terminateJobAndAwait(h.manager, start1)
		expect(becameIdleJ1).toBe(false)
		// Production gate: the >0->0 cardinal transition fires ONLY
		// when becameIdle === true. J1's terminal is NOT the
		// >0->0 transition; the harness's notify mirrors that gate.
		h.notifyTerminalIdleIfIdle(becameIdleJ1)
		await new Promise((resolve) => setImmediate(resolve))
		expect(h.tracker.currentPhase).toBe("streaming")
		// The deferred marker is preserved (not cleared) so J2's
		// terminal event can re-drive the same continuation.
		expect(h.coordinator.getDeferredContinuationForTesting()).toBeDefined()

		// Now terminate J2. Both matching jobs are gone. The
		// hasRunningBackgroundJobForOwner lookup returns false
		// and the continuation commits awaiting_followup exactly
		// once.
		const { becameIdle: becameIdleJ2 } = await terminateJobAndAwait(h.manager, start2)
		expect(becameIdleJ2).toBe(true)
		h.notifyTerminalIdleIfIdle(becameIdleJ2)
		await new Promise((resolve) => setImmediate(resolve))
		expect(h.tracker.currentPhase).toBe("awaiting_followup")
		expect(h.coordinator.getDeferredContinuationForTesting()).toBeUndefined()

		await h.manager.dispose()
	}, 20_000)

	it("BTCONT-CTL-03: a newer turn legitimately started - late terminal event must not mutate it", async () => {
		const h = makeHarness({ wireTerminalConsumer: true })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")
		const markerAtDefer = h.coordinator.getDeferredContinuationForTesting()
		expect(markerAtDefer).toBeDefined()
		expect(markerAtDefer?.sessionId).toBe(h.activeSessionId)

		// Newer turn legitimately starts. Simulate the conversation
		// boundary that controller-epoch-transition-reseed performs
		// in production, then author a fresh streaming phase via a
		// non-deferred writer.
		h.minter.bumpEpoch()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "controller-ask-response",
		})
		expect(h.tracker.currentPhase).toBe("streaming")

		// Now the late terminal event arrives for the original job
		const { becameIdle } = await terminateJobAndAwait(h.manager, start)
		expect(becameIdle).toBe(true)
		// Simulate the production SdkController wiring
		h.notifyTerminalIdleIfIdle(becameIdle)
		await new Promise((resolve) => setImmediate(resolve))

		// The newer turn's phase must not be mutated by a late
		// terminal event from the old deferral. The deferred
		// marker is bound to the epoch at deferral time; the
		// minter has been bumped; the re-evaluation MUST discard
		// the late terminal event and the newer turn's phase
		// stays streaming.
		expect(h.tracker.currentPhase).toBe("streaming")
		// Marker should have been CLEARED by the discard (epoch
		// mismatch).
		expect(h.coordinator.getDeferredContinuationForTesting()).toBeUndefined()

		await h.manager.dispose()
	}, 15_000)

	//
	// CONTROL - different session's terminal event must NOT affect this session
	//
	it("BTCONT-CTL-05: unrelated session B job terminal does NOT affect session A", async () => {
		const hA = makeHarness({
			activeSessionId: "session-A",
			activeTaskId: "task-A",
			wireTerminalConsumer: true,
		})
		const hB = makeHarness({
			activeSessionId: "session-B",
			activeTaskId: "task-B",
			wireTerminalConsumer: true,
		})

		hA.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// session A starts its own background job
		const startA = await startBackgroundJob(hA.manager, "session-A", hA)
		await emitDoneWithoutCompletion(hA.coordinator, "session-A")
		expect(hA.tracker.currentPhase).toBe("streaming")

		// session B starts AND terminates an unrelated background
		// job. This must NOT cause session A's stranded streaming
		// to commit awaiting_followup.
		const startB = await startBackgroundJob(hB.manager, "session-B", hB)
		const { becameIdle } = await terminateJobAndAwait(hB.manager, startB)
		expect(becameIdle).toBe(true)
		hB.notifyTerminalIdleIfIdle(becameIdle)
		await new Promise((resolve) => setImmediate(resolve))

		// session A is still stranded (its own job hasn't terminated)
		expect(hA.tracker.currentPhase).toBe("streaming")
		expect(hA.manager.hasRunningBackgroundJobForOwner("session-A")).toBe(true)

		// Cleanup
		const { becameIdle: cleanupBecameIdleA } = await terminateJobAndAwait(hA.manager, startA)
		hA.notifyTerminalIdleIfIdle(cleanupBecameIdleA)
		await hA.manager.dispose()
		await hB.manager.dispose()
	}, 20_000)

	//
	// BRIDGE - exercise the REAL production Controller bridge
	//
	it("BTCONT-BRIDGE-01: real production bridge (Controller.maybeReevaluateDeferredContinuation) commits awaiting_followup", async () => {
		// Per Factory reviewer (correction cycle 1): this test MUST
		// drive the REAL production bridge that
		// `updateBackgroundCommandState` invokes — i.e. the static
		// method `Controller.maybeReevaluateDeferredContinuation`
		// on the production Controller class — with the EXACT
		// arguments production computes from a >0->0 cardinal
		// transition. It must NOT call
		// `coordinator.reevaluateDeferredContinuation()` directly.
		//
		// Production wiring (SdkController.ts:4200):
		//   Controller.maybeReevaluateDeferredContinuation(
		//     previousRunning, running, taskId, this.sessionEvents,
		//   )
		// with previousRunning=true, running=false, taskId=undefined.
		const h = makeHarness({ wireTerminalConsumer: true })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(h.coordinator.getDeferredContinuationForTesting()).toBeDefined()

		const { becameIdle } = await terminateJobAndAwait(h.manager, start)
		expect(becameIdle).toBe(true)

		// Drive the REAL production bridge (not the coordinator
		// directly). The arguments are exactly what
		// `updateBackgroundCommandState` would compute:
		// previousRunning from `this.backgroundCommandRunning`,
		// running=false (the >0->0 flip), taskId=undefined (the
		// no-jobId terminal signal).
		h.notifyTerminalIdleIfIdle(becameIdle)

		expect(h.tracker.currentPhase).toBe("awaiting_followup")
		expect(h.coordinator.getDeferredContinuationForTesting()).toBeUndefined()

		await h.manager.dispose()
	}, 15_000)

	//
	// CONTROL - same-coordinator session replacement must discard late terminal
	//
	it("BTCONT-CTL-06: same-coordinator active session changes after deferral; late terminal event must not affect the new session", async () => {
		// BTCONT-CTL-05 proves isolation between TWO independent
		// coordinator instances. This test proves the more
		// dangerous case: a SINGLE coordinator whose active session
		// changes after deferral must discard a late terminal event
		// that arrives for the original session.
		const h = makeHarness({ wireTerminalConsumer: true, activeSessionId: "session-A", activeTaskId: "task-A" })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// Original session-A starts a background job.
		const startA = await startBackgroundJob(h.manager, "session-A", h)
		await emitDoneWithoutCompletion(h.coordinator, "session-A")
		expect(h.tracker.currentPhase).toBe("streaming")
		const markerAtDefer = h.coordinator.getDeferredContinuationForTesting()
		expect(markerAtDefer).toBeDefined()
		expect(markerAtDefer?.sessionId).toBe("session-A")

		// SAME coordinator's active session swaps to session-B.
		// In production this happens when the user starts a new
		// task or `clearTask` is invoked.
		h.setActiveSessionAndTask("session-B", "task-B-new")
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "controller-ask-response",
		})
		expect(h.tracker.currentPhase).toBe("streaming")

		// Original session-A's job terminates. The terminal event
		// fires; the bridge runs; the coordinator must discard the
		// late terminal event (the marker is bound to session-A,
		// not session-B).
		const { becameIdle } = await terminateJobAndAwait(h.manager, startA)
		expect(becameIdle).toBe(true)
		h.notifyTerminalIdleIfIdle(becameIdle)
		await new Promise((resolve) => setImmediate(resolve))

		// Session-B's phase must remain streaming (the late
		// terminal event for session-A must not mutate it).
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(h.coordinator.getDeferredContinuationForTesting()).toBeUndefined()

		await h.manager.dispose()
	}, 15_000)

	//
	// CONTROL - tighter task identity equality
	//
	it("BTCONT-CTL-07: tighter task identity - marker.taskId=old, current=undefined must be discarded", async () => {
		// Per Factory reviewer: the original guard
		// `marker.taskId !== undefined && taskId !== undefined && marker.taskId !== taskId`
		// let through the asymmetric case where marker.taskId was
		// defined but current taskId became undefined (e.g. after
		// `clearTask`). The bounded check is now
		// `marker.taskId !== taskId` which rejects any taskId
		// mismatch — including the defined->undefined transition.
		const h = makeHarness({ wireTerminalConsumer: true })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")
		const markerAtDefer = h.coordinator.getDeferredContinuationForTesting()
		expect(markerAtDefer).toBeDefined()
		expect(markerAtDefer?.taskId).toBe(h.activeTaskId)

		// Task ends — `getTask` returns `undefined` for taskId
		// (mirrors `clearTask` clearing the active task reference).
		// The marker still carries the OLD taskId; current is
		// `undefined`. The tighter guard must reject.
		h.setActiveSessionAndTask(h.activeSessionId, undefined as unknown as string)

		const { becameIdle } = await terminateJobAndAwait(h.manager, start)
		expect(becameIdle).toBe(true)
		h.notifyTerminalIdleIfIdle(becameIdle)
		await new Promise((resolve) => setImmediate(resolve))

		// The phase stays streaming — the late terminal is
		// discarded because the task identity changed.
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(h.coordinator.getDeferredContinuationForTesting()).toBeUndefined()

		await h.manager.dispose()
	}, 15_000)
})
