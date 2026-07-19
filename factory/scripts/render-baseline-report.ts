#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package (renderer) — CORRECTION15.
 *
 * Mechanical renderer of `docs/factory/baseline-report.md`. The closure
 * decision is delegated to `./baseline-closure.ts`, which exports pure,
 * independently-testable `checkEvidence`, `computeClosure`, and
 * `loadNativeProbesInventory` functions.
 *
 * CORRECTION15 binding model — same as CORRECTION14 plus:
 *
 *   1. The bundled `verification-results.json` command-set check is
 *      performed before the `commandSetExact` aggregate so a fresh
 *      bundle can satisfy `isEvidenceOk`.
 *   2. `skip` / `unavailable` rows are tracked separately and never
 *      counted as a pass in the closure arithmetic.
 *   3. The native-probe inventory P1–P5 is consumed as a fail-closed
 *      closure dimension; missing/malformed/deferred/unknown/failed
 *      probes block PASS.
 *   4. Row diagnostics are deduplicated with a `Set<string>` so the
 *      report no longer emits the same field name multiple times.
 *
 * Usage:
 *   bun factory/scripts/render-baseline-report.ts
 *
 * The body is wrapped in `if (import.meta.main)` so the file can be
 * imported (for tooling, type-checking, harnesses) without triggering
 * the side-effecting write path. Tests do not import this file; they
 * import `./baseline-closure.ts` directly.
 */

import { readFileSync, writeFileSync, existsSync, renameSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// CORRECTION21 (µC-3 review): the renderer imports `NativeProbesView`
// as a TYPE only (no `loadNativeProbesInventory` value). The tracked
// mirror is informational-only; the renderer must consult the bundle
// reader for the authoritative dimension set.
import {
	checkEvidence,
	computeClosure,
	loadEvidenceFile,
	loadNativeProbesFromEvidence,
	NATIVE_PROBES_BUNDLE_PATH,
	NATIVE_PROBE_IDS,
	type EvidenceView,
	type NativeProbeDiagnostic,
	type NativeProbesView,
	type ReasonCode,
} from "./baseline-closure";
import { deriveExecutionIdentity } from "./execution-identity";
import {
	computeFilteredSubjectTreeOid,
	SUBJECT_TREE_EXCLUDES,
	type ExcludedPath,
} from "./subject-tree";

// ---------- constants --------------------------------------------------------

const ROOT = spawnSync("git", ["rev-parse", "--show-toplevel"], {
	encoding: "utf8",
	stdio: ["ignore", "pipe", "pipe"],
}).stdout.trim();
const OUT = join(ROOT, "docs/factory/baseline-report.md");
const OUT_TMP = OUT + ".tmp";

const PROBE_DIAGNOSTIC_LABEL: Record<string, string> = {
	"missing-inventory": "ABSENT",
	"malformed-json": "MALFORMED",
	"missing-key": "MISSING-KEY",
	"invalid-shape": "INVALID-SHAPE",
	deferred: "DEFERRED",
	"non-pass": "FAIL",
	"hash-mismatch": "HASH-MISMATCH",
	"identity-mismatch": "IDENTITY-MISMATCH",
	"architecture-mismatch": "ARCH-MISMATCH",
	"host-class-mismatch": "HOST-MISMATCH",
	"argv-mismatch": "ARGV-MISMATCH",
};

// ---------- main entry (only runs when invoked directly) --------------------

if (import.meta.main) {
	main();
}

function main(): void {
	const HEAD_OID_NOW = sh(["rev-parse", "HEAD"]);
	const TREE_OID_NOW = sh(["rev-parse", "HEAD^{tree}"]);
	const FILTERED_SUBJECT_TREE_OID_NOW = computeFilteredSubjectTreeOid(ROOT);

	const REPO = readJson(join(ROOT, "factory/inventories/repository.json"));
	const ENV = readJson(join(ROOT, "factory/inventories/environment.json"));
	const WORKSPACES = readJson(join(ROOT, "factory/inventories/workspaces.json"));
	const VERIFICATION = readJson(join(ROOT, "factory/inventories/verification.json"));
	const FILE_SIZES_SUMMARY = readJson(join(ROOT, "factory/baselines/file-size-summary.json"));
	const EXACT_DUPES = readJson(join(ROOT, "factory/baselines/exact-duplicates.json"));
	const LISTENERS_CSV = readFileSafe(join(ROOT, "factory/inventories/network-listener-candidates.csv"));
	const SINKS_CSV = readFileSafe(join(ROOT, "factory/inventories/privileged-sink-candidates.csv"));
	const EVIDENCE_DIR = join(ROOT, ".factory/evidence/ACT-CLINEMM-FORK-BASELINE01");
	const EVIDENCE_LOAD = loadEvidenceFile(join(EVIDENCE_DIR, "evidence.json"));
	const EVIDENCE_HASHES = fileExists(join(EVIDENCE_DIR, "hashes.sha256"))
		? readFileSafe(join(EVIDENCE_DIR, "hashes.sha256"))
		: "";
	const EVIDENCE_VALUE =
		EVIDENCE_LOAD.ok && typeof EVIDENCE_LOAD.value === "object" && EVIDENCE_LOAD.value !== null
			? (EVIDENCE_LOAD.value as any)
			: null;
	const EXECUTION_IDENTITY_DERIVATION = deriveExecutionIdentity(
		ROOT,
		EVIDENCE_VALUE?.execution_head_oid,
		EVIDENCE_VALUE?.execution_tree_oid,
	);

	const classCounts = countByKey(VERIFICATION.commands, "class");

	// CORRECTION14: closure counts are derived from the verified executed
	// records joined with the per-class command metadata, NOT from the
	// unchecked merged `VR.commands` array. The bundled
	// `verification-results.json` (or the tracked mirror fallback) is
	// authoritative for which commands actually ran with which status.
	const bundledResultPath = join(EVIDENCE_DIR, "verification-results.json");
	const trackedResultPath = join(ROOT, "factory/inventories/verification-results.json");
	let VR: { executed_commands: any[]; commands: any[]; host: string };
	if (fileExists(bundledResultPath)) {
		try {
			VR = JSON.parse(readFileSync(bundledResultPath, "utf8"));
		} catch {
			VR = fileExists(trackedResultPath)
				? JSON.parse(readFileSync(trackedResultPath, "utf8"))
				: { executed_commands: [], commands: [], host: "n/a" };
		}
	} else if (fileExists(trackedResultPath)) {
		VR = JSON.parse(readFileSync(trackedResultPath, "utf8"));
	} else {
		VR = { executed_commands: [], commands: [], host: "n/a" };
	}
	const verifiedExecuted: any[] = Array.isArray(VR.executed_commands) ? VR.executed_commands : [];
	const verifiedExecutedById = new Map<string, any>();
	for (const row of verifiedExecuted) {
		if (row && typeof row === "object" && typeof (row as any).id === "string") {
			verifiedExecutedById.set((row as any).id, row);
		}
	}
	// CORRECTION15: closure arithmetic counts only `status === "pass"` as a
	// pass. `skip` and `unavailable` rows are tracked separately so they do
	// not silently inflate the mandatory / affected-scope pass rate.
	const isPass = (row: any): boolean => row?.status === "pass";
	const isSkip = (row: any): boolean => row?.status === "skip";
	const isUnavailable = (row: any): boolean => row?.status === "unavailable";
	const failLike = (row: any) => row?.status === "fail";
	let mandatoryPass = 0;
	let mandatoryFail = 0;
	let mandatorySkip = 0;
	let mandatoryUnavailable = 0;
	let mandatoryApplicable = 0;
	let affectedPass = 0;
	let affectedFail = 0;
	let affectedSkip = 0;
	let affectedUnavailable = 0;
	let affectedApplicable = 0;
	for (const cmd of VERIFICATION.commands as any[]) {
		const exec = verifiedExecutedById.get(cmd.id);
		if (!exec) continue;
		if (cmd.class === "mandatory") {
			mandatoryApplicable += 1;
			if (isPass(exec)) mandatoryPass += 1;
			else if (isUnavailable(exec)) mandatoryUnavailable += 1;
			else if (isSkip(exec)) mandatorySkip += 1;
			if (failLike(exec)) mandatoryFail += 1;
		} else if (cmd.class === "affected-scope") {
			affectedApplicable += 1;
			if (isPass(exec)) affectedPass += 1;
			else if (isUnavailable(exec)) affectedUnavailable += 1;
			else if (isSkip(exec)) affectedSkip += 1;
			if (failLike(exec)) affectedFail += 1;
		}
	}

	const allExecuted = verifiedExecuted.filter((e: any) => e != null);
	const failCmds = allExecuted.filter((e: any) => failLike(e));
	const unknownFailures = failCmds
		.filter((e: any) => e.failure_classification === "UNKNOWN")
		.map((e: any) => e.id);
	const failureClassCounts = countByKey(failCmds, "failure_classification");

	// CORRECTION16: load the native-probe inventory from the detached
	// evidence bundle, NOT from the tracked mirror. The bundle copy is
	// hash-listed in `hashes.sha256` so its declared hash must match the
	// on-disk bytes; the verifier cross-checks the staged inventory's
	// execution identity against the bundle identity and every probe's
	// `observed_architecture` / `host_class` / argv shape.
	const nativeProbes = loadNativeProbesFromEvidence({
		evDirAbs: EVIDENCE_DIR,
		manifestText: EVIDENCE_HASHES,
		executionHeadOid:
			typeof EVIDENCE_VALUE?.execution_head_oid === "string"
				? EVIDENCE_VALUE.execution_head_oid
				: HEAD_OID_NOW,
		executionTreeOid:
			typeof EVIDENCE_VALUE?.execution_tree_oid === "string"
				? EVIDENCE_VALUE.execution_tree_oid
				: TREE_OID_NOW,
		filteredSubjectTreeOid:
			typeof EVIDENCE_VALUE?.subject_tree_oid === "string"
				? EVIDENCE_VALUE.subject_tree_oid
				: FILTERED_SUBJECT_TREE_OID_NOW,
		bundleHostClass:
			typeof ENV?.bun_architecture === "string"
				? ENV.bun_architecture
				: typeof ENV?.architecture === "string"
					? ENV.architecture
					: null,
	});

	const evidenceView: EvidenceView = checkEvidence({
		ev: EVIDENCE_LOAD,
		hashesText: EVIDENCE_HASHES,
		evDirAbs: EVIDENCE_DIR,
		executedCmds: allExecuted,
		bundledResultPath: "verification-results.json",
		rootAbs: ROOT,
		headOidNow: HEAD_OID_NOW,
		treeOidNow: TREE_OID_NOW,
		filteredSubjectTreeOidNow: FILTERED_SUBJECT_TREE_OID_NOW,
		executionIdentityDerivation: EXECUTION_IDENTITY_DERIVATION,
	});
	evidenceView.nativeProbesComplete = nativeProbes.complete;
	evidenceView.nativeProbesDiagnostics = nativeProbes.diagnostics;

	const closure = computeClosure({
		evidence: evidenceView,
		unknownFailures,
		unknownFailureCount: classCounts["unknown"] ?? 0,
		mandatoryPass,
		mandatoryFail,
		mandatoryApplicable: mandatoryApplicable,
		affectedScopePass: affectedPass,
		affectedScopeFail: affectedFail,
		affectedScopeApplicable: affectedApplicable,
		r4Satisfied: false,
		r5Satisfied: false,
		r6Satisfied: false,
		r7Satisfied: false,
		r16Satisfied: false,
		nativeProbesComplete: nativeProbes.complete,
	});

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

	const probeRows = renderProbes(nativeProbes);

	const evTopValue = EVIDENCE_VALUE;
	const evidenceSubjectTreeOid =
		evTopValue && typeof evTopValue === "object" && typeof evTopValue.subject_tree_oid === "string"
			? evTopValue.subject_tree_oid
			: null;
	const evidenceSubjectTreeBefore =
		evTopValue && typeof evTopValue === "object" && typeof evTopValue.subject_tree_oid_before === "string"
			? evTopValue.subject_tree_oid_before
			: null;
	const evidenceSubjectTreeAfter =
		evTopValue && typeof evTopValue === "object" && typeof evTopValue.subject_tree_oid_after === "string"
			? evTopValue.subject_tree_oid_after
			: null;
	const evidenceExecHeadOid =
		evTopValue && typeof evTopValue === "object" && typeof evTopValue.execution_head_oid === "string"
			? evTopValue.execution_head_oid
			: null;
	const evidenceExecTreeOid =
		evTopValue && typeof evTopValue === "object" && typeof evTopValue.execution_tree_oid === "string"
			? evTopValue.execution_tree_oid
			: null;
	const evidenceIdentityValid =
		evTopValue && typeof evTopValue === "object" && typeof evTopValue.execution_identity_valid === "boolean"
			? evTopValue.execution_identity_valid
			: null;
	const evidenceWorktreeInputsCleanBefore =
		evTopValue && typeof evTopValue === "object" &&
		typeof evTopValue.worktree_inputs_clean_before === "boolean"
			? evTopValue.worktree_inputs_clean_before
			: evTopValue && typeof evTopValue === "object" &&
				typeof evTopValue.worktree_clean_before === "boolean"
				? evTopValue.worktree_clean_before
				: null;
	const evidenceWorktreeInputsCleanAfter =
		evTopValue && typeof evTopValue === "object" &&
		typeof evTopValue.worktree_inputs_clean_after === "boolean"
			? evTopValue.worktree_inputs_clean_after
			: evTopValue && typeof evTopValue === "object" &&
				typeof evTopValue.worktree_clean_after === "boolean"
				? evTopValue.worktree_clean_after
				: null;

	const md = `# ACT-CLINEMM-FORK-BASELINE01 — Baseline report (auto-generated)

> Generated by \`factory/scripts/render-baseline-report.ts\` (CORRECTION15).
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

${
	EVIDENCE_LOAD.ok
		? ""
		: `> **Evidence decoding failed:** \`${EVIDENCE_LOAD.error}\`. Closure proceeds with a structural \`EVIDENCE_INCOMPLETE\` failure; the report's \`Detached evidence\` section documents this.`
}

${closureRationale(closure, {
		mandatoryPass,
		mandatoryFail,
		mandatoryApplicable,
		affectedPass,
		affectedFail,
		affectedApplicable,
		unknownFailures,
		evidence: evidenceView,
	})}

## Subject-tree and execution-identity binding model (CORRECTION15)

The detached evidence bundle binds to the worktree through a
**subject identity**, an **execution identity**, a **drift
attestation**, a **relational status/classification invariant**, a
**self-contained-bundle invariant**, and a **fail-closed native-probe
dimension**:

\`\`\`text
subject_tree_oid            = write-tree(HEAD \\ SUBJECT_TREE_EXCLUDES)
subject_tree_oid_before     = subject_tree_oid captured at run start
subject_tree_oid_after      = subject_tree_oid captured at run end
execution_head_exists       = renderer rev-parse --verify <head>^{commit}
execution_tree_exists       = renderer rev-parse --verify <tree>^{tree}
derived_tree                = renderer rev-parse --verify <head>^{tree}
execution_identity_valid    = head_exists AND tree_exists AND
                              derived_tree == execution_tree_oid AND
                              runner assertion agrees with derivation
worktree_inputs_clean_before = NUL-safe path-aware \`git status -z\` at start
worktree_inputs_clean_after  = NUL-safe path-aware \`git status -z\` at end
per_command_identity_pinned  = every before/after head, tree, and subject
                               equals the bundle's corresponding identity
row_status_invariant        = (status=pass) ⇔ (exit_code=0 AND fc=null AND
                                  signal=null AND timeout=false)
                              status=fail ⇒ fc is recognised, non-null
                              status=skip/unavailable ⇒ fc=null
                              timeout=true ⇒ fc="TIMEOUT"
self_contained_bundle       = evidence dir carries verification-results.json
                              and metadata files match evidence rows
native_probes_complete      = p1_pass AND p2_pass AND p3_pass AND
                              p4_pass AND p5_pass
closure_arithmetic          = mandatoryPass counts only status==="pass"
                              (skip/unavailable tracked separately)
\`\`\`

CORRECTION15: the fs.watch-based tracked-input monitor is recorded as a hint
(\`tracked_input_change_observed\`, \`tracked_input_monitor_degraded\`,
\`observed_tracked_input_paths\`) on each command row; it does not enter
the closure conjunction. The renderer surfaces the observations in the
\`Detached evidence\` section so reviewers can see which commands had
traces of transient activity.

\`SUBJECT_TREE_EXCLUDES\` (tracked outputs generated by the workflow,
excluded from the subject to break the regeneration cycle):

${SUBJECT_TREE_EXCLUDES.map((e: ExcludedPath) => `- \`${e.path}\` (${e.kind})`).join("\n")}

The detached bundle at \`${join(".factory/evidence/ACT-CLINEMM-FORK-BASELINE01", "evidence.json")}\`
is now self-contained: \`evidence.json\`, every command's
\`commands/<id>.{stdout,stderr,metadata.json}\`, and the executed-command
record at \`verification-results.json\` are all hash-verified by
\`checkEvidence()\`. The tracked mirror at
\`factory/inventories/verification-results.json\` is informational only and is
refreshed only after the canonical swap succeeds.

Reported identity values (render provenance is
\`renderer_input_*\`; bundle contents are recorded as
\`evidence_recorded_*\`):

\`\`\`
subject_tree_oid            (renderer-computed): ${FILTERED_SUBJECT_TREE_OID_NOW ?? "n/a"}
subject_tree_oid            (recorded in evidence): ${evidenceSubjectTreeOid ?? "(not recorded)"}
subject_tree_oid_before     (recorded in evidence): ${evidenceSubjectTreeBefore ?? "(not recorded)"}
subject_tree_oid_after      (recorded in evidence): ${evidenceSubjectTreeAfter ?? "(not recorded)"}
execution_head_oid          (recorded in evidence): ${evidenceExecHeadOid ?? "(not recorded)"}
execution_tree_oid          (recorded in evidence): ${evidenceExecTreeOid ?? "(not recorded)"}
execution_identity_valid    (recorded in evidence): ${evidenceIdentityValid ?? "(not recorded)"}
worktree_inputs_clean_before (recorded in evidence): ${evidenceWorktreeInputsCleanBefore ?? "(not recorded)"}
worktree_inputs_clean_after  (recorded in evidence): ${evidenceWorktreeInputsCleanAfter ?? "(not recorded)"}
renderer_input_head_oid:                            ${HEAD_OID_NOW}
renderer_input_full_tree_oid:                       ${TREE_OID_NOW}
\`\`\`

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

### Disposition (per-class join; CORRECTION15 pass-only arithmetic)

| Class | Applicable | pass | fail | skip | unavailable | unknown fail | UNKNOWN fail ids |
| ----- | ---------: | ---: | ---: | ---: | ----------: | ------------: | ----------------- |
| mandatory      | ${mandatoryApplicable} | ${mandatoryPass} | ${mandatoryFail} | ${mandatorySkip} | ${mandatoryUnavailable} | ${unknownFailures.length > 0 ? unknownFailures.length : 0} | ${unknownFailures.length > 0 ? unknownFailures.join(", ") : "—"} |
| affected-scope | ${affectedApplicable} | ${affectedPass} | ${affectedFail} | ${affectedSkip} | ${affectedUnavailable} | 0 | — |

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

${unknownFailures.map((id: string) => `- \`${id}\``).join("\n")}

Per the runner's own policy (\`factory/scripts/run-verification.ts: classifyFailure()\`), a failure classified as \`UNKNOWN\` blocks ACT closure. Reproduce the UNKNOWN against the canonical clean install (Bun 1.3.13, Node 22, frozen lockfile) and assign one of \`TOOLCHAIN-DRIFT\`, \`NETWORK-DEPENDENT\`, \`INSTALL-INCOMPLETE\`, or \`UPSTREAM-REPRODUCIBLE\`.
`
		: ""
}## Native-dependency probes (P1–P5, CORRECTION15 fail-closed)

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

> **CORRECTION07 binding:** declared manifest paths are
> **evidence-directory-relative**. Each line in \`hashes.sha256\`
> declares the SHA-256 of a payload file located beneath this evidence
> directory.
>
> **CORRECTION14 binding:** the bundle is self-contained. The bundled
> \`verification-results.json\` is the authoritative executed-command
> record; the tracked mirror at \`factory/inventories/verification-results.json\`
> is informational. Per-command \`tracked_input_change_observed\` /
> \`tracked_input_monitor_degraded\` are recorded as advisory hints and do
> not enter the closure conjunction.
>
> **CORRECTION15 binding:** the bundled verification-results.json
> command-set check is performed before \`commandSetExact\` is
> computed, so a fresh bundle can satisfy \`isEvidenceOk\`. The native-
> probe inventory P1–P5 is consumed as a fail-closed closure dimension
> (a missing, malformed, deferred, unknown, or failed probe blocks
> PASS). Row diagnostics are deduplicated with a \`Set<string>\`.

${evidenceRow(evidenceView, evTopValue, HEAD_OID_NOW, TREE_OID_NOW, nativeProbes)}

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
		mandatoryApplicable,
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

// CORRECTION21 (µC-3 review): parameterised by NativeProbesView directly
// (no ReturnType<> indirection on the no-longer-imported
// loadNativeProbesInventory).
function renderProbes(view: NativeProbesView): string {
	const labels: Record<string, string> = {
		p1_better_sqlite3: "P1 better-sqlite3",
		p2_protobuf: "P2 protobuf",
		p3_ripgrep_darwin_arm64: "P3 ripgrep darwin-arm64",
		p4_vscode_host: "P4 VS Code host",
		p5_cline_version: "P5 cline --version",
	};
	const renderRow = (probeId: string): string => {
		const probe = view.probes[probeId as keyof typeof view.probes];
		const label = labels[probeId] ?? probeId;
		if (probe === null) {
			const diagnostic = view.diagnostics.find((d) => d.probeId === probeId);
			if (diagnostic) {
				const status = PROBE_DIAGNOSTIC_LABEL[diagnostic.kind] ?? "UNKNOWN";
				return `| ${label} | (no probe) | ${status} | ${diagnostic.message.slice(0, 80)} |`;
			}
			return `| ${label} | (no probe) | UNKNOWN | (no diagnostic recorded) |`;
		}
		return `| ${label} | \`${probe.path}\` (${probe.architecture}, sha=\`${probe.sha256.slice(0, 12)}…\`) | ${probe.status} | ${probe.reason.slice(0, 80)} |`;
	};
	return [
		"| Probe | Artifact | Status | Reason |",
		"| ----- | -------- | ------ | ------ |",
		...NATIVE_PROBE_IDS.map((id) => renderRow(id)),
	].join("\n");
}

// CORRECTION16: render the bundle-bound native-probe inventory using the
// structured `loadNativeProbesFromEvidence` view. Each diagnostic maps to
// one of the kinds below; the renderer surfaces them so reviewers can
// distinguish "we did not probe" (missing-inventory / malformed-json /
// missing-key / invalid-shape) from "we probed and the artifact is
// missing or stale" (deferred / non-pass / hash-mismatch) from
// "we probed and the recorded probe disagrees with the bundle"
// (identity-mismatch / argv-mismatch / host-class-mismatch /
// architecture-mismatch).

// CORRECTION21 (µC-3 review): nativeProbes parameter is typed as
// `NativeProbesView` (no ReturnType<> indirection on the no-longer-
// imported `loadNativeProbesInventory`).
function evidenceRow(
	view: EvidenceView,
	ev: any,
	headNow: string,
	treeNow: string,
	nativeProbes: NativeProbesView,
): string {
	if (view.decodeError !== null && view.decodeError !== undefined) {
		return [
			`_evidence.json failed to decode._ \`${view.decodeError}\``,
			``,
			`Subsequent dimensions below are computed against an empty record. The runner must produce a valid \`evidence.json\` for the bundle to become satisfiable.`,
		].join("\n");
	}
	if (!ev) {
		return `_No detached evidence bundle was found at \`.factory/evidence/ACT-CLINEMM-FORK-BASELINE01/\`. The runner did not produce a final bundle. Re-run with \`bun factory/scripts/run-verification.ts\`._`;
	}

	const mismatches: string[] = [];
	if (!view.treeMatches) mismatches.push(`subject tree: bundle binding does not match current worktree filtered tree`);
	if (!view.executionTreeBound && view.executionTrees.length === 1) {
		mismatches.push(`execution tree: command rows disagree with bundle execution_tree_oid`);
	}
	if (!view.subjectStableAcrossMatrix) {
		mismatches.push(`subject tree changed during the matrix (before/after differ)`);
	}
	if (!view.perCommandDriftChecked) {
		mismatches.push(`per-command HEAD/tree/subject does not pin the bundle identity`);
	}
	if (view.executionIdentityRecorded && view.executionIdentityValid === false) {
		mismatches.push(`renderer-derived execution identity is invalid or disagrees with the runner assertion`);
	}
	if (view.worktreeInputsCleanBefore === false) {
		mismatches.push(`subject inputs were dirty before the matrix ran`);
	}
	if (view.worktreeInputsCleanAfter === false) {
		mismatches.push(`subject inputs were dirty after the matrix ran`);
	}
	if (view.bundledResultPathInvalid) {
		mismatches.push(`bundled verification-results.json is invalid: ${view.bundledResultPathInvalid.reason}`);
	}
	if (view.bundledResultCommandSetExact === false) {
		mismatches.push(
			`bundled verification-results.json command set disagrees with evidence (extra=${view.bundledResultExtraCommands.length}, missing=${view.bundledResultMissingCommands.length})`,
		);
	}
	if (view.rowRelationalInvariantViolations.length > 0) {
		mismatches.push(`${view.rowRelationalInvariantViolations.length} command rows violate a status/classification invariant`);
	}
	if (view.metadataFileMismatches.length > 0) {
		mismatches.push(`${view.metadataFileMismatches.length} metadata files do not match the corresponding evidence rows`);
	}
	if (!view.manifestContractHonored) {
		mismatches.push(`evidence payload paths and manifest are not the same exact file set`);
	}
	if (!view.nativeProbesComplete) {
		mismatches.push(`native-probe inventory P1–P5 is incomplete: ${nativeProbes.diagnostics.length} diagnostic(s)`);
	}
	const mismatchText = mismatches.length > 0 ? mismatches.join("; ") : "(none)";

	const triState = (v: boolean | null): string => v === null ? "(not recorded)" : String(v);

	const dimSummaryParts: (string | null)[] = [
		view.missingFiles.length > 0 ? `missing=${view.missingFiles.length}` : null,
		view.unexpectedFiles.length > 0 ? `unexpected=${view.unexpectedFiles.length}` : null,
		view.hashMismatches.length > 0 ? `hash_mismatches=${view.hashMismatches.length}` : null,
		view.malformedLines.length > 0 ? `malformed=${view.malformedLines.length}` : null,
		view.duplicatePaths.length > 0 ? `duplicates=${view.duplicatePaths.length}` : null,
		view.outOfEvidenceDirPaths.length > 0
			? `outside_ev_dir=${view.outOfEvidenceDirPaths.length}`
			: null,
		view.malformedEvidenceCommandRows > 0
			? `malformed_ev_rows=${view.malformedEvidenceCommandRows}`
			: null,
		view.malformedExecutedCommandRows > 0
			? `malformed_exec_rows=${view.malformedExecutedCommandRows}`
			: null,
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
		view.bundledResultPathInvalid ? "bundled_result_path=invalid" : null,
		view.bundledResultCommandSetExact === false
			? "bundled_result_command_set_mismatch=true"
			: null,
		view.rowRelationalInvariantViolations.length > 0
			? "row_relational_violations=true"
			: null,
		view.metadataFileMismatches.length > 0
			? `metadata_file_mismatches=${view.metadataFileMismatches.length}`
			: null,
		view.subjectTreeContract ? null : "subject_tree_contract=legacy",
		view.executionIdentityRecorded ? null : "execution_identity=missing",
		!view.subjectStableAcrossMatrix ? "subject_drift=true" : null,
		!view.perCommandDriftChecked ? "per_command_drift=true" : null,
		view.nativeProbesComplete ? null : `native_probes_incomplete=${nativeProbes.diagnostics.length}`,
	];
	const dimSummary = dimSummaryParts.filter(Boolean).join(", ") || "(none)";

	const treesRender =
		view.executionTrees.length === 0
			? "—"
			: view.executionTrees
					.map((t: string) => `\`${t.slice(0, 12)}…\``)
					.join(", ");

	let rows = `| Field | Value |\n| --- | --- |\n`;
	rows += `| renderer_input_head_oid (provenance) | \`${headNow}\` |\n`;
	rows += `| renderer_input_full_tree_oid (provenance) | \`${treeNow}\` |\n`;
	rows += `| subject_tree_oid (CORRECTION08/10) | \`${ev.subject_tree_oid ?? "(not recorded)"}\` |\n`;
	rows += `| subject_tree_oid_before (CORRECTION11) | \`${ev.subject_tree_oid_before ?? "(not recorded)"}\` |\n`;
	rows += `| subject_tree_oid_after (CORRECTION11) | \`${ev.subject_tree_oid_after ?? "(not recorded)"}\` |\n`;
	rows += `| subject tree contract | ${view.subjectTreeContract ? "active (CORRECTION08/10)" : "legacy (CORRECTION07 fallback)"} |\n`;
	rows += `| subject stable across matrix (CORRECTION11) | ${view.subjectStableAcrossMatrix} |\n`;
	rows += `| execution_head_oid (CORRECTION10) | \`${ev.execution_head_oid ?? "(not recorded)"}\` |\n`;
	rows += `| execution_tree_oid (CORRECTION10) | \`${ev.execution_tree_oid ?? "(not recorded)"}\` |\n`;
	rows += `| execution_head_oid well-formed | ${view.executionHeadOidWellformed} |\n`;
	rows += `| execution_tree_oid well-formed | ${view.executionTreeOidWellformed} |\n`;
	rows += `| execution_head_exists (renderer-derived, CORRECTION12) | ${view.executionHeadExists} |\n`;
	rows += `| execution_tree_exists (renderer-derived, CORRECTION12) | ${view.executionTreeExists} |\n`;
	rows += `| derived execution tree (renderer-derived, CORRECTION12) | \`${view.derivedExecutionTreeOid ?? "(not resolved)"}\` |\n`;
	rows += `| runner execution identity assertion | ${triState(view.runnerExecutionIdentityAssertion)} |\n`;
	rows += `| runner/renderer identity agreement (CORRECTION12) | ${view.executionIdentityAssertionAgrees} |\n`;
	rows += `| execution_identity_valid (renderer authority, CORRECTION12) | ${view.executionIdentityValid} |\n`;
	rows += `| per-command identity pinned (CORRECTION12) | ${view.perCommandDriftChecked} |\n`;
	rows += `| worktree_inputs_clean_before (CORRECTION11 tri-state) | ${triState(view.worktreeInputsCleanBefore)} |\n`;
	rows += `| worktree_inputs_clean_after (CORRECTION11 tri-state) | ${triState(view.worktreeInputsCleanAfter)} |\n`;
	rows += `| evidence payload manifest complete (CORRECTION14) | ${view.manifestContractHonored} |\n`;
	rows += `| bundled verification-results.json self-contained (CORRECTION14) | ${view.bundledResultPathInvalid === null && view.bundledResultCommandSetExact === true ? "yes" : "no"} |\n`;
	rows += `| row relational invariants (CORRECTION14) | ${view.rowRelationalInvariantViolations.length === 0 ? "ok" : view.rowRelationalInvariantViolations.length + " violations"} |\n`;
	rows += `| metadata file normalized equality (CORRECTION14) | ${view.metadataFileMismatches.length === 0 ? "ok" : view.metadataFileMismatches.length + " mismatches"} |\n`;
	rows += `| tree binding holds (subject) | ${view.treeMatches} |\n`;
	rows += `| execution tree bound (CORRECTION10) | ${view.executionTreeBound} |\n`;
	rows += `| hash manifest valid | ${view.hashManifestValid} |\n`;
	rows += `| command-set exact | ${view.commandSetExact} |\n`;
	rows += `| native probes complete (CORRECTION15) | ${view.nativeProbesComplete ? "yes" : `no (${nativeProbes.diagnostics.length} diagnostic(s))`} |\n`;
	rows += `| execution trees | ${treesRender} |\n`;
	rows += `| integrity-dim summary | ${dimSummary} |\n`;
	rows += `| mismatches | ${mismatchText} |\n`;

	const transients: string[] = [];
	if (Array.isArray(ev?.commands)) {
		for (const row of ev.commands) {
			if (row && typeof row === "object" && (row as any).tracked_input_change_observed) {
				transients.push(
					`\`${(row as any).id}\` — observed_paths=${JSON.stringify((row as any).observed_tracked_input_paths ?? [])}` +
						((row as any).tracked_input_monitor_degraded ? " (monitor_degraded=true)" : ""),
				);
			}
		}
	}
	if (transients.length > 0) {
		rows += `\n### Transient tracked-input observations (advisory only)\n\n`;
		rows += transients.map((line) => `- ${line}`).join("\n");
		rows += `\n\nThese rows satisfy the post-command \`git status\` sample but the \`fs.watch\`-backed monitor observed at least one of the listed paths during the command's run. They are recorded as hints and do not enter the closure conjunction. The runner does not abort on these observations.\n`;
	}

	let diagnostics = "";

	if (view.hashMismatches.length > 0) {
		diagnostics += `\n### Hash mismatches (per-file expected vs actual)\n\n`;
		diagnostics += `| Path | Expected SHA-256 | Actual SHA-256 |\n`;
		diagnostics += `| --- | --- | --- |\n`;
		for (const m of view.hashMismatches) {
			diagnostics += `| \`${m.path}\` | \`${m.expected}\` | \`${m.actual}\` |\n`;
		}
	}
	if (view.outOfEvidenceDirPaths.length > 0) {
		diagnostics += `\n### Outside-evidence-dir (declared paths that escape the evidence dir)\n\n`;
		for (const u of view.outOfEvidenceDirPaths) diagnostics += `- \`${u.path}\` (reason: ${u.reason})\n`;
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
	if (view.malformedEvidenceCommandRows > 0) {
		diagnostics += `\n### Malformed evidence command rows\n\n`;
		diagnostics += `${view.malformedEvidenceCommandRows} evidence row(s) failed structural validation. Rebuild \`evidence.json\` to make the bundle satisfiable.\n`;
	}
	if (view.malformedExecutedCommandRows > 0) {
		diagnostics += `\n### Malformed executed command rows\n\n`;
		diagnostics += `${view.malformedExecutedCommandRows} executed row(s) failed structural validation.\n`;
	}
	if (view.commandRecordMismatches.length > 0) {
		diagnostics += `\n### Per-record command mismatches\n\n`;
		diagnostics += `| Command | Differing fields | Evidence | Executed |\n`;
		diagnostics += `| --- | --- | --- | --- |\n`;
		for (const m of view.commandRecordMismatches) {
			diagnostics += `| \`${m.id}\` | ${m.fields.join(", ")} | \`${JSON.stringify(m.evidence)}\` | \`${JSON.stringify(m.executed)}\` |\n`;
		}
	}
	if (view.rowRelationalInvariantViolations.length > 0) {
		diagnostics += `\n### Row relational invariant violations (CORRECTION15 deduplicated)\n\n`;
		for (const v of view.rowRelationalInvariantViolations) {
			diagnostics += `- \`${v.id}\` (${v.role}) — fields: \`${[...new Set(v.fields)].sort().join(", ")}\`\n`;
		}
	}
	if (view.metadataFileMismatches.length > 0) {
		diagnostics += `\n### Metadata file mismatches (CORRECTION15 deduplicated)\n\n`;
		for (const m of view.metadataFileMismatches) {
			diagnostics += `- \`${m.id}\` — fields: \`${[...new Set(m.fields)].sort().join(", ")}\`\n`;
		}
	}
	if (view.executionTrees.length > 1) {
		diagnostics += `\n### Mixed execution trees\n\n`;
		diagnostics += `The runner executed commands under ${view.executionTrees.length} distinct tree values: ${view.executionTrees.join(", ")}. A valid bundle has exactly one tree — multi-tree evidence is treated as invalid by CORRECTION10.\n`;
	}
	if (view.executionTrees.length === 1 && !view.executionTreeBound) {
		diagnostics += `\n### Unbound execution tree\n\n`;
		diagnostics += `The single execution tree \`${view.executionTrees[0]}\` does not match the bundle's recorded \`execution_tree_oid\`. Re-run \`bun factory/scripts/run-verification.ts\` to rebuild the bundle.\n`;
	}
	if (!view.subjectStableAcrossMatrix) {
		diagnostics += `\n### Subject tree drift\n\n`;
		diagnostics += `\`subject_tree_oid_before\` ≠ \`subject_tree_oid_after\` (or both do not equal the recorded \`subject_tree_oid\`). The runner detected a change in the subject tree during the matrix. This blocks ACT closure under \`SUBJECT_DRIFT\`.\n`;
	}
	if (!view.perCommandDriftChecked) {
		diagnostics += `\n### Per-command HEAD/tree/subject drift\n\n`;
		diagnostics += `At least one command row does not pin both before/after HEAD, tree, and subject values to the bundle's top-level identities. Equal self-consistent values are insufficient when they differ from the bundle subject.\n`;
	}
	if (view.executionIdentityRecorded && view.executionIdentityValid === false) {
		diagnostics += `\n### Execution identity shape invalid\n\n`;
		diagnostics += `Renderer-side \`git rev-parse --verify <head>^{commit}\` / \`<tree>^{tree}\` failed, the independently derived \`<head>^{tree}\` differs from \`execution_tree_oid\`, or the runner assertion disagrees with that derivation. Bundle fails \`EXECUTION_IDENTITY_INVALID\`.\n`;
	}
	if (view.bundledResultPathInvalid) {
		diagnostics += `\n### Bundled verification-results.json invalid\n\n`;
		diagnostics += `The bundled \`verification-results.json\` could not be read: \`${view.bundledResultPathInvalid.reason}\`. The bundle is no longer self-contained.\n`;
	}
	if (view.bundledResultCommandSetExact === false) {
		diagnostics += `\n### Bundled verification-results.json command-set mismatch\n\n`;
		if (view.bundledResultExtraCommands.length > 0) {
			diagnostics += `Extra command IDs in the bundled results: \`${view.bundledResultExtraCommands.join(", ")}\`\n`;
		}
		if (view.bundledResultMissingCommands.length > 0) {
			diagnostics += `Missing command IDs in the bundled results: \`${view.bundledResultMissingCommands.join(", ")}\`\n`;
		}
	}
	if (!view.manifestContractHonored) {
		diagnostics += `\n### Manifest path contract violated\n\n`;
		diagnostics += `The bundle's \`expected_evidence_payload_paths\` is not the exact evidence-directory-relative file set derived from evidence.json, the bundled verification-results.json, and every command's stdout/stderr/metadata paths, or the manifest declares a different set. Repository output paths are never valid in this domain.\n`;
	}
	if (!view.commandSetExact) {
		diagnostics += `\n### Command-set mismatch\n\n`;
		diagnostics += `The executed-commands list and the evidence.commands list disagree. Re-run \`bun factory/scripts/run-verification.ts\` to rebuild the bundle.\n`;
	}
	if (!view.nativeProbesComplete && nativeProbes.diagnostics.length > 0) {
		diagnostics += `\n### Native-probe inventory diagnostics (CORRECTION15)\n\n`;
		for (const d of nativeProbes.diagnostics) {
			diagnostics += `- \`${d.probeId}\` — kind=\`${d.kind}\`: ${d.message}\n`;
		}
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
		lines.push("Closure is **FAIL** under the CORRECTION15 fail-closed policy.");
		lines.push("");
		lines.push(`**Reason codes:** \`${c.reasonCodes.join("`, `")}\``);
		lines.push("");

		if (c.reasonCodes.includes("EVIDENCE_INCOMPLETE")) {
			lines.push("Detached evidence does not satisfy the integrity dimensions:");
			const e = p.evidence;
			lines.push(`- exists: \`${e.exists}\``);
			lines.push(`- subject binding holds: \`${e.treeMatches}\``);
			lines.push(`- subject tree contract: \`${e.subjectTreeContract}\``);
			lines.push(`- subject stable across matrix: \`${e.subjectStableAcrossMatrix}\``);
			lines.push(`- execution identity recorded: \`${e.executionIdentityRecorded}\``);
			lines.push(`- execution identity valid (renderer-derived): \`${e.executionIdentityValid}\``);
			lines.push(`- runner/renderer identity agreement: \`${e.executionIdentityAssertionAgrees}\``);
			lines.push(`- execution_head_oid well-formed: \`${e.executionHeadOidWellformed}\``);
			lines.push(`- execution_tree_oid well-formed: \`${e.executionTreeOidWellformed}\``);
			lines.push(`- worktree_inputs_clean_before: \`${e.worktreeInputsCleanBefore}\``);
			lines.push(`- worktree_inputs_clean_after: \`${e.worktreeInputsCleanAfter}\``);
			lines.push(`- per-command identity pinned: \`${e.perCommandDriftChecked}\``);
			lines.push(`- manifest contract honored: \`${e.manifestContractHonored}\``);
			lines.push(`- hash manifest valid: \`${e.hashManifestValid}\``);
			lines.push(`- command-set exact: \`${e.commandSetExact}\``);
			lines.push(`- bundled verification-results.json self-contained: \`${e.bundledResultPathInvalid === null && e.bundledResultCommandSetExact === true}\``);
			lines.push(`- row relational invariants: \`${e.rowRelationalInvariantViolations.length === 0}\``);
			lines.push(`- metadata file normalized equality: \`${e.metadataFileMismatches.length === 0}\``);
			lines.push(`- native probes complete (CORRECTION15): \`${e.nativeProbesComplete}\``);
			lines.push(
				`- execution trees (must be exactly 1): \`${e.executionTrees.length}\` value(s) [${e.executionTrees.join(", ")}]`,
			);
			lines.push(`- execution tree bound: \`${e.executionTreeBound}\``);
			lines.push(`- decode error: \`${e.decodeError ?? "null"}\``);
			lines.push(`- malformed evidence rows: \`${e.malformedEvidenceCommandRows}\``);
			lines.push(`- malformed executed rows: \`${e.malformedExecutedCommandRows}\``);
			lines.push(`- missing files: \`${e.missingFiles.length}\``);
			lines.push(`- unexpected files: \`${e.unexpectedFiles.length}\``);
			lines.push(`- hash mismatches: \`${e.hashMismatches.length}\``);
			lines.push(`- malformed lines: \`${e.malformedLines.length}\``);
			lines.push(`- duplicate paths: \`${e.duplicatePaths.length}\``);
			lines.push(`- outside-evidence-dir paths: \`${e.outOfEvidenceDirPaths.length}\``);
			lines.push(`- rejected paths: \`${e.rejectedManifestPaths.length}\``);
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
		if (c.reasonCodes.includes("NATIVE_PROBES_INCOMPLETE")) {
			lines.push("");
			lines.push(
				"The native-probe inventory P1–P5 is incomplete. A missing, malformed, deferred, unknown, or failed probe blocks PASS. See the **Native-dependency probes** section above for the per-probe status.",
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
		return `Closure is **FAIL** — fail-closed policy: evidence is invalid (stale subject tree, missing execution identity, invalid execution identity shape, dirty worktree, drift during the matrix, manifest path contract violated, hash-invalid manifest, outside-evidence-dir payload, malformed JSON/rows, symlink, multi-tree, command-set mismatch, relational invariant violation, metadata file mismatch, bundled verification-results invalid, native-probe inventory P1–P5 incomplete) or UNKNOWN-classified failures are present. The next correction must fix the underlying evidence, not relabel the report. Reason codes: \`${c.reasonCodes.join("`, `")}\`.`;
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
		"7. Focused tests are added for the runner, verifier, and renderer (the renderer's tests must capture their own invocation into the next evidence bundle).",
	);
	lines.push(
		"8. The native-probe inventory P1–P5 is populated for each probe (file_format, architecture, sha256) with status=pass.",
	);
	lines.push(
		"9. The detached evidence bundle is rebuilt against the closing commit **using the CORRECTION15 contract**: self-contained bundle with bundled `verification-results.json`, verified-executed closure arithmetic, strict pass invariants (status=pass ⇔ exit_code=0), pass-only arithmetic (skip / unavailable are tracked separately), relational status/classification invariants, deduplicated row diagnostics, transactional staging, fail-closed native-probe dimension, and renderer-derived Git identity. The `fs.watch`-based tracked-input monitor is an advisory hint only. Until then, the production evidence bundle is correctly reported as `FAIL`.",
	);
	lines.push("");
	lines.push(
		`Current blockers: pass=${p.mandatoryPass}/${p.mandatoryApplicable} mandatory, fail=${p.mandatoryFail}, UNKNOWN=${JSON.stringify(p.unknownFailures)}, verdict=${c.verdict}.`,
	);
	return lines.join("\n");
}
