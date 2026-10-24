/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01
 *
 * DETERMINISTIC GENERATOR for the Chart 01 claim coverage report.
 *
 * It runs the ACTUAL executable witness suite and derives every reported
 * result from the OBSERVED test outcome — never from a static declaration.
 * The script:
 *
 *   1. runs `vitest run` on the witness suite;
 *   2. parses the per-claim witness outcomes from the reporter output;
 *   3. builds the coverage report through the pure registry
 *      (`turn-phase-contract.ts`);
 *   4. writes the machine-readable TSV and the Markdown rendering next to
 *      the other ACT artifacts;
 *   5. exits non-zero if any eligible claim is not PASS.
 *
 * The report therefore CANNOT overstate coverage: a claim whose witness did
 * not run (or failed) is reported as FAIL / UNVERIFIED, and the gate fails.
 *
 * USAGE:
 *   bun scripts/verify-turn-phase-contract.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildTurnPhaseCoverageReport,
	TURN_PHASE_CLAIMS,
	type TurnPhaseResult,
	renderTurnPhaseCoverageReportMarkdown,
	renderTurnPhaseCoverageReportTsv,
} from "../apps/vscode/src/sdk/turn-phase-contract";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const witnessSuite = "src/sdk/__tests__/turn-phase-contract01.tpc01.test.ts";
const outDir = resolve(
	repoRoot,
	"docs/acts/ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01",
);

/**
 * The claim -> vitest test-name prefixes. A claim is PASS only when EVERY
 * one of its witness cases ran and passed.
 */
const CLAIM_WITNESS_CASES: Readonly<Record<string, readonly string[]>> = {
	"T-01": [
		"T-01: a pending_prompt_submitted event commits `streaming` with a strictly greater seq",
		"T-01 (authority): the tracker mutation is the authoritative host phase boundary and precedes listener notification",
	],
	"T-02": [
		"T-02 (authorized): the C10 commit publishes `completed` when the completion facts hold and Elm authorizes",
		"T-02 (Elm HOLD): an Elm HOLD suppresses the C10 commit entirely — no `completed` is committed",
		"T-02 (Elm FAILURE): an Elm failure suppresses the C10 commit entirely — no `completed` is committed",
		"T-02 (conservation): a turn WITHOUT a committed terminal response does NOT reach `completed`",
	],
	"T-03": [
		"T-03: a turn with no committed completion attempt commits `awaiting_followup`, never `completed`",
		"T-03 (user-action semantics): the `awaiting_followup` phase keeps the composer continuable",
	],
	"T-04": [
		"T-04: a turn that surfaced a provider error commits `error` through the provider-error writer",
		"T-04 (distinctness): the provider-error writer is NOT the BCB observation-unavailable writer",
	],
	"T-05": [
		"T-05: cancellation commits `resumable` and raises the fence BEFORE the publication",
		"T-05 (conservation): a cancellation never OVERWRITES an already-committed terminal phase",
	],
	"T-06": [
		"T-06: a turn-complete after a cancellation commits NO phase — `resumable` AND its seq are preserved",
		"T-06 (guard shape): the straggler guard is a SUPPRESSION — no phase write is recorded at all",
	],
	"T-07": [
		"T-07: a BCB-held obligation the resumed turn cannot observe commits `error` through the BCB writer",
		"T-07 (capability available): when the resumed turn CAN observe held results, the BCB writer does NOT fire",
	],
	"T-08": [
		"T-08 (T-08): from `awaiting_followup` a pending_prompt_submitted commits `streaming` with a greater seq",
		"T-08 (T-08a): from `completed` a pending_prompt_submitted commits `streaming` with a greater seq",
		"T-08 (T-08b): from `error` a pending_prompt_submitted commits `streaming` with a greater seq",
		"T-08 (T-08c): from `resumable` a pending_prompt_submitted commits `streaming` with a greater seq",
		"T-08 (grouping): the four source states are four DISTINCT runtime phases, not one slash-delimited phase",
	],
	"T-09": [
		"T-09 (labels): the REAL `stateLabel` maps all eight phases to their exact label/glyph/live triple",
		"T-09 (vocabulary): every canonical phase has a distinct label and the eight phases are all covered",
		"T-09 (authority): the production entry point reads the CANONICAL projection, not the legacy phase",
		"T-09 (host authority): the host-owned compaction override wins over the canonical shadow",
		"T-09 (shadow authority): the canonical shadow wins over the legacy phase when it is authoritative",
		"T-09 (legacy fallback): with no canonical observation the legacy phase is the authority",
		"T-09 (not a state): the TaskHeader label is a PROJECTION of the phase, not a lifecycle state",
	],
	"T-10": [
		"T-10: the production compaction path commits `compacting` while the divider is visible",
		"T-10 (not a human wait): the compaction phase is distinct from approval and follow-up",
	],
	"T-11": [
		"T-11: the terminal compaction event restores the phase that was current on entry",
		"T-11 (anchor): the entry anchor is preserved across the compaction window",
	],
	"T-12": [
		"T-12: a tool approval request commits `awaiting_approval` anchored on the approval ask",
	],
	"T-13": ["T-13: an ask_question commits `awaiting_followup` anchored on the ask message"],
	"T-14": [
		"T-14: resolving a pending approval commits `streaming` with the anchor cleared",
	],
};

/** The negative witnesses — reported separately from the claims. */
const NEGATIVE_WITNESS_CASES: readonly string[] = [
	"NEG-T01: an unauthorized completion after an Elm HOLD commits NO `completed` phase",
	"NEG-T02: a late `done` after a cancellation preserves `resumable` (controlled event ordering)",
	"NEG-T02 (legitimate resume): a NEW turn after the cancellation DOES advance to `streaming`",
	"NEG-T03: an older phase snapshot delivered after a newer one is REJECTED by the real webview reducer",
	"NEG-T04: a throwing tracker subscriber leaves the state committed and the subsequent subscriber runs",
	"NEG-T05 (baseline): the REAL Chart 01 document passes the strict association checker",
	"NEG-T05: a SWAPPED pair of edge labels is REJECTED as an ASSOCIATION mismatch",
	"NEG-T05 (guard claim): a GUARD / PROJECTION claim carrying an edge is REJECTED",
	"NEG-T05 (unauthorized completion): an edge into `completed` that is NOT the C10 commit is REJECTED",
	"NEG-T05 (vocabulary): a diagram missing a canonical phase state is REJECTED",
	"NEG-T06: compaction is NOT presented as a user wait — the phase and the projection are distinct",
];

/** The invariant witnesses — reported separately from the claims. */
const INVARIANT_WITNESS_CASES: readonly string[] = [
	"INV-T01: the tracker mutation precedes the listener notification and the listener is not an authority",
	"INV-T01 (legacy alias): `set()` is the legacy alias and stamps `unknown-legacy-writer`",
	"INV-T02: every committed write advances the committed seq, including repeated writes of the SAME phase",
	"INV-T02 (webview fence): the REAL webview reducer rejects a stale lower-sequence phase state",
	"INV-T02 (epoch scope): a stale snapshot from an OLDER epoch is dropped wholesale",
	"INV-T09: a throwing subscriber cannot prevent the commit, and later subscribers still run",
	"INV-T09: a subscriber removing itself or another subscriber does not corrupt the iteration",
	"INV-T09 (diagnostics off): with the writer-provenance diagnostic disabled the state and seq semantics are unchanged",
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
	const outFile = resolve(repoRoot, ".tmp-turn-phase-contract-vitest.json");
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

const results: Record<string, TurnPhaseResult> = {};
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

const invariantResults = INVARIANT_WITNESS_CASES.map((caseName) => {
	const outcome = outcomes.find(
		(o) => o.name === caseName || o.name.endsWith(caseName),
	);
	return { caseName, status: outcome?.status ?? ("failed" as const) };
});

const report = buildTurnPhaseCoverageReport(results);

mkdirSync(outDir, { recursive: true });
writeFileSync(
	resolve(outDir, "coverage-report.tsv"),
	renderTurnPhaseCoverageReportTsv(report),
);
writeFileSync(
	resolve(outDir, "coverage-report.md"),
	renderTurnPhaseCoverageReportMarkdown(report),
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
	const claim = TURN_PHASE_CLAIMS.find((c) => c.claim_id === claimId);
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
for (const [group, cases] of [
	["NEG", NEGATIVE_WITNESS_CASES],
	["INV", INVARIANT_WITNESS_CASES],
] as const) {
	for (const caseName of cases) {
		const outcome = outcomes.find(
			(o) => o.name === caseName || o.name.endsWith(caseName),
		);
		const status = outcome?.status ?? "failed";
		inventoryRows.push(
			[
				group,
				group === "NEG" ? "NEGATIVE_WITNESS" : "INVARIANT_WITNESS",
				"see the test name",
				"apps/vscode/src/sdk/__tests__/turn-phase-contract01.tpc01.test.ts",
				group === "NEG" ? "negative witness boundary" : "invariant boundary",
				"apps/vscode/src/sdk/__tests__/turn-phase-contract01.tpc01.test.ts",
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
}
writeFileSync(
	resolve(outDir, "assertion-inventory.tsv"),
	`${inventoryRows.join("\n")}\n`,
);

console.log(renderTurnPhaseCoverageReportMarkdown(report));
console.log("");
console.log("negative witnesses:");
for (const n of negativeResults) {
	console.log(`  ${n.status === "passed" ? "PASS" : "FAIL"}  ${n.caseName}`);
}
console.log("");
console.log("invariant witnesses:");
for (const n of invariantResults) {
	console.log(`  ${n.status === "passed" ? "PASS" : "FAIL"}  ${n.caseName}`);
}
console.log("");
console.log(
	`witness suite exit code: ${exitCode}; eligible claims: ${report.eligible_claims}; executable (PASS): ${report.executable_claims}; failed: ${report.failed_claims}; gaps: ${report.gap_claims}`,
);

const anyClaimFailed = report.failed_claims > 0 || report.gap_claims > 0;
const anyNegativeFailed = negativeResults.some((n) => n.status !== "passed");
const anyInvariantFailed = invariantResults.some((n) => n.status !== "passed");
if (anyClaimFailed || anyNegativeFailed || anyInvariantFailed || exitCode !== 0) {
	console.error("FAIL turn-phase-contract: see the report above.");
	process.exit(1);
}
console.log(
	"PASS turn-phase-contract: every Chart 01 claim has executable, executed evidence.",
);
