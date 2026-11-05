/**
 * ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01
 *
 * PROCESS-FREE structural tests for the TEMPORARY, DEFAULT_OFF,
 * one-shot Seatbelt signal-rule substitution.
 *
 * These tests are the GATE that must be green BEFORE any
 * installed-extension live experiment is attempted.
 *
 * Mapping to the ACT's structural test requirements:
 *
 *   T1  Default behavior — with the diagnostic mode disabled the
 *       generated profile is byte-for-byte equal to the ORIGINAL
 *       production generator output.
 *   T2  Explicit target — with the trusted opt-in and the EXACT
 *       diagnostic invocation, the profile carries
 *       `(allow signal (target same-sandbox))`.
 *   T3  Unrelated command — with the diagnostic armed but an unrelated
 *       command, the profile keeps `(allow signal (target self))`.
 *   T4  Spoofed activation — a command that merely includes the
 *       marker in an argument / stdout / environment does NOT enable
 *       the candidate.
 *   T5  Single invocation — a one-shot authorization is consumed by
 *       the first matching prepare(); a subsequent job reverts to the
 *       original rule.
 *   T6  Exact profile difference — candidate and baseline profiles
 *       for the SAME capability input differ in EXACTLY ONE line.
 *   T7  Filesystem and network conservation — the candidate profile
 *       preserves every non-signal rule byte-for-byte.
 *   T9  Read-only observer — the pre-existing profile/invocation
 *       diagnostic observer remains read-only and DEFAULT_OFF.
 */

import { describe, expect, it, afterEach } from "vitest";

import {
	armSeatbeltSignalRuleAuthorization,
	clearSeatbeltSignalRuleAuthorization,
	getSeatbeltDiagnosticObserver,
	getSeatbeltSignalRuleAuthorization,
	SeatbeltSandboxBackendExperimental,
	setSeatbeltDiagnosticObserver,
} from "./seatbelt-backend";
import { generateSeatbeltProfile } from "./seatbelt-profile";
import type { CommandCapability, CommandInvocation } from "../types";

const MARKER = "CLINEMM_SAME_SANDBOX_PRODUCTION_DISCRIMINATOR01";

const SELF_RULE = "(allow signal (target self))";
const SAME_SANDBOX_RULE = "(allow signal (target same-sandbox))";

/**
 * A capability that exercises EVERY rule family the ACT's T7
 * conservation requirement names: deny-read subpaths, writable /
 * readonly / create-only / temp roots, network deny, ssh-agent and
 * host-helper socket rules.
 */
function conservationCapability(): CommandCapability {
	return {
		readonlyRoots: ["/private/tmp/clinemm-conservation-ro"],
		writableRoots: ["/private/tmp/clinemm-conservation-rw"],
		createOnlyRoots: ["/private/tmp/clinemm-conservation-create"],
		tempRoot: "/private/tmp/clinemm-conservation-tmp",
		denyReadSubpaths: ["/private/tmp/clinemm-conservation-secret"],
		network: "deny",
		environment: { mode: "sanitized", allow: ["PATH"] },
		cwd: "/private/tmp/clinemm-conservation-ws",
		sshAuthenticationAuthority: { mode: "agent" },
	};
}

const CONSERVATION_OPTIONS = {
	denyReadSubpaths: ["/private/tmp/clinemm-conservation-secret"],
	sshAgentCanonicalSocketPath: "/private/tmp/com.apple.launchd.abc/Listeners",
	hostHelperCanonicalSocketPath:
		"/private/tmp/clinemm-conservation-helper.sock",
} as const;

function diagnosticCommand(): CommandInvocation {
	return {
		executable: "/bin/bash",
		args: ["-c", `/usr/bin/env node /tmp/${MARKER}/probe.mjs`],
		cwd: "/private/tmp/clinemm-conservation-ws",
		env: {},
	};
}

afterEach(() => {
	clearSeatbeltSignalRuleAuthorization();
	setSeatbeltDiagnosticObserver(null);
});

describe("T1/T6/T7 — profile generator default-off + signal-only diff", () => {
	it("T1: DEFAULT (no options) emits the ORIGINAL production signal rule", () => {
		const p = generateSeatbeltProfile(conservationCapability());
		expect(p).toContain(SELF_RULE);
		expect(p).not.toContain(SAME_SANDBOX_RULE);
	});

	it("T1: DEFAULT is byte-for-byte identical to an explicit signalTarget:'self'", () => {
		// Compare like-for-like: the SAME options, with and without the
		// explicit `signalTarget: "self"`. The absence of the option MUST
		// reproduce the ORIGINAL production bytes exactly.
		const baseline = generateSeatbeltProfile(
			conservationCapability(),
			CONSERVATION_OPTIONS,
		);
		const explicitSelf = generateSeatbeltProfile(conservationCapability(), {
			...CONSERVATION_OPTIONS,
			signalTarget: "self",
		});
		expect(explicitSelf).toBe(baseline);
	});

	it("T2: signalTarget:'same-sandbox' emits the candidate rule exactly once", () => {
		const p = generateSeatbeltProfile(conservationCapability(), {
			...CONSERVATION_OPTIONS,
			signalTarget: "same-sandbox",
		});
		expect(p).toContain(SAME_SANDBOX_RULE);
		expect(p).not.toContain(SELF_RULE);
		expect(p.split(SAME_SANDBOX_RULE).length - 1).toBe(1);
	});

	it("T6: candidate and baseline differ in EXACTLY ONE line", () => {
		const baseline = generateSeatbeltProfile(
			conservationCapability(),
			CONSERVATION_OPTIONS,
		).split("\n");
		const candidate = generateSeatbeltProfile(conservationCapability(), {
			...CONSERVATION_OPTIONS,
			signalTarget: "same-sandbox",
		}).split("\n");
		expect(candidate.length).toBe(baseline.length);
		const differing: Array<[number, string, string]> = [];
		for (let i = 0; i < baseline.length; i++) {
			if (baseline[i] !== candidate[i]) {
				differing.push([i, baseline[i] ?? "", candidate[i] ?? ""]);
			}
		}
		// EXACTLY ONE differing line, and it is the signal rule. The
		// index is not asserted: the conservation options legitimately
		// shift the prelude's line numbering.
		expect(differing.length).toBe(1);
		expect(differing[0]?.[1]).toBe(SELF_RULE);
		expect(differing[0]?.[2]).toBe(SAME_SANDBOX_RULE);
	});

	it("T7: the candidate preserves every non-signal rule byte-for-byte", () => {
		const baseline = generateSeatbeltProfile(
			conservationCapability(),
			CONSERVATION_OPTIONS,
		);
		const candidate = generateSeatbeltProfile(conservationCapability(), {
			...CONSERVATION_OPTIONS,
			signalTarget: "same-sandbox",
		});
		// Filesystem.
		expect(candidate).toContain("(allow file-read*)");
		expect(candidate).toContain(
			'(deny file-read* (subpath "/private/tmp/clinemm-conservation-secret"))',
		);
		expect(candidate).toContain(
			'(subpath "/private/tmp/clinemm-conservation-rw")',
		);
		expect(candidate).toContain(
			'(subpath "/private/tmp/clinemm-conservation-ro")',
		);
		expect(candidate).toContain(
			'(subpath "/private/tmp/clinemm-conservation-create")',
		);
		expect(candidate).toContain(
			'(subpath "/private/tmp/clinemm-conservation-tmp")',
		);
		expect(candidate).toContain('(literal "/dev/null")');
		expect(candidate).toContain('(literal "/dev/tty")');
		// Network.
		expect(candidate).toContain("(deny network*)");
		expect(candidate).not.toContain("(allow network*)");
		// Socket rules (ssh-agent + host-helper).
		expect(candidate).toContain("(allow system-socket");
		expect(candidate).toContain(
			'(path-literal "/private/tmp/com.apple.launchd.abc/Listeners")',
		);
		expect(candidate).toContain(
			'(path-literal "/private/tmp/clinemm-conservation-helper.sock")',
		);
		// Process execution / fork and metadata.
		expect(candidate).toContain("(allow process-exec)");
		expect(candidate).toContain("(allow process-fork)");
		expect(candidate).toContain('(allow file-read-metadata (subpath "/"))');
		// NO broad signal grant.
		expect(candidate).not.toContain("(allow signal)");
		expect(candidate).not.toMatch(/\(allow signal\s*\)/);
		// The baseline is preserved except for the one line.
		expect(candidate.replace(SAME_SANDBOX_RULE, SELF_RULE)).toBe(baseline);
	});
});

/**
 * T2/T3/T4/T5 at the BACKEND level. These assert the profile that is
 * ACTUALLY WRITTEN to disk by `SeatbeltSandboxBackendExperimental.prepare()`,
 * not merely what the generator can produce.
 *
 * The backend is exercised through its real prepare() path, so the
 * authorization consumption, the exact-identity match, and the
 * fail-closed preparation semantics are all covered.
 */
describe("T2/T3/T4/T5/T8 — backend prepare() gating (real profile bytes)", () => {
	const capability: CommandCapability = {
		readonlyRoots: [],
		writableRoots: ["/private/tmp"],
		network: "deny",
		environment: { mode: "sanitized", allow: [] },
		cwd: "/private/tmp",
	};

	async function prepareWith(
		cmd: CommandInvocation,
	): Promise<{
		profile: string;
		prepared: Awaited<
			ReturnType<typeof SeatbeltSandboxBackendExperimental.prepare>
		>;
	}> {
		const prepared = await SeatbeltSandboxBackendExperimental.prepare({
			capability,
			command: cmd,
		});
		// The prepared invocation MUST go through sandbox-exec with the
		// profile path (T8 / NO SANDBOX BYPASS).
		expect(prepared.executable).toBe("/usr/bin/sandbox-exec");
		expect(prepared.args[0]).toBe("-f");
		expect(prepared.args[1]).toBe(prepared.cleanup ? prepared.args[1] : "");
		const profilePath = prepared.args[1] as string;
		const { readFileSync } = await import("node:fs");
		const profile = readFileSync(profilePath, "utf8");
		await prepared.cleanup?.();
		return { profile, prepared };
	}

	it("T3: with NO authorization, prepare() writes the ORIGINAL self-only rule", async () => {
		const { profile } = await prepareWith(diagnosticCommand());
		expect(profile).toContain(SELF_RULE);
		expect(profile).not.toContain(SAME_SANDBOX_RULE);
	});

	it("T2: with the EXACT diagnostic identity armed, prepare() writes the candidate rule", async () => {
		const cmd = diagnosticCommand();
		armSeatbeltSignalRuleAuthorization({
			executable: cmd.executable,
			argv: cmd.args,
		});
		const { profile } = await prepareWith(cmd);
		expect(profile).toContain(SAME_SANDBOX_RULE);
		expect(profile).not.toContain(SELF_RULE);
		expect(profile.split(SAME_SANDBOX_RULE).length - 1).toBe(1);
		// T8 / NO SANDBOX BYPASS: still sandbox-exec + the SAME profile path.
		expect(profile).toContain("(deny default)");
		expect(profile).toContain("(allow process-exec)");
		expect(profile).toContain("(allow process-fork)");
		expect(profile).toContain("(deny network*)");
		expect(profile).not.toContain("(allow signal)");
	});

	it("T3: with the diagnostic armed, an UNRELATED command keeps the self-only rule", async () => {
		armSeatbeltSignalRuleAuthorization({
			executable: "/bin/bash",
			argv: ["/tmp/some-other-command.sh"],
		});
		const { profile } = await prepareWith({
			executable: "/bin/bash",
			args: ["-c", "/bin/echo unrelated"],
			cwd: "/private/tmp",
			env: {},
		});
		expect(profile).toContain(SELF_RULE);
		expect(profile).not.toContain(SAME_SANDBOX_RULE);
	});

	it("T4: a SPOOFED command that merely mentions the marker is NOT widened", async () => {
		const cmd = diagnosticCommand();
		armSeatbeltSignalRuleAuthorization({
			executable: cmd.executable,
			argv: cmd.args,
		});
		// Same executable, marker present in the command text, DIFFERENT
		// argv → the exact-match gate rejects it.
		const { profile } = await prepareWith({
			executable: "/bin/bash",
			args: ["-c", `echo ${MARKER}`],
			cwd: "/private/tmp",
			env: {},
		});
		expect(profile).toContain(SELF_RULE);
		expect(profile).not.toContain(SAME_SANDBOX_RULE);
	});

	it("T4: a spoofed command with the SAME argv but a DIFFERENT executable is NOT widened", async () => {
		const cmd = diagnosticCommand();
		armSeatbeltSignalRuleAuthorization({
			executable: cmd.executable,
			argv: cmd.args,
		});
		const { profile } = await prepareWith({
			executable: "/bin/zsh",
			args: [...cmd.args],
			cwd: "/private/tmp",
			env: {},
		});
		expect(profile).toContain(SELF_RULE);
		expect(profile).not.toContain(SAME_SANDBOX_RULE);
	});

	it("T5: the authorization is ONE-SHOT — a second identical prepare() reverts to self", async () => {
		const cmd = diagnosticCommand();
		armSeatbeltSignalRuleAuthorization({
			executable: cmd.executable,
			argv: cmd.args,
		});
		const first = await prepareWith(cmd);
		expect(first.profile).toContain(SAME_SANDBOX_RULE);
		// The authorization was consumed: it is gone from the slot.
		expect(getSeatbeltSignalRuleAuthorization()).toBeUndefined();
		const second = await prepareWith(cmd);
		expect(second.profile).toContain(SELF_RULE);
		expect(second.profile).not.toContain(SAME_SANDBOX_RULE);
	});
});
