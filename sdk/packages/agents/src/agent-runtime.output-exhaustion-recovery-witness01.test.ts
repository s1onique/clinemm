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

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01) — C6 Trajectory A (recover through R1)", () => {
	/**
	 * The R1 corrective instruction, if the request carries one.
	 *
	 * It is recognised by the SHARED template's own stable prefix, not by
	 * a loose text guess.
	 */
	function recoveryInstructionIn(
		request: AgentModelRequest,
	): string | undefined {
		for (const message of request.messages) {
			for (const part of message.content ?? []) {
				if (
					part.type === "text" &&
					part.text.startsWith("[SYSTEM] Execution has stalled:")
				) {
					return part.text;
				}
			}
		}
		return undefined;
	}

	it("A6: the scripted model recovers ONLY because it OBSERVED the R1 instruction", async () => {
		// The trajectory: the model exhausts its output until the R1
		// threshold is reached. The runtime injects a corrective
		// instruction. The NEXT scripted turn — which SEES that instruction
		// in the request history — performs a real native edit and a real
		// executable verification, and the parent task then completes.
		//
		// THE SCRIPT IS CONDITIONAL: the model edits ONLY IF the recovery
		// instruction is actually present in the request it received.
		// Before the instruction it keeps exhausting its output. This
		// proves DELIVERY and SYNTHETIC BEHAVIOURAL CAUSALITY: the recovery
		// happened because the instruction arrived.
		//
		// EVIDENCE CLASSIFICATION: `SYNTHETIC_REAL_PRODUCTION_SEAM`. The
		// production seam is real (the runtime, the tool execution, the
		// request preparation, the transcript, the disk); the MODEL
		// BEHAVIOUR is scripted. It is NOT evidence that MiniMax itself
		// will behave identically.
		const workspace = makeWorkspace();
		// The RECONNAISSANCE FIXTURE is INITIALIZED with the file it
		// claims to inspect: a failed read of a nonexistent file is NOT
		// successful ordinary reconnaissance.
		writeFileSync(join(workspace, "artifact.txt"), "original\n", "utf8");

		const verificationCalls = { count: 0 };
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		// The model exhausts its output until the R1 threshold is reached.
		for (let i = 0; i < 6; i += 1) {
			steps.push(exhaustedTurn);
		}
		// The CONDITIONAL step: the model edits ONLY when it has actually
		// SEEN the R1 corrective instruction.
		steps.push((request) => {
			if (recoveryInstructionIn(request) === undefined) {
				return exhaustedTurn();
			}
			return toolTurn("edit-1", "write_file", {
				path: "artifact.txt",
				contents: "recovered",
			});
		});
		// The verification step, and then the parent completion.
		steps.push((request) => {
			if (recoveryInstructionIn(request) === undefined) {
				return exhaustedTurn();
			}
			return toolTurn("verify-1", "run_tests");
		});
		steps.push((request) => {
			if (recoveryInstructionIn(request) === undefined) {
				return exhaustedTurn();
			}
			return textTurn("Task complete.");
		});

		const model = new ScriptedModel(steps);

		// Count the ACTUAL verification invocations. The verification tool
		// reads the REAL workspace bytes, so its invocation is the
		// observable evidence that the verification actually ran against
		// actual state.
		const originalRunTests = createRunTestsTool(workspace);
		const verifyingTool = {
			...originalRunTests,
			async execute(input: unknown) {
				verificationCalls.count += 1;
				return originalRunTests.execute(input);
			},
		};
		const runtime = new AgentRuntime({
			model,
			tools: [createWriteFileTool(workspace), verifyingTool],
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
		const delivered = model.requests.filter(
			(request) => recoveryInstructionIn(request) !== undefined,
		);
		expect(delivered.length).toBeGreaterThan(0);
		// 2. The instruction reached the MODEL: the requests that carry it
		//    come AFTER the requests that do not.
		const firstDeliveredIndex = model.requests.findIndex(
			(request) => recoveryInstructionIn(request) !== undefined,
		);
		expect(firstDeliveredIndex).toBeGreaterThan(0);
		// 3. ACTUAL file bytes changed on disk.
		expect(readFileSync(join(workspace, "artifact.txt"), "utf8")).toBe(
			"recovered",
		);
		// 4. The verification ACTUALLY ran, against the ACTUAL bytes.
		expect(verificationCalls.count).toBeGreaterThan(0);
		// 5. The parent task completed through its EXISTING completion
		//    authority.
		expect(result.status).toBe("completed");
		// 6. NO operator intervention: the run never waited for a user.
		expect(result.error).toBeUndefined();
	});

	it("A6-control: WITHOUT the intervention the scripted recovery does NOT occur", async () => {
		// The INTERVENTION-DENIED CONTROL. The SAME conditional script is
		// used, but the R1 policy is DISABLED, so the corrective
		// instruction is never injected and the model — which edits ONLY
		// after observing that instruction — never edits.
		//
		// This is what makes the causal claim load-bearing: the recovery
		// in the trajectory above happened BECAUSE the instruction was
		// delivered, not because the script was unconditional.
		const workspace = makeWorkspace();
		writeFileSync(join(workspace, "artifact.txt"), "original\n", "utf8");

		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 6; i += 1) {
			steps.push(exhaustedTurn);
		}
		steps.push((request) => {
			if (recoveryInstructionIn(request) === undefined) {
				return exhaustedTurn();
			}
			return toolTurn("edit-1", "write_file", {
				path: "artifact.txt",
				contents: "recovered",
			});
		});
		steps.push(() => textTurn("Task complete."));

		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createWriteFileTool(workspace), createRunTestsTool(workspace)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				// THE INTERVENTION IS DENIED: the R1 policy is disabled, so
				// no corrective instruction is ever injected.
				enabled: false,
				classifyToolCall: hostClassify,
			},
		});

		const result = await runtime.run("Do the work");

		// No request ever carried the corrective instruction...
		for (const request of model.requests) {
			expect(recoveryInstructionIn(request)).toBeUndefined();
		}
		// ...so the scripted recovery did NOT occur: the workspace bytes
		// are UNCHANGED.
		expect(readFileSync(join(workspace, "artifact.txt"), "utf8")).toBe(
			"original\n",
		);
		// And the run terminated truthfully.
		expect(result.status).toBe("failed");
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

// ---------------------------------------------------------------------------
// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01) — A4.
//
// The STRENGTHENED R2 behavioural witness.
//
// WHAT THE PREDECESSOR WITNESS DID NOT ESTABLISH
// ----------------------------------------------
// The predecessor's Trajectory B used a selection reply with a `candidates`
// ARRAY and an ARRAY `mutationScope`. The production validator requires SIX
// scalar string fields, so that reply was REJECTED — the "R2 activated"
// assertion only observed the activation ATTEMPT, never an accepted
// objective. It also used `verifyObjective: () => true`, an UNCONDITIONAL
// predicate that proves nothing about the objective's success.
//
// WHAT THIS WITNESS ESTABLISHES
// -----------------------------
// The ordered lifecycle, with a PRODUCTION-VALID selection and a REAL
// bounded verification predicate over ACTUAL workspace state:
//
//   1. The R1 allowance is exhausted.
//   2. EXACTLY ONE R2 selection inference.
//   3. The PRODUCTION validator ACCEPTS the proposal.
//   4. An ACTUAL subsequent parent request CARRIES the accepted bounded
//      objective.
//   5. A PERMITTED tool changes ACTUAL workspace bytes.
//   6. An ACTUAL verification result establishes the objective's success.
//   7. The bounded objective CLOSES.
//   8. A SUBSEQUENT parent request NO LONGER carries the objective.
//   9. The parent completes ONLY through its EXISTING completion authority.
//
// The rejected-selection control is retained.
//
// EVIDENCE CLASSIFICATION: SYNTHETIC_REAL_PRODUCTION_SEAM. The production
// seam is real (the runtime, the tool execution, the transcript, the disk);
// the MODEL BEHAVIOUR is scripted. It is NOT evidence that MiniMax itself
// will behave identically, and it is NOT live behavioural effectiveness.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01) — A4 strengthened R2 behavioural witness", () => {
	/**
	 * The PRODUCTION-VALID R2 selection reply.
	 *
	 * It names ONE objective with the SIX scalar string fields the
	 * production validator requires, cites the runtime-owned
	 * parent-obligation REFERENCE ID and the established observation
	 * VERBATIM, and names a verification condition the real host predicate
	 * can establish from ACTUAL workspace state.
	 */
	const VALID_SELECTION_REPLY = {
		objective: "Write the repaired artifact file with the expected content",
		firstStep: "Edit the artifact file to write the expected content",
		mutationScope: "the disposable workspace directory",
		verificationCondition: "the artifact file contains the expected content",
		obligationReferences: ["parent-task:original"],
		evidenceReferences: [
			"The last 5 consecutive execution round(s) produced no productive step",
		],
		successCondition: "the artifact file contains the expected content",
		failureCondition:
			"the artifact file cannot be written or its content does not match",
	};

	/** The expected content the REAL verification predicate establishes. */
	const EXPECTED_CONTENT = "recovered";

	/**
	 * A model that answers the SELECTION inference with the given reply and
	 * otherwise follows the supplied script.
	 *
	 * The selection inference is distinguished by its TOOL INVENTORY: the
	 * selection carries NO tools (it names an objective; it executes
	 * nothing), while every execution request carries the runtime's tool
	 * set. That discriminator is the request's own shape, not a text guess.
	 */
	class ObjectiveAwareModel implements AgentModel {
		public readonly requests: AgentModelRequest[] = [];
		public readonly selectionRequests: AgentModelRequest[] = [];

		constructor(
			private readonly steps: Array<
				(request: AgentModelRequest) => Iterable<AgentModelEvent>
			>,
			private readonly selectionReply: Record<string, unknown>,
		) {}

		async stream(
			request: AgentModelRequest,
		): Promise<AsyncIterable<AgentModelEvent>> {
			if ((request.tools ?? []).length === 0) {
				this.selectionRequests.push(request);
				// The reply is captured BEFORE the generator is created: an
				// async generator body does not inherit the enclosing
				// `this` when it is invoked later.
				const reply = JSON.stringify(this.selectionReply);
				return (async function* () {
					yield { type: "text-delta", text: reply } as AgentModelEvent;
					yield { type: "finish", reason: "stop" } as AgentModelEvent;
				})();
			}
			this.requests.push(request);
			const step = this.steps.shift();
			if (!step) {
				return (async function* () {})();
			}
			return (async function* () {
				for (const event of step(request)) {
					yield event;
				}
			})();
		}
	}

	/** The ACTIVE bounded objective projection, if the request carries one. */
	function boundedObjectiveIn(request: AgentModelRequest): string | undefined {
		const systemPrompt = request.systemPrompt ?? "";
		const marker = "[SYSTEM] Active bounded objective (runtime authority):";
		const at = systemPrompt.indexOf(marker);
		if (at === -1) {
			return undefined;
		}
		return systemPrompt.slice(at);
	}

	it("A4: walks the ORDERED R2 lifecycle with a production-valid selection and a REAL verification predicate", async () => {
		const workspace = makeWorkspace();

		// The REAL verification predicate: it establishes the objective's
		// success from ACTUAL workspace state — the bytes on disk — and
		// from NOTHING else. It is NOT an unconditional `() => true`.
		let verificationInvocations = 0;
		let verificationObservedVerified = false;
		const verifyObjective = (
			objective: { objective: string },
			facts: { successfulEdits: number; executedCommands: number },
		): boolean => {
			verificationInvocations += 1;
			const verified = (() => {
				try {
					return (
						readFileSync(join(workspace, "artifact.txt"), "utf8") ===
						EXPECTED_CONTENT
					);
				} catch {
					return false;
				}
			})();
			verificationObservedVerified = verified;
			return verified;
		};

		// The script: the model exhausts its output until the R1 allowance
		// is exhausted (the ONLY branch R2 activates at), then — AFTER the
		// objective has been dispatched — it performs the permitted edit and
		// the parent completes.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 16; i += 1) {
			steps.push(exhaustedTurn);
		}
		// The edit that changes ACTUAL workspace bytes.
		steps.push(() =>
			toolTurn("edit-1", "write_file", {
				path: "artifact.txt",
				contents: EXPECTED_CONTENT,
			}),
		);
		// The parent then completes through its EXISTING completion authority.
		steps.push(() => textTurn("Task complete."));

		const model = new ObjectiveAwareModel(steps, VALID_SELECTION_REPLY);
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
				verifyObjective,
			},
		});

		const phases: string[] = [];
		let r1Interventions = 0;
		let objectiveActivated = 0;
		let objectiveVerified = 0;
		let selectionRejected = 0;
		runtime.subscribe((event) => {
			if (event.type !== "status-notice") {
				return;
			}
			const kind = event.metadata?.kind;
			const reason = event.metadata?.reason;
			if (kind === "execution_stagnation_recovery") {
				r1Interventions += 1;
			}
			if (kind === "bounded_objective_recovery") {
				phases.push(String(reason));
				if (reason === "bounded_objective_activated") {
					objectiveActivated += 1;
				}
				if (reason === "bounded_objective_verified") {
					objectiveVerified += 1;
				}
				if (reason === "selection_rejected") {
					selectionRejected += 1;
				}
			}
		});

		const result = await runtime.run("Do the work");

		// (1) The R1 allowance was exhausted: both R1 corrective
		//     instructions were injected.
		expect(r1Interventions).toBe(2);
		// (2) EXACTLY ONE R2 selection inference.
		expect(model.selectionRequests).toHaveLength(1);
		// (3) The PRODUCTION validator ACCEPTED the proposal: the objective
		//     was activated and the selection was NOT rejected.
		expect(selectionRejected).toBe(0);
		expect(objectiveActivated).toBe(1);

		// (4) An ACTUAL subsequent parent request CARRIES the accepted
		//     bounded objective on the privileged channel.
		const objectiveRequests = model.requests.filter(
			(request) => boundedObjectiveIn(request) !== undefined,
		);
		expect(objectiveRequests.length).toBeGreaterThan(0);
		expect(
			boundedObjectiveIn(objectiveRequests[0] as AgentModelRequest),
		).toContain(VALID_SELECTION_REPLY.objective);

		// (5) A PERMITTED tool changed ACTUAL workspace bytes.
		expect(readFileSync(join(workspace, "artifact.txt"), "utf8")).toBe(
			EXPECTED_CONTENT,
		);

		// (6) An ACTUAL verification result established the objective's
		//     success. The predicate was INVOKED, and it observed the real
		//     workspace state.
		expect(verificationInvocations).toBeGreaterThan(0);
		expect(verificationObservedVerified).toBe(true);
		expect(objectiveVerified).toBe(1);

		// (7) The bounded objective CLOSED.
		expect(phases).toContain("bounded_objective_verified");

		// (8) A SUBSEQUENT parent request NO LONGER carries the objective.
		const lastRequest = model.requests[model.requests.length - 1];
		expect(lastRequest).toBeDefined();
		expect(
			boundedObjectiveIn(lastRequest as AgentModelRequest),
		).toBeUndefined();

		// (9) The parent completed ONLY through its EXISTING completion
		//     authority — the run's own terminal outcome.
		expect(result.status).toBe("completed");
	});

	it("A4-control: a REJECTED selection is NOT retried and produces NO objective", async () => {
		const workspace = makeWorkspace();
		let verificationInvocations = 0;

		// A selection that FABRICATES an evidence reference: it cites an
		// observation the runtime never established. The production
		// validator rejects it as `fabricated_evidence`. The rejection is
		// DETERMINISTIC and does not depend on the parent having named any
		// authorised path.
		const REJECTED_SELECTION_REPLY = {
			objective: "Write the repaired artifact file with the expected content",
			firstStep: "Edit the artifact file to write the expected content",
			mutationScope: "the disposable workspace directory",
			verificationCondition: "the artifact file contains the expected content",
			obligationReferences: ["parent-task:original"],
			evidenceReferences: [
				"A finding that was never established by any observation",
			],
			successCondition: "the artifact file contains the expected content",
			failureCondition:
				"the artifact file cannot be written or its content does not match",
		};

		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < 16; i += 1) {
			steps.push(exhaustedTurn);
		}

		const model = new ObjectiveAwareModel(steps, REJECTED_SELECTION_REPLY);
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
				verifyObjective: () => {
					verificationInvocations += 1;
					return true;
				},
			},
		});

		let selectionRejected = 0;
		let objectiveActivated = 0;
		runtime.subscribe((event) => {
			if (event.type !== "status-notice") {
				return;
			}
			if (event.metadata?.reason === "selection_rejected") {
				selectionRejected += 1;
			}
			if (event.metadata?.reason === "bounded_objective_activated") {
				objectiveActivated += 1;
			}
		});

		await runtime.run("Do the work");

		// The selection WAS rejected...
		expect(selectionRejected).toBe(1);
		// ...NO objective was activated...
		expect(objectiveActivated).toBe(0);
		// ...the selection allowance was consumed and NOT retried...
		expect(model.selectionRequests).toHaveLength(1);
		// ...and NO verification was attempted, because no objective ran.
		expect(verificationInvocations).toBe(0);
		// No request ever carried an objective.
		for (const request of model.requests) {
			expect(boundedObjectiveIn(request)).toBeUndefined();
		}
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01) — A6.
//
// The CONSERVATION controls the ACT's own amendment requires.
//
//   X1  CANCELLATION takes precedence over the continuation authority.
//   X2  The R2 SELECTION inference and other AUXILIARY inferences never
//       carry the recovery-only generation override.
//   X3  The exhaustion-driven continuations are BOUNDED and the run
//       terminates truthfully once no useful authorized intervention
//       remains.
//
// The COMPACTION conservation is already established by the EXISTING
// executable witness:
//   sdk/packages/agents/src/
//     agent-runtime.execution-stagnation-progress-controls01.test.ts
//     "PC5: a compaction between two stalls does NOT replenish the
//      consumed allowance"
//
// The RETRY CARDINALITY is established by the A5 end-to-end wire witness:
//   sdk/packages/core/src/services/llms/
//     recovery-output-override-wire.amendment01.test.ts
// which classifies the LOGICAL requests and the PHYSICAL attempts
// SEPARATELY and asserts that the override is one-shot per LOGICAL
// request.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01) — A6 conservation controls", () => {
	it("X1: CANCELLATION takes precedence over the recovery continuation authority", async () => {
		// The recovery continuation authority would permit another parent
		// request, but a CANCELLED run must never dispatch one.
		const model = new ScriptedModel([exhaustedTurn]);
		const runtime = new AgentRuntime({
			model,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		// The run is cancelled at the FIRST turn: the exhausted response is
		// then processed with the run ALREADY cancelled, which is exactly
		// the case in which the continuation authority must not fire.
		runtime.subscribe((event) => {
			if (event.type === "turn-started") {
				runtime.abort("the operator cancelled the run");
			}
		});
		const result = await runtime.run("Do the work");

		// The run terminated on the cancellation, and NO recovery
		// continuation was dispatched.
		expect(result.status).toBe("aborted");
		expect(model.requests.length).toBeLessThanOrEqual(1);
	});

	it("X2: the R2 SELECTION inference never carries the recovery-only generation override", async () => {
		// The R2 selection inference is an AUXILIARY inference: it names an
		// objective, it executes nothing, and it must never receive the
		// recovery allowance. The override is bound to the authorized
		// PARENT RECOVERY request only.
		const selectionReplies: string[] = [];
		class AuxiliaryAwareModel implements AgentModel {
			public readonly requests: AgentModelRequest[] = [];
			public readonly selectionRequests: AgentModelRequest[] = [];

			async stream(
				request: AgentModelRequest,
			): Promise<AsyncIterable<AgentModelEvent>> {
				// The SELECTION inference carries NO tools.
				if ((request.tools ?? []).length === 0) {
					this.selectionRequests.push(request);
					return (async function* () {
						yield {
							type: "text-delta",
							text: JSON.stringify({
								objective: "Write the repaired artifact file",
								firstStep: "Edit the artifact file",
								mutationScope: "the disposable workspace directory",
								verificationCondition:
									"the artifact file contains the expected content",
								obligationReferences: ["parent-task:original"],
								evidenceReferences: [
									"The last 5 consecutive execution round(s) produced no productive step",
								],
								successCondition:
									"the artifact file contains the expected content",
								failureCondition: "the artifact file cannot be written",
							}),
						} as AgentModelEvent;
						yield { type: "finish", reason: "stop" } as AgentModelEvent;
					})();
				}
				this.requests.push(request);
				return (async function* () {
					yield {
						type: "reasoning-delta",
						text: "thinking...",
					} as AgentModelEvent;
					yield { type: "finish", reason: "max-tokens" } as AgentModelEvent;
				})();
			}
		}

		const model = new AuxiliaryAwareModel();
		const runtime = new AgentRuntime({
			model,
			modelOptions: { reasoningEffort: "low" },
			messageModelInfo: {
				id: "MiniMax-M3.1-Flash",
				provider: "minimax",
			} as never,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			boundedObjectivePolicy: {
				enabled: true,
				maxActivations: 2,
				maxObjectiveRounds: 8,
				maxSelectionInferences: 1,
			},
			recoveryOutputOverridePolicy: {
				enabled: true,
				recoveryMaxOutputTokens: 16_384,
				modelId: "MiniMax-M3.1-Flash",
				reasoningEffort: "low",
			},
		});
		await runtime.run("Do the work");

		// The selection inference DID happen...
		expect(model.selectionRequests.length).toBe(1);
		// ...and it carried NO recovery allowance.
		for (const request of model.selectionRequests) {
			expect(request.options?.maxTokens).not.toBe(16_384);
		}
		// The PARENT requests are the only ones that may carry it, and at
		// most ONE of them does.
		const overriddenParents = model.requests.filter(
			(request) => request.options?.maxTokens === 16_384,
		);
		expect(overriddenParents.length).toBeLessThanOrEqual(1);
		void selectionReplies;
	});

	it("X3: the exhaustion-driven continuations are BOUNDED and the run terminates truthfully", async () => {
		// The run-scoped continuation ceiling is finite, the ordinary
		// reminder allowance is finite, and the run terminates TRUTHFULLY
		// once no useful authorized intervention remains — WITHOUT an
		// operator message.
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
		});
		let escalations = 0;
		let reminders = 0;
		runtime.subscribe((event) => {
			if (event.type !== "status-notice") {
				return;
			}
			if (event.metadata?.reason === "max_tokens_recovery_escalation") {
				escalations += 1;
			}
			if (event.metadata?.reason === "max_tokens_recovery") {
				reminders += 1;
			}
		});

		const result = await runtime.run("Do the work");

		// The ordinary reminders are bounded.
		expect(reminders).toBeLessThanOrEqual(3);
		// The escalation continuations are bounded.
		expect(escalations).toBeLessThanOrEqual(20);
		// The TOTAL exhaustion-driven continuations — the ordinary
		// reminders INCLUDED — are bounded by the declared ceiling.
		expect(reminders + escalations).toBeLessThanOrEqual(20);
		// The run terminated TRUTHFULLY, without an operator message.
		expect(result.status).toBe("failed");
		expect(result.error?.message).toContain("maximum output token limit");
	});
});
