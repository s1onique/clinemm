/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01-CORRECTION02.
 *
 * THE DEFECT THIS PINS
 * --------------------
 * CORRECTION01 introduced `ReasoningConfig.reasoningNoneSelected` so an
 * EXPLICIT persisted `None` selection could be carried to the production
 * boundary and rejected on a model that MANDATES reasoning (MiniMax
 * M3.1-Flash). The flag was derived in `toProviderConfig()` from the
 * NORMALIZED reasoning level:
 *
 *     const unifiedReasoningLevel = settings.reasoning?.effort || "none";
 *     const reasoningNoneSelected = unifiedReasoningLevel === "none";
 *
 * `unifiedReasoningLevel` DEFAULTS to `"none"` when no effort is
 * persisted, so the derived flag could not distinguish
 *
 *   - `{ reasoning: { enabled: false, effort: "none" } }` — the user
 *     EXPLICITLY selected `None`, and
 *   - `{ reasoning: { enabled: false } }`               — reasoning was
 *     disabled for some OTHER reason (an anonymous/derived disable).
 *
 * Both produced `reasoningNoneSelected === true`, which the handler
 * factory turns into `disableReason: "none"`. The gateway then rejects
 * the request with `UnsupportedReasoningConfigurationError` even though
 * the user never selected `None`. That breaks the CONSERVATION contract:
 * an anonymous disable must preserve the model's own default behavior,
 * and must not manufacture a user selection that was never made.
 *
 * WHY THE EXISTING WITNESSES MISSED IT
 * ------------------------------------
 * The D2c anonymous-disable witness constructs the model handle directly
 * with `disableReason: "unknown"`. That BYPASSES the real
 * `toProviderConfig()` mapping that introduces the false `none` identity,
 * so it could not observe this defect.
 *
 * THE CONTRACT THIS PINS
 * ----------------------
 * This witness traverses the REAL persisted-settings conversion and the
 * REAL handler-factory boundary — the seam the defect actually lives on —
 * and then reaches the REAL gateway production boundary:
 *
 *   persisted settings
 *     -> toProviderConfig()            (sdk/packages/core, source)
 *     -> createAgentModelFromConfig()  (sdk/packages/core, source)
 *     -> gateway stream()               (@cline/llms, real)
 *
 * It asserts BOTH directions:
 *
 *   - an ANONYMOUS disable (`{ enabled: false }`, no effort) is NOT
 *     rejected — the model keeps its own default; and
 *   - an EXPLICIT persisted `None` (`{ enabled: false, effort: "none" }`)
 *     IS rejected with the typed `UnsupportedReasoningConfigurationError`.
 *
 * The existing M3 (valid disabled-thinking mode) and M3.1 conservation
 * witnesses remain in place and unchanged.
 */

import { isUnsupportedReasoningConfigurationError } from "@cline/llms";
import type { AgentConfig } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createAgentModelFromConfig } from "./handler-factory";
import { type ProviderSettings, toProviderConfig } from "./provider-settings";

/**
 * MiniMax M3.1-Flash. The shared catalog does not publish it, so it
 * resolves as an unregistered model carrying the provider-declared
 * effort-only controls: reasoning is MANDATED and cannot be turned off.
 */
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

describe("CORRECTION02: an absent effort is not an explicit `None` selection", () => {
	it("DERIVES the explicit-None flag from the PERSISTED effort, not from a default", () => {
		// The persisted effort is the ONLY evidence of an explicit `None`
		// selection. An absent effort must not be normalized into one.
		expect(
			toProviderConfig({
				provider: "minimax",
				model: M31_MODEL_ID,
				reasoning: { enabled: false },
			}).reasoningNoneSelected,
		).toBe(false);

		// An explicitly undefined effort is still an ABSENT effort.
		expect(
			toProviderConfig({
				provider: "minimax",
				model: M31_MODEL_ID,
				reasoning: { enabled: false, effort: undefined },
			}).reasoningNoneSelected,
		).toBe(false);

		// An explicit persisted `None` IS an explicit selection.
		expect(
			toProviderConfig({
				provider: "minimax",
				model: M31_MODEL_ID,
				reasoning: { enabled: false, effort: "none" },
			}).reasoningNoneSelected,
		).toBe(true);
	});

	it("PRESERVES the model default for an ANONYMOUS disable (M3.1 mandates reasoning)", async () => {
		// The persisted settings disable reasoning WITHOUT recording an
		// explicit `None` selection. The request must therefore keep the
		// model's own mandatory default and must NOT be rejected — the
		// user never selected `None`.
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
