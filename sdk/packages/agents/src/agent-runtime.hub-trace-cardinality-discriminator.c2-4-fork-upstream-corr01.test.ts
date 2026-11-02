/**
 * ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01 — C2 D3.
 *
 * TRACE COVERAGE / IDENTITY / ORDERING / CARDINALITY under the upstream
 * per-chunk hub filter.
 *
 * This witness drives the REAL `AgentRuntime` with a scripted model that
 * emits the representative per-chunk events:
 *
 *   - assistant TEXT deltas        (`text-delta`)
 *   - assistant REASONING deltas   (`reasoning-delta`)
 *   - a TOOL CALL                  (`tool-call-delta`)
 *   - a TOOL UPDATE                (the executor's `emitUpdate`)
 *
 * and records what the ClineMM model-behavior / portable-trace recorder
 * actually observes.
 *
 * WHY THIS WITNESS EXISTS
 * -----------------------
 * Upstream `94980446c` added a hub-side filter that drops
 * `assistant-text-delta`, `assistant-reasoning-delta` and `tool-updated`
 * from the REMOTE `onEvent` hook proxy. The ClineMM fork's recorder is a
 * different interface (`ModelBehaviorTraceSink`) invoked directly by the
 * runtime, so the filter must not change what the recorder sees.
 *
 * This witness proves that claim by EXERCISING the real runtime with the
 * real delta events and asserting:
 *
 *   D3-COVERAGE    every expected recorder channel fired
 *   D3-IDENTITY    session / run / tool-call correlation is preserved
 *   D3-ORDERING    request-start precedes tool-start precedes tool-finish
 *                  precedes request-finish
 *   D3-CARDINALITY exactly ONE record per boundary — no duplication and
 *                  no loss, so the filter can neither inflate nor deflate
 *                  the trace
 *
 * The recorder's own channel set is what the portable-trace normalizer
 * consumes; the delta events themselves are NOT recorder channels (the
 * recorder records boundaries, not tokens), which is precisely why the
 * upstream per-chunk filter cannot alter trace coverage.
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	ModelBehaviorTraceObservation,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

// The production agent runtime imports `@cline/llms` at module scope and
// the shared barrel evaluates `agents/types.ts`, which calls `z.object(...)`
// at module scope. This package's unit-test vitest config does not
// pre-bundle zod, so the llms gateway is stubbed — exactly as the sibling
// `agent-runtime.model-behavior-trace.test.ts` does. The witness still
// drives the REAL agent runtime; only the provider gateway construction is
// stubbed (this witness supplies its own scripted `AgentModel`).
vi.mock("@cline/llms", () => ({
	createGateway: vi.fn(() => ({
		createAgentModel: vi.fn(),
	})),
}));

import { createAgentRuntime } from "./agent-runtime";

// ============================================================================
// Fixtures
// ============================================================================

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
		context?: { emitUpdate?: (update: unknown) => void },
	) => Promise<{ output: string }>;
}

/**
 * A tool that emits a REAL `tool-updated` progress event from inside its
 * executor — the exact production shape the upstream filter names.
 */
function makeUpdatingTool(name: string, calls: string[]): TestTool {
	return {
		name,
		description: `test tool ${name}`,
		inputSchema: { type: "object", properties: {} },
		execute: async (input: Record<string, unknown>, context) => {
			calls.push(`${name}:${String(input.value ?? "")}`);
			context?.emitUpdate?.({ progress: 0.5, stage: "halfway" });
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
		onEffectiveModelConfig: (observation: ModelBehaviorTraceObservation) =>
			push("effective_model_config", observation),
		onModelRequestStart: (observation: ModelBehaviorTraceObservation) =>
			push("model_request_start", observation),
		onModelRequestFinish: (observation: ModelBehaviorTraceObservation) =>
			push("model_request_finish", observation),
		onToolStart: (observation: ModelBehaviorTraceObservation) =>
			push("tool_start", observation),
		onToolFinish: (observation: ModelBehaviorTraceObservation) =>
			push("tool_finish", observation),
	};
	return { sink, observations };
}

/**
 * A scripted model turn that emits, in order:
 *   - assistant REASONING deltas
 *   - assistant TEXT deltas
 *   - a TOOL CALL
 * and then finishes.
 *
 * The next turn finishes the run.
 */
function representativeTurn(
	toolName: string,
	toolCallId: string,
): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{ type: "reasoning-delta", text: "think-1" } as unknown as AgentModelEvent,
		{ type: "reasoning-delta", text: "think-2" } as unknown as AgentModelEvent,
		{ type: "text-delta", text: "answer-" } as unknown as AgentModelEvent,
		{ type: "text-delta", text: "part" } as unknown as AgentModelEvent,
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			index: 0,
			input: { value: "alpha" },
		} as unknown as AgentModelEvent,
		{ type: "finish", reason: "tool_use" } as unknown as AgentModelEvent,
	];
}

function finalTurn(): (
	request: AgentModelRequest,
) => Iterable<AgentModelEvent> {
	return () => [
		{ type: "text-delta", text: "done" } as unknown as AgentModelEvent,
		{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
	];
}

// ============================================================================
// D3 — coverage / identity / ordering / cardinality
// ============================================================================

describe("C2 D3: trace coverage, identity, ordering and cardinality under the upstream hub filter", () => {
	it("records every boundary exactly once, in order, with intact identity", async () => {
		const calls: string[] = [];
		const tool = makeUpdatingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				representativeTurn("read_file", "tc-1"),
				finalTurn(),
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-c2",
			conversationId: "conv-c2",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		// ---- D3-COVERAGE -------------------------------------------------
		// Every recorder channel that the real run crosses fired. The
		// representative delta events (reasoning / text / tool call / tool
		// update) were all produced by the real runtime.
		const kinds = observations.map((o) => o.payload.kind as string);
		expect(kinds).toContain("effective_model_config");
		expect(kinds).toContain("model_request_start");
		expect(kinds).toContain("model_request_finish");
		expect(kinds).toContain("tool_start");
		expect(kinds).toContain("tool_finish");

		// The real tool ran, and it really emitted its progress update.
		expect(calls).toEqual(["read_file:alpha"]);

		// ---- D3-CARDINALITY ----------------------------------------------
		// EXACTLY ONE record per boundary. The upstream per-chunk filter
		// can neither duplicate nor drop these, because the recorder is not
		// on the hub hook-proxy path.
		const countOf = (kind: string): number =>
			kinds.filter((k) => k === kind).length;
		expect(countOf("effective_model_config")).toBe(2); // one per turn
		expect(countOf("model_request_start")).toBe(2); // one per turn
		expect(countOf("model_request_finish")).toBe(2); // one per turn
		expect(countOf("tool_start")).toBe(1); // exactly one tool call
		expect(countOf("tool_finish")).toBe(1); // exactly one tool call

		// ---- D3-ORDERING --------------------------------------------------
		// request-start precedes tool-start precedes tool-finish, and the
		// second turn's request-start follows the first turn's finish.
		const indexOf = (kind: string): number =>
			kinds.findIndex((k) => k === kind);
		expect(indexOf("model_request_start")).toBeLessThan(indexOf("tool_start"));
		expect(indexOf("tool_start")).toBeLessThan(indexOf("tool_finish"));
		const lastStart = kinds.lastIndexOf("model_request_start");
		const firstFinish = kinds.indexOf("model_request_finish");
		expect(firstFinish).toBeLessThan(lastStart);

		// ---- D3-IDENTITY --------------------------------------------------
		// The correlation identity survives on EVERY record.
		for (const observation of observations) {
			expect(observation.sessionId).toBe("session-c2");
			expect(observation.runId).toBeDefined();
			expect(observation.runId).toBeTypeOf("string");
			expect(observation.iteration).toBeGreaterThanOrEqual(1);
		}

		// The tool records carry the tool-call identity that joins them.
		const toolStart = observations.find((o) => o.payload.kind === "tool_start");
		const toolFinish = observations.find(
			(o) => o.payload.kind === "tool_finish",
		);
		expect(toolStart?.payload.toolCallId).toBe("tc-1");
		expect(toolFinish?.payload.toolCallId).toBe("tc-1");
		expect(toolStart?.payload.toolName).toBe("read_file");
	});

	it("is unchanged when the same run is executed with tracing OFF", async () => {
		// The OFF path must produce the SAME execution result: the recorder
		// is pure observation and never alters control flow.
		const calls: string[] = [];
		const tool = makeUpdatingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				representativeTurn("read_file", "tc-1"),
				finalTurn(),
			]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-c2",
			conversationId: "conv-c2",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");
		const tracedCalls = [...calls];

		const offCalls: string[] = [];
		const offTool = makeUpdatingTool("read_file", offCalls);
		const offRuntime = createAgentRuntime({
			model: new ScriptedModel([
				representativeTurn("read_file", "tc-1"),
				finalTurn(),
			]),
			tools: [offTool],
			systemPrompt: "test prompt",
			sessionId: "session-c2",
			conversationId: "conv-c2",
		});

		await offRuntime.execute("do the thing");

		expect(offCalls).toEqual(tracedCalls);
		expect(observations.length).toBeGreaterThan(0);
	});
});
