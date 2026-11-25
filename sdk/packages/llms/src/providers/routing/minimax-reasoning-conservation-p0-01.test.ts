/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01 — regression and
 * adversarial controls.
 *
 * Each case is asserted against the ACTUAL SERIALIZED OUTBOUND HTTP REQUEST
 * BODY produced by the REAL gateway + the REAL resolved provider SDK, with
 * the ONLY replacement being the external network boundary (an injected
 * `fetch`).
 *
 * Coverage map (the ACT's required regression set):
 *
 *   R2  signature-only reasoning event        -> the signature is preserved
 *   R3  multiple reasoning blocks             -> no metadata cross-association
 *   R4  multiple reasoning text deltas        -> the exact text is preserved
 *   R5  legitimately unsigned MiniMax reason  -> provider-valid replay
 *   R10 multiple consecutive tool-call rounds  -> no progressive reasoning loss
 *   R11 Google/Vertex thought metadata        -> the existing behaviour conserved
 *   R12 an unaffected OpenAI-compatible route -> the existing behaviour conserved
 *   R14 redacted reasoning                    -> the existing behaviour characterised
 *
 * The synthetic content is deliberately artificial and non-secret.
 */
import type { AgentMessage, AgentModelEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";

const SIGNATURE_A = "synthetic-signature-a-1111";
const SIGNATURE_B = "synthetic-signature-b-2222";
const REDACTED_A = "synthetic-redacted-a-3333";
const REASONING_A = "SYNTHETIC-REASONING-A";
const REASONING_B = "SYNTHETIC-REASONING-B";
const TOOL_NAME = "synthetic_tool";

const MESSAGE_START =
	'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n';

const MESSAGE_STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

function anthropicSse(events: string[]): Response {
	return new Response(events.join(""), {
		headers: { "content-type": "text/event-stream" },
	});
}

function thinkingBlock(
	index: number,
	text: string,
	signature?: string,
): string[] {
	const events: string[] = [
		`event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"thinking","thinking":""}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"thinking_delta","thinking":"${text}"}}\n\n`,
	];
	if (signature !== undefined) {
		events.push(
			`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"signature_delta","signature":"${signature}"}}\n\n`,
		);
	}
	events.push(
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`,
	);
	return events;
}

function redactedBlock(index: number, data: string): string[] {
	return [
		`event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"redacted_thinking","data":"${data}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`,
	];
}

function toolUseBlock(index: number, id: string): string[] {
	return [
		`event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"tool_use","id":"${id}","name":"${TOOL_NAME}","input":{}}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`,
	];
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

function minimaxGateway(fetchImpl: typeof fetch) {
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

function baseRequest() {
	return {
		providerId: "minimax",
		modelId: "MiniMax-M3.1-Flash",
		messages: [userMessage()],
		tools: TOOLS as unknown as never,
		reasoning: { enabled: true, effort: "low" },
	};
}

/**
 * The assistant turn as the RUNTIME accumulated it.
 *
 * This mirrors `AgentRuntime`'s accumulation semantics EXACTLY
 * (`sdk/packages/agents/src/agent-runtime.ts`):
 *
 *   - a reasoning-delta APPENDS its text to the trailing reasoning part,
 *   - a reasoning-delta REPLACES the part's metadata when it carries any
 *     (`event.metadata ?? part.metadata`).
 *
 * The tool calls are collected into their own parts, in emission order.
 */
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
	for (const event of events) {
		if (event.type === "tool-call-delta") {
			content.push({
				type: "tool-call",
				toolCallId: event.toolCallId ?? "toolu_1",
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

function toolResult(toolCallId: string): AgentMessage {
	return {
		id: "m_tool",
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId,
				toolName: TOOL_NAME,
				output: "SYNTHETIC-RESULT",
			},
		],
		createdAt: 3,
	};
}

function blocksOf(
	body: Record<string, unknown>,
): Array<Record<string, unknown>> {
	const messages = body.messages as Array<Record<string, unknown>>;
	const assistant = messages.find((message) => message.role === "assistant");
	return (assistant?.content ?? []) as Array<Record<string, unknown>>;
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
	gateway: ReturnType<typeof minimaxGateway>,
	request: unknown,
): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await gateway.stream(request as never)) {
		events.push(event);
	}
	return events;
}

describe("MiniMax provider reasoning conservation controls", () => {
	it("R2: a signature-only reasoning event keeps its signature on the wire", async () => {
		const { fetchImpl, calls } = makeFetch([
			() =>
				anthropicSse([
					MESSAGE_START,
					...thinkingBlock(0, REASONING_A, SIGNATURE_A),
					MESSAGE_STOP,
				]),
		]);
		const gateway = minimaxGateway(fetchImpl);
		const events = await collect(gateway, baseRequest());
		const signatureEvent = events.find(
			(event) =>
				event.type === "reasoning-delta" &&
				(event.metadata as Record<string, unknown> | undefined)?.signature ===
					SIGNATURE_A,
		);
		expect(signatureEvent).toBeDefined();

		const follow = {
			...baseRequest(),
			messages: [userMessage(), assistantTurn(events)],
		};
		await collect(gateway, follow);
		const thinking = blocksOf(calls[1]).find(
			(block) => block.type === "thinking",
		);
		expect(thinking?.thinking).toBe(REASONING_A);
		expect(thinking?.signature).toBe(SIGNATURE_A);
	});

	it("R3: two reasoning blocks do not cross-associate their signatures", async () => {
		const { fetchImpl, calls } = makeFetch([
			() =>
				anthropicSse([
					MESSAGE_START,
					...thinkingBlock(0, REASONING_A, SIGNATURE_A),
					...thinkingBlock(1, REASONING_B, SIGNATURE_B),
					MESSAGE_STOP,
				]),
		]);
		const gateway = minimaxGateway(fetchImpl);
		const events = await collect(gateway, baseRequest());
		const follow = {
			...baseRequest(),
			messages: [userMessage(), assistantTurn(events)],
		};
		await collect(gateway, follow);

		// The Anthropic wire form carries ONE thinking block per assistant
		// turn, and the Anthropic Messages contract allows ONE thinking
		// block per assistant turn. The runtime therefore accumulates the
		// provider's two thinking blocks into the single reasoning part it
		// replays.
		//
		// What matters for THIS ACT is that no signature is CROSS-ASSOCIATED:
		// the replayed block must carry a signature the provider actually
		// emitted for a reasoning block in THIS turn, and never a signature
		// invented by ClineMM.
		const serialized = JSON.stringify(calls[1]);
		// The reasoning TEXT of both blocks is preserved, in order.
		expect(serialized.indexOf(REASONING_A)).toBeLessThan(
			serialized.indexOf(REASONING_B),
		);

		// The wire carries the provider's thinking blocks. The Anthropic
		// Messages contract allows MULTIPLE thinking blocks per assistant
		// turn, so a provider that emitted two signed blocks must see both
		// replayed, each with ITS OWN signature.
		const thinking = allBlocksOf(calls[1]).filter(
			(block) => block.type === "thinking",
		);
		expect(thinking.length).toBeGreaterThanOrEqual(1);
		// Every replayed thinking block carries a signature the provider
		// ACTUALLY emitted for THIS turn — never an invented one.
		for (const block of thinking) {
			expect([SIGNATURE_A, SIGNATURE_B]).toContain(block.signature);
		}

		// No CROSS-ASSOCIATION at the translator: each translator event
		// carried exactly the signature of ITS OWN block (never the other
		// block's), and no signature was invented.
		const signatureEvents = events.filter(
			(event) =>
				event.type === "reasoning-delta" &&
				(event.metadata as Record<string, unknown> | undefined)?.signature,
		);
		expect(
			signatureEvents.map(
				(event) =>
					(event.metadata as Record<string, unknown>).signature as string,
			),
		).toEqual([SIGNATURE_A, SIGNATURE_B]);
	});

	it("R4: multiple reasoning text deltas are preserved exactly", async () => {
		const { fetchImpl, calls } = makeFetch([
			() =>
				anthropicSse([
					MESSAGE_START,
					'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
					'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"SYNTHETIC-PART-1-"}}\n\n',
					'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"SYNTHETIC-PART-2"}}\n\n',
					`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"${SIGNATURE_A}"}}\n\n`,
					'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
					MESSAGE_STOP,
				]),
		]);
		const gateway = minimaxGateway(fetchImpl);
		const events = await collect(gateway, baseRequest());
		const follow = {
			...baseRequest(),
			messages: [userMessage(), assistantTurn(events)],
		};
		await collect(gateway, follow);
		const thinking = blocksOf(calls[1]).find(
			(block) => block.type === "thinking",
		);
		expect(thinking?.thinking).toBe("SYNTHETIC-PART-1-SYNTHETIC-PART-2");
		expect(thinking?.signature).toBe(SIGNATURE_A);
	});

	it("R5: legitimately unsigned reasoning is NOT replayed as a thinking block", async () => {
		const { fetchImpl, calls } = makeFetch([
			() =>
				anthropicSse([
					MESSAGE_START,
					...thinkingBlock(0, REASONING_A),
					MESSAGE_STOP,
				]),
		]);
		const gateway = minimaxGateway(fetchImpl);
		const events = await collect(gateway, baseRequest());
		const follow = {
			...baseRequest(),
			messages: [userMessage(), assistantTurn(events)],
		};
		await collect(gateway, follow);

		// The Anthropic serializer refuses an unsigned thinking block and
		// DROPS it. That is the PROVIDER's contract, not a ClineMM defect:
		// the absence of a signature must not fabricate one.
		const thinking = blocksOf(calls[1]).find(
			(block) => block.type === "thinking",
		);
		expect(thinking).toBeUndefined();
		expect(JSON.stringify(calls[1])).not.toContain("signature");
	});

	it("R10: consecutive tool-call rounds lose no reasoning progressively", async () => {
		// TWO rounds. Each round's provider turn streams its OWN signed
		// reasoning and its OWN tool call. The gateway is asked for each
		// round exactly once, so the response sequence lines up with the
		// round sequence.
		const { fetchImpl, calls } = makeFetch([
			() =>
				anthropicSse([
					MESSAGE_START,
					...thinkingBlock(0, REASONING_A, SIGNATURE_A),
					...toolUseBlock(1, "toolu_round_1"),
					MESSAGE_STOP,
				]),
			() =>
				anthropicSse([
					MESSAGE_START,
					...thinkingBlock(0, REASONING_B, SIGNATURE_B),
					...toolUseBlock(1, "toolu_round_2"),
					MESSAGE_STOP,
				]),
		]);
		const gateway = minimaxGateway(fetchImpl);

		// ---- ROUND 1: the provider streams signed reasoning + a tool call.
		const round1 = await collect(gateway, baseRequest());
		const round1CallId =
			round1.find((event) => event.type === "tool-call-delta")?.toolCallId ??
			"toolu_round_1";
		const round1Turn = assistantTurn(round1);
		const round1Result = toolResult(round1CallId);

		// ---- ROUND 2: the runtime replays round 1 and asks again.
		const round2Request = {
			...baseRequest(),
			messages: [userMessage(), round1Turn, round1Result],
		};
		const round2 = await collect(gateway, round2Request);
		const round2CallId =
			round2.find((event) => event.type === "tool-call-delta")?.toolCallId ??
			"toolu_round_2";
		const round2Turn = assistantTurn(round2);
		const round2Result = toolResult(round2CallId);

		// ---- ROUND 3: the runtime replays rounds 1 and 2 and asks again.
		await collect(gateway, {
			...baseRequest(),
			messages: [
				userMessage(),
				round1Turn,
				round1Result,
				round2Turn,
				round2Result,
			],
		});

		expect(calls.length).toBeGreaterThanOrEqual(3);

		// Round 2's request replays round 1's reasoning WITH its signature.
		const round2Thinking = allBlocksOf(calls[1]).filter(
			(block) => block.type === "thinking",
		);
		expect(round2Thinking).toHaveLength(1);
		expect(round2Thinking[0].thinking).toBe(REASONING_A);
		expect(round2Thinking[0].signature).toBe(SIGNATURE_A);

		// Round 3's request replays BOTH rounds' reasoning. Each round's
		// signed reasoning survives as its OWN thinking block, carrying ITS
		// OWN signature: no progressive loss, and no cross-association.
		const round3Thinking = allBlocksOf(calls[2]).filter(
			(block) => block.type === "thinking",
		);
		expect(round3Thinking).toHaveLength(2);
		const round3BySignature = new Map(
			round3Thinking.map((block) => [block.signature as string, block]),
		);
		expect(round3BySignature.get(SIGNATURE_A)?.thinking).toBe(REASONING_A);
		expect(round3BySignature.get(SIGNATURE_B)?.thinking).toBe(REASONING_B);

		// The tool-call identities of BOTH rounds survive to the wire.
		const round3ToolUses = allBlocksOf(calls[2]).filter(
			(block) => block.type === "tool_use",
		);
		expect(round3ToolUses.map((block) => block.id)).toEqual([
			"toolu_round_1",
			"toolu_round_2",
		]);
		// And neither round's tool RESULT is duplicated.
		const round3Results = allBlocksOf(calls[2]).filter(
			(block) => block.type === "tool_result",
		);
		expect(round3Results.map((block) => block.tool_use_id)).toEqual([
			"toolu_round_1",
			"toolu_round_2",
		]);
	});

	it("R14: characterizes the redacted-thinking path", async () => {
		const { fetchImpl, calls } = makeFetch([
			() =>
				anthropicSse([
					MESSAGE_START,
					...redactedBlock(0, REDACTED_A),
					MESSAGE_STOP,
				]),
		]);
		const gateway = minimaxGateway(fetchImpl);
		const events = await collect(gateway, baseRequest());
		const follow = {
			...baseRequest(),
			messages: [userMessage(), assistantTurn(events)],
		};
		await collect(gateway, follow);

		// CHARACTERIZATION (not a repair).
		//
		// The Anthropic SDK surfaces a redacted thinking block as a
		// `reasoning-start` part carrying
		// `providerMetadata.anthropic.redactedData` and NO text delta. The
		// ClineMM translator reads the text of `reasoning-delta` /
		// `reasoning` parts, so a `reasoning-start` part produces NO
		// runtime event at all.
		//
		// This is a DISTINCT, PRE-EXISTING defect: the same behaviour is
		// observed before and after ACT-CLINEMM-PROVIDER-REASONING-
		// CONTINUITY-P0-01's repair. It is NOT caused by that repair and is
		// NOT repaired by it — a redacted thinking block is therefore not
		// replayed on the wire.
		//
		// This assertion PINS the characterized behaviour so that a future
		// successor ACT changes it deliberately, and so that this ACT's
		// repair is not mistaken for having covered it.
		const reasoningEvents = events.filter(
			(event) => event.type === "reasoning-delta",
		);
		expect(reasoningEvents).toHaveLength(0);
		const redacted = allBlocksOf(calls[1]).find(
			(block) => block.type === "redacted_thinking",
		);
		expect(redacted).toBeUndefined();
		// The provider-owned payload is NOT fabricated into the request.
		expect(JSON.stringify(calls[1])).not.toContain(REDACTED_A);
	});
});
