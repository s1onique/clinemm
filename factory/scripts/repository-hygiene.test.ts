#!/usr/bin/env bun
/**
 * ACT-CLINEMM-REPOSITORY-ROOT-FIXTURE-CLEANUP01 — repository root hygiene gate tests.
 *
 * The gate is the regression assertion for the repository-root fixture leak:
 * it asserts that no ephemeral `clinemm-outside-*` path is ever TRACKED by
 * git. These tests cover the pure classifier against synthetic path lists
 * (including the exact 30 paths that were committed in merge commit
 * 167f5ca8d), and the live repository state.
 *
 * Run with:
 *   bun test factory/scripts/repository-hygiene.test.ts
 */
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
	EPHEMERAL_ROOT_FIXTURE_PREFIXES,
	findRootFixtureViolations,
	formatRootFixtureViolations,
} from "./repository-hygiene";

const REPO_ROOT = join(import.meta.dir, "..", "..");

/**
 * The exact tracked paths that were committed by merge commit 167f5ca8d
 * ("Merge upstream 'a6507a62' into integration/upstream-20261102"). Both
 * merge parents are clean; the merge introduced them.
 */
const HISTORIC_LEAKED_FIXTURES: readonly string[] = [
	"clinemm-outside-invariant-2P1KfF/victim.ts",
	"clinemm-outside-invariant-BslFsx/victim.ts",
	"clinemm-outside-invariant-DKmTlm/victim.ts",
	"clinemm-outside-invariant-MBoUYd/victim.ts",
	"clinemm-outside-invariant-OdLoww/victim.ts",
	"clinemm-outside-invariant-QUmzS8/victim.ts",
	"clinemm-outside-invariant-QrRG79/victim.ts",
	"clinemm-outside-invariant-Xl7SAj/victim.ts",
	"clinemm-outside-invariant-iwW3vo/victim.ts",
	"clinemm-outside-invariant-k2KoCe/victim.ts",
	"clinemm-outside-t3-3pnqKf/victim.ts",
	"clinemm-outside-t3-7gluLW/victim.ts",
	"clinemm-outside-t3-BzmL6A/victim.ts",
	"clinemm-outside-t3-DLjH9z/victim.ts",
	"clinemm-outside-t3-N94noV/victim.ts",
	"clinemm-outside-t3-US2YZi/victim.ts",
	"clinemm-outside-t3-drrz1R/victim.ts",
	"clinemm-outside-t3-hR12IS/victim.ts",
	"clinemm-outside-t3-j9d8cr/victim.ts",
	"clinemm-outside-t3-tXOEBy/victim.ts",
	"clinemm-outside-t4-8GyXZS/victim.ts",
	"clinemm-outside-t4-C141Ay/victim.ts",
	"clinemm-outside-t4-DeTE84/victim.ts",
	"clinemm-outside-t4-O1FGvC/victim.ts",
	"clinemm-outside-t4-X6RNzC/victim.ts",
	"clinemm-outside-t4-ZA0Wkq/victim.ts",
	"clinemm-outside-t4-f0x5Xq/victim.ts",
	"clinemm-outside-t4-gZRWLT/victim.ts",
	"clinemm-outside-t4-tYqTiI/victim.ts",
	"clinemm-outside-t4-zlP75B/victim.ts",
];

describe("repository root hygiene — findRootFixtureViolations", () => {
	it("reports the 30 historically leaked fixtures", () => {
		const violations = findRootFixtureViolations(HISTORIC_LEAKED_FIXTURES);
		expect(violations).toHaveLength(30);
		expect(violations.every((violation) => violation.prefix === "clinemm-outside-")).toBe(true);
		expect(violations.map((violation) => violation.path)).toEqual([...HISTORIC_LEAKED_FIXTURES]);
	});

	it("does not report ordinary tracked paths", () => {
		const tracked = [
			"README.md",
			"package.json",
			".gitignore",
			"apps/vscode/src/sdk/__tests__/seatbelt-all-workspace-realpath-authority-correction01.test.ts",
			"factory/scripts/repository-hygiene.ts",
			// A nested path that merely CONTAINS the prefix deeper in the tree
			// is not a repository-root fixture.
			"apps/vscode/clinemm-outside-t3-abc/victim.ts",
			".factory/evidence/clinemm-outside-t3-abc/victim.ts",
		];
		expect(findRootFixtureViolations(tracked)).toEqual([]);
	});

	it("does not report a root-level FILE that starts with the prefix", () => {
		// The leaked artifacts are directories containing a file; a
		// root-level file with the same prefix is not the leak shape.
		expect(findRootFixtureViolations(["clinemm-outside-t3-abc"])).toEqual([]);
	});

	it("normalizes Windows-style separators", () => {
		const violations = findRootFixtureViolations(["clinemm-outside-t3-abc\\victim.ts"]);
		expect(violations).toHaveLength(1);
		expect(violations[0]!.path).toBe("clinemm-outside-t3-abc/victim.ts");
	});

	it("ignores empty path entries", () => {
		expect(findRootFixtureViolations(["", "/", "//"])).toEqual([]);
	});

	it("exposes the documented prefix list", () => {
		expect(EPHEMERAL_ROOT_FIXTURE_PREFIXES).toContain("clinemm-outside-");
	});
});

describe("repository root hygiene — formatRootFixtureViolations", () => {
	it("mentions every offending path and the remediation", () => {
		const report = formatRootFixtureViolations(findRootFixtureViolations(HISTORIC_LEAKED_FIXTURES));
		expect(report).toContain("30");
		expect(report).toContain("clinemm-outside-t3-3pnqKf/victim.ts");
		expect(report).toContain("clinemm-outside-invariant-k2KoCe/victim.ts");
		expect(report).toContain("git rm");
	});
});

describe("repository root hygiene — live repository state", () => {
	it("has no ephemeral root fixture tracked by git", () => {
		const listed = spawnSync("git", ["ls-files", "-z"], {
			cwd: REPO_ROOT,
			encoding: "buffer",
			maxBuffer: 64 * 1024 * 1024,
		});
		expect(listed.status).toBe(0);
		const trackedPaths = (listed.stdout?.toString("utf8") ?? "")
			.split("\0")
			.filter((path) => path.length > 0);
		expect(trackedPaths.length).toBeGreaterThan(0);
		expect(findRootFixtureViolations(trackedPaths)).toEqual([]);
	});

	it("has an ignore rule that keeps leaked fixtures out of the index", () => {
		const ignored = spawnSync("git", ["check-ignore", "-q", "clinemm-outside-t3-leakcheck/victim.ts"], {
			cwd: REPO_ROOT,
		});
		expect(ignored.status).toBe(0);
	});
});
