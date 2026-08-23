import type { ToolApprovalRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { Config } from "../../utils/types";
import { createInteractiveApprovalController } from "./approvals";

function makeConfig(autoApprove = true): Config {
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
		toolPolicies: {
			"*": { autoApprove },
		},
		cwd: process.cwd(),
	};
}

function makeRequest(
	policy: ToolApprovalRequest["policy"],
): ToolApprovalRequest {
	return {
		sessionId: "session-1",
		agentId: "agent-1",
		conversationId: "conversation-1",
		iteration: 1,
		toolCallId: "tool-1",
		toolName: "read_file",
		input: {},
		policy,
	};
}

describe("createInteractiveApprovalController", () => {
	it("approves requests when global auto-approve is enabled", async () => {
		const controller = createInteractiveApprovalController(makeConfig(true));

		await expect(
			controller.requestToolApproval(makeRequest({ autoApprove: undefined })),
		).resolves.toEqual({ approved: true });
	});

	it("uses the TUI approver when global auto-approve is disabled", async () => {
		const controller = createInteractiveApprovalController(makeConfig(false));
		controller.tuiToolApprover.current = async () => ({
			approved: false,
			reason: "no",
		});

		await expect(
			controller.requestToolApproval(makeRequest({ autoApprove: false })),
		).resolves.toEqual({ approved: false, reason: "no" });
	});

	it("approves stale required-approval requests after auto-approve is enabled", async () => {
		const controller = createInteractiveApprovalController(makeConfig(false));
		controller.tuiToolApprover.current = async () => ({
			approved: false,
			reason: "stale prompt",
		});

		controller.setInteractiveAutoApprove(true);

		await expect(
			controller.requestToolApproval(makeRequest({ autoApprove: false })),
		).resolves.toEqual({ approved: true });
	});

	it("denies approval-required requests when no TUI approver is available", async () => {
		const controller = createInteractiveApprovalController(makeConfig(false));

		await expect(
			controller.requestToolApproval(makeRequest({ autoApprove: false })),
		).resolves.toMatchObject({ approved: false });
	});

	it("updates live tool policies when interactive auto-approve changes", () => {
		const config = makeConfig(false);
		const controller = createInteractiveApprovalController(config);

		controller.setInteractiveAutoApprove(true);

		expect(controller.autoApproveAllRef.current).toBe(true);
		expect(config.defaultToolAutoApprove).toBe(false);
		expect(config.toolPolicies["*"]?.autoApprove).toBe(true);
		expect(controller.resolveToolPolicy("run_commands").autoApprove).toBe(true);
	});
});

describe("CORRECTION04: ASK -> user YES preserves CommandExecutionPlan", () => {
	function makeCommandRequest(
		toolInput: Record<string, unknown>,
	): ToolApprovalRequest {
		return {
			sessionId: "session-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 1,
			toolCallId: "tool-corr-cmd",
			toolName: "run_commands",
			input: toolInput,
			policy: { autoApprove: false },
		};
	}

	it("ASK on git diff with model escalation -> user YES -> plan re-emitted (hardened argv survives)", async () => {
		// CORRECTION01 (Phase 2 reviewer HALT_PHASE2_PRODUCTION_SEAM_NOT_PROVEN):
		// production CLI now uses `mode: "safe-only"` (not `manual`).
		// `git diff --stat` positively matches the safe-rule allow
		// list, so the canonical policy auto-approves with
		// `host_mode_safe_only_rule`. To exercise the ASK → user YES
		// path, we add `requires_approval: true` (model escalation):
		// the rule still matches (positive SafeExecutionProfile) but
		// the model hint downgrades ALLOW → ASK. The plan travels
		// through the user approval flow.
		const controller = createInteractiveApprovalController(makeConfig(false));
		// TUI approver approves WITHOUT supplying a plan; the controller
		// must re-emit the pending plan that the canonical command
		// policy produced before ASK was decided.
		controller.setToolApprover(async () => ({ approved: true }));
		const request = makeCommandRequest({
			command: "git diff --stat",
			requires_approval: true,
		});
		const result = await controller.requestToolApproval(request);
		expect(result.approved).toBe(true);
		// The hardened-argv assertion is exercised by the
		// command-policy-host.test.ts safe-only test below.
		expect(result.executionPlan).toBeDefined();
	});

	it("user NO -> no plan survives (rejection path)", async () => {
		const controller = createInteractiveApprovalController(makeConfig(false));
		controller.setToolApprover(async () => ({
			approved: false,
			reason: "user said no",
		}));
		// Use git diff --stat WITH model escalation so the canonical
		// policy returns ASK (not ALLOW) and routes to TUI.
		const request = makeCommandRequest({
			command: "git diff --stat",
			requires_approval: true,
		});
		const result = await controller.requestToolApproval(request);
		expect(result.approved).toBe(false);
		expect(result.executionPlan).toBeUndefined();
		expect(result.reason).toBe("user said no");
	});

	it("non-command tool ASK -> user YES -> no plan (legacy path unchanged)", async () => {
		const controller = createInteractiveApprovalController(makeConfig(false));
		controller.setToolApprover(async () => ({ approved: true }));
		const request = makeRequest({ autoApprove: false });
		const result = await controller.requestToolApproval(request);
		expect(result.approved).toBe(true);
		expect(result.executionPlan).toBeUndefined();
	});

describe("CORRECTION04 DENY: hard DENY must not reach TUI approver", () => {
	it("explicit DENY -> TUI approver NOT called -> approved=false", async () => {
		// The CLI approval layer checks decision.kind before routing to the
		// TUI approver. A host_hard_deny verdict must NOT reach the TUI,
		// even if the TUI spy would return approved=true.
		// CORRECTION04: use setCommandEvaluator to inject explicit DENY
		// directly into the approval controller, bypassing normal auth.
		const controller = createInteractiveApprovalController(makeConfig(false));
		let tuiCalled = false;
		controller.setToolApprover(async () => {
			tuiCalled = true;
			return { approved: true }; // spy would approve if called
		});
		// Inject an explicit DENY evaluator for run_commands with curl.
		// CORRECTION02 Phase 2: the test seam signature widened to
		// match `cliEvaluateCommandToolApprovalWith(input, auth)` so
		// tests can simulate the full composition path.
		controller.setCommandEvaluator((_input, _auth) => ({
			approved: false,
			reason: "curl is denied",
			decision: {
				kind: "deny" as const,
				source: "host_hard_deny",
				reason: "curl is denied",
			},
		}));
		const approvalResult = await controller.requestToolApproval({
			sessionId: "session-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 1,
			toolCallId: "tool-deny",
			toolName: "run_commands",
			input: { command: "curl http://evil.com" },
			policy: { autoApprove: false },
		});
		// DENY must resolve immediately; TUI was never consulted.
		expect(approvalResult.approved).toBe(false);
		expect(approvalResult.decision?.kind).toBe("deny");
		expect(tuiCalled).toBe(false);
	});
});

});
