/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 — D6 witness.
 *
 * PURPOSE
 * -------
 * Prove that a MiniMax M3.1 model the shared catalog does NOT publish still
 * resolves with the reasoning controls the provider declares, so the
 * requested effort survives normalization and reaches the provider-option
 * boundary.
 *
 * THE DEFECT THIS PINS
 * --------------------
 * `createUnregisteredModel` used to synthesise a model with NO
 * `reasoningOptions` and NO `capabilities`. Two things then went wrong:
 *
 *   1. Normalization saw a model that advertises no supported reasoning
 *      configuration and DROPPED the requested reasoning intent — including
 *      an explicit effort. The user's selected reasoning policy was
 *      silently discarded before transport.
 *   2. Even with controls restored, the provider-option routes match on
 *      the `reasoning` CAPABILITY. A model without it never reaches its
 *      own reasoning encoding, so the effort would still not reach the
 *      wire.
 *
 * These assertions are made against the REAL registry (the real MiniMax
 * built-in manifest), not a hand-built fixture, so a regression in the
 * manifest/metadata plumbing is caught too.
 */
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";
import { composeAiSdkProviderOptions } from "./provider-options";
import { normalizeReasoningRequest } from "./reasoning-options";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";

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

describe("MiniMax M3.1: unregistered model resolution", () => {
	it("D6 RED: resolves an uncatalogued M3.1 model with effort-only controls", () => {
		const gateway = makeGateway();
		const registry = (
			gateway as unknown as {
				registry: {
					resolveModel: (s: { providerId: string; modelId: string }) => {
						model: {
							reasoningOptions?: readonly {
								type: string;
								values?: readonly string[];
							}[];
							capabilities?: readonly string[];
						};
					};
				};
			}
		).registry;

		// The catalog publishes MiniMax-M3 but not the M3.1 generation, so
		// this model id is NOT in the provider's model list.
		const resolved = registry.resolveModel({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
		});

		expect(resolved.model.reasoningOptions).toBeDefined();
		expect(resolved.model.reasoningOptions).toEqual([
			{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
		]);
		// M3.1 has NO thinking toggle: disabling reasoning is not an
		// advertised control, so it must be DETECTED as unsupported rather
		// than silently represented as reasoning-disabled.
		expect(
			resolved.model.reasoningOptions?.some((o) => o.type === "toggle"),
		).toBe(false);
	});

	it("D6 RED: the resolved model carries the reasoning capability its routes require", () => {
		const gateway = makeGateway();
		const registry = (
			gateway as unknown as {
				registry: {
					resolveModel: (s: { providerId: string; modelId: string }) => {
						model: { capabilities?: readonly string[] };
					};
				};
			}
		).registry;

		const resolved = registry.resolveModel({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
		});

		expect(resolved.model.capabilities).toContain("reasoning");
	});

	it("D6 RED: an explicit M3.1 effort survives normalization", () => {
		const gateway = makeGateway();
		const registry = (
			gateway as unknown as {
				registry: {
					resolveModel: (s: { providerId: string; modelId: string }) => {
						provider: unknown;
						model: unknown;
					};
				};
			}
		).registry;

		const resolved = registry.resolveModel({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
		});

		const normalized = normalizeReasoningRequest(
			{
				providerId: "minimax",
				modelId: "minimax-m3.1-flash",
				messages: [],
				reasoning: { enabled: true, effort: "low" },
			} as never,
			resolved as never,
		);

		expect(normalized.reasoning).toEqual({ enabled: true, effort: "low" });
	});

	it("D6 GREEN: the M3.1 effort reaches the provider-option boundary", () => {
		const gateway = makeGateway();
		const registry = (
			gateway as unknown as {
				registry: {
					resolveModel: (s: { providerId: string; modelId: string }) => {
						provider: unknown;
						model: unknown;
					};
				};
			}
		).registry;

		const resolved = registry.resolveModel({
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
		});

		const options = composeAiSdkProviderOptions(
			{
				providerId: "minimax",
				modelId: "minimax-m3.1-flash",
				messages: [],
				reasoning: { enabled: true, effort: "low" },
			} as never,
			resolved as never,
		);

		// The MiniMax native encoding carries the effort in the
		// `anthropic` bucket: the Anthropic-compatible transport serializes
		// `providerOptions.anthropic.effort` into `output_config.effort`.
		expect(
			(options as { anthropic?: { effort?: string } }).anthropic?.effort,
		).toBe("low");
	});
});
