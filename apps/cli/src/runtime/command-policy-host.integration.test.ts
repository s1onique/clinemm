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

	it("autoApproveTools=false + ANY command + model=false => rejected (documented CLI contract)", async () => {
		// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
		// CORRECTION02 (Phase 2 reviewer HALT_CLI_EXPLICIT_NO_AUTO_APPROVE_CONTRACT_BROKEN):
		// `--auto-approve false` is documented as
		// "Require approval before each tool call". This production
		// path test confirms that even a safe command (`pwd`) ASKs
		// the user when `--auto-approve false` is active. The V2
		// parser is NOT allowed to manufacture auto-approval from
		// an explicit manual-mode opt-out.
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
		expect(result.approved).toBe(false);
		expect(result.decision?.source).toBe("host_mode_manual");
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
