// ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01-CORRECTION02
// RED witness -- semantically correct shell-expansion matrix.
//
// Classification: REAL_PRODUCTION_SEAM (drives the vendored mvdan/sh
// helper directly through evaluateCommandRiskWithParser).
//
// Contract:
//   The string-blacklist approach (CORRECTION01) cannot reliably
//   distinguish QUOTED LITERAL DATA from ACTIVE SHELL EXPANSION
//   once the parser has flattened words to strings. Quoting
//   removes shell significance from its contents (per GNU Bash
//   "Quoting"), so:
//
//       echo '<(touch /tmp/nope)'    # one harmless literal argument
//       echo <(touch /tmp/nope)      # active ProcSubst, runs touch
//       echo '{a,b}'                 # one harmless literal argument
//       echo {a,b}                   # brace-expanded to two args
//       echo '*'                     # one harmless literal argument
//       echo *                       # pathname expansion of cwd
//       echo 'foo; rm -rf /'         # one harmless literal argument
//       echo foo; rm -rf /           # shell composition / R5
//
//   CORRECTION02 must introduce parser-proven static-literal
//   provenance so V2 can authorize echo on a positive fact (every
//   WordPart is Lit/SglQuoted/DblQuoted-of-statics, no ParamExp/
//   CmdSubst/ArithmExp/ProcSubst/ExtGlob/unquoted-brace/unquoted-glob),
//   not on character absence.
//
//   This file is the binding RED contract for CORRECTION02:
//   - "MUST ASK" group  -> each active expansion must be rejected
//   - "MUST ALLOW" group -> each quoted literal must be approved
//
//   The CORRECTION01 repair (string-blacklist) FAILS the MUST ASK
//   group for two compound-active-expansion forms and FAILS the
//   MUST ALLOW group for every single-command quoted-literal form
//   that contains characters outside V1's source-text echo regex.

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
			if (pkg && pkg.name === "@cline/core") return dir;
		} catch {}
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

const SAFE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});

// P1 from CORRECTION01 Factory review:
//   For the five vendored platforms, ABSENT binary -> FAIL the
//   describe block (so CI catches a missing helper). For other
//   platforms (unsupported by the shipping contract), skip cleanly.
const SUPPORTED_PLATFORMS: ReadonlySet<NonNullable<HelperPlatform>> = new Set([
	"darwin-arm64",
	"darwin-amd64",
	"linux-amd64",
	"linux-arm64",
	"win32-x64",
]);
const isSupportedPlatform =
	HELPER_PLATFORM !== null && SUPPORTED_PLATFORMS.has(HELPER_PLATFORM);

if (isSupportedPlatform && !HELPER_PATH) {
	// eslint-disable-next-line no-console
	console.error(
		`[structured-command-risk.attack-witness] supported platform ${HELPER_PLATFORM} but vendored helper binary is missing at ${sdkRoot}/bin/parser-helper/${HELPER_PLATFORM}/. Failing the suite.`,
	);
}

const skipBlock = !HELPER_PATH;
void skipBlock; // kept for future per-test skip checks; unused for now since beforeAll handles it
describe("V2 echo authority RED witness (CORRECTION02) -- semantically-correct shell-expansion matrix", () => {
	let helper: MvdanShHelper;

	// P1 from CORRECTION01 Factory review:
	//   On the five vendored platforms, ABSENT binary -> FAIL the
	//   entire describe block (so CI catches a missing shipping
	//   artifact). On other platforms (unsupported by the shipping
	//   contract), this guard yields skip-equivalent early-return.
	//   The original pattern of `if (!HELPER_PATH) return;` per test
	//   silently reported GREEN; that hid missing artifacts.
	beforeAll(() => {
		if (!HELPER_PATH) {
			if (isSupportedPlatform) {
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

	function requireHelper(): MvdanShHelper {
		if (!helper) {
			// Reachable only on unsupported platforms. Throw so the
			// describe block fails rather than silently passing.
			throw new Error(
				`parser-helper not initialised; HELPER_PATH=${HELPER_PATH ?? "absent"}, HELPER_PLATFORM=${HELPER_PLATFORM ?? "unknown"}.`,
			);
		}
		return helper;
	}

	// ----------------------------------------------------------------
	// Section A: MUST ASK. Active shell expansion. Each form must be
	// rejected (decision === "ask" or disposition === "never-auto-approve").
	// ----------------------------------------------------------------
	describe("MUST ASK: active shell expansion", () => {
		const mustAsk: ReadonlyArray<{ src: string; why: string }> = [
			// Process substitution (unquoted)
			{
				src: "echo <(touch /tmp/CLINEMM_SENTINEL)",
				why: "unquoted <() runs inner command",
			},
			{ src: "echo >(cat)", why: "unquoted >() runs inner command" },
			// Brace expansion (unquoted)
			{
				src: "echo {a,b,c}",
				why: "unquoted brace list expands to multiple args",
			},
			{
				src: "echo {1..5}",
				why: "unquoted brace sequence expands to multiple args",
			},
			// Glob (unquoted)
			{ src: "echo *", why: "unquoted * pathname-expands cwd" },
			{ src: "echo *.ts", why: "unquoted *.ts pathname-expands" },
			{
				src: "echo /etc/passwd*",
				why: "unquoted path glob enumerates filesystem",
			},
			// Parameter expansion (unquoted)
			{ src: "echo $HOME", why: "unquoted $HOME expands to home dir" },
			// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell source, not a TS template
			{ src: "echo ${HOME}", why: "unquoted ${HOME} expands" },
			// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell source, not a TS template
			{ src: "echo ${x:-foo}", why: "unquoted ${x:-foo} expands with default" },
			// Command substitution
			{
				src: "echo $(touch /tmp/CLINEMM_SENTINEL)",
				why: "unquoted $() runs inner command",
			},
			// Arithmetic expansion
			{ src: "echo $((1+2))", why: "unquoted $((expr)) expands to result" },
			// Compound: active expansion in trailing leaf
			{
				src: "echo '---BRANCH---' && echo *",
				why: "compound: trailing bare glob enumerates cwd",
			},
			{
				src: "echo '---BRANCH---' && echo <(touch /tmp/CLINEMM_SENTINEL)",
				why: "compound: trailing unquoted procsub runs touch",
			},
			{
				src: "echo '---BRANCH---' && echo {a,b}",
				why: "compound: trailing unquoted brace list expands",
			},
			{
				src: "echo '---BRANCH---' && echo $HOME",
				why: "compound: trailing unquoted param expansion",
			},
			// Mixed-risk chain sentinel
			{
				src: "git status --short && git branch -D __CLINEMM_SENTINEL__",
				why: "mutating git subcommand in compound",
			},
		];

		for (const { src, why } of mustAsk) {
			it(`ASK: ${src}`, async () => {
				const parsed = await requireHelper().invoke({ command: src });
				const r = evaluateCommandRiskWithParser({
					toolInput: src,
					hostAuthorization: SAFE,
					parserResult: parsed,
				});
				expect(
					r.decision === "ask" || r.disposition === "never-auto-approve",
					`Expected ASK/never-auto-approve for "${src}" (${why}). Got decision=${r.decision} disposition=${r.disposition} source=${r.source}.`,
				).toBe(true);
			});
		}
	});
	// ----------------------------------------------------------------
	// Section B: MUST ALLOW. Quoted literal data. Each form must be
	// approved (decision === "allow" && disposition === "auto-approve-eligible").
	// ----------------------------------------------------------------
	describe("MUST ALLOW: quoted literal data (no active expansion)", () => {
		const mustAllow: ReadonlyArray<{ src: string; why: string }> = [
			// Single-quoted procsub syntax -- one literal arg
			{
				src: "echo '<(touch /tmp/nope)'",
				why: "single quotes remove shell meaning",
			},
			{
				src: "echo '<(/bin/rm -rf $HOME)'",
				why: "single quotes remove shell meaning even when inner $HOME looks live",
			},
			// Single-quoted brace syntax
			{ src: "echo '{a,b}'", why: "single quotes suppress brace expansion" },
			{ src: "echo '{1..5}'", why: "single quotes suppress brace sequence" },
			// Single-quoted cmd subst / arith / param
			{
				src: "echo '$(touch /tmp/nope)'",
				why: "single quotes suppress command substitution",
			},
			{
				src: "echo '$((1+2))'",
				why: "single quotes suppress arithmetic expansion",
			},
			{
				// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell source, not a TS template
				src: "echo '${HOME}'",
				why: "single quotes suppress parameter expansion",
			},
			// Single-quoted glob
			{ src: "echo '*'", why: "single quotes suppress pathname expansion" },
			{
				src: "echo '$HOME'",
				why: "single quotes suppress param expansion ($ is literal)",
			},
			// Shell metachars inside quotes
			{
				src: "echo 'foo; rm -rf /'",
				why: "semicolon inside quotes is literal data",
			},
			{ src: "echo 'foo*bar'", why: "glob char inside quotes is literal data" },
			{ src: "echo 'foo|bar'", why: "pipe char inside quotes is literal data" },
			// The user's exact LIVE echo forms
			{
				src: "echo '---BRANCH---'",
				why: "user's LIVE echo leaf, single-quoted",
			},
			{
				src: "echo '---REMOTES---'",
				why: "user's LIVE echo leaf, single-quoted",
			},
			{
				src: 'echo "---BRANCH---"',
				why: "double-quoted equivalent of LIVE leaf",
			},
			// Concatenation of literal parts
			{
				src: "echo 'foo'bar'baz'",
				why: "concatenation of single-quoted + bare literal",
			},
			// User's exact 5-leaf LIVE chain (must ALLOW)
			{
				src: "git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v",
				why: "user's exact LIVE chain: every expansion-bearing leaf is quoted",
			},
			// Compound where every quoted-literal leaf is wrapped
			{
				src: "echo '---BRANCH---' && echo '<(touch /tmp/nope)' && echo '{a,b}' && echo '*'",
				why: "compound: all trailing leaves are quoted literal data",
			},
			// Beautiful discriminator pair:
			//   "echo 'foo; rm -rf /'" -> safe one literal arg
			//   "echo foo; rm -rf /"   -> shell composition / R5
			// Already covered in the forms above but worth flagging
			// again: the projection MUST distinguish them.
		];

		for (const { src, why } of mustAllow) {
			it(`ALLOW: ${src}`, async () => {
				const parsed = await requireHelper().invoke({ command: src });
				const r = evaluateCommandRiskWithParser({
					toolInput: src,
					hostAuthorization: SAFE,
					parserResult: parsed,
				});
				expect(
					r.decision === "allow" && r.disposition === "auto-approve-eligible",
					`Expected ALLOW/auto-approve-eligible for "${src}" (${why}). Got decision=${r.decision} disposition=${r.disposition} source=${r.source}.`,
				).toBe(true);
			});
		}
	});
});
