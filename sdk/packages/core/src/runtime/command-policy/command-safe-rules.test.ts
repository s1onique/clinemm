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

	it("find: predicate-only / stdout-only forms match (REVIEW STANDARD audit-cleared)", () => {
		// Per GNU findutils, find has stdout-only actions (-print, -print0,
		// -printf, -ls, -quit, -prune) and action-capable forms (-delete,
		// -exec, -execdir, -ok, -okdir, -fls, -fprint, -fprint0, -fprintf).
		// We enumerate ONLY the stdout-only + pure-predicate forms here.
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
			"find . -name *.ts",
			"find . -iname *.ts",
			"find . -path */node_modules/*",
			"find . -ipath */FOO/*",
			"find . -regex .*\\.ts$",
			"find . -iregex .*\\.ts$",
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
			"find . -type d -name command-risk* -not -path ./node_modules/*",
			"find . -type f -name *.ts -not -path */node_modules/*",
			"find . -type f -size +1M -maxdepth 3",
			"find /tmp -type f -mtime +7 -name *.log",
		]) {
			const m = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(m?.source).toBe("host_safe_find");
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
