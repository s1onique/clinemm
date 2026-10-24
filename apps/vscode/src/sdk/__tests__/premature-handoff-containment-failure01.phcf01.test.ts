/**
 * ACT-CLINEMM-P0-PREMATURE-HANDOFF-CONTAINMENT-FAILURE01 / PHCF01
 *
 * Reproduction + bounded repair test for the LIVE failure captured in
 * task 1792821549321_bwq2x / job cmd_mvm0o260jip25i0b:
 *
 *   agent turn ends (runtime `aborted`, no C9 / no C10)
 *     -> the `done` event is SUPPRESSED from committing
 *        `awaiting_followup` because the session still owns a RUNNING
 *        background job (the Q5 guard: `ownerStillRunning === true`)
 *        -> a bounded `deferredContinuation` marker is recorded
 *     -> ~43 s later the owned background job's process-group
 *        containment FAILS: the synchronous postcondition probe in
 *        `CommandJobManager.finalize()` returns `alive`, so the
 *        manager OVERWRITES the terminal class with
 *        `containment_failed` and latches
 *        `job.terminationFailed = "substrate_alive"`
 *     -> the manager removes the job from its ACTIVE map
 *        (PHCF-13: active-map removal does NOT prove OS containment)
 *     -> the runner publishes `running=false` with the exact terminal
 *        reason `containment_failed`
 *     -> `SdkController.updateBackgroundCommandState` derives the
 *        `>0 -> 0` cardinal flip and calls
 *        `Controller.maybeReevaluateDeferredContinuation`
 *     -> `SdkSessionEventCoordinator.reevaluateDeferredContinuation()`
 *        consults ONLY `hasRunningBackgroundJobForOwner(sessionId)`
 *        (i.e. ACTIVE-MAP CARDINALITY) and commits
 *        `awaiting_followup`
 *
 * THE DEFECT: the deferred user handoff is released by ACTIVE-MAP
 * EMPTINESS. The `containment_failed` terminal reason -- which IS
 * available at the publication boundary -- is dropped before the
 * handoff decision, so an UNRESOLVED subprocess-containment failure
 * is silently represented as a clean, safe handoff to the user.
 *
 * `MANAGED_JOB_REMOVED` and `PROCESS_CONTAINMENT_VERIFIED` are NOT
 * interchangeable, and neither is a successful process-group signal
 * by itself.
 *
 * What this test proves (RED-01 .. RED-07):
 *
 *   1. RED-01  Clean terminality still permits the existing deferred
 *              handoff (the positive conservation control). The
 *              clean path must NOT regress.
 *   2. RED-02  A failed containment (`postcondition = alive`) must
 *              NOT release the deferred handoff. The committed
 *              lifecycle state must remain consistent with the
 *              authoritative containment postcondition.
 *   3. RED-03  An UNKNOWN containment postcondition must fail CLOSED
 *              (not be silently treated as a verified clean
 *              termination).
 *   4. RED-04  Another owned job that is still RUNNING must keep the
 *              handoff deferred.
 *   5. RED-05  Late terminality for a REPLACED session/epoch must not
 *              mutate the active session.
 *   6. RED-06  An existing canceled / error / resumable phase must not
 *              be clobbered by a late background terminal event.
 *   7. RED-07  Neither successful cleanup nor containment failure may
 *              synthesize `completed` / a `completion_result` (no
 *              C9, no C10).
 *
 * Production seams under test (ALL real -- no re-implementation):
 *   - `CommandJobManager` (the lifecycle producer + active-map owner)
 *   - `SdkSessionEventCoordinator` (the canonical Q5 owner)
 *   - `TurnStateTracker` (the canonical turn-phase store)
 *   - `Controller.maybeReevaluateDeferredContinuation` (the REAL
 *     production bridge from the host projection to the coordinator)
 *
 * REPRODUCTION CLASS: `SYNTHETIC_REAL`.
 * The manager's synchronous PGID postcondition probe is injected
 * (`terminalPostconditionProbe`) so the fail-closed set
 * (`alive` / `unknown`) can be driven deterministically WITHOUT
 * creating uncontrolled real orphan processes on the host. Every
 * other seam -- the manager's `finalize()` state machine, the
 * active-map mutation, the `terminalTransitionResolve` payload, the
 * host projection recompute, the coordinator's four conservation
 * rules and the canonical phase commit -- is the REAL production
 * code path.
 *
 * This mirrors the BTCONT01 harness shape (same file layout, same
 * dependency-injection seam, same `Controller.maybeReevaluate...`
 * bridge invocation). It is an EXTENSION of that harness, not a
 * second CommandJobManager test framework.
 */

import type { SupervisableShellProcess } from "@cline/core"
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
// BTCONT01 / AOC02 / AOPC02 (no new mock additions). Required because
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
		LogoutReason: { USER_INITIATED: "user_initiated" },
	},
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
		getActiveBanners: vi.fn(() => []),
		getWelcomeBanners: vi.fn(() => []),
		initialize: vi.fn(() => ({ activeBanners: [], welcomeBanners: [] })),
		refresh: vi.fn(),
	},
}))

vi.mock("@core/storage/disk", () => ({
	getMcpSettingsFilePath: vi.fn(() => "/tmp/mock-mcp-settings.json"),
	ensureMcpServersDirectoryExists: vi.fn(() => "/tmp/mock-mcp-servers"),
	ensureSettingsDirectoryExists: vi.fn(() => "/tmp/mock-settings"),
	resolveDefaultMcpSettingsPath: vi.fn(() => "/tmp/mock-mcp-settings.json"),
	getTaskLogDirectory: vi.fn(() => "/tmp/mock-task-logs"),
}))

// Disable the experimental sandbox so the test does not require a
// kernel substrate (BCAFG01 / BCCO01 / BTCONT01 precedent).
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

let supervisorPid = 200000

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

function fakeSupervisorFactory(): () => SupervisableShellProcess {
	return () => fakeSupervisor()
}

/**
 * The exact containment postcondition the injected probe reports for
 * the managed job's primary process group.
 */
type Postcondition = "gone" | "alive" | "eperm" | "unknown"

interface ProductionHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	activeSessionId: string
	activeTaskId: string
	/**
	 * The number of `awaiting_followup` phase commits observed through
	 * the canonical writer. Used for the exactly-once conservation
	 * assertions (PHCF-07, PHCF-15).
	 */
	phaseCommits: () => number
	/**
	 * The writer ids of every phase write observed through the
	 * canonical writer, in order. Used to distinguish "the
	 * pre-existing authoritative phase was PRESERVED" from "a new
	 * phase was committed over it" (PHCF07 / PHCF08).
	 */
	phaseWrites: () => string[]
	/**
	 * The canonical phase observed at each `postStateToWebview` call.
	 * The production publication path reads the SAME `TurnStateTracker`
	 * the coordinator writes, so this is the canonical-vs-published
	 * consistency witness (PHCF12).
	 */
	postedPhases: () => string[]
	/**
	 * Mirror of `Controller.backgroundCommandRunning` (the derived
	 * scalar). The test cannot construct a real `Controller` (its
	 * constructor pulls in McpHub/AuthService/etc), so the harness
	 * mirrors the SAME production derivation.
	 */
	getBackgroundCommandRunning: () => boolean
	setBackgroundCommandRunning: (running: boolean) => void
	/**
	 * Register the job as RUNNING in the per-job projection map --
	 * the production mirror of `updateBackgroundCommandState(true,
	 * jobId)`. The derived scalar is then recomputed exactly as
	 * production does.
	 */
	markJobRunning: (jobId: string) => void
	/**
	 * Swap the active session and task the coordinator sees.
	 * Used by RED-05 (session/epoch replacement).
	 */
	setActiveSessionAndTask: (sessionId: string, taskId: string) => void
	/**
	 * Drive the REAL production terminal lifecycle: the manager
	 * finalizes the job, the runner publishes the terminal reason
	 * through the production bridge, and the coordinator re-evaluates
	 * the deferred continuation.
	 *
	 * `terminalState` is the EXACT reason the manager latched; it is
	 * forwarded verbatim (production fidelity: the runner's
	 * `terminalPromise.then(({ jobId, terminalState }) =>
	 * notifyBackgroundStateChange(false, jobId, terminalState))`).
	 */
	publishTerminal: (jobId: string, terminalState: string) => void
}

interface MakeHarnessOptions {
	activeSessionId?: string
	activeTaskId?: string
	/**
	 * The containment postcondition the manager's synchronous probe
	 * reports. `"gone"` is the clean/verified path; every other value
	 * is a fail-closed containment failure.
	 */
	postcondition?: Postcondition
	/**
	 * When true (default), the harness publishes the terminal reason
	 * through the REAL `Controller.maybeReevaluateDeferredContinuation`
	 * production bridge.
	 */
	wireTerminalConsumer?: boolean
}

function makeHarness(opts: MakeHarnessOptions = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-phcf01"
	const activeTaskId = opts.activeTaskId ?? "1792821549321_bwq2x"
	const postcondition = opts.postcondition ?? "gone"

	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: fakeSupervisorFactory(),
		// SYNTHETIC_REAL: the ONLY injected seam. It replaces the
		// real `process.kill(-pgid, 0)` classification so the
		// fail-closed set can be driven deterministically WITHOUT
		// creating uncontrolled real orphan processes on the host.
		terminalPostconditionProbe: () => postcondition,
	})

	let currentActiveSession = activeSessionId
	let currentActiveTask = activeTaskId
	let phaseCommitCount = 0
	const phaseWrites: string[] = []
	const postedPhases: string[] = []
	// The production publication seam. The coordinator calls it after
	// a phase commit; the host (`updateBackgroundCommandState`) calls
	// it after the deferred re-evaluation.
	const postStateToWebviewMock = vi.fn(async () => {
		// The production publication path reads the canonical
		// `TurnStateTracker`; record what the webview WOULD see.
		postedPhases.push(tracker.currentPhase)
	})
	// The projection map mirrors `Controller.backgroundCommandJobStates`
	// and the derived scalar mirrors `Controller.backgroundCommandRunning`.
	// The production derivation is: the scalar is DERIVED from the
	// per-job projection map, and the `>0 -> 0` flip is the trigger.
	const jobProjection = new Map<string, string>()
	const backgroundCommandRunning = { value: false }
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
		postStateToWebview: postStateToWebviewMock,
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "awaiting_followup") {
				phaseCommitCount++
			}
			phaseWrites.push(`${phase}:${writerId ?? "unknown-legacy-writer"}`)
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
		// ACT-CLINEMM-P0-PREMATURE-HANDOFF-CONTAINMENT-FAILURE01
		// (PHCF01): the host-owned per-job terminal projection. The
		// production SdkController wires this to the SAME map that
		// `updateBackgroundCommandState` maintains; the harness
		// mirrors it with the identical derivation.
		getBackgroundCommandJobStates: () => Object.fromEntries(jobProjection),
		// ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION01:
		// availability-aware pending-prompt authority (Shape F: no
		// queued autonomous work).
		getPendingPromptCount: () => ({ available: true, count: 0 }),
	} as unknown as SdkSessionEventCoordinatorOptions)

	const publishTerminal = (jobId: string, terminalState: string): void => {
		if (opts.wireTerminalConsumer === false) {
			return
		}
		// Production guard (`vscode-run-commands-tool.ts`): the runner
		// fires the terminal signal per-job with the EXACT terminal
		// reason, and the host recomputes the derived scalar from the
		// per-job projection map.
		const previousRunning = backgroundCommandRunning.value
		jobProjection.set(jobId, terminalState)
		const anyRunning = [...jobProjection.values()].some((s) => s === "running")
		backgroundCommandRunning.value = anyRunning
		// The production `>0 -> 0` cardinal transition forwards
		// `taskId === undefined` (the legacy BTCONT contract) so the
		// bridge fires EXACTLY once per session when the LAST running
		// job transitions to terminal.
		const taskId = anyRunning ? jobId : undefined
		Controller.maybeReevaluateDeferredContinuation(previousRunning, anyRunning, taskId, coordinator)
		// Production ordering (`SdkController.updateBackgroundCommandState`):
		// the phase commit happens FIRST, then the best-effort
		// `postStateToWebview()` publishes the committed phase.
		void postStateToWebviewMock()
	}

	return {
		coordinator,
		tracker,
		translatorState,
		manager,
		activeSessionId,
		activeTaskId,
		phaseCommits: () => phaseCommitCount,
		phaseWrites: () => [...phaseWrites],
		postedPhases: () => [...postedPhases],
		publishTerminal,
		markJobRunning: (jobId: string) => {
			jobProjection.set(jobId, "running")
			backgroundCommandRunning.value = [...jobProjection.values()].some((s) => s === "running")
		},
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
	// flip on the projection state so the harness's terminal publisher
	// observes the correct `previousRunning` on the `>0 -> 0` cardinal
	// transition.
	if (harness) {
		harness.markJobRunning(start.jobId)
	}
	return start
}

const agentEvent = (sessionId: string, event: Record<string, unknown>) =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as never

/**
 * Emit the `done` event that ends the agent turn WITHOUT a committed
 * terminal response. This is the Q5 "done-without-completion" branch
 * -- the same branch the LIVE incident exercised when the runtime
 * aborted (the SDK's `completeAbortedInteractiveTurn` dispatches a
 * `done` event with `reason: "aborted"`).
 */
async function emitDoneWithoutCompletion(
	coordinator: SdkSessionEventCoordinator,
	sessionId: string,
	reason: "completed" | "aborted" = "aborted",
): Promise<void> {
	const doneEvent = agentEvent(sessionId, {
		type: "done",
		reason,
		text: "Some text without commit.",
		iterations: 1,
	})
	await coordinator.handleSessionEvent(doneEvent)
}

/**
 * Terminate the managed job through the REAL manager path and await
 * the REAL terminal transition. The manager's `finalize()` runs the
 * (injected) postcondition probe, overwrites the terminal class with
 * `containment_failed` when the probe is not `gone`, removes the job
 * from the active map, and resolves the terminal transition promise
 * with the exact terminal reason.
 */
async function terminateJobAndAwait(
	manager: CommandJobManager,
	start: StartCommandJobResult,
): Promise<{ becameIdle: boolean; terminalState: string }> {
	await manager.cancel({ jobId: start.jobId })
	const transition = await start.terminalPromise
	return { becameIdle: transition.becameIdle, terminalState: transition.terminalState }
}

describe("ACT-CLINEMM-P0-PREMATURE-HANDOFF-CONTAINMENT-FAILURE01 / PHCF01", () => {
	//
	// RED-01 -- CLEAN TERMINAL ALLOWS THE HANDOFF (conservation control)
	//
	it("PHCF-01 (RED-01): clean terminality releases the deferred handoff exactly once", async () => {
		const h = makeHarness({ postcondition: "gone" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		expect(h.tracker.currentPhase).toBe("streaming")

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		// The agent turn ends (aborted) while the job is still RUNNING:
		// the Q5 guard suppresses `awaiting_followup` and records the
		// deferred continuation marker.
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(h.phaseCommits()).toBe(0)

		// The job reaches VERIFIED clean terminality.
		const { becameIdle, terminalState } = await terminateJobAndAwait(h.manager, start)
		expect(becameIdle).toBe(true)
		expect(terminalState).toBe("cancelled")
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(false)

		// The production terminal publication drives the handoff.
		h.publishTerminal(start.jobId, terminalState)

		// The handoff is permitted -- the containment obligation was
		// RESOLVED (postcondition `gone`).
		expect(h.tracker.currentPhase).toBe("awaiting_followup")
		expect(h.phaseCommits()).toBe(1)

		await h.manager.dispose()
	}, 15_000)

	//
	// RED-02 -- FAILED CONTAINMENT MUST NOT MASQUERADE AS CLEAN TERMINALITY
	//
	it("PHCF-02 (RED-02): containment_failed with postcondition=alive must NOT release the deferred handoff", async () => {
		const h = makeHarness({ postcondition: "alive" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		expect(h.tracker.currentPhase).toBe("streaming")

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(h.phaseCommits()).toBe(0)

		// The REAL manager terminal lifecycle: the postcondition probe
		// returns `alive`, so the manager OVERWRITES the terminal class
		// with `containment_failed` and the group is still on the OS.
		const { becameIdle, terminalState } = await terminateJobAndAwait(h.manager, start)
		expect(becameIdle).toBe(true)
		expect(terminalState).toBe("containment_failed")

		// PHCF-13: the active map is emptied EVEN THOUGH the OS
		// containment was NOT verified. Active-map removal does NOT
		// prove process containment.
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(false)

		// The production terminal publication carries the exact reason.
		h.publishTerminal(start.jobId, terminalState)

		// THE LOAD-BEARING ASSERTION: the committed lifecycle state
		// must be consistent with the authoritative containment
		// postcondition. The unresolved containment failure must NOT
		// be represented as a clean, safe user handoff.
		//
		// The truthful state is `resumable` -- the EXISTING production
		// affordance for "the run was abandoned before it produced a
		// terminal response" (the cancel-path precedent). It is NOT
		// `awaiting_followup` (which would misrepresent the failed
		// containment as a clean handoff) and NOT `streaming` (which
		// would leave the UI in a permanent Working state after the
		// model run genuinely ended).
		expect(h.phaseCommits()).toBe(0)
		expect(h.tracker.currentPhase).toBe("resumable")
		expect(h.tracker.currentPhase).not.toBe("awaiting_followup")
		expect(h.tracker.currentPhase).not.toBe("completed")

		await h.manager.dispose()
	}, 15_000)

	//
	// RED-03 -- UNKNOWN CONTAINMENT OUTCOME FAILS CLOSED
	//
	it("PHCF-03 (RED-03): containment_failed with postcondition=unknown must fail closed", async () => {
		const h = makeHarness({ postcondition: "unknown" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")

		const { terminalState } = await terminateJobAndAwait(h.manager, start)
		expect(terminalState).toBe("containment_failed")

		h.publishTerminal(start.jobId, terminalState)

		// An UNKNOWN result must not be silently treated as a verified
		// clean termination. It fails CLOSED into the same truthful
		// recovery phase as the `alive` case.
		expect(h.phaseCommits()).toBe(0)
		expect(h.tracker.currentPhase).toBe("resumable")
		expect(h.tracker.currentPhase).not.toBe("awaiting_followup")
		expect(h.tracker.currentPhase).not.toBe("completed")

		await h.manager.dispose()
	}, 15_000)

	//
	// RED-04 -- ANOTHER OWNED JOB REMAINS ACTIVE
	//
	it("PHCF-04 (RED-04): a clean terminal for J1 must not release the handoff while J2 is still running", async () => {
		const h = makeHarness({ postcondition: "gone" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const j1 = await startBackgroundJob(h.manager, h.activeSessionId, h)
		const j2 = await startBackgroundJob(h.manager, h.activeSessionId, h)
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")

		// J1 reaches clean terminality; J2 is still RUNNING.
		const t1 = await terminateJobAndAwait(h.manager, j1)
		expect(t1.terminalState).toBe("cancelled")
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		h.publishTerminal(j1.jobId, t1.terminalState)

		// J2's legitimate obligation is still outstanding.
		expect(h.phaseCommits()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("awaiting_followup")

		// Now J2 terminates cleanly -- the handoff becomes eligible.
		const t2 = await terminateJobAndAwait(h.manager, j2)
		expect(t2.terminalState).toBe("cancelled")
		h.publishTerminal(j2.jobId, t2.terminalState)
		expect(h.tracker.currentPhase).toBe("awaiting_followup")
		expect(h.phaseCommits()).toBe(1)

		await h.manager.dispose()
	}, 15_000)

	//
	// RED-05 -- TERMINAL EVENT AFTER SESSION / EPOCH REPLACEMENT
	//
	it("PHCF-05 (RED-05): late terminality for a replaced session must not mutate the active session", async () => {
		const h = makeHarness({ postcondition: "alive" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")

		// The active context is replaced (S1/E1 -> S2/E2).
		h.setActiveSessionAndTask("session-phcf01-replacement", "1792821549321_bwq2x-v2")
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const { terminalState } = await terminateJobAndAwait(h.manager, start)
		expect(terminalState).toBe("containment_failed")

		h.publishTerminal(start.jobId, terminalState)

		// No phase mutation for the replacement session.
		expect(h.tracker.currentPhase).not.toBe("awaiting_followup")
		expect(h.phaseCommits()).toBe(0)

		await h.manager.dispose()
	}, 15_000)

	//
	// RED-06 -- EXISTING CANCELED / RESUMABLE STATE MUST NOT BE CLOBBERED
	//
	it("PHCF-06 (RED-06): a late terminal event must not clobber an existing resumable phase", async () => {
		const h = makeHarness({ postcondition: "gone" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("streaming")

		// The task entered an authoritative resumable state (e.g. a
		// cancel/resume cycle) BEFORE the background terminal arrived.
		h.tracker.setWithWriter("resumable", Date.now(), { writerId: "task-control-resumable-ask" })
		expect(h.tracker.currentPhase).toBe("resumable")
		const writesBefore = h.phaseWrites().length

		const { terminalState } = await terminateJobAndAwait(h.manager, start)
		expect(terminalState).toBe("cancelled")

		h.publishTerminal(start.jobId, terminalState)

		// The existing authoritative state is PRESERVED -- and, because
		// the pre-existing phase is already `resumable`, the late
		// terminal event must NOT write over it at all (no new phase
		// write is issued).
		expect(h.tracker.currentPhase).toBe("resumable")
		expect(h.phaseCommits()).toBe(0)
		expect(h.phaseWrites().length).toBe(writesBefore)

		await h.manager.dispose()
	}, 15_000)

	//
	// RED-07 -- NO C9 / C10 AUTHORITY IS MANUFACTURED
	//
	it("PHCF-10/11 (RED-07): neither clean cleanup nor containment failure synthesizes completion", async () => {
		for (const postcondition of ["gone", "alive", "unknown"] as Postcondition[]) {
			const h = makeHarness({ postcondition })
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
			await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

			const { terminalState } = await terminateJobAndAwait(h.manager, start)
			h.publishTerminal(start.jobId, terminalState)

			// No completion is manufactured: the phase is NEVER
			// `completed`, and the `awaiting_followup` commit is not a
			// completion commitment.
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.tracker.currentPhase).not.toBe("completion_result")

			await h.manager.dispose()
		}
	}, 15_000)

	//
	// PHCF-07 -- DUPLICATE LIFECYCLE CALLBACKS DO NOT DUPLICATE COMMITS
	//
	it("PHCF-07: duplicate terminal callbacks do not duplicate phase commits", async () => {
		const h = makeHarness({ postcondition: "alive" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

		const { terminalState } = await terminateJobAndAwait(h.manager, start)
		expect(terminalState).toBe("containment_failed")

		// The same terminal event delivered TWICE (a duplicated
		// lifecycle callback) must not produce two phase writes.
		h.publishTerminal(start.jobId, terminalState)
		const writesAfterFirst = h.phaseWrites().length
		h.publishTerminal(start.jobId, terminalState)

		expect(h.phaseWrites().length).toBe(writesAfterFirst)
		expect(h.tracker.currentPhase).toBe("resumable")
		expect(h.phaseCommits()).toBe(0)

		await h.manager.dispose()
	}, 15_000)

	//
	// PHCF-12 -- THE PUBLISHED STATE MATCHES THE CANONICAL PHASE
	//
	it("PHCF-12: the published webview state matches the canonical phase", async () => {
		const h = makeHarness({ postcondition: "alive" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const start = await startBackgroundJob(h.manager, h.activeSessionId, h)
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

		const { terminalState } = await terminateJobAndAwait(h.manager, start)
		h.publishTerminal(start.jobId, terminalState)

		// The canonical phase is `resumable`; the coordinator's
		// `postStateToWebview` seam is the publication path, so the
		// published state MUST observe the SAME phase (no divergence
		// between the canonical phase and the UI projection).
		expect(h.tracker.currentPhase).toBe("resumable")
		expect(h.postedPhases()).toContain("resumable")
		expect(h.postedPhases()).not.toContain("awaiting_followup")

		await h.manager.dispose()
	}, 15_000)
})
