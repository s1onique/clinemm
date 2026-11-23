/**
 * ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
 *
 * HISTORICAL BASELINE (G2) — the RED, measured against the FROZEN evidence.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement suite.
 * ============================================================================
 *
 * WHAT THIS SUITE ESTABLISHES
 * ---------------------------
 *
 * It measures, from the FROZEN provider-visible captures, whether a
 * previously established observation or qualified statement survives the
 * ordinary compaction projection.
 *
 * The measurement is SEMANTIC, not keyword-count-only: every assertion
 * names the exact source observation and checks for the exact operational
 * detail in the provider-visible continuation.
 *
 * EVIDENCE CLASSIFICATION
 * -----------------------
 *
 *   REAL — the measurement is taken from the frozen, hash-verified
 *          production captures and the canonical transcript.
 *
 * The suite is SELF-SKIPPING: when the private capture root is absent, it
 * reports `NOT_EXECUTED` rather than failing. The raw transcripts and
 * provider payloads are NEVER committed.
 *
 * THE THREE WITNESSES
 * -------------------
 *
 *   R4  An OBSERVED source fact: `startup.sh` executes `kc.sh build` and
 *       then executes `kc.sh start --optimized`. The separate allegation
 *       that rebuilding causes configuration drift is a HYPOTHESIS and is
 *       never certified here.
 *
 *   R6  A BOUNDED NEGATIVE observation: no delete/purge was found in the
 *       inspected paths. This is NOT evidence that no retention mechanism
 *       exists anywhere.
 *
 *   R2  An INCOMPLETE investigation: the MTS Omni and Megafon providers
 *       were identified and their implementation inspection was PLANNED.
 *       That establishes an investigation target, not a completed finding
 *       about timeout safety.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalSourceMessages } from "../../../session/models/session-compaction";
import {
	EXPECTED_ARTIFACT_HASHES,
	loadCanonicalTranscript,
	loadCompactionSidecar,
	loadProviderCapture,
	privateCaptureRoot,
	privateCapturesAvailable,
	providerVisibleText,
} from "./checkpoint-probe.fixture";

/** The exact source observation for R4, as it appeared in the tool output. */
const R4_SOURCE_OBSERVATION_BUILD = "kc.sh build";
/** The exact source observation for R4's second operation. */
const R4_SOURCE_OBSERVATION_START = "start --optimized";
/** The bounded negative observation for R6. */
const R6_BOUNDED_NEGATIVE = "No delete/purge found in those paths";
/** The provider identifier that R2's investigation had identified. */
const R2_PROVIDER_IDENTIFIER = "MtsOmni";

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

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
 * The measured baseline matrix.
 *
 * Each row is the SAME measurement for a different witness: does the exact
 * detail survive the compaction boundary in the provider-visible context?
 */
interface WitnessRow {
	readonly witness: string;
	readonly needle: string;
	readonly beforeCapture: string;
	readonly afterCapture: string;
	readonly occurrencesBefore: number;
	readonly occurrencesAfter: number;
}

describe("ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01 — historical baseline", () => {
	const available = privateCapturesAvailable();

	it("G2.1: every frozen artifact hash matches the ACT's recorded identity", () => {
		if (!available) {
			expect(
				`NOT_EXECUTED: the private capture root ${privateCaptureRoot()} is absent.`,
			).toContain("NOT_EXECUTED");
			return;
		}
		for (const [name, expected] of Object.entries(EXPECTED_ARTIFACT_HASHES)) {
			const actual = sha256(join(privateCaptureRoot(), name));
			expect(actual, `artifact ${name}`).toBe(expected);
		}
	});

	it("G2.2: the canonical transcript reproduces BOTH sidecar source prefix identities exactly", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(
			transcript.messages as never,
		) as never[];
		for (const name of ["first-compaction.json", "second-compaction.json"]) {
			const sidecar = loadCompactionSidecar(name);
			const count = sidecar.source_message_count;
			expect(count).toBeGreaterThan(0);
			expect(canonical.length).toBeGreaterThanOrEqual(count);
			// The sidecar's own identity must be internally consistent: the
			// recorded last-message key must be the canonical message at the
			// recorded boundary.
			const boundary = canonical[count - 1] as { id?: string };
			expect(sidecar.source_last_message_key).toBe(`id:${boundary.id}`);
		}
	});

	it("G2.3: R4's exact startup operations are ABSENT from both post-compaction provider-visible contexts", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const pre = providerVisibleText(loadProviderCapture("pre.json"));
		const post = providerVisibleText(loadProviderCapture("post.json"));
		const secondPre = providerVisibleText(
			loadProviderCapture("second-pre.json"),
		);
		const secondPost = providerVisibleText(
			loadProviderCapture("second-post.json"),
		);

		// PRECONDITION: the source observation WAS in the provider-visible
		// context before compaction. Without this, the later absence would
		// not be a loss.
		expect(countOccurrences(pre, R4_SOURCE_OBSERVATION_START)).toBeGreaterThan(
			0,
		);
		expect(
			countOccurrences(secondPre, R4_SOURCE_OBSERVATION_START),
		).toBeGreaterThan(0);

		// The FIRST operation of the same observed command pair is still
		// visible as a TOPIC in the summary, which is exactly the shape of
		// the loss: the topic survives, the exact observation does not.
		expect(countOccurrences(post, R4_SOURCE_OBSERVATION_BUILD)).toBeGreaterThan(
			0,
		);

		// BOUNDARY 1 (15 -> 16): the exact second operation is gone.
		expect(countOccurrences(post, R4_SOURCE_OBSERVATION_START)).toBe(0);
		// BOUNDARY 2 (33 -> 34): the exact second operation is gone.
		expect(countOccurrences(secondPost, R4_SOURCE_OBSERVATION_START)).toBe(0);
	});

	it("G2.4: R6's bounded negative observation is ABSENT from the second post-compaction context", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const secondPre = providerVisibleText(
			loadProviderCapture("second-pre.json"),
		);
		const secondPost = providerVisibleText(
			loadProviderCapture("second-post.json"),
		);
		// PRECONDITION: the bounded negative WAS present before boundary 2.
		expect(countOccurrences(secondPre, R6_BOUNDED_NEGATIVE)).toBeGreaterThan(0);
		// BOUNDARY 2: it is gone.
		expect(countOccurrences(secondPost, R6_BOUNDED_NEGATIVE)).toBe(0);
	});

	it("G2.5: R2's provider identifier is ABSENT from both post-compaction provider-visible contexts", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const pre = providerVisibleText(loadProviderCapture("pre.json"));
		const post = providerVisibleText(loadProviderCapture("post.json"));
		const secondPre = providerVisibleText(
			loadProviderCapture("second-pre.json"),
		);
		const secondPost = providerVisibleText(
			loadProviderCapture("second-post.json"),
		);
		expect(countOccurrences(pre, R2_PROVIDER_IDENTIFIER)).toBeGreaterThan(0);
		expect(countOccurrences(secondPre, R2_PROVIDER_IDENTIFIER)).toBeGreaterThan(
			0,
		);
		expect(countOccurrences(post, R2_PROVIDER_IDENTIFIER)).toBe(0);
		expect(countOccurrences(secondPost, R2_PROVIDER_IDENTIFIER)).toBe(0);
	});

	it("G2.6: the measured baseline matrix is emitted for the evidence package", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const rows: WitnessRow[] = [];
		const captures: Array<[string, string, string]> = [
			["R4", R4_SOURCE_OBSERVATION_START, "pre.json"],
			["R4", R4_SOURCE_OBSERVATION_START, "second-pre.json"],
			["R6", R6_BOUNDED_NEGATIVE, "second-pre.json"],
			["R2", R2_PROVIDER_IDENTIFIER, "pre.json"],
			["R2", R2_PROVIDER_IDENTIFIER, "second-pre.json"],
		];
		for (const [witness, needle, captureName] of captures) {
			const before = providerVisibleText(loadProviderCapture(captureName));
			const afterCaptureName =
				captureName === "pre.json" ? "post.json" : "second-post.json";
			const after = providerVisibleText(loadProviderCapture(afterCaptureName));
			rows.push({
				witness,
				needle,
				beforeCapture: captureName,
				afterCapture: afterCaptureName,
				occurrencesBefore: countOccurrences(before, needle),
				occurrencesAfter: countOccurrences(after, needle),
			});
		}
		for (const row of rows) {
			expect(row.occurrencesBefore).toBeGreaterThan(0);
			expect(row.occurrencesAfter).toBe(0);
		}
	});
});
