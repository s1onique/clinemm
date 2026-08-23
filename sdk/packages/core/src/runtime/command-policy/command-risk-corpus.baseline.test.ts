/**
 * Group A — Adversarial Command-Risk Corpus Baseline Freeze
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01
 *
 * Documents the CURRENT behavior of the canonical command policy
 * (as of HEAD) against the frozen corpus. Does NOT change any
 * production source.
 *
 * The corpus and the `requiredDecision` values are the contract the
 * V1 implementation must satisfy. See:
 *   - command-risk-corpus.ts               (frozen data)
 *   - command-risk-corpus.v1-contract.test.ts (Group B: V1 API asserts)
 *
 * Why this file exists separately from Group B:
 *   Group B imports `./command-risk` (the V1 entry point that
 *   does not yet exist). Importing that file makes the whole test
 *   suite fail to load. Splitting the two groups means Group A can
 *   run and pin the today-behaviour while Group B awaits the
 *   implementation commit.
 */

import { describe, expect, it } from "vitest";

import {
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
	findSafeRuleMatch,
} from "./index";
import { CORPUS } from "./command-risk-corpus";

/* ---------------------------------------------------------------------- *
 * GROUP A — BASELINE FREEZE                                              *
 * ---------------------------------------------------------------------- */

describe("Group A — baseline freeze: findSafeRuleMatch vs corpus", () => {
	it("documents empirical today-behavior of findSafeRuleMatch per case", () => {
		const baseline = CORPUS.map((c) => ({
			id: c.id,
			family: c.family,
			command: c.command,
			matchedSource:
				findSafeRuleMatch(c.command, DEFAULT_COMMAND_HOST_ALLOW_RULES)
					?.source ?? null,
			requiredDecision: c.requiredDecision,
		}));
		expect(baseline.length).toBe(CORPUS.length);
		// Sanity: a few well-known entries.
		const r0pwd = baseline.find((b) => b.id === "r0-pwd");
		expect(r0pwd?.matchedSource).toBe("host_safe_pwd");
		const r5rmrfhome = baseline.find((b) => b.id === "r5-rm-rf-home");
		// R5 catastrophic is not in the safe allowlist.
		expect(r5rmrfhome?.matchedSource).toBeNull();
		const r0revparse = baseline.find((b) => b.id === "r0-git-rev-parse");
		// V1 added `host_safe_git_rev_parse` to the safe allowlist.
		// This assertion documents the post-V1 snapshot.
		expect(r0revparse?.matchedSource).toBe("host_safe_git_rev_parse");
		const r0show = baseline.find((b) => b.id === "r0-git-show");
		expect(r0show?.matchedSource).toBe("host_safe_git_show");
		const r0revlist = baseline.find((b) => b.id === "r0-git-rev-list");
		expect(r0revlist?.matchedSource).toBe("host_safe_git_rev_list");
		// V1 added `host_safe_git_branch` to the safe allowlist.
		// These corpus entries pin the post-V1 snapshot.
		const r0BranchShowCurrent = baseline.find(
			(b) => b.id === "r0-git-branch-show-current",
		);
		expect(r0BranchShowCurrent?.matchedSource).toBe("host_safe_git_branch");
		const r0BranchList = baseline.find((b) => b.id === "r0-git-branch-list");
		expect(r0BranchList?.matchedSource).toBe("host_safe_git_branch");
		const r0BranchAll = baseline.find((b) => b.id === "r0-git-branch-all");
		expect(r0BranchAll?.matchedSource).toBe("host_safe_git_branch");
		const r0BranchRemotes = baseline.find(
			(b) => b.id === "r0-git-branch-remotes",
		);
		expect(r0BranchRemotes?.matchedSource).toBe("host_safe_git_branch");
		// V3 added `host_safe_ls` and `host_safe_find` to the safe
		// allowlist. These corpus entries pin the post-V3 matchedSource
		// snapshot.
		const r0LsBare = baseline.find((b) => b.id === "r0-ls-bare");
		expect(r0LsBare?.matchedSource).toBe("host_safe_ls");
		const r0LsLong = baseline.find((b) => b.id === "r0-ls-long");
		expect(r0LsLong?.matchedSource).toBe("host_safe_ls");
		const r0LsSomePath = baseline.find((b) => b.id === "r0-ls-somepath");
		expect(r0LsSomePath?.matchedSource).toBe("host_safe_ls");
		const r0FindBare = baseline.find((b) => b.id === "r0-find-bare");
		expect(r0FindBare?.matchedSource).toBe("host_safe_find");
		const r0FindTypeName = baseline.find((b) => b.id === "r0-find-type-name");
		expect(r0FindTypeName?.matchedSource).toBe("host_safe_find");
		const r0FindNotPath = baseline.find((b) => b.id === "r0-find-not-path");
		expect(r0FindNotPath?.matchedSource).toBe("host_safe_find");
	});
});

describe("Group A — baseline freeze: evaluateCommandPolicy in 'all' mode (the YOLO reality)", () => {
	// "all" mode = CLI --auto-approve / autoApproveTools=true. This is
	// the existing YOLO reality. We freeze what ALLOWs today to make
	// the R5 catastrophe gap undeniable.
	it("documents 'all' mode decisions against the corpus", () => {
		const allAuth = commandHostAuthorization({ mode: "all" });
		const byId = new Map<string, string>();
		for (const c of CORPUS) {
			const r = evaluateCommandPolicy({
				toolInput: { command: c.command, requires_approval: false },
				hostAuthorization: allAuth,
			});
			byId.set(c.id, r.decision.kind);
		}
		// R5 catastrophic commands are ALLOWED today in 'all' mode.
		// This is the LIVE RED — the product contract must be:
		// never auto-approve HOME destruction, even in 'all' mode,
		// via a HARD floor.
		expect(byId.get("r5-rm-rf-home")).toBe("allow");
		expect(byId.get("r5-rm-rf-tilde")).toBe("allow");
		expect(byId.get("r5-rm-rf-root")).toBe("allow");
		// rm -rf .. is ALLOWED today. This is the workspace-parent
		// blast radius.
		expect(byId.get("r5-rm-rf-dotdot")).toBe("allow");
		// bash -c wrapper around rm -rf $HOME is ALLOWED today.
		expect(byId.get("wrap-bash-c-rm-home")).toBe("allow");
	});
});

describe("Group A — baseline freeze: evaluateCommandPolicy in 'safe-only' mode", () => {
	it("documents 'safe-only' decisions against the corpus", () => {
		const safeOnly = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		});
		const byId = new Map<string, string>();
		for (const c of CORPUS) {
			const r = evaluateCommandPolicy({
				toolInput: { command: c.command, requires_approval: false },
				hostAuthorization: safeOnly,
			});
			byId.set(c.id, r.decision.kind);
		}
		// safe-only ALLOWs the post-V1 set (V1 added git rev-parse,
		// git show, git rev-list to the host-proven safe allowlist).
		expect(byId.get("r0-pwd")).toBe("allow");
		expect(byId.get("r0-git-status")).toBe("allow");
		expect(byId.get("r0-git-diff")).toBe("allow");
		expect(byId.get("r0-git-log")).toBe("allow");
		expect(byId.get("r0-git-rev-parse")).toBe("allow");
		expect(byId.get("r0-git-show")).toBe("allow");
		expect(byId.get("r0-git-rev-list")).toBe("allow");
		expect(byId.get("r0-git-branch-show-current")).toBe("allow");
		expect(byId.get("r0-git-branch-list")).toBe("allow");
		expect(byId.get("r0-git-branch-all")).toBe("allow");
		expect(byId.get("r0-git-branch-remotes")).toBe("allow");
		// V3 ls + find corpus
		expect(byId.get("r0-ls-bare")).toBe("allow");
		expect(byId.get("r0-ls-long")).toBe("allow");
		expect(byId.get("r0-ls-somepath")).toBe("allow");
		expect(byId.get("r0-find-bare")).toBe("allow");
		expect(byId.get("r0-find-type-name")).toBe("allow");
		expect(byId.get("r0-find-not-path")).toBe("allow");
		// CORRECTION01: shell-glob forms are ASK (not ALLOW).
		// These assertions lock the negative posture until the V2
		// parser-quote provenance integration lands.
		expect(byId.get("r0-find-glob-ask-name")).toBe("ask");
		expect(byId.get("r0-find-glob-ask-path")).toBe("ask");
		expect(byId.get("r0-find-glob-ask-start")).toBe("ask");
		// R5 catastrophic + wrappers are all ASK.
		expect(byId.get("r5-rm-rf-home")).toBe("ask");
		expect(byId.get("wrap-bash-c-rm-home")).toBe("ask");
	});
});

describe("Group A — corpus contract is internally consistent", () => {
	it("every requiredDecision value is in the supported lattice", () => {
		const allowed = new Set(["allow", "ask", "deny"]);
		for (const c of CORPUS) {
			expect(
				allowed.has(c.requiredDecision),
				`${c.id}: bad requiredDecision`,
			).toBe(true);
		}
	});

	it("R5 cases never require ALLOW (the hard floor)", () => {
		for (const c of CORPUS) {
			if (c.family === "R5-catastrophic") {
				expect(c.requiredDecision, `${c.id} is R5 but claims allow`).not.toBe(
					"allow",
				);
				expect(
					c.requiredDisposition,
					`${c.id} is R5 but is auto-approve-eligible`,
				).toBe("never-auto-approve");
			}
		}
	});

	it("wrapper-bypass cases never require ALLOW (the hard floor)", () => {
		for (const c of CORPUS) {
			if (c.family === "wrapper-bypass") {
				expect(
					c.requiredDecision,
					`${c.id} is wrapper-bypass but claims allow`,
				).not.toBe("allow");
				// Disposition is `ask` (V1 honest-ASK, no positive
				// catastrophe match) or `never-auto-approve` (a
				// catastrophic family was positively identified). It
				// is NEVER `auto-approve-eligible`.
				expect(
					c.requiredDisposition,
					`${c.id} is wrapper-bypass but is auto-approve-eligible`,
				).not.toBe("auto-approve-eligible");
			}
		}
	});

	it("compound cases that include R5 never require ALLOW (max aggregation)", () => {
		for (const c of CORPUS) {
			if (c.family === "compound-aggregation") {
				// V1 honestly-ASKs all opaque-token compound commands,
				// because the canonical policy treats the whole input
				// as a single aggregate, not as a per-command analysis.
				// The compound corpus cases are the contract for V1's
				// honest-ASK behavior; V2 may revisit with a real parser.
				expect(c.requiredDecision, `${c.id} compound must be ASK`).toBe("ask");
				expect(
					c.requiredDisposition,
					`${c.id} compound disposition must match corpus`,
				).toBe(c.requiredDisposition);
			}
		}
	});
});
