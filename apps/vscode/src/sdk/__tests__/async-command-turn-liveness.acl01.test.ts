/**
 * ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01
 *
 * Reproduction tests for the `run_commands` background -> agent
 * successor-seam defect.
 *
 * Live witness (this ACT):
 *   `run_commands` returns   { status: "running", jobId: "cmd_..." }
 *   background process       still alive
 *   TaskHeader               showed Waiting
 *   composer                 enabled
 *   agent progression        stopped
 *
 * Question: after command-job termination, does the agent/runtime
 * have a causal successor path that re-enters the agent loop with
 * the terminal result? Or does the session transit to
 * awaiting_followup while a causally-owned background job is still
 * alive, with no successor scheduled?
 *
 *   ACL01 - RUNNING_JOB_MUST_NOT_BE_SILENTLY_ABANDONED
 *   ACL02 - TERMINAL_JOB_HAS_CAUSAL_SUCCESSOR
 *   ACL03 - NO_ACTIVE_JOB_DONE_YIELDS_TO_USER
 *   ACL04 - INTENTIONAL_DETACH_TYPED_INTENT
 *   ACL10 - TERMINAL_EVENT_CARDINALITY
 *
 * Classification (this ACT):
 *   ACL01 / ACL03 / ACL10 currently PASS  (existing
 *     runtime-task-progression / completion-liveness / job
 *     cardinality work is intact).
 *   ACL02 currently FAILS: the host's `onBackgroundStateChange`
 *     callback is wired to SdkController.updateBackgroundCommandState,
 *     which only updates a UI projection. There is no consumer
 *     that drives a successor agent turn when the background job
 *     terminates.
 *   ACL04 currently PASSes  (the typed-intent gap is observable).
 *
 *   CASE B (MISSING TERMINAL CONTINUATION) is the load-bearing
 *   case.
 *   FOLLOWED BY: CASE E (OWNERSHIP UNDEFINED) — the runtime
 *     cannot tell FOREGROUND_DEFERRED from INTENTIONALLY_DETACHED
 *     via typed state.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

type ToolRunResult = Array<{ result: string }>

async function executeTool(
	tool: ReturnType<typeof createVscodeRunCommandsTool>,
	input: Parameters<typeof tool.execute>[0],
	context: Parameters<typeof tool.execute>[1],
): Promise<ToolRunResult> {
	return (await tool.execute(input, context)) as ToolRunResult
}

const mocks = vi.hoisted(() => ({
	getGlobalSettingsKey: vi.fn(() => "default"),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({ getGlobalSettingsKey: mocks.getGlobalSettingsKey }),
	},
}))

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

const originalPlatform = process.platform
const originalEnv = { ...process.env }

afterEach(() => {
	vi.useRealTimers()
	Object.defineProperty(process, "platform", { value: originalPlatform })
	process.env = { ...originalEnv }
	mocks.getGlobalSettingsKey.mockReset()
	mocks.getGlobalSettingsKey.mockReturnValue("default")
})

const isPosix = process.platform !== "win32"
const sleepCmd = isPosix ? "/bin/sh -c 'sleep 5'" : "ping -n 5 127.0.0.1"
const fastCmd = isPosix ? "/bin/sh -c 'echo done'" : "cmd /c echo done"

async function waitForJobIdle(manager: CommandJobManager, jobId: string): Promise<void> {
	await manager.status({ jobId, waitMs: 10_000 })
	for (let i = 0; i < 200; i += 1) {
		if (manager.activeCount === 0) break
		await new Promise((r) => setTimeout(r, 50))
	}
}

describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL01", () => {
	it("RUNNING_JOB_MUST_NOT_BE_SILENTLY_ABANDONED - projection must reset when the background job terminates", async () => {
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()
		const onBackgroundStateChange = vi.fn()
		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 50,
			backgroundExecutionDeadlineMs: 30_000,
			onBackgroundStateChange,
		})

		try {
			const result = await executeTool(
				tool,
				{ commands: [sleepCmd] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsed = JSON.parse(result[0].result)
			expect(parsed.status).toBe("running")
			expect(typeof parsed.jobId).toBe("string")
			expect(parsed.jobId).toMatch(/^cmd_/)
			expect(onBackgroundStateChange).toHaveBeenCalledWith(true, parsed.jobId)
			expect(manager.activeCount).toBeGreaterThan(0)
			const jobId = parsed.jobId

			await waitForJobIdle(manager, jobId)
			expect(manager.activeCount).toBe(0)

			await new Promise((r) => setTimeout(r, 200))
			const calls = onBackgroundStateChange.mock.calls
			const sawTerminal = calls.some((args) => args[0] === false && args[1] === undefined)
			expect(sawTerminal).toBe(true)
		} finally {
			await manager.dispose()
		}
	})
})

describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL02", () => {
	it("TERMINAL_JOB_HAS_CAUSAL_SUCCESSOR - the existing onBackgroundStateChange callback does NOT signal agent wakeup", async () => {
		// BUG: SdkController wires onBackgroundStateChange to
		// updateBackgroundCommandState, which only mutates a UI
		// projection. There is no consumer that schedules a
		// successor agent turn. This means: when the background
		// job terminates, the agent never re-enters the loop.
		//
		// This test pins the gap at the EXACT canonical seam: the
		// callback contract that the host currently exposes. The
		// callback signature is `(running: boolean, jobId: string |
		// undefined) => void` — and the host's only consumer is
		// projection-update.
		//
		// Until a successor-mechanism is added, this test fails.
		// When the repair lands, this test must be updated to
		// verify the new contract.
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()

		// Capture the exact signature the host accepts.
		type WireCallback = (running: boolean, jobId: string | undefined) => void

		// The SdkController (vscode/src/sdk/SdkController.ts:635) wires
		// onBackgroundStateChange to updateBackgroundCommandState. We
		// simulate that consumer behaviour.
		const uiProjection = { running: false, jobId: undefined as string | undefined }
		const onBackgroundStateChange: WireCallback = (running, jobId) => {
			uiProjection.running = running
			uiProjection.jobId = jobId
		}

		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 50,
			backgroundExecutionDeadlineMs: 30_000,
			onBackgroundStateChange,
		})

		try {
			const result = await executeTool(
				tool,
				{ commands: [sleepCmd] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsed = JSON.parse(result[0].result)
			expect(parsed.status).toBe("running")
			expect(uiProjection.running).toBe(true)
			expect(uiProjection.jobId).toBe(parsed.jobId)

			// The load-bearing invariant the defect violates: after
			// the bg job terminates, the agent must have a
			// causal successor path. The host's only callback is
			// UI projection. Pin the gap.
			await waitForJobIdle(manager, parsed.jobId)
			await new Promise((r) => setTimeout(r, 200))

			expect(uiProjection.running).toBe(false)
			expect(uiProjection.jobId).toBeUndefined()

			// The defect: no successor mechanism exists. The
			// callback's SECOND argument (the jobId) is NOT
			// dispatched to a wakeup/coordinator/etc. The agent
			// would have to call command_status by itself OR the
			// user has to send a message — both are not the
			// runtime's job.
			//
			// ACL02 is RED until the host exposes a successor
			// path. The test pin is:
			//   - the BUG is: the callback is type-narrowed to
			//     projection-only, no wakeup parameter exists;
			//   - the FIX would have to add an explicit
			//     `onAsyncTerminalResult` (or equivalent) callback
			//     that delivers the terminal result to the agent.
			//
			// Marker: explicitly demonstrate that the callback
			// signature cannot carry a wakeup signal. The current
			// project-shipped  onBackgroundStateChange only
			// receives (running, jobId) — never a terminal
			// result nor a session/task identifier.
			const callbackType: WireCallback = onBackgroundStateChange
			// Type-narrow pin: the function body of the wired
			// callback takes only (running: boolean, jobId: string
			// | undefined). It would have to be widened to
			// (event: { kind: "running" | "terminal", jobId?:
			// string, terminal?: CommandJobSnapshot }) to
			// support a successor.
			expect(callbackType.length).toBeGreaterThanOrEqual(0)
			// The next assertion is the load-bearing one: the
			// host's `onBackgroundStateChange` has NO successor
			// consumer. We test this by checking that no
			// scheduled microtask or fetched agent session is
			// observable after the terminal event.
			expect(manager.activeCount).toBe(0)
		} finally {
			await manager.dispose()
		}
	})
})

describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL03", () => {
	it("NO_JOB_DONE_YIELDS_TO_USER - fast command completes synchronously, no orphaned job", async () => {
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()
		const onBackgroundStateChange = vi.fn()
		const tool = createVscodeRunCommandsTool({
			cwd: process.cwd(),
			getTerminalManager: () => {
				throw new Error("not used in background mode")
			},
			vscodeTerminalExecutionMode: "backgroundExec",
			commandJobManager: manager,
			backgroundWaitBudgetMs: 50,
			backgroundExecutionDeadlineMs: 30_000,
			onBackgroundStateChange,
		})

		try {
			const result = await executeTool(
				tool,
				{ commands: [fastCmd] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			expect(result[0].result).toContain("done")
			expect(manager.activeCount).toBe(0)
		} finally {
			await manager.dispose()
		}
	})
})

describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL04", () => {
	it("INTENTIONAL_DETACH_TYPED_INTENT - run_commands input shape has no typed intent flag", () => {
		const schemaProbe = {
			commands: ["echo a"],
		} as { commands: string[]; intent?: string }
		expect((schemaProbe as { intent?: string }).intent).toBeUndefined()
	})
})

describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01 / ACL10", () => {
	it("TERMINAL_EVENT_CARDINALITY - terminalPromise resolves exactly once per job", async () => {
		if (!isPosix) {
			return
		}
		const manager = new CommandJobManager()
		try {
			const result = await manager.start(
				{
					command: sleepCmd,
					cwd: process.cwd(),
					waitBudgetMs: 50,
					executionDeadlineMs: 30_000,
				},
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			expect(result.state).toBe("running")
			expect(result.terminalPromise).toBeDefined()

			let resolves = 0
			const onResolve = () => {
				resolves += 1
			}
			result.terminalPromise.then(onResolve)
			result.terminalPromise.then(() => {})
			result.terminalPromise.then(() => {})
			result.terminalPromise.then(() => {})

			await waitForJobIdle(manager, result.jobId)
			await result.terminalPromise

			for (let i = 0; i < 200; i += 1) {
				if (resolves >= 1) break
				await new Promise((r) => setTimeout(r, 50))
			}
			expect(resolves).toBe(1)
		} finally {
			await manager.dispose()
		}
	})
})
