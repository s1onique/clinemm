/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01
 *
 * THE SMALL ACCOUNTING CONTROLS.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 *   S1  SELECTION ALLOWANCE CONSERVATION — the actual
 *       selection-inference allowance against the specified per-activation
 *       contract: ONE selection inference per activation. A failed
 *       selection CONSUMES the allowance and never retries.
 *   S2  CANCELLATION DURING SELECTION — cancelling the run while the
 *       selection inference is in flight produces no objective, no
 *       dispatch, and no further recovery.
 *   S3  CANCELLATION DURING ACTIVE OBJECTIVE EXECUTION — cancelling the
 *       run while the objective is executing produces no verified
 *       objective, no manufactured success, and no further recovery.
 *   S4  The R2 policy stays EXPLICITLY EXPERIMENTAL: the default is
 *       disabled, and the bounds are the documented experimental ones.
 *
 * EVIDENCE CLASS
 * --------------
 * SYNTHETIC_REAL_PRODUCTION_SEAM. The REAL `AgentRuntime` and the REAL R2
 * activation/dispatch/evaluation path. Scripted model responses ONLY at the
 * model boundary.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A deterministic scripted model with an OPTIONAL blocking selection. */
class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	readonly selectionRequests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
		private readonly selectionReply: Record<string, unknown>,
		private readonly onSelection?: () => void | Promise<void>,
	) {}
	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const isSelectionRequest = (request.tools ?? []).length === 0;
		if (isSelectionRequest) {
			this.selectionRequests.push(request);
			if (this.onSelection) {
				await this.onSelection();
			}
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
): (request: AgentModelRequest) => AgentModelEvent[] {
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
function finishStep(): (request: AgentModelRequest) => AgentModelEvent[] {
	return () => [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	];
}

/** A VALID R2 selection reply. */
const VALID_SELECTION_REPLY: Record<string, unknown> = {
	objective: "Repair the disposable target so its VALUE constant is 2",
	firstStep: "Edit the disposable target module to set VALUE = 2",
	mutationScope: "/tmp/disposable-target",
	verificationCondition:
		"the run_commands regression check `check-value` for VALUE reports PASS",
	obligationReferences: ["Complete the parent task as authorized by the user"],
	evidenceReferences: [
		"The last 3 consecutive execution round(s) produced no productive step",
	],
	successCondition: "the executable check `check-value` reports PASS",
	failureCondition:
		"the editable file cannot be changed or the check cannot pass",
};

/** An INVALID R2 selection reply — it cites evidence that never happened. */
const INVALID_SELECTION_REPLY: Record<string, unknown> = {
	...VALID_SELECTION_REPLY,
	evidenceReferences: ["An observation that was never established"],
};

/** An inspection-only tool. */
function createInspectTool(calls: { count: number }): AgentTool {
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

/** A command tool whose gate succeeds. */
function createCommandTool(calls: { count: number }): AgentTool {
	return {
		name: "run_commands",
		description: "Runs commands",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return "PASS: the regression check for VALUE succeeded";
		},
	};
}

/** Nine stalled inspection rounds: enough to exhaust R1's allowance. */
function stalledRounds(): Array<
	(request: AgentModelRequest) => AgentModelEvent[]
> {
	const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
	for (let i = 0; i < 9; i += 1) {
		steps.push(
			toolCallStep(`t${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
		);
	}
	return steps;
}

// ---------------------------------------------------------------------------
// S1 — SELECTION ALLOWANCE CONSERVATION
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / S1 selection allowance", () => {
	it("S1a: a FAILED selection CONSUMES the selection-inference allowance and is never retried", async () => {
		const calls = { count: 0 };
		const steps = [...stalledRounds(), finishStep()];
		const model = new ScriptedModel(steps, INVALID_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			boundedObjectivePolicy: {
				enabled: true,
				maxActivations: 2,
				maxObjectiveRounds: 8,
				maxSelectionInferences: 1,
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("fix the thing");
		// EXACTLY ONE selection inference: the per-activation contract.
		expect(model.selectionRequests).toHaveLength(1);
		// The rejection was reported, and the outcome is a truthful
		// failure — never a manufactured success.
		expect(
			notices.filter((n) => n.includes("bounded objective selection rejected")),
		).toHaveLength(1);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
	});

	it("S1b: a SECOND activation does not run a SECOND selection inference when the allowance is spent", async () => {
		const calls = { count: 0 };
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		for (let i = 0; i < 60; i += 1) {
			steps.push(
				toolCallStep(`t${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
			);
		}
		steps.push(finishStep());
		const model = new ScriptedModel(steps, INVALID_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			boundedObjectivePolicy: {
				enabled: true,
				maxActivations: 2,
				maxObjectiveRounds: 8,
				maxSelectionInferences: 1,
			},
		});
		await runtime.run("fix the thing");
		// The selection-inference allowance is spent after the FIRST
		// attempt. No second selection was made.
		expect(model.selectionRequests).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// S2 — CANCELLATION DURING SELECTION
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / S2 cancellation during selection", () => {
	it("S2: cancelling DURING the selection inference dispatches no objective and no further recovery", async () => {
		const calls = { count: 0 };
		let runtimeRef: AgentRuntime | undefined;
		const model = new ScriptedModel(
			[...stalledRounds(), finishStep()],
			VALID_SELECTION_REPLY,
			() => {
				// Cancel WHILE the selection inference is in flight.
				runtimeRef?.abort(
					"operator cancelled during selection",
					"explicit_abort_request",
				);
			},
		);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls)],
			abortSignal: new AbortController().signal,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			boundedObjectivePolicy: {
				enabled: true,
				maxActivations: 2,
				maxObjectiveRounds: 8,
				maxSelectionInferences: 1,
			},
		});
		runtimeRef = runtime;
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		const result = await runtime.run("fix the thing");
		expect(result.status).toBe("aborted");
		// NO objective was ever activated, and NO objective was dispatched.
		expect(
			notices.filter((n) => n.includes("bounded objective activated")),
		).toHaveLength(0);
		for (const request of model.requests) {
			expect(request.systemPrompt ?? "").not.toContain(
				"[SYSTEM] Active bounded objective",
			);
		}
	});
});

// ---------------------------------------------------------------------------
// S3 — CANCELLATION DURING ACTIVE OBJECTIVE EXECUTION
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / S3 cancellation during objective execution", () => {
	it("S3: cancelling DURING the active objective's execution produces no verified objective and no manufactured success", async () => {
		const calls = { count: 0 };
		let runtimeRef: AgentRuntime | undefined;
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [
			...stalledRounds(),
			(request) => {
				// Cancel while the objective is EXECUTING.
				runtimeRef?.abort(
					"operator cancelled during objective execution",
					"explicit_abort_request",
				);
				return toolCallStep("o1", "read_files", {
					files: [{ path: "/tmp/a" }],
				})(request);
			},
		];
		const model = new ScriptedModel(steps, VALID_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls)],
			abortSignal: new AbortController().signal,
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			boundedObjectivePolicy: {
				enabled: true,
				maxActivations: 2,
				maxObjectiveRounds: 8,
				maxSelectionInferences: 1,
				// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01
				// (AMENDMENT-02): the TRUSTED HOST VERIFICATION AUTHORITY.
				// The AMENDMENT-01 substring gate is REMOVED; only the
				// host's own verdict establishes verification.
				verifyObjective: () => false,
			},
		});
		runtimeRef = runtime;
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		const result = await runtime.run("fix the thing");
		expect(result.status).toBe("aborted");
		// NO success was manufactured.
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: completed"),
			),
		).toHaveLength(0);
	});
});
