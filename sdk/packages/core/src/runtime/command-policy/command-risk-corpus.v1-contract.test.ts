/**
 * Group B — V1 Command-Risk Classifier Contract
 *
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01
 *
 * The V1 entry point under test is `evaluateCommandRisk()` exported
 * from `./command-risk`. It is the bounded production slice the ACT
 * commits to. It produces a structured `RiskDecision`:
 *
 *   {
 *     decision:   "allow" | "ask" | "deny"
 *     disposition:"auto-approve-eligible" | "ask" | "never-auto-approve"
 *     reasons:    string[]
 *     operations: string[]
 *     targets:    string[]
 *     parseConfidence: "complete" | "partial" | "failed"
 *   }
 *
 * The contract asserted here is the "smallest justified production
 * slice" the ACT commits to. Anything not asserted here is **out of
 * scope** for V1 and may legitimately be handled by an honest ASK
 * verdict.
 *
 * Until the V1 implementation lands, this file fails to LOAD because
 * the `./command-risk` import is unresolvable. The load error is
 * the "this is not yet implemented" signal.
 *
 * See also:
 *   - command-risk-corpus.ts               (frozen corpus data)
 *   - command-risk-corpus.baseline.test.ts (Group A: today-behaviour freeze)
 */

import { describe, expect, it } from "vitest";

import {
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
} from "./index";
import { CORPUS } from "./command-risk-corpus";
import { evaluateCommandRisk } from "./command-risk";

describe("Group B — V1 contract: evaluateCommandRisk API shape", () => {
	it("returns a structured RiskDecision with required fields", () => {
		const r = evaluateCommandRisk({
			toolInput: "pwd",
			hostAuthorization: commandHostAuthorization({ mode: "all" }),
		});
		expect(r).toBeDefined();
		expect(r.decision).toMatch(/^(allow|ask|deny)$/);
		expect(r.disposition).toMatch(
			/^(auto-approve-eligible|ask|never-auto-approve)$/,
		);
		expect(Array.isArray(r.reasons)).toBe(true);
		expect(r.reasons.length).toBeGreaterThan(0);
	});

	it("parse failure is never auto-approve-eligible (fail-closed)", () => {
		const r = evaluateCommandRisk({
			toolInput: "",
			hostAuthorization: commandHostAuthorization({ mode: "all" }),
		});
		expect(r.decision).toBe("ask");
		expect(r.disposition).not.toBe("auto-approve-eligible");
	});
});

describe("Group B — V1 contract: R0 read-only auto-approve", () => {
	const R0_ALLOW_IDS = [
		"r0-pwd",
		"r0-pwd-L",
		"r0-pwd-P",
		"r0-git-status",
		"r0-git-diff",
		"r0-git-diff-stat",
		"r0-git-log",
		"r0-git-log-oneline",
		"r0-git-rev-parse",
		"r0-git-show",
		"r0-git-rev-list",
	];
	for (const id of R0_ALLOW_IDS) {
		const c = CORPUS.find((x) => x.id === id);
		if (!c) continue;
		it(`R0 ${id} -> auto-approve-eligible (safe-only mode)`, () => {
			const r = evaluateCommandRisk({
				toolInput: c.command,
				hostAuthorization: commandHostAuthorization({
					mode: "safe-only",
					explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
				}),
			});
			expect(r.decision).toBe("allow");
			expect(r.disposition).toBe("auto-approve-eligible");
		});
	}
});

describe("Group B — V1 contract: R5 catastrophic hard floor (mode=all)", () => {
	// The hard floor: even in `mode: all` (CLI --auto-approve), R5
	// destructive HOME/root/outside-workspace commands must NEVER
	// auto-approve. They must produce decision.kind="ask" with
	// disposition="never-auto-approve". This is the central safety
	// invariant the V1 ACT adds on top of the existing safe-rule
	// engine.
	const ALL = commandHostAuthorization({ mode: "all" });
	const R5_IDS = CORPUS.filter((c) => c.family === "R5-catastrophic").map(
		(c) => c.id,
	);
	for (const id of R5_IDS) {
		const c = CORPUS.find((x) => x.id === id);
		if (!c) continue;
		it(`R5 ${id} in 'all' mode -> ${c.requiredDecision} + ${c.requiredDisposition}`, () => {
			const r = evaluateCommandRisk({
				toolInput: c.command,
				hostAuthorization: ALL,
			});
			expect(r.decision, `${id} decision`).toBe(c.requiredDecision);
			expect(r.disposition, `${id} disposition`).toBe(c.requiredDisposition);
		});
	}
});

describe("Group B — V1 contract: wrapper-bypass hard floor (mode=all)", () => {
	const ALL = commandHostAuthorization({ mode: "all" });
	const WRAP_IDS = CORPUS.filter((c) => c.family === "wrapper-bypass").map(
		(c) => c.id,
	);
	for (const id of WRAP_IDS) {
		const c = CORPUS.find((x) => x.id === id);
		if (!c) continue;
		it(`wrapper ${id} in 'all' mode -> ${c.requiredDecision} + ${c.requiredDisposition}`, () => {
			const r = evaluateCommandRisk({
				toolInput: c.command,
				hostAuthorization: ALL,
			});
			expect(r.decision, `${id} decision`).toBe(c.requiredDecision);
			expect(r.disposition, `${id} disposition`).toBe(c.requiredDisposition);
		});
	}
});

describe("Group B — V1 contract: ABLATION (bypassing the risk layer must restore RED)", () => {
	// If `evaluateCommandPolicy` is called WITHOUT the
	// `evaluateCommandRisk` layer on top, the R5 hard floor does NOT
	// fire. The canonical policy returns `allow` for
	// `rm -rf "$HOME"` in `mode: "all"` (CLI --auto-approve) because
	// no host-proven safe rule matches and the canonical policy
	// trusts the user's YOLO opt-in.
	//
	// This is the RED the V1 ACT closes: without the
	// `evaluateCommandRisk` layer, R5 commands auto-approve. With
	// the layer, they don't. The CLI host adapter in
	// `apps/cli/src/runtime/command-policy-host.ts` is the
	// production wiring that adds the layer.
	it("without the risk layer, mode=all allows rm -rf $HOME (the RED)", () => {
		const result = evaluateCommandPolicy({
			toolInput: { command: 'rm -rf "$HOME"', requires_approval: false },
			hostAuthorization: commandHostAuthorization({ mode: "all" }),
		});
		// This is the ACT's documented RED: the canonical policy
		// alone (no risk layer) is vulnerable to YOLO-class
		// destruction.
		expect(result.decision.kind).toBe("allow");
	});
});
describe("Group B — V1 contract: performance budget", () => {
	it("classifies the corpus within an acceptable per-call budget", () => {
		// The V1 classifier runs `evaluateCommandPolicy` (already
		// instrumented at ~1ms per call) plus the floor scan over a
		// ~10-rule array. The total should be well under 10ms per
		// corpus case.
		const SAFE = commandHostAuthorization({ mode: "safe-only" });
		const ALL = commandHostAuthorization({ mode: "all" });
		const cases = CORPUS.filter(
			(c) => c.family === "R0-readonly" || c.family === "R5-catastrophic",
		);
		const start = performance.now();
		for (const c of cases) {
			evaluateCommandRisk({ toolInput: c.command, hostAuthorization: SAFE });
			evaluateCommandRisk({ toolInput: c.command, hostAuthorization: ALL });
		}
		const elapsed = performance.now() - start;
		const perCallUs = (elapsed * 1000) / (cases.length * 2);
		// Sanity: per-call budget under 5ms. Real numbers from the
		// local run are well under 1ms; this is a generous upper
		// bound to catch regressions that add an order of magnitude.
		expect(perCallUs).toBeLessThan(5000);
	});
});

describe("Group B — V1 contract: compound max-risk aggregation", () => {
	const ALL = commandHostAuthorization({ mode: "all" });

	const COMPOUND_IDS = CORPUS.filter(
		(c) => c.family === "compound-aggregation",
	).map((c) => c.id);
	for (const id of COMPOUND_IDS) {
		const c = CORPUS.find((x) => x.id === id);
		if (!c) continue;
		it(`compound ${id} -> matches max-risk across branches`, () => {
			const r = evaluateCommandRisk({
				toolInput: c.command,
				hostAuthorization: ALL,
			});
			if (c.requiredDecision === "allow") {
				expect(r.decision).toBe("allow");
				expect(r.disposition).toBe("auto-approve-eligible");
			} else {
				expect(r.decision, `${id} decision`).toBe("ask");
				expect(r.disposition, `${id} disposition`).toBe(c.requiredDisposition);
			}
		});
	}
});
