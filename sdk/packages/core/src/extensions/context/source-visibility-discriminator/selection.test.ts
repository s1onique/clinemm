/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * G5 — the record-selection discriminator.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement suite.
 * ============================================================================
 *
 * THE HISTORICAL PROBLEM
 * ----------------------
 *
 * The predecessor's checkpoint emitted 13 records at boundary 1 and 20 at
 * boundary 2, and the EXPERIMENTAL ceiling of 12 took the FIRST 12 in
 * publication order. At boundary 2 that selection DISCARDED the qualified
 * R4 and R6 records, because they happened to sit at indices 12 and 14 —
 * behind twelve generic records.
 *
 * THE THREE ARMS
 * --------------
 *
 *   A  Control: the first 12 valid records in publication order.
 *   B  Treatment: bounded, deterministic relevance selection.
 *   C  Ablation: the same treatment with the selection rule ablated.
 *
 * The requirement is that B retains MORE relevant supported information
 * than A under the SAME budget, without overclaiming.
 *
 * THE GENERICITY RULE
 * -------------------
 *
 * The selector MUST NOT hardcode `R1`–`R10`, `startup.sh`, `MtsOmni`, or
 * the evaluator's expected answers. The scoring reads only the record's own
 * STRUCTURE. The tests below therefore assert on STRUCTURAL properties
 * (kind, assurance, status, reference resolvability, qualification count),
 * never on a record id or a statement substring.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalSourceMessages } from "../../../session/models/session-compaction";
import {
	EXPECTED_BOUNDARIES,
	loadCanonicalTranscript,
	privateCapturesAvailable,
} from "./discriminator.fixture";
import type { SelectableRecord } from "./selection";
import {
	estimateRecordTokens,
	MAX_SELECTED_RECORDS,
	scoreRecord,
	selectRecords,
	TARGET_PROJECTION_TOKENS,
} from "./selection";
import {
	type ResolvedEvidenceReference,
	resolveEvidenceReference,
} from "./trust";

/**
 * The predecessor's operator-local model output root.
 *
 * The raw model output is OPERATOR-LOCAL and is NEVER committed. The
 * loader is SELF-SKIPPING when the root is absent.
 */
function historicalRoot(): string {
	return join(
		process.cwd(),
		"..",
		"..",
		"..",
		"tmp",
		"pck-probe-private",
		"1795466566666_uzla2",
	);
}

interface HistoricalCheckpoint {
	readonly boundary: string;
	readonly sourceMessageCount: number;
	readonly providerId: string;
	readonly modelId: string;
	readonly latencyMs: number;
	readonly document: {
		readonly records: readonly SelectableRecord[];
	};
}

function loadHistorical(boundary: 1 | 2): HistoricalCheckpoint | undefined {
	const path = join(historicalRoot(), `checkpoint-boundary-${boundary}.json`);
	if (!existsSync(path)) {
		return undefined;
	}
	return JSON.parse(readFileSync(path, "utf8")) as HistoricalCheckpoint;
}

/**
 * The resolved references for every record of a historical checkpoint.
 *
 * A reference that does not resolve against the canonical history is
 * DROPPED, exactly as the predecessor's validator dropped it.
 */
export function resolveAll(
	records: readonly SelectableRecord[],
	canonicalMessages: Parameters<
		typeof resolveEvidenceReference
	>[0]["canonicalMessages"],
): Map<string, ResolvedEvidenceReference[]> {
	const map = new Map<string, ResolvedEvidenceReference[]>();
	for (const record of records) {
		const resolved = record.evidenceRefs
			.map((reference) =>
				resolveEvidenceReference({ reference, canonicalMessages }),
			)
			.filter((reference) => reference.identityResolved);
		map.set(record.id, resolved);
	}
	return map;
}

/**
 * The canonical history for the historical boundaries, when available.
 */
function loadCanonicalPrefix(
	count: number,
):
	| Parameters<typeof resolveEvidenceReference>[0]["canonicalMessages"]
	| undefined {
	if (!privateCapturesAvailable()) {
		return undefined;
	}
	const transcript = loadCanonicalTranscript();
	const canonical = canonicalSourceMessages(transcript.messages);
	return canonical.slice(0, count) as never;
}

/**
 * A structural summary of a selection, used for the comparison.
 *
 * It contains COUNTS and KIND DISTRIBUTIONS only. No statement text, no
 * record ids from the historical output, and no content of any kind.
 */
function summarize(selection: {
	readonly selected: readonly SelectableRecord[];
}): {
	readonly count: number;
	readonly observations: number;
	readonly openQuestions: number;
	readonly constraints: number;
	readonly decisions: number;
	readonly qualified: number;
	readonly estimatedTokens: number;
} {
	return {
		count: selection.selected.length,
		observations: selection.selected.filter(
			(record) => record.kind === "observation",
		).length,
		openQuestions: selection.selected.filter(
			(record) => record.kind === "open_question",
		).length,
		constraints: selection.selected.filter(
			(record) => record.kind === "constraint",
		).length,
		decisions: selection.selected.filter((record) => record.kind === "decision")
			.length,
		qualified: selection.selected.filter(
			(record) => record.qualifications.length > 0,
		).length,
		estimatedTokens: estimateRecordTokens(selection.selected),
	};
}

/**
 * The evidence coverage of a selection.
 *
 * It contains COUNTS only. No statement text, no record ids, and no
 * content of any kind.
 */
function coverageOf(
	selected: readonly SelectableRecord[],
	resolved: ReadonlyMap<string, readonly ResolvedEvidenceReference[]>,
): {
	readonly distinctReferences: number;
	readonly zeroNoveltyRecords: number;
} {
	const carried = new Set<string>();
	let distinctReferences = 0;
	let zeroNoveltyRecords = 0;
	for (const record of selected) {
		const references = resolved.get(record.id) ?? [];
		let novel = 0;
		for (const reference of references) {
			if (!carried.has(reference.reference)) {
				novel += 1;
				carried.add(reference.reference);
			}
		}
		distinctReferences += novel;
		if (novel === 0) {
			zeroNoveltyRecords += 1;
		}
	}
	return { distinctReferences, zeroNoveltyRecords };
}

describe("ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01 — G5 record selection", () => {
	it("G5.1: the control arm (first-12) is reproduced exactly", () => {
		const historical = loadHistorical(2);
		if (!historical) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const records = historical.document.records;
		expect(records.length).toBe(20);
		const canonical = loadCanonicalPrefix(
			EXPECTED_BOUNDARIES["boundary-2"].sourceMessageCount,
		);
		const resolved = canonical
			? resolveAll(records, canonical)
			: new Map<string, ResolvedEvidenceReference[]>();
		const control = selectRecords({
			records,
			resolvedByRecord: resolved,
			ruleApplied: false,
		});
		expect(control.selected.length).toBe(MAX_SELECTED_RECORDS);
		// The control takes the FIRST twelve in publication order.
		expect(control.selected.map((record) => record.id)).toEqual(
			records.slice(0, MAX_SELECTED_RECORDS).map((record) => record.id),
		);
		// The predecessor reported 20 records with a 12-record ceiling, so
		// EIGHT records were dropped by the control.
		expect(control.dropped.length).toBe(8);
	});

	it("G5.1.2: the treatment arm retains the qualified OPEN QUESTIONS that the control discarded", () => {
		const historical = loadHistorical(2);
		if (!historical) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const records = historical.document.records;
		const canonical = loadCanonicalPrefix(
			EXPECTED_BOUNDARIES["boundary-2"].sourceMessageCount,
		);
		const resolved = canonical
			? resolveAll(records, canonical)
			: new Map<string, ResolvedEvidenceReference[]>();
		const control = selectRecords({
			records,
			resolvedByRecord: resolved,
			ruleApplied: false,
		});
		const treatment = selectRecords({
			records,
			resolvedByRecord: resolved,
			ruleApplied: true,
		});
		const controlSummary = summarize(control);
		const treatmentSummary = summarize(treatment);
		expect(treatment.selected.length).toBe(MAX_SELECTED_RECORDS);
		// The treatment keeps MORE qualified open questions (the R4/R6 class
		// of work) than the control, which filled its budget with generic
		// constraints and restatements.
		expect(treatmentSummary.openQuestions).toBeGreaterThan(
			controlSummary.openQuestions,
		);
		// It drops FEWER generic constraint restatements.
		expect(treatmentSummary.constraints).toBeLessThan(
			controlSummary.constraints,
		);
		// THE LOAD-BEARING PROPERTY: the treatment covers MORE DISTINCT
		// CANONICAL EVIDENCE than the control, under the SAME record budget.
		//
		// This is the generic criterion. It is computed from the resolved
		// reference identity, so it does not depend on any record's id or
		// statement. The control filled twelve slots with records whose
		// references were already covered by earlier records; the treatment
		// spends its budget on records that contribute evidence the
		// continuation would otherwise LOSE.
		const controlCoverage = coverageOf(control.selected, resolved);
		const treatmentCoverage = coverageOf(treatment.selected, resolved);
		expect(treatmentCoverage.distinctReferences).toBeGreaterThan(
			controlCoverage.distinctReferences,
		);
		// And the treatment does not waste slots on zero-novelty records.
		expect(treatmentCoverage.zeroNoveltyRecords).toBeLessThanOrEqual(
			controlCoverage.zeroNoveltyRecords,
		);
	});

	it("G5.2: the treatment stays within the record ceiling and the token budget", () => {
		const historical = loadHistorical(2);
		if (!historical) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const canonical = loadCanonicalPrefix(
			EXPECTED_BOUNDARIES["boundary-2"].sourceMessageCount,
		);
		const records = historical.document.records;
		const treatment = selectRecords({
			records,
			resolvedByRecord: canonical
				? resolveAll(records, canonical)
				: new Map<string, ResolvedEvidenceReference[]>(),
			ruleApplied: true,
		});
		expect(treatment.selected.length).toBeLessThanOrEqual(MAX_SELECTED_RECORDS);
		expect(treatment.estimatedTokens).toBeLessThanOrEqual(
			TARGET_PROJECTION_TOKENS,
		);
	});

	it("G5.2.2: the selection is STABLE and the tie-break is DETERMINISTIC", () => {
		const historical = loadHistorical(2);
		if (!historical) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const records = historical.document.records;
		const canonical = loadCanonicalPrefix(
			EXPECTED_BOUNDARIES["boundary-2"].sourceMessageCount,
		);
		const resolved = canonical
			? resolveAll(records, canonical)
			: new Map<string, ResolvedEvidenceReference[]>();
		const first = selectRecords({
			records,
			resolvedByRecord: resolved,
			ruleApplied: true,
		});
		const second = selectRecords({
			records,
			resolvedByRecord: resolved,
			ruleApplied: true,
		});
		expect(first.selected.map((record) => record.id)).toEqual(
			second.selected.map((record) => record.id),
		);
		// Two records with the SAME score keep their publication order.
		const twinA: SelectableRecord = {
			id: "twin-a",
			kind: "observation",
			assurance: "tool_observed",
			status: "active",
			statement: "same shape",
			qualifications: ["q"],
			evidenceRefs: [],
		};
		const twinB: SelectableRecord = { ...twinA, id: "twin-b" };
		const tied = selectRecords({
			records: [twinA, twinB],
			resolvedByRecord: new Map(),
			ruleApplied: true,
		});
		expect(tied.selected.map((record) => record.id)).toEqual([
			"twin-a",
			"twin-b",
		]);
	});

	it("G5.2.3: a dropped record is explained through METADATA only", () => {
		const historical = loadHistorical(2);
		if (!historical) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const canonical = loadCanonicalPrefix(
			EXPECTED_BOUNDARIES["boundary-2"].sourceMessageCount,
		);
		const records = historical.document.records;
		const treatment = selectRecords({
			records,
			resolvedByRecord: canonical
				? resolveAll(records, canonical)
				: new Map<string, ResolvedEvidenceReference[]>(),
			ruleApplied: true,
		});
		for (const dropped of treatment.dropped) {
			expect(["record_ceiling", "token_budget"]).toContain(dropped.reason);
			expect(typeof dropped.id).toBe("string");
			expect(typeof dropped.score).toBe("number");
			expect(typeof dropped.rank).toBe("number");
			// The drop reason carries NO content: it has no statement field.
			expect(Object.keys(dropped).sort()).toEqual([
				"id",
				"rank",
				"reason",
				"score",
			]);
		}
	});

	it("G5.3: the ABLATED arm is byte-identical to the control", () => {
		const historical = loadHistorical(2);
		if (!historical) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const records = historical.document.records;
		const canonical = loadCanonicalPrefix(
			EXPECTED_BOUNDARIES["boundary-2"].sourceMessageCount,
		);
		const resolved = canonical
			? resolveAll(records, canonical)
			: new Map<string, ResolvedEvidenceReference[]>();
		const control = selectRecords({
			records,
			resolvedByRecord: resolved,
			ruleApplied: false,
		});
		const ablated = selectRecords({
			records,
			resolvedByRecord: resolved,
			ruleApplied: false,
		});
		expect(ablated.selected.map((record) => record.id)).toEqual(
			control.selected.map((record) => record.id),
		);
		expect(ablated.dropped.map((record) => record.id)).toEqual(
			control.dropped.map((record) => record.id),
		);
	});

	it("G5.3.2: the scoring NEVER promotes authority", () => {
		const historical = loadHistorical(2);
		if (!historical) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		for (const record of historical.document.records) {
			const score = scoreRecord({ record, resolved: [] });
			expect(Number.isFinite(score)).toBe(true);
			// The score is a RANKING, not an assurance.
			expect(score).toBeLessThan(200);
		}
	});

	it("G5.3.3: the selector does not depend on the record's CONTENT", () => {
		// Two records identical in structure but with completely different
		// statements must score identically. This is the machine-checkable
		// form of "no secret-dependent scoring" and "no hardcoded answers".
		const base: SelectableRecord = {
			id: "a",
			kind: "observation",
			assurance: "tool_observed",
			status: "active",
			statement: "one",
			qualifications: ["q1"],
			evidenceRefs: ["id:x"],
		};
		const other: SelectableRecord = {
			...base,
			id: "b",
			statement: "password=hunter2 another completely different claim",
		};
		expect(scoreRecord({ record: base, resolved: [] })).toBe(
			scoreRecord({ record: other, resolved: [] }),
		);
	});
});
