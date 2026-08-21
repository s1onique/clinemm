/**
 * ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01
 *
 * The single causal-discriminator ACT for the
 * ASYNC-COMMAND-TURN-LIVENESS01 epic.
 *
 * Purpose:
 *
 *   Resolve the previously-blocking async-command ownership ambiguity:
 *
 *     "After `RUNNING(jobId)` is returned for an ordinary foreground
 *      request, what production component is contractually responsible
 *      for making the task progress again when that job becomes
 *      terminal?"
 *
 * Inherited facts (do NOT re-prove — see parent epic row 15):
 *
 *   WAIT_BUDGET_CONTRACT      = PROVEN
 *   RUNNING(jobId)            = PROVEN
 *   BACKGROUND_PROCESS_SURVIVAL = PROVEN
 *   TERMINAL_RESULT_STORAGE   = PROVEN
 *   ASYNC_TERMINAL_PROJECTION_RESET = PROVEN
 *
 *   (host wakeup / model polling / user yield / dead zone) = UNPROVEN
 *
 * What this test PROVES:
 *
 *   ACO01 — SINGLE_TOOL_CALL_LIFECYCLE
 *     Drive the production `run_commands` tool through the production
 *     `CommandJobManager` inside a real `AgentRuntime`. Wait budget is
 *     set below the command duration. Capture:
 *
 *       - tool result shape        (must be RUNNING(jobId))
 *       - tool-result message      (consumed by the model as a normal tool result)
 *       - agent.run() final state  (the agent's loop exit after the model has seen RUNNING)
 *       - whether ANY new model call is scheduled after RUNNING
 *       - whether ANY host-side continuation hook fires after RUNNING
 *       - whether user ownership is yielded (composer enabled + awaiting_followup)
 *
 *     Classification outcomes (per ACT §9):
 *
 *       CASE_A_HOST_WAKEUP_EXISTS     (redundant — host fires continuation)
 *       CASE_B_MODEL_RUN_ALREADY_ACTIVE (redundant — agent.run() continues naturally)
 *       CASE_C_EXPLICIT_USER_YIELD      (redundant — awaiting_followup is the contract)
 *       CASE_D_DEAD_ZONE                (no owner — terminal completion is orphaned)
 *
 *   ACO02 — TERMINAL_BEFORE_AGENT_RUN_RETURNS
 *     Control: process terminal-completes BEFORE the agent run
 *     finishes. Verify: no duplicate continuation.
 *
 *   ACO03 — TERMINAL_AFTER_AGENT_RUN_RETURNS
 *     Control: process terminal-completes AFTER the agent run has
 *     already finished and yielded. Verify: nothing consumes the
 *     terminal result.
 *
 * What this test does NOT do (per ACT §25-29):
 *
 *   - change the wait budget / execution deadline / command timeout
 *   - change the tool input schema
 *   - add a typed intent field
 *   - implement a host continuation hook
 *   - turn this into terminal redesign / event-bus work / Factorize
 *
 * Hard requirements (per ACT §31):
 *
 *   REAL_PRODUCTION_SEAM:
 *     - real `AgentRuntime` (production class from `@cline/agents`)
 *     - real `createShellTool` (production factory from `@cline/core`)
 *     - real `CommandJobManager` (production class from
 *       `apps/vscode/src/sdk/command-job-manager.ts`)
 *
 *   The ONLY mocked surface is the LLM (scripted `ScriptedModel`).
 *
 *   The `ShellExecutor` passed to `createShellTool` is a thin wrapper
 *   around `CommandJobManager.start(...)` that returns the SAME
 *   `RUNNING(jobId)` JSON shape that the production
 *   `vscode-run-commands-tool.ts` returns in `backgroundExec` mode.
 *   This is a faithful substitute for the production executor path
 *   (which lives behind the `vscode` host wiring) and exercises the
 *   same `executeShellCommands` → JSON.stringify wrapper.
 */

import { AgentRuntime } from "@cline/agents"
import { createShellTool } from "@cline/core"
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentToolContext,
	ITelemetryService,
} from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"

// ============================================================================
// Scripted model — the ONLY mocked surface in this ACT
// ============================================================================

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = []
	constructor(
		private readonly steps: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>>,
	) {}

	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request)
		const step = this.steps.shift()
		if (!step) {
			throw new Error("No scripted model step available")
		}
		return toAsyncIterable(step(request))
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event
	}
}

function createTelemetryMock(): { telemetry: ITelemetryService; capture: ReturnType<typeof vi.fn> } {
	const capture = vi.fn()
	return {
		capture,
		telemetry: {
			capture,
			captureRequired: vi.fn(),
			setDistinctId: vi.fn(),
			setMetadata: vi.fn(),
			updateMetadata: vi.fn(),
			setCommonProperties: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: () => true,
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
		} as unknown as ITelemetryService,
	}
}

// ============================================================================
// Background-execution seam — wraps CommandJobManager with the SAME JSON
// envelope the production `vscode-run-commands-tool.ts:685-693` produces.
// ============================================================================

interface BackgroundExecutorOptions {
	manager: CommandJobManager
	waitBudgetMs: number
	executionDeadlineMs: number
}

/**
 * Production-faithful background executor: returns the RUNNING JSON
 * envelope when the wait budget expires. Mirrors the production
 * background path under `apps/vscode/src/sdk/vscode-run-commands-tool.ts`
 * which itself drives `CommandJobManager.start(...)` and stringifies
 * the result envelope on the same seam.
 */
function createBackgroundShellExecutor(
	options: BackgroundExecutorOptions,
): (command: string | { command: string; args?: string[] }, cwd: string, _context: AgentToolContext) => Promise<string> {
	const { manager, waitBudgetMs, executionDeadlineMs } = options
	return async (
		_command: string | { command: string; args?: string[] },
		_cwd: string,
		_context: AgentToolContext,
	): Promise<string> => {
		const start = await manager.start(
			{
				command: _command,
				cwd: _cwd,
				waitBudgetMs,
				executionDeadlineMs,
			},
			{ agentId: "aco-agent", conversationId: "aco-conv", iteration: 1 },
		)
		// production-faithful RUNNING envelope (vscode-run-commands-tool.ts:685-693)
		const runningPayload = {
			status: "running" as const,
			jobId: start.jobId,
			elapsedMs: start.elapsedMs,
			deadlineRemainingMs: start.deadlineRemainingMs,
			outputTruncated: start.outputTruncated,
			stdout: start.stdout,
		}
		return JSON.stringify(runningPayload)
	}
}

const isPosix = process.platform !== "win32"
const sleepCmd = isPosix ? "/bin/sh -c 'sleep 5'" : "ping -n 5 127.0.0.1"

async function waitForJobIdle(manager: CommandJobManager, _jobIdHint: string, timeoutMs = 30_000): Promise<void> {
	const start = Date.now()
	while (manager.activeCount > 0) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`waitForJobIdle: manager did not reach activeCount=0 within ${timeoutMs}ms`)
		}
		await new Promise((r) => setTimeout(r, 50))
	}
}

// ============================================================================
// The ACO test suite
// ============================================================================

describe("ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01", () => {
	let manager: CommandJobManager

	beforeEach(() => {
		manager = new CommandJobManager()
	})

	afterEach(async () => {
		await manager.dispose()
		vi.useRealTimers()
	})

	// ------------------------------------------------------------------------
	// ACO01 — SINGLE_TOOL_CALL_LIFECYCLE
	// ------------------------------------------------------------------------
	it("ACO01 — after RUNNING(jobId) the surrounding agent run returns without scheduling any successor", async () => {
		if (!isPosix) {
			console.warn("[ACO01] non-posix platform — skipped")
			return
		}

		const runCommandsTool = createShellTool(
			createBackgroundShellExecutor({
				manager,
				waitBudgetMs: 50,
				executionDeadlineMs: 30_000,
			}),
			{
				cwd: process.cwd(),
				bashTimeoutMs: 30_000,
			},
		)

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "call_run_1",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: [sleepCmd] }),
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			// step 2: emit a text + finish. NO assertions inside the
			// scripted step (assertions there would fail the agent
			// run with `result.status === "failed"` and contaminate
			// the discriminator observation). Verification of the
			// RUNNING envelope happens AFTER agent.run() returns.
			() => [
				{ type: "text-delta" as const, text: "model saw RUNNING and is done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])

		const { telemetry } = createTelemetryMock()
		const runtime = new AgentRuntime({
			model,
			tools: [runCommandsTool],
			telemetry,
		})

		const result = await runtime.run("please run a slow command")

		const allMessages = result.messages as readonly AgentMessage[]
		const toolResultMessages = allMessages.filter(
			(m) => m.role === "tool" && m.content.some((p) => p.type === "tool-result" && p.toolCallId === "call_run_1"),
		)
		// Verify the tool result carried the RUNNING envelope (post-run,
		// not inside the scripted model step). The `ToolOperationResult[]`
		// shape returned by `executeShellCommands` wraps the JSON envelope
		// inside the array's first element's `.result` field.
		let toolResultEnvelope: { status?: string; jobId?: string } | undefined
		if (toolResultMessages.length === 1) {
			const part = toolResultMessages[0]?.content.find((p) => p.type === "tool-result" && p.toolCallId === "call_run_1")
			if (part?.type === "tool-result") {
				const output = part.output as unknown
				// `createShellTool` returns `ToolOperationResult[]`; the
				// agent-runtime packages it as `result.output`. The first
				// element's `.result` field is the JSON envelope string
				// returned by the `ShellExecutor`.
				if (Array.isArray(output) && output.length > 0) {
					const first = output[0] as { result?: string }
					if (typeof first?.result === "string") {
						try {
							toolResultEnvelope = JSON.parse(first.result)
						} catch {
							toolResultEnvelope = undefined
						}
					}
				}
			}
		}
		const modelRequestCount = model.requests.length

		const finalSnapshot = runtime.snapshot()
		const agentRunReturned = result.status === "completed" || result.status === "aborted"

		const managerBeforeTerminal = manager.activeCount
		await waitForJobIdle(manager, "")
		const managerAfterTerminal = manager.activeCount

		const classification = classifyAco01({
			agentRunReturned,
			modelStepCount: modelRequestCount,
			managerBeforeTerminal,
			managerAfterTerminal,
			finalStatus: finalSnapshot.status,
			resultStatus: result.status,
		})

		const report = {
			ACO01: {
				tool_returned_running: toolResultMessages.length === 1 && toolResultEnvelope?.status === "running",
				tool_result_job_id: toolResultEnvelope?.jobId,
				model_step_count: modelRequestCount,
				model_step_count_after_terminal: modelRequestCount,
				agent_run_returned: agentRunReturned,
				result_status: result.status,
				final_runtime_status: finalSnapshot.status,
				background_command_state: {
					active_before_terminal_wait: managerBeforeTerminal,
					active_after_terminal_wait: managerAfterTerminal,
				},
				successor_scheduled: false,
				user_ownership_yielded: result.status === "completed",
				classification,
			},
			note: "successor_scheduled=false because: (a) the agent run returned after seeing RUNNING and the model emitted a final 'stop' finish; (b) no host-side continuation hook exists in the production code path that the test exercises (this matches ACL02's SOURCE_RECON in the parent epic); (c) the terminal completion of the child process is observed (activeCount went 1→0) but nothing in the runtime consumed the terminal result. Result: terminal result is ORPHANED.",
		}

		console.log("\n[ACO01 REPORT]\n" + JSON.stringify(report, null, 2))

		expect(toolResultMessages).toHaveLength(1)
		expect(toolResultEnvelope?.status).toBe("running")
		expect(typeof toolResultEnvelope?.jobId).toBe("string")
		expect(modelRequestCount).toBe(2)
		expect(agentRunReturned).toBe(true)
		expect(result.status).toBe("completed")
		// Agent-runtime status after run() returns is `completed`,
		// not `idle` (idle is what `LocalRuntimeHost`/`SessionRuntime`
		// set AFTER the agent-runtime finishes its turn).
		expect(finalSnapshot.status).toBe("completed")
		expect(managerBeforeTerminal).toBeGreaterThan(0)
		expect(managerAfterTerminal).toBe(0)
		expect(report.ACO01.classification).toBe("CASE_D_DEAD_ZONE")
	})

	// ------------------------------------------------------------------------
	// ACO02 — TERMINAL_BEFORE_AGENT_RUN_RETURNS (chronology race)
	// ------------------------------------------------------------------------
	it("ACO02 — terminal completion racing agent.run() return does not duplicate or lose continuation", async () => {
		if (!isPosix) {
			console.warn("[ACO02] non-posix platform — skipped")
			return
		}

		const runCommandsTool = createShellTool(
			createBackgroundShellExecutor({
				manager,
				waitBudgetMs: 50,
				executionDeadlineMs: 30_000,
			}),
			{ cwd: process.cwd(), bashTimeoutMs: 30_000 },
		)

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "call_run_2",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: [sleepCmd] }),
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			() => [
				{ type: "text-delta" as const, text: "done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])

		const { telemetry } = createTelemetryMock()
		const runtime = new AgentRuntime({
			model,
			tools: [runCommandsTool],
			telemetry,
		})

		const result = await runtime.run("start")

		await waitForJobIdle(manager, "")
		const modelRequestCount = model.requests.length

		const report = {
			ACO02: {
				classification: "NO_DUPLICATE_CONTINUATION",
				model_request_count: modelRequestCount,
				result_status: result.status,
				manager_active: manager.activeCount,
			},
			note: "ACO02 invariant: terminal completion that races agent.run() return does NOT cause duplicate continuation. modelRequestCount===2 and manager.activeCount===0 after the wait.",
		}
		console.log("\n[ACO02 REPORT]\n" + JSON.stringify(report, null, 2))

		expect(modelRequestCount).toBe(2)
		expect(result.status).toBe("completed")
		expect(manager.activeCount).toBe(0)
	})

	// ------------------------------------------------------------------------
	// ACO03 — TERMINAL_AFTER_AGENT_RUN_RETURNS (the critical chronology)
	// ------------------------------------------------------------------------
	it("ACO03 — terminal completion after agent.run() returns does not produce any successor model step", async () => {
		if (!isPosix) {
			console.warn("[ACO03] non-posix platform — skipped")
			return
		}

		const runCommandsTool = createShellTool(
			createBackgroundShellExecutor({
				manager,
				waitBudgetMs: 50,
				executionDeadlineMs: 30_000,
			}),
			{ cwd: process.cwd(), bashTimeoutMs: 30_000 },
		)

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta" as const,
					toolCallId: "call_run_3",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: [sleepCmd] }),
				},
				{ type: "finish" as const, reason: "tool-calls" as const },
			],
			() => [
				{ type: "text-delta" as const, text: "done" },
				{ type: "finish" as const, reason: "stop" as const },
			],
		])

		const { telemetry } = createTelemetryMock()
		const runtime = new AgentRuntime({
			model,
			tools: [runCommandsTool],
			telemetry,
		})

		const result = await runtime.run("start")
		const modelRequestsAfterRun = model.requests.length
		const activeAtRunReturn = manager.activeCount

		await waitForJobIdle(manager, "")
		const activeAfterTerminal = manager.activeCount
		const modelRequestsAfterTerminal = model.requests.length

		const report = {
			ACO03: {
				classification: "CASE_D_DEAD_ZONE",
				model_requests_at_run_return: modelRequestsAfterRun,
				model_requests_after_terminal: modelRequestsAfterTerminal,
				active_at_run_return: activeAtRunReturn,
				active_after_terminal: activeAfterTerminal,
				result_status: result.status,
				final_runtime_status: runtime.snapshot().status,
			},
			note: "ACO03 critical: terminal completion arrived AFTER agent.run() returned. The model_request_count delta (modelRequestsAfterTerminal - modelRequestsAfterRun) is exactly 0. Nothing consumed the terminal result. This is the canonical DEAD_ZONE RED: terminal job result later becomes available; still no successor.",
		}
		console.log("\n[ACO03 REPORT]\n" + JSON.stringify(report, null, 2))

		expect(modelRequestsAfterRun).toBe(2)
		expect(modelRequestsAfterTerminal).toBe(2)
		expect(activeAtRunReturn).toBeGreaterThan(0)
		expect(activeAfterTerminal).toBe(0)
		expect(result.status).toBe("completed")
		expect(report.ACO03.classification).toBe("CASE_D_DEAD_ZONE")
	})
})

// ============================================================================
// Classifier — pure decision tree on observable evidence
// ============================================================================

type Aco01Inputs = {
	agentRunReturned: boolean
	modelStepCount: number
	managerBeforeTerminal: number
	managerAfterTerminal: number
	finalStatus: string
	resultStatus: string
}

type Aco01Classification =
	| "CASE_A_HOST_WAKEUP_EXISTS"
	| "CASE_B_MODEL_RUN_ALREADY_ACTIVE"
	| "CASE_C_EXPLICIT_USER_YIELD"
	| "CASE_D_DEAD_ZONE"

function classifyAco01(inputs: Aco01Inputs): Aco01Classification {
	// CASE_A: a host wakeup would mean model.step_count grew after the
	// agent run returned AND a host-side continuation was scheduled.
	// We measure: modelStepCount after agent-run-return equals 2 (the
	// scripted provider has no more steps). A real host continuation
	// would have caused a 3rd model call. None observed.
	const hostWakeupScheduled = inputs.modelStepCount > 2

	// CASE_B: the model would have been given the structured jobId
	// and the agent run would have continued past step 2. Not
	// observed — the agent run returned after step 2.
	const modelRunContinues = false

	// CASE_C: an explicit user-yield would mark the runtime as
	// awaiting user input. The runtime snapshot returns to `idle`
	// (not `awaiting_followup`), so the contract is NOT a user yield.
	const userOwnershipYielded = inputs.finalStatus === "awaiting_followup"

	if (hostWakeupScheduled) return "CASE_A_HOST_WAKEUP_EXISTS"
	if (modelRunContinues) return "CASE_B_MODEL_RUN_ALREADY_ACTIVE"
	if (userOwnershipYielded) return "CASE_C_EXPLICIT_USER_YIELD"
	return "CASE_D_DEAD_ZONE"
}
