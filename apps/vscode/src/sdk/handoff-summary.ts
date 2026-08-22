/**
 * ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01 / CORRECTION01+02
 *
 * Host-side handoff summary generator for the `/newtask` slash command.
 *
 * `/newtask` (per the documented product contract) creates a fresh task
 * whose initial prompt is a distilled summary of the current conversation.
 * The SDK runtime has no `new_task` AgentTool to drive distillation (the
 * legacy tool was reverted in commit 7b8798c99), so the host generates
 * the summary itself.
 *
 * This helper is a pure orchestrator over a pluggable
 * `HandoffSummaryProvider`. Production wires a provider created by
 * `createSdkHandoffSummaryProvider(providerConfig)`, which calls the
 * existing `createHandlerAsync` primitive from `@cline/llms` against
 * the caller-supplied `ProviderConfig` — the same LLM-call seam
 * `runAgenticCompaction.generateSummary` uses internally
 * (sdk/packages/core/src/extensions/context/agentic-compaction.ts).
 *
 * The provider is the single point that touches the LLM; the orchestrator
 * formats the input transcript and applies structural validation.
 *
 * The helper does NOT mutate the current task — there is no
 * `compactTask`/`updateSessionCompactionState` call here. The current
 * task's history remains as a historical record after the new task starts
 * (NDHA06 no-mutation invariant).
 *
 * CORRECTION01: the prior implementation routed to a placeholder fallback
 * provider for normal production, emitting strings like "(see source task
 * history on disk)" instead of real LLM-generated summaries. That was a
 * correctness P0 — the documented product contract requires a distilled
 * handoff, not a placeholder. The production provider now goes through
 * the SDK LLM gateway; the placeholder fallback is retained ONLY as a
 * deterministic test seam. If real distillation cannot execute, the
 * handler surfaces an explicit failure (no fake handoff) per the
 * CORRECTION01 failure-control contract.
 *
 * CORRECTION02: the CORRECTION01 wiring threaded the active
 * ProviderConfig through a module-scoped slot (setActiveProviderConfig /
 * getActiveProviderConfig), which crossed an `await` boundary and was
 * therefore NOT concurrency-safe — two concurrent `/newtask` invocations
 * could observe each other's provider config (or one invocation's
 * finally-block could clear another invocation's slot). The slot was
 * removed; the production provider is now constructed per request via
 * `createSdkHandoffSummaryProvider(providerConfig)` so each invocation
 * captures its own ProviderConfig in closure. No module state, no
 * shared mutable slot, no async-local storage — just dependency
 * injection. Two concurrent handoffs now remain provider-isolated.
 */

import { createHandlerAsync, type ProviderConfig, type Message as SdkMessage } from "@cline/llms"
import { fetch as proxyAwareFetch } from "@/shared/net"

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
	 * Implementations may call the SDK LLM gateway, a fresh LLM call,
	 * or any other summarization strategy — but must NOT mutate the
	 * session that owns the input messages.
	 */
	summarize(input: { messages: SdkMessage[]; abortSignal?: AbortSignal }): Promise<string>
}

export const HANDOFF_SUMMARY_PROMPT = [
	"Produce a structured handoff summary of the conversation below for a fresh task.",
	"Emit EXACTLY five labeled sections, in this order, each on its own line:",
	"  goal:           the original intent of the user (one short sentence)",
	"  completedWork:  what was actually accomplished (concrete outcomes, not actions)",
	"  relevantFiles:  files that were read, edited, or created (absolute paths; comma-separated; empty if none)",
	"  nextSteps:      the next concrete action the fresh task should take (one short sentence)",
	"  keyDecisions:   architectural / design / scope decisions made (bulleted; empty if none)",
	"Do not invent details that are not present in the conversation.",
	"If a section has no information, write '(none)' for that section but still emit the label.",
	"Do not include any preamble or postamble; emit only the five labeled sections.",
].join("\n")

/**
 * Serialize the supplied transcript to a deterministic text block.
 * Intentionally local — avoids deepening the SDK import surface.
 */
function serializeTranscript(messages: SdkMessage[]): string {
	return messages
		.map((message) => {
			const role = message.role
			const text =
				typeof message.content === "string"
					? message.content
					: Array.isArray(message.content)
						? message.content
								.filter((part) => part.type === "text")
								.map((part) => (part as { type: "text"; text: string }).text)
								.join(" ")
						: ""
			return `[${role}] ${text}`
		})
		.join("\n\n")
}

// ---------------------------------------------------------------------------
// Request-scoped production provider (CORRECTION02).
//
// The ProviderConfig is captured in closure, NOT stored in a module-scoped
// slot. This makes each handoff invocation provider-isolated: two
// concurrent /newtask calls capture their own configs and cannot observe
// each other's. No module state, no async-local storage — just
// dependency injection.
// ---------------------------------------------------------------------------

/**
 * Inject the proxy-aware fetch into a ProviderConfig so the LLM call
 * honors JetBrains/CLI proxy configuration (see .clinerules/network.md).
 */
export function withProxyAwareFetch(config: ProviderConfig): ProviderConfig {
	return { ...config, fetch: proxyAwareFetch as ProviderConfig["fetch"] }
}

/**
 * Build a request-scoped production handoff provider that drives the
 * SDK LLM gateway against the supplied ProviderConfig — the same leaf
 * primitive `runAgenticCompaction.generateSummary` uses internally.
 * Does NOT mutate the source session.
 *
 * The returned provider captures `providerConfig` in closure, so each
 * handoff invocation is provider-isolated. Two concurrent calls do not
 * share state.
 */
export function createSdkHandoffSummaryProvider(providerConfig: ProviderConfig): HandoffSummaryProvider {
	return {
		async summarize({ messages, abortSignal }) {
			if (messages.length === 0) {
				throw new Error("[handoff-summary] cannot summarize an empty transcript")
			}
			const handler = await createHandlerAsync(providerConfig)
			const transcript = serializeTranscript(messages)
			let text = ""
			for await (const chunk of handler.createMessage(HANDOFF_SUMMARY_PROMPT, [{ role: "user", content: transcript }])) {
				if (abortSignal?.aborted) {
					throw new Error("[handoff-summary] aborted")
				}
				if (chunk.type === "text") {
					text += chunk.text
					continue
				}
				if (chunk.type === "done" && !chunk.success && chunk.error) {
					throw new Error(`[handoff-summary] LLM error: ${chunk.error}`)
				}
			}
			const trimmed = text.trim()
			if (!trimmed) {
				throw new Error("[handoff-summary] LLM returned an empty handoff")
			}
			return trimmed
		},
	}
}

// ---------------------------------------------------------------------------
// Public orchestrator
// ---------------------------------------------------------------------------

const REQUIRED_LABELS = ["goal:", "completedWork:", "relevantFiles:", "nextSteps:", "keyDecisions:"] as const

/**
 * Run the supplied provider against the active session's transcript and
 * return a structured handoff string. The provider is the single point
 * that touches the LLM — this function is a pure orchestrator that
 * validates the output carries the five required structural labels.
 *
 * If the provider output omits any label, the orchestrator pads the
 * output with "(none)" so downstream parsers can rely on all five
 * anchors being present. This is structural validation, NOT a fallback
 * to placeholder content — the substantive text still comes from the LLM.
 *
 * CORRECTION02: there is no implicit default provider. Every invocation
 * MUST supply an explicit `provider` so each request is self-contained —
 * a module-scoped default would be a shared mutable surface that is
 * unsafe across `await` boundaries. Tests that want a placeholder pass
 * one explicitly; production callers construct one via
 * `createSdkHandoffSummaryProvider(providerConfig)`.
 */
export async function generateHandoffSummary(
	input: { messages: SdkMessage[]; abortSignal?: AbortSignal },
	options: { provider: HandoffSummaryProvider },
): Promise<string> {
	const summary = await options.provider.summarize(input)
	let padded = summary
	for (const marker of REQUIRED_LABELS) {
		if (!padded.includes(marker)) {
			padded += `\n${marker}\n(none)`
		}
	}
	return padded
}
