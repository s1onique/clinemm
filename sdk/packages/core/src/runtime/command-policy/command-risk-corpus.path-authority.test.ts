/**
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01
 *
 * Integration test for the workspace path authority contract. This
 * is the FULL RED/GREEN matrix from the review.
 *
 * It exercises the canonical command policy
 * (`evaluateCommandPolicy`) with a host authorization that supplies
 * a `workspaceRoots` array and a `cwd`. The fixture root is
 * `/current/project` — chosen to be POSIX-like, NOT user-specific
 * (the policy layer must never bake any user's filesystem layout
 * into its rules; the host supplies the roots).
 */
import { describe, expect, it } from "vitest";
import { CORPUS } from "./command-risk-corpus";
import {
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
	type WorkspacePathAuthorityEvidence,
} from "./index";

/** The shared fixture root for the path-authority tests. */
const WORKSPACE_ROOT = "/current/project";
const CWD = WORKSPACE_ROOT;

/**
 * Build a host authorization with the workspace path authority
 * gate configured for the fixture root.
 *
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
 * REALPATH_WORKSPACE_CONFINEMENT:
 *
 * By default this builds a V1 lexical-path-only auth (no
 * `pathAuthorityEvidence`). The corpus entries that exercise the
 * realpath gate (`r0-pathauthority-find-symlink-escape-...`,
 * `r0-pathauthority-find-nonexistent-...`,
 * `r0-pathauthority-find-permission-denied-...`,
 * `r0-pathauthority-find-nonexistent-mixed-operands`) supply a
 * per-entry `pathAuthorityEvidence` via the
 * `pathAuthorityAuthWithEvidence` helper.
 */
function pathAuthorityAuth(): ReturnType<typeof commandHostAuthorization> {
	return commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [WORKSPACE_ROOT],
		cwd: CWD,
	});
}

/**
 * Build a host authorization with host-supplied realpath
 * evidence attached. The fixture root is the canonical
 * `/current/project` — same as the V1 lexical auth, but the
 * evidence gives the policy layer a way to ASK an operand
 * that realpath-resolved to /outside, or failed to resolve.
 */
function pathAuthorityAuthWithEvidence(
	evidence: WorkspacePathAuthorityEvidence,
): ReturnType<typeof commandHostAuthorization> {
	return commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [WORKSPACE_ROOT],
		cwd: CWD,
		pathAuthorityEvidence: evidence,
	});
}

describe("ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01 — RED/GREEN matrix", () => {
	// ------------ GREEN: under the workspace root ------------
	it("ALLOW: ls /current/project", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.source).toBe("host_mode_safe_only_rule");
	});

	it("ALLOW: ls /current/project/.factory", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project/.factory" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.source).toBe("host_mode_safe_only_rule");
	});

	it("ALLOW: find /current/project -type f", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /current/project -type f" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.source).toBe("host_mode_safe_only_rule");
	});

	it("ALLOW: find /current/project/src -name foo.ts", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /current/project/src -name foo.ts" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.source).toBe("host_mode_safe_only_rule");
	});

	// ------------ RED: outside the workspace root ------------
	it("ASK: ls /etc", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /etc" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_path_authority");
	});

	it("ASK: ls ~/.ssh", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls ~/.ssh" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_path_authority");
	});

	it("ASK: find /", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_path_authority");
	});

	it("ASK: find /etc", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /etc" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_path_authority");
	});

	// ------------ RED: lexical-escape via .. dot-segments ------------
	it("ASK: find /current/project/../../etc (lexical escape)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /current/project/../../etc" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_path_authority");
	});

	it("ASK: ls /current/project/../.ssh (lexical escape)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project/../.ssh" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_path_authority");
	});

	it("ASK: ls /current/project/sub/../../etc (lexical escape)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project/sub/../../etc" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_path_authority");
	});

	// ------------ V1 LIMITATION: symlink-to-outside passes lexically ------------
	it("ALLOW (V1 limitation): find /current/project/outside-link", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /current/project/outside-link" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("allow");
	});

	// ------------ Multi-command aggregate ------------
	it("aggregate: workspace-path-authority ASK dominates", () => {
		const r = evaluateCommandPolicy({
			toolInput: {
				commands: ["ls /current/project", "ls /etc"],
			},
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_path_authority");
	});

	// ------------ pwd / git *: not path-bearing; not gated ------------
	it("ALLOW: pwd (no path operand)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "pwd" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("allow");
	});

	it("ALLOW: git status (no path operand)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "git status" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("allow");
	});

	it("ALLOW: git diff (no path operand)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "git diff" },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("allow");
	});
});

describe("ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01 — corpus entries pin the contract", () => {
	const byId = new Map(CORPUS.map((c) => [c.id, c] as const));
	const pathAuthCases = CORPUS.filter((c) =>
		c.id.startsWith("r0-pathauthority-"),
	);

	/**
	 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
	 * REALPATH_WORKSPACE_CONFINEMENT:
	 *
	 * The corpus entries that exercise the realpath gate
	 * (symlink-escape, nonexistent, permission-denied, mixed
	 * operands) need a hand-built `pathAuthorityEvidence` so the
	 * policy layer sees the realpath resolution result. We
	 * classify each corpus entry as lexical-only (use the V1
	 * lexical auth) or realpath-gated (use evidence-backed auth)
	 * by id.
	 *
	 * The fixture operates in a POSIX-like string namespace
	 * (`/current/project`); we cannot `fs.realpathSync` those
	 * paths, so we fabricate evidence objects that model the
	 * host's observation.
	 */
	const REALPATH_GATED_IDS = new Set<string>([
		"r0-pathauthority-find-symlink-escape-realpath-closed",
		"r0-pathauthority-find-nonexistent-fail-closed",
		"r0-pathauthority-find-permission-denied-fail-closed",
		"r0-pathauthority-find-nonexistent-mixed-operands",
	]);

	/**
	 * Build the realpath evidence for one corpus entry. The
	 * fixture root is the canonical `/current/project`; the
	 * operand resolution outcome depends on the corpus id.
	 */
	function buildEvidenceForEntry(c: {
		id: string;
		command: string;
	}): WorkspacePathAuthorityEvidence {
		const operand = c.command.split(/\s+/u).slice(1).join(" ");
		if (c.id === "r0-pathauthority-find-symlink-escape-realpath-closed") {
			// The host resolves the symlink and finds the
			// target is /etc (outside the project).
			return {
				roots: [WORKSPACE_ROOT],
				cwd: CWD,
				operands: [
					{
						operand,
						resolvedRealPath: "/etc",
						contained: false,
						reason: "resolved-but-outside-roots",
					},
				],
			};
		}
		if (c.id === "r0-pathauthority-find-nonexistent-fail-closed") {
			// The path does not exist; the host reports
			// realpath-failed-enoent.
			return {
				roots: [WORKSPACE_ROOT],
				cwd: CWD,
				operands: [
					{
						operand,
						resolvedRealPath: null,
						contained: false,
						reason: "realpath-failed-enoent",
					},
				],
			};
		}
		if (c.id === "r0-pathauthority-find-permission-denied-fail-closed") {
			return {
				roots: [WORKSPACE_ROOT],
				cwd: CWD,
				operands: [
					{
						operand,
						resolvedRealPath: null,
						contained: false,
						reason: "realpath-failed-eacces",
					},
				],
			};
		}
		if (c.id === "r0-pathauthority-find-nonexistent-mixed-operands") {
			const ops = c.command.split(/\s+/u).slice(1);
			return {
				roots: [WORKSPACE_ROOT],
				cwd: CWD,
				operands: [
					{
						operand: ops[0]!,
						resolvedRealPath: `${WORKSPACE_ROOT}/src`,
						contained: true,
						reason: "resolved-and-contained",
					},
					{
						operand: ops[1]!,
						resolvedRealPath: null,
						contained: false,
						reason: "realpath-failed-enoent",
					},
				],
			};
		}
		throw new Error(`unhandled realpath-gated corpus entry: ${c.id}`);
	}

	for (const c of pathAuthCases) {
		it(`${c.id}: ${c.command} -> ${c.requiredDecision}`, () => {
			const auth = REALPATH_GATED_IDS.has(c.id)
				? pathAuthorityAuthWithEvidence(buildEvidenceForEntry(c))
				: pathAuthorityAuth();
			const r = evaluateCommandPolicy({
				toolInput: { command: c.command },
				hostAuthorization: auth,
			});
			expect(r.decision.kind).toBe(c.requiredDecision);
			if (c.requiredDecision === "allow") {
				expect(r.decision.source).toBe("host_mode_safe_only_rule");
			} else if (REALPATH_GATED_IDS.has(c.id)) {
				expect(r.decision.source).toBe("host_workspace_realpath_authority");
			} else {
				expect(r.decision.source).toBe("host_workspace_path_authority");
			}
		});
	}

	it("r0-ls-somepath corpus regression case: ls /etc is now ASK", () => {
		const c = byId.get("r0-ls-somepath");
		expect(c, "r0-ls-somepath corpus entry must exist").toBeDefined();
		const r = evaluateCommandPolicy({
			toolInput: { command: c!.command },
			hostAuthorization: pathAuthorityAuth(),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_path_authority");
	});
});

describe("ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01 — path-agnostic rules keep matching at the regex layer", () => {
	it("findSafeRuleMatch still matches host_safe_ls for absolute paths", async () => {
		const { findSafeRuleMatch } = await import("./command-safe-rules");
		const m = findSafeRuleMatch("ls /etc", DEFAULT_COMMAND_HOST_ALLOW_RULES);
		expect(m?.source).toBe("host_safe_ls");
	});

	it("findSafeRuleMatch still matches host_safe_find for absolute paths", async () => {
		const { findSafeRuleMatch } = await import("./command-safe-rules");
		const m = findSafeRuleMatch("find /etc", DEFAULT_COMMAND_HOST_ALLOW_RULES);
		expect(m?.source).toBe("host_safe_find");
	});
});
