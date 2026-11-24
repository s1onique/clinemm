/**
 * ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01.
 *
 * C2/C3 — the SETTINGS-TO-WIRE composition for the three distinct
 * user-visible reasoning selections.
 *
 * ============================================================================
 * THE DEFECT THIS PINS
 * ============================================================================
 *
 * The reasoning-effort selector offered the user TWO states that the
 * production pipeline could not tell apart:
 *
 *   - "no explicit override" — the model/provider applies its own policy;
 *   - "None"                — the user EXPLICITLY disabled reasoning.
 *
 * The selector resolved an ABSENT persisted effort to the caller's
 * `defaultEffort`, and the callers passed `"none"`, so the ABSENT state was
 * DISPLAYED as `None`. Every `onEffortChange` handler then wrote
 *
 *     { enabled: effort !== "none", effort: effort !== "none" ? effort : undefined }
 *
 * which DISCARDED the explicit `"none"` value, and the provider-config
 * store discarded it again at persistence time:
 *
 *     merged.effort = reasoningPatch.effort === "none" ? undefined : reasoningPatch.effort
 *
 * The consequence was that the ONLY evidence of an explicit user selection
 * — the persisted `effort === "none"` — could never exist, so
 * `toProviderConfig()`'s `reasoningNoneSelected` was permanently false and
 * the production boundary could not tell "the user chose None" from
 * "reasoning was disabled for some other reason".
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * The witnesses traverse the REAL seams:
 *
 *   persisted settings
 *     -> toProviderConfig()            (sdk/packages/core, source)
 *     -> createAgentModelFromConfig()  (sdk/packages/core, source)
 *     -> gateway stream()               (@cline/llms, real)
 *     -> the AI SDK's openai-compatible adapter
 *     -> the WIRE BODY                 (the stubbed fetch's received body)
 *
 * It asserts the required observations: the absent state is `Default`, an
 * explicit `None` survives persistence and reaches the qualified
 * Qwen/Kurchatov outbound request as `reasoning_effort: "none"`, and the
 * conservation contracts that must NOT change (the anonymous-disable
 * semantics, the mandatory-reasoning rejection, M3's valid disabled-thinking
 * mode, and the positive reasoning levels).
 */

import { isUnsupportedReasoningConfigurationError } from "@cline/llms";
import type { AgentConfig } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createAgentModelFromConfig } from "./handler-factory";
import { type ProviderSettings, toProviderConfig } from "./provider-settings";

/**
 * The qualified Qwen/Kurchatov endpoint's provider and model.
 *
 * `qwen3.8-flash-next-q2_0` is the exact model the
 * ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 policy is allowlisted for, and
 * `openai-compatible` is the transport it is served over.
 */
const QUALIFIED_PROVIDER_ID = "openai-compatible";
const QUALIFIED_MODEL_ID = "qwen3.8-flash-next-q2_0";

/** MiniMax M3.1-Flash mandates reasoning and cannot be switched off. */
const M31_MODEL_ID = "minimax-m3.1-flash";

/** The catalog-published M3, whose controls include a thinking toggle. */
const M3_MODEL_ID = "MiniMax-M3";

/**
 * Build the model handle the way the session runtime does: the persisted
 * provider settings are converted to a provider config, and the session's
 * normalized `thinking` flag is carried on the agent config.
 */
function buildModel(settings: ProviderSettings, modelId: string) {
	const providerConfig = toProviderConfig({
		...settings,
		provider: "minimax",
		model: modelId,
	});
	const agentConfig: AgentConfig = {
		providerId: "minimax",
		modelId,
		apiKey: "test-key",
		systemPrompt: "",
		tools: [],
		thinking: settings.reasoning?.enabled,
		providerConfig,
	};
	return createAgentModelFromConfig(agentConfig, undefined);
}

/**
 * Stream one turn through the REAL transport and return the body the
 * stubbed fetch received.
 *
 * The stub answers a well-formed streaming response, so the production
 * stream parser runs to completion exactly as it does against the endpoint.
 */
async function captureOutboundBody(input: {
	readonly providerConfig: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
	let captured: Record<string, unknown> | undefined;
	const fetchStub = (async (_url: unknown, init: unknown) => {
		const requestInit = init as { body?: string } | undefined;
		captured = JSON.parse(requestInit?.body ?? "{}");
		const chunks = [
			'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
			'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}',
			'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}',
			"data: [DONE]",
			"",
		].join("\n\n");
		return new Response(chunks, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}) as typeof fetch;
	const { createHandlerAsync } = await import("@cline/llms");
	const handler = await createHandlerAsync({
		...(input.providerConfig as never),
		fetch: fetchStub,
	});
	for await (const _chunk of handler.createMessage("system prompt", [
		{ role: "user", content: "reasoning request" },
	])) {
		// drain the production stream
	}
	if (!captured) {
		throw new Error("the stubbed fetch was never called");
	}
	return captured;
}

describe("ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01 — the three selections", () => {
	it("C2.1: an ABSENT persisted effort is the `Default` state, not an explicit `None`", () => {
		// The absent effort must NOT manufacture explicit-None provenance:
		// the model keeps its own default.
		expect(
			toProviderConfig({
				provider: "minimax",
				model: M31_MODEL_ID,
			}).reasoningNoneSelected,
		).toBeFalsy();

		// And it must not manufacture an explicit disable either.
		expect(
			toProviderConfig({
				provider: "minimax",
				model: M31_MODEL_ID,
				reasoning: { enabled: undefined },
			}).reasoningNoneSelected,
		).toBeFalsy();
	});

	it("C2.2: an EXPLICIT persisted `None` IS explicit-None provenance", () => {
		expect(
			toProviderConfig({
				provider: "minimax",
				model: M31_MODEL_ID,
				reasoning: { enabled: false, effort: "none" },
			}).reasoningNoneSelected,
		).toBe(true);
	});

	it("C2.3: a POSITIVE persisted effort is neither an explicit disable nor an explicit None", () => {
		const config = toProviderConfig({
			provider: "minimax",
			model: M31_MODEL_ID,
			reasoning: { enabled: true, effort: "low" },
		});
		expect(config.reasoningNoneSelected).toBeFalsy();
		expect(config.reasoningEffort).toBe("low");
	});
});

describe("ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01 — the qualified Qwen/Kurchatov wire", () => {
	it("C3.1: an EXPLICIT `None` reaches the outbound request as reasoning_effort: none", async () => {
		// The persisted EXPLICIT `None` is the evidence of the user's
		// selection. It must survive the settings-to-wire composition and be
		// serialized as the provider's own `reasoning_effort: "none"`.
		const providerConfig = toProviderConfig({
			provider: QUALIFIED_PROVIDER_ID,
			model: QUALIFIED_MODEL_ID,
			reasoning: { enabled: false, effort: "none" },
		});
		const body = await captureOutboundBody({
			providerConfig: providerConfig as unknown as Record<string, unknown>,
		});
		expect(body.reasoning_effort).toBe("none");
	});

	it("C3.2: the ABSENT state sends NO reasoning parameter at all", async () => {
		// `Default` delegates the reasoning policy to the model/provider:
		// the request must not name a reasoning effort.
		const providerConfig = toProviderConfig({
			provider: QUALIFIED_PROVIDER_ID,
			model: QUALIFIED_MODEL_ID,
		});
		const body = await captureOutboundBody({
			providerConfig: providerConfig as unknown as Record<string, unknown>,
		});
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	it("C3.3: a POSITIVE effort reaches the outbound request unchanged", async () => {
		const providerConfig = toProviderConfig({
			provider: QUALIFIED_PROVIDER_ID,
			model: QUALIFIED_MODEL_ID,
			reasoning: { enabled: true, effort: "low" },
		});
		const body = await captureOutboundBody({
			providerConfig: providerConfig as unknown as Record<string, unknown>,
		});
		expect(body.reasoning_effort).toBe("low");
	});

	it("C3.4: the UI sentinel `default` is NEVER serialized as a provider reasoning effort", async () => {
		// The `default` sentinel is a UI-level value. If it ever reached the
		// wire it would name a reasoning effort the endpoint does not know.
		const providerConfig = toProviderConfig({
			provider: QUALIFIED_PROVIDER_ID,
			model: QUALIFIED_MODEL_ID,
			reasoning: { enabled: true, effort: "default" as never },
		});
		const body = await captureOutboundBody({
			providerConfig: providerConfig as unknown as Record<string, unknown>,
		});
		expect(body.reasoning_effort).not.toBe("default");
	});
});

describe("ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01 — conservation", () => {
	it("CONSERVES an ANONYMOUS disable on a model that mandates reasoning", async () => {
		// The persisted settings disable reasoning WITHOUT recording an
		// explicit `None` selection. The request must therefore keep the
		// model's own mandatory default and must NOT be rejected — the user
		// never selected `None`.
		const model = buildModel(
			{ provider: "minimax", reasoning: { enabled: false } },
			M31_MODEL_ID,
		);

		const stream = await model.stream({
			messages: [],
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
	});

	it("REJECTS an EXPLICIT persisted `None` on a model that mandates reasoning", async () => {
		const model = buildModel(
			{ provider: "minimax", reasoning: { enabled: false, effort: "none" } },
			M31_MODEL_ID,
		);

		await expect(
			model.stream({
				messages: [],
				tools: [],
				options: { thinking: false },
			}),
		).rejects.toSatisfy(isUnsupportedReasoningConfigurationError);
	});

	it("CONSERVES M3's valid disabled-thinking mode for both anonymous and explicit disables", async () => {
		// M3 advertises a thinking toggle, so disabling reasoning IS a
		// supported configuration for it — including when the user
		// explicitly selected `None`.
		for (const reasoning of [
			{ enabled: false },
			{ enabled: false, effort: "none" as const },
		]) {
			const model = buildModel({ provider: "minimax", reasoning }, M3_MODEL_ID);

			const stream = await model.stream({
				messages: [],
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
		}
	});
});
