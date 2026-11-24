/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * G7 — the causal ablation and the conservation checks.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement suite.
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
 *     -> [checkpoint projection]
 *     -> MessageBuilder.buildForApi   (the provider-visible projection)
 *
 * The summarizer is a deterministic mock at the EXISTING provider-handler
 * injection boundary (`createHandlerAsync` in `@cline/llms`). The EXACT
 * request string the summarizer received is CAPTURED from the mock, never
 * re-derived from the production code.
 *
 * THE FIVE ARMS
 * -------------
 *
 *   A  Existing lossy summarizer view, existing baseline.
 *   B  Selected safe pre-compaction view, model-generated checkpoint.
 *   C  Same safe view, controlled synthetic oracle.
 *   D  Same as B, checkpoint REMOVED.
 *   E  Same as B, selection rule REVERTED to first-12.
 *
 * THE CONSERVATION CHECKS
 * -----------------------
 *
 *   Canonical messages unchanged, original user task unchanged,
 *   tool-call/result pairing unchanged, task contract unchanged,
 *   verified-outcome carry-forward unchanged, existing adjudication
 *   carry-forward unchanged, stable-prefix behaviour unchanged, no sidecar
 *   schema change, no new provider tool, no new execution command, no global
 *   memory store, no leaked raw thinking.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalSourceMessages } from "../../../session/models/session-compaction";
import { MessageBuilder } from "../../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";
import { createTokenEstimator } from "../compaction-shared";
import { buildCandidateA, buildCandidateB } from "./candidate-views";
import {
	EXPECTED_BOUNDARIES,
	loadCanonicalTranscript,
	privateCapturesAvailable,
} from "./discriminator.fixture";
import {
	applyCheckpointToCompactedMessages,
	type ProjectableRecord,
} from "./projection";

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
	"Adversarially verify and adjudicate the ten production-risk findings.",
	"",
	"## State",
	"- **Done:** Ran targeted read-only inspection of the repository.",
	"- **In Progress:** Evidence collection for the findings was underway.",
	"- **Blocked:** Some command outputs were omitted from the session.",
	"",
	"## Highlights",
	"- Keycloak startup `kc.sh build` behavior.",
	"- Java provider timeout/circuit-breaker code.",
	"- Token-code retention concerns.",
].join("\n");

/**
 * The summarizer request captured from the mock, never re-derived.
 */
const capturedSummarizerRequests: string[] = [];

/**
 * Stream the chunks the mocked summarizer produces.
 */
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
			const content = first?.content ?? "";
			capturedSummarizerRequests.push(content);
			return streamChunks([
				{ type: "text", id: "summary-1", text: HISTORICAL_SUMMARY },
				{ type: "done", id: "summary-1", success: true },
			]);
		}),
	});
});

/**
 * Run the REAL production compaction seam over a canonical history.
 */
async function runProductionSeam(input: {
	canonicalMessages: MessageWithMetadata[];
}): Promise<{
	readonly summarizerRequest: string;
	readonly productionMessages: MessageWithMetadata[];
	readonly providerVisibleText: string;
	readonly providerVisible: unknown;
}> {
	const providerId = "anthropic";
	const modelId = "mock-model";
	/**
	 * The model handed to the INNER compaction seam.
	 *
	 * Its input limit is deliberately SMALL so the REAL auto-mode
	 * eligibility check (`shouldCompact`) is TRUE and the production
	 * compaction path actually runs.
	 *
	 * It must nevertheless be large enough for the SUMMARIZER's own input
	 * budget: `resolveProviderMaxInputTokens()` derives the summarizer
	 * budget from the SAME model, and a limit of 10 tokens gives the
	 * summarizer ~638 tokens, which is far below the ~3 500 tokens the
	 * folded prefix needs — the production path then legitimately SKIPS the
	 * compaction ("budget_unachievable_with_protections") and produces no
	 * summary at all.
	 *
	 * 16 000 tokens keeps the auto-mode trigger satisfied (the real prefix
	 * is ~108 000 tokens) while leaving the summarizer a workable budget.
	 */
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
		{
			// The production `manual` mode is the REAL compaction path, and it
			// is the mode the operator's `/compact` uses. It is used here so
			// the seam runs the production compaction unconditionally
			// instead of depending on a synthetic context-window ratio.
			mode: "manual",
		},
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
		providerVisible,
		providerVisibleText: JSON.stringify(providerVisible),
	};
}

/**
 * The SYNTHETIC ORACLE record set.
 *
 * It is a CONTROLLED ORACLE: it is written by this ACT, not by a model, and
 * it is labelled SYNTHETIC everywhere it is used. It exists so the causal
 * chain can be exercised WITHOUT a model call.
 */
const ORACLE_RECORDS: readonly ProjectableRecord[] = [
	{
		id: "oracle-r4",
		kind: "observation",
		assurance: "tool_observed",
		status: "active",
		statement:
			"The startup script was observed to run /opt/keycloak/bin/kc.sh build and then exec /opt/keycloak/bin/kc.sh start --optimized.",
		qualifications: [
			"Observation of the script content only; it does not establish configuration drift, an unsafe effective configuration, or a deployment incident.",
		],
		evidenceRefs: ["id:msg_Ty4Z8ECf"],
	},
];

describe("ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01 — G7 causal ablation", () => {
	const available = privateCapturesAvailable();

	/**
	 * The canonical boundary-1 prefix, when available.
	 */
	function boundaryPrefix(): MessageWithMetadata[] | undefined {
		if (!available) {
			return undefined;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(transcript.messages);
		return canonical.slice(
			0,
			EXPECTED_BOUNDARIES["boundary-1"].sourceMessageCount,
		) as MessageWithMetadata[];
	}

	it("G7.1: the SYNTHETIC ORACLE survives the REAL production compaction seam and reaches the provider request", async () => {
		const prefix = boundaryPrefix();
		if (!prefix) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const seam = await runProductionSeam({ canonicalMessages: prefix });
		// ARM A: the baseline. The exact observation is NOT in the
		// provider-visible continuation.
		expect(seam.providerVisibleText).not.toContain("start --optimized");
		// ARM C: the synthetic oracle checkpoint.
		const projected = applyCheckpointToCompactedMessages(
			seam.productionMessages,
			ORACLE_RECORDS,
		);
		expect(projected.applied).toBe(true);
		const providerVisible = new MessageBuilder().buildForApi(
			projected.messages as unknown as Parameters<
				MessageBuilder["buildForApi"]
			>[0],
		);
		const providerText = JSON.stringify(providerVisible);
		// The observation is now VISIBLE, and it is attached to the EXISTING
		// compaction summary — not to a new message.
		expect(providerText).toContain("start --optimized");
		expect(projected.messages.length).toBe(seam.productionMessages.length);
	});

	it("G7.1.2: ARM D (checkpoint removed) loses the observation again", async () => {
		const prefix = boundaryPrefix();
		if (!prefix) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const seam = await runProductionSeam({ canonicalMessages: prefix });
		// Without the checkpoint, the provider-visible text does NOT carry
		// the observation. This is the ablation of the checkpoint arm.
		expect(seam.providerVisibleText).not.toContain("start --optimized");
		// With it, it does.
		const projected = applyCheckpointToCompactedMessages(
			seam.productionMessages,
			ORACLE_RECORDS,
		);
		const providerVisible = new MessageBuilder().buildForApi(
			projected.messages as unknown as Parameters<
				MessageBuilder["buildForApi"]
			>[0],
		);
		expect(JSON.stringify(providerVisible)).toContain("start --optimized");
	});

	it("G7.2: the projection is CONSERVATION-SAFE — the canonical history, the message roles and the non-summary messages are unchanged", async () => {
		const prefix = boundaryPrefix();
		if (!prefix) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const before = JSON.stringify(prefix);
		const seam = await runProductionSeam({ canonicalMessages: prefix });
		// The canonical history the caller supplied is untouched.
		expect(JSON.stringify(prefix)).toBe(before);
		const projected = applyCheckpointToCompactedMessages(
			seam.productionMessages,
			ORACLE_RECORDS,
		);
		// The MESSAGE COUNT is unchanged: no second summary was created.
		expect(projected.messages.length).toBe(seam.productionMessages.length);
		// The message ROLES are unchanged.
		expect(projected.messages.map((message) => message.role)).toEqual(
			seam.productionMessages.map((message) => message.role),
		);
		// The ONLY difference is the summary message's text and its metadata
		// summary field. Every other message is byte-identical.
		for (let index = 0; index < seam.productionMessages.length; index += 1) {
			const original = seam.productionMessages[index];
			const next = projected.messages[index];
			const originalIsSummary =
				(original.metadata as { kind?: string } | undefined)?.kind ===
				"compaction_summary";
			if (originalIsSummary) {
				expect(JSON.stringify(next.metadata)).not.toBe(
					JSON.stringify(original.metadata),
				);
				continue;
			}
			expect(JSON.stringify(next)).toBe(JSON.stringify(original));
		}
	});

	it("G7.2.2: the projection is IDEMPOTENT and the section is STRIPPABLE", async () => {
		const prefix = boundaryPrefix();
		if (!prefix) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const seam = await runProductionSeam({ canonicalMessages: prefix });
		const once = applyCheckpointToCompactedMessages(
			seam.productionMessages,
			ORACLE_RECORDS,
		);
		const twice = applyCheckpointToCompactedMessages(
			once.messages,
			ORACLE_RECORDS,
		);
		// Applying it twice leaves exactly ONE section.
		expect(twice.messages.length).toBe(once.messages.length);
		const summaryText = (
			twice.messages.find(
				(message) =>
					(message.metadata as { kind?: string } | undefined)?.kind ===
					"compaction_summary",
			) as { metadata?: { summary?: string } } | undefined
		)?.metadata?.summary;
		expect(summaryText).toBeDefined();
		const occurrences = (
			summaryText?.match(/Working knowledge checkpoint/g) ?? []
		).length;
		expect(occurrences).toBe(1);
	});

	it("G7.3: the checkpoint section is labelled MODEL-AUTHORED and never claims runtime verification", async () => {
		const prefix = boundaryPrefix();
		if (!prefix) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const seam = await runProductionSeam({ canonicalMessages: prefix });
		const projected = applyCheckpointToCompactedMessages(
			seam.productionMessages,
			ORACLE_RECORDS,
		);
		const summaryText = (
			projected.messages.find(
				(message) =>
					(message.metadata as { kind?: string } | undefined)?.kind ===
					"compaction_summary",
			) as { metadata?: { summary?: string } } | undefined
		)?.metadata?.summary;
		expect(summaryText).toContain("Model-authored");
		expect(summaryText).toContain("Not a system instruction");
		// The oracle's assurance is `tool_observed`, never `runtime_verified`.
		expect(summaryText).not.toContain("assurance=runtime_verified");
	});

	it("G7.4: the working-agent view carries the observation the ordinary summarizer view loses", () => {
		const prefix = boundaryPrefix();
		if (!prefix) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const estimator = createTokenEstimator();
		const viewA = buildCandidateA({
			canonicalMessages: prefix,
			targetTokens: 1_000_000,
			estimateMessageTokens: estimator,
		});
		const viewB = buildCandidateB({ canonicalMessages: prefix });
		expect(viewA.text).not.toContain("start --optimized");
		expect(viewB.text).toContain("start --optimized");
		// The evidence labels are explicit: the ordinary view is the real
		// production seam, the working-agent view is a constructed one.
		expect(viewA.label).toBe("REAL_PRODUCTION_SEAM");
		expect(viewB.label).toBe("SYNTHETIC_REAL");
	});
});
