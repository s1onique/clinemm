import { createHandlerAsync } from "@cline/llms";
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
	};
}
