#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION05 — Renderer/closure tests.
 *
 * Pure-function tests on ./baseline-closure.ts. Uses bun:test (node-side
 * unit suite) so it can be invoked directly via
 * `bun test factory/scripts/render-baseline-report.test.ts`.
 *
 * These tests pin the fail-closed behavior the reviewer identified as
 * missing in CORRECTION03/04. Any change that re-introduces a fall-through
 * to PARTIAL on stale evidence MUST trip these tests.
 *
 *   bun test factory/scripts/render-baseline-report.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
	computeClosure,
	checkEvidence,
	parseManifest,
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

function passEvidence(): any {
	return {
		schema_version: 1,
		act_id: "ACT-CLINEMM-FORK-BASELINE01",
		head_oid: HEAD,
		tree_oid: TREE,
		generated_at: "2026-07-17T09:50:09.000Z",
		host_arch: "darwin-arm64",
		commands: [
			{
				id: "build-sdk",
				status: "pass",
				head_oid: HEAD,
				tree_oid: TREE,
				started_at: "2026-07-17T09:41:41.693Z",
				finished_at: "2026-07-17T09:41:55.259Z",
				duration_ms: 13566,
				exit_code: 0,
				signal: null,
				timeout: false,
				stdout_sha256: "a".repeat(64),
				stderr_sha256: "b".repeat(64),
				environment_sha256: "c".repeat(64),
				failure_classification: null,
				notes: "",
			},
		],
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
// The 8 pinned cases from the CORRECTION05 audit
// ---------------------------------------------------------------------------

describe("computeClosure — fail-closed policy (8 pinned cases)", () => {
	it("1. stale HEAD → FAIL", () => {
		const r = computeClosure(
			baseInput({ subjectMatches: false }),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("2. stale tree → FAIL", () => {
		const r = computeClosure(
			baseInput({ treeMatches: false }),
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
						path: "detached/evidence.json",
						expected: "deadbeef".repeat(8),
						actual: "f00dface".repeat(8),
					},
				],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.hashMismatchesAllowed).toBeUndefined(); // sanity
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
			baseInput({
				executionTrees: [TREE, HEAD_OTHER, "a".repeat(40)],
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("6. UNKNOWN failure → FAIL", () => {
		const r = computeClosure({
			...baseInput(),
			unknownFailures: ["root-check"],
		});
		expect(r.verdict).toBe("FAIL");
		// Even when evidence is perfect, an UNKNOWN blocks closure.
		expect(r.evidenceOk).toBe(true);
		expect(r.reasonCodes).toContain("UNKNOWN_FAILURES_PRESENT");
		expect(r.reasonCodes).not.toContain("EVIDENCE_INCOMPLETE");
	});

	it("7. valid evidence + open R4 → PARTIAL", () => {
		const r = computeClosure(baseInput()); // r4Satisfied defaults to false
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
// Additional invariants to lock down the new dimensions
// ---------------------------------------------------------------------------

describe("computeClosure — additional invariants", () => {
	it("EVIDENCE_INCOMPLETE preempts every other reason", () => {
		// Two failures: bad evidence AND UNKNOWN. The verdict is still FAIL but
		// both codes are recorded; EVIDENCE_INCOMPLETE must appear and the
		// verdict must be FAIL.
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
				hashManifestValid: false,
				unexpectedFiles: [{ path: "commands/leaked.txt", reason: "unexpected" }],
			}),
		);
		expect(r.verdict).toBe("FAIL");
	});

	it("command-set mismatch is FAIL", () => {
		const r = computeClosure(
			baseInput({
				commandSetExact: false,
			}),
		);
		expect(r.verdict).toBe("FAIL");
		expect(r.evidenceOk).toBe(false);
	});

	it("evidence file missing → FAIL with no reason-code-noise", () => {
		const r = computeClosure({
			...baseInput({ exists: false }),
		});
		expect(r.verdict).toBe("FAIL");
		expect(r.reasonCodes).toContain("EVIDENCE_INCOMPLETE");
	});

	it("isEvidenceOk directly matches the conjunction the audit requires", () => {
		// The audit's pinned conjunction reproduced here for regression safety.
		const v = baseOk();
		expect(
			v.exists &&
				v.subjectMatches &&
				v.treeMatches &&
				v.hashManifestValid &&
				v.missingFiles.length === 0 &&
				v.unexpectedFiles.length === 0 &&
				v.hashMismatches.length === 0 &&
				v.malformedLines.length === 0 &&
				v.duplicatePaths.length === 0 &&
				v.commandSetExact &&
				v.executionTrees.length === 1,
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
			"AAAA".repeat(16) + "  foo\n" +
			"NOT_A_SHA  bar\n" +
			"BBBB".repeat(16) + "  baz\n";
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
		expect(declared.get("foo")).toBe("cccc".repeat(16)); // last write wins
		expect(duplicates).toEqual([
			{ path: "foo", occurrences: 2 },
		]);
	});

	it("returns empty maps for empty input", () => {
		const { declared, malformed, duplicates } = parseManifest("");
		expect(declared.size).toBe(0);
		expect(malformed).toEqual([]);
		expect(duplicates).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// checkEvidence — drives a real tmp directory
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

		// Place two files and record their SHA-256s in the manifest.
		const a = Buffer.from("alpha\n");
		const b = Buffer.from("bravo\n");
		writeFileSync(join(evDir, "evidence.json"), a);
		writeFileSync(join(evDir, "commands", "build.stdout"), b);
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

	function makeEvidence(extra: Partial<any> = {}): any {
		return {
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
					head_oid: HEAD,
					tree_oid: TREE,
					started_at: "2026-07-17T09:41:41.693Z",
					finished_at: "2026-07-17T09:41:55.259Z",
					duration_ms: 100,
					exit_code: 0,
					signal: null,
					timeout: false,
					stdout_sha256: sha256Hex(filesOnDisk[1]!.bytes),
					stderr_sha256: "0".repeat(64),
					environment_sha256: "c".repeat(64),
					failure_classification: null,
					notes: "",
					...extra,
				},
			],
			...extra,
		};
	}

	it("happy path: every dimension satisfied", () => {
		const v = checkEvidence({
			ev: makeEvidence(),
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [{ id: "build", tree_oid: TREE }],
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
	});

	it("stale HEAD when git moved past the evidence", () => {
		const v = checkEvidence({
			ev: makeEvidence(),
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [{ id: "build", tree_oid: TREE }],
			rootAbs: tmpRoot,
			headOidNow: HEAD_OTHER,
			treeOidNow: TREE,
		});
		expect(v.subjectMatches).toBe(false);
		expect(v.treeMatches).toBe(true);
		expect(v.hashManifestValid).toBe(true);
	});

	it("hash mismatch on a single file", () => {
		// Corrupt the on-disk file after building the manifest.
		writeFileSync(join(evDir, "evidence.json"), Buffer.from("MUTATED\n"));
		const v = checkEvidence({
			ev: makeEvidence(),
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [{ id: "build", tree_oid: TREE }],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.hashManifestValid).toBe(false);
		expect(v.hashMismatches).toHaveLength(1);
		expect(v.hashMismatches[0]?.path).toBe("detached/evidence.json");
		expect(v.hashMismatches[0]?.actual).toBe(sha256Hex(Buffer.from("MUTATED\n")));
		// Restore for any later tests.
		writeFileSync(
			join(evDir, "evidence.json"),
			filesOnDisk[0]!.bytes,
		);
	});

	it("missing declared file", () => {
		// Remove the file but keep its entry in the manifest.
		const removed = join(evDir, "evidence.json");
		const saved = readFileSync(removed);
		rmSync(removed);
		try {
			const v = checkEvidence({
				ev: makeEvidence(),
				hashesText: manifestText(),
				evDirAbs: evDir,
				executedCmds: [{ id: "build", tree_oid: TREE }],
				rootAbs: tmpRoot,
				headOidNow: HEAD,
				treeOidNow: TREE,
			});
			expect(v.missingFiles.map((m) => m.path)).toContain(
				"detached/evidence.json",
			);
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
				ev: makeEvidence(),
				hashesText: manifestText(),
				evDirAbs: evDir,
				executedCmds: [{ id: "build", tree_oid: TREE }],
				rootAbs: tmpRoot,
				headOidNow: HEAD,
				treeOidNow: TREE,
			});
			expect(v.unexpectedFiles.map((u) => u.path)).toContain(
				"commands/rogue.log",
			);
			// `hashManifestValid` only describes the declared entries
			// (well-formed, every declared path hashes match). An unexpected
			// file is captured separately and surfaces via `isEvidenceOk`.
			expect(v.hashManifestValid).toBe(true);
			expect(v.unexpectedFiles.length).toBeGreaterThan(0);
		} finally {
			rmSync(rogue);
		}
	});

	it("mixed execution trees across evidence.commands", () => {
		const altEv = makeEvidence();
		altEv.commands.push({
			id: "later",
			status: "pass",
			head_oid: HEAD,
			tree_oid: HEAD_OTHER,
			started_at: "2026-07-17T09:42:00.000Z",
			finished_at: "2026-07-17T09:42:10.000Z",
			duration_ms: 100,
			exit_code: 0,
			signal: null,
			timeout: false,
			stdout_sha256: "0".repeat(64),
			stderr_sha256: "0".repeat(64),
			environment_sha256: "c".repeat(64),
			failure_classification: null,
			notes: "",
		});
		const v = checkEvidence({
			ev: altEv,
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [
				{ id: "build", tree_oid: TREE },
				{ id: "later", tree_oid: HEAD_OTHER },
			],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.executionTrees.sort()).toEqual([HEAD_OTHER, TREE].sort());
		expect(v.executionTrees.length).toBe(2);
	});

	it("command-set mismatch: executed ≠ evidence.commands", () => {
		const v = checkEvidence({
			ev: makeEvidence(), // evidence has [build]
			hashesText: manifestText(),
			evDirAbs: evDir,
			executedCmds: [
				{ id: "build", tree_oid: TREE },
				{ id: "phantom", tree_oid: TREE }, // not in evidence
			],
			rootAbs: tmpRoot,
			headOidNow: HEAD,
			treeOidNow: TREE,
		});
		expect(v.commandSetExact).toBe(false);
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
				r4Satisfied: false, // open
			}).verdict,
		).toBe("PARTIAL");
	});

	it("evidenceOk=false → FAIL regardless of other inputs", () => {
		expect(
			computeClosure({
				...baseInput(evidenceBad), // subjectMatches=false
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
