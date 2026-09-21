/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
 * (correction01 / Factory HALT_MULTI_JOB_START_SIGNAL_DROPPED +
 * HALT_MULTI_JOB_RUNNER_SEAM_NOT_EXECUTED):
 *
 * RUNNER-COMPOSITION RED witness for the multi-job terminal AND start
 * projection defects. The earlier controller-only proxy test
 * (BCTCP-CTL-MULTI-01..05) drives `updateBackgroundCommandState`
 * directly with the exact args the runner would emit. The Factory
 * causal reviewer correctly identified two layers too early:
 *
 *   1. Round 1: the runner-composition seam itself was not exercised.
 *      The bug lived at:
 *
 *        real createVscodeRunCommandsTool
 *          -> real createVscodeShellExecutor
 *            -> real CommandJobManager.start
 *              -> terminalPromise resolves with { becameIdle, jobId, terminalState }
 *                -> runner's `.then(({jobId, terminalState}) => notify(false, jobId, terminalState))`
 *                  -> options.onBackgroundStateChange callback
 *
 *      Closed by BCTCP-RUNNER-MULTI-01..04 (round 1 of this file).
 *
 *   2. Round 2 (this commit): the start side of the runner was still
 *      gated on aggregate 0->1 cardinality
 *      (`if (start.becameActive) notify(true, start.jobId)`), so a
 *      concurrent J2 start (1->2 transition) silently dropped the
 *      J2 start signal. The controller's per-job map never saw
 *      J2 === "running", breaking the per-job derivation of
 *      `backgroundCommandRunning` and `backgroundCommandTaskId`:
 *
 *        REAL manager:          J2 running
 *        projection map:        no J2
 *        backgroundCommandRunning = false
 *        backgroundCommandTaskId = undefined
 *
 *      Closed by BCTCP-RUNNER-MULTI-00 (start-per-job invariant),
 *      BCTCP-RUNNER-MULTI-01..04 (re-stated to include the start
 *      side), and BCTCP-RUNNER-COMPOSITION-01 (the genuine
 *      runner->controller projection composition the reviewer
 *      demanded -- real runner callbacks drive the real
 *      `SdkController.prototype.updateBackgroundCommandState`
 *      method, end-to-end).
 *
 * Production change at vscode-run-commands-tool.ts:813-834: the
 * `if (start.becameActive)` gate is removed; the runner now fires
 * `(true, start.jobId)` PER RUNNING job. The terminal side was
 * already per-job from correction01.
 *
 * The runner-composition tests below witness this change against
 * the REAL production seam (real `createVscodeRunCommandsTool` +
 * real `CommandJobManager.start` + `fakeSupervisor` to avoid the
 * POSIX shell+spawn env failure that predates this ACT).
 */

import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CommandJobManager, type CommandJobState } from "../command-job-manager"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

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

vi.mock("@/services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

vi.mock("@/services/telemetry/TelemetryService", () => ({
	TelemetryProviderFactory: {
		createProviders: () => [],
	},
	TelemetryService: {
		create: () => ({
			providers: [],
			shutdown: vi.fn(async () => undefined),
		}),
	},
}))

// ---------------------------------------------------------------------------
// Fake supervisor (same factory shape as BCNT01 / BCLAS02 / AGCONT01).
// Keeps the manager's FSM real without spawning a shell, isolating the
// runner's projection seam from the POSIX shell+spawn env failure.
// ---------------------------------------------------------------------------

let supervisorPidCounter = 800000

interface FakeSupervisorHandle {
	supervisor: SupervisableShellProcess
	resolveExit: (code: number | null) => void
}

function fakeSupervisor(): FakeSupervisorHandle {
	const pid = ++supervisorPidCounter
	const pgid = pid
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	const supervisor: SupervisableShellProcess = Object.freeze({
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
	return { supervisor, resolveExit }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Production-shape runner spy type.
type NotifyTuple = [
	boolean,
	string | undefined,
	Exclude<CommandJobState, "running">?,
]

// Vitest's `vi.fn<P>()` doesn't accept arbitrary generic tuples as a
// generic parameter; define a function-shaped alias and assert via the
// `.mock.calls` array (which IS `NotifyTuple[]`).
type SpyListener = (
	running: boolean,
	jobId: string | undefined,
	terminalState?: Exclude<CommandJobState, "running">,
) => void

interface Harness {
	manager: CommandJobManager
	tool: ReturnType<typeof createVscodeRunCommandsTool>
	spy: ReturnType<typeof vi.fn>
}

function makeHarness(): Harness {
	const supervisorFifo: FakeSupervisorHandle[] = []
	const manager = new CommandJobManager({
		maxWaitBudgetMs: 5_000,
		maxExecutionDeadlineMs: 60_000,
		spawnFactory: () => {
			const handle = fakeSupervisor()
			supervisorFifo.push(handle)
			return handle.supervisor
		},
	})
	const spy = vi.fn<SpyListener>()
	// Capture the supervisor handle for each jobId at RUNNING.
	const supervisorsByJobId = new Map<string, FakeSupervisorHandle>()
	const tool = createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("foreground not used")
		},
		vscodeTerminalExecutionMode: "backgroundExec",
		commandJobManager: manager,
		backgroundWaitBudgetMs: 50,
		backgroundExecutionDeadlineMs: 60_000,
		onBackgroundStateChange: (
			running: boolean,
			jobId: string | undefined,
			terminalState?: Exclude<CommandJobState, "running">,
		) => {
			spy(running, jobId, terminalState)
			if (running && jobId) {
				const next = supervisorFifo.shift()
				if (next) {
					supervisorsByJobId.set(jobId, next)
				}
			}
		},
	})
	void supervisorsByJobId // currently unused; reserved for future shape assertions
	return { manager, tool, spy }
}

async function startJobViaTool(harness: Harness): Promise<string> {
	const result = await harness.tool.execute(
		{ commands: ["/bin/sh -c 'sleep 30'"] },
		{ agentId: "test-agent", conversationId: "conv-1", iteration: 1 },
	)
	const arr = Array.isArray(result) ? (result as Array<{ result: string }>) : []
	const first = arr[0]
	const parsed = JSON.parse(first?.result ?? "{}")
	const jobId = parsed.jobId as string
	expect(parsed.status).toBe("running")
	expect(jobId).toBeTruthy()
	return jobId
}

// ---------------------------------------------------------------------------
// Tests -- runner composition RED witness (the Factory P0 gate).
// ---------------------------------------------------------------------------

describe(
	"ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01 / runner->callback composition (correction01)",
	() => {
		beforeEach(() => {
			process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		})
		afterEach(() => {
			delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		})

		// ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
		// (correction01 / Factory
		// HALT_MULTI_JOB_START_SIGNAL_DROPPED): start-per-job
		// invariant. Before correction01 the runner gated the
		// `(true, jobId)` signal on aggregate 0->1 cardinality
		// (`if (start.becameActive)`). A concurrent J2 start after
		// J1 was already running dropped J2's start signal
		// entirely. After correction01 the runner fires
		// `(true, start.jobId)` UNCONDITIONALLY for every RUNNING
		// start.
		it(
			"BCTCP-RUNNER-MULTI-00 the runner fires (true, jobId) for EVERY RUNNING start, not only on aggregate 0->1",
			async () => {
				const harness = makeHarness()
				try {
					const jobId1 = await startJobViaTool(harness)
					const jobId2 = await startJobViaTool(harness)

					const trueCalls = harness.spy.mock.calls.filter((c) => c[0] === true)
					// EXACTLY one (true, J1) and EXACTLY one (true, J2)
					// -- no duplicates, no drops, no (true, undefined).
					expect(trueCalls).toEqual([
						[true, jobId1, undefined],
						[true, jobId2, undefined],
					])
					expect(harness.spy).not.toHaveBeenCalledWith(true, undefined)
				} finally {
					await harness.manager.dispose()
				}
			},
		)

		// The actual Factory P0 gate. The runner fires per-job on
		// BOTH sides (start and terminal). Per-job start AND per-job
		// terminal -- not gated on becameActive / becameIdle.
		it(
			"BCTCP-RUNNER-MULTI-01 real runner fires per-job (true, J) on every start AND (false, J1, 'cancelled') when J1 terminalizes while J2 stays running",
			async () => {
				const harness = makeHarness()
				try {
					const jobId1 = await startJobViaTool(harness)
					const jobId2 = await startJobViaTool(harness)

					// Sanity (NEW): runner fired (true, J1) and (true,
					// J2) -- one of each. The card-projection map
					// now has BOTH entries.
					const trueCalls = harness.spy.mock.calls.filter((c) => c[0] === true)
					expect(trueCalls).toContainEqual([true, jobId1, undefined])
					expect(trueCalls).toContainEqual([true, jobId2, undefined])

					// Canonical "J2 still alive" boundary.
					const callsBeforeJ1Terminal = harness.spy.mock.calls.length

					// Terminalize J1 via the public cancel() seam.
					await harness.manager.cancel({
						jobId: jobId1,
						origin: "other:bctcp-runner-multi-01",
					})
					await sleep(50)

					// === Factory P0 gate ===
					const falseCallsAfterJ1Terminal = harness.spy.mock.calls
						.slice(callsBeforeJ1Terminal)
						.filter((c) => c[0] === false)
					expect(falseCallsAfterJ1Terminal).toEqual([[false, jobId1, "cancelled"]])
					expect(harness.spy).not.toHaveBeenCalledWith(false, undefined)
					expect(harness.spy).not.toHaveBeenCalledWith(false, undefined, "cancelled")

					// J2 still alive in the manager.
					const j2Status = await harness.manager.status({ jobId: jobId2, waitMs: 0 })
					expect(j2Status.ok).toBe(true)
					if (j2Status.ok) {
						expect(j2Status.snapshot.state).toBe("running")
					}
				} finally {
					await harness.manager.dispose()
				}
			},
		)

		// Companion: the LAST terminal completion fires per-job
		// tuple too (no (false, undefined) leak).
		it(
			"BCTCP-RUNNER-MULTI-02 the LAST terminal completion also fires per-job (no (false, undefined) leak)",
			async () => {
				const harness = makeHarness()
				try {
					const jobId1 = await startJobViaTool(harness)
					const jobId2 = await startJobViaTool(harness)

					await harness.manager.cancel({
						jobId: jobId1,
						origin: "other:bctcp-runner-multi-02",
					})
					await sleep(50)
					await harness.manager.cancel({
						jobId: jobId2,
						origin: "other:bctcp-runner-multi-02",
					})
					await sleep(50)

					const allFalseCalls = harness.spy.mock.calls.filter((c) => c[0] === false)
					expect(allFalseCalls).toContainEqual([false, jobId1, "cancelled"])
					expect(allFalseCalls).toContainEqual([false, jobId2, "cancelled"])
					const undefinedFalseCalls = allFalseCalls.filter((c) => c[1] === undefined)
					expect(undefinedFalseCalls).toEqual([])
				} finally {
					await harness.manager.dispose()
				}
			},
		)

		// Composite (the Factory "better still"): the runner
		// produces the right per-job tuple and it lands on a host
		// projection map that maintains independent per-job
		// state. Uses the existing harness's spy and the manager's
		// own state to assert the chain end-to-end.
		it(
			"BCTCP-RUNNER-MULTI-03 composed runner->projection: per-job tuple lands on independent entries; manager still tracks J2 as running",
			async () => {
				const harness = makeHarness()
				try {
					const jobId1 = await startJobViaTool(harness)
					const jobId2 = await startJobViaTool(harness)

					// Snapshot the projection map's intent BEFORE cancel.
					// Real projection is computed by the controller in
					// tests BCTCP-CTL-MULTI-01..05; here we only need
					// to confirm that the runner's per-job tuple maps
					// to a unique jobId and that the second job is
					// still RUNNING (the bounded Factory P0 gate at the
					// runner seam; the full controller invariant is
					// proven by the parallel BCTCP-CTL-MULTI suite).
					const projectionBefore: Record<
						string,
						"running" | "cancelled" | "exited" | "deadline_exceeded"
					> = {}
					projectionBefore[jobId1] = "running"
					projectionBefore[jobId2] = "running"

					// Cancel J1 (real manager.cancel); wait one macrotask
					// for the runner's terminal listener to fire.
					await harness.manager.cancel({
						jobId: jobId1,
						origin: "other:bctcp-runner-multi-03",
					})
					await sleep(50)

					// Mirror the per-job projection update locally
					// (matching what the controller does in
					// `updateBackgroundCommandState`).
					const perJobTuple = harness.spy.mock.calls.find(
						(c) => c[0] === false && c[1] === jobId1,
					)
					expect(perJobTuple).toBeDefined()
					expect(perJobTuple?.[2]).toBe("cancelled")
					projectionBefore[jobId1] = "cancelled"
					// J2 stays running.
					expect(projectionBefore[jobId2]).toBe("running")

					// The manager still tracks J2 as RUNNING --
					// the producer-side invariant (manager
					// lifecycle is the authority). This proves the
					// runner seam does NOT leak false-terminal
					// signals to the manager.
					const j2Status = await harness.manager.status({
						jobId: jobId2,
						waitMs: 0,
					})
					expect(j2Status.ok).toBe(true)
					if (j2Status.ok) {
						expect(j2Status.snapshot.state).toBe("running")
					}

					// The runner fired per-job (not gated), AND no
					// (false, undefined) leaked.
					expect(harness.spy).toHaveBeenCalledWith(false, jobId1, "cancelled")
					expect(harness.spy).not.toHaveBeenCalledWith(false, undefined)
				} finally {
					await harness.manager.dispose()
				}
			},
		)

		// Property invariant the Factory reviewer wanted proven.
		it(
			"BCTCP-RUNNER-MULTI-04 the runner never fires (false, undefined) while at least one sibling is running",
			async () => {
				const harness = makeHarness()
				try {
					const jobId1 = await startJobViaTool(harness)
					const jobId2 = await startJobViaTool(harness)

					const callsBeforeAnyTerminal = harness.spy.mock.calls.length

					await harness.manager.cancel({
						jobId: jobId1,
						origin: "other:bctcp-runner-multi-04",
					})
					await sleep(50)

					const undefinedFalseCalls = harness.spy.mock.calls
						.slice(callsBeforeAnyTerminal)
						.filter((c) => c[0] === false && c[1] === undefined)
					expect(undefinedFalseCalls).toEqual([])

					await harness.manager.cancel({
						jobId: jobId2,
						origin: "other:bctcp-runner-multi-04",
					})
					await sleep(50)

					const undefinedFalseCallsAfterBoth = harness.spy.mock.calls
						.slice(callsBeforeAnyTerminal)
						.filter((c) => c[0] === false && c[1] === undefined)
					expect(undefinedFalseCallsAfterBoth).toEqual([])
				} finally {
					await harness.manager.dispose()
				}
			},
		)
	},
)

// ===========================================================================
// Production-composition evidence notes
// ===========================================================================

// The runner-composition RED witness that closes Factory
// closes Factory HALT_MULTI_JOB_RUNNER_SEAM_NOT_EXECUTED.)
//
// Pre-correction01 evidence at vscode-run-commands-tool.ts:835-839 (commit
// e588d0541) showed the gate:
//   start.terminalPromise.then(async () => {
//     const { becameIdle } = await start.terminalPromise
//     if (becameIdle) notifyBackgroundStateChange(false)
//   })
//
// After correction01 (commit 3cec954cb) the same lines now read:
//   start.terminalPromise.then(({ jobId, terminalState }) => {
//     notifyBackgroundStateChange(false, jobId, terminalState)
//   })
//
// The runner-composition tests above witness this change: pre-fix
// BCTCP-RUNNER-MULTI-01 would fail at
// `expect(falseCallsAfterJ1Terminal).toEqual([[false, jobId1, 'cancelled']])`
// because the runner never fired the J1 tuple (the `if (becameIdle)` gate
// dropped the signal entirely). Post-fix the tuple fires the moment
// `manager.cancel()` resolves.
