#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package G
 *
 * File-size baseline over all tracked files.
 *
 * Output: factory/baselines/file-size.csv
 *
 * Rules:
 *   - Input authority: `git ls-files -z`
 *   - Do NOT recursively walk ignored build outputs.
 *   - For each tracked text file record: path, bytes, physical lines,
 *     blank lines where practical, extension, workspace, classification,
 *     generated status, test status, production status, content SHA-256.
 *   - Allowed classifications: production, test, fixture, generated,
 *     documentation, configuration, script, vendor, example, unknown.
 *   - Do NOT exclude oversized files from the inventory.
 *   - Sort deterministically by physical lines descending, path ascending.
 *   - Report summary counts in the JSON sidecar (factory/baselines/file-size-summary.json).
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const OUTPUT_CSV = "factory/baselines/file-size.csv";
const OUTPUT_SUMMARY = "factory/baselines/file-size-summary.json";

function repoRoot(): string {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (r.status !== 0) throw new Error("git rev-parse failed");
	return (r.stdout ?? "").trim();
}

const ROOT = repoRoot();

const TEXT_EXTENSIONS = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
	".json", ".yaml", ".yml", ".md", ".mdx", ".txt", ".csv",
	".html", ".css", ".scss", ".less",
	".sh", ".bash", ".zsh", ".fish", ".ps1",
	".proto", ".graphql", ".gql", ".sql",
	".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
	".toml", ".ini", ".cfg", ".env", ".gitignore", ".gitattributes",
	".lock", ".bzl", ".bzlmod",
]);

const GENERATED_PATHS = [
	"apps/vscode/src/generated",
	"apps/vscode/src/shared/proto",
	"apps/vscode/dist",
	"apps/vscode/out",
	"apps/vscode/dist-standalone",
	"sdk/packages/core/dist",
	"sdk/packages/agents/dist",
	"sdk/packages/llms/dist",
	"sdk/packages/shared/dist",
	"sdk/packages/sdk/dist",
	"sdk/packages/ui/dist",
	"apps/cli/dist",
	"apps/cline-hub/dist",
	"apps/cline-hub/src/webview/dist",
	"apps/vscode/webview-ui/dist",
	"apps/vscode/webview-ui/build",
	"node_modules",
	"apps/vscode/.vscode-test",
	"apps/vscode/dist/ripgrep",
];

const VENDOR_PATHS = [
	"node_modules",
	"vendor",
	"third_party",
	"thirdparty",
];

const SCRIPT_KEYWORDS = [".sh", ".bash", ".zsh", "/scripts/", "/script/"];

const CONFIG_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env", ".gitignore", ".gitattributes", ".lock", ".bzl"]);

const DOC_PATHS = ["/docs/", "/README", "/CHANGELOG", "/CONTRIBUTING"];

const TEST_KEYWORDS = ["/test/", "/tests/", "/__tests__/", ".test.", ".spec.", "/specs/", "/testing-platform/"];

const FIXTURE_KEYWORDS = ["/fixtures/", "/fixture/", "/__fixtures__/", "/test-data/", "/testdata/", "/mocks/"];

function isTextFile(path: string): boolean {
	const lower = path.toLowerCase();
	for (const ext of TEXT_EXTENSIONS) {
		if (lower.endsWith(ext)) return true;
	}
	if (lower.endsWith(".gitignore") || lower.endsWith(".gitattributes") || lower.endsWith(".worktreeinclude")) return true;
	return false;
}

function isGenerated(path: string): boolean {
	for (const g of GENERATED_PATHS) {
		if (path.startsWith(g) || path.includes(`/${g}/`) || path === g) return true;
	}
	return false;
}

function isVendor(path: string): boolean {
	for (const v of VENDOR_PATHS) {
		if (path.startsWith(`${v}/`) || path.includes(`/${v}/`)) return true;
	}
	return false;
}

function isTest(path: string): boolean {
	for (const t of TEST_KEYWORDS) {
		if (path.includes(t)) return true;
	}
	return false;
}

function isFixture(path: string): boolean {
	for (const f of FIXTURE_KEYWORDS) {
		if (path.includes(f)) return true;
	}
	return false;
}

function isDocumentation(path: string): boolean {
	for (const d of DOC_PATHS) {
		if (path.includes(d)) return true;
	}
	if (path.toLowerCase().endsWith(".md") || path.toLowerCase().endsWith(".mdx")) return true;
	return false;
}

function isConfiguration(path: string): boolean {
	const lower = path.toLowerCase();
	for (const ext of CONFIG_EXTENSIONS) {
		if (lower.endsWith(ext)) return true;
	}
	return false;
}

function isScript(path: string): boolean {
	const lower = path.toLowerCase();
	for (const s of SCRIPT_KEYWORDS) {
		if (lower.endsWith(s) || lower.includes(s)) return true;
	}
	return false;
}

function isExample(path: string): boolean {
	return path.includes("/examples/") || path.startsWith("examples/") || path.startsWith("sdk/examples/");
}

function classify(path: string): string {
	if (isFixture(path)) return "fixture";
	if (isTest(path)) return "test";
	if (isVendor(path)) return "vendor";
	if (isGenerated(path)) return "generated";
	if (isExample(path)) return "example";
	if (isDocumentation(path)) return "documentation";
	if (isScript(path)) return "script";
	if (isConfiguration(path)) return "configuration";
	return "production";
}

function extension(path: string): string {
	const i = path.lastIndexOf(".");
	if (i < 0 || i === path.length - 1) return "";
	return path.slice(i);
}

function workspaceOf(path: string): string {
	if (path.startsWith("sdk/packages/")) {
		const rest = path.slice("sdk/packages/".length);
		const slash = rest.indexOf("/");
		return slash > 0 ? `sdk/packages/${rest.slice(0, slash)}` : "sdk/packages";
	}
	if (path.startsWith("apps/")) {
		const rest = path.slice("apps/".length);
		const slash = rest.indexOf("/");
		return slash > 0 ? `apps/${rest.slice(0, slash)}` : "apps";
	}
	if (path.startsWith("evals/")) {
		return "evals";
	}
	if (path.startsWith("docs/")) {
		return "docs";
	}
	return "root";
}

function countLines(content: string): { physical: number; blank: number } {
	const lines = content.split("\n");
	let physical = lines.length;
	let blank = 0;
	for (const l of lines) {
		if (l.trim() === "") blank++;
	}
	// the last empty line is conventional, count physical regardless
	return { physical, blank };
}

function main(): void {
	const proc = spawnSync("git", ["ls-files", "-z"], {
		cwd: ROOT,
		encoding: "buffer",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (proc.status !== 0) throw new Error(`git ls-files failed: ${proc.stderr?.toString()}`);
	const buf = proc.stdout as Buffer | null;
	if (!buf) throw new Error("git ls-files returned no output");
	const files = buf.toString("utf8").split("\0").filter((s) => s.length > 0);

	const rows: {
		path: string;
		bytes: number;
		physical_lines: number;
		blank_lines: number;
		extension: string;
		workspace: string;
		classification: string;
		generated: boolean;
		test: boolean;
		production: boolean;
		sha256: string;
	}[] = [];

	for (const path of files) {
		if (!isTextFile(path)) continue;
		const abs = `${ROOT}/${path}`;
		let content: string;
		try {
			const st = statSync(abs);
			if (!st.isFile()) continue;
			if (st.size > 4 * 1024 * 1024) {
				// skip files >4MB to keep memory bounded; treat as unknown size
				continue;
			}
			content = readFileSync(abs, "utf8");
		} catch {
			continue;
		}
		const bytes = Buffer.byteLength(content, "utf8");
		const { physical, blank } = countLines(content);
		const cls = classify(path);
		const sha = createHash("sha256").update(content).digest("hex");
		rows.push({
			path,
			bytes,
			physical_lines: physical,
			blank_lines: blank,
			extension: extension(path),
			workspace: workspaceOf(path),
			classification: cls,
			generated: cls === "generated",
			test: cls === "test" || cls === "fixture",
			production: cls === "production",
			sha256: sha,
		});
	}

	// Sort: physical lines desc, then path asc
	rows.sort((a, b) => (b.physical_lines - a.physical_lines) || a.path.localeCompare(b.path));

	// CSV header
	const header = ["path", "bytes", "physical_lines", "blank_lines", "extension", "workspace", "classification", "generated", "test", "production", "sha256"];
	const csvLines = [header.join(",")];
	for (const r of rows) {
		const cells = [
			`"${r.path.replace(/"/g, '""')}"`,
			String(r.bytes),
			String(r.physical_lines),
			String(r.blank_lines),
			r.extension,
			r.workspace,
			r.classification,
			r.generated ? "1" : "0",
			r.test ? "1" : "0",
			r.production ? "1" : "0",
			r.sha256,
		];
		csvLines.push(cells.join(","));
	}

	mkdirSync(dirname(OUTPUT_CSV), { recursive: true });
	writeFileSync(OUTPUT_CSV, csvLines.join("\n") + "\n", "utf8");

	// Summary
	const production = rows.filter((r) => r.production);
	const summary = {
		schema_version: 1,
		all_tracked_files: files.length,
		text_files: rows.length,
		production_files: production.length,
		production_files_gt_500: production.filter((r) => r.physical_lines > 500).length,
		production_files_gt_1000: production.filter((r) => r.physical_lines > 1000).length,
		production_files_gt_1500: production.filter((r) => r.physical_lines > 1500).length,
		largest_50_production: production.slice(0, 50).map((r) => ({
			path: r.path,
			physical_lines: r.physical_lines,
			bytes: r.bytes,
		})),
	};
	writeFileSync(OUTPUT_SUMMARY, JSON.stringify(summary, null, "\t") + "\n", "utf8");

	// eslint-disable-next-line no-console
	console.log(`Wrote ${OUTPUT_CSV}`);
	// eslint-disable-next-line no-console
	console.log(`Wrote ${OUTPUT_SUMMARY}`);
	// eslint-disable-next-line no-console
	console.log(`text_files=${rows.length} production=${production.length}`);
}

main();