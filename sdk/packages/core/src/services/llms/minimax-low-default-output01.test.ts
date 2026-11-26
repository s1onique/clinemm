/**
 * ACT-CLINEMM-MINIMAX-LOW-OUTPUT-DEFAULT-01.
 *
 * SESSION CONSTRUCTION PATH — a CLEAN installation inherits the MiniMax
 * M3.1 Flash LOW default generation allowance.
 *
 * PURPOSE
 * -------
 * The gateway-level witness
 * (`sdk/packages/llms/src/providers/routing/minimax-low-default-output01.test.ts`)
 * proves the DEFAULT at the wire boundary for a request built directly.
 * This witness proves the DEFAULT is inherited by a real SESSION: the
 * persisted provider settings are converted to a provider config, the
 * session's model handle is built by the production factory, and the
 * resulting request is serialized.
 *
 * The claim under test: a ClineMM installation with NO `models.json`
 * override and NO explicit per-turn limit runs the MiniMax-M3.1-Flash model
 * at LOW effort with an 8192-token per-response generation allowance, and
 * every other model keeps its own default.
 *
 * THE SEAM
 * --------
 * Only the external network boundary is substituted:
 *
 *   persisted settings
 *     -> toProviderConfig()            (sdk/packages/core, source)
 *     -> createAgentModelFromConfig()  (sdk/packages/core, source)
 *     -> gateway stream()               (@cline/llms, real)
 *     -> the Anthropic-compatible transport
 *     -> the CAPTURED outbound HTTP body
 *
 * NO LIVE INFERENCE. NO PAID REQUEST. SYNTHETIC SSE ONLY.
 */

import type { AgentConfig } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createAgentModelFromConfig } from "./handler-factory";
import { toProviderConfig } from "./provider-settings";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/**
 * The built-in default per-response generation allowance for
 * MiniMax-M3.1-Flash at LOW reasoning effort.
 */
const LOW_DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

/**
 * The gateway's synthesized default for every model that is NOT
 * MiniMax-M3.1-Flash at LOW effort: floor(524288 * 0.3) = 157286.
 */
const OTHER_DEFAULT_MAX_OUTPUT_TOKENS = 157_286;

/**
 * The body the stubbed fetch received for the most recent request.
 */
let capturedBody: Record<string, unknown> | undefined;

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

/**
 * Build the model handle the way the SESSION RUNTIME does, from persisted
 * provider settings, with NO `models.json` override and NO explicit
 * per-turn limit.
 */
function buildSessionModel(input: {
	modelId: string;
	effort?: "low" | "medium";
}) {
	const providerConfig = toProviderConfig({
		provider: "minimax",
		model: input.modelId,
		...(input.effort
			? { reasoning: { enabled: true, effort: input.effort } }
			: {}),
	});
	// The external network boundary is the ONLY substitution, and it is
	// installed BEFORE the model handle is built (the gateway captures the
	// fetch when the provider is created).
	const fetchStub = (async (_url: unknown, init: unknown) => {
		const requestInit = init as { body?: string } | undefined;
		capturedBody = JSON.parse(requestInit?.body ?? "{}");
		return anthropicSseResponse();
	}) as typeof fetch;
	(providerConfig as { fetch?: typeof fetch }).fetch = fetchStub;
	const agentConfig: AgentConfig = {
		providerId: "minimax",
		modelId: input.modelId,
		apiKey: "test-key",
		baseUrl: MINIMAX_BASE_URL,
		systemPrompt: "",
		tools: [],
		providerConfig,
	};
	return {
		model: createAgentModelFromConfig(agentConfig, undefined),
		providerConfig,
	};
}

/**
 * Stream one turn through the REAL transport and return the body the
 * stubbed fetch received.
 */
async function captureOutboundBody(input: {
	providerConfig: Record<string, unknown>;
	model: ReturnType<typeof createAgentModelFromConfig>;
}): Promise<Record<string, unknown>> {
	capturedBody = undefined;
	const stream = await input.model.stream({
		messages: [
			{
				id: "user_1",
				role: "user",
				content: [{ type: "text", text: "hi" }],
				createdAt: 1,
			},
		],
		tools: [],
		options: {
			reasoningEffort: input.providerConfig.reasoningEffort,
		},
	});
	for await (const _event of stream) {
		// drain the production stream
	}
	if (!capturedBody) {
		throw new Error("the stubbed fetch was never called");
	}
	return capturedBody;
}

describe("ACT-CLINEMM-MINIMAX-LOW-OUTPUT-DEFAULT-01 — the session construction path", () => {
	it("S1: a CLEAN installation inherits the 8192 LOW default", async () => {
		const { model, providerConfig } = buildSessionModel({
			modelId: EXACT_M31_MODEL_ID,
			effort: "low",
		});
		// No explicit per-turn limit is configured: the request inherits the
		// built-in default. (The catalog's `knownModels` are the GENERATED
		// catalog, not an installed `models.json` override.)
		expect(providerConfig.maxOutputTokens).toBeUndefined();

		const body = await captureOutboundBody({
			providerConfig: providerConfig as unknown as Record<string, unknown>,
			model,
		});
		expect(body.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		// LOW remains LOW.
		expect(body.output_config).toEqual({ effort: "low" });
	});

	it("S2: the same CLEAN installation keeps the existing default for MEDIUM", async () => {
		const { model, providerConfig } = buildSessionModel({
			modelId: EXACT_M31_MODEL_ID,
			effort: "medium",
		});
		const body = await captureOutboundBody({
			providerConfig: providerConfig as unknown as Record<string, unknown>,
			model,
		});
		expect(body.max_tokens).toBe(OTHER_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(body.output_config).toEqual({ effort: "medium" });
	});

	it("S3: the same CLEAN installation keeps the existing default for another model", async () => {
		const { model, providerConfig } = buildSessionModel({
			modelId: "MiniMax-M3",
			effort: "low",
		});
		const body = await captureOutboundBody({
			providerConfig: providerConfig as unknown as Record<string, unknown>,
			model,
		});
		expect(body.max_tokens).toBe(OTHER_DEFAULT_MAX_OUTPUT_TOKENS);
	});
});
