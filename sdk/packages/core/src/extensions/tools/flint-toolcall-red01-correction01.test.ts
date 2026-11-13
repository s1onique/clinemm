/**
 * ACT-CLINEMM-FLINT-TOOLCALL-RED-01-CORRECTION01
 *
 * Production-seam RED -> GREEN reproduction for the SECOND live Flint
 * session, which exposed two additional single-string `run_commands`
 * argument shapes that the FLINT-TOOLCALL-RED-01 canonicalizer
 * deliberately left unchanged.
 *
 * ## Evidence (REAL, second session)
 *
 * Session `1794593797996_r48lj.messages.json` (installed version
 * `4.1.16-5a1c485cb-0b6ec51af`, model `flint:16gb`, provider
 * `openai-compatible`). All 12 `run_commands` tool calls in the
 * transcript, classified by the tool result they received:
 *
 * | Argument shape            | Calls | Outcome  |
 * |--------------------------|-------|----------|
 * | `{"commands":[...]}`      | 4     | ACCEPTED |
 * | `{"command":"[\"...\"]"}` | 1     | ACCEPTED |
 * | `{"commands":"shell"}`    | 5     | REJECTED |
 * | `{"command":"shell"}`     | 2     | REJECTED |
 *
 * The single `{"command":"[\"...\"]"}` call PASSED in the live session,
 * which is direct behavioral evidence that the FLINT-TOOLCALL-RED-01
 * canonicalizer is active in the installed artifact.
 *
 * The 7 REJECTED calls are reproduced here VERBATIM (message indices 2,
 * 5, 8, 11, 14, 18, 21 of the transcript). Their live tool results were:
 *
 *   `{"commands": "..."}`  ->  Invalid input for tool run_commands:
 *                              x Invalid input: expected array, received string
 *                                -> at commands
 *   `{"command": "..."}`   ->  Invalid input for tool run_commands:
 *                              x Unrecognized key: "command"
 *                              x Invalid input: expected array, received undefined
 *                                -> at commands
 *
 * The first rejection occurs at message index 2 — i.e. EARLY in the
 * session. This corrects an earlier inference: the defect is NOT
 * long-context-only; the model's argument formatting is inconsistent
 * from the start of the session.
 *
 * ## What this test drives
 *
 * The REAL production seams:
 *   - `createShellTool` (the real production `run_commands` tool factory),
 *   - the real strict `RunCommandsInputSchema`,
 *   - the real generic pre-validation normalization
 *     (`normalizeJsonLikeStringsForSchema`),
 *   - the real bounded tool-scoped canonicalizer
 *     (`normalizeRunCommandsToolInput`),
 *   - `createTool`'s auto-generated `validateInput`,
 *   - the real `AgentRuntime` dispatch path, including the approval
 *     round-trip that runs AFTER validation.
 *
 * NO shell command is ever executed: the tool is built with a RECORDING
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

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

// ---------------------------------------------------------------------------
// Deterministic scripted provider
// ---------------------------------------------------------------------------

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
	p: RawProposal,
): (req: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId: p.toolCallId,
			toolName: p.toolName,
			inputText: p.inputText,
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

function finalTextStep(): (
	req: AgentModelRequest,
) => Iterable<AgentModelEvent> {
	return () => [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	];
}

// ---------------------------------------------------------------------------
// LIVE evidence — the 7 REJECTED calls of session 1794593797996_r48lj
// ---------------------------------------------------------------------------

const KEYCLOAK_ROOT =
	"/Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak";

/**
 * The five `{"commands": "<shell text>"}` calls rejected in the live
 * session. They are reproduced VERBATIM from the transcript.
 */
const LIVE_REJECTED_COMMANDS_KEYED: ReadonlyArray<Record<string, unknown>> = [
	{ commands: `ls -la ${KEYCLOAK_ROOT}` },
	{ commands: `ls -la ${KEYCLOAK_ROOT}` },
	{ commands: `ls -la ${KEYCLOAK_ROOT}` },
	{ commands: `ls -la ${KEYCLOAK_ROOT}` },
	{
		commands: `find ${KEYCLOAK_ROOT} -maxdepth 2 -not -path '*/.git/*' -not -path '*/.pnpm-store*' -not -path '*/logs*' -not -path '*/profiles*' -not -path '*/node_modules*' -type d | head -40`,
	},
];

/**
 * The two `{"command": "<shell text>"}` calls rejected in the live session.
 * They are reproduced VERBATIM from the transcript.
 */
const LIVE_REJECTED_COMMAND_KEYED: ReadonlyArray<Record<string, unknown>> = [
	{ command: `ls -la ${KEYCLOAK_ROOT}` },
	{ command: `git -C ${KEYCLOAK_ROOT} log --oneline -50` },
];

/**
 * The single ACCEPTED `{"command":"[\"...\"]"}` call of the live session.
 * It MUST keep working — this is the previously repaired shape.
 */
const LIVE_ACCEPTED_COMMAND_JSON_ARRAY = {
	command: `["wc -l ${KEYCLOAK_ROOT}/.gitlab-ci.yml", "grep -n '^\\\\- \\\\|^\\\\s*- name:\\\\|^stages:\\\\|^\\\\.\\\\|^jobs:\\\\|^\\\\s*[a-zA-Z_.-]*:' ${KEYCLOAK_ROOT}/.gitlab-ci.yml"]`,
} as const;

// ---------------------------------------------------------------------------
// Runner — the REAL production `run_commands` tool (createShellTool)
// ---------------------------------------------------------------------------

/**
 * One recorded command handed to the executor. The executor is the ONLY
 * place a shell process could start, so an empty `executed` list is direct
 * evidence of "zero process starts".
 */
interface ExecutedCommand {
	command: string | { command: string; args?: string[] };
	cwd: string;
}

interface ApprovalProbe {
	/** The exact tool input the approval callback received. */
	input: unknown;
	approved: boolean;
}

interface CapturedOutcome {
	toolCallId: string;
	toolName: string;
	outcome: ToolRuntimeOutcome;
}

interface ProbeResult {
	result: Awaited<ReturnType<AgentRuntime["run"]>>;
	messages: readonly AgentMessage[];
	captured: CapturedOutcome[];
	executed: ExecutedCommand[];
	approvals: ApprovalProbe[];
	requestCount: number;
	toolResultTexts: string[];
}

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
	for (const msg of result.messages) {
		for (const part of msg.content) {
			if (part.type !== "tool-result") continue;
			toolResultTexts.push(
				typeof part.output === "string"
					? part.output
					: JSON.stringify(part.output),
			);
		}
	}

	return {
		result,
		messages: result.messages,
		captured,
		executed,
		approvals,
		requestCount: model.requests.length,
		toolResultTexts,
	};
}

// ---------------------------------------------------------------------------
// RED -> GREEN
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-FLINT-TOOLCALL-RED-01-CORRECTION01", () => {
	describe("GREEN — the 7 live-rejected shapes are now accepted", () => {
		it("GREEN1_LIVE_COMMANDS_KEYED_STRING_IS_CANONICALIZED_AND_EXECUTED", async () => {
			const probe = await drive([
				proposalFromJson("g1", LIVE_REJECTED_COMMANDS_KEYED[0]),
			]);

			// The command that reaches the executor is the REAL command text,
			// never a serialized array.
			expect(probe.executed).toHaveLength(1);
			expect(probe.executed[0]!.command).toBe(`ls -la ${KEYCLOAK_ROOT}`);

			// The approval callback observed the SAME canonical input.
			expect(probe.approvals).toHaveLength(1);
			expect(probe.approvals[0]!.input).toEqual({
				commands: [`ls -la ${KEYCLOAK_ROOT}`],
			});

			expect(probe.captured[0]!.outcome.kind).toBe("success");
			expect(probe.toolResultTexts.join("\n")).not.toContain(
				"Invalid input for tool run_commands",
			);
		});

		it("GREEN2_ALL_5_LIVE_COMMANDS_KEYED_STRINGS_ARE_ACCEPTED", async () => {
			for (const [index, captured] of LIVE_REJECTED_COMMANDS_KEYED.entries()) {
				const probe = await drive([proposalFromJson(`g2-${index}`, captured)]);

				expect(probe.executed, `payload ${index}`).toHaveLength(1);
				expect(probe.executed[0]!.command, `payload ${index}`).toBe(
					captured.commands as string,
				);
				expect(probe.approvals[0]!.input, `payload ${index}`).toEqual({
					commands: [captured.commands as string],
				});
				expect(probe.captured[0]!.outcome.kind, `payload ${index}`).toBe(
					"success",
				);
			}
		});

		it("GREEN3_LIVE_COMMAND_KEYED_STRING_IS_CANONICALIZED_AND_EXECUTED", async () => {
			const probe = await drive([
				proposalFromJson("g3", LIVE_REJECTED_COMMAND_KEYED[0]),
			]);

			expect(probe.executed).toHaveLength(1);
			expect(probe.executed[0]!.command).toBe(`ls -la ${KEYCLOAK_ROOT}`);
			expect(probe.approvals).toHaveLength(1);
			expect(probe.approvals[0]!.input).toEqual({
				commands: [`ls -la ${KEYCLOAK_ROOT}`],
			});
			expect(probe.captured[0]!.outcome.kind).toBe("success");
		});

		it("GREEN4_BOTH_LIVE_COMMAND_KEYED_STRINGS_ARE_ACCEPTED", async () => {
			for (const [index, captured] of LIVE_REJECTED_COMMAND_KEYED.entries()) {
				const probe = await drive([proposalFromJson(`g4-${index}`, captured)]);

				expect(probe.executed, `payload ${index}`).toHaveLength(1);
				expect(probe.executed[0]!.command, `payload ${index}`).toBe(
					captured.command as string,
				);
				expect(probe.approvals[0]!.input, `payload ${index}`).toEqual({
					commands: [captured.command as string],
				});
				expect(probe.captured[0]!.outcome.kind, `payload ${index}`).toBe(
					"success",
				);
			}
		});

		it("GREEN5_PREVIOUSLY_REPAIRED_COMMAND_JSON_ARRAY_SHAPE_STILL_WORKS", async () => {
			// The single ACCEPTED live call of session 1794593797996_r48lj.
			const probe = await drive([
				proposalFromJson("g5", LIVE_ACCEPTED_COMMAND_JSON_ARRAY),
			]);

			expect(probe.executed).toHaveLength(2);
			// The expected commands are the DECODED members of the captured
			// JSON array string — derived from the constant so the
			// expectation cannot drift from the evidence.
			expect(probe.executed.map((e) => e.command)).toEqual(
				JSON.parse(LIVE_ACCEPTED_COMMAND_JSON_ARRAY.command) as string[],
			);
			expect(probe.captured[0]!.outcome.kind).toBe("success");
		});

		it("GREEN6_CANONICAL_COMMANDS_ARRAY_IS_UNCHANGED", async () => {
			const canonical = { commands: ["echo one", "echo two"] };
			const probe = await drive([proposalFromJson("g6", canonical)]);

			expect(probe.executed.map((e) => e.command)).toEqual([
				"echo one",
				"echo two",
			]);
			expect(probe.approvals[0]!.input).toEqual(canonical);
		});

		it("GREEN7_NOTIFY_ON_COMPLETION_IS_PRESERVED_FOR_CANONICAL_CALLS", async () => {
			const canonical = {
				commands: ["echo one"],
				notifyOnCompletion: true,
			};
			const probe = await drive([proposalFromJson("g7", canonical)]);

			expect(probe.executed).toHaveLength(1);
			expect(probe.approvals[0]!.input).toEqual(canonical);
			expect(probe.captured[0]!.outcome.kind).toBe("success");
		});
	});

	describe("rejection matrix — unchanged strictness", () => {
		/**
		 * Every rejected shape must produce ZERO process starts and ZERO
		 * approvals, and must be reported as `tool_input_invalid`.
		 */
		const REJECTED: ReadonlyArray<{ name: string; input: unknown }> = [
			{ name: "empty commands string", input: { commands: "" } },
			{ name: "whitespace-only commands string", input: { commands: "   " } },
			{ name: "empty command string", input: { command: "" } },
			{ name: "whitespace-only command string", input: { command: "   " } },
			{
				name: "conflicting command and commands keys",
				input: { command: "echo hello", commands: ["echo hello"] },
			},
			{
				name: "conflicting command string and commands array",
				input: { command: '["echo hello"]', commands: ["echo hello"] },
			},
			{
				name: "unknown sibling key with commands string",
				input: { commands: "echo hello", timeout: 10 },
			},
			{
				name: "unknown sibling key with command string",
				input: { command: "echo hello", timeout: 10 },
			},
			{
				name: "commands string with notifyOnCompletion sibling",
				input: { commands: "echo hello", notifyOnCompletion: true },
			},
			{
				name: "command string with notifyOnCompletion sibling",
				input: { command: "echo hello", notifyOnCompletion: true },
			},
			{
				name: "commands string with a JSON object value",
				input: { commands: '{"commands":["echo hello"]}' },
			},
			{
				name: "command string with a JSON object value",
				input: { command: '{"commands":["echo hello"]}' },
			},
			{
				name: "commands string with malformed JSON",
				input: { commands: '["echo hello"' },
			},
			{
				name: "commands string with an empty JSON array",
				input: { commands: "[]" },
			},
			{
				name: "commands string with a JSON array of non-strings",
				input: { commands: '["echo hello", 42]' },
			},
			{
				name: "commands string with a nested JSON array",
				input: { commands: '[["echo hello"]]' },
			},
			{
				name: "commands string with a null JSON member",
				input: { commands: '["echo hello", null]' },
			},
			{ name: "commands null", input: { commands: null } },
			{ name: "command null", input: { command: null } },
			{ name: "commands empty array", input: { commands: [] } },
			{ name: "non-string commands value", input: { commands: 42 } },
			{ name: "non-string command value", input: { command: 42 } },
			{
				name: "canonical commands with unknown sibling",
				input: { commands: ["echo hello"], timeout: 10 },
			},
			{ name: "bare array input", input: ["echo hello"] },
			{ name: "bare string input", input: "echo hello" },
		];

		for (const { name, input } of REJECTED) {
			it(`REJECTS_${name.replace(/\s+/g, "_").toUpperCase()}`, async () => {
				const probe = await drive([proposalFromJson("rej", input)]);

				// Zero process starts.
				expect(probe.executed).toHaveLength(0);
				// Zero approvals (the call never reached the authorization step).
				expect(probe.approvals).toHaveLength(0);

				const outcome = probe.captured[0]!.outcome;
				expect(outcome.kind).toBe("failure");
				if (outcome.kind !== "failure") throw new Error("narrow");
				expect(outcome.failureClass).toBe("tool_input_invalid");
			});
		}
	});

	describe("security invariants", () => {
		it("NEVER_EXECUTES_SERIALIZED_JSON_AS_SHELL_CODE", async () => {
			// The serialized JSON TEXT must never be handed to the executor
			// as a command. The check is on the serialized payload itself
			// (not on bracket characters) because a legitimate shell command
			// may legitimately contain a bracket — e.g. the captured grep
			// pattern `[a-zA-Z_.-]`.
			for (const captured of [
				LIVE_ACCEPTED_COMMAND_JSON_ARRAY,
				{ commands: '["echo hello"]' },
			]) {
				const probe = await drive([proposalFromJson("anti-shell", captured)]);
				for (const entry of probe.executed) {
					const asText = typeof entry.command === "string" ? entry.command : "";
					expect(asText).not.toBe(JSON.stringify(captured));
					expect(asText.trimStart().startsWith("[")).toBe(false);
				}
			}
		});

		it("APPROVAL_PREVIEW_MATCHES_EXECUTOR_COMMANDS_EXACTLY", async () => {
			// The approval card and the executor MUST observe the SAME
			// canonical commands. A mismatch would let a command run that
			// was never shown for approval.
			for (const captured of [
				LIVE_REJECTED_COMMANDS_KEYED[0],
				LIVE_REJECTED_COMMAND_KEYED[1],
				LIVE_ACCEPTED_COMMAND_JSON_ARRAY,
			]) {
				const probe = await drive([proposalFromJson("align", captured)]);

				const approved = probe.approvals[0]!.input as { commands: string[] };
				expect(Array.isArray(approved.commands)).toBe(true);
				expect(probe.executed.map((e) => e.command)).toEqual(approved.commands);
			}
		});

		it("REJECTED_INPUT_PRODUCES_ZERO_APPROVALS_AND_ZERO_STARTS", async () => {
			const probe = await drive([proposalFromJson("zero", { command: "" })]);
			expect(probe.approvals).toHaveLength(0);
			expect(probe.executed).toHaveLength(0);
		});
	});
});
