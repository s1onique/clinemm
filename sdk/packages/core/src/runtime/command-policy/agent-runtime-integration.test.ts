/**
 * Real Agent-Runtime Execution Boundary Tests
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 *
 * Proves the execution boundary invariant through the REAL AgentRuntime
 * (from @cline/agents), not a simulator. The runtime is the same one VS Code
 * and CLI sessions instantiate; the test only wires up the host adapter.
 *
 * It also documents and guards the runtime contract that production hosts
 * rely on: setting toolPolicies["*"].autoApprove = true bypasses the
 * approval callback. Hosts MUST scope autoApprove=false to command tools
 * (e.g. toolPolicies["run_commands"] = { autoApprove: false }) so the
 * runtime always consults the host approval callback for command tools.
 */

import { AgentRuntime } from "@cline/agents";
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
	ITelemetryService,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
} from "./command-policy";

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

describe("Real AgentRuntime + command policy — dangerous command requires approval", () => {
	it("safe-only + dangerous command + model=false => executor=0 before approval; approval callback invoked exactly once", async () => {
		const executor = vi.fn(async () => ({ output: "ran" }));
		const tool = createRunCommandsTool(executor);

		const requestToolApproval = vi.fn(
			async (req: { toolName: string; input: unknown }) => {
				const auth = commandHostAuthorization({
					mode: "safe-only",
					explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
				});
				const result = evaluateCommandPolicy({
					toolInput: req.input,
					hostAuthorization: auth,
				});
				return {
					approved: result.decision.kind === "allow",
					reason: result.decision.reason,
				};
			},
		);

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_dangerous",
					toolName: "run_commands",
					input: { command: "rm -rf /", requires_approval: false },
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
			sessionId: "sess_dangerous",
			agentId: "agent_dangerous",
			conversationId: "conv_dangerous",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		});

		const result = await runtime.run("do thing");

		expect(executor).not.toHaveBeenCalled();
		expect(requestToolApproval).toHaveBeenCalledTimes(1);
		expect(result.status).toBe("completed");
	});

	it("all-mode + dangerous command + model=false => executor=1 (host ALLOW path)", async () => {
		const executor = vi.fn(async () => ({ output: "ran" }));
		const tool = createRunCommandsTool(executor);

		const requestToolApproval = vi.fn(
			async (req: { toolName: string; input: unknown }) => {
				const auth = commandHostAuthorization({ mode: "all" });
				const result = evaluateCommandPolicy({
					toolInput: req.input,
					hostAuthorization: auth,
				});
				return { approved: result.decision.kind === "allow" };
			},
		);

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_all",
					toolName: "run_commands",
					input: { command: "rm -rf /", requires_approval: false },
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "ok" },
				{ type: "finish", reason: "stop" },
			],
		]);

		const runtime = new AgentRuntime({
			sessionId: "sess_all",
			agentId: "agent_all",
			conversationId: "conv_all",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		});

		await runtime.run("do thing");

		expect(requestToolApproval).toHaveBeenCalledTimes(1);
		expect(executor).toHaveBeenCalledTimes(1);
	});
});

describe("Real AgentRuntime + command policy — host-proven safe auto-executes", () => {
	it("safe-only + host-proven safe (pwd) + model=false => executor=1, callback returns ALLOW", async () => {
		const executor = vi.fn(async () => ({ output: "pwd ok" }));
		const tool = createRunCommandsTool(executor);

		const requestToolApproval = vi.fn(
			async (req: { toolName: string; input: unknown }) => {
				const auth = commandHostAuthorization({
					mode: "safe-only",
					explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
				});
				const result = evaluateCommandPolicy({
					toolInput: req.input,
					hostAuthorization: auth,
				});
				return {
					approved: result.decision.kind === "allow",
					reason: result.decision.reason,
				};
			},
		);

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_pwd",
					toolName: "run_commands",
					input: { command: "pwd", requires_approval: false },
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "ok" },
				{ type: "finish", reason: "stop" },
			],
		]);

		const runtime = new AgentRuntime({
			sessionId: "sess_pwd",
			agentId: "agent_pwd",
			conversationId: "conv_pwd",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		});

		await runtime.run("pwd");

		expect(executor).toHaveBeenCalledTimes(1);
		expect(requestToolApproval).toHaveBeenCalledTimes(1);
	});

	it("safe-only + host-proven safe (pwd) + model=true => executor NOT called before approval", async () => {
		const executor = vi.fn(async () => ({ output: "pwd ok" }));
		const tool = createRunCommandsTool(executor);

		const requestToolApproval = vi.fn(
			async (req: { toolName: string; input: unknown }) => {
				const auth = commandHostAuthorization({
					mode: "safe-only",
					explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
				});
				const result = evaluateCommandPolicy({
					toolInput: req.input,
					hostAuthorization: auth,
				});
				return {
					approved: result.decision.kind === "allow",
					reason: result.decision.reason,
				};
			},
		);

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_pwd_escalate",
					toolName: "run_commands",
					input: { command: "pwd", requires_approval: true },
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
			sessionId: "sess_pwd_escalate",
			agentId: "agent_pwd_escalate",
			conversationId: "conv_pwd_escalate",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		});

		await runtime.run("pwd (model escalation)");

		expect(executor).not.toHaveBeenCalled();
		expect(requestToolApproval).toHaveBeenCalledTimes(1);
	});

	it("safe-only + git status + model=false => executor=1 (host ALLOW via safe rule)", async () => {
		const executor = vi.fn(async () => ({ output: "git status ok" }));
		const tool = createRunCommandsTool(executor);

		const requestToolApproval = vi.fn(
			async (req: { toolName: string; input: unknown }) => {
				const auth = commandHostAuthorization({
					mode: "safe-only",
					explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
				});
				const result = evaluateCommandPolicy({
					toolInput: req.input,
					hostAuthorization: auth,
				});
				return {
					approved: result.decision.kind === "allow",
					reason: result.decision.reason,
				};
			},
		);

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_git",
					toolName: "run_commands",
					input: { command: "git status", requires_approval: false },
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "ok" },
				{ type: "finish", reason: "stop" },
			],
		]);

		const runtime = new AgentRuntime({
			sessionId: "sess_git",
			agentId: "agent_git",
			conversationId: "conv_git",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
			...createTelemetryMock(),
		});

		await runtime.run("git status");

		expect(executor).toHaveBeenCalledTimes(1);
	});
});

describe("Real AgentRuntime — runtime contract: toolPolicies[*].autoApprove bypass", () => {
	// Documents and guards the runtime contract that production hosts rely on.
	// Wildcard toolPolicies["*"].autoApprove = true bypasses the approval
	// callback entirely. Hosts MUST scope autoApprove=false to command tools
	// (e.g. toolPolicies["run_commands"] = { autoApprove: false }) so the
	// runtime always consults the host approval callback for command tools.
	it("toolPolicies[*].autoApprove=true bypasses requestToolApproval (documented contract)", async () => {
		const executor = vi.fn(async () => ({ output: "executed" }));
		const tool = createRunCommandsTool(executor);

		const requestToolApproval = vi.fn(async () => ({ approved: false }));

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_bypass",
					toolName: "run_commands",
					input: { command: "rm -rf /", requires_approval: false },
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "after" },
				{ type: "finish", reason: "stop" },
			],
		]);

		const runtime = new AgentRuntime({
			sessionId: "sess_bypass",
			agentId: "agent_bypass",
			conversationId: "conv_bypass",
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: true } },
			requestToolApproval,
			...createTelemetryMock(),
		});

		await runtime.run("rm -rf /");

		expect(requestToolApproval).not.toHaveBeenCalled();
		expect(executor).toHaveBeenCalledTimes(1);
	});

	it("scoped run_commands autoApprove=false forces approval callback even when '*'.autoApprove=true", async () => {
		const executor = vi.fn(async () => ({ output: "ran" }));
		const tool = createRunCommandsTool(executor);

		const requestToolApproval = vi.fn(
			async (req: { toolName: string; input: unknown }) => {
				const auth = commandHostAuthorization({ mode: "manual" });
				const result = evaluateCommandPolicy({
					toolInput: req.input,
					hostAuthorization: auth,
				});
				return { approved: result.decision.kind === "allow" };
			},
		);

		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "tc_scoped",
					toolName: "run_commands",
					input: { command: "rm -rf /", requires_approval: false },
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
			sessionId: "sess_scoped",
			agentId: "agent_scoped",
			conversationId: "conv_scoped",
			model,
			tools: [tool],
			// Wildcard autoApprove=true, BUT the scoped entry for
			// run_commands forces autoApprove=false. The runtime merges
			// these with the per-tool entry taking precedence, so the
			// approval callback IS consulted for run_commands.
			toolPolicies: {
				"*": { autoApprove: true },
				run_commands: { autoApprove: false },
			},
			requestToolApproval,
			...createTelemetryMock(),
		});

		await runtime.run("rm -rf /");

		expect(requestToolApproval).toHaveBeenCalledTimes(1);
		expect(executor).not.toHaveBeenCalled();
	});
});
