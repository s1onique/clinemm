import { createHandlerAsync } from "@cline/llms";
import type { AgentModelFinishReason } from "@cline/shared";
import type { ProviderConfig } from "../../types/provider-settings";

/**
 * ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01.
 *
 * How a cancellation observed DURING the summarizer stream is surfaced.
 *
 * - `throw` — the cancellation is THROWN. This is the pre-existing
 *   behaviour and remains the default, so every existing caller
 *   (`summarizeConversation()`, the pre-compaction knowledge checkpoint)
 *   observes exactly what it observed before.
 * - `report` — the cancellation is REPORTED as a terminal fact of the
 *   generation and the summary result is returned.
 *
 * WHY THE OPT-IN EXISTS
 * ---------------------
 *
 * The summarizer transport is the place where a cancellation becomes
 * OBSERVABLE. A caller whose OWN acceptance authority must decide what a
 * cancelled generation means cannot have the transport pre-empt that
 * decision by throwing: the authority would never be consulted, and the
 * diagnosis would be the transport's rather than the authority's.
 *
 * The agentic compactor is such a caller. Its acceptance decision is the
 * SINGLE authority on whether a cancelled candidate may be installed, and
 * it reads the cancellation through the existing acceptance contract's
 * cancellation precedence. It therefore asks for the cancellation to be
 * REPORTED, so the decision stays where it has always been.
 *
 * This is NOT a second cancellation authority and it introduces no new
 * state: the same abort signal is read, in the same place, and the
 * resulting verdict is the EXISTING one.
 */
export type SummaryCancellationReporting = "throw" | "report";

export async function generateSummary(options: {
	providerConfig: ProviderConfig;
	systemPrompt: string;
	request: string;
	maxOutputChars?: number;
	signal?: AbortSignal;
	/**
	 * ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01.
	 *
	 * How a cancellation observed during the stream is surfaced. Defaults
	 * to `throw` — the pre-existing behaviour.
	 */
	cancellationReporting?: SummaryCancellationReporting;
}) {
	// The PRE-FLIGHT check is unconditional: an already-cancelled
	// generation never reaches the transport, so it never dispatches a
	// physical provider request. This is true for BOTH reporting modes.
	//
	// In `report` mode the cancellation is REPORTED (the generation ends
	// with no provider request at all) instead of thrown, so the caller's
	// own acceptance authority still decides what it means.
	if (options.signal?.aborted === true) {
		if (options.cancellationReporting === "report") {
			return {
				text: "",
				reasoningChars: 0,
				failed: true,
				usedTools: false,
				incompleteReason: undefined,
				completed: false,
				finishReason: undefined,
				cancelled: true,
			};
		}
		options.signal.throwIfAborted();
	}
	const handler = await createHandlerAsync(
		options.signal
			? { ...options.providerConfig, abortSignal: options.signal }
			: options.providerConfig,
	);
	// The handler was built but the request was cancelled before the
	// stream was consumed. No stream was started, so no further provider
	// request is dispatched.
	if (options.signal?.aborted === true) {
		if (options.cancellationReporting === "report") {
			return {
				text: "",
				reasoningChars: 0,
				failed: true,
				usedTools: false,
				incompleteReason: undefined,
				completed: false,
				finishReason: undefined,
				cancelled: true,
			};
		}
		options.signal.throwIfAborted();
	}
	let text = "";
	let reasoningChars = 0;
	let failed = false;
	let usedTools = false;
	let incompleteReason: string | undefined;
	// ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01: the reported
	// terminal reason.
	//
	// The transport distinguishes an UNEStablished completion (the provider
	// never reported a terminal reason — the response may be cut off) from a
	// KNOWN failure (the stream failed). Both arrive as `success: false`, so
	// `failed` alone cannot tell them apart, and the reported reason is the
	// only fact that can.
	//
	// It is preserved verbatim: `unknown` stays `unknown` and is NOT turned
	// into a normal completion, and it is NOT turned into an invented
	// provider failure either.
	let finishReason: AgentModelFinishReason | undefined;
	// ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01: whether
	// the transport reported its completion event at all.
	//
	// The transport contract says a handler MAY finish without emitting an
	// optional done chunk, so the ABSENCE of the chunk is not by itself a
	// failure. But a stream that ENDED — with text and without a completion
	// event — is distinguishable from one that ended normally, and the
	// acceptance contract needs that distinction: an unexpected stream
	// termination must not be read as a successful completion.
	//
	// `undefined` means "the transport never reported a completion event",
	// which the acceptance contract classifies as the LEGACY shape when the
	// stream ended normally.
	let completed: boolean | undefined;
	// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01: whether the
	// generation was CANCELLED while it was streaming.
	//
	// It is a TERMINAL FACT of the generation, reported alongside the other
	// terminal facts, so the caller's own acceptance authority can decide
	// what it means. It is never silently dropped.
	let cancelled = false;
	/**
	 * The cancellation check performed at a point where the stream is
	 * already under way.
	 *
	 * In `throw` mode (the default) it throws, exactly as before. In
	 * `report` mode it records the cancellation and ends the local
	 * consumption, so the transport's cancellation boundary is what stops
	 * the stream.
	 */
	const observeCancellation = (): void => {
		if (options.signal?.aborted !== true) {
			return;
		}
		if (options.cancellationReporting === "report") {
			cancelled = true;
			return;
		}
		options.signal.throwIfAborted();
	};
	for await (const chunk of handler.createMessage(options.systemPrompt, [
		{ role: "user", content: options.request },
	])) {
		observeCancellation();
		if (chunk.type === "text") {
			text += chunk.text;
			if (options.maxOutputChars && text.length > options.maxOutputChars) {
				throw new Error("Summary exceeded its output limit.");
			}
		} else if (chunk.type === "reasoning") {
			reasoningChars += chunk.reasoning?.length ?? 0;
		} else if (chunk.type === "done") {
			if (!chunk.success && chunk.error) throw new Error(chunk.error);
			incompleteReason = chunk.incompleteReason ?? incompleteReason;
			failed ||= !chunk.success;
			// ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01: the
			// reported terminal reason is carried through unchanged.
			//
			// The FIRST reported reason wins: a done chunk reports the
			// terminal fact of the turn, and a later chunk cannot retract it.
			finishReason ??= chunk.finishReason;
			completed = true;
		} else if (chunk.type === "tool_calls") {
			usedTools = true;
		}
	}
	observeCancellation();
	// Handlers may finish normally without emitting an optional done chunk.
	return {
		text,
		reasoningChars,
		failed,
		usedTools,
		incompleteReason,
		completed,
		finishReason,
		cancelled,
	};
}
