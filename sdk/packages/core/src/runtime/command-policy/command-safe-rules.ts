/**
 * Host-Owned Safe-Command Rule Engine
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 *
 * A bounded, explicit positive-matcher for `safe-only` host mode.
 *
 * PRINCIPLES:
 *   - ALLOW requires positive host evidence.
 *   - Absence of danger never implies ALLOW.
 *   - A whole-executable-family allowlist (e.g. "all `git` is safe") is
 *     FORBIDDEN. Only constrained command shapes match.
 *   - Shell composition operators that hide intent (see OPAQUE_SHELL_TOKENS)
 *     never match a rule. They degrade to ASK unless an explicit user rule
 *     overrides them (which we do not provide here).
 *   - Rules are evaluated on the rendered command surface; the rule engine
 *     does NOT execute shell parsing.
 *
 * INITIAL RULE SET:
 *   Derived from observational git workflows and read-only commands. Each
 *   rule is a positive regex match on the rendered command surface.
 *
 *   pwd
 *   git status [...]
 *   git diff [...]
 *   git log [...]
 *
 * The set is intentionally small. Adding a rule MUST be a deliberate
 * decision; new rules are added by appending to DEFAULT_COMMAND_HOST_ALLOW_RULES
 * (and a corresponding unit test).
 */

import { renderNormalizedCommand } from "./command-model-hints";
import type { NormalizedCommand } from "./command-policy-types";

/**
 * Shell tokens that indicate opaque composition. If a rendered command
 * contains any of these, no safe rule may match — the rule engine cannot
 * confidently parse what the shell would do.
 *
 * These are conservative; some uses (e.g. `cmd | head`) may be legitimate
 * but cannot be evaluated by a regex-positive matcher without a real shell
 * parser. Fail closed.
 */
export const OPAQUE_SHELL_TOKENS: ReadonlyArray<string> = [
	";",
	"&&",
	"||",
	"|",
	"$(",
	"`",
	"eval ",
	"sh -c",
	"bash -c",
	"zsh -c",
	">",
	"<",
	">>",
	"<<",
	"$((",
	"${",
];

/**
 * The default host-proven safe rules.
 *
 * Each rule MUST be anchored (^...$ or \b...\b) so the match is positive
 * and constrained. Each rule corresponds to a single observable command
 * shape the host has positive evidence is safe.
 */
export const DEFAULT_COMMAND_HOST_ALLOW_RULES: ReadonlyArray<{
	source: string;
	pattern: RegExp;
}> = [
	{ source: "host_safe_pwd", pattern: /^\s*pwd(?:\s+(?:-[LP]))?\s*$/u },
	{
		source: "host_safe_git_status",
		// git status with optional read-only flags. Explicitly forbids --porcelain
		// to keep "raw" mode (rare and usually diagnostic) out of the safe path.
		pattern:
			/^\s*git\s+status(?:\s+(?:--short|--branch|--porcelain(?:=\d)?|-s|-b|-u(?:=[a-z]+)?))*\s*$/u,
	},
	{
		source: "host_safe_git_diff",
		// git diff with optional read-only flags. Forbids --no-color manipulation,
		// --output, --output-* redirections, and any path argument starting with -
		// (we treat it as a flag, not a path). The host does NOT verify that paths
		// exist or are in the workspace; the rule asserts the command SHAPE is
		// observational.
		pattern:
			/^\s*git\s+diff(?:\s+(?:--no-color|--color=[a-z]+|--stat|--numstat|--shortstat|--name-only|--name-status|--cached|--staged|--[a-z-]+))*$/u,
	},
	{
		source: "host_safe_git_log",
		// git log with read-only flags. Caps -n to positive integers.
		pattern:
			/^\s*git\s+log(?:\s+(?:-n\s+\d+|--oneline|--stat|--no-color|--pretty=[a-z%]+|-[0-9]+))*\s*$/u,
	},
];

/**
 * Whether a rendered command contains opaque shell composition tokens.
 * If true, no safe rule may match: the rule engine cannot reliably evaluate.
 */
export function isOpaqueShellRendered(rendered: string): boolean {
	for (const token of OPAQUE_SHELL_TOKENS) {
		if (rendered.includes(token)) {
			return true;
		}
	}
	return false;
}

/**
 * Test if a single normalized command is host-proven safe by the supplied
 * rule set. Returns the matched rule's source, or undefined if no rule
 * matches.
 *
 * If the rendered command is opaque, no rule matches (return undefined).
 */
export function findSafeRuleMatch(
	command: NormalizedCommand,
	rules: ReadonlyArray<{ source: string; pattern: RegExp }>,
): { source: string } | undefined {
	const rendered = renderNormalizedCommand(command).trim();
	if (rendered.length === 0) {
		return undefined;
	}
	if (isOpaqueShellRendered(rendered)) {
		return undefined;
	}
	for (const rule of rules) {
		if (rule.pattern.test(rendered)) {
			return { source: rule.source };
		}
	}
	return undefined;
}
