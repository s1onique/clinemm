/**
 * CLI Host Adapter for the Canonical Command Policy
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
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
 * In BOTH cases the runtime is given a per-tool command-tool policy that
 * forces `toolPolicies["run_commands"].autoApprove = false`, so the SDK
 * runtime ALWAYS consults `requestToolApproval` for command tools. The
 * approval callback routes through `evaluateCommandPolicy()` so the
 * monotonic lattice (ALLOW < ASK < DENY; model can only escalate) holds
 * in the CLI exactly as in VS Code.
 */

import type { CommandHostAuthorization, CommandHostMode } from "@cline/core";
import { commandHostAuthorization, evaluateCommandPolicy } from "@cline/core";

/**
 * Build the canonical host authorization for the CLI given the resolved
 * `autoApproveTools` boolean.
 *
 * NOTE: This does NOT include explicit allow rules. The CLI's
 * `autoApproveTools=true` is the user's explicit "execute all" opt-in,
 * which is encoded as mode "all". A future enhancement may add an
 * analogous CLI-side safe-command toggle.
 */
export function cliResolveHostAuthorization(
	autoApproveTools: boolean,
): CommandHostAuthorization {
	const mode: CommandHostMode = autoApproveTools ? "all" : "manual";
	return commandHostAuthorization({ mode });
}

/**
 * Apply the canonical command policy to a tool approval request originating
 * from the CLI's `requestToolApproval` callback.
 *
 * Returns `approved: true` only when the canonical policy returns ALLOW.
 * When the policy returns ASK or DENY, returns `approved: false` with the
 * canonical `decision.reason` for diagnostics and CLI logging.
 */
export function cliEvaluateCommandToolApproval(input: {
	toolName: string;
	toolInput: unknown;
	autoApproveTools: boolean;
}): { approved: boolean; reason: string } {
	const hostAuthorization = cliResolveHostAuthorization(input.autoApproveTools);
	const result = evaluateCommandPolicy({
		toolInput: input.toolInput,
		hostAuthorization,
	});
	return {
		approved: result.decision.kind === "allow",
		reason: result.decision.reason,
	};
}

/**
 * Build a CLI tool-policies map that ALWAYS consults the approval callback
 * for command tools, regardless of the wildcard autoApprove setting. The
 * wildcard setting drives the `autoApproveAllRef` used by the CLI approval
 * controller; command tools get a per-tool entry forcing autoApprove=false
 * so the SDK runtime invokes `requestToolApproval` for them.
 *
 * Without this scoped override, a wildcard `autoApprove: true` would
 * short-circuit the SDK runtime's approval boundary for command tools
 * (see agent-runtime.ts: `toolPolicies["*"].autoApprove === true` skips
 * the requestToolApproval path). The override restores the host's
 * authoritative boundary for `run_commands` / `execute_command`.
 */
export function buildCliToolPolicies(input: {
	wildcardAutoApprove: boolean;
}): Record<string, { autoApprove?: boolean }> {
	return {
		"*": { autoApprove: input.wildcardAutoApprove },
		run_commands: { autoApprove: false },
		execute_command: { autoApprove: false },
	};
}
