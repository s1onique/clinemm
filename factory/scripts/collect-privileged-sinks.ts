#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package J
 *
 * Privileged-sink candidate discovery.
 *
 * Output: factory/inventories/privileged-sink-candidates.csv
 *
 * Categories (per spec §19):
 *   process execution, terminal execution, filesystem write, filesystem delete,
 *   workspace mutation, browser launch or control, MCP installation, MCP invocation,
 *   plugin loading, hook execution, credential retrieval, remote configuration,
 *   marketplace installation, connector ingress, scheduled execution,
 *   headless execution, auto-approval decision, release publication, package publication.
 *
 * This is a discovery-only inventory. review_status=unreviewed for every row.
 * Semantic review belongs to ACT-CLINEMM-PRIVILEGED-SINK-REGISTER01.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const OUTPUT_PATH = "factory/inventories/privileged-sink-candidates.csv";

function repoRoot(): string {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (r.status !== 0) throw new Error("git rev-parse failed");
	return (r.stdout ?? "").trim();
}

const ROOT = repoRoot();

interface SinkMatch {
	path: string;
	line: number;
	symbol: string;
	sink_kind: string;
	api: string;
	argument_summary: string;
	production_status: string;
	test_status: string;
}

const SINK_PATTERNS: { sink_kind: string; api: string; rx: RegExp; symbol: string }[] = [
	{ sink_kind: "process execution", api: "child_process.spawn", rx: /\bspawn\s*\(/g, symbol: "spawn" },
	{ sink_kind: "process execution", api: "child_process.exec", rx: /\bexec\s*\(/g, symbol: "exec" },
	{ sink_kind: "process execution", api: "child_process.execSync", rx: /\bexecSync\s*\(/g, symbol: "execSync" },
	{ sink_kind: "process execution", api: "child_process.spawnSync", rx: /\bspawnSync\s*\(/g, symbol: "spawnSync" },
	{ sink_kind: "process execution", api: "child_process.fork", rx: /\bfork\s*\(/g, symbol: "fork" },
	{ sink_kind: "process execution", api: "Bun.spawn", rx: /\bBun\s*\.\s*spawn\s*\(/g, symbol: "Bun.spawn" },
	{ sink_kind: "process execution", api: "Bun.spawnSync", rx: /\bBun\s*\.\s*spawnSync\s*\(/g, symbol: "Bun.spawnSync" },

	{ sink_kind: "filesystem write", api: "fs.writeFile", rx: /\bwriteFile(?:Sync)?\s*\(/g, symbol: "writeFile" },
	{ sink_kind: "filesystem write", api: "fs.appendFile", rx: /\bappendFile(?:Sync)?\s*\(/g, symbol: "appendFile" },
	{ sink_kind: "filesystem write", api: "fs.createWriteStream", rx: /\bcreateWriteStream\s*\(/g, symbol: "createWriteStream" },
	{ sink_kind: "filesystem delete", api: "fs.unlink", rx: /\bunlink(?:Sync)?\s*\(/g, symbol: "unlink" },
	{ sink_kind: "filesystem delete", api: "fs.rm", rx: /\brm(?:Sync)?\s*\(/g, symbol: "rm" },
	{ sink_kind: "filesystem delete", api: "fs.rmdir", rx: /\brmdir(?:Sync)?\s*\(/g, symbol: "rmdir" },
	{ sink_kind: "filesystem delete", api: "rimraf", rx: /\brimraf(?:Sync)?\s*\(/g, symbol: "rimraf" },
	{ sink_kind: "filesystem delete", api: "Bun.write", rx: /\bBun\s*\.\s*write\s*\(/g, symbol: "Bun.write" },

	{ sink_kind: "browser launch", api: "puppeteer.launch", rx: /\bpuppeteer\s*\.\s*launch\s*\(/g, symbol: "puppeteer.launch" },
	{ sink_kind: "browser launch", api: "chromium.launch", rx: /\bchromium\s*\.\s*launch\s*\(/g, symbol: "chromium.launch" },
	{ sink_kind: "browser launch", api: "playwright.chromium", rx: /\bplaywright\s*\.\s*chromium\s*\.\s*launch\s*\(/g, symbol: "playwright.chromium" },

	{ sink_kind: "MCP installation", api: "vscode.commands.executeCommand('cline.addToCline')", rx: /['"`]cline\.addToCline['"`]/g, symbol: "cline.addToCline" },
	{ sink_kind: "MCP installation", api: "McpHub.installServer", rx: /\binstallServer\s*\(/g, symbol: "installServer" },

	{ sink_kind: "MCP invocation", api: "McpHub.callTool", rx: /\bcallTool\s*\(/g, symbol: "callTool" },
	{ sink_kind: "MCP invocation", api: "client.callTool", rx: /\bclient\s*\.\s*callTool\s*\(/g, symbol: "client.callTool" },

	{ sink_kind: "credential retrieval", api: "context.secrets.get", rx: /\bcontext\s*\.\s*secrets\s*\.\s*get\s*\(/g, symbol: "context.secrets.get" },
	{ sink_kind: "credential retrieval", api: "secrets.get", rx: /\bsecrets\s*\.\s*get\s*\(/g, symbol: "secrets.get" },
	{ sink_kind: "credential retrieval", api: "secrets.store", rx: /\bsecrets\s*\.\s*store\s*\(/g, symbol: "secrets.store" },

	{ sink_kind: "release publication", api: "vsce package", rx: /\bvsce\s+package\b/g, symbol: "vsce package" },
	{ sink_kind: "release publication", api: "vsce publish", rx: /\bvsce\s+publish\b/g, symbol: "vsce publish" },
	{ sink_kind: "package publication", api: "npm publish", rx: /\bnpm\s+publish\b/g, symbol: "npm publish" },
	{ sink_kind: "package publication", api: "bun publish", rx: /\bbun\s+publish\b/g, symbol: "bun publish" },

	{ sink_kind: "remote configuration", api: "fetch(remote-config)", rx: /\bremote[-_]?config\b/gi, symbol: "remote-config" },
	{ sink_kind: "scheduled execution", api: "schedule-service", rx: /\bscheduleService\b/g, symbol: "scheduleService" },
	{ sink_kind: "auto-approval decision", api: "shouldAutoApprove", rx: /\bshouldAutoApprove\b/g, symbol: "shouldAutoApprove" },
];

function isProductionPath(path: string): boolean {
	return !path.includes("/test/") && !path.includes("/tests/") && !path.includes("/__tests__/") && !path.includes("/specs/") && !path.includes("/testing-platform/") && !path.includes("/fixtures/") && !path.includes("/mocks/") && !path.endsWith(".test.ts") && !path.endsWith(".spec.ts");
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
	if (path.startsWith("evals/")) return "evals";
	if (path.startsWith("docs/")) return "docs";
	return "root";
}

function summarizeArgs(line: string): string {
	const m = line.match(/\(([^)]*)\)/);
	if (!m) return "";
	const args = m[1];
	if (args.length <= 80) return args;
	return args.slice(0, 77) + "...";
}

function main(): void {
	const proc = spawnSync("git", ["ls-files", "-z"], {
		cwd: ROOT,
		encoding: "buffer",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (proc.status !== 0) throw new Error("git ls-files failed");
	const buf = proc.stdout as Buffer | null;
	if (!buf) throw new Error("git ls-files returned no output");
	const files = buf.toString("utf8").split("\0").filter((s) => s.length > 0);

	const matches: SinkMatch[] = [];

	for (const path of files) {
		if (!path.endsWith(".ts") && !path.endsWith(".tsx") && !path.endsWith(".js") && !path.endsWith(".mjs") && !path.endsWith(".cjs")) continue;
		if (path.includes("node_modules/")) continue;
		const abs = `${ROOT}/${path}`;
		let st;
		try {
			st = statSync(abs);
		} catch {
			continue;
		}
		if (!st.isFile() || st.size > 4 * 1024 * 1024) continue;
		const content = readFileSync(abs, "utf8");
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			for (const pat of SINK_PATTERNS) {
				pat.rx.lastIndex = 0;
				if (pat.rx.test(line)) {
					matches.push({
						path,
						line: i + 1,
						symbol: pat.symbol,
						sink_kind: pat.sink_kind,
						api: pat.api,
						argument_summary: summarizeArgs(line),
						production_status: isProductionPath(path) ? "production" : "test",
						test_status: isProductionPath(path) ? "non-test" : "test",
					});
				}
			}
		}
	}

	matches.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

	const header = [
		"candidate_id",
		"path",
		"line",
		"workspace",
		"symbol",
		"sink_kind",
		"api",
		"argument_summary",
		"production_status",
		"test_status",
		"confidence",
		"review_status",
		"source_sha256",
	];

	const rows: string[] = [header.join(",")];
	for (let i = 0; i < matches.length; i++) {
		const m = matches[i];
		const abs = `${ROOT}/${m.path}`;
		const sha = createHash("sha256").update(readFileSync(abs)).digest("hex");
		const cells = [
			`S${String(i + 1).padStart(6, "0")}`,
			`"${m.path.replace(/"/g, '""')}"`,
			String(m.line),
			workspaceOf(m.path),
			`"${m.symbol.replace(/"/g, '""')}"`,
			m.sink_kind,
			m.api,
			`"${m.argument_summary.replace(/"/g, '""')}"`,
			m.production_status,
			m.test_status,
			"candidate",
			"unreviewed",
			sha,
		];
		rows.push(cells.join(","));
	}

	mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
	writeFileSync(OUTPUT_PATH, rows.join("\n") + "\n", "utf8");
	// eslint-disable-next-line no-console
	console.log(`Wrote ${OUTPUT_PATH}`);
	// eslint-disable-next-line no-console
	console.log(`candidates=${matches.length}`);
}

main();