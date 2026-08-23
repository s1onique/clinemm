/**
 * VSCode — V2 parser helper async-seam tests
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * (CORRECTION02 Phase 2): behavioral RED/GREEN at the VSCode host
 * approval seam. These tests exercise the production callback
 * shape (snapshot toolInput, await helper, thread result to
 * `evaluateCommandToolApprovalWithPlan`) — the same composition
 * the `SdkController` callback uses in production.
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
 * Tests invoke the callback directly (NOT through
 * `handleRequestToolApproval`) because the coordinator's ASK path
 * blocks waiting for a pending tool-approval resolution; the
 * callback itself is what we need to verify for the async seam.
 */

import { createHash } from "node:crypto"
import { commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "@cline/core"
import { joinRunCommandsForParse, STRUCTURED_PROTO_VERSION } from "@cline/core/internal/command-risk-internal"
import type { ToolApprovalRequest } from "@cline/shared"
import { describe, expect, it } from "vitest"

import { evaluateCommandToolApprovalWithPlan } from "./sdk-tool-policies"

// ---------------------------------------------------------------------------
// Test fixtures — deterministic ParsedShell construction
// ---------------------------------------------------------------------------

function makeSafeCompoundAst(toolInput: string): unknown {
	const { joined } = joinRunCommandsForParse(toolInput)
	const digest = createHash("sha256").update(joined).digest("hex")
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
	}
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
	}
}

// ---------------------------------------------------------------------------
// Production-shape callback (mirrors SdkController.evaluateCommandToolApproval)
// ---------------------------------------------------------------------------

type CallbackResult =
	| {
			approved: boolean
			decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
			executionPlan?: unknown
	  }
	| undefined

/**
 * Production-shape callback: snapshots `request.input`, awaits the
 * trusted helper, and threads the result into the pure policy
 * evaluator. This is the EXACT composition pattern used in
 * `SdkController.ts` at the `evaluateCommandToolApproval` callback
 * (see commit `6b7d0cd80`'s SdkController changes for Phase 2).
 */
function makeCallback(
	helper: { invoke(toolInput: unknown): Promise<unknown> } | null,
	authOverrides?: {
		mode?: "all" | "safe-only" | "manual"
		denyRules?: ReadonlyArray<{ pattern: string; label: string; description: string }>
	},
): (request: ToolApprovalRequest) => Promise<CallbackResult> {
	return async (request: ToolApprovalRequest) => {
		if (request.toolName !== "run_commands") {
			return undefined
		}
		// Snapshot invariant: same captured value for both helper
		// and policy evaluation.
		const frozenToolInput = request.input
		let parserResult: unknown
		if (helper) {
			try {
				parserResult = await helper.invoke(frozenToolInput)
			} catch {
				parserResult = undefined
			}
		}
		const auth = commandHostAuthorization({
			mode: authOverrides?.mode ?? "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			explicitDenyRules: authOverrides?.denyRules?.map((r) => ({
				source: r.label,
				pattern: new RegExp(`^${r.pattern.replace(/\*/g, ".*")}`),
			})),
		})
		const result = evaluateCommandToolApprovalWithPlan(frozenToolInput as unknown, auth, {
			parserResult: parserResult as never,
		})
		return {
			approved: result.approved,
			decision: result.decision,
			executionPlan: result.executionPlan,
		}
	}
}

function makeRequest(command: string): ToolApprovalRequest {
	return {
		sessionId: "session-123",
		agentId: "agent",
		conversationId: "conversation",
		iteration: 1,
		toolCallId: `tool-${command.length}`,
		toolName: "run_commands",
		input: { command },
		policy: { autoApprove: false },
	}
}

// ---------------------------------------------------------------------------
// RED/GREEN — the reviewer's load-bearing pair
// ---------------------------------------------------------------------------

describe("VSCode CORRECTION02 Phase 2: async parser helper seam (RED/GREEN)", () => {
	it("pwd; pwd + trusted helper available -> ALLOW (V2 promotion)", async () => {
		const fakeAst = makeSafeCompoundAst("pwd; pwd")
		const helper = { invoke: async (_: unknown) => fakeAst }
		const callback = makeCallback(helper)

		const result = await callback(makeRequest("pwd; pwd"))
		expect(result?.approved).toBe(true)
		// V2 promotion path: `decision` is a `RiskDecision` shape
		// (`source` field, not `kind`). For non-V2 paths, `decision`
		// is a `CommandDecision` shape (`kind` field). We assert on
		// `source` which is present in both.
		expect(result?.decision?.source).toBe("risk_v2_structured_promotion")
	})

	it("pwd; pwd + trusted helper unavailable -> ASK (V1 fallthrough)", async () => {
		const helper = { invoke: async (_: unknown) => null }
		const callback = makeCallback(helper)

		const result = await callback(makeRequest("pwd; pwd"))
		expect(result?.approved).toBe(false)
		expect(result?.decision?.kind).toBe("ask")
	})

	it("pwd; pwd + trusted helper throws -> ASK (V1 fallthrough, failure == absence)", async () => {
		const helper = {
			invoke: async (_: unknown) => {
				throw new Error("simulated helper failure")
			},
		}
		const callback = makeCallback(helper)

		const result = await callback(makeRequest("pwd; pwd"))
		expect(result?.approved).toBe(false)
		expect(result?.decision?.kind).toBe("ask")
	})

	it("pwd; pwd + no helper wired (production default) -> ASK (V1 unchanged)", async () => {
		const callback = makeCallback(null)

		const result = await callback(makeRequest("pwd; pwd"))
		expect(result?.approved).toBe(false)
		expect(result?.decision?.kind).toBe("ask")
	})
})

// ---------------------------------------------------------------------------
// Conservation cases
// ---------------------------------------------------------------------------

describe("VSCode CORRECTION02 Phase 2: V2 parser helper conservation invariants", () => {
	it("R5 catastrophic (rm -rf $HOME) + helper unavailable -> ASK + never-auto-approve", async () => {
		const helper = { invoke: async (_: unknown) => null }
		const callback = makeCallback(helper, { mode: "all" })

		const result = await callback(makeRequest("rm -rf $HOME"))
		expect(result?.approved).toBe(false)
		expect(result?.decision?.kind).toBe("ask")
		expect(result?.decision?.source).toBe("risk_hard_floor")
	})

	it("R5 catastrophic (rm -rf $HOME) + helper returns ANYTHING -> ASK + never-auto-approve (R5 invariant)", async () => {
		const fakeAst = makeSafeCompoundAst("rm -rf $HOME")
		const helper = { invoke: async (_: unknown) => fakeAst }
		const callback = makeCallback(helper, { mode: "all" })

		const result = await callback(makeRequest("rm -rf $HOME"))
		expect(result?.approved).toBe(false)
		expect(result?.decision?.kind).toBe("ask")
		expect(result?.decision?.source).toBe("risk_hard_floor")
	})

	it("unknown command + valid parser -> ASK (no V2 promotion)", async () => {
		const fakeAst = makeUnknownCommandAst("totally-unknown-cmd")
		const helper = { invoke: async (_: unknown) => fakeAst }
		const callback = makeCallback(helper)

		const result = await callback(makeRequest("totally-unknown-cmd --opt"))
		expect(result?.decision?.kind).toBe("ask")
	})

	it("explicit DENY rule + parser -> DENY (DENY beats everything)", async () => {
		const fakeAst = makeSafeCompoundAst("curl http://example.com")
		const helper = { invoke: async (_: unknown) => fakeAst }
		const callback = makeCallback(helper, {
			mode: "all",
			denyRules: [{ pattern: "curl *", label: "block curl", description: "Deny curl" }],
		})

		const result = await callback(makeRequest("curl http://example.com"))
		expect(result?.approved).toBe(false)
		expect(result?.decision?.kind).toBe("deny")
		expect(result?.decision?.source).toBe("host_hard_deny")
	})
})
