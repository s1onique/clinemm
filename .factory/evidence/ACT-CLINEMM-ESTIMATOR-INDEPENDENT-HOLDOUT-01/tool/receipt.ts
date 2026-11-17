/**
 * ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01 — test receipt writer.
 *
 * The receipt records the ACTUALLY executed test commands and their
 * observed outcomes. It is written by the same runner that produced the
 * other artifacts so that the receipt and the artifacts share one run.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACT, OUTPUT_DIR, writeArtifact } from "./holdout";

export interface TestCommandRecord {
	readonly command: string;
	readonly result: string;
	readonly observed: string;
}

export interface HistoricalTestEvidence {
	readonly kind: "HISTORICAL_TEST_EVIDENCE";
	readonly command: string;
	readonly result: string;
	readonly observed: string;
	readonly note: string;
}

/**
 * The test evidence that was ACTUALLY executed for the ORIGINAL
 * evidence-discovery run of 2d5f8c00c.
 *
 * CORRECTION01: this list is HISTORICAL evidence. It is NOT re-claimed by
 * every subsequent run. A fresh evaluation that does not execute these
 * commands MUST NOT present them as its own.
 */
export const HISTORICAL_TEST_EVIDENCE: readonly HistoricalTestEvidence[] = Object.freeze([
	Object.freeze({
		kind: "HISTORICAL_TEST_EVIDENCE" as const,
		command:
			"bun test ./.factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/tool/analyze.test.ts",
		result: "PASS",
		observed: "16 pass, 0 fail, 24 expect() calls; pre-existing witnesses T1-T16",
		note: "Executed for commit 2d5f8c00c (the evidence-discovery run).",
	}),
	Object.freeze({
		kind: "HISTORICAL_TEST_EVIDENCE" as const,
		command: "bun test ./.factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/holdout.test.ts",
		result: "PASS",
		observed: "12 pass, 0 fail, 76 expect() calls; focused witnesses V1-V12",
		note: "Executed for commit 2d5f8c00c (the evidence-discovery run).",
	}),
	Object.freeze({
		kind: "HISTORICAL_TEST_EVIDENCE" as const,
		command:
			"bun test ./.factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/tool/analyze.test.ts ./.factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/holdout.test.ts",
		result: "PASS",
		observed: "28 pass, 0 fail, 100 expect() calls across 2 files",
		note: "Executed for commit 2d5f8c00c (the evidence-discovery run).",
	}),
	Object.freeze({
		kind: "HISTORICAL_TEST_EVIDENCE" as const,
		command:
			"ENTRY_HEAD=$(git rev-parse HEAD) TOOL_SHA256=$(shasum -a 256 .factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/holdout.ts) bun .factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/run.ts",
		result: "PASS",
		observed:
			"2 discovered trace exports, both the training session (identical SHA-256); independence reasonCode DUPLICATE_EXPORT_SAME_SESSION; 0 eligible holdout attempts; verdict AWAITING_INDEPENDENT_DOGFOOD_SESSION",
		note: "Executed for commit 2d5f8c00c (the evidence-discovery run).",
	}),
	Object.freeze({
		kind: "HISTORICAL_TEST_EVIDENCE" as const,
		command:
			"git diff --stat HEAD -- .factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/",
		result: "PASS",
		observed:
			"empty diff — the previous ACT's committed calibration artifacts are byte-identical and untouched by this ACT (witness V7)",
		note: "Executed for commit 2d5f8c00c (the evidence-discovery run).",
	}),
]);

/**
 * Build the test receipt.
 *
 * ## CORRECTION01 (P0-3) — never claim an unexecuted test
 *
 * `commands` holds ONLY the test commands that the CURRENT invocation
 * actually executed. The runner executes no test suite by itself, so a
 * normal evaluation run records an EMPTY `commands` list and says so. The
 * previously executed evidence is preserved separately under
 * `historicalTestEvidence`, clearly labelled, so a stale receipt can never
 * masquerade as a fresh one.
 */
export function buildTestReceipt(
	sourceHead: string,
	toolSha256: string,
	executedCommands: readonly TestCommandRecord[],
	extra: Record<string, unknown> = {},
): {
	schema: string;
	act: string;
	toolVersion: string;
	sourceHead: string;
	toolSha256: string;
	commands: readonly TestCommandRecord[];
	historicalTestEvidence: readonly HistoricalTestEvidence[];
	evaluation: Record<string, unknown>;
	[key: string]: unknown;
} {
	const { evaluation: evaluationExtra, ...restExtra } = extra;
	return {
		schema: `cline.${ACT}.test-receipt.v1`,
		act: ACT,
		toolVersion: "offline-independent-holdout.v1",
		sourceHead,
		toolSha256,
		commands: executedCommands,
		historicalTestEvidence: HISTORICAL_TEST_EVIDENCE,
		...restExtra,
		evaluation: {
			kind: "FRESH_EVALUATION",
			note: "This run evaluated traces; it executed NO test suite. `commands` is therefore empty. The test evidence below belongs to earlier runs and is labelled as historical.",
			...(typeof evaluationExtra === "object" && evaluationExtra !== null ? evaluationExtra : {}),
		},
	};
}

/**
 * Write the test receipt artifact.
 */
export function writeTestReceipt(
	sourceHead: string,
	toolSha256: string,
	executedCommands: readonly TestCommandRecord[],
	extra: Record<string, unknown> = {},
): { path: string; sha256: string; bytes: number } {
	return writeArtifact("test-receipt.json", buildTestReceipt(sourceHead, toolSha256, executedCommands, extra));
}



/**
 * Write the ONE authoritative artifact hash manifest.
 *
 * The manifest lists every committed artifact of THIS ACT except the
 * manifest itself (a file cannot contain its own hash). There is no
 * recursive or duplicated hash bookkeeping: exactly one manifest, one
 * entry per artifact.
 */
export function writeArtifactHashManifest(
	sourceHead: string,
): { path: string; sha256: string; bytes: number } {
	const names = readdirSync(OUTPUT_DIR)
		.filter((name) => name !== "artifact-hashes.json")
		.filter((name) => statSync(join(OUTPUT_DIR, name)).isFile())
		.filter((name) => name.endsWith(".json") || name.endsWith(".md"))
		.sort();

	const toolDir = join(OUTPUT_DIR, "tool");
	const toolNames = readdirSync(toolDir)
		.filter((name) => statSync(join(toolDir, name)).isFile())
		.sort();

	const hashOf = (path: string) => {
		const bytes = readFileSync(path);
		return {
			sha256: createHash("sha256").update(bytes).digest("hex"),
			bytes: bytes.byteLength,
		};
	};

	return writeArtifact("artifact-hashes.json", {
		schema: `cline.${ACT}.artifact-hashes.v1`,
		act: ACT,
		sourceHead,
		hashes: [
			...names.map((name) => {
				const path = join(OUTPUT_DIR, name);
				return { name, ...hashOf(path) };
			}),
			...toolNames.map((name) => {
				const path = join(toolDir, name);
				return { name: `tool/${name}`, ...hashOf(path) };
			}),
		],
	});
}

