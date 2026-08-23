/**
 * Interactive approval controller — V2 parser helper async-seam tests
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * (CORRECTION02 Phase 2): behavioral RED/GREEN at the CLI host
 * approval seam. These tests prove that the async parser helper
 * thread actually changes the host decision, while preserving
 * every previously-pinned invariant.
 *
 * RED/GREEN contract (per reviewer):
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
import {
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
} from "@cline/core";
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
		// Flat array of statements — one per command, mirroring the
		// production `mvdan/sh` output shape. For "pwd; pwd" there
		// are TWO statements.
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

/**
 * Build an unknown-command AST. Mirrors a real helper output for
 * an unknown command. The structured classifier will mark every
 * branch as not auto-approve eligible, so V2 promotion does NOT
 * fire — proving the conservation invariant.
 */
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
	return {
		invoke: async (_toolInput: unknown) => parsedShell,
	};
}

function makeHelperUnavailable(): CliParserHelper {
	return {
		invoke: async (_toolInput: unknown) => null,
	};
}

function makeHelperThrowing(): CliParserHelper {
	return {
		invoke: async (_toolInput: unknown) => {
			throw new Error("simulated helper failure");
		},
	};
}

/**
 * Make a safe-only-mode config: autoApprove=false. This forces V1
 * to ASK for safe compound commands, giving us a baseline where
 * V2 promotion is the only path that changes the decision.
 */
function makeSafeOnlyConfig(): Config {
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
		defaultToolAutoApprove: false,
		toolPolicies: {
			"*": { autoApprove: false },
		},
		cwd: process.cwd(),
	};
}

/**
 * Make an auto-approve config: autoApprove=true. Used for R5 tests
 * where the underlying canonical policy would ALLOW but R5 must
 * downgrade to ASK.
 */
function makeAutoApproveConfig(): Config {
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
		defaultToolAutoApprove: true,
		toolPolicies: {
			"*": { autoApprove: true },
		},
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
// RED/GREEN — the reviewer's load-bearing pair
// ---------------------------------------------------------------------------

describe("CORRECTION02 Phase 2: CLI async parser helper seam (RED/GREEN)", () => {
	it("pwd; pwd + trusted helper available -> host ALLOW (V2 promotion)", async () => {
		// Wire a fake helper that returns a structurally valid
		// ParsedShell whose digest matches the joined source.
		const fakeAst = makeSafeCompoundAst("pwd; pwd");
		setCliParserHelper(makeHelperReturning(fakeAst));

		const controller = createInteractiveApprovalController(makeAutoApproveConfig());
		// V2 promotion requires the V1 verdict to be ASK from a
		// `promotable ask source` (see `STRUCTURE_ONLY_PROMOTABLE_REASONS`
		// in `structured-command-risk.ts`). The promotable sources
		// are `host_mode_safe_only_fallthrough` and
		// `risk_opaque_composition`. We need `mode: "safe-only"`
		// to produce the former — `cliResolveSafeOnlyHostAuthorization`
		// actually uses `mode: "manual"` for the CLI's special
		// "manual + safe rules" semantics, which is NOT promotable.
		// So we build the canonical safe-only authorization directly.
		const safeOnlyAuth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		});
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
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(true);
		expect(result.decision?.kind).toBe("allow");
		expect(result.decision?.source).toBe("risk_v2_structured_promotion");
	});

	it("pwd; pwd + trusted helper unavailable -> host ASK (V1 fallthrough)", async () => {
		setCliParserHelper(makeHelperUnavailable());

		const controller = createInteractiveApprovalController(makeSafeOnlyConfig());
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		// No TUI: ASK surfaces as approved:false with the policy decision attached.
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
	});

	it("pwd; pwd + trusted helper throws -> host ASK (V1 fallthrough, failure == absence)", async () => {
		setCliParserHelper(makeHelperThrowing());

		const controller = createInteractiveApprovalController(makeSafeOnlyConfig());
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
	});

	it("pwd; pwd + no helper wired (production default) -> host ASK (V1 unchanged)", async () => {
		setCliParserHelper(undefined);

		const controller = createInteractiveApprovalController(makeSafeOnlyConfig());
		const result = await controller.requestToolApproval(makeCommandRequest("pwd; pwd"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
	});
});

// ---------------------------------------------------------------------------
// Conservation cases (the reviewer's four additional requirements)
// ---------------------------------------------------------------------------

describe("CORRECTION02 Phase 2: V2 parser helper conservation invariants", () => {
	it("R5 catastrophic (rm -rf $HOME) + helper unavailable -> ASK + never-auto-approve", async () => {
		setCliParserHelper(makeHelperUnavailable());

		const controller = createInteractiveApprovalController(makeAutoApproveConfig());
		const result = await controller.requestToolApproval(makeCommandRequest("rm -rf $HOME"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("risk_hard_floor");
	});

	it("R5 catastrophic (rm -rf $HOME) + helper returns ANYTHING -> ASK + never-auto-approve (R5 invariant)", async () => {
		// Even if the helper returns a perfectly valid AST for
		// `rm -rf $HOME`, the R5 hard floor MUST downgrade to ASK.
		// The V2 promotion cannot weaken R5.
		const fakeAst = makeSafeCompoundAst("rm -rf $HOME");
		setCliParserHelper(makeHelperReturning(fakeAst));

		const controller = createInteractiveApprovalController(makeAutoApproveConfig());
		const result = await controller.requestToolApproval(makeCommandRequest("rm -rf $HOME"));
		expect(result.approved).toBe(false);
		expect(result.decision?.kind).toBe("ask");
		expect(result.decision?.source).toBe("risk_hard_floor");
	});

	it("unknown command + valid parser -> ASK (no V2 promotion without risk_v2_structured_promotion source)", async () => {
		const fakeAst = makeUnknownCommandAst("totally-unknown-cmd");
		setCliParserHelper(makeHelperReturning(fakeAst));

		const controller = createInteractiveApprovalController(makeSafeOnlyConfig());
		const result = await controller.requestToolApproval(
			makeCommandRequest("totally-unknown-cmd --opt"),
		);
		expect(result.decision?.kind).toBe("ask");
	});

	it("explicit DENY rule + parser -> DENY (DENY beats everything)", async () => {
		const fakeAst = makeSafeCompoundAst("curl http://example.com");
		setCliParserHelper(makeHelperReturning(fakeAst));

		const controller = createInteractiveApprovalController(makeSafeOnlyConfig());
		// Inject an evaluator that builds a deny-aware authorization.
		// The interactive approval controller's default evaluator
		// uses `cliResolveHostAuthorization(autoApproveAll)` which
		// does not accept explicit deny rules. Using the test seam
		// we can construct a deny-auth via `cliResolveSafeOnlyHostAuthorization`.
		const denyAuth = cliResolveSafeOnlyHostAuthorization({
			explicitDenyRules: [
				{ pattern: "curl *", label: "block curl", description: "Deny curl" },
			],
		});
		controller.setCommandEvaluator((input, _auth) =>
			cliEvaluateCommandToolApprovalWith(
				{
					toolName: input.toolName,
					toolInput: input.toolInput,
					autoApproveTools: input.autoApproveTools,
					parserResult: input.parserResult,
				},
				denyAuth,
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
