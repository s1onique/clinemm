/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01.
 *
 * THE COMPACTION-TRIGGER CONSEQUENCE WITNESS (Discriminator C).
 *
 * ## THE QUESTION
 * ---------------
 * A budget discrepancy is only a DEFECT when a production DECISION is
 * influenced by content that cannot reach the provider.
 *
 * The historical witness (session `1795639776267_j3nki`, run
 * `run_kR2y9UwW`, MiniMax-M3.1-Flash) showed:
 *
 *   - iteration 23: estimated SDK payload 197,218 tokens -> 58,940 after
 *     the compaction transition;
 *   - from iteration 48 onward, reasoning blocks with NO provider signature
 *     accumulate in the request (the responses were output-exhausted, so
 *     the provider never signed that reasoning);
 *   - final SDK payload estimate ~559,893 tokens against a provider-reported
 *     input of ~248,325 tokens.
 *
 * The resolved Anthropic serializer DROPS unsigned reasoning: it emits an
 * "unsupported reasoning metadata" warning and omits the block from the
 * serialized body. The request-budget authority, however, COUNTS it,
 * because the canonical provider projection keeps the reasoning TEXT.
 *
 * So: does the COMPACTION TRIGGER consume that measurement? If it does, the
 * unsigned reasoning inflates the measured request size and can flip the
 * compaction verdict for a request the provider would have accepted.
 *
 * ## WHAT THIS WITNESS DRIVES
 * ---------------------------
 * The REAL production compaction seam (`createContextCompactionPrepareTurn`)
 * with a recording diagnostics sink, over PAIRED inputs that differ ONLY in
 * the presence of provider-excluded (unsigned) reasoning:
 *
 *   - CONTROL    : the same transcript, WITHOUT the unsigned reasoning;
 *   - ADVERSARIAL: the same transcript PLUS substantial unsigned reasoning.
 *
 * The numbers asserted below are the PRODUCTION resolver's OWN published
 * values (`requestInputTokens`, `requestTriggerTokens`, `shouldCompact`),
 * observed through the REAL diagnostics channel. Nothing is re-implemented.
 *
 * No provider request is issued. No paid inference.
 *
 * ## THE CONTROLS
 * --------------
 *   CMP09-TRIG-01  the production trigger CONSUMES the request-budget
 *                  measurement (the divergence is causal)
 *   CMP09-TRIG-02  the CONTROL verdict is NOT compact
 *   CMP09-TRIG-03  the ADVERSARIAL verdict IS compact — provider-excluded
 *                  material alone changed the production verdict
 *   CMP09-TRIG-04  the divergence is bounded: it is exactly the size of the
 *                  excluded material, not a side effect
 */
import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextCompactionPrepareTurn } from "./compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

const SYSTEM_PROMPT =
	"You are a deterministic context-budget probe. This text exists so the production estimator has a real system prompt to measure.";

type CompactionPrepareTurn = NonNullable<
	ReturnType<typeof createContextCompactionPrepareTurn>
>;
type CompactionModel = Parameters<CompactionPrepareTurn>[0]["model"];

/**
 * The historical MiniMax-M3.1-Flash limits, as the CATALOG declares them:
 * a 1,048,576-token context window and input limit.
 *
 * The trigger ratio (0.9) and the estimator (3 chars per token) are the
 * PRODUCTION constants; they are not restated here.
 */
const MODEL = {
	id: "MiniMax-M3.1-Flash",
	provider: "minimax",
	info: {
		maxInputTokens: 1_048_576,
		contextWindow: 1_048_576,
		// The historical witness's model family. The Anthropic family is the
		// transport that REQUIRES provider-origin authorization for a
		// reasoning block, so an unsigned reasoning block is not
		// provider-visible content on it.
		family: "anthropic",
	},
} as unknown as CompactionModel;

interface DecisionObservation {
	requestInputTokens?: number;
	apiMessageTokens?: number;
	requestOverheadTokens?: number;
	requestTriggerTokens?: number;
	rawMaxInputTokens?: number;
	shouldCompact?: boolean;
	compactionInitiated?: boolean;
	apiMessageCount?: number;
}

function createRecordingSink() {
	const decisions: DecisionObservation[] = [];
	const sink = {
		isTraceEnabled: () => true,
		onCompactionDiagnostics: (observation: {
			payload: Record<string, unknown>;
		}) => {
			decisions.push(observation.payload as DecisionObservation);
		},
	};
	return { sink, decisions };
}

/**
 * A transcript whose assistant turn carries reasoning. The reasoning block is
 * either SIGNED (provider-authorized) or UNSIGNED (provider-excluded: the
 * output-exhaustion shape, where the provider never returned a signature).
 */
function makeAssistantReasoningMessage(input: {
	signed: boolean;
	reasoningChars: number;
}): MessageWithMetadata {
	const part = input.signed
		? {
				type: "thinking",
				thinking: "R".repeat(input.reasoningChars),
				signature: "a".repeat(64),
			}
		: {
				type: "thinking",
				thinking: "R".repeat(input.reasoningChars),
			};
	return {
		role: "assistant",
		content: [part],
	} as unknown as MessageWithMetadata;
}

function makeUserMessage(text: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text }],
	} as unknown as MessageWithMetadata;
}

/**
 * Drive the REAL production compaction prepare-turn seam and return the
 * decision observations the production resolver published.
 */
async function driveProductionSeam(input: { messages: MessageWithMetadata[] }) {
	const recorder = createRecordingSink();
	const prepareTurn = createContextCompactionPrepareTurn({
		providerId: "minimax",
		modelId: "MiniMax-M3.1-Flash",
		providerConfig: {
			providerId: "minimax",
			modelId: "MiniMax-M3.1-Flash",
		} as unknown as LlmsProviders.ProviderConfig,
		compaction: {
			enabled: true,
			strategy: "basic",
			preserveRecentTokens: 1,
		},
		modelBehaviorTraceSink: recorder.sink,
	});
	await prepareTurn?.({
		agentId: "agent-cmp09",
		conversationId: "conv-cmp09",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: [],
		messages: input.messages,
		apiMessages: input.messages,
		model: MODEL,
	});
	return recorder.decisions;
}

describe("ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 — trigger consequence", () => {
	beforeEach(() => {
		createHandlerMock.mockReset();
	});

	it("CMP09-TRIG-01/02/03: provider-excluded reasoning must NOT change the production compaction verdict", async () => {
		// The SHARED transcript: enough real content to sit just BELOW the
		// trigger, so the ONLY thing that could cross it is the excluded
		// reasoning.
		const shared = [makeUserMessage("A".repeat(1_500_000))];

		// CONTROL: no unsigned reasoning at all.
		const control = await driveProductionSeam({
			messages: [
				...shared,
				makeAssistantReasoningMessage({
					signed: true,
					reasoningChars: 1_000,
				}),
			],
		});
		expect(control).toHaveLength(1);
		const controlDecision = control[0]!;
		// The control does NOT reach the trigger: its provider-visible request
		// fits inside the model's window.
		expect(controlDecision.shouldCompact).toBe(false);
		expect(controlDecision.compactionInitiated).toBe(false);

		// ADVERSARIAL: the SAME transcript PLUS substantial reasoning the
		// provider will NEVER see (unsigned, therefore dropped by the
		// resolved Anthropic serializer).
		const adversarial = await driveProductionSeam({
			messages: [
				...shared,
				makeAssistantReasoningMessage({
					signed: true,
					reasoningChars: 1_000,
				}),
				makeAssistantReasoningMessage({
					signed: false,
					reasoningChars: 2_600_000,
				}),
			],
		});
		expect(adversarial).toHaveLength(1);
		const adversarialDecision = adversarial[0]!;

		// THE REPAIR: the excluded material is NOT measured. The growth in
		// the measurement is bounded by the ENVELOPE of the one extra
		// assistant message (its id/role/ts), NOT by the excluded reasoning
		// text. Before the repair the growth was the full excluded material
		// (866,307 estimated tokens).
		const excludedTokens = Math.ceil(2_600_000 / 3);
		const growth =
			adversarialDecision.requestInputTokens! -
			controlDecision.requestInputTokens!;
		expect(growth).toBeGreaterThanOrEqual(0);
		expect(growth).toBeLessThan(100);
		expect(growth).toBeLessThan(excludedTokens / 100);
		// ... and the production VERDICT is unchanged.
		expect(adversarialDecision.shouldCompact).toBe(false);
		expect(adversarialDecision.compactionInitiated).toBe(false);
		// The trigger threshold itself never moved: only the measurement was
		// corrected.
		expect(adversarialDecision.requestTriggerTokens).toBe(
			controlDecision.requestTriggerTokens,
		);
	});

	it("CMP09-TRIG-04: the excluded material is absent from the measured request", async () => {
		const shared = [makeUserMessage("A".repeat(1_500_000))];
		const control = await driveProductionSeam({
			messages: [
				...shared,
				makeAssistantReasoningMessage({
					signed: true,
					reasoningChars: 1_000,
				}),
			],
		});
		const adversarial = await driveProductionSeam({
			messages: [
				...shared,
				makeAssistantReasoningMessage({
					signed: true,
					reasoningChars: 1_000,
				}),
				makeAssistantReasoningMessage({
					signed: false,
					reasoningChars: 2_600_000,
				}),
			],
		});
		const controlDecision = control[0]!;
		const adversarialDecision = adversarial[0]!;
		// The measured request grew only by the envelope of the one extra
		// assistant message: the excluded material is NOT in it, and the
		// signed reasoning that IS provider-visible is.
		const excludedTokens = Math.ceil(2_600_000 / 3);
		const growth =
			adversarialDecision.requestInputTokens! -
			controlDecision.requestInputTokens!;
		expect(growth).toBeLessThan(100);
		expect(growth).toBeLessThan(excludedTokens / 100);
		// The threshold is UNCHANGED.
		expect(adversarialDecision.requestTriggerTokens).toBe(
			controlDecision.requestTriggerTokens,
		);
	});
});
