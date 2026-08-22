/**
 * ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01
 *
 * Host-side handoff summary generator for the /newtask slash command.
 *
 * `/newtask` (per the documented product contract) creates a fresh task
 * whose initial prompt is a distilled summary of the current conversation.
 * The SDK runtime has no `new_task` AgentTool to drive distillation (the
 * legacy tool was reverted in commit 7b8798c99), so the host generates
 * the summary itself.
 *
 * The helper is a pure transform: it consumes the active session's
 * transcript and emits a structured handoff string. It does NOT mutate
 * the current task — there is no `compactTask`/`updateSessionCompactionState`
 * call here. The current task's history remains as a historical record
 * after the new task starts (NDHA06 no-mutation invariant).
 *
 * Test seam: the `provider` parameter is pluggable. Production wires a
 * provider that calls the SDK compaction machinery to extract a structured
 * summary. Tests inject a deterministic provider to assert the structural
 * categories without driving the LLM.
 */

import type { Message as SdkMessage } from "@cline/llms"

/**
 * The five structural categories a handoff must carry. These are the
 * semantic anchors the new task's first user turn parses — a deterministic
 * shape so the new task can extract the goal / completed work /
 * relevant files / next steps / key decisions without depending on the
 * exact LLM prose.
 */
export interface HandoffSummaryProvider {
	/**
	 * Produce a structured handoff summary for the supplied transcript.
	 * Implementations may call the SDK compaction machinery, a fresh LLM
	 * call, or any other summarization strategy — but must NOT mutate the
	 * session that owns the input messages.
	 */
	summarize(input: { messages: SdkMessage[]; abortSignal?: AbortSignal }): Promise<string>
}

/**
 * Deterministic fallback provider used when no LLM-backed provider is
 * wired. Emits the canonical structural categories with the raw message
 * count and last user message text. Suitable for tests and for the
 * cold-start case where the SDK compaction machinery is unavailable.
 */
export const fallbackHandoffSummaryProvider: HandoffSummaryProvider = {
	async summarize({ messages }) {
		const lastUser = [...messages].reverse().find((m) => m.role === "user")
		const lastUserText =
			lastUser && typeof lastUser.content === "string"
				? lastUser.content.slice(0, 2000)
				: lastUser && Array.isArray(lastUser.content)
					? lastUser.content
							.filter((part) => part.type === "text")
							.map((part) => (part as { type: "text"; text: string }).text)
							.join("\n")
							.slice(0, 2000)
					: ""
		return [
			"goal:",
			lastUserText || "(no prior user message)",
			"",
			"completedWork:",
			`(${messages.length} messages in source session)`,
			"",
			"relevantFiles:",
			"(see source task history on disk)",
			"",
			"nextSteps:",
			"(continued from source session — review prior history)",
			"",
			"keyDecisions:",
			"(see source task history on disk)",
		].join("\n")
	},
}

/**
 * Run the supplied provider against the active session's transcript and
 * return a structured handoff string. The provider is the single point
 * that touches the LLM — this function is a pure orchestrator.
 */
export async function generateHandoffSummary(
	input: { messages: SdkMessage[]; abortSignal?: AbortSignal },
	options: { provider?: HandoffSummaryProvider } = {},
): Promise<string> {
	const provider = options.provider ?? fallbackHandoffSummaryProvider
	const summary = await provider.summarize(input)
	// Defensive: even if the provider omits a category, append the marker
	// so downstream parsers can rely on all five anchors being present.
	const required = ["goal:", "completedWork:", "relevantFiles:", "nextSteps:", "keyDecisions:"]
	let padded = summary
	for (const marker of required) {
		if (!padded.includes(marker)) {
			padded += `\n${marker}\n(unspecified)`
		}
	}
	return padded
}
