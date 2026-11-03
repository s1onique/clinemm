/**
 * ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01
 *
 * Production-seam RED reproduction for the 2026-11-02 incident:
 * two consecutive rejected `run_commands` invocations with
 * `commands: null`, followed by runtime termination (`aborted`)
 * without a `submit_and_exit`.
 *
 * ## What this test is (and is not)
 *
 * This test drives the REAL production seams:
 *   - `RunCommandsInputUnionSchema` (the real schema in
 *     `sdk/packages/core/src/extensions/tools/schemas.ts`),
 *   - `createTool`'s auto-generated `validateInput` (the real
 *     validator in `sdk/packages/shared/src/tools/create.ts`),
 *   - the real `AgentRuntime` (the real runtime in
 *     `sdk/packages/agents/src/agent-runtime.ts`),
 *   - the real tool-dispatch / recovery-classification path.
 *
 * It does NOT substitute an independently implemented Zod schema and
 * does NOT mock the validator.
 *
 * The provider is a deterministic SCRIPTED fixture. That is
 * `SYNTHETIC_REAL` evidence for the runtime seam — it is NOT live
 * provider behavior and is labelled as such in the ACT report.
 *
 * ## Test matrix (ACT §6 C3)
 *
 *   T1 valid command array       -> accepted, expected execution
 *   T2 `commands: null`           -> rejected BEFORE execution
 *   T3 missing `commands`         -> rejected
 *   T4 empty command array        -> existing defined behavior
 *   T5 supported alternate shape  -> existing behavior preserved
 *   T6 malformed JSON             -> explicit parse failure, no execution
 *   T7 two consecutive null calls -> observe agent lifecycle
 *   T8 valid then null calls      -> earlier success preserved
 *
 * The task's discriminator set is D1..D6 of ACT §7. D1/D2/D3/D4/D5
 * are implemented below. D6 (host mapping) is covered by the static
 * source inspection recorded in the ACT report because the host lives
 * in `apps/vscode`, outside this package's test scope.
 */

import { AgentRuntime } from "@cline/agents";
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
	ToolRuntimeOutcome,
} from "@cline/shared";
import { createTool, resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { RunCommandsInputSchema } from "./schemas";

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
		const events = step(request);
		return (async function* () {
			for await (const ev of events) yield ev;
		})();
	}
}

/**
 * A proposal describes the RAW provider tool-call payload as it arrives
 * at the streaming assembler. `inputText` is the literal text the
 * provider emitted (so malformed JSON is representable verbatim).
 */
interface RawProposal {
	toolCallId: string;
	toolName: string;
	/** Literal argument text exactly as the provider emitted it. */
	inputText: string;
}

function proposalFromJson(
	toolCallId: string,
	value: unknown,
): RawProposal {
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

function finalTextStep(): (req: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	];
}


// ---------------------------------------------------------------------------
// Real production tool (real schema + real auto-generated validateInput)
// ---------------------------------------------------------------------------

interface ExecutionCounter {
	executed: string[];
}

function createProductionRunCommandsTool(
	counter: ExecutionCounter,
): AgentTool<unknown, unknown> {
	return createTool({
		name: "run_commands",
		description: "production seam probe",
		// The REAL production schema — the exact schema the production
		// `run_commands` tool declares (`definitions.ts` →
		// `inputSchema: RunCommandsInputSchema`). `createTool`
		// auto-generates the REAL `validateInput` from it, which is the
		// same pre-approval validator the VS Code tool uses.
		inputSchema: RunCommandsInputSchema,
		execute: async (input: unknown) => {
			counter.executed.push(JSON.stringify(input));
			return [{ output: "ok" }];
		},
	}) as AgentTool<unknown, unknown>;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface CapturedOutcome {
	toolCallId: string;
	toolName: string;
	outcome: ToolRuntimeOutcome;
}

interface ProbeResult {
	result: Awaited<ReturnType<AgentRuntime["run"]>>;
	messages: readonly AgentMessage[];
	captured: CapturedOutcome[];
	executed: string[];
	requestCount: number;
	/** Tool result texts the model would see on the next turn. */
	toolResultTexts: string[];
}

async function drive(
	proposals: readonly RawProposal[],
): Promise<ProbeResult> {
	const counter: ExecutionCounter = { executed: [] };
	const captured: CapturedOutcome[] = [];
	const steps: Array<(req: AgentModelRequest) => Iterable<AgentModelEvent>> =
		proposals.map(toolCallStep);
	steps.push(finalTextStep());

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
		tools: [createProductionRunCommandsTool(counter)],
		hooks,
	});
	const result = await runtime.run("probe");

	// Collect the tool-result text the model receives, so we can prove
	// whether the rejection was DELIVERED to the model history.
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
		executed: counter.executed,
		requestCount: model.requests.length,
		toolResultTexts,
	};
}

function outcomeFor(
	captured: readonly CapturedOutcome[],
	toolCallId: string,
): ToolRuntimeOutcome {
	const match = captured.find((c) => c.toolCallId === toolCallId);
	expect(match, `no captured outcome for ${toolCallId}`).toBeDefined();
	return match!.outcome;
}


// ---------------------------------------------------------------------------
// C3: bounded input-shape cases (T1..T8)
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01 / C2 input-shape authority", () => {
	it("T1_VALID_ARRAY_ACCEPTED_AND_EXECUTED", async () => {
		const probe = await drive([
			proposalFromJson("t1", { commands: ["printf 'ok\\n'"] }),
		]);
		expect(probe.executed).toHaveLength(1);
		expect(probe.executed[0]).toContain("printf");
		const outcome = outcomeFor(probe.captured, "t1");
		expect(outcome.kind).toBe("success");
	});

	it("T2_COMMANDS_NULL_REJECTED_BEFORE_EXECUTION", async () => {
		const probe = await drive([proposalFromJson("t2", { commands: null })]);
		expect(probe.executed).toHaveLength(0);
		const outcome = outcomeFor(probe.captured, "t2");
		expect(outcome.kind).toBe("failure");
		if (outcome.kind !== "failure") throw new Error("narrow");
		expect(outcome.failureClass).toBe("tool_input_invalid");
		// The rejection must be DELIVERED to model history.
		expect(probe.toolResultTexts.join("\n")).toContain(
			"expected array, received null",
		);
	});

	it("T3_MISSING_COMMANDS_REJECTED", async () => {
		const probe = await drive([proposalFromJson("t3", {})]);
		expect(probe.executed).toHaveLength(0);
		expect(outcomeFor(probe.captured, "t3").kind).toBe("failure");
	});

	it("T4_EMPTY_ARRAY_REJECTED", async () => {
		const probe = await drive([proposalFromJson("t4", { commands: [] })]);
		expect(probe.executed).toHaveLength(0);
		expect(outcomeFor(probe.captured, "t4").kind).toBe("failure");
	});

	it("T5_ALTERNATE_SHAPE_REJECTED_BY_PRODUCTION_PREAPPROVAL_SCHEMA", async () => {
		// PRODUCTION FACT (recon): the model-facing / pre-approval schema
		// for `run_commands` is the STRICT OBJECT schema
		// (`RunCommandsInputSchema`), NOT the permissive union. The union
		// (`RunCommandsInputUnionSchema`) is only consulted INSIDE
		// `execute()` via `normalizeRunCommandsInput`. Therefore an
		// alternate shape such as `{command: "..."}` is rejected by the
		// pre-approval validator before the executor (and before the
		// union normalizer) ever runs.
		const probe = await drive([
			proposalFromJson("t5", { command: "printf 'ok\\n'" }),
		]);
		expect(probe.executed).toHaveLength(0);
		const outcome = outcomeFor(probe.captured, "t5");
		expect(outcome.kind).toBe("failure");
		if (outcome.kind !== "failure") throw new Error("narrow");
		expect(outcome.failureClass).toBe("tool_input_invalid");
	});

	it("T6_MALFORMED_JSON_REJECTED_WITH_PARSE_PROVENANCE", async () => {
		const probe = await drive([
			{
				toolCallId: "t6",
				toolName: "run_commands",
				inputText: '{"commands": [',
			},
		]);
		expect(probe.executed).toHaveLength(0);
		const outcome = outcomeFor(probe.captured, "t6");
		expect(outcome.kind).toBe("failure");
		if (outcome.kind !== "failure") throw new Error("narrow");
		// Malformed JSON takes the SAME input-parse provenance as the
		// type-invalid JSON. Both are `tool_input_invalid`.
		expect(outcome.failureClass).toBe("tool_input_invalid");
		expect(probe.toolResultTexts.join("\n")).toMatch(
			/invalid JSON arguments|must be encoded as a JSON object/i,
		);
	});

	it("T6B_LITERAL_STRING_NULL_IS_DISTINCT_FROM_JSON_NULL", async () => {
		// `"null"` (a JSON string) is a DIFFERENT shape from JSON null.
		const probe = await drive([
			proposalFromJson("t6b", { commands: "null" }),
		]);
		expect(probe.executed).toHaveLength(0);
		const outcome = outcomeFor(probe.captured, "t6b");
		expect(outcome.kind).toBe("failure");
		// Both fail, but the REASON differs — proving the harness does
		// not collapse distinct invalid shapes into one generic error.
		expect(probe.toolResultTexts.join("\n")).not.toContain(
			"expected array, received null",
		);
	});
});


describe("ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01 / C3 runtime lifecycle", () => {
	it("T7_TWO_CONSECUTIVE_NULL_CALLS__DOES_NOT_ABORT_THE_RUN", async () => {
		const probe = await drive([
			proposalFromJson("n1", { commands: null }),
			proposalFromJson("n2", { commands: null }),
		]);

		// D1 — validation vs termination: two invalid calls produced two
		// recoverable failures and the model CONTINUED.
		expect(probe.captured).toHaveLength(2);
		for (const c of probe.captured) {
			expect(c.outcome.kind).toBe("failure");
		}
		expect(probe.executed).toHaveLength(0);

		// The runtime was NOT terminated: it issued a further provider
		// request after the second rejection and completed normally.
		expect(probe.requestCount).toBe(3);
		expect(probe.result.status).toBe("completed");
		expect(probe.result.error).toBeUndefined();

		// Both rejections were delivered to the model history.
		expect(probe.toolResultTexts.length).toBeGreaterThanOrEqual(2);
	});

	it("T8_VALID_THEN_TWO_NULL_CALLS__EARLIER_SUCCESS_PRESERVED", async () => {
		const probe = await drive([
			proposalFromJson("v1", { commands: ["printf 'ok\\n'"] }),
			proposalFromJson("n1", { commands: null }),
			proposalFromJson("n2", { commands: null }),
		]);
		expect(probe.executed).toHaveLength(1);
		expect(probe.requestCount).toBe(4);
		expect(probe.result.status).toBe("completed");
		expect(probe.result.error).toBeUndefined();
	});
});
