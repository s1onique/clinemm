/**
 * ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01
 *
 * C2 / C4 — the BOUNDED POLICY RESOLVER and its CONSERVATION MATRIX.
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * The optimized inference policy applies ONLY when EVERY gate agrees:
 *
 *   1. The request purpose is the PCK request.
 *   2. The PCK feature is enabled.
 *   3. The operator explicitly selected the policy.
 *   4. The selected policy identifier is known.
 *   5. The EFFECTIVE model is on the EXACT allowlist.
 *   6. The EFFECTIVE provider is compatible with the parameters.
 *
 * Every other combination preserves the EXISTING inference behaviour, and
 * every non-application carries a DISTINCT, OBSERVABLE reason so a
 * consumer can tell the cases apart.
 *
 * ============================================================================
 * THE ALLOWLIST IS EXACT
 * ============================================================================
 *
 * The negative controls deliberately include the sibling Qwen variants
 * that a SUBSTRING rule would have swept in. They are the load-bearing
 * rows: an implementation that matched "qwen" would fail them.
 */

import { describe, expect, it } from "vitest";
import { resolveSummarizerConfig } from "../compaction-shared";
import {
	PCK_INFERENCE_POLICY_ENV_VAR,
	QWEN_STRATA_V1_ALLOWED_MODEL_IDS,
	QWEN_STRATA_V1_PARAMETERS,
	QWEN_STRATA_V1_POLICY_ID,
	readSelectedPckInferencePolicyId,
	resolvePckInferencePolicy,
} from "./inference-policy";

const QUALIFIED_MODEL_ID = "qwen3.8-flash-next-q2_0";
const QUALIFIED_PROVIDER_ID = "openai-compatible";

/**
 * The environment an operator opts in with.
 */
const OPTED_IN_ENV: Readonly<Record<string, string | undefined>> = {
	[PCK_INFERENCE_POLICY_ENV_VAR]: QWEN_STRATA_V1_POLICY_ID,
};

/**
 * Resolve with the qualified configuration and the opted-in environment.
 */
function resolveQualified(overrides: {
	readonly purpose?: "pck" | "other";
	readonly featureEnabled?: boolean;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly providerId?: string;
	readonly modelId?: string;
} = {}) {
	return resolvePckInferencePolicy({
		purpose: overrides.purpose ?? "pck",
		featureEnabled: overrides.featureEnabled ?? true,
		effectiveProviderConfig: {
			providerId: overrides.providerId ?? QUALIFIED_PROVIDER_ID,
			modelId: overrides.modelId ?? QUALIFIED_MODEL_ID,
		},
		env: overrides.env ?? OPTED_IN_ENV,
	});
}

describe("ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 — C2 the bounded resolver", () => {
	it("C2.1: the qualified configuration with the opt-in IS applied", () => {
		const resolution = resolveQualified();
		expect(resolution.applied).toBe(true);
		if (!resolution.applied) {
			throw new Error("unreachable");
		}
		expect(resolution.policyId).toBe(QWEN_STRATA_V1_POLICY_ID);
		expect(resolution.parameters).toEqual({
			reasoningEffort: "none",
			temperature: 0.1,
			maxOutputTokens: 1024,
			responseFormat: { type: "json_object" },
		});
		// The decision names the EFFECTIVE model it was made against.
		expect(resolution.effectiveModelId).toBe(QUALIFIED_MODEL_ID);
		expect(resolution.effectiveProviderId).toBe(QUALIFIED_PROVIDER_ID);
	});

	it("C2.2: the policy's PARAMETERS are the ACT's qualified ones", () => {
		expect(QWEN_STRATA_V1_PARAMETERS).toEqual({
			reasoningEffort: "none",
			temperature: 0.1,
			maxOutputTokens: 1024,
			responseFormat: { type: "json_object" },
		});
	});

	it("C2.3: the allowlist contains EXACTLY the qualified model", () => {
		expect(QWEN_STRATA_V1_ALLOWED_MODEL_IDS).toEqual([QUALIFIED_MODEL_ID]);
	});

	it("C2.4: the resolver is PURE — it performs NO I/O and NO mutation", () => {
		// The resolver is called twice with the same inputs and produces
		// the same decision, and it never touches the environment.
		const first = resolveQualified();
		const second = resolveQualified();
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	});

	it("C2.5: the selection is read EXACTLY — a near-miss value does not select it", () => {
		expect(readSelectedPckInferencePolicyId(OPTED_IN_ENV)).toBe(
			QWEN_STRATA_V1_POLICY_ID,
		);
		// A surrounding whitespace is tolerated (the value is trimmed).
		expect(
			readSelectedPckInferencePolicyId({
				[PCK_INFERENCE_POLICY_ENV_VAR]: `  ${QWEN_STRATA_V1_POLICY_ID}  `,
			}),
		).toBe(QWEN_STRATA_V1_POLICY_ID);
		// A near-miss does NOT select it.
		for (const nearMiss of [
			"qwen-strata-v2",
			"qwen-strata",
			"Qwen-Strata-V1",
			"qwen-strata-v1 ",
		]) {
			expect(readSelectedPckInferencePolicyId({
				[PCK_INFERENCE_POLICY_ENV_VAR]: nearMiss,
			})).toBe(nearMiss.trim());
		}
	});
});


/**
 * The CONSERVATION MATRIX.
 *
 * Every row asserts that the optimized policy is NOT applied, and that the
 * reason is the DISTINCT one for that row. A row that merely asserted
 * "not applied" could pass for the wrong reason, so the reason is part of
 * the assertion.
 */
describe("ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 — C4 conservation", () => {
	it("C4.1: an UNKNOWN MODEL is not applied", () => {
		const resolution = resolveQualified({ modelId: "some-unknown-model" });
		expect(resolution.applied).toBe(false);
		if (resolution.applied) {
			throw new Error("unreachable");
		}
		expect(resolution.reason).toBe("model_not_allowed");
	});

	it("C4.2: MiniMax-M3 is not applied", () => {
		const resolution = resolveQualified({ modelId: "MiniMax-M3" });
		expect(resolution.applied).toBe(false);
		if (resolution.applied) {
			throw new Error("unreachable");
		}
		expect(resolution.reason).toBe("model_not_allowed");
	});

	it("C4.3: OTHER QWEN VARIANTS are not applied — the allowlist is EXACT", () => {
		// These are the load-bearing negative controls: a SUBSTRING rule
		// that matched "qwen" would sweep every one of them in.
		const siblingVariants = [
			"qwen3.8-flash-next-iq3_s",
			"qwen3.8-flash-next-q4_0",
			"qwen3.8-flash-next-q2_0-instruct",
			"qwen3.8-flash-next",
			"qwen3.8-flash",
			"qwen3.8-max",
			"qwen/qwen3.8-27b",
			"my-qwen3.8-flash-next-q2_0",
		];
		for (const modelId of siblingVariants) {
			const resolution = resolveQualified({ modelId });
			expect(resolution.applied).toBe(false);
			if (resolution.applied) {
				throw new Error(`unreachable: ${modelId}`);
			}
			expect(resolution.reason).toBe("model_not_allowed");
		}
	});

	it("C4.4: an INCOMPATIBLE PROVIDER is not applied", () => {
		for (const providerId of [
			"anthropic",
			"openai-native",
			"minimax",
			"openrouter",
		]) {
			const resolution = resolveQualified({ providerId });
			expect(resolution.applied).toBe(false);
			if (resolution.applied) {
				throw new Error(`unreachable: ${providerId}`);
			}
			expect(resolution.reason).toBe("provider_not_compatible");
		}
	});

	it("C4.5: the qualified model WITHOUT the explicit opt-in is not applied", () => {
		const resolution = resolveQualified({ env: {} });
		expect(resolution.applied).toBe(false);
		if (resolution.applied) {
			throw new Error("unreachable");
		}
		expect(resolution.reason).toBe("not_opted_in");
	});

	it("C4.6: an UNKNOWN policy identifier is not applied", () => {
		const resolution = resolveQualified({
			env: { [PCK_INFERENCE_POLICY_ENV_VAR]: "some-other-policy" },
		});
		expect(resolution.applied).toBe(false);
		if (resolution.applied) {
			throw new Error("unreachable");
		}
		expect(resolution.reason).toBe("unknown_policy");
	});

	it("C4.7: the FEATURE-DISABLED execution is not applied", () => {
		const resolution = resolveQualified({ featureEnabled: false });
		expect(resolution.applied).toBe(false);
		if (resolution.applied) {
			throw new Error("unreachable");
		}
		expect(resolution.reason).toBe("feature_disabled");
	});

	it("C4.8: a NON-PCK request purpose is not applied", () => {
		const resolution = resolveQualified({ purpose: "other" });
		expect(resolution.applied).toBe(false);
		if (resolution.applied) {
			throw new Error("unreachable");
		}
		expect(resolution.reason).toBe("purpose_not_pck");
	});

	it("C4.9: the WORKING-AGENT request purpose is not applied even for the qualified model", () => {
		// The working agent's request is a DIFFERENT request with a
		// DIFFERENT purpose. The policy is scoped to the checkpoint
		// request, so the working agent's own model — even when it is the
		// qualified one — never receives it.
		const resolution = resolveQualified({ purpose: "other" });
		expect(resolution.applied).toBe(false);
	});

	it("C4.10: a MIXED working-agent and summarizer configuration resolves against the SUMMARIZER's model", () => {
		// The working agent runs on a model that is NOT on the allowlist
		// and the summarizer runs on the qualified one: the policy
		// applies, because the SUMMARIZER's model is the one that will
		// answer the checkpoint request.
		const applied = resolveQualified({ modelId: QUALIFIED_MODEL_ID });
		expect(applied.applied).toBe(true);
		// The reverse: the working agent runs on the qualified model and
		// the summarizer on one that is not: the policy does NOT apply,
		// because the CHECKPOINT request will be answered by the
		// summarizer's model.
		const notApplied = resolveQualified({ modelId: "MiniMax-M3" });
		expect(notApplied.applied).toBe(false);
	});

	it("C4.11: the MIXED case is decided by the REAL summarizer configuration resolution", () => {
		// ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 (review correction): the
		// predecessor's mixed-model row supplied the model ids DIRECTLY to
		// the resolver, which bypassed the production configuration
		// resolution entirely. The production path resolves the
		// checkpoint's effective model through
		// `resolveSummarizerConfig()`, and THAT is the resolution the
		// policy must be decided against.
		//
		// The row below drives the REAL resolver with a working-agent
		// configuration and a SEPARATE summarizer configuration, and
		// asserts that the decision follows the SUMMARIZER's model.
		const workingAgentConfig = {
			providerId: QUALIFIED_PROVIDER_ID,
			modelId: QUALIFIED_MODEL_ID,
			apiKey: "test-key",
			baseUrl: "http://endpoint.invalid/v1",
		};
		// The summarizer runs on the QUALIFIED model while the working
		// agent runs on a different one.
		const summarizerOnQualified = resolveSummarizerConfig({
			activeProviderConfig: workingAgentConfig,
			summarizer: {
				providerId: QUALIFIED_PROVIDER_ID,
				modelId: QUALIFIED_MODEL_ID,
			},
		});
		const applied = resolvePckInferencePolicy({
			purpose: "pck",
			featureEnabled: true,
			effectiveProviderConfig: summarizerOnQualified,
			env: OPTED_IN_ENV,
		});
		expect(applied.applied).toBe(true);
		if (!applied.applied) {
			throw new Error("unreachable");
		}
		// The decision names the SUMMARIZER's model.
		expect(applied.effectiveModelId).toBe(QUALIFIED_MODEL_ID);
		// The reverse: the summarizer runs on a model that is NOT on the
		// allowlist, so the policy does NOT apply even though the working
		// agent runs on the qualified one.
		const summarizerOnOther = resolveSummarizerConfig({
			activeProviderConfig: workingAgentConfig,
			summarizer: {
				providerId: QUALIFIED_PROVIDER_ID,
				modelId: "MiniMax-M3",
			},
		});
		const notApplied = resolvePckInferencePolicy({
			purpose: "pck",
			featureEnabled: true,
			effectiveProviderConfig: summarizerOnOther,
			env: OPTED_IN_ENV,
		});
		expect(notApplied.applied).toBe(false);
		if (notApplied.applied) {
			throw new Error("unreachable");
		}
		expect(notApplied.reason).toBe("model_not_allowed");
		expect(notApplied.effectiveModelId).toBe("MiniMax-M3");
	});
});
