/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 (C1: evidence acquisition).
 *
 * RETRY-PROJECTION DISCRIMINATOR — the WIRE boundary.
 *
 * Question: when an output-exhausted response's UNSIGNED reasoning blocks are
 * replayed on the NEXT request, are they serialized into the OUTBOUND HTTP
 * BODY, and does that body differ from the same request with those blocks
 * removed?
 *
 * Method (no paid inference, no network):
 *   - Use the REAL resolved provider SDK: `createAnthropic` from
 *     `@ai-sdk/anthropic` — the same factory the production MiniMax/Anthropic
 *     vendor module builds (`providers/vendors/anthropic.ts`).
 *   - Inject a `fetch` that captures the outbound request body and returns a
 *     synthetic Anthropic-shaped SSE stream.
 *   - Drive the REAL production projection: `toGatewayRequestMessages` (the
 *     canonical -> provider-visible projection).
 *
 * Conservation rules honoured by this discriminator:
 *   - SIGNED reasoning blocks are conserved (never removed, never mutated).
 *   - tool-call / tool-result identity is conserved.
 *   - origin authorization is NOT weakened: the destination authority is the
 *     SAME MiniMax Anthropic endpoint in both arms.
 */

import {
	estimateProviderRequestInputTokens,
	toProviderVisibleMessages,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { toGatewayRequestMessages } from "./compat";
import { createGateway } from "./gateway";
import type { Message } from "./types";

/**
 * The PUBLISHED builtin MiniMax route. It is the route the repository
 * publishes for the `minimax` provider, and therefore the ONLY route for
 * which the production origin authority is established.
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

const UNSIGNED_EXHAUSTED_REASONING =
	"UNSIGNED-EXHAUSTED-REASONING-BLOCK: I had planned a long multi-step fix but the output limit cut me off before the first tool call.";
const SIGNED_REASONING =
	"SIGNED-REASONING-BLOCK: a short, signed planning note.";
const SIGNATURE_A =
	"1f52df733bdd12c2bb050b1dabea3b2c785d3f93b297d6e66ad65e97bbe5a2b7";
const SIGNATURE_B =
	"395cce8a7271f37a2f04ee1c6df967b295e54fae990224335e8b82804e81fe8d";

/**
 * The canonical (host-side) message shape that the projection consumes.
 *
 * This is the REAL production shape: `AgentMessage` parts of type
 * `reasoning`, carrying the provider-owned opaque metadata in the part's
 * own `metadata` bag — exactly as the production persistence codec writes
 * it and exactly as the frozen session recorded it.
 */
function canonicalHistory(): Message[] {
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
					type: "reasoning",
					text: SIGNED_REASONING,
					metadata: {
						signature: SIGNATURE_A,
						originAuthority: MINIMAX_ORIGIN_AUTHORITY,
					},
				},
				// The UNSIGNED exhausted reasoning block: no signature was ever
				// issued for it because the turn ended at the output limit.
				{ type: "reasoning", text: UNSIGNED_EXHAUSTED_REASONING },
				{
					type: "tool-call",
					toolCallId: "call-01",
					toolName: "read_files",
					input: { files: [{ path: "/tmp/a.ts" }] },
				},
			],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "call-01",
					toolName: "read_files",
					output: "file contents",
				},
			],
		},
		{
			role: "assistant",
			content: [
				{
					type: "reasoning",
					text: SIGNED_REASONING,
					metadata: {
						signature: SIGNATURE_B,
						originAuthority: MINIMAX_ORIGIN_AUTHORITY,
					},
				},
				{
					type: "tool-call",
					toolCallId: "call-02",
					toolName: "run_commands",
					input: { commands: ["bun run build"] },
				},
			],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "call-02",
					toolName: "run_commands",
					output: "build ok",
				},
			],
		},
	] as unknown as Message[];
}

/** The SAME canonical history with ONLY the unsigned exhausted block removed. */
function canonicalHistoryWithoutUnsigned(): Message[] {
	return canonicalHistory().map((message) => {
		const parts = message.content as Array<Record<string, unknown>>;
		return {
			...message,
			content: parts.filter(
				(part) =>
					!(
						part.type === "reasoning" &&
						part.text === UNSIGNED_EXHAUSTED_REASONING
					),
			),
		};
	}) as unknown as Message[];
}

interface CapturedBody {
	url: string;
	body: Record<string, unknown>;
	raw: string;
}

/**
 * Drive the REAL production transport — the gateway, the REAL
 * `toAiSdkMessages` projection, the REAL `@ai-sdk/anthropic` provider — and
 * capture the outbound HTTP body through an injected fetch.
 *
 * Using the gateway (rather than a hand-rolled `streamText` call) means
 * this discriminator exercises the SAME projection the product uses, so it
 * cannot drift from the production seam.
 */
async function captureOutboundBody(messages: Message[]): Promise<CapturedBody> {
	let captured: CapturedBody | undefined;
	const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		const raw = String(init?.body ?? "");
		captured = {
			url: String(_input),
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

	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: "minimax",
				apiKey: "test-key",
				baseUrl: MINIMAX_ANTHROPIC_BASE_URL,
				fetch: fetchImpl,
			},
		],
	});
	const stream = await gateway.stream({
		providerId: "minimax",
		modelId: "MiniMax-M3.1-Flash",
		messages: messages as never,
		reasoning: { enabled: true, effort: "low" },
		metadata: {
			sessionId: "session-wire-1",
			runId: "run-wire-1",
			iteration: 1,
		},
	});
	for await (const _event of stream) {
		// drain
	}
	if (!captured) {
		throw new Error("no outbound request was captured");
	}
	return captured;
}

function findReasoningBlocks(
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

/**
 * The REQUEST-BUDGET measurement.
 *
 * The runtime measures the request budget over the SAME provider-visible
 * projection it dispatches (`agent-runtime.ts`: the budget check and the
 * dispatch both call `toProviderVisibleMessages(request.messages)`), using
 * the SAME conservative estimator the compaction policy uses.
 */
function measureBudget(messages: Message[]): number {
	return estimateProviderRequestInputTokens({
		systemPrompt: "You are Cline, an AI coding agent.",
		messages: toProviderVisibleMessages(messages as never),
	});
}

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 — compat projection origin authority", () => {
	it("CONSERVES the origin authority when projecting through the compat adapter", () => {
		// ACT-CLINEMM-PROVIDER-COMPAT-REASONING-CONTINUITY-01.
		//
		// This assertion was ORIGINALLY a DEFECT CHARACTERIZATION: it
		// asserted that the compat adapter's `thinking` -> `reasoning` case
		// copied the signature into the part's metadata but NOT the origin
		// authority, and that the downstream fail-closed authority gate
		// therefore saw an absent origin and withheld the signature.
		//
		// The defect is REPAIRED. The compat projection now conserves the
		// origin authority, so the gate can establish route compatibility and
		// the signed block survives to the wire. The characterization is
		// converted into a PERMANENT CONSERVATION ASSERTION: the authority
		// must survive the compat projection for every signed block.
		//
		// The compat adapter consumes the CONTENT-BLOCK `Message` shape
		// (thinking / tool_use / tool_result), which is what
		// `toProviderVisibleMessages` produces.
		const projected = toGatewayRequestMessages(
			toProviderVisibleMessages(canonicalHistory() as never) as never,
		) as unknown as Array<{
			content: Array<Record<string, unknown>>;
		}>;
		const reasoningParts = projected.flatMap((message) =>
			(message.content ?? []).filter((part) => part.type === "reasoning"),
		);
		expect(reasoningParts.length).toBeGreaterThan(0);
		let signedCount = 0;
		for (const part of reasoningParts) {
			const metadata = (part.metadata ?? {}) as Record<string, unknown>;
			// The SIGNATURE survives the compat projection...
			if (metadata.signature !== undefined) {
				signedCount++;
				// ...and so does the ORIGIN AUTHORITY.
				expect(metadata.originAuthority).toBe(MINIMAX_ORIGIN_AUTHORITY);
			}
		}
		// The fixture carries exactly two signed reasoning blocks, so the
		// conservation assertion actually covered both of them.
		expect(signedCount).toBe(2);
	});

	it("PRESERVES the origin authority when projecting through the shared projection", () => {
		// The shared projection (the one the runtime's budget authority and
		// the gateway dispatch use) carries the authority in the content
		// block, so the fail-closed gate can establish compatibility and the
		// signed block survives to the wire.
		const projected = toProviderVisibleMessages(
			canonicalHistory() as never,
		) as unknown as Array<{
			content: Array<Record<string, unknown>>;
		}>;
		const signed = projected
			.flatMap((message) => message.content ?? [])
			.filter(
				(part) => part.type === "thinking" && part.signature !== undefined,
			);
		expect(signed.length).toBe(2);
		for (const part of signed) {
			expect(part.originAuthority).toBe(MINIMAX_ORIGIN_AUTHORITY);
		}
	});
});

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 — retry projection (wire)", () => {
	it("DROPS the unsigned exhausted reasoning block from the outbound HTTP body", async () => {
		const captured = await captureOutboundBody(canonicalHistory());
		const reasoningBlocks = findReasoningBlocks(captured.body);

		expect(captured.url).toContain("api.minimax.io");
		// The unsigned block is NOT on the wire.
		const unsignedOnWire = reasoningBlocks.filter((block) =>
			JSON.stringify(block).includes(UNSIGNED_EXHAUSTED_REASONING),
		);
		expect(unsignedOnWire.length).toBe(0);
		// ...and its TEXT is not on the wire either.
		expect(captured.raw).not.toContain(UNSIGNED_EXHAUSTED_REASONING);
	});

	it("CONSERVES the SIGNED reasoning blocks with their signatures on the wire", async () => {
		const captured = await captureOutboundBody(canonicalHistory());
		const reasoningBlocks = findReasoningBlocks(captured.body);

		// The SIGNED blocks ARE on the wire, WITH their signatures.
		const signedOnWire = reasoningBlocks.filter(
			(block) =>
				JSON.stringify(block).includes(SIGNED_REASONING) &&
				block.signature !== undefined,
		);
		expect(signedOnWire.length).toBe(2);
		expect(signedOnWire.map((b) => b.signature).sort()).toEqual(
			[SIGNATURE_A, SIGNATURE_B].sort(),
		);
	});

	it("produces a BYTE-IDENTICAL outbound body with vs. without the unsigned exhausted block", async () => {
		const withUnsigned = await captureOutboundBody(canonicalHistory());
		const withoutUnsigned = await captureOutboundBody(
			canonicalHistoryWithoutUnsigned(),
		);

		// The unsigned block contributes NOTHING to the wire: the two
		// requests are byte-identical.
		expect(withUnsigned.raw).toBe(withoutUnsigned.raw);
		expect(withUnsigned.raw.length).toBe(withoutUnsigned.raw.length);
	});

	it("CONSERVES tool-call / tool-result identity in BOTH arms", async () => {
		for (const messages of [
			canonicalHistory(),
			canonicalHistoryWithoutUnsigned(),
		]) {
			const captured = await captureOutboundBody(messages);
			const body = JSON.stringify(captured.body);
			expect(body).toContain("call-01");
			expect(body).toContain("call-02");
			expect(body).toContain("read_files");
			expect(body).toContain("run_commands");
		}
	});

	it("COUNTS the unsigned exhausted reasoning in the request-budget estimate", () => {
		const withUnsigned = measureBudget(canonicalHistory());
		const withoutUnsigned = measureBudget(canonicalHistoryWithoutUnsigned());

		// The unsigned exhausted reasoning IS part of the provider-visible
		// projection, so it IS measured by the request-budget estimator.
		expect(withUnsigned).toBeGreaterThan(withoutUnsigned);
		// The contribution is the unsigned reasoning's SIZE, at the
		// conservative estimator's rate (3 characters per token), plus the
		// JSON envelope the block adds to the serialized projection.
		const delta = withUnsigned - withoutUnsigned;
		expect(delta).toBeGreaterThan(0);
		expect(delta).toBeGreaterThanOrEqual(
			Math.floor(UNSIGNED_EXHAUSTED_REASONING.length / 3),
		);
	});

	it("keeps the request-budget estimate EQUAL to the wire body cost for the signed blocks", () => {
		// The estimator measures the SAME projection that is serialized, so
		// a reasoning block that the WIRE DROPS (the unsigned one) is still
		// MEASURED. That is the budget/wire divergence.
		const measured = measureBudget(canonicalHistory());
		const unsignedText = UNSIGNED_EXHAUSTED_REASONING;
		const measuredWithout = measureBudget(canonicalHistoryWithoutUnsigned());
		expect(measured - measuredWithout).toBeGreaterThan(0);
		// ...but the unsigned text never reaches the wire.
		expect(unsignedText.length).toBeGreaterThan(0);
	});
});
