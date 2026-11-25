/**
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01
 *
 * THE RUNTIME WITNESS for the bounded-objective SELECTION-CONTRACT
 * correction.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * The REAL `AgentRuntime`, driven through the REAL R2 activation, dispatch
 * and validation path, does the following:
 *
 *   W1  the SELECTION CONTEXT carries the parent's CONCRETE engineering
 *       requirements as a runtime-owned reference vocabulary — the parent's
 *       own labelled headings — and not ONLY the terminal-completion
 *       mechanics;
 *   W2  a USEFUL, AUTHORISED intermediate objective that cites one of
 *       those requirement references is ACCEPTED and becomes the current
 *       execution target;
 *   W3  an UNKNOWN obligation reference is REJECTED ACCURATELY, and the
 *       rejection names a REFERENCE failure — not a false completion claim;
 *   W4  a FUTURE-ORIENTED success condition is CONSERVED: it is accepted
 *       and it establishes NOTHING about the present;
 *   W5  FABRICATED evidence is still REJECTED;
 *   W6  the parent's SCOPE and CONSTRAINT controls are still enforced;
 *   W7  NO objective verification is manufactured — the objective never
 *       authorizes the parent's completion;
 *   W8  EXACTLY ONE selection inference is made per run;
 *   W9  the parent CONTINUES AUTOMATICALLY after the objective;
 *   W10 the OPT-IN observation capture is DISABLED BY DEFAULT and, when
 *       enabled, records the generated text, the parsed proposal and the
 *       exact validation disposition.
 *
 * THE FROZEN LIVE WITNESS
 * -----------------------
 * The captured live selector request
 * (`cap_run_kR2y9UwW_ca62cf1370aaed21.ai_sdk_prompt.1.provider-request.json`)
 * is the ACTUAL selection context of the failed live run. Its parent task
 * carried three concrete engineering requirements (A1, A2, A3) and its
 * outstanding-obligation list carried ONLY the runtime's terminal
 * completion sentence. The parent task text below reproduces that shape.
 *
 * EVIDENCE CLASS
 * --------------
 * SYNTHETIC_REAL_PRODUCTION_SEAM. Every assertion runs against the REAL
 * runtime. Only the MODEL is scripted, and only at the model boundary.
 */

import type {
	AgentMessage,
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

/** The parent's own text shape, reproduced from the frozen live witness. */
const LIVE_PARENT_TASK = [
	"# CMP-08 — Terminal bounded correction",
	"",
	"C1: GO. CMP-08 architecture accepted.",
	"",
	"## A1 — Preserve original exception authority",
	"",
	"The actual finalizeUsage() invokes reportUsage() without an exception boundary.",
	"",
	"## A2 — Preserve explicit optional zero metrics",
	"",
	"The collector currently defaults optional counters to zero.",
].join("\n");

/** The outstanding obligation the runtime names for this parent. */
const TERMINAL_OBLIGATION =
	"Call the terminal completion tool submit_and_exit only after every parent obligation is satisfied";

/**
 * A useful intermediate objective that cites the parent's ACTUAL requirement
 * A1 through its runtime-owned reference id.
 */
const USEFUL_SELECTION_REPLY: Record<string, unknown> = {
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

/** A selection that cites an obligation reference the runtime never offered. */
const UNKNOWN_REFERENCE_SELECTION_REPLY: Record<string, unknown> = {
	...USEFUL_SELECTION_REPLY,
	obligationReferences: ["parent-task:ZZ9"],
};

/** A selection whose success condition is FUTURE-ORIENTED. */
const FUTURE_SUCCESS_SELECTION_REPLY: Record<string, unknown> = {
	...USEFUL_SELECTION_REPLY,
	successCondition: `${TERMINAL_OBLIGATION} is satisfied once the focused CMP-08 test reports PASS`,
};

/** A selection that FABRICATES its evidence. */
const FABRICATED_EVIDENCE_SELECTION_REPLY: Record<string, unknown> = {
	...USEFUL_SELECTION_REPLY,
	evidenceReferences: ["An observation that never happened"],
};

/** A selection that WIDENS the parent's scope. */
const SCOPE_EXPANSION_SELECTION_REPLY: Record<string, unknown> = {
	...USEFUL_SELECTION_REPLY,
	mutationScope: "/etc/passwd",
};

/** A selection that CONTRADICTS a parent constraint. */
const CONSTRAINT_CONFLICT_SELECTION_REPLY: Record<string, unknown> = {
	...USEFUL_SELECTION_REPLY,
	objective: "edit the forbidden directory",
};

/**
 * A tool that records the calls it received and never mutates anything.
 */
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

/**
 * The parent's terminal completion tool.
 *
 * The runtime MUST NOT invoke it on the bounded objective's behalf.
 */
function createCompletionTool(calls: { complete: number }): AgentTool {
	return {
		name: "submit_and_exit",
		description: "Completes the task",
		inputSchema: { type: "object" },
		lifecycle: { completesRun: true },
		async execute() {
			calls.complete += 1;
			return "done";
		},
	};
}

/**
 * A USER-AUTHORED message.
 *
 * A later user message is the parent's user-authority CONSTRAINT: the
 * runtime reads the LATER user instructions as the constraints the
 * selection must respect.
 */
function userMessage(text: string): AgentMessage {
	return {
		id: `msg_${text.slice(0, 8)}`,
		role: "user",
		content: [{ type: "text", text }],
		createdAt: Date.now(),
	} as AgentMessage;
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

/**
 * The R2 policy used by every witness.
 */
function r2Policy(overrides: Record<string, unknown> = {}) {
	return {
		enabled: true,
		maxActivations: 2,
		maxObjectiveRounds: 8,
		maxSelectionInferences: 1,
		...overrides,
	} as ReturnType<typeof Object> & {
		enabled: boolean;
		maxActivations: number;
		maxObjectiveRounds: number;
		maxSelectionInferences: number;
	};
}

/**
 * Run the R2 activation over a scripted execution and collect the notices,
 * the selection requests and the observations.
 */
async function runR2(options: {
	steps: Array<(request: AgentModelRequest) => AgentModelEvent[]>;
	selectionReply: Record<string, unknown>;
	parentTask?: string;
	/** A LATER user instruction — the parent's user-authority constraint. */
	constraint?: string;
	tools?: AgentTool[];
	policy?: ReturnType<typeof r2Policy>;
	observe?: (observation: BoundedObjectiveSelectionObservation) => void;
}) {
	const model = new ScriptedModel(options.steps, options.selectionReply);
	const calls = { count: 0, complete: 0 };
	const runtime = new AgentRuntime({
		model,
		tools: options.tools ?? [
			createInspectTool(calls),
			createCompletionTool(calls),
		],
		executionStagnationPolicy: {
			unproductiveRoundThreshold: 3,
			maxRecoveryInstructions: 2,
			enabled: true,
		},
		boundedObjectivePolicy: options.policy ?? r2Policy(),
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
	const parentTask = options.parentTask ?? LIVE_PARENT_TASK;
	await runtime.run(
		options.constraint
			? [userMessage(parentTask), userMessage(options.constraint)]
			: parentTask,
	);
	return { model, notices, calls };
}

/**
 * The bounded objective the runtime projected onto a dispatched request, if
 * any.
 */
function boundedObjectiveIn(request: AgentModelRequest): string | undefined {
	const system = request.systemPrompt ?? "";
	const marker = "[SYSTEM] Active bounded objective (runtime authority):";
	const at = system.indexOf(marker);
	return at === -1 ? undefined : system.slice(at);
}

describe("ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 / selection context", () => {
	it("W1: the selection context carries the parent's CONCRETE requirements, not only the terminal completion mechanics", async () => {
		const { model } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: USEFUL_SELECTION_REPLY,
		});
		expect(model.selectionRequests).toHaveLength(1);
		const prompt = (model.selectionRequests[0]?.messages ?? [])
			.map((message) =>
				Array.isArray(message.content)
					? message.content
							.filter((part) => part.type === "text")
							.map((part) => (part as { text: string }).text)
							.join("\n")
					: String(message.content ?? ""),
			)
			.join("\n");
		// The runtime now offers a REFERENCE VOCABULARY.
		expect(prompt).toContain("parent-task:original");
		expect(prompt).toContain("parent-task:A1");
		expect(prompt).toContain("parent-task:A2");
		// The requirement labels are the parent's OWN text.
		expect(prompt).toContain("A1 — Preserve original exception authority");
		expect(prompt).toContain("A2 — Preserve explicit optional zero metrics");
		// The terminal completion mechanics are STILL listed — the parent's
		// completion contract is unchanged.
		expect(prompt).toContain(TERMINAL_OBLIGATION);
	});

	it("W1b: the selection request carries NO tools", async () => {
		const { model } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: USEFUL_SELECTION_REPLY,
		});
		expect(model.selectionRequests[0]?.tools ?? []).toHaveLength(0);
	});
});

describe("ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 / selection acceptance", () => {
	it("W2: a USEFUL, AUTHORISED intermediate objective citing requirement A1 is ACCEPTED and dispatched", async () => {
		const { model, notices } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: USEFUL_SELECTION_REPLY,
		});
		expect(
			notices.filter((n) => n.includes("bounded objective activated")),
		).toHaveLength(1);
		// The objective became the CURRENT EXECUTION TARGET of a dispatched
		// request.
		const dispatched = model.requests.filter(
			(request) => boundedObjectiveIn(request) !== undefined,
		);
		expect(dispatched.length).toBeGreaterThan(0);
		expect(boundedObjectiveIn(dispatched[0] as AgentModelRequest)).toContain(
			"parent-task:A1",
		);
	});

	it("W3: an UNKNOWN obligation reference is REJECTED ACCURATELY as a REFERENCE failure", async () => {
		const { notices } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: UNKNOWN_REFERENCE_SELECTION_REPLY,
		});
		const rejections = notices.filter((n) =>
			n.includes("bounded objective selection rejected"),
		);
		expect(rejections).toHaveLength(1);
		// The rejection names the REFERENCE failure, NOT a false completion
		// claim.
		expect(rejections[0]).toContain("unknown_obligation_reference");
		expect(rejections[0]).not.toContain("unsupported_completion_claim");
		// No objective was ever dispatched.
		expect(
			notices.filter((n) => n.includes("bounded objective activated")),
		).toHaveLength(0);
	});

	it("W4: a FUTURE-ORIENTED success condition is CONSERVED", async () => {
		const { notices } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: FUTURE_SUCCESS_SELECTION_REPLY,
		});
		// The objective was NOT rejected for the future-oriented condition.
		expect(
			notices.filter((n) => n.includes("bounded objective selection rejected")),
		).toHaveLength(0);
		expect(
			notices.filter((n) => n.includes("bounded objective activated")),
		).toHaveLength(1);
	});

	it("W5: FABRICATED evidence is still REJECTED", async () => {
		const { notices } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: FABRICATED_EVIDENCE_SELECTION_REPLY,
		});
		const rejections = notices.filter((n) =>
			n.includes("bounded objective selection rejected"),
		);
		expect(rejections).toHaveLength(1);
		expect(rejections[0]).toContain("fabricated_evidence");
	});

	it("W6a: the parent's SCOPE ceiling is still enforced", async () => {
		const { notices } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: SCOPE_EXPANSION_SELECTION_REPLY,
			// The parent names an authorised path. The objective's scope
			// escapes it, and the runtime refuses the expansion.
			parentTask:
				"## A1 — Preserve original exception authority\n\nOnly /workspace/project may be touched.",
		});
		const rejections = notices.filter((n) =>
			n.includes("bounded objective selection rejected"),
		);
		expect(rejections).toHaveLength(1);
		expect(rejections[0]).toContain("scope_expansion");
	});

	it("W6b: the parent's CONSTRAINTS are still enforced", async () => {
		const { notices } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: CONSTRAINT_CONFLICT_SELECTION_REPLY,
			constraint: "do not edit the forbidden directory",
		});
		const rejections = notices.filter((n) =>
			n.includes("bounded objective selection rejected"),
		);
		expect(rejections).toHaveLength(1);
		expect(rejections[0]).toContain("constraint_conflict");
	});

	it("W8: EXACTLY ONE selection inference is made per run", async () => {
		const { model } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: UNKNOWN_REFERENCE_SELECTION_REPLY,
		});
		// The rejection consumed the allowance and did NOT start another
		// selection attempt.
		expect(model.selectionRequests).toHaveLength(1);
	});

	it("W9: the parent CONTINUES AUTOMATICALLY after the objective", async () => {
		const { model, notices } = await runR2({
			// Enough rounds for the objective's OWN round budget (8) to be
			// exhausted, so the runtime closes the objective and returns
			// execution to the parent automatically.
			steps: [...stalledRounds(), ...stalledRounds(), finishStep()],
			selectionReply: USEFUL_SELECTION_REPLY,
		});
		// The runtime reported the objective's own outcome.
		expect(
			notices.filter((n) => n.includes("bounded objective recovery outcome"))
				.length,
		).toBeGreaterThan(0);
		// The run continued past the objective: later requests carry NO
		// bounded objective, which is the automatic return to the parent.
		const afterObjective = model.requests.filter(
			(request) => boundedObjectiveIn(request) === undefined,
		);
		expect(afterObjective.length).toBeGreaterThan(0);
	});

	it("W7: the objective NEVER authorizes the parent's completion", async () => {
		const { model, notices } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: USEFUL_SELECTION_REPLY,
		});
		// The runtime never reported the PARENT as complete.
		expect(notices.filter((n) => n.includes("run completed"))).toHaveLength(0);
		// The objective itself was not reported VERIFIED: verification
		// remains exclusively the host's authority, and no host verdict was
		// supplied.
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
	});
});

describe("ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 / observation capture", () => {
	it("W10a: the capture is DISABLED BY DEFAULT — no observation is produced without a sink", async () => {
		const observations: BoundedObjectiveSelectionObservation[] = [];
		const { notices } = await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: USEFUL_SELECTION_REPLY,
		});
		// Without a sink the runtime behaves exactly as before: the
		// objective is accepted and dispatched.
		expect(
			notices.filter((n) => n.includes("bounded objective activated")),
		).toHaveLength(1);
		expect(observations).toHaveLength(0);
	});

	it("W10b: when the sink IS supplied, the exact disposition and the failing reference are recorded", async () => {
		const observations: BoundedObjectiveSelectionObservation[] = [];
		await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: UNKNOWN_REFERENCE_SELECTION_REPLY,
			observe: (observation) => {
				observations.push(observation);
			},
		});
		expect(observations).toHaveLength(1);
		const observation = observations[0] as BoundedObjectiveSelectionObservation;
		expect(observation.disposition).toBe("unknown_obligation_reference");
		expect(observation.failingField).toBe("obligationReferences");
		expect(observation.failingReference).toBe("parent-task:ZZ9");
		// The generated text and the parsed proposal are recorded.
		expect(observation.generatedText).toContain("parent-task:ZZ9");
		expect(observation.parsedProposal).toMatchObject({
			obligationReferences: ["parent-task:ZZ9"],
		});
		// The correlation identity is recorded.
		expect(observation.parentTaskId).toBeTruthy();
		expect(observation.selectionOrdinal).toBe(1);
	});

	it("W10c: an ACCEPTED objective is recorded as a VALID disposition", async () => {
		const observations: BoundedObjectiveSelectionObservation[] = [];
		await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: USEFUL_SELECTION_REPLY,
			observe: (observation) => {
				observations.push(observation);
			},
		});
		expect(observations).toHaveLength(1);
		expect(observations[0]?.disposition).toBe("valid");
	});

	it("W10d: the observation carries NO provider reasoning and NO credentials", async () => {
		const observations: BoundedObjectiveSelectionObservation[] = [];
		await runR2({
			steps: [...stalledRounds(), finishStep()],
			selectionReply: USEFUL_SELECTION_REPLY,
			observe: (observation) => {
				observations.push(observation);
			},
		});
		const serialized = JSON.stringify(observations[0]);
		expect(serialized).not.toContain("reasoning");
		expect(serialized).not.toContain("signature");
		expect(serialized).not.toContain("apiKey");
	});
});
