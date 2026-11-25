/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01.
 *
 * Provider-required reasoning continuity across tool rounds.
 *
 * PURPOSE
 * -------
 * The MiniMax M3.1 Flash route is the Anthropic-compatible transport
 * (`https://api.minimax.io/anthropic/v1`, served by the REAL
 * `@ai-sdk/anthropic` adapter). Anthropic streams a thinking block's
 * SIGNATURE as a SEPARATE, EMPTY-TEXT event:
 *
 *   content_block_start  { type: "thinking" }
 *   content_block_delta  { type: "thinking_delta", delta: { thinking: "..." } }
 *   content_block_delta  { type: "signature_delta", delta: { signature: "..." } }
 *   content_block_stop
 *
 * The resolved AI SDK turns the signature event into a `reasoning-delta`
 * whose `text` is the EMPTY STRING and whose `providerMetadata.anthropic`
 * carries the signature.
 *
 * The defect this suite pins: ClineMM's AI SDK translator DROPS that event
 * (it only forwards a reasoning part when its text is non-empty) and never
 * reads the Anthropic signature out of `providerMetadata`. The signature
 * therefore never reaches the accumulated reasoning part, so the NEXT
 * request serializes the reasoning WITHOUT a signature. The Anthropic
 * serializer then emits the `unsupported reasoning metadata` warning and
 * DROPS the reasoning block from the request entirely.
 *
 * WHAT MUST HOLD (the acceptance authority)
 * ------------------------------------------
 * The assertions below are made against the ACTUAL SERIALIZED OUTBOUND
 * HTTP REQUEST BODY produced by the REAL gateway + REAL `@ai-sdk/anthropic`
 * transport, with the ONLY replacement being the external network boundary
 * (an injected `fetch`). Nothing is asserted against a reconstructed
 * history: the runtime builds the follow-up request itself.
 *
 * The synthetic content is deliberately artificial and non-secret.
 */
import type {
	AgentMessage,
	AgentModelEvent,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";

/** The exact official MiniMax M3.1 API model identifier. */
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/**
 * A synthetic, opaque Anthropic-style signature.
 *
 * It is NOT a real Anthropic signature and carries NO cryptographic
 * meaning; it exists only so the test can assert that the value the
 * provider emitted is the value that reaches the wire.
 */
const SYNTHETIC_SIGNATURE = "synthetic-opaque-signature-aa11bb22";

/** A synthetic, non-secret reasoning text. */
const SYNTHETIC_REASONING = "SYNTHETIC-REASONING-BLOCK-TEXT";

/** A synthetic, non-secret tool result payload. */
const SYNTHETIC_TOOL_RESULT = "SYNTHETIC-TOOL-RESULT-OK";

const TOOL_NAME = "read_synthetic_file";

/**
 * The Anthropic-protocol SSE stream for ONE turn: a thinking block with
 * text, a SEPARATE signature event, and a tool call.
 *
 * The event order mirrors the Anthropic Messages streaming contract:
 * `content_block_start` -> `content_block_delta` (thinking) ->
 * `content_block_delta` (signature) -> `content_block_stop`.
 */
function anthropicTurnWithThinkingAndToolCall(): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n',
		'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"${SYNTHETIC_REASONING}"}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"${SYNTHETIC_SIGNATURE}"}}\n\n`,
		'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
		'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_synthetic_1","name":"read_synthetic_file","input":{}}}\n\n',
		'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
		'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
		'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

/**
 * The Anthropic-protocol SSE stream for the FOLLOW-UP turn: a plain text
 * answer, with no reasoning and no tool call.
 */
function anthropicPlainTextTurn(): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":5}}}\n\n',
		'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
		'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"DONE"}}\n\n',
		'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
		'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

type CapturedRequest = {
	url: string;
	body: Record<string, unknown>;
};

function makeFetchMock(responses: (() => Response)[]) {
	const calls: CapturedRequest[] = [];
	let index = 0;
	const fetchMock = (async (input: unknown, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: String(input);
		const rawBody = init?.body;
		const parsed =
			typeof rawBody === "string"
				? (JSON.parse(rawBody) as Record<string, unknown>)
				: ({} as Record<string, unknown>);
		calls.push({ url, body: parsed });
		const factory = responses[Math.min(index, responses.length - 1)];
		index += 1;
		return factory();
	}) as unknown as typeof fetch;
	return { fetchMock, calls };
}

function makeGateway(fetchImpl: typeof fetch) {
	return createGateway({
		providerConfigs: [
			{
				providerId: "minimax",
				apiKey: "test-key",
				baseUrl: MINIMAX_BASE_URL,
				fetch: fetchImpl,
			},
		],
	});
}

const TOOLS = [
	{
		name: TOOL_NAME,
		description: "A synthetic tool used only by this test.",
		inputSchema: { type: "object", properties: {} },
	},
] as const;

function userMessage(): AgentMessage {
	return {
		id: "m_user",
		role: "user",
		content: [{ type: "text", text: "SYNTHETIC-PROMPT" }],
		createdAt: 1,
	};
}

/**
 * The FIRST request. It carries the user message and the tool definition.
 */
function firstRequest(): GatewayStreamRequest {
	return {
		providerId: "minimax",
		modelId: EXACT_M31_MODEL_ID,
		messages: [userMessage()],
		tools: TOOLS as unknown as GatewayStreamRequest["tools"],
		reasoning: { enabled: true, effort: "low" },
	};
}

/**
 * The assistant turn as the RUNTIME accumulated it, plus the tool result.
 *
 * The reasoning part is built from the runtime's OWN accumulation
 * semantics: the reasoning-delta events the translator produced, with the
 * LAST one's metadata carried onto the accumulated part. When the
 * translator drops the signature-only event, the accumulated part has NO
 * metadata — which is exactly the defect.
 */
function assistantTurnFromEvents(
	events: readonly AgentModelEvent[],
): AgentMessage {
	const content: AgentMessage["content"] = [];
	let reasoningText = "";
	let reasoningMetadata: unknown;
	let sawReasoning = false;
	for (const event of events) {
		if (event.type === "reasoning-delta") {
			reasoningText += event.text;
			reasoningMetadata = event.metadata ?? reasoningMetadata;
			sawReasoning = true;
		}
	}
	if (sawReasoning) {
		content.push({
			type: "reasoning",
			text: reasoningText,
			...(reasoningMetadata !== undefined
				? { metadata: reasoningMetadata }
				: {}),
		});
	}
	for (const event of events) {
		if (event.type === "tool-call-delta") {
			content.push({
				type: "tool-call",
				toolCallId: event.toolCallId ?? "toolu_synthetic_1",
				toolName: event.toolName ?? TOOL_NAME,
				input: event.input ?? {},
			});
		}
	}
	return {
		id: "m_assistant",
		role: "assistant",
		content,
		createdAt: 2,
	};
}

function toolResultMessage(toolCallId: string): AgentMessage {
	return {
		id: "m_tool",
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId,
				toolName: TOOL_NAME,
				output: SYNTHETIC_TOOL_RESULT,
			},
		],
		createdAt: 3,
	};
}

/**
 * The Anthropic `content` blocks of the assistant turn in the SECOND
 * request body.
 */

describe("MiniMax provider reasoning continuity (P0)", () => {
	it("R1: replays provider-required reasoning WITH its signature in the next request", async () => {
		const { fetchMock, calls } = makeFetchMock([
			anthropicTurnWithThinkingAndToolCall,
			anthropicPlainTextTurn,
		]);
		const gateway = makeGateway(fetchMock);

		// ---- REQUEST 1: the provider streams reasoning + a tool call. ----
		const firstEvents: AgentModelEvent[] = [];
		for await (const event of await gateway.stream(firstRequest())) {
			firstEvents.push(event);
		}

		// The runtime accumulated the reasoning and the tool call.
		const reasoningEvent = firstEvents.find(
			(event) => event.type === "reasoning-delta",
		);
		expect(reasoningEvent).toBeDefined();
		const toolEvent = firstEvents.find(
			(event) => event.type === "tool-call-delta",
		);
		expect(toolEvent).toBeDefined();
		const toolCallId = toolEvent?.toolCallId ?? "toolu_synthetic_1";

		// ---- REQUEST 2: the runtime builds the follow-up request. ----
		const followUp: GatewayStreamRequest = {
			...firstRequest(),
			messages: [
				userMessage(),
				assistantTurnFromEvents(firstEvents),
				toolResultMessage(toolCallId),
			],
		};
		for await (const _event of await gateway.stream(followUp)) {
			// drain
		}

		expect(calls.length).toBeGreaterThanOrEqual(2);
		const secondBody = calls[1].body;

		// The reasoning block must reach the wire, carrying its signature.
		const blocks = assistantBlocks(secondBody);
		const thinking = blocks.find((block) => block.type === "thinking");
		expect(
			thinking,
			"the follow-up request carried no Anthropic thinking block",
		).toBeDefined();
		expect(thinking?.thinking).toBe(SYNTHETIC_REASONING);
		expect(thinking?.signature).toBe(SYNTHETIC_SIGNATURE);

		// The tool call identity is conserved.
		const toolUse = blocks.find((block) => block.type === "tool_use");
		expect(toolUse).toBeDefined();
		expect(toolUse?.id).toBe(toolCallId);
		expect(toolUse?.name).toBe(TOOL_NAME);

		// The tool result identity is conserved and not duplicated.
		//
		// The Anthropic wire form carries a tool result as a `tool_result`
		// content block inside a USER-role message (that is the Anthropic
		// Messages contract, not a ClineMM choice).
		const secondMessages = secondBody.messages as Array<
			Record<string, unknown>
		>;
		const toolResultBlocks = secondMessages.flatMap((message) =>
			(Array.isArray(message.content)
				? (message.content as Array<Record<string, unknown>>)
				: []
			).filter((block) => block.type === "tool_result"),
		);
		expect(toolResultBlocks).toHaveLength(1);
		expect(toolResultBlocks[0].tool_use_id).toBe(toolCallId);
		expect(JSON.stringify(toolResultBlocks)).toContain(SYNTHETIC_TOOL_RESULT);
	});
});

function assistantBlocks(
	body: Record<string, unknown>,
): Array<Record<string, unknown>> {
	const messages = body.messages;
	if (!Array.isArray(messages)) {
		throw new Error("the serialized body carried no messages array");
	}
	const assistant = messages.find(
		(message) =>
			message &&
			typeof message === "object" &&
			(message as Record<string, unknown>).role === "assistant",
	) as Record<string, unknown> | undefined;
	if (!assistant) {
		throw new Error("the serialized body carried no assistant message");
	}
	const content = assistant.content;
	if (!Array.isArray(content)) {
		throw new Error(
			"the serialized assistant message carried no content array",
		);
	}
	return content as Array<Record<string, unknown>>;
}
