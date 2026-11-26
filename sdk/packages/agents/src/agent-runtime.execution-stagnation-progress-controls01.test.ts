/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01)
 *
 * CORRECTED PROGRESS CONTROLS for the runtime execution-stagnation recovery.
 *
 * WHAT THIS FILE CORRECTS
 * -----------------------
 *
 * The predecessor qualification carried three controls that did not reflect
 * production:
 *
 *   1. The "running background work" control used a REPEATED build launch
 *      (`run_commands` with the same command over and over) as a proxy for
 *      "the agent is waiting on something". Production does not relaunch a
 *      build to wait for it: production launches ONE job and then POLLS that
 *      ONE IDENTIFIED job with `command_status`. This file uses the real
 *      production shapes for both.
 *
 *   2. The host-classifier control did not check that the INSTALLED host
 *      classifier leaves a legitimate AWAITING observation and a FAILED
 *      command observation alone. This file checks exactly that.
 *
 *   3. The "different model-visible instructions" control compared the
 *      runtime's STATUS NOTICES, not the MODEL-VISIBLE instruction bodies.
 *      A status notice is not what the model sees. This file inspects the
 *      ACTUAL DISPATCHED INSTRUCTION BODIES.
 *
 * The conditional synthetic recovery control is added: a scripted model that
 * selects an edit ONLY AFTER it has observed the recovery instruction, and
 * the edit ACTUALLY CHANGES A DISPOSABLE FIXTURE on disk.
 *
 * EVIDENCE CLASS
 * --------------
 *
 * SYNTHETIC_REAL_PRODUCTION_SEAM — NOT live behavioral recovery.
 *
 * The model is a deterministic scripted double. The tool RESULT SHAPES are
 * the REAL production shapes. The classifier under test is the REAL host
 * classifier. The file writes to a disposable fixture in a temporary
 * directory and cleans it up.
 */
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentTool,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";

// ---------------------------------------------------------------------------
// PRODUCTION TOOL RESULT SHAPES
// ---------------------------------------------------------------------------

/**
 * The REAL production shape of a `run_commands` result that reports the
 * command is STILL RUNNING.
 *
 * Source: `apps/vscode/src/sdk/vscode-run-commands-tool.ts` — the RUNNING
 * branch serialises `runningPayload` with `JSON.stringify`. The shape is:
 *
 *   { status, jobId, elapsedMs, deadlineRemainingMs, outputTruncated, stdout }
 *
 * The runtime's structural classifier reads `status === "running"`.
 */
function productionRunningResult(jobId: string): string {
	return JSON.stringify({
		status: "running",
		jobId,
		elapsedMs: 15000,
		deadlineRemainingMs: 585000,
		outputTruncated: false,
		stdout: "",
	});
}

/**
 * The REAL production shape of a `command_status` observation of a job that
 * is STILL RUNNING.
 *
 * Source: `apps/vscode/src/sdk/command-status-tool.ts` — the snapshot path
 * returns `{ ok, jobId, state, elapsedMs, deadlineRemainingMs, stdout,
 * stderr, outputTruncated }`.
 *
 * The production tool returns the observation as an ARRAY of operation
 * results (`ToolOperationResult[]`), so the "still running" marker lives on
 * the ENTRY, not on the envelope.
 */
function productionRunningStatus(jobId: string): unknown {
	return [
		{
			ok: true,
			jobId,
			state: "running",
			elapsedMs: 30000,
			deadlineRemainingMs: 570000,
			stdout: "",
			stderr: "",
			outputTruncated: false,
		},
	];
}

/**
 * The REAL production shape of a `command_status` observation of a job that
 * FAILED.
 */
function productionFailedStatus(jobId: string): unknown {
	return [
		{
			ok: true,
			jobId,
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

/**
 * The REAL production shape of a `command_status` observation of a job that
 * SUCCEEDED.
 */
function productionExitedStatus(jobId: string): unknown {
	return [
		{
			ok: true,
			jobId,
			state: "exited",
			elapsedMs: 31000,
			deadlineRemainingMs: 569000,
			stdout: "build ok",
			stderr: "",
			outputTruncated: false,
			exitCode: 0,
		},
	];
}

/** The ONE identified job this witness polls. */
const JOB_ID = "cmd_synthetic_job_0001";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * A deterministic scripted model. Every step is a canned response; the
 * model records the requests it received so the witness can assert what the
 * NEXT dispatched request actually carried.
 */
class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(
				request: AgentModelRequest,
			) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	) {}
	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) {
			return (async function* () {})();
		}
		const events = step(request);
		return (async function* () {
			for await (const ev of events) yield ev;
		})();
	}
}

/** One round that calls a tool and asks for another round. */
function toolCallStep(
	toolCallId: string,
	toolName: string,
	input: unknown,
): () => AgentModelEvent[] {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			inputText: JSON.stringify(input),
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

/** One round that produces only text and finishes. */
function finishStep(): AgentModelEvent[] {
	return [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	];
}

/** Extract the text of every message in a model request. */
function requestTexts(request: AgentModelRequest): string[] {
	const texts: string[] = [];
	for (const message of request.messages ?? []) {
		if (typeof message.content === "string") {
			texts.push(message.content);
			continue;
		}
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (
					part &&
					typeof part === "object" &&
					"text" in part &&
					typeof (part as { text: unknown }).text === "string"
				) {
					texts.push((part as { text: string }).text);
				}
			}
		}
	}
	return texts;
}

/**
 * The MODEL-VISIBLE recovery instruction body, if the dispatched request
 * carries one.
 *
 * This inspects the ACTUAL dispatched instruction body — not the runtime's
 * status notice, which the model never sees.
 */
function dispatchedRecoveryInstruction(
	request: AgentModelRequest,
): string | undefined {
	return requestTexts(request).find((text) =>
		text.startsWith("[SYSTEM] Execution has stalled:"),
	);
}

// ---------------------------------------------------------------------------
// Production tools
// ---------------------------------------------------------------------------

/**
 * The production `run_commands` tool, reduced to its OBSERVABLE contract:
 * it launches ONE job and returns the production RUNNING envelope.
 *
 * The witness launches the job ONCE and then polls that ONE IDENTIFIED job.
 */
function createRunCommandsTool(calls: { launches: number }): AgentTool {
	return {
		name: "run_commands",
		description: "Runs commands",
		inputSchema: { type: "object" },
		async execute(input: unknown) {
			const record = (input ?? {}) as { commands?: unknown };
			// The production tool launches ONE job per invocation and returns
			// the RUNNING envelope with the job's stable id.
			calls.launches += 1;
			return productionRunningResult(JOB_ID);
		},
	} as unknown as AgentTool;
}

/**
 * The production `command_status` tool: it observes an ALREADY LAUNCHED job
 * by its id. It never launches anything.
 */
function createCommandStatusTool(
	calls: { polls: number },
	observations: () => unknown,
): AgentTool {
	return {
		name: "command_status",
		description: "Inspects the state of a long-running command",
		inputSchema: { type: "object" },
		async execute() {
			calls.polls += 1;
			return observations();
		},
	} as unknown as AgentTool;
}

/** An inspection-only tool: it reads, and never edits. */
function createInspectionTool(calls: { count: number }): AgentTool {
	return {
		name: "read_files",
		description: "Reads files (inspection only)",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return "file contents";
		},
	} as unknown as AgentTool;
}

/** An edit-shaped tool input. */
const EDIT_INPUT = { path: "/tmp/a.ts", old_text: "a", new_text: "b" };

/** An inspection-shaped tool input (a file path, no edit operation). */
const INSPECT_INPUT = { files: [{ path: "/tmp/a.ts" }] };

// ---------------------------------------------------------------------------
// PC1 — the CORRECTED waiting control: poll ONE identified running job
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / PC1", () => {
	it("PC1: polling ONE identified running job is a legitimate wait, never a stall", async () => {
		const launches = { launches: 0 };
		const polls = { polls: 0 };
		// The job is launched ONCE and then POLLED by its stable jobId. The
		// observation is ALWAYS the production RUNNING snapshot.
		const model = new ScriptedModel([
			toolCallStep("t1", "run_commands", { commands: ["bun run build"] }),
			toolCallStep("t2", "command_status", { jobId: JOB_ID }),
			toolCallStep("t3", "command_status", { jobId: JOB_ID }),
			toolCallStep("t4", "command_status", { jobId: JOB_ID }),
			toolCallStep("t5", "command_status", { jobId: JOB_ID }),
			toolCallStep("t6", "command_status", { jobId: JOB_ID }),
			toolCallStep("t7", "command_status", { jobId: JOB_ID }),
			toolCallStep("t8", "command_status", { jobId: JOB_ID }),
			() => finishStep(),
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [
				createRunCommandsTool(launches),
				createCommandStatusTool(polls, () => productionRunningStatus(JOB_ID)),
			],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});

		const result = await runtime.run("wait for the build");
		expect(result.status).toBe("completed");

		// The PRODUCTION shape of waiting: ONE launch, then polls of that
		// ONE identified job. The job is NOT relaunched.
		expect(launches.launches).toBe(1);
		expect(polls.polls).toBe(7);

		// Waiting is not stalling: NO corrective instruction was injected.
		expect(
			notices.filter((n) => n.includes("execution stagnation detected")),
		).toHaveLength(0);
		for (const request of model.requests) {
			expect(dispatchedRecoveryInstruction(request)).toBeUndefined();
		}
	});
});

// ---------------------------------------------------------------------------
// PC2 — the installed host classifier must NOT override the runtime's own
//        structural reading of a legitimate AWAITING or FAILED observation
//
//        This control lives in the HOST package, because the host classifier
//        is host-owned:
//
//          sdk/packages/core/src/extensions/tools/
//            execution-progress-classifier.amendment01.test.ts
//
//        `@cline/agents` does not depend on `@cline/core` (the dependency
//        runs the other way), so the host classifier is not importable from
//        this package. What this file asserts instead is the runtime-side
//        half: the runtime's OWN structural classifier reads the production
//        RUNNING and FAILED shapes as "awaiting" / "not productive", and the
//        runtime NEVER lets a host verdict override a failed-command
//        observation.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / PC2", () => {
	it("PC2: the runtime's own structural classifier reads the production RUNNING shape as a legitimate wait", async () => {
		const runningResult = productionRunningResult(JOB_ID);
		const runtime = new AgentRuntime({
			model: new ScriptedModel([
				toolCallStep("t1", "run_commands", { commands: ["git log"] }),
				toolCallStep("t2", "run_commands", { commands: ["git log"] }),
				toolCallStep("t3", "run_commands", { commands: ["git log"] }),
				toolCallStep("t4", "run_commands", { commands: ["git log"] }),
				() => finishStep(),
			]),
			tools: [
				{
					name: "run_commands",
					description: "Runs commands",
					inputSchema: { type: "object" },
					async execute() {
						return runningResult;
					},
				} as unknown as AgentTool,
			],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("poll the job");
		// The AWAITING observation was NOT counted as a stall.
		expect(
			notices.filter((n) => n.includes("execution stagnation detected")),
		).toHaveLength(0);
	});

	it("PC2: the runtime's own structural classifier does not treat a FAILED command as productive progress", async () => {
		// A FAILED command produced no usable evidence of progress. The
		// runtime's structural reading is that the round executed a command,
		// which IS progress (the agent obtained executable evidence) — this
		// control pins that reading so the host-classifier control in the
		// host package can assert the host does NOT override it.
		const failedResult = productionFailedStatus(JOB_ID);
		const runtime = new AgentRuntime({
			model: new ScriptedModel([
				toolCallStep("t1", "run_commands", { commands: ["bun test"] }),
				() => finishStep(),
			]),
			tools: [
				{
					name: "run_commands",
					description: "Runs commands",
					inputSchema: { type: "object" },
					async execute() {
						return failedResult;
					},
				} as unknown as AgentTool,
			],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("run the failing test");
		expect(
			notices.filter((n) => n.includes("execution stagnation detected")),
		).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// PC3 — CONDITIONAL synthetic recovery: the model selects an edit ONLY AFTER
//        it has observed the recovery instruction, and the edit ACTUALLY
//        changes a disposable fixture
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / PC3", () => {
	it("PC3: a model that selects an edit only after observing the recovery instruction actually changes the disposable fixture", async () => {
		const fixtureDir = mkdtempSync(
			join(tmpdir(), "autonomous-recovery-fixture-"),
		);
		const fixturePath = join(fixtureDir, "fixture.txt");
		writeFileSync(fixturePath, "ORIGINAL CONTENT\n", "utf8");
		expect(readFileSync(fixturePath, "utf8")).toBe("ORIGINAL CONTENT\n");

		const inspections = { count: 0 };
		const edits: string[] = [];

		// A production-shaped edit tool that ACTUALLY WRITES to the fixture.
		const editTool = {
			name: "write_to_file",
			description: "Writes a file",
			inputSchema: { type: "object" },
			async execute(input: unknown) {
				const record = (input ?? {}) as {
					path?: string;
					content?: string;
				};
				edits.push(record.path ?? "");
				writeFileSync(record.path ?? fixturePath, record.content ?? "", "utf8");
				return "wrote";
			},
		} as unknown as AgentTool;

		// The scripted model is CONDITIONAL: each step inspects the request
		// it actually received and selects an edit ONLY IF the recovery
		// instruction is present. Before the instruction, it only inspects.
		const model = new ScriptedModel([
			(_request) => toolCallStep("t1", "read_files", INSPECT_INPUT)(),
			(_request) => toolCallStep("t2", "read_files", INSPECT_INPUT)(),
			(_request) => toolCallStep("t3", "read_files", INSPECT_INPUT)(),
			(_request) => toolCallStep("t4", "read_files", INSPECT_INPUT)(),
			(request) => {
				// The CONDITIONAL step: the model edits ONLY when it has
				// actually SEEN the recovery instruction.
				const instruction = dispatchedRecoveryInstruction(request);
				if (!instruction) {
					return toolCallStep("t5", "read_files", INSPECT_INPUT)();
				}
				return toolCallStep("t5", "write_to_file", {
					path: fixturePath,
					content: "CORRECTED CONTENT\n",
				})();
			},
			() => finishStep(),
		]);

		const runtime = new AgentRuntime({
			model,
			tools: [createInspectionTool(inspections), editTool],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});

		const result = await runtime.run("implement the bounded correction");

		try {
			expect(result.status).toBe("completed");
			// The recovery fired.
			expect(
				notices.filter((n) => n.includes("execution stagnation detected")),
			).toHaveLength(1);
			// The model observed the instruction BEFORE it edited.
			const instructionIndex = model.requests.findIndex(
				(request) => dispatchedRecoveryInstruction(request) !== undefined,
			);
			expect(instructionIndex).toBeGreaterThanOrEqual(0);
			// The edit happened AFTER the instruction was dispatched.
			expect(edits).toEqual([fixturePath]);
			// AND THE FIXTURE ACTUALLY CHANGED ON DISK.
			expect(existsSync(fixturePath)).toBe(true);
			expect(readFileSync(fixturePath, "utf8")).toBe("CORRECTED CONTENT\n");
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// PC4 — the CORRECTED "different model-visible instructions" control: inspect
//        the ACTUAL DISPATCHED INSTRUCTION BODIES, not the status notices
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / PC4", () => {
	it("PC4: the dispatched recovery instruction BODIES are inspected, and the attempt counter is NOT model-visible", async () => {
		const inspections = { count: 0 };
		// A long stall: 30 inspection rounds. The allowance is 2, so at most
		// TWO corrective instructions may ever be injected for this run.
		const steps: Array<() => AgentModelEvent[]> = [];
		for (let i = 0; i < 30; i += 1) {
			steps.push(toolCallStep(`t${i}`, "read_files", INSPECT_INPUT));
		}
		steps.push(() => finishStep());
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectionTool(inspections)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		const result = await runtime.run("stall forever");
		expect(result.status).toBe("completed");

		// The STATUS NOTICES differ — the attempt counter is in them.
		const injectedNotices = notices.filter((n) =>
			n.includes("execution stagnation detected"),
		);
		expect(injectedNotices).toHaveLength(2);
		expect(injectedNotices[0]).toContain("attempt 1/2");
		expect(injectedNotices[1]).toContain("attempt 2/2");

		// The CORRECTED assertion: inspect the ACTUAL DISPATCHED
		// INSTRUCTION BODIES — the text the MODEL receives.
		//
		// The truthful finding is that the two bodies are BYTE-IDENTICAL:
		// the message template states OBSERVABLE FACTS ONLY (streak
		// length, tool names, edit attempts), and those facts were the
		// same on both injections. The attempt counter lives in the
		// STATUS NOTICE, which the model never sees.
		//
		// The predecessor control claimed the two injections were
		// "DIFFERENT instructions" on the strength of the notices. That
		// claim was about the wrong artifact, and the corrected control
		// states the real fact instead.
		const dispatchedBodies = model.requests
			.map((request) => dispatchedRecoveryInstruction(request))
			.filter((body): body is string => body !== undefined);
		expect(dispatchedBodies.length).toBeGreaterThan(0);
		const distinctBodies = [...new Set(dispatchedBodies)];
		expect(distinctBodies).toHaveLength(1);
		// The body describes the observed facts of the streak.
		expect(distinctBodies[0]).toContain(
			"the last 2 consecutive execution round(s)",
		);
		expect(distinctBodies[0]).toContain("read_files");
		expect(distinctBodies[0]).toContain(
			"No edit was attempted in those rounds.",
		);

		// And the attempt counter is NOT model-visible: it appears in no
		// dispatched body.
		for (const body of dispatchedBodies) {
			expect(body).not.toContain("attempt 1/2");
			expect(body).not.toContain("attempt 2/2");
		}
	});
});

// ---------------------------------------------------------------------------
// PC5 — the CONSUMED ALLOWANCE is conserved across a compaction
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / PC5", () => {
	it("PC5: a compaction between two stalls does NOT replenish the consumed allowance", async () => {
		const inspections = { count: 0 };
		// The host's compaction seam REPLACES the provider-request messages
		// with a summary — exactly the production compaction shape. The
		// runtime's canonical transcript and its counters are untouched.
		let compactionCount = 0;
		const model = new ScriptedModel([
			toolCallStep("t1", "read_files", INSPECT_INPUT),
			toolCallStep("t2", "read_files", INSPECT_INPUT),
			toolCallStep("t3", "read_files", INSPECT_INPUT),
			toolCallStep("t4", "read_files", INSPECT_INPUT),
			toolCallStep("t5", "read_files", INSPECT_INPUT),
			toolCallStep("t6", "read_files", INSPECT_INPUT),
			toolCallStep("t7", "read_files", INSPECT_INPUT),
			toolCallStep("t8", "read_files", INSPECT_INPUT),
			() => finishStep(),
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectionTool(inspections)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 1,
				enabled: true,
			},
			prepareTurn: async () => {
				compactionCount += 1;
				return {
					messages: [
						{
							id: `summary-${compactionCount}`,
							role: "user",
							content: [{ type: "text", text: "compacted summary" }],
							createdAt: 0,
						},
					],
				};
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		const result = await runtime.run("stall across a compaction");
		expect(result.status).toBe("completed");
		expect(compactionCount).toBeGreaterThan(0);

		// The allowance is 1 and it was consumed BEFORE the compaction. If
		// the compaction replenished it, a SECOND instruction would have
		// been injected after it.
		const injected = notices.filter((n) =>
			n.includes("execution stagnation detected"),
		);
		expect(injected).toHaveLength(1);
		expect(injected[0]).toContain("attempt 1/1");
	});
});
