#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — Leamas v2 evidence rebind helpers.
 *
 * Testable surface for the gate-summary producer. The pure helpers and
 * types exported here are independent of any I/O or side effects so the
 * `gate-summary.test.ts` suite can drive them without invoking the
 * producer's full execution path.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
	checkEvidence,
	isEvidenceOk,
	isEvidenceStructurallyValid,
	loadEvidenceFile,
	type ExecutionIdentityDerivation,
	type EvidenceView,
} from "./baseline-closure";

// ---------- types ----------------------------------------------------------

export type CheckScope = "MICROC3" | "CORRECTION21" | "WORKTREE" | "TOOLING";

export type CheckStatus = "pass" | "fail" | "unavailable";

export type ScopeStatus = "CLOSED" | "OPEN" | "PARTIAL";

export type OverallStatus = "pass" | "fail" | "unavailable";

export interface CheckExtras {
	argv: string[];
	exit_code: number | null;
	duration_ms: number;
	stdout_sha256: string;
	stderr_sha256: string;
}

export interface GateCheckSummary {
	name: string;
	scope: CheckScope;
	status: CheckStatus;
	evidence: string;
	detail: string;
	extras: CheckExtras;
	total?: number;
	pass_count?: number;
	fail_count?: number;
	skip_count?: number;
	unavailable_count?: number;
}

export interface ReasonCode {
	code:
		| "REPOSITORY_HEAD_DRIFT"
		| "REPOSITORY_TREE_DRIFT"
		| "SUBJECT_TREE_DRIFT"
		| "WORKTREE_DIRTY_BEFORE"
		| "WORKTREE_DIRTY_AFTER";
	message: string;
}

export interface RepositorySnapshot {
	head_oid: string;
	tree_oid: string;
	subject_tree_oid: string;
	worktree_clean: boolean;
	unexpected_paths: string[];
}

export interface ParentActState {
	head_oid: string | null;
	tree_oid: string | null;
	bundle_dir_exists: boolean;
	bundle_complete: boolean | null;
	bundle_structurally_valid: boolean | null;
	verdict: "CLOSED" | "OPEN" | "PARTIAL";
	disposition: string;
	diagnostics: string[];
}

export interface SnapshotContext {
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

export interface CheckMetadata {
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

export interface Cmd {
	name: string;
	scope: CheckScope;
	evidence: string;
	cwd: string;
	exec: string;
	args: string[];
	timeout_ms?: number;
}

export interface RunResult {
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

// ---------- helpers --------------------------------------------------------

export function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function gitText(
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

export function isCleanPorcelain(text: string): { clean: boolean; unexpected: string[] } {
	const lines = text.split("\n").filter((l) => l.length > 0);
	return { clean: lines.length === 0, unexpected: lines };
}

const OID_PATTERN = /^[0-9a-f]{40}$/;

export function isValidOid(value: string): boolean {
	return OID_PATTERN.test(value);
}

// ---------- command execution ---------------------------------------------

export function runExec(cmd: Cmd, signalTimeoutMs = 10 * 60_000): RunResult {
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

export function persistCheckStreams(
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

// ---------- real parent-state probe ---------------------------------------

export function deriveParentActState(ctx: SnapshotContext): ParentActState {
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
	const bundledHead =
		typeof evObj?.execution_head_oid === "string" ? evObj.execution_head_oid : null;
	const bundledTree =
		typeof evObj?.execution_tree_oid === "string" ? evObj.execution_tree_oid : null;
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
		const reason =
			view.bundledResultCommandSetExact === false
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

// ---------- status arithmetic ----------------------------------------------

// Names of checks that are SUPPLEMENTAL (i.e. their failure does not
// flip a passing scope to OPEN). `git_diff_hygiene` supplements the
// authoritative `working_tree_cleanliness` WORKTREE gate; per the v2
// contract, a passing `working_tree_cleanliness` is what binds the
// "worktree is clean" assertion.
export const SUPPLEMENTAL_CHECK_NAMES: ReadonlySet<string> = new Set([
	"git_diff_hygiene",
]);

export function deriveScopeStatus(checks: GateCheckSummary[]): {
	status: ScopeStatus;
	disposition: string;
} {
	const micro3 = checks.filter((c) => c.scope === "MICROC3");
	const worktree = checks.filter((c) => c.scope === "WORKTREE");
	const tooling = checks.filter((c) => c.scope === "TOOLING");
	const scopeChecks = [...micro3, ...worktree, ...tooling];
	// Authoritative WORKTREE failure flips the scope to OPEN. The
	// supplemental `git_diff_hygiene` failure does not.
	if (worktree.some((c) => c.status === "fail" && !SUPPLEMENTAL_CHECK_NAMES.has(c.name))) {
		return { status: "OPEN", disposition: "required WORKTREE check failed" };
	}
	const requiredScopeChecks = scopeChecks.filter(
		(c) => !SUPPLEMENTAL_CHECK_NAMES.has(c.name),
	);
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

export function deriveParentStatus(state: ParentActState): ScopeStatus {
	return state.verdict;
}

export function deriveOverallStatus(checks: GateCheckSummary[]): OverallStatus {
	if (checks.some((c) => c.status === "fail")) return "fail";
	if (checks.some((c) => c.status === "unavailable")) return "unavailable";
	if (checks.some((c) => c.status === "pass")) return "pass";
	return "unavailable";
}

// ---------- summary construction (testable) -------------------------------

export interface GateSummary {
	schema_version: 2;
	generated_at: string;
	tool: { name: string; version: string };
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
	identity_stable: boolean;
	checks: GateCheckSummary[];
	parent_act_state: ParentActState;
	rejection_reasons: ReasonCode[];
}

export function deriveOverallDisposition(
	overall: OverallStatus,
): string {
	if (overall === "pass") return "all gates pass";
	if (overall === "unavailable") return "one or more checks unavailable";
	return "one or more checks failed";
}

// Suppress unused warnings for the helper signatures used by the producer.
void dirname;
void join;