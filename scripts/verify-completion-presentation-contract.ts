/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01
 *
 * DETERMINISTIC GENERATOR for the seven-claim coverage report.
 *
 * It runs the ACTUAL executable witness suite and derives every reported
 * result from the OBSERVED test outcome — never from a static declaration.
 * The script:
 *
 *   1. runs `vitest run` on the witness suite;
 *   2. parses the per-claim witness outcomes from the reporter output;
 *   3. builds the coverage report through the pure registry
 *      (`completion-presentation-contract.ts`);
 *   4. writes the machine-readable TSV and the Markdown rendering next to
 *      the other ACT artifacts;
 *   5. exits non-zero if any eligible claim is not PASS.
 *
 * The report therefore CANNOT overstate coverage: a claim whose witness did
 * not run (or failed) is reported as FAIL / UNVERIFIED, and the gate fails.
 *
 * USAGE:
 *   bun scripts/verify-completion-presentation-contract.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildCompletionPresentationCoverageReport,
	COMPLETION_PRESENTATION_CLAIMS,
	type CompletionPresentationResult,
	renderCompletionPresentationCoverageReportMarkdown,
	renderCompletionPresentationCoverageReportTsv,
} from "../apps/vscode/src/sdk/completion-presentation-contract";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const witnessSuite =
	"src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts";
const outDir = resolve(
	repoRoot,
	"docs/acts/ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01",
);

/**
 * The claim -> vitest test-name prefixes. A claim is PASS only when EVERY
 * one of its witness cases ran and passed.
 */
const CLAIM_WITNESS_CASES: Readonly<Record<string, readonly string[]>> = {
	"P-01": [
		"P-01: content_start publishes a partial completion row with NO authority marker",
	],
	"P-02": [
		"P-02 (LIVE path): content_end finalizes the row WITHOUT the authority marker",
		"P-02 (RESTORATION path): the marker is recovered ONLY from a verified persisted completion identity",
	],
	"P-03": [
		"P-03 (owned running job): the BCB filter removes the completion row from the published set",
		"P-03 (held terminal observation): the BCB filter removes the completion row",
		"P-03 (foreign-session observation): a foreign held observation neither HOLDs nor RELEASEs this task's completion",
		"P-03 (BCB is NOT Elm authorization): an Elm HOLD leaves the row visible but non-authoritative",
	],
	"P-04": [
		"P-04 (modern SDK): the badge requires the authoritative marker",
		"P-04 (plan mode): no badge in plan mode, even for a marked row",
		"P-04 (legacy ask fallback): the independently established legacy conditions are preserved",
		"P-04 (phase transition): a HISTORICAL marked row keeps its badge while a newer turn streams",
	],
	"P-05": [
		"P-05: the same-ts promotion updates the row in place in BOTH the host store and the webview replica",
	],
	"P-06": [
		"P-06 (immediate path): authority -> effect request -> observed commit -> promotion, then ONE authoritative row",
		"P-06 (deferred path): the EXISTING row is promoted after the deferred C10 commits",
		"P-06 (HOLD): an Elm HOLD produces NO current-turn authoritative marker",
		"P-06 (Elm FAILURE): an Elm failure produces NO current-turn authoritative marker",
	],
	"P-07": [
		"P-07 (committed): the restored row RETAINs the authority marker",
		"P-07 (held): the restored row does NOT acquire a marker",
		"P-07 (historical identity): a historical committed completion is NOT overwritten by a newer turn",
		"P-07 (legacy semantics unchanged): the legacy trailing ask row is still emitted",
	],
};

/** The negative witnesses — reported separately from the seven claims. */
const NEGATIVE_WITNESS_CASES: readonly string[] = [
	"NEG-01: the conformance assertion DETECTS a marker stamped before the C10 commit (RED on the mutant, GREEN on production)",
	"NEG-02: a stale (older-epoch) promotion is NOT treated as the current turn's authority",
	"NEG-03: a failed marker publication is NOT recorded as a successful promotion",
];

interface VitestOutcome {
	readonly name: string;
	readonly status: "passed" | "failed" | "skipped";
}

/**
 * Parse the vitest JSON reporter output.
 *
 * The reporter is invoked with `--reporter=json --outputFile=<path>`, so
 * the file is a single JSON document with `testResults[].assertionResults[]`.
 */
function parseVitestJson(json: string): VitestOutcome[] {
	const parsed = JSON.parse(json) as {
		testResults?: {
			assertionResults?: {
				fullName?: string;
				title?: string;
				status?: string;
			}[];
		}[];
	};
	const outcomes: VitestOutcome[] = [];
	for (const file of parsed.testResults ?? []) {
		for (const assertion of file.assertionResults ?? []) {
			const name = assertion.fullName ?? assertion.title ?? "";
			const raw = (assertion.status ?? "").toLowerCase();
			outcomes.push({
				name,
				status:
					raw === "passed"
						? "passed"
						: raw === "skipped" || raw === "pending"
							? "skipped"
							: "failed",
			});
		}
	}
	return outcomes;
}

async function runWitnessSuite(): Promise<{
	outcomes: VitestOutcome[];
	exitCode: number;
}> {
	const outFile = resolve(
		repoRoot,
		".tmp-completion-presentation-contract-vitest.json",
	);
	const proc = Bun.spawn(
		[
			"bun",
			"x",
			"vitest",
			"run",
			"--config",
			"vitest.config.ts",
			"--reporter=json",
			`--outputFile=${outFile}`,
			witnessSuite,
		],
		{
			cwd: resolve(repoRoot, "apps/vscode"),
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, CI: "1", NO_COLOR: "1" },
		},
	);
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	let outcomes: VitestOutcome[] = [];
	try {
		const json = await Bun.file(outFile).text();
		outcomes = parseVitestJson(json);
	} catch {
		// Fall through: the empty outcome list makes every claim UNVERIFIED.
	}
	if (outcomes.length === 0) {
		process.stderr.write(
			`vitest reporter produced no outcomes.\n${stdout}\n${stderr}\n`,
		);
	}
	return { outcomes, exitCode };
}

const { outcomes, exitCode } = await runWitnessSuite();

const results: Record<string, CompletionPresentationResult> = {};
for (const [claimId, cases] of Object.entries(CLAIM_WITNESS_CASES)) {
	let sawFailure = false;
	let sawAll = true;
	for (const caseName of cases) {
		const outcome = outcomes.find(
			(o) => o.name === caseName || o.name.endsWith(caseName),
		);
		if (!outcome) {
			sawAll = false;
			continue;
		}
		if (outcome.status !== "passed") {
			sawFailure = true;
		}
	}
	if (sawFailure) {
		results[claimId] = "FAIL";
	} else if (sawAll) {
		results[claimId] = "PASS";
	} else {
		results[claimId] = "UNVERIFIED";
	}
}

const negativeResults = NEGATIVE_WITNESS_CASES.map((caseName) => {
	const outcome = outcomes.find(
		(o) => o.name === caseName || o.name.endsWith(caseName),
	);
	return { caseName, status: outcome?.status ?? ("failed" as const) };
});

const report = buildCompletionPresentationCoverageReport(results);

mkdirSync(outDir, { recursive: true });
writeFileSync(
	resolve(outDir, "coverage-report.tsv"),
	renderCompletionPresentationCoverageReportTsv(report),
);
writeFileSync(
	resolve(outDir, "coverage-report.md"),
	renderCompletionPresentationCoverageReportMarkdown(report),
);

// ---------------------------------------------------------------------------
// The source-bound ASSERTION INVENTORY.
//
// It is DERIVED from the same claim registry and the same EXECUTED test
// outcomes as the coverage report, so it can never drift from the suite
// that actually ran. One row per witness case (a claim may have several).
// ---------------------------------------------------------------------------
const INVENTORY_HEADER = [
	"claim_id",
	"kind",
	"production_symbol",
	"production_file",
	"observed_boundary",
	"witness",
	"test_name",
	"evidence_level",
	"result",
];
const inventoryRows: string[] = [INVENTORY_HEADER.join("\t")];
for (const [claimId, cases] of Object.entries(CLAIM_WITNESS_CASES)) {
	const claim = COMPLETION_PRESENTATION_CLAIMS.find(
		(c) => c.claim_id === claimId,
	);
	if (!claim) continue;
	const productionFiles = [
		...claim.production_symbol.matchAll(/apps\/vscode\/[^\s|#]+/g),
	].map((m) => m[0]);
	for (const caseName of cases) {
		const outcome = outcomes.find(
			(o) => o.name === caseName || o.name.endsWith(caseName),
		);
		const status = outcome?.status ?? "failed";
		inventoryRows.push(
			[
				claim.claim_id,
				claim.kind,
				claim.production_symbol,
				productionFiles.join(" | "),
				claim.observed_boundary,
				claim.witness,
				caseName,
				claim.evidence_level,
				status === "passed"
					? "PASS"
					: status === "skipped"
						? "UNVERIFIED"
						: "FAIL",
			].join("\t"),
		);
	}
}
for (const caseName of NEGATIVE_WITNESS_CASES) {
	const outcome = outcomes.find(
		(o) => o.name === caseName || o.name.endsWith(caseName),
	);
	const status = outcome?.status ?? "failed";
	inventoryRows.push(
		[
			"NEG",
			"NEGATIVE_WITNESS",
			"see the test name",
			"apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts",
			"negative witness boundary",
			"apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts",
			caseName,
			"REAL_PRODUCTION_SEAM",
			status === "passed"
				? "PASS"
				: status === "skipped"
					? "UNVERIFIED"
					: "FAIL",
		].join("\t"),
	);
}
writeFileSync(
	resolve(outDir, "assertion-inventory.tsv"),
	`${inventoryRows.join("\n")}\n`,
);

console.log(renderCompletionPresentationCoverageReportMarkdown(report));
console.log("");
console.log("negative witnesses:");
for (const n of negativeResults) {
	console.log(`  ${n.status === "passed" ? "PASS" : "FAIL"}  ${n.caseName}`);
}
console.log("");
console.log(
	`witness suite exit code: ${exitCode}; eligible claims: ${report.eligible_claims}; executable (PASS): ${report.executable_claims}; failed: ${report.failed_claims}; gaps: ${report.gap_claims}`,
);

const anyClaimFailed = report.failed_claims > 0 || report.gap_claims > 0;
const anyNegativeFailed = negativeResults.some((n) => n.status !== "passed");
if (anyClaimFailed || anyNegativeFailed || exitCode !== 0) {
	console.error("FAIL completion-presentation-contract: see the report above.");
	process.exit(1);
}
console.log(
	"PASS completion-presentation-contract: all seven claims have executable, executed evidence.",
);
