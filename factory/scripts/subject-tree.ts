#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION09 — Filtered subject-tree helper.
 *
 * Computes a deterministic OID for HEAD's tree minus self-referential
 * paths (the closure report itself and the detached evidence directory).
 * The result is what evidence bundles bind against in CORRECTION08's
 * subject-tree contract.
 *
 * CORRECTION08 used `git ls-tree -r | git mktree --batch`, which is
 * broken: `git mktree` requires the *non-recursive* `ls-tree` format,
 * not the recursive flattened paths; and the renderer fed it via
 * `spawnSync`'s `input` while `stdio[0]` was `ignore`, so git never
 * received the bytes. The result was always `null` at runtime, even
 * though the tests passed.
 *
 * CORRECTION09 fixes this by using a **temporary Git index**:
 *
 *   1. `git read-tree HEAD` populates a fresh index from HEAD's tree
 *      (preserves Git's hierarchy, modes, symlinks, submodule entries).
 *   2. `git update-index --force-remove <path>` drops the closure report
 *      entry (no-op if not present in the index).
 *   3. `git ls-files -z .factory` enumerates detached-evidence entries
 *      (NUL-delimited to avoid quoting issues); each is removed with
 *      `git update-index --force-remove`.
 *   4. `git write-tree` emits a proper recursive tree OID. That OID is
 *      stable across regenerations of any file inside `SUBJECT_TREE_EXCLUDES`
 *      (the closure report, the detached evidence).
 *
 * The temporary index lives in `os.tmpdir()` and is removed in `finally`.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Path prefixes excluded from the binding subject. The closure report
 * itself (`docs/factory/baseline-report.md`) and the entire detached
 * evidence directory (`.factory/`) are stripped from HEAD's tree to
 * produce a stable subject identity.
 */
export const SUBJECT_TREE_EXCLUDES: ReadonlyArray<string> = [
	"docs/factory/baseline-report.md",
	".factory",
];

const OID_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Compute the OID of HEAD's tree minus `SUBJECT_TREE_EXCLUDES`. Returns
 * `null` if any git step fails (no HEAD, git missing, missing tools,
 * etc.). The caller is responsible for treating `null` as fail-closed.
 */
export function computeFilteredSubjectTreeOid(root: string): string | null {
	const tmp = mkdtempSync(join(tmpdir(), "factory-subject-tree-"));
	const tmpIndex = join(tmp, "index");
	try {
		// 1. Populate a fresh index from HEAD.
		const rt = runGit(root, ["read-tree", "HEAD"], tmpIndex);
		if (rt.status !== 0) return null;

		// 2. Drop the closure report entry (no-op if absent).
		//    `--force-remove` is required because the report file may not
		//    exist in the worktree if the report was git-ignored.
		//    Exit code is intentionally ignored: a non-existent path
		//    produces "fatal: '<path>' not in index" which we treat as
		//    success.
		runGit(root, ["update-index", "--force-remove", "--", "docs/factory/baseline-report.md"], tmpIndex);

		// 3. Drop every detached-evidence entry under `.factory`.
		//    `git ls-files -z` returns NUL-delimited paths so filenames
		//    with spaces, tabs, or newlines are safe.
		const ls = runGitBuffer(root, ["ls-files", "-z", "--", ".factory"], tmpIndex);
		if (ls.status === 0) {
			const files = (ls.stdout as Buffer).toString("utf8").split("\0").filter(Boolean);
			for (const f of files) {
				runGit(root, ["update-index", "--force-remove", "--", f], tmpIndex);
			}
		}

		// 4. Emit the filtered tree OID.
		const wt = runGit(root, ["write-tree"], tmpIndex);
		if (wt.status !== 0) return null;
		const out = (wt.stdout ?? "").trim();
		return OID_PATTERN.test(out) ? out : null;
	} finally {
		try {
			rmSync(tmp, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	}
}

function runGit(root: string, args: string[], gitIndexFile: string): { status: number | null; stdout: string } {
	const r = spawnSync("git", args, {
		encoding: "utf8",
		cwd: root,
		env: { ...process.env, GIT_INDEX_FILE: gitIndexFile },
		stdio: ["ignore", "pipe", "pipe"],
	});
	return { status: r.status, stdout: (r.stdout ?? "").toString() };
}

function runGitBuffer(
	root: string,
	args: string[],
	gitIndexFile: string,
): { status: number | null; stdout: Buffer } {
	const r = spawnSync("git", args, {
		cwd: root,
		env: { ...process.env, GIT_INDEX_FILE: gitIndexFile },
		stdio: ["ignore", "pipe", "pipe"],
	});
	return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0) };
}
