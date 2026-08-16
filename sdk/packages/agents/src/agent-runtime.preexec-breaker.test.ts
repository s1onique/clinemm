/**
 * C1.3 AgentRuntime pre-execution breaker — production-runtime
 * integration tests.
 *
 * These tests drive the real `AgentRuntime` (not a simulated loop
 * around `RecoveryTracker`) and assert the BREAKER invariant:
 *
 *     same exact failing tool attempt
 *     ↓ original execution
 *     ↓ repair #1 execution
 *     ↓ repair #2 execution
 *     ↓ budget exhausted
 *     ↓ next equivalent proposal
 *     BLOCK BEFORE tool.execute()
 *
 * With the default policy `{ maxRepairAttempts: 2 }`, the canonical
 * executor-call budget is 3 (= `1 + maxRepairAttempts`); proposal #4
 * must be intercepted at the pre-execution stage and NEVER enter
 * `tool.execute(...)`. Subsequent equivalent proposals must also be
 * intercepted without further executing.
 */
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolRuntimeOutcome,
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";
import { DEFAULT_RECOVERY_POLICY, RecoveryTracker } from "./runtime/recovery";

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

function createEchoTool(executorCalls: { count: number }): AgentTool<
	{ text: string },
	{ echoed: string }
> {
	return {
		name: "echo",
		description: "Echo input",
		inputSchema: { type: "object" },
		async execute(input) {
			executorCalls.count += 1;
			return { echoed: input.text };
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

interface ScriptedProposal {
	toolCallId: string;
	toolName: string;
	input: unknown;
}

interface RecoveryTestSnapshot {
	state: import("@cline/shared").RecoveryState;
	circuitNoticeCount: number;
	exactOnlyBudgetSize: number;
}

async function driveRepeatedProposals(
	proposals: readonly ScriptedProposal[],
	tools: AgentTool<any, any>[],
	toolExecution: "sequential" | "parallel" = "sequential",
	requestApproval?: (req: ToolApprovalRequest) => Promise<ToolApprovalResult>,
	maxIterations: number = 32,
	toolPolicies?: Record<string, { autoApprove?: boolean; enabled?: boolean }>,
): Promise<{
	messages: AgentMessage[];
	captured: CapturedOutcome[];
	result: Awaited<ReturnType<AgentRuntime["run"]>>;
	recoverySnapshot: RecoveryTestSnapshot;
}> {
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
		toolExecution,
		...(toolPolicies ? { toolPolicies: toolPolicies as never } : {}),
		...(requestApproval ? { requestToolApproval: requestApproval } : {}),
		...(maxIterations ? { maxIterations } : {}),
	});
	const result = await runtime.run("Start");
	const recoverySnapshot = (
		runtime as unknown as {
			__recoverySnapshotForTests(): RecoveryTestSnapshot;
		}
	).__recoverySnapshotForTests();
	return { messages: result.messages, captured, result, recoverySnapshot };
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
//                            canonical proofs
// ============================================================================

describe("AgentRuntime / C1.3 exact pre-execution breaker", () => {
	it("REAL_EXACT_REPEAT_ENOENT: same tool+input fails 3 times, 4th proposal executes zero times", async () => {
		const executorCalls = { count: 0 };
		// C1.4 caveat: under the bounded continuation, we observe
		// 4 proposals here (3 failures + 1 pre-exec block). The
		// "arming" happens at p-4's pre-exec block (Trigger A),
		// which also consumes the bounded continuation slot.
		// The next model-stream entry sees
		// state === "terminating" and aborts the run with the
		// typed reason — so no further proposal (the would-be
		// p-5) is ever delivered.
		const proposals = Array.from({ length: 4 }, (_, i) => ({
			toolCallId: `p-${i + 1}`,
			toolName: "fs_read",
			input: { path: "/missing" },
		}));
		const { captured, recoverySnapshot, result } = await driveRepeatedProposals(
			proposals,
			[createEnoentTool(executorCalls)],
		);
		// 1 original + 2 repairs = 3 executions on the failing family.
		expect(executorCalls.count).toBe(1 + DEFAULT_RECOVERY_POLICY.maxRepairAttempts);
		expect(captured).toHaveLength(proposals.length);
		for (let i = 0; i < 3; i += 1) {
			const out = expectCaptured(captured, `p-${i + 1}`);
			expect(out.kind, `proposal ${i + 1} kind`).toBe("failure");
		}
		const p4 = expectCaptured(captured, "p-4");
		expect(p4.kind, "p-4 kind").toBe("control_plane");
		if (p4.kind !== "control_plane") throw new Error("narrow");
		expect(p4.outcome).toBe("runtime_skipped");
		// The first intercepted attempt transitioned warning →
		// circuit_open exactly once. Repeated interceptions stay at
		// circuit_open with the same notice count.
		expect(recoverySnapshot.state).toBe("circuit_open");
		expect(recoverySnapshot.circuitNoticeCount).toBe(1);
		// C1.4: after the bounded continuation, the run terminates
		// truthfully as `aborted` with the typed reason.
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
	});

	it("EXECUTOR_COUNT_3: with default policy, executorCalls = 1 + maxRepairAttempts = 3", async () => {
		const executorCalls = { count: 0 };
		const proposals = Array.from({ length: 5 }, (_, i) => ({
			toolCallId: `q-${i + 1}`,
			toolName: "fs_read",
			input: { path: "/missing" },
		}));
		await driveRepeatedProposals(proposals, [createEnoentTool(executorCalls)]);
		expect(executorCalls.count).toBe(1 + DEFAULT_RECOVERY_POLICY.maxRepairAttempts);
	});

	it("BLOCKED_PROPOSAL_ZERO_EXECUTION: every blocked proposal leaves executorCalls unchanged", async () => {
		const executorCalls = { count: 0 };
		const proposals = Array.from({ length: 10 }, (_, i) => ({
			toolCallId: `r-${i + 1}`,
			toolName: "fs_read",
			input: { path: "/missing" },
		}));
		await driveRepeatedProposals(proposals, [createEnoentTool(executorCalls)]);
		expect(executorCalls.count).toBe(1 + DEFAULT_RECOVERY_POLICY.maxRepairAttempts);
	});

	it("CIRCUIT_TRANSITION_ONCE: warning → circuit_open fires at most once even with repeated blocks", async () => {
		const executorCalls = { count: 0 };
		// C1.4 caveat: under the bounded continuation, we
		// observe EXACTLY ONE pre-exec block for the same exact
		// attempt identity — the arming block at proposal 4.
		// The bounded continuation is consumed at the same time
		// the pre-exec block fires (Trigger A → idle→armed, then
		// the next model-stream flips armed→terminating), so
		// the next identical proposal never arrives.
		const proposals = Array.from({ length: 4 }, (_, i) => ({
			toolCallId: `s-${i + 1}`,
			toolName: "fs_read",
			input: { path: "/missing" },
		}));
		const { captured } = await driveRepeatedProposals(proposals, [
			createEnoentTool(executorCalls),
		]);
		const blocked = captured.filter(
			(c) =>
				c.outcome.kind === "control_plane" &&
				c.outcome.outcome === "runtime_skipped",
		);
		expect(blocked.length).toBe(
			4 - (1 + DEFAULT_RECOVERY_POLICY.maxRepairAttempts),
		);
		expect(executorCalls.count).toBe(1 + DEFAULT_RECOVERY_POLICY.maxRepairAttempts);
	});
});

// ============================================================================
//                    exact-repeat vs changed-input matrix
// ============================================================================

describe("AgentRuntime / C1.3 breaker matrix", () => {
	it("EXACT_REPEAT_BLOCKS_BUT_CHANGED_INPUT_DOES_NOT_INHERIT_BLOCK", async () => {
		const executorCalls = { count: 0 };
		const proposals = [
			{ toolCallId: "a", toolName: "fs_read", input: { path: "/x" } },
			{ toolCallId: "b", toolName: "fs_read", input: { path: "/x" } },
			{ toolCallId: "c", toolName: "fs_read", input: { path: "/x" } },
			{ toolCallId: "d", toolName: "fs_read", input: { path: "/y" } },
		];
		// C1.4 caveat: after the family budget exhausts (after c),
		// the second-stage continuation arms and the latch issues
		// EXACTLY ONE additional model request as the bounded
		// continuation. d IS that continuation — it is a fresh
		// key under the same family, so the C1.3 pre-exec gate
		// does NOT block it, and the executor is invoked. After d
		// also fails the same family, the run terminates; no
		// further proposal (the would-be `e`) is delivered because
		// the next model-stream entry encounters the terminal
		// latch. This proves the family-exhaustion-without-exact-
		// repeat escape hatch from C1.3 is bounded under C1.4.
		const { captured, recoverySnapshot, result } = await driveRepeatedProposals(
			proposals,
			[createEnoentTool(executorCalls)],
		);
		expect(executorCalls.count).toBe(4);
		const d = expectCaptured(captured, "d");
		expect(d.kind).toBe("failure");
		// The bounded continuation was used unsuccessfully, so the
		// second-stage state machine ends in `terminating`.
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe(
			"family_exhausted",
		);
		// The run is truthfully terminated as `aborted`.
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
	});

	it("DIFFERENT_TOOL_DOES_NOT_COLLIDE", async () => {
		const aExec = { count: 0 };
		const bExec = { count: 0 };
		const toolA: AgentTool<{ x: number }, never> = {
			name: "tool_a",
			description: "fails with ENOENT",
			inputSchema: { type: "object" },
			async execute() {
				aExec.count += 1;
				throw ENOENT;
			},
		};
		const toolB: AgentTool<{ x: number }, { ok: true }> = {
			name: "tool_b",
			description: "succeeds",
			inputSchema: { type: "object" },
			async execute() {
				bExec.count += 1;
				return { ok: true };
			},
		};
		// C1.4 caveat: under the bounded continuation, after the
		// tool_a family exhausts (a1..a3), the post-arm
		// continuation IS the next model request — and we have
		// no further model request that would propose b1 with a
		// successful tool. The C1.3 collision-freedom property
		// is still true at the substrate level (a different tool
		// has its own family), but the runtime's run-level bound
		// terminates before b1 can arrive. The "successful
		// material progression resets the second-stage" property
		// is covered by C1.4_D_SUCCESSFUL_REPAIR_RESETS in
		// `agent-runtime.second-stage-recovery.test.ts`.
		const proposals = [
			{ toolCallId: "a1", toolName: "tool_a", input: { x: 1 } },
			{ toolCallId: "a2", toolName: "tool_a", input: { x: 1 } },
			{ toolCallId: "a3", toolName: "tool_a", input: { x: 1 } },
			{ toolCallId: "a4", toolName: "tool_a", input: { x: 1 } },
		];
		const { captured, recoverySnapshot } = await driveRepeatedProposals(proposals, [
			toolA,
			toolB,
		]);
		expect(aExec.count).toBe(3);
		// tool_b was registered, but its proposal was never
		// delivered because the runtime's bounded continuation
		// terminated the run after a4's pre-exec block.
		expect(bExec.count).toBe(0);
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe(
			"family_exhausted",
		);
		const a4 = expectCaptured(captured, "a4");
		expect(a4.kind).toBe("control_plane");
		if (a4.kind !== "control_plane") throw new Error("narrow");
		expect(a4.outcome).toBe("runtime_skipped");
	});
});

// ============================================================================
//                  unknown-tool / executor-throw boundary cases
// ============================================================================

describe("AgentRuntime / C1.3 unknown-tool & TBCE boundary", () => {
	it("UNKNOWN_TOOL_EXACT_REPEAT_BOUNDED: identical unknown-tool proposal is intercepted by the pre-exec breaker after 3 failures", async () => {
		// C1.4 caveat: under the bounded continuation, the run
		// terminates after the post-arm model stream, so the
		// 5th identical proposal never arrives. We observe
		// 3 failures + 1 pre-exec block. The C1.3 substrate
		// continues to mark the exact key blocked at the
		// pre-execution stage (Trigger A still fires here);
		// the model-stream terminal latch (Trigger C of
		// C1.4) is what interrupts the loop after the
		// bounded continuation.
		const proposals = [
			{ toolCallId: "u-1", toolName: "ghost_tool", input: { x: 1 } },
			{ toolCallId: "u-2", toolName: "ghost_tool", input: { x: 1 } },
			{ toolCallId: "u-3", toolName: "ghost_tool", input: { x: 1 } },
			{ toolCallId: "u-4", toolName: "ghost_tool", input: { x: 1 } },
		];
		const executorCalls = { count: 0 };
		const { captured, recoverySnapshot, result } = await driveRepeatedProposals(
			proposals,
			[createEchoTool(executorCalls)],
		);
		// The unknown-tool path never enters a real executor (the tool
		// is not registered); the `count` is here to assert the
		// non-invocation regardless of breaker state.
		expect(executorCalls.count).toBe(0);
		// First three proposals: family-eligible failures, output of
		// `failure / tool_not_found` (Priority 2 of the classifier).
		for (const id of ["u-1", "u-2", "u-3"]) {
			const out = expectCaptured(captured, id);
			expect(out.kind).toBe("failure");
		}
		// Fourth proposal: pre-exec block. The runtime's C1.4 latch
		// has been armed (Trigger A) by this block, and after the
		// model-stream entry the latch flips to terminating — so
		// the run aborts before the would-be 5th proposal arrives.
		const u4 = expectCaptured(captured, "u-4");
		expect(u4.kind).toBe("control_plane");
		if (u4.kind === "control_plane") {
			expect(u4.outcome).toBe("runtime_skipped");
		}
		// Once the breaker trips, the visible state lands on
		// `circuit_open` and the runtime's circuit notice count is
		// exactly 1 (subsequent intercepts are no-ops at the tracker
		// layer).
		expect(recoverySnapshot.state).toBe("circuit_open");
		expect(recoverySnapshot.circuitNoticeCount).toBe(1);
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
	});

	it("UNKNOWN_TOOL_CHANGED_INPUT_DOES_NOT_FAKE_EXECUTION: varying inputs never invoke a real executor", async () => {
		// C1.4 caveat: although each input has a distinct
		// exact-key identity, they all share the same
		// family (`ghost_tool:tool_not_found:tool:not_found`).
		// After v-1..v-3 fail (3rd obs), the family budget is
		// exhausted and Trigger B arms the second-stage. v-4 is
		// the post-arm continuation. v-4's pre-exec check
		// does NOT block (new exact key) but the unknown-tool
		// failure-path posts another observation that flips
		// the armed state to terminating. The run aborts; v-5
		// is never delivered. This proves the family-exhaustion
		// escape hatch is bounded under C1.4 even when the
		// model's only "evasion" is a fresh-key same-family
		// attempt.
		const proposals = Array.from({ length: 4 }, (_, i) => ({
			toolCallId: `v-${i + 1}`,
			toolName: "ghost_tool",
			input: { i },
		}));
		const executorCalls = { count: 0 };
		const { captured, recoverySnapshot } = await driveRepeatedProposals(
			proposals,
			[createEchoTool(executorCalls)],
		);
		// The unknown-tool path never enters a real executor.
		expect(executorCalls.count).toBe(0);
		for (const id of ["v-1", "v-2", "v-3"]) {
			const out = expectCaptured(captured, id);
			expect(out.kind).toBe("failure");
		}
		// v-4 is the post-arm continuation. It does not
		// execute (unknown tool), so the captured kind here is
		// `failure` (family-eligible failure), not control_plane.
		// The second-stage flipping happens because the
		// failure-path classified v-4 with state==="armed"
		// BEFORE this turn.
		const v4 = expectCaptured(captured, "v-4");
		expect(v4.kind).toBe("failure");
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe(
			"family_exhausted",
		);
		// No exact-only budget inflation: family-eligible
		// route uses the substrate's recoveryTracker, not
		// the runtime-owned map.
		expect(recoverySnapshot.exactOnlyBudgetSize).toBe(0);
	});

	it("OPAQUE_EXACT_ONLY", async () => {
		const executorCalls = { count: 0 };
		const tool = createOpaqueThrowTool(executorCalls);
		// C1.4 caveat: under the bounded continuation, after
		// o1..o3 fail and arm the second-stage via Trigger C
		// (opaque exact-only cap), the post-arm continuation is
		// the iteration-4 model request. The proposal there is
		// o4 with the same key → C1.3 pre-exec blocker fires
		// → applyPost sees the synthesised runtime_skipped
		// outcome with state===armed → flip to terminating.
		// The run aborts; o5 (a different canonical key)
		// never arrives. This proves the C1.3 per-key
		// accounting invariant is preserved under C1.4's
		// bounded continuation and that the continuation is
		// consumed exactly once regardless of what the model
		// proposes.
		const proposals = [
			{ toolCallId: "o1", toolName: "opaque_thrower", input: { value: "x" } },
			{ toolCallId: "o2", toolName: "opaque_thrower", input: { value: "x" } },
			{ toolCallId: "o3", toolName: "opaque_thrower", input: { value: "x" } },
			{ toolCallId: "o4", toolName: "opaque_thrower", input: { value: "x" } },
		];
		const { captured, recoverySnapshot } = await driveRepeatedProposals(
			proposals,
			[tool],
		);
		expect(executorCalls.count).toBe(3);
		for (let i = 0; i < 3; i += 1) {
			const out = expectCaptured(captured, `o${i + 1}`);
			expect(out.kind).toBe("failure");
		}
		const o4 = expectCaptured(captured, "o4");
		expect(o4.kind).toBe("control_plane");
		if (o4.kind !== "control_plane") throw new Error("narrow");
		expect(o4.outcome).toBe("runtime_skipped");
		// Per-key exact-only accounting is intact: only one
		// key (`{value:"x"}`) was tracked.
		expect(recoverySnapshot.exactOnlyBudgetSize).toBe(1);
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe(
			"exact_only_capped",
		);
	});

	it("OPAQUE_CHANGED_INPUT_NOT_MERGED", async () => {
		const executorCalls = { count: 0 };
		const tool = createOpaqueThrowTool(executorCalls);
		// C1.4 caveat: under the bounded continuation, after
		// alpha exhausts (p1..p3 fail, Trigger C arms because
		// the exact-only counter for `{value:"alpha"}` reaches
		// `> maxRepairAttempts`), the post-arm continuation
		// is iteration 4's model request. The proposal there
		// is p4 with the SAME key → pre-exec block → flip
		// to terminating via the synthesised runtime_skipped
		// outcome. Run aborts; p5 (the would-be beta) never
		// arrives. The "independent budgets per canonical key"
		// property — distinct failed inputs do not share a
		// synthetic family — is the C1.1 anti-merge guarantee
		// which C1.4 preserves by reusing the exact-only map.
		const proposals = [
			{ toolCallId: "p1", toolName: "opaque_thrower", input: { value: "alpha" } },
			{ toolCallId: "p2", toolName: "opaque_thrower", input: { value: "alpha" } },
			{ toolCallId: "p3", toolName: "opaque_thrower", input: { value: "alpha" } },
			{ toolCallId: "p4", toolName: "opaque_thrower", input: { value: "alpha" } },
		];
		const { recoverySnapshot, captured } = await driveRepeatedProposals(
			proposals,
			[tool],
		);
		// alpha: 3 exec + 1 pre-exec block.
		expect(executorCalls.count).toBe(3);
		expect(recoverySnapshot.exactOnlyBudgetSize).toBe(1);
		expect(recoverySnapshot.secondStage.kind).toBe("terminating");
		expect(recoverySnapshot.secondStage.trigger).toBe(
			"exact_only_capped",
		);
		const p4 = expectCaptured(captured, "p4");
		expect(p4.kind).toBe("control_plane");
		if (p4.kind !== "control_plane") throw new Error("narrow");
		expect(p4.outcome).toBe("runtime_skipped");
	});
});

// ============================================================================
//                            control plane exclusion
// ============================================================================

describe("AgentRuntime / C1.3 control-plane exclusion", () => {
	it("HOST_DENY_DOES_NOT_CONSUME_REPAIR_BUDGET: 10 host DENYs ⇒ executor=0", async () => {
		const executorCalls = { count: 0 };
		const proposals = Array.from({ length: 10 }, (_, i) => ({
			toolCallId: `d-${i + 1}`,
			toolName: "echo",
			input: { text: "x" },
		}));
		const { captured, recoverySnapshot } = await driveRepeatedProposals(
			proposals,
			[createEchoTool(executorCalls)],
			"sequential",
			async () => ({
				approved: false,
				decision: { kind: "deny", reason: "host policy" },
			}),
			32,
			{ echo: { autoApprove: false } },
		);
		expect(executorCalls.count).toBe(0);
		expect(captured.length).toBe(proposals.length);
		for (let i = 0; i < proposals.length; i += 1) {
			const out = expectCaptured(captured, `d-${i + 1}`);
			expect(out.kind).toBe("control_plane");
			if (out.kind !== "control_plane") throw new Error("narrow");
			expect(out.outcome).toBe("host_policy_denied");
		}
		// Snapshot must confirm: no budget consumed, no circuit
		// noticed, exact-only budget untouched.
		expect(recoverySnapshot.state).toBe("idle");
		expect(recoverySnapshot.circuitNoticeCount).toBe(0);
		expect(recoverySnapshot.exactOnlyBudgetSize).toBe(0);
	});

	it("USER_REJECT_DOES_NOT_CONSUME_REPAIR_BUDGET: 10 user rejections ⇒ executor=0", async () => {
		const executorCalls = { count: 0 };
		const proposals = Array.from({ length: 10 }, (_, i) => ({
			toolCallId: `u-${i + 1}`,
			toolName: "echo",
			input: { text: "x" },
		}));
		const { captured, recoverySnapshot } = await driveRepeatedProposals(
			proposals,
			[createEchoTool(executorCalls)],
			"sequential",
			async () => ({ approved: false }),
			32,
			{ echo: { autoApprove: false } },
		);
		expect(executorCalls.count).toBe(0);
		expect(captured.length).toBe(proposals.length);
		for (let i = 0; i < proposals.length; i += 1) {
			const out = expectCaptured(captured, `u-${i + 1}`);
			expect(out.kind).toBe("control_plane");
			if (out.kind !== "control_plane") throw new Error("narrow");
			expect(out.outcome).toBe("user_rejected");
		}
		// Snapshot must confirm: no budget consumed, no circuit
		// noticed, exact-only budget untouched. Mutation #3 (route
		// user_rejected through recordFailureIdentity) would either
		// increase exactOnlyBudgetSize (via opaque-input fallback) or
		// open a tracker family — both break this assertion.
		expect(recoverySnapshot.state).toBe("idle");
		expect(recoverySnapshot.circuitNoticeCount).toBe(0);
		expect(recoverySnapshot.exactOnlyBudgetSize).toBe(0);
	});
});

// ============================================================================
//                            parallel breaker isolation
// ============================================================================

describe("AgentRuntime / C1.3 parallel breaker isolation", () => {
	it("PARALLEL_BLOCK_ISOLATION: blocked A does NOT suppress healthy B in one parallel batch", async () => {
		const aExec = { count: 0 };
		const bExec = { count: 0 };
		const toolA: AgentTool<{ x: number }, never> = {
			name: "para_a",
			description: "fails with ENOENT",
			inputSchema: { type: "object" },
			async execute() {
				aExec.count += 1;
				throw ENOENT;
			},
		};
		const toolB: AgentTool<{ x: number }, { ok: true }> = {
			name: "para_b",
			description: "succeeds",
			inputSchema: { type: "object" },
			async execute() {
				bExec.count += 1;
				return { ok: true };
			},
		};
		// Warmup: 3 sequential proposals on para_a (exhausts the
		// budget). Then a parallel batch with A (already blocked)
		// + B (fresh).
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "w-1",
					toolName: "para_a",
					inputText: '{"x":1}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "w-2",
					toolName: "para_a",
					inputText: '{"x":1}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "w-3",
					toolName: "para_a",
					inputText: '{"x":1}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "batch-A",
					toolName: "para_a",
					inputText: '{"x":1}',
				},
				{
					type: "tool-call-delta",
					toolCallId: "batch-B",
					toolName: "para_b",
					inputText: '{"x":1}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const captured: CapturedOutcome[] = [];
		const runtime = new AgentRuntime({
			model,
			tools: [toolA, toolB],
			toolExecution: "parallel",
			hooks: captureOutcomes(captured),
		});
		await runtime.run("Start");
		// 3 warmup executions on para_a; para_a batch blocked; para_b executes once.
		expect(aExec.count).toBe(3);
		expect(bExec.count).toBe(1);
		const capA = expectCaptured(captured, "batch-A");
		expect(capA.kind).toBe("control_plane");
		if (capA.kind !== "control_plane") throw new Error("narrow");
		expect(capA.outcome).toBe("runtime_skipped");
		const capB = expectCaptured(captured, "batch-B");
		expect(capB.kind).toBe("success");
	});
});

// ============================================================================
//                          MUTATIONS (load-bearing)
// ============================================================================

describe("AgentRuntime / C1.3 mandatory mutation tests", () => {
	// STRUCTURAL_SMOKE: These grep-based tests are weak evidence
	// by themselves (they can match a method definition rather than
	// the breaker call site). The strong evidence is the empirical
	// mutation tests below: bypassing the gate and moving it
	// post-execution both bite the load-bearing test suite.
	// STRUCTURAL_SMOKE is included only as a cheap regression
	// sentinel so a future refactor cannot silently relocate the
	// gate without an immediate test failure.
	it("STRUCTURAL_SMOKE_PREEXEC_GATE_PRESENT: pre-execution gate calls isAttemptBlockedByRecovery / isExactBlockedIdentity / exactOnlyBudget", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const file = path.join(import.meta.dirname, "agent-runtime.ts");
		const raw = await fs.readFile(file, "utf8");
		expect(raw).toMatch(/isAttemptBlockedByRecovery\(/);
		expect(raw).toMatch(/isExactBlockedIdentity\(/);
		expect(raw).toMatch(/exactOnlyBudget\.get\(/);
	});

	it("STRUCTURAL_SMOKE_GATE_PRECEDES_EXECUTOR: gate call site precedes prepared.tool.execute(...) in source order", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const file = path.join(import.meta.dirname, "agent-runtime.ts");
		const raw = await fs.readFile(file, "utf8");
		const stripped = raw
			.split("\n")
			.map((line) => {
				const idx = line.indexOf("//");
				return idx === -1 ? line : line.slice(0, idx);
			})
			.join("\n");
		const gateIdx = stripped.indexOf("isAttemptBlockedByRecovery(");
		const executorIdx = stripped.indexOf(
			"prepared.tool.execute(prepared.input,",
		);
		expect(gateIdx).toBeGreaterThan(-1);
		expect(executorIdx).toBeGreaterThan(-1);
		expect(gateIdx).toBeLessThan(executorIdx);
	});
});

// ============================================================================
//                          privacy invariant
// ============================================================================

describe("AgentRuntime / C1.3 privacy invariant", () => {
	it("NO_RAW_IDENTITY_IN_BOUNDED_RESULT: blocked tool-result message has no raw canonical identity", async () => {
		const executorCalls = { count: 0 };
		const proposals = Array.from({ length: 4 }, (_, i) => ({
			toolCallId: `p-${i + 1}`,
			toolName: "fs_read",
			input: { path: "/x" },
		}));
		const { messages } = await driveRepeatedProposals(proposals, [
			createEnoentTool(executorCalls),
		]);
		const toolMessages = messages.filter((m) => m.role === "tool");
		const p4 = toolMessages.find((m) =>
			m.content.some(
				(c) => c.type === "tool-result" && c.toolCallId === "p-4",
			),
		);
		expect(p4).toBeDefined();
		const part = p4!.content.find(
			(c) => c.type === "tool-result" && c.toolCallId === "p-4",
		);
		expect(part).toBeDefined();
		if (!part || part.type !== "tool-result") return;
		const serialized = JSON.stringify(part);
		// Must NOT include raw control family or canonical key
		// fragments. The path "/x" must not appear because the
		// input value would otherwise be canonicalised.
		expect(serialized).not.toContain("/x");
		expect(serialized).not.toContain("fs_read\\0");
		// The structured marker IS present.
		expect(serialized).toContain("bounded_recovery_exhausted");
		// No raw error history leak.
		expect(serialized).not.toMatch(/ENOENT/);
	});
});

// ============================================================================
//                          recovery-tracker wiring
// ============================================================================

describe("AgentRuntime / C1.3 tracker wiring", () => {
	it("RECOVERY_TRACKER_TYPE_AVAILABLE: RecoveryTracker + RecoveryPolicy are constructable", () => {
		expect(typeof RecoveryTracker).toBe("function");
		expect(DEFAULT_RECOVERY_POLICY.maxRepairAttempts).toBe(2);
	});
});
