#!/usr/bin/env bun
/**
 * tools/factory/fwmi/cli.ts
 *
 * The FWMI v1 interchange import CLI.
 *
 * Five commands, one per operator-facing operation:
 *
 *   validate   — dry-run interchange validation (read-only)
 *   shadow     — shadow import: compute the plan and the byte delta (read-only)
 *   verify     — persisted conservation verification (read-only)
 *   lookup     — historical ACT lookup (read-only)
 *   replay     — exact replay: prove a re-import produces zero byte delta
 *
 * Plus `apply`, which is the only command that writes, and which the
 * operator runs deliberately.
 *
 * READ-ONLY BY DEFAULT. `validate`, `shadow`, `verify`, `lookup` and
 * `replay` never write to the repository. `apply` writes only the files
 * the plan owns.
 *
 * Exit codes:
 *   0  success
 *   1  a check failed (validation error, conservation error, non-clean replay)
 *   2  usage or input error (package missing, unreadable, malformed)
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type ApplyResult,
	applyPlan,
	archiveIndexPath,
	computeDeltas,
	resolveRepoRoot,
} from "./apply.ts";
import { verifyPersistedConservation } from "./conserve.ts";
import { loadFwmiPackage } from "./load.ts";
import { lookupHistoricalActs } from "./lookup.ts";
import { buildImportPlan } from "./plan.ts";
import { type FwmiValidationResult, validateFwmiPackage } from "./validate.ts";

interface Args {
	readonly command: string;
	readonly packageDir: string | null;
	readonly repoRoot: string | null;
	readonly json: boolean;
	readonly rest: readonly string[];
}

function parseArgs(argv: readonly string[]): Args {
	let command = "";
	const rest: string[] = [];
	let packageDir: string | null = null;
	let repoRoot: string | null = null;
	let json = false;
	for (const arg of argv) {
		if (arg.startsWith("--package=")) {
			packageDir = arg.slice("--package=".length);
		} else if (arg.startsWith("--repo=")) {
			repoRoot = arg.slice("--repo=".length);
		} else if (arg === "--json") {
			json = true;
		} else if (!command) {
			command = arg;
		} else {
			rest.push(arg);
		}
	}
	return { command, packageDir, repoRoot, json, rest };
}

const USAGE = `FWMI v1 interchange import

Usage:
  bun tools/factory/fwmi/cli.ts <command> --package=<dir> [--repo=<root>] [--json]

Commands:
  validate   Dry-run interchange validation. Writes nothing.
  shadow     Shadow import: compute the plan and the canonical byte delta. Writes nothing.
  verify     Persisted semantic conservation verification. Writes nothing.
  lookup     Historical ACT lookup by identity. Writes nothing.
  replay     Exact replay: prove a re-import produces zero unintended byte delta. Writes nothing.
  apply      Write the import to the repository (the only command that writes).

Options:
  --package=<dir>  Path to the FWMI v1 interchange package directory.
  --repo=<root>    Repository root. Defaults to the enclosing repository.
  --json           Machine-readable output.
`;

function fail(message: string, code = 2): never {
	console.error(`ERROR: ${message}`);
	process.exit(code);
}

/** Load the package, failing with a precise diagnostic when it cannot. */
function mustLoad(packageDir: string) {
	const loaded = loadFwmiPackage(packageDir);
	if (!loaded.ok) {
		console.error(
			`ERROR: the interchange package at ${packageDir} could not be loaded:`,
		);
		for (const p of loaded.problems) {
			console.error(`  [${p.code}] ${p.path}: ${p.message}`);
		}
		process.exit(2);
	}
	return loaded.package;
}

/** Render a validation result. */
function renderValidation(result: FwmiValidationResult): string {
	const lines: string[] = [];
	lines.push(`FWMI v1 validation: ${result.ok ? "PASS" : "FAIL"}`);
	lines.push("─".repeat(72));
	const s = result.stats;
	lines.push(
		`epics=${s.epicCount} items=${s.itemCount} (open=${s.openCount} active=${s.activeCount} blocked=${s.blockedCount} deferred=${s.deferredCount} terminal=${s.terminalCount} unresolved=${s.unresolvedCount})`,
	);
	lines.push(
		`historical ACTs=${s.historicalActCount} dependencies=${s.dependencyCount} cross-links=${s.crossLinkCount}`,
	);
	lines.push(
		`unresolved conflicts=${s.unresolvedConflictCount} unknown original status=${s.unknownOriginalStatusCount} unknown qualification=${s.unknownQualificationCount} unknown coverage=${s.unknownCoverageCount}`,
	);
	lines.push("─".repeat(72));
	const errors = result.findings.filter((f) => f.severity === "ERROR");
	const warnings = result.findings.filter((f) => f.severity === "WARNING");
	const infos = result.findings.filter((f) => f.severity === "INFO");
	for (const f of [...errors, ...warnings, ...infos]) {
		lines.push(`[${f.severity}] ${f.code} — ${f.subject}: ${f.message}`);
	}
	lines.push("─".repeat(72));
	lines.push(
		`ERRORS=${errors.length} WARNINGS=${warnings.length} INFO=${infos.length}`,
	);
	lines.push(result.ok ? "RESULT: VALIDATION PASS" : "RESULT: VALIDATION FAIL");
	return lines.join("\n");
}

/** Render a byte-delta report. */
function renderDeltas(result: ApplyResult, label: string): string {
	const lines: string[] = [];
	lines.push(`${label}`);
	lines.push("─".repeat(72));
	lines.push(
		`files=${result.deltas.length} changed=${result.changedFileCount} byteDelta=${result.byteDelta}`,
	);
	for (const d of result.deltas) {
		lines.push(
			`  ${d.action.padEnd(9)} ${d.path}  ${d.bytesBefore} -> ${d.bytesAfter} bytes`,
		);
	}
	lines.push("─".repeat(72));
	return lines.join("\n");
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	if (!args.command || args.command === "help" || args.command === "--help") {
		console.log(USAGE);
		process.exit(args.command ? 0 : 2);
	}

	const repoRoot = args.repoRoot
		? resolve(args.repoRoot)
		: resolveRepoRoot(process.cwd());

	switch (args.command) {
		case "validate": {
			if (!args.packageDir) fail("validate requires --package=<dir>");
			const pkg = mustLoad(args.packageDir);
			const result = validateFwmiPackage(pkg);
			if (args.json) {
				console.log(JSON.stringify(result, null, 2));
			} else {
				console.log(renderValidation(result));
			}
			process.exit(result.ok ? 0 : 1);
			break;
		}

		case "shadow": {
			if (!args.packageDir) fail("shadow requires --package=<dir>");
			const pkg = mustLoad(args.packageDir);
			const validation = validateFwmiPackage(pkg);
			if (!validation.ok) {
				console.error(
					"ERROR: the interchange package failed validation; no import plan was computed.",
				);
				console.log(renderValidation(validation));
				process.exit(1);
			}
			const plan = buildImportPlan(pkg);
			const deltas = computeDeltas({ root: repoRoot }, plan);
			if (args.json) {
				console.log(
					JSON.stringify(
						{
							validation,
							plan: {
								packageId: plan.packageId,
								entries: plan.entries.length,
								archiveEntries: plan.archiveEntries.length,
								reconciliationVerdict: plan.reconciliationVerdict,
								reconciliationReady: plan.reconciliationReady,
							},
							deltas,
						},
						null,
						2,
					),
				);
			} else {
				console.log(renderValidation(validation));
				console.log("");
				console.log(
					renderDeltas(
						deltas,
						`SHADOW IMPORT — interchange=${plan.packageId} verdict=${plan.reconciliationVerdict}`,
					),
				);
				console.log(
					`ledger records planned=${plan.entries.length} archive index entries=${plan.archiveEntries.length}`,
				);
				console.log(
					`reconciliationReady=${plan.reconciliationReady} (a reconciliation state, NOT cutover approval)`,
				);
			}
			process.exit(0);
			break;
		}

		case "verify": {
			if (!args.packageDir) fail("verify requires --package=<dir>");
			const pkg = mustLoad(args.packageDir);
			const plan = buildImportPlan(pkg);
			const result = verifyPersistedConservation(repoRoot, pkg, plan);
			if (args.json) {
				console.log(JSON.stringify(result, null, 2));
			} else {
				const lines = [
					`PERSISTED CONSERVATION: ${result.ok ? "PASS" : "FAIL"}`,
					"─".repeat(72),
				];
				lines.push(
					`records checked=${result.recordsChecked} historical ACTs checked=${result.historicalActsChecked}`,
				);
				for (const f of result.findings) {
					lines.push(`[${f.severity}] ${f.check} — ${f.subject}: ${f.message}`);
				}
				lines.push("─".repeat(72));
				lines.push(
					result.ok ? "RESULT: CONSERVATION PASS" : "RESULT: CONSERVATION FAIL",
				);
				console.log(lines.join("\n"));
			}
			process.exit(result.ok ? 0 : 1);
			break;
		}

		case "lookup": {
			const query = args.rest[0];
			if (!query) fail("lookup requires an ACT identity argument");
			const result = lookupHistoricalActs(repoRoot, query);
			if (args.json) {
				console.log(JSON.stringify(result, null, 2));
			} else {
				const lines = [`HISTORICAL LOOKUP: ${query}`, "─".repeat(72)];
				if (!result.found) lines.push("NOT FOUND");
				for (const m of result.matches) {
					lines.push(`act_id           ${m.act_id}`);
					lines.push(`sources          ${m.sources.join(", ")}`);
					lines.push(
						`original_verdict ${m.original_verdict ?? "(none recorded)"}`,
					);
					if (m.competing_verdicts.length > 0)
						lines.push(`competing        ${m.competing_verdicts.join(" | ")}`);
					lines.push(`epic_id          ${m.epic_id ?? "(none)"}`);
					lines.push(
						`work_item_ids    ${m.work_item_ids.length ? m.work_item_ids.join(", ") : "(none)"}`,
					);
					lines.push(
						`evidence         ${m.evidence_locators.length ? m.evidence_locators.join(", ") : "(none)"}`,
					);
					lines.push(`reconciliation   ${m.reconciliation ?? "(none)"}`);
					lines.push(`unresolved       ${m.unresolved}`);
					lines.push(`source_locations ${m.source_locations.join(", ")}`);
					lines.push("─".repeat(72));
				}
				console.log(lines.join("\n"));
			}
			process.exit(result.found ? 0 : 1);
			break;
		}

		case "replay": {
			if (!args.packageDir) fail("replay requires --package=<dir>");
			const pkg = mustLoad(args.packageDir);
			const validation = validateFwmiPackage(pkg);
			if (!validation.ok) {
				console.error(
					"ERROR: the interchange package failed validation; no replay was computed.",
				);
				process.exit(1);
			}
			const plan = buildImportPlan(pkg);
			const deltas = computeDeltas({ root: repoRoot }, plan);
			const conservation = verifyPersistedConservation(repoRoot, pkg, plan);
			if (args.json) {
				console.log(
					JSON.stringify(
						{
							byteDelta: deltas.byteDelta,
							changedFileCount: deltas.changedFileCount,
							replayClean: deltas.replayClean,
							deltas: deltas.deltas,
							conservation,
						},
						null,
						2,
					),
				);
			} else {
				console.log(
					renderDeltas(
						deltas,
						"EXACT REPLAY — byte delta against the persisted repository",
					),
				);
				console.log(
					`byteDelta=${deltas.byteDelta} changedFiles=${deltas.changedFileCount}`,
				);
				console.log(
					`conservation=${conservation.ok ? "PASS" : "FAIL"} records=${conservation.recordsChecked} acts=${conservation.historicalActsChecked}`,
				);
				console.log(
					deltas.replayClean
						? "RESULT: EXACT REPLAY CLEAN (zero unintended canonical byte delta)"
						: "RESULT: EXACT REPLAY DIRTY (the persisted canonical bytes differ from the plan)",
				);
			}
			process.exit(deltas.replayClean && conservation.ok ? 0 : 1);
			break;
		}

		case "apply": {
			if (!args.packageDir) fail("apply requires --package=<dir>");
			const pkg = mustLoad(args.packageDir);
			const validation = validateFwmiPackage(pkg);
			if (!validation.ok) {
				console.error(
					"ERROR: the interchange package failed validation; nothing was written.",
				);
				console.log(renderValidation(validation));
				process.exit(1);
			}
			const plan = buildImportPlan(pkg);
			const before = computeDeltas({ root: repoRoot }, plan);
			const result = applyPlan({ root: repoRoot }, plan);
			console.log(
				renderDeltas(before, `APPLY — interchange=${plan.packageId}`),
			);
			console.log(
				`written=${result.written.length} archive index=${archiveIndexPath({ root: repoRoot })}`,
			);
			for (const w of result.written) console.log(`  wrote ${w}`);
			console.log(
				`after: byteDelta=${result.byteDelta} changedFiles=${result.changedFileCount}`,
			);
			process.exit(0);
			break;
		}

		default:
			console.error(`ERROR: unknown command "${args.command}"`);
			console.log(USAGE);
			process.exit(2);
	}
}

main();
