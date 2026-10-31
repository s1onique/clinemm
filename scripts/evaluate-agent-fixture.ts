#!/usr/bin/env bun
/**
 * ACT-CLINEMM-INDEPENDENT-ACCEPTANCE-EVALUATOR01 — external acceptance evaluator.
 *
 * WHAT THIS TOOL IS
 * -----------------
 * A harness-independent, offline authority that answers exactly one question:
 *
 *   "Given a frozen coding fixture and the final workspace produced by an
 *    agent, did the agent actually complete the required repair without
 *    violating the fixture's constraints?"
 *
 * The verdict is derived ONLY from independently observed facts:
 *
 *   1. the frozen fixture identity (commit + tree), from the operator-owned
 *      fixture repository — never from the candidate's `.git` pointer;
 *   2. an independently reconstructed candidate workspace;
 *   3. protected-file and allowed-scope conservation;
 *   4. execution of the trusted tests in that workspace;
 *   5. the actual subprocess exit status;
 *   6. structured test outcomes (JUnit XML) when the runner supports them;
 *   7. deterministic digests bound to the evaluated source.
 *
 * WHAT THIS TOOL IS NOT
 * ---------------------
 * It is NOT an acceptance authority for the agent's own claims. The agent's
 * final message, its trace, its claimed test results and its own test commands
 * are NOT inputs to the verdict. A model-behavior trace may be supplied for
 * OPTIONAL correlation only; the acceptance verdict is identical with and
 * without it.
 *
 * It does NOT instrument, patch, or observe either harness. It runs outside
 * the agent session.
 *
 * It contains NO harness-name or provider-name branches. The candidate is a
 * filesystem path; the fixture is a manifest; the runner is an argv.
 *
 * USAGE
 * -----
 *   bun scripts/evaluate-agent-fixture.ts \
 *     --manifest <agent-fixture/0.1 manifest.json> \
 *     --candidate <candidate workspace path> \
 *     --out-dir <output directory> \
 *     [--experiment-id <id>] [--trial-id <id>] \
 *     [--harness <label>] [--trace <optional trace path>]
 *
 * Exit code 0 when the verdict is `PASS`, 1 for `FAIL`, 2 for every
 * non-committal verdict (`INCOMPLETE`, `NOT_EXECUTED`,
 * `CAPTURE_INSUFFICIENT`).
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Contract constants
// ============================================================================

/** The frozen-fixture manifest contract version. */
export const FIXTURE_SCHEMA_VERSION = "agent-fixture/0.1";

/** The portable acceptance-artifact contract version. */
export const ACCEPTANCE_SCHEMA_VERSION = "agent-acceptance/0.1";

/** The portable trace contract the evaluator's acceptance stream speaks. */
export const PORTABLE_TRACE_CONTRACT_VERSION = "agent-trace/0.1";

/** The evaluator's own semantic version. */
export const EVALUATOR_VERSION = "1.0.0";

/**
 * The acceptance verdicts.
 *
 * A failed candidate and an unmeasurable candidate are DIFFERENT outcomes.
 * An execution failure must never be promoted to a candidate correctness
 * failure.
 */
export type AcceptanceVerdict =
	| "PASS"
	| "FAIL"
	| "INCOMPLETE"
	| "NOT_EXECUTED"
	| "CAPTURE_INSUFFICIENT";

/** Machine-readable reason codes attached to every non-PASS verdict. */
export type AcceptanceReasonCode =
	| "TEST_FAILURE"
	| "PROTECTED_FILE_CHANGED"
	| "OUT_OF_SCOPE_CHANGE"
	| "BASELINE_MISMATCH"
	| "TEST_REPORT_MISSING"
	| "TEST_REPORT_INVALID"
	| "PROCESS_TIMEOUT"
	| "PROCESS_SPAWN_FAILED"
	| "CANDIDATE_SNAPSHOT_FAILED"
	| "FIXTURE_IDENTITY_MISMATCH"
	| "UNSAFE_EXECUTION_ENVIRONMENT"
	| "CANDIDATE_ROOT_INVALID"
	| "SYMLINK_ESCAPE"
	| "PATH_TRAVERSAL"
	| "TEST_COUNT_MISMATCH"
	| "REGRESSION"
	| "EVALUATOR_INTERNAL_ERROR"
	| "MANIFEST_INVALID";

/**
 * The per-field provenance vocabulary.
 *
 * Every exported field declares where it came from. An operator-supplied
 * prompt digest is NOT promoted to proof that a harness received that prompt.
 */
export type EvidenceProvenance =
	| "OBSERVED_BY_EVALUATOR"
	| "OPERATOR_SUPPLIED"
	| "DERIVED_FROM_VERIFIED_INPUT"
	| "UNAVAILABLE";

/** A provenance-tagged value. */
export interface Provenanced<T> {
	value: T;
	provenance: EvidenceProvenance;
}

// ============================================================================
// Fixture manifest
// ============================================================================

/**
 * The `agent-fixture/0.1` manifest.
 *
 * The manifest and the trusted tests are owned by the evaluator/operator. The
 * candidate can define NEITHER the tests, the allowed paths, the acceptance
 * threshold, the baseline identity, the trusted command, nor the evaluator's
 * configuration.
 */
export interface AgentFixtureManifest {
	schemaVersion: typeof FIXTURE_SCHEMA_VERSION;
	fixtureId: string;
	source: {
		kind: "git";
		/** Path to the operator-owned fixture git repository. */
		repository: string;
		/** The exact frozen commit. */
		commit: string;
		/** The exact frozen tree. */
		tree: string;
	};
	prompt: {
		/** SHA-256 of the exact prompt text. */
		sha256: string;
	};
	/** Glob patterns of paths the candidate may change. */
	allowedChanges: string[];
	/** Glob patterns of paths the candidate must not change. */
	protectedPaths: string[];
	test: {
		/** Explicit argument vector. NEVER a shell string. */
		argv: string[];
		/** Working directory, relative to the evaluation workspace root. */
		cwd: string;
		timeoutMs: number;
		/**
		 * How the runner emits a machine-readable report.
		 *
		 * `junit` means the evaluator appends `--reporter=junit
		 * --reporter-outfile=<path>` to the frozen argv. The evaluator
		 * validates the report's structural usability and binds it to the
		 * just-executed process.
		 */
		report?: {
			kind: "junit";
			/** Whether a structurally valid report is REQUIRED for a PASS. */
			required: boolean;
		};
	};
	acceptance: {
		/** The exact number of test cases the trusted suite contains. */
		expectedTestCount: number;
		/** How many of them must pass for acceptance. */
		requiredPassingTests: number;
		/**
		 * The baseline the evaluator must reproduce before it evaluates a
		 * candidate. The evaluator HALTs when the baseline does not reproduce.
		 */
		expectedBaseline?: {
			passingTests: number;
			failingTests: number;
			skippedTests?: number;
			exitCode: number;
		};
	};
	/**
	 * Environment variables permitted to reach the candidate test process.
	 *
	 * The evaluator starts from an EMPTY environment plus this allowlist, so
	 * provider credentials and unrelated secrets cannot leak in.
	 */
	environment?: {
		allow?: string[];
		deny?: string[];
	};
}

// ============================================================================
// Snapshot / inventory types
// ============================================================================

/** How a candidate file differs from the frozen fixture. */
export type ChangeKind =
	| "added"
	| "modified"
	| "deleted"
	| "renamed"
	| "typeChanged";

/** One retained final-workspace difference. */
export interface CandidateChange {
	path: string;
	kind: ChangeKind;
	/** The candidate file's type, when it still exists. */
	type?: "file" | "symlink" | "directory";
	/** The previous path, for a determinable rename. */
	from?: string;
	/** SHA-256 of the candidate file, when it is a regular file. */
	sha256?: string;
}

/** The complete candidate workspace inventory. */
export interface CandidateInventory {
	/** Every retained difference against the frozen fixture. */
	changes: CandidateChange[];
	/** Files whose path matched a protected pattern. */
	protectedViolations: string[];
	/** Files whose path matched no allowed pattern. */
	scopeViolations: string[];
	/** Files that will actually be evaluated (the reconstructed workspace). */
	evaluatedFiles: string[];
	/** Symlinks or paths that escape the candidate root. */
	escapeViolations: string[];
	/** A deterministic digest over the retained delta. */
	deltaSha256: string;
}

// ============================================================================
// Process outcome types
// ============================================================================

/** How a process ended. */
export type ProcessEndKind =
	| "exited"
	| "signalled"
	| "timeout"
	| "spawnFailed"
	| "cancelled";

/** The observed outcome of the trusted test process. */
export interface ProcessOutcome {
	endKind: ProcessEndKind;
	exitCode: number | null;
	signal: string | null;
	/** Wall-clock duration in milliseconds. */
	durationMs: number;
	/** Whether stdout/stderr hit the capture bound. */
	outputTruncated: boolean;
	/** Bytes of stdout captured. */
	stdoutBytes: number;
	/** Bytes of stderr captured. */
	stderrBytes: number;
}

/** The structured test results parsed from the runner's report. */
export interface StructuredTestResults {
	/** Whether a report file was produced at all. */
	reportPresent: boolean;
	/** Whether the report parsed into a structurally usable shape. */
	structurallyValid: boolean;
	total: number | null;
	passed: number | null;
	failed: number | null;
	skipped: number | null;
	/** The identities of every test case, sorted. */
	testIdentities: string[];
	/** The identities of every failing test case, sorted. */
	failingIdentities: string[];
	/**
	 * The digest of the report's SEMANTIC content.
	 *
	 * The raw report bytes embed wall-clock timing attributes, so their
	 * digest is not reproducible across runs. This digest covers only the
	 * reproducible facts: the counts and the test identities.
	 */
	reportSha256: string | null;
	/** A short, non-content reason the report was missing or invalid. */
	problem: string | null;
}

// ============================================================================
// Small utilities
// ============================================================================

/** SHA-256 of a byte buffer, lowercase hex. */
export function sha256Bytes(bytes: Buffer | Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 of a file's bytes, lowercase hex. */
export function sha256File(path: string): string {
	return sha256Bytes(readFileSync(path));
}

/**
 * Canonical JSON serialization with sorted object keys.
 *
 * Deterministic evidence fields must not depend on property insertion order.
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value ?? null);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** SHA-256 over the canonical JSON of a value. */
export function canonicalDigest(value: unknown): string {
	return sha256Bytes(canonicalJson(value));
}

/** POSIX-style relative path with forward slashes. */
export function toPosixRelative(root: string, target: string): string {
	return relative(root, target).split(sep).join("/");
}

/**
 * Match a repository-relative POSIX path against a glob pattern.
 *
 * Supports `*` (no separator), `**` (any depth), `?` (one non-separator
 * character), and a trailing `/**` which also matches the directory itself.
 * Deliberately small and dependency-free: the evaluator's scope rules are
 * operator-owned data, not a general glob dialect.
 */
export function matchesGlob(pattern: string, filePath: string): boolean {
	const normalized = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
	if (normalized === "" || normalized === "**" || normalized === "**/*") {
		return true;
	}
	const regexSource = normalized
		.split("/")
		.map((segment) => {
			if (segment === "**") {
				return "@@DOUBLE@@";
			}
			let out = "";
			for (const ch of segment) {
				if (ch === "*") {
					out += "[^/]*";
				} else if (ch === "?") {
					out += "[^/]";
				} else {
					out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
				}
			}
			return out;
		})
		.join("/")
		.replace(/@@DOUBLE@@\//g, "(?:.*/)?")
		.replace(/@@DOUBLE@@/g, ".*");
	const regex = new RegExp(`^${regexSource}$`);
	if (regex.test(filePath)) {
		return true;
	}
	// A `dir/**` pattern also covers the directory entry itself.
	if (normalized.endsWith("/**") && filePath === normalized.slice(0, -3)) {
		return true;
	}
	return false;
}

/** Whether the path matches ANY of the patterns. */
export function matchesAny(
	patterns: readonly string[],
	filePath: string,
): boolean {
	return patterns.some((pattern) => matchesGlob(pattern, filePath));
}

// ============================================================================
// Workspace inventory
// ============================================================================

/** One entry in a workspace's file inventory. */
export interface WorkspaceEntry {
	/** Repository-relative POSIX path. */
	path: string;
	/** The entry's type. */
	type: "file" | "symlink" | "directory";
	/** SHA-256 of the content, for regular files only. */
	sha256?: string;
	/** The symlink target, for symlinks only. */
	linkTarget?: string;
}

/** The result of walking a directory tree. */
export interface WorkspaceWalk {
	/** Every regular file and symlink, sorted by path. */
	entries: WorkspaceEntry[];
	/** Paths whose real location escapes the walked root. */
	escapes: string[];
}

/**
 * Walk a directory tree and build a deterministic inventory.
 *
 * Symlinks are NEVER followed. A symlink whose target resolves outside the
 * root is reported as an escape rather than silently inventoried.
 *
 * Version-control ADMINISTRATIVE directories are excluded: `.git` is a
 * pointer, not workspace content, and the evaluator never treats it as proof
 * of fixture identity. Their exclusion is identical for the fixture and the
 * candidate, so it cannot hide a candidate-side change.
 *
 * Modification timestamps are never used as proof of equality: content is
 * compared by SHA-256.
 */
export function walkWorkspace(root: string): WorkspaceWalk {
	const entries: WorkspaceEntry[] = [];
	const escapes: string[] = [];
	const rootReal = safeRealpath(root);
	const visit = (dir: string, relativePrefix: string): void => {
		let names: string[];
		try {
			names = readdirSync(dir).sort();
		} catch {
			return;
		}
		for (const name of names) {
			if (name === ".git") {
				continue;
			}
			const absolute = join(dir, name);
			const relativePath = relativePrefix ? `${relativePrefix}/${name}` : name;
			let stats: ReturnType<typeof lstatSync>;
			try {
				stats = lstatSync(absolute);
			} catch {
				continue;
			}
			if (stats.isSymbolicLink()) {
				const target = readlinkSync(absolute);
				const resolvedTarget = isAbsolute(target)
					? target
					: resolve(dir, target);
				if (!isInside(rootReal, safeRealpath(resolvedTarget))) {
					escapes.push(relativePath);
				}
				entries.push({
					path: relativePath,
					type: "symlink",
					linkTarget: target,
				});
				continue;
			}
			if (stats.isDirectory()) {
				entries.push({ path: relativePath, type: "directory" });
				visit(absolute, relativePath);
				continue;
			}
			if (stats.isFile()) {
				entries.push({
					path: relativePath,
					type: "file",
					sha256: sha256File(absolute),
				});
			}
		}
	};
	visit(root, "");
	entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	escapes.sort();
	return { entries, escapes };
}

/** `realpathSync` that returns the input unchanged when it cannot be resolved. */
function safeRealpath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

/** Whether `target` is `root` itself or lies beneath it. */
function isInside(root: string, target: string): boolean {
	if (target === root) {
		return true;
	}
	return target.startsWith(root.endsWith(sep) ? root : root + sep);
}

// ============================================================================
// Candidate inventory (the complete workspace delta)
// ============================================================================

/**
 * Compute the complete retained workspace delta between the frozen fixture and
 * the candidate.
 *
 * This covers added, modified, deleted, renamed, type-changed and untracked
 * files, plus symlinks. `git diff HEAD` alone is NOT a complete workspace
 * inventory and is never used.
 */
export function inventoryCandidate(
	fixtureRoot: string,
	candidateRoot: string,
	manifest: Pick<AgentFixtureManifest, "allowedChanges" | "protectedPaths">,
): CandidateInventory {
	const fixture = walkWorkspace(fixtureRoot);
	const candidate = walkWorkspace(candidateRoot);

	const fixtureFiles = new Map(
		fixture.entries.filter((e) => e.type === "file").map((e) => [e.path, e]),
	);
	const fixtureSymlinks = new Map(
		fixture.entries.filter((e) => e.type === "symlink").map((e) => [e.path, e]),
	);
	const candidateFiles = new Map(
		candidate.entries.filter((e) => e.type === "file").map((e) => [e.path, e]),
	);
	const candidateSymlinks = new Map(
		candidate.entries
			.filter((e) => e.type === "symlink")
			.map((e) => [e.path, e]),
	);

	const changes: CandidateChange[] = [];
	const protectedViolations: string[] = [];
	const scopeViolations: string[] = [];
	const escapeViolations = [...fixture.escapes, ...candidate.escapes];

	const record = (
		path: string,
		kind: ChangeKind,
		extra?: Partial<CandidateChange>,
	): void => {
		changes.push({ path, kind, ...extra });
		if (matchesAny(manifest.protectedPaths, path)) {
			protectedViolations.push(path);
		}
		if (!matchesAny(manifest.allowedChanges, path)) {
			scopeViolations.push(path);
		}
	};

	for (const [path, entry] of candidateFiles) {
		const before = fixtureFiles.get(path);
		if (before === undefined) {
			if (fixtureSymlinks.has(path)) {
				record(path, "typeChanged", { type: "file", sha256: entry.sha256 });
			} else {
				record(path, "added", { type: "file", sha256: entry.sha256 });
			}
			continue;
		}
		if (before.sha256 !== entry.sha256) {
			record(path, "modified", { type: "file", sha256: entry.sha256 });
		}
	}
	for (const [path, entry] of candidateSymlinks) {
		if (!fixtureFiles.has(path) && !fixtureSymlinks.has(path)) {
			record(path, "added", { type: "symlink" });
			continue;
		}
		if (fixtureFiles.has(path)) {
			record(path, "typeChanged", { type: "symlink" });
			continue;
		}
		const before = fixtureSymlinks.get(path);
		if (before?.linkTarget !== entry.linkTarget) {
			record(path, "modified", { type: "symlink" });
		}
	}
	for (const path of fixtureFiles.keys()) {
		if (!candidateFiles.has(path) && !candidateSymlinks.has(path)) {
			record(path, "deleted", { type: "file" });
		}
	}
	for (const path of fixtureSymlinks.keys()) {
		if (!candidateFiles.has(path) && !candidateSymlinks.has(path)) {
			record(path, "deleted", { type: "symlink" });
		}
	}

	// A rename is determinable when exactly one added file and exactly one
	// deleted file share identical content.
	const addedFiles = changes.filter(
		(c) => c.kind === "added" && c.type === "file",
	);
	const deletedFiles = changes.filter(
		(c) => c.kind === "deleted" && c.type === "file",
	);
	for (const added of addedFiles) {
		const match = deletedFiles.find(
			(deleted) =>
				deleted.kind === "deleted" &&
				fixtureFiles.get(deleted.path)?.sha256 === added.sha256,
		);
		if (match) {
			added.kind = "renamed";
			added.from = match.path;
			match.kind = "renamed";
			match.from = added.path;
		}
	}

	changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	protectedViolations.sort();
	scopeViolations.sort();
	escapeViolations.sort();

	const deltaSha256 = canonicalDigest(
		changes.map((change) => ({
			path: change.path,
			kind: change.kind,
			type: change.type ?? null,
			from: change.from ?? null,
			sha256: change.sha256 ?? null,
		})),
	);

	return {
		changes,
		protectedViolations,
		scopeViolations,
		evaluatedFiles: candidate.entries
			.filter((e) => e.type === "file")
			.map((e) => e.path),
		escapeViolations,
		deltaSha256,
	};
}

// ============================================================================
// Git-backed fixture materialization
// ============================================================================

/** The identity of the frozen fixture, as observed by the evaluator. */
export interface FixtureIdentity {
	commit: string;
	tree: string;
	/** The commit's tree digest, observed independently. */
	observedCommit: string;
	observedTree: string;
}

/** Read a git repository's HEAD commit and tree. */
function gitIdentity(repository: string): { commit: string; tree: string } {
	const result = spawnSyncGit(repository, ["rev-parse", "HEAD"]);
	if (result.status !== 0) {
		throw new Error(`git rev-parse HEAD failed in ${repository}`);
	}
	const commit = result.stdout.trim();
	const treeResult = spawnSyncGit(repository, ["rev-parse", "HEAD^{tree}"]);
	if (treeResult.status !== 0) {
		throw new Error(`git rev-parse HEAD^{tree} failed in ${repository}`);
	}
	return { commit, tree: treeResult.stdout.trim() };
}

/** Run a git command synchronously inside a repository. */
function spawnSyncGit(
	cwd: string,
	args: string[],
): { status: number; stdout: string; stderr: string } {
	const result = spawnSyncProcess("git", args, { cwd });
	return {
		status: result.status ?? 1,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

/**
 * Materialize the frozen fixture into an evaluator-controlled directory.
 *
 * The fixture content comes from the operator-owned git repository at the
 * exact frozen commit — NEVER from the candidate's `.git` pointer, branch
 * name, or working tree.
 */
export function materializeFixture(
	manifest: AgentFixtureManifest,
	destination: string,
): FixtureIdentity {
	const repository = resolve(manifest.source.repository);
	const identity = gitIdentity(repository);
	if (identity.commit !== manifest.source.commit) {
		throw new Error(
			`fixture HEAD is ${identity.commit}, manifest declares ${manifest.source.commit}`,
		);
	}
	if (identity.tree !== manifest.source.tree) {
		throw new Error(
			`fixture tree is ${identity.tree}, manifest declares ${manifest.source.tree}`,
		);
	}
	rmSync(destination, { recursive: true, force: true });
	mkdirSync(destination, { recursive: true });
	const checkout = spawnSyncGit(repository, [
		"--work-tree",
		destination,
		"checkout",
		manifest.source.commit,
		"--",
		".",
	]);
	if (checkout.status !== 0) {
		throw new Error(
			`git checkout of ${manifest.source.commit} failed: ${checkout.stderr}`,
		);
	}
	// The `.git` administrative directory must never reach the evaluated
	// workspace: the evaluator's evidence must not depend on a VCS pointer.
	rmSync(join(destination, ".git"), { recursive: true, force: true });
	return {
		commit: manifest.source.commit,
		tree: manifest.source.tree,
		observedCommit: identity.commit,
		observedTree: identity.tree,
	};
}

/**
 * Build the independent evaluation workspace: the frozen fixture with ONLY
 * the validated candidate-source changes applied.
 *
 * The trusted tests, configuration and acceptance criteria always come from
 * the frozen fixture, never from the candidate's modified copies.
 */
export function buildEvaluationWorkspace(
	fixtureRoot: string,
	candidateRoot: string,
	inventory: CandidateInventory,
	destination: string,
): void {
	rmSync(destination, { recursive: true, force: true });
	mkdirSync(destination, { recursive: true });
	copyTree(fixtureRoot, destination);
	for (const change of inventory.changes) {
		const target = join(destination, change.path);
		if (change.kind === "deleted") {
			rmSync(target, { recursive: true, force: true });
			continue;
		}
		const source = join(candidateRoot, change.path);
		if (change.kind === "renamed" && change.from) {
			rmSync(join(destination, change.from), { recursive: true, force: true });
		}
		rmSync(target, { recursive: true, force: true });
		mkdirSync(dirname(target), { recursive: true });
		const stats = lstatSync(source);
		if (stats.isSymbolicLink()) {
			symlinkSync(readlinkSync(source), target);
		} else if (stats.isDirectory()) {
			copyTree(source, target);
		} else {
			copyFileSync(source, target);
		}
	}
}

/** Recursively copy a directory tree, preserving symlinks as symlinks. */
function copyTree(source: string, destination: string): void {
	mkdirSync(destination, { recursive: true });
	for (const name of readdirSync(source).sort()) {
		const from = join(source, name);
		const to = join(destination, name);
		const stats = lstatSync(from);
		if (stats.isSymbolicLink()) {
			symlinkSync(readlinkSync(from), to);
		} else if (stats.isDirectory()) {
			copyTree(from, to);
		} else if (stats.isFile()) {
			copyFileSync(from, to);
		}
	}
}

// ============================================================================
// Process execution
// ============================================================================

/** Options for one bounded subprocess execution. */
export interface RunOptions {
	/** The explicit argument vector. NEVER a shell string. */
	argv: string[];
	/** The working directory. */
	cwd: string;
	/** The wall-clock budget in milliseconds. */
	timeoutMs: number;
	/** The environment. Starts from an EMPTY environment by default. */
	env: Record<string, string>;
	/** The maximum number of bytes retained per stream. */
	maxOutputBytes?: number;
	/** An optional cancellation signal. */
	signal?: AbortSignal;
}

/** The raw result of one bounded subprocess execution. */
export interface RunResult {
	outcome: ProcessOutcome;
	stdout: string;
	stderr: string;
}

/**
 * Run a subprocess with a bounded lifetime and bounded output retention.
 *
 * The exit status is OBSERVED, never inferred. A timeout, a spawn failure and
 * a cancellation are all distinct outcomes and are never conflated with a
 * non-zero exit code.
 */
export function runBounded(options: RunOptions): Promise<RunResult> {
	const maxOutputBytes = options.maxOutputBytes ?? 1_000_000;
	const [command, ...args] = options.argv;
	if (command === undefined) {
		return Promise.resolve({
			outcome: {
				endKind: "spawnFailed",
				exitCode: null,
				signal: null,
				durationMs: 0,
				outputTruncated: false,
				stdoutBytes: 0,
				stderrBytes: 0,
			},
			stdout: "",
			stderr: "",
		});
	}
	return new Promise<RunResult>((resolvePromise) => {
		const startedAt = Date.now();
		let stdout = "";
		let stderr = "";
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let truncated = false;
		let settled = false;

		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
		});

		const finish = (
			outcome: Omit<
				ProcessOutcome,
				"durationMs" | "outputTruncated" | "stdoutBytes" | "stderrBytes"
			>,
		): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			resolvePromise({
				outcome: {
					...outcome,
					durationMs: Date.now() - startedAt,
					outputTruncated: truncated,
					stdoutBytes,
					stderrBytes,
				},
				stdout,
				stderr,
			});
		};

		const timer = setTimeout(() => {
			// The outcome is classified BEFORE the termination attempt: a host
			// that refuses to signal the child (e.g. `EPERM` on a sandboxed
			// process) surfaces that refusal as an `error` event, and it must
			// not reclassify a timeout as a spawn failure.
			finish({ endKind: "timeout", exitCode: null, signal: "SIGKILL" });
			terminate(child);
		}, options.timeoutMs);

		const onAbort = (): void => {
			finish({ endKind: "cancelled", exitCode: null, signal: "SIGKILL" });
			terminate(child);
		};
		if (options.signal) {
			if (options.signal.aborted) {
				onAbort();
				return;
			}
			options.signal.addEventListener("abort", onAbort, { once: true });
		}

		child.stdout?.on("data", (chunk: Buffer) => {
			stdoutBytes += chunk.length;
			if (stdout.length < maxOutputBytes) {
				stdout += chunk.toString("utf8");
			} else {
				truncated = true;
			}
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderrBytes += chunk.length;
			if (stderr.length < maxOutputBytes) {
				stderr += chunk.toString("utf8");
			} else {
				truncated = true;
			}
		});

		child.on("error", (error: Error) => {
			// A post-settlement `error` (e.g. an `EPERM` kill refusal arriving
			// after a timeout was already classified) must NOT reclassify the
			// outcome. The `finish` guard enforces that.
			finish({
				endKind: "spawnFailed",
				exitCode: null,
				signal: null,
			});
			void error;
		});
		child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
			if (signal) {
				finish({ endKind: "signalled", exitCode: null, signal });
				return;
			}
			finish({ endKind: "exited", exitCode: code, signal: null });
		});
	});
}

/**
 * Terminate a child process.
 *
 * The kill is best-effort: a process that is already gone, or that the host
 * refuses to signal (e.g. `EPERM`), must NOT change the observed outcome.
 * The caller's own classification (timeout / cancellation) is authoritative.
 */
function terminate(child: ReturnType<typeof spawn>): void {
	try {
		child.kill("SIGKILL");
	} catch {
		// The process may already be gone, or the host may refuse to signal it.
	}
}

/** A minimal synchronous process runner, used for git plumbing only. */
export function spawnSyncProcess(
	command: string,
	args: string[],
	options: { cwd: string },
): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: "utf8",
		maxBuffer: 10_000_000,
	});
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

// ============================================================================
// Structured test report (JUnit XML)
// ============================================================================

/** Decode the XML entities Bun's JUnit reporter emits. */
function decodeXmlEntities(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		)
		.replace(/&amp;/g, "&");
}

/**
 * Parse a JUnit XML report into structured test results.
 *
 * The parser is deliberately strict: a report that cannot be structurally
 * interpreted yields `structurallyValid: false` rather than fabricated
 * counts. Output-phrase matching (e.g. "18 pass") is NEVER used as
 * authoritative evidence.
 */
export function parseJunitReport(raw: string): StructuredTestResults {
	const empty: StructuredTestResults = {
		reportPresent: false,
		structurallyValid: false,
		total: null,
		passed: null,
		failed: null,
		skipped: null,
		testIdentities: [],
		failingIdentities: [],
		reportSha256: null,
		problem: null,
	};
	if (raw.trim().length === 0) {
		return { ...empty, problem: "report file is empty" };
	}
	const suitesMatch = raw.match(/<testsuites\b([^>]*)>/);
	if (!suitesMatch) {
		return {
			...empty,
			reportPresent: true,
			problem: "no <testsuites> root element",
		};
	}
	const suiteAttributes = parseXmlAttributes(suitesMatch[1]);
	const total = readIntegerAttribute(suiteAttributes, "tests");
	const failed = readIntegerAttribute(suiteAttributes, "failures");
	const skipped = readIntegerAttribute(suiteAttributes, "skipped");
	if (total === null || failed === null) {
		return {
			...empty,
			reportPresent: true,
			problem: "root <testsuites> is missing the tests/failures counts",
		};
	}

	const testIdentities: string[] = [];
	const failingIdentities: string[] = [];
	const testCasePattern = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
	let match = testCasePattern.exec(raw);
	while (match !== null) {
		const attributes = parseXmlAttributes(match[1]);
		const name = attributes.name ?? "";
		const file = attributes.file ?? "";
		const identity = file ? `${file}::${name}` : name;
		testIdentities.push(identity);
		const body = match[3] ?? "";
		if (/<failure\b/.test(body)) {
			failingIdentities.push(identity);
		}
		match = testCasePattern.exec(raw);
	}
	if (testIdentities.length === 0) {
		return {
			...empty,
			reportPresent: true,
			total,
			failed,
			skipped,
			problem: "report contains no <testcase> elements",
		};
	}
	if (testIdentities.length !== total) {
		return {
			...empty,
			reportPresent: true,
			total,
			failed,
			skipped,
			problem: "report testcase count disagrees with the declared total",
		};
	}
	const observedFailures = failingIdentities.length;
	if (observedFailures !== failed) {
		return {
			...empty,
			reportPresent: true,
			total,
			failed,
			skipped,
			problem:
				"report failure count disagrees with the observed failing testcases",
		};
	}
	testIdentities.sort();
	failingIdentities.sort();
	return {
		reportPresent: true,
		structurallyValid: true,
		total,
		passed: total - failed - (skipped ?? 0),
		failed,
		skipped: skipped ?? 0,
		testIdentities,
		failingIdentities,
		reportSha256: canonicalDigest({
			total,
			passed: total - failed - (skipped ?? 0),
			failed,
			skipped: skipped ?? 0,
			testIdentities,
			failingIdentities,
		}),
		problem: null,
	};
}

/** Parse the attributes of an XML start tag. */
function parseXmlAttributes(source: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g;
	let match = pattern.exec(source);
	while (match !== null) {
		attributes[match[1]] = decodeXmlEntities(match[2]);
		match = pattern.exec(source);
	}
	return attributes;
}

/** Read an integer XML attribute, or null when it is absent or malformed. */
function readIntegerAttribute(
	attributes: Record<string, string>,
	name: string,
): number | null {
	const raw = attributes[name];
	if (raw === undefined) {
		return null;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

// ============================================================================
// Trusted test execution
// ============================================================================

/** The result of one trusted-test execution. */
export interface TrustedTestRun {
	outcome: ProcessOutcome;
	results: StructuredTestResults;
	/** The raw stdout, retained locally only. NEVER exported. */
	stdout: string;
	/** The raw stderr, retained locally only. NEVER exported. */
	stderr: string;
}

/**
 * Build the environment the candidate test process receives.
 *
 * The environment starts EMPTY and only the operator's explicit allowlist is
 * added, so provider credentials and unrelated secrets cannot leak into an
 * untrusted candidate. Nothing is installed automatically.
 */
export function buildIsolatedEnvironment(
	manifest: AgentFixtureManifest,
	extra: Record<string, string> = {},
): Record<string, string> {
	const allow = manifest.environment?.allow ?? [];
	const deny = new Set(manifest.environment?.deny ?? []);
	const env: Record<string, string> = {};
	for (const name of allow) {
		if (deny.has(name)) {
			continue;
		}
		const value = process.env[name];
		if (value !== undefined) {
			env[name] = value;
		}
	}
	for (const [name, value] of Object.entries(extra)) {
		if (deny.has(name)) {
			continue;
		}
		env[name] = value;
	}
	return env;
}

/**
 * Run the trusted tests in the evaluation workspace.
 *
 * The frozen argv is used verbatim. When the fixture declares a JUnit report,
 * the evaluator appends the reporter flags and then validates that the report
 * belongs to the just-executed process.
 */
export async function runTrustedTests(
	manifest: AgentFixtureManifest,
	workspaceRoot: string,
	reportPath: string,
	signal?: AbortSignal,
): Promise<TrustedTestRun> {
	const cwd = resolve(workspaceRoot, manifest.test.cwd);
	const argv = [...manifest.test.argv];
	if (manifest.test.report?.kind === "junit") {
		rmSync(reportPath, { force: true });
		argv.push("--reporter=junit", `--reporter-outfile=${reportPath}`);
	}
	const result = await runBounded({
		argv,
		cwd,
		timeoutMs: manifest.test.timeoutMs,
		env: buildIsolatedEnvironment(manifest),
		signal,
	});
	let results: StructuredTestResults;
	if (manifest.test.report?.kind === "junit") {
		let raw = "";
		try {
			raw = readFileSync(reportPath, "utf8");
		} catch {
			raw = "";
		}
		results = parseJunitReport(raw);
		if (!results.reportPresent) {
			results.reportPresent = existsSync(reportPath);
		}
	} else {
		results = {
			reportPresent: false,
			structurallyValid: false,
			total: null,
			passed: null,
			failed: null,
			skipped: null,
			testIdentities: [],
			failingIdentities: [],
			reportSha256: null,
			problem: "the fixture declares no structured report",
		};
	}
	return {
		outcome: result.outcome,
		results,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

/**
 * Compare the observed baseline against the manifest's declared baseline.
 *
 * Returns null when the baseline reproduced, or the reason it did not.
 */
export function baselineMismatchReason(
	manifest: AgentFixtureManifest,
	run: TrustedTestRun,
): string | null {
	const expected = manifest.acceptance.expectedBaseline;
	if (expected === undefined) {
		return null;
	}
	if (run.outcome.endKind !== "exited") {
		return `baseline process did not exit normally (${run.outcome.endKind})`;
	}
	if (run.outcome.exitCode !== expected.exitCode) {
		return `baseline exit code ${run.outcome.exitCode} != expected ${expected.exitCode}`;
	}
	const results = run.results;
	if (!results.structurallyValid) {
		return `baseline structured report is unusable: ${results.problem ?? "unknown"}`;
	}
	if (results.passed !== expected.passingTests) {
		return `baseline passing ${results.passed} != expected ${expected.passingTests}`;
	}
	if (results.failed !== expected.failingTests) {
		return `baseline failing ${results.failed} != expected ${expected.failingTests}`;
	}
	if (
		expected.skippedTests !== undefined &&
		results.skipped !== expected.skippedTests
	) {
		return `baseline skipped ${results.skipped} != expected ${expected.skippedTests}`;
	}
	return null;
}

// ============================================================================
// The acceptance artifact
// ============================================================================

/**
 * The portable `agent-acceptance/0.1` record.
 *
 * It contains NO prompt text, NO reasoning content, NO shell output, NO
 * secrets, NO unredacted source and NO absolute private workspace paths. Only
 * authorized metadata, counts, identities, sanitized classifications and
 * digests.
 */
export interface AcceptanceArtifact {
	schemaVersion: typeof ACCEPTANCE_SCHEMA_VERSION;
	experimentId: Provenanced<string>;
	trialId: Provenanced<string>;
	fixtureId: Provenanced<string>;
	fixtureCommit: Provenanced<string>;
	fixtureTree: Provenanced<string>;
	promptSha256: Provenanced<string>;
	candidateSnapshotSha256: Provenanced<string>;
	candidateChangedFiles: Provenanced<string[]>;
	candidateScopeViolations: Provenanced<string[]>;
	candidateProtectedViolations: Provenanced<string[]>;
	trustedTestInvocationIdentity: Provenanced<string>;
	runnerIdentity: Provenanced<string>;
	baselineProcessOutcome: Provenanced<ProcessOutcome>;
	finalProcessOutcome: Provenanced<ProcessOutcome>;
	baselineTestResults: Provenanced<StructuredTestResults>;
	finalTestResults: Provenanced<StructuredTestResults>;
	testReportSha256: Provenanced<string | null>;
	acceptanceVerdict: Provenanced<AcceptanceVerdict>;
	acceptanceReasons: Provenanced<AcceptanceReasonCode[]>;
	evaluatorSourceHead: Provenanced<string>;
	evaluatorVersion: Provenanced<string>;
	evaluatorArtifactSha256: Provenanced<string>;
	evaluatedAt: Provenanced<string>;
	evidenceProvenance: Provenanced<EvidenceProvenance>;
	/** The manifest's own digest, binding the evaluation to its authority. */
	fixtureManifestSha256: Provenanced<string>;
	/** The evaluator's own observation of the fixture's tree digest. */
	fixtureTreeDigest: Provenanced<string>;
	/** The deterministic digest over the reconstructed evaluation workspace. */
	finalWorkspaceDigest: Provenanced<string>;
	/** The deterministic digest over the retained candidate delta. */
	candidateDeltaSha256: Provenanced<string>;
	/** Whether an optional model-behavior trace was supplied. */
	traceProvided: Provenanced<boolean>;
	/** The evaluator's own wall-clock duration. */
	evaluatorDurationMs: Provenanced<number>;
}

/**
 * Build the portable acceptance artifact.
 *
 * Every field carries its provenance. An operator-supplied prompt digest is
 * NEVER promoted to proof that a harness received that prompt.
 */
export function buildAcceptanceArtifact(input: {
	manifest: AgentFixtureManifest;
	manifestSha256: string;
	fixtureIdentity: FixtureIdentity | null;
	inventory: CandidateInventory | null;
	baseline: TrustedTestRun | null;
	final: TrustedTestRun | null;
	verdict: AcceptanceVerdict;
	reasons: AcceptanceReasonCode[];
	experimentId: string;
	trialId: string;
	evaluatorSourceHead: string;
	evaluatorArtifactSha256: string;
	finalWorkspaceDigest: string;
	traceProvided: boolean;
	durationMs: number;
	evaluatedAt: string;
}): AcceptanceArtifact {
	const observed = <T>(value: T | null | undefined): Provenanced<T> =>
		value === null || value === undefined
			? { value: value as T, provenance: "UNAVAILABLE" }
			: { value, provenance: "OBSERVED_BY_EVALUATOR" };
	return {
		schemaVersion: ACCEPTANCE_SCHEMA_VERSION,
		experimentId: {
			value: input.experimentId,
			provenance: "OPERATOR_SUPPLIED",
		},
		trialId: { value: input.trialId, provenance: "OPERATOR_SUPPLIED" },
		fixtureId: {
			value: input.manifest.fixtureId,
			provenance: "OPERATOR_SUPPLIED",
		},
		fixtureCommit: observed(input.fixtureIdentity?.observedCommit ?? null),
		fixtureTree: observed(input.fixtureIdentity?.observedTree ?? null),
		promptSha256: {
			value: input.manifest.prompt.sha256,
			provenance: "OPERATOR_SUPPLIED",
		},
		candidateSnapshotSha256: observed(input.inventory?.deltaSha256 ?? null),
		candidateChangedFiles: observed(
			input.inventory?.changes.map((c) => c.path) ?? null,
		),
		candidateScopeViolations: observed(
			input.inventory?.scopeViolations ?? null,
		),
		candidateProtectedViolations: observed(
			input.inventory?.protectedViolations ?? null,
		),
		trustedTestInvocationIdentity: {
			value: canonicalDigest(input.manifest.test.argv),
			provenance: "DERIVED_FROM_VERIFIED_INPUT",
		},
		runnerIdentity: {
			value: canonicalDigest({
				argv: input.manifest.test.argv,
				timeoutMs: input.manifest.test.timeoutMs,
				cwd: input.manifest.test.cwd,
			}),
			provenance: "DERIVED_FROM_VERIFIED_INPUT",
		},
		baselineProcessOutcome: observed(input.baseline?.outcome ?? null),
		finalProcessOutcome: observed(input.final?.outcome ?? null),
		baselineTestResults: observed(input.baseline?.results ?? null),
		finalTestResults: observed(input.final?.results ?? null),
		testReportSha256: observed(input.final?.results.reportSha256 ?? null),
		acceptanceVerdict: {
			value: input.verdict,
			provenance: "OBSERVED_BY_EVALUATOR",
		},
		acceptanceReasons: {
			value: input.reasons,
			provenance: "OBSERVED_BY_EVALUATOR",
		},
		evaluatorSourceHead: {
			value: input.evaluatorSourceHead,
			provenance: "DERIVED_FROM_VERIFIED_INPUT",
		},
		evaluatorVersion: {
			value: EVALUATOR_VERSION,
			provenance: "DERIVED_FROM_VERIFIED_INPUT",
		},
		evaluatorArtifactSha256: {
			value: input.evaluatorArtifactSha256,
			provenance: "DERIVED_FROM_VERIFIED_INPUT",
		},
		evaluatedAt: {
			value: input.evaluatedAt,
			provenance: "OBSERVED_BY_EVALUATOR",
		},
		evidenceProvenance: {
			value: "OBSERVED_BY_EVALUATOR",
			provenance: "OBSERVED_BY_EVALUATOR",
		},
		fixtureManifestSha256: {
			value: input.manifestSha256,
			provenance: "DERIVED_FROM_VERIFIED_INPUT",
		},
		fixtureTreeDigest: observed(input.fixtureIdentity?.observedTree ?? null),
		finalWorkspaceDigest: {
			value: input.finalWorkspaceDigest,
			provenance: "OBSERVED_BY_EVALUATOR",
		},
		candidateDeltaSha256: observed(input.inventory?.deltaSha256 ?? null),
		traceProvided: {
			value: input.traceProvided,
			provenance: "OBSERVED_BY_EVALUATOR",
		},
		evaluatorDurationMs: {
			value: input.durationMs,
			provenance: "OBSERVED_BY_EVALUATOR",
		},
	};
}

// ============================================================================
// Evaluation orchestration
// ============================================================================

/** The options for one evaluation. */
export interface EvaluateOptions {
	manifest: AgentFixtureManifest;
	/** The candidate workspace path, supplied explicitly by the operator. */
	candidateRoot: string;
	/** Where the evaluation artifacts are written. */
	outDir: string;
	experimentId: string;
	trialId: string;
	/** The optional model-behavior trace. NEVER affects the verdict. */
	tracePath?: string;
	/** A cancellation signal. */
	signal?: AbortSignal;
	/**
	 * The ablation switches used by the necessity witnesses.
	 *
	 * They exist ONLY to demonstrate that a gate is load-bearing. The default
	 * is fully enabled.
	 */
	ablation?: {
		/** Disable the independent structured-test-result requirement. */
		disableStructuredReport?: boolean;
		/** Disable the protected-file conservation gate. */
		disableProtectedFileCheck?: boolean;
	};
}

/** The complete result of one evaluation. */
export interface EvaluationResult {
	verdict: AcceptanceVerdict;
	reasons: AcceptanceReasonCode[];
	artifact: AcceptanceArtifact;
	/** The local-only raw transcripts. NEVER exported. */
	transcripts: { baseline: string; final: string };
	/** The baseline and final runs, for the witnesses. */
	baseline: TrustedTestRun | null;
	final: TrustedTestRun | null;
	inventory: CandidateInventory | null;
}

/**
 * Evaluate one candidate workspace against a frozen fixture.
 *
 * The evaluation order is load-bearing:
 *
 *   1. materialize the frozen fixture and VERIFY its identity;
 *   2. run the RED baseline against the untouched fixture;
 *   3. inventory the candidate and check scope + protected conservation;
 *   4. reconstruct the evaluation workspace and run the same trusted tests.
 *
 * A failure at step 1-2 is `CAPTURE_INSUFFICIENT`; a violation at step 3-4 is
 * `FAIL`; an execution that could not complete is `INCOMPLETE`.
 */
export async function evaluateCandidate(
	options: EvaluateOptions,
): Promise<EvaluationResult> {
	const startedAt = Date.now();
	const outDir = resolve(options.outDir);
	mkdirSync(outDir, { recursive: true });
	const workRoot = join(outDir, ".evaluation-work");
	rmSync(workRoot, { recursive: true, force: true });
	mkdirSync(workRoot, { recursive: true });

	const manifestSha256 = sha256Bytes(canonicalJson(options.manifest));
	const reasons: AcceptanceReasonCode[] = [];
	let fixtureIdentity: FixtureIdentity | null = null;
	let inventory: CandidateInventory | null = null;
	let baseline: TrustedTestRun | null = null;
	let final: TrustedTestRun | null = null;
	let finalWorkspaceDigest = sha256Bytes("");

	const finish = (
		verdictValue: AcceptanceVerdict,
		reasonCodes: AcceptanceReasonCode[],
	): EvaluationResult => {
		const artifact = buildAcceptanceArtifact({
			manifest: options.manifest,
			manifestSha256,
			fixtureIdentity,
			inventory,
			baseline,
			final,
			verdict: verdictValue,
			reasons: reasonCodes,
			experimentId: options.experimentId,
			trialId: options.trialId,
			evaluatorSourceHead: resolveEvaluatorSourceHead(),
			evaluatorArtifactSha256: resolveEvaluatorArtifactSha256(),
			finalWorkspaceDigest,
			traceProvided: options.tracePath !== undefined,
			durationMs: Date.now() - startedAt,
			evaluatedAt: new Date().toISOString(),
		});
		return {
			verdict: verdictValue,
			reasons: reasonCodes,
			artifact,
			transcripts: {
				baseline: baseline ? `${baseline.stdout}\n${baseline.stderr}` : "",
				final: final ? `${final.stdout}\n${final.stderr}` : "",
			},
			baseline,
			final,
			inventory,
		};
	};

	// --- 1. Fixture identity -------------------------------------------------
	const fixtureRoot = join(workRoot, "fixture");
	try {
		fixtureIdentity = materializeFixture(options.manifest, fixtureRoot);
	} catch (error) {
		reasons.push("FIXTURE_IDENTITY_MISMATCH");
		void error;
		return finish("CAPTURE_INSUFFICIENT", reasons);
	}

	// --- 2. RED baseline -----------------------------------------------------
	const baselineReportPath = join(outDir, "baseline-test-report.xml");
	baseline = await runTrustedTests(
		options.manifest,
		fixtureRoot,
		baselineReportPath,
		options.signal,
	);
	const mismatch = baselineMismatchReason(options.manifest, baseline);
	if (mismatch !== null) {
		reasons.push("BASELINE_MISMATCH");
		void mismatch;
		return finish("CAPTURE_INSUFFICIENT", reasons);
	}

	// --- 3. Candidate root validation ---------------------------------------
	const candidateRoot = resolve(options.candidateRoot);
	let candidateStats: ReturnType<typeof statSync>;
	try {
		candidateStats = statSync(candidateRoot);
	} catch {
		reasons.push("CANDIDATE_ROOT_INVALID");
		return finish("INCOMPLETE", reasons);
	}
	if (!candidateStats.isDirectory()) {
		reasons.push("CANDIDATE_ROOT_INVALID");
		return finish("INCOMPLETE", reasons);
	}

	inventory = inventoryCandidate(fixtureRoot, candidateRoot, options.manifest);

	if (inventory.escapeViolations.length > 0) {
		reasons.push("SYMLINK_ESCAPE");
		reasons.push("PATH_TRAVERSAL");
		return finish("FAIL", reasons);
	}

	const protectedViolations = options.ablation?.disableProtectedFileCheck
		? []
		: inventory.protectedViolations;
	if (protectedViolations.length > 0) {
		reasons.push("PROTECTED_FILE_CHANGED");
	}
	if (inventory.scopeViolations.length > 0) {
		reasons.push("OUT_OF_SCOPE_CHANGE");
	}
	if (protectedViolations.length > 0 || inventory.scopeViolations.length > 0) {
		return finish("FAIL", reasons);
	}

	// --- 4. Reconstruct the evaluation workspace and run the trusted tests ---
	const evaluationRoot = join(workRoot, "evaluation");
	try {
		buildEvaluationWorkspace(
			fixtureRoot,
			candidateRoot,
			inventory,
			evaluationRoot,
		);
	} catch {
		reasons.push("CANDIDATE_SNAPSHOT_FAILED");
		return finish("INCOMPLETE", reasons);
	}
	finalWorkspaceDigest = digestWorkspace(evaluationRoot);
	const finalReportPath = join(outDir, "test-report.xml");
	final = await runTrustedTests(
		options.manifest,
		evaluationRoot,
		finalReportPath,
		options.signal,
	);

	if (final.outcome.endKind === "timeout") {
		reasons.push("PROCESS_TIMEOUT");
		return finish("INCOMPLETE", reasons);
	}
	if (final.outcome.endKind === "spawnFailed") {
		reasons.push("PROCESS_SPAWN_FAILED");
		return finish("INCOMPLETE", reasons);
	}
	if (final.outcome.endKind === "cancelled") {
		return finish("INCOMPLETE", reasons);
	}

	// A complete passing report combined with a non-zero exit must NOT be
	// silently treated as a successful evaluation.
	if (final.outcome.exitCode !== 0) {
		reasons.push("TEST_FAILURE");
		return finish("FAIL", reasons);
	}

	const structuredRequired = options.manifest.test.report?.required !== false;
	if (!options.ablation?.disableStructuredReport && structuredRequired) {
		if (!final.results.reportPresent) {
			reasons.push("TEST_REPORT_MISSING");
			return finish("INCOMPLETE", reasons);
		}
		if (!final.results.structurallyValid) {
			reasons.push("TEST_REPORT_INVALID");
			return finish("INCOMPLETE", reasons);
		}
	}

	if (final.results.structurallyValid) {
		if (final.results.total !== options.manifest.acceptance.expectedTestCount) {
			reasons.push("TEST_COUNT_MISMATCH");
			return finish("FAIL", reasons);
		}
		if (
			(final.results.passed ?? 0) <
			options.manifest.acceptance.requiredPassingTests
		) {
			reasons.push("TEST_FAILURE");
			return finish("FAIL", reasons);
		}
		// No previously passing test may regress.
		const baselineFailing = new Set(baseline?.results.failingIdentities ?? []);
		const baselinePassing = (baseline?.results.testIdentities ?? []).filter(
			(identity) => !baselineFailing.has(identity),
		);
		const regressed = final.results.failingIdentities.filter((identity) =>
			baselinePassing.includes(identity),
		);
		if (regressed.length > 0) {
			reasons.push("REGRESSION");
			return finish("FAIL", reasons);
		}
	}

	return finish("PASS", reasons);
}

// ============================================================================
// Digests and source identity
// ============================================================================

/** A deterministic digest over a workspace's file contents. */
export function digestWorkspace(root: string): string {
	const walk = walkWorkspace(root);
	return canonicalDigest(
		walk.entries
			.filter((entry) => entry.type !== "directory")
			.map((entry) => ({
				path: entry.path,
				type: entry.type,
				sha256: entry.sha256 ?? null,
				linkTarget: entry.linkTarget ?? null,
			})),
	);
}

/** The evaluator's own source identity, bound to the artifact. */
function resolveEvaluatorSourceHead(): string {
	const head = spawnSyncProcess("git", ["rev-parse", "HEAD"], {
		cwd: process.cwd(),
	});
	return head.status === 0 ? head.stdout.trim() : "UNAVAILABLE";
}

/** The SHA-256 of the evaluator's own source file. */
function resolveEvaluatorArtifactSha256(): string {
	try {
		return sha256File(fileURLToPath(import.meta.url));
	} catch {
		return "UNAVAILABLE";
	}
}

// ============================================================================
// Portable acceptance event stream
// ============================================================================

/**
 * Build the evaluator-owned `agent-trace/0.1` acceptance event stream.
 *
 * This is a SEPARATE record stream from the harness's model-behavior trace.
 * The evaluator owns its own event identities and observation boundaries.
 *
 * The composition rule is an EXPLICIT `trialId` / experiment association — a
 * timestamp-proximity join is forbidden, and an evaluator event id is NEVER
 * equated with a harness run id, a harness step id, or a provider request id.
 */
export function buildAcceptanceEvents(
	artifact: AcceptanceArtifact,
	harness: string,
): Record<string, unknown>[] {
	const trialId = artifact.trialId.value;
	const experimentId = artifact.experimentId.value;
	const verdict = artifact.acceptanceVerdict.value;
	const reasons = artifact.acceptanceReasons.value;
	const base = {
		contract: PORTABLE_TRACE_CONTRACT_VERSION,
		harness: `evaluator:${harness}`,
		family: "acceptance" as const,
		sourceEvidenceBoundary: "observed" as const,
		evidenceQuality: "REAL" as const,
		correlationCompleteness: "observed" as const,
		traceTruncated: false,
	};
	return [
		{
			...base,
			recordId: `acceptance:${trialId}:verdict`,
			nativeEventId: 0,
			nativeEventType: "acceptance_verdict",
			sourceOrder: 0,
			nativeTraceId: `acceptance-trace-${trialId}`,
			timestamp: artifact.evaluatedAt.value,
			identity: {
				experimentId,
				trialId,
				fixtureId: artifact.fixtureId.value,
			},
			payload: {
				verdict,
				reasons,
				fixtureCommit: artifact.fixtureCommit.value,
				fixtureTree: artifact.fixtureTree.value,
				promptSha256: artifact.promptSha256.value,
				candidateSnapshotSha256: artifact.candidateSnapshotSha256.value,
				finalWorkspaceDigest: artifact.finalWorkspaceDigest.value,
				testReportSha256: artifact.testReportSha256.value,
				evaluatorVersion: artifact.evaluatorVersion.value,
				evaluatorArtifactSha256: artifact.evaluatorArtifactSha256.value,
				evaluatorSourceHead: artifact.evaluatorSourceHead.value,
				provenance: "OBSERVED_BY_EVALUATOR",
			},
		},
	];
}

/**
 * The portable acceptance record's payload.
 *
 * The `agent-trace/0.1` contract's `acceptance` family allowlist is
 * INTENTIONALLY EMPTY in the ClineMM native adapter, because ClineMM does not
 * capture structured test results. The evaluator owns the acceptance payload,
 * so it defines its own (content-free) shape and never routes it through the
 * native normalizer.
 */
export const ACCEPTANCE_EVENT_PAYLOAD_KEYS = [
	"verdict",
	"reasons",
	"fixtureCommit",
	"fixtureTree",
	"promptSha256",
	"candidateSnapshotSha256",
	"finalWorkspaceDigest",
	"testReportSha256",
	"evaluatorVersion",
	"evaluatorArtifactSha256",
	"evaluatorSourceHead",
	"provenance",
] as const;

// ============================================================================
// CLI
// ============================================================================

/** Parse the CLI arguments. */
export interface CliOptions {
	manifestPath: string;
	candidateRoot: string;
	outDir: string;
	experimentId: string;
	trialId: string;
	harness: string;
	tracePath?: string;
}

/** Parse `--key value` style arguments. */
export function parseCliArgs(argv: string[]): CliOptions {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token?.startsWith("--")) {
			continue;
		}
		const key = token.slice(2);
		const value = argv[index + 1];
		if (value === undefined || value.startsWith("--")) {
			throw new Error(`missing value for --${key}`);
		}
		values.set(key, value);
		index += 1;
	}
	const required = (key: string): string => {
		const value = values.get(key);
		if (value === undefined) {
			throw new Error(`missing required argument --${key}`);
		}
		return value;
	};
	return {
		manifestPath: required("manifest"),
		candidateRoot: required("candidate"),
		outDir: required("out-dir"),
		experimentId: values.get("experiment-id") ?? "unassigned",
		trialId: values.get("trial-id") ?? "unassigned",
		harness: values.get("harness") ?? "unknown",
		tracePath: values.get("trace"),
	};
}

/** Validate a manifest's shape before it is trusted. */
export function validateManifest(manifest: unknown): AgentFixtureManifest {
	if (typeof manifest !== "object" || manifest === null) {
		throw new Error("manifest is not an object");
	}
	const value = manifest as Record<string, unknown>;
	if (value.schemaVersion !== FIXTURE_SCHEMA_VERSION) {
		throw new Error(`manifest schemaVersion must be ${FIXTURE_SCHEMA_VERSION}`);
	}
	if (typeof value.fixtureId !== "string" || value.fixtureId.length === 0) {
		throw new Error("manifest fixtureId must be a non-empty string");
	}
	const source = value.source as Record<string, unknown> | undefined;
	if (!source || source.kind !== "git") {
		throw new Error("manifest source.kind must be 'git'");
	}
	for (const key of ["repository", "commit", "tree"]) {
		if (
			typeof source[key] !== "string" ||
			(source[key] as string).length === 0
		) {
			throw new Error(`manifest source.${key} must be a non-empty string`);
		}
	}
	const prompt = value.prompt as Record<string, unknown> | undefined;
	if (
		!prompt ||
		typeof prompt.sha256 !== "string" ||
		!/^[0-9a-f]{64}$/.test(prompt.sha256)
	) {
		throw new Error(
			"manifest prompt.sha256 must be a 64-character lowercase hex digest",
		);
	}
	for (const key of ["allowedChanges", "protectedPaths"]) {
		if (
			!Array.isArray(value[key]) ||
			(value[key] as unknown[]).some((p) => typeof p !== "string")
		) {
			throw new Error(`manifest ${key} must be an array of strings`);
		}
	}
	const test = value.test as Record<string, unknown> | undefined;
	if (!test || !Array.isArray(test.argv) || test.argv.length === 0) {
		throw new Error("manifest test.argv must be a non-empty array");
	}
	if (test.argv.some((part) => typeof part !== "string")) {
		throw new Error("manifest test.argv must contain only strings");
	}
	if (typeof test.cwd !== "string") {
		throw new Error("manifest test.cwd must be a string");
	}
	if (
		typeof test.timeoutMs !== "number" ||
		!Number.isFinite(test.timeoutMs) ||
		test.timeoutMs <= 0
	) {
		throw new Error("manifest test.timeoutMs must be a positive number");
	}
	const acceptance = value.acceptance as Record<string, unknown> | undefined;
	if (
		!acceptance ||
		typeof acceptance.expectedTestCount !== "number" ||
		typeof acceptance.requiredPassingTests !== "number"
	) {
		throw new Error(
			"manifest acceptance must declare expectedTestCount and requiredPassingTests",
		);
	}
	return manifest as AgentFixtureManifest;
}

/** The CLI's main entry point. */
export async function main(argv: string[]): Promise<number> {
	let options: CliOptions;
	try {
		options = parseCliArgs(argv);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		return 2;
	}
	const manifest = validateManifest(
		JSON.parse(readFileSync(options.manifestPath, "utf8")),
	);
	const result = await evaluateCandidate({
		manifest,
		candidateRoot: options.candidateRoot,
		outDir: options.outDir,
		experimentId: options.experimentId,
		trialId: options.trialId,
		tracePath: options.tracePath,
	});
	const outDir = resolve(options.outDir);
	writeFileSync(
		join(outDir, "acceptance.json"),
		`${JSON.stringify(result.artifact, null, 2)}\n`,
	);
	writeFileSync(
		join(outDir, "acceptance-events.jsonl"),
		`${buildAcceptanceEvents(result.artifact, options.harness)
			.map((event) => JSON.stringify(event))
			.join("\n")}\n`,
	);
	writeFileSync(
		join(outDir, "evaluation-manifest.json"),
		`${JSON.stringify(
			{
				schemaVersion: FIXTURE_SCHEMA_VERSION,
				fixtureId: manifest.fixtureId,
				fixtureCommit: manifest.source.commit,
				fixtureTree: manifest.source.tree,
				candidateChangedFiles:
					result.inventory?.changes.map((change) => change.path) ?? [],
				candidateScopeViolations: result.inventory?.scopeViolations ?? [],
				candidateProtectedViolations:
					result.inventory?.protectedViolations ?? [],
				verdict: result.verdict,
				reasons: result.reasons,
			},
			null,
			2,
		)}\n`,
	);
	// Raw transcripts are retained locally, separately from the portable export.
	writeFileSync(join(outDir, "raw-transcripts.txt"), result.transcripts.final);
	process.stdout.write(
		`${result.verdict} ${result.reasons.join(",")}`.trimEnd() + "\n",
	);
	return result.verdict === "PASS" ? 0 : result.verdict === "FAIL" ? 1 : 2;
}

// The module is also a CLI. The guard keeps `bun test` imports side-effect free.
if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
	main(process.argv.slice(2)).then(
		(code) => {
			process.exitCode = code;
		},
		(error: unknown) => {
			process.stderr.write(
				`${error instanceof Error ? error.stack : String(error)}\n`,
			);
			process.exitCode = 2;
		},
	);
}
