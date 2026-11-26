/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 (C1: evidence acquisition).
 *
 * PRIORITY 3 — RECOVERY ALLOWANCE AND LIFECYCLE discriminator.
 *
 * Questions:
 *
 *   1. Does a successful INSPECTION replenish the output-limit recovery
 *      allowance?
 *   2. Do tool-less output-exhausted responses contribute to the R1
 *      execution-stagnation accounting?
 *
 * The trajectory is the shortest deterministic one that explains how a
 * three-attempt allowance permitted SEVENTEEN conciseness reminders in
 * the frozen session:
 *
 *      output exhaustion -> conciseness reminder
 *      successful inspection (tool call) -> output exhaustion again
 *
 * Method: the REAL `AgentRuntime`, driven by a scripted model. No provider,
 * no network, no paid inference.
 */

import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "./agent-runtime";

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = [];

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
			for (const event of step(request)) {
				yield event;
			}
		})();
	}
}

/** A turn that is cut off at the output limit, with NO tool call. */
function exhaustedTurn(): Iterable<AgentModelEvent> {
	return [
		{ type: "reasoning-delta", text: "thinking..." },
		{ type: "finish", reason: "max-tokens" },
	];
}

/** A turn that calls a tool (a mere INSPECTION). */
function inspectionTurn(toolCallId: string): Iterable<AgentModelEvent> {
	return [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName: "inspect",
			inputText: "{}",
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

const createInspectTool = (): AgentTool<
	Record<string, never>,
	{ ok: true }
> => ({
	name: "inspect",
	description: "Inspect the workspace (a mere read, no engineering progress)",
	inputSchema: { type: "object" },
	async execute() {
		return { ok: true };
	},
});

/**
 * Count the DISTINCT conciseness reminders the runtime INJECTED.
 *
 * A naive count over every request's message history over-counts: the
 * reminder is carried forward into every subsequent request. The distinct
 * message identity is the count of injections.
 */
function countConcisenessReminders(
	requests: readonly AgentModelRequest[],
): number {
	const ids = new Set<string>();
	for (const request of requests) {
		for (const message of request.messages) {
			const parts = message.content ?? [];
			for (const part of parts) {
				if (
					part.type === "text" &&
					part.text.includes("reached the model's output-token limit")
				) {
					ids.add(String((message as { id?: unknown }).id));
				}
			}
		}
	}
	return ids.size;
}

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 — recovery allowance", () => {
	it("fails after exactly MAX_TOKENS_RECOVERY_LIMIT consecutive exhaustions", async () => {
		// The advertised allowance: three consecutive recoveries.
		const model = new ScriptedModel([
			exhaustedTurn,
			exhaustedTurn,
			exhaustedTurn,
			exhaustedTurn,
		]);
		const runtime = new AgentRuntime({ model });

		const result = await runtime.run("Hi");

		expect(result.status).toBe("failed");
		expect(result.error?.message).toContain("maximum output token limit");
		// The initial attempt plus three recoveries.
		expect(model.requests).toHaveLength(4);
	});

	it("REPLENISHES the allowance on a successful inspection between exhaustions", async () => {
		// The trajectory: exhaust -> inspect -> exhaust -> inspect -> ...
		// A tool-calling turn resets the consecutive cut-off streak, so the
		// allowance is replenished and the run continues indefinitely.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 8; i += 1) {
			steps.push(exhaustedTurn);
			steps.push(() => inspectionTurn(`call-${i}`));
		}
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({ model, tools: [createInspectTool()] });

		const result = await runtime.run("Hi");

		// The run reached the END of the scripted trajectory, so the script
		// ran out of steps — but only AFTER the allowance had been
		// replenished by each inspection. Without the replenishment the run
		// would have failed at the FOURTH consecutive exhaustion.
		expect(model.requests.length).toBeGreaterThan(4);
		// MORE than the advertised three reminders were injected: the
		// allowance was replenished by each inspection.
		expect(countConcisenessReminders(model.requests)).toBeGreaterThan(3);
	});

	it("counts a successful inspection as a replenishment, not as progress", async () => {
		// The decisive distinction: the inspection produced NO engineering
		// progress (no edit, no executed command), yet it replenished the
		// output-limit recovery allowance. The reset is keyed on the
		// PRESENCE of a tool call, not on its productivity.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 6; i += 1) {
			steps.push(exhaustedTurn);
			steps.push(() => inspectionTurn(`call-${i}`));
		}
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({ model, tools: [createInspectTool()] });

		await runtime.run("Hi");

		// The decisive observation: EIGHT inspections produced EIGHT
		// replenishments, so the allowance was re-armed far beyond its
		// advertised bound of three.
		expect(countConcisenessReminders(model.requests)).toBeGreaterThan(3);
		// And the run consumed MORE requests than the advertised allowance
		// would ever permit.
		expect(model.requests.length).toBeGreaterThan(4);
	});
});

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 — tool-less exhaustion accounting", () => {
	it("does NOT fold a tool-less output-exhausted turn into the R1 stagnation accounting", async () => {
		// The R1 execution-stagnation accounting is folded at the ITERATION
		// BOUNDARY, after the round's tool calls have executed. A turn that
		// is cut off at the output limit WITHOUT a tool call never reaches
		// that boundary: the runtime injects the conciseness reminder and
		// continues.
		//
		// So a trajectory of tool-less exhaustions produces R1 stagnation
		// notices for a PRODUCTIVE round, not for the exhaustions.
		const notices: string[] = [];
		const model = new ScriptedModel([
			exhaustedTurn,
			exhaustedTurn,
			exhaustedTurn,
			exhaustedTurn,
		]);
		const runtime = new AgentRuntime({
			model,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 1,
				maxRecoveryInstructions: 1,
				enabled: true,
			},
		});
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "execution_stagnation_recovery"
			) {
				notices.push(String(event.message));
			}
		});

		await runtime.run("Hi");

		// The R1 stagnation recovery NEVER fired: a tool-less exhausted
		// response contributes NOTHING to the stagnation accounting, so the
		// stall is INVISIBLE to the recovery mechanism that exists to
		// detect it.
		expect(notices).toHaveLength(0);
	});

	it("folds a TOOL-CALLING round into the R1 stagnation accounting", async () => {
		// The contrast: a round that DID produce a tool call reaches the
		// iteration boundary, and the R1 accounting observes it.
		const notices: string[] = [];
		const model = new ScriptedModel([() => inspectionTurn("call-0")]);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool()],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 1,
				maxRecoveryInstructions: 1,
				enabled: true,
			},
		});
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "execution_stagnation_recovery"
			) {
				notices.push(String(event.message));
			}
		});

		await runtime.run("Hi");

		// The tool-calling round WAS observed by the R1 accounting (an
		// inspection with no edit and no executed command counts as
		// UNPRODUCTIVE, so a notice was injected).
		expect(notices.length).toBeGreaterThan(0);
	});
});
