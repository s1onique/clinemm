/**
 * CLI Host Adapter for the Canonical Command Policy
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02/04
 *
 * This module is the production wiring between CLI configuration and
 * `@cline/core/runtime/command-policy`. The CLI consumes the SAME policy
 * as VS Code; this adapter is the only CLI-specific translation step.
 *
 * Mapping:
 *   CLI --auto-approve / autoApproveTools=true
 *       => host mode "all"   (user explicitly opted in to autonomous execution)
 *   CLI --auto-approve=false / autoApproveTools=false
 *       => host mode "manual" (every command requires approval)
 *
 * CORRECTION04: the plan builder lives in `@cline/core` so both hosts
 * share the same hardened argv construction. CLI does not redefine it.
 *
 * Authority and execution constraints are INDEPENDENT axes:
 *   - authority may be ALLOW, ASK, or DENY
 *   - execution constraints attach whenever the canonical policy
 *     successfully classifies commands with a SafeExecutionProfile,
 *     regardless of whether authority is ALLOW or ASK.
 *   - DENY: no execution plan (no execution will happen).
 *
 * A successful ASK → user YES must still execute the hardened argv,
 * never the raw model input. The CLI TUI approver carries the plan
 * through the pending approval state.
 */

import {
	buildCommandExecutionPlan,
	type CommandHostAuthorization,
	type CommandHostMode,
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
} from "@cline/core";
import type { CommandExecutionPlan } from "@cline/shared";

export interface CliCommandToolApprovalDecision {
	approved: boolean;
	reason: string;
	/**
	 * Canonical decision kind from the host's command policy evaluator.
	 *
	 * CORRECTION04 DENY-preservation invariant:
	 *   - "deny" => DENY stays denied. Do NOT route to TUI approver.
	 *   - "ask"  => Route to TUI. On YES, execute with plan.
	 *   - "allow" => auto-approved (approved=true).
	 */
	decision: { kind: "allow" | "ask" | "deny"; reason: string; source: string };
	/**
	 * Pending execution plan. Set whenever the canonical policy
	 * positively matched at least one command with a SafeExecutionProfile,
	 * regardless of authority (ALLOW or ASK). When approved=true, the
	 * AgentRuntime substitutes `executionPlan.transformedInput` for
	 * the raw tool input. When approved=false (DENY), this is undefined.
	 */
	executionPlan?: CommandExecutionPlan;
}

export function cliResolveHostAuthorization(
	autoApproveTools: boolean,
): CommandHostAuthorization {
	const mode: CommandHostMode = autoApproveTools ? "all" : "manual";
	return commandHostAuthorization({ mode });
}

/**
 * Build a host authorization with the canonical safe-only allow rules.
 * This is the CORRECTION04 wiring for "manual" mode that still wants
 * safe rules to apply execution constraints on user-approved commands.
 *
 * Used by the architect-recommended scenario:
 *   safe-only + git diff --stat + model requires_approval=true
 *     -> ASK (model escalation)
 *     -> user YES
 *     -> executor receives hardened argv
 *
 * Without explicitAllowRules, manual mode is pure ASK with no
 * profile attached; this helper adds the safe rules so the plan
 * carries SafeExecutionProfile forward.
 */
export function cliResolveSafeOnlyHostAuthorization(options?: {
	/**
	 * Explicit deny rules to inject for testing. Each rule's pattern is
	 * a string that will be compiled to a RegExp (prefix match).
	 */
	explicitDenyRules?: ReadonlyArray<{ pattern: string; label: string; description: string }>;
}): CommandHostAuthorization {
	const denyRules = options?.explicitDenyRules?.map((r) => ({
		source: r.label,
		pattern: new RegExp(`^${r.pattern.replace(/\*/g, ".*")}`),
	}))
	return commandHostAuthorization({
		mode: "manual",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		explicitDenyRules: denyRules,
	});
}

export function cliEvaluateCommandToolApproval(input: {
	toolName: string;
	toolInput: unknown;
	autoApproveTools: boolean;
}): CliCommandToolApprovalDecision {
	const hostAuthorization = cliResolveHostAuthorization(input.autoApproveTools);
	return cliEvaluateCommandToolApprovalWith(input, hostAuthorization);
}

/**
 * Lower-level entry point that takes a prebuilt host authorization.
 * Lets callers inject safe-only / explicit allow rules while reusing
 * the same ALLOW/ASK/DENY + plan emission logic.
 */
export function cliEvaluateCommandToolApprovalWith(
	input: {
		toolName: string;
		toolInput: unknown;
		autoApproveTools: boolean;
	},
	hostAuthorization: CommandHostAuthorization,
): CliCommandToolApprovalDecision {
	const result = evaluateCommandPolicy({
		toolInput: input.toolInput,
		hostAuthorization,
	});

	// Plan construction: DENY discards it because nothing executes.
	// For ALLOW/ASK, build the plan. If plan construction fails
	// (invalid input, cardinality mismatch) and a safe profile is
	// required, fail closed rather than allowing raw input to execute.
	const executionPlan =
		result.decision.kind === "deny"
			? undefined
			: buildCommandExecutionPlan(input.toolInput, result.commands);

	if (result.decision.kind === "deny") {
		return {
			approved: false,
			reason: result.decision.reason,
			decision: {
				kind: result.decision.kind,
				reason: result.decision.reason,
				source: result.decision.source,
			},
		};
	}

	// CORRECTION04 P0: if a safe execution profile is required but the
	// plan could not be constructed, fail closed rather than allowing
	// raw input to execute.
	const requiresPlan = result.commands.some((c) => c.safeExecutionProfile !== undefined);
	if (requiresPlan && !executionPlan) {
		return {
			approved: false,
			reason: "required hardened execution plan could not be constructed",
			decision: {
				kind: "deny",
				source: "execution_plan_invalid",
				reason: "required hardened execution plan could not be constructed",
			},
		};
	}

	if (result.decision.kind === "allow") {
		return {
			approved: true,
			reason: result.decision.reason,
			decision: {
				kind: result.decision.kind,
				reason: result.decision.reason,
				source: result.decision.source,
			},
			executionPlan,
		};
	}
	// ASK: hand the plan to the TUI approver.
	return {
		approved: false,
		reason: result.decision.reason,
		decision: {
			kind: result.decision.kind,
			reason: result.decision.reason,
			source: result.decision.source,
		},
		executionPlan,
	};
}

export function buildCliToolPolicies(input: {
	wildcardAutoApprove: boolean;
}): Record<string, { autoApprove?: boolean }> {
	return {
		"*": { autoApprove: input.wildcardAutoApprove },
		run_commands: { autoApprove: false },
		execute_command: { autoApprove: false },
	};
}
