/**
 * Host-owned safe-rule engine tests.
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
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

describe("findSafeRuleMatch — positive matches", () => {
	const SAFE_CMDS = [
		"pwd",
		"pwd -L",
		"git status",
		"git status --short",
		"git status --branch",
		"git status -s",
		"git diff",
		"git diff --stat",
		"git diff --name-only",
		"git diff --cached --stat",
		"git log",
		"git log -n 5",
		"git log --oneline",
		"git log -n 5 --oneline",
		"git log --pretty=oneline -n 10",
	];

	for (const cmd of SAFE_CMDS) {
		it(`matches safe positive: "${cmd}"`, () => {
			const match = findSafeRuleMatch(cmd, DEFAULT_COMMAND_HOST_ALLOW_RULES);
			expect(match).toBeDefined();
			expect(match?.source).toMatch(/^host_safe_/);
		});
	}
});

describe("findSafeRuleMatch — adversarial negatives", () => {
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
});
