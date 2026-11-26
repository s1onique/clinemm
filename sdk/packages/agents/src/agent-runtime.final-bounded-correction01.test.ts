/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01
 * (FINAL-BOUNDED-CORRECTION-01) — C1 and C2.
 *
 * THE OBJECTIVE-ROUND ATTRIBUTION DEFECT.
 *
 * THE DEFECT
 * ----------
 *
 * On the TOOL-LESS exhaustion path the runtime executes:
 *
 *   this.maxTokensExhaustionStreak += 1;
 *   await this.evaluateExecutionStagnation();    // (1) may ACTIVATE a new objective
 *   await this.evaluateActiveBoundedObjective(); // (2) may CONSUME that objective's round
 *
 * (1) can activate a NEW bounded objective. (2) then folds the just-completed
 * PARENT response into that NEW objective's accounting — the parent response
 * was dispatched BEFORE the objective existed, so it was never an objective
 * execution round. The new objective therefore starts with ONE consumed round
 * instead of zero, and its whole authorised budget is short by one.
 *
 * The TOOL-CALLING path has the SAME ordering:
 *
 *   await this.evaluateExecutionStagnation();
 *   await this.evaluateActiveBoundedObjective();
 *
 * so it carries the same defect whenever the activation happens on the same
 * boundary that then folds the round.
 *
 * WHAT THIS SUITE ESTABLISHES
 * ---------------------------
 *
 * The REAL `AgentRuntime`, the existing exhausting selection-aware model, the
 * PRODUCTION R1 constants and a PRODUCTION-VALID selector reply. It records:
 *
 *   - the PARENT requests that carried the objective projection,
 *   - the objective-round consumption reported by the runtime at the
 *     objective's own lifecycle boundary,
 *   - the selection inferences (which are NOT objective execution rounds).
 *
 * The objective-bearing request is identified by the PRODUCTION dispatch
 * projection in the request's privileged channel — the exact
 * `[SYSTEM] Active bounded objective (runtime authority):` prefix — never by
 * a text guess and never by the total model request count.
 *
 * NO provider. NO network. NO paid inference.
 */

import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "./agent-runtime";

/**
 * The PRODUCTION dispatch-projection prefix. It is the runtime-owned marker
 * that the request the provider sees is a request FOR THE OBJECTIVE rather
 * than for the stalled parent.
 */
const OBJECTIVE_DISPATCH_PREFIX =
	"[SYSTEM] Active bounded objective (runtime authority):";

/** The PRODUCTION R1 constants. */
const PRODUCTION_R1 = {
	unproductiveRoundThreshold: 5,
	maxRecoveryInstructions: 2,
	enabled: true,
};

/** The PRODUCTION R2 constants. */
const PRODUCTION_R2 = {
	enabled: true,
	maxActivations: 2,
	maxObjectiveRounds: 8,
	maxSelectionInferences: 1,
};

/**
 * The PRODUCTION-VALID R2 selection reply: it names ONE objective with the
 * SIX scalar string fields the production validator requires and cites the
 * runtime-owned parent-obligation REFERENCE ID and the established
 * observation VERBATIM.
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
 * A model that exhausts its output on every PARENT request and answers the
 * SELECTION inference with the given reply.
 *
 * The SELECTION inference is discriminated by the RUNTIME'S OWN request
 * metadata: the runtime tags the selection request with
 * `metadata.kind === "bounded_objective_selection"`. That is a property of
 * the request the runtime built, never a text guess and never a tool-count
 * heuristic.
 */
class ExhaustingSelectionAwareModel implements AgentModel {
	public readonly parentRequests: AgentModelRequest[] = [];
	public selectionInferences = 0;

	constructor(
		private readonly selectionReply: Record<string, unknown>,
		/**
		 * When TRUE the parent turn CALLS a tool (and is then exhausted by the
		 * tool-calling path); when FALSE the parent turn is a TOOL-LESS
		 * output-exhausted response.
		 */
		private readonly toolCalling: boolean = false,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		if (request.options?.metadata?.kind === "bounded_objective_selection") {
			this.selectionInferences += 1;
			const reply = JSON.stringify(this.selectionReply);
			return (async function* () {
				yield { type: "text-delta", text: reply } as AgentModelEvent;
				yield { type: "finish", reason: "stop" } as AgentModelEvent;
			})();
		}
		this.parentRequests.push(request);
		if (this.toolCalling) {
			const toolCallId = `call-${this.parentRequests.length}`;
			return (async function* () {
				yield {
					type: "tool-call-delta",
					toolCallId,
					toolName: "inspect",
					inputText: "{}",
				} as AgentModelEvent;
				yield { type: "finish", reason: "tool-calls" } as AgentModelEvent;
			})();
		}
		return (async function* () {
			yield {
				type: "reasoning-delta",
				text: "thinking...",
			} as AgentModelEvent;
			yield { type: "finish", reason: "max-tokens" } as AgentModelEvent;
		})();
	}
}

/** Whether the request carries the PRODUCTION objective dispatch projection. */
function isObjectiveBearing(request: AgentModelRequest): boolean {
	const systemPrompt = request.systemPrompt;
	return (
		typeof systemPrompt === "string" &&
		systemPrompt.includes(OBJECTIVE_DISPATCH_PREFIX)
	);
}

/**
 * Run the exhausting trajectory and record every objective-round observable.
 *
 * The objective-round consumption is read from the runtime's OWN lifecycle
 * events — the `bounded_objective_recovery` notices — so the assertion is
 * about the runtime's accounting, never about a re-implementation of it.
 */
async function runExhausted(options?: {
	readonly toolCalling?: boolean;
	readonly r1?: "present" | "absent" | "disabled";
	/**
	 * The TRUSTED HOST VERIFICATION AUTHORITY. When it returns TRUE the
	 * objective verifies; the runtime closes it and returns execution to the
	 * parent task.
	 */
	readonly verifyObjective?: (
		objective: unknown,
		facts: unknown,
	) => boolean | undefined;
}): Promise<{
	readonly objectiveBearingRequests: number;
	readonly parentOnlyRequests: number;
	/**
	 * The per-request objective-projection sequence: `true` when the request
	 * carried the objective dispatch projection, `false` when it was a plain
	 * parent request. It is the runtime's own projection, observed on the
	 * dispatched requests.
	 */
	readonly projectionSequence: readonly boolean[];
	readonly selectionInferences: number;
	readonly objectiveRounds: number;
	readonly roundsAtActivation: number | undefined;
	readonly objectiveActivated: boolean;
	readonly objectiveClosed: boolean;
	readonly verificationPassed: boolean;
	readonly status: string;
	readonly error: string | undefined;
}> {
	const model = new ExhaustingSelectionAwareModel(
		VALID_SELECTION_REPLY,
		options?.toolCalling ?? false,
	);
	const tools: AgentTool<Record<string, never>, { ok: true }>[] = [
		{
			name: "inspect",
			description: "Inspect the workspace",
			inputSchema: { type: "object" },
			async execute() {
				return { ok: true };
			},
		},
	];
	const runtime = new AgentRuntime({
		model,
		// The parent request ALWAYS carries the runtime's tool inventory. The
		// TOOL-LESS variant is about the RESPONSE (an exhausted turn with no
		// tool call), never about the request's inventory.
		tools,
		// A finite iteration budget: the TOOL-CALLING path never exhausts the
		// output limit, so without a bound it would never terminate.
		maxIterations: 60,
		...(options?.r1 === "absent"
			? {}
			: {
					executionStagnationPolicy: {
						...PRODUCTION_R1,
						...(options?.r1 === "disabled" ? { enabled: false } : {}),
						// The REAL host classification authority: a read-only
						// inspection is `inspected` — NOT productive progress.
						// Without it the tool-calling path would clear the
						// streak on every round and never reach R1/R2.
						classifyToolCall: (toolName: string) =>
							toolName === "inspect" ? "inspected" : undefined,
					},
				}),
		boundedObjectivePolicy: {
			...PRODUCTION_R2,
			...(options?.verifyObjective
				? { verifyObjective: options.verifyObjective }
				: {}),
		},
	});

	let objectiveActivated = false;
	let objectiveClosed = false;
	let verificationPassed = false;
	let objectiveRounds = 0;
	let roundsAtActivation: number | undefined;
	runtime.subscribe((event) => {
		if (event.type !== "status-notice") {
			return;
		}
		if (event.metadata?.kind !== "bounded_objective_recovery") {
			return;
		}
		const rounds = event.metadata?.rounds;
		if (typeof rounds === "number") {
			objectiveRounds = rounds;
		}
		if (event.metadata?.reason === "bounded_objective_activated") {
			objectiveActivated = true;
			roundsAtActivation = typeof rounds === "number" ? rounds : 0;
		}
		if (event.metadata?.reason === "bounded_objective_verified") {
			objectiveClosed = true;
			verificationPassed = true;
		}
		if (event.metadata?.reason === "bounded_objective_unverified") {
			objectiveClosed = true;
			verificationPassed = false;
		}
	});

	const result = await runtime.run("Do the work");
	const projectionSequence = model.parentRequests.map(isObjectiveBearing);
	const objectiveBearingRequests = projectionSequence.filter(Boolean).length;
	return {
		objectiveBearingRequests,
		projectionSequence,
		parentOnlyRequests: model.parentRequests.length - objectiveBearingRequests,
		selectionInferences: model.selectionInferences,
		objectiveRounds,
		roundsAtActivation,
		objectiveActivated,
		objectiveClosed,
		verificationPassed,
		status: result.status,
		error: result.error?.message,
	};
}

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (FINAL-BOUNDED-CORRECTION-01) — C1 objective-round attribution", () => {
	it("C1-1: a NEWLY ACTIVATED objective starts at ZERO consumed rounds", async () => {
		const observed = await runExhausted();

		// The objective activated.
		expect(observed.objectiveActivated).toBe(true);
		// The activation itself must NOT consume an objective round. The
		// runtime's own lifecycle accounting reports the rounds the objective
		// consumed; a freshly activated objective has consumed NONE.
		expect(observed.roundsAtActivation).toBe(0);
	});

	it("C1-2: exactly EIGHT objective-bearing responses are executable", async () => {
		const observed = await runExhausted();

		// The objective's authorised budget is EIGHT objective rounds.
		expect(PRODUCTION_R2.maxObjectiveRounds).toBe(8);
		// The number of objective-bearing PARENT requests the runtime
		// actually dispatched is the executable objective-round cardinality.
		expect(observed.objectiveBearingRequests).toBe(8);
	});

	it("C1-3: NO parent-only round and NO selector inference is charged to the objective", async () => {
		const observed = await runExhausted();

		// The SELECTION inference is NOT an objective execution round.
		expect(observed.selectionInferences).toBe(1);
		// The objective consumed EXACTLY the objective-bearing rounds.
		expect(observed.objectiveRounds).toBe(observed.objectiveBearingRequests);
		// The parent-only rounds BEFORE the activation are NOT charged.
		expect(observed.parentOnlyRequests).toBeGreaterThan(0);
	});

	it("C1-4: the TOOL-CALLING path carries the SAME attribution contract", async () => {
		const observed = await runExhausted({ toolCalling: true });

		expect(observed.objectiveActivated).toBe(true);
		expect(observed.roundsAtActivation).toBe(0);
		expect(observed.objectiveBearingRequests).toBe(8);
		expect(observed.objectiveRounds).toBe(observed.objectiveBearingRequests);
	});

	it("C1-5: the objective's OWN budget exhaustion fails TRUTHFULLY", async () => {
		const observed = await runExhausted();
		// The objective closed WITHOUT a verification: the runtime reported
		// the failure rather than manufacturing success.
		expect(observed.objectiveClosed).toBe(true);
		expect(observed.verificationPassed).toBe(false);
	});

	it("C1-6: a SUCCESSFUL EARLY verification closes the objective", async () => {
		// The host's TRUSTED VERIFICATION AUTHORITY verifies the objective as
		// soon as the objective has executed ONE of its own rounds. The
		// objective must then close and the run must return to the parent
		// task.
		//
		// The authority consults the OBJECTIVE'S OWN FACT COUNT, so it can
		// only verify after a genuine objective round — never on the
		// activation boundary's parent round.
		const observed = await runExhausted({
			verifyObjective: (_objective, facts) =>
				(facts as { rounds?: number }).rounds !== undefined &&
				(facts as { rounds: number }).rounds >= 1,
		});

		// The objective verified and closed.
		expect(observed.verificationPassed).toBe(true);
		expect(observed.objectiveClosed).toBe(true);
		// It closed after exactly ONE objective round: the activation did not
		// charge a round, so the FIRST objective-bearing response is the one
		// that verified it.
		expect(observed.objectiveRounds).toBe(1);
		expect(observed.objectiveBearingRequests).toBe(1);
	});

	it("C1-7: SUBSEQUENT parent requests do NOT inherit a CLOSED objective", async () => {
		const observed = await runExhausted({
			verifyObjective: (_objective, facts) =>
				(facts as { rounds?: number }).rounds !== undefined &&
				(facts as { rounds: number }).rounds >= 1,
		});

		// The objective closed. The projection sequence is
		// `false ... true ... false ...`: the parent requests BEFORE the
		// activation carry no objective, the objective-bearing request
		// carries it, and EVERY request AFTER the closure carries NO
		// objective.
		const sequence = observed.projectionSequence;
		const firstObjectiveIndex = sequence.indexOf(true);
		expect(firstObjectiveIndex).toBeGreaterThan(0);
		// EVERY request after the objective-bearing one is a plain parent
		// request: the CLOSED objective is not inherited.
		for (const carried of sequence.slice(firstObjectiveIndex + 1)) {
			expect(carried).toBe(false);
		}
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01
// (FINAL-BOUNDED-CORRECTION-01) — C2.
//
// INTERVENTION REACHABILITY CONSERVATION.
//
// THE DEFECT
// ----------
//
// R2's ONLY activation seam is R1's `allowance_exhausted` branch. The
// reachability helper consulted ONLY R2's own allowances, so with R1 ABSENT
// or explicitly DISABLED it reported the R2 activation REACHABLE even
// though that activation could never happen. The exhaustion recovery
// therefore kept driving parent model requests for the whole defensive
// ceiling — requests authorized by an intervention that could not exist.
//
// WHAT THIS SUITE ESTABLISHES
// ---------------------------
//
// The REAL `AgentRuntime`, the PRODUCTION R1 constants and the PRODUCTION-VALID
// selector reply, under each of the three R1 shapes. It records the parent
// request count, the authorized continuation count and the R2 selection
// inferences.
//
// NO provider. NO network. NO paid inference.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (FINAL-BOUNDED-CORRECTION-01) — C2 intervention reachability conservation", () => {
	/**
	 * Run the exhausting trajectory under the given R1/R2 shapes and record
	 * the continuation observables.
	 */
	async function runContinuationShape(options: {
		readonly r1: "present" | "absent" | "disabled";
		readonly r2: boolean;
	}): Promise<{
		readonly parentRequests: number;
		readonly ordinaryReminders: number;
		readonly escalations: number;
		readonly authorizedContinuations: number;
		readonly r2SelectionInferences: number;
	}> {
		const model = new ExhaustingSelectionAwareModel(VALID_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
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
			maxIterations: 200,
			...(options.r1 === "absent"
				? {}
				: {
						executionStagnationPolicy: {
							...PRODUCTION_R1,
							...(options.r1 === "disabled" ? { enabled: false } : {}),
							classifyToolCall: (toolName: string) =>
								toolName === "inspect" ? "inspected" : undefined,
						},
					}),
			...(options.r2 ? { boundedObjectivePolicy: { ...PRODUCTION_R2 } } : {}),
		});
		let ordinaryReminders = 0;
		let escalations = 0;
		runtime.subscribe((event) => {
			if (event.type !== "status-notice") {
				return;
			}
			if (event.metadata?.reason === "max_tokens_recovery") {
				ordinaryReminders += 1;
			}
			if (event.metadata?.reason === "max_tokens_recovery_escalation") {
				escalations += 1;
			}
		});
		await runtime.run("Do the work");
		return {
			parentRequests: model.parentRequests.length,
			ordinaryReminders,
			escalations,
			authorizedContinuations: ordinaryReminders + escalations,
			r2SelectionInferences: model.selectionInferences,
		};
	}

	it("C2-1: with R1 ABSENT the R2 activation is UNREACHABLE and grants NO extra continuation", async () => {
		const observed = await runContinuationShape({ r1: "absent", r2: true });

		// R2 NEVER activated: its only activation seam is R1's
		// `allowance_exhausted` branch, and there is no R1 policy.
		expect(observed.r2SelectionInferences).toBe(0);
		// The run therefore drives ONLY the ordinary allowance: NO
		// escalation continuation is authorized by the unreachable R2
		// activation.
		expect(observed.escalations).toBe(0);
		expect(observed.authorizedContinuations).toBe(observed.ordinaryReminders);
		// The ordinary allowance is the run-scoped one.
		expect(observed.ordinaryReminders).toBe(3);
		// The run did NOT drive the defensive ceiling.
		expect(observed.authorizedContinuations).toBeLessThan(32);
	});

	it("C2-2: with R1 DISABLED the R2 activation is UNREACHABLE and grants NO extra continuation", async () => {
		const observed = await runContinuationShape({ r1: "disabled", r2: true });

		// R2 NEVER activated: an explicitly DISABLED R1 policy has no
		// `allowance_exhausted` branch.
		expect(observed.r2SelectionInferences).toBe(0);
		expect(observed.escalations).toBe(0);
		expect(observed.authorizedContinuations).toBe(observed.ordinaryReminders);
		expect(observed.authorizedContinuations).toBeLessThan(32);
	});

	it("C2-3: with R1 ABSENT the reachability is IDENTICAL to R2 being ABSENT", async () => {
		const withR2 = await runContinuationShape({ r1: "absent", r2: true });
		const withoutR2 = await runContinuationShape({ r1: "absent", r2: false });

		// An unreachable R2 grants EXACTLY as much authority as no R2 at
		// all: the conservation property.
		expect(withR2.authorizedContinuations).toBe(
			withoutR2.authorizedContinuations,
		);
		expect(withR2.parentRequests).toBe(withoutR2.parentRequests);
	});

	it("C2-4: an ALREADY ACTIVE authorized objective RETAINS its lifecycle semantics", async () => {
		// With R1 PRESENT the seam is live, so the R2 activation happens and
		// the objective's OWN budget is honoured. The C2 conservation must
		// NOT disable a reachable R2.
		const observed = await runContinuationShape({ r1: "present", r2: true });

		// The R2 selection inference happened: the seam was live.
		expect(observed.r2SelectionInferences).toBe(1);
		// The objective's own EIGHT rounds are executable, so the run went
		// beyond the ordinary allowance.
		expect(observed.escalations).toBeGreaterThan(0);
		expect(observed.authorizedContinuations).toBeGreaterThan(
			observed.ordinaryReminders,
		);
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01
// (FINAL-BOUNDED-CORRECTION-01) — C3.
//
// D4 RUNTIME ELIGIBILITY.
//
// THE CONTRACT
// ------------
//
//   1. `enabled` must be EXPLICITLY true.
//   2. The runtime's MINIMUM repeated-exhaustion requirement remains
//      AUTHORITATIVE.
//   3. A supplied `isExhaustionEstablished` predicate may NARROW the
//      eligibility, never WIDEN it.
//   4. Unknown or unauthorized TARGET facts grant NO override under the
//      production host policy.
//
// WHAT THIS SUITE ESTABLISHES
// ---------------------------
//
// The REAL `AgentRuntime`, a persistently exhausted scripted model and the
// PRODUCTION target facts (provider `minimax`, model `MiniMax-M3.1-Flash`,
// LOW effort, 8192 ordinary limit, 16384 recovery override). It records the
// requests that carried the recovery override.
//
// NO provider. NO network. NO paid inference.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (FINAL-BOUNDED-CORRECTION-01) — C3 D4 runtime eligibility", () => {
	/** The PRODUCTION recovery override allowance. */
	const OVERRIDE_TOKENS = 16_384;
	/** The PRODUCTION authorized target. */
	const AUTHORIZED_MODEL = "MiniMax-M3.1-Flash";
	const AUTHORIZED_EFFORT = "low";
	const AUTHORIZED_PROVIDER = "minimax";

	/**
	 * A model that exhausts its output on EVERY request.
	 *
	 * The steps are deliberately more numerous than the fixture can consume,
	 * so the fixture can never terminate by running out of responses.
	 */
	class ExhaustingModel implements AgentModel {
		public readonly requests: AgentModelRequest[] = [];

		async stream(
			request: AgentModelRequest,
		): Promise<AsyncIterable<AgentModelEvent>> {
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

	/**
	 * A model that exhausts its output on the FIRST `exhaustedTurns` requests
	 * and then produces a PRODUCTIVE round (a successful native edit), which
	 * CLEARS the consecutive exhaustion streak.
	 *
	 * This is how the runtime's own minimum repeated-exhaustion requirement
	 * is exercised with a streak that never reaches the limit.
	 */
	class BoundedExhaustionModel implements AgentModel {
		public readonly requests: AgentModelRequest[] = [];

		constructor(private readonly exhaustedTurns: number) {}

		async stream(
			request: AgentModelRequest,
		): Promise<AsyncIterable<AgentModelEvent>> {
			this.requests.push(request);
			if (this.requests.length <= this.exhaustedTurns) {
				return (async function* () {
					yield {
						type: "reasoning-delta",
						text: "thinking...",
					} as AgentModelEvent;
					yield {
						type: "finish",
						reason: "max-tokens",
					} as AgentModelEvent;
				})();
			}
			// A PRODUCTIVE round: a successful native edit clears the streak.
			return (async function* () {
				yield {
					type: "tool-call-delta",
					toolCallId: `edit-${this.requests.length}`,
					toolName: "write_file",
					inputText: "{}",
				} as AgentModelEvent;
				yield { type: "finish", reason: "tool-calls" } as AgentModelEvent;
			})();
		}
	}

	/**
	 * Run the D4 fixture and return the requests that carried the recovery
	 * override.
	 */
	async function runD4(options: {
		readonly policy: Record<string, unknown>;
		readonly exhaustionTurns?: number;
	}): Promise<number> {
		const model =
			options.exhaustionTurns !== undefined
				? new BoundedExhaustionModel(options.exhaustionTurns)
				: new ExhaustingModel();
		const runtime = new AgentRuntime({
			model,
			tools: [
				{
					name: "write_file",
					description: "Write a file",
					inputSchema: { type: "object" },
					async execute() {
						return { ok: true };
					},
				} as AgentTool<Record<string, never>, { ok: true }>,
			],
			modelOptions: { reasoningEffort: AUTHORIZED_EFFORT },
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			recoveryOutputOverridePolicy: options.policy as never,
			messageModelInfo: {
				id: AUTHORIZED_MODEL,
				provider: AUTHORIZED_PROVIDER,
			} as never,
		});
		await runtime.run("Hi");
		return model.requests.filter(
			(request) => request.options?.maxTokens === OVERRIDE_TOKENS,
		).length;
	}

	/** The PRODUCTION-VALID policy shape. */
	function basePolicy(): Record<string, unknown> {
		return {
			enabled: true,
			recoveryMaxOutputTokens: OVERRIDE_TOKENS,
			modelId: AUTHORIZED_MODEL,
			reasoningEffort: AUTHORIZED_EFFORT,
			isAuthorizedTarget: ({
				modelId,
				reasoningEffort,
				providerId,
			}: {
				readonly modelId: string | undefined;
				readonly reasoningEffort: string | undefined;
				readonly providerId: string | undefined;
			}) =>
				providerId === AUTHORIZED_PROVIDER &&
				modelId === AUTHORIZED_MODEL &&
				reasoningEffort === AUTHORIZED_EFFORT,
		};
	}

	it("C3-1: the EXPLICIT enable authority arms the override exactly ONCE", async () => {
		const overridden = await runD4({ policy: basePolicy() });

		// The one-shot logical-request accounting is conserved.
		expect(overridden).toBe(1);
	});

	it("C3-2: a policy with `enabled` ABSENT grants NO override", async () => {
		// The NEGATIVE CONTROL: the policy is present and complete, but the
		// enable flag is ABSENT. The enable must be an EXPLICIT positive act.
		const policy = basePolicy();
		delete policy.enabled;

		const overridden = await runD4({ policy });

		expect(overridden).toBe(0);
	});

	it("C3-3: an INSUFFICIENT exhaustion streak with a predicate returning TRUE grants NO override", async () => {
		// The NEGATIVE CONTROL: the host predicate returns TRUE, but the
		// runtime's OWN minimum repeated-exhaustion requirement is not met.
		// The predicate may NARROW, never WIDEN.
		const policy = {
			...basePolicy(),
			isExhaustionEstablished: () => true,
		};

		// A SINGLE exhausted turn: far below the runtime's streak limit.
		const overridden = await runD4({ policy, exhaustionTurns: 1 });

		expect(overridden).toBe(0);
	});

	it("C3-4: a SUFFICIENT exhaustion streak with a predicate returning FALSE grants NO override", async () => {
		// The NEGATIVE CONTROL: the runtime's requirement IS met, but the
		// host's own authority does not establish the exhaustion. The host
		// NARROWS the eligibility.
		const policy = {
			...basePolicy(),
			isExhaustionEstablished: () => false,
		};

		const overridden = await runD4({ policy });

		expect(overridden).toBe(0);
	});

	it("C3-5: an UNKNOWN target fact grants NO override", async () => {
		// The NEGATIVE CONTROL: the host's target predicate cannot
		// establish the target. An UNKNOWN target is NOT an authorized one.
		const policy = {
			...basePolicy(),
			isAuthorizedTarget: () => undefined as unknown as boolean,
		};

		const overridden = await runD4({ policy });

		expect(overridden).toBe(0);
	});

	it("C3-6: a DIFFERENT provider, model or effort grants NO override", async () => {
		const policy = {
			...basePolicy(),
			isAuthorizedTarget: () => false,
		};

		const overridden = await runD4({ policy });

		expect(overridden).toBe(0);
	});
});
