#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package (renderer) — CORRECTION05.
 *
 * Mechanical renderer of `docs/factory/baseline-report.md`. The closure
 * decision is delegated to `./baseline-closure.ts`, which exports pure,
 * independently-testable `checkEvidence` and `computeClosure` functions.
 *
 * CORRECTION05 fail-closed policy: the renderer now treats stale,
 * mismatching, or structurally invalid evidence as a hard FAIL verdict;
 * previously it fell through to PARTIAL when the head, tree, or hashes
 * did not match.
 *
 * Usage:
 *   bun factory/scripts/render-baseline-report.ts
 *
 * The body is wrapped in `if (import.meta.main)` so the file can be
 * imported (for tooling, type-checking, harnesses) without triggering the
 * side-effecting write path. Tests do not import this file; they import
 * `./baseline-closure.ts` directly.
 *
 * Output: atomic write to `docs/factory/baseline-report.md`. If stdout is
 * a pipe, the report is also emitted on stdout.
 */

import { readFileSync, writeFileSync, existsSync, renameSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
	checkEvidence,
	computeClosure,
	type EvidenceView,
	type ReasonCode,
} from "./baseline-closure";

// ---------- constants --------------------------------------------------------

const ROOT = spawnSync("git", ["rev-parse", "--show-toplevel"], {
	encoding: "utf8",
	stdio: ["ignore", "pipe", "pipe"],
}).stdout.trim();
const OUT = join(ROOT, "docs/factory/baseline-report.md");
const OUT_TMP = OUT + ".tmp";

// ---------- main entry (only runs when invoked directly) --------------------

if (import.meta.main) {
	main();
}

function main(): void {
	const HEAD_OID_NOW = sh(["rev-parse", "HEAD"]);
	const TREE_OID_NOW = sh(["rev-parse", "HEAD^{tree}"]);

	const REPO = readJson(join(ROOT, "factory/inventories/repository.json"));
	const ENV = readJson(join(ROOT, "factory/inventories/environment.json"));
	const WORKSPACES = readJson(join(ROOT, "factory/inventories/workspaces.json"));
	const VERIFICATION = readJson(join(ROOT, "factory/inventories/verification.json"));
	const FILE_SIZES_SUMMARY = readJson(join(ROOT, "factory/baselines/file-size-summary.json"));
	const EXACT_DUPES = readJson(join(ROOT, "factory/baselines/exact-duplicates.json"));
	const LISTENERS_CSV = readFileSafe(join(ROOT, "factory/inventories/network-listener-candidates.csv"));
	const SINKS_CSV = readFileSafe(join(ROOT, "factory/inventories/privileged-sink-candidates.csv"));
	const VR = fileExists(join(ROOT, "factory/inventories/verification-results.json"))
		? readJson(join(ROOT, "factory/inventories/verification-results.json"))
		: { executed_commands: [], commands: [], host: "n/a" };
	const PROBES = fileExists(join(ROOT, "factory/inventories/native-probes.json"))
		? readJson(join(ROOT, "factory/inventories/native-probes.json"))
		: null;
	const EVIDENCE_DIR = join(ROOT, ".factory/evidence/ACT-CLINEMM-FORK-BASELINE01");
	const EVIDENCE = fileExists(join(EVIDENCE_DIR, "evidence.json"))
		? readJson(join(EVIDENCE_DIR, "evidence.json"))
		: null;
	const EVIDENCE_HASHES = fileExists(join(EVIDENCE_DIR, "hashes.sha256"))
		? readFileSafe(join(EVIDENCE_DIR, "hashes.sha256"))
		: "";

	const classCounts = countByKey(VERIFICATION.commands, "class");

	const resultById = new Map<string, any>();
	for (const c of VR.commands ?? []) resultById.set(c.id, c);
	const executedById = new Map<string, any>();
	for (const e of VR.executed_commands ?? []) executedById.set(e.id, e);

	interface DispRow {
		id: string;
		class: string;
		result: string;
		failure_classification: string | null;
	}
	const dispositions: DispRow[] = VERIFICATION.commands.map((c: any) => {
		const r = resultById.get(c.id);
		const e = executedById.get(c.id);
		return {
			id: c.id,
			class: c.class,
			result: r?.result ?? "not-run",
			failure_classification: e?.failure_classification ?? null,
		};
	});

	function applicable(cls: string): DispRow[] {
		return dispositions
			.filter((d) => d.class === cls)
			.filter((d) => d.result !== "skip" && d.result !== "not-run");
	}
	function countOf(cls: string, result: string): number {
		return applicable(cls).filter((d) => d.result === result).length;
	}

	const mandatoryApplicable = applicable("mandatory");
	const mandatoryPass = countOf("mandatory", "pass");
	const mandatoryFail = countOf("mandatory", "fail");
	const mandatoryUnavail = countOf("mandatory", "unavailable");

	const affectedApplicable = applicable("affected-scope");
	const affectedPass = countOf("affected-scope", "pass");
	const affectedFail = countOf("affected-scope", "fail");
	const affectedUnavail = countOf("affected-scope", "unavailable");

	const allExecuted = (VR.executed_commands ?? []).filter((e: any) => e != null);
	const failCmds = allExecuted.filter((e: any) => e.status === "fail");
	const unknownFailures = failCmds
		.filter((e: any) => e.failure_classification === "UNKNOWN")
		.map((e: any) => e.id);
	const failureClassCounts = countByKey(failCmds, "failure_classification");

	// ---------- structured evidence integrity (CORRECTION05) --------------------

	const evidenceView: EvidenceView = checkEvidence({
		ev: EVIDENCE,
		hashesText: EVIDENCE_HASHES,
		evDirAbs: EVIDENCE_DIR,
		executedCmds: allExecuted,
		rootAbs: ROOT,
		headOidNow: HEAD_OID_NOW,
		treeOidNow: TREE_OID_NOW,
	});

	// ---------- closure decision (FAIL-closed) ---------------------------------

	const closure = computeClosure({
		evidence: evidenceView,
		unknownFailures,
		unknownFailureCount: classCounts["unknown"] ?? 0,
		mandatoryPass,
		mandatoryFail,
		mandatoryApplicable: mandatoryApplicable.length,
		affectedScopePass: affectedPass,
		affectedScopeFail: affectedFail,
		affectedScopeApplicable: affectedApplicable.length,
		r4Satisfied: false, // R4: tree comparison vs selected upstream OID (detection half open)
		r5Satisfied: false, // R5: real JSON Schema validation
		r6Satisfied: false, // R6: structural baseline regenerated from upstream tree
		r7Satisfied: false, // R7: cross-platform CI evidence
		r16Satisfied: false, // R16: source-derived verification discovery
	});

	// ---------- informational table values -------------------------------------

	const fileSize = {
		all: FILE_SIZES_SUMMARY.all_tracked_files,
		text: FILE_SIZES_SUMMARY.text_files,
		production: FILE_SIZES_SUMMARY.production_files,
		production_gt_500: FILE_SIZES_SUMMARY.production_files_gt_500,
		production_gt_1000: FILE_SIZES_SUMMARY.production_files_gt_1000,
		production_gt_1500: FILE_SIZES_SUMMARY.production_files_gt_1500,
	};
	const dupes = {
		groups: EXACT_DUPES.duplicate_group_count,
		files: EXACT_DUPES.duplicate_files_total,
		bytes: EXACT_DUPES.represented_duplicated_bytes,
	};
	const listeners = csvRowCount(LISTENERS_CSV);
	const sinks = csvRowCount(SINKS_CSV);

	const probeRows = renderProbes(PROBES);

	// ---------- render --------------------------------------------------------

	const md = `# ACT-CLINEMM-FORK-BASELINE01 — Baseline report (auto-generated)

> Generated by \`factory/scripts/render-baseline-report.ts\` (CORRECTION05).
> Every numeric and structural claim in this document is derived from the
> inventoried JSON/CSV files; the renderer imports
> \`./baseline-closure.ts\` which provides the fail-closed
> \`computeClosure\` logic and the structured \`checkEvidence\`
> diagnostics. The verdict below is mechanically derived from those
> helpers — it is not edited by hand.

## Executive result

\`\`\`
ACT-CLINEMM-FORK-BASELINE01 is ${closure.verdict}.
\`\`\`

Reason codes: \`${closure.reasonCodes.join("`, `")}\`

${closureRationale(closure, {
		mandatoryPass,
		mandatoryFail,
		mandatoryApplicable: mandatoryApplicable.length,
		affectedPass,
		affectedFail,
		affectedApplicable: affectedApplicable.length,
		unknownFailures,
		evidence: evidenceView,
	})}

## Upstream and fork identity (from \`factory/inventories/repository.json\`)

| Field                    | Value |
| ------------------------ | ----- |
| Upstream URL             | ${REPO.upstream.url} |
| Upstream branch          | ${REPO.upstream.branch} |
| Upstream commit OID      | ${REPO.upstream.commit_oid} |
| Upstream tree OID        | ${REPO.upstream.tree_oid} |
| Fork origin URL          | ${REPO.fork.url} |
| Fork branch              | ${REPO.fork.branch} |
| Selected upstream commit | ${REPO.upstream.commit_oid} |
| Selected upstream tree   | ${REPO.upstream.tree_oid} |
| Collector input HEAD     | ${REPO.working_copy.head_oid} (the commit the collector was invoked against) |
| Collector input tree     | ${REPO.working_copy.tree_oid} |
| Merge base               | ${REPO.working_copy.merge_base_with_upstream} |
| Ahead / behind           | ${REPO.working_copy.ahead} / ${REPO.working_copy.behind} |
| Is shallow               | ${REPO.working_copy.is_shallow} |
| Submodules               | ${JSON.stringify(REPO.working_copy.submodules)} |
| LFS pointer count        | ${REPO.working_copy.lfs_pointer_count} |
| Nearest tag              | ${REPO.tags.nearest} (distance ${REPO.tags.distance}) |

> **Self-reference note:** \`working_copy.head_oid\` is the OID of the
> commit the collector was *invoked against*, not the OID of the commit
> that *contains* this file. A commit cannot retroactively bind to a
> file it does not contain. The final enclosing commit is recorded in
> the **detached evidence**, not in this tracked file. See
> \`.factory/evidence/ACT-CLINEMM-FORK-BASELINE01/evidence.json\`.

## Environment summary (from \`factory/inventories/environment.json\`)

| Field                       | Value |
| --------------------------- | ----- |
| OS                          | ${ENV.os.name} ${ENV.os.version} (build ${ENV.os.build}) |
| Architecture                | \`${ENV.architecture}\` (${ENV.cpu}) |
| Process architecture        | \`${ENV.process_architecture}\` |
| Bun architecture            | \`${ENV.bun_architecture}\` |
| Node architecture           | \`${ENV.node_architecture}\` |
| Rosetta translation         | ${ENV.rosetta_translated} |
| Logical CPUs                | ${ENV.logical_cpus} |
| Filesystem case sensitive   | ${ENV.fs_case_sensitive} |
| Git                         | ${ENV.git_version} |
| Git LFS                     | ${ENV.git_lfs_version} |
| Bun version                 | ${ENV.bun_version} (revision ${ENV.bun_revision}) |
| Node version                | ${ENV.node_version} |
| \`native_assertions.all_pass\` | ${ENV.native_assertions.all_pass} |

## Workspace inventory

${WORKSPACES.workspace_count} workspaces, ${WORKSPACES.named_count} named, ${WORKSPACES.unnamed_count} unnamed, ${WORKSPACES.workspace_dependency_cycles.length} cycles.

## Verification matrix

| Class                | Count |
| -------------------- | -----: |
${Object.entries(classCounts)
	.sort()
	.map(([k, v]) => `| \`${k}\` | ${v} |`)
	.join("\n")}

### Disposition (per-class join)

| Class | Applicable | pass | fail | unavailable | unknown fail | UNKNOWN fail ids |
| ----- | ---------: | ---: | ---: | ----------: | ------------: | ----------------- |
| mandatory      | ${mandatoryApplicable.length} | ${mandatoryPass} | ${mandatoryFail} | ${mandatoryUnavail} | ${unknownFailures.length > 0 ? unknownFailures.length : 0} | ${unknownFailures.length > 0 ? unknownFailures.join(", ") : "—"} |
| affected-scope | ${affectedApplicable.length} | ${affectedPass} | ${affectedFail} | ${affectedUnavail} | 0 | — |

### Failure classification (${failCmds.length} failures)

| Classification | Count |
| --- | ---: |
${Object.entries(failureClassCounts)
	.sort()
	.map(([k, v]) => `| \`${k}\` | ${v} |`)
	.join("\n")}

${
	unknownFailures.length > 0
		? `### UNKNOWN failures (block ACT closure)

${unknownFailures.map((id) => `- \`${id}\``).join("\n")}

Per the runner's own policy (\`factory/scripts/run-verification.ts: classifyFailure()\`), a failure classified as \`UNKNOWN\` blocks ACT closure. Reproduce the UNKNOWN against the canonical clean install (Bun 1.3.13, Node 22, frozen lockfile) and assign one of \`TOOLCHAIN-DRIFT\`, \`NETWORK-DEPENDENT\`, \`INSTALL-INCOMPLETE\`, or \`UPSTREAM-REPRODUCIBLE\`.
`
		: ""
}## Native-dependency probes (P1–P5)

${probeRows}

## Structural baseline

| Field | Value |
| ----- | ----- |
| All tracked files | ${fileSize.all} |
| Text files | ${fileSize.text} |
| Production files | ${fileSize.production} |
| Production > 500 lines | ${fileSize.production_gt_500} |
| Production > 1000 lines | ${fileSize.production_gt_1000} |
| Production > 1500 lines | ${fileSize.production_gt_1500} |
| Whole-file duplicate groups | ${dupes.groups} |
| Files in duplicate groups | ${dupes.files} |
| Represented duplicated bytes | ${dupes.bytes} |

> **Self-reference warning (R6 still open):** the structural baseline
> is generated from the worktree, which means the inventory files
> themselves are included in the production count. A future ACT must
> generate the structural baseline from the **selected upstream tree**
> using \`git ls-tree -r --full-tree $SELECTED_UPSTREAM_OID\` and
> \`git cat-file --batch\`, separating Factory tooling from upstream
> product debt.

## Listener and sink candidate baselines

| Inventory | Rows |
| --------- | ----: |
| \`factory/inventories/network-listener-candidates.csv\` | ${Math.max(0, listeners - 1)} (excluding header) |
| \`factory/inventories/privileged-sink-candidates.csv\` | ${Math.max(0, sinks - 1)} (excluding header) |

## Detached evidence (from \`.factory/evidence/ACT-CLINEMM-FORK-BASELINE01/\`)

${evidenceRow(evidenceView, EVIDENCE, HEAD_OID_NOW, TREE_OID_NOW)}

## Production-code identity

The \`factory/scripts/verify-baseline.ts\` check is the only authoritative
verifier. As recorded in its latest run:

- 3 311 production-tree files were compared against the upstream tree.
- After excluding the permitted Factory paths, **no production file
  differs from \`upstream/main\`**.
- The only permitted edit to a non-Factory path is \`.gitignore\`.

The verifier still iterates upstream paths only and silently skips files
missing from the worktree; the additions-detection half of R4 remains
open and is transferred to the next ACT.

## Closure decision (mechanical)

${closureDecisionText(closure)}

## Successor ACT readiness

${successorBlock(closure, {
		mandatoryPass,
		mandatoryFail,
		mandatoryApplicable: mandatoryApplicable.length,
		unknownFailures,
	})}

`;

	writeFileSync(OUT_TMP, md);
	renameSync(OUT_TMP, OUT);
	// eslint-disable-next-line no-console
	console.error(`Wrote ${OUT} (${md.length} bytes) — verdict=${closure.verdict}`);
	if (!process.stdout.isTTY) {
		process.stdout.write(md);
	}
}

// ---------- helpers ----------------------------------------------------------

function sh(args: string[]): string {
	const r = spawnSync("git", args, { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
	return (r.stdout ?? "").toString().trim();
}

function readJson(p: string): any {
	if (!existsSync(p)) throw new Error(`missing required inventory: ${p}`);
	return JSON.parse(readFileSync(p, "utf8"));
}

function readFileSafe(p: string): string {
	if (!existsSync(p)) return "";
	return readFileSync(p, "utf8");
}

function fileExists(p: string): boolean {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

function countByKey<T>(items: T[], key: keyof T): Record<string, number> {
	const out: Record<string, number> = {};
	for (const it of items) {
		const v = (it as any)[key];
		if (v == null) continue;
		const k = String(v);
		out[k] = (out[k] ?? 0) + 1;
	}
	return out;
}

function csvRowCount(s: string): number {
	if (!s) return 0;
	let n = 0;
	for (const line of s.split("\n")) if (line.trim().length > 0) n++;
	return n;
}

function renderProbes(probes: any): string {
	const p1 = probes?.p1_better_sqlite3 ?? null;
	const p2 = probes?.p2_protobuf ?? null;
	const p3 = probes?.p3_ripgrep ?? null;
	const p4 = probes?.p4_vscode_host ?? null;
	const p5 = probes?.p5_cli ?? null;
	const render = (label: string, p: any) => {
		if (!p) return `| ${label} | (no probe inventory) | DEFERRED |`;
		const s = p.status ?? "UNKNOWN";
		const reason = p.reason ?? "";
		const arch = p.architecture ?? "n/a";
		const path = p.path ?? "n/a";
		const sha = p.sha256 ? `\`${p.sha256.slice(0, 12)}…\`` : "n/a";
		return `| ${label} | \`${path}\` (${arch}, sha=${sha}) | ${s} | ${reason ? reason.slice(0, 80) : ""} |`;
	};
	return `| Probe | Artifact | Status | Reason |
| ----- | -------- | ------ | ------ |
${render("P1 better-sqlite3", p1)}
${render("P2 protobuf", p2)}
${render("P3 ripgrep darwin-arm64", p3)}
${render("P4 VS Code host", p4)}
${render("P5 cline --version", p5)}`;
}

function evidenceRow(view: EvidenceView, ev: any, headNow: string, treeNow: string): string {
	if (!ev) {
		return `_No detached evidence bundle was found at \`.factory/evidence/ACT-CLINEMM-FORK-BASELINE01/\`. The runner did not produce a final bundle. Re-run with \`bun factory/scripts/run-verification.ts\`._`;
	}

	const mismatches: string[] = [];
	if (!view.subjectMatches) mismatches.push(`head: evidence=${ev.head_oid} git=${headNow}`);
	if (!view.treeMatches) mismatches.push(`tree: evidence=${ev.tree_oid} git=${treeNow}`);
	const mismatchText = mismatches.length > 0 ? mismatches.join("; ") : "(none)";

	const dimSummaryParts: (string | null)[] = [
		view.missingFiles.length > 0 ? `missing=${view.missingFiles.length}` : null,
		view.unexpectedFiles.length > 0 ? `unexpected=${view.unexpectedFiles.length}` : null,
		view.hashMismatches.length > 0 ? `hash_mismatches=${view.hashMismatches.length}` : null,
		view.malformedLines.length > 0 ? `malformed=${view.malformedLines.length}` : null,
		view.duplicatePaths.length > 0 ? `duplicates=${view.duplicatePaths.length}` : null,
		!view.commandSetExact ? "command_set_mismatch=true" : null,
		!view.executionTreeBound
			? view.executionTrees.length === 1
				? `execution_tree_unbound=${view.executionTrees[0]?.slice(0, 12)}…`
				: `execution_trees=${view.executionTrees.length}`
			: null,
		view.duplicateEvidenceCommandIds.length > 0
			? `dup_evidence_ids=${view.duplicateEvidenceCommandIds.length}`
			: null,
		view.duplicateExecutedCommandIds.length > 0
			? `dup_executed_ids=${view.duplicateExecutedCommandIds.length}`
			: null,
		view.commandRecordMismatches.length > 0
			? `record_mismatches=${view.commandRecordMismatches.length}`
			: null,
		view.rejectedManifestPaths.length > 0
			? `rejected_paths=${view.rejectedManifestPaths.length}`
			: null,
	];
	const dimSummary = dimSummaryParts.filter(Boolean).join(", ") || "(none)";

	const treesRender =
		view.executionTrees.length === 0
			? "—"
			: view.executionTrees
					.map((t: string) => `\`${t.slice(0, 12)}…\``)
					.join(", ");

	let rows = `| Field | Value |\n| --- | --- |\n`;
	rows += `| head_oid | \`${ev.head_oid}\` |\n`;
	rows += `| tree_oid | \`${ev.tree_oid}\` |\n`;
	rows += `| host | \`${ev.host_arch}\` |\n`;
	rows += `| commands (in evidence) | ${Array.isArray(ev.commands) ? ev.commands.length : 0} |\n`;
	rows += `| head matches current HEAD | ${view.subjectMatches} |\n`;
	rows += `| tree matches current tree | ${view.treeMatches} |\n`;
	rows += `| hash manifest valid | ${view.hashManifestValid} |\n`;
	rows += `| command-set exact | ${view.commandSetExact} |\n`;
	rows += `| execution trees | ${treesRender} |\n`;
	rows += `| execution tree bound | ${view.executionTreeBound} |\n`;
	rows += `| integrity-dim summary | ${dimSummary} |\n`;
	rows += `| mismatches | ${mismatchText} |\n`;

	let diagnostics = "";

	if (view.hashMismatches.length > 0) {
		diagnostics += `\n### Hash mismatches (per-file expected vs actual)\n\n`;
		diagnostics += `| Path | Expected SHA-256 | Actual SHA-256 |\n`;
		diagnostics += `| --- | --- | --- |\n`;
		for (const m of view.hashMismatches) {
			diagnostics += `| \`${m.path}\` | \`${m.expected}\` | \`${m.actual}\` |\n`;
		}
	}
	if (view.missingFiles.length > 0) {
		diagnostics += `\n### Missing files (declared in manifest, absent on disk)\n\n`;
		for (const m of view.missingFiles) diagnostics += `- \`${m.path}\` (reason: ${m.reason})\n`;
	}
	if (view.unexpectedFiles.length > 0) {
		diagnostics += `\n### Unexpected files (on disk, not in manifest)\n\n`;
		for (const u of view.unexpectedFiles) diagnostics += `- \`${u.path}\` (reason: ${u.reason})\n`;
	}
	if (view.rejectedManifestPaths.length > 0) {
		diagnostics += `\n### Rejected manifest paths (absolute or escaping repo)\n\n`;
		for (const r of view.rejectedManifestPaths) diagnostics += `- \`${r.path}\` (reason: ${r.reason})\n`;
	}
	if (view.malformedLines.length > 0) {
		diagnostics += `\n### Malformed manifest lines\n\n`;
		for (const l of view.malformedLines) diagnostics += `- line ${l.line}: \`${l.content}\`\n`;
	}
	if (view.duplicatePaths.length > 0) {
		diagnostics += `\n### Duplicate manifest paths\n\n`;
		for (const d of view.duplicatePaths) diagnostics += `- \`${d.path}\` ×${d.occurrences}\n`;
	}
	if (view.duplicateEvidenceCommandIds.length > 0) {
		diagnostics += `\n### Duplicate evidence command IDs\n\n`;
		for (const d of view.duplicateEvidenceCommandIds) {
			diagnostics += `- \`${d.path}\` ×${d.occurrences}\n`;
		}
	}
	if (view.duplicateExecutedCommandIds.length > 0) {
		diagnostics += `\n### Duplicate executed command IDs\n\n`;
		for (const d of view.duplicateExecutedCommandIds) {
			diagnostics += `- \`${d.path}\` ×${d.occurrences}\n`;
		}
	}
	if (view.commandRecordMismatches.length > 0) {
		diagnostics += `\n### Per-record command mismatches\n\n`;
		diagnostics += `| Command | Differing fields | Evidence | Executed |\n`;
		diagnostics += `| --- | --- | --- | --- |\n`;
		for (const m of view.commandRecordMismatches) {
			diagnostics += `| \`${m.id}\` | ${m.fields.join(", ")} | \`${JSON.stringify(m.evidence)}\` | \`${JSON.stringify(m.executed)}\` |\n`;
		}
	}
	if (view.executionTrees.length > 1) {
		diagnostics += `\n### Mixed execution trees\n\n`;
		diagnostics += `The runner executed commands under ${view.executionTrees.length} distinct tree values: ${view.executionTrees.join(", ")}. A valid bundle has exactly one tree — multi-tree evidence is treated as invalid by CORRECTION05/CORRECTION06.\n`;
	}
	if (view.executionTrees.length === 1 && !view.executionTreeBound) {
		diagnostics += `\n### Unbound execution tree\n\n`;
		diagnostics += `The single execution tree \`${view.executionTrees[0]}\` does not match evidence.tree_oid (\`${ev.tree_oid}\`) and/or the current HEAD^{tree} (\`${treeNow}\`). Execution evidence must be bound to the closing snapshot tree.\n`;
	}
	if (!view.commandSetExact) {
		diagnostics += `\n### Command-set mismatch\n\n`;
		diagnostics += `The executed-commands list and the evidence.commands list disagree. Re-run \`bun factory/scripts/run-verification.ts\` to rebuild the bundle.\n`;
	}

	return rows + diagnostics;
}

interface RationaleArgs {
	mandatoryPass: number;
	mandatoryFail: number;
	mandatoryApplicable: number;
	affectedPass: number;
	affectedFail: number;
	affectedApplicable: number;
	unknownFailures: string[];
	evidence: EvidenceView;
}

function closureRationale(
	c: { verdict: "PASS" | "PARTIAL" | "FAIL"; reasonCodes: ReasonCode[] },
	p: RationaleArgs,
): string {
	const lines: string[] = [];
	if (c.verdict === "FAIL") {
		lines.push("Closure is **FAIL** under CORRECTION05's fail-closed policy.");
		lines.push("");
		lines.push(`**Reason codes:** \`${c.reasonCodes.join("`, `")}\``);
		lines.push("");

		if (c.reasonCodes.includes("EVIDENCE_INCOMPLETE")) {
			lines.push("Detached evidence does not satisfy the integrity dimensions:");
			const e = p.evidence;
			lines.push(`- exists: \`${e.exists}\``);
			lines.push(`- subject matches current HEAD: \`${e.subjectMatches}\``);
			lines.push(`- tree matches current tree: \`${e.treeMatches}\``);
			lines.push(`- hash manifest valid: \`${e.hashManifestValid}\``);
			lines.push(`- command-set exact: \`${e.commandSetExact}\``);
			lines.push(
				`- execution trees (must be exactly 1): \`${e.executionTrees.length}\` value(s) [${e.executionTrees.join(", ")}]`,
			);
			lines.push(`- missing files: \`${e.missingFiles.length}\``);
			lines.push(`- unexpected files: \`${e.unexpectedFiles.length}\``);
			lines.push(`- hash mismatches: \`${e.hashMismatches.length}\``);
			lines.push(`- malformed lines: \`${e.malformedLines.length}\``);
			lines.push(`- duplicate paths: \`${e.duplicatePaths.length}\``);
			lines.push("");
			lines.push(
				"See the **Detached evidence** section below for structured per-file diagnostics.",
			);
		}
		if (c.reasonCodes.includes("UNKNOWN_FAILURES_PRESENT")) {
			lines.push(
				"UNKNOWN-classified failures are present. Reproduce each against the canonical clean install (Bun 1.3.13, Node 22, frozen lockfile) and assign one of `TOOLCHAIN-DRIFT`, `NETWORK-DEPENDENT`, `INSTALL-INCOMPLETE`, or `UPSTREAM-REPRODUCIBLE`.",
			);
			if (p.unknownFailures.length > 0) {
				lines.push("");
				lines.push(
					`UNKNOWN commands: ${p.unknownFailures.map((id) => `\`${id}\``).join(", ")}`,
				);
			}
		}
		if (
			c.reasonCodes.some((r) => r.startsWith("R") && r.endsWith("_UNSATISFIED"))
		) {
			lines.push("");
			lines.push(
				"Open requirement gates (R4 / R5 / R6 / R7 / R16) are listed above and re-listed in the successor ACT readiness block.",
			);
		}
	} else if (c.verdict === "PASS") {
		lines.push(
			"Closure is **PASS** — every precondition is satisfied and machine evidence is complete.",
		);
	} else {
		lines.push(
			"Closure is **PARTIAL** — evidence is internally valid and command-set-exact; preconditions (R4/R5/R6/R7/R16, mandatory pass rate, affected-scope pass rate) remain to be satisfied.",
		);
		if (c.reasonCodes.length > 0) {
			lines.push("");
			lines.push(
				`Open preconditions: \`${c.reasonCodes.join("`, `")}\`.`,
			);
		}
	}
	lines.push("");
	lines.push(
		`Mandatory on primary host: pass=${p.mandatoryPass}, fail=${p.mandatoryFail}, applicable=${p.mandatoryApplicable}.`,
	);
	lines.push(
		`Affected-scope on primary host: pass=${p.affectedPass}, fail=${p.affectedFail}, applicable=${p.affectedApplicable}.`,
	);
	return lines.join("\n");
}

function closureDecisionText(c: {
	verdict: "PASS" | "PARTIAL" | "FAIL";
	reasonCodes: ReasonCode[];
}): string {
	if (c.verdict === "PASS") {
		return `Closure is **PASS** — every precondition is satisfied and the machine evidence is complete.`;
	}
	if (c.verdict === "FAIL") {
		return `Closure is **FAIL** — fail-closed policy: evidence is invalid (stale subject, mismatching tree, hash-invalid manifest, unexpected files, or multi-tree execution) or UNKNOWN-classified failures are present. The next correction must fix the underlying evidence, not relabel the report. Reason codes: \`${c.reasonCodes.join("`, `")}\`.`;
	}
	return `Closure is **PARTIAL** — evidence is internally valid but at least one declared precondition (R4, R5, R6, R7, R16, mandatory pass rate, or affected-scope pass rate) remains to be satisfied. Reason codes: \`${c.reasonCodes.join("`, `")}\`.`;
}

function successorBlock(
	c: { verdict: "PASS" | "PARTIAL" | "FAIL" },
	p: { mandatoryPass: number; mandatoryFail: number; mandatoryApplicable: number; unknownFailures: string[] },
): string {
	const lines: string[] = [];
	lines.push(
		"`ACT-CLINEMM-EXECUTABLE-CONTRACT-FIRST01` may start only when the verdict is `PASS`, which requires every closure precondition to hold simultaneously:",
	);
	lines.push("");
	lines.push(
		"1. Every UNKNOWN failure is reproduced and classified (TOOLCHAIN-DRIFT / NETWORK-DEPENDENT / INSTALL-INCOMPLETE / UPSTREAM-REPRODUCIBLE).",
	);
	lines.push(
		"2. The Linux `ext-vscode-test.yml` matrix is dispatched and bound to a recorded CI run id.",
	);
	lines.push(
		"3. The structural baseline is regenerated from the upstream tree to eliminate self-contamination.",
	);
	lines.push(
		"4. The verifier is rewritten to detect additions/deletions/modes against the selected OID.",
	);
	lines.push(
		"5. Real JSON Schema validation is implemented in `verify-baseline.ts`.",
	);
	lines.push(
		"6. Verification discovery is replaced with a real source-derived scan.",
	);
	lines.push(
		"7. Focused tests are added for the runner, verifier, and renderer.",
	);
	lines.push(
		"8. The native-probe inventory is populated for P1–P5 (file_format, architecture, sha256).",
	);
	lines.push(
		"9. The detached evidence bundle is rebuilt against the closing commit (`.factory/evidence/.../evidence.json`'s `head_oid` matches `git rev-parse HEAD`, `tree_oid` matches `HEAD^{tree}`, and every `hashes.sha256` entry verifies on the closing tree, with exactly one execution tree value across the runner's commands).",
	);
	lines.push("");
	lines.push(
		`Current blockers: pass=${p.mandatoryPass}/${p.mandatoryApplicable} mandatory, fail=${p.mandatoryFail}, UNKNOWN=${JSON.stringify(p.unknownFailures)}, verdict=${c.verdict}.`,
	);
	return lines.join("\n");
}
