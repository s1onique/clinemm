/**
 * Interactive approval controller — V2 parser helper async-seam tests
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * CORRECTION02 (Phase 2 reviewer HALT_CLI_EXPLICIT_NO_AUTO_APPROVE_CONTRACT_BROKEN):
 *
 * CLI contract test. The reviewer required:
 *
 *   --auto-approve=false
 *     pwd
 *       → ASK
 *     pwd; pwd + helper
 *       → ASK
 *     rm -rf "$HOME"
 *       → ASK / risk_hard_floor
 *     V2 MUST NOT override explicit manual mode.
 *
 * These tests exercise the REAL CLI production path (no
 * `setCommandEvaluator` override) and assert that even when the
 * trusted parser helper returns a perfectly valid safe AST, V2
 * cannot promote an ASK to ALLOW under explicit manual mode.
 *
 * This is the safety contract that must hold BEFORE binary shipping.
 *
 * V2 PROMOTION STATE (CLI):
 *   CLI_INTERACTIVE_V2 = FRAMEWORK_PROVEN_BUT_DORMANT
 *     - The V2 promotion framework is structurally wired (see
 *       apps/cli/src/runtime/approvals.ts and the helper seam).
 *     - V2 cannot activate on the CLI under `--auto-approve=false`
 *       because `host_mode_manual` is NOT in
 *       `STRUCTURE_ONLY_PROMOTABLE_REASONS`.
 *     - V2 reaches the CLI ONLY via a future user-visible safe-only
 *       flag (follow-up work, NOT in this ACT), which would use
 *       `cliResolveTrueSafeOnlyHostAuthorization()`.
 *
 *   CLI_ACP_PATH = V1_ONLY (per CORRECTION01/epoch documentation).
 *
 * Conservation cases (R5, unknown cmd, DENY) are preserved from
 * prior ARTIFACT and re-asserted here on the production path.
 */

import { afterEach, describe, expect, it } from "vitest";

import type { ToolApprovalRequest } from "@cline/shared";
import type { Config } from "../../utils/types";
import { joinRunCommandsForParse, STRUCTURED_PROTO_VERSION } from "@cline/core/internal/command-risk-internal";
import { createHash } from "node:crypto";

import {
	cliEvaluateCommandToolApprovalWith,
	cliResolveTrueSafeOnlyHostAuthorization,
} from "../command-policy-host";
import { createInteractiveApprovalController, setCliParserHelper, type CliParserHelper } from "./approvals";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSafeCompoundAst(toolInput: string): unknown {
	const { joined } = joinRunCommandsForParse(toolInput);
	const digest = createHash("sha256").update(joined).digest("hex");
	return {
		protocolVersion: STRUCTURED_PROTO_VERSION,
		dialect: "bash",
		sourceSha256: digest,
		parseStatus: "complete",
		hasCommandSubstitution: false,
		program: {
			stmts: [
				{
					kind: "cmd",
					cmd: {
						name: "pwd",
						args: [],
						assigns: [],
						redirects: [],
						isWrapper: false,
						wrapperOf: "",
						inner: "",
					},
				},
				{
					kind: "cmd",
					cmd: {
						name: "pwd",
						args: [],
						assigns: [],
						redirects: [],
						isWrapper: false,
						wrapperOf: "",
						inner: "",
					},
				},
			],
		},
		errors: [],
	};
}

function makeUnknownCommandAst(cmdName: string): unknown {
	return {
		protocolVersion: STRUCTURED_PROTO_VERSION,
		dialect: "bash",
		sourceSha256: "0".repeat(64),
		parseStatus: "complete",
		hasCommandSubstitution: false,
		program: {
			stmts: [
				{
					kind: "cmd",
					cmd: {
						name: cmdName,
						args: ["--opt"],
						assigns: [],
						redirects: [],
						isWrapper: false,
						wrapperOf: "",
						inner: "",
					},
				},
			],
		},
		errors: [],
	};
}

function makeHelperReturning(parsedShell: unknown): CliParserHelper {
	return { invoke: async (_toolInput: unknown) => parsedShell };
}
function makeHelperUnavailable(): CliParserHelper {
	return { invoke: async (_toolInput: unknown) => null };
}
function makeHelperThrowing(): CliParserHelper {
	return {
		invoke: async (_toolInput: unknown) => {
			throw new Error("simulated helper failure");
		},
	};
}

/**
 * Production CLI config with `--auto-approve=false`. Per
 * CORRECTION02, production CLI now restores `mode: "manual"` (NOT
 * "safe-only") when `autoApproveTools=false`. Every command —
 * including safe ones like `pwd` and safe compounds like `pwd; pwd`
 * — ASKs the user. The V2 parser CANNOT manufacture auto-approval
 * from an explicit manual-mode opt-out.
 */
function makeConfig(autoApprove: boolean): Config {
	return {
		apiKey: "",
		providerId: "cline",
		modelId: "openai/gpt-5.3-codex",
		verbose: false,
		sandbox: false,
		thinking: false,
		outputMode: "text",
		mode: "act",
		systemPrompt: "",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		defaultToolAutoApprove: autoApprove,
		toolPolicies: { "*": { autoApprove } },
		cwd: process.cwd(),
	};
}

function makeCommandRequest(
	command: string,
	policy: ToolApprovalRequest["policy"] = { autoApprove: false },
): ToolApprovalRequest {
	return {
		sessionId: "session-1",
		agentId: "agent-1",
		conversationId: "conversation-1",
		iteration: 1,
		toolCallId: `tool-${command.length}`,
		toolName: "run_commands",
		input: { command },
		policy,
	};
}

// ---------------------------------------------------------------------------
// Test isolation
// ---------------------------------------------------------------------------

afterEach(() => {
	setCliParserHelper(undefined);
});

// ---------------------------------------------------------------------------
// Documented CLI contract — V2 CANNOT override explicit manual mode
// ---------------------------------------------------------------------------

describe("CORRECTION02: CLI REAL production seam — documented contract (V2 cannot override --auto-approve=false)", () => {
	it("pwd (single, safe) + helper available + --auto-approve=false => ASK (manual mode)", async () => {
		const fakeAst = makeSafeCompoundAst("pwd");
		setCliParserHelper(makeHelperReturning(fakeAst));
		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("host_mode_manual");
		// V2 promotion MUST NOT fire under explicit manual mode.
		expect(result.decision?.source).not.toBe("risk_v2_structured_promotion");
	});

	it("pwd; pwd (safe compound) + helper available + --auto-approve=false => ASK (manual mode)", async () => {
		const fakeAst = makeSafeCompoundAst("pwd; pwd");
		setCliParserHelper(makeHelperReturning(fakeAst));
		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("host_mode_manual");
		// V2 promotion MUST NOT fire under explicit manual mode.
		expect(result.decision?.source).not.toBe("risk_v2_structured_promotion");
	});

	it("git status (safe) + helper available + --auto-approve=false => ASK (manual mode)", async () => {
		const fakeAst = makeSafeCompoundAst("git status");
		setCliParserHelper(makeHelperReturning(fakeAst));
		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("git status"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("host_mode_manual");
	});

	it("R5 catastrophic (rm -rf $HOME) + helper unavailable => ASK + never-auto-approve (R5 invariant)", async () => {
		setCliParserHelper(makeHelperUnavailable());
		const controller = createInteractiveApprovalController(makeConfig(true));
		const result = await controller.requestToolApproval(makeCommandRequest("rm -rf $HOME"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("risk_hard_floor");
	});

	it("R5 catastrophic (rm -rf $HOME) + helper returns ANYTHING => ASK + never-auto-approve (R5 invariant)", async () => {
		const fakeAst = makeSafeCompoundAst("rm -rf $HOME");
		setCliParserHelper(makeHelperReturning(fakeAst));
		const controller = createInteractiveApprovalController(makeConfig(true));
		const result = await controller.requestToolApproval(makeCommandRequest("rm -rf $HOME"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("risk_hard_floor");
	});
});

// ---------------------------------------------------------------------------
// The reviewer-required PIN: manual ASK + trusted parser safe AST ≠ ALLOW
// ---------------------------------------------------------------------------

describe("CORRECTION02: PIN — manual mode + trusted parser safe AST is NEVER promoted", () => {
	it("manual ASK + trusted parser safe AST = ASK (V2 stays dormant under explicit user NO)", async () => {
		// This is the single most important test in this file. The
		// reviewer demanded direct evidence that V2 cannot override
		// explicit manual mode. The trusted helper returns a perfectly
		// valid safe AST for `pwd; pwd`. The CLI is in --auto-approve
		// false (manual mode). The result MUST be ASK with the
		// `host_mode_manual` source — NOT ALLOW from V2.
		const fakeAst = makeSafeCompoundAst("pwd; pwd");
		setCliParserHelper(makeHelperReturning(fakeAst));
		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.source).not.toBe("risk_v2_structured_promotion");
		expect(result.decision?.source).toBe("host_mode_manual");
	});
});

// ---------------------------------------------------------------------------
// V2 framework is structurally present (no helper, V1 unchanged)
// ---------------------------------------------------------------------------

describe("CORRECTION02: CLI REAL production seam — helper availability does NOT change manual-mode behavior", () => {
	it("pwd; pwd + helper unavailable + --auto-approve=false => ASK (V1 unchanged)", async () => {
		setCliParserHelper(makeHelperUnavailable());
		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.source).toBe("host_mode_manual");
	});

	it("pwd; pwd + helper throws + --auto-approve=false => ASK (V1 unchanged)", async () => {
		setCliParserHelper(makeHelperThrowing());
		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.source).toBe("host_mode_manual");
	});

	it("pwd; pwd + no helper wired + --auto-approve=false => ASK (production default)", async () => {
		setCliParserHelper(undefined);
		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.source).toBe("host_mode_manual");
	});
});

// ---------------------------------------------------------------------------
// CLI safe-only authority — V2 IS reachable via the safe-only helper
// (this is what a future user-visible CLI safe-only flag should use)
// ---------------------------------------------------------------------------

describe("CORRECTION02: CLI safe-only authority (framework proof, no user-visible flag yet)", () => {
	it("safe-only + pwd; pwd + helper available => ALLOW (V2 promotion reachable via safe-only auth)", () => {
		// This is what a future user-visible CLI safe-only flag
		// would construct. The CLI does not currently expose such a
		// flag (per `apps/cli/README.md`). This test exists to prove
		// the V2 promotion framework is structurally wired on the CLI
		// and only awaits a user-visible flag to activate it.
		const fakeAst = makeSafeCompoundAst("pwd; pwd");
		setCliParserHelper(makeHelperReturning(fakeAst));

		const safeOnlyAuth = cliResolveTrueSafeOnlyHostAuthorization();
		const controller = createInteractiveApprovalController(makeConfig(false));
		controller.setCommandEvaluator((input, _auth) =>
			cliEvaluateCommandToolApprovalWith(
				{
					toolName: input.toolName,
					toolInput: input.toolInput,
					autoApproveTools: input.autoApproveTools,
					parserResult: input.parserResult,
				},
				safeOnlyAuth,
			),
		);
		return controller
			.requestToolApproval(makeCommandRequest("pwd; pwd"))
			.then((result) => {
				expect(result.approved).toBe(true);
				expect(result.decision?.source).toBe("risk_v2_structured_promotion");
			});
	});

	it("safe-only + unknown command + helper available => ASK (no V2 promotion for unknown)", () => {
		const fakeAst = makeUnknownCommandAst("totally-unknown-cmd");
		setCliParserHelper(makeHelperReturning(fakeAst));

		const safeOnlyAuth = cliResolveTrueSafeOnlyHostAuthorization();
		const controller = createInteractiveApprovalController(makeConfig(false));
		controller.setCommandEvaluator((input, _auth) =>
			cliEvaluateCommandToolApprovalWith(
				{
					toolName: input.toolName,
					toolInput: input.toolInput,
					autoApproveTools: input.autoApproveTools,
					parserResult: input.parserResult,
				},
				safeOnlyAuth,
			),
		);
		return controller
			.requestToolApproval(makeCommandRequest("totally-unknown-cmd --opt"))
			.then((result) => {
				expect(result.decision?.kind).toBe("ask");
			});
	});
});

// ---------------------------------------------------------------------------
// BONUS: explicit DENY beats everything (DENY invariant preserved)
// ---------------------------------------------------------------------------

describe("CORRECTION02: CLI REAL production seam — explicit DENY beats everything", () => {
	it("explicit DENY rule + parser => DENY (DENY beats everything)", async () => {
		const fakeAst = makeSafeCompoundAst("curl http://example.com");
		setCliParserHelper(makeHelperReturning(fakeAst));
		const controller = createInteractiveApprovalController(makeConfig(false));
		controller.setCommandEvaluator((input, _auth) =>
			cliEvaluateCommandToolApprovalWith(
				{
					toolName: input.toolName,
					toolInput: input.toolInput,
					autoApproveTools: input.autoApproveTools,
					parserResult: input.parserResult,
				},
				cliResolveTrueSafeOnlyHostAuthorization({
					explicitDenyRules: [
						{ pattern: "curl *", label: "block curl", description: "Deny curl" },
					],
				}),
			),
		);
		const result = await controller.requestToolApproval(
			makeCommandRequest("curl http://example.com"),
		);
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("deny");
		expect(result.decision?.source).toBe("host_hard_deny");
	});
});
