#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION13 — Renderer/closure tests.
 *
 * Pure-function tests on ./baseline-closure.ts. Uses bun:test (node-side
 * unit suite) so it can be invoked directly via
 * `bun test factory/scripts/render-baseline-report.test.ts`.
 *
 * These tests pin the fail-closed behavior across CORRECTION05–13.
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
		executionHeadExists: true,
		executionTreeExists: true,
		derivedExecutionTreeOid: TREE,
		runnerExecutionIdentityAssertion: true,
		executionIdentityAssertionAgrees: true,
		executionIdentityValid: true,
		executionTreeBound: true,
		executionTrees: [TREE],
		worktreeInputsCleanBefore: true,
		worktreeInputsCleanAfter: true,
		perCommandDriftChecked: true,
		subjectStableAcrossMatrix: true,
		manifestContractHonored: true,
		hashManifestValid: true,
		bundledResultPathInvalid: null,
		bundledResultCommandSetExact: true,
		bundledResultExtraCommands: [],
		bundledResultMissingCommands: [],
		rowRelationalInvariantViolations: [],
		metadataFileMismatches: [],
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
// CORRECTION13 pinned cases — self-contained bundle + relational invariants
// ---------------------------------------------------------------------------

describe("computeClosure — CORRECTION13 fail-closed pinned cases", () => {
	it("P0 #1: bundled verification-results.json path invalid → FAIL with BUNDLED_RESULT_PATH_INVALID", () => {
		const r = computeClosure(
			baseInput({
				bundledResultPathInvalid: {path: "verification-results.json", reason: "traversal"},
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("BUNDLED_RESULT_PATH_INVALID");
	});

	it("P0 #2: bundled verification-results.json command set disagrees → FAIL with BUNDLED_RESULT_COMMAND_SET_MISMATCH", () => {
		const r = computeClosure(
			baseInput({
				bundledResultCommandSetExact: false,
				bundledResultExtraCommands: ["ghost"],
				bundledResultMissingCommands: ["build"],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("BUNDLED_RESULT_COMMAND_SET_MISMATCH");
	});

	it("P0 #3: row relational invariant violated → FAIL with ROW_RELATIONAL_INVARIANT_VIOLATION", () => {
		const r = computeClosure(
			baseInput({
				rowRelationalInvariantViolations: [
					{id: "build", fields: ["failure_classification"], role: "evidence"},
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("ROW_RELATIONAL_INVARIANT_VIOLATION");
	});

	it("P0 #4: metadata file content disagrees with row → FAIL with METADATA_FILE_MISMATCH", () => {
		const r = computeClosure(
			baseInput({
				metadataFileMismatches: [
					{id: "build", fields: ["status", "head_oid"]},
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("METADATA_FILE_MISMATCH");
	});

	it("P0 #5: tracked_input_change_observed=true does NOT block closure (advisory hint only)", () => {
		const r = computeClosure(baseInput());
		// verify perCommandInputsClean is no longer a closure dimension.
		expect(r.evidenceOk).toBe(true);
		expect(r.verdict).toBe("PARTIAL");
		expect(r.reasonCodes).not.toContain("REPOSITORY_DRIFT");
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

	it("isEvidenceOk directly matches the audit-pinned conjunction (CORRECTION13)", () => {
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
		e.executionHeadExists &&
		e.executionTreeExists &&
		e.executionIdentityAssertionAgrees &&
		e.executionIdentityValid &&
		e.worktreeInputsCleanBefore === true &&
		e.worktreeInputsCleanAfter === true &&
		e.subjectStableAcrossMatrix &&
		e.perCommandDriftChecked &&
		e.manifestContractHonored &&
		e.bundledResultPathInvalid === null &&
		e.bundledResultCommandSetExact !== false &&
		e.rowRelationalInvariantViolations.length === 0 &&
		e.metadataFileMismatches.length === 0 &&
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

	it("accepts verification-results.json as an opaque path", () => {
		const r = resolveEvidencePayloadPath(evDir, root, "verification-results.json");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.abs).toBe(join(evDir, "verification-results.json"));
	});

	it("accepts evidence.json as an opaque path", () => {
		const r = resolveEvidencePayloadPath(evDir, root, "evidence.json");
		expect(r.ok).toBe(true);
	});

	it("rejects absolute paths with reason='absolute'", () => {
		const r = resolveEvidencePayloadPath(evDir, root, "/etc/passwd");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.reason).toBe("absolute");
		}
	});

	it("rejects paths that escape evDir but stay inside repo with reason='outside-evidence-dir'", () => {
		const r = resolveEvidencePayloadPath(evDir, root, "../../../package.json");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.reason).toBe("outside-evidence-dir");
		}
	});
});

// ---------------------------------------------------------------------------
// checkEvidence pipeline (CORRECTION13)
// ---------------------------------------------------------------------------

describe("checkEvidence — self-contained bundle (CORRECTION13)", () => {
	let tmpRoot: string;
	let evDir: string;

	const manifest = new Map<string, string>();
	const filesOnDisk: Array<{ rel: string; bytes: Buffer }> = [];

	beforeAll(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "baseline-c13-"));
		evDir = join(tmpRoot, "detached");
		mkdirSync(join(evDir, "commands"), {recursive: true});

		const a = Buffer.from("alpha\n");
		const b = Buffer.from("bravo\n");
		const c = Buffer.from("");
		const d = Buffer.from("{}\n");
		const e = Buffer.from(JSON.stringify({executed_commands: [], commands: []}, null, 2));
		writeFileSync(join(evDir, "evidence.json"), a);
		writeFileSync(join(evDir, "verification-results.json"), e);
		writeFileSync(join(evDir, "commands", "build.stdout"), b);
		writeFileSync(join(evDir, "commands", "build.stderr"), c);
		writeFileSync(join(evDir, "commands", "build.metadata.json"), d);
		writeFileSync(
			join(evDir, "hashes.sha256"),
			Buffer.from("placeholder manifest, controlled by runner\n"),
		);
		manifest.set("evidence.json", sha256Hex(a));
		manifest.set("verification-results.json", sha256Hex(e));
		manifest.set("commands/build.stdout", sha256Hex(b));
		manifest.set("commands/build.stderr", sha256Hex(c));
		manifest.set("commands/build.metadata.json", sha256Hex(d));
		filesOnDisk.push({rel: "evidence.json", bytes: a});
		filesOnDisk.push({rel: "verification-results.json", bytes: e});
		filesOnDisk.push({rel: "commands/build.stdout", bytes: b});
		filesOnDisk.push({rel: "commands/build.stderr", bytes: c});
		filesOnDisk.push({rel: "commands/build.metadata.json", bytes: d});
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
			stdout_sha256: sha256Hex(filesOnDisk[2]!.bytes),
			stderr_sha256: sha256Hex(filesOnDisk[3]!.bytes),
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
			stdout_path: "commands/build.stdout",
			stderr_path: "commands/build.stderr",
			metadata_path: "commands/build.metadata.json",
			tracked_input_change_observed: false,
			tracked_input_monitor_degraded: false,
			observed_tracked_input_paths: [],
			unexpected_paths_after: [],
			notes: "",
			...extra,
		};
	}

	function makeEvidenceC13(cmd: any, opts: {
		subjectTree?: string | null;
		subjectTreeBefore?: string | null;
		subjectTreeAfter?: string | null;
		executionHeadOid?: string | null;
		executionTreeOid?: string | null;
		executionIdentityValid?: boolean | null;
		worktreeCleanBefore?: boolean | null;
		worktreeCleanAfter?: boolean | null;
		expectedPayloadPaths?: string[] | null;
		trackedInputChangeObserved?: boolean;
		unexpectedPathsAfter?: string[];
		notes?: string;
		metadataOverride?: Record<string, unknown>;
	} = {}): { ok: boolean; value: any; error: string | null } {
		const subjectTree = opts.subjectTree === undefined ? FILTERED_TREE : opts.subjectTree;
		const subjectTreeBefore =
			opts.subjectTreeBefore === undefined ? FILTERED_TREE : opts.subjectTreeBefore;
		const subjectTreeAfter =
			opts.subjectTreeAfter === undefined ? FILTERED_TREE : opts.subjectTreeAfter;
		const executionHeadOid = opts.executionHeadOid === undefined ? HEAD : opts.executionHeadOid;
		const executionTreeOid = opts.executionTreeOid === undefined ? TREE : opts.executionTreeOid;
		const executionIdentityValid =
			opts.executionIdentityValid === undefined ? true : opts.executionIdentityValid;
		const worktreeCleanBefore =
			opts.worktreeCleanBefore === undefined ? true : opts.worktreeCleanBefore;
		const worktreeCleanAfter =
			opts.worktreeCleanAfter === undefined ? true : opts.worktreeCleanAfter;
		const expectedPayloadPaths = opts.expectedPayloadPaths === undefined
			? [
				"evidence.json",
				"verification-results.json",
				"commands/build.stdout",
				"commands/build.stderr",
				"commands/build.metadata.json",
			]
			: opts.expectedPayloadPaths;
		const trackedInputChangeObserved = opts.trackedInputChangeObserved ?? false;
		const unexpectedPathsAfter = opts.unexpectedPathsAfter ?? [];
		const notes = opts.notes ?? "";
		const evidenceCommand = {
			...cmd,
			...opts.metadataOverride,
		};
		const obj: any = {
			schema_version: 4,
			act_id: "ACT-CLINEMM-FORK-BASELINE01",
			head_oid: HEAD,
			tree_oid: TREE,
			subject_tree_oid: subjectTree,
			subject_tree_oid_before: subjectTreeBefore,
			subject_tree_oid_after: subjectTreeAfter,
			execution_head_oid: executionHeadOid,
			execution_tree_oid: executionTreeOid,
			execution_identity_valid: executionIdentityValid,
			worktree_inputs_clean_before: worktreeCleanBefore,
			worktree_inputs_clean_after: worktreeCleanAfter,
			worktree_inputs_clean_before_unexpected: [],
			worktree_inputs_clean_after_unexpected: [],
			expected_evidence_payload_paths: expectedPayloadPaths,
			worktree_clean_before: worktreeCleanBefore,
			worktree_clean_after: worktreeCleanAfter,
			generated_at: "2026-07-17T09:50:09.000Z",
			host_arch: "darwin-arm64",
			commands: [evidenceCommand],
		};
		return wrapEvidence(obj);
	}

	function runCheck(args: {
		ev?: { ok: boolean; value: any; error: string | null };
		hashesText?: string;
		executedCmds?: any[];
		filteredSubjectTreeOidNow?: string | null;
		headOidNow?: string;
		treeOidNow?: string;
		bundledResultRows?: any[] | null;
		rowMetadataBytes?: Map<string, Buffer>;
	}) {
		let bundledJson: any = { executed_commands: args.executedCmds ?? [makeExecutedRecord()], commands: [] };
		if (args.bundledResultRows !== null) {
			bundledJson = {
				executed_commands: args.bundledRows ?? [],
				commands: [],
			};
		}
		writeFileSync(join(evDir, "verification-results.json"), JSON.stringify(bundledJson, null, 2));
		manifest.set("verification-results.json", sha256Hex(readFileSync(join(evDir, "verification-results.json"))));
		if (args.rowMetadataBytes) {
			for (const [id, bytes] of args.rowMetadataBytes) {
				const path = join(evDir, "commands", `${id}.metadata.json`);
				writeFileSync(path, bytes);
			}
		}
		return checkEvidence({
			ev: args.ev ?? makeEvidenceC13(makeExecutedRecord()),
			hashesText: args.hashesText ?? manifestText(),
			evDirAbs: evDir,
			executedCmds: args.executedCmds ?? [makeExecutedRecord()],
			bundledResultPath: "verification-results.json",
			rootAbs: tmpRoot,
			headOidNow: args.headOidNow ?? HEAD,
			treeOidNow: args.treeOidNow ?? TREE,
			filteredSubjectTreeOidNow: args.filteredSubjectTreeOidNow ?? FILTERED_TREE,
			executionIdentityDerivation: {
				executionHeadExists: true,
				executionTreeExists: true,
				derivedTreeOid: TREE,
			},
		});
	}

	it("P0 #1: bundled verification-results.json hash mismatch → FAIL with BUNDLED_RESULT_COMMAND_SET_MISMATCH", () => {
		// Tamper the bundled verification-results.json AFTER it is
		// written so the manifest hash no longer matches. The renderer
		// must detect the mismatch and refuse to validate the bundle.
		const v0 = runCheck({});
		const tamperedResultsPath = join(evDir, "verification-results.json");
		const tamperedBytes = Buffer.from("[]\n");
		writeFileSync(tamperedResultsPath, tamperedBytes);
		const newHash = sha256Hex(tamperedBytes);
		const manifestText = readFileSync(join(evDir, "hashes.sha256"), "utf8");
		writeFileSync(
			join(evDir, "hashes.sha256"),
			manifestText.replace(
				/^[0-9a-f]{64}  verification-results\.json$/m,
				`${newHash}  verification-results.json`,
			),
		);
		const v = checkEvidence({
			ev: loadEvidenceFile(join(evDir, "evidence.json")),
			hashesText: readFileSync(join(evDir, "hashes.sha256"), "utf8"),
			evDirAbs: evDir,
			executedCmds: [makeExecutedRecord()],
			bundledResultPath: "verification-results.json",
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
			filteredSubjectTreeOidNow: FILTERED_TREE,
			executionIdentityDerivation: {
				executionHeadExists: true,
				executionTreeExists: true,
				derivedTreeOid: TREE,
			},
		});
		expect(v.bundledResultCommandSetExact).toBe(false);
		expect(v.evidenceOk).toBe(false);
	});

	it("P0 #2: metadata file disagrees with evidence row → FAIL with METADATA_FILE_MISMATCH", () => {
		const row = makeExecutedRecord();
		// Tamper the metadata file so it disagrees with the evidence row.
		// Re-verify after both runCheck calls in case the manifest was
		// rewritten by an earlier invocation.
		runCheck({
			executedCmds: [row],
			rowMetadataBytes: new Map([
				[
					"build",
					Buffer.from(
						JSON.stringify({...row, head_oid_before: "f".repeat(40)}, null, 2),
					),
				],
			]),
		});
		const v = runCheck({executedCmds: [row]});
		expect(v.metadataFileMismatches.length).toBeGreaterThanOrEqual(1);
	});

	it("P0 #3: fail row with non-null classification → PASSES row invariant (no violation)", () => {
		const v = runCheck({
			executedCmds: [
				makeExecutedRecord({status: "fail", exit_code: 1, failure_classification: "ENVIRONMENTAL"}),
			],
		});
		expect(v.rowRelationalInvariantViolations.length).toBe(0);
	});

	it("P0 #4: fail row with null classification → FAIL with ROW_RELATIONAL_INVARIANT_VIOLATION", () => {
		const v = runCheck({
			executedCmds: [
				makeExecutedRecord({status: "fail", exit_code: 1, failure_classification: null}),
			],
		});
		expect(v.rowRelationalInvariantViolations.length).toBe(1);
	});

	it("P0 #5: true spawn error still produces all three payloads and a usable bundle", () => {
		// The runner treats a true spawn error (exit_code = -1) as a
		// fail row with an UNKNOWN failure classification. CORRECTION14
		// requires status=pass ⇔ exit_code=0; a fail row is the host-agnostic
		// way to surface a real spawn error in the closure without depending
		// on bun's spawn semantics.
		const v = runCheck({
			executedCmds: [
				makeExecutedRecord({
					id: "nonexistent",
					status: "fail",
					exit_code: -1,
					signal: null,
					timeout: false,
					failure_classification: "UNKNOWN",
					notes: "spawn error: ENOENT",
				}),
			],
		});
		expect(v.commandSetExact).toBe(true);
		expect(v.rowRelationalInvariantViolations.length).toBe(0);
		expect(v.metadataFileMismatches.length).toBe(0);
		expect(isEvidenceOk(v)).toBe(true);
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
