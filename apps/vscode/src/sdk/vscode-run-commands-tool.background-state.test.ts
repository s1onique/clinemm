/**
 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01 — RED tests for the background
 * execution state callback seam.
 *
 * The `run_commands` tool, when run in `backgroundExec` mode, returns a
 * `state: "running"` payload to the model and the host keeps the
 * process alive. The host's `SdkController` exposes a
 * `backgroundCommandRunning` projection to the webview that gates
 * the user-facing Cancel button's first action (cancel the background
 * command before cancelling the task).
 *
 * Until this ACT, the projection was dead state:
 *  - `SdkController.updateBackgroundCommandState()` was never called
 *  - `SdkController.cancelBackgroundCommand()` was a `stubWarn`
 *  - The webview always saw `backgroundCommandRunning: false`
 *
 * These tests pin the contract at the canonical seam. The boundary
 * events covered here are:
 *  1. Tool returns `state: "running"` -> callback fires with `true, jobId`
 *  2. Tool returns a terminal state -> callback fires with `false, undefined`
 *  3. Tool returns RUNNING and the process later completes
 *     asynchronously -> callback fires again with `false, undefined`
 *     (RTP-ASYNC01 — the projection MUST reset to idle when the
 *     in-flight background command eventually completes, otherwise
 *     the webview gets stuck rendering "Working" forever).
 *  4. Wait-budget expiry MUST NOT cancel the running process — the
 *     process must survive after the tool call returns and complete
 *     naturally (RTP-LONG01 — the upstream-cline issue class
 *     #10549: a fixed short timeout that kills work is observable
 *     user harm).
 *
 * If these tests are GREEN, the projection is wired and the runtime
 * either starts the next step (model polling), yields to the user
 * (Cancel button routes the cancel correctly), or surfaces an
 * explicit failure — the load-bearing progression guarantee.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ToolOperationResult } from "@cline/core"
import { CommandJobManager } from "./command-job-manager"
import { createVscodeRunCommandsTool } from "./vscode-run-commands-tool"

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

/**
 * Execute the produced tool with a concrete `ToolOperationResult[]`
 * return type. The shell tool always returns `ToolOperationResult[]`,
 * but the generic `AgentTool<unknown, ToolOperationResult[]>` returns
 * `Promise<TOutput>`, so the raw `result` field is `unknown` — this
 * helper narrows it so the assertions below stay type-safe.
 */
type ToolRunResult = ToolOperationResult[]
async function executeTool(
	tool: ReturnType<typeof createVscodeRunCommandsTool>,
	input: Parameters<typeof tool.execute>[0],
	context: Parameters<typeof tool.execute>[1],
): Promise<ToolRunResult> {
	return (await tool.execute(input, context)) as ToolRunResult
}

describe("createVscodeRunCommandsTool — background state callback (ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01)", () => {
	it("emits onBackgroundStateChange(true, jobId) when the tool returns RUNNING", async () => {
		if (!isPosix) {
			// The supervisor uses POSIX kill-tree semantics; skip on Windows.
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
			expect(parsed.jobId).toBeTruthy()

			// The callback MUST fire with (true, jobId) when the tool returns
			// RUNNING — this is the production progression guarantee.
			expect(onBackgroundStateChange).toHaveBeenCalledWith(true, parsed.jobId)
		} finally {
			await manager.dispose()
		}
	})

	it("emits onBackgroundStateChange(false, undefined) when the command completes before the wait budget", async () => {
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
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 5_000,
			onBackgroundStateChange,
		})

		try {
			// Fast command — terminal state reached before the wait budget
			// expires. The callback fires once with (false, undefined); no
			// prior RUNNING transition because the tool never returned RUNNING.
			const result = await executeTool(
				tool,
				{ commands: ["/bin/sh -c \"printf 'fast-ok\\n'\""] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			expect(result[0].result).toContain("fast-ok")

			// Fast path: terminal state reached before the wait budget
			// expired. The callback fires once with (false, undefined).
			expect(onBackgroundStateChange).toHaveBeenCalledTimes(1)
			expect(onBackgroundStateChange).toHaveBeenCalledWith(false, undefined)
		} finally {
			await manager.dispose()
		}
	})

	// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01 RTP-LONG01: conservation
	// witness for the 15s wait-budget / 10m execution-deadline contract.
	// Wait-budget expiry MUST NOT cancel the running process — the
	// process must survive after the tool call returns and complete
	// naturally. This is the upstream-cline issue class (#10549 "tool
	// silently times out at 30s with misleading error"): a fixed
	// short timeout that kills work is observable user harm.
	//
	// The previous test only proves the wait-budget crossing does not
	// synchronously block the tool call; it does NOT prove the process
	// survives the tool call RETURNING, because the finally block
	// immediately calls `manager.dispose()` which kills the still-
	// running job. This test deliberately skips the dispose until
	// the process has terminally completed naturally, proving the
	// conservation invariant at the production seam.
	it("RTP-LONG01: console-sh background job survives after the tool call returns and completes naturally (no cancel, no deadline)", async () => {
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
			// wait budget ~30ms, deadline far larger than the command
			backgroundWaitBudgetMs: 30,
			backgroundExecutionDeadlineMs: 5_000,
			onBackgroundStateChange,
		})

		try {
			// Scaled-down long-running command: ~250ms sleep, well past
			// the wait budget but well within the deadline.
			const result = await executeTool(
				tool,
				{ commands: ["/bin/sh -c \"sleep 0.25\""] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsed = JSON.parse(result[0].result)
			expect(parsed.status).toBe("running")
			expect(parsed.jobId).toBeTruthy()

			// The projection fires true on the RUNNING return — proves
			// the wait-budget expiry did not synchronously cancel.
			expect(onBackgroundStateChange).toHaveBeenCalledWith(true, parsed.jobId)

			// Now poll status every ~100ms until the job terminal-
			// completes (or the test times out). The job must complete
			// naturally within the deadline — NOT via cancel, NOT via
			// deadline_exceeded. This is the load-bearing conservation
			// invariant: 15s wait-budget expiry does not kill running work.
			const deadlineAt = Date.now() + 4_000
			let finalState: string | undefined
			while (Date.now() < deadlineAt) {
				const s = await manager.status({ jobId: parsed.jobId, waitMs: 100 })
				if (s.ok && s.snapshot.state !== "running") {
					finalState = s.snapshot.state
					break
				}
			}
			expect(finalState).toBe("exited")
		} finally {
			await manager.dispose()
		}
	})

	// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01 RTP-ASYNC01: the
	// asynchronous terminal projection reset. When the tool returns
	// RUNNING and the process later completes asynchronously (after
	// the tool call returns), the callback MUST fire again with
	// (false, undefined) so the host's projection flips back to idle.
	// Pre-fix this is RED: the tool returns RUNNING, the projection
	// flips true, and stays true forever (the run_commands tool is
	// no longer executing when the process terminal-completes, so
	// no in-function callback can fire).
	//
	// We scale the running process to ~250ms so the test runs
	// quickly. The wait budget is ~30ms so the tool returns RUNNING.
	// We then wait for the process to complete naturally (~250ms wall
	// clock from the start) and assert the callback fired with
	// (false, undefined).
	it("RTP-ASYNC01: when the tool returns RUNNING, the callback fires again with (false, undefined) after the process completes asynchronously", async () => {
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
			backgroundWaitBudgetMs: 30,
			backgroundExecutionDeadlineMs: 5_000,
			onBackgroundStateChange,
		})

		try {
			const result = await executeTool(
				tool,
				{ commands: ["/bin/sh -c \"sleep 0.25\""] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsed = JSON.parse(result[0].result)
			expect(parsed.status).toBe("running")
			expect(parsed.jobId).toBeTruthy()

			// The first call flipped the projection to true.
			expect(onBackgroundStateChange).toHaveBeenCalledWith(true, parsed.jobId)
			const callsAfterToolReturn = onBackgroundStateChange.mock.calls.length

			// Poll until the job terminal-completes naturally. We do
			// not call manager.cancel() — the process MUST complete
			// on its own.
			const deadlineAt = Date.now() + 4_000
			let terminalState: string | undefined
			while (Date.now() < deadlineAt) {
				const s = await manager.status({ jobId: parsed.jobId, waitMs: 100 })
				if (s.ok && s.snapshot.state !== "running") {
					terminalState = s.snapshot.state
					break
				}
			}
			expect(terminalState).toBe("exited")

			// After the process completes asynchronously, the callback
			// MUST fire once more with (false, undefined). Pre-fix this
			// is RED: the callback chain inside the tool execution
			// closes when the tool returns RUNNING, so the async
			// completion cannot fire the callback.
			await vi.waitFor(
				() => {
					expect(onBackgroundStateChange.mock.calls.length).toBeGreaterThan(callsAfterToolReturn)
				},
				{ timeout: 1_000, interval: 10 },
			)
			// The last call must be (false, undefined).
			const lastCall = onBackgroundStateChange.mock.calls[onBackgroundStateChange.mock.calls.length - 1]
			expect(lastCall).toEqual([false, undefined])
		} finally {
			await manager.dispose()
		}
	})
})
