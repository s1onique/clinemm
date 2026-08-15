/**
 * C1.2 AgentRuntime integration tests — observable production outcome.
 *
 * Every assertion in this file targets the value that
 * `AgentRuntime.executePreparedTool` produced at runtime, captured via
 * the `onToolRuntimeOutcome` hook. The integration tests do NOT call
 * `classifyToolRuntimeOutcome` themselves — they only drive the real
 * runtime and observe its (single) emitted outcome per call.
 *
 * What this proves that the previous test file did not:
 *   - The runtime constructs `RuntimeOutcomeEvidence` correctly from
 *     real boundary values (`toolExecutionInvoked`, `thrownError`,
 *     `controlPlaneOutcome`, `result`, `skipReason`, `inputParseError`).
 *   - The runtime calls the classifier with that evidence.
 *   - The runtime captures the resulting `ToolRuntimeOutcome` locally.
 *   - The runtime surfaces it through the observable hook.
 *
 * If the production `classifyToolRuntimeOutcome(...)` call were
 * removed from `agent-runtime.ts`, every test below would fail because
 * the hook would never fire. The dedicated
 * `MUTATION_classifier_call_removed_bites` test asserts that explicit
 * bit.
 */
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
	AgentToolResult,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolRuntimeOutcome,
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

// ---- scripted model helper -------------------------------------------

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
		if (!step) throw new Error("No scripted model step available");
		const events = step(request);
		return (async function* () {
			for await (const ev of events) yield ev;
		})();
	}
}

// ---- observable hook capture ----------------------------------------

interface CapturedOutcome {
	toolCallId: string;
	toolName: string;
	outcome: ToolRuntimeOutcome;
}

/**
 * Build a hook bag that captures the production `ToolRuntimeOutcome`
 * fired by `onToolRuntimeOutcome`. The captured value is the SINGLE
 * assertion target for every test in this file.
 */
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

// ---- shared errors --------------------------------------------------

const enoentError = Object.assign(new Error("ENOENT: not found"), {
	code: "ENOENT" as const,
});
const opaqueError = new Error("opaque internal failure");

// ---- tool factories --------------------------------------------------

function createEchoTool(): AgentTool<{ text: string }, { echoed: string }> {
	return {
		name: "echo",
		description: "Echoes input back",
		inputSchema: { type: "object" },
		async execute(input) {
			return { echoed: input.text };
		},
	};
}

function createEnoentTool(): AgentTool<{ path: string }, never> {
	return {
		name: "fs_read",
		description: "Throws ENOENT",
		inputSchema: { type: "object" },
		async execute() {
			throw enoentError;
		},
	};
}

function createOpaqueThrowTool(): AgentTool<Record<string, never>, never> {
	return {
		name: "throwing_opaque",
		description: "Throws opaque",
		inputSchema: { type: "object" },
		async execute() {
			throw opaqueError;
		},
	};
}

function createRunningStatusTool(): AgentTool<
	{ jobId: string },
	Array<{ ok: true; state: "running"; jobId: string }>
> {
	return {
		name: "command_status",
		description: "TBCE-shaped running status",
		inputSchema: { type: "object" },
		async execute(input) {
			return [{ ok: true, state: "running", jobId: input.jobId }];
		},
	};
}

function createCancelSuccessTool(): AgentTool<
	{ jobId: string },
	Array<{ ok: true; state: "cancelled"; jobId: string }>
> {
	return {
		name: "cancel_command",
		description: "TBCE-shaped cancel success",
		inputSchema: { type: "object" },
		async execute(input) {
			return [{ ok: true, state: "cancelled", jobId: input.jobId }];
		},
	};
}

// ---- driver ----------------------------------------------------------

interface DriveResult {
	messages: AgentMessage[];
	captured: CapturedOutcome[];
}

async function driveSingleToolCall(opts: {
	modelToolCall: { toolCallId: string; toolName: string; input: unknown };
	tools: AgentTool<any, any>[];
	toolPolicies?: Record<string, { autoApprove?: boolean; enabled?: boolean }>;
	requestApproval?: (req: ToolApprovalRequest) => Promise<ToolApprovalResult>;
	inputText?: string;
}): Promise<DriveResult> {
	const captured: CapturedOutcome[] = [];
	const inputText = opts.inputText ?? JSON.stringify(opts.modelToolCall.input);
	const model = new ScriptedModel([
		() => [
			{
				type: "tool-call-delta",
				toolCallId: opts.modelToolCall.toolCallId,
				toolName: opts.modelToolCall.toolName,
				inputText,
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
		tools: opts.tools,
		hooks: captureOutcomes(captured),
		toolPolicies: opts.toolPolicies as never,
		requestToolApproval: opts.requestApproval,
	});
	const result = await runtime.run("Start");
	return { messages: result.messages, captured };
}

function expectCapturedOne(
	captured: CapturedOutcome[],
	toolCallId: string,
): ToolRuntimeOutcome {
	const match = captured.find((c) => c.toolCallId === toolCallId);
	expect(match, `no captured outcome for ${toolCallId}`).toBeDefined();
	return match!.outcome;
}

// ---- test matrix ----------------------------------------------------

describe("AgentRuntime / C1.2 observable outcome truth table", () => {
	// A. Unknown tool -------------------------------------------------
	it("AGENT_RUNTIME_UNKNOWN_TOOL_CLASSIFIED: ghost_tool ⇒ tool_not_found", async () => {
		const { captured } = await driveSingleToolCall({
			modelToolCall: { toolCallId: "u-1", toolName: "ghost_tool", input: {} },
			tools: [createEchoTool()],
		});
		const out = expectCapturedOne(captured, "u-1");
		expect(out.kind).toBe("failure");
		if (out.kind !== "failure") throw new Error("expected failure");
		expect(out.failureClass).toBe("tool_not_found");
		expect(out.stableCode).toBe("tool:not_found");
		expect(out.familyEligible).toBe(true);
		expect(out.familyConfidence).toBe("structured");
	});

	// B. Parser/input failure ----------------------------------------
	it("AGENT_RUNTIME_INPUT_INVALID_NOT_INVOKED: malformed input ⇒ tool_input_invalid, not invoked", async () => {
		// Supply malformed JSON so the parser rejects the input. The
		// runtime must NOT invoke the executor; it must produce a
		// tool_input_invalid classification.
		const { captured } = await driveSingleToolCall({
			modelToolCall: {
				toolCallId: "p-1",
				toolName: "echo",
				input: {},
			},
			tools: [createEchoTool()],
			inputText: "{not-json",
		});
		const out = expectCapturedOne(captured, "p-1");
		expect(out.kind).toBe("failure");
		if (out.kind !== "failure") throw new Error("expected failure");
		expect(out.failureClass).toBe("tool_input_invalid");
		expect(out.familyEligible).toBe(false);
		expect(out.familyConfidence).toBe("fallback");
	});

	// C. Generic hook/policy skip ------------------------------------
	it("AGENT_RUNTIME_RUNTIME_SKIPPED_EXCLUDED: policy disabled ⇒ runtime_skipped", async () => {
		const { captured } = await driveSingleToolCall({
			modelToolCall: {
				toolCallId: "s-1",
				toolName: "echo",
				input: { text: "x" },
			},
			tools: [createEchoTool()],
			toolPolicies: {
				echo: { enabled: false },
			},
		});
		const out = expectCapturedOne(captured, "s-1");
		expect(out.kind).toBe("control_plane");
		if (out.kind !== "control_plane") throw new Error("expected control_plane");
		expect(out.outcome).toBe("runtime_skipped");
	});

	// D. Hard host DENY (policy autoApprove=false + decision.kind=deny) -----
	it("AGENT_RUNTIME_HOST_DENY_OUTRANKS: host_policy_denied ⇒ control_plane", async () => {
		const { captured } = await driveSingleToolCall({
			modelToolCall: {
				toolCallId: "d-1",
				toolName: "echo",
				input: { text: "x" },
			},
			tools: [createEchoTool()],
			toolPolicies: {
				echo: { autoApprove: false },
			},
			// Host DENY: approval callback returns a structured decision
			// with kind === "deny" — the C1.2 control-plane mapper
			// recognizes this as host_policy_denied (Priority 1).
			requestApproval: async () => ({
				approved: false,
				decision: { kind: "deny", reason: "host policy forbids this tool" },
			}),
		});
		const out = expectCapturedOne(captured, "d-1");
		expect(out.kind).toBe("control_plane");
		if (out.kind !== "control_plane") throw new Error("expected control_plane");
		expect(out.outcome).toBe("host_policy_denied");
	});

	// E. User rejection ----------------------------------------------
	it("AGENT_RUNTIME_USER_REJECT_OUTRANKS: user_rejected ⇒ control_plane", async () => {
		const { captured } = await driveSingleToolCall({
			modelToolCall: {
				toolCallId: "r-1",
				toolName: "echo",
				input: { text: "x" },
			},
			tools: [createEchoTool()],
			toolPolicies: {
				echo: { autoApprove: false },
			},
			// User reject: approval callback returns { approved: false }
			// WITHOUT a decision.kind === "deny" — the C1.2 control-plane
			// mapper classifies this as user_rejected (Priority 1).
			requestApproval: async () => ({ approved: false }),
		});
		const out = expectCapturedOne(captured, "r-1");
		expect(out.kind).toBe("control_plane");
		if (out.kind !== "control_plane") throw new Error("expected control_plane");
		expect(out.outcome).toBe("user_rejected");
	});

	// F. ENOENT -------------------------------------------------------
	it("AGENT_RUNTIME_EXEC_ENOENT: ENOENT throw ⇒ tool_execution_error/ENOENT/structured/eligible", async () => {
		const { captured } = await driveSingleToolCall({
			modelToolCall: {
				toolCallId: "e-1",
				toolName: "fs_read",
				input: { path: "/missing" },
			},
			tools: [createEnoentTool()],
		});
		const out = expectCapturedOne(captured, "e-1");
		expect(out.kind).toBe("failure");
		if (out.kind !== "failure") throw new Error("expected failure");
		expect(out.failureClass).toBe("tool_execution_error");
		expect(out.stableCode).toBe("ENOENT");
		expect(out.familyEligible).toBe(true);
		expect(out.familyConfidence).toBe("structured");
	});

	// G. Opaque throw -------------------------------------------------
	it("AGENT_RUNTIME_EXEC_OPAQUE: opaque throw ⇒ unknown/fallback/ineligible", async () => {
		const { captured } = await driveSingleToolCall({
			modelToolCall: {
				toolCallId: "o-1",
				toolName: "throwing_opaque",
				input: {},
			},
			tools: [createOpaqueThrowTool()],
		});
		const out = expectCapturedOne(captured, "o-1");
		expect(out.kind).toBe("failure");
		if (out.kind !== "failure") throw new Error("expected failure");
		expect(out.failureClass).toBe("tool_execution_error");
		expect(out.stableCode).toBe("unknown");
		expect(out.familyConfidence).toBe("fallback");
		expect(out.familyEligible).toBe(false);
	});

	// H. Success ------------------------------------------------------
	it("AGENT_RUNTIME_SUCCESS: executor runs ⇒ success", async () => {
		const { captured } = await driveSingleToolCall({
			modelToolCall: {
				toolCallId: "ok-1",
				toolName: "echo",
				input: { text: "hi" },
			},
			tools: [createEchoTool()],
		});
		const out = expectCapturedOne(captured, "ok-1");
		expect(out.kind).toBe("success");
	});

	// I. TBCE command_status / running -------------------------------
	it("AGENT_RUNTIME_TBCE_RUNNING_IS_SUCCESS: running status ⇒ tool success", async () => {
		const { captured } = await driveSingleToolCall({
			modelToolCall: {
				toolCallId: "r-1",
				toolName: "command_status",
				input: { jobId: "j-1" },
			},
			tools: [createRunningStatusTool()],
		});
		const out = expectCapturedOne(captured, "r-1");
		expect(out.kind).toBe("success");
	});

	// J. cancel_command success ---------------------------------------
	it("AGENT_RUNTIME_CANCEL_COMMAND_SUCCESS: cancel succeeds ⇒ tool success", async () => {
		const { captured } = await driveSingleToolCall({
			modelToolCall: {
				toolCallId: "c-1",
				toolName: "cancel_command",
				input: { jobId: "j-2" },
			},
			tools: [createCancelSuccessTool()],
		});
		const out = expectCapturedOne(captured, "c-1");
		expect(out.kind).toBe("success");
	});
});

// ---- parallel isolation (closure plan §15) ---------------------------

describe("AgentRuntime / C1.2 parallel outcome isolation", () => {
	it("TWO_PARALLEL_CALLS_PRODUCE_INDEPENDENT_OUTCOMES: A=success, B=failure, no cross-contamination", async () => {
		const captured: CapturedOutcome[] = [];
		const model = new ScriptedModel([
			// Single step emits two parallel tool calls.
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "A",
					toolName: "echo",
					inputText: '{"text":"hi"}',
				},
				{
					type: "tool-call-delta",
					toolCallId: "B",
					toolName: "throwing_opaque",
					inputText: "{}",
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
			tools: [createEchoTool(), createOpaqueThrowTool()],
			toolExecution: "parallel",
			hooks: captureOutcomes(captured),
		});
		const result = await runtime.run("Start");

		// Two captured outcomes, keyed by toolCallId. The runtime must
		// produce ONE outcome per call, not aggregate.
		expect(captured).toHaveLength(2);
		const a = expectCapturedOne(captured, "A");
		const b = expectCapturedOne(captured, "B");
		expect(a.kind).toBe("success");
		expect(b.kind).toBe("failure");
		if (b.kind !== "failure") throw new Error("expected failure for B");
		expect(b.failureClass).toBe("tool_execution_error");
		expect(b.familyEligible).toBe(false);
		// The model-facing messages still match the truth.
		expect(result.messages.find((m) => m.role === "tool")).toBeDefined();
	});
});

// ---- runtime abort (closure plan §6: runtime_aborted outranks throw) ----

describe("AgentRuntime / C1.2 runtime abort classification", () => {
	it("runtime_aborted outranks executor throw when abort signal triggers mid-execute", async () => {
		const captured: CapturedOutcome[] = [];
		const runtime = new AgentRuntime({
			model: new ScriptedModel([
				() => [
					{
						type: "tool-call-delta",
						toolCallId: "ab-1",
						toolName: "abortable",
						inputText: "{}",
					},
					{ type: "finish", reason: "tool-calls" },
				],
				() => [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				],
			]),
			tools: [
				{
					name: "abortable",
					description: "Throws AbortError when aborted",
					inputSchema: { type: "object" },
					async execute(_input, ctx) {
						if (!ctx.signal) throw new Error("signal missing");
						await new Promise<void>((resolve, reject) => {
							ctx.signal!.addEventListener(
								"abort",
								() => {
									const err = new Error("aborted");
									err.name = "AbortError";
									reject(err);
								},
								{ once: true },
							);
							setTimeout(resolve, 10_000);
						});
						return { ok: true };
					},
				},
			],
			hooks: captureOutcomes(captured),
		});
		const runPromise = runtime.run("Start");
		await new Promise((r) => setTimeout(r, 30));
		runtime.abort("user cancelled during execution");
		await runPromise.catch(() => undefined);

		const out = expectCapturedOne(captured, "ab-1");
		expect(out.kind).toBe("control_plane");
		if (out.kind !== "control_plane") throw new Error("expected control_plane");
		expect(out.outcome).toBe("runtime_aborted");
	});
});

// ---- regression: runtime does NOT consult RecoveryTracker (C1.2) ----

describe("AgentRuntime / C1.2 isolation", () => {
	it("NO_RECOVERY_TRACKER_RUNTIME_IMPORT: agent-runtime.ts never references RecoveryTracker", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const file = path.join(import.meta.dirname, "agent-runtime.ts");
		const raw = await fs.readFile(file, "utf8");
		const stripped = raw
			.split("\n")
			.map((line) => {
				const idx = line.indexOf("//");
				if (idx === -1) return line;
				let inStr: string | null = null;
				let inTmpl = false;
				for (let i = 0; i < line.length; i += 1) {
					const ch = line[i];
					if (inStr === null && !inTmpl && (ch === '"' || ch === "'")) {
						inStr = ch;
						continue;
					}
					if (inStr === '"' && ch === "\\" && i + 1 < line.length) {
						i += 1;
						continue;
					}
					if (inStr !== null && ch === inStr) {
						inStr = null;
						continue;
					}
					if (inStr === null && ch === "`") {
						inTmpl = !inTmpl;
					}
				}
				if (inStr !== null || inTmpl) return line;
				return line.slice(0, idx);
			})
			.join("\n");
		// Code-level references only — not docstrings or comments.
		// (.). is a MemberExpression target; (*) is an import/path mention.
		expect(stripped).not.toMatch(/(^|[^\w])RecoveryTracker\s*\(/);
		expect(stripped).not.toMatch(/(^|[^\w])recordFailureIdentity\s*\(/);
		expect(stripped).not.toMatch(/(^|[^\w])isExactBlockedIdentity\s*\(/);
		expect(stripped).not.toMatch(/(^|[^\w])recordBlockedAttemptIdentity\s*\(/);
		expect(stripped).not.toMatch(/(^|[^\w])isRecoverableToolFailure\s*\(/);
	});

	// MANDATED MUTATION proof: deleting the production classifier call
	// must break the integration tests. We verify the structural link
	// is present here: the production wiring path *is* the path that
	// surfaces the outcome. If the agent-runtime.ts stopped calling
	// classifyToolRuntimeOutcome, this test would fail at the source
	// grep level.
	it("MUTATION_classifier_call_removed_bites: agent-runtime.ts calls classifyToolRuntimeOutcome at the post-execute seam", async () => {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const file = path.join(import.meta.dirname, "agent-runtime.ts");
		const raw = await fs.readFile(file, "utf8");
		// Production wiring must call classifyToolRuntimeOutcome at the
		// post-execute seam. If the production call is removed, the
		// observable hook will never fire (the mutation bites).
		expect(raw).toMatch(/classifyToolRuntimeOutcome\(/);
		// And the hook fire must come AFTER the classifier call.
		const classifierIdx = raw.indexOf("classifyToolRuntimeOutcome(");
		const hookIdx = raw.indexOf("notifyToolRuntimeOutcome(");
		expect(hookIdx).toBeGreaterThan(classifierIdx);
	});
});
