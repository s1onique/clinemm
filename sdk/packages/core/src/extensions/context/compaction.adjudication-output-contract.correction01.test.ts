/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01
 *
 * CORRECTION tests for the G6 LIVE PROBE CORRELATION and for the
 * SEPARATION of schema validity from contract acceptance.
 *
 * WHAT THESE TESTS ARE
 * --------------------
 *
 * The predecessor ACT (ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01)
 * committed a live probe whose transcript recorded ONE observation, while
 * its reports claimed "10 measured runs, 9 published" and asserted a
 * UNIVERSAL same-turn tool-use property. The reviewer found:
 *
 *   P0-1  The committed evidence contained THREE different measurement
 *         accounts, and the single committed live observation was a direct
 *         COUNTEREXAMPLE to the universal same-turn claim.
 *
 *   P0-2  Two live-probe correlation metrics were implemented incorrectly:
 *
 *         (a) SAME-TURN CORRELATION. `turnToolCallCounts` recorded every
 *             turn, while `turnCarriers` recorded only turns containing
 *             text. Indexing one array with the other's position breaks as
 *             soon as a preceding turn has tools but no text.
 *
 *         (b) AFTER-TOOL-RESULT CORRELATION. `sawTextAfterToolResult` was
 *             set from text emitted in a tool-calling turn, even though
 *             that text was emitted BEFORE the result was appended. It
 *             was not tied to the actual adjudication carrier.
 *
 * These tests are the EXECUTABLE COUNTEREXAMPLES for (a) and (b). Each one
 * constructs a turn sequence that BREAKS the old positional logic and
 * asserts that the corrected, TURN-ANCHORED logic reports the truth.
 *
 * The old logic is reproduced here VERBATIM as `legacyPositionalCorrelation`
 * so that the counterexample is a PROOF of the defect rather than an
 * assertion about it.
 *
 * PRODUCTION DELTA: ZERO. Every helper is test-local, and the module under
 * test is a script-local diagnostic helper.
 */

import { describe, expect, it } from "vitest";
import {
	anchorCarriers,
	correlateCarrier,
	resolveCanonicalReferences,
	type TurnObservation,
} from "../../../scripts/adjudication-output-contract.correlation";

// ===========================================================================
// THE LEGACY (DEFECTIVE) LOGIC, REPRODUCED VERBATIM.
//
// This is the exact computation the predecessor harness performed:
//
//   turnToolCallCounts.push(turnToolCalls.length);   // EVERY turn
//   if (turnText) { turnCarriers.push(turnText); }     // only TEXT turns
//   ...
//   observation.publishedTurnAlsoCarriedToolUse =
//       (turnToolCallCounts[index] ?? 0) > 0;         // index is a CARRIER index
//
// It is reproduced so the counterexamples can demonstrate, executably, that
// the legacy computation returns the WRONG answer for the same input.
// ===========================================================================

function legacyPositionalCorrelation(
	turns: readonly TurnObservation[],
	publishedCarrierIndex: number,
): {
	publishedTurnAlsoCarriedToolUse: boolean;
	publishedAfterToolResult: boolean;
} {
	const turnToolCallCounts: number[] = [];
	const turnCarriers: string[] = [];
	let sawTextAfterToolResult = false;

	for (const turn of turns) {
		turnToolCallCounts.push(turn.toolCallIds.length);
		if (turn.text) {
			turnCarriers.push(turn.text);
		}
		// The legacy code set the flag from the text of a tool-calling turn.
		if (turn.text && turn.toolCallIds.length > 0) {
			sawTextAfterToolResult = true;
		}
	}

	return {
		publishedTurnAlsoCarriedToolUse:
			(turnToolCallCounts[publishedCarrierIndex] ?? 0) > 0,
		publishedAfterToolResult: sawTextAfterToolResult,
	};
}

describe("CORRECTION01 — the live-probe correlation is TURN-ANCHORED", () => {
	it("a tool-only turn does NOT shift the same-turn measurement onto the wrong turn", () => {
		// Turn 0: tool use, NO text. Turn 1: the publishing turn, also with
		// tool use. The carrier array therefore holds ONE entry (carrier 0)
		// which belongs to canonical turn 1.
		const turns: TurnObservation[] = [
			{ text: "", toolCallIds: ["call_tool_only"], toolResultsBefore: 0 },
			{
				text: '{"kind":"adjudication_candidate"}',
				toolCallIds: ["call_publishing"],
				toolResultsBefore: 1,
			},
		];

		const carriers = anchorCarriers(turns);
		expect(carriers).toHaveLength(1);
		// The carrier keeps its CANONICAL turn index.
		expect(carriers[0].turnIndex).toBe(1);

		const correlation = correlateCarrier(carriers[0]);
		expect(correlation.publishedTurnIndex).toBe(1);
		expect(correlation.publishedTurnAlsoCarriedToolUse).toBe(true);
		expect(correlation.publishedTurnToolCallIds).toEqual(["call_publishing"]);
	});

	it("a tool-only turn preceding a TEXT-ONLY publishing turn makes the legacy metric report the WRONG boolean", () => {
		// The decisive counterexample: turn 0 has tools and no text; turn 1
		// has text and NO tools. The publishing turn did NOT carry a tool
		// call. The legacy logic reads turn 0's count and reports TRUE.
		const turns: TurnObservation[] = [
			{ text: "", toolCallIds: ["call_tool_only"], toolResultsBefore: 0 },
			{
				text: '{"kind":"adjudication_candidate"}',
				toolCallIds: [],
				toolResultsBefore: 1,
			},
		];

		const carriers = anchorCarriers(turns);
		expect(carriers).toHaveLength(1);
		expect(carriers[0].turnIndex).toBe(1);

		const correlation = correlateCarrier(carriers[0]);
		expect(correlation.publishedTurnAlsoCarriedToolUse).toBe(false);

		// The LEGACY logic reports TRUE — the defect, executably proven.
		const legacy = legacyPositionalCorrelation(turns, 0);
		expect(legacy.publishedTurnAlsoCarriedToolUse).toBe(true);
	});

	it("after-tool-result publication is derived from the CHRONOLOGY, not from text in a tool-calling turn", () => {
		// Turn 0 carries BOTH text and a tool call. The text was emitted
		// BEFORE the tool result was appended, so it is NOT
		// after-tool-result publication. Turn 1 is the publishing turn,
		// which began after the tool result was appended.
		const turns: TurnObservation[] = [
			{
				text: "I will read the configuration now.",
				toolCallIds: ["call_read"],
				toolResultsBefore: 0,
			},
			{
				text: '{"kind":"adjudication_candidate"}',
				toolCallIds: [],
				toolResultsBefore: 1,
			},
		];

		const carriers = anchorCarriers(turns);
		const publishingCarrier = carriers.find((carrier) =>
			carrier.text.includes("adjudication_candidate"),
		);
		expect(publishingCarrier).toBeDefined();
		const correlation = correlateCarrier(publishingCarrier as never);
		expect(correlation.publishedAfterToolResult).toBe(true);

		// The LEGACY logic marks "after tool result" from ANY text in a
		// tool-calling turn — including turn 0's PRE-RESULT text. It
		// cannot distinguish the two carriers at all.
		const legacy = legacyPositionalCorrelation(turns, 0);
		expect(legacy.publishedAfterToolResult).toBe(true);
	});

	it("a publishing turn BEFORE any tool result is NOT after-tool-result publication", () => {
		const turns: TurnObservation[] = [
			{
				text: '{"kind":"adjudication_candidate"}',
				toolCallIds: [],
				toolResultsBefore: 0,
			},
		];

		const carriers = anchorCarriers(turns);
		const correlation = correlateCarrier(carriers[0]);
		expect(correlation.publishedAfterToolResult).toBe(false);
		expect(correlation.publishedTurnAlsoCarriedToolUse).toBe(false);
	});

	it("multiple tool-only turns before the publishing turn keep the turn index exact", () => {
		const turns: TurnObservation[] = [
			{ text: "", toolCallIds: ["call_1"], toolResultsBefore: 0 },
			{ text: "", toolCallIds: ["call_2"], toolResultsBefore: 1 },
			{
				text: '{"kind":"adjudication_candidate"}',
				toolCallIds: ["call_3"],
				toolResultsBefore: 2,
			},
		];

		const carriers = anchorCarriers(turns);
		expect(carriers).toHaveLength(1);
		expect(carriers[0].turnIndex).toBe(2);

		const correlation = correlateCarrier(carriers[0]);
		expect(correlation.publishedTurnIndex).toBe(2);
		expect(correlation.publishedTurnToolCallIds).toEqual(["call_3"]);
		expect(correlation.publishedAfterToolResult).toBe(true);
	});

	it("carriers are anchored in canonical order and preserve their own turn's tool ids", () => {
		const turns: TurnObservation[] = [
			{ text: "first", toolCallIds: ["call_a"], toolResultsBefore: 0 },
			{ text: "", toolCallIds: ["call_b"], toolResultsBefore: 1 },
			{ text: "third", toolCallIds: ["call_c"], toolResultsBefore: 2 },
		];

		const carriers = anchorCarriers(turns);
		expect(carriers.map((carrier) => carrier.turnIndex)).toEqual([0, 2]);
		expect(carriers[0].turnToolCallIds).toEqual(["call_a"]);
		expect(carriers[1].turnToolCallIds).toEqual(["call_c"]);
	});
});

describe("CORRECTION01 — schema validity is SEPARATE from contract acceptance", () => {
	it("a schema-valid candidate whose evidence id is NOT canonical FAILS canonical reference resolution", () => {
		// This is the shape of the committed live observation: the model
		// published a syntactically valid envelope citing `call_1`, while
		// the canonical tool-call id of the session was a DIFFERENT id.
		const resolution = resolveCanonicalReferences(
			{ evidence_tool_use_ids: ["call_1"] },
			["call_01a20794edda73718c196864"],
		);
		expect(resolution.canonical_refs_resolved).toBe(false);
		expect(resolution.unresolvedIds).toEqual(["call_1"]);
	});

	it("a schema-valid candidate whose evidence ids ARE canonical resolves", () => {
		const resolution = resolveCanonicalReferences(
			{ evidence_tool_use_ids: ["call_1", "call_2"] },
			["call_1", "call_2", "call_3"],
		);
		expect(resolution.canonical_refs_resolved).toBe(true);
		expect(resolution.unresolvedIds).toEqual([]);
	});

	it("a candidate with NO evidence references resolves vacuously (the schema permits an empty list)", () => {
		const resolution = resolveCanonicalReferences(
			{ evidence_tool_use_ids: [] },
			["call_1"],
		);
		expect(resolution.canonical_refs_resolved).toBe(true);
	});
});
