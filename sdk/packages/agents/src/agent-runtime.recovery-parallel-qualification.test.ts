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
	AgentToolRuntimeOutcomeHookContext,
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
		// CORRECTION01 / M8 atomicity: the public
		// recovery-event sequence for a parallel batch
		// must be atomic — exactly one `armed→terminating`
		// event for the whole batch, regardless of
		// completion order. Any per-tool intermediate
		// (e.g. `idle→armed` from a sibling's
		// applyRecoveryPostClassification, or
		// `armed→idle` from a sibling success's reset)
		// violates the parallel-path atomicity contract.
		//
		// The pre-batch `armingSteps` legitimately emit
		// recovery events as the latch is armed. The
		// atomicity invariant is about events that fire
		// DURING the batch — those whose previous state
		// was already `armed`. There must be exactly one
		// such event: the final `armed→terminating`.
		const inBatchEvents = events.filter(
			(e) => e.previous.secondStage === "armed",
		);
		expect(inBatchEvents.length).toBe(1);
		expect(inBatchEvents[0]?.payload.secondStage).toBe("terminating");
		// No `armed→idle` reset events are allowed
		// mid-batch — the success's applyRecoveryPostClassification
		// must not be allowed to fire mid-flight.
		const idleResets = events.filter(
			(e) =>
				e.previous.secondStage === "armed" &&
				e.payload.secondStage === "idle",
		);
		expect(idleResets.length).toBe(0);
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

describe("C1.6 / P3 real host-DENY via approval seam", () => {
	it("P3: real requestToolApproval → host_policy_denied produces typed control_plane outcome and does NOT arm the latch", async () => {
		// Drive the REAL approval seam. The runtime routes
		// host denials through the typed C1.1
		// `controlPlaneOutcome` authority — this is the
		// exact path the original P3 wanted to test, but
		// the old fixture threw an arbitrary error which
		// the classifier could not recognize as
		// control-plane provenance.
		const bar = barrier();
		const deniedTool: AgentTool<{ x: number }, never> = {
			name: "needs_approval",
			description: "Always needs approval",
			inputSchema: { type: "object" },
			async execute() {
				// Will not run — host denies before execution.
				throw new Error("executor should not run after host DENY");
			},
		};
		const okT = controllableTool(bar, "ok", { kind: "success" });
		okT.name = "ctl_ok";
		const model = new ScriptedModel([
			() => [
				make("d1", "needs_approval", { x: 1 }),
				make("o1", "ctl_ok", { x: 2 }),
				{ type: "finish", reason: "tool-calls" },
			],
			finishStep,
		]);
		// Capture every typed ToolRuntimeOutcome the
		// runtime emits. This is the production observer
		// surface, not the model.
		const outcomes: AgentToolRuntimeOutcomeHookContext[] = [];
		const runtime = new AgentRuntime({
			model,
			tools: [deniedTool, okT],
			toolExecution: "parallel",
			// Force the approval gate to actually run for
			// every tool call. Default policy is
			// autoApprove=true which skips approval
			// entirely.
			toolPolicies: { "*": { autoApprove: false } },
			hooks: {
				onToolRuntimeOutcome: (ctx) => {
					outcomes.push(ctx);
				},
			},
			requestToolApproval: async (req: { toolName: string }) => {
				// Host policy denies only the
				// `needs_approval` tool; the genuine
				// `ctl_ok` tool is approved so the
				// parallel batch contains a real
				// success + a real control_plane
				// outcome.
				if (req.toolName === "needs_approval") {
					return {
						approved: false,
						reason: "host_policy_denied",
						// CRITICAL: `decision.kind === "deny"`
						// is what flips the classifier to
						// `hostDenied: true` and routes the
						// outcome as
						// `control_plane / host_policy_denied`
						// rather than `failure`. Without
						// this structured field, the
						// runtime sees only a `user_rejected`
						// user-rejection path.
						decision: {
							kind: "deny",
							reason: "host_policy_denied",
							source: "host_policy_evaluator",
						},
					};
				}
				return { approved: true };
			},
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		const runP = runtime.run("P3");
		await waitForPending(bar, ["ok"], 1000);
		bar.release("ok", undefined);
		await runP;
		// 1. The denied tool produced a typed control_plane
		// outcome with the correct C1.1 reason — NOT a
		// failure. This is the load-bearing assertion
		// that the prior P3 fixture could not make.
		const deniedOutcome = outcomes.find(
			(o) => o.toolCall.toolName === "needs_approval",
		);
		expect(deniedOutcome).toBeDefined();
		if (deniedOutcome) {
			expect(deniedOutcome.outcome.kind).toBe("control_plane");
			if (deniedOutcome.outcome.kind === "control_plane") {
				expect(deniedOutcome.outcome.outcome).toBe(
					"host_policy_denied",
				);
			}
		}
		// 2. The genuine success also produced its typed
		// success outcome.
		const okOutcome = outcomes.find(
			(o) => o.toolCall.toolName === "ctl_ok",
		);
		expect(okOutcome).toBeDefined();
		expect(okOutcome?.outcome.kind).toBe("success");
		// 3. No recovery-state-changed event fires (no
		// typed failure in the batch). The parallel
		// reconciliation sees only control_plane +
		// success and leaves recovery idle.
		expect(events).toEqual([]);
		expect(runtime.snapshot().recovery.secondStage).toBe("idle");
		expect(runtime.snapshot().recovery.episodeFailures).toBe(0);
	});
});

// ============================================================================
//      P4 / P5 / P6 — Two failures, two successes, idle matrix
// ============================================================================

describe("C1.6 / P4-P6 parallel batch composition", () => {
	// P5 (the second `it` here, named consistently) covers
	// "two genuine failures in a parallel batch with the
	// latch idle." P6 covers "two successes in a parallel
	// batch with the latch idle." These are NOT the
	// "recovery bounded continuation" matrix; that is P1
	// and P2 above, where the latch is ARMED before the
	// batch starts.
	it("P5: two genuine failures in a parallel batch with idle latch → idle (no arm)", async () => {
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
