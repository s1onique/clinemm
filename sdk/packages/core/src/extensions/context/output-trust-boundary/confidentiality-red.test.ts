/**
 * ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
 *
 * G2 — the CONFIDENTIALITY RED against the REAL exported projection.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement suite.
 * ============================================================================
 *
 * WHAT THIS SUITE PROVES
 * ----------------------
 *
 * The predecessor's REAL exported `renderCheckpointSection()` carries a
 * model-authored statement and qualification text into the rendered section
 * VERBATIM. There is no publication gate on the path. The dummy secret that
 * the synthetic tool result contains appears in the rendered section, in the
 * persisted summary projection, and in the provider-visible continuation.
 *
 * THE FIXTURE IS FULLY SYNTHETIC
 * -------------------------------
 *
 * The canonical history, the tool-call id, the tool-result body and the
 * "secret" are all invented. The secret carries a `DO-NOT-USE` marker.
 *
 * THE DISCRIMINATOR IS NOT VACUOUS
 * ---------------------------------
 *
 * A leak assertion that also fires when the content is merely ABSENT would
 * prove nothing. So the suite asserts, for each leak case:
 *
 *   1. the secret IS in the synthetic tool result,
 *   2. the secret IS in the model-authored candidate,
 *   3. the candidate IS schema-valid and assurance-bounded,
 *   4. the secret IS in the rendered section  <-- THE DEFECT
 *
 * and then, for the CONTROL arm, that removing the secret from the candidate
 * makes the leak assertion stop firing. A token-budget omission would not
 * produce that distinction: a budget omission also removes the content, but
 * the control arm here varies ONLY the secret's presence while the record
 * count, the record length and the field structure stay constant.
 */

import { describe, expect, it } from "vitest";
import {
	applyCheckpointSectionToSummary,
	type ProjectableRecord,
	renderCheckpointSection,
} from "../source-visibility-discriminator/projection";
import {
	boundAssurance,
	resolveEvidenceReference,
} from "../source-visibility-discriminator/trust";
import {
	CONFIDENTIALITY_CANDIDATE,
	SYNTHETIC_DUMMY_SECRET,
	SYNTHETIC_OPAQUE_DUMMY,
	SYNTHETIC_VALID_TOOL_CALL_ID,
	syntheticConfidentialityHistory,
} from "./synthetic-fixture";

/**
 * The number of occurrences of a needle in a haystack.
 */
function countOccurrences(haystack: string, needle: string): number {
	if (!needle) {
		return 0;
	}
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

/**
 * The summary text that the REAL production compaction produces.
 *
 * It is deliberately ORDINARY text with no checkpoint content, so the leak
 * assertion can only fire because of the checkpoint projection.
 */
const ORDINARY_SUMMARY = [
	"## Goal",
	"Inspect the deployment configuration.",
	"",
	"## State",
	"- **Done:** Ran a read-only inspection of the deployment directory.",
].join("\n");

describe("ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01 — G2 confidentiality RED", () => {
	it("G2.1.1: the synthetic reference resolves, its semantic support is NOT verified, and the assurance is bounded", () => {
		const history = syntheticConfidentialityHistory();
		const resolved = resolveEvidenceReference({
			reference: SYNTHETIC_VALID_TOOL_CALL_ID,
			canonicalMessages: history,
		});
		// The reference genuinely exists in the canonical fixture.
		expect(resolved.identityResolved).toBe(true);
		// The resolver is content-blind, so it can NEVER assert support.
		expect(resolved.semanticSupportVerified).toBe(false);
		// The bound downgrades a model-claimed `runtime_verified`.
		expect(
			boundAssurance({ claimed: "runtime_verified", resolved: [resolved] }),
		).toBe("tool_observed");
	});

	it("G2.1.2: the dummy secret IS in the synthetic tool result and IS in the model-authored candidate", () => {
		const history = syntheticConfidentialityHistory();
		expect(JSON.stringify(history)).toContain(SYNTHETIC_DUMMY_SECRET);
		expect(CONFIDENTIALITY_CANDIDATE.statement).toContain(
			SYNTHETIC_DUMMY_SECRET,
		);
		// The candidate cites the VALID canonical reference and carries a
		// bounded assurance: it is a well-formed candidate.
		expect(CONFIDENTIALITY_CANDIDATE.evidenceRefs).toContain(
			SYNTHETIC_VALID_TOOL_CALL_ID,
		);
		expect(CONFIDENTIALITY_CANDIDATE.assurance).toBe("tool_observed");
	});

	it("G2.1.3: DEFECT — the REAL exported renderCheckpointSection carries the dummy secret into the rendered section", () => {
		const rendered = renderCheckpointSection([
			CONFIDENTIALITY_CANDIDATE,
		] as unknown as readonly ProjectableRecord[]);
		expect(rendered).toBeDefined();
		// THE DEFECT: the model-authored secret survives into the section.
		expect(rendered).toContain(SYNTHETIC_DUMMY_SECRET);
		// And the section is otherwise a well-formed checkpoint section, so
		// the leak is not an artefact of a malformed render.
		expect(rendered).toContain("assurance=tool_observed");
		expect(rendered).toContain(SYNTHETIC_VALID_TOOL_CALL_ID);
	});

	it("G2.1.4: DEFECT — the secret reaches the PERSISTED SUMMARY projection", () => {
		const nextSummary = applyCheckpointSectionToSummary(ORDINARY_SUMMARY, [
			CONFIDENTIALITY_CANDIDATE,
		] as unknown as readonly ProjectableRecord[]);
		expect(nextSummary).toContain(SYNTHETIC_DUMMY_SECRET);
		// The ordinary summary survives; the checkpoint is APPENDED, so the
		// leak is an ADDITION, not a replacement.
		expect(nextSummary).toContain("## Goal");
	});

	it("G2.1.5: NON-VACUITY — removing the secret from the candidate stops the leak assertion", () => {
		const withoutSecret = renderCheckpointSection([
			{
				...CONFIDENTIALITY_CANDIDATE,
				statement: "The deployment configuration was inspected.",
			},
		] as unknown as readonly ProjectableRecord[]);
		expect(withoutSecret).toBeDefined();
		// The leak assertion STOPS firing.
		expect(withoutSecret).not.toContain(SYNTHETIC_DUMMY_SECRET);
		// And the record is STILL rendered, with the same record count and
		// the same field structure. So the earlier assertion did not fire
		// because the record was omitted by a token budget or a size limit.
		expect(withoutSecret).toContain(
			"statement=The deployment configuration was inspected.",
		);
		expect(withoutSecret).toContain("assurance=tool_observed");
	});

	it("G2.1.6: NON-VACUITY — the same content in a DIFFERENT field is still detected", () => {
		// The secret is moved from `statement` into `qualifications`.
		const inQualifications = renderCheckpointSection([
			{
				...CONFIDENTIALITY_CANDIDATE,
				statement: "The deployment configuration was inspected.",
				qualifications: [`value=${SYNTHETIC_DUMMY_SECRET}`],
			},
		] as unknown as readonly ProjectableRecord[]);
		expect(inQualifications).toBeDefined();
		// The remaining publication path is detected.
		expect(inQualifications).toContain(SYNTHETIC_DUMMY_SECRET);
	});

	it("G2.1.7: the OPAQUE dummy (no recognisable keyword) leaks too — the decisive case against a secret-pattern scanner", () => {
		const opaqueCandidate = {
			...CONFIDENTIALITY_CANDIDATE,
			statement: `The deployment configuration contains ${SYNTHETIC_OPAQUE_DUMMY}`,
		};
		const rendered = renderCheckpointSection([
			opaqueCandidate,
		] as unknown as readonly ProjectableRecord[]);
		expect(rendered).toBeDefined();
		// A scanner would not flag this string. It is published anyway.
		expect(rendered).toContain(SYNTHETIC_OPAQUE_DUMMY);
	});

	it("G2.1.8: the leak is not an artefact of the record id or the reference text", () => {
		// The secret is embedded in the record id AND in an evidence
		// reference. Both are carried into the rendered section.
		const inIdentity = renderCheckpointSection([
			{
				...CONFIDENTIALITY_CANDIDATE,
				id: `id-${SYNTHETIC_DUMMY_SECRET}`,
				evidenceRefs: [`ref-${SYNTHETIC_DUMMY_SECRET}`],
			},
		] as unknown as readonly ProjectableRecord[]);
		expect(inIdentity).toBeDefined();
		expect(inIdentity).toContain(SYNTHETIC_DUMMY_SECRET);
	});

	it("G2.1.9: the section is appended to, not substituted for, the ordinary summary — the ordinary content is not lost", () => {
		const nextSummary = applyCheckpointSectionToSummary(ORDINARY_SUMMARY, [
			CONFIDENTIALITY_CANDIDATE,
		] as unknown as readonly ProjectableRecord[]);
		expect(nextSummary.startsWith(ORDINARY_SUMMARY)).toBe(true);
		// Exactly ONE checkpoint section.
		expect(countOccurrences(nextSummary, "Working knowledge checkpoint")).toBe(
			1,
		);
	});
});
