/**
 * Structured Command Risk Classifier — V2 Tests
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-ASSISTED01
 *
 * Tests prove the structured classifier operates on REAL PARSER AST
 * FIELDS (not regex substring heuristics). Tests use synthetic
 * ParsedShell fixtures modeled after the JSON projection the
 * mvdan/sh probe emits.
 *
 * See: .factory/evidence/act-command-risk-classification02/tmp-probes/
 *   mvdan-sh-probe/results/probe-results.jsonl
 *   for the canonical AST shapes.
 *
 * V2 INVARIANTS UNDER TEST:
 *   1. V2 may promote ASK → ALLOW only when every reachable branch
 *      is auto-approve eligible.
 *   2. V2 may strengthen ASK → never-auto-approve when an R5-shaped
 *      inner command exists.
 *   3. V2 must NEVER promote never-auto-approve → ALLOW.
 *   4. V2 must NEVER promote DENY → ALLOW.
 *   5. Parser unavailable / parse-failed → ASK minimum (V1 fallback).
 *   6. Command substitution present → ASK minimum.
 *   7. Unknown AST node → ASK minimum.
 *   8. Opaque constructs (if/while/for/case/function) → ASK minimum.
 */

import { describe, expect, it } from "vitest";

import {
	evaluateStructuredCommandRisk,
	joinRunCommandsForParse,
	sha256Hex,
	STRUCTURED_PROTO_VERSION,
	type ParsedShell,
	type ShellDialect,
	type StructuredCmd,
	type StructuredProgram,
	type StructuredStmt,
} from "./structured-command-risk";

function mkCmd(
	name: string,
	args: string[] = [],
	overrides: Partial<StructuredCmd> = {},
): StructuredCmd {
	return {
		name,
		args,
		assigns: [],
		redirects: [],
		isWrapper: false,
		wrapperOf: "",
		inner: "",
		...overrides,
	};
}

function mkProgram(stmts: StructuredStmt[]): StructuredProgram {
	return { stmts };
}

/**
 * Build a ParsedShell for a given toolInput + AST. CORRECTION01: the
 * `sourceSha256` field is REQUIRED and must match the canonical digest
 * of `joinRunCommandsForParse(toolInput).joined` for the classifier to
 * authorize any verdict.
 *
 * Tests that want to simulate a binding failure (wrong digest,
 * missing digest, wrong protocol version) should set those fields
 * explicitly via the overrides.
 */
function mkParsed(
	toolInput: unknown,
	stmts: StructuredStmt[],
	overrides: Partial<ParsedShell> = {},
): ParsedShell {
	const { joined } = joinRunCommandsForParse(toolInput);
	return {
		protocolVersion: STRUCTURED_PROTO_VERSION,
		dialect: "bash",
		sourceSha256: sha256Hex(joined),
		parseStatus: "complete",
		hasCommandSubstitution: false,
		program: mkProgram(stmts),
		errors: [],
		...overrides,
	};
}

/* ---------------------------------------------------------------------- *
 * Failure modes                                                           *
 * ---------------------------------------------------------------------- */

describe("V2 structured classifier — failure contract (ACT §18)", () => {
	it("skips cleanly when parserResult is null (no parser wired)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "pwd",
			parserResult: null,
		});
		expect(r.parseConfidence).toBe("skipped");
		expect(r.aggregate).toBe("ask");
		expect(r.promoteToAllow).toBe(false);
		expect(r.downgradeToNeverAutoApprove).toBe(false);
	});

	it("skips cleanly when parseStatus is failed", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "this is malformed && || ;",
			parserResult: {
				protocolVersion: STRUCTURED_PROTO_VERSION,
				dialect: "bash",
				sourceSha256: sha256Hex(
					joinRunCommandsForParse("this is malformed && || ;").joined,
				),
				parseStatus: "failed",
				hasCommandSubstitution: false,
				program: null,
				errors: ["1:19: && must be followed by a statement"],
			},
		});
		expect(r.parseConfidence).toBe("failed");
		expect(r.aggregate).toBe("ask");
		expect(r.promoteToAllow).toBe(false);
	});

	it("treats command substitution as opaque (ask minimum)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'echo "$(rm -rf "$HOME")"',
			parserResult: mkParsed('echo "$(rm -rf "$HOME")"',
				[
					{
						kind: "cmd",
						cmd: mkCmd("echo", ["$(...)"], {
							args: ["$(...)"],
						}),
					},
				],
				{ hasCommandSubstitution: true },
			),
		});
		expect(r.parseConfidence).toBe("partial");
		expect(r.aggregate).toBe("ask");
		expect(r.promoteToAllow).toBe(false);
		expect(r.downgradeToNeverAutoApprove).toBe(false);
	});
});

/* ---------------------------------------------------------------------- *
 * PRIMARY USABILITY RED — `pwd; pwd`                                     *
 * ---------------------------------------------------------------------- */

describe("V2 structured classifier — safe compounds promoted to ALLOW", () => {
	it("pwd; pwd → auto-approve-eligible (the ergonomic RED)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "pwd; pwd",
			parserResult: mkParsed("pwd; pwd", [
				{ kind: "cmd", cmd: mkCmd("pwd") },
				{ kind: "cmd", cmd: mkCmd("pwd") },
			]),
		});
		expect(r.parseConfidence).toBe("complete");
		expect(r.aggregate).toBe("auto-approve-eligible");
		expect(r.promoteToAllow).toBe(true);
		expect(r.downgradeToNeverAutoApprove).toBe(false);
		expect(r.perStatement.length).toBe(2);
		expect(r.perStatement[0]!.risk).toBe("auto-approve-eligible");
		expect(r.perStatement[1]!.risk).toBe("auto-approve-eligible");
	});

	it("git status && git diff → auto-approve-eligible", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "git status && git diff",
			parserResult: mkParsed("git status && git diff", [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("git", ["status"]) },
					rhs: { kind: "cmd", cmd: mkCmd("git", ["diff"]) },
				},
			]),
		});
		expect(r.aggregate).toBe("auto-approve-eligible");
		expect(r.promoteToAllow).toBe(true);
	});

	it("git rev-parse HEAD && git show --stat HEAD → auto-approve-eligible", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "git rev-parse HEAD && git show --stat HEAD",
			parserResult: mkParsed("git rev-parse HEAD && git show --stat HEAD", [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("git", ["rev-parse", "HEAD"]) },
					rhs: { kind: "cmd", cmd: mkCmd("git", ["show", "--stat", "HEAD"]) },
				},
			]),
		});
		expect(r.aggregate).toBe("auto-approve-eligible");
		expect(r.promoteToAllow).toBe(true);
	});

	it("pwd || git status → auto-approve-eligible (both branches safe)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "pwd || git status",
			parserResult: mkParsed("pwd || git status", [
				{
					kind: "or",
					left: { kind: "cmd", cmd: mkCmd("pwd") },
					rhs: { kind: "cmd", cmd: mkCmd("git", ["status"]) },
				},
			]),
		});
		expect(r.aggregate).toBe("auto-approve-eligible");
		expect(r.promoteToAllow).toBe(true);
	});
});

/* ---------------------------------------------------------------------- *
 * PRIMARY SAFETY DISCRIMINATOR — compound with R5 child                   *
 * ---------------------------------------------------------------------- */

describe("V2 structured classifier — risk-maximum aggregates to never-auto-approve", () => {
	it("git status && rm -rf \"$HOME\" → never-auto-approve (max over and-tree)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'git status && rm -rf "$HOME"',
			parserResult: mkParsed('git status && rm -rf "$HOME"', [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("git", ["status"]) },
					rhs: { kind: "cmd", cmd: mkCmd("rm", ["-rf", '"$HOME"']) },
				},
			]),
		});
		expect(r.parseConfidence).toBe("complete");
		expect(r.aggregate).toBe("never-auto-approve");
		expect(r.downgradeToNeverAutoApprove).toBe(true);
		expect(r.promoteToAllow).toBe(false);
		const r5Stmt = r.perStatement[0]!;
		expect(r5Stmt.risk).toBe("never-auto-approve");
		expect(r5Stmt.source).toContain("aggregated-and");
		expect(r.reasons.some((s) => s.includes("never-auto-approve"))).toBe(true);
	});

	it("pwd; rm -rf / → never-auto-approve (sequence max)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "pwd; rm -rf /",
			parserResult: mkParsed("pwd; rm -rf /", [
				{ kind: "cmd", cmd: mkCmd("pwd") },
				{ kind: "cmd", cmd: mkCmd("rm", ["-rf", "/"]) },
			]),
		});
		expect(r.aggregate).toBe("never-auto-approve");
		expect(r.downgradeToNeverAutoApprove).toBe(true);
	});

	it("git diff || rm -rf .. → never-auto-approve (or max)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "git diff || rm -rf ..",
			parserResult: mkParsed("git diff || rm -rf ..", [
				{
					kind: "or",
					left: { kind: "cmd", cmd: mkCmd("git", ["diff"]) },
					rhs: { kind: "cmd", cmd: mkCmd("rm", ["-rf", ".."]) },
				},
			]),
		});
		expect(r.aggregate).toBe("never-auto-approve");
	});

	it("echo ok; rm -rf \"$HOME\" → never-auto-approve", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'echo ok; rm -rf "$HOME"',
			parserResult: mkParsed('echo ok; rm -rf "$HOME"', [
				{ kind: "cmd", cmd: mkCmd("echo", ["ok"]) },
				{ kind: "cmd", cmd: mkCmd("rm", ["-rf", '"$HOME"']) },
			]),
		});
		expect(r.aggregate).toBe("never-auto-approve");
	});

	it("true && rm -rf \"$HOME\" → never-auto-approve", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'true && rm -rf "$HOME"',
			parserResult: mkParsed('true && rm -rf "$HOME"', [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("true") },
					rhs: { kind: "cmd", cmd: mkCmd("rm", ["-rf", '"$HOME"']) },
				},
			]),
		});
		expect(r.aggregate).toBe("never-auto-approve");
	});
});

/* ---------------------------------------------------------------------- *
 * Wrapper recursion                                                       *
 * ---------------------------------------------------------------------- */

describe("V2 structured classifier — wrappers (bash -c, sh -c)", () => {
	it("bash -c 'rm -rf \"$HOME\"' → never-auto-approve (inner R5 detected)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'bash -c \'rm -rf "$HOME"\'',
			parserResult: mkParsed('bash -c \'rm -rf "$HOME"\'', [
				{
					kind: "cmd",
					cmd: mkCmd("bash", ["-c", 'rm -rf "$HOME"'], {
						isWrapper: true,
						wrapperOf: "bash",
						inner: 'rm -rf "$HOME"',
					}),
				},
			]),
		});
		expect(r.aggregate).toBe("never-auto-approve");
		expect(r.downgradeToNeverAutoApprove).toBe(true);
		expect(r.perStatement[0]!.source).toContain("wrapper");
	});

	it("sh -c 'git status' → ask (wrapper inner not recursively classified)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "sh -c 'git status'",
			parserResult: mkParsed("sh -c 'git status'", [
				{
					kind: "cmd",
					cmd: mkCmd("sh", ["-c", "git status"], {
						isWrapper: true,
						wrapperOf: "posix",
						inner: "git status",
					}),
				},
			]),
		});
		expect(r.aggregate).toBe("ask");
		expect(r.promoteToAllow).toBe(false);
		expect(r.downgradeToNeverAutoApprove).toBe(false);
		expect(r.perStatement[0]!.source).toContain("inner-not-classified");
	});

	it("bash -c 'git status && rm -rf \"$HOME\"' → never-auto-approve", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'bash -c \'git status && rm -rf "$HOME"\'',
			parserResult: mkParsed('bash -c \'git status && rm -rf "$HOME"\'', [
				{
					kind: "cmd",
					cmd: mkCmd("bash", ["-c", 'git status && rm -rf "$HOME"'], {
						isWrapper: true,
						wrapperOf: "bash",
						inner: 'git status && rm -rf "$HOME"',
					}),
				},
			]),
		});
		expect(r.aggregate).toBe("never-auto-approve");
	});
});

/* ---------------------------------------------------------------------- *
 * Opaque constructs                                                       *
 * ---------------------------------------------------------------------- */

describe("V2 structured classifier — opaque constructs (if/while/for/case/function)", () => {
	it("if true; then rm -rf \"$HOME\"; fi → ask minimum (no auto-approve)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'if true; then rm -rf "$HOME"; fi',
			parserResult: mkParsed('if true; then rm -rf "$HOME"; fi', [{ kind: "opaque" }]),
		});
		expect(r.aggregate).toBe("ask");
		expect(r.promoteToAllow).toBe(false);
		expect(r.downgradeToNeverAutoApprove).toBe(false);
		expect(r.perStatement[0]!.source).toBe("opaque-construct");
	});

	it("while true; do pwd; done → ask minimum", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "while true; do pwd; done",
			parserResult: mkParsed("while true; do pwd; done", [{ kind: "opaque" }]),
		});
		expect(r.aggregate).toBe("ask");
	});

	it("function f() { rm -rf \"$HOME\"; } → ask minimum", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'function f() { rm -rf "$HOME"; }',
			parserResult: mkParsed('function f() { rm -rf "$HOME"; }', [{ kind: "opaque" }]),
		});
		expect(r.aggregate).toBe("ask");
	});
});

/* ---------------------------------------------------------------------- *
 * cd / eval / unknown commands                                            *
 * ---------------------------------------------------------------------- */

describe("V2 structured classifier — special command names", () => {
	it("eval \"$X\" → ask minimum (eval is opaque)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'eval "$X"',
			parserResult: mkParsed('eval "$X"', [
				{ kind: "cmd", cmd: mkCmd("eval", ['"$X"']) },
			]),
		});
		expect(r.aggregate).toBe("ask");
		expect(r.perStatement[0]!.source).toBe("eval-opaque");
	});

	it("cd \"$HOME\" → ask minimum (cd is not auto-approve)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'cd "$HOME"',
			parserResult: mkParsed('cd "$HOME"', [
				{ kind: "cmd", cmd: mkCmd("cd", ['"$HOME"']) },
			]),
		});
		expect(r.aggregate).toBe("ask");
		expect(r.perStatement[0]!.source).toBe("cd-not-auto-approve-eligible");
	});

	it("cd \"$HOME\" && rm -rf . → ask (cd alone is ask; . is not R5)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'cd "$HOME" && rm -rf .',
			parserResult: mkParsed('cd "$HOME" && rm -rf .', [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("cd", ['"$HOME"']) },
					rhs: { kind: "cmd", cmd: mkCmd("rm", ["-rf", "."]) },
				},
			]),
		});
		expect(r.aggregate).toBe("ask");
	});

	it("rm -rf ~ → never-auto-approve (V1 floor catches tilde target)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "rm -rf ~",
			parserResult: mkParsed("rm -rf ~", [
				{ kind: "cmd", cmd: mkCmd("rm", ["-rf", "~"]) },
			]),
		});
		expect(r.aggregate).toBe("never-auto-approve");
		expect(r.downgradeToNeverAutoApprove).toBe(true);
		expect(r.perStatement[0]!.source).toContain("home-destruction");
	});

	it("rm -rf /Volumes/UserData → never-auto-approve (root-destruction family)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "rm -rf /Volumes/UserData",
			parserResult: mkParsed("rm -rf /Volumes/UserData", [
				{ kind: "cmd", cmd: mkCmd("rm", ["-rf", "/Volumes/UserData"]) },
			]),
		});
		expect(r.aggregate).toBe("never-auto-approve");
		expect(r.perStatement[0]!.source).toContain("root-destruction");
	});
});

/* ---------------------------------------------------------------------- *
 * Variable-resolved assignment (the wrap-var-assign-rm-home case)        *
 * ---------------------------------------------------------------------- */

describe("V2 structured classifier — variable assignments", () => {
	it("target=\"$HOME\"; rm -rf \"$target\" → ask (V2 cannot resolve $target statically)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: 'target="$HOME"; rm -rf "$target"',
			parserResult: mkParsed('target="$HOME"; rm -rf "$target"', [
				{
					kind: "cmd",
					cmd: mkCmd("", [], {
						name: "",
						assigns: [{ name: "target", value: "$HOME" }],
					}),
				},
				{ kind: "cmd", cmd: mkCmd("rm", ["-rf", '"$target"']) },
			]),
		});
		expect(r.aggregate).toBe("ask");
		expect(r.promoteToAllow).toBe(false);
	});
});

/* ---------------------------------------------------------------------- *
 * Dialect policy                                                          *
 * ---------------------------------------------------------------------- */

describe("V2 structured classifier — dialect handling", () => {
	it("zsh dialect → still classified, parser results honored", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "pwd",
			parserResult: mkParsed("pwd",
				[{ kind: "cmd", cmd: mkCmd("pwd") }],
				{ dialect: "zsh" as ShellDialect },
			),
		});
		expect(r.aggregate).toBe("auto-approve-eligible");
	});

	it("posix dialect → sh -c 'git status' still classified", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "sh -c 'git status'",
			parserResult: mkParsed("sh -c 'git status'",
				[
					{
						kind: "cmd",
						cmd: mkCmd("sh", ["-c", "git status"], {
							isWrapper: true,
							wrapperOf: "posix",
							inner: "git status",
						}),
					},
				],
				{ dialect: "posix" as ShellDialect },
			),
		});
		expect(r.aggregate).toBe("ask");
	});

	it("unknown dialect → bash-conservative fallback", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "pwd",
			parserResult: mkParsed("pwd",
				[{ kind: "cmd", cmd: mkCmd("pwd") }],
				{ dialect: "unknown" as ShellDialect },
			),
		});
		expect(r.aggregate).toBe("auto-approve-eligible");
	});
});

/* ---------------------------------------------------------------------- *
 * Pipeline handling                                                       *
 * ---------------------------------------------------------------------- */

describe("V2 structured classifier — pipelines", () => {
	it("echo hi | sudo tee /etc/hosts → never-auto-approve (max across stages)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "echo hi | sudo tee /etc/hosts",
			parserResult: mkParsed("echo hi | sudo tee /etc/hosts", [
				{
					kind: "pipe",
					left: { kind: "cmd", cmd: mkCmd("echo", ["hi"]) },
					rhs: { kind: "cmd", cmd: mkCmd("sudo", ["tee", "/etc/hosts"]) },
				},
			]),
		});
		expect(r.aggregate).toBe("never-auto-approve");
	});

	it("pwd | head -1 → ask (head not in safe rule list)", () => {
		const r = evaluateStructuredCommandRisk({
			toolInput: "pwd | head -1",
			parserResult: mkParsed("pwd | head -1", [
				{
					kind: "pipe",
					left: { kind: "cmd", cmd: mkCmd("pwd") },
					rhs: { kind: "cmd", cmd: mkCmd("head", ["-1"]) },
				},
			]),
		});
		expect(r.aggregate).toBe("ask");
	});
});

/* ---------------------------------------------------------------------- *
 * Helper: joinRunCommandsForParse                                         *
 * ---------------------------------------------------------------------- */

describe("V2 structured classifier — joinRunCommandsForParse", () => {
	it("joins a single string input as-is", () => {
		const r = joinRunCommandsForParse("pwd");
		expect(r.joined).toBe("pwd");
		expect(r.hadMultiple).toBe(false);
	});

	it("joins a multi-command array with ' ; '", () => {
		const r = joinRunCommandsForParse(["pwd", "pwd"]);
		expect(r.joined).toBe("pwd ; pwd");
		expect(r.hadMultiple).toBe(true);
	});

	it("handles { commands: [...] } shape", () => {
		const r = joinRunCommandsForParse({ commands: ["pwd", "pwd"] });
		expect(r.joined).toBe("pwd ; pwd");
		expect(r.hadMultiple).toBe(true);
	});

	it("returns empty joined for empty input", () => {
		const r = joinRunCommandsForParse("");
		expect(r.joined).toBe("");
	});
});
