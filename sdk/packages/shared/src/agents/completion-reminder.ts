/**
 * ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01
 *
 * The exact runtime completion-reminder contract.
 *
 * WHY THIS LIVES IN `@cline/shared`
 * -------------------------------
 * The terminal-completion obligation is produced by
 * `AgentRuntime.getCompletionToolReminderMessage()` (sdk/packages/agents) and
 * must be RECOGNISED by the compaction contract-conservation path
 * (sdk/packages/core). Both packages already depend on `@cline/shared`, so
 * the shared package is the single place where the producer's text template
 * and the consumer's recogniser can be defined together.
 *
 * Sharing one definition is what makes the recogniser EXACT rather than a
 * broad string guess: a runtime reminder is recognised only when its text is
 * byte-identical to the template this module renders for a known set of
 * terminal completion tool names. Unrelated runtime notices (team completion
 * guards, max-token recovery nudges, provider-error continuations) and
 * user-authored text that merely resembles the template are NOT recognised.
 *
 * This module defines no new completion semantics: it only names the message
 * the runtime already emits.
 */

/**
 * The stable prefix of the runtime completion reminder. It is part of the
 * template identity, not a heuristic.
 */
const COMPLETION_TOOL_REMINDER_PREFIX =
	"[SYSTEM] This run is not complete until you call one of these terminal completion tools: ";

/**
 * The stable suffix of the runtime completion reminder.
 */
const COMPLETION_TOOL_REMINDER_SUFFIX =
	". Continue working if requirements are not met. If the task is complete, call the appropriate terminal completion tool now.";

/**
 * Render the exact runtime completion reminder for the given terminal
 * completion tool names. The runtime passes the names already sorted; this
 * function preserves that order so the rendered text is stable.
 *
 * Returns `undefined` when no terminal completion tool is required — the same
 * "no obligation" decision the runtime makes before injecting the message.
 */
export function buildCompletionToolReminderMessage(
	terminalToolNames: readonly string[],
): string | undefined {
	if (terminalToolNames.length === 0) {
		return undefined;
	}
	return `${COMPLETION_TOOL_REMINDER_PREFIX}${terminalToolNames.join(
		", ",
	)}${COMPLETION_TOOL_REMINDER_SUFFIX}`;
}

/**
 * Recognise a runtime completion reminder by EXACT template equality.
 *
 * `terminalToolNames` is the candidate set of terminal completion tools. The
 * text must be byte-identical to the rendered template for that set (or for
 * some non-empty subset of it), so:
 *
 *   - a runtime reminder naming `submit_and_exit` is recognised,
 *   - an unrelated runtime notice is not,
 *   - a user-authored message quoting the template is not (it is a user turn,
 *     not a runtime-synthetic message — the caller additionally requires the
 *     runtime-synthetic classification),
 *   - a malformed or truncated reminder is not.
 */
export function isCompletionToolReminderMessage(
	text: string,
	terminalToolNames: readonly string[],
): boolean {
	if (typeof text !== "string" || terminalToolNames.length === 0) {
		return false;
	}
	for (let count = 1; count <= terminalToolNames.length; count += 1) {
		for (let start = 0; start + count <= terminalToolNames.length; start += 1) {
			const candidate = buildCompletionToolReminderMessage(
				terminalToolNames.slice(start, start + count),
			);
			if (candidate === text) {
				return true;
			}
		}
	}
	return false;
}
