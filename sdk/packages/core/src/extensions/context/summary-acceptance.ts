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

import type { AgentModelFinishReason } from "@cline/shared";

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
 * - `unestablished_completion` — the transport reported that the provider
 *   never ESTABLISHED a successful completion (the terminal reason is
 *   `unknown`). The response may be cut off, so it must not be installed.
 *   This is NOT the same fact as a known failure: the stream did not fail,
 *   it ended without an authoritative terminal reason.
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
	| "unestablished_completion"
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
	/**
	 * ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01: the terminal
	 * reason the transport reported.
	 *
	 * It is what separates an UNEStablished completion (`unknown` — the
	 * provider never established a successful completion, so the response may
	 * be cut off) from a KNOWN failure (the stream failed). Both arrive as a
	 * non-successful terminal completion, so without the reported reason the
	 * two are indistinguishable.
	 *
	 * `unknown` is preserved AS `unknown`: it is not turned into a normal
	 * completion, and it is not turned into an invented provider failure.
	 */
	readonly finishReason?: AgentModelFinishReason;
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
		| "unestablished_completion"
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
 *
 * ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01 — THE UNEStablished
 * COMPLETION.
 *
 * A non-successful terminal completion covers TWO different facts:
 *
 *   - the stream FAILED (the provider reported an error), and
 *   - the provider never ESTABLISHED a successful completion (the terminal
 *     reason is `unknown`: the response may be cut off).
 *
 * The reported terminal reason is what tells them apart, and the runtime
 * treats them differently: a failure is an error, while an unestablished
 * completion is an incomplete turn. Both are correctly NOT installable, so
 * this refinement changes the DIAGNOSIS, never the acceptance verdict.
 *
 * The precedence is preserved: a candidate that reports a KNOWN negative
 * signal (an incompleteness reason, a cancellation, or a reported failure
 * with an error) is classified by that signal. Only a non-successful
 * completion whose terminal reason is `unknown` — with no stronger negative
 * signal — is classified as an unestablished completion.
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
		// ACT-CLINEMM-CMP04-TERMINAL-ACCEPTANCE-CONSERVATION-01: an
		// UNEStablished completion is not a known failure.
		//
		// The transport reports BOTH as a non-successful terminal
		// completion. The reported reason separates them: `unknown` means
		// the provider never established a successful completion (the
		// response may be cut off), which is NOT the same fact as a stream
		// that failed.
		//
		// `unknown` is preserved AS `unknown`: it is not converted into a
		// normal completion, and it is not converted into an invented
		// provider failure.
		if (signals.finishReason === "unknown") {
			return {
				status: "unestablished_completion",
				installable: false,
				reason: "unestablished_completion",
			};
		}
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
