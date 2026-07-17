#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package H
 *
 * Exact (byte-exact, no normalization) whole-file duplicate baseline.
 *
 * Output: factory/baselines/exact-duplicates.json
 *
 * Rules:
 *   - byte-exact content, no normalization
 *   - group by SHA-256
 *   - exclude zero-byte files
 *   - retain generated, test, example, production classifications
 *   - include group only when at least two paths share a hash
 *   - include bytes and line count
 *   - sort paths lexicographically within group
 *   - sort groups by repeated_bytes desc, then hash asc
 *   - calculate represented duplicated bytes without pretending this equals removable code
 *   - all dispositions = "unreviewed" (this ACT records, doesn't remediate)
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const OUTPUT_PATH = "factory/baselines/exact-duplicates.json";

function repoRoot(): string {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (r.status !== 0) throw new Error("git rev-parse failed");
	return (r.stdout ?? "").trim();
}

const ROOT = repoRoot();

function classify(path: string): string {
	if (path.includes("/fixtures/") || path.includes("/__fixtures__/") || path.includes("/test-data/") || path.includes("/mocks/")) return "fixture";
	if (path.includes("/test/") || path.includes("/tests/") || path.includes("/__tests__/") || path.includes("/specs/") || path.includes("/testing-platform/") || path.endsWith(".test.ts") || path.endsWith(".spec.ts") || path.endsWith(".test.tsx")) return "test";
	if (path.includes("node_modules/") || path.includes("/vendor/") || path.includes("/third_party/")) return "vendor";
	if (path.startsWith("apps/vscode/src/generated") || path.startsWith("apps/vscode/src/shared/proto") || path.includes("/dist/") || path.endsWith(".d.ts") && path.includes("/generated/")) return "generated";
	if (path.includes("/examples/") || path.startsWith("examples/") || path.startsWith("sdk/examples/")) return "example";
	if (path.startsWith("docs/") || path.endsWith(".md") || path.endsWith(".mdx")) return "documentation";
	if (path.endsWith(".json") || path.endsWith(".yaml") || path.endsWith(".yml") || path.endsWith(".toml")) return "configuration";
	return "production";
}

function main(): void {
	const proc = spawnSync("git", ["ls-files", "-z"], {
		cwd: ROOT,
		encoding: "buffer",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (proc.status !== 0) throw new Error(`git ls-files failed`);
	const buf = proc[0] as Buffer;
	if (!buf) throw new Error("git ls-files returned no output");
	const files = buf.toString("utf8").split("\0").filter((s) => s.length > 0);

	const hashToPaths = new Map<string, { path: string; bytes: number; lines: number; classifications: Set<string> }[]>();

	for (const path of files) {
		const abs = `${ROOT}/${path}`;
		let st;
		try {
			st = statSync(abs);
		} catch {
			continue;
		}
		if (!st.isFile()) continue;
		if (st.size === 0) continue; // skip zero-byte
		const content = readFileSync(abs);
		const sha = createHash("sha256").update(content).digest("hex");
		const lines = content.toString("utf8").split("\n").length;
		const cls = classify(path);
		const arr = hashToPaths.get(sha) ?? [];
		arr.push({ path, bytes: st.size, lines, classifications: new Set([cls]) });
		hashToPaths.set(sha, arr);
	}

	// build groups only for hashes with >= 2 paths
	const groups: {
		sha256: string;
		bytes: number;
		lines: number;
		paths: string[];
		classifications: string[];
		repeated_bytes: number;
		disposition: string;
	}[] = [];

	for (const [sha, arr] of hashToPaths.entries()) {
		if (arr.length < 2) continue;
		const paths = arr.map((a) => a.path).sort();
		const classifications = [...new Set(arr.flatMap((a) => [...a.classifications]))].sort();
		const bytes = arr[0].bytes;
		const lines = arr[0].lines;
		const repeated = bytes * (arr.length - 1); // duplicated count (excluding the canonical copy)
		groups.push({
			sha256: sha,
			bytes,
			lines,
			paths,
			classifications,
			repeated_bytes: repeated,
			disposition: "unreviewed",
		});
	}

	groups.sort((a, b) => (b.repeated_bytes - a.repeated_bytes) || a.sha256.localeCompare(b.sha256));

	const totalRepeated = groups.reduce((s, g) => s + g.repeated_bytes, 0);
	const totalFilesInGroups = groups.reduce((s, g) => s + g.paths.length, 0);

	const payload = {
		schema_version: 1,
		algorithm: "sha256-byte-exact-whole-file",
		tracked_files_examined: files.length,
		duplicate_group_count: groups.length,
		duplicate_files_total: totalFilesInGroups,
		represented_duplicated_bytes: totalRepeated,
		groups,
	};

	mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
	writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, "\t") + "\n", "utf8");
	// eslint-disable-next-line no-console
	console.log(`Wrote ${OUTPUT_PATH}`);
	// eslint-disable-next-line no-console
	console.log(`groups=${groups.length} represented_duplicated_bytes=${totalRepeated}`);
}

main();