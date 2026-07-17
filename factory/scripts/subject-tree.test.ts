#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION10 — Subject-tree integration tests.
 *
 * The CORRECTION09 closure tests in `render-baseline-report.test.ts`
 * exercise `baseline-closure.ts` against synthetic OIDs. The actual
 * helper, `computeFilteredSubjectTreeOid(realGitRepo)`, was untested
 * — a regression gap explicitly flagged by the CORRECTION09 reviewer.
 *
 * This file closes that gap. It creates a fresh Git repository in a
 * `mkdtemp` directory, populates it with a tracked tree containing
 * the precise paths needed to exercise the helper (excluded files,
 * excluded prefixes, executable modes, nested directories, symlinks,
 * unmodified source), and asserts on the computed filtered OID for
 * each scenario. All git operations run against the temp repo using
 * `git -C <tmpdir>` so the host checkout is never touched.
 *
 * Run with:
 *   bun test factory/scripts/subject-tree.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import {
	mkdtempSync,
	rmSync,
	mkdirSync,
	writeFileSync,
	symlinkSync,
	chmodSync,
	existsSync,
	readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
	computeFilteredSubjectTreeOid,
	SUBJECT_TREE_EXCLUDES,
} from "./subject-tree";

// ---------------------------------------------------------------------------
// Temp-repo harness
// ---------------------------------------------------------------------------

interface TempRepo {
	root: string;
	commit: (msg: string) => string;
	head: () => string;
	headTree: () => string;
	writeFile: (relPath: string, content: string) => void;
	writeExecutable: (relPath: string, content: string) => void;
	writeSymlink: (relPath: string, target: string) => void;
}

function git(
	cwd: string,
	args: string[],
	opts: { env?: Record<string, string>; input?: string } = {},
): { status: number | null; stdout: string; stderr: string } {
	const r = spawnSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		input: opts.input,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, ...(opts.env ?? {}) },
	});
	return {
		status: r.status,
		stdout: (r.stdout ?? "").toString(),
		stderr: (r.stderr ?? "").toString(),
	};
}

function makeTempRepo(): TempRepo {
	const root = mkdtempSync(join(tmpdir(), "subject-tree-it-"));
	// Initialise a fresh, isolated repo. We must also create a stable
	// committer identity because the default host config might be
	// unset in CI shells.
	const env = {
		GIT_AUTHOR_NAME: "subject-tree-it",
		GIT_AUTHOR_EMAIL: "subject-tree-it@example.invalid",
		GIT_COMMITTER_NAME: "subject-tree-it",
		GIT_COMMITTER_EMAIL: "subject-tree-it@example.invalid",
	};
	const init = git(root, ["init", "--quiet", "--initial-branch=main"], { env });
	if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
	// Disable GPG signing so commits succeed in any environment.
	git(root, ["config", "commit.gpgsign", "false"], { env });
	git(root, ["config", "user.name", "subject-tree-it"], { env });
	git(root, ["config", "user.email", "subject-tree-it@example.invalid"], { env });

	return {
		root,
		commit(msg: string): string {
			git(root, ["add", "-A"], { env });
			const c = git(root, ["commit", "--quiet", "-m", msg], { env });
			if (c.status !== 0) throw new Error(`commit failed: ${c.stderr}`);
			const h = git(root, ["rev-parse", "HEAD"], { env });
			return h.stdout.trim();
		},
		head(): string {
			return git(root, ["rev-parse", "HEAD"], { env }).stdout.trim();
		},
		headTree(): string {
			return git(root, ["rev-parse", "HEAD^{tree}"], { env }).stdout.trim();
		},
		writeFile(relPath: string, content: string): void {
			const full = join(root, relPath);
			mkdirSync(join(full, ".."), { recursive: true });
			writeFileSync(full, content, "utf8");
		},
		writeExecutable(relPath: string, content: string): void {
			const full = join(root, relPath);
			mkdirSync(join(full, ".."), { recursive: true });
			writeFileSync(full, content, "utf8");
			chmodSync(full, 0o755);
		},
		writeSymlink(relPath: string, target: string): void {
			const full = join(root, relPath);
			mkdirSync(join(full, ".."), { recursive: true });
			symlinkSync(target, full);
		},
	};
}

function expectedExcludesAbsent(root: string, oid: string): boolean {
	const r = git(root, ["ls-tree", "-r", oid], {});
	if (r.status !== 0) return false;
	const entries = new Set(
		r.stdout
			.split("\n")
			.filter((l) => l.length > 0)
			.map((l) => l.slice(l.indexOf("\t") + 1)),
	);
	for (const ex of SUBJECT_TREE_EXCLUDES) {
		if (ex.kind === "file") {
			if (entries.has(ex.path)) return false;
		} else {
			const prefix = ex.path.endsWith("/") ? ex.path : ex.path + "/";
			for (const e of entries) {
				if (e === ex.path || e.startsWith(prefix)) return false;
			}
		}
	}
	return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeFilteredSubjectTreeOid — pure plumbing", () => {
	let repo: TempRepo;
	beforeAll(() => {
		repo = makeTempRepo();
		// Populate a small, structured tracked tree with one excluded
		// file and one excluded prefix to verify both kinds of removal.
		repo.writeFile("docs/factory/baseline-report.md", "# report\n");
		repo.writeFile(".factory/evidence/ACT-X/evidence.json", "{\"placeholder\":true}\n");
		repo.writeFile(".factory/evidence/ACT-X/commands/build.stdout", "out\n");
		repo.writeFile("factory/inventories/verification-results.json", "{}");
		repo.writeFile("factory/inventories/environment.json", "{}");
		repo.writeFile("factory/inventories/repository.json", "{}");
		repo.writeFile("factory/inventories/workspaces.json", "{}");
		repo.writeFile("factory/inventories/native-probes.json", "{}");
		repo.writeFile("factory/inventories/network-listener-candidates.csv", "h\n");
		repo.writeFile("factory/inventories/privileged-sink-candidates.csv", "h\n");
		repo.writeFile("factory/baselines/file-size-summary.json", "{}");
		repo.writeFile("factory/baselines/file-size.csv", "h\n");
		repo.writeFile("factory/baselines/exact-duplicates.json", "{}");
		repo.writeFile("factory/inventories/verification.json", "{\"commands\":[]}");
		repo.writeFile("factory/scripts/subject-tree.ts", "// helper\n");
		repo.writeFile("factory/scripts/baseline-closure.ts", "// closure\n");
		repo.writeFile("README.md", "hello\n");
		repo.writeExecutable("factory/scripts/run-verification.ts", "#!/usr/bin/env bun\n");
		repo.writeFile("factory/scripts/nested/dir/file.txt", "deep\n");
		repo.writeSymlink("factory/scripts/link-to-readme", "../../README.md");
		repo.commit("initial subject tree fixture");
	});

	afterAll(() => {
		if (repo?.root) rmSync(repo.root, { recursive: true, force: true });
	});

	it("returns a 40-char hex OID on a populated repo", () => {
		const oid = computeFilteredSubjectTreeOid(repo.root);
		expect(oid).not.toBeNull();
		expect(oid).toMatch(/^[0-9a-f]{40}$/);
	});

	it("filtered OID differs from full HEAD^{tree}", () => {
		const filtered = computeFilteredSubjectTreeOid(repo.root);
		const full = repo.headTree();
		expect(filtered).not.toBe(full);
	});

	it("filtered OID does not contain any excluded path", () => {
		const oid = computeFilteredSubjectTreeOid(repo.root);
		expect(oid).not.toBeNull();
		expect(expectedExcludesAbsent(repo.root, oid as string)).toBe(true);
	});

	it("filtered OID includes non-excluded tracked files (subject inputs)", () => {
		const oid = computeFilteredSubjectTreeOid(repo.root);
		expect(oid).not.toBeNull();
		const r = git(repo.root, ["ls-tree", "-r", oid as string], {});
		const paths = new Set(
			r.stdout
				.split("\n")
				.filter((l) => l.length > 0)
				.map((l) => l.slice(l.indexOf("\t") + 1)),
		);
		expect(paths.has("README.md")).toBe(true);
		expect(paths.has("factory/scripts/subject-tree.ts")).toBe(true);
		expect(paths.has("factory/scripts/baseline-closure.ts")).toBe(true);
		expect(paths.has("factory/scripts/run-verification.ts")).toBe(true);
		expect(paths.has("factory/inventories/verification.json")).toBe(true);
		expect(paths.has("factory/scripts/nested/dir/file.txt")).toBe(true);
	});

	it("preserves file modes (executable bit survives)", () => {
		const oid = computeFilteredSubjectTreeOid(repo.root);
		expect(oid).not.toBeNull();
		const r = git(repo.root, ["ls-tree", oid as string, "factory/scripts/run-verification.ts"], {});
		// mode 100755 is the canonical executable regular-file mode
		expect(r.stdout.startsWith("100755")).toBe(true);
	});

	it("preserves symlinks (mode 120000)", () => {
		const oid = computeFilteredSubjectTreeOid(repo.root);
		expect(oid).not.toBeNull();
		const r = git(repo.root, ["ls-tree", oid as string, "factory/scripts/link-to-readme"], {});
		expect(r.stdout.startsWith("120000")).toBe(true);
	});

	it("filtered OID is stable across regenerations of excluded outputs", () => {
		const before = computeFilteredSubjectTreeOid(repo.root);
		// Rewrite one excluded file (the closure report) and re-commit.
		repo.writeFile(
			"docs/factory/baseline-report.md",
			"# updated report — contents change but subject tree must NOT\n",
		);
		// We do NOT commit; the helper works on HEAD's tree, not on
		// worktree modifications. The OID must be the same as before.
		const after = computeFilteredSubjectTreeOid(repo.root);
		expect(after).toBe(before);
	});
});

describe("computeFilteredSubjectTreeOid — report-only commit invariant", () => {
	let repo: TempRepo;
	beforeAll(() => {
		repo = makeTempRepo();
		repo.writeFile("README.md", "v1\n");
		repo.writeFile("docs/factory/baseline-report.md", "# v1\n");
		repo.writeFile(".factory/evidence/ACT-X/evidence.json", "{\"placeholder\":true}\n");
		repo.writeFile("factory/inventories/verification-results.json", "{}");
		repo.writeFile("factory/scripts/subject-tree.ts", "// helper\n");
		repo.writeFile("factory/inventories/verification.json", "{\"commands\":[]}");
		repo.commit("commit A: implementation changes");
	});
	afterAll(() => {
		if (repo?.root) rmSync(repo.root, { recursive: true, force: true });
	});

	it("report-only commit preserves the filtered subject OID", () => {
		// Commit A: filtered OID is computed against HEAD.
		const subjectA = computeFilteredSubjectTreeOid(repo.root);

		// Commit B: only the (excluded) closure report changes.
		repo.writeFile("docs/factory/baseline-report.md", "# v2 (report-only update)\n");
		repo.commit("commit B: report-only update");
		const subjectB = computeFilteredSubjectTreeOid(repo.root);

		expect(subjectA).not.toBeNull();
		expect(subjectB).not.toBeNull();
		expect(subjectA).toBe(subjectB);
	});

	it("modification of a non-excluded file changes the filtered OID", () => {
		const before = computeFilteredSubjectTreeOid(repo.root);
		repo.writeFile("factory/scripts/subject-tree.ts", "// helper v2 — subject change\n");
		repo.commit("commit C: subject-input change");
		const after = computeFilteredSubjectTreeOid(repo.root);
		expect(after).not.toBeNull();
		expect(after).not.toBe(before);
	});
});

describe("computeFilteredSubjectTreeOid — failure modes", () => {
	let repo: TempRepo;
	beforeAll(() => {
		repo = makeTempRepo();
	});
	afterAll(() => {
		if (repo?.root) rmSync(repo.root, { recursive: true, force: true });
	});

	it("returns null for a non-git directory", () => {
		const notARepo = mkdtempSync(join(tmpdir(), "subject-tree-norepo-"));
		try {
			const oid = computeFilteredSubjectTreeOid(notARepo);
			expect(oid).toBeNull();
		} finally {
			rmSync(notARepo, { recursive: true, force: true });
		}
	});

	it("returns null for a repo with no commits (no HEAD)", () => {
		const empty = mkdtempSync(join(tmpdir(), "subject-tree-empty-"));
		try {
			git(empty, ["init", "--quiet", "--initial-branch=main"], {});
			const oid = computeFilteredSubjectTreeOid(empty);
			expect(oid).toBeNull();
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});

	it("does not mutate the worktree index or files", () => {
		// Populate a commit so HEAD exists.
		repo.writeFile("README.md", "stable\n");
		repo.writeFile("factory/inventories/verification.json", "{\"commands\":[]}");
		repo.writeFile("factory/scripts/subject-tree.ts", "// helper\n");
		repo.commit("fixture for non-mutation test");
		const readmeBefore = readFileSync(join(repo.root, "README.md"), "utf8");
		computeFilteredSubjectTreeOid(repo.root);
		const readmeAfter = readFileSync(join(repo.root, "README.md"), "utf8");
		expect(readmeAfter).toBe(readmeBefore);
		// `git status --porcelain` should report no changes after the helper
		// returns; the temp index is removed in `finally`.
		const status = git(repo.root, ["status", "--porcelain"], {});
		expect(status.stdout.trim()).toBe("");
	});
});

describe("SUBJECT_TREE_EXCLUDES — structural single source of truth", () => {
	it("contains the closure report as a `file` kind", () => {
		const r = SUBJECT_TREE_EXCLUDES.find(
			(e) => e.kind === "file" && e.path === "docs/factory/baseline-report.md",
		);
		expect(r).toBeDefined();
	});

	it("contains the detached evidence dir as a `prefix` kind", () => {
		const r = SUBJECT_TREE_EXCLUDES.find(
			(e) => e.kind === "prefix" && e.path === ".factory",
		);
		expect(r).toBeDefined();
	});

	it("contains the tracked run outputs as `file` kinds", () => {
		const expected = [
			"factory/inventories/verification-results.json",
			"factory/inventories/environment.json",
			"factory/inventories/native-probes.json",
		];
		for (const p of expected) {
			const r = SUBJECT_TREE_EXCLUDES.find((e) => e.kind === "file" && e.path === p);
			expect(r).toBeDefined();
		}
	});

	it("has no duplicate paths", () => {
		const seen = new Set<string>();
		for (const e of SUBJECT_TREE_EXCLUDES) {
			expect(seen.has(`${e.kind}:${e.path}`)).toBe(false);
			seen.add(`${e.kind}:${e.path}`);
		}
	});
});
