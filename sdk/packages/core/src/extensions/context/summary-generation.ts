import { createHandlerAsync } from "@cline/llms";
import type {
	AgentModelFinishReason,
	BasicLogger,
	Message,
	ToolDefinition,
} from "@cline/shared";
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
	/**
	 * ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A2): the input and
	 * output counters are MANDATORY.
	 *
	 * The producer's own contract (`ApiStreamUsageChunk`) makes them
	 * mandatory: they are the request's input and output sizes, and every
	 * provider reports them. They are therefore NOT optional counters, and
	 * the collector does not need to invent an absent-value case for them.
	 */
	inputTokens: number;
	outputTokens: number;
	/**
	 * The OPTIONAL counters. They are optional because the provider may not
	 * report them — NOT because they may be reported as zero.
	 */
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
	// ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A2) — PRESENCE,
	// NOT POSITIVITY.
	//
	// The normalized contract makes `inputTokens`/`outputTokens` MANDATORY
	// and the rest OPTIONAL (`ApiStreamUsageChunk`). An OPTIONAL counter is
	// optional because the provider did not report it — NOT because it
	// reported it as zero.
	//
	// The previous implementation collapsed the two cases: an absent counter
	// became zero, and the zero was then dropped because it was not
	// POSITIVE. An explicitly reported zero cost, cache count or reasoning
	// count therefore became ABSENT, and the accounting downstream could no
	// longer tell "the provider reported zero" from "the provider said
	// nothing".
	//
	// So the optional counters are carried by PRESENCE: a counter the
	// provider reported is carried even when it is zero, and a counter it
	// did not report stays ABSENT. The mandatory counters are carried
	// through as they are, because the normalized contract guarantees
	// them.
	return {
		inputTokens: chunk.inputTokens,
		outputTokens: chunk.outputTokens,
		...(chunk.cacheReadTokens !== undefined
			? { cacheReadTokens: chunk.cacheReadTokens }
			: {}),
		...(chunk.cacheWriteTokens !== undefined
			? { cacheWriteTokens: chunk.cacheWriteTokens }
			: {}),
		...(chunk.totalCost !== undefined ? { totalCost: chunk.totalCost } : {}),
		...(chunk.thoughtsTokenCount !== undefined
			? { reasoningTokenCount: chunk.thoughtsTokenCount }
			: {}),
	};
}

export async function generateSummary(options: {
	providerConfig: ProviderConfig;
	systemPrompt: string;
	request: string;
	/**
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01.
	 *
	 * The EXPLICIT message array for the request.
	 *
	 * When it is ABSENT — which is the case for every request that did not
	 * opt in — the transport sends the pre-existing single user message
	 * containing `request`, byte for byte.
	 *
	 * When it is PRESENT, the transport sends EXACTLY these messages and
	 * the `request` string is not sent. It exists so the prefix-preserving
	 * PCK route can dispatch the PARENT's provider-visible messages plus one
	 * appended extraction suffix, so the leading serialized messages are
	 * byte-identical to the parent's.
	 */
	messages?: readonly Message[];
	/**
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01.
	 *
	 * The VISIBLE tool schema for the request.
	 *
	 * When it is ABSENT, no tools are sent, exactly as before. When it is
	 * PRESENT the tools are advertised to the provider — so the rendered
	 * request matches the parent's — but the transport NEVER invokes an
	 * executor: a tool call in the response stream is reported as
	 * `usedTools`, and the caller rejects it.
	 */
	tools?: readonly ToolDefinition[];
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
	/**
	 * ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A1) — THE DIAGNOSTIC
	 * CHANNEL.
	 *
	 * The EXISTING logger of the calling seam. It is used ONLY to report a
	 * delivery failure of the usage sink; it is not a second accounting
	 * channel and it carries no accounting state.
	 */
	logger?: BasicLogger;
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
	// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
	// — F2: the OBSERVED physical attempt count. It is ABSENT when the
	// provider established no cardinality.
	let physicalAttemptCount: number | undefined;
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
	 *
	 * ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A1) — THE ACCOUNTING
	 * FAILURE NEVER REPLACES THE GENERATION'S OUTCOME.
	 *
	 * The finalization runs in a `finally`, so it runs WHILE a terminal
	 * exception is already in flight. Before this correction the sink was
	 * invoked WITHOUT an exception boundary: a sink that threw replaced the
	 * in-flight exception in the `finally`, so the generation ended with the
	 * ACCOUNTING failure and the TRANSPORT failure — the authoritative
	 * outcome of a paid inference — was LOST.
	 *
	 * The sink invocation is therefore bounded: a delivery failure is
	 * REPORTED through the existing diagnostic channel (the logger) and
	 * NEVER rethrown. The generation's own outcome — a normal return, a
	 * transport failure or a cancellation — stays authoritative.
	 *
	 * No second accounting ledger and no retry subsystem is introduced: the
	 * sink is called exactly as before, exactly once.
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
		try {
			options.reportUsage({
				requestId,
				kind: "summarization",
				...usage,
			});
		} catch (error) {
			// ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A1): the
			// delivery failure is DIAGNOSED, not escalated. Escalating it
			// would replace the generation's authoritative outcome.
			options.logger?.error?.(
				"Failed to deliver the summarization's provider-reported usage.",
				{ requestId, error },
			);
		}
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
		// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01.
		//
		// The EXPLICIT message array is used when it is present. When it is
		// ABSENT the pre-existing single user message is sent, so every
		// request that did not opt in keeps its byte-identical body.
		const stream = handler.createMessage(
			options.systemPrompt,
			options.messages
				? [...options.messages]
				: [{ role: "user", content: options.request }],
			options.tools ? [...options.tools] : undefined,
		);
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
				// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01
				// (AMENDMENT-01) — F2.
				//
				// The OBSERVED PHYSICAL ATTEMPT COUNT. The usage chunk
				// carries the middleware-owned physical-request OCCUPANCY
				// AUTHORITY, whose `attemptCount` is the number of physical
				// `doStream()` calls the turn actually made. It is never
				// synthesized: an absent authority stays absent, and an
				// authority that established no cardinality stays unknown.
				const occupancy = chunk.requestOccupancy;
				if (occupancy?.attemptCount !== undefined) {
					physicalAttemptCount = occupancy.attemptCount;
				}
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
		// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C8.
		//
		// The PHYSICAL provider request identity, so a capture can JOIN
		// this attempt with the provider's own request record.
		providerRequestId: requestId,
		// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01
		// (AMENDMENT-01) — F2.
		//
		// The OBSERVED physical attempt count. It is ABSENT when the
		// provider established no cardinality; it is NEVER a hardcoded
		// constant.
		...(physicalAttemptCount !== undefined ? { physicalAttemptCount } : {}),
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
