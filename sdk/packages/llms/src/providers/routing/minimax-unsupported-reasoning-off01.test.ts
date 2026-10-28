/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 — D2 CORRECTION.
 *
 * THE DEFECT THIS PINS
 * --------------------
 * The D2 witnesses established that the UI CAN select `None` for MiniMax
 * M3.1 and that the session translates it to `thinking: false`. But the
 * normalization boundary handled the unsupported disablement by returning
 *
 *     { ...request, reasoning: undefined }
 *
 * The request then proceeded with the model's MANDATORY reasoning default.
 * That is a valid wire configuration, but the user's EXPLICIT `None`
 * selection had been silently discarded — the request ran with a reasoning
 * policy the user did not select, and the user received no signal that
 * their selection was dropped.
 *
 * THE CONTRACT THIS PINS
 * ----------------------
 * At the PRODUCTION BOUNDARY (the gateway's `stream()`), an explicit
 * `None` selection on a model that MANDATES reasoning is REJECTED with a
 * TYPED error (`UnsupportedReasoningConfigurationError`) BEFORE any
 * transport happens. The request never reaches the provider, and the user
 * gets a visible, actionable result instead of a silent substitution.
 *
 * A disable WITHOUT an explicit user selection keeps the pre-existing
 * behavior: the model applies its own default. This is what makes the
 * correction bounded — it changes the explicit-`None` case only.
 *
 * The valid M3 disabled-thinking mode is preserved: M3 advertises a
 * thinking toggle, so `thinking: false` remains a SUPPORTED configuration
 * for M3 and must not be rejected.
 */

import { describe, expect, it } from "vitest";
import {
	isUnsupportedReasoningConfigurationError,
	UnsupportedReasoningConfigurationError,
} from "../errors";
import { createGateway } from "../gateway";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";

/**
 * The M3.1 model the shared catalog does NOT publish, so it resolves as an
 * unregistered model carrying the provider-declared effort-only controls.
 */
const M31_MODEL_ID = "minimax-m3.1-flash";

/** The catalog-published M3, whose controls include a thinking toggle. */
const M3_MODEL_ID = "MiniMax-M3";

function makeGateway() {
	return createGateway({
		providerConfigs: [
			{
				providerId: "minimax",
				apiKey: "test-key",
				baseUrl: MINIMAX_BASE_URL,
			},
		],
	});
}

/**
 * Resolve a model through the REAL registry, so a regression in the
 * manifest/metadata plumbing is caught too.
 */
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
						reasoningOptions?: readonly unknown[];
					};
				};
			};
		}
	).registry.resolveModel({ providerId: "minimax", modelId });
}

describe("D2 correction: unsupported reasoning-off is explicit, never silent", () => {
	it("D2c: M3.1 MANDATES reasoning — it advertises no off affordance", () => {
		const gateway = makeGateway();
		const resolved = resolveModel(gateway, M31_MODEL_ID);

		// The M3.1 controls are EFFORT-ONLY: no toggle, and no "none"
		// value among the advertised efforts.
		const options = resolved.model.reasoningOptions as
			| readonly { type: string; values?: readonly string[] }[]
			| undefined;
		expect(options).toBeDefined();
		expect(options?.some((option) => option.type === "toggle")).toBe(false);
		expect(options?.some((option) => option.values?.includes("none"))).toBe(
			false,
		);
	});

	it("D2c: an EXPLICIT None on M3.1 is REJECTED with a typed error before transport", async () => {
		const gateway = makeGateway();
		const model = gateway.createAgentModel({
			providerId: "minimax",
			modelId: M31_MODEL_ID,
		});

		// The explicit `None` selection: the user picked the `None` effort.
		await expect(
			model.stream({
				messages: [],
				tools: [],
				options: { reasoning: { enabled: false, effort: "none" } },
			}),
		).rejects.toSatisfy(isUnsupportedReasoningConfigurationError);
	});

	it("D2c: the typed error names the model and the supported alternatives", async () => {
		const gateway = makeGateway();
		const model = gateway.createAgentModel({
			providerId: "minimax",
			modelId: M31_MODEL_ID,
		});

		const error = await model
			.stream({
				messages: [],
				tools: [],
				options: { reasoning: { enabled: false, effort: "none" } },
			})
			.then(
				() => undefined,
				(caught: unknown) => caught,
			);

		expect(error).toBeInstanceOf(UnsupportedReasoningConfigurationError);
		const typed = error as UnsupportedReasoningConfigurationError;
		expect(typed.providerId).toBe("minimax");
		expect(typed.modelId).toBe(M31_MODEL_ID);
		// The message names the supported alternatives so the user can act.
		expect(typed.message).toContain(M31_MODEL_ID);
		expect(typed.efforts).toContain("low");
		expect(typed.efforts).toContain("max");
	});

	it("D2c: a disable WITHOUT an explicit None keeps the model's own default", async () => {
		const gateway = makeGateway();
		const model = gateway.createAgentModel({
			providerId: "minimax",
			modelId: M31_MODEL_ID,
		});

		// A derived disable (no `None` selection) is NOT rejected: the model
		// keeps its mandatory default, exactly as before the correction.
		const stream = await model.stream({
			messages: [],
			tools: [],
			options: { thinking: false },
		});
		// The stream was created — no typed error was raised.
		expect(stream).toBeDefined();
		await expect(
			(async () => {
				for await (const _event of stream) {
					// drain
				}
			})(),
		).resolves.toBeUndefined();
	});

	it("D2c: M3's VALID disabled-thinking mode is preserved", async () => {
		const gateway = makeGateway();
		const model = gateway.createAgentModel({
			providerId: "minimax",
			modelId: M3_MODEL_ID,
		});

		// M3 advertises a thinking toggle, so disabling reasoning IS a
		// supported configuration for it and must NOT be rejected — even
		// when the user explicitly selected `None`.
		const stream = await model.stream({
			messages: [],
			tools: [],
			options: { reasoning: { enabled: false, effort: "none" } },
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

	it("D2c: a STALE PERSISTED None reaches the boundary as an explicit None", async () => {
		const gateway = makeGateway();

		// The persisted provider-level selection is carried on the model
		// handle's default reasoning. A stale persisted `None` arrives
		// exactly this way: the per-request options carry only
		// `thinking: false`.
		const model = gateway.createAgentModel(
			{
				providerId: "minimax",
				modelId: M31_MODEL_ID,
			},
			{
				reasoning: { enabled: false, disableReason: "none" },
			},
		);

		await expect(
			model.stream({
				messages: [],
				tools: [],
				options: { thinking: false },
			}),
		).rejects.toSatisfy(isUnsupportedReasoningConfigurationError);
	});

	it("D2c: a stale persisted DISABLE without a None selection is not rejected", async () => {
		const gateway = makeGateway();
		const model = gateway.createAgentModel(
			{
				providerId: "minimax",
				modelId: M31_MODEL_ID,
			},
			{
				reasoning: { enabled: false, disableReason: "unknown" },
			},
		);

		const stream = await model.stream({
			messages: [],
			tools: [],
			options: { thinking: false },
		});
		expect(stream).toBeDefined();
	});
});

describe("D2 correction: an uncatalogued model does not mandate reasoning", () => {
	it("D2c: a model with UNKNOWN controls is not treated as mandating reasoning", () => {
		// A model the catalog does not describe and the provider does not
		// declare has UNKNOWN controls. Treating an unknown model as
		// mandatory would reject requests for every model the catalog has
		// not published yet.
		const gateway = makeGateway();
		const resolved = resolveModel(gateway, "minimax-some-unreleased-model");
		expect(resolved.model.reasoningOptions).toBeUndefined();
	});

	it("D2c: the provider-declared M3.1 controls are what make it mandating", () => {
		const gateway = makeGateway();
		const resolved = resolveModel(gateway, M31_MODEL_ID);
		expect(resolved.model.reasoningOptions).toBeDefined();
	});
});
