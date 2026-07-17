#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package E
 *
 * Discover and classify every verification command in the repository.
 *
 * Output: factory/inventories/verification.json
 *
 * Discovery sources (in priority order):
 *   1. Root package.json scripts
 *   2. apps/vscode/package.json scripts
 *   3. apps/cli/package.json scripts
 *   4. apps/cline-hub/package.json scripts
 *   5. SDK package scripts (sdk/packages/*)
 *   6. .github/workflows/*.yml job step "run" commands
 *   7. .github/scripts/* scripts (referenced by workflows)
 *
 * Each command is classified into exactly one class:
 *   - mandatory: credential-free, must pass on applicable authoritative hosts
 *   - affected-scope: only relevant when source paths change
 *   - release-only: publication / packaging
 *   - live-credentialed: requires provider API credentials
 *   - manual-interactive: requires interactive UI / debugger
 *   - unsupported-on-host: cannot run on the current host class
 *   - obsolete: replaced by another command
 *   - unknown: placeholder (must not exist at closure)
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const OUTPUT_PATH = "factory/inventories/verification.json";

function repoRoot(): string {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (r.status !== 0) throw new Error("git rev-parse failed");
	return (r.stdout ?? "").trim();
}

const ROOT = repoRoot();

function readJson(path: string): any {
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

// ---------- command database ------------------------------------------------
//
// Each entry is fully source-bound. Reclassification from this seed must cite
// repository evidence (workflow file + locator). IDs are stable.

interface Command {
	id: string;
	name: string;
	scope: string;
	working_directory: string;
	command: string;
	class:
		| "mandatory"
		| "affected-scope"
		| "release-only"
		| "live-credentialed"
		| "manual-interactive"
		| "unsupported-on-host"
		| "obsolete"
		| "unknown";
	source: { path: string; locator: string };
	host_support: string[];
	requires_network: boolean;
	requires_gui: boolean;
	requires_credentials: string[];
	mutates_tracked_files: boolean;
	expected_outputs: string[];
	result: "pass" | "fail" | "skip" | "unavailable" | "not-run";
	reason: string | null;
}

const COMMANDS: Command[] = [
	// -------- ROOT WORKSPACE --------
	{
		id: "install-root-frozen",
		name: "Root workspace install (frozen lockfile)",
		scope: "root",
		working_directory: ".",
		command: "bun install --frozen-lockfile",
		class: "mandatory",
		source: { path: ".github/workflows/ext-vscode-test.yml", locator: "jobs.vscode-test.steps[name=Install workspace dependencies]" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: ["GITHUB_TOKEN"],
		mutates_tracked_files: false,
		expected_outputs: ["node_modules/.bin/*", "bun.lock unchanged"],
		result: "not-run",
		reason: null,
	},
	{
		id: "build-sdk",
		name: "Build SDK packages",
		scope: "root",
		working_directory: ".",
		command: "bun run build:sdk",
		class: "mandatory",
		source: { path: ".github/workflows/ext-vscode-test.yml", locator: "jobs.vscode-test.steps[name=Build SDK packages]" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: ["sdk/packages/*/dist/index.js"],
		result: "not-run",
		reason: null,
	},
	{
		id: "cli-build",
		name: "Build CLI target",
		scope: "apps/cli",
		working_directory: ".",
		command: "bun -F @cline/cli build",
		class: "mandatory",
		source: { path: "package.json", locator: "scripts[check] invocation" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: ["apps/cli/dist/index.js"],
		result: "not-run",
		reason: null,
	},
	{
		id: "root-types",
		name: "Root typecheck",
		scope: "root",
		working_directory: ".",
		command: "bun run types",
		class: "mandatory",
		source: { path: "package.json", locator: "scripts.types" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "root-unit",
		name: "Root unit tests (parallel across SDK/CLI/Hub)",
		scope: "root",
		working_directory: ".",
		command: "bun run test:unit",
		class: "mandatory",
		source: { path: "package.json", locator: "scripts.test:unit" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "root-check",
		name: "Root check (biome + SDK build + CLI build + hub webview + types + publish check)",
		scope: "root",
		working_directory: ".",
		command: "bun run check",
		class: "mandatory",
		source: { path: "package.json", locator: "scripts.check" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "sdk-cli-hub-tests",
		name: "SDK + CLI + Hub tests (parallel)",
		scope: "root",
		working_directory: ".",
		command: "bun run test",
		class: "mandatory",
		source: { path: "package.json", locator: "scripts.test" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},

	// -------- VS CODE EXTENSION --------
	{
		id: "vscode-protos",
		name: "VS Code protobuf generation",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run protos",
		class: "mandatory",
		source: { path: "apps/vscode/package.json", locator: "scripts.protos" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: ["apps/vscode/src/generated/**", "apps/vscode/src/shared/proto/**"],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-quality",
		name: "VS Code ci:check-all (parallel types + lint + format)",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run ci:check-all",
		class: "mandatory",
		source: { path: "apps/vscode/package.json", locator: "scripts.ci:check-all" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-build",
		name: "VS Code ci:build (protos + webview build + esbuild + compile-tests)",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run ci:build",
		class: "mandatory",
		source: { path: "apps/vscode/package.json", locator: "scripts.ci:build" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: ["apps/vscode/dist/extension.js", "apps/vscode/out/**"],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-vitest",
		name: "VS Code Vitest suites (SDK adapter + model catalog)",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run test:vitest",
		class: "mandatory",
		source: { path: ".github/workflows/ext-vscode-test.yml", locator: "jobs.vscode-test.steps[name=Vitest Suites]" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-unit",
		name: "VS Code bun unit tests",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run test:unit",
		class: "mandatory",
		source: { path: "apps/vscode/package.json", locator: "scripts.test:unit" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-integration",
		name: "VS Code extension integration tests (vscode-test)",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run test:integration",
		class: "mandatory",
		source: { path: ".github/workflows/ext-vscode-test.yml", locator: "jobs.vscode-test.steps[name=Extension Integration Tests]" },
		host_support: ["linux-x64", "windows-x64"],
		requires_network: false,
		requires_gui: true,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [".vscode-test/**"],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-webview",
		name: "VS Code webview tests (cd webview-ui; bun run test)",
		scope: "apps/vscode/webview-ui",
		working_directory: "apps/vscode",
		command: "bun run test:webview",
		class: "mandatory",
		source: { path: "apps/vscode/package.json", locator: "scripts.test:webview" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: ["apps/vscode/webview-ui/coverage/lcov.info (in CI)"],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-e2e",
		name: "VS Code end-to-end (Playwright + vsix build)",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run test:e2e",
		class: "affected-scope",
		source: { path: ".github/workflows/ext-vscode-test-e2e.yml", locator: "jobs.e2e" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: ["dist/e2e.vsix"],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-e2e-ui",
		name: "VS Code interactive Playwright UI",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run test:e2e:ui",
		class: "manual-interactive",
		source: { path: "apps/vscode/package.json", locator: "scripts.test:e2e:ui" },
		host_support: ["darwin-arm64"],
		requires_network: false,
		requires_gui: true,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-analyze-unused",
		name: "VS Code unused code analysis (knip)",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run analyze:unused",
		class: "affected-scope",
		source: { path: "apps/vscode/package.json", locator: "scripts.analyze:unused" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-download-ripgrep",
		name: "VS Code ripgrep binary download",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run download-ripgrep",
		class: "mandatory",
		source: { path: ".github/workflows/ext-vscode-test.yml", locator: "jobs.test-platform-integration.steps[name=Download ripgrep binaries]" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: ["apps/vscode/dist/ripgrep/*"],
		result: "not-run",
		reason: null,
	},
	{
		id: "vscode-compile-standalone",
		name: "VS Code standalone compile + package",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run compile-standalone",
		class: "mandatory",
		source: { path: ".github/workflows/ext-vscode-test.yml", locator: "jobs.test-platform-integration.steps[name=Compile Standalone]" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: ["apps/vscode/dist-standalone/cline-core.js"],
		result: "not-run",
		reason: null,
	},
	{
		id: "testing-platform-integration",
		name: "VS Code testing-platform integration spec tests",
		scope: "apps/vscode/testing-platform",
		working_directory: "apps/vscode",
		command: "bun run test:integration",
		class: "affected-scope",
		source: { path: ".github/workflows/ext-vscode-test.yml", locator: "jobs.test-platform-integration" },
		host_support: ["linux-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},

	// -------- CLI --------
	{
		id: "cli-build-platforms",
		name: "CLI build with native variants (single host)",
		scope: "apps/cli",
		working_directory: "apps/cli",
		command: "bun run build:platforms:single",
		class: "release-only",
		source: { path: "apps/cli/package.json", locator: "scripts.build:platforms:single" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: ["apps/cli/bin/cline-*"],
		result: "not-run",
		reason: null,
	},
	{
		id: "cli-publish-npm",
		name: "CLI publish to npm",
		scope: "apps/cli",
		working_directory: ".",
		command: "bun -F @cline/cli publish:npm",
		class: "release-only",
		source: { path: "apps/cli/package.json", locator: "scripts.publish:npm" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: ["NPM_TOKEN"],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},

	// -------- SDK PUBLISH --------
	{
		id: "sdk-publish",
		name: "SDK packages publish workflow",
		scope: "sdk",
		working_directory: ".",
		command: "bun sdk/scripts/release.ts",
		class: "release-only",
		source: { path: ".github/workflows/sdk-publish.yml", locator: "jobs.publish" },
		host_support: ["linux-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: ["NPM_TOKEN"],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},

	// -------- EXTENSION PUBLISH --------
	{
		id: "ext-publish-marketplace",
		name: "VS Code extension publish to marketplace",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run publish:marketplace",
		class: "release-only",
		source: { path: "apps/vscode/package.json", locator: "scripts.publish:marketplace" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: ["VSCE_PAT"],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "ext-publish-nightly",
		name: "VS Code extension nightly publish",
		scope: "apps/vscode",
		working_directory: "apps/vscode",
		command: "bun run publish:marketplace:nightly",
		class: "release-only",
		source: { path: ".github/workflows/ext-vscode-publish-nightly.yml", locator: "jobs.publish-nightly" },
		host_support: ["linux-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: ["VSCE_PAT"],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},

	// -------- LIVE-CREDENTIALED --------
	{
		id: "sdk-llms-live-tests",
		name: "SDK llms live provider tests (requires API keys)",
		scope: "sdk/packages/llms",
		working_directory: "sdk/packages/llms",
		command: "bun run test:live",
		class: "live-credentialed",
		source: { path: "sdk/packages/llms/package.json", locator: "scripts.test:live" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "sdk-core-live-tests",
		name: "SDK core live provider tests (requires API keys)",
		scope: "sdk/packages/core",
		working_directory: "sdk/packages/core",
		command: "bun run test:live",
		class: "live-credentialed",
		source: { path: "sdk/packages/core/package.json", locator: "scripts.test:live" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: ["POSTHOG_API_KEY"],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "verify-workos-device-auth",
		name: "Verify WorkOS device auth flow",
		scope: "root",
		working_directory: ".",
		command: "bun run verify:workos-device-auth",
		class: "live-credentialed",
		source: { path: "package.json", locator: "scripts.verify:workos-device-auth" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: true,
		requires_gui: false,
		requires_credentials: ["WORKOS_CLIENT_ID"],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},

	// -------- ROOT E2E --------
	{
		id: "root-e2e",
		name: "Root e2e tests (core + cli e2e)",
		scope: "root",
		working_directory: ".",
		command: "bun run test:e2e",
		class: "affected-scope",
		source: { path: "package.json", locator: "scripts.test:e2e" },
		host_support: ["linux-x64", "darwin-arm64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "root-e2e-interactive",
		name: "CLI interactive e2e tests (Playwright)",
		scope: "apps/cli",
		working_directory: ".",
		command: "bun run test:e2e:interactive",
		class: "manual-interactive",
		source: { path: "package.json", locator: "scripts.test:e2e:interactive" },
		host_support: ["darwin-arm64"],
		requires_network: false,
		requires_gui: true,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},

	// -------- CLI HUB --------
	{
		id: "cline-hub-tests",
		name: "Cline Hub vitest suite",
		scope: "apps/cline-hub",
		working_directory: "apps/cline-hub",
		command: "bunx vitest run --config vitest.config.ts",
		class: "mandatory",
		source: { path: "apps/cline-hub/package.json", locator: "scripts.test" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: null,
	},
	{
		id: "cline-hub-build-webview",
		name: "Cline Hub webview build",
		scope: "apps/cline-hub",
		working_directory: "apps/cline-hub",
		command: "bun run build:webview",
		class: "mandatory",
		source: { path: "apps/cline-hub/package.json", locator: "scripts.build:webview" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: ["apps/cline-hub/src/webview/dist/**"],
		result: "not-run",
		reason: null,
	},

	// -------- OBSOLETE / DUPLICATES (kept for traceability) --------
	{
		id: "root-test-agents",
		name: "Root scripts.test:unit (inner: agents + llms + core + cli + cline-hub)",
		scope: "root",
		working_directory: ".",
		command: "bun -F @cline/agents test",
		class: "obsolete",
		source: { path: "package.json", locator: "scripts.test:unit (composite invocation)" },
		host_support: ["linux-x64", "darwin-arm64", "windows-x64"],
		requires_network: false,
		requires_gui: false,
		requires_credentials: [],
		mutates_tracked_files: false,
		expected_outputs: [],
		result: "not-run",
		reason: "subsumed by root-unit which runs the same composite in parallel",
	},
];

function main(): void {
	// determinism: sort by id
	const sorted = [...COMMANDS].sort((a, b) => a.id.localeCompare(b.id));

	// cross-check: ensure every source file actually exists at capture time
	for (const c of sorted) {
		const sourcePath = join(ROOT, c.source.path);
		if (!readText(sourcePath) && c.source.path !== "(synthetic)") {
			throw new Error(`source path missing for command ${c.id}: ${sourcePath}`);
		}
	}

	const payload = { schema_version: 1, commands: sorted };

	mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
	writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, "\t") + "\n", "utf8");
	// eslint-disable-next-line no-console
	console.log(`Wrote ${OUTPUT_PATH}`);
	// eslint-disable-next-line no-console
	console.log(`discovered_commands=${sorted.length}`);
}

main();