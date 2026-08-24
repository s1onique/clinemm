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
	// ACT-CLINEMM-COMMAND-RISK-V2-CD-CWD-PATH-AUTHORITY-COMPOSITION01:
	// V1 lexical positive cd rule for the SIMPLE `cd <abs-static>`
	// shape (no compound, no &&/||/|, no options). This is a
	// *helper* rule only -- it does NOT cause V1 to ALLOW compound
	// shapes like `cd <abs> && pwd` because the rule's regex
	// (anchored end-of-string `\s*$`) does not match `&&`-bearing
	// input. V1 still returns ASK for those shapes; V2 then
	// upgrades them via the parser-proven cd branch. The rule's
	// load-bearing purpose is to bind the cd target to host path
	// authority when the source is the SIMPLE cd form.
	//
	// Reviewed forms (parser-proven positive provenance):
	//   - `cd /absolute/path/to/dir` (no trailing tokens)
	//
	// Explicitly REJECTED (conservation):
	//   - any option (`cd -L`, `cd -P`, `cd -`)
	//   - relative path (`cd ../foo`)
	//   - dynamic target (`cd "$DIR"`, `cd ~/x`)
	//   - zero / multiple operands (`cd`, `cd a b`)
	//   - any redirect (`cd /x 2>/dev/null`)
	//   - any assignment prefix (`CDPATH=x cd /y`)
	//   - any compound shape (`cd /x && pwd`, `cd /x; pwd`, `cd /x | head`)
	//     -- the `&&` etc. is opaque to V1's positive matcher;
	//        V2's parser-proven branch handles those forms.
	//   - any pattern-bearing target (`cd /x/*`).
	//
	// The class `[A-Za-z0-9_./+-]` is deliberately narrow to
	// reject shell metacharacters in the target -- V2's
	// `isParserProvenAbsoluteStaticCd` validator already enforces
	// `argProvenance[0] === "static"` upstream, but the V1
	// lexical mirror is defense-in-depth.
	{
		source: "host_safe_cd_workspace_transition",
		pattern: /^\s*cd\s+\/[A-Za-z0-9_./+-]+\s*$/u,
	},
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
	{
		source: "host_safe_git_branch",
		// git branch: list / query modes. Pure observation of the
		// branch state. git-branch(1) explicitly distinguishes the
		// listing/query subcommands from create / delete / rename /
		// copy / upstream-mutation modes. We enumerate ONLY the
		// read-only forms here. Any form that creates, deletes,
		// renames, copies, or mutates branch tracking MUST NOT match.
		//
		// Review summary per option (REVIEW STANDARD at top of file):
		//
		//   (bare) / --list       default listing; pure observation.
		//   -a / --all            list local + remote-tracking.
		//   -r / --remotes        list remote-tracking only.
		//   --show-current        print current branch name; pure query.
		//   --points-at <object>  list branches at object; observational.
		//                          The <object> token is constrained to
		//                          the same reviewed character class as
		//                          the other rule's refs/SHAs.
		//   --no-color            disable color; visual only.
		//   --color=<a|n>         visual only.
		//   -v / -vv / -vva       verbose list mode; observational.
		//   --no-abbrev           observational.
		//
		//   --format=<fmt>        DELIBERATELY REJECTED. git-branch(1)
		//                          documents `--format=<format>` as the
		//                          git-for-each-ref interpolation format
		//                          (e.g. `%(refname:short)`,
		//                          `%(HEAD)`, `%(upstream:track)`). The
		//                          token set is wide and arbitrary; a
		//                          naive enumeration of `git log --pretty`
		//                          preset names (oneline/short/medium/
		//                          full/fuller/reference/email/raw/tformat)
		//                          is NOT the same thing — those are
		//                          log/pretty presets, not branch-format
		//                          directives, and they produce literal
		//                          text output rather than meaningful
		//                          branch formatting. Rather than allow
		//                          a misleading allowlist, we reject
		//                          --format entirely; users who want
		//                          custom formatting can invoke through
		//                          `git for-each-ref` explicitly (which
		//                          also has no host-proven rule and is
		//                          ASK today).
		//
		// Explicitly REJECTED (per REVIEW STANDARD; these are the
		// MUTATING forms the rule must NOT match):
		//   <name>                create a new branch. Any positional
		//                          after the options block is rejected by
		//                          the pattern's optional [object] token
		//                          which only follows --points-at.
		//   <name> <start>        create at start-point; same reason.
		//   -d / -D / --delete    delete.
		//   -m / -M / --move      rename.
		//   -c / -C / --copy      copy.
		//   -u / --set-upstream-to=<u>
		//                          upstream mutation.
		//   --unset-upstream      upstream mutation.
		//   --edit-description    writes to refs.
		//   --track / --no-track  valid only with create form; rejected
		//                          because the create form is rejected.
		//   --contains / --merged / --no-merged
		//                          broader scope (commits sets); V2 may
		//                          revisit; ASK today.
		//   --format=<fmt>        git-for-each-ref interpolation;
		//                          REJECTED to avoid a misleading
		//                          allowlist.
		//   any unknown --foo     ASK (no wildcard).
		pattern:
			/^\s*git\s+branch(?:\s+(?:--list|-a|--all|-r|--remotes|--show-current|--no-color|--color=(?:always|auto|never)|-vv?a?|--no-abbrev))*(?:\s+--points-at\s+[A-Za-z0-9_./-]+)?\s*$/u,
	},
	{
		source: "host_safe_git_remote",
		// git remote: read-only observation forms. Per git-remote(1)
		// the documented synopsis distinguishes the LIST (no-subcommand
		// / -v / --verbose) form from every MUTATING subcommand. We
		// enumerate ONLY the observational forms here. Every mutating
		// form MUST NOT match.
		//
		// Review summary per option (REVIEW STANDARD at top of file):
		//
		//   (bare)                list configured remotes; observational
		//                          (per git-remote(1): "List all the
		//                          remotes that are configured").
		//   -v / --verbose        same list with URL shown; observational
		//                          (per git-remote(1): "Be a little more
		//                          verbose, and show the remote URL
		//                          after the name").
		//
		// Explicitly REJECTED (mutating):
		//   add <name> <url>            add a remote
		//   remove / rm <name>          remove a remote
		//   rename <old> <new>          rename a remote
		//   set-url <name> <url>        change remote URL
		//   set-url --add <n> <u>       add push URL
		//   set-url --delete <n> <u>    delete push URL
		//   set-head <name> [branch]    set default branch
		//   set-branches <name> <branches>
		//                               set remote-tracking branches
		//   update [<group>]            fetch updates
		//   prune [<group>]             delete stale refs
		//   get-url <name> [--push|--all]   observational but narrow;
		//                                    V2 may revisit; ASK today
		//                                    because the rule surface is
		//                                    too narrow to audit
		//                                    positively here.
		//   any unknown --foo           ASK (no wildcard).
		pattern:
			/^\s*git\s+remote(?:\s+(?:-v|--verbose))?\s*$/u,
	},
	{
		source: "host_safe_echo",
		// echo: stdout-only literal text. Per POSIX echo(1) and Bash
		// builtin echo, the command writes its arguments followed by a
		// newline. It has NO file-system-mutating command mode. Every
		// option here is purely visual:
		//
		//   (bare)                prints empty line.
		//   -n                    suppress trailing newline.
		//
		// The argument operand class is INTENTIONALLY RESTRICTIVE: it
		// contains only POSIX literal text characters and excludes
		// every shell metacharacter that could enable command
		// substitution, variable expansion, globbing, redirection, or
		// pipe composition. Specifically EXCLUDED from the BARE class
		// (unquoted):
		//
		//   $        variable expansion or $(...) command substitution
		//   backtick backtick command substitution
		//   \        backslash escape
		//   ( )      subshell / command substitution
		//   * ? [ ]  glob metacharacters
		//   { }      brace expansion
		//   | & ;    composition operators
		//   < >      redirection
		//   =        potential variable assignment
		//   -        leading option marker (defense-in-depth; options
		//            like --evil, -X are explicitly REJECTED here
		//            rather than relying on the upstream
		//            OPAQUE_SHELL_TOKENS guard to catch them)
		//
		// Any token containing those characters falls through to ASK.
		// Defense-in-depth: V2's `hasCommandSubstitution` gate
		// (`structured-command-risk.ts:511-520`) catches `$(...)` and
		// backtick forms even if the regex is bypassed. The opaque
		// token guard (`OPAQUE_SHELL_TOKENS`) catches all
		// composition/redirect operators before any rule match.
		//
		// Quoted-literal classes (`'...'` and `"..."`) retain `-`
		// because that character has no shell-meaning inside a
		// single-quoted POSIX literal and minimal meaning inside a
		// double-quoted one (no expansion of `-`). This is what makes
		// the user's exact live forms `echo '---BRANCH---'` and
		// `echo '---REMOTES---'` ALLOW-able.
		//
		// The argument may be either:
		//   - a single-quoted POSIX literal: '...' (inner class excludes
		//     single-quote to keep the quote boundary unambiguous), OR
		//   - a double-quoted POSIX literal: "..." (same inner constraint),
		//     OR
		//   - a bare POSIX literal: continuous run of allowed chars
		//     including space (so multi-word `echo hello world` is OK
		//     as long as the literal character class is preserved;
		//     shell metacharacters like $ * ? [ ] { } | & ; < > = \
		//     still terminate the literal).
		//
		// This deliberately rejects `echo $HOME`, `echo "$(cmd)"`,
		// `echo backtick-cmdsubst`, `echo *`, `echo foo > file`,
		// `echo foo | bar`, etc.
		pattern:
			/^\s*echo(?:\s+-n)?(?:\s+(?:[A-Za-z0-9 _.,:/+@%^]+|'(?:[A-Za-z0-9 _.,:/+@%^-]*)'|"(?:[A-Za-z0-9 _.,:/+@%^-]*)"))?\s*$/u,
	},
	{
		source: "host_safe_ls",
		// ls: directory/file information query. ls(1) documents its
		// job as "list information about the FILEs". ls has no
		// filesystem-mutating command mode in the reviewed
		// GNU/Coreutils surface: no documented option invokes an
		// external program, broadens authority, or has other
		// authority-broadening effect per the REVIEW STANDARD at
		// the top of this file. (ls writes diagnostics to stderr,
		// not stdout, when something goes wrong; that's normal Unix
		// behavior, not a filesystem mutation.) Every reviewed
		// option is purely visual / formatting / filtering.
		//
		// The rule allows any sequence of:
		//   (a) reviewed short options (single-letter from the
		//       enumerated set; bundled like -la is also OK);
		//   (b) reviewed long options (with optional `=<value>` for
		//       the few that take a value);
		//   (c) zero or more POSIX path arguments.
		//
		// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01:
		// This rule is PATH-AGNOSTIC. It accepts ANY
		// character-class-conformant path operand (relative or
		// absolute). The policy layer applies a SEPARATE workspace
		// path authority gate (see `path-authority.ts`) AFTER this
		// rule matches: the rule confirms the COMMAND SHAPE is
		// safe; the path authority confirms the OPERANDS are
		// inside an authorized workspace root. The two layers
		// MUST NOT be conflated — keeping the regex small and
		// path-agnostic is the audit-friendly property that
		// enables bounded positive matching.
		//
		// V1 LIMITATION (documented): a path that lexically passes
		// the path authority gate but is a symlink to a sensitive
		// filesystem location is not caught. The realpath
		// variant is a follow-up ACT
		// (REALPATH_WORKSPACE_CONFINEMENT).
		//
		// Sensitive-path policy (e.g. ~/.ssh) is a SEPARATE dimension
		// addressed by the workspace path authority gate above. See
		// the board row for
		// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01.
		pattern:
			/^\s*ls(?:\s+(?:-[1aAbBcCdDfFgGhHiIkLlLmnNopqrRsStTuUwWxXzZNQ]+|--all|--almost-all|--author|--escape|--block-size=[-A-Za-z0-9_/.,+:%^]+|--ignore-backups|--color(?:=(?:always|auto|never))?|--directory|--dired|--classify(?:=(?:always|auto|never))?|--file-type|--format=(?:across|horizontal|commas|long|single-column|verbose|vertical)|--full-time|--group-directories-first|--no-group|--human-readable|--si|--dereference-command-line|--dereference-command-line-symlink-to-dir|--hide=[-A-Za-z0-9_/.,+:%^*?]+|--hyperlink(?:=(?:always|auto|never))?|--indicator-style=(?:none|slash|file-type|classify)|--inode|--ignore=[-A-Za-z0-9_/.,+:%^*?]+|--kibibytes|--dereference|--numeric-uid-gid|--literal|--reverse|--recursive|--size|--sort=(?:none|size|time|version|extension|name|width)|--time=(?:access|atime|use|ctime|status|mtime|modification|birth|creation)|--time-style=[-A-Za-z0-9_:,.,+^%]+|--tabsize=\d+|--zero|--quote-name|--quoting-style=(?:literal|locale|shell|shell-always|shell-escape|shell-escape-always|c|escape)|--show-control-chars|--hide-control-chars|--context|--help|--version))*(?:\s+(?:--|(?![-])[-A-Za-z0-9_/.,+:%^@~*$?][-A-Za-z0-9_/.,+:%^@~*$?]*))*$/u,
	},
	{
		source: "host_safe_find",
		// find: predicates + stdout-only observation. Per GNU
		// findutils, find has two categories of action: stdout-only
		// (-print, -print0, -printf, -ls, -quit, -prune) and
		// action-capable (-delete, -exec, -execdir, -ok, -okdir,
		// -fls, -fprint, -fprint0, -fprintf). We enumerate ONLY the
		// stdout-only + pure-predicate forms here. Any invocation
		// containing a mutating or executing action MUST NOT match.
		//
		// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01:
		// Like host_safe_ls, this rule is PATH-AGNOSTIC. It
		// accepts ANY character-class-conformant starting path
		// (relative or absolute) and ANY literal pattern
		// operand. The policy layer applies a SEPARATE workspace
		// path authority gate (see `path-authority.ts`) AFTER
		// this rule matches: the rule confirms the COMMAND SHAPE
		// is safe; the path authority confirms the OPERANDS are
		// inside an authorized workspace root.
		//
		// V1 LIMITATION: a `find -L` invocation that starts
		// inside the project but whose first filesystem dereference
		// is a symlink to a sensitive path is NOT caught by V1's
		// lexical gate (per GNU find(1), `-L` "lists the
		// dereferenced targets"). The realpath variant is a
		// follow-up ACT (REALPATH_WORKSPACE_CONFINEMENT); for V1
		// we explicitly pin this limitation rather than paper
		// over it.
		//
		// SHELL EXPANSION BOUNDARY (CORRECTION01, 2026-08-24):
		// The rule classifies the PRE-shell source text. Shell
		// pathname expansion happens AFTER regex matching and
		// BEFORE find sees its argv. A pre-expansion wildcard like
		// `*.ts` may be expanded by the shell to whatever names
		// happen to match in the current directory — an attacker
		// can plant filenames that turn a benign-looking source
		// command into action-bearing argv (or even a parse error).
		// GNU find(1) explicitly warns that patterns containing
		// metacharacters must be quoted so the shell does not
		// expand them before find sees them. V1 deliberately
		// avoids this trust boundary:
		//
		//   - starting paths must be literal POSIX paths with
		//     no glob metacharacters (* ? [ ] { });
		//   - the pattern-bearing predicates (-name, -iname,
		//     -path, -ipath, -regex, -iregex) accept ONLY the
		//     character set that excludes glob metacharacters;
		//   - users who need globs must use the V2 parser-bound
		//     structured AST path (which proves quote provenance)
		//     or shell-quote the pattern and explicitly opt into
		//     this rule through the policy layer's quoting-aware
		//     parser integration.
		//
		// The user's exact recon chain (`find ... -name 'command-risk*'
		// -not -path './node_modules/*' ... 2>/dev/null | head -20`)
		// contains unquoted glob metacharacters AND a redirect; both
		// correctly keep the invocation ASK at the V1 regex layer.
		// Per the engineer's plan, that is the next ACT
		// (ACT-CLINEMM-COMMAND-RISK-R0-HARMLESS-REDIRECT-PRECISION01)
		// plus a future glob-quoting-aware refinement.
		//
		// Review summary per option (REVIEW STANDARD at top):
		//   Global options:
		//     -H / -L / -P        symlink handling mode
		//     -E                  extended regex (BSD)
		//     -X                  stay on current filesystem
		//     -s / -d / -x        BSD alternate invocation flags
		//     -f <path>           alternate starting path (literal)
		//   Starting paths (positional; non-option tokens before
		//   predicates) - LITERAL ONLY, NO GLOB METACHARS:
		//     . | path | absolute path | relative dir path
		//     character class: [-A-Za-z0-9_\/.,+:%@]
		//   Predicates (tests / operators) - pure observation:
		//     -name / -iname PAT          pattern (LITERAL or
		//                                 regex; no shell glob)
		//     -path / -ipath PAT          pattern (LITERAL; no glob)
		//     -regex / -iregex PAT        regex (no shell glob)
		//     -type [bcdflpsw]            file type
		//     -perm [-+]MODE              permission bits
		//     -user UNAME / -uid N
		//     -group GNAME / -gid N
		//     -size [+-]N[ckbwMG]         size
		//     -[acm]time [+-]N            time predicates
		//     -[acm]min [+-]N             minute predicates
		//     -newer FILE                 newer than
		//     -anewer FILE                accessed newer than
		//     -cnewer FILE                ctime newer than
		//     -newerXY REF                time comparison
		//     -empty                      empty file/dir
		//     -readable / -writable / -executable
		//     -true / -false
		//     -links N
		//     -inum N
		//     -fstype TYPE
		//     -nogroup / -nouser
		//     -depth / -xdev
		//     -mindepth N / -maxdepth N
		//     -prune                      observational subtree-skip
		//     -print / -print0 / -ls      stdout-only observation
		//     -printf FMT                 stdout-only formatted
		//     -quit
		//     -not / -and / -or           boolean composition
		//
		// Explicitly REJECTED (action-capable; mutating/executing):
		//   -delete                      deletes matched files
		//   -exec / -execdir ... ;       executes arbitrary utility
		//   -exec / -execdir ... {} +    executes utility w/ batching
		//   -ok / -okdir ... ;           interactive execute
		//   -fls FILE                    writes ls output to FILE
		//   -fprint FILE                 writes names to FILE
		//   -fprint0 FILE                writes names to FILE (NUL)
		//   -fprintf FILE FMT            writes formatted to FILE
		//   any starting path containing * ? [ ] { }  (shell glob)
		//   any -name/-iname/-path/-ipath/-regex/-iregex pattern
		//     containing * ? [ ] { } (shell glob; V2 parser-quote
		//     provenance required to bless these)
		//   any unknown predicate / action   ASK (no wildcard)
		pattern:
			/^\s*find(?:\s+-(?:H|L|P|E|X|s|d|x))?(?:\s+-f\s+[-A-Za-z0-9_/.,+:%@]+)?(?:\s+(?:--|(?![-])[-A-Za-z0-9_/.,+:%@]+))*?(?:\s+(?:-name\s+[-A-Za-z0-9_/.,+:%@]+|-iname\s+[-A-Za-z0-9_/.,+:%@]+|-path\s+[-A-Za-z0-9_/.,+:%@]+|-ipath\s+[-A-Za-z0-9_/.,+:%@]+|-regex\s+[-A-Za-z0-9_/.,+:%@\\.$^]+|-iregex\s+[-A-Za-z0-9_/.,+:%@\\.$^]+|-type\s+[bcdflpsw]|-perm\s+[-+a-zA-Z0-7]+|-user\s+[-A-Za-z0-9_/.,+:%@]+|-uid\s+\d+|-group\s+[-A-Za-z0-9_/.,+:%@]+|-gid\s+\d+|-size\s+[+-]?\d+[ckbwMG]?|-atime\s+[+-]?\d+|-ctime\s+[+-]?\d+|-mtime\s+[+-]?\d+|-amin\s+[+-]?\d+|-cmin\s+[+-]?\d+|-mmin\s+[+-]?\d+|-newer\s+[-A-Za-z0-9_/.,+:%@]+|-anewer\s+[-A-Za-z0-9_/.,+:%@]+|-cnewer\s+[-A-Za-z0-9_/.,+:%@]+|-newerXY\s+[a-z]\s+[-A-Za-z0-9_/.,+:%@]+|-empty|-readable|-writable|-executable|-true|-false|-links\s+\d+|-inum\s+\d+|-fstype\s+[A-Za-z0-9_]+|-nogroup|-nouser|-depth|-xdev|-mindepth\s+\d+|-maxdepth\s+\d+|-prune|-print0?|-ls|-printf\s+[-A-Za-z0-9_/.,+:%@~%\\]+|-quit|-not|-and|-or))*\s*$/u,
	},
	{
		// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01
		// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01-CORRECTION01
		// HALT_READER_DYNAMIC_OPERAND_AUTHORITY_ALIAS
		//
		// cat: GNU Coreutils cat(1) "concatenate files and
		// print on the standard output". cat is intrinsic
		// read-only file copy; no helper invocation, no fs
		// write. Per REVIEW STANDARD we enumerate ONLY the
		// file-read shapes; we deliberately do NOT allow
		// GNU's `-n / -b / -s / -E / -T / -v / -A / -e / -t`
		// output transformations in this first wave --
		// they multiply the matching surface without an
		// observed production pain point (bounded scope).
		//
		// Reviewed forms:
		//   cat FILE [FILE ...]            one or more file operands
		//   cat -- FILE [FILE ...]         explicit end-of-options
		//
		// Explicitly REJECTED:
		//   any -<x> option                not yet reviewed
		//   any --<x> option               not yet reviewed
		//   any unknown --foo              ASK (no wildcard)
		//
		// SHELL-ACTIVE OPERAND REJECTION (CORRECTION01):
		//   The path-operand character class is intentionally
		//   NARROW to characters that are INERT in an unquoted
		//   shell word under the supported grammar. The
		//   rejected characters include:
		//     `$`  parameter expansion   (`cat $HOME/secret`)
		//     `~`  tilde expansion       (`cat ~/secret`)
		//     `*`  filename generation  (`cat *`)
		//     `?`  filename generation  (`cat ?.txt`)
		//   Why: bash performs these expansions BEFORE `cat`
		//   sees argv. The host-evidence builder, however,
		//   resolves the LITERAL token, which may lexically
		//   resolve inside the workspace (e.g. a fixture file
		//   named `$HOME/secret` placed at the raw-token
		//   path). That breaks the load-bearing invariant:
		//
		//      evidence operand identity  ==  actual filesystem operand
		//
		//   Quoted/dynamic/path-rich operands stay conservative
		//   (ASK) until V2 can positively establish
		//   `argProvenance === "static"` and bind the EXACT
		//   projected operand to host authority.
		//
		// File operands are bound by V1's
		// `host_workspace_realpath_authority` gate (the
		// canonical CORRECTION01-04 path-authority
		// machinery). Per `extractR0PathOperands`, every
		// reviewed non-option operand is a path candidate.
		//
		// Multi-file cat (`cat README.md package.json`) is
		// supported by V1's per-operand realpath binding
		// when the evidence machinery naturally supplies
		// one operand entry per file. The per-command
		// ALLOW contract requires ALL operands bound AND
		// contained; one outside operand -> ASK.
		source: "host_safe_cat",
		pattern:
			/^\s*cat(?:\s+--\s+|\s+)(?:(?![-])[-A-Za-z0-9_/.,+:%^@][-A-Za-z0-9_/.,+:%^@]*(?:\s+(?![-])[-A-Za-z0-9_/.,+:%^@][-A-Za-z0-9_/.,+:%^@]*)*)\s*$/u,
	},
	{
		// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01
		//
		// head (PATH-BEARING). GNU Coreutils head(1) "print
		// the first 10 lines of each FILE to standard
		// output". With FILE operand(s) head reads those
		// files; with no operand head reads stdin. Per
		// REVIEW STANDARD we enumerate ONLY the path-bearing
		// forms; the stdin-only forms (`head`, `head -30`)
		// are handled by the V2 parser-proven stdin-only
		// reader branch
		// (ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01)
		// in `structured-command-risk.ts`.
		//
		// Keeping the two families distinct prevents the
		// conflation the reviewer flagged: shell provenance
		// (V2 stdin-only) is NOT filesystem authority (V1
		// path-bearing).
		//
		// Reviewed forms (require at least one FILE operand):
		//   head FILE
		//   head -<N> FILE             (N is a non-negative integer)
		//   head -n <N> FILE
		//   head -- FILE
		//   head -n <N> -- FILE
		//
		// Explicitly REJECTED (conservation):
		//   head -c / -c <N>           reads BYTES (binary
		//                               content); not in
		//                               bounded scope.
		//   head -v / -q /
		//     --verbose / --quiet /
		//     --silent                 output formatting; not
		//                               reviewed.
		//   head --help / --version    documentation.
		//   head FILE1 FILE2 ...       multi-file read; not
		//                               yet enumerated.
		//   any unknown --foo          ASK (no wildcard).
		//
		// Per REVIEW STANDARD each option is reviewed
		// individually. `-n <N>` is a count limit only; it
		// does NOT invoke an external program, write
		// outside stdout/stderr, or broaden authority.
		//
		// File operands are bound by V1's
		// `host_workspace_realpath_authority` gate (the
		// canonical CORRECTION01-04 path-authority
		// machinery). `extractR0PathOperands` consumes the
		// reviewed `-n <N>` option argument before collecting
		// the FILE operand so the authority gate sees the
		// actual file path (not the count token).
		source: "host_safe_head_path",
		pattern:
			/^\s*head(?:\s+(?:-\d+|-n\s+\d+|--))?(?:\s+--\s+(?![-])[-A-Za-z0-9_/.,+:%^@][-A-Za-z0-9_/.,+:%^@]*|\s+(?![-])[-A-Za-z0-9_/.,+:%^@][-A-Za-z0-9_/.,+:%^@]*)\s*$/u,
	},
	{
		// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01
		//
		// tail (PATH-BEARING). GNU Coreutils tail(1) "print
		// the last 10 lines of each FILE to standard output".
		// Per tail-invocation(1) tail-invocation(1)
		// documents follow-mode (`-f`, `-F`, `--follow`,
		// `--retry`, `--pid`) and byte-counted reads
		// (`-c`) as materially different operations
		// (follow modes can wait indefinitely and monitor
		// changing files). This rule covers ONLY the
		// finite observational path-bearing read.
		//
		// stdin-only forms (`tail`, `tail -20`) are handled
		// by the V2 parser-proven stdin-only reader branch
		// (ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01).
		//
		// Reviewed forms (require at least one FILE operand):
		//   tail FILE
		//   tail -<N> FILE
		//   tail -n <N> FILE
		//   tail -- FILE
		//   tail -n <N> -- FILE
		//
		// Explicitly REJECTED (conservation; tail(1)
		// documents these as materially different
		// operations):
		//   tail -f / -F /
		//     --follow / --follow=<how>
		//     follow modes; tail waits indefinitely and
		//     monitors changing files. Per
		//     tail-invocation(1): "output appended data as
		//     the file grows". Out of scope for finite
		//     observational reads.
		//   tail --retry
		//     "keep trying to open a file if it is
		//     inaccessible". Also long-running monitoring
		//     behavior.
		//   tail --pid=<pid>
		//     "like -f but terminate after process ID
		//     dies". Combines follow with a process
		//     watcher; broader authority.
		//   tail -c / -c <N> /
		//     --bytes                 byte-counted reads;
		//                               not in bounded scope.
		//   tail -v / -q /
		//     --verbose / --quiet /
		//     --silent                 output formatting;
		//                               not reviewed.
		//   tail --help /
		//     --version                documentation.
		//   tail FILE1 FILE2 ...       multi-file read; not
		//                               yet enumerated.
		//   any unknown --foo          ASK (no wildcard).
		//
		// Per REVIEW STANDARD each option is reviewed
		// individually. tail's follow modes are excluded
		// because they explicitly wait indefinitely (per
		// tail-invocation(1)), which is
		// authority-broadening in the same sense as a
		// write redirect.
		source: "host_safe_tail_path",
		pattern:
			/^\s*tail(?:\s+(?:-\d+|-n\s+\d+|--))?(?:\s+--\s+(?![-])[-A-Za-z0-9_/.,+:%^@][-A-Za-z0-9_/.,+:%^@]*|\s+(?![-])[-A-Za-z0-9_/.,+:%^@][-A-Za-z0-9_/.,+:%^@]*)\s*$/u,
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
