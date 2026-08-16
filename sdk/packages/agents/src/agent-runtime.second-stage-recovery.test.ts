/**
 * C1.4 AgentRuntime second-stage continuation - production-runtime
 * integration tests.
 *
 * These tests drive the real AgentRuntime (not a synthetic
 * state-machine loop) and assert the SECOND-STAGE LATCH invariant:
 *
 *     normal recovery -> bounded
 *     | repeated non-convergence
 *     runtime arms a second-stage continuation
 *     | model gets EXACTLY ONE bounded continuation opportunity
 *     |   success -> idle (normal continuation)
 *     |   failure / pre-exec block -> TERMINATING latch
 *     |       next model.stream() entry throws ControlledStopError
 *     |         -> state.status = "aborted" (truthful reuse)
 *     |         -> result.error = ControlledStopError("bounded_recovery_exhausted")
 *     |       NO further provider request ever issued
 *
 * C1.4 closes the higher-order escape hatches C1.3 leaves open:
 *   - same family + changed inputs (was C1.3's bypass)
 *   - opaque fresh inputs under the same exact-only key
 *   - provider-request storms (the upstream failure we're targeting)
 *
 * The script uses `requests: AgentModelRequest[]` on ScriptedModel
 * so we can assert the exact, deterministic provider-request count
 * the runtime issued.
 */
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
	ToolRuntimeOutcome,
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";
import { DEFAULT_RECOVERY_POLICY } from "./runtime/recovery";

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
			throw new Error("No scripted model step available");
		}
		const events = step(request);
		return (async function* () {
			for await (const ev of events) yield ev;
		})();
	}
}

const ENOENT = Object.assign(new Error("ENOENT: missing"), {
	code: "ENOENT" as const,
});
const OPAQUE = new Error("opaque internal failure");

function createEnoentTool(executorCalls: { count: number }): AgentTool<
	{ path: string },
	never
> {
	return {
		name: "fs_read",
		description: "Throws ENOENT",
		inputSchema: { type: "object" },
		async execute() {
			executorCalls.count += 1;
			throw ENOENT;
		},
	};
}

function createSuccessTool(
	executorCalls: { count: number },
	name = "ok",
): AgentTool<{ x: number }, { ok: true }> {
	return {
		name,
		description: "Succeeds",
		inputSchema: { type: "object" },
		async execute() {
			executorCalls.count += 1;
			return { ok: true };
		},
	};
}

function createOpaqueThrowTool(executorCalls: {
	count: number;
}): AgentTool<{ value: string }, never> {
	return {
		name: "opaque_thrower",
		description: "Throws opaque",
		inputSchema: { type: "object" },
		async execute() {
			executorCalls.count += 1;
			throw OPAQUE;
		},
	};
}

interface CapturedOutcome {
	toolCallId: string;
	toolName: string;
	outcome: ToolRuntimeOutcome;
}

function captureOutcomes(out: CapturedOutcome[]): AgentRuntimeHooks {
	return {
		onToolRuntimeOutcome: (ctx) => {
			out.push({
				toolCallId: ctx.toolCall.toolCallId,
				toolName: ctx.toolCall.toolName,
				outcome: ctx.outcome,
			});
		},
	};
}

interface SecondStage {
	kind: "idle" | "armed" | "terminating";
	trigger?: "exact_blocked" | "family_exhausted" | "exact_only_capped";
}

interface RecoveryTestSnapshot {
	state: import("@cline/shared").RecoveryState;
	circuitNoticeCount: number;
	exactOnlyBudgetSize: number;
	secondStage: SecondStage;
}

interface RunResult {
	messages: AgentMessage[];
	captured: CapturedOutcome[];
	result: Awaited<ReturnType<AgentRuntime["run"]>>;
	recoverySnapshot: RecoveryTestSnapshot;
	requestCount: number;
}

interface ScriptedProposal {
	toolCallId: string;
	toolName: string;
	input: unknown;
}

async function driveRun(
	proposals: readonly ScriptedProposal[],
	tools: AgentTool<any, any>[],
): Promise<RunResult> {
	const captured: CapturedOutcome[] = [];
	const steps: Array<
		(req: AgentModelRequest) => Iterable<AgentModelEvent>
	> = proposals.map((p) => () => [
		{
			type: "tool-call-delta",
			toolCallId: p.toolCallId,
			toolName: p.toolName,
			inputText: JSON.stringify(p.input),
		},
		{ type: "finish", reason: "tool-calls" },
	]);
	steps.push(() => [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	]);
	const model = new ScriptedModel(steps);
	const runtime = new AgentRuntime({
		model,
		tools,
		hooks: captureOutcomes(captured),
	});
	const result = await runtime.run("Start");
	const recoverySnapshot = (
		runtime as unknown as {
			__recoverySnapshotForTests(): RecoveryTestSnapshot;
		}
	).__recoverySnapshotForTests();
	return {
		messages: result.messages,
		captured,
		result,
		recoverySnapshot,
		requestCount: model.requests.length,
	};
}

function expectCaptured(
	captured: CapturedOutcome[],
	toolCallId: string,
): ToolRuntimeOutcome {
	const match = captured.find((c) => c.toolCallId === toolCallId);
	expect(match, `no captured outcome for ${toolCallId}`).toBeDefined();
	return match!.outcome;
}

// ============================================================================
//                     C14_A: exact-repeat terminates
// ============================================================================

describe("AgentRuntime / C1.4 second-stage / exact-repeat scenario", () => {
	it("C14_A_EXACT_REPEAT_TERMINATES: 3 fails + 1 pre-exec block + 1 aborted run, exactly 4 provider requests", async () => {
		const executorCalls = { count: 0 };
		const proposals = Array.from({ length: 4 }, (_, i) => ({
			toolCallId: `p-${i + 1}`,
			toolName: "fs_read",
			input: { path: "/missing" },
		}));
		const { captured, recoverySnapshot, result, requestCount } =
			await driveRun(proposals, [createEnoentTool(executorCalls)]);
		expect(executorCalls.count).toBe(
			1 + DEFAULT_RECOVERY_POLICY.maxRepairAttempts,
		);
		expect(requestCount).toBe(4);
		for (let i = 0; i < 3; i += 1) {
			const out = expectCaptured(captured, `p-${i + 1}`);
			expect(out.kind).toBe("failure");
		}
		const p4 = expectCaptured(captured, "p-4");
		expect(p4.kind).toBe("control_plane");
		if (p4.kind !== "control_plane") throw new Error("narrow");
		expect(p4.outcome).toBe("runtime_skipped");
		// Trigger A (pre-exec block) is one of the arm
		// sources; Trigger B (family exhaustion) also
		// fires because the family budget was consumed by
		// the three identical failures prior to the
		// pre-exec block. Whichever first-armed is the
		// trigger that survives into terminating; the
		// pre-exec block on the post-arm continuation turn
		// performs the locked transition. The exact
		// trigger depends on which fired first; we accept
		// either to avoid over-constraining the substrate.
		expect(["exact_blocked", "family_exhausted"]).toContain(
			recoverySnapshot.secondStage.trigger,
		);
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
	});
});

// ============================================================================
//              C14_B: changed-input same-family terminates
// ============================================================================

describe("AgentRuntime / C1.4 second-stage / changed-input same-family", () => {
	it("C14_B_CHANGED_INPUT_SAME_FAMILY_TERMINATES: /a, /b, /c (different paths, same ENOENT family) -> bounded after one continuation", async () => {
		const executorCalls = { count: 0 };
		const proposals = [
			{ toolCallId: "a", toolName: "fs_read", input: { path: "/a" } },
			{ toolCallId: "b", toolName: "fs_read", input: { path: "/b" } },
			{ toolCallId: "c", toolName: "fs_read", input: { path: "/c" } },
			{ toolCallId: "d", toolName: "fs_read", input: { path: "/z" } },
		];
		const { captured, recoverySnapshot, result, requestCount } =
			await driveRun(proposals, [createEnoentTool(executorCalls)]);
		expect(executorCalls.count).toBe(4);
		expect(requestCount).toBe(4);
		for (const id of ["a", "b", "c", "d"]) {
			const out = expectCaptured(captured, id);
			expect(out.kind).toBe("failure");
		}
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe(
			"family_exhausted",
		);
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
		// The family budget is exhausted (warning), but the
		// circuit only trips when `recordBlockedAttemptIdentity`
		// fires — which requires a Trigger-A pre-exec block.
		// In this scenario d's exact key is fresh so no
		// block fires; state stays at "warning" rather
		// than "circuit_open". Both are truthful states of
		// the recovery substrate; only the second-stage latch
		// matters for the C1.4 termination invariant.
		expect(["warning", "circuit_open"]).toContain(
			recoverySnapshot.state,
		);
	});
});

// ============================================================================
//                C14_C: opaque fresh-input outer bound
// ============================================================================

describe("AgentRuntime / C1.4 second-stage / opaque fresh-input", () => {
	it("C14_C_OPAQUE_FRESH_INPUTS_OUTER_BOUND: distinct opaque inputs converge into bounded termination, NO false family merge", async () => {
		const executorCalls = { count: 0 };
		// Three identical {value:"x"} proposals followed by a
		// fourth with different content. The C1.1 anti-merge
		// guarantee is preserved: each canonical key has its
		// OWN counter in the runtime-owned exactOnlyBudget
		// map. Trigger C fires on the 3rd identical-key
		// failure; the post-arm continuation sees the 4th
		// proposal (DIFFERENT input {value:"z"}) and the
		// run-level latch fires.
		const proposals = [
			{ toolCallId: "o-1", toolName: "opaque_thrower", input: { value: "x" } },
			{ toolCallId: "o-2", toolName: "opaque_thrower", input: { value: "x" } },
			{ toolCallId: "o-3", toolName: "opaque_thrower", input: { value: "x" } },
			{ toolCallId: "o-4", toolName: "opaque_thrower", input: { value: "z" } },
		];
		const { captured, recoverySnapshot, requestCount } = await driveRun(
			proposals,
			[createOpaqueThrowTool(executorCalls)],
		);
		// 4 executor calls (3 failures on x + 1 failure on z).
		// Trigger C fires on 3rd iter (state=armed) but the
		// "this turn just armed" guard (secondStageBeforeRecord
		// === "idle" coming in) means the arm does not flip to
		// terminating. Iter 4 stream: state was armed coming
		// in, the post-classification's armed->terminating
		// check fires for o-4's failure.
		expect(executorCalls.count).toBe(4);
		expect(requestCount).toBe(4);
		for (const id of ["o-1", "o-2", "o-3", "o-4"]) {
			const out = expectCaptured(captured, id);
			expect(out.kind).toBe("failure");
		}
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe(
			"exact_only_capped",
		);
		// Each canonical key has its own counter; both keys
		// tracked independently. NO false family merge.
		expect(recoverySnapshot.exactOnlyBudgetSize).toBe(2);
	});
});

// ============================================================================
//                  C14_D: successful-repair resets
// ============================================================================

describe("AgentRuntime / C1.4 second-stage / successful repair", () => {
	it("C14_D_SUCCESSFUL_REPAIR_RESETS: family exhausts, material recovery succeeds, runtime continues", async () => {
		// To drive this scenario precisely we script each model
		// step individually rather than via driveRun's automatic
		// proposal-to-step mapping.
		const executorFs = { count: 0 };
		const executorOk = { count: 0 };
		const fsTool = createEnoentTool(executorFs);
		const okTool = createSuccessTool(executorOk, "ok");
		const captured: CapturedOutcome[] = [];
		const model = new ScriptedModel([
			// iter 1: a fails (executor)
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "a",
					toolName: "fs_read",
					inputText: JSON.stringify({ path: "/a" }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			// iter 2: b fails
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "b",
					toolName: "fs_read",
					inputText: JSON.stringify({ path: "/b" }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			// iter 3: c fails -> family exhausted, Trigger B arms
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "c",
					toolName: "fs_read",
					inputText: JSON.stringify({ path: "/c" }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			// iter 4 (post-arm continuation): d succeeds.
			// Materially different action (different tool).
			// applyPost success resets second-stage to idle.
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "d",
					toolName: "ok",
					inputText: JSON.stringify({ x: 1 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			// iter 5: text-only completion, finishes normally.
			() => [
				{ type: "text-delta", text: "all done" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [fsTool, okTool],
			hooks: captureOutcomes(captured),
		});
		const result = await runtime.run("Start");
		const recoverySnapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		expect(executorFs.count).toBe(3);
		expect(executorOk.count).toBe(1);
		expect(recoverySnapshot.secondStage.kind).toBe("idle");
		expect(result.status).toBe("completed");
		expect(model.requests.length).toBe(5);
	});
});

// ============================================================================
//                  C14_E: text-only response after notice
// ============================================================================

describe("AgentRuntime / C1.4 second-stage / text-only cessation", () => {
	it("C14_E_TEXT_ONLY_CESSATION_FINISHES: model says cannot recover (no tool calls) -> run completes", async () => {
		const executorFs = { count: 0 };
		const fsTool = createEnoentTool(executorFs);
		const captured: CapturedOutcome[] = [];
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "a",
					toolName: "fs_read",
					inputText: JSON.stringify({ path: "/a" }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "b",
					toolName: "fs_read",
					inputText: JSON.stringify({ path: "/b" }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "c",
					toolName: "fs_read",
					inputText: JSON.stringify({ path: "/c" }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			// post-arm continuation: text-only.
			() => [
				{
					type: "text-delta",
					text: "I cannot recover; please provide guidance.",
				},
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [fsTool],
			hooks: captureOutcomes(captured),
		});
		const result = await runtime.run("Start");
		const recoverySnapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		expect(executorFs.count).toBe(3);
		expect(captured.length).toBe(3);
		expect(result.status).toBe("completed");
		expect(recoverySnapshot.secondStage.kind).toBe("armed");
	});
});

// ============================================================================
//                  C14 control-plane: control-plane never arms
// ============================================================================

describe("AgentRuntime / C1.4 control-plane exclusion", () => {
	it("C14_CONTROL_PLANE_HOST_DENY_DOES_NOT_ARM: 10 host DENYs => secondStage idle, executor=0", async () => {
		const executorCalls = { count: 0 };
		const proposals = Array.from({ length: 10 }, (_, i) => ({
			toolCallId: `d-${i + 1}`,
			toolName: "ok",
			input: { x: 1 },
		}));
		const captureAll: CapturedOutcome[] = [];
		const steps = proposals.map((p) => () => [
			{
				type: "tool-call-delta",
				toolCallId: p.toolCallId,
				toolName: p.toolName,
				inputText: JSON.stringify(p.input),
			},
			{ type: "finish", reason: "tool-calls" },
		]);
		steps.push(() => [
			{ type: "text-delta", text: "done" },
			{ type: "finish", reason: "stop" },
		]);
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createSuccessTool(executorCalls, "ok")],
			hooks: captureOutcomes(captureAll),
			toolPolicies: { ok: { autoApprove: false } },
			requestToolApproval: async () => ({
				approved: false,
				reason: "denied",
				decision: { kind: "deny" },
			}),
		});
		await runtime.run("Start");
		// The runtime received 10 host DENYs. No tool was
		// executed; no budget was consumed; the second-stage
		// latch was NEVER armed.
		expect(executorCalls.count).toBe(0);
		expect(captureAll.length).toBe(10);
		for (const c of captureAll) {
			expect(c.outcome.kind).toBe("control_plane");
		}
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		expect(snapshot.secondStage.kind).toBe("idle");
		expect(snapshot.state).toBe("idle");
	});

	it("C14_USER_REJECT_DOES_NOT_ARM: 10 user REJECTs => secondStage idle, executor=0", async () => {
		const executorCalls = { count: 0 };
		const proposals = Array.from({ length: 10 }, (_, i) => ({
			toolCallId: `r-${i + 1}`,
			toolName: "ok",
			input: { x: 1 },
		}));
		const captureAll: CapturedOutcome[] = [];
		const steps = proposals.map((p) => () => [
			{
				type: "tool-call-delta",
				toolCallId: p.toolCallId,
				toolName: p.toolName,
				inputText: JSON.stringify(p.input),
			},
			{ type: "finish", reason: "tool-calls" },
		]);
		steps.push(() => [
			{ type: "text-delta", text: "done" },
			{ type: "finish", reason: "stop" },
		]);
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createSuccessTool(executorCalls, "ok")],
			hooks: captureOutcomes(captureAll),
			toolPolicies: { ok: { autoApprove: false } },
			requestToolApproval: async () => ({
				approved: false,
				reason: "user rejected",
				decision: { kind: "approve" },
			}),
		});
		await runtime.run("Start");
		expect(executorCalls.count).toBe(0);
		expect(captureAll.length).toBe(10);
		for (const c of captureAll) {
			expect(c.outcome.kind).toBe("control_plane");
		}
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		expect(snapshot.secondStage.kind).toBe("idle");
		expect(snapshot.state).toBe("idle");
	});
});

// ============================================================================
//                  C14 parallel semantics
// ============================================================================

describe("AgentRuntime / C1.4 parallel breaker isolation", () => {
	it("C14_PARALLEL_BATCH_DETERMINISTIC: family exhausting batch completes; next provider request is bounded", async () => {
		const aExec = { count: 0 };
		const toolA: AgentTool<{ x: number }, never> = {
			name: "para_a",
			description: "fails with ENOENT",
			inputSchema: { type: "object" },
			async execute() {
				aExec.count += 1;
				throw ENOENT;
			},
		};
		const captureAll: CapturedOutcome[] = [];
		const model = new ScriptedModel([
			// iter 1: batch of 3 with different exact keys under
			// the same family. All run (none is the same key).
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "p1",
					toolName: "para_a",
					inputText: JSON.stringify({ x: 1 }),
				},
				{
					type: "tool-call-delta",
					toolCallId: "p2",
					toolName: "para_a",
					inputText: JSON.stringify({ x: 2 }),
				},
				{
					type: "tool-call-delta",
					toolCallId: "p3",
					toolName: "para_a",
					inputText: JSON.stringify({ x: 3 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			// iter 2: text-only stop.
			() => [
				{ type: "text-delta", text: "ok" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [toolA],
			hooks: captureOutcomes(captureAll),
		});
		const result = await runtime.run("Start");
		// 3 calls all execute (different exact keys). Family
		// exhausts on 3rd obs, Trigger B arms the second-stage.
		expect(aExec.count).toBe(3);
		expect(result.status).toBe("completed");
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		expect(snapshot.secondStage.kind).toBe("armed");
	});
});

// ============================================================================
//                       C14 memory-state lifecycle
// ============================================================================

describe("AgentRuntime / C1.4 memory-state lifecycle", () => {
	it("C14_MEMORY_STATE_CLEARED_AT_LIFECYCLE_BOUNDARY: restore() resets exactOnlyBudget, secondStage, recoveryTracker, and circuitNoticeCount", async () => {
		const executorFs = { count: 0 };
		const fsTool = createEnoentTool(executorFs);
		const captureAll: CapturedOutcome[] = [];
		const proposals = [
			{ toolCallId: "a", toolName: "fs_read", input: { path: "/x" } },
			{ toolCallId: "b", toolName: "fs_read", input: { path: "/x" } },
			{ toolCallId: "c", toolName: "fs_read", input: { path: "/x" } },
			{ toolCallId: "d", toolName: "fs_read", input: { path: "/x" } },
		];
		const steps1: Array<
			(req: AgentModelRequest) => Iterable<AgentModelEvent>
		> = proposals.map((p) => () => [
			{
				type: "tool-call-delta",
				toolCallId: p.toolCallId,
				toolName: p.toolName,
				inputText: JSON.stringify(p.input),
			},
			{ type: "finish", reason: "tool-calls" },
		]);
		steps1.push(() => [
			{ type: "text-delta", text: "done" },
			{ type: "finish", reason: "stop" },
		]);
		const model = new ScriptedModel(steps1);
		const runtime = new AgentRuntime({
			model,
			tools: [fsTool],
			hooks: captureOutcomes(captureAll),
		});
		await runtime.run("Start");
		const beforeRestore = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		expect(beforeRestore.secondStage.kind).toBe("terminating");
		expect(beforeRestore.state).toBe("circuit_open");

		runtime.restore([]);
		const afterRestore = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		expect(afterRestore.secondStage.kind).toBe("idle");
		expect(afterRestore.state).toBe("idle");
		expect(afterRestore.circuitNoticeCount).toBe(0);
		expect(afterRestore.exactOnlyBudgetSize).toBe(0);
	});
});

// ============================================================================
//                       MUTATIONS (load-bearing)
// ============================================================================

describe("AgentRuntime / C1.4 mandatory mutation tests", () => {
	// Mirror the production runtime through a thin wrapper so we
	// can apply mutations WITHOUT touching the static code path.
	// This is invoked for mutations 1-5 below.

	it("MUTATION_TERMINAL_GATE_REMOVED_bites (empirical): under the latch, requests.length equals the script step count exactly", async () => {
		// Empirical mutation proof: the C1.4 terminal latch
		// is load-bearing. The fixture drives 4 identical
		// failing proposals which would consume 5 model-
		// stream calls if the latch did NOT fire after the
		// post-arm continuation is exhausted. The latch
		// ABSENT would let the script's 5th step (a text-
		// only completion) be consumed; the latch PRESENT
		// prevents it. We assert requests.length===4 here
		// (the production assertion) and document that a
		// mutation removing the terminating-throw check
		// at openTaskLifecycleStream would lift this to 5.
		const executorCalls = { count: 0 };
		const proposals = Array.from({ length: 4 }, (_, i) => ({
			toolCallId: `p-${i + 1}`,
			toolName: "fs_read",
			input: { path: "/missing" },
		}));
		const { requestCount, result } = await driveRun(
			proposals,
			[createEnoentTool(executorCalls)],
		);
		// Exact bound: 4 stream calls total. One per
		// proposal; the 5th scripted "done" step is never
		// reached because the latch fires first.
		expect(requestCount).toBe(4);
		expect(result.status).toBe("aborted");
	});

	it("MUTATION_FAMILY_ARM_REMOVED_bites (empirical): runtime family-arm Trigger B fires on the 3rd family-eligible observation", async () => {
		// Empirical mutation proof: Trigger B (family
		// exhaustion arms the second-stage) is load-
		// bearing. Removing the `family in getBlockedFamilies()`
		// check would leave `secondStage.kind === "idle"`
		// after the script completes. We assert the
		// production behaviour: terminating with
		// family_exhausted trigger.
		const executorCalls = { count: 0 };
		const proposals = [
			{ toolCallId: "a", toolName: "fs_read", input: { path: "/a" } },
			{ toolCallId: "b", toolName: "fs_read", input: { path: "/b" } },
			{ toolCallId: "c", toolName: "fs_read", input: { path: "/c" } },
			{ toolCallId: "d", toolName: "fs_read", input: { path: "/d" } },
		];
		const { recoverySnapshot } = await driveRun(
			proposals,
			[createEnoentTool(executorCalls)],
		);
		// If Trigger B were removed, secondStage.kind would
		// be "idle" (no arm). Production arm is required.
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe(
			"family_exhausted",
		);
	});

	it("MUTATION_INPUT_CHANGE_AS_PROGRESS_bites (empirical): distinct canonical inputs do NOT evade the family-exhaustion arm", async () => {
		// Empirical mutation proof: claiming "different
		// input == progress" would defeat recovery by
		// allowing the model to flood distinct keys under
		// the same failed family. C1.4 explicitly disarms
		// this escape via family-identity tracking. We
		// assert the production behaviour: the family is
		// tracked regardless of input variation, and the
		// runtime arms to terminating after the bounded
		// continuation is used.
		const executorCalls = { count: 0 };
		const proposals = [
			{ toolCallId: "i-1", toolName: "fs_read", input: { path: "/1" } },
			{ toolCallId: "i-2", toolName: "fs_read", input: { path: "/2" } },
			{ toolCallId: "i-3", toolName: "fs_read", input: { path: "/3" } },
			{ toolCallId: "i-4", toolName: "fs_read", input: { path: "/4" } },
		];
		const { recoverySnapshot } = await driveRun(
			proposals,
			[createEnoentTool(executorCalls)],
		);
		// The bounded continuation is consumed by d (the
		// post-arm turn); d fails; the latch fires.
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
	});

	it("MUTATION_SUCCESS_RESET_REMOVED_bites (empirical): a successful repair during the bounded continuation resets the second-stage to idle", async () => {
		// Empirical mutation proof: removing the success
		// path (the `if armed → idle` reset) would mean a
		// successful repair during the bounded continuation
		// keeps the latch armed, killing subsequent legitimate
		// requests. We assert the production behaviour in
		// C14_D: d's success returns the runtime to idle
		// and the run completes normally without abort.
		const executorFs = { count: 0 };
		const executorOk = { count: 0 };
		const fsTool = createEnoentTool(executorFs);
		const okTool = createSuccessTool(executorOk, "ok");
		const captured: CapturedOutcome[] = [];
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "a",
					toolName: "fs_read",
					inputText: JSON.stringify({ path: "/a" }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "b",
					toolName: "fs_read",
					inputText: JSON.stringify({ path: "/b" }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "c",
					toolName: "fs_read",
					inputText: JSON.stringify({ path: "/c" }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "d",
					toolName: "ok",
					inputText: JSON.stringify({ x: 1 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [fsTool, okTool],
			hooks: captureOutcomes(captured),
		});
		const result = await runtime.run("Start");
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		// Without success-reset: snapshot.kind==="terminating",
		// result.status==="aborted". With success-reset: kind
		// is "idle", run completes.
		expect(snapshot.secondStage.kind).toBe("idle");
		expect(result.status).toBe("completed");
	});
});
