#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package I
 *
 * Network-listener candidate discovery.
 *
 * Output: factory/inventories/network-listener-candidates.csv
 *
 * This is a discovery-only inventory. Each row starts with
 * review_status=unreviewed. The ACT must not claim origin checks,
 * authentication, or authorization are present or absent.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const OUTPUT_PATH = "factory/inventories/network-listener-candidates.csv";

function repoRoot(): string {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (r.status !== 0) throw new Error("git rev-parse failed");
	return (r.stdout ?? "").trim();
}

const ROOT = repoRoot();

interface Match {
	path: string;
	line: number;
	symbol: string;
	api: string;
	listener_kind: string;
	host_expression: string;
	port_expression: string;
}

// Curated subset of APIs that create listeners.
const API_PATTERNS: { api: string; listener_kind: string; rx: RegExp; symbolCapture: RegExp }[] = [
	{ api: "Bun.serve", listener_kind: "bun-serve", rx: /\bBun\s*\.\s*serve\s*\(/g, symbolCapture: /Bun/ },
	{ api: "createServer(http)", listener_kind: "http", rx: /\bhttp\s*\.\s*createServer\s*\(/g, symbolCapture: /http/ },
	{ api: "createServer(https)", listener_kind: "https", rx: /\bhttps\s*\.\s*createServer\s*\(/g, symbolCapture: /https/ },
	{ api: "createServer(net)", listener_kind: "tcp", rx: /\bnet\s*\.\s*createServer\s*\(/g, symbolCapture: /net/ },
	{ api: "WebSocketServer", listener_kind: "websocket", rx: /\bnew\s+WebSocketServer\s*\(/g, symbolCapture: /WebSocketServer/ },
	{ api: "express", listener_kind: "express", rx: /\bexpress\s*\(\s*\)/g, symbolCapture: /express/ },
	{ api: "fastify", listener_kind: "fastify", rx: /\bfastify\s*\(\s*\)/g, symbolCapture: /fastify/ },
	{ api: "hono", listener_kind: "hono", rx: /\bnew\s+Hono\s*\(/g, symbolCapture: /Hono/ },
	{ api: "vite.createServer", listener_kind: "dev-server", rx: /\bvite\s*\.\s*createServer\s*\(/g, symbolCapture: /vite/ },
	{ api: "Server.listen", listener_kind: "tcp", rx: /\.listen\s*\(\s*[0-9]+/g, symbolCapture: /\.listen/ },
	{ api: "MCP_SSE", listener_kind: "mcp-sse", rx: /\bSSEServerTransport\b/g, symbolCapture: /SSEServerTransport/ },
	{ api: "stdioServer", listener_kind: "mcp-stdio", rx: /\bStdioServerTransport\b/g, symbolCapture: /StdioServerTransport/ },
	{ api: "OAuth callback", listener_kind: "oauth-callback", rx: /\bcreateServer\s*\([^)]*callback/gi, symbolCapture: /createServer/ },
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

function extractHostAndPort(content: string, lineIdx: number, line: string): { host: string; port: string } {
	const around = content.split("\n").slice(Math.max(0, lineIdx - 5), lineIdx + 5).join("\n");
	const port = (line.match(/\.listen\s*\(\s*([0-9]+)/) || around.match(/listen\s*\(\s*([0-9]+)/) || around.match(/port\s*[:=]\s*([0-9]+)/) || ["", ""])[1] || "";
	const host = (around.match(/host\s*[:=]\s*["'`]([^"'`]+)["'`]/) || ["", ""])[1] || "";
	return { host, port };
}

function main(): void {
	const proc = spawnSync("git", ["ls-files", "-z"], {
		cwd: ROOT,
		encoding: "buffer",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (proc.status !== 0) throw new Error("git ls-files failed");
	const buf = proc[0] as Buffer;
	if (!buf) throw new Error("git ls-files returned no output");
	const files = buf.toString("utf8").split("\0").filter((s) => s.length > 0);

	const matches: Match[] = [];

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
			for (const pat of API_PATTERNS) {
				pat.rx.lastIndex = 0;
				if (pat.rx.test(line)) {
					const { host, port } = extractHostAndPort(content, i, line);
					matches.push({
						path,
						line: i + 1,
						symbol: pat.symbolCapture.source,
						api: pat.api,
						listener_kind: pat.listener_kind,
						host_expression: host,
						port_expression: port,
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
		"api",
		"listener_kind",
		"host_expression",
		"port_expression",
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
			`L${String(i + 1).padStart(5, "0")}`,
			`"${m.path.replace(/"/g, '""')}"`,
			String(m.line),
			workspaceOf(m.path),
			`"${m.symbol.replace(/"/g, '""')}"`,
			m.api,
			m.listener_kind,
			m.host_expression,
			m.port_expression,
			isProductionPath(m.path) ? "production" : "test",
			isProductionPath(m.path) ? "non-test" : "test",
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