/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02
 *
 * P0-2 — the RED witness for SAME-CLASS FALSE OBSERVATION ASSURANCE.
 *
 * ============================================================================
 * THE DEFECT
 * ============================================================================
 *
 * CORRECTION01 replaced reference MEMBERSHIP with ATOM-SCOPED SUPPORT: a
 * cited event had to be unambiguously joined, AFFIRMATIVELY SUCCESSFUL and
 * of the TOOL CLASS the atom requires.
 *
 * That closed the CROSS-CLASS false attribution. It left the SAME-CLASS
 * false attribution OPEN, because a tool CLASS says what KIND of operation
 * ran, not whether its RESULT supports the claim:
 *
 *   successful search returning 42 matches   -> SEARCH_RETURNED_NO_MATCH
 *   successful `echo hello`                   -> OPERATION_INVOKED: build
 *   successful `echo hello`                   -> OPERATION_ARGUMENT_SET:
 *                                                start --optimized
 *   read configuration holding a 30s timeout -> CONFIGURATION_VALUE_SET:
 *                                                connect timeout 3 seconds
 *   successful directory listing             -> IMPLEMENTATION_INSPECTED
 *
 * In each case the runtime established three facts — the reference
 * RESOLVED, the execution SUCCEEDED, and the tool was of the RIGHT CLASS
 * — and NONE of them says anything about whether the observed result
 * SUPPORTS the rendered claim.
 *
 * The interpreter never even received the selected `argument`, so it could
 * not have compared the rendered argument with the observed operation even
 * in principle.
 *
 * ============================================================================
 * THE REQUIRED INVARIANT
 * ============================================================================
 *
 *   Evidence actually supports the COMPLETE RENDERED CLAIM
 *     -> `tool_observed`
 *   otherwise
 *     -> `model_reported`
 *
 * ============================================================================
 * THE CHEAPEST RED
 * ============================================================================
 *
 * The review specified the discriminator precisely: take the predecessor's
 * P0-1.5 and change ONLY its synthetic tool result.
 *
 *   - result: "no matches in the searched scope",
 *   + result: "42 matches found in the searched scope",
 *       success: true,
 *
 * The assertion expected `tool_observed`. Changed to require
 * `model_reported`.
 *
 * The expected failure follows directly from the predecessor's source: the
 * interpreter never reads the result text.
 *
 * ============================================================================
 * THE EXPECTED OUTCOME
 * ============================================================================
 *
 * Against the CORRECTED implementation this suite PASSES. Against the
 * CORRECTION01 implementation it FAILS, and that failure IS the RED that
 * established this finding.
 *
 * It is ISOLATED: it has its own vitest config, so it never enters the
 * default suite.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	DETERMINISTICALLY_ESTABLISHABLE_ATOMS,
	interpretCanonicalEvidence,
	RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS,
} from "./evidence";
import { gateClosedProposals } from "./publication-gate";

/**
 * Build a canonical history whose ONLY tool event is one command execution.
 */
function commandHistory(input: {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly callInput: unknown;
	readonly result: string;
	readonly success?: boolean;
}): readonly MessageWithMetadata[] {
	return [
		{
			role: "assistant",
			id: "msg_call",
			content: [
				{
					type: "tool_use",
					id: input.toolCallId,
					name: input.toolName,
					input: input.callInput,
				},
			],
		},
		{
			role: "user",
			id: "msg_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: input.toolCallId,
					content: [
						{
							query: "synthetic",
							result: input.result,
							success: input.success ?? true,
						},
					],
				},
			],
		},
	] as never as MessageWithMetadata[];
}

describe("ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02 — P0-2 RED", () => {
	it("P0-2.1: a successful search returning 42 MATCHES does NOT establish SEARCH_RETURNED_NO_MATCH", () => {
		// THE CHEAPEST RED, EXACTLY AS THE REVIEW SPECIFIED.
		//
		// Only the synthetic tool result differs from the predecessor's
		// P0-1.5: the search FOUND matches. The predecessor published
		// "bounded search returned no match" with `tool_observed`, which
		// is the same-class false observation.
		const history = commandHistory({
			toolCallId: "tool_call_search",
			toolName: "search_files",
			callInput: { pattern: "token_cleanup" },
			result: "42 matches found in the searched scope",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_search"],
				atom: "SEARCH_RETURNED_NO_MATCH",
			}),
		).toBe("model_reported");
	});

	it("P0-2.2: a successful search returning NO MATCHES does NOT establish SEARCH_RETURNED_NO_MATCH either", () => {
		// The atom is not deterministically establishable AT ALL: the
		// runtime has no rule that reads a search result and decides
		// whether it found nothing. So both results are bounded at
		// `model_reported` — the claim survives, its authority does not.
		const history = commandHistory({
			toolCallId: "tool_call_search",
			toolName: "search_files",
			callInput: { pattern: "token_cleanup" },
			result: "no matches in the searched scope",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_search"],
				atom: "SEARCH_RETURNED_NO_MATCH",
			}),
		).toBe("model_reported");
	});

	it("P0-2.3: a successful `echo hello` does NOT establish OPERATION_INVOKED: build", () => {
		const history = commandHistory({
			toolCallId: "tool_call_echo",
			toolName: "run_commands",
			callInput: { command: "echo hello" },
			result: "hello",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_echo"],
				atom: "OPERATION_INVOKED",
				argument: "build",
			}),
		).toBe("model_reported");
	});

	it("P0-2.4: a successful `echo hello` does NOT establish OPERATION_ARGUMENT_SET: start --optimized", () => {
		const history = commandHistory({
			toolCallId: "tool_call_echo",
			toolName: "run_commands",
			callInput: { command: "echo hello" },
			result: "hello",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_echo"],
				atom: "OPERATION_ARGUMENT_SET",
				argument: "start_optimized",
			}),
		).toBe("model_reported");
	});

	it("P0-2.5: reading a configuration holding a 30-second timeout does NOT establish connect timeout 3 seconds", () => {
		const history = commandHistory({
			toolCallId: "tool_call_read",
			toolName: "read_files",
			callInput: { path: "config/app.properties" },
			result: "socketTimeout=30\nconnectTimeout=30",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_read"],
				atom: "CONFIGURATION_VALUE_SET",
				argument: "connect_timeout_3s",
			}),
		).toBe("model_reported");
	});

	it("P0-2.6: a successful directory listing does NOT establish IMPLEMENTATION_INSPECTED", () => {
		const history = commandHistory({
			toolCallId: "tool_call_ls",
			toolName: "run_commands",
			callInput: { command: "ls -la src" },
			result: "total 8\ndrwxr-xr-x  src",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_ls"],
				atom: "IMPLEMENTATION_INSPECTED",
			}),
		).toBe("model_reported");
	});

	it("P0-2.7: the PUBLISHED record carries the downgraded assurance", () => {
		// The record SURVIVES — the working knowledge is preserved — but
		// its assurance is TRUTHFUL.
		const history = commandHistory({
			toolCallId: "tool_call_search",
			toolName: "search_files",
			callInput: { pattern: "token_cleanup" },
			result: "42 matches found in the searched scope",
		});
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "SEARCH_RETURNED_NO_MATCH",
					evidenceRefs: ["tool_call_search"],
				},
			],
			evidence: {
				canonicalReferences: ["tool_call_search"],
				maximumAssuranceFor: (references, atom, argument) =>
					interpretCanonicalEvidence({
						canonicalMessages: history,
						references,
						atom,
						argument,
					}),
			},
			sourcePrefixKey: "prefix-1",
		});
		expect(gate.records.length).toBe(1);
		expect(gate.records[0].assurance).toBe("model_reported");
		expect(gate.records[0].statement).toBe("bounded search returned no match");
	});

	it("P0-2.8: ONLY the operation atoms are deterministically establishable", () => {
		// The searchable-result, configuration-value, implementation and
		// open-question atoms have NO deterministic runtime-owned rule, so
		// they can never reach `tool_observed`.
		expect([...DETERMINISTICALLY_ESTABLISHABLE_ATOMS]).toEqual([
			"OPERATION_INVOKED",
			"OPERATION_ARGUMENT_SET",
		]);
	});

	it("P0-2.9: the runtime-argument evidence table is CLOSED and TOTAL", () => {
		// Every runtime argument has an entry, and an argument with an
		// EMPTY set has no deterministic evidence that establishes it.
		expect(
			Object.keys(RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS).sort(),
		).toEqual([
			"build",
			"connect_timeout_3s",
			"none",
			"socket_timeout_10s",
			"start",
			"start_optimized",
		]);
		for (const classifications of Object.values(
			RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS,
		)) {
			expect(Array.isArray(classifications)).toBe(true);
		}
		// The `start` / `start_optimized` / timeout arguments have NO
		// deterministic establishing classification, so a claim rendering
		// them is bounded at `model_reported`.
		expect(RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS.start).toEqual([]);
		expect(RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS.start_optimized).toEqual(
			[],
		);
		expect(
			RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS.connect_timeout_3s,
		).toEqual([]);
	});

	it("P0-2.10: a DETERMINISTICALLY ESTABLISHED operation DOES reach tool_observed", () => {
		// The correction must not simply DISABLE the feature. A command
		// execution whose OWN production classification establishes the
		// rendered argument DOES reach `tool_observed`.
		const history = commandHistory({
			toolCallId: "tool_call_make",
			toolName: "run_commands",
			callInput: { command: "make build" },
			result: "build succeeded",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_make"],
				atom: "OPERATION_ARGUMENT_SET",
				argument: "build",
			}),
		).toBe("tool_observed");
	});

	it("P0-2.11: a FAILED operation does NOT reach tool_observed", () => {
		// The success signal is AFFIRMATIVE. A failed `make build` does
		// not establish that a build happened.
		const history = commandHistory({
			toolCallId: "tool_call_make",
			toolName: "run_commands",
			callInput: { command: "make build" },
			result: "make: *** [build] Error 2",
			success: false,
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_make"],
				atom: "OPERATION_ARGUMENT_SET",
				argument: "build",
			}),
		).toBe("model_reported");
	});

	it("P0-2.12: an AMBIGUOUS command chain does NOT reach tool_observed", () => {
		// The production classifier is fail-closed: a chain whose
		// executed word is not decidable yields NO classification, so the
		// runtime establishes nothing.
		const history = commandHistory({
			toolCallId: "tool_call_ambiguous",
			toolName: "run_commands",
			callInput: { command: "make build; echo done" },
			result: "done",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_ambiguous"],
				atom: "OPERATION_ARGUMENT_SET",
				argument: "build",
			}),
		).toBe("model_reported");
	});

	it("P0-2.13: a DIFFERENT argument does NOT establish the selected one", () => {
		// `make build` establishes a BUILD. It does not establish a
		// `start --optimized`, which has no deterministic establishing
		// classification at all.
		const history = commandHistory({
			toolCallId: "tool_call_make",
			toolName: "run_commands",
			callInput: { command: "make build" },
			result: "build succeeded",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_make"],
				atom: "OPERATION_ARGUMENT_SET",
				argument: "start_optimized",
			}),
		).toBe("model_reported");
	});

	it("P0-2.14: OPERATION_ARGUMENT_SET without an argument establishes nothing", () => {
		// The rendered proposition is incomplete without the argument, so
		// the runtime cannot establish it.
		const history = commandHistory({
			toolCallId: "tool_call_make",
			toolName: "run_commands",
			callInput: { command: "make build" },
			result: "build succeeded",
		});
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: history,
				references: ["tool_call_make"],
				atom: "OPERATION_ARGUMENT_SET",
			}),
		).toBe("model_reported");
	});
});
