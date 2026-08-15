/**
 * Command Approval Policy - Public API
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 *
 * This module is the canonical owner of host-authoritative command
 * approval. Hosts (VS Code, CLI, future JetBrains) translate their
 * user-facing settings into `CommandHostAuthorization` and call
 * `evaluateCommandPolicy()` to decide whether a `run_commands` /
 * `execute_command` tool call may auto-execute.
 *
 * Authority invariants:
 *   - The host ALONE can grant ALLOW.
 *   - The model MAY escalate ALLOW -> ASK but cannot weaken ASK/DENY.
 *   - `safe-only` mode grants ALLOW only via explicit positive rule match.
 *   - `all` mode grants ALLOW because the user opted into autonomous execution.
 *
 * See:
 *   - command-policy-types.ts  types + lattice helpers
 *   - command-model-hints.ts   per-command model `requires_approval` aggregation
 *   - command-safe-rules.ts    bounded host-proven safe rule set
 *   - command-policy.ts        composition entry point
 */

export {
	type CommandModelHint,
	type CommandModelHints,
	parseCommandModelHints,
	renderNormalizedCommand,
} from "./command-model-hints";
export {
	type CommandDecision,
	type CommandDecisionKind,
	type CommandDecisionSource,
	type CommandHostAllowRule,
	type CommandHostAuthorization,
	type CommandHostMode,
	commandHostAuthorization,
	type EvaluateCommandPolicyInput,
	type EvaluateCommandPolicyResult,
	type EvaluatedCommand,
	evaluateCommandPolicy,
	isMoreRestrictive,
	maxRestrictive,
	type NormalizationResult,
	type NormalizedCommand,
	type NormalizedCommands,
	type NormalizedFailure,
} from "./command-policy";

export {
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	findSafeRuleMatch,
	isOpaqueShellRendered,
	OPAQUE_SHELL_TOKENS,
} from "./command-safe-rules";

export {
	buildCommandExecutionPlan,
} from "./command-execution-plan";

export {
	applySafeExecutionProfileToCommand,
	getSafeExecutionProfileForSource,
	SAFE_GIT_DIFF_PROFILE,
	SAFE_GIT_LOG_PROFILE,
	SAFE_GIT_STATUS_PROFILE,
	SAFE_PWD_PROFILE,
	type SafeExecutionProfile,
	type SafeExecutionProfileKind,
} from "./safe-execution-profile";
