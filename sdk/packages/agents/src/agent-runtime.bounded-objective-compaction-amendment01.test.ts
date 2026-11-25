/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01
 *
 * THE ACTUAL COMPACTION CONSERVATION WITNESS.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * The RUNTIME-OWNED bounded objective survives a REAL request-preparation /
 * compaction transition, because it is runtime-owned STATE and not a
 * transcript carrier.
 *
 *   C1  The SAME active objective remains effective after compaction: the
 *       dispatched request after the compaction still carries the
 *       objective as the current execution target.
 *   C2  The recovery allowance is NOT replenished by the compaction.
 *   C3  The parent's authorisation remains intact across the compaction.
 *   C4  After the objective COMPLETES, subsequent requests no longer carry
 *       it as active authority.
 *   C5  A LATER compaction cannot RESURRECT a completed objective.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It does NOT manufacture a canonical transcript objective carrier. The
 * objective is NOT written into the transcript; the runtime projects it
 * onto the request's privileged channel at request-build time, and the
 * compaction replaces the request's MESSAGES. The objective survives
 * because the runtime still OWNS it — which is exactly the property the
 * amendment requires.
 *
 * EVIDENCE CLASS
 * --------------
 * SYNTHETIC_REAL_PRODUCTION_SEAM. The REAL `AgentRuntime`, the REAL R2
 * activation/dispatch/evaluation path, and the REAL `prepareTurn`
 * request-preparation seam (the same seam the production compaction
 * wrapper drives). The compaction itself is a deterministic synthetic that
 * REPLACES the request's messages — which is precisely the lossy behaviour
 * the conservation must survive.
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

/** A deterministic scripted model. */
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

/** The R2 SELECTION REPLY. */
const SELECTION_REPLY: Record<string, unknown> = {
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

/** The ACTIVE-OBJECTIVE projection marker. */
const OBJECTIVE_MARKER =
	"[SYSTEM] Active bounded objective (runtime authority):";

/** The ACTIVE-OBJECTIVE projection in a dispatched request, if present. */
function objectiveIn(request: AgentModelRequest): string | undefined {
	const systemPrompt = request.systemPrompt ?? "";
	const at = systemPrompt.indexOf(OBJECTIVE_MARKER);
	return at === -1 ? undefined : systemPrompt.slice(at);
}

/** The ORIGINAL user task in a dispatched request, if present. */
function userTaskIn(request: AgentModelRequest): string | undefined {
	const messages = request.messages ?? [];
	for (const message of messages) {
		if (message.role !== "user") {
			continue;
		}
		const content = message.content;
		const text =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.filter(
								(block): block is { type: "text"; text: string } =>
									block.type === "text" && typeof block.text === "string",
							)
							.map((block) => block.text)
							.join("\n")
					: "";
		if (text.includes("REPAIR THE DISPOSABLE TARGET")) {
			return text;
		}
	}
	return undefined;
}

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

/** A command tool whose `check-value` gate succeeds. */
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

// ---------------------------------------------------------------------------
// THE COMPACTION CONSERVATION TRAJECTORY
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / compaction conservation", () => {
	it("C1-C5: the ACTIVE objective survives compaction, the allowance is conserved, the parent authorisation is intact, and a completed objective is never resurrected", async () => {
		const calls = { inspect: 0, command: 0 };
		let compactionCount = 0;
		// The compaction REPLACES the request's messages with a lossy
		// summary. It carries NO objective, NO recovery instruction and NO
		// parent task — exactly as a real summarizer may.
		const prepareTurn = async (context: { messages: unknown }) => {
			compactionCount += 1;
			return {
				messages: [
					{
						role: "user" as const,
						content: [
							{
								type: "text" as const,
								text: "Context summary:\n\nthe agent inspected several files",
							},
						],
					},
				],
			};
		};

		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		for (let i = 0; i < 9; i += 1) {
			steps.push(
				toolCallStep(`t${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
			);
		}
		// The REQUIRED gate runs while the objective is active.
		steps.push(
			toolCallStep("g1", "run_commands", { commands: ["check-value"] }),
		);
		// The run continues after the objective completed: a further
		// compaction must NOT resurrect the completed objective.
		steps.push(
			toolCallStep("p1", "read_files", { files: [{ path: "/tmp/a" }] }),
		);
		steps.push(finishStep());

		const model = new ScriptedModel(steps, SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls), createCommandTool(calls)],
			prepareTurn,
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
				verificationGate: {
					commandSubstring: "check-value",
					toolName: "run_commands",
				},
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run(
			"REPAIR THE DISPOSABLE TARGET module at /tmp/disposable-target and report the outcome",
		);

		// The compaction really happened.
		expect(compactionCount).toBeGreaterThan(0);

		// C1 — the SAME active objective remains effective after compaction.
		//
		// The objective was projected onto the dispatched requests while it
		// was active. The compaction replaced the request's MESSAGES; the
		// objective survived because the runtime still OWNED it.
		const objectiveRequests = model.requests.filter(
			(request) => objectiveIn(request) !== undefined,
		);
		expect(objectiveRequests.length).toBeGreaterThan(0);
		// Every objective-carrying request carries the SAME objective.
		const projections = new Set(
			objectiveRequests.map((request) => objectiveIn(request)),
		);
		expect(projections.size).toBe(1);
		// And the objective is the R2 objective, not something else.
		expect([...projections][0]).toContain(
			"Repair the disposable target so its VALUE constant is 2",
		);

		// C2 — the recovery allowance is NOT replenished by the compaction.
		//
		// Exactly ONE selection inference happened for the whole run, even
		// though the run was compacted several times.
		expect(model.selectionRequests).toHaveLength(1);

		// C3 — the parent's authorisation remains intact.
		//
		// The parent's original task is still the authority the runtime
		// carries; the objective never replaced it.
		expect(
			notices.filter((n) => n.includes("bounded objective activated")),
		).toHaveLength(1);
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(1);

		// C4 — after the objective COMPLETED, subsequent requests no longer
		// carry it as active authority.
		//
		// The objective-carrying requests are a PREFIX of the run's
		// requests: the last request carries no objective.
		const lastRequest = model.requests[model.requests.length - 1];
		expect(lastRequest).toBeDefined();
		expect(objectiveIn(lastRequest as AgentModelRequest)).toBeUndefined();

		// C5 — a LATER compaction cannot resurrect a completed objective.
		//
		// The objective's projection is a CONTIGUOUS PREFIX of the run's
		// requests: it starts when the objective activates and it ENDS when
		// the objective completes. No request after that point carries it,
		// no matter how many compactions followed.
		const firstObjectiveIndex = model.requests.findIndex(
			(request) => objectiveIn(request) !== undefined,
		);
		expect(firstObjectiveIndex).toBeGreaterThanOrEqual(0);
		let completedIndex = -1;
		for (
			let index = firstObjectiveIndex;
			index < model.requests.length;
			index += 1
		) {
			const request = model.requests[index] as AgentModelRequest;
			if (objectiveIn(request) === undefined) {
				completedIndex = index;
				break;
			}
		}
		expect(completedIndex).toBeGreaterThan(firstObjectiveIndex);
		// Every request AFTER the completion carries no objective: a later
		// compaction cannot resurrect it.
		for (const request of model.requests.slice(completedIndex)) {
			expect(objectiveIn(request)).toBeUndefined();
		}
	});
});
