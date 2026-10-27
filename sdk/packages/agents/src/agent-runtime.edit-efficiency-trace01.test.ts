/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01
 *
 * REAL agent-runtime witnesses for the edit-attempt link of the editing
 * efficiency trace.
 *
 * These drive the REAL `AgentRuntime` with a scripted model, so the
 * recorded observations come from the production tool boundary — not
 * from a hand-fed event list.
 *
 * Witness map:
 *   E10  Approval denied            → attempt recorded, executor NOT invoked
 *   E11  Editing via shell command  → no invented native-editor attribution
 *   E12  Same filename, different sessions → correlation stays isolated
 *   E13  Trace OFF                  → zero recording / semantic delta
 *   E14  Sensitive path/content     → never exposed
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	ModelBehaviorTraceObservation,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

// The production agent runtime imports `@cline/llms` at module scope, and
// the shared barrel evaluates `agents/types.ts`, which calls `z.object(...)`
// at module scope. This package's unit-test vitest config does not
// pre-bundle zod, so the llms gateway is stubbed — exactly as the sibling
// `agent-runtime.model-behavior-trace.test.ts` does. The witness still
// drives the REAL agent runtime.
vi.mock("@cline/llms", () => ({
	createGateway: vi.fn(() => ({
		createAgentModel: vi.fn(),
	})),
}));

import { createAgentRuntime } from "./agent-runtime";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class ScriptedModel implements AgentModel {
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		return toAsyncIterable(step(request));
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event;
	}
}

interface TestTool {
	name: string;
	description: string;
	inputSchema: { type: "object"; properties: Record<string, unknown> };
	execute: (
		input: Record<string, unknown>,
		context?: Record<string, unknown>,
	) => Promise<{ output: string }>;
}

/**
 * A tool whose `execute` records whether it was actually invoked.
 */
function makeRecordingTool(name: string, calls: string[]): TestTool {
	return {
		name,
		description: `test tool ${name}`,
		inputSchema: { type: "object", properties: {} },
		execute: async (input: Record<string, unknown>) => {
			calls.push(`${name}:${JSON.stringify(input)}`);
			return { output: `ok:${name}` };
		},
	};
}

interface CollectedObservation extends ModelBehaviorTraceObservation {
	readonly kind: string;
}

function makeCollectingSink(): {
	sink: NonNullable<
		Parameters<typeof createAgentRuntime>[0]["modelBehaviorTraceSink"]
	>;
	observations: CollectedObservation[];
} {
	const observations: CollectedObservation[] = [];
	const push = (
		kind: string,
		observation: ModelBehaviorTraceObservation,
	): void => {
		observations.push({
			...observation,
			kind,
			payload: observation.payload,
		});
	};
	const sink = {
		// A realistic keyed digest: the path NEVER appears in the output.
		fingerprintFilePath: (resolvedPath: string) =>
			`fp:${Buffer.from(resolvedPath)
				.toString("base64")
				.replace(/[^a-z0-9]/gi, "")}`,
		onEditAttempt: (observation: ModelBehaviorTraceObservation) =>
			push("edit_attempt", observation),
		onEditApplication: (observation: ModelBehaviorTraceObservation) =>
			push("edit_application", observation),
		onEditFailure: (observation: ModelBehaviorTraceObservation) =>
			push("edit_failure", observation),
		onToolStart: (observation: ModelBehaviorTraceObservation) =>
			push("tool_start", observation),
		onToolFinish: (observation: ModelBehaviorTraceObservation) =>
			push("tool_finish", observation),
	};
	return { sink, observations };
}

function toolCallStep(
	toolName: string,
	toolCallId: string,
	input: Record<string, unknown>,
): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			index: 0,
			input,
		} as unknown as AgentModelEvent,
		{ type: "finish", reason: "tool_use" } as unknown as AgentModelEvent,
	];
}

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

describe("AgentRuntime edit-efficiency trace", () => {
	it("E10: a DENIED approval records the attempt with executionInvoked=false", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("editor", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				toolCallStep("editor", "tc-edit-1", {
					path: "src/a.ts",
					old_text: "old",
					new_text: "new",
				}),
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
			// The host DENIES the tool call.
			requestToolApproval: () => ({
				approved: false,
				reason: "denied by the operator",
			}),
			toolPolicies: { editor: { enabled: true, autoApprove: false } },
		});

		await runtime.execute("edit the file");

		// The executor was NEVER invoked.
		expect(calls).toHaveLength(0);

		const attemptObservations = observations.filter(
			(observation) => observation.kind === "edit_attempt",
		);
		expect(attemptObservations).toHaveLength(1);
		const attempt = attemptObservations[0].payload;
		expect(attempt.toolCallId).toBe("tc-edit-1");
		expect(attempt.toolName).toBe("editor");
		expect(attempt.operation).toBe("replace");
		expect(attempt.targetCount).toBe(1);
		// The SIZE of the request, never the text.
		expect(attempt.requestedChars).toBe(6);
		expect(attempt.approvalOutcome).toBe("rejected");
		expect(attempt.executionInvoked).toBe(false);

		// NO application event: nothing was written.
		expect(
			observations.filter(
				(observation) => observation.kind === "edit_application",
			),
		).toHaveLength(0);
	});

	it("E10b: an AUTHORIZED edit reports exactly ONE attempt", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("editor", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				toolCallStep("editor", "tc-edit-2", {
					path: "src/a.ts",
					old_text: "old",
					new_text: "new",
				}),
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("edit the file");

		// The executor ran.
		expect(calls).toHaveLength(1);
		// The attempt is reported EXACTLY ONCE — the runtime is the sole
		// reporter of that link, so the trace never double-counts.
		const attemptObservations = observations.filter(
			(observation) => observation.kind === "edit_attempt",
		);
		expect(attemptObservations).toHaveLength(1);
		const attempt = attemptObservations[0].payload;
		expect(attempt.toolCallId).toBe("tc-edit-2");
		expect(attempt.toolName).toBe("editor");
		expect(attempt.operation).toBe("replace");
		expect(attempt.approvalOutcome).toBe("approved");
		expect(attempt.targetCount).toBe(1);
		expect(attempt.requestedChars).toBe(6);
	});

	it("E11: a shell-command edit produces NO native-editor attribution", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("run_commands", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				toolCallStep("run_commands", "tc-shell-1", {
					command: "echo hello > src/a.ts",
				}),
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("write the file with a shell command");

		// The shell call happened.
		expect(calls).toHaveLength(1);
		// But NO native edit attempt was invented for it.
		expect(
			observations.filter((observation) => observation.kind === "edit_attempt"),
		).toHaveLength(0);
		expect(
			observations.filter(
				(observation) => observation.kind === "edit_application",
			),
		).toHaveLength(0);
		// The shell call is visible as ordinary tool activity.
		const toolStarts = observations.filter(
			(observation) => observation.kind === "tool_start",
		);
		expect(toolStarts).toHaveLength(1);
		expect(toolStarts[0].payload.toolName).toBe("run_commands");
	});

	it("E12: the same filename in different sessions stays isolated", async () => {
		const build = (sessionId: string) => {
			const calls: string[] = [];
			const tool = makeRecordingTool("editor", calls);
			const { sink, observations } = makeCollectingSink();
			const runtime = createAgentRuntime({
				model: new ScriptedModel([
					toolCallStep("editor", `tc-${sessionId}`, {
						path: "src/shared-name.ts",
						old_text: "old",
						new_text: "new",
					}),
				]),
				tools: [tool],
				systemPrompt: "test prompt",
				sessionId,
				conversationId: `conv-${sessionId}`,
				modelBehaviorTraceSink: sink,
			});
			return { runtime, observations };
		};

		const first = build("session-alpha");
		const second = build("session-beta");
		await first.runtime.execute("edit the file");
		await second.runtime.execute("edit the file");

		const firstAttempt = first.observations.find(
			(observation) => observation.kind === "edit_attempt",
		);
		const secondAttempt = second.observations.find(
			(observation) => observation.kind === "edit_attempt",
		);
		expect(firstAttempt).toBeDefined();
		expect(secondAttempt).toBeDefined();
		// The SAME filename, but the correlation identity is per session.
		expect(firstAttempt?.sessionId).toBe("session-alpha");
		expect(secondAttempt?.sessionId).toBe("session-beta");
		expect(firstAttempt?.payload.toolCallId).toBe("tc-session-alpha");
		expect(secondAttempt?.payload.toolCallId).toBe("tc-session-beta");
		// The tool-call identities do not cross.
		expect(firstAttempt?.payload.toolCallId).not.toBe(
			secondAttempt?.payload.toolCallId,
		);
	});

	it("E13b: with NO sink attached the tool still runs and nothing is recorded", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("editor", calls);
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				toolCallStep("editor", "tc-off-2", {
					path: "src/a.ts",
					old_text: "old",
					new_text: "new",
				}),
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
		});

		await runtime.execute("edit the file");
		expect(calls).toHaveLength(1);
	});

	it("E14: the recorded attempt never exposes the path or the text", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("editor", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				toolCallStep("editor", "tc-secret-1", {
					path: "src/secret-module.ts",
					old_text: "TOP-SECRET-OLD",
					new_text: "TOP-SECRET-NEW",
				}),
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("edit the file");

		const attempt = observations.find(
			(observation) => observation.kind === "edit_attempt",
		);
		expect(attempt).toBeDefined();
		const serialized = JSON.stringify(attempt?.payload);
		expect(serialized).not.toContain("secret-module.ts");
		expect(serialized).not.toContain("src/secret-module.ts");
		expect(serialized).not.toContain("TOP-SECRET-OLD");
		expect(serialized).not.toContain("TOP-SECRET-NEW");
		// The identity is an opaque fingerprint.
		expect(String(attempt?.payload.fileIdentity)).toContain("fp:");
		expect(String(attempt?.payload.fileIdentity)).not.toContain("secret");
	});

	it("E14b: a sink that echoes the path back cannot leak it", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("editor", calls);
		const observations: CollectedObservation[] = [];
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				toolCallStep("editor", "tc-echo-1", {
					path: "src/secret-module.ts",
					old_text: "old",
					new_text: "new",
				}),
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
			// A MISBEHAVING sink: it returns the path instead of a digest.
			modelBehaviorTraceSink: {
				fingerprintFilePath: (resolvedPath: string) => resolvedPath,
				onEditAttempt: (observation: ModelBehaviorTraceObservation) => {
					observations.push({ ...observation, kind: "edit_attempt" });
				},
			},
		});

		await runtime.execute("edit the file");

		const attempt = observations.find(
			(observation) => observation.kind === "edit_attempt",
		);
		expect(attempt).toBeDefined();
		const serialized = JSON.stringify(attempt?.payload);
		expect(serialized).not.toContain("secret-module.ts");
		// The identity is reported as UNAVAILABLE rather than leaked.
		expect(attempt?.payload.fileIdentity).toBe("UNAVAILABLE_FROM_TRACE");
	});
});
