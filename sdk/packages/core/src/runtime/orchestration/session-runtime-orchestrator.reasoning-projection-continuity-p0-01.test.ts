/**
 * ACT-CLINEMM-REASONING-PROJECTION-CONTINUITY-P0-01.
 *
 * THE PRINCIPAL WITNESS: signed MiniMax reasoning must reach the ACTUAL
 * outbound HTTP request through the PRODUCTION session-dispatch path.
 *
 * WHY THIS WITNESS EXISTS
 * -----------------------
 *
 * The forensic ACT established that the historical MiniMax session used the
 * GATEWAY path, and that the provider-visible projection destroyed the
 * ORIGIN AUTHORITY of the opaque reasoning payload. The projected messages
 * REPLACE the request messages on EVERY request, so the authority was gone
 * before the gateway saw the request, and the provider-required signature
 * was withheld: the Anthropic serializer then dropped the reasoning block
 * from the request entirely.
 *
 * The loss boundary is PROVEN here, end to end, on the production path:
 *
 *   SessionRuntime.run()
 *     -> AgentRuntime
 *       -> the production `beforeModel` hook
 *         (`session-runtime-orchestrator.ts`:
 *          `prepareMessagesForModelRequest` -> `agentMessagesToMessages`
 *          -> `toProviderVisibleMessages` -> `messagesToAgentMessages`)
 *       -> `model.stream(request)` (the REAL gateway, the REAL registry,
 *          the REAL `@ai-sdk/anthropic` transport)
 *       -> the ACTUAL outbound HTTP request body
 *
 * NOTHING here constructs a degraded assistant turn by hand: the assistant
 * turn is produced by the REAL runtime from the REAL provider SSE, and the
 * follow-up request is produced by the REAL session dispatch after a REAL
 * tool continuation.
 *
 * The ONLY replaced boundary is the external network boundary (an injected
 * `fetch`). No MiniMax request is sent.
 *
 * EVIDENCE CLASS
 * --------------
 *
 * SYNTHETIC_REAL_PRODUCTION_SEAM.
 */

import {
	type AgentMessage,
	type AgentModel,
	type AgentTool,
	type AgentToolContext,
	createTool,
	type ITelemetryService,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { SessionRuntime } from "./session-runtime-orchestrator";

/** The published MiniMax international route. */
const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
/** The exact official MiniMax M3.1 API model identifier. */
const MODEL_ID = "MiniMax-M3.1-Flash";

/** A synthetic, opaque Anthropic-style signature (non-secret). */
const SIGNATURE_A = "synthetic-opaque-signature-aa11bb22";
/** A synthetic, non-secret reasoning text. */
const REASONING_A = "SYNTHETIC-REASONING-BLOCK-TEXT";
/** A synthetic tool result payload. */
const TOOL_RESULT = "SYNTHETIC-TOOL-RESULT-OK";
const TOOL_NAME = "read_synthetic_file";
const TOOL_CALL_ID = "toolu_synthetic_0001";

/**
 * The ORIGIN AUTHORITY the production extraction stamps on a reasoning
 * payload issued by the published MiniMax route:
 * `<providerId>\0<origin>\0<path>`.
 */
const EXPECTED_ORIGIN_AUTHORITY =
	"minimax\u0000https://api.minimax.io\u0000/anthropic/v1";

function anthropicSse(events: string[]): Response {
	return new Response(events.join(""), {
		headers: { "content-type": "text/event-stream" },
	});
}

function messageStart(model: string, outputTokens = 10): string {
	return `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"${model}","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":${outputTokens}}}}\n\n`;
}

/**
 * The provider turn: a thinking block with a SEPARATE signature event,
 * followed by a tool call — the Anthropic Messages streaming contract.
 */
function toolUseTurn(): Response {
	return anthropicSse([
		messageStart(MODEL_ID),
		`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"${REASONING_A}"}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"${SIGNATURE_A}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
		`event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"${TOOL_CALL_ID}","name":"${TOOL_NAME}","input":{}}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n`,
		`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n`,
		`event: message_stop\ndata: {"type":"message_stop"}\n\n`,
	]);
}

/** The follow-up turn: a plain text answer. */
function plainTextTurn(): Response {
	return anthropicSse([
		messageStart(MODEL_ID, 5),
		'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
		'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"DONE"}}\n\n',
		'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
		'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	]);
}

type CapturedCall = { url: string; body: Record<string, unknown> };

function makeFetch(responses: (() => Response)[]) {
	const calls: CapturedCall[] = [];
	let index = 0;
	const fetchImpl = (async (input: unknown, init?: RequestInit) => {
		const raw = init?.body;
		const body =
			typeof raw === "string"
				? (JSON.parse(raw) as Record<string, unknown>)
				: ({} as Record<string, unknown>);
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: String(input);
		calls.push({ url, body });
		const factory = responses[Math.min(index, responses.length - 1)];
		index += 1;
		return factory();
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

function telemetryMock(): ITelemetryService {
	return {
		capture: () => undefined,
		increment: () => undefined,
		log: () => undefined,
	} as unknown as ITelemetryService;
}

function makeTool(
	executions: string[],
): AgentTool<Record<string, unknown>, { output: string }> {
	// The PRODUCTION tool-authoring factory. It supplies the runtime
	// defaults (timeout, retry policy) the raw object would omit.
	return createTool<Record<string, unknown>, { output: string }>({
		name: TOOL_NAME,
		description: "A synthetic tool used only by this witness.",
		inputSchema: { type: "object", properties: {} },
		execute: async (
			_input: Record<string, unknown>,
			_context: AgentToolContext,
		) => {
			executions.push(TOOL_NAME);
			return { output: TOOL_RESULT };
		},
	});
}

/** Every content block of every message of a request body. */
/** Every content block of every message of a request body. */
function blocksOf(
	body: Record<string, unknown>,
): Array<Record<string, unknown>> {
	const messages = (body.messages ?? []) as Array<Record<string, unknown>>;
	return messages.flatMap((message) =>
		Array.isArray(message.content)
			? (message.content as Array<Record<string, unknown>>)
			: [],
	);
}

/** Drain a model stream and return every event it produced. */
async function collect(
	model: AgentModel,
	messages: readonly AgentMessage[],
): Promise<unknown[]> {
	const events: unknown[] = [];
	const stream = await model.stream({
		systemPrompt: "SYNTHETIC-SYSTEM-PROMPT",
		messages,
		tools: [
			{
				name: TOOL_NAME,
				description: "A synthetic tool used only by this witness.",
				inputSchema: { type: "object", properties: {} },
			},
		],
	});
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

describe("session-dispatch reasoning projection continuity (P0-01)", () => {
	it("carries the signed MiniMax reasoning block to the outbound request", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			() => toolUseTurn(),
			() => plainTextTurn(),
		]);

		// The REAL production session runtime. It builds the REAL gateway
		// through `createAgentModelFromConfig`, and the REAL `beforeModel`
		// preparation through the production projection.
		const runtime = new SessionRuntime({
			providerId: "minimax",
			modelId: MODEL_ID,
			apiKey: "test-key",
			baseUrl: MINIMAX_BASE_URL,
			systemPrompt: "SYNTHETIC-SYSTEM-PROMPT",
			tools: [makeTool(executions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
			// The preserved session's LIVE wire carried
			// `output_config.effort = "low"` on EVERY request.
			reasoningEffort: "low",
			thinking: true,
			providerConfig: {
				providerId: "minimax",
				apiKey: "test-key",
				baseUrl: MINIMAX_BASE_URL,
				fetch: fetchImpl,
			},
		} as never);

		const result = await runtime.run("SYNTHETIC-PROMPT");

		// The tool really ran: the continuation is a REAL tool round.
		expect(executions).toEqual([TOOL_NAME]);
		expect(calls.length).toBeGreaterThanOrEqual(2);

		// ---- THE FOLLOW-UP REQUEST (the one that must replay the
		// reasoning) --------------------------------------------------
		const followUp = calls[calls.length - 1].body;
		const blocks = blocksOf(followUp);

		// 1. The ORIGINAL signed thinking block reaches the wire, with the
		//    EXACT synthetic signature.
		const thinking = blocks.filter((block) => block.type === "thinking");
		expect(thinking).toHaveLength(1);
		expect(thinking[0].thinking).toBe(REASONING_A);
		expect(thinking[0].signature).toBe(SIGNATURE_A);

		// 2. The origin authority is INTERNAL: it must NOT appear anywhere
		//    in the serialized provider request.
		expect(JSON.stringify(followUp)).not.toContain("originAuthority");
		expect(JSON.stringify(followUp)).not.toContain(EXPECTED_ORIGIN_AUTHORITY);

		// 3. Tool-call identity is preserved.
		const toolUses = blocks.filter((block) => block.type === "tool_use");
		expect(toolUses).toHaveLength(1);
		expect(toolUses[0].id).toBe(TOOL_CALL_ID);
		expect(toolUses[0].name).toBe(TOOL_NAME);

		// 4. Tool-result identity is preserved.
		const toolResults = blocks.filter((block) => block.type === "tool_result");
		expect(toolResults).toHaveLength(1);
		expect(toolResults[0].tool_use_id).toBe(TOOL_CALL_ID);

		// 5. Block ORDER is preserved: the thinking block precedes the tool
		//    call in the assistant turn, and the tool result follows it.
		const messages = (followUp.messages ?? []) as Array<
			Record<string, unknown>
		>;
		const assistantIndex = messages.findIndex(
			(message) => message.role === "assistant",
		);
		const assistantContent = (messages[assistantIndex]?.content ?? []) as Array<
			Record<string, unknown>
		>;
		expect(assistantContent.map((block) => block.type)).toEqual([
			"thinking",
			"tool_use",
		]);

		// 6. The LOW effort remains LOW on the wire.
		expect(followUp.output_config).toEqual({ effort: "low" });

		// 7. The SOURCE reasoning carried the exact signature AND the exact
		//    origin authority: the authority was ESTABLISHED at the source,
		//    not absent. So the follow-up request's signature is the ORIGINAL
		//    one, replayed from the source payload.
		//
		//    The source is the SESSION's canonical history
		//    (`AgentResult.messages`, the persisted `MessageWithMetadata`
		//    shape), where the thinking block carries the signature and the
		//    authority as sibling fields.
		const sourceThinking = (result.messages ?? [])
			.flatMap((message) =>
				Array.isArray(message.content) ? message.content : [],
			)
			.find(
				(block) =>
					block.type === "thinking" &&
					(block as { signature?: string }).signature === SIGNATURE_A,
			) as
			| {
					signature?: string;
					originAuthority?: string;
			  }
			| undefined;
		expect(sourceThinking?.signature).toBe(SIGNATURE_A);
		expect(sourceThinking?.originAuthority).toBe(EXPECTED_ORIGIN_AUTHORITY);
	});

	it("denies an unknown or incompatible origin", async () => {
		// The SECURITY BOUNDARY is preserved by the repair.
		//
		// The projection now CARRIES the authority, so the outbound
		// conversion can ENFORCE it. Two cases must still be denied:
		//
		//   - an UNKNOWN origin (no authority at all), and
		//   - an INCOMPATIBLE origin (a different route's authority).
		//
		// In both cases the provider-required signature is withheld, so the
		// reasoning block is dropped from the request entirely — the model
		// never receives an opaque payload it did not earn.
		const { createGateway } = await import("@cline/llms");

		async function wireFor(
			metadata: Record<string, unknown>,
		): Promise<Array<Record<string, unknown>>> {
			const { fetchImpl, calls } = makeFetch([
				() => plainTextTurn(),
				() => plainTextTurn(),
			]);
			const gateway = createGateway({
				providerConfigs: [
					{
						providerId: "minimax",
						apiKey: "test-key",
						baseUrl: MINIMAX_BASE_URL,
						fetch: fetchImpl,
					},
				],
			});
			const model = gateway.createAgentModel(
				{ providerId: "minimax", modelId: MODEL_ID },
				{ reasoning: { enabled: true, effort: "low" } },
			);
			await collect(model, [
				{
					id: "m_user",
					role: "user",
					content: [{ type: "text", text: "SYNTHETIC-PROMPT" }],
					createdAt: 1,
				},
				{
					id: "m_assistant",
					role: "assistant",
					createdAt: 2,
					content: [
						{
							type: "reasoning",
							text: REASONING_A,
							metadata,
						},
					],
				},
			]);
			return blocksOf(calls[calls.length - 1].body);
		}

		// (a) An UNKNOWN origin grants no replay authority.
		const unknownOrigin = await wireFor({ signature: SIGNATURE_A });
		expect(
			unknownOrigin.filter((block) => block.type === "thinking"),
		).toHaveLength(0);

		// (b) An INCOMPATIBLE origin (a different route) grants no replay
		//     authority either.
		const incompatibleOrigin = await wireFor({
			signature: SIGNATURE_A,
			originAuthority: "minimax\u0000https://api.minimax.io\u0000/anthropic/v2",
		});
		expect(
			incompatibleOrigin.filter((block) => block.type === "thinking"),
		).toHaveLength(0);
	});
});
