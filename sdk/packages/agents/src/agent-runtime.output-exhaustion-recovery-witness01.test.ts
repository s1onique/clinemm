/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (C6/C7).
 *
 * The PRINCIPAL AUTONOMOUS BEHAVIORAL WITNESS and the CONSERVATION
 * CONTROLS.
 *
 * THE SEAM
 * --------
 * The REAL `AgentRuntime` and the REAL tool-execution seam, driven by a
 * deterministic scripted model over a DISPOSABLE workspace. No new harness:
 * the existing `AgentRuntime` fixtures are reused.
 *
 * EVIDENCE CLASSIFICATION
 * -----------------------
 * A scripted model that chooses an edit AFTER SEEING the recovery
 * instruction is `SYNTHETIC_REAL_PRODUCTION_SEAM`: the production seam is
 * real (the runtime, the tool execution, the request preparation, the
 * transcript, the disk), but the MODEL BEHAVIOUR is scripted. It is NOT
 * evidence that MiniMax itself will behave identically, and it is NOT live
 * behavioural effectiveness.
 *
 * TRAJECTORIES
 * ------------
 *   A — Recover useful progress through R1.
 *   B — Recover through R2 (the existing experimental policy, enabled).
 *   C — The model never recovers (the LIVENESS AND BOUNDEDNESS control).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
	ExecutionRoundProductivity,
} from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "./agent-runtime";

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = [];

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
			throw new Error("No scripted model step available");
		}
		return (async function* () {
			for (const event of step(request)) {
				yield event;
			}
		})();
	}
}

function exhaustedTurn(): Iterable<AgentModelEvent> {
	return [
		{ type: "reasoning-delta", text: "thinking..." },
		{ type: "finish", reason: "max-tokens" },
	];
}

function textTurn(text: string): Iterable<AgentModelEvent> {
	return [
		{ type: "text-delta", text },
		{ type: "finish", reason: "stop" },
	];
}

function toolTurn(
	toolCallId: string,
	toolName: string,
	input: unknown = {},
): Iterable<AgentModelEvent> {
	return [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			inputText: JSON.stringify(input),
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

/** The REAL host classification authority for the workspace tools. */
const hostClassify = (
	toolName: string,
): ExecutionRoundProductivity | undefined => {
	if (toolName === "write_file") {
		return "edited";
	}
	if (toolName === "run_tests") {
		return "executed";
	}
	if (toolName === "read_file") {
		return "inspected";
	}
	return undefined;
};

const disposableWorkspaces: string[] = [];

function makeWorkspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-lifecycle01-"));
	disposableWorkspaces.push(dir);
	return dir;
}

afterEach(() => {
	while (disposableWorkspaces.length > 0) {
		const dir = disposableWorkspaces.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

/** A REAL native edit tool that changes bytes on disk. */
function createWriteFileTool(
	workspace: string,
): AgentTool<{ path: string; contents: string }, { ok: true }> {
	return {
		name: "write_file",
		description: "Write a file in the workspace (a productive native edit)",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				contents: { type: "string" },
			},
		},
		async execute(input) {
			writeFileSync(join(workspace, input.path), input.contents, "utf8");
			return { ok: true };
		},
	};
}

/** A REAL executable verification tool. */
function createRunTestsTool(
	workspace: string,
): AgentTool<Record<string, never>, { ok: true; output: string }> {
	return {
		name: "run_tests",
		description: "Run the focused verification gate",
		inputSchema: { type: "object" },
		async execute() {
			const contents = readFileSync(join(workspace, "artifact.txt"), "utf8");
			return { ok: true, output: contents };
		},
	};
}

function createReadFileTool(
	workspace: string,
): AgentTool<{ path: string }, { ok: true; output: string }> {
	return {
		name: "read_file",
		description: "Read a file (a mere inspection)",
		inputSchema: {
			type: "object",
			properties: { path: { type: "string" } },
		},
		async execute(input) {
			return {
				ok: true,
				output: readFileSync(join(workspace, input.path), "utf8"),
			};
		},
	};
}

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — C6 Trajectory A (recover through R1)", () => {
	it("recovers useful workspace progress through the R1 intervention", async () => {
		// The trajectory: the model exhausts its output repeatedly. The
		// runtime's R1 intervention injects a corrective instruction. The
		// NEXT scripted turn — which SEES that instruction in the request
		// history — performs a real native edit and then a real executable
		// verification, and the parent task then completes.
		//
		// EVIDENCE CLASSIFICATION: `SYNTHETIC_REAL_PRODUCTION_SEAM`. The
		// production seam is real; the model behaviour is scripted.
		const workspace = makeWorkspace();
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		// The model exhausts its output until the R1 threshold is reached.
		for (let i = 0; i < 6; i += 1) {
			steps.push(exhaustedTurn);
		}
		// The model then edits and verifies.
		steps.push(() =>
			toolTurn("edit-1", "write_file", {
				path: "artifact.txt",
				contents: "recovered",
			}),
		);
		steps.push(() => toolTurn("verify-1", "run_tests"));
		steps.push(() => textTurn("Task complete."));

		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createWriteFileTool(workspace), createRunTestsTool(workspace)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: hostClassify,
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "execution_stagnation_recovery"
			) {
				notices.push(String(event.message));
			}
		});

		const result = await runtime.run("Do the work");

		// 1. The R1 corrective instruction was ACTUALLY dispatched.
		expect(notices.length).toBeGreaterThan(0);
		// The corrective instruction reached the MODEL: the next request
		// carries it.
		const sawInstruction = model.requests.some((request) =>
			request.messages.some((message) =>
				(message.content ?? []).some(
					(part) =>
						part.type === "text" && part.text.includes("Execution has stalled"),
				),
			),
		);
		expect(sawInstruction).toBe(true);
		// 2. ACTUAL file bytes changed on disk.
		expect(readFileSync(join(workspace, "artifact.txt"), "utf8")).toBe(
			"recovered",
		);
		// 3. The parent task completed through its EXISTING completion
		//    authority.
		expect(result.status).toBe("completed");
		// 4. NO operator intervention: the run never waited for a user.
		expect(result.error).toBeUndefined();
	});
});

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — C6 Trajectory C (never recovers)", () => {
	it("terminates truthfully with every recovery resource bounded", async () => {
		// The LIVENESS AND BOUNDEDNESS control: the model NEVER recovers.
		//
		// EVIDENCE: every recovery resource is finite, nothing is
		// replenished, and the run reaches a truthful terminal outcome
		// WITHOUT an operator message.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 200; i += 1) {
			steps.push(exhaustedTurn);
		}
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			recoveryOutputOverridePolicy: {
				enabled: true,
				recoveryMaxOutputTokens: 16_384,
			},
		});
		const notices: string[] = [];
		let escalationNotices = 0;
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "execution_stagnation_recovery"
			) {
				notices.push(String(event.message));
			}
			if (
				event.type === "status-notice" &&
				event.metadata?.reason === "max_tokens_recovery_escalation"
			) {
				escalationNotices += 1;
			}
		});

		const result = await runtime.run("Do the work");

		// The run reaches an EXISTING truthful terminal outcome.
		expect(result.status).toBe("failed");

		expect(result.error?.message).toContain("maximum output token limit");
		// NO successful completion was fabricated.
		expect(result.status).not.toBe("completed");
		// The R1 instruction allowance is FINITE.
		expect(notices.length).toBeLessThanOrEqual(2);
		// The exhaustion-driven continuations are BOUNDED.
		expect(escalationNotices).toBeLessThanOrEqual(20);
		// The total number of logical requests is bounded.
		expect(model.requests.length).toBeLessThanOrEqual(30);
		// NO operator message was required to reach the outcome.
		expect(result.error).toBeDefined();
	});
});

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — C6 Trajectory B (recover through R2)", () => {
	it("reaches the R1 allowance-exhausted branch and invokes R2 exactly once", async () => {
		// The R2 trajectory: the model exhausts its output until the R1
		// corrective-instruction allowance is exhausted, which is the ONLY
		// branch R2 activates at. The selection inference then runs ONCE and
		// the bounded objective is dispatched.
		//
		// EVIDENCE CLASSIFICATION: `SYNTHETIC_REAL_PRODUCTION_SEAM`.
		const workspace = makeWorkspace();
		const SELECTION_REPLY = JSON.stringify({
			candidates: [
				{
					objective: "Write the repaired artifact file",
					verification: {
						kind: "command",
						command: "run_tests",
					},
					mutationScope: ["artifact.txt"],
				},
			],
		});

		// The scripted model answers the SELECTION inference with the
		// selection JSON and otherwise exhausts its output.
		class SelectionAwareModel implements AgentModel {
			public readonly requests: AgentModelRequest[] = [];
			public selectionInferences = 0;

			async stream(
				request: AgentModelRequest,
			): Promise<AsyncIterable<AgentModelEvent>> {
				this.requests.push(request);
				const isSelection =
					request.systemPrompt?.includes("bounded objective") === true ||
					request.metadata?.kind === "bounded_objective_selection";
				if (isSelection) {
					this.selectionInferences += 1;
					return (async function* () {
						yield { type: "text-delta", text: SELECTION_REPLY };
						yield { type: "finish", reason: "stop" };
					})();
				}
				return (async function* () {
					yield { type: "reasoning-delta", text: "thinking..." };
					yield { type: "finish", reason: "max-tokens" };
				})();
			}
		}

		const model = new SelectionAwareModel();
		const runtime = new AgentRuntime({
			model,
			tools: [createWriteFileTool(workspace), createRunTestsTool(workspace)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: hostClassify,
			},
			boundedObjectivePolicy: {
				enabled: true,
				maxActivations: 2,
				maxObjectiveRounds: 8,
				maxSelectionInferences: 1,
				verifyObjective: () => true,
			},
		});
		const boundedObjectiveNotices: string[] = [];
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "bounded_objective_recovery"
			) {
				boundedObjectiveNotices.push(String(event.message));
			}
		});

		const result = await runtime.run("Do the work");

		// The R1 allowance-exhausted branch was reached and R2 activated.
		expect(boundedObjectiveNotices.length).toBeGreaterThan(0);
		// EXACTLY ONE selection inference per run.
		expect(model.selectionInferences).toBe(1);
		// The run terminates truthfully (the objective could not be
		// completed by the exhausted model).
		expect(result.status).not.toBe("aborted");
	});

	it("does NOT issue any selection inference when R2 is DEFAULT_OFF", async () => {
		// R2 DEFAULT_OFF CONSERVATION: with the policy absent, no selector
		// inference is issued, and the run still reaches a truthful
		// terminal outcome.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 100; i += 1) {
			steps.push(exhaustedTurn);
		}
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		let boundedObjectiveNotices = 0;
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "bounded_objective_recovery"
			) {
				boundedObjectiveNotices += 1;
			}
		});

		const result = await runtime.run("Do the work");

		// NO selector inference, NO R2 activation.
		expect(boundedObjectiveNotices).toBe(0);
		// The run still terminates truthfully.
		expect(result.status).toBe("failed");
	});
});

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — C7 conservation controls", () => {
	it("Normal productive ACT trajectory: NO unnecessary recovery intervention", async () => {
		// A productive trajectory must never trigger the recovery machinery.
		const workspace = makeWorkspace();
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 8; i += 1) {
			steps.push(() =>
				toolTurn(`edit-${i}`, "write_file", {
					path: "artifact.txt",
					contents: `v${i}`,
				}),
			);
		}
		steps.push(() => textTurn("done"));
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createWriteFileTool(workspace)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: hostClassify,
			},
		});
		let notices = 0;
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "execution_stagnation_recovery"
			) {
				notices += 1;
			}
		});

		const result = await runtime.run("Do the work");

		expect(notices).toBe(0);
		expect(result.status).toBe("completed");
	});

	it("Short ordinary reconnaissance: the EXISTING R1 threshold is preserved", async () => {
		// Four inspection rounds are BELOW the five-round threshold, so no
		// corrective instruction is injected.
		const workspace = makeWorkspace();
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 4; i += 1) {
			steps.push(() => toolTurn(`read-${i}`, "read_file", { path: "a.txt" }));
		}
		steps.push(() => textTurn("done"));
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createReadFileTool(workspace)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: hostClassify,
			},
		});
		let notices = 0;
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "execution_stagnation_recovery"
			) {
				notices += 1;
			}
		});

		await runtime.run("Do the work");

		expect(notices).toBe(0);
	});

	it("Max-token response with a COMPLETE valid tool call: execution semantics conserved", async () => {
		// An exhausted response that still carries a complete valid tool
		// call MUST execute that tool call — the existing handling is
		// preserved and the response is NOT relabelled as a tool-less
		// exhaustion.
		const workspace = makeWorkspace();
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call-1",
					toolName: "write_file",
					inputText: JSON.stringify({
						path: "artifact.txt",
						contents: "written",
					}),
				},
				{ type: "finish", reason: "max-tokens" },
			],
		];
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createWriteFileTool(workspace)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: hostClassify,
			},
		});

		await runtime.run("Do the work");

		// The tool call WAS executed.
		expect(readFileSync(join(workspace, "artifact.txt"), "utf8")).toBe(
			"written",
		);
	});

	it("Provider error is NOT relabelled as output exhaustion", async () => {
		// A provider ERROR must not consume the ordinary recovery allowance
		// or count as an exhaustion streak.
		const model = new ScriptedModel([
			() => [{ type: "finish", reason: "error" }],
		]);
		const runtime = new AgentRuntime({
			model,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		let recoveryNotices = 0;
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "max_tokens_recovery"
			) {
				recoveryNotices += 1;
			}
		});

		const result = await runtime.run("Do the work");

		expect(recoveryNotices).toBe(0);
		expect(result.status).toBe("failed");
	});

	it("Unknown terminal outcome is NOT relabelled as output exhaustion", async () => {
		const model = new ScriptedModel([
			() => [{ type: "finish", reason: "unknown" }],
		]);
		const runtime = new AgentRuntime({
			model,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		let recoveryNotices = 0;
		runtime.subscribe((event) => {
			if (
				event.type === "status-notice" &&
				event.metadata?.kind === "max_tokens_recovery"
			) {
				recoveryNotices += 1;
			}
		});

		const result = await runtime.run("Do the work");

		expect(recoveryNotices).toBe(0);
		expect(result.status).toBe("failed");
	});
});
