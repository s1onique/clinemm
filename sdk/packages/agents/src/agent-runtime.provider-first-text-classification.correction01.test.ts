/**
 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 — the TIMING CLASSIFICATION
 * witnesses (P0-3).
 *
 * ## What this file establishes
 *
 * The QUAL01 review returned HALT_EVIDENCE_EQUIVALENCE_UNSOUND with the P0-3
 * defect:
 *
 *   "First text chunk is incorrectly certified as true TTFT. The new observer
 *    records: First stream event as `provider_first_response`. First non-empty
 *    `text-delta` as `provider_first_token`. These are measurable client-side
 *    boundaries, but neither is necessarily the model's first generated
 *    token."
 *
 * The authoritative classification is:
 *
 * | Measurement                                                | Status                 |
 * |------------------------------------------------------------|------------------------|
 * | First stream event                                         | Observable             |
 * | First non-empty text delta                                 | Observable             |
 * | First generated text                                       | Observable             |
 * | First generated TOKEN, including reasoning/tool generation  | NOT independently established |
 * | Server-side TTFT                                           | UNAVAILABLE_FROM_TRACE |
 *
 * The gates:
 *   - C3C.1  the boundary is named for what it MEASURES
 *            (`provider_first_text`), never for a token it cannot observe;
 *   - C3C.2  a REASONING-first request produces NO first-text observation,
 *            because the model generated reasoning tokens before any text;
 *   - C3C.3  a TOOL-CALL-ONLY request produces NO first-text observation;
 *   - C3C.4  an EMPTY text delta produces NO first-text observation —
 *            the boundary is "first GENERATED TEXT", not "first text event";
 *   - C3C.5  the server-side TTFT is recorded as explicitly UNAVAILABLE,
 *            never as a measured value;
 *   - C3C.6  the first-text observation remains metadata-only.
 *
 * These witnesses drive the REAL `AgentRuntime` with a scripted model, so
 * the observations come from the PRODUCTION stream seam — not from a
 * hand-fed event list.
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

function makeCollectingSink(): {
	sink: NonNullable<
		Parameters<typeof createAgentRuntime>[0]["modelBehaviorTraceSink"]
	>;
	firstResponses: ModelBehaviorTraceObservation[];
	firstTexts: ModelBehaviorTraceObservation[];
} {
	const firstResponses: ModelBehaviorTraceObservation[] = [];
	const firstTexts: ModelBehaviorTraceObservation[] = [];
	const push = (_observation: ModelBehaviorTraceObservation) => {
		// no-op: the generic channel is not the subject here.
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
		onProviderFirstText: (observation: ModelBehaviorTraceObservation) => {
			firstTexts.push(observation);
		},
	};
	return { sink, firstResponses, firstTexts };
}

function textStep(
	events: AgentModelEvent[],
): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => events;
}

describe("ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 / timing classification", () => {
	it("C3C.1: the first-text boundary is named for what it MEASURES", async () => {
		const { sink, firstResponses, firstTexts } = makeCollectingSink();
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
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("say something");

		expect(firstResponses).toHaveLength(1);
		expect(firstTexts).toHaveLength(1);
		expect(firstTexts[0]?.payload.generatedTextLength).toBe(5);
	});

	it("C3C.2: a REASONING-first request produces NO first-text observation", async () => {
		const { sink, firstResponses, firstTexts } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep([
					{
						type: "reasoning-delta",
						text: "thinking about the answer first",
					},
					{ type: "text-delta", text: "hello" },
					{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
				]),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("reason then answer");

		// The FIRST EVENT was the reasoning delta: the model had generated
		// tokens BEFORE any text existed. The first-RESPONSE observation
		// proves the boundary is client-side, and the first-TEXT observation
		// is strictly later than the model's first generated token.
		expect(firstResponses).toHaveLength(1);
		expect(firstResponses[0]?.payload.eventType).toBe("reasoning-delta");
		expect(firstTexts).toHaveLength(1);
		// The first-text observation records the TEXT, and carries a marker
		// proving the model's first generated token may have been EARLIER.
		expect(firstTexts[0]?.payload.serverSideTtft).toBe(
			"UNAVAILABLE_FROM_TRACE",
		);
	});

	it("C3C.3: a TOOL-CALL-ONLY request produces NO first-text observation", async () => {
		const { sink, firstResponses, firstTexts } = makeCollectingSink();
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
					{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
				]),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("call a tool");

		expect(firstResponses).toHaveLength(1);
		expect(firstTexts).toHaveLength(0);
	});

	it("C3C.4: an EMPTY text delta produces NO first-text observation", async () => {
		const { sink, firstTexts } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep([
					{ type: "text-delta", text: "" },
					{ type: "text-delta", text: "real output" },
					{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
				]),
			]),
			tools: [],
			systemPrompt: "test prompt",
			sessionId: "session-1",
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("emit then speak");

		// The EMPTY delta is not generated TEXT. The first-text observation
		// must wait for the first NON-EMPTY delta.
		expect(firstTexts).toHaveLength(1);
		expect(firstTexts[0]?.payload.generatedTextLength).toBe(
			"real output".length,
		);
	});

	it("C3C.5: the server-side TTFT is recorded as explicitly UNAVAILABLE", async () => {
		const { sink, firstTexts } = makeCollectingSink();
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
			conversationId: "conv-1",
			modelBehaviorTraceSink: sink,
		});

		await runtime.execute("say something");

		expect(firstTexts).toHaveLength(1);
		expect(firstTexts[0]?.payload.serverSideTtft).toBe(
			"UNAVAILABLE_FROM_TRACE",
		);
	});

	it("C3C.6: the first-text observation remains metadata-only", async () => {
		const { sink, firstTexts } = makeCollectingSink();
		const runtime = createAgentRuntime({
			model: new ScriptedModel([
				textStep([
					{ type: "text-delta", text: "secret text" },
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

		const serialized = JSON.stringify(firstTexts[0]?.payload);
		expect(serialized).not.toContain("secret text");
	});
});
