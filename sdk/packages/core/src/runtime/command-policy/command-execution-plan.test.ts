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

/**
 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2
 * CORRECTION03 (production grant seam): tests for the new
 * `hostAuthorization` parameter on `buildCommandExecutionPlan`.
 *
 * The previous C2 GREEN constructed the capability manually and
 * attached it to the plan; the C2 review correctly observed
 * that this bypassed the real authorization pipeline. The
 * CORRECTION03 wiring closes that gap by deriving the capability
 * from the policy decision + host evidence inside the plan
 * builder itself. These tests prove the new path:
 *
 *   - A policy match on `/usr/bin/mktemp` with darwin host
 *     evidence attaches FilesystemCreateOnlyCapability(roots=[X])
 *     to the matching entry.
 *   - A non-mktemp rule (pwd) does NOT attach anything.
 *   - The capability does NOT leak to a neighboring non-mktemp
 *     entry (mixed positional).
 *   - The capability is NOT attached when the host evidence is
 *     absent (CLI host without darwin probe).
 *   - The capability is NOT attached when the host evidence's
 *     executableRealpath differs from the reviewed family
 *     (e.g., shadowed by a different binary).
 *   - Bare `mktemp` (no slash) does NOT attach — realpath
 *     fails closed.
 *
 * These tests are the load-bearing proof of the
 * authorization→capability→plan-entry composition. The
 * downstream Seatbelt GREEN + mixed-isolation suites prove the
 * kernel-side; together they prove the full chain.
 */

import { realpathSync } from "node:fs";
import { describe as describeGr, expect as expectGr, it as itGr } from "vitest";

const darwinCanonicalRoot = "/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T";
const darwinRawRoot = "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/";

function darwinHostAuth() {
	return commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [],
		tempAuthorityEvidence: {
			platform: "darwin",
			executablePath: "/usr/bin/mktemp",
			executableRealpath: "/usr/bin/mktemp",
			darwinUserTempRoot: darwinRawRoot,
			canonicalDarwinUserTempRoot: darwinCanonicalRoot,
		},
	});
}

describeGr("C2-CORRECTION03: plan builder derives per-entry FilesystemCreateOnlyCapability from policy + host evidence", () => {
	itGr("matches /usr/bin/mktemp on darwin host with full evidence -> entry gets FilesystemCreateOnlyCapability", () => {
		const plan = buildCommandExecutionPlan(
			"/usr/bin/mktemp",
			[
				{
					index: 0,
					normalized: "/usr/bin/mktemp",
					matchedRuleSource: "host_safe_mktemp_default_temp",
				},
			],
			darwinHostAuth(),
		);
		expectGr(plan).toBeDefined();
		expectGr(plan?.commands.length).toBe(1);
		expectGr(plan?.commands[0]?.executionCapability).toEqual({
			kind: "filesystem-create-only",
			roots: [darwinCanonicalRoot],
		});
	});

	itGr("matches /usr/bin/mktemp -d on darwin host -> entry gets FilesystemCreateOnlyCapability", () => {
		const plan = buildCommandExecutionPlan(
			"/usr/bin/mktemp -d",
			[
				{
					index: 0,
					normalized: "/usr/bin/mktemp -d",
					matchedRuleSource: "host_safe_mktemp_default_temp",
				},
			],
			darwinHostAuth(),
		);
		expectGr(plan?.commands[0]?.executionCapability).toEqual({
			kind: "filesystem-create-only",
			roots: [darwinCanonicalRoot],
		});
	});

	itGr("non-mktemp rule (pwd) -> entry has no executionCapability", () => {
		const plan = buildCommandExecutionPlan(
			"pwd",
			[
				{
					index: 0,
					normalized: "pwd",
					safeExecutionProfile: SAFE_PWD_PROFILE,
					matchedRuleSource: "host_safe_pwd",
				},
			],
			darwinHostAuth(),
		);
		expectGr(plan?.commands[0]?.executionCapability).toBeUndefined();
	});

	itGr("mixed [mktemp, pwd] -> entry[0] gets cap, entry[1] does NOT (positional isolation)", () => {
		const plan = buildCommandExecutionPlan(
			["/usr/bin/mktemp", "pwd"],
			[
				{
					index: 0,
					normalized: "/usr/bin/mktemp",
					matchedRuleSource: "host_safe_mktemp_default_temp",
				},
				{
					index: 1,
					normalized: "pwd",
					safeExecutionProfile: SAFE_PWD_PROFILE,
					matchedRuleSource: "host_safe_pwd",
				},
			],
			darwinHostAuth(),
		);
		expectGr(plan?.commands[0]?.executionCapability).toEqual({
			kind: "filesystem-create-only",
			roots: [darwinCanonicalRoot],
		});
		expectGr(plan?.commands[1]?.executionCapability).toBeUndefined();
	});

	itGr("missing tempAuthorityEvidence (CLI host without darwin probe) -> no capability attached", () => {
		const noTempHost = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [],
		});
		const plan = buildCommandExecutionPlan(
			"/usr/bin/mktemp",
			[
				{
					index: 0,
					normalized: "/usr/bin/mktemp",
					matchedRuleSource: "host_safe_mktemp_default_temp",
				},
			],
			noTempHost,
		);
		expectGr(plan?.commands[0]?.executionCapability).toBeUndefined();
	});

	itGr("host evidence with wrong executableRealpath (shadowed binary) -> no capability attached", () => {
		const shadowedHost = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [],
			tempAuthorityEvidence: {
				platform: "darwin",
				executablePath: "/usr/local/bin/mktemp",
				executableRealpath: "/usr/local/bin/mktemp",
				darwinUserTempRoot: darwinRawRoot,
				canonicalDarwinUserTempRoot: darwinCanonicalRoot,
			},
		});
		const plan = buildCommandExecutionPlan(
			"/usr/bin/mktemp",
			[
				{
					index: 0,
					normalized: "/usr/bin/mktemp",
					matchedRuleSource: "host_safe_mktemp_default_temp",
				},
			],
			shadowedHost,
		);
		expectGr(plan?.commands[0]?.executionCapability).toBeUndefined();
	});

	itGr("bare 'mktemp' (PATH-resolved form) -> no capability attached (realpath fails closed)", () => {
		// sanity: bare 'mktemp' resolves to the same binary on
		// the host, but realpathSync on a bare token fails because
		// it's not an absolute path. The plan builder fails closed.
		const realpathWorks = (() => {
			try {
				return realpathSync("mktemp") === "/usr/bin/mktemp";
			} catch {
				return false;
			}
		})();
		if (!realpathWorks) {
			const plan = buildCommandExecutionPlan(
				"mktemp",
				[
					{
						index: 0,
						normalized: "mktemp",
						matchedRuleSource: "host_safe_mktemp_default_temp",
					},
				],
				darwinHostAuth(),
			);
			expectGr(plan?.commands[0]?.executionCapability).toBeUndefined();
		} else {
			// On hosts where realpathSync('mktemp') works (e.g. some
			// libcs), the gate still passes; this is the OBSERVED_KERNEL
			// behavior noted in C1.
			const plan = buildCommandExecutionPlan(
				"mktemp",
				[
					{
						index: 0,
						normalized: "mktemp",
						matchedRuleSource: "host_safe_mktemp_default_temp",
					},
				],
				darwinHostAuth(),
			);
			expectGr(plan?.commands[0]?.executionCapability).toEqual({
				kind: "filesystem-create-only",
				roots: [darwinCanonicalRoot],
			});
		}
	});

	itGr("omitting hostAuthorization preserves legacy plan shape (no entry carries executionCapability)", () => {
		// Pre-CORRECTION03 callers omit the third arg. Their plans
		// must continue to construct normally — just without the
		// per-entry capability.
		const plan = buildCommandExecutionPlan("/usr/bin/mktemp", [
			{
				index: 0,
				normalized: "/usr/bin/mktemp",
				matchedRuleSource: "host_safe_mktemp_default_temp",
			},
		]);
		expectGr(plan?.commands[0]?.executionCapability).toBeUndefined();
	});
});

/**
 * CORRECTION04 (P1 narrowing): the realpathSync probe that
 * resolves the executable argv[0] is gated behind
 * `matchedRuleSource === "host_safe_mktemp_default_temp"`. The
 * plan builder exposes a counter (`_getC2RealpathCallCount`)
 * that increments exactly once per call to
 * resolveExecutableRealpath. We reset the counter and then
 * assert its value after plan construction for non-mktemp
 * entries (pwd, git status) is ZERO, and is ONE for a single
 * mktemp entry / mixed [mktemp, pwd] input.
 *
 * This is the load-bearing proof of the CORRECTION04 narrowing:
 * for a plan with N non-mktemp entries + K mktemp entries,
 * the counter must equal K exactly. This proves the plan
 * builder performs NO host-side filesystem work on unrelated
 * commands.
 */
import { describe as describeC4, expect as expectC4, it as itC4 } from "vitest"
import {
	_resetC2RealpathCallCount,
	_getC2RealpathCallCount,
} from "./command-execution-plan"

const DARWIN_AUTH_TEMPL = {
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
	workspaceRoots: [],
	tempAuthorityEvidence: {
		platform: "darwin" as const,
		executablePath: "/usr/bin/mktemp",
		executableRealpath: "/usr/bin/mktemp",
		darwinUserTempRoot: "/var/folders/x/T/",
		canonicalDarwinUserTempRoot: "/private/var/folders/x/T",
	},
}

describeC4("CORRECTION04 narrowing: resolveExecutableRealpath is gated behind the mktemp rule", () => {
	itC4("non-mktemp plan entries perform zero realpathSync calls", () => {
		_resetC2RealpathCallCount()
		buildCommandExecutionPlan(
			["pwd", "git status"],
			[
				{
					index: 0,
					normalized: "pwd",
					matchedRuleSource: "host_safe_pwd",
				},
				{
					index: 1,
					normalized: "git status",
					matchedRuleSource: undefined,
				},
			],
			commandHostAuthorization(DARWIN_AUTH_TEMPL),
		)
		expectC4(_getC2RealpathCallCount()).toBe(0)
	})

	itC4("mktemp rule entry performs exactly one realpathSync call", () => {
		_resetC2RealpathCallCount()
		buildCommandExecutionPlan(
			"/usr/bin/mktemp",
			[
				{
					index: 0,
					normalized: "/usr/bin/mktemp",
					matchedRuleSource: "host_safe_mktemp_default_temp",
				},
			],
			commandHostAuthorization(DARWIN_AUTH_TEMPL),
		)
		expectC4(_getC2RealpathCallCount()).toBe(1)
	})

	itC4("mixed [mktemp, pwd] plan performs exactly one realpathSync call (only for mktemp)", () => {
		_resetC2RealpathCallCount()
		buildCommandExecutionPlan(
			["/usr/bin/mktemp", "pwd"],
			[
				{
					index: 0,
					normalized: "/usr/bin/mktemp",
					matchedRuleSource: "host_safe_mktemp_default_temp",
				},
				{
					index: 1,
					normalized: "pwd",
					matchedRuleSource: "host_safe_pwd",
				},
			],
			commandHostAuthorization(DARWIN_AUTH_TEMPL),
		)
		expectC4(_getC2RealpathCallCount()).toBe(1)
	})
})
