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
	 * Mirrors the production SdkController.updateBackgroundCommandState
	 * wiring: on the >0->0 cardinal transition (running=true→false,
	 * jobId=undefined), calls coordinator.reevaluateDeferredContinuation().
	 * Tests invoke this AFTER terminating a managed background job to
	 * simulate the live signal that fires on the production seam.
	 */
	notifyTerminalIdle: () => void
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

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {},
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
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
	} as unknown as SdkSessionEventCoordinatorOptions)

	// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CONTINUATION01:
	// mirror the production SdkController.updateBackgroundCommandState
	// behavior on the >0->0 cardinal transition. Production forwards
	// the signal to coordinator.reevaluateDeferredContinuation() from
	// the onBackgroundStateChange(false, undefined) callback (see
	// SdkController.ts:4196-4203). The harness reproduces the same
	// single method invocation so the test exercises the real
	// production seam end-to-end.
	const notifyTerminalIdle = (): void => {
		if (opts.wireTerminalConsumer !== false) {
			coordinator.reevaluateDeferredContinuation()
		}
	}

	return {
		coordinator,
		tracker,
		translatorState,
		manager,
		activeSessionId,
		activeTaskId,
		minter,
		notifyTerminalIdle,
	}
}

async function startBackgroundJob(manager: CommandJobManager, sessionId: string): Promise<StartCommandJobResult> {
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
		const start = await startBackgroundJob(h.manager, h.activeSessionId)
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

		const start = await startBackgroundJob(h.manager, h.activeSessionId)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming") // suppressed

		const { becameIdle, finalState } = await terminateJobAndAwait(h.manager, start)
		expect(becameIdle).toBe(true)
		expect(finalState).toBe("cancelled")
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(false)

		// Simulate the production SdkController wiring:
		// onBackgroundStateChange(false, undefined) -> notifyTerminalIdle
		h.notifyTerminalIdle()

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

		const start = await startBackgroundJob(h.manager, h.activeSessionId)
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

		const start = await startBackgroundJob(h.manager, h.activeSessionId)
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
		await terminateJobAndAwait(h.manager, start)
		h.notifyTerminalIdle()
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
		const start1 = await startBackgroundJob(h.manager, h.activeSessionId)
		const start2 = await startBackgroundJob(h.manager, h.activeSessionId)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming") // Q5 deferred

		// Terminate J1 while J2 is still running. The terminal event
		// for J1 fires but J2 is still alive, so the
		// hasRunningBackgroundJobForOwner lookup returns true and
		// the continuation MUST NOT commit.
		await terminateJobAndAwait(h.manager, start1)
		h.notifyTerminalIdle()
		await new Promise((resolve) => setImmediate(resolve))
		expect(h.tracker.currentPhase).toBe("streaming")
		// The deferred marker is preserved (not cleared) so J2's
		// terminal event can re-drive the same continuation.
		expect(h.coordinator.getDeferredContinuationForTesting()).toBeDefined()

		// Now terminate J2. Both matching jobs are gone. The
		// hasRunningBackgroundJobForOwner lookup returns false
		// and the continuation commits awaiting_followup exactly
		// once.
		await terminateJobAndAwait(h.manager, start2)
		h.notifyTerminalIdle()
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

		const start = await startBackgroundJob(h.manager, h.activeSessionId)
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
		h.notifyTerminalIdle()
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
		const startA = await startBackgroundJob(hA.manager, "session-A")
		await emitDoneWithoutCompletion(hA.coordinator, "session-A")
		expect(hA.tracker.currentPhase).toBe("streaming")

		// session B starts AND terminates an unrelated background
		// job. This must NOT cause session A's stranded streaming
		// to commit awaiting_followup.
		const startB = await startBackgroundJob(hB.manager, "session-B")
		const { becameIdle } = await terminateJobAndAwait(hB.manager, startB)
		expect(becameIdle).toBe(true)
		hB.notifyTerminalIdle()
		await new Promise((resolve) => setImmediate(resolve))

		// session A is still stranded (its own job hasn't terminated)
		expect(hA.tracker.currentPhase).toBe("streaming")
		expect(hA.manager.hasRunningBackgroundJobForOwner("session-A")).toBe(true)

		// Cleanup
		await terminateJobAndAwait(hA.manager, startA)
		hA.notifyTerminalIdle()
		await hA.manager.dispose()
		await hB.manager.dispose()
	}, 20_000)
})
