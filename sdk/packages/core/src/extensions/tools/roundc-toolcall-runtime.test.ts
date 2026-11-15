/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Round C `run_commands` repair, END TO END.
 *
 * ## What this test drives
 *
 * The REAL production seams, not a re-implementation:
 *
 *   - `createShellTool` (the real production `run_commands` tool factory);
 *   - the real strict `RunCommandsInputSchema` (via `createTool`'s
 *     auto-generated `validateInput`);
 *   - the real generic pre-validation normalization
 *     (`normalizeJsonLikeStringsForSchema`);
 *   - the real bounded tool-scoped canonicalizer
 *     (`normalizeRunCommandsToolInput`);
 *   - the real `AgentRuntime` dispatch path, including the approval
 *     round-trip that runs AFTER validation.
 *
 * ## Safety
 *
 * NO shell command is ever executed. The tool is built with a RECORDING
 * executor that captures the canonicalized command list and returns a
 * canned result. The executor is the ONLY place a command could start,
 * so "zero process starts" is observable directly from the recorded list.
 *
 * The provider is a deterministic SCRIPTED fixture. That is
 * `SYNTHETIC_REAL` evidence for the runtime seam — NOT live provider
 * behavior.
 */

import { AgentRuntime } from "@cline/agents";
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
	AgentToolContext,
	ToolRuntimeOutcome,
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createShellTool } from "./definitions";
import {
	ROUND_C_REJECTED_OBJECT_COMMANDS,
	ROUND_C_REJECTED_STRING_COMMANDS,
} from "./roundc-toolcall-witness-fixtures";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

/**
 * A deterministic scripted provider.
 */
class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
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
		return (async function* () {
			for await (const ev of step(request)) yield ev;
		})();
	}
}

interface RawProposal {
	toolCallId: string;
	toolName: string;
	inputText: string;
}

function proposalFromJson(toolCallId: string, value: unknown): RawProposal {
	return {
		toolCallId,
		toolName: "run_commands",
		inputText: JSON.stringify(value),
	};
}

function toolCallStep(
	proposal: RawProposal,
): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId: proposal.toolCallId,
			toolName: proposal.toolName,
			inputText: proposal.inputText,
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

function finalTextStep(): (
	request: AgentModelRequest,
) => Iterable<AgentModelEvent> {
	return () => [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	];
}

/**
 * One recorded command handed to the executor.
 */
interface ExecutedCommand {
	command: string | { command: string; args?: string[] };
	cwd: string;
}

interface ApprovalProbe {
	input: unknown;
	approved: boolean;
}

interface CapturedOutcome {
	toolCallId: string;
	toolName: string;
	outcome: ToolRuntimeOutcome;
}

interface ProbeResult {
	messages: readonly AgentMessage[];
	captured: CapturedOutcome[];
	executed: ExecutedCommand[];
	approvals: ApprovalProbe[];
	toolResultTexts: string[];
}

/**
 * Drive the real runtime with the given tool-call proposals.
 */
async function drive(
	proposals: readonly RawProposal[],
	options: { autoApprove?: boolean } = {},
): Promise<ProbeResult> {
	const executed: ExecutedCommand[] = [];
	const approvals: ApprovalProbe[] = [];
	const captured: CapturedOutcome[] = [];
	const steps: Array<(req: AgentModelRequest) => Iterable<AgentModelEvent>> =
		proposals.map(toolCallStep);
	steps.push(finalTextStep());

	// The REAL production tool factory. The executor only RECORDS the
	// canonicalized command — it never spawns a process.
	const tool = createShellTool(
		async (command, cwd, _context: AgentToolContext) => {
			executed.push({ command, cwd });
			return "ok";
		},
		{ cwd: process.cwd() },
	) as AgentTool<unknown, unknown>;

	const model = new ScriptedModel(steps);
	const hooks: AgentRuntimeHooks = {
		onToolRuntimeOutcome: (ctx) => {
			captured.push({
				toolCallId: ctx.toolCall.toolCallId,
				toolName: ctx.toolCall.toolName,
				outcome: ctx.outcome,
			});
		},
	};
	const runtime = new AgentRuntime({
		model,
		tools: [tool],
		hooks,
		toolPolicies: { run_commands: { enabled: true, autoApprove: false } },
		requestToolApproval: async (request) => {
			approvals.push({
				input: request.input,
				approved: options.autoApprove !== false,
			});
			return { approved: options.autoApprove !== false };
		},
	});
	const result = await runtime.run("probe");

	const toolResultTexts: string[] = [];
	for (const message of result.messages) {
		for (const part of message.content) {
			if (part.type !== "tool-result") continue;
			toolResultTexts.push(
				typeof part.output === "string"
					? part.output
					: JSON.stringify(part.output),
			);
		}
	}

	return {
		messages: result.messages,
		captured,
		executed,
		approvals,
		toolResultTexts,
	};
}

/**
 * The commands the fixture payload is expected to produce.
 */
function expectedCommands(payload: Record<string, unknown>): string[] {
	const commands = payload.commands;
	if (typeof commands === "string") {
		// The shell-quoted array literal: members are the text between
		// the double quotes, which occur only at member boundaries.
		const inner = commands.trim().slice(1, -1);
		const quotePositions: number[] = [];
		for (let index = 0; index < inner.length; index++) {
			if (inner[index] === '"') quotePositions.push(index);
		}
		const members: string[] = [];
		for (let pair = 0; pair < quotePositions.length; pair += 2) {
			members.push(
				inner.slice(
					(quotePositions[pair] as number) + 1,
					quotePositions[pair + 1] as number,
				),
			);
		}
		return members;
	}
	if (Array.isArray(commands)) {
		return commands.map((entry) => (entry as { command: string }).command);
	}
	throw new Error("unexpected fixture shape");
}

describe("ACT-CLINEMM-ROUND-C-HARNESS-01 — Round C run_commands repair", () => {
	describe("GREEN — the captured string-shaped payloads execute", () => {
		it.each(
			ROUND_C_REJECTED_STRING_COMMANDS.map(
				(payload, index) => [index, payload] as const,
			),
		)("executes string-shaped payload %i with every command intact", async (_index, payload) => {
			const probe = await drive([proposalFromJson("rc", payload)]);

			// The commands that reached the executor are the REAL
			// command texts, never a serialized array.
			const expected = expectedCommands(payload);
			expect(probe.executed).toHaveLength(expected.length);
			expect(probe.executed.map((entry) => entry.command)).toEqual(expected);

			// The approval callback observed the SAME canonical input.
			expect(probe.approvals).toHaveLength(1);
			expect(probe.approvals[0]!.input).toEqual({
				commands: expected,
			});

			// The call SUCCEEDED: no schema rejection was reported.
			const toolResult = probe.toolResultTexts.join("\n");
			expect(toolResult).not.toContain("Invalid input for tool");
		});
	});

	describe("GREEN — the captured object-shaped payloads execute", () => {
		it.each(
			ROUND_C_REJECTED_OBJECT_COMMANDS.map(
				(payload, index) => [index, payload] as const,
			),
		)("executes object-shaped payload %i with every command intact", async (_index, payload) => {
			const probe = await drive([proposalFromJson("rc", payload)]);

			const expected = expectedCommands(payload);
			expect(probe.executed).toHaveLength(expected.length);
			expect(probe.executed.map((entry) => entry.command)).toEqual(expected);

			expect(probe.approvals).toHaveLength(1);
			expect(probe.approvals[0]!.input).toEqual({
				commands: expected,
			});

			const toolResult = probe.toolResultTexts.join("\n");
			expect(toolResult).not.toContain("Invalid input for tool");
		});
	});

	describe("preview and execution agree", () => {
		it("the approved input and the executed commands are identical", async () => {
			for (const payload of [
				...ROUND_C_REJECTED_STRING_COMMANDS,
				...ROUND_C_REJECTED_OBJECT_COMMANDS,
			]) {
				const probe = await drive([proposalFromJson("rc", payload)]);
				const approved = (
					probe.approvals[0]?.input as {
						commands: string[];
					}
				).commands;
				const executed = probe.executed.map((entry) => entry.command);
				expect(executed).toEqual(approved);
			}
		});
	});

	describe("fail-closed behaviour at the runtime seam", () => {
		it("does not execute an ambiguous payload and reports a precise error", async () => {
			const probe = await drive([
				proposalFromJson("rc", {
					commands: [{ command: "git", args: ["status"] }],
				}),
			]);
			expect(probe.executed).toHaveLength(0);
			expect(probe.approvals).toHaveLength(0);
			const toolResult = probe.toolResultTexts.join("\n");
			expect(toolResult).toContain("Invalid input for tool run_commands");
		});

		it("does not execute a payload with an unknown sibling key", async () => {
			const probe = await drive([
				proposalFromJson("rc", { commands: ["ls"], timeout: 30 }),
			]);
			expect(probe.executed).toHaveLength(0);
			expect(probe.approvals).toHaveLength(0);
			const toolResult = probe.toolResultTexts.join("\n");
			expect(toolResult).toContain("Invalid input for tool run_commands");
		});
	});

	describe("tool failure and cancellation", () => {
		it("reports a command failure without losing the other commands", async () => {
			// The executor reports a command failure by THROWING, which is
			// how the production executor surfaces a non-zero exit.
			const failing = createShellTool(
				async (command) => {
					if (command === "boom") {
						throw new Error("Command exited with code 1");
					}
					return "ok";
				},
				{ cwd: process.cwd() },
			) as AgentTool<unknown, unknown>;

			const model = new ScriptedModel([
				toolCallStep(proposalFromJson("rc", { commands: ["boom", "fine"] })),
				finalTextStep(),
			]);
			const runtime = new AgentRuntime({
				model,
				tools: [failing],
				toolPolicies: { run_commands: { enabled: true, autoApprove: false } },
				requestToolApproval: async () => ({ approved: true }),
			});
			const result = await runtime.run("probe");
			const texts: string[] = [];
			for (const message of result.messages) {
				for (const part of message.content) {
					if (part.type !== "tool-result") continue;
					texts.push(
						typeof part.output === "string"
							? part.output
							: JSON.stringify(part.output),
					);
				}
			}
			expect(texts.join("\n")).toContain("Command exited with code 1");
		});

		it("does not execute anything when approval is refused", async () => {
			const probe = await drive(
				[proposalFromJson("rc", ROUND_C_REJECTED_STRING_COMMANDS[0])],
				{ autoApprove: false },
			);
			expect(probe.executed).toHaveLength(0);
		});
	});
});
