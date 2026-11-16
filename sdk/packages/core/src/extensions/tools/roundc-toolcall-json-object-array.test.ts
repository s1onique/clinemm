/**
 * ACT-CLINEMM-ROUND-C-HARNESS-03 — the JSON-ENCODED array-of-objects shape.
 *
 * ## The defect
 *
 * A live `run_commands` call arrived as:
 *
 *   { "commands": "[{\"command\":\"git status\"},{\"command\":\"git log -5\"}]" }
 *
 * i.e. `commands` is a STRING whose contents are a JSON array of
 * `{command: string}` OBJECTS. The strict `RunCommandsInputSchema` requires
 * `commands` to be an ARRAY, so the payload was rejected with
 * `expected array, received string`.
 *
 * The pre-existing normalizer already decoded a JSON-encoded array of
 * STRINGS (`{"commands": "[\"git status\"]"}`) and already canonicalized a
 * LIST of objects (`{"commands": [{"command": "git status"}]}`), but the two
 * shapes COMBINED — a JSON-encoded array of objects — fell through both
 * branches and was rejected.
 *
 * ## The bounded fix
 *
 * The fix lives in the NORMALIZATION boundary (`normalizeRunCommandsToolInput`),
 * NOT in `RunCommandsInputSchema`. The model-facing schema is unchanged: it
 * still advertises `commands` as an array of strings, and the strict runtime
 * validation is unchanged. The canonicalizer decodes the serialized array and
 * then applies the EXISTING `canonicalizeObjectCommandEntries` contract, so
 * the decoded list is validated against the canonical `commands` element
 * schema BEFORE it is returned.
 *
 * ## What is asserted here
 *
 *  - the decoded object-array shape canonicalizes to the same command list the
 *    object-list shape produces, with every command preserved, IN ORDER;
 *  - the serialized JSON text is NEVER forwarded as a command;
 *  - adversarial inputs FAIL CLOSED (unchanged → strict schema rejection):
 *    empty arrays, mixed arrays, extra keys, malformed JSON, and structured
 *    `args` entries (whose argv rendering differs from the shell rendering);
 *  - the real runtime seam (normalize → validate → approve → execute) agrees:
 *    the approved input and the executed commands are identical, and an
 *    ambiguous payload never reaches approval or the executor — including
 *    when the runtime policy's automatic bypass is enabled;
 *  - the runtime's approval CONTRACT is exercised on both sides: with the
 *    policy's `autoApprove` flag set, the approval hook is skipped entirely;
 *    with it cleared, the hook is consulted and its decision decides whether
 *    the commands execute.
 *
 * ## Safety
 *
 * NO command is ever executed. The tool is built with a RECORDING executor
 * that captures the canonicalized command list and returns a canned result.
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
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createShellTool } from "./definitions";
import {
	normalizeRunCommandsInput,
	normalizeRunCommandsToolInput,
} from "./helpers";
import { RunCommandsInputSchema } from "./schemas";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

/**
 * The captured shape: a JSON-encoded array of `{command}` objects carried in
 * the `commands` STRING.
 *
 * The member type is deliberately `unknown` so the ADVERSARIAL members (a
 * bare string, a `null`) can be encoded too — those are exactly the shapes
 * that must fail closed.
 */
function encodedObjectArray(members: ReadonlyArray<unknown>): {
	commands: string;
} {
	return { commands: JSON.stringify(members) };
}

describe("ACT-CLINEMM-ROUND-C-HARNESS-03 — JSON-encoded array of command objects", () => {
	describe("GREEN — the captured shape canonicalizes", () => {
		it("decodes the JSON-encoded object array into the canonical command list", () => {
			const payload = encodedObjectArray([
				{ command: "git status" },
				{ command: "git log -5" },
			]);
			expect(normalizeRunCommandsToolInput(payload)).toEqual({
				commands: ["git status", "git log -5"],
			});
		});

		it("produces the SAME canonical form as the object-list shape", () => {
			const members = [{ command: "git status" }, { command: "git log -5" }];
			const fromList = normalizeRunCommandsToolInput({ commands: members });
			const fromString = normalizeRunCommandsToolInput(
				encodedObjectArray(members),
			);
			expect(fromString).toEqual(fromList);
		});

		it("satisfies the strict canonical schema", () => {
			const normalized = normalizeRunCommandsToolInput(
				encodedObjectArray([{ command: "git status" }]),
			);
			expect(RunCommandsInputSchema.safeParse(normalized).success).toBe(true);
		});

		it("preserves every command, in order, with nothing dropped", () => {
			const members = [
				{ command: "first" },
				{ command: "second" },
				{ command: "third" },
			];
			const normalized = normalizeRunCommandsToolInput(
				encodedObjectArray(members),
			) as { commands: string[] };
			expect(normalized.commands).toHaveLength(members.length);
			expect(normalized.commands).toEqual(
				members.map((entry) => entry.command),
			);
		});

		it("never forwards the serialized JSON text as a command", () => {
			const normalized = normalizeRunCommandsToolInput(
				encodedObjectArray([{ command: "git status" }]),
			) as { commands: string[] };
			for (const command of normalized.commands) {
				expect(command.startsWith("[")).toBe(false);
				expect(command.startsWith("{")).toBe(false);
				expect(command.endsWith("]")).toBe(false);
			}
		});

		it("accepts a single-member encoded object array", () => {
			expect(
				normalizeRunCommandsToolInput(encodedObjectArray([{ command: "pwd" }])),
			).toEqual({ commands: ["pwd"] });
		});

		it("collects the canonical commands through the runtime normalizer", () => {
			const normalized = normalizeRunCommandsToolInput(
				encodedObjectArray([
					{ command: "git status" },
					{ command: "git log -5" },
				]),
			);
			expect(normalizeRunCommandsInput(normalized)).toEqual([
				"git status",
				"git log -5",
			]);
		});
	});

	describe("fail-closed — ambiguous conversions are rejected unchanged", () => {
		it("leaves an empty encoded array unchanged", () => {
			const payload = encodedObjectArray([]);
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});

		it("leaves a mixed encoded array unchanged", () => {
			const payload = encodedObjectArray([
				{ command: "git status" },
				"git log -5",
			]);
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});

		it("leaves an encoded array whose member carries `args` unchanged", () => {
			// `args` changes the rendering (argv form vs shell form), so the
			// conversion would not be identity-preserving.
			const payload = encodedObjectArray([
				{ command: "git", args: ["status"] },
			]);
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});

		it("leaves an encoded array whose member carries an extra key unchanged", () => {
			const payload = encodedObjectArray([{ command: "ls", cwd: "/tmp" }]);
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});

		it("leaves an encoded array with an empty command unchanged", () => {
			const payload = encodedObjectArray([{ command: "   " }]);
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});

		it("leaves an encoded array with a non-string command unchanged", () => {
			const payload = encodedObjectArray([{ command: 42 }]);
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});

		it("leaves an encoded array whose member is not an object unchanged", () => {
			const payload = encodedObjectArray([null]);
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});

		it("leaves malformed JSON unchanged", () => {
			const payload = { commands: '[{"command": "git status"' };
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});

		it("leaves a JSON OBJECT (not an array) unchanged", () => {
			const payload = { commands: '{"command":"git status"}' };
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});

		it("leaves a payload with an unexpected top-level sibling unchanged", () => {
			const payload = {
				commands: JSON.stringify([{ command: "git status" }]),
				timeout: 30,
			};
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});

		it("does not canonicalize the encoded object array under the `command` key", () => {
			// The `command` key's value is a single command; a serialized
			// object array under it is ambiguous and must not be decoded.
			const payload = {
				command: JSON.stringify([{ command: "git status" }]),
			};
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});
	});

	describe("no collateral change to the previously supported shapes", () => {
		it("still canonicalizes a JSON-encoded array of strings", () => {
			expect(normalizeRunCommandsToolInput({ commands: '["a","b"]' })).toEqual({
				commands: ["a", "b"],
			});
		});

		it("still canonicalizes an object LIST", () => {
			expect(
				normalizeRunCommandsToolInput({
					commands: [{ command: "ls" }, { command: "pwd" }],
				}),
			).toEqual({ commands: ["ls", "pwd"] });
		});

		it("still canonicalizes the plain-string shapes", () => {
			expect(normalizeRunCommandsToolInput({ commands: "ls -la" })).toEqual({
				commands: ["ls -la"],
			});
			expect(normalizeRunCommandsToolInput({ command: "ls -la" })).toEqual({
				commands: ["ls -la"],
			});
		});

		it("leaves a canonical command list untouched", () => {
			const payload = { commands: ["ls", "pwd"] };
			expect(normalizeRunCommandsToolInput(payload)).toEqual(payload);
		});
	});
});

/**
 * The REAL runtime seam: normalize → validate → approve → execute.
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

interface ExecutedCommand {
	command: string | { command: string; args?: string[] };
}

interface ApprovalProbe {
	input: unknown;
	approved: boolean;
}

/**
 * Drives the REAL runtime seam with a scripted model and a recording
 * executor.
 *
 * `options.policyAutoApprove` sets the RUNTIME POLICY's `autoApprove` flag —
 * the switch that decides whether the approval hook is consulted at all.
 * `options.approvalDecision` sets what the approval hook RETURNS once it is
 * consulted.
 *
 * These are deliberately SEPARATE knobs, because they are separate in the
 * runtime (`agent-runtime.ts`): the policy branch `policy.autoApprove === false`
 * is what CALLS `requestToolApproval`, and a policy with `autoApprove` unset or
 * `true` SKIPS the approval round-trip entirely. Conflating the two would make
 * an "auto-approved" case silently exercise the approval path instead.
 */
async function drive(
	payload: unknown,
	options: {
		policyAutoApprove?: boolean;
		approvalDecision?: boolean;
	} = {},
): Promise<{
	executed: ExecutedCommand[];
	approvals: ApprovalProbe[];
	toolResultTexts: string[];
}> {
	const executed: ExecutedCommand[] = [];
	const approvals: ApprovalProbe[] = [];
	const policyAutoApprove = options.policyAutoApprove ?? false;
	const approvalDecision = options.approvalDecision ?? true;

	const tool = createShellTool(
		async (command, _cwd, _context: AgentToolContext) => {
			executed.push({ command });
			return "ok";
		},
		{ cwd: process.cwd() },
	) as AgentTool<unknown, unknown>;

	const model = new ScriptedModel([
		() => [
			{
				type: "tool-call-delta",
				toolCallId: "h03",
				toolName: "run_commands",
				inputText: JSON.stringify(payload),
			},
			{ type: "finish", reason: "tool-calls" },
		],
		() => [
			{ type: "text-delta", text: "done" },
			{ type: "finish", reason: "stop" },
		],
	]);

	const hooks: AgentRuntimeHooks = {};
	const runtime = new AgentRuntime({
		model,
		tools: [tool],
		hooks,
		toolPolicies: {
			run_commands: { enabled: true, autoApprove: policyAutoApprove },
		},
		requestToolApproval: async (request) => {
			approvals.push({
				input: request.input,
				approved: approvalDecision,
			});
			return { approved: approvalDecision };
		},
	});
	const result = await runtime.run("probe");

	const toolResultTexts: string[] = [];
	for (const message of result.messages as readonly AgentMessage[]) {
		for (const part of message.content) {
			if (part.type !== "tool-result") continue;
			toolResultTexts.push(
				typeof part.output === "string"
					? part.output
					: JSON.stringify(part.output),
			);
		}
	}

	return { executed, approvals, toolResultTexts };
}

describe("ACT-CLINEMM-ROUND-C-HARNESS-03 — the real runtime seam", () => {
	it("approves and executes exactly the decoded commands", async () => {
		const probe = await drive(
			encodedObjectArray([
				{ command: "git status" },
				{ command: "git log -5" },
			]),
		);

		expect(probe.executed.map((entry) => entry.command)).toEqual([
			"git status",
			"git log -5",
		]);
		expect(probe.approvals).toHaveLength(1);
		expect(probe.approvals[0]!.input).toEqual({
			commands: ["git status", "git log -5"],
		});
		expect(probe.toolResultTexts.join("\n")).not.toContain(
			"Invalid input for tool",
		);
	});

	it("executes the same commands with the automatic policy bypass", async () => {
		// The POLICY's `autoApprove` flag is what skips the approval
		// round-trip entirely (`policy.autoApprove === false` is the branch
		// that CALLS the approval hook). The approval hook here would
		// REJECT, so the commands can only execute if the automatic bypass
		// really happened.
		const probe = await drive(encodedObjectArray([{ command: "git status" }]), {
			policyAutoApprove: true,
			approvalDecision: false,
		});
		expect(probe.approvals).toHaveLength(0);
		expect(probe.executed.map((entry) => entry.command)).toEqual([
			"git status",
		]);
		expect(probe.toolResultTexts.join("\n")).not.toContain(
			"Invalid input for tool",
		);
	});

	it("consults the approval hook when the policy requires approval", async () => {
		// The counterpart of the automatic bypass: with `autoApprove` false
		// the approval hook IS consulted, and its decision decides whether
		// the commands execute.
		const probe = await drive(encodedObjectArray([{ command: "git status" }]), {
			policyAutoApprove: false,
			approvalDecision: true,
		});
		expect(probe.approvals).toHaveLength(1);
		expect(probe.approvals[0]!.input).toEqual({ commands: ["git status"] });
		expect(probe.executed.map((entry) => entry.command)).toEqual([
			"git status",
		]);
	});

	it("does not execute when the approval hook rejects", async () => {
		const probe = await drive(encodedObjectArray([{ command: "git status" }]), {
			policyAutoApprove: false,
			approvalDecision: false,
		});
		expect(probe.approvals).toHaveLength(1);
		expect(probe.executed).toHaveLength(0);
	});

	it("never reaches approval or the executor for an ambiguous payload", async () => {
		const probe = await drive(
			encodedObjectArray([{ command: "git", args: ["status"] }]),
			{ policyAutoApprove: true, approvalDecision: false },
		);
		expect(probe.executed).toHaveLength(0);
		expect(probe.approvals).toHaveLength(0);
		expect(probe.toolResultTexts.join("\n")).toContain(
			"Invalid input for tool run_commands",
		);
	});

	it("never reaches approval or the executor for a mixed payload", async () => {
		const probe = await drive(
			encodedObjectArray([{ command: "git status" }, "git log -5"]),
			{ policyAutoApprove: true, approvalDecision: false },
		);
		expect(probe.executed).toHaveLength(0);
		expect(probe.approvals).toHaveLength(0);
		expect(probe.toolResultTexts.join("\n")).toContain(
			"Invalid input for tool run_commands",
		);
	});
});
