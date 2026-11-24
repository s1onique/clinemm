/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C5 — the CLOSED SEMANTIC SCORING VOCABULARY.
 *
 * ============================================================================
 * WHY THE VOCABULARY IS CLOSED
 * ============================================================================
 *
 * The discriminator must not be able to express a "mostly fine" verdict, and
 * it must not be able to convert an unobservable boundary into a pass. Every
 * score below is one of exactly eight values, and the S2/S3 boundaries that
 * cannot be safely inspected are `UNOBSERVABLE` rather than `PRESERVED`.
 */

/**
 * The closed scoring vocabulary.
 */
export type SemanticScore =
	| "PRESERVED"
	| "PARTIALLY_PRESERVED"
	| "OMITTED"
	| "DISTORTED"
	| "CONTRADICTED"
	| "UNSUPPORTED_STRENGTHENING"
	| "UNOBSERVABLE"
	| "NOT_APPLICABLE";

export const SEMANTIC_SCORES: readonly SemanticScore[] = [
	"PRESERVED",
	"PARTIALLY_PRESERVED",
	"OMITTED",
	"DISTORTED",
	"CONTRADICTED",
	"UNSUPPORTED_STRENGTHENING",
	"UNOBSERVABLE",
	"NOT_APPLICABLE",
];

/**
 * The S2 behavioural classification.
 *
 * The distinction between "the information was available and used" and "the
 * information was available but ignored" is the discriminator between a
 * COMPACTION failure and a MODEL failure, so it is a separate axis rather
 * than a refinement of the semantic score.
 */
export type BehaviouralClassification =
	| "INFORMATION_AVAILABLE_AND_USED"
	| "INFORMATION_AVAILABLE_BUT_IGNORED"
	| "INFORMATION_MISSING_AFTER_COMPACTION"
	| "INFORMATION_PRESENT_BUT_DISTORTED"
	| "MODEL_FAILURE_WITH_FULL_SOURCE";

export interface OracleScore {
	readonly oracleItemId: string;
	readonly score: SemanticScore;
	/**
	 * The mechanism that supplied the item in the inspected context. It is
	 * empty when nothing supplied it.
	 */
	readonly suppliedBy: readonly string[];
	/**
	 * The MATERIAL qualification that did NOT survive, when the item is
	 * `PARTIALLY_PRESERVED`.
	 */
	readonly missingQualifications: readonly string[];
	/**
	 * The adjudication note. It explains WHY the score was assigned.
	 */
	readonly note: string;
}

export interface OracleScoreSummary {
	readonly applicable: number;
	readonly preserved: number;
	readonly partiallyPreserved: number;
	readonly omitted: number;
	readonly distorted: number;
	readonly contradicted: number;
	readonly unsupportedStrengthening: number;
	readonly unobservable: number;
	readonly notApplicable: number;
	readonly criticalApplicable: number;
	readonly criticalPreserved: number;
	readonly criticalPartiallyPreserved: number;
	readonly criticalOmitted: number;
	readonly criticalDistorted: number;
	readonly criticalContradicted: number;
	readonly criticalUnobservable: number;
}

/**
 * Summarise a score set.
 *
 * The critical-item counters are reported SEPARATELY so that a lost critical
 * qualification cannot be hidden behind a high aggregate preservation
 * percentage.
 */
export function summariseScores(
	scores: readonly OracleScore[],
	criticalItemIds: ReadonlySet<string>,
): OracleScoreSummary {
	const applicable = scores.filter((score) => score.score !== "NOT_APPLICABLE");
	const count = (predicate: (score: OracleScore) => boolean): number =>
		applicable.filter(predicate).length;
	const critical = applicable.filter((score) =>
		criticalItemIds.has(score.oracleItemId),
	);
	const countCritical = (predicate: (score: OracleScore) => boolean): number =>
		critical.filter(predicate).length;
	return {
		applicable: applicable.length,
		preserved: count((s) => s.score === "PRESERVED"),
		partiallyPreserved: count((s) => s.score === "PARTIALLY_PRESERVED"),
		omitted: count((s) => s.score === "OMITTED"),
		distorted: count((s) => s.score === "DISTORTED"),
		contradicted: count((s) => s.score === "CONTRADICTED"),
		unsupportedStrengthening: count(
			(s) => s.score === "UNSUPPORTED_STRENGTHENING",
		),
		unobservable: count((s) => s.score === "UNOBSERVABLE"),
		notApplicable: scores.length - applicable.length,
		criticalApplicable: critical.length,
		criticalPreserved: countCritical((s) => s.score === "PRESERVED"),
		criticalPartiallyPreserved: countCritical(
			(s) => s.score === "PARTIALLY_PRESERVED",
		),
		criticalOmitted: countCritical((s) => s.score === "OMITTED"),
		criticalDistorted: countCritical((s) => s.score === "DISTORTED"),
		criticalContradicted: countCritical((s) => s.score === "CONTRADICTED"),
		criticalUnobservable: countCritical((s) => s.score === "UNOBSERVABLE"),
	};
}
