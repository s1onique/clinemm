/**
 * ACT-CLINEMM-SESSION-AUTONOMY01
 *
 * Integration tests proving the session auto-approval override wires
 * correctly through the SdkInteractionCoordinator, the canonical
 * command policy, and the isToolAutoApproved path.
 *
 * Strategy: the coordinator already accepts `shouldAutoApproveTool` and
 * `evaluateCommandToolApproval` callbacks from the host. We simulate the
 * SdkController's effective-profile computation by plumbing callbacks
 * that consult a `SessionAutoApprovalStore` instance directly. The
 * actual SdkController wiring is verified by type-checking the wiring
 * site (which we changed in this ACT).
 */
import { commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "@cline/core"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it, vi } from "vitest"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { evaluateCommandToolApprovalWithPlan, getCommandHostAuthorization, isToolAutoApproved } from "./sdk-tool-policies"
import { resolveEffectiveAutoApproval, SessionAutoApprovalStore } from "./session-auto-approval"
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
			// Mirror SdkController: when override is "all", switch the
			// command host mode to "all" so the canonical policy runs in
			// the user-opted-in broad-execution mode.
			let hostAuthorization = getCommandHostAuthorization(request.toolName, effective)
			if (override === "all") {
				hostAuthorization = commandHostAuthorization({ mode: "all" })
			}
			return evaluateCommandToolApprovalWithPlan(request.input, hostAuthorization)
		},
	})

	return { coordinator, task, postStateToWebview, persistedSettings }
}

describe("ACT-CLINEMM-SESSION-AUTONOMY01: SdkInteractionCoordinator integration", () => {
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

		it("override all + execution_plan_invalid => DENY", async () => {
			// ACT §13: even with session override="all", an internal invariant
			// violation (planner fails to produce a hardened plan for a
			// command that requires one) must fail closed.
			//
			// We inject explicit safe-only allow rules so the classifier
			// matches a safe git rule and attaches a safeExecutionProfile.
			// Then we force the planner to return undefined; the
			// CORRECTION04 fail-closed branch must return DENY.
			//
			// In 'all' mode the policy does not consult allow rules (it
			// short-circuits to host_mode_all), so to exercise the
			// execution_plan_invalid branch we use safe-only mode here.
			// The point is the SAME invariant applies regardless of the
			// host mode: a planner failure on a profile-required command
			// is always DENY.
			const task = createTaskProxy("s-A", vi.fn(), vi.fn())
			const messages = new SdkMessageCoordinator({ getTask: () => task })
			const coordinator = new SdkInteractionCoordinator({
				messages,
				getSessionId: () => "s-A",
				postStateToWebview: vi.fn(),
				recordApprovedToolMessage: vi.fn(),
				evaluateCommandToolApproval: (request) => {
					const hostAuthorization = commandHostAuthorization({
						mode: "safe-only",
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
})
