/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * TEST-LOCAL construction of the THREE candidate checkpoint input views.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement module.
 * ============================================================================
 *
 * THE THREE CANDIDATES
 * -------------------
 *
 *   A — Ordinary summarizer view.
 *       The EXISTING `agentic_summary` projection and serializer. This is the
 *       FAILING BASELINE, and it is reused UNCHANGED.
 *
 *   B — Working-agent pre-compaction context.
 *       The effective messages the WORKING AGENT would receive immediately
 *       before compaction, subject to the SAME provider, authorization and
 *       budget controls. This is the PREFERRED candidate.
 *
 *   C — Dedicated checkpoint-only evidence view.
 *       A bounded representation derived from canonical OBSERVED tool events,
 *       without changing the ordinary summarizer. This is the FALLBACK.
 *
 * WHAT EACH VIEW IS LABELED
 * -------------------------
 *
 *   A — REAL_PRODUCTION_SEAM
 *       The view is produced by the production projection + production
 *       serializer over the exact frozen canonical prefix.
 *
 *   B — SYNTHETIC_REAL
 *       The view is a CONSTRUCTED, FILTERED approximation of the working
 *       agent's context. It is NOT an exact replay of a provider-visible
 *       input, and it MUST NOT be labelled LIVE.
 *
 *   C — SYNTHETIC
 *       The view is assembled from canonical observed tool events by this
 *       ACT's own machinery.
 *
 * THE BOUNDARY OF THE ORDINARY SUMMARIZER IS NEVER WIDENED
 * -------------------------------------------------------
 *
 * View A calls the PRODUCTION `buildBudgetProjection` and the PRODUCTION
 * `serializeConversation`. It does not modify them, does not replace them,
 * and does not add a source-attributed excerpt path to them.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { buildBudgetProjection } from "../budget-projection";
import {
	type EstimateMessageTokens,
	serializeConversation,
} from "../compaction-shared";
import {
	type ContentOrigin,
	classifyBlockOrigin,
	classifyMessageOrigin,
} from "./content-origin";

/**
 * The evidence label of a candidate view.
 */
export type ViewLabel = "REAL_PRODUCTION_SEAM" | "SYNTHETIC_REAL" | "SYNTHETIC";

/**
 * One candidate checkpoint input view.
 */
export interface CandidateInputView {
	/** Which candidate this is. */
	readonly candidate: "A" | "B" | "C";
	/** The evidence label. */
	readonly label: ViewLabel;
	/** A human-readable name for the receipt. */
	readonly name: string;
	/** The rendered, controlled input text handed to the checkpoint model. */
	readonly text: string;
	/** The opaque canonical references available for citation. */
	readonly references: readonly string[];
	/** The number of canonical messages the view was derived from. */
	readonly sourceMessageCount: number;
	/** The origin histogram of the canonical prefix the view was derived from. */
	readonly originCounts: Record<ContentOrigin, number>;
	/**
	 * Whether the view forwards any PRIVATE REASONING.
	 *
	 * This is an ASSERTION derived from the classification the builder
	 * actually performed, not a hope.
	 */
	readonly forwardsPrivateThinking: boolean;
	/**
	 * Whether the view forwards ARBITRARY, UNRESTRICTED command output.
	 *
	 * `true` is not automatically a failure: the working agent's own context
	 * legitimately contains command output, because the agent already
	 * received it. The discriminator's question is whether the checkpoint
	 * PUBLISHES it onward with the same authority.
	 */
	readonly forwardsUnrestrictedToolOutput: boolean;
	/**
	 * Whether the view was built by a CONSTRUCTED filter rather than by the
	 * production projection alone.
	 */
	readonly constructed: boolean;
}

function countOrigins(
	messages: readonly MessageWithMetadata[],
): Record<ContentOrigin, number> {
	const counts: Record<ContentOrigin, number> = {
		USER_CONTENT: 0,
		ASSISTANT_PUBLIC_TEXT: 0,
		ASSISTANT_THINKING: 0,
		TOOL_INPUT: 0,
		TOOL_RESULT: 0,
		RUNTIME_METADATA: 0,
		UNKNOWN_ORIGIN: 0,
	};
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			counts[classifyMessageOrigin(message)] += 1;
			continue;
		}
		for (const block of message.content) {
			counts[classifyBlockOrigin(message, block as never)] += 1;
		}
	}
	return counts;
}

/**
 * CANDIDATE A — the ordinary summarizer view.
 *
 * The EXACT production path: `buildBudgetProjection` with the
 * `agentic_summary` policy intent, then the production
 * `serializeConversation`. UNCHANGED.
 *
 * The `agentic_summary` policy drops every thinking block BEFORE
 * serialization, and the production serializer renders a structured
 * `{query, result, success}` payload as `"[status] label: [result omitted]"`.
 * Both are existing, deliberate contracts.
 */
export function buildCandidateA(input: {
	canonicalMessages: readonly MessageWithMetadata[];
	targetTokens: number;
	estimateMessageTokens: EstimateMessageTokens;
}): CandidateInputView {
	const budgeted = buildBudgetProjection({
		messages: input.canonicalMessages as MessageWithMetadata[],
		targetTokens: input.targetTokens,
		policyIntent: "agentic_summary",
		estimateMessageTokens: input.estimateMessageTokens,
	});
	const text = serializeConversation(budgeted.messages);
	return {
		candidate: "A",
		label: "REAL_PRODUCTION_SEAM",
		name: "Ordinary summarizer view (production agentic_summary projection)",
		text,
		references: [],
		sourceMessageCount: budgeted.messages.length,
		originCounts: countOrigins(budgeted.messages),
		// The `agentic_summary` policy drops every thinking block, so the
		// production view forwards NO private reasoning.
		forwardsPrivateThinking: false,
		forwardsUnrestrictedToolOutput: false,
		constructed: false,
	};
}

/**
 * Render ONE message for a constructed view, by origin class.
 *
 * A block whose origin is NOT forwardable is DROPPED, not rendered in a
 * degraded form. That is the fail-closed rule: a private reasoning block
 * never reaches the checkpoint model in any shape.
 */
export function renderForwardableMessage(message: MessageWithMetadata): string {
	if (!Array.isArray(message.content)) {
		return message.role === "user" ? message.content : "";
	}
	const parts: string[] = [];
	for (const block of message.content) {
		const origin = classifyBlockOrigin(message, block as never);
		if (
			origin === "ASSISTANT_THINKING" ||
			origin === "UNKNOWN_ORIGIN" ||
			origin === "RUNTIME_METADATA"
		) {
			continue;
		}
		if (origin === "TOOL_INPUT") {
			// The tool CALL's declared input is carried as a bounded,
			// structured label: the tool name and the call's own id. The
			// ARBITRARY ARGUMENTS are not carried, for the same reason the
			// production evidence-continuity module does not carry them.
			const record = block as unknown as { id?: unknown; name?: unknown };
			parts.push(
				`[Tool call ${String(record.name ?? "unknown")} id=${String(record.id ?? "?")}]`,
			);
			continue;
		}
		if (origin === "TOOL_RESULT") {
			parts.push(renderToolResultForView(block as never));
			continue;
		}
		if (origin === "USER_CONTENT") {
			parts.push(`[User]: ${(block as { text?: string }).text ?? ""}`);
			continue;
		}
		parts.push(`[Bot]: ${(block as { text?: string }).text ?? ""}`);
	}
	return parts.join("\n");
}

/**
 * Render ONE tool result for a constructed view.
 *
 * The structured `{query, result, success}` payload is the class the
 * production summarizer omits. The constructed view renders its STATUS and
 * its BODY, because the body IS the observation the checkpoint must be able
 * to publish.
 */
export function renderToolResultForView(block: unknown): string {
	const record = block as { tool_use_id?: unknown; content?: unknown };
	const inner = Array.isArray(record.content) ? record.content : [];
	const parts: string[] = [];
	for (const entry of inner) {
		if (entry && typeof entry === "object" && "result" in entry) {
			const payload = entry as Record<string, unknown>;
			const status =
				payload.success === false || payload.isError === true
					? "failed"
					: payload.success === true
						? "succeeded"
						: "unknown";
			const body = typeof payload.result === "string" ? payload.result : "";
			parts.push(
				`[Tool result ${String(record.tool_use_id ?? "?")}] status=${status} body=${body}`,
			);
			continue;
		}
		if (entry && typeof entry === "object" && "type" in entry) {
			const typed = entry as {
				type?: string;
				text?: string;
				content?: string;
				path?: string;
			};
			if (typed.type === "text") {
				parts.push(
					`[Tool result ${String(record.tool_use_id ?? "?")}] ${typed.text ?? ""}`,
				);
				continue;
			}
			if (typed.type === "file") {
				parts.push(
					`[Tool result ${String(record.tool_use_id ?? "?")}] <file path="${typed.path ?? ""}">\n${typed.content ?? ""}\n</file>`,
				);
			}
		}
	}
	return parts.join("\n");
}

/**
 * CANDIDATE B — the working-agent pre-compaction context.
 *
 * This is a CONSTRUCTED, FILTERED approximation of the effective messages
 * the working agent would receive immediately before compaction.
 *
 * It is labelled `SYNTHETIC_REAL`, NOT `LIVE`, because it is NOT an exact
 * replay of a provider-visible input: the provider-wire projection
 * (`MessageBuilder.buildForApi`) is a separate, host-supplied transform with
 * its own state, and this view applies the ACT's own origin filter to the
 * canonical history rather than replaying a captured request.
 *
 * THE THREE PROPERTIES IT MUST HAVE (G1.2):
 *
 *   1. It must NOT insert a new canonical user message.
 *      -> It builds a SEPARATE view; the canonical history is untouched.
 *   2. It must NOT disturb tool-call pairing.
 *      -> It renders calls and results as READ-ONLY labels; no pairing is
 *         rewritten, and the canonical history is not mutated.
 *   3. It must NOT consume the already-triggered compaction state.
 *      -> It takes no sidecar, writes no sidecar, and never calls
 *         `saveState`.
 */
export function buildCandidateB(input: {
	canonicalMessages: readonly MessageWithMetadata[];
}): CandidateInputView {
	const lines: string[] = [];
	const references: string[] = [];
	for (const message of input.canonicalMessages) {
		const reference = message.id
			? `id:${message.id}`
			: `index:${references.length}`;
		references.push(reference);
		const rendered = renderForwardableMessage(message);
		if (rendered.trim().length === 0) {
			continue;
		}
		lines.push(`[${reference}] ${rendered}`);
	}
	return {
		candidate: "B",
		label: "SYNTHETIC_REAL",
		name: "Working-agent pre-compaction context (constructed, origin-filtered)",
		text: lines.join("\n\n"),
		references,
		sourceMessageCount: input.canonicalMessages.length,
		originCounts: countOrigins(input.canonicalMessages),
		forwardsPrivateThinking: false,
		// The working agent's context DOES contain command output — it
		// already received it. This view reproduces that class of content so
		// the checkpoint can publish the observation. The authority question
		// is handled by the publication and validation gates, not by hiding
		// the content from the checkpoint.
		forwardsUnrestrictedToolOutput: true,
		constructed: true,
	};
}

/**
 * CANDIDATE C — a dedicated checkpoint-only evidence view.
 *
 * A bounded representation derived from canonical OBSERVED tool events.
 *
 * This is the FALLBACK candidate. It is explored only if B is unworkable or
 * insufficient.
 *
 * It requires an EXACT canonical tool-call identity so that an outcome is
 * never attributed to a call that did not produce it, and it uses the
 * PRODUCTION status classification so a failed or ambiguous batch is never
 * promoted.
 */
export function buildCandidateC(input: {
	canonicalMessages: readonly MessageWithMetadata[];
}): CandidateInputView {
	const toolNameById = new Map<string, string>();
	for (const message of input.canonicalMessages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				toolNameById.set(block.id, block.name);
			}
		}
	}
	const lines: string[] = [];
	const references: string[] = [];
	for (const message of input.canonicalMessages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_result") {
				continue;
			}
			const reference = message.id
				? `id:${message.id}`
				: `index:${references.length}`;
			const rendered = renderToolResultForView(block as never);
			if (rendered.trim().length === 0) {
				continue;
			}
			references.push(reference);
			lines.push(
				`[${reference}] tool=${toolNameById.get(block.tool_use_id) ?? "unknown"} ${rendered}`,
			);
		}
	}
	return {
		candidate: "C",
		label: "SYNTHETIC",
		name: "Dedicated checkpoint-only evidence view (canonical observed tool events)",
		text: lines.join("\n\n"),
		references,
		sourceMessageCount: input.canonicalMessages.length,
		originCounts: countOrigins(input.canonicalMessages),
		forwardsPrivateThinking: false,
		forwardsUnrestrictedToolOutput: true,
		constructed: true,
	};
}
