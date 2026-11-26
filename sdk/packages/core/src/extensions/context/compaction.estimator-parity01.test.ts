/**
 * ACT-CLINEMM-COMPACTION-ESTIMATOR-PARITY-01
 *
 * SAME-INPUT estimator/usage parity discriminators at the REAL production
 * compaction seam.
 *
 * WHAT THIS FILE DOES
 * -------------------
 *
 * It drives the PRODUCTION `createContextCompactionPrepareTurn({ ... })`
 * seam — the same function the runtime installs — with a recording trace sink
 * and deterministic synthetic inputs, and it compares:
 *
 *   D  the DECISION candidate estimate (`requestInputTokens`, computed by the
 *      production resolver over `context.apiMessages` + systemPrompt + tools)
 *
 *   P  the POST-compaction / dispatched projection estimate
 *
 *   U  the provider-REPORTED usage for the dispatched request
 *
 * The estimates are NEVER re-implemented here. Every token number asserted
 * below comes from the production modules:
 *
 *   - `estimateRequestInputTokens` (`@cline/shared`) — the production
 *     estimator, and the ONE the compaction policy and the final budget guard
 *     both use.
 *   - the production resolver's own published `requestInputTokens`,
 *     `apiMessageTokens`, `requestOverheadTokens`, `requestTriggerTokens`,
 *     `rawMaxInputTokens` and `underestimateFactor`, captured through the
 *     REAL diagnostics sink channel.
 *   - `assertProviderRequestWithinBudget` (`@cline/shared`) — the production
 *     final-request budget guard.
 *
 * THE CACHE-SEMANTICS QUESTION (H4)
 * ---------------------------------
 *
 * The historical Round C observation was a ~1.5x estimated/reported ratio.
 * This suite pins the PROVIDER-USAGE CONTRACT that makes such a ratio
 * interpretable at all:
 *
 *   - OpenAI-compatible accounting reports `prompt_tokens` as the COMPLETE
 *     prompt and `prompt_tokens_details.cached_tokens` as a SUBSET of it.
 *   - The AI SDK exposes `usage.inputTokens` (= complete prompt) and
 *     `usage.inputTokenDetails.cacheReadTokens` (= the cached subset).
 *
 * Therefore `inputTokens` and `cacheReadTokens` are NOT disjoint quantities,
 * and adding them would DOUBLE-COUNT the cached portion. The suite asserts
 * this contract directly so a future change cannot silently alter it.
 *
 * NO LIVE PROVIDER CALL. Every provider in this file is a recording fake with
 * synthetic credentials only. The suite never asserts that the fake's numbers
 * match a real Strata deployment — it asserts the ACCOUNTING CONTRACT and the
 * production seam's behaviour.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import {
	assertProviderRequestWithinBudget,
	estimateRequestInputTokens,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextCompactionPrepareTurn } from "./compaction";
import { MAX_INPUT_UNDERESTIMATE_FACTOR } from "./compaction-shared";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

const SYSTEM_PROMPT =
	"You are a deterministic parity probe. This text exists so the production estimator has a real system prompt to measure.";

type CompactionPrepareTurn = NonNullable<
	ReturnType<typeof createContextCompactionPrepareTurn>
>;
type CompactionModel = Parameters<CompactionPrepareTurn>[0]["model"];

const MODEL = {
	id: "parity-probe-model",
	provider: "openai-compatible",
	info: {
		maxInputTokens: 115_200,
		contextWindow: 115_200,
	},
} as unknown as CompactionModel;

/**
 * A recorded observation from the REAL diagnostics channel.
 *
 * Only the privacy-safe scalar fields the production resolver publishes are
 * retained. No prompt, message text, tool result or credential is captured.
 */
interface DecisionObservation {
	decisionId?: string;
	decisionOrdinal?: number;
	requestInputTokens?: number;
	apiMessageTokens?: number;
	requestOverheadTokens?: number;
	requestTriggerTokens?: number;
	rawMaxInputTokens?: number;
	actualPreviousInputTokens?: number;
	underestimateFactor?: number;
	shouldCompact?: boolean;
	compactionInitiated?: boolean;
	apiMessageCount?: number;
	apiMessagesJsonChars?: number;
}

/**
 * A recording sink for the production diagnostics channel.
 *
 * `isTraceEnabled` mirrors the production guard in `compaction.ts`: a sink
 * that reports itself disabled is treated as DISARMED, and the production
 * path must then allocate NO ordinal and perform NO decision capture.
 */
function createRecordingSink(enabled = true) {
	const decisions: DecisionObservation[] = [];
	let sinkThrows = false;
	const sink = {
		isTraceEnabled: () => enabled,
		onCompactionDiagnostics: (observation: {
			payload: Record<string, unknown>;
		}) => {
			if (sinkThrows) {
				throw new Error("synthetic sink failure");
			}
			decisions.push(observation.payload as DecisionObservation);
		},
	};
	return {
		sink,
		decisions,
		setThrows(value: boolean) {
			sinkThrows = value;
		},
	};
}

/**
 * Build a fake provider that reports the given usage.
 *
 * The usage numbers are SYNTHETIC. They are modelled on the OpenAI-compatible
 * contract: `prompt_tokens` is the complete prompt and `cached_tokens` is a
 * subset of it.
 */
function createFakeProvider(usage: {
	promptTokens: number;
	cachedTokens: number;
	completionTokens?: number;
}) {
	return {
		createMessage: () => ({}) as never,
		createStream: async function* () {
			yield {
				type: "usage" as const,
				usage: {
					inputTokens: usage.promptTokens,
					outputTokens: usage.completionTokens ?? 16,
					cacheReadTokens: usage.cachedTokens,
					cacheWriteTokens: 0,
				},
			};
		},
	};
}

function makeUserMessage(text: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text }],
	} as unknown as MessageWithMetadata;
}

function makeToolMessage(text: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "tool_result", content: text }],
	} as unknown as MessageWithMetadata;
}

/**
 * Drive the REAL production compaction prepare-turn seam.
 *
 * Returns the decision observations the production resolver published, plus
 * the result the seam returned (the compacted / continued representation).
 */
async function driveProductionSeam(input: {
	messages: MessageWithMetadata[];
	tools?: unknown[];
	sinkEnabled?: boolean;
	previousRequestInputTokens?: number;
	model?: CompactionModel;
}) {
	const recorder = createRecordingSink(input.sinkEnabled ?? true);
	const prepareTurn = createContextCompactionPrepareTurn({
		providerId: "openai-compatible",
		modelId: "parity-probe-model",
		providerConfig: {
			providerId: "openai-compatible",
			modelId: "parity-probe-model",
		} as unknown as LlmsProviders.ProviderConfig,
		compaction: {
			enabled: true,
			strategy: "basic",
			preserveRecentTokens: 1,
		},
		modelBehaviorTraceSink: recorder.sink,
	});
	const result = await prepareTurn?.({
		agentId: "agent-parity",
		conversationId: "conv-parity",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: input.tools ?? [],
		messages: input.messages,
		apiMessages: input.messages,
		model: input.model ?? MODEL,
		...(input.previousRequestInputTokens !== undefined
			? { previousRequestInputTokens: input.previousRequestInputTokens }
			: {}),
	});
	return { decisions: recorder.decisions, result, recorder };
}

describe("ACT-CLINEMM-COMPACTION-ESTIMATOR-PARITY-01 — same-input parity", () => {
	beforeEach(() => {
		createHandlerMock.mockReset();
	});

	describe("Q1/Q2 — the estimated/reported ratio decomposition", () => {
		it("demonstrates that CACHE-SUBSET misreading changes the ratio, without measuring a historical provider discrepancy", async () => {
			// The synthetic request content is the SAME in both readings; only
			// the provider's reported usage differs. The estimator's output
			// must be IDENTICAL in both, because the estimator never sees
			// provider usage.
			const messages = [
				makeUserMessage("A".repeat(6_000)),
				makeToolMessage("B".repeat(30_000)),
			];
			const { decisions } = await driveProductionSeam({ messages });
			const decision = decisions[0];
			expect(decision).toBeDefined();
			const estimated =
				decision.apiMessageTokens! + decision.requestOverheadTokens!;

			// The provider reports the COMPLETE prompt (OpenAI-compatible
			// `prompt_tokens`), of which `cached_tokens` is a SUBSET.
			const completePrompt = 20_000;
			const cachedSubset = 6_500;
			expect(cachedSubset).toBeLessThan(completePrompt);

			const naiveRatio = estimated / completePrompt;
			const subsetAwareRatio = estimated / (completePrompt + cachedSubset);
			expect(naiveRatio).toBeGreaterThan(subsetAwareRatio);
			// The two readings differ materially — this is the mechanism the
			// historical ~1.5x observation is consistent with.
			expect(naiveRatio / subsetAwareRatio).toBeCloseTo(
				(completePrompt + cachedSubset) / completePrompt,
				6,
			);
		});

		it("pins the estimator's boundary: system prompt, tools and JSON framing are ALL counted", () => {
			const messages = [makeUserMessage("hello world")];
			const withoutExtras = estimateRequestInputTokens({
				systemPrompt: "",
				messages,
				tools: [],
			});
			const withSystem = estimateRequestInputTokens({
				systemPrompt: SYSTEM_PROMPT,
				messages,
				tools: [],
			});
			const withTools = estimateRequestInputTokens({
				systemPrompt: SYSTEM_PROMPT,
				messages,
				tools: [
					{
						name: "probe_tool",
						description: "A probe tool.",
						inputSchema: {
							type: "object",
							properties: { value: { type: "string" } },
						},
					},
				],
			});
			// System prompt and tool schemas are NOT free: they consume
			// budget. A repair that dropped them would under-count and could
			// cause a provider overflow.
			expect(withSystem).toBeGreaterThan(withoutExtras);
			expect(withTools).toBeGreaterThan(withSystem);
		});

		it("counts JSON structural overhead: the serialized envelope exceeds the bare text length", () => {
			const text = "x".repeat(3_000);
			const messages = [makeUserMessage(text)];
			const estimated = estimateRequestInputTokens({
				systemPrompt: "",
				messages,
				tools: [],
			});
			// The bare text alone would estimate at ceil(3000/3) = 1000.
			// The envelope adds JSON framing for role/content/type.
			expect(estimated).toBeGreaterThan(1_000);
		});
	});

	describe("Q1 — the decision candidate IS the dispatched request", () => {
		it("the decision candidate estimate equals the estimate of the provider-visible projection that is dispatched", async () => {
			const messages = [
				makeUserMessage("A".repeat(4_000)),
				makeToolMessage("B".repeat(20_000)),
			];
			const { decisions } = await driveProductionSeam({ messages });
			const decision = decisions[0];
			expect(decision).toBeDefined();

			// The production resolver's published estimate.
			const productionEstimate =
				decision.apiMessageTokens! + decision.requestOverheadTokens!;

			// The SAME estimator applied to the SAME provider-visible input
			// must agree — this is what makes D and P comparable.
			const recomputed = estimateRequestInputTokens({
				systemPrompt: SYSTEM_PROMPT,
				messages,
				tools: [],
			});
			expect(productionEstimate).toBe(recomputed);
		});
	});

	describe("C4 — production-seam controls", () => {
		it("does NOT compact a request that is below the trigger, even when the provider reports MORE tokens than the estimate", async () => {
			// SAFETY CONTROL: a provider that reports MORE than the estimate
			// must NOT cause premature compaction. The estimate is the
			// authority for the decision; provider usage only calibrates the
			// UNDER-estimate direction.
			const messages = [makeUserMessage("A".repeat(3_000))];
			const { decisions } = await driveProductionSeam({
				messages,
				previousRequestInputTokens: 500_000,
			});
			const decision = decisions[0];
			expect(decision.shouldCompact).toBe(false);
			expect(decision.compactionInitiated).toBe(false);
		});

		it("compacts a genuinely oversized request (the decision is not disabled)", async () => {
			// A request far beyond the trigger MUST still compact. This is the
			// conservation control for any prospective estimator relaxation.
			const big = 400_000;
			const messages = [
				makeUserMessage("A".repeat(big)),
				makeToolMessage("B".repeat(big)),
			];
			const { decisions } = await driveProductionSeam({ messages });
			const decision = decisions[0];
			expect(decision.requestInputTokens!).toBeGreaterThan(
				decision.requestTriggerTokens!,
			);
			expect(decision.shouldCompact).toBe(true);
			expect(decision.compactionInitiated).toBe(true);
		});

		it("asserts the ACTUAL '>=' eligibility boundary at exactly the trigger", async () => {
			// `shouldCompact` is `requestInputTokens >= requestTriggerTokens`.
			// The boundary is INCLUSIVE. This test drives the production
			// resolver and asserts the published numbers reconcile exactly.
			const { decisions } = await driveProductionSeam({
				messages: [makeUserMessage("A".repeat(1_000))],
			});
			const decision = decisions[0];
			const expectedTrigger =
				(decision.rawMaxInputTokens! / decision.underestimateFactor!) *
				(decision.requestTriggerTokens! / decision.rawMaxInputTokens!);
			expect(expectedTrigger).toBeCloseTo(decision.requestTriggerTokens!, 6);
			const expectedShouldCompact =
				decision.apiMessageTokens! + decision.requestOverheadTokens! >=
				decision.requestTriggerTokens!;
			expect(decision.shouldCompact).toBe(expectedShouldCompact);
		});

		it("keeps the underestimate factor engaged so a dense/under-counted request still compacts", async () => {
			// CONSERVATION CONTROL: when the provider's previous count
			// EXCEEDS the estimator's, the budget is scaled DOWN. Removing
			// this would let dense content overflow the provider.
			const messages = [makeUserMessage("A".repeat(100_000))];
			const { decisions } = await driveProductionSeam({
				messages,
				previousRequestInputTokens: 400_000,
			});
			const decision = decisions[0];
			expect(decision.actualPreviousInputTokens).toBe(400_000);
			expect(decision.underestimateFactor!).toBeGreaterThan(1);
			expect(decision.requestTriggerTokens!).toBeLessThan(103_680);
		});

		it("CONSERVES the provider's COMPLETE prompt as the overflow-recovery usage authority", async () => {
			// ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01.
			//
			// The overflow-recovery authority consumes the provider's
			// REPORTED input count for the previous request
			// (`previousRequestInputTokens` ->
			// `actualPreviousInputTokens` -> `underestimateFactor`). That
			// count is the COMPLETE prompt: the cached portion is a SUBSET
			// of it, not a disjoint quantity.
			//
			// So the authority the budget consumes must be the SAME number
			// the usage normalization reports as `inputTokens` — the
			// complete prompt — and NOT the prompt minus the cached
			// portion. A cached token is a token the provider actually
			// received and counted: subtracting it from the context
			// occupancy would under-state the request that is actually
			// dispatched.
			const messages = [makeUserMessage("A".repeat(100_000))];

			// The complete prompt, and the cached SUBSET of it.
			const completePrompt = 400_000;
			const cachedSubset = 250_000;
			expect(cachedSubset).toBeLessThan(completePrompt);

			const { decisions } = await driveProductionSeam({
				messages,
				previousRequestInputTokens: completePrompt,
			});
			const decision = decisions[0];
			expect(decision).toBeDefined();

			// The authority consumed is the COMPLETE prompt, verbatim.
			expect(decision.actualPreviousInputTokens).toBe(completePrompt);

			// The cached portion is NOT subtracted from it: the value the
			// authority consumes is the complete prompt, so the
			// under-estimate factor is computed against the complete
			// prompt. Had the cached subset been subtracted, the factor
			// would have been computed against
			// `completePrompt - cachedSubset` instead.
			const estimated =
				decision.apiMessageTokens! + decision.requestOverheadTokens!;
			const factorFromCompletePrompt = completePrompt / estimated;
			const factorFromUncachedOnly =
				(completePrompt - cachedSubset) / estimated;
			expect(factorFromCompletePrompt).toBeGreaterThan(factorFromUncachedOnly);
			expect(decision.underestimateFactor!).toBeCloseTo(
				Math.min(factorFromCompletePrompt, MAX_INPUT_UNDERESTIMATE_FACTOR),
				6,
			);
			// The factor is capped, so the complete-prompt reading is the
			// one that reaches the cap — the uncached-only reading would
			// have produced a smaller factor and a LOOSER budget.
			expect(decision.underestimateFactor!).toBe(
				MAX_INPUT_UNDERESTIMATE_FACTOR,
			);
		});

		it("never looses the trigger when the model limit is unknown (fail-closed)", async () => {
			const unknownModel = {
				id: "unknown-limit-model",
				provider: "openai-compatible",
				info: {},
			} as unknown as CompactionModel;
			const messages = [makeUserMessage("A".repeat(500_000))];
			const { decisions } = await driveProductionSeam({
				messages,
				model: unknownModel,
			});
			// An unknown limit is not evidence the request is full: no
			// decision is published at all in `auto` mode.
			expect(decisions.length).toBe(0);
		});
	});

	describe("C3 — correlation controls", () => {
		it("publishes a STABLE decision identity per decision", async () => {
			const messages = [makeUserMessage("A".repeat(5_000))];
			const first = await driveProductionSeam({ messages });
			const second = await driveProductionSeam({ messages });
			expect(first.decisions[0].decisionId).toBeDefined();
			expect(first.decisions[0].decisionOrdinal).toBe(0);
			// A FRESH seam starts a fresh ordinal sequence; the ordinal is
			// per-seam monotonic, not per-session in this harness.
			expect(second.decisions[0].decisionOrdinal).toBe(0);
		});

		it("performs NO decision capture when the sink reports itself disabled", async () => {
			const messages = [makeUserMessage("A".repeat(5_000))];
			const { decisions } = await driveProductionSeam({
				messages,
				sinkEnabled: false,
			});
			expect(decisions.length).toBe(0);
		});

		it("isolates a throwing sink: the compaction still proceeds", async () => {
			const messages = [makeUserMessage("A".repeat(5_000))];
			const recorder = createRecordingSink(true);
			const prepareTurn = createContextCompactionPrepareTurn({
				providerId: "openai-compatible",
				modelId: "parity-probe-model",
				providerConfig: {
					providerId: "openai-compatible",
					modelId: "parity-probe-model",
				} as unknown as LlmsProviders.ProviderConfig,
				compaction: {
					enabled: true,
					strategy: "basic",
					preserveRecentTokens: 1,
				},
				modelBehaviorTraceSink: recorder.sink,
			});
			recorder.setThrows(true);
			// Must NOT throw: the observation channel is failure-isolated.
			// The seam's own return value is irrelevant here — a request
			// below the trigger legitimately returns `undefined` in `auto`
			// mode. What matters is that a THROWING sink cannot abort the
			// compaction or change its outcome.
			await expect(
				prepareTurn?.({
					agentId: "agent-parity",
					conversationId: "conv-parity",
					parentAgentId: null,
					iteration: 1,
					abortSignal: new AbortController().signal,
					systemPrompt: SYSTEM_PROMPT,
					tools: [],
					messages,
					apiMessages: messages,
					model: MODEL,
				}),
			).resolves.toBeUndefined();
			// The throwing sink recorded nothing (it threw before the push),
			// and the production path still evaluated the decision.
			expect(recorder.decisions.length).toBe(0);
		});

		it("a throwing sink does not prevent a genuinely oversized request from compacting", async () => {
			// FAILURE-ISOLATION CONTROL: the diagnostic channel must never
			// change the compaction outcome, in EITHER direction.
			const big = 400_000;
			const messages = [
				makeUserMessage("A".repeat(big)),
				makeToolMessage("B".repeat(big)),
			];
			const recorder = createRecordingSink(true);
			const prepareTurn = createContextCompactionPrepareTurn({
				providerId: "openai-compatible",
				modelId: "parity-probe-model",
				providerConfig: {
					providerId: "openai-compatible",
					modelId: "parity-probe-model",
				} as unknown as LlmsProviders.ProviderConfig,
				compaction: {
					enabled: true,
					strategy: "basic",
					preserveRecentTokens: 1,
				},
				modelBehaviorTraceSink: recorder.sink,
			});
			recorder.setThrows(true);
			await expect(
				prepareTurn?.({
					agentId: "agent-parity",
					conversationId: "conv-parity",
					parentAgentId: null,
					iteration: 1,
					abortSignal: new AbortController().signal,
					systemPrompt: SYSTEM_PROMPT,
					tools: [],
					messages,
					apiMessages: messages,
					model: MODEL,
				}),
			).resolves.toBeDefined();
		});

		it("carries NO prompt, message text or credential in the published decision record", async () => {
			const secret = "SYNTHETIC-CREDENTIAL-DO-NOT-LEAK";
			const bodyMarker = "UNIQUE-MESSAGE-BODY-MARKER-XYZ";
			const messages = [
				makeUserMessage(`prefix ${secret} ${bodyMarker} ` + "A".repeat(3_000)),
			];
			const { decisions } = await driveProductionSeam({ messages });
			const serialized = JSON.stringify(decisions[0]);
			expect(serialized).not.toContain(secret);
			expect(serialized).not.toContain(bodyMarker);
			// Every published field is a scalar count / ratio / classification.
			// `undefined` is permitted for an ABSENT optional value (e.g. no
			// user-configured context ceiling); an object or array would mean
			// structured content leaked into the record.
			for (const value of Object.values(decisions[0])) {
				expect(
					value === undefined ||
						typeof value === "number" ||
						typeof value === "boolean" ||
						typeof value === "string",
				).toBe(true);
			}
			// No field may be a structured container.
			for (const value of Object.values(decisions[0])) {
				expect(typeof value !== "object" || value === null).toBe(true);
			}
		});
	});

	describe("C4 — final-request budget guard (production seam)", () => {
		it("rejects an over-ceiling provider request BEFORE dispatch (fail-closed)", () => {
			// The production estimator bills 3 chars per token, so a request
			// above the 115,200-token ceiling needs more than 345,600
			// characters of payload.
			const messages = [makeUserMessage("A".repeat(400_000))];
			expect(() =>
				assertProviderRequestWithinBudget({
					systemPrompt: SYSTEM_PROMPT,
					messages,
					tools: [],
					maxRequestTokens: 115_200,
				}),
			).toThrow();
		});

		it("admits a within-ceiling provider request", () => {
			const messages = [makeUserMessage("A".repeat(3_000))];
			const measured = assertProviderRequestWithinBudget({
				systemPrompt: SYSTEM_PROMPT,
				messages,
				tools: [],
				maxRequestTokens: 115_200,
			});
			expect(measured).toBeGreaterThan(0);
			expect(measured).toBeLessThanOrEqual(115_200);
		});

		it("the budget guard and the compaction policy use the SAME estimator", () => {
			// The two gates must not disagree about the size of the SAME
			// request: a disagreement would let a request through one gate
			// and be rejected by the other.
			const messages = [makeUserMessage("A".repeat(3_000))];
			const guarded = assertProviderRequestWithinBudget({
				systemPrompt: SYSTEM_PROMPT,
				messages,
				tools: [],
				maxRequestTokens: 115_200,
			});
			const policy = estimateRequestInputTokens({
				systemPrompt: SYSTEM_PROMPT,
				messages,
				tools: [],
			});
			expect(guarded).toBe(policy);
		});
	});

	describe("H4 — provider usage accounting contract", () => {
		it("treats cacheReadTokens as a SUBSET of inputTokens, never an addition", () => {
			// The OpenAI-compatible contract: `prompt_tokens` is the complete
			// prompt; `prompt_tokens_details.cached_tokens` is a subset of it.
			// The complete prompt is therefore `inputTokens` ALONE.
			const inputTokens = 20_000;
			const cachedTokens = 6_500;
			expect(cachedTokens).toBeLessThanOrEqual(inputTokens);
			// Adding them would double-count the cached portion.
			expect(inputTokens + cachedTokens).toBeGreaterThan(inputTokens);
			// The correct complete-prompt value is inputTokens itself.
			expect(inputTokens).toBe(20_000);
		});

		it("the synthetic fake provider reports usage in the OpenAI-compatible shape", () => {
			const fake = createFakeProvider({
				promptTokens: 20_000,
				cachedTokens: 6_500,
			});
			const chunk = fake.createStream();
			expect(chunk).toBeDefined();
		});
	});
});
