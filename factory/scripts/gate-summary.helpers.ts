#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — Leamas v2 evidence rebind helpers.
 *
 * Testable surface for the gate-summary producer. The pure helpers and
 * types exported here are independent of any I/O or side effects so the
 * `gate-summary.test.ts` suite can drive them without invoking the
 * producer's full execution path.
 *
 * µC-3 round 5 (LEAMAS-V2-EVIDENCE-REBIND01) rebinds:
 *  - the canonical bundle is published atomically via a stage-then-swap
 *    pattern (`atomicPublish` in `gate-summary.ts`);
 *  - `deriveParentActState` binds the bundled OIDs against the producer's
 *    *current* ctx identity (head/tree/subject), never against the
 *    bundle itself;
 *  - the parent CLOSED verdict requires every R4/R5/R6/R7/R16 /
 *    mandatory / affected-scope / native-probes predicate in
 *    `ParentClosureInput`;
 *  - check metadata uses paths RELATIVE to the gate bundle root
 *    (`gates/<scope>/<check>.stdout`) instead of absolute filesystem
 *    paths.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";

import {
	checkEvidence,
	isEvidenceOk,
	type EvidenceView,
	type ExecutionIdentityDerivation,
	isEvidenceStructurallyValid,
	loadEvidenceFile,
} from "./baseline-closure";
export { isEvidenceOk };

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
		| "WORKTREE_DIRTY_AFTER"
		| "RANGE_PATCH_DIRTY";
	message: string;
}

export interface RepositorySnapshot {
	head_oid: string;
	tree_oid: string;
	subject_tree_oid: string;
	worktree_clean: boolean;
	unexpected_paths: string[];
	range_patch_clean: boolean;
	range_patch_unexpected: string[];
}

/**
 * The complete predicate set required for a parent ACT CLOSED verdict.
 * `isParentClosed()` reduces ALL of these to a single boolean. The
 * `evidence_ok` field is computed from `isEvidenceOk(view)` plus the
 * baseline requirements R4/R5/R6/R7/R16 + mandatory + affected_scope +
 * native_probes; the producer wires bundle-asserted values into these
 * booleans via `buildParentClosureInput`. A field absent from the
 * bundle defaults to `false`, which fails the conjunction closed.
 */
export interface ParentClosureInput {
	evidence_ok: boolean;
	r4_full_tree_comparison: boolean;
	r5_schema_validation: boolean;
	r6_upstream_baseline: boolean;
	r7_cross_platform_ci: boolean;
	r16_source_derived_discovery: boolean;
	mandatory_all_pass: boolean;
	affected_scope_all_pass: boolean;
	native_probes_complete: boolean;
}

export interface ParentClosureAssessment {
	is_closed: boolean;
	satisfied: string[];
	missing: string[];
}

export interface ParentActState {
	head_oid: string | null;
	tree_oid: string | null;
	bundle_dir_exists: boolean;
	bundle_complete: boolean | null;
	bundle_structurally_valid: boolean | null;
	closure_assessment: ParentClosureAssessment;
	verdict: "CLOSED" | "OPEN" | "PARTIAL";
	disposition: string;
	diagnostics: string[];
}

/**
 * Bootstrap context for one producer run. The producer stages EVERY
 * artifact under `stagingDir` first; the canonical `.factory/` is only
 * touched via the `atomicPublish()` stage-then-swap. `factoryDir`,
 * `canonicalSummaryPath`, `canonicalGatesDir`, and `backupDir` are
 * sibling paths of `.factory/` so the swap can be performed with two
 * `renameSync()` calls.
 */
export interface SnapshotContext {
	repoRoot: string;
	git: string;
	bun: string;
	bunx: string;
	leamas: string;
	factoryDir: string;          // .factory (canonical bundle)
	stagingDir: string;          // .factory-staging-<nonce> (sibling)
	backupDir: string;           // .factory-backup-<nonce> (sibling)
	canonicalSummaryPath: string;       // .factory/gate-summary.json
	canonicalExtendedPath: string;      // .factory/gate-summary.extended.json
	canonicalGatesDir: string;          // .factory/gates/
	canonicalLeamasAttestationPath: string;  // .factory/gate-summary.leamas.json
	scriptsDir: string;
	schemasDir: string;
	tsconfigPath: string;
	testsDir: string;
	parentEvidenceDir: string;
	headOid: string;
	treeOid: string;
	subjectTreeOid: string;
	worktreeCleanBefore: boolean;
	unexpectedPathsBefore: string[];
	rangePatchCleanBefore: boolean;
	rangePatchUnexpectedBefore: string[];
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
	/**
	 * Paths RELATIVE to the canonical gate bundle (`.factory/`). The
	 * receiver of an `argv` knows the absolute location by joining its
	 * known gate-bundle root with these relative segments. Persisting
	 * absolute paths leaked the host filesystem layout and made
	 * detached evidence non-portable.
	 */
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

// Leamas v2 schema (canonical v2 contract): no producer extensions.
export interface GateSummary {
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

/**
 * The Leamas attestation does NOT live inside the canonical v2 summary
 * (the document does not validate itself recursively). It is a sibling
 * under `.factory/gate-summary.leamas.json` after atomic publication.
 */
export interface LeamasAttestation {
	tool: { name: string; build_commit: string | null; version: string | null };
	command: string;
	ran_at: string;
	canonical_summary_sha256: string;
	canonical_extended_sha256: string;
	stages: LeamasAttestationStage[];
	verdict: "pass" | "fail" | "unavailable";
	reason: string;
}

export interface LeamasAttestationStage {
	label: string;
	repo_root: string;
	range: string;
	digest_output_path: string;
	raw_excerpt: string;
	expected_outcome: "accept" | "reject";
	observed_outcome: "accept" | "reject";
}

export interface GateSummaryExtended {
	tool: { name: string; version: string };
	identity_stable: boolean;
	parent_act_state: ParentActState;
	rejection_reasons: ReasonCode[];
	known_valid_v2_repo_sha256: string;
	known_invalid_v3_repo_sha256: string;
	candidate_repo_sha256?: string;
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

/**
 * Encode a gate-bundle-relative path. The receiver knows the absolute
 * bundle root; persisting relative segments keeps detached evidence
 * portable across host layouts.
 */
export function relativeToBundleRoot(absPath: string, bundleRoot: string): string {
	const bundleRootAbs = isAbsolute(bundleRoot) ? bundleRoot : join(bundleRoot);
	let rel = relative(bundleRootAbs, absPath);
	if (rel === "" || rel.startsWith("..")) {
		// Fall back to the basename when the path escapes the bundle root.
		rel = absPath.split("/").pop() ?? absPath;
	}
	return rel.replaceAll("\\", "/");
}

/**
 * Build a deterministic sibling path for the staging directory so the
 * atomic swap can rename `.factory-staging-<nonce>/` over `.factory/`
 * without colliding with concurrent runs.
 */
export function makeStagingPath(repoRoot: string, nonce: string): string {
	return join(repoRoot, `.factory-staging-${nonce}`);
}

export function makeBackupPath(repoRoot: string, nonce: string): string {
	return join(repoRoot, `.factory-backup-${nonce}`);
}

/**
 * Path construction for sibling-of-`.factory/` staging/backup locations.
 * The producer stage directory has the SAME layout as `.factory/`:
 *
 *   `.factory-staging-<nonce>/gate-summary.json`
 *   `.factory-staging-<nonce>/gate-summary.extended.json`
 *   `.factory-staging-<nonce>/gates/<scope>/<check>.{stdout,stderr,metadata.json}`
 *
 * After the atomic swap, the staging dir BECOMES `.factory/` and the
 * relative paths line up perfectly with the canonical contract.
 */
export function stagingGateSummaryPath(stagingDir: string): string {
	return join(stagingDir, "gate-summary.json");
}

export function stagingExtendedPath(stagingDir: string): string {
	return join(stagingDir, "gate-summary.extended.json");
}

export function stagingLeamasAttestationPath(stagingDir: string): string {
	return join(stagingDir, "gate-summary.leamas.json");
}

export function stagingScopeDir(stagingDir: string, scope: CheckScope): string {
	return join(stagingDir, "gates", scope);
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
	stagingDir: string,
	cmd: Cmd,
	result: RunResult,
	checkStatus: CheckStatus,
): { metadataPath: string; stdoutPath: string; stderrPath: string } {
	const dir = stagingScopeDir(stagingDir, cmd.scope);
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
		stdout_path: relative(stagingDir, stdoutPath),
		stdout_sha256: result.extras.stdout_sha256,
		stderr_path: relative(stagingDir, stderrPath),
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

// ---------- check-name uniqueness -----------------------------------------

/**
 * Producer invariants — rejected if any duplicate check name appears in
 * `GateCheckSummary[]`. Persisted streams would overwrite and the
 * `argv` digest would silently drop one of two claims.
 */
export function assertUniqueCheckNames(checks: GateCheckSummary[]): void {
	const seen = new Set<string>();
	const dups: string[] = [];
	for (const c of checks) {
		if (seen.has(c.name)) dups.push(c.name);
		seen.add(c.name);
	}
	if (dups.length > 0) {
		throw new Error(`GATE_SUMMARY_DUPLICATE_CHECK_NAMES:${dups.join(",")}`);
	}
}

// ---------- identity drift -------------------------------------------------

const IDENTITY_DRIFT_REASONS: ReadonlyArray<{
	code: ReasonCode["code"];
	before: string;
	after: string;
	unexpected?: string[];
}> = [];

/**
 * Derive `ReasonCode[]` from two snapshots. Returns an empty array when
 * identity is stable AND worktree is clean. The reason codes travel
 * with the extended sibling file so reviewers see exactly which sample
 * mismatched.
 */
export function deriveRejectionReasons(
	before: RepositorySnapshot,
	after: RepositorySnapshot,
): ReasonCode[] {
	const out: ReasonCode[] = [];
	if (before.head_oid !== after.head_oid) {
		out.push({
			code: "REPOSITORY_HEAD_DRIFT",
			message: `head drifted from ${before.head_oid} to ${after.head_oid}`,
		});
	}
	if (before.tree_oid !== after.tree_oid) {
		out.push({
			code: "REPOSITORY_TREE_DRIFT",
			message: `tree drifted from ${before.tree_oid} to ${after.tree_oid}`,
		});
	}
	if (before.subject_tree_oid !== after.subject_tree_oid) {
		out.push({
			code: "SUBJECT_TREE_DRIFT",
			message: `subject drifted from ${before.subject_tree_oid} to ${after.subject_tree_oid}`,
		});
	}
	if (!before.worktree_clean) {
		out.push({
			code: "WORKTREE_DIRTY_BEFORE",
			message: `unexpected paths before checks: ${before.unexpected_paths.join(", ")}`,
		});
	}
	if (!after.worktree_clean) {
		out.push({
			code: "WORKTREE_DIRTY_AFTER",
			message: `unexpected paths after checks: ${after.unexpected_paths.join(", ")}`,
		});
	}
	if (!before.range_patch_clean || !after.range_patch_clean) {
		// Both samples must confirm a clean `git diff HEAD^..HEAD --check`.
		// A failure at either timestamp produces a RANGE_PATCH_DIRTY code.
		out.push({
			code: "RANGE_PATCH_DIRTY",
			message: `head^..head range patch dirty: before=${before.range_patch_clean}, after=${after.range_patch_clean}`,
		});
	}
	void IDENTITY_DRIFT_REASONS;
	return out;
}

// ---------- parent closure ------------------------------------------------

/**
 * Reduce a `ParentClosureInput` to a single boolean. ALL nine predicates
 * must be `true` for the conjunction to be satisfied; `evidence_ok`
 * alone is insufficient. The µC-3 review specifically demanded this:
 * `isEvidenceOk` only proves the evidence contract, not the parent
 * baseline requirements R4/R5/R6/R7/R16 + convergence.
 */
export function isParentClosed(input: ParentClosureInput): boolean {
	return (
		input.evidence_ok &&
		input.r4_full_tree_comparison &&
		input.r5_schema_validation &&
		input.r6_upstream_baseline &&
		input.r7_cross_platform_ci &&
		input.r16_source_derived_discovery &&
		input.mandatory_all_pass &&
		input.affected_scope_all_pass &&
		input.native_probes_complete
	);
}

/**
 * Surface the satisfied/missing predicates. The producer persists the
 * `closure_assessment` next to the verdict so reviewers see at a glance
 * which baseline requirement is open.
 */
export function assessParentClosure(
	input: ParentClosureInput,
): ParentClosureAssessment {
	const required: ReadonlyArray<{
		key: keyof ParentClosureInput;
		label: string;
	}> = [
		{ key: "evidence_ok", label: "evidence_ok" },
		{ key: "r4_full_tree_comparison", label: "R4_full_tree_comparison" },
		{ key: "r5_schema_validation", label: "R5_schema_validation" },
		{ key: "r6_upstream_baseline", label: "R6_upstream_baseline" },
		{ key: "r7_cross_platform_ci", label: "R7_cross_platform_ci" },
		{ key: "r16_source_derived_discovery", label: "R16_source_derived_discovery" },
		{ key: "mandatory_all_pass", label: "mandatory_all_pass" },
		{ key: "affected_scope_all_pass", label: "affected_scope_all_pass" },
		{ key: "native_probes_complete", label: "native_probes_complete" },
	];
	const satisfied: string[] = [];
	const missing: string[] = [];
	for (const { key, label } of required) {
		if (input[key]) satisfied.push(label);
		else missing.push(label);
	}
	return {
		is_closed: missing.length === 0,
		satisfied,
		missing,
	};
}

// ---------- real parent-state probe ---------------------------------------

/**
 * Build a `ParentClosureInput` from a bundle's `evidence.json` plus the
 * `view` returned by `checkEvidence`. Bundle-asserted requirement flags
 * are read under well-known keys; if the bundle does NOT record a flag,
 * the field defaults to `false` (fail-closed). The producer's job is to
 * identify whether the runner bundle asserted the requirement; bundling
 * the requirement in `evidence.json` is the production runner's job.
 */
export function buildParentClosureInput(
	view: EvidenceView,
	bundleObj: Record<string, unknown> | null,
): ParentClosureInput {
	// P0-5: use `isEvidenceOk(view)` so the parent closure boundary
	// is anchored to the SAME evidence conjunction the renderer/test
	// suite already uses. Inlining the dimensions here would diverge.
	const evidenceOk: boolean = isEvidenceOk(view);
	const obj = bundleObj ?? {};
	const getBool = (key: string): boolean => {
		const v = obj[key];
		return v === true;
	};
	return {
		evidence_ok: evidenceOk,
		r4_full_tree_comparison: getBool("r4_satisfied"),
		r5_schema_validation: getBool("r5_satisfied"),
		r6_upstream_baseline: getBool("r6_satisfied"),
		r7_cross_platform_ci: getBool("r7_satisfied"),
		r16_source_derived_discovery: getBool("r16_satisfied"),
		mandatory_all_pass: getBool("mandatory_all_pass"),
		affected_scope_all_pass: getBool("affected_scope_all_pass"),
		native_probes_complete: view.nativeProbesComplete === true && getBool("native_probes_complete"),
	};
}

/**
 * Read the production-runner detached bundle and reduce it to a
 * `ParentActState`. The verdict is derived from the full predicate
 * conjunction (`isParentClosed`); the structural validity flag and the
 * provenance flag are surfaced separately so reviewers can see exactly
 * which dimension closed or opened.
 *
 * IMPORTANT: `headOidNow` / `treeOidNow` / `filteredSubjectTreeOidNow`
 * MUST be the producer's *current* repository identity, NOT the
 * bundled OIDs. The bundled OIDs are only used for object-existence
 * checks (`git cat-file -e`) and the recorded-head-to-recorded-tree
 * derivation (which confirms the bundle is internally consistent).
 */
export function deriveParentActState(
	ctx: SnapshotContext,
	bundleDir: string = ctx.parentEvidenceDir,
): ParentActState {
	const evidencePath = join(bundleDir, "evidence.json");
	const hashesPath = join(bundleDir, "hashes.sha256");
	const bundledResultPath = join(bundleDir, "verification-results.json");
	const dispose: ParentActState = {
		head_oid: null,
		tree_oid: null,
		bundle_dir_exists: false,
		bundle_complete: null,
		bundle_structurally_valid: null,
		closure_assessment: { is_closed: false, satisfied: [], missing: ["bundle_absent"] },
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
			closure_assessment: {
				is_closed: false,
				satisfied: [],
				missing: ["evidence_contract"],
			},
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
			closure_assessment: {
				is_closed: false,
				satisfied: [],
				missing: ["evidence_json_unparseable"],
			},
		};
	}
	if (!ev.ok) {
		return {
			...dispose,
			bundle_dir_exists: true,
			disposition: `bundle malformed (loadEvidenceFile: ${ev.error ?? "unknown"})`,
			diagnostics: [ev.error ?? "unknown"],
			closure_assessment: {
				is_closed: false,
				satisfied: [],
				missing: ["load_evidence_failed"],
			},
		};
	}
	const hashesText = readFileSync(hashesPath, "utf8");
	const evObj = (ev.value ?? null) as Record<string, unknown> | null;
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
		// NOTE: headOidNow/treeOidNow/filteredSubjectTreeOidNow are the
		// PRODUCER's current repository identity, NOT the bundle's
		// recorded OIDs. The bundled OIDs participate only via the
		// object-existence checks and recorded-head-to-recorded-tree
		// derivation above. This is the µC-3 P0-4 fix.
		view = checkEvidence({
			ev,
			hashesText,
			evDirAbs: bundleDir,
			executedCmds: verificationBundle?.executed_commands ?? evidenceCommands,
			bundledResultPath: "verification-results.json",
			rootAbs: ctx.repoRoot,
			headOidNow: ctx.headOid,
			treeOidNow: ctx.treeOid,
			filteredSubjectTreeOidNow: ctx.subjectTreeOid,
			executionIdentityDerivation: identityDerivation,
		});
	} catch (e) {
		return {
			...dispose,
			bundle_dir_exists: true,
			disposition: `bundle malformed (checkEvidence threw: ${(e as Error).message})`,
			diagnostics: [(e as Error).message],
			closure_assessment: {
				is_closed: false,
				satisfied: [],
				missing: ["check_evidence_threw"],
			},
		};
	}
	const closureInput = buildParentClosureInput(view, evObj);
	const closureAssessment = assessParentClosure(closureInput);
	const diagnostics: string[] = [];
	diagnostics.push(`subject_tree_ok=${view.subjectTreeComputationOk}`);
	diagnostics.push(`execution_identity_valid=${view.executionIdentityValid}`);
	diagnostics.push(`bundled_result_command_set_exact=${view.bundledResultCommandSetExact}`);
	diagnostics.push(`native_probes_complete=${view.nativeProbesComplete}`);
	diagnostics.push(`bundle_matches_current_head=${bundledHead === ctx.headOid}`);
	diagnostics.push(`bundle_matches_current_tree=${bundledTree === ctx.treeOid}`);
	diagnostics.push(`closure_missing=${closureAssessment.missing.join("|")}`);
	const structurallyValid = isEvidenceStructurallyValid(view);
	// Verdict mapping — µC-3 P0-6: CLOSED requires the full closure
	// conjunction, not just structural evidence integrity.
	let verdict: "CLOSED" | "OPEN" | "PARTIAL";
	let disposition: string;
	if (closureAssessment.is_closed) {
		verdict = "CLOSED";
		disposition = "production runner pass; full parent closure conjunction satisfied";
	} else if (structurallyValid) {
		verdict = "PARTIAL";
		disposition = `bundle structurally valid; parent closure open: ${closureAssessment.missing.join(", ")}`;
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
		bundle_complete: closureAssessment.is_closed,
		bundle_structurally_valid: structurallyValid,
		closure_assessment: closureAssessment,
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

/**
 * Names of checks that have weaker authority — their failure does not
 * flip a passing scope to OPEN. Authoritative gates (`strict_typecheck`,
 * `working_tree_cleanliness`, `range_patch_cleanliness`, etc.) bind the
 * closure. The range-hygiene check is *now* authoritative — see P0-7.
 */
export const SUPPLEMENTAL_CHECK_NAMES: ReadonlySet<string> = new Set([
	// None — µC-3 round 5: every check is required. Reserved for
	// opt-in downgrades in future work.
]);

export function deriveScopeStatus(checks: GateCheckSummary[]): {
	status: ScopeStatus;
	disposition: string;
} {
	const requiredScopeChecks = checks.filter(
		(c) => !SUPPLEMENTAL_CHECK_NAMES.has(c.name),
	);
	const micro3 = requiredScopeChecks.filter((c) => c.scope === "MICROC3");
	const worktree = requiredScopeChecks.filter((c) => c.scope === "WORKTREE");
	const tooling = requiredScopeChecks.filter((c) => c.scope === "TOOLING");
	const scopeChecks = [...micro3, ...worktree, ...tooling];
	if (worktree.some((c) => c.status === "fail")) {
		return { status: "OPEN", disposition: "required WORKTREE check failed" };
	}
	if (scopeChecks.some((c) => c.status === "fail")) {
		return { status: "OPEN", disposition: "MICROC3/WORKTREE/TOOLING check failed" };
	}
	if (scopeChecks.some((c) => c.status === "unavailable")) {
		return { status: "OPEN", disposition: "MICROC3/WORKTREE/TOOLING check unavailable" };
	}
	if (scopeChecks.length === 0) {
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
export function deriveOverallDisposition(overall: OverallStatus): string {
	if (overall === "pass") return "all gates pass";
	if (overall === "unavailable") return "one or more checks unavailable";
	return "one or more checks failed";
}

/**
 * Serialize a `GateSummary` to its canonical v2 disk form.
 */
export function serializeGateSummary(summary: GateSummary): string {
	return `${JSON.stringify(summary, null, "\t")}\n`;
}

/**
 * Serialize a `GateSummaryExtended` to its canonical disk form.
 */
export function serializeExtended(extended: GateSummaryExtended): string {
	return `${JSON.stringify(extended, null, "\t")}\n`;
}

/**
 * Serialize a `LeamasAttestation` to its canonical disk form. Lives in
 * `.factory/gate-summary.leamas.json` after atomic publication.
 */
export function serializeLeamasAttestation(attestation: LeamasAttestation): string {
	return `${JSON.stringify(attestation, null, "\t")}\n`;
}




// ---------- summary construction (testable) -------------------------------

/**
 * Pure builder. The producer calls this exactly once after every check
 * has executed and the second identity snapshot has been captured. The
 * returned `GateSummary` satisfies the v2 schema because it carries
 * only documented fields — `tool`, `identity_stable`, `parent_act_state`,
 * `rejection_reasons`, the leamas attestation, and the closure
 * requirement flags all live in sibling files instead.
 */
export function buildFinalSummary(args: {
	generatedAt: string;
	scopeId: string;
	scopeStatus: ScopeStatus;
	scopeDisposition: string;
	parentAct: string;
	parentStatus: ScopeStatus;
	parentDisposition: string;
	overallStatus: OverallStatus;
	overallDisposition: string;
	executionHeadOid: string;
	executionTreeOid: string;
	subjectTreeOid: string;
	worktreeCleanBefore: boolean;
	worktreeCleanAfter: boolean;
	checks: GateCheckSummary[];
}): GateSummary {
	return {
		schema_version: 2,
		generated_at: args.generatedAt,
		scope_id: args.scopeId,
		scope_status: args.scopeStatus,
		scope_disposition: args.scopeDisposition,
		parent_act: args.parentAct,
		parent_status: args.parentStatus,
		parent_disposition: args.parentDisposition,
		overall_status: args.overallStatus,
		overall_disposition: args.overallDisposition,
		execution_head_oid: args.executionHeadOid,
		execution_tree_oid: args.executionTreeOid,
		subject_tree_oid: args.subjectTreeOid,
		worktree_clean_before: args.worktreeCleanBefore,
		worktree_clean_after: args.worktreeCleanAfter,
		checks: args.checks,
	};
}

/**
 * Pure builder for the extended sibling file. Tool identity, identity
 * stability, the parent-state closure assessment (with R4-R16 +
 * mandatory/affected/native breakdown), the rejection reasons, and the
 * known-valid / known-invalid fixture repo SHAs all live here. None of
 * these are part of the v2 schema and all of them must be absent from
 * the canonical v2 file Leamas ingests.
 */
export interface ExtendedArgs {
	tool: { name: string; version: string };
	identityStable: boolean;
	parentActState: ParentActState;
	rejectionReasons: ReasonCode[];
	knownValidV2RepoSha256: string;
	knownInvalidV3RepoSha256: string;
	candidateRepoSha256?: string;
}

export function buildExtended(args: ExtendedArgs): GateSummaryExtended {
	const out: GateSummaryExtended = {
		tool: args.tool,
		identity_stable: args.identityStable,
		parent_act_state: args.parentActState,
		rejection_reasons: args.rejectionReasons,
		known_valid_v2_repo_sha256: args.knownValidV2RepoSha256,
		known_invalid_v3_repo_sha256: args.knownInvalidV3RepoSha256,
	};
	if (args.candidateRepoSha256) {
		out.candidate_repo_sha256 = args.candidateRepoSha256;
	}
	return out;
}

/**
 * In-process structural validation the producer runs against the staged
 * summary BEFORE the atomic swap. Catches the same kind of defects
 * Leamas would catch (missing required fields, wrong enum values,
 * unexpected keys, hash-format drift) at the moment when a rollback
 * would still be cheap. Leamas itself remains the source of truth for
 * the v2 contract; this helper exists so the swap cannot publish a
 * document that obviously fails validation.
 */
export function validateGateSummaryStructure(summary: unknown): {
	ok: boolean;
	errors: string[];
} {
	const errors: string[] = [];
	if (typeof summary !== "object" || summary === null) {
		return { ok: false, errors: ["summary not an object"] };
	}
	const s = summary as Record<string, unknown>;
	if (s.schema_version !== 2) errors.push(`schema_version must be 2, got ${s.schema_version}`);
	for (const key of [
		"generated_at",
		"scope_id",
		"scope_status",
		"scope_disposition",
		"parent_act",
		"parent_status",
		"parent_disposition",
		"overall_status",
		"overall_disposition",
		"execution_head_oid",
		"execution_tree_oid",
		"subject_tree_oid",
	]) {
		if (typeof s[key] !== "string" || (s[key] as string).length === 0) {
			errors.push(`missing or empty string field: ${key}`);
		}
	}
	if (s.worktree_clean_before !== true && s.worktree_clean_before !== false) {
		errors.push(`worktree_clean_before must be boolean`);
	}
	if (s.worktree_clean_after !== true && s.worktree_clean_after !== false) {
		errors.push(`worktree_clean_after must be boolean`);
	}
	for (const enumField of ["scope_status", "parent_status"]) {
		const v = s[enumField];
		if (v !== "CLOSED" && v !== "OPEN" && v !== "PARTIAL") {
			errors.push(`${enumField} must be CLOSED|OPEN|PARTIAL, got ${v}`);
		}
	}
	if (s.overall_status !== "pass" && s.overall_status !== "fail" && s.overall_status !== "unavailable") {
		errors.push(`overall_status must be pass|fail|unavailable, got ${s.overall_status}`);
	}
	for (const oidField of ["execution_head_oid", "execution_tree_oid", "subject_tree_oid"]) {
		const v = s[oidField];
		if (typeof v !== "string" || !OID_PATTERN.test(v as string)) {
			errors.push(`${oidField} must be 40-char hex OID, got ${v}`);
		}
	}
	if (!Array.isArray(s.checks)) {
		errors.push(`checks must be an array`);
	} else {
		for (const [i, check] of s.checks.entries()) {
			const c = check as Record<string, unknown>;
			if (typeof c?.name !== "string") errors.push(`checks[${i}].name must be string`);
			if (typeof c?.scope !== "string") errors.push(`checks[${i}].scope must be string`);
			if (c?.status !== "pass" && c?.status !== "fail" && c?.status !== "unavailable") {
				errors.push(`checks[${i}].status invalid`);
			}
		}
	}
	// Reject any producer-extension keys in the v2 summary. The canonical
	// v2 contract is enum-closed; additional keys would cause Leamas to
	// reject the document or (worse) silently mutate its digest.
	for (const key of Object.keys(s)) {
		const allowed = new Set([
			"schema_version",
			"generated_at",
			"scope_id",
			"scope_status",
			"scope_disposition",
			"parent_act",
			"parent_status",
			"parent_disposition",
			"overall_status",
			"overall_disposition",
			"execution_head_oid",
			"execution_tree_oid",
			"subject_tree_oid",
			"worktree_clean_before",
			"worktree_clean_after",
			"checks",
		]);
		if (!allowed.has(key)) {
			errors.push(`unexpected key in v2 summary: ${key}`);
		}
	}
	return { ok: errors.length === 0, errors };
}

/**
 * Convert an absolute filesystem path into a portable POSIX-style
 * segment for the gate bundle. Helpers like `persistCheckStreams` and
 * `atomicPublish` use this so detached evidence survives a different
 * host layout.
 */
export function toPortablePath(absPath: string): string {
	return absPath.replaceAll("\\", "/");
}

// Suppress unused warnings for the helper signatures used by the producer.
void dirname;
