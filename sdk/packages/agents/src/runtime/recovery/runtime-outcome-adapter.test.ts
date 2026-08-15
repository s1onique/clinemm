/**
 * C1.2 adapter unit tests.
 *
 * These tests pin the input shape that `AgentRuntime.executePreparedTool`
 * constructs and pass it through the pure classifier. The execution seam
 * is exercised separately by `agent-runtime.outcome-integration.test.ts`.
 */

import type { ToolRuntimeOutcome } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	buildToolOutcomeClassificationInput,
	classifyToolRuntimeOutcome,
	type RuntimeOutcomeEvidence,
	selectControlPlaneOutcome,
} from "./index";

// ---- helpers ----------------------------------------------------------

function codeError(code: string, message = "msg"): Error & { code: string } {
	const err = new Error(message) as Error & { code: string };
	err.code = code;
	return err;
}

const BASE_TOOL_NAME = "run_commands";
const BASE_TOOL_CALL_ID = "call_adapter_test";

// ---- input-shape construction ----------------------------------------

describe("runtime-outcome-adapter / input construction", () => {
	it("forwards all fields verbatim and never synthesizes exit codes from prose", () => {
		const evidence: RuntimeOutcomeEvidence = {
			toolName: BASE_TOOL_NAME,
			toolCallId: BASE_TOOL_CALL_ID,
			toolExists: true,
			toolExecutionInvoked: true,
			result: {
				output: "Command exited with code 127",
				isError: true,
			} as never,
			// Exit code is NOT present in the source (prose has 127
			// but no field). The adapter must NOT fabricate one.
		};
		const input = buildToolOutcomeClassificationInput(evidence);
		expect(input.toolName).toBe(BASE_TOOL_NAME);
		expect(input.toolCallId).toBe(BASE_TOOL_CALL_ID);
		expect(input.toolExists).toBe(true);
		expect(input.toolExecutionInvoked).toBe(true);
		expect(input.result?.isError).toBe(true);
		expect(input.result?.output).toBe("Command exited with code 127");
		// exitCode is FORWARDED only when the source surface has it.
		expect(input.result?.exitCode).toBeUndefined();
		// And the classifier pins the family as fallback / not eligible —
		// the prose "127" must NOT become a family-stable exit-code.
		const out = classifyToolRuntimeOutcome(input);
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_execution_error");
			expect(out.stableCode).toBe("unknown");
			expect(out.familyConfidence).toBe("fallback");
			expect(out.familyEligible).toBe(false);
		} else {
			throw new Error(`expected failure, got ${out.kind}`);
		}
	});

	it("forwards a structured exitCode when the runtime exposes it", () => {
		const evidence: RuntimeOutcomeEvidence = {
			toolName: BASE_TOOL_NAME,
			toolCallId: BASE_TOOL_CALL_ID,
			toolExists: true,
			toolExecutionInvoked: true,
			result: {
				output: "boom",
				isError: true,
				exitCode: 7,
			} as never,
		};
		const input = buildToolOutcomeClassificationInput(evidence);
		expect(input.result?.exitCode).toBe(7);
		const out = classifyToolRuntimeOutcome(input);
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_execution_error");
			expect(out.stableCode).toEqual({ exit: 7 });
			expect(out.familyEligible).toBe(true);
		} else {
			throw new Error(`expected failure, got ${out.kind}`);
		}
	});

	it("preserves thrownError verbatim so the classifier reads err.code", () => {
		const err = codeError("ENOENT");
		const evidence: RuntimeOutcomeEvidence = {
			toolName: BASE_TOOL_NAME,
			toolCallId: BASE_TOOL_CALL_ID,
			toolExists: true,
			toolExecutionInvoked: true,
			thrownError: err,
		};
		const input = buildToolOutcomeClassificationInput(evidence);
		expect(input.executionError).toBe(err);
		const out = classifyToolRuntimeOutcome(input);
		if (out.kind === "failure") {
			expect(out.stableCode).toBe("ENOENT");
			expect(out.familyEligible).toBe(true);
		} else {
			throw new Error(`expected failure, got ${out.kind}`);
		}
	});

	it("passes inputParseError through so the classifier can take the tool_input_invalid branch", () => {
		const evidence: RuntimeOutcomeEvidence = {
			toolName: BASE_TOOL_NAME,
			toolCallId: BASE_TOOL_CALL_ID,
			toolExists: true,
			toolExecutionInvoked: false,
			inputParseError: "schema violation: missing field 'path'",
			skipReason: "adapter rejected tool input",
		};
		const input = buildToolOutcomeClassificationInput(evidence);
		expect(input.inputParseError).toBe(
			"schema violation: missing field 'path'",
		);
		expect(input.skipReason).toBe("adapter rejected tool input");
		// Priority 3 (inputParseError) outranks Priority 4 (skipReason).
		const out = classifyToolRuntimeOutcome(input);
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_input_invalid");
			expect(out.familyConfidence).toBe("fallback");
			expect(out.familyEligible).toBe(false);
		} else {
			throw new Error(`expected failure, got ${out.kind}`);
		}
	});

	it("passthroughs unknown tool: toolExists=false still produces tool_not_found", () => {
		const evidence: RuntimeOutcomeEvidence = {
			toolName: "ghost_tool",
			toolCallId: "call_ghost",
			toolExists: false,
			toolExecutionInvoked: false,
		};
		const out = classifyToolRuntimeOutcome(
			buildToolOutcomeClassificationInput(evidence),
		);
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_not_found");
			expect(out.stableCode).toBe("tool:not_found");
			expect(out.familyEligible).toBe(true);
		} else {
			throw new Error(`expected failure, got ${out.kind}`);
		}
	});

	it("runs the result-level isError=true path only when invoked=true AND executionError=undefined", () => {
		const evidence: RuntimeOutcomeEvidence = {
			toolName: BASE_TOOL_NAME,
			toolCallId: BASE_TOOL_CALL_ID,
			toolExists: true,
			toolExecutionInvoked: true,
			result: { output: "boom", isError: true } as never,
		};
		const out = classifyToolRuntimeOutcome(
			buildToolOutcomeClassificationInput(evidence),
		);
		if (out.kind === "failure") {
			expect(out.failureClass).toBe("tool_execution_error");
			expect(out.familyConfidence).toBe("fallback");
			expect(out.stableCode).toBe("unknown");
		} else {
			throw new Error(`expected failure, got ${out.kind}`);
		}
	});
});

// ---- control-plane signal selection ---------------------------------

describe("selectControlPlaneOutcome", () => {
	it("hostDenied wins over userRejected (CORRECTION04 invariant)", () => {
		expect(
			selectControlPlaneOutcome({ hostDenied: true, userRejected: true }),
		).toBe("host_policy_denied");
	});

	it("userRejected alone resolves to user_rejected", () => {
		expect(selectControlPlaneOutcome({ userRejected: true })).toBe(
			"user_rejected",
		);
	});

	it("runtimeAborted resolves to runtime_aborted", () => {
		expect(selectControlPlaneOutcome({ runtimeAborted: true })).toBe(
			"runtime_aborted",
		);
	});

	it("approvalPending resolves to approval_pending", () => {
		expect(selectControlPlaneOutcome({ approvalPending: true })).toBe(
			"approval_pending",
		);
	});

	it("explicitSkip passes through verbatim", () => {
		expect(selectControlPlaneOutcome({ explicitSkip: "runtime_skipped" })).toBe(
			"runtime_skipped",
		);
	});

	it("returns undefined when no signal is present", () => {
		expect(selectControlPlaneOutcome({})).toBeUndefined();
	});
});

// ---- integration: adapter output drives the classifier --------------

describe("adapter / end-to-end classification", () => {
	it("command_status running result (tool success) is recognised as success", () => {
		// TBCE: command_status returns { ok: true, state: "running", ... }
		// without isError. The classifier must NOT treat RUNNING as a
		// tool failure — running is a tool protocol success.
		const evidence: RuntimeOutcomeEvidence = {
			toolName: "command_status",
			toolCallId: "call_run",
			toolExists: true,
			toolExecutionInvoked: true,
			result: {
				output: [{ ok: true, state: "running", jobId: "j-1" }],
				isError: false,
			} as never,
		};
		const out: ToolRuntimeOutcome = classifyToolRuntimeOutcome(
			buildToolOutcomeClassificationInput(evidence),
		);
		expect(out.kind).toBe("success");
	});

	it("cancel_command executed successfully (job cancelled) is recognised as success", () => {
		// TBCE: cancel_command returns { ok: true, state: "cancelled", ... }
		// This is a tool protocol success, even though the controlled
		// process was terminated. The classifier must not surface
		// recovery pressure from this.
		const evidence: RuntimeOutcomeEvidence = {
			toolName: "cancel_command",
			toolCallId: "call_cancel",
			toolExists: true,
			toolExecutionInvoked: true,
			result: {
				output: [{ ok: true, state: "cancelled", jobId: "j-1" }],
				isError: false,
			} as never,
		};
		const out: ToolRuntimeOutcome = classifyToolRuntimeOutcome(
			buildToolOutcomeClassificationInput(evidence),
		);
		expect(out.kind).toBe("success");
	});

	it("host DENY: structured control plane outranks registry result", () => {
		// Even with the existing isError=true synthetic result left in
		// the result (because of the legacy skipReason path), the
		// explicit controlPlaneOutcome MUST outrank it.
		const evidence: RuntimeOutcomeEvidence = {
			toolName: BASE_TOOL_NAME,
			toolCallId: BASE_TOOL_CALL_ID,
			toolExists: true,
			toolExecutionInvoked: false,
			skipReason: "Tool was not approved",
			result: {
				output: { error: "Tool was not approved" },
				isError: true,
			} as never,
			controlPlaneOutcome: "host_policy_denied",
		};
		const out = classifyToolRuntimeOutcome(
			buildToolOutcomeClassificationInput(evidence),
		);
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe("host_policy_denied");
		}
	});

	it("user-rejected approval surfaces user_rejected even when isError=true", () => {
		const evidence: RuntimeOutcomeEvidence = {
			toolName: BASE_TOOL_NAME,
			toolCallId: BASE_TOOL_CALL_ID,
			toolExists: true,
			toolExecutionInvoked: false,
			skipReason: "user said no",
			result: { output: { error: "user said no" }, isError: true } as never,
			controlPlaneOutcome: "user_rejected",
		};
		const out = classifyToolRuntimeOutcome(
			buildToolOutcomeClassificationInput(evidence),
		);
		expect(out.kind).toBe("control_plane");
		if (out.kind === "control_plane") {
			expect(out.outcome).toBe("user_rejected");
		}
	});
});
