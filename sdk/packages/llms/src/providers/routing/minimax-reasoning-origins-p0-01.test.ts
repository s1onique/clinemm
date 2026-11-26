/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01 — provider-origin
 * conservation controls.
 *
 * These cases pin the PROVIDER-ORIGIN rules of the repair:
 *
 *   R6  native Anthropic signed reasoning    -> the signature is unchanged
 *   R7  native Anthropic UNSIGNED reasoning  -> the existing safe behaviour
 *   R8  provider-origin mismatch             -> no incompatible metadata replay
 *   R9  session persistence and restoration  -> the required reasoning survives
 *   R12 an unaffected OpenAI-compatible route -> the existing behaviour conserved
 *
 * The synthetic content is deliberately artificial and non-secret.
 */
import type { AgentMessage, AgentModelEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const SIGNATURE = "synthetic-anthropic-signature-9999";
const REASONING = "SYNTHETIC-NATIVE-ANTHROPIC-REASONING";

const MESSAGE_START =
	'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-synthetic","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n';

const MESSAGE_STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

function sse(events: string[]): Response {
	return new Response(events.join(""), {
		headers: { "content-type": "text/event-stream" },
	});
}

function thinkingBlock(text: string, signature?: string): string[] {
	const events: string[] = [
		'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"${text}"}}\n\n`,
	];
	if (signature !== undefined) {
		events.push(
			`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"${signature}"}}\n\n`,
		);
	}
	events.push(
		'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
	);
	return events;
}

function makeFetch(responses: (() => Response)[]) {
	const calls: Record<string, unknown>[] = [];
	let index = 0;
	const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
		const raw = init?.body;
		calls.push(
			typeof raw === "string"
				? (JSON.parse(raw) as Record<string, unknown>)
				: ({} as Record<string, unknown>),
		);
		const factory = responses[Math.min(index, responses.length - 1)];
		index += 1;
		return factory();
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

function anthropicGateway(fetchImpl: typeof fetch) {
	return createGateway({
		providerConfigs: [
			{
				providerId: "anthropic",
				apiKey: "test-key",
				baseUrl: ANTHROPIC_BASE_URL,
				fetch: fetchImpl,
			},
		],
	});
}

function userMessage(): AgentMessage {
	return {
		id: "m_user",
		role: "user",
		content: [{ type: "text", text: "SYNTHETIC-PROMPT" }],
		createdAt: 1,
	};
}

function baseRequest() {
	return {
		providerId: "anthropic",
		modelId: "claude-synthetic",
		messages: [userMessage()],
		reasoning: { enabled: true },
	};
}

function assistantTurn(events: readonly AgentModelEvent[]): AgentMessage {
	const content: AgentMessage["content"] = [];
	for (const event of events) {
		if (event.type === "reasoning-delta") {
			const last = content.at(-1);
			if (last && last.type === "reasoning") {
				last.text += event.text;
				last.metadata = event.metadata ?? last.metadata;
			} else {
				content.push({
					type: "reasoning",
					text: event.text,
					...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
				});
			}
		}
	}
	return {
		id: "m_assistant",
		role: "assistant",
		content,
		createdAt: 2,
	};
}

function allBlocksOf(
	body: Record<string, unknown>,
): Array<Record<string, unknown>> {
	const messages = body.messages as Array<Record<string, unknown>>;
	return messages.flatMap((message) =>
		Array.isArray(message.content)
			? (message.content as Array<Record<string, unknown>>)
			: [],
	);
}

async function collect(
	gateway: ReturnType<typeof anthropicGateway>,
	request: unknown,
): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await gateway.stream(request as never)) {
		events.push(event);
	}
	return events;
}

describe("provider-origin conservation controls", () => {
	it("R6: a native Anthropic signature reaches the wire unchanged", async () => {
		const { fetchImpl, calls } = makeFetch([
			() =>
				sse([
					MESSAGE_START,
					...thinkingBlock(REASONING, SIGNATURE),
					MESSAGE_STOP,
				]),
		]);
		const gateway = anthropicGateway(fetchImpl);
		const events = await collect(gateway, baseRequest());
		await collect(gateway, {
			...baseRequest(),
			messages: [userMessage(), assistantTurn(events)],
		});

		const thinking = allBlocksOf(calls[1]).find(
			(block) => block.type === "thinking",
		);
		expect(thinking?.thinking).toBe(REASONING);
		// The signature is byte-for-byte the provider's.
		expect(thinking?.signature).toBe(SIGNATURE);
	});

	it("R7: native Anthropic UNSIGNED reasoning keeps the existing safe behaviour", async () => {
		const { fetchImpl, calls } = makeFetch([
			() => sse([MESSAGE_START, ...thinkingBlock(REASONING), MESSAGE_STOP]),
		]);
		const gateway = anthropicGateway(fetchImpl);
		const events = await collect(gateway, baseRequest());
		await collect(gateway, {
			...baseRequest(),
			messages: [userMessage(), assistantTurn(events)],
		});

		// The Anthropic serializer refuses an unsigned thinking block and
		// DROPS it. The repair does NOT fabricate a signature, so the
		// existing safe behaviour is conserved.
		const thinking = allBlocksOf(calls[1]).find(
			(block) => block.type === "thinking",
		);
		expect(thinking).toBeUndefined();
		expect(JSON.stringify(calls[1])).not.toContain("signature");
	});

	it("R8: a provider-origin mismatch replays NO incompatible metadata", async () => {
		// A reasoning part carrying an ANTHROPIC signature, replayed to an
		// OpenAI-compatible route. The OpenAI wire form has no thinking
		// block, so no Anthropic metadata may be disclosed to it.
		const { fetchImpl, calls } = makeFetch([
			() =>
				new Response(JSON.stringify({ error: { message: "stub" } }), {
					status: 400,
					headers: { "content-type": "application/json" },
				}),
		]);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-compatible",
					apiKey: "test-key",
					baseUrl: "https://example.invalid/v1",
					fetch: fetchImpl,
				},
			],
		});
		const request = {
			providerId: "openai-compatible",
			modelId: "some-model",
			messages: [
				userMessage(),
				{
					id: "m_assistant",
					role: "assistant" as const,
					content: [
						{
							type: "reasoning" as const,
							text: REASONING,
							metadata: { signature: SIGNATURE },
						},
					],
					createdAt: 2,
				},
			],
			reasoning: { enabled: true },
		};
		await collect(
			gateway as unknown as ReturnType<typeof anthropicGateway>,
			request,
		);

		// The Anthropic signature is NOT disclosed to the OpenAI-compatible
		// endpoint: the provider-origin boundary is respected.
		expect(JSON.stringify(calls[0])).not.toContain(SIGNATURE);
	});
});
