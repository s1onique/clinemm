import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared";
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

export function createInteractiveApprovalController(config: Config) {
	const autoApproveAllRef = {
		current: config.toolPolicies["*"]?.autoApprove !== false,
	};
	const baselineToolPolicies = cloneToolPolicies(config.toolPolicies);
	const refs: InteractiveRuntimeRefs = {
		tuiToolApprover: { current: null },
		tuiAskQuestion: { current: null },
	};

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
		// CORRECTION02). The wildcard autoApprove / autoApproveAllRef are
		// not authoritative for command tools; only the policy's verdict
		// is.
		if (COMMAND_TOOL_NAMES.has(request.toolName)) {
			const result = cliEvaluateCommandToolApproval({
				toolName: request.toolName,
				toolInput: request.input,
				autoApproveTools: autoApproveAllRef.current,
			});
			if (result.approved) {
				return { approved: true };
			}
			// ASK/DENY: fall through to the TUI approver if available;
			// otherwise reject so noninteractive runs fail closed.
			if (refs.tuiToolApprover.current) {
				return refs.tuiToolApprover.current(request);
			}
			return { approved: false, reason: result.reason };
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
		...refs,
	};
}
