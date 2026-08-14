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
