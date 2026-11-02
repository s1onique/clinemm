import { CommandExitError, CommandSpawnError, CommandTerminationError } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ITelemetryProvider } from "@/services/telemetry/providers/ITelemetryProvider"
import { createVscodeRunCommandsTool } from "./vscode-run-commands-tool"
import { getEffectiveTerminalExecutionMode } from "./vscode-terminal-execution-mode"

const mocks = vi.hoisted(() => ({
	/**
	 * ACT-CLINEMM-FORK-UPSTREAM-MERGE01: the fork's background execution
	 * path is owned by the host-owned `CommandJobManager` (the fork's
	 * terminal execution coordination authority), NOT by the SDK's
	 * `createShellExecutor` that upstream's background path used. The
	 * upstream test mocked `createShellExecutor`, which the merged tool
	 * never calls on the background path, so the mock never intercepted
	 * anything and every assertion failed.
	 *
	 * This mock now stands in for the fork's seam: `CommandJobManager.start`.
	 */
	startBackgroundJob: vi.fn(),
	log: vi.fn<ITelemetryProvider["log"]>(),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: () => ({ getGlobalSettingsKey: () => "default" }) },
}))

// Bypass only singleton/host initialization: keep the real capture method and
// provider dispatch so these assertions inspect the emitted telemetry event.
vi.mock("@services/telemetry", async () => {
	const { NoOpTelemetryProvider } = await import("@/services/telemetry/TelemetryProviderFactory")
	const { TelemetryService, TerminalUserInterventionAction } = await import("@/services/telemetry/TelemetryService")
	const provider = new NoOpTelemetryProvider()
	provider.log = mocks.log
	return {
		TerminalUserInterventionAction,
		telemetryService: new TelemetryService([provider], {
			extension_version: "test",
			cline_type: "cline-unit-tests",
			platform: "test-platform",
			platform_version: "1.0.0",
			os_type: "test-os",
			os_version: "test",
			is_remote_workspace: false,
			is_dev: "true",
		}),
	}
})

beforeEach(() => {
	mocks.startBackgroundJob.mockReset()
	mocks.log.mockClear()
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe.each([
	{ standalone: "true", terminalType: "standalone", requestedMode: "vscodeTerminal" as const },
	{ standalone: "false", terminalType: "vscode", requestedMode: "backgroundExec" as const },
	{ standalone: undefined, terminalType: "vscode", requestedMode: "backgroundExec" as const },
])("background telemetry with IS_STANDALONE=$standalone", ({ standalone, terminalType, requestedMode }) => {
	it.each([
		{ outcome: "success", error: undefined, success: true, dimensions: { exitCode: 0 } },
		{
			outcome: "nonzero exit",
			error: new CommandExitError(7, "command failed"),
			success: false,
			dimensions: { exitCode: 7 },
		},
		{
			outcome: "missing executable",
			error: new CommandSpawnError(Object.assign(new Error("spawn missing-shell ENOENT"), { code: "ENOENT" })),
			success: false,
			dimensions: { errorCode: "ENOENT" },
		},
		{
			outcome: "signal termination",
			error: new CommandTerminationError("SIGTERM", "command interrupted"),
			success: false,
			dimensions: { errorCode: "signal" },
		},
		{
			outcome: "termination without an exit code",
			error: new CommandTerminationError(null, "command interrupted"),
			success: false,
			dimensions: { errorCode: "no_exit_code" },
		},
		{ outcome: "execution error", error: new Error("execution failed"), success: false, dimensions: { errorCode: "other" } },
	])("captures the $outcome event with the actual host label", async ({ error, success, dimensions }) => {
		vi.stubEnv("IS_STANDALONE", standalone)
		// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: the fork's background path is
		// driven by the host-owned `CommandJobManager`, so the mock now
		// stands in for `CommandJobManager.start`. A SUCCESSFUL start
		// resolves with a terminal in-band result (the fork's fast path);
		// a FAILING start rejects with the error under test.
		if (error) {
			mocks.startBackgroundJob.mockRejectedValueOnce(error)
		} else {
			mocks.startBackgroundJob.mockResolvedValueOnce({
				jobId: "job-1",
				state: "exited",
				exitCode: 0,
				stdout: "command output",
				stderr: "",
			})
		}
		const getTerminalManager = vi.fn(() => {
			throw new Error("Background mode must not initialize a VS Code terminal")
		})
		// Match session setup: standalone hosts clamp a saved foreground setting
		// to backgroundExec, while VS Code explicitly opts in to background mode.
		const executionMode = getEffectiveTerminalExecutionMode(requestedMode)
		expect(executionMode).toBe("backgroundExec")
		const tool = createVscodeRunCommandsTool({
			cwd: "/workspace",
			getTerminalManager,
			vscodeTerminalExecutionMode: executionMode,
			// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: the fork's background path
			// REQUIRES the host-owned job manager.
			commandJobManager: {
				start: mocks.startBackgroundJob,
			} as never,
		})

		const results = await tool.execute(
			{ commands: ["echo test"] },
			{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
		)

		expect(results).toEqual([expect.objectContaining({ success })])
		expect(mocks.startBackgroundJob).toHaveBeenCalledOnce()
		expect(getTerminalManager).not.toHaveBeenCalled()
		expect(mocks.log).toHaveBeenCalledExactlyOnceWith(
			"task.terminal_execution",
			expect.objectContaining({
				success,
				terminalType,
				method: "child_process",
				terminalExecutionMode: "backgroundExec",
				...dimensions,
			}),
		)
		const properties = mocks.log.mock.calls[0][1]
		if ("errorCode" in dimensions) {
			expect(properties).not.toHaveProperty("exitCode")
		} else {
			expect(properties).not.toHaveProperty("errorCode")
		}
	})
})
