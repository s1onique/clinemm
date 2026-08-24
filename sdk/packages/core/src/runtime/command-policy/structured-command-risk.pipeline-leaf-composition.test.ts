/**
 * Structured Command Risk -- Pipeline-Leaf Composition RED/GREEN
 *
 * ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01
 *
 * Evidence classification:
 *   Section A (real-binary):   REAL_PRODUCTION_SEAM
 *   Section B (synthetic-TS):  SYNTHETIC_REAL / STRUCTURAL
 *
 * Scope: BOUNDED, pathless stdin-only reader extensions to the V2
 * parser-proven allowlist (echo -> echo + head + tail stdin-only).
 *
 * PRE-CORRECTION C1 SCOPE (rejected by reviewer with P0
 * `HALT_PATH_AUTHORITY_PROMOTION_GAP`):
 *   - `head FILE`, `cat FILE`, `tail FILE`, etc. via V2-only
 *     parser-proven promotion. Reviewer correction: static shell
 *     syntax != filesystem authority. Path-bearing readers require
 *     the canonical R0 path-authority integration (separate ACT,
 *     blocked from this one).
 *
 * POST-CORRECTION C1 SCOPE (this ACT):
 *   - `head`, `head -30`, `head -n 30`, `head -c 100`, `head --`,
 *     `head -n 30 --`              (stdin-only, zero path operands)
 *   - `tail`, `tail -20`, `tail -n 20` (stdin-only, zero path operands)
 *   - Conservation: every path-bearing form must remain ASK.
 *   - Conservation: every dynamic-arg form must remain ASK.
 *   - Conservation: every unknown-option form must remain ASK.
 *   - Conservation: every redirect-bearing form must remain ASK.
 *   - Composition: pipes (`echo | head`), chains (`pwd && head`),
 *     where every leaf is parser-proven safe, must aggregate ALLOW.
 *
 * Reviewer-mandated semantic correction recorded at
 * `.factory/evidence/.../c1-plan.md`:
 *
 *   PARSER_PROVENANCE_FALSE_NEGATIVES:
 *     HEAD~1           (Git revision syntax, not bash tilde expansion)
 *     HEAD@{upstream}  (Git revision syntax, not bash brace expansion)
 *   SAFETY_DELTA:    none
 *   PRECISION_DELTA: some valid Git revision expressions cannot yet
 *                    be promoted
 *
 * The `git log` positional-ref and the `~` / `{...}` shell-static
 * classification precision issues are DEFERRED to a separate ACT.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { arch as processArch, platform as processPlatform } from "node:process";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { commandHostAuthorization } from "./command-policy-types";
import {
	evaluateCommandRiskWithParser,
	joinRunCommandsForParse,
} from "./command-risk-internal";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import { MvdanShHelper } from "./parser-helper/runtime";
import type {
	ParsedShell,
	StructuredCmd,
	StructuredStmt,
} from "./structured-command-risk";
import { sha256Hex } from "./structured-command-risk";

/**
 * Build a synthetic ParsedShell whose single stmt is a cmd with the
 * given name, args, argProvenance, and redirects. Mirrors the v4 wire
 * shape (per-arg argProvenance + per-redirect fd/pathProvenance).
 *
 * Used by Section B (synthetic-TS) tests so the classifier's
 * promotion logic can be exercised independently of the real Go
 * helper. The sourceSha256 is computed from the joined normalized
 * tool input so the load-bearing CORRECTION01 source-binding gate
 * stays green.
 */
function mkReaderShell(
	toolInput: string,
	name: string,
	args: ReadonlyArray<string>,
	argProvenance: ReadonlyArray<"static" | "dynamic" | "unknown">,
	redirects: ReadonlyArray<{
		op: string;
		path: string;
		fd: number | null;
		pathProvenance: "static" | "dynamic" | "unknown";
	}> = [],
	protocolVersion: 2 | 3 | 4 = 4,
): ParsedShell {
	const cmd: StructuredCmd = {
		name,
		args,
		argProvenance,
		assigns: [],
		redirects: redirects.map((r) => ({
			op: r.op,
			path: r.path,
			fd: r.fd,
			pathProvenance: r.pathProvenance,
		})),
		isWrapper: false,
		wrapperOf: "",
		inner: "",
	};
	const stmt: StructuredStmt = { kind: "cmd", cmd };
	const { joined } = joinRunCommandsForParse(toolInput);
	return {
		protocolVersion,
		dialect: "bash",
		sourceSha256: sha256Hex(joined),
		parseStatus: "complete",
		hasCommandSubstitution: false,
		program: { stmts: [stmt] },
		errors: [],
	};
}

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

const SUPPORTED_HELPER_PLATFORMS: ReadonlySet<NonNullable<HelperPlatform>> = new Set([
	"darwin-arm64",
	"darwin-amd64",
	"linux-amd64",
	"linux-arm64",
	"win32-x64",
]);
const isSupportedHelperPlatform =
	HELPER_PLATFORM !== null && SUPPORTED_HELPER_PLATFORMS.has(HELPER_PLATFORM);
const describeWithHelper = (isSupportedHelperPlatform ? describe : describe.skip) as typeof describe;

const SAFE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});

/* ---------------------------------------------------------------------- *
 * Section A: real parser helper RED/GREEN                                *
 * ---------------------------------------------------------------------- *
 *
 * Drives `MvdanShHelper.invoke(...) -> evaluateCommandRiskWithParser(...)`
 * against the actual vendored v4 binary. Section A is the
 * load-bearing REAL_PRODUCTION_SEAM proof.
 *
 * Until C3 (this ACT's implementation phase) lands the bounded
 * stdin-only reader extension, Section A is RED: stdin-only `head -30`
 * is ASK. Once C3 lands, Section A is GREEN.
 */

describeWithHelper("structured-command-risk -- REAL parser-helper pipeline-leaf composition RED/GREEN", () => {
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

	// -- A: stdin-only reader positives (the ACT's IN-scope) --

	it("RED->GREEN: `head -30` (stdin-only) -> ALLOW", async () => {
		const cmd = "head -30";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// POST-REPAIR: ALLOW + auto-approve-eligible.
		// PRE-REPAIR: ASK (no V1 rule).
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("RED->GREEN: `head` (no args, stdin-only) -> ALLOW", async () => {
		const cmd = "head";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("RED->GREEN: `head -n 30` (stdin-only) -> ALLOW", async () => {
		const cmd = "head -n 30";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("RED->GREEN: `head --` (stdin-only, explicit end-of-options) -> ALLOW", async () => {
		const cmd = "head --";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("RED->GREEN: `head -n 30 --` (stdin-only with end-of-options) -> ALLOW", async () => {
		const cmd = "head -n 30 --";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("RED->GREEN: `tail -20` (stdin-only) -> ALLOW", async () => {
		const cmd = "tail -20";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("RED->GREEN: `tail -n 20` (stdin-only) -> ALLOW", async () => {
		const cmd = "tail -n 20";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	// -- B: path-bearing negatives (conservation) --

	it("CONSERVATION: `head some-file` (path-bearing) stays ASK", async () => {
		const cmd = "head some-file";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// PRE/POST: ASK. Reviewer P0: argProvenance=static does not
		// satisfy filesystem authority.
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("CONSERVATION: `head -30 some-file` (path-bearing) stays ASK", async () => {
		const cmd = "head -30 some-file";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("CONSERVATION: `head -n 30 some-file other-file` (multi-path) stays ASK", async () => {
		const cmd = "head -n 30 some-file other-file";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("CONSERVATION: `cat some-file` (path-bearing) stays ASK", async () => {
		const cmd = "cat some-file";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
	});

	it("CONSERVATION: `tail -20 some-file` (path-bearing) stays ASK", async () => {
		const cmd = "tail -20 some-file";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
	});

	// -- C: dynamic-arg negatives --

	it("CONSERVATION: `head $(cmd)` (command-substitution arg) stays ASK", async () => {
		const cmd = "head $(echo some-file)";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// hasCommandSubstitution=true is opaque to V2 (existing
		// behavior); remains ASK.
		expect(r.decision).toBe("ask");
	});

	it("CONSERVATION: `head \"$HOME\"` (param-expansion arg) stays ASK", async () => {
		const cmd = "head \"$HOME\"";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
	});

	it("CONSERVATION: `head ${HOME}/file` (brace-expansion arg) stays ASK", async () => {
		const cmd = "head ${HOME}/file";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
	});

	// -- D: unknown-option negatives (argv-shape) --

	it("CONSERVATION: `head --help` stays ASK (option not reviewed)", async () => {
		const cmd = "head --help";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
	});

	it("CONSERVATION: `head --version` stays ASK (option not reviewed)", async () => {
		const cmd = "head --version";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
	});

	it("CONSERVATION: `head -c 100` stays ASK (-c not in stdin-only profile)", async () => {
		const cmd = "head -c 100";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// -c reads BYTES (binary content). Even with all-static args,
		// this is out of the reviewed stdin-only profile. Stays ASK.
		expect(r.decision).toBe("ask");
	});

	// -- E: redirect negative --

	it("CONSERVATION: `head -30 > /tmp/x` stays ASK (redirected write)", async () => {
		const cmd = "head -30 > /tmp/x";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// The parser-proven promotion requires zero redirects (echo's
		// invariant applies uniformly). A redirected-write head
		// stays ASK.
		expect(r.decision).toBe("ask");
	});

	// -- F: pipe composition --

	it("RED->GREEN: `echo hello | head -30` -> ALLOW", async () => {
		const cmd = "echo hello | head -30";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// POST-REPAIR: ALLOW. PRE-REPAIR: ASK (head not safe).
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("RED->GREEN: `pwd && head -30` -> ALLOW (chain composition)", async () => {
		const cmd = "pwd && head -30";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// Both leaves must be parser-proven safe (or already V1-safe):
		// pwd -> V1 host_safe_pwd; head -30 -> V2 parser-proven stdin-only.
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("RED->GREEN: `pwd && git status && head -30` -> ALLOW", async () => {
		const cmd = "pwd && git status && head -30";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("CONSERVATION: `pwd && head -30 && git branch -D sentinel` stays ASK (R5 sibling)", async () => {
		const cmd = "pwd && head -30 && git branch -D sentinel";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// `git branch -D sentinel` is R5 (delete branch, never-auto-approve).
		// Aggregate composition must propagate ASK.
		expect(r.decision).toBe("ask");
	});

	it("CONSERVATION: `head -30 | sh` stays ASK (dangerous-sink pipe)", async () => {
		const cmd = "head -30 | sh";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// Dangerous-sink boundary is OUT OF SCOPE; must remain ASK.
		expect(r.decision).toBe("ask");
	});

	it("CONSERVATION: `ls .factory/ 2>/dev/null | head -30` ALLOWs here (no path evidence in harness) but stays ASK under real host path authority", async () => {
		const cmd = "ls .factory/ 2>/dev/null | head -30";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// NOTE: this test harness does NOT supply
		// `pathAuthorityEvidence`. V1's path-authority gate is
		// therefore not exercised. V2's view:
		//   - `ls -la .factory/` matches V1 host_safe_ls (no V1 ASK)
		//   - `2>/dev/null` is authority-neutral (CORRECTION01)
		//   - `head -30` is parser-proven stdin-only (this ACT)
		//   - pipe aggregation = max(auto-approve, auto-approve)
		//                   = auto-approve-eligible
		// So V2 promotes to ALLOW.
		//
		// In production with REAL host path evidence for
		// `.factory/`, the V1 path-authority gate would ASK this
		// pipe (because ls requires realpath evidence to ALLOW).
		// That conservation is enforced by the V1 path-authority
		// machinery and is OUT OF SCOPE for this ACT (per reviewer
		// P0 correction). We document this here so future readers
		// don't conflate "the harness says ALLOW" with "production
		// says ALLOW".
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	// -- G: existing V1-safe shapes must remain conservation ALLOW --

	it("CONSERVATION: `pwd` -> ALLOW (V1 host_safe_pwd, unchanged)", async () => {
		const cmd = "pwd";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
	});

	it("CONSERVATION: `git status` -> ALLOW (V1 host_safe_git_status, unchanged)", async () => {
		const cmd = "git status";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
	});

	it("CONSERVATION: `git log --oneline -5` -> ALLOW (existing V1 host_safe_git_log)", async () => {
		const cmd = "git log --oneline -5";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
	});

	it("CONSERVATION: `git log --oneline -5 origin/main` stays ASK (positional ref deferred)", async () => {
		const cmd = "git log --oneline -5 origin/main";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// Per reviewer correction: positional-ref git-log promotion
		// is deferred to a separate ACT. The argv shape with
		// positional ref is NOT in the reviewed V1 host_safe_git_log
		// allowlist and the parser-proven promotion is also deferred.
		expect(r.decision).toBe("ask");
	});
});

/* ---------------------------------------------------------------------- *
 * Section B: synthetic structured-TS fixtures                              *
 * ---------------------------------------------------------------------- *
 *
 * Drives the classifier with hand-built ParsedShell payloads (no helper)
 * so the parser-proven promotion contract is verified independently of
 * the real Go helper's output. This catches helper-output regressions
 * that would otherwise slip through.
 */

describe("structured-command-risk -- SYNTHETIC_REAL stdin-only reader fixture contract", () => {
	it("ALLOW: `head -30` synthetic with protocolVersion=4 + argProvenance=static", () => {
		const cmd = "head -30";
		const parsed = mkReaderShell(cmd, "head", ["-30"], ["static"]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("ALLOW: `head -n 30` synthetic", () => {
		const cmd = "head -n 30";
		const parsed = mkReaderShell(cmd, "head", ["-n", "30"], ["static", "static"]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("ALLOW: `tail -20` synthetic", () => {
		const cmd = "tail -20";
		const parsed = mkReaderShell(cmd, "tail", ["-20"], ["static"]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("ASK: `head some-file` synthetic (path-bearing remains ASK)", () => {
		const cmd = "head some-file";
		const parsed = mkReaderShell(cmd, "head", ["some-file"], ["static"]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("ASK: `head --help` synthetic (argv-shape reject)", () => {
		const cmd = "head --help";
		const parsed = mkReaderShell(cmd, "head", ["--help"], ["static"]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		// Args are static, but --help is not in the reviewed
		// stdin-only option profile. Stays ASK.
		expect(r.decision).toBe("ask");
	});

	it("ASK: `head -c 100` synthetic (argv-shape reject)", () => {
		const cmd = "head -c 100";
		const parsed = mkReaderShell(cmd, "head", ["-c", "100"], ["static", "static"]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("ASK: `head $(cmd)` synthetic (dynamic arg)", () => {
		const cmd = "head $(echo some-file)";
		const parsed = mkReaderShell(
			cmd,
			"head",
			["$(...)"],
			["dynamic"],
		);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("ASK: `head \"$HOME\"` synthetic (param-expansion dynamic)", () => {
		const cmd = "head \"$HOME\"";
		const parsed = mkReaderShell(
			cmd,
			"head",
			["${...}"],
			["dynamic"],
		);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("ASK: `head -30 > /tmp/x` synthetic (redirect present)", () => {
		const cmd = "head -30 > /tmp/x";
		const parsed = mkReaderShell(
			cmd,
			"head",
			["-30"],
			["static"],
			[{ op: ">", path: "/tmp/x", fd: null, pathProvenance: "static" }],
		);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		// parser-proven requires zero redirects; redirected-write
		// stays ASK.
		expect(r.decision).toBe("ask");
	});

	it("CONSERVATION: `echo hello` synthetic stays ALLOW (existing echo branch unchanged)", () => {
		const cmd = "echo hello";
		const parsed = mkReaderShell(cmd, "echo", ["hello"], ["static"]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		// The existing echo parser-proven branch must continue to
		// fire after C3.
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	// -- protocolVersion gates --

	it("ASK: `head -30` synthetic with protocolVersion=2 stays ASK (v2 injects [unknown])", () => {
		const cmd = "head -30";
		const parsed = mkReaderShell(cmd, "head", ["-30"], ["unknown"], [], 2);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		// v2 injects [unknown] provenance; the parser-proven branch
		// must NOT activate.
		expect(r.decision).toBe("ask");
	});

	it("ALLOW: `head -30` synthetic with protocolVersion=4 -> ALLOW (v4 is current)", () => {
		// After CORRECTION01's v3->v4 protocol bump (parent ACT),
		// v3 is now legacy (no longer accepted by the structured
		// classifier's protocol version gate at line ~578). Only v4
		// (current) and v2 (legacy, fail-closed via unknown
		// injection) are accepted.
		const cmd = "head -30";
		const parsed = mkReaderShell(cmd, "head", ["-30"], ["static"], [], 4);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("ASK: `head -30` synthetic with protocolVersion=3 stays ASK (v3 is now legacy post-CORRECTION01)", () => {
		// v3 is no longer accepted after the CORRECTION01 v3->v4
		// bump; the structured classifier returns "skipped" which
		// preserves V1 behavior (ASK).
		const cmd = "head -30";
		const parsed = mkReaderShell(cmd, "head", ["-30"], ["static"], [], 3);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});
});
