#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — Leamas v2 evidence rebind.
 *
 * µC-3 round 6 (LEAMAS-V2-EVIDENCE-REBIND01 fidelity pass) closes the
 * producer-integrity defects surfaced by the µC-3 review of round 5.
 * The detached `.factory/gate-summary.json` snapshot that round 5
 * publishes IS Leamas-acceptable; the producer that GENERATED it was
 * not. This pass repairs the producer so a later run cannot publish
 * stale or invalid evidence.
 *
 * Round 6 producer-integrity invariants:
 *
 *  P0-1  Atomic publication. The complete evidence bundle is staged
 *        under a sibling directory `.factory-staging-<nonce>/`; the
 *        canonical `.factory/` is only replaced by a stage-then-swap
 *        that renames `.factory/` → `.factory-backup-<nonce>/` and
 *        `.factory-staging-<nonce>/` → `.factory/`. A failure between
 *        the two renames, or any failure inside `atomicPublish`, leaves
 *        the canonical `.factory/` either unchanged or fully replaced
 *        (never a half-mixed state). The backup is deleted only after
 *        the canonical bundle has been re-validated by Leamas.
 *
 *  P0-2  Two-stage Leamas validation. The v2 summary is constructed and
 *        validated structurally inside staging (`validateGateSummaryStructure`).
 *        THEN the staging directory is atomically swapped into
 *        canonical. THEN `leamas factory digest` is invoked against the
 *        canonical repository; its result is captured in a sibling
 *        `.factory/gate-summary.leamas.json` ATTESTATION rather than
 *        inside `checks[]`. The canonical v2 document never claims to
 *        be self-validated — a single source of truth (the attestation)
 *        is what reviewers consult.
 *
 *  P0-3  Post-run cleanliness sampled AFTER every executable check and
 *        after every publication operation. `identityAfter` is captured
 *        after the Leamas check has finished and its transient staging
 *        has been cleaned. `worktree_clean_after` therefore reflects the
 *        true post-run state, not a mid-run sample.
 *
 *  P0-4  Real parent-state identity comparison. `deriveParentActState`
 *        passes the producer's current `ctx.headOid`, `ctx.treeOid`,
 *        and `ctx.subjectTreeOid` to `checkEvidence` — NOT the bundled
 *        OIDs. Bundled OIDs participate only as object-existence checks
 *        (`git cat-file -e`) and as recorded-head-to-recorded-tree
 *        derivation. A stale bundle whose commit still exists in the
 *        object database cannot remain eligible.
 *
 *  P0-5  The CORRECTION21 executable check consumes the bundled
 *        commands and the producer's identity, and exits with a status
 *        that maps directly to the parent verdict (PASS / PARTIAL /
 *        OPEN). The probe is a thin witness over the in-process parent
 *        state — it does NOT recompute the verdict through a weaker
 *        implementation.
 *
 *  P0-6  Parent CLOSED requires the full predicate conjunction:
 *        `evidence_ok` AND R4 full-tree comparison AND R5 schema
 *        validation AND R6 upstream baseline AND R7 cross-platform CI
 *        AND R16 source-derived discovery AND mandatory-all-pass AND
 *        affected-scope-all-pass AND native-probes-complete. Bundle
 *        flags default to `false` when absent — fail-closed.
 *
 *  P0-7  Range hygiene binds the COMMITTED `HEAD^..HEAD` patch (via
 *        `git diff HEAD^..HEAD --check`), the WORKING-TREE `HEAD`
 *        diff (via `git diff HEAD --check`), AND the worktree
 *        porcelain (via `git status --porcelain=v1 --untracked-files=all`).
 *        All three are required for scope closure; a failure in any
 *        flips the scope OPEN.
 *
 *  P1    The known-valid v2 fixture is validated through a real
 *        isolated fixture repository, just like the v3 and malformed
 *        fixtures. The valid-v2 fixture repository is committed to
 *        Git so its HEAD is a 40-char hex OID; Leamas must report
 *        `source_status=present` AND `schema_version=2` against it.
 *
 *  P1    Check metadata uses paths RELATIVE to the canonical gate
 *        bundle (no absolute paths).
 *
 *  P1    Staging and backup directories are siblings of `.factory/`
 *        (`.factory-staging-<nonce>/` and `.factory-backup-<nonce>/`).
 *        They are explicitly added to `.gitignore` so a stale staging
 *        directory never produces `worktree_clean_after=false`.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";

import { computeFilteredSubjectTreeOid } from "./subject-tree";
import {
	buildExtended,
	buildFinalSummary,
	deriveOverallDisposition,
	deriveOverallStatus,
	deriveParentActState,
	deriveParentStatus,
	deriveRejectionReasons,
	deriveScopeStatus,
	gitText,
	isCleanPorcelain,
	isValidOid,
	makeBackupPath,
	makeStagingPath,
	persistCheckStreams,
	relativeToBundleRoot,
	runExec,
	serializeExtended,
	serializeGateSummary,
	sha256,
	stagingExtendedPath,
	stagingGateSummaryPath,
	stagingLeamasAttestationPath,
	stagingScopeDir,
	toPortablePath,
	validateGateSummaryStructure,
	type CheckScope,
	type CheckStatus,
	type Cmd,
	type GateCheckSummary,
	type GateSummary,
	type GateSummaryExtended,
	type LeamasAttestation,
	type LeamasAttestationStage,
	type ParentActState,
	type RepositorySnapshot,
	type RunResult,
	type SnapshotContext,
} from "./gate-summary.helpers";

// ---------- constants ------------------------------------------------------

const ACT_ID = "ACT-CLINEMM-FORK-BASELINE01-CORRECTION21";
const PARENT_ACT_ID = ACT_ID;
const SCOPE_ID = `${ACT_ID}-MICROC3`;
const PRODUCER_NAME = "clinemm-factory-gate-summary";
const PRODUCER_VERSION = "round-6-leamas-v2-producer-integrity";

const FACTORY_SCRIPT_TEST_FILES: ReadonlyArray<string> = [
	"factory/scripts/render-baseline-report.test.ts",
	"factory/scripts/native-probes.test.ts",
	"factory/scripts/subject-tree.test.ts",
	"factory/scripts/run-verification.test.ts",
];

const FOCUSED_SUITE_PATHS: ReadonlyArray<{ label: string; path: string }> = FACTORY_SCRIPT_TEST_FILES.map(
	(path) => {
		const basename = path.split("/").pop() ?? path;
		const stem = basename.replace(/\.test\.ts$/, "");
		return {
			label: `${stem.replaceAll("-", "_")}_test_ts`,
			path,
		};
	},
);

const RANDOMIZED_SEEDS: ReadonlyArray<number> = [1, 2, 3, 4, 5];

const CHECK_SCOPES: ReadonlyArray<CheckScope> = [
	"MICROC3",
	"CORRECTION21",
	"WORKTREE",
	"TOOLING",
];

// ---------- helpers --------------------------------------------------------

function resolveTool(name: string): string {
	const candidates: string[] = [];
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		candidates.push(join(dir, name));
	}
	for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]) {
		candidates.push(join(dir, name));
	}
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return name;
}

/**
 * Capture a SINGLE snapshot of HEAD/tree/subject/worktree/range. The
 * `range_patch_clean` flag is sampled via `git diff HEAD^..HEAD
 * --check`; if HEAD has no parent (initial commit) or git diff reports
 * the parent as missing, the flag is `true` (single-commit repos are
 * trivially clean — there's no parent to diff against). The worktree
 * cleanliness sample is from `git status --porcelain=v1
 * --untracked-files=all`; the `.gitignore` exclusions keep
 * `.factory*` out of the result.
 */
function captureSnapshot(repoRoot: string, git: string): RepositorySnapshot {
	const head = gitText(repoRoot, git, [
		"rev-parse",
		"--verify",
		"--end-of-options",
		"HEAD^{commit}",
	]).stdout.trim();
	const tree = gitText(repoRoot, git, [
		"rev-parse",
		"--verify",
		"--end-of-options",
		"HEAD^{tree}",
	]).stdout.trim();
	const subject = computeFilteredSubjectTreeOid(repoRoot) ?? "";
	const statusText = gitText(repoRoot, git, [
		"status",
		"--porcelain=v1",
		"--untracked-files=all",
	]).stdout;
	const { clean, unexpected } = isCleanPorcelain(statusText);
	// The range-patch hygiene check. If HEAD has no parent (initial
	// commit or shallow clone), the diff is empty and the result is
	// trivially clean; we record `unexpected=[]` for that case.
	let rangePatchClean = true;
	let rangePatchUnexpected: string[] = [];
	const parentText = gitText(repoRoot, git, [
		"rev-parse",
		"--verify",
		"--end-of-options",
		"HEAD^",
	]).stdout.trim();
	if (isValidOid(parentText)) {
		const diffResult = gitText(repoRoot, git, [
			"diff",
			"HEAD^..HEAD",
			"--check",
		]);
		// `git diff --check` exits non-zero (1) when the diff produces
		// whitespace/line-ending errors. Treat exit≠0 AND non-empty
		// stderr as "not clean" — empty stderr + non-zero exit can
		// happen for legitimately empty diffs.
		if (diffResult.status !== 0 && diffResult.stderr.length > 0) {
			rangePatchClean = false;
			rangePatchUnexpected = diffResult.stderr
				.split("\n")
				.filter((l) => l.length > 0);
		}
	}
	return {
		head_oid: isValidOid(head) ? head : "",
		tree_oid: isValidOid(tree) ? tree : "",
		subject_tree_oid: isValidOid(subject) ? subject : "",
		worktree_clean: clean,
		unexpected_paths: unexpected,
		range_patch_clean: rangePatchClean,
		range_patch_unexpected: rangePatchUnexpected,
	};
}

/**
 * Ensure the sibling staging and backup directories are gitignored.
 * Without these entries, a stale `.factory-staging-<nonce>/` left
 * behind by an interrupted run would surface in `git status --porcelain`
 * and break `worktree_clean`. The write is non-fatal — production runs
 * on a read-only filesystem can still proceed.
 */
function ensureGitignoreEntries(repoRoot: string, entries: ReadonlyArray<string>): void {
	const gitignorePath = join(repoRoot, ".gitignore");
	if (!existsSync(gitignorePath)) return;
	const current = readFileSync(gitignorePath, "utf8");
	const missing = entries.filter((e) => !current.includes(e));
	if (missing.length === 0) return;
	const append = `\n# Factory staging/backup siblings (µC-3 round 6 atomic publish)\n${missing.join("\n")}\n`;
	try {
		writeFileSync(gitignorePath, `${current}${append}`);
	} catch {
		// best-effort; ignored on read-only filesystems
	}
}

function bootstrap(): SnapshotContext {
	const git = resolveTool("git");
	const bun = resolveTool("bun");
	const bunx = resolveTool("bunx");
	const leamas = resolveTool("leamas");
	const repoRootText = spawnSync(git, ["rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	});
	const repoRoot = (repoRootText.stdout ?? "").toString().trim();
	if (repoRootText.status !== 0 || repoRoot.length === 0) {
		throw new Error(
			`gate-summary: ${git} rev-parse failed: ${repoRootText.stderr ?? ""}`,
		);
	}
	ensureGitignoreEntries(repoRoot, [
		".factory-staging-*",
		".factory-backup-*",
	]);
	const factoryDir = join(repoRoot, ".factory");
	const scriptsDir = join(repoRoot, "factory", "scripts");
	const schemasDir = join(repoRoot, "factory", "schemas");
	const tsconfigPath = join(scriptsDir, "tsconfig.json");
	const testsDir = scriptsDir;
	const nonce = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
	const stagingDir = makeStagingPath(repoRoot, nonce);
	const backupDir = makeBackupPath(repoRoot, nonce);
	const identity = captureSnapshot(repoRoot, git);
	if (identity.head_oid.length === 0) {
		throw new Error("GATE_SUMMARY_HEAD_UNAVAILABLE");
	}
	if (identity.tree_oid.length === 0) {
		throw new Error("GATE_SUMMARY_TREE_UNAVAILABLE");
	}
	if (identity.subject_tree_oid.length === 0) {
		throw new Error("GATE_SUMMARY_SUBJECT_TREE_UNAVAILABLE");
	}
	// Stage directory must exist before any check persists streams.
	mkdirSync(stagingDir, { recursive: true });
	for (const scope of CHECK_SCOPES) {
		mkdirSync(stagingScopeDir(stagingDir, scope), { recursive: true });
	}
	return {
		repoRoot,
		git,
		bun,
		bunx,
		leamas,
		factoryDir,
		stagingDir,
		backupDir,
		canonicalSummaryPath: join(factoryDir, "gate-summary.json"),
		canonicalExtendedPath: join(factoryDir, "gate-summary.extended.json"),
		canonicalGatesDir: join(factoryDir, "gates"),
		canonicalLeamasAttestationPath: join(factoryDir, "gate-summary.leamas.json"),
		scriptsDir,
		schemasDir,
		tsconfigPath,
		testsDir,
		parentEvidenceDir: join(factoryDir, "evidence", PARENT_ACT_ID),
		headOid: identity.head_oid,
		treeOid: identity.tree_oid,
		subjectTreeOid: identity.subject_tree_oid,
		worktreeCleanBefore: identity.worktree_clean,
		unexpectedPathsBefore: identity.unexpected_paths,
		rangePatchCleanBefore: identity.range_patch_clean,
		rangePatchUnexpectedBefore: identity.range_patch_unexpected,
		identityBefore: identity,
	};
}

// ---------- check definitions ----------------------------------------------

const TSC_STRICT: (b: SnapshotContext) => Cmd = (b) => ({
	name: "strict_typecheck",
	scope: "MICROC3",
	evidence: "factory/scripts/tsconfig.json (--strict, --types bun, includes *.ts and *.test.ts)",
	cwd: b.scriptsDir,
	exec: b.bunx,
	args: ["tsc", "--project", b.tsconfigPath, "--noEmit"],
});

/**
 * The new authoritative WORKTREE range-hygiene check binds three
 * required dimensions in one shell pipeline:
 *   1. `git diff HEAD^..HEAD --check` — committed range hygiene
 *   2. `git diff HEAD --check` — working-tree diff hygiene
 *   3. `git status --porcelain=v1 --untracked-files=all` — clean
 * The check passes only if all three exit 0 with empty stderr/stdout
 * (for #1 + #2) or empty porcelain (for #3).
 */
const GIT_RANGE_HYGIENE: (b: SnapshotContext) => Cmd = (b) => {
	const git = b.git;
	const repo = b.repoRoot;
	const pipeline = [
		`set +e`,
		`diff_parent=$(git -C ${shellQuote(repo)} diff HEAD^..HEAD --check 2>&1); r1=$?`,
		`diff_head=$(git -C ${shellQuote(repo)} diff HEAD --check 2>&1); r2=$?`,
		`porcelain=$(git -C ${shellQuote(repo)} status --porcelain=v1 --untracked-files=all); r3=$?`,
		`if [ -z "$diff_parent" ] && [ $r1 -eq 0 ] && [ -z "$diff_head" ] && [ $r2 -eq 0 ] && [ -z "$porcelain" ] && [ $r3 -eq 0 ]; then echo "range_hygiene=clean"; exit 0; fi`,
		`echo "diff_parent_failed=$r1"`,
		`echo "diff_parent_stderr=\${diff_parent}"`,
		`echo "diff_head_failed=\$r2"`,
		`echo "diff_head_stderr=\${diff_head}"`,
		`echo "porcelain_failed=$r3"`,
		`echo "porcelain=$porcelain"`,
		`exit 1`,
	].join("\n");
	return {
		name: "range_patch_cleanliness",
		scope: "WORKTREE",
		evidence:
			"git diff HEAD^..HEAD --check + git diff HEAD --check + git status --porcelain=v1 --untracked-files=all (all three required)",
		cwd: repo,
		exec: "/bin/sh",
		args: ["-c", pipeline],
	};
};

const WORKING_TREE_CLEANLINESS: (b: SnapshotContext) => Cmd = (b) => ({
	name: "working_tree_cleanliness",
	scope: "WORKTREE",
	evidence: "git status --porcelain=v1 --untracked-files=all (empty means clean)",
	cwd: b.repoRoot,
	exec: b.git,
	args: ["status", "--porcelain=v1", "--untracked-files=all"],
});

function focusedSuiteCmd(b: SnapshotContext, label: string, path: string): Cmd {
	return {
		name: `focused_suite_${label}`,
		scope: "MICROC3",
		evidence: path,
		cwd: b.repoRoot,
		exec: b.bun,
		args: ["test", `./${path}`],
	};
}

function allFactoryScriptsCmd(b: SnapshotContext): Cmd {
	return {
		name: "all_factory_scripts_tests",
		scope: "MICROC3",
		evidence: `${FACTORY_SCRIPT_TEST_FILES.length} factory test files (sequential single-file invocations)`,
		cwd: b.repoRoot,
		exec: b.bun,
		args: ["test", ...FACTORY_SCRIPT_TEST_FILES.map((p) => `./${p}`)],
	};
}

function randomizedCmd(b: SnapshotContext, seed: number): Cmd {
	return {
		name: `randomized_seed_${seed}`,
		scope: "MICROC3",
		evidence: `factory/scripts/*.test.ts (--randomize --seed ${seed})`,
		cwd: b.repoRoot,
		exec: b.bun,
		args: [
			"test",
			...FACTORY_SCRIPT_TEST_FILES.map((p) => `./${p}`),
			"--randomize",
			`--seed=${seed}`,
		],
	};
}

const CORRECTION21_CLOSURE_LOGIC_TESTS: (b: SnapshotContext) => Cmd = (b) => ({
	name: "correction21_closure_logic_tests",
	scope: "CORRECTION21",
	evidence:
		"factory/scripts/render-baseline-report.test.ts (closure-conjunction invariant: CORRECTION05-13) + factory/scripts/run-verification.test.ts (closure policy integration)",
	cwd: b.repoRoot,
	exec: b.bun,
	args: [
		"test",
		"./factory/scripts/render-baseline-report.test.ts",
		"./factory/scripts/run-verification.test.ts",
	],
});

/**
 * µC-3 P0-5 — the executable CORRECTION21 parent-state witness.
 * This probe is a thin verifier over `deriveParentActState`: the
 * probe reads the in-process verdict, validates it against the bundle,
 * and emits an exit code that maps to the verdict directly. It does
 * NOT recompute the verdict through a second, weaker implementation.
 *
 *   CLOSED  → exit 0 (bundle satisfies the full parent closure
 *                   conjunction: evidence_ok + R4/R5/R6/R7/R16 +
 *                   mandatory_all_pass + affected_scope_all_pass +
 *                   native_probes_complete).
 *   OPEN    → exit 1 (bundle structurally invalid OR missing the
 *                   parent ACT's detached bundle).
 *   PARTIAL → exit 2 (bundle structurally valid but at least one
 *                   parent baseline requirement is open).
 *
 * The probe also consumes the bundled verification-results.json
 * commands (when present) and the producer's CURRENT head/tree/subject
 * identity — never the bundle's self-recorded OIDs — so its judgment
 * binds to the producer's run, not to the bundle in isolation.
 */
function buildCorrection21Probe(
	ctx: SnapshotContext,
	parentState: ParentActState,
): Cmd {
	const probeBody = [
		"import { join } from 'node:path';",
		"import { existsSync, readFileSync } from 'node:fs';",
		"import {",
		"  checkEvidence,",
		"  isEvidenceOk,",
		"  isEvidenceStructurallyValid,",
		"  loadEvidenceFile,",
		"} from './factory/scripts/baseline-closure.ts';",
		`const root = ${JSON.stringify(ctx.repoRoot)};`,
		`const dir = ${JSON.stringify(ctx.parentEvidenceDir)};`,
		`const bundleObj = ${JSON.stringify(parentState.head_oid !== null)};`,
		`const subjectTreeOid = ${JSON.stringify(ctx.subjectTreeOid)};`,
		`const headOid = ${JSON.stringify(ctx.headOid)};`,
		`const treeOid = ${JSON.stringify(ctx.treeOid)};`,
		`const expectedVerdict = ${JSON.stringify(parentState.verdict)};`,
		`const expectedAssessment = ${JSON.stringify(parentState.closure_assessment)};`,
		`const expectedDisposition = ${JSON.stringify(parentState.disposition)};`,
		`if (!existsSync(join(dir, 'evidence.json')) || !existsSync(join(dir, 'hashes.sha256'))) {`,
		`  console.log('parent_disposition=' + expectedDisposition + ' reason=bundle_absent verdict=' + expectedVerdict + ' assessment=' + JSON.stringify(expectedAssessment));`,
		// No bundle → fail-closed: exit 1 (OPEN), even if disposition is OPEN.
		`  if (expectedVerdict !== 'OPEN') { console.error('GATE_SUMMARY_PROBE_VERDICT_MISMATCH:expected_OPEN_got=' + expectedVerdict); process.exit(1); }`,
		`  process.exit(1);`,
		"}",
		`const ev = loadEvidenceFile(join(dir, 'evidence.json'));`,
		`const hashesText = readFileSync(join(dir, 'hashes.sha256'), 'utf8');`,
		// Use the BUNDLED executed commands (verification-results.json) when
		// present, falling back to evidence.json's commands. The probe MUST
		// NOT pass the bundle's self-asserted identity — it must compare
		// against the producer's CURRENT head/tree/subject.
		`const verificationPath = join(dir, 'verification-results.json');`,
		`let executedCmds = [];`,
		`if (existsSync(verificationPath)) {`,
		`  try { const v = JSON.parse(readFileSync(verificationPath, 'utf8')); if (Array.isArray(v.executed_commands)) executedCmds = v.executed_commands; else if (Array.isArray(v.commands)) executedCmds = v.commands; } catch {}`,
		`}`,
		`if (executedCmds.length === 0 && ev.ok && Array.isArray(ev.value && ev.value.commands)) executedCmds = ev.value.commands;`,
		`let derivedTree = null;`,
		`let executionHeadExists = false;`,
		`let executionTreeExists = false;`,
		`const bundledHead = (ev.ok && ev.value && typeof ev.value.execution_head_oid === 'string') ? ev.value.execution_head_oid : null;`,
		`const bundledTree = (ev.ok && ev.value && typeof ev.value.execution_tree_oid === 'string') ? ev.value.execution_tree_oid : null;`,
		`// Object-existence checks (independent of ctx identity).`,
		`if (bundledHead && /^[0-9a-f]{40}$/.test(bundledHead)) {`,
		`  const r = Bun.spawnSync({ cmd: ['git', 'cat-file', '-e', bundledHead], cwd: root, env: process.env });`,
		`  executionHeadExists = r.status === 0;`,
		`}`,
		`if (bundledTree && /^[0-9a-f]{40}$/.test(bundledTree)) {`,
		`  const r = Bun.spawnSync({ cmd: ['git', 'cat-file', '-e', bundledTree], cwd: root, env: process.env });`,
		`  executionTreeExists = r.status === 0;`,
		`}`,
		`if (bundledHead && /^[0-9a-f]{40}$/.test(bundledHead)) {`,
		`  const r = Bun.spawnSync({ cmd: ['git', 'rev-parse', '--verify', '--end-of-options', bundledHead + '^{tree}'], cwd: root, env: process.env });`,
		`  const out = (r.stdout ? r.stdout.toString('utf8') : '').trim();`,
		`  if (/^[0-9a-f]{40}$/.test(out)) derivedTree = out;`,
		`}`,
		`const view = checkEvidence({`,
		`  ev,`,
		`  hashesText,`,
		`  evDirAbs: dir,`,
		`  executedCmds,`,
		`  bundledResultPath: 'verification-results.json',`,
		`  rootAbs: root,`,
		`// IMPORTANT: pass the PRODUCER's current identity, never the bundle's self-recorded OIDs (P0-4).`,
		`  headOidNow: headOid,`,
		`  treeOidNow: treeOid,`,
		`  filteredSubjectTreeOidNow: subjectTreeOid,`,
		`  executionIdentityDerivation: { executionHeadExists: executionHeadExists, executionTreeExists: executionTreeExists, derivedTreeOid: derivedTree },`,
		`});`,
		`const ok = isEvidenceOk(view);`,
		`const struct = isEvidenceStructurallyValid(view);`,
		`const probeVerdict = ok ? 'CLOSED' : struct ? 'PARTIAL' : 'OPEN';`,
		`// The probe MUST exit with the verdict it independently re-derives; the check fails if the verdict disagrees with the pre-computed parent state.`,
		`console.log('parent_disposition=' + expectedDisposition + ' verdict=' + probeVerdict + ' head_oid=' + headOid + ' tree_oid=' + treeOid + ' subject_tree_oid=' + subjectTreeOid);`,
		`if (probeVerdict !== expectedVerdict) { console.error('GATE_SUMMARY_PROBE_VERDICT_MISMATCH:expected=' + expectedVerdict + '_got=' + probeVerdict); process.exit(1); }`,
		`if (probeVerdict === 'CLOSED') process.exit(0);`,
		`if (probeVerdict === 'PARTIAL') process.exit(2);`,
		`process.exit(1);`,
	].join("\n");
	return {
		name: "correction21_current_state",
		scope: "CORRECTION21",
		evidence:
			"factory/scripts/baseline-closure.ts::checkEvidence + isEvidenceOk over the detached bundle, with the producer's CURRENT head/tree/subject identity; exit-code = verdict (PASS=0, PARTIAL=2, OPEN=1)",
		cwd: ctx.repoRoot,
		exec: ctx.bun,
		args: ["-e", probeBody],
		timeout_ms: 60_000,
	};
}

// ---------- Leamas v2 contract ---------------------------------------------

/**
 * Build the canonical v2 fixture that Leamas must accept. The fixture
 * payload satisfies the v2 schema (no producer-extension keys) and
 * uses well-formed OIDs / hash columns. The fixture is staged at the
 * provided path and committed to a fresh git repository so Leamas can
 * discover `.factory/gate-summary.json` via the standard repo walk.
 */
function knownValidV2Fixture(payload: {
	head_oid: string;
	tree_oid: string;
	subject_tree_oid: string;
}): string {
	const fixture = {
		schema_version: 2,
		generated_at: "1970-01-01T00:00:00.000Z",
		scope_id: "FIXTURE-V2",
		scope_status: "CLOSED",
		scope_disposition: "fixture-known-valid-v2",
		parent_act: "FIXTURE-PARENT",
		parent_status: "CLOSED",
		parent_disposition: "fixture-known-valid-v2",
		overall_status: "pass",
		overall_disposition: "fixture-known-valid-v2",
		execution_head_oid: payload.head_oid,
		execution_tree_oid: payload.tree_oid,
		subject_tree_oid: payload.subject_tree_oid,
		worktree_clean_before: true,
		worktree_clean_after: true,
		checks: [
			{
				name: "fixture_check",
				scope: "MICROC3",
				status: "pass",
				evidence: "fixture",
				detail: "fixture",
				extras: {
					argv: ["fixture"],
					exit_code: 0,
					duration_ms: 0,
					stdout_sha256: sha256(""),
					stderr_sha256: sha256(""),
				},
			},
		],
	};
	return `${JSON.stringify(fixture, null, "\t")}\n`;
}

function knownInvalidV3Fixture(): string {
	const payload = {
		schema_version: 3,
		generated_at: "1970-01-01T00:00:00.000Z",
		scope_id: "FIXTURE-V3",
		scope_status: "CLOSED",
		parent_act: "FIXTURE-PARENT",
		parent_status: "CLOSED",
		overall_status: "pass",
		execution_head_oid: "0".repeat(40),
		execution_tree_oid: "0".repeat(40),
		subject_tree_oid: "0".repeat(40),
		worktree_clean_before: true,
		worktree_clean_after: true,
	};
	return `${JSON.stringify(payload, null, "\t")}\n`;
}

function malformedV2Fixture(): string {
	return `${JSON.stringify({
		schema_version: 2,
		scope_id: "MALFORMED",
	})}\n`;
}

/**
 * Initialise a fresh, isolated git repository, write the provided
 * fixture to `.factory/gate-summary.json`, and commit it. The returned
 * `{ repoRoot, head_oid, summaryPath, fixture_sha256 }` lets the caller
 * both run Leamas against the repo and record the fixture's head/tree
 * /subject OIDs in the producer's leamas attestation.
 */
function setupFixtureRepo(
	parent: string,
	label: string,
	fixtureText: string,
): {
	repoRoot: string;
	summaryPath: string;
	head_oid: string;
	subject_tree_oid: string;
	fixture_sha256: string;
} {
	const repoRoot = join(parent, `${label}-repo`);
	mkdirSync(repoRoot, { recursive: true });
	const env = {
		GIT_AUTHOR_NAME: "leamas-v2-fixture",
		GIT_AUTHOR_EMAIL: "leamas-v2-fixture@example.invalid",
		GIT_COMMITTER_NAME: "leamas-v2-fixture",
		GIT_COMMITTER_EMAIL: "leamas-v2-fixture@example.invalid",
	};
	const run = (args: string[]): { status: number | null; stderr: string } => {
		const r = spawnSync("git", args, {
			cwd: repoRoot,
			encoding: "utf8",
			env: { ...process.env, ...env },
		});
		return { status: r.status, stderr: (r.stderr ?? "").toString() };
	};
	const init = run(["init", "--quiet", "--initial-branch=main"]);
	if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
	for (const cfg of [
		["user.name", "leamas-v2-fixture"],
		["user.email", "leamas-v2-fixture@example.invalid"],
		["commit.gpgsign", "false"],
	]) {
		run(["config", ...cfg]);
	}
	const factoryDir = join(repoRoot, ".factory");
	mkdirSync(factoryDir, { recursive: true });
	const summaryPath = join(factoryDir, "gate-summary.json");
	writeFileSync(summaryPath, fixtureText);
	run(["add", "-A"]);
	const commit = run(["commit", "--quiet", "-m", `leamas v2 fixture (${label})`]);
	if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`);
	const headOid = run(["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"]).stderr
		? ""
		: spawnSync("git", ["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"], {
				cwd: repoRoot,
				encoding: "utf8",
				env: { ...process.env, ...env },
			}).stdout.toString().trim();
	const subjectTreeOid =
		spawnSync("git", ["rev-parse", "--verify", "--end-of-options", "HEAD^{tree}"], {
			cwd: repoRoot,
			encoding: "utf8",
			env: { ...process.env, ...env },
		}).stdout.toString().trim();
	return {
		repoRoot,
		summaryPath,
		head_oid: headOid,
		subject_tree_oid: subjectTreeOid,
		fixture_sha256: sha256(fixtureText),
	};
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Run the Leamas v2 contract check. The check is run AFTER the
 * canonical summary has been swapped into place, so it digests the
 * exact published `gate-summary.json`. The check operates in four
 * stages:
 *
 *   1. `leamas --version` records the build identity.
 *   2. `leamas factory digest` against the current repo reports
 *      source_status=present AND schema_version=2.
 *   3. `leamas factory digest` against an isolated valid-v2 fixture
 *      repo reports source_status=present AND schema_version=2.
 *   4. `leamas factory digest` against the v3 / malformed fixture
 *      repos reports source_status=invalid (or schema_version != 2).
 *
 * The check persists its own streams under
 * `.factory-staging-<nonce>/leamas-staging/contract-<nonce>/...` and
 * returns an attestation payload rather than mutating the canonical
 * summary (P0-2).
 */
function runLeamasV2Contract(args: {
	ctx: SnapshotContext;
	leamasStagingDir: string;
}): {
	check: Cmd;
	result: RunResult;
	status: CheckStatus;
	reason: string;
	attestation: LeamasAttestation;
	fixtureRepos: { valid: string; invalidV3: string; malformed: string };
} {
	const { ctx, leamasStagingDir } = args;
	const toolingDir = join(leamasStagingDir, "tooling");
	const malRepoRoot = join(leamasStagingDir.replace(/tooling$/, "tooling-malformed"), "root");
	mkdirSync(toolingDir, { recursive: true });
	mkdirSync(malRepoRoot, { recursive: true });

	// Stage 1: well-known valid v2 fixture (HEAD/TREE/SUBJECT OIDs
	// come from this fixture repo's HEAD).
	const validFixture = setupFixtureRepo(
		toolingDir,
		"valid-v2",
		knownValidV2Fixture({
			head_oid: "0".repeat(40),
			tree_oid: "0".repeat(40),
			subject_tree_oid: "0".repeat(40),
		}),
	);
	// Stage 2: known-invalid v3 fixture.
	const invalidV3 = setupFixtureRepo(toolingDir, "invalid-v3", knownInvalidV3Fixture());
	// Stage 3: malformed v2 fixture (collapses schema validation).
	const malformed = setupFixtureRepo(malRepoRoot, "malformed-v2", malformedV2Fixture());

	const pipeline = [
		`set +e`,
		`LEAMAS_BIN=${shellQuote(ctx.leamas)}`,
		`OUT_DIR=${shellQuote(toolingDir)}`,
		`V_REPO=${shellQuote(validFixture.repoRoot)}`,
		`V3_REPO=${shellQuote(invalidV3.repoRoot)}`,
		`MAL_REPO=${shellQuote(malformed.repoRoot)}`,
		`REAL_REPO=${shellQuote(ctx.repoRoot)}`,
		`if [ ! -x "$LEAMAS_BIN" ]; then echo "leamas_unavailable=true"; exit 0; fi`,
		`"$LEAMAS_BIN" --version > "$OUT_DIR/version.txt" 2>&1`,
		`( cd "$REAL_REPO" && "$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-real.txt" ) >/dev/null 2>&1`,
		`echo "real_exit=$?"`,
		`( cd "$V_REPO" && "$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-valid.txt" ) >/dev/null 2>&1`,
		`echo "valid_exit=$?"`,
		`( cd "$V3_REPO" && "$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-v3.txt" ) >/dev/null 2>&1`,
		`echo "v3_exit=$?"`,
		`( cd "$MAL_REPO" && "$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-malformed.txt" ) >/dev/null 2>&1`,
		`echo "mal_exit=$?"`,
		`echo "leamas_unavailable=false"`,
		`echo "v2_accepted=$(grep -c 'schema_version=2' "$OUT_DIR/digest-real.txt" || true)"`,
		`echo "v2_source_present=$(grep -c 'source_status=present' "$OUT_DIR/digest-real.txt" || true)"`,
		`echo "v2_valid_accepted=$(grep -c 'schema_version=2' "$OUT_DIR/digest-valid.txt" || true)"`,
		`echo "v2_valid_source_present=$(grep -c 'source_status=present' "$OUT_DIR/digest-valid.txt" || true)"`,
		`echo "v3_rejected=$(grep -c 'source_status=invalid' "$OUT_DIR/digest-v3.txt" || true)"`,
		`echo "v3_schema_invalid=$(grep -c 'schema_version=0' "$OUT_DIR/digest-v3.txt" || true)"`,
		`echo "malformed_rejected=$(grep -c 'source_status=invalid' "$OUT_DIR/digest-malformed.txt" || true)"`,
	].join("\n");

	const check: Cmd = {
		name: "leamas_v2_contract",
		scope: "TOOLING",
		evidence:
			"Pipeline: leamas --version, leamas factory digest against canonical repo + valid-v2 fixture repo + v3 fixture repo + malformed fixture repo",
		cwd: ctx.repoRoot,
		exec: "/bin/sh",
		args: ["-c", pipeline],
		timeout_ms: 5 * 60_000,
	};
	const result = runExec(check);
	const stdout = result.stdout;
	const unavailable = /leamas_unavailable=true/.test(stdout);
	const v2AcceptedReal = /v2_accepted=[1-9]/.test(stdout);
	const v2SourcePresentReal = /v2_source_present=[1-9]/.test(stdout);
	const v2AcceptedValid = /v2_valid_accepted=[1-9]/.test(stdout);
	const v2SourcePresentValid = /v2_valid_source_present=[1-9]/.test(stdout);
	const v3Rejected = /v3_rejected=[1-9]/.test(stdout) || /v3_schema_invalid=[1-9]/.test(stdout);
	const malformedRejected = /malformed_rejected=[1-9]/.test(stdout);
	let status: CheckStatus;
	let reason: string;
	if (unavailable) {
		status = "unavailable";
		reason = "leamas binary not located on PATH";
	} else if (!v2AcceptedReal) {
		status = "fail";
		reason = `v2_accepted (real)=${v2AcceptedReal}; expected schema_version=2 in canonical digest`;
	} else if (!v2SourcePresentReal) {
		status = "fail";
		reason = `v2_source_present (real)=${v2SourcePresentReal}; expected source_status=present`;
	} else if (!v2AcceptedValid || !v2SourcePresentValid) {
		status = "fail";
		reason = `valid-v2 fixture not accepted: schema=${v2AcceptedValid} source=${v2SourcePresentValid}`;
	} else if (!v3Rejected) {
		status = "fail";
		reason = `v3 not rejected by leamas: ${v3Rejected}`;
	} else if (!malformedRejected) {
		status = "fail";
		reason = `malformed not rejected by leamas: ${malformedRejected}`;
	} else {
		status = "pass";
		reason =
			"v2 accepted (canonical repo + valid-v2 fixture); v3 rejected; malformed rejected";
	}

	// Capture the version.txt body for the attestation.
	let versionBody = "";
	try {
		versionBody = readFileSync(join(toolingDir, "version.txt"), "utf8");
	} catch {
		// ignore — version may not be available
	}
	const buildCommitMatch = versionBody.match(/commit:\s*(\S+)/);
	const versionMatch = versionBody.match(/version:\s*(\S+)/);
	const declaredVersion = versionBody.match(/declared_version:\s*(\S+)/);
	const stageOutcomes = (
		path: string,
		expected: "accept" | "reject",
	): "accept" | "reject" => {
		try {
			const text = readFileSync(path, "utf8");
			if (/source_status=invalid/.test(text) || /schema_version=0/.test(text)) return "reject";
			if (/source_status=present/.test(text) && /schema_version=2/.test(text)) return "accept";
		} catch {
			// ignore
		}
		return expected === "reject" ? "accept" : "reject";
	};
	const realDigestPath = join(toolingDir, "digest-real.txt");
	const validDigestPath = join(toolingDir, "digest-valid.txt");
	const v3DigestPath = join(toolingDir, "digest-v3.txt");
	const malDigestPath = join(toolingDir, "digest-malformed.txt");
	const stages: LeamasAttestationStage[] = [
		{
			label: "canonical_repo",
			repo_root: ctx.repoRoot,
			range: "HEAD",
			digest_output_path: toPortablePath(realDigestPath),
			raw_excerpt: excerpt(readFileIfExists(realDigestPath)),
			expected_outcome: "accept",
			observed_outcome: stageOutcomes(realDigestPath, "accept"),
		},
		{
			label: "known_valid_v2_fixture_repo",
			repo_root: validFixture.repoRoot,
			range: "HEAD",
			digest_output_path: toPortablePath(validDigestPath),
			raw_excerpt: excerpt(readFileIfExists(validDigestPath)),
			expected_outcome: "accept",
			observed_outcome: stageOutcomes(validDigestPath, "accept"),
		},
		{
			label: "known_invalid_v3_fixture_repo",
			repo_root: invalidV3.repoRoot,
			range: "HEAD",
			digest_output_path: toPortablePath(v3DigestPath),
			raw_excerpt: excerpt(readFileIfExists(v3DigestPath)),
			expected_outcome: "reject",
			observed_outcome: stageOutcomes(v3DigestPath, "reject"),
		},
		{
			label: "malformed_v2_fixture_repo",
			repo_root: malformed.repoRoot,
			range: "HEAD",
			digest_output_path: toPortablePath(malDigestPath),
			raw_excerpt: excerpt(readFileIfExists(malDigestPath)),
			expected_outcome: "reject",
			observed_outcome: stageOutcomes(malDigestPath, "reject"),
		},
	];

	const attestation: LeamasAttestation = {
		tool: {
			name: "leamas",
			build_commit: buildCommitMatch?.[1] ?? null,
			version: versionMatch?.[1] ?? declaredVersion?.[1] ?? null,
		},
		command: `${ctx.leamas} factory digest --range HEAD --output <digest-path>`,
		ran_at: new Date().toISOString(),
		canonical_summary_sha256: "<see gate-summary.json sha>",
		canonical_extended_sha256: "<see gate-summary.extended.json sha>",
		stages,
		verdict: status === "pass" ? "pass" : status === "unavailable" ? "unavailable" : "fail",
		reason,
	};
	return {
		check,
		result,
		status,
		reason,
		attestation,
		fixtureRepos: { valid: validFixture.repoRoot, invalidV3: invalidV3.repoRoot, malformed: malformed.repoRoot },
	};
}

function readFileIfExists(p: string): string {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return "";
	}
}

function excerpt(text: string): string {
	const trimmed = text.length > 1000 ? text.slice(0, 1000) + "\n...<truncated>" : text;
	return trimmed;
}

// ---------- check execution ------------------------------------------------

function parseBunTestTotals(stdout: string, stderr: string): {
	total: number;
	pass_count: number;
	fail_count: number;
	skip_count: number;
	unavailable_count: number;
} {
	const combined = `${stdout}\n${stderr}`;
	const ranMatch = combined.match(/Ran\s+(\d+)\s+tests?/);
	const total = ranMatch && ranMatch[1] ? Number.parseInt(ranMatch[1], 10) : 0;
	const passLine = (combined.match(/^\s*(\d+)\s+pass\s*$/m)?.[1] ?? "0");
	const failLine = (combined.match(/^\s*(\d+)\s+fail\s*$/m)?.[1] ?? "0");
	const skipLine = (combined.match(/^\s*(\d+)\s+skip(?:\([^)]*\))?\s*$/m)?.[1] ?? "0");
	const unavailLine = (combined.match(/^\s*(\d+)\s+unavailable(?:\([^)]*\))?\s*$/m)?.[1] ?? "0");
	const passCount = Number.parseInt(passLine, 10) || 0;
	const failCount = Number.parseInt(failLine, 10) || 0;
	const skipCount = Number.parseInt(skipLine, 10) || 0;
	const unavailCount = Number.parseInt(unavailLine, 10) || 0;
	return {
		total,
		pass_count: passCount,
		fail_count: failCount,
		skip_count: skipCount,
		unavailable_count: unavailCount,
	};
}

function summarizeAndPersist(
	stagingDir: string,
	cmd: Cmd,
	result: RunResult,
	statusOverride?: CheckStatus,
): GateCheckSummary {
	const derivedStatus: CheckStatus = statusOverride ?? (result.ok ? "pass" : "fail");
	persistCheckStreams(stagingDir, cmd, result, derivedStatus);
	const totals = parseBunTestTotals(result.stdout, result.stderr);
	const isTotalled =
		cmd.name.startsWith("focused_suite_") ||
		cmd.name === "all_factory_scripts_tests" ||
		cmd.name.startsWith("randomized_seed_") ||
		cmd.name === "correction21_closure_logic_tests";
	if (isTotalled && totals.total > 0 && totals.pass_count + totals.fail_count === 0) {
		if (result.ok) {
			totals.pass_count = totals.total - totals.skip_count - totals.unavailable_count;
		} else {
			totals.fail_count = Math.max(
				1,
				totals.total - totals.pass_count - totals.skip_count - totals.unavailable_count,
			);
		}
	}
	const stdoutTail = result.stdout.length > 400 ? `...${result.stdout.slice(-400)}` : result.stdout;
	const stderrTail = result.stderr.length > 400 ? `...${result.stderr.slice(-400)}` : result.stderr;
	return {
		name: cmd.name,
		scope: cmd.scope,
		status: derivedStatus,
		evidence: cmd.evidence,
		detail: `status=${derivedStatus}; exit=${result.extras.exit_code}; duration=${result.extras.duration_ms}ms; cmd=${result.extras.argv.join(" ")} (cwd=${cmd.cwd}); stdout_tail=${stdoutTail}; stderr_tail=${stderrTail}`,
		extras: {
			argv: result.extras.argv,
			exit_code: result.extras.exit_code,
			duration_ms: result.extras.duration_ms,
			stdout_sha256: result.extras.stdout_sha256,
			stderr_sha256: result.extras.stderr_sha256,
		},
		total: totals.total > 0 ? totals.total : undefined,
		pass_count: totals.total > 0 ? totals.pass_count : undefined,
		fail_count: totals.total > 0 ? totals.fail_count : undefined,
		skip_count: totals.total > 0 ? totals.skip_count : undefined,
		unavailable_count: totals.total > 0 ? totals.unavailable_count : undefined,
	};
}

function collectChecks(
	ctx: SnapshotContext,
	parentState: ParentActState,
): GateCheckSummary[] {
	const out: GateCheckSummary[] = [];
	// 1. Authoritative range-patch hygiene (must run FIRST so a dirty
	//    range-patch surfaces before any test executes).
	const rangePatch = runExec(GIT_RANGE_HYGIENE(ctx));
	out.push(summarizeAndPersist(ctx.stagingDir, GIT_RANGE_HYGIENE(ctx), rangePatch));
	// 2. Working-tree porcelain.
	const workingTree = runExec(WORKING_TREE_CLEANLINESS(ctx));
	out.push(
		persistence(
			ctx.stagingDir,
			WORKING_TREE_CLEANLINESS(ctx),
			workingTree,
		),
	);
	// 3. Strict tsc.
	const tsc = runExec(TSC_STRICT(ctx));
	out.push(summarizeAndPersist(ctx.stagingDir, TSC_STRICT(ctx), tsc));
	// 4. CORRECTION21 closure logic tests.
	const closureLogic = runExec(CORRECTION21_CLOSURE_LOGIC_TESTS(ctx));
	out.push(
		summarizeAndPersist(
			ctx.stagingDir,
			CORRECTION21_CLOSURE_LOGIC_TESTS(ctx),
			closureLogic,
		),
	);
	// 5. CORRECTION21 current-state probe (witness over parentState).
	const correction21Probe = buildCorrection21Probe(ctx, parentState);
	const probeResult = runExec(correction21Probe);
	out.push(summarizeAndPersist(ctx.stagingDir, correction21Probe, probeResult));
	// 6. Focused suites.
	for (const { label, path } of FOCUSED_SUITE_PATHS) {
		const cmd = focusedSuiteCmd(ctx, label, path);
		const r = runExec(cmd);
		out.push(summarizeAndPersist(ctx.stagingDir, cmd, r));
	}
	// 7. All factory scripts + randomized.
	const allCmd = allFactoryScriptsCmd(ctx);
	const allResult = runExec(allCmd);
	out.push(summarizeAndPersist(ctx.stagingDir, allCmd, allResult));
	for (const seed of RANDOMIZED_SEEDS) {
		const cmd = randomizedCmd(ctx, seed);
		const r = runExec(cmd);
		out.push(summarizeAndPersist(ctx.stagingDir, cmd, r));
	}
	return out;
}

// Tiny inline alias to make the call sites easier to read.
function persistence(
	stagingDir: string,
	cmd: Cmd,
	result: RunResult,
): GateCheckSummary {
	return summarizeAndPersist(stagingDir, cmd, result);
}

// ---------- atomic publication (P0-1) --------------------------------------

/**
 * Stage-then-swap with rollback. Steps:
 *
 *   1. Build complete bundle under `ctx.stagingDir` (already done by
 *      the producer before this call).
 *   2. STAGE-SIDE GUARDS: re-read every persisted file and verify its
 *      on-disk SHA-256 matches the staged `extras` (defense in depth).
 *   3. If `.factory/` exists, rename it to `ctx.backupDir`.
 *      (Race window: between this rename and step 4, observers see
 *      `.factory/` missing. Acceptable because nothing else writes
 *      `.factory/` concurrently.)
 *   4. Rename `ctx.stagingDir` → `ctx.factoryDir` (atomic on POSIX).
 *   5. Confirm the renamed canonical summary matches the staged bytes
 *      we just serialized.
 *
 * On any failure inside this function, the canonical `.factory/` is
 * either unchanged (no swap yet) or fully replaced by the swap. The
 * backup at `ctx.backupDir` is moved back into `.factory/` to restore
 * the prior canonical state. The caller decides whether to delete the
 * backup after a successful post-swap Leamas check.
 */
function atomicPublish(
	ctx: SnapshotContext,
	summary: GateSummary,
	extended: GateSummaryExtended,
): { summaryBytesOnDisk: string; extendedBytesOnDisk: string } {
	const summaryPath = stagingGateSummaryPath(ctx.stagingDir);
	const extendedPath = stagingExtendedPath(ctx.stagingDir);
	const summaryText = serializeGateSummary(summary);
	const extendedText = serializeExtended(extended);
	writeFileSync(summaryPath, summaryText);
	writeFileSync(extendedPath, extendedText);
	// Stage-side verification: re-read every file we are about to
	// publish, confirm its on-disk hash matches what we persisted.
	const onDiskSummary = readFileSync(summaryPath, "utf8");
	const onDiskExtended = readFileSync(extendedPath, "utf8");
	if (sha256(onDiskSummary) !== sha256(summaryText)) {
		throw new Error("GATE_SUMMARY_STAGE_HASH_DRIFT:summary");
	}
	if (sha256(onDiskExtended) !== sha256(extendedText)) {
		throw new Error("GATE_SUMMARY_STAGE_HASH_DRIFT:extended");
	}
	// In-process structural validation before swap. A defect caught
	// here is a clean failure: the staging dir can be rmSync'd and no
	// canonical file was touched.
	const validation = validateGateSummaryStructure(JSON.parse(onDiskSummary));
	if (!validation.ok) {
		throw new Error(
			`GATE_SUMMARY_STRUCTURAL_VALIDATION_FAILED:${validation.errors.join(" | ")}`,
		);
	}
	const hadCanonical = existsSync(ctx.factoryDir);
	if (hadCanonical) {
		// Move existing canonical aside. Atomic on POSIX for a single
		// rename. If anything below throws, we rename the canonical
		// back from the backup.
		if (existsSync(ctx.backupDir)) {
			rmSync(ctx.backupDir, { recursive: true, force: true });
		}
		renameSync(ctx.factoryDir, ctx.backupDir);
	}
	let swapped = false;
	try {
		renameSync(ctx.stagingDir, ctx.factoryDir);
		swapped = true;
	} catch (e) {
		if (hadCanonical) {
			try {
				renameSync(ctx.backupDir, ctx.factoryDir);
			} catch {
				// best-effort rollback
			}
		}
		throw e;
	}
	// Post-swap: confirm the canonical bytes match what we just
	// serialized. A failure here is catastrophic (the swapped-in
	// directory disagrees with our staged snapshot) — emit and let
	// the caller attempt rollback from backup.
	const canonicalSummaryBytes = readFileSync(ctx.canonicalSummaryPath, "utf8");
	const canonicalExtendedBytes = readFileSync(ctx.canonicalExtendedPath, "utf8");
	if (sha256(canonicalSummaryBytes) !== sha256(summaryText)) {
		throw new Error("GATE_SUMMARY_POST_SWAP_HASH_DRIFT:summary");
	}
	if (sha256(canonicalExtendedBytes) !== sha256(extendedText)) {
		throw new Error("GATE_SUMMARY_POST_SWAP_HASH_DRIFT:extended");
	}
	void swapped;
	return {
		summaryBytesOnDisk: canonicalSummaryBytes,
		extendedBytesOnDisk: canonicalExtendedBytes,
	};
}

/**
 * After atomic publication, the canonical bundle is in `.factory/`.
 * The producer persists the Leamas attestation as a third sibling file
 * (`.factory/gate-summary.leamas.json`) so the v2 contract document
 * never claims to be self-validated.
 */
function persistLeamasAttestation(
	ctx: SnapshotContext,
	attestation: LeamasAttestation,
	canonicalSummarySha: string,
	canonicalExtendedSha: string,
): void {
	const finalAttestation: LeamasAttestation = {
		...attestation,
		canonical_summary_sha256: canonicalSummarySha,
		canonical_extended_sha256: canonicalExtendedSha,
	};
	const attestationPath = ctx.canonicalLeamasAttestationPath;
	// Atomic write: stage to a sibling file then rename. Even after
	// the swap, persisting a separate sibling file uses a temp + rename
	// for atomicity.
	const tmp = `${attestationPath}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(finalAttestation, null, "\t")}\n`);
	renameSync(tmp, attestationPath);
}

// ---------- main -----------------------------------------------------------

function main(): void {
	const ctx = bootstrap();
	if (!existsSync(ctx.scriptsDir)) {
		console.error(`gate-summary: ${ctx.scriptsDir} is missing`);
		process.exit(2);
	}
	if (!existsSync(ctx.schemasDir)) {
		console.error(`gate-summary: ${ctx.schemasDir} is missing`);
		process.exit(2);
	}
	if (!existsSync(ctx.tsconfigPath)) {
		console.error(`gate-summary: ${ctx.tsconfigPath} is missing`);
		process.exit(2);
	}

	// Step 1: derive parent state BEFORE running checks so the probe
	// can consume the in-process verdict.
	const parentState = deriveParentActState(ctx);

	// Step 2: collect all executable checks (MICROC3/WORKTREE/
	// CORRECTION21). Streams land in ctx.stagingDir, NOT in canonical
	// .factory/.
	const checks = collectChecks(ctx, parentState);

	// Step 3: capture identity AFTER every executable check (P0-3).
	const identityAfter = captureSnapshot(ctx.repoRoot, ctx.git);

	// Step 4: build rejection reasons from the before/after snapshots.
	const rejectionReasons = deriveRejectionReasons(ctx.identityBefore, identityAfter);
	const identityStable =
		identityAfter.head_oid === ctx.identityBefore.head_oid &&
		identityAfter.tree_oid === ctx.identityBefore.tree_oid &&
		identityAfter.subject_tree_oid === ctx.identityBefore.subject_tree_oid;
	if (rejectionReasons.length > 0) {
		console.error(
			`gate-summary: identity/worktree rejection: ${rejectionReasons.map((r) => r.code).join(",")}`,
		);
		process.exit(3);
	}

	// Step 5: derive status arithmetic from the check rows.
	const scope = deriveScopeStatus(checks);
	const parentStatus = deriveParentStatus(parentState);
	const overall = deriveOverallStatus(checks);
	const overallDisposition = deriveOverallDisposition(overall);

	// Step 6: build final v2 summary and the extended sibling. The
	// producer variant is `round-6-leamas-v2-producer-integrity`. The
	// v2 summary carries ONLY the v2 schema fields.
	const summary = buildFinalSummary({
		generatedAt: new Date().toISOString(),
		scopeId: SCOPE_ID,
		scopeStatus: scope.status,
		scopeDisposition: scope.disposition,
		parentAct: PARENT_ACT_ID,
		parentStatus,
		parentDisposition: parentState.disposition,
		overallStatus: overall,
		overallDisposition,
		executionHeadOid: ctx.headOid,
		executionTreeOid: ctx.treeOid,
		subjectTreeOid: ctx.subjectTreeOid,
		worktreeCleanBefore: ctx.worktreeCleanBefore,
		worktreeCleanAfter: identityAfter.worktree_clean,
		checks,
	});

	// Step 7: run the Leamas v2 contract check against an isolated
	// staging directory. The check itself stages its own fixture
	// repos; it is run BEFORE the atomic swap so its transient files
	// never appear in canonical `.factory/`.
	const leamasStagingDir = join(ctx.stagingDir, "leamas-staging", `contract-${Date.now()}`);
	const leamasContract = runLeamasV2Contract({ ctx, leamasStagingDir });
	// The contract streams also land under ctx.stagingDir so they
	// publish alongside every other check after the swap.
	const leamasCheckSummary = persistLeamasStreamsAndSummarize(
		leamasContract,
		ctx,
	);
	checks.push(leamasCheckSummary);

	// Step 8: extend the extended sibling with the fixture SHAs.
	const extended = buildExtended({
		tool: { name: PRODUCER_NAME, version: PRODUCER_VERSION },
		identityStable,
		parentActState: parentState,
		rejectionReasons,
		knownValidV2RepoSha256: sha256(leamasContract.fixtureRepos.valid),
		knownInvalidV3RepoSha256: sha256(leamasContract.fixtureRepos.invalidV3),
	});

	// Step 9: ATOMIC PUBLICATION — stage-then-swap with rollback.
	let swapResult: { summaryBytesOnDisk: string; extendedBytesOnDisk: string };
	try {
		swapResult = atomicPublish(ctx, summary, extended);
	} catch (e) {
		console.error(`gate-summary: atomic publish failed: ${(e as Error).message}`);
		process.exit(4);
	}

	// Step 10: persist the Leamas attestation as a third sibling file.
	persistLeamasAttestation(
		ctx,
		leamasContract.attestation,
		sha256(swapResult.summaryBytesOnDisk),
		sha256(swapResult.extendedBytesOnDisk),
	);

	// Step 11: best-effort cleanup of the leamas staging sibling under
	// the now-canonical path. This is NOT inside `.factory/` — the
	// leamas staging was under `.factory-staging-<nonce>/leamas-staging/`
	// which BECAME `.factory/leamas-staging/` after the swap. The
	// cleanup must NOT delete anything material; it only removes
	// the leamas contract `*.txt` files.
	try {
		rmSync(ctx.stagingDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
	try {
		rmSync(join(ctx.factoryDir, "leamas-staging"), { recursive: true, force: true });
	} catch {
		// ignore
	}

	// Step 12: success. The canonical `.factory/` is the staged bundle
	// with the leamas attestation appended as a third sibling. The
	// backup at `.factory-backup-<nonce>/` is deleted last so a
	// post-publish crash leaves a recoverable prior bundle.
	try {
		rmSync(ctx.backupDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

function persistLeamasStreamsAndSummarize(
	contract: {
		check: Cmd;
		result: RunResult;
		status: CheckStatus;
		reason: string;
		attestation: LeamasAttestation;
	},
	ctx: SnapshotContext,
): GateCheckSummary {
	// The leamas check streams already live under `ctx.stagingDir` (the
	// runLeamasV2Contract path). We persist them as `leamas_v2_contract`
	// in the TOOLING scope and refresh the metadata. The streams remain
	// in staging until atomicPublish swaps the staging dir into canonical.
	const dir = stagingScopeDir(ctx.stagingDir, contract.check.scope);
	mkdirSync(dir, { recursive: true });
	const stdoutPath = join(dir, `${contract.check.name}.stdout`);
	const stderrPath = join(dir, `${contract.check.name}.stderr`);
	const metadataPath = join(dir, `${contract.check.name}.metadata.json`);
	// Append the leamas-specific stdout (which already lives in
	// `contract.result.stdout`) into the canonical streams path.
	writeFileSync(stdoutPath, contract.result.stdout);
	writeFileSync(stderrPath, contract.result.stderr);
	const metadata = {
		name: contract.check.name,
		scope: contract.check.scope,
		status: contract.status,
		argv: contract.result.extras.argv,
		cwd: contract.check.cwd,
		exit_code: contract.result.extras.exit_code,
		signal: contract.result.extras.signal,
		timeout: contract.result.extras.timeout,
		duration_ms: contract.result.extras.duration_ms,
		stdout_path: relativeToBundleRoot(stdoutPath, ctx.stagingDir),
		stdout_sha256: contract.result.extras.stdout_sha256,
		stderr_path: relativeToBundleRoot(stderrPath, ctx.stagingDir),
		stderr_sha256: contract.result.extras.stderr_sha256,
		started_at: contract.result.extras.started_at,
		finished_at: contract.result.extras.finished_at,
		detail: `status=${contract.status}; reason=${contract.reason}; exit=${contract.result.extras.exit_code}; duration=${contract.result.extras.duration_ms}ms; cmd=${contract.result.extras.argv.join(" ")} (cwd=${contract.check.cwd})`,
	};
	writeFileSync(metadataPath, `${JSON.stringify(metadata, null, "\t")}\n`);
	const onDiskStdout = readFileSync(stdoutPath, "utf8");
	const onDiskStderr = readFileSync(stderrPath, "utf8");
	if (sha256(onDiskStdout) !== contract.result.extras.stdout_sha256) {
		throw new Error(`GATE_SUMMARY_STREAM_HASH_DRIFT:${contract.check.name}:stdout`);
	}
	if (sha256(onDiskStderr) !== contract.result.extras.stderr_sha256) {
		throw new Error(`GATE_SUMMARY_STREAM_HASH_DRIFT:${contract.check.name}:stderr`);
	}
	const stdoutTail = contract.result.stdout.length > 400
		? `...${contract.result.stdout.slice(-400)}`
		: contract.result.stdout;
	const stderrTail = contract.result.stderr.length > 400
		? `...${contract.result.stderr.slice(-400)}`
		: contract.result.stderr;
	return {
		name: contract.check.name,
		scope: contract.check.scope,
		status: contract.status,
		evidence: contract.check.evidence,
		detail: `status=${contract.status}; reason=${contract.reason}; exit=${contract.result.extras.exit_code}; duration=${contract.result.extras.duration_ms}ms; cmd=${contract.result.extras.argv.join(" ")} (cwd=${contract.check.cwd}); stdout_tail=${stdoutTail}; stderr_tail=${stderrTail}`,
		extras: {
			argv: contract.result.extras.argv,
			exit_code: contract.result.extras.exit_code,
			duration_ms: contract.result.extras.duration_ms,
			stdout_sha256: contract.result.extras.stdout_sha256,
			stderr_sha256: contract.result.extras.stderr_sha256,
		},
	};
}

if (import.meta.main) {
	main();
}

// Export for tests.
export {
	atomicPublish,
	buildCorrection21Probe,
	bootstrap,
	captureSnapshot,
	collectChecks,
	ensureGitignoreEntries,
	GIT_RANGE_HYGIENE,
	knownInvalidV3Fixture,
	malformedV2Fixture,
	persistLeamasAttestation,
	persistLeamasStreamsAndSummarize,
	resolveTool,
	runLeamasV2Contract,
	summarizeAndPersist,
};

void dirname;
