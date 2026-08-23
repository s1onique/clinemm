/**
 * V1 independence — prove the catastrophic floor holds when V2 is unavailable.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01
 *
 * The V2 parser-assisted classifier is layered ON TOP of V1. V1's
 * catastrophic hard floor (R5) MUST hold regardless of whether the
 * parser helper is available, present, or wired. This file freezes
 * that invariant: even with `parserResult: undefined` (V2 dormant),
 * the canonical red cases remain ASK + never-auto-approve.
 *
 * These are the load-bearing R5 corpus cases from
 * `command-risk-corpus.ts`. They MUST pass under:
 *
 *   - public `evaluateCommandRisk` (V1-only by type contract)
 *   - internal `evaluateCommandRiskWithParser` with parserResult: undefined
 *   - internal `evaluateCommandRiskWithParser` with parserResult: null
 *   - internal `evaluateCommandRiskWithParser` with parserResult: any fake AST
 *
 * Each red case is asserted through every entry point. If the
 * catastrophic floor ever weakens, one of these will flip and the
 * test will fail.
 */

import { describe, expect, it } from "vitest";

import {
	type CommandHostAuthorization,
	commandHostAuthorization,
} from "./command-policy-types";
import { evaluateCommandRisk } from "./command-risk";
import type { ParsedShell } from "./command-risk-internal";
import { evaluateCommandRiskWithParser } from "./command-risk-internal";

const ALL: CommandHostAuthorization = commandHostAuthorization({ mode: "all" });

const R5_RED_CASES: ReadonlyArray<{ command: string; family: string }> = [
	{ command: "rm -rf $HOME", family: "home-destruction" },
	{ command: "rm -rf /", family: "root-destruction" },
	{ command: "rm -rf ..", family: "parent-destruction" },
	{ command: "rm -rf ~/.ssh", family: "sensitive-home-deletion" },
	{ command: "tee /etc/hosts", family: "system-file-write" },
	{ command: "echo x | sudo tee /etc/passwd", family: "system-file-write" },
];

const fakeSafeShell: ParsedShell = {
	protocolVersion: 2,
	dialect: "bash",
	sourceSha256: "0".repeat(64),
	parseStatus: "complete",
	hasCommandSubstitution: false,
	program: { stmts: [] },
	errors: [],
};

describe("V1 independence — ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01", () => {
	for (const c of R5_RED_CASES) {
		it(`[public] ${c.family}: ${c.command} stays ASK + never-auto-approve when V2 is dormant`, () => {
			const r = evaluateCommandRisk({
				toolInput: c.command,
				hostAuthorization: ALL,
			});
			expect(r.decision).toBe("ask");
			expect(r.disposition).toBe("never-auto-approve");
		});

		it(`[internal undefined] ${c.family}: ${c.command} stays ASK + never-auto-approve when V2 is dormant`, () => {
			const r = evaluateCommandRiskWithParser({
				toolInput: c.command,
				hostAuthorization: ALL,
				parserResult: undefined,
			});
			expect(r.decision).toBe("ask");
			expect(r.disposition).toBe("never-auto-approve");
		});

		it(`[internal null] ${c.family}: ${c.command} stays ASK + never-auto-approve`, () => {
			const r = evaluateCommandRiskWithParser({
				toolInput: c.command,
				hostAuthorization: ALL,
				parserResult: null,
			});
			expect(r.decision).toBe("ask");
			expect(r.disposition).toBe("never-auto-approve");
		});

		it(`[internal fake-AST] ${c.family}: ${c.command} stays ASK + never-auto-approve even with hostile AST`, () => {
			const r = evaluateCommandRiskWithParser({
				toolInput: c.command,
				hostAuthorization: ALL,
				parserResult: fakeSafeShell,
			});
			expect(r.decision).toBe("ask");
			expect(r.disposition).toBe("never-auto-approve");
		});
	}
});
