/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
 *
 * G2 — the RED witness for the REAL production seam.
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * The predecessor demonstrated that a TEST-LOCAL checkpoint can be projected
 * safely. This witness demonstrates that the REAL production path does not
 * YET perform that behaviour:
 *
 *   createCompactionStateAwarePrepareTurn
 *     -> createContextCompactionPrepareTurn({ strategy: "agentic" })
 *     -> runAgenticCompaction
 *        -> buildAgenticSummaryInputBudget -> buildBudgetProjection
 *        -> serializeConversation -> buildSummaryRequest
 *        -> generateSummary   (mocked at the EXISTING provider-handler
 *                              boundary, `createHandlerAsync` in @cline/llms)
 *     -> applyTaskContractToCompactedMessages
 *     -> applyVerifiedEvidenceToCompactedMessages
 *     -> createSessionCompactionState      (the REAL persistence builder)
 *     -> MessageBuilder.buildForApi        (the REAL provider projection)
 *
 * The assertion requires the provider-visible continuation to contain an
 * accepted, closed working-knowledge section. Against the UNCHANGED
 * production implementation this assertion FAILS, and the failure
 * establishes:
 *
 *   ACTUAL COMPACTION EXECUTED
 *   ORDINARY SUMMARY PRODUCED
 *   TASK CONTRACT PRESERVED
 *   CHECKPOINT SECTION ABSENT
 *
 * The RED is ISOLATED: it is a SEPARATE file with its own vitest config, so
 * the intentionally failing assertion never enters the default suite. The
 * GREEN companion is `pck-production-seam.test.ts`.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "../../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

/**
 * The summary the mocked summarizer returns.
 *
 * It reproduces the HISTORICAL summarizer behaviour: it keeps the TOPIC and
 * drops the exact operational detail.
 */
const HISTORICAL_SUMMARY = [
	"## Goal",
	"Inspect the deployment configuration and report the working knowledge.",
	"",
	"## State",
	"- **Done:** Ran a read-only inspection of the deployment directory.",
].join("\n");

const capturedSummarizerRequests: string[] = [];

async function* streamChunks(
	chunks: readonly Record<string, unknown>[],
): AsyncGenerator<Record<string, unknown>> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

beforeEach(() => {
	capturedSummarizerRequests.length = 0;
	createHandlerMock.mockReset();
	createHandlerMock.mockReturnValue({
		createMessage: vi.fn((_systemPrompt: string, messages: unknown[]) => {
			const first = messages[0] as { content?: string } | undefined;
			capturedSummarizerRequests.push(first?.content ?? "");
			return streamChunks([
				{ type: "text", id: "summary-1", text: HISTORICAL_SUMMARY },
				{ type: "done", id: "summary-1", success: true },
			]);
		}),
	});
});

/**
 * The synthetic R4/R2/R6-style canonical history.
 *
 * It is FULLY SYNTHETIC: no real session, no real repository, no real
 * credential.
 */
export function syntheticCanonicalHistory(): MessageWithMetadata[] {
	const messages: MessageWithMetadata[] = [
		{
			role: "user",
			id: "msg_task",
			content: "Inspect the deployment configuration and report findings.",
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_call",
			content: [
				{
					type: "tool_use",
					id: "tool_call_r4",
					name: "run_commands",
					input: { command: "kc.sh build" },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: "tool_call_r4",
					content: [
						{
							query: "kc.sh build",
							result: "build completed",
							success: true,
						},
					],
				},
			],
		} as unknown as MessageWithMetadata,
	];
	for (let index = 0; index < 40; index += 1) {
		messages.push({
			role: "user",
			id: `msg_pad_${index}`,
			content: `padding ${index} ${"x".repeat(400)}`,
		} as unknown as MessageWithMetadata);
		messages.push({
			role: "assistant",
			id: `msg_pad_a_${index}`,
			content: `padding reply ${index} ${"y".repeat(400)}`,
		} as unknown as MessageWithMetadata);
	}
	return messages;
}

/**
 * Run the REAL production compaction seam over a canonical history.
 */
export async function runProductionSeam(input: {
	canonicalMessages: MessageWithMetadata[];
}): Promise<{
	readonly summarizerRequest: string;
	readonly productionMessages: MessageWithMetadata[];
	readonly providerVisibleText: string;
}> {
	const providerId = "anthropic";
	const modelId = "mock-model";
	const innerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 16_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];
	const outerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 128_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];

	const inner = createContextCompactionPrepareTurn(
		{
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
		},
		{ mode: "manual" },
	);

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
	const providerVisible = new MessageBuilder().buildForApi(
		productionMessages as unknown as Parameters<
			MessageBuilder["buildForApi"]
		>[0],
	);
	return {
		summarizerRequest: capturedSummarizerRequests.at(-1) ?? "",
		productionMessages,
		providerVisibleText: JSON.stringify(providerVisible),
	};
}

describe("ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01 — G2 RED", () => {
	it("G2.2: the REAL production path does NOT yet carry a closed working-knowledge section", async () => {
		const history = syntheticCanonicalHistory();
		const seam = await runProductionSeam({ canonicalMessages: history });

		// (1) ACTUAL COMPACTION EXECUTED: the summarizer request was
		// actually captured at the provider boundary.
		expect(seam.summarizerRequest.length).toBeGreaterThan(0);
		// (2) ORDINARY SUMMARY PRODUCED: a compaction summary exists.
		const summary = seam.productionMessages.find(
			(message) =>
				(message.metadata as { kind?: string } | undefined)?.kind ===
				"compaction_summary",
		);
		expect(summary).toBeDefined();
		// (3) TASK CONTRACT PRESERVED: the task contract section is present
		// in the persisted, provider-visible continuation.
		expect(seam.providerVisibleText).toContain("Active task contract");

		// (4) CHECKPOINT SECTION ABSENT — the production gap this ACT
		// closes. This assertion FAILS against the unchanged production
		// implementation.
		expect(seam.providerVisibleText).toContain("Working knowledge checkpoint");
	});
});
