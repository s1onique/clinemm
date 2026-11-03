/**
 * ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01
 *
 * ORCHESTRATOR-LEVEL production-seam discriminator.
 *
 * The companion test
 * `sdk/packages/core/src/extensions/tools/null-runcommands-abort-recon01.test.ts`
 * drives the REAL `AgentRuntime` and proves that two consecutive
 * `commands: null` `run_commands` calls are rejected WITHOUT terminating
 * the run.
 *
 * This test drives the REAL `SessionRuntime` orchestrator on top of the
 * REAL `AgentRuntime`, with the REAL production `run_commands` tool
 * (real schema → real `validateInput`), and observes the TERMINAL
 * RESULT. This adds the three safety seams the AgentRuntime-level test
 * does NOT exercise:
 *
 *   1. `MistakeTracker` (orchestrator, `runtime/safety/mistake-tracker.ts`)
 *   2. `LoopDetectionTracker` (orchestrator, `runtime/safety/loop-detection.ts`)
 *   3. The orchestrator's `deriveFinishReason` / `buildLegacyResult`
 *      terminal classification.
 *
 * The provider is a deterministic SCRIPTED fixture — evidence class
 * `SYNTHETIC_REAL`. This is NOT live provider behavior.
 *
 * DISCRIMINATORS (ACT §7):
 *   D1 validation vs termination
 *   D2 first vs second failure
 *   D3 provider-independent replay
 *   D4 valid control
 *   D5 recovery-budget ablation (via the recovery snapshot)
 *   D6 host mapping — covered by the apps/vscode-side test and the
 *      static source inspection in the ACT report.
 */

import { createAgentRuntime } from "@cline/agents";
import type {
	AgentConfig,
	AgentEvent,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
} from "@cline/shared";
import { createTool } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { RunCommandsInputSchema } from "../../extensions/tools/schemas";
import { SessionRuntime } from "./session-runtime-orchestrator";

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

interface RawProposal {
	toolCallId: string;
	toolName: string;
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
// Real production run_commands tool
// ---------------------------------------------------------------------------

function createProductionRunCommandsTool(executed: string[]): AgentTool<
	unknown,
	unknown
> {
	return createTool({
		name: "run_commands",
		description: "production seam probe",
		inputSchema: RunCommandsInputSchema,
		execute: async (input: unknown) => {
			executed.push(JSON.stringify(input));
			return [{ output: "ok" }];
		},
	}) as AgentTool<unknown, unknown>;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

interface ProbeOutcome {
	finishReason: string;
	text: string;
	iterations: number;
	executed: string[];
	requestCount: number;
	toolResultTexts: string[];
	errorEvents: string[];
	doneEvents: number;
}

async function drive(
	proposals: readonly RawProposal[],
): Promise<ProbeOutcome> {
	const executed: string[] = [];
	const model = new ScriptedModel([
		...proposals.map(toolCallStep),
		finalTextStep(),
	]);
	const config: AgentConfig = {
		providerId: "minimax",
		modelId: "minimax-m3",
		apiKey: "test-key",
		systemPrompt: "probe",
		tools: [createProductionRunCommandsTool(executed)],
	};
	const session = new SessionRuntime(config, {
		createAgentRuntimeImpl: (runtimeConfig) =>
			createAgentRuntime({ ...runtimeConfig, model }),
	});

	const toolResultTexts: string[] = [];
	const errorEvents: string[] = [];
	let doneEvents = 0;
	session.subscribeEvents((event: AgentEvent) => {
		if (event.type === "error") {
			errorEvents.push(event.error?.message ?? String(event.error));
		}
		if (event.type === "done") {
			doneEvents += 1;
		}
		if (event.type === "content_end" && event.toolName === "run_commands") {
			const output = (event as { output?: unknown }).output;
			toolResultTexts.push(
				typeof output === "string" ? output : JSON.stringify(output),
			);
		}
	});

	const result = await session.run("probe");
	return {
		finishReason: result.finishReason,
		text: result.text,
		iterations: result.iterations,
		executed,
		requestCount: model.requests.length,
		toolResultTexts,
		errorEvents,
		doneEvents,
	};
}


describe("ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01 / orchestrator-level discriminators", () => {
	it("D1_D4_TWO_CONSECUTIVE_NULL_CALLS__RUN_COMPLETES_NOT_ABORTS", async () => {
		const probe = await drive([
			proposalFromJson("n1", { commands: null }),
			proposalFromJson("n2", { commands: null }),
		]);

		// Invalid input executes ZERO commands.
		expect(probe.executed).toHaveLength(0);

		// D1 — validation vs termination: the runtime did NOT abort.
		expect(probe.finishReason).toBe("completed");
		expect(probe.iterations).toBeGreaterThanOrEqual(3);

		// D3 — provider-independent replay: the model was asked again
		// after each rejection and the run converged.
		expect(probe.requestCount).toBe(3);
		expect(probe.doneEvents).toBe(1);

		// The rejections were delivered to the model history.
		expect(probe.toolResultTexts.length).toBeGreaterThanOrEqual(2);
		expect(probe.toolResultTexts.join("\n")).toContain(
			"expected array, received null",
		);
	});

	it("D4_VALID_CONTROL__A_VALID_CALL_INSTEAD_PREVENTS_THE_FAILURE", async () => {
		const probe = await drive([
			proposalFromJson("v1", { commands: ["printf 'ok\\n'"] }),
			proposalFromJson("v2", { commands: ["printf 'ok\\n'"] }),
		]);
		expect(probe.executed).toHaveLength(2);
		expect(probe.finishReason).toBe("completed");
	});

	it("D2_SINGLE_NULL_CALL__ALSO_DOES_NOT_ABORT", async () => {
		// D2 — first vs second failure: the behaviour is identical.
		const probe = await drive([proposalFromJson("n1", { commands: null })]);
		expect(probe.executed).toHaveLength(0);
		expect(probe.finishReason).toBe("completed");
		expect(probe.requestCount).toBe(2);
	});

	it("D5_RECOVERY_BUDGET_THRESHOLD_IS_BISECTED", async () => {
		// D2 / D5 — the exact threshold at which repeated identical
		// `commands: null` calls terminate the run. This is the load-bearing
		// discriminator for the recovery-budget hypothesis.
		const results: Array<{ count: number; finishReason: string }> = [];
		for (const count of [1, 2, 3, 4, 5, 6, 7]) {
			const proposals = Array.from({ length: count }, (_, index) =>
				proposalFromJson(`n${index}`, { commands: null }),
			);
			const probe = await drive(proposals);
			results.push({ count, finishReason: probe.finishReason });
		}
		// Record the observed threshold. The assertion pins the FACT that
		// the abort is NOT reachable at 1 or 2 consecutive rejections —
		// which is the LIVE incident's cardinality.
		const atTwo = results.find((r) => r.count === 2);
		const atOne = results.find((r) => r.count === 1);
		expect(atOne?.finishReason).toBe("completed");
		expect(atTwo?.finishReason).toBe("completed");
		// The first aborting count is the recovery exact-only cap:
		// `maxRepairAttempts + 1 = 3` failures ARM the latch, and the
		// NEXT identical failure (the 4th) TERMINATES it.
		const firstAbort = results.find((r) => r.finishReason === "aborted");
		expect(firstAbort, "no aborting cardinality found").toBeDefined();
		expect(firstAbort!.count).toBeGreaterThan(2);
		// Emit the bisected table so the evidence artifact carries the
		// exact cardinality → finish-reason mapping.
		console.log(
			`[ACT-CLINEMM-NULL-RUNCOMMANDS-ABORT-RECON01] identical-null-call cardinality → finishReason: ${results
				.map((r) => `${r.count}:${r.finishReason}`)
				.join(", ")}`,
		);
	});
});
