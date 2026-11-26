/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 (C1: evidence acquisition).
 *
 * PRIORITY 1 — REASONING USAGE AUTHORITY discriminator.
 *
 * Question: why does an output-exhausted response persist `outputTokens: 1`
 * even though it carries substantial generated reasoning?
 *
 * The chain under test (the REAL production chain, in order):
 *
 *   provider SSE response
 *     -> `@ai-sdk/anthropic` (real resolved provider SDK)
 *     -> AI SDK stream usage (`convertAnthropicUsage`)
 *     -> `normalizeUsage` (the production normalizer)
 *     -> the `usage` event the runtime consumes
 *     -> the per-message metrics the runtime persists
 *
 * Method: real gateway + real `@ai-sdk/anthropic` transport + a controlled
 * fetch replacement ONLY at the external network boundary. No paid
 * inference, no network.
 *
 * The MiniMax M3.1 fixtures in this package already model the Anthropic
 * Messages usage shape, so the discriminator reuses the SAME synthetic
 * provider fixture family.
 */

import type { GatewayStreamRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { normalizeUsage } from "../ai-sdk";
import { createGateway } from "../gateway";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/**
 * A synthetic Anthropic-shaped SSE response.
 *
 * `details` is the provider's `output_tokens_details` object, or undefined
 * when the provider reports no reasoning breakdown at all — which is the
 * frozen session's exhausted-response shape.
 */
function sse(
	outputTokens: number,
	details: string | undefined,
	inputTokens = 10,
	stopReason = "end_turn",
): Response {
	const detailsJson = details ? `,${details}` : "";
	const body = [
		`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":${inputTokens},"output_tokens":${outputTokens}${detailsJson}}}}\n\n`,
		`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stopReason}","stop_sequence":null},"usage":{"output_tokens":${outputTokens}}}\n\n`,
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

/**
 * The Anthropic Messages SSE contract reports usage in TWO places:
 *
 *   - `message_start` — the opening snapshot, carrying `input_tokens`,
 *     `output_tokens` and (optionally) `output_tokens_details`.
 *   - `message_delta` — the FINAL usage, carrying the authoritative
 *     `output_tokens` count for the completed message.
 *
 * The provider is free to report DIFFERENT values in the two places. This
 * helper therefore takes them separately, so the discriminator can
 * establish WHICH place the production chain reads.
 */
function sseTwoPhase(
	startOutputTokens: number,
	deltaOutputTokens: number,
	details: string | undefined,
	inputTokens = 10,
	stopReason = "end_turn",
): Response {
	const detailsJson = details ? `,${details}` : "";
	const body = [
		`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":${inputTokens},"output_tokens":${startOutputTokens}${detailsJson}}}}\n\n`,
		`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stopReason}","stop_sequence":null},"usage":{"output_tokens":${deltaOutputTokens}}}\n\n`,
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

/**
 * An Anthropic Messages SSE response that STREAMS actual thinking content:
 * a `thinking` content block carrying a `thinking_delta`, followed by a
 * `text` content block and the final usage frames.
 *
 * This is the fixture that exercises the real production path with a
 * response that actually carries reasoning — the shape the frozen
 * output-exhausted responses had. The reasoning CHARACTERS are not
 * converted into reasoning TOKENS: the token count comes only from the
 * provider's own reported breakdown.
 */
function sseWithThinking(
	details: string | undefined,
	thinkingText = "Let me work through this step by step.",
	inputTokens = 10,
	stopReason = "end_turn",
	startOutputTokens = 0,
	deltaOutputTokens = 900,
): Response {
	const detailsJson = details ? `,${details}` : "";
	const body = [
		`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":${inputTokens},"output_tokens":${startOutputTokens}${detailsJson}}}}\n\n`,
		`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":"sig_1"}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"${thinkingText}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
		`event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"done"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n`,
		`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stopReason}","stop_sequence":null},"usage":{"output_tokens":${deltaOutputTokens}}}\n\n`,
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
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

function makeRequest(): GatewayStreamRequest {
	return {
		providerId: "minimax",
		modelId: EXACT_M31_MODEL_ID,
		messages: [
			{
				id: "user_1",
				role: "user" as const,
				content: [{ type: "text" as const, text: "hello" }],
				createdAt: 1,
			},
		],
		reasoning: { enabled: true, effort: "low" },
		metadata: {
			sessionId: "session-usage-1",
			runId: "run-usage-1",
			iteration: 1,
		},
	};
}

/** Drive the REAL gateway and collect every `usage` event it emits. */
async function collectUsage(
	fetchImpl: typeof fetch,
): Promise<Array<Record<string, unknown>>> {
	const gateway = makeGateway(fetchImpl);
	const stream = await gateway.stream(makeRequest());
	const usages: Array<Record<string, unknown>> = [];
	for await (const event of stream) {
		if (event.type === "usage") {
			usages.push(
				(event as unknown as { usage: Record<string, unknown> }).usage,
			);
		}
	}
	return usages;
}

describe("ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01", () => {
	//
	// The INPUT / CACHE controls.
	//
	// The AI SDK's contract (`LanguageModelV4Usage`) states that
	// `inputTokens.total` is "the total number of input (prompt) tokens
	// used" and that `noCache`, `cacheRead` and `cacheWrite` are its
	// PARTS. The Anthropic Messages contract reports DISJOINT counters
	// (`input_tokens`, `cache_read_input_tokens`,
	// `cache_creation_input_tokens`), so the SDK's `total` is their SUM;
	// the OpenAI-family contract reports a `prompt_tokens` that ALREADY
	// INCLUDES `prompt_tokens_details.cached_tokens`.
	//
	// The normalization must therefore NOT add cache reads or writes to a
	// total that already includes them, and must NOT subtract them from a
	// total that excludes them either. The COMPLETE prompt is what the
	// compaction budget compares against the provider's context window, so
	// the normalized input must be the complete prompt.
	//
	it("preserves the Anthropic disjoint input and cache counters", () => {
		// Anthropic: input_tokens=3, cache_read=10, cache_creation=100.
		// The SDK's total is their sum: 113.
		const normalized = normalizeUsage({
			inputTokens: 113,
			inputTokenDetails: {
				noCacheTokens: 3,
				cacheReadTokens: 10,
				cacheWriteTokens: 100,
			},
			outputTokens: 176,
			totalTokens: 289,
			raw: {
				input_tokens: 3,
				cache_creation_input_tokens: 100,
				cache_read_input_tokens: 10,
				output_tokens: 176,
			},
		} as never);

		// The COMPLETE prompt, once — not the sum of the counters added to
		// a total that already contains them.
		expect(normalized.inputTokens).toBe(113);
		expect(normalized.cacheReadTokens).toBe(10);
		expect(normalized.cacheWriteTokens).toBe(100);
		// The cache counters are a PARTITION of the total: the uncached
		// remainder plus the two cache buckets equals the total.
		expect(3 + normalized.cacheReadTokens + normalized.cacheWriteTokens).toBe(
			normalized.inputTokens,
		);
	});

	it("preserves a total-inclusive cache accounting without double-counting", () => {
		// The OpenAI-family contract: prompt_tokens=9096 ALREADY INCLUDES
		// prompt_tokens_details.cached_tokens=9090.
		const normalized = normalizeUsage({
			inputTokens: 9096,
			inputTokenDetails: {
				noCacheTokens: 6,
				cacheReadTokens: 9090,
				cacheWriteTokens: null,
			},
			outputTokens: 77,
			totalTokens: 9173,
			raw: {
				prompt_tokens: 9096,
				prompt_tokens_details: { cached_tokens: 9090 },
				completion_tokens: 77,
			},
		} as never);

		// The total is NOT re-inflated by the cached portion.
		expect(normalized.inputTokens).toBe(9096);
		expect(normalized.cacheReadTokens).toBe(9090);
		// The cached portion is a SUBSET of the total.
		expect(normalized.cacheReadTokens).toBeLessThanOrEqual(
			normalized.inputTokens,
		);
	});

	it("preserves a LARGE cache-read count without re-inflating the total", () => {
		// The CMP-09 shape: a mostly-cached prompt with a small uncached
		// remainder.
		const normalized = normalizeUsage({
			inputTokens: 1_728_403,
			inputTokenDetails: {
				noCacheTokens: 166_087,
				cacheReadTokens: 1_562_316,
				cacheWriteTokens: 0,
			},
			outputTokens: 100,
			totalTokens: 1_728_503,
			raw: {
				prompt_tokens: 1_728_403,
				prompt_tokens_details: { cached_tokens: 1_562_316 },
				completion_tokens: 100,
			},
		} as never);

		expect(normalized.inputTokens).toBe(1_728_403);
		expect(normalized.cacheReadTokens).toBe(1_562_316);
		// The cached tokens are NOT subtracted from the context occupancy:
		// they are part of the prompt the provider actually received.
		expect(normalized.inputTokens - normalized.cacheReadTokens).toBe(166_087);
	});

	it("preserves explicit zero and absent cache metrics distinctly", () => {
		// EXPLICIT ZERO: the provider states the cache metrics are zero.
		const explicitZero = normalizeUsage({
			inputTokens: 100,
			inputTokenDetails: {
				noCacheTokens: 100,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
			outputTokens: 10,
		} as never);
		expect(explicitZero.inputTokens).toBe(100);
		expect(explicitZero.cacheReadTokens).toBe(0);
		expect(explicitZero.cacheWriteTokens).toBe(0);

		// ABSENT: the provider reports no cache metrics at all.
		const absent = normalizeUsage({
			inputTokens: 100,
			outputTokens: 10,
		} as never);
		expect(absent.inputTokens).toBe(100);
		expect(absent.cacheReadTokens).toBe(0);
		expect(absent.cacheWriteTokens).toBe(0);
	});
});

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 — reasoning usage authority", () => {
	it("reads the FINAL (message_delta) output count, not the opening snapshot", async () => {
		// The Anthropic Messages SSE contract reports usage in two places.
		// The production chain reads the FINAL one: the `message_delta`
		// usage is the authoritative count for the completed message.
		const twoPhase = vi.fn(async () =>
			sseTwoPhase(0, 1, undefined, 10, "max_tokens"),
		);
		const usages = await collectUsage(twoPhase as unknown as typeof fetch);
		const usage = usages[usages.length - 1];

		// The FINAL count (1) is what the runtime sees.
		expect(usage.outputTokens).toBe(1);
		// ...and NOT the opening snapshot alone.
		expect(usage.outputTokens).not.toBe(0);
	});

	it("does not add the opening snapshot to the final output count", async () => {
		// If the chain summed both phases, this would be 1 + 1 = 2.
		const twoPhase = vi.fn(async () =>
			sseTwoPhase(1, 1, undefined, 10, "max_tokens"),
		);
		const usages = await collectUsage(twoPhase as unknown as typeof fetch);
		const usage = usages[usages.length - 1];

		expect(usage.outputTokens).toBe(1);
	});

	it("CONSERVES the provider-reported reasoning count separately from output", async () => {
		// A provider that DOES report a nested reasoning count must have it
		// surfaced separately, and it must NOT be folded into the visible
		// output.
		//
		// The AI SDK's contract (`LanguageModelV4Usage`) states that
		// `outputTokens.total` is the TOTAL output and that `text` and
		// `reasoning` are its PARTS, so the visible output is the REMAINDER
		// and never an addition. With `output_tokens: 900` and
		// `reasoning_tokens: 800` the visible output is 100 and the
		// reasoning is 800 — and 100 + 800 == 900, the provider's own
		// total. The conservation law holds.
		//
		// The fixture produces no text content, so the production retry
		// middleware re-issues the request; the usage it reports therefore
		// covers SEVERAL physical attempts. The reasoning must be scoped to
		// exactly those attempts — which is why the assertion below is a
		// conservation assertion over the attempt count rather than a fixed
		// number.
		const withReasoning = vi.fn(async () =>
			sseTwoPhase(0, 900, '"output_tokens_details":{"reasoning_tokens":800}'),
		);
		const usages = await collectUsage(withReasoning as unknown as typeof fetch);
		const usage = usages[usages.length - 1];

		// The reasoning count IS surfaced, separately, and it is NOT
		// folded into the visible output.
		expect(typeof usage.reasoningTokenCount).toBe("number");
		const reasoning = usage.reasoningTokenCount as number;
		const visible = usage.outputTokens as number;

		// CONSERVATION: the visible output and the reasoning partition the
		// provider's reported output total. The total is the provider's own
		// `output_tokens` multiplied by the number of physical attempts the
		// turn made.
		const attempts = withReasoning.mock.calls.length;
		expect(attempts).toBeGreaterThan(0);
		expect(visible + reasoning).toBe(attempts * 900);
		// The reasoning is the per-attempt count, summed over the attempts.
		expect(reasoning).toBe(attempts * 800);
		// The visible output is the per-attempt remainder, summed over the
		// attempts — NOT the total, and NOT the total plus the remainder.
		expect(visible).toBe(attempts * 100);
	});

	it("CONSERVES the Anthropic-named thinking_tokens breakdown", async () => {
		// The Anthropic Messages contract names the reasoning breakdown
		// `thinking_tokens`. The AI SDK's Anthropic provider reads exactly
		// that name, so it is the NATIVE spelling of the same field the
		// OpenAI-family names `reasoning_tokens`. It must be surfaced, not
		// dropped, and it must obey the same conservation law.
		const withThinking = vi.fn(async () =>
			sseTwoPhase(0, 8192, '"output_tokens_details":{"thinking_tokens":7000}'),
		);
		const usages = await collectUsage(withThinking as unknown as typeof fetch);
		const usage = usages[usages.length - 1];

		const attempts = withThinking.mock.calls.length;
		const reasoning = usage.reasoningTokenCount as number;
		const visible = usage.outputTokens as number;

		expect(reasoning).toBe(attempts * 7000);
		// 8192 total - 7000 reasoning = 1192 visible, per attempt.
		expect(visible).toBe(attempts * 1192);
		// CONSERVATION: visible + reasoning == the provider's total.
		expect(visible + reasoning).toBe(attempts * 8192);
	});

	it("CONSERVES a streamed thinking-content response's reasoning breakdown", async () => {
		// A response that actually STREAMS thinking content. The reasoning
		// CHARACTERS are never converted into reasoning TOKENS: the token
		// count comes only from the provider's own reported breakdown.
		const streamed = vi.fn(async () =>
			sseWithThinking('"output_tokens_details":{"thinking_tokens":800}'),
		);
		const usages = await collectUsage(streamed as unknown as typeof fetch);
		const usage = usages[usages.length - 1];

		const attempts = streamed.mock.calls.length;
		expect(attempts).toBe(1);
		// The provider's own breakdown is surfaced...
		expect(usage.reasoningTokenCount).toBe(800);
		// ...and the visible output is the remainder of the provider's
		// reported total: 900 - 800 = 100.
		expect(usage.outputTokens).toBe(100);
		// CONSERVATION: visible + reasoning == the provider's total.
		expect(
			(usage.outputTokens as number) + (usage.reasoningTokenCount as number),
		).toBe(900);
	});

	it("reads the reasoning breakdown from the FINAL usage frame too", async () => {
		// The Anthropic Messages contract allows the provider to report the
		// breakdown in EITHER frame. The resolved `@ai-sdk/anthropic` adapter
		// reads `output_tokens_details` from the `message_delta` frame, so a
		// provider that reports it there has it picked up by the SDK's own
		// structured breakdown.
		// Build the fixture with the breakdown in the FINAL frame.
		const withFinalDetails = vi.fn(async () => {
			const body = [
				`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n`,
				`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":900,"output_tokens_details":{"thinking_tokens":800}}}\n\n`,
				'event: message_stop\ndata: {"type":"message_stop"}\n\n',
			].join("");
			return new Response(body, {
				headers: { "content-type": "text/event-stream" },
			});
		});

		const usages = await collectUsage(
			withFinalDetails as unknown as typeof fetch,
		);
		const usage = usages[usages.length - 1];

		// The breakdown is surfaced and the conservation law holds. The
		// fixture carries no text content, so the production retry
		// middleware re-issues the request; the reported usage therefore
		// covers SEVERAL physical attempts, and the breakdown must be
		// scoped to exactly those attempts.
		const attempts = withFinalDetails.mock.calls.length;
		expect(attempts).toBeGreaterThan(0);
		expect(usage.reasoningTokenCount).toBe(attempts * 800);
		expect(usage.outputTokens).toBe(attempts * 100);
		expect(
			(usage.outputTokens as number) + (usage.reasoningTokenCount as number),
		).toBe(attempts * 900);
	});

	it("NORMALIZES an absent Anthropic breakdown to the provider's reported total", async () => {
		// With NO reasoning breakdown reported, the emitted output is the
		// provider's own `output_tokens` — which for an output-exhausted
		// response is 1, regardless of how much reasoning was generated.
		const exhausted = vi.fn(async () =>
			sseTwoPhase(0, 1, undefined, 10, "max_tokens"),
		);
		const usages = await collectUsage(exhausted as unknown as typeof fetch);
		const usage = usages[usages.length - 1];

		const attempts = exhausted.mock.calls.length;
		expect(usage.outputTokens).toBe(attempts * 1);
		// The generated reasoning is NOT represented anywhere in the usage:
		// the provider reported no breakdown, so none is invented.
		expect(usage.reasoningTokenCount).toBeUndefined();
	});
});
