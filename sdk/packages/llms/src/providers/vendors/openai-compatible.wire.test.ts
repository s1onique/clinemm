// Wire-contract tests for reasoning effort on OpenAI-compatible providers,
// exercised through the *real* `@ai-sdk/openai-compatible` adapter. That
// adapter writes the AI SDK's top-level `reasoning` value to the request as
// `reasoning_effort` unchanged, so whatever level the gateway picks is exactly
// what the endpoint receives. Each case streams one turn through the gateway
// with a stubbed fetch and asserts on the request body. Together they pin:
//
//   1. a level the model does not advertise is snapped to the nearest level
//      it does advertise, so endpoints with a short ladder (Kimi K3 accepts
//      only low, high and max) are not sent values they reject;
//   2. `max` reaches the wire, both for models that advertise it and as the
//      nearest advertised level for `xhigh`;
//   3. models the catalog does not describe get the requested level as-is;
//   4. disabling reasoning sends `none`, since default-on reasoning models
//      otherwise keep thinking, except to models known not to reason and
//      models whose catalog advertises no off option.
import type {
	GatewayStreamRequest,
	ModelInfo,
	ModelReasoningOption,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { isUnsupportedReasoningConfigurationError } from "../errors";
import { createGateway } from "../gateway";

const PROVIDER_ID = "nvidia";
const KIMI_K3_ID = "moonshotai/kimi-k3";
const KIMI_K3_EFFORTS: readonly ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "high", "max"] },
];

/**
 * Stream one turn and return the request body that reached the stubbed fetch.
 * The stub answers 400: only the request is under test. Passing
 * `reasoningOptions: undefined` leaves the model out of the provider config,
 * so the gateway resolves it as an unlisted id with no catalog facts.
 */
async function wireBody(input: {
	providerId?: string;
	modelId: string;
	reasoning: GatewayStreamRequest["reasoning"];
	reasoningOptions: readonly ModelReasoningOption[] | undefined;
	capabilities?: ModelInfo["capabilities"];
}): Promise<Record<string, unknown>> {
	const providerId = input.providerId ?? PROVIDER_ID;
	const configuredModel = input.reasoningOptions || input.capabilities;
	let body: Record<string, unknown> | undefined;
	const fetchStub = (async (_input, init) => {
		body = JSON.parse((init?.body as string) ?? "{}");
		return new Response(JSON.stringify({ error: { message: "stub" } }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId,
				apiKey: "test-key",
				fetch: fetchStub,
				// A config model overrides a builtin of the same id, so these
				// definitions decide what the gateway sees regardless of the catalog.
				...(configuredModel
					? {
							models: [
								{
									id: input.modelId,
									name: input.modelId,
									capabilities: input.capabilities ?? ["text", "reasoning"],
									...(input.reasoningOptions
										? { reasoningOptions: input.reasoningOptions }
										: {}),
								},
							],
						}
					: {}),
			},
		],
	});
	if (!configuredModel) {
		expect(
			gateway.listModels(providerId).map((model) => model.id),
		).not.toContain(input.modelId);
	}
	for await (const _event of await gateway.stream({
		providerId,
		modelId: input.modelId,
		reasoning: input.reasoning,
		maxTokens: 16,
		messages: [
			{
				id: "m1",
				role: "user",
				content: [{ type: "text", text: "hi" }],
				createdAt: 0,
			},
		],
	})) {
		// drain
	}
	if (!body) {
		throw new Error("the stubbed fetch was never called");
	}
	return body;
}

describe("OpenAI-compatible reasoning effort wire contract", () => {
	it.each([
		[{ effort: "minimal" }, "low"],
		[{ effort: "low" }, "low"],
		[{ effort: "medium" }, "high"],
		[{ effort: "high" }, "high"],
		[{ enabled: true }, "high"],
	] as const)("sends Kimi K3 an advertised level for %o", async (reasoning, expected) => {
		const body = await wireBody({
			modelId: KIMI_K3_ID,
			reasoning,
			reasoningOptions: KIMI_K3_EFFORTS,
		});
		expect(body.reasoning_effort).toBe(expected);
	});

	it.each([
		"xhigh",
		"max",
	] as const)("sends Kimi K3 max for %s", async (effort) => {
		const body = await wireBody({
			modelId: KIMI_K3_ID,
			reasoning: { effort },
			reasoningOptions: KIMI_K3_EFFORTS,
		});
		expect(body.reasoning_effort).toBe("max");
	});

	it.each([
		"medium",
		"xhigh",
		"max",
	] as const)("sends %s unchanged for a model the catalog does not list", async (effort) => {
		const body = await wireBody({
			modelId: "custom/kimi-k3-finetune",
			reasoning: { effort },
			reasoningOptions: undefined,
		});
		expect(body.reasoning_effort).toBe(effort);
	});
});

describe("OpenAI-compatible reasoning disable wire contract", () => {
	// ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01.
	//
	// The disable wire contract distinguishes the two user-visible states:
	//
	//   - an EXPLICIT `None` selection (`disableReason: "none"`) — the user
	//     CHOSE to disable reasoning. It must reach the wire as
	//     `reasoning_effort: "none"`, so the endpoint applies the user's
	//     policy instead of its own default.
	//
	//   - a DERIVED (anonymous) disable (`disableReason: "unknown"`) —
	//     reasoning was disabled for some other reason. It keeps the
	//     predecessor's provider-gated behavior: only a provider whose
	//     portable top-level option carries a reasoning level may be told
	//     "none", so the model keeps its own default.
	//
	// The predecessor asserted that EVERY disable reached the wire. That
	// assertion was already stale against the fork's provider gate; the
	// repair restores the explicit-selection case and keeps the derived
	// case gated.
	it("sends none for an EXPLICIT `None` on a model the catalog does not list", async () => {
		const body = await wireBody({
			modelId: "example/reasoning-model",
			reasoning: { enabled: false, disableReason: "none" },
			reasoningOptions: undefined,
		});
		expect(body.reasoning_effort).toBe("none");
	});

	it("sends none for an EXPLICIT `None` on a model that advertises it", async () => {
		const body = await wireBody({
			modelId: "example/reasoning-model",
			reasoning: { enabled: false, disableReason: "none" },
			reasoningOptions: [{ type: "effort", values: ["none", "low", "high"] }],
		});
		expect(body.reasoning_effort).toBe("none");
	});

	it("sends nothing to a model whose catalog has no off option", async () => {
		const body = await wireBody({
			modelId: KIMI_K3_ID,
			reasoning: { enabled: false },
			reasoningOptions: KIMI_K3_EFFORTS,
		});
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	it("sends nothing to a model known not to reason", async () => {
		const body = await wireBody({
			modelId: "example/non-reasoning-model",
			reasoning: { enabled: false },
			reasoningOptions: undefined,
			capabilities: ["text"],
		});
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	it("sends nothing to a model known not to reason, even for an EXPLICIT `None`", async () => {
		// A model the catalog says does not reason cannot be switched off,
		// so the disable is dropped rather than sent to an endpoint that
		// would reject it.
		const body = await wireBody({
			modelId: "example/non-reasoning-model",
			reasoning: { enabled: false, disableReason: "none" },
			reasoningOptions: undefined,
			capabilities: ["text"],
		});
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	it("REJECTS an EXPLICIT `None` on a model whose catalog has no off option", async () => {
		// The model mandates reasoning: it advertises no off option. The
		// production boundary REJECTS the explicit selection with the typed
		// error rather than silently letting the model's mandatory default
		// replace the user's choice.
		await expect(
			wireBody({
				modelId: KIMI_K3_ID,
				reasoning: { enabled: false, disableReason: "none" },
				reasoningOptions: KIMI_K3_EFFORTS,
			}),
		).rejects.toSatisfy(isUnsupportedReasoningConfigurationError);
	});
});
