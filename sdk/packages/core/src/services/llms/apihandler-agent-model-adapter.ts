/**
 * Adapter: wrap a custom `ApiHandler` (from the `@cline/llms` handler registry)
 * as an `AgentModel` for the agent runtime.
 *
 * The agent runtime builds models via `createAgentModelFromConfig`, which goes
 * straight to the gateway. Hosts can register provider handlers that need
 * host-only dependencies (e.g. the VS Code `vscode.lm` API) via
 * `registerHandler(providerId, factory)`. Those produce an `ApiHandler`
 * (`createMessage` -> `ApiStreamChunk`), which this adapter converts into the
 * `AgentModel` contract (`stream` -> `AgentModelEvent`).
 *
 * This is the inverse of the gateway's `toApiStreamChunk` in
 * `@cline/llms` `compat.ts`.
 */

import {
	type ApiHandler,
	type ApiStreamChunk,
	classifyProviderError,
} from "@cline/llms";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelFinishReason,
	AgentModelRequest,
} from "@cline/shared";
import { agentMessagesToMessages } from "../../runtime/config/agent-message-codec";

type ApiStreamDoneChunk = Extract<ApiStreamChunk, { type: "done" }>;

function toAgentModelEvents(chunk: ApiStreamChunk): AgentModelEvent[] {
	switch (chunk.type) {
		case "text":
			return [{ type: "text-delta", text: chunk.text }];
		case "media":
			return [{ type: "media", media: chunk.media }];
		case "reasoning":
			// Thought signatures are read as `metadata.thoughtSignature` by
			// downstream adapters (see ai-sdk format), so surface it there.
			return [
				{
					type: "reasoning-delta",
					text: chunk.reasoning,
					metadata: chunk.signature
						? { thoughtSignature: chunk.signature, details: chunk.details }
						: { details: chunk.details },
				},
			];
		case "tool_calls": {
			const fn = chunk.tool_call.function;
			const args = fn.arguments;
			return [
				{
					type: "tool-call-delta",
					toolCallId: chunk.tool_call.call_id ?? fn.id,
					toolName: fn.name,
					inputText: typeof args === "string" ? args : undefined,
					input: typeof args === "string" ? undefined : args,
					// Preserve the thought signature so it isn't dropped downstream.
					...(chunk.signature
						? { metadata: { thoughtSignature: chunk.signature } }
						: {}),
				},
			];
		}
		case "usage":
			return [
				{
					type: "usage",
					usage: {
						inputTokens: chunk.inputTokens,
						outputTokens: chunk.outputTokens,
						cacheReadTokens: chunk.cacheReadTokens,
						cacheWriteTokens: chunk.cacheWriteTokens,
						reasoningTokenCount: chunk.thoughtsTokenCount,
						totalCost: chunk.totalCost,
					},
				},
			];
		case "done":
			// `createMessage` streams typically end by returning; a "done" chunk is
			// optional. Map it to a finish event so the runtime sees a terminal
			// signal even when the handler emits one explicitly.
			return [
				{
					type: "finish",
					reason: doneFinishReason(chunk),
					error: chunk.error,
					// Handlers report failures as an already-flattened message, so
					// classification works from the text alone here. Keeps registered
					// handlers (e.g. VS Code LM) eligible for the runtime's
					// context-overflow recovery.
					...(chunk.error
						? { errorClass: classifyProviderError(chunk.error) }
						: {}),
				},
			];
		default:
			return [];
	}
}

function doneFinishReason(chunk: ApiStreamDoneChunk): AgentModelFinishReason {
	// ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01
	// (AMENDMENT-02 C1) — THE PRESERVED TERMINAL REASON.
	//
	// The compatibility adapter now reports `success: false` for a stream
	// that ended WITHOUT the provider establishing a successful completion —
	// which covers BOTH a failed stream and an UNEStablished completion
	// (the provider reported no terminal reason). Those two are different
	// facts and the runtime handles them differently: a failure is an error,
	// while an unestablished completion is an incomplete turn
	// ("Model ended without a recognized finish reason").
	//
	// The adapter therefore preserves the terminal reason on the done chunk
	// so the distinction survives, and this mapping uses it. A legacy
	// handler that reports no reason at all keeps the previous behaviour.
	//
	// The NEGATIVE SIGNAL PRECEDENCE is preserved: a chunk that reports a
	// FAILED stream (`success: false`) with an error message is a FAILURE
	// (`error`), not the `unknown` it would otherwise carry. The reported
	// reason is authoritative about the TERMINAL FACT, but it must not
	// override an explicit failure signal — otherwise a genuine failure would
	// be laundered into an "unestablished completion" and would lose the
	// runtime's error recovery.
	//
	// ACT-CLINEMM-CMP05-TERMINAL-NEGATIVE-SIGNAL-PRECEDENCE-01 — THE
	// CONFLICTING TERMINAL SIGNALS.
	//
	// The terminal fields of a done chunk can disagree with each other, and
	// the ORDER OF AUTHORITY is what keeps a failed turn from being
	// normalized into a successful completion:
	//
	//   1. An explicit INCOMPLETENESS is authoritative. The provider told
	//      us the response was cut short; a reported `stop` does not
	//      retract that, and the established max-token / content-filter
	//      mappings survive a conflicting reason.
	//   2. A REPORTED FAILURE (`success: false`) is authoritative. A
	//      reported reason does not turn a failed stream into a successful
	//      completion, whatever that reason says.
	//   3. Only then is the reported reason consulted.
	//
	// `unknown` is preserved AS `unknown`. It is not converted into a normal
	// completion, and it is not converted into an invented provider failure:
	// it means exactly what the shared contract says it means — the response
	// may be cut off and an authoritative successful completion has NOT been
	// established.
	if (
		chunk.incompleteReason === "max_output_tokens" ||
		chunk.incompleteReason === "max-tokens"
	) {
		return "max-tokens";
	}
	if (
		chunk.incompleteReason === "content_filter" ||
		chunk.incompleteReason === "content-filter"
	) {
		return "content-filter";
	}
	if (chunk.success === false) {
		// A reported error message is a FAILURE. A reported `unknown` is not:
		// it is an UNEStablished completion, which the runtime handles as an
		// incomplete turn rather than as an error.
		//
		// Any OTHER reported reason on a failed stream is also not a
		// successful completion: the stream failed, so the reason cannot
		// make it one.
		if (
			chunk.error !== undefined ||
			chunk.finishReason === undefined ||
			chunk.finishReason === "stop" ||
			chunk.finishReason === "tool-calls"
		) {
			return "error";
		}
		return chunk.finishReason;
	}
	if (chunk.finishReason !== undefined) {
		return chunk.finishReason;
	}
	return "stop";
}

/**
 * Resolves the `ApiHandler` to delegate to. A function is supported (and may be
 * async) so handler construction can be deferred to the first `stream` call —
 * which is required for providers registered via `registerAsyncHandler`.
 */
export type ApiHandlerSource =
	| ApiHandler
	| (() => ApiHandler | Promise<ApiHandler>);

/**
 * Build an `AgentModel` that delegates to a registered `ApiHandler`.
 */
export function createAgentModelFromApiHandler(
	source: ApiHandlerSource,
): AgentModel {
	return {
		async *stream(request: AgentModelRequest): AsyncGenerator<AgentModelEvent> {
			let sawFinish = false;
			let sawToolCall = false;
			try {
				// Resolving the handler (e.g. `createHandlerAsync`) can reject — for
				// instance when the host API is unavailable at stream time — so it
				// happens inside the try block to be reported as a terminal finish.
				const handler = typeof source === "function" ? await source() : source;

				// Forward the abort signal so cancellation reaches the handler.
				handler.setAbortSignal?.(request.signal);

				const messages = agentMessagesToMessages(request.messages);
				const tools = request.tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema,
				}));

				for await (const chunk of handler.createMessage(
					request.systemPrompt ?? "",
					messages,
					tools,
				)) {
					for (const event of toAgentModelEvents(chunk)) {
						if (event.type === "finish") {
							sawFinish = true;
						} else if (event.type === "tool-call-delta") {
							sawToolCall = true;
						}
						yield event;
					}
				}
				if (!sawFinish) {
					// Terminating with tool calls is a tool-calls turn (matching the
					// gateway/AI-SDK adapters); otherwise a normal stop.
					yield {
						type: "finish",
						reason: sawToolCall ? "tool-calls" : "stop",
					};
				}
			} catch (error) {
				if (!sawFinish) {
					const aborted = request.signal?.aborted === true;
					yield {
						type: "finish",
						reason: aborted ? "aborted" : "error",
						error: error instanceof Error ? error.message : String(error),
						// Classify while the raw error is still structured — the
						// message alone can hide the provider's detail (status codes,
						// response bodies). Without this, an overflow rejection from a
						// registered handler would never reach recovery.
						...(aborted ? {} : { errorClass: classifyProviderError(error) }),
					};
				}
			}
		},
	};
}
