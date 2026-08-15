import type {
	CommandExecutionPlan,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import type { Config } from "../../utils/types";
import { cliEvaluateCommandToolApproval } from "../command-policy-host";
import {
	applyInteractiveAutoApproveOverride,
	cloneToolPolicies,
	resolveInteractiveAutoApprovePolicy,
} from "../tool-policies";

const COMMAND_TOOL_NAMES = new Set(["run_commands", "execute_command"]);

export interface InteractiveRuntimeRefs {
	tuiToolApprover: {
		current:
			| ((request: ToolApprovalRequest) => Promise<ToolApprovalResult>)
			| null;
	};
	tuiAskQuestion: {
		current: ((question: string, options: string[]) => Promise<string>) | null;
	};
}

/**
 * Pending execution plans keyed by request identity. When the canonical
 * command policy says ASK and produces a hardened CommandExecutionPlan,
 * we remember it here so that when the TUI approver returns YES we can
 * re-emit it on the ToolApprovalResult. Without this, the runtime would
 * execute the raw model input — losing the per-command SafeExecutionProfile.
 */
const pendingExecutionPlans = new WeakMap<
	ToolApprovalRequest,
	CommandExecutionPlan
>();

export function createInteractiveApprovalController(config: Config) {
	const autoApproveAllRef = {
		current: config.toolPolicies["*"]?.autoApprove !== false,
	};
	const baselineToolPolicies = cloneToolPolicies(config.toolPolicies);
	const refs: InteractiveRuntimeRefs = {
		tuiToolApprover: { current: null },
		tuiAskQuestion: { current: null },
	};

	// CORRECTION04 test seam: inject a custom command evaluator for tests.
	const commandEvaluatorRef: {
		current: typeof cliEvaluateCommandToolApproval | null,
	} = { current: null };

	const setInteractiveAutoApprove = (enabled: boolean) => {
		autoApproveAllRef.current = enabled;
		applyInteractiveAutoApproveOverride({
			targetPolicies: config.toolPolicies,
			baselinePolicies: baselineToolPolicies,
			enabled,
		});
	};

	const requestToolApproval = async (
		request: ToolApprovalRequest,
	): Promise<ToolApprovalResult> => {
		// Command tools MUST always route through the canonical command
		// policy (see ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-
		// CORRECTION02/04). The wildcard autoApprove / autoApproveAllRef
		// are not authoritative for command tools; only the policy's
		// verdict is. Per CORRECTION04 the verdict for ALLOW/ASK is
		// paired with a CommandExecutionPlan that the SDK AgentRuntime
		// will substitute for the raw model input at the execution
		// boundary. The plan is preserved across the user approval flow.
		if (COMMAND_TOOL_NAMES.has(request.toolName)) {
			// CORRECTION04 test seam: use injected evaluator if present.
			const evaluateCommand = commandEvaluatorRef.current || cliEvaluateCommandToolApproval;
			const result = evaluateCommand({
				toolName: request.toolName,
				toolInput: request.input,
				autoApproveTools: autoApproveAllRef.current,
			});
			// CORRECTION04 DENY preservation: if the canonical evaluator
			// returned DENY, do NOT route to TUI. Nothing executes.
			if (result.decision?.kind === "deny") {
				return {
					approved: false,
					reason: result.reason,
					decision: result.decision,
				};
			}
			if (result.approved) {
				// Canonical authority said ALLOW. Forward the plan to the
				// runtime; nothing user-facing happens here.
				return {
					approved: true,
					decision: result.decision,
					executionPlan: result.executionPlan,
				};
			}
			// ASK: remember the plan, then route to TUI.
			if (result.executionPlan) {
				pendingExecutionPlans.set(request, result.executionPlan);
			}
			if (refs.tuiToolApprover.current) {
				return refs.tuiToolApprover.current(request);
			}
			// No TUI: noninteractive runs fail closed.
			if (result.executionPlan) {
				pendingExecutionPlans.delete(request);
			}
			return { approved: false, reason: result.reason, decision: result.decision };
		}

		// Non-command tools retain the legacy boolean path.
		if (autoApproveAllRef.current) {
			return { approved: true };
		}
		if (request.policy?.autoApprove === true) {
			return { approved: true };
		}
		if (refs.tuiToolApprover.current) {
			return refs.tuiToolApprover.current(request);
		}
		return { approved: false };
	};

	/**
	 * Wrap a TUI approver so it carries any pending execution plan
	 * through the user decision. When the user approves a command tool
	 * whose canonical authority was ASK, the pending plan is re-emitted
	 * on the ToolApprovalResult. This is the CORRECTION04 invariant
	 * end-to-end: changing approval status never erases execution
	 * constraints.
	 */
	const wrapTuiApprover =
		(fn: (request: ToolApprovalRequest) => Promise<ToolApprovalResult>) =>
		async (request: ToolApprovalRequest): Promise<ToolApprovalResult> => {
			const result = await fn(request);
			if (
				COMMAND_TOOL_NAMES.has(request.toolName) &&
				result.approved &&
				!result.executionPlan
			) {
				const pending = pendingExecutionPlans.get(request);
				if (pending) {
					pendingExecutionPlans.delete(request);
					return { ...result, executionPlan: pending };
				}
			}
			// Clean up any pending plan on rejection.
			if (COMMAND_TOOL_NAMES.has(request.toolName)) {
				pendingExecutionPlans.delete(request);
			}
			return result;
		};

	return {
		autoApproveAllRef,
		setInteractiveAutoApprove,
		requestToolApproval,
		resolveToolPolicy: (toolName: string) =>
			resolveInteractiveAutoApprovePolicy({
				toolName,
				baselinePolicies: baselineToolPolicies,
				enabled: autoApproveAllRef.current,
			}),
		/**
		 * Setter for the TUI approver. Wraps the TUI fn so that any
		 * pending CommandExecutionPlan produced by the canonical
		 * command policy is re-emitted when the user approves.
		 * This is the CORRECTION04 invariant: changing approval
		 * status never erases execution constraints.
		 */
		setToolApprover: (fn: typeof refs.tuiToolApprover.current) => {
			refs.tuiToolApprover.current = fn ? wrapTuiApprover(fn) : null;
		},
		tuiToolApprover: refs.tuiToolApprover,
		tuiAskQuestion: refs.tuiAskQuestion,
		/**
		 * CORRECTION04 test seam: inject a custom command evaluator.
		 * The evaluator is used instead of cliEvaluateCommandToolApproval
		 * for command tool requests. Pass null to restore default behavior.
		 */
		setCommandEvaluator: (fn: typeof cliEvaluateCommandToolApproval | null) => {
			commandEvaluatorRef.current = fn;
		},
	};
}
