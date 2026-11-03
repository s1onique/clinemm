#!/usr/bin/env bun
/**
 * ACT-CLINEMM-REPOSITORY-ROOT-FIXTURE-CLEANUP01 — repository root hygiene gate.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * The seatbelt realpath-authority suites create their outside-root victims in
 * a temp directory built with
 *
 *     mkdtempSync(join(workspaceRoot, "../../clinemm-outside-*"))
 *
 * where `workspaceRoot` is the `apps/vscode` package root. The `../../`
 * segment escapes the package root and lands in the REPOSITORY ROOT, so every
 * run of those suites used to leave a `clinemm-outside-*` directory behind at
 * the repository root. A plain `git add -A` then swept those disposable
 * fixtures into the index, and they were committed (30 of them, in merge
 * commit 167f5ca8d).
 *
 * This module is the regression gate: it asserts that no `clinemm-outside-*`
 * path is ever TRACKED by git. The fixture lifecycle is now fixed upstream
 * (the temp dirs are removed in `afterAll`) and `.gitignore` carries a
 * root-level ignore rule for the `clinemm-outside-` prefix, so a tracked
 * occurrence means the fix regressed
 * (or a new suite reintroduced the leak).
 *
 * ---------------------------------------------------------------------------
 * SCOPE
 * ---------------------------------------------------------------------------
 *
 * The check is intentionally narrow and data-driven:
 *
 *   - It only looks at the set of TRACKED paths reported by `git ls-files`.
 *   - It only reports paths that match one of the known ephemeral-fixture
 *     prefixes (currently `clinemm-outside-`).
 *
 * It does NOT inspect the working tree, does NOT judge whether a path is
 * "reasonable", and does NOT attempt to be a general-purpose lint for the
 * repository layout. A broader check would be a policy decision, not a
 * hygiene regression gate.
 */

/**
 * Repository-root-relative prefixes of ephemeral test fixtures that must
 * never be tracked by git.
 *
 * Each entry is a literal directory-name prefix (no glob metacharacters):
 * a tracked path is reported when it is a root-level entry whose first
 * path segment starts with one of these prefixes.
 */
export const EPHEMERAL_ROOT_FIXTURE_PREFIXES: readonly string[] = ["clinemm-outside-"];

/**
 * A tracked path that violates the repository-root hygiene rule.
 */
export interface RootFixtureViolation {
	/** Repository-root-relative path of the offending tracked file. */
	readonly path: string;
	/** The ephemeral-fixture prefix that matched. */
	readonly prefix: string;
}

/**
 * Returns the tracked paths that violate the repository-root hygiene rule.
 *
 * A path violates the rule when it has at least two path segments (i.e. it
 * lives inside a directory rather than being a root-level file) AND its first
 * segment starts with one of `EPHEMERAL_ROOT_FIXTURE_PREFIXES`.
 *
 * The function is pure: it takes the tracked-path list and returns the
 * violations. Keeping it free of git/process access makes it trivially
 * testable and lets the CLI wrapper stay a thin shell.
 */
export function findRootFixtureViolations(
	trackedPaths: readonly string[],
	prefixes: readonly string[] = EPHEMERAL_ROOT_FIXTURE_PREFIXES,
): RootFixtureViolation[] {
	const violations: RootFixtureViolation[] = [];

	for (const rawPath of trackedPaths) {
		// Normalize separators so a Windows-style checkout is handled too.
		const normalized = rawPath.replace(/\\/g, "/");
		const segments = normalized.split("/").filter((segment) => segment.length > 0);

		// A root-level FILE is not a fixture directory; only paths that live
		// INSIDE a root-level directory can be the leaked fixtures.
		if (segments.length < 2) {
			continue;
		}

		const rootSegment = segments[0]!;
		const prefix = prefixes.find((candidate) => rootSegment.startsWith(candidate));
		if (prefix === undefined) {
			continue;
		}

		violations.push({ path: normalized, prefix });
	}

	return violations;
}

/**
 * Formats the violations as a human-readable, actionable report.
 */
export function formatRootFixtureViolations(violations: readonly RootFixtureViolation[]): string {
	const lines = violations.map((violation) => `  ${violation.path}  (prefix: ${violation.prefix})`);
	return [
		`repository-root hygiene gate FAILED: ${violations.length} ephemeral fixture path(s) are tracked by git:`,
		...lines,
		"",
		"These are disposable test fixtures that leaked out of a temporary",
		"directory and must never be committed. Remove them from the index",
		"(git rm --cached / git rm) and fix the producing test so its temp dir",
		"is removed in a finally / afterAll block.",
	].join("\n");
}
