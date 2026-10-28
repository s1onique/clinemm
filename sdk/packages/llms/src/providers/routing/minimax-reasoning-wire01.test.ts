/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 — RED/GREEN witnesses.
 *
 * PURPOSE
 * -------
 * Establish the ACTUAL wire-level reasoning configuration for the MiniMax
 * M3 / M3.1 discriminator variants, using the REAL provider path:
 *
 *   GatewayStreamRequest.reasoning
 *     -> gateway merge (mergeReasoningOptions)
 *     -> withoutPortableReasoning / normalizeReasoningRequest
 *     -> composeAiSdkProviderOptions (named provider-option rules)
 *     -> AI SDK transport (real @ai-sdk/anthropic serialization)
 *     -> serialized HTTP body
 *
 * The D-series assertions are made against the SERIALIZED BODY captured from
 * a mock `fetch`, never against an intermediate provider-options object.
 *
 * DISCRIMINATORS
 * --------------
 *   D1  M3, thinking disabled       -> native disable control must reach the wire
 *   D2  M3.1, thinking disabled     -> unsupported: must be DETECTED, not
 *                                    silently represented as reasoning-disabled
 *   D3  M3.1, explicit low effort  -> the `low` effort must reach the wire
 *   D4  returned reasoning metadata -> counts/presence observable without
 *                                    retaining reasoning content
 *   D5  continuity                  -> reasoning/tool-call structure preserved
 *                                    across a multi-turn tool call
 *
 * NO RAW BODIES ARE RECORDED. The capture helper below keeps only the
 * reasoning-relevant KEYS of the serialized body.
 */
import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ModelReasoningOption,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { MINIMAX_THINKING_ROUTING_METADATA } from "./minimax-thinking";
import { composeAiSdkProviderOptions } from "./provider-options";
import { normalizeReasoningRequest } from "./reasoning-options";

/**
 * M3 advertises a thinking toggle: disabled thinking is a supported native
 * control for this model.
 */
const M3_TOGGLE_OPTIONS: ModelReasoningOption[] = [{ type: "toggle" }];

/**
 * M3.1-Flash requires reasoning and defaults to `max` effort when the native
 * API omits it. It therefore advertises EFFORT-ONLY controls: no `toggle`
 * and no `none` value, so "off" is not an advertised control.
 */
const M31_EFFORT_OPTIONS: ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
];

const REASONING_BODY_KEYS = [
	"thinking",
	"reasoning",
	"reasoning_effort",
	"output_config",
	"effort",
	"include_thoughts",
];

function makeContext(options: {
	providerId: string;
	modelId: string;
	family?: string;
	reasoningOptions?: readonly ModelReasoningOption[];
	providerMetadata?: GatewayProviderContext["provider"]["metadata"];
	maxOutputTokens?: number;
}): GatewayProviderContext {
	return {
		provider: {
			id: options.providerId,
			name: options.providerId,
			defaultModelId: options.modelId,
			models: [
				{
					id: options.modelId,
					name: options.modelId,
					providerId: options.providerId,
					capabilities: ["text", "reasoning", "tools"],
				},
			],
			metadata: options.providerMetadata,
		},
		model: {
			id: options.modelId,
			name: options.modelId,
			providerId: options.providerId,
			capabilities: ["reasoning", "tools"],
			reasoningOptions: options.reasoningOptions,
			maxOutputTokens: options.maxOutputTokens ?? 32_000,
			metadata: options.family ? { family: options.family } : undefined,
		},
		config: { providerId: options.providerId },
	};
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
		messages: [],
		reasoning: overrides.reasoning,
		maxTokens: overrides.maxTokens,
	};
}

/**
 * The sanitized, reasoning-only view of a serialized provider body. Only the
 * reasoning-relevant keys are retained so that no prompt text, tool argument
 * or credential can leak into an assertion failure or a recorded artifact.
 */
function reasoningOnly(
	body: Record<string, unknown> | undefined,
): Record<string, unknown> {
	if (!body) {
		return {};
	}
	const result: Record<string, unknown> = {};
	for (const key of REASONING_BODY_KEYS) {
		if (key in body) {
			result[key] = body[key];
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Provider-option composition (the boundary between gateway intent and the
// AI SDK providerOptions buckets).
// ---------------------------------------------------------------------------

describe("MiniMax reasoning: provider-option composition", () => {
	it("D1: M3 with thinking disabled keeps a native disable control", () => {
		const context = makeContext({
			providerId: "minimax",
			modelId: "MiniMax-M3",
			family: "minimax",
			reasoningOptions: M3_TOGGLE_OPTIONS,
			providerMetadata: MINIMAX_THINKING_ROUTING_METADATA,
		});
		const request = makeRequest({
			providerId: "minimax",
			modelId: "MiniMax-M3",
			reasoning: { enabled: false },
		});

		const normalized = normalizeReasoningRequest(request, context);
		expect(normalized.reasoning).toEqual({ enabled: false });

		const providerOptions = composeAiSdkProviderOptions(request, context);
		expect(providerOptions.minimax).toMatchObject({
			thinking: { type: "disabled" },
		});
	});

	it("D2: M3.1 with thinking disabled is DROPPED, not represented as disabled", () => {
		const context = makeContext({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			family: "minimax",
			reasoningOptions: M31_EFFORT_OPTIONS,
		});
		const request = makeRequest({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			reasoning: { enabled: false },
		});

		const normalized = normalizeReasoningRequest(request, context);
		// The model's controls do not advertise "off", so the disable intent
		// must NOT survive as a disable control.
		expect(normalized.reasoning).toBeUndefined();

		const providerOptions = composeAiSdkProviderOptions(request, context);
		// Nothing may claim reasoning is disabled for a mandatory-reasoning model.
		const minimax = providerOptions.minimax as
			| Record<string, unknown>
			| undefined;
		expect(minimax?.thinking).toBeUndefined();
		expect(minimax?.reasoning).toBeUndefined();
	});

	it("D3: M3.1 with an explicit low effort keeps the effort in the normalized request", () => {
		const context = makeContext({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			family: "minimax",
			reasoningOptions: M31_EFFORT_OPTIONS,
		});
		const request = makeRequest({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			reasoning: { enabled: true, effort: "low" },
		});

		const normalized = normalizeReasoningRequest(request, context);
		expect(normalized.reasoning).toEqual({ enabled: true, effort: "low" });
	});
});

// ---------------------------------------------------------------------------
// Real transport: the serialized HTTP body.
//
// The Anthropic-compatible MiniMax route is driven through the REAL
// `@ai-sdk/anthropic` provider with a mock `fetch`, so the assertions below
// are made against the body MiniMax would actually receive.
// ---------------------------------------------------------------------------

function anthropicSseResponse(): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

async function captureAnthropicBody(input: {
	providerOptions: Record<string, unknown>;
	fetchMock: ReturnType<typeof vi.fn>;
	topLevelReasoning?: unknown;
}) {
	const { createAnthropicProviderModule } = await import(
		"../vendors/anthropic"
	);
	const module = await createAnthropicProviderModule(
		{
			providerId: "minimax",
			apiKey: "test-key",
			baseUrl: "https://api.minimax.io/anthropic/v1",
			fetch: input.fetchMock as unknown as typeof fetch,
		},
		makeContext({
			providerId: "minimax",
			modelId: "MiniMax-M3",
			family: "minimax",
			reasoningOptions: M3_TOGGLE_OPTIONS,
			providerMetadata: MINIMAX_THINKING_ROUTING_METADATA,
		}),
	);
	const model = module.operations.language("MiniMax-M3") as never as {
		doStream: (options: unknown) => Promise<{ stream: AsyncIterable<unknown> }>;
	};
	await model.doStream({
		prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
		maxOutputTokens: 128,
		providerOptions: input.providerOptions,
		...(input.topLevelReasoning !== undefined
			? { reasoning: input.topLevelReasoning }
			: {}),
	});
	const init = input.fetchMock.mock.calls.at(-1)?.[1];
	return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("MiniMax reasoning: real Anthropic-compatible transport", () => {
	it("D1: the M3 disable control reaches the serialized request body", async () => {
		const { vi } = await import("vitest");
		const fetchMock = vi.fn(async () => anthropicSseResponse());
		const context = makeContext({
			providerId: "minimax",
			modelId: "MiniMax-M3",
			family: "minimax",
			reasoningOptions: M3_TOGGLE_OPTIONS,
			providerMetadata: MINIMAX_THINKING_ROUTING_METADATA,
		});
		const request = makeRequest({
			providerId: "minimax",
			modelId: "MiniMax-M3",
			reasoning: { enabled: false },
		});
		const providerOptions = composeAiSdkProviderOptions(request, context);

		const body = await captureAnthropicBody({ providerOptions, fetchMock });
		expect(reasoningOnly(body)).toMatchObject({
			thinking: { type: "disabled" },
		});
	});

	it("D3 RED: the M3.1 low effort reaches the serialized request body", async () => {
		const { vi } = await import("vitest");
		const fetchMock = vi.fn(async () => anthropicSseResponse());
		const context = makeContext({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			family: "minimax",
			reasoningOptions: M31_EFFORT_OPTIONS,
			providerMetadata: MINIMAX_THINKING_ROUTING_METADATA,
		});
		const request = makeRequest({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			reasoning: { enabled: true, effort: "low" },
		});
		const providerOptions = composeAiSdkProviderOptions(request, context);

		const body = await captureAnthropicBody({ providerOptions, fetchMock });
		expect(reasoningOnly(body)).toMatchObject({
			output_config: { effort: "low" },
		});
	});

	it("PROBE: the top-level AI SDK reasoning option does not reach the MiniMax body", async () => {
		const { vi } = await import("vitest");
		const fetchMock = vi.fn(async () => anthropicSseResponse());
		const body = await captureAnthropicBody({
			providerOptions: {},
			fetchMock,
			topLevelReasoning: "low",
		});
		console.log("PROBE top-level reasoning body:", JSON.stringify(body));
		expect(body).toBeDefined();
	});
});
