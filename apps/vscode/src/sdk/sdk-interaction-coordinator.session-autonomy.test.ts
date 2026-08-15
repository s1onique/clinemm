/**
 * ACT-CLINEMM-SESSION-AUTONOMY01 + ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION01
 *
 * Integration tests proving the session auto-approval override wires
 * correctly through the SdkInteractionCoordinator, the canonical
 * command policy, and the isToolAutoApproved path.
 *
 * CORRECTION01: the tests now mirror the production wiring exactly:
 *
 *   - When override is "all", host authorization is composed with
 *     BOTH `mode: "all"` AND `explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES`
 *     (option B: skip human approval but retain hardened envelopes).
 *     This makes `execution_plan_invalid` reachable on planner failure
 *     even under session autonomy. The previous test used bare `mode:
 *     "all"` (which short-circuits the policy at step 3) and then
 *     substituted `safe-only` to exercise the planner — that
 *     substitution was misleading and is replaced by a real
 *     `mode: "all" + explicitAllowRules` test.
 *   - When override is "all", the `requires_approval` model hint is
 *     stripped before evaluation so model_escalation cannot reintroduce
 *     ASK after the user explicitly opted into ALL.
 *   - The store's pre-arm intent is consumed exactly once when the next
 *     session id is queried.
 */
import { commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "@cline/core"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { McpServer, McpTool } from "@shared/mcp"
import { describe, expect, it, vi } from "vitest"

// Minimal structural type for the McpHub surface the coordinator uses.
// Avoids pulling the full McpHub class (which has heavy VS Code deps).
type McpHubLike = { getServers(): McpServer[] }

import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { evaluateCommandToolApprovalWithPlan, getCommandHostAuthorization, isToolAutoApproved } from "./sdk-tool-policies"
import {
	resolveEffectiveAutoApproval,
	resolveSessionHostAuthorization,
	SessionAutoApprovalStore,
	stripRequiresApproval,
} from "./session-auto-approval"
import { createTaskProxy } from "./task-proxy"

vi.mock("./webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@core/storage/disk", () => ({
	saveClineMessages: vi.fn().mockResolvedValue(undefined),
}))

function makeCoordinator(opts: { sessionId: string; store: SessionAutoApprovalStore }) {
	const task = createTaskProxy(opts.sessionId, vi.fn(), vi.fn())
	const messages = new SdkMessageCoordinator({ getTask: () => task })
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)

	// Mirror the SdkController host wiring: the coordinator's two
	// authority callbacks consult the session override via the resolver.
	const persistedSettings = {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
			readFiles: false,
			editFiles: false,
			useBrowser: false,
			useMcp: false,
		},
	}

	const coordinator = new SdkInteractionCoordinator({
		messages,
		getSessionId: () => opts.sessionId,
		postStateToWebview,
		recordApprovedToolMessage: vi.fn(),
		shouldAutoApproveTool: (request) => {
			const override = opts.store.getOverride(opts.sessionId)
			const effective = resolveEffectiveAutoApproval(persistedSettings, override)
			return isToolAutoApproved(request.toolName, effective)
		},
		evaluateCommandToolApproval: (request) => {
			const override = opts.store.getOverride(opts.sessionId)
			const effective = resolveEffectiveAutoApproval(persistedSettings, override)
			// CORRECTION01: when override is "all", compose host authorization
			// with mode:"all" AND explicitAllowRules so the canonical policy
			// still consults allow rules first (option B). Strip
			// requires_approval so model escalation cannot reintroduce ASK.
			let hostAuthorization = getCommandHostAuthorization(request.toolName, effective)
			let toolInput = request.input
			if (override === "all") {
				const sessionHostAuth = resolveSessionHostAuthorization(hostAuthorization, override)
				if (sessionHostAuth) {
					hostAuthorization = sessionHostAuth
				}
				toolInput = stripRequiresApproval(request.input)
			}
			return evaluateCommandToolApprovalWithPlan(toolInput, hostAuthorization)
		},
	})

	return { coordinator, task, postStateToWebview, persistedSettings }
}

describe("ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION01: SdkInteractionCoordinator integration", () => {
	describe("non-command tools: override=none => old per-category behavior", () => {
		it("Read disabled => approval UI opened", async () => {
			const store = new SessionAutoApprovalStore()
			const { coordinator, task } = makeCoordinator({ sessionId: "s-A", store })
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "c",
				iteration: 1,
				toolCallId: "tc-1",
				toolName: "read_files",
				input: { path: "README.md" },
				policy: { autoApprove: false },
			})
			await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
			expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
			await expect(promise).resolves.toEqual({ approved: true })
		})
	})

	describe("non-command tools: override=all => auto-approved even when persisted category disabled", () => {
		it("Read disabled + override all => auto-approved without approval UI", async () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all")
			const { coordinator, task } = makeCoordinator({ sessionId: "s-A", store })
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "c",
				iteration: 1,
				toolCallId: "tc-2",
				toolName: "read_files",
				input: { path: "README.md" },
				policy: { autoApprove: false },
			})
			await expect(promise).resolves.toEqual({ approved: true })
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("Edit disabled + override all => auto-approved without approval UI", async () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all")
			const { coordinator, task } = makeCoordinator({ sessionId: "s-A", store })
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "c",
				iteration: 1,
				toolCallId: "tc-3",
				toolName: "editor",
				input: { path: "a.ts", old_text: "a", new_text: "b" },
				policy: { autoApprove: false },
			})
			await expect(promise).resolves.toEqual({ approved: true })
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("Web disabled + override all => auto-approved without approval UI", async () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all")
			const { coordinator, task } = makeCoordinator({ sessionId: "s-A", store })
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "c",
				iteration: 1,
				toolCallId: "tc-4",
				toolName: "fetch_web_content",
				input: { url: "https://example.com" },
				policy: { autoApprove: false },
			})
			await expect(promise).resolves.toEqual({ approved: true })
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})
	})

	describe("command tools: override=all places host in 'all' mode", () => {
		it("ordinary unsafe-but-not-hard-denied command + override all => ALLOW", async () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all")
			const { coordinator, task } = makeCoordinator({ sessionId: "s-A", store })
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "c",
				iteration: 1,
				toolCallId: "tc-cmd-1",
				toolName: "run_commands",
				input: { command: "rm -rf /", requires_approval: false },
				policy: {},
			})
			await expect(promise).resolves.toMatchObject({
				approved: true,
				decision: { kind: "allow" },
			})
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("safe-only persisted + override all => ALLOW (override wins over safe-only mode)", async () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all")
			const { coordinator, task } = makeCoordinator({ sessionId: "s-A", store })
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "c",
				iteration: 1,
				toolCallId: "tc-cmd-2",
				toolName: "run_commands",
				input: { command: "rm -rf /", requires_approval: false },
				policy: {},
			})
			await expect(promise).resolves.toMatchObject({
				approved: true,
				decision: { kind: "allow", source: "host_mode_all" },
			})
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})
	})

	describe("command tools: hard DENY must NOT be overridden by session override=all", () => {
		// This is the load-bearing mutation-proof (ACT §36).
		// The override routes commands through the canonical policy in
		// 'all' mode, but a hard-deny rule injected via hostAuthorization
		// (test-only fixture) still DENY. Production has no hard deny
		// source today; this proves the override does NOT bypass the
		// lattice when one exists.
		it("override all + host_hard_deny rule => DENY (no approval UI)", async () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all")
			const task = createTaskProxy("s-A", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			// Use a custom coordinator with a DENY-injecting evaluator.
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "s-A",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: (request) => {
					// Simulate a hard deny rule on `rm -rf` even in 'all' mode.
					const hostAuthorization = {
						mode: "all" as const,
						explicitDenyRules: [{ source: "unit_test_evil", pattern: /^\s*rm\s+-rf/u }],
					}
					return evaluateCommandToolApprovalWithPlan(request.input, hostAuthorization)
				},
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "c",
				iteration: 1,
				toolCallId: "tc-deny-1",
				toolName: "run_commands",
				input: { command: "rm -rf /tmp", requires_approval: false },
				policy: {},
			})
			await expect(promise).resolves.toEqual({
				approved: false,
				reason: expect.stringMatching(/dangerous|deny/i),
			})
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})

		it("override all + execution_plan_invalid => DENY (real mode:all + allow rules)", async () => {
			// CORRECTION01: with override="all", hostAuthorization is composed as
			// { mode: "all", explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES }.
			// The policy's per-command precedence therefore consults allow rules
			// FIRST (step 2) before any mode-based logic (step 3). A command that
			// matches a safe rule gets a safeExecutionProfile; the planner is then
			// invoked; on planner failure the policy must DENY with
			// execution_plan_invalid. This is a REAL mode:"all" test — no
			// safe-only substitution. (The previous test used bare mode:"all"
			// for the override then substituted safe-only for the planner branch,
			// which did not actually prove the override path.)
			const task = createTaskProxy("s-A", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "s-A",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: (request) => {
					const hostAuthorization = commandHostAuthorization({
						mode: "all",
						explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
					})
					return evaluateCommandToolApprovalWithPlan(request.input, hostAuthorization, {
						buildExecutionPlanOverride: () => undefined,
					})
				},
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "c",
				iteration: 1,
				toolCallId: "tc-epi-1",
				toolName: "run_commands",
				input: { command: "git diff --stat", requires_approval: false },
				policy: {},
			})
			await expect(promise).resolves.toMatchObject({
				approved: false,
				reason: expect.stringMatching(/plan/i),
			})
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})
	})

	describe("lifecycle: override clears when task ends", () => {
		it("simulated clearTask destroys the override (next override=query returns none)", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all")
			// Simulate clearTask.
			store.clearSessionAutoApproval()
			expect(store.getOverride("s-A")).toBe("none")
		})

		it("task B begins with a different session id: override bound to task A does NOT leak", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all")
			expect(store.getOverride("s-B")).toBe("none")
		})
	})

	describe("CORRECTION01: model escalation is suppressed under session override=all", () => {
		it("override all + requires_approval=true => ALLOW (not ASK)", async () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all")
			const { coordinator, task } = makeCoordinator({ sessionId: "s-A", store })
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "c",
				iteration: 1,
				toolCallId: "tc-no-escalate",
				toolName: "run_commands",
				input: { command: "rm -rf /", requires_approval: true },
				policy: {},
			})
			await expect(promise).resolves.toMatchObject({
				approved: true,
				decision: { kind: "allow", source: "host_mode_all" },
			})
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})
	})

	describe("CORRECTION02: pre-arm intent + lifecycle separation", () => {
		it("getOverride is PURE: it does NOT consume the arm across reads", async () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride(undefined, "all") // arms
			expect(store.isArmed()).toBe(true)
			// Repeated reads with no consumption must leave the arm intact.
			expect(store.getOverride("s-A")).toBe("none")
			expect(store.getOverride("s-A")).toBe("none")
			expect(store.getOverride("s-B")).toBe("none")
			expect(store.isArmed()).toBe(true)
		})

		it("consumePendingOverride binds the arm to a session id and clears it", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride(undefined, "all")
			const consumed = store.consumePendingOverride("s-A")
			expect(consumed).toBe(true)
			expect(store.isArmed()).toBe(false)
			expect(store.getOverride("s-A")).toBe("all")
			expect(store.getOverride("s-B")).toBe("none") // stale
		})

		it("consumePendingOverride is a no-op when no arm is set", () => {
			const store = new SessionAutoApprovalStore()
			expect(store.consumePendingOverride("s-A")).toBe(false)
			expect(store.getOverride("s-A")).toBe("none")
		})

		it("clearActiveOverride destroys the bound override only (arm survives)", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all") // bind directly
			store.setOverride(undefined, "all") // also arm
			store.clearActiveOverride()
			expect(store.getOverride("s-A")).toBe("none")
			expect(store.isArmed()).toBe(true) // arm survives!
		})

		it("clearPendingArm destroys the arm only (bind survives)", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all") // bind directly
			store.setOverride(undefined, "all") // also arm
			store.clearPendingArm()
			expect(store.isArmed()).toBe(false)
			expect(store.getOverride("s-A")).toBe("all") // bind survives!
		})

		it("clearSessionAutoApproval destroys both (full reset)", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride(undefined, "all")
			store.consumePendingOverride("s-A")
			store.clearSessionAutoApproval()
			expect(store.isArmed()).toBe(false)
			expect(store.getOverride("s-A")).toBe("none")
		})

		it("setOverride(undefined, 'none') clears both arm and bind (UI toggle off)", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride(undefined, "all") // arms
			store.consumePendingOverride("s-X") // binds
			store.setOverride(undefined, "none")
			expect(store.isArmed()).toBe(false)
			expect(store.getOverride("s-X")).toBe("none")
		})
	})

	describe("CORRECTION02: composition over baseAuth preserves explicitDenyRules", () => {
		// This is the P1 fix from the reviewer: a deny rule on the base
		// authorization MUST survive session override=all. CORRECTION01
		// manufactured a fresh authorization and silently dropped the
		// deny rules; this test would fail CORRECTION01.
		it("base explicitDenyRules survive session override=all in the composed auth", async () => {
			const denyRule = { source: "production_deny", pattern: /^\s*rm\s+-rf/u }
			const task = createTaskProxy("s-A", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const store = new SessionAutoApprovalStore()
			store.setOverride("s-A", "all")
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "s-A",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: (request) => {
					// The base auth has an explicit deny rule. Even after
					// composing with the session override=all, the deny rule
					// must remain in the composed authorization.
					const baseAuth = commandHostAuthorization({
						mode: "safe-only",
						explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
						explicitDenyRules: [denyRule],
					})
					const override = store.getOverride("s-A")
					const composed = resolveSessionHostAuthorization(baseAuth, override)
					if (!composed) throw new Error("expected composed auth")
					// Proven invariants on the composed auth:
					expect(composed.explicitDenyRules).toBeDefined()
					expect(composed.explicitDenyRules).toHaveLength(1)
					expect(composed.explicitDenyRules![0]).toEqual(denyRule)
					expect(composed.mode).toBe("all")
					return evaluateCommandToolApprovalWithPlan(request.input, composed)
				},
			})
			const promise = coordinator.handleRequestToolApproval({
				agentId: "agent",
				conversationId: "c",
				iteration: 1,
				toolCallId: "tc-deny-survives",
				toolName: "run_commands",
				input: { command: "rm -rf /tmp", requires_approval: false },
				policy: {},
			})
			await expect(promise).resolves.toMatchObject({
				approved: false,
				reason: expect.stringMatching(/dangerous|deny/i),
			})
			expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
		})
	})
})

// ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03
//
// Real-coordinator proof: drive the production-shaped Figma MCP request
// through the SdkInteractionCoordinator with a mock McpHub. The original
// bug was that `⚡ ALL — this task` did NOT lift the per-tool
// autoApprove gate for ordinary MCP tools (e.g. figma-desktop /
// get_metadata). This block freezes that exact scenario as a regression.
//
// `approvalCallbackCount = 0` is the load-bearing assertion: the UI
// approve/reject prompt must NOT be presented. With the bug present,
// handleRequestToolApproval would mint an `ask: "use_mcp_server"`
// message and await a user decision; with the fix, it resolves
// immediately with `{ approved: true }` and no message is emitted.
describe("ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03: real coordinator proof (Figma MCP)", () => {
	function makeFigmaHub(): McpHubLike {
		const server: McpServer = {
			name: "figma-desktop",
			config: "{}",
			status: "connected",
			tools: [
				{
					name: "get_metadata",
					description: "Get Figma node metadata",
					autoApprove: false, // ← per-tool NOT approved
				} satisfies McpTool,
			],
		}
		return {
			getServers: () => [server],
		}
	}

	// isToolAutoApproved takes the full McpHub type; the structural mock
	// only implements getServers. Cast through the parameter type so the
	// structural contract is what the test actually exercises.
	type McpHubParam = Parameters<typeof isToolAutoApproved>[2]

	function makeMcpCoordinator(opts: { sessionId: string; store: SessionAutoApprovalStore; mcpHub: McpHubLike }) {
		const task = createTaskProxy(opts.sessionId, vi.fn(), vi.fn())
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)

		// Persisted: every AutoApprove category is off. The user has NOT
		// flipped any MCP toggle. The session override is the ONLY signal.
		const persistedSettings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				readFiles: false,
				editFiles: false,
				useBrowser: false,
				useMcp: false,
				executeSafeCommands: false,
				executeAllCommands: false,
			},
		}

		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => opts.sessionId,
			postStateToWebview,
			recordApprovedToolMessage: vi.fn(),
			shouldAutoApproveTool: (request) => {
				const override = opts.store.getOverride(opts.sessionId)
				const effective = resolveEffectiveAutoApproval(persistedSettings, override)
				// Production wiring: the override parameter is the seam
				// that closes the per-tool MCP gate (CORRECTION03).
				return isToolAutoApproved(request.toolName, effective, opts.mcpHub as unknown as McpHubParam, override)
			},
			evaluateCommandToolApproval: () => undefined,
		})

		return { coordinator, task, persistedSettings }
	}

	it("figma-desktop/get_metadata + session ALL + persisted MCP=false => ALLOW, no approval UI", async () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("s-figma", "all")
		const { coordinator, task } = makeMcpCoordinator({
			sessionId: "s-figma",
			store,
			mcpHub: makeFigmaHub(),
		})

		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "c",
			iteration: 1,
			toolCallId: "tc-figma",
			toolName: "figma-desktop__get_metadata",
			input: { nodeId: "38:3072" },
			policy: { autoApprove: false },
		})

		// APPROVAL_CALLBACK_COUNT = 0: no UI message emitted.
		await expect(promise).resolves.toEqual({ approved: true })
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
	})

	it("figma-desktop/get_metadata + override=none + persisted MCP=false => ASK (regression baseline)", async () => {
		const store = new SessionAutoApprovalStore()
		const { coordinator, task } = makeMcpCoordinator({
			sessionId: "s-figma",
			store,
			mcpHub: makeFigmaHub(),
		})

		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "c",
			iteration: 1,
			toolCallId: "tc-figma-ask",
			toolName: "figma-desktop__get_metadata",
			input: { nodeId: "38:3072" },
			policy: { autoApprove: false },
		})

		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promise).resolves.toEqual({ approved: true })
	})

	it("pre-arm ALL → new session consumes ALL → Figma MCP ALLOW on first call", async () => {
		const store = new SessionAutoApprovalStore()
		// Pre-arm: no sessionId yet.
		store.setOverride(undefined, "all")
		expect(store.isArmed()).toBe(true)

		const sessionId = "s-next-task"
		// Authoritative consume (mirrors SdkSessionLifecycle.startNewSession).
		store.consumePendingOverride(sessionId)
		expect(store.isArmed()).toBe(false)
		expect(store.getOverride(sessionId)).toBe("all")

		const { coordinator, task } = makeMcpCoordinator({
			sessionId,
			store,
			mcpHub: makeFigmaHub(),
		})
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "c",
			iteration: 1,
			toolCallId: "tc-figma-prearm",
			toolName: "figma-desktop__get_metadata",
			input: { nodeId: "38:3072" },
			policy: { autoApprove: false },
		})
		await expect(promise).resolves.toEqual({ approved: true })
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
	})

	it("task ends ⇒ persisted MCP behavior restored ⇒ Figma MCP back to ASK", async () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("s-figma", "all")
		// Simulate clearTask choke-point: destroy only the bound override.
		store.clearActiveOverride()

		const { coordinator, task } = makeMcpCoordinator({
			sessionId: "s-figma",
			store,
			mcpHub: makeFigmaHub(),
		})
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent",
			conversationId: "c",
			iteration: 1,
			toolCallId: "tc-figma-restored",
			toolName: "figma-desktop__get_metadata",
			input: { nodeId: "38:3072" },
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promise).resolves.toEqual({ approved: true })
	})
})
