// Section header intentionally without backticks so oxc parses it cleanly.

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { arch as processArch, platform as processPlatform } from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { commandHostAuthorization } from "./command-policy-types";
import { evaluateCommandRiskWithParser } from "./command-risk-internal";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import { MvdanShHelper } from "./parser-helper/runtime";
import type {
	ParsedShell,
	StructuredCmd,
	StructuredStmt,
} from "./structured-command-risk";
import { sha256Hex } from "./structured-command-risk";

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
const describeWithHelper = (
	isSupportedHelperPlatform ? describe : describe.skip
) as typeof describe;

const SAFE_NO_EVIDENCE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});

function mkFindShell(
	toolInput: string,
	args: ReadonlyArray<string>,
	argProvenance: ReadonlyArray<"static" | "dynamic" | "unknown">,
	protocolVersion: 2 | 3 | 4 = 4,
): ParsedShell {
	const cmd: StructuredCmd = {
		name: "find",
		args,
		argProvenance,
		assigns: [],
		redirects: [],
		isWrapper: false,
		wrapperOf: "",
		inner: "",
	};
	const stmt: StructuredStmt = { kind: "cmd", cmd };
	return {
		protocolVersion,
		dialect: "bash",
		sourceSha256: sha256Hex(toolInput),
		parseStatus: "complete",
		hasCommandSubstitution: false,
		program: { stmts: [stmt] },
		errors: [],
	};
}

// =====================================================================
// Section A: helper-level discriminant (REAL)
// =====================================================================

describeWithHelper(
	"structured-command-risk - REAL parser-helper: quoted-find pattern discriminant",
	() => {
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

		it("find . -name '*.ts -> all-static", async () => {
			const r = await helper.invoke({ command: "find . -name '*.ts'" });
			expect(r).not.toBeNull();
			expect(r!.protocolVersion).toBe(4);
			expect(r!.parseStatus).toBe("complete");
			const stmt = r!.program!.stmts[0]!;
			if (stmt.kind !== "cmd") throw new Error("expected cmd stmt");
			expect(stmt.cmd.name).toBe("find");
			expect(stmt.cmd.args).toEqual([".", "-name", "*.ts"]);
			expect(stmt.cmd.argProvenance).toEqual(["static", "static", "static"]);
		});

		it('find . -name "*.ts -> all-static', async () => {
			const r = await helper.invoke({ command: 'find . -name "*.ts"' });
			expect(r).not.toBeNull();
			const stmt = r!.program!.stmts[0]!;
			if (stmt.kind !== "cmd") throw new Error("expected cmd stmt");
			expect(stmt.cmd.args).toEqual([".", "-name", "*.ts"]);
			expect(stmt.cmd.argProvenance).toEqual(["static", "static", "static"]);
		});

		it("find . -name *.ts -> unquoted glob is dynamic", async () => {
			const r = await helper.invoke({ command: "find . -name *.ts" });
			expect(r).not.toBeNull();
			const stmt = r!.program!.stmts[0]!;
			if (stmt.kind !== "cmd") throw new Error("expected cmd stmt");
			expect(stmt.cmd.args).toEqual([".", "-name", "*.ts"]);
			expect(stmt.cmd.argProvenance).toEqual(["static", "static", "dynamic"]);
		});

		it("find . -path '*/src/*.ts -> all-static", async () => {
			const r = await helper.invoke({ command: "find . -path '*/src/*.ts'" });
			expect(r).not.toBeNull();
			const stmt = r!.program!.stmts[0]!;
			if (stmt.kind !== "cmd") throw new Error("expected cmd stmt");
			expect(stmt.cmd.args).toEqual([".", "-path", "*/src/*.ts"]);
			expect(stmt.cmd.argProvenance).toEqual(["static", "static", "static"]);
		});

		it('find . -path "*/src/*.ts -> all-static', async () => {
			const r = await helper.invoke({ command: 'find . -path "*/src/*.ts"' });
			expect(r).not.toBeNull();
			const stmt = r!.program!.stmts[0]!;
			if (stmt.kind !== "cmd") throw new Error("expected cmd stmt");
			expect(stmt.cmd.args).toEqual([".", "-path", "*/src/*.ts"]);
			expect(stmt.cmd.argProvenance).toEqual(["static", "static", "static"]);
		});

		it("find . -path */src/*.ts -> unquoted glob is dynamic", async () => {
			const r = await helper.invoke({ command: "find . -path */src/*.ts" });
			expect(r).not.toBeNull();
			const stmt = r!.program!.stmts[0]!;
			if (stmt.kind !== "cmd") throw new Error("expected cmd stmt");
			expect(stmt.cmd.args).toEqual([".", "-path", "*/src/*.ts"]);
			expect(stmt.cmd.argProvenance).toEqual(["static", "static", "dynamic"]);
		});

		it('find . -name "$PATTERN -> double-quoted ParamExp is dynamic', async () => {
			const r = await helper.invoke({ command: 'find . -name "$PATTERN"' });
			expect(r).not.toBeNull();
			expect(r!.hasCommandSubstitution).toBe(false);
			const stmt = r!.program!.stmts[0]!;
			if (stmt.kind !== "cmd") throw new Error("expected cmd stmt");
			expect(stmt.cmd.args).toEqual([".", "-name", "${...}"]);
			expect(stmt.cmd.argProvenance).toEqual(["static", "static", "dynamic"]);
		});

		it("find . -name $(printf '*.ts') -> hasCommandSubstitution=true", async () => {
			const r = await helper.invoke({
				command: "find . -name $(printf '*.ts')",
			});
			expect(r).not.toBeNull();
			expect(r!.hasCommandSubstitution).toBe(true);
			const stmt = r!.program!.stmts[0]!;
			if (stmt.kind !== "cmd") throw new Error("expected cmd stmt");
			expect(stmt.cmd.argProvenance![2]).toBe("dynamic");
		});

		it("find . -name '*.ts' -delete -> pattern static, -delete static", async () => {
			const r = await helper.invoke({ command: "find . -name '*.ts' -delete" });
			expect(r).not.toBeNull();
			const stmt = r!.program!.stmts[0]!;
			if (stmt.kind !== "cmd") throw new Error("expected cmd stmt");
			expect(stmt.cmd.args).toEqual([".", "-name", "*.ts", "-delete"]);
			expect(stmt.cmd.argProvenance).toEqual([
				"static",
				"static",
				"static",
				"static",
			]);
		});
	},
);

// =====================================================================
// Section B: production-seam RED (current behavior = ASK)
// =====================================================================

describeWithHelper(
	"structured-command-risk - REAL parser-helper v4 end-to-end: quoted-find (RED)",
	() => {
		let helper: MvdanShHelper;
		let workspaceDir: string;
		let workspaceCanonical: string;

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

			workspaceDir = mkdtempSync(join(tmpdir(), "cline-find-quoted-"));
			workspaceCanonical = realpathSync(workspaceDir);
			const commandPolicyDir = join(workspaceDir, "command-policy");
			mkdirSync(commandPolicyDir, { recursive: true });
			writeFileSync(join(commandPolicyDir, "sample.test.ts"), "// sentinel\n");
		});

		afterAll(() => {
			try {
				require("node:fs").rmSync(workspaceDir, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		});

		it('CONSERVATION (no-evidence): find . -name "*.test.ts" -path "*command-policy*" -> ASK', async () => {
			const cmd = 'find . -name "*.test.ts" -path "*command-policy*"';
			const parsed = await helper.invoke({ command: cmd });
			expect(parsed).not.toBeNull();
			expect(parsed!.protocolVersion).toBe(4);
			expect(parsed!.parseStatus).toBe("complete");
			expect(parsed!.hasCommandSubstitution).toBe(false);

			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			// Without evidence, the path-bearing gate refuses
			// to promote even parser-proven leaves. The
			// conservation invariant is: path-bearing commands
			// always ASK in the absence of canonical
			// workspace-bound evidence.
			expect(r.decision).toBe("ask");
			expect(r.disposition).not.toBe("auto-approve-eligible");
		});

		it('PROBE: same LIVE-failing command -> parser-proven static on every arg', async () => {
			const cmd = 'find . -name "*.test.ts" -path "*command-policy*"';
			const parsed = await helper.invoke({ command: cmd });
			expect(parsed).not.toBeNull();
			const stmt = parsed!.program!.stmts[0]!;
			if (stmt.kind !== "cmd") throw new Error("expected cmd stmt");
			expect(stmt.cmd.name).toBe("find");
			expect(stmt.cmd.args).toEqual([
				".",
				"-name",
				"*.test.ts",
				"-path",
				"*command-policy*",
			]);
			expect(stmt.cmd.argProvenance).toEqual([
				"static",
				"static",
				"static",
				"static",
				"static",
			]);
		});

		it('CONSERVATION (no-evidence pipeline): find . -name "*.test.ts" -path "*command-policy*" | head -20 -> ASK', async () => {
			const cmd = 'find . -name "*.test.ts" -path "*command-policy*" | head -20';
			const parsed = await helper.invoke({ command: cmd });
			expect(parsed).not.toBeNull();
			expect(parsed!.parseStatus).toBe("complete");

			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			// Same conservation invariant for the pipeline
			// form: path-bearing gate refuses without evidence.
			expect(r.decision).toBe("ask");
			expect(r.disposition).not.toBe("auto-approve-eligible");
		});

		it('GREEN (with path-authority evidence, full pipeline): quoted find | head -> ALLOW + auto-approve-eligible', async () => {
			const cmd = 'find . -name "*.test.ts" -path "*command-policy*" | head -20';
			const parsed = await helper.invoke({ command: cmd });
			expect(parsed).not.toBeNull();

			const { buildPathAuthorityEvidence } = await import(
				"./path-authority-evidence-builder"
			);
			const evidenceResult = buildPathAuthorityEvidence({
				command: cmd,
				cwd: workspaceCanonical,
				workspaceRoots: [workspaceCanonical],
			});
			// P1 fix: buildPathAuthorityEvidence failures must NOT silently
			// make the test pass. The CORRECTION04 invariant requires
			// constructed authoritative evidence; absence is a witness
			// failure, not a passthrough.
			expect(evidenceResult.ok).toBe(true);
			if (!evidenceResult.ok) {
				throw new Error(
					`buildPathAuthorityEvidence failed: ${evidenceResult.reason}`,
				);
			}

			// P1 fix: bind workspaceRoots + cwd into the authorization
			// context so the R0 path-bearing gate sees the canonical
			// context. Without this, the existence of evidence alone
			// does not constitute a witness.
			const SAFE_WITH_EVIDENCE = commandHostAuthorization({
				mode: "safe-only",
				explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
				workspaceRoots: [workspaceCanonical],
				cwd: workspaceCanonical,
				pathAuthorityEvidence: evidenceResult.evidence,
			});

			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_WITH_EVIDENCE,
				parserResult: parsed,
			});
			// GREEN (post-C2): the V2 parser-proven promotion branch
			// sees `find` with all-static argProvenance, the per-cmd
			// validator accepts the argv shape (only `-name PATTERN`
			// and `-path PATTERN` predicates), the find-specific
			// authority-operand extractor returns only the search
			// root `.` (NOT the quoted pattern strings), and the
			// R0 path-bearing gate binds `.` to the evidence's
			// resolved canonical workspace path. The full pipeline
			// promotes the pipe-find-leaf to ALLOW +
			// auto-approve-eligible.
			expect(r.decision).toBe("allow");
			expect(r.disposition).toBe("auto-approve-eligible");
		});

		it("CONSERVATION: find . -name *.ts (unquoted glob) -> ASK", async () => {
			const cmd = "find . -name *.ts";
			const parsed = await helper.invoke({ command: cmd });
			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			expect(r.decision).toBe("ask");
		});

		it('CONSERVATION: find . -name "$PATTERN" (dynamic double-quoted) -> ASK', async () => {
			const cmd = 'find . -name "$PATTERN"';
			const parsed = await helper.invoke({ command: cmd });
			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			expect(r.decision).toBe("ask");
		});

		it("CONSERVATION: find . -name $(printf '*.ts') (cmd subst) -> ASK", async () => {
			const cmd = "find . -name $(printf '*.ts')";
			const parsed = await helper.invoke({ command: cmd });
			expect(parsed!.hasCommandSubstitution).toBe(true);
			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			expect(r.decision).toBe("ask");
		});

		it("CONSERVATION: find . -name '*.ts' -delete -> ASK (V1 rejects -delete)", async () => {
			const cmd = "find . -name '*.ts' -delete";
			const parsed = await helper.invoke({ command: cmd });
			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			expect(r.decision).toBe("ask");
		});

		it("CONSERVATION: find . -name '*.ts' -exec rm {} ; -> ASK (V1 rejects -exec)", async () => {
			const cmd = "find . -name '*.ts' -exec rm {} ;";
			const parsed = await helper.invoke({ command: cmd });
			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			expect(r.decision).toBe("ask");
		});

		it("CONSERVATION: find . -name '*.ts' | sh -> ASK (pipe to interactive shell)", async () => {
			const cmd = "find . -name '*.ts' | sh";
			const parsed = await helper.invoke({ command: cmd });
			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			expect(r.decision).toBe("ask");
		});

		it("CONSERVATION: find /outside -name '*.ts' -> ASK (path authority refuses)", async () => {
			const cmd = "find /outside -name '*.ts'";
			const parsed = await helper.invoke({ command: cmd });
			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			expect(r.decision).toBe("ask");
		});

		// HALT_FIND_DOUBLE_DASH_ACTION_ALIAS (CORRECTION01): GNU
		// find does NOT honor `--` as an end-of-options
		// terminator for "everything-after-is-roots"; a command
		// like `find -- root -delete` is interpreted by GNU find
		// as `root` (search root) plus `-delete` (the
		// destructive expression action). The parser-proven
		// branch must reject `--` so a literal path-named
		// `-delete` file inside the workspace cannot be bound
		// as a path-authority operand while GNU find actually
		// executes the destructive action. We pin the
		// adversarial witness (with synthetic evidence
		// pre-binding every argv token as a workspace-conforming
		// path, so a regression to ALLOW would unambiguously
		// surface as the bypass the reviewer identified).
		it("P0 ADVERSARIAL: find -- root -delete -> ASK (with pre-bound evidence, RED before CORRECTION01)", async () => {
			const cmd = "find -- root -delete";
			const parsed = await helper.invoke({ command: cmd });
			expect(parsed).not.toBeNull();
			// All three argv tokens are parser-proven `static`:
			expect(parsed!.program!.stmts[0]!.cmd.argProvenance).toEqual([
				"static",
				"static",
				"static",
			]);

			// Synthetic evidence pre-binding every argv token as
			// a workspace-conforming path. Pre-CORRECTION01
			// this evaluates to `allow / auto-approve-eligible`;
			// post-CORRECTION01 the validator rejects `--`,
			// the leaf is `host_mode_safe_only_fallthrough`,
			// and the verdict reverts to ASK.
			const evidence = {
				roots: [workspaceCanonical],
				cwd: workspaceCanonical,
				operands: [
					{
						operand: "--",
						resolvedRealPath: `${workspaceCanonical}/--`,
						contained: true,
						reason: "resolved-and-contained" as const,
					},
					{
						operand: "root",
						resolvedRealPath: `${workspaceCanonical}/root`,
						contained: true,
						reason: "resolved-and-contained" as const,
					},
					{
						operand: "-delete",
						resolvedRealPath: `${workspaceCanonical}/-delete`,
						contained: true,
						reason: "resolved-and-contained" as const,
					},
				],
			};
			const SAFE_BOUND = commandHostAuthorization({
				mode: "safe-only",
				explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
				workspaceRoots: [workspaceCanonical],
				cwd: workspaceCanonical,
				pathAuthorityEvidence: evidence,
			});

			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_BOUND,
				parserResult: parsed,
			});
			expect(r.decision).toBe("ask");
			expect(r.disposition).toBe("ask");
		});

		it("P0 ADVERSARIAL: find -- . -name '*.ts' -> ASK (rejected outright)", async () => {
			const cmd = "find -- . -name '*.ts'";
			const parsed = await helper.invoke({ command: cmd });
			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			// CORRECTION01 precision loss: this command would
			// semantically succeed (root `.`, single `-name`
			// predicate, static pattern) under GNU find, but
			// `--` makes the grammar ambiguous and we reject
			// it for this ACT. GNU itself recommends
			// `./...` or absolute pathnames for dubious
			// starting points rather than `--`.
			expect(r.decision).toBe("ask");
		});

		it("P0 ADVERSARIAL: extractFindSearchRoots breaks on -- (no fallthrough into action territory)", async () => {
			const { extractR0PathOperands } = await import(
				"./path-authority"
			);
			// V1 mirror extractor: even if some future caller
			// bypasses the validator, the extractor must NOT
			// collect tokens after `--` as roots.
			expect(
				extractR0PathOperands(
					"find -- root -delete",
					"host_safe_find_parser_proven_static_patterns",
				),
			).toEqual([]);
		});

		// Section D (P1 fix): Pinned mechanical probe of the operand
		// extractor + path-authority evidence builder for the exact
		// LIVE-failing command. Pre-C2: this probe EXPECTS the bug
		// (the generic extractor treats patterns as path candidates),
		// so C2 must add a find-specific operand extractor OR the
		// probe must be updated to assert the new shape. We pin
		// both as observable evidence so the C2 fix is mechanical.
		it("PROBE: extractR0PathOperands for parser-proven find drops pattern operands", async () => {
			const { extractR0PathOperands } = await import(
				"./path-authority"
			);
			const cmd = 'find . -name "*.test.ts" -path "*command-policy*"';
			const operands = extractR0PathOperands(
				cmd,
				"host_safe_find_parser_proven_static_patterns",
			);

			// C2 invariant: the parser-proven V2 find source
			// uses the precise find-specific extractor. The
			// pattern strings are NOT authority operands (they
			// are find expression predicates, not files).
			expect(operands).toEqual(["."]);

			// V1 (`host_safe_find`) keeps the historical
			// generic-fallback shape (operand list includes the
			// quoted pattern strings) -- this is preserved so the
			// V1 corpus fixtures continue to pass. The V2
			// source's precise shape is the bounded C2 fix.
			const operandsV1 = extractR0PathOperands(cmd, "host_safe_find");
			expect(operandsV1).toEqual(['.', '"*.test.ts"', '"*command-policy*"']);
		});

		it("PROBE: extractR0PathOperands for parser-proven find (multi-root variant)", async () => {
			const { extractR0PathOperands } = await import(
				"./path-authority"
			);
			// Multiple search roots: find processes each in
			// argv order. All are authority operands;
			// pattern strings after the first option are NOT.
			const cmd =
				"find src lib -name '*.ts' -path '*/test/*' -name '*.tsx'";
			const operands = extractR0PathOperands(
				cmd,
				"host_safe_find_parser_proven_static_patterns",
			);
			expect(operands).toEqual(["src", "lib"]);
		});

		it("PROBE: path-authority-evidence-builder for quoted-find with canonical context", async () => {
			const { buildPathAuthorityEvidence } = await import(
				"./path-authority-evidence-builder"
			);
			const cmd = 'find . -name "*.test.ts" -path "*command-policy*"';
			const result = buildPathAuthorityEvidence({
				command: cmd,
				cwd: workspaceCanonical,
				workspaceRoots: [workspaceCanonical],
			});
			// P1: buildPathAuthorityEvidence must succeed (with
			// canonical evidence) for the test workspace. If it
			// fails, the R0 path-bearing gate cannot fire -- and
			// ANY future C2 promotion that relies on path
			// authority is moot.
			expect(result.ok).toBe(true);
			if (!result.ok) {
				throw new Error(
					`buildPathAuthorityEvidence failed: ${result.reason}`,
				);
			}
			// C2: the evidence record contains the search root `.` as a
			// resolved, contained operand. The V1 evidence builder
			// additionally enumerates the pattern strings via the
			// generic fallback (since the bash-quoted find does
			// not match any V1 safe rule), and those extra entries
			// fail realpath; this is harmless to the path-bearing
			// binder because the V2 walker only emits structured
			// operands through the per-source extractor
			// (find-specific -> search roots only), and the binder
			// only requires every leaf operand to have a bound
			// evidence entry -- presence of extra unrelated
			// evidence entries does not affect binding. We pin the
			// load-bearing observable: search root `.` is resolved
			// AND contained.
			const rootEvidence = result.evidence!.operands.find(
				(o) => o.operand === ".",
			);
			expect(rootEvidence).toBeDefined();
			expect(rootEvidence!.resolvedRealPath).not.toBeNull();
			expect(rootEvidence!.contained).toBe(true);
		});
	},
);

// =====================================================================
// Section C: synthetic-TS (independent of helper binary)
// =====================================================================

describe("structured-command-risk - synthetic-TS find-proven-pattern", () => {
	it("SYNTHETIC-TS NO-EVIDENCE: find . -name '*.ts' all-static -> ASK (path gate refuses)", () => {
		const cmd = "find . -name '*.ts'";
		const parsed = mkFindShell(cmd, [".", "-name", "*.ts"], [
			"static",
			"static",
			"static",
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE_NO_EVIDENCE,
			parserResult: parsed,
		});
		// V2 promotion requires path-bearing evidence. Without
		// evidence the gate refuses (the parser-proven branch
		// returns auto-approve-eligible, but `promoteToAllow`
		// is downgraded by `pathBearingEvidenceMissing`).
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it('SYNTHETIC-TS NO-EVIDENCE: find . -name "*.ts" all-static -> ASK (path gate refuses)', () => {
		const cmd = 'find . -name "*.ts"';
		const parsed = mkFindShell(cmd, [".", "-name", "*.ts"], [
			"static",
			"static",
			"static",
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE_NO_EVIDENCE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("SYNTHETIC-TS WITH-EVIDENCE: find . -name '*.ts' all-static -> ALLOW + auto-approve-eligible", () => {
		const cmd = "find . -name '*.ts'";
		const parsed = mkFindShell(cmd, [".", "-name", "*.ts"], [
			"static",
			"static",
			"static",
		]);
		// Synthetic path-bearing evidence for `.` resolved to a
		// canonical workspace path. Bound to workspaceRoots + cwd
		// per CORRECTION04.
		const SYNTHETIC_ROOT = "/tmp/synthetic-workspace-root";
		const evidence = {
			roots: [SYNTHETIC_ROOT],
			cwd: SYNTHETIC_ROOT,
			operands: [
				{
					operand: ".",
					resolvedRealPath: SYNTHETIC_ROOT,
					contained: true,
					reason: "resolved-and-contained" as const,
				},
			],
		};
		const SAFE_WITH_EVIDENCE = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [SYNTHETIC_ROOT],
			cwd: SYNTHETIC_ROOT,
			pathAuthorityEvidence: evidence,
		});
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE_WITH_EVIDENCE,
			parserResult: parsed,
		});
		// Post-C2 GREEN: V2 promotion succeeds when the V2
		// classifier emits a parser-proven find leaf AND the
		// structured-extracted search root `.` is bound to the
		// evidence record.
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("SYNTHETIC-TS CONSERVATION: find . -name *.ts (dynamic) -> ASK", () => {
		const cmd = "find . -name *.ts";
		const parsed = mkFindShell(cmd, [".", "-name", "*.ts"], [
			"static",
			"static",
			"dynamic",
		]);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE_NO_EVIDENCE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});

	it("SYNTHETIC-TS CONSERVATION: v2 helper (argProvenance=unknown) -> ASK (fail-closed)", () => {
		const cmd = "find . -name '*.ts'";
		const parsed: ParsedShell = mkFindShell(
			cmd,
			[".", "-name", "*.ts"],
			["unknown", "unknown", "unknown"],
		);
		const r = evaluateCommandRiskWithParser({
			toolInput: cmd,
			hostAuthorization: SAFE_NO_EVIDENCE,
			parserResult: parsed,
		});
		expect(r.decision).toBe("ask");
	});
});
