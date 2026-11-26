/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 (C1: evidence acquisition).
 *
 * PRIORITY 3 — RECOVERY ALLOWANCE AND LIFECYCLE discriminator.
 *
 * ===================================================================
 * HISTORICAL WITNESS — SUPERSEDED BY THE SUCCESSOR CONTRACT.
 * ===================================================================
 *
 * This suite is the ORIGINAL forensic receipt for the output-exhaustion
 * recovery defects. Its assertions described the DEFECTIVE behaviour of the
 * predecessor at commit `a47349f816317a6b47c65ae92e79c64f85518fe8`:
 *
 *   - the ordinary recovery allowance was REPLENISHED by a read-only
 *     inspection (11 reminders injected into ONE run against a nominal
 *     allowance of 3), and
 *   - a tool-less output-exhausted response contributed NOTHING to the R1
 *     execution-stagnation accounting.
 *
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01 closed
 * both defects. The defect-asserting arms below were therefore INVERTED to
 * the successor contract, with the historical expectation quoted verbatim in
 * each comment so the receipt stays auditable.
 *
 * The RED receipt for the successor contract lives in
 * `agent-runtime.output-exhaustion-recovery-lifecycle01.test.ts`, and the
 * comprehensive qualification lives there too.
 *
 * Questions (historical):
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

	it("does NOT replenish the allowance on a successful inspection between exhaustions", async () => {
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
		//
		// HISTORICAL WITNESS, INVERTED.
		//
		// The predecessor asserted the DEFECT: "REPLENISHES the allowance on
		// a successful inspection between exhaustions", with
		// `expect(countConcisenessReminders(...)).toBeGreaterThan(3)` and
		// `expect(model.requests.length).toBeGreaterThan(4)`.
		//
		// The successor contract is the OPPOSITE: the ordinary recovery
		// allowance is a CONSUMABLE RUN-SCOPED resource. A read-only
		// inspection does not re-arm it, so the run injects AT MOST the
		// advertised three reminders however many inspections occur.
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

		await runtime.run("Hi");

		// AT MOST the advertised three reminders were injected.
		expect(countConcisenessReminders(model.requests)).toBeLessThanOrEqual(3);
	});

	it("counts a successful inspection as NOT a replenishment, not as progress", async () => {
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
		//
		// HISTORICAL WITNESS, INVERTED.
		//
		// The predecessor's decisive observation was that EIGHT inspections
		// produced EIGHT replenishments. The successor contract: the
		// allowance is run-scoped, so the inspections do not re-arm it and
		// the reminder count stays within the advertised bound.
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

		// The allowance was NOT re-armed by the inspections.
		expect(countConcisenessReminders(model.requests)).toBeLessThanOrEqual(3);
	});
});

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 — tool-less exhaustion accounting", () => {
	it("folds a tool-less output-exhausted turn into the R1 stagnation accounting", async () => {
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
		//
		// HISTORICAL WITNESS, INVERTED.
		//
		// The predecessor asserted the DEFECT: "does NOT fold a tool-less
		// output-exhausted turn into the R1 stagnation accounting", with
		// `expect(notices).toHaveLength(0)`.
		//
		// The successor contract: the tool-less exhausted round reaches the
		// EXISTING execution-stagnation authority, so the stall the R1
		// mechanism exists to detect is no longer INVISIBLE to it.
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

		// The R1 stagnation recovery FIRED: the tool-less exhausted response
		// is now accounted by the existing stagnation authority.
		expect(notices.length).toBeGreaterThan(0);
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
