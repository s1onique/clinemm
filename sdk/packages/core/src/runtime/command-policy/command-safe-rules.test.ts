/**
 * Host-owned safe-rule engine tests.
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION03
 *
 * Tests the bounded positive matcher in `command-safe-rules.ts`. These are
 * behavior-oriented: each test names a class of commands and asserts which
 * side of the allow/deny line they fall on.
 */
import { describe, expect, it } from "vitest";

import {
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	findSafeRuleMatch,
	isOpaqueShellRendered,
} from "./command-safe-rules";

describe("isOpaqueShellRendered", () => {
	const OPAQUE_TOKENS = [
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
	for (const tok of OPAQUE_TOKENS) {
		it(`detects "${tok}" as opaque`, () => {
			expect(isOpaqueShellRendered(`pwd ${tok} something`)).toBe(true);
		});
	}

	it("returns false for plain read-only commands", () => {
		expect(isOpaqueShellRendered("pwd")).toBe(false);
		expect(isOpaqueShellRendered("git status")).toBe(false);
		expect(isOpaqueShellRendered("git diff --stat")).toBe(false);
	});
});

describe("findSafeRuleMatch — finite positive allowlist (CORRECTION03 audit)", () => {
	// Every command in this list is asserted to match. Adding an option
	// to any rule MUST be reflected here with a documented safety review
	// per the rule's REVIEW STANDARD.

	it("pwd: bare and POSIX -L / -P options match", () => {
		for (const cmd of ["pwd", "pwd -L", "pwd -P"]) {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m?.source).toBe("host_safe_pwd");
		}
	});

	it("git status: documented reporting modes match", () => {
		for (const cmd of [
			"git status",
			"git status --short",
			"git status -s",
			"git status --branch",
			"git status -b",
			"git status --porcelain",
			"git status --porcelain=1",
			"git status --porcelain=2",
			"git status -u",
			"git status -u=no",
			"git status -u=normal",
			"git status -u=all",
			"git status --short --branch",
			"git status --short --branch --porcelain",
			"git status -s -b",
		]) {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m?.source).toBe("host_safe_git_status");
		}
	});

	it("git diff: finite allowlisted options match", () => {
		for (const cmd of [
			"git diff",
			"git diff --stat",
			"git diff --numstat",
			"git diff --shortstat",
			"git diff --name-only",
			"git diff --name-status",
			"git diff --cached",
			"git diff --staged",
			"git diff --cached --stat",
			"git diff --cached --name-only",
			"git diff --no-color",
			"git diff --color=always",
			"git diff --color=auto",
			"git diff --color=never",
			"git diff --stat --name-only",
			"git diff --cached --name-status --numstat",
		]) {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m?.source).toBe("host_safe_git_diff");
		}
	});

	it("git log: finite allowlisted options match", () => {
		for (const cmd of [
			"git log",
			"git log -n 5",
			"git log --oneline",
			"git log --stat",
			"git log --no-color",
			"git log --pretty=oneline",
			"git log --pretty=short",
			"git log --pretty=medium",
			"git log --pretty=full",
			"git log --pretty=fuller",
			"git log --pretty=reference",
			"git log --pretty=email",
			"git log --pretty=raw",
			"git log --pretty=tformat",
			"git log --format=short",
			"git log -n 5 --oneline",
			"git log -n 5 --stat --no-color",
			"git log -5",
			"git log --oneline -10",
		]) {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m?.source).toBe("host_safe_git_log");
		}
	});

	it("git branch: finite allowlisted list / query forms match", () => {
		// Every command in this list is asserted to match
		// `host_safe_git_branch`. Each option is individually reviewed
		// against the REVIEW STANDARD at the top of command-safe-rules.ts.
		// NOTE: --format=<fmt> is DELIBERATELY REJECTED. git-branch(1)
		// documents it as git-for-each-ref interpolation; the previous
		// "git log --pretty preset names" allowlist was inaccurate
		// (those names are NOT valid git-branch --format directives
		// and produce literal text output). Rejection cases are in the
		// REJECTED git branch options describe below.
		for (const cmd of [
			// Bare / --list : default listing; pure observation.
			"git branch",
			"git branch --list",
			// --all / -a : local + remote-tracking
			"git branch --all",
			"git branch -a",
			// --remotes / -r : remote-tracking only
			"git branch --remotes",
			"git branch -r",
			// --show-current : print current branch name
			"git branch --show-current",
			// --points-at <object> : list branches at object
			"git branch --points-at HEAD",
			"git branch --points-at main",
			"git branch --points-at 1234567",
			"git branch --points-at feature/foo",
			"git branch --list --points-at HEAD",
			"git branch --show-current --points-at HEAD",
			// Color / visual-only
			"git branch --no-color",
			"git branch --color=always",
			"git branch --color=auto",
			"git branch --color=never",
			"git branch --show-current --no-color",
			"git branch -r --no-color",
			// Verbose list modes (observational)
			"git branch -v",
			"git branch -vv",
			"git branch -vva",
			// --no-abbrev : observational
			"git branch --no-abbrev",
			// Composed combinations
			"git branch --list -a",
			"git branch -a --no-color",
			"git branch --list --no-color",
		]) {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m?.source).toBe("host_safe_git_branch");
		}
	});

	it("ls: ordinary listing forms match (REVIEW STANDARD audit-cleared)", () => {
		// Every documented ls option is observational: it does NOT invoke
		// external helpers, write outside stdout, broaden authority, or
		// have other authority-broadening effect. ls is intrinsically
		// read-only per ls(1) documentation.
		for (const cmd of [
			// Bare
			"ls",
			// Single short options
			"ls -l",
			"ls -A",
			"ls -1",
			"ls -d",
			"ls -F",
			"ls -h",
			"ls -i",
			"ls -L",
			"ls -m",
			"ls -n",
			"ls -p",
			"ls -q",
			"ls -r",
			"ls -s",
			"ls -S",
			"ls -t",
			"ls -u",
			"ls -U",
			"ls -X",
			// Bundled short options
			"ls -la",
			"ls -lh",
			"ls -lAh",
			"ls -alF",
			// Path arguments
			"ls /etc",
			"ls /tmp",
			"ls /var/log",
			"ls .",
			"ls ..",
			"ls path/*",
			"ls /etc /tmp /var",
			"ls -- /tmp",
			// Long options
			"ls --all",
			"ls --almost-all",
			"ls --author",
			"ls --directory",
			"ls --dired",
			"ls --classify",
			"ls --file-type",
			"ls --format=long",
			"ls --format=commas",
			"ls --format=vertical",
			"ls --format=across",
			"ls --full-time",
			"ls --group-directories-first",
			"ls --no-group",
			"ls --human-readable",
			"ls --si",
			"ls --dereference-command-line",
			"ls --dereference-command-line-symlink-to-dir",
			"ls --hyperlink",
			"ls --hyperlink=always",
			"ls --hyperlink=auto",
			"ls --hyperlink=never",
			"ls --indicator-style=slash",
			"ls --indicator-style=file-type",
			"ls --indicator-style=classify",
			"ls --indicator-style=none",
			"ls --inode",
			"ls --kibibytes",
			"ls --dereference",
			"ls --numeric-uid-gid",
			"ls --literal",
			"ls --reverse",
			"ls --recursive",
			"ls --size",
			"ls --sort=time",
			"ls --sort=size",
			"ls --sort=extension",
			"ls --sort=name",
			"ls --sort=width",
			"ls --sort=version",
			"ls --sort=none",
			"ls --time=atime",
			"ls --time=ctime",
			"ls --time=mtime",
			"ls --time=birth",
			"ls --time=access",
			"ls --time=use",
			"ls --time=modification",
			"ls --time=creation",
			"ls --time=status",
			"ls --time-style=long-iso",
			"ls --time-style=full-iso",
			"ls --time-style=iso",
			"ls --time-style=locale",
			"ls --time-style=+%H:%M:%S",
			"ls --tabsize=4",
			"ls --tabsize=8",
			"ls --zero",
			"ls --quote-name",
			"ls --quoting-style=literal",
			"ls --quoting-style=shell",
			"ls --quoting-style=c",
			"ls --quoting-style=escape",
			"ls --show-control-chars",
			"ls --hide-control-chars",
			"ls --context",
			"ls --help",
			"ls --version",
			"ls --color",
			"ls --color=always",
			"ls --color=auto",
			"ls --color=never",
			"ls --ignore=*.bak",
			"ls --ignore=*.tmp",
			"ls --hide=*.bak",
			"ls --hide=*.tmp",
			"ls --block-size=K",
			"ls --block-size=M",
			"ls --block-size=G",
			"ls -la --human-readable --color=auto",
			"ls -la /etc /tmp",
			"ls -la --ignore=*.log",
		]) {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m?.source).toBe("host_safe_ls");
		}
	});

	it("find: predicate-only / stdout-only forms match (REVIEW STANDARD audit-cleared, CORRECTION01 shell-expansion boundary)", () => {
		// Per GNU findutils, find has stdout-only actions (-print, -print0,
		// -printf, -ls, -quit, -prune) and action-capable forms (-delete,
		// -exec, -execdir, -ok, -okdir, -fls, -fprint, -fprint0, -fprintf).
		// We enumerate ONLY the stdout-only + pure-predicate forms here.
		//
		// CORRECTION01 (2026-08-24, Factory review): the rule classifies
		// PRE-shell source text. Shell pathname expansion happens AFTER
		// regex matching and BEFORE find sees its argv. A pre-expansion
		// wildcard like `*.ts` may be expanded by the shell to whatever
		// names match in the current directory — an attacker can plant
		// filenames that turn a benign-looking source command into
		// action-bearing argv. V1 deliberately avoids this trust boundary:
		//   - starting paths: literal POSIX paths, no glob metachars
		//   - pattern-bearing predicates (-name/-iname/-path/-ipath/
		//     -regex/-iregex): LITERAL patterns only in V1; users who
		//     need globs must use V2 parser-quote provenance.
		//
		// All test cases below use LITERAL patterns only. See the
		// "REJECTED find shell-glob forms" describe block for the
		// negative regression family.
		for (const cmd of [
			"find",
			"find .",
			"find /",
			"find /tmp",
			"find /etc",
			"find ..",
			"find -H .",
			"find -L .",
			"find -P .",
			"find -E .",
			"find -X .",
			"find -f .",
			"find -f /tmp",
			"find . -type f",
			"find . -type d",
			"find . -type l",
			// -name / -iname: LITERAL name only (no globs)
			"find . -name foo.ts",
			"find . -iname FOO",
			"find . -name command-risk",
			// -path / -ipath: LITERAL path only (no globs)
			"find . -path ./node_modules",
			"find . -path ./foo/bar/baz.ts",
			// -regex / -iregex: V1 deliberately accepts ONLY characters that
			// are NEITHER pathname-expansion metacharacters (* ? [ ]
			// { }) NOR shell control/operator syntax (| & ; < > ( )
			// ` $ \ ~ etc.). Pure-regex syntax `.`, `+`, `^`, `$`,
			// `\` is allowed because the shell passes it through
			// unchanged and find itself interprets it. Raw `(`, `)`,
			// `|` are reserved shell operators (subshell grouping
			// and pipe) — even in `-regex` arguments — so V1 does
			// NOT bless them. Users who need alternation or
			// capture-group syntax in `-regex` require V2 parser-
			// quote provenance integration; until that lands, V1
			// takes the conservative path.
			"find . -regex .ts$",
			"find . -regex foo.bar",
			"find . -regex .+ts$",
			"find . -regex ^foo",
			"find . -iregex .ts$",
			"find . -iregex foo.bar",
			"find . -iregex .+ts$",
			"find . -iregex ^foo",
			"find . -perm 644",
			"find . -perm -u+w",
			"find . -perm +u+w",
			"find . -user root",
			"find . -uid 1000",
			"find . -group root",
			"find . -gid 1000",
			"find . -size +1M",
			"find . -size -100c",
			"find . -size 0",
			"find . -atime +7",
			"find . -ctime -1",
			"find . -mtime 0",
			"find . -amin +60",
			"find . -cmin -10",
			"find . -mmin 5",
			"find . -newer /tmp/marker",
			"find . -empty",
			"find . -readable",
			"find . -writable",
			"find . -executable",
			"find . -true",
			"find . -false",
			"find . -links 2",
			"find . -inum 12345",
			"find . -fstype ext4",
			"find . -nogroup",
			"find . -nouser",
			"find . -depth",
			"find . -xdev",
			"find . -mindepth 1",
			"find . -maxdepth 3",
			"find . -prune",
			"find . -print",
			"find . -print0",
			"find . -ls",
			"find . -printf %p\\n",
			"find . -quit",
			"find . -not -name foo",
			"find . -name foo -and -type f",
			"find . -name foo -or -name bar",
			"find . -type d -name command-risk -and -path ./src",
			"find . -type f -size +1M -maxdepth 3",
			"find /tmp -type f -mtime +7 -name log.txt",
		]) {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m?.source).toBe("host_safe_find");
		}
	});

	it("git remote: documented observation forms match (REVIEW STANDARD audit-cleared)", () => {
		// git-remote(1) explicitly distinguishes the LIST (no-subcommand
		// / -v / --verbose) form from every mutating subcommand. We
		// enumerate ONLY the observational forms here. The mutating
		// forms (add, remove, rename, set-url, set-head, set-branches,
		// update, prune, get-url) MUST NOT match.
		for (const cmd of [
			// Bare
			"git remote",
			// Verbose
			"git remote -v",
			"git remote --verbose",
		]) {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m?.source).toBe("host_safe_git_remote");
		}
	});

	it("echo: documented literal-stdout forms match (REVIEW STANDARD audit-cleared)", () => {
		// POSIX echo(1) writes its arguments followed by a newline.
		// It has NO file-system-mutating mode. Every allowed option
		// is purely visual; every allowed operand is a literal in the
		// restricted POSIX-text character class (excluding $,
		// backtick, \, (), *, ?, [], {}, |, &, ;, <, >, =).
		for (const cmd of [
			// Bare (prints empty line)
			"echo",
			// Single bare literal
			"echo hello",
			"echo BRANCH",
			// Single-quoted literal (the exact form from the live command)
			"echo '---BRANCH---'",
			"echo '---REMOTES---'",
			// Double-quoted literal
			'echo "hello world"',
			// -n suppresses trailing newline
			"echo -n hello",
			"echo -n 'literal text'",
			// Bare with the allowed punctuation set
			"echo hello, world",
			"echo a/b/c",
			// Multi-word bare literal (whitespace is in the bare class)
			"echo hello world",
			"echo a b c d e",
		]) {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m?.source).toBe("host_safe_echo");
		}
	});
});

describe("findSafeRuleMatch — REJECTED git diff options (helper-invocation / out-of-scope)", () => {
	// These invocations are NOT host-proven safe. Each test documents the
	// specific Git option whose execution semantics justify the rejection.
	const REJECTED_DIFF = [
		// External helper invocation (gitattributes(5), git-diff(1))
		["git diff --ext-diff", "external diff driver invocation"],
		["git diff --textconv", "textconv filter invocation"],
		// File-system writes outside stdout
		["git diff --output=/tmp/diff.txt", "--output writes to a file"],
		["git diff --output /tmp/diff.txt", "--output writes to a file"],
		// Out-of-tree authority
		["git diff --no-index /etc/passwd /tmp/x", "--no-index broadens scope"],
		// Unknown options (no wildcard fallback)
		["git diff --totally-unknown", "unknown option"],
		["git diff --whatever", "unknown option"],
		// Invalid enum values for reviewed options
		["git diff --color=evil", "color value outside reviewed set"],
		["git diff --color=", "empty color value"],
		// Shell injection / opaque composition
		["git diff --ext-diff; rm -rf /", "shell composition with --ext-diff"],
		["git diff --ext-diff | sh", "shell composition with --ext-diff"],
	];

	for (const [cmd, _why] of REJECTED_DIFF) {
		it(`rejects "${cmd}"`, () => {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m).toBeUndefined();
		});
	}
});

describe("findSafeRuleMatch — REJECTED git log options (helper-invocation / out-of-scope)", () => {
	const REJECTED_LOG = [
		["git log --ext-diff", "external diff driver invocation"],
		["git log --textconv", "textconv filter invocation"],
		["git log --output=/tmp/log.txt", "--output writes to a file"],
		["git log --output /tmp/log.txt", "--output writes to a file"],
		["git log --totally-unknown", "unknown option"],
		["git log --whatever", "unknown option"],
		// Custom format strings are NOT in the reviewed finite set.
		["git log --pretty=%H", "custom pretty-format outside reviewed set"],
		["git log --pretty=%cd", "custom pretty-format outside reviewed set"],
		["git log --pretty=format:%H", "custom pretty-format outside reviewed set"],
		["git log --format=%H", "custom pretty-format outside reviewed set"],
		["git log --pretty=evil", "unknown pretty preset"],
	];

	for (const [cmd] of REJECTED_LOG) {
		it(`rejects "${cmd}"`, () => {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m).toBeUndefined();
		});
	}
});

describe("findSafeRuleMatch — REJECTED git status options", () => {
	const REJECTED_STATUS = [
		["git status --porcelain=3", "porcelain version outside reviewed set"],
		["git status --porcelain=9", "porcelain version outside reviewed set"],
		["git status --porcelain=evil", "porcelain version outside reviewed set"],
		["git status -u=evil", "untracked mode outside reviewed set"],
		["git status --totally-unknown", "unknown option"],
		["git status --whatever", "unknown option"],
	];

	for (const [cmd] of REJECTED_STATUS) {
		it(`rejects "${cmd}"`, () => {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m).toBeUndefined();
		});
	}
});

describe("findSafeRuleMatch — REJECTED git branch options (mutation / out-of-scope)", () => {
	// git branch has documented create / delete / rename / copy / upstream
	// mutation forms. None of these may match a safe rule. Per
	// REVIEW STANDARD (command-safe-rules.ts top), the rule engine must
	// return undefined for these.
	const REJECTED_BRANCH = [
		// Create
		["git branch foo", "create new branch (positional name)"],
		["git branch foo HEAD", "create new branch at start-point"],
		// Delete
		["git branch -d foo", "delete branch (safe)"],
		["git branch -D foo", "delete branch (force)"],
		["git branch --delete foo", "delete branch (long form)"],
		// Rename / move
		["git branch -m old new", "rename branch"],
		["git branch -M old new", "rename branch (force)"],
		["git branch --move old new", "rename branch (long form)"],
		// Copy
		["git branch -c old new", "copy branch"],
		["git branch -C old new", "copy branch (force)"],
		["git branch --copy old new", "copy branch (long form)"],
		// Upstream mutation
		["git branch --set-upstream-to=origin/main", "upstream mutation"],
		["git branch -u origin/main foo", "upstream mutation"],
		["git branch --unset-upstream foo", "upstream mutation"],
		// Description editor (writes)
		["git branch --edit-description foo", "writes to refs"],
		// Tracking on creation (only valid with create form)
		["git branch --track origin/main foo", "create-tracking"],
		["git branch --no-track origin/main foo", "create-tracking override"],
		// Broader-scope predicates (V2 may revisit)
		["git branch --contains HEAD", "broader commit-set predicate"],
		["git branch --merged", "broader commit-set predicate"],
		["git branch --no-merged", "broader commit-set predicate"],
		// --format=<fmt> is DELIBERATELY REJECTED. git-branch(1) uses
		// git-for-each-ref interpolation; the finite "log pretty preset"
		// allowlist previously in this rule was inaccurate (those names
		// are NOT valid git-branch --format directives and produce
		// literal text output). Per Factory review P1, we reject all
		// --format forms (including the previously-allowed preset names
		// and arbitrary for-each-ref interpolation). Users wanting
		// custom formatting should invoke `git for-each-ref` directly
		// (also ASK today).
		["git branch --format=%H", "git-for-each-ref interpolation rejected"],
		[
			"git branch --format=%(refname:short)",
			"git-for-each-ref interpolation rejected",
		],
		[
			"git branch --format=oneline",
			"log pretty preset; not a valid git-branch --format directive",
		],
		[
			"git branch --format=short",
			"log pretty preset; not a valid git-branch --format directive",
		],
		[
			"git branch --format=medium",
			"log pretty preset; not a valid git-branch --format directive",
		],
		[
			"git branch --format=full",
			"log pretty preset; not a valid git-branch --format directive",
		],
		[
			"git branch --format=fuller",
			"log pretty preset; not a valid git-branch --format directive",
		],
		[
			"git branch --format=reference",
			"log pretty preset; not a valid git-branch --format directive",
		],
		[
			"git branch --format=email",
			"log pretty preset; not a valid git-branch --format directive",
		],
		[
			"git branch --format=raw",
			"log pretty preset; not a valid git-branch --format directive",
		],
		[
			"git branch --format=tformat",
			"log pretty preset; not a valid git-branch --format directive",
		],
		["git branch --format=evil", "unknown format directive"],
		// Unknown options (no wildcard fallback)
		["git branch --totally-unknown", "unknown option"],
		["git branch --whatever", "unknown option"],
		// --points-at requires the object token; bare flag must reject.
		["git branch --points-at", "missing required object token"],
		["git branch --list --points-at", "missing required object token"],
		// Positional before any flag (would-be create)
		["git branch foo --list", "positional before flag"],
		// Short flag we did not review (-z = --null; serialization)
		["git branch -z", "short flag outside reviewed set"],
		// Composition with --all followed by name (create-via-list-all)
		["git branch -a foo", "create-via-all (positional after options)"],
		// Color value outside reviewed set
		["git branch --color=evil", "color value outside reviewed set"],
	];

	for (const [cmd, _why] of REJECTED_BRANCH) {
		it(`rejects "${cmd}"`, () => {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m).toBeUndefined();
		});
	}
});

describe("findSafeRuleMatch — REJECTED git remote subcommands (mutation)", () => {
	// git-remote(1) distinguishes the LIST form (no-subcommand / -v /
	// --verbose) from every mutating subcommand. None of the mutating
	// forms may match a safe rule. Per REVIEW STANDARD (top of file),
	// the rule engine must return undefined for these.
	const REJECTED_REMOTE = [
		// add
		["git remote add origin url", "add remote"],
		["git remote add origin https://example.com/repo.git", "add remote with url"],
		// remove (long and short form)
		["git remote remove origin", "remove remote"],
		["git remote rm origin", "remove remote (short form)"],
		// rename
		["git remote rename origin upstream", "rename remote"],
		// set-url (multiple sub-forms)
		["git remote set-url origin url", "set-url mutation"],
		["git remote set-url --add origin url", "set-url --add mutation"],
		["git remote set-url --delete origin url", "set-url --delete mutation"],
		["git remote set-url --push origin url", "set-url --push mutation"],
		// set-head
		["git remote set-head origin main", "set-head mutation"],
		["git remote set-head origin --auto", "set-head auto mutation"],
		// set-branches
		["git remote set-branches origin main", "set-branches mutation"],
		["git remote set-branches --add origin dev", "set-branches --add mutation"],
		// update (network mutation)
		["git remote update", "fetch-update mutation"],
		["git remote update origin", "fetch-update mutation"],
		// prune (deletion mutation)
		["git remote prune origin", "prune mutation"],
		["git remote prune", "prune mutation"],
		// get-url (observational but narrow; deliberately not allowed)
		["git remote get-url origin", "narrow observational; ASK"],
		["git remote get-url --all origin", "narrow observational; ASK"],
		["git remote get-url --push origin", "narrow observational; ASK"],
		// Unknown options
		["git remote --whatever", "unknown long option"],
		["git remote -v --whatever", "unknown option after -v"],
		// Combined verb + arg in unexpected position
		["git remote foo", "positional after subcommand (no documented meaning)"],
	];

	for (const [cmd, _why] of REJECTED_REMOTE) {
		it(`rejects "${cmd}"`, () => {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m).toBeUndefined();
		});
	}
});

describe("findSafeRuleMatch — REJECTED echo forms (metacharacter / substitution)", () => {
	// echo has no documented mutating mode, but the argument character
	// class is INTENTIONALLY RESTRICTIVE: shell metacharacters that
	// could enable command substitution, variable expansion, globbing,
	// redirection, or pipe composition MUST fall through to ASK.
	const REJECTED_ECHO = [
		// Variable expansion
		["echo $HOME", "variable expansion"],
		["echo $PATH", "variable expansion"],
		// Command substitution $()
		["echo $(rm -rf $HOME)", "command substitution"],
		["echo \"$(dangerous)\"", "command substitution in double quotes"],
		// Backtick command substitution
		["echo `rm -rf $HOME`", "backtick command substitution"],
		["echo \"`dangerous`\"", "backtick command substitution in double quotes"],
		// Subshell / parens
		["echo (foo)", "unbalanced paren"],
		// Backslash escape
		["echo foo\\bar", "backslash escape"],
		// Globs
		["echo *", "glob metacharacter"],
		["echo *.txt", "glob with extension"],
		["echo foo?", "glob ?"],
		["echo [abc]", "glob bracket"],
		// Brace expansion
		["echo {a,b}", "brace expansion"],
		// Pipes / sequence / composition
		["echo foo | bar", "pipe composition"],
		["echo foo; bar", "semicolon composition"],
		["echo foo && bar", "ampersand-and composition"],
		// Redirection
		["echo foo > file", "output redirect"],
		["echo foo >> file", "append redirect"],
		// Assignment-like
		["echo foo=bar", "assignment-like (no $)"],
		// Unknown option
		["echo --evil", "unknown long option"],
		["echo -X", "unknown short option"],
		// Subshell wrapping
		["echo $(echo inner)", "command substitution wrapping echo"],
	];

	for (const [cmd, _why] of REJECTED_ECHO) {
		it(`rejects "${cmd}"`, () => {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m).toBeUndefined();
		});
	}
});

describe("findSafeRuleMatch — REJECTED ls options", () => {
	// ls has no mutating options, but the rule must still reject any
	// undocumented long option (no wildcard).
	const REJECTED_LS = [
		["ls --totally-unknown", "unknown long option"],
		["ls --whatever", "unknown long option"],
		["ls --output=/tmp/foo.txt", "would write to a file"],
		["ls --help-anything", "unknown long option"],
		["ls -E", "unknown short option (-E is BSD-specific)"],
		["ls -O", "unknown short option"],
		["ls -P", "unknown short option (BSD)"],
	];

	for (const [cmd, _why] of REJECTED_LS) {
		it(`rejects "${cmd}"`, () => {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m).toBeUndefined();
		});
	}
});

describe("findSafeRuleMatch — REJECTED find actions (mutation / execution)", () => {
	// GNU find has action-capable primitives that mutate the filesystem or
	// execute external programs. None of these may match a safe rule.
	// The `command-guard.ts` layer ALSO blocks these via a separate
	// file-editing blocklist; here we test that the safe-rule engine
	// returns ASK (no match) so they remain ASK even when bypassed.
	const REJECTED_FIND = [
		// Mutating
		["find . -delete", "`find -delete` deletes matched files"],
		["find /tmp -name foo -delete", "mutating form"],
		// Executing
		["find . -exec rm {} ;", "`find -exec` executes arbitrary utility"],
		["find . -exec rm {} +", "`find -exec` with batching"],
		["find . -execdir rm {} ;", "`find -execdir` executes in target dir"],
		["find . -execdir rm {} +", "`find -execdir` with batching"],
		["find . -ok rm {} ;", "`find -ok` interactive execute"],
		["find . -okdir rm {} ;", "`find -okdir` interactive execute"],
		// File-writing actions
		["find . -fls /tmp/out.txt", "`-fls FILE` writes to FILE"],
		["find . -fprint /tmp/out.txt", "`-fprint FILE` writes to FILE"],
		["find . -fprint0 /tmp/out.txt", "`-fprint0 FILE` writes to FILE"],
		["find . -fprintf /tmp/out.txt %p", "`-fprintf FILE` writes to FILE"],
		// Unknown
		["find . -totally-unknown", "unknown option"],
		["find . --whatever", "unknown option"],
	];

	for (const [cmd, _why] of REJECTED_FIND) {
		it(`rejects "${cmd}"`, () => {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m).toBeUndefined();
		});
	}
});

describe("findSafeRuleMatch — REJECTED find shell-glob forms (CORRECTION01 shell-expansion boundary)", () => {
	// GNU find(1) explicitly warns: "Patterns containing metacharacters
	// must be quoted so the shell does not expand them before find sees
	// them." The rule classifies PRE-shell source text; shell pathname
	// expansion happens AFTER regex matching. An attacker who can plant
	// filenames in the working directory can therefore change the argv
	// that find sees. V1 refuses to bless glob-bearing source: the
	// pattern-bearing predicates and starting paths must be LITERAL.
	//
	// Every fixture below must be REJECTED by host_safe_find (match
	// returns undefined). The fixtures are split into three families:
	//   1. Starting paths with shell glob metacharacters
	//   2. Pattern-bearing predicates with shell glob metacharacters
	//   3. Combined / adversarial forms
	//
	// The "glob metacharacter" set per POSIX: * ? [ ] { } ~ (tilde at
	// word start). Backslash is also a shell escape but our character
	// class disallows it.
	const REJECTED_FIND_GLOB = [
		// === Family 1: starting paths with shell-glob metachars ===
		["find *", "starting path is bare *"],
		["find ./*", "starting path has embedded glob"],
		["find src/*", "starting path ends with glob"],
		["find *foo", "starting path starts with glob"],
		["find foo*", "starting path contains glob"],
		["find foo?", "starting path has ?"],
		["find foo[ab]", "starting path has []"],
		["find foo{bar,baz}", "starting path has {}"],
		["find ~", "tilde triggers shell tilde expansion"],
		["find ~/subdir", "tilde prefix"],
		// === Family 2: pattern-bearing predicates with globs ===
		["find . -name *.ts", "unquoted -name with *"],
		["find . -iname *.ts", "unquoted -iname with *"],
		["find . -name foo*", "unquoted -name with trailing *"],
		["find . -iname foo*", "unquoted -iname with trailing *"],
		["find . -name *foo*", "unquoted -name with multiple globs"],
		["find . -name foo?", "unquoted -name with ?"],
		["find . -name foo[ab]", "unquoted -name with []"],
		["find . -name foo{bar}", "unquoted -name with {}"],
		["find . -path */node_modules/*", "unquoted -path with two globs"],
		["find . -path ./node_modules/*", "unquoted -path with trailing glob"],
		["find . -path */node_modules", "unquoted -path with leading glob"],
		["find . -ipath */FOO/*", "unquoted -ipath with globs"],
		// === -regex / -iregex: globs rejected; pure-regex chars OK ===
		["find . -regex *.ts", "unquoted -regex with *"],
		["find . -regex .*.ts", "unquoted -regex with multiple *"],
		["find . -regex .?ts$", "unquoted -regex with ?"],
		["find . -regex .[abc]ts$", "unquoted -regex with []"],
		["find . -regex .(foo|bar)", "unquoted -regex with parens OK if no globs"],
		// (note: -regex patterns with PURE regex syntax . + ( ) | ^ $ are ALLOWED)
		// === Family 3: combined / adversarial ===
		["find . -name foo* -delete", "glob + mutation (defense in depth)"],
		["find . -name *.ts -exec rm {} ;", "glob + execute (defense in depth)"],
		["find * -delete", "glob starting path + mutation"],
		["find . -path */node_modules -name *.ts", "multiple glob predicates"],
		// The user's exact recon chain (with quotes) — already ASK
		// because of the redirect+pipe (OPAQUE_SHELL_TOKENS) — would
		// also be ASK at this layer if the quotes were stripped,
		// because the bare `*` patterns trigger shell expansion.
		[
			"find . -type d -name command-risk* -not -path ./node_modules/* -not -path ./dist/* -not -path ./out/*",
			"user's recon chain, unquoted: glob-bearing predicates correctly ASK",
		],
		// === CORRECTION02: shell operator/control chars in -regex / -iregex ===
		// ( ) | are reserved shell operators (subshell grouping, pipe).
		// Even inside -regex / -iregex, raw forms are NOT a single argv
		// element — bash does not pass `.(foo|bar)` as one argument.
		// V1 refuses these forms; users needing alternation or grouping
		// require V2 parser-quote provenance integration.
		[
			"find . -regex (foo|bar).ts",
			"raw ()| in -regex is shell operator syntax",
		],
		["find . -regex foo|bar", "raw | in -regex is pipe"],
		["find . -regex (foo)", "raw () in -regex is subshell grouping"],
		[
			"find . -iregex (foo|bar).ts",
			"raw ()| in -iregex is shell operator syntax",
		],
		["find . -iregex foo|bar", "raw | in -iregex is pipe"],
		["find . -iregex (foo)", "raw () in -iregex is subshell grouping"],
		// Note: these forms WOULD be ALLOW'd if the user actually
		// shell-quoted them, e.g. `find . -regex '(foo|bar).ts'` —
		// but quoted forms trip OPAQUE_SHELL_TOKENS (parentheses are
		// in the list) and so are ASK at V1 anyway. The V2 parser-
		// quote provenance integration is the path to bless these.
	];

	for (const [cmd, _why] of REJECTED_FIND_GLOB) {
		it(`rejects "${cmd}"`, () => {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m).toBeUndefined();
		});
	}
});

describe("findSafeRuleMatch — adversarial negatives (broadly)", () => {
	// Sanity regression suite retained from CORRECTION02.
	const ADVERSARIAL = [
		// Git family — out of scope
		"git clean -fdx",
		"git reset --hard",
		"git push --force",
		"git commit --amend",
		"git rebase -i HEAD~3",
		"git branch -D foo",
		// Universal executables are NOT auto-safe
		"npm install",
		"npm unpublish example",
		"make",
		"curl https://example.com",
		"kubectl get pods",
		"kubectl delete namespace example",
		"docker ps",
		"docker system prune -af",
		"kill -9 1",
		"rm -rf /",
		// Bare executable with no constrained shape
		"git",
		"pwd --help",
		// Opaque shell composition
		"pwd; rm -rf /",
		"pwd && rm -rf /",
		"pwd | tee /etc/passwd",
		"eval rm -rf /",
		"sh -c 'rm -rf /'",
		"bash -c 'echo evil'",
		"$(rm -rf /)",
		"`rm -rf /`",
		"pwd > /etc/passwd",
		"pwd < /etc/passwd",
	];

	for (const cmd of ADVERSARIAL) {
		it(`rejects adversarial: "${cmd}"`, () => {
			const match = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(match).toBeUndefined();
		});
	}
});

describe("findSafeRuleMatch — mutation: predecessor wildcard regression (CORRECTION03 fix)", () => {
	// If the old wildcard `--[a-z-]+` branch is reintroduced in the git-diff
	// or git-log rules, the following adversarial inputs would start
	// matching the safe rules again. These tests document that mutation
	// boundary and serve as the regression proof for CORRECTION03.

	it("predecessor wildcard would have ALLOWed git diff --ext-diff", () => {
		// Self-documenting sanity check: confirm the CURRENT rule rejects
		// --ext-diff. If this ever flips to matching, the wildcard has
		// been reintroduced.
		const re =
			/^\s*git\s+diff(?:\s+(?:--stat|--numstat|--shortstat|--name-only|--name-status|--cached|--staged|--no-color|--color=(?:always|auto|never)))*\s*$/u;
		expect(re.test("git diff --ext-diff")).toBe(false);
		expect(re.test("git diff --textconv")).toBe(false);
		expect(re.test("git diff --output=foo")).toBe(false);
		expect(re.test("git diff --no-index /etc/passwd /tmp/x")).toBe(false);
	});

	it("predecessor wildcard would have ALLOWed git log --ext-diff", () => {
		const re =
			/^\s*git\s+log(?:\s+(?:-n\s+\d+|--oneline|--stat|--no-color|--pretty=(?:oneline|short|medium|full|fuller|reference|email|raw|tformat)|--format=(?:oneline|short|medium|full|fuller|reference|email|raw|tformat)|-[0-9]+))*$/u;
		expect(re.test("git log --ext-diff")).toBe(false);
		expect(re.test("git log --textconv")).toBe(false);
		expect(re.test("git log --output=foo")).toBe(false);
	});

	it("CURRENT safe-rule set rejects the exact predecessor defect", () => {
		expect(
			findSafeRuleMatch(
				"git diff --ext-diff",
				DEFAULT_COMMAND_HOST_ALLOW_RULES,
			),
		).toBeUndefined();
		expect(
			findSafeRuleMatch(
				"git diff --textconv",
				DEFAULT_COMMAND_HOST_ALLOW_RULES,
			),
		).toBeUndefined();
		expect(
			findSafeRuleMatch("git log --ext-diff", DEFAULT_COMMAND_HOST_ALLOW_RULES),
		).toBeUndefined();
		expect(
			findSafeRuleMatch("git log --textconv", DEFAULT_COMMAND_HOST_ALLOW_RULES),
		).toBeUndefined();
	});
});

describe("findSafeRuleMatch — structured input", () => {
	it("matches a structured {command, args} input shape", () => {
		const match = findSafeRuleMatch(
			{ command: "git", args: ["status"] },
			DEFAULT_COMMAND_HOST_ALLOW_RULES,
		);
		expect(match).toBeDefined();
		expect(match?.source).toBe("host_safe_git_status");
	});

	it("rejects a structured shape that fails to match a rule", () => {
		const match = findSafeRuleMatch(
			{ command: "git", args: ["push", "--force"] },
			DEFAULT_COMMAND_HOST_ALLOW_RULES,
		);
		expect(match).toBeUndefined();
	});

	it("rejects empty command string", () => {
		const match = findSafeRuleMatch("", DEFAULT_COMMAND_HOST_ALLOW_RULES);
		expect(match).toBeUndefined();
	});

	it("rejects structured git diff --ext-diff", () => {
		const match = findSafeRuleMatch(
			{ command: "git", args: ["diff", "--ext-diff"] },
			DEFAULT_COMMAND_HOST_ALLOW_RULES,
		);
		expect(match).toBeUndefined();
	});
});
