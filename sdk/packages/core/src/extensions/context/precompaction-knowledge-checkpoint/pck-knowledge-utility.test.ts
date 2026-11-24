/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
 *
 * G7.5 — the HISTORICAL KNOWLEDGE UTILITY qualification.
 *
 * ============================================================================
 * THE FIXTURE
 * ============================================================================
 *
 * The frozen Keycloak R2/R4/R6 evidence is used as a QUALIFICATION FIXTURE,
 * NOT as a source of hardcoded production rules. Nothing in the production
 * module mentions Keycloak, `kc.sh`, `R2`, `R4`, `R6` or any evaluator's
 * expected answer.
 *
 * The fixture asserts that the SIX-ATOM closed vocabulary can represent:
 *
 *   R4:  build operation
 *        optimized-start operation
 *        NO causal deployment claim
 *
 *   R2:  inspected configuration
 *        recorded timeout categories
 *        UNRESOLVED production-path question
 *
 *   R6:  bounded absence-of-match
 *        NO global absence claim
 *
 * It ALSO asserts the LIMIT honestly: the vocabulary is not complete for
 * arbitrary findings, and an observation it cannot express is OMITTED
 * rather than accommodated by widening the model's authority.
 *
 * It ALSO runs an UNRELATED synthetic TypeScript fixture, to prove the
 * contract is generic and not Keycloak-specific.
 */

import { describe, expect, it } from "vitest";
import {
	OBSERVATION_ATOMS,
	QUALIFICATION_CLASSES,
	RUNTIME_ARGUMENTS,
} from "./closed-vocabulary";
import { renderCheckpointSection } from "./projection";
import { gateClosedProposals } from "./publication-gate";

const KEYCLOOR_TOOL_CALLS = [
	"kc_build",
	"kc_start",
	"kc_start_optimized",
	"kc_config_read",
	"kc_search",
] as const;

function evidenceFor(references: readonly string[]) {
	return {
		canonicalReferences: references,
		maximumAssuranceFor: () => "tool_observed" as const,
	};
}

type RenderableRecord = Parameters<typeof renderCheckpointSection>[0];

function render(records: RenderableRecord) {
	return renderCheckpointSection(records) ?? "";
}

describe("ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01 — knowledge utility", () => {
	it("G7.5.1: R4 — both observed startup operations, with NO causal claim", () => {
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "OPERATION_INVOKED",
					argument: "build",
					qualificationClasses: ["OBSERVATION_ONLY_NO_CAUSATION"],
					evidenceRefs: ["kc_build"],
				},
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "OPERATION_INVOKED",
					argument: "start_optimized",
					qualificationClasses: ["OBSERVATION_ONLY_NO_CAUSATION"],
					evidenceRefs: ["kc_start_optimized"],
				},
			],
			evidence: evidenceFor(KEYCLOOR_TOOL_CALLS),
			sourcePrefixKey: "prefix-1",
		});
		expect(gate.records.length).toBe(2);
		const text = render(
			gate.records.map((record) => ({
				id: record.id,
				kind: record.kind,
				assurance: record.assurance,
				status: record.status,
				statement: record.statement,
				qualifications: record.qualifications,
				evidenceRefs: record.evidenceRefs,
			})),
		);
		// BOTH operations are retained.
		expect(text).toContain("operation invoked: build");
		expect(text).toContain("operation invoked: start --optimized");
		// The observation-only qualification is retained, so the record does
		// NOT become a causal deployment claim.
		expect(text).toContain("does not establish causation");
		expect(text).not.toContain("caused");
		expect(text).not.toContain("deployment was");
		expect(text).not.toContain("root cause");
	});

	it("G7.5.2: R2 — inspected configuration, recorded timeouts, UNRESOLVED path", () => {
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "IMPLEMENTATION_INSPECTED",
					qualificationClasses: ["EFFECTIVE_PATH_NOT_RECONCILED"],
					evidenceRefs: ["kc_config_read"],
				},
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "CONFIGURATION_VALUE_SET",
					argument: "connect_timeout_3s",
					evidenceRefs: ["kc_config_read"],
				},
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "CONFIGURATION_VALUE_SET",
					argument: "socket_timeout_10s",
					evidenceRefs: ["kc_config_read"],
				},
				{
					kind: "open_question",
					assurance: "model_reported",
					status: "unresolved",
					atom: "QUESTION_REMAINS_OPEN",
					qualificationClasses: [
						"EFFECTIVE_PATH_NOT_RECONCILED",
						"RUNTIME_TOGGLE_UNRESOLVED",
					],
					evidenceRefs: ["kc_config_read"],
				},
			],
			evidence: evidenceFor(KEYCLOOR_TOOL_CALLS),
			sourcePrefixKey: "prefix-1",
		});
		expect(gate.records.length).toBe(4);
		const text = render(
			gate.records.map((record) => ({
				id: record.id,
				kind: record.kind,
				assurance: record.assurance,
				status: record.status,
				statement: record.statement,
				qualifications: record.qualifications,
				evidenceRefs: record.evidenceRefs,
			})),
		);
		// The inspected implementation.
		expect(text).toContain("implementation inspected");
		// BOTH timeout categories.
		expect(text).toContain("connect timeout 3 seconds");
		expect(text).toContain("socket timeout 10 seconds");
		// The unresolved production-path question, with its qualifications.
		expect(text).toContain("question remains open");
		expect(text).toContain("effective production path was not reconciled");
		expect(text).toContain("runtime toggle");
		// The unresolved question is marked unresolved.
		expect(text).toContain("status=unresolved");
	});

	it("G7.5.3: R6 — bounded absence of match, NO global absence claim", () => {
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "unresolved",
					atom: "SEARCH_RETURNED_NO_MATCH",
					qualificationClasses: [
						"BOUNDED_TO_SEARCH_SCOPE",
						"EXTERNAL_SYSTEMS_NOT_EXAMINED",
					],
					evidenceRefs: ["kc_search"],
				},
			],
			evidence: evidenceFor(KEYCLOOR_TOOL_CALLS),
			sourcePrefixKey: "prefix-1",
		});
		expect(gate.records.length).toBe(1);
		const text = render(
			gate.records.map((record) => ({
				id: record.id,
				kind: record.kind,
				assurance: record.assurance,
				status: record.status,
				statement: record.statement,
				qualifications: record.qualifications,
				evidenceRefs: record.evidenceRefs,
			})),
		);
		// The bounded negative result.
		expect(text).toContain("bounded search returned no match");
		// The qualifications are retained.
		expect(text).toContain("absence is not established globally");
		expect(text).toContain("External systems");
		// It does NOT become a global absence claim.
		expect(text).not.toContain("no cleanup exists");
		expect(text).not.toContain("does not exist anywhere");
		expect(text).not.toContain("no token cleanup");
	});

	it("G7.5.4: an UNRELATED synthetic TypeScript fixture passes the SAME contract", () => {
		const typescriptRefs = ["ts_tool_1", "ts_tool_2", "ts_tool_3"];
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "OPERATION_INVOKED",
					argument: "build",
					evidenceRefs: ["ts_tool_1"],
				},
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "IMPLEMENTATION_INSPECTED",
					evidenceRefs: ["ts_tool_2"],
				},
				{
					kind: "open_question",
					assurance: "model_reported",
					status: "unresolved",
					atom: "QUESTION_REMAINS_OPEN",
					evidenceRefs: ["ts_tool_3"],
				},
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "unresolved",
					atom: "SEARCH_RETURNED_NO_MATCH",
					qualificationClasses: ["BOUNDED_TO_SEARCH_SCOPE"],
					evidenceRefs: ["ts_tool_3"],
				},
			],
			evidence: evidenceFor(typescriptRefs),
			sourcePrefixKey: "prefix-1",
		});
		expect(gate.records.length).toBe(4);
		const text = render(
			gate.records.map((record) => ({
				id: record.id,
				kind: record.kind,
				assurance: record.assurance,
				status: record.status,
				statement: record.statement,
				qualifications: record.qualifications,
				evidenceRefs: record.evidenceRefs,
			})),
		);
		// NO Keycloak-specific string appears anywhere.
		expect(text).not.toContain("kc");
		expect(text).not.toContain("Keycloak");
		expect(text).not.toContain("R4");
		expect(text).not.toContain("R6");
		// And the same four knowledge categories are represented.
		expect(text).toContain("operation invoked");
		expect(text).toContain("implementation inspected");
		expect(text).toContain("question remains open");
		expect(text).toContain("bounded search returned no match");
	});

	it("G7.5.5: the LIMIT is stated honestly — the vocabulary is deliberately SMALL", () => {
		// The vocabulary is exactly the six demonstrated atoms. It was NOT
		// widened to accommodate the Keycloak benchmark.
		expect(OBSERVATION_ATOMS.length).toBe(6);
		expect(RUNTIME_ARGUMENTS.length).toBe(6);
		expect(QUALIFICATION_CLASSES.length).toBe(5);
		// An observation the vocabulary cannot express has NO representation:
		// there is no free-form member to fall back to.
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "AN_ATOM_THAT_DOES_NOT_EXIST",
					evidenceRefs: ["kc_build"],
				},
			],
			evidence: evidenceFor(KEYCLOOR_TOOL_CALLS),
			sourcePrefixKey: "prefix-1",
		});
		expect(gate.admitted).toBe(false);
		expect(gate.records.length).toBe(0);
	});

	it("G7.5.6: the PRODUCTION module contains NO repository-specific string", () => {
		// The closed vocabulary, the gate and the projection are generic.
		// This assertion is a GUARD against a future regression that
		// hardcodes an investigation's vocabulary into production.
		const generic = [
			...OBSERVATION_ATOMS,
			...RUNTIME_ARGUMENTS,
			...QUALIFICATION_CLASSES,
		].join(" ");
		expect(generic.toLowerCase()).not.toContain("keycloak");
		expect(generic.toLowerCase()).not.toContain("kc.sh");
	});
});
