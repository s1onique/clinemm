/**
 * Structured Command Risk -- Real Parser Helper V2 RED/GREEN
 *
 * ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01-CORRECTION01
 *
 * Evidence classification: REAL_PRODUCTION_SEAM.
 *
 * This test file is the only place in the suite that drives the
 * `MvdanShHelper.invoke(...)` -> `evaluateCommandRiskWithParser(...)`
 * pipeline end-to-end against a real, vendored parser-helper binary.
 *
 * PRE-CORRECTION01: the prior synthetic `mkParsed()` fixtures
 * fabricated their own `cmd.args` (sometimes WITH literal quote
 * characters preserved). The real parser never emits that; it
 * strips quotes before assigning the semantic argv. The bug masked
 * by the synthetic fixtures is described in section 5 (Model A) of
 * the ACT:
 *
 *   V2 takes the parser-produced `StructuredCmd` (semantic argv,
 *   `args = ["---BRANCH---"]`), reconstructs a shell-like string
 *   via `renderArgv(cmd)` (`"echo ---BRANCH---"`, no quotes), and
 *   then matches it against the V1 source-text safe-rule regex
 *   (the `host_safe_echo` rule). The regex's bare operand class
 *   excludes `-`, so no rule matches, V2 cannot promote, and V1's
 *   ASK verdict survives -- exactly the LIVE failure observed for
 *   `echo '---BRANCH---' && git status --short`.
 *
 * This file is the proof that the bug is real, and that the bounded
 * repair (a separate argv-semantic echo classifier for the V2 path)
 * closes it without weakening any load-bearing invariant.
 *
 * The test only runs on the host platform; if the binary is absent
 * for the current platform, the test SKIPS (not FAIL) so CI can run
 * on architectures without a built binary.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { arch as processArch, platform as processPlatform } from "node:process";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { commandHostAuthorization } from "./command-policy-types";
import { evaluateCommandRiskWithParser } from "./command-risk-internal";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import { MvdanShHelper } from "./parser-helper/runtime";

type HelperPlatform =
	| "darwin-arm64"
	| "darwin-amd64"
	| "linux-amd64"
	| "linux-arm64"
	| "win32-x64"
	| null;

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

const sdkRoot = resolveSdkRoot(dirname(fileURLToPath(import.meta.url)));
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
// (carried from Factory review of 79bd93ee9; CORRECTION01 of the
// 0c044cd67 ACT row):
//
//   Truth table (revised):
//
//     helper exists                     -> describe, then beforeAll binds
//     supported + helper missing        -> describe, then beforeAll throws
//                                          (fail CI; this is the bug we
//                                          must NOT silently hide)
//     unsupported platform              -> describe.skip (true skip)
//
//   Previous form was:
//     HELPER_PATH || !isSupportedHelperPlatform
//   which incorrectly SKIPPED on supported+missing, exactly the
//   residue the comments claimed to eliminate.
const SUPPORTED_HELPER_PLATFORMS: ReadonlySet<NonNullable<HelperPlatform>> = new Set([
	"darwin-arm64",
	"darwin-amd64",
	"linux-amd64",
	"linux-arm64",
	"win32-x64",
]);
const isSupportedHelperPlatform =
	HELPER_PLATFORM !== null && SUPPORTED_HELPER_PLATFORMS.has(HELPER_PLATFORM);
// Run describe UNLESS the platform is genuinely unsupported. The
// supported+missing case runs through describe and the beforeAll
// guard in each describe block throws, failing the suite.
const describeWithHelper = (
	isSupportedHelperPlatform ? describe : describe.skip
) as typeof describe;

if (!HELPER_PATH && isSupportedHelperPlatform) {
	// eslint-disable-next-line no-console
	console.error(
		`[structured-command-risk.real-binary] supported platform ${HELPER_PLATFORM} but vendored helper binary is missing at ${sdkRoot}/bin/parser-helper/${HELPER_PLATFORM}/. Failing the suite.`,
	);
}

const SAFE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});

/* ---------------------------------------------------------------------- *
 * Section A: parser argv contract (no policy involvement)               *
 * ---------------------------------------------------------------------- */

describeWithHelper("structured-command-risk -- REAL parser-helper argv contract", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
		// CORRECTION01: a missing helper on a supported platform is a
		// shipping-artifact defect that must fail the suite loudly.
		// On an unsupported platform the describe-block is bound to
		// describe.skip and this beforeAll never runs.
		if (!HELPER_PATH) {
			throw new Error(
				`Vendored parser-helper binary missing for supported platform ${HELPER_PLATFORM}; cannot run RED witness.`,
			);
		}
		helper = new MvdanShHelper({
			platform: HELPER_PLATFORM as NonNullable<HelperPlatform>,
			binaryPath: () => HELPER_PATH as string,
		});
	});

	it("real parser strips quotes from echo '---BRANCH---' argv", async () => {
		const r = await helper.invoke({ command: "echo '---BRANCH---'" });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
		const stmt = r!.program!.stmts[0];
		expect(stmt.kind).toBe("cmd");
		if (stmt.kind !== "cmd") return;
		expect(stmt.cmd.name).toBe("echo");
		expect(stmt.cmd.args).toEqual(["---BRANCH---"]);
	});

	it('real parser strips quotes from echo "---BRANCH---" argv', async () => {
		const r = await helper.invoke({ command: 'echo "---BRANCH---"' });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
		const stmt = r!.program!.stmts[0];
		expect(stmt.kind).toBe("cmd");
		if (stmt.kind !== "cmd") return;
		expect(stmt.cmd.args).toEqual(["---BRANCH---"]);
	});

	it("real parser produces args=['hello'] for echo hello", async () => {
		const r = await helper.invoke({ command: "echo hello" });
		expect(r).not.toBeNull();
		const stmt = r!.program!.stmts[0];
		expect(stmt.kind).toBe("cmd");
		if (stmt.kind !== "cmd") return;
		expect(stmt.cmd.args).toEqual(["hello"]);
	});

	it("real parser splits -n from echo body (echo -n hello -> args=[-n, hello])", async () => {
		const r = await helper.invoke({ command: "echo -n hello" });
		expect(r).not.toBeNull();
		const stmt = r!.program!.stmts[0];
		expect(stmt.kind).toBe("cmd");
		if (stmt.kind !== "cmd") return;
		expect(stmt.cmd.args).toEqual(["-n", "hello"]);
	});
});

/* ---------------------------------------------------------------------- *
 * Section B: end-to-end V2 through the real parser helper                *
 * ---------------------------------------------------------------------- */

describeWithHelper("structured-command-risk -- REAL parser-helper V2 end-to-end (CORRECTION01)", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
		// CORRECTION01: a missing helper on a supported platform is a
		// shipping-artifact defect that must fail the suite loudly.
		// On an unsupported platform the describe-block is bound to
		// describe.skip and this beforeAll never runs.
		if (!HELPER_PATH) {
			throw new Error(
				`Vendored parser-helper binary missing for supported platform ${HELPER_PLATFORM}; cannot run RED witness.`,
			);
		}
		helper = new MvdanShHelper({
			platform: HELPER_PLATFORM as NonNullable<HelperPlatform>,
			binaryPath: () => HELPER_PATH as string,
		});
	});

	/**
	 * The exact LIVE-failing command from the ACT.
	 *
	 * POST-CORRECTION01 expected: ALLOW + risk_v2_structured_promotion.
	 * POST-CORRECTION02 CONTAINMENT (current): ASK (the V2 parsed-argv
	 *   ALLOW branch was removed; the simple compound no longer
	 *   auto-promotes). The chain will become ALLOW again once
	 *   parser-proven shellStatic provenance lands (CORRECTION02 proper).
	 */
	it("echo '---BRANCH---' && git status --short -> ALLOW (parser-proven + V1 git_status, real-helper driven)", async () => {
		const liveCmd = "echo '---BRANCH---' && git status --short";
		const parsed = await helper.invoke({ command: liveCmd });
		expect(parsed).not.toBeNull();
		expect(parsed!.parseStatus).toBe("complete");
		// Phase 3: vendored helper is v3 with argProvenance.
		expect(parsed!.protocolVersion).toBe(4); // STDERR-DEVNULL-NEUTRAL01: helper now emits v4

		const r = evaluateCommandRiskWithParser({
			toolInput: liveCmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		// Phase 2/3 GREEN: parser-proven static provenance on the
		// echo leaf + V1 host_safe_git_status allowlist on the git
		// leaf -> ALLOW via risk_v2_structured_promotion.
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	/**
	 * The exact five-leaf chain that started this ACT. Drives the
	 * real parser, then exercises the full V2 pipeline.
	 *
	 * POST-CORRECTION01 expected: ALLOW + risk_v2_structured_promotion.
	 * POST-CORRECTION02 CONTAINMENT (current): ASK. The chain will
	 *   become ALLOW again once parser-proven shellStatic provenance
	 *   lands (ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01 +
	 *   CORRECTION02 proper).
	 */
	it("user's exact 5-leaf && chain -> ALLOW (parser-proven + V1 git_*, real-helper driven)", async () => {
		const liveCmd =
			"git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v";
		const parsed = await helper.invoke({ command: liveCmd });
		expect(parsed).not.toBeNull();
		expect(parsed!.parseStatus).toBe("complete");
		// Phase 3: vendored helper is v3 with argProvenance.
		expect(parsed!.protocolVersion).toBe(4); // STDERR-DEVNULL-NEUTRAL01: helper now emits v4

		const r = evaluateCommandRiskWithParser({
			toolInput: liveCmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		// Phase 2/3 GREEN: all 5 leaves are parser-proven static
		// (single-quoted literal data) AND in V1 host_safe_git_* ->
		// ALLOW via risk_v2_structured_promotion.
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	/**
	 * Mixed-risk conservation. Same chain shape but with a mutating
	 * leaf (`git branch -D`). Even with the echo leaf now
	 * auto-approve eligible, the mutating leaf MUST keep the
	 * aggregate at ASK. Load-bearing adversarial control.
	 */
	it("echo '---BRANCH---' && git branch -D __CLINEMM_SENTINEL__ -> ASK (mutating leaf blocks)", async () => {
		const liveCmd = "echo '---BRANCH---' && git branch -D __CLINEMM_SENTINEL__";
		const parsed = await helper.invoke({ command: liveCmd });
		expect(parsed).not.toBeNull();
		expect(parsed!.parseStatus).toBe("complete");

		const r = evaluateCommandRiskWithParser({
			toolInput: liveCmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	/**
	 * Adversarial: a TRULY DANGEROUS echo with command substitution
	 * inside double quotes. The parser detects the substitution,
	 * V2 reports hasCommandSubstitution=true, V2 stays conservative,
	 * V1's ASK verdict survives. Proves the echo relaxation does
	 * not bleed into opaque-construct territory.
	 */
	it('echo "$(rm -rf foo)" -> ASK (V2 conservative on command substitution)', async () => {
		const liveCmd = 'echo "$(rm -rf foo)"';
		const parsed = await helper.invoke({ command: liveCmd });
		expect(parsed).not.toBeNull();
		expect(parsed!.hasCommandSubstitution).toBe(true);

		const r = evaluateCommandRiskWithParser({
			toolInput: liveCmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	/**
	 * Adversarial: literal `echo $HOME`. Parser produces
	 * `args = ["$HOME"]` (no substitution -- the parser sees the
	 * variable reference and reports hasCommandSubstitution may
	 * not be set, but the value contains `$`). The structured
	 * classifier MUST NOT promote because the literal `$` prefix
	 * triggers the structural gate. Proves argv-semantic echo
	 * does not bless arbitrary literal values.
	 */
	it("echo $HOME -> ASK (literal $-prefixed arg is not echo-safe)", async () => {
		const liveCmd = "echo $HOME";
		const parsed = await helper.invoke({ command: liveCmd });
		expect(parsed).not.toBeNull();
		expect(parsed!.parseStatus).toBe("complete");

		const r = evaluateCommandRiskWithParser({
			toolInput: liveCmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});
});
