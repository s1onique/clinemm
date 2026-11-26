/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01)
 *
 * HOST CLASSIFIER OUTCOME CONSERVATION.
 *
 * The host classifier is the HOST's contribution to the runtime's
 * execution-stagnation recovery: the runtime cannot tell a read-only shell
 * inspection from a real execution without reading command text, and
 * command-text string matching is what this repository forbids, so the host
 * — which owns the command-policy layer — supplies that judgement.
 *
 * The host's judgement must be CONSERVATIVE: it must not OVERRIDE a
 * legitimate AWAITING observation or a FAILED-command observation with its
 * own inspection/execution verdict.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 *
 *   HC1  The INSTALLED host classifier declines a `run_commands` call whose
 *        observation reports the command is STILL RUNNING, so the runtime's
 *        own "awaiting" reading governs.
 *   HC2  The INSTALLED host classifier declines a FAILED command, so the
 *        runtime's own structural reading governs.
 *   HC3  The INSTALLED host classifier declines a non-`run_commands` tool
 *        (for example `command_status`), so the runtime's own structural
 *        reading governs.
 *   HC4  The classifier still classifies a COMPLETED inspection command as
 *        "inspected" and a COMPLETED execution command as "executed": the
 *        conservation did not weaken the host's own contribution.
 *
 * The tool RESULT SHAPES are the REAL production shapes:
 * `apps/vscode/src/sdk/vscode-run-commands-tool.ts` (the RUNNING envelope)
 * and `apps/vscode/src/sdk/command-status-tool.ts` (the snapshot).
 *
 * EVIDENCE CLASS
 * --------------
 *
 * SYNTHETIC_REAL_PRODUCTION_SEAM.
 */
import { describe, expect, it } from "vitest";
import { createHostExecutionProgressClassifier } from "./execution-progress-classifier";

/** The ONE identified job this witness observes. */
const JOB_ID = "cmd_synthetic_job_0001";

/**
 * The production `run_commands` RUNNING envelope, as the production tool
 * returns it: `JSON.stringify(runningPayload)`.
 */
function productionRunningEnvelope(): string {
	return JSON.stringify({
		status: "running",
		jobId: JOB_ID,
		elapsedMs: 15000,
		deadlineRemainingMs: 585000,
		outputTruncated: false,
		stdout: "",
	});
}

/**
 * The production `command_status` snapshot, as the production tool returns
 * it: an ARRAY of operation results.
 */
function productionRunningSnapshot(): unknown {
	return [
		{
			ok: true,
			jobId: JOB_ID,
			state: "running",
			elapsedMs: 30000,
			deadlineRemainingMs: 570000,
			stdout: "",
			stderr: "",
			outputTruncated: false,
		},
	];
}

/** The production `command_status` snapshot of a job that FAILED. */
function productionFailedSnapshot(): unknown {
	return [
		{
			ok: true,
			jobId: JOB_ID,
			state: "exited",
			elapsedMs: 31000,
			deadlineRemainingMs: 569000,
			stdout: "",
			stderr: "command failed",
			outputTruncated: false,
			exitCode: 1,
		},
	];
}

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / host classifier conservation", () => {
	it("HC1: the installed host classifier declines a STILL RUNNING command observation", () => {
		const classify = createHostExecutionProgressClassifier();
		// The command is a read-only inspection, so the classifier WOULD say
		// "inspected" — but the observation says it is STILL RUNNING, so the
		// host MUST decline and let the runtime's "awaiting" reading govern.
		expect(
			classify(
				"run_commands",
				{ commands: ["git log"] },
				{ output: productionRunningEnvelope() },
			),
		).toBeUndefined();
		// The same for a command that is not an inspection: the classifier
		// would have said "executed", which would have MANUFACTURED a
		// progress signal for a job that has produced no evidence yet.
		expect(
			classify(
				"run_commands",
				{ commands: ["bun run build"] },
				{ output: productionRunningEnvelope() },
			),
		).toBeUndefined();
	});

	it("HC2: the installed host classifier reports a FAILED command observation as 'failed'", () => {
		const classify = createHostExecutionProgressClassifier();
		// ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01: the
		// host USED TO DECLINE a failed command. The decline was correct on
		// its own terms — the host has no authority to claim an inspection
		// verdict about a command that failed — but a DECLINE is not a
		// verdict, and the runtime's fallback then re-classified the very
		// same call as an EXECUTION because the fallback checked only the
		// dispatch `isError` flag. The host's authoritative negative
		// observation DISAPPEARED at that boundary.
		//
		// The host now reports the failure EXPLICITLY, so the observation
		// survives the boundary and a generic command failure can never
		// become positive evidence of progress.
		expect(
			classify(
				"run_commands",
				{ commands: ["git log"] },
				{ output: "command failed", isError: true },
			),
		).toBe("failed");
		// A failed command whose result carries the production failure
		// envelope is reported as 'failed' too — the host does not claim an
		// inspection verdict about a command that failed.
		expect(
			classify(
				"run_commands",
				{ commands: ["git log"] },
				{ output: productionFailedSnapshot() },
			),
		).toBe("failed");
	});

	it("HC3: the installed host classifier declines a non-`run_commands` tool", () => {
		const classify = createHostExecutionProgressClassifier();
		// `command_status` is an OBSERVATION of an already launched job. The
		// host classifier does not classify it, so the runtime's own
		// structural reading governs.
		expect(
			classify(
				"command_status",
				{ jobId: JOB_ID },
				{ output: productionRunningSnapshot() },
			),
		).toBeUndefined();
		expect(
			classify(
				"read_files",
				{ files: [{ path: "/tmp/a.ts" }] },
				{ output: "x" },
			),
		).toBeUndefined();
	});

	it("HC4: the classifier still classifies a COMPLETED inspection and a COMPLETED execution", () => {
		const classify = createHostExecutionProgressClassifier();
		// A completed read-only inspection is still an inspection.
		expect(
			classify("run_commands", { commands: ["git log"] }, { output: "ok" }),
		).toBe("inspected");
		// A completed execution is still an execution.
		expect(
			classify("run_commands", { commands: ["bun test"] }, { output: "ok" }),
		).toBe("executed");
	});
});
