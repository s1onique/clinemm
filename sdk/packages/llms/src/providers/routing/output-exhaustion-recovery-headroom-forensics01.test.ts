/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 (C1: evidence acquisition).
 *
 * PRIORITY 4 — RECOVERY-ONLY GENERATION HEADROOM feasibility.
 *
 * Question: does an EXISTING request-level override permit ONE recovery
 * inference with 16384 output tokens, while preserving:
 *
 *   - the global 8192 default,
 *   - the selected LOW effort,
 *   - the model/provider identity,
 *   - the tool authorization,
 *   - the run's completion obligations?
 *
 * The answer is read from the PRODUCTION seam, not from a hypothetical:
 *
 *   `AgentModelRequest.options.maxTokens`
 *     -> `GatewayStreamRequest.maxTokens`
 *     -> `maxOutputTokens` on the AI SDK request
 *     -> the wire's `max_tokens`
 *
 * and the reasoning (effort) is carried on an INDEPENDENT field, so a
 * per-request output override cannot change it.
 *
 * This discriminator does NOT execute a paid inference: it drives the real
 * gateway with an injected fetch and asserts on the SERIALIZED body.
 */

import type { GatewayStreamRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGateway } from "../gateway";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";
/** The built-in per-response default for MiniMax M3.1 Flash at LOW effort. */
const LOW_DEFAULT_MAX_OUTPUT_TOKENS = 8192;

function makeFetchMock() {
	return vi.fn(async () => {
		const body = [
			'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		].join("");
		return new Response(body, {
			headers: { "content-type": "text/event-stream" },
		});
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

function makeRequest(maxTokens?: number): GatewayStreamRequest {
	return {
		providerId: "minimax",
		modelId: EXACT_M31_MODEL_ID,
		messages: [
			{
				id: "user_1",
				role: "user" as const,
				content: [{ type: "text" as const, text: "continue" }],
				createdAt: 1,
			},
		],
		reasoning: { enabled: true, effort: "low" },
		...(maxTokens === undefined ? {} : { maxTokens }),
		metadata: { sessionId: "s", runId: "r", iteration: 1 },
	};
}

async function captureBody(
	fetchImpl: typeof fetch,
	request: GatewayStreamRequest,
): Promise<Record<string, unknown> | undefined> {
	const gateway = makeGateway(fetchImpl);
	const stream = await gateway.stream(request);
	for await (const _event of stream) {
		// drain
	}
	const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.at(
		-1,
	)?.[1];
	return typeof init?.body === "string"
		? (JSON.parse(init.body) as Record<string, unknown>)
		: undefined;
}

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-FORENSICS-01 — recovery-only headroom", () => {
	it("keeps the 8192 default when NO per-request override is supplied", async () => {
		const fetchMock = makeFetchMock();
		const body = await captureBody(
			fetchMock as unknown as typeof fetch,
			makeRequest(),
		);

		expect(body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("permits ONE recovery request at 16384 WITHOUT changing the global default", async () => {
		const fetchMock = makeFetchMock();
		const body = await captureBody(
			fetchMock as unknown as typeof fetch,
			makeRequest(16_384),
		);

		// The recovery request carries the larger allowance.
		expect(body?.max_tokens).toBe(16_384);
		// LOW effort is PRESERVED: the output allowance and the effort are
		// independent fields.
		expect(body?.output_config).toEqual({ effort: "low" });
		// The provider/model identity is PRESERVED.
		expect(body?.model).toBe(EXACT_M31_MODEL_ID);
		// The reasoning mode is PRESERVED.
		expect(body?.thinking).toBeDefined();
	});

	it("does not mutate the DEFAULT for a subsequent request", async () => {
		// The override is per-request: a later request without one still
		// carries the 8192 default. So a single recovery inference cannot
		// change the global allowance.
		const fetchMock = makeFetchMock();
		await captureBody(
			fetchMock as unknown as typeof fetch,
			makeRequest(16_384),
		);
		const body = await captureBody(
			fetchMock as unknown as typeof fetch,
			makeRequest(),
		);

		expect(body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(body?.output_config).toEqual({ effort: "low" });
	});
});
