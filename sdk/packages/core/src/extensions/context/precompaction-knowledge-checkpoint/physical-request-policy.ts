/**
 * ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01
 *
 * The PHYSICAL-REQUEST CARDINALITY policy for the Pre-Compaction Knowledge
 * Checkpoint (PCK).
 *
 * ============================================================================
 * THE CONTRACT
 * ============================================================================
 *
 * The PCK's documented contract is a NO-AUTOMATIC-RETRY contract. The
 * predecessor ACT states it in `runtime.ts` § "NO RETRY LOOP":
 *
 *   "On provider failure, timeout, cancellation, invalid JSON, an unknown
 *   atom, an unknown field, an invalid reference, an oversized output or an
 *   unsupported assurance, the attempt TERMINATES. The ordinary compaction
 *   continues using its existing failure policy. There is no automatic
 *   second checkpoint generation."
 *
 * That contract was enforced ONLY at the PCK-ATTEMPT level. The PHYSICAL
 * provider-request boundary BENEATH it carries THREE INDEPENDENT retry
 * authorities, and ALL THREE applied to the PCK request unconditionally:
 *
 *   1. `MODEL_REQUEST_MAX_RETRIES = 3` — the AI SDK's request-INITIATION
 *      retry (`maxRetries`).
 *   2. `MODEL_STREAM_MAX_RETRIES = 3` — the AI SDK's POST-STREAM-START
 *      provider-error retry (`streamRetries`).
 *   3. `withEmptyResponseRetry()` — the empty-response / transient-network
 *      middleware, default 3 attempts, applied as the OUTERMOST wrap at the
 *      single AI SDK composition point.
 *
 * The defect was REPRODUCED against the real production transport: one PCK
 * attempt issued FOUR physical provider requests against a retryable failure
 * (HTTP 429 / HTTP 500), and spent ~14 s of backoff doing it.
 *
 * ============================================================================
 * THE REPAIR
 * ============================================================================
 *
 * This module produces the request-scoped policy that disarms all three
 * authorities for the PCK request, and ONLY for the PCK request:
 *
 *   - `maxRetries: 0`            — the request is issued exactly once.
 *   - `streamRetries: 0`         — a provider error after streaming started
 *                                  terminates the request.
 *   - `emptyResponseAttempts: 1` — the middleware makes a single attempt.
 *
 * ============================================================================
 * SCOPE — THE CONTRACT IS NOT OPT-IN
 * ============================================================================
 *
 * The no-retry contract applies to ALL PCK models. It is NOT scoped to the
 * Qwen model allowlist and NOT scoped to the Qwen inference-policy opt-in:
 * that policy is an INFERENCE policy (reasoning level, temperature, JSON
 * mode, output budget), and the review explicitly keeps it restricted to its
 * existing opt-in scope.
 *
 * The request-cardinality contract is a different thing: it is a property of
 * the PCK's OWN failure contract, so it is asserted whenever the PCK request
 * is made.
 *
 * ============================================================================
 * WHAT IS PRESERVED
 * ============================================================================
 *
 * The ordinary summarizer's retries and the working agent's retries are
 * UNTOUCHED. The policy is attached to the PCK's OWN provider configuration —
 * a NEW object produced by `applyPckPhysicalRequestPolicy` — so the shared
 * summarizer/agent configuration is never mutated and the policy can never
 * leak into an unrelated request.
 */

import type { ProviderConfig } from "../../../types/provider-settings";

/**
 * The PCK's PHYSICAL-REQUEST budget.
 *
 * Every authority is disarmed:
 *
 *   - `maxRetries: 0` — the AI SDK issues the request exactly once.
 *   - `streamRetries: 0` — a provider error after streaming started ends
 *     the request instead of re-opening the stream.
 *   - `emptyResponseAttempts: 1` — the empty-response / transient-network
 *     middleware makes a single attempt.
 */
export const PCK_PHYSICAL_REQUEST_POLICY = {
	retryPolicy: {
		maxRetries: 0,
		streamRetries: 0,
		emptyResponseAttempts: 1,
	},
} as const;

/**
 * Apply the PCK's physical-request policy to an EFFECTIVE provider
 * configuration.
 *
 * The function returns a NEW configuration. It never writes into the
 * configuration it was given, so the shared configuration the ordinary
 * summarizer and the working agent use is left exactly as it was.
 *
 * The INFERENCE policy is carried through untouched: the Qwen inference
 * policy's scope (reasoning level, temperature, JSON mode, output budget) is
 * unchanged by this ACT, and the two policies are INDEPENDENT channels.
 */
export function applyPckPhysicalRequestPolicy(
	providerConfig: ProviderConfig,
): ProviderConfig {
	return {
		...providerConfig,
		requestPolicy: PCK_PHYSICAL_REQUEST_POLICY,
	};
}
