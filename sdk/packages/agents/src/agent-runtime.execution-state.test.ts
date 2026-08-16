/**
 * RSMT01 AgentRuntime — canonical execution state projection.
 *
 * Phase B of the bounded-recovery ACT pinned the recovery
 * mechanism. Phase B of this ACT (RUNTIME-STATE-MACHINE-
 * TRUTH01) introduces the ACTIVITY / INTERACTION projection
 * that lives alongside `status: AgentRunStatus` and is the
 * single source of truth for "is the model streaming?",
 * "is at least one tool in flight?", and "are we waiting
 * on an approval decision?".
 *
 * Tests in this file pin the invariants in
 * `AgentRuntimeExecutionState`'s doc comment. They are
 * deliberately orthogonal to the recovery surface.
 *
 * Test naming convention: RSM01..RSM15.
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeExecutionState,
	AgentTool,
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";
import {
	barrier,
	type Barrier,
} from "./runtime/recovery/test-utils/deterministic-barrier";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

const ZERO_EXECUTION: AgentRuntimeExecutionState = {
	modelStreaming: false,
	tooling: false,
	awaitingApproval: false,
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

const finishStep = (): AgentModelEvent[] => [
	{ type: "text-delta", text: "done" },
	{ type: "finish", reason: "stop" },
];

const failStep = (err: Error): () => AgentModelEvent[] => {
	return () => {
		throw err;
	};
};

/**
 * ScriptedModel that returns each step ONCE per
 * `model.stream(...)` invocation. The runtime MAY call
 * the model multiple times in one run; this model
 * keeps yielding the same predefined steps each call
 * (an empty stream after the supplied steps run out),
 * which is the same pattern the recovery tests use.
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

/**
 * MultiStepModel: returns a different predefined event
 * array on each successive `model.stream(...)` invocation.
 * The runtime can complete a successful run by consuming
 * step 1 (tool-call) then step 2 (clean completion).
 */
class MultiStepModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	constructor(private readonly steps: AgentModelEvent[][]) {}
	async stream(
		_request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(_request);
		const step = this.steps[this.requests.length - 1] ?? [];
		return (async function* () {
			for (const ev of step) yield ev;
		})();
	}
}

function passingTool(name: string): AgentTool<{ x: number }, { ok: true }> {
	return {
		name,
		description: "passing tool",
		inputSchema: { type: "object" },
		async execute(_input: { x: number }) {
			return { ok: true as const };
		},
	};
}


async function waitForPending(
	bar: Barrier,
	ids: string[],
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const pending = bar.pending();
		if (ids.every((id) => pending.includes(id))) return;
		await new Promise((r) => setImmediate(r));
	}
	throw new Error(
		`waitForPending: ids=[${ids.join(",")}] not all arrived; pending=${JSON.stringify(bar.pending())}`,
	);
}

function tickNTimes(n: number): Promise<void> {
	let p = Promise.resolve();
	for (let i = 0; i < n; i++) {
		p = p.then(() => new Promise((r) => setImmediate(r)));
	}
	return p;
}


describe("RSMT01 / RSM01 initial idle", () => {
	it("fresh AgentRuntime reports execution = ZERO_EXECUTION", () => {
		const runtime = new AgentRuntime({
			model: new ScriptedModel([finishStep]),
			tools: [],
		});
		const exec = runtime.snapshot().execution;
		expect(exec).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM02 — model streaming begins
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM02 model-streaming begins", () => {
	it("snapshot.execution.modelStreaming is true while the for-await is parked", async () => {
		const bar = barrier();
		const streamOpen = { hit: false };
		const streamModel: AgentModel = {
			async stream(_request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
				streamOpen.hit = true;
				const gate = bar.controllable<unknown>("stream");
				await gate.arrive();
				return (async function* () {
					yield { type: "text-delta", text: "x" } as AgentModelEvent;
					yield { type: "finish", reason: "stop" } as AgentModelEvent;
				})();
			},
		};
		const runtime = new AgentRuntime({
			model: streamModel,
			tools: [],
		});
		const observations: AgentRuntimeExecutionState[] = [];
		runtime.subscribe((event) => {
			observations.push(event.snapshot.execution);
		});
		const runP = runtime.run("RSM02");
		await waitForPending(bar, ["stream"], 1000);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(streamOpen.hit).toBe(true);
		expect(runtime.snapshot().execution.modelStreaming).toBe(true);
		expect(runtime.snapshot().execution.tooling).toBe(false);
		expect(runtime.snapshot().execution.awaitingApproval).toBe(false);
		bar.release("stream", undefined);
		await runP;
		expect(runtime.snapshot().execution.modelStreaming).toBe(false);
		const duringStream = observations.some(
			(e) => e.modelStreaming === true,
		);
		expect(duringStream).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// RSM03 — model streaming ends (post-completion)
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM03 model-streaming ends", () => {
	it("after the stream settles, modelStreaming is false", async () => {
		const tool = passingTool("counter");
		const runtime = new AgentRuntime({
			model: new MultiStepModel([
				[
					{
						type: "tool-call-delta",
						toolCallId: "c1",
						toolName: "counter",
						inputText: JSON.stringify({ x: 1 }),
					},
					{ type: "finish", reason: "tool-calls" },
				],
				[
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				],
			]),
			tools: [tool],
		});
		const result = await runtime.run("RSM03");
		expect(result.status).toBe("completed");
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM04 — tool activity (single tool)
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM04 tool activity", () => {
	it("tooling is true while a tool call is in flight", async () => {
		const bar = barrier();
		const counterGate = bar.controllable<unknown>("counter");
		const streamModel: AgentModel = new MultiStepModel([
			[
				{
					type: "tool-call-delta",
					toolCallId: "c1",
					toolName: "counter",
					inputText: JSON.stringify({ x: 1 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			finishStep(),
		]);
		const wrappingTool: AgentTool<{ x: number }, { ok: true }> = {
			name: "counter",
			description: "barrier-controlled",
			inputSchema: { type: "object" },
			async execute() {
				await counterGate.arrive();
				return { ok: true as const };
			},
		};
		const runtime = new AgentRuntime({
			model: streamModel,
			tools: [wrappingTool],
		});
		const runP = runtime.run("RSM04");
		await waitForPending(bar, ["counter"], 1000);
		await new Promise<void>((resolve) => setImmediate(resolve));
		const exec = runtime.snapshot().execution;
		expect(exec.tooling).toBe(true);
		expect(exec.modelStreaming).toBe(false);
		bar.release("counter", undefined);
		await runP;
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM05 — parallel batch atomicity
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM05 parallel batch atomicity", () => {
	it("tooling stays true across sibling completions until the batch ends", async () => {
		const bar = barrier();
		const slowGate = bar.controllable<unknown>("slow");
		const fastGate = bar.controllable<unknown>("fast");
		const slowTool: AgentTool<{ x: number }, { ok: true }> = {
			name: "slow",
			description: "barrier-controlled",
			inputSchema: { type: "object" },
			async execute() {
				(await slowGate.arrive()) as unknown;
				return { ok: true as const };
			},
		};
		const fastTool: AgentTool<{ x: number }, { ok: true }> = {
			name: "fast",
			description: "barrier-controlled",
			inputSchema: { type: "object" },
			async execute() {
				(await fastGate.arrive()) as unknown;
				return { ok: true as const };
			},
		};
		const streamModel: AgentModel = new MultiStepModel([
			[
				{
					type: "tool-call-delta",
					toolCallId: "s1",
					toolName: "slow",
					inputText: JSON.stringify({ x: 1 }),
				},
				{
					type: "tool-call-delta",
					toolCallId: "f1",
					toolName: "fast",
					inputText: JSON.stringify({ x: 2 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			finishStep(),
		]);
		const runtime = new AgentRuntime({
			model: streamModel,
			tools: [slowTool, fastTool],
			toolExecution: "parallel",
		});
		const runP = runtime.run("RSM05");
		await waitForPending(bar, ["slow"], 1000);
		await waitForPending(bar, ["fast"], 1000);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(runtime.snapshot().execution.tooling).toBe(true);
		bar.release("fast", undefined);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(runtime.snapshot().execution.tooling).toBe(true);
		bar.release("slow", undefined);
		await runP;
		expect(runtime.snapshot().execution.tooling).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// RSM06 — awaiting approval begins
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM06 awaiting approval begins", () => {
	it("awaitingApproval is true while requestToolApproval is in flight", async () => {
		const bar = barrier();
		const approvalGate = bar.controllable<unknown>("approval");
		const streamModel: AgentModel = new MultiStepModel([
			[
				{
					type: "tool-call-delta",
					toolCallId: "a1",
					toolName: "counter",
					inputText: JSON.stringify({ x: 1 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			finishStep(),
		]);
		const runtime = new AgentRuntime({
			model: streamModel,
			tools: [passingTool("counter")],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval: async () => {
				(await approvalGate.arrive()) as unknown;
				return { approved: true };
			},
		});
		const runP = runtime.run("RSM06");
		await waitForPending(bar, ["approval"], 1000);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(runtime.snapshot().execution.awaitingApproval).toBe(true);
		bar.release("approval", undefined);
		await runP;
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM07 — awaiting approval cleared after decision
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM07 awaiting approval cleared", () => {
	it("awaitingApproval is false after the approval decision is delivered", async () => {
		const runtime = new AgentRuntime({
			model: new MultiStepModel([
				[toolCallStep("c1", "counter", { x: 1 })()[0],
				 { type: "finish", reason: "tool-calls" }],
				finishStep(),
			]),
			tools: [passingTool("counter")],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval: async () => ({ approved: true }),
		});
		await runtime.run("RSM07");
		expect(runtime.snapshot().execution.awaitingApproval).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// RSM08 — host DENY clears awaitingApproval
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM08 host DENY clears awaitingApproval", () => {
	it("host DENY is a completed control decision; awaitingApproval is false", async () => {
		const deniedTool: AgentTool<{ x: number }, never> = {
			name: "needs_approval",
			description: "always denied",
			inputSchema: { type: "object" },
			async execute() {
				throw new Error("executor should not run after host DENY");
			},
		};
		const runtime = new AgentRuntime({
			model: new MultiStepModel([
				[
					{
						type: "tool-call-delta",
						toolCallId: "d1",
						toolName: "needs_approval",
						inputText: JSON.stringify({ x: 1 }),
					},
					{
						type: "tool-call-delta",
						toolCallId: "o1",
						toolName: "counter",
						inputText: JSON.stringify({ x: 2 }),
					},
					{ type: "finish", reason: "tool-calls" },
				],
				finishStep(),
			]),
			tools: [deniedTool, passingTool("counter")],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval: async (req: { toolName: string }) => {
				if (req.toolName === "needs_approval") {
					return {
						approved: false,
						reason: "host_policy_denied",
						decision: { kind: "deny" },
					};
				}
				return { approved: true };
			},
		});
		await runtime.run("RSM08");
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM09 — abort during model streaming
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM09 abort during model streaming", () => {
	it("abort while the for-await is parked clears modelStreaming", async () => {
		const bar = barrier();
		const streamGate = bar.controllable<unknown>("stream");
		const streamModel: AgentModel = {
			async stream(_request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
				(await streamGate.arrive()) as unknown;
				return (async function* () {
					yield { type: "text-delta", text: "x" } as AgentModelEvent;
				})();
			},
		};
		const runtime = new AgentRuntime({
			model: streamModel,
			tools: [],
		});
		const runP = runtime.run("RSM09");
		await waitForPending(bar, ["stream"], 1000);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(runtime.snapshot().execution.modelStreaming).toBe(true);
		runtime.abort("test abort");
		bar.release("stream", undefined);
		await runP;
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM10 — abort during approval
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM10 abort during approval", () => {
	it("abort while awaitingApproval clears the flag", async () => {
		const bar = barrier();
		const approvalGate = bar.controllable<unknown>("approval");
		const streamModel: AgentModel = {
			async stream(_request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
				return (async function* () {
					yield {
						type: "tool-call-delta",
						toolCallId: "a1",
						toolName: "counter",
						inputText: JSON.stringify({ x: 1 }),
					} as AgentModelEvent;
					yield { type: "finish", reason: "tool-calls" } as AgentModelEvent;
				})();
			},
		};
		const runtime = new AgentRuntime({
			model: streamModel,
			tools: [passingTool("counter")],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval: async () => {
				(await approvalGate.arrive()) as unknown;
				return { approved: true };
			},
		});
		const runP = runtime.run("RSM10");
		await waitForPending(bar, ["approval"], 1000);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(runtime.snapshot().execution.awaitingApproval).toBe(true);
		runtime.abort("test abort");
		bar.release("approval", undefined);
		await runP;
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM11 — run-finished → terminal flags cleared
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM11 run-finished clears execution", () => {
	it("completed run: execution is ZERO_EXECUTION", async () => {
		const runtime = new AgentRuntime({
			model: new MultiStepModel([
				[
					{
						type: "tool-call-delta",
						toolCallId: "c1",
						toolName: "counter",
						inputText: JSON.stringify({ x: 1 }),
					},
					{ type: "finish", reason: "tool-calls" },
				],
				finishStep(),
			]),
			tools: [passingTool("counter")],
		});
		const result = await runtime.run("RSM11");
		expect(result.status).toBe("completed");
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM12 — run-failed → terminal flags cleared
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM12 run-failed clears execution", () => {
	it("failed run: execution is ZERO_EXECUTION", async () => {
		const runtime = new AgentRuntime({
			model: {
				async stream(_request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
					throw new Error("model transport failure");
				},
			},
			tools: [],
		});
		const result = await runtime.run("RSM12");
		expect(result.status).toBe("failed");
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM13 — restore() resets execution
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM13 restore resets execution", () => {
	it("restore() flushes execution to ZERO_EXECUTION", async () => {
		const runtime = new AgentRuntime({
			model: new MultiStepModel([
				[
					{
						type: "tool-call-delta",
						toolCallId: "c1",
						toolName: "counter",
						inputText: JSON.stringify({ x: 1 }),
					},
					{ type: "finish", reason: "tool-calls" },
				],
				finishStep(),
			]),
			tools: [passingTool("counter")],
		});
		await runtime.run("RSM13");
		runtime.restore([]);
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM14 — next run starts fresh
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM14 next-run freshness", () => {
	it("run #1 → run #2 on same AgentRuntime: no stale flags", async () => {
		const tool = passingTool("counter");
		const runtime = new AgentRuntime({
			model: new MultiStepModel([
				[
					{
						type: "tool-call-delta",
						toolCallId: "c1",
						toolName: "counter",
						inputText: JSON.stringify({ x: 1 }),
					},
					{ type: "finish", reason: "tool-calls" },
				],
				finishStep(),
			]),
			tools: [tool],
		});
		await runtime.run("RSM14");
		(
			runtime as unknown as { config: { model: AgentModel } }
		).config.model = new MultiStepModel([
			[
				{
					type: "tool-call-delta",
					toolCallId: "c2",
					toolName: "counter",
					inputText: JSON.stringify({ x: 2 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			finishStep(),
		]);
		// Wipe any stale authorities from run #1.
		runtime.restore([]);
		const result2 = await runtime.run("RSM14");
		expect(result2.status).toBe("completed");
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

describe("RSMT01 / RSM14b next-run freshness without restore", () => {
	it("run #1 → run #2 on same AgentRuntime without restore: no stale flags", async () => {
		// CORRECTION01 / M5 killer: prove the run-start
		// execution flag reset is load-bearing. The
		// RSM14 test calls `restore()` between runs,
		// which independently resets the flags and
		// masks the run-start reset. This variant
		// omits `restore()` to exercise the run-start
		// reset alone — the same lifecycle invariant
		// that drove the C1.4 run-start reset design.
		const tool = passingTool("counter");
		const runtime = new AgentRuntime({
			model: new MultiStepModel([
				[
					{
						type: "tool-call-delta",
						toolCallId: "c1",
						toolName: "counter",
						inputText: JSON.stringify({ x: 1 }),
					},
					{ type: "finish", reason: "tool-calls" },
				],
				finishStep(),
			]),
			tools: [tool],
		});
		await runtime.run("RSM14b");
		(
			runtime as unknown as { config: { model: AgentModel } }
		).config.model = new MultiStepModel([
			[
				{
					type: "tool-call-delta",
					toolCallId: "c2",
					toolName: "counter",
					inputText: JSON.stringify({ x: 2 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			finishStep(),
		]);
		// Note: NO restore() between runs.
		const result2 = await runtime.run("RSM14b");
		expect(result2.status).toBe("completed");
		// After run #2, all execution flags must be
		// cleared. With M5 the run-start reset is
		// removed, so the run would inherit the
		// prior run's state — failing this assertion.
		expect(runtime.snapshot().execution).toEqual(ZERO_EXECUTION);
	});
});

// ---------------------------------------------------------------------------
// RSM15 — event snapshot equals runtime snapshot at the moment of emission
// ---------------------------------------------------------------------------

describe("RSMT01 / RSM15 event/snapshot equality", () => {
	it("every event's snapshot.execution is defined and the final event matches the post-run snapshot", async () => {
		const runtime = new AgentRuntime({
			model: new MultiStepModel([
				[
					{
						type: "tool-call-delta",
						toolCallId: "c1",
						toolName: "counter",
						inputText: JSON.stringify({ x: 1 }),
					},
					{ type: "finish", reason: "tool-calls" },
				],
				finishStep(),
			]),
			tools: [passingTool("counter")],
		});
		const events: AgentRuntimeExecutionState[] = [];
		runtime.subscribe((event) => {
			events.push(event.snapshot.execution);
		});
		await runtime.run("RSM15");
		for (const e of events) {
			expect(e).toBeDefined();
		}
		expect(events[events.length - 1]).toEqual(
			runtime.snapshot().execution,
		);
	});
});
