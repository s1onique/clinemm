/**
 * Command Approval Policy Composition
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION04
 *
 * The canonical `evaluateCommandPolicy()` entry point. Hosts translate
 * their user-facing settings into `CommandHostAuthorization` (mode +
 * optional explicit allow/deny rules) and call this function. The result
 * carries:
 *
 *   - decision.kind     allow / ask / deny   (lattice verdict)
 *   - decision.source   provenance for telemetry
 *   - decision.reason   human-readable explanation
 *   - commands[i]       per-command EvaluatedCommand carrying the
 *                       matched-rule source and (for safe-only ALLOW)
 *                       the safe execution profile the executor MUST
 *                       apply at execution time.
 *
 * Composition rule (monotonic authority lattice):
 *   decision = host_base.max_restrictive(model_escalation)
 *
 * Execution constraints are independent:
 *   - per-command profiles travel with the EvaluatedCommand;
 *   - model escalation raises the lattice verdict but does NOT
 *     erase the per-command profile (a user-approved ASK still runs
 *     hardened).
 *
 * Steps:
 *   1. Normalize the input via the canonical SDK normalizer.
 *      Failure => ASK (source: unknown_input).
 *   2. Per-command host base resolution: each normalized command
 *      yields its own kind/source/profile (CORRECTION04).
 *   3. Aggregate the lattice verdict across all commands.
 *   4. Apply model hint escalation ONLY.
 *      - model_escalation=true  => at least ASK
 *      - model_escalation=false => no weakening
 *      - missing/malformed      => no weakening
 */

import { normalizeRunCommandsInput } from "../../extensions/tools/helpers";
import type { StructuredCommandInput } from "../../extensions/tools/schemas";
import {
	parseCommandModelHints,
	renderNormalizedCommand,
} from "./command-model-hints";
import type {
	CommandDecision,
	CommandDecisionKind,
	CommandDecisionSource,
	CommandHostAuthorization,
	EvaluateCommandPolicyResult,
	EvaluatedCommand,
	NormalizationResult,
	NormalizedCommand,
} from "./command-policy-types";
import { findSafeRuleMatch } from "./command-safe-rules";
import {
	getSafeExecutionProfileForSource,
	type SafeExecutionProfile,
} from "./safe-execution-profile";

export interface EvaluateCommandPolicyInput {
	toolInput: unknown;
	hostAuthorization: CommandHostAuthorization;
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
			commands: [],
			modelHints: parseCommandModelHints(input.toolInput),
		};
	}

	// 2. Per-command host base resolution (CORRECTION04): each command
	//    is evaluated independently. Each entry carries its own
	//    matched-rule source AND its own safe execution profile.
	const perCommand = resolvePerCommand(
		normalization.commands,
		input.hostAuthorization,
	);

	// 3. Aggregate the lattice verdict across all commands.
	const aggregateKind = aggregateLattice(perCommand);

	// 4. Model hint aggregation.
	const modelHints = parseCommandModelHints(input.toolInput);

	// 5. Compose monotonically: model escalation raises the lattice
	//    verdict but does NOT erase per-command profiles. The profiles
	//    remain attached to the per-command entries so a user-approved
	//    ASK still runs hardened (defense in depth).
	let finalKind = aggregateKind;
	let finalReason = aggregateReason(perCommand);
	let finalSource = aggregateSource(perCommand, input.hostAuthorization);

	if (modelHints.effectiveEscalation && finalKind === "allow") {
		finalKind = "ask";
		finalReason = `${aggregateReason} (model requested approval)`;
		finalSource = "model_escalation";
	}

	// 6. Convenience pointer for single-command ALLOW verdicts: expose
	//    the matched safe rule source on the aggregate decision for
	//    back-compat callers. For multi-command inputs this is undefined
	//    and callers MUST consult `commands[i].matchedRuleSource`.
	const singleMatchedSource =
		perCommand.length === 1 ? perCommand[0]?.matchedRuleSource : undefined;

	// 7. Materialize per-command EvaluatedCommand[].
	const evaluatedCommands: EvaluatedCommand[] = perCommand.map((ev) => ({
		index: ev.index,
		normalized: ev.normalized,
		matchedRuleSource: ev.matchedRuleSource,
		safeExecutionProfile: ev.safeExecutionProfile,
	}));

	return {
		decision: {
			kind: finalKind,
			reason: finalReason,
			source: finalSource,
			matchedRuleSource: singleMatchedSource,
		},
		commands: evaluatedCommands,
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
 * Per-command host evaluation record (internal to the policy module).
 * The EvaluatedCommand exposed to callers is the public projection of
 * this record.
 */
interface PerCommandEvaluation {
	index: number;
	normalized: NormalizedCommand;
	kind: CommandDecisionKind;
	source: CommandDecisionSource;
	matchedRuleSource?: string;
	reason: string;
	safeExecutionProfile?: SafeExecutionProfile;
}

/**
 * Resolve each normalized command independently against the host
 * authorization. This is the per-command host base evaluation (CORRECTION04);
 * aggregate decisions live in `evaluateCommandPolicy`.
 *
 * Per-command precedence (highest restrictiveness wins per command):
 *   1. explicit deny rules  -> DENY  (host_hard_deny)
 *   2. explicit allow rules  -> ALLOW (host_mode_safe_only_rule, plus
 *                                the safe execution profile from the
 *                                matched rule's source)
 *   3. "all" mode            -> ALLOW (host_mode_all, no overlay)
 *   4. "safe-only" mode      -> ALLOW if a rule matches else ASK
 *                                (safe_only_rule / safe_only_fallthrough)
 *   5. "manual" mode         -> ASK   (host_mode_manual)
 */
function resolvePerCommand(
	commands: ReadonlyArray<NormalizedCommand>,
	auth: CommandHostAuthorization,
): PerCommandEvaluation[] {
	return commands.map((normalized, index) => {
		const evaluated = evaluateOne(normalized, auth);
		return { index, normalized, ...evaluated };
	});
}

function evaluateOne(
	command: NormalizedCommand,
	auth: CommandHostAuthorization,
): Omit<PerCommandEvaluation, "index" | "normalized"> {
	// 1. Explicit deny rules win absolutely.
	if (auth.explicitDenyRules && auth.explicitDenyRules.length > 0) {
		const rendered = renderNormalizedCommand(command);
		for (const rule of auth.explicitDenyRules) {
			if (rule.pattern.test(rendered)) {
				return {
					kind: "deny",
					source: "host_hard_deny",
					reason: `host deny rule matched: ${rule.source}`,
				};
			}
		}
	}

	const allowRules = auth.explicitAllowRules ?? [];

	// 2. Explicit allow rules (safe-only rule set).
	if (allowRules.length > 0) {
		const match = findSafeRuleMatch(command, allowRules);
		if (match) {
			const profile = getSafeExecutionProfileForSource(match.source);
			return {
				kind: "allow",
				source: "host_mode_safe_only_rule",
				reason: `host-proven safe (${match.source})`,
				matchedRuleSource: match.source,
				safeExecutionProfile: profile,
			};
		}
	}

	// 3. Mode-based resolution.
	switch (auth.mode) {
		case "all":
			return {
				kind: "allow",
				source: "host_mode_all",
				reason: "user enabled execute-all-commands mode",
			};
		case "safe-only":
			return {
				kind: "ask",
				source: "host_mode_safe_only_fallthrough",
				reason: "safe-only mode did not match any host safe rule",
			};
		case "manual":
		default:
			return {
				kind: "ask",
				source: "host_mode_manual",
				reason: "manual mode requires approval",
			};
	}
}

function aggregateLattice(
	perCommand: PerCommandEvaluation[],
): CommandDecisionKind {
	let anyAsk = false;
	let anyDeny = false;
	let anyAllow = false;
	for (const ev of perCommand) {
		if (ev.kind === "deny") {
			anyDeny = true;
		} else if (ev.kind === "ask") {
			anyAsk = true;
		} else {
			anyAllow = true;
		}
	}
	if (anyDeny) {
		return "deny";
	}
	if (anyAsk) {
		return "ask";
	}
	return anyAllow ? "allow" : "ask";
}

function aggregateReason(perCommand: PerCommandEvaluation[]): string {
	if (perCommand.length === 1) {
		return perCommand[0]?.reason ?? "policy result";
	}
	const allowed: string[] = [];
	const asked: string[] = [];
	const denied: string[] = [];
	perCommand.forEach((ev, idx) => {
		const label = `[${idx}] ${ev.matchedRuleSource ?? ev.source}`;
		if (ev.kind === "allow") {
			allowed.push(label);
		} else if (ev.kind === "ask") {
			asked.push(label);
		} else {
			denied.push(label);
		}
	});
	const parts: string[] = [];
	if (allowed.length > 0) {
		parts.push(`auto-allow: ${allowed.join(", ")}`);
	}
	if (asked.length > 0) {
		parts.push(`needs-approval: ${asked.join(", ")}`);
	}
	if (denied.length > 0) {
		parts.push(`denied: ${denied.join(", ")}`);
	}
	return parts.join("; ");
}

function aggregateSource(
	perCommand: PerCommandEvaluation[],
	auth: CommandHostAuthorization,
): CommandDecisionSource {
	if (perCommand.length === 1) {
		return perCommand[0]!.source;
	}
	let anyDeny = false;
	let anyManual = false;
	let anySafeOnlyFallthrough = false;
	let anySafeOnlyRule = false;
	let anyAll = false;
	for (const ev of perCommand) {
		if (ev.kind === "deny") {
			anyDeny = true;
		} else if (ev.source === "host_mode_manual") {
			anyManual = true;
		} else if (ev.source === "host_mode_safe_only_fallthrough") {
			anySafeOnlyFallthrough = true;
		} else if (ev.source === "host_mode_safe_only_rule") {
			anySafeOnlyRule = true;
		} else if (ev.source === "host_mode_all") {
			anyAll = true;
		}
	}
	if (anyDeny) {
		return "host_hard_deny";
	}
	if (anyManual) {
		return "host_mode_manual";
	}
	if (anySafeOnlyFallthrough) {
		return "host_mode_safe_only_fallthrough";
	}
	if (anySafeOnlyRule) {
		return "host_mode_safe_only_rule";
	}
	if (anyAll || auth.mode === "all") {
		return "host_mode_all";
	}
	return "host_mode_manual";
}

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
	type EvaluateCommandPolicyResult,
	type EvaluatedCommand,
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
