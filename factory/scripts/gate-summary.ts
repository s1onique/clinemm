#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — Leamas v2 evidence rebind.
 *
 * µC-3 round 7 (LEAMAS-V2-EVIDENCE-REBIND01 fidelity-2 pass) closes the
 * remaining producer-ordering defects surfaced by the round 6 review:
 *
 *  P0-1  EXACT-CANDIDATE LEAMAS VALIDATION. The Leamas contract stages
 *        a fresh isolated git repository containing the exact bytes of
 *        the staged v2 summary as `.factory/gate-summary.json` and runs
 *        `leamas factory digest` inside THAT repository. The contract
 *        no longer reads the previous canonical artifact at
 *        `ctx.repoRoot`. The candidate repo lives under a sibling
 *        `.factory-leamas-staging-<nonce>/` directory so it cannot
 *        contaminate the canonical `.factory/` swap.
 *
 *  P0-2  FINAL SUMMARY INCLUDES THE LEAMAS CHECK. The interim summary
 *        (built without `leamas_v2_contract`) is what Leamas validates.
 *        The leamas result becomes the last check in the `checks[]`
 *        list; scope and overall status are then re-derived from the
 *        FULL list. The FINAL summary — with the leamas check, the
 *        re-derived scope, and the re-derived overall — is what the
 *        atomic publish swaps into canonical. Only that final bytes
 *        set is ever canonical.
 *
 *  P0-3  PUBLICATION-BOUNDARY IDENTITY SAMPLES. The producer captures
 *        three explicit snapshots:
 *          identity_before_checks (bootstrap),
 *          identity_after_checks (after collectChecks, before leamas),
 *          identity_after_publication (after the swap + leamas
 *            cleanup; recorded in the extended sibling file only —
 *            it cannot enter `worktree_clean_after` without making
 *            the document self-reference its own canonical bundle).
 *        The canonical `worktree_clean_*` fields use the latest
 *        sample that does not yet require the bundle to exist.
 *
 *  P0-4  ATTESTATION WRITTEN INTO STAGING. `gate-summary.leamas.json`
 *        is written into `.factory-staging-<nonce>/` BEFORE the swap;
 *        the swap is then a single `renameSync(staging, canonical)`.
 *        No canonical file is mutated before swap, and a crash mid-swap
 *        restores the previous canonical from the backup-rename
 *        (POSIX `renameSync` is atomic per-call; the round-trip is two
 *        renames but the rollback covers either failure point).
 *
 *  P0-5  PARENT CLOSURE USES isEvidenceOk. `buildParentClosureInput`
 *        calls `isEvidenceOk(view)` directly instead of inlining the
 *        conjunction — the same definition the renderer/test suite use.
 *
 *  P0-6  RANGE HYGIENE STATUS GATE. `captureSnapshot` treats
 *        `git diff HEAD^..HEAD --check` exit code 0 as the only clean
 *        signal. `git diff` writes diagnostics to its own stream
 *        (default stdout), so we union stdout+stderr for diagnostics
 *        and never call an empty-diff nonzero exit "clean".
 *
 *  P1    Fixture hashes use the per-fixture `fixture_sha256` returned by
 *        `setupFixtureRepo` — not `sha256(<repoPath>)`.
 *
 * µC-3 round 9 (LEAMAS-V2-EVIDENCE-REBIND01 attestation-integrity pass)
 * closes the four attestation defects the round 8 review surfaced:
 *
 *  P0-1  AT-COMMIT SHA-256 BINDS THE ACTUAL CANDIDATE BYTES.
 *        `candidate_summary_sha256_at_commit` is the SHA-256 of the
 *        bytes `git show HEAD:.factory/gate-summary.json` returns from
 *        the isolated candidate repo. The round 8 implementation
 *        derived it from `slice(0,0)` of an unrelated buffer, which
 *        deterministically hashed the empty string. The new code
 *        reads the committed bytes via `spawnSync('git', ['show',
 *        'HEAD:.factory/gate-summary.json'], ...)` and hashes that
 *        buffer.
 *
 *  P0-2  CANDIDATE COMMIT-TREE OID IS NOT THE FILTERED SUBJECT TREE.
 *        `candidate_repo_commit_tree_oid` is the OID `git rev-parse
 *        HEAD^{tree}` returns from the candidate repo. The round 8
 *        implementation copied `candidate.subject_tree_oid` (the
 *        producer's filtered subject tree) under a misleadingly-named
 *        field. Round 9 keeps the commit tree and the filtered subject
 *        tree under separate, truthfully-named fields.
 *
 *  P0-3  THE INTERIM/FINAL DISTINCTION IS NAMED TRUTHFULLY.
 *        `leamas_validated_candidate` (round 8) was a status boolean
 *        that round 8's comment falsely called a hash-equality
 *        invariant. Round 9 adds the truthful replacement
 *        `leamas_accepted_interim_candidate` and a real hash-equality
 *        invariant `candidate_summary_sha256_source_matches_commit`
 *        that asserts `candidate_summary_sha256 ==
 *        candidate_summary_sha256_at_commit`. The legacy field is
 *        retained only as a backward-compat alias.
 *
 *  P0-4  POST-LEAMAS IDENTITY STABILITY IS ENFORCED.
 *        `main()` records the snapshot taken AFTER `runCandidateLeamasValidation`
 *        returns and uses it as the authoritative
 *        `identityStableAfterLeamas` for the extended sibling file and
 *        the rejection-reason derivation. A Leamas invocation that
 *        changed HEAD/tree/subject throws
 *        `GATE_SUMMARY_REPOSITORY_DRIFT_AFTER_LEAMAS` before the
 *        canonical swap.
 *
 *  P0-5  RANGE HYGIENE USES THE EXPLICIT BASELINE OID.
 *        `GIT_RANGE_HYGIENE` checks `git diff <baselineOid>..HEAD
 *        --check` where `baselineOid` is the producer's HEAD captured
 *        at bootstrap (round 8 review tip for the current run). Round
 *        8's `HEAD^..HEAD` only proved the last commit.
 *
 * µC-3 round 10 (LEAMAS-V2-EVIDENCE-REBIND01 durable-payload descriptor)
 * introduces the shared `DurablePayload` descriptor and re-routes the
 * producer, publisher, attestation, and renderer through the SAME
 * resolver / verifier / recovery helpers exported from
 * `gate-summary.helpers.ts`. The producer stages every durable
 * artifact with a typed descriptor; the publisher and the renderer
 * consume descriptors (not ad-hoc name/hash/path triples) so the
 * durable-payload contract has one source of truth.
 *
 * P0-1  DURABLE PAYLOAD DESCRIPTOR. The two durable artifacts
 *       published into `.factory/gates/tooling/` — the candidate git
 *       bundle and the candidate summary payload — are carried end
 *       to end as `DurablePayload` values. The validator, the
 *       publisher, the attestation, and the renderer all consume the
 *       SAME shape so the descriptor cannot drift between them.
 *
 * P0-2  RESOLVER / VERIFIER / RECOVERY HELPERS. `resolveBundlePath`
 *       (resolver), `verifyDurableBundle` / `verifyDurablePayload`
 *       (verifiers), and `recoverCandidateFromBundle` (recovery) are
 *       exported from `gate-summary.helpers.ts` and consumed by the
 *       renderer in `render-baseline-report.ts` and the focused
 *       tests in `gate-summary.test.ts`. Round 9's inline resolution
 *       and clone logic was only exercised inside the renderer; the
 *       helpers expose the same primitives to the test suite.
 *
 * P0-3  RECOVERY CLEANUP IS UNCONDITIONAL. `recoverCandidateFromBundle`
 *       uses a single outer `try / finally` so it always cleans up
 *       the scratch directory — even on a successful clone. The
 *       caller's exception can no longer leak the recovery directory.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	cpSync,
	writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";

import { computeFilteredSubjectTreeOid } from "./subject-tree";
import {
	assessParentClosure,
	buildExtended,
	buildFinalSummary,
	deriveOverallDisposition,
	deriveOverallStatus,
	deriveParentActState,
	deriveParentStatus,
	deriveRejectionReasons,
	deriveScopeStatus,
	durablePayload,
	gitText,
	isCleanPorcelain,
	isEvidenceOk,
	isEvidenceStructurallyValid,
	isValidOid,
	makeBackupPath,
	makeStagingPath,
	persistCheckStreams,
	publishDurablePayloads,
	relativeToBundleRoot,
	resolveRangeBase,
	runExec,
	serializeExtended,
	serializeGateSummary,
	serializeLeamasAttestation,
	sha256,
	sha256Buffer,
	stagingExtendedPath,
	stagingGateSummaryPath,
	stagingLeamasAttestationPath,
	stagingScopeDir,
	toPortablePath,
	validateGateSummaryStructure,
	assertUniqueCheckNames,
	defaultAtomicPublishOps,
	type AtomicPublishOps,
	type CheckScope,
	type CheckStatus,
	type Cmd,
	type DurablePayload,
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
const PRODUCER_VERSION = "round-10-leamas-v2-durable-payload";

// µC-3 round 10 — canonical wire-path identifiers for the two
// durable artifacts appended to the canonical gate bundle. The
// publisher, the attestation, and the renderer MUST consume exactly
// these strings so the durable-payload contract has one source of
// truth. Reference via `DurablePayload.destination_rel` so the
// signature flows through the descriptor.
const CANDIDATE_BUNDLE_DEST_REL = "gates/tooling/candidate-repo.bundle";
const CANDIDATE_SUMMARY_DEST_REL = "gates/tooling/candidate-summary.json";
const CANDIDATE_BUNDLE_ID = "candidate-repo.bundle";
const CANDIDATE_SUMMARY_ID = "candidate-summary.json";

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
 * Capture the current identity snapshot of HEAD/tree/subject/range/
 * worktree. The `range_patch_clean` flag is sampled via
 * `git diff HEAD^..HEAD --check` (when HEAD has a parent). On exit 0,
 * the range is clean and diagnostics are empty. On any non-zero
 * status, the range is dirty and diagnostics are the union of stdout
 * and stderr from the `git diff --check` invocation.
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
	let rangePatchClean = true;
	let rangePatchUnexpected: string[] = [];
	let parentTextValid: boolean | null = null;
	const parentText = gitText(repoRoot, git, [
		"rev-parse",
		"--verify",
		"--end-of-options",
		"HEAD^",
	]).stdout.trim();
	if (parentText.length === 0) {
		parentTextValid = false;
	} else if (isValidOid(parentText)) {
		parentTextValid = true;
		const diffResult = gitText(repoRoot, git, [
			"diff",
			"HEAD^..HEAD",
			"--check",
		]);
		// P0-6: `git diff --check` exits non-zero when the diff has
		// whitespace/line-ending errors. Diagnostics can be emitted
		// on EITHER stdout or stderr (the underlying diff driver
		// writes to its output stream, which `git diff` defaults
		// to stdout; `git` itself may add notes to stderr). Treat
		// anything other than exit 0 as a dirty range — never call
		// an empty-diff nonzero exit "clean".
		if (diffResult.status === 0) {
			rangePatchClean = true;
			rangePatchUnexpected = [];
		} else {
			rangePatchClean = false;
			rangePatchUnexpected = `${diffResult.stdout}\n${diffResult.stderr}`
				.split("\n")
				.filter((l) => l.length > 0);
		}
	}
	void parentTextValid;
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

function ensureGitignoreEntries(repoRoot: string, entries: ReadonlyArray<string>): void {
	const gitignorePath = join(repoRoot, ".gitignore");
	if (!existsSync(gitignorePath)) return;
	const current = readFileSync(gitignorePath, "utf8");
	const missing = entries.filter((e) => !current.includes(e));
	if (missing.length === 0) return;
	const append = `\n# Factory staging/backup siblings (µC-3 round 7 atomic publish)\n${missing.join("\n")}\n`;
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
		".factory-leamas-staging-*",
	]);
	const factoryDir = join(repoRoot, ".factory");
	const scriptsDir = join(repoRoot, "factory", "scripts");
	const schemasDir = join(repoRoot, "factory", "schemas");
	const tsconfigPath = join(scriptsDir, "tsconfig.json");
	const testsDir = scriptsDir;
	const nonce = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
	const stagingDir = makeStagingPath(repoRoot, nonce);
	const backupDir = makeBackupPath(repoRoot, nonce);
	const leamasStagingDir = join(repoRoot, `.factory-leamas-staging-${nonce}`);
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
		// P0-5 — the baseline OID is the producer's HEAD BEFORE any
		// of its own commits are made. The range
		// `<baselineOid>..HEAD` covers every commit the producer
		// contributes in this run, and is the basis for
		// `range_patch_cleanliness`. Recording the explicit OID
		// avoids `HEAD^..HEAD`, which only proves the last commit.
		//
		// P0-3 — the resolution logic is exported as
		// `resolveRangeBase()` so the H8 suite can regression-bind
		// every failure mode (missing / malformed / equal-HEAD /
		// non-ancestor / valid ancestor).
		baselineOid: resolveRangeBase(identity.head_oid, repoRoot, git),
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

// Range hygiene: requires commit-range + working-tree diff + porcelain
// to ALL be empty. Implemented as a shell pipeline that returns 0 only
// when every component is clean.
//
// P0-5 — the commit-range diff uses `<baselineOid>..HEAD` where
// `baselineOid` is the producer's HEAD BEFORE any of its own commits
// are made (captured in `bootstrap`). `HEAD^..HEAD` would only prove
// the last commit, which is too narrow for a multi-commit ACT range.
// The pipeline records `range_baseline_oid=<baselineOid>` so the
// digest renderer can independently verify the exact range.
const GIT_RANGE_HYGIENE: (b: SnapshotContext) => Cmd = (b) => {
	const repo = b.repoRoot;
	const baselineOid = b.baselineOid;
	const pipeline = [
		`set +e`,
		`echo "range_baseline_oid=${baselineOid}"`,
		`diff_baseline=$(git -C ${shellQuote(repo)} diff ${shellQuote(baselineOid)}..HEAD --check 2>&1); r1=$?`,
		`diff_head=$(git -C ${shellQuote(repo)} diff HEAD --check 2>&1); r2=$?`,
		`porcelain=$(git -C ${shellQuote(repo)} status --porcelain=v1 --untracked-files=all); r3=$?`,
		`if [ -z "$diff_baseline" ] && [ $r1 -eq 0 ] && [ -z "$diff_head" ] && [ $r2 -eq 0 ] && [ -z "$porcelain" ] && [ $r3 -eq 0 ]; then echo "range_hygiene=clean"; exit 0; fi`,
		`echo "diff_baseline_failed=$r1"`,
		`echo "diff_baseline_diag=$diff_baseline"`,
		`echo "diff_head_failed=$r2"`,
		`echo "diff_head_diag=$diff_head"`,
		`echo "porcelain_failed=$r3"`,
		`echo "porcelain=$porcelain"`,
		`exit 1`,
	].join("\n");
	return {
		name: "range_patch_cleanliness",
		scope: "WORKTREE",
		evidence:
			`git diff ${baselineOid}..HEAD --check + git diff HEAD --check + git status --porcelain=v1 --untracked-files=all (all three required; baseline recorded in detail)`,
		cwd: repo,
		exec: "/bin/sh",
		args: ["-c", pipeline],
	};
};

/**
 * Build the parent-state executable probe. The probe is a thin
 * verifier over `deriveParentActState`: it reads the in-process
 * verdict, re-derives the verdict from the bundle, and emits an
 * exit code that maps to the verdict directly. It does NOT
 * recompute the verdict through a second, weaker implementation.
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
 * The probe consumes the bundled verification-results.json
 * commands (when present) and the producer's CURRENT
 * head/tree/subject identity — never the bundle's self-recorded
 * OIDs — so its judgment binds to the producer's run, not to the
 * bundle in isolation.
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
		`const subjectTreeOid = ${JSON.stringify(ctx.subjectTreeOid)};`,
		`const headOid = ${JSON.stringify(ctx.headOid)};`,
		`const treeOid = ${JSON.stringify(ctx.treeOid)};`,
		`const expectedVerdict = ${JSON.stringify(parentState.verdict)};`,
		`const expectedDisposition = ${JSON.stringify(parentState.disposition)};`,
		`if (!existsSync(join(dir, 'evidence.json')) || !existsSync(join(dir, 'hashes.sha256'))) {`,
		`  console.log('parent_disposition=' + expectedDisposition + ' reason=bundle_absent verdict=' + expectedVerdict);`,
		`  if (expectedVerdict !== 'OPEN') { console.error('GATE_SUMMARY_PROBE_VERDICT_MISMATCH:expected_OPEN_got=' + expectedVerdict); process.exit(1); }`,
		`  process.exit(1);`,
		"}",
		`const ev = loadEvidenceFile(join(dir, 'evidence.json'));`,
		`const hashesText = readFileSync(join(dir, 'hashes.sha256'), 'utf8');`,
		`const verificationPath = join(dir, 'verification-results.json');`,
		`let executedCmds = [];`,
		`if (existsSync(verificationPath)) {`,
		`  try { const v = JSON.parse(readFileSync(verificationPath, 'utf8')); if (Array.isArray(v.executed_commands)) executedCmds = v.executed_commands; else if (Array.isArray(v.commands)) executedCmds = v.commands; } catch {}`,
		"}",
		`if (executedCmds.length === 0 && ev.ok && Array.isArray(ev.value && ev.value.commands)) executedCmds = ev.value.commands;`,
		`let derivedTree = null;`,
		`let executionHeadExists = false;`,
		`let executionTreeExists = false;`,
		`const bundledHead = (ev.ok && ev.value && typeof ev.value.execution_head_oid === 'string') ? ev.value.execution_head_oid : null;`,
		`const bundledTree = (ev.ok && ev.value && typeof ev.value.execution_tree_oid === 'string') ? ev.value.execution_tree_oid : null;`,
		`if (bundledHead && /^[0-9a-f]{40}$/.test(bundledHead)) {`,
		`  const r = Bun.spawnSync({ cmd: ['git', 'cat-file', '-e', bundledHead], cwd: root, env: process.env });`,
		`  executionHeadExists = r.status === 0;`,
		"}",
		`if (bundledTree && /^[0-9a-f]{40}$/.test(bundledTree)) {`,
		`  const r = Bun.spawnSync({ cmd: ['git', 'cat-file', '-e', bundledTree], cwd: root, env: process.env });`,
		`  executionTreeExists = r.status === 0;`,
		"}",
		`if (bundledHead && /^[0-9a-f]{40}$/.test(bundledHead)) {`,
		`  const r = Bun.spawnSync({ cmd: ['git', 'rev-parse', '--verify', '--end-of-options', bundledHead + '^{tree}'], cwd: root, env: process.env });`,
		`  const out = (r.stdout ? r.stdout.toString('utf8') : '').trim();`,
		`  if (/^[0-9a-f]{40}$/.test(out)) derivedTree = out;`,
		"}",
		`const view = checkEvidence({`,
		`  ev,`,
		`  hashesText,`,
		`  evDirAbs: dir,`,
		`  executedCmds,`,
		`  bundledResultPath: 'verification-results.json',`,
		`  rootAbs: root,`,
		`  headOidNow: headOid,`,
		`  treeOidNow: treeOid,`,
		`  filteredSubjectTreeOidNow: subjectTreeOid,`,
		`  executionIdentityDerivation: { executionHeadExists: executionHeadExists, executionTreeExists: executionTreeExists, derivedTreeOid: derivedTree },`,
		"});",
		`const ok = isEvidenceOk(view);`,
		`const struct = isEvidenceStructurallyValid(view);`,
		`const probeVerdict = ok ? 'CLOSED' : struct ? 'PARTIAL' : 'OPEN';`,
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

// ---------- Leamas v2 candidate-validation ---------------------------------

/**
 * Build the v2 fixture payload that Leamas must accept. The payload
 * uses only documented v2 fields (no producer extensions) and
 * well-formed OID strings.
 */
function knownValidV2FixtureText(): string {
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
		execution_head_oid: "0".repeat(40),
		execution_tree_oid: "0".repeat(40),
		subject_tree_oid: "0".repeat(40),
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

function knownInvalidV3FixtureText(): string {
	return `${JSON.stringify(
		{
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
		},
		null,
		"\t",
	)}\n`;
}

function malformedV2FixtureText(): string {
	return `${JSON.stringify({
		schema_version: 2,
		scope_id: "MALFORMED",
	})}\n`;
}

/**
 * Stage the provided fixture as `.factory/gate-summary.json` in a
 * fresh isolated git repository at `repoRoot`. Returns the repo's
 * HEAD, the head-tree OID, the HEAD subject OID, and the SHA-256 of
 * the fixture bytes themselves.
 */
function setupFixtureRepoAt(
	repoRoot: string,
	fixtureText: string,
): {
	repoRoot: string;
	head_oid: string;
	commit_tree_oid: string;
	subject_tree_oid: string;
	fixture_sha256: string;
	committed_summary_sha256: string;
} {
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
	if (init.status !== 0) {
		throw new Error(`git init failed: ${init.stderr}`);
	}
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
	const commit = run(["commit", "--quiet", "-m", "leamas v2 fixture"]);
	if (commit.status !== 0) {
		throw new Error(`git commit failed: ${commit.stderr}`);
	}
	const headOid =
		spawnSync("git", ["rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"], {
			cwd: repoRoot,
			encoding: "utf8",
			env: { ...process.env, ...env },
		}).stdout.toString().trim();
	const commitTreeOid =
		spawnSync("git", ["rev-parse", "--verify", "--end-of-options", "HEAD^{tree}"], {
			cwd: repoRoot,
			encoding: "utf8",
			env: { ...process.env, ...env },
		}).stdout.toString().trim();
	// P0-1 — read the bytes Git actually committed via
	// `git show HEAD:.factory/gate-summary.json` and hash the buffer.
	// The round-8 derivation (`slice(0,0)` of stdout) always hashed
	// the empty string. Round-9 reads the real committed bytes.
	const committedBytesResult = spawnSync(
		"git",
		["show", "HEAD:.factory/gate-summary.json"],
		{
			cwd: repoRoot,
			env: { ...process.env, ...env },
		},
	);
	if (committedBytesResult.status !== 0) {
		throw new Error(
			`git show HEAD:.factory/gate-summary.json failed: ${(committedBytesResult.stderr ?? Buffer.alloc(0)).toString()}`,
		);
	}
	const committedBytes: Buffer = committedBytesResult.stdout ?? Buffer.alloc(0);
	const committedSummarySha = sha256Buffer(committedBytes);
	return {
		repoRoot,
		head_oid: headOid,
		// P0-2 — `commit_tree_oid` is the actual commit tree, distinct
		// from `subject_tree_oid`. The two coincide for the isolated
		// candidate repo (no filter applied) but the field names are
		// preserved so the attestation contract is honest about which
		// tree the producer is binding to.
		commit_tree_oid: commitTreeOid,
		subject_tree_oid: commitTreeOid,
		fixture_sha256: sha256(fixtureText),
		committed_summary_sha256: committedSummarySha,
	};
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * P0-1 — Run the Leamas v2 contract against an isolated candidate
 * git repository containing the EXACT bytes of the staged v2
 * summary. The candidate repo lives under `leamasStagingDir`, a
 * sibling of `.factory/` (NOT under the swap-target staging
 * directory), so it cannot contaminate the canonical bundle.
 *
 * The contract checks four repos:
 *
 *   1. candidate_repo     — the staged v2 summary, committed as
 *                            `.factory/gate-summary.json`. MUST be
 *                            accepted (source_status=present,
 *                            schema_version=2).
 *   2. known_valid_v2     — the known-valid fixture from
 *                            `knownValidV2FixtureText()`. MUST be
 *                            accepted.
 *   3. known_invalid_v3   — a fixture with schema_version=3. MUST
 *                            be rejected.
 *   4. malformed_v2       — a schema-v2 payload that is structurally
 *                            incomplete. MUST be rejected.
 *
 * The function returns the persisted attestation and a small
 * `fixtures` map recording each fixture's
 * (repoRoot, head_oid, fixture_sha256) so the producer can
 * reference them in the extended sibling and the attestation.
 */
function runCandidateLeamasValidation(args: {
	ctx: SnapshotContext;
	leamasStagingDir: string;
	candidateStagingDir: string;
	candidateSummaryText: string;
	candidateHeadOid: string;
	candidateSubjectTreeOid: string;
}): {
	check: Cmd;
	result: RunResult;
	status: CheckStatus;
	reason: string;
	attestation: LeamasAttestation;
	fixtureRepos: {
		candidate: string;
		valid: string;
		invalidV3: string;
		malformed: string;
	};
	fixtureSha256s: {
		candidate: string;
		valid: string;
		invalidV3: string;
		malformed: string;
	};
	candidateRepoHeadOid: string;
	candidateRepoCommitTreeOid: string;
	candidateRepoSubjectTreeOid: string;
	candidateDurableToolingDir: string;
	candidateRepoBundlePath: string;
	candidateRepoBundleSha256: string;
	candidateSummaryPayloadPath: string;
	candidateSummaryPayloadSha256: string;
	candidateSummarySha256: string;
	candidateCommittedSummarySha256: string;
	sourceMatchesCommit: boolean;
	// µC-3 round 10 — typed descriptors for the two durable payloads.
	// These flow through the publisher, the attestation, and the
	// renderer; the ad-hoc `name/hash/path` tuples are gone.
	candidateBundlePayload: DurablePayload;
	candidateSummaryPayload: DurablePayload;
} {
	const { ctx, leamasStagingDir, candidateStagingDir, candidateSummaryText } = args;
	const toolingDir = join(leamasStagingDir, "tooling");
	mkdirSync(toolingDir, { recursive: true });

	// Stage 1: candidate repo containing the EXACT staged bytes.
	const candidateRepoRoot = join(candidateStagingDir, "repo");
	const candidate = setupFixtureRepoAt(candidateRepoRoot, candidateSummaryText);
	// Persist portable verification material before ephemeral staging cleanup.
	const candidateBundlePath = join(toolingDir, CANDIDATE_BUNDLE_ID);
	const bundleResult = spawnSync("git", ["-C", candidateRepoRoot, "bundle", "create", candidateBundlePath, "HEAD"], { encoding: "utf8" });
	if (bundleResult.status !== 0) throw new Error(`candidate git bundle failed: ${bundleResult.stderr ?? ""}`);
	const candidatePayloadPath = join(toolingDir, CANDIDATE_SUMMARY_ID);
	writeFileSync(candidatePayloadPath, candidateSummaryText);
	const candidateBundleSha256 = sha256Buffer(readFileSync(candidateBundlePath));
	const candidatePayloadSha256 = sha256Buffer(readFileSync(candidatePayloadPath));
	// Build the typed descriptors so the publisher, attestation, and
	// renderer all consume the same shape. The descriptors carry
	// every identifier the durable-payload contract needs:
	//   - `id` is the on-disk filename inside the tooling directory
	//   - `source_abs` is the absolute path the producer reads from
	//   - `destination_rel` is the POSIX-relative path used by the
	//     attestation's wire-path field
	//   - `sha256` is the hash of the bytes the publisher WROTE
	const candidateBundlePayload = durablePayload({
		id: CANDIDATE_BUNDLE_ID,
		source_abs: candidateBundlePath,
		destination_rel: CANDIDATE_BUNDLE_DEST_REL,
		sha256: candidateBundleSha256,
	});
	const candidateSummaryPayload = durablePayload({
		id: CANDIDATE_SUMMARY_ID,
		source_abs: candidatePayloadPath,
		destination_rel: CANDIDATE_SUMMARY_DEST_REL,
		sha256: candidatePayloadSha256,
	});


	// Stage 2: known-valid v2 fixture.
	const validRepo = setupFixtureRepoAt(
		join(toolingDir, "valid-v2", "repo"),
		knownValidV2FixtureText(),
	);

	// Stage 3: known-invalid v3 fixture.
	const invalidV3Repo = setupFixtureRepoAt(
		join(toolingDir, "invalid-v3", "repo"),
		knownInvalidV3FixtureText(),
	);

	// Stage 4: malformed v2 fixture.
	const malformedRepo = setupFixtureRepoAt(
		join(toolingDir, "malformed-v2", "repo"),
		malformedV2FixtureText(),
	);

	const pipeline = [
		`set +e`,
		`LEAMAS_BIN=${shellQuote(ctx.leamas)}`,
		`OUT_DIR=${shellQuote(toolingDir)}`,
		`CAND_REPO=${shellQuote(candidateRepoRoot)}`,
		`V_REPO=${shellQuote(validRepo.repoRoot)}`,
		`V3_REPO=${shellQuote(invalidV3Repo.repoRoot)}`,
		`MAL_REPO=${shellQuote(malformedRepo.repoRoot)}`,
		`if [ ! -x "$LEAMAS_BIN" ]; then echo "leamas_unavailable=true"; exit 0; fi`,
		`"$LEAMAS_BIN" --version > "$OUT_DIR/version.txt" 2>&1`,
		`( cd "$CAND_REPO" && "$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-candidate.txt" ) >/dev/null 2>&1`,
		`echo "candidate_exit=$?"`,
		`( cd "$V_REPO" && "$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-valid.txt" ) >/dev/null 2>&1`,
		`echo "valid_exit=$?"`,
		`( cd "$V3_REPO" && "$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-v3.txt" ) >/dev/null 2>&1`,
		`echo "v3_exit=$?"`,
		`( cd "$MAL_REPO" && "$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-malformed.txt" ) >/dev/null 2>&1`,
		`echo "mal_exit=$?"`,
		`echo "leamas_unavailable=false"`,
		`echo "candidate_v2_accepted=$(grep -c 'schema_version=2' "$OUT_DIR/digest-candidate.txt" || true)"`,
		`echo "candidate_source_present=$(grep -c 'source_status=present' "$OUT_DIR/digest-candidate.txt" || true)"`,
		`echo "valid_v2_accepted=$(grep -c 'schema_version=2' "$OUT_DIR/digest-valid.txt" || true)"`,
		`echo "valid_source_present=$(grep -c 'source_status=present' "$OUT_DIR/digest-valid.txt" || true)"`,
		`echo "v3_rejected=$(grep -c 'source_status=invalid' "$OUT_DIR/digest-v3.txt" || true)"`,
		`echo "v3_schema_invalid=$(grep -c 'schema_version=0' "$OUT_DIR/digest-v3.txt" || true)"`,
		`echo "malformed_rejected=$(grep -c 'source_status=invalid' "$OUT_DIR/digest-malformed.txt" || true)"`,
	].join("\n");

	const check: Cmd = {
		name: "leamas_v2_contract",
		scope: "TOOLING",
		evidence:
			"Pipeline: leamas --version + leamas factory digest against the candidate repo (containing the staged v2 summary) + a known-valid v2 fixture repo + a v3 (invalid) fixture repo + a malformed v2 fixture repo",
		cwd: ctx.repoRoot,
		exec: "/bin/sh",
		args: ["-c", pipeline],
		timeout_ms: 5 * 60_000,
	};
	const result = runExec(check);
	const stdout = result.stdout;
	const unavailable = /leamas_unavailable=true/.test(stdout);
	const candidateV2Accepted = /candidate_v2_accepted=[1-9]/.test(stdout);
	const candidateSourcePresent = /candidate_source_present=[1-9]/.test(stdout);
	const validV2Accepted = /valid_v2_accepted=[1-9]/.test(stdout);
	const validSourcePresent = /valid_source_present=[1-9]/.test(stdout);
	const v3Rejected = /v3_rejected=[1-9]/.test(stdout) || /v3_schema_invalid=[1-9]/.test(stdout);
	const malformedRejected = /malformed_rejected=[1-9]/.test(stdout);
	let status: CheckStatus;
	let reason: string;
	if (unavailable) {
		status = "unavailable";
		reason = "leamas binary not located on PATH";
	} else if (!candidateV2Accepted) {
		status = "fail";
		reason = `candidate v2_accepted=${candidateV2Accepted}; expected schema_version=2 in candidate digest`;
	} else if (!candidateSourcePresent) {
		status = "fail";
		reason = `candidate source_present=${candidateSourcePresent}; expected source_status=present`;
	} else if (!validV2Accepted || !validSourcePresent) {
		status = "fail";
		reason = `valid-v2 fixture not accepted: schema=${validV2Accepted} source=${validSourcePresent}`;
	} else if (!v3Rejected) {
		status = "fail";
		reason = `v3 not rejected by leamas: ${v3Rejected}`;
	} else if (!malformedRejected) {
		status = "fail";
		reason = `malformed not rejected by leamas: ${malformedRejected}`;
	} else {
		status = "pass";
		reason =
			"v2 accepted (candidate repo + known-valid fixture); v3 rejected; malformed rejected";
	}

	let versionBody = "";
	try {
		versionBody = readFileSync(join(toolingDir, "version.txt"), "utf8");
	} catch {
		// ignore
	}
	const buildCommitMatch = versionBody.match(/commit:\s*(\S+)/);
	const versionMatch = versionBody.match(/version:\s*(\S+)/);
	const declaredVersion = versionBody.match(/declared_version:\s*(\S+)/);
	const stageOutcome = (path: string, expected: "accept" | "reject"): "accept" | "reject" => {
		try {
			const text = readFileSync(path, "utf8");
			if (/source_status=invalid/.test(text) || /schema_version=0/.test(text)) return "reject";
			if (/source_status=present/.test(text) && /schema_version=2/.test(text)) return "accept";
		} catch {
			// ignore
		}
		return expected === "reject" ? "accept" : "reject";
	};
	const candidateDigest = join(toolingDir, "digest-candidate.txt");
	const validDigest = join(toolingDir, "digest-valid.txt");
	const v3Digest = join(toolingDir, "digest-v3.txt");
	const malformedDigest = join(toolingDir, "digest-malformed.txt");
	const stages: LeamasAttestationStage[] = [
		{
			label: "candidate_repo",
			repo_root: candidateRepoRoot,
			range: "HEAD",
			digest_output_path: toPortablePath(candidateDigest),
			raw_excerpt: excerpt(readFileIfExists(candidateDigest)),
			expected_outcome: "accept",
			observed_outcome: stageOutcome(candidateDigest, "accept"),
		},
		{
			label: "known_valid_v2_fixture_repo",
			repo_root: validRepo.repoRoot,
			range: "HEAD",
			digest_output_path: toPortablePath(validDigest),
			raw_excerpt: excerpt(readFileIfExists(validDigest)),
			expected_outcome: "accept",
			observed_outcome: stageOutcome(validDigest, "accept"),
		},
		{
			label: "known_invalid_v3_fixture_repo",
			repo_root: invalidV3Repo.repoRoot,
			range: "HEAD",
			digest_output_path: toPortablePath(v3Digest),
			raw_excerpt: excerpt(readFileIfExists(v3Digest)),
			expected_outcome: "reject",
			observed_outcome: stageOutcome(v3Digest, "reject"),
		},
		{
			label: "malformed_v2_fixture_repo",
			repo_root: malformedRepo.repoRoot,
			range: "HEAD",
			digest_output_path: toPortablePath(malformedDigest),
			raw_excerpt: excerpt(readFileIfExists(malformedDigest)),
			expected_outcome: "reject",
			observed_outcome: stageOutcome(malformedDigest, "reject"),
		},
	];
	// P0-3 — `leamas_accepted_interim_candidate` records ONLY that
	// Leamas accepted the interim candidate bytes. The legacy
	// `leamas_validated_candidate` alias is retained for backward
	// compatibility with round-8 readers but is the SAME boolean.
	// P0-1 / P0-2 — the SHA-256 and OID pairs are bound to the actual
	// committed bytes / tree, not the source bytes / subject tree.
	const sourceMatchesCommit =
		candidate.fixture_sha256 === candidate.committed_summary_sha256;
	const attestation: LeamasAttestation = {
		tool: {
			name: "leamas",
			build_commit: buildCommitMatch?.[1] ?? null,
			version: versionMatch?.[1] ?? declaredVersion?.[1] ?? null,
		},
		command: `${ctx.leamas} factory digest --range HEAD --output <digest-path>`,
		ran_at: new Date().toISOString(),
		// SHA-256 of the source bytes (`sha256(candidateSummaryText)`).
		candidate_summary_sha256: candidate.fixture_sha256,
		// SHA-256 of the bytes actually committed
		// (`sha256(git show HEAD:.factory/gate-summary.json)`).
		candidate_summary_sha256_at_commit: candidate.committed_summary_sha256,
		// Hash-equality invariant: source bytes hash == committed bytes hash.
		candidate_summary_sha256_source_matches_commit: sourceMatchesCommit,
		// Bytes that landed in canonical `.factory/gate-summary.json`
		// after the atomic publish. Set by the producer's main() before
		// the attestation is serialized.
		canonical_summary_sha256: "<set after extended build>",
		canonical_extended_sha256: "<set after extended build>",
		candidate_repo_head_oid: candidate.head_oid,
		candidate_repo_commit_tree_oid: candidate.commit_tree_oid,
		candidate_repo_subject_tree_oid: candidate.subject_tree_oid,
		// P0-1 — `destination_rel` from the durable-payload descriptor
		// is the SOLE authority for the attestation's wire paths.
		// `id` is a diagnostic identifier only and MUST NOT be used
		// to derive a destination. The publisher writes the byte
		// stream at `stagingDir / payload.destination_rel`; the
		// attestation must advertise the SAME path or the renderer
		// re-derivation will fail.
		candidate_repo_bundle_path: candidateBundlePayload.destination_rel,
		candidate_repo_bundle_sha256: candidateBundleSha256,
		candidate_summary_payload_path: candidateSummaryPayload.destination_rel,
		candidate_summary_payload_sha256: candidatePayloadSha256,
		// Historical alias for round 8 readers — same boolean as
		// `leamas_accepted_interim_candidate`. Round 9 also reports
		// the truthful replacement alongside it.
		leamas_validated_candidate: status === "pass",
		// Truthful replacement: Leamas accepted the interim candidate.
		// This is NOT a hash-equality invariant.
		leamas_accepted_interim_candidate: status === "pass",
		candidate_validation_exit_code: result.extras.exit_code,
		stages,
		verdict: status === "pass" ? "pass" : status === "unavailable" ? "unavailable" : "fail",
		reason,
	}
	return {
		check,
		result,
		status,
		reason,
		attestation,
		fixtureRepos: {
			candidate: candidateRepoRoot,
			valid: validRepo.repoRoot,
			invalidV3: invalidV3Repo.repoRoot,
			malformed: malformedRepo.repoRoot,
		},
		fixtureSha256s: {
			candidate: candidate.fixture_sha256,
			valid: validRepo.fixture_sha256,
			invalidV3: invalidV3Repo.fixture_sha256,
			malformed: malformedRepo.fixture_sha256,
		},
		candidateRepoHeadOid: candidate.head_oid,
		candidateRepoCommitTreeOid: candidate.commit_tree_oid,
		candidateRepoSubjectTreeOid: candidate.subject_tree_oid,
		candidateDurableToolingDir: toolingDir,
		candidateRepoBundlePath: candidateBundlePayload.destination_rel,
		candidateRepoBundleSha256: candidateBundleSha256,
		candidateSummaryPayloadPath: candidateSummaryPayload.destination_rel,
		candidateSummaryPayloadSha256: candidatePayloadSha256,
		candidateSummarySha256: candidate.fixture_sha256,
		candidateCommittedSummarySha256: candidate.committed_summary_sha256,
		sourceMatchesCommit,
		// µC-3 round 10 — propagate the typed descriptors so the
		// publisher, attestation, and renderer consume the SAME shape.
		candidateBundlePayload,
		candidateSummaryPayload,
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
	return {
		total: Number.parseInt(ranMatch?.[1] ?? "0", 10) || 0,
		pass_count: Number.parseInt(passLine, 10) || 0,
		fail_count: Number.parseInt(failLine, 10) || 0,
		skip_count: Number.parseInt(skipLine, 10) || 0,
		unavailable_count: Number.parseInt(unavailLine, 10) || 0,
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
	const rangePatch = runExec(GIT_RANGE_HYGIENE(ctx));
	out.push(summarizeAndPersist(ctx.stagingDir, GIT_RANGE_HYGIENE(ctx), rangePatch));
	const workingTree = runExec(WORKING_TREE_CLEANLINESS(ctx));
	out.push(
		summarizeAndPersist(
			ctx.stagingDir,
			WORKING_TREE_CLEANLINESS(ctx),
			workingTree,
		),
	);
	const tsc = runExec(TSC_STRICT(ctx));
	out.push(summarizeAndPersist(ctx.stagingDir, TSC_STRICT(ctx), tsc));
	const closureLogic = runExec(CORRECTION21_CLOSURE_LOGIC_TESTS(ctx));
	out.push(
		summarizeAndPersist(
			ctx.stagingDir,
			CORRECTION21_CLOSURE_LOGIC_TESTS(ctx),
			closureLogic,
		),
	);
	const correction21Probe = buildCorrection21Probe(ctx, parentState);
	const probeResult = runExec(correction21Probe);
	out.push(summarizeAndPersist(ctx.stagingDir, correction21Probe, probeResult));
	for (const { label, path } of FOCUSED_SUITE_PATHS) {
		const cmd = focusedSuiteCmd(ctx, label, path);
		const r = runExec(cmd);
		out.push(summarizeAndPersist(ctx.stagingDir, cmd, r));
	}
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

// ---------- atomic publication (P0-1, P0-4) ------------------------------

/**
 * Stage-then-swap with rollback. Steps:
 *
 *   1. Write the v2 summary, the extended sibling, and the leamas
 *      attestation into the staging directory (already accumulated by
 *      the producer before this call).
 *   2. STAGE-SIDE GUARDS: re-read every persisted file and verify its
 *      on-disk SHA-256 matches the in-memory representation.
 *   3. In-process structural validation of the staged v2 summary
 *      BEFORE swap. A defect caught here is a clean failure: the
 *      staging dir is deleted and no canonical file was touched.
 *   4. If `.factory/` exists, rename it to `ctx.backupDir`.
 *      (POSIX `renameSync` is atomic per-call. Between steps 4 and 5
 *      observers see `.factory/` missing; nothing else writes
 *      `.factory/` concurrently.)
 *   5. Rename `ctx.stagingDir` → `ctx.factoryDir`. After this,
 *      observers see the new bundle.
 *   6. Post-swap confirmation: the canonical bytes match what we
 *      serialized. A failure here triggers a rollback (rename backup
 *      back to `.factory/`).
 */
function atomicPublish(
	ctx: SnapshotContext,
	summary: GateSummary,
	extended: GateSummaryExtended,
	attestation: LeamasAttestation,
	ops: AtomicPublishOps = defaultAtomicPublishOps,
): {
	summaryBytesOnDisk: string;
	extendedBytesOnDisk: string;
	attestationBytesOnDisk: string;
	canonicalSummarySha256: string;
	canonicalExtendedSha256: string;
	canonicalAttestationSha256: string;
} {
	const summaryPath = stagingGateSummaryPath(ctx.stagingDir);
	const extendedPath = stagingExtendedPath(ctx.stagingDir);
	const attestationPath = stagingLeamasAttestationPath(ctx.stagingDir);
	const summaryText = serializeGateSummary(summary);
	const extendedText = serializeExtended(extended);
	const attestationText = serializeLeamasAttestation(attestation);
	ops.writeFile(summaryPath, summaryText);
	ops.writeFile(extendedPath, extendedText);
	ops.writeFile(attestationPath, attestationText);

	const onDiskSummary = ops.readFile(summaryPath);
	const onDiskExtended = ops.readFile(extendedPath);
	const onDiskAttestation = ops.readFile(attestationPath);
	if (sha256(onDiskSummary) !== sha256(summaryText)) {
		throw new Error("GATE_SUMMARY_STAGE_HASH_DRIFT:summary");
	}
	if (sha256(onDiskExtended) !== sha256(extendedText)) {
		throw new Error("GATE_SUMMARY_STAGE_HASH_DRIFT:extended");
	}
	if (sha256(onDiskAttestation) !== sha256(attestationText)) {
		throw new Error("GATE_SUMMARY_STAGE_HASH_DRIFT:attestation");
	}
	const validation = validateGateSummaryStructure(JSON.parse(onDiskSummary));
	if (!validation.ok) {
		throw new Error(
			`GATE_SUMMARY_STRUCTURAL_VALIDATION_FAILED:${validation.errors.join(" | ")}`,
		);
	}
	const hadCanonical = existsSync(ctx.factoryDir);
	if (hadCanonical) {
		if (existsSync(ctx.backupDir)) {
			ops.rmSync(ctx.backupDir, { recursive: true, force: true });
		}
		ops.renameSync(ctx.factoryDir, ctx.backupDir);
	}
	let swapped = false;
	try {
		ops.renameSync(ctx.stagingDir, ctx.factoryDir);
		swapped = true;
	} catch (e) {
		if (hadCanonical) {
			try {
				ops.renameSync(ctx.backupDir, ctx.factoryDir);
			} catch {
				// best-effort rollback
			}
		}
		throw e;
	}
	const canonicalSummaryBytes = ops.readFile(ctx.canonicalSummaryPath);
	const canonicalExtendedBytes = ops.readFile(ctx.canonicalExtendedPath);
	const canonicalAttestationBytes = ops.readFile(ctx.canonicalLeamasAttestationPath);
	if (sha256(canonicalSummaryBytes) !== sha256(summaryText)) {
		throw new Error("GATE_SUMMARY_POST_SWAP_HASH_DRIFT:summary");
	}
	if (sha256(canonicalExtendedBytes) !== sha256(extendedText)) {
		throw new Error("GATE_SUMMARY_POST_SWAP_HASH_DRIFT:extended");
	}
	if (sha256(canonicalAttestationBytes) !== sha256(attestationText)) {
		throw new Error("GATE_SUMMARY_POST_SWAP_HASH_DRIFT:attestation");
	}
	void swapped;
	return {
		summaryBytesOnDisk: canonicalSummaryBytes,
		extendedBytesOnDisk: canonicalExtendedBytes,
		attestationBytesOnDisk: canonicalAttestationBytes,
		canonicalSummarySha256: sha256(canonicalSummaryBytes),
		canonicalExtendedSha256: sha256(canonicalExtendedBytes),
		canonicalAttestationSha256: sha256(canonicalAttestationBytes),
	};
}

// ---------- main (P0-1, P0-2, P0-3, P0-4) ---------------------------------

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

	// Step 1 — derive parent state BEFORE any executable check; the
	// probe consumes the in-process verdict.
	const parentState = deriveParentActState(ctx);

	// Step 2 — run every executable check EXCEPT leamas_v2_contract.
	// The leamas check runs AFTER the staged candidate summary is
	// built (P0-1) so it can validate the exact bytes that will
	// become canonical.
	const checks: GateCheckSummary[] = collectChecks(ctx, parentState);

	// Step 3 — capture identity-after-checks (P0-3). The canonical
	// summary's `worktree_clean_*` fields use THIS sample. The
	// later publication-bundle-only sample (after cleanup) is
	// recorded in the extended sibling to avoid self-reference.
	const identityAfterChecks = captureSnapshot(ctx.repoRoot, ctx.git);
	const identityStableAfterChecks =
		identityAfterChecks.head_oid === ctx.identityBefore.head_oid &&
		identityAfterChecks.tree_oid === ctx.identityBefore.tree_oid &&
		identityAfterChecks.subject_tree_oid === ctx.identityBefore.subject_tree_oid;
	const rejectionReasons = deriveRejectionReasons(
		ctx.identityBefore,
		identityAfterChecks,
	);
	if (rejectionReasons.length > 0) {
		console.error(
			`gate-summary: identity/worktree rejection: ${rejectionReasons.map((r) => r.code).join(",")}`,
		);
		process.exit(3);
	}

	// Step 4 — build the INTERIM summary WITHOUT the leamas check
	// (P0-2). This is the bytes that get validated by Leamas.
	const interimScope = deriveScopeStatus(checks);
	const interimParentStatus = deriveParentStatus(parentState);
	const interimOverall = deriveOverallStatus(checks);
	const interimOverallDisposition = deriveOverallDisposition(interimOverall);
	const interimSummary = buildFinalSummary({
		generatedAt: new Date().toISOString(),
		scopeId: SCOPE_ID,
		scopeStatus: interimScope.status,
		scopeDisposition: interimScope.disposition,
		parentAct: PARENT_ACT_ID,
		parentStatus: interimParentStatus,
		parentDisposition: parentState.disposition,
		overallStatus: interimOverall,
		overallDisposition: interimOverallDisposition,
		executionHeadOid: ctx.headOid,
		executionTreeOid: ctx.treeOid,
		subjectTreeOid: ctx.subjectTreeOid,
		worktreeCleanBefore: ctx.worktreeCleanBefore,
		worktreeCleanAfter: identityAfterChecks.worktree_clean,
		checks,
	});
	const interimSummaryText = serializeGateSummary(interimSummary);
	writeFileSync(stagingGateSummaryPath(ctx.stagingDir), interimSummaryText);

	// Step 5 — run the EXACT-CANDIDATE leamas validation. The staged
	// bytes become `.factory/gate-summary.json` in a freshly-isolated
	// candidate git repository; Leamas digests THAT, not the
	// previous canonical.
	const candidateStagingDir = join(ctx.stagingDir, "candidate-isolated");
	mkdirSync(candidateStagingDir, { recursive: true });
	const leamasContract = runCandidateLeamasValidation({
		ctx,
		leamasStagingDir: ctx.stagingDir.replace(
			/\.factory-staging-/,
			".factory-leamas-staging-",
		),
		candidateStagingDir,
		candidateSummaryText: interimSummaryText,
		candidateHeadOid: ctx.headOid,
		candidateSubjectTreeOid: ctx.subjectTreeOid,
	});
	// Move only the durable candidate verification material into the bundle
	// that will survive atomic publication; the isolated repository itself
	// remains disposable. The publisher consumes the SAME `DurablePayload`
	// descriptors the validator and attestation produced; the destination
	// path, identifier, and expected hash all flow through the typed
	// record so the durable-payload contract cannot drift between them.
	const durableToolingDir = join(ctx.stagingDir, "gates", "tooling");
	mkdirSync(durableToolingDir, { recursive: true });
	const durablePayloads: DurablePayload[] = [
		leamasContract.candidateBundlePayload,
		leamasContract.candidateSummaryPayload,
	];
	// P0-1 — delegate the copy / hash-check / atomic-publish step
	// to the typed helper so the publisher, the attestation, and the
	// tests all consume the SAME `DurablePayload` descriptors. The
	// destination of each payload is determined solely by
	// `payload.destination_rel` joined with `stagingDir`; `id` is
	// a diagnostic identifier only and does not contribute to the
	// destination path. A throw from this helper leaves the staging
	// directory in an inconsistent state and the canonical swap must
	// NOT be called — the old canonical bundle therefore remains
	// intact.
	const payloadDestinations = publishDurablePayloads(
		ctx.stagingDir,
		durablePayloads,
	);
	void payloadDestinations;

	// Step 5b — capture identity AFTER every executable check
	// operation has run, INCLUDING the Leamas candidate validation
	// and its fixture-repo cleanup. The canonical v2's
	// `worktree_clean_after` references this sample so the
	// worktree state truthfully reflects what was true at the end of
	// every executable step the producer ran.
	const identityAfterLeamas = captureSnapshot(ctx.repoRoot, ctx.git);
	const identityStableAfterLeamas =
		identityAfterLeamas.head_oid === ctx.identityBefore.head_oid &&
		identityAfterLeamas.tree_oid === ctx.identityBefore.tree_oid &&
		identityAfterLeamas.subject_tree_oid === ctx.identityBefore.subject_tree_oid;
	// P0-4 — derive rejection reasons from the POST-Leamas sample so
	// the extended file can surface HEAD/tree/subject drift that
	// happened INSIDE the Leamas invocation (which is invisible to
	// the post-checks-only sample).
	const finalRejectionReasons = deriveRejectionReasons(
		ctx.identityBefore,
		identityAfterLeamas,
	);
	if (!identityStableAfterLeamas || finalRejectionReasons.length > 0) {
		console.error(
			`gate-summary: post-Leamas drift: stable=${identityStableAfterLeamas} reasons=${finalRejectionReasons.map((r) => r.code).join(",")}`,
		);
		throw new Error("GATE_SUMMARY_REPOSITORY_DRIFT_AFTER_LEAMAS");
	}

	// Step 6 — append the leamas check to the canonical checks
	// list. Re-derive scope/overall from the FULL list. Build the
	// FINAL summary (P0-2).
	const leamasCheckSummary = summarizeAndPersist(
		ctx.stagingDir,
		leamasContract.check,
		leamasContract.result,
		leamasContract.status === "unavailable" ? undefined : leamasContract.status,
	);
	checks.push(leamasCheckSummary);
	assertUniqueCheckNames(checks);
	const finalScope = deriveScopeStatus(checks);
	const finalParentStatus = deriveParentStatus(parentState);
	const finalOverall = deriveOverallStatus(checks);
	const finalOverallDisposition = deriveOverallDisposition(finalOverall);
	const finalSummary = buildFinalSummary({
		generatedAt: new Date().toISOString(),
		scopeId: SCOPE_ID,
		scopeStatus: finalScope.status,
		scopeDisposition: finalScope.disposition,
		parentAct: PARENT_ACT_ID,
		parentStatus: finalParentStatus,
		parentDisposition: parentState.disposition,
		overallStatus: finalOverall,
		overallDisposition: finalOverallDisposition,
		executionHeadOid: ctx.headOid,
		executionTreeOid: ctx.treeOid,
		subjectTreeOid: ctx.subjectTreeOid,
		worktreeCleanBefore: ctx.worktreeCleanBefore,
		worktreeCleanAfter: identityAfterLeamas.worktree_clean,
		checks,
	});
	const finalSummaryText = serializeGateSummary(finalSummary);
	writeFileSync(stagingGateSummaryPath(ctx.stagingDir), finalSummaryText);

	// Step 7 — build the canonical attestation. The attestation
	// spreads the candidate validation output and overrides the
	// fields main() knows truthfully:
	//
	//   - candidate_summary_sha256_at_commit — replaced with
	//     `leamasContract.candidateCommittedSummarySha256` (the bytes
	//     `git show HEAD:.factory/gate-summary.json` returned from
	//     the candidate repo), NOT `slice(0,0)` of stdout (round 8).
	//   - canonical_summary_sha256 — set from `sha256(finalSummaryText)`,
	//     the bytes that will land in canonical after the swap.
	//   - candidate_repo_*_oid — bound to the actual candidate commit
	//     tree, not the producer's filtered subject tree (round 8).
	const attestation: LeamasAttestation = {
		...leamasContract.attestation,
		candidate_summary_sha256: leamasContract.candidateSummarySha256,
		candidate_summary_sha256_at_commit:
			leamasContract.candidateCommittedSummarySha256,
		canonical_summary_sha256: sha256(finalSummaryText),
		candidate_repo_head_oid: leamasContract.candidateRepoHeadOid,
		candidate_repo_commit_tree_oid: leamasContract.candidateRepoCommitTreeOid,
		candidate_repo_subject_tree_oid: leamasContract.candidateRepoSubjectTreeOid,
		candidate_validation_exit_code: leamasContract.result.extras.exit_code,
		canonical_extended_sha256: "<set after extended build>",
	};
	if (!attestation.leamas_accepted_interim_candidate) {
		// Fail closed: the document validates a stale candidate and is
		// unsafe to publish. Surface a clear error so the operator knows
		// why the summary was never written.
		throw new Error("GATE_SUMMARY_LEAMAS_CANDIDATE_REJECTED");
	}
	if (!attestation.candidate_summary_sha256_source_matches_commit) {
		// P0-1 — the source bytes and the bytes Git actually committed
		// disagree. The producer's intended bytes did not survive the
		// round-trip through the isolated candidate repo, so the
		// attestation cannot honestly claim `committed == source`.
		throw new Error("GATE_SUMMARY_LEAMAS_COMMIT_HASH_MISMATCH");
	}
	const extended = buildExtended({
		tool: { name: PRODUCER_NAME, version: PRODUCER_VERSION },
		// P0-4 — use the POST-Leamas identity snapshot. Round 8 used
		// `identityStableAfterChecks` and never propagated
		// `identityStableAfterLeamas` into the extended file or
		// rejection reasons, so Leamas-induced HEAD drift remained
		// unreported.
		identityStable: identityStableAfterLeamas,
		parentActState: parentState,
		// P0-4 — derive from the POST-Leamas sample so any
		// HEAD/tree/subject drift introduced by the Leamas invocation
		// is surfaced alongside the gate-summary.
		rejectionReasons: finalRejectionReasons,
		knownValidV2RepoSha256: leamasContract.fixtureSha256s.valid,
		knownInvalidV3RepoSha256: leamasContract.fixtureSha256s.invalidV3,
		// P1 — fixture hashes use the per-fixture `fixture_sha256`
		// returned by `setupFixtureRepoAt`, not `sha256(<repoPath>)`.
		candidateRepoSha256: leamasContract.fixtureSha256s.candidate,
	});
	const extendedText = serializeExtended(extended);
	writeFileSync(stagingExtendedPath(ctx.stagingDir), extendedText);
	attestation.canonical_extended_sha256 = sha256(extendedText);
	const attestationText = serializeLeamasAttestation(attestation);
	writeFileSync(
		stagingLeamasAttestationPath(ctx.stagingDir),
		attestationText,
	);

	// Step 8 — atomic publication (P0-1, P0-4). The complete bundle
	// (summary + extended + attestation + gates/) lives in staging
	// at the same paths it will have after the swap.
	let swapResult: {
		summaryBytesOnDisk: string;
		extendedBytesOnDisk: string;
		attestationBytesOnDisk: string;
		canonicalSummarySha256: string;
		canonicalExtendedSha256: string;
		canonicalAttestationSha256: string;
	};
	try {
		swapResult = atomicPublish(ctx, finalSummary, extended, attestation);
	} catch (e) {
		console.error(`gate-summary: atomic publish failed: ${(e as Error).message}`);
		process.exit(4);
	}

	// Step 9 — best-effort cleanup. The candidate-isolated directory
	// is OUTSIDE the canonical `.factory/`, so it can be removed
	// without affecting the bundle. The leamas-staging sibling is
	// also outside `.factory/`; delete it now.
	try {
		rmSync(candidateStagingDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
	try {
		rmSync(leamasContract.fixtureRepos.candidate, { recursive: true, force: true });
		rmSync(leamasContract.fixtureRepos.valid, { recursive: true, force: true });
		rmSync(leamasContract.fixtureRepos.invalidV3, { recursive: true, force: true });
		rmSync(leamasContract.fixtureRepos.malformed, { recursive: true, force: true });
	} catch {
		// ignore
	}
	try {
		rmSync(leamasContract.check.evidence.includes(".factory")
			? leamasContract.check.evidence.split(/[ \t]/)[0]
			: join(ctx.repoRoot, ".factory-leamas-staging-${nonce}".replace("${nonce}", ""))
		, { recursive: true, force: true });
	} catch {
		// ignore
	}
	void swapResult;
	try {
		rmSync(ctx.backupDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
	void swapResult;
}

if (import.meta.main) {
	main();
}

export {
	atomicPublish,
	buildCorrection21Probe,
	bootstrap,
	captureSnapshot,
	collectChecks,
	ensureGitignoreEntries,
	GIT_RANGE_HYGIENE,
	knownValidV2FixtureText,
	knownInvalidV3FixtureText,
	malformedV2FixtureText,
	resolveTool,
	runCandidateLeamasValidation,
	setupFixtureRepoAt,
	shellQuote,
	summarizeAndPersist,
};

void dirname;
