/**
 * ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
 *
 * G5 — the knowledge-utility controls.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement suite.
 * ============================================================================
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 *
 * A security control that removes the leak AND removes the knowledge is not
 * a success — it is a vacuous fix. This suite therefore proves that the
 * selected contract RETAINS the three adjudicated witnesses:
 *
 *   R4  the two observed startup operations, AND the uncertainty about
 *       configuration drift
 *   R2  the inspected implementation content, the timeouts, AND the
 *       unresolved effective production sender
 *   R6  the bounded negative observation, AND the unresolved external
 *       cleanup
 *
 * AND that it does so for an UNRELATED repository, which is what proves the
 * contract is generic rather than a Keycloak-specific mapping.
 *
 * THE REPRESENTATION IS NOT VACUOUS
 * ---------------------------------
 *
 * A record that says only "R4: investigated" does NOT satisfy the retention
 * objective. The suite asserts that BOTH operations of R4 are present, that
 * the qualification text names the drift uncertainty, and that R6's record
 * does NOT degenerate into "No token cleanup exists."
 */

import { describe, expect, it } from "vitest";
import {
	type ProjectableRecord,
	renderCheckpointSection,
} from "../source-visibility-discriminator/projection";
import type {
	ClosedStructureProposal,
	ObservationAtom,
	QualificationClass,
	RuntimeArgument,
} from "./candidate-contracts";
import {
	gateClosedStructure,
	toProjectableRecords,
} from "./controlled-publication-gate";

/**
 * The rendered section text for a set of proposals, gated.
 */
function renderProposals(
	proposals: readonly ClosedStructureProposal[],
	canonicalReferences: readonly string[],
): string | undefined {
	const gate = gateClosedStructure({
		proposals,
		canonicalReferences,
	});
	if (!gate.decision.admitted) {
		return undefined;
	}
	return renderCheckpointSection(
		toProjectableRecords(
			gate.admitted,
		) as unknown as readonly ProjectableRecord[],
	);
}

/**
 * Build a proposal.
 */
function proposal(input: {
	kind?: ClosedStructureProposal["kind"];
	assurance?: ClosedStructureProposal["assurance"];
	status?: ClosedStructureProposal["status"];
	atom: ObservationAtom;
	argument?: RuntimeArgument;
	qualificationClasses?: readonly QualificationClass[];
	evidenceRefs: readonly string[];
}): ClosedStructureProposal {
	return {
		kind: input.kind ?? "observation",
		assurance: input.assurance ?? "tool_observed",
		status: input.status ?? "active",
		atom: input.atom,
		...(input.argument === undefined ? {} : { argument: input.argument }),
		...(input.qualificationClasses === undefined
			? {}
			: { qualificationClasses: input.qualificationClasses }),
		evidenceRefs: input.evidenceRefs,
	};
}

/**
 * The canonical reference ids for the frozen witnesses.
 */
const R4_REF = "id:r4_startup_script";
const R2_REF = "id:r2_provider_impl";
const R6_REF = "id:r6_bounded_search";
const UNRELATED_REF = "id:unrelated_read";

describe("ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01 — G5 knowledge utility", () => {
	it("G5.1 R4: BOTH observed startup operations are preserved, AND the drift uncertainty is preserved", () => {
		const rendered = renderProposals(
			[
				proposal({
					atom: "OPERATION_INVOKED",
					argument: "build",
					qualificationClasses: ["OBSERVATION_ONLY_NO_CAUSATION"],
					evidenceRefs: [R4_REF],
				}),
				proposal({
					atom: "OPERATION_INVOKED",
					argument: "start_optimized",
					qualificationClasses: ["OBSERVATION_ONLY_NO_CAUSATION"],
					evidenceRefs: [R4_REF],
				}),
			],
			[R4_REF],
		);
		expect(rendered).toBeDefined();
		// BOTH operations are present. A record that says only
		// "startup investigated" would NOT satisfy this.
		expect(rendered).toContain("build");
		expect(rendered).toContain("start --optimized");
		// The uncertainty is preserved: the qualification names that the
		// observation does not establish causation.
		expect(rendered).toContain("does not establish causation");
		// The record does NOT assert a drift finding.
		expect(rendered).not.toContain("configuration drift is proven");
		expect(rendered).not.toContain("runtime_verified");
	});

	it("G5.2 R2: the inspected implementation content AND the unresolved production sender are preserved", () => {
		const rendered = renderProposals(
			[
				proposal({
					atom: "IMPLEMENTATION_INSPECTED",
					qualificationClasses: ["EFFECTIVE_PATH_NOT_RECONCILED"],
					evidenceRefs: [R2_REF],
				}),
				proposal({
					atom: "CONFIGURATION_VALUE_SET",
					argument: "connect_timeout_3s",
					qualificationClasses: ["RUNTIME_TOGGLE_UNRESOLVED"],
					evidenceRefs: [R2_REF],
				}),
				proposal({
					atom: "CONFIGURATION_VALUE_SET",
					argument: "socket_timeout_10s",
					qualificationClasses: ["RUNTIME_TOGGLE_UNRESOLVED"],
					evidenceRefs: [R2_REF],
				}),
			],
			[R2_REF],
		);
		expect(rendered).toBeDefined();
		// The inspected implementation content is named.
		expect(rendered).toContain("implementation inspected");
		// BOTH timeouts are present.
		expect(rendered).toContain("connect timeout 3 seconds");
		expect(rendered).toContain("socket timeout 10 seconds");
		// The unresolved effective production sender is preserved.
		expect(rendered).toContain("effective production path was not reconciled");
		expect(rendered).toContain("runtime toggle");
		// It does NOT certify that the whole production flow is protected.
		expect(rendered).not.toContain("fully protected");
	});

	it("G5.3 R6: the bounded negative observation is preserved WITHOUT becoming a global nonexistence claim", () => {
		const rendered = renderProposals(
			[
				proposal({
					atom: "SEARCH_RETURNED_NO_MATCH",
					qualificationClasses: [
						"BOUNDED_TO_SEARCH_SCOPE",
						"EXTERNAL_SYSTEMS_NOT_EXAMINED",
					],
					evidenceRefs: [R6_REF],
				}),
			],
			[R6_REF],
		);
		expect(rendered).toBeDefined();
		// The bounded negative is present.
		expect(rendered).toContain("bounded search returned no match");
		// The scope qualification is present.
		expect(rendered).toContain("Bounded to the searched scope");
		// The unresolved external cleanup is present.
		expect(rendered).toContain(
			"External systems and scheduled maintenance were not examined",
		);
		// And it does NOT degenerate into a global nonexistence claim.
		expect(rendered).not.toContain("No token cleanup exists");
		expect(rendered).not.toContain("no cleanup path exists");
	});

	it("G5.4: an UNRELATED synthetic TypeScript project passes the SAME generic contract", () => {
		// The four equivalent knowledge categories, in a completely
		// different domain. Nothing here mentions Keycloak.
		const rendered = renderProposals(
			[
				// Observed operation.
				proposal({
					atom: "OPERATION_INVOKED",
					argument: "build",
					qualificationClasses: ["OBSERVATION_ONLY_NO_CAUSATION"],
					evidenceRefs: [UNRELATED_REF],
				}),
				// Observed configuration value.
				proposal({
					atom: "CONFIGURATION_VALUE_SET",
					argument: "connect_timeout_3s",
					qualificationClasses: ["RUNTIME_TOGGLE_UNRESOLVED"],
					evidenceRefs: [UNRELATED_REF],
				}),
				// Bounded absence-of-evidence result.
				proposal({
					atom: "SEARCH_RETURNED_NO_MATCH",
					qualificationClasses: [
						"BOUNDED_TO_SEARCH_SCOPE",
						"EXTERNAL_SYSTEMS_NOT_EXAMINED",
					],
					evidenceRefs: [UNRELATED_REF],
				}),
				// Unresolved deployment question.
				proposal({
					kind: "open_question",
					status: "unresolved",
					assurance: "model_reported",
					atom: "QUESTION_REMAINS_OPEN",
					qualificationClasses: ["EFFECTIVE_PATH_NOT_RECONCILED"],
					evidenceRefs: [UNRELATED_REF],
				}),
			],
			[UNRELATED_REF],
		);
		expect(rendered).toBeDefined();
		// All four categories are represented.
		expect(rendered).toContain("operation invoked");
		expect(rendered).toContain("configuration value set");
		expect(rendered).toContain("bounded search returned no match");
		expect(rendered).toContain("question remains open");
		// The qualifications travel with them.
		expect(rendered).toContain("does not establish causation");
		expect(rendered).toContain("Bounded to the searched scope");
		expect(rendered).toContain("effective production path was not reconciled");
		// And nothing Keycloak-specific leaked into the unrelated fixture.
		expect(rendered).not.toContain("Keycloak");
		expect(rendered).not.toContain("keycloak");
		expect(rendered).not.toContain("kc.sh");
	});

	it("G5.5: the METRICS are reported and the contract is NOT vacuous", () => {
		const proposals = [
			proposal({
				atom: "OPERATION_INVOKED",
				argument: "build",
				qualificationClasses: ["OBSERVATION_ONLY_NO_CAUSATION"],
				evidenceRefs: [R4_REF],
			}),
			proposal({
				atom: "OPERATION_INVOKED",
				argument: "start_optimized",
				qualificationClasses: ["OBSERVATION_ONLY_NO_CAUSATION"],
				evidenceRefs: [R4_REF],
			}),
			proposal({
				atom: "IMPLEMENTATION_INSPECTED",
				qualificationClasses: ["EFFECTIVE_PATH_NOT_RECONCILED"],
				evidenceRefs: [R2_REF],
			}),
			proposal({
				atom: "CONFIGURATION_VALUE_SET",
				argument: "connect_timeout_3s",
				qualificationClasses: ["RUNTIME_TOGGLE_UNRESOLVED"],
				evidenceRefs: [R2_REF],
			}),
			proposal({
				atom: "CONFIGURATION_VALUE_SET",
				argument: "socket_timeout_10s",
				qualificationClasses: ["RUNTIME_TOGGLE_UNRESOLVED"],
				evidenceRefs: [R2_REF],
			}),
			proposal({
				atom: "SEARCH_RETURNED_NO_MATCH",
				qualificationClasses: [
					"BOUNDED_TO_SEARCH_SCOPE",
					"EXTERNAL_SYSTEMS_NOT_EXAMINED",
				],
				evidenceRefs: [R6_REF],
			}),
		];
		const gate = gateClosedStructure({
			proposals,
			canonicalReferences: [R4_REF, R2_REF, R6_REF],
		});
		expect(gate.decision.admitted).toBe(true);
		const records = toProjectableRecords(gate.admitted);
		const rendered =
			renderCheckpointSection(
				records as unknown as readonly ProjectableRecord[],
			) ?? "";

		// critical_observations_retained: the distinct observed facts.
		const criticalObservations = [
			"build",
			"start --optimized",
			"implementation inspected",
			"connect timeout 3 seconds",
			"socket timeout 10 seconds",
			"bounded search returned no match",
		].filter((fact) => rendered.includes(fact));
		expect(criticalObservations.length).toBe(6);
		// qualifications_retained: the distinct qualification sentences.
		const qualifications = [
			"does not establish causation",
			"effective production path was not reconciled",
			"runtime toggle and complete path protection remain unresolved",
			"Bounded to the searched scope",
			"External systems and scheduled maintenance were not examined",
		].filter((qualification) => rendered.includes(qualification));
		expect(qualifications.length).toBe(5);
		// unsupported_claims_promoted: ZERO. No `runtime_verified` is
		// present, and every record's assurance is bounded.
		expect(rendered).not.toContain("runtime_verified");
		expect(
			records.every((record) => record.assurance !== "runtime_verified"),
		).toBe(true);
		// arbitrary_text_newly_persisted: ZERO. Every published statement is
		// one of the runtime's own strings.
		const runtimeStatements = new Set([
			"operation invoked",
			"operation invoked: build",
			"operation invoked: start --optimized",
			"implementation inspected",
			"configuration value set: connect timeout 3 seconds",
			"configuration value set: socket timeout 10 seconds",
			"bounded search returned no match",
			"question remains open",
		]);
		expect(
			records.every((record) => runtimeStatements.has(record.statement)),
		).toBe(true);
		// checkpoint_records_carried: 6.
		expect(records.length).toBe(6);
		// estimated_projection_tokens: a coarse, documented estimate. The
		// section is four characters per token.
		const estimatedTokens = Math.ceil(rendered.length / 4);
		expect(estimatedTokens).toBeGreaterThan(0);
		expect(estimatedTokens).toBeLessThan(1500);
	});
});
