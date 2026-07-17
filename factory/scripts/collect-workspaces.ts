#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package D
 *
 * Collect workspace inventory from package-manager metadata.
 *
 * Output: factory/inventories/workspaces.json
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, sep } from "node:path";

const OUTPUT_PATH = "factory/inventories/workspaces.json";

function repoRoot(): string {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (r.status !== 0) throw new Error("git rev-parse failed");
	return (r.stdout ?? "").trim();
}

const ROOT = repoRoot();

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function readText(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function expandGlobs(patterns: string[], base = ROOT): string[] {
	const out = new Set<string>();
	for (const pattern of patterns) {
		if (pattern.includes("*")) {
			// Bun.Glob is available
			const glob = new Bun.Glob(pattern);
			for await (const match of glob.scan({ cwd: base, onlyFiles: false })) {
				const fullPath = join(base, match);
				if (existsSync(`${fullPath}/package.json`)) {
					out.add(match.split(sep).join(posix.sep));
				}
			}
		} else {
			const candidate = join(base, pattern, "package.json");
			if (existsSync(candidate)) {
				out.add(pattern.split(sep).join(posix.sep));
			}
		}
	}
	return [...out].sort();
}

function classify(relPath: string, pkg: any): string {
	if (relPath.startsWith("sdk/packages/")) return "sdk";
	if (relPath.startsWith("apps/examples/")) return "example";
	if (relPath.startsWith("apps/")) {
		if (relPath.startsWith("apps/vscode") || relPath.startsWith("apps/cli")) return "application";
		if (relPath.startsWith("apps/cline-hub")) return "application";
		return "application";
	}
	if (relPath.startsWith("sdk/examples")) return "example";
	return "unknown";
}

function isPublishable(pkg: any): boolean {
	return Boolean(pkg.publishConfig && pkg.publishConfig.access === "public" && !pkg.private);
}

function isExample(relPath: string): boolean {
	return relPath.includes("/examples/") || relPath.startsWith("examples/");
}

function hasTests(pkg: any): boolean {
	if (!pkg.scripts) return false;
	const keys = Object.keys(pkg.scripts);
	return keys.some((k) => /test|spec|vitest|jest/i.test(k));
}

function hasBuild(pkg: any): boolean {
	if (!pkg.scripts) return false;
	const keys = Object.keys(pkg.scripts);
	return keys.some((k) => /^build$|^build:|^compile/i.test(k));
}

function hasTypecheck(pkg: any): boolean {
	if (!pkg.scripts) return false;
	const keys = Object.keys(pkg.scripts);
	return keys.some((k) => /typecheck|types|^tsc/i.test(k));
}

function main(): void {
	const rootPkg = readJson(`${ROOT}/package.json`) as any;
	if (!rootPkg) throw new Error("root package.json unreadable");
	const workspacePatterns: string[] = rootPkg.workspaces ?? [];
	const workspacePaths = expandGlobs(workspacePatterns);

	const records = [];
	for (const relPath of workspacePaths) {
		const pkgPath = `${ROOT}/${relPath}/package.json`;
		const pkg = readJson(pkgPath) as any;
		if (!pkg) continue;
		const name: string | null = pkg.name ?? null;
		const workspaceDeps = [];
		const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
		for (const depName of Object.keys(allDeps)) {
			if (depName.startsWith("@cline/")) workspaceDeps.push(depName);
		}
		const externalDepCount = Object.keys(pkg.dependencies ?? {}).length;
		const devDepCount = Object.keys(pkg.devDependencies ?? {}).length;
		const scripts: Record<string, string> = pkg.scripts ?? {};
		records.push({
			name,
			path: relPath,
			private: Boolean(pkg.private),
			version: pkg.version ?? null,
			type: pkg.type ?? null,
			engines: pkg.engines ?? {},
			scripts,
			workspace_dependencies: workspaceDeps.sort(),
			external_dependency_count: externalDepCount,
			dev_dependency_count: devDepCount,
			has_tests: hasTests(pkg),
			has_build: hasBuild(pkg),
			has_typecheck: hasTypecheck(pkg),
			has_publish_config: Boolean(pkg.publishConfig),
			publishable: isPublishable(pkg),
			example: isExample(relPath),
			classification: classify(relPath, pkg),
		});
	}

	// detect duplicate names and unnamed
	const nameCounts = new Map<string, number>();
	for (const r of records) {
		const k = r.name ?? "<unnamed>";
		nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
	}
	const duplicateNames = [...nameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n).sort();
	const unnamedCount = records.filter((r) => r.name === null).length;

	// matched paths without package.json (sanity)
	const matchedPathsWithoutPkg = workspacePatterns.filter((p) => !p.includes("*")).filter((p) => !existsSync(join(ROOT, p, "package.json")));

	// dependency cycles (workspace graph)
	const adj = new Map<string, string[]>();
	for (const r of records) {
		if (!r.name) continue;
		adj.set(r.name, []);
	}
	for (const r of records) {
		if (!r.name) continue;
		for (const dep of r.workspace_dependencies) {
			if (adj.has(dep)) adj.get(r.name)!.push(dep);
		}
	}
	const cycles: string[][] = [];
	const visited = new Set<string>();
	const stack = new Set<string>();
	const path: string[] = [];
	function dfs(node: string): void {
		if (stack.has(node)) {
			const startIdx = path.indexOf(node);
			if (startIdx !== -1) cycles.push(path.slice(startIdx).concat(node));
			return;
		}
		if (visited.has(node)) return;
		visited.add(node);
		stack.add(node);
		path.push(node);
		for (const n of adj.get(node) ?? []) dfs(n);
		path.pop();
		stack.delete(node);
	}
	for (const n of adj.keys()) dfs(n);

	const summary = {
		schema_version: 1,
		root_workspaces_patterns: workspacePatterns,
		workspace_count: records.length,
		named_count: records.length - unnamedCount,
		unnamed_count: unnamedCount,
		publishable_count: records.filter((r) => r.publishable).length,
		application_count: records.filter((r) => r.classification === "application").length,
		sdk_count: records.filter((r) => r.classification === "sdk").length,
		example_count: records.filter((r) => r.example).length,
		duplicate_package_names: duplicateNames,
		missing_package_names: unnamedCount,
		matched_paths_without_package_json: matchedPathsWithoutPkg,
		workspace_dependency_cycles: cycles,
		workspaces: records,
	};

	mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
	writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, "\t") + "\n", "utf8");
	// eslint-disable-next-line no-console
	console.log(`Wrote ${OUTPUT_PATH}`);
	// eslint-disable-next-line no-console
	console.log(`workspace_count=${records.length} cycles=${cycles.length}`);
}

main();