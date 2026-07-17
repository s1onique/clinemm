#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package A
 *
 * Collect repository identity (upstream + fork + working copy + tags).
 *
 * Output: factory/inventories/repository.json
 *
 * Rules:
 *   - Data is read from Git, never typed manually.
 *   - Missing "upstream" remote is rejected.
 *   - Dirty trees are rejected during source-baseline capture.
 *   - OIDs are preserved in full (40 hex chars).
 *   - Remote URLs are normalized only for comparison, not in the report.
 *   - LFS availability is detected.
 *   - Submodules and their checked-out OIDs are detected.
 *   - Key order is deterministic (sorted).
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const OUTPUT_PATH = "factory/inventories/repository.json";

// ---------- git helpers -----------------------------------------------------

let REPO_ROOT: string | null = null;
function repoRoot(): string {
	if (REPO_ROOT !== null) return REPO_ROOT;
	const proc = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (proc.status !== 0) {
		throw new Error(`git rev-parse --show-toplevel failed: exit=${proc.status} stderr=${proc.stderr}`);
	}
	REPO_ROOT = (proc.stdout ?? "").trim();
	return REPO_ROOT;
}

function runGit(args: string[], opts: { allowFailure?: boolean } = {}): string {
	const proc = spawnSync("git", args, {
		cwd: repoRoot(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (proc.status !== 0 && !opts.allowFailure) {
		const stderr = (proc.stderr ?? "").toString().trim();
		throw new Error(`git ${args.join(" ")} failed: exit=${proc.status} stderr=${stderr}`);
	}
	return (proc.stdout ?? "").toString();
}

function captureDirtyState(): string[] {
	const out = runGit(["status", "--porcelain=v1", "--untracked-files=all", "--ignored=no"], { allowFailure: true });
	return out
		.split("\n")
		.map((l) => l.trimEnd())
		.filter((l) => l.length > 0);
}

// ---------- remote normalization --------------------------------------------

function normalizeRemote(url: string): string {
	let u = url.trim();
	if (u.endsWith("/")) u = u.slice(0, -1);
	if (u.startsWith("git@")) {
		const m = u.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
		if (m) return `https://${m[1]}/${m[2]}`;
	}
	if (u.startsWith("ssh://")) {
		const m = u.match(/^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/);
		if (m) return `https://${m[1]}/${m[2]}`;
	}
	u = u.replace(/^https?:\/\//, "https://");
	u = u.replace(/\.git$/, "");
	return u;
}

// ---------- main helpers ----------------------------------------------------

function getUpstream() {
	const remotesRaw = runGit(["remote"]);
	const remoteNames = remotesRaw.split("\n").map((s) => s.trim()).filter(Boolean);
	if (!remoteNames.includes("upstream")) {
		throw new Error("Required remote 'upstream' is missing. Add it before running the collector.");
	}
	const upstreamUrl = runGit(["config", "--get", "remote.upstream.url"]).trim();
	const upstreamHead = runGit(["rev-parse", "upstream/main^{commit}"]).trim();
	const upstreamTree = runGit(["rev-parse", "upstream/main^{tree}"]).trim();
	return {
		remote_name: "upstream",
		url: upstreamUrl,
		branch: "main",
		commit_oid: upstreamHead,
		tree_oid: upstreamTree,
	};
}

function getFork(upstreamUrl: string) {
	const forkUrl = runGit(["config", "--get", "remote.origin.url"]).trim();
	if (!forkUrl) throw new Error("Required remote 'origin' is missing.");
	const branch = runGit(["symbolic-ref", "--short", "HEAD"]).trim();
	const forkNormalized = normalizeRemote(forkUrl);
	const upstreamNormalized = normalizeRemote(upstreamUrl);
	if (forkNormalized === upstreamNormalized) {
		throw new Error("origin and upstream remotes resolve to the same URL after normalization.");
	}
	return { remote_name: "origin", url: forkUrl, branch };
}

function getWorkingCopy() {
	const headOid = runGit(["rev-parse", "HEAD"]).trim();
	const treeOid = runGit(["rev-parse", "HEAD^{tree}"]).trim();
	const mergeBase = runGit(["merge-base", "HEAD", "upstream/main"]).trim();
	const leftRight = runGit(["rev-list", "--left-right", "--count", "HEAD...upstream/main"]).trim();
	const parts = leftRight.split(/\s+/);
	const ahead = Number.parseInt(parts[0] ?? "0", 10);
	const behind = Number.parseInt(parts[1] ?? "0", 10);
	const shallowRaw = runGit(["rev-parse", "--is-shallow-repository"]).trim();
	const isShallow = shallowRaw === "true";

	// submodules
	const submodules: { path: string; url: string; oid: string }[] = [];
	const submodulesFile = join(repoRoot(), ".gitmodules");
	if (existsSync(submodulesFile)) {
		const out = runGit(["config", "-f", ".gitmodules", "--get-regexp", "^submodule\\."]).trim();
		const subNames = new Set<string>();
		const subUrls = new Map<string, string>();
		for (const line of out.split("\n")) {
			const m = line.match(/^submodule\.(.+?)\.url\s+(.+)$/);
			if (m) {
				subNames.add(m[1]);
				subUrls.set(m[1], m[2]);
			}
		}
		for (const name of [...subNames].sort()) {
			const subPath = runGit(["config", "-f", ".gitmodules", `--get`, `submodule.${name}.path`]).trim();
			let oid = "not-checked-out";
			const headFile = join(repoRoot(), ".git", "modules", subPath, "HEAD");
			if (existsSync(headFile)) {
				const headContents = readFileSync(headFile, "utf8").trim();
				if (/^[0-9a-f]{40}$/.test(headContents)) {
					oid = headContents;
				} else {
					const refMatch = headContents.match(/^ref:\s*(.+)$/);
					if (refMatch) {
						const refFile = join(repoRoot(), ".git", "modules", subPath, refMatch[1]);
						if (existsSync(refFile)) {
							oid = readFileSync(refFile, "utf8").trim();
						}
					}
				}
			}
			const url = subUrls.get(name) ?? "";
			submodules.push({ path: subPath, url, oid });
		}
	}

	// LFS pointer count
	let lfsCount = 0;
	const lsFilesOut = runGit(["ls-files"], { allowFailure: true });
	const lfsFiles = lsFilesOut
		.split("\n")
		.filter((p) => p.trim().length > 0)
		.filter((p) => {
			try {
				const content = readFileSync(join(repoRoot(), p), "utf8");
				return content.startsWith("version https://git-lfs.github.com/spec/v1");
			} catch {
				return false;
			}
		});
	lfsCount = lfsFiles.length;

	return {
		head_oid: headOid,
		tree_oid: treeOid,
		merge_base_with_upstream: mergeBase,
		ahead,
		behind,
		is_shallow: isShallow,
		submodules,
		lfs_pointer_count: lfsCount,
	};
}

function getTags(head: string) {
	const out = runGit(["describe", "--tags", "--abbrev=0", head], { allowFailure: true });
	const nearest = out.trim();
	if (!nearest) return { nearest: "", distance: 0 };
	const distance = Number.parseInt(runGit(["rev-list", `${nearest}..${head}`, "--count"]).trim(), 10);
	return { nearest, distance: Number.isFinite(distance) ? distance : 0 };
}

// ---------- entry -----------------------------------------------------------

function main(): void {
	const dirty = captureDirtyState();
	if (dirty.length > 0) {
		throw new Error(
			`Working tree is dirty during source-baseline capture. ${dirty.length} entries. Run 'git status' for details.`,
		);
	}
	const upstream = getUpstream();
	const fork = getFork(upstream.url);
	const wc = getWorkingCopy();
	const tags = getTags(wc.head_oid);

	const payload = {
		schema_version: 1,
		upstream,
		fork,
		working_copy: wc,
		tags,
	};

	mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
	writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, "\t") + "\n", "utf8");
	// eslint-disable-next-line no-console
	console.log(`Wrote ${OUTPUT_PATH}`);
	// eslint-disable-next-line no-console
	console.log(`upstream/main @ ${upstream.commit_oid}`);
	// eslint-disable-next-line no-console
	console.log(`HEAD         @ ${wc.head_oid}`);
	// eslint-disable-next-line no-console
	console.log(`merge-base   @ ${wc.merge_base_with_upstream}`);
	// eslint-disable-next-line no-console
	console.log(`ahead/behind ${wc.ahead}/${wc.behind}`);
}

main();