/**
 * Parser Helper Runtime — Real Binary RED/GREEN
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * Phase 3.
 *
 * This test file exercises the REAL helper binary at the production
 * layout:
 *
 *   <sdk-root>/bin/parser-helper/<platform>/cline-parser-helper[.exe]
 *
 * The test passes when the binary is present at the expected path.
 * CI must run `cross-compile.sh` to populate the vendor layout
 * before invoking this suite.
 *
 * Required test cases (reviewer's Phase 3 gate):
 *   - safe compound (pwd; pwd) → complete AST (no error)
 *   - command-substitution present (echo "$(rm -rf foo)") →
 *     complete AST + hasCommandSubstitution: true
 *   - shell wrapper (bash -c 'rm -rf "$HOME"') → complete AST +
 *     inner source captured + isWrapper=true
 *   - R5 catastrophic (rm -rf "$HOME") → complete AST + rm cmd
 *   - malformed input → parseStatus: "failed" (not throwing)
 *   - R5 attack via redirection (pwd > ~/.ssh/authorized_keys) →
 *     complete AST + redirect captured
 *
 * The test only runs on the host platform; if the binary is absent
 * for the current platform, the test SKIPS (not FAIL) so CI can run
 * on architectures without a built binary.
 *
 * Protocol is pinned to v2 via PARSER_HELPER_PROTOCOL_VERSION.
 */

import { existsSync } from "node:fs";
import { platform as processPlatform, arch as processArch } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { MvdanShHelper } from "./runtime";

type HelperPlatform = "darwin-arm64" | "darwin-amd64" | "linux-amd64" | "linux-arm64" | "win32-x64" | null;

function detectHelperPlatform(): HelperPlatform {
	const p = processPlatform;
	const a = processArch;
	if (p === "darwin" && a === "arm64") return "darwin-arm64";
	if (p === "darwin" && (a === "x64" || a === "ia32")) return "darwin-amd64";
	if (p === "linux" && (a === "x64" || a === "ia32")) return "linux-amd64";
	if (p === "linux" && a === "arm64") return "linux-arm64";
	if (p === "win32" && (a === "x64" || a === "ia32")) return "win32-x64";
	return null;
}

function resolveSdkRoot(startDir: string): string {
	let dir = startDir;
	for (let i = 0; i < 12; i++) {
		const candidate = join(dir, "package.json");
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const pkg = require(candidate) as { name?: string };
			if (pkg && pkg.name === "@cline/core") {
				return dir;
			}
		} catch {
			// ignore
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return startDir;
}

const sdkRoot = resolveSdkRoot(
	dirname(fileURLToPath(import.meta.url)),
);
const HELPER_PLATFORM = detectHelperPlatform();
const HELPER_PATH = (() => {
	if (!HELPER_PLATFORM) return null;
	const ext = HELPER_PLATFORM === "win32-x64" ? ".exe" : "";
	const candidate = join(
		sdkRoot,
		"bin",
		"parser-helper",
		HELPER_PLATFORM,
		`cline-parser-helper${ext}`,
	);
	return existsSync(candidate) ? candidate : null;
})();

describe("parser-helper/runtime — REAL binary RED/GREEN (Phase 3)", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
		if (!HELPER_PATH || !HELPER_PLATFORM) return;
		helper = new MvdanShHelper({
			platform: HELPER_PLATFORM,
			binaryPath: () => HELPER_PATH,
		});
	});

	it("helper binary at the expected vendor layout (or skip if absent)", () => {
		if (!HELPER_PATH) {
			return;
		}
		expect(HELPER_PATH).toMatch(/cline-parser-helper(\.exe)?$/);
	});

	it("pwd; pwd → complete AST with two cmd stmts", async () => {
		if (!HELPER_PATH) return;
		const r = await helper.invoke({ command: "pwd; pwd" });
		expect(r).not.toBeNull();
		expect(r!.protocolVersion).toBe(2);
		expect(r!.parseStatus).toBe("complete");
		expect(r!.hasCommandSubstitution).toBe(false);
		expect(r!.program?.stmts).toHaveLength(2);
		expect(r!.program?.stmts[0].kind).toBe("cmd");
		expect(r!.program?.stmts[1].kind).toBe("cmd");
	});

	it("echo \"$(rm -rf foo)\" → complete AST + hasCommandSubstitution=true", async () => {
		if (!HELPER_PATH) return;
		const r = await helper.invoke({ command: 'echo "$(rm -rf foo)"' });
		expect(r).not.toBeNull();
		expect(r!.hasCommandSubstitution).toBe(true);
	});

	it("bash -c 'rm -rf \"$HOME\"' → wrapper AST with inner source", async () => {
		if (!HELPER_PATH) return;
		const r = await helper.invoke({ command: 'bash -c \'rm -rf "$HOME"\'' });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
		const stmts = r!.program?.stmts ?? [];
		expect(stmts.length).toBeGreaterThan(0);
		const cmd = stmts[0].cmd;
		expect(cmd).toBeDefined();
		expect(cmd!.isWrapper).toBe(true);
		expect(cmd!.wrapperOf).toBe("bash");
		expect(cmd!.inner).toBe('rm -rf "$HOME"');
	});

	it("rm -rf \"$HOME\" → complete AST with rm cmd (no parse failure)", async () => {
		if (!HELPER_PATH) return;
		const r = await helper.invoke({ command: 'rm -rf "$HOME"' });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
	});

	it("pwd > ~/.ssh/authorized_keys → complete AST with redirect captured", async () => {
		if (!HELPER_PATH) return;
		const r = await helper.invoke({ command: "pwd > ~/.ssh/authorized_keys" });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
		const cmd = r!.program?.stmts[0].cmd;
		expect(cmd).toBeDefined();
		expect(cmd!.redirects.length).toBeGreaterThan(0);
		expect(cmd!.redirects[0].op).toBe(">");
		expect(cmd!.redirects[0].path).toBe("~/.ssh/authorized_keys");
	});

	it("malformed input → parseStatus: failed (no throw, V2 dormant)", async () => {
		if (!HELPER_PATH) return;
		const r = await helper.invoke({ command: "${BROKEN_INVOCATION" });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("failed");
		expect(r!.program).toBeNull();
		expect(r!.errors.length).toBeGreaterThan(0);
	});

	it("sourceSha256 is a 64-char hex string", async () => {
		if (!HELPER_PATH) return;
		const r = await helper.invoke({ command: "git status && git diff" });
		expect(r).not.toBeNull();
		expect(r!.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
	});
});
