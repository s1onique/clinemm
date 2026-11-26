/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A2).
 *
 * THE DESTINATION-SPECIFIC REPLAY-ELIGIBILITY AUTHORITY.
 *
 * ## THE PROBLEM THIS SOLVES
 * --------------------------
 * An opaque provider-owned reasoning payload (the Anthropic thinking
 * signature and the redacted-thinking payload) authenticates a block to
 * the ENDPOINT that issued it. Replaying it to a DIFFERENT origin discloses
 * one endpoint's opaque metadata to another.
 *
 * The WIRE gate (`@cline/llms`'s outbound conversion) already enforces a
 * FAIL-CLOSED policy for this. The request-budget authority, however, was
 * deciding reasoning inclusion by a DIFFERENT and WEAKER rule — "does the
 * block carry a signature?" — so the two could disagree:
 *
 *   - a SIGNED block with a MISSING origin was counted by the budget but
 *     DROPPED by the wire (the wire fails closed on an absent origin);
 *   - a SIGNED block with an INCOMPATIBLE origin was counted by the budget
 *     but DROPPED by the wire (the wire compares the origin to the
 *     destination's own authority);
 *   - an UNAUTHORIZED REDACTED block was counted by the budget but DROPPED
 *     by the wire.
 *
 * The divergence is CAUSAL: the compaction trigger consumes the budget
 * measurement, so a budget that counts provider-excluded content can flip
 * the compaction verdict for a request the provider would have accepted.
 *
 * ## WHY THE AUTHORITY LIVES HERE
 * -------------------------------
 * The wire gate lives in `@cline/llms`; the budget lives in `@cline/shared`
 * and is consumed by `@cline/core` and `@cline/agents` as well. A single
 * pure decision, owned by `@cline/shared` and consumed by BOTH, is the only
 * way the two cannot drift apart.
 *
 * This is the EXISTING decision, EXTRACTED — not a second, independent
 * predicate. The wire gate's `mayReplayOpaqueReasoning` now delegates here,
 * so the policy itself is unchanged; only its location changed.
 *
 * ## THE POLICY (UNCHANGED)
 * -------------------------
 * The policy is FAIL-CLOSED:
 *
 *   - the recorded origin must be PRESENT and well formed, and
 *   - it must EXACTLY equal the destination's origin authority.
 *
 * A missing or malformed origin does NOT grant replay authority: absence of
 * provenance is not evidence of compatibility, and granting it would
 * disclose one endpoint's opaque metadata to another. An UNRESOLVED
 * destination (no authority) grants no authority either.
 *
 * The reasoning TEXT is never gated by this — only the opaque payload is.
 */

/**
 * The metadata key that records the ORIGIN AUTHORITY of an opaque
 * provider-owned reasoning payload.
 *
 * It is the SAME key the production persistence codec writes
 * (`agent-message-codec.ts`, `ThinkingContent.originAuthority`), the SAME
 * key the provider-visible projection carries it under, and the SAME key
 * the outbound conversion reads. No new metadata field is introduced.
 */
export const REASONING_ORIGIN_AUTHORITY_KEY = "originAuthority";

/**
 * Whether an opaque reasoning payload may be replayed to a destination.
 *
 * The policy is FAIL-CLOSED on every branch:
 *
 *   - a MISSING or MALFORMED issuing origin grants no authority,
 *   - a MISSING or MALFORMED destination identity grants no authority,
 *   - KNOWN INCOMPATIBLE origins grant no authority,
 *   - only POSITIVELY ESTABLISHED COMPATIBLE origins grant authority.
 *
 * The destination authority is REQUIRED by the caller, so a missing
 * destination can never be reached through the ordinary request path —
 * but its VALUE may be `undefined`, which is exactly how an UNRESOLVED
 * destination route is represented. An unresolved destination therefore
 * grants NO authority, exactly like a malformed one.
 */
export function mayReplayOpaqueReasoning(input: {
	/** The recorded origin authority of the opaque payload. */
	origin: unknown;
	/** The origin authority of the destination the payload is replayed to. */
	destinationAuthority: string | undefined;
}): boolean {
	if (typeof input.origin !== "string" || input.origin.length === 0) {
		return false;
	}
	if (
		typeof input.destinationAuthority !== "string" ||
		input.destinationAuthority.length === 0
	) {
		return false;
	}
	return input.origin === input.destinationAuthority;
}

/**
 * Read the ORIGIN AUTHORITY out of a reasoning part's metadata bag.
 *
 * It is read ONLY from the part's own metadata, under the SAME key the
 * production persistence codec writes and the outbound conversion reads.
 *
 * A non-string value yields NO authority, exactly as the outbound conversion
 * treats a malformed origin: an absent authority grants no replay authority,
 * which is the fail-closed behaviour.
 */
export function extractReasoningOriginAuthority(
	metadata: unknown,
): string | undefined {
	if (!metadata || typeof metadata !== "object") {
		return undefined;
	}
	const record = metadata as { [REASONING_ORIGIN_AUTHORITY_KEY]?: unknown };
	const value = record[REASONING_ORIGIN_AUTHORITY_KEY];
	return typeof value === "string" ? value : undefined;
}
