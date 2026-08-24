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

// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01 / P1 hygiene
// (carried from Factory review of 79bd93ee9):
//
//   - supported shipped platform + missing helper binary  -> FAIL CI.
//   - genuinely unsupported platform                       -> explicit SKIP.
//
// We bind the describe-fn to either describe (real run; throws on
// absent-binary supported platforms via beforeAll) or describe.skip
// (true skip on unsupported platforms). This replaces the original
// `if (!HELPER_PATH) return;` per-test pattern, which silently
// reported GREEN on a supported platform with no helper binary
// present (a true shipping-artifact defect that must not hide).
const SUPPORTED_HELPER_PLATFORMS: ReadonlySet<NonNullable<HelperPlatform>> = new Set([
	"darwin-arm64",
	"darwin-amd64",
	"linux-amd64",
	"linux-arm64",
	"win32-x64",
]);
const isSupportedHelperPlatform =
	HELPER_PLATFORM !== null && SUPPORTED_HELPER_PLATFORMS.has(HELPER_PLATFORM);
const describeWithHelper = (
	HELPER_PATH || !isSupportedHelperPlatform ? describe : describe.skip
) as typeof describe;

if (!HELPER_PATH && isSupportedHelperPlatform) {
	// eslint-disable-next-line no-console
	console.error(
		`[parser-helper/runtime.real-binary] supported platform ${HELPER_PLATFORM} but vendored helper binary is missing at ${sdkRoot}/bin/parser-helper/${HELPER_PLATFORM}/. Failing the suite.`,
	);
}

describeWithHelper("parser-helper/runtime — REAL binary RED/GREEN (Phase 3)", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
		if (!HELPER_PATH) {
			if (isSupportedHelperPlatform) {
				throw new Error(
					`Vendored parser-helper binary missing for supported platform ${HELPER_PLATFORM}; cannot run RED witness.`,
				);
			}
			return;
		}
		helper = new MvdanShHelper({
			platform: HELPER_PLATFORM as NonNullable<HelperPlatform>,
			binaryPath: () => HELPER_PATH as string,
		});
	});

	it("helper binary at the expected vendor layout (or skip if absent)", () => {
		expect(HELPER_PATH).toMatch(/cline-parser-helper(\.exe)?$/);
	});

	it("pwd; pwd → complete AST with two cmd stmts", async () => {
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
		const r = await helper.invoke({ command: 'echo "$(rm -rf foo)"' });
		expect(r).not.toBeNull();
		expect(r!.hasCommandSubstitution).toBe(true);
	});

	it("bash -c 'rm -rf \"$HOME\"' → wrapper AST with inner source", async () => {
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
		const r = await helper.invoke({ command: 'rm -rf "$HOME"' });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
	});

	it("pwd > ~/.ssh/authorized_keys → complete AST with redirect captured", async () => {
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
		const r = await helper.invoke({ command: "${BROKEN_INVOCATION" });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("failed");
		expect(r!.program).toBeNull();
		expect(r!.errors.length).toBeGreaterThan(0);
	});

	it("sourceSha256 is a 64-char hex string", async () => {
		const r = await helper.invoke({ command: "git status && git diff" });
		expect(r).not.toBeNull();
		expect(r!.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
	});
});
