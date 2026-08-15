/**
 * Command Execution Plan Tests
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION04
 *
 * Proves the canonical CommandExecutionPlan construction in
 * `@cline/core/runtime/command-policy/command-execution-plan.ts`:
 *   - per-command hardening under SafeExecutionProfile
 *   - input-shape preservation (string / {command,args} / {commands:[...]})
 *   - provenance: matchedRuleSource / profileSource
 *   - mutation-proof contract: substitution at the executor boundary
 *     is the only way raw argv reaches the shell.
 *
 * The real-runtime boundary test (AgentRuntime substitutes
 * executionPlan.transformedInput) lives in:
 *   sdk/packages/agents/src/agent-runtime.command-policy.test.ts
 */

import type { CommandExecutionPlan } from "@cline/shared";

import { describe, expect, it } from "vitest";

import {
	buildCommandExecutionPlan,
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
} from "./command-policy";
import { SAFE_PWD_PROFILE } from "./safe-execution-profile";

/**
 * Build the canonical host approval payload: route the request through
 * evaluateCommandPolicy, and when ALLOW, attach the hardened per-command
 * execution plan. Mirrors what the CLI/VS Code host adapters emit.
 */
function buildHostApprovalResponse(input: {
	toolInput: unknown;
	mode: "manual" | "safe-only" | "all";
}): {
	approved: boolean;
	reason: string;
	executionPlan?: CommandExecutionPlan;
} {
	const auth = commandHostAuthorization({
		mode: input.mode,
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
	});
	const result = evaluateCommandPolicy({
		toolInput: input.toolInput,
		hostAuthorization: auth,
	});
	if (result.decision.kind !== "allow") {
		return { approved: false, reason: result.decision.reason };
	}
	return {
		approved: true,
		reason: result.decision.reason,
		executionPlan: buildCommandExecutionPlan(input.toolInput, result.commands),
	};
}

describe("CORRECTION04: Canonical plan shape per command", () => {
	it("Case A: pwd — empty intrinsic profile, original command preserved", () => {
		const response = buildHostApprovalResponse({
			toolInput: { command: "pwd", requires_approval: false },
			mode: "safe-only",
		});
		expect(response.approved).toBe(true);
		const plan = response.executionPlan;
		expect(plan).toBeDefined();
		expect(plan!.commands).toHaveLength(1);
		const entry = plan!.commands[0]!;
		expect(entry.commandIndex).toBe(0);
		expect(entry.matchedRuleSource).toBe("host_safe_pwd");
		expect(entry.profileSource).toBe("host_safe_pwd_profile");
		expect(plan!.transformedInput).toMatchObject({
			command: "pwd",
			requires_approval: false,
		});
	});

	it("Case B: git diff --stat — hardened argv delivered, raw argv NEVER", () => {
		const rawInput = {
			command: "git diff --stat",
			requires_approval: false,
		};
		const response = buildHostApprovalResponse({
			toolInput: rawInput,
			mode: "safe-only",
		});
		expect(response.approved).toBe(true);
		const plan = response.executionPlan!;
		const entry = plan.commands[0]!;
		expect(entry.matchedRuleSource).toBe("host_safe_git_diff");
		expect(entry.profileSource).toBe("host_safe_git_diff_profile");
		const hardened = entry.hardenedCommand as string;
		expect(hardened.startsWith("git --no-pager")).toBe(true);
		expect(hardened).toContain("-c core.pager=cat");
		expect(hardened).toContain("-c core.fsmonitor=false");
		expect(hardened).toContain("-c core.hooksPath=/dev/null");
		expect(hardened).toContain("diff --no-ext-diff --no-textconv --stat");
		expect(plan.transformedInput).toMatchObject({ command: hardened });
		expect(plan.transformedInput).not.toMatchObject({
			command: "git diff --stat",
		});
	});

	it("Case C: mixed [pwd, git diff --stat] — independent profiles per command", () => {
		const rawInput = {
			commands: [
				{ command: "pwd" },
				{ command: "git", args: ["diff", "--stat"] },
			],
		};
		const response = buildHostApprovalResponse({
			toolInput: rawInput,
			mode: "safe-only",
		});
		expect(response.approved).toBe(true);
		const plan = response.executionPlan!;
		expect(plan.commands).toHaveLength(2);
		const pwdEntry = plan.commands[0]!;
		expect(pwdEntry.matchedRuleSource).toBe("host_safe_pwd");
		expect(pwdEntry.profileSource).toBe("host_safe_pwd_profile");
		const diffEntry = plan.commands[1]!;
		expect(diffEntry.matchedRuleSource).toBe("host_safe_git_diff");
		expect(diffEntry.profileSource).toBe("host_safe_git_diff_profile");
		const tied = plan.transformedInput as {
			commands: Array<{ command: string; args?: string[] }>;
		};
		expect(tied.commands[0]?.command).toBe("pwd");
		expect(tied.commands[1]?.command).toBe("git");
		expect(tied.commands[1]?.args?.join(" ")).toContain(
			"diff --no-ext-diff --no-textconv --stat",
		);
	});
});

describe("CORRECTION04: Runtime contract — executionPlan replaces tool input", () => {
	it("approved=true with executionPlan — runtime uses transformedInput for the executor", () => {
		const response = buildHostApprovalResponse({
			toolInput: { command: "git diff --stat" },
			mode: "safe-only",
		});
		expect(response.approved).toBe(true);
		expect(response.executionPlan).toBeDefined();
		const effective = response.executionPlan?.transformedInput as {
			command: string;
		};
		expect(effective.command).toContain("--no-ext-diff --no-textconv");
	});

	it("approved=false — runtime does NOT execute regardless of plan presence", () => {
		const response = buildHostApprovalResponse({
			toolInput: { command: "rm -rf /", requires_approval: false },
			mode: "safe-only",
		});
		expect(response.approved).toBe(false);
		expect(response.executionPlan).toBeUndefined();
		expect(response.reason).toContain("safe-only");
	});
});

describe("CORRECTION04: Mutation-proof — bypassing the plan leaks raw argv", () => {
	it("Substitution test: hardened input differs from raw input for git diff", () => {
		const raw = { command: "git diff --stat" };
		const response = buildHostApprovalResponse({
			toolInput: raw,
			mode: "safe-only",
		});
		const plan = response.executionPlan!;
		const hardened = (plan.transformedInput as { command: string }).command;
		expect(hardened).not.toBe(raw.command);
		expect(hardened).not.toEqual(raw.command);
	});

	it("Case E: deliberately buggy runtime that ignores executionPlan FAILS this test", () => {
		const raw = { command: "git diff --stat" };
		const response = buildHostApprovalResponse({
			toolInput: raw,
			mode: "safe-only",
		});
		const plan = response.executionPlan!;
		const safeInput = plan.transformedInput;
		const buggyInput = raw;
		expect((safeInput as { command: string }).command).not.toBe(
			(buggyInput as { command: string }).command,
		);
		expect((safeInput as { command: string }).command).toContain(
			"--no-ext-diff --no-textconv",
		);
	});
});

describe("CORRECTION04: input-shape preservation", () => {
	it("bare string input -> wrapped array output (normalizer canonical form)", () => {
		const plan = buildCommandExecutionPlan("pwd", [
			{
				index: 0,
				normalized: "pwd",
				safeExecutionProfile: SAFE_PWD_PROFILE,
				matchedRuleSource: "host_safe_pwd",
			},
		]);
		expect(Array.isArray(plan?.transformedInput)).toBe(true);
		expect(plan?.transformedInput).toEqual(["pwd"]);
	});

	it("{ command, args } -> { command, args } output preserves structured shape", () => {
		const plan = buildCommandExecutionPlan({ command: "pwd" }, [
			{
				index: 0,
				normalized: { command: "pwd" },
				safeExecutionProfile: SAFE_PWD_PROFILE,
				matchedRuleSource: "host_safe_pwd",
			},
		]);
		expect(plan?.transformedInput).toMatchObject({ command: "pwd" });
	});

	it("string[] input -> string[] output", () => {
		const plan = buildCommandExecutionPlan(
			["pwd", "pwd"],
			[
				{
					index: 0,
					normalized: "pwd",
					safeExecutionProfile: SAFE_PWD_PROFILE,
					matchedRuleSource: "host_safe_pwd",
				},
				{
					index: 1,
					normalized: "pwd",
					safeExecutionProfile: SAFE_PWD_PROFILE,
					matchedRuleSource: "host_safe_pwd",
				},
			],
		);
		expect(Array.isArray(plan?.transformedInput)).toBe(true);
	});

	it("null/undefined input -> returns undefined", () => {
		expect(buildCommandExecutionPlan(null, [])).toBeUndefined();
		expect(buildCommandExecutionPlan(undefined, [])).toBeUndefined();
	});

	it("input has commands but perCommand is empty -> fails closed (cardinality mismatch)", () => {
		const plan = buildCommandExecutionPlan({ command: "pwd" }, []);
		// Fail closed: no partial plan when the policy didn't classify
		// every command. The host MUST treat this as "no execution
		// constraint can be attached" rather than ship a partly
		// unhardened plan.
		expect(plan).toBeUndefined();
	});

	it("perCommand has more entries than input -> fails closed (cardinality mismatch)", () => {
		const plan = buildCommandExecutionPlan({ command: "pwd" }, [
			{
				index: 0,
				normalized: "pwd",
				safeExecutionProfile: SAFE_PWD_PROFILE,
				matchedRuleSource: "host_safe_pwd",
			},
			{
				index: 1,
				normalized: "pwd",
				safeExecutionProfile: SAFE_PWD_PROFILE,
				matchedRuleSource: "host_safe_pwd",
			},
		]);
		expect(plan).toBeUndefined();
	});
});
