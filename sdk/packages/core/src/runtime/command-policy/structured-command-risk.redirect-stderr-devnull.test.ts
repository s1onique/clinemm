/**
 * Structured Command Risk -- Neutral `2>/dev/null` Redirect RED/GREEN
 *
 * ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01
 *
 * Evidence classification:
 *   Section A (real-binary):   REAL_PRODUCTION_SEAM
 *   Section B (synthetic-TS):  SYNTHETIC_REAL / STRUCTURAL
 *
 * Frozen LIVE discriminator (reproduced in installed extension):
 *
 *     ls -la .factory/evidence/                -> AUTO-RUN
 *     ls -la .factory/evidence/ 2>/dev/null    -> ASK                <-- defect
 *
 * The structured classifier treats any write redirect as ASK-minimum,
 * without distinguishing `2>/dev/null` from `2>errors.txt`. The narrow
 * authority-neutral stderr-discard contract is:
 *
 *     AUTHORITY_NEUTRAL_STDERR_DISCARD iff
 *       redirect.fd === 2
 *       AND redirect.op === ">"
 *       AND redirect.path === "/dev/null"
 *       AND redirect.pathProvenance === "static"
 *
 * If those four preconditions hold, the redirect MUST be ignored for
 * authority purposes (`ls ... 2>/dev/null` -> risk of `ls ...`).
 *
 * All other redirect shapes (`>/dev/null`, `1>/dev/null`, `2>>/dev/null`,
 * `2>errors.txt`, `2>"$NULL_PATH"`, `2>&1`, ...) MUST remain
 * conservative. R5 hard-floor (`rm -rf $HOME 2>/dev/null`) MUST stay
 * never-auto-approve. Mixed-risk compositions (`git status 2>/dev/null &&
 * git branch -D foo`) MUST stay ASK.
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
 * Build a ParsedShell whose single stmt is a cmd with the given name,
 * args, and redirects. Mirrors the v4 wire shape (fd + pathProvenance
 * fields present on every redirect). The helper also synthesizes an
 * `argProvenance: ["static"]` row per arg so the structured
 * classifier's v3-only branches see a consistent v4 payload.
 *
 * Returns a ParsedShell whose `sourceSha256` matches the SHA-256 of
 * `joinRunCommandsForParse(toolInput).joined` -- the load-bearing
 * CORRECTION01 source-binding gate stays green.
 */
function mkRedirectShell(
	toolInput: string,
	name: string,
	args: ReadonlyArray<string>,
	redirects: ReadonlyArray<{
		op: string;
		path: string;
		fd: number | null;
		pathProvenance: "static" | "dynamic" | "unknown";
	}>,
): ParsedShell {
	const cmd: StructuredCmd = {
		name,
		args,
		argProvenance: args.map(() => "static"),
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
		protocolVersion: 4,
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
 * against the actual vendored v4 (post-repair) binary. Section A is the
 * load-bearing REAL_PRODUCTION_SEAM proof.
 *
 * Until C2 lands the v4 protocol bump + Go projection of `fd` and
 * `pathProvenance`, Section A is RED: `ls ... 2>/dev/null` and
 * `git status 2>/dev/null` ASK (defect). Once C2 lands, Section A is
 * GREEN.
 */

describeWithHelper("structured-command-risk -- REAL parser-helper 2>/dev/null neutral RED/GREEN", () => {
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

	it("RED->GREEN: `git status 2>/dev/null` -> ALLOW", async () => {
		const cmd = "git status 2>/dev/null";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// POST-REPAIR: ALLOW. PRE-REPAIR: ASK.
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("independent positive control: `git status` alone -> ALLOW", async () => {
		const cmd = "git status";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("compound: 3-leaf && chain with `git status 2>/dev/null` -> ALLOW", async () => {
		// All three leaves must individually qualify under the
		// safe-only allowlist. `git status --short` matches
		// host_safe_git_status (option-only); `git log --oneline`
		// matches host_safe_git_log; `git status 2>/dev/null`
		// matches host_safe_git_status + the new neutral
		// stderr-discard filter.
		const cmd =
			"git status --short && git log --oneline && git status 2>/dev/null";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		// POST-REPAIR: ALLOW. PRE-REPAIR: ASK.
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("NEGATIVE: `git status 2>errors.txt` stays ASK (write to non-/dev/null)", async () => {
		const cmd = "git status 2>errors.txt";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("NEGATIVE: `git status >/dev/null` stays ASK (stdout, not stderr)", async () => {
		const cmd = "git status >/dev/null";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("NEGATIVE: `git status 1>/dev/null` stays ASK (explicit fd=1, stdout)", async () => {
		const cmd = "git status 1>/dev/null";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("NEGATIVE: `git status 2>>/dev/null` stays ASK (append, not truncate)", async () => {
		const cmd = "git status 2>>/dev/null";
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: await helper.invoke({ command: cmd }),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});
});
/* ---------------------------------------------------------------------- *
 * Section B: synthetic structured-TS fixtures                              *
 * ---------------------------------------------------------------------- *
 *
 * Section B drives the classifier independently of the helper, using
 * `mkRedirectShell` from ./structured-command-risk-fixtures. Section B
 * is the proof the classifier contract holds for every redirect shape,
 * including fail-closed paths for missing fields / unknown provenance.
 */

describe("structured-command-risk -- SYNTHETIC_REAL redirect fixture contract", () => {
	it("ALLOW: `ls 2>/dev/null` with parser-proven fd=2 + pathProvenance=static + host path evidence", () => {
		const cmd = "ls -la .factory/evidence/ 2>/dev/null";
		const parsed = mkRedirectShell(cmd, "ls", ["-la", ".factory/evidence/"], [
			{ op: ">", path: "/dev/null", fd: 2, pathProvenance: "static" },
		]);
		// CORRECTION02: the V2 promotion gate refuses to promote
		// when a path-bearing leaf (`host_safe_ls`) is present
		// AND the host has not supplied `pathAuthorityEvidence`.
		// When evidence IS supplied, the per-command ALLOW
		// contract is honored.
		const evidenceAwareAuth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [process.cwd()],
			cwd: process.cwd(),
			pathAuthorityEvidence: {
				roots: [process.cwd()],
				cwd: process.cwd(),
				operands: [
					{
						operand: ".factory/evidence/",
						resolvedRealPath: `${process.cwd()}/.factory/evidence/`,
						contained: true,
						reason: "resolved-and-contained",
					},
				],
			},
		});
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: evidenceAwareAuth,
			parserResult: parsed,
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("ASK (CORRECTION02): `ls 2>/dev/null` without host path evidence stays ASK", () => {
		// Pre-CORRECTION02 this asserted ALLOW (the unsafe
		// behaviour HALT_PIPELINE_PATH_AUTHORITY_BYPASS). The
		// V2 promotion gate now refuses to promote when a
		// path-bearing leaf is present and the host has not
		// supplied path authority evidence.
		const cmd = "ls -la .factory/evidence/ 2>/dev/null";
		const parsed = mkRedirectShell(cmd, "ls", ["-la", ".factory/evidence/"], [
			{ op: ">", path: "/dev/null", fd: 2, pathProvenance: "static" },
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
		expect(r.source).not.toBe("risk_v2_structured_promotion");
	});

	it("ALLOW: `git status 2>/dev/null` with parser-proven fd=2 + pathProvenance=static", () => {
		const cmd = "git status 2>/dev/null";
		const parsed = mkRedirectShell(cmd, "git", ["status"], [
			{ op: ">", path: "/dev/null", fd: 2, pathProvenance: "static" },
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("ASK: `ls >/dev/null` (no explicit fd) is NOT neutral", () => {
		const cmd = "ls >/dev/null";
		const parsed = mkRedirectShell(cmd, "ls", [], [
			{ op: ">", path: "/dev/null", fd: null, pathProvenance: "static" },
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("ASK: `ls 1>/dev/null` (fd=1, stdout) is NOT neutral", () => {
		const cmd = "ls 1>/dev/null";
		const parsed = mkRedirectShell(cmd, "ls", [], [
			{ op: ">", path: "/dev/null", fd: 1, pathProvenance: "static" },
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("ASK: `ls 2>>/dev/null` (append op) is NOT neutral", () => {
		const cmd = "ls 2>>/dev/null";
		const parsed = mkRedirectShell(cmd, "ls", [], [
			{ op: ">>", path: "/dev/null", fd: 2, pathProvenance: "static" },
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("ASK: `ls 2>errors.txt` (non-/dev/null path) is NOT neutral", () => {
		const cmd = "ls 2>errors.txt";
		const parsed = mkRedirectShell(cmd, "ls", [], [
			{ op: ">", path: "errors.txt", fd: 2, pathProvenance: "static" },
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("ASK: `ls 2>\"$NULL_PATH\"` (dynamic path) is NOT neutral", () => {
		const cmd = 'ls 2>"$NULL_PATH"';
		const parsed = mkRedirectShell(cmd, "ls", [], [
			{ op: ">", path: "${NULL_PATH}", fd: 2, pathProvenance: "dynamic" },
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("ASK: `ls 2>&1` (dup op) is NOT neutral", () => {
		const cmd = "ls 2>&1";
		const parsed = mkRedirectShell(cmd, "ls", [], [
			{ op: ">&", path: "1", fd: 2, pathProvenance: "static" },
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("R5 CONSERVATION: `rm -rf $HOME 2>/dev/null` stays never-auto-approve (R5 not bypassed)", () => {
		const cmd = 'rm -rf "$HOME" 2>/dev/null';
		const parsed = mkRedirectShell(cmd, "rm", ["-rf", "$HOME"], [
			{ op: ">", path: "/dev/null", fd: 2, pathProvenance: "static" },
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.disposition).toBe("never-auto-approve");
	});
});

describe("structured-command-risk -- SYNTHETIC_REAL composition fixtures", () => {
	/**
	 * Build a ParsedShell whose `sourceSha256` matches the SHA-256 of
	 * `joinRunCommandsForParse(toolInput).joined`. The CORRECTION01
	 * source-binding gate stays green when the SHA matches.
	 */
	function mkBoundShell(toolInput: string, stmts: ReadonlyArray<StructuredStmt>): ParsedShell {
		const { joined } = joinRunCommandsForParse(toolInput);
		return {
			protocolVersion: 4,
			dialect: "bash",
			sourceSha256: sha256Hex(joined),
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: [...stmts] },
			errors: [],
		};
	}
	it("MIXED RISK: `git status 2>/dev/null && git branch -D foo` stays ASK", () => {
		const cmd = "git status 2>/dev/null && git branch -D foo";
		const left: StructuredStmt = {
			kind: "cmd",
			cmd: {
				name: "git",
				args: ["status"],
				argProvenance: ["static"],
				assigns: [],
				redirects: [
					{ op: ">", path: "/dev/null", fd: 2, pathProvenance: "static" },
				],
				isWrapper: false,
				wrapperOf: "",
				inner: "",
			},
		};
		const right: StructuredStmt = {
			kind: "cmd",
			cmd: {
				name: "git",
				args: ["branch", "-D", "foo"],
				argProvenance: ["static", "static", "static"],
				assigns: [],
				redirects: [],
				isWrapper: false,
				wrapperOf: "",
				inner: "",
			},
		};
		const parsed = mkBoundShell(cmd, [{ kind: "and", left, rhs: right }]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("PIPELINE: `pwd && git status 2>/dev/null` -> ALLOW (neutral last leaf)", () => {
		// Pipeline-with-redirects leaf's neutral redirect filter
		// applies to the LAST AND-leaf (which carries the redirect).
		// Use `pwd && git status 2>/dev/null` since `head`/`cat`
		// are not in the host_safe allowlist (the existing pipeline
		// aggregate gate blocks pipes to non-safe sinks; per ACT
		// §13 the conservation rule is "pipeline risk = existing
		// aggregate of leaf risks" with the neutral-redirect
		// classification no longer raising the leaf).
		const cmd = "pwd && git status 2>/dev/null";
		const left: StructuredStmt = {
			kind: "cmd",
			cmd: {
				name: "pwd",
				args: [],
				argProvenance: [],
				assigns: [],
				redirects: [],
				isWrapper: false,
				wrapperOf: "",
				inner: "",
			},
		};
		const right: StructuredStmt = {
			kind: "cmd",
			cmd: {
				name: "git",
				args: ["status"],
				argProvenance: ["static"],
				assigns: [],
				redirects: [
					{ op: ">", path: "/dev/null", fd: 2, pathProvenance: "static" },
				],
				isWrapper: false,
				wrapperOf: "",
				inner: "",
			},
		};
		const parsed = mkBoundShell(cmd, [{ kind: "and", left, rhs: right }]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("PIPELINE NEGATIVE: `git status 2>/dev/null | sh` stays ASK (sh sibling)", () => {
		const cmd = "git status 2>/dev/null | sh";
		const left: StructuredStmt = {
			kind: "cmd",
			cmd: {
				name: "git",
				args: ["status"],
				argProvenance: ["static"],
				assigns: [],
				redirects: [
					{ op: ">", path: "/dev/null", fd: 2, pathProvenance: "static" },
				],
				isWrapper: false,
				wrapperOf: "",
				inner: "",
			},
		};
		const right: StructuredStmt = {
			kind: "cmd",
			cmd: {
				name: "sh",
				args: [],
				argProvenance: [],
				assigns: [],
				redirects: [],
				isWrapper: false,
				wrapperOf: "",
				inner: "",
			},
		};
		const parsed = mkBoundShell(cmd, [{ kind: "pipe", left, rhs: right }]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});
});

describe("structured-command-risk -- SYNTHETIC_REAL fail-closed + structural", () => {
	it("FAIL CLOSED: legacy v3 response without fd/pathProvenance is treated as non-neutral", () => {
		const cmd = "ls -la .factory/evidence/ 2>/dev/null";
		const parsed: ParsedShell = {
			protocolVersion: 3,
			dialect: "bash",
			sourceSha256: "0".repeat(64),
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: {
				stmts: [
					{
						kind: "cmd",
						cmd: {
							name: "ls",
							args: ["-la", ".factory/evidence/"],
							argProvenance: ["static", "static"],
							assigns: [],
							redirects: [{ op: ">", path: "/dev/null" }],
							isWrapper: false,
							wrapperOf: "",
							inner: "",
						},
					},
				],
			},
			errors: [],
		};
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("FAIL CLOSED: `pathProvenance: 'unknown'` is non-neutral", () => {
		const cmd = "ls -la .factory/evidence/ 2>/dev/null";
		const parsed = mkRedirectShell(cmd, "ls", ["-la", ".factory/evidence/"], [
			{ op: ">", path: "/dev/null", fd: null, pathProvenance: "unknown" },
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("STRUCTURAL: neutral redirect carries zero authority -- base risk unchanged", () => {
		// Use `git status` (no path operand) so the R0 workspace
		// realpath authority gate does not interfere. The structural
		// assertion is: the neutral redirect does not move the
		// classifier's verdict relative to the base command.
		const baseCmd = "git status";
		const withNeutralCmd = "git status 2>/dev/null";
		const baseParsed = mkRedirectShell(baseCmd, "git", ["status"], []);
		const withNeutralParsed = mkRedirectShell(withNeutralCmd, "git", ["status"], [
			{ op: ">", path: "/dev/null", fd: 2, pathProvenance: "static" },
		]);
		const r1 = evaluateCommandRiskWithParser({
			toolInput: baseCmd,
			hostAuthorization: SAFE,
			parserResult: baseParsed,
		});
		const r2 = evaluateCommandRiskWithParser({
			toolInput: withNeutralCmd,
			hostAuthorization: SAFE,
			parserResult: withNeutralParsed,
		});
		expect(r1.disposition).toBe(r2.disposition);
		expect(r1.decision).toBe(r2.decision);
		// And specifically: the base (no redirect) is ALLOW because
		// V1 host_safe_git_status matches and V2 confirms it.
		expect(r1.decision).toBe("allow");
	});
});

describe("structured-command-risk -- isAuthorityNeutralStderrDiscard unit predicate", () => {
	// We import isAuthorityNeutralStderrDiscard directly. Since
	// structured-command-risk.ts is the source, the export is in
	// scope via command-risk-internal.ts.
	//
	// ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01.
	it("returns true ONLY for {fd:2, op:'>', path:'/dev/null', pathProvenance:'static'}", async () => {
		const { isAuthorityNeutralStderrDiscard } = await import(
			"./structured-command-risk"
		);
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">",
				path: "/dev/null",
				fd: 2,
				pathProvenance: "static",
			}),
		).toBe(true);
	});

	it("returns false for every other redirect shape (failure modes)", async () => {
		const { isAuthorityNeutralStderrDiscard } = await import(
			"./structured-command-risk"
		);
		// fd missing -> fail closed
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">",
				path: "/dev/null",
				pathProvenance: "static",
			}),
		).toBe(false);
		// fd = null (no explicit fd in source)
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">",
				path: "/dev/null",
				fd: null,
				pathProvenance: "static",
			}),
		).toBe(false);
		// fd = 1 (stdout)
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">",
				path: "/dev/null",
				fd: 1,
				pathProvenance: "static",
			}),
		).toBe(false);
		// fd = 0 (stdin)
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">",
				path: "/dev/null",
				fd: 0,
				pathProvenance: "static",
			}),
		).toBe(false);
		// op = >>
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">>",
				path: "/dev/null",
				fd: 2,
				pathProvenance: "static",
			}),
		).toBe(false);
		// op = >&
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">&",
				path: "1",
				fd: 2,
				pathProvenance: "static",
			}),
		).toBe(false);
		// path != /dev/null
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">",
				path: "errors.txt",
				fd: 2,
				pathProvenance: "static",
			}),
		).toBe(false);
		// pathProvenance = dynamic
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">",
				path: "/dev/null",
				fd: 2,
				pathProvenance: "dynamic",
			}),
		).toBe(false);
		// pathProvenance = unknown
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">",
				path: "/dev/null",
				fd: 2,
				pathProvenance: "unknown",
			}),
		).toBe(false);
		// pathProvenance missing
		expect(
			isAuthorityNeutralStderrDiscard({
				op: ">",
				path: "/dev/null",
				fd: 2,
			}),
		).toBe(false);
	});
});
