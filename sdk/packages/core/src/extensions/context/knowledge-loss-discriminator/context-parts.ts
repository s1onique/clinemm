/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C3 — the CONTEXT DECOMPOSITION.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It splits a COMPACTED STATE (a list of messages whose first entry is the
 * compaction summary) into the MECHANISMS that can supply knowledge, so that
 * the inventory can attribute every recoverable proposition to the mechanism
 * that actually supplied it.
 *
 * The split follows the PRODUCTION section markers, so it is an inspection of
 * the real artifact rather than a re-implementation of the compaction.
 */

import type { MessageWithMetadata } from "@cline/shared";
import type { KnowledgeContext } from "./inventory";

const TASK_CONTRACT_BEGIN = "<!-- cline-task-contract:begin -->";
const TASK_CONTRACT_END = "<!-- cline-task-contract:end -->";
const EVIDENCE_BEGIN = "<!-- cline-evidence:begin -->";
const EVIDENCE_END = "<!-- cline-evidence:end -->";
const ADJUDICATION_BEGIN = "<!-- cline-adjudication:begin -->";
const ADJUDICATION_END = "<!-- cline-adjudication:end -->";

export function messageText(message: MessageWithMetadata): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	if (!Array.isArray(message.content)) {
		return "";
	}
	return message.content
		.map((block) => {
			if (block.type === "text") {
				return (block as { text?: string }).text ?? "";
			}
			if (block.type === "tool_result") {
				const content = (block as { content?: unknown }).content;
				if (!Array.isArray(content)) {
					return "";
				}
				return content
					.map((entry) =>
						entry && typeof entry === "object"
							? String((entry as { result?: unknown }).result ?? "")
							: "",
					)
					.join("\n");
			}
			return "";
		})
		.join("\n");
}

export function extractSection(
	text: string,
	beginMarker: string,
	endMarker: string,
): string {
	const begin = text.indexOf(beginMarker);
	const end = text.indexOf(endMarker);
	if (begin < 0 || end < 0 || end < begin) {
		return "";
	}
	return text.slice(begin, end + endMarker.length);
}

/**
 * The GENERATED SUMMARY prose: the compaction summary message MINUS the
 * carried sections.
 *
 * The carried sections are removed so that a proposition supplied by the
 * task contract is not also counted as "supplied by the generated summary".
 * Without this separation the mechanism attribution would be wrong in a way
 * that flatters ordinary compaction.
 */
export function generatedSummaryProse(summaryText: string): string {
	let prose = summaryText;
	for (const [begin, end] of [
		[TASK_CONTRACT_BEGIN, TASK_CONTRACT_END],
		[EVIDENCE_BEGIN, EVIDENCE_END],
		[ADJUDICATION_BEGIN, ADJUDICATION_END],
	]) {
		const section = extractSection(prose, begin, end);
		if (section) {
			prose = prose.replace(section, "");
		}
	}
	return prose;
}

/**
 * Decompose a compacted state into a KNOWLEDGE CONTEXT.
 *
 * `compactedMessages` is the persisted sidecar's message list: the first
 * entry is the compaction summary and the rest is the retained tail.
 */
export function decomposeCompactedState(
	compactedMessages: readonly MessageWithMetadata[],
): KnowledgeContext {
	const summaryMessage = compactedMessages[0];
	const summaryText = summaryMessage ? messageText(summaryMessage) : "";
	const tail = compactedMessages.slice(1);
	const tailText = tail.map((m) => messageText(m)).join("\n");
	// A tool-result body only reaches the context when it is part of a
	// retained tail message. The carried verified-outcome section carries
	// status lines, not bodies, so it is NOT an evidence body.
	const evidenceBodies = tail
		.flatMap((message) =>
			Array.isArray(message.content)
				? message.content.filter((block) => block.type === "tool_result")
				: [],
		)
		.map((block) => {
			const content = (block as { content?: unknown }).content;
			return Array.isArray(content)
				? content
						.map((entry) =>
							entry && typeof entry === "object"
								? String((entry as { result?: unknown }).result ?? "")
								: "",
						)
						.join("\n")
				: "";
		})
		.join("\n");
	return {
		generatedSummary: generatedSummaryProse(summaryText),
		taskContract: extractSection(
			summaryText,
			TASK_CONTRACT_BEGIN,
			TASK_CONTRACT_END,
		),
		verifiedOutcome: extractSection(summaryText, EVIDENCE_BEGIN, EVIDENCE_END),
		adjudication: extractSection(
			summaryText,
			ADJUDICATION_BEGIN,
			ADJUDICATION_END,
		),
		retainedTail: tailText,
		evidenceBodies,
	};
}

/**
 * Decompose a PROVIDER-VISIBLE CONTINUATION into a KNOWLEDGE CONTEXT.
 *
 * The provider-visible continuation is the projected transcript that the
 * working-agent model actually receives. It has the same first-entry shape
 * (the compaction summary) plus the canonical tail.
 */
export function decomposeProviderContinuation(
	providerMessages: readonly MessageWithMetadata[],
): KnowledgeContext {
	return decomposeCompactedState(providerMessages);
}
