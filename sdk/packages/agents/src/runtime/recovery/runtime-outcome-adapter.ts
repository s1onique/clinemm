/**
 * C1.2 adapter: boundary evidence → classifier input.
 *
 * Lives in @cline/agents so it can import `classifyToolRuntimeOutcome` and
 * consumer types together. No Node builtins; browser-safe.
 *
 * The adapter does NOT classify by itself. It constructs the
 * `ToolOutcomeClassificationInput` shape from the boundary evidence that
 * `AgentRuntime.executePreparedTool` collects:
 *
 *   - toolCall — the model-emitted tool call.
 *   - prepared — registry/lookup result + skip reason from prepareToolExecution.
 *   - toolExecutionInvoked — boolean set IMMEDIATELY BEFORE the
 *     tool.execute(...) call. Inferred from result/skip/approval fields
 *     is a contract violation.
 *   - result — the AgentToolResult actually returned by the executor.
 *   - thrownError — the verbatim throw from tool.execute(...) if any.
 *   - controlPlaneOutcome — typed provenance when known (host DENY,
 *     user reject, runtime abort, etc.). Outranks every other signal.
 *
 * The adapter is the single owner of the "what really happened?" question
 * at the AgentRuntime execution seam. C1.2 closes once executePreparedTool
 * calls it and stores a ToolRuntimeOutcome locally; C1.3 will route it
 * through RecoveryTracker. NO tracker calls from this module.
 */

import type { AgentToolResult, ControlPlaneOutcome } from "@cline/shared";
import type { ToolOutcomeClassificationInput } from "./failure-classifier";

/**
 * The truth structure for the AgentRuntime execution seam. Constructed
 * per tool-call (NEVER shared across calls).
 */
export interface RuntimeOutcomeEvidence {
	toolName: string;
	toolCallId: string;

	/**
	 * True iff `tools.get(toolName)` returned a real tool. False implies
	 * the classifier takes the registry-miss branch (`tool_not_found`),
	 * which does NOT depend on `toolExecutionInvoked`.
	 */
	toolExists: boolean;

	/**
	 * True iff `tool.execute(...)` was actually invoked. MUST be set
	 * immediately before the call; inferred assignment (e.g., from
	 * `!skipReason` or `!result.isError`) is a contract violation.
	 */
	toolExecutionInvoked: boolean;

	/** Structured input-parse error if the adapter had one. */
	inputParseError?: unknown;

	/**
	 * Free-form skip reason from `prepareToolExecution`. The adapter
	 * does NOT synthesize a ControlPlaneOutcome from this string —
	 * generic skips remain `runtime_skipped` (set by the adapter when
	 * `toolExists=true && toolExecutionInvoked=false` and no richer
	 * control-plane signal is available).
	 */
	skipReason?: string;

	/**
	 * The verbatim throw from `tool.execute(...)`, retained so the
	 * classifier can read structured `err.code`.
	 */
	thrownError?: unknown;

	/** `AgentToolResult` returned by the executor boundary. */
	result?: AgentToolResult;

	/**
	 * Explicit control-plane signal observed at the boundary. Outranks
	 * every other provenance in the classifier.
	 *
	 * Set this when the runtime has STRUCTURAL evidence that the tool
	 * was not executed for control-plane reasons (host DENY, user
	 * rejection, runtime abort, etc.). For generic skips with no richer
	 * reason, leave undefined — the adapter will fall through to
	 * `runtime_skipped`.
	 */
	controlPlaneOutcome?: ControlPlaneOutcome;
}

/**
 * Build a `ToolOutcomeClassificationInput` from the boundary evidence.
 *
 * This function is the SINGLE owner of "what provenance does the
 * classifier see?" for the AgentRuntime seam. It does NOT classify.
 *
 * The function does NO synthesis — it does not parse error messages, it
 * does not pull exit codes out of prose, and it does not invent
 * `controlPlaneOutcome` from a free-form `skipReason`.
 *
 * Existing typed fields on `AgentToolResult` (e.g. `exitCode` if a host
 * ever exposes it) are forwarded verbatim — never inferred from the
 * output object shape.
 */
export function buildToolOutcomeClassificationInput(
	evidence: RuntimeOutcomeEvidence,
): ToolOutcomeClassificationInput {
	const input: ToolOutcomeClassificationInput = {
		toolName: evidence.toolName,
		toolCallId: evidence.toolCallId,
		toolExists: evidence.toolExists,
		toolExecutionInvoked: evidence.toolExecutionInvoked,
	};

	if (evidence.inputParseError !== undefined) {
		input.inputParseError = evidence.inputParseError;
	}
	if (evidence.skipReason !== undefined) {
		input.skipReason = evidence.skipReason;
	}
	if (evidence.thrownError !== undefined) {
		input.executionError = evidence.thrownError;
	}
	if (evidence.result !== undefined) {
		const rawExit = (evidence.result as unknown as { exitCode?: unknown })
			.exitCode;
		const exitCode = typeof rawExit === "number" ? rawExit : undefined;
		input.result = {
			isError: evidence.result.isError,
			output: evidence.result.output,
			...(exitCode !== undefined ? { exitCode } : {}),
		};
	}
	if (evidence.controlPlaneOutcome !== undefined) {
		input.controlPlaneOutcome = evidence.controlPlaneOutcome;
	}

	return input;
}

/**
 * Helper for the AgentRuntime execution seam: choose the right
 * `ControlPlaneOutcome` from the typed boundary evidence.
 *
 * The runtime calls this with the typed signals it actually observed
 * (e.g., `ToolApprovalResult.decision.kind === "deny"`), and the helper
 * returns the canonical `ControlPlaneOutcome` enum value. The runtime
 * passes that value into `buildToolOutcomeClassificationInput` to ensure
 * the classifier sees the structured signal.
 *
 * If the runtime lacks a more specific reason, return `undefined`; the
 * classifier will fall through to the generic
 * `toolExecutionInvoked=false ⇒ runtime_skipped` branch.
 *
 * Priority is fixed by the C1.1 closing-plan invariant: structural
 * DENY/REJECT signals outrank everything else. Adding an
 * `explicitSkip` field lets callers override priority only when they
 * have STRUCTURAL evidence the classifier cannot derive.
 */
export interface ControlPlaneSignal {
	/** Was the approval decision a host DENY? (CORRECTION04 invariant.) */
	hostDenied?: boolean;
	/** Did the user click NO / decline the approval? */
	userRejected?: boolean;
	/** Did the runtime observe an aborted signal mid-execution? */
	runtimeAborted?: boolean;
	/**
	 * Does the runtime still have an approval pending (e.g., a stuck
	 * approval UI / unresolvable Ask)?
	 */
	approvalPending?: boolean;
	/**
	 * Catch-all explicit known-tool non-execution. Distinct from
	 * `runtime_skipped` only by intent: callers should set this only
	 * when the runtime actually knows that the tool was supposed to run
	 * but did not for a typable reason; otherwise leave undefined and
	 * let the adapter default to `runtime_skipped`.
	 */
	explicitSkip?: ControlPlaneOutcome;
}

export function selectControlPlaneOutcome(
	signal: ControlPlaneSignal,
): ControlPlaneOutcome | undefined {
	if (signal.hostDenied === true) return "host_policy_denied";
	if (signal.userRejected === true) return "user_rejected";
	if (signal.runtimeAborted === true) return "runtime_aborted";
	if (signal.approvalPending === true) return "approval_pending";
	if (signal.explicitSkip !== undefined) return signal.explicitSkip;
	return undefined;
}
