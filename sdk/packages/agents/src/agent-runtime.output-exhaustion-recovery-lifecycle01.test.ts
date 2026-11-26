/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01
 *
 * RED receipt + GREEN qualification for the bounded autonomous recovery
 * lifecycle of output-exhausted agent execution.
 *
 * THE FOUR LOAD-BEARING DEFECTS THIS SUITE PINS
 * ----------------------------------------------
 *
 *   D1. ORDINARY RECOVERY ALLOWANCE REPLENISHMENT.
 *       `maxTokensRecoveryCount` is reset by the PRESENCE of a tool call
 *       (`if (toolCalls.length > 0) this.maxTokensRecoveryCount = 0;`), not by
 *       the PRODUCTIVITY of that round. A read-only inspection therefore
 *       re-arms the ordinary conciseness-reminder allowance, so the run can
 *       inject an unbounded number of reminders.
 *
 *   D2. TOOL-LESS EXHAUSTION IS INVISIBLE TO R1.
 *       The `finishReason === "max-tokens" && toolCalls.length === 0` branch
 *       `continue`s the loop BEFORE the iteration boundary that folds the
 *       round into the execution-stagnation accounting. A tool-less exhausted
 *       response therefore contributes NOTHING to R1 — and R2 is reachable
 *       ONLY through R1's `allowance_exhausted` branch.
 *
 *   D3. PREMATURE TERMINATION.
 *       The ordinary allowance (3) is exhausted BEFORE the ordinary R1
 *       threshold (5) can be reached, so the run FAILS on the fourth
 *       consecutive exhaustion and R1/R2 never get a chance to intervene.
 *
 *   D4. RECOVERY-ONLY GENERATION OVERRIDE.
 *       There is no request-local, one-shot output-budget override attached
 *       to the authorized recovery request.
 *
 * METHOD
 * ------
 * The REAL `AgentRuntime`, a scripted model, no provider, no network, no paid
 * inference. The inspections pass through the REAL host classification
 * authority (`executionStagnationPolicy.classifyToolCall`), never through a
 * test-local assumption.
 */

import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
	ExecutionRoundProductivity,
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

/** A turn cut off at the output limit, with NO tool call. */
function exhaustedTurn(): Iterable<AgentModelEvent> {
	return [
		{ type: "reasoning-delta", text: "thinking..." },
		{ type: "finish", reason: "max-tokens" },
	];
}

/** A turn that calls a tool. */
function toolTurn(
	toolCallId: string,
	toolName = "inspect",
): Iterable<AgentModelEvent> {
	return [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
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
 * The REAL host classification authority: a read-only inspection is
 * `inspected`, which is NOT productive progress.
 */
const hostClassifyInspection = (
	toolName: string,
): ExecutionRoundProductivity | undefined => {
	if (toolName === "inspect") {
		return "inspected";
	}
	return undefined;
};

/**
 * Count the DISTINCT conciseness reminders the runtime INJECTED.
 *
 * The reminder is carried forward into every subsequent request, so the
 * DISTINCT message identity is the count of injections.
 */
function countConcisenessReminders(
	requests: readonly AgentModelRequest[],
): number {
	const ids = new Set<string>();
	for (const request of requests) {
		for (const message of request.messages) {
			for (const part of message.content ?? []) {
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

/** Collect the R1 stagnation notices the runtime emits. */
function collectStagnationNotices(runtime: AgentRuntime): string[] {
	const notices: string[] = [];
	runtime.subscribe((event) => {
		if (
			event.type === "status-notice" &&
			event.metadata?.kind === "execution_stagnation_recovery"
		) {
			notices.push(String(event.message));
		}
	});
	return notices;
}

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — D1 allowance replenishment", () => {
	it("does NOT replenish the ordinary recovery allowance on a read-only inspection", async () => {
		// Trajectory: exhaust -> inspect -> exhaust -> inspect -> ...
		// The inspections pass through the REAL host classifier and are
		// classified `inspected` — NOT productive progress.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 8; i += 1) {
			steps.push(exhaustedTurn);
			steps.push(() => toolTurn(`call-${i}`));
		}
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool()],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: hostClassifyInspection,
			},
		});

		await runtime.run("Hi");

		// The ordinary allowance is FINITE and RUN-SCOPED: it cannot be
		// re-armed by a read-only inspection.
		expect(countConcisenessReminders(model.requests)).toBeLessThanOrEqual(3);
	});

	it("preserves the run-scoped allowance across a PRODUCTIVE round", async () => {
		// A genuinely productive native edit may reset the CONSECUTIVE
		// stagnation/exhaustion streak, but it must NOT replenish the
		// consumed run-scoped ordinary recovery allowance.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 4; i += 1) {
			steps.push(exhaustedTurn);
			steps.push(() => toolTurn(`call-${i}`, "edit"));
		}
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		steps.push(exhaustedTurn);
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [
				createInspectTool(),
				{
					name: "edit",
					description: "A productive native edit",
					inputSchema: { type: "object" },
					async execute() {
						return { ok: true };
					},
				} as AgentTool<Record<string, never>, { ok: true }>,
			],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: (toolName) =>
					toolName === "edit" ? "edited" : "inspected",
			},
		});

		await runtime.run("Hi");

		// The allowance was consumed BEFORE the productive round and is NOT
		// replenished by it.
		expect(countConcisenessReminders(model.requests)).toBeLessThanOrEqual(3);
	});
});

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — D2 tool-less exhaustion accounting", () => {
	it("accounts a tool-less exhausted response as ONE logical stagnation round", async () => {
		const runtime = new AgentRuntime({
			model: new ScriptedModel([
				exhaustedTurn,
				exhaustedTurn,
				exhaustedTurn,
				exhaustedTurn,
			]),
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 1,
				maxRecoveryInstructions: 1,
				enabled: true,
			},
		});
		const notices = collectStagnationNotices(runtime);

		await runtime.run("Hi");

		// The tool-less exhausted round now REACHES the existing stagnation
		// authority.
		expect(notices.length).toBeGreaterThan(0);
	});

	it("accounts AT MOST ONE logical round per exhausted response", async () => {
		// Multiple stream events belong to ONE logical round. FOUR logical
		// rounds must not reach a threshold of 5, however many stream
		// events each response carried.
		const runtime = new AgentRuntime({
			model: new ScriptedModel([
				() => [
					{ type: "reasoning-delta", text: "a" },
					{ type: "reasoning-delta", text: "b" },
					{ type: "reasoning-delta", text: "c" },
					{ type: "finish", reason: "max-tokens" },
				],
				exhaustedTurn,
				exhaustedTurn,
				exhaustedTurn,
			]),
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		const notices = collectStagnationNotices(runtime);

		await runtime.run("Hi");

		// FOUR logical rounds were observed, so the 5-round threshold must
		// NOT have fired — even though the first response carried three
		// separate stream events.
		expect(notices).toHaveLength(0);
	});
});

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — D3 premature termination", () => {
	it("reaches the existing R1 intervention instead of terminating first", async () => {
		// The ordinary allowance (3) is exhausted before the ordinary R1
		// threshold (5). The run must NOT fail on the fourth consecutive
		// exhaustion: it must reach the R1 intervention.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 12; i += 1) {
			steps.push(exhaustedTurn);
		}
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		const notices = collectStagnationNotices(runtime);

		const result = await runtime.run("Hi");

		// The R1 intervention happened.
		expect(notices.length).toBeGreaterThan(0);
		// The run did NOT terminate before the R1 intervention was reached.
		expect(result.iterations).toBeGreaterThan(4);
	});
	describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — D4 recovery-only output override", () => {
		const OVERRIDE_TOKENS = 16_384;

		function makeRuntime(options: {
			steps: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent>>;
			overrideEnabled?: boolean;
			modelOptions?: Record<string, unknown>;
		}): { runtime: AgentRuntime; model: ScriptedModel } {
			const model = new ScriptedModel(options.steps);
			const runtime = new AgentRuntime({
				model,
				modelOptions: options.modelOptions,
				executionStagnationPolicy: {
					unproductiveRoundThreshold: 2,
					maxRecoveryInstructions: 2,
					enabled: true,
				},
				recoveryOutputOverridePolicy: {
					enabled: options.overrideEnabled !== false,
					recoveryMaxOutputTokens: OVERRIDE_TOKENS,
					modelId: "MiniMax-M3.1-Flash",
					reasoningEffort: "low",
				},
				messageModelInfo: {
					id: "MiniMax-M3.1-Flash",
					provider: "minimax",
				} as never,
			});
			return { runtime, model };
		}

		it("attaches the override to the R1 recovery request only", async () => {
			const steps: Array<
				(request: AgentModelRequest) => Iterable<AgentModelEvent>
			> = [];
			for (let i = 0; i < 8; i += 1) {
				steps.push(exhaustedTurn);
			}
			const { runtime, model } = makeRuntime({
				steps,
				modelOptions: { reasoningEffort: "low" },
			});

			await runtime.run("Hi");

			// Exactly ONE request carried the override.
			const overridden = model.requests.filter(
				(request) => request.options?.maxTokens === OVERRIDE_TOKENS,
			);
			expect(overridden).toHaveLength(1);
		});

		it("produces NO override when the policy is DEFAULT_OFF", async () => {
			const steps: Array<
				(request: AgentModelRequest) => Iterable<AgentModelEvent>
			> = [];
			for (let i = 0; i < 8; i += 1) {
				steps.push(exhaustedTurn);
			}
			const { runtime, model } = makeRuntime({
				steps,
				overrideEnabled: false,
				modelOptions: { reasoningEffort: "low" },
			});

			await runtime.run("Hi");

			// No request carried the override.
			const overridden = model.requests.filter(
				(request) => request.options?.maxTokens === OVERRIDE_TOKENS,
			);
			expect(overridden).toHaveLength(0);
		});

		it("produces NO override for a DIFFERENT model", async () => {
			const steps: Array<
				(request: AgentModelRequest) => Iterable<AgentModelEvent>
			> = [];
			for (let i = 0; i < 8; i += 1) {
				steps.push(exhaustedTurn);
			}
			const model = new ScriptedModel(steps);
			const runtime = new AgentRuntime({
				model,
				modelOptions: { reasoningEffort: "low" },
				executionStagnationPolicy: {
					unproductiveRoundThreshold: 2,
					maxRecoveryInstructions: 2,
					enabled: true,
				},
				recoveryOutputOverridePolicy: {
					enabled: true,
					recoveryMaxOutputTokens: OVERRIDE_TOKENS,
					modelId: "MiniMax-M3.1-Flash",
					reasoningEffort: "low",
				},
				messageModelInfo: {
					id: "Some-Other-Model",
					provider: "minimax",
				} as never,
			});

			await runtime.run("Hi");

			const overridden = model.requests.filter(
				(request) => request.options?.maxTokens === OVERRIDE_TOKENS,
			);
			expect(overridden).toHaveLength(0);
		});

		it("produces NO override for a DIFFERENT reasoning effort", async () => {
			const steps: Array<
				(request: AgentModelRequest) => Iterable<AgentModelEvent>
			> = [];
			for (let i = 0; i < 8; i += 1) {
				steps.push(exhaustedTurn);
			}
			const model = new ScriptedModel(steps);
			const runtime = new AgentRuntime({
				model,
				modelOptions: { reasoningEffort: "high" },
				executionStagnationPolicy: {
					unproductiveRoundThreshold: 2,
					maxRecoveryInstructions: 2,
					enabled: true,
				},
				recoveryOutputOverridePolicy: {
					enabled: true,
					recoveryMaxOutputTokens: OVERRIDE_TOKENS,
					modelId: "MiniMax-M3.1-Flash",
					reasoningEffort: "low",
				},
				messageModelInfo: {
					id: "MiniMax-M3.1-Flash",
					provider: "minimax",
				} as never,
			});

			await runtime.run("Hi");

			const overridden = model.requests.filter(
				(request) => request.options?.maxTokens === OVERRIDE_TOKENS,
			);
			expect(overridden).toHaveLength(0);
		});

		it("preserves an EXPLICIT request cap over the override", async () => {
			const steps: Array<
				(request: AgentModelRequest) => Iterable<AgentModelEvent>
			> = [];
			for (let i = 0; i < 8; i += 1) {
				steps.push(exhaustedTurn);
			}
			const model = new ScriptedModel(steps);
			const runtime = new AgentRuntime({
				model,
				modelOptions: { reasoningEffort: "low", maxTokens: 4_096 },
				executionStagnationPolicy: {
					unproductiveRoundThreshold: 2,
					maxRecoveryInstructions: 2,
					enabled: true,
				},
				recoveryOutputOverridePolicy: {
					enabled: true,
					recoveryMaxOutputTokens: OVERRIDE_TOKENS,
					modelId: "MiniMax-M3.1-Flash",
					reasoningEffort: "low",
				},
				messageModelInfo: {
					id: "MiniMax-M3.1-Flash",
					provider: "minimax",
				} as never,
			});

			await runtime.run("Hi");

			// The explicit cap wins on EVERY request.
			const overridden = model.requests.filter(
				(request) => request.options?.maxTokens === OVERRIDE_TOKENS,
			);
			expect(overridden).toHaveLength(0);
			for (const request of model.requests) {
				expect(request.options?.maxTokens).toBe(4_096);
			}
		});
	});
});
