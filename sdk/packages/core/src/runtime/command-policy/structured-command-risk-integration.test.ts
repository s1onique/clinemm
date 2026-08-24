/**
 * V2 + V1 integration tests
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-ASSISTED01
 *
 * These tests prove the V2 structured classifier is correctly
 * COMPOSED on top of V1 in `evaluateCommandRiskWithParser()`. When a parser
 * result is provided:
 *
 *   - V1 still produces a verdict (V1 floor scans the rendered
 *     surface, OPAQUE_SHELL_TOKENS guards composition, etc.).
 *   - V2 may promote a V1 ASK to ALLOW when every reachable branch
 *     in the AST is auto-approve eligible.
 *   - V2 may strengthen V1 ASK to never-auto-approve when the AST
 *     reveals an R5 inner command.
 *   - V2 NEVER weakens V1's verdict.
 *
 * When parserResult is undefined (production default), V2 is a
 * no-op and V1 behavior is preserved exactly.
 */

import { describe, expect, it } from "vitest";
import { commandHostAuthorization } from "./command-policy-types";
import {
	evaluateCommandRiskWithParser,
	joinRunCommandsForParse,
	type ParsedShell,
	STRUCTURED_PROTO_VERSION,
	type StructuredCmd,
	type StructuredStmt,
	sha256Hex,
} from "./command-risk-internal";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";

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

/**
 * Build a ParsedShell for a known toolInput + AST. CORRECTION01: the
 * `sourceSha256` field is now REQUIRED, and it must match the SHA-256
 * of `joinRunCommandsForParse(toolInput).joined` for promotion to fire.
 *
 * Tests that want to simulate a parser result that DOES NOT match
 * the input should set `sourceSha256` explicitly to a wrong value.
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
		program: { stmts },
		errors: [],
		...overrides,
	};
}

const ALL = commandHostAuthorization({ mode: "all" });
const SAFE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
});

/* ---------------------------------------------------------------------- *
 * V1 conservation when V2 disabled (production default)                  *
 * ---------------------------------------------------------------------- */

describe("V2+V1 composition — V1 conservation when parserResult is undefined", () => {
	it("V1 verdict is preserved when parserResult is omitted", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "pwd; pwd",
			hostAuthorization: SAFE,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).toBe("ask");
	});

	it("V1 R5 floor still fires when parserResult is omitted", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: 'rm -rf "$HOME"',
			hostAuthorization: ALL,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).toBe("never-auto-approve");
		expect(r.source).toBe("risk_hard_floor");
	});

	it("explicitly-null parserResult is treated as no-parser (V1 path)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "pwd; pwd",
			hostAuthorization: SAFE,
			parserResult: null,
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).toBe("ask");
	});
});

/* ---------------------------------------------------------------------- *
 * V2 promotion path: ASK → ALLOW when AST confirms safe                  *
 * ---------------------------------------------------------------------- */

describe("V2+V1 composition — V2 promotion ASK → ALLOW when AST confirms safe", () => {
	it("pwd; pwd → ALLOW (V2 promotion, the ergonomic RED)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "pwd; pwd",
			hostAuthorization: SAFE,
			parserResult: mkParsed("pwd; pwd", [
				{ kind: "cmd", cmd: mkCmd("pwd") },
				{ kind: "cmd", cmd: mkCmd("pwd") },
			]),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
		expect(r.source).toBe("risk_v2_structured_promotion");
	});

	it("git status && git diff → ALLOW (V2 promotion)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "git status && git diff",
			hostAuthorization: SAFE,
			parserResult: mkParsed("git status && git diff", [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("git", ["status"]) },
					rhs: { kind: "cmd", cmd: mkCmd("git", ["diff"]) },
				},
			]),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	it("multi-command array input [pwd, pwd] → ALLOW (V2 promotion)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: ["pwd", "pwd"],
			hostAuthorization: SAFE,
			parserResult: mkParsed(
				["pwd", "pwd"],
				[
					{ kind: "cmd", cmd: mkCmd("pwd") },
					{ kind: "cmd", cmd: mkCmd("pwd") },
				],
			),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
	});

	// ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01
	//
	// SYNTHETIC PARSER-BOUND EXACT COMMAND: the user's literal first
	// command in the live chat session, hand-constructed into a
	// ParsedShell fixture via `mkParsed()`. This is NOT a LIVE test;
	// it does NOT exercise the real parser helper. Classification:
	// SYNTHETIC_REAL / STRUCTURAL. The load-bearing GREEN assertion
	// it makes is that the V2 promotion gate fires correctly when
	// every leaf is positively matched — proof that the V2 engine +
	// the new rules cohere. With `host_safe_git_remote` and
	// `host_safe_echo` added, every reachable leaf now positively
	// matches. The aggregate becomes auto-approve-eligible and
	// `risk_v2_structured_promotion` fires.
	//
	// EVIDENCE GAP: this synthetic test is the only level of evidence
	// produced by this ACT. To upgrade to REAL_PRODUCTION_SEAM or
	// LIVE, the helper binary would have to drive the parser and the
	// evaluator would have to run against the rebuilt SDK bundle in a
	// way that round-trips a real shell string through mvdan/sh. The
	// `live-qualification.mjs` harness does drive the rebuilt SDK
	// dist, but it supplies the AST fixture directly rather than
	// going through a parser helper (the parser helper shipping ACT
	// is a separate follow-up). Until that round-trip exists, the
	// evidence above is STRUCTURAL only.
	it("SYNTHETIC PARSER-BOUND EXACT COMMAND: user's 5-leaf && chain → ALLOW (V2 promotion)", () => {
		const liveCmd =
			"git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v";
		const r = evaluateCommandRiskWithParser({
			toolInput: liveCmd,
			hostAuthorization: SAFE,
			parserResult: mkParsed(liveCmd, [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("git", ["status", "--short"]) },
					rhs: {
						kind: "and",
						left: { kind: "cmd", cmd: mkCmd("echo", ["'---BRANCH---'"]) },
						rhs: {
							kind: "and",
							left: {
								kind: "cmd",
								cmd: mkCmd("git", ["branch", "--show-current"]),
							},
							rhs: {
								kind: "and",
								left: { kind: "cmd", cmd: mkCmd("echo", ["'---REMOTES---'"]) },
								rhs: {
									kind: "cmd",
									cmd: mkCmd("git", ["remote", "-v"]),
								},
							},
						},
					},
				},
			]),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
		expect(r.source).toBe("risk_v2_structured_promotion");
	});

	// ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01-CORRECTION01:
	// HONEST SYNTHETIC PARSER-BOUND TEST using SEMANTIC argv (no
	// quote characters in `cmd.args`). The previous fixture above
	// embedded the literal quotes (`["'---BRANCH---'"]`) which the
	// real parser never emits -- it strips quotes before assigning
	// the argv. With the corrected V2 argv-semantic echo classifier
	// in place, this fixture shape now exercises the production
	// code path: `renderArgv` produces "echo ---BRANCH---" (no
	// quotes) which the V1 source-text regex does NOT match, but
	// the new argv-semantic classifier DOES match. The promotion
	// still fires. This is the corrected synthetic mirror of the
	// REAL_PRODUCTION_SEAM test in
	// `structured-command-risk.real-binary.test.ts`.
	it("SYNTHETIC PARSER-BOUND EXACT COMMAND (CORRECTED): user's 5-leaf && chain with semantic argv → ALLOW", () => {
		const liveCmd =
			"git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v";
		const r = evaluateCommandRiskWithParser({
			toolInput: liveCmd,
			hostAuthorization: SAFE,
			parserResult: mkParsed(liveCmd, [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("git", ["status", "--short"]) },
					rhs: {
						kind: "and",
						left: { kind: "cmd", cmd: mkCmd("echo", ["---BRANCH---"]) },
						rhs: {
							kind: "and",
							left: {
								kind: "cmd",
								cmd: mkCmd("git", ["branch", "--show-current"]),
							},
							rhs: {
								kind: "and",
								left: { kind: "cmd", cmd: mkCmd("echo", ["---REMOTES---"]) },
								rhs: {
									kind: "cmd",
									cmd: mkCmd("git", ["remote", "-v"]),
								},
							},
						},
					},
				},
			]),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
		expect(r.source).toBe("risk_v2_structured_promotion");
	});

	// Mixed-risk control: same chain, but with a mutating leaf appended.
	// MUST stay ASK. This is the load-bearing adversarial control that
	// proves the V2 promotion does not extend to mutating neighbors.
	// Classification: SYNTHETIC_REAL / STRUCTURAL — same caveat as the
	// green test above; AST fixture hand-constructed.
	it("SYNTHETIC PARSER-BOUND MIXED-RISK CONTROL: 5-leaf chain + git branch -D → ASK (mutating leaf blocks)", () => {
		const evilCmd = "git status --short && git branch -D __CLINEMM_SENTINEL__";
		const r = evaluateCommandRiskWithParser({
			toolInput: evilCmd,
			hostAuthorization: SAFE,
			parserResult: mkParsed(evilCmd, [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("git", ["status", "--short"]) },
					rhs: {
						kind: "cmd",
						cmd: mkCmd("git", ["branch", "-D", "__CLINEMM_SENTINEL__"]),
					},
				},
			]),
		});
		// V2 must NOT promote: a mutating leaf keeps the aggregate at ASK.
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	// Other adversarial compound-aggregation invariants.
	it("git remote -v && git push → ASK (untracked mutating leaf blocks)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "git remote -v && git push",
			hostAuthorization: SAFE,
			parserResult: mkParsed("git remote -v && git push", [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("git", ["remote", "-v"]) },
					rhs: { kind: "cmd", cmd: mkCmd("git", ["push"]) },
				},
			]),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("pwd && sudo rm -rf / → ASK + never-auto-approve (R5 leaf blocks promotion)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "pwd && sudo rm -rf /",
			hostAuthorization: SAFE,
			parserResult: mkParsed("pwd && sudo rm -rf /", [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("pwd") },
					rhs: { kind: "cmd", cmd: mkCmd("rm", ["-rf", "/"]) },
				},
			]),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).toBe("never-auto-approve");
	});

	it("pwd && unknown-binary --something → ASK (unknown leaf blocks promotion)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "pwd && unknown-binary --something",
			hostAuthorization: SAFE,
			parserResult: mkParsed("pwd && unknown-binary --something", [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("pwd") },
					rhs: {
						kind: "cmd",
						cmd: mkCmd("unknown-binary", ["--something"]),
					},
				},
			]),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});

	it("echo hello && echo world → ALLOW (V2 promotion, both leaves match host_safe_echo)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "echo hello && echo world",
			hostAuthorization: SAFE,
			parserResult: mkParsed("echo hello && echo world", [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("echo", ["hello"]) },
					rhs: { kind: "cmd", cmd: mkCmd("echo", ["world"]) },
				},
			]),
		});
		expect(r.decision).toBe("allow");
		expect(r.disposition).toBe("auto-approve-eligible");
		expect(r.source).toBe("risk_v2_structured_promotion");
	});

	it("echo safe && echo $(rm -rf $HOME) → ASK (command substitution blocks promotion)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "echo safe && echo $(rm -rf $HOME)",
			hostAuthorization: SAFE,
			parserResult: mkParsed(
				"echo safe && echo $(rm -rf $HOME)",
				[
					{
						kind: "and",
						left: { kind: "cmd", cmd: mkCmd("echo", ["safe"]) },
						rhs: {
							kind: "cmd",
							cmd: mkCmd("echo", ["$(...)"]),
						},
					},
				],
				{ hasCommandSubstitution: true },
			),
		});
		// Conservative V2 path: command substitution detected → ASK minimum.
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});
});

/* ---------------------------------------------------------------------- *
 * V2 strengthen path: ASK → never-auto-approve when AST sees R5         *
 * ---------------------------------------------------------------------- */

describe("V2+V1 composition — V2 strengthen ASK → never-auto-approve when AST sees R5", () => {
	it('git status && rm -rf "$HOME" → ASK + never-auto-approve', () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: 'git status && rm -rf "$HOME"',
			hostAuthorization: SAFE,
			parserResult: mkParsed('git status && rm -rf "$HOME"', [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("git", ["status"]) },
					rhs: { kind: "cmd", cmd: mkCmd("rm", ["-rf", '"$HOME"']) },
				},
			]),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).toBe("never-auto-approve");
	});

	it("V2 strengthens ALLOW → ASK + never-auto-approve (matches V1 R5 pattern)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: 'git status && rm -rf "$HOME"',
			hostAuthorization: ALL,
			parserResult: mkParsed('git status && rm -rf "$HOME"', [
				{
					kind: "and",
					left: { kind: "cmd", cmd: mkCmd("git", ["status"]) },
					rhs: { kind: "cmd", cmd: mkCmd("rm", ["-rf", '"$HOME"']) },
				},
			]),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).toBe("never-auto-approve");
	});
});

/* ---------------------------------------------------------------------- *
 * V2 NEVER weakens V1                                                     *
 * ---------------------------------------------------------------------- */

describe("V2+V1 composition — V2 NEVER weakens V1's verdict", () => {
	it("V1 R5 never-auto-approve cannot be promoted to ALLOW even when parser sees only safe branches", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: 'rm -rf "$HOME"',
			hostAuthorization: ALL,
			parserResult: mkParsed('rm -rf "$HOME"', [
				{ kind: "cmd", cmd: mkCmd("pwd") },
			]),
		});
		expect(r.disposition).toBe("never-auto-approve");
		expect(r.decision).toBe("ask");
	});
});

/* ---------------------------------------------------------------------- *
 * V2 failure modes preserve V1                                            *
 * ---------------------------------------------------------------------- */

describe("V2+V1 composition — V2 failure modes preserve V1", () => {
	it("parser unavailable (null) → V1 only", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "pwd; pwd",
			hostAuthorization: SAFE,
			parserResult: null,
		});
		expect(r.decision).toBe("ask");
	});

	it("parser failed → V1 only", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: "this is malformed && || ;",
			hostAuthorization: SAFE,
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
		expect(r.decision).toBe("ask");
	});

	it("command substitution present → V2 conservative ASK (no promotion)", () => {
		const r = evaluateCommandRiskWithParser({
			toolInput: 'echo "$(rm -rf "$HOME")"',
			hostAuthorization: SAFE,
			parserResult: mkParsed(
				'echo "$(rm -rf "$HOME")"',
				[
					{
						kind: "cmd",
						cmd: mkCmd("echo", ["$(...)"]),
					},
				],
				{ hasCommandSubstitution: true },
			),
		});
		expect(r.decision).toBe("ask");
	});
});
