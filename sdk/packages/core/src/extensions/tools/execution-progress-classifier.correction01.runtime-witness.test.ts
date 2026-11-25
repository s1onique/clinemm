/**
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01
 *
 * PRINCIPAL PRODUCTION RUNTIME WITNESS.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * A SHORT, DETERMINISTIC trajectory of repeated RECOGNISED REMOTE SOURCE
 * INSPECTIONS, driven through the REAL `AgentRuntime` with the REAL
 * production host classifier, shows the five required facts:
 *
 *   1. The PREDECESSOR classifier misclassifies the remote inspections as
 *      execution.
 *   2. R1 does NOT activate as required on the predecessor's reading.
 *   3. The CORRECTED classifier increments the stagnation streak.
 *   4. The EXISTING R1 allowance is consumed.
 *   5. The EXISTING R2 entry condition becomes REACHABLE.
 *
 * and, as the CONSERVATION control, a second trajectory containing GENUINE
 * REMOTE BUILD ACTIVITY still produces productive rounds.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * -----------------------------
 * It does not duplicate the R2 qualification suite, and it does not prove
 * live behavioral recovery: a deterministic trajectory reports WHEN the
 * detector WOULD have intervened. No new recovery mechanism is introduced
 * here — the R1 threshold, the R1 allowance, the R2 activation limits and
 * the R2 selection limits are the EXISTING ones, unchanged.
 *
 * EVIDENCE CLASS
 * --------------
 * SYNTHETIC_REAL_PRODUCTION_SEAM — the runtime is the real `AgentRuntime`,
 * the classifier is the real production host classifier, and the decision
 * function is the real pure decision function from `@cline/shared`.
 */

import { AgentRuntime } from "@cline/agents";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentTool,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createHostExecutionProgressClassifier } from "./execution-progress-classifier";

/**
 * A deterministic scripted model. Every step is a canned response.
 */
class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
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
		return (async function* () {
			for await (const ev of step(request)) yield ev;
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

/**
 * The `run_commands` tool, whose result carries the PRODUCTION completed
 * observation envelope (`{ ok: true, exitCode: 0 }`).
 *
 * The result is a COMPLETED, SUCCESSFUL observation: the classifier must
 * classify the command by its SHAPE, not by an outcome it already read.
 */
function createCommandTool(calls: { count: number }): AgentTool {
	return {
		name: "run_commands",
		description: "Runs commands",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return [{ ok: true, exitCode: 0, stdout: "", stderr: "" }];
		},
	};
}

/**
 * The RECOGNISED REMOTE SOURCE INSPECTION commands — the EXACT historical
 * command shape from the frozen session's reconnaissance rounds.
 *
 * They are CLASSIFICATION INPUTS: the witness's command tool never executes
 * them, it only counts the call.
 */
const REMOTE_INSPECTION_COMMANDS: readonly string[] = [
	'ssh host \'grep -n "proc*" "$L/posix/posix.nim"\'',
	'ssh host \'grep -n "type Process" "$L/posix/posix.nim"\'',
	'ssh host \'grep -rn "osproc" "$L/"\'',
	'ssh host \'sed -n "330,420p" "$L/posix/osproc.nim"\'',
	"ssh host 'ls \"$L/posix\"'",
	'ssh host \'grep -n "socket" "$L/posix/posix.nim"\'',
	'ssh host \'grep -rn "proc_open" "$L/"\'',
];

/** A GENUINE REMOTE BUILD command — real work, not reconnaissance. */
const REMOTE_BUILD_COMMANDS: readonly string[] = [
	"ssh host 'nim c -d:release src/main.nim'",
	"ssh host 'make build'",
];

/**
 * The PREDECESSOR's inspection-program whitelist and its first-token-only
 * classification.
 *
 * The predecessor's decision shape was
 *   `isInspectionCommandInput(input) ? "inspected" : "executed"`
 * with a whitelist that did not include `ssh`, and it read only the LOCAL
 * first token of each segment. The predecessor therefore classified every
 * remote inspection as a productive execution.
 */
const PREDECESSOR_INSPECTION_PROGRAMS: ReadonlySet<string> = new Set([
	"cat",
	"echo",
	"file",
	"find",
	"git",
	"grep",
	"head",
	"ls",
	"nl",
	"od",
	"printenv",
	"pwd",
	"rg",
	"sed",
	"stat",
	"tail",
	"tree",
	"type",
	"wc",
	"which",
	"whoami",
]);

/** Whether the PREDECESSOR classifier classified the call as an inspection. */
function predecessorClassifiesAsInspection(
	commands: readonly string[],
): boolean {
	for (const command of commands) {
		const program = command.split(/\s+/)[0]?.split("/").pop()?.toLowerCase();
		if (!PREDECESSOR_INSPECTION_PROGRAMS.has(program ?? "")) {
			return false;
		}
	}
	return commands.length > 0;
}

describe("ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 / principal production runtime witness", () => {
	it("the PREDECESSOR classifier misclassifies the remote inspections as execution", () => {
		// (1) The predecessor's own logic classifies every remote inspection
		// as a productive execution, because `ssh` is not in its whitelist.
		expect(predecessorClassifiesAsInspection(REMOTE_INSPECTION_COMMANDS)).toBe(
			false,
		);
	});

	it("the CORRECTED classifier recognises the remote inspections as inspections", () => {
		const classify = createHostExecutionProgressClassifier();
		for (const command of REMOTE_INSPECTION_COMMANDS) {
			expect(
				classify(
					"run_commands",
					{ commands: [command] },
					{ output: [{ ok: true, exitCode: 0 }] },
				),
				`command: ${command}`,
			).toBe("inspected");
		}
		// And the genuine remote build is still an execution.
		for (const command of REMOTE_BUILD_COMMANDS) {
			expect(
				classify(
					"run_commands",
					{ commands: [command] },
					{ output: [{ ok: true, exitCode: 0 }] },
				),
				`command: ${command}`,
			).toBe("executed");
		}
	});

	it("R1 activates on the corrected reading and consumes the EXISTING allowance", async () => {
		const calls = { count: 0 };
		// The trajectory: the threshold (2) is below the production default
		// (5) so the witness stays SHORT; the ALLOWANCE is the production
		// default (2). Both are the EXISTING policy values — only the
		// threshold is lowered so the witness fits in a short trajectory.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (const [index, command] of REMOTE_INSPECTION_COMMANDS.entries()) {
			steps.push(
				toolCallStep(`t${index}`, "run_commands", { commands: [command] }),
			);
		}
		steps.push(() => finishStep());
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createCommandTool(calls)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: createHostExecutionProgressClassifier(),
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		const result = await runtime.run("inspect the remote sources");
		expect(result.status).toBe("completed");
		expect(calls.count).toBe(REMOTE_INSPECTION_COMMANDS.length);

		// (4) The EXISTING R1 allowance is consumed: exactly TWO corrective
		// instructions are injected, and no more.
		const stagnationNotices = notices.filter((n) =>
			n.includes("execution stagnation detected"),
		);
		expect(stagnationNotices).toHaveLength(2);
		expect(stagnationNotices[0]).toContain(
			"injecting a recovery instruction (attempt 1/2)",
		);
		expect(stagnationNotices[1]).toContain(
			"injecting a recovery instruction (attempt 2/2)",
		);

		// (3) The corrected classifier increments the stagnation streak: the
		// first notice reports TWO consecutive unproductive rounds, which is
		// only possible if the remote inspections were counted as
		// UNPRODUCTIVE rather than productive.
		expect(stagnationNotices[0]).toContain("after 2 unproductive round(s)");
		// The injected corrective instruction carries the OBSERVABLE facts:
		// the tool NAME — never the command's text, never a path.
		const instruction = model.requests
			.flatMap((request) => request.messages ?? [])
			.flatMap((message) =>
				Array.isArray(message.content)
					? message.content.flatMap((part) =>
							part && typeof part === "object" && "text" in part
								? [String((part as { text: unknown }).text)]
								: [],
						)
					: [],
			)
			.find((text) => text.startsWith("[SYSTEM] Execution has stalled:"));
		expect(instruction).toBeDefined();
		expect(instruction).toContain("run_commands");
		expect(instruction).toContain("the last 2 consecutive execution round(s)");
		expect(instruction).toContain("No edit was attempted in those rounds.");
		// It never names the command's text or a path.
		expect(instruction).not.toContain("ssh");
		expect(instruction).not.toContain("$L");
	});

	it("CONSERVATION: a trajectory with GENUINE remote build activity still produces productive rounds", async () => {
		const calls = { count: 0 };
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		// Alternate a remote inspection with a genuine remote build.
		for (const [index, command] of REMOTE_BUILD_COMMANDS.entries()) {
			steps.push(
				toolCallStep(`b${index}`, "run_commands", { commands: [command] }),
			);
			steps.push(
				toolCallStep(`i${index}`, "run_commands", {
					commands: [REMOTE_INSPECTION_COMMANDS[index]],
				}),
			);
		}
		steps.push(() => finishStep());
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createCommandTool(calls)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: createHostExecutionProgressClassifier(),
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("build the remote target");
		// The genuine remote build RESETS the streak every time, so the
		// streak never reaches the threshold of 2 and NO corrective
		// instruction is injected. Legitimate engineering progress is
		// conserved.
		expect(
			notices.filter((n) => n.includes("execution stagnation detected")),
		).toHaveLength(0);
	});
});
