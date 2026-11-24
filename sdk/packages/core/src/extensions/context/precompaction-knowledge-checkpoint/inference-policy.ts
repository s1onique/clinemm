/**
 * ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01
 *
 * The BOUNDED, request-scoped inference policy for the Pre-Compaction
 * Knowledge Checkpoint (PCK).
 *
 * ============================================================================
 * THE POLICY IS EXPLICITLY OPT-IN
 * ============================================================================
 *
 * The policy is selected by ONE environment variable:
 *
 *   CLINEMM_PCK_INFERENCE_POLICY=qwen-strata-v1
 *
 * With the variable absent, or set to anything else, the resolver returns
 * "not applied" and the request keeps its EXISTING inference behaviour,
 * byte for byte.
 *
 * ============================================================================
 * WHAT THE POLICY IS
 * ============================================================================
 *
 *   {
 *     "reasoning_effort": "none",
 *     "temperature": 0.1,
 *     "max_tokens": 1024,
 *     "response_format": { "type": "json_object" }
 *   }
 *
 * It exists because the qualified endpoint produces a usable, closed
 * checkpoint candidate under a bounded, non-reasoning, JSON-constrained
 * request, while the INHERITED policy for that request is unbounded and
 * reasoning-on.
 *
 * ============================================================================
 * THE ALLOWLIST IS EXACT
 * ============================================================================
 *
 * The policy applies ONLY to the effective model id that the predecessor
 * qualified:
 *
 *   qwen3.8-flash-next-q2_0
 *
 * The match is an EXACT string equality against the EFFECTIVE model id. It
 * is deliberately NOT a substring or prefix match: "qwen" alone names a
 * whole family of models with different reasoning ladders, different output
 * budgets and different response-format support, and qualifying one of them
 * says nothing about the others.
 *
 * ============================================================================
 * THE EFFECTIVE MODEL IS THE CHECKPOINT MODEL
 * ============================================================================
 *
 * The effective model is the model of the CHECKPOINT request, which is
 * resolved AFTER the summarizer configuration resolution. It is NOT the
 * working agent's model: a session whose working agent runs on one model and
 * whose summarizer runs on another must apply the policy to the SUMMARIZER's
 * model, because that is the model that will answer the checkpoint request.
 *
 * ============================================================================
 * NO SHARED CONFIGURATION IS MUTATED
 * ============================================================================
 *
 * The resolver is PURE: it reads its inputs and returns a decision. The
 * application step produces a NEW provider configuration; it never writes
 * into the configuration it was given, so a policy can never leak into an
 * unrelated request that reuses the same configuration object.
 */

import type { ProviderConfig } from "../../../types/provider-settings";

/**
 * The environment variable that opts into the optimized PCK inference policy.
 */
export const PCK_INFERENCE_POLICY_ENV_VAR = "CLINEMM_PCK_INFERENCE_POLICY";

/**
 * The identifier of the optimized PCK inference policy.
 */
export const QWEN_STRATA_V1_POLICY_ID = "qwen-strata-v1";

/**
 * The EFFECTIVE model ids the optimized policy is qualified for.
 *
 * The match is EXACT. There is no wildcard, no prefix and no substring
 * matching, so a sibling Qwen variant (`qwen3.8-flash-next-iq3_s`,
 * `qwen3.8-flash-next-q4_0`, `qwen3.8-flash`, ...) is NOT covered.
 */
export const QWEN_STRATA_V1_ALLOWED_MODEL_IDS: readonly string[] = [
	"qwen3.8-flash-next-q2_0",
];

/**
 * The provider ids the optimized policy is compatible with.
 *
 * The policy's parameters are OpenAI-compatible request parameters
 * (`reasoning_effort`, `temperature`, `max_tokens`, `response_format`), and
 * the qualified endpoint serves them over the OpenAI-compatible transport.
 * A provider that owns a DIFFERENT wire shape cannot be assumed to accept
 * them, so it is not compatible.
 */
export const QWEN_STRATA_V1_COMPATIBLE_PROVIDER_IDS: readonly string[] = [
	"openai-compatible",
];


/**
 * The optimized policy's request parameters.
 */
export interface PckInferencePolicyParameters {
	/** The reasoning level requested VERBATIM. */
	readonly reasoningEffort: "none";
	/** The sampling temperature. */
	readonly temperature: number;
	/** The hard output budget, in tokens. */
	readonly maxOutputTokens: number;
	/** The JSON-object response constraint. */
	readonly responseFormat: {
		readonly type: "json_object";
	};
}

/**
 * The qualified parameters of the optimized policy.
 *
 * The values are FROZEN here so the policy is a single, auditable constant
 * rather than a set of independently-tunable knobs.
 */
export const QWEN_STRATA_V1_PARAMETERS: PckInferencePolicyParameters = {
	reasoningEffort: "none",
	temperature: 0.1,
	maxOutputTokens: 1024,
	responseFormat: { type: "json_object" },
};

/**
 * The request purposes the resolver can be asked about.
 *
 * The policy is scoped to ONE purpose. A request that is not the PCK
 * request never receives it, even when the model matches the allowlist and
 * the operator opted in.
 */
export type PckInferencePolicyPurpose = "pck" | "other";

/**
 * Why the policy was NOT applied.
 *
 * Every value is a DISTINCT, OBSERVABLE reason, so a consumer can tell a
 * non-matching model apart from a non-opted-in operator apart from a
 * disabled feature.
 */
export type PckInferencePolicyNotAppliedReason =
	/** The request purpose was not the PCK request. */
	| "purpose_not_pck"
	/** The PCK feature itself was disabled. */
	| "feature_disabled"
	/** The operator did not select the policy. */
	| "not_opted_in"
	/** The selected policy identifier is not known. */
	| "unknown_policy"
	/** The effective model id is not on the allowlist. */
	| "model_not_allowed"
	/** The effective provider is not compatible with the parameters. */
	| "provider_not_compatible";

/**
 * The resolver's decision.
 */
export type PckInferencePolicyResolution =
	| {
			/** Whether the optimized policy applies to this request. */
			readonly applied: true;
			/** The identifier of the applied policy. */
			readonly policyId: string;
			/** The parameters the policy requests. */
			readonly parameters: PckInferencePolicyParameters;
			/** The effective model the decision was made against. */
			readonly effectiveModelId: string;
			/** The effective provider the decision was made against. */
			readonly effectiveProviderId: string;
	  }
	| {
			/** Whether the optimized policy applies to this request. */
			readonly applied: false;
			/** Why it does not apply. */
			readonly reason: PckInferencePolicyNotAppliedReason;
			/** The effective model the decision was made against. */
			readonly effectiveModelId: string;
			/** The effective provider the decision was made against. */
			readonly effectiveProviderId: string;
	  };

/**
 * Read the operator-selected policy identifier.
 *
 * The value is trimmed and compared EXACTLY, so a near-miss value (a
 * trailing character, a different casing) does not silently select a
 * different policy.
 */
export function readSelectedPckInferencePolicyId(
	env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
	const raw = env[PCK_INFERENCE_POLICY_ENV_VAR];
	if (typeof raw !== "string") {
		return undefined;
	}
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}


/**
 * Resolve the optimized inference policy for ONE request.
 *
 * The function is PURE: it reads the environment and the effective provider
 * configuration and returns a decision. It performs NO I/O, NO network
 * request and NO mutation, so it is safe to call on the inference critical
 * path.
 *
 * The order of the gates is deliberate and is itself part of the contract:
 *
 *   1. The request purpose must be the PCK request.
 *   2. The PCK feature must be enabled.
 *   3. The operator must have explicitly selected the policy.
 *   4. The selected policy identifier must be known.
 *   5. The EFFECTIVE model must be on the allowlist (EXACT match).
 *   6. The EFFECTIVE provider must be compatible with the parameters.
 */
export function resolvePckInferencePolicy(input: {
	/** The purpose of the request the decision is made for. */
	readonly purpose: PckInferencePolicyPurpose;
	/** Whether the PCK feature is enabled for this session. */
	readonly featureEnabled: boolean;
	/**
	 * The EFFECTIVE provider configuration of the request.
	 *
	 * For the PCK request this is the configuration produced by the
	 * summarizer configuration resolution, so its model id is the model
	 * that will ANSWER the request.
	 */
	readonly effectiveProviderConfig: Pick<
		ProviderConfig,
		"providerId" | "modelId"
	>;
	/** The environment the operator's selection is read from. */
	readonly env?: Readonly<Record<string, string | undefined>>;
}): PckInferencePolicyResolution {
	const effectiveModelId = input.effectiveProviderConfig.modelId;
	const effectiveProviderId = input.effectiveProviderConfig.providerId;
	const notApplied = (
		reason: PckInferencePolicyNotAppliedReason,
	): PckInferencePolicyResolution => ({
		applied: false,
		reason,
		effectiveModelId,
		effectiveProviderId,
	});

	if (input.purpose !== "pck") {
		return notApplied("purpose_not_pck");
	}
	if (!input.featureEnabled) {
		return notApplied("feature_disabled");
	}
	const selectedPolicyId = readSelectedPckInferencePolicyId(input.env);
	if (selectedPolicyId === undefined) {
		return notApplied("not_opted_in");
	}
	if (selectedPolicyId !== QWEN_STRATA_V1_POLICY_ID) {
		return notApplied("unknown_policy");
	}
	// The EXACT allowlist match. No substring, no prefix, no wildcard.
	if (!QWEN_STRATA_V1_ALLOWED_MODEL_IDS.includes(effectiveModelId)) {
		return notApplied("model_not_allowed");
	}
	if (!QWEN_STRATA_V1_COMPATIBLE_PROVIDER_IDS.includes(effectiveProviderId)) {
		return notApplied("provider_not_compatible");
	}
	return {
		applied: true,
		policyId: QWEN_STRATA_V1_POLICY_ID,
		parameters: QWEN_STRATA_V1_PARAMETERS,
		effectiveModelId,
		effectiveProviderId,
	};
}

/**
 * Apply the optimized policy to an EFFECTIVE provider configuration.
 *
 * The function returns a NEW configuration. It never writes into the
 * configuration it was given, so the shared configuration the ordinary
 * summarizer and the working agent use is left exactly as it was.
 *
 * The returned configuration carries the policy's explicit constraints AND
 * its numeric parameters, ALL INSIDE `inferencePolicy`:
 *
 *   - `reasoningEffort` and `responseFormat` are the constraints the
 *     ordinary request shape cannot express.
 *   - `temperature` and `maxTokens` are the numeric parameters.
 *
 * The numeric parameters are carried INSIDE the policy rather than being
 * written onto the provider configuration's own `temperature` /
 * `maxOutputTokens` fields. That is deliberate: the request builder reads
 * them from the policy, so a request WITHOUT a policy keeps the
 * predecessor's body EXACTLY. Writing them onto the shared configuration
 * would have made the policy's numbers indistinguishable from the user's
 * own settings, and a general propagation of those fields would have
 * changed the body of every ordinary request that carries them — which is
 * outside this ACT's scope.
 */
export function applyPckInferencePolicy(
	providerConfig: ProviderConfig,
	parameters: PckInferencePolicyParameters,
): ProviderConfig {
	return {
		...providerConfig,
		inferencePolicy: {
			reasoningEffort: parameters.reasoningEffort,
			responseFormat: parameters.responseFormat,
			temperature: parameters.temperature,
			maxTokens: parameters.maxOutputTokens,
		},
	};
}
