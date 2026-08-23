/**
 * Frozen Adversarial Command-Risk Corpus
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01
 *
 * Shared by:
 *   - command-risk-corpus.baseline.test.ts   (Group A: today-behaviour freeze)
 *   - command-risk-corpus.v1-contract.test.ts (Group B: V1 API contract)
 *
 * The case list and `requiredDecision`/`requiredDisposition` values
 * are a FROZEN CONTRACT. Any change must be a deliberate commit
 * accompanied by a note in the ACT.
 */

export type CorpusFamily =
	| "R0-readonly"
	| "R1-bounded-build"
	| "R2-bounded-write"
	| "R3-state-mutation"
	| "R4-destructive"
	| "R5-catastrophic"
	| "R5b-sensitive-read"
	| "wrapper-bypass"
	| "compound-aggregation";

export type CorpusDecision = "allow" | "ask" | "deny";
export type CorpusDisposition =
	| "auto-approve-eligible"
	| "ask"
	| "never-auto-approve";

export interface CorpusCase {
	id: string;
	family: CorpusFamily;
	command: string;
	requiredDecision: CorpusDecision;
	requiredDisposition: CorpusDisposition;
	notes: string;
}

export const CORPUS: ReadonlyArray<CorpusCase> = [
	// -------------------- R0 — read-only / observational --------------------
	{
		id: "r0-pwd",
		family: "R0-readonly",
		command: "pwd",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "intrinsic read-only",
	},
	{
		id: "r0-pwd-L",
		family: "R0-readonly",
		command: "pwd -L",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "POSIX logical working dir",
	},
	{
		id: "r0-pwd-P",
		family: "R0-readonly",
		command: "pwd -P",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "POSIX physical working dir",
	},
	{
		id: "r0-git-status",
		family: "R0-readonly",
		command: "git status",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "porcelain; already covered today",
	},
	{
		id: "r0-git-status-short-branch",
		family: "R0-readonly",
		command: "git status --short --branch",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "porcelain",
	},
	{
		id: "r0-git-diff",
		family: "R0-readonly",
		command: "git diff",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "already covered today",
	},
	{
		id: "r0-git-diff-stat",
		family: "R0-readonly",
		command: "git diff --stat",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "already covered today",
	},
	{
		id: "r0-git-log",
		family: "R0-readonly",
		command: "git log",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "already covered today",
	},
	{
		id: "r0-git-log-oneline",
		family: "R0-readonly",
		command: "git log --oneline",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "already covered today",
	},
	{
		id: "r0-git-rev-parse",
		family: "R0-readonly",
		command: "git rev-parse HEAD",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "pure object name resolver",
	},
	{
		id: "r0-git-show",
		family: "R0-readonly",
		command: "git show --stat HEAD",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "observational; same envelope as git diff",
	},
	{
		id: "r0-git-rev-list",
		family: "R0-readonly",
		command: "git rev-list --max-count=5 HEAD",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "object listing",
	},
	{
		id: "r0-git-branch-show-current",
		family: "R0-readonly",
		command: "git branch --show-current",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "pure query; prints current branch name",
	},
	{
		id: "r0-git-branch-list",
		family: "R0-readonly",
		command: "git branch",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "default listing mode; observational",
	},
	{
		id: "r0-git-branch-all",
		family: "R0-readonly",
		command: "git branch -a",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "list local + remote-tracking; observational",
	},
	{
		id: "r0-git-branch-remotes",
		family: "R0-readonly",
		command: "git branch -r",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "list remote-tracking only; observational",
	},
	{
		id: "r0-ls-bare",
		family: "R0-readonly",
		command: "ls",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "bare ls; observational directory listing",
	},
	{
		id: "r0-ls-long",
		family: "R0-readonly",
		command: "ls -la /tmp",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "ls with long-format + path; observational",
	},
	{
		id: "r0-ls-somepath",
		family: "R0-readonly",
		command: "ls /etc",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "ls of a specific path; observational",
	},
	{
		id: "r0-find-bare",
		family: "R0-readonly",
		command: "find .",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "bare find; default -print to stdout; observational",
	},
	{
		id: "r0-find-type-name",
		family: "R0-readonly",
		command: "find . -type f -name *.ts",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "find with predicates only; stdout-only",
	},
	{
		id: "r0-find-not-path",
		family: "R0-readonly",
		command: "find . -type d -name command-risk* -not -path ./node_modules/*",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "find with predicates and -not; observational",
	},

	// -------------------- R1 — bounded build / test --------------------
	// V1 keeps the rule engine bounded — adding "all `bun test` is safe"
	// would be the same anti-pattern that was explicitly rejected for
	// `git`. They are ASK in V1; V2 may consider bounded per-tool rules.
	{
		id: "r1-bun-test",
		family: "R1-bounded-build",
		command: "bun test",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "V2 candidate; V1 must ASK",
	},

	// -------------------- R2 — bounded workspace mutation --------------------
	{
		id: "r2-mkdir-build",
		family: "R2-bounded-write",
		command: "mkdir -p ./build/foo",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "writes under workspace but not host-proven bounded",
	},

	// -------------------- R3 — repository / state mutation --------------------
	{
		id: "r3-git-add",
		family: "R3-state-mutation",
		command: "git add path/to/file",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "state mutation",
	},
	{
		id: "r3-git-commit",
		family: "R3-state-mutation",
		command: "git commit -m msg",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "state mutation",
	},

	// -------------------- R4 — destructive --------------------
	{
		id: "r4-rm-rf-build",
		family: "R4-destructive",
		command: "rm -rf build",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "destructive but not a known catastrophic shape",
	},
	{
		id: "r4-git-clean-fd",
		family: "R4-destructive",
		command: "git clean -fd",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "removes untracked",
	},
	{
		id: "r4-git-clean-fdx",
		family: "R4-destructive",
		command: "git clean -fdx",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "removes untracked + ignored",
	},
	{
		id: "r4-git-reset-hard",
		family: "R4-destructive",
		command: "git reset --hard",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "destructive",
	},
	{
		id: "r4-git-restore-dot",
		family: "R4-destructive",
		command: "git restore .",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "destructive",
	},
	{
		id: "r4-find-delete",
		family: "R4-destructive",
		command: "find . -delete",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "broad find-delete",
	},

	// -------------------- R5 — catastrophic (HARD FLOOR) --------------------
	{
		id: "r5-rm-rf-home",
		family: "R5-catastrophic",
		command: 'rm -rf "$HOME"',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "deletes operator home",
	},
	{
		id: "r5-rm-rf-tilde",
		family: "R5-catastrophic",
		command: "rm -rf ~",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "tilde expands to home",
	},
	{
		id: "r5-rm-rf-home-docs",
		family: "R5-catastrophic",
		command: 'rm -rf "$HOME"/Documents',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "deletes under home",
	},
	{
		id: "r5-rm-rf-home-keyword",
		family: "R5-catastrophic",
		command: "rm -rf ~/Documents",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "tilde + path",
	},
	{
		id: "r5-find-home-delete",
		family: "R5-catastrophic",
		command: 'find "$HOME" -delete',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "find -delete under home",
	},
	{
		id: "r5-rm-rf-root",
		family: "R5-catastrophic",
		command: "rm -rf /",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "filesystem root",
	},
	{
		id: "r5-rm-rf-volumes",
		family: "R5-catastrophic",
		command: "rm -rf /Volumes/Backup",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "external mount",
	},
	{
		id: "r5-rm-rf-dotdot",
		family: "R5-catastrophic",
		command: "rm -rf ..",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "workspace parent",
	},
	{
		id: "r5-rm-rf-dotdotdot",
		family: "R5-catastrophic",
		command: "rm -rf ../..",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "two levels up",
	},
	{
		id: "r5-ssh-authorized",
		family: "R5b-sensitive-read",
		command: "cat ~/.ssh/authorized_keys > /tmp/keys",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "reads sensitive home file (leak, not destruction; ASK with reason)",
	},
	{
		id: "r5-ssh-rm",
		family: "R5-catastrophic",
		command: "rm -rf ~/.ssh",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "deletes SSH keys",
	},
	{
		id: "r5-gnupg-rm",
		family: "R5-catastrophic",
		command: "rm -rf ~/.gnupg",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "deletes GPG keys",
	},

	// -------------------- wrapper / composition bypass attempts --------------------
	// The existing opaque-shell-token policy already forces ASK for these
	// because they contain `&&`, `|`, `;`, `>`, `$(`, `bash -c`, etc.
	{
		id: "wrap-bash-c-rm-home",
		family: "wrapper-bypass",
		command: "bash -c 'rm -rf \"$HOME\"'",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "bash -c opaque wrapper",
	},
	{
		id: "wrap-sh-c-rm-home",
		family: "wrapper-bypass",
		command: "sh -c 'rm -rf \"$HOME\"'",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "sh -c opaque wrapper",
	},
	{
		id: "wrap-sudo-rm-home",
		family: "wrapper-bypass",
		command: 'sudo rm -rf "$HOME"',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "sudo wrapper",
	},
	{
		id: "wrap-env-rm-home",
		family: "wrapper-bypass",
		command: 'env rm -rf "$HOME"',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "env wrapper around rm",
	},
	{
		id: "wrap-command-rm-home",
		family: "wrapper-bypass",
		command: 'command rm -rf "$HOME"',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "command builtin wrapper",
	},
	{
		id: "wrap-pipe-rm-home",
		family: "wrapper-bypass",
		command: 'echo y | rm -rf "$HOME"',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "pipe composition",
	},
	{
		id: "wrap-subshell-rm-home",
		family: "wrapper-bypass",
		command: '(cd / && rm -rf "$HOME")',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "subshell composition",
	},
	{
		id: "wrap-find-exec-rm-home",
		family: "wrapper-bypass",
		command: 'find "$HOME" -exec rm -rf {} +',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "find -exec to rm",
	},
	{
		id: "wrap-find-exec-rm-semicolon",
		family: "wrapper-bypass",
		command: 'find "$HOME" -exec rm -rf {} \\;',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "find -exec ; variant",
	},
	{
		id: "wrap-tee-home",
		family: "wrapper-bypass",
		command: "echo bad | sudo tee -a /etc/hosts",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "tee redirect to /etc/hosts (system-file-write floor)",
	},
	{
		id: "wrap-redirect-passwd",
		family: "wrapper-bypass",
		command: "pwd > /etc/passwd",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "redirect overwrite of /etc/passwd (system-file-write floor)",
	},
	{
		id: "wrap-cmdsubst-rm-home",
		family: "wrapper-bypass",
		command: 'echo $(rm -rf "$HOME")',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "command substitution",
	},
	{
		id: "wrap-backtick-rm-home",
		family: "wrapper-bypass",
		command: 'echo `rm -rf "$HOME"`',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "backtick command substitution",
	},
	{
		id: "wrap-eval-rm-home",
		family: "wrapper-bypass",
		command: 'eval rm -rf "$HOME"',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "eval wrapper",
	},
	{
		id: "wrap-var-assign-rm-home",
		family: "wrapper-bypass",
		command: 'target="$HOME"; rm -rf "$target"',
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "V1 honest-ASK; cannot resolve $target -> $HOME without a parser",
	},
	{
		id: "wrap-cd-home-then-rm",
		family: "wrapper-bypass",
		command: 'cd "$HOME" && rm -rf .',
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "V1 honest-ASK; cannot resolve cd + . -> $HOME without a parser",
	},

	// -------------------- compound aggregation --------------------
	// V1 SCOPE NOTE: The existing canonical command policy treats
	// opaque-shell-token inputs (containing `;`, `&&`, `|`, etc.)
	// as a SINGLE aggregated verdict, not as a per-command analysis.
	// A real per-command max-risk aggregation requires a shell
	// parser, which is OUT OF V1 SCOPE. V1 therefore honest-ASKs
	// all compound commands, regardless of whether every branch is
	// individually safe. This is documented as a V2 candidate.
	//
	// What V1 GUARANTEES: the hard floor still fires for the
	// R5-shaped inner commands. A `pwd; rm -rf "$HOME"` input
	// falls to ASK (opaque token) AND the R5 hard-floor matches
	// against the rendered surface, so the disposition is
	// `never-auto-approve`. The aggregate decision remains `ask`
	// because the canonical policy already said ASK.
	{
		id: "compound-pwd-then-rm-home",
		family: "compound-aggregation",
		command: 'pwd; rm -rf "$HOME"',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "V1: ASK + R5 hard floor matches inner",
	},
	{
		id: "compound-git-diff-then-rm-home",
		family: "compound-aggregation",
		command: 'git diff && rm -rf "$HOME"',
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes: "V1: ASK + R5 hard floor matches inner",
	},
	// `pwd; pwd` would ALLOW under a per-command parser; V1
	// honestly ASKs because the canonical policy treats the whole
	// input as opaque. This is the V1 -> V2 boundary.
	{
		id: "compound-pwd-and-pwd",
		family: "compound-aggregation",
		command: "pwd; pwd",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "V1 ASK (opaque input); V2 may ALLOW via per-branch max",
	},
];
