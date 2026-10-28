/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (R1/R2) — D4/D5.
 *
 * D4 — REAL returned reasoning metadata must be countable/observable
 *      WITHOUT retaining reasoning content.
 * D5 — CONTINUITY: a multi-turn tool call must preserve the required
 *      reasoning/tool-call structure and correlation without mutating or
 *      duplicating it.
 *
 * These drive the REAL `AgentRuntime`, so the observations come from the
 * production model-request boundaries.
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	ModelBehaviorTraceObservation,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

// The production agent runtime imports `@cline/llms` at module scope, and the
// shared barrel evaluates `agents/types.ts`, which calls `z.object(...)` at
// module scope. This package's unit-test vitest config does not pre-bundle
// zod, so the llms gateway is stubbed — exactly as the sibling
// `agent-runtime.model-behavior-trace.test.ts` does. The witness still drives
// the REAL agent runtime; only the provider gateway construction is stubbed
// (this witness supplies its own scripted `AgentModel`).
vi.mock("@cline/llms", () => ({
	createGateway: vi.fn(() => ({
		createAgentModel: vi.fn(),
	})),
}));

import { createAgentRuntime } from "./agent-runtime";

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
	};
	return { sink, observations };
}

/**
 * A provider response that carries reasoning metadata: a reasoning content
 * part, a provider-reported reasoning token count, and a tool call.
 */
function reasoningToolCallStep(input: {
	toolName: string;
	toolCallId: string;
	value: string;
	reasoningText: string;
	reasoningTokenCount: number;
}): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{
			type: "reasoning-delta",
			id: "reasoning-1",
			text: input.reasoningText,
		} as unknown as AgentModelEvent,
		{
			type: "tool-call-delta",
			toolCallId: input.toolCallId,
			toolName: input.toolName,
			index: 0,
			input: { value: input.value },
		} as unknown as AgentModelEvent,
		{
			type: "usage",
			usage: {
				inputTokens: 10,
				outputTokens: 20,
				totalTokens: 30,
				reasoningTokenCount: input.reasoningTokenCount,
			},
		} as unknown as AgentModelEvent,
		{
			type: "finish",
			reason: "tool_use",
		} as unknown as AgentModelEvent,
	];
}

describe("D4/D5 MiniMax reasoning trace witnesses", () => {
	it("D4: returned reasoning metadata is observable without retaining reasoning content", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				reasoningToolCallStep({
					toolName: "read_file",
					toolCallId: "tc-d4",
					value: "alpha",
					reasoningText: "SECRET-REASONING-CONTENT",
					reasoningTokenCount: 7,
				}),
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-d4",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		const finishes = observations.filter(
			(observation) => observation.payload.kind === "finish",
		);
		expect(finishes.length).toBeGreaterThanOrEqual(1);
		const finish = finishes[0];

		// The PROVIDER-REPORTED reasoning token count is recorded.
		expect(finish?.payload.providerReportedReasoningTokens).toBe(7);
		// The total output tokens are recorded.
		expect(finish?.payload.outputTokens).toBe(20);
		// The PRESENCE and BYTE COUNT of streamed reasoning are recorded.
		expect(finish?.payload.reasoningContentPresent).toBe(true);
		expect(finish?.payload.reasoningContentBytes).toBe(
			"SECRET-REASONING-CONTENT".length,
		);
		// The reasoning CONTENT ITSELF is not retained anywhere in the record.
		expect(JSON.stringify(finish?.payload)).not.toContain(
			"SECRET-REASONING-CONTENT",
		);
	});

	it("D4c: reasoningContentBytes counts UTF-8 BYTES, not UTF-16 code units", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();

		// A non-ASCII witness. "思考" is TWO characters (two UTF-16 code
		// units) but SIX UTF-8 bytes (three bytes per CJK character).
		// `String.length` would report 2; the field is named
		// `reasoningContentBytes`, so it must report 6.
		const reasoningText = "思考";
		expect(reasoningText.length).toBe(2);
		expect(new TextEncoder().encode(reasoningText).length).toBe(6);

		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				reasoningToolCallStep({
					toolName: "read_file",
					toolCallId: "tc-d4c",
					value: "alpha",
					reasoningText,
					reasoningTokenCount: 3,
				}),
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-d4c",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		const finishes = observations.filter(
			(observation) => observation.payload.kind === "finish",
		);
		const finish = finishes[0];

		expect(finish?.payload.reasoningContentPresent).toBe(true);
		// The byte count is in UTF-8 bytes.
		expect(finish?.payload.reasoningContentBytes).toBe(6);
		// It is NOT the UTF-16 code-unit count.
		expect(finish?.payload.reasoningContentBytes).not.toBe(
			reasoningText.length,
		);
		// The reasoning CONTENT ITSELF is still not retained.
		expect(JSON.stringify(finish?.payload)).not.toContain(reasoningText);
	});

	it("D4b: a response with no reasoning reports absence, not a zero token count", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				() => [
					{
						type: "tool-call-delta",
						toolCallId: "tc-d4b",
						toolName: "read_file",
						index: 0,
						input: { value: "alpha" },
					} as unknown as AgentModelEvent,
					{
						type: "usage",
						usage: { inputTokens: 10, outputTokens: 20 },
					} as unknown as AgentModelEvent,
					{
						type: "finish",
						reason: "tool_use",
					} as unknown as AgentModelEvent,
				],
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-d4b",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		const finishes = observations.filter(
			(observation) => observation.payload.kind === "finish",
		);
		const finish = finishes[0];
		expect(finish?.payload.reasoningContentPresent).toBe(false);
		expect(finish?.payload.reasoningContentBytes).toBe(0);
		// The provider did not report a reasoning token count, so the field
		// is ABSENT rather than a fabricated zero.
		expect(
			Object.hasOwn(finish?.payload ?? {}, "providerReportedReasoningTokens"),
		).toBe(false);
	});

	it("D5: a multi-turn tool call preserves reasoning/tool-call structure and correlation", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				reasoningToolCallStep({
					toolName: "read_file",
					toolCallId: "tc-d5",
					value: "alpha",
					reasoningText: "REASONING-TURN-1",
					reasoningTokenCount: 3,
				}),
				() => [
					{
						type: "usage",
						usage: { inputTokens: 5, outputTokens: 6 },
					} as unknown as AgentModelEvent,
					{
						type: "finish",
						reason: "stop",
					} as unknown as AgentModelEvent,
				],
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-d5",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		// The tool was executed exactly once — no duplication.
		expect(calls).toEqual(["read_file:alpha"]);
		const toolStarts = observations.filter(
			(observation) => observation.payload.kind === "tool_start",
		);
		const toolFinishes = observations.filter(
			(observation) => observation.payload.kind === "tool_finish",
		);
		expect(toolStarts).toHaveLength(1);
		expect(toolFinishes).toHaveLength(1);
		// The tool-call identity is correlated and unmutated across both
		// boundaries.
		expect(toolStarts[0]?.payload.toolCallId).toBe("tc-d5");
		expect(toolFinishes[0]?.payload.toolCallId).toBe("tc-d5");

		// There were exactly TWO model requests: the tool call and the
		// follow-up. The reasoning content was counted once, not duplicated.
		const finishes = observations.filter(
			(observation) => observation.payload.kind === "finish",
		);
		expect(finishes).toHaveLength(2);
		expect(finishes[0]?.payload.reasoningContentPresent).toBe(true);
		expect(finishes[0]?.payload.reasoningContentBytes).toBe(
			"REASONING-TURN-1".length,
		);
		expect(finishes[1]?.payload.reasoningContentPresent).toBe(false);
	});
});
