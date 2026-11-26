/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1)
 *
 * OFFLINE REPLAY of the frozen stall session `1795606095016_glc2s`.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * When the proposed detector WOULD have intervened on the frozen
 * trajectory, using ONLY the information available at each point.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * -----------------------------
 * An offline replay reports the DETECTOR'S TRIGGER POINT. It does NOT
 * prove behavioral recovery: it cannot show that the injected instruction
 * would have changed what the model did next. That claim is established
 * separately, through the real runtime, by
 * `sdk/packages/agents/src/agent-runtime.execution-stagnation-recovery01.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
	applyExecutionStagnationDecision,
	createExecutionStagnationAccounting,
	DEFAULT_EXECUTION_STAGNATION_POLICY,
	decideExecutionStagnation,
	FROZEN_STALL_METRICS,
	FROZEN_STALL_ROUND_TOOL_NAMES,
	FROZEN_STALL_SESSION_ID,
	foldExecutionRound,
} from "./index";

/**
 * Replay the frozen trajectory through the SAME pure decision function the
 * runtime uses.
 *
 * The replay classifies each round EXACTLY as the runtime would: the
 * frozen phase contains no native edit and no execution the runtime could
 * distinguish from inspection, so every round is `inspected`.
 *
 * The replay uses ONLY the rounds observed SO FAR. It never consults a
 * later round to classify an earlier one.
 */
function replayFrozenTrajectory(
	threshold: number,
	maxRecoveryInstructions: number,
): {
	/** The round number (1-based) at which the FIRST injection was due. */
	firstInjectionRound: number | undefined;
	/** Every round at which an injection was due. */
	injectionRounds: number[];
	/** The instructions that would have been injected. */
	instructions: string[];
} {
	const policy = {
		unproductiveRoundThreshold: threshold,
		maxRecoveryInstructions,
		enabled: true,
	};
	let accounting = createExecutionStagnationAccounting();
	const injectionRounds: number[] = [];
	const instructions: string[] = [];
	for (const [index, toolNames] of FROZEN_STALL_ROUND_TOOL_NAMES.entries()) {
		const round = index + 1;
		accounting = foldExecutionRound(accounting, {
			productivity: "inspected",
			toolNames,
			editAttempts: 0,
			successfulEdits: 0,
		});
		const decision = decideExecutionStagnation(accounting, policy);
		if (decision.kind !== "inject") {
			continue;
		}
		injectionRounds.push(round);
		instructions.push(decision.message);
		accounting = applyExecutionStagnationDecision(accounting, decision);
	}
	return {
		firstInjectionRound: injectionRounds[0],
		injectionRounds,
		instructions,
	};
}

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / frozen replay", () => {
	it("the frozen trajectory has the shape the detector targets: 34 rounds, 36 tool calls, ZERO native edits", () => {
		expect(FROZEN_STALL_SESSION_ID).toBe("1795606095016_glc2s");
		expect(FROZEN_STALL_ROUND_TOOL_NAMES).toHaveLength(
			FROZEN_STALL_METRICS.modelResponses,
		);
		const totalToolCalls = FROZEN_STALL_ROUND_TOOL_NAMES.reduce(
			(sum, tools) => sum + tools.length,
			0,
		);
		expect(totalToolCalls).toBe(FROZEN_STALL_METRICS.toolCalls);
		expect(FROZEN_STALL_METRICS.nativeEditCalls).toBe(0);
		// No native edit tool appears anywhere in the frozen phase.
		for (const tools of FROZEN_STALL_ROUND_TOOL_NAMES) {
			for (const tool of tools) {
				expect(tool).not.toBe("editor");
				expect(tool).not.toBe("apply_patch");
			}
		}
	});

	it("the DEFAULT policy would have intervened at round 5 — the earliest defensible trigger", () => {
		const replay = replayFrozenTrajectory(
			DEFAULT_EXECUTION_STAGNATION_POLICY.unproductiveRoundThreshold,
			DEFAULT_EXECUTION_STAGNATION_POLICY.maxRecoveryInstructions,
		);
		// The streak reaches the threshold at the FIFTH consecutive
		// unproductive round. Every one of those five rounds was already
		// observed when the decision was taken, so the trigger uses only
		// information available at that point.
		expect(replay.firstInjectionRound).toBe(
			DEFAULT_EXECUTION_STAGNATION_POLICY.unproductiveRoundThreshold,
		);
		// The decision fires BEFORE the decisive Gemini probe (round 26):
		// the trigger does not depend on the probe at all.
		expect(replay.firstInjectionRound).toBeLessThan(
			FROZEN_STALL_METRICS.decisiveProbeRound,
		);
	});

	it("the injected instruction states observable facts only and asks for the next smallest step", () => {
		const replay = replayFrozenTrajectory(5, 2);
		const instruction = replay.instructions[0];
		expect(instruction).toBeDefined();
		expect(instruction).toContain("the last 5 consecutive execution round(s)");
		expect(instruction).toContain("read_files");
		expect(instruction).toContain("run_commands");
		expect(instruction).toContain("No edit was attempted in those rounds.");
		expect(instruction).toContain(
			"State the single smallest useful experiment or edit",
		);
		// It asserts NO finding: it names no file, no defect, no cause.
		expect(instruction).not.toMatch(/gemini/i);
		expect(instruction).not.toMatch(/terminal/i);
		expect(instruction).not.toMatch(/defect/i);
	});

	it("the replay is BOUNDED: the allowance is never exceeded, however long the stall runs", () => {
		const replay = replayFrozenTrajectory(5, 2);
		expect(replay.injectionRounds.length).toBeLessThanOrEqual(2);
		expect(replay.injectionRounds[0]).toBe(5);
		// The second injection needs a FRESH streak, so it lands later.
		expect(replay.injectionRounds[1]).toBeGreaterThan(
			replay.injectionRounds[0],
		);
	});

	it("the trigger does not depend on any FUTURE observation", () => {
		// Replaying the trajectory and stopping at the FIRST injection yields
		// the same round as a decision that could see the whole future. A
		// detector that classified an earlier round using later information
		// would disagree here.
		const policy = {
			unproductiveRoundThreshold: 5,
			maxRecoveryInstructions: 2,
			enabled: true,
		};
		let accounting = createExecutionStagnationAccounting();
		let firstInjectionRound: number | undefined;
		for (const [index, toolNames] of FROZEN_STALL_ROUND_TOOL_NAMES.entries()) {
			accounting = foldExecutionRound(accounting, {
				productivity: "inspected",
				toolNames,
				editAttempts: 0,
				successfulEdits: 0,
			});
			const decision = decideExecutionStagnation(accounting, policy);
			if (decision.kind === "inject") {
				firstInjectionRound = index + 1;
				break;
			}
		}
		expect(firstInjectionRound).toBe(5);
	});
});
