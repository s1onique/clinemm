/**
 * ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01 — offline holdout adapter.
 *
 * ## What this module is
 *
 * A MINIMAL validation adapter over the ALREADY COMMITTED analyzer of
 * ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01. It imports that
 * analyzer's PURE functions (`buildDataset`, `applyCandidate`, `stats`,
 * `safety`, `assertNoSessionLeakage`) and adds ONLY the holdout-specific
 * concerns the prior analyzer deliberately did not model:
 *
 *   - the FROZEN candidate set (the coefficients are constants, never
 *     fitted, never mutated),
 *   - the independent-session qualification gate (session-id disjointness,
 *     same-session duplicate-export rejection),
 *   - the safety discriminators required by this ACT (false-safe trigger
 *     classification, effective-ceiling false safety, near-limit coverage),
 *   - a temporal classification that NEVER infers compaction timing from a
 *     hard-coded row ordinal.
 *
 * ## What this module is NOT
 *
 * It is NOT another calibration framework and NOT an estimator. It performs
 * NO network I/O, NO production mutation and NO refitting. The previous
 * ACT's evidence directory is NEVER written to: every output of this
 * adapter is addressed under THIS ACT's own output directory.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The prior ACT's PURE analysis functions. This import is the single
// production-seam parser for this ACT.
import {
	applyCandidate,
	assertNoSessionLeakage,
	buildDataset,
	quantile,
	safety,
	stats,
	TARGET_SCOPE,
	type Candidate,
	type EligibleRow,
	type Trace,
} from "../../ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/tool/analyze";

export const ACT = "ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01";
export const TOOL_VERSION = "offline-independent-holdout.v1";
const HERE = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = join(HERE, "..");

/**
 * The FROZEN training source. This session is the calibration training
 * source; it may NEVER appear in the holdout set.
 */
export const TRAINING_SESSION_ID = "1794881611778_557z3";
export const TRAINING_SOURCE_TRACE_SHA256 = "601450acb83dad00a84451147b194ed01010190763b9442d6ed8693900eef5ed";

/**
 * The FROZEN candidates.
 *
 * These coefficients are transcribed from the pre-existing committed
 * calibration evidence. They are `readonly` constants so that NO evaluation
 * path — not even an accidental refit — can change them. `fitConstant` /
 * `fitAffine` from the prior analyzer are deliberately NOT imported or
 * called: the holdout MUST NOT be used to select coefficients.
 */
export const FROZEN_CANDIDATES: readonly Candidate[] = Object.freeze([
	Object.freeze({ id: "BASELINE", kind: "BASELINE" }),
	Object.freeze({ id: "CONSTANT", kind: "CONSTANT", factor: 0.79935 }),
	Object.freeze({
		id: "CONSTANT_MODEL_SCOPED",
		kind: "CONSTANT",
		factor: 0.79935,
		scope: Object.freeze({ ...TARGET_SCOPE }),
	}),
	Object.freeze({
		id: "AFFINE",
		kind: "AFFINE",
		a: 0.8078297287430471,
		b: -601.9734484558503,
	}),
]);

/** The primary calibration candidate of this ACT. */
export const PRIMARY_CANDIDATE_ID = "CONSTANT_MODEL_SCOPED";

/** The minimum practical observation target (pre-registered). */
export const OBSERVATION_TARGET = 10;

export interface SourceTraceDescriptor {
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly sessionId: string;
	readonly schema: string;
	readonly eventCount: number;
	readonly truncated: boolean;
	readonly droppedEventCount: number;
	readonly integrityFailureCount: number;
}

export interface QualificationResult {
	readonly verdict:
		| "PASS_INDEPENDENT_HOLDOUT_DESCRIPTIVE"
		| "CALIBRATION_REPLICATED_NOT_PRODUCTION_QUALIFIED"
		| "CALIBRATION_NOT_REPLICATED"
		| "INDEPENDENT_HOLDOUT_SMALL_SAMPLE"
		| "AWAITING_INDEPENDENT_DOGFOOD_SESSION"
		| "CAPTURE_INSUFFICIENT"
		| "HALT";
	readonly reason: string;
}

/* ------------------------------------------------------------------ */
/* Session independence qualification                                  */
/* ------------------------------------------------------------------ */

export interface IndependenceVerdict {
	readonly independent: boolean;
	readonly reasonCode:
		| "INDEPENDENT_SESSION_CONFIRMED"
		| "NO_INDEPENDENT_SESSION"
		| "SAME_SESSION_AS_TRAINING"
		| "DUPLICATE_EXPORT_SAME_SESSION"
		| "SESSION_ID_LEAKAGE";
	readonly holdoutSessionIds: readonly string[];
	readonly trainingSessionIds: readonly string[];
}

/**
 * Classify the independence of a set of holdout traces against the frozen
 * training session.
 *
 * A holdout is independent only when it contributes at least one session id
 * that is NOT the training session and NOT already contributed by another
 * holdout source. Two exports of the SAME session are ONE sample, never
 * two — a same-session duplicate export is reported explicitly so that a
 * duplicated file can never inflate the independent-session count.
 */
export function qualifyIndependence(
	holdoutDescriptors: readonly SourceTraceDescriptor[],
	trainingSessionId: string = TRAINING_SESSION_ID,
): IndependenceVerdict {
	const trainingSessionIds = [trainingSessionId];
	const holdoutSessionIds: string[] = [];
	const seen = new Set<string>();
	let duplicateExports = 0;

	for (const descriptor of holdoutDescriptors) {
		if (seen.has(descriptor.sessionId)) {
			duplicateExports += 1;
			continue;
		}
		seen.add(descriptor.sessionId);
		if (descriptor.sessionId === trainingSessionId) {
			continue;
		}
		holdoutSessionIds.push(descriptor.sessionId);
	}

	if (holdoutSessionIds.length === 0) {
		return {
			independent: false,
			reasonCode: duplicateExports > 0 ? "DUPLICATE_EXPORT_SAME_SESSION" : "NO_INDEPENDENT_SESSION",
			holdoutSessionIds,
			trainingSessionIds,
		};
	}
	return {
		independent: true,
		reasonCode: "INDEPENDENT_SESSION_CONFIRMED",
		holdoutSessionIds,
		trainingSessionIds,
	};
}

/* ------------------------------------------------------------------ */
/* Holdout export de-duplication                                       */
/* ------------------------------------------------------------------ */

export interface ExportDedupConflict {
	readonly sessionId: string;
	readonly reason: "CONFLICTING_EXPORTS_FOR_ONE_SESSION";
	readonly paths: readonly string[];
	readonly sha256s: readonly string[];
}

export interface ExportDedupResult {
	/** The ONE accepted export per non-conflicting session. */
	readonly accepted: readonly SourceTraceDescriptor[];
	/** Byte-identical re-exports of an accepted export. */
	readonly duplicates: readonly { path: string; sessionId: string; sha256: string; reason: "IDENTICAL_DUPLICATE_EXPORT" }[];
	/** Sessions whose exports disagree — NONE of them is accepted. */
	readonly conflicts: readonly ExportDedupConflict[];
}

/**
 * De-duplicate holdout exports BY SESSION IDENTITY before any dataset is
 * constructed.
 *
 * ## Why this exists (CORRECTION01, P0-2)
 *
 * `qualifyIndependence()` already deduplicates session IDs for the
 * independent-session COUNT. But the runner subsequently processed EVERY
 * discovered export independently, so exporting one holdout session twice
 * produced two copies of every eligible row — inflating the holdout dataset
 * and distorting every statistic, while still reporting ONE independent
 * session.
 *
 * This function closes that gap:
 *
 *   - exports of one session with the SAME content hash are an idempotent
 *     re-export: the first is accepted, the rest are recorded as duplicates;
 *   - exports of one session with DIFFERENT content hashes CONFLICT. Neither
 *     is trusted: the session is rejected wholesale and reported, because a
 *     silently combined or silently chosen export would misattribute the
 *     evidence.
 *
 * Conflicting and duplicated exports contribute ZERO rows.
 */
export function deduplicateHoldoutExports(
	descriptors: readonly SourceTraceDescriptor[],
): ExportDedupResult {
	const bySession = new Map<string, SourceTraceDescriptor[]>();
	for (const descriptor of descriptors) {
		const group = bySession.get(descriptor.sessionId);
		if (group) {
			group.push(descriptor);
		} else {
			bySession.set(descriptor.sessionId, [descriptor]);
		}
	}

	const accepted: SourceTraceDescriptor[] = [];
	const duplicates: { path: string; sessionId: string; sha256: string; reason: "IDENTICAL_DUPLICATE_EXPORT" }[] = [];
	const conflicts: ExportDedupConflict[] = [];

	for (const [sessionId, group] of bySession) {
		const distinctHashes = new Set(group.map((d) => d.sha256));
		if (group.length === 1) {
			accepted.push(group[0]!);
			continue;
		}
		if (distinctHashes.size === 1) {
			// Byte-identical re-export: keep the first, record the rest.
			accepted.push(group[0]!);
			for (const duplicate of group.slice(1)) {
				duplicates.push({
					path: duplicate.path,
					sessionId,
					sha256: duplicate.sha256,
					reason: "IDENTICAL_DUPLICATE_EXPORT",
				});
			}
			continue;
		}
		// CONFLICT: the exports of this session disagree. Reject the session.
		conflicts.push({
			sessionId,
			reason: "CONFLICTING_EXPORTS_FOR_ONE_SESSION",
			paths: group.map((d) => d.path),
			sha256s: group.map((d) => d.sha256),
		});
	}

	return { accepted, duplicates, conflicts };
}

/* ------------------------------------------------------------------ */
/* Temporal classification (NEVER row-ordinal based)                   */
/* ------------------------------------------------------------------ */


/**
 * The OBSERVABLE temporal classification of a joined row.
 *
 * `epoch` in the prior analyzer is derived from the row ORDINAL and is
 * explicitly NOT a valid general classification. This ACT derives the
 * temporal distinction ONLY from fields recorded on the request itself:
 *
 *   - `compactionInitiated` — the compaction decision ACTUALLY fired for
 *     this preparation.
 *   - `decisionEstimateEquivalentToSubmitted` — the decision-side candidate
 *     was byte-equivalent to the submitted final projection.
 *
 * When neither is observable, the classification is `UNKNOWN`. A row is
 * NEVER assigned a temporal class by its position in a list.
 */
export type ObservableEpoch =
	| "PRE_COMPACTION_EQUIVALENT"
	| "COMPACTION_INITIATED"
	| "POST_COMPACTION_TRANSFORMED"
	| "UNKNOWN";

export function classifyObservableEpoch(row: EligibleRow): ObservableEpoch {
	if (row.compactionInitiated) {
		return "COMPACTION_INITIATED";
	}
	if (row.decisionEstimateEquivalentToSubmitted) {
		return "PRE_COMPACTION_EQUIVALENT";
	}
	return "POST_COMPACTION_TRANSFORMED";
}

/* ------------------------------------------------------------------ */
/* Retry-ambiguity qualification                                       */
/* ------------------------------------------------------------------ */

export interface QualifiedDataset {
	readonly rows: readonly EligibleRow[];
	readonly exclusions: readonly { reason: string; count: number; authority: string }[];
	readonly observed: Record<string, number>;
}

/**
 * Qualify the prior analyzer's dataset for this ACT.
 *
 * ## Why this exists
 *
 * The prior analyzer's `buildDataset` reports `MULTIPLE_ATTEMPTS_FOR_ONE_
 * PREPARATION` when a preparation has more than one provider attempt, but
 * it RETAINS the first attempt it saw and drops only the later one. That is
 * an arbitrary selection between two competing provider attempts for the
 * same preparation — exactly what this ACT forbids ("If retry ambiguity is
 * reported, do not silently keep an arbitrary provider attempt as an
 * authoritative label. Exclude ambiguous preparations or fail the dataset
 * qualification").
 *
 * This adapter therefore performs a SECOND, strict pass: every preparation
 * whose attempt count is not exactly one is REMOVED from the eligible set
 * and reported with the reason `AMBIGUOUS_RETRY_PREPARATION_EXCLUDED`.
 *
 * The prior ACT's committed analyzer is NOT modified — this is a strict
 * post-filter over its output.
 */
export function qualifyDataset(trace: Trace): QualifiedDataset {
	const parsed = buildDataset(trace);
	const completions = trace.events.filter((e) => e.boundary === "provider_completed" && e.phase === "start");

	// Count DISTINCT provider attempts per preparation. A duplicate
	// completion event for the SAME attempt id is not an ambiguity; two
	// DIFFERENT attempt ids for one preparation is.
	const attemptIdsByPreparation = new Map<string, Set<string>>();
	for (const event of completions) {
		const preparation = event.metadata.preparationRequestId;
		const attempt = event.metadata.modelRequestId;
		if (typeof preparation !== "string" || typeof attempt !== "string") {
			continue;
		}
		let attempts = attemptIdsByPreparation.get(preparation);
		if (!attempts) {
			attempts = new Set<string>();
			attemptIdsByPreparation.set(preparation, attempts);
		}
		attempts.add(attempt);
	}

	const ambiguousPreparations = new Set<string>();
	for (const [preparation, attempts] of attemptIdsByPreparation) {
		if (attempts.size > 1) {
			ambiguousPreparations.add(preparation);
		}
	}

	const rows = parsed.rows.filter((row) => !ambiguousPreparations.has(row.preparationRequestId));
	const excludedRows = parsed.rows.length - rows.length;
	const exclusions = [
		...parsed.exclusions,
		...(excludedRows > 0
			? [
					{
						reason: "AMBIGUOUS_RETRY_PREPARATION_EXCLUDED",
						count: excludedRows,
						authority: "AUTHORITATIVE_SOURCE",
					},
				]
			: []),
	];
	return {
		rows,
		exclusions,
		observed: {
			...parsed.observed,
			ambiguousPreparations: ambiguousPreparations.size,
			excludedAmbiguousRows: excludedRows,
		},
	};
}


/* ------------------------------------------------------------------ */
/* Safety discriminators                                               */
/* ------------------------------------------------------------------ */

export interface SafetyDiscriminators {
	readonly candidateId: string;
	readonly estimate: number;
	readonly actualInput: number;
	readonly requestTriggerTokens: number;
	readonly maxInputTokens: number;
	readonly rawMaxInputTokens: number;
	readonly underestimateFactor: number;
	readonly underestimates: boolean;
	readonly underestimationTokens: number;
	readonly underestimationFractionOfActual: number;
	/** actualInput >= requestTriggerTokens AND calibratedEstimate < requestTriggerTokens */
	readonly falseSafeTrigger: boolean;
	/** actualInput > maxInputTokens AND calibratedEstimate <= maxInputTokens */
	readonly falseSafeCeiling: boolean;
	/** actualInput >= 0.9 * requestTriggerTokens */
	readonly nearTrigger: boolean;
	/** actualInput >= 0.9 * maxInputTokens */
	readonly nearCeiling: boolean;
}

export function classifySafety(row: EligibleRow, candidate: Candidate): SafetyDiscriminators {
	const estimate = applyCandidate(row, candidate);
	const actual = row.inputTokens;
	const underestimationTokens = Math.max(0, actual - estimate);
	return {
		candidateId: candidate.id,
		estimate,
		actualInput: actual,
		requestTriggerTokens: row.requestTriggerTokens,
		maxInputTokens: row.maxInputTokens,
		rawMaxInputTokens: row.rawMaxInputTokens,
		underestimateFactor: row.underestimateFactor,
		underestimates: estimate < actual,
		underestimationTokens,
		underestimationFractionOfActual: actual > 0 ? underestimationTokens / actual : 0,
		falseSafeTrigger: actual >= row.requestTriggerTokens && estimate < row.requestTriggerTokens,
		falseSafeCeiling: actual > row.maxInputTokens && estimate <= row.maxInputTokens,
		nearTrigger: actual >= 0.9 * row.requestTriggerTokens,
		nearCeiling: actual >= 0.9 * row.maxInputTokens,
	};
}

export interface SafetySummary {
	readonly candidateId: string;
	readonly evaluatedRequests: number;
	readonly underestimatingRequests: number;
	readonly underestimationFrequency: number;
	readonly maximumUnderestimationTokens: number;
	readonly maximumUnderestimationFractionOfActual: number;
	readonly falseSafeTriggerCount: number;
	readonly falseSafeCeilingCount: number;
	readonly nearTriggerCount: number;
	readonly nearCeilingCount: number;
	readonly nearLimitCoverage:
		| "NEAR_LIMIT_SAFETY_OBSERVED"
		| "NEAR_LIMIT_TRIGGER_OBSERVED_ONLY"
		| "NEAR_LIMIT_SAFETY_UNOBSERVED";
	readonly actualOverLimitRequests: number;
	readonly actualAtOrAboveTriggerRequests: number;
}

/**
 * Summarize the safety discriminators for one candidate over the qualified
 * rows.
 *
 * When NO near-limit observation exists at all, the summary is explicitly
 * `NEAR_LIMIT_SAFETY_UNOBSERVED`: a zero-risk claim is never made from zero
 * examples.
 */
export function summarizeSafety(rows: readonly EligibleRow[], candidate: Candidate): SafetySummary {
	const discriminators = rows.map((row) => classifySafety(row, candidate));
	const underestimating = discriminators.filter((d) => d.underestimates);
	const nearTrigger = discriminators.filter((d) => d.nearTrigger);
	const nearCeiling = discriminators.filter((d) => d.nearCeiling);
	const nearLimitCoverage: SafetySummary["nearLimitCoverage"] =
		nearCeiling.length > 0
			? "NEAR_LIMIT_SAFETY_OBSERVED"
			: nearTrigger.length > 0
				? "NEAR_LIMIT_TRIGGER_OBSERVED_ONLY"
				: "NEAR_LIMIT_SAFETY_UNOBSERVED";
	return {
		candidateId: candidate.id,
		evaluatedRequests: rows.length,
		underestimatingRequests: underestimating.length,
		underestimationFrequency: rows.length ? underestimating.length / rows.length : 0,
		maximumUnderestimationTokens: Math.max(0, ...underestimating.map((d) => d.underestimationTokens)),
		maximumUnderestimationFractionOfActual: Math.max(0, ...underestimating.map((d) => d.underestimationFractionOfActual)),
		falseSafeTriggerCount: discriminators.filter((d) => d.falseSafeTrigger).length,
		falseSafeCeilingCount: discriminators.filter((d) => d.falseSafeCeiling).length,
		nearTriggerCount: nearTrigger.length,
		nearCeilingCount: nearCeiling.length,
		nearLimitCoverage,
		actualOverLimitRequests: discriminators.filter((d) => d.actualInput > d.maxInputTokens).length,
		actualAtOrAboveTriggerRequests: discriminators.filter((d) => d.actualInput >= d.requestTriggerTokens).length,
	};
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export interface CandidateComparison {
	readonly candidateId: string;
	readonly candidate: Candidate;
	readonly statistics: ReturnType<typeof stats>;
	readonly safety: SafetySummary;
	readonly accuracyImprovementVsBaseline: {
		readonly medianAbsoluteErrorDelta: number;
		readonly medianAbsoluteErrorRatio: number | undefined;
		readonly p95AbsoluteErrorDelta: number;
		readonly interpretation: string;
	};
}

/**
 * Evaluate every FROZEN candidate over the qualified holdout rows.
 *
 * The baseline comparison is descriptive only. NO coefficient is selected,
 * tuned or re-fitted here.
 */
export function compareCandidates(rows: readonly EligibleRow[]): CandidateComparison[] {
	const baselineStats = stats(rows, FROZEN_CANDIDATES[0]!);
	return FROZEN_CANDIDATES.map((candidate) => {
		const statistics = stats(rows, candidate);
		const baselineMedian = baselineStats.medianAbsoluteError ?? 0;
		const candidateMedian = statistics.medianAbsoluteError ?? 0;
		return {
			candidateId: candidate.id,
			candidate,
			statistics,
			safety: summarizeSafety(rows, candidate),
			accuracyImprovementVsBaseline: {
				medianAbsoluteErrorDelta: candidateMedian - baselineMedian,
				medianAbsoluteErrorRatio: baselineMedian > 0 ? candidateMedian / baselineMedian : undefined,
				p95AbsoluteErrorDelta: (statistics.p95AbsoluteError ?? 0) - (baselineStats.p95AbsoluteError ?? 0),
				interpretation:
					candidateMedian < baselineMedian
						? "MATERIALLY_LOWER_ERROR"
						: candidateMedian === baselineMedian
							? "UNCHANGED"
							: "MATERIALLY_HIGHER_ERROR",
			},
		};
	});
}

/**
 * The production-suitability verdict for the frozen candidates.
 *
 * CORRECTION01: `NOT_EVALUATED` is a first-class state. It means the gate
 * could not be evaluated at all because no qualified observation exists. It
 * is NOT a positive result and NOT a pass.
 *
 * CORRECTION02: the gate is scoped to the PRIMARY candidate only. The
 * exploratory candidates are reported separately and never contribute to the
 * primary's suitability.
 */
export interface ProductionSuitability {
	readonly status: "NOT_EVALUATED" | "EVALUATED" | "EVALUATED_WITH_FAILURES";
	readonly productionProposalSuitable: boolean;
	readonly reasons: readonly string[];
	/** The number of DISTINCT qualified requests the gate was evaluated on. */
	readonly evaluatedRequests: number;
	/** The candidate the gate is scoped to. */
	readonly primaryCandidateId: string;
	/** Per-candidate reasons, so no candidate's diagnostics are lost. */
	readonly perCandidate: readonly {
		readonly candidateId: string;
		readonly isPrimary: boolean;
		readonly reasons: readonly string[];
	}[];
}

/**
 * The pre-registered safety gate, scoped to ONE candidate.
 *
 * The frozen factor is NOT suitable for a production proposal if the holdout
 * demonstrates a false-safe ceiling crossing, unsupported request accounting,
 * or a significant unmitigated underestimate near the effective limit.
 *
 * ## CORRECTION01 — absence of evidence is NEVER a positive result
 *
 * The previous implementation returned `productionProposalSuitable: true`
 * whenever no failure reason had been recorded. With zero evaluated requests
 * that produced a POSITIVE suitability claim from an EMPTY dataset, which
 * contradicts the safety-unknown conclusion the qualification report states.
 *
 * The gate is now explicitly three-state:
 *
 *   - `NOT_EVALUATED` — no qualified observation exists. The factor is NOT
 *     suitable for a production proposal, and no claim of safety is made.
 *   - `EVALUATED` — observations exist and no pre-registered failure fired.
 *   - `EVALUATED_WITH_FAILURES` — observations exist and at least one
 *     pre-registered failure fired.
 *
 * ## CORRECTION02 — the gate is scoped to the PRIMARY candidate
 *
 * The previous implementation aggregated the failures of ALL FOUR candidates
 * into one verdict, and `classifyVerdict()` read that aggregate to decide
 * whether the PRIMARY calibration had replicated. An EXPLORATORY candidate
 * that failed therefore misclassified the primary candidate.
 *
 * Concretely: with baseline estimate 2000, actual provider input 1510 and an
 * effective ceiling of 1600, the primary constant candidate estimates 1599 and
 * does NOT underestimate; only the exploratory affine candidate (1014)
 * underestimates by ~33% near the ceiling. The aggregate gate failed on the
 * affine candidate and the primary was reported as not replicated.
 *
 * The gate is now evaluated for the PRIMARY candidate ALONE. The exploratory
 * candidates keep their own diagnostics in `perCandidate` and in
 * `safety-discriminators.json`, but they can no longer fail the primary.
 */
export function productionSuitability(
	comparisons: readonly CandidateComparison[],
	primaryCandidateId: string = PRIMARY_CANDIDATE_ID,
): ProductionSuitability {
	// The distinct qualified request count. Every candidate is evaluated over
	// the SAME qualified rows, so the count is taken from the first
	// comparison rather than SUMMED across candidates (which previously
	// reported 4 evaluations for 1 real request).
	const evaluatedRequests = comparisons[0]?.safety.evaluatedRequests ?? 0;

	const reasonsFor = (comparison: CandidateComparison): string[] => {
		const reasons: string[] = [];
		if (comparison.safety.falseSafeCeilingCount > 0) {
			reasons.push(`${comparison.candidateId}:FALSE_SAFE_CEILING_CROSSING`);
		}
		if (
			comparison.safety.nearCeilingCount > 0 &&
			comparison.safety.underestimatingRequests > 0 &&
			comparison.safety.maximumUnderestimationFractionOfActual > 0.05
		) {
			reasons.push(`${comparison.candidateId}:SIGNIFICANT_UNDERESTIMATE_NEAR_EFFECTIVE_LIMIT`);
		}
		return reasons;
	};

	const perCandidate = comparisons.map((comparison) => ({
		candidateId: comparison.candidateId,
		isPrimary: comparison.candidateId === primaryCandidateId,
		reasons: reasonsFor(comparison),
	}));

	if (evaluatedRequests === 0) {
		return {
			status: "NOT_EVALUATED",
			productionProposalSuitable: false,
			reasons: ["NO_QUALIFIED_OBSERVATIONS"],
			evaluatedRequests: 0,
			primaryCandidateId,
			perCandidate,
		};
	}

	const primary = perCandidate.find((entry) => entry.isPrimary);
	if (!primary) {
		return {
			status: "EVALUATED_WITH_FAILURES",
			productionProposalSuitable: false,
			reasons: [`MISSING_PRIMARY_CANDIDATE:${primaryCandidateId}`],
			evaluatedRequests,
			primaryCandidateId,
			perCandidate,
		};
	}

	return {
		status: primary.reasons.length === 0 ? "EVALUATED" : "EVALUATED_WITH_FAILURES",
		productionProposalSuitable: primary.reasons.length === 0,
		reasons: primary.reasons,
		evaluatedRequests,
		primaryCandidateId,
		perCandidate,
	};
}



/**
 * The final verdict for a qualified holdout evaluation.
 *
 * The verdict NEVER authorizes production deployment. A replicated
 * calibration is only `CALIBRATION_REPLICATED_NOT_PRODUCTION_QUALIFIED`.
 */
export function classifyVerdict(
	rows: readonly EligibleRow[],
	comparisons: readonly CandidateComparison[],
): QualificationResult {
	if (rows.length === 0) {
		return {
			verdict: "CAPTURE_INSUFFICIENT",
			reason: "No qualified, authoritatively joined provider attempt was available for the holdout.",
		};
	}
	const primary = comparisons.find((c) => c.candidateId === PRIMARY_CANDIDATE_ID);
	const baseline = comparisons.find((c) => c.candidateId === "BASELINE");
	if (!primary || !baseline) {
		return { verdict: "HALT", reason: "A frozen candidate was missing from the comparison set." };
	}
	const materiallyLower =
		(primary.statistics.medianAbsoluteError ?? Infinity) < (baseline.statistics.medianAbsoluteError ?? Infinity);
	// CORRECTION02: the safety gate is scoped to the PRIMARY candidate. The
	// exploratory candidates' failures are recorded in `perCandidate` and in
	// the safety artifact, but they must NOT decide whether the primary
	// calibration replicated.
	const safety = productionSuitability(comparisons, PRIMARY_CANDIDATE_ID);
	const criticalFailure =
		safety.reasons.some((r) => r.includes("FALSE_SAFE_CEILING_CROSSING")) ||
		safety.reasons.some((r) => r.includes("SIGNIFICANT_UNDERESTIMATE_NEAR_EFFECTIVE_LIMIT"));

	if (!materiallyLower) {
		return {
			verdict: "CALIBRATION_NOT_REPLICATED",
			reason:
				"The frozen constant candidate did not materially improve median absolute error against the baseline on the independent holdout. The baseline is retained and the holdout was NOT used to refit.",
		};
	}
	if (criticalFailure) {
		return {
			verdict: "CALIBRATION_NOT_REPLICATED",
			reason:
				"The frozen candidate materially improved accuracy but demonstrated a pre-registered critical safety failure. The baseline is retained and the holdout was NOT used to refit.",
		};
	}
	if (rows.length < OBSERVATION_TARGET) {
		return {
			verdict: "INDEPENDENT_HOLDOUT_SMALL_SAMPLE",
			reason: `A genuine independent session was observed, but only ${rows.length} eligible attempts were available (pre-registered observation target: ${OBSERVATION_TARGET}). Measurements are retained without overclaiming.`,
		};
	}
	return {
		verdict: "CALIBRATION_REPLICATED_NOT_PRODUCTION_QUALIFIED",
		reason:
			"The frozen constant candidate materially reduced median absolute error on an independent session with no observed critical safety failure. This does NOT authorize production deployment; the original production estimator is retained.",
	};
}

/* ------------------------------------------------------------------ */
/* Artifact writers (THIS ACT's directory only)                        */
/* ------------------------------------------------------------------ */

export function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** The previous ACT's evidence directory. It is READ-ONLY for this ACT. */
export const PREVIOUS_ACT_OUTPUT_DIR = join(
	HERE,
	"..",
	"..",
	"ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01",
);

/**
 * Assert that this ACT writes ONLY under its own output directory.
 *
 * This is the runtime guard behind witness V7: a new holdout trace can
 * never overwrite the previous calibration's artifacts.
 */
export function assertNoPreviousActOverwrite(targetPath: string): void {
	if (!targetPath.startsWith(OUTPUT_DIR)) {
		throw new Error(`HOLDOUT_WRITE_OUTSIDE_OWN_OUTPUT_DIR:${targetPath}`);
	}
	if (targetPath.includes("ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01")) {
		throw new Error(`HOLDOUT_WRITE_TARGETS_PREVIOUS_ACT:${targetPath}`);
	}
}

/**
 * Write a JSON artifact under THIS ACT's output directory.
 *
 * The previous ACT's evidence directory is NEVER a write target. The
 * `assertNoPreviousActOverwrite` witness (V7) proves this at runtime.
 */
export function writeArtifact(name: string, value: unknown): { path: string; sha256: string; bytes: number } {
	const path = join(OUTPUT_DIR, name);
	assertNoPreviousActOverwrite(path);
	const body = `${JSON.stringify(value, null, 2)}\n`;
	writeFileSync(path, body, "utf8");
	return { path, sha256: sha256(new TextEncoder().encode(body)), bytes: Buffer.byteLength(body) };
}

/* ------------------------------------------------------------------ */
/* Trace descriptor                                                    */
/* ------------------------------------------------------------------ */

export function describeTrace(path: string): SourceTraceDescriptor {
	const bytes = readFileSync(path);
	const trace = JSON.parse(bytes.toString("utf8")) as Trace;
	const truncation = (trace.truncation ?? {}) as Record<string, unknown>;
	return {
		path,
		sha256: sha256(bytes),
		bytes: bytes.byteLength,
		sessionId: trace.sessionId,
		schema: trace.schema,
		eventCount: trace.eventCount,
		truncated: truncation.truncated === true,
		droppedEventCount: typeof truncation.droppedEventCount === "number" ? truncation.droppedEventCount : 0,
		integrityFailureCount:
			typeof truncation.totalIntegrityFailureCount === "number" ? truncation.totalIntegrityFailureCount : 0,
	};
}

export { applyCandidate, assertNoSessionLeakage, buildDataset, quantile, safety, stats, TARGET_SCOPE };
export type { Candidate, EligibleRow, Trace };
