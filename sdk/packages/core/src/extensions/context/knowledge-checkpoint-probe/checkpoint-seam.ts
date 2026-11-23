/**
 * ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
 *
 * TEST-LOCAL harness that drives the REAL production compaction seam.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API.
 * ============================================================================
 *
 * THE SEAM THAT IS DRIVEN
 * -----------------------
 *
 *   createCompactionStateAwarePrepareTurn
 *     -> createContextCompactionPrepareTurn({ strategy: "agentic" })
 *     -> runAgenticCompaction
 *        -> buildAgenticSummaryInputBudget -> buildBudgetProjection
 *        -> serializeConversation -> buildSummaryRequest
 *        -> generateSummary   (mocked at the provider-handler boundary)
 *     -> applyTaskContractToCompactedMessages
 *     -> applyVerifiedEvidenceToCompactedMessages
 *     -> MessageBuilder.buildForApi   (the provider-visible projection)
 *
 * The summarizer is a deterministic mock at the EXISTING provider-handler
 * injection boundary (`createHandlerAsync` in `@cline/llms`). The EXACT
 * request string the summarizer received is CAPTURED from the mock, never
 * re-derived from the production code.
 *
 * The checkpoint projection is applied AFTER the production carry-forwards
 * and BEFORE the provider projection, which is exactly where a production
 * checkpoint seam would sit.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { MessageBuilder } from "../../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";
import { applyCheckpointToCompactedMessages } from "./checkpoint-projection";
import type { WorkingKnowledgeRecord } from "./checkpoint-schema";

/**
 * The captured summarizer request and the produced continuation.
 */
export interface SeamRunResult {
	/** The EXACT request string the production summarizer received. */
	readonly summarizerRequest: string;
	/** The messages the production compaction produced (pre-projection). */
	readonly productionMessages: readonly MessageWithMetadata[];
	/** The messages after the checkpoint projection. */
	readonly projectedMessages: readonly MessageWithMetadata[];
	/** The provider-visible projection of the projected messages. */
	readonly providerVisible: unknown;
	/** The provider-visible TEXT of the provider projection. */
	readonly providerVisibleText: string;
	/** Whether the checkpoint projection was applied. */
	readonly checkpointApplied: boolean;
	/** The number of accepted records carried. */
	readonly carriedRecordCount: number;
}

/**
 * The mocked provider handler factory, injected by the caller.
 */
export type HandlerMockFactory = (handlerConfig: unknown) => {
	createMessage: (
		systemPrompt: string,
		messages: unknown[],
	) => AsyncGenerator<Record<string, unknown>>;
};

/**
 * The EXACT request string the production summarizer sent to the provider.
 *
 * It is set by the mock handler installed by the caller, and it is never
 * re-derived from the production code.
 */
export const capturedSummarizerRequests: string[] = [];

/** Reset the captured requests between runs. */
export function resetCapturedRequest(): void {
	capturedSummarizerRequests.length = 0;
}

/**
 * Install a capture hook on a mocked handler factory.
 *
 * The hook records the FIRST user message's content, which is the exact
 * request string the production summarizer built.
 */
export function installRequestCapture(
	factory: HandlerMockFactory,
): HandlerMockFactory {
	return (handlerConfig: unknown) => {
		const handler = factory(handlerConfig);
		const original = handler.createMessage.bind(handler);
		return {
			createMessage: async function* (
				systemPrompt: string,
				messages: unknown[],
			) {
				const first = messages[0] as { content?: string } | undefined;
				capturedSummarizerRequests.push(first?.content ?? "");
				yield* original(systemPrompt, messages);
			},
		};
	};
}

/**
 * Drive the REAL production compaction seam over a canonical history.
 */
export async function runProductionCompactionSeam(input: {
	canonicalMessages: MessageWithMetadata[];
	acceptedRecords: readonly WorkingKnowledgeRecord[];
	createHandler: HandlerMockFactory;
	providerId?: string;
	modelId?: string;
}): Promise<SeamRunResult> {
	const providerId = input.providerId ?? "anthropic";
	const modelId = input.modelId ?? "mock-model";
	/**
	 * The model handed to the INNER compaction seam.
	 *
	 * The input limit is deliberately tiny so the REAL auto-mode eligibility
	 * check (`shouldCompact`) is TRUE and the production compaction path
	 * actually runs. The summarizer budget then falls back to
	 * `MIN_AGENTIC_SUMMARY_INPUT_TOKENS`, which is ample for these
	 * fixtures.
	 */
	const innerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 10 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];
	/**
	 * The model handed to the OUTER state-aware seam.
	 *
	 * It describes the real operating budget, so the request-budget guard
	 * and the published working-context estimate see a realistic ceiling.
	 */
	const outerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 128_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];

	const inner = createContextCompactionPrepareTurn({
		providerId,
		modelId,
		providerConfig: {
			providerId,
			modelId,
		} as LlmsProviders.ProviderConfig,
		compaction: {
			enabled: true,
			strategy: "agentic",
			preserveRecentTokens: 1,
		},
		logger: undefined,
	});

	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: (context) =>
			inner?.({ ...context, model: innerModel }) ?? Promise.resolve(undefined),
		getState: () => undefined,
		prepareApiMessages: async (messages) => messages,
		saveState: () => undefined,
	});

	const result = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: "You are a helpful coding assistant.",
		tools: [],
		messages: input.canonicalMessages,
		apiMessages: input.canonicalMessages,
		model: outerModel,
	});

	const productionMessages = result?.messages ?? [];
	const projected = applyCheckpointToCompactedMessages(
		productionMessages,
		input.acceptedRecords,
	);
	const providerVisible = new MessageBuilder().buildForApi(
		projected.messages as unknown as Parameters<
			MessageBuilder["buildForApi"]
		>[0],
	);
	return {
		summarizerRequest: capturedSummarizerRequests.at(-1) ?? "",
		productionMessages,
		projectedMessages: projected.messages,
		providerVisible,
		providerVisibleText: JSON.stringify(providerVisible),
		checkpointApplied: projected.applied,
		carriedRecordCount: projected.carriedRecordCount,
	};
}
