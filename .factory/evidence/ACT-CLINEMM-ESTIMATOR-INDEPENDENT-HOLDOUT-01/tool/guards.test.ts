/**
 * ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01 — CORRECTION01 guard tests.
 *
 * These are the RED→GREEN witnesses for the three P0 evidence-integrity
 * defects and the one P1 verdict defect raised by the review of
 * 2d5f8c00c:
 *
 *   - P0-1: zero observations must NOT produce a positive
 *     production-suitability result.
 *   - P0-2: duplicate exports of one session must NOT inflate the holdout
 *     dataset.
 *   - P0-3: the test receipt must record only tests ACTUALLY executed and
 *     must distinguish a fresh evaluation from historical test evidence.
 *   - P1: an independent trace with zero eligible attempts is
 *     CAPTURE_INSUFFICIENT, not AWAITING_INDEPENDENT_DOGFOOD_SESSION.
 *
 * The tests exercise the REAL analysis functions — the holdout adapter, the
 * artifact writers and the runner's decision logic.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	classifyVerdict,
	compareCandidates,
	deduplicateHoldoutExports,
	PRIMARY_CANDIDATE_ID,
	productionSuitability,
	qualifyIndependence,
	type EligibleRow,
	type SourceTraceDescriptor,
} from "./holdout";
import { decideVerdict } from "./verdict";
import { buildTestReceipt } from "./receipt";

const descriptor = (sessionId: string, sha256: string, path = `/tmp/${sessionId}.json`): SourceTraceDescriptor => ({
	path,
	sha256,
	bytes: 1,
	sessionId,
	schema: "cline.roundc-latency-trace.v1",
	eventCount: 10,
	truncated: false,
	droppedEventCount: 0,
	integrityFailureCount: 0,
});

describe("CORRECTION01 — P0-1 zero observations must not be positively suitable", () => {
	it("P0-1 zero evaluated requests yield NOT_EVALUATED suitability", () => {
		const comparisons = compareCandidates([]);
		const suitability = productionSuitability(comparisons);
		expect(suitability.status).toBe("NOT_EVALUATED");
		expect(suitability.productionProposalSuitable).toBe(false);
		expect(suitability.reasons).toContain("NO_QUALIFIED_OBSERVATIONS");
		// The old defective shape must be gone.
		expect(suitability).not.toEqual({ productionProposalSuitable: true, reasons: [] });
	});

	it("P0-1 a real observation set with no failure remains suitable", () => {
		const comparisons = compareCandidates([
			{
				sessionId: "s",
				decisionId: "d",
				preparationRequestId: "p",
				modelRequestId: "a",
				providerId: "openai-compatible",
				modelId: "qwen3.8-flash-next-iq3_s",
				decisionEstimateEquivalentToSubmitted: true,
				requestInputTokens: 100,
				estimatedFinalInputTokens: 100,
				inputTokens: 80,
				cacheReadTokens: 0,
				requestTriggerTokens: 90,
				rawMaxInputTokens: 100,
				maxInputTokens: 100,
				underestimateFactor: 1,
				compactionInitiated: false,
				compactionMode: "auto",
				finalProjectionFingerprint: "f",
				providerVisibleMessageCount: 1,
				toolSchemaCount: 1,
				epoch: "pre_compaction",
			},
		]);
		const suitability = productionSuitability(comparisons);
		expect(suitability.status).toBe("EVALUATED");
		expect(suitability.productionProposalSuitable).toBe(true);
		expect(suitability.reasons).not.toContain("NO_QUALIFIED_OBSERVATIONS");
	});
});


describe("CORRECTION01 — P0-2 duplicate exports must not inflate the dataset", () => {
	it("P0-2 byte-identical duplicate exports collapse to one export", () => {
		const a = descriptor("holdout_session", "aaaa");
		const b = descriptor("holdout_session", "aaaa", "/tmp/copy-of-holdout.json");
		const result = deduplicateHoldoutExports([a, b]);
		expect(result.accepted).toHaveLength(1);
		expect(result.accepted[0]!.path).toBe(a.path);
		expect(result.duplicates).toHaveLength(1);
		expect(result.duplicates[0]!.reason).toBe("IDENTICAL_DUPLICATE_EXPORT");
		expect(result.conflicts).toHaveLength(0);
	});

	it("P0-2 conflicting exports for one session are REJECTED, not combined", () => {
		const a = descriptor("holdout_session", "aaaa");
		const b = descriptor("holdout_session", "bbbb", "/tmp/conflicting.json");
		const result = deduplicateHoldoutExports([a, b]);
		// Neither export is trusted: the session is not qualified at all.
		expect(result.accepted).toHaveLength(0);
		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]!.reason).toBe("CONFLICTING_EXPORTS_FOR_ONE_SESSION");
		expect(result.conflicts[0]!.sessionId).toBe("holdout_session");
	});

	it("P0-2 a conflicting session does not contribute rows", () => {
		const accepted = deduplicateHoldoutExports([
			descriptor("s1", "aaaa"),
			descriptor("s1", "bbbb", "/tmp/b.json"),
			descriptor("s2", "cccc", "/tmp/c.json"),
		]).accepted;
		expect(accepted.map((d) => d.sessionId)).toEqual(["s2"]);
	});

	it("P0-2 independence gate sees one session for duplicated exports", () => {
		const independence = qualifyIndependence([
			descriptor("holdout_session", "aaaa"),
			descriptor("holdout_session", "aaaa", "/tmp/copy.json"),
		]);
		expect(independence.holdoutSessionIds).toEqual(["holdout_session"]);
		expect(independence.holdoutSessionIds).toHaveLength(1);
	});
});

describe("CORRECTION01 — P0-3 the receipt records only executed tests", () => {
	it("P0-3 a fresh run with no executed tests records none", () => {
		const receipt = buildTestReceipt("head", "sha", [], {
			evaluation: { kind: "FRESH_EVALUATION", tracesEvaluated: 1 },
		});
		expect(receipt.commands).toEqual([]);
		expect(receipt.historicalTestEvidence).toBeDefined();
		expect(receipt.historicalTestEvidence.every((c) => typeof c.command === "string")).toBe(true);
		// The fresh-evaluation section must not claim any test was run.
		expect(JSON.stringify(receipt.evaluation)).not.toContain("16 pass");
	});

	it("P0-3 historical test evidence is clearly separated from the fresh run", () => {
		const receipt = buildTestReceipt("head", "sha", [], {
			evaluation: { kind: "FRESH_EVALUATION", tracesEvaluated: 0 },
		});
		expect(receipt.evaluation.kind).toBe("FRESH_EVALUATION");
		expect(receipt.historicalTestEvidence.length).toBeGreaterThan(0);
		for (const entry of receipt.historicalTestEvidence) {
			expect(entry.kind).toBe("HISTORICAL_TEST_EVIDENCE");
			expect(entry.result).toBe("PASS");
		}
		// A stale receipt must not be indistinguishable from a fresh one.
		expect(receipt.commands).toHaveLength(0);
	});
});

describe("CORRECTION01 — P1 zero eligible attempts in an independent trace", () => {
	it("P1 an independent trace with zero eligible attempts is CAPTURE_INSUFFICIENT", () => {
		const verdict = decideVerdict({
			independentSessionIds: ["holdout_session"],
			eligibleAttempts: 0,
			comparisons: compareCandidates([]),
		});
		expect(verdict.verdict).toBe("CAPTURE_INSUFFICIENT");
		expect(verdict.reason).toContain("zero eligible attempts");
	});

	it("P1 NO independent session at all is AWAITING_INDEPENDENT_DOGFOOD_SESSION", () => {
		const verdict = decideVerdict({
			independentSessionIds: [],
			eligibleAttempts: 0,
			comparisons: compareCandidates([]),
		});
		expect(verdict.verdict).toBe("AWAITING_INDEPENDENT_DOGFOOD_SESSION");
	});

	it("P1 the historical verify-and-dedup order is preserved", () => {
		// The existing classifyVerdict remains the authority for a populated
		// dataset; decideVerdict only chooses between the empty-data outcomes.
		expect(classifyVerdict([], compareCandidates([])).verdict).toBe("CAPTURE_INSUFFICIENT");
	});
});

/* ------------------------------------------------------------------ */
/* CORRECTION02 — P0: primary-candidate suitability isolation          */
/* ------------------------------------------------------------------ */

/**
 * Build an eligible row whose decision estimate is `estimatedFinalInputTokens`.
 *
 * The review's counterexample:
 *   baseline estimate 2000, actual provider input 1510, ceiling 1600
 *   -> primary CONSTANT estimate 1599 (does NOT underestimate)
 *   -> exploratory AFFINE estimate 1014 (underestimates by ~33%)
 *
 * The primary candidate is clean; only the EXPLORATORY candidate fails.
 */
const counterexampleRow = (estimatedFinalInputTokens: number): EligibleRow => ({
	sessionId: "holdout_session",
	decisionId: "decision-1",
	preparationRequestId: "prep-1",
	modelRequestId: "attempt-1",
	providerId: "openai-compatible",
	modelId: "qwen3.8-flash-next-iq3_s",
	decisionEstimateEquivalentToSubmitted: true,
	requestInputTokens: estimatedFinalInputTokens,
	estimatedFinalInputTokens,
	inputTokens: 1510,
	cacheReadTokens: 0,
	requestTriggerTokens: 1400,
	rawMaxInputTokens: 1600,
	maxInputTokens: 1600,
	underestimateFactor: 1,
	compactionInitiated: false,
	compactionMode: "auto",
	finalProjectionFingerprint: "fingerprint-1",
	providerVisibleMessageCount: 1,
	toolSchemaCount: 1,
	epoch: "pre_compaction",
});

describe("CORRECTION02 — P0 primary suitability must not be conflated with exploratory candidates", () => {
	it("P0 the primary candidate's suitability ignores the exploratory affine candidate", () => {
		const comparisons = compareCandidates([counterexampleRow(2000)]);
		const primary = comparisons.find((c) => c.candidateId === PRIMARY_CANDIDATE_ID);
		const affine = comparisons.find((c) => c.candidateId === "AFFINE");
		expect(primary).toBeDefined();
		expect(affine).toBeDefined();
		// The EXPLORATORY candidate genuinely underestimates near the ceiling.
		expect(affine!.safety.underestimatingRequests).toBe(1);
		expect(affine!.safety.falseSafeCeilingCount).toBe(0);
		expect(affine!.safety.maximumUnderestimationFractionOfActual).toBeGreaterThan(0.05);
		// The PRIMARY candidate does NOT underestimate and has no false-safe ceiling.
		expect(primary!.safety.underestimatingRequests).toBe(0);
		expect(primary!.safety.falseSafeCeilingCount).toBe(0);
		// Yet the AGGREGATE gate currently fails because of the exploratory
		// candidate — this is the defect.
		expect(productionSuitability(comparisons).status).toBe("EVALUATED");
	});

	it("P0 the verdict is decided by the PRIMARY candidate's own safety, not an aggregate", () => {
		const rows = [counterexampleRow(2000)];
		const comparisons = compareCandidates(rows);
		const verdict = classifyVerdict(rows, comparisons);
		// The primary candidate materially improves on the baseline and has no
		// critical safety failure of its own. It must NOT be misclassified as
		// CALIBRATION_NOT_REPLICATED because the exploratory affine candidate
		// failed.
		expect(verdict.verdict).not.toBe("CALIBRATION_NOT_REPLICATED");
		expect(verdict.verdict).toBe("INDEPENDENT_HOLDOUT_SMALL_SAMPLE");
	});

	it("P0 evaluatedRequests reports DISTINCT qualified requests, not the candidate sum", () => {
		const comparisons = compareCandidates([counterexampleRow(2000)]);
		// One real request. The aggregate previously summed `rows.length` over
		// FOUR candidates and reported 4.
		expect(productionSuitability(comparisons).evaluatedRequests).toBe(1);
		expect(comparisons).toHaveLength(4);
		for (const comparison of comparisons) {
			expect(comparison.safety.evaluatedRequests).toBe(1);
		}
	});

	it("P0 per-candidate diagnostics are preserved for every candidate", () => {
		const comparisons = compareCandidates([counterexampleRow(2000)]);
		const byId = new Map(comparisons.map((c) => [c.candidateId, c.safety]));
		// The exploratory candidate's failure remains VISIBLE and attributed.
		expect(byId.get("AFFINE")!.underestimatingRequests).toBe(1);
		expect(byId.get(PRIMARY_CANDIDATE_ID)!.underestimatingRequests).toBe(0);
		// The BASELINE estimate is E itself (2000), which OVER-estimates the
		// 1510-token actual — so it does not underestimate either.
		expect(byId.get("BASELINE")!.underestimatingRequests).toBe(0);
		// Every candidate still reports the same distinct request count.
		for (const comparison of comparisons) {
			expect(comparison.safety.evaluatedRequests).toBe(1);
		}
	});

	it("P0 the gate's perCandidate reasons attribute the failure to the right candidate", () => {
		const comparisons = compareCandidates([counterexampleRow(2000)]);
		const suitability = productionSuitability(comparisons);
		// The exploratory candidate's near-limit underestimate is recorded and
		// attributed to the exploratory candidate — it is NOT lost, and it is
		// NOT attributed to the primary.
		const affineEntry = suitability.perCandidate.find((e) => e.candidateId === "AFFINE")!;
		const primaryEntry = suitability.perCandidate.find((e) => e.isPrimary)!;
		expect(affineEntry.reasons).toContain("AFFINE:SIGNIFICANT_UNDERESTIMATE_NEAR_EFFECTIVE_LIMIT");
		expect(primaryEntry.reasons).toEqual([]);
		expect(suitability.reasons).toEqual([]);
		expect(suitability.primaryCandidateId).toBe(PRIMARY_CANDIDATE_ID);
	});

	it("P0 the PRIMARY candidate's OWN critical failure still fails the gate", () => {
		// The isolation must not weaken the gate: if the PRIMARY candidate
		// itself crosses the effective ceiling falsely, it MUST fail.
		const crossingRow: EligibleRow = {
			...counterexampleRow(2000),
			// Actual input exceeds the effective ceiling, and the primary
			// constant estimate (1599) sits BELOW it -> false-safe ceiling.
			inputTokens: 1700,
			requestTriggerTokens: 1400,
		};
		const comparisons = compareCandidates([crossingRow]);
		const suitability = productionSuitability(comparisons);
		expect(suitability.status).toBe("EVALUATED_WITH_FAILURES");
		expect(suitability.productionProposalSuitable).toBe(false);
		expect(suitability.reasons).toContain(`${PRIMARY_CANDIDATE_ID}:FALSE_SAFE_CEILING_CROSSING`);
	});
});

