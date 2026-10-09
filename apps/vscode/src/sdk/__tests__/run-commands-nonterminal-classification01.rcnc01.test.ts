/**
 * ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01 — RCNC01
 *
 * Repair target: the user-visible `Run failed` (containment_failed) chat
 * row pill that coexists with a `command_status` observation whose
 * payload is `{ status: "running", jobId: J, elapsedMs: <alive>, ... }`.
 *
 * The captured LIVE specimen (2026-10-09 / jobId `cmd_mv0l6blcq0mavibu`):
 *
 *   - chat row pill: "Run failed" (the `containment_failed` projection
 *     under the existing `CommandStatusMap.containment_failed === "Run failed"`
 *     pill in `apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx:367`)
 *   - agent tool result row: `{ status: "running", jobId, elapsedMs: 15001,
 *     deadlineRemainingMs: 584999, outputTruncated: false, stdout: "" }`
 *
 * Causal discriminator: PROJECTION_DESYNC. The `backgroundCommandJobStates`
 * projection map is written exclusively by `onBackgroundStateChange` callbacks
 * at the `vscode-run-commands-tool.ts:879,902,983,1036` seams. The
 * `command_status` tool (the canonical nonterminal observation seam) does NOT
 * reconcile the projection when it observes `state: "running"`. Therefore a
 * one-shot desync — e.g. a stale terminal write that survived a session/task
 * boundary, a misdelivered terminal wake, or a still-pending
 * `command_job_containment_failed` emit that fires while the job is actually
 * alive — leaves the projection terminal even when the manager says running.
 * The chat row's `liveProjectionTerminalValue` then reads terminal from the
 * map and renders `Run failed`, even though the latest canonical observation
 * says running.
 *
 * Bounded repair: extend `command_status` to fire a per-call
 * `onRunningObserved(jobId)` callback when the manager snapshot's state is
 * `"running"`. Wire the callback from `vscode-runtime-builder.ts:277-282` to
 * the existing `onBackgroundStateChange` (which the production
 * `SdkController.updateBackgroundCommandState` already maps to the
 * per-job projection map; the function is idempotent and short-circuits
 * when the projection is already `running`).
 */
import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CommandJobManager, type CommandJobState } from "../command-job-manager"
import { createCommandStatusTool } from "../command-status-tool"
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

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

vi.mock("@services/telemetry/TelemetryService", () => ({
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
let supervisorPidCounter = 900000

interface FakeSupervisorHandle {
	supervisor: SupervisableShellProcess
	resolveExit: (code: number | null) => void
	pgid: number
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
	return { supervisor, resolveExit, pgid }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
type SpyListener = (running: boolean, jobId: string | undefined, terminalState?: Exclude<CommandJobState, "running">) => void

type Projection = Record<
	string,
	"running" | "exited" | "cancelled" | "deadline_exceeded" | "spawn_failed" | "containment_failed" | "terminal"
>

interface Harness {
	manager: CommandJobManager
	runTool: ReturnType<typeof createVscodeRunCommandsTool>
	projection: Projection
	spy: ReturnType<typeof vi.fn>
	supervisorsByJobId: Map<string, FakeSupervisorHandle>
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
	const projection: Projection = {}
	const supervisorsByJobId = new Map<string, FakeSupervisorHandle>()
	const runTool = createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("foreground not used in background test")
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
				projection[jobId] = "running"
				const next = supervisorFifo.shift()
				if (next) {
					supervisorsByJobId.set(jobId, next)
				}
			} else if (!running && jobId) {
				projection[jobId] = terminalState ?? "terminal"
			}
		},
	})
	return { manager, runTool, projection, spy, supervisorsByJobId }
}
async function startLongRunningJobViaTool(harness: Harness): Promise<string> {
	const result = await harness.runTool.execute(
		{ commands: ["/bin/sh -c 'sleep 30'"] },
		{ agentId: "test-agent", conversationId: "conv-rcnc01", iteration: 1 },
	)
	const arr = Array.isArray(result) ? (result as Array<{ result: string }>) : []
	const first = arr[0]
	const parsed = JSON.parse(first?.result ?? "{}")
	const jobId = parsed.jobId as string
	expect(parsed.status).toBe("running")
	expect(jobId).toBeTruthy()
	return jobId
}

interface StatusHarness {
	manager: CommandJobManager
	projection: Projection
	onRunningObservedSpy: ReturnType<typeof vi.fn>
	statusTool: ReturnType<typeof createCommandStatusTool>
}

function makeStatusHarness(h: Harness): StatusHarness {
	// The bounded fix introduces a new option on
	// `CreateCommandStatusToolOptions`. We wrap the projection map
	// with a reconciliation function and assert through the spy.
	// Pre-repair the option is silently ignored (typed as a
	// bypass-cast because the post-repair interface adds the
	// option).
	const onRunningObservedSpy = vi.fn((jobId: string) => {
		if (h.projection[jobId] !== "running") {
			h.projection[jobId] = "running"
		}
	})
	const statusTool = createCommandStatusTool(h.manager, {
		// biome-ignore lint/suspicious/noExplicitAny: test seam (option added by the bounded fix)
		onRunningObserved: onRunningObservedSpy,
	} as unknown as Parameters<typeof createCommandStatusTool>[1])
	return {
		manager: h.manager,
		projection: h.projection,
		onRunningObservedSpy,
		statusTool,
	}
}

describe("ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01 / RCNC01", () => {
	it("RCNC-01: a nonterminal command_status observation reconciles a stale terminal projection back to running", async () => {
		const harness = makeHarness()
		const status = makeStatusHarness(harness)
		try {
			const jobId = await startLongRunningJobViaTool(harness)

			// Sanity: runner emitted (true, jobId) and the projection
			// is "running" after the backgrounded start.
			expect(harness.projection[jobId]).toBe("running")
			expect(harness.manager.activeCount).toBe(1)

			// Simulate the live-specimen desync: the projection
			// is poisoned with a stale "containment_failed"
			// write that the chat row would render as "Run
			// failed". The job is still alive in the manager.
			harness.projection[jobId] = "containment_failed"
			expect(harness.projection[jobId]).toBe("containment_failed")

			// Drive the canonical nonterminal observation
			// through the production `command_status` tool with
			// waitMs=0.
			const statusResult = (await status.statusTool.execute(
				{ jobId, waitMs: 0 },
				{ agentId: "test-agent", conversationId: "conv-rcnc01", iteration: 1 },
			)) as Array<{ ok: boolean; jobId?: string; state?: string }>
			expect(statusResult[0]?.ok).toBe(true)
			expect(statusResult[0]?.state).toBe("running")
			expect(statusResult[0]?.jobId).toBe(jobId)

			// THE BOUNDED FIX: the projection MUST be reconciled
			// to "running" by the command_status observation.
			// The callback is invoked with
			// `(jobId, { isLiveInManager: true })` per the
			// RCNC02-05/06 terminal-monotonicity contract
			// (the manager snapshot's `state === "running"` is
			// the evidence that authorizes the bounded fix's
			// load-bearing reconciliation path).
			expect(status.onRunningObservedSpy).toHaveBeenCalledWith(jobId, { isLiveInManager: true })
			expect(harness.projection[jobId]).toBe("running")
		} finally {
			await harness.manager.dispose()
		}
	})

	it("RCNC-02: a real command failure still reports a terminal projection (no false-running reconciliation)", async () => {
		const harness = makeHarness()
		const status = makeStatusHarness(harness)
		try {
			const jobId = await startLongRunningJobViaTool(harness)
			const handle = harness.supervisorsByJobId.get(jobId)
			expect(handle).toBeDefined()
			if (!handle) return

			// Drive the supervisor to a natural nonzero exit.
			handle.resolveExit(7)
			for (let i = 0; i < 50; i += 1) {
				if (harness.projection[jobId] !== "running") break
				await sleep(5)
			}
			expect(harness.manager.activeCount).toBe(0)
			expect(harness.projection[jobId]).toBe("exited")

			// A subsequent command_status on the terminal job
			// MUST observe the terminal state.
			const statusResult = (await status.statusTool.execute(
				{ jobId, waitMs: 0 },
				{ agentId: "test-agent", conversationId: "conv-rcnc01", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(statusResult[0]?.ok).toBe(true)
			expect(statusResult[0]?.state).toBe("exited")
			// The reconciliation callback MUST NOT fire for
			// a terminal observation.
			expect(status.onRunningObservedSpy).not.toHaveBeenCalled()
		} finally {
			await harness.manager.dispose()
		}
	})

	it("RCNC-04: the final terminal observation publishes once, projection reconciles to terminal", async () => {
		const harness = makeHarness()
		const status = makeStatusHarness(harness)
		try {
			const jobId = await startLongRunningJobViaTool(harness)
			const handle = harness.supervisorsByJobId.get(jobId)
			expect(handle).toBeDefined()
			if (!handle) return

			// Initial running observation is consistent.
			const firstStatus = (await status.statusTool.execute(
				{ jobId, waitMs: 0 },
				{ agentId: "test-agent", conversationId: "conv-rcnc01", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(firstStatus[0]?.state).toBe("running")
			expect(harness.projection[jobId]).toBe("running")

			// Terminate cleanly.
			handle.resolveExit(0)
			for (let i = 0; i < 50; i += 1) {
				if (harness.projection[jobId] !== "running") break
				await sleep(5)
			}
			expect(harness.projection[jobId]).toBe("exited")

			// Subsequent running reconciliation MUST NOT
			// re-flip the projection after the terminal
			// state has been observed and published.
			const secondStatus = (await status.statusTool.execute(
				{ jobId, waitMs: 0 },
				{ agentId: "test-agent", conversationId: "conv-rcnc01", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(secondStatus[0]?.state).toBe("exited")
			expect(harness.projection[jobId]).toBe("exited")
		} finally {
			await harness.manager.dispose()
		}
	})

	it("RCNC-05: a cancelled job reports cancelled (not running) and the projection is NOT flipped to running", async () => {
		const harness = makeHarness()
		const status = makeStatusHarness(harness)
		try {
			const jobId = await startLongRunningJobViaTool(harness)

			// Public cancel() seam (the production
			// cancellation authority). Drives the manager
			// through terminate() -> finalize() -> the
			// runner's terminalPromise listener -> the
			// projection.
			await harness.manager.cancel({
				jobId,
				origin: "other:rcnc01-cancel",
			})
			for (let i = 0; i < 50; i += 1) {
				if (harness.projection[jobId] !== "running") break
				await sleep(5)
			}
			expect(harness.projection[jobId]).toBe("cancelled")
			expect(harness.manager.activeCount).toBe(0)

			// A subsequent command_status on the cancelled
			// job MUST observe the terminal state.
			const statusResult = (await status.statusTool.execute(
				{ jobId, waitMs: 0 },
				{ agentId: "test-agent", conversationId: "conv-rcnc01", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>
			expect(statusResult[0]?.ok).toBe(true)
			expect(statusResult[0]?.state).toBe("cancelled")
			expect(harness.projection[jobId]).toBe("cancelled")
		} finally {
			await harness.manager.dispose()
		}
	})

	it("RCNC-06: the bounded fix does NOT change the initial-wait vs execution-deadline semantics", async () => {
		// The bounded fix touches the projection on a
		// running observation, NOT the manager's wait
		// budget / execution deadline logic. This test
		// pins the unchanged behavior: a tool call that
		// returns the running envelope after the wait
		// budget keeps the process alive past the wait
		// budget (the wait budget is NOT a kill).
		const harness = makeHarness()
		try {
			const jobId = await startLongRunningJobViaTool(harness)
			// Wait budget was 50ms; the fake supervisor is
			// still alive (we did not call resolveExit).
			expect(harness.manager.activeCount).toBe(1)
			const handle = harness.supervisorsByJobId.get(jobId)
			expect(handle).toBeDefined()
			if (!handle) return
			// The supervisor's exit promise is still pending,
			// the manager's job is still alive.
			expect(harness.projection[jobId]).toBe("running")
		} finally {
			await harness.manager.dispose()
		}
	})
})
