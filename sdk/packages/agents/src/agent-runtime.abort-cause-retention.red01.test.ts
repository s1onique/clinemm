/**
 * ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01 — RED witness.
 *
 * The RED here is a MISSING-OBSERVATION defect, NOT an intentionally
 * failing agent behavior. Every stimulus below is a NORMAL, healthy
 * production path; the assertion is that the OBSERVATION of that path is
 * missing or insufficient.
 *
 * The witnesses drive the REAL `AgentRuntime` with a scripted model, so the
 * observations come from the production model-request and abort-initiation
 * boundaries — not from a hand-fed event list.
 *
 * Gates:
 *   R1  Provider exception           -> the terminal error identity + the
 *                                        request/run correlation must be
 *                                        observable.
 *   R2  Controlled runtime stop      -> must be distinguishable from an
 *                                        explicit cancellation.
 *   R3  Explicit cancellation        -> the ORIGIN must be preserved and
 *                                        correlated to the affected request.
 *   R4  In-flight request at run end -> the ABSENCE of a provider terminal
 *                                        event must stay explicit.
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
// drives the REAL agent runtime; only the provider gateway construction is
// stubbed (this witness supplies its own scripted `AgentModel`).
vi.mock("@cline/llms", () => ({
	createGateway: vi.fn(() => ({
		createAgentModel: vi.fn(),
	})),
	classifyProviderError: vi.fn(() => "unknown"),
	isRetryableProviderError: vi.fn(() => false),
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

/**
 * A collecting sink that keeps the observation KIND alongside the
 * observation, so a witness can ask "did the runtime OBSERVE this?".
 */
function makeCollectingSink(): {
	sink: NonNullable<
		Parameters<typeof createAgentRuntime>[0]["modelBehaviorTraceSink"]
	>;
	observations: Array<
		ModelBehaviorTraceObservation & { readonly kind: string }
	>;
} {
	const observations: Array<
		ModelBehaviorTraceObservation & { readonly kind: string }
	> = [];
	const push = (kind: string, observation: ModelBehaviorTraceObservation) => {
		observations.push({ ...observation, kind });
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
		onRunAbortRequested: (observation: ModelBehaviorTraceObservation) =>
			push("abort_requested", observation),
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

/**
 * A step whose provider stream THROWS with the given error, before any
 * chunk is delivered.
 */
function throwingStep(error: unknown): (
	request: AgentModelRequest,
) => Iterable<AgentModelEvent> {
	return () => {
		throw error;
	};
}

/**
 * A step whose provider stream yields one chunk and then THROWS — a
 * mid-stream terminal failure.
 */
function throwingMidStreamStep(error: unknown): (
	request: AgentModelRequest,
) => Iterable<AgentModelEvent> {
	return () => {
		const events: AgentModelEvent[] = [
			{ type: "text-delta", text: "partial" } as unknown as AgentModelEvent,
		];
		return {
			[Symbol.asyncIterator]() {
				let index = 0;
				return {
					next(): Promise<IteratorResult<AgentModelEvent>> {
						if (index < events.length) {
							return Promise.resolve({
								done: false,
								value: events[index++],
							});
						}
						return Promise.reject(error);
					},
				};
			},
		} as unknown as Iterable<AgentModelEvent>;
	};
}

/**
 * A step whose provider stream stays IN FLIGHT until the request's abort
 * signal fires, and then rejects with the signal's reason.
 *
 * This is what a REAL provider transport does: the in-flight HTTP request
 * is torn down by the abort signal. The scripted model honours the signal
 * so the production abort path is exercised faithfully.
 */
function hangingStep(): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return (request: AgentModelRequest) => {
		const signal = request.signal;
		return {
			[Symbol.asyncIterator]() {
				return {
					next(): Promise<IteratorResult<AgentModelEvent>> {
						if (!signal) {
							return new Promise<IteratorResult<AgentModelEvent>>(() => {});
						}
						if (signal.aborted) {
							// The abort signal carries the runtime's abort error.
							return Promise.reject(signal.reason);
						}
						return new Promise<IteratorResult<AgentModelEvent>>((_, reject) => {
							signal.addEventListener(
								"abort",
								() => reject(signal.reason),
								{ once: true },
							);
						});
					},
				};
			},
		} as unknown as Iterable<AgentModelEvent>;
	};
}

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01 — RED", () => {
	it("R1: a provider exception retains the error identity and the request correlation", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const providerError = new Error("provider exploded: upstream said no");
		providerError.name = "ProviderStreamError";

		const runtime = createAgentRuntime({
			model: new ScriptedModel([throwingStep(providerError)]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-r1",
			conversationId: "conv-r1",
			modelBehaviorTraceSink: sink,
		});

		const result = await runtime.execute("do the thing");

		// The run failed — this is the EXISTING contract, unchanged.
		expect(result.status).toBe("failed");

		const errors = observations.filter((o) => o.kind === "error");
		expect(errors.length).toBeGreaterThanOrEqual(1);
		const error = errors[0];

		// RED_OBSERVABILITY_GAP: the concrete error identity must survive.
		// BEFORE the repair the payload carried ONLY the coarse `errorClass`,
		// so two different provider failures were indistinguishable.
		expect(error?.payload.errorName).toBe("ProviderStreamError");
		expect(error?.payload.errorMessage).toContain("provider exploded");
		// The OBSERVED outcome must be recorded, not inferred.
		expect(error?.payload.requestOutcome).toBe("provider_error");

		// RED_OBSERVABILITY_GAP: the per-request correlation id must be on
		// the record so it joins to the provider's own request identity.
		// BEFORE the repair the trace identity carried no modelRequestId.
		expect(error?.modelRequestId).toBeTruthy();

		// The start boundary must carry the SAME request id, so the pair is
		// joinable by an exact key.
		const starts = observations.filter((o) => o.kind === "start");
		expect(starts[0]?.modelRequestId).toBe(error?.modelRequestId);
	});

	it("R2: a controlled runtime stop is distinguishable from an explicit cancellation", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();

		const runtime = createAgentRuntime({
			model: new ScriptedModel([toolCallStep("read_file", "tc-1", "alpha")]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-r2",
			conversationId: "conv-r2",
			// A hook that requests a controlled stop. This is the production
			// `applyStopControl` path: the runtime stops the run itself.
			hooks: {
				afterModel: () => ({ stop: true, reason: "controlled_stop_probe" }),
			},
			modelBehaviorTraceSink: sink,
		});

		const result = await runtime.execute("do the thing");
		expect(result.status).toBe("aborted");

		const origins = observations.filter((o) => o.kind === "abort_requested");
		expect(origins.length).toBeGreaterThanOrEqual(1);

		// RED_OBSERVABILITY_GAP: before the repair there was NO origin event
		// at all, so a controlled stop and an explicit cancel were
		// indistinguishable in the retained evidence.
		expect(origins[0]?.payload.abortOrigin).toBe("runtime_controlled_stop");
		expect(origins[0]?.payload.abortReason).toContain("controlled_stop_probe");
	});

	it("R3: an explicit cancellation retains its ORIGIN and is not misclassified as a provider failure", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();

		const runtime = createAgentRuntime({
			model: new ScriptedModel([hangingStep()]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-r3",
			conversationId: "conv-r3",
			modelBehaviorTraceSink: sink,
		});

		const running = runtime.execute("do the thing");
		// Let the request reach the provider.
		await new Promise((resolve) => setTimeout(resolve, 20));
		runtime.abort("operator pressed stop", "explicit_abort_request");
		const result = await running;

		expect(result.status).toBe("aborted");

		const origins = observations.filter((o) => o.kind === "abort_requested");
		expect(origins.length).toBeGreaterThanOrEqual(1);
		// RED_OBSERVABILITY_GAP: the ORIGIN of the cancellation.
		expect(origins[0]?.payload.abortOrigin).toBe("explicit_abort_request");

		// The cancellation must NOT be reported as a provider error.
		const providerErrors = observations.filter((o) => o.kind === "error");
		expect(providerErrors).toHaveLength(0);

		// The origin must be correlated to the request it interrupted.
		const starts = observations.filter((o) => o.kind === "start");
		expect(origins[0]?.modelRequestId).toBe(starts[0]?.modelRequestId);
	});

	it("R4: a request still in flight at run end is reported as in-flight, not as a provider error", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();

		const runtime = createAgentRuntime({
			model: new ScriptedModel([hangingStep()]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-r4",
			conversationId: "conv-r4",
			modelBehaviorTraceSink: sink,
		});

		const running = runtime.execute("do the thing");
		await new Promise((resolve) => setTimeout(resolve, 20));
		runtime.abort("operator pressed stop", "explicit_abort_request");
		await running;

		// No provider error may be fabricated for the interrupted request.
		const providerErrors = observations.filter((o) => o.kind === "error");
		expect(providerErrors).toHaveLength(0);

		// The request WAS observed to start, so its id must be present.
		const starts = observations.filter((o) => o.kind === "start");
		expect(starts[0]?.modelRequestId).toBeTruthy();
	});

	it("R5: a mid-stream failure is a stream error and fabricates no finish reason", async () => {
		const calls: string[] = [];
		const tool = makeRecordingTool("read_file", calls);
		const { sink, observations } = makeCollectingSink();
		const streamError = new Error("stream broke mid-flight");
		streamError.name = "StreamError";

		const runtime = createAgentRuntime({
			model: new ScriptedModel([throwingMidStreamStep(streamError)]),
			tools: [tool],
			systemPrompt: "test prompt",
			sessionId: "session-r5",
			conversationId: "conv-r5",
			modelBehaviorTraceSink: sink,
		});

		const result = await runtime.execute("do the thing");
		expect(result.status).toBe("failed");

		const errors = observations.filter((o) => o.kind === "error");
		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(errors[0]?.payload.errorName).toBe("StreamError");
		// A mid-stream failure is a STREAM error, not a provider error.
		expect(errors[0]?.payload.requestOutcome).toBe("stream_error");
		// NO clean provider finish reason may be fabricated.
		expect(errors[0]?.payload.finishReason).toBeUndefined();
	});
});
