/**
 * ACT-CLINEMM-M31-CATALOG-SNAPSHOT-REFRESH01 — bounded catalog witness.
 *
 * PURPOSE
 * -------
 * The bundled MiniMax catalog did not publish the exact production model id
 *
 *     MiniMax-M3.1-Flash
 *
 * even though models.dev publishes it. This witness pins the entry the bounded
 * snapshot refresh added, with the upstream-authoritative values.
 *
 * WHAT THIS WITNESS IS NOT
 * ------------------------
 * It is NOT a re-implementation of the upstream metadata. The values asserted
 * here are the ones the REAL production normalizer
 * (`normalizeModelsDevProviderModels`) derives from the live models.dev
 * payload, and the bounded refresh was produced BY that same normalizer.
 * See `.factory/evidence/ACT-CLINEMM-M31-CATALOG-SNAPSHOT-REFRESH01/`.
 *
 * The provenance of the upstream payload used for the refresh:
 *
 *     url            https://models.dev/api.json
 *     retrievedAt    2026-10-29T11:43:24.088Z
 *     payloadSha256  666dfc620821827f07c3ef274b14899691aec4d1e7a8da0d5db02d27a8d5613e
 *
 * The context window is 1_000_000 (NOT 1_048_576) and the output limit is
 * 524_288, as upstream reports them.
 */
import { describe, expect, it } from "vitest";
import { getGeneratedModelsForProvider } from "./catalog.generated-access";

const PROVIDER_ID = "minimax";
const MODEL_ID = "MiniMax-M3.1-Flash";

describe("ACT-CLINEMM-M31-CATALOG-SNAPSHOT-REFRESH01: bundled MiniMax M3.1 Flash entry", () => {
	it("publishes the exact production model id with the upstream context window", () => {
		const models = getGeneratedModelsForProvider(PROVIDER_ID);
		const model = models[MODEL_ID];

		expect(model).toBeDefined();
		expect(model?.id).toBe(MODEL_ID);
		expect(model?.name).toBe(MODEL_ID);
		expect(model?.contextWindow).toBe(1_000_000);
		expect(model?.maxInputTokens).toBe(1_000_000);
		expect(model?.maxTokens).toBe(524_288);
		expect(model?.releaseDate).toBe("2026-10-19");
		expect(model?.family).toBe("minimax");
	});

	it("publishes the upstream-authoritative prices", () => {
		const model = getGeneratedModelsForProvider(PROVIDER_ID)[MODEL_ID];

		expect(model?.pricing).toEqual({
			input: 0.15,
			output: 0.6,
			cacheRead: 0.015,
			cacheWrite: 0,
		});
	});

	it("publishes the upstream reasoning-effort ladder and tool capability", () => {
		const model = getGeneratedModelsForProvider(PROVIDER_ID)[MODEL_ID];

		expect(model?.reasoningOptions).toEqual([
			{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
		]);
		expect(model?.capabilities).toContain("tools");
		expect(model?.capabilities).toContain("reasoning");
	});

	it("does not disturb the M3 entry that shares the provider", () => {
		const models = getGeneratedModelsForProvider(PROVIDER_ID);

		expect(models["MiniMax-M3"]).toBeDefined();
		expect(models["MiniMax-M3"]?.contextWindow).toBe(1_048_576);
		expect(models["MiniMax-M3"]?.reasoningOptions).toEqual([
			{ type: "toggle" },
		]);
	});
});
