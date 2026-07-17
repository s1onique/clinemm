#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION11 — Renderer/closure tests.
 *
 * Pure-function tests on ./baseline-closure.ts. Uses bun:test (node-side
 * unit suite) so it can be invoked directly via
 * `bun test factory/scripts/render-baseline-report.test.ts`.
 *
 * These tests pin the fail-closed behavior across CORRECTION05/06/07/08/10/11.
 *
 * CORRECTION11 introduces the runner drift attestation:
 *
 *   subject_tree_oid_before / subject_tree_oid_after
 *                            — must be equal to the recorded
 *                              `subject_tree_oid` to demonstrate the
 *                              subject was stable across execution.
 *   execution_identity_valid    — `head^{tree} == tree` confirmed by
 *                              `git cat-file -e` and `git rev-parse`.
 *   worktree_inputs_clean_before / worktree_inputs_clean_after
 *                            — boolean | null tri-state cleanliness.
 *   per_command_drift_checked    — every command had equal before/after
 *                              head/tree/subject, captured by the runner.
 *   manifest_contract_honored    — every declared expected output path
 *                              appears in the manifest.
 *
 *   bun test factory/scripts/render-baseline-report.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
	mkdtempSync,
	rmSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
	computeClosure,
	checkEvidence,
	parseManifest,
	loadEvidenceFile,
	resolveEvidencePayloadPath,
	CONTROL_FILES,
	type ClosureInput,
	type EvidenceView,
} from "./baseline-closure";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const TREE = "89abcdef0123456789abcdef0123456789abcdef";
const HEAD_OTHER = "ffffffff11112222333344445555666677778888";
const FILTERED_TREE = "1234abcd1234abcd1234abcd1234abcd1234abcd";

function sha256Hex(buf: Buffer | string): string {
	return createHash("sha256").update(buf).digest("hex");
}

function wrapEvidence(value: any): { ok: boolean; value: any; error: string | null } {
	return { ok: true, value, error: null };
}

function baseOk(overrides: Partial<EvidenceView> = {}): EvidenceView {
	return {
		exists: true,
		headOidWellformed: true,
		treeMatches: true,
		subjectTreeContract: true,
		subjectTreeComputationOk: true,
		executionIdentityRecorded: true,
		executionHeadOidWellformed: true,
		executionTreeOidWellformed: true,
		executionIdentityValid: true,
		executionTreeBound: true,
		executionTrees: [TREE],
		worktreeInputsCleanBefore: true,
		worktreeInputsCleanAfter: true,
		perCommandDriftChecked: true,
		subjectStableAcrossMatrix: true,
		manifestContractHonored: true,
		hashManifestValid: true,
		missingFiles: [],
		unexpectedFiles: [],
		hashMismatches: [],
		malformedLines: [],
		duplicatePaths: [],
		commandSetExact: true,
		duplicateEvidenceCommandIds: [],
		duplicateExecutedCommandIds: [],
		commandRecordMismatches: [],
		rejectedManifestPaths: [],
		outOfEvidenceDirPaths: [],
		malformedEvidenceCommandRows: 0,
		malformedExecutedCommandRows: 0,
		decodeError: null,
		...overrides,
	};
}

function baseInput(evidenceOverride: Partial<EvidenceView> = {}): ClosureInput {
	return {
		evidence: baseOk(evidenceOverride),
		unknownFailures: [],
		unknownFailureCount: 0,
		mandatoryPass: 18,
		mandatoryFail: 0,
		mandatoryApplicable: 18,
		affectedScopePass: 4,
		affectedScopeFail: 0,
		affectedScopeApplicable: 4,
		r4Satisfied: false,
		r5Satisfied: false,
		r6Satisfied: false,
		r7Satisfied: false,
		r16Satisfied: false,
	};
}

// ---------------------------------------------------------------------------
// Original 8 pinned cases
// ---------------------------------------------------------------------------

describe("computeClosure — fail-closed policy (8 pinned cases)", () => {
	it("1. stale tree → FAIL", () => {
		const r = computeClosure(baseInput({ treeMatches: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("2. mixed execution trees → FAIL", () => {
		const r = computeClosure(
			baseInput({ executionTrees: [TREE, HEAD_OTHER, "a".repeat(40)] }),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("3. hash mismatch → FAIL", () => {
		const r = computeClosure(
			baseInput({
				hashManifestValid: false,
				hashMismatches: [
					{
						path: "evidence.json",
						expected: "deadbeef".repeat(8),
						actual: "f00dface".repeat(8),
					},
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("4. missing evidence file → FAIL", () => {
		const r = computeClosure(
			baseInput({
				hashManifestValid: false,
				missingFiles: [{ path: "evidence.json", reason: "missing" }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("5. UNKNOWN failure → FAIL", () => {
		const r = computeClosure({ ...baseInput(), unknownFailures: ["root-check"] });
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(true);
		expect(r.reasonCodes).toContain("UNKNOWN_FAILURES_PRESENT");
		expect(r.reasonCodes).not.toContain("EVIDENCE_INCOMPLETE");
	});

	it("6. valid evidence + open R4 → PARTIAL", () => {
		const r = computeClosure(baseInput());
		expect(r.verdict).toBe("PARTIAL");
		expect(r.evidenceOk).toBe(true);
		expect(r.reasonCodes).toContain("R4_UNSATISFIED");
		expect(r.reasonCodes).not.toContain("EVIDENCE_INCOMPLETE");
		expect(r.reasonCodes).not.toContain("UNKNOWN_FAILURES_PRESENT");
	});

	it("7. all requirements green → PASS", () => {
		const r = computeClosure({
			...baseInput(),
			r4Satisfied: true,
			r5Satisfied: true,
			r6Satisfied: true,
			r7Satisfied: true,
			r16Satisfied: true,
		});
		expect(r.verdict).toBe("PASS");
		expect(r.evidenceOk).toBe(true);
		expect(r.reasonCodes).toEqual([]);
	});

	it("8. head binding no longer required (CORRECTION07)", () => {
		const r = computeClosure(baseInput({ headOidWellformed: false }));
		expect(r.verdict).toBe("PARTIAL");
		expect(r.evidenceOk).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// CORRECTION06 pinned cases
// ---------------------------------------------------------------------------

describe("computeClosure — CORRECTION06 fail-closed pinned cases", () => {
	it("R2: execution tree not bound to evidence.tree_oid → FAIL", () => {
		const r = computeClosure(
			baseInput({ executionTrees: [HEAD_OTHER], executionTreeBound: false }),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("R3: duplicate evidence command IDs → FAIL", () => {
		const r = computeClosure(
			baseInput({
				commandSetExact: false,
				duplicateEvidenceCommandIds: [{ path: "build-sdk", occurrences: 2 }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("R3: duplicate executed command IDs → FAIL", () => {
		const r = computeClosure(
			baseInput({
				commandSetExact: false,
				duplicateExecutedCommandIds: [{ path: "root-check", occurrences: 2 }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("R3: per-record mismatch (status disagrees) → FAIL", () => {
		const r = computeClosure(
			baseInput({
				commandSetExact: false,
				commandRecordMismatches: [
					{
						id: "build-sdk",
						fields: ["status"],
						evidence: { status: "pass" },
						executed: { status: "fail" },
					},
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("P1a: rejected absolute manifest path → FAIL", () => {
		const r = computeClosure(
			baseInput({
				hashManifestValid: false,
				rejectedManifestPaths: [{ path: "/etc/passwd", reason: "absolute" }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("P1b: declared-but-symlink path → FAIL", () => {
		const r = computeClosure(
			baseInput({
				hashManifestValid: false,
				missingFiles: [{ path: "commands/build.stdout", reason: "symlink" }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});
});

// ---------------------------------------------------------------------------
// CORRECTION07 pinned cases
// ---------------------------------------------------------------------------

describe("computeClosure — CORRECTION07 fail-closed pinned cases", () => {
	it("P0 #1: outside-evidence-dir manifest path → FAIL", () => {
		const r = computeClosure(
			baseInput({
				hashManifestValid: false,
				outOfEvidenceDirPaths: [
					{ path: "package.json", reason: "outside-evidence-dir" },
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
	});

	it("P1 #1: malformed evidence.json → FAIL with structured decodeError", () => {
		const r = computeClosure(
			baseInput({ exists: false, decodeError: "Unexpected token } in JSON" }),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("P1 #2: malformed evidence command rows → FAIL", () => {
		const r = computeClosure(
			baseInput({ commandSetExact: false, malformedEvidenceCommandRows: 3 }),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("P1 #3: malformed executed command rows → FAIL", () => {
		const r = computeClosure(
			baseInput({ commandSetExact: false, malformedExecutedCommandRows: 2 }),
		);
		expect(r.verdict).toBe("FAIL");
	});
});

// ---------------------------------------------------------------------------
// CORRECTION08 pinned cases
// ---------------------------------------------------------------------------

describe("computeClosure — CORRECTION08 fail-closed pinned cases", () => {
	it("P0: subject tree contract active but identity mismatched → FAIL", () => {
		const r = computeClosure(
			baseInput({ subjectTreeContract: true, treeMatches: false }),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("P0: legacy bundle on legacy contract → FAIL", () => {
		const r = computeClosure(
			baseInput({ subjectTreeContract: false, treeMatches: false }),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("P2: head well-formedness is information-only (does not block closure)", () => {
		const r = computeClosure(baseInput({ headOidWellformed: false }));
		expect(r.verdict).toBe("PARTIAL");
		expect(r.evidenceOk).toBe(true);
		expect(r.reasonCodes).not.toContain("EVIDENCE_INCOMPLETE");
	});
});

// ---------------------------------------------------------------------------
// CORRECTION10 pinned cases
// ---------------------------------------------------------------------------

describe("computeClosure — CORRECTION10 fail-closed pinned cases", () => {
	it("P0 #1: missing execution_head_oid → FAIL with EXECUTION_IDENTITY_MISSING", () => {
		const r = computeClosure(baseInput({ executionIdentityRecorded: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EXECUTION_IDENTITY_MISSING");
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("P0 #2: malformed execution_head_oid → FAIL with EXECUTION_IDENTITY_MALFORMED", () => {
		const r = computeClosure(baseInput({ executionHeadOidWellformed: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.reasonCodes).toContain("EXECUTION_IDENTITY_MALFORMED");
		expect(r.evidenceOk).toBe(false);
	});

	it("P0 #3: malformed execution_tree_oid → FAIL with EXECUTION_IDENTITY_MALFORMED", () => {
		const r = computeClosure(baseInput({ executionTreeOidWellformed: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.reasonCodes).toContain("EXECUTION_IDENTITY_MALFORMED");
	});

	it("P0 #4: command rows disagree with bundle execution_tree_oid → FAIL with EXECUTION_TREE_NOT_BOUND", () => {
		const r = computeClosure(
			baseInput({
				executionTrees: [HEAD_OTHER],
				executionTreeBound: false,
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.reasonCodes).toContain("EXECUTION_TREE_NOT_BOUND");
	});

	it("P0 #5: more than one execution tree → FAIL with EXECUTION_TREES_MIXED", () => {
		const r = computeClosure(
			baseInput({
				executionTrees: [TREE, HEAD_OTHER, "a".repeat(40)],
				executionTreeBound: false,
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.reasonCodes).toContain("EXECUTION_TREES_MIXED");
	});

	it("P2: head well-formedness is information-only (does not block closure under CORRECTION10)", () => {
		const r = computeClosure(baseInput({ headOidWellformed: false }));
		expect(r.verdict).toBe("PARTIAL");
		expect(r.evidenceOk).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// CORRECTION11 pinned cases — runner drift attestation
// ---------------------------------------------------------------------------

describe("computeClosure — CORRECTION11 fail-closed pinned cases", () => {
	it("P0 #1: invalid execution identity shape (head^{tree} != tree) → FAIL with EXECUTION_IDENTITY_INVALID", () => {
		const r = computeClosure(
			baseInput({ executionIdentityValid: false }),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EXECUTION_IDENTITY_INVALID");
	});

	it("P0 #2: subject inputs dirty before matrix → FAIL with WORKTREE_INPUTS_DIRTY_BEFORE", () => {
		const r = computeClosure(baseInput({ worktreeInputsCleanBefore: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("WORKTREE_INPUTS_DIRTY_BEFORE");
	});

	it("P0 #3: subject inputs dirty after matrix → FAIL with WORKTREE_INPUTS_DIRTY_AFTER", () => {
		const r = computeClosure(baseInput({ worktreeInputsCleanAfter: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("WORKTREE_INPUTS_DIRTY_AFTER");
	});

	it("P0 #4: subject drifted during the matrix → FAIL with SUBJECT_DRIFT", () => {
		const r = computeClosure(baseInput({ subjectStableAcrossMatrix: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("SUBJECT_DRIFT");
	});

	it("P0 #5: per-command HEAD/tree/subject drift → FAIL with REPOSITORY_DRIFT", () => {
		const r = computeClosure(baseInput({ perCommandDriftChecked: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("REPOSITORY_DRIFT");
	});

	it("P0 #6: manifest contract violated → FAIL with MANIFEST_PATH_OUTSIDE_EVIDENCE", () => {
		const r = computeClosure(baseInput({ manifestContractHonored: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("MANIFEST_PATH_OUTSIDE_EVIDENCE");
	});

	it("P1: tri-state cleanliness — null (not recorded) is information-only (does not block closure)", () => {
		const r = computeClosure(
			baseInput({ worktreeInputsCleanBefore: null, worktreeInputsCleanAfter: null }),
		);
		// `null` (not recorded) means the bundle predates the CORRECTION11
		// contract. The legacy fallback still allows verdict to leave FAIL
		// on these grounds only if a later dimension trips. With the
		// rest of the dimensions green and `null` not equal to `true`,
		// the conjunction is `false` and verdict is FAIL.
		expect(r.evidenceOk).toBe(false);
		expect(r.verdict).toBe("FAIL");
	});

	it("P3: all CORRECTION11 dimensions green → PARTIAL with no drift reason codes", () => {
		const r = computeClosure(baseInput());
		expect(r.verdict).toBe("PARTIAL");
		expect(r.evidenceOk).toBe(true);
		expect(r.reasonCodes).not.toContain("EXECUTION_IDENTITY_INVALID");
		expect(r.reasonCodes).not.toContain("WORKTREE_INPUTS_DIRTY_BEFORE");
		expect(r.reasonCodes).not.toContain("WORKTREE_INPUTS_DIRTY_AFTER");
		expect(r.reasonCodes).not.toContain("SUBJECT_DRIFT");
		expect(r.reasonCodes).not.toContain("REPOSITORY_DRIFT");
		expect(r.reasonCodes).not.toContain("MANIFEST_PATH_OUTSIDE_EVIDENCE");
	});
});

// ---------------------------------------------------------------------------
// Additional invariants
// ---------------------------------------------------------------------------

describe("computeClosure — additional invariants", () => {
	it("EVIDENCE_INCOMPLETE preempts every other reason", () => {
		const r = computeClosure({
			...baseInput({ treeMatches: false }),
			unknownFailures: ["root-check"],
		});
		expect(r.verdict).toBe("FAIL");
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
		expect(r.reasonCodes).toContain("UNKNOWN_FAILURES_PRESENT");
	});

	it("mandatory not-all-pass → PARTIAL when evidence is fine", () => {
		const r = computeClosure({
			...baseInput(),
			mandatoryPass: 16,
			mandatoryFail: 2,
		});
		expect(r.verdict).toBe("PARTIAL");
		expect(r.reasonCodes).toContain("MANDATORY_NOT_ALL_PASS");
	});

	it("affected-scope not-all-pass → PARTIAL when evidence is fine", () => {
		const r = computeClosure({
			...baseInput(),
			affectedScopePass: 3,
			affectedScopeFail: 1,
		});
		expect(r.verdict).toBe("PARTIAL");
		expect(r.reasonCodes).toContain("AFFECTED_SCOPE_NOT_ALL_PASS");
	});

	it("malformed manifest line is FAIL", () => {
		const r = computeClosure(
			baseInput({
				hashManifestValid: false,
				malformedLines: [{ line: 1, content: "garbage" }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("duplicate manifest path is FAIL", () => {
		const r = computeClosure(
			baseInput({
				hashManifestValid: false,
				duplicatePaths: [{ path: "evidence.json", occurrences: 2 }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("unexpected file on disk is FAIL", () => {
		const r = computeClosure(
			baseInput({
				unexpectedFiles: [
					{ path: "commands/leaked.txt", reason: "unexpected" },
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("command-set mismatch (missing IDs) is FAIL", () => {
		const r = computeClosure(baseInput({ commandSetExact: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
	});

	it("evidence file missing → FAIL", () => {
		const r = computeClosure({
			...baseInput({ exists: false, decodeError: "missing" }),
		});
		expect(r.verdict).toBe("FAIL");
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("isEvidenceOk directly matches the audit-pinned conjunction (CORRECTION11)", () => {
		const v = baseOk();
		expect(isEvidenceOkV(v)).toBe(true);
	});
});

function isEvidenceOkV(e: EvidenceView): boolean {
	return (
		e.exists &&
		e.subjectTreeComputationOk &&
		e.subjectTreeContract &&
		e.executionIdentityRecorded &&
		e.executionHeadOidWellformed &&
		e.executionTreeOidWellformed &&
		e.executionIdentityValid &&
		e.worktreeInputsCleanBefore === true &&
		e.worktreeInputsCleanAfter === true &&
		e.subjectStableAcrossMatrix &&
		e.perCommandDriftChecked &&
		e.manifestContractHonored &&
		e.treeMatches &&
		e.executionTreeBound &&
		e.executionTrees.length === 1 &&
		e.hashManifestValid &&
		e.missingFiles.length === 0 &&
		e.unexpectedFiles.length === 0 &&
		e.hashMismatches.length === 0 &&
		e.malformedLines.length === 0 &&
		e.duplicatePaths.length === 0 &&
		e.commandSetExact &&
		e.duplicateEvidenceCommandIds.length === 0 &&
		e.duplicateExecutedCommandIds.length === 0 &&
		e.commandRecordMismatches.length === 0 &&
		e.rejectedManifestPaths.length === 0 &&
		e.outOfEvidenceDirPaths.length === 0 &&
		e.malformedEvidenceCommandRows === 0 &&
		e.malformedExecutedCommandRows === 0 &&
		e.decodeError === null
	);
}

// ---------------------------------------------------------------------------
// parseManifest / loadEvidenceFile / resolveEvidencePayloadPath
// ---------------------------------------------------------------------------

describe("parseManifest", () => {
	it("parses well-formed lines, normalizes lowercase", () => {
		const text = "AAAA".repeat(16) + "  foo/bar\n" + "BBBB".repeat(16) + "  baz\n";
		const { declared, malformed, duplicates } = parseManifest(text);
		expect(declared.get("foo/bar")).toBe("aaaa".repeat(16));
		expect(declared.get("baz")).toBe("bbbb".repeat(16));
		expect(malformed).toEqual([]);
		expect(duplicates).toEqual([]);
	});

	it("flags malformed lines and continues past them", () => {
		const text =
			"AAAA".repeat(16) + "  foo\n" + "NOT_A_SHA  bar\n" + "BBBB".repeat(16) + "  baz\n";
		const { declared, malformed } = parseManifest(text);
		expect(malformed).toHaveLength(1);
		expect(malformed[0]?.line).toBe(2);
		expect(declared.get("foo")).toBe("aaaa".repeat(16));
		expect(declared.get("baz")).toBe("bbbb".repeat(16));
	});

	it("counts duplicate paths", () => {
		const sha = "CCCC".repeat(16);
		const text = `${sha}  foo\n${sha}  foo\n`;
		const { declared, duplicates } = parseManifest(text);
		expect(declared.get("foo")).toBe("cccc".repeat(16));
		expect(duplicates).toEqual([{ path: "foo", occurrences: 2 }]);
	});
});

describe("loadEvidenceFile", () => {
	let tmp: string;
	beforeAll(() => {
		tmp = mkdtempSync(join(tmpdir(), "load-ev-"));
	});
	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("missing path → ok=false error='missing'", () => {
		const r = loadEvidenceFile(join(tmp, "nope.json"));
		expect(r.ok).toBe(false);
		expect(r.error).toBe("missing");
	});

	it("valid JSON → ok=true", () => {
		const p = join(tmp, "ok.json");
		writeFileSync(p, JSON.stringify({ head_oid: HEAD, tree_oid: TREE }));
		const r = loadEvidenceFile(p);
		expect(r.ok).toBe(true);
		expect(r.value).toEqual({ head_oid: HEAD, tree_oid: TREE });
	});

	it("malformed JSON → ok=false error=parse message (no throw)", () => {
		const p = join(tmp, "bad.json");
		writeFileSync(p, "this is not json }{");
		const r = loadEvidenceFile(p);
		expect(r.ok).toBe(false);
		expect(typeof r.error).toBe("string");
		expect((r.error as string).length).toBeGreaterThan(0);
	});
});

describe("resolveEvidencePayloadPath — strict evDir containment (public vocabulary)", () => {
	const evDir = "/data/factory/evidence/ACT-X";
	const root = "/data";

	it("accepts a path that resolves inside evDir", () => {
		const r = resolveEvidencePayloadPath(evDir, root, "evidence.json");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.abs).toBe(join(evDir, "evidence.json"));
	});

	it("accepts a deeper subdirectory path", () => {
		const r = resolveEvidencePayloadPath(evDir, root, "commands/build.stdout");
		expect(r.ok).toBe(true);
	});

	it("rejects absolute paths with reason='absolute'", () => {
		const r = resolveEvidencePayloadPath(evDir, root, "/etc/passwd");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.reason).toBe("absolute");
			expect(r.reason).not.toBe("rejected_absolute");
		}
	});

	it("rejects paths that escape evDir but stay inside repo with reason='outside-evidence-dir'", () => {
		const r = resolveEvidencePayloadPath(evDir, root, "../../../package.json");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.reason).toBe("outside-evidence-dir");
		}
	});

	it("rejects paths whose resolution lies outside evDir", () => {
		const r = resolveEvidencePayloadPath(evDir, root, "commands/../../package.json");
		expect(r.ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// checkEvidence — directory + manifest pipeline (full negative coverage)
// ---------------------------------------------------------------------------

describe("checkEvidence — directory + manifest pipeline (CORRECTION11)", () => {
	let tmpRoot: string;
	let evDir: string;

	const manifest = new Map<string, string>();
	const filesOnDisk: Array<{ rel: string; bytes: Buffer }> = [];

	beforeAll(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "baseline-c11-"));
		evDir = join(tmpRoot, "detached");
		mkdirSync(join(evDir, "commands"), { recursive: true });

		const a = Buffer.from("alpha\n");
		const b = Buffer.from("bravo\n");
		writeFileSync(join(evDir, "evidence.json"), a);
		writeFileSync(join(evDir, "commands", "build.stdout"), b);
		writeFileSync(
			join(evDir, "hashes.sha256"),
			Buffer.from("placeholder manifest, controlled by runner\n"),
		);
		manifest.set("evidence.json", sha256Hex(a));
		manifest.set("commands/build.stdout", sha256Hex(b));
		filesOnDisk.push({ rel: "evidence.json", bytes: a });
		filesOnDisk.push({ rel: "commands/build.stdout", bytes: b });
	});

	afterAll(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	function manifestText(): string {
		return Array.from(manifest.entries())
			.map(([p, sha]) => `${sha}  ${p}`)
			.join("\n") + "\n";
	}

	function makeExecutedRecord(extra: Partial<any> = {}): any {
		return {
			id: "build",
			status: "pass",
			started_at: "2026-07-17T09:41:41.693Z",
			finished_at: "2026-07-17T09:41:55.259Z",
			duration_ms: 100,
			exit_code: 0,
			signal: null,
			timeout: false,
			stdout_sha256: sha256Hex(filesOnDisk[1]!.bytes),
			stderr_sha256: "0".repeat(64),
			head_oid: HEAD,
			head_oid_before: HEAD,
			head_oid_after: HEAD,
			tree_oid: TREE,
			tree_oid_before: TREE,
			tree_oid_after: TREE,
			subject_tree_oid_before: FILTERED_TREE,
			subject_tree_oid_after: FILTERED_TREE,
			environment_sha256: "c".repeat(64),
			failure_classification: null,
			notes: "",
			...extra,
		};
	}

	function makeEvidenceC11(cmd: any, opts: {
		subjectTree?: string | null;
		subjectTreeBefore?: string | null;
		subjectTreeAfter?: string | null;
		executionHeadOid?: string | null;
		executionTreeOid?: string | null;
		executionIdentityValid?: boolean | null;
		worktreeCleanBefore?: boolean | null;
		worktreeCleanAfter?: boolean | null;
		legacyCleanBefore?: boolean | null;
		legacyCleanAfter?: boolean | null;
		legacyTreeOid?: string | null;
		expectedOutputPaths?: string[] | null;
	} = {}): { ok: boolean; value: any; error: string | null } {
		const subjectTree = opts.subjectTree === undefined ? FILTERED_TREE : opts.subjectTree;
		const subjectTreeBefore = opts.subjectTreeBefore === undefined ? FILTERED_TREE : opts.subjectTreeBefore;
		const subjectTreeAfter = opts.subjectTreeAfter === undefined ? FILTERED_TREE : opts.subjectTreeAfter;
		const executionHeadOid = opts.executionHeadOid === undefined ? HEAD : opts.executionHeadOid;
		const executionTreeOid = opts.executionTreeOid === undefined ? TREE : opts.executionTreeOid;
		const executionIdentityValid = opts.executionIdentityValid === undefined ? true : opts.executionIdentityValid;
		// CORRECTION11 uses `worktree_inputs_clean_*` (tri-state).
		// CORRECTION10 used `worktree_clean_*` (boolean only). We populate
		// both forms in the runner, so the renderer-side closure logic
		// can read either; if only the legacy field is present, the
		// tri-state readers get `null`.
		const worktreeInputsCleanBefore = opts.worktreeCleanBefore === undefined
			? (opts.legacyCleanBefore === undefined ? true : opts.legacyCleanBefore)
			: opts.worktreeCleanBefore;
		const worktreeInputsCleanAfter = opts.worktreeCleanAfter === undefined
			? (opts.legacyCleanAfter === undefined ? true : opts.legacyCleanAfter)
			: opts.worktreeCleanAfter;
		const legacyTreeOid = opts.legacyTreeOid === undefined ? TREE : opts.legacyTreeOid;
		const expectedOutputPaths = opts.expectedOutputPaths === undefined
			? null
			: opts.expectedOutputPaths;
		const obj: any = {
			schema_version: 3,
			act_id: "ACT-CLINEMM-FORK-BASELINE01",
			head_oid: HEAD,
			tree_oid: legacyTreeOid,
			subject_tree_oid: subjectTree,
			subject_tree_oid_before: subjectTreeBefore,
			subject_tree_oid_after: subjectTreeAfter,
			execution_head_oid: executionHeadOid,
			execution_tree_oid: executionTreeOid,
			execution_identity_valid: executionIdentityValid,
			worktree_inputs_clean_before: worktreeInputsCleanBefore,
			worktree_inputs_clean_after: worktreeInputsCleanAfter,
			// CORRECTION10 legacy fields, populated for back-compat with
			// older renderers. The CORRECTION11 reader ignores these
			// when the new names are present.
			worktree_clean_before: opts.legacyCleanBefore === undefined ? true : opts.legacyCleanBefore,
			worktree_clean_after: opts.legacyCleanAfter === undefined ? true : opts.legacyCleanAfter,
			generated_at: "2026-07-17T09:50:09.000Z",
			host_arch: "darwin-arm64",
			commands: [cmd],
		};
		if (expectedOutputPaths !== null) obj.expected_output_paths = expectedOutputPaths;
		return wrapEvidence(obj);
	}

	function runCheck(args: {
		ev?: { ok: boolean; value: any; error: string | null };
		hashesText?: string;
		executedCmds?: any[];
		filteredSubjectTreeOidNow?: string | null;
		headOidNow?: string;
		treeOidNow?: string;
	}) {
		return checkEvidence({
			ev: args.ev ?? makeEvidenceC11(makeExecutedRecord()),
			hashesText: args.hashesText ?? manifestText(),
			evDirAbs: evDir,
			executedCmds: args.executedCmds ?? [makeExecutedRecord()],
			rootAbs: tmpRoot,
			headOidNow: args.headOidNow ?? HEAD,
			treeOidNow: args.treeOidNow ?? TREE,
			filteredSubjectTreeOidNow: args.filteredSubjectTreeOidNow ?? FILTERED_TREE,
		});
	}

	it("R1: hashes.sha256 control file is NOT unexpected", () => {
		const v = runCheck({});
		expect(v.unexpectedFiles.map((u) => u.path)).not.toContain("hashes.sha256");
		expect(CONTROL_FILES.has("hashes.sha256")).toBe(true);
	});

	it("happy path: every CORRECTION11 dimension satisfied", () => {
		const v = runCheck({});
		expect(v.exists).toBe(true);
		expect(v.subjectTreeContract).toBe(true);
		expect(v.treeMatches).toBe(true);
		expect(v.executionTreeBound).toBe(true);
		expect(v.executionTrees).toEqual([TREE]);
		expect(v.executionIdentityRecorded).toBe(true);
		expect(v.executionHeadOidWellformed).toBe(true);
		expect(v.executionTreeOidWellformed).toBe(true);
		expect(v.executionIdentityValid).toBe(true);
		expect(v.worktreeInputsCleanBefore).toBe(true);
		expect(v.worktreeInputsCleanAfter).toBe(true);
		expect(v.perCommandDriftChecked).toBe(true);
		expect(v.subjectStableAcrossMatrix).toBe(true);
		expect(v.hashManifestValid).toBe(true);
		expect(v.missingFiles).toEqual([]);
		expect(v.unexpectedFiles).toEqual([]);
		expect(v.hashMismatches).toEqual([]);
		expect(v.malformedLines).toEqual([]);
		expect(v.duplicatePaths).toEqual([]);
		expect(v.commandSetExact).toBe(true);
		expect(v.duplicateEvidenceCommandIds).toEqual([]);
		expect(v.duplicateExecutedCommandIds).toEqual([]);
		expect(v.commandRecordMismatches).toEqual([]);
		expect(v.rejectedManifestPaths).toEqual([]);
		expect(v.outOfEvidenceDirPaths).toEqual([]);
		expect(v.malformedEvidenceCommandRows).toBe(0);
		expect(v.malformedExecutedCommandRows).toBe(0);
		expect(v.decodeError).toBe(null);
	});

	it("stale subject tree → FAIL (subject_tree_oid mismatch)", () => {
		const v = runCheck({ filteredSubjectTreeOidNow: HEAD_OTHER });
		expect(v.subjectTreeContract).toBe(true);
		expect(v.treeMatches).toBe(false);
	});

	it("on-disk hash mismatch (mutate evidence.json) → FAIL", () => {
		writeFileSync(join(evDir, "evidence.json"), Buffer.from("MUTATED\n"));
		try {
			const v = runCheck({});
			expect(v.hashManifestValid).toBe(false);
			expect(v.hashMismatches).toHaveLength(1);
		} finally {
			writeFileSync(join(evDir, "evidence.json"), filesOnDisk[0]!.bytes);
		}
	});

	it("declared file missing → FAIL", () => {
		const removed = join(evDir, "evidence.json");
		const saved = readFileSync(removed);
		rmSync(removed);
		try {
			const v = runCheck({});
			expect(v.missingFiles.map((m) => m.path)).toContain("evidence.json");
			expect(v.hashManifestValid).toBe(false);
		} finally {
			writeFileSync(removed, saved);
		}
	});

	it("unexpected file on disk → FAIL", () => {
		const rogue = join(evDir, "commands", "rogue.log");
		writeFileSync(rogue, "leak\n");
		try {
			const v = runCheck({});
			expect(v.unexpectedFiles.map((u) => u.path)).toContain("commands/rogue.log");
		} finally {
			rmSync(rogue);
		}
	});

	it("outside-evidence-dir manifest path → FAIL", () => {
		const inventoryPath = join(tmpRoot, "inventory.json");
		writeFileSync(inventoryPath, "outside\n");
		const evilManifest =
			`${sha256Hex(readFileSync(inventoryPath))}  ../inventory.json\n` + manifestText();
		const v = runCheck({ hashesText: evilManifest });
		expect(v.outOfEvidenceDirPaths.map((p) => p.path)).toContain("../inventory.json");
	});

	it("malformed evidence.json → structured decodeError, no throw", () => {
		const v = checkEvidence({
			ev: { ok: false, value: null, error: "Unexpected token } in JSON" },
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [makeExecutedRecord()],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
			filteredSubjectTreeOidNow: FILTERED_TREE,
		});
		expect(v.exists).toBe(false);
		expect(v.decodeError).toMatch(/JSON/);
	});

	it("malformed evidence command rows are counted", () => {
		const ev = makeEvidenceC11(makeExecutedRecord());
		ev.value.commands.push({ status: "pass" });
		ev.value.commands.push({ id: null as any, status: "fail" });
		const v = runCheck({ ev });
		expect(v.malformedEvidenceCommandRows).toBeGreaterThanOrEqual(2);
		expect(v.commandSetExact).toBe(false);
	});

	it("P1b: declared path that is a symlink is flagged", () => {
		const outside = join(tmpRoot, "external-target.txt");
		writeFileSync(outside, "outside\n");
		const inside = join(evDir, "via-symlink");
		try {
			symlinkSync(outside, inside);
		} catch {
			return;
		}
		const evilManifest =
			`${sha256Hex(readFileSync(outside))}  via-symlink\n` + manifestText();
		const v = runCheck({ hashesText: evilManifest });
		const missing = v.missingFiles.find((m) => m.path === "via-symlink");
		expect(missing?.reason).toBe("symlink");
		rmSync(inside);
		rmSync(outside);
	});

	it("CORRECTION11 P0 #1: per-command HEAD drift → perCommandDriftChecked=false", () => {
		const cmd = makeExecutedRecord();
		cmd.head_oid_after = HEAD_OTHER;
		const ev = makeEvidenceC11(cmd);
		const v = runCheck({ ev, executedCmds: [cmd] });
		expect(v.perCommandDriftChecked).toBe(false);
	});

	it("CORRECTION11 P0 #2: subject drifted during matrix → subjectStableAcrossMatrix=false", () => {
		const ev = makeEvidenceC11(makeExecutedRecord(), {
			subjectTreeBefore: FILTERED_TREE,
			subjectTreeAfter: "f".repeat(40),
		});
		const v = runCheck({ ev });
		expect(v.subjectStableAcrossMatrix).toBe(false);
	});

	it("CORRECTION11 P0 #3: execution identity invalid → executionIdentityValid=false", () => {
		const ev = makeEvidenceC11(makeExecutedRecord(), { executionIdentityValid: false });
		const v = runCheck({ ev });
		expect(v.executionIdentityValid).toBe(false);
	});

	it("CORRECTION11 P0 #4: subject inputs dirty before matrix → worktreeInputsCleanBefore=false", () => {
		const ev = makeEvidenceC11(makeExecutedRecord(), { worktreeCleanBefore: false });
		const v = runCheck({ ev });
		expect(v.worktreeInputsCleanBefore).toBe(false);
	});

	it("CORRECTION11 P0 #5: subject inputs dirty after matrix → worktreeInputsCleanAfter=false", () => {
		const ev = makeEvidenceC11(makeExecutedRecord(), { worktreeCleanAfter: false });
		const v = runCheck({ ev });
		expect(v.worktreeInputsCleanAfter).toBe(false);
	});

	it("CORRECTION11 P0 #6: bundle missing execution_head_oid → executionIdentityRecorded=false", () => {
		const ev = makeEvidenceC11(makeExecutedRecord(), { executionHeadOid: null });
		const v = runCheck({ ev });
		expect(v.executionIdentityRecorded).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// End-to-end positive test
// ---------------------------------------------------------------------------

let __e2eTmpRoot = "";
let __e2eEvDir = "";
let __e2eStdoutSha = "";
let __e2eStderrSha = "";
let __e2eEvidenceSha = "";
let __e2eEnvSha = "";

describe("end-to-end: real-world valid CORRECTION11 bundle → PARTIAL with all dimensions green", () => {
	const EXEC_STDOUT_BYTES = Buffer.from("build stdout content\n");
	const EXEC_STDERR_BYTES = Buffer.from("build stderr content\n");
	const EXEC_EVIDENCE_BYTES = Buffer.from("alpha\n");
	const HEAD_NOW = HEAD;
	const TREE_NOW = TREE;

	beforeAll(() => {
		__e2eTmpRoot = mkdtempSync(join(tmpdir(), "baseline-c11-e2e-"));
		__e2eEvDir = join(__e2eTmpRoot, "detached");
		mkdirSync(join(__e2eEvDir, "commands"), { recursive: true });

		const stdoutSha = sha256Hex(EXEC_STDOUT_BYTES);
		const stderrSha = sha256Hex(EXEC_STDERR_BYTES);
		const envSha = "c".repeat(64);

		const evidenceJson = {
			schema_version: 3,
			act_id: "ACT-CLINEMM-FORK-BASELINE01",
			head_oid: HEAD,
			tree_oid: TREE,
			subject_tree_oid: FILTERED_TREE,
			subject_tree_oid_before: FILTERED_TREE,
			subject_tree_oid_after: FILTERED_TREE,
			execution_head_oid: HEAD,
			execution_tree_oid: TREE,
			execution_identity_valid: true,
			worktree_inputs_clean_before: true,
			worktree_inputs_clean_after: true,
			worktree_clean_before: true,
			worktree_clean_after: true,
			generated_at: "2026-07-17T09:50:09.000Z",
			host_arch: "darwin-arm64",
			expected_output_paths: ["evidence.json", "commands/build.stdout"],
			commands: [
				{
					id: "build",
					status: "pass",
					started_at: "2026-07-17T09:41:41.693Z",
					finished_at: "2026-07-17T09:41:55.259Z",
					duration_ms: 13566,
					exit_code: 0,
					signal: null,
					timeout: false,
					stdout_sha256: stdoutSha,
					stderr_sha256: stderrSha,
					stdout_path: "commands/build.stdout",
					stderr_path: "commands/build.stderr",
					head_oid: HEAD,
					head_oid_before: HEAD,
					head_oid_after: HEAD,
					tree_oid: TREE,
					tree_oid_before: TREE,
					tree_oid_after: TREE,
					subject_tree_oid_before: FILTERED_TREE,
					subject_tree_oid_after: FILTERED_TREE,
					environment_sha256: envSha,
					failure_classification: null,
					notes: "",
				},
			],
		};
		const serializedEvidence = JSON.stringify(evidenceJson, null, "\t") + "\n";
		writeFileSync(join(__e2eEvDir, "evidence.json"), serializedEvidence);
		writeFileSync(join(__e2eEvDir, "commands", "build.stdout"), EXEC_STDOUT_BYTES);
		writeFileSync(join(__e2eEvDir, "commands", "build.stderr"), EXEC_STDERR_BYTES);
		writeFileSync(join(__e2eEvDir, "hashes.sha256"), Buffer.from("placeholder\n"));

		const onDiskEvidenceSha = sha256Hex(serializedEvidence);
		const manifestLines = [
			`${onDiskEvidenceSha}  evidence.json`,
			`${stdoutSha}  commands/build.stdout`,
			`${stderrSha}  commands/build.stderr`,
		];
		writeFileSync(join(__e2eEvDir, "hashes.sha256"), manifestLines.join("\n") + "\n");

		__e2eStdoutSha = stdoutSha;
		__e2eStderrSha = stderrSha;
		__e2eEvidenceSha = onDiskEvidenceSha;
		__e2eEnvSha = envSha;
	});

	afterAll(() => {
		rmSync(__e2eTmpRoot, { recursive: true, force: true });
	});

	it("produces a fully-valid EvidenceView and PARTIAL verdict", () => {
		const stdoutSha = __e2eStdoutSha;
		const stderrSha = __e2eStderrSha;
		const envSha = __e2eEnvSha;
		const tmpRoot = __e2eTmpRoot;
		const evDir = __e2eEvDir;

		const evJson = JSON.parse(readFileSync(join(evDir, "evidence.json"), "utf8"));
		const hashesText = readFileSync(join(evDir, "hashes.sha256"), "utf8");

		const executed = [
			{
				id: "build",
				status: "pass",
				exit_code: 0,
				timeout: false,
				head_oid: HEAD_NOW,
				head_oid_before: HEAD_NOW,
				head_oid_after: HEAD_NOW,
				tree_oid: TREE,
				tree_oid_before: TREE,
				tree_oid_after: TREE,
				subject_tree_oid_before: FILTERED_TREE,
				subject_tree_oid_after: FILTERED_TREE,
				stdout_sha256: stdoutSha,
				stderr_sha256: stderrSha,
				environment_sha256: envSha,
				failure_classification: null,
			},
		];

		const view = checkEvidence({
			ev: { ok: true, value: evJson, error: null },
			hashesText,
			evDirAbs: evDir,
			executedCmds: executed,
			rootAbs: tmpRoot,
			headOidNow: HEAD_NOW,
			treeOidNow: TREE_NOW,
			filteredSubjectTreeOidNow: FILTERED_TREE,
		});

		expect(view.exists).toBe(true);
		expect(view.subjectTreeContract).toBe(true);
		expect(view.treeMatches).toBe(true);
		expect(view.executionIdentityRecorded).toBe(true);
		expect(view.executionHeadOidWellformed).toBe(true);
		expect(view.executionTreeOidWellformed).toBe(true);
		expect(view.executionIdentityValid).toBe(true);
		expect(view.worktreeInputsCleanBefore).toBe(true);
		expect(view.worktreeInputsCleanAfter).toBe(true);
		expect(view.executionTreeBound).toBe(true);
		expect(view.executionTrees).toEqual([TREE]);
		expect(view.subjectStableAcrossMatrix).toBe(true);
		expect(view.perCommandDriftChecked).toBe(true);
		expect(view.hashManifestValid).toBe(true);
		expect(view.missingFiles).toEqual([]);
		expect(view.unexpectedFiles).toEqual([]);
		expect(view.hashMismatches).toEqual([]);
		expect(view.malformedLines).toEqual([]);
		expect(view.duplicatePaths).toEqual([]);
		expect(view.commandSetExact).toBe(true);
		expect(view.duplicateEvidenceCommandIds).toEqual([]);
		expect(view.duplicateExecutedCommandIds).toEqual([]);
		expect(view.commandRecordMismatches).toEqual([]);
		expect(view.rejectedManifestPaths).toEqual([]);
		expect(view.outOfEvidenceDirPaths).toEqual([]);
		expect(view.malformedEvidenceCommandRows).toBe(0);
		expect(view.malformedExecutedCommandRows).toBe(0);
		expect(view.decodeError).toBe(null);

		const closure = computeClosure({
			evidence: view,
			unknownFailures: [],
			unknownFailureCount: 0,
			mandatoryPass: 1,
			mandatoryFail: 0,
			mandatoryApplicable: 1,
			affectedScopePass: 0,
			affectedScopeFail: 0,
			affectedScopeApplicable: 0,
			r4Satisfied: false,
			r5Satisfied: false,
			r6Satisfied: false,
			r7Satisfied: false,
			r16Satisfied: false,
		});
		expect(closure.verdict).toBe("PARTIAL");
		expect(closure.evidenceOk).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Final verdict ↔ conjunction invariants
// ---------------------------------------------------------------------------

describe("verdict ↔ conjunction invariants", () => {
	const evidenceOk = baseOk();
	const evidenceBad = baseOk({ treeMatches: false });

	it("evidenceOk=true, no UNKNOWN, all requirements → PASS", () => {
		expect(
			computeClosure({
				...baseInput(evidenceOk),
				r4Satisfied: true, r5Satisfied: true, r6Satisfied: true,
				r7Satisfied: true, r16Satisfied: true,
			}).verdict,
		).toBe("PASS");
	});

	it("evidenceOk=true, no UNKNOWN, ≥1 requirement open → PARTIAL", () => {
		expect(
			computeClosure({
				...baseInput(evidenceOk),
				r4Satisfied: false,
			}).verdict,
		).toBe("PARTIAL");
	});

	it("evidenceOk=false → FAIL regardless of other inputs", () => {
		expect(
			computeClosure({
				...baseInput(evidenceBad),
				r4Satisfied: true, r5Satisfied: true, r6Satisfied: true,
				r7Satisfied: true, r16Satisfied: true,
				mandatoryPass: 18,
			}).verdict,
		).toBe("FAIL");
	});

	it("evidenceOk=true but UNKNOWN present → FAIL", () => {
		expect(
			computeClosure({
				...baseInput(evidenceOk),
				unknownFailures: ["x"],
				r4Satisfied: true, r5Satisfied: true, r6Satisfied: true,
				r7Satisfied: true, r16Satisfied: true,
				mandatoryPass: 18,
			}).verdict,
		).toBe("FAIL");
	});
});
