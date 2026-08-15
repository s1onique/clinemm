/**
 * CORRECTION04: AgentRuntime Execution-Plan Enforcement
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION04
 *
 * Proves the runtime contract: when an approval callback returns an
 * `executionPlan`, the AgentRuntime MUST use the plan's hardened argv
 * for the executor — never the raw model input.
 */

import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
	ITelemetryService,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "./index";

beforeEach(() => {
	// hook for future rate-limit resets
});

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = [];

	constructor(
		private readonly steps: Array<
			(
				request: AgentModelRequest,
			) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		return toAsyncIterable(step(request));
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event;
	}
}

function createTelemetryMock(): {
	telemetry: ITelemetryService;
	capture: ReturnType<typeof vi.fn>;
} {
	const capture = vi.fn();
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
	};
}

function createRunCommandsTool(executor: ReturnType<typeof vi.fn>): AgentTool {
	return {
		name: "run_commands",
		description: "Run shell commands",
		inputSchema: { type: "object" },
		execute: executor,
	} as unknown as AgentTool;
}

describe("CORRECTION04: AgentRuntime enforces executionPlan substitution", () => {
	it("executor receives HARDENED input when approval returns executionPlan (git diff)", async () => {
		const executor = vi.fn(async () => ({ output: "ok" }));
		const tool = createRunCommandsTool(executor);

		const rawInput = { command: "git diff --stat", requires_approval: false };
		const hardenedInput = {
			command:
				"git --no-pager -c core.pager=cat -c core.fsmonitor=false -c core.hooksPath=/dev/null diff --no-ext-diff --no-textconv --stat",
		};

		const requestToolApproval = vi.fn(async () => ({
			approved: true,
			executionPlan: {
				transformedInput: hardenedInput,
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: hardenedInput.command,
						matchedRuleSource: "host_safe_git_diff",
						profileSource: "host_safe_git_diff_profile",
					},
				],
			},
		}));

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_gd",
					toolName: "run_commands",
					input: rawInput,
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		]);

		const runtime = new AgentRuntime({
			sessionId: "sess_gd",
			agentId: "agent_gd",
			conversationId: "conv_gd",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		});

		await runtime.run("git diff");

		expect(executor).toHaveBeenCalledTimes(1);
		// The executor MUST receive the hardened argv, not the raw argv.
		const executorArg = executor.mock.calls[0]![0];
		expect(executorArg).toMatchObject({
			command: expect.stringContaining("--no-ext-diff") as unknown as string,
		});
		expect((executorArg as { command: string }).command).not.toBe(
			rawInput.command,
		);
	});

	it("executor receives the RAW input when approval does NOT return executionPlan", async () => {
		const executor = vi.fn(async () => ({ output: "ok" }));
		const tool = createRunCommandsTool(executor);

		const rawInput = { command: "git diff --stat" };

		const requestToolApproval = vi.fn(async () => ({ approved: true }));

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_no_plan",
					toolName: "run_commands",
					input: rawInput,
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		]);

		const runtime = new AgentRuntime({
			sessionId: "sess_no_plan",
			agentId: "agent_no_plan",
			conversationId: "conv_no_plan",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		});

		await runtime.run("diff");

		expect(executor).toHaveBeenCalledTimes(1);
		const executorArg = executor.mock.calls[0]![0];
		expect(executorArg).toMatchObject({ command: rawInput.command });
	});

	it("executor is NOT called when approval returns approved=false (model escalation)", async () => {
		const executor = vi.fn(async () => ({ output: "ok" }));
		const tool = createRunCommandsTool(executor);

		const rawInput = {
			command: "git diff --stat",
			requires_approval: true,
		};

		const requestToolApproval = vi.fn(async () => ({
			approved: false,
			reason: "model escalation: requires_approval=true",
		}));

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_esc",
					toolName: "run_commands",
					input: rawInput,
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolMessage = request.messages.at(-1) as AgentMessage;
				expect(toolMessage.role).toBe("tool");
				expect(toolMessage.content[0]).toMatchObject({
					type: "tool-result",
					isError: true,
				});
				return [
					{ type: "text-delta", text: "denied" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);

		const runtime = new AgentRuntime({
			sessionId: "sess_esc",
			agentId: "agent_esc",
			conversationId: "conv_esc",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		});

		await runtime.run("diff with approval");

		expect(executor).not.toHaveBeenCalled();
		expect(requestToolApproval).toHaveBeenCalledTimes(1);
	});
});

describe("CORRECTION04: model-escalated ASK -> user approval preserves hardened argv", () => {
	it("executor receives HARDENED argv after ASK -> user YES bridge", async () => {
		// Architect-recommended scenario:
		//   safe git diff
		//   + model requires_approval=true  (escalates ALLOW -> ASK)
		//       -> requestToolApproval invoked with executionPlan
		//       -> simulate user YES, returning the plan
		//       -> executor called ONCE
		//       -> executor input contains hardened flags
		//       -> executor input MUST NOT equal raw input
		const executor = vi.fn(async () => ({ output: "ok" }));
		const tool = createRunCommandsTool(executor);

		const rawInput = {
			command: "git diff --stat",
			requires_approval: true,
		};
		const hardenedInput = {
			command:
				"git --no-pager -c core.pager=cat -c core.fsmonitor=false -c core.hooksPath=/dev/null diff --no-ext-diff --no-textconv --stat",
		};
		const hardenedPlan = {
			transformedInput: hardenedInput,
			commands: [
				{
					commandIndex: 0,
					hardenedCommand: hardenedInput.command,
					matchedRuleSource: "host_safe_git_diff",
					profileSource: "host_safe_git_diff_profile",
				},
			],
		};

		// The host (CLI or VS Code) would have computed the plan and
		// re-emitted it on user approval. The approval callback here
		// simulates that: approved=true AND executionPlan set.
		const requestToolApproval = vi.fn(async () => ({
			approved: true,
			executionPlan: hardenedPlan,
		}));

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_ask_yes",
					toolName: "run_commands",
					input: rawInput,
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "ok" },
				{ type: "finish", reason: "stop" },
			],
		]);

		const runtime = new AgentRuntime({
			sessionId: "sess_ask_yes",
			agentId: "agent_ask_yes",
			conversationId: "conv_ask_yes",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		});

		await runtime.run("diff via ASK -> YES");

		expect(executor).toHaveBeenCalledTimes(1);
		const executorArg = executor.mock.calls[0]![0] as {
			command: string;
		};
		expect(executorArg.command).toContain("--no-pager");
		expect(executorArg.command).toContain("-c core.pager=cat");
		expect(executorArg.command).toContain("-c core.fsmonitor=false");
		expect(executorArg.command).toContain("-c core.hooksPath=/dev/null");
		expect(executorArg.command).toContain("--no-ext-diff");
		expect(executorArg.command).toContain("--no-textconv");
		expect(executorArg.command).not.toBe(rawInput.command);
	});

	it("mutation-proof: a buggy runtime that ignores executionPlan would fail this test", async () => {
		// Sanity check: if a future regression breaks the
		// `if (approval.executionPlan) input = transformedInput`
		// substitution, this test catches it. The hardened argv must
		// differ from the raw argv; if the runtime fell through to raw,
		// the executor would see "git diff --stat" instead of the
		// hardened command line.
		const executor = vi.fn(async () => ({ output: "ok" }));
		const tool = createRunCommandsTool(executor);
		const rawInput = { command: "git diff --stat" };
		const hardenedInput = {
			command:
				"git --no-pager -c core.pager=cat -c core.fsmonitor=false -c core.hooksPath=/dev/null diff --no-ext-diff --no-textconv --stat",
		};
		const requestToolApproval = vi.fn(async () => ({
			approved: true,
			executionPlan: {
				transformedInput: hardenedInput,
				commands: [
					{
						commandIndex: 0,
						hardenedCommand: hardenedInput.command,
						matchedRuleSource: "host_safe_git_diff",
						profileSource: "host_safe_git_diff_profile",
					},
				],
			},
		}));
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_mp",
					toolName: "run_commands",
					input: rawInput,
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "ok" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			sessionId: "sess_mp",
			agentId: "agent_mp",
			conversationId: "conv_mp",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		});
		await runtime.run("mutation proof");
		const executorArg = executor.mock.calls[0]![0] as {
			command: string;
		};
		expect(executorArg.command).not.toBe(rawInput.command);
		expect(executorArg.command).toBe(hardenedInput.command);
	});
});
