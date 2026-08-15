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
		const proposals = Array.from({ length: 6 }, (_, i) => ({
			toolCallId: `p-${i + 1}`,
			toolName: "fs_read",
			input: { path: "/missing" },
		}));
		const { captured, recoverySnapshot } = await driveRepeatedProposals(
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
		for (let i = 3; i < 6; i += 1) {
			const out = expectCaptured(captured, `p-${i + 1}`);
			expect(out.kind, `proposal ${i + 1} kind`).toBe("control_plane");
			if (out.kind !== "control_plane") throw new Error("narrow");
			expect(out.outcome).toBe("runtime_skipped");
		}
		// The first intercepted attempt transitioned warning →
		// circuit_open exactly once. Repeated interceptions stay at
		// circuit_open with the same notice count.
		expect(recoverySnapshot.state).toBe("circuit_open");
		expect(recoverySnapshot.circuitNoticeCount).toBe(1);
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
		const proposals = Array.from({ length: 8 }, (_, i) => ({
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
			8 - (1 + DEFAULT_RECOVERY_POLICY.maxRepairAttempts),
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
			{ toolCallId: "e", toolName: "fs_read", input: { path: "/x" } },
		];
		const { captured } = await driveRepeatedProposals(proposals, [
			createEnoentTool(executorCalls),
		]);
		expect(executorCalls.count).toBe(4);
		const d = expectCaptured(captured, "d");
		expect(d.kind).toBe("failure");
		const e = expectCaptured(captured, "e");
		expect(e.kind).toBe("control_plane");
		if (e.kind !== "control_plane") throw new Error("narrow");
		expect(e.outcome).toBe("runtime_skipped");
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
		const proposals = [
			{ toolCallId: "a1", toolName: "tool_a", input: { x: 1 } },
			{ toolCallId: "a2", toolName: "tool_a", input: { x: 1 } },
			{ toolCallId: "a3", toolName: "tool_a", input: { x: 1 } },
			{ toolCallId: "a4", toolName: "tool_a", input: { x: 1 } },
			{ toolCallId: "b1", toolName: "tool_b", input: { x: 1 } },
		];
		const { captured } = await driveRepeatedProposals(proposals, [
			toolA,
			toolB,
		]);
		expect(aExec.count).toBe(3);
		expect(bExec.count).toBe(1);
		const b1 = expectCaptured(captured, "b1");
		expect(b1.kind).toBe("success");
	});
});

// ============================================================================
//                  unknown-tool / executor-throw boundary cases
// ============================================================================

describe("AgentRuntime / C1.3 unknown-tool & TBCE boundary", () => {
	it("UNKNOWN_TOOL_BOUNDED: unknown-tool proposals never invoke a real executor", async () => {
		const proposals = Array.from({ length: 5 }, (_, i) => ({
			toolCallId: `u-${i + 1}`,
			toolName: "ghost_tool",
			input: { i },
		}));
		const executorCalls = { count: 0 };
		const { captured } = await driveRepeatedProposals(proposals, [
			createEchoTool(executorCalls),
		]);
		expect(executorCalls.count).toBe(0);
		for (let i = 0; i < proposals.length; i += 1) {
			const out = expectCaptured(captured, `u-${i + 1}`);
			expect(out.kind).toBe("failure");
		}
	});

	it("OPAQUE_EXACT_ONLY", async () => {
		const executorCalls = { count: 0 };
		const tool = createOpaqueThrowTool(executorCalls);
		const proposals = [
			{ toolCallId: "o1", toolName: "opaque_thrower", input: { value: "x" } },
			{ toolCallId: "o2", toolName: "opaque_thrower", input: { value: "x" } },
			{ toolCallId: "o3", toolName: "opaque_thrower", input: { value: "x" } },
			{ toolCallId: "o4", toolName: "opaque_thrower", input: { value: "x" } },
			{ toolCallId: "o5", toolName: "opaque_thrower", input: { value: "y" } },
			{ toolCallId: "o6", toolName: "opaque_thrower", input: { value: "x" } },
		];
		const { captured } = await driveRepeatedProposals(proposals, [tool]);
		expect(executorCalls.count).toBe(4);
		const o4 = expectCaptured(captured, "o4");
		expect(o4.kind).toBe("control_plane");
		const o5 = expectCaptured(captured, "o5");
		expect(o5.kind).toBe("failure");
		const o6 = expectCaptured(captured, "o6");
		expect(o6.kind).toBe("control_plane");
	});

	it("OPAQUE_CHANGED_INPUT_NOT_MERGED", async () => {
		const executorCalls = { count: 0 };
		const tool = createOpaqueThrowTool(executorCalls);
		const proposals = [
			{ toolCallId: "p1", toolName: "opaque_thrower", input: { value: "alpha" } },
			{ toolCallId: "p2", toolName: "opaque_thrower", input: { value: "alpha" } },
			{ toolCallId: "p3", toolName: "opaque_thrower", input: { value: "alpha" } },
			{ toolCallId: "p4", toolName: "opaque_thrower", input: { value: "alpha" } },
			{ toolCallId: "p5", toolName: "opaque_thrower", input: { value: "beta" } },
			{ toolCallId: "p6", toolName: "opaque_thrower", input: { value: "beta" } },
			{ toolCallId: "p7", toolName: "opaque_thrower", input: { value: "beta" } },
			{ toolCallId: "p8", toolName: "opaque_thrower", input: { value: "beta" } },
		];
		await driveRepeatedProposals(proposals, [tool]);
		// alpha: 3 exec + 1 blocked; beta: 3 exec + 1 blocked.
		expect(executorCalls.count).toBe(6);
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
	it("MUTATION_PREEXEC_CHECK_REMOVED_bites: structural link to isAttemptBlockedIdentity is present", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const file = path.join(import.meta.dirname, "agent-runtime.ts");
		const raw = await fs.readFile(file, "utf8");
		expect(raw).toMatch(/isAttemptBlockedByRecovery\(/);
		expect(raw).toMatch(/isExactBlockedIdentity\(/);
		expect(raw).toMatch(/exactOnlyBudget\.get\(/);
	});

	it("MUTATION_CHECK_MOVED_POSTEXEC_bites: gate precedes the awaited tool.execute(...)", async () => {
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
