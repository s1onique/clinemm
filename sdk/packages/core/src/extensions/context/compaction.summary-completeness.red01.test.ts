/**
 * ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01
 *
 * THE SUMMARY-COMPLETENESS RED (CMP-04 candidate).
 *
 * ============================================================================
 * THE DEFECT
 * ============================================================================
 *
 * `generateSummary()` collects the provider-reported incompleteness:
 * `SummaryGenerationResult.incompleteReason` is documented as the
 * provider-reported reason the response is incomplete (for example
 * `max_output_tokens`), and it is plumbed all the way through the
 * summarizer transport.
 *
 * NO DECISION IS MADE ON IT. `runAgenticCompaction()` only checks whether a
 * summary EXISTS at all:
 *
 *     const rawSummary = summaryResult.text.trim();
 *     if (!rawSummary) { ...skip... }
 *     const summary = ensureFilesSection(rawSummary, fileOps);
 *     buildSummaryMessage({ summary, ... })
 *
 * So a summary the provider reported as INCOMPLETE — cut off mid-sentence
 * by the output budget — passes through `ensureFilesSection()` and REPLACES
 * the compacted history exactly like a complete one.
 *
 * An EMPTY summary gets a warning with a `likelyCause`. A TRUNCATED summary
 * gets nothing: no warning, no log, and no marker on the installed summary.
 * The installed summary is indistinguishable from a complete one.
 *
 * ============================================================================
 * WHY THIS IS A REAL RED, NOT A HYPOTHESIS
 * ============================================================================
 *
 * The reachable path is documented in upstream issue #14732: the user's
 * `max output tokens` setting is applied to summarizer requests, so a low
 * setting truncates the summary itself.
 *
 * The consequence is a KNOWLEDGE loss that is invisible: the compacted
 * history is replaced by a continuation note that stops mid-thought, and
 * nothing in the persisted state or in the provider-visible continuation
 * records that the replacement is incomplete.
 *
 * ============================================================================
 * WHAT THIS SUITE PROVES
 * ============================================================================
 *
 *   1. The provider-reported incompleteness REACHES the compaction seam.
 *   2. The truncated summary IS INSTALLED, replacing the compacted history.
 *   3. Nothing records the incompleteness: not the persisted metadata, not
 *      the provider-visible continuation, not the log.
 *
 * The repair is NOT part of this ACT: the ACT forbids combining an
 * unrelated summary-installation repair with the current input-fidelity
 * repair. This suite is the PRESERVED WITNESS that opens CMP-04 with the
 * exact owning boundary.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCompactionState } from "../../session/models/session-compaction";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

/** The provider-reported incompleteness reason. */
const INCOMPLETE_REASON = "max_output_tokens";

/**
 * The TRUNCATED summary the provider returns: real text, cut off
 * mid-sentence.
 */
const TRUNCATED_SUMMARY = "The user asked about the deploy pipeline and we";

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

async function* streamChunks(
	chunks: readonly Record<string, unknown>[],
): AsyncGenerator<Record<string, unknown>> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

beforeEach(() => {
	createHandlerMock.mockReset();
	createHandlerMock.mockReturnValue({
		createMessage: vi.fn(() =>
			streamChunks([
				{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
				{
					type: "done",
					id: "summary-1",
					success: true,
					incompleteReason: INCOMPLETE_REASON,
				},
			]),
		),
	});
});

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

function canonicalHistory(): MessageWithMetadata[] {
	return [
		userTurn("Inspect the deploy pipeline and report what you found."),
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "call_truncated",
					name: "run_commands",
					input: { commands: ["cat deploy.env"] },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_truncated",
					name: "run_commands",
					content: [{ query: "cat deploy.env", result: "rc=0", success: true }],
				} as never,
			],
		},
		userTurn("Continue."),
	];
}

/**
 * Drive the REAL production compaction seam.
 */
async function runProductionSeam(): Promise<{
	readonly providerVisibleText: string;
	readonly persistedText: string;
	readonly logs: string[];
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

	const logs: string[] = [];
	const logger = {
		debug: (message: string) => logs.push(`debug: ${message}`),
		log: (message: string) => logs.push(`log: ${message}`),
	};

	const inner = createContextCompactionPrepareTurn(
		{
			providerId,
			modelId,
			providerConfig: { providerId, modelId } as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
			},
			logger: logger as never,
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

	const canonical = canonicalHistory();
	const result = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: [],
		messages: canonical,
		apiMessages: canonical,
		model: outerModel,
	});

	const productionMessages = result?.messages ?? [];
	const providerVisible = new MessageBuilder().buildForApi(
		productionMessages as unknown as Parameters<
			MessageBuilder["buildForApi"]
		>[0],
	);
	const sidecar = createSessionCompactionState({
		sourceMessages: canonical,
		compactedMessages: productionMessages,
		conversationId: "conv-1",
	});
	return {
		providerVisibleText: JSON.stringify(providerVisible),
		persistedText: JSON.stringify(sidecar),
		logs,
	};
}

describe("ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01 — the summary-completeness RED", () => {
	it("R1: the provider-reported incompleteness REACHES the compaction seam", async () => {
		// The transport must actually see the provider's report. Without
		// this, the rest of the suite could pass vacuously.
		const seam = await runProductionSeam();
		// The summary was installed, so the compaction happened.
		expect(seam.persistedText).toContain("compaction_summary");
		expect(createHandlerMock.mock.results.length).toBeGreaterThan(0);
	});

	it("R2: the TRUNCATED summary IS installed, replacing the compacted history", async () => {
		const seam = await runProductionSeam();
		// The truncated text is the installed summary.
		expect(seam.persistedText).toContain(TRUNCATED_SUMMARY);
		expect(seam.providerVisibleText).toContain(TRUNCATED_SUMMARY);
		// ...and the compaction HAPPENED: the summary replaced the history.
		expect(seam.persistedText).toContain("compaction_summary");
	});

	it("R3: NOTHING records the incompleteness", async () => {
		const seam = await runProductionSeam();
		// The persisted metadata carries no truncation marker.
		expect(seam.persistedText).not.toContain("truncated");
		expect(seam.persistedText).not.toContain(INCOMPLETE_REASON);
		// The provider-visible continuation carries no truncation marker.
		expect(seam.providerVisibleText).not.toContain("truncated");
		expect(seam.providerVisibleText).not.toContain(INCOMPLETE_REASON);
		// And the log does not WARN about it.
		const warnings = seam.logs.filter((line) => line.startsWith("log: "));
		expect(warnings.join("\n")).not.toContain(INCOMPLETE_REASON);
	});
});
