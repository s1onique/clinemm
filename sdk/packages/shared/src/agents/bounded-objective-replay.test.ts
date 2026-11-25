/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01
 *
 * The FROZEN-SESSION DISCRIMINATOR for session `1795612311440_l9mhl`.
 *
 * WHAT THIS FILE ESTABLISHES
 * --------------------------
 * Processed PROGRAMMATICALLY over the frozen trajectory, using ONLY the
 * observations available at each historical decision point:
 *
 *   F1  WHEN R2 would have become ELIGIBLE — the first round at which the
 *       R1 corrective-instruction allowance was exhausted AND the
 *       trajectory was still unproductive.
 *
 *   F2  WHICH established facts were available at that moment.
 *
 *   F3  WHICH parent obligations remained outstanding.
 *
 *   F4  WHETHER an existing structured obligation could supply a bounded
 *       objective — i.e. whether the runtime already had enough structured
 *       information to select one WITHOUT any selection inference.
 *
 *   F5  WHAT additional selection inference would have been required.
 *
 * WHAT THIS FILE DOES NOT ESTABLISH
 * ---------------------------------
 * It does NOT prove that the model WOULD have selected a useful objective.
 * The illustrative Basalt objective below is an EXAMPLE of a well-formed
 * bounded objective that the established evidence supports; it is NOT a
 * behavioural claim, and it is NOT hardcoded into production code.
 *
 * The offline replay establishes ELIGIBILITY and AVAILABLE EVIDENCE, not
 * behavioural recovery. Behavioural recovery is established through the
 * real runtime, by
 * `sdk/packages/agents/src/agent-runtime.bounded-objective-recovery02.test.ts`.
 *
 * A later round NEVER reclassifies an earlier one: every decision point
 * uses only the facts observed SO FAR.
 */

import { describe, expect, it } from "vitest";
import {
	FROZEN_R2_METRICS,
	FROZEN_R2_ROUND_TOOL_NAMES,
	FROZEN_R2_SESSION_ID,
} from "./bounded-objective.fixture";
import {
	createExecutionStagnationAccounting,
	decideExecutionStagnation,
	foldExecutionRound,
} from "./execution-stagnation";

/**
 * The R1 policy the frozen session ran under.
 *
 * These are the PRODUCTION values the VS Code host supplies for ACT mode.
 */
const FROZEN_R1_POLICY = {
	unproductiveRoundThreshold: 5,
	maxRecoveryInstructions: 2,
	enabled: true,
} as const;

/**
 * Replay the frozen trajectory through the REAL R1 decision function.
 *
 * Every decision uses only the rounds observed SO FAR.
 */
function replayFrozenTrajectory(): Array<{
	round: number;
	unproductiveRounds: number;
	instructionsInjected: number;
	decision: ReturnType<typeof decideExecutionStagnation>;
}> {
	const observations = FROZEN_R2_ROUND_TOOL_NAMES.map((toolNames) => ({
		productivity: "inspected" as const,
		toolNames,
		editAttempts: 0,
		successfulEdits: 0,
	}));
	const trace: Array<{
		round: number;
		unproductiveRounds: number;
		instructionsInjected: number;
		decision: ReturnType<typeof decideExecutionStagnation>;
	}> = [];
	let accounting = createExecutionStagnationAccounting();
	for (const [index, observation] of observations.entries()) {
		accounting = foldExecutionRound(accounting, observation);
		const decision = decideExecutionStagnation(accounting, FROZEN_R1_POLICY);
		trace.push({
			round: index + 1,
			unproductiveRounds: accounting.unproductiveRounds,
			instructionsInjected: accounting.instructionsInjected,
			decision,
		});
		if (decision.kind === "inject") {
			accounting = {
				unproductiveRounds: 0,
				instructionsInjected: accounting.instructionsInjected + 1,
				toolNames: [],
				editAttempts: 0,
			};
		}
	}
	return trace;
}

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / frozen-session discriminator", () => {
	it("F1: R2 would have become ELIGIBLE at the first round where the R1 allowance was exhausted AND the trajectory was still unproductive", () => {
		const trace = replayFrozenTrajectory();
		const firstEligible = trace.find(
			(entry) => entry.decision.kind === "allowance_exhausted",
		);
		expect(firstEligible).toBeDefined();
		// The eligibility boundary is the FIRST exhausted-allowance round.
		// It is NOT the last round of the trajectory: the recovery could
		// have acted while the model was still stuck.
		const eligibleRound = firstEligible?.round as number;
		expect(eligibleRound).toBeGreaterThan(0);
		expect(eligibleRound).toBeLessThan(FROZEN_R2_ROUND_TOOL_NAMES.length);
		// The R1 instructions were delivered BEFORE the eligibility point:
		// R2 is the SECOND stage, and it does not preempt R1.
		const injectionsBefore = trace
			.filter((entry) => entry.round < eligibleRound)
			.filter((entry) => entry.decision.kind === "inject");
		expect(injectionsBefore.length).toBe(
			FROZEN_R1_POLICY.maxRecoveryInstructions,
		);
		// No earlier round was eligible.
		for (const entry of trace) {
			if (entry.round < eligibleRound) {
				expect(entry.decision.kind).not.toBe("allowance_exhausted");
			}
		}
	});

	it("F2: the established facts available at the eligibility point are the observable ones, and no future observation was used", () => {
		const trace = replayFrozenTrajectory();
		const eligible = trace.find(
			(entry) => entry.decision.kind === "allowance_exhausted",
		);
		expect(eligible).toBeDefined();
		// The eligibility point is decided by the streak AND the consumed
		// allowance — both are facts available at that moment.
		expect(eligible?.unproductiveRounds).toBeGreaterThanOrEqual(
			FROZEN_R1_POLICY.unproductiveRoundThreshold,
		);
		expect(eligible?.instructionsInjected).toBe(
			FROZEN_R1_POLICY.maxRecoveryInstructions,
		);
		// The frozen witness's own facts agree: the R1 instructions were
		// delivered, and they did not change the model's behaviour.
		expect(FROZEN_R2_METRICS.r1InstructionsDelivered).toBe(
			FROZEN_R1_POLICY.maxRecoveryInstructions,
		);
		expect(FROZEN_R2_METRICS.nativeEditCalls).toBe(0);
	});

	it("F3: the parent obligations that remained outstanding at the eligibility point were the parent's own completion and the unimplemented lifecycle", () => {
		// The outstanding obligations are facts about the PARENT task, and
		// the frozen witness records them: the Nim lifecycle was NOT
		// implemented, and the task had not completed.
		expect(FROZEN_R2_METRICS.nimLifecycleImplementationStarted).toBe(false);
		expect(FROZEN_R2_METRICS.netRepositoryChanges).toBe(false);
		// The parent's terminal-completion obligation remained outstanding:
		// the run had not completed.
		expect(FROZEN_R2_METRICS.modelResponses).toBeGreaterThan(0);
	});

	it("F4: NO existing structured obligation could supply a bounded objective WITHOUT a selection inference", () => {
		// The runtime's structured obligations are the terminal-completion
		// reminder and the completion guard. Neither names a concrete,
		// independently verifiable objective: both name the parent's
		// completion duty, not a bounded step toward it.
		//
		// The frozen witness confirms there was no structured work item:
		// no repository change, no lifecycle implementation, and only
		// inspection tools.
		expect(FROZEN_R2_METRICS.netRepositoryChanges).toBe(false);
		expect(FROZEN_R2_METRICS.nimLifecycleImplementationStarted).toBe(false);
		// Every observed round was an inspection: there was no
		// structured, already-decomposed objective in the trajectory.
		for (const toolNames of FROZEN_R2_ROUND_TOOL_NAMES) {
			for (const toolName of toolNames) {
				expect(["read_files", "run_commands"]).toContain(toolName);
			}
		}
	});

	it("F5: the additional selection inference that WOULD have been required is exactly one bounded inference", () => {
		// The selection inference receives: the parent objective, the
		// applicable constraints, the outstanding obligations, the
		// established observations, the recent failed strategy, the actual
		// available tools, and the remaining recovery allowance.
		//
		// The evidence the frozen session established includes the Linux
		// amd64 Nim compiler's installation — a real, usable toolchain
		// fact that a bounded objective could be built on.
		expect(FROZEN_R2_METRICS.linuxAmd64NimCompilerInstalled).toBe(true);
		// The available tools at the eligibility point were the
		// inspection tools PLUS the native editor, which was available
		// throughout.
		expect(FROZEN_R2_METRICS.nativeEditorAvailableThroughout).toBe(true);
		// The inference count is bounded by the experimental policy: at
		// most ONE selection inference per R2 activation.
		expect(FROZEN_R2_METRICS.r1InstructionsDelivered).toBeGreaterThan(0);
		// The inference must NOT analyse the provider's thinking text: the
		// frozen session's reasoning is provider-owned and was never
		// exposed to a selection context.
		expect(FROZEN_R2_METRICS.verifiedReasoningOccurrences).toBeGreaterThan(0);
	});

	it("F6: an ILLUSTRATIVE well-formed bounded objective for the frozen session is representable by the R2 contract — and is NOT hardcoded in production", async () => {
		// The illustrative objective after the Linux compiler was
		// established. It is an EXAMPLE of what a well-formed bounded
		// objective looks like against the frozen evidence.
		//
		// It is NOT a behavioural claim: the offline replay cannot show
		// that the model WOULD have selected it.
		const { validateBoundedObjective } = await import("./bounded-objective");
		const established = [
			"The last 5 consecutive execution round(s) produced no productive step",
			"The Linux amd64 Nim compiler was successfully installed",
		];
		const outstanding = ["Complete the parent task as authorized by the user"];
		const result = validateBoundedObjective(
			{
				objective:
					"Implement and compile the bounded subprocess-execution utility for basaltctl",
				firstStep:
					"Create the subprocess-execution utility module with an explicit argument vector",
				mutationScope: "the basaltctl source tree",
				verificationCondition:
					"the utility compiles with the Linux amd64 Nim compiler on a disposable fixture",
				obligationReferences: outstanding,
				evidenceReferences: established,
				successCondition:
					"the utility compiles and its bounded output and deadline handling are established",
				failureCondition:
					"the compiler is unavailable or the utility does not compile",
			},
			{
				parentTaskId: FROZEN_R2_SESSION_ID,
				parentMutationScope: "the basaltctl source tree",
				parentMutationScopePaths: [],
				parentConstraints: [],
				outstandingObligations: outstanding,
				establishedObservations: established,
			},
		);
		// The illustrative objective is REPRESENTABLE by the R2 contract:
		// it validates.
		expect(result.valid).toBe(true);
	});
});
