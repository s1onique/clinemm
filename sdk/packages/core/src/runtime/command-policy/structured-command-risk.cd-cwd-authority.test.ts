/**
 * Structured Command Risk -- `cd && ...` cwd authority RED/GREEN
 *
 * ACT-CLINEMM-COMMAND-RISK-V2-CD-CWD-PATH-AUTHORITY-COMPOSITION01
 *
 * Evidence classification: REAL_PRODUCTION_SEAM.
 *
 * This file is the focused test surface for the new LIVE-isolated
 * defect:
 *
 *   cd /Volumes/UserData/.../sdk/packages/core && pwd
 *
 * The same command WITHOUT `cd` is LIVE-green via the
 * ACT-CLINEMM-COMMAND-RISK-V2-QUOTED-PATTERN-PROVENANCE01 + the
 * existing R0 path-authority stack. The ONLY thing `cd && ...`
 * adds is a bounded shell-state transition (`cd` updates the
 * shell's PWD; only `&&` RHS runs after a successful cd).
 *
 * INVARIANTS PUSHED BY THIS FILE:
 *
 *   RED-A (cd itself): today `cd /abs && pwd` is ASK
 *     (cd is not in DEFAULT_COMMAND_HOST_ALLOW_RULES, and the
 *      V2 dispatcher hardcodes `cd-not-auto-approve-eligible`).
 *
 *   RED-B (downstream cwd transition): today `cd /abs && find .`
 *     is ASK; the new ACT must additionally bind the RHS relative
 *     operand `.` to the post-cd realpath so downstream path
 *     authority resolves against the EFFECTIVE cwd, not the
 *     initial host cwd.
 *
 * The two REDs are deliberately separate: RED-A is the positive
 * safe-rule admission; RED-B is the sequential cwd-propagation.
 * A trivial positive `cd` rule alone closes RED-A but NOT RED-B.
 *
 * EVALUATION DISCIPLINE:
 *
 *   - All tests drive the REAL vendored v4 parser-helper binary
 *     via `MvdanShHelper.invoke(...)`.
 *   - The host-evidence side uses the REAL
 *     `buildPathAuthorityEvidence(...)` builder (the same seam the
 *     VSCode `SdkController` calls).
 *   - The evaluator is `evaluateCommandRiskWithParser(...)` (the
 *     trusted-internal production entry point).
 *   - The temp filesystem fixture (project root + sentinel files)
 *     is built via `mkdtempSync`/`realpathSync`, mirroring the
 *     CORRECTION01/04 realpath test pattern.
 *
 * CONSERVATION CARRIED OVER (these tests MUST still hold after
 * C2):
 *
 *   - R5 hard floor: `cd /abs && rm -rf "$HOME"` remains
 *     `never-auto-approve`.
 *   - Dynamic / external / out-of-grammar cd targets remain ASK.
 *   - `||` and `;` cwd propagation remain ASK (Wave 1).
 *   - All previously-frozen R0 rules keep their ALLOW verdicts.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { arch as processArch, platform as processPlatform } from "node:process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { commandHostAuthorization } from "./command-policy-types";
import { evaluateCommandRiskWithParser } from "./command-risk-internal";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import { MvdanShHelper } from "./parser-helper/runtime";
import type { ParsedShell } from "./structured-command-risk";
import { buildPathAuthorityEvidence } from "./path-authority-evidence-builder";

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
	if (p === "win32" && a === "x64") return "win32-x64";
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
	isSupportedHelperPlatform ? describe : describe.skip
) as typeof describe;

if (!HELPER_PATH && isSupportedHelperPlatform) {
	// eslint-disable-next-line no-console
	console.error(
		`[cd-cwd-authority] supported platform ${HELPER_PLATFORM} but vendored helper binary is missing at ${sdkRoot}/bin/parser-helper/${HELPER_PLATFORM}/. Failing the suite.`,
	);
}

const SAFE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});
// SAFE is reserved for any test that wants the bare authorization
// without host-path-evidence context. Today every section uses
// `evaluateWithRealpathEvidence(...)` so SAFE is intentionally
// unused at the moment -- kept here so future tests can opt into
// the simpler shape.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
void SAFE;

// =====================================================================
// Fixture: realpath-anchored tmp project tree.
// =====================================================================
//
// Layout (canonical realpaths throughout):
//
//   TMP_ROOT/
//     project/
//       marker-at-root.test.ts        <- sentinel A
//       sdk/
//         packages/
//           core/
//             marker-in-core.test.ts  <- sentinel B
//             subdir/
//               marker-in-subdir.test.ts <- sentinel C
//             outside-link -> ../../outside   <- symlink escape
//       outside/                      <- symlink target (NOT in project)
//         escape.ts
//
// After `realpathSync`, the canonical PROJECT_ROOT, CORE_DIR, and
// SUBDIR_DIR are passed into `buildPathAuthorityEvidence` exactly
// the way `SdkController` passes them. This is the
// REAL_PRODUCTION_SEAM classification: the host side of path
// authority uses the SDK's canonical builder.

let TMP_ROOT: string;
let PROJECT_ROOT: string;
let CORE_DIR: string;
let SUBDIR_DIR: string;
let OUTSIDE_DIR: string;
let SYMLINK_PATH: string;

beforeAll(() => {
	TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-cd-cwd-"));
	PROJECT_ROOT = join(TMP_ROOT, "project");
	const core = join(PROJECT_ROOT, "sdk", "packages", "core");
	const subdir = join(core, "subdir");
	const outside = join(TMP_ROOT, "outside");
	mkdirSync(subdir, { recursive: true });
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(PROJECT_ROOT, "marker-at-root.test.ts"), "// root\n");
	writeFileSync(join(core, "marker-in-core.test.ts"), "// core\n");
	writeFileSync(join(subdir, "marker-in-subdir.test.ts"), "// subdir\n");
	writeFileSync(join(outside, "escape.ts"), "// escape\n");
	SYMLINK_PATH = join(core, "outside-link");
	// eslint-disable-next-line no-sync
	require("node:fs").symlinkSync(
		join(TMP_ROOT, "outside"),
		SYMLINK_PATH,
		"dir",
	);
	PROJECT_ROOT = realpathSync(PROJECT_ROOT);
	CORE_DIR = realpathSync(core);
	SUBDIR_DIR = realpathSync(subdir);
	OUTSIDE_DIR = realpathSync(outside);
});

afterAll(() => {
	if (TMP_ROOT && existsSync(TMP_ROOT)) {
		rmSync(TMP_ROOT, { recursive: true, force: true });
	}
});

function evaluateWithRealpathEvidence(
	command: string,
	options: {
		workspaceRoots?: ReadonlyArray<string>;
		cwd?: string;
	} = {},
) {
	const roots = options.workspaceRoots ?? [PROJECT_ROOT];
	const cwd = options.cwd ?? PROJECT_ROOT;
	const result = buildPathAuthorityEvidence({
		workspaceRoots: roots,
		cwd,
		command: { command },
	});
	if (!result.ok) {
		throw new Error(
			`buildPathAuthorityEvidence failed: ${(result as { reason: string }).reason}`,
		);
	}
	const evidence = result.evidence;
	return commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: roots,
		cwd,
		pathAuthorityEvidence: evidence,
	});
}

// =====================================================================
// A. Parser probe (REAL) -- Section 7 of the ACT
// =====================================================================

describeWithHelper("ACT-...CD-CWD... A. parser probe (real helper)", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
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

	it("protocol version is v4", async () => {
		const r = await helper.invoke({ command: "cd /tmp && pwd" });
		expect(r).not.toBeNull();
		expect(r!.protocolVersion).toBe(4);
	});

	it("absolute cd target: name=cd, args=[/abs], argProvenance=static", async () => {
		const r = await helper.invoke({ command: `cd ${CORE_DIR} && pwd` });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
		const stmt = r!.program!.stmts[0]!;
		expect(stmt.kind).toBe("and");
		if (stmt.kind !== "and") return;
		expect(stmt.left.kind).toBe("cmd");
		if (stmt.left.kind !== "cmd") return;
		expect(stmt.left.cmd.name).toBe("cd");
		expect(stmt.left.cmd.args).toEqual([CORE_DIR]);
		expect(stmt.left.cmd.argProvenance).toEqual(["static"]);
	});

	it("dynamic cd target via $VAR: argProvenance=dynamic", async () => {
		const r = await helper.invoke({ command: 'cd "$DIR" && pwd' });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
		const stmt = r!.program!.stmts[0]!;
		expect(stmt.kind).toBe("and");
		if (stmt.kind !== "and") return;
		expect(stmt.left.kind).toBe("cmd");
		if (stmt.left.kind !== "cmd") return;
		expect(stmt.left.cmd.name).toBe("cd");
		expect(stmt.left.cmd.argProvenance).toEqual(["dynamic"]);
	});

	it("tilde cd target: argProvenance=dynamic", async () => {
		const r = await helper.invoke({ command: "cd ~/project && pwd" });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
		const stmt = r!.program!.stmts[0]!;
		expect(stmt.kind).toBe("and");
		if (stmt.kind !== "and") return;
		expect(stmt.left.kind).toBe("cmd");
		if (stmt.left.kind !== "cmd") return;
		expect(stmt.left.cmd.argProvenance).toEqual(["dynamic"]);
	});

	it("relative cd target: argProvenance=static (excluded by ACT grammar)", async () => {
		const r = await helper.invoke({ command: "cd ../other && pwd" });
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
		const stmt = r!.program!.stmts[0]!;
		expect(stmt.kind).toBe("and");
		if (stmt.kind !== "and") return;
		expect(stmt.left.kind).toBe("cmd");
		if (stmt.left.kind !== "cmd") return;
		expect(stmt.left.cmd.argProvenance).toEqual(["static"]);
	});

	it("find . RHS after cd: AND with cd(static,abs) on left, find(static,...) on right", async () => {
		const r = await helper.invoke({
			command: `cd ${CORE_DIR} && find . -name "*.test.ts"`,
		});
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
		const stmt = r!.program!.stmts[0]!;
		expect(stmt.kind).toBe("and");
		if (stmt.kind !== "and") return;
		expect(stmt.left.kind).toBe("cmd");
		expect(stmt.rhs.kind).toBe("cmd");
		if (stmt.left.kind !== "cmd" || stmt.rhs.kind !== "cmd") return;
		expect(stmt.left.cmd.name).toBe("cd");
		expect(stmt.rhs.cmd.name).toBe("find");
		expect(stmt.rhs.cmd.args[0]).toBe(".");
		expect(stmt.rhs.cmd.argProvenance![0]).toBe("static");
	});

	it("find . | head -20 RHS after cd: AND whose RHS is PIPE(find|head)", async () => {
		const r = await helper.invoke({
			command: `cd ${CORE_DIR} && find . -name "*.test.ts" | head -20`,
		});
		expect(r).not.toBeNull();
		expect(r!.parseStatus).toBe("complete");
		const stmt = r!.program!.stmts[0]!;
		expect(stmt.kind).toBe("and");
		if (stmt.kind !== "and") return;
		expect(stmt.left.cmd?.name).toBe("cd");
		expect(stmt.rhs.kind).toBe("pipe");
	});
});

// =====================================================================
// B. RED reproduction (real helper, real evidence) -- today
// =====================================================================

describeWithHelper("ACT-...CD-CWD... B. RED reproduction (today)", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
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

	it("RED-A: cd <inside> && pwd -> ASK today (no positive cd rule)", async () => {
		const cmd = `cd ${CORE_DIR} && pwd`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		// TODAY: ASK. After C2 production repair: ALLOW.
		expect(r.decision).toBe("ask");
		expect(r.disposition).toBe("ask");
	});

	it("RED-B: cd <inside> && find . -name '*.test.ts' -> ASK today (no cwd propagation)", async () => {
		const cmd = `cd ${CORE_DIR} && find . -name "*.test.ts"`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		// TODAY: ASK. After C2 production repair: ALLOW.
		expect(r.decision).toBe("ask");
		expect(r.disposition).toBe("ask");
	});

	it("RED-B-pipe: cd <inside> && find . | head -20 -> ASK today", async () => {
		const cmd = `cd ${CORE_DIR} && find . -name "*.test.ts" | head -20`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		// TODAY: ASK. After C2 production repair: ALLOW.
		expect(r.decision).toBe("ask");
		expect(r.disposition).toBe("ask");
	});
});

// =====================================================================
// C. Positive `cd` authority (GREEN after C2)
// =====================================================================

describeWithHelper("ACT-...CD-CWD... C. positive cd authority (GREEN after C2)", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
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

	it("cd <inside> && pwd -> ALLOW (parser-proven static + host realpath bound)", async () => {
		const cmd = `cd ${CORE_DIR} && pwd`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("cd <inside> && git status -> ALLOW (R0 git_observational on RHS)", async () => {
		const cmd = `cd ${CORE_DIR} && git status`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});
});

// =====================================================================
// D. Post-cd cwd propagation (GREEN after C2) -- the load-bearing path
// =====================================================================

describeWithHelper("ACT-...CD-CWD... D. post-cd cwd propagation (GREEN after C2)", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
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

	it("cd <inside>/subdir && find . -name '*.test.ts' -> ALLOW (find binds . to post-cd realpath)", async () => {
		const cmd = `cd ${SUBDIR_DIR} && find . -name "*.test.ts"`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("cd <inside>/subdir && cat ../../outside-link -> ASK (symlink escape after cd)", async () => {
		const cmd = `cd ${SUBDIR_DIR} && cat ../../outside-link/escape.ts`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("ask");
	});
});

// =====================================================================
// E. && / || / ; conservation (Wave 1: only && propagates)
// =====================================================================

describeWithHelper("ACT-...CD-CWD... E. shell-listener conservation (Wave 1)", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
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

	it("cd <inside> || find . -> ASK (|| RHS runs on cd FAILURE -- old cwd)", async () => {
		const cmd = `cd ${CORE_DIR} || find . -name "*.test.ts"`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("ask");
	});

	it("cd <inside> ; find . -> ASK (semicolon is out of Wave 1 grammar)", async () => {
		const cmd = `cd ${CORE_DIR} ; find . -name "*.test.ts"`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("ask");
	});
});

// =====================================================================
// F. Dangerous siblings / R5 conservation
// =====================================================================

describeWithHelper("ACT-...CD-CWD... F. dangerous siblings / R5", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
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

	it("cd <inside> && git branch -D __SENTINEL__ -> ASK (R5 sibling)", async () => {
		const cmd = `cd ${CORE_DIR} && git branch -D __CLINEMM_SENTINEL__`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("cd <inside> && rm -rf \"$HOME\" -> never-auto-approve (R5 hard floor)", async () => {
		const cmd = `cd ${CORE_DIR} && rm -rf "$HOME"`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).toBe("never-auto-approve");
	});
});

// =====================================================================
// G. Out-of-grammar / dynamic cd targets -> ASK
// =====================================================================

describeWithHelper("ACT-...CD-CWD... G. dynamic / out-of-grammar cd", () => {
	let helper: MvdanShHelper;

	beforeAll(() => {
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

	it("cd \"$DIR\" && pwd -> ASK (dynamic target)", async () => {
		const cmd = `cd "$DIR" && pwd`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("ask");
	});

	it("cd ~/project && pwd -> ASK (tilde / dynamic)", async () => {
		const cmd = `cd ~/project && pwd`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("ask");
	});

	it("cd <outside> && pwd -> ASK (host evidence fails containment)", async () => {
		const cmd = `cd /tmp && pwd`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("ask");
	});

	it("cd <nonexistent> && pwd -> ASK (host evidence realpath-failed-enoent)", async () => {
		const cmd = `cd /nonexistent-cline-cwd-path-authority && pwd`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("ask");
	});

	it("cd <regular-file-not-dir> && pwd -> ASK (host evidence not-a-directory)", async () => {
		const cmd = `cd ${join(CORE_DIR, "marker-in-core.test.ts")} && pwd`;
		const parsed = await helper.invoke({ command: cmd });
		expect(parsed).not.toBeNull();
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evaluateWithRealpathEvidence(cmd),
			parserResult: parsed as ParsedShell,
		});
		expect(r.decision).toBe("ask");
	});
});
