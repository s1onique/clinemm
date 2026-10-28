/**
 * ACT-CLINEMM-M31-EXACT-MODEL-ID-WIRE-AUTHORITY01 — exact-model-ID wire witness.
 *
 * PURPOSE
 * -------
 * Establish whether the EXACT production MiniMax M3.1 model identifier
 *
 *     MiniMax-M3.1-Flash
 *
 * preserves the requested reasoning effort all the way to the serialized
 * Anthropic-compatible HTTP body.
 *
 * Boundaries under test, in order:
 *
 *   1. Registry resolution (REAL registry, REAL MiniMax builtin manifest)
 *   2. Reasoning-option normalization (REAL production code)
 *   3. Provider-option composition (REAL production code)
 *   4. Serialized transport body (REAL `@ai-sdk/anthropic` transport, with a
 *      controlled fetch replacement ONLY at the external network boundary)
 *
 * The model ID is kept in its original spelling throughout: nothing in this
 * witness lowercases it before the request is serialized.
 *
 * NO PROMPT TEXT, CREDENTIAL OR REASONING CONTENT IS RETAINED. The capture
 * helper keeps only the reasoning-relevant keys of the serialized body.
 */
import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { isUnsupportedReasoningConfigurationError } from "../errors";
import { createGateway } from "../gateway";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";

/** The exact official MiniMax M3.1 API model identifier. */
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/** The already-supported lower-case M3.1 identifiers (conservation). */
const LOWERCASE_M31_MODEL_IDS = [
	"minimax-m3.1-flash",
	"minimax/minimax-m3.1-flash",
] as const;

const EFFORT_LADDER = ["low", "medium", "high", "xhigh", "max"];

const REASONING_BODY_KEYS = [
	"model",
	"thinking",
	"reasoning",
	"reasoning_effort",
	"output_config",
	"effort",
];

/** The sanitized, reasoning-only view of a serialized provider body. */
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

function anthropicSseResponse(): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
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

function resolveModel(
	gateway: ReturnType<typeof makeGateway>,
	modelId: string,
) {
	return (
		gateway as unknown as {
			registry: {
				resolveModel: (selection: { providerId: string; modelId: string }) => {
					provider: { id: string };
					model: {
						id: string;
						capabilities?: readonly string[];
						reasoningOptions?: readonly {
							type: string;
							values?: readonly string[];
						}[];
					};
				};
			};
		}
	).registry.resolveModel({ providerId: "minimax", modelId });
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
	modelId: string;
	reasoning?: GatewayStreamRequest["reasoning"];
}): Promise<{
	body: Record<string, unknown> | undefined;
	fetchMock: ReturnType<typeof vi.fn>;
}> {
	const { fetchMock, fetch } = makeFetchMock();
	const gateway = makeGateway(fetch);
	const stream = await gateway.stream(
		makeRequest({
			providerId: "minimax",
			modelId: options.modelId,
			reasoning: options.reasoning,
		}),
	);
	// The transport happens while the stream is consumed.
	for await (const _event of stream) {
		// drain
	}
	const init = fetchMock.mock.calls.at(-1)?.[1];
	return {
		body:
			typeof init?.body === "string"
				? (JSON.parse(init.body) as Record<string, unknown>)
				: undefined,
		fetchMock,
	};
}

describe("MiniMax M3.1 exact model ID: registry resolution", () => {
	it("R1: the exact capitalized ID resolves with effort-only reasoning controls", () => {
		const gateway = makeGateway();
		const resolved = resolveModel(gateway, EXACT_M31_MODEL_ID);

		// The resolved ID must remain the SELECTED ID (no silent normalization).
		expect(resolved.model.id).toBe(EXACT_M31_MODEL_ID);
		expect(resolved.model.capabilities).toContain("reasoning");
		expect(resolved.model.reasoningOptions).toEqual([
			{ type: "effort", values: EFFORT_LADDER },
		]);
		// M3.1 mandates reasoning: no off toggle may be advertised.
		expect(
			resolved.model.reasoningOptions?.some((o) => o.type === "toggle"),
		).toBe(false);
	});

	it("R4: the already-supported lower-case M3.1 IDs keep their controls", () => {
		const gateway = makeGateway();
		for (const modelId of LOWERCASE_M31_MODEL_IDS) {
			const resolved = resolveModel(gateway, modelId);
			expect(resolved.model.reasoningOptions).toEqual([
				{ type: "effort", values: EFFORT_LADDER },
			]);
		}
	});
});

describe("MiniMax M3.1 exact model ID: serialized wire", () => {
	it("R2: the requested low effort reaches the serialized request body", async () => {
		const { body } = await captureGatewayBody({
			modelId: EXACT_M31_MODEL_ID,
			reasoning: { enabled: true, effort: "low" },
		});

		expect(reasoningOnly(body)).toMatchObject({
			model: EXACT_M31_MODEL_ID,
			output_config: { effort: "low" },
		});
		// The exact spelling must survive transport.
		expect(body?.model).toBe(EXACT_M31_MODEL_ID);
		// No conflicting reasoning-effort field, and no disabled thinking.
		expect(body?.reasoning_effort).toBeUndefined();
		expect(body?.effort).toBeUndefined();
		expect(body?.thinking).not.toMatchObject({ type: "disabled" });
	});

	it("R4: the lower-case M3.1 IDs keep their serialized low effort", async () => {
		for (const modelId of LOWERCASE_M31_MODEL_IDS) {
			const { body } = await captureGatewayBody({
				modelId,
				reasoning: { enabled: true, effort: "low" },
			});
			expect(body?.output_config).toMatchObject({ effort: "low" });
		}
	});
});

describe("MiniMax M3.1 exact model ID: unsupported reasoning-off", () => {
	it("R3: an explicit None is rejected before any transport call", async () => {
		const { fetchMock, fetch } = makeFetchMock();
		const gateway = makeGateway(fetch);
		const model = gateway.createAgentModel({
			providerId: "minimax",
			modelId: EXACT_M31_MODEL_ID,
		});

		await expect(
			model.stream({
				messages: makeMessages(),
				tools: [],
				options: { reasoning: { enabled: false, effort: "none" } },
			}),
		).rejects.toSatisfy(isUnsupportedReasoningConfigurationError);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("R3: the rejection names the supported effort alternatives", async () => {
		const gateway = makeGateway();
		const model = gateway.createAgentModel({
			providerId: "minimax",
			modelId: EXACT_M31_MODEL_ID,
		});
		await expect(
			model.stream({
				messages: makeMessages(),
				tools: [],
				options: { reasoning: { enabled: false, effort: "none" } },
			}),
		).rejects.toThrow(/low, medium, high, xhigh, max/);
	});

	it("R3: an anonymous disable keeps the model's own default behavior", async () => {
		const { fetchMock, fetch } = makeFetchMock();
		const gateway = makeGateway(fetch);
		const model = gateway.createAgentModel({
			providerId: "minimax",
			modelId: EXACT_M31_MODEL_ID,
		});

		const stream = await model.stream({
			messages: makeMessages(),
			tools: [],
			options: { thinking: false },
		});
		expect(stream).toBeDefined();
		await expect(
			(async () => {
				for await (const _event of stream) {
					// drain
				}
			})(),
		).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalled();
	});
});

describe("MiniMax M3.1 exact model ID: provider-option boundary", () => {
	it("R2: the exact ID selects the Anthropic-compatible effort bucket", async () => {
		const gateway = makeGateway();
		const resolved = resolveModel(gateway, EXACT_M31_MODEL_ID);
		// The REAL resolved provider carries the REAL MiniMax routing
		// metadata, so the route match is exercised as in production.
		const context = resolved as unknown as GatewayProviderContext;

		const { composeAiSdkProviderOptions } = await import("./provider-options");
		const { normalizeReasoningRequest } = await import("./reasoning-options");
		const request = makeRequest({
			providerId: "minimax",
			modelId: EXACT_M31_MODEL_ID,
			reasoning: { enabled: true, effort: "low" },
		});
		const normalized = normalizeReasoningRequest(request, context);
		expect(normalized.reasoning).toMatchObject({ effort: "low" });

		const options = composeAiSdkProviderOptions(request, context);
		expect(
			(options as { anthropic?: { effort?: string } }).anthropic?.effort,
		).toBe("low");
	});
});
