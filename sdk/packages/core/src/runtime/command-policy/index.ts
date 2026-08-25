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

export { buildCommandExecutionPlan } from "./command-execution-plan";
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

export { type TempAuthorityEvidence } from "./command-policy-types";
// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01-CORRECTION01:
// re-export the R5 hard floor entry point so the VSCode host
// adapter's stub (`apps/vscode/src/test/cline-core-vitest-stub.ts`)
// can import it from this single index. The CLI host adapter
// imports from the top-level `@cline/core` index, which already
// exports these; the VSCode path needs them at the
// `runtime/command-policy` subpath because the vitest stub
// re-exports command-policy symbols from there.
export {
	type EvaluateCommandRiskInput,
	evaluateCommandRisk,
	type RiskDecision,
} from "./command-risk";
export {
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	findSafeRuleMatch,
	isOpaqueShellRendered,
	OPAQUE_SHELL_TOKENS,
} from "./command-safe-rules";
// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01:
// Workspace path authority is the first-class companion to the R0
// read-only allowlist. Hosts wire the workspace root into the
// command policy through `CommandHostAuthorization.workspaceRoots`
// and `cwd`; this module is the policy layer's lexical containment
// primitive (testable in isolation).
export {
	evaluateCommandPathConformance,
	evaluateCommandRealpathConformance,
	extractPathOperands,
	extractR0PathOperands,
	isLexicallyContained,
	isPathOperandConforming,
	type PathAuthorityContext,
	type PathConformanceResult,
	type RealpathConformanceFailureReason,
	type RealpathPathConformanceResult,
} from "./path-authority";
// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
// REALPATH_WORKSPACE_CONFINEMENT:
//
// Re-export the host-produced realpath evidence types so SDK
// consumers (CLI, VS Code) can construct evidence objects and pass
// them through `CommandHostAuthorization.pathAuthorityEvidence`.
export type {
	WorkspacePathAuthorityEvidence,
	WorkspacePathOperandEvidence,
} from "./path-authority-evidence";
// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
// REALPATH_WORKSPACE_CONFINEMENT:
//
// Re-export the host-side evidence builder so CLI and VS Code
// produce identical realpath-resolution behavior. The builder
// is the ONLY sanctioned place in the policy stack that calls
// `fs.realpathSync`.
export {
	buildPathAuthorityEvidence,
	type BuildPathEvidenceOptions,
	type BuildPathEvidenceResult,
	safeRealpathSync,
} from "./path-authority-evidence-builder";
export {
	applySafeExecutionProfileToCommand,
	getSafeExecutionProfileForSource,
	SAFE_CAT_PROFILE,
	SAFE_GIT_DIFF_PROFILE,
	SAFE_GIT_LOG_PROFILE,
	SAFE_GIT_STATUS_PROFILE,
	SAFE_HEAD_PATH_PROFILE,
	SAFE_LS_PROFILE,
	SAFE_FIND_PROFILE,
	SAFE_PWD_PROFILE,
	SAFE_TAIL_PATH_PROFILE,
	type SafeExecutionProfile,
	type SafeExecutionProfileKind,
} from "./safe-execution-profile";

// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-ASSISTED01:
// V2 structured classifier. Hosts may pass a parser result to
// `evaluateCommandRisk` to opt into structural analysis. When
// omitted, V1 behavior is preserved unchanged.
export {
	evaluateStructuredCommandRisk,
	joinRunCommandsForParse,
	type ParsedShell,
	type ShellDialect,
	STRUCTURED_PROTO_VERSION,
	type StructuredAnalysis,
	type StructuredCmd,
	type StructuredProgram,
	type StructuredRisk,
	type StructuredStmt,
	type StructuredStmtRisk,
} from "./structured-command-risk";

// ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01:
// Bounded, source-level reformulation classifier. Hosts invoke
// `isReformulatable(decision, rawInput, hostAuthorization)` to decide
// whether an avoidably-unsafe command can be short-circuited back to
// the agent as bounded guidance without opening the approval UI.
//
// The classifier is intentionally narrow: it recognizes only the
// known-bad form of the source text (an unquoted shell pathname-
// expansion metacharacter in a reviewed `find` pattern position).
// Adding new reason families (e.g. UNQUOTED_REDIRECT) is a future
// ACT; V1 ships exactly this one.
export {
	containsUnquotedShellPattern,
	extractShellSource,
	isReformulatable,
	REFORMULATION_MODEL_FACING_MESSAGE,
	REFORMULATION_REASON_CODE,
} from "./reformulation-classifier";
