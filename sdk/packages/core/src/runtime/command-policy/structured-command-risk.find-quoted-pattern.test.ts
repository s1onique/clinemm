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
	"structured-command-risk - REAL parser-helper V2 end-to-end: quoted-find (RED)",
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

		it('RED: find . -name "*.test.ts" -path "*command-policy*" -> ASK', async () => {
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

		it('RED (pipeline): find . -name "*.test.ts" -path "*command-policy*" | head -20 -> ASK', async () => {
			const cmd = 'find . -name "*.test.ts" -path "*command-policy*" | head -20';
			const parsed = await helper.invoke({ command: cmd });
			expect(parsed).not.toBeNull();
			expect(parsed!.parseStatus).toBe("complete");

			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_NO_EVIDENCE,
				parserResult: parsed,
			});
			expect(r.decision).toBe("ask");
			expect(r.disposition).not.toBe("auto-approve-eligible");
		});

		it('RED (with path-authority evidence): same command -> ASK today, ALLOW post-C2', async () => {
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
			if (!evidenceResult.ok) {
				return;
			}

			const SAFE_WITH_EVIDENCE = commandHostAuthorization({
				mode: "safe-only",
				explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
				pathAuthorityEvidence: evidenceResult.evidence,
			});

			const r = evaluateCommandRiskWithParser({
				toolInput: cmd,
				hostAuthorization: SAFE_WITH_EVIDENCE,
				parserResult: parsed,
			});
			expect(r.decision).toBe("ask");
			expect(r.disposition).not.toBe("auto-approve-eligible");
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
	},
);

// =====================================================================
// Section C: synthetic-TS (independent of helper binary)
// =====================================================================

describe("structured-command-risk - synthetic-TS find-proven-pattern", () => {
	it("SYNTHETIC-TS: find . -name '*.ts' all-static -> ALLOW post-C2 (RED today)", () => {
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
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it('SYNTHETIC-TS: find . -name "*.ts" all-static -> ALLOW post-C2 (RED today)', () => {
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
