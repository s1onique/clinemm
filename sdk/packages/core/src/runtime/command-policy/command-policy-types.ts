/**
 * Command Approval Policy - Host Authority for Shell Command Execution
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION04
 *
 * Canonical location for the command-approval policy types. Consumed by
 * VS Code (`apps/vscode/src/sdk/...`), CLI (`apps/cli/src/runtime/...`), and
 * any future host via the `evaluateCommandPolicy()` entry point.
 *
 * PRIMARY INVARIANT (authority lattice):
 *   effectiveDecision >= hostDecision
 *   where restrictiveness: ALLOW < ASK < DENY
 *
 * The model MAY ONLY ESCALATE. It can never downgrade ASK or DENY.
 *
 * The host does NOT maintain a complete shell-command semantic classifier.
 * Therefore the host can only legitimately ALLOW when the user has explicitly
 * granted unrestricted command execution, OR when a positive, bounded host
 * rule matches a constrained command shape (see `command-safe-rules.ts`).
 *
 * CORRECTION04 (execution constraints):
 *   Classification alone is insufficient. A safe-only ALLOW verdict
 *   also produces a per-command `EvaluatedCommand` that carries the
 *   `safeExecutionProfile` the host MUST apply. The lattice (ALLOW/ASK/DENY)
 *   and the execution envelope (the profile) are independent axes:
 *   model escalation raises the lattice but does NOT erase the profile.
 *   Per-command, not per-decision: a multi-command input produces one
 *   `EvaluatedCommand` per command, each with its own profile (or none).
 */

import type { StructuredCommandInput } from "../../extensions/tools/schemas";
import type { CommandModelHints } from "./command-model-hints";
import type { SafeExecutionProfile } from "./safe-execution-profile";

/**
 * The host's command mode is the authoritative source of auto-approval.
 * It is NOT a boolean. It is a typed expression of explicit user intent.
 *
 * - "manual": no host auto-apply. Default. Every command requires approval.
 * - "safe-only": user has enabled "execute safe commands" toggle. The host
 *   attempts a bounded explicit-rule match; commands that cannot be
 *   positively proven safe fall through to ASK.
 * - "all": user has explicitly enabled "execute all commands" / YOLO /
 *   `--auto-approve` / `autoApproveTools: true`. The host delegates ALLOW
 *   to the user. The model can still escalate to ASK.
 */
export type CommandHostMode = "manual" | "safe-only" | "all";

/**
 * Decision kinds, ordered by restrictiveness.
 */
export type CommandDecisionKind = "allow" | "ask" | "deny";

const RESTRICTIVENESS: Record<CommandDecisionKind, number> = {
	allow: 0,
	ask: 1,
	deny: 2,
};

export function isMoreRestrictive(
	a: CommandDecisionKind,
	b: CommandDecisionKind,
): boolean {
	return RESTRICTIVENESS[a] > RESTRICTIVENESS[b];
}

export function maxRestrictive(
	a: CommandDecisionKind,
	b: CommandDecisionKind,
): CommandDecisionKind {
	return RESTRICTIVENESS[a] >= RESTRICTIVENESS[b] ? a : b;
}

/**
 * Source of the decision, retained for diagnostics and telemetry.
 *
 * `host_safe_rule` is the ONLY legitimate way a host may grant ALLOW in
 * `safe-only` mode: a bounded explicit rule matched a constrained command
 * shape. Absence of a danger match never implies ALLOW.
 */
export type CommandDecisionSource =
	| "host_mode_all"
	| "host_mode_safe_only_rule"
	| "host_mode_safe_only_fallthrough"
	| "host_mode_manual"
	| "host_hard_deny"
	| "model_escalation"
	| "execution_plan_invalid"
	| "unknown_input"
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01-CORRECTION01:
	// The R5 catastrophic hard floor is a DOWNGRADE-only layer
	// above the canonical lattice. When the canonical policy
	// produced ALLOW and the risk layer positively matched an
	// R5 catastrophic family, the verdict is downgraded to ASK
	// with this source so the user/operator can see that the
	// ASK is from the catastrophic-class guard, not a generic
	// fallthrough.
	| "risk_hard_floor"
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01:
	// V2 structured-classifier promotion. When the host-owned
	// `MvdanShHelper` produces a structurally-complete AST and the
	// structured classifier confirms every reachable branch is
	// auto-approve eligible, a V1 ASK may be promoted to ALLOW with
	// this source. This is the ONLY path through which a V1 ASK
	// becomes ALLOW — V2 cannot weaken ASK, DENY, or any
	// never-auto-approve disposition.
	| "risk_v2_structured_promotion"
	// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01:
	// Workspace path authority downgrade. The R0 read-only rule
	// matched the command's argv shape, but at least one path
	// operand failed lexical workspace-root containment. The
	// command is downgraded from ALLOW to ASK with this source.
	// This is a STRICT SUBSET of the previous ALLOW set (it
	// removes cross-authority ALLOW; it never adds new ALLOW).
	| "host_workspace_path_authority"
	// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
	// REALPATH_WORKSPACE_CONFINEMENT:
	// Same idea as `host_workspace_path_authority` but the
	// downgrade was driven by HOST-PRODUCED realpath evidence.
	// The host called `fs.realpathSync` on the operand(s) and
	// canonical workspace root(s); the policy inspected the
	// evidence and downgraded because at least one operand
	// failed realpath-based containment (or failed to resolve
	// at all). Failures include:
	//   - realpath ENOENT  (path does not exist)
	//   - realpath EACCES  (permission denied)
	//   - realpath ELOOP   (symlink loop)
	//   - realpath ENOTDIR (a path component is not a directory)
	// All of these ⇒ ASK, never ALLOW.
	| "host_workspace_realpath_authority"
	// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01:
	// Host-evidence-bound temp-authority downgrade. The
	// `host_safe_mktemp_default_temp` lexical regex matched the
	// rendered shape (mktemp | mktemp -d), but the host did NOT
	// supply a `tempAuthorityEvidence` proving that the destination
	// is intrinsically bounded (i.e. the platform and effective
	// default temp root). Inherited environment (process.env.TMPDIR)
	// can steer GNU mktemp; the rendered command string alone does
	// not bound the destination. The verdict is downgraded to ASK
	// with this source so the operator sees why the AUTO did not
	// fire, and so the user retains the explicit-approval gate.
	| "host_mktemp_temp_authority_unbound";

export interface CommandDecision {
	kind: CommandDecisionKind;
	reason: string;
	source: CommandDecisionSource;
	/**
	 * Optional convenience pointer to the matched safe rule source for
	 * single-command ALLOW verdicts. For multi-command inputs use
	 * `EvaluateCommandPolicyResult.commands[i].matchedRuleSource`.
	 * Undefined for non-`host_mode_safe_only_rule` verdicts.
	 */
	matchedRuleSource?: string;
}

/**
 * One normalized command with its matched-rule provenance and (for safe-only
 * ALLOW) its safe execution profile. Produced per-command so a multi-command
 * input like `[pwd, git diff]` yields two `EvaluatedCommand` entries — the
 * pwd carries an empty profile (intrinsic), the git diff carries the
 * canonical hardening. The executor applies each profile independently.
 *
 * The runtime's executor MUST consult `safeExecutionProfile` and apply it
 * before invoking the tool. The executor MUST NOT execute the original
 * `normalized` command when a profile is present (CORRECTION04 invariant).
 *
 * `matchedRuleSource` is set when this command was matched by a specific
 * safe rule. `safeExecutionProfile` is the typed overlay that travels with
 * the command; it is independent of the aggregate `CommandDecision.kind`
 * (model escalation raises the kind but does not erase the profile).
 */
export interface EvaluatedCommand {
	index: number;
	normalized: NormalizedCommand;
	matchedRuleSource?: string;
	safeExecutionProfile?: SafeExecutionProfile;
}

/**
 * A single positive host allow rule. Each rule is a positive match on the
 * rendered command surface. Rules MUST be constrained: a rule that uses
 * shell-composition operators (`;`, `&&`, `||`, `|`, …) or matches a whole
 * executable family without arg-shape constraints is rejected at rule
 * construction time.
 */
export interface CommandHostAllowRule {
	source: string;
	/** A constrained positive match. */
	pattern: RegExp;
}

/**
 * Authorization context the host actually possesses.
 * Replaces a single boolean `autoApproveEnabled`, which collapses
 * distinct product semantics.
 */
export interface CommandHostAuthorization {
	mode: CommandHostMode;
	/**
	 * Optional explicit host deny rules (future). When set, any command
	 * matching these patterns is DENY unconditionally. The model cannot
	 * override a deny.
	 *
	 * Today this is ABSENT from production (no production deny source).
	 * Tests can inject rules to validate the lattice.
	 */
	explicitDenyRules?: ReadonlyArray<{ source: string; pattern: RegExp }>;
	/**
	 * Optional explicit host allow rules (the safe-only rule set).
	 *
	 * Each rule is a constrained positive match. Rules are evaluated in
	 * order; the FIRST match for a command yields ALLOW with
	 * `source: "host_mode_safe_only_rule"`.
	 *
	 * Empty/undefined: the host has no safe-rule engine configured, so
	 * `safe-only` mode degrades to ASK.
	 */
	explicitAllowRules?: ReadonlyArray<CommandHostAllowRule>;
	/**
	 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01
	 *
	 * Canonical absolute paths the host treats as "inside the
	 * project". An R0 read-only command is ALLOW-eligible only
	 * when EVERY path operand resolves under one of these roots
	 * (lexical containment via `path.resolve` + `startsWith`).
	 *
	 * The host is responsible for canonicalizing these (typically
	 * via `path.resolve`) before passing them in. The policy
	 * layer never trusts raw user-typed workspace roots.
	 *
	 * Empty/undefined: the host has not declared any workspace
	 * roots. The path authority then REFUSES to bless any
	 * R0 read-only command that has a path operand, so the
	 * command falls through to ASK (the regression this ACT
	 * closes — `ls /etc` previously was ALLOW by virtue of
	 * the path-agnostic regex alone).
	 */
	workspaceRoots?: ReadonlyArray<string>;
	/**
	 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01
	 *
	 * The host's current working directory. Relative path
	 * operands are resolved against this before containment is
	 * tested. The host is responsible for canonicalizing this
	 * (typically via `path.resolve`).
	 *
	 * Required for relative path operands to be ALLOW-eligible.
	 */
	cwd?: string;
	/**
	 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
	 * REALPATH_WORKSPACE_CONFINEMENT:
	 *
	 * Host-produced realpath evidence for path-bearing R0
	 * commands. The host (CLI or VS Code) calls
	 * `fs.realpathSync` on the operand(s) AND on the configured
	 * workspace root(s), then packages the results here. The
	 * policy module stays pure: it never touches the filesystem.
	 *
	 * When present, this evidence TAKES PRECEDENCE over the V1
	 * lexical `workspaceRoots` + `cwd` containment check. The V1
	 * check is the fallback used by hosts that have not yet
	 * upgraded to produce realpath evidence.
	 *
	 * The host MUST supply one operand entry per extracted path
	 * operand. The policy layer does NOT re-extract operands
	 * when consuming this evidence — the host is the source of
	 * truth.
	 *
	 * Failures (ENOENT, EACCES, ELOOP, ENOTDIR, …) are
	 * represented as `resolvedRealPath: null` in the operand
	 * evidence. The policy treats null as ASK, never ALLOW.
	 */
	pathAuthorityEvidence?: import("./path-authority-evidence").WorkspacePathAuthorityEvidence;
	/**
	 * ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01
	 *
	 * Host-produced evidence for the temporary-file-authority source
	 * family (currently: `host_safe_mktemp_default_temp`). The bare
	 * form `mktemp` / `mktemp -d` does NOT bound the destination by
	 * rendered shape alone -- the inherited process environment
	 * (e.g. `TMPDIR` on GNU mktemp) can steer where the file is
	 * created. This evidence MUST be supplied for promotion to ALLOW.
	 *
	 * `platform` reports the OS platform the executor will resolve
	 * `mktemp` on. For this ACT, only `darwin` is approved for
	 * promotion. Any other value (or `unknown`) returns ASK.
	 *
	 * `effectiveDefaultTempRoot` is the host-side observed default
	 * temp directory for the bare `mktemp` form on this platform
	 * (typically `_CS_DARWIN_USER_TEMP_DIR` on darwin).
	 *
	 * `canonicalDefaultTempRoot` is the realpath of the effective
	 * default temp root. The policy compares them verbatim.
	 *
	 * Defense-in-depth (not a substitution for binding the
	 * authorization to the actual executor capability): the executor
	 * also installs its own private canonical temp root under
	 * Seatbelt (see ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01).
	 * The policy-side evidence here is the user-facing authorization
	 * boundary; the Seatbelt-private-root composition is layered
	 * additional protection when the executor runs under sandbox.
	 *
	 * Empty/undefined: the host has not produced the evidence. The
	 * `host_safe_mktemp_default_temp` rule falls through to ASK with
	 * `host_mktemp_temp_authority_unbound`. This is a STRICT SUBSET
	 * gate: it only removes ALLOWs, never adds them.
	 */
	tempAuthorityEvidence?: TempAuthorityEvidence;
}

/**
 * ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION01
 *
 * Host-produced evidence that the temporary-file authority of a
 * command (currently `mktemp`) is bounded. See
 * `CommandHostAuthorization.tempAuthorityEvidence` for the full
 * contract.
 */
export interface TempAuthorityEvidence {
	/** OS platform the executor will resolve the command on. */
	platform: "darwin" | "linux" | "win32" | "unknown";
	/**
	 * Observed default temporary-file root on this platform for the
	 * bare command (e.g. the result of `confstr(_CS_DARWIN_USER_TEMP_DIR)`
	 * on darwin, or `process.env.TMPDIR` on linux). String; the
	 * policy treats it as a label, not a path authority witness.
	 */
	effectiveDefaultTempRoot: string;
	/**
	 * Canonicalized realpath of `effectiveDefaultTempRoot`. The
	 * policy compares this against the effective root for binding.
	 */
	canonicalDefaultTempRoot: string;
}

/**
 * Strict-mode constructor for host authorization.
 */
export function commandHostAuthorization(params: {
	mode: CommandHostMode;
	explicitDenyRules?: ReadonlyArray<{ source: string; pattern: RegExp }>;
	explicitAllowRules?: ReadonlyArray<CommandHostAllowRule>;
	workspaceRoots?: ReadonlyArray<string>;
	cwd?: string;
	pathAuthorityEvidence?: import("./path-authority-evidence").WorkspacePathAuthorityEvidence;
	tempAuthorityEvidence?: TempAuthorityEvidence;
}): CommandHostAuthorization {
	return {
		mode: params.mode,
		explicitDenyRules: params.explicitDenyRules,
		explicitAllowRules: params.explicitAllowRules,
		workspaceRoots: params.workspaceRoots,
		cwd: params.cwd,
		pathAuthorityEvidence: params.pathAuthorityEvidence,
		tempAuthorityEvidence: params.tempAuthorityEvidence,
	};
}

/**
 * A normalized command representation. `string` is the simple form;
 * `StructuredCommandInput` is the structured form used by the
 * canonical SDK normalizer.
 */
export type NormalizedCommand = string | StructuredCommandInput;

export interface NormalizedCommands {
	commands: NormalizedCommand[];
	ok: true;
}

export interface NormalizedFailure {
	ok: false;
	reason: string;
}

export type NormalizationResult = NormalizedCommands | NormalizedFailure;

/**
 * Result of evaluating a `run_commands` tool input against the canonical
 * command policy.
 *
 * `commands` is the per-command evaluation array. Each entry carries the
 * normalized command plus its matched-rule source and (for safe-only
 * ALLOW) the safe execution profile the executor MUST apply. The runtime
 * must NOT execute any command whose `safeExecutionProfile` is non-empty
 * without first applying that profile (CORRECTION04).
 *
 * The aggregate `decision` carries the lattice verdict (ALLOW/ASK/DENY)
 * and is monotonic with respect to model escalation. Model escalation
 * raises `decision.kind` but does NOT erase per-command profiles.
 */
export interface EvaluateCommandPolicyResult {
	decision: CommandDecision;
	commands: ReadonlyArray<EvaluatedCommand>;
	modelHints: CommandModelHints;
}
