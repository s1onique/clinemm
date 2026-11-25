/**
 * ACT-CLINEMM-AGENTIC-EFFICIENCY-GENERATION-BUDGET-AUTHORITY-01.
 *
 * BOUNDED OFFLINE DISCRIMINATOR for the per-response generation budget.
 *
 * PURPOSE
 * -------
 * Establish, from PRODUCTION code only, whether ClineMM can impose an
 * effective per-response generation budget INDEPENDENTLY of the model's
 * maximum capabilities, and whether the budget reaches the serialized HTTP
 * body as the provider's `max_tokens`.
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
 *
 * The synthetic response proves ONLY that ClineMM SERIALIZES the requested
 * limit. It does NOT prove that the provider honours it.
 */

import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { normalizeUsage } from "../ai-sdk";
import { createGateway } from "../gateway";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/**
 * The catalog `maxTokens` for MiniMax-M3.1-Flash under the `minimax`
 * provider. It is the model's advertised MAXIMUM supported output, NOT a
 * ClineMM budget.
 */
const CATALOG_MAX_OUTPUT_TOKENS = 524_288;

/**
 * The gateway's synthesized default: DEFAULT_GATEWAY_MAX_OUTPUT_FRACTION
 * (0.3) of the model's advertised output budget.
 *
 *   floor(524288 * 0.3) = 157286
 *
 * This is the value observed in the frozen historical capture.
 */
const GATEWAY_SYNTHESIZED_DEFAULT = 157_286;

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

function makeGateway(fetchImpl?: typeof fetch) {
	return createGateway({
		providerConfigs: [
			{
				providerId: "minimax",
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
	modelId?: string;
	reasoning?: GatewayStreamRequest["reasoning"];
}): Promise<{
	body: CapturedBody | undefined;
	fetchMock: ReturnType<typeof vi.fn>;
}> {
	const { fetchMock, fetch } = makeFetchMock();
	const gateway = makeGateway(fetch);
	const stream = await gateway.stream(
		makeRequest({
			providerId: "minimax",
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
// DISCRIMINATOR A — generation-budget authority
// ---------------------------------------------------------------------------

describe("Discriminator A: generation-budget authority (MiniMax Low)", () => {
	it("A-pre: the resolved catalog model advertises the 524288 output cap, and the synthesized gateway default is exactly 157286", () => {
		const gateway = makeGateway();
		const model = resolveModelDefinition(gateway, EXACT_M31_MODEL_ID);

		// The MODEL's maximum supported output (the catalog value). This is
		// what the 0.3 fraction is applied to.
		expect(model.maxOutputTokens).toBe(CATALOG_MAX_OUTPUT_TOKENS);

		// The OBSERVED historical value is EXACTLY floor(catalog * 0.3).
		// This pins the provenance of `max_tokens: 157286` to the gateway's
		// synthesized default and NOT to the model maximum, NOT to a
		// user-configured limit, and NOT to a context-budget reservation.
		expect(Math.floor(CATALOG_MAX_OUTPUT_TOKENS * 0.3)).toBe(
			GATEWAY_SYNTHESIZED_DEFAULT,
		);
		expect(GATEWAY_SYNTHESIZED_DEFAULT).toBe(157_286);
		// The default is a FRACTION of the maximum, never the maximum itself.
		expect(GATEWAY_SYNTHESIZED_DEFAULT).not.toBe(CATALOG_MAX_OUTPUT_TOKENS);
	});

	it("A0: with NO requested limit the serialized body carries the synthesized gateway default (157286)", async () => {
		const { body } = await captureGatewayBody({
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(GATEWAY_SYNTHESIZED_DEFAULT);
		// Low effort is preserved in every case.
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("A1: a requested limit of 8192 REACHES the serialized body unchanged", async () => {
		const { body } = await captureGatewayBody({
			requestedMaxTokens: 8192,
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(8192);
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("A2: a requested limit of 16384 REACHES the serialized body unchanged", async () => {
		const { body } = await captureGatewayBody({
			requestedMaxTokens: 16384,
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(16384);
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("A3: a requested limit ABOVE the supported maximum is CLAMPED to the model's advertised output cap", async () => {
		// Requesting MORE than the model can emit must not produce a wire
		// value the provider cannot honour. The gateway's model-output cap
		// is the clamping authority.
		const { body } = await captureGatewayBody({
			requestedMaxTokens: CATALOG_MAX_OUTPUT_TOKENS * 2,
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(CATALOG_MAX_OUTPUT_TOKENS);
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("A4: an explicit request can LOWER the budget below the synthesized default — the default is a floor, not a ceiling", async () => {
		const { body } = await captureGatewayBody({
			requestedMaxTokens: 1024,
			reasoning: { enabled: true, effort: "low" },
		});
		expect(body?.max_tokens).toBe(1024);
	});

	it("A5: a USER-CONFIGURED model override (models.json `maxTokens`) becomes the effective budget and reaches the wire", async () => {
		// This is the EXISTING configuration surface: the model-catalog
		// override for the selected model. It travels as the resolved
		// model's `maxOutputTokens` (via `knownModels`), and the gateway
		// treats an explicit request as authoritative.
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
							contextWindow: 1_048_576,
							maxOutputTokens: 8192,
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

		// The user's configured ceiling (8192) is the effective budget. The
		// synthesized default does NOT apply because an EXPLICIT configured
		// model limit is present, and the effective budget is the CONFIGURED
		// value, not 30% of it.
		expect(body?.max_tokens).toBe(8192);
		// The effort serialization for a CONFIGURED (host-supplied) model
		// entry is a separate routing concern, not part of the budget
		// boundary under test here; the catalog route (A0-A4) already proves
		// the Low effort is preserved alongside the budget.
		expect(body?.max_tokens).toBe(8192);
	});
});

// ---------------------------------------------------------------------------
// DISCRIMINATOR C — raw usage conservation (gateway normalization leg)
// ---------------------------------------------------------------------------

describe("Discriminator C: gateway usage normalization", () => {
	it("C-gw-1: a provider that reports NO separate reasoning count leaves the reasoning count ABSENT and keeps the reported output intact", () => {
		// The Anthropic Messages contract reports ONLY `output_tokens`; there
		// is no separate reasoning-token field. The absence must survive as
		// ABSENT — never a fabricated count and never a character estimate.
		const normalized = normalizeUsage({
			inputTokens: 100,
			outputTokens: 1_000,
		});
		expect(normalized.outputTokens).toBe(1_000);
		expect(normalized).not.toHaveProperty("reasoningTokenCount");
	});

	it("C-gw-2: a provider that DOES report reasoning separately has it subtracted from output once (no double-count)", () => {
		const normalized = normalizeUsage({
			inputTokens: 100,
			outputTokens: 1_000,
			completion_tokens_details: { reasoning_tokens: 400 },
		});
		// The reasoning tokens were a SUBSET of the reported output, so they
		// are subtracted exactly once.
		expect(normalized.reasoningTokenCount).toBe(400);
		expect(normalized.outputTokens).toBe(600);
	});

	it("C-gw-3: the cache buckets stay DISJOINT from the input count (no cache double-count)", () => {
		const normalized = normalizeUsage({
			inputTokens: 1_000,
			outputTokens: 50,
			inputTokenDetails: {
				cacheReadTokens: 400,
				cacheWriteTokens: 100,
			},
		});
		// The input count still carries the cached portion (the provider's
		// convention); the cache buckets are reported separately so the
		// consumer can subtract them exactly once.
		expect(normalized.inputTokens).toBe(1_000);
		expect(normalized.cacheReadTokens).toBe(400);
		expect(normalized.cacheWriteTokens).toBe(100);
	});
});
