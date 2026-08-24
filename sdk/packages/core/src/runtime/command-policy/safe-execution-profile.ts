/**
 * Safe Execution Profiles (CORRECTION04)
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION04
 *
 * The previous architecture (CORRECTION02/03) defined safety purely in
 * terms of the rendered command line ("is this argv safe?"). That is
 * necessary but not sufficient: Git's documented execution model allows
 * external helper invocation through:
 *
 *   - `core.fsmonitor`        (filesystem monitor hook; affects `git status`)
 *   - `diff.<driver>.command` (external diff driver; affects `git diff`)
 *   - textconv filters        (per `gitattributes(5)`); git-diff(1) says
 *                              "text conversion filters are enabled by
 *                              default for `git diff` and `git log`".
 *   - `core.hooksPath`         (general hook dispatch)
 *   - the pager               (e.g. less, which can execute shell)
 *
 * CORRECTION04 closes this gap by attaching a per-command safe execution
 * profile that the EXECUTOR must apply. The classification (argv shape)
 * and the execution envelope (what flags the host runs Git with) are
 * independent axes:
 *
 *   authority lattice     execution constraints
 *   ----------------     -------------------
 *   ALLOW < ASK < DENY   per-command profile (or none)
 *
 * Model escalation raises authority but does NOT erase execution
 * constraints. A user-approved ASK with `git diff` still runs hardened.
 *
 * PER-COMMAND, not per-decision: a multi-command input like
 * `[pwd, git diff]` must produce two execution plans, one per command.
 * The profile travels with the command, not with the aggregate verdict.
 *
 * The canonical profile shapes:
 *   SAFE_PWD_PROFILE        — no overlay (intrinsic).
 *   SAFE_GIT_STATUS_PROFILE — global hardening + fsmonitor/hooks/pager;
 *                              no diff-specific suffix (status is porcelain).
 *   SAFE_GIT_DIFF_PROFILE   — global hardening + --no-ext-diff/--no-textconv.
 *   SAFE_GIT_LOG_PROFILE    — global hardening + --no-ext-diff/--no-textconv.
 *
 * The profile lives in `@cline/core` so every host that consumes the
 * canonical policy also has the canonical overlay. The shared SDK agent
 * runtime enforces it via the new `CommandExecutionPlan` path; hosts do
 * not need to remember to apply it themselves.
 */

import type { StructuredCommandInput } from "../../extensions/tools/schemas";

/**
 * Identifies a class of safe execution profile. Hosts and execution
 * tooling switch on this enum to pick the right hardening.
 */
export type SafeExecutionProfileKind = "git_observational" | "pwd";

export interface SafeExecutionProfile {
	kind: SafeExecutionProfileKind;
	source: string;
	description: string;
	/**
	 * Flags inserted between the executable (`git`) and the subcommand
	 * (`status`/`diff`/`log`). These are git-global options.
	 */
	commandPrefix: ReadonlyArray<string>;
	/**
	 * Flags inserted immediately after the subcommand name. These are
	 * subcommand options (e.g. `--no-ext-diff`, `--no-textconv` for
	 * `git diff` / `git log`).
	 *
	 * For `git status` this MUST be empty: `--no-ext-diff` and
	 * `--no-textconv` are diff-family options, not status options. A
	 * profile with non-empty `commandSuffix` MUST only be applied to the
	 * matching subcommand.
	 */
	commandSuffix: ReadonlyArray<string>;
}

export const SAFE_PWD_PROFILE: SafeExecutionProfile = {
	kind: "pwd",
	source: "host_safe_pwd_profile",
	description: "pwd is intrinsic; no overlay required.",
	commandPrefix: [],
	commandSuffix: [],
};

const GIT_GLOBAL_HARDENING: ReadonlyArray<string> = [
	"--no-pager",
	"-c",
	"core.pager=cat",
	"-c",
	"core.fsmonitor=false",
	"-c",
	"core.hooksPath=/dev/null",
];

const DIFF_FAMILY_SUFFIX: ReadonlyArray<string> = [
	"--no-ext-diff",
	"--no-textconv",
];

export const SAFE_GIT_STATUS_PROFILE: SafeExecutionProfile = {
	kind: "git_observational",
	source: "host_safe_git_status_profile",
	description:
		"Run git status under hardened globals: pager disabled, fsmonitor/hooks/pager neutralized via -c overrides. No diff-specific suffix because status is porcelain and --no-ext-diff/--no-textconv are diff-family options.",
	commandPrefix: GIT_GLOBAL_HARDENING,
	commandSuffix: [],
};

export const SAFE_GIT_DIFF_PROFILE: SafeExecutionProfile = {
	kind: "git_observational",
	source: "host_safe_git_diff_profile",
	description:
		"Run git diff under hardened globals AND with --no-ext-diff/--no-textconv to disable external diff driver and textconv filter invocation. Textconv is enabled by default for git diff per git-diff(1).",
	commandPrefix: GIT_GLOBAL_HARDENING,
	commandSuffix: DIFF_FAMILY_SUFFIX,
};

export const SAFE_GIT_LOG_PROFILE: SafeExecutionProfile = {
	kind: "git_observational",
	source: "host_safe_git_log_profile",
	description:
		"Run git log under hardened globals AND with --no-ext-diff/--no-textconv. Same rationale as SAFE_GIT_DIFF_PROFILE; textconv is enabled by default for git log per git-diff(1).",
	commandPrefix: GIT_GLOBAL_HARDENING,
	commandSuffix: DIFF_FAMILY_SUFFIX,
};

export const SAFE_GIT_BRANCH_PROFILE: SafeExecutionProfile = {
	kind: "git_observational",
	source: "host_safe_git_branch_profile",
	description:
		"Run git branch under hardened globals: pager disabled, fsmonitor/hooks/pager neutralized via -c overrides. No diff-specific suffix because git branch is observational/list mode and --no-ext-diff/--no-textconv are diff-family options, not branch-list options.",
	commandPrefix: GIT_GLOBAL_HARDENING,
	commandSuffix: [],
};

export const SAFE_GIT_REMOTE_PROFILE: SafeExecutionProfile = {
	kind: "git_observational",
	source: "host_safe_git_remote_profile",
	description:
		"Run git remote under hardened globals: pager disabled, fsmonitor/hooks/pager neutralized via -c overrides. No diff-specific suffix because git remote is observational/list mode and --no-ext-diff/--no-textconv are diff-family options, not remote-list options.",
	commandPrefix: GIT_GLOBAL_HARDENING,
	commandSuffix: [],
};

export const SAFE_ECHO_PROFILE: SafeExecutionProfile = {
	kind: "pwd",
	source: "host_safe_echo_profile",
	description:
		"echo is intrinsic; no overlay required. echo takes no helper, no fs write, no authority-broadening effect. The git-family hardening flags would BREAK echo's argument parsing (they would be interpreted as text to echo); they are not used here.",
	commandPrefix: [],
	commandSuffix: [],
};

export const SAFE_LS_PROFILE: SafeExecutionProfile = {
	kind: "pwd",
	source: "host_safe_ls_profile",
	description:
		"Run ls with no overlay. ls is intrinsically read-only (no helper invocation, no fs write); no per-subcommand suffix needed. The git-family hardening flags (-c core.* / core.hooksPath=/dev/null) are git-specific and would BREAK ls if applied; they are not used here. ls has no standard --no-pager flag; pager output for a read-only listing is acceptable.",
	commandPrefix: [],
	commandSuffix: [],
};

export const SAFE_FIND_PROFILE: SafeExecutionProfile = {
	kind: "pwd",
	source: "host_safe_find_profile",
	description:
		"Run find with no overlay. find is intrinsically read-only when invoked with stdout-only actions; no per-subcommand suffix needed. The git-family hardening flags would BREAK find's argument parsing (they would be interpreted as starting paths); they are not used here. find has no standard --no-pager flag; pager output for a read-only listing is acceptable.",
	commandPrefix: [],
	commandSuffix: [],
};

// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01
//
// Safe execution profiles for the three new R0 path-bearing
// reader families (`host_safe_cat`, `host_safe_head_path`,
// `host_safe_tail_path`). All three are intrinsic read-only
// file copies; no helper invocation, no fs write, no pager
// control needed.
//
// The git-family hardening flags (`-c core.*` /
// `core.hooksPath=/dev/null`) would BREAK these readers
// (interpreted as positional arguments); they are NOT used.
// These readers have no `--no-pager` flag; pager output for
// a read-only cat/head/tail is acceptable.
export const SAFE_CAT_PROFILE: SafeExecutionProfile = {
	kind: "pwd",
	source: "host_safe_cat_profile",
	description:
		"Run cat with no overlay. cat is intrinsically read-only file copy (no helper invocation, no fs write); no per-subcommand suffix needed. The git-family hardening flags would BREAK cat (interpreted as file operands); they are not used here.",
	commandPrefix: [],
	commandSuffix: [],
};

export const SAFE_HEAD_PATH_PROFILE: SafeExecutionProfile = {
	kind: "pwd",
	source: "host_safe_head_path_profile",
	description:
		"Run head with no overlay. head is intrinsically read-only when reading files (no helper invocation, no fs write); no per-subcommand suffix needed. The git-family hardening flags would BREAK head (interpreted as options/operands); they are not used here.",
	commandPrefix: [],
	commandSuffix: [],
};

export const SAFE_TAIL_PATH_PROFILE: SafeExecutionProfile = {
	kind: "pwd",
	source: "host_safe_tail_path_profile",
	description:
		"Run tail with no overlay. tail is intrinsically read-only when reading files in finite mode (no follow mode, no helper invocation, no fs write); no per-subcommand suffix needed. The git-family hardening flags would BREAK tail (interpreted as options/operands); they are not used here.",
	commandPrefix: [],
	commandSuffix: [],
};

export function getSafeExecutionProfileForSource(
	source: string,
): SafeExecutionProfile | undefined {
	switch (source) {
		case "host_safe_pwd":
			return SAFE_PWD_PROFILE;
		case "host_safe_git_status":
			return SAFE_GIT_STATUS_PROFILE;
		case "host_safe_git_diff":
			return SAFE_GIT_DIFF_PROFILE;
		case "host_safe_git_log":
			return SAFE_GIT_LOG_PROFILE;
		case "host_safe_git_branch":
			return SAFE_GIT_BRANCH_PROFILE;
		case "host_safe_git_remote":
			return SAFE_GIT_REMOTE_PROFILE;
		case "host_safe_echo":
			return SAFE_ECHO_PROFILE;
		case "host_safe_ls":
			return SAFE_LS_PROFILE;
		case "host_safe_find":
			return SAFE_FIND_PROFILE;
		// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01:
		// three new R0 path-bearing reader profiles.
		case "host_safe_cat":
			return SAFE_CAT_PROFILE;
		case "host_safe_head_path":
			return SAFE_HEAD_PATH_PROFILE;
		case "host_safe_tail_path":
			return SAFE_TAIL_PATH_PROFILE;
		default:
			return undefined;
	}
}

/**
 * Apply a profile to a single normalized command.
 *
 * Returns a NEW command (string or StructuredCommandInput) that, when
 * run by the canonical executor, will execute the original command under
 * the profile's hardened flags. The original input is not mutated.
 *
 * Insertion rules (per Git CLI argument parsing):
 *   - `commandPrefix` flags are inserted BETWEEN `git` and the
 *     subcommand. They are global git options.
 *   - `commandSuffix` flags are inserted IMMEDIATELY AFTER the
 *     subcommand name. They are subcommand options.
 *
 * For `StructuredCommandInput` the rewrite operates directly on the
 * typed `args[]` array — the renderer/string-splitter is NEVER
 * consulted. This preserves argv boundaries even when args contain
 * spaces or shell metacharacters. The string-input path is kept for
 * callers that pass rendered strings, but its use is bounded by the
 * `PROFILE_REWRITER_INPUT_DOMAIN` contract (only commands already
 * positively accepted by `DEFAULT_COMMAND_HOST_ALLOW_RULES`).
 */
export function applySafeExecutionProfileToCommand(
	command: string | StructuredCommandInput,
	profile: SafeExecutionProfile,
): string | StructuredCommandInput {
	if (
		profile.commandPrefix.length === 0 &&
		profile.commandSuffix.length === 0
	) {
		return command;
	}

	// Structured path: rewrite the typed args array directly, no
	// render/split/round-trip.
	if (typeof command !== "string") {
		return applyProfileToStructured(command, profile);
	}
	return applyProfileToString(command, profile);
}

function applyProfileToStructured(
	command: StructuredCommandInput,
	profile: SafeExecutionProfile,
): StructuredCommandInput {
	const args = command.args ?? [];
	// Find the executable position. Per the policy, command.command is
	// the executable (`git` or `pwd`) and args[0] (if present) is the
	// subcommand. Global options between `git` and the subcommand name
	// are dropped to keep the insertion contract honest.
	if (command.command !== "git") {
		// Not a git command (e.g. pwd passed the wrong profile).
		// Return unchanged; the policy layer is responsible for
		// matching profiles to commands.
		return command;
	}

	let subIdx = 0;
	while (subIdx < args.length && args[subIdx]?.startsWith("-")) {
		subIdx++;
	}
	const subcommand = args[subIdx];
	if (subcommand === undefined) {
		return command;
	}
	const pre = args.slice(0, subIdx); // any leading global options
	const existingArgs = args.slice(subIdx + 1);

	return {
		...command,
		args: [
			...pre,
			...profile.commandPrefix,
			subcommand,
			...profile.commandSuffix,
			...existingArgs,
		],
	};
}

function applyProfileToString(
	command: string,
	profile: SafeExecutionProfile,
): string {
	const tokens = command.trim().split(/\s+/u);
	if (tokens.length === 0) {
		return command;
	}

	let firstNonOption = 0;
	while (
		firstNonOption < tokens.length &&
		tokens[firstNonOption].startsWith("-")
	) {
		firstNonOption++;
	}
	if (tokens[firstNonOption] !== "git") {
		// Not a git command. Return unchanged; the policy layer is
		// responsible for matching profiles to commands.
		return command;
	}

	let subIdx = firstNonOption + 1;
	while (subIdx < tokens.length && tokens[subIdx].startsWith("-")) {
		subIdx++;
	}
	const subcommand = tokens[subIdx];
	if (subcommand === undefined) {
		return command;
	}

	const pre = tokens.slice(0, subIdx);
	const existingArgs = tokens.slice(subIdx + 1);

	return [
		...pre,
		...profile.commandPrefix,
		subcommand,
		...profile.commandSuffix,
		...existingArgs,
	].join(" ");
}
