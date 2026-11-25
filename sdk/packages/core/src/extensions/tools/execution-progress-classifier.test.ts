/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1)
 *
 * Tests for the host-side classification of a `run_commands` call into
 * INSPECTION vs EXECUTION.
 *
 * The classification exists because the RUNTIME cannot make this judgement
 * from shell text, and because the frozen failure session's stall was made
 * almost entirely of read-only shell commands (`git log`, `grep`, `ls`,
 * `sed -n`) that a naive "a command ran, so it is progress" reading would
 * have mistaken for progress.
 */
import { describe, expect, it } from "vitest";
import {
	createHostExecutionProgressClassifier,
	isInspectionCommandInput,
} from "./execution-progress-classifier";

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / host classifier", () => {
	it("recognises the read-only inspection commands the frozen stall was made of", () => {
		// These are the EXACT command shapes the frozen session's stall used.
		expect(
			isInspectionCommandInput({
				commands: ["cd /repo && git log --oneline -5 && git status --short"],
			}),
		).toBe(true);
		expect(
			isInspectionCommandInput({
				commands: ["cd /repo && git show --stat 7d57559ac"],
			}),
		).toBe(true);
		expect(
			isInspectionCommandInput({
				commands: ["cd /repo && ls sdk/packages/llms/src"],
			}),
		).toBe(true);
		expect(
			isInspectionCommandInput({
				commands: [
					'cd /repo && grep -rn "incompleteReason" sdk/packages/core/src',
				],
			}),
		).toBe(true);
		expect(
			isInspectionCommandInput({
				commands: ["cd /repo && sed -n 1020,1060p sdk/packages/core/src/x.ts"],
			}),
		).toBe(true);
		expect(
			isInspectionCommandInput({
				commands: ["cd /repo && grep -rn x sdk && ls sdk"],
			}),
		).toBe(true);
	});

	it("recognises a REAL execution as an execution, not an inspection", () => {
		// A test run, a build, a probe, a mutation — none is inspection.
		expect(
			isInspectionCommandInput({
				commands: ["cd /repo && bunx vitest run src/providers"],
			}),
		).toBe(false);
		expect(isInspectionCommandInput({ commands: ["bun run build"] })).toBe(
			false,
		);
		expect(isInspectionCommandInput({ commands: ["bun probe2.ts"] })).toBe(
			false,
		);
		expect(
			isInspectionCommandInput({ commands: ["git commit -m 'fix'"] }),
		).toBe(false);
		expect(
			isInspectionCommandInput({ commands: ["git stash push -- sdk"] }),
		).toBe(false);
		expect(
			isInspectionCommandInput({ commands: ["sed -i 's/a/b/' file.ts"] }),
		).toBe(false);
		expect(isInspectionCommandInput({ commands: ["rm -rf build"] })).toBe(
			false,
		);
	});

	it("one real execution in the list makes the whole call an execution", () => {
		expect(
			isInspectionCommandInput({
				commands: ["cd /repo && git log --oneline -5 && bunx vitest run"],
			}),
		).toBe(false);
	});

	it("an unknown program is NEVER an inspection (the safe default is execution)", () => {
		expect(
			isInspectionCommandInput({ commands: ["some-unknown-tool --flag"] }),
		).toBe(false);
	});

	it("the wrapper programs are transparent", () => {
		expect(
			isInspectionCommandInput({
				commands: ["cd /repo && timeout 180 git log --oneline -5"],
			}),
		).toBe(true);
	});

	it("a non-command input is never an inspection", () => {
		expect(isInspectionCommandInput({})).toBe(false);
		expect(isInspectionCommandInput({ commands: [] })).toBe(false);
		expect(isInspectionCommandInput(undefined)).toBe(false);
		expect(
			isInspectionCommandInput({ commands: [{ command: "git", args: [] }] }),
		).toBe(false);
	});

	it("the classifier hook defers to the runtime for every tool except run_commands", () => {
		const classify = createHostExecutionProgressClassifier();
		// Not a command tool: no opinion.
		expect(
			classify("read_files", { files: [] }, { output: "x" }),
		).toBeUndefined();
		expect(
			classify("editor", { path: "/a", new_text: "b" }, { output: "x" }),
		).toBeUndefined();
		// A command tool: an opinion.
		expect(
			classify("run_commands", { commands: ["git log"] }, { output: "x" }),
		).toBe("inspected");
		expect(
			classify("run_commands", { commands: ["bun test"] }, { output: "x" }),
		).toBe("executed");
		// A FAILED command: the host reports the failure explicitly.
		//
		// ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01: the host
		// used to DECLINE here, and the runtime's fallback then reported the
		// same call as an execution — the host's authoritative negative
		// observation disappeared at that boundary. The failure is now
		// reported explicitly, so it survives the boundary.
		expect(
			classify(
				"run_commands",
				{ commands: ["git log"] },
				{ output: "x", isError: true },
			),
		).toBe("failed");
	});
});
