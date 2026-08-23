/**
 * V2 Structured Classifier — Attack Regression Suite
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-CORRECTION01
 *
 * This file freezes the reviewer attacks documented in
 * `.factory/evidence/act-command-risk-classification02-correction01/
 *  02-p0-defects-verified.md`. Each test must fail without the
 * CORRECTION01 fixes and pass with them. These are the load-bearing
 * authorization-boundary invariants.
 *
 * P0 attacks:
 *   1. Redirects ignored => sensitive-target write becomes ALLOW.
 *   2. Parser result not bound to source => arbitrary AST authorizes.
 *   3. Promotion gate too broad => unknown command (no structure)
 *      gets promoted to ALLOW.
 *
 * P1 attacks:
 *   4. Protocol version 1 must not authorize promotion.
 *   5. Zsh dialect must not authorize promotion (pinned parser
 *      does not support Zsh).
 *   6. Unknown dialect must not authorize promotion.
 *
 * Required GREEN:
 *   G1. pwd; pwd (correct binding, bash) IS promoted.
 */

import { describe, expect, it } from "vitest";

import { evaluateCommandRisk } from "./command-risk";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import { commandHostAuthorization } from "./command-policy-types";
import {
	joinRunCommandsForParse,
	sha256Hex,
	STRUCTURED_PROTO_VERSION,
	type ParsedShell,
	type StructuredCmd,
	type StructuredProgram,
	type StructuredStmt,
} from "./structured-command-risk";

const SAFE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});

function bashProgram(
	stmts: StructuredStmt[],
	toolInput: unknown,
): ParsedShell {
	const program: StructuredProgram = { stmts };
	const { joined } = joinRunCommandsForParse(toolInput);
	return {
		protocolVersion: STRUCTURED_PROTO_VERSION,
		dialect: "bash",
		sourceSha256: sha256Hex(joined),
		parseStatus: "complete",
		hasCommandSubstitution: false,
		program,
		errors: [],
	};
}

const pwdCmd: StructuredCmd = {
	name: "pwd",
	args: [],
	assigns: [],
	redirects: [],
	isWrapper: false,
	wrapperOf: "",
	inner: "",
};

/* ---------------------------------------------------------------------- *
 * P0 attacks (must NOT be ALLOW)                                          *
 * ---------------------------------------------------------------------- */

describe("CORRECTION01 P0 #1 — redirects participate in risk", () => {
	it("pwd > ~/.ssh/authorized_keys MUST NOT be ALLOW", () => {
		const ti = { command: "pwd", args: [] };
		const r = evaluateCommandRisk({
			toolInput: ti,
			hostAuthorization: SAFE,
			parserResult: bashProgram(
				[
					{
						kind: "cmd",
						cmd: {
							name: "pwd",
							args: [],
							assigns: [],
							redirects: [{ op: ">", path: "~/.ssh/authorized_keys" }],
							isWrapper: false,
							wrapperOf: "",
							inner: "",
						},
					},
				],
				ti,
			),
		});
		expect(r.decision).not.toBe("allow");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("git status > ~/.ssh/authorized_keys MUST NOT be ALLOW", () => {
		const ti = { command: "git", args: ["status"] };
		const r = evaluateCommandRisk({
			toolInput: ti,
			hostAuthorization: SAFE,
			parserResult: bashProgram(
				[
					{
						kind: "cmd",
						cmd: {
							name: "git",
							args: ["status"],
							assigns: [],
							redirects: [{ op: ">", path: "~/.ssh/authorized_keys" }],
							isWrapper: false,
							wrapperOf: "",
							inner: "",
						},
					},
				],
				ti,
			),
		});
		expect(r.decision).not.toBe("allow");
	});

	it("pwd > /etc/hosts MUST NOT be ALLOW", () => {
		const ti = { command: "pwd", args: [] };
		const r = evaluateCommandRisk({
			toolInput: ti,
			hostAuthorization: SAFE,
			parserResult: bashProgram(
				[
					{
						kind: "cmd",
						cmd: {
							name: "pwd",
							args: [],
							assigns: [],
							redirects: [{ op: ">", path: "/etc/hosts" }],
							isWrapper: false,
							wrapperOf: "",
							inner: "",
						},
					},
				],
				ti,
			),
		});
		expect(r.decision).not.toBe("allow");
	});
});

describe("CORRECTION01 P0 #2 — parser result is bound to source", () => {
	it("wrong source digest + rm -rf \"$HOME\" + safe AST MUST stay ASK/never-auto-approve", () => {
		const ti = { command: "rm", args: ["-rf", '"$HOME"'] };
		const parser: ParsedShell = {
			protocolVersion: STRUCTURED_PROTO_VERSION,
			dialect: "bash",
			sourceSha256: "wrong-digest-0000000000000000000000000000000000000000000000000000000000000000",
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: [{ kind: "cmd", cmd: pwdCmd }] },
			errors: [],
		};
		const r = evaluateCommandRisk({
			toolInput: ti,
			hostAuthorization: SAFE,
			parserResult: parser,
		});
		expect(r.disposition).toBe("never-auto-approve");
	});
});

describe("CORRECTION01 P0 #3 — promotion gate is structure-only", () => {
	it("unknown binary (no opaque token) + safe AST MUST NOT be ALLOW", () => {
		const ti = { command: "totally-unknown-binary", args: ["--something"] };
		const r = evaluateCommandRisk({
			toolInput: ti,
			hostAuthorization: SAFE,
			parserResult: bashProgram([{ kind: "cmd", cmd: pwdCmd }], ti),
		});
		expect(r.decision).not.toBe("allow");
	});
});

/* ---------------------------------------------------------------------- *
 * P1 attacks (must NOT be ALLOW)                                          *
 * ---------------------------------------------------------------------- */

describe("CORRECTION01 P1 — protocol / dialect gates", () => {
	it("protocol v1 MUST NOT authorize promotion", () => {
		const ti = "pwd; pwd";
		const { joined } = joinRunCommandsForParse(ti);
		const parser: ParsedShell = {
			// Cast: we explicitly want an out-of-date protocol to verify
			// the gate fires.
			protocolVersion: 1 as unknown as typeof STRUCTURED_PROTO_VERSION,
			dialect: "bash",
			sourceSha256: sha256Hex(joined),
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: [{ kind: "cmd", cmd: pwdCmd }, { kind: "cmd", cmd: pwdCmd }] },
			errors: [],
		};
		const r = evaluateCommandRisk({
			toolInput: ti,
			hostAuthorization: SAFE,
			parserResult: parser,
		});
		expect(r.decision).toBe("ask");
	});

	it("zsh dialect MUST NOT authorize promotion (pinned parser lacks zsh)", () => {
		const ti = "pwd; pwd";
		const { joined } = joinRunCommandsForParse(ti);
		const parser: ParsedShell = {
			protocolVersion: STRUCTURED_PROTO_VERSION,
			dialect: "zsh",
			sourceSha256: sha256Hex(joined),
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: [{ kind: "cmd", cmd: pwdCmd }, { kind: "cmd", cmd: pwdCmd }] },
			errors: [],
		};
		const r = evaluateCommandRisk({
			toolInput: ti,
			hostAuthorization: SAFE,
			parserResult: parser,
		});
		expect(r.decision).toBe("ask");
	});

	it("unknown dialect MUST NOT authorize promotion", () => {
		const ti = "pwd; pwd";
		const { joined } = joinRunCommandsForParse(ti);
		const parser: ParsedShell = {
			protocolVersion: STRUCTURED_PROTO_VERSION,
			dialect: "unknown",
			sourceSha256: sha256Hex(joined),
			parseStatus: "complete",
			hasCommandSubstitution: false,
			program: { stmts: [{ kind: "cmd", cmd: pwdCmd }, { kind: "cmd", cmd: pwdCmd }] },
			errors: [],
		};
		const r = evaluateCommandRisk({
			toolInput: ti,
			hostAuthorization: SAFE,
			parserResult: parser,
		});
		expect(r.decision).toBe("ask");
	});
});

/* ---------------------------------------------------------------------- *
 * Required GREEN (CORRECTION01 primary gain)                              *
 * ---------------------------------------------------------------------- */

describe("CORRECTION01 GREEN — primary gain still holds", () => {
	it("pwd; pwd with correct binding IS promoted to ALLOW", () => {
		const ti = "pwd; pwd";
		const r = evaluateCommandRisk({
			toolInput: ti,
			hostAuthorization: SAFE,
			parserResult: bashProgram(
				[{ kind: "cmd", cmd: pwdCmd }, { kind: "cmd", cmd: pwdCmd }],
				ti,
			),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});
});
