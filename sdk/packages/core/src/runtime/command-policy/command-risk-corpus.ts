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
		id: "r0-git-remote",
		family: "R0-readonly",
		command: "git remote",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "list configured remotes; observational (no-subcommand form)",
	},
	{
		id: "r0-git-remote-v",
		family: "R0-readonly",
		command: "git remote -v",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "list with URLs; observational -v form",
	},
	{
		id: "r0-git-remote-verbose",
		family: "R0-readonly",
		command: "git remote --verbose",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "list with URLs; observational --verbose form",
	},
	{
		id: "r0-echo-empty",
		family: "R0-readonly",
		command: "echo",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "echo with no args; prints empty line; stdout-only",
	},
	{
		id: "r0-echo-literal",
		family: "R0-readonly",
		command: "echo hello",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "echo with a bare-literal arg; stdout-only",
	},
	{
		id: "r0-echo-multi-word",
		family: "R0-readonly",
		command: "echo hello world",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "echo with multi-word bare literal; stdout-only",
	},
	{
		id: "r0-echo-single-quote",
		family: "R0-readonly",
		command: "echo '---BRANCH---'",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "echo with single-quoted literal; stdout-only",
	},
	{
		id: "r0-echo-double-quote",
		family: "R0-readonly",
		command: 'echo "hello world"',
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "echo with double-quoted literal (no shell metacharacters); stdout-only",
	},
	{
		id: "r0-echo-n-literal",
		family: "R0-readonly",
		command: "echo -n hello",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "echo with -n flag; suppresses trailing newline; observational",
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
		// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01:
		// `ls /etc` is no longer ALLOW by default. The command
		// shape is safe (ls of any path), but the path operand
		// is OUTSIDE the configured workspace root, so the
		// workspace path authority gate downgrades to ASK.
		// This is a STRICT SUBSET of the previous ALLOW set: the
		// path-agnostic regex used to allow it; the layered
		// path authority now correctly ASKs.
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"ls of a specific path; safe command shape, but the path is outside the configured workspace roots -> ASK via host_workspace_path_authority",
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
		command: "find . -type f -name log.txt",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes:
			"find with predicates only; LITERAL name (CORRECTION01: shell-glob patterns correctly ASK)",
	},
	{
		id: "r0-find-not-path",
		family: "R0-readonly",
		command: "find . -type d -name command-risk -and -path ./src",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes:
			"find with predicates and -and; LITERAL paths (CORRECTION01: shell-glob patterns correctly ASK)",
	},
	{
		// CORRECTION01: shell-expansion boundary negative corpus.
		// Glob-bearing source text is correctly ASK at the V1 regex
		// layer because the rule cannot prove the post-expansion
		// argv remains predicate-only. Users needing globs require
		// either (a) shell-quoting the pattern with provenance
		// tracked through the parser or (b) V2 AST token-quote
		// provenance integration. Until that lands, the V1 safe
		// allowlist deliberately refuses to bless these forms.
		id: "r0-find-glob-ask-name",
		family: "R0-readonly",
		command: "find . -name *.ts",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"unquoted shell glob in -name pattern: shell expands *.ts before find sees argv; ASK until quote provenance proven",
	},
	{
		id: "r0-find-glob-ask-path",
		family: "R0-readonly",
		command: "find . -path */node_modules/*",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"unquoted shell glob in -path pattern: shell expands path glob; ASK until quote provenance proven",
	},
	{
		id: "r0-find-glob-ask-start",
		family: "R0-readonly",
		command: "find *",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"glob in starting path: attacker-controlled filenames become starting paths; ASK",
	},

	// -------------------- R0 — workspace path authority --------------------
	// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01
	// These corpus entries pin the V1 LEXICAL_WORKSPACE_CONFINEMENT
	// contract. The contract is path-aware but NOT filesystem-aware:
	// `path.resolve` is used to canonicalize the operand, and
	// containment under a configured workspace root is tested via
	// `startsWith(root + path.sep)`. The fixture roots are host-
	// supplied; in production the CLI passes `process.cwd()` and
	// the VSCode host passes the multi-root resolver output.
	//
	// Every entry below MUST be evaluated against a host authorization
	// that supplies `workspaceRoots: ["<some root>"]` and a `cwd`.
	// The corpus-contract test
	// (`command-risk-corpus.path-authority.test.ts`) supplies a
	// uniform `WORKSPACE_ROOT = "/current/project"` context.
	{
		id: "r0-pathauthority-ls-workspace-absolute",
		family: "R0-readonly",
		command: "ls /current/project",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "absolute path under workspace root -> lexical pass -> ALLOW",
	},
	{
		id: "r0-pathauthority-ls-workspace-subdir",
		family: "R0-readonly",
		command: "ls /current/project/.factory",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "absolute subpath under workspace root -> lexical pass -> ALLOW",
	},
	{
		id: "r0-pathauthority-find-workspace-absolute",
		family: "R0-readonly",
		command: "find /current/project -type f",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes: "find with absolute starting path under workspace root -> ALLOW",
	},
	{
		id: "r0-pathauthority-find-workspace-subdir-name",
		family: "R0-readonly",
		command: "find /current/project/src -name foo.ts",
		requiredDecision: "allow",
		requiredDisposition: "auto-approve-eligible",
		notes:
			"find with absolute starting path under workspace root + literal name pattern -> ALLOW",
	},
	// Negative controls: paths outside the workspace root.
	{
		id: "r0-pathauthority-ls-outside-etc",
		family: "R0-readonly",
		command: "ls /etc",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"absolute path outside workspace root -> ASK via host_workspace_path_authority (R0/ls shape match, path authority downgrade)",
	},
	{
		id: "r0-pathauthority-ls-outside-ssh",
		family: "R0-readonly",
		command: "ls ~/.ssh",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"absolute path outside workspace root (sensitive system path) -> ASK",
	},
	{
		id: "r0-pathauthority-find-root",
		family: "R0-readonly",
		command: "find /",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "absolute root path outside workspace root -> ASK",
	},
	{
		id: "r0-pathauthority-find-etc",
		family: "R0-readonly",
		command: "find /etc",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "find with absolute starting path outside workspace root -> ASK",
	},
	// Lexical-escape sequences. `path.resolve` collapses
	// dot-segments, so these are caught even though the source
	// string begins with the workspace prefix.
	{
		id: "r0-pathauthority-find-lexical-escape",
		family: "R0-readonly",
		command: "find /current/project/../../etc",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"lexical escape via .. dot-segments: path.resolve collapses them and containment fails -> ASK",
	},
	{
		id: "r0-pathauthority-ls-lexical-escape-1",
		family: "R0-readonly",
		command: "ls /current/project/../.ssh",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"lexical escape via .. dot-segments: path.resolve('/current/project/../.ssh') = '/current/.ssh' which is outside the workspace root -> ASK",
	},
	{
		id: "r0-pathauthority-ls-lexical-escape-2",
		family: "R0-readonly",
		command: "ls /current/project/sub/../../etc",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes: "lexical escape via multiple .. dot-segments -> ASK",
	},
	// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
	// REALPATH_WORKSPACE_CONFINEMENT:
	//
	// A project-internal symlink pointing outside the project
	// lexically passes the V1 gate. The realpath variant closes
	// this by following the symlink at the host boundary and
	// testing containment on the canonical pathname.
	//
	// The corpus now documents the closed case. The host
	// (CLI / VS Code) is responsible for building the
	// `pathAuthorityEvidence`; the policy layer consumes it.
	// Entries below assume the host has supplied evidence that
	// realpath-resolves the operand to the canonical pathname.
	{
		id: "r0-pathauthority-find-symlink-escape-realpath-closed",
		family: "R0-readonly",
		command: "find /current/project/outside-link",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"symlink escape closed: a project-internal symlink pointing outside the project now fails realpath containment. The host resolves the symlink via fs.realpathSync; the canonical target escapes the workspace root, so the policy downgrades ALLOW to ASK with host_workspace_realpath_authority. The V1 lexical pass is no longer the gate.",
	},
	{
		id: "r0-pathauthority-find-nonexistent-fail-closed",
		family: "R0-readonly",
		command: "find /current/project/does-not-exist",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"fail-closed on ENOENT: when the operand does not exist on disk, the host sets resolvedRealPath=null and the policy downgrades ALLOW to ASK with host_workspace_realpath_authority. This is the conservative default; users may still approve via the TUI.",
	},
	{
		id: "r0-pathauthority-find-permission-denied-fail-closed",
		family: "R0-readonly",
		command: "find /current/project/restricted",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"fail-closed on EACCES: when the host cannot read the path (permission denied), resolvedRealPath=null and the policy downgrades to ASK. The policy module never guesses the canonical pathname.",
	},
	{
		id: "r0-pathauthority-find-nonexistent-mixed-operands",
		family: "R0-readonly",
		command: "find /current/project/src /current/project/does-not-exist",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"mixed realpath resolution: one operand resolves successfully but a sibling operand fails ENOENT. The aggregate is non-conforming because ANY unresolved operand is ASK. The host surfaces the failure reason via host_workspace_realpath_authority.",
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
	// ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01
	//
	// V1 honestly ASKs every compound input containing &&, ;, |, etc.
	// because the canonical policy treats the input as opaque. The
	// V1 -> V2 promotion boundary is what makes the rows below
	// ALLOWable: with a parser-bound AST, every reachable leaf is
	// independently positively matched, so the aggregate is
	// auto-approve-eligible and `risk_v2_structured_promotion` fires.
	//
	// These rows are asserted in BOTH:
	//   - V1-only baseline path (current test): all return ASK / ask.
	//   - V2 parser-bound path (new test in structured-command-risk-integration):
	//     all return ALLOW / auto-approve-eligible via
	//     risk_v2_structured_promotion.
	{
		id: "compound-and-pwd-then-status",
		family: "compound-aggregation",
		command: "pwd && git status",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"V1 ASK (opaque input); V2 parser-bound: ALLOW + auto-approve-eligible + risk_v2_structured_promotion (every leaf matches)",
	},
	{
		id: "compound-and-all-safe-live",
		family: "compound-aggregation",
		command:
			"git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"V1 ASK (opaque input); V2 parser-bound: ALLOW + auto-approve-eligible + risk_v2_structured_promotion (every leaf matches); USER'S EXACT LIVE COMMAND",
	},
	// V2 conservation: even with parser bound, an `&&` chain with a
	// dangerous leaf stays at ASK + never-auto-approve. The V1 ASK
	// contract holds; V2 strengthens disposition only when an R5 leaf
	// is found.
	{
		id: "compound-and-mixed-evil-sentinel",
		family: "compound-aggregation",
		command:
			"git status --short && git branch -D __CLINEMM_SENTINEL__",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"V1 ASK (opaque input); V2 parser-bound: ASK (git branch -D is ASK, aggregate ASK); mutating leaf correctly rejected",
	},
	{
		id: "compound-and-foreign-unknown",
		family: "compound-aggregation",
		command: "pwd && unknown-binary --something",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"V1 ASK (opaque input); V2 parser-bound: ASK (unknown leaf is ASK, aggregate ASK)",
	},
	{
		id: "compound-and-sudo-rm-rf",
		family: "compound-aggregation",
		command: "pwd && sudo rm -rf /",
		requiredDecision: "ask",
		requiredDisposition: "never-auto-approve",
		notes:
			"V1 ASK (opaque input); V2 parser-bound: ASK + never-auto-approve (rm -rf / is R5 catastrophic via hard floor; disposition strengthened to never-auto-approve)",
	},
	{
		id: "compound-and-remote-then-push",
		family: "compound-aggregation",
		command: "git remote -v && git push",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"V1 ASK (opaque input); V2 parser-bound: ASK (git push is ASK, aggregate ASK); untracked mutating leaf rejected",
	},
	{
		id: "compound-and-branch-then-branch-d",
		family: "compound-aggregation",
		command: "git branch --show-current && git branch -D foo",
		requiredDecision: "ask",
		requiredDisposition: "ask",
		notes:
			"V1 ASK (opaque input); V2 parser-bound: ASK (git branch -D is ASK, aggregate ASK); mutating leaf rejected",
	},
	// V2 conservative guards for non-`&&` compositions stay out of
	// scope per the engineer plan; the existing compound rows cover
	// the security side via the R5 hard floor.
];
