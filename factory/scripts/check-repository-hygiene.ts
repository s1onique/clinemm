#!/usr/bin/env bun
/**
 * ACT-CLINEMM-REPOSITORY-ROOT-FIXTURE-CLEANUP01 — repository root hygiene CLI.
 *
 * Reads the set of TRACKED paths from `git ls-files -z` and fails (exit 1)
 * when any of them lives inside a root-level ephemeral-fixture directory.
 *
 * Usage:
 *   bun factory/scripts/check-repository-hygiene.ts [--repo-root <dir>]
 *
 * Exit codes:
 *   0 — no violation (gate PASS)
 *   1 — violation found (gate FAIL)
 *   2 — the gate could not run (not a git repo, git failed, ...)
 */
import { spawnSync } from "node:child_process";
import { findRootFixtureViolations, formatRootFixtureViolations } from "./repository-hygiene";

function parseRepoRoot(argv: readonly string[]): string {
	const flagIndex = argv.indexOf("--repo-root");
	if (flagIndex === -1) {
		return process.cwd();
	}
	const value = argv[flagIndex + 1];
	if (!value) {
		throw new Error("--repo-root requires a directory argument");
	}
	return value;
}

function main(): number {
	let repoRoot: string;
	try {
		repoRoot = parseRepoRoot(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		return 2;
	}

	const listed = spawnSync("git", ["ls-files", "-z"], {
		cwd: repoRoot,
		encoding: "buffer",
		maxBuffer: 64 * 1024 * 1024,
	});

	if (listed.error) {
		process.stderr.write(`git ls-files failed to spawn: ${listed.error.message}\n`);
		return 2;
	}
	if (listed.status !== 0) {
		process.stderr.write(
			`git ls-files exited with status ${listed.status ?? "null"}: ${listed.stderr?.toString() ?? ""}\n`,
		);
		return 2;
	}

	const raw = listed.stdout;
	if (!raw) {
		process.stderr.write("git ls-files returned no output\n");
		return 2;
	}

	const trackedPaths = raw
		.toString("utf8")
		.split("\0")
		.filter((path) => path.length > 0);

	const violations = findRootFixtureViolations(trackedPaths);

	if (violations.length > 0) {
		process.stderr.write(`${formatRootFixtureViolations(violations)}\n`);
		return 1;
	}

	process.stdout.write(
		`repository-root hygiene gate PASS: ${trackedPaths.length} tracked paths, 0 ephemeral root fixtures\n`,
	);
	return 0;
}

process.exit(main());
