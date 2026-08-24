/**
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01
 *
 * Integration test for the workspace path authority contract. This
 * is the FULL RED/GREEN matrix from the review.
 *
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
 * REALPATH_WORKSPACE_CONFINEMENT:
 *
 *   The canonical command policy
 *   (`evaluateCommandPolicy`) consumes host-supplied realpath
 *   evidence and tests containment on canonical pathnames.
 *
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION02
 * REALPATH_EVIDENCE_REQUIRED_FOR_PATH_BEARING_R0_ALLOW:
 *
 *   Missing or operand-mismatched evidence is ASK, never ALLOW.
 *   The V1 lexical fallback has been REMOVED from the production
 *   ALLOW path. Every fixture in this file constructs an explicit
 *   `pathAuthorityEvidence` per-command that matches the operand
 *   identity and the desired disposition.
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
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION02
 *
 * Build host-supplied realpath evidence that matches the
 * command's operands and yields the desired disposition. The
 * fixture operates in a POSIX-like string namespace
 * (`/current/project`); we cannot `fs.realpathSync` those
 * paths, so we fabricate evidence objects that model the host's
 * observation.
 *
 * For every positive (workspace-conforming) ALLOW case, the
 * evidence marks every operand as `contained: true` with a
 * fictional canonical path that is INSIDE the workspace root.
 * For every negative ASK case, the evidence marks at least one
 * operand as `contained: false` (resolved-but-outside or
 * unresolved).
 */
function buildEvidenceForCommand(command: string): WorkspacePathAuthorityEvidence {
	const tokens = command.split(/\s+/u).filter((t) => t.length > 0);
	const commandName = tokens[0]!;
	if (commandName !== "ls" && commandName !== "find") {
		// Non-path-bearing commands should not need evidence
		// at all; the production gate does not fire for them.
		// We still construct an empty-operands evidence record
		// for completeness.
		return {
			roots: [WORKSPACE_ROOT],
			cwd: CWD,
			operands: [],
		};
	}
	const operandStrings = tokens.slice(1).filter((t) => !t.startsWith("-"));
	const operands = operandStrings.map((raw) => {
		// The fix is intentionally simple: classify each
		// operand against the same set of rules the policy
		// uses (realpath containment + lexical containment),
		// and produce evidence that reflects the host's
		// observation. The fixture operates in a POSIX-like
		// string namespace (`/current/project`); we cannot
		// `fs.realpathSync` these paths, so the "resolved"
		// pathname is the literal operand string.
		const isTildePrefixed = raw.startsWith("~");
		const isOutsideAbsolute =
			raw === "/" || raw.startsWith("/etc") || raw === "~/.ssh";
		const isLexicalEscape = raw.includes("/..");
		const isOutsideProject =
			isTildePrefixed ||
			isOutsideAbsolute ||
			raw === `${WORKSPACE_ROOT}/outside-link` ||
			raw.startsWith(`${WORKSPACE_ROOT}/does-not-exist`) ||
			raw.startsWith(`${WORKSPACE_ROOT}/restricted`);
		if (isTildePrefixed) {
			// realpath refuses to expand `~`; treat as
			// realpath-failed-other.
			return {
				operand: raw,
				resolvedRealPath: null,
				contained: false,
				reason: "realpath-failed-other" as const,
			};
		}
		if (isLexicalEscape) {
			// Lexical escape via `..`: pretend realpath
			// already canonicalized the path (collapsed `.`
			// and `..`) and the canonical form is OUTSIDE
			// the workspace root \u2014 e.g.
			//   `/current/project/../../etc` \u2192 `/etc`
			//   `/current/project/../.ssh` \u2192 `/.ssh` (or
			//                              `/${HOME}/.ssh`)
			// The post-canonicalization pathname is what the
			// policy's `isLexicallyContained` checks.
			let canonical: string;
			if (raw.startsWith("/current/project/../../etc")) {
				canonical = "/etc";
			} else if (raw.startsWith("/current/project/../.ssh")) {
				canonical = "/.ssh";
			} else {
				canonical = "/etc";
			}
			return {
				operand: raw,
				resolvedRealPath: canonical,
				contained: false,
				reason: "resolved-but-outside-roots" as const,
			};
		}
		if (raw === `${WORKSPACE_ROOT}/outside-link`) {
			// Symlink escape: the host's realpath resolves
			// this to OUTSIDE.
			return {
				operand: raw,
				resolvedRealPath: "/etc",
				contained: false,
				reason: "resolved-but-outside-roots" as const,
			};
		}
		if (raw.startsWith(`${WORKSPACE_ROOT}/does-not-exist`)) {
			return {
				operand: raw,
				resolvedRealPath: null,
				contained: false,
				reason: "realpath-failed-enoent" as const,
			};
		}
		if (raw.startsWith(`${WORKSPACE_ROOT}/restricted`)) {
			return {
				operand: raw,
				resolvedRealPath: null,
				contained: false,
				reason: "realpath-failed-eacces" as const,
			};
		}
		if (isOutsideProject) {
			return {
				operand: raw,
				resolvedRealPath: raw,
				contained: false,
				reason: "resolved-but-outside-roots" as const,
			};
		}
		// Workspace-conforming: imaginary canonical path
		// inside the workspace root.
		const resolved = raw.startsWith("/") ? raw : `${CWD}/${raw}`;
		return {
			operand: raw,
			resolvedRealPath: resolved,
			contained: true,
			reason: "resolved-and-contained" as const,
		};
	});
	return {
		roots: [WORKSPACE_ROOT],
		cwd: CWD,
		operands,
	};
}

function pathAuthorityAuth(command: string): ReturnType<typeof commandHostAuthorization> {
	return commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [WORKSPACE_ROOT],
		cwd: CWD,
		pathAuthorityEvidence: buildEvidenceForCommand(command),
	});
}

describe("ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION02 — RED/GREEN matrix", () => {
	// ------------ GREEN: under the workspace root ------------
	it("ALLOW: ls /current/project", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project" },
			hostAuthorization: pathAuthorityAuth("ls /current/project"),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.source).toBe("host_mode_safe_only_rule");
	});

	it("ALLOW: ls /current/project/.factory", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project/.factory" },
			hostAuthorization: pathAuthorityAuth("ls /current/project/.factory"),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.source).toBe("host_mode_safe_only_rule");
	});

	it("ALLOW: find /current/project -type f", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /current/project -type f" },
			hostAuthorization: pathAuthorityAuth("find /current/project -type f"),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.source).toBe("host_mode_safe_only_rule");
	});

	it("ALLOW: find /current/project/src -name foo.ts", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /current/project/src -name foo.ts" },
			hostAuthorization: pathAuthorityAuth(
				"find /current/project/src -name foo.ts",
			),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.source).toBe("host_mode_safe_only_rule");
	});

	// ------------ RED: outside the workspace root ------------
	it("ASK: ls /etc", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /etc" },
			hostAuthorization: pathAuthorityAuth("ls /etc"),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("ASK: ls ~/.ssh", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls ~/.ssh" },
			hostAuthorization: pathAuthorityAuth("ls ~/.ssh"),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("ASK: find /", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /" },
			hostAuthorization: pathAuthorityAuth("find /"),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("ASK: find /etc", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /etc" },
			hostAuthorization: pathAuthorityAuth("find /etc"),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	// ------------ RED: lexical-escape via .. dot-segments ------------
	it("ASK: find /current/project/../../etc (lexical escape)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /current/project/../../etc" },
			hostAuthorization: pathAuthorityAuth(
				"find /current/project/../../etc",
			),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("ASK: ls /current/project/../.ssh (lexical escape)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project/../.ssh" },
			hostAuthorization: pathAuthorityAuth(
				"ls /current/project/../.ssh",
			),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("ASK: ls /current/project/sub/../../etc (lexical escape)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project/sub/../../etc" },
			hostAuthorization: pathAuthorityAuth(
				"ls /current/project/sub/../../etc",
			),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	// ------------ CORRECTION01 closed: symlink-to-outside is ASK ------------
	it("ASK: find /current/project/outside-link (realpath escape closed)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "find /current/project/outside-link" },
			hostAuthorization: pathAuthorityAuth(
				"find /current/project/outside-link",
			),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	// ------------ Multi-command aggregate ------------
	it("aggregate: workspace-realpath-authority ASK dominates", () => {
		const r = evaluateCommandPolicy({
			toolInput: {
				commands: ["ls /current/project", "ls /etc"],
			},
			hostAuthorization: commandHostAuthorization({
				mode: "safe-only",
				explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
				workspaceRoots: [WORKSPACE_ROOT],
				cwd: CWD,
				pathAuthorityEvidence: {
					roots: [WORKSPACE_ROOT],
					cwd: CWD,
					operands: [
						{
							operand: "/current/project",
							resolvedRealPath: "/current/project",
							contained: true,
							reason: "resolved-and-contained",
						},
					],
				},
			}),
		});
		// First command is ALLOW (single operand, contained);
		// second command has no evidence operands but IS
		// still an R0 read-only command; under CORRECTION02
		// it gets ASK. The aggregate is ASK.
		expect(r.decision.kind).toBe("ask");
	});

	// ------------ pwd / git *: not path-bearing; not gated ------------
	it("ALLOW: pwd (no path operand)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "pwd" },
			hostAuthorization: pathAuthorityAuth("pwd"),
		});
		expect(r.decision.kind).toBe("allow");
	});

	it("ALLOW: git status (no path operand)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "git status" },
			hostAuthorization: pathAuthorityAuth("git status"),
		});
		expect(r.decision.kind).toBe("allow");
	});

	it("ALLOW: git diff (no path operand)", () => {
		const r = evaluateCommandPolicy({
			toolInput: { command: "git diff" },
			hostAuthorization: pathAuthorityAuth("git diff"),
		});
		expect(r.decision.kind).toBe("allow");
	});

	// ------------ CORRECTION02 invariants ------------
	it("CORRECTION02: missing evidence ⇒ ASK even when V1 lexical would have passed", () => {
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [WORKSPACE_ROOT],
			cwd: CWD,
			// pathAuthorityEvidence deliberately undefined
		});
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project" },
			hostAuthorization: auth,
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("CORRECTION02: evidence with empty operands for path-bearing command ⇒ ASK (operand count mismatch)", () => {
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [WORKSPACE_ROOT],
			cwd: CWD,
			pathAuthorityEvidence: {
				roots: [WORKSPACE_ROOT],
				cwd: CWD,
				operands: [], // empty: count mismatch
			},
		});
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project" },
			hostAuthorization: auth,
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("CORRECTION02: operand identity mismatch ⇒ ASK", () => {
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [WORKSPACE_ROOT],
			cwd: CWD,
			pathAuthorityEvidence: {
				roots: [WORKSPACE_ROOT],
				cwd: CWD,
				operands: [
					{
						operand: "/current/project/.factory",
						resolvedRealPath: "/current/project/.factory",
						contained: true,
						reason: "resolved-and-contained",
					},
				],
			},
		});
		// Command operand is /current/project (different from
		// evidence operand). Should ASK.
		const r = evaluateCommandPolicy({
			toolInput: { command: "ls /current/project" },
			hostAuthorization: auth,
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});
});

describe("ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01 — corpus entries pin the contract", () => {
	const byId = new Map(CORPUS.map((c) => [c.id, c] as const));
	const pathAuthCases = CORPUS.filter((c) =>
		c.id.startsWith("r0-pathauthority-"),
	);

	for (const c of pathAuthCases) {
		it(`${c.id}: ${c.command} -> ${c.requiredDecision}`, () => {
			const r = evaluateCommandPolicy({
				toolInput: { command: c.command },
				hostAuthorization: pathAuthorityAuth(c.command),
			});
			expect(r.decision.kind).toBe(c.requiredDecision);
			if (c.requiredDecision === "allow") {
				expect(r.decision.source).toBe("host_mode_safe_only_rule");
			} else {
				expect(r.decision.source).toBe(
					"host_workspace_realpath_authority",
				);
			}
		});
	}

	it("r0-ls-somepath corpus regression case: ls /etc is now ASK", () => {
		const c = byId.get("r0-ls-somepath");
		expect(c, "r0-ls-somepath corpus entry must exist").toBeDefined();
		const r = evaluateCommandPolicy({
			toolInput: { command: c!.command },
			hostAuthorization: pathAuthorityAuth(c!.command),
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
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
