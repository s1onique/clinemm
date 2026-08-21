/**
 * ACT-CLINEMM-SKIPPED-COMMAND-TURN-RECOVERY01 / SCTR01 — RED discriminator
 * suite for the foreground user-rejection → turn-ownership seam.
 *
 * Contract (ACT §6–§9):
 *   model proposes run_commands
 *     → production asks for approval (real `requestToolApproval`)
 *     → simulated user rejects/skips through the actual callback/API
 *     → runtime consumes rejection
 *     → turn settles
 *
 * PASS if there is a real owner after rejection.
 *
 * Production seam under test:
 *   AgentRuntime (sdk/packages/agents/src/agent-runtime.ts)
 *     requestToolApproval (line 2583) → real approval side effect
 *     executePreparedTool (line 2645) → real outcome classification
 *     run() iteration loop (line 1260) → real turn ownership
 *     finishRun (line 3385) → real terminal-status publication
 *
 * Distinct from prior ACTs:
 *   - ITI01..ITI12 (INVALID-TOOL-INPUT-PREAPPROVAL01): single-call
 *     outcome shape only; does NOT exercise the full iteration loop.
 *   - REJECTED-COMMAND-PRESENTATION-TRUTH01: webview rendering only.
 *   - The existing `requests approval when a tool policy disables
 *     auto-approval` test in `agent-runtime.test.ts:948` exercises the
 *     APPROVED path; this ACT exercises the REJECTED path's turn
 *     ownership.
 */

import { AgentRuntime } from "@cline/agents"
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
	ToolApprovalRequest,
	ToolRuntimeOutcome,
} from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
	vi.restoreAllMocks()
})

class StepModel implements AgentModel {
	readonly requests: AgentModelRequest[] = []
	readonly toolMessageSeen: AgentMessage[] = []
	constructor(
		private readonly steps: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>>,
	) {}
	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request)
		const last = request.messages[request.messages.length - 1]
		if (last && last.role === "tool") {
			this.toolMessageSeen.push(last)
		}
		const step = this.steps.shift()
		if (!step) throw new Error("No more scripted model steps available")
		const events = step(request)
		return (async function* () {
			for await (const ev of events) yield ev
		})()
	}
}

export interface CapturedOutcome {
	toolCallId: string
	toolName: string
	outcome: ToolRuntimeOutcome
	approvalCalls: number
	executorCalls: number
}

interface DriveResult {
	runtime: AgentRuntime
	model: StepModel
	messages: readonly AgentMessage[]
	captured: CapturedOutcome[]
	counters: { approvalCalls: number; executorCalls: number }
	result: Awaited<ReturnType<AgentRuntime["run"]>>
	approvalRequests: ToolApprovalRequest[]
}

async function driveRejectedRunCommand(): Promise<DriveResult> {
	const counters = { approvalCalls: 0, executorCalls: 0 }
	const captured: CapturedOutcome[] = []
	const approvalRequests: ToolApprovalRequest[] = []

	const tool: AgentTool<{ commands: string[] }, Array<{ result: string; success: true }>> = {
		name: "run_commands",
		description: "Discriminator: executor MUST NOT be invoked for user-rejected call",
		inputSchema: {
			type: "object",
			properties: { commands: { type: "array", items: { type: "string" } } },
			required: ["commands"],
			additionalProperties: false,
		} as never,
		async execute(input) {
			counters.executorCalls++
			return input.commands.map((c) => ({ result: `executed:${c}`, success: true as const }))
		},
	}

	const model = new StepModel([
		() => [
			{
				type: "tool-call-delta",
				toolCallId: "sctr-1",
				toolName: "run_commands",
				inputText: JSON.stringify({ commands: ["echo hi"] }),
			},
			{ type: "finish", reason: "tool-calls" },
		],
		(request) => {
			const lastMessage = request.messages[request.messages.length - 1]
			expect(lastMessage.role).toBe("tool")
			const toolContent = (lastMessage as AgentMessage).content[0] as {
				type: "tool-result"
				toolCallId: string
				isError: boolean
				output: { error?: string }
			}
			expect(toolContent.type).toBe("tool-result")
			expect(toolContent.toolCallId).toBe("sctr-1")
			expect(toolContent.isError).toBe(true)
			expect(toolContent.output?.error).toMatch(/not approved|rejected|denied/i)
			return [
				{ type: "text-delta", text: "Understood, skipping the command." },
				{ type: "finish", reason: "stop" },
			]
		},
	])

	const hooks: AgentRuntimeHooks = {
		onToolRuntimeOutcome: (ctx) => {
			captured.push({
				toolCallId: ctx.toolCall.toolCallId,
				toolName: ctx.toolCall.toolName,
				outcome: ctx.outcome,
				approvalCalls: counters.approvalCalls,
				executorCalls: counters.executorCalls,
			})
		},
	}

	const runtime = new AgentRuntime({
		model,
		tools: [tool],
		hooks,
		toolPolicies: { run_commands: { autoApprove: false } },
		requestToolApproval: async (req: ToolApprovalRequest) => {
			counters.approvalCalls++
			approvalRequests.push(req)
			return { approved: false, reason: "user explicitly rejected command" }
		},
	})

	const result = await runtime.run("Run a command")
	return { runtime, model, messages: result.messages, captured, counters, result, approvalRequests }
}

// ---- SCTR matrix -----------------------------------------------------

describe("ACT-CLINEMM-SKIPPED-COMMAND-TURN-RECOVERY01 / SCTR", () => {
	// SCTR01 — turn ownership after user rejection (ACT §6 SCR01).
	// After a real user-rejection, the runtime must settle into a
	// defined owner. The model is the natural owner here — it sees
	// the rejection and decides what to do next.
	it("SCTR01_REJECTION_SETTLES_WITH_MODEL_OWNER: run completes with status=completed and clean execution flags", async () => {
		const { runtime, result, model, captured, counters } = await driveRejectedRunCommand()

		expect(result.status).toBe("completed")
		expect(result.outputText).toBe("Understood, skipping the command.")

		// SCR02: executor invocation count = 0 for user-reject.
		expect(counters.executorCalls).toBe(0)
		expect(counters.approvalCalls).toBe(1)

		// SCR03: tool result shape — control_plane / user_rejected.
		expect(captured).toHaveLength(1)
		const out = captured[0]
		expect(out.toolCallId).toBe("sctr-1")
		expect(out.toolName).toBe("run_commands")
		expect(out.outcome.kind).toBe("control_plane")
		if (out.outcome.kind === "control_plane") {
			expect(out.outcome.outcome).toBe("user_rejected")
		}

		// SCR04: post-rejection runtime state is CLEAN.
		const snapshot = runtime.snapshot()
		expect(snapshot.status).toBe("completed")
		expect(snapshot.execution.awaitingApproval).toBe(false)
		expect(snapshot.execution.modelStreaming).toBe(false)
		expect(snapshot.execution.tooling).toBe(false)
		expect(snapshot.pendingToolCalls).toHaveLength(0)

		// Iteration bookkeeping: the model was called twice. This
		// proves the iteration loop continued past the rejection
		// rather than terminating the run on the first iteration.
		expect(model.requests).toHaveLength(2)
		expect(model.toolMessageSeen).toHaveLength(1)
	})

	// SCTR02 — the rejection message was actually delivered to the model
	// (ACT §8 SCR03).
	it("SCTR02_REJECTION_RESULT_TRUTHFUL: tool message to model is isError=true with skipReason in output.error", async () => {
		const { model, captured } = await driveRejectedRunCommand()

		expect(model.toolMessageSeen).toHaveLength(1)
		const toolMsg = model.toolMessageSeen[0]
		const toolResult = toolMsg.content[0] as {
			type: "tool-result"
			toolCallId: string
			isError: boolean
			output: { error?: string }
		}
		expect(toolResult.type).toBe("tool-result")
		expect(toolResult.toolCallId).toBe("sctr-1")
		expect(toolResult.isError).toBe(true)
		expect(toolResult.output?.error).toMatch(/not approved|denied|user/i)

		expect(captured[0].outcome.kind).toBe("control_plane")
		if (captured[0].outcome.kind === "control_plane") {
			expect(captured[0].outcome.outcome).toBe("user_rejected")
		}
	})

	// SCTR03 — approval request carries the canonical structured payload.
	it("SCTR03_APPROVAL_REQUEST_SHAPE: requestToolApproval receives the canonical structured payload", async () => {
		const { approvalRequests } = await driveRejectedRunCommand()

		expect(approvalRequests).toHaveLength(1)
		const req = approvalRequests[0]
		expect(req.toolCallId).toBe("sctr-1")
		expect(req.toolName).toBe("run_commands")
		expect(req.iteration).toBe(1)
		expect(req.input).toEqual({ commands: ["echo hi"] })
		expect(req.policy).toBeDefined()
		expect(req.policy.autoApprove).toBe(false)
	})

	// SCTR04 — post-rejection state is settled (ACT §10 SCR05).
	it("SCTR04_FOLLOWUP_RESTARTS_CLEAN: post-rejection runtime state has no residual execution flags", async () => {
		const { runtime, model } = await driveRejectedRunCommand()

		const snapshot = runtime.snapshot()
		expect(snapshot.status).toBe("completed")
		expect(snapshot.execution.tooling).toBe(false)
		expect(snapshot.execution.awaitingApproval).toBe(false)
		expect(snapshot.execution.modelStreaming).toBe(false)

		// Model was called exactly twice (tool call + final answer).
		// If the runtime had terminated prematurely on the rejection,
		// the model would have been called only once.
		expect(model.requests).toHaveLength(2)
	})
})

// ---- SCTR controls ---------------------------------------------------

function makeSuccessModel(): StepModel {
	return new StepModel([
		() => [
			{
				type: "tool-call-delta",
				toolCallId: "sctr-ctl-1",
				toolName: "run_commands",
				inputText: JSON.stringify({ commands: ["echo hi"] }),
			},
			{ type: "finish", reason: "tool-calls" },
		],
		() => [
			{ type: "text-delta", text: "Done." },
			{ type: "finish", reason: "stop" },
		],
	])
}

describe("ACT-CLINEMM-SKIPPED-COMMAND-TURN-RECOVERY01 / SCTR controls", () => {
	// SCTR-CTL01 — successful command (ACT §13).
	it("SCTR_CTL01_SUCCESSFUL_COMMAND_SETTLES: approved command runs and run completes", async () => {
		const counters = { approvalCalls: 0, executorCalls: 0 }
		const captured: CapturedOutcome[] = []

		const tool: AgentTool<{ commands: string[] }, Array<{ result: string; success: true }>> = {
			name: "run_commands",
			description: "Success control",
			inputSchema: {
				type: "object",
				properties: { commands: { type: "array", items: { type: "string" } } },
				required: ["commands"],
				additionalProperties: false,
			} as never,
			async execute(input) {
				counters.executorCalls++
				return input.commands.map((c) => ({ result: `ok:${c}`, success: true as const }))
			},
		}

		const runtime = new AgentRuntime({
			model: makeSuccessModel(),
			tools: [tool],
			hooks: {
				onToolRuntimeOutcome: (ctx) => {
					captured.push({
						toolCallId: ctx.toolCall.toolCallId,
						toolName: ctx.toolCall.toolName,
						outcome: ctx.outcome,
						approvalCalls: counters.approvalCalls,
						executorCalls: counters.executorCalls,
					})
				},
			},
			toolPolicies: { run_commands: { autoApprove: false } },
			requestToolApproval: async () => {
				counters.approvalCalls++
				return { approved: true }
			},
		})

		const result = await runtime.run("Run a command")

		expect(result.status).toBe("completed")
		expect(counters.approvalCalls).toBe(1)
		expect(counters.executorCalls).toBe(1)
		expect(captured[0].outcome.kind).toBe("success")
		const snapshot = runtime.snapshot()
		expect(snapshot.status).toBe("completed")
		expect(snapshot.execution.tooling).toBe(false)
		expect(snapshot.pendingToolCalls).toHaveLength(0)
	})

	// SCTR-CTL02 — execution failure (ACT §12).
	it("SCTR_CTL02_EXECUTED_FAILURE_NOT_REJECTION: command ran, failure delivered, run completes", async () => {
		const counters = { approvalCalls: 0, executorCalls: 0 }
		const captured: CapturedOutcome[] = []

		const tool: AgentTool<{ commands: string[] }, unknown> = {
			name: "run_commands",
			description: "Failure control",
			inputSchema: {
				type: "object",
				properties: { commands: { type: "array", items: { type: "string" } } },
				required: ["commands"],
				additionalProperties: false,
			} as never,
			async execute() {
				counters.executorCalls++
				// Throw so the classifier routes through Priority 5
				// (`failure / tool_execution_error`), NOT Priority 1
				// (`success`). The classification distinguishes
				// "executed and failed" from "rejected before execution"
				// via the structural `toolExecutionInvoked` flag, not
				// the shape of the returned object.
				throw new Error("exit code 1: simulated command failure")
			},
		}

		const model = new StepModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "sctr-ctl-2",
					toolName: "run_commands",
					inputText: JSON.stringify({ commands: ["false"] }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "Saw the error." },
				{ type: "finish", reason: "stop" },
			],
		])

		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			hooks: {
				onToolRuntimeOutcome: (ctx) => {
					captured.push({
						toolCallId: ctx.toolCall.toolCallId,
						toolName: ctx.toolCall.toolName,
						outcome: ctx.outcome,
						approvalCalls: counters.approvalCalls,
						executorCalls: counters.executorCalls,
					})
				},
			},
			toolPolicies: { run_commands: { autoApprove: true } },
		})

		const result = await runtime.run("Run a command that fails")

		expect(counters.executorCalls).toBe(1)
		expect(captured[0].outcome.kind).toBe("failure")
		expect(result.status).toBe("completed")
		const snapshot = runtime.snapshot()
		expect(snapshot.status).toBe("completed")
		expect(snapshot.execution.tooling).toBe(false)
		expect(snapshot.pendingToolCalls).toHaveLength(0)
	})

	// SCTR-CTL03 — invalid input (ACT §7 + §18 conservation).
	it("SCTR_CTL03_INVALID_INPUT_DISTINCT_FROM_REJECTION: bad input is failure/tool_input_invalid, not user_rejected", async () => {
		const counters = { approvalCalls: 0, executorCalls: 0 }
		const captured: CapturedOutcome[] = []

		const tool: AgentTool<{ commands: string[] }, Array<{ result: string; success: true }>> = {
			name: "run_commands",
			description: "Invalid-input control",
			inputSchema: {
				type: "object",
				properties: { commands: { type: "array", items: { type: "string" } } },
				required: ["commands"],
				additionalProperties: false,
			} as never,
			validateInput(input) {
				// Mirrors the ITI09 validateInput (strict schema):
				// object-form commands + unknown `timeout` field are
				// rejected at the schema-validation seam BEFORE approval
				// and BEFORE execution.
				if (!input || typeof input !== "object" || Array.isArray(input)) {
					return `Invalid input for tool run_commands: expected object`
				}
				const obj = input as Record<string, unknown>
				const allowed = new Set(["commands"])
				for (const k of Object.keys(obj)) {
					if (!allowed.has(k)) {
						return `Invalid input for tool run_commands: unknown property '${k}'`
					}
				}
				return undefined
			},
			async execute(input) {
				counters.executorCalls++
				return input.commands.map((c) => ({ result: c, success: true as const }))
			},
		}

		const model = new StepModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "sctr-ctl-3",
					toolName: "run_commands",
					// INVALID: object form + unknown field.
					// Mirrors ITI09 from prior ACT — must be rejected
					// at schema validation BEFORE approval/execution.
					inputText: JSON.stringify({
						commands: [{ command: "echo hi" }],
						timeout: 60000,
					}),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "OK." },
				{ type: "finish", reason: "stop" },
			],
		])

		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			hooks: {
				onToolRuntimeOutcome: (ctx) => {
					captured.push({
						toolCallId: ctx.toolCall.toolCallId,
						toolName: ctx.toolCall.toolName,
						outcome: ctx.outcome,
						approvalCalls: counters.approvalCalls,
						executorCalls: counters.executorCalls,
					})
				},
			},
			toolPolicies: { run_commands: { autoApprove: true } },
		})

		const result = await runtime.run("Run a command")

		expect(counters.approvalCalls).toBe(0)
		expect(counters.executorCalls).toBe(0)
		expect(captured[0].outcome.kind).toBe("failure")
		if (captured[0].outcome.kind === "failure") {
			expect(captured[0].outcome.failureClass).toBe("tool_input_invalid")
		}
		expect(result.status).toBe("completed")
	})
})
