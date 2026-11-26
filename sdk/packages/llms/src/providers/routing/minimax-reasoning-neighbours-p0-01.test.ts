/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01 — neighbouring-behaviour
 * conservation controls.
 *
 *   R9  session persistence and restoration -> the required reasoning survives
 *   R11 Google/Vertex thought metadata       -> the existing behaviour conserved
 *   R12 an unaffected OpenAI-compatible route -> the existing behaviour conserved
 *   R15 compaction interaction               -> the retained reasoning stays valid
 *
 * The synthetic content is deliberately artificial and non-secret.
 */
import type { AgentMessage, AgentModelEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const SIGNATURE = "synthetic-signature-cccc";
const REASONING = "SYNTHETIC-REASONING-CCCC";

const MESSAGE_START =
	'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n';

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

function userMessage(): AgentMessage {
	return {
		id: "m_user",
		role: "user",
		content: [{ type: "text", text: "SYNTHETIC-PROMPT" }],
		createdAt: 1,
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

describe("neighbouring-behaviour conservation controls", () => {
	it("R11: the Google/Vertex thought-signature behaviour is conserved", async () => {
		// The Gemini family's `thoughtSignature` rides on the TOOL CALL,
		// not on the reasoning part: the AI SDK surfaces it as
		// `providerMetadata.google` / `providerMetadata.vertex`
		// `thoughtSignature` on the `tool-call` part, and the outbound
		// conversion reads it back from the tool call's metadata.
		//
		// The repair renamed the metadata extractor that serves this path
		// and ADDED the Anthropic bucket to it. The Google/Vertex bucket
		// itself is untouched.
		//
		// This invariant is covered by the EXISTING repository test
		// `src/providers/gateway.test.ts` ("preserves Vertex thought
		// signatures on tool calls and replays them" and "preserves legacy
		// Google snake_case thought signatures"), which exercises the
		// extraction AND the replay to `providerOptions.google
		// .thoughtSignature`. That suite passes unchanged with this
		// repair, which is the conservation evidence for R11 — so this
		// case asserts the SAME invariant here at the WIRE boundary, and
		// does not duplicate the existing fixture's coverage.
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
					providerId: "gemini",
					apiKey: "test-key",
					baseUrl: "https://generativelanguage.googleapis.com/v1beta",
					fetch: fetchImpl,
				},
			],
		});
		await (async () => {
			for await (const _event of await gateway.stream({
				providerId: "gemini",
				modelId: "gemini-2.5-pro",
				messages: [
					userMessage(),
					{
						id: "m_assistant",
						role: "assistant",
						content: [
							{
								type: "tool-call",
								toolCallId: "call_synthetic",
								toolName: "synthetic_tool",
								input: {},
								metadata: {
									thoughtSignature: "synthetic-thought-signature-dddd",
								},
							},
						],
						createdAt: 2,
					},
					{
						id: "m_tool",
						role: "tool",
						content: [
							{
								type: "tool-result",
								toolCallId: "call_synthetic",
								toolName: "synthetic_tool",
								output: "SYNTHETIC-RESULT",
							},
						],
						createdAt: 3,
					},
				],
				tools: [
					{
						name: "synthetic_tool",
						description: "A synthetic tool.",
						inputSchema: { type: "object", properties: {} },
					},
				],
			} as never)) {
				// drain
			}
		})();
		expect(calls.length).toBeGreaterThanOrEqual(1);
		// The Google thought signature survives to the wire unchanged.
		const serialized = JSON.stringify(calls[0]);
		expect(serialized).toContain("synthetic-thought-signature-dddd");
	});

	it("R12: an unaffected OpenAI-compatible route is conserved", async () => {
		// The OpenAI-compatible route carries no thinking block. A
		// reasoning part replayed to it must not introduce one, and must
		// not introduce Anthropic metadata either.
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
		await (async () => {
			for await (const _event of await gateway.stream({
				providerId: "openai-compatible",
				modelId: "some-model",
				messages: [
					userMessage(),
					{
						id: "m_assistant",
						role: "assistant",
						content: [
							{
								type: "reasoning",
								text: REASONING,
								metadata: { signature: SIGNATURE },
							},
						],
						createdAt: 2,
					},
				],
				reasoning: { enabled: true },
			} as never)) {
				// drain
			}
		})();
		const serialized = JSON.stringify(calls[0]);
		expect(serialized).not.toContain(SIGNATURE);
		expect(serialized).not.toContain('"thinking"');
	});

	it("R15: a retained reasoning part stays protocol-valid on the wire", async () => {
		// Compaction REPLACES the history with a summary. The retained
		// reasoning must still be protocol-valid when replayed: a retained
		// SIGNED reasoning part carries its signature, and a retained
		// UNSIGNED reasoning part introduces no invalid block.
		const { fetchImpl, calls } = makeFetch([
			() =>
				sse([
					MESSAGE_START,
					...thinkingBlock(REASONING, SIGNATURE),
					MESSAGE_STOP,
				]),
		]);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "minimax",
					apiKey: "test-key",
					baseUrl: "https://api.minimax.io/anthropic/v1",
					fetch: fetchImpl,
				},
			],
		});
		const events: AgentModelEvent[] = [];
		for await (const event of await gateway.stream({
			providerId: "minimax",
			modelId: "MiniMax-M3.1-Flash",
			messages: [userMessage()],
			reasoning: { enabled: true, effort: "low" },
		} as never)) {
			events.push(event);
		}
		const retained = assistantTurn(events);

		// DISPOSITION:
		//
		//   RETAINED_PART_SERIALIZATION = PASS
		//   PRODUCTION_COMPACTION        = NOT_EXECUTED
		//
		// This case proves that a RETAINED reasoning part stays
		// protocol-valid on the wire. It does NOT exercise the production
		// compaction path: the compaction retention seam lives in
		// `@cline/core`'s context extension, which is a separate subsystem
		// and is deliberately NOT rewritten or driven by this ACT.
		//
		// The retained part is protocol-valid: it carries the signature the
		// provider emitted, so the Anthropic serializer accepts it.
		await (async () => {
			for await (const _event of await gateway.stream({
				providerId: "minimax",
				modelId: "MiniMax-M3.1-Flash",
				messages: [userMessage(), retained],
				reasoning: { enabled: true, effort: "low" },
			} as never)) {
				// drain
			}
		})();
		const thinking = allBlocksOf(calls[1]).find(
			(block) => block.type === "thinking",
		);
		expect(thinking?.thinking).toBe(REASONING);
		expect(thinking?.signature).toBe(SIGNATURE);
		// Exactly ONE thinking block: no duplication by the repair.
		expect(
			allBlocksOf(calls[1]).filter((block) => block.type === "thinking"),
		).toHaveLength(1);
	});
});
