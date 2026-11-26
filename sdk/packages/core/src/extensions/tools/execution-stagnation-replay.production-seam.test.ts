/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1)
 *
 * PRODUCTION-SEAM REPLAY of the frozen stall session `1795606095016_glc2s`.
 *
 * This test drives the REAL host classifier
 * (`createHostExecutionProgressClassifier`) and the REAL pure decision
 * function (`foldExecutionRound` / `decideExecutionStagnation` /
 * `applyExecutionStagnationDecision`) over the frozen trajectory.
 *
 * WHAT IT PROVES
 * --------------
 * WHEN the proposed detector WOULD have intervened on the frozen
 * trajectory, using only the information available at each point.
 *
 * WHAT IT DOES NOT PROVE
 * ----------------------
 * An offline replay reports the DETECTOR'S TRIGGER POINT. It does NOT
 * prove behavioral recovery: it cannot show that the injected instruction
 * would have changed what the model did next. Behavioral recovery is
 * established separately, through the real runtime, by
 * `sdk/packages/agents/src/agent-runtime.execution-stagnation-recovery01.test.ts`.
 */
import {
	applyExecutionStagnationDecision,
	createExecutionStagnationAccounting,
	DEFAULT_EXECUTION_STAGNATION_POLICY,
	decideExecutionStagnation,
	type ExecutionRoundObservation,
	FROZEN_STALL_METRICS,
	FROZEN_STALL_ROUND_TOOL_NAMES,
	foldExecutionRound,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createHostExecutionProgressClassifier } from "./execution-progress-classifier";

/**
 * The frozen session's COMMAND SHAPES, reduced to their path-free program
 * sequence.
 *
 * The frozen transcript is operator-local and private and is NEVER
 * committed. What is committed here is the SHAPE of each round's commands:
 * the sequence of PROGRAMS each round invoked, with every path argument
 * replaced by a placeholder.
 *
 * The shape is sufficient for the classifier (which only reads the program
 * names and the mutating-construct scan) and it contains no path, no file
 * content, no command output, and no model reasoning.
 */
const FROZEN_STALL_ROUND_COMMAND_PROGRAMS: readonly (readonly string[])[] = [
	["cd", "git log", "git status", "head", "cd", "ls", "cat", "head"],
	["cd", "git show", "cd", "ls"],
	[],
	["cd", "ls", "ls", "head", "cd", "grep", "head"],
	["cd", "grep", "head", "cd", "grep", "head"],
	[],
	["cd", "grep", "head", "cd", "grep", "head"],
	[],
	["cd", "grep", "head", "cd", "grep", "head"],
	[],
	[],
	[],
	["cd", "grep", "head", "cd", "grep", "head"],
	[
		"cd",
		"grep",
		"head",
		"grep",
		"grep",
		"head",
		"cd",
		"grep",
		"head",
		"grep",
		"head",
	],
	["cd", "sed", "cd", "grep", "head"],
	[],
	[],
	["cd", "grep", "grep", "grep", "head", "cd", "grep", "grep", "head"],
	["cd", "grep", "grep", "grep", "head"],
	[],
	[],
	[],
	[],
	["cd", "bun", "1", "tail"],
	["which", "ls", "ls", "head"],
	["cd", "bun", "1", "tail"],
	[
		"cd",
		"bun",
		"1",
		"tail",
		"cd",
		"bun",
		"1",
		"tail",
		"cd",
		"bun",
		"1",
		"tail",
	],
	["cd", "grep", "head", "cd", "grep", "grep", "head"],
	[],
	[],
	[],
	["cd", "grep", "grep", "head", "cd", "grep", "head", "cd", "ls", "head"],
	["cd", "grep", "sed"],
	[],
];
/**
 * Rebuild a `run_commands` input from a round's program sequence.
 */
function buildCommandInput(programs: readonly string[]): {
	commands: string[];
} {
	return {
		commands: programs.map((program) =>
			program.startsWith("git ") ? `git ${program.slice(4)}` : program,
		),
	};
}

/**
 * Replay the frozen trajectory through the REAL host classifier and the
 * REAL pure decision function.
 */
function replayFrozenTrajectory(): {
	firstInjectionRound: number | undefined;
	injectionRounds: number[];
	instructions: string[];
} {
	const classify = createHostExecutionProgressClassifier();
	const policy = DEFAULT_EXECUTION_STAGNATION_POLICY;
	let accounting = createExecutionStagnationAccounting();
	const injectionRounds: number[] = [];
	const instructions: string[] = [];
	for (const [
		index,
		programs,
	] of FROZEN_STALL_ROUND_COMMAND_PROGRAMS.entries()) {
		const round = index + 1;
		// The HOST classifies the round's command call. A round with NO
		// command call carries no command verdict at all — it is classified
		// by the runtime's own structural rules (a read-only round).
		const hasCommandCall = programs.length > 0;
		const verdict = hasCommandCall
			? classify("run_commands", buildCommandInput(programs), {
					output: "output",
				})
			: undefined;
		const observation: ExecutionRoundObservation = {
			productivity: verdict === "executed" ? "executed" : "inspected",
			toolNames: FROZEN_STALL_ROUND_TOOL_NAMES[index] ?? [],
			editAttempts: 0,
			successfulEdits: 0,
		};
		accounting = foldExecutionRound(accounting, observation);
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

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / production-seam replay", () => {
	it("the frozen trajectory is 34 rounds with 36 tool calls and ZERO native edits", () => {
		expect(FROZEN_STALL_ROUND_COMMAND_PROGRAMS).toHaveLength(
			FROZEN_STALL_METRICS.modelResponses,
		);
		const totalToolCalls = FROZEN_STALL_ROUND_TOOL_NAMES.reduce(
			(sum, tools) => sum + tools.length,
			0,
		);
		expect(totalToolCalls).toBe(FROZEN_STALL_METRICS.toolCalls);
		expect(FROZEN_STALL_METRICS.nativeEditCalls).toBe(0);
	});

	it("the detector WOULD have intervened at round 5 — the earliest defensible trigger", () => {
		const replay = replayFrozenTrajectory();
		// Round 5 is the first round at which FIVE consecutive
		// unproductive rounds have been observed. Every one of those five
		// rounds was already in hand when the decision was taken, so the
		// trigger uses only information available at that point.
		expect(replay.firstInjectionRound).toBe(5);
		// It fires LONG BEFORE the decisive Gemini terminal-status probe
		// (round 26): the trigger does not depend on the probe at all.
		expect(replay.firstInjectionRound).toBeLessThan(
			FROZEN_STALL_METRICS.decisiveProbeRound,
		);
	});

	it("the injection is BOUNDED: at most the run-scoped allowance", () => {
		const replay = replayFrozenTrajectory();
		expect(replay.injectionRounds.length).toBeLessThanOrEqual(
			DEFAULT_EXECUTION_STAGNATION_POLICY.maxRecoveryInstructions,
		);
		expect(replay.injectionRounds.length).toBeGreaterThan(0);
	});

	it("the injected instruction describes observable facts only", () => {
		const replay = replayFrozenTrajectory();
		const instruction = replay.instructions[0];
		expect(instruction).toBeDefined();
		expect(instruction).toContain("the last 5 consecutive execution round(s)");
		expect(instruction).toContain("read_files");
		expect(instruction).toContain("No edit was attempted in those rounds.");
		expect(instruction).toContain(
			"State the single smallest useful experiment or edit",
		);
		// It asserts no finding and names no path.
		expect(instruction).not.toMatch(/gemini/i);
		expect(instruction).not.toMatch(/\/Volumes\//);
		expect(instruction).not.toMatch(/defect/i);
	});
});
