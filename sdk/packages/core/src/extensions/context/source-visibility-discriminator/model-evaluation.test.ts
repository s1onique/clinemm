/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * G6.2 — the model-generation evaluation.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement suite.
 * ============================================================================
 *
 * WHAT THIS SUITE MEASURES
 * -----------------------
 *
 * It runs the ACT's OWN controlled model output (the REAL model response,
 * captured operator-locally) through the ACT's OWN trust and selection
 * gates, and asserts the three semantic outcomes the ACT's exit criteria
 * name:
 *
 *   R4  The model publishes BOTH observed startup operations, does NOT
 *       certify configuration drift, and preserves the evidence
 *       provenance limitations.
 *
 *   R2  The model identifies the concrete provider implementation(s) that
 *       were VISIBLE TO IT, preserves the incomplete-investigation status,
 *       and does NOT invent timeout or breaker guarantees.
 *
 *   R6  The model publishes a bounded negative observation ONLY where
 *       non-private evidence supports it, does NOT assert global absence,
 *       and does NOT reproduce a private reasoning block.
 *
 * AND IT MEASURES THE OVER-CLAIM
 * -----------------------------
 *
 * The model claimed `runtime_verified` on several records. The trust gate
 * MUST downgrade every one of them, because no runtime established the
 * SEMANTIC support of a model-authored statement.
 *
 * The suite is SELF-SKIPPING when the operator-local model output is
 * absent. The raw model output is NEVER committed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalSourceMessages } from "../../../session/models/session-compaction";
import {
	loadCanonicalTranscript,
	privateCapturesAvailable,
} from "./discriminator.fixture";
import type { SelectableRecord } from "./selection";
import {
	estimateRecordTokens,
	MAX_SELECTED_RECORDS,
	selectRecords,
} from "./selection";
import type { ResolvedEvidenceReference } from "./trust";
import { boundAssurance, resolveEvidenceReference } from "./trust";

/**
 * The operator-local root of THIS ACT's controlled model output.
 */
function generatedRoot(): string {
	return join(
		process.cwd(),
		"..",
		"..",
		"..",
		"tmp",
		"pck-src-vis-private",
		"1795466566666_uzla2",
	);
}

interface GeneratedCheckpoint {
	readonly boundary: string;
	readonly sourceMessageCount: number;
	readonly providerId: string;
	readonly modelId: string;
	readonly latencyMs: number;
	readonly inputChars: number;
	readonly rawResponseChars: number;
	readonly rawResponseSha256: string;
	readonly document: { readonly records: readonly SelectableRecord[] };
}

function loadGenerated(boundary: 1 | 2): GeneratedCheckpoint | undefined {
	const path = join(generatedRoot(), `checkpoint-boundary-${boundary}.json`);
	if (!existsSync(path)) {
		return undefined;
	}
	return JSON.parse(readFileSync(path, "utf8")) as GeneratedCheckpoint;
}

/**
 * The canonical prefix for a boundary.
 */
function canonicalPrefix(count: number) {
	const transcript = loadCanonicalTranscript();
	const canonical = canonicalSourceMessages(transcript.messages);
	return canonical.slice(0, count) as never;
}

/**
 * The resolved references for every record.
 */
function resolveAll(
	records: readonly SelectableRecord[],
	canonicalMessages: never,
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
 * The concatenated text of a record set.
 *
 * It is used only inside assertions; it is never written to an artifact.
 */
function textOf(records: readonly SelectableRecord[]): string {
	return records.map((record) => record.statement).join("\n");
}

describe("ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01 — G6 model evaluation", () => {
	it("G6.2 R4: the model publishes BOTH observed startup operations WITHOUT certifying configuration drift", () => {
		const generated = loadGenerated(1);
		if (!generated || !privateCapturesAvailable()) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const records = generated.document.records;
		const text = textOf(records);
		// BOTH observed operations are published.
		expect(text).toContain("kc.sh build");
		expect(text).toContain("start --optimized");
		// The configuration-drift allegation is NOT certified as a fact.
		// It appears only as a QUALIFIED, unresolved matter.
		const driftClaims = records.filter((record) =>
			/configuration drift|mixed builds/i.test(record.statement),
		);
		for (const record of driftClaims) {
			// Every record that mentions drift must qualify it, not assert it.
			expect(record.status).toBe("unresolved");
			expect(record.qualifications.length).toBeGreaterThan(0);
		}
		// The R4 record itself is UNRESOLVED at boundary 1.
		const r4 = records.find((record) => /^r4/i.test(record.id));
		expect(r4).toBeDefined();
		expect(r4?.status).toBe("unresolved");
		expect(r4?.qualifications.length).toBeGreaterThan(0);
	});

	it("G6.2 R2: the model publishes the concrete inspected implementation and preserves the INCOMPLETE status", () => {
		const generated = loadGenerated(2);
		if (!generated || !privateCapturesAvailable()) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const records = generated.document.records;
		const r2 = records.find((record) => /^r2/i.test(record.id));
		expect(r2).toBeDefined();
		const text = r2?.statement ?? "";
		// The CONCRETE inspected implementation is published.
		expect(text).toMatch(/MTS|Megafon/i);
		expect(text).toMatch(/3-second|3s|three/i);
		expect(text).toMatch(/10-second|10s|ten/i);
		// The circuit-breaker / fallback picture is published as a
		// CONTRAST, not as a guarantee.
		expect(text).toMatch(/circuit breaker/i);
		// The INCOMPLETE-investigation status is preserved.
		expect(r2?.qualifications.length).toBeGreaterThan(0);
		expect(r2?.qualifications.join(" ")).toMatch(
			/not established|not reconciled|remain|unknown|not supported/i,
		);
		// It does NOT certify that the risk is absent.
		expect(r2?.statement).not.toMatch(
			/(proves|no risk|is safe|risk is eliminated)/i,
		);
	});

	it("G6.2 R6: the model publishes a BOUNDED negative and does NOT assert global absence", () => {
		const generated = loadGenerated(2);
		if (!generated || !privateCapturesAvailable()) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const records = generated.document.records;
		const r6 = records.find((record) => /^R6/i.test(record.id));
		expect(r6).toBeDefined();
		const text = r6?.statement ?? "";
		// The bounded negative IS published: an application-level absence
		// was observed.
		expect(text).toMatch(
			/no application-level|not found|no .*DELETE|returned no/i,
		);
		// It does NOT assert GLOBAL absence.
		expect(text).not.toMatch(
			/(there is no|no such mechanism exists|does not exist anywhere|never purged)/i,
		);
		// And it carries the explicit scope limitation.
		expect(r6?.qualifications.join(" ")).toMatch(
			/not proof|not absence of|remain unknown|not established|bounded|inspected/i,
		);
	});

	it("G6.2 R6 (boundary 1): the bounded negative is published with its scope limitation", () => {
		const generated = loadGenerated(1);
		if (!generated || !privateCapturesAvailable()) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const records = generated.document.records;
		const r6 = records.find((record) => /^r6/i.test(record.id));
		expect(r6).toBeDefined();
		expect(r6?.qualifications.join(" ")).toMatch(
			/not found in the paths|not proof|inspected/i,
		);
	});

	it("G6.2 OVER-CLAIM: every model-claimed runtime_verified is DOWNGRADED by the trust gate", () => {
		for (const boundary of [1, 2] as const) {
			const generated = loadGenerated(boundary);
			if (!generated || !privateCapturesAvailable()) {
				expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
				return;
			}
			const canonical = canonicalPrefix(generated.sourceMessageCount);
			const records = generated.document.records;
			const resolved = resolveAll(records, canonical);
			let overClaims = 0;
			for (const record of records) {
				const bounded = boundAssurance({
					claimed: record.assurance,
					resolved: resolved.get(record.id) ?? [],
				});
				if (record.assurance === "runtime_verified") {
					overClaims += 1;
					// The model claimed runtime_verified. The gate MUST
					// refuse it.
					expect(bounded).not.toBe("runtime_verified");
				}
			}
			// The measurement is only meaningful if there WAS an over-claim.
			expect(overClaims).toBeGreaterThan(0);
		}
	});

	it("G6.3: the cost receipt is captured and the selection stays within budget", () => {
		for (const boundary of [1, 2] as const) {
			const generated = loadGenerated(boundary);
			if (!generated || !privateCapturesAvailable()) {
				expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
				return;
			}
			const canonical = canonicalPrefix(generated.sourceMessageCount);
			const records = generated.document.records;
			const resolved = resolveAll(records, canonical);
			const treatment = selectRecords({
				records,
				resolvedByRecord: resolved,
				ruleApplied: true,
			});
			expect(treatment.selected.length).toBeLessThanOrEqual(
				MAX_SELECTED_RECORDS,
			);
			expect(treatment.estimatedTokens).toBeLessThanOrEqual(1_500);
			// The latency and input size are recorded.
			expect(generated.latencyMs).toBeGreaterThan(0);
			expect(generated.inputChars).toBeGreaterThan(0);
			// The estimated tokens of the projected section.
			expect(estimateRecordTokens(treatment.selected)).toBeLessThanOrEqual(
				1_500,
			);
		}
	});

	it("G6.3.2: the GENERIC selection retains every witness record and stays within budget", () => {
		const generated = loadGenerated(2);
		if (!generated || !privateCapturesAvailable()) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const canonical = canonicalPrefix(generated.sourceMessageCount);
		const records = generated.document.records;
		const resolved = resolveAll(records, canonical);
		const treatment = selectRecords({
			records,
			resolvedByRecord: resolved,
			ruleApplied: true,
		});
		const treatmentIds = treatment.selected.map((record) => record.id);
		// The R4 and R6 records are PUBLISHED by the model (they are
		// observations now, not open questions), and the generic selector
		// must carry them into the projection.
		//
		// NOTE ON THE CONTROL ARM: with THIS output the model emitted 16
		// records and R4/R6 sit at indices 5 and 7, so the first-12
		// control happens to keep them too. The historical 20-record
		// output is where the control genuinely discarded them, and that
		// discrimination is measured in `selection.test.ts`. This suite
		// therefore asserts only what is true for THIS output: the
		// treatment carries the witnesses, and it does so under the
		// generic rule without any record-specific priority.
		const r4 = records.find((record) => /^R4/i.test(record.id));
		const r6 = records.find((record) => /^R6/i.test(record.id));
		expect(r4).toBeDefined();
		expect(r6).toBeDefined();
		expect(treatmentIds).toContain(r4?.id);
		expect(treatmentIds).toContain(r6?.id);
	});
});
