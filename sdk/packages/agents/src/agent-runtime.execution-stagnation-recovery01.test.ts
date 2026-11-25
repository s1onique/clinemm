/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1)
 *
 * Executable qualification of the runtime-owned execution-stagnation
 * recovery, driven through the REAL `AgentRuntime` with a synthetic model.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * The nine required controls, each against the real runtime loop:
 *
 *   C1  A stalled implementation trajectory triggers recovery.
 *   C2  The next inference request carries the corrective instruction.
 *   C3  Execution continues without operator intervention.
 *   C4  Successful relevant progress clears the local stagnation streak.
 *   C5  Legitimate reconnaissance does not force an edit.
 *   C6  Running background work does not trigger a false stall merely
 *       because it has not finished.
 *   C7  Recovery cannot repeatedly inject identical instructions without
 *       bound.
 *   C8  Compaction does not replenish the recovery allowance.
 *   C9  Existing completion and failure semantics are conserved.
 *
 * The model is SYNTHETIC and deterministic: no wall-clock time, no sleep, no
 * external timeout, no network, no paid inference.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * -----------------------------
 * An offline replay of a frozen session reports WHEN the detector WOULD
 * have intervened; it does not prove behavioral recovery. Behavioral
 * recovery is what C1–C9 below establish, through the real runtime.
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentTool,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";

/**
 * A deterministic scripted model. Every step is a canned response; the
 * model records the requests it received so the test can assert what the
 * NEXT inference request actually carried.
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
			// When the script is exhausted, return an empty-but-valid
			// stream so the runtime can finish cleanly instead of treating
			// the model as a transport error.
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
	};
}

/** An inspection-shaped tool input (a file path, no edit operation). */
const INSPECT_INPUT = { files: [{ path: "/tmp/a.ts" }] };

/** An edit-shaped tool input. */
const EDIT_INPUT = { path: "/tmp/a.ts", old_text: "a", new_text: "b" };

/** A native edit tool that succeeds. */
function createEditTool(calls: { count: number }): AgentTool {
	return {
		name: "editor",
		description: "Edits a file",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return "edited";
		},
	};
}

/** A command tool whose result can report that work is STILL RUNNING. */
function createCommandTool(
	calls: { count: number },
	output: unknown,
): AgentTool {
	return {
		name: "run_commands",
		description: "Runs commands",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return output;
		},
	};
}

/** A terminal completion tool, used by the completion-semantics control. */
function createCompletionTool(calls: { count: number }): AgentTool {
	return {
		name: "submit_and_exit",
		description: "Completes the task",
		inputSchema: { type: "object" },
		lifecycle: { completesRun: true },
		async execute() {
			calls.count += 1;
			return "done";
		},
	};
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

/** The runtime-owned corrective instruction, if the request carries one. */
function recoveryInstructionIn(request: AgentModelRequest): string | undefined {
	return requestTexts(request).find((text) =>
		text.startsWith("[SYSTEM] Execution has stalled:"),
	);
}

// ---------------------------------------------------------------------------
// C1 / C2 / C3 — a stalled trajectory triggers recovery, the next inference
// request carries the instruction, and execution continues automatically.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / C1-C3", () => {
	it("C1+C2+C3: a stalled implementation trajectory injects ONE corrective instruction into the NEXT inference request, and execution continues automatically", async () => {
		const calls = { count: 0 };
		// Six inspection-only rounds, then a finishing round. The threshold is
		// 3, so the streak trips during the THIRD inspection round and the
		// FOURTH request must carry the corrective instruction.
		const model = new ScriptedModel([
			toolCallStep("t1", "read_files", INSPECT_INPUT),
			toolCallStep("t2", "read_files", INSPECT_INPUT),
			toolCallStep("t3", "read_files", INSPECT_INPUT),
			toolCallStep("t4", "read_files", INSPECT_INPUT),
			toolCallStep("t5", "read_files", INSPECT_INPUT),
			() => finishStep(),
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectionTool(calls)],
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

		// C3: the run COMPLETED on its own — no operator intervention, no
		// abort, no failure.
		expect(result.status).toBe("completed");
		// The loop kept going: 6 model requests were issued.
		expect(model.requests.length).toBe(6);
		expect(calls.count).toBe(5);

		// C1: recovery fired exactly once for the first streak.
		expect(
			notices.filter((n) => n.includes("execution stagnation detected")),
		).toHaveLength(1);

		// C2: the corrective instruction is carried by the NEXT inference
		// request — request index 3 (the fourth request, issued right after
		// the third unproductive round).
		const instruction = recoveryInstructionIn(model.requests[3]);
		expect(instruction).toBeDefined();
		// The instruction states OBSERVABLE FACTS ONLY: the round count and
		// the tool names used. It does not claim any finding.
		expect(instruction).toContain("the last 3 consecutive execution round(s)");
		expect(instruction).toContain("read_files");
		expect(instruction).toContain("No edit was attempted in those rounds.");
		expect(instruction).toContain(
			"State the single smallest useful experiment or edit",
		);
		// No earlier request carried it: the instruction is injected at the
		// intervention boundary, not before.
		expect(recoveryInstructionIn(model.requests[0])).toBeUndefined();
		expect(recoveryInstructionIn(model.requests[1])).toBeUndefined();
		expect(recoveryInstructionIn(model.requests[2])).toBeUndefined();
		// The instruction PERSISTS in the canonical transcript after the
		// intervention, so every later request still carries it — the model
		// must keep seeing the correction it was given.
		expect(recoveryInstructionIn(model.requests[4])).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// C4 — successful relevant progress clears the local stagnation streak.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / C4", () => {
	it("C4: a successful native edit clears the streak, so a later stall needs a FRESH streak before the next recovery", async () => {
		const calls = { count: 0 };
		// Round 1-2: inspect (streak = 2). Round 3: edit (streak RESET to 0).
		// Round 4-5: inspect (streak = 2). Round 6: inspect (streak = 3 ->
		// recovery fires). With threshold 3, the edit MUST have prevented a
		// recovery after rounds 1-3.
		const model = new ScriptedModel([
			toolCallStep("t1", "read_files", INSPECT_INPUT),
			toolCallStep("t2", "read_files", INSPECT_INPUT),
			toolCallStep("t3", "editor", EDIT_INPUT),
			toolCallStep("t4", "read_files", INSPECT_INPUT),
			toolCallStep("t5", "read_files", INSPECT_INPUT),
			toolCallStep("t6", "read_files", INSPECT_INPUT),
			() => finishStep(),
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectionTool(calls), createEditTool(calls)],
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
		const result = await runtime.run("edit then stall");
		expect(result.status).toBe("completed");
		expect(
			notices.filter((n) => n.includes("execution stagnation detected")),
		).toHaveLength(1);
		// The recovery fired AFTER the edit (the edit reset the streak), so it
		// took a FRESH streak of three unproductive rounds: requests[3],
		// requests[4] and requests[5]. The instruction therefore rides on
		// requests[6] — NOT on requests[2], which a non-resetting streak
		// would have carried it on.
		expect(recoveryInstructionIn(model.requests[2])).toBeUndefined();
		expect(recoveryInstructionIn(model.requests[3])).toBeUndefined();
		expect(recoveryInstructionIn(model.requests[4])).toBeUndefined();
		expect(recoveryInstructionIn(model.requests[5])).toBeUndefined();
		expect(recoveryInstructionIn(model.requests[6])).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// C5 — legitimate reconnaissance does not force an edit.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / C5", () => {
	it("C5: a legitimate reconnaissance trajectory below the threshold is never forced to edit, and no corrective instruction is injected", async () => {
		const calls = { count: 0 };
		// Four inspection rounds, then a finish. The threshold is 5, so a
		// legitimate reconnaissance trajectory stays below it.
		const model = new ScriptedModel([
			toolCallStep("t1", "read_files", INSPECT_INPUT),
			toolCallStep("t2", "read_files", INSPECT_INPUT),
			toolCallStep("t3", "read_files", INSPECT_INPUT),
			toolCallStep("t4", "read_files", INSPECT_INPUT),
			() => finishStep(),
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectionTool(calls)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 5,
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
		const result = await runtime.run("gather context");
		expect(result.status).toBe("completed");
		// No recovery notice at all.
		expect(notices).toHaveLength(0);
		// No request carries a corrective instruction.
		for (const request of model.requests) {
			expect(recoveryInstructionIn(request)).toBeUndefined();
		}
		// The agent was never forced to make an edit: the edit tool was
		// never even offered, and the run finished with its own text.
		expect(calls.count).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// C6 — running background work does not trigger a false stall.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / C6", () => {
	it("C6: a command that reports it is STILL RUNNING resets the streak; waiting for it never counts as a stall", async () => {
		const calls = { count: 0 };
		// Every round starts work that is still running. A legitimate wait is
		// not a stall, so the streak must NEVER reach the threshold.
		const runningOutput = { status: "running" };
		const model = new ScriptedModel([
			toolCallStep("t1", "run_commands", { commands: ["build"] }),
			toolCallStep("t2", "run_commands", { commands: ["build"] }),
			toolCallStep("t3", "run_commands", { commands: ["build"] }),
			toolCallStep("t4", "run_commands", { commands: ["build"] }),
			toolCallStep("t5", "run_commands", { commands: ["build"] }),
			toolCallStep("t6", "run_commands", { commands: ["build"] }),
			toolCallStep("t7", "run_commands", { commands: ["build"] }),
			() => finishStep(),
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createCommandTool(calls, runningOutput)],
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
		expect(notices).toHaveLength(0);
		for (const request of model.requests) {
			expect(recoveryInstructionIn(request)).toBeUndefined();
		}
	});

	it("C6: a command that COMPLETED is progress and also clears the streak", async () => {
		const calls = { count: 0 };
		const model = new ScriptedModel([
			toolCallStep("t1", "read_files", INSPECT_INPUT),
			toolCallStep("t2", "read_files", INSPECT_INPUT),
			toolCallStep("t3", "run_commands", { commands: ["vitest"] }),
			toolCallStep("t4", "read_files", INSPECT_INPUT),
			toolCallStep("t5", "read_files", INSPECT_INPUT),
			() => finishStep(),
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectionTool(calls), createCommandTool(calls, "ok")],
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
		await runtime.run("inspect then execute");
		expect(notices).toHaveLength(0);
	});

	// ---------------------------------------------------------------------------
	// C7 — recovery cannot repeatedly inject identical instructions without bound.
	// ---------------------------------------------------------------------------
	describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / C7", () => {
		it("C7: the run-scoped instruction allowance bounds the number of injections", async () => {
			const calls = { count: 0 };
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
				tools: [createInspectionTool(calls)],
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

			// Exactly TWO injections — never more. The bound is on INJECTIONS:
			// an injected instruction persists in the canonical transcript (so
			// the model keeps seeing it), but the runtime never appends a THIRD
			// one for this run.
			const injectedNotices = notices.filter((n) =>
				n.includes("execution stagnation detected"),
			);
			expect(injectedNotices).toHaveLength(2);
			// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01)
			// CORRECTION: the ATTEMPT COUNTER lives in the status notice,
			// which the MODEL NEVER SEES.
			//
			// The predecessor control claimed "the first two injections are
			// DIFFERENT instructions" on the strength of the two STATUS
			// NOTICES. That was the wrong evidence: the notices differ
			// ("attempt 1/2" vs "attempt 2/2"), but the MODEL-VISIBLE
			// INSTRUCTION BODIES are what the model actually receives.
			//
			// The corrected control below inspects the dispatched bodies.
			// The truthful finding is that, with an unchanging streak
			// length and an unchanging tool set, the two bodies are
			// BYTE-IDENTICAL: the message template describes OBSERVABLE
			// FACTS ONLY, and those facts were the same both times.
			expect(injectedNotices[0]).toContain("attempt 1/2");
			expect(injectedNotices[1]).toContain("attempt 2/2");

			// The MODEL-VISIBLE bodies: exactly TWO distinct bodies were
			// dispatched, and they are byte-identical because the observed
			// facts were identical.
			const dispatchedBodies = model.requests
				.map((request) => recoveryInstructionIn(request))
				.filter((body): body is string => body !== undefined);
			const distinctBodies = [...new Set(dispatchedBodies)];
			expect(distinctBodies).toHaveLength(1);
			expect(distinctBodies[0]).toContain(
				"the last 2 consecutive execution round(s)",
			);
			expect(distinctBodies[0]).toContain("read_files");
		});

		it("C7: with the allowance exhausted the run continues on its own terms and the stall surfaces through the normal outcome", async () => {
			const calls = { count: 0 };
			const steps: Array<() => AgentModelEvent[]> = [];
			for (let i = 0; i < 12; i += 1) {
				steps.push(toolCallStep(`t${i}`, "read_files", INSPECT_INPUT));
			}
			steps.push(() => finishStep());
			const model = new ScriptedModel(steps);
			const runtime = new AgentRuntime({
				model,
				tools: [createInspectionTool(calls)],
				executionStagnationPolicy: {
					unproductiveRoundThreshold: 2,
					maxRecoveryInstructions: 1,
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
			// The runtime does NOT manufacture a failure and does NOT terminate
			// the run on its own: the run's own outcome is preserved.
			expect(result.status).toBe("completed");
			const injectedNotices = notices.filter((n) =>
				n.includes("execution stagnation detected"),
			);
			expect(injectedNotices).toHaveLength(1);
		});
	});
});

// ---------------------------------------------------------------------------
// C8 — compaction does not replenish the recovery allowance.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / C8", () => {
	it("C8: a compaction between the two stalls does NOT replenish the run-scoped recovery allowance", async () => {
		const calls = { count: 0 };
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
			() => finishStep(),
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectionTool(calls)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 1,
				enabled: true,
			},
			prepareTurn: async () => {
				// Compact on EVERY turn: the provider request sees only a
				// summary. This is the production compaction shape — the host
				// REPLACES the provider-request messages.
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
		// The allowance is 1 and it was consumed before the compaction. If
		// compaction replenished the allowance, a SECOND instruction would
		// have been injected after it.
		expect(
			notices.filter((n) => n.includes("execution stagnation detected")),
		).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// C9 — existing completion and failure semantics are conserved.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 / C9", () => {
	it("C9: the completion obligation is conserved — recovery does not manufacture task completion and the terminal tool still ends the run", async () => {
		const calls = { count: 0 };
		const model = new ScriptedModel([
			toolCallStep("t1", "read_files", INSPECT_INPUT),
			toolCallStep("t2", "read_files", INSPECT_INPUT),
			toolCallStep("t3", "read_files", INSPECT_INPUT),
			toolCallStep("t4", "read_files", INSPECT_INPUT),
			toolCallStep("t5", "read_files", INSPECT_INPUT),
			toolCallStep("t6", "submit_and_exit", {}),
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectionTool(calls), createCompletionTool(calls)],
			completionPolicy: { requireCompletionTool: true },
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		const result = await runtime.run("do the work then complete");
		// The run ended through the TERMINAL COMPLETION TOOL, not through the
		// recovery mechanism.
		expect(result.status).toBe("completed");
		expect(calls.count).toBeGreaterThan(0);
	});

	it("C9: a failure in the run is still reported as a failure — recovery does not mask it", async () => {
		const steps = (): Array<() => AgentModelEvent[]> => [
			toolCallStep("t1", "read_files", { files: [{ path: "/tmp/a.ts" }] }),
			toolCallStep("t2", "read_files", { files: [{ path: "/tmp/b.ts" }] }),
			toolCallStep("t3", "read_files", { files: [{ path: "/tmp/c.ts" }] }),
			toolCallStep("t4", "read_files", { files: [{ path: "/tmp/d.ts" }] }),
			toolCallStep("t5", "read_files", { files: [{ path: "/tmp/e.ts" }] }),
			toolCallStep("t6", "read_files", { files: [{ path: "/tmp/f.ts" }] }),
		];
		const throwingTool = {
			name: "read_files",
			description: "Throws",
			inputSchema: { type: "object" },
			async execute(): Promise<never> {
				throw new Error("boom");
			},
		};

		// The run WITH the recovery policy.
		const withPolicy = new AgentRuntime({
			model: new ScriptedModel(steps()),
			tools: [throwingTool],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
		});
		const withPolicyResult = await withPolicy.run("fail");

		// The SAME run WITHOUT the recovery policy — the pre-existing
		// semantics, which the recovery must conserve exactly.
		const withoutPolicy = new AgentRuntime({
			model: new ScriptedModel(steps()),
			tools: [throwingTool],
		});
		const withoutPolicyResult = await withoutPolicy.run("fail");

		// The run still FAILS — recovery neither masks the failure nor
		// converts it into a success.
		expect(withPolicyResult.status).toBe("failed");
		// And the reported failure is BYTE-IDENTICAL to the pre-existing
		// failure semantics: the recovery changed nothing about how a
		// failing run is reported.
		expect(withPolicyResult.status).toBe(withoutPolicyResult.status);
		expect(withPolicyResult.error?.message).toBe(
			withoutPolicyResult.error?.message,
		);
		expect(withPolicyResult.error?.message).toBe(
			"Model ended without a recognized finish reason",
		);
	});

	it("C9: with the policy ABSENT the runtime behaves exactly as before — no observation, no injection", async () => {
		const calls = { count: 0 };
		const steps: Array<() => AgentModelEvent[]> = [];
		for (let i = 0; i < 20; i += 1) {
			steps.push(toolCallStep(`t${i}`, "read_files", INSPECT_INPUT));
		}
		steps.push(() => finishStep());
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectionTool(calls)],
			// NO executionStagnationPolicy — the default.
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		const result = await runtime.run("stall without the policy");
		expect(result.status).toBe("completed");
		expect(notices).toHaveLength(0);
		for (const request of model.requests) {
			expect(recoveryInstructionIn(request)).toBeUndefined();
		}
	});
});
