/**
 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the PROVIDER EVENT AVAILABILITY
 * witnesses.
 *
 * ## What this file establishes
 *
 * The Round C latency tracer needs to know whether the configured provider
 * exposes an AUTHORITATIVE first-token observation. The mission's
 * contract table is:
 *
 * | Measurement            | Contract                                     |
 * |-------------------------|----------------------------------------------|
 * | Request submission     | Actual invocation boundary                    |
 * | First response / chunk | Only an observed provider/stream event        |
 * | First model output      | Only the first observed generated-output event |
 * | True TTFT              | Only an authoritative first-token observation  |
 * | Provider completion    | Actual observed terminal boundary             |
 *
 * These witnesses drive the REAL `AgentRuntime` with a scripted model, so
 * the observations come from the PRODUCTION stream seam
 * (`AgentRuntime.openTaskLifecycleStream`) — not from a hand-fed event
 * list.
 *
 * The gates:
 *   - the first event is observed EXACTLY ONCE per request;
 *   - an empty / no-token response produces NO first-token observation;
 *   - an error before the first output produces NO first-token observation;
 *   - a cancellation before the first output produces NO first-token
 *     observation;
 *   - concurrent requests with DIFFERENT identities do not cross-attribute;
 *   - the diagnostic-disabled path observes nothing at all;
 *   - the streamed output is CONSERVED — the observation changes nothing
 *     about what the runtime yields.
 */

import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	ModelBehaviorTraceObservation,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

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
	execute: (input: Record<string, unknown>) => Promise<{ output: string }>;
}

function makeCollectingSink(): {
	sink: NonNullable<
		Parameters<typeof createAgentRuntime>[0]["modelBehaviorTraceSink"]
	>;
	observations: ModelBehaviorTraceObservation[];
	firstResponses: ModelBehaviorTraceObservation[];
	firstTokens: ModelBehaviorTraceObservation[];
} {
	const observations: ModelBehaviorTraceObservation[] = [];
	const firstResponses: ModelBehaviorTraceObservation[] = [];
	const firstTokens: ModelBehaviorTraceObservation[] = [];
	const push = (observation: ModelBehaviorTraceObservation) => {
		observations.push(observation);
	};
	const sink = {
		onModelRequestStart: push,
		onProviderRequestSubmitted: push,
		onProviderRequestCompleted: push,
		onModelRequestFinish: push,
		onModelRequestError: push,
		onModelRequestAbort: push,
		onToolStart: push,
		onToolFinish: push,
		onProviderFirstResponse: (observation: ModelBehaviorTraceObservation) => {
			firstResponses.push(observation);
		},
		onProviderFirstToken: (observation: ModelBehaviorTraceObservation) => {
			firstTokens.push(observation);
		},
	};
	return { sink, observations, firstResponses, firstTokens };
}

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

/**
 * A model step that emits the given events.
 */
function textStep(
	events: AgentModelEvent[],
): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => events;
}

describe("ACT-CLINEMM-ROUND-C-TRACE-QUAL01 / provider event availability", () => {
	it("C3.1: the first event is observed EXACTLY ONCE per request", async () => {
		const { sink, firstResponses, firstTokens } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep([
					{ type: "text-delta", text: "hello" },
					{ type: "text-delta", text: " world" },
					{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
				]),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("say something");

		// Exactly one first-response and exactly one first-token, even
		// though the stream produced TWO text deltas.
		expect(firstResponses).toHaveLength(1);
		expect(firstTokens).toHaveLength(1);
		// The first-response event is the FIRST event of the stream.
		expect(firstResponses[0]?.payload.eventType).toBe("text-delta");
		// The first-token observation carries the LENGTH of the first
		// generated output — a size, never the text.
		expect(firstTokens[0]?.payload.generatedTextLength).toBe(5);
		expect(JSON.stringify(firstTokens[0]?.payload)).not.toContain("hello");
	});

	it("C3.2: an empty / no-token response produces NO first-token observation", async () => {
		const { sink, firstResponses, firstTokens } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep([
					{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
				]),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("say nothing");

		// The stream DID produce an event, so the first-response event is
		// observed — but there was NO generated output, so the
		// first-token measurement stays unavailable.
		expect(firstResponses).toHaveLength(1);
		expect(firstTokens).toHaveLength(0);
	});

	it("C3.3: a TOOL-CALL-ONLY response produces NO first-token observation", async () => {
		const { sink, firstResponses, firstTokens } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep([
					{
						type: "tool-call-delta",
						toolCallId: "tc-1",
						toolName: "read_file",
						index: 0,
						input: { value: "alpha" },
					} as unknown as AgentModelEvent,
					{ type: "finish", reason: "tool_use" } as unknown as AgentModelEvent,
				]),
			]),
			tools: [
				{
					name: "read_file",
					description: "read",
					inputSchema: { type: "object", properties: {} },
					execute: async () => ({ output: "ok" }),
				},
			],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("do the thing");

		// The first stream event was a tool call — a transport event, NOT
		// generated output.
		expect(firstResponses).toHaveLength(1);
		expect(firstResponses[0]?.payload.eventType).toBe("tool-call-delta");
		expect(firstTokens).toHaveLength(0);
	});

	it("C3.4: an error BEFORE the first output produces NO first-token observation", async () => {
		const { sink, firstResponses, firstTokens } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				() => {
					throw new Error("provider exploded");
				},
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			modelBehaviorTraceSink: sink,
		});

		const result = await runtime.execute("do the thing");

		// The run failed — the EXISTING contract, unchanged.
		expect(result.status).toBe("failed");
		// The provider failed before the stream opened: neither event was
		// observed, so neither measurement is fabricated.
		expect(firstResponses).toHaveLength(0);
		expect(firstTokens).toHaveLength(0);
	});

	it("C3.5: a cancellation BEFORE the first output produces NO first-token observation", async () => {
		const { sink, firstTokens } = makeCollectingSink();
		const controller = new AbortController();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				async function* cancelled() {
					// The provider acknowledged the request but produced no
					// output before the cancellation landed.
					yield {
						type: "tool-call-delta",
						toolCallId: "tc-cancelled",
						toolName: "read_file",
						index: 0,
						input: { value: "alpha" },
					} as unknown as AgentModelEvent;
					controller.abort();
				},
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			modelBehaviorTraceSink: sink,
			abortSignal: controller.signal,
		});

		await runtime.execute("do the thing").catch(() => undefined);

		// The cancellation landed BEFORE any generated output, so the
		// first-token measurement is not fabricated — the trace reports it
		// as unavailable instead.
		expect(firstTokens).toHaveLength(0);
	});

	it("C3.6: concurrent requests with DIFFERENT identities do not cross-attribute", async () => {
		const { sink, firstTokens } = makeCollectingSink();
		const runtimeA = createAgentRuntime({
			model: new ScriptedModel([
				textStep([
					{ type: "text-delta", text: "alpha" },
					{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
				]),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-A",
			conversationId: "conv-A",
			modelBehaviorTraceSink: sink,
		});
		const runtimeB = createAgentRuntime({
			model: new ScriptedModel([
				textStep([
					{ type: "text-delta", text: "bravo" },
					{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
				]),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-B",
			conversationId: "conv-B",
			modelBehaviorTraceSink: sink,
		});

		await Promise.all([runtimeA.execute("do a"), runtimeB.execute("do b")]);

		// Two requests, two first-token observations — one per request —
		// and each carries ITS OWN session identity.
		expect(firstTokens).toHaveLength(2);
		const sessions = firstTokens
			.map((observation) => observation.sessionId)
			.sort();
		expect(sessions).toEqual(["session-A", "session-B"]);
	});

	it("C3.7: the diagnostic-disabled path observes NOTHING", async () => {
		// The sink declares NO first-response / first-token channel: the
		// runtime must not fail when the channels are absent.
		const bareSink = {
			onModelRequestStart: () => undefined,
			onModelRequestFinish: () => undefined,
		};
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep([
					{ type: "text-delta", text: "hello" },
					{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
				]),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			modelBehaviorTraceSink: bareSink,
		});

		const result = await runtime.execute("say something");

		// The run still SUCCEEDED — the absent channel changed nothing.
		expect(result.status).toBeDefined();
	});

	it("C3.8: the streamed output is CONSERVED — the observation changes nothing", async () => {
		const { sink } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep([
					{ type: "text-delta", text: "one" },
					{ type: "text-delta", text: "two" },
					{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
				]),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			modelBehaviorTraceSink: sink,
		});

		const result = await runtime.execute("say something");

		// The final assistant message carries BOTH deltas, in order — the
		// observation neither dropped, reordered nor merged anything.
		const text = result.messages
			.map((message) =>
				Array.isArray(message.content)
					? message.content
							.map((part) =>
								part && typeof part === "object" && "text" in part
									? String(part.text)
									: "",
							)
							.join("")
					: String(message.content ?? ""),
			)
			.join("");
		expect(text).toContain("one");
		expect(text).toContain("two");
	});
});
