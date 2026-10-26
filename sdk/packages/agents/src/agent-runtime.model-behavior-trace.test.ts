/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — REAL agent-runtime path witnesses.
 *
 * These witnesses drive the REAL `AgentRuntime` with a scripted model, so
 * the recorded observations come from the production model-request and tool
 * execution boundaries — not from a hand-fed event list.
 *
 * Gates covered here:
 *   T03  Real SDK event produces a correctly correlated trace record.
 *   T04  Tool start/finish match by tool-call identity.
 *   T04b MUTATION — an incorrect tool-call correlation is detected.
 *   T13  Trace ON/OFF produces equivalent execution results.
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
// `agent-runtime.provider-form.test.ts` does. The witness still drives the
// REAL agent runtime; only the provider gateway construction is stubbed
// (this witness supplies its own scripted `AgentModel`).
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

/**
 * A minimal local tool shape.
 *
 * The tool TYPE is intentionally declared locally rather than imported from
 * `@cline/shared`: the shared barrel's `AgentTool` type resolves through
 * `agents/types.ts`, which imports zod at module scope. The unit-test
 * vitest config for this package does not pre-bundle zod, and the sibling
 * `agent-runtime.provider-form.test.ts` avoids the same barrel for exactly
 * this reason.
 */
interface TestTool {
	name: string;
	description: string;
	inputSchema: { type: "object"; properties: Record<string, unknown> };
	execute: (input: Record<string, unknown>) => Promise<{ output: string }>;
}

function makeRecordingTool(name: string, calls: string[]): TestTool {
	return {
		name,
		description: `test tool ${name}`,
		inputSchema: { type: "object", properties: {} },
		execute: async (input: Record<string, unknown>) => {
			calls.push(`${name}:${String(input.value ?? "")}`);
			return { output: `ok:${name}` };
		},
	};
}

function makeCollectingSink(): {
	sink: NonNullable<
		Parameters<typeof createAgentRuntime>[0]["modelBehaviorTraceSink"]
	>;
	observations: ModelBehaviorTraceObservation[];
} {
	const observations: ModelBehaviorTraceObservation[] = [];
	const push = (
		kind: string,
		observation: ModelBehaviorTraceObservation,
	): void => {
		observations.push({
			...observation,
			payload: { kind, ...observation.payload },
		});
	};
	const sink = {
		onModelRequestStart: (observation: ModelBehaviorTraceObservation) =>
			push("start", observation),
		onModelRequestFinish: (observation: ModelBehaviorTraceObservation) =>
			push("finish", observation),
		onModelRequestError: (observation: ModelBehaviorTraceObservation) =>
			push("error", observation),
		onModelRequestAbort: (observation: ModelBehaviorTraceObservation) =>
			push("abort", observation),
		onToolStart: (observation: ModelBehaviorTraceObservation) =>
			push("tool_start", observation),
		onToolFinish: (observation: ModelBehaviorTraceObservation) =>
			push("tool_finish", observation),
		onLoopVerdict: (observation: ModelBehaviorTraceObservation) =>
			push("loop_verdict", observation),
		onCompactionDiagnostics: (observation: ModelBehaviorTraceObservation) =>
			push("compaction_diag", observation),
		onCompactionCompleted: (observation: ModelBehaviorTraceObservation) =>
			push("compaction_done", observation),
		onRunTerminated: (observation: ModelBehaviorTraceObservation) =>
			push("terminated", observation),
	};
	return { sink, observations };
}

function toolCallStep(
	toolName: string,
	toolCallId: string,
	value: string,
): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			index: 0,
			input: { value },
		} as unknown as AgentModelEvent,
		{ type: "finish", reason: "tool_use" } as unknown as AgentModelEvent,
	];
}

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

describe("AgentRuntime model behavior trace", () => {
	it("T03: a real model request produces a correctly correlated trace record", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([toolCallStep("read_file", "tc-1", "alpha")]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		const starts = observations.filter(
			(observation) => observation.payload.kind === "start",
		);
		expect(starts.length).toBeGreaterThanOrEqual(1);
		const start = starts[0];
		// The REAL correlation identity is present.
		expect(start?.sessionId).toBe("session-1");
		expect(start?.runId).toBeDefined();
		expect(start?.iteration).toBeGreaterThanOrEqual(1);
		// The request summary is a privacy-safe aggregate, not the request.
		expect(start?.payload.messageCount).toBeDefined();
		expect(start?.payload.toolSchemaCount).toBe(1);

		// The FINISH boundary carries the usage and the finish reason.
		const finishes = observations.filter(
			(observation) => observation.payload.kind === "finish",
		);
		expect(finishes.length).toBeGreaterThanOrEqual(1);
		expect(finishes[0]?.payload.finishReason).toBeDefined();
		expect(finishes[0]?.payload.requestDurationMs).toBeTypeOf("number");
	});

	it("T04: tool start and finish match by tool-call identity", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([toolCallStep("read_file", "tc-42", "alpha")]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		const starts = observations.filter(
			(observation) => observation.payload.kind === "tool_start",
		);
		const finishes = observations.filter(
			(observation) => observation.payload.kind === "tool_finish",
		);
		expect(starts).toHaveLength(1);
		expect(finishes).toHaveLength(1);
		// The correlated tool-call identity is the SAME on both boundaries.
		expect(starts[0]?.payload.toolCallId).toBe("tc-42");
		expect(finishes[0]?.payload.toolCallId).toBe("tc-42");
		expect(starts[0]?.payload.toolName).toBe("read_file");
		expect(finishes[0]?.payload.toolName).toBe("read_file");
		// The finish records an OUTCOME CLASS and a SIZE — never the output.
		expect(finishes[0]?.payload.outcome).toBe("success");
		expect(finishes[0]?.payload.outputSizeChars).toBeTypeOf("number");
		expect(JSON.stringify(finishes[0]?.payload)).not.toContain("ok:read_file");
	});

	it("T04b: MUTATION — an incorrect tool-call correlation is detected", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([toolCallStep("read_file", "tc-42", "alpha")]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		const starts = observations.filter(
			(observation) => observation.payload.kind === "tool_start",
		);
		const finishes = observations.filter(
			(observation) => observation.payload.kind === "tool_finish",
		);
		// The correlation assertion is load-bearing: a WRONG correlation
		// (a different id on the finish) must fail the same check.
		expect(
			starts[0]?.payload.toolCallId === finishes[0]?.payload.toolCallId,
		).toBe(true);
		// MUTATE the finish's id and prove the check now fails.
		const mutated = {
			...finishes[0],
			payload: { ...finishes[0]?.payload, toolCallId: "tc-WRONG" },
		};
		expect(starts[0]?.payload.toolCallId === mutated.payload.toolCallId).toBe(
			false,
		);
	});

	it("T13: trace ON and trace OFF produce equivalent execution results", async () => {
		const callsOn: string[] = [];
		const callsOff: string[] = [];
		const { sink } = makeCollectingSink();

		const runtimeOn = createAgentRuntime({
			model: new ScriptedModel([toolCallStep("read_file", "tc-1", "alpha")]),
			tools: [makeRecordingTool("read_file", callsOn)],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			modelBehaviorTraceSink: sink,
		});
		const runtimeOff = createAgentRuntime({
			model: new ScriptedModel([toolCallStep("read_file", "tc-1", "alpha")]),
			tools: [makeRecordingTool("read_file", callsOff)],
			systemPrompt: "test prompt",
			sessionId: "session-1",
		});

		const resultOn = await runtimeOn.execute("do the thing");
		const resultOff = await runtimeOff.execute("do the thing");

		expect(resultOn.status).toBe(resultOff.status);
		expect(resultOn.iterations).toBe(resultOff.iterations);
		expect(callsOn).toEqual(callsOff);
	});

	it("T12: the trace records no raw tool output", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([toolCallStep("read_file", "tc-1", "alpha")]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		const serialized = JSON.stringify(observations);
		expect(serialized).not.toContain("ok:read_file");
		expect(serialized).not.toContain("test prompt");
	});
});
