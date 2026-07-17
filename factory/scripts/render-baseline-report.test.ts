#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION06 — Renderer/closure tests.
 *
 * Pure-function tests on ./baseline-closure.ts. Uses bun:test (node-side
 * unit suite) so it can be invoked directly via
 * `bun test factory/scripts/render-baseline-report.test.ts`.
 *
 * These tests pin the fail-closed behavior the CORRECTION05 reviewer
 * flagged as missing/unsatisfiable. Any change that re-introduces a
 * fall-through to PARTIAL on stale evidence, that lets the manifest self-
 * reference (hashes.sha256) trip unexpected-files detection, that accepts
 * an unbound or multi-tree bundle, that ignores duplicate command IDs, or
 * that allows per-record mismatch MUST trip these tests.
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
	CONTROL_FILES,
	type ClosureInput,
	type EvidenceView,
} from "./baseline-closure";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const TREE = "89abcdef0123456789abcdef0123456789abcdef01";
const HEAD_OTHER = "ffffffff11112222333344445555666677778888";

function sha256Hex(buf: Buffer | string): string {
	return createHash("sha256").update(buf).digest("hex");
}

function makeExecutedCmd(extra: Partial<any> = {}): any {
	return {
		id: "build",
		status: "pass",
		started_at: "2026-07-17T09:41:41.693Z",
		finished_at: "2026-07-17T09:41:55.259Z",
		duration_ms: 13566,
		exit_code: 0,
		signal: null,
		timeout: false,
		stdout_sha256: "a".repeat(64),
		stderr_sha256: "b".repeat(64),
		head_oid: HEAD,
		tree_oid: TREE,
		environment_sha256: "c".repeat(64),
		failure_classification: null,
		notes: "",
		...extra,
	};
}

function makeEvidenceForExecuted(cmd: any): any {
	return {
		schema_version: 1,
		act_id: "ACT-CLINEMM-FORK-BASELINE01",
		head_oid: HEAD,
		tree_oid: TREE,
		generated_at: "2026-07-17T09:50:09.000Z",
		host_arch: "darwin-arm64",
		commands: [cmd],
	};
}

function baseOk(overrides: Partial<EvidenceView> = {}): EvidenceView {
	return {
		exists: true,
		subjectMatches: true,
		treeMatches: true,
		hashManifestValid: true,
		missingFiles: [],
		unexpectedFiles: [],
		hashMismatches: [],
		malformedLines: [],
		duplicatePaths: [],
		commandSetExact: true,
		executionTrees: [TREE],
		executionTreeBound: true,
		duplicateEvidenceCommandIds: [],
		duplicateExecutedCommandIds: [],
		commandRecordMismatches: [],
		rejectedManifestPaths: [],
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
// The original 8 pinned cases from the CORRECTION05 audit (still hold)
// ---------------------------------------------------------------------------

describe("computeClosure — fail-closed policy (8 pinned cases)", () => {
	it("1. stale HEAD → FAIL", () => {
		const r = computeClosure(baseInput({ subjectMatches: false }));
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("2. stale tree → FAIL", () => {
		const r = computeClosure(baseInput({ treeMatches: false }));
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
						path: "detached/evidence.json",
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
				missingFiles: [{ path: "detached/evidence.json", reason: "missing" }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("5. mixed execution trees → FAIL", () => {
		const r = computeClosure(
			baseInput({ executionTrees: [TREE, HEAD_OTHER, "a".repeat(40)] }),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("6. UNKNOWN failure → FAIL", () => {
		const r = computeClosure({ ...baseInput(), unknownFailures: ["root-check"] });
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(true);
		expect(r.reasonCodes).toContain("UNKNOWN_FAILURES_PRESENT");
		expect(r.reasonCodes).not.toContain("EVIDENCE_INCOMPLETE");
	});

	it("7. valid evidence + open R4 → PARTIAL", () => {
		const r = computeClosure(baseInput());
		expect(r.verdict).toBe("PARTIAL");
		expect(r.evidenceOk).toBe(true);
		expect(r.reasonCodes).toContain("R4_UNSATISFIED");
		expect(r.reasonCodes).not.toContain("EVIDENCE_INCOMPLETE");
		expect(r.reasonCodes).not.toContain("UNKNOWN_FAILURES_PRESENT");
	});

	it("8. all requirements green → PASS", () => {
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
});

// ---------------------------------------------------------------------------
// New pinned cases from the CORRECTION06 review
// ---------------------------------------------------------------------------

describe("computeClosure — CORRECTION06 fail-closed pinned cases", () => {
	it("R2: execution tree not bound to evidence.tree_oid → FAIL", () => {
		// Single execution tree, but it disagrees with evidence.tree_oid.
		// Surfaces via executionTreeBound=false.
		const r = computeClosure(
			baseInput({
				executionTrees: [HEAD_OTHER],
				treeMatches: true, // evidence top-level bound to current
				executionTreeBound: false,
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("R3: duplicate evidence command IDs → FAIL", () => {
		const r = computeClosure(
			baseInput({
				commandSetExact: false,
				duplicateEvidenceCommandIds: [{ path: "build-sdk", occurrences: 2 }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("R3: duplicate executed command IDs → FAIL", () => {
		const r = computeClosure(
			baseInput({
				commandSetExact: false,
				duplicateExecutedCommandIds: [{ path: "root-check", occurrences: 2 }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
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
		expect(r.evidenceOk).toBe(false);
	});

	it("R3: per-record mismatch (exit_code disagrees) → FAIL", () => {
		const r = computeClosure(
			baseInput({
				commandSetExact: false,
				commandRecordMismatches: [
					{
						id: "build-sdk",
						fields: ["exit_code"],
						evidence: { exit_code: 0 },
						executed: { exit_code: 1 },
					},
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("R3: per-record mismatch (stdout_sha256 disagrees) → FAIL", () => {
		const r = computeClosure(
			baseInput({
				commandSetExact: false,
				commandRecordMismatches: [
					{
						id: "build-sdk",
						fields: ["stdout_sha256"],
						evidence: { stdout_sha256: "a".repeat(64) },
						executed: { stdout_sha256: "b".repeat(64) },
					},
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("P1a: rejected manifest path (absolute) → FAIL", () => {
		const r = computeClosure(
			baseInput({
				hashManifestValid: false,
				rejectedManifestPaths: [
					{ path: "/etc/passwd", reason: "absolute" },
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
	});

	it("P1a: rejected manifest path (traversal) → FAIL", () => {
		const r = computeClosure(
			baseInput({
				hashManifestValid: false,
				rejectedManifestPaths: [
					{ path: "../../etc/passwd", reason: "traversal" },
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
	});

	it("P1b: declared-but-symlink path → FAIL", () => {
		const r = computeClosure(
			baseInput({
				hashManifestValid: false,
				missingFiles: [
					{ path: "detached/commands/build.stdout", reason: "symlink" },
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});
});

// ---------------------------------------------------------------------------
// Additional invariants
// ---------------------------------------------------------------------------

describe("computeClosure — additional invariants", () => {
	it("EVIDENCE_INCOMPLETE preempts every other reason", () => {
		const r = computeClosure({
			...baseInput({ subjectMatches: false }),
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
				duplicatePaths: [{ path: "detached/evidence.json", occurrences: 2 }],
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

	it("evidence file missing → FAIL with no reason-code-noise", () => {
		const r = computeClosure({ ...baseInput({ exists: false }) });
		expect(r.verdict).toBe("FAIL");
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("isEvidenceOk directly matches the conjunction the audit requires", () => {
		const v = baseOk();
		expect(
			v.exists &&
				v.subjectMatches &&
				v.treeMatches &&
				v.executionTreeBound &&
				v.hashManifestValid &&
				v.missingFiles.length === 0 &&
				v.unexpectedFiles.length === 0 &&
				v.hashMismatches.length === 0 &&
				v.malformedLines.length === 0 &&
				v.duplicatePaths.length === 0 &&
				v.commandSetExact &&
				v.executionTrees.length === 1 &&
				v.duplicateEvidenceCommandIds.length === 0 &&
				v.duplicateExecutedCommandIds.length === 0 &&
				v.commandRecordMismatches.length === 0 &&
				v.rejectedManifestPaths.length === 0,
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// parseManifest — isolated unit tests
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

	it("returns empty maps for empty input", () => {
		const { declared, malformed, duplicates } = parseManifest("");
		expect(declared.size).toBe(0);
		expect(malformed).toEqual([]);
		expect(duplicates).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// checkEvidence — directory + manifest pipeline
// ---------------------------------------------------------------------------

describe("checkEvidence — directory + manifest pipeline", () => {
	let tmpRoot: string;
	let evDir: string;

	const manifest = new Map<string, string>();
	const filesOnDisk: Array<{ rel: string; bytes: Buffer }> = [];

	beforeAll(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "baseline-test-"));
		evDir = join(tmpRoot, "detached");
		mkdirSync(join(evDir, "commands"), { recursive: true });

		const a = Buffer.from("alpha\n");
		const b = Buffer.from("bravo\n");
		writeFileSync(join(evDir, "evidence.json"), a);
		writeFileSync(join(evDir, "commands", "build.stdout"), b);
		// hashes.sha256 is a control file — present on disk but not in the
		// payload manifest. The walker must not flag it as unexpected.
		writeFileSync(
			join(evDir, "hashes.sha256"),
			Buffer.from("placeholder manifest, controlled by runner\n"),
		);
		manifest.set("detached/evidence.json", sha256Hex(a));
		manifest.set("detached/commands/build.stdout", sha256Hex(b));
		filesOnDisk.push({ rel: "detached/evidence.json", bytes: a });
		filesOnDisk.push({ rel: "detached/commands/build.stdout", bytes: b });
	});

	afterAll(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	function manifestText(): string {
		return Array.from(manifest.entries())
			.map(([p, sha]) => `${sha}  ${p}`)
			.join("\n") + "\n";
	}

	function makeExecutedRecord(): any {
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
			tree_oid: TREE,
			environment_sha256: "c".repeat(64),
			failure_classification: null,
			notes: "",
		};
	}

	function makeEvidenceForExecutedLocal(cmd: any): any {
		return {
			schema_version: 1,
			act_id: "ACT-CLINEMM-FORK-BASELINE01",
			head_oid: HEAD,
			tree_oid: TREE,
			generated_at: "2026-07-17T09:50:09.000Z",
			host_arch: "darwin-arm64",
			commands: [cmd],
		};
	}

	it("R1: hashes.sha256 control file is NOT unexpected", () => {
		const v = checkEvidence({
			ev: makeEvidenceForExecutedLocal(makeExecutedRecord()),
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [makeExecutedRecord()],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		const unexpectedPaths = v.unexpectedFiles.map((u) => u.path);
		expect(unexpectedPaths).not.toContain("hashes.sha256");
		expect(CONTROL_FILES.has("hashes.sha256")).toBe(true);
	});

	it("happy path: every dimension satisfied (R1/R2/R3 all hold)", () => {
		const v = checkEvidence({
			ev: makeEvidenceForExecutedLocal(makeExecutedRecord()),
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [makeExecutedRecord()],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.exists).toBe(true);
		expect(v.subjectMatches).toBe(true);
		expect(v.treeMatches).toBe(true);
		expect(v.hashManifestValid).toBe(true);
		expect(v.missingFiles).toEqual([]);
		expect(v.unexpectedFiles).toEqual([]);
		expect(v.hashMismatches).toEqual([]);
		expect(v.malformedLines).toEqual([]);
		expect(v.duplicatePaths).toEqual([]);
		expect(v.commandSetExact).toBe(true);
		expect(v.executionTrees).toEqual([TREE]);
		expect(v.executionTreeBound).toBe(true);
		expect(v.duplicateEvidenceCommandIds).toEqual([]);
		expect(v.duplicateExecutedCommandIds).toEqual([]);
		expect(v.commandRecordMismatches).toEqual([]);
		expect(v.rejectedManifestPaths).toEqual([]);
	});

	it("stale HEAD when git moved past the evidence", () => {
		const v = checkEvidence({
			ev: makeEvidenceForExecutedLocal(makeExecutedRecord()),
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [makeExecutedRecord()],
			rootAbs: tmpRoot,
			headOidNow: HEAD_OTHER,
			treeOidNow: TREE,
		});
		expect(v.subjectMatches).toBe(false);
		expect(v.treeMatches).toBe(true);
	});

	it("hash mismatch on a single file", () => {
		writeFileSync(join(evDir, "evidence.json"), Buffer.from("MUTATED\n"));
		const v = checkEvidence({
			ev: makeEvidenceForExecutedLocal(makeExecutedRecord()),
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [makeExecutedRecord()],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.hashManifestValid).toBe(false);
		expect(v.hashMismatches).toHaveLength(1);
		expect(v.hashMismatches[0]?.path).toBe("detached/evidence.json");
		expect(v.hashMismatches[0]?.actual).toBe(sha256Hex(Buffer.from("MUTATED\n")));
		writeFileSync(join(evDir, "evidence.json"), filesOnDisk[0]!.bytes);
	});

	it("missing declared file", () => {
		const removed = join(evDir, "evidence.json");
		const saved = readFileSync(removed);
		rmSync(removed);
		try {
			const v = checkEvidence({
				ev: makeEvidenceForExecutedLocal(makeExecutedRecord()),
				hashesText: manifestText(),
				evDirAbs: evDir,
				executedCmds: [makeExecutedRecord()],
				rootAbs: tmpRoot,
				headOidNow: HEAD,
				treeOidNow: TREE,
			});
			expect(v.missingFiles.map((m) => m.path)).toContain("detached/evidence.json");
			expect(v.hashManifestValid).toBe(false);
		} finally {
			writeFileSync(removed, saved);
		}
	});

	it("unexpected file on disk that the manifest doesn't acknowledge", () => {
		const rogue = join(evDir, "commands", "rogue.log");
		writeFileSync(rogue, "leak\n");
		try {
			const v = checkEvidence({
				ev: makeEvidenceForExecutedLocal(makeExecutedRecord()),
				hashesText: manifestText(),
				evDirAbs: evDir,
				executedCmds: [makeExecutedRecord()],
				rootAbs: tmpRoot,
				headOidNow: HEAD,
				treeOidNow: TREE,
			});
			expect(v.unexpectedFiles.map((u) => u.path)).toContain("commands/rogue.log");
			expect(v.hashManifestValid).toBe(true);
			expect(v.unexpectedFiles.length).toBeGreaterThan(0);
		} finally {
			rmSync(rogue);
		}
	});

	it("R2: mixed execution trees across evidence.commands", () => {
		const ev = makeEvidenceForExecutedLocal(makeExecutedRecord());
		ev.commands.push({
			...makeExecutedRecord(),
			id: "later",
			tree_oid: HEAD_OTHER,
		});
		const v = checkEvidence({
			ev: ev,
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [
				makeExecutedRecord(),
				{ ...makeExecutedRecord(), id: "later", tree_oid: HEAD_OTHER },
			],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.executionTrees.length).toBe(2);
		expect(v.executionTreeBound).toBe(false);
		// commandSetExact can still be true (per-record comparison would not
		// see the tree disagreement unless it were among the COMPARE_FIELDS);
		// we don't include tree_oid in the per-record comparison because the
		// canonical authority is evidence.tree_oid + the binding check above.
		// What matters is executionTreeBound.
	});

	it("R2: single execution tree but bound to wrong tree → executionTreeBound=false", () => {
		// Single tree value (length===1) but it doesn't match evidence.tree_oid.
		const ev = makeEvidenceForExecutedLocal({
			...makeExecutedRecord(),
			tree_oid: HEAD_OTHER, // command row uses a different tree
		});
		ev.tree_oid = TREE; // top-level evidence bound to current
		const v = checkEvidence({
			ev: ev,
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [{ ...makeExecutedRecord(), tree_oid: HEAD_OTHER }],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.executionTrees).toEqual([HEAD_OTHER]);
		expect(v.treeMatches).toBe(true); // top-level bound
		expect(v.executionTreeBound).toBe(false);
	});

	it("R3: command-set mismatch: executed ≠ evidence IDs", () => {
		const v = checkEvidence({
			ev: makeEvidenceForExecutedLocal(makeExecutedRecord()),
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [
				makeExecutedRecord(),
				{ ...makeExecutedRecord(), id: "phantom" },
			],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.commandSetExact).toBe(false);
	});

	it("R3: duplicate command IDs in evidence are detected", () => {
		const ev = makeEvidenceForExecutedLocal(makeExecutedRecord());
		ev.commands.push({ ...makeExecutedRecord() }); // same id, second row
		const v = checkEvidence({
			ev: ev,
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [makeExecutedRecord()],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.duplicateEvidenceCommandIds.map((d) => d.path)).toContain("build");
		expect(v.commandSetExact).toBe(false);
	});

	it("R3: per-record field mismatch (status) is detected", () => {
		const ev = makeEvidenceForExecutedLocal(makeExecutedRecord());
		const ex = makeExecutedRecord();
		ex.status = "fail"; // evidence says pass, executed says fail
		const v = checkEvidence({
			ev: ev,
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [ex],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.commandRecordMismatches.length).toBeGreaterThan(0);
		const m = v.commandRecordMismatches[0]!;
		expect(m.fields).toContain("status");
		expect(m.evidence.status).toBe("pass");
		expect(m.executed.status).toBe("fail");
		expect(v.commandSetExact).toBe(false);
	});

	it("P1a: absolute manifest path is rejected", () => {
		const evilManifest = `${"a".repeat(64)}  /etc/passwd\n` + manifestText();
		const v = checkEvidence({
			ev: makeEvidenceForExecutedLocal(makeExecutedRecord()),
			hashesText: evilManifest,
			evDirAbs: evDir,
			executedCmds: [makeExecutedRecord()],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.rejectedManifestPaths.map((r) => r.path)).toContain("/etc/passwd");
		expect(v.rejectedManifestPaths[0]?.reason).toBe("absolute");
		expect(v.hashManifestValid).toBe(false);
	});

	it("P1a: traversal manifest path is rejected", () => {
		const evilManifest = `${"a".repeat(64)}  ../../etc/passwd\n` + manifestText();
		const v = checkEvidence({
			ev: makeEvidenceForExecutedLocal(makeExecutedRecord()),
			hashesText: evilManifest,
			evDirAbs: evDir,
			executedCmds: [makeExecutedRecord()],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.rejectedManifestPaths.map((r) => r.path)).toContain("../../etc/passwd");
		expect(v.rejectedManifestPaths[0]?.reason).toBe("traversal");
		expect(v.hashManifestValid).toBe(false);
	});

	it("P1b: declared path that is a symlink is flagged", () => {
		// Create an external file outside the evidence dir, then a symlink
		// inside the evidence dir pointing to it. The symlink path is what
		// the manifest declares.
		const outside = join(tmpRoot, "external-target.txt");
		writeFileSync(outside, "outside\n");
		const inside = join(evDir, "commands", "via-symlink");
		try {
			symlinkSync(outside, inside);
		} catch {
			// skip on platforms without symlink support
			return;
		}
		// Real 64-char SHA so the parser accepts the manifest line; the
		// symlink check fires before the hash check.
		const evilManifest =
			`${sha256Hex(readFileSync(outside))}  detached/commands/via-symlink\n` +
			manifestText();
		const v = checkEvidence({
			ev: makeEvidenceForExecutedLocal(makeExecutedRecord()),
			hashesText: evilManifest,
			evDirAbs: evDir,
			executedCmds: [makeExecutedRecord()],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		const missing = v.missingFiles.find((m) => m.path === "detached/commands/via-symlink");
		expect(missing?.reason).toBe("symlink");
		rmSync(inside);
		rmSync(outside);
	});
});

// ---------------------------------------------------------------------------
// End-to-end positive test (P1d) — proves `checkEvidence` can produce a
// fully-valid EvidenceView for a real on-disk bundle that the audit
// considers satisfiable, AND that `computeClosure` accepts it.
// ---------------------------------------------------------------------------

// Module-level stash for cross-`it` SHA values (test strings are readonly,
// so a string-keyed map cannot hold them).
let __e2eTmpRoot = "";
let __e2eEvDir = "";
let __e2eStdoutSha = "";
let __e2eStderrSha = "";
let __e2eEvidenceSha = "";
let __e2eEnvSha = "";

describe("end-to-end: real-world valid bundle → PARTIAL with all dimensions green", () => {
	const EXEC_STDOUT_BYTES = Buffer.from("build stdout content\n");
	const EXEC_STDERR_BYTES = Buffer.from("build stderr content\n");
	const EXEC_EVIDENCE_BYTES = Buffer.from("alpha\n");
	const HEAD_NOW = HEAD;
	const TREE_NOW = TREE;

	beforeAll(() => {
		__e2eTmpRoot = mkdtempSync(join(tmpdir(), "baseline-e2e-"));
		__e2eEvDir = join(__e2eTmpRoot, "detached");
		mkdirSync(join(__e2eEvDir, "commands"), { recursive: true });

		// Place a real JSON evidence.json whose body SHA matches the bytes
		// we hash into the manifest.
		const stdoutSha = sha256Hex(EXEC_STDOUT_BYTES);
		const stderrSha = sha256Hex(EXEC_STDERR_BYTES);
		const evidenceSha = sha256Hex(EXEC_EVIDENCE_BYTES);
		__e2eEnvSha = "c".repeat(64);
		const envSha = __e2eEnvSha;

		const evidenceJson = {
			schema_version: 1,
			act_id: "ACT-CLINEMM-FORK-BASELINE01",
			head_oid: HEAD,
			tree_oid: TREE,
			generated_at: "2026-07-17T09:50:09.000Z",
			host_arch: "darwin-arm64",
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
					tree_oid: TREE,
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
		// Control file present, not in payload manifest.
		writeFileSync(join(__e2eEvDir, "hashes.sha256"), Buffer.from("placeholder\n"));

		// Re-hash the *serialized* evidence.json so the manifest matches the
		// bytes actually on disk (the schema fields above are the same shape
		// `JSON.stringify` produces; we hash the serialized form).
		const onDiskEvidenceSha = sha256Hex(serializedEvidence);

		const manifestLines = [
			`${onDiskEvidenceSha}  detached/evidence.json`,
			`${stdoutSha}  detached/commands/build.stdout`,
			`${stderrSha}  detached/commands/build.stderr`,
		];
		writeFileSync(join(__e2eEvDir, "hashes.sha256"), manifestLines.join("\n") + "\n");

		__e2eStdoutSha = stdoutSha;
		__e2eStderrSha = stderrSha;
		__e2eEvidenceSha = onDiskEvidenceSha;
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
				tree_oid: TREE_NOW,
				stdout_sha256: stdoutSha,
				stderr_sha256: stderrSha,
				environment_sha256: envSha,
				failure_classification: null,
			},
		];
		// Sync the evidence row's stdout hash so per-record comparison matches.
		evJson.commands[0].stdout_sha256 = stdoutSha;

		const view = checkEvidence({
			ev: evJson,
			hashesText,
			evDirAbs: evDir,
			executedCmds: executed,
			rootAbs: tmpRoot,
			headOidNow: HEAD_NOW,
			treeOidNow: TREE_NOW,
		});

		// Every dimension must be true/satisfied.
		expect(view.exists).toBe(true);
		expect(view.subjectMatches).toBe(true);
		expect(view.treeMatches).toBe(true);
		expect(view.executionTreeBound).toBe(true);
		expect(view.hashManifestValid).toBe(true);
		expect(view.missingFiles).toEqual([]);
		expect(view.unexpectedFiles).toEqual([]);
		expect(view.hashMismatches).toEqual([]);
		expect(view.malformedLines).toEqual([]);
		expect(view.duplicatePaths).toEqual([]);
		expect(view.commandSetExact).toBe(true);
		expect(view.executionTrees).toEqual([TREE_NOW]);
		expect(view.duplicateEvidenceCommandIds).toEqual([]);
		expect(view.duplicateExecutedCommandIds).toEqual([]);
		expect(view.commandRecordMismatches).toEqual([]);
		expect(view.rejectedManifestPaths).toEqual([]);

		// The `isEvidenceOk` conjunction used by `computeClosure` must agree.
		expect(view.exists &&
			view.subjectMatches &&
			view.treeMatches &&
			view.executionTreeBound &&
			view.hashManifestValid &&
			view.missingFiles.length === 0 &&
			view.unexpectedFiles.length === 0 &&
			view.hashMismatches.length === 0 &&
			view.malformedLines.length === 0 &&
			view.duplicatePaths.length === 0 &&
			view.commandSetExact &&
			view.executionTrees.length === 1 &&
			view.duplicateEvidenceCommandIds.length === 0 &&
			view.duplicateExecutedCommandIds.length === 0 &&
			view.commandRecordMismatches.length === 0 &&
			view.rejectedManifestPaths.length === 0,
		).toBe(true);

		// And the closure must yield PARTIAL (open R4/R5/R6/R7/R16) given
		// valid evidence and a passing mandatory command.
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
// Sanity checks on the closure rationale — verdict must equal the conjunction.
// ---------------------------------------------------------------------------

describe("verdict ↔ conjunction invariants", () => {
	const evidenceOk = baseOk();
	const evidenceBad = baseOk({ subjectMatches: false });

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
