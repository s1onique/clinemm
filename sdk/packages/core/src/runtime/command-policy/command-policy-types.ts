/**
 * Command Approval Policy - Host Authority for Shell Command Execution
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 *
 * Canonical location for the command-approval policy types. Consumed by
 * VS Code (`apps/vscode/src/sdk/...`), CLI (`apps/cli/src/runtime/...`), and
 * any future host via the `evaluateCommandPolicy()` entry point.
 *
 * PRIMARY INVARIANT:
 *   effectiveDecision >= hostDecision
 *   where restrictiveness: ALLOW < ASK < DENY
 *
 * The model MAY ONLY ESCALATE. It can never downgrade ASK or DENY.
 *
 * The host does NOT maintain a complete shell-command semantic classifier.
 * Therefore the host can only legitimately ALLOW when the user has explicitly
 * granted unrestricted command execution, OR when a positive, bounded host
 * rule matches a constrained command shape (see `command-safe-rules.ts`).
 */

import type { StructuredCommandInput } from "../../extensions/tools/schemas";

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
	| "unknown_input";

export interface CommandDecision {
	kind: CommandDecisionKind;
	reason: string;
	source: CommandDecisionSource;
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
}

/**
 * Strict-mode constructor for host authorization.
 */
export function commandHostAuthorization(params: {
	mode: CommandHostMode;
	explicitDenyRules?: ReadonlyArray<{ source: string; pattern: RegExp }>;
	explicitAllowRules?: ReadonlyArray<CommandHostAllowRule>;
}): CommandHostAuthorization {
	return {
		mode: params.mode,
		explicitDenyRules: params.explicitDenyRules,
		explicitAllowRules: params.explicitAllowRules,
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
