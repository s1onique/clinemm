/**
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01
 *
 * FOCUSED PRODUCTION CLASSIFIER RED for the reproduced execution-progress
 * classification defects.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * The PRODUCTION host classifier (`createHostExecutionProgressClassifier` and
 * `isInspectionCommandInput`, the real module under
 * `sdk/packages/core/src/extensions/tools/execution-progress-classifier.ts`)
 * currently MISCLASSIFIES reconnaissance as productive execution. The
 * independent review executed the extracted production classifier and
 * reproduced SEVEN counterexamples; each one is reproduced here against the
 * actual production classifier.
 *
 * The reproduced defect is NOT specific to SSH. It is a general defect in the
 * classifier's decision shape:
 *
 *     return isInspectionCommandInput(input) ? "inspected" : "executed";
 *
 * Anything the classifier fails to positively recognise as an inspection
 * becomes EXECUTION — an optimistic default that systematically UNDERDETECTS
 * stagnation. The classifier has no distinction between:
 *
 *   - recognised execution,
 *   - unrecognised inspection,
 *   - shell environment setup,
 *   - unknown command semantics.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * -----------------------------
 * It does not prove that any of these commands changes the runtime's
 * behaviour, and it does not prove live recovery. It proves the CLASSIFIER's
 * verdict for the exact historical command strings.
 *
 * EVIDENCE CLASS
 * --------------
 * SYNTHETIC_REAL_PRODUCTION_SEAM — the classifier is the real production
 * module; the command strings are CLASSIFICATION INPUTS ONLY and are NEVER
 * executed by this file.
 */
import type { ExecutionRoundProductivity } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createHostExecutionProgressClassifier,
	isInspectionCommandInput,
} from "./execution-progress-classifier";

/**
 * The verdict a `run_commands` call receives.
 *
 * The production classifier returns the round-level productivity the call
 * contributes. `undefined` means the host DECLINED to classify and the
 * runtime's own structural reading governs.
 */
type Verdict = ExecutionRoundProductivity | undefined;

/** Classify one `run_commands` call through the REAL production classifier. */
function classify(commands: string[]): Verdict {
	return createHostExecutionProgressClassifier()(
		"run_commands",
		{ commands },
		{ output: "ok" },
	);
}

describe("ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 / reproduced counterexamples", () => {
	it("reproduces the reviewer's seven classification counterexamples against the production classifier", () => {
		// [command, required verdict]
		//
		// The command strings are the EXACT observed historical command forms,
		// including environment assignments preceding SSH and quoted remote
		// payloads. They are CLASSIFICATION INPUTS ONLY: this file never
		// executes them.
		const cases: ReadonlyArray<readonly [string, "inspected" | "executed"]> = [
			// A remote read is a remote READ: SSH is a transport wrapper, not
			// a productivity classification.
			["ssh host 'grep -n foo bar'", "inspected"],
			// A shell assignment segment is SETUP, not work. The assignment
			// must not make the whole command an execution.
			["L=/tmp; grep -n foo bar", "inspected"],
			// The same assignment with no separator.
			["L=/tmp grep -n foo bar", "inspected"],
			// `export` is environment setup.
			["export X=1; ls", "inspected"],
			// A common environment inspection command.
			["uname -a", "inspected"],
			// `git tag <name>` CREATES a tag: it is a mutation, not an
			// inspection, even though bare `git tag` only lists tags.
			["git tag new-tag", "executed"],
			// `git status > file` writes a file: it is a mutation.
			["git status > file", "executed"],
		];
		for (const [command, required] of cases) {
			expect(
				{ command, verdict: classify([command]) },
				`command: ${command}`,
			).toEqual({ command, verdict: required });
		}
	});

	it("keeps a remote MUTATION classified as execution", () => {
		// The repair must not turn SSH into an inspection prefix: a remote
		// mutation is real work.
		expect(classify(["ssh host 'mkdir -p /tmp/x'"])).toBe("executed");
		// Remote compilation, testing and installation are execution too.
		expect(classify(["ssh host 'make build'"])).toBe("executed");
		expect(classify(["ssh host 'pytest -q'"])).toBe("executed");
		expect(classify(["ssh host 'curl -sI https://example.com'"])).toBe(
			"executed",
		);
	});

	it("classifies a MIXED inspection-plus-implementation command as execution", () => {
		// One real execution in the call makes the whole call an execution.
		expect(classify(["ssh host 'grep -n foo bar && make build'"])).toBe(
			"executed",
		);
		expect(classify(["L=/tmp; grep -n foo bar; make build"])).toBe("executed");
	});

	it("keeps a local inspection an inspection and a local mutation an execution", () => {
		expect(classify(["grep foo bar"])).toBe("inspected");
		expect(classify(["git log --oneline -5"])).toBe("inspected");
		expect(classify(["rm -rf build"])).toBe("executed");
	});
});

describe("ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 / unknown command disposition", () => {
	it("does NOT claim a SEMANTIC reading for an unknown program", () => {
		// The classifier is a RECOVERY HEURISTIC, not a security boundary.
		// An unknown program must not be reported as a confident
		// "inspected" verdict it cannot justify.
		expect(
			isInspectionCommandInput({ commands: ["some-unknown-tool --flag"] }),
		).toBe(false);
	});
});

describe("ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 / execution-outcome authority", () => {
	it("reports the host's FAILED observation explicitly instead of letting the runtime fallback call it 'executed'", () => {
		// The composed production counterexample:
		//
		//   - Tool: run_commands.
		//   - Structured result: exitCode = 1.
		//   - Dispatch isError = false.
		//
		// The host classifier used to DECLINE (return `undefined`) because
		// it has no authority to claim success about a command that failed.
		// The runtime's fallback then re-classified the very same call as
		// "executed", because the fallback checked only `isError`. The
		// host's authoritative negative observation DISAPPEARED.
		//
		// The repair reports the failure EXPLICITLY, so the observation
		// survives the boundary.
		const classifyProduction = createHostExecutionProgressClassifier();
		const failedObservation = {
			output: [{ exitCode: 1, ok: true }],
			isError: false,
		};
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["grep -n foo bar"] },
				failedObservation,
			),
		).toBe("failed");
		// The same for a dispatch-level error.
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["grep -n foo bar"] },
				{ output: "command failed", isError: true },
			),
		).toBe("failed");
	});

	it("does NOT establish successful execution from a MISSING execution outcome", () => {
		// Neither a successful dispatch nor an absent result establishes
		// that the command ran and succeeded.
		const classifyProduction = createHostExecutionProgressClassifier();
		// The result object carries NO output at all: the outcome is
		// missing.
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["grep -n foo bar"] },
				{ output: undefined },
			),
		).toBe("failed");
		// The result object itself is absent.
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["grep -n foo bar"] },
				undefined,
			),
		).toBe("failed");
	});

	it("keeps a plain-text COMPLETED observation classified by the command shape", () => {
		// A plain-text output is the production shape of a completed command
		// that reported no structured envelope. It is NOT a missing outcome,
		// so the command shape still governs the verdict.
		//
		// The KNOWN LIMITATION, stated honestly: the classifier cannot
		// distinguish a completed command with no structured envelope from a
		// command whose outcome was never reported. It therefore treats a
		// plain-text observation as a completed observation. This is the
		// documented residual limitation of the correction, not a claim of
		// complete outcome detection.
		const classifyProduction = createHostExecutionProgressClassifier();
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["grep -n foo bar"] },
				{ output: "some plain text" },
			),
		).toBe("inspected");
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["bun test"] },
				{ output: "some plain text" },
			),
		).toBe("executed");
	});

	it("still DECLINES a STILL RUNNING observation so the runtime's 'awaiting' reading governs", () => {
		// A legitimate wait is neither an execution nor a failure.
		const classifyProduction = createHostExecutionProgressClassifier();
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["bun run build"] },
				{
					output: JSON.stringify({
						status: "running",
						jobId: "cmd_job_0001",
						elapsedMs: 15000,
					}),
				},
			),
		).toBeUndefined();
	});

	it("still classifies a COMPLETED execution as an execution", () => {
		// The completed-outcome path must not be weakened by the failure
		// path: a successful execution is still an execution.
		const classifyProduction = createHostExecutionProgressClassifier();
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["bun test"] },
				{ output: [{ exitCode: 0, ok: true }] },
			),
		).toBe("executed");
		expect(
			classifyProduction(
				"run_commands",
				{ commands: ["git log"] },
				{ output: [{ exitCode: 0, ok: true }] },
			),
		).toBe("inspected");
	});
});
