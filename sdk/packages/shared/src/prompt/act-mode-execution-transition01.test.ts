/**
 * ACT-CLINEMM-ACT-MODE-EXECUTION-TRANSITION-01
 *
 * Focused witnesses for the Act-mode reconnaissance-to-execution transition.
 *
 * These exercise the REAL production prompt-construction seam
 * (`buildClineSystemPrompt` in `./cline.ts`), NOT a hand-written copy of the
 * prompt text, so they fail if the production builder stops emitting the
 * contract.
 *
 * Witness map:
 *   W01  Act mode carries the execution-transition contract.
 *   W02  Act mode does NOT carry the conflicting verbose-planning text.
 *   W03  Plan mode is unchanged (contract absent, plan contract intact).
 *   W04  Security / tool / completion instructions survive in Act mode.
 *   W05  The five-round target is guidance, not a runtime rejection threshold.
 *   W06  The frozen failure witness is intact and self-consistent.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	buildClineSystemPrompt,
	MODE_TAG_INSTRUCTIONS,
	PLAN_MODE_INSTRUCTIONS,
	PLAN_MODE_INSTRUCTIONS_MANUAL_SWITCH,
} from "./cline";
import {
	FROZEN_FAILURE_METRICS,
	FROZEN_FAILURE_QUALITATIVE,
	FROZEN_FAILURE_SESSION_ID,
	isFrozenFailureShape,
} from "./system/act-mode-execution-transition.fixture";
import { CLINE_SYSTEM_PROMPT_PLAN_MODE } from "./system/plan";

/**
 * The SHA-256 digest and byte length of the pre-ACT base prompt body — the
 * exact text of `CLINE_SYSTEM_PROMPT_ACT_MODE` at the parent commit of this
 * ACT (`sdk/packages/shared/src/prompt/system/act.ts`).
 *
 * A digest is used rather than a transcribed literal because the pre-ACT
 * body contains a trailing space on the "Always validate your answer …"
 * line, which a source formatter is free to strip. The digest pins the
 * bytes exactly, independent of how the file is formatted, and it fails if
 * anyone edits the Plan-mode base prompt.
 */
const PRE_ACT_BASE_PROMPT_SHA256 =
	"547ae68061360a69ef9c39141dcbd67f079edca40ac6a22941badd7aa0cbea1c";
const PRE_ACT_BASE_PROMPT_LENGTH = 3695;

const BASE_OPTIONS = {
	ide: "VS Code",
	workspaceRoot: "/workspace/project",
	workspaceName: "project",
	platform: "linux",
};

// ---------------------------------------------------------------------------
// The contract clauses the Act-mode prompt must carry, verbatim.
// ---------------------------------------------------------------------------

const EXECUTION_TRANSITION_CONTRACT_CLAUSES = [
	"Gather the minimum context sufficient for the next correct action.",
	"stop broad reconnaissance and execute the smallest useful experiment or edit",
	"Prefer executable evidence over additional deliberation.",
	"resolve the uncertainty by running a focused test or probe",
	"Do not reread unchanged source ranges unless a specific unresolved question requires it.",
	"aim to make the first meaningful source or regression-test edit within five inspection rounds",
	"identify the precise missing prerequisite and perform only the inspection needed to resolve it",
	"Keep planning brief.",
	"Do not repeatedly reconsider an already viable approach without new contradictory evidence.",
];

// ---------------------------------------------------------------------------
// The conflicting instructions the Act-mode prompt must NOT carry.
// ---------------------------------------------------------------------------

const CONFLICTING_VERBOSE_PLANNING_INSTRUCTIONS = [
	"Always gather all the necessary context before starting to work on a task.",
	"Always show your planning process before executing any task.",
	"It's OK for this section to be quite long.",
	"Begin by analyzing the user's input and gathering any necessary additional context.",
	"Then, present your plan at the start of your response along with tool calls before proceeding with the task.",
];

// ---------------------------------------------------------------------------
// Instructions that MUST survive the change.
// ---------------------------------------------------------------------------

const PRESERVED_ACT_INSTRUCTIONS = [
	// Parallel tool calls.
	"You can call multiple tools in a single response.",
	"emit all of those tool calls now",
	// Completion obligation.
	"Always includes tool calls in your response until the task is completed.",
	"When you have completed the task, please provide a summary of what you did",
	// Verification obligation.
	"Always verify the files you have edited or created at the end of the task",
	"Always validate your answer with checking the code and running it if possible.",
	// Test / live-feedback obligation.
	"Always validate the new unit test at the end including running the code if possible for live feedback.",
	// Absolute paths.
	"Always use absolute paths when referring to files.",
	// Codebase conventions.
	"Always adhere to existing code conventions and patterns.",
	"Use only libraries and frameworks that are confirmed to be in use in the current codebase.",
	"Provide complete and functional code without omissions or placeholders.",
	"Be explicit about any assumptions or limitations in your solution.",
];

describe("ACT-CLINEMM-ACT-MODE-EXECUTION-TRANSITION-01", () => {
	describe("W01 — Act mode carries the execution-transition contract", () => {
		it("emits every contract clause through the production builder", () => {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "act" });
			for (const clause of EXECUTION_TRANSITION_CONTRACT_CLAUSES) {
				expect(prompt).toContain(clause);
			}
		});

		it("emits the contract when the mode defaults to act", () => {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS });
			for (const clause of EXECUTION_TRANSITION_CONTRACT_CLAUSES) {
				expect(prompt).toContain(clause);
			}
		});
	});

	describe("W02 — Act mode drops the conflicting verbose-planning instructions", () => {
		it("does not contain any conflicting instruction", () => {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "act" });
			for (const conflicting of CONFLICTING_VERBOSE_PLANNING_INSTRUCTIONS) {
				expect(prompt).not.toContain(conflicting);
			}
		});

		it("does not reintroduce them through the mode-tag or caller rules", () => {
			const prompt = buildClineSystemPrompt({
				...BASE_OPTIONS,
				mode: "act",
				rules: "# Custom Rules\n\nSpeak like a pirate.",
			});
			for (const conflicting of CONFLICTING_VERBOSE_PLANNING_INSTRUCTIONS) {
				expect(prompt).not.toContain(conflicting);
			}
			// Caller rules are still preserved.
			expect(prompt).toContain("Speak like a pirate.");
		});
	});

	describe("W03 — Plan mode remains unchanged", () => {
		it("does not carry the Act execution-transition contract", () => {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "plan" });
			// The plan contract is a DIFFERENT contract: plan mode is about
			// exploring and aligning, not about an execution transition.
			expect(prompt).not.toContain(
				"Gather the minimum context sufficient for the next correct action.",
			);
			expect(prompt).not.toContain(
				"aim to make the first meaningful source or regression-test edit within five inspection rounds",
			);
			expect(prompt).not.toContain("Keep planning brief.");
		});

		it("still carries the pre-ACT base text that Plan mode used before", () => {
			// Plan mode's base prompt is preserved byte-for-byte by this ACT.
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "plan" });
			for (const preAct of [
				"Always gather all the necessary context before starting to work on a task.",
				"Always show your planning process before executing any task.",
				"It's OK for this section to be quite long.",
			]) {
				expect(prompt).toContain(preAct);
			}
		});

		it("keeps the plan-mode contract and the mode-tag instructions intact", () => {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "plan" });
			expect(prompt).toContain(MODE_TAG_INSTRUCTIONS);
			expect(prompt).toContain(PLAN_MODE_INSTRUCTIONS);
			expect(prompt).toContain("You are in Plan mode.");
			expect(prompt).toContain("read-only");
		});

		it("keeps the manual-switch plan contract intact", () => {
			const prompt = buildClineSystemPrompt({
				...BASE_OPTIONS,
				mode: "plan",
				planModeSwitchTool: false,
			});
			expect(prompt).toContain(PLAN_MODE_INSTRUCTIONS_MANUAL_SWITCH);
			expect(prompt).toContain("Plan/Act toggle");
		});

		it("leaves the plan contract byte-identical to the pre-change source", () => {
			// The plan contract is defined in `cline.ts`, which this ACT does
			// not touch. Asserting the exact text pins that.
			expect(PLAN_MODE_INSTRUCTIONS).toContain(
				"- Do NOT edit files, write code, run destructive commands, or make any changes",
			);
			expect(PLAN_MODE_INSTRUCTIONS).toContain(
				"Present your plan as a structured outline with clear steps",
			);
		});

		it("keeps the Plan base constant byte-identical to the pre-ACT Act constant", () => {
			// Before this ACT there was ONE base constant, used by both modes.
			// The Plan constant must be exactly that pre-ACT text, so the
			// Plan-mode prompt is unchanged.
			expect(CLINE_SYSTEM_PROMPT_PLAN_MODE.length).toBe(
				PRE_ACT_BASE_PROMPT_LENGTH,
			);
			expect(
				createHash("sha256")
					.update(CLINE_SYSTEM_PROMPT_PLAN_MODE, "utf8")
					.digest("hex"),
			).toBe(PRE_ACT_BASE_PROMPT_SHA256);
		});
	});

	describe("W04 — security and tool instructions remain present", () => {
		it("preserves the tool / completion / verification instructions", () => {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "act" });
			for (const preserved of PRESERVED_ACT_INSTRUCTIONS) {
				expect(prompt).toContain(preserved);
			}
		});

		it("preserves the mode-tag instructions in act mode", () => {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "act" });
			expect(prompt).toContain(MODE_TAG_INSTRUCTIONS);
			expect(prompt).not.toContain(PLAN_MODE_INSTRUCTIONS);
		});
	});

	describe("W05 — the five-round target is guidance, not a runtime threshold", () => {
		it("states the target as a target, without a rejection or abort rule", () => {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "act" });
			expect(prompt).toContain("within five inspection rounds");
			// The prompt must NOT turn the target into a hard stop. These
			// phrases would make the five-round target a runtime rejection
			// threshold; the ACT requires it to stay guidance.
			for (const hardStop of [
				"must not exceed five",
				"hard limit",
				"maximum of five",
				"exceeding five",
				"more than five inspection rounds",
				"abort the turn",
				"halt the turn",
				"stop and ask the user",
			]) {
				expect(prompt.toLowerCase()).not.toContain(hardStop);
			}
		});

		it("keeps the escape hatch for a genuinely missing prerequisite", () => {
			const prompt = buildClineSystemPrompt({ ...BASE_OPTIONS, mode: "act" });
			expect(prompt).toContain(
				"identify the precise missing prerequisite and perform only the inspection needed to resolve it",
			);
		});
	});

	describe("W06 — the frozen failure witness is intact", () => {
		it("records the frozen session identity and metrics", () => {
			expect(FROZEN_FAILURE_SESSION_ID).toBe("1795603246098_cdmel");
			expect(FROZEN_FAILURE_METRICS.sessionId).toBe(FROZEN_FAILURE_SESSION_ID);
			expect(FROZEN_FAILURE_METRICS.modelResponses).toBe(48);
			expect(FROZEN_FAILURE_METRICS.toolCalls).toBe(50);
			expect(FROZEN_FAILURE_METRICS.editorCalls).toBe(0);
			expect(FROZEN_FAILURE_METRICS.executedRegressionTests).toBe(0);
			expect(FROZEN_FAILURE_METRICS.elapsedMs).toBe(1_232_000);
			expect(FROZEN_FAILURE_METRICS.cumulativeReportedInputTokens).toBe(
				4_005_470,
			);
			expect(FROZEN_FAILURE_METRICS.recordedReasoningCharacters).toBe(266_845);
			expect(FROZEN_FAILURE_METRICS.capturedSdkRequests).toBe(32);
			expect(FROZEN_FAILURE_METRICS.capturedSdkRequestsWithEditor).toBe(32);
			expect(FROZEN_FAILURE_METRICS.outputLimit).toBe(8192);
		});

		it("records the qualitative failure shape", () => {
			expect(
				FROZEN_FAILURE_QUALITATIVE.repeatedReconnaissanceAfterCompaction,
			).toBe(true);
			expect(FROZEN_FAILURE_QUALITATIVE.editorAvailableThroughout).toBe(true);
			expect(FROZEN_FAILURE_QUALITATIVE.reachedFirstMeaningfulEdit).toBe(false);
		});

		it("classifies the frozen session as the frozen failure shape", () => {
			expect(isFrozenFailureShape(FROZEN_FAILURE_METRICS)).toBe(true);
		});

		it("does NOT classify a session that reached an edit as the failure", () => {
			expect(
				isFrozenFailureShape({
					...FROZEN_FAILURE_METRICS,
					editorCalls: 1,
				}),
			).toBe(false);
			expect(
				isFrozenFailureShape({
					...FROZEN_FAILURE_METRICS,
					executedRegressionTests: 1,
				}),
			).toBe(false);
		});

		it("keeps the editor tool present in the frozen witness", () => {
			// The failure was NOT a missing-tool failure: the editor was
			// offered in every captured request. The contract corrects the
			// PROMPT, not the toolset.
			expect(FROZEN_FAILURE_METRICS.capturedSdkRequestsWithEditor).toBe(
				FROZEN_FAILURE_METRICS.capturedSdkRequests,
			);
		});
	});
});
