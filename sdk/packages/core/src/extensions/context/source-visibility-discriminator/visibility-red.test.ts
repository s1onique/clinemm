/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * G2 — the source-visibility RED, measured against the FROZEN evidence.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement suite.
 * ============================================================================
 *
 * WHAT THIS SUITE ESTABLISHES
 * ---------------------------
 *
 * It measures, from the FROZEN provider-visible captures and the canonical
 * transcript, whether the OPERATIONAL OBSERVATIONS that ordinary compaction
 * loses are:
 *
 *   - PRESENT in the canonical evidence,
 *   - PRESENT in the working agent's pre-compaction context,
 *   - MISSING from the ordinary summarizer input.
 *
 * THE THREE WITNESSES
 * -------------------
 *
 *   R4  An OBSERVED source fact: the startup script executes `kc.sh build`
 *       and then executes `kc.sh start --optimized`. The separate
 *       allegation that rebuilding causes configuration drift is a
 *       HYPOTHESIS and is never certified here.
 *
 *   R2  An INCOMPLETE investigation: the MTS Omni and Megafon provider
 *       implementations were identified and their implementation inspection
 *       was PARTIAL. That establishes an investigation target, not a
 *       completed finding about timeout safety.
 *
 *   R6  A BOUNDED NEGATIVE observation: no delete/purge was found in the
 *       inspected paths. This is NOT evidence that no retention mechanism
 *       exists anywhere.
 *
 * THE NON-VACUITY RULE
 * -------------------
 *
 * These tests FAIL if the underlying production serializer unexpectedly
 * begins preserving the exact R4/R2 detail. A test that only asserted the
 * ABSENCE of a string would pass forever, even after the defect was fixed.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalSourceMessages } from "../../../session/models/session-compaction";
import { createTokenEstimator } from "../compaction-shared";
import {
	buildCandidateA,
	buildCandidateB,
	buildCandidateC,
} from "./candidate-views";
import {
	countOccurrences,
	EXPECTED_ARTIFACT_HASHES,
	EXPECTED_BOUNDARIES,
	loadCanonicalTranscript,
	loadCompactionSidecar,
	loadProviderCapture,
	privateCaptureRoot,
	privateCapturesAvailable,
	providerVisibleNonReasoningText,
	sha256,
} from "./discriminator.fixture";

/** The exact source observation for R4's first operation. */
const R4_BUILD = "kc.sh build";
/** The exact source observation for R4's second operation. */
const R4_START = "start --optimized";
/** The bounded negative observation for R6. */
const R6_BOUNDED_NEGATIVE = "No delete/purge found in those paths";
/** The provider implementation identifier R2's investigation had found. */
const R2_PROVIDER_IDENTIFIER = "MtsOmni";
/** The second provider implementation identifier R2's investigation had found. */
const R2_PROVIDER_IDENTIFIER_2 = "Megafon";

describe("ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01 — G2 visibility RED", () => {
	const available = privateCapturesAvailable();

	it("G2.1: every frozen artifact hash matches the ACT's recorded identity", () => {
		if (!available) {
			expect(
				`NOT_EXECUTED: the private capture root ${privateCaptureRoot()} is absent.`,
			).toContain("NOT_EXECUTED");
			return;
		}
		for (const [name, expected] of Object.entries(EXPECTED_ARTIFACT_HASHES)) {
			expect(sha256(join(privateCaptureRoot(), name)), `artifact ${name}`).toBe(
				expected,
			);
		}
	});

	it("G2.2: the canonical transcript reproduces BOTH boundary prefix identities exactly", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(transcript.messages);
		for (const [name, expected] of Object.entries(EXPECTED_BOUNDARIES)) {
			const sidecar = loadCompactionSidecar(
				name === "boundary-1"
					? "first-compaction.json"
					: "second-compaction.json",
			);
			expect(sidecar.source_message_count, `${name} count`).toBe(
				expected.sourceMessageCount,
			);
			expect(sidecar.source_prefix_hash, `${name} hash`).toBe(
				expected.sourcePrefixHash,
			);
			expect(sidecar.source_last_message_key, `${name} boundary key`).toBe(
				expected.sourceLastMessageKey,
			);
			// The boundary key must agree with the canonical message at the
			// boundary. A prefix hash that matches but names a different
			// message would mean the correlation was by coincidence.
			const boundary = canonical[expected.sourceMessageCount - 1] as {
				id?: string;
			};
			expect(`id:${boundary.id}`).toBe(expected.sourceLastMessageKey);
		}
	});

	it("G2.3: the canonical evidence CONTAINS the R4 command pair, and the ordinary summarizer view DOES NOT", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(transcript.messages);
		const boundary1 = canonical.slice(
			0,
			EXPECTED_BOUNDARIES["boundary-1"].sourceMessageCount,
		);
		const estimator = createTokenEstimator();
		const viewA = buildCandidateA({
			canonicalMessages: boundary1,
			targetTokens: 1_000_000,
			estimateMessageTokens: estimator,
		});
		const viewB = buildCandidateB({ canonicalMessages: boundary1 });
		const viewC = buildCandidateC({ canonicalMessages: boundary1 });

		// CANONICAL EVIDENCE: PRESENT.
		const canonicalText = JSON.stringify(boundary1);
		expect(countOccurrences(canonicalText, R4_BUILD)).toBeGreaterThan(0);
		expect(countOccurrences(canonicalText, R4_START)).toBeGreaterThan(0);

		// ORDINARY SUMMARIZER INPUT: MISSING.
		// This assertion is the RED. It FAILS if the production serializer
		// unexpectedly begins preserving the exact R4 detail.
		expect(countOccurrences(viewA.text, R4_START)).toBe(0);

		// WORKING-AGENT INPUT (candidate B): PRESENT.
		expect(countOccurrences(viewB.text, R4_START)).toBeGreaterThan(0);
		// DEDICATED EVIDENCE VIEW (candidate C): PRESENT.
		expect(countOccurrences(viewC.text, R4_START)).toBeGreaterThan(0);
	});

	it("G2.4: the ordinary summarizer view OMITS the structured payload while the working-agent view carries it", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(transcript.messages);
		const boundary1 = canonical.slice(
			0,
			EXPECTED_BOUNDARIES["boundary-1"].sourceMessageCount,
		);
		const estimator = createTokenEstimator();
		const viewA = buildCandidateA({
			canonicalMessages: boundary1,
			targetTokens: 1_000_000,
			estimateMessageTokens: estimator,
		});
		const viewB = buildCandidateB({ canonicalMessages: boundary1 });
		// The production serializer substitutes the omission marker for the
		// structured payload body. That marker is the EXACT seam of the
		// loss, so its presence is asserted positively.
		expect(viewA.text).toContain("[result omitted]");
		// The constructed working-agent view carries the body instead.
		expect(viewB.text).not.toContain("[result omitted]");
	});

	it("G2.5: R2's INSPECTED IMPLEMENTATION CONTENT is MISSING from the ordinary view and PRESENT in the working-agent view", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(transcript.messages);
		const boundary2 = canonical.slice(
			0,
			EXPECTED_BOUNDARIES["boundary-2"].sourceMessageCount,
		);
		const estimator = createTokenEstimator();
		const viewA = buildCandidateA({
			canonicalMessages: boundary2,
			targetTokens: 1_000_000,
			estimateMessageTokens: estimator,
		});
		const viewB = buildCandidateB({ canonicalMessages: boundary2 });
		const canonicalText = JSON.stringify(boundary2);
		expect(
			countOccurrences(canonicalText, R2_PROVIDER_IDENTIFIER),
		).toBeGreaterThan(0);
		expect(
			countOccurrences(canonicalText, R2_PROVIDER_IDENTIFIER_2),
		).toBeGreaterThan(0);
		// The IMPLEMENTATION DETAIL that the investigation actually
		// inspected is the timeout value. It was read from the provider
		// source through a `run_commands` stdout body, so the ordinary
		// summarizer view OMITS it.
		//
		// NOTE ON THE IDENTIFIER ITSELF: the bare identifier
		// `MtsOmni` DOES survive the ordinary view, because the tool
		// CALL's own command line is rendered by `formatToolInput` and
		// names the file. What the ordinary view does NOT carry is the
		// CONTENT the investigation inspected. The two are different
		// classes, and the ACT records both.
		expect(viewA.text).not.toContain("connectTimeoutMillis(3_000)");
		expect(viewA.text).not.toContain("socketTimeOutMillis(10_000)");
		// WORKING-AGENT INPUT: the inspected implementation IS present.
		expect(viewB.text).toContain("connectTimeoutMillis(3_000)");
		expect(viewB.text).toContain("socketTimeOutMillis(10_000)");
	});

	it("G2.6: R6's bounded negative observation is NOT reconstructible as a VERBATIM statement, but its underlying tool evidence IS visible to the working-agent view", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(transcript.messages);
		const boundary2 = canonical.slice(
			0,
			EXPECTED_BOUNDARIES["boundary-2"].sourceMessageCount,
		);
		const estimator = createTokenEstimator();
		const viewA = buildCandidateA({
			canonicalMessages: boundary2,
			targetTokens: 1_000_000,
			estimateMessageTokens: estimator,
		});
		const viewB = buildCandidateB({ canonicalMessages: boundary2 });
		// The EXACT English sentence lived in a THINKING block. The ordinary
		// view drops thinking blocks, and the working-agent view drops them
		// too. So the exact statement is absent from both, and its ABSENCE
		// is the correct, honest outcome: it cannot be republished without
		// copying private reasoning.
		expect(countOccurrences(viewA.text, R6_BOUNDED_NEGATIVE)).toBe(0);
		expect(countOccurrences(viewB.text, R6_BOUNDED_NEGATIVE)).toBe(0);
		// BUT the UNDERLYING NON-PRIVATE evidence IS available: the grep
		// over the provider JPA/authentication sources and the Liquibase
		// changelog directory for delete|purge|retention|cleanup|expired
		// returned an EMPTY match set, whose tool-result body is the
		// section marker alone. The working-agent view carries that body.
		// A checkpoint model can therefore publish a FRESH, bounded
		// negative statement ("no matching purge was observed in the
		// inspected scope") WITHOUT copying the private reasoning.
		//
		// NOTE: the marker text itself ALSO appears in the tool CALL's
		// command line (it is an `echo` label), so it is NOT a valid
		// discriminator on its own — the ordinary view carries it through
		// `formatToolInput`. The valid discriminator is the RESULT BODY:
		// the ordinary view renders the structured payload as
		// `[result omitted]`, so it never carries the body that shows the
		// match set was EMPTY.
		expect(viewA.text).toContain("[result omitted]");
		expect(viewB.text).toContain("=== changelog retention ===");
		// The EMPTY match set is the substantive difference: the ordinary
		// view cannot show that the grep produced no matching lines.
		expect(countOccurrences(viewA.text, "status=succeeded body=")).toBe(0);
		expect(
			countOccurrences(viewB.text, "status=succeeded body="),
		).toBeGreaterThan(0);
	});

	it("G2.7: the post-compaction provider-visible contexts LOSE the exact witnesses", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const pre = providerVisibleNonReasoningText(
			loadProviderCapture("pre.json"),
		);
		const post = providerVisibleNonReasoningText(
			loadProviderCapture("post.json"),
		);
		const secondPre = providerVisibleNonReasoningText(
			loadProviderCapture("second-pre.json"),
		);
		const secondPost = providerVisibleNonReasoningText(
			loadProviderCapture("second-post.json"),
		);
		// PRECONDITION: the source observation WAS provider-visible before
		// compaction. Without this, the later absence would not be a loss.
		expect(countOccurrences(pre, R4_START)).toBeGreaterThan(0);
		expect(countOccurrences(secondPre, R4_START)).toBeGreaterThan(0);
		expect(
			countOccurrences(pre, "connectTimeoutMillis(3_000)"),
		).toBeGreaterThan(0);
		expect(
			countOccurrences(secondPre, "connectTimeoutMillis(3_000)"),
		).toBeGreaterThan(0);
		// BOUNDARY 1 (15 -> 16) and BOUNDARY 2 (33 -> 34): the exact
		// observations are gone from the provider-visible continuation.
		//
		// The measurement EXCLUDES the provider's `reasoning` channel. The
		// historical `second-post.json` DOES contain `connectTimeoutMillis(
		// 3_000)`, but ONLY inside a `reasoning` block — the model's own
		// private re-derivation, not the tool observation. Counting
		// reasoning here would have wrongly reported that R2's
		// implementation detail SURVIVED the boundary.
		expect(countOccurrences(post, R4_START)).toBe(0);
		expect(countOccurrences(secondPost, R4_START)).toBe(0);
		expect(countOccurrences(post, "connectTimeoutMillis(3_000)")).toBe(0);
		expect(countOccurrences(secondPost, "connectTimeoutMillis(3_000)")).toBe(0);
	});
});
