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

// P1 from CORRECTION01 Factory review (corrected in CORRECTION02):
//   - supported platform + expected helper binary absent -> FAIL CI.
//   - genuinely unsupported platform                    -> skip cleanly.
//
// We achieve the second branch by binding the describe-fn to either
// describe (real run, will throw on absent-binary supported platform
// inside beforeAll) or describe.skip (true skip on unsupported
// platforms). This replaces the original pattern of `if (!HELPER_PATH)
// return;` per test which silently reported GREEN on a supported
// platform with no helper binary present.
const describeWithHelper = (
	HELPER_PATH || isSupportedPlatform ? describe : describe.skip
) as typeof describe;

if (!HELPER_PATH && isSupportedPlatform) {
	// eslint-disable-next-line no-console
	console.error(
		`[structured-command-risk.attack-witness] supported platform ${HELPER_PLATFORM} but vendored helper binary is missing at ${sdkRoot}/bin/parser-helper/${HELPER_PLATFORM}/. Failing the suite.`,
	);
}

describeWithHelper(
	"V2 echo authority RED witness (CORRECTION02) -- semantically-correct shell-expansion matrix",
	() => {
		let helper: MvdanShHelper;

		// P1 from CORRECTION01 Factory review (refined):
		//   On a supported platform where the helper binary is absent,
		//   throw here so the entire describe block fails (CI catches the
		//   missing shipping artifact). On an unsupported platform we
		//   never reach this point because describeWithHelper is bound to
		//   describe.skip, which short-circuits beforeAll.
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
			// After the beforeAll guard above, this should always succeed on
			// supported platforms. If it doesn't, the describe block was
			// somehow started without the helper initialised -- a true
			// configuration bug worth failing the test loudly rather than
			// silently returning a wrong answer.
			if (!helper) {
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
				// Build the literal shell source by concatenation so biome does not
				// interpret the ${x:-foo} as a TS template placeholder.
				{
					// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell source, not a TS template
					src: "echo " + "${x:-foo}",
					// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell source, not a TS template
					why: "unquoted " + "${x:-foo}" + " expands with default",
				},
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
				// --- Paired discriminators: tilde / glob / brace / tilde-prefix ---
				// These prove the difference between unquoted Lit (which can
				// carry later shell expansion) and quoted literal data. The
				// mvdan/sh AST presents both as a `Lit` WordPart at syntax
				// level; the difference lives in quote context and in the
				// helper's per-Part expansion-classification. The next
				// section pairs each of these with its quoted equivalent.
				{ src: "echo ~", why: "unquoted tilde expands to $HOME" },
				{ src: "echo ~/foo", why: "unquoted ~-prefix expands to $HOME/foo" },
				{
					src: "echo foo{a,b}",
					why: "unquoted {a,b} brace-expands to two args",
				},
				{ src: "echo foo*", why: "unquoted foo* pathname-expands cwd" },
				{
					src: "echo foo[ab]",
					why: "unquoted foo[ab] pathname-expands bracket pattern",
				},
				{
					src: "echo foo?",
					why: "unquoted foo? pathname-expands single-char wildcard",
				},
				// -- Section C additions (containment): MUST ASK by design --
				// The user's exact 5-leaf LIVE chain and the simpler
				// compound ASK under containment because the V2 parsed-argv
				// ALLOW path was removed. They will become ALLOW again when
				// parser-proven shellStatic provenance lands
				// (ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01 +
				// CORRECTION02 Section D below).
				{
					src: "git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v",
					why: "user's exact LIVE chain ASK under containment (Section C: precision regression, security restored)",
				},
				{
					src: "echo '---BRANCH---' && git status --short",
					why: "simple compound (quoted echo + safe git) ASK under containment (was the LIVE-bug bypass)",
				},
				{
					src: "echo '---BRANCH---' && echo '<(touch /tmp/nope)' && echo '{a,b}' && echo '*'",
					why: "compound of all-quoted-literal leaves ASK under containment (Section C)",
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
		describe("Section B1: MUST ALLOW under CONTAINMENT (V1 source-text echo rule suffices)", () => {
			// V1's host_safe_echo regex matches the original
			// source text for these forms (no compound, no
			// &&, no $). Containment does not change this
			// path; the source-text match gives ALLOW on its
			// own.
			// V1's host_safe_echo regex is anchored to SHELL SOURCE TEXT,
			// not to parsed argv. Its quoted inner class is
			// `[A-Za-z0-9 _.,:/+@%^-]*`, so only quoted forms whose inner
			// characters are all in that class ALLOW via V1 alone. Under
			// containment these are the only forms that V2 echoes can
			// ALLOW (without parser-proven shellStatic provenance).
			const mustAllowV1: ReadonlyArray<{ src: string; why: string }> = [
				// The user's exact LIVE echo leaves (single + double
				// quoted hyphen).
				{
					src: "echo '---BRANCH---'",
					why: "user's LIVE echo leaf, single-quoted hyphen (V1 quoted class includes '-')",
				},
				{
					src: "echo '---REMOTES---'",
					why: "user's LIVE echo leaf, single-quoted hyphen (V1 quoted class includes '-')",
				},
				{
					src: 'echo "---BRANCH---"',
					why: "double-quoted equivalent of LIVE leaf (V1 quoted class includes '-')",
				},
			];

			for (const { src, why } of mustAllowV1) {
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

		// ----------------------------------------------------------------
		// Section D: CURRENT_STATE_WITNESS -- parser-proven positive
		// provenance TARGET recorded but not asserted GREEN.
		//
		// Each form below contains quoted literal data whose visible
		// characters fall outside V1's host_safe_echo quoted class
		// (e.g. `{`, `}`, `*`, `?`, `[`, `]`, `<`, `>`, `)`, `$`, `` ` ``).
		// Under containment (V2 parsed-argv ALLOW removed), each of these
		// returns ASK by design. The test body asserts the current
		// conservative verdict (ASK), NOT the target shape.
		//
		// When ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01 lands and
		// the Go helper emits per-arg `shellStatic` provenance from
		// the original mvdan/sh AST + quote context, V2 will ALLOW
		// any single-command echo whose every arg is
		// `shellStatic: true`. At that point the assertion in this
		// section will flip from `r.decision === "ask"` to
		// `r.decision === "allow" && r.disposition === "auto-approve-eligible"`,
		// and the section becomes a real GREEN regression guard.
		//
		// Per Factory review (P2 documentary correction): this section
		// is NOT literally RED today. It is the current-state witness
		// for the future ALLOW target. Run it via:
		//   bunx vitest run --config vitest.config.ts -t "Section D:"
		//
		// Each paired form has a MUST ASK sibling in Section A above
		// (e.g. echo ~ ↔ echo '~', echo * ↔ echo '*', etc.) to keep
		// the bidirectional contract visible in one file.
		// ----------------------------------------------------------------
		describe("Section D: parser-proven positive provenance target (CURRENT_STATE_WITNESS / TARGET shape recorded but not asserted)", () => {
			const mustAllowParserProven: ReadonlyArray<{ src: string; why: string }> =
				[
					// Quoted procsub / brace / param / arith / cmd-subst / glob.
					// V1's host_safe_echo quoted class intentionally excludes these
					// characters even when they appear inside quotes (defense in
					// depth), so V1 ASKs; only positive parser-proven provenance
					// can safely ALLOW them.
					{
						src: "echo '<(touch /tmp/nope)'",
						why: "single-quoted <(...) is literal data, not procsub (paired with MUST ASK echo <(touch ...))",
					},
					{
						src: "echo '<(/bin/rm -rf $HOME)'",
						why: "single-quoted procsub-syntax with embedded $-marker is still literal",
					},
					{
						src: "echo '{a,b}'",
						why: "single-quoted brace list is literal data",
					},
					{
						src: "echo '{1..5}'",
						why: "single-quoted brace sequence is literal data",
					},
					{
						src: "echo '$(touch /tmp/nope)'",
						why: "single-quoted cmd-subst syntax is literal data",
					},
					{
						src: "echo '$((1+2))'",
						why: "single-quoted arith syntax is literal data",
					},
					{
						// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell source, not a TS template
						src: "echo '${HOME}'",
						why: "single-quoted param-expansion syntax is literal data",
					},
					{
						src: "echo '*'",
						why: "single-quoted glob char is literal (paired with MUST ASK echo *)",
					},
					{
						src: "echo '$HOME'",
						why: "single-quoted $HOME-style param syntax is literal data",
					},
					{
						src: "echo 'foo; rm -rf /'",
						why: "single-quoted shell-composition char is literal data",
					},
					{
						src: "echo 'foo*bar'",
						why: "single-quoted glob char in middle is literal",
					},
					{ src: "echo 'foo|bar'", why: "single-quoted pipe char is literal" },
					// Concatenation of literal parts.
					{
						src: "echo 'foo'bar'baz'",
						why: "concatenation of literal parts is one shell word",
					},
					// Paired tilde / glob / brace / bracket / question discriminators.
					{
						src: "echo '~'",
						why: "single-quoted tilde is literal (paired with MUST ASK echo ~)",
					},
					{
						src: "echo '~/foo'",
						why: "single-quoted ~-prefix is literal (paired with MUST ASK echo ~/foo)",
					},
					{
						src: "echo 'foo{a,b}'",
						why: "single-quoted braces are literal (paired with MUST ASK echo foo{a,b})",
					},
					{
						src: "echo 'foo*'",
						why: "single-quoted * is literal (paired with MUST ASK echo foo*)",
					},
					{
						src: "echo 'foo[ab]'",
						why: "single-quoted [ab] is literal (paired with MUST ASK echo foo[ab])",
					},
					{
						src: "echo 'foo?'",
						why: "single-quoted ? is literal (paired with MUST ASK echo foo?)",
					},
				];

			for (const { src, why } of mustAllowParserProven) {
				it(`ALLOW: ${src}`, async () => {
					const parsed = await requireHelper().invoke({ command: src });
					const r = evaluateCommandRiskWithParser({
						toolInput: src,
						hostAuthorization: SAFE,
						parserResult: parsed,
					});
					// Containment pins the CURRENT state: each form returns ASK
					// (parsed-argv ALLOW path removed; V1 quoted class excludes
					// the visible characters).
					//
					// When CORRECTION02 lands:
					//   - Replace this assertion with
					//     `r.decision === "allow" && r.disposition === "auto-approve-eligible"`.
					//   - The Section D header comment above will then read
					//     "GREEN once shellStatic lands" instead of "RED".
					expect(
						r.decision === "ask",
						`Section D CURRENT_STATE_WITNESS: asserts the current ASK verdict; flips to ALLOW when parser-proven shellStatic provenance lands. Expected ASK for "${src}" (${why}). Got decision=${r.decision} disposition=${r.disposition} source=${r.source}.`,
					).toBe(true);
				});
			}
		});
	},
);
