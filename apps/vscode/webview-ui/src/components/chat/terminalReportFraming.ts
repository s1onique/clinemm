/**
 * ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 (with CORRECTION01)
 *
 * Pure projection that decides whether a visible assistant result
 * ("completion_result" say/ask) should be framed as a terminal
 * `Completed` report in the chat surface.
 *
 * Two-tier authority:
 *
 *   1. PRIMARY — per-message immutable marker
 *      `message.isAuthoritativelyCompletedResult === true`. This marker
 *      is stamped ONCE at the single canonical completion publication
 *      seam (`message-translator.ts:1640`, the attempt_completion /
 *      submit_and_exit `content_end` handler). It is persisted on the
 *      row and survives task-level state mutations (resume, retry,
 *      follow-up, compaction). When the marker is true, the row IS a
 *      terminal completion — period. The webview renders the badge
 *      even if the current `turnState.phase` is mid-stream, because
 *      that phase describes the CURRENT turn, not the historical one.
 *
 *   2. SECONDARY — legacy ask: "completion_result" fallback
 *      Legacy tasks that bypass the SDK translator never get the
 *      marker stamped. For those rows only, we keep the original
 *      `turnState.phase === "completed"` + non-empty-text gate so
 *      legacy completion UI keeps working. This is defense in depth;
 *      the canonical path (modern SDK) uses the marker.
 *
 * What MUST NOT happen:
 *
 *   - Infer "Completed" from message text (no string match).
 *   - Infer "Completed" from message tail (no last-message inference).
 *   - Use the mutable `turnState.phase` as the SOLE authority for a
 *     historical completion row — the phase is task-current, not
 *     row-current.
 *
 * Decision matrix (fails closed on ambiguity):
 *
 *   marker        | runtime phase   | ask vs say       | framing
 *   --------------+-----------------+------------------+-----------------
 *   true          | any             | say completion   | kind: "completed"
 *   true          | any             | _                | kind: "completed"
 *   absent        | "completed"     | ask + non-empty  | kind: "completed"
 *   absent        | "completed"     | partial / empty  | undefined
 *   absent        | any other phase | any              | undefined
 *   absent        | undefined       | any              | undefined
 *   any           | n/a (plan mode) | any              | undefined
 *
 * Pure: no React, no DOM, no I/O, no message-tail inference.
 */
import type { ClineMessage, TurnPhase, TurnState } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"

export interface TerminalReportFraming {
	readonly kind: "completed"
	/** Short visible label (lowercase; rendered with `.uppercase` styling). */
	readonly label: "Completed"
	/** ARIA label for screen readers. */
	readonly ariaLabel: "Task completed"
	/** Tooltip on hover. */
	readonly title: "Task completed successfully"
}

export interface TerminalReportFramingInput {
	/**
	 * The `completion_result` row the caller is about to render.
	 * Used for the per-message marker gate and the legacy message-shape
	 * gate (partial / non-empty text).
	 */
	readonly message: ClineMessage
	/**
	 * Authoritative UI turn phase from the host-owned `TurnStateTracker`,
	 * published on the wire as `turnState`. Used as the SECONDARY
	 * gate for the legacy ask: completion_result path. NOT used for
	 * the primary marker path — the marker is monotonic and survives
	 * phase flips.
	 */
	readonly turnState: TurnState | undefined
	/** Current plan/act mode. "plan" always returns undefined. */
	readonly mode: Mode | undefined
}

const COMPLETED: TerminalReportFraming = Object.freeze({
	kind: "completed",
	label: "Completed",
	ariaLabel: "Task completed",
	title: "Task completed successfully",
})

/**
 * Authoritative terminal-phase set used by the LEGACY ask fallback.
 * Mirrors `apps/vscode/src/shared/ExtensionMessage.ts:457-473` and the
 * host-side `setTurnPhase("completed", ...)` writer at
 * `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:133`.
 *
 * Not used for the primary marker path. The marker is monotonic per
 * row and is the canonical identity for "this row WAS a terminal
 * completion"; the phase is canonical for "this turn is currently
 * terminal". The two are different concepts and must not be confused.
 */
const COMPLETED_PHASES: ReadonlySet<TurnPhase> = new Set<TurnPhase>(["completed"])

/**
 * PRIMARY authority: per-message immutable marker. Stamped once at the
 * canonical completion publication seam and persisted on the row.
 * Survives phase flips (resume / retry / follow-up / compaction).
 */
function isAuthoritativeCompletionResult(message: ClineMessage): boolean {
	return message.isAuthoritativelyCompletedResult === true
}

/**
 * LEGACY fallback: legacy tasks that bypass the SDK translator never
 * get the marker stamped. They emit an `ask: "completion_result"`
 * row with non-empty text directly. For those rows only, we keep the
 * original `turnState.phase === "completed"` + non-empty-text gate.
 *
 * Modern SDK tasks always go through the marker path; this branch is
 * reached only when no marker is present AND the row shape is the
 * legacy ask variant.
 */
function isLegacyAskCompletionResultWithText(message: ClineMessage): boolean {
	if (message.type !== "ask") {
		return false
	}
	if (message.ask !== "completion_result") {
		return false
	}
	return typeof message.text === "string" && message.text.length > 0
}

export function resolveTerminalReportFraming(input: TerminalReportFramingInput): TerminalReportFraming | undefined {
	// Closed-fail sentinels first — cheapest, narrowest, no reasoning needed.
	if (input.mode === "plan") {
		return undefined
	}

	// PRIMARY: per-message marker is monotonic and survives phase flips.
	// A historical completed row keeps its badge even when the current
	// task is mid-stream / mid-compaction / just-resumed.
	if (isAuthoritativeCompletionResult(input.message)) {
		return COMPLETED
	}

	// SECONDARY: legacy ask path. Both gates must agree (defense in
	// depth — modern tasks always carry the marker).
	if (!input.turnState) {
		return undefined
	}
	if (!COMPLETED_PHASES.has(input.turnState.phase)) {
		return undefined
	}
	if (!isLegacyAskCompletionResultWithText(input.message)) {
		return undefined
	}

	return COMPLETED
}
