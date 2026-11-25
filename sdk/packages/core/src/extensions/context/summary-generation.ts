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

/**
 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01.
 *
 * The PROVIDER-REPORTED USAGE of ONE summarization inference.
 *
 * The counters are the provider's own numbers for that request. They are
 * never estimated, never derived from a character count, and never invented:
 * an absent provider metric stays ABSENT.
 *
 * The semantics are DELTA — the usage of THIS request — not a running
 * total. That is the same semantics the main model's usage events use, so
 * the existing accounting mechanism treats a summarization request exactly
 * like any other provider request.
 */
export interface SummaryUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	totalCost?: number;
	reasoningTokenCount?: number;
}

/**
 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §3) —
 * THE NORMALIZED USAGE EVENT.
 *
 * The shape the RESOLVED provider adapter's `usage` event carries. The
 * adapter (`@cline/llms`'s `ai-sdk` provider) normalizes every provider's
 * usage into exactly these counters, so the summarizer reads the SAME
 * shape the main model's usage uses.
 *
 * The fields are the provider's own numbers. None of them is derived, and
 * an absent one stays ABSENT.
 */
export interface NormalizedUsageEvent {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	totalCost?: number;
	thoughtsTokenCount?: number;
}

/**
 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §3) —
 * THE USAGE COLLECTOR.
 *
 * It reads the provider's `usage` chunk from the summarizer stream and
 * returns the provider's own numbers.
 *
 * WHY THE COLLECTION IS NOT OPTIONAL
 * -----------------------------------
 *
 * The usage is a fact of the INFERENCE, not of its acceptance. A summary
 * that is rejected, cancelled or refused at the persistence boundary was
 * still PAID FOR. So the collection happens on the way OUT of the stream,
 * before any acceptance decision is taken, and it is independent of whether
 * the candidate is installed.
 *
 * THE NORMALIZED SEMANTICS — ONE AUTHORITATIVE FINAL REPORT
 * ----------------------------------------------------------
 *
 * The RESOLVED provider adapter emits EXACTLY ONE `usage` event per
 * physical request, and that event is the request's own CUMULATIVE
 * SNAPSHOT: the AI SDK's `stream.usage` ("complete usage data") or the
 * finish part's `totalUsage` ("Usage snapshot at end of stream"). It is
 * NOT an incremental delta, and it is NOT a running total across
 * requests.
 *
 * So the collector keeps the FIRST report and does NOT sum: summation is
 * correct only for deltas, and it would DOUBLE the request's usage if a
 * provider ever emitted more than one chunk. The collector therefore
 * treats the first reported chunk as the request's authoritative usage and
 * ignores any later one.
 *
 * This is the SAME rule the runtime's own accumulation uses: the runtime
 * ADDS each reported usage into its cumulative state, so a second report
 * of the same request would be counted twice.
 */
function collectUsageChunk(
	accumulated: SummaryUsage | undefined,
	chunk: NormalizedUsageEvent,
): SummaryUsage {
	// The FIRST report is the request's authoritative usage. A later chunk
	// for the SAME physical request would re-report the same cumulative
	// snapshot, so it is not added.
	if (accumulated !== undefined) {
		return accumulated;
	}
	const cacheReadTokens = chunk.cacheReadTokens ?? 0;
	const cacheWriteTokens = chunk.cacheWriteTokens ?? 0;
	const totalCost = chunk.totalCost ?? 0;
	const reasoningTokenCount = chunk.thoughtsTokenCount ?? 0;
	return {
		inputTokens: chunk.inputTokens ?? 0,
		outputTokens: chunk.outputTokens ?? 0,
		...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
		...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
		...(totalCost > 0 ? { totalCost } : {}),
		...(reasoningTokenCount > 0 ? { reasoningTokenCount } : {}),
	};
}

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
	/**
	 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §1)
	 * — THE USAGE SINK.
	 *
	 * The channel through which the summarizer reports the
	 * PROVIDER-REPORTED USAGE of its inference.
	 *
	 * WHY THE SINK LIVES HERE AND NOT AT THE CALLER
	 * ---------------------------------------------
	 *
	 * The usage is observed INSIDE the provider stream. A transport that
	 * fails after the provider already reported its usage — a thrown
	 * transport exception, a cancellation raised by the transport's own
	 * boundary — ends the generation by THROWING, so a caller that reports
	 * the usage after `generateSummary()` RETURNS never sees it at all.
	 * The usage of a PAID inference was then lost on the floor.
	 *
	 * The sink therefore lives at the summarizer's own boundary, and the
	 * summarizer FINALIZES it on EVERY exit: the normal return and the
	 * exceptional one alike. The report happens exactly once, whatever
	 * ended the generation.
	 *
	 * The sink NEVER suppresses the original terminal exception: the
	 * finalization runs in a `finally`, so the transport's own error — or
	 * the cancellation it raised — remains the authoritative outcome.
	 */
	reportUsage?: (usage: {
		/**
		 * The PHYSICAL provider request the usage belongs to.
		 *
		 * It is the transport's own per-request identity (`gw_<nanoid>`),
		 * NOT a logical identity derived from the compaction's position:
		 * two summarization invocations of the SAME logical iteration are
		 * TWO physical requests and are therefore distinguishable.
		 */
		requestId: string | undefined;
		/** What the inference was for. */
		kind: "summarization";
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
		reasoningTokenCount?: number;
	}) => void;
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
				usage: undefined,
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
				usage: undefined,
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
	// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01: the
	// PROVIDER-REPORTED USAGE of this inference.
	//
	// It is collected ON THE WAY OUT of the provider stream, so it is
	// captured whether the candidate is later accepted, rejected, cancelled
	// or refused at the persistence boundary. A rejected summary is not
	// free inference.
	//
	// It stays ABSENT when the provider reported no usage: an absent
	// provider metric is unknown, and it is never turned into a
	// zero-cost inference.
	let usage: SummaryUsage | undefined;
	// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §4)
	// — THE PHYSICAL REQUEST IDENTITY.
	//
	// The transport stamps a fresh per-request identity on the stream it
	// returns (`gw_<nanoid>`), and the summarizer reads it from there. It
	// identifies the PHYSICAL provider request, so two summarization
	// invocations that share one logical iteration — one logical turn, two
	// physical requests — remain distinguishable.
	let requestId: string | undefined;
	/**
	 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §1)
	 * — THE SINGLE FINALIZATION MECHANISM.
	 *
	 * It reports the accumulated usage EXACTLY ONCE, on whichever exit the
	 * generation took.
	 *
	 * It is idempotent by construction: the flag is set BEFORE the sink is
	 * invoked, so a re-entrant finalization cannot report twice.
	 *
	 * It NEVER reports when the provider reported no usage: an absent
	 * provider metric is unknown, and it is never turned into a zero-cost
	 * inference.
	 */
	let usageReported = false;
	const finalizeUsage = (): void => {
		if (usageReported) {
			return;
		}
		usageReported = true;
		if (usage === undefined || options.reportUsage === undefined) {
			return;
		}
		options.reportUsage({
			requestId,
			kind: "summarization",
			...usage,
		});
	};
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
	try {
		const stream = handler.createMessage(options.systemPrompt, [
			{ role: "user", content: options.request },
		]);
		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		// (AMENDMENT-02 §4): the transport's own per-request identity.
		requestId = stream.id;
		for await (const chunk of stream) {
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
			} else if (chunk.type === "usage") {
				// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01: the
				// provider's own numbers for this request.
				//
				// The chunk is read BEFORE any acceptance decision is taken, so
				// the usage survives every outcome of the generation.
				usage = collectUsageChunk(usage, chunk);
			}
		}
		observeCancellation();
	} finally {
		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		// (AMENDMENT-02 §1): THE FINALIZATION.
		//
		// The usage leaves the summarizer on EVERY exit — the normal return
		// AND the exceptional one. A transport exception, or a cancellation
		// raised by the transport's own boundary, ends the generation by
		// throwing; the usage the provider already reported is still
		// accounted, because it was PAID FOR.
		//
		// The finalization does NOT suppress the original exception: it runs
		// in a `finally` and does not throw, so the transport's own terminal
		// exception remains the authoritative outcome of the generation.
		finalizeUsage();
	}
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
		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01: the
		// provider-reported usage travels with the result, whatever became
		// of the summary.
		//
		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		// (AMENDMENT-02 §1): it ALSO leaves the summarizer through the
		// `reportUsage` sink above, on both the normal and the exceptional
		// exit. The field remains for the callers that read it, and it is
		// the SAME value — the sink and the field never disagree.
		usage,
	};
}
