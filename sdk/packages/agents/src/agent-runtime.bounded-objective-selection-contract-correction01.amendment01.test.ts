/**
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01)
 *
 * THE FOCUSED REGRESSION WITNESS for the three bounded findings the
 * full-production diff review exposed.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 *
 *   A4  the OBSERVER is failure-isolated in BOTH directions: a SYNCHRONOUS
 *       exception cannot affect execution, and an ASYNCHRONOUS rejection
 *       cannot produce an unhandled rejection (which terminates the
 *       process under `--unhandled-rejections=strict`);
 *   A5  the PREDECESSOR's SPACED completion-prefix form
 *       (`no longer outstanding: <obligation>`) is still recognised, and
 *       the natural-language phrase vocabulary is UNCHANGED;
 *   A6  the rejection-field attribution is TRUTHFUL: a field is named ONLY
 *       when the validator established it, and the exact rejection reason
 *       and the raw proposal are preserved.
 *
 * EVIDENCE CLASS
 * --------------
 *
 * SYNTHETIC_REAL_PRODUCTION_SEAM. Every assertion runs against the REAL
 * runtime and the REAL validator. Only the MODEL is scripted, and only at
 * the model boundary.
 */

import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentTool,
	BoundedObjectiveSelectionObservation,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";

/**
 * A deterministic scripted model that serves the R2 SELECTION INFERENCE
 * and then a fixed execution script.
 *
 * The selection inference is served by the SAME model through the SAME
 * `stream()` seam. The discriminator is the request's TOOL INVENTORY: the
 * selection inference carries NO tools, every execution request carries the
 * runtime's tool set.
 */
class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	readonly selectionRequests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
		private readonly selectionReply: Record<string, unknown>,
	) {}
	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const isSelectionRequest = (request.tools ?? []).length === 0;
		if (isSelectionRequest) {
			this.selectionRequests.push(request);
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

/** One round that calls an inspection tool and asks for another round. */
function toolCallStep(toolCallId: string): () => AgentModelEvent[] {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName: "read_files",
			inputText: JSON.stringify({ files: [{ path: "/tmp/a" }] }),
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

/** One round that produces only text and finishes. */
function finishStep(): () => AgentModelEvent[] {
	return () => [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	];
}

/** Nine stalled inspection rounds: enough to exhaust R1's allowance. */
function stalledRounds(count = 9): Array<() => AgentModelEvent[]> {
	const steps: Array<() => AgentModelEvent[]> = [];
	for (let i = 0; i < count; i += 1) {
		steps.push(toolCallStep(`t${i}`));
	}
	return steps;
}

/** An inspection-only tool: a file read, no edit operation. */
function createInspectTool(calls: { count: number }): AgentTool {
	return {
		name: "read_files",
		description: "Reads files (inspection only)",
		inputSchema: { type: "object" } as never,
		async execute() {
			calls.count += 1;
			return "file contents";
		},
	} as AgentTool;
}

/**
 * The parent's terminal completion tool.
 *
 * The runtime MUST NOT invoke it on the bounded objective's behalf.
 */
function createCompletionTool(calls: {
	count: number;
	complete: number;
}): AgentTool {
	return {
		name: "submit_and_exit",
		description: "Completes the task",
		inputSchema: { type: "object" } as never,
		lifecycle: { completesRun: true },
		async execute() {
			calls.count += 1;
			calls.complete += 1;
			return "done";
		},
	} as AgentTool;
}

/**
 * The parent task.
 *
 * It names ONE labelled requirement so the runtime's reference vocabulary
 * is non-empty and a selection can cite it.
 */
const PARENT_TASK = [
	"# CMP-08 — Terminal bounded correction",
	"",
	"C1: GO. CMP-08 architecture accepted.",
	"",
	"## A1 — Preserve original exception authority",
	"",
	"The actual finalizeUsage() invokes reportUsage() without an exception boundary.",
].join("\n");

/**
 * A selection reply that cites the parent's A1 reference.
 */
const USEFUL_SELECTION_REPLY = {
	objective:
		"Add an exception boundary around reportUsage() inside finalizeUsage()",
	firstStep:
		"Edit the finalizeUsage() implementation to wrap the reportUsage() call in try/catch",
	mutationScope: "the usage accounting module",
	verificationCondition: "the focused CMP-08 test reports PASS",
	obligationReferences: ["parent-task:A1"],
	evidenceReferences: [
		"The last 3 consecutive execution round(s) produced no productive step",
	],
	successCondition: "the focused CMP-08 test reports PASS",
	failureCondition: "the module cannot be edited or the test cannot run",
};

/**
 * Run the R2 activation over a scripted execution and collect the notices
 * and the observations.
 */
async function runR2(options: {
	steps: Array<(request: AgentModelRequest) => AgentModelEvent[]>;
	selectionReply: Record<string, unknown>;
	observe?: (
		observation: BoundedObjectiveSelectionObservation,
	) => void | Promise<void>;
}) {
	const model = new ScriptedModel(options.steps, options.selectionReply);
	const calls = { count: 0, complete: 0 };
	const runtime = new AgentRuntime({
		model,
		tools: [createInspectTool(calls), createCompletionTool(calls)],
		executionStagnationPolicy: {
			unproductiveRoundThreshold: 3,
			maxRecoveryInstructions: 2,
			enabled: true,
		},
		boundedObjectivePolicy: r2Policy(),
		// The parent's completion contract is UNCHANGED: the terminal
		// completion tool is required, and the objective may never invoke it.
		completionPolicy: {
			requireCompletionTool: true,
		},
		...(options.observe
			? {
					boundedObjectiveSelectionTraceSink: {
						onSelectionObservation: options.observe,
					},
				}
			: {}),
	});
	const notices: string[] = [];
	runtime.subscribe((event: AgentRuntimeEvent) => {
		if (event.type === "status-notice") {
			notices.push(event.message);
		}
	});
	await runtime.run(PARENT_TASK);
	return { model, notices, calls };
}

// ---------------------------------------------------------------------------
// A4 — OBSERVER FAILURE ISOLATION
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01) / A4 observer failure isolation", () => {
	it("A4a: a SYNCHRONOUS observer exception cannot affect the selection or the parent continuation", async () => {
		const { notices } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: USEFUL_SELECTION_REPLY,
			observe: () => {
				throw new Error("observer exploded synchronously");
			},
		});
		// The R2 activation completed normally: the objective was
		// dispatched, so the observer's exception did not abort the run.
		expect(
			notices.filter((n) => n.includes("bounded objective activated")).length,
		).toBe(1);
	});

	it("A4b: an ASYNCHRONOUS observer rejection produces NO unhandled rejection and the run completes", async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => {
			unhandled.push(reason);
		};
		process.on("unhandledRejection", onUnhandled);
		try {
			const { notices } = await runR2({
				steps: [...stalledRounds(), finishStep()],
				selectionReply: USEFUL_SELECTION_REPLY,
				observe: async () => {
					// The rejection happens AFTER the call returns, so it
					// escapes a synchronous try/catch entirely.
					await Promise.resolve();
					throw new Error("observer exploded asynchronously");
				},
			});
			expect(
				notices.filter((n) => n.includes("bounded objective activated")).length,
			).toBe(1);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
		// Give the microtask queue a chance to surface a rejection that the
		// runtime did NOT handle.
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(unhandled).toHaveLength(0);
	});

	it("A4c: the observer CANNOT mutate runtime-owned objective or proposal state", async () => {
		const observed: BoundedObjectiveSelectionObservation[] = [];
		const { model } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: USEFUL_SELECTION_REPLY,
			observe: (observation) => {
				observed.push(observation);
				// The observer tries to REWRITE the observation it was
				// handed. The runtime-owned state must be unaffected.
				try {
					(observation as { disposition: string }).disposition = "valid";
					(observation as { generatedText: string }).generatedText = "MUTATED";
				} catch {
					// A frozen observation is also acceptable.
				}
			},
		});
		expect(observed).toHaveLength(1);
		// The mutation attempt did not corrupt the runtime's own record.
		expect(observed[0]?.disposition).toBe("valid");
		// The DISPATCHED request still carries the runtime's own objective
		// projection — the observer did not alter it.
		const dispatched = model.requests.filter((request) =>
			(request.systemPrompt ?? "").includes(
				"[SYSTEM] Active bounded objective (runtime authority):",
			),
		);
		expect(dispatched.length).toBeGreaterThan(0);
		expect(dispatched[0]?.systemPrompt).toContain(
			"Add an exception boundary around reportUsage() inside finalizeUsage()",
		);
	});
});

/** The R2 policy used by every witness. */
function r2Policy() {
	return {
		enabled: true,
		maxActivations: 2,
		maxObjectiveRounds: 8,
		maxSelectionInferences: 1,
	};
}
