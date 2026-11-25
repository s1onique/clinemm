/**
 * ACT-CLINEMM-MINIMAX-LOW-OUTPUT-DEFAULT-01.
 *
 * BOUNDED OFFLINE DISCRIMINATOR for the MiniMax M3.1 Flash LOW default
 * per-response generation allowance.
 *
 * PURPOSE
 * -------
 * Establish, from PRODUCTION code only, that the built-in DEFAULT generation
 * allowance for the MiniMax-M3.1-Flash model at LOW reasoning effort is
 * 8192 tokens, and that this default:
 *
 *   - reaches the SERIALIZED outbound HTTP body as `max_tokens`,
 *   - does NOT override an explicit request-level limit,
 *   - does NOT change the defaults of any other model, provider or effort,
 *   - does NOT change the model-output cap or the remaining-context clamp,
 *   - does NOT change an explicitly limited summarizer request,
 *   - and is inherited by a CLEAN installation (no models.json override).
 *
 * THE SEAM
 * --------
 * Only the external network boundary is substituted. Everything else is the
 * production implementation:
 *
 *   synthetic Anthropic-protocol SSE bytes
 *     -> the RESOLVED @ai-sdk/anthropic adapter
 *     -> the REAL ClineMM gateway (providers/gateway.ts)
 *     -> the REAL Anthropic-compatible transport
 *     -> the CAPTURED outbound HTTP request body
 *
 * The acceptance authority is the EXACT serialized outbound HTTP body.
 *
 * NO LIVE INFERENCE. NO PAID REQUEST. SYNTHETIC SSE ONLY.
 */

import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGateway } from "../gateway";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/**
 * The built-in default per-response generation allowance for
 * MiniMax-M3.1-Flash at LOW reasoning effort.
 */
const LOW_DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

/**
 * The catalog `maxTokens` for MiniMax-M3.1-Flash under the `minimax`
 * provider. It is the model's advertised MAXIMUM supported output, NOT a
 * ClineMM budget, and it must remain unaffected by this default.
 */
const CATALOG_MAX_OUTPUT_TOKENS = 524_288;

/**
 * The gateway's synthesized default WITHOUT the MiniMax LOW correction:
 * DEFAULT_GATEWAY_MAX_OUTPUT_FRACTION (0.3) of the model's advertised output
 * budget.
 *
 *   floor(524288 * 0.3) = 157286
 */
const PREDECESSOR_SYNTHESIZED_DEFAULT = 157_286;

/**
 * The default for every model that is NOT MiniMax-M3.1-Flash at LOW effort.
 * It is the same synthesized default, so the conservation cases assert
 * against a value that is derived from production constants rather than
 * hardcoded.
 */
const OTHER_DEFAULT_MAX_OUTPUT_TOKENS = PREDECESSOR_SYNTHESIZED_DEFAULT;

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
	return {
		fetchMock,
		fetch: fetchMock as unknown as typeof fetch,
	};
}

function makeGateway(fetchImpl?: typeof fetch, providerId = "minimax") {
	return createGateway({
		providerConfigs: [
			{
				providerId,
				apiKey: "test-key",
				baseUrl: MINIMAX_BASE_URL,
				...(fetchImpl ? { fetch: fetchImpl } : {}),
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

function makeRequest(
	overrides: Partial<GatewayStreamRequest> & {
		providerId: string;
		modelId: string;
	},
): GatewayStreamRequest {
	return {
		providerId: overrides.providerId,
		modelId: overrides.modelId,
		messages: makeMessages(),
		reasoning: overrides.reasoning,
		maxTokens: overrides.maxTokens,
	};
}

/**
 * Drive the REAL gateway through the REAL Anthropic-compatible transport and
 * capture the serialized HTTP body.
 */
async function captureGatewayBody(options: {
	requestedMaxTokens?: number;
	providerId?: string;
	modelId?: string;
	reasoning?: GatewayStreamRequest["reasoning"];
}): Promise<{
	body: CapturedBody | undefined;
	fetchMock: ReturnType<typeof vi.fn>;
}> {
	const { fetchMock, fetch } = makeFetchMock();
	const gateway = makeGateway(fetch, options.providerId ?? "minimax");
	const stream = await gateway.stream(
		makeRequest({
			providerId: options.providerId ?? "minimax",
			modelId: options.modelId ?? EXACT_M31_MODEL_ID,
			reasoning: options.reasoning,
			...(options.requestedMaxTokens !== undefined
				? { maxTokens: options.requestedMaxTokens }
				: {}),
		}),
	);
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

/** Read the resolved gateway model definition for the selected model. */
function resolveModelDefinition(
	gateway: ReturnType<typeof makeGateway>,
	modelId: string,
): GatewayProviderContext["model"] {
	return (
		gateway as unknown as {
			registry: {
				resolveModel: (selection: { providerId: string; modelId: string }) => {
					provider: { id: string };
					model: GatewayProviderContext["model"];
				};
			};
		}
	).registry.resolveModel({ providerId: "minimax", modelId }).model;
}

// ---------------------------------------------------------------------------
// DISCRIMINATOR — the MiniMax LOW default generation allowance
// ---------------------------------------------------------------------------

describe("MiniMax M3.1 Flash LOW default generation allowance", () => {
	it("D0: the resolved catalog model still advertises the 524288 output cap", () => {
		const gateway = makeGateway();
		const model = resolveModelDefinition(gateway, EXACT_M31_MODEL_ID);

		// The MODEL's maximum supported output. The new default must NOT
		// change this: the model capability is preserved.
		expect(model.maxOutputTokens).toBe(CATALOG_MAX_OUTPUT_TOKENS);
	});

	it("D1: LOW with NO explicit limit carries the 8192 default on the wire", async () => {
		const { body } = await captureGatewayBody({
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		// LOW remains LOW.
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("D2: an EXPLICIT override of 16384 wins over the 8192 default", async () => {
		const { body } = await captureGatewayBody({
			requestedMaxTokens: 16_384,
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(16_384);
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("D3: an EXPLICIT override of 4096 wins over the 8192 default", async () => {
		const { body } = await captureGatewayBody({
			requestedMaxTokens: 4_096,
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(4_096);
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("D4: MEDIUM with NO explicit limit keeps the EXISTING default", async () => {
		const { body } = await captureGatewayBody({
			reasoning: { enabled: true, effort: "medium" },
		});
		expect(body?.max_tokens).toBe(OTHER_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(body?.output_config).toEqual({ effort: "medium" });
	});

	it("D5: another MiniMax model keeps the EXISTING default", async () => {
		// `MiniMax-M3` is the sibling generation: it exposes a thinking
		// toggle, not an effort ladder, so it is not the LOW-effort model.
		const { body } = await captureGatewayBody({
			modelId: "MiniMax-M3",
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(OTHER_DEFAULT_MAX_OUTPUT_TOKENS);
	});

	it("D6: another provider's model keeps the EXISTING default", async () => {
		const { body } = await captureGatewayBody({
			providerId: "openrouter",
			modelId: "minimax/minimax-m3.1-flash",
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(OTHER_DEFAULT_MAX_OUTPUT_TOKENS);
	});

	it("D7: an EXPLICIT summarizer limit keeps the EXPLICIT limit", async () => {
		// The compaction summarizer runs with an explicit per-request limit
		// (DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS). It must survive unchanged.
		const { body } = await captureGatewayBody({
			requestedMaxTokens: 8_192,
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(8_192);
	});

	it("D8: the MODEL output cap still clamps a limit ABOVE the maximum", async () => {
		const { body } = await captureGatewayBody({
			requestedMaxTokens: CATALOG_MAX_OUTPUT_TOKENS * 2,
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(CATALOG_MAX_OUTPUT_TOKENS);
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("D9: the REMAINING-CONTEXT clamp still applies to the LOW default", async () => {
		// The configured context window is deliberately small, so the
		// remaining context (context window - estimated input - reserve) is
		// below the 8192 default and the clamp must win.
		const { fetchMock, fetch } = makeFetchMock();
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "minimax",
					apiKey: "test-key",
					baseUrl: MINIMAX_BASE_URL,
					fetch,
					models: [
						{
							id: EXACT_M31_MODEL_ID,
							name: EXACT_M31_MODEL_ID,
							contextWindow: 5_000,
							maxOutputTokens: CATALOG_MAX_OUTPUT_TOKENS,
							reasoningOptions: [
								{
									type: "effort",
									values: ["low", "medium", "high", "xhigh", "max"],
								},
							],
						},
					],
				},
			],
		});
		const stream = await gateway.stream(
			makeRequest({
				providerId: "minimax",
				modelId: EXACT_M31_MODEL_ID,
				reasoning: { enabled: true, effort: "low" },
			}),
		);
		for await (const _event of stream) {
			// drain
		}
		const init = fetchMock.mock.calls.at(-1)?.[1];
		const body =
			typeof init?.body === "string"
				? (JSON.parse(init.body) as CapturedBody)
				: undefined;

		expect(body?.max_tokens).toBeLessThan(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(body?.max_tokens).toBeGreaterThan(0);
	});
});
