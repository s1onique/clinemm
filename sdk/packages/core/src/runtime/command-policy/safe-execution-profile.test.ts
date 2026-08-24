/**
 * Safe Execution Profile Unit Tests
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION04
 *
 * Proves the per-subcommand profile shapes and the rewriter's
 * token-position contract.
 *
 * PROFILE_REWRITER_INPUT_DOMAIN = only commands already positively
 * accepted by DEFAULT_COMMAND_HOST_ALLOW_RULES. The rewriter performs
 * minimal whitespace tokenization; structured `{command, args}` input
 * is preferred and never round-trips through render→split→reconstruct.
 */

import { describe, expect, it } from "vitest";

import {
	applySafeExecutionProfileToCommand,
	getSafeExecutionProfileForSource,
	SAFE_CAT_PROFILE,
	SAFE_ECHO_PROFILE,
	SAFE_FIND_PROFILE,
	SAFE_GIT_BRANCH_PROFILE,
	SAFE_GIT_DIFF_PROFILE,
	SAFE_GIT_LOG_PROFILE,
	SAFE_GIT_REMOTE_PROFILE,
	SAFE_GIT_STATUS_PROFILE,
	SAFE_HEAD_PATH_PROFILE,
	SAFE_LS_PROFILE,
	SAFE_PWD_PROFILE,
	SAFE_TAIL_PATH_PROFILE,
} from "./safe-execution-profile";

describe("Safe Execution Profiles — per-subcommand shape", () => {
	it("SAFE_PWD_PROFILE is empty (intrinsic, no overlay)", () => {
		expect(SAFE_PWD_PROFILE.kind).toBe("pwd");
		expect(SAFE_PWD_PROFILE.commandPrefix).toHaveLength(0);
		expect(SAFE_PWD_PROFILE.commandSuffix).toHaveLength(0);
	});

	it("SAFE_GIT_STATUS_PROFILE has the documented prefix and no suffix", () => {
		expect(SAFE_GIT_STATUS_PROFILE.kind).toBe("git_observational");
		expect(SAFE_GIT_STATUS_PROFILE.commandSuffix).toHaveLength(0);
		expect(SAFE_GIT_STATUS_PROFILE.commandPrefix).toEqual([
			"--no-pager",
			"-c",
			"core.pager=cat",
			"-c",
			"core.fsmonitor=false",
			"-c",
			"core.hooksPath=/dev/null",
		]);
	});

	it("SAFE_GIT_DIFF_PROFILE has the documented prefix and --no-ext-diff/--no-textconv suffix", () => {
		expect(SAFE_GIT_DIFF_PROFILE.kind).toBe("git_observational");
		expect(SAFE_GIT_DIFF_PROFILE.commandSuffix).toEqual([
			"--no-ext-diff",
			"--no-textconv",
		]);
		expect(SAFE_GIT_DIFF_PROFILE.commandPrefix).toEqual([
			"--no-pager",
			"-c",
			"core.pager=cat",
			"-c",
			"core.fsmonitor=false",
			"-c",
			"core.hooksPath=/dev/null",
		]);
	});

	it("SAFE_GIT_LOG_PROFILE has the documented prefix and --no-ext-diff/--no-textconv suffix", () => {
		expect(SAFE_GIT_LOG_PROFILE.kind).toBe("git_observational");
		expect(SAFE_GIT_LOG_PROFILE.commandSuffix).toEqual([
			"--no-ext-diff",
			"--no-textconv",
		]);
		expect(SAFE_GIT_LOG_PROFILE.commandPrefix).toEqual([
			"--no-pager",
			"-c",
			"core.pager=cat",
			"-c",
			"core.fsmonitor=false",
			"-c",
			"core.hooksPath=/dev/null",
		]);
	});

	it("getSafeExecutionProfileForSource maps every host_safe_*_profile source", () => {
		expect(getSafeExecutionProfileForSource("host_safe_pwd")).toBe(
			SAFE_PWD_PROFILE,
		);
		expect(getSafeExecutionProfileForSource("host_safe_git_status")).toBe(
			SAFE_GIT_STATUS_PROFILE,
		);
		expect(getSafeExecutionProfileForSource("host_safe_git_diff")).toBe(
			SAFE_GIT_DIFF_PROFILE,
		);
		expect(getSafeExecutionProfileForSource("host_safe_git_log")).toBe(
			SAFE_GIT_LOG_PROFILE,
		);
		// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01
		expect(getSafeExecutionProfileForSource("host_safe_ls")).toBe(
			SAFE_LS_PROFILE,
		);
		expect(getSafeExecutionProfileForSource("host_safe_find")).toBe(
			SAFE_FIND_PROFILE,
		);
		expect(getSafeExecutionProfileForSource("host_safe_cat")).toBe(
			SAFE_CAT_PROFILE,
		);
		expect(getSafeExecutionProfileForSource("host_safe_head_path")).toBe(
			SAFE_HEAD_PATH_PROFILE,
		);
		expect(getSafeExecutionProfileForSource("host_safe_tail_path")).toBe(
			SAFE_TAIL_PATH_PROFILE,
		);
		expect(
			getSafeExecutionProfileForSource("host_safe_unknown"),
		).toBeUndefined();
	});
});

describe("applySafeExecutionProfileToCommand — token positions", () => {
	it("string argv: pwd -> pwd unchanged (empty profile)", () => {
		const out = applySafeExecutionProfileToCommand("pwd", SAFE_PWD_PROFILE);
		expect(out).toBe("pwd");
	});

	it("string argv: git diff --stat inserts prefix between git and diff, suffix after diff", () => {
		const out = applySafeExecutionProfileToCommand(
			"git diff --stat",
			SAFE_GIT_DIFF_PROFILE,
		) as string;
		const tokens = out.split(/\s+/u);
		const prefixLen = SAFE_GIT_DIFF_PROFILE.commandPrefix.length; // 8
		const suffixLen = SAFE_GIT_DIFF_PROFILE.commandSuffix.length; // 2
		// Layout:
		//   tokens[0] = "git"
		//   tokens[1..1+prefixLen] = prefix
		//   tokens[1+prefixLen] = subcommand "diff"
		//   tokens[2+prefixLen..2+prefixLen+suffixLen] = suffix
		//   tokens[2+prefixLen+suffixLen..] = existing args
		expect(tokens[0]).toBe("git");
		expect(tokens[1]).toBe(SAFE_GIT_DIFF_PROFILE.commandPrefix[0]); // --no-pager
		expect(tokens[1 + prefixLen - 1]).toBe(
			SAFE_GIT_DIFF_PROFILE.commandPrefix[prefixLen - 1],
		); // last prefix token
		expect(tokens[1 + prefixLen]).toBe("diff"); // subcommand
		expect(tokens[2 + prefixLen]).toBe("--no-ext-diff");
		expect(tokens[3 + prefixLen]).toBe("--no-textconv");
		// Existing args preserved after suffix:
		expect(tokens[2 + prefixLen + suffixLen]).toBe("--stat");
	});

	it("structured argv: {command:'git', args:[...]} is hardened without round-tripping through render->split", () => {
		const out = applySafeExecutionProfileToCommand(
			{ command: "git", args: ["diff", "--stat"] },
			SAFE_GIT_DIFF_PROFILE,
		) as { command: string; args: string[] };
		expect(out.command).toBe("git");
		expect(out.args[0]).toBe("--no-pager");
		expect(out.args).toContain("diff");
		expect(out.args).toContain("--no-ext-diff");
		expect(out.args).toContain("--no-textconv");
		expect(out.args).toContain("--stat");
		// Layout (in args):
		//   args[0..prefixLen] = prefix
		//   args[prefixLen] = subcommand "diff"
		//   args[prefixLen+1..prefixLen+1+suffixLen] = suffix
		//   args[prefixLen+1+suffixLen..] = existing args
		const prefixLen = SAFE_GIT_DIFF_PROFILE.commandPrefix.length;
		const suffixLen = SAFE_GIT_DIFF_PROFILE.commandSuffix.length;
		expect(out.args.indexOf("diff")).toBe(prefixLen);
		expect(out.args[prefixLen + 1]).toBe("--no-ext-diff");
		expect(out.args[prefixLen + 2]).toBe("--no-textconv");
		expect(out.args[prefixLen + 1 + suffixLen]).toBe("--stat");
	});

	it("unknown git subcommand (git weird) is still hardened (caller must match subcommand to profile)", () => {
		// The PROFILE_REWRITER_INPUT_DOMAIN contract says only safe-rule-matched
		// commands reach the rewriter. The rewriter itself is not responsible
		// for subcommand safety classification — that's the policy layer's job.
		// When the policy layer passes an unknown git subcommand to the
		// rewriter (caller bug), the rewriter still applies the prefix/suffix
		// rather than silently dropping them.
		const out = applySafeExecutionProfileToCommand(
			"git weird --arg",
			SAFE_GIT_DIFF_PROFILE,
		) as string;
		// Prefix is inserted between git and weird.
		expect(out).toContain("git --no-pager");
		expect(out).toContain("weird");
		// Suffix sits right after weird.
		expect(out).toContain("weird --no-ext-diff --no-textconv");
		// Original --arg preserved at the end.
		expect(out.endsWith("--arg")).toBe(true);
	});

	it("git status: prefix inserted, no suffix (status is porcelain)", () => {
		const out = applySafeExecutionProfileToCommand(
			"git status --short",
			SAFE_GIT_STATUS_PROFILE,
		) as string;
		const tokens = out.split(/\s+/u);
		const prefixLen = SAFE_GIT_STATUS_PROFILE.commandPrefix.length;
		expect(tokens[0]).toBe("git");
		expect(tokens[1 + prefixLen]).toBe("status");
		// Suffix MUST be empty for git status; --no-ext-diff / --no-textconv
		// would be invalid for `git status` and would NOT appear.
		expect(out).not.toContain("--no-ext-diff");
		expect(out).not.toContain("--no-textconv");
		// Existing args preserved:
		expect(tokens[2 + prefixLen]).toBe("--short");
	});

	it("git log: prefix + --no-ext-diff/--no-textconv suffix", () => {
		const out = applySafeExecutionProfileToCommand(
			"git log --oneline -5",
			SAFE_GIT_LOG_PROFILE,
		) as string;
		expect(out).toContain("--no-ext-diff");
		expect(out).toContain("--no-textconv");
		expect(out).toContain("log");
		expect(out).toContain("--oneline");
		expect(out).toContain("-5");
	});

	it("git branch: hardening prefix only, NO diff-family suffix", () => {
		const out = applySafeExecutionProfileToCommand(
			"git branch --show-current",
			SAFE_GIT_BRANCH_PROFILE,
		) as string;
		// Hardening prefix must be applied.
		expect(out).toContain("--no-pager");
		expect(out).toContain("core.pager=cat");
		expect(out).toContain("core.fsmonitor=false");
		expect(out).toContain("core.hooksPath=/dev/null");
		// Diff-family suffix MUST NOT appear for git branch: --no-ext-diff
		// and --no-textconv are diff-family options, not branch-list
		// options. git-branch(1) does not consume them.
		expect(out).not.toContain("--no-ext-diff");
		expect(out).not.toContain("--no-textconv");
	});

	it("getSafeExecutionProfileForSource returns SAFE_GIT_BRANCH_PROFILE for host_safe_git_branch", () => {
		expect(getSafeExecutionProfileForSource("host_safe_git_branch")).toBe(
			SAFE_GIT_BRANCH_PROFILE,
		);
	});

	it("SAFE_GIT_REMOTE_PROFILE has the documented prefix and no suffix", () => {
		expect(SAFE_GIT_REMOTE_PROFILE.kind).toBe("git_observational");
		expect(SAFE_GIT_REMOTE_PROFILE.commandSuffix).toHaveLength(0);
		expect(SAFE_GIT_REMOTE_PROFILE.commandPrefix).toEqual([
			"--no-pager",
			"-c",
			"core.pager=cat",
			"-c",
			"core.fsmonitor=false",
			"-c",
			"core.hooksPath=/dev/null",
		]);
	});

	it("git remote: hardening prefix only, NO diff-family suffix", () => {
		const out = applySafeExecutionProfileToCommand(
			"git remote -v",
			SAFE_GIT_REMOTE_PROFILE,
		) as string;
		expect(out).toContain("--no-pager");
		expect(out).toContain("core.pager=cat");
		expect(out).toContain("core.fsmonitor=false");
		expect(out).toContain("core.hooksPath=/dev/null");
		expect(out).toContain("git");
		expect(out).toContain("remote");
		expect(out).toContain("-v");
		// Diff-family suffix MUST NOT appear for git remote.
		expect(out).not.toContain("--no-ext-diff");
		expect(out).not.toContain("--no-textconv");
	});

	it("getSafeExecutionProfileForSource returns SAFE_GIT_REMOTE_PROFILE for host_safe_git_remote", () => {
		expect(getSafeExecutionProfileForSource("host_safe_git_remote")).toBe(
			SAFE_GIT_REMOTE_PROFILE,
		);
	});

	it("SAFE_ECHO_PROFILE is empty (intrinsic, no overlay)", () => {
		expect(SAFE_ECHO_PROFILE.kind).toBe("pwd");
		expect(SAFE_ECHO_PROFILE.commandPrefix).toHaveLength(0);
		expect(SAFE_ECHO_PROFILE.commandSuffix).toHaveLength(0);
	});

	it("echo: intrinsic profile (no overlay); git-family hardening would BREAK echo", () => {
		const out = applySafeExecutionProfileToCommand(
			"echo '---BRANCH---'",
			SAFE_ECHO_PROFILE,
		) as string;
		// echo is intrinsic and takes no overlay.
		expect(out).toBe("echo '---BRANCH---'");
		// The git-family hardening flags would be interpreted by echo as
		// text to print, breaking the command's semantics. They MUST NOT
		// be applied.
		expect(out).not.toContain("--no-pager");
		expect(out).not.toContain("core.pager=cat");
		expect(out).not.toContain("core.hooksPath=/dev/null");
	});

	it("getSafeExecutionProfileForSource returns SAFE_ECHO_PROFILE for host_safe_echo", () => {
		expect(getSafeExecutionProfileForSource("host_safe_echo")).toBe(
			SAFE_ECHO_PROFILE,
		);
	});

	it("ls: intrinsic profile (no overlay); git-family hardening would BREAK ls", () => {
		const out = applySafeExecutionProfileToCommand(
			"ls -la /etc",
			SAFE_LS_PROFILE,
		) as string;
		// ls is intrinsically read-only; the profile applies NO overlay.
		// The git-family hardening flags (-c core.*, core.hooksPath=/dev/null)
		// are git-specific and would BREAK ls if applied (ls has no -c
		// option that takes core.* config); the profile description
		// documents this non-application.
		expect(out).toBe("ls -la /etc");
		expect(out).not.toContain("core.pager=cat");
		expect(out).not.toContain("core.hooksPath=/dev/null");
		expect(out).not.toContain("--no-ext-diff");
	});

	it("find: intrinsic profile (no overlay); git-family hardening would BREAK find's arg parser", () => {
		const out = applySafeExecutionProfileToCommand(
			"find . -type f -name *.ts",
			SAFE_FIND_PROFILE,
		) as string;
		// find is intrinsically read-only when invoked with stdout-only
		// actions; the profile applies NO overlay. The git-family
		// hardening flags would BREAK find's argument parsing (they
		// would be interpreted as starting paths).
		expect(out).toBe("find . -type f -name *.ts");
		expect(out).not.toContain("core.pager=cat");
		expect(out).not.toContain("core.hooksPath=/dev/null");
	});

	it("getSafeExecutionProfileForSource returns SAFE_LS_PROFILE for host_safe_ls", () => {
		expect(getSafeExecutionProfileForSource("host_safe_ls")).toBe(
			SAFE_LS_PROFILE,
		);
	});

	it("getSafeExecutionProfileForSource returns SAFE_FIND_PROFILE for host_safe_find", () => {
		expect(getSafeExecutionProfileForSource("host_safe_find")).toBe(
			SAFE_FIND_PROFILE,
		);
	});
});

describe("applySafeExecutionProfileToCommand — domain restriction", () => {
	// PROFILE_REWRITER_INPUT_DOMAIN contract.
	it("REWRITER_INPUT_DOMAIN: only rewrites inputs already positively accepted by host_safe_*", () => {
		// Forbid: opaque shell composition. The rewriter MUST NOT touch
		// "pwd; rm -rf /" — that input never reaches the rewriter because
		// the canonical safe rules reject it before profile application.
		const out = applySafeExecutionProfileToCommand(
			"pwd; rm -rf /",
			SAFE_GIT_DIFF_PROFILE,
		);
		expect(out).toBe("pwd; rm -rf /");
	});

	it("non-git commands (e.g. rm) bypass the rewriter", () => {
		const out = applySafeExecutionProfileToCommand(
			"rm -rf /",
			SAFE_GIT_DIFF_PROFILE,
		);
		// The policy never matches rm, but the rewriter is defensive:
		// non-git inputs are returned unchanged.
		expect(out).toBe("rm -rf /");
	});
});

describe("applySafeExecutionProfileToCommand — structured argv boundary preservation", () => {
	it("structured argv with args containing spaces is preserved (no render/split round-trip)", () => {
		const out = applySafeExecutionProfileToCommand(
			{
				command: "git",
				args: ["diff", "a path with spaces", "another file.txt"],
			},
			SAFE_GIT_DIFF_PROFILE,
		) as { command: string; args: string[] };
		expect(out.command).toBe("git");
		// Prefix:
		expect(out.args[0]).toBe("--no-pager");
		expect(out.args).toContain("-c");
		expect(out.args).toContain("core.pager=cat");
		expect(out.args).toContain("-c");
		expect(out.args).toContain("core.fsmonitor=false");
		expect(out.args).toContain("-c");
		expect(out.args).toContain("core.hooksPath=/dev/null");
		// Subcommand:
		expect(out.args).toContain("diff");
		// Suffix:
		expect(out.args).toContain("--no-ext-diff");
		expect(out.args).toContain("--no-textconv");
		// Original args preserved verbatim — args with spaces stay intact.
		expect(out.args).toContain("a path with spaces");
		expect(out.args).toContain("another file.txt");
		// Count: prefix (7 tokens) + diff + --no-ext-diff + --no-textconv +
		// 2 originals = 12.
		expect(out.args.length).toBe(7 + 1 + 2 + 2);
	});
});
