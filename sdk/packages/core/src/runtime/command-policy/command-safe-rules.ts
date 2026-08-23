/**
 * Host-Owned Safe-Command Rule Engine
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION03
 *
 * A bounded, explicit positive-matcher for `safe-only` host mode.
 *
 * PRINCIPLES:
 *   - ALLOW requires positive host evidence that the COMPLETE invocation
 *     matches a finite, explicitly reviewed rule.
 *   - Absence of danger never implies ALLOW.
 *   - A whole-executable-family allowlist (e.g. "all `git` is safe") is
 *     FORBIDDEN. Only constrained command shapes match.
 *   - Shell composition operators that hide intent (see OPAQUE_SHELL_TOKENS)
 *     never match a rule. They degrade to ASK unless an explicit user rule
 *     overrides them (which we do not provide here).
 *   - Rules are evaluated on the rendered command surface; the rule engine
 *     does NOT execute shell parsing.
 *   - NO GENERIC OPTION WILDCARDS. Every permitted option is enumerated in
 *     a finite positive list derived from a security review of the option's
 *     documented semantics. Generic `--[a-z-]+`-style patterns are forbidden
 *     because they implicitly trust unknown options.
 *
 *     The previous `--[a-z-]+` branch in `git diff` matched `--ext-diff` and
 *     `--textconv`, both of which can invoke external helpers per Git's
 *     documented diff machinery (see git-diff(1) and gitattributes(5)).
 *     CORRECTION03 removed that wildcard and the analog in `git log`.
 *
 * REVIEW STANDARD (each option must satisfy this before being allowed):
 *   - Can this option cause execution of an external program (helper,
 *     textconv, external diff driver)?
 *   - Can this option write outside the normal stdout/stderr channel
 *     (e.g. --output=<path>)?
 *   - Can this option broaden the comparison scope outside the working
 *     repository (e.g. --no-index)?
 *   - Does the option have any other authority-broadening effect?
 *
 *   If ANY answer is yes, the option is REJECTED and the rule engine
 *   returns ASK for any invocation that includes it.
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
 * Each rule is anchored so the match is positive and constrained.
 * Each option in each rule's pattern is individually reviewed against
 * the standard described at the top of this file. Adding a new option
 * to any rule MUST be a deliberate decision accompanied by a test that
 * documents the option's safety review.
 */
export const DEFAULT_COMMAND_HOST_ALLOW_RULES: ReadonlyArray<{
	source: string;
	pattern: RegExp;
}> = [
	// pwd with optional POSIX -L / -P (logical / physical working directory).
	// Both are pure read-only reporting.
	{ source: "host_safe_pwd", pattern: /^\s*pwd(?:\s+(?:-[LP]))?\s*$/u },
	{
		source: "host_safe_git_status",
		// git status reporting modes. All options here are pure output-format
		// selection; none invoke external helpers or write to disk.
		//   --short / -s           condensed output
		//   --branch / -b          include branch info
		//   --porcelain[=N]        machine-readable (v1=v1, v2=v2); N in {1,2}
		//   -u[=<mode>]            untracked-file mode; mode in {no,normal,all}
		pattern:
			/^\s*git\s+status(?:\s+(?:--short|-s|--branch|-b|--porcelain(?:=[12])?|-u(?:=(?:no|normal|all))?))*$/u,
	},
	{
		source: "host_safe_git_diff",
		// git diff output-format selection. Every allowed option is explicitly
		// enumerated and reviewed against the standard above. NO WILDCARDS.
		//
		// Review summary per option:
		//   --stat / --numstat / --shortstat
		//                          diff statistics; observational.
		//   --name-only / --name-status
		//                          affected-path lists; observational.
		//   --cached / --staged    diff against index instead of working tree;
		//                          read-only.
		//   --no-color             disable color output; visual only.
		//   --color=<word>         word in {always,auto,never}; visual only.
		//
		// Explicitly REJECTED (test fixtures below):
		//   --ext-diff             invokes external diff driver.
		//   --textconv             runs textconv filters (external programs).
		//   --output, --output=    writes to a file outside stdout.
		//   --no-index             compares arbitrary filesystem paths outside
		//                          the working tree; broader authority.
		//   any unknown --foo      not in the allow list; ASK.
		pattern:
			/^\s*git\s+diff(?:\s+(?:--stat|--numstat|--shortstat|--name-only|--name-status|--cached|--staged|--no-color|--color=(?:always|auto|never)))*\s*$/u,
	},
	{
		source: "host_safe_git_log",
		// git log output-format selection. Every allowed option is explicitly
		// enumerated and reviewed against the standard above. NO WILDCARDS.
		//
		// Review summary per option:
		//   -n <N>                 limit to N commits; N is a positive integer.
		//   --oneline              condensed format (composes --pretty=oneline
		//                          --abbrev-commit); observational.
		//   --stat                 include diffstat per commit; observational
		//                          (operates on already-converted content; does
		//                          not itself invoke external helpers).
		//   --no-color             disable color output; visual only.
		//   --pretty=<fmt>         fmt drawn from a finite reviewed set:
		//                            oneline, short, medium, full, fuller,
		//                            reference, email, raw, tformat.
		//                          Plus a curated set of format specifiers.
		//   -<N>                   short numeric form of -n <N>.
		//
		// Explicitly REJECTED (test fixtures below):
		//   --ext-diff             invokes external diff driver.
		//   --textconv             runs textconv filters (external programs).
		//   --output, --output=    writes to a file outside stdout.
		//   --pretty=<custom>      custom format strings (e.g. %H) — not in the
		//                          reviewed finite set; ASK. Users wanting
		//                          custom formats should explicitly authorize
		//                          via a YOLO/all-mode session.
		//   any unknown --foo      not in the allow list; ASK.
		pattern:
			/^\s*git\s+log(?:\s+(?:-n\s+\d+|--oneline|--stat|--no-color|--pretty=(?:oneline|short|medium|full|fuller|reference|email|raw|tformat)|--format=(?:oneline|short|medium|full|fuller|reference|email|raw|tformat)|-[0-9]+))*$/u,
	},
	{
		source: "host_safe_git_rev_parse",
		// git rev-parse: object-name / path resolver. Pure read-only.
		//   --abbrev-ref=<n>    shorten branch name to n chars; observational
		//   --short=<n>         shorten commit SHA to n chars
		//   --verify            verify a single object exists; observational
		//   --show-toplevel     print working tree root
		//   --show-prefix       print working subdir relative to root
		//   --git-dir           print .git directory
		//   --git-common-dir    print shared .git directory
		//   --is-inside-work-tree, --is-inside-git-dir, --is-bare-repository,
		//                       --is-shallow-repository: boolean checks
		//   --absolute-git-dir  print absolute path to .git
		//   -<n>                short numeric form of --short=<n>
		//
		// Explicitly REJECTED:
		//   --parseopt          interacts with command-parsing machinery
		//   --exec-path         writes/queries; not a pure resolver
		//   any unknown --foo   ASK
		pattern:
			/^\s*git\s+rev-parse(?:\s+(?:--abbrev-ref=\d+|--short(?:=\d+)?|--verify|--show-toplevel|--show-prefix|--git-dir|--git-common-dir|--is-inside-work-tree|--is-inside-git-dir|--is-bare-repository|--is-shallow-repository|--absolute-git-dir|-[0-9]+))*(?:\s+[A-Za-z0-9_./-]+)?$/u,
	},
	{
		source: "host_safe_git_show",
		// git show: object inspection. Same envelope as git diff for
		// external-helper avoidance. We explicitly enumerate the
		// safe options; --ext-diff/--textconv/--output are still
		// rejected by the same review standard as the diff rule.
		//
		//   HEAD, refs, SHAs    object selector (whitespace-stable)
		//   --stat              diffstat per commit
		//   --name-only         list changed paths
		//   --name-status       list changed paths with status
		//   --no-color, --color=<a|n>   visual only
		//   --no-ext-diff       disable external diff driver
		//   --no-textconv       disable textconv filters
		//   --pretty=<reviewed> same finite set as git log
		//   --format=<reviewed> same finite set as git log
		//
		// Explicitly REJECTED (same review standard):
		//   --ext-diff          invokes external diff driver
		//   --textconv          runs textconv filters (external programs)
		//   --output, --output= writes to a file outside stdout
		//   --no-index          compares arbitrary filesystem paths outside
		//                       the working tree; broader authority
		//   any unknown --foo   ASK
		pattern:
			/^\s*git\s+show(?:\s+(?:--stat|--name-only|--name-status|--no-color|--color=(?:always|auto|never)|--no-ext-diff|--no-textconv|--pretty=(?:oneline|short|medium|full|fuller|reference|email|raw|tformat)|--format=(?:oneline|short|medium|full|fuller|reference|email|raw|tformat)|[A-Za-z0-9_./-]+))*$/u,
	},
	{
		source: "host_safe_git_rev_list",
		// git rev-list: object-listing. Pure read-only, no external
		// helper invocation.
		//
		//   HEAD, refs, SHAs     object selector
		//   --max-count=<n>      limit to n commits
		//   -n <n>               short form of --max-count
		//   --count              print the number of commits
		//   --no-color, --color=<a|n>   visual only
		//
		// Explicitly REJECTED:
		//   --stdin              reads from stdin (variable input)
		//   --all                all refs (broader scope; per-host policy)
		//   --since/--until/--after/--before  date filtering
		//                       (these are observational but multiply
		//                       the matching surface; V2 may revisit)
		//   any unknown --foo    ASK
		pattern:
			/^\s*git\s+rev-list(?:\s+(?:--max-count=\d+|-n\s+\d+|--count|--no-color|--color=(?:always|auto|never)))*(?:\s+[A-Za-z0-9_./-]+)?$/u,
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
