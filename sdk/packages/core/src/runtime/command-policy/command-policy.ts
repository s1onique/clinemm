/**
 * Command Approval Policy Composition
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 *
 * The canonical `evaluateCommandPolicy()` entry point. Hosts translate
 * their user-facing settings into `CommandHostAuthorization` (mode +
 * optional explicit allow/deny rules) and call this function. The result
 * carries:
 *
 *   - decision.kind     allow / ask / deny
 *   - decision.source   provenance for telemetry
 *   - decision.reason   human-readable explanation
 *
 * Composition rule (monotonic):
 *   decision = host_base.max_restrictive(model_escalation)
 *
 * Steps:
 *   1. Normalize the input via the canonical SDK normalizer.
 *      Failure => ASK (source: unknown_input).
 *   2. Resolve host base from explicit host authorization.
 *      - "all" mode => ALLOW (the user granted unrestricted authority)
 *      - explicit deny rules (if any) => DENY (highest priority)
 *      - explicit allow rules (if any) => ALLOW
 *      - "safe-only" + matched safe-rule => ALLOW
 *      - "safe-only" without a match => ASK (no inference from absence)
 *      - "manual"  => ASK
 *   3. Apply model hint escalation ONLY.
 *      - model_escalation=true  => at least ASK
 *      - model_escalation=false => no weakening
 *      - missing/malformed      => no weakening
 */

import { normalizeRunCommandsInput } from "../../extensions/tools/helpers";
import type { StructuredCommandInput } from "../../extensions/tools/schemas";
import {
	type CommandModelHints,
	parseCommandModelHints,
	renderNormalizedCommand,
} from "./command-model-hints";
import type {
	CommandDecision,
	CommandHostAuthorization,
	NormalizationResult,
	NormalizedCommand,
} from "./command-policy-types";
import { findSafeRuleMatch } from "./command-safe-rules";

export interface EvaluateCommandPolicyInput {
	toolInput: unknown;
	hostAuthorization: CommandHostAuthorization;
}

export interface EvaluateCommandPolicyResult {
	decision: CommandDecision;
	normalized: NormalizedCommand[];
	modelHints: CommandModelHints;
}

/**
 * Compose the final command decision.
 *
 * This function is the single authoritative entry point used by VS Code
 * and CLI. Any host that wishes to gate `run_commands` / `execute_command`
 * tools MUST route through here.
 */
export function evaluateCommandPolicy(
	input: EvaluateCommandPolicyInput,
): EvaluateCommandPolicyResult {
	// 1. Normalize input via the canonical SDK normalizer.
	const normalization = normalizeForPolicy(input.toolInput);
	if (!normalization.ok) {
		const decision: CommandDecision = {
			kind: "ask",
			reason: `unable to parse command: ${normalization.reason}`,
			source: "unknown_input",
		};
		return {
			decision,
			normalized: [],
			modelHints: parseCommandModelHints(input.toolInput),
		};
	}

	// 2. Host base decision.
	const hostBase = resolveHostBase(
		normalization.commands,
		input.hostAuthorization,
	);

	// 3. Model hint aggregation.
	const modelHints = parseCommandModelHints(input.toolInput);

	// 4. Compose monotonically.
	let finalKind = hostBase.kind;
	let finalReason = hostBase.reason;
	let finalSource = hostBase.source;

	if (modelHints.effectiveEscalation && finalKind === "allow") {
		finalKind = "ask";
		finalReason = `${hostBase.reason} (model requested approval)`;
		finalSource = "model_escalation";
	}

	return {
		decision: {
			kind: finalKind,
			reason: finalReason,
			source: finalSource,
		},
		normalized: normalization.commands,
		modelHints,
	};
}

/**
 * Normalize raw tool input through the canonical SDK normalizer and
 * collapse its return shape into a `NormalizationResult` (the policy only
 * cares about "did we get commands?").
 */
function normalizeForPolicy(input: unknown): NormalizationResult {
	if (input == null) {
		return { ok: false, reason: "input is null/undefined" };
	}

	let normalized: ReadonlyArray<string | StructuredCommandInput>;
	try {
		normalized = normalizeRunCommandsInput(input);
	} catch {
		return { ok: false, reason: "canonical normalizer rejected input" };
	}

	if (normalized.length === 0) {
		return { ok: false, reason: "empty command list" };
	}

	const out: NormalizedCommand[] = [];
	for (const element of normalized) {
		if (typeof element === "string") {
			if (element.length === 0) {
				return { ok: false, reason: "empty command element" };
			}
			out.push(element);
			continue;
		}
		if (
			element &&
			typeof element === "object" &&
			typeof (element as StructuredCommandInput).command === "string" &&
			(element as StructuredCommandInput).command.length > 0
		) {
			out.push(element as StructuredCommandInput);
			continue;
		}
		return { ok: false, reason: "unparseable command element" };
	}

	return { ok: true, commands: out };
}

/**
 * Resolve the host base decision from explicit host authorization.
 *
 * Precedence (highest restrictiveness wins):
 *   1. explicit deny rules  -> DENY  (host_hard_deny)
 *   2. explicit allow rules  -> ALLOW (host_mode_safe_only_rule)
 *   3. "all" mode            -> ALLOW (host_mode_all)
 *   4. "safe-only" mode      -> ALLOW if a rule matches else ASK
 *                                (safe_only_rule / safe_only_fallthrough)
 *   5. "manual" mode         -> ASK   (host_mode_manual)
 *
 * NOTE: deny rules are checked first so the lattice is preserved even when
 * the user has enabled "execute all". The model cannot override a deny.
 */
function resolveHostBase(
	commands: NormalizedCommand[],
	auth: CommandHostAuthorization,
): CommandDecision {
	// 1. Explicit deny rules win absolutely.
	if (auth.explicitDenyRules && auth.explicitDenyRules.length > 0) {
		for (const cmd of commands) {
			const rendered = renderNormalizedCommand(cmd);
			for (const rule of auth.explicitDenyRules) {
				if (rule.pattern.test(rendered)) {
					return {
						kind: "deny",
						reason: `host deny rule matched: ${rule.source}`,
						source: "host_hard_deny",
					};
				}
			}
		}
	}

	const allowRules = auth.explicitAllowRules ?? [];

	// 2. Explicit allow rules (safe-only rule set).
	if (allowRules.length > 0) {
		const matchedSources: string[] = [];
		let allMatched = true;
		for (const cmd of commands) {
			const match = findSafeRuleMatch(cmd, allowRules);
			if (!match) {
				allMatched = false;
				break;
			}
			matchedSources.push(match.source);
		}
		if (allMatched) {
			return {
				kind: "allow",
				reason: `host-proven safe (${matchedSources.join(", ")})`,
				source: "host_mode_safe_only_rule",
			};
		}
		// Fall through to mode-based resolution.
	}

	// 3. Mode-based resolution.
	switch (auth.mode) {
		case "all":
			return {
				kind: "allow",
				reason: "user enabled execute-all-commands mode",
				source: "host_mode_all",
			};
		case "safe-only":
			return {
				kind: "ask",
				reason: "safe-only mode did not match any host safe rule",
				source: "host_mode_safe_only_fallthrough",
			};
		case "manual":
		default:
			return {
				kind: "ask",
				reason: "manual mode requires approval",
				source: "host_mode_manual",
			};
	}
}

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
	isMoreRestrictive,
	maxRestrictive,
	type NormalizationResult,
	type NormalizedCommand,
	type NormalizedCommands,
	type NormalizedFailure,
} from "./command-policy-types";

export {
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	findSafeRuleMatch,
	isOpaqueShellRendered,
	OPAQUE_SHELL_TOKENS,
} from "./command-safe-rules";
