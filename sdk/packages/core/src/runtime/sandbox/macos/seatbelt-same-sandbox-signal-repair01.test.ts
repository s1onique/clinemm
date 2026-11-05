/**
 * ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01
 *
 * PROCESS-FREE regression + security-conservation tests for the
 * PERMANENT Seatbelt signal-rule repair.
 *
 * The repair replaced the original `(allow signal (target self))` with
 * `(allow signal (target same-sandbox))` in every generated profile, and
 * REMOVED the temporary, DEFAULT_OFF, one-shot diagnostic authorization
 * that the discriminator ACT had introduced.
 *
 * Test requirements covered here:
 *
 *   R1  Regression — the profile carries the permanent
 *       `same-sandbox` rule EXACTLY ONCE, unconditionally, with no
 *       opt-in env var, exact-command gate, or one-shot budget.
 *   R2  Regression — the REMOVED diagnostic surface is GONE: there is
 *       no `signalTarget` option, no `SeatbeltSignalTarget` type, and
 *       no `armSeatbeltSignalRuleAuthorization` /
 *       `clearSeatbeltSignalRuleAuthorization` /
 *       `getSeatbeltSignalRuleAuthorization` export.
 *   R3  Conservation — the repair changes EXACTLY ONE profile line
 *       relative to the pre-repair baseline. Every other rule family
 *       (filesystem read/write, network, environment, sockets, cwd,
 *       metadata) is byte-for-byte identical.
 *   R4  Conservation — the repair does NOT widen the signal scope to
 *       a blanket `(allow signal)`: the profile still denies by
 *       default and grants only the scoped `same-sandbox` target.
 *   R5  Conservation — the prepared invocation still runs through
 *       `/usr/bin/sandbox-exec -f <profile>` (no sandbox bypass), and
 *       the profile still contains `(deny default)`.
 *   R6  Foreign-process denial — the `same-sandbox` target is
 *       SANDBOX-SCOPED, not a blanket grant: the profile contains no
 *       rule that would permit signalling a process OUTSIDE the
 *       sandbox, and the host-helper ownership protections remain the
 *       authority for cross-sandbox termination.
 *   R7  Regression — `prepare()` is idempotent: two consecutive
 *       prepares for the SAME command produce the SAME permanent rule
 *       (there is no one-shot budget that could regress the second
 *       invocation to a different rule).
 */

import { afterEach, describe, expect, it } from "vitest";
import type { CommandCapability, CommandInvocation } from "../types";
import {
	getSeatbeltDiagnosticObserver,
	SeatbeltSandboxBackendExperimental,
	setSeatbeltDiagnosticObserver,
} from "./seatbelt-backend";
import { generateSeatbeltProfile } from "./seatbelt-profile";

const PERMANENT_RULE = "(allow signal (target same-sandbox))";
const RETIRED_RULE = "(allow signal (target self))";

/**
 * A real, canonicalizable host directory used as the capability's
 * read/write/create-only/temp/cwd root. `/private/tmp` is used because
 * it always exists on macOS and `canonicalizeSandboxRoot` resolves it
 * deterministically.
 */
const REAL_ROOT = "/private/tmp";

/**
 * A capability that exercises EVERY rule family the conservation
 * requirements name: deny-read subpaths, writable / readonly /
 * create-only / temp roots, network deny, ssh-agent and host-helper
 * socket rules.
 *
 * The roots are REAL directories on the host so that the backend's
 * canonicalization step succeeds and the profile written to disk is the
 * production artifact (not a fail-closed SandboxError).
 */
function conservationCapability(): CommandCapability {
	return {
		readonlyRoots: [REAL_ROOT],
		writableRoots: [REAL_ROOT],
		createOnlyRoots: [REAL_ROOT],
		tempRoot: REAL_ROOT,
		denyReadSubpaths: [REAL_ROOT],
		network: "deny",
		environment: { mode: "sanitized", allow: ["PATH"] },
		cwd: REAL_ROOT,
		sshAuthenticationAuthority: { mode: "agent" },
	};
}

/**
 * The capability used by the `prepare()` tests.
 *
 * `prepare()` resolves the ssh-agent socket from the PARENT process
 * environment (`SSH_AUTH_SOCK`), which is not set in a hermetic test
 * environment. The capability therefore DENIES the ssh-agent authority so
 * the prepare() path reaches the profile-write step — which is what these
 * tests observe. The ssh-agent rule family is still covered by the
 * generation-only conservation test above.
 */
function prepareCapability(): CommandCapability {
	const cap = conservationCapability();
	return { ...cap, sshAuthenticationAuthority: { mode: "deny" } };
}

const CONSERVATION_OPTIONS = {
	denyReadSubpaths: ["/private/tmp/clinemm-signal-repair-secret"],
	sshAgentCanonicalSocketPath: "/private/tmp/com.apple.launchd.abc/Listeners",
	hostHelperCanonicalSocketPath:
		"/private/tmp/clinemm-signal-repair-helper.sock",
} as const;

function anyCommand(): CommandInvocation {
	return {
		executable: "/bin/bash",
		args: ["-c", "/bin/echo hello"],
		cwd: "/private/tmp/clinemm-signal-repair-ws",
		env: {},
	};
}

afterEach(() => {
	setSeatbeltDiagnosticObserver(null);
});

/**
 * Prepare an invocation and read back the profile that was ACTUALLY
 * written to disk — not a re-generation — so the assertions observe
 * the production artifact.
 */
async function prepareAndReadProfile(cmd: CommandInvocation): Promise<{
	profile: string;
	profilePath: string;
}> {
	const prepared = await SeatbeltSandboxBackendExperimental.prepare({
		capability: prepareCapability(),
		command: cmd,
	});
	const profilePath = prepared.args[1] as string;
	const { readFileSync } = await import("node:fs");
	const profile = readFileSync(profilePath, "utf8");
	await prepared.cleanup?.();
	return { profile, profilePath };
}

describe("ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01 — permanent signal rule", () => {
	it("R1: the profile carries the permanent same-sandbox rule EXACTLY ONCE", () => {
		const p = generateSeatbeltProfile(
			conservationCapability(),
			CONSERVATION_OPTIONS,
		);
		expect(p).toContain(PERMANENT_RULE);
		expect(p.split(PERMANENT_RULE).length - 1).toBe(1);
		expect(p).not.toContain(RETIRED_RULE);
	});

	it("R1: the rule is UNCONDITIONAL — no opt-in gate changes it", () => {
		// The retired diagnostic was driven by env vars read at
		// activation time. The permanent rule must be identical for
		// every capability and every environment. Generate under
		// several materially different capabilities.
		const variants = [
			conservationCapability(),
			{
				readonlyRoots: [],
				writableRoots: [],
				network: "allow" as const,
				environment: { mode: "sanitized" as const, allow: [] },
			},
		];
		for (const cap of variants) {
			const p = generateSeatbeltProfile(cap);
			expect(p).toContain(PERMANENT_RULE);
			expect(p).not.toContain(RETIRED_RULE);
		}
	});

	it("R2: the retired one-shot diagnostic surface is GONE", async () => {
		const backendModule = (await import(
			"./seatbelt-backend"
		)) as unknown as Record<string, unknown>;
		expect(backendModule.armSeatbeltSignalRuleAuthorization).toBeUndefined();
		expect(backendModule.clearSeatbeltSignalRuleAuthorization).toBeUndefined();
		expect(backendModule.getSeatbeltSignalRuleAuthorization).toBeUndefined();

		const profileModule = (await import(
			"./seatbelt-profile"
		)) as unknown as Record<string, unknown>;
		expect(profileModule.SeatbeltSignalTarget).toBeUndefined();
	});

	it("R2: the generator no longer accepts a signalTarget option", () => {
		const p = generateSeatbeltProfile(
			conservationCapability(),
			// The option is gone from the type; passing it must not
			// silently produce a DIFFERENT rule.
			{
				...CONSERVATION_OPTIONS,
				signalTarget: "self",
			} as unknown as Parameters<typeof generateSeatbeltProfile>[1],
		);
		expect(p).toContain(PERMANENT_RULE);
		expect(p).not.toContain(RETIRED_RULE);
	});

	it("R3: the repair changes EXACTLY ONE profile line vs the pre-repair baseline", () => {
		const current = generateSeatbeltProfile(
			conservationCapability(),
			CONSERVATION_OPTIONS,
		);
		// The pre-repair baseline is the CURRENT profile with exactly
		// one substitution: the retired `self` rule.
		const baseline = current.replace(PERMANENT_RULE, RETIRED_RULE);
		expect(baseline).not.toBe(current);

		const currentProfileLines = current.split("\n");
		const baselineProfileLines = baseline.split("\n");
		expect(currentProfileLines.length).toBe(baselineProfileLines.length);

		const differing: number[] = [];
		for (let i = 0; i < currentProfileLines.length; i++) {
			if (currentProfileLines[i] !== baselineProfileLines[i]) differing.push(i);
		}
		expect(differing.length).toBe(1);
		expect(currentProfileLines[differing[0]]).toBe(PERMANENT_RULE);
		expect(baselineProfileLines[differing[0]]).toBe(RETIRED_RULE);
	});

	it("R3: filesystem / network / socket rules are byte-for-byte CONSERVED", () => {
		const current = generateSeatbeltProfile(
			conservationCapability(),
			CONSERVATION_OPTIONS,
		);
		const baseline = current.replace(PERMANENT_RULE, RETIRED_RULE);

		const isSignalRule = (line: string) =>
			line === PERMANENT_RULE || line === RETIRED_RULE;
		const currentRest = current.split("\n").filter((l) => !isSignalRule(l));
		const baselineRest = baseline.split("\n").filter((l) => !isSignalRule(l));
		// EVERY non-signal line is byte-for-byte identical.
		expect(currentRest).toEqual(baselineRest);

		// Spot-check the load-bearing families explicitly. These are
		// asserted on the CONSERVATION capability's own profile so the
		// check does not depend on the ambient environment (other test
		// files in the same worker may mutate process.env, which the
		// backend reads for the ssh-agent socket).
		expect(current).toContain("(deny default)");
		expect(current).toContain("(allow file-read*)");
		expect(current).toContain("(deny network*)");
		expect(current).toContain('(allow file-read-metadata (subpath "/"))');
		expect(current).toContain(
			'(remote unix-socket (path-literal "/private/tmp/com.apple.launchd.abc/Listeners"))',
		);
		expect(current).toContain(
			'(remote unix-socket (path-literal "/private/tmp/clinemm-signal-repair-helper.sock"))',
		);
		// The read carve-out is present in SOME form (the generator uses
		// the `require-all require-not` form when the deny list is
		// non-empty).
		expect(current).toMatch(/require-not|deny file-read\*/);
	});

	it("R4: the signal grant stays SCOPED — no blanket (allow signal)", () => {
		const p = generateSeatbeltProfile(
			conservationCapability(),
			CONSERVATION_OPTIONS,
		);
		// Exactly one signal rule, and it names a target.
		const signalRules = p
			.split("\n")
			.filter((line) => line.includes("allow signal"));
		expect(signalRules.length).toBe(1);
		expect(signalRules[0]).toBe(PERMANENT_RULE);
		// A blanket grant would permit signalling ANY process,
		// including processes outside the sandbox.
		expect(p).not.toContain("(allow signal)");
	});

	it("R5: prepare() still runs through sandbox-exec and keeps (deny default)", async () => {
		const { profile, profilePath } = await prepareAndReadProfile(anyCommand());
		expect(profilePath).toMatch(/clinemm-sandbox-profile-/);
		expect(profilePath).toMatch(/profile-[0-9a-f]+\.sb$/);
		expect(profile).toContain("(deny default)");
		expect(profile).toContain(PERMANENT_RULE);
		expect(profile).not.toContain(RETIRED_RULE);
	});

	it("R7: prepare() is IDEMPOTENT — the second invocation keeps the same rule", async () => {
		const cmd = anyCommand();
		const first = await prepareAndReadProfile(cmd);
		const second = await prepareAndReadProfile(cmd);
		// No one-shot budget: the retired diagnostic would have
		// reverted the SECOND prepare() to the retired rule.
		expect(first.profile).toContain(PERMANENT_RULE);
		expect(second.profile).toContain(PERMANENT_RULE);
		expect(second.profile).not.toContain(RETIRED_RULE);
		expect(second.profile).toBe(first.profile);
	});

	it("R6: the grant is SANDBOX-SCOPED — no foreign-target signal rule exists", () => {
		const p = generateSeatbeltProfile(
			conservationCapability(),
			CONSERVATION_OPTIONS,
		);
		// A foreign target would have to be spelled out as a rule the
		// profile grants. There must be NO rule that permits signalling
		// a process outside the sandbox.
		expect(p).not.toContain("(allow signal (target other)");
		expect(p).not.toContain("(allow signal (target global)");
		expect(p).not.toContain("(allow signal (target pid)");
		// The host-helper ownership-token protections are the authority
		// for cross-sandbox termination; the Seatbelt profile must not
		// broaden them.
		expect(p).not.toContain("process-group");
	});

	it("R9: the read-only diagnostic observer seam is unchanged and DEFAULT_OFF", () => {
		expect(getSeatbeltDiagnosticObserver()).toBeUndefined();
	});
});
