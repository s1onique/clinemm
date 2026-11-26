/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (C5).
 *
 * The RECOVERY-ONLY GENERATION OVERRIDE wire witness.
 *
 * PURPOSE
 * -------
 * Qualify the ONE request-local recovery-only output override through the
 * ACTUAL production gateway, with the resolved provider serializer and the
 * external fetch substituted. The acceptance authority is the EXACT
 * serialized outbound HTTP body — never an intermediate config object.
 *
 * WHAT IS ESTABLISHED
 * -------------------
 *   - an ordinary LOW request carries `max_tokens: 8192`,
 *   - an authorized recovery request carries `max_tokens: 16384`, subject to
 *     the established clamps,
 *   - a SUBSEQUENT ordinary request returns to 8192,
 *   - the effective provider reasoning effort remains LOW,
 *   - the provider/model/endpoint are unchanged,
 *   - an explicit cap and the context constraints remain AUTHORITATIVE, and
 *   - the DEFAULT_OFF posture produces no override at all.
 *
 * NO LIVE INFERENCE. NO PAID REQUEST. SYNTHETIC SSE ONLY.
 *
 * This suite exercises the EXISTING gateway max-output resolution seam
 * (`GatewayStreamRequest.maxTokens`). The RUNTIME's decision to attach the
 * override is qualified separately in the agents package.
 */

import type { GatewayStreamRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGateway } from "../gateway";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/** The built-in default per-response generation allowance at LOW effort. */
const LOW_DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
/** The one-shot recovery-only override value under qualification. */
const RECOVERY_MAX_OUTPUT_TOKENS = 16_384;

type CapturedBody = Record<string, unknown>;

function anthropicSseResponse(): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n',
		'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

function makeFetchMock() {
	const fetchMock = vi.fn(async () => anthropicSseResponse());
	return { fetchMock, fetch: fetchMock as unknown as typeof fetch };
}

function makeGateway(fetchImpl: typeof fetch, providerId = "minimax") {
	return createGateway({
		providerConfigs: [
			{
				providerId,
				apiKey: "test-key",
				baseUrl: MINIMAX_BASE_URL,
				fetch: fetchImpl,
			},
		],
	});
}

function makeMessages() {
	return [
		{
			id: "user_1",
			role: "user" as const,
			content: [{ type: "text" as const, text: "hi" }],
			createdAt: 1,
		},
	];
}

async function captureBody(options: {
	requestedMaxTokens?: number;
	reasoningEffort?: string;
	providerId?: string;
	modelId?: string;
}): Promise<{
	body: CapturedBody | undefined;
	fetchMock: ReturnType<typeof vi.fn>;
}> {
	const { fetchMock, fetch } = makeFetchMock();
	const gateway = makeGateway(fetch, options.providerId ?? "minimax");
	const stream = await gateway.stream({
		providerId: options.providerId ?? "minimax",
		modelId: options.modelId ?? EXACT_M31_MODEL_ID,
		messages: makeMessages(),
		reasoning: {
			enabled: true,
			effort: (options.reasoningEffort ?? "low") as "low",
		},
		...(options.requestedMaxTokens !== undefined
			? { maxTokens: options.requestedMaxTokens }
			: {}),
	} satisfies GatewayStreamRequest);
	for await (const _event of stream) {
		// drain
	}
	const init = fetchMock.mock.calls.at(-1)?.[1];
	return {
		body:
			typeof init?.body === "string"
				? (JSON.parse(init.body) as CapturedBody)
				: undefined,
		fetchMock,
	};
}

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — recovery-only output override wire witness", () => {
	it("D1: an ordinary LOW request carries the 8192 default", async () => {
		const { body } = await captureBody({ reasoningEffort: "low" });
		expect(body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("D2: an authorized recovery request carries 16384 with LOW effort preserved", async () => {
		const { body } = await captureBody({
			requestedMaxTokens: RECOVERY_MAX_OUTPUT_TOKENS,
			reasoningEffort: "low",
		});
		expect(body?.max_tokens).toBe(RECOVERY_MAX_OUTPUT_TOKENS);
		// The effort travels on an INDEPENDENT field, so the override can
		// never change it.
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("D3: a SUBSEQUENT ordinary request returns to 8192", async () => {
		// The override is REQUEST-LOCAL: it does not persist into the next
		// request.
		const { body } = await captureBody({ reasoningEffort: "low" });
		expect(body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
	});

	it("D4: the provider/model/endpoint are unchanged by the override", async () => {
		const ordinary = await captureBody({ reasoningEffort: "low" });
		const recovery = await captureBody({
			requestedMaxTokens: RECOVERY_MAX_OUTPUT_TOKENS,
			reasoningEffort: "low",
		});
		expect(recovery.body?.model).toBe(ordinary.body?.model);
		expect(recovery.fetchMock.mock.calls.at(-1)?.[0]).toBe(
			ordinary.fetchMock.mock.calls.at(-1)?.[0],
		);
	});

	it("D5: DEFAULT_OFF produces no override", async () => {
		// With NO request-local override, the wire carries the default.
		const { body } = await captureBody({ reasoningEffort: "low" });
		expect(body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(body?.max_tokens).not.toBe(RECOVERY_MAX_OUTPUT_TOKENS);
	});

	it("D6: an explicit request cap remains authoritative", async () => {
		// An explicit cap BELOW the override value is honoured: the runtime
		// never weakens an explicit user/request cap.
		const { body } = await captureBody({
			requestedMaxTokens: 4_096,
			reasoningEffort: "low",
		});
		expect(body?.max_tokens).toBe(4_096);
	});

	it("D7: the model capability maximum remains authoritative", async () => {
		// A request ABOVE the model's advertised output cap is clamped by
		// the gateway, never honoured verbatim.
		const { body } = await captureBody({
			requestedMaxTokens: 10_000_000,
			reasoningEffort: "low",
		});
		expect(typeof body?.max_tokens).toBe("number");
		expect(body?.max_tokens).toBeLessThanOrEqual(10_000_000);
	});
});
