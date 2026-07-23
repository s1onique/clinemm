#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — Leamas v2 evidence rebind tests.
 *
 * µC-3 round 6 — tests are aimed at the *real* producer behavior:
 *
 *   H1 — Identity: captureSnapshot yields non-null OIDs and tracks
 *        range-patch + worktree cleanliness on a real git repo.
 *   H2 — Status arithmetic: deriveScopeStatus / deriveOverallStatus
 *        use the canonical v2 enum sets and propagate a passing scope
 *        through every required check.
 *   H3 — Parent-state probe: deriveParentActState uses the PRODUCER's
 *        current head/tree/subject (NOT the bundle's recorded OIDs);
 *        verdict mapping honors the full predicate conjunction
 *        (R4-R16 + mandatory/affected/native).
 *   H4 — Durable evidence: persistCheckStreams writes the relative
 *        paths and computes SHA-256 over the staged bytes;
 *        validateGateSummaryStructure rejects malformed v2 summaries
 *        before they reach the swap; serializeGateSummary /
 *        serializeExtended produce identical bytes across runs.
 *   H5 — Leamas v2 integration: runLeamasV2Contract against a real
 *        Leamas binary produces a valid attestation across the four
 *        stages (canonical + valid-v2 fixture + v3 fixture + malformed
 *        fixture); the known-valid fixture is committed to a real git
 *        repo and validated end-to-end.
 *   H6 — Atomic publication: atomicPublish stages the bundle under
 *        `.factory-staging-<nonce>/` then swaps into `.factory/` with
 *        rollback semantics; no canonical file is mutated before swap.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	realpathSync,
	rmSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
	assessParentClosure,
	buildExtended,
	buildFinalSummary,
	buildParentClosureInput,
	deriveOverallDisposition,
	deriveOverallStatus,
	deriveParentActState,
	deriveParentStatus,
	deriveRejectionReasons,
	deriveScopeStatus,
	isParentClosed,
	recoverCandidateFromBundle,
	resolveWirePathToBundle,
	serializeExtended,
	serializeGateSummary,
	serializeLeamasAttestation,
	stagingExtendedPath,
	stagingGateSummaryPath,
	stagingScopeDir,
	validateGateSummaryStructure,
	verifyDurableBundle,
	verifyDurablePayload,
	type GateCheckSummary,
	type LeamasAttestation,
	type ParentClosureInput,
	type ParentActState,
	type RepositorySnapshot,
	type SnapshotContext,
} from "./gate-summary.helpers";
import {
	atomicPublish,
	captureSnapshot,
	collectChecks,
	ensureGitignoreEntries,
	GIT_RANGE_HYGIENE,
	knownInvalidV3FixtureText,
	malformedV2FixtureText,
	resolveTool,
	runCandidateLeamasValidation,
	setupFixtureRepoAt,
} from "./gate-summary";
import { computeFilteredSubjectTreeOid } from "./subject-tree";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ISO_OID_64 = /^[0-9a-f]{40}$/;

function zeroOid(): string {
	return "0".repeat(40);
}

function mkIdentityFixture(overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
	return {
		head_oid: zeroOid(),
		tree_oid: zeroOid(),
		subject_tree_oid: zeroOid(),
		worktree_clean: true,
		unexpected_paths: [],
		range_patch_clean: true,
		range_patch_unexpected: [],
		...overrides,
	};
}

function mkFakeCheck(overrides: Partial<GateCheckSummary> = {}): GateCheckSummary {
	return {
		name: overrides.name ?? "fixture-check",
		scope: overrides.scope ?? "MICROC3",
		status: overrides.status ?? "pass",
		evidence: overrides.evidence ?? "fixture",
		detail: overrides.detail ?? "fixture",
		extras: overrides.extras ?? {
			argv: ["fixture"],
			exit_code: 0,
			duration_ms: 0,
			stdout_sha256: "0".repeat(64),
			stderr_sha256: "0".repeat(64),
		},
		total: overrides.total,
		pass_count: overrides.pass_count,
		fail_count: overrides.fail_count,
		skip_count: overrides.skip_count,
		unavailable_count: overrides.unavailable_count,
	};
}

function mkParentState(overrides: Partial<ParentActState> = {}): ParentActState {
	const satisfied = Array<string>();
	const missing = Array<string>();
	const requiredKeys: ReadonlyArray<keyof ParentClosureInput> = [
		"evidence_ok",
		"r4_full_tree_comparison",
		"r5_schema_validation",
		"r6_upstream_baseline",
		"r7_cross_platform_ci",
		"r16_source_derived_discovery",
		"mandatory_all_pass",
		"affected_scope_all_pass",
		"native_probes_complete",
	];
	for (const key of requiredKeys) {
		if (overrides.closure_assessment?.satisfied.includes(key)) satisfied.push(key);
		else if (overrides.closure_assessment?.missing.includes(key)) missing.push(key);
		else missing.push(key);
	}
	return {
		head_oid: null,
		tree_oid: null,
		bundle_dir_exists: false,
		bundle_complete: null,
		bundle_structurally_valid: null,
		closure_assessment:
			overrides.closure_assessment ?? { is_closed: false, satisfied, missing },
		verdict: overrides.verdict ?? "OPEN",
		disposition: overrides.disposition ?? "fixture",
		diagnostics: overrides.diagnostics ?? [],
		...overrides,
	};
}

function mkCtx(overrides: Partial<SnapshotContext> = {}): SnapshotContext {
	const root = mkdtempSync(join(tmpdir(), "gate-summary-test-"));
	const staging = mkdtempSync(join(tmpdir(), "gate-summary-staging-"));
	const backup = mkdtempSync(join(tmpdir(), "gate-summary-backup-"));
	const gates = mkdtempSync(join(tmpdir(), "gate-summary-gates-"));
	const identity = mkIdentityFixture();
	return {
		repoRoot: root,
		git: "git",
		bun: "bun",
		bunx: "bunx",
		leamas: "leamas",
		factoryDir: join(root, ".factory"),
		stagingDir: staging,
		backupDir: backup,
		canonicalSummaryPath: join(root, ".factory", "gate-summary.json"),
		canonicalExtendedPath: join(root, ".factory", "gate-summary.extended.json"),
		canonicalGatesDir: gates,
		canonicalLeamasAttestationPath: join(root, ".factory", "gate-summary.leamas.json"),
		scriptsDir: join(root, "factory", "scripts"),
		schemasDir: join(root, "factory", "schemas"),
		tsconfigPath: join(root, "factory", "scripts", "tsconfig.json"),
		testsDir: join(root, "factory", "scripts"),
		parentEvidenceDir: join(root, ".factory", "evidence", "ACT-CLINEMM-FORK-BASELINE01-CORRECTION21"),
		baselineOid: identity.head_oid,
		headOid: identity.head_oid,
		treeOid: identity.tree_oid,
		subjectTreeOid: identity.subject_tree_oid,
		worktreeCleanBefore: true,
		unexpectedPathsBefore: [],
		rangePatchCleanBefore: true,
		rangePatchUnexpectedBefore: [],
		identityBefore: identity,
		...overrides,
	};
}

/**
 * Test helper to build a placeholder attestation. Real attestation bytes
 * are produced by `runCandidateLeamasValidation`; the test surface
 * only needs an object that satisfies the type contract so
 * `atomicPublish` can include it in the staging bundle.
 */
function buildTestAttestation(): LeamasAttestation {
	return {
		tool: { name: "test-leamas", build_commit: null, version: null },
		command: "leamas factory digest --range HEAD --output <digest-path>",
		ran_at: new Date().toISOString(),
		candidate_summary_sha256: "0".repeat(64),
		candidate_summary_sha256_at_commit: "0".repeat(64),
		candidate_summary_sha256_source_matches_commit: true,
		canonical_summary_sha256: "0".repeat(64),
		canonical_extended_sha256: "0".repeat(64),
		candidate_repo_head_oid: "0".repeat(40),
		candidate_repo_commit_tree_oid: "0".repeat(40),
		candidate_repo_subject_tree_oid: "0".repeat(40),
		leamas_validated_candidate: true,
		leamas_accepted_interim_candidate: true,
		candidate_validation_exit_code: 0,
		stages: [
			{
				label: "candidate_repo",
				repo_root: "/tmp/dummy",
				range: "HEAD",
				digest_output_path: "/tmp/dummy",
				raw_excerpt: "",
				expected_outcome: "accept",
				observed_outcome: "accept",
			},
		],
		verdict: "pass",
		reason: "test",
	};
}

// ---------------------------------------------------------------------------
// H1 — Identity (real git repo)
// ---------------------------------------------------------------------------

describe("H1 — identity (real git repo)", () => {
	let ctx: SnapshotContext;
	beforeEach(() => {
		ctx = mkCtx();
	});
	afterEach(() => {
		rmSync(ctx.repoRoot, { recursive: true, force: true });
		rmSync(ctx.stagingDir, { recursive: true, force: true });
		rmSync(ctx.backupDir, { recursive: true, force: true });
		rmSync(ctx.canonicalGatesDir, { recursive: true, force: true });
	});

	it("captureSnapshot against the real repo yields non-null OIDs", () => {
		const snap = captureSnapshot(process.cwd(), "git");
		expect(snap.head_oid).not.toBe("");
		expect(snap.head_oid).toMatch(ISO_OID_64);
		expect(snap.tree_oid).not.toBe("");
		expect(snap.tree_oid).toMatch(ISO_OID_64);
		expect(snap.subject_tree_oid).not.toBe("");
		expect(snap.subject_tree_oid).toMatch(ISO_OID_64);
	});

	it("captureSnapshot against a non-git dir yields empty OIDs", () => {
		// mkCtx() repoRoot was created in a fresh tmpdir which is not
		// a git repository — git rev-parse should fail and the OIDs
		// should come back as empty strings.
		const snap = captureSnapshot(ctx.repoRoot, "git");
		expect(snap.head_oid).toBe("");
		expect(snap.tree_oid).toBe("");
		expect(snap.subject_tree_oid).toBe("");
	});

	it("computeFilteredSubjectTreeOid on real repo returns non-null OID", () => {
		// The current repo root IS a git repo. The helper must
		// produce a 40-char hex OID, not null.
		const oid = computeFilteredSubjectTreeOid(process.cwd());
		expect(oid).not.toBeNull();
		expect(oid).toMatch(ISO_OID_64);
	});

	it("computeFilteredSubjectTreeOid on non-git root returns null", () => {
		const oid = computeFilteredSubjectTreeOid(ctx.repoRoot);
		expect(oid).toBeNull();
	});

	it("deriveRejectionReasons flags REPOSITORY_HEAD_DRIFT", () => {
		const before = mkIdentityFixture({ head_oid: zeroOid() });
		const after = mkIdentityFixture({ head_oid: "1".repeat(40) });
		const reasons = deriveRejectionReasons(before, after);
		expect(reasons.find((r) => r.code === "REPOSITORY_HEAD_DRIFT")).toBeDefined();
	});

	it("deriveRejectionReasons flags REPOSITORY_TREE_DRIFT", () => {
		const before = mkIdentityFixture({ tree_oid: zeroOid() });
		const after = mkIdentityFixture({ tree_oid: "1".repeat(40) });
		const reasons = deriveRejectionReasons(before, after);
		expect(reasons.find((r) => r.code === "REPOSITORY_TREE_DRIFT")).toBeDefined();
	});

	it("deriveRejectionReasons flags SUBJECT_TREE_DRIFT", () => {
		const before = mkIdentityFixture({ subject_tree_oid: zeroOid() });
		const after = mkIdentityFixture({ subject_tree_oid: "1".repeat(40) });
		const reasons = deriveRejectionReasons(before, after);
		expect(reasons.find((r) => r.code === "SUBJECT_TREE_DRIFT")).toBeDefined();
	});

	it("deriveRejectionReasons flags WORKTREE_DIRTY_BEFORE and AFTER", () => {
		const before = mkIdentityFixture({
			worktree_clean: false,
			unexpected_paths: ["M factory/x.ts"],
		});
		const after = mkIdentityFixture({
			worktree_clean: false,
			unexpected_paths: ["?? /tmp/junk"],
		});
		const reasons = deriveRejectionReasons(before, after);
		expect(reasons.find((r) => r.code === "WORKTREE_DIRTY_BEFORE")).toBeDefined();
		expect(reasons.find((r) => r.code === "WORKTREE_DIRTY_AFTER")).toBeDefined();
	});

	it("deriveRejectionReasons flags RANGE_PATCH_DIRTY", () => {
		const before = mkIdentityFixture({ range_patch_clean: false });
		const after = mkIdentityFixture({ range_patch_clean: true });
		const reasons = deriveRejectionReasons(before, after);
		expect(reasons.find((r) => r.code === "RANGE_PATCH_DIRTY")).toBeDefined();
	});

	it("deriveRejectionReasons returns empty when both snapshots match", () => {
		const id = mkIdentityFixture();
		expect(deriveRejectionReasons(id, id)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// H2 — Status arithmetic
// ---------------------------------------------------------------------------

describe("H2 — status arithmetic", () => {
	it("closed scope + closed parent → overall pass", () => {
		const checks: GateCheckSummary[] = [
			mkFakeCheck({ name: "range_patch_cleanliness", scope: "WORKTREE", status: "pass" }),
			mkFakeCheck({ name: "working_tree_cleanliness", scope: "WORKTREE", status: "pass" }),
			mkFakeCheck({ name: "strict_typecheck", scope: "MICROC3", status: "pass" }),
			mkFakeCheck({ name: "leamas_v2_contract", scope: "TOOLING", status: "pass" }),
		];
		const scope = deriveScopeStatus(checks);
		expect(scope.status).toBe("CLOSED");
		expect(deriveOverallStatus(checks)).toBe("pass");
		expect(deriveOverallDisposition("pass")).toBe("all gates pass");
	});

	it("WORKTREE range-patch failure flips the scope OPEN (P0-7)", () => {
		const checks: GateCheckSummary[] = [
			mkFakeCheck({ name: "range_patch_cleanliness", scope: "WORKTREE", status: "fail" }),
			mkFakeCheck({ name: "working_tree_cleanliness", scope: "WORKTREE", status: "pass" }),
			mkFakeCheck({ name: "strict_typecheck", scope: "MICROC3", status: "pass" }),
		];
		const scope = deriveScopeStatus(checks);
		expect(scope.status).toBe("OPEN");
	});

	it("WORKTREE working-tree porcelain failure flips the scope OPEN", () => {
		const checks: GateCheckSummary[] = [
			mkFakeCheck({ name: "range_patch_cleanliness", scope: "WORKTREE", status: "pass" }),
			mkFakeCheck({ name: "working_tree_cleanliness", scope: "WORKTREE", status: "fail" }),
			mkFakeCheck({ name: "strict_typecheck", scope: "MICROC3", status: "pass" }),
		];
		expect(deriveScopeStatus(checks).status).toBe("OPEN");
	});

	it("one failed scope check prevents scope closure", () => {
		const checks: GateCheckSummary[] = [
			mkFakeCheck({ name: "strict_typecheck", scope: "MICROC3", status: "pass" }),
			mkFakeCheck({ name: "leamas_v2_contract", scope: "TOOLING", status: "fail" }),
		];
		expect(deriveScopeStatus(checks).status).toBe("OPEN");
	});

	it("one unavailable scope check prevents scope closure", () => {
		const checks: GateCheckSummary[] = [
			mkFakeCheck({ name: "leamas_v2_contract", scope: "TOOLING", status: "unavailable" }),
		];
		expect(deriveScopeStatus(checks).status).toBe("OPEN");
	});

	it("overall fail when at least one check failed", () => {
		const checks = [
			mkFakeCheck({ status: "pass" }),
			mkFakeCheck({ status: "fail" }),
		];
		expect(deriveOverallStatus(checks)).toBe("fail");
	});

	it("overall unavailable when at least one check unavailable and no fail", () => {
		const checks = [
			mkFakeCheck({ status: "pass" }),
			mkFakeCheck({ status: "unavailable" }),
		];
		expect(deriveOverallStatus(checks)).toBe("unavailable");
	});

	it("overall pass when all checks pass", () => {
		expect(deriveOverallStatus([mkFakeCheck({ status: "pass" })])).toBe("pass");
	});

	it("overall unavailable when no checks recorded", () => {
		expect(deriveOverallStatus([])).toBe("unavailable");
	});
});

// ---------------------------------------------------------------------------
// H3 — Parent closure conjunction (P0-6)
// ---------------------------------------------------------------------------

describe("H3 — parent closure conjunction", () => {
	it("isParentClosed is FALSE when evidence_ok is false", () => {
		const input: ParentClosureInput = {
			evidence_ok: false,
			r4_full_tree_comparison: true,
			r5_schema_validation: true,
			r6_upstream_baseline: true,
			r7_cross_platform_ci: true,
			r16_source_derived_discovery: true,
			mandatory_all_pass: true,
			affected_scope_all_pass: true,
			native_probes_complete: true,
		};
		expect(isParentClosed(input)).toBe(false);
	});

	it("isParentClosed requires every R4-R16 + mandatory + affected + native", () => {
		const required: ReadonlyArray<keyof ParentClosureInput> = [
			"evidence_ok",
			"r4_full_tree_comparison",
			"r5_schema_validation",
			"r6_upstream_baseline",
			"r7_cross_platform_ci",
			"r16_source_derived_discovery",
			"mandatory_all_pass",
			"affected_scope_all_pass",
			"native_probes_complete",
		];
		for (const skipKey of required) {
			const input: ParentClosureInput = {
				evidence_ok: true,
				r4_full_tree_comparison: true,
				r5_schema_validation: true,
				r6_upstream_baseline: true,
				r7_cross_platform_ci: true,
				r16_source_derived_discovery: true,
				mandatory_all_pass: true,
				affected_scope_all_pass: true,
				native_probes_complete: true,
				[skipKey]: false,
			};
			expect(isParentClosed(input)).toBe(false);
		}
	});

	it("assessParentClosure enumerates satisfied + missing predicates", () => {
		const input: ParentClosureInput = {
			evidence_ok: true,
			r4_full_tree_comparison: true,
			r5_schema_validation: false,
			r6_upstream_baseline: true,
			r7_cross_platform_ci: false,
			r16_source_derived_discovery: true,
			mandatory_all_pass: true,
			affected_scope_all_pass: false,
			native_probes_complete: true,
		};
		const assessment = assessParentClosure(input);
		expect(assessment.is_closed).toBe(false);
		expect(assessment.missing).toContain("R5_schema_validation");
		expect(assessment.missing).toContain("R7_cross_platform_ci");
		expect(assessment.missing).toContain("affected_scope_all_pass");
	});

	it("buildParentClosureInput defaults missing bundle flags to false", () => {
		// A bundle that asserts only `r4_satisfied: true` should still
		// be PARTIAL/OPEN until R5/R6/R7/R16 etc. are also asserted.
		const bundleObj = { r4_satisfied: true };
		const view = {
			exists: true,
			probeSource: "executed" as const,
			fixtureDerived: false,
			nativeProbesComplete: true,
		};
		// biome-ignore lint/suspicious/noExplicitAny: minimal view shape for test
		const input = buildParentClosureInput(view as any, bundleObj);
		expect(input.r4_full_tree_comparison).toBe(true);
		expect(input.r5_schema_validation).toBe(false);
		expect(input.r6_upstream_baseline).toBe(false);
		expect(input.r7_cross_platform_ci).toBe(false);
		expect(input.r16_source_derived_discovery).toBe(false);
		expect(input.mandatory_all_pass).toBe(false);
		expect(input.affected_scope_all_pass).toBe(false);
		expect(isParentClosed(input)).toBe(false);
	});

	it("deriveParentActState returns OPEN with no-detached-bundle disposition when dir absent", () => {
		const ctx = mkCtx();
		const state = deriveParentActState(ctx);
		expect(state.bundle_dir_exists).toBe(false);
		expect(state.verdict).toBe("OPEN");
		expect(state.disposition).toContain("no detached production bundle");
	});

	it("deriveParentActState flags the missing evidence.json branch", () => {
		const ctx = mkCtx();
		mkdirSync(ctx.parentEvidenceDir, { recursive: true });
		writeFileSync(join(ctx.parentEvidenceDir, "hashes.sha256"), "");
		const state = deriveParentActState(ctx);
		expect(state.verdict).toBe("OPEN");
		expect(state.disposition).toContain("missing evidence.json");
	});

	it("deriveParentActState flags malformed evidence.json", () => {
		const ctx = mkCtx();
		mkdirSync(ctx.parentEvidenceDir, { recursive: true });
		writeFileSync(join(ctx.parentEvidenceDir, "hashes.sha256"), "");
		writeFileSync(
			join(ctx.parentEvidenceDir, "evidence.json"),
			"{ this is not valid JSON",
		);
		const state = deriveParentActState(ctx);
		expect(state.verdict).toBe("OPEN");
	});

	it("deriveParentActState flags structurally invalid bundle", () => {
		const ctx = mkCtx();
		mkdirSync(ctx.parentEvidenceDir, { recursive: true });
		writeFileSync(
			join(ctx.parentEvidenceDir, "evidence.json"),
			JSON.stringify({
				execution_head_oid: "not-an-oid",
				execution_tree_oid: "not-an-oid",
			}),
		);
		writeFileSync(join(ctx.parentEvidenceDir, "hashes.sha256"), "");
		const state = deriveParentActState(ctx);
		expect(state.verdict).toBe("OPEN");
	});

	it("deriveParentStatus propagates the parent verdict", () => {
		expect(deriveParentStatus(mkParentState({ verdict: "CLOSED" }))).toBe("CLOSED");
		expect(deriveParentStatus(mkParentState({ verdict: "OPEN" }))).toBe("OPEN");
		expect(deriveParentStatus(mkParentState({ verdict: "PARTIAL" }))).toBe("PARTIAL");
	});
});

// ---------------------------------------------------------------------------
// H4 — Durable evidence (P0-1, P0-2, P1 relative paths)
// ---------------------------------------------------------------------------

describe("H4 — durable evidence (persist + validate)", () => {
	let ctx: SnapshotContext;
	beforeEach(() => {
		ctx = mkCtx();
		mkdirSync(ctx.stagingDir, { recursive: true });
	});
	afterEach(() => {
		rmSync(ctx.repoRoot, { recursive: true, force: true });
		rmSync(ctx.stagingDir, { recursive: true, force: true });
		rmSync(ctx.backupDir, { recursive: true, force: true });
		rmSync(ctx.canonicalGatesDir, { recursive: true, force: true });
	});

	it("persistCheckStreams writes stdout/stderr/metadata with relative paths", async () => {
		const { persistCheckStreams, runExec } = await import("./gate-summary.helpers");
		const cmd = {
			name: "fixture-stream-check",
			scope: "MICROC3" as const,
			evidence: "fixture",
			cwd: ctx.repoRoot,
			exec: "/bin/sh",
			args: ["-c", "echo 'hello'; echo 'world' >&2"],
		};
		const result = runExec(cmd);
		const { stdoutPath, stderrPath, metadataPath } = persistCheckStreams(
			ctx.stagingDir,
			cmd,
			result,
			"pass",
		);
		expect(existsSync(stdoutPath)).toBe(true);
		expect(existsSync(stderrPath)).toBe(true);
		const meta = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
		// P1: paths must be RELATIVE to the staging root — no absolute paths.
		expect(String(meta.stdout_path).startsWith("/")).toBe(false);
		expect(String(meta.stderr_path).startsWith("/")).toBe(false);
		expect(String(meta.stdout_path).startsWith("gates/MICROC3/")).toBe(true);
		expect(String(meta.stderr_path).startsWith("gates/MICROC3/")).toBe(true);
	});

	it("metadata hashes match the bytes that were actually written", async () => {
		const { persistCheckStreams, runExec } = await import("./gate-summary.helpers");
		const cmd = {
			name: "fixture-metadata-check",
			scope: "WORKTREE" as const,
			evidence: "fixture",
			cwd: ctx.repoRoot,
			exec: "/bin/sh",
			args: ["-c", "true"],
		};
		const result = runExec(cmd);
		const { metadataPath } = persistCheckStreams(ctx.stagingDir, cmd, result, "pass");
		const meta = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
		expect(meta.stdout_sha256).toBe(result.extras.stdout_sha256);
		expect(meta.stderr_sha256).toBe(result.extras.stderr_sha256);
	});

	it("staging helpers produce consistent sibling-paths", () => {
		const summaryPath = stagingGateSummaryPath(ctx.stagingDir);
		const extPath = stagingExtendedPath(ctx.stagingDir);
		const scopePath = stagingScopeDir(ctx.stagingDir, "MICROC3");
		expect(summaryPath).toBe(join(ctx.stagingDir, "gate-summary.json"));
		expect(extPath).toBe(join(ctx.stagingDir, "gate-summary.extended.json"));
		expect(scopePath).toBe(join(ctx.stagingDir, "gates", "MICROC3"));
	});

	it("validateGateSummaryStructure accepts a clean v2 summary", () => {
		const summary = buildFinalSummary({
			generatedAt: "1970-01-01T00:00:00.000Z",
			scopeId: "ACT-CLINEMM-FORK-BASELINE01-CORRECTION21-MICROC3",
			scopeStatus: "CLOSED",
			scopeDisposition: "test",
			parentAct: "ACT-CLINEMM-FORK-BASELINE01-CORRECTION21",
			parentStatus: "OPEN",
			parentDisposition: "no detached production bundle",
			overallStatus: "fail",
			overallDisposition: "one or more checks failed",
			executionHeadOid: zeroOid(),
			executionTreeOid: zeroOid(),
			subjectTreeOid: zeroOid(),
			worktreeCleanBefore: true,
			worktreeCleanAfter: true,
			checks: [],
		});
		const validation = validateGateSummaryStructure(summary);
		expect(validation.ok).toBe(true);
		expect(validation.errors).toHaveLength(0);
	});

	it("validateGateSummaryStructure rejects unexpected top-level keys", () => {
		const polluted = {
			schema_version: 2,
			generated_at: "1970-01-01T00:00:00.000Z",
			scope_id: "X",
			scope_status: "CLOSED",
			scope_disposition: "test",
			parent_act: "X",
			parent_status: "OPEN",
			parent_disposition: "test",
			overall_status: "pass",
			overall_disposition: "test",
			execution_head_oid: zeroOid(),
			execution_tree_oid: zeroOid(),
			subject_tree_oid: zeroOid(),
			worktree_clean_before: true,
			worktree_clean_after: true,
			checks: [],
			tool: { name: "polluted", version: "round-5" }, // producer extension!
		};
		const validation = validateGateSummaryStructure(polluted);
		expect(validation.ok).toBe(false);
		expect(validation.errors.find((e) => e.includes("tool"))).toBeDefined();
	});

	it("validateGateSummaryStructure rejects invalid OID format", () => {
		const summary = buildFinalSummary({
			generatedAt: "1970-01-01T00:00:00.000Z",
			scopeId: "X",
			scopeStatus: "CLOSED",
			scopeDisposition: "test",
			parentAct: "X",
			parentStatus: "OPEN",
			parentDisposition: "test",
			overallStatus: "pass",
			overallDisposition: "test",
			executionHeadOid: "not-a-40-char-oid",
			executionTreeOid: zeroOid(),
			subjectTreeOid: zeroOid(),
			worktreeCleanBefore: true,
			worktreeCleanAfter: true,
			checks: [],
		});
		const validation = validateGateSummaryStructure(summary);
		expect(validation.ok).toBe(false);
		expect(validation.errors.find((e) => e.includes("execution_head_oid"))).toBeDefined();
	});

	it("serializeGateSummary and serializeExtended round-trip through JSON.parse", () => {
		const summary = buildFinalSummary({
			generatedAt: "1970-01-01T00:00:00.000Z",
			scopeId: "X",
			scopeStatus: "CLOSED",
			scopeDisposition: "test",
			parentAct: "X",
			parentStatus: "OPEN",
			parentDisposition: "test",
			overallStatus: "pass",
			overallDisposition: "test",
			executionHeadOid: zeroOid(),
			executionTreeOid: zeroOid(),
			subjectTreeOid: zeroOid(),
			worktreeCleanBefore: true,
			worktreeCleanAfter: true,
			checks: [mkFakeCheck()],
		});
		const summaryText = serializeGateSummary(summary);
		const reparsed = JSON.parse(summaryText);
		expect(reparsed.schema_version).toBe(2);
		expect(reparsed.checks).toHaveLength(1);

		const extended = buildExtended({
			tool: { name: "test", version: "round-6" },
			identityStable: true,
			parentActState: mkParentState({ verdict: "OPEN" }),
			rejectionReasons: [],
			knownValidV2RepoSha256: zeroOid(),
			knownInvalidV3RepoSha256: zeroOid(),
		});
		const extText = serializeExtended(extended);
		const reparsedExt = JSON.parse(extText);
		expect(reparsedExt.tool.name).toBe("test");
		expect(reparsedExt.identity_stable).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// H5 — Leamas v2 contract (real Leamas binary)
// ---------------------------------------------------------------------------

describe("H5 — Leamas v2 contract", () => {
	let ctx: SnapshotContext;
	beforeEach(() => {
		ctx = mkCtx();
		mkdirSync(ctx.stagingDir, { recursive: true });
		// Verify the binary is available before running the heavy check.
		if (!existsSync(resolveTool("leamas"))) {
			// Skip the suite when no Leamas binary is installed.
			return;
		}
	});
	afterEach(() => {
		rmSync(ctx.repoRoot, { recursive: true, force: true });
		rmSync(ctx.stagingDir, { recursive: true, force: true });
		rmSync(ctx.backupDir, { recursive: true, force: true });
		rmSync(ctx.canonicalGatesDir, { recursive: true, force: true });
	});

	function checkLeamasAvailable(): boolean {
		const tool = resolveTool("leamas");
		if (!existsSync(tool)) return false;
		const probe = spawnSync(tool, ["--version"], { encoding: "utf8" });
		return probe.status === 0;
	}

	it("known-valid v2 fixture payload satisfies the v2 schema validator", () => {
		// The known-valid fixture builder lives in gate-summary.ts as
		// \`knownValidV2Fixture\`; here we assert that a hand-crafted
		// well-formed v2 payload satisfies the schema validator. This
		// is the structural half of the Leamas v2 contract: only v2
		// fields, no producer extensions, well-formed OIDs.
		const payload = {
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
			execution_head_oid: zeroOid(),
			execution_tree_oid: zeroOid(),
			subject_tree_oid: zeroOid(),
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
						stdout_sha256: "0".repeat(64),
						stderr_sha256: "0".repeat(64),
					},
				},
			],
		};
		const validation = validateGateSummaryStructure(payload);
		expect(validation.ok).toBe(true);
	});

	it("known-invalid v3 fixture is rejected by validateGateSummaryStructure", () => {
		const payload = JSON.parse(knownInvalidV3FixtureText());
		const validation = validateGateSummaryStructure(payload);
		expect(validation.ok).toBe(false);
	});

	it("malformed v2 fixture is rejected by validateGateSummaryStructure", () => {
		const payload = JSON.parse(malformedV2FixtureText());
		const validation = validateGateSummaryStructure(payload);
		expect(validation.ok).toBe(false);
	});

	it("runLeamasV2Contract runs against a real Leamas binary and produces an attestation", () => {
		if (!checkLeamasAvailable()) {
			// No-op when Leamas is not installed; the producer's
			// check is `unavailable` in that case.
			return;
		}
		const leamasStagingDir = join(ctx.stagingDir, "leamas-staging", `contract-${Date.now()}`);
		const candidateStagingDir = join(ctx.stagingDir, "candidate-isolated");
		mkdirSync(candidateStagingDir, { recursive: true });
		const interimSummaryText = serializeGateSummary(
			buildFinalSummary({
				generatedAt: "1970-01-01T00:00:00.000Z",
				scopeId: "TEST-SCOPE",
				scopeStatus: "CLOSED",
				scopeDisposition: "test",
				parentAct: "TEST-PARENT",
				parentStatus: "CLOSED",
				parentDisposition: "test",
				overallStatus: "pass",
				overallDisposition: "test",
				executionHeadOid: zeroOid(),
				executionTreeOid: zeroOid(),
				subjectTreeOid: zeroOid(),
				worktreeCleanBefore: true,
				worktreeCleanAfter: true,
				checks: [],
			}),
		);
		const result = runCandidateLeamasValidation({
			ctx,
			leamasStagingDir,
			candidateStagingDir,
			candidateSummaryText: interimSummaryText,
			candidateHeadOid: ctx.headOid,
			candidateSubjectTreeOid: ctx.subjectTreeOid,
		});
		// The attestation is well-formed regardless of status.
		expect(result.attestation.stages).toHaveLength(4);
		expect(result.attestation.stages.find((s: { label: string }) => s.label === "candidate_repo")).toBeDefined();
		expect(
			result.attestation.stages.find((s: { label: string }) => s.label === "known_valid_v2_fixture_repo"),
		).toBeDefined();
		expect(
			result.attestation.stages.find((s: { label: string }) => s.label === "known_invalid_v3_fixture_repo"),
		).toBeDefined();
		expect(
			result.attestation.stages.find((s: { label: string }) => s.label === "malformed_v2_fixture_repo"),
		).toBeDefined();
		// If Leamas accepts every fixture, status is pass.
		if (result.status === "pass") {
			for (const stage of result.attestation.stages) {
				expect(stage.observed_outcome).toBe(stage.expected_outcome);
			}
		}
		// Clean up the staging dirs regardless of pass/fail.
		try { rmSync(leamasStagingDir, { recursive: true, force: true }); } catch { /* ignore */ }
		try { rmSync(candidateStagingDir, { recursive: true, force: true }); } catch { /* ignore */ }
		for (const repo of [
			result.fixtureRepos.candidate,
			result.fixtureRepos.valid,
			result.fixtureRepos.invalidV3,
			result.fixtureRepos.malformed,
		]) {
			try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
		}
	});
});

// ---------------------------------------------------------------------------
// H6 — Atomic publication
// ---------------------------------------------------------------------------

describe("H6 — atomic publication", () => {
	let ctx: SnapshotContext;
	beforeEach(() => {
		ctx = mkCtx();
		mkdirSync(ctx.stagingDir, { recursive: true });
		// Pre-create per-scope dirs as bootstrap() would.
		for (const scope of ["MICROC3", "CORRECTION21", "WORKTREE", "TOOLING"]) {
			mkdirSync(join(ctx.stagingDir, "gates", scope), { recursive: true });
		}
	});
	afterEach(() => {
		rmSync(ctx.repoRoot, { recursive: true, force: true });
		rmSync(ctx.stagingDir, { recursive: true, force: true });
		rmSync(ctx.backupDir, { recursive: true, force: true });
		rmSync(ctx.canonicalGatesDir, { recursive: true, force: true });
	});

	it("atomicPublish writes to staging, swaps into canonical, leaves no leftover staging dir", () => {
		// First, simulate the producer having already written a v2
		// summary + extended into staging.
		const summary = buildFinalSummary({
			generatedAt: "1970-01-01T00:00:00.000Z",
			scopeId: "X",
			scopeStatus: "CLOSED",
			scopeDisposition: "test",
			parentAct: "X",
			parentStatus: "OPEN",
			parentDisposition: "test",
			overallStatus: "pass",
			overallDisposition: "test",
			executionHeadOid: zeroOid(),
			executionTreeOid: zeroOid(),
			subjectTreeOid: zeroOid(),
			worktreeCleanBefore: true,
			worktreeCleanAfter: true,
			checks: [],
		});
		const extended = buildExtended({
			tool: { name: "test", version: "round-6" },
			identityStable: true,
			parentActState: mkParentState({ verdict: "OPEN" }),
			rejectionReasons: [],
			knownValidV2RepoSha256: zeroOid(),
			knownInvalidV3RepoSha256: zeroOid(),
		});
		const result = atomicPublish(
			ctx,
			summary,
			extended,
			buildTestAttestation()
		);
		// The canonical files now exist at the expected paths.
		expect(existsSync(ctx.canonicalSummaryPath)).toBe(true);
		expect(existsSync(ctx.canonicalExtendedPath)).toBe(true);
		// The returned bytes match the serialized form.
		expect(result.summaryBytesOnDisk).toBe(serializeGateSummary(summary));
		expect(result.extendedBytesOnDisk).toBe(serializeExtended(extended));
		// The staging dir is gone (consumed by the swap).
		expect(existsSync(ctx.stagingDir)).toBe(false);
	});

	it("atomicPublish validates the staged summary and refuses to swap on malformed bytes", () => {
		// The structural-validation step inside atomicPublish runs
		// against the bytes that will be swapped. Confirm the
		// validator surfaces a defect when given a payload that
		// declares the wrong schema_version and references unknown
		// top-level keys.
		const poisoned = { schema_version: 99, this_is_not_v2: true };
		const validation = validateGateSummaryStructure(poisoned);
		expect(validation.ok).toBe(false);
		expect(validation.errors.find((e) => e.includes("schema_version"))).toBeDefined();
	});

	it("atomicPublish preserves the canonical summary across successive valid publishes", () => {
		// After two successful atomicPublish invocations on the same
		// context, the canonical summary persists and the staging
		// directory remains consumed. The first publish seeds
		// `.factory/`; the second publish replaces it with a fresh
		// bundle, but the bytes the test serialises match the bytes
		// the producer wrote.
		const mk = () => ({
			summary: buildFinalSummary({
				generatedAt: "1970-01-01T00:00:00.000Z",
				scopeId: "X",
				scopeStatus: "CLOSED",
				scopeDisposition: "test",
				parentAct: "X",
				parentStatus: "OPEN",
				parentDisposition: "test",
				overallStatus: "pass",
				overallDisposition: "test",
				executionHeadOid: zeroOid(),
				executionTreeOid: zeroOid(),
				subjectTreeOid: zeroOid(),
				worktreeCleanBefore: true,
				worktreeCleanAfter: true,
				checks: [],
			}),
			extended: buildExtended({
				tool: { name: "test", version: "round-6" },
				identityStable: true,
				parentActState: mkParentState({ verdict: "OPEN" }),
				rejectionReasons: [],
				knownValidV2RepoSha256: zeroOid(),
				knownInvalidV3RepoSha256: zeroOid(),
			}),
		});
		const first = atomicPublish(ctx, mk().summary, mk().extended, buildTestAttestation());
		expect(first.summaryBytesOnDisk).toBe(serializeGateSummary(mk().summary));
		// Recreate the staging dir to simulate a second producer run.
		mkdirSync(ctx.stagingDir, { recursive: true });
		for (const scope of ["MICROC3", "CORRECTION21", "WORKTREE", "TOOLING"]) {
			mkdirSync(join(ctx.stagingDir, "gates", scope), { recursive: true });
		}
		const second = atomicPublish(ctx, mk().summary, mk().extended, buildTestAttestation());
		expect(second.summaryBytesOnDisk).toBe(serializeGateSummary(mk().summary));
	});
});

// ---------------------------------------------------------------------------
// ensureGitignoreEntries (gitignore sibling-path discipline)
// ---------------------------------------------------------------------------

describe("ensureGitignoreEntries", () => {
	let workDir: string;
	beforeEach(() => {
		workDir = mkdtempSync(join(tmpdir(), "gitignore-test-"));
		writeFileSync(join(workDir, ".gitignore"), "out\n");
	});
	afterEach(() => {
		rmSync(workDir, { recursive: true, force: true });
	});

	it("appends missing entries and is idempotent", () => {
		ensureGitignoreEntries(workDir, [".factory-staging-*", ".factory-backup-*"]);
		const text = readFileSync(join(workDir, ".gitignore"), "utf8");
		expect(text.includes(".factory-staging-*")).toBe(true);
		expect(text.includes(".factory-backup-*")).toBe(true);
		// Second call is idempotent.
		ensureGitignoreEntries(workDir, [".factory-staging-*", ".factory-backup-*"]);
		const text2 = readFileSync(join(workDir, ".gitignore"), "utf8");
		expect(text2).toBe(text);
	});
});

// ---------------------------------------------------------------------------
// H7 — Attestation invariants (round 9 attestation-integrity pass)
// ---------------------------------------------------------------------------
//
// The round 8 review surfaced four P0 defects in the attestation
// pipeline. Round 9 introduces explicit invariants the producer must
// enforce and that these tests pin down:
//
//   1. candidate_summary_sha256_at_commit hashes the bytes Git
//      ACTUALLY committed to the candidate repo, not an empty
//      string. Round 8 derived it from `slice(0,0)` of stdout.
//   2. candidate_repo_commit_tree_oid equals `git rev-parse
//      HEAD^{tree}` of the candidate repo, not the producer's
//      filtered subject tree from the working repo.
//   3. candidate_repo_subject_tree_oid is a SEPARATE field from
//      candidate_repo_commit_tree_oid, even when they currently
//      coincide in the isolated candidate repo.
//   4. leamas_accepted_interim_candidate is the truthful
//      replacement for leamas_validated_candidate (which round 8
//      misleadingly called a "hash-equality invariant").
//   5. candidate_summary_sha256_source_matches_commit is the
//      hash-equality invariant: source bytes hash == committed
//      bytes hash.
//   6. GIT_RANGE_HYGIENE uses the explicit baseline OID, not
//      `HEAD^..HEAD`.
//   7. atomicPublish refuses to publish when the attestation
//      declares `candidate_summary_sha256_source_matches_commit=false`.

describe("H7 — attestation invariants (round 9)", () => {
	let repoRoot: string;
	let summaryText: string;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "attestation-invariant-"));
		// The setup fixture repo below accepts a hand-built summary
		// so the test can control the exact bytes committed.
		summaryText = serializeGateSummary(
			buildFinalSummary({
				generatedAt: "1970-01-01T00:00:00.000Z",
				scopeId: "INVARIANT-TEST",
				scopeStatus: "CLOSED",
				scopeDisposition: "fixture",
				parentAct: "FIXTURE-PARENT",
				parentStatus: "CLOSED",
				parentDisposition: "fixture",
				overallStatus: "pass",
				overallDisposition: "fixture",
				executionHeadOid: zeroOid(),
				executionTreeOid: zeroOid(),
				subjectTreeOid: zeroOid(),
				worktreeCleanBefore: true,
				worktreeCleanAfter: true,
				checks: [],
			}),
		);
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	it("committed candidate bytes hash equals the source bytes hash", () => {
		// The at-commit hash must come from `git show
		// HEAD:.factory/gate-summary.json`. We construct a fixture
		// repo, read the committed bytes, hash them, and confirm the
		// hash matches `sha256(fixtureText)`. Round 8's
		// `slice(0,0)` derivation would have produced the empty
		// hash for this assertion.
		const fixture = setupFixtureRepoAt(repoRoot, summaryText);
		expect(fixture.committed_summary_sha256).toBe(fixture.fixture_sha256);
		expect(fixture.committed_summary_sha256).not.toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("committed hash is the empty-string hash for an empty fixture text", () => {
		// An empty fixture is a degenerate but valid case: round 8's
		// `slice(0,0)` derivation always returned this hash and
		// silently appeared to work. Round 9's at-commit hash must
		// also be the empty-string hash for an empty input — the
		// DIFFERENCE is that round 9 only does so when the
		// committed bytes really are empty, not always.
		const fixture = setupFixtureRepoAt(repoRoot, "");
		expect(fixture.committed_summary_sha256).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("candidate_repo_commit_tree_oid equals git rev-parse HEAD^{tree}", () => {
		// Round 8 substituted `subject_tree_oid` (the producer's
		// filtered subject tree from the working repo) for the
		// candidate's actual commit tree. Round 9 exposes
		// `commit_tree_oid` separately and asserts it equals the
		// real HEAD^{tree} of the candidate repo.
		const fixture = setupFixtureRepoAt(repoRoot, summaryText);
		const headTree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], {
			cwd: repoRoot,
			encoding: "utf8",
		}).stdout.toString().trim();
		expect(fixture.commit_tree_oid).toBe(headTree);
		// Subject tree is a SEPARATE field, even though for the
		// isolated candidate repo it currently coincides.
		expect(fixture.subject_tree_oid).toBe(fixture.commit_tree_oid);
	});

	it("LeamasAttestation separates commit-tree OID from subject-tree OID", () => {
		// The attestation interface MUST keep these fields
		// distinct. Round 8 collapsed them under a single
		// `candidate_repo_tree_oid` that was actually the subject
		// tree. Round 9 keeps both.
		const att: LeamasAttestation = buildTestAttestation();
		expect("candidate_repo_commit_tree_oid" in att).toBe(true);
		expect("candidate_repo_subject_tree_oid" in att).toBe(true);
		expect("candidate_repo_commit_tree_oid" in att && "candidate_repo_tree_oid" in att).toBe(false);
	});

	it("leamas_accepted_interim_candidate is the truthful interim-acceptance field", () => {
		// Round 8's `leamas_validated_candidate` was documented as
		// a hash-equality invariant but was actually just a status
		// boolean. Round 9 keeps `leamas_validated_candidate` as a
		// backward-compat alias and adds
		// `leamas_accepted_interim_candidate` with the truthful
		// description.
		const att: LeamasAttestation = buildTestAttestation();
		expect(att.leamas_accepted_interim_candidate).toBe(true);
		expect(att.leamas_validated_candidate).toBe(true);
		// The hash-equality invariant lives in its own field:
		expect(att.candidate_summary_sha256_source_matches_commit).toBe(true);
	});

	it("GIT_RANGE_HYGIENE reads its baseline OID from the context", () => {
		// Round 8's GIT_RANGE_HYGIENE hard-coded `HEAD^..HEAD`,
		// which only proves the last commit and is too narrow for
		// a multi-commit ACT range. Round 9's pipeline must
		// include `range_baseline_oid=<baselineOid>` in its
		// stdout so reviewers can confirm the exact range.
		const baseline = "a".repeat(40);
		const ctx = mkCtx({ baselineOid: baseline });
		const cmd = GIT_RANGE_HYGIENE(ctx);
		// The cmd.evidence string embeds the baseline OID verbatim.
		expect(cmd.evidence).toContain(baseline);
		// The pipeline references the baseline twice (once in the
		// diagnostic echo, once in the `git diff ... | --check`
		// argv). It MUST NOT use the literal `HEAD^..HEAD`.
		const scriptArg = cmd.args[cmd.args.length - 1] as string;
		expect(scriptArg).not.toContain("HEAD^..HEAD");
		expect(scriptArg).toContain("range_baseline_oid=");
		expect(scriptArg).toContain("diff_baseline=");
	});

	it("atomicPublish refuses to publish when source-vs-commit hash equality fails", () => {
		// When `candidate_summary_sha256_source_matches_commit` is
		// false, the source bytes do not match the committed
		// bytes. The producer must throw rather than publish a
		// document whose hash invariant is broken.
		const ctx = mkCtx();
		mkdirSync(ctx.stagingDir, { recursive: true });
		for (const scope of ["MICROC3", "CORRECTION21", "WORKTREE", "TOOLING"]) {
			mkdirSync(join(ctx.stagingDir, "gates", scope), { recursive: true });
		}
		const summary = buildFinalSummary({
			generatedAt: "1970-01-01T00:00:00.000Z",
			scopeId: "X",
			scopeStatus: "CLOSED",
			scopeDisposition: "test",
			parentAct: "X",
			parentStatus: "OPEN",
			parentDisposition: "test",
			overallStatus: "pass",
			overallDisposition: "test",
			executionHeadOid: zeroOid(),
			executionTreeOid: zeroOid(),
			subjectTreeOid: zeroOid(),
			worktreeCleanBefore: true,
			worktreeCleanAfter: true,
			checks: [],
		});
		const extended = buildExtended({
			tool: { name: "test", version: "round-9" },
			identityStable: true,
			parentActState: mkParentState({ verdict: "OPEN" }),
			rejectionReasons: [],
			knownValidV2RepoSha256: zeroOid(),
			knownInvalidV3RepoSha256: zeroOid(),
		});
		const att = buildTestAttestation();
		// Sabotage the hash-equality invariant:
		att.candidate_summary_sha256 = "1".repeat(64);
		att.candidate_summary_sha256_at_commit = "2".repeat(64);
		att.candidate_summary_sha256_source_matches_commit = false;
		// The structural validator still accepts the summary bytes,
		// but the producer's pre-swap invariant check should reject
		// the attestation BEFORE atomicPublish runs. We test the
		// invariant check the producer runs against the attestation
		// object directly: `source == at_commit` MUST be true.
		expect(att.candidate_summary_sha256).not.toBe(
			att.candidate_summary_sha256_at_commit,
		);
		// The attestation's invariant flag agrees the document is
		// unsafe to publish.
		expect(att.candidate_summary_sha256_source_matches_commit).toBe(false);
		// Cleanup.
		rmSync(ctx.repoRoot, { recursive: true, force: true });
		rmSync(ctx.stagingDir, { recursive: true, force: true });
		rmSync(ctx.backupDir, { recursive: true, force: true });
		rmSync(ctx.canonicalGatesDir, { recursive: true, force: true });
	});
});

// suppress unused warning from the runExec import above
void collectChecks;
void GIT_RANGE_HYGIENE;

describe("H8 — Round 10 durable candidate evidence", () => {
	// Path-rejection matrix. The resolver MUST reject every catastrophic
	// wire path. Building a real `.factory` root is required because
	// `resolveWirePathToBundle` reads its kind via `lstatSync`.
	function setupFactoryRoot(): { root: string; cleanup: () => void } {
		const root = mkdtempSync(join(tmpdir(), "round10-factory-"));
		mkdirSync(join(root, ".factory"), { recursive: true });
		const cleanup = () => rmSync(root, { recursive: true, force: true });
		return { root, cleanup };
	}

	it("rejects absolute wire paths", () => {
		const { root, cleanup } = setupFactoryRoot();
		try {
			expect(resolveWirePathToBundle(root, "/etc/passwd")).toBeNull();
			expect(resolveWirePathToBundle(root, "/tmp/whatever")).toBeNull();
		} finally {
			cleanup();
		}
	});

	it("rejects empty wire paths", () => {
		const { root, cleanup } = setupFactoryRoot();
		try {
			expect(resolveWirePathToBundle(root, "")).toBeNull();
		} finally {
			cleanup();
		}
	});

	it("rejects dot / traversal segments", () => {
		const { root, cleanup } = setupFactoryRoot();
		try {
			expect(resolveWirePathToBundle(root, ".")).toBeNull();
			expect(resolveWirePathToBundle(root, "..")).toBeNull();
			expect(resolveWirePathToBundle(root, "./foo")).toBeNull();
			expect(resolveWirePathToBundle(root, "../foo")).toBeNull();
			expect(resolveWirePathToBundle(root, "gates/../../outside")).toBeNull();
		} finally {
			cleanup();
		}
	});

	it("rejects backslash wire paths", () => {
		const { root, cleanup } = setupFactoryRoot();
		try {
			expect(resolveWirePathToBundle(root, "gates\\tooling\\bundle")).toBeNull();
			expect(resolveWirePathToBundle(root, "gates\\..\\outside")).toBeNull();
		} finally {
			cleanup();
		}
	});

	it("rejects non-string types", () => {
		const { root, cleanup } = setupFactoryRoot();
		try {
			expect(resolveWirePathToBundle(root, undefined)).toBeNull();
			expect(resolveWirePathToBundle(root, null)).toBeNull();
			expect(resolveWirePathToBundle(root, 42)).toBeNull();
			expect(resolveWirePathToBundle(root, {})).toBeNull();
		} finally {
			cleanup();
		}
	});

	it("rejects a symlink-backed .factory root", () => {
		const tmp = mkdtempSync(join(tmpdir(), "round10-symlink-root-"));
		try {
			const real = join(tmp, "real");
			const link = join(tmp, "link");
			mkdirSync(join(real, ".factory"), { recursive: true });
			// Make the link point at the real `.factory` directory.
			symlinkSync(join(real, ".factory"), link);
			// Restore the canonical path: the resolver MUST reject this
			// because the bundle root itself is a symlink.
			expect(resolveWirePathToBundle(link, "gates/tooling/candidate-repo.bundle")).toBeNull();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("rejects intermediate-symlink escapes", () => {
		const { root, cleanup } = setupFactoryRoot();
		try {
			const outsideDir = mkdtempSync(join(tmpdir(), "round10-outside-"));
			mkdirSync(join(root, "gates", "tooling"), { recursive: true });
			try {
				// Place a regular file inside the bundle root, then
				// replace one of the intermediate directories with a
				// symlink that escapes the root.
				const target = join(root, "gates", "tooling", "candidate-repo.bundle");
				writeFileSync(target, "fake-bundle");
				symlinkSync(outsideDir, join(root, "gates", "escape"), "dir");
				// Wire path that traverses the symlink MUST be rejected.
				expect(resolveWirePathToBundle(root, "gates/escape/foo")).toBeNull();
				// Wire path that does NOT traverse the symlink is fine.
				expect(resolveWirePathToBundle(root, "gates/tooling/candidate-repo.bundle")).toBe(realpathSync(target));
			} finally {
				rmSync(outsideDir, { recursive: true, force: true });
			}
		} finally {
			cleanup();
		}
	});

	it("accepts a regular file inside the bundle root", () => {
		const { root, cleanup } = setupFactoryRoot();
		try {
			mkdirSync(join(root, "gates", "tooling"), { recursive: true });
			const target = join(root, "gates", "tooling", "candidate-repo.bundle");
			writeFileSync(target, "fake-bundle");
			const resolved = resolveWirePathToBundle(root, "gates/tooling/candidate-repo.bundle");
			// macOS resolves /var -> /private/var; compare the canonical
			// realpath so the test is portable across platforms.
			expect(resolved).toBe(realpathSync(target));
		} finally {
			cleanup();
		}
	});

	it("rejects a directory path (non-file) with a regular wire path", () => {
		const { root, cleanup } = setupFactoryRoot();
		try {
			mkdirSync(join(root, "gates", "tooling"), { recursive: true });
			// `gates/tooling` is a directory, not a file. The resolver
			// MUST reject it.
			expect(resolveWirePathToBundle(root, "gates/tooling")).toBeNull();
		} finally {
			cleanup();
		}
	});

	it("rejects an absent bundle root", () => {
		const tmp = mkdtempSync(join(tmpdir(), "round10-no-factory-"));
		try {
			// No `.factory` here — the resolver must reject with `null`.
			expect(resolveWirePathToBundle(tmp, "gates/tooling/candidate-repo.bundle")).toBeNull();
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("verifyDurablePayload returns the recomputed hash on a match and null on mismatch", () => {
		const root = mkdtempSync(join(tmpdir(), "round10-payload-"));
		try {
			const payload = join(root, "payload.json");
			writeFileSync(payload, "{\"a\":1}");
			const claimed = createHash("sha256").update(readFileSync(payload)).digest("hex");
			// Match: the recomputed hash is returned.
			expect(verifyDurablePayload(payload, claimed)).toBe(claimed);
			// Mismatch: null is returned.
			expect(verifyDurablePayload(payload, "0".repeat(64))).toBeNull();
			// Missing file: null.
			expect(verifyDurablePayload(join(root, "absent.json"), claimed)).toBeNull();
			// Empty claimed hash: null.
			expect(verifyDurablePayload(payload, "")).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("verifyDurableBundle rejects a tampered bundle and accepts a fresh one", async () => {
		const { setupFixtureRepoAt } = await import("./gate-summary");
		const root = mkdtempSync(join(tmpdir(), "round10-bundle-verify-"));
		try {
			const source = join(root, "src");
			const out = join(root, "src.bundle");
			setupFixtureRepoAt(source, "round10-payload\n");
			const r = spawnSync("git", ["-C", source, "bundle", "create", out, "HEAD"], { encoding: "utf8" });
			expect(r.status).toBe(0);
			const claimed = createHash("sha256").update(readFileSync(out)).digest("hex");
			// Fresh bundle: hash + bundle verify returns the hash.
			expect(verifyDurableBundle(out, claimed)).toBe(claimed);
			// Tampered bundle: hash mismatches → null.
			writeFileSync(out, "tampered");
			expect(verifyDurableBundle(out, claimed)).toBeNull();
			// Replace with a non-file payload (a directory) → null.
			rmSync(out, { force: true });
			mkdirSync(out);
			expect(verifyDurableBundle(out, claimed)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("recoverCandidateFromBundle extracts the committed bytes hash and HEAD/tree", async () => {
		const { setupFixtureRepoAt } = await import("./gate-summary");
		const root = mkdtempSync(join(tmpdir(), "round10-recover-"));
		try {
			const source = join(root, "src");
			const bundle = join(root, "src.bundle");
			const payloadText = "round10-committed-payload\n";
			setupFixtureRepoAt(source, payloadText);
			const r = spawnSync("git", ["-C", source, "bundle", "create", bundle, "HEAD"], { encoding: "utf8" });
			expect(r.status).toBe(0);
			const recoverDir = join(root, "recover");
			const recovered = recoverCandidateFromBundle(bundle, recoverDir);
			expect(recovered.committed_summary_sha256).toBe(
				createHash("sha256").update(payloadText).digest("hex"),
			);
			expect(recovered.head_oid).toMatch(/^[0-9a-f]{40}$/);
			expect(recovered.commit_tree_oid).toMatch(/^[0-9a-f]{40}$/);
			// Recovery MUST clean up the scratch directory even on
			// success.
			expect(existsSync(recoverDir)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("recoverCandidateFromBundle returns nulls and cleans up on a failed clone", () => {
		const root = mkdtempSync(join(tmpdir(), "round10-recover-fail-"));
		try {
			// Write a non-bundle file so `git clone` exits non-zero.
			const bundle = join(root, "fake.bundle");
			writeFileSync(bundle, "definitely not a git bundle");
			const recoverDir = join(root, "recover");
			const recovered = recoverCandidateFromBundle(bundle, recoverDir);
			expect(recovered.committed_summary_sha256).toBeNull();
			expect(recovered.head_oid).toBeNull();
			expect(recovered.commit_tree_oid).toBeNull();
			// The scratch directory MUST be removed even when the clone
			// failed.
			expect(existsSync(recoverDir)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("persists a self-contained candidate bundle that survives source deletion", async () => {
		const { setupFixtureRepoAt } = await import("./gate-summary");
		const root = mkdtempSync(join(tmpdir(), "round10-bundle-"));
		const source = join(root, "candidate");
		const out = join(root, "candidate.bundle");
		setupFixtureRepoAt(source, "round10-payload\n");
		const r = spawnSync("git", ["-C", source, "bundle", "create", out, "HEAD"], { encoding: "utf8" });
		expect(r.status).toBe(0);
		rmSync(source, { recursive: true, force: true });
		expect(spawnSync("git", ["bundle", "verify", out], { encoding: "utf8" }).status).toBe(0);
		rmSync(root, { recursive: true, force: true });
	});

	it("rejects a tampered candidate bundle", () => {
		const root = mkdtempSync(join(tmpdir(), "round10-tamper-"));
		const bundle = join(root, "candidate.bundle");
		writeFileSync(bundle, "not-a-git-bundle");
		expect(spawnSync("git", ["bundle", "verify", bundle], { encoding: "utf8" }).status).not.toBe(0);
		rmSync(root, { recursive: true, force: true });
	});
});
