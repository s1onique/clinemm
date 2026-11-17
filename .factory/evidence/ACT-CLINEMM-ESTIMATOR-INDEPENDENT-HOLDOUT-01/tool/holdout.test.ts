/**
 * ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01 — focused witnesses V1..V12.
 *
 * These tests exercise the REAL analysis functions: the holdout adapter and
 * the prior ACT's committed production-seam parser. No re-implementation of
 * the join, the candidate application or the statistics happens here.
 */
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	applyCandidate,
	assertNoPreviousActOverwrite,
	assertNoSessionLeakage,
	buildDataset,
	classifyObservableEpoch,
	classifySafety,
	classifyVerdict,
	compareCandidates,
	FROZEN_CANDIDATES,
	OBSERVATION_TARGET,
	OUTPUT_DIR,
	PREVIOUS_ACT_OUTPUT_DIR,
	PRIMARY_CANDIDATE_ID,
	productionSuitability,
	qualifyDataset,
	qualifyIndependence,
	summarizeSafety,
	TRAINING_SESSION_ID,
	type EligibleRow,
	type SourceTraceDescriptor,
	type Trace,
} from "./holdout";

/* ---------------- fixtures (target provider/model only) ---------------- */

const TARGET_MODEL = "qwen3.8-flash-next-iq3_s";
const TARGET_PROVIDER = "openai-compatible";

const decision = (prep: string, id: string, initiated = false, requestInput = 100) => ({
	correlationId: "s",
	boundary: "compaction_decision",
	phase: "start",
	monotonicMs: 1,
	wallClockIso: "",
	metadata: {
		preparationRequestId: prep,
		decisionId: id,
		decisionJoinAuthority: "AUTHORITATIVE",
		requestInputTokens: requestInput,
		requestTriggerTokens: 90,
		rawMaxInputTokens: 100,
		maxInputTokens: 100,
		underestimateFactor: 1,
		compactionInitiated: initiated,
		compactionMode: "auto",
	},
});

const completion = (
	prep: string,
	attempt: string,
	input: number,
	estimate = 100,
	modelId = TARGET_MODEL,
	providerId = TARGET_PROVIDER,
) => ({
	correlationId: "s",
	boundary: "provider_completed",
	phase: "start",
	monotonicMs: 2,
	wallClockIso: "",
	metadata: {
		preparationRequestId: prep,
		modelRequestId: attempt,
		inputTokens: input,
		cacheReadTokens: 0,
		estimatedFinalInputTokens: estimate,
		modelId,
		providerFamily: providerId,
		finalProjectionFingerprint: "f",
	},
});

const trace = (events: any[]): Trace =>
	({ schema: "x", sessionId: "s", correlationId: "s", eventCount: events.length, truncation: { truncated: false }, events }) as Trace;

const row = (overrides: Partial<EligibleRow> = {}): EligibleRow =>
	({
		sessionId: "holdout_session",
		decisionId: "d",
		preparationRequestId: "p",
		modelRequestId: "a",
		providerId: TARGET_PROVIDER,
		modelId: TARGET_MODEL,
		decisionEstimateEquivalentToSubmitted: true,
		requestInputTokens: 100,
		estimatedFinalInputTokens: 100,
		inputTokens: 100,
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
		...overrides,
	}) as EligibleRow;


describe("ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01 focused witnesses", () => {
	/* ---------------- V1: session disjointness ---------------- */
	it("V1 training and holdout session ids are disjoint", () => {
		const training = [row({ sessionId: TRAINING_SESSION_ID })];
		const holdout = [row({ sessionId: "independent_session" })];
		expect(() => assertNoSessionLeakage(training, holdout)).not.toThrow();
		// A holdout that contains the training session MUST be rejected.
		const leaked = [row({ sessionId: TRAINING_SESSION_ID })];
		expect(() => assertNoSessionLeakage(training, leaked)).toThrow(/SESSION_LEAKAGE/);
		// The qualification gate also refuses the training session as holdout.
		const verdict = qualifyIndependence([descriptor(TRAINING_SESSION_ID)]);
		expect(verdict.independent).toBe(false);
		expect(verdict.holdoutSessionIds).not.toContain(TRAINING_SESSION_ID);
	});

	/* ---------------- V2: frozen constants cannot change ---------------- */
	it("V2 frozen calibration constants cannot change during evaluation", () => {
		const before = JSON.stringify(FROZEN_CANDIDATES);
		expect(Object.isFrozen(FROZEN_CANDIDATES)).toBe(true);
		expect(() => {
			// @ts-expect-error — a deliberate illegal mutation; the freeze must reject it.
			(FROZEN_CANDIDATES[1] as { factor?: number }).factor = 0.5;
		}).toThrow();
		expect(JSON.stringify(FROZEN_CANDIDATES)).toBe(before);
		// The frozen values are exactly the pre-registered coefficients.
		const constant = FROZEN_CANDIDATES.find((c) => c.id === "CONSTANT")!;
		const scoped = FROZEN_CANDIDATES.find((c) => c.id === PRIMARY_CANDIDATE_ID)!;
		const affine = FROZEN_CANDIDATES.find((c) => c.id === "AFFINE")!;
		expect(constant.factor).toBe(0.79935);
		expect(scoped.factor).toBe(0.79935);
		expect(affine.a).toBe(0.8078297287430471);
		expect(affine.b).toBe(-601.9734484558503);
		// Evaluating rows never mutates the candidate set.
		compareCandidates([row({ estimatedFinalInputTokens: 100, inputTokens: 80 })]);
		expect(JSON.stringify(FROZEN_CANDIDATES)).toBe(before);
	});

	/* ---------------- V3: exact provider-attempt identity required ---------------- */
	it("V3 exact provider-attempt identity is required", () => {
		// A decision whose preparation id matches NO completion is excluded.
		const orphan = buildDataset(trace([decision("p1", "d"), completion("p2", "a", 50)]));
		expect(orphan.rows.length).toBe(0);
		expect(orphan.exclusions.some((e) => e.reason === "DECISION_CANDIDATE_NOT_SUBMITTED_OR_NO_AUTHORITATIVE_COMPLETION")).toBe(true);
		// A completion with no decision identity is NOT an eligible pair.
		expect(buildDataset(trace([completion("p", "a", 50)])).rows.length).toBe(0);
		// The exact triple is accepted.
		const exact = buildDataset(trace([decision("p", "d"), completion("p", "a", 50)]));
		expect(exact.rows.length).toBe(1);
		expect(exact.rows[0]!.preparationRequestId).toBe("p");
		expect(exact.rows[0]!.modelRequestId).toBe("a");
	});

	/* ---------------- V4: ambiguous retries excluded, not selected ---------------- */
	it("V4 ambiguous retries are excluded, not arbitrarily selected", () => {
		const dataset = qualifyDataset(
			trace([decision("p", "d"), completion("p", "a", 50), completion("p", "b", 51)]),
		);
		// The ambiguous preparation contributes NO eligible row: neither
		// attempt is arbitrarily selected as the authoritative label.
		expect(dataset.rows.length).toBe(0);
		expect(dataset.rows.some((r) => r.modelRequestId === "a" || r.modelRequestId === "b")).toBe(false);
		// The ambiguity is reported explicitly, not silently dropped.
		expect(
			dataset.exclusions.some((e) => e.reason === "MULTIPLE_ATTEMPTS_FOR_ONE_PREPARATION"),
		).toBe(true);
		expect(
			dataset.exclusions.some((e) => e.reason === "AMBIGUOUS_RETRY_PREPARATION_EXCLUDED"),
		).toBe(true);
		expect(dataset.observed.excludedAmbiguousRows).toBe(1);
		// The DELIBERATELY FAULTY behaviour of the prior analyzer is
		// demonstrated: it silently retains the FIRST attempt.
		const naive = buildDataset(
			trace([decision("p", "d"), completion("p", "a", 50), completion("p", "b", 51)]),
		);
		expect(naive.rows.length).toBe(1);
		expect(naive.rows[0]!.modelRequestId).toBe("a");
		// The strict qualification pass removes it.
		expect(dataset.rows.length).toBeLessThan(naive.rows.length);
		// A DUPLICATE completion event for the SAME attempt id is NOT an
		// ambiguity — the row survives.
		const duplicateEvent = qualifyDataset(
			trace([decision("p", "d"), completion("p", "a", 50), completion("p", "a", 50)]),
		);
		expect(duplicateEvent.rows.length).toBe(1);
		expect(duplicateEvent.observed.ambiguousPreparations).toBe(0);
	});

	/* ---------------- V5: cached tokens never double-counted ---------------- */
	it("V5 cached-token subset is never double-counted", () => {
		const c = completion("p", "a", 50);
		c.metadata.cacheReadTokens = 40;
		const dataset = buildDataset(trace([decision("p", "d"), c]));
		expect(dataset.rows.length).toBe(1);
		expect(dataset.rows[0]!.inputTokens).toBe(50);
		expect(dataset.rows[0]!.cacheReadTokens).toBe(40);
		// The accounting quantity is the provider's COMPLETE input, not input+cache.
		expect(dataset.rows[0]!.inputTokens).not.toBe(90);
		const baseline = applyCandidate(dataset.rows[0]!, FROZEN_CANDIDATES[0]!);
		expect(baseline).toBe(dataset.rows[0]!.estimatedFinalInputTokens);
	});

	/* ---------------- V6: same-session duplicate export is not independence ---------------- */
	it("V6 a same-session duplicate export is never counted as independence", () => {
		const duplicated = qualifyIndependence([
			descriptor("independent_session"),
			descriptor("independent_session"),
		]);
		expect(duplicated.holdoutSessionIds).toEqual(["independent_session"]);
		expect(duplicated.reasonCode).toBe("INDEPENDENT_SESSION_CONFIRMED");
		// Only the TRAINING session duplicated → no independent session at all.
		const onlyTraining = qualifyIndependence([
			descriptor(TRAINING_SESSION_ID),
			descriptor(TRAINING_SESSION_ID),
		]);
		expect(onlyTraining.independent).toBe(false);
		expect(onlyTraining.reasonCode).toBe("DUPLICATE_EXPORT_SAME_SESSION");
	});

	/* ---------------- V7: new trace cannot overwrite previous calibration artifacts ---------------- */
	it("V7 a new holdout trace cannot overwrite the previous calibration artifacts", () => {
		// Writing into the previous ACT's directory is rejected.
		expect(() =>
			assertNoPreviousActOverwrite(join(PREVIOUS_ACT_OUTPUT_DIR, "calibration-candidates.json")),
		).toThrow(/HOLDOUT_WRITE/);
		// Writing outside this ACT's directory is rejected.
		expect(() => assertNoPreviousActOverwrite("/tmp/somewhere-else.json")).toThrow(/HOLDOUT_WRITE/);
		// Writing under this ACT's own directory is accepted.
		expect(() =>
			assertNoPreviousActOverwrite(join(OUTPUT_DIR, "holdout-comparison.json")),
		).not.toThrow();
		// The two directories are genuinely distinct.
		expect(OUTPUT_DIR).not.toBe(PREVIOUS_ACT_OUTPUT_DIR);
		expect(PREVIOUS_ACT_OUTPUT_DIR.endsWith("ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01")).toBe(true);
	});

const descriptor = (sessionId: string): SourceTraceDescriptor => ({
	path: `/tmp/${sessionId}.json`,
	sha256: "deadbeef",
	bytes: 1,
	sessionId,
	schema: "cline.roundc-latency-trace.v1",
	eventCount: 10,
	truncated: false,
	droppedEventCount: 0,
	integrityFailureCount: 0,
});


	/* ---------------- V8: compaction timing is not inferred from row ordinal ---------------- */
	it("V8 compaction timing is never inferred from a hard-coded row ordinal", () => {
		// The prior analyzer's `epoch` field is ordinal-derived and MUST NOT be
		// used as a temporal classification. This ACT's observable
		// classification uses only request-recorded fields.
		const early = row({ compactionInitiated: false, decisionEstimateEquivalentToSubmitted: true });
		const late = row({ compactionInitiated: false, decisionEstimateEquivalentToSubmitted: false });
		const compacted = row({ compactionInitiated: true, decisionEstimateEquivalentToSubmitted: false });
		expect(classifyObservableEpoch(early)).toBe("PRE_COMPACTION_EQUIVALENT");
		expect(classifyObservableEpoch(late)).toBe("POST_COMPACTION_TRANSFORMED");
		expect(classifyObservableEpoch(compacted)).toBe("COMPACTION_INITIATED");
		// Identical observable fields produce identical classification even when
		// the ordinal-derived `epoch` field differs.
		const a = row({ epoch: "pre_compaction" });
		const b = row({ epoch: "post_compaction" });
		expect(classifyObservableEpoch(a)).toBe(classifyObservableEpoch(b));
	});

	/* ---------------- V9: false-safe ceiling and trigger classification ---------------- */
	it("V9 false-safe ceiling and trigger cases are classified correctly", () => {
		const constant = FROZEN_CANDIDATES.find((c) => c.id === "CONSTANT")!;
		// (a) False-safe TRIGGER: actual >= trigger but calibrated estimate < trigger.
		const trigger = classifySafety(
			row({ estimatedFinalInputTokens: 100, inputTokens: 95, requestTriggerTokens: 90, maxInputTokens: 200 }),
			constant,
		);
		expect(trigger.estimate).toBe(80); // ceil(0.79935 * 100)
		expect(trigger.actualInput).toBe(95);
		expect(trigger.falseSafeTrigger).toBe(true);
		expect(trigger.falseSafeCeiling).toBe(false);
		// (b) False-safe CEILING: actual > ceiling but calibrated estimate <= ceiling.
		//     estimate = ceil(0.79935 * 200) = 160; ceiling = 170; actual = 190.
		const ceiling = classifySafety(
			row({ estimatedFinalInputTokens: 200, inputTokens: 190, requestTriggerTokens: 90, maxInputTokens: 170 }),
			constant,
		);
		expect(ceiling.estimate).toBe(160);
		expect(ceiling.actualInput).toBe(190);
		expect(ceiling.maxInputTokens).toBe(170);
		expect(ceiling.falseSafeCeiling).toBe(true);
		expect(ceiling.falseSafeTrigger).toBe(false);
		// (c) A safe case: actual below trigger and below ceiling.
		const safe = classifySafety(
			row({ estimatedFinalInputTokens: 100, inputTokens: 60, requestTriggerTokens: 90, maxInputTokens: 200 }),
			constant,
		);
		expect(safe.falseSafeTrigger).toBe(false);
		expect(safe.falseSafeCeiling).toBe(false);
		// (d) The baseline does NOT create a false-safe trigger where the constant does.
		const baseline = FROZEN_CANDIDATES.find((c) => c.id === "BASELINE")!;
		const triggerRow = row({
			estimatedFinalInputTokens: 100,
			inputTokens: 95,
			requestTriggerTokens: 90,
			maxInputTokens: 200,
		});
		expect(classifySafety(triggerRow, baseline).falseSafeTrigger).toBe(false);
		// A false-safe ceiling is a production-suitability failure.
		const ceilingRow = row({
			estimatedFinalInputTokens: 200,
			inputTokens: 190,
			requestTriggerTokens: 90,
			maxInputTokens: 170,
		});
		const comparisons = compareCandidates([ceilingRow]);
		const suitability = productionSuitability(comparisons);
		expect(suitability.productionProposalSuitable).toBe(false);
		expect(suitability.reasons.some((r) => r.includes("FALSE_SAFE_CEILING_CROSSING"))).toBe(true);
		// And the verdict must NOT claim a replicated calibration.
		expect(classifyVerdict([ceilingRow], comparisons).verdict).toBe("CALIBRATION_NOT_REPLICATED");
	});


	/* ---------------- V10: zero near-limit observations ---------------- */
	it("V10 zero near-limit observations produce NEAR_LIMIT_SAFETY_UNOBSERVED", () => {
		const constant = FROZEN_CANDIDATES.find((c) => c.id === "CONSTANT")!;
		// Far-from-limit rows only.
		// trigger = 1000 → near-trigger starts at 900; ceiling = 1000 → near-ceiling
		// starts at 900. actual = 100 and 120 are far below both.
		const rows = [
			row({
				estimatedFinalInputTokens: 1000,
				inputTokens: 100,
				requestTriggerTokens: 1000,
				maxInputTokens: 1000,
			}),
			row({
				estimatedFinalInputTokens: 1000,
				inputTokens: 120,
				requestTriggerTokens: 1000,
				maxInputTokens: 1000,
			}),
		];
		const summary = summarizeSafety(rows, constant);
		expect(summary.nearTriggerCount).toBe(0);
		expect(summary.nearCeilingCount).toBe(0);
		expect(summary.nearLimitCoverage).toBe("NEAR_LIMIT_SAFETY_UNOBSERVED");
		// A near-trigger but not near-ceiling observation is distinguished.
		// trigger = 100 (near-trigger at 90); ceiling = 1000 (near-ceiling at 900).
		const triggerOnly = summarizeSafety(
			[
				row({
					estimatedFinalInputTokens: 1000,
					inputTokens: 100,
					requestTriggerTokens: 100,
					maxInputTokens: 1000,
				}),
			],
			constant,
		);
		expect(triggerOnly.nearTriggerCount).toBe(1);
		expect(triggerOnly.nearCeilingCount).toBe(0);
		expect(triggerOnly.nearLimitCoverage).toBe("NEAR_LIMIT_TRIGGER_OBSERVED_ONLY");
	});

	/* ---------------- V11: unknown model/provider stays unqualified ---------------- */
	it("V11 unknown model/provider configuration remains unqualified", () => {
		const dataset = buildDataset(
			trace([decision("p", "d"), completion("p", "a", 50, 100, "some-other-model", TARGET_PROVIDER)]),
		);
		expect(dataset.rows.length).toBe(0);
		expect(dataset.exclusions.some((e) => e.reason === "UNSUPPORTED_PROVIDER_MODEL")).toBe(true);
		const otherProvider = buildDataset(
			trace([decision("p", "d"), completion("p", "a", 50, 100, TARGET_MODEL, "anthropic")]),
		);
		expect(otherProvider.rows.length).toBe(0);
		expect(otherProvider.exclusions.some((e) => e.reason === "UNSUPPORTED_PROVIDER_MODEL")).toBe(true);
		// A model-scoped candidate falls back to the original estimate off-scope.
		const offScope = row({ modelId: "some-other-model" });
		const scoped = FROZEN_CANDIDATES.find((c) => c.id === PRIMARY_CANDIDATE_ID)!;
		expect(applyCandidate(offScope, scoped)).toBe(offScope.estimatedFinalInputTokens);
	});

	/* ---------------- V12: no prompts, conversation content, tools or credentials ---------------- */
	it("V12 output contains no prompts, conversation content, tools or credentials", () => {
		const rows = [row({ estimatedFinalInputTokens: 100, inputTokens: 80 })];
		const comparisons = compareCandidates(rows);
		const serialized = JSON.stringify({
			comparison: comparisons.map((c) => ({
				candidateId: c.candidateId,
				statistics: c.statistics,
				safety: c.safety,
			})),
			verdict: classifyVerdict(rows, comparisons),
			independence: qualifyIndependence([descriptor("independent_session")]),
		});
		// No raw request fields, no credentials, no URLs.
		expect(serialized).not.toMatch(/systemPrompt|apiMessages|"tools"|"options"/);
		expect(serialized).not.toMatch(/Bearer\s+/i);
		expect(serialized).not.toMatch(/sk-[A-Za-z0-9_-]{10,}/);
		expect(serialized).not.toMatch(/https?:\/\//);
	});
});
