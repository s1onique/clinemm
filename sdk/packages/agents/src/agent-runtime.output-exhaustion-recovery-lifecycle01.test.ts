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

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — C4 production reachability", () => {
	it("reaches BOTH R1 interventions and the R1 allowance-exhausted branch with the PRODUCTION constants", async () => {
		// The ACTUAL production constants:
		//   ordinary R1 threshold .......... 5 unproductive rounds
		//   ordinary R1 allowance ......... 2 corrective instructions per run
		//   R2 activation allowance ....... 2 per run
		//   R2 selection-inference ........ 1 per run
		//
		// The production discriminator: a continuously exhausted, tool-less
		// trajectory must reach the FIRST R1 intervention, the SECOND R1
		// intervention, and then the R1 `allowance_exhausted` branch (which
		// is the ONLY branch R2 activates at).
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 20; i += 1) {
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
		const notices: string[] = [];
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "execution_stagnation_recovery"
			) {
				notices.push(String(event.message));
			}
		});

		await runtime.run("Hi");

		// BOTH R1 corrective instructions were injected.
		expect(notices).toHaveLength(2);
		// The first injection reported the five-round threshold.
		expect(notices[0]).toContain("after 5 unproductive round(s)");
		// The second injection required a FRESH five-round streak.
		expect(notices[1]).toContain("after 5 unproductive round(s)");
	});

	it("reaches the R1 allowance-exhausted branch (the R2 entry) with a tool-less trajectory", async () => {
		// The R2 entry point is R1's `allowance_exhausted` branch. With the
		// correction, a TOOL-LESS trajectory reaches it — the predecessor
		// could not, because a tool-less exhausted round never reached the
		// iteration boundary.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 30; i += 1) {
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
			boundedObjectivePolicy: {
				enabled: true,
				maxActivations: 2,
				maxObjectiveRounds: 8,
				maxSelectionInferences: 1,
			},
		});
		let boundedObjectiveActivations = 0;
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "bounded_objective_recovery"
			) {
				boundedObjectiveActivations += 1;
			}
		});

		await runtime.run("Hi");

		// The R1 allowance-exhausted branch was reached and R2 activated
		// from a TOOL-LESS trajectory.
		expect(boundedObjectiveActivations).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01) — A1.
//
// The RECOVERY CONTINUATION AUTHORITY.
//
// THE DEFECT THIS SUITE PINS
// ---------------------------
//
// The predecessor's `recoverFromIncompleteMaxTokensTurn()` permitted
// escalation whenever the stagnation policy was merely ENABLED. "Policy
// enabled" is not "recovery eligible": the run therefore kept driving parent
// model requests for the whole defensive ceiling AFTER every authorized
// intervention (both R1 corrective instructions) had been spent and R2 was
// absent, unreachable, or already exhausted.
//
// The ordinary reminder path was worse still: it returned `true` WITHOUT
// spending the continuation ceiling, so the declared total bound did not
// bound the ordinary reminders either.
//
// WHAT THIS SUITE ESTABLISHES
// ---------------------------
//
// The REAL `AgentRuntime`, a persistently exhausted scripted model with MORE
// scripted responses than the fixture can consume, and the PRODUCTION R1
// constants (threshold 5, allowance 2). It records the exact logical
// response count, the ordinary reminders, the R1 interventions, the R2
// selection inferences, the authorized continuation count and the terminal
// reason, for each of the four lifecycle shapes.
//
// NO provider. NO network. NO paid inference.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01) — A1 continuation authority", () => {
	/** The PRODUCTION R1 constants. */
	const PRODUCTION_R1 = {
		unproductiveRoundThreshold: 5,
		maxRecoveryInstructions: 2,
		enabled: true,
	};

	/**
	 * The PRODUCTION-VALID R2 selection reply.
	 *
	 * It names ONE objective with the SIX scalar string fields the
	 * production validator requires and cites the runtime-owned
	 * parent-obligation REFERENCE ID and the established observation
	 * VERBATIM.
	 */
	const VALID_SELECTION_REPLY = {
		objective: "Write the repaired artifact file with the expected content",
		firstStep: "Edit the artifact file to write the expected content",
		mutationScope: "the disposable workspace directory",
		verificationCondition: "the artifact file contains the expected content",
		obligationReferences: ["parent-task:original"],
		evidenceReferences: [
			"The last 5 consecutive execution round(s) produced no productive step",
		],
		successCondition: "the artifact file contains the expected content",
		failureCondition:
			"the artifact file cannot be written or its content does not match",
	};

	/**
	 * A model that exhausts its output on every parent request and answers
	 * the SELECTION inference with the given reply.
	 *
	 * The scripted responses are deliberately MORE numerous than the
	 * fixture can consume, so the fixture can never terminate by running out
	 * of responses: every terminal outcome is the runtime's own decision.
	 */
	class ExhaustingSelectionAwareModel implements AgentModel {
		public readonly requests: AgentModelRequest[] = [];
		public selectionInferences = 0;

		constructor(private readonly selectionReply: Record<string, unknown>) {}

		async stream(
			request: AgentModelRequest,
		): Promise<AsyncIterable<AgentModelEvent>> {
			if ((request.tools ?? []).length === 0) {
				this.selectionInferences += 1;
				const reply = JSON.stringify(this.selectionReply);
				return (async function* () {
					yield { type: "text-delta", text: reply } as AgentModelEvent;
					yield { type: "finish", reason: "stop" } as AgentModelEvent;
				})();
			}
			this.requests.push(request);
			return (async function* () {
				yield {
					type: "reasoning-delta",
					text: "thinking...",
				} as AgentModelEvent;
				yield { type: "finish", reason: "max-tokens" } as AgentModelEvent;
			})();
		}
	}

	/** The ordinary conciseness reminders the runtime INJECTED. */
	function countConcisenessReminders(
		requests: readonly AgentModelRequest[],
	): number {
		const ids = new Set<string>();
		for (const request of requests) {
			for (const message of request.messages) {
				for (const part of message.content ?? []) {
					if (
						part.type === "text" &&
						part.text.startsWith(
							"Your previous response was cut off because it reached the model's output-token limit",
						)
					) {
						ids.add(String((message as { id?: unknown }).id));
					}
				}
			}
		}
		return ids.size;
	}

	/**
	 * Run the exhausted trajectory and record every observable.
	 */
	async function runExhausted(options: {
		/**
		 * The R1 policy shape:
		 *
		 *   - `"present"`  — the PRODUCTION R1 policy,
		 *   - `"absent"`   — NO R1 policy at all,
		 *   - `"disabled"` — the R1 policy is present but DISABLED.
		 */
		readonly r1?: "present" | "absent" | "disabled";
		readonly r2?: boolean;
		readonly selectionReply?: Record<string, unknown>;
	}): Promise<{
		readonly logicalResponses: number;
		readonly ordinaryReminders: number;
		readonly r1Interventions: number;
		readonly r2SelectionInferences: number;
		readonly authorizedContinuations: number;
		readonly terminalReason: string;
		readonly status: string;
	}> {
		const model = new ExhaustingSelectionAwareModel(
			options.selectionReply ?? VALID_SELECTION_REPLY,
		);
		const runtime = new AgentRuntime({
			model,
			// The parent request carries the runtime's tool inventory; the
			// SELECTION inference carries NONE. That difference is the
			// discriminator the scripted model uses, and it is a property
			// of the REQUEST SHAPE, never a text guess.
			tools: [
				{
					name: "inspect",
					description: "Inspect the workspace",
					inputSchema: { type: "object" },
					async execute() {
						return { ok: true };
					},
				} as AgentTool<Record<string, never>, { ok: true }>,
			],
			...(options.r1 === "absent"
				? {}
				: {
						executionStagnationPolicy: {
							...PRODUCTION_R1,
							...(options.r1 === "disabled" ? { enabled: false } : {}),
						},
					}),
			...(options.r2
				? {
						boundedObjectivePolicy: {
							enabled: true,
							maxActivations: 2,
							maxObjectiveRounds: 8,
							maxSelectionInferences: 1,
						},
					}
				: {}),
		});
		let ordinaryReminders = 0;
		let r1Interventions = 0;
		let authorizedContinuations = 0;
		runtime.subscribe((event) => {
			if (event.type !== "status-notice") {
				return;
			}
			const reason = event.metadata?.reason;
			if (reason === "max_tokens_recovery") {
				ordinaryReminders += 1;
			}
			if (event.metadata?.kind === "execution_stagnation_recovery") {
				r1Interventions += 1;
			}
			if (reason === "max_tokens_recovery_escalation") {
				authorizedContinuations += 1;
			}
		});
		const result = await runtime.run("Do the work");
		return {
			logicalResponses: model.requests.length,
			ordinaryReminders,
			r1Interventions,
			r2SelectionInferences: model.selectionInferences,
			// EVERY exhaustion-driven continuation — the ordinary reminders
			// INCLUDED — spends one unit of the common ceiling.
			authorizedContinuations: ordinaryReminders + authorizedContinuations,
			terminalReason: result.error?.message ?? "completed",
			status: result.status,
		};
	}

	it("A1-1: with R2 ABSENT the run stops as soon as no authorized intervention remains", async () => {
		const observed = await runExhausted({ r1: "present", r2: false });

		// The R1 allowance was spent: BOTH corrective instructions were
		// injected.
		expect(observed.r1Interventions).toBe(2);
		// NO selection inference was made: R2 is unreachable.
		expect(observed.r2SelectionInferences).toBe(0);
		// The ordinary reminders are bounded by their own allowance.
		expect(observed.ordinaryReminders).toBeLessThanOrEqual(3);
		// The TOTAL exhaustion-driven continuations are bounded by the
		// declared ceiling.
		expect(observed.authorizedContinuations).toBeLessThanOrEqual(32);
		// The run terminated TRUTHFULLY on the exhaustion, not on the
		// defensive ceiling and not on an exhausted fixture.
		expect(observed.status).toBe("failed");
		expect(observed.terminalReason).toContain("maximum output token limit");
		// The run did NOT drive the whole defensive ceiling: it stopped
		// once the R1 allowance was spent and R2 was unreachable.
		expect(observed.authorizedContinuations).toBeLessThan(32);
		// The EXACT intervention cardinality: the three ordinary reminders
		// and the seven escalations that reach the SECOND R1 instruction.
		// The run stops THERE: with R2 unreachable, no further
		// intervention remains to authorize another request, so the run
		// does NOT keep driving the defensive ceiling.
		expect(observed.ordinaryReminders).toBe(3);
		expect(observed.authorizedContinuations).toBe(10);
	});

	it("A1-2: with R2 ENABLED but the selection REJECTED the run stops as soon as no authorized intervention remains", async () => {
		// A selection that FABRICATES an evidence reference: the production
		// validator rejects it, the activation's allowance is consumed, and
		// no further selection is attempted.
		const observed = await runExhausted({
			r1: "present",
			r2: true,
			selectionReply: {
				...VALID_SELECTION_REPLY,
				evidenceReferences: ["A finding that was never established"],
			},
		});

		// EXACTLY ONE selection inference: the run-scoped allowance.
		expect(observed.r2SelectionInferences).toBe(1);
		// The R1 allowance was spent.
		expect(observed.r1Interventions).toBe(2);
		// The ordinary reminders are bounded.
		expect(observed.ordinaryReminders).toBeLessThanOrEqual(3);
		// The TOTAL exhaustion-driven continuations are bounded.
		expect(observed.authorizedContinuations).toBeLessThanOrEqual(32);
		// The run terminated TRUTHFULLY.
		expect(observed.status).toBe("failed");
		// The rejected selection did NOT leave the run driving requests
		// that no intervention can authorize: the run stopped as soon as
		// the R1 allowance was spent and the selection allowance was
		// consumed.
		expect(observed.authorizedContinuations).toBeLessThan(32);
	});

	it("A1-3: with R2 ENABLED and a VALID selection the objective's OWN budget is honoured", async () => {
		const observed = await runExhausted({ r1: "present", r2: true });

		// EXACTLY ONE selection inference.
		expect(observed.r2SelectionInferences).toBe(1);
		// The R1 allowance was spent.
		expect(observed.r1Interventions).toBe(2);
		// The ordinary reminders are bounded.
		expect(observed.ordinaryReminders).toBeLessThanOrEqual(3);
		// The TOTAL exhaustion-driven continuations are bounded by the
		// declared ceiling.
		expect(observed.authorizedContinuations).toBeLessThanOrEqual(32);
		// The run terminated TRUTHFULLY.
		expect(observed.status).toBe("failed");
		// The EXACT reachable lifecycle: three ordinary reminders, eleven
		// escalations to the R1 exhausted branch, and the R2 objective's
		// own EIGHT rounds. The selection inference is NOT a continuation.
		//
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01
		// (FINAL-BOUNDED-CORRECTION-01): the predecessor asserted SEVEN
		// objective rounds. That was the DEFECTIVE cardinality: the
		// activation-triggering parent response was charged to the newly
		// activated objective as one of its own execution rounds, so the
		// objective started with ONE consumed round and only SEVEN of its
		// EIGHT authorised rounds were executable. The objective's budget is
		// now honoured in full.
		expect(observed.authorizedContinuations).toBe(22);
	});

	it("A1-4: with R1 ABSENT the run terminates after the ordinary allowance, with NO escalation", async () => {
		const observed = await runExhausted({ r1: "absent", r2: false });

		// NO R1 intervention: the policy is absent.
		expect(observed.r1Interventions).toBe(0);
		// NO selection inference.
		expect(observed.r2SelectionInferences).toBe(0);
		// The ordinary reminders are bounded by their own allowance.
		expect(observed.ordinaryReminders).toBeLessThanOrEqual(3);
		// The TOTAL exhaustion-driven continuations are bounded.
		expect(observed.authorizedContinuations).toBeLessThanOrEqual(20);
		// The run terminated TRUTHFULLY after the ordinary allowance, and
		// it did NOT escalate: with no R1 policy there is no authorized
		// intervention to escalate to.
		expect(observed.status).toBe("failed");
		expect(observed.terminalReason).toContain("maximum output token limit");
		// The initial attempt plus the ordinary allowance.
		expect(observed.logicalResponses).toBe(4);
	});

	it("A1-5: the continuation ceiling is a DEFENSIVE bound, never a target", async () => {
		// The run stops as soon as no useful authorized intervention
		// remains — it does NOT consume the ceiling merely because the
		// ceiling exists.
		const observed = await runExhausted({ r1: "present", r2: false });
		expect(observed.authorizedContinuations).toBeGreaterThan(0);
		expect(observed.authorizedContinuations).toBeLessThan(20);
	});
});
