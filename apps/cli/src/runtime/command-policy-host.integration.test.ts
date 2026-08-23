/**
 * CLI Command Policy Production Integration Test
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 *
 * End-to-end proof that the CLI's production tool-policy construction
 * (via `buildCliToolPolicies` + `cliEvaluateCommandToolApproval`) wires the
 * canonical command policy through the CLI's `requestToolApproval`
 * callback without test-side reconstruction.
 *
 * This test constructs a real `createInteractiveApprovalController`
 * (the production controller used by `run-interactive.ts`) and exercises
 * it for both `autoApproveTools=true` and `autoApproveTools=false`.
 */
import { describe, expect, it } from "vitest";

import type { Config } from "../utils/types";
import { buildCliToolPolicies } from "./command-policy-host";
import { createInteractiveApprovalController } from "./interactive/approvals";

function makeConfig(wildcardAutoApprove: boolean): Config {
	const policies = buildCliToolPolicies({ wildcardAutoApprove });
	return {
		toolPolicies: policies,
	} as unknown as Config;
}

describe("CLI production controller — command policy wiring", () => {
	it("autoApproveTools=true + dangerous R5 command + model=false => R5 hard floor downgrades to ASK", async () => {
		// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01: even with
		// autoApproveTools=true and model=false, an R5 catastrophic
		// command (rm -rf /) MUST be downgraded to ASK with
		// disposition never-auto-approve. The user opted in to
		// autonomous execution, but the hard floor is a
		// higher-priority safety invariant than YOLO mode.
		const config = makeConfig(true);
		const controller = createInteractiveApprovalController(config);

		const result = await controller.requestToolApproval({
			toolName: "run_commands",
			input: { command: "rm -rf /", requires_approval: false },
			policy: { autoApprove: false },
			sessionId: "test-session",
			agentId: "test-agent",
			conversationId: "test-conv",
			iteration: 0,
			toolCallId: "test-call",
		});
		expect(result.approved).toBe(false);
		expect(result.decision?.source).toBe("risk_hard_floor");
	});

	it("autoApproveTools=true + dangerous command + model=true => rejected (model escalation)", async () => {
		const config = makeConfig(true);
		const controller = createInteractiveApprovalController(config);

		const result = await controller.requestToolApproval({
			toolName: "run_commands",
			input: { command: "rm -rf /", requires_approval: true },
			policy: { autoApprove: false },
			sessionId: "test-session",
			agentId: "test-agent",
			conversationId: "test-conv",
			iteration: 0,
			toolCallId: "test-call",
		});
		expect(result.approved).toBe(false);
	});

	it("autoApproveTools=false + non-safe command (npm install) + model=false => ASK (safe-only fallthrough)", async () => {
		// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
		// CORRECTION01 (Phase 2 reviewer HALT_PHASE2_PRODUCTION_SEAM_NOT_PROVEN):
		// production CLI now uses `mode: "safe-only"` (not `manual`)
		// when `autoApproveTools=false`. Safe commands like `pwd`,
		// `git status`, `git diff` auto-allow via
		// `host_mode_safe_only_rule`; non-safe commands like
		// `npm install` ASK via `host_mode_safe_only_fallthrough`.
		const config = makeConfig(false);
		const controller = createInteractiveApprovalController(config);

		const result = await controller.requestToolApproval({
			toolName: "run_commands",
			input: { command: "npm install", requires_approval: false },
			policy: { autoApprove: false },
			sessionId: "test-session",
			agentId: "test-agent",
			conversationId: "test-conv",
			iteration: 0,
			toolCallId: "test-call",
		});
		expect(result.approved).toBe(false);
		expect(result.decision?.source).toBe("host_mode_safe_only_fallthrough");
	});

	it("autoApproveTools=false + safe command (pwd) + model=false => ALLOW (safe-only rule matched)", async () => {
		// New positive test for the corrected CLI auth semantics.
		const config = makeConfig(false);
		const controller = createInteractiveApprovalController(config);

		const result = await controller.requestToolApproval({
			toolName: "run_commands",
			input: { command: "pwd", requires_approval: false },
			policy: { autoApprove: false },
			sessionId: "test-session",
			agentId: "test-agent",
			conversationId: "test-conv",
			iteration: 0,
			toolCallId: "test-call",
		});
		expect(result.approved).toBe(true);
		expect(result.decision?.source).toBe("host_mode_safe_only_rule");
	});

	it("autoApproveTools=true + execute_command alias => same as run_commands (R5 hard floor fires)", async () => {
		const config = makeConfig(true);
		const controller = createInteractiveApprovalController(config);

		const result = await controller.requestToolApproval({
			toolName: "execute_command",
			input: { command: "rm -rf /", requires_approval: false },
			policy: { autoApprove: false },
			sessionId: "test-session",
			agentId: "test-agent",
			conversationId: "test-conv",
			iteration: 0,
			toolCallId: "test-call",
		});
		expect(result.approved).toBe(false);
		expect(result.decision?.source).toBe("risk_hard_floor");
	});

	it("non-command tools retain legacy autoApproveAll behavior", async () => {
		const config = makeConfig(true);
		const controller = createInteractiveApprovalController(config);

		const result = await controller.requestToolApproval({
			toolName: "read_files",
			input: { path: "/tmp/x" },
			policy: { autoApprove: false },
			sessionId: "test-session",
			agentId: "test-agent",
			conversationId: "test-conv",
			iteration: 0,
			toolCallId: "test-call",
		});
		// Non-command tools follow the wildcard autoApprove path; approved
		// when autoApproveAll is true.
		expect(result.approved).toBe(true);
	});
});
