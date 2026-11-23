/**
 * ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01
 *
 * Production-seam RED for the loss of a PREVIOUSLY ESTABLISHED, QUALIFIED
 * ADJUDICATION across ClineMM context compaction.
 *
 * THE HISTORICAL INCIDENT (Round C session `1795394987994_fpu77`)
 * -----------------------------------------------------------------
 *
 * The session audited Keycloak findings R1-R10 (read-only, frozen subject
 * revision `42de653b59708e712d694aeb9732f822b7f8fe5b`). Before the first
 * compaction boundary (36->37, covered canonical prefix 0..73) the model
 * established THREE source-grounded adjudications:
 *
 *   R8  canonical idx 28 — bootstrap-admin credential EXPOSURE is
 *       `CONFIRMED` as an observation; whether the credential is CURRENTLY
 *       VALID/usable is CONDITIONAL and was never established.
 *   R7  canonical idx 40 — Java-test execution deficiency is `CONFIRMED`
 *       at the OBSERVATION level; the severity may be narrowed.
 *   R3  canonical idx 64 — pool-budget risk is `NARROWED`: 36 x 11 = 396 is
 *       <= the documented budget of 400, so the remaining risk is a MANUAL
 *       process with no AUTOMATED enforcement.
 *
 * All three were lost at the 36->37 boundary and never reappeared in the
 * 62->63 summary. The behavioural consequence is observable in the
 * canonical record: R7 was re-listed as still outstanding at canonical idx
 * 154 and re-verified.
 *
 * THE HISTORICAL SHAPE (measured, not invented)
 * ----------------------------------------------
 *
 * Each of the three witness messages carries EXACTLY TWO content blocks:
 *
 *   [ { type: "thinking", thinking: "<the adjudication>" },
 *     { type: "tool_use",  id: "call_...", name: "run_commands", ... } ]
 *
 * There is NO `text` block. The adjudication therefore lives ONLY in the
 * `thinking` block. The canonical `thinking` block lengths are 1231
 * (idx 28), 981 (idx 40) and 1387 (idx 64) characters — all BELOW the
 * 2000-character `truncateText` window that `serializeMessage()` applies to
 * a thinking block. So the loss is NOT a truncation-window loss: the
 * adjudication would have survived serialization intact.
 *
 * THE CAUSAL DISCRIMINATOR (measured from the captured production artifacts)
 * -------------------------------------------------------------------------
 *
 * The seven captured summarizer requests of run `cap_41f75c5386d5db78`
 * (the three subject-session captures are #1/#2/#3 by the capture's own
 * `timestamp` field: 2026-11-23T01:02:12.706Z, T01:14:57.428Z,
 * T01:32:30.273Z) each contain ZERO `[Bot thinking]` markers and ZERO
 * occurrences of any R3/R7/R8 adjudication phrase. The R8/R7/R3
 * adjudications were therefore removed BEFORE the summarizer request was
 * built.
 *
 * The production mechanism is `buildBudgetProjection()` with
 * `policyIntent: "agentic_summary"`, whose policy sets
 * `dropThinkingBlocks: true`. `buildBudgetProjection()` DROPS EVERY
 * `thinking` BLOCK from the summarizer input, unconditionally, BEFORE any
 * budget arithmetic is applied. It is a SOURCE-SELECTION loss (discriminator
 * case A), upstream of `serializeConversation()`.
 *
 * `serializeMessage()`'s `truncateText(block.thinking, 2_000)` is a
 * RED HERRING for this incident: the thinking blocks are removed before the
 * serializer ever sees them. This suite measures both positions
 * independently (RED-3) so the two candidate mechanisms are not confused.
 *
 * WHAT THIS FILE DOES
 * -------------------
 *
 * It drives the REAL production seam
 *
 *   createCompactionStateAwarePrepareTurn
 *     -> createContextCompactionPrepareTurn({ strategy: "agentic" })
 *     -> runAgenticCompaction
 *        -> buildAgenticSummaryInputBudget -> buildBudgetProjection
 *        -> serializeConversation -> buildSummaryRequest
 *        -> generateSummary (MOCKED at the provider handler boundary)
 *     -> applyTaskContractToCompactedMessages
 *     -> applyVerifiedEvidenceToCompactedMessages
 *     -> MessageBuilder.buildForApi   (the provider-visible projection)
 *
 * and asserts on the OBSERVED output of those production functions. The
 * summarizer is a deterministic mock at the EXISTING provider-handler
 * injection boundary (`createHandlerAsync` in `@cline/llms`), and the EXACT
 * request string it received is captured from the mock, never re-derived.
 *
 * This is a `SYNTHETIC_REAL` reproduction: it exercises real production
 * functions with synthetic, non-sensitive content. It is NOT a live model
 * reproduction and proves nothing about how a live model would respond.
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * Every finding, number, path and phrase in this file is SYNTHETIC. No
 * credential, secret, private source content, historical prompt, canonical
 * transcript body or provider payload is reproduced here.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "../../session/services/message-builder";
import { buildBudgetProjection } from "./budget-projection";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";
import { serializeConversation } from "./compaction-shared";
import {
	MAX_CARRIED_OUTCOMES,
	SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED,
} from "./evidence-continuity";

type FakeChunk = Record<string, unknown>;

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

async function* streamChunks(chunks: FakeChunk[]): AsyncGenerator<FakeChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

/**
 * The EXACT request string the production summarizer sent to the provider.
 *
 * Captured from the mocked provider handler — the existing summarizer
 * injection boundary — and never re-derived from the production code.
 */
let capturedSummarizerRequest = "";

/**
 * The summary the mocked summarizer returns.
 *
 * The default reproduces the HISTORICAL summarizer behaviour: the real
 * summarizer never saw the thinking blocks, so it could not carry the
 * adjudications, and its `## Blocked` section truthfully reported that the
 * outputs were omitted. This mock is a faithful stand-in for a summarizer
 * with the same (defective) input window.
 */
const HISTORICAL_SUMMARY = [
	"## Goal",
	"Adversarially falsify the synthetic findings S1-S3.",
	"",
	"## State",
	"- **Done:** Ran targeted read-only inspection of the synthetic repository.",
	"- **In Progress:** Mapping collected evidence to S1-S3.",
	"- **Blocked:** Some outputs were omitted from the transcript, so final " +
		"verdicts cannot yet be made.",
].join("\n");

let summarizerOutput = HISTORICAL_SUMMARY;

beforeEach(() => {
	capturedSummarizerRequest = "";
	summarizerOutput = HISTORICAL_SUMMARY;
	createHandlerMock.mockReset();
	createHandlerMock.mockReturnValue({
		createMessage: vi.fn((_systemPrompt: string, messages: unknown[]) => {
			const first = messages[0] as { content?: string } | undefined;
			capturedSummarizerRequest = first?.content ?? "";
			return streamChunks([
				{ type: "text", id: "summary-1", text: summarizerOutput },
				{ type: "done", id: "summary-1", success: true },
			]);
		}),
	});
});

/**
 * A deliberately small input limit so the REAL auto-mode eligibility check
 * (`shouldCompact`) is TRUE and the production compaction path actually
 * runs. The summarizer budget falls back to
 * `MIN_AGENTIC_SUMMARY_INPUT_TOKENS`, which is ample for these fixtures.
 */
const MODEL = {
	id: "mock-model",
	provider: "anthropic",
	info: { id: "mock-model", maxInputTokens: 10 },
} as const;

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

// ---------------------------------------------------------------------------
// The synthetic witness finding S1.
//
// Mirrors the historical R3 shape: a user-defined finding, a source-read
// tool call with a matching tool result, and a model-authored qualified
// adjudication supported by that result. Every string is synthetic.
// ---------------------------------------------------------------------------

const FINDING_ID = "S1";

/** The original user-defined allegation. */
const ORIGINAL_CLAIM =
	"No automated limit protects a configured resource budget.";

/** The source-grounded observation the adjudication rests on. */
const SOURCE_OBSERVATION =
	"The configuration contains a per-worker limit of 36.";

/** The counterevidence that narrows the original claim. */
const COUNTEREVIDENCE =
	"With 11 workers, total capacity is 396, which is below the documented " +
	"budget of 400.";

/**
 * The qualified adjudication itself.
 *
 * The qualification ("the remaining risk is missing automatic enforcement
 * when scaling") is load-bearing: a preservation mechanism that carries only
 * the verdict word, without the qualification, does NOT satisfy the
 * contract.
 */
const ADJUDICATION =
	"NARROWED — the specific configuration is within budget; the remaining " +
	"risk is missing automatic enforcement when scaling.";

/** The question the adjudication leaves open. */
const REMAINING_QUESTION = "Whether any automated enforcement exists.";

/**
 * The DECISION-RELEVANT tokens of the adjudication.
 *
 * A preservation mechanism must carry BOTH the verdict token AND the
 * qualification. The assertions below check the verdict token and the
 * qualification token separately, so a mechanism that carries only one of
 * them is detected as a partial preservation rather than a full one.
 */
const VERDICT_TOKEN = "NARROWED";
const QUALIFICATION_TOKEN = "missing automatic enforcement";

/**
 * The exact tool call id of the source-read tool call. It matches the
 * `tool_use_id` of the matching tool result, so the call/result PAIR is
 * preserved exactly as the production runtime emits it.
 */
const SOURCE_CALL_ID = "call_s1_source_read_0001";

/**
 * The synthetic source-read tool result payload.
 *
 * The PRODUCTION runtime shape of a `run_commands` result is an array of
 * untyped `{query, result, success}` entries. The shared message contract
 * types the result content as typed blocks, so the structured array is
 * projected through the same explicit boundary the production runtime uses.
 */
const SOURCE_RESULT_PAYLOAD = [
	{
		query: "grep -n 'maxWorkers' synthetic-pool-config.yaml",
		result: "maxWorkers: 36\ndocumentedBudget: 400",
		success: true,
	},
];

// ---------------------------------------------------------------------------
// Canonical-message builders.
// ---------------------------------------------------------------------------

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

function assistantText(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

/**
 * An assistant turn that carries the adjudication in a THINKING block.
 *
 * This is the historical shape: the witness messages carried exactly a
 * `thinking` block plus a `tool_use` block, and NO `text` block.
 */
function assistantThinkingWithToolCall(
	thinking: string,
	toolUseId: string,
	toolName: string,
	input: Record<string, unknown>,
): MessageWithMetadata {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking },
			{ type: "tool_use", id: toolUseId, name: toolName, input },
		],
	};
}

/**
 * An assistant turn that carries the adjudication in a TEXT block.
 *
 * Used by RED-3 as the control position: ordinary assistant text IS
 * eligible for summarization.
 */
function assistantTextWithToolCall(
	text: string,
	toolUseId: string,
	toolName: string,
	input: Record<string, unknown>,
): MessageWithMetadata {
	return {
		role: "assistant",
		content: [
			{ type: "text", text },
			{ type: "tool_use", id: toolUseId, name: toolName, input },
		],
	};
}

function toolResult(
	toolUseId: string,
	name: string,
	content: unknown,
	options: { isError?: boolean } = {},
): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				name,
				content,
				...(options.isError ? { is_error: true } : {}),
			},
		] as MessageWithMetadata["content"] extends Array<infer T> ? T[] : never,
	};
}

/**
 * A later SUCCESSFUL tool call, used to push earlier outcomes out of the
 * 12-outcome continuity budget.
 */
function laterSuccessfulCall(index: number): MessageWithMetadata[] {
	const callId = `call_later_${index}`;
	return [
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: callId,
					name: "run_commands",
					input: { commands: `synthetic-probe-${index}` },
				},
			],
		},
		toolResult(callId, "run_commands", [
			{
				query: `synthetic-probe-${index}`,
				result: `synthetic-probe-${index} ok`,
				success: true,
			},
		]),
	];
}

/**
 * The PROVIDER-VISIBLE text of the installed continuation.
 *
 * This is the text the MODEL actually receives after the task-contract and
 * verified-evidence carry-forwards have been applied.
 */
function installedContinuationText(messages: MessageWithMetadata[]): string {
	return messages
		.flatMap((message) =>
			Array.isArray(message.content)
				? message.content
						.filter(
							(block): block is { type: "text"; text: string } =>
								block.type === "text" &&
								typeof (block as { text?: unknown }).text === "string",
						)
						.map((block) => block.text)
				: [],
		)
		.join("\n");
}

/**
 * Drive the REAL production state-aware compaction seam and return the
 * installed continuation representation plus the captured summarizer
 * request.
 *
 * `createCompactionStateAwarePrepareTurn` is the production seam that
 * applies the task-contract carry-forward AND the verified-evidence
 * carry-forward, and then publishes the provider-visible working context.
 * The `compact` callback is the REAL
 * `createContextCompactionPrepareTurn({ strategy: "agentic" })` seam, so the
 * summarizer request and the generated summary are the production ones.
 */
async function runStateAwareCompactionAndCapture(input: {
	canonicalMessages: MessageWithMetadata[];
}): Promise<{
	request: string;
	installedMessages: MessageWithMetadata[];
	providerVisibleText: string;
}> {
	const inner = createContextCompactionPrepareTurn({
		providerId: "anthropic",
		modelId: "mock-model",
		providerConfig: {
			providerId: "anthropic",
			modelId: "mock-model",
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
			inner?.({ ...context, model: MODEL }) ?? Promise.resolve(undefined),
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
		systemPrompt: SYSTEM_PROMPT,
		tools: [],
		messages: input.canonicalMessages,
		apiMessages: input.canonicalMessages,
		model: {
			id: "mock-model",
			provider: "anthropic",
			info: { id: "mock-model", maxInputTokens: 128_000 },
		} as unknown as typeof MODEL,
	});

	const installedMessages = result?.messages ?? [];

	// The PROVIDER-VISIBLE projection: the production `MessageBuilder`
	// renders the installed continuation into the form the provider receives.
	// This is the last production transformation before dispatch.
	const providerVisible = new MessageBuilder().buildForApi(
		installedMessages as unknown as Parameters<
			MessageBuilder["buildForApi"]
		>[0],
	);

	return {
		request: capturedSummarizerRequest,
		installedMessages,
		providerVisibleText: JSON.stringify(providerVisible),
	};
}

/**
 * The canonical pre-compaction history for the synthetic finding S1.
 *
 * The shape mirrors the historical session exactly:
 *
 *   - a user turn carrying the original finding,
 *   - an assistant turn whose THINKING block carries the qualified
 *     adjudication, together with the source-read tool call,
 *   - the matching source-read tool result,
 *   - N later successful tool calls (to move the earlier outcome out of the
 *     12-outcome continuity budget),
 *   - a trailing assistant turn (the preserved tail).
 */
function s1CanonicalHistory(options: {
	laterCallCount?: number;
	adjudicationPlacement?: "thinking" | "text";
	thinkingPrefix?: string;
} = {}): MessageWithMetadata[] {
	const laterCallCount = options.laterCallCount ?? 0;
	const placement = options.adjudicationPlacement ?? "thinking";
	const thinkingPrefix = options.thinkingPrefix ?? "";

	const adjudicationThinking = `${thinkingPrefix}${ADJUDICATION}\n\n` +
		`Remaining question: ${REMAINING_QUESTION}`;

	const sourceReadTurn =
		placement === "thinking"
			? assistantThinkingWithToolCall(
					adjudicationThinking,
					SOURCE_CALL_ID,
					"run_commands",
					{ commands: "grep -n 'maxWorkers' synthetic-pool-config.yaml" },
				)
			: assistantTextWithToolCall(
					adjudicationThinking,
					SOURCE_CALL_ID,
					"run_commands",
					{ commands: "grep -n 'maxWorkers' synthetic-pool-config.yaml" },
				);

	const messages: MessageWithMetadata[] = [
		userTurn(
			`Finding ${FINDING_ID}: ${ORIGINAL_CLAIM} ` +
				`Source observation: ${SOURCE_OBSERVATION} ` +
				`Counterevidence: ${COUNTEREVIDENCE}`,
		),
		sourceReadTurn,
		toolResult(SOURCE_CALL_ID, "run_commands", SOURCE_RESULT_PAYLOAD),
	];

	for (let index = 0; index < laterCallCount; index += 1) {
		messages.push(...laterSuccessfulCall(index));
	}

	// The preserved tail.
	messages.push(assistantText("Continuing the synthetic investigation."));

	return messages;
}

describe("ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01 — production-seam RED", () => {
	// -------------------------------------------------------------------------
	// RED-1 — the qualified adjudication disappears across compaction.
	// -------------------------------------------------------------------------
	it("RED-1 (RED): the source-grounded qualified adjudication is present in canonical history and absent from the provider-visible continuation", async () => {
		const canonicalMessages = s1CanonicalHistory();

		// PRECONDITION (M0): the adjudication IS in the canonical history.
		// This is what makes the later absence a LOSS rather than an
		// adjudication that was never established.
		const canonicalText = JSON.stringify(canonicalMessages);
		expect(canonicalText).toContain(ADJUDICATION);
		expect(canonicalText).toContain(VERDICT_TOKEN);
		expect(canonicalText).toContain(QUALIFICATION_TOKEN);
		// The source evidence the adjudication rests on is also present.
		expect(canonicalText).toContain(SOURCE_OBSERVATION);

		const { request, providerVisibleText, installedMessages } =
			await runStateAwareCompactionAndCapture({ canonicalMessages });

		// The summarizer really ran and really received an input window.
		expect(request.length).toBeGreaterThan(0);

		// M1/M2/M3: the adjudication must reach the ACTUAL summarizer
		// request. The request string is captured from the mocked provider
		// handler, so this is the real production request.
		expect(request).toContain(VERDICT_TOKEN);
		expect(request).toContain(QUALIFICATION_TOKEN);

		// M5/M6: the adjudication must remain available to the agent in the
		// final provider-visible continuation.
		const installedText = installedContinuationText(installedMessages);
		expect(installedText).toContain(VERDICT_TOKEN);
		expect(installedText).toContain(QUALIFICATION_TOKEN);
		expect(providerVisibleText).toContain(VERDICT_TOKEN);
		expect(providerVisibleText).toContain(QUALIFICATION_TOKEN);
	});

	// -------------------------------------------------------------------------
	// RED-2 — the old adjudication falls outside the outcome continuity
	// budget.
	// -------------------------------------------------------------------------
	it("RED-2 (RED): the qualified adjudication is absent from the provider-visible continuation once more than 12 later verified outcomes exist", async () => {
		const canonicalMessages = s1CanonicalHistory({ laterCallCount: 20 });

		const canonicalText = JSON.stringify(canonicalMessages);
		expect(canonicalText).toContain(ADJUDICATION);

		const { installedMessages, providerVisibleText } =
			await runStateAwareCompactionAndCapture({ canonicalMessages });

		// The outcome budget is the production constant; the fixture pushes
		// MORE than that many later verified outcomes so the early
		// adjudication cannot be carried by the outcome section.
		expect(20).toBeGreaterThan(MAX_CARRIED_OUTCOMES);

		const installedText = installedContinuationText(installedMessages);

		// The verdict AND its qualification must both be present.
		expect(installedText).toContain(VERDICT_TOKEN);
		expect(installedText).toContain(QUALIFICATION_TOKEN);
		expect(providerVisibleText).toContain(VERDICT_TOKEN);
		expect(providerVisibleText).toContain(QUALIFICATION_TOKEN);
	});

	// -------------------------------------------------------------------------
	// RED-3 — the thinking serialization boundary.
	//
	// Three positions for an otherwise EQUIVALENT adjudication:
	//   (a) inside the first 2000 characters of a thinking block,
	//   (b) beyond the 2000-character truncation boundary of a thinking
	//       block,
	//   (c) in ordinary assistant text that is eligible for summarization.
	//
	// The three positions discriminate the two candidate mechanisms:
	// the budget projection's `dropThinkingBlocks` (source selection) and
	// `serializeMessage()`'s `truncateText(block.thinking, 2_000)`
	// (serialization truncation).
	// -------------------------------------------------------------------------
	it("RED-3 (RED): a thinking-block adjudication at any position cannot reach the summarizer, while the same adjudication in assistant text can", async () => {
		const insideThinking = s1CanonicalHistory({
			adjudicationPlacement: "thinking",
			thinkingPrefix: "",
		});
		const beyondThinking = s1CanonicalHistory({
			adjudicationPlacement: "thinking",
			thinkingPrefix: "x".repeat(2_500),
		});
		const asText = s1CanonicalHistory({ adjudicationPlacement: "text" });

		// (a) INSIDE the 2000-character window.
		const inside = await runStateAwareCompactionAndCapture({
			canonicalMessages: insideThinking,
		});
		// (b) BEYOND the 2000-character window.
		const beyond = await runStateAwareCompactionAndCapture({
			canonicalMessages: beyondThinking,
		});
		// (c) ORDINARY assistant text.
		const text = await runStateAwareCompactionAndCapture({
			canonicalMessages: asText,
		});

		// CONTROL: the ordinary-text position DOES reach the summarizer.
		// This proves the summarizer seam is live and that the loss is
		// specific to the thinking-block position, not to the harness.
		expect(text.request).toContain(ADJUDICATION);

		// The RED: neither thinking-block position reaches the summarizer.
		// The candidate mechanism is therefore the budget projection's
		// `dropThinkingBlocks` (source selection), NOT the 2000-character
		// truncation window — because position (a), which is INSIDE the
		// window, is lost exactly like position (b).
		expect(inside.request).toContain(ADJUDICATION);
		expect(beyond.request).toContain(ADJUDICATION);

		// The boundary is exercised explicitly: the serializer WOULD carry
		// the inside-window text if the block survived the projection.
		const serializedInside = serializeConversation(insideThinking);
		expect(serializedInside).toContain(ADJUDICATION);
		expect(serializedInside).toContain("[Bot thinking]");

		// ... and the beyond-window text is truncated by the serializer.
		const serializedBeyond = serializeConversation(beyondThinking);
		expect(serializedBeyond).not.toContain(ADJUDICATION);
		expect(serializedBeyond).toContain("[truncated ");
	});

	// -------------------------------------------------------------------------
	// RED-4 — the adjudication versus the original allegation.
	//
	// The task contract carries the ORIGINAL finding forward. Its presence
	// alone does NOT satisfy adjudication continuity: the LATER qualified
	// decision is what must be preserved.
	// -------------------------------------------------------------------------
	it("RED-4 (RED): the original finding survives in the task contract while its later qualified decision does not", async () => {
		const canonicalMessages = s1CanonicalHistory();

		const { installedMessages, providerVisibleText } =
			await runStateAwareCompactionAndCapture({ canonicalMessages });

		const installedText = installedContinuationText(installedMessages);

		// The ORIGINAL allegation is preserved (the task contract carries
		// it). This is the control that shows task-contract presence is
		// NOT sufficient.
		expect(installedText).toContain(ORIGINAL_CLAIM);

		// The LATER QUALIFIED DECISION must also be present, with its
		// qualification.
		expect(installedText).toContain(VERDICT_TOKEN);
		expect(installedText).toContain(QUALIFICATION_TOKEN);
		expect(providerVisibleText).toContain(VERDICT_TOKEN);
		expect(providerVisibleText).toContain(QUALIFICATION_TOKEN);
	});

	// -------------------------------------------------------------------------
	// RED-5 — the historical shape.
	//
	// The production seam is driven with the ACTUAL supported canonical
	// block shapes: paired tool calls/results, a thinking-only adjudication
	// turn, later verified outcomes, and the established compaction
	// strategy.
	// -------------------------------------------------------------------------
	it("RED-5 (RED): the historical shape loses the adjudication at the source-selection boundary, upstream of serialization", async () => {
		const canonicalMessages = s1CanonicalHistory({ laterCallCount: 3 });

		// The historical shape: the adjudication turn carries a thinking
		// block and a tool_use block, and NO text block.
		const adjudicationTurn = canonicalMessages[1];
		const blockTypes = (
			adjudicationTurn.content as Array<{ type: string }>
		).map((block) => block.type);
		expect(blockTypes).toEqual(["thinking", "tool_use"]);

		// The tool call/result PAIR is preserved exactly.
		const callId = (
			adjudicationTurn.content as Array<{ type: string; id?: string }>
		).find((block) => block.type === "tool_use")?.id;
		expect(callId).toBe(SOURCE_CALL_ID);
		const resultId = (
			canonicalMessages[2].content as Array<{
				type: string;
				tool_use_id?: string;
			}>
		).find((block) => block.type === "tool_result")?.tool_use_id;
		expect(resultId).toBe(SOURCE_CALL_ID);

		// The budget projection is the production function that performs
		// the source selection. Driven DIRECTLY with the production
		// `agentic_summary` intent, it removes the thinking block.
		const projection = buildBudgetProjection({
			messages: canonicalMessages as MessageWithMetadata[],
			targetTokens: 100_000,
			policyIntent: "agentic_summary",
			estimateMessageTokens: () => 1,
		});
		const projectedText = JSON.stringify(projection.messages);
		expect(projectedText).not.toContain(ADJUDICATION);
		expect(projectedText).not.toContain("[Bot thinking]");

		// ... while the SAME projection with the `normal_provider_request`
		// intent KEEPS the thinking block. This is the controlled
		// comparison that isolates the loss to the compaction-specific
		// source-selection policy, with identical canonical input.
		const providerProjection = buildBudgetProjection({
			messages: canonicalMessages as MessageWithMetadata[],
			targetTokens: 100_000,
			policyIntent: "normal_provider_request",
			estimateMessageTokens: () => 1,
		});
		expect(JSON.stringify(providerProjection.messages)).toContain(ADJUDICATION);

		// And the full production seam loses it too.
		const { request, installedMessages } =
			await runStateAwareCompactionAndCapture({ canonicalMessages });
		expect(request).toContain(VERDICT_TOKEN);
		expect(installedContinuationText(installedMessages)).toContain(
			QUALIFICATION_TOKEN,
		);
	});
});
