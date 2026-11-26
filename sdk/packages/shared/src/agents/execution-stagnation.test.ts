/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1)
 *
 * Pure-contract tests for the runtime execution-stagnation recovery.
 *
 * These tests exercise the DECISION FUNCTION only — no runtime, no model,
 * no clock. The runtime-level qualification lives in
 * `sdk/packages/agents/src/agent-runtime.execution-stagnation-recovery01.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
	applyExecutionStagnationDecision,
	buildExecutionStagnationNoticeMessage,
	createExecutionStagnationAccounting,
	DEFAULT_EXECUTION_STAGNATION_POLICY,
	decideExecutionStagnation,
	foldExecutionRound,
	isExecutionStagnationNoticeMessage,
	parseExecutionStagnationNoticeMessage,
} from "./execution-stagnation";

const POLICY = {
	unproductiveRoundThreshold: 3,
	maxRecoveryInstructions: 2,
	enabled: true,
};

const INSPECTED = {
	productivity: "inspected" as const,
	toolNames: ["read_files"],
	editAttempts: 0,
	successfulEdits: 0,
};

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / pure contract", () => {
	it("no policy means no intervention", () => {
		let accounting = createExecutionStagnationAccounting();
		for (let i = 0; i < 10; i += 1) {
			accounting = foldExecutionRound(accounting, INSPECTED);
		}
		expect(decideExecutionStagnation(accounting, undefined)).toEqual({
			kind: "none",
		});
	});

	it("a disabled policy means no intervention", () => {
		let accounting = createExecutionStagnationAccounting();
		for (let i = 0; i < 10; i += 1) {
			accounting = foldExecutionRound(accounting, INSPECTED);
		}
		expect(
			decideExecutionStagnation(accounting, { ...POLICY, enabled: false }),
		).toEqual({ kind: "none" });
	});

	it("the decision is made only once the threshold is reached", () => {
		let accounting = createExecutionStagnationAccounting();
		accounting = foldExecutionRound(accounting, INSPECTED);
		expect(decideExecutionStagnation(accounting, POLICY).kind).toBe("none");
		accounting = foldExecutionRound(accounting, INSPECTED);
		expect(decideExecutionStagnation(accounting, POLICY).kind).toBe("none");
		accounting = foldExecutionRound(accounting, INSPECTED);
		expect(decideExecutionStagnation(accounting, POLICY).kind).toBe("inject");
	});

	it("a productive round resets the streak but NOT the instruction allowance", () => {
		let accounting = createExecutionStagnationAccounting();
		accounting = foldExecutionRound(accounting, INSPECTED);
		accounting = foldExecutionRound(accounting, INSPECTED);
		accounting = foldExecutionRound(accounting, INSPECTED);
		const decision = decideExecutionStagnation(accounting, POLICY);
		expect(decision.kind).toBe("inject");
		accounting = applyExecutionStagnationDecision(accounting, decision);
		expect(accounting.unproductiveRounds).toBe(0);
		expect(accounting.instructionsInjected).toBe(1);

		// A productive round clears the streak.
		accounting = foldExecutionRound(accounting, {
			productivity: "edited",
			toolNames: ["editor"],
			editAttempts: 1,
			successfulEdits: 1,
		});
		expect(accounting.unproductiveRounds).toBe(0);
		// ...but the RUN-SCOPED allowance survives it.
		expect(accounting.instructionsInjected).toBe(1);
	});

	it("a legitimately WAITING round does not count toward the streak", () => {
		let accounting = createExecutionStagnationAccounting();
		for (let i = 0; i < 20; i += 1) {
			accounting = foldExecutionRound(accounting, {
				productivity: "awaiting",
				toolNames: ["run_commands"],
				editAttempts: 0,
				successfulEdits: 0,
			});
		}
		expect(accounting.unproductiveRounds).toBe(0);
		expect(decideExecutionStagnation(accounting, POLICY).kind).toBe("none");
	});

	it("the allowance is exhausted, not exceeded", () => {
		let accounting = createExecutionStagnationAccounting();
		let injections = 0;
		for (let i = 0; i < 50; i += 1) {
			accounting = foldExecutionRound(accounting, INSPECTED);
			const decision = decideExecutionStagnation(accounting, POLICY);
			if (decision.kind === "inject") {
				injections += 1;
				accounting = applyExecutionStagnationDecision(accounting, decision);
			}
		}
		expect(injections).toBe(POLICY.maxRecoveryInstructions);
	});

	it("the message recogniser matches by EXACT template equality", () => {
		const message = buildExecutionStagnationNoticeMessage(
			5,
			["read_files", "run_commands"],
			0,
		);
		expect(
			isExecutionStagnationNoticeMessage(
				message,
				5,
				["read_files", "run_commands"],
				0,
			),
		).toBe(true);
		// A different round count does not match.
		expect(
			isExecutionStagnationNoticeMessage(
				message,
				6,
				["read_files", "run_commands"],
				0,
			),
		).toBe(false);
		// A different tool set does not match.
		expect(
			isExecutionStagnationNoticeMessage(message, 5, ["read_files"], 0),
		).toBe(false);
		// A different edit count does not match.
		expect(
			isExecutionStagnationNoticeMessage(
				message,
				5,
				["read_files", "run_commands"],
				1,
			),
		).toBe(false);
		// A truncated message does not match.
		expect(
			isExecutionStagnationNoticeMessage(
				message.slice(0, 10),
				5,
				["read_files", "run_commands"],
				0,
			),
		).toBe(false);
	});

	it("the message names only observable facts and asks rather than dictates", () => {
		const message = buildExecutionStagnationNoticeMessage(3, ["read_files"], 2);
		expect(message).toContain("the last 3 consecutive execution round(s)");
		expect(message).toContain("read_files");
		expect(message).toContain("2 edit attempt(s) were made in those rounds.");
		expect(message).toContain(
			"State the single smallest useful experiment or edit",
		);
		// It never asserts a finding.
		expect(message).not.toMatch(/because/i);
		expect(message).not.toMatch(/confirmed/i);
		expect(message).not.toMatch(/the bug/i);
	});

	it("the default policy is bounded and has a positive threshold", () => {
		expect(
			DEFAULT_EXECUTION_STAGNATION_POLICY.unproductiveRoundThreshold,
		).toBeGreaterThan(0);
		expect(
			DEFAULT_EXECUTION_STAGNATION_POLICY.maxRecoveryInstructions,
		).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01)
// The STRUCTURAL RECOGNISER: a notice must be recognised WITHOUT being told
// its parameter triple, because the compaction carry-forward reads the
// canonical history where the parameters are whatever the runtime observed.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / structural recogniser", () => {
	it("parses every renderer-produced notice back to its exact triple", () => {
		const cases: Array<[number, string[], number]> = [
			[5, ["read_files", "run_commands"], 0],
			[3, ["read_files"], 2],
			[7, [], 0],
			[1, ["a"], 1],
			[12, ["x", "y", "z"], 4],
		];
		for (const [rounds, tools, edits] of cases) {
			const text = buildExecutionStagnationNoticeMessage(rounds, tools, edits);
			const parsed = parseExecutionStagnationNoticeMessage(text);
			expect(parsed, text).toBeDefined();
			expect(parsed?.unproductiveRounds).toBe(rounds);
			expect(parsed?.toolNames).toEqual([...tools]);
			expect(parsed?.editAttempts).toBe(edits);
			// The round trip is byte-exact.
			expect(
				buildExecutionStagnationNoticeMessage(
					parsed!.unproductiveRounds,
					parsed!.toolNames,
					parsed!.editAttempts,
				),
			).toBe(text);
		}
	});

	it("rejects anything the renderer could not have produced", () => {
		const rejected: string[] = [
			"",
			"hello",
			"[SYSTEM] Execution has stalled: the last 5",
			// A non-canonical round count.
			"[SYSTEM] Execution has stalled: the last 05 consecutive execution round(s) produced no productive step. State the single smallest useful experiment or edit that would move this task forward, then perform it now. Observable facts: the 05 round(s) used only read_files. No edit was attempted in those rounds.",
			// A non-numeric round count.
			"[SYSTEM] Execution has stalled: the last x consecutive execution round(s) produced no productive step. State the single smallest useful experiment or edit that would move this task forward, then perform it now. Observable facts: the x round(s) used only read_files. No edit was attempted in those rounds.",
			// A tool list that is NOT sorted (the renderer always sorts).
			"[SYSTEM] Execution has stalled: the last 5 consecutive execution round(s) produced no productive step. State the single smallest useful experiment or edit that would move this task forward, then perform it now. Observable facts: the 5 round(s) used only run_commands, read_files. No edit was attempted in those rounds.",
			// Trailing content the renderer never emits.
			"[SYSTEM] Execution has stalled: the last 5 consecutive execution round(s) produced no productive step. State the single smallest useful experiment or edit that would move this task forward, then perform it now. Observable facts: the 5 round(s) used only read_files. No edit was attempted in those rounds. EXTRA",
			// A mismatched round count between the two frames.
			"[SYSTEM] Execution has stalled: the last 5 consecutive execution round(s) produced no productive step. State the single smallest useful experiment or edit that would move this task forward, then perform it now. Observable facts: the 6 round(s) used only read_files. No edit was attempted in those rounds.",
			// A doubled separator before the edit frame.
			"[SYSTEM] Execution has stalled: the last 5 consecutive execution round(s) produced no productive step. State the single smallest useful experiment or edit that would move this task forward, then perform it now. Observable facts: the 5 round(s) used only read_files.  2 edit attempt(s) were made in those rounds.",
		];
		for (const text of rejected) {
			expect(
				parseExecutionStagnationNoticeMessage(text),
				text.slice(0, 80),
			).toBeUndefined();
		}
	});

	it("agrees with the byte-exact recogniser on every renderer-produced notice", () => {
		const cases: Array<[number, string[], number]> = [
			[5, ["read_files", "run_commands"], 0],
			[3, ["read_files"], 2],
		];
		for (const [rounds, tools, edits] of cases) {
			const text = buildExecutionStagnationNoticeMessage(rounds, tools, edits);
			expect(
				isExecutionStagnationNoticeMessage(text, rounds, tools, edits),
			).toBe(true);
			// And a DIFFERENT triple does not recognise it.
			expect(
				isExecutionStagnationNoticeMessage(text, rounds + 1, tools, edits),
			).toBe(false);
		}
	});
});
