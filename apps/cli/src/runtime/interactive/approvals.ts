import type {
	CommandExecutionPlan,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import type { Config } from "../../utils/types";
import {
	cliEvaluateCommandToolApprovalWith,
	cliResolveHostAuthorization,
} from "../command-policy-host";
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

/**
 * Type of the trusted parser helper capability. Only the method
 * `invoke(toolInput)` is consumed at this async seam; the helper
 * is constructed per-host-process elsewhere (CLI: a single module-
 * level singleton or injected by `setCliParserHelper` for tests).
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
 * (CORRECTION02 Phase 2): the CLI host adapter invokes this
 * capability ONCE per approval request, captures the result (or
 * `null` on any failure), and threads it into the pure policy
 * evaluator. The helper is the ONLY sanctioned path to a
 * `ParsedShell`.
 */
export interface CliParserHelper {
	invoke(toolInput: unknown): Promise<unknown>;
}

/**
 * Module-level parser helper for production. Tests can override via
 * `setCliParserHelper` to inject a fake. The default value is
 * `undefined`, which means V2 stays dormant and the CLI behaves
 * identically to the prior (CORRECTION01) baseline.
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01:
 * when the binary ACT lands, production wires a real `MvdanShHelper`
 * here via `setCliParserHelper(helper)`. Until then, `undefined` is
 * correct and safe.
 */
let cliParserHelper: CliParserHelper | undefined;

export function getCliParserHelper(): CliParserHelper | undefined {
	return cliParserHelper;
}

export function setCliParserHelper(helper: CliParserHelper | undefined): void {
	cliParserHelper = helper;
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

	// CORRECTION04 test seam: inject a custom command evaluator for tests.
	// The evaluator type matches `cliEvaluateCommandToolApprovalWith`
	// (the lower-level entry point) so tests can simulate either a
	// pre-built authorization or the full composition path.
	const commandEvaluatorRef: {
		current:
			| ((
					input: Parameters<typeof cliEvaluateCommandToolApprovalWith>[0],
					auth: Parameters<typeof cliEvaluateCommandToolApprovalWith>[1],
			  ) => ReturnType<typeof cliEvaluateCommandToolApprovalWith>)
			| null;
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
			// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
			// CORRECTION02 Phase 2 (async seam + snapshot invariant):
			// the trusted parser helper is invoked EXACTLY ONCE here,
			// at the host-owned async boundary, on a frozen snapshot
			// of `request.input`. The same captured value is then
			// passed synchronously to the pure policy evaluator.
			// When the helper is unavailable / fails / times out /
			// returns malformed response, V2 stays dormant and V1 is
			// preserved unchanged.
			const frozenToolInput = request.input;
			let parserResult: unknown = undefined;
			const helper = cliParserHelper;
			if (helper) {
				try {
					parserResult = await helper.invoke(frozenToolInput);
				} catch {
					// The helper is asynchronous infrastructure. ANY
					// thrown error is treated identically to V2 absence:
					// we pass `undefined` to the policy evaluator and
					// the V1 path is authoritative.
					parserResult = undefined;
				}
			}
			// CORRECTION04 test seam: use injected evaluator if present.
			const evaluateCommand = commandEvaluatorRef.current || cliEvaluateCommandToolApprovalWith;
			const hostAuthorization = cliResolveHostAuthorization(autoApproveAllRef.current);
			const result = evaluateCommand(
				{
					toolName: request.toolName,
					toolInput: frozenToolInput,
					autoApproveTools: autoApproveAllRef.current,
					// The trusted parser helper is the ONLY sanctioned
					// source of this value. We pass it through, cast
					// only at the trust boundary (the helper enforces
					// the runtime provenance barrier — see
					// `MvdanShHelper.invoke` and `validateResponse`).
					parserResult: parserResult as never,
				},
				hostAuthorization,
			);
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
		 * The evaluator is used instead of `cliEvaluateCommandToolApprovalWith`
		 * for command tool requests. Pass null to restore default
		 * behavior.
		 *
		 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
		 * (CORRECTION02 Phase 2): the type changed from the public
		 * `cliEvaluateCommandToolApproval` (1-arg) to the lower-level
		 * `cliEvaluateCommandToolApprovalWith` (2-arg) so tests can
		 * simulate the full composition including the parser result.
		 */
		setCommandEvaluator: (fn: typeof commandEvaluatorRef.current) => {
			commandEvaluatorRef.current = fn;
		},
	};
}
