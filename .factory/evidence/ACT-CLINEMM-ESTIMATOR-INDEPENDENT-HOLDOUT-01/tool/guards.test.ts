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
	productionSuitability,
	qualifyIndependence,
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
