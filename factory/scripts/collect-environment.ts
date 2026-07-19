#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package B
 *
 * Collect macOS arm64 environment proof.
 *
 * Output: factory/inventories/environment.json
 *
 * Rules:
 *   - Secrets are NEVER recorded (only proxy variable names).
 *   - Native assertions are evaluated: uname -m, process arch, bun arch,
 *     node arch, and Rosetta translation state must all be arm64 / disabled.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OUTPUT_PATH = "factory/inventories/environment.json";

interface RunResult {
	stdout: string;
	stderr: string;
	status: number | null;
}

function run(cmd: string, args: string[], opts: { allowFailure?: boolean } = {}): RunResult {
	const proc = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (proc.status !== 0 && !opts.allowFailure) {
		// non-fatal: just return what we have
	}
	return {
		stdout: (proc.stdout ?? "").toString(),
		stderr: (proc.stderr ?? "").toString(),
		status: proc.status,
	};
}

function shQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

function safe(cmd: string, args: string[]): string {
	const r = run(cmd, args, { allowFailure: true });
	return (r.stdout || r.stderr || "").trim();
}

function fsCaseSensitive(): boolean {
	const r = run("sh", ["-c", "touch /tmp/FactoryCsTest.X && touch /tmp/factorycstest.x && rm -f /tmp/FactoryCsTest.X /tmp/factorycstest.x && echo sensitive || echo insensitive"], {
		allowFailure: true,
	});
	const out = (r.stdout || r.stderr || "").trim();
	return out.includes("sensitive");
}

function memoryBytes(): number {
	const r = run("sysctl", ["-n", "hw.memsize"]);
	const n = Number.parseInt(r.stdout.trim(), 10);
	return Number.isFinite(n) ? n : 0;
}

function cpuModel(): string {
	return safe("sysctl", ["-n", "machdep.cpu.brand_string"]);
}

function logicalCpus(): number {
	const r = run("sysctl", ["-n", "hw.logicalcpu"]);
	const n = Number.parseInt(r.stdout.trim(), 10);
	return Number.isFinite(n) ? n : 0;
}

function processArch(): string {
	const r = run("node", ["-p", "process.arch"]);
	return r.stdout.trim();
}

function bunArch(): string {
	const r = run("bun", ["-p", "process.arch"]);
	return r.stdout.trim() || "unknown";
}

function nodeArch(): string {
	const r = run("node", ["-p", "process.platform + '/' + process.arch"]);
	return r.stdout.trim();
}

function rosettaTranslated(): boolean {
	const r = run("sysctl", ["-in", "sysctl.proc_translated"], { allowFailure: true });
	const v = r.stdout.trim();
	if (v === "0" || v === "") return false;
	return v === "1";
}

function gitLfsVersion(): string {
	const r = run("git", ["lfs", "version"], { allowFailure: true });
	const first = (r.stdout || r.stderr).split("\n")[0]?.trim() ?? "not-installed";
	return first;
}

function bunRevision(): string {
	return safe("bun", ["--revision"]);
}

function vscodeVersion(): string | null {
	const r = run("code", ["--version"], { allowFailure: true });
	const first = r.stdout.split("\n")[0]?.trim();
	return first || null;
}

function xcodePathAndVersion(): { path: string | null; version: string | null } {
	const path = safe("xcode-select", ["-p"]);
	if (!path) return { path: null, version: null };
	const r = run("pkgutil", ["--pkg-info=com.apple.pkg.CLTools_Executables"], { allowFailure: true });
	const vMatch = (r.stdout || "").match(/version:\s*(.+)/);
	return { path, version: vMatch ? vMatch[1].trim() : null };
}

function clangVersion(): string {
	return safe("clang", ["--version"]).split("\n")[0] ?? "";
}

function pythonVersion(): string {
	return safe("python3", ["--version"]);
}

function proxyVarNames(): string[] {
	const names = [
		"HTTPS_PROXY",
		"HTTP_PROXY",
		"https_proxy",
		"http_proxy",
		"NO_PROXY",
		"no_proxy",
		"ALL_PROXY",
		"all_proxy",
	];
	return names.filter((n) => Object.prototype.hasOwnProperty.call(process.env, n));
}

function ciIndicator(): boolean {
	return Boolean(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI);
}

function main(): void {
	const timestamp = new Date().toISOString();
	const unameM = safe("uname", ["-m"]);
	const sw = safe("sw_vers", []);
	const swLines = sw.split("\n").map((l) => l.trim());
	const osName = swLines.find((l) => l.startsWith("ProductName"))?.split("\t").pop() ?? "unknown";
	const osVersion = swLines.find((l) => l.startsWith("ProductVersion"))?.split("\t").pop() ?? "unknown";
	const osBuild = swLines.find((l) => l.startsWith("BuildVersion"))?.split("\t").pop() ?? "unknown";
	const kernel = safe("uname", ["-s"]);
	const xcode = xcodePathAndVersion();

	const nativeAssertions = {
		uname_m: unameM,
		process_arch: processArch(),
		bun_arch: bunArch(),
		node_arch: nodeArch(),
		rosetta_disabled: !rosettaTranslated(),
		all_pass:
			unameM === "arm64" &&
			processArch() === "arm64" &&
			bunArch() === "arm64" &&
			nodeArch() === "darwin/arm64" &&
			!rosettaTranslated(),
	};

	const payload = {
		schema_version: 1,
		timestamp,
		os: { name: osName, version: osVersion, build: osBuild },
		kernel,
		architecture: unameM,
		process_architecture: processArch(),
		bun_architecture: bunArch(),
		node_architecture: nodeArch(),
		rosetta_translated: rosettaTranslated(),
		cpu: cpuModel(),
		logical_cpus: logicalCpus(),
		memory_bytes: memoryBytes(),
		fs_case_sensitive: fsCaseSensitive(),
		git_version: safe("git", ["--version"]).replace(/^git version\s+/, ""),
		git_lfs_version: gitLfsVersion(),
		bun_version: safe("bun", ["--version"]),
		bun_revision: bunRevision(),
		node_version: safe("node", ["--version"]).replace(/^v/, ""),
		npm_version: safe("npm", ["--version"]),
		vscode_version: vscodeVersion(),
		vscode_architecture: null,
		xcode_path: xcode.path,
		xcode_version: xcode.version,
		python_version: pythonVersion(),
		clang_version: clangVersion(),
		shell: safe("sh", ["-c", "echo $SHELL"]),
		locale: Intl.DateTimeFormat().resolvedOptions().locale,
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		proxy_variable_names: proxyVarNames(),
		ci_indicator: ciIndicator(),
		native_assertions: nativeAssertions,
	};

	mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
	writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, "\t") + "\n", "utf8");
	// eslint-disable-next-line no-console
	console.log(`Wrote ${OUTPUT_PATH}`);
	// eslint-disable-next-line no-console
	console.log(`native_assertions.all_pass = ${nativeAssertions.all_pass}`);
}

// Reference shQuote to keep the symbol referenced for downstream tooling.
void shQuote;
main();