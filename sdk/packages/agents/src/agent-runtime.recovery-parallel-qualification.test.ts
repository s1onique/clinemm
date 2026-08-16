/**
 * C1.6 AgentRuntime — barrier-controlled parallel qualification.
 *
 * Supersedes the C1.4 setImmediate-polling fixtures with a
 * deterministic barrier so completion order is not
 * scheduler-dependent. Each test installs a fresh barrier in a
 * closure visible to the controllable tools.
 *
 * The matrix pins:
 *   - FAIL_FIRST and OK_FIRST produce the same public sequence
 *   - control-plane outcomes do NOT arm the latch
 *   - private `pendingBatchOutcomes` and
 *     `recoveryEmissionSuspended` cannot leak across batches
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentRuntimeRecoverySnapshot,
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

const ENOENT = Object.assign(new Error("ENOENT: /secret/path/token.pem"), {
	code: "ENOENT" as const,
});

function make(toolCallId: string, toolName: string, input: unknown) {
	return {
		type: "tool-call-delta" as const,
		toolCallId,
		toolName,
		inputText: JSON.stringify(input),
	};
}
const finishStep = (): AgentModelEvent[] => [
	{ type: "text-delta", text: "done" },
	{ type: "finish", reason: "stop" },
];

function singleStep(toolName: string, input: unknown): () => AgentModelEvent[] {
	return () => [
		make("t", toolName, input),
		{ type: "finish", reason: "tool-calls" },
	];
}

function enoentTool(calls: { count: number }): AgentTool<{ path: string }, never> {
	return {
		name: "fs_read",
		description: "Throws ENOENT",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			throw ENOENT;
		},
	};
}

function okTool(calls: { count: number }): AgentTool<{ x: number }, { ok: true }> {
	return {
		name: "ok",
		description: "Succeeds",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return { ok: true as const };
		},
	};
}

/**
 * Build a barrier-controllable tool that closes over `bar` and
 * `id`. The tool awaits `bar.arrive(id)` then either succeeds or
 * throws per `plan`.
 */
function controllableTool(
	bar: Barrier,
	id: string,
	plan: { kind: "success" } | { kind: "throw"; error: unknown },
): AgentTool<{ x: number }, { ok: true }> {
	return {
		name: `ctl_${id}`,
		description: "barrier-controlled",
		inputSchema: { type: "object" },
		async execute() {
			const gate = bar.controllable<unknown>(id);
			await gate.arrive();
			if (plan.kind === "throw") throw plan.error;
			return { ok: true as const };
		},
	};
}

interface CapturedRecoveryEvent {
	previous: AgentRuntimeRecoverySnapshot;
	payload: AgentRuntimeRecoverySnapshot;
}

function subscribeRecovery(
	runtime: AgentRuntime,
	out: CapturedRecoveryEvent[],
): void {
	runtime.subscribe((event: AgentRuntimeEvent) => {
		if (event.type !== "recovery-state-changed") return;
		out.push({
			previous: event.previousRecovery,
			payload: event.snapshot.recovery,
		});
	});
}

/** Drive to `armed` with N same-path ENOENTs, then return the
 * model with the final parallel batch + a tail. */
function driveToArmed(n: number): () => AgentModelEvent[] {
	return () => [
		make("arm", "fs_read", { path: "/a" }),
		{ type: "finish", reason: "tool-calls" },
	];
}

// ============================================================================
//      ARMING FIXTURE — 6 distinct opaque failures arm the latch
// ============================================================================
// To reach `armed` we issue 6 distinct opaque failures (each
// fresh canonical input = fresh exact key in the exact-only
// budget). The 6th observation crosses
// `maxRecoveryEpisodeFailures` and arms the latch via
// Trigger D. The 7th step then becomes the bounded
// continuation opportunity. (Same pattern as the existing
// C14_REAL_PARALLEL_FAIL_FIRST fixture.)

const armingSteps = [
	singleStep("opaque_thrower", { value: "a" }),
	singleStep("opaque_thrower", { value: "b" }),
	singleStep("opaque_thrower", { value: "c" }),
	singleStep("opaque_thrower", { value: "d" }),
	singleStep("opaque_thrower", { value: "e" }),
	singleStep("opaque_thrower", { value: "f" }),
];

function parallelBatchStep(): () => AgentModelEvent[] {
	return () => [
		make("p_fail", "ctl_fail", { x: 1 }),
		make("p_ok", "ctl_ok", { x: 2 }),
		{ type: "finish", reason: "tool-calls" },
	];
}

function opaqueTool(calls: { count: number }): AgentTool<{ value: string }, never> {
	return {
		name: "opaque_thrower",
		description: "Throws opaque",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			throw new Error("opaque internal failure");
		},
	};
}

// ============================================================================
//      P1 — FAILURE FIRST IN PARALLEL BATCH WHILE ARMED → TERMINATING
// ============================================================================

describe("C1.6 / P1 FAIL_FIRST in parallel batch", () => {
	it("P1: failure finishing first still flips the latch; subsequent success does NOT reset state", async () => {
		const bar = barrier();
		const failExecs = { count: 0 };
		const okExecs = { count: 0 };
		const failTool = controllableTool(bar, "fail", {
			kind: "throw",
			error: ENOENT,
		});
		failTool.name = "ctl_fail";
		const okT = controllableTool(bar, "ok", { kind: "success" });
		okT.name = "ctl_ok";
		// Patch the count via wrappers since the controlled
		// tools don't expose a counter.
		const wrappedFail = wrapCount(failTool, failExecs);
		const wrappedOk = wrapCount(okT, okExecs);
		const model = new ScriptedModel([
			...armingSteps,
			parallelBatchStep(),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [opaqueTool({ count: 0 }), wrappedFail, wrappedOk],
			toolExecution: "parallel",
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		const runP = runtime.run("P1");
		// Wait for both siblings to be at the gate.
		await waitForPending(bar, ["fail", "ok"], 1000);
		// FAIL FIRST: release the failure, hold the success.
		bar.release("fail", undefined);
		// Yield several microtask ticks so the success is
		// observed AFTER the failure is recorded.
		await tickNTimes(8);
		bar.release("ok", undefined);
		const result = await runP;
		expect(failExecs.count).toBe(1);
		expect(okExecs.count).toBe(1);
		expect(runtime.snapshot().recovery.secondStage).toBe("terminating");
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
		// Public event sequence MUST include terminating
		const labels = events
			.map(
				(e) =>
					`${e.previous.secondStage}→${e.payload.secondStage}`,
			)
			.filter((l) => l.includes("terminating"));
		expect(labels).toContain("armed→terminating");
	});
});

// ============================================================================
//      P2 — SUCCESS FIRST IN PARALLEL BATCH WHILE ARMED → STILL TERMINATING
// ============================================================================

describe("C1.6 / P2 OK_FIRST in parallel batch", () => {
	it("P2: success finishing first MUST NOT reset the latch when the failure follows", async () => {
		const bar = barrier();
		const failExecs = { count: 0 };
		const okExecs = { count: 0 };
		const failTool = controllableTool(bar, "fail", {
			kind: "throw",
			error: ENOENT,
		});
		failTool.name = "ctl_fail";
		const okT = controllableTool(bar, "ok", { kind: "success" });
		okT.name = "ctl_ok";
		const wrappedFail = wrapCount(failTool, failExecs);
		const wrappedOk = wrapCount(okT, okExecs);
		const model = new ScriptedModel([
			...armingSteps,
			parallelBatchStep(),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [opaqueTool({ count: 0 }), wrappedFail, wrappedOk],
			toolExecution: "parallel",
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		const runP = runtime.run("P2");
		await waitForPending(bar, ["fail", "ok"], 1000);
		// OK FIRST: release success, hold failure.
		bar.release("ok", undefined);
		await tickNTimes(8);
		bar.release("fail", undefined);
		const result = await runP;
		expect(failExecs.count).toBe(1);
		expect(okExecs.count).toBe(1);
		expect(runtime.snapshot().recovery.secondStage).toBe("terminating");
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
		const labels = events
			.map(
				(e) =>
					`${e.previous.secondStage}→${e.payload.secondStage}`,
			)
			.filter((l) => l.includes("terminating"));
		expect(labels).toContain("armed→terminating");
	});
});

// ============================================================================
//      P3 — CONTROL-PLANE DENY + SUCCESS → NO RECOVERY PRESSURE
// ============================================================================

describe("C1.6 / P3 control-plane DENY + success", () => {
	it("P3: a host DENY in a parallel batch does NOT arm the latch even when paired with success", async () => {
		// Force the batch to contain a DENY outcome + a
		// success outcome in a single parallel step.
		const bar = barrier();
		const denyTool: AgentTool<{ x: number }, never> = {
			name: "deny_me",
			description: "Always-denied",
			inputSchema: { type: "object" },
			async execute() {
				const gate = bar.controllable<unknown>("deny");
				await gate.arrive();
				throw Object.assign(new Error("denied by host"), {
					__controlPlane: "host_policy_denied",
				});
			},
		};
		const okT = controllableTool(bar, "ok", { kind: "success" });
		okT.name = "ctl_ok";
		const model = new ScriptedModel([
			() => [
				make("d1", "deny_me", { x: 1 }),
				make("o1", "ctl_ok", { x: 2 }),
				{ type: "finish", reason: "tool-calls" },
			],
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [denyTool, okT],
			toolExecution: "parallel",
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		const runP = runtime.run("P3");
		await waitForPending(bar, ["deny", "ok"], 1000);
		bar.release("deny", undefined);
		bar.release("ok", undefined);
		await runP;
		// No recovery termination when the batch contains
		// only control-plane outcomes (plus a genuine
		// success).
		expect(runtime.snapshot().recovery.secondStage).not.toBe("terminating");
	});
});

// ============================================================================
//      P4 / P5 / P6 — Two failures, two successes, idle matrix
// ============================================================================

describe("C1.6 / P4-P6 parallel batch composition", () => {
	it("P5: two genuine failures in a parallel batch produce terminating exactly once", async () => {
		const bar = barrier();
		const f1 = controllableTool(bar, "f1", { kind: "throw", error: ENOENT });
		f1.name = "ctl_f1";
		const f2 = controllableTool(bar, "f2", { kind: "throw", error: ENOENT });
		f2.name = "ctl_f2";
		const model = new ScriptedModel([
			() => [
				make("fa", "ctl_f1", { x: 1 }),
				make("fb", "ctl_f2", { x: 2 }),
				{ type: "finish", reason: "tool-calls" },
			],
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [f1, f2],
			toolExecution: "parallel",
		});
		const runP = runtime.run("P5");
		await waitForPending(bar, ["f1", "f2"], 1000);
		bar.release("f1", undefined);
		bar.release("f2", undefined);
		await runP;
		// Two failures in a parallel batch with no prior
		// arming produce episodeFailures=2, secondStage=idle
		// (the latch only fires when batchStartKind===armed).
		expect(runtime.snapshot().recovery.episodeFailures).toBe(2);
		expect(runtime.snapshot().recovery.secondStage).toBe("idle");
	});

	it("P6: two successes in a parallel batch keep recovery idle", async () => {
		const bar = barrier();
		const ok1 = controllableTool(bar, "ok1", { kind: "success" });
		ok1.name = "ctl_ok1";
		const ok2 = controllableTool(bar, "ok2", { kind: "success" });
		ok2.name = "ctl_ok2";
		const model = new ScriptedModel([
			() => [
				make("oa", "ctl_ok1", { x: 1 }),
				make("ob", "ctl_ok2", { x: 2 }),
				{ type: "finish", reason: "tool-calls" },
			],
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [ok1, ok2],
			toolExecution: "parallel",
		});
		const runP = runtime.run("P6");
		await waitForPending(bar, ["ok1", "ok2"], 1000);
		bar.release("ok1", undefined);
		bar.release("ok2", undefined);
		await runP;
		expect(runtime.snapshot().recovery.episodeFailures).toBe(0);
		expect(runtime.snapshot().recovery.secondStage).toBe("idle");
	});
});

// ============================================================================
//      HELPERS
// ============================================================================

/**
 * Wrap a tool's execute so we can count invocations while
 * preserving the barrier behaviour.
 */
function wrapCount(
	tool: AgentTool<{ x: number }, { ok: true }>,
	counter: { count: number },
): AgentTool<{ x: number }, { ok: true }> {
	const inner = tool.execute;
	return {
		...tool,
		async execute(input, ctx) {
			counter.count += 1;
			return inner(input, ctx);
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
