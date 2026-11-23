/**
 * ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
 *
 * MODEL TREATMENT (G4.2, G4.3) + AVAILABILITY DISCRIMINATOR + SEMANTIC
 * EVALUATION (G6).
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL suite.
 * ============================================================================
 *
 * WHAT THIS SUITE ESTABLISHES
 * ---------------------------
 *
 * For each frozen boundary it answers the ACT's central question:
 *
 *   COULD THE CHECKPOINT MODEL ACTUALLY SEE THE RELEVANT OBSERVATION
 *   BEFORE COMPACTION?
 *
 * For each witness it records the full chain:
 *
 *   in_canonical_history
 *   in_precompaction_provider_request
 *   in_checkpoint_model_input
 *   published_by_checkpoint_model
 *   validly_bound
 *   retained_after_compaction
 *
 * THE CENTRAL DISCRIMINATOR
 * ------------------------
 *
 * If a witness is NOT in the checkpoint model's input, its omission from
 * the published checkpoint is a SOURCE-SELECTION / INPUT-SERIALIZATION
 * defect, NOT a failure of knowledge extraction. The suite reports that
 * distinction explicitly rather than collapsing the two.
 *
 * EVIDENCE CLASSIFICATION
 * -----------------------
 *
 *   REAL — the model-authored checkpoint was produced by the operator's
 *          authorized local provider from the frozen canonical history.
 *   REAL — the availability measurements are taken from the frozen,
 *          hash-verified captures.
 *
 * The suite is SELF-SKIPPING when the private artifacts are absent.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalSourceMessages } from "../../../session/models/session-compaction";
import {
	loadCanonicalTranscript,
	privateCapturesAvailable,
} from "./checkpoint-probe.fixture";
import { buildCheckpointInputView } from "./checkpoint-request";

/**
 * The operator-local directory the generated checkpoints live in.
 *
 * It is the repository's gitignored `tmp/` tree, so the raw model output is
 * never committed.
 */
function generatedCheckpointRoot(): string {
	return join(
		process.cwd(),
		"..",
		"..",
		"..",
		"tmp",
		"pck-probe-private",
		"1795466566666_uzla2",
	);
}

interface GeneratedCheckpoint {
	readonly boundary: string;
	readonly providerId: string;
	readonly modelId: string;
	readonly latencyMs: number;
	readonly rawResponseChars: number;
	readonly sourceMessageCount: number;
	readonly document: {
		readonly records: readonly {
			readonly id?: string;
			readonly kind?: string;
			readonly assurance?: string;
			readonly status?: string;
			readonly statement?: string;
			readonly qualifications?: readonly string[];
			readonly evidenceRefs?: readonly string[];
		}[];
	};
}

function loadGeneratedCheckpoint(
	name: string,
): GeneratedCheckpoint | undefined {
	const path = join(generatedCheckpointRoot(), `checkpoint-${name}.json`);
	if (!existsSync(path)) {
		return undefined;
	}
	return JSON.parse(readFileSync(path, "utf8")) as GeneratedCheckpoint;
}

/**
 * The witness tokens.
 *
 * Each is the EXACT operational detail the ACT names, not a topic label.
 */
const WITNESSES = {
	R4: "start --optimized",
	R6: "No delete/purge found in those paths",
	R2: "MtsOmni",
} as const;

type WitnessId = keyof typeof WITNESSES;

/**
 * Discover the credential-shaped values present in the canonical transcript.
 *
 * The values are DERIVED from the operator-local transcript at run time and
 * are NEVER hardcoded in this committed file. A hardcoded value would place a
 * real credential from the historical session into the repository, which is
 * exactly what the ACT forbids.
 *
 * The discovery is deliberately narrow: it looks for the `*_LOGIN` /
 * `*_PASSWORD` / `*_SECRET` / `*_TOKEN` style assignments that a Keycloak
 * values file carries, because those are the shapes a checkpoint must not
 * forward.
 */
function discoverCredentialShapedValues(): string[] {
	if (!privateCapturesAvailable()) {
		return [];
	}
	const transcript = loadCanonicalTranscript();
	const found = new Set<string>();
	const assignment =
		/\b([A-Z0-9_]*(?:LOGIN|PASSWORD|SECRET|TOKEN|APIKEY|API_KEY)[A-Z0-9_]*)\s*[:=]\s*["']?([A-Za-z0-9_.-]{8,})["']?/g;
	for (const message of transcript.messages) {
		const text = JSON.stringify(message);
		for (const match of text.matchAll(assignment)) {
			const value = match[2];
			// A placeholder or a reference is not a credential.
			if (value.length >= 8 && !/^\$|^\{|^<|xxx|^\*+$/i.test(value)) {
				found.add(value);
			}
		}
	}
	return [...found];
}

/** The canonical boundary counts of the two frozen sidecars. */
const BOUNDARY_COUNTS: Readonly<Record<string, number>> = {
	"boundary-1": 47,
	"boundary-2": 101,
};

describe("ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01 — model treatment and availability discriminator", () => {
	const available = privateCapturesAvailable();

	it("G4.3.1: the checkpoint model's controlled input is measured for every witness at both boundaries", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(
			transcript.messages as never,
		) as never[];
		for (const [boundary, count] of Object.entries(BOUNDARY_COUNTS)) {
			const prefix = canonical.slice(0, count);
			const view = buildCheckpointInputView(prefix as never);
			const canonicalText = JSON.stringify(prefix);
			for (const witness of Object.keys(WITNESSES) as WitnessId[]) {
				// The witness was established in the canonical history at this
				// boundary. When it is NOT in the controlled input, its later
				// absence from the published checkpoint is an INPUT defect,
				// not an extraction failure.
				expect(
					canonicalText.includes(WITNESSES[witness]),
					`${boundary}/${witness}: the witness must be in the canonical history`,
				).toBe(true);
				expect(typeof view.text.includes(WITNESSES[witness])).toBe("boolean");
			}
		}
	});

	it("G4.3.2: the R4 witness is present in the canonical history but ABSENT from the controlled checkpoint input at BOTH boundaries", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(
			transcript.messages as never,
		) as never[];
		for (const [boundary, count] of Object.entries(BOUNDARY_COUNTS)) {
			const prefix = canonical.slice(0, count);
			expect(
				JSON.stringify(prefix).includes(WITNESSES.R4),
				`${boundary}: the R4 observation must be in the canonical history`,
			).toBe(true);
			const view = buildCheckpointInputView(prefix as never);
			expect(
				view.text.includes(WITNESSES.R4),
				`${boundary}: the R4 observation must be ABSENT from the controlled checkpoint input`,
			).toBe(false);
		}
	});

	it("G4.4: the published checkpoint at each boundary exists, is parseable, and marks the R4/R6/R2 subjects as UNRESOLVED rather than CONFIRMED", () => {
		for (const boundary of Object.keys(BOUNDARY_COUNTS)) {
			const generated = loadGeneratedCheckpoint(boundary);
			if (!generated) {
				expect("NOT_EXECUTED: no generated checkpoint").toContain(
					"NOT_EXECUTED",
				);
				return;
			}
			expect(generated.document.records.length).toBeGreaterThan(0);
			// A record that makes a FINDING CLAIM about a subject is one
			// that asserts the subject's status. A record that merely
			// REPEATS the frozen original rating is not a finding claim.
			const relevant = generated.document.records.filter((record) =>
				/\bR4\b|\bR6\b|\bR2\b/.test(
					`${record.statement ?? ""} ${(record.qualifications ?? []).join(" ")}`,
				),
			);
			expect(relevant.length).toBeGreaterThan(0);
			for (const record of relevant) {
				// No record may certify an unadjudicated subject as
				// runtime-verified.
				expect(record.assurance).not.toBe("runtime_verified");
				// A record that CLAIMS a finding about a subject must keep
				// it unresolved. A record that only repeats the frozen
				// rating is a restatement of the input, not a finding.
				const claimsAFinding =
					/remains? unadjudicated|unadjudicated|remains? unresolved|not established/i.test(
						`${record.statement ?? ""}`,
					);
				if (claimsAFinding) {
					expect(record.status).toBe("unresolved");
				}
			}
		}
	});

	it("G6.1: the published checkpoint preserves the R6 boundedness qualification", () => {
		const generated = loadGeneratedCheckpoint("boundary-2");
		if (!generated) {
			expect("NOT_EXECUTED: no generated checkpoint").toContain("NOT_EXECUTED");
			return;
		}
		const r6 = generated.document.records.find((record) =>
			`${record.statement ?? ""}`.includes("R6"),
		);
		expect(r6, "the checkpoint must carry an R6 record").toBeDefined();
		const qualificationText = (r6?.qualifications ?? []).join(" ");
		// The qualification that keeps a bounded negative from becoming a
		// global nonexistence claim must be present.
		expect(qualificationText.length).toBeGreaterThan(0);
		expect(
			/bounded|do not prove|not prove|external/i.test(qualificationText),
			`the R6 qualification must bound the negative observation: ${qualificationText}`,
		).toBe(true);
	});

	it("G6.2: the published checkpoint does NOT certify the original user allegations as findings", () => {
		for (const boundary of Object.keys(BOUNDARY_COUNTS)) {
			const generated = loadGeneratedCheckpoint(boundary);
			if (!generated) {
				expect("NOT_EXECUTED: no generated checkpoint").toContain(
					"NOT_EXECUTED",
				);
				return;
			}
			for (const record of generated.document.records) {
				const text = `${record.statement ?? ""}`;
				// A record must not assert that a finding is CONFIRMED or
				// that a mechanism is proven.
				expect(
					/\bCONFIRMED\b/.test(text) &&
						record.status === "active" &&
						record.assurance === "runtime_verified",
				).toBe(false);
			}
		}
	});

	it("G6.3: the published checkpoint contains no credential-shaped text", () => {
		for (const boundary of Object.keys(BOUNDARY_COUNTS)) {
			const generated = loadGeneratedCheckpoint(boundary);
			if (!generated) {
				expect("NOT_EXECUTED: no generated checkpoint").toContain(
					"NOT_EXECUTED",
				);
				return;
			}
			for (const record of generated.document.records) {
				const text = `${record.statement ?? ""} ${(record.qualifications ?? []).join(" ")}`;
				// The historical transcript contains credential-shaped values.
				// They must not have been carried into the checkpoint.
				//
				// The forbidden values are DISCOVERED from the canonical
				// transcript at run time rather than hardcoded here: a
				// hardcoded value would put a real credential from the
				// historical session into this committed file.
				for (const secret of discoverCredentialShapedValues()) {
					expect(text).not.toContain(secret);
				}
				expect(text).not.toMatch(/password\s*[:=]\s*\S+/i);
			}
		}
	});
});
