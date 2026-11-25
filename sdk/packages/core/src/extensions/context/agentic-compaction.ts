import type { BasicLogger } from "@cline/shared";
import { countUserRunMessages } from "../../session/user-run-messages";
import type {
	CoreCompactionContext,
	CoreCompactionResult,
	CoreCompactionSummarizerConfig,
} from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";
import {
	type BudgetProjectionResult,
	buildBudgetProjection,
} from "./budget-projection";
import {
	buildSummaryMessage,
	buildSummaryRequest,
	type EstimateMessageTokens,
	ensureFilesSection,
	estimateTokens,
	extractFileOps,
	findCutIndex,
	findLatestSummaryIndex,
	getCompactionSummaryMetadata,
	resolveProviderMaxInputTokens,
	resolveSummarizerConfig,
	serializeConversation,
} from "./compaction-shared";
import { classifySummaryTerminalStatus } from "./summary-acceptance";
import { generateSummary } from "./summary-generation";

const MIN_AGENTIC_SUMMARY_INPUT_TOKENS = 1_024;

/**
 * ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01 (AMENDMENT-02 §4) —
 * THE PHYSICAL REQUEST IDENTITY OF THE SUMMARIZATION INFERENCE.
 *
 * The summarization request is a REAL provider request, distinct from the
 * main model request, and its usage has to be attributed to THAT request.
 *
 * The identity is the transport's OWN per-request identity — the
 * `gw_<nanoid>` the compatibility adapter stamps on the stream it
 * returns. It is a PHYSICAL identity: a fresh one per `createMessage`
 * call, i.e. per physical provider request.
 *
 * It is deliberately NOT a logical identity derived from the compaction's
 * position (`conversationId`, `iteration`, `agentId`): two summarization
 * invocations that share ONE logical iteration are TWO physical provider
 * requests, and a logical tuple cannot tell them apart. The transport's
 * own identity can.
 *
 * It is NOT the main model's request identity either: the summarization
 * request is a different physical request to the provider, and conflating
 * the two would make the summarization's cost indistinguishable from the
 * agent's own turn.
 */
export function buildAgenticSummaryInputBudget(options: {
	messages: CoreCompactionContext["messages"];
	targetTokens: number;
	estimateMessageTokens: EstimateMessageTokens;
}): BudgetProjectionResult {
	return buildBudgetProjection({
		messages: options.messages,
		targetTokens: Math.max(1, options.targetTokens),
		policyIntent: "agentic_summary",
		estimateMessageTokens: options.estimateMessageTokens,
	});
}

function safeJsonSize(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return String(value).length;
	}
}

export async function runAgenticCompaction(options: {
	context: CoreCompactionContext;
	providerConfig: ProviderConfig;
	summarizer?: CoreCompactionSummarizerConfig;
	preserveRecentTokens: number;
	estimateMessageTokens: EstimateMessageTokens;
	logger?: BasicLogger;
}): Promise<CoreCompactionResult | undefined> {
	const messages = options.context.messages;
	if (messages.length < 2) {
		return undefined;
	}

	const cutIndex = findCutIndex(
		messages,
		options.preserveRecentTokens,
		options.estimateMessageTokens,
	);
	if (cutIndex <= 0 || cutIndex >= messages.length) {
		return undefined;
	}

	const messagesToSummarize = messages.slice(0, cutIndex);
	const latestSummaryIndex = findLatestSummaryIndex(messagesToSummarize);
	const previousSummary =
		latestSummaryIndex >= 0
			? getCompactionSummaryMetadata(messagesToSummarize[latestSummaryIndex])
					?.summary
			: undefined;
	const newMessagesToFold =
		latestSummaryIndex >= 0
			? messagesToSummarize.slice(latestSummaryIndex + 1)
			: messagesToSummarize;
	if (newMessagesToFold.length === 0) {
		return undefined;
	}

	const preProjectionFileOps = extractFileOps(messagesToSummarize);
	const summarizerProviderConfig = resolveSummarizerConfig({
		activeProviderConfig: options.providerConfig,
		summarizer: options.summarizer,
	});
	const resolvedSummarizerInputLimit = resolveProviderMaxInputTokens(
		summarizerProviderConfig,
	);
	const canUseActiveContextLimit = options.summarizer === undefined;
	const activeCompactionInputLimit = Math.max(
		options.context.budget.request.maxInputTokens,
		options.context.budget.request.triggerTokens,
		MIN_AGENTIC_SUMMARY_INPUT_TOKENS,
	);
	if (resolvedSummarizerInputLimit === undefined && !canUseActiveContextLimit) {
		options.logger?.log(
			"Agentic compaction summarizer has no known input limit; using conservative summary budget",
			{
				severity: "warn",
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
				fallbackInputLimit: MIN_AGENTIC_SUMMARY_INPUT_TOKENS,
			},
		);
	}
	const summarizerInputLimit =
		resolvedSummarizerInputLimit ??
		(canUseActiveContextLimit
			? activeCompactionInputLimit
			: MIN_AGENTIC_SUMMARY_INPUT_TOKENS);
	const summaryRequestOverheadTokens = estimateTokens(
		buildSummaryRequest({
			previousSummary,
			conversationText: "",
			fileOps: preProjectionFileOps,
		}).length,
	);
	const availableSummaryInputTokens =
		summarizerInputLimit - summaryRequestOverheadTokens;
	if (availableSummaryInputTokens <= 0) {
		options.logger?.debug(
			"Skipped agentic compaction: summarizer budget exhausted",
			{
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
				summarizerInputLimit,
				summaryRequestOverheadTokens,
			},
		);
		return undefined;
	}
	const summaryInputBudget = buildAgenticSummaryInputBudget({
		messages: newMessagesToFold,
		targetTokens: availableSummaryInputTokens,
		estimateMessageTokens: options.estimateMessageTokens,
	});
	if (summaryInputBudget.status === "failed") {
		options.logger?.log(
			"Skipped agentic compaction: summary input budget failed",
			{
				severity: "warn",
				budgetWarnings: summaryInputBudget.warnings.map(
					(warning) => warning.code,
				),
				summaryInputEstimatedTokens: summaryInputBudget.estimatedTokens,
				targetTokens: availableSummaryInputTokens,
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
			},
		);
		return undefined;
	}
	const fileOps = extractFileOps(summaryInputBudget.messages);
	const conversationText = serializeConversation(summaryInputBudget.messages);
	const summaryRequest = buildSummaryRequest({
		previousSummary,
		conversationText,
		fileOps,
	});
	options.logger?.debug("Agentic compaction summarizer diagnostics", {
		messagesToSummarize: messagesToSummarize.length,
		newMessagesToFold: newMessagesToFold.length,
		preservedMessages: messages.length - cutIndex,
		previousSummaryChars: previousSummary?.length ?? 0,
		conversationTextChars: conversationText.length,
		summaryRequestChars: summaryRequest.length,
		summaryRequestEstimatedTokens: estimateTokens(summaryRequest.length),
		newMessagesJsonChars: safeJsonSize(newMessagesToFold),
		summaryInputEstimatedTokens: summaryInputBudget.estimatedTokens,
		summaryInputActions: summaryInputBudget.actions.length,
		summaryInputWarnings: summaryInputBudget.warnings.map(
			(warning) => warning.code,
		),
		summaryRequestOverheadTokens,
		summarizerProviderId: summarizerProviderConfig.providerId,
		summarizerModelId: summarizerProviderConfig.modelId,
		summarizerInputLimit,
		maxInputTokens: options.context.budget.request.maxInputTokens,
		triggerTokens: options.context.budget.request.triggerTokens,
	});
	// ACT-CLINEMM-CMP05-CANCELLATION-AUTHORITY-01 — THE CANCELLATION
	// AUTHORITY.
	//
	// The compaction's abort signal is the SINGLE authority on cancellation,
	// and it reaches this boundary as `options.context.abortSignal`. It was
	// previously INERT here: the acceptance decision never consulted it, so
	// a cancelled compaction still installed and published a replacement
	// summary.
	//
	// The authority is exercised at TWO points, and both read the SAME
	// signal. There is no second cancellation authority.
	//
	//   1. HERE, at the TRANSPORT — the signal is handed to the summarizer
	//      transport, which forwards it into the provider configuration
	//      (`createHandlerAsync({ ..., abortSignal })`). From there the
	//      EXISTING transport chain carries it to the transport's own
	//      cancellation boundary (`ProviderConfig.abortSignal` ->
	//      `GatewayStreamRequest.signal` -> `provider.stream(request, {
	//      signal })` -> the vendor client's `abortSignal`). This is an
	//      EFFICIENCY mechanism: it stops an unnecessary inference after
	//      the user cancelled. It is NOT the correctness mechanism, and it
	//      does not replace the acceptance decision below.
	//
	//   2. AT THE ACCEPTANCE DECISION below, which reads the signal AFTER
	//      the summarizer returned. This is the CORRECTNESS mechanism, and
	//      it is what refuses a candidate the provider reported as
	//      successful when the compaction was cancelled.
	//
	// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — THE
	// PROPAGATION.
	//
	// Before this ACT the transport was invoked WITHOUT the signal, so a
	// cancelled compaction still PAID for a full provider inference: the
	// work was dispatched, streamed, and only then discarded at the
	// acceptance decision. The sibling path `summarizeConversation()`
	// already forwarded its signal the same way, and `generateSummary()`
	// already accepted and forwarded a `signal` — the mechanism EXISTED
	// and was simply not used here.
	//
	// The signal threaded here is the SAME `options.context.abortSignal`
	// the acceptance decision reads. It is not a new controller, it is not
	// an independent authority, and it introduces no new state.
	//
	// THE LATE-SUCCESS CASE IS STILL REACHABLE.
	//
	// A provider that IGNORES the cancellation and reports a successful
	// completion is still refused by the acceptance decision below: the
	// transport cancellation is an efficiency mechanism, never a
	// replacement for acceptance correctness.
	//
	// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — WHAT THE
	// TRANSPORT'S CANCELLATION DOES.
	//
	// With the signal threaded, the summarizer transport can now END by
	// THROWING the cancellation: the transport's own boundary fired, or the
	// transport's between-chunks check observed the abort.
	//
	// That throw PROPAGATES, exactly as the pre-existing contract requires:
	// a cancellation inside the summarizer transport is re-thrown by the
	// compaction seam and is NOT fallen back to basic compaction. This ACT
	// does NOT change that — the transport's terminal semantics are
	// unchanged.
	//
	// The acceptance authority below is unchanged too, and it remains
	// reachable: a transport that IGNORES the cancellation and reports a
	// successful completion returns NORMALLY, and the acceptance decision
	// refuses that candidate. That is the case the CMP-05 ACT established,
	// and the propagation has not weakened it.
	const summaryResult = await generateSummary({
		providerConfig: summarizerProviderConfig,
		systemPrompt:
			"Summarize the provided coding session into a concise continuation note with detailed next steps.",
		request: summaryRequest,
		// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01: the
		// compaction's OWN cancellation authority, threaded to the
		// summarizer transport.
		signal: options.context.abortSignal,
		// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01: the
		// cancellation is REPORTED as a terminal fact of the generation
		// rather than thrown by the transport, so the ACCEPTANCE DECISION
		// below remains the single authority that decides what a cancelled
		// generation means — and remains reachable for a transport that
		// IGNORES the cancellation and reports a successful completion.
		cancellationReporting: "report",
		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		// (AMENDMENT-02 §1) — THE USAGE SINK.
		//
		// The usage leaves the summarizer through this channel, and the
		// summarizer FINALIZES it on EVERY exit — the normal return and
		// the exceptional one alike. A transport that fails after the
		// provider already reported its usage ends the generation by
		// THROWING, and the usage of that PAID inference was paid for
		// whether or not the caller ever saw the result.
		//
		// The report is NOT tied to the acceptance decision, to the
		// persistence outcome or to the UI publication: a rejected summary
		// is not free inference.
		//
		// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
		// (AMENDMENT-02 §1): the caller does NOT report the usage again.
		// There is ONE delivery path, and it is this one.
		reportUsage: options.context.reportAuxiliaryUsage
			? (usage) => {
					options.context.reportAuxiliaryUsage?.({
						// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01
						// (AMENDMENT-02 §4): the PHYSICAL request identity, as
						// reported by the transport itself.
						inferenceId: usage.requestId ?? "summarization",
						kind: usage.kind,
						inputTokens: usage.inputTokens,
						outputTokens: usage.outputTokens,
						...(usage.cacheReadTokens !== undefined
							? { cacheReadTokens: usage.cacheReadTokens }
							: {}),
						...(usage.cacheWriteTokens !== undefined
							? { cacheWriteTokens: usage.cacheWriteTokens }
							: {}),
						...(usage.totalCost !== undefined
							? { totalCost: usage.totalCost }
							: {}),
						...(usage.reasoningTokenCount !== undefined
							? { reasoningTokenCount: usage.reasoningTokenCount }
							: {}),
					});
				}
			: undefined,
		// ACT-CLINEMM-CMP08-TERMINAL-BOUNDED-CORRECTION-01 (A1): the
		// existing diagnostic channel of this seam. It is used ONLY to
		// report a usage-delivery failure; it carries no accounting state.
		logger: options.logger,
	});
	options.logger?.debug("Generated compaction summary", {
		outputChars: summaryResult.text.length,
		reasoningChars: summaryResult.reasoningChars,
		incompleteReason: summaryResult.incompleteReason,
		modelId: summarizerProviderConfig.modelId,
		providerId: summarizerProviderConfig.providerId,
	});
	const rawSummary = summaryResult.text.trim();

	// ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01: the
	// SUMMARY ACCEPTANCE CONTRACT.
	//
	// The EMPTY case was already handled, but a NON-EMPTY candidate whose
	// completion status is KNOWN to be bad was installed exactly like a
	// complete one: it replaced the compacted history, the previously usable
	// working context was gone, and nothing recorded why.
	//
	// The decision is taken HERE, at the boundary that OWNS the summary
	// installation, BEFORE the replacement compacted history is built, BEFORE
	// the authoritative compaction state is updated, BEFORE a replacement
	// summary is persisted, BEFORE a successful compaction result is published
	// and BEFORE the compacted source boundary advances. Rejecting here
	// therefore leaves the prior valid state and the canonical history
	// untouched by construction.
	//
	// A provider-reported successful TRANSPORT is NOT sufficient when a
	// separate completion signal reports truncation: a known negative
	// terminal signal overrides the success flag and the non-empty text.
	//
	// ACT-CLINEMM-CMP05-CANCELLATION-AUTHORITY-01: CANCELLATION is such a
	// negative signal, and it is read HERE — at the decision point, AFTER
	// the summarizer returned — rather than captured before it started.
	//
	// Reading it at the decision point is what makes the authority
	// unconditional: a cancellation signalled at ANY moment before this
	// boundary (before the summarizer started, during it, or after it
	// reported a successful terminal response) is observed by the SAME
	// read. A late provider success therefore cannot authorize the
	// installation of a summary the user already cancelled.
	// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01: the
	// cancellation is read from BOTH sources, and they are the SAME
	// authority observed at two moments:
	//
	//   - `options.context.abortSignal?.aborted` — the signal read AT the
	//     decision point, which is the unconditional form of the
	//     authority: a cancellation signalled at ANY moment before this
	//     boundary is observed by this same read;
	//   - `summaryResult.cancelled` — the cancellation the TRANSPORT
	//     reported while the generation was under way.
	//
	// Reading both keeps the authority unconditional AND keeps the
	// transport's own report from being silently dropped. Neither source
	// can authorize an installation: the acceptance contract ranks
	// cancellation above every other terminal signal.
	const cancelled =
		options.context.abortSignal?.aborted === true ||
		summaryResult.cancelled === true;
	const acceptance = classifySummaryTerminalStatus({
		incompleteReason: summaryResult.incompleteReason,
		failed: summaryResult.failed,
		completed: summaryResult.completed,
		// ACT-CLINEMM-CMP05-CANCELLATION-AUTHORITY-01: the cancellation
		// signal. The acceptance contract already ranks it ABOVE every
		// other signal, so it wins over a late provider success.
		cancelled,
		// ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01: the
		// reported terminal reason.
		//
		// It is what separates an UNEStablished completion (the provider
		// never established a successful completion — the response may be
		// cut off) from a KNOWN failure (the stream failed). The verdict is
		// the same for both — not installable — but the diagnosis is not,
		// and the diagnosis is what an operator reads.
		finishReason: summaryResult.finishReason,
	});
	// ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01: an
	// unexpected TOOL CALL is not a summary. The summarizer is a text-only
	// request, so a tool-call termination means the model did not produce the
	// requested note; the same rule the sibling `summarizeConversation()`
	// path already applies.
	//
	// The tool-call fact is reported alongside the EMPTY diagnostic when the
	// output is also empty, because a tool-call termination usually carries
	// NO text at all and the distinct reason is more useful to an operator
	// than the generic empty-output diagnostic alone.
	const unexpectedToolCall = summaryResult.usedTools;
	// ACT-CLINEMM-CMP07-PROVIDER-CANCELLATION-PROPAGATION-01 — A
	// CANCELLED GENERATION IS NOT AN EMPTY RESPONSE.
	//
	// With the cancellation authority threaded to the transport, a cancelled
	// generation produces NO TEXT: the transport ended, so there is nothing
	// to install. The EMPTY branch below would then diagnose that as an
	// `empty_response` — an ordinary provider symptom — which is a
	// MISDIAGNOSIS: the generation was not empty, it was CANCELLED.
	//
	// The cancellation therefore takes the ACCEPTANCE branch, which reports
	// the acceptance contract's own reason (`cancelled`). The empty-summary
	// diagnostic is preserved unchanged for every generation that really was
	// empty.
	if (!rawSummary && !cancelled) {
		options.logger?.log(
			"Skipped agentic compaction: summarizer returned no summary text",
			{
				severity: "warn",
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
				summarizerMaxOutputTokens: summarizerProviderConfig.maxOutputTokens,
				reasoningChars: summaryResult.reasoningChars,
				incompleteReason: summaryResult.incompleteReason,
				likelyCause:
					summaryResult.reasoningChars > 0
						? "output_budget_consumed_by_reasoning"
						: "empty_response",
				// ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01:
				// the terminal classification and the tool-call fact are
				// reported ADDITIVELY, so the long-standing empty-summary
				// diagnostic is preserved unchanged.
				summaryTerminalStatus: acceptance.status,
				...(unexpectedToolCall
					? { rejectionReason: "unexpected_tool_call" }
					: {}),
			},
		);
		return undefined;
	}
	if (!acceptance.installable) {
		options.logger?.log(
			"Skipped agentic compaction: summarizer returned an unusable summary",
			{
				severity: "warn",
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
				summarizerMaxOutputTokens: summarizerProviderConfig.maxOutputTokens,
				reasoningChars: summaryResult.reasoningChars,
				incompleteReason: summaryResult.incompleteReason,
				// ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01: the
				// reported terminal reason, so the diagnosis names the actual
				// terminal fact (an unestablished completion is not a failure).
				finishReason: summaryResult.finishReason,
				summaryTerminalStatus: acceptance.status,
				rejectionReason: acceptance.reason,
				summaryChars: rawSummary.length,
			},
		);
		return undefined;
	}
	if (unexpectedToolCall) {
		options.logger?.log(
			"Skipped agentic compaction: summarizer issued a tool call instead of a summary",
			{
				severity: "warn",
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
				summaryTerminalStatus: acceptance.status,
				rejectionReason: "unexpected_tool_call",
				summaryChars: rawSummary.length,
			},
		);
		return undefined;
	}

	const summary = ensureFilesSection(rawSummary, fileOps);
	const tokensBefore = messages.reduce(
		(total, message) => total + options.estimateMessageTokens(message),
		0,
	);
	const resultMessages = [
		buildSummaryMessage({
			summary,
			fileOps,
			tokensBefore,
			userRunSpan: countUserRunMessages(messagesToSummarize),
		}),
		...messages.slice(cutIndex),
	];
	const tokensAfter = resultMessages.reduce(
		(total, message) => total + options.estimateMessageTokens(message),
		0,
	);
	options.logger?.debug("Performed agentic compaction", {
		messagesBefore: messages.length,
		messagesAfter: resultMessages.length,
		messagesSummarized: cutIndex,
		messagesPreserved: messages.length - cutIndex,
		tokensBefore,
		tokensAfter,
		maxInputTokens: options.context.budget.request.maxInputTokens,
	});
	const budgetActionCount = summaryInputBudget.actions.filter(
		(action) =>
			action.reason === "over_budget" || action.reason === "tool_pair_boundary",
	).length;
	return {
		messages: resultMessages,
		budget: {
			policyIntent: "agentic_summary",
			actionCount: budgetActionCount,
			warningCount: summaryInputBudget.warnings.length,
			liveTailHandling: summaryInputBudget.liveTailHandling,
		},
	};
}
