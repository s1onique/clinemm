/**
 * ACT-CLINEMM-FLINT-TOOLCALL-RED-01
 *
 * Production-seam RED -> GREEN reproduction and discriminator for the
 * observed Flint `run_commands` schema failures.
 *
 * ## Evidence (REAL)
 *
 * Session `1794587196390_xn030.messages.json` (installed version
 * `4.1.16-5a1c485cb`, model `flint:16gb`, provider `openai-compatible`).
 * Starting at message index 37 (inputTokens = 29323), 11 assistant tool
 * calls use the shape:
 *
 *   { "command": "[\"echo hello\"]" }
 *
 * i.e. the SINGULAR key `command` whose value is a STRING containing a
 * JSON-encoded array — NOT the canonical `{ "commands": [...] }`.
 *
 * The captured tool-result for every one of those calls is:
 *
 *   Invalid input for tool run_commands: ✖ Unrecognized key: "command"
 *   ✖ Invalid input: expected array, received undefined
 *     → at commands
 *
 * ## What this test drives
 *
 * The REAL production seams:
 *   - `createShellTool` (the real production `run_commands` tool factory in
 *     `sdk/packages/core/src/extensions/tools/definitions.ts`),
 *   - the real `RunCommandsInputSchema` (strict, `additionalProperties:
 *     false`) plus the real bounded compatibility canonicalizer,
 *   - `createTool`'s auto-generated `validateInput`
 *     (`sdk/packages/shared/src/tools/create.ts`),
 *   - the real `AgentRuntime` dispatch path
 *     (`sdk/packages/agents/src/agent-runtime.ts`), including the
 *     compatibility step that runs immediately BEFORE validation and the
 *     approval round-trip that runs AFTER validation,
 *   - the real tool-result delivery back to model history.
 *
 * NO shell command is ever executed: the tool is built with a RECORDING
 * executor that captures the canonicalized command list and returns a
 * canned result. The executor is the ONLY place a command could start, so
 * "zero process starts" is observable directly from the recorded list.
 *
 * The provider is a deterministic SCRIPTED fixture. That is
 * `SYNTHETIC_REAL` evidence for the runtime seam — NOT live provider
 * behavior, and NOT promoted to live evidence here.
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

/**
 * The captured malformed shape, verbatim from the session transcript:
 * `{ "command": "[\"echo hello\"]" }`.
 *
 * `command` is the SINGULAR key and the value is a STRING containing a
 * JSON-encoded array. This is materially different from the canonical
 * `{ "commands": ["echo hello"] }` and from the single-command
 * `{ "command": "echo hello" }`.
 */
const CAPTURED_MALFORMED_INPUT = {
	command: '["echo hello"]',
} as const;

/** The canonical payload that must keep working after any repair. */
const CANONICAL_INPUT = {
	commands: ["echo hello"],
} as const;

/**
 * Every one of the 11 captured malformed payloads in the transcript, in
 * order. All 11 share the exact same shape: a single `command` key whose
 * value is a JSON-encoded array of shell command strings.
 */
const CAPTURED_MALFORMED_INPUTS: ReadonlyArray<Record<string, unknown>> = [
	{
		command:
			'["for d in phone-providers russian-providers roz-themes load-tests tools freemarker-provider startup.sh; do echo \\"=== $d ===\\"; ls -la /Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak/$d; done"]',
	},
	{
		command:
			'["for d in phone-providers russian-providers roz-themes load-tests tools freemarker-provider startup.sh; do echo \\"=== $d ===\\"; ls -la /Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak/$d; done"]',
	},
	{
		command:
			'["for d in phone-providers russian-providers roz-themes load-tests tools freemarker-provider; do echo \\"=== $d ===\\"; ls -la /Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak/$d; done"]',
	},
	{
		command:
			'["ls -la /Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak/phone-providers /Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak/russian-providers"]',
	},
	{ command: '["echo hello"]' },
	{ command: '["echo ok"]' },
	{ command: '["pwd"]' },
	{ command: '["echo test"]' },
	{ command: '["echo test 123"]' },
	{ command: '["ls"]' },
	{ command: '["echo hello world"]' },
];

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
// RED -> GREEN + discriminators
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-FLINT-TOOLCALL-RED-01", () => {
	it("GREEN1_CAPTURED_MALFORMED_PAYLOAD_IS_CANONICALIZED_AND_EXECUTED", async () => {
		const probe = await drive([
			proposalFromJson("g1", CAPTURED_MALFORMED_INPUT),
		]);

		// The command that reaches the executor is the REAL command, never
		// the serialized JSON text.
		expect(probe.executed).toHaveLength(1);
		expect(probe.executed[0]!.command).toBe("echo hello");

		// The approval callback observed the SAME canonical input.
		expect(probe.approvals).toHaveLength(1);
		expect(probe.approvals[0]!.input).toEqual({ commands: ["echo hello"] });

		const outcome = probe.captured[0]!.outcome;
		expect(outcome.kind).toBe("success");
	});

	it("GREEN2_ALL_11_CAPTURED_PAYLOADS_CANONICALIZE_TO_THEIR_ARRAY_MEMBERS", async () => {
		for (const [index, captured] of CAPTURED_MALFORMED_INPUTS.entries()) {
			const probe = await drive([proposalFromJson(`g2-${index}`, captured)]);
			expect(probe.executed, `payload ${index}`).toHaveLength(1);
			const expected = JSON.parse(captured.command as string) as string[];
			expect(probe.executed[0]!.command, `payload ${index}`).toBe(expected[0]);
			expect(probe.approvals[0]!.input, `payload ${index}`).toEqual({
				commands: expected,
			});
		}
	});

	it("GREEN3_CANONICAL_PAYLOAD_IS_CONSERVED", async () => {
		const probe = await drive([proposalFromJson("g3", CANONICAL_INPUT)]);

		expect(probe.executed).toHaveLength(1);
		expect(probe.executed[0]!.command).toBe("echo hello");
		expect(probe.approvals[0]!.input).toEqual({ commands: ["echo hello"] });
		expect(probe.captured[0]!.outcome.kind).toBe("success");
	});

	it("GREEN4_MULTIPLE_COMMAND_SEMANTICS_ARE_CONSERVED", async () => {
		const multi = { commands: ["echo one", "echo two", "echo three"] };
		const probe = await drive([proposalFromJson("g4", multi)]);

		expect(probe.executed.map((e) => e.command)).toEqual([
			"echo one",
			"echo two",
			"echo three",
		]);
		expect(probe.approvals[0]!.input).toEqual(multi);
	});

	it("GREEN5_MULTI_MEMBER_CAPTURED_ARRAY_PRESERVES_MEMBER_COUNT", async () => {
		// A captured-shape payload carrying MULTIPLE members must fan out
		// to multiple commands, not collapse into one.
		const captured = { command: '["echo a","echo b"]' };
		const probe = await drive([proposalFromJson("g5", captured)]);

		expect(probe.executed.map((e) => e.command)).toEqual(["echo a", "echo b"]);
		expect(probe.approvals[0]!.input).toEqual({
			commands: ["echo a", "echo b"],
		});
	});
});

describe("ACT-CLINEMM-FLINT-TOOLCALL-RED-01 / rejection matrix", () => {
	/**
	 * Every rejected shape must produce ZERO process starts and ZERO
	 * approvals, and must be reported as `tool_input_invalid`.
	 */
	const REJECTED: ReadonlyArray<{ name: string; input: unknown }> = [
		{
			name: "conflicting commands sibling",
			input: { command: '["echo hello"]', commands: ["echo hello"] },
		},
		{
			name: "unknown sibling key",
			input: { command: '["echo hello"]', timeout: 10 },
		},
		{
			name: "notifyOnCompletion sibling",
			input: { command: '["echo hello"]', notifyOnCompletion: true },
		},
		{
			name: "non-string command value",
			input: { command: ["echo hello"] },
		},
		{
			name: "command value is a JSON object",
			input: { command: '{"commands":["echo hello"]}' },
		},
		{
			name: "command value is malformed JSON",
			input: { command: '["echo hello"' },
		},
		{
			name: "command value is an empty JSON array",
			input: { command: "[]" },
		},
		{
			name: "command value is a JSON array with a non-string member",
			input: { command: '["echo hello", 42]' },
		},
		{
			name: "command value is a JSON array with a nested array member",
			input: { command: '[["echo hello"]]' },
		},
		{
			name: "command value is a JSON array with a null member",
			input: { command: '["echo hello", null]' },
		},
		{
			name: "canonical commands with unknown sibling",
			input: { commands: ["echo hello"], timeout: 10 },
		},
		{
			name: "commands null",
			input: { commands: null },
		},
		{
			name: "commands empty array",
			input: { commands: [] },
		},
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

	it("BARE_COMMAND_STRING_IS_NOW_ACCEPTED_AS_A_SINGLE_COMMAND", async () => {
		// ACT-CLINEMM-FLINT-TOOLCALL-RED-01-CORRECTION01: this shape was
		// a REJECTION under the original narrow contract
		// ("bare command string is not reinterpreted"). The second live
		// session (`1794593797996_r48lj.messages.json`) proved it is a
		// REAL, frequently emitted argument shape that the model expects
		// to be executed — 2 of the 12 live calls used it and both were
		// rejected. It is therefore now ACCEPTED and canonicalized to
		// `{commands: ["<shell text>"]}`. The equivalent
		// `commands`-keyed string is accepted too. The full corrected
		// contract lives in `flint-toolcall-red01-correction01.test.ts`.
		const probe = await drive([
			proposalFromJson("bare-string", { command: "echo hello" }),
		]);

		expect(probe.executed).toHaveLength(1);
		expect(probe.executed[0]!.command).toBe("echo hello");
		expect(probe.approvals[0]!.input).toEqual({ commands: ["echo hello"] });
		expect(probe.captured[0]!.outcome.kind).toBe("success");
	});

	it("NEVER_EXECUTES_SERIALIZED_JSON_AS_SHELL_CODE", async () => {
		// The captured shape must NEVER reach the executor as serialized
		// JSON text. This is the anti-shell invariant.
		const probe = await drive([
			proposalFromJson("anti-shell", { command: '["echo hello"]' }),
		]);
		for (const entry of probe.executed) {
			expect(entry.command).not.toContain("[");
			expect(entry.command).not.toContain("]");
		}
	});
});
