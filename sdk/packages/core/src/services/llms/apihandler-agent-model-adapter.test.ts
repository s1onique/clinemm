import type {
	ApiHandler,
	ApiStreamChunk,
	HandlerModelInfo,
	Message,
} from "@cline/llms";
import type { AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createAgentModelFromApiHandler } from "./apihandler-agent-model-adapter";

function fakeHandler(
	chunks: ApiStreamChunk[],
	opts?: { throwAfter?: number; error?: unknown },
): ApiHandler & { aborts: (AbortSignal | undefined)[] } {
	const aborts: (AbortSignal | undefined)[] = [];
	return {
		aborts,
		getMessages: () => [],
		getModel: (): HandlerModelInfo => ({ id: "m", info: { id: "m" } }),
		setAbortSignal(signal) {
			aborts.push(signal);
		},
		// eslint-disable-next-line require-yield
		async *createMessage(
			_system: string,
			_messages: Message[],
		): AsyncGenerator<ApiStreamChunk> {
			let i = 0;
			for (const chunk of chunks) {
				if (opts?.throwAfter !== undefined && i === opts.throwAfter) {
					throw opts.error ?? new Error("boom");
				}
				yield chunk;
				i++;
			}
		},
	};
}

async function collect(
	stream:
		| AsyncIterable<AgentModelEvent>
		| Promise<AsyncIterable<AgentModelEvent>>,
): Promise<AgentModelEvent[]> {
	const out: AgentModelEvent[] = [];
	for await (const event of await stream) {
		out.push(event);
	}
	return out;
}

const baseRequest: AgentModelRequest = {
	systemPrompt: "sys",
	messages: [
		{
			id: "1",
			role: "user",
			content: [{ type: "text", text: "hi" }],
			createdAt: 0,
		},
	],
	tools: [],
};

describe("createAgentModelFromApiHandler", () => {
	it("maps text + usage chunks to events and appends a finish", async () => {
		const handler = fakeHandler([
			{ type: "text", text: "hello", id: "x" },
			{
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
				thoughtsTokenCount: 2,
				totalCost: 0.01,
				id: "x",
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events).toEqual([
			{ type: "text-delta", text: "hello" },
			{
				type: "usage",
				usage: {
					inputTokens: 10,
					outputTokens: 5,
					cacheReadTokens: undefined,
					cacheWriteTokens: undefined,
					reasoningTokenCount: 2,
					totalCost: 0.01,
				},
			},
			{ type: "finish", reason: "stop" },
		]);
	});

	it("maps tool_calls (object args) to a tool-call-delta event", async () => {
		const handler = fakeHandler([
			{
				type: "tool_calls",
				id: "x",
				tool_call: {
					call_id: "c1",
					function: { id: "c1", name: "edit", arguments: { path: "a.ts" } },
				},
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events[0]).toEqual({
			type: "tool-call-delta",
			toolCallId: "c1",
			toolName: "edit",
			inputText: undefined,
			input: { path: "a.ts" },
		});
		// A turn that ends with tool calls terminates as tool-calls, not stop.
		expect(events.at(-1)).toEqual({ type: "finish", reason: "tool-calls" });
	});

	it("preserves the thought signature on reasoning and tool-call events", async () => {
		const handler = fakeHandler([
			{ type: "reasoning", reasoning: "think", signature: "sig-r", id: "x" },
			{
				type: "tool_calls",
				id: "x",
				signature: "sig-t",
				tool_call: { call_id: "c1", function: { name: "edit", arguments: {} } },
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		const reasoning = events.find((e) => e.type === "reasoning-delta");
		expect(reasoning?.metadata).toMatchObject({ thoughtSignature: "sig-r" });
		const toolCall = events.find((e) => e.type === "tool-call-delta");
		expect(toolCall?.metadata).toMatchObject({ thoughtSignature: "sig-t" });
	});

	it("maps a done chunk with a max-output-tokens incompleteReason to max-tokens", async () => {
		const handler = fakeHandler([
			{
				type: "done",
				success: true,
				incompleteReason: "max_output_tokens",
				id: "x",
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "max-tokens",
		});
	});

	it("maps a done chunk with a content-filter incompleteReason to content-filter", async () => {
		const handler = fakeHandler([
			{
				type: "done",
				success: true,
				incompleteReason: "content_filter",
				id: "x",
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));
		// Must not collapse into "stop": a filtered turn that produced no
		// content is not a retryable empty response.
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "content-filter",
		});
	});

	it("does not append a finish when the handler emits a done chunk", async () => {
		const handler = fakeHandler([
			{ type: "text", text: "x", id: "x" },
			{ type: "done", success: true, id: "x" },
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		const finishes = events.filter((e) => e.type === "finish");
		expect(finishes).toHaveLength(1);
		expect(finishes[0]).toEqual({
			type: "finish",
			reason: "stop",
			error: undefined,
		});
	});

	// ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01
	// (AMENDMENT-02 C1) — THE PRESERVED TERMINAL REASON.
	it("preserves a reported terminal reason instead of collapsing it into stop", async () => {
		// The compatibility adapter reports `success: false` for a stream that
		// ended without the provider ESTABLISHING a successful completion.
		// That covers both a FAILED stream and an UNEStablished one, and the
		// runtime handles them differently — so the distinction must survive
		// the adapter instead of collapsing into "error".
		const handler = fakeHandler([
			{
				type: "done",
				success: false,
				finishReason: "unknown",
				id: "x",
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		// An unestablished completion is NOT an error: the runtime has
		// dedicated handling for it ("Model ended without a recognized finish
		// reason"), and that handling must not be bypassed.
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "unknown",
		});
	});

	it("keeps a LEGACY done chunk without a terminal reason unchanged", async () => {
		// A legacy registered handler (e.g. the VS Code LM handler) reports no
		// terminal reason at all. That is NOT the same claim as a handler that
		// REPORTED an unestablished one, so it keeps its previous mapping.
		const handler = fakeHandler([{ type: "done", success: true, id: "x" }]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
	});

	// ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01 — THE ADAPTER
	// CONTRACT.
	//
	// The terminal reason is now a TYPED value (`AgentModelFinishReason`),
	// not an arbitrary string, and the mapping has a defined precedence.
	it("does not let a reported terminal reason override a REPORTED FAILURE", async () => {
		// The negative signal wins: a chunk that reports a failed stream
		// WITH an error message is a failure. The reported reason must not
		// launder it into an "unestablished completion", which would lose
		// the runtime's error recovery.
		const handler = fakeHandler([
			{
				type: "done",
				success: false,
				error: "Provider transport failed",
				finishReason: "unknown",
				id: "x",
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "error",
			error: "Provider transport failed",
		});
	});

	it("preserves an UNKNOWN terminal reason as unknown, not as a failure", async () => {
		// `unknown` means the provider never ESTABLISHED a successful
		// completion. It is NOT an invented provider failure and NOT a
		// normal completion: the runtime has dedicated handling for it
		// ("Model ended without a recognized finish reason"), and that
		// handling must not be bypassed.
		const handler = fakeHandler([
			{ type: "done", success: false, finishReason: "unknown", id: "x" },
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events.at(-1)).toMatchObject({ type: "finish", reason: "unknown" });
		// No error message is invented for it.
		expect((events.at(-1) as { error?: string }).error).toBeUndefined();
	});

	it("does not turn an UNKNOWN terminal reason into a normal completion", async () => {
		// The counterpart control: `unknown` must not become `stop`.
		const handler = fakeHandler([
			{ type: "done", success: true, finishReason: "unknown", id: "x" },
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events.at(-1)).toMatchObject({ type: "finish", reason: "unknown" });
	});

	// ACT-CLINEMM-CMP05-TERMINAL-NEGATIVE-SIGNAL-PRECEDENCE-01 — THE
	// CONFLICTING TERMINAL SIGNALS.
	//
	// The terminal fields of a done chunk can CONFLICT. A negative signal
	// must win over a positive one, or a failed/unestablished turn is
	// normalized into a successful completion and the consumer cannot tell
	// the difference.
	it("does not normalize a FAILED stream with a stop reason into a successful completion", async () => {
		// `success: false` says the stream did NOT complete successfully.
		// `finishReason: "stop"` says the provider reported a normal
		// completion. The NEGATIVE signal wins: the stream failed.
		const handler = fakeHandler([
			{ type: "done", success: false, finishReason: "stop", id: "x" },
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events.at(-1)).toMatchObject({ type: "finish", reason: "error" });
		expect((events.at(-1) as { reason?: string }).reason).not.toBe("stop");
	});

	it("does not let a stop reason override an explicit INCOMPLETENESS", async () => {
		// The provider reported the response was cut short. That
		// incompleteness is authoritative: the reason must not collapse it
		// into a normal completion.
		const handler = fakeHandler([
			{
				type: "done",
				success: true,
				finishReason: "stop",
				incompleteReason: "max_output_tokens",
				id: "x",
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "max-tokens",
		});
	});

	it("keeps the CONTENT-FILTER incompleteness authoritative over a stop reason", async () => {
		const handler = fakeHandler([
			{
				type: "done",
				success: true,
				finishReason: "stop",
				incompleteReason: "content_filter",
				id: "x",
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "content-filter",
		});
	});

	it("forwards the abort signal to the handler", async () => {
		const handler = fakeHandler([{ type: "text", text: "x", id: "x" }]);
		const controller = new AbortController();
		const model = createAgentModelFromApiHandler(handler);
		await collect(model.stream({ ...baseRequest, signal: controller.signal }));
		expect(handler.aborts[0]).toBe(controller.signal);
	});

	it("emits a finish(error) when the handler throws", async () => {
		const handler = fakeHandler([{ type: "text", text: "x", id: "x" }], {
			throwAfter: 0,
		});
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "error",
			error: "boom",
		});
	});

	it("classifies a context-window overflow thrown by the handler", async () => {
		// Registered handlers (e.g. VS Code LM) reject over-window requests by
		// throwing; the classification has to survive the flattening to a
		// message string or the runtime cannot start overflow recovery.
		const overflow = Object.assign(new Error("Bad Request"), {
			statusCode: 400,
			responseBody: JSON.stringify({
				error: {
					message: "prompt is too long: 213462 tokens > 200000 maximum",
				},
			}),
		});
		const handler = fakeHandler([{ type: "text", text: "x", id: "x" }], {
			throwAfter: 0,
			error: overflow,
		});
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "error",
			errorClass: "context_window_exceeded",
		});
	});

	it("classifies a context-window overflow reported by a failed done chunk", async () => {
		const handler = fakeHandler([
			{
				type: "done",
				success: false,
				error: "This model's maximum context length is 40960 tokens.",
				id: "x",
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "error",
			errorClass: "context_window_exceeded",
		});
	});

	it("leaves unrelated handler failures unclassified", async () => {
		const handler = fakeHandler([{ type: "text", text: "x", id: "x" }], {
			throwAfter: 0,
		});
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "error",
			errorClass: "unknown",
		});
	});

	it("does not emit a second finish when the handler throws after a done chunk", async () => {
		// done -> finish, then the handler throws while flushing.
		const handler = fakeHandler([{ type: "done", success: true, id: "x" }], {
			throwAfter: 1,
		});
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));
		const finishes = events.filter((e) => e.type === "finish");
		expect(finishes).toHaveLength(1);
		expect(finishes[0]).toMatchObject({ type: "finish", reason: "stop" });
	});

	it("resolves the handler lazily from an async factory on stream", async () => {
		const handler = fakeHandler([{ type: "text", text: "lazy", id: "x" }]);
		const factory = vi.fn(async () => handler);
		const model = createAgentModelFromApiHandler(factory);

		// Not built until the stream is consumed.
		expect(factory).not.toHaveBeenCalled();
		const events = await collect(model.stream(baseRequest));
		expect(factory).toHaveBeenCalledTimes(1);
		expect(events[0]).toEqual({ type: "text-delta", text: "lazy" });
	});

	it("converts a rejecting handler factory into a finish(error) event", async () => {
		const factory = vi.fn(async () => {
			throw new Error("no vscode.lm");
		});
		const model = createAgentModelFromApiHandler(factory);
		const events = await collect(model.stream(baseRequest));
		expect(events).toEqual([
			{
				type: "finish",
				reason: "error",
				error: "no vscode.lm",
				errorClass: "unknown",
			},
		]);
	});
});
