/**
 * Interactive approval controller — V2 parser helper async-seam tests
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * CORRECTION01 (Phase 2 reviewer HALT_PHASE2_PRODUCTION_SEAM_NOT_PROVEN):
 *
 * REAL production path tests. No `setCommandEvaluator()` override.
 * Uses the production `createInteractiveApprovalController`,
 * `cliResolveHostAuthorization` (via the controller's internal
 * wiring), and `requestToolApproval`. The fake helper is the ONLY
 * seam injected.
 *
 * RED/GREEN contract:
 *
 *   trusted helper returns bound safe AST  ->  ALLOW (for pwd; pwd)
 *   trusted helper unavailable              ->  ASK   (for pwd; pwd)
 *
 * Plus four conservation cases:
 *
 *   R5 catastrophic (rm -rf $HOME) + helper unavailable
 *     -> ASK + never-auto-approve
 *
 *   R5 catastrophic (rm -rf $HOME) + helper returns ANYTHING
 *     -> ASK + never-auto-approve (cannot weaken R5)
 *
 *   unknown command + valid parser
 *     -> ASK (no V2 promotion for unknown commands)
 *
 *   explicit DENY rule + parser
 *     -> DENY (DENY beats everything)
 *
 * These tests drive the production `requestToolApproval` path,
 * not the pure `cliEvaluateCommandToolApprovalWith` function —
 * because the async seam is at the interactive controller, NOT
 * in the pure function (per Phase 1 architectural decision).
 */

import { afterEach, describe, expect, it } from "vitest";

import type { ToolApprovalRequest } from "@cline/shared";
import type { Config } from "../../utils/types";
import { joinRunCommandsForParse, STRUCTURED_PROTO_VERSION } from "@cline/core/internal/command-risk-internal";
import { createHash } from "node:crypto";

import {
	cliEvaluateCommandToolApprovalWith,
	cliResolveSafeOnlyHostAuthorization,
} from "../command-policy-host";
import { createInteractiveApprovalController, setCliParserHelper, type CliParserHelper } from "./approvals";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Build a structurally valid ParsedShell for the given toolInput.
 * Computes the exact SHA-256 digest the runtime expects.
 * Mirrors the `mkParsed` helper used in
 * `structured-command-risk-integration.test.ts`.
 */
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
 * CORRECTION01, production CLI now uses `mode: "safe-only"` (not
 * `manual`) when `autoApproveTools=false`. Safe commands like
 * `pwd` auto-allow via `host_mode_safe_only_rule`; non-safe
 * commands like `pwd; pwd` ASK via
 * `host_mode_safe_only_fallthrough` — which is the promotable
 * ASK source for V2.
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
// RED/GREEN — the load-bearing pair (REAL path, no setCommandEvaluator override)
// ---------------------------------------------------------------------------

describe("CORRECTION01: CLI REAL production seam (no setCommandEvaluator override)", () => {
	it("pwd; pwd + trusted helper available -> host ALLOW (V2 promotion)", async () => {
		// production config: --auto-approve=false -> cliResolveHostAuthorization(false) = safe-only
		// fake trusted helper returns a structurally valid AST
		const fakeAst = makeSafeCompoundAst("pwd; pwd");
		setCliParserHelper(makeHelperReturning(fakeAst));

		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(true);
		expect(result.decision?.source).toBe("risk_v2_structured_promotion");
	});

	it("pwd; pwd + trusted helper unavailable -> host ASK (V1 fallthrough)", async () => {
		setCliParserHelper(makeHelperUnavailable());

		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("host_mode_safe_only_fallthrough");
	});

	it("pwd; pwd + trusted helper throws -> host ASK (V1 fallthrough, failure == absence)", async () => {
		setCliParserHelper(makeHelperThrowing());

		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("host_mode_safe_only_fallthrough");
	});

	it("pwd; pwd + no helper wired (production default) -> host ASK (V1 unchanged)", async () => {
		setCliParserHelper(undefined);

		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("host_mode_safe_only_fallthrough");
	});
});

// ---------------------------------------------------------------------------
// Conservation cases (REAL path)
// ---------------------------------------------------------------------------

describe("CORRECTION01: CLI REAL production seam — V2 conservation invariants", () => {
	it("R5 catastrophic (rm -rf $HOME) + helper unavailable -> ASK + never-auto-approve", async () => {
		setCliParserHelper(makeHelperUnavailable());
		const controller = createInteractiveApprovalController(makeConfig(true));
		const result = await controller.requestToolApproval(makeCommandRequest("rm -rf $HOME"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("risk_hard_floor");
	});

	it("R5 catastrophic (rm -rf $HOME) + helper returns ANYTHING -> ASK + never-auto-approve (R5 invariant)", async () => {
		const fakeAst = makeSafeCompoundAst("rm -rf $HOME");
		setCliParserHelper(makeHelperReturning(fakeAst));
		const controller = createInteractiveApprovalController(makeConfig(true));
		const result = await controller.requestToolApproval(makeCommandRequest("rm -rf $HOME"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("risk_hard_floor");
	});

	it("unknown command + valid parser -> ASK (no V2 promotion)", async () => {
		const fakeAst = makeUnknownCommandAst("totally-unknown-cmd");
		setCliParserHelper(makeHelperReturning(fakeAst));
		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(
			makeCommandRequest("totally-unknown-cmd --opt"),
		);
		expect(result.decision?.kind).toBe("ask");
	});

	it("explicit DENY rule + parser -> DENY (DENY beats everything)", async () => {
		// DENY test uses the test seam ONLY for explicit deny rules
		// (the production CLI's interactive path does not expose
		// deny-rule injection). This is the legitimate "trust the
		// lower-level API to compose with extra auth" seam — not
		// a substitute for production wiring.
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
				cliResolveSafeOnlyHostAuthorization({
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

// ---------------------------------------------------------------------------
// ABLATION tests — verify the helper is actually doing something
// ---------------------------------------------------------------------------

describe("CORRECTION01: ABLATION — without helper, safe compound returns ASK (V1 path is reachable)", () => {
	it("ablated: pwd; pwd + no helper + safe-only auth = ASK", async () => {
		// No helper. V1 (safe-only fallthrough) is the entire path.
		setCliParserHelper(undefined);
		const controller = createInteractiveApprovalController(makeConfig(false));
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.source).toBe("host_mode_safe_only_fallthrough");
		// V2 source is NOT present (V2 is dormant without helper).
		expect(result.decision?.source).not.toBe("risk_v2_structured_promotion");
	});
});
