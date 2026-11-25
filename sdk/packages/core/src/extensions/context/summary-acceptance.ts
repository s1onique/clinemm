/**
 * ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01.
 *
 * The SUMMARY ACCEPTANCE CONTRACT of the ordinary (agentic) compactor.
 *
 * THE DEFECT THIS FILE EXISTS TO FIX
 * ---------------------------------
 *
 * `runAgenticCompaction()` asked only whether a summary EXISTS:
 *
 *     const rawSummary = summaryResult.text.trim();
 *     if (!rawSummary) { ...skip... }
 *     const summary = ensureFilesSection(rawSummary, fileOps);
 *     buildSummaryMessage({ summary, ... })
 *
 * `generateSummary()` DID collect the provider-reported terminal signals
 * (`incompleteReason`, `failed`), but NO DECISION was made on them. A summary
 * the provider reported as INCOMPLETE — cut off mid-sentence by the output
 * budget — or a generation the provider reported as FAILED passed straight
 * through and REPLACED the compacted history exactly like a complete one: no
 * warning, no marker, and the previously usable working context was gone.
 *
 * The EMPTY case was already handled correctly (skip + warn). The INCOMPLETE
 * and FAILED cases were the dangerous ones.
 *
 * THE INVARIANT
 * -------------
 *
 *   KNOWN_INCOMPLETE_SUMMARY_MUST_NOT_REPLACE_USABLE_CONTEXT
 *
 * A candidate is NOT installable when an authoritative terminal signal says
 * the generation was incomplete, exhausted its output budget, failed, was
 * cancelled, produced empty/whitespace-only content, or ended with a transport
 * failure.
 *
 * A provider-reported successful TRANSPORT is NOT sufficient when a separate
 * completion signal reports truncation. Conflicting signals never authorize
 * installation.
 *
 * WHAT THIS CONTRACT DOES NOT CLAIM
 * ----------------------------------
 *
 * A normally terminated model call does NOT prove that the summary is
 * semantically complete or faithful. This contract only refuses candidates
 * whose completion status is KNOWN to be bad. It uses NO textual heuristic,
 * NO keyword scoring, NO sentence-ending guess and NO additional inference.
 *
 * The sibling path `summarizeConversation()` already refuses
 * `failed || incompleteReason || usedTools || !text.trim()`; this module is
 * the agentic compactor's equivalent, expressed as an explicit classification
 * so the reason is diagnosable rather than implicit.
 */

/**
 * The TERMINAL STATUS of a summary generation.
 *
 * These are SEMANTIC classifications of what the transport reported. They are
 * NOT a new public enum and they are not persisted as one.
 *
 * - `known_complete` — the transport reported a normal completion and no
 *   negative terminal signal.
 * - `known_incomplete` — the transport reported that the response was
 *   incomplete (output budget exhausted, content filtered, or another
 *   provider-reported incompleteness reason).
 * - `known_failed` — the transport reported a failure.
 * - `premature_stream_termination` — the stream ended WITHOUT the completion
 *   event the transport contract requires. The response may be cut off, so it
 *   must not be treated as a successful completion.
 * - `legacy_completion_status_unavailable` — the transport ended normally but
 *   carried no finish-reason metadata at all. This is the LEGACY shape and it
 *   is NOT an unexpected stream termination: it is the "genuinely unavailable"
 *   case the existing contract already tolerated.
 */
export type SummaryTerminalStatus =
	| "known_complete"
	| "known_incomplete"
	| "known_failed"
	| "premature_stream_termination"
	| "legacy_completion_status_unavailable";

/**
 * The terminal signals a summary generation observed.
 *
 * These are exactly the fields the production summarizer transport already
 * collects. No new provider policy registry is introduced and no new provider
 * is consulted.
 */
export interface SummaryTerminalSignals {
	/** The provider-reported reason the response was incomplete. */
	readonly incompleteReason?: string;
	/** The provider-reported failure of the generation. */
	readonly failed?: boolean;
	/** Whether the transport reported a completion event at all. */
	readonly completed?: boolean;
	/** Whether the generation was cancelled. */
	readonly cancelled?: boolean;
}

/**
 * The classification of a summary candidate's terminal status.
 */
export interface SummaryAcceptanceDecision {
	/** The classified terminal status. */
	readonly status: SummaryTerminalStatus;
	/** Whether the candidate may be installed as the replacement summary. */
	readonly installable: boolean;
	/**
	 * A short, stable reason identifier, suitable for a diagnostic field.
	 *
	 * It is a FACT about the transport's report, never a claim about the
	 * summary's semantics.
	 */
	readonly reason:
		| "complete"
		| "provider_reported_incomplete"
		| "provider_reported_failure"
		| "cancelled"
		| "empty_output"
		| "premature_stream_termination"
		| "legacy_completion_status_unavailable";
}

/**
 * Classify a summary candidate's terminal status.
 *
 * The ORDER of the checks is the ORDER OF AUTHORITY:
 *
 *   1. CANCELLATION wins over everything: a cancelled generation has no
 *      completion status at all.
 *   2. A KNOWN negative terminal signal (incomplete / failed) wins over a
 *      success flag and over non-empty text. This is the conflicting-signal
 *      rule: the provider told us the response was cut short, so the
 *      transport's "success" flag does not authorise installation.
 *   3. An EMPTY or whitespace-only output is not a summary.
 *   4. A stream that ended WITHOUT its completion event is a premature
 *      termination: the response may be cut off, so it is not installable.
 *   5. A stream that ended normally but carried NO finish-reason metadata is
 *      the LEGACY shape. It stays installable — the existing contract already
 *      tolerated it, and its absence of metadata is not evidence of
 *      truncation.
 */
export function classifySummaryTerminalStatus(
	signals: SummaryTerminalSignals,
): SummaryAcceptanceDecision {
	if (signals.cancelled) {
		return { status: "known_failed", installable: false, reason: "cancelled" };
	}
	const incompleteReason = signals.incompleteReason?.trim();
	if (incompleteReason) {
		return {
			status: "known_incomplete",
			installable: false,
			reason: "provider_reported_incomplete",
		};
	}
	if (signals.failed) {
		return {
			status: "known_failed",
			installable: false,
			reason: "provider_reported_failure",
		};
	}
	if (signals.completed === false) {
		return {
			status: "premature_stream_termination",
			installable: false,
			reason: "premature_stream_termination",
		};
	}
	return {
		status:
			signals.completed === true
				? "known_complete"
				: "legacy_completion_status_unavailable",
		installable: true,
		reason:
			signals.completed === true
				? "complete"
				: "legacy_completion_status_unavailable",
	};
}

/**
 * The EMPTY-output reason, reported separately because the empty case has its
 * own long-standing diagnostic (`likelyCause`) that must be preserved.
 */
export const EMPTY_SUMMARY_REASON = "empty_output" as const;
