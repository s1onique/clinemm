/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-02
 *
 * THE OBJECTIVE-VERIFICATION REGRESSION.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * The R2 objective verification boundary accepts an objective as VERIFIED
 * ONLY on a TRUSTED HOST VERDICT. There is no structural fallback: no
 * command text, no substring correlation and no generic successful exit
 * can establish that an objective's verification condition was met.
 *
 *   V1  THE DISCRIMINATOR — an UNRELATED successful command does NOT
 *       verify the objective, and NEITHER does a successful command that
 *       merely MENTIONS the required executable's name. (This is the P0 the
 *       reviewer reproduced against AMENDMENT-01.)
 *   V2  the required command was executed but FAILED → not verified.
 *   V3  a successful EDIT without verification → not verified.
 *   V4  the host's verification callback is UNAVAILABLE or THROWS → not
 *       verified (reported as unverified, never as a manufactured success).
 *   V5  the HOST VERDICT is affirmative → verified.
 *
 * EVIDENCE CLASS
 * --------------
 * SYNTHETIC_REAL_PRODUCTION_SEAM. Every assertion runs against the REAL
 * `AgentRuntime`, through the REAL R2 activation, dispatch and evaluation
 * path. Only the MODEL is scripted, and only at the model boundary.
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

/**
 * A deterministic scripted model that serves the R2 SELECTION INFERENCE
 * and then a fixed execution script.
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

/**
 * The R2 SELECTION REPLY.
 *
 * It names a bounded objective whose verification condition refers to ONE
 * SPECIFIC executable: the `check-value` regression.
 */
const SELECTION_REPLY: Record<string, unknown> = {
	objective: "Repair the disposable target so its VALUE constant is 2",
	firstStep: "Edit the disposable target module to set VALUE = 2",
	mutationScope: "the disposable workspace directory",
	verificationCondition:
		"the run_commands regression check `check-value` for VALUE reports PASS",
	obligationReferences: ["parent-task:original"],
	evidenceReferences: [
		"The last 3 consecutive execution round(s) produced no productive step",
	],
	successCondition: "the executable check `check-value` reports PASS",
	failureCondition:
		"the editable file cannot be changed or the check cannot pass",
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

/**
 * A command tool whose execution outcome is CONTROLLED by the test.
 *
 * `outcomes` maps a command substring to the outcome of the execution that
 * carries it. A command with no entry SUCCEEDS.
 */
function createCommandTool(
	calls: { count: number },
	outcomes: Record<string, "success" | "failure"> = {},
): AgentTool {
	return {
		name: "run_commands",
		description: "Runs commands",
		inputSchema: { type: "object" },
		async execute(input: unknown) {
			calls.count += 1;
			const record = (input ?? {}) as Record<string, unknown>;
			const commands = Array.isArray(record.commands)
				? (record.commands as unknown[])
				: [];
			const identity = commands
				.filter((entry): entry is string => typeof entry === "string")
				.join(" && ");
			const matched = Object.entries(outcomes).find(([needle]) =>
				identity.includes(needle),
			);
			if (matched?.[1] === "failure") {
				// The runtime's own executor boundary converts a THROW into
				// an `isError` tool result. That is the production path a
				// failing executable takes.
				throw new Error("the regression reported an error");
			}
			return "PASS: the requested evidence was collected";
		},
	};
}

/**
 * Build the R2 policy with the TRUSTED HOST VERIFICATION AUTHORITY.
 *
 * AMENDMENT-02 removed the substring verification gate: a command that
 * merely mentions the required executable's name is not evidence that the
 * executable ran. The ONLY authority is the host's own verdict.
 */
function gatedPolicy(
	overrides: {
		verifyObjective?: (
			objective: unknown,
			facts: unknown,
		) => boolean | undefined;
	} = {},
) {
	return {
		enabled: true,
		maxActivations: 2,
		maxObjectiveRounds: 8,
		maxSelectionInferences: 1,
		...(overrides.verifyObjective
			? { verifyObjective: overrides.verifyObjective }
			: {}),
	};
}

/**
 * Run the R2 activation over a scripted execution and collect the notices.
 */
async function runR2(options: {
	steps: Array<(request: AgentModelRequest) => AgentModelEvent[]>;
	tools: AgentTool[];
	policy: ReturnType<typeof gatedPolicy>;
}) {
	const model = new ScriptedModel(options.steps, SELECTION_REPLY);
	const runtime = new AgentRuntime({
		model,
		tools: options.tools,
		executionStagnationPolicy: {
			unproductiveRoundThreshold: 3,
			maxRecoveryInstructions: 2,
			enabled: true,
		},
		boundedObjectivePolicy: options.policy,
	});
	const notices: string[] = [];
	runtime.subscribe((event: AgentRuntimeEvent) => {
		if (event.type === "status-notice") {
			notices.push(event.message);
		}
	});
	await runtime.run("fix the disposable target module");
	return { model, notices };
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
// V1 — THE DISCRIMINATOR
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / V1 discriminator", () => {
	it("V1: an UNRELATED successful command does NOT verify the objective", async () => {
		const calls = { count: 0 };
		const steps = [
			...stalledRounds(),
			// The model performs an UNRELATED successful command. It is not
			// the required `check-value` regression.
			toolCallStep("u1", "run_commands", { commands: ["build-the-project"] }),
			finishStep(),
		];
		const { notices } = await runR2({
			steps,
			tools: [createInspectTool(calls), createCommandTool(calls)],
			policy: gatedPolicy(),
		});
		// The unrelated command DID run and DID succeed.
		expect(calls.count).toBeGreaterThan(0);
		// But the objective was NOT reported verified.
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		// And the failure was reported TRUTHFULLY.
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
	});

	it("V1b (THE P0): a successful command that merely MENTIONS the required executable's name does NOT verify the objective", async () => {
		const calls = { count: 0 };
		const steps = [
			...stalledRounds(),
			// The AMENDMENT-01 counterexample: a trivial `echo` whose text
			// contains the required executable's name. It SUCCEEDS, it
			// mentions `check-value`, and the required regression NEVER ran.
			toolCallStep("u2", "run_commands", { commands: ["echo check-value"] }),
			finishStep(),
		];
		const { notices } = await runR2({
			steps,
			tools: [createInspectTool(calls), createCommandTool(calls)],
			policy: gatedPolicy(),
		});
		expect(calls.count).toBeGreaterThan(0);
		// The objective was NOT reported verified.
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
	});

	it("V1c (THE P0): the case-folded mention does NOT verify the objective either", async () => {
		const calls = { count: 0 };
		const steps = [
			...stalledRounds(),
			toolCallStep("u3", "run_commands", { commands: ["CHECK-VALUE"] }),
			finishStep(),
		];
		const { notices } = await runR2({
			steps,
			tools: [createInspectTool(calls), createCommandTool(calls)],
			policy: gatedPolicy(),
		});
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// V2 — the required command ran but FAILED
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / V2 failed gate", () => {
	it("V2: the required command executed but FAILED does not verify the objective", async () => {
		const calls = { count: 0 };
		const steps = [
			...stalledRounds(),
			toolCallStep("g1", "run_commands", { commands: ["check-value"] }),
			finishStep(),
		];
		const { notices } = await runR2({
			steps,
			tools: [
				createInspectTool(calls),
				createCommandTool(calls, { "check-value": "failure" }),
			],
			policy: gatedPolicy(),
		});
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// V3 — a successful edit without verification
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / V3 edit only", () => {
	it("V3: a successful EDIT without the required gate does not verify the objective", async () => {
		const calls = { count: 0 };
		const steps = [
			...stalledRounds(),
			toolCallStep("e1", "editor", {
				path: "/tmp/target.ts",
				old_text: "VALUE = 1",
				new_text: "VALUE = 2",
			}),
			finishStep(),
		];
		const { notices } = await runR2({
			steps,
			tools: [createInspectTool(calls), createEditTool(calls)],
			policy: gatedPolicy(),
		});
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// V4 — the host's verification authority is unavailable or throws
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / V4 host verification unavailable", () => {
	it("V4a: a THROWING host verification callback does not verify the objective", async () => {
		const calls = { count: 0 };
		const steps = [
			...stalledRounds(),
			toolCallStep("h1", "run_commands", { commands: ["check-value"] }),
			finishStep(),
		];
		const { notices } = await runR2({
			steps,
			tools: [createInspectTool(calls), createCommandTool(calls)],
			policy: gatedPolicy({
				verifyObjective: () => {
					throw new Error("host verification unavailable");
				},
			}),
		});
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
	});

	it("V4b: with NO host verdict, a successful command does not verify the objective", async () => {
		const calls = { count: 0 };
		const steps = [
			...stalledRounds(),
			toolCallStep("h2", "run_commands", { commands: ["check-value"] }),
			finishStep(),
		];
		const { notices } = await runR2({
			steps,
			tools: [createInspectTool(calls), createCommandTool(calls)],
			policy: gatedPolicy(),
		});
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// V5 — the TRUSTED HOST VERDICT is affirmative
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / V5 host verdict", () => {
	it("V5: an AFFIRMATIVE host verdict verifies the objective", async () => {
		const calls = { count: 0 };
		const steps = [
			...stalledRounds(),
			toolCallStep("g1", "run_commands", { commands: ["check-value"] }),
			finishStep(),
		];
		const { notices } = await runR2({
			steps,
			tools: [createInspectTool(calls), createCommandTool(calls)],
			policy: gatedPolicy({
				verifyObjective: () => true,
			}),
		});
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(1);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: completed"),
			),
		).toHaveLength(1);
	});

	it("V5b: a NEGATIVE host verdict does not verify the objective", async () => {
		const calls = { count: 0 };
		const steps = [
			...stalledRounds(),
			toolCallStep("g2", "run_commands", { commands: ["check-value"] }),
			finishStep(),
		];
		const { notices } = await runR2({
			steps,
			tools: [createInspectTool(calls), createCommandTool(calls)],
			policy: gatedPolicy({
				verifyObjective: () => false,
			}),
		});
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
	});

	it("V5c: a host verdict that DECLINES (undefined) does not verify the objective", async () => {
		const calls = { count: 0 };
		const steps = [
			...stalledRounds(),
			toolCallStep("g3", "run_commands", { commands: ["check-value"] }),
			finishStep(),
		];
		const { notices } = await runR2({
			steps,
			tools: [createInspectTool(calls), createCommandTool(calls)],
			policy: gatedPolicy({
				verifyObjective: () => undefined,
			}),
		});
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
	});
});
