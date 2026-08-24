/**
 * ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01 — reformulation classifier tests.
 *
 * These tests pin the source-level provenance contract and the
 * eligibility predicate at the SDK boundary. The classifier is
 * deterministic, pure, and intentionally narrow.
 */
import { describe, expect, it } from "vitest";
import {
	containsUnquotedShellPattern,
	extractShellSource,
	isReformulatable,
	REFORMULATION_MODEL_FACING_MESSAGE,
	REFORMULATION_REASON_CODE,
} from "./reformulation-classifier";
import {
	commandHostAuthorization,
	type CommandDecision,
} from "./command-policy-types";

const ASK_FALLTHROUGH: CommandDecision = {
	kind: "ask",
	reason: "safe-only mode did not match any host safe rule",
	source: "host_mode_safe_only_fallthrough",
};

function safeOnlyAuth() {
	return commandHostAuthorization({ mode: "safe-only" });
}

function manualAuth() {
	return commandHostAuthorization({ mode: "manual" });
}

function allAuth() {
	return commandHostAuthorization({ mode: "all" });
}

describe("reformulation-classifier: REFORMULATION_REASON_CODE", () => {
	it("is the stable internal identifier", () => {
		expect(REFORMULATION_REASON_CODE).toBe("UNQUOTED_SHELL_PATTERN");
	});
});

describe("reformulation-classifier: REFORMULATION_MODEL_FACING_MESSAGE", () => {
	it("mentions preventing shell pathname expansion", () => {
		expect(REFORMULATION_MODEL_FACING_MESSAGE).toContain("preventing shell pathname expansion");
	});

	it("does NOT mention matcher internals (regex, token offsets, etc.)", () => {
		const msg = REFORMULATION_MODEL_FACING_MESSAGE.toLowerCase();
		expect(msg).not.toContain("regex");
		expect(msg).not.toContain("matcher");
		expect(msg).not.toContain("token offset");
	});

	it("does NOT include 'do not repeat' / 'last chance' language (host enforces cardinality)", () => {
		const msg = REFORMULATION_MODEL_FACING_MESSAGE.toLowerCase();
		expect(msg).not.toContain("do not repeat");
		expect(msg).not.toContain("last chance");
	});
});

describe("reformulation-classifier: extractShellSource", () => {
	it("returns the string itself for string input", () => {
		expect(extractShellSource("find . -name *.ts")).toBe("find . -name *.ts");
	});

	it("returns command for { command }", () => {
		expect(extractShellSource({ command: "find . -name *.ts" })).toBe("find . -name *.ts");
	});

	it("returns first command for { commands: [..] }", () => {
		expect(extractShellSource({ commands: ["find . -name *.ts"] })).toBe("find . -name *.ts");
	});

	it("returns nested command for { commands: [{ command }] }", () => {
		expect(extractShellSource({ commands: [{ command: "find . -name *.ts" }] })).toBe(
			"find . -name *.ts",
		);
	});

	it("returns cmd for { cmd }", () => {
		expect(extractShellSource({ cmd: "find . -name *.ts" })).toBe("find . -name *.ts");
	});

	it("returns null for unrecognized shape (CAPTURE_INSUFFICIENT)", () => {
		expect(extractShellSource({ parallel: false })).toBeNull();
		expect(extractShellSource({ unrelated: "x" })).toBeNull();
		expect(extractShellSource(null)).toBeNull();
		expect(extractShellSource(42)).toBeNull();
		expect(extractShellSource({})).toBeNull();
	});
});

describe("reformulation-classifier: containsUnquotedShellPattern", () => {
	it("returns true for the canonical unsafe form", () => {
		expect(containsUnquotedShellPattern("find . -name *.ts")).toBe(true);
	});

	it("returns true with leading whitespace", () => {
		expect(containsUnquotedShellPattern("   find . -name *.ts")).toBe(true);
	});

	it("returns true for ? / [ ] / { } in reviewed positions", () => {
		expect(containsUnquotedShellPattern("find . -name ?.ts")).toBe(true);
		expect(containsUnquotedShellPattern("find . -name [abc].ts")).toBe(true);
		expect(containsUnquotedShellPattern("find . -name {x,y}.ts")).toBe(true);
	});

	it("returns true for -iname / -path / -ipath / -regex / -iregex", () => {
		expect(containsUnquotedShellPattern("find . -iname *.ts")).toBe(true);
		expect(containsUnquotedShellPattern("find . -path *.ts")).toBe(true);
		expect(containsUnquotedShellPattern("find . -ipath *.ts")).toBe(true);
		expect(containsUnquotedShellPattern("find . -regex .*\\.ts")).toBe(true);
		expect(containsUnquotedShellPattern("find . -iregex .*\\.ts")).toBe(true);
	});

	it("returns false for the QUOTED form (single quotes)", () => {
		expect(containsUnquotedShellPattern("find . -name '*.ts'")).toBe(false);
	});

	it("returns false for the QUOTED form (double quotes)", () => {
		expect(containsUnquotedShellPattern('find . -name "*.ts"')).toBe(false);
	});

	it("returns false for non-find commands", () => {
		expect(containsUnquotedShellPattern("ls *.ts")).toBe(false);
		expect(containsUnquotedShellPattern("grep *.ts file")).toBe(false);
	});

	it("returns false when the pattern predicate is absent", () => {
		expect(containsUnquotedShellPattern("find .")).toBe(false);
		expect(containsUnquotedShellPattern("find . -type f")).toBe(false);
	});

	it("returns false for non-pattern predicates with glob metacharacters", () => {
		// `find . -print *` has a glob AFTER a non-pattern predicate;
		// this is a different (still-rejected-by-policy) class, not this one.
		expect(containsUnquotedShellPattern("find . -print *.ts")).toBe(false);
	});

	it("returns false for the quoted form followed by other predicates", () => {
		expect(containsUnquotedShellPattern("find . -name '*.ts' -type f")).toBe(false);
	});
});

describe("reformulation-classifier: isReformulatable (eligibility predicate)", () => {
	it("returns the prose reason when all four conditions are satisfied", () => {
		expect(
			isReformulatable(
				ASK_FALLTHROUGH,
				{ command: "find . -name *.ts" },
				safeOnlyAuth(),
			),
		).toBe(REFORMULATION_MODEL_FACING_MESSAGE);
	});

	it("returns null when decision.kind is not 'ask'", () => {
		const allowDec: CommandDecision = {
			kind: "allow",
			reason: "x",
			source: "host_mode_safe_only_rule",
		};
		const denyDec: CommandDecision = { kind: "deny", reason: "x", source: "host_hard_deny" };
		expect(isReformulatable(allowDec, { command: "find . -name *.ts" }, safeOnlyAuth())).toBeNull();
		expect(isReformulatable(denyDec, { command: "find . -name *.ts" }, safeOnlyAuth())).toBeNull();
	});

	it("returns null when decision.source is not host_mode_safe_only_fallthrough", () => {
		const realpath: CommandDecision = {
			kind: "ask",
			reason: "x",
			source: "host_workspace_realpath_authority",
		};
		const manual: CommandDecision = { kind: "ask", reason: "x", source: "host_mode_manual" };
		const modelEsc: CommandDecision = { kind: "ask", reason: "x", source: "model_escalation" };
		const unknown: CommandDecision = { kind: "ask", reason: "x", source: "unknown_input" };
		expect(isReformulatable(realpath, { command: "find . -name *.ts" }, safeOnlyAuth())).toBeNull();
		expect(isReformulatable(manual, { command: "find . -name *.ts" }, safeOnlyAuth())).toBeNull();
		expect(isReformulatable(modelEsc, { command: "find . -name *.ts" }, safeOnlyAuth())).toBeNull();
		expect(isReformulatable(unknown, { command: "find . -name *.ts" }, safeOnlyAuth())).toBeNull();
	});

	it("returns null when hostAuthorization.mode is not 'safe-only'", () => {
		expect(isReformulatable(ASK_FALLTHROUGH, { command: "find . -name *.ts" }, manualAuth())).toBeNull();
		expect(isReformulatable(ASK_FALLTHROUGH, { command: "find . -name *.ts" }, allAuth())).toBeNull();
	});

	it("returns null when the source form is not the unquoted-shell-pattern class", () => {
		// Quoted pattern: not reformulatable.
		expect(
			isReformulatable(ASK_FALLTHROUGH, { command: "find . -name '*.ts'" }, safeOnlyAuth()),
		).toBeNull();
		// find . -delete: not the unquoted-pattern class (different source).
		expect(
			isReformulatable(ASK_FALLTHROUGH, { command: "find . -delete" }, safeOnlyAuth()),
		).toBeNull();
		// Non-find command.
		expect(
			isReformulatable(ASK_FALLTHROUGH, { command: "ls *.ts" }, safeOnlyAuth()),
		).toBeNull();
	});

	it("returns null when rawInput is unparseable (CAPTURE_INSUFFICIENT)", () => {
		expect(isReformulatable(ASK_FALLTHROUGH, { parallel: false }, safeOnlyAuth())).toBeNull();
		expect(isReformulatable(ASK_FALLTHROUGH, null, safeOnlyAuth())).toBeNull();
	});

	it("accepts string-form rawInput directly", () => {
		expect(isReformulatable(ASK_FALLTHROUGH, "find . -name *.ts", safeOnlyAuth())).toBe(
			REFORMULATION_MODEL_FACING_MESSAGE,
		);
	});

	it("treats bash -c wrapper as an ordinary input (bash has its own rule family)", () => {
		expect(
			isReformulatable(ASK_FALLTHROUGH, { command: "bash -c 'find . -name *.ts'" }, safeOnlyAuth()),
		).toBeNull();
	});

	it("treats unknown commands as not reformulatable", () => {
		expect(
			isReformulatable(ASK_FALLTHROUGH, { command: "unknown-program --foo" }, safeOnlyAuth()),
		).toBeNull();
	});
});
