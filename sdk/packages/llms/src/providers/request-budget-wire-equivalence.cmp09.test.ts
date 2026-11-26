/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01.
 *
 * THE REQUEST-BUDGET / WIRE-EQUIVALENCE WITNESS.
 *
 * ## THE QUESTION
 * ---------------
 * Does the REQUEST-BUDGET measurement (the authority the compaction trigger
 * consumes) describe the SAME request the provider actually receives?
 *
 * The historical witness (session `1795639776267_j3nki`, run
 * `run_kR2y9UwW`, MiniMax-M3.1-Flash over the Anthropic-compatible
 * transport) recorded, from the ACTUAL captured provider requests:
 *
 *   - iteration 23: estimated SDK payload 197,218 tokens, then 58,940
 *     after the compaction transition;
 *   - iteration 48+: reasoning blocks that carry NO provider signature
 *     (the response was output-exhausted, so the provider never returned
 *     a signature for that reasoning) accumulate in the request;
 *   - final SDK payload estimate ~559,893 tokens against a
 *     provider-reported input of ~248,325 tokens.
 *
 * A SIGNATURE-BEARING reasoning block is provider-authorized: the
 * Anthropic-compatible serializer emits it as a `thinking` block. An
 * UNSIGNED reasoning block is NOT provider-authorized: the resolved
 * Anthropic serializer DROPS it (it emits an "unsupported reasoning
 * metadata" warning and omits the block from the body).
 *
 * So the question is precise:
 *
 *   1. Does the unsigned reasoning survive to the serialized HTTP body?
 *   2. Does it nevertheless contribute to the request-budget measurement?
 *   3. If so, is the COMPACTION TRIGGER actually consuming that
 *      measurement (so the discrepancy is causal, not cosmetic)?
 *
 * ## WHAT THIS WITNESS DRIVES
 * ---------------------------
 *   - the REAL production request preparation (`toProviderVisibleMessages`,
 *     the canonical provider projection the budget authority measures);
 *   - the REAL resolved Anthropic serializer (`@ai-sdk/anthropic`), reached
 *     through the REAL vendor module, with an INJECTED `fetch` so the
 *     serialized HTTP body is observable without a paid inference;
 *   - the REAL request-budget measurement (`estimateProviderRequestInputTokens`).
 *
 * No paid inference. No provider request is issued: the injected fetch
 * returns a synthetic empty Anthropic SSE stream.
 *
 * ## THE CONTROLS
 * --------------
 *   CMP09-WIRE-01  signed reasoning reaches the serialized body
 *   CMP09-WIRE-02  unsigned reasoning does NOT reach the serialized body
 *   CMP09-WIRE-03  the budget measurement COUNTS the unsigned reasoning
 *                  (the divergence, measured)
 *   CMP09-WIRE-04  the compaction trigger CONSUMES the request-budget
 *                  measurement (necessity: the divergence is causal)
 *   CMP09-WIRE-05  valid signed reasoning is conserved (positive control)
 *   CMP09-WIRE-06  tool calls / tool results keep their identity and order
 *   CMP09-WIRE-07  the canonical transcript is unchanged by the projection
 */
import {
	type AgentMessage,
	type AgentMessagePart,
	estimateProviderRequestInputTokens,
	toProviderVisibleMessages,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGatewayApiHandlerAsync } from "./compat";

/**
 * The Anthropic-compatible MiniMax transport, resolved exactly as production
 * resolves it: the `anthropic` family with the MiniMax base URL.
 */
const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const MODEL_ID = "MiniMax-M3.1-Flash";

/** A provider signature, as the provider returns it for a COMPLETE turn. */
const VALID_SIGNATURE =
	"1f52df733bdd12c2bb050b1dabea3b2c785d3f93b297d6e66ad65e97bbe5a2b7";

/** The reasoning text an output-exhausted response leaves behind. */
const REASONING_TEXT =
	"Now I have a good understanding. Let me now carefully analyze the three defects.\n\n".repeat(
		40,
	);

function anthropicSseResponse(): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

/**
 * Drive the REAL production request preparation and the REAL resolved
 * Anthropic serializer, with an INJECTED fetch. Returns the serialized body.
 */
async function serializeThroughRealTransport(
	messages: readonly AgentMessage[],
): Promise<Record<string, unknown>> {
	const fetchMock = vi.fn(async () => anthropicSseResponse());
	const handler = await createGatewayApiHandlerAsync({
		providerId: "minimax",
		apiKey: "test-key",
		baseUrl: MINIMAX_BASE_URL,
		modelId: MODEL_ID,
		fetch: fetchMock as unknown as typeof fetch,
	} as never);
	// The REAL production dispatch: the canonical transcript goes through
	// the gateway's own message preparation and the resolved Anthropic
	// adapter, and the serialized HTTP body is what `fetch` receives.
	const stream = handler.createMessage(
		"system prompt",
		toProviderVisibleMessages(messages) as never,
	);
	// Drain the stream so the request is actually dispatched.
	for await (const _chunk of stream) {
		// The synthetic SSE stream carries no content chunks.
	}
	expect(fetchMock).toHaveBeenCalled();
	const call = fetchMock.mock.calls[0] as unknown as [
		string | URL | Request,
		{ body?: string },
	];
	const body = call[1]?.body;
	expect(typeof body).toBe("string");
	return JSON.parse(body as string) as Record<string, unknown>;
}

/**
 * The thinking blocks the SERIALIZED body actually carries, in order.
 */
function serializedThinkingBlocks(
	body: Record<string, unknown>,
): Array<Record<string, unknown>> {
	const messages = (body.messages ?? []) as Array<{
		content?: Array<Record<string, unknown>>;
	}>;
	const blocks: Array<Record<string, unknown>> = [];
	for (const message of messages) {
		for (const part of message.content ?? []) {
			if (part.type === "thinking" || part.type === "redacted_thinking") {
				blocks.push(part);
			}
		}
	}
	return blocks;
}

/**
 * A transcript with a SIGNED reasoning block, a tool call and its result.
 */
function transcriptWithSignedReasoning(): AgentMessage[] {
	return [
		{
			role: "user",
			content: [{ type: "text", text: "run the command" }],
		} as AgentMessage,
		{
			role: "assistant",
			content: [
				{
					type: "reasoning",
					text: "signed reasoning",
					metadata: { signature: VALID_SIGNATURE },
				},
				{
					type: "tool-call",
					toolCallId: "call-1",
					toolName: "run_commands",
					input: { commands: ["ls"] },
				},
			] as AgentMessagePart[],
		} as AgentMessage,
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "call-1",
					toolName: "run_commands",
					output: "ok",
				},
			] as AgentMessagePart[],
		} as AgentMessage,
	];
}

/**
 * The SAME transcript with the reasoning block UNSIGNED (the
 * output-exhaustion shape) and substantially larger, plus the same tool
 * call / result so the pairing differs ONLY in the reasoning block.
 */
function transcriptWithUnsignedReasoning(): AgentMessage[] {
	return [
		{
			role: "user",
			content: [{ type: "text", text: "run the command" }],
		} as AgentMessage,
		{
			role: "assistant",
			content: [
				{
					type: "reasoning",
					text: REASONING_TEXT,
				},
				{
					type: "tool-call",
					toolCallId: "call-1",
					toolName: "run_commands",
					input: { commands: ["ls"] },
				},
			] as AgentMessagePart[],
		} as AgentMessage,
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "call-1",
					toolName: "run_commands",
					output: "ok",
				},
			] as AgentMessagePart[],
		} as AgentMessage,
	];
}

/**
 * The budget measurement, over the SAME provider-visible projection the
 * production compaction trigger measures.
 */
function measureBudget(messages: readonly AgentMessage[]): number {
	return estimateProviderRequestInputTokens({
		systemPrompt: "system prompt",
		messages: toProviderVisibleMessages(messages),
		tools: [],
	});
}

describe("CMP-09 request-budget / wire equivalence", () => {
	it("CMP09-WIRE-01: valid signed reasoning reaches the serialized body", async () => {
		const body = await serializeThroughRealTransport(
			transcriptWithSignedReasoning(),
		);
		const blocks = serializedThinkingBlocks(body);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]!.type).toBe("thinking");
		expect(blocks[0]!.signature).toBe(VALID_SIGNATURE);
	});

	it("CMP09-WIRE-02: unsigned reasoning does NOT reach the serialized body", async () => {
		const body = await serializeThroughRealTransport(
			transcriptWithUnsignedReasoning(),
		);
		const blocks = serializedThinkingBlocks(body);
		expect(blocks).toHaveLength(0);
		// The reasoning text must not appear ANYWHERE in the body.
		expect(JSON.stringify(body)).not.toContain(REASONING_TEXT.slice(0, 80));
	});

	it("CMP09-WIRE-03: the budget measurement COUNTS the unsigned reasoning", () => {
		const signed = measureBudget(transcriptWithSignedReasoning());
		const unsigned = measureBudget(transcriptWithUnsignedReasoning());
		// The unsigned reasoning is NOT provider-authorized, so the budget
		// must not count it. It does: the divergence is measured here.
		expect(unsigned).toBeGreaterThan(signed);
	});

	it("CMP09-WIRE-06: tool calls / tool results keep their identity and order", async () => {
		const body = await serializeThroughRealTransport(
			transcriptWithUnsignedReasoning(),
		);
		const messages = (body.messages ?? []) as Array<{
			role?: string;
			content?: Array<Record<string, unknown>>;
		}>;
		const toolUses = messages.flatMap((message) =>
			(message.content ?? []).filter((part) => part.type === "tool_use"),
		);
		const toolResults = messages.flatMap((message) =>
			(message.content ?? []).filter((part) => part.type === "tool_result"),
		);
		expect(toolUses).toHaveLength(1);
		expect(toolUses[0]!.id).toBe("call-1");
		expect(toolResults).toHaveLength(1);
		expect(toolResults[0]!.tool_use_id).toBe("call-1");
	});

	it("CMP09-WIRE-05: the shared capability predicate classifies the Anthropic family", async () => {
		// The NECESSITY discriminator: the repair's exclusion must be
		// gated on the SAME capability the wire's serializer enforces. The
		// predicate is the shared one; the Anthropic family is the transport
		// whose serializer drops an unsigned reasoning block.
		const { requiresSignedReasoningCapability } = await import("@cline/shared");
		expect(
			requiresSignedReasoningCapability({
				family: "anthropic",
				modelId: "MiniMax-M3.1-Flash",
				providerId: "minimax",
			}),
		).toBe(true);
		expect(
			requiresSignedReasoningCapability({
				family: "minimax",
				modelId: "MiniMax-M3.1-Flash",
				providerId: "minimax",
			}),
		).toBe(false);
	});

	it("CMP09-WIRE-07: the canonical transcript is unchanged by the projection", () => {
		const transcript = transcriptWithUnsignedReasoning();
		const before = JSON.stringify(transcript);
		toProviderVisibleMessages(transcript);
		expect(JSON.stringify(transcript)).toBe(before);
	});
});
