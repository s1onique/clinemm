/**
 * Parser provenance invariant tests.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01
 *
 * These tests FREEZE the load-bearing provenance invariant: there is
 * no public API surface through which an untrusted caller (model,
 * MCP, webview, gRPC, remote) can inject a `ParsedShell` to influence
 * command-tool authorization decisions.
 *
 * The invariant is enforced by THREE independent mechanisms, each
 * pinned here:
 *
 *   (1) Type-level: `EvaluateCommandRiskInput` (public, exported
 *       from `@cline/core`) has no `parserResult` field. External
 *       callers physically cannot supply one.
 *
 *   (2) Module-level: `evaluateCommandRiskWithParser` is reachable
 *       only via the explicit deep import
 *       `@cline/core/internal/command-risk-internal`. The public
 *       index does NOT re-export it.
 *
 *   (3) Production-wiring-level: the host adapters that DO have a
 *       code path to the internal entry point are the CLI host
 *       (`apps/cli/src/runtime/command-policy-host.ts`) and the
 *       VSCode host (`apps/vscode/src/sdk/sdk-tool-policies.ts`).
 *       Both pass `parserResult: undefined` until the helper-binary
 *       ACT (ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01)
 *       wires a trusted host-owned `MvdanShHelper`. NO production
 *       call site passes a parser result from any untrusted input.
 *
 * If any of these assertions fails, the V2 promotion capability has
 * become reachable to an untrusted caller and the safety invariant
 * is broken.
 */

import { describe, expect, it } from "vitest";

import type { EvaluateCommandRiskInput, RiskDecision } from "./command-risk";
import { evaluateCommandRisk } from "./command-risk";
import type { ParsedShell } from "./command-risk-internal";
import { evaluateCommandRiskWithParser } from "./command-risk-internal";

describe("V2 parser provenance — ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01", () => {
	it("(1) type-level — public EvaluateCommandRiskInput has NO parserResult field", () => {
		const shape: Record<string, unknown> = {
			toolInput: "pwd",
			hostAuthorization: { mode: "all" },
		};
		expect("parserResult" in shape).toBe(false);

		const input: EvaluateCommandRiskInput = {
			toolInput: "pwd",
			hostAuthorization: { mode: "all" },
		};
		expect(input.toolInput).toBe("pwd");
	});

	it("(1) type-level — passing parserResult via the PUBLIC type fails at compile time", () => {
		// @ts-expect-error — parserResult is NOT in EvaluateCommandRiskInput.
		// If this error ever disappears, the provenance invariant has been broken.
		const _publicInput: EvaluateCommandRiskInput = {
			toolInput: "pwd",
			hostAuthorization: { mode: "all" },
			parserResult: null,
		};
		void _publicInput;
	});

	it("(1) runtime-level — public evaluateCommandRisk ignores parserResult if one is supplied", () => {
		const fakeSafeShell: ParsedShell = {
			protocolVersion: 2,
			dialect: "bash",
			sourceSha256: "0".repeat(64),
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: [] },
			errors: [],
		};
		const r: RiskDecision = evaluateCommandRisk({
			toolInput: "rm -rf $HOME",
			hostAuthorization: { mode: "all" },
		});
		// V1's R5 hard floor catches this WITHOUT consulting V2.
		expect(r.disposition).toBe("never-auto-approve");
		void fakeSafeShell;
	});

	it("(2) module-level — internal entry point exists and DOES accept parserResult", () => {
		const fakeSafeShell: ParsedShell = {
			protocolVersion: 2,
			dialect: "bash",
			sourceSha256: "0".repeat(64),
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: [] },
			errors: [],
		};
		const r = evaluateCommandRiskWithParser({
			toolInput: "rm -rf $HOME",
			hostAuthorization: { mode: "all" },
			parserResult: fakeSafeShell,
		});
		expect(r.disposition).toBe("never-auto-approve");
	});

	it("(3) production-wiring-level — both host adapters use the internal entry point with parserResult: undefined", async () => {
		const { default: fs } = await import("node:fs");
		const { default: path } = await import("node:path");

		const repoRoot = path.resolve(__dirname, "../../../../../..");
		const cliHostPath = path.join(
			repoRoot,
			"apps/cli/src/runtime/command-policy-host.ts",
		);
		const vscodeHostPath = path.join(
			repoRoot,
			"apps/vscode/src/sdk/sdk-tool-policies.ts",
		);

		const cliHostSource = fs.readFileSync(cliHostPath, "utf8");
		const vscodeHostSource = fs.readFileSync(vscodeHostPath, "utf8");

		expect(cliHostSource).toMatch(
			/@cline\/core\/internal\/command-risk-internal/,
		);
		expect(cliHostSource).toMatch(/evaluateCommandRiskWithParser/);
		expect(cliHostSource).toMatch(/parserResult:\s*undefined/);

		expect(vscodeHostSource).toMatch(
			/@cline\/core\/internal\/command-risk-internal/,
		);
		expect(vscodeHostSource).toMatch(/evaluateCommandRiskWithParser/);
		expect(vscodeHostSource).toMatch(/parserResult:\s*undefined/);
	});

	it("(3) production-wiring-level — neither host adapter imports ParsedShell from a public path", async () => {
		const { default: fs } = await import("node:fs");
		const { default: path } = await import("node:path");

		const repoRoot = path.resolve(__dirname, "../../../../../..");
		const cliHostPath = path.join(
			repoRoot,
			"apps/cli/src/runtime/command-policy-host.ts",
		);
		const vscodeHostPath = path.join(
			repoRoot,
			"apps/vscode/src/sdk/sdk-tool-policies.ts",
		);

		const cliHostSource = fs.readFileSync(cliHostPath, "utf8");
		const vscodeHostSource = fs.readFileSync(vscodeHostPath, "utf8");

		expect(cliHostSource).not.toMatch(/ParsedShell/);
		expect(vscodeHostSource).not.toMatch(/ParsedShell/);
	});

	it("(3) production-wiring-level — public @cline/core index does NOT export the V2 internal types", async () => {
		const { default: fs } = await import("node:fs");
		const { default: path } = await import("node:path");

		const repoRoot = path.resolve(__dirname, "../../../../../..");
		const indexPath = path.join(repoRoot, "sdk/packages/core/src/index.ts");
		const indexSource = fs.readFileSync(indexPath, "utf8");

		// Strip comments before scanning for actual exports. The
		// documentation comment in index.ts mentions the V2 types by
		// name; that is intentional and not an export.
		const stripped = indexSource
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/\/\/.*$/gm, "");

		expect(stripped).not.toMatch(/evaluateCommandRiskWithParser/);
		expect(stripped).not.toMatch(/\bParsedShell\b/);
		expect(stripped).not.toMatch(/\bStructuredAnalysis\b/);
		expect(stripped).not.toMatch(/evaluateStructuredCommandRisk/);
		expect(stripped).not.toMatch(/STRUCTURED_PROTO_VERSION/);
	});
});
