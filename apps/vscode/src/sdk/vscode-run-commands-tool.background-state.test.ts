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

	// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION01 RTP-MULTI01:
	// cardinality safety. The CommandJobManager explicitly supports
	// multiple concurrent active jobs (`getActiveJobIds()` returns
	// Array.from(this.active.keys())). The host's
	// `backgroundCommandRunning` projection MUST therefore be derived
	// from the manager's active-cardinality, not from per-job
	// terminal events — otherwise the first completing job would
	// clear the projection while another background job is still
	// active, leaving the webview's TaskHeader and Cancel button
	// stuck thinking the runtime is idle.
	//
	// This test exercises the multi-active-job path: two jobs run
	// concurrently. Job A completes before Job B; the projection
	// MUST stay true while B is alive. After B also completes the
	// projection MUST flip to false (and only THEN).
	//
	// Pre-fix this is RED: the terminal listener attached to A's
	// `terminalPromise` blindly fires `(false, undefined)` the moment
	// A finishes, regardless of B's state.
	it("RTP-MULTI01: projection stays true while at least one background job is still active (cardinality-safe)", async () => {
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
			// Scaled timings: A finishes at ~150ms, B at ~400ms. Wait
			// budget is ~30ms so both return RUNNING.
			backgroundWaitBudgetMs: 30,
			backgroundExecutionDeadlineMs: 5_000,
			onBackgroundStateChange,
		})

		try {
			// Start job A (sleep 0.15) and job B (sleep 0.40).
			const resultA = await executeTool(
				tool,
				{ commands: ["/bin/sh -c \"sleep 0.15\""] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsedA = JSON.parse(resultA[0].result)
			expect(parsedA.status).toBe("running")
			const jobIdA = parsedA.jobId

			const resultB = await executeTool(
				tool,
				{ commands: ["/bin/sh -c \"sleep 0.40\""] },
				{ agentId: "agent-1", conversationId: "conversation-1", iteration: 1 },
			)
			const parsedB = JSON.parse(resultB[0].result)
			expect(parsedB.status).toBe("running")
			const jobIdB = parsedB.jobId

			// Two jobs active: the manager's cardinality is 2.
			expect(manager.getActiveJobIds().length).toBe(2)
			// Only the FIRST RUNNING return should have fired
			// `(true, jobId)` — the projection is cardinality-aware, so
			// the second RUNNING is a no-op (projection is already true).
			expect(onBackgroundStateChange).toHaveBeenCalledWith(true, jobIdA)
			expect(onBackgroundStateChange).not.toHaveBeenCalledWith(true, jobIdB)
			const callsAfterBothStarted = onBackgroundStateChange.mock.calls.length

			// Wait for A to complete naturally by polling status in a
			// tight loop. B is still alive.
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
			// B is still alive — manager cardinality is 1.
			const bStatusWhileAIsDone = await manager.status({ jobId: jobIdB, waitMs: 0 })
			expect(bStatusWhileAIsDone.ok).toBe(true)
			if (bStatusWhileAIsDone.ok) {
				expect(bStatusWhileAIsDone.snapshot.state).toBe("running")
			}
			// Allow a brief window for A's terminalPromise callback to
			// fire if it's going to (current bug: it does).
			await new Promise((r) => setTimeout(r, 50))
			// BUG: the projection was (false, undefined) when A's
			// terminalPromise resolved because the implementation
			// treats each terminal as a global idle signal. With the
			// cardinality-safe fix, the projection MUST stay true
			// because B is still active.
			const falseCallsBeforeBFinishes = onBackgroundStateChange.mock.calls.filter(
				(c) => c[0] === false,
			)
			expect(falseCallsBeforeBFinishes).toHaveLength(0)

			// Wait for B to complete naturally. Now the projection
			// MUST flip to false.
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

			// After both jobs complete, the projection must eventually
			// flip to false. The existing implementation blindly fires
			// (false, undefined) when EACH job completes, so the very
			// first call (from A) is the bug — the cardinality-safe
			// fix should only fire on the last terminal completion.
			// Wait for the (false, undefined) call to appear.
			let foundFalse = false
			for (let i = 0; i < 200; i++) {
				if (onBackgroundStateChange.mock.calls.some((c) => c[0] === false)) {
					foundFalse = true
					break
				}
				await new Promise((r) => setTimeout(r, 5))
			}
			expect(foundFalse).toBe(true)

			// Final state: the last call must be (false, undefined).
			const lastCall = onBackgroundStateChange.mock.calls[onBackgroundStateChange.mock.calls.length - 1]
			expect(lastCall).toEqual([false, undefined])
		} finally {
			await manager.dispose()
		}
	})
})
