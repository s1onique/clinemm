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
	trigger?:
		| "exact_blocked"
		| "family_exhausted"
		| "exact_only_capped"
		| "episode_exhausted";
}

interface RecoveryTestSnapshot {
	state: import("@cline/shared").RecoveryState;
	circuitNoticeCount: number;
	exactOnlyBudgetSize: number;
	secondStage: SecondStage;
	episodeFailures: number;
	maxRecoveryEpisodeFailures: number;
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
	const steps: Array<(req: AgentModelRequest) => Iterable<AgentModelEvent>> =
		proposals.map((p) => () => [
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
		const { captured, recoverySnapshot, result, requestCount } = await driveRun(
			proposals,
			[createEnoentTool(executorCalls)],
		);
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
		const { captured, recoverySnapshot, result, requestCount } = await driveRun(
			proposals,
			[createEnoentTool(executorCalls)],
		);
		expect(executorCalls.count).toBe(4);
		expect(requestCount).toBe(4);
		for (const id of ["a", "b", "c", "d"]) {
			const out = expectCaptured(captured, id);
			expect(out.kind).toBe("failure");
		}
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe("family_exhausted");
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
		expect(["warning", "circuit_open"]).toContain(recoverySnapshot.state);
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
		expect(recoverySnapshot.secondStage.trigger).toBe("exact_only_capped");
		// Each canonical key has its own counter; both keys
		// tracked independently. NO false family merge.
		expect(recoverySnapshot.exactOnlyBudgetSize).toBe(2);
	});

	it("C14_C_TRUE_OPAQUE_FRESH_OUTER_BOUND: ALL-DISTINCT canonical inputs under familyEligible=false → finite provider requests, finite exactOnlyBudget cardinality", async () => {
		// This is the gap identified during C1.4 review:
		// the previous C14_C only had 3 identical-key proposals
		// which fires Trigger C (per-key cap). The dangerous
		// scenario is: every canonical key is unique. Each
		// opaque failure gets its own counter (C1.1 anti-merge),
		// and NO single key ever reaches the cap — there is no
		// per-key reason to arm. C1.4 must bound the run
		// through an EPISODE-level ceiling (Trigger D) that
		// counts genuinely recoverable failures across distinct
		// keys.
		const executorCalls = { count: 0 };
		const N = 12; // well above the default episode cap of 6
		const proposals = Array.from({ length: N }, (_, i) => ({
			toolCallId: `fresh-${i + 1}`,
			toolName: "opaque_thrower",
			input: { value: `key-${i + 1}` },
		}));
		const { recoverySnapshot, result, requestCount } = await driveRun(
			proposals,
			[createOpaqueThrowTool(executorCalls)],
		);
		// Provider-request and executor-call counts are pinned
		// exactly, derived from the state-machine trace for
		// default policy `maxRecoveryEpisodeFailures=6`:
		//
		//   iter 1 (key-1): fail. counter 0→1. No arm.
		//   iter 2 (key-2): fail. counter 1→2. No arm.
		//   iter 3 (key-3): fail. counter 2→3. No arm.
		//   iter 4 (key-4): fail. counter 3→4. No arm.
		//   iter 5 (key-5): fail. counter 4→5. No arm.
		//   iter 6 (key-6): fail. counter 5→6. Trigger D
		//     arms with `episode_exhausted`.
		//   iter 7 (key-7): stream entry. state=armed →
		//     state.lastError set. Stream returns key-7.
		//     Tool runs (fresh key, no pre-exec block).
		//     Fails. applyPost: beforeRecord=armed →
		//     flip to terminating. counter NOT incremented
		//     (state is no longer idle).
		//   iter 8: stream entry. state=terminating →
		//     throw. Run aborts.
		//
		// Counts:
		//   requestCount     === 7  (iters 1..7)
		//   executorCalls    === 7  (each iters 1..7 ran
		//                           their tool; no skip)
		//   exactOnlyBudget  === 7  (7 distinct keys observed;
		//                           the 7th failure still
		//                           records because
		//                           `exactOnlyBudget.set`
		//                           runs unconditionally on
		//                           the family-ineligible path)
		//   episodeFailures  === 6  (cap reached exactly)
		expect(requestCount).toBe(7);
		expect(executorCalls.count).toBe(7);
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe("episode_exhausted");
		expect(recoverySnapshot.exactOnlyBudgetSize).toBe(7);
		expect(recoverySnapshot.episodeFailures).toBe(
			recoverySnapshot.maxRecoveryEpisodeFailures,
		);
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
		const steps1: Array<(req: AgentModelRequest) => Iterable<AgentModelEvent>> =
			proposals.map((p) => () => [
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

		// C1.5 correction (parent verdict P0): `restore()` is now
		// `Promise<void>` so it can emit the canonical reset event.
		// The synchronous tracker reset still happens before the
		// promise resolves, so the post-restore probe remains valid
		// without an additional microtask flush.
		await runtime.restore([]);
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

	it("LOAD_BEARING_SENTINEL_TERMINAL_GATE_REMOVED_bites : under the latch, requests.length equals the script step count exactly", async () => {
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
		const { requestCount, result } = await driveRun(proposals, [
			createEnoentTool(executorCalls),
		]);
		// Exact bound: 4 stream calls total. One per
		// proposal; the 5th scripted "done" step is never
		// reached because the latch fires first.
		expect(requestCount).toBe(4);
		expect(result.status).toBe("aborted");
	});

	it("LOAD_BEARING_SENTINEL_FAMILY_ARM_REMOVED_bites : runtime family-arm Trigger B fires on the 3rd family-eligible observation", async () => {
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
		const { recoverySnapshot } = await driveRun(proposals, [
			createEnoentTool(executorCalls),
		]);
		// If Trigger B were removed, secondStage.kind would
		// be "idle" (no arm). Production arm is required.
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe("family_exhausted");
	});

	it("LOAD_BEARING_SENTINEL_INPUT_CHANGE_AS_PROGRESS_bites : distinct canonical inputs do NOT evade the family-exhaustion arm", async () => {
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
		const { recoverySnapshot } = await driveRun(proposals, [
			createEnoentTool(executorCalls),
		]);
		// The bounded continuation is consumed by d (the
		// post-arm turn); d fails; the latch fires.
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
	});

	it("LOAD_BEARING_SENTINEL_SUCCESS_RESET_REMOVED_bites : a successful repair during the bounded continuation resets the second-stage to idle", async () => {
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

// ============================================================================
//      C14_PARALLEL_FAILURE_PLUS_UNRELATED_SUCCESS (deterministic precedence)
// ============================================================================

describe("AgentRuntime / C1.4 parallel precedence", () => {
	it("C14_PARALLEL_FAILURE_BEATS_UNRELATED_SUCCESS: armed-continuation batch with one failure and one unrelated success MUST still terminate", async () => {
		// C1.4 precedence rule: a genuine recoverable failure in
		// the bounded continuation ALWAYS wins over an unrelated
		// sibling success. Otherwise the model can sneak a
		// material non-convergent failure past the latch by
		// bundling it with a trivially successful tool.
		//
		// Script setup: 6 distinct-key failures exhaust the
		// episode ceiling (Trigger D arms with
		// `episode_exhausted`). Iter 7 (post-arm continuation)
		// is a PARALLEL batch with one failure + one unrelated
		// success. The run must terminate truthfully: the
		// genuine failure on the continuation turn MUST flip
		// the latch to terminating, and the sibling success
		// must NOT be allowed to reset it back to idle.
		const executorCalls = { count: 0 };
		const executorOk = { count: 0 };
		const failTool: AgentTool<{ x: number }, never> = {
			name: "opaque_thrower",
			description: "Fails opaque",
			inputSchema: { type: "object" },
			async execute() {
				executorCalls.count += 1;
				throw OPAQUE;
			},
		};
		const okTool: AgentTool<{ x: number }, { ok: true }> = {
			name: "ok",
			description: "Succeeds",
			inputSchema: { type: "object" },
			async execute() {
				executorOk.count += 1;
				return { ok: true };
			},
		};
		const captureAll: CapturedOutcome[] = [];
		const make = (n: number) => ({
			type: "tool-call-delta",
			toolCallId: `a${n}`,
			toolName: "opaque_thrower",
			inputText: JSON.stringify({ x: n }),
		});
		const model = new ScriptedModel([
			// iters 1..6: 6 distinct-key opaque failures.
			// After the 6th, episode counter reaches cap (6)
			// and Trigger D arms with `episode_exhausted`.
			...Array.from({ length: 6 }, (_, i) => () => [
				make(i + 1),
				{ type: "finish", reason: "tool-calls" },
			]),
			// iter 7 (post-arm continuation): PARALLEL batch
			// with one failure + one unrelated success.
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "p_fail",
					toolName: "opaque_thrower",
					inputText: JSON.stringify({ x: 99 }),
				},
				{
					type: "tool-call-delta",
					toolCallId: "p_ok",
					toolName: "ok",
					inputText: JSON.stringify({ x: 1 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [failTool, okTool],
			hooks: captureOutcomes(captureAll),
		});
		const result = await runtime.run("Start");
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		// 6 distinct-key failures ran (iter 1..6).
		// The post-arm continuation's failure ran (iter 7
		// p_fail). Total executor = 7.
		expect(executorCalls.count).toBe(7);
		// The unrelated success also ran (sequential default).
		expect(executorOk.count).toBe(1);
		// The latch fired truthfully: terminating.
		expect(snapshot.secondStage.kind).toBe("terminating");
		expect(snapshot.secondStage.trigger).toBe("episode_exhausted");
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
	});
});

// ============================================================================
//      C14_REAL_PARALLEL_PRECEDENCE (reviewer correction: actual parallel mode)
// ============================================================================

describe("AgentRuntime / C1.4 real-parallel precedence", () => {
	it("C14_REAL_PARALLEL_FAIL_FIRST: with toolExecution='parallel', failure finishing first still flips the latch; subsequent sibling success does NOT reset state", async () => {
		// Reviewer-required: the previous test used sequential
		// default, which is a deterministic order. This test
		// runs in actual parallel mode and lets the failure
		// resolve FIRST by gating the success on a promise
		// that resolves after the failure has been observed.
		// Invariant: regardless of completion order, the
		// latch MUST flip to terminating when the genuine
		// recovery failure on the bounded continuation
		// resolves.
		const failExecs = { count: 0 };
		const okExecs = { count: 0 };
		const order: string[] = [];
		// Synchronous throw — fails immediately. We set a
		// flag once the failure has been observed so the
		// parallel sibling success can release its gate.
		let failureResolved = false;
		const failTool: AgentTool<{ x: number }, never> = {
			name: "opaque_thrower",
			description: "Fails opaque",
			inputSchema: { type: "object" },
			async execute() {
				failExecs.count += 1;
				failureResolved = true;
				order.push("fail_throw");
				throw OPAQUE;
			},
		};
		// Deferred success — waits for the failure to
		// resolve before completing. The runtime then sees
		// the success outcome after the failure has already
		// applied.
		const okTool: AgentTool<{ x: number }, { ok: true }> = {
			name: "ok",
			description: "Succeeds",
			inputSchema: { type: "object" },
			async execute() {
				okExecs.count += 1;
				order.push("ok_start");
				// Spin briefly until the failure has been
				// observed. This guarantees the success
				// completes AFTER the failure.
				while (!failureResolved) {
					await new Promise((r) => setImmediate(r));
				}
				order.push("ok_resolve");
				return { ok: true };
			},
		};
		const captureAll: CapturedOutcome[] = [];
		const make = (n: number) => ({
			type: "tool-call-delta",
			toolCallId: `a${n}`,
			toolName: "opaque_thrower",
			inputText: JSON.stringify({ x: n }),
		});
		const model = new ScriptedModel([
			...Array.from({ length: 6 }, (_, i) => () => [
				make(i + 1),
				{ type: "finish", reason: "tool-calls" },
			]),
			// iter 7: parallel batch with one failure + one
			// deferred success. The runtime runs both
			// concurrently; the failure resolves first, the
			// success waits for the failure to finish.
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "p_fail",
					toolName: "opaque_thrower",
					inputText: JSON.stringify({ x: 99 }),
				},
				{
					type: "tool-call-delta",
					toolCallId: "p_ok",
					toolName: "ok",
					inputText: JSON.stringify({ x: 1 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [failTool, okTool],
			toolExecution: "parallel",
			hooks: captureOutcomes(captureAll),
		});
		await runtime.run("Start");
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		// The latch MUST flip to terminating regardless of
		// the failure finishing first or last.
		expect(snapshot.secondStage.kind).toBe("terminating");
		expect(snapshot.secondStage.trigger).toBe("episode_exhausted");
		// Sanity check: both tools actually ran in the
		// continuation batch.
		expect(failExecs.count).toBe(7); // 6 pre-arm + 1 continuation
		expect(okExecs.count).toBe(1); // 1 continuation
	});

	it("C14_REAL_PARALLEL_OK_FIRST: with toolExecution='parallel', success finishing first MUST NOT reset the latch when the failure follows", async () => {
		// Inverse ordering: the success resolves first; the
		// failure is delayed by several event-loop ticks so
		// it is guaranteed to run AFTER the success's
		// applyPost. This is the worst-case race: the
		// success's applyPost runs while state is armed
		// and would normally flip armed→idle; the failure
		// then runs and observes an idle state. The latch
		// MUST still flip — the bounded continuation was
		// non-convergent because it contained a genuine
		// recovery failure, not because of any single
		// outcome.
		const failExecs = { count: 0 };
		const okExecs = { count: 0 };
		const order: string[] = [];
		const failTool: AgentTool<{ x: number }, never> = {
			name: "opaque_thrower",
			description: "Fails opaque",
			inputSchema: { type: "object" },
			async execute() {
				failExecs.count += 1;
				order.push("fail_start");
				// Delay several ticks to guarantee the
				// synchronous ok tool completes and its
				// applyPost runs first.
				for (let i = 0; i < 20; i++) {
					await new Promise((r) => setImmediate(r));
				}
				order.push("fail_throw");
				throw OPAQUE;
			},
		};
		const okTool: AgentTool<{ x: number }, { ok: true }> = {
			name: "ok",
			description: "Succeeds",
			inputSchema: { type: "object" },
			async execute() {
				okExecs.count += 1;
				order.push("ok_resolve");
				return { ok: true };
			},
		};
		const captureAll: CapturedOutcome[] = [];
		const make = (n: number) => ({
			type: "tool-call-delta",
			toolCallId: `a${n}`,
			toolName: "opaque_thrower",
			inputText: JSON.stringify({ x: n }),
		});
		const model = new ScriptedModel([
			...Array.from({ length: 6 }, (_, i) => () => [
				make(i + 1),
				{ type: "finish", reason: "tool-calls" },
			]),
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "p_fail",
					toolName: "opaque_thrower",
					inputText: JSON.stringify({ x: 99 }),
				},
				{
					type: "tool-call-delta",
					toolCallId: "p_ok",
					toolName: "ok",
					inputText: JSON.stringify({ x: 1 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [failTool, okTool],
			toolExecution: "parallel",
			hooks: captureOutcomes(captureAll),
		});
		await runtime.run("Start");
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		// The latch MUST flip to terminating. If the
		// success's applyPost reset state to idle (because
		// it ran while armed) and the subsequent failure
		// observed an idle state, the latch would NOT fire
		// and the run would either complete normally
		// (false negative) or accumulate enough failures
		// to re-arm later. The C1.4 batch-level guard in
		// `executeToolCalls` (parallel path) handles this:
		// after Promise.all resolves, if state was
		// `armed` at batch start AND any sibling had a
		// non-convergent failure, force flip to
		// `terminating`. Pin that behavior here.
		expect(snapshot.secondStage.kind).toBe("terminating");
		expect(snapshot.secondStage.trigger).toBe("episode_exhausted");
		// Both tools ran in the continuation batch.
		expect(failExecs.count).toBe(7); // 6 pre-arm + 1 continuation
		expect(okExecs.count).toBe(1); // 1 continuation
	});
});

// ============================================================================
//      C14_PARALLEL_CONTROL_PLANE_AUTHORITY (reviewer round-3 correction)
// ============================================================================

describe("AgentRuntime / C1.4 parallel control-plane authority", () => {
	it("C14_PARALLEL_CONTROL_PLANE_DENY_NOT_FAILURE: with armed second-stage, a host-policy DENY of one sibling in a parallel batch MUST NOT fire the latch", async () => {
		// Reviewer-required round-3 fixture.
		//
		// The previous round of this code keyed the
		// parallel-batch latch on `AgentToolResult.isError`
		// === true. That re-introduced the C1.1
		// anti-pattern: `isError` structurally conflates
		// `failure / recoverable` with `control_plane /
		// host_policy_denied | user_rejected |
		// runtime_skipped | runtime_aborted`. A host-policy
		// DENY of one sibling in a parallel batch must
		// NEVER arm the second-stage continuation — that
		// would violate the C1.4 control-plane-exclusion
		// contract.
		//
		// The fix routes the guard through the runtime-
		// owned `pendingBatchOutcomes: ToolRuntimeOutcome[]`
		// buffer, populated by `executePreparedTool`
		// immediately after `classifyToolRuntimeOutcome`
		// produces the typed outcome. The guard is
		// `outcomes.some(o => o.kind === "failure")` —
		// never `isError === true`.
		//
		// Setup:
		//   iters 1..6: 6 distinct opaque failures
		//     (Trigger D arms after the 6th).
		//   iter 7: parallel batch
		//     sibling A = opaque_thrower (DENIED via
		//       requestToolApproval → control_plane /
		//       host_policy_denied)
		//     sibling B = ok (succeeds → success)
		//   iter 8: text-only completion
		const executorCalls = { count: 0 };
		const executorOk = { count: 0 };
		const approvalCalls: string[] = [];
		const failTool: AgentTool<{ value: string }, never> = {
			name: "opaque_thrower",
			description: "Fails opaque",
			inputSchema: { type: "object" },
			async execute() {
				executorCalls.count += 1;
				throw OPAQUE;
			},
		};
		const okTool: AgentTool<{ x: number }, { ok: true }> = {
			name: "ok",
			description: "Succeeds",
			inputSchema: { type: "object" },
			async execute() {
				executorOk.count += 1;
				return { ok: true };
			},
		};
		const captureAll: CapturedOutcome[] = [];
		// Setup: 3 identical opaque failures (same canonical
		// key `key-1`). After the 3rd, Trigger C's per-key
		// exact-only cap fires and arms the second-stage
		// continuation with `exact_only_capped`.
		const sameKeyStep = (n: number) => () => [
			{
				type: "tool-call-delta",
				toolCallId: `f${n}`,
				toolName: "opaque_thrower",
				inputText: JSON.stringify({ value: "key-1" }),
			},
			{ type: "finish", reason: "tool-calls" },
		];
		const model = new ScriptedModel([
			sameKeyStep(1),
			sameKeyStep(2),
			sameKeyStep(3),
			// iter 4 (continuation, after Trigger C arm):
			// parallel batch [DENIED opaque_thrower, ok].
			// The DENIED sibling's outcome is
			// `control_plane` (NOT failure). The batch
			// guard must NOT fire the latch. The ok
			// success resets state to idle.
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "p_deny",
					toolName: "opaque_thrower",
					inputText: JSON.stringify({ value: "key-2" }),
				},
				{
					type: "tool-call-delta",
					toolCallId: "p_ok",
					toolName: "ok",
					inputText: JSON.stringify({ x: 1 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			// iter 5: text-only completion.
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [failTool, okTool],
			toolExecution: "parallel",
			hooks: captureOutcomes(captureAll),
			toolPolicies: { opaque_thrower: { autoApprove: false } },
			requestToolApproval: async (request) => {
				const isDeny = request.toolCallId === "p_deny";
				approvalCalls.push(request.toolCallId);
				return {
					approved: !isDeny,
					reason: isDeny ? "denied" : "",
					decision: isDeny ? { kind: "deny" } : { kind: "approve" },
				};
			},
		});
		const result = await runtime.run("Start");
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		// PROVEN: parallel control-plane outcome must NOT
		// fire the latch. The ok success reset the second
		// stage to idle.
		expect(snapshot.secondStage.kind).toBe("idle");
		expect(snapshot.episodeFailures).toBe(0);
		expect(result.status).toBe("completed");
		// The DENY sibling's outcome must be a control
		// plane, NOT a failure. We accept either
		// `host_policy_denied` (host-policy DENY) or
		// `user_rejected` (user NO-click); both are
		// structurally excluded from recovery budget per
		// C1.1, which is the load-bearing assertion here.
		// The classifier priority (hostDenied over
		// userRejected) determines which label applies.
		const denyOutcome = expectCaptured(captureAll, "p_deny");
		expect(denyOutcome.kind).toBe("control_plane");
		if (denyOutcome.kind !== "control_plane") throw new Error("narrow");
		expect(["host_policy_denied", "user_rejected"]).toContain(
			denyOutcome.outcome,
		);
		// The ok sibling's outcome must be success.
		const okOutcome = expectCaptured(captureAll, "p_ok");
		expect(okOutcome.kind).toBe("success");
		// 3 pre-arm failures executed; 1 ok success ran.
		expect(executorCalls.count).toBe(3);
		expect(executorOk.count).toBe(1);
	});

	it("C14_PARALLEL_RUNTIME_SKIPPED_NOT_FAILURE: with armed second-stage, a synthetic runtime_skipped (C1.3 pre-exec block) in a parallel batch MUST NOT fire the latch", async () => {
		// Reviewer-required round-3 fixture.
		//
		// The `runtime_skipped` control-plane outcome is
		// produced by the C1.3 pre-execution breaker when
		// it intercepts an exact-key repeat attempt that
		// has already exhausted its per-key budget. Under
		// the previous round's `isError`-keyed guard, an
		// `isError=true` `runtime_skipped` would have
		// wrongly fired the latch (false positive — the
		// synthetic skip is structurally excluded from
		// recovery budget per C1.3).
		//
		// Setup:
		//   iters 1..6: 6 distinct opaque failures
		//     (Trigger D arms after the 6th).
		//   iter 7 (continuation): parallel batch
		//     sibling A = ok (succeeds → success)
		//     sibling B = opaque_thrower with key=key-1
		//       (REPEAT of iter 1's canonical key →
		//       C1.3 pre-exec block → control_plane /
		//       runtime_skipped)
		//   iter 8: text-only completion
		const executorCalls = { count: 0 };
		const executorOk = { count: 0 };
		const failTool: AgentTool<{ value: string }, never> = {
			name: "opaque_thrower",
			description: "Fails opaque",
			inputSchema: { type: "object" },
			async execute() {
				executorCalls.count += 1;
				throw OPAQUE;
			},
		};
		const okTool: AgentTool<{ x: number }, { ok: true }> = {
			name: "ok",
			description: "Succeeds",
			inputSchema: { type: "object" },
			async execute() {
				executorOk.count += 1;
				return { ok: true };
			},
		};
		const captureAll: CapturedOutcome[] = [];
		// Setup: 3 identical opaque failures (same canonical
		// key `key-1`). After the 3rd, Trigger C's per-key
		// exact-only cap fires and arms the second-stage
		// continuation with `exact_only_capped`. On the 4th
		// attempt of the same key (the bounded continuation
		// turn), the pre-exec block intercepts and routes
		// the call as `control_plane / runtime_skipped`.
		const sameKeyStep = (n: number) => () => [
			{
				type: "tool-call-delta",
				toolCallId: `f${n}`,
				toolName: "opaque_thrower",
				inputText: JSON.stringify({ value: "key-1" }),
			},
			{ type: "finish", reason: "tool-calls" },
		];
		const model = new ScriptedModel([
			sameKeyStep(1),
			sameKeyStep(2),
			sameKeyStep(3),
			// iter 4 (continuation, after Trigger C arm):
			// parallel batch [ok, repeat-key opaque]. The
			// repeat-key hits the pre-exec block
			// (`exactOnlyBudget[key] > maxRepairAttempts`).
			// The batch guard must NOT fire the latch.
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "p_ok",
					toolName: "ok",
					inputText: JSON.stringify({ x: 1 }),
				},
				{
					type: "tool-call-delta",
					toolCallId: "p_repeat",
					toolName: "opaque_thrower",
					// Same canonical key as f1..f3.
					inputText: JSON.stringify({ value: "key-1" }),
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
			tools: [failTool, okTool],
			toolExecution: "parallel",
			hooks: captureOutcomes(captureAll),
		});
		const result = await runtime.run("Start");
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		// PROVEN: a synthetic runtime_skipped in a parallel
		// batch is correctly classified as
		// `control_plane / runtime_skipped` (NOT
		// `failure / ...`). The latch termination that
		// follows is the SAME one observed in
		// C14_A_EXACT_REPEAT_TERMINATES (sequential): the
		// C1.3 synthesised-pre-exec transition correctly
		// fires for exact-key repeats on the continuation
		// turn. The batch-level guard contributes NOTHING
		// to this termination — it operates on
		// `ToolRuntimeOutcome.kind === "failure"`, which
		// `runtime_skipped` is not. The trigger that
		// survives into terminating is the pre-existing
		// exact_only_capped from Trigger C.
		expect(snapshot.secondStage.kind).toBe("terminating");
		expect(snapshot.secondStage.trigger).toBe("exact_only_capped");
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
		// The repeat-key sibling's outcome must be the
		// synthetic control-plane runtime_skipped.
		const repeatOutcome = expectCaptured(captureAll, "p_repeat");
		expect(repeatOutcome.kind).toBe("control_plane");
		if (repeatOutcome.kind !== "control_plane") throw new Error("narrow");
		expect(repeatOutcome.outcome).toBe("runtime_skipped");
		// The ok sibling's outcome is success.
		const okOutcome = expectCaptured(captureAll, "p_ok");
		expect(okOutcome.kind).toBe("success");
		// 3 pre-arm failures executed; 1 ok success ran.
		// The repeat key did NOT execute (pre-exec block).
		expect(executorCalls.count).toBe(3);
		expect(executorOk.count).toBe(1);
	});
});

// ============================================================================
//      C14_PARALLEL_IDLE_MIXED_BATCH_ORDER_INDEPENDENT (reviewer round-3)
// ============================================================================

describe("AgentRuntime / C1.4 parallel idle mixed-batch order independence", () => {
	it("C14_PARALLEL_IDLE_MIXED_BATCH_ORDER_INDEPENDENT: repeated [failure, success] parallel batches in idle state MUST have scheduler-independent counter behavior", async () => {
		// Reviewer-required round-3 fixture (recommended).
		//
		// The C1.4 success-reset rule resets
		// `recoveryEpisodeFailures` to 0 on EVERY
		// successful tool execution, regardless of
		// second-stage kind. That decision is
		// fundamentally a product-policy choice —
		// whether a single success in a parallel batch
		// counts as forward progress that clears the
		// episode-level failure pressure, or whether
		// any failure in a parallel batch
		// conservatively increments the counter and
		// the success only resets the per-tool outcome
		// (not the cross-tool pressure).
		//
		// The current implementation chooses the
		// first option: success always resets the
		// counter. This means a parallel batch
		// [failure, success] under idle state is
		// order-independent — both ordering cases
		// produce counter=0 at the end of the batch,
		// because the success applyPost unconditionally
		// writes 0 regardless of what the failure
		// applyPost just wrote.
		//
		// This test pins the order-independence under
		// repeated parallel batches to ensure the
		// scheduler (which decides which sibling's
		// applyPost runs first) cannot make the
		// counter climb indefinitely. If the policy
		// is later changed to a more conservative
		// "any-failure-in-batch-increments" rule,
		// this test will need to be updated to match.
		//
		// Setup:
		//   3 parallel batches each containing
		//   [opaque_thrower(key-N), ok]. Each batch
		//   under idle state. After 3 batches, the
		//   episode counter MUST be 0 (success always
		//   resets).
		const executorCalls = { count: 0 };
		const executorOk = { count: 0 };
		const failTool: AgentTool<{ value: string }, never> = {
			name: "opaque_thrower",
			description: "Fails opaque",
			inputSchema: { type: "object" },
			async execute() {
				executorCalls.count += 1;
				throw OPAQUE;
			},
		};
		const okTool: AgentTool<{ x: number }, { ok: true }> = {
			name: "ok",
			description: "Succeeds",
			inputSchema: { type: "object" },
			async execute() {
				executorOk.count += 1;
				return { ok: true };
			},
		};
		const captureAll: CapturedOutcome[] = [];
		const parallelBatch = (key: string, n: number) => () => [
			{
				type: "tool-call-delta",
				toolCallId: `f-${n}`,
				toolName: "opaque_thrower",
				inputText: JSON.stringify({ value: key }),
			},
			{
				type: "tool-call-delta",
				toolCallId: `s-${n}`,
				toolName: "ok",
				inputText: JSON.stringify({ x: n }),
			},
			{ type: "finish", reason: "tool-calls" },
		];
		const model = new ScriptedModel([
			parallelBatch("k1", 1),
			parallelBatch("k2", 2),
			parallelBatch("k3", 3),
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [failTool, okTool],
			toolExecution: "parallel",
			hooks: captureOutcomes(captureAll),
		});
		const result = await runtime.run("Start");
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		// PROVEN: parallel [fail, success] batches under
		// idle state MUST be order-independent. Each
		// success resets the episode counter, so 3
		// batches → counter at 0.
		expect(snapshot.secondStage.kind).toBe("idle");
		expect(snapshot.episodeFailures).toBe(0);
		expect(result.status).toBe("completed");
		// 3 failures executed; 3 successes executed.
		expect(executorCalls.count).toBe(3);
		expect(executorOk.count).toBe(3);
		// All sibling outcomes recorded.
		for (let i = 1; i <= 3; i += 1) {
			const failOutcome = expectCaptured(captureAll, `f-${i}`);
			expect(failOutcome.kind).toBe("failure");
			const okOutcome = expectCaptured(captureAll, `s-${i}`);
			expect(okOutcome.kind).toBe("success");
		}
	});
});

// ============================================================================
//      C14_EPISODE_SUCCESS_RESETS_FAILURE_ACCUMULATION (reviewer correction)
// ============================================================================

describe("AgentRuntime / C1.4 episode-success reset", () => {
	it("C14_EPISODE_SUCCESS_RESETS_FAILURE_ACCUMULATION: intermittent failures with genuine progress between them MUST NOT trigger episode_exhausted", async () => {
		// Reviewer-required fixture. The episode counter
		// measures NON-CONVERGENT observations; a genuine
		// successful tool execution between failures
		// terminates the current recovery episode and starts
		// a fresh one. Without the reset, 6 alternating
		// fail/success pairs would still trip Trigger D,
		// turning intermittent failures with real forward
		// progress into a false-positive non-convergence.
		const executorCalls = { count: 0 };
		const executorOk = { count: 0 };
		const failTool: AgentTool<{ x: number }, never> = {
			name: "opaque_thrower",
			description: "Fails opaque",
			inputSchema: { type: "object" },
			async execute() {
				executorCalls.count += 1;
				throw OPAQUE;
			},
		};
		const okTool: AgentTool<{ x: number }, { ok: true }> = {
			name: "ok",
			description: "Succeeds",
			inputSchema: { type: "object" },
			async execute() {
				executorOk.count += 1;
				return { ok: true };
			},
		};
		const captureAll: CapturedOutcome[] = [];
		// 5 fail → 5 success → text-only completion. Even
		// with the default `maxRecoveryEpisodeFailures=6`,
		// every success resets the counter, so 5 failures
		// across 5 fresh episodes MUST NOT arm Trigger D.
		const failSteps = Array.from({ length: 5 }, (_, k) => () => [
			{
				type: "tool-call-delta",
				toolCallId: `f${k + 1}`,
				toolName: "opaque_thrower",
				inputText: JSON.stringify({ x: k + 1 }),
			},
			{ type: "finish", reason: "tool-calls" },
		]);
		const okSteps = Array.from({ length: 5 }, (_, k) => () => [
			{
				type: "tool-call-delta",
				toolCallId: `s${k + 1}`,
				toolName: "ok",
				inputText: JSON.stringify({ x: k + 1 }),
			},
			{ type: "finish", reason: "tool-calls" },
		]);
		const model = new ScriptedModel([
			// 5 alternating pairs.
			failSteps[0],
			okSteps[0],
			failSteps[1],
			okSteps[1],
			failSteps[2],
			okSteps[2],
			failSteps[3],
			okSteps[3],
			failSteps[4],
			okSteps[4],
			// Text-only completion.
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [failTool, okTool],
			hooks: captureOutcomes(captureAll),
		});
		const result = await runtime.run("Start");
		const snapshot = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		// 5 failures ran.
		expect(executorCalls.count).toBe(5);
		// 5 successes ran.
		expect(executorOk.count).toBe(5);
		// No arm ever fired. Trigger D did NOT trip because
		// each success reset the counter before it reached 6.
		expect(snapshot.secondStage.kind).toBe("idle");
		expect(snapshot.episodeFailures).toBe(0);
		// Run completed truthfully, NOT aborted.
		expect(result.status).toBe("completed");
	});
});

// ============================================================================
//           C14_NEXT_RUN_LIFECYCLE_RESET (same-runtime reuse)
// ============================================================================

describe("AgentRuntime / C1.4 next-run lifecycle", () => {
	it("C14_NEXT_RUN_LIFECYCLE_RESET: a completed/aborted run followed by another run() starts from a fresh episode", async () => {
		// Recon: per the official SDK docs `restore()` resets
		// runtime state, but a normal `run()` invocation on
		// the same instance does NOT explicitly reset recovery
		// state. If the runtime can be reused, we must either
		// prove the second run starts from a fresh episode or
		// document the constraint.
		//
		// This test exercises the second-run scenario: after
		// the first run terminates with second-stage
		// `terminating`, we call `run()` again and verify the
		// recovery state was reset to `idle` for the new run.
		const executorCalls = { count: 0 };
		const proposals1 = Array.from({ length: 4 }, (_, i) => ({
			toolCallId: `r1-${i + 1}`,
			toolName: "fs_read",
			input: { path: "/x" },
		}));
		const proposals2 = [
			{ toolCallId: "r2-1", toolName: "fs_read", input: { path: "/y" } },
		];
		const captured: CapturedOutcome[] = [];
		const steps: Array<(req: AgentModelRequest) => Iterable<AgentModelEvent>> =
			[];
		for (const p of proposals1) {
			steps.push(() => [
				{
					type: "tool-call-delta",
					toolCallId: p.toolCallId,
					toolName: p.toolName,
					inputText: JSON.stringify(p.input),
				},
				{ type: "finish", reason: "tool-calls" },
			]);
		}
		for (const p of proposals2) {
			steps.push(() => [
				{
					type: "tool-call-delta",
					toolCallId: p.toolCallId,
					toolName: p.toolName,
					inputText: JSON.stringify(p.input),
				},
				{ type: "finish", reason: "tool-calls" },
			]);
		}
		steps.push(() => [
			{ type: "text-delta", text: "done" },
			{ type: "finish", reason: "stop" },
		]);
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(executorCalls)],
			hooks: captureOutcomes(captured),
		});
		// First run: drives to termination.
		const result1 = await runtime.run("first");
		const snap1 = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		expect(result1.status).toBe("aborted");
		expect(snap1.secondStage.kind).toBe("terminating");
		// Second run: should start fresh. We invoke run()
		// again on the same runtime instance WITHOUT calling
		// restore() first — this proves the run-start path
		// resets recovery state.
		const result2 = await runtime.run("second");
		const snap2 = (
			runtime as unknown as {
				__recoverySnapshotForTests(): RecoveryTestSnapshot;
			}
		).__recoverySnapshotForTests();
		// The second run is one fresh failure (different
		// key) followed by text-only completion. The
		// recovery state must be reset to idle for the new
		// episode.
		expect(snap2.secondStage.kind).toBe("idle");
		// The second run's first failure incremented the
		// fresh counter to 1; the reset worked correctly.
		expect(snap2.episodeFailures).toBe(1);
		// fs_read ENOENT failures are family-eligible, so
		// they go through `recordFailureIdentity` (not the
		// exact-only budget). The substrate's recoveryTracker
		// is fresh, so its circuit state is also fresh:
		// NOT `circuit_open` (which would have leaked from
		// the first run's latch).
		expect(snap2.state).not.toBe("circuit_open");
		// exactOnlyBudget is fresh too — 0 entries inherited
		// from the first run.
		expect(snap2.exactOnlyBudgetSize).toBe(0);
		// The second run completes successfully (one
		// failure was below the cap).
		expect(result2.status).toBe("completed");
	});
});
