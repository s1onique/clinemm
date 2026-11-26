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

	it("reports a provider-reported reasoning count separately from output", async () => {
		// A provider that DOES report a nested reasoning count must have it
		// surfaced separately, and it must NOT be folded into outputTokens.
		//
		// The AI SDK's Anthropic provider computes the TEXT output as
		// `output_tokens - thinking_tokens` when the breakdown is present.
		// With `output_tokens: 900` and `reasoning_tokens: 800`, the AI
		// SDK's text output is 100 and its reasoning is 800. The FINAL
		// (`message_delta`) usage then contributes the provider's own
		// `output_tokens` again, so the production chain's emitted output
		// is 100 + 900 = 1900 — the reasoning is reported SEPARATELY and
		// is NOT folded into the visible output.
		const withReasoning = vi.fn(async () =>
			sseTwoPhase(0, 900, '"output_tokens_details":{"reasoning_tokens":800}'),
		);
		const usages = await collectUsage(withReasoning as unknown as typeof fetch);
		const usage = usages[usages.length - 1];

		// The reasoning count IS surfaced, separately.
		expect(usage.reasoningTokenCount).toBe(800);
		// The output count is the AI SDK's text remainder plus the final
		// usage's own output count.
		expect(usage.outputTokens).toBe(1900);
	});

	it("LOSES the Anthropic-named thinking_tokens breakdown at the normalizer", async () => {
		// The Anthropic Messages contract names the reasoning breakdown
		// `thinking_tokens`. The AI SDK's Anthropic provider reads exactly
		// that name. The production normalizer's reasoning-path vocabulary
		// does NOT include it — so the Anthropic-native name is DROPPED.
		const withThinking = vi.fn(async () =>
			sseTwoPhase(0, 8192, '"output_tokens_details":{"thinking_tokens":7000}'),
		);
		const usages = await collectUsage(withThinking as unknown as typeof fetch);
		const usage = usages[usages.length - 1];

		// The Anthropic-named breakdown is NOT surfaced: the metric is
		// ABSENT, so the 7000 reasoning tokens are unaccounted for.
		expect(usage.reasoningTokenCount).toBeUndefined();
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

		expect(usage.outputTokens).toBe(1);
		// The generated reasoning is NOT represented anywhere in the usage.
		expect(usage.reasoningTokenCount).toBeUndefined();
	});
});
