/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01
 *
 * P0-1 — the RED witness for FALSE OBSERVATION ASSURANCE.
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * The predecessor implementation derived the `tool_observed` assurance from
 * REFERENCE MEMBERSHIP alone:
 *
 *   if (observed.some((reference) => toolCallIds.has(reference))) {
 *       return "tool_observed";
 *   }
 *
 * That established only that a canonical tool CALL EXISTED. It did NOT
 * establish that the call's RESULT SUPPORTS the selected observation atom.
 *
 * The concrete counterexample this witness encodes:
 *
 *   the canonical history contains  `run_commands` -> `echo hello`
 *   the model selects              SEARCH_RETURNED_NO_MATCH
 *   the predecessor published      assurance=tool_observed
 *                                   statement="bounded search returned no match"
 *
 * "bounded search returned no match" is NOT entailed by "echo hello". A
 * reader of the published checkpoint would reasonably believe the runtime
 * observed a search. That is a FALSE OBSERVATION.
 *
 * The runtime-owned wording does not imply runtime-established truth: the
 * closed vocabulary addresses arbitrary-text publication, not false
 * attribution of knowledge.
 *
 * ============================================================================
 * THE EXPECTED OUTCOME
 * ============================================================================
 *
 * Against the CORRECTED implementation this suite PASSES: the assurance is
 * DOWNGRADED to `model_reported` because no cited event supports the atom.
 *
 * Against the PREDECESSOR implementation this suite FAILS, and the failure
 * IS the RED that established the finding. It is recorded here so the
 * discriminator is permanent and re-runnable, not just a historical note.
 *
 * It is ISOLATED: it has its own vitest config, so it never enters the
 * default suite.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	collectCanonicalToolEvents,
	interpretCanonicalEvidence,
	OBSERVATION_ATOM_REQUIRED_CLASS,
} from "./evidence";
import { gateClosedProposals } from "./publication-gate";

/**
 * The canonical history whose ONLY tool event is `echo hello`.
 *
 * This is the EXACT counterexample the review identified.
 */
const ECHO_ONLY_HISTORY = [
	{
		role: "assistant",
		id: "msg_call",
		content: [
			{
				type: "tool_use",
				id: "tool_call_r4",
				name: "run_commands",
				input: { command: "echo hello" },
			},
		],
	},
	{
		role: "user",
		id: "msg_result",
		content: [
			{
				type: "tool_result",
				tool_use_id: "tool_call_r4",
				content: [
					{
						query: "echo hello",
						result: "hello",
						success: true,
					},
				],
			},
		],
	},
] as never as MessageWithMetadata[];

describe("ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01 — P0-1 RED", () => {
	it("P0-1.1: `echo hello` does NOT support a SEARCH_RETURNED_NO_MATCH claim", () => {
		const ceiling = interpretCanonicalEvidence({
			canonicalMessages: ECHO_ONLY_HISTORY,
			references: ["tool_call_r4"],
			atom: "SEARCH_RETURNED_NO_MATCH",
		});
		// The predecessor returned "tool_observed" here.
		expect(ceiling).toBe("model_reported");
	});

	it("P0-1.2: the PUBLISHED record carries the downgraded assurance", () => {
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "SEARCH_RETURNED_NO_MATCH",
					evidenceRefs: ["tool_call_r4"],
				},
			],
			evidence: {
				canonicalReferences: ["tool_call_r4"],
				maximumAssuranceFor: (references, atom) =>
					interpretCanonicalEvidence({
						canonicalMessages: ECHO_ONLY_HISTORY,
						references,
						atom,
					}),
			},
			sourcePrefixKey: "prefix-1",
		});
		expect(gate.records.length).toBe(1);
		// The record SURVIVES — the working knowledge is preserved — but
		// its assurance is TRUTHFUL.
		expect(gate.records[0].assurance).toBe("model_reported");
		expect(gate.records[0].statement).toBe("bounded search returned no match");
	});

	it("P0-1.3: the tool event ledger records the CLASS, not just the id", () => {
		const events = collectCanonicalToolEvents(ECHO_ONLY_HISTORY);
		expect(events.length).toBe(1);
		expect(events[0].toolCallId).toBe("tool_call_r4");
		expect(events[0].succeeded).toBe(true);
		// The event is a COMMAND EXECUTION, which is not the class the
		// search atom requires.
		expect(events[0].evidenceClass).toBe("command_execution");
		expect(OBSERVATION_ATOM_REQUIRED_CLASS.SEARCH_RETURNED_NO_MATCH).toBe(
			"search",
		);
	});

	it("P0-1.4: EVERY atom's required class is a RUNTIME-OWNED member", () => {
		// The table is CLOSED: no atom requires a class outside the
		// runtime-owned vocabulary.
		const classes = new Set([
			"command_execution",
			"source_read",
			"search",
		] as const);
		for (const required of Object.values(
			OBSERVATION_ATOM_REQUIRED_CLASS,
		)) {
			if (required !== undefined) {
				expect(classes.has(required)).toBe(true);
			}
		}
		// QUESTION_REMAINS_OPEN names NO class, so it can never be
		// established as a tool observation.
		expect(OBSERVATION_ATOM_REQUIRED_CLASS.QUESTION_REMAINS_OPEN).toBe(
			undefined,
		);
	});

	it("P0-1.5: a MATCHING successful event DOES reach tool_observed", () => {
		// The correction must not simply DISABLE the feature. A search
		// tool that affirmatively succeeded DOES support the
		// SEARCH_RETURNED_NO_MATCH atom.
		const matching = [
			{
				role: "assistant",
				id: "msg_call",
				content: [
					{
						type: "tool_use",
						id: "tool_call_search",
						name: "search_files",
						input: { pattern: "token_cleanup" },
					},
				],
			},
			{
				role: "user",
				id: "msg_result",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_call_search",
						content: [
							{
								query: "token_cleanup",
								result: "no matches in the searched scope",
								success: true,
							},
						],
					},
				],
			},
		] as never as MessageWithMetadata[];
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: matching,
				references: ["tool_call_search"],
				atom: "SEARCH_RETURNED_NO_MATCH",
			}),
		).toBe("tool_observed");
	});

	it("P0-1.6: a FAILED search does NOT reach tool_observed", () => {
		// The success signal is AFFIRMATIVE. A failed search establishes
		// nothing about a bounded absence.
		const failed = [
			{
				role: "assistant",
				id: "msg_call",
				content: [
					{
						type: "tool_use",
						id: "tool_call_failed_search",
						name: "search_files",
						input: { pattern: "token_cleanup" },
					},
				],
			},
			{
				role: "user",
				id: "msg_result",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_call_failed_search",
						content: [
							{
								query: "token_cleanup",
								result: "search failed",
								success: false,
							},
						],
					},
				],
			},
		] as never as MessageWithMetadata[];
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: failed,
				references: ["tool_call_failed_search"],
				atom: "SEARCH_RETURNED_NO_MATCH",
			}),
		).toBe("model_reported");
	});

	it("P0-1.7: an UNANSWERED call establishes nothing", () => {
		// A call with no result cannot support any atom.
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: ECHO_ONLY_HISTORY.slice(0, 1),
				references: ["tool_call_r4"],
				atom: "OPERATION_INVOKED",
			}),
		).toBe("model_reported");
	});
});
