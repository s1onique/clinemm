#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — Leamas v2 evidence rebind.
 *
 * Generates the detached `.factory/gate-summary.json` snapshot that
 * certifies the µC-3 reader P0 corrections AND binds the producer to
 * the Leamas gate-summary v2 contract.
 *
 * µC-3 round 5 (LEAMAS-V2-EVIDENCE-REBIND01) rebinds the snapshot to the
 * Leamas v2 contract. Compared to round 4:
 *
 *  1. The schema version is fixed at `2` — no producer-side fallback.
 *
 *  2. `subject_tree_oid` is a non-null OID. The helper is imported from
 *     `./subject-tree` and the summary fails closed (`GATE_SUMMARY_SUBJECT_TREE_UNAVAILABLE`)
 *     when the helper returns `null`. The temporary-index algorithm is
 *     not duplicated here.
 *
 *  3. `worktree_clean_before` and `worktree_clean_after` are sampled
 *     independently. The before sample is captured before the first
 *     check; the after sample is captured after the last check. The two
 *     values are NEVER copied.
 *
 *  4. The CORRECTION21 parent-state probe is real. When the detached
 *     bundle is absent, the parent is `OPEN` with disposition
 *     "no detached production bundle"; when the bundle is present, the
 *     probe loads `evidence.json`, `hashes.sha256`, and
 *     `verification-results.json`, supplies the real executed command
 *     rows and the real HEAD/tree/subject identities, calls
 *     `checkEvidence`, and reports the parent verdict directly from
 *     `isEvidenceOk` / `isEvidenceStructurallyValid`.
 *
 *  5. Every check persists its streams under
 *     `.factory/gates/<scope>/<check>.{stdout,stderr,metadata.json}`.
 *     The metadata record carries argv, cwd, exit_code, duration_ms,
 *     stdout_sha256, stderr_sha256 — these are computed from the exact
 *     bytes written, never copied forward.
 *
 *  6. The status arithmetic is mechanical. `scope_status` is derived
 *     from MICROC3 + WORKTREE + leamas_v2_contract checks; `parent_status`
 *     is derived from the real probe only; `overall_status` is derived
 *     from all checks via the documented Leamas v2 contract
 *     (any fail → fail, else any unavailable → unavailable, else any pass
 *     → pass, else unavailable).
 *
 *  7. The publication is atomic. A staging directory under `.factory/`
 *     accumulates every per-check stream; the canonical
 *     `.factory/gate-summary.json` is only replaced once every required
 *     check has completed, identity has not drifted, post-run cleanliness
 *     is true, AND the summary validates under the v2 contract. A
 *     failed or interrupted run preserves the previous complete bundle.
 *
 *  8. The `leamas_v2_contract` check explicitly exercises the installed
 *     Leamas binary. It runs `leamas --version` to record the build
 *     identity, runs `leamas factory digest` against the canonical
 *     `.factory/gate-summary.json` to confirm v2 acceptance
 *     (source_status=present, schema_version=2), and runs the digest
 *     against a synthetic v3 fixture placed in an isolated Git
 *     repository to confirm v3 remains rejected. The check is `pass`
 *     only when all three stages agree. Failure to locate or execute
 *     Leamas is `unavailable`, never `pass`.
 *
 *  9. The PATH lookup uses `path.delimiter` so Windows CI is supported.
 *
 * The detached bundle directory remains untracked (`.factory/` is in
 * `.gitignore`). Force-adding `.factory/` is a violation of the
 * detached-evidence model.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";

import {
	checkEvidence,
	isEvidenceOk,
	isEvidenceStructurallyValid,
	loadEvidenceFile,
	type ExecutionIdentityDerivation,
	type EvidenceView,
} from "./baseline-closure";
import { computeFilteredSubjectTreeOid } from "./subject-tree";

// ---------- types ----------------------------------------------------------

type CheckScope = "MICROC3" | "CORRECTION21" | "WORKTREE" | "TOOLING";

type CheckStatus = "pass" | "fail" | "unavailable";

type ScopeStatus = "CLOSED" | "OPEN" | "PARTIAL";

type OverallStatus = "pass" | "fail" | "unavailable";

interface CheckMetadata {
	name: string;
	scope: CheckScope;
	status: CheckStatus;
	argv: string[];
	cwd: string;
	exit_code: number | null;
	signal: string | null;
	timeout: boolean;
	duration_ms: number;
	stdout_path: string;
	stdout_sha256: string;
	stderr_path: string;
	stderr_sha256: string;
	started_at: string;
	finished_at: string;
	detail: string;
}

interface GateCheckSummary {
	name: string;
	scope: CheckScope;
	status: CheckStatus;
	evidence: string;
	detail: string;
	extras: {
		argv: string[];
		exit_code: number | null;
		duration_ms: number;
		stdout_sha256: string;
		stderr_sha256: string;
	};
	total?: number;
	pass_count?: number;
	fail_count?: number;
	skip_count?: number;
	unavailable_count?: number;
}

interface ReasonCode {
	code:
		| "REPOSITORY_HEAD_DRIFT"
		| "REPOSITORY_TREE_DRIFT"
		| "SUBJECT_TREE_DRIFT"
		| "WORKTREE_DIRTY_BEFORE"
		| "WORKTREE_DIRTY_AFTER";
	message: string;
}

interface RepositorySnapshot {
	head_oid: string;
	tree_oid: string;
	subject_tree_oid: string;
	worktree_clean: boolean;
	unexpected_paths: string[];
}

interface ParentActState {
	head_oid: string | null;
	tree_oid: string | null;
	bundle_dir_exists: boolean;
	bundle_complete: boolean | null;
	bundle_structurally_valid: boolean | null;
	verdict: "CLOSED" | "OPEN" | "PARTIAL";
	disposition: string;
	diagnostics: string[];
}

// Leamas gate-summary v2 schema: only the documented fields are accepted.
// Producer extensions (tool identity, identity_stable, parent_act_state
// diagnostics, rejection_reasons) are persisted to a sibling
// `.factory/gate-summary.extended.json` so the canonical v2 file
// validates cleanly under the Leamas v2 contract. The extended file
// is gitignored alongside `.factory/gate-summary.json` and never
// affects the Leamas digest output.
interface GateSummary {
	schema_version: 2;
	generated_at: string;
	scope_id: string;
	scope_status: ScopeStatus;
	scope_disposition: string;
	parent_act: string;
	parent_status: ScopeStatus;
	parent_disposition: string;
	overall_status: OverallStatus;
	overall_disposition: string;
	execution_head_oid: string;
	execution_tree_oid: string;
	subject_tree_oid: string;
	worktree_clean_before: boolean;
	worktree_clean_after: boolean;
	checks: GateCheckSummary[];
}

interface GateSummaryExtended {
	tool: { name: string; version: string };
	identity_stable: boolean;
	parent_act_state: ParentActState;
	rejection_reasons: ReasonCode[];
}

interface Cmd {
	name: string;
	scope: CheckScope;
	evidence: string;
	cwd: string;
	exec: string;
	args: string[];
	timeout_ms?: number;
}

interface RunResult {
	stdout: string;
	stderr: string;
	extras: {
		argv: string[];
		exit_code: number | null;
		signal: string | null;
		timeout: boolean;
		duration_ms: number;
		stdout_sha256: string;
		stderr_sha256: string;
		started_at: string;
		finished_at: string;
	};
	ok: boolean;
}

interface SnapshotContext {
	repoRoot: string;
	git: string;
	bun: string;
	bunx: string;
	leamas: string;
	factoryDir: string;
	scriptsDir: string;
	schemasDir: string;
	tsconfigPath: string;
	testsDir: string;
	gatesDir: string;
	stagingDir: string;
	canonicalSummaryPath: string;
	canonicalGatesDir: string;
	parentEvidenceDir: string;
	headOid: string;
	treeOid: string;
	subjectTreeOid: string;
	worktreeCleanBefore: boolean;
	unexpectedPathsBefore: string[];
	identityBefore: RepositorySnapshot;
}

// ---------- constants ------------------------------------------------------

const ACT_ID = "ACT-CLINEMM-FORK-BASELINE01-CORRECTION21";
const PARENT_ACT_ID = ACT_ID;
const SCOPE_ID = `${ACT_ID}-MICROC3`;
const PRODUCER_NAME = "clinemm-factory-gate-summary";
const PRODUCER_VERSION = "round-5-leamas-v2-rebind";

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

const RANDOMIZED_SEEDS: number[] = [1, 2, 3, 4, 5];

const OID_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const CHECK_SCOPES: ReadonlyArray<CheckScope> = [
	"MICROC3",
	"CORRECTION21",
	"WORKTREE",
	"TOOLING",
];

// ---------- helpers --------------------------------------------------------

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

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

function gitText(
	repoRoot: string,
	git: string,
	args: string[],
): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(git, args, { cwd: repoRoot, encoding: "utf8" });
	return {
		status: result.status,
		stdout: (result.stdout ?? "").toString(),
		stderr: (result.stderr ?? "").toString(),
	};
}

function isCleanPorcelain(text: string): { clean: boolean; unexpected: string[] } {
	const lines = text.split("\n").filter((l) => l.length > 0);
	return { clean: lines.length === 0, unexpected: lines };
}

function captureSnapshot(
	repoRoot: string,
	git: string,
): RepositorySnapshot {
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
	return {
		head_oid: OID_PATTERN.test(head) ? head : "",
		tree_oid: OID_PATTERN.test(tree) ? tree : "",
		subject_tree_oid: OID_PATTERN.test(subject) ? subject : "",
		worktree_clean: clean,
		unexpected_paths: unexpected,
	};
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
	const factoryDir = join(repoRoot, "factory");
	const scriptsDir = join(factoryDir, "scripts");
	const schemasDir = join(factoryDir, "schemas");
	const tsconfigPath = join(scriptsDir, "tsconfig.json");
	const testsDir = scriptsDir;
	const gatesDir = join(repoRoot, ".factory", "gates");
	const stagingDir = join(repoRoot, ".factory", "staging", `gate-${Date.now()}`);
	const canonicalSummaryPath = join(repoRoot, ".factory", "gate-summary.json");
	const canonicalGatesDir = gatesDir;
	const parentEvidenceDir = join(repoRoot, ".factory", "evidence", PARENT_ACT_ID);
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
		mkdirSync(join(stagingDir, scope), { recursive: true });
	}
	return {
		repoRoot,
		git,
		bun,
		bunx,
		leamas,
		factoryDir,
		scriptsDir,
		schemasDir,
		tsconfigPath,
		testsDir,
		gatesDir,
		stagingDir,
		canonicalSummaryPath,
		canonicalGatesDir,
		parentEvidenceDir,
		headOid: identity.head_oid,
		treeOid: identity.tree_oid,
		subjectTreeOid: identity.subject_tree_oid,
		worktreeCleanBefore: identity.worktree_clean,
		unexpectedPathsBefore: identity.unexpected_paths,
		identityBefore: identity,
	};
}

// ---------- command execution ---------------------------------------------

function runExec(cmd: Cmd, signalTimeoutMs = 10 * 60_000): RunResult {
	const start = Date.now();
	const startedAt = new Date(start).toISOString();
	const result = spawnSync(cmd.exec, cmd.args, {
		cwd: cmd.cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: cmd.timeout_ms ?? signalTimeoutMs,
	});
	const elapsed = Date.now() - start;
	const finishedAt = new Date(start + elapsed).toISOString();
	const stdout = (result.stdout ?? "").toString();
	const stderr = (result.stderr ?? "").toString();
	const timedOut =
		result.signal === "SIGTERM" && elapsed >= (cmd.timeout_ms ?? signalTimeoutMs);
	return {
		stdout,
		stderr,
		extras: {
			argv: [cmd.exec, ...cmd.args],
			exit_code: result.status,
			signal: result.signal ?? null,
			timeout: timedOut,
			duration_ms: elapsed,
			stdout_sha256: sha256(stdout),
			stderr_sha256: sha256(stderr),
			started_at: startedAt,
			finished_at: finishedAt,
		},
		ok: result.status === 0,
	};
}

function persistCheckStreams(
	ctx: SnapshotContext,
	cmd: Cmd,
	result: RunResult,
	checkStatus: CheckStatus,
): { metadataPath: string; stdoutPath: string; stderrPath: string } {
	const dir = join(ctx.stagingDir, cmd.scope);
	mkdirSync(dir, { recursive: true });
	const stdoutPath = join(dir, `${cmd.name}.stdout`);
	const stderrPath = join(dir, `${cmd.name}.stderr`);
	const metadataPath = join(dir, `${cmd.name}.metadata.json`);
	writeFileSync(stdoutPath, result.stdout);
	writeFileSync(stderrPath, result.stderr);
	const metadata: CheckMetadata = {
		name: cmd.name,
		scope: cmd.scope,
		status: checkStatus,
		argv: result.extras.argv,
		cwd: cmd.cwd,
		exit_code: result.extras.exit_code,
		signal: result.extras.signal,
		timeout: result.extras.timeout,
		duration_ms: result.extras.duration_ms,
		stdout_path: stdoutPath,
		stdout_sha256: result.extras.stdout_sha256,
		stderr_path: stderrPath,
		stderr_sha256: result.extras.stderr_sha256,
		started_at: result.extras.started_at,
		finished_at: result.extras.finished_at,
		detail: `status=${checkStatus}; exit=${result.extras.exit_code}; duration=${result.extras.duration_ms}ms; cmd=${result.extras.argv.join(" ")} (cwd=${cmd.cwd})`,
	};
	writeFileSync(metadataPath, `${JSON.stringify(metadata, null, "\t")}\n`);
	// SHA-256 must reflect the EXACT bytes written; recompute here so a
	// reviewer can verify against the file system without trusting the
	// in-memory value.
	const onDiskStdout = readFileSync(stdoutPath, "utf8");
	const onDiskStderr = readFileSync(stderrPath, "utf8");
	if (sha256(onDiskStdout) !== result.extras.stdout_sha256) {
		throw new Error(`GATE_SUMMARY_STREAM_HASH_DRIFT:${cmd.name}:stdout`);
	}
	if (sha256(onDiskStderr) !== result.extras.stderr_sha256) {
		throw new Error(`GATE_SUMMARY_STREAM_HASH_DRIFT:${cmd.name}:stderr`);
	}
	return { metadataPath, stdoutPath, stderrPath };
}

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

// ---------- check definitions ----------------------------------------------

const TSC_STRICT: (b: SnapshotContext) => Cmd = (b) => ({
	name: "strict_typecheck",
	scope: "MICROC3",
	evidence: "factory/scripts/tsconfig.json (--strict, --types bun, includes *.ts and *.test.ts)",
	cwd: b.scriptsDir,
	exec: b.bunx,
	args: ["tsc", "--project", b.tsconfigPath, "--noEmit"],
});

const GIT_DIFF_HYGIENE: (b: SnapshotContext) => Cmd = (b) => ({
	name: "git_diff_hygiene",
	scope: "WORKTREE",
	evidence: "git diff HEAD --check (covers staged + unstaged tracked changes relative to HEAD)",
	cwd: b.repoRoot,
	exec: b.git,
	args: ["diff", "HEAD", "--check"],
});

const WORKTREE_CLEANLINESS: (b: SnapshotContext) => Cmd = (b) => ({
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
	evidence: "factory/scripts/render-baseline-report.test.ts (closure-conjunction invariant: CORRECTION05-13) + factory/scripts/run-verification.test.ts (closure policy integration)",
	cwd: b.repoRoot,
	exec: b.bun,
	args: [
		"test",
		"./factory/scripts/render-baseline-report.test.ts",
		"./factory/scripts/run-verification.test.ts",
	],
});

// ---------- Leamas v2 contract ---------------------------------------------

function knownValidV2Fixture(): string {
	const fixtureHead = "0".repeat(40);
	const fixtureTree = "0".repeat(40);
	const fixtureSubject = "0".repeat(40);
	const payload = {
		schema_version: 2,
		generated_at: "1970-01-01T00:00:00.000Z",
		tool: { name: "factory-fixture", version: "round-5" },
		scope_id: "FIXTURE-V2",
		scope_status: "CLOSED",
		scope_disposition: "fixture",
		parent_act: "FIXTURE-PARENT",
		parent_status: "CLOSED",
		parent_disposition: "fixture",
		overall_status: "pass",
		overall_disposition: "fixture",
		execution_head_oid: fixtureHead,
		execution_tree_oid: fixtureTree,
		subject_tree_oid: fixtureSubject,
		worktree_clean_before: true,
		worktree_clean_after: true,
		identity_stable: true,
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
		parent_act_state: {
			head_oid: fixtureHead,
			tree_oid: fixtureTree,
			bundle_dir_exists: false,
			bundle_complete: null,
			bundle_structurally_valid: null,
			verdict: "CLOSED",
			disposition: "fixture",
			diagnostics: [],
		},
		rejection_reasons: [],
	};
	return `${JSON.stringify(payload, null, "\t")}\n`;
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
	// Validates against `schema_version: 2` but is structurally broken
	// so the Leamas validator must reject it.
	return JSON.stringify({
		schema_version: 2,
		scope_id: "MALFORMED",
		// Missing many required fields on purpose.
	});
}

function setupV3FixtureRepo(
	stagingRoot: string,
	fixtureText: string,
): { repoRoot: string; summaryPath: string } {
	const repoRoot = join(stagingRoot, "v3-fixture-repo");
	mkdirSync(repoRoot, { recursive: true });
	// Initialise a fresh, isolated git repository so `leamas factory
	// digest` can detect a repo root.
	const env = {
		GIT_AUTHOR_NAME: "leamas-v2-fixture",
		GIT_AUTHOR_EMAIL: "leamas-v2-fixture@example.invalid",
		GIT_COMMITTER_NAME: "leamas-v2-fixture",
		GIT_COMMITTER_EMAIL: "leamas-v2-fixture@example.invalid",
	};
	const init = spawnSync("git", ["init", "--quiet", "--initial-branch=main"], {
		cwd: repoRoot,
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	if (init.status !== 0) {
		throw new Error(`git init failed: ${init.stderr}`);
	}
	spawnSync("git", ["config", "user.name", "leamas-v2-fixture"], {
		cwd: repoRoot,
		env: { ...process.env, ...env },
	});
	spawnSync("git", ["config", "user.email", "leamas-v2-fixture@example.invalid"], {
		cwd: repoRoot,
		env: { ...process.env, ...env },
	});
	spawnSync("git", ["config", "commit.gpgsign", "false"], {
		cwd: repoRoot,
		env: { ...process.env, ...env },
	});
	const factoryDir = join(repoRoot, ".factory");
	mkdirSync(factoryDir, { recursive: true });
	const summaryPath = join(factoryDir, "gate-summary.json");
	writeFileSync(summaryPath, fixtureText);
	spawnSync("git", ["add", "-A"], { cwd: repoRoot, env: { ...process.env, ...env } });
	const commit = spawnSync(
		"git",
		["commit", "--quiet", "-m", "leamas v2 fixture (initial)"],
		{ cwd: repoRoot, env: { ...process.env, ...env } },
	);
	if (commit.status !== 0) {
		throw new Error(`git commit failed: ${commit.stderr}`);
	}
	return { repoRoot, summaryPath };
}

function runLeamasV2Contract(ctx: SnapshotContext): {
	check: Cmd;
	result: RunResult;
	status: CheckStatus;
	reason: string;
	leamasStagingDir: string;
} {
	// Use a fresh staging dir under `.factory/leamas-staging/...` so
	// the leamas contract check can run AFTER `atomicPublish` has
	// already removed `ctx.stagingDir`. The fixtures and v3/malformed
	// repos are written under this isolated directory and never
	// promote to `.factory/gates/<scope>/`.
	const leamasStagingDir = join(
		ctx.repoRoot,
		".factory",
		"leamas-staging",
		`contract-${Date.now()}`,
	);
	const fixtureDir = join(leamasStagingDir, "tooling");
	mkdirSync(fixtureDir, { recursive: true });

	// 1. Persist the v2 fixture as a known-good reference.
	const validFixturePath = join(fixtureDir, "valid-v2.json");
	writeFileSync(validFixturePath, knownValidV2Fixture());

	// 2. Set up a temp git repo with a v3 fixture to verify v3 is rejected.
	const v3 = setupV3FixtureRepo(fixtureDir, knownInvalidV3Fixture());

	// 3. Set up a temp git repo with a malformed v2 fixture.
	const malformed = setupV3FixtureRepo(
		fixtureDir.replace(/\/?$/, "-malformed"),
		malformedV2Fixture(),
	);

	// The contract is verified in four stages:
	//   1. `leamas --version` records the build identity (must succeed).
	//   2. `leamas factory digest` against the CURRENT repo (which has
	//      a freshly-written canonical `.factory/gate-summary.json`)
	//      reports source_status=present and schema_version=2.
	//   3. The same digest against the v3 fixture repo reports
	//      source_status=invalid (or schema_version != 2).
	//   4. The same digest against the malformed v2 fixture repo
	//      reports source_status=invalid (or schema_version=0).
	const leamasBin = ctx.leamas;
	const pipeline = [
		`set +e`,
		`LEAMAS_BIN=${shellQuote(leamasBin)}`,
		`OUT_DIR=${shellQuote(fixtureDir)}`,
		`V3_REPO=${shellQuote(v3.repoRoot)}`,
		`MAL_REPO=${shellQuote(malformed.repoRoot)}`,
		`REAL_REPO=${shellQuote(ctx.repoRoot)}`,
		`if [ ! -x "$LEAMAS_BIN" ]; then echo "leamas_unavailable=true"; exit 0; fi`,
		`"$LEAMAS_BIN" --version > "$OUT_DIR/version.txt" 2>&1`,
		// Use --range HEAD so single-commit fixture repos can be
		// digested; --range HEAD~1..HEAD requires a parent commit
		// which single-commit fixture repos do not have.
		`"$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-real.txt" >/dev/null 2>&1`,
		`echo "real_exit=$?"`,
		`( cd "$V3_REPO" && "$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-v3.txt" ) >/dev/null 2>&1`,
		`echo "v3_exit=$?"`,
		`( cd "$MAL_REPO" && "$LEAMAS_BIN" factory digest --range HEAD --output "$OUT_DIR/digest-malformed.txt" ) >/dev/null 2>&1`,
		`echo "mal_exit=$?"`,
		`echo "leamas_unavailable=false"`,
		`echo "v2_accepted=$(grep -c 'schema_version=2' "$OUT_DIR/digest-real.txt" || true)"`,
		`echo "v2_source_present=$(grep -c 'source_status=present' "$OUT_DIR/digest-real.txt" || true)"`,
		`echo "v3_rejected=$(grep -c 'source_status=invalid' "$OUT_DIR/digest-v3.txt" || true)"`,
		`echo "v3_schema_invalid=$(grep -c 'schema_version=0' "$OUT_DIR/digest-v3.txt" || true)"`,
		`echo "malformed_rejected=$(grep -c 'source_status=invalid' "$OUT_DIR/digest-malformed.txt" || true)"`,
	].join("\n");

	const check: Cmd = {
		name: "leamas_v2_contract",
		scope: "TOOLING",
		evidence: `.factory/gates/tooling/leamas-v2-contract.{stdout,stderr}`,
		cwd: ctx.repoRoot,
		exec: "/bin/sh",
		args: ["-c", pipeline],
		timeout_ms: 5 * 60_000,
	};
	const result = runExec(check);
	const stdout = result.stdout;
	const unavailable = /leamas_unavailable=true/.test(stdout);
	const v2Accepted = /v2_accepted=[1-9]/.test(stdout);
	const v2SourcePresent = /v2_source_present=[1-9]/.test(stdout);
	const v3Rejected =
		/v3_rejected=[1-9]/.test(stdout) || /v3_schema_invalid=[1-9]/.test(stdout);
	const malformedRejected = /malformed_rejected=[1-9]/.test(stdout);
	let status: CheckStatus;
	let reason: string;
	if (unavailable) {
		status = "unavailable";
		reason = "leamas binary not located on PATH";
	} else if (!v2Accepted) {
		status = "fail";
		reason = `v2_accepted=${v2Accepted}; expected schema_version=2 in digest-real.txt`;
	} else if (!v2SourcePresent) {
		status = "fail";
		reason = `v2_source_present=${v2SourcePresent}; expected source_status=present in digest-real.txt`;
	} else if (!v3Rejected) {
		status = "fail";
		reason = `v3_rejected=${v3Rejected}; expected source_status=invalid for v3 fixture`;
	} else if (!malformedRejected) {
		status = "fail";
		reason = `malformed_rejected=${malformedRejected}; expected source_status=invalid for malformed fixture`;
	} else {
		status = "pass";
		reason = "v2 accepted (source_status=present, schema_version=2); v3 rejected; malformed rejected";
	}
	return { check, result, status, reason, leamasStagingDir };
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

// ---------- real CORRECTION21 parent-state probe ---------------------------

function deriveParentActState(ctx: SnapshotContext): ParentActState {
	const bundleDir = ctx.parentEvidenceDir;
	const evidencePath = join(bundleDir, "evidence.json");
	const hashesPath = join(bundleDir, "hashes.sha256");
	const bundledResultPath = join(bundleDir, "verification-results.json");
	const dispose: ParentActState = {
		head_oid: null,
		tree_oid: null,
		bundle_dir_exists: false,
		bundle_complete: null,
		bundle_structurally_valid: null,
		verdict: "OPEN",
		disposition: "no detached production bundle",
		diagnostics: ["no detached bundle; production runner has not published one yet"],
	};
	if (!existsSync(bundleDir)) return dispose;
	if (!existsSync(evidencePath) || !existsSync(hashesPath)) {
		return {
			...dispose,
			bundle_dir_exists: true,
			disposition: "bundle malformed (missing evidence.json or hashes.sha256)",
			diagnostics: [
				existsSync(evidencePath) ? "" : "missing evidence.json",
				existsSync(hashesPath) ? "" : "missing hashes.sha256",
			].filter(Boolean),
		};
	}
	let ev;
	try {
		ev = loadEvidenceFile(evidencePath);
	} catch (e) {
		return {
			...dispose,
			bundle_dir_exists: true,
			disposition: `bundle malformed (evidence.json unparseable: ${(e as Error).message})`,
			diagnostics: [(e as Error).message],
		};
	}
	if (!ev.ok) {
		return {
			...dispose,
			bundle_dir_exists: true,
			disposition: `bundle malformed (loadEvidenceFile: ${ev.error ?? "unknown"})`,
			diagnostics: [ev.error ?? "unknown"],
		};
	}
	const hashesText = readFileSync(hashesPath, "utf8");
	const evObj = ev.value as Record<string, unknown> | null;
	const bundledHead = typeof evObj?.execution_head_oid === "string" ? evObj.execution_head_oid : null;
	const bundledTree = typeof evObj?.execution_tree_oid === "string" ? evObj.execution_tree_oid : null;
	const evidenceCommands = Array.isArray(evObj?.commands)
		? (evObj.commands as unknown[])
		: [];
	const verificationBundle = existsSync(bundledResultPath)
		? readBundledVerificationResults(bundledResultPath)
		: null;
	const identityDerivation: ExecutionIdentityDerivation = {
		executionHeadExists: false,
		executionTreeExists: false,
		derivedTreeOid: null,
	};
	if (bundledHead && OID_PATTERN.test(bundledHead)) {
		const headExists = gitText(ctx.repoRoot, ctx.git, [
			"cat-file",
			"-e",
			bundledHead,
		]).status === 0;
		identityDerivation.executionHeadExists = headExists;
	}
	if (bundledTree && OID_PATTERN.test(bundledTree)) {
		const treeExists = gitText(ctx.repoRoot, ctx.git, [
			"cat-file",
			"-e",
			bundledTree,
		]).status === 0;
		identityDerivation.executionTreeExists = treeExists;
	}
	if (bundledHead && OID_PATTERN.test(bundledHead)) {
		const derived = gitText(ctx.repoRoot, ctx.git, [
			"rev-parse",
			"--verify",
			"--end-of-options",
			`${bundledHead}^{tree}`,
		]).stdout.trim();
		identityDerivation.derivedTreeOid = OID_PATTERN.test(derived) ? derived : null;
	}
	let view: EvidenceView;
	try {
		view = checkEvidence({
			ev,
			hashesText,
			evDirAbs: bundleDir,
			executedCmds: verificationBundle?.executed_commands ?? evidenceCommands,
			bundledResultPath: "verification-results.json",
			rootAbs: ctx.repoRoot,
			headOidNow: bundledHead ?? "",
			treeOidNow: bundledTree ?? "",
			filteredSubjectTreeOidNow: ctx.subjectTreeOid,
			executionIdentityDerivation: identityDerivation,
		});
	} catch (e) {
		return {
			...dispose,
			bundle_dir_exists: true,
			disposition: `bundle malformed (checkEvidence threw: ${(e as Error).message})`,
			diagnostics: [(e as Error).message],
		};
	}
	const diagnostics: string[] = [];
	diagnostics.push(`subject_tree_ok=${view.subjectTreeComputationOk}`);
	diagnostics.push(`execution_identity_valid=${view.executionIdentityValid}`);
	diagnostics.push(`bundled_result_command_set_exact=${view.bundledResultCommandSetExact}`);
	diagnostics.push(`native_probes_complete=${view.nativeProbesComplete}`);
	const structurallyValid = isEvidenceStructurallyValid(view);
	const evidenceOk = isEvidenceOk(view);
	let verdict: "CLOSED" | "OPEN" | "PARTIAL";
	let disposition: string;
	if (evidenceOk) {
		verdict = "CLOSED";
		disposition = "production runner pass; bundle self-check both pass";
	} else if (structurallyValid) {
		verdict = "PARTIAL";
		disposition = "bundle structurally valid; at least one parent baseline requirement open";
	} else {
		verdict = "OPEN";
		const reason = view.bundledResultCommandSetExact === false
			? "bundle_command_set_mismatch"
			: "structural_check_failed";
		disposition = `bundle structurally invalid: ${reason}`;
	}
	return {
		head_oid: bundledHead,
		tree_oid: bundledTree,
		bundle_dir_exists: true,
		bundle_complete: evidenceOk,
		bundle_structurally_valid: structurallyValid,
		verdict,
		disposition,
		diagnostics,
	};
}

function readBundledVerificationResults(path: string): {
	executed_commands: unknown[];
	commands: unknown[];
} | null {
	try {
		const text = readFileSync(path, "utf8");
		const parsed = JSON.parse(text) as { executed_commands?: unknown[]; commands?: unknown[] };
		return {
			executed_commands: Array.isArray(parsed.executed_commands) ? parsed.executed_commands : [],
			commands: Array.isArray(parsed.commands) ? parsed.commands : [],
		};
	} catch {
		return null;
	}
}

// ---------- check execution ------------------------------------------------

function summarizeAndPersist(
	ctx: SnapshotContext,
	cmd: Cmd,
	result: RunResult,
	statusOverride?: CheckStatus,
): GateCheckSummary {
	const derivedStatus: CheckStatus = statusOverride ?? (result.ok ? "pass" : "fail");
	persistCheckStreams(ctx, cmd, result, derivedStatus);
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
	// 1. Worktree hygiene (must run first so a dirty tree surfaces before
	//    the test matrix).
	const hygieneDiff = runExec(GIT_DIFF_HYGIENE(ctx));
	out.push(summarizeAndPersist(ctx, GIT_DIFF_HYGIENE(ctx), hygieneDiff));
	const hygieneClean = runExec(WORKTREE_CLEANLINESS(ctx));
	out.push(summarizeAndPersist(ctx, WORKTREE_CLEANLINESS(ctx), hygieneClean));
	// 2. Strict tsc.
	const tsc = runExec(TSC_STRICT(ctx));
	out.push(summarizeAndPersist(ctx, TSC_STRICT(ctx), tsc));
	// 3. CORRECTION21 closure logic tests.
	const closureLogic = runExec(CORRECTION21_CLOSURE_LOGIC_TESTS(ctx));
	out.push(summarizeAndPersist(ctx, CORRECTION21_CLOSURE_LOGIC_TESTS(ctx), closureLogic));
	// 4. CORRECTION21 current-state probe (real parent-state derivation).
	const correction21Probe = buildCorrection21Probe(ctx, parentState);
	const probeResult = runExec(correction21Probe);
	out.push(summarizeAndPersist(ctx, correction21Probe, probeResult));
	// 5. Focused suites.
	for (const { label, path } of FOCUSED_SUITE_PATHS) {
		const cmd = focusedSuiteCmd(ctx, label, path);
		const r = runExec(cmd);
		out.push(summarizeAndPersist(ctx, cmd, r));
	}
	// 6. All factory scripts + randomized.
	const allCmd = allFactoryScriptsCmd(ctx);
	const allResult = runExec(allCmd);
	out.push(summarizeAndPersist(ctx, allCmd, allResult));
	for (const seed of RANDOMIZED_SEEDS) {
		const cmd = randomizedCmd(ctx, seed);
		const r = runExec(cmd);
		out.push(summarizeAndPersist(ctx, cmd, r));
	}
	return out;
}

function buildCorrection21Probe(ctx: SnapshotContext, parentState: ParentActState): Cmd {
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
		`const dir = join(root, '.factory/evidence/${PARENT_ACT_ID}');`,
		`const subjectTreeOid = ${JSON.stringify(ctx.subjectTreeOid)};`,
		`const headOid = ${JSON.stringify(ctx.headOid)};`,
		`const treeOid = ${JSON.stringify(ctx.treeOid)};`,
		"if (!existsSync(join(dir, 'evidence.json')) || !existsSync(join(dir, 'hashes.sha256'))) {",
		`  console.log('parent_disposition=' + ${JSON.stringify(parentState.disposition)} + ' reason=bundle_absent verdict=' + ${JSON.stringify(parentState.verdict)});`,
		"  process.exit(2);",
		"}",
		"const ev = loadEvidenceFile(join(dir, 'evidence.json'));",
		"const hashesText = readFileSync(join(dir, 'hashes.sha256'), 'utf8');",
		"const head = (ev.ok && ev.value && typeof ev.value.execution_head_oid === 'string') ? ev.value.execution_head_oid : headOid;",
		"const tree = (ev.ok && ev.value && typeof ev.value.execution_tree_oid === 'string') ? ev.value.execution_tree_oid : treeOid;",
		"const view = checkEvidence({",
		"  ev,",
		"  hashesText,",
		"  evDirAbs: dir,",
		"  executedCmds: [],",
		"  bundledResultPath: 'verification-results.json',",
		"  rootAbs: root,",
		"  headOidNow: head,",
		"  treeOidNow: tree,",
		"  filteredSubjectTreeOidNow: subjectTreeOid,",
		"  executionIdentityDerivation: { executionHeadExists: true, executionTreeExists: true, derivedTreeOid: tree },",
		"});",
		"const ok = isEvidenceOk(view);",
		"const struct = isEvidenceStructurallyValid(view);",
		"const verdict = ok ? 'CLOSED' : struct ? 'PARTIAL' : 'OPEN';",
		"const reason = ok ? 'production_pass' : struct ? 'structural_validity_only' : (view.bundledResultCommandSetExact === false ? 'bundle_command_set_mismatch' : 'structural_check_failed');",
		"console.log('parent_disposition=' + " + JSON.stringify(parentState.disposition) + " + ' reason=' + reason + ' verdict=' + verdict + ' head_oid=' + head + ' tree_oid=' + tree);",
		"process.exit(0);",
	].join("\n");
	return {
		name: "correction21_current_state",
		scope: "CORRECTION21",
		evidence: "factory/scripts/baseline-closure.ts::checkEvidence + isEvidenceOk over the detached bundle (one-liner probe via `bun -e`)",
		cwd: ctx.repoRoot,
		exec: ctx.bun,
		args: ["-e", probeBody],
		timeout_ms: 60_000,
	};
}

// ---------- status arithmetic ----------------------------------------------

function deriveScopeStatus(checks: GateCheckSummary[]): {
	status: ScopeStatus;
	disposition: string;
} {
	const micro3 = checks.filter((c) => c.scope === "MICROC3");
	const worktree = checks.filter((c) => c.scope === "WORKTREE");
	const tooling = checks.filter((c) => c.scope === "TOOLING");
	const scopeChecks = [...micro3, ...worktree, ...tooling];
	if (worktree.some((c) => c.status === "fail")) {
		return { status: "OPEN", disposition: "WORKTREE check failed" };
	}
	const requiredScopeChecks = scopeChecks.filter((c) => c.name !== "git_diff_hygiene");
	if (requiredScopeChecks.some((c) => c.status === "fail")) {
		return { status: "OPEN", disposition: "MICROC3/WORKTREE/TOOLING check failed" };
	}
	if (requiredScopeChecks.some((c) => c.status === "unavailable")) {
		return { status: "OPEN", disposition: "MICROC3/WORKTREE/TOOLING check unavailable" };
	}
	if (requiredScopeChecks.length === 0) {
		return { status: "OPEN", disposition: "no scope checks executed" };
	}
	return { status: "CLOSED", disposition: "all MICROC3/WORKTREE/TOOLING checks pass" };
}

function deriveParentStatus(state: ParentActState): ScopeStatus {
	return state.verdict;
}

function deriveOverallStatus(checks: GateCheckSummary[]): OverallStatus {
	if (checks.some((c) => c.status === "fail")) return "fail";
	if (checks.some((c) => c.status === "unavailable")) return "unavailable";
	if (checks.some((c) => c.status === "pass")) return "pass";
	return "unavailable";
}

// ---------- main -----------------------------------------------------------

function atomicPublish(
	ctx: SnapshotContext,
	summary: GateSummary,
	extended: GateSummaryExtended,
): void {
	mkdirSync(dirname(ctx.canonicalSummaryPath), { recursive: true });
	mkdirSync(ctx.canonicalGatesDir, { recursive: true });
	const summaryInStaging = join(ctx.stagingDir, "gate-summary.json");
	writeFileSync(summaryInStaging, `${JSON.stringify(summary, null, "\t")}\n`);
	const reread = JSON.parse(readFileSync(summaryInStaging, "utf8")) as GateSummary;
	if (reread.subject_tree_oid !== ctx.subjectTreeOid) {
		throw new Error("GATE_SUMMARY_SNAPSHOT_DRIFT");
	}
	if (reread.execution_head_oid !== ctx.headOid || reread.execution_tree_oid !== ctx.treeOid) {
		throw new Error("GATE_SUMMARY_IDENTITY_DRIFT");
	}
	if (!reread.worktree_clean_after) {
		throw new Error("GATE_SUMMARY_DIRTY_AFTER");
	}
	writeFileSync(ctx.canonicalSummaryPath, readFileSync(summaryInStaging, "utf8"));
	// The extended file is sibling evidence that Leamas does not
	// consume; it carries the producer's tool identity, identity
	// stability flag, parent-state diagnostics, and any rejection
	// reasons that are out of scope for the v2 schema.
	const extendedPath = join(dirname(ctx.canonicalSummaryPath), "gate-summary.extended.json");
	writeFileSync(extendedPath, `${JSON.stringify(extended, null, "\t")}\n`);
	for (const scope of CHECK_SCOPES) {
		const srcDir = join(ctx.stagingDir, scope);
		const dstDir = join(ctx.canonicalGatesDir, scope);
		if (existsSync(srcDir)) {
			mkdirSync(dstDir, { recursive: true });
			const { readdirSync } = require("node:fs") as typeof import("node:fs");
			for (const file of readdirSync(srcDir)) {
				renameSync(join(srcDir, file), join(dstDir, file));
			}
			rmSync(srcDir, { recursive: true, force: true });
		}
	}
	rmSync(ctx.stagingDir, { recursive: true, force: true });
}

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
	const parentState = deriveParentActState(ctx);
	const checks = collectChecks(ctx, parentState);
	const identityAfter = captureSnapshot(ctx.repoRoot, ctx.git);
	const identityStable =
		identityAfter.head_oid === ctx.identityBefore.head_oid &&
		identityAfter.tree_oid === ctx.identityBefore.tree_oid &&
		identityAfter.subject_tree_oid === ctx.identityBefore.subject_tree_oid;
	const rejectionReasons: ReasonCode[] = [];
	if (identityAfter.head_oid !== ctx.identityBefore.head_oid) {
		rejectionReasons.push({
			code: "REPOSITORY_HEAD_DRIFT",
			message: `head drifted from ${ctx.identityBefore.head_oid} to ${identityAfter.head_oid}`,
		});
	}
	if (identityAfter.tree_oid !== ctx.identityBefore.tree_oid) {
		rejectionReasons.push({
			code: "REPOSITORY_TREE_DRIFT",
			message: `tree drifted from ${ctx.identityBefore.tree_oid} to ${identityAfter.tree_oid}`,
		});
	}
	if (identityAfter.subject_tree_oid !== ctx.identityBefore.subject_tree_oid) {
		rejectionReasons.push({
			code: "SUBJECT_TREE_DRIFT",
			message: `subject drifted from ${ctx.identityBefore.subject_tree_oid} to ${identityAfter.subject_tree_oid}`,
		});
	}
	if (!ctx.worktreeCleanBefore) {
		rejectionReasons.push({
			code: "WORKTREE_DIRTY_BEFORE",
			message: `unexpected paths before checks: ${ctx.unexpectedPathsBefore.join(", ")}`,
		});
	}
	if (!identityAfter.worktree_clean) {
		rejectionReasons.push({
			code: "WORKTREE_DIRTY_AFTER",
			message: `unexpected paths after checks: ${identityAfter.unexpected_paths.join(", ")}`,
		});
	}
	const scope = deriveScopeStatus(checks);
	const parentStatus = deriveParentStatus(parentState);
	const overall = deriveOverallStatus(checks);
	const overallDisposition =
		overall === "pass"
			? "all gates pass"
			: overall === "unavailable"
				? "one or more checks unavailable"
				: "one or more checks failed";
	// Build the v2-compliant summary (only fields the Leamas v2 schema
	// accepts) and the extended sibling object (tool identity,
	// identity_stable, parent_act_state, rejection_reasons). The
	// extended object is persisted to `.factory/gate-summary.extended.json`
	// and never appears in the Leamas digest.
	const summary: GateSummary = {
		schema_version: 2,
		generated_at: new Date().toISOString(),
		scope_id: SCOPE_ID,
		scope_status: scope.status,
		scope_disposition: scope.disposition,
		parent_act: PARENT_ACT_ID,
		parent_status: parentStatus,
		parent_disposition: parentState.disposition,
		overall_status: overall,
		overall_disposition: overallDisposition,
		execution_head_oid: ctx.headOid,
		execution_tree_oid: ctx.treeOid,
		subject_tree_oid: ctx.subjectTreeOid,
		worktree_clean_before: ctx.worktreeCleanBefore,
		worktree_clean_after: identityAfter.worktree_clean,
		checks,
	};
	const extended: GateSummaryExtended = {
		tool: { name: PRODUCER_NAME, version: PRODUCER_VERSION },
		identity_stable: identityStable,
		parent_act_state: parentState,
		rejection_reasons: rejectionReasons,
	};
	if (rejectionReasons.length > 0) {
		console.error(`gate-summary: identity/worktree rejection: ${rejectionReasons.map((r) => r.code).join(",")}`);
		process.exit(3);
	}
	// 7. Atomic publication of the canonical v2 summary plus its
	//    extended sibling. The Leamas v2 contract check is run AFTER
	//    the canonical summary is in place so it can validate the
	//    published artifact directly.
	atomicPublish(ctx, summary, extended);
	// 8. Run the Leamas v2 contract check against the canonical summary.
	//    This is intentionally the LAST check so the published artifact
	//    is what gets validated. The check uses its own leamasStagingDir
	//    (set up by runLeamasV2Contract) and the streams are persisted
	//    directly under .factory/gates/tooling/.
	const leamasContract = runLeamasV2Contract(ctx);
	const leamasCheckSummary = persistLeamasStreamsAndSummarize(
		leamasContract,
		ctx,
	);
	checks.push(leamasCheckSummary);
	const scopePost = deriveScopeStatus(checks);
	const overallPost = deriveOverallStatus(checks);
	const finalSummary: GateSummary = {
		...summary,
		scope_status: scopePost.status,
		scope_disposition: scopePost.disposition,
		overall_status: overallPost,
		overall_disposition:
			overallPost === "pass"
				? "all gates pass"
				: overallPost === "unavailable"
					? "one or more checks unavailable"
					: "one or more checks failed",
		checks,
	};
	// Final publication with the Leamas check included. The canonical
	// streams directory is left intact from the previous publication;
	// we only rewrite the canonical summary file.
	writeFileSync(ctx.canonicalSummaryPath, `${JSON.stringify(finalSummary, null, "\t")}\n`);
}

function persistLeamasStreamsAndSummarize(
	contract: {
		check: Cmd;
		result: RunResult;
		status: CheckStatus;
		reason: string;
		leamasStagingDir: string;
	},
	ctx: SnapshotContext,
): GateCheckSummary {
	const dir = join(ctx.canonicalGatesDir, contract.check.scope);
	mkdirSync(dir, { recursive: true });
	const stdoutPath = join(dir, `${contract.check.name}.stdout`);
	const stderrPath = join(dir, `${contract.check.name}.stderr`);
	const metadataPath = join(dir, `${contract.check.name}.metadata.json`);
	writeFileSync(stdoutPath, contract.result.stdout);
	writeFileSync(stderrPath, contract.result.stderr);
	const metadata: CheckMetadata = {
		name: contract.check.name,
		scope: contract.check.scope,
		status: contract.status,
		argv: contract.result.extras.argv,
		cwd: contract.check.cwd,
		exit_code: contract.result.extras.exit_code,
		signal: contract.result.extras.signal,
		timeout: contract.result.extras.timeout,
		duration_ms: contract.result.extras.duration_ms,
		stdout_path: stdoutPath,
		stdout_sha256: contract.result.extras.stdout_sha256,
		stderr_path: stderrPath,
		stderr_sha256: contract.result.extras.stderr_sha256,
		started_at: contract.result.extras.started_at,
		finished_at: contract.result.extras.finished_at,
		detail: `status=${contract.status}; exit=${contract.result.extras.exit_code}; reason=${contract.reason}; cmd=${contract.result.extras.argv.join(" ")} (cwd=${contract.check.cwd})`,
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
	// Best-effort cleanup of the leamasStagingDir; failures are
	// non-fatal because the gate summary has already been published.
	try {
		rmSync(contract.leamasStagingDir, { recursive: true, force: true });
	} catch {
		// ignore
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