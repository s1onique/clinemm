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
 * These tests pin the contract at the canonical seam (the boundary
 * between `CommandJobManager.start()` returning and the model
 * seeing the result). The two boundary events are:
 *  1. Tool returns `state: "running"` → callback fires with `true, jobId`
 *  2. Tool returns a terminal state → callback fires with `false, undefined`
 *
 * If this ACT is GREEN, the projection is wired and the runtime
 * either starts the next step (model polling), yields to the user
 * (Cancel button routes the cancel correctly), or surfaces an
 * explicit failure — the load-bearing progression guarantee.
 *
 * If this ACT is RED, the dead state remains and the user's Cancel
 * click races with the background command rather than arbitrating it.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
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
			const result = await tool.execute(
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
			// expires. The contract: the callback fires once with
			// (false, undefined) when the command completes before the wait
			// budget. The webhook does NOT need to flip true first because
			// the tool never returned RUNNING — the host's projection
			// stays false throughout.
			const result = await tool.execute(
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
})
