/**
 * ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01
 *
 * C3 — the PER-ARM INFORMATION AVAILABILITY MAP.
 *
 * ============================================================================
 * THE DEFECT THIS CORRECTS
 * ============================================================================
 *
 * The predecessor ACT's scoring script built ONE availability map from the
 * A0 arm's S2 scores and then used that SAME map to classify the answers of
 * EVERY arm:
 *
 *   const s2Scores = new Map(
 *       (arms.arms.A0?.scores ?? []).map((s) => [s.oracleItemId, s.score]),
 *   );
 *   ...
 *   const informationAvailable =
 *       (s2Scores.get(result.oracleItemId) ?? "UNOBSERVABLE") !== "OMITTED";
 *
 * Two consequences:
 *
 *   1. An item MISSING in A0 was classified as missing in A1 even when A1
 *      had PRESERVED it. The availability of an arm's context is a property
 *      of THAT ARM's context, not of A0's.
 *
 *   2. The test `!== "OMITTED"` treats `PARTIALLY_PRESERVED` and
 *      `UNOBSERVABLE` as "available". A partially preserved proposition —
 *      one whose MATERIAL QUALIFICATIONS did not survive — is not fully
 *      available, and an unobservable one is not available at all.
 *
 * ============================================================================
 * THE CORRECTED RULE
 * ============================================================================
 *
 * Information is available for an arm ONLY when that arm's OWN S2 score for
 * the item is `PRESERVED`. Anything else — `PARTIALLY_PRESERVED`,
 * `OMITTED`, `UNOBSERVABLE`, `DISTORTED`, `CONTRADICTED`,
 * `UNSUPPORTED_STRENGTHENING` — is NOT fully available.
 *
 * The classification vocabulary is extended with the two states the
 * predecessor ACT asserted too strongly:
 *
 *   - `MODEL_INTERPRETATION_FAILURE_CANDIDATE` replaces the claim that an
 *     ignored item is a proven model failure. It is a CANDIDATE until the
 *     complete proposition AND its necessary qualifications are established
 *     in that arm's context.
 *   - `PARTIAL_INFORMATION_AVAILABLE` marks the case where the proposition
 *     survived but a material qualification did not.
 */

import type { SemanticScore } from "../knowledge-loss-discriminator/scoring";

/**
 * The per-arm availability verdict for ONE oracle item.
 */
export type InformationAvailability =
	/** The proposition AND every material qualification are established. */
	| "AVAILABLE"
	/** The proposition is established but a material qualification is not. */
	| "PARTIAL"
	/** Nothing in the arm's context establishes the proposition. */
	| "MISSING"
	/** The arm's context could not be inspected for this item. */
	| "UNOBSERVABLE";

/**
 * Derive the availability verdict from an arm's OWN S2 score.
 *
 * The mapping is CLOSED and TOTAL: every value of the closed scoring
 * vocabulary maps to exactly one availability verdict.
 */
export function availabilityForScore(
	score: SemanticScore | undefined,
): InformationAvailability {
	if (score === undefined) {
		return "UNOBSERVABLE";
	}
	switch (score) {
		case "PRESERVED":
			return "AVAILABLE";
		case "PARTIALLY_PRESERVED":
			return "PARTIAL";
		case "UNOBSERVABLE":
			return "UNOBSERVABLE";
		case "OMITTED":
		case "DISTORTED":
		case "CONTRADICTED":
		case "UNSUPPORTED_STRENGTHENING":
			return "MISSING";
		case "NOT_APPLICABLE":
			return "UNOBSERVABLE";
		default:
			return "UNOBSERVABLE";
	}
}

/**
 * Build the PER-ARM availability map.
 *
 * The map is built from ONE arm's own scores. A caller that wants to
 * classify several arms builds ONE MAP PER ARM; it never reuses another
 * arm's map.
 */
export function buildAvailabilityMap(
	scores: readonly { readonly oracleItemId: string; readonly score: string }[],
): ReadonlyMap<string, InformationAvailability> {
	const map = new Map<string, InformationAvailability>();
	for (const entry of scores) {
		map.set(
			entry.oracleItemId,
			availabilityForScore(entry.score as SemanticScore),
		);
	}
	return map;
}

/**
 * The CORRECTED behavioural classification.
 *
 * It replaces the predecessor's four-state vocabulary with one that
 * distinguishes a COMPACTION loss from a MODEL failure without asserting
 * more than the evidence supports.
 */
export type CorrectedBehaviouralClassification =
	/** The answer used the information the arm's context established. */
	| "INFORMATION_AVAILABLE_AND_USED"
	/**
	 * The information WAS available in this arm's context and the answer did
	 * not use it.
	 *
	 * This is a CANDIDATE model failure: it becomes a proven model failure
	 * only when the complete proposition and its necessary qualifications
	 * were established in the context.
	 */
	| "MODEL_INTERPRETATION_FAILURE_CANDIDATE"
	/**
	 * The proposition was available but a MATERIAL QUALIFICATION was not, so
	 * the context could not support a complete answer.
	 */
	| "PARTIAL_INFORMATION_AVAILABLE"
	/** The arm's context did not establish the proposition at all. */
	| "INFORMATION_MISSING_AFTER_COMPACTION"
	/** The context established something DIFFERENT from the proposition. */
	| "INFORMATION_PRESENT_BUT_DISTORTED"
	/** The answer could not be scored. */
	| "UNSCORABLE";

/**
 * Classify ONE answer against its ARM'S OWN availability verdict.
 *
 * The classification is a PURE function of (score, availability), so it is
 * reproducible and reviewable.
 */
export function classifyAnswer(input: {
	readonly score: "CORRECT" | "PARTIALLY_CORRECT" | "INCORRECT" | "UNSCORABLE";
	readonly availability: InformationAvailability;
}): CorrectedBehaviouralClassification {
	if (input.score === "UNSCORABLE") {
		return "UNSCORABLE";
	}
	if (input.score === "CORRECT") {
		return "INFORMATION_AVAILABLE_AND_USED";
	}
	switch (input.availability) {
		case "AVAILABLE":
			return "MODEL_INTERPRETATION_FAILURE_CANDIDATE";
		case "PARTIAL":
			return "PARTIAL_INFORMATION_AVAILABLE";
		case "MISSING":
			return "INFORMATION_MISSING_AFTER_COMPACTION";
		case "UNOBSERVABLE":
			return "UNSCORABLE";
		default:
			return "UNSCORABLE";
	}
}
