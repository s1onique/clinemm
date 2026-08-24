// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01-PHASE2-PROVENANCE01.
//
// Phase 2 RED/GREEN witness for the parser-proven positive provenance
// branch added to `classifyCmd` in `structured-command-risk.ts`.
//
// CRITICAL SCOPE NOTE:
//   This suite points at the v3 helper built at
//   `<sdkRoot>/parser-helper-src/dist/parser-helper/<platform>/`,
//   NOT at the vendored binary in
//   `<sdkRoot>/bin/parser-helper/<platform>/`. Phase 2 deliberately
//   leaves the vendored binary at v2; promoting v3 to the vendored
//   slot is is Phase 3. The "OLD PROTOCOL V2 FAILS CLOSED" gate in
//   the reviewer's stop point is proven by ALSO pointing at the
//   frozen-legacy v2 binary and asserting the same Section D inputs
//   remain ASK (fail-closed under v2).
//
// Truth table for this suite:
//   host v3 helper present  -> EXECUTE Section A / B / D against v3
//   supported + v3 missing  -> FAIL loud
//   unsupported              -> describe.skip

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

const SUPPORTED_PLATFORMS: ReadonlySet<NonNullable<HelperPlatform>> = new Set([
	"darwin-arm64",
	"darwin-amd64",
	"linux-amd64",
	"linux-arm64",
	"win32-x64",
]);
const isSupportedPlatform =
	HELPER_PLATFORM !== null && SUPPORTED_PLATFORMS.has(HELPER_PLATFORM);

// V3 host-built helper location (Phase 2 destination; not vendored).
const V3_DIST_PATH = (() => {
	if (!HELPER_PLATFORM) return null;
	const ext = HELPER_PLATFORM === "win32-x64" ? ".exe" : "";
	const candidate = join(
		sdkRoot,
		"parser-helper-src",
		"dist",
		"parser-helper",
		HELPER_PLATFORM,
		`cline-parser-helper${ext}`,
	);
	return existsSync(candidate) ? candidate : null;
})();

// V2 LEGACY helper location (Phase 3 FROZEN-LEGACY path).
//
// PHASE 3 P0 change: the vendored slot at sdkRoot/bin/parser-helper/
// now holds the v3 helper. The v2 legacy helper for darwin-arm64 is
// preserved at parser-helper-src/.factory/oracle/legacy-binaries/,
// extracted from commit a3c8d49b7 (the only historical commit that
// vendored a helper binary). Its frozen identity is captured in
// LEGACY_HELPERS.txt (sha256 ce169663762c823440b864840c71115103f0d5afc146ca40f29e04c4d4239964,
// protocolVer 2).
//
// The legacy darwin-arm64 binary is the ONLY one we have a frozen
// copy of (the other 4 platforms were never checked in -- hostRun
// was false in LEGACY_HELPERS.txt). Section F below is therefore
// gated on darwin-arm64 + the legacy file being present.
const V2_LEGACY_PATH = (() => {
	if (HELPER_PLATFORM !== "darwin-arm64") return null;
	const candidate = join(
		sdkRoot,
		"parser-helper-src",
		".factory",
		"oracle",
		"legacy-binaries",
		"darwin-arm64-cline-parser-helper-v2",
	);
	return existsSync(candidate) ? candidate : null;
})();

const SAFE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});

// Truth table from CORRECTION01 (refined in CORRECTION02):
//   supported platform + v3 helper missing  -> describe + throw on beforeAll
//   unsupported platform                     -> describe.skip
//   v3 helper present                        -> describe (real run)
const describeWithV3 = (isSupportedPlatform ? describe : describe.skip) as typeof describe;

if (isSupportedPlatform && !V3_DIST_PATH) {
	// eslint-disable-next-line no-console
	console.error(
		`[phase2-provenance] supported platform ${HELPER_PLATFORM} but v3 host-built helper is missing at ${sdkRoot}/parser-helper-src/dist/parser-helper/${HELPER_PLATFORM}/. Failing the suite -- run \`bash parser-helper-src/cross-compile.sh\` to build it.`,
	);
}

describeWithV3(
	"V3 parser-proven positive provenance (PHASE 2 PROVENANCE01)",
	() => {
		let helper: MvdanShHelper;

		beforeAll(() => {
			if (!V3_DIST_PATH) {
				throw new Error(
					`V3 helper binary missing for supported platform ${HELPER_PLATFORM}; run \`bash parser-helper-src/cross-compile.sh\` to build it.`,
				);
			}
			helper = new MvdanShHelper({
				platform: HELPER_PLATFORM as NonNullable<HelperPlatform>,
				binaryPath: () => V3_DIST_PATH as string,
			});
		});

		// ----- Section A: MUST ASK. Active shell expansion -----
		// Same as the existing CORRECTION02 attack-witness. Each form
		// below contains an active expansion that the parser MUST
		// classify as `dynamic`. The V2 path then keeps the verdict
		// at ASK (no promotion).
		describe("Section A: MUST ASK (active shell expansion)", () => {
			const mustAsk: ReadonlyArray<{ src: string; why: string }> = [
				{ src: "echo <(touch /tmp/CLINEMM_SENTINEL)", why: "unquoted ProcSubst" },
				{ src: "echo *", why: "unquoted * pathname-expands cwd" },
				{ src: "echo *.ts", why: "unquoted *.ts pathname-expands" },
				{ src: "echo {a,b}", why: "unquoted brace expansion" },
				{ src: "echo $HOME", why: "unquoted ParamExp" },
				{ src: "echo ~", why: "unquoted tilde expansion" },
				{ src: "echo ~/foo", why: "unquoted tilde-prefix expansion" },
				{ src: "echo foo{a,b}", why: "unquoted mid-string brace expansion" },
				{ src: "echo foo*", why: "unquoted foo* pathname-expands cwd" },
				{ src: "echo foo[ab]", why: "unquoted foo[ab] bracket pattern" },
				{ src: "echo foo?", why: "unquoted foo? single-char wildcard" },
				{ src: "echo $(rm -rf foo)", why: "unquoted CmdSubst" },
			];
			for (const { src, why } of mustAsk) {
				it(`ASK: ${src}`, async () => {
					const parsed = await helper.invoke({ command: src });
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

		// ----- Section B: MUST ALLOW via parser-proven provenance -----
		// Each form contains a quoted literal whose parser-proven
		// provenance is `static`. The parser-proven positive branch
		// in `classifyCmd` MUST ALLOW them.
		describe("Section B: MUST ALLOW (parser-proven positive provenance)", () => {
			const mustAllow: ReadonlyArray<{ src: string; why: string }> = [
				{ src: "echo '*'", why: "single-quoted glob char" },
				{ src: "echo '{a,b}'", why: "single-quoted brace list" },
				{ src: "echo '{1..5}'", why: "single-quoted brace sequence" },
				{ src: "echo '$(touch /tmp/nope)'", why: "single-quoted cmd-subst syntax" },
				{ src: "echo '$((1+2))'", why: "single-quoted arith syntax" },
				// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell source, not a TS template
				{ src: "echo '${HOME}'", why: "single-quoted param-expansion syntax" },
				{ src: "echo '$HOME'", why: "single-quoted $HOME-style param syntax" },
				{ src: "echo 'foo; rm -rf /'", why: "single-quoted shell-composition char" },
				{ src: "echo 'foo*bar'", why: "single-quoted glob char mid-string" },
				{ src: "echo 'foo|bar'", why: "single-quoted pipe char" },
				{ src: "echo 'foo'bar'baz'", why: "concatenation of literal parts" },
				{ src: "echo '~'", why: "single-quoted tilde" },
				{ src: "echo '~/foo'", why: "single-quoted tilde-prefix" },
				{ src: "echo 'foo{a,b}'", why: "single-quoted braces mid-string" },
				{ src: "echo 'foo*'", why: "single-quoted * mid-string" },
				{ src: "echo 'foo[ab]'", why: "single-quoted [ab]" },
				{ src: "echo 'foo?'", why: "single-quoted ?" },
				{ src: "echo '<(pwd)'", why: "single-quoted procsub-syntax" },
				// echo '<(/bin/rm -rf $HOME)' intentionally NOT in
				// this list: V1's R5 hard-floor on `rm -rf` fires
				// regardless of quotes. V2's parser-proven branch
				// cannot promote a V1 never-auto-approve, by design.
				// This is the principled boundary -- single-quoted
				// literal data CAN'T be elevated over an R5 inner.
			];
			for (const { src, why } of mustAllow) {
				it(`ALLOW: ${src}`, async () => {
					const parsed = await helper.invoke({ command: src });
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

		// ----- Section C: Compound conservation -----
		// Original defects MUST stay closed. The 5-leaf user's
		// LIVE chain and the simple compound MUST ALLOW now via
		// parser-proven provenance + V1 allowlist promotion.
		describe("Section C: Compound conservation (parser-proven + V1 promotion)", () => {
			const compounds: ReadonlyArray<{ src: string; why: string }> = [
				{
					src: "git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v",
					why: "user's exact LIVE 5-leaf chain (parser-proven echo leaves + V1 host_safe_git_* leaves)",
				},
				{
					src: "echo '---BRANCH---' && git status --short",
					why: "simple compound (parser-proven echo + V1 host_safe_git_status)",
				},
				{
					src: "echo '---BRANCH---' && echo '<(touch /tmp/nope)' && echo '{a,b}' && echo '*'",
					why: "compound of all parser-proven static leaves",
				},
			];
			for (const { src, why } of compounds) {
				it(`ALLOW: ${src}`, async () => {
					const parsed = await helper.invoke({ command: src });
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

		// ----- Section D: Active-expansion in compound MUST ASK -----
		// The original defects must STAY closed: even with parser-
		// proven provenance active, a single unquoted active
		// expansion anywhere in the chain (in a leaf the V1
		// allowlist does NOT cover) MUST keep the verdict ASK.
		describe("Section D: Original defects stay closed (active expansion in any leaf)", () => {
			const mustAskCompounds: ReadonlyArray<{ src: string; why: string }> = [
				{
					src: "echo '---BRANCH---' && echo *",
					why: "trailing unquoted * (was LIVE-bug bypass; MUST ASK)",
				},
				{
					src: "echo '---BRANCH---' && echo {a,b}",
					why: "trailing unquoted {a,b} (was LIVE-bug bypass; MUST ASK)",
				},
				{
					src: "echo '---BRANCH---' && git branch -D __CLINEMM_SENTINEL__",
					why: "git branch -D is R5 hard-floor; MUST ASK / never-auto-approve",
				},
			];
			for (const { src, why } of mustAskCompounds) {
				it(`ASK: ${src}`, async () => {
					const parsed = await helper.invoke({ command: src });
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

		// ----- Section E: v3 helper emits protocolVersion=3 -----
		describe("Section E: v3 wire shape", () => {
			it("helper emits protocolVersion=3", async () => {
				const parsed = await helper.invoke({ command: "echo 'hi'" });
				expect(parsed).not.toBeNull();
				expect(parsed!.protocolVersion).toBe(3);
			});
			it("helper emits argProvenance with same length as args", async () => {
				const parsed = await helper.invoke({ command: "echo '*' 'foo' bar" });
				expect(parsed).not.toBeNull();
				const stmt = parsed!.program!.stmts[0];
				expect(stmt.kind).toBe("cmd");
				if (stmt.kind === "cmd") {
					expect(stmt.cmd.argProvenance).toBeDefined();
					expect(stmt.cmd.argProvenance!.length).toBe(stmt.cmd.args.length);
				}
			});
		});
		// ----- Section G: DblQuoted-context discriminator (PHASE 3 P1 fix) -----
		//
		// ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01-PHASE2-PROVENANCE01
		//   CORRECTION01 -- DblQuoted-context classification.
		//
		// The Phase 2 witness's Section B exercised ONLY single-quoted
		// literal data. CORRECTION01 surfaced that the same v3 classifier
		// was mis-classifying DOUBLE-QUOTED literal data as DYNAMIC,
		// because the bare-Lit byte scanner was being applied to nested
		// Lit inside "..." (where glob / brace / tilde are suppressed).
		//
		// This section is the bidirectional discriminator for the fix:
		// it asserts the parser-proven v3 classifier reports STATIC for
		// double-quoted literal data (no typed AST expansion), and
		// DYNAMIC for double-quoted forms that DO contain typed AST
		// expansions (ParamExp / CmdSubst / ArithmExp / ProcSubst /
		// ExtGlob / locale-translated $"...").
		const mustAllowDblQuoted: ReadonlyArray<{ src: string; why: string }> = [
			{ src: 'echo "*"', why: "DblQuoted glob char -- typed-AST expansion absent; was mis-classified DYNAMIC pre-fix" },
			{ src: 'echo "foo?"', why: "DblQuoted glob char mid-string" },
			{ src: 'echo "foo[ab]"', why: "DblQuoted bracket pattern" },
			{ src: 'echo "{a,b}"', why: "DblQuoted brace list" },
			{ src: 'echo "~"', why: "DblQuoted tilde" },
			{ src: 'echo "foo\\?"', why: "DblQuoted backslash-escape" },
			{ src: 'echo "foo\\*"', why: "DblQuoted backslash-escape glob" },
			{ src: 'echo ""', why: "empty DblQuoted" },
		];
		for (const { src, why } of mustAllowDblQuoted) {
			it(`ALLOW: ${src}`, async () => {
				const parsed = await helper.invoke({ command: src });
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

		const mustAskDblQuoted: ReadonlyArray<{ src: string; why: string }> = [
			{ src: 'echo "$HOME"', why: "DblQuoted ParamExp" },
			{ src: 'echo "$(pwd)"', why: "DblQuoted CmdSubst" },
			{ src: 'echo "$((1+2))"', why: "DblQuoted ArithmExp" },
			{ src: 'echo $"hello"', why: "Bash locale-translated DblQuoted (Dollar=true) -> DYNAMIC, fail closed" },
		];
		for (const { src, why } of mustAskDblQuoted) {
			it(`ASK: ${src}`, async () => {
				const parsed = await helper.invoke({ command: src });
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
	},
);

// ----- Section F: OLD PROTOCOL V2 FAILS CLOSED -----
// Point at the frozen-legacy v2 binary (lacking argProvenance, hash
// ce16966376... per LEGACY_HELPERS.txt) and prove the Section B
// inputs STILL ASK under v2. This is the
// fail-closed-on-old-helper guarantee that protects us if a v2
// helper somehow reappears (downgrade / rollback / cache).
const describeWithV2 = (
	legacyV2Present() && isSupportedPlatform ? describe : describe.skip
) as typeof describe;
function legacyV2Present(): boolean {
	// Section F proves v2 fail-closed behavior using the FROZEN
	// legacy binary at parser-helper-src/.factory/oracle/legacy-binaries/.
	// We do NOT use the vendored slot (it now holds v3).
	return V2_LEGACY_PATH !== null;
}
describeWithV2(
	"OLD v2 helper FAILS CLOSED (argProvenance absent -> no parser-proven promotion)",
	() => {
		let helperV2: MvdanShHelper;
		beforeAll(() => {
			helperV2 = new MvdanShHelper({
				platform: HELPER_PLATFORM as NonNullable<HelperPlatform>,
				binaryPath: () => V2_LEGACY_PATH as string,
			});
		});

		const mustAskUnderV2: ReadonlyArray<{ src: string; why: string }> = [
			{
				src: "echo '*'",
				why: "quoted glob char -- v2 has no argProvenance; parser-proven branch does NOT activate; V1 host_safe_echo ASK",
			},
			{
				src: "echo '{a,b}'",
				why: "quoted brace -- v2 fail-closed; V1 ASK",
			},
			{
				src: "echo '<(pwd)'",
				why: "quoted procsub syntax -- v2 fail-closed; V1 ASK",
			},
		];
		for (const { src, why } of mustAskUnderV2) {
			it("ASK under v2: " + src, async () => {
				const parsed = await helperV2.invoke({ command: src });
				expect(parsed).not.toBeNull();
				expect(parsed!.protocolVersion).toBe(2); // confirm v2
				const firstStmt = parsed!.program!.stmts[0];
				expect(firstStmt.kind).toBe("cmd");
				if (firstStmt.kind === "cmd") {
					// PHASE2-PROVENANCE01: under v2 the runtime
					// injects ["unknown"]* (fail-closed), so the
					// classifier's parser-proven branch is GUARANTEED
					// not to activate. The field is present (length
					// matches args) but every entry is "unknown".
					const prov = firstStmt.cmd.argProvenance;
					expect(prov).toBeDefined();
					expect(prov!.length).toBe(firstStmt.cmd.args.length);
					expect(prov!.every((p) => p === "unknown")).toBe(true);
				}
				const r = evaluateCommandRiskWithParser({
					toolInput: src,
					hostAuthorization: SAFE,
					parserResult: parsed,
				});
				expect(
					r.decision === "ask" || r.disposition === "never-auto-approve",
					`Expected ASK/never-auto-approve under v2 for "${src}" (${why}). Got decision=${r.decision} disposition=${r.disposition} source=${r.source}.`,
				).toBe(true);
			});
		}
	},
);
