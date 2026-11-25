import { createHandlerAsync } from "@cline/llms";
import type { AgentModelFinishReason } from "@cline/shared";
import type { ProviderConfig } from "../../types/provider-settings";

export async function generateSummary(options: {
	providerConfig: ProviderConfig;
	systemPrompt: string;
	request: string;
	maxOutputChars?: number;
	signal?: AbortSignal;
}) {
	options.signal?.throwIfAborted();
	const handler = await createHandlerAsync(
		options.signal
			? { ...options.providerConfig, abortSignal: options.signal }
			: options.providerConfig,
	);
	options.signal?.throwIfAborted();
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
	for await (const chunk of handler.createMessage(options.systemPrompt, [
		{ role: "user", content: options.request },
	])) {
		options.signal?.throwIfAborted();
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
	options.signal?.throwIfAborted();
	// Handlers may finish normally without emitting an optional done chunk.
	return {
		text,
		reasoningChars,
		failed,
		usedTools,
		incompleteReason,
		completed,
		finishReason,
	};
}
