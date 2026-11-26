/**
 * ACT-CLINEMM-PROVIDER-COMPAT-REASONING-CONTINUITY-01.
 *
 * The COMPAT origin-authority conservation witness.
 *
 * The defect this file characterizes: the compat projection
 * (`toGatewayRequestMessages`, `providers/compat.ts`) converts a provider-visible
 * `thinking` block into a gateway `reasoning` part. It copies the SIGNATURE,
 * the call id and the details into the part's `metadata` bag — but it does NOT
 * copy the `originAuthority`.
 *
 * The consequence is a fail-closed SILENT LOSS: the outbound conversion
 * (`toAiSdkMessages`, `providers/ai-sdk.ts`) reads the origin from
 * `metadata[REASONING_METADATA_ORIGIN_KEY]` and gates the opaque payload
 * through `mayReplayOpaqueReasoning`. An ABSENT origin grants no replay
 * authority, so the signature is withheld and the Anthropic serializer drops
 * the whole thinking block — even though the block was signed by the very
 * endpoint the request is going to.
 *
 * Method (no paid inference, no network):
 *   - Drive the REAL production compat dispatch: `createGatewayApiHandler`
 *     -> `buildGatewayRequest` -> `toGatewayRequestMessages` -> the REAL
 *     gateway -> the REAL resolved Anthropic provider -> the REAL
 *     `@ai-sdk/anthropic` serializer.
 *   - Replace ONLY the external fetch: the injected fetch captures the
 *     outbound HTTP body and returns a synthetic Anthropic-shaped SSE stream.
 *
 * The positive control uses the PUBLISHED MiniMax Anthropic route, which is
 * the route the repository publishes for the `minimax` provider and therefore
 * the only route for which the production origin authority is ESTABLISHED.
 */

import { describe, expect, it } from "vitest";
import { createGatewayApiHandler } from "./compat";
import type { Message } from "./types";

/**
 * The PUBLISHED builtin MiniMax Anthropic route. It is the route the
 * repository publishes for the `minimax` provider, and therefore the ONLY
 * route for which the production origin authority is established.
 */
const MINIMAX_ANTHROPIC_BASE_URL = "https://api.minimax.io/anthropic/v1";

/**
 * The origin authority the production code computes for that route:
 * `${providerId}\u0000${origin}\u0000${path}`.
 *
 * This is the EXACT value the frozen session recorded on every signed
 * reasoning block, so the fixture reproduces the historical provenance.
 */
const MINIMAX_ORIGIN_AUTHORITY =
	"minimax\u0000https://api.minimax.io\u0000/anthropic/v1";

/** An origin authority for a DIFFERENT (incompatible) established route. */
const FOREIGN_ORIGIN_AUTHORITY =
	"anthropic\u0000https://api.anthropic.com\u0000/v1";

const SIGNED_REASONING_TEXT_A =
	"SIGNED-REASONING-BLOCK-A: a short, signed planning note.";
const SIGNED_REASONING_TEXT_B =
	"SIGNED-REASONING-BLOCK-B: a second, short, signed planning note.";
const SIGNATURE_A =
	"1f52df733bdd12c2bb050b1dabea3b2c785d3f93b297d6e66ad65e97bbe5a2b7";
const SIGNATURE_B =
	"395cce8a7271f37a2f04ee1c6df967b295e54fae990224335e8b82804e81fe8d";

/**
 * The provider-visible message shape the compat adapter consumes: content
 * blocks of type `thinking` / `tool_use` / `tool_result` carrying the
 * provider-owned opaque metadata on the block itself.
 *
 * This is the REAL production shape: `ThinkingContent.originAuthority` is
 * exactly what the production persistence codec writes
 * (`core/src/runtime/config/agent-message-codec.ts`).
 */
function compatHistory(
	options: {
		firstOriginAuthority?: string;
		secondOriginAuthority?: string;
		firstSignature?: string;
	} = {},
): Message[] {
	const firstOrigin = options.firstOriginAuthority;
	const secondOrigin = options.secondOriginAuthority;
	return [
		{
			role: "user",
			content: [
				{ type: "text", text: "Repair the terminal bounded correction." },
			],
		},
		{
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: SIGNED_REASONING_TEXT_A,
					signature: options.firstSignature ?? SIGNATURE_A,
					...(firstOrigin === undefined
						? {}
						: { originAuthority: firstOrigin }),
				},
				{
					type: "thinking",
					thinking: SIGNED_REASONING_TEXT_B,
					signature: SIGNATURE_B,
					...(secondOrigin === undefined
						? {}
						: { originAuthority: secondOrigin }),
				},
				{
					type: "tool_use",
					id: "call-01",
					name: "read_files",
					input: { files: [{ path: "/tmp/a.ts" }] },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call-01",
					content: "file contents",
				},
			],
		},
	] as unknown as Message[];
}

interface CapturedBody {
	url: string;
	body: Record<string, unknown>;
	raw: string;
}

/**
 * Drive the REAL production compat dispatch path and capture the outbound
 * HTTP body through an injected fetch.
 *
 * The ONLY substituted dependency is the external fetch.
 */
async function captureCompatOutboundBody(
	messages: Message[],
): Promise<CapturedBody> {
	let captured: CapturedBody | undefined;
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const raw = String(init?.body ?? "");
		captured = {
			url: String(input),
			body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
			raw,
		};
		const sse = [
			"event: message_start",
			'data: {"type":"message_start","message":{"id":"msg_synthetic","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}',
			"",
			"event: content_block_delta",
			'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
			"",
			"event: content_block_stop",
			'data: {"type":"content_block_stop","index":0}',
			"",
			"event: message_delta",
			'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
			"",
			"event: message_stop",
			'data: {"type":"message_stop"}',
			"",
		].join("\n");
		return new Response(sse, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}) as typeof fetch;

	const handler = createGatewayApiHandler({
		providerId: "minimax",
		modelId: "MiniMax-M3.1-Flash",
		apiKey: "test-key",
		baseUrl: MINIMAX_ANTHROPIC_BASE_URL,
		fetch: fetchImpl,
	} as never);

	const stream = handler.createMessage(
		"You are Cline, an AI coding agent.",
		messages,
	);
	for await (const _chunk of stream) {
		// drain
	}
	if (!captured) {
		throw new Error("no outbound request was captured");
	}
	return captured;
}

function findThinkingBlocks(
	body: Record<string, unknown>,
): Array<Record<string, unknown>> {
	const messages = (body.messages ?? []) as Array<Record<string, unknown>>;
	const found: Array<Record<string, unknown>> = [];
	for (const message of messages) {
		const content = (message.content ?? []) as Array<Record<string, unknown>>;
		for (const part of content) {
			if (part.type === "thinking" || part.type === "redacted_thinking") {
				found.push(part);
			}
		}
	}
	return found;
}

describe("ACT-CLINEMM-PROVIDER-COMPAT-REASONING-CONTINUITY-01 — compat origin authority", () => {
	it("CONSERVES two established signed reasoning blocks on the compat wire", async () => {
		// RED (pre-repair): the compat projection drops `originAuthority`, so the
		// fail-closed gate withholds both signatures and the Anthropic
		// serializer drops BOTH thinking blocks from the actual HTTP body.
		const captured = await captureCompatOutboundBody(
			compatHistory({
				firstOriginAuthority: MINIMAX_ORIGIN_AUTHORITY,
				secondOriginAuthority: MINIMAX_ORIGIN_AUTHORITY,
			}),
		);

		expect(captured.url).toContain("api.minimax.io");

		const thinkingBlocks = findThinkingBlocks(captured.body);
		expect(thinkingBlocks.length).toBe(2);

		// Both retain their ORIGINAL signatures, in order.
		expect(thinkingBlocks.map((block) => block.signature)).toEqual([
			SIGNATURE_A,
			SIGNATURE_B,
		]);

		// Both retain their EXACT thinking text, in order.
		expect(thinkingBlocks.map((block) => block.thinking)).toEqual([
			SIGNED_REASONING_TEXT_A,
			SIGNED_REASONING_TEXT_B,
		]);

		// The origin authority itself NEVER appears on the provider wire.
		expect(captured.raw).not.toContain(MINIMAX_ORIGIN_AUTHORITY);
		expect(captured.raw).not.toContain("originAuthority");
	});

	it("DENIES the replay of reasoning with an UNKNOWN origin", async () => {
		// An UNKNOWN-ORIGIN block (no recorded authority) must NOT reach the
		// wire with its opaque signature: the fail-closed gate withholds it.
		const captured = await captureCompatOutboundBody(
			compatHistory({
				firstOriginAuthority: undefined,
				secondOriginAuthority: undefined,
			}),
		);

		const thinkingBlocks = findThinkingBlocks(captured.body);
		for (const block of thinkingBlocks) {
			expect(block.signature).toBeUndefined();
		}
		expect(captured.raw).not.toContain(SIGNATURE_A);
		expect(captured.raw).not.toContain(SIGNATURE_B);
	});

	it("CONSERVES tool-call / tool-result identity and block ordering", async () => {
		const captured = await captureCompatOutboundBody(
			compatHistory({
				firstOriginAuthority: MINIMAX_ORIGIN_AUTHORITY,
				secondOriginAuthority: MINIMAX_ORIGIN_AUTHORITY,
			}),
		);

		// The tool identity survives the repair untouched.
		expect(captured.raw).toContain("call-01");
		expect(captured.raw).toContain("read_files");

		// The BLOCK ORDERING is preserved: the two signed thinking blocks
		// precede the tool call, and they keep their relative order.
		const messages = (captured.body.messages ?? []) as Array<
			Record<string, unknown>
		>;
		const assistant = messages.find(
			(message) => message.role === "assistant",
		) as { content?: Array<Record<string, unknown>> } | undefined;
		const content = assistant?.content ?? [];
		const types = content.map((part) => part.type);
		expect(types.indexOf("thinking")).toBeGreaterThanOrEqual(0);
		expect(types.indexOf("thinking")).toBeLessThan(types.indexOf("tool_use"));
		expect(content.filter((part) => part.type === "thinking").length).toBe(2);
	});

	it("leaves the CANONICAL history unchanged", async () => {
		// The repair is confined to the OUTBOUND compat projection. The
		// canonical (host-side) history the caller holds is never mutated.
		const messages = compatHistory({
			firstOriginAuthority: MINIMAX_ORIGIN_AUTHORITY,
			secondOriginAuthority: MINIMAX_ORIGIN_AUTHORITY,
		});
		const before = JSON.stringify(messages);

		await captureCompatOutboundBody(messages);

		expect(JSON.stringify(messages)).toBe(before);
	});

	it("DENIES the replay of reasoning with an INCOMPATIBLE origin", async () => {
		// A block issued by a DIFFERENT established route must not disclose its
		// opaque signature to the MiniMax route.
		const captured = await captureCompatOutboundBody(
			compatHistory({
				firstOriginAuthority: FOREIGN_ORIGIN_AUTHORITY,
				secondOriginAuthority: FOREIGN_ORIGIN_AUTHORITY,
			}),
		);

		expect(captured.raw).not.toContain(SIGNATURE_A);
		expect(captured.raw).not.toContain(SIGNATURE_B);
		expect(captured.raw).not.toContain(FOREIGN_ORIGIN_AUTHORITY);
	});
});
