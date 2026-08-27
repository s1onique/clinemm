/**
 * ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01
 *
 * Pure projection that decides whether a visible assistant result
 * ("completion_result" say/ask) should be framed as a terminal
 * `Completed` report in the chat surface.
 *
 * Authority is the runtime/host-owned turn phase, NOT the message
 * prose. The webview MUST NOT infer completion from the absence of
 * tool calls, the idle appearance of the message tail, or the
 * presence of the literal word "Completed" in the assistant's text.
 *
 * Decision matrix (fails closed on ambiguity):
 *
 *   runtime phase           | ask vs say       | framing
 *   ------------------------+------------------+-----------------
 *   "completed"             | ask + non-empty  | kind: "completed"
 *   "completed"             | say + not partial| kind: "completed"
 *   "completed"             | partial / empty  | undefined
 *   "awaiting_followup"     | any              | undefined
 *   "error"                 | any              | undefined
 *   "resumable"             | any              | undefined
 *   "idle" / "streaming" /  | any              | undefined
 *   "awaiting_approval" /   |                  |
 *   "compacting"            |                  |
 *   undefined turnState     | any              | undefined
 *   mode = "plan"           | any              | undefined
 *
 * Why the message is also gated (not just phase):
 *
 *   - `partial: true` rows are content streams in flight. A
 *     `completion_result` row with `partial: true` means the SDK
 *     emitted `content_start` but not `content_end`. The runtime
 *     phase can transiently lag (CRA03 liveness); the message-level
 *     `partial: false` is the only thing that certifies the result
 *     text is the final committed terminal content.
 *   - `text === ""` rows are skipped by `filterVisibleMessages`
 *     upstream, so we still defend against them here for defense in
 *     depth — there's nothing to frame.
 *   - `mode === "plan"` is a closed-fail sentinel: the visible plan
 *     response renders via `PlanCompletionOutputRow`, never via
 *     `CompletionOutputRow`; reaching this helper with `mode === "plan"`
 *     means the chat-view branch is wrong and the safest answer is
 *     "no Completed framing".
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
	 * Used for the message-level gates (partial / non-empty text).
	 */
	readonly message: ClineMessage
	/**
	 * Authoritative UI turn phase from the host-owned `TurnStateTracker`,
	 * published on the wire as `turnState`. This is the runtime truth —
	 * NOT the message tail.
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
 * Authoritative terminal-phase terminal "completed" set. Mirrors
 * `apps/vscode/src/shared/ExtensionMessage.ts:457-473` and the host-side
 * `setTurnPhase("completed", ...)` writer at
 * `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:133`. Any phase
 * NOT in this set MUST NOT show the "Completed" framing — closed fail.
 */
const COMPLETED_PHASES: ReadonlySet<TurnPhase> = new Set<TurnPhase>(["completed"])

function isCompletionResultAskWithText(message: ClineMessage): boolean {
	if (message.type !== "ask") {
		return false
	}
	if (message.ask !== "completion_result") {
		return false
	}
	return typeof message.text === "string" && message.text.length > 0
}

function isCompletionResultSay(message: ClineMessage): boolean {
	if (message.type !== "say") {
		return false
	}
	if (message.say !== "completion_result") {
		return false
	}
	return message.partial !== true
}

export function resolveTerminalReportFraming(input: TerminalReportFramingInput): TerminalReportFraming | undefined {
	// Closed-fail sentinels first — cheapest, narrowest, no reasoning needed.
	if (input.mode === "plan") {
		return undefined
	}
	if (!input.turnState) {
		return undefined
	}
	if (!COMPLETED_PHASES.has(input.turnState.phase)) {
		return undefined
	}

	// Phase says "completed". Now confirm the message row is a real,
	// non-partial, non-empty terminal completion result.
	const isCompletedMessage = isCompletionResultAskWithText(input.message) || isCompletionResultSay(input.message)
	if (!isCompletedMessage) {
		return undefined
	}

	return COMPLETED
}
