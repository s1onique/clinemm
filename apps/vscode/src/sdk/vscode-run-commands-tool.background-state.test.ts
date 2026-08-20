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
 *  5. RTP-MULTI01 — cardinality safety. `CommandJobManager` supports
 *     multiple concurrent active jobs. The projection MUST be derived
 *     from active-cardinality, not from per-job terminal events —
 *     otherwise the first completing job would clear the projection
 *     while another background job is still active.
 *  6. RTP-MULTI02 — concurrent-start 0->N race-safety. The
 *     `CommandJobManager.start()` mutation of the active Map and the
 *     runner's cardinality query must NOT be racy. With
 *     `Promise.all` of two tool.execute calls, both jobs are
 *     inserted into the active Map before either runner reaches the
 *     query. The runner must read transition metadata captured at
 *     the manager's mutation seam — not a post-hoc count.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "./command-job-manager"
import { createVscodeRunCommandsTool } from "./vscode-run-commands-tool"

/**
 * Execute the produced tool with a concrete shape suitable for
 * assertions. The shell tool always returns `ToolOperationResult[]`,
 * but the generic `AgentTool<unknown, ToolOperationResult[]>` returns
 * `Promise<TOutput>`, so the raw `result` field is `unknown` — this
 * helper narrows it so the assertions below stay type-safe.
 */
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

/**
 * Execute the produced tool with a concrete `ToolOperationResult[]`
 * return type. The shell tool always returns `ToolOperationResult[]`,
 * but the generic `AgentTool<unknown, ToolOperationResult[]>` returns
 * `Promise<TOutput>`, so the raw `result` field is `unknown` — this
 * helper narrows it so the assertions below stay type-safe.
 */

describe("createVscodeRunCommandsTool — background state callback (ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01)", () => {
	it("emits onBackgroundStateChange(true, jobId) when the tool returns RUNNING", async () => {
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
			expect(parsed.jobId).toBeTruthy()

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
			// Fast command — terminal state reached before the wait
			// budget expires. Use a single-quoted shell command to avoid
			// the `\\\"` escape dance (the file has the unescaped literal
			// `\n` which becomes a real newline when the shell parses it).
			const result = await executeTool(
				tool,
				{ commands: ["/bin/sh -c 'printf fast-ok'"] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			expect(result[0].result).toContain("fast-ok")

			// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: the
			// (false, undefined) notification is now driven by the
			// terminalPromise with `becameIdle` — a microtask-resolution
			// promise. Wait one macrotask so the projection flip has
			// actually fired before the assertion.
			await new Promise((r) => setTimeout(r, 5))
			expect(onBackgroundStateChange).toHaveBeenCalledTimes(1)
			expect(onBackgroundStateChange).toHaveBeenCalledWith(false, undefined)
		} finally {
			await manager.dispose()
		}
	})

	// RTP-LONG01: conservation witness for the 15s/10m contract.
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
			backgroundWaitBudgetMs: 30,
			backgroundExecutionDeadlineMs: 5_000,
			onBackgroundStateChange,
		})

		try {
			const result = await executeTool(
				tool,
				{ commands: ["/bin/sh -c 'sleep 0.25'"] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsed = JSON.parse(result[0].result)
			expect(parsed.status).toBe("running")
			expect(parsed.jobId).toBeTruthy()

			expect(onBackgroundStateChange).toHaveBeenCalledWith(true, parsed.jobId)

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

	// RTP-ASYNC01: async terminal projection reset.
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
				{ commands: ["/bin/sh -c 'sleep 0.25'"] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsed = JSON.parse(result[0].result)
			expect(parsed.status).toBe("running")
			expect(parsed.jobId).toBeTruthy()

			expect(onBackgroundStateChange).toHaveBeenCalledWith(true, parsed.jobId)
			const callsAfterToolReturn = onBackgroundStateChange.mock.calls.length

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

			await vi.waitFor(
				() => {
					expect(onBackgroundStateChange.mock.calls.length).toBeGreaterThan(callsAfterToolReturn)
				},
				{ timeout: 1_000, interval: 10 },
			)
			const lastCall = onBackgroundStateChange.mock.calls[onBackgroundStateChange.mock.calls.length - 1]
			expect(lastCall).toEqual([false, undefined])
		} finally {
			await manager.dispose()
		}
	})

	// RTP-MULTI01: terminal-cardinality safety.
	it("RTP-MULTI01: projection stays true while at least one background job is still active (terminal-cardinality-safe)", async () => {
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
			const resultA = await executeTool(
				tool,
				{ commands: ["/bin/sh -c 'sleep 0.15'"] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsedA = JSON.parse(resultA[0].result)
			expect(parsedA.status).toBe("running")
			const jobIdA = parsedA.jobId

			const resultB = await executeTool(
				tool,
				{ commands: ["/bin/sh -c 'sleep 0.40'"] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsedB = JSON.parse(resultB[0].result)
			expect(parsedB.status).toBe("running")
			const jobIdB = parsedB.jobId

			expect(manager.getActiveJobIds().length).toBe(2)
			expect(onBackgroundStateChange).toHaveBeenCalledWith(true, jobIdA)
			expect(onBackgroundStateChange).not.toHaveBeenCalledWith(true, jobIdB)

			let aStateAtCompletion: string | undefined
			for (let i = 0; i < 200; i++) {
				const s = await manager.status({ jobId: jobIdA, waitMs: 0 })
				if (s.ok && s.snapshot.state !== "running") {
					aStateAtCompletion = s.snapshot.state
					break
				}
				await new Promise((r) => setTimeout(r, 5))
			}
			expect(aStateAtCompletion).toBe("exited")
			const bStatusWhileAIsDone = await manager.status({ jobId: jobIdB, waitMs: 0 })
			expect(bStatusWhileAIsDone.ok).toBe(true)
			if (bStatusWhileAIsDone.ok) {
				expect(bStatusWhileAIsDone.snapshot.state).toBe("running")
			}
			await new Promise((r) => setTimeout(r, 50))
			const falseCallsBeforeBFinishes = onBackgroundStateChange.mock.calls.filter((c) => c[0] === false)
			expect(falseCallsBeforeBFinishes).toHaveLength(0)

			let bStateAtCompletion: string | undefined
			for (let i = 0; i < 400; i++) {
				const s = await manager.status({ jobId: jobIdB, waitMs: 0 })
				if (s.ok && s.snapshot.state !== "running") {
					bStateAtCompletion = s.snapshot.state
					break
				}
				await new Promise((r) => setTimeout(r, 5))
			}
			expect(bStateAtCompletion).toBe("exited")

			let foundFalse = false
			for (let i = 0; i < 200; i++) {
				if (onBackgroundStateChange.mock.calls.some((c) => c[0] === false)) {
					foundFalse = true
					break
				}
				await new Promise((r) => setTimeout(r, 5))
			}
			expect(foundFalse).toBe(true)

			const lastCall = onBackgroundStateChange.mock.calls[onBackgroundStateChange.mock.calls.length - 1]
			expect(lastCall).toEqual([false, undefined])
		} finally {
			await manager.dispose()
		}
	})

	// RTP-MULTI02: concurrent-start 0->N race-safety.
	it("RTP-MULTI02: projection fires (true, jobId) when jobs start concurrently (0->N race-safe)", async () => {
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
			backgroundExecutionDeadlineMs: 30_000,
			onBackgroundStateChange,
		})

		try {
			// Start A and B concurrently. Both tool.execute bodies start
			// synchronously and both call `manager.start()` before
			// yielding. Both `active.set` calls complete in the same
			// synchronous burst (V8 is single-threaded). The runner's
			// cardinality query happens AFTER both insertions, so
			// without transition metadata, both runners see length=2
			// and both SUPPRESS the (true, ...) notification.
			const [resultA, resultB] = await Promise.all([
				executeTool(
					tool,
					{ commands: ["/bin/sh -c 'sleep 1'"] },
					{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
				),
				executeTool(
					tool,
					{ commands: ["/bin/sh -c 'sleep 1'"] },
					{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
				),
			])

			const parsedA = JSON.parse(resultA[0].result)
			const parsedB = JSON.parse(resultB[0].result)
			expect(parsedA.status).toBe("running")
			expect(parsedB.status).toBe("running")

			expect(manager.getActiveJobIds().length).toBe(2)

			// The projection MUST have received exactly one (true, ...)
			// notification. The 0->N race-safe behavior: the FIRST job
			// to be inserted into the active Map is the 0->1
			// transition; the SECOND is a no-op.
			const trueCalls = onBackgroundStateChange.mock.calls.filter((c) => c[0] === true)
			expect(trueCalls.length).toBe(1)
			const trueJobIds = trueCalls.map((c) => c[1])
			// The single (true, ...) call must reference one of the
			// two jobIds (whichever is the 0->1 transition). The other
			// job's RUNNING return is a no-op (the projection is already
			// true from the first job's 0->1 transition).
			expect(trueJobIds).toContain(parsedA.jobId)
			expect(trueJobIds).not.toContain(parsedB.jobId)
			expect(trueJobIds.length).toBe(1)
		} finally {
			await manager.dispose()
		}
	})
})
