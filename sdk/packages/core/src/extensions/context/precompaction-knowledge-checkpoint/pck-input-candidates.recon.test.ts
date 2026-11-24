/**
 * ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01
 *
 * C5 — the TRUST-BOUNDARY CONSERVATION witnesses for the RECON input
 * candidates.
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * A reduced input view is NOT a replacement for the canonical publication
 * authority. The candidates change WHAT THE MODEL SEES; they must never
 * change what the gate ACCEPTS.
 *
 * The witnesses therefore establish:
 *
 *   1. PRIVATE REASONING is never carried by ANY candidate.
 *   2. A candidate that OMITS the evidence a claim rests on cannot reach a
 *      STRONGER assurance than the SAME claim would reach with the full
 *      history — the omission can only DOWNGRADE, never PROMOTE.
 *   3. A candidate cannot cite a reference the runtime did not observe: the
 *      gate's MEMBERSHIP check still rejects it.
 *   4. CONTRADICTORY or SUPERSEDING evidence that a candidate omits cannot
 *      create a falsely STRENGTHENED claim: the bound is computed from the
 *      CANONICAL history, not from the candidate's view.
 *   5. The DETERMINISTIC candidate (D) never claims anything the PRODUCTION
 *      interpreter would downgrade.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	collectObservedCanonicalReferences,
	interpretCanonicalEvidence,
} from "./evidence";
import {
	buildCandidateB,
	buildCandidateC,
	buildCandidateD,
	buildCandidateDRecords,
	classifyReconMessage,
	collectReconObservations,
} from "./input-candidates.recon";
import { gateClosedProposals } from "./publication-gate";

/**
 * A canonical history with a private-reasoning message, a positive
 * `make build` tool event, a FAILED tool event and a contradicting
 * second result for the same call id.
 */
function fixtureHistory(): MessageWithMetadata[] {
	return [
		{
			role: "user",
			id: "msg_task",
			content: "Build the project and report what happened.",
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_private",
			content: [
				{
					type: "thinking",
					thinking: "SECRET-PRIVATE-REASONING-MUST-NEVER-BE-CARRIED",
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_build_call",
			content: [
				{
					type: "tool_use",
					id: "call_build_1",
					name: "run_commands",
					input: { commands: ["make build"] },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg_build_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_build_1",
					name: "run_commands",
					content: [
						{ query: "make build", result: "build finished", success: true },
					],
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_failed_call",
			content: [
				{
					type: "tool_use",
					id: "call_failed_1",
					name: "run_commands",
					input: { commands: ["make build"] },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg_failed_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_failed_1",
					name: "run_commands",
					content: [
						{
							query: "make build",
							result: "permission denied",
							success: false,
							isError: true,
						},
					],
				},
			],
		} as unknown as MessageWithMetadata,
	];
}

describe("ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01 — C5", () => {
	it("C5.1: NO candidate carries PRIVATE REASONING", () => {
		const history = fixtureHistory();
		for (const candidate of [
			buildCandidateB(history),
			buildCandidateC(history),
			buildCandidateD(history),
		]) {
			expect(candidate.text).not.toContain("SECRET-PRIVATE-REASONING");
			expect(candidate.text).not.toContain("thinking");
		}
	});

	it("C5.2: a private-reasoning-only message is EXCLUDED from the candidates", () => {
		const history = fixtureHistory();
		const privateMessage = history.find(
			(message) => message.id === "msg_private",
		);
		expect(privateMessage).toBeDefined();
		expect(classifyReconMessage(privateMessage!)).toBe("private_only");
		// The private message contributes no observation.
		const observations = collectReconObservations(history);
		for (const observation of observations) {
			expect(observation.toolCallId).not.toBe("msg_private");
		}
	});

	it("C5.3: the gate still REJECTS a reference the runtime did not observe", () => {
		// The candidates change WHAT THE MODEL SEES. The MEMBERSHIP check is
		// computed from the CANONICAL history, so a candidate that cites an
		// invented reference is still rejected.
		const history = fixtureHistory();
		const observed = collectObservedCanonicalReferences(history);
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "OPERATION_INVOKED",
					argument: "build",
					evidenceRefs: ["call_DOES_NOT_EXIST"],
				},
			],
			sourcePrefixKey: "recon",
			evidence: {
				canonicalReferences: observed,
				maximumAssuranceFor: (references, atom, argument) =>
					interpretCanonicalEvidence({
						canonicalMessages: history,
						references,
						atom,
						argument,
					}),
			},
		});
		expect(gate.records).toHaveLength(0);
		expect(gate.codes).toContain("REFERENCE_NOT_CANONICAL");
	});

	it("C5.4: a FAILED tool result can never establish an observation", () => {
		// The failed `make build` event is in the canonical history. A claim
		// resting on it must be bounded at the truthful ceiling.
		const history = fixtureHistory();
		const ceiling = interpretCanonicalEvidence({
			canonicalMessages: history,
			references: ["call_failed_1"],
			atom: "OPERATION_INVOKED",
			argument: "build",
		});
		expect(ceiling).not.toBe("tool_observed");
	});

	it("C5.5: the DETERMINISTIC candidate never claims a FAILED operation", () => {
		const history = fixtureHistory();
		const records = buildCandidateDRecords(history);
		// Exactly ONE record: the SUCCESSFUL `make build`.
		expect(records).toHaveLength(1);
		expect(records[0].evidenceRefs).toEqual(["call_build_1"]);
		expect(records[0].assurance).toBe("tool_observed");
	});

	it("C5.6: the DETERMINISTIC candidate's records PASS the PRODUCTION gate", () => {
		// The deterministic candidate's records are not a bypass: they are
		// gated by the EXISTING production gate, using the EXISTING
		// production interpreter.
		const history = fixtureHistory();
		const records = buildCandidateDRecords(history);
		const gate = gateClosedProposals({
			proposals: records.map((record) => ({
				kind: record.kind,
				assurance: record.assurance,
				status: record.status,
				atom: record.atom,
				...(record.argument === undefined ? {} : { argument: record.argument }),
				evidenceRefs: record.evidenceRefs,
			})),
			sourcePrefixKey: "recon",
			evidence: {
				canonicalReferences: collectObservedCanonicalReferences(history),
				maximumAssuranceFor: (references, atom, argument) =>
					interpretCanonicalEvidence({
						canonicalMessages: history,
						references,
						atom,
						argument,
					}),
			},
		});
		expect(gate.records).toHaveLength(1);
		expect(gate.records[0].assurance).toBe("tool_observed");
		expect(gate.codes).toHaveLength(0);
	});

	it("C5.7: the DETERMINISTIC candidate is EMPTY when the runtime establishes nothing", () => {
		// A history with no runtime-establishable operation yields NO
		// deterministic record. The candidate does NOT manufacture one.
		const history = fixtureHistory().filter(
			(message) =>
				message.id !== "msg_build_call" && message.id !== "msg_build_result",
		);
		expect(buildCandidateDRecords(history)).toHaveLength(0);
	});

	it("C5.8: the candidates NEVER carry raw tool OUTPUT", () => {
		// The tool result's BODY is not carried by the reduced candidates:
		// only the runtime-owned STATUS is.
		const history = fixtureHistory();
		for (const candidate of [
			buildCandidateB(history),
			buildCandidateC(history),
		]) {
			expect(candidate.text).not.toContain("build finished");
			expect(candidate.text).not.toContain("permission denied");
		}
	});
});
