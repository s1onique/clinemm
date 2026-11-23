/**
 * ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
 *
 * TEST-LOCAL deterministic projection of a Working Knowledge Checkpoint into
 * a compacted message list.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. See `checkpoint-schema.ts`.
 * ============================================================================
 *
 * WHY THE PROJECTION IS DETERMINISTIC AND SEPARATE
 * -------------------------------------------------
 *
 * The summarizer's prose is a LOSSY projection: it can drop an observation
 * that actually happened. A checkpoint therefore does not depend on the
 * summarizer repeating anything. The section below is rendered from the
 * ACCEPTED records alone and is attached to the EXISTING `compaction_summary`
 * message.
 *
 * The behaviour mirrors the production adjudication carry-forward:
 *
 *   - no second summary message is created,
 *   - no provider tool call is added,
 *   - every other projected message is preserved unchanged,
 *   - the section is stripped before it is written, so a LATER compaction
 *     REPLACES it rather than appending a second copy.
 *
 * THE PROJECTION IS A CLOSED REPRESENTATION
 * ------------------------------------------
 *
 * The rendered section carries the record's KIND, its (capped) ASSURANCE,
 * its STATUS, its STATEMENT and its QUALIFICATIONS. It carries NO raw source
 * excerpt, NO private reasoning, NO unrestricted command output and NO
 * absolute workspace path. The evidence references are OPAQUE and are
 * rendered as a count plus their opaque keys, never as content.
 */

import type { MessageWithMetadata } from "@cline/shared";
import type { WorkingKnowledgeRecord } from "./checkpoint-schema";

/**
 * A stable, greppable marker so the section can be located and replaced
 * deterministically on a later compaction instead of accumulating copies.
 */
export const CHECKPOINT_SECTION_HEADING =
	"## Working knowledge checkpoint (model-authored, bounded)";

const CHECKPOINT_BEGIN_MARKER = "<!-- cline-knowledge-checkpoint:begin -->";
const CHECKPOINT_END_MARKER = "<!-- cline-knowledge-checkpoint:end -->";

/**
 * The maximum number of accepted records carried into one summary.
 *
 * A fixed constant: the carried section's size must not grow with the
 * length of the session.
 */
export const MAX_CARRIED_CHECKPOINT_RECORDS = 12;

/**
 * The maximum characters of one carried record line.
 */
export const MAX_CARRIED_CHECKPOINT_LINE_CHARS = 320;

/**
 * The outcome of applying the checkpoint projection.
 */
export interface CheckpointApplicationResult {
	/** The message list to use (enriched when applied, original otherwise). */
	readonly messages: MessageWithMetadata[];
	/** Whether the projection was actually applied. */
	readonly applied: boolean;
	/** The number of accepted records carried. */
	readonly carriedRecordCount: number;
}

/**
 * Render the deterministic carry-forward section for the accepted records.
 *
 * Returns `undefined` when there is nothing to carry, so the caller leaves
 * the summary untouched rather than inventing an empty section.
 */
export function renderCheckpointSection(
	records: readonly WorkingKnowledgeRecord[],
): string | undefined {
	if (records.length === 0) {
		return undefined;
	}
	const lines: string[] = [];
	for (const record of records.slice(0, MAX_CARRIED_CHECKPOINT_RECORDS)) {
		const rendered = [
			`${record.id}:`,
			`kind=${record.kind}`,
			`assurance=${record.assurance}`,
			`status=${record.status}`,
			`statement=${record.statement}`,
			record.qualifications.length > 0
				? `qualifications=${record.qualifications.join(" | ")}`
				: undefined,
			record.evidenceRefs.length > 0
				? `evidence_refs=${record.evidenceRefs.join(",")}`
				: undefined,
		]
			.filter((part): part is string => part !== undefined)
			.join(" ");
		lines.push(
			rendered.length > MAX_CARRIED_CHECKPOINT_LINE_CHARS
				? `${rendered.slice(0, MAX_CARRIED_CHECKPOINT_LINE_CHARS - 3)}...`
				: rendered,
		);
	}
	return [
		CHECKPOINT_SECTION_HEADING,
		CHECKPOINT_BEGIN_MARKER,
		...lines,
		CHECKPOINT_END_MARKER,
	].join("\n");
}

/**
 * Remove any previously carried checkpoint section from a summary text.
 *
 * This makes the carry-forward IDEMPOTENT: a later compaction replaces the
 * carried section with the section derived from the CURRENT accepted
 * records instead of appending a second copy.
 */
export function stripCheckpointSection(summaryText: string): string {
	const begin = summaryText.indexOf(CHECKPOINT_BEGIN_MARKER);
	if (begin === -1) {
		return stripCheckpointHeading(summaryText);
	}
	const end = summaryText.indexOf(CHECKPOINT_END_MARKER, begin);
	const blockEnd = end === -1 ? begin : end + CHECKPOINT_END_MARKER.length;
	const before = summaryText.slice(0, begin).trimEnd();
	const after = summaryText.slice(blockEnd).trimStart();
	const withoutBlock =
		before && after ? `${before}\n\n${after}` : before || after;
	return stripCheckpointHeading(withoutBlock);
}

/**
 * Remove a stray checkpoint HEADING that has no marked block.
 *
 * The heading is only ever emitted together with the block, so a heading
 * without a block is the residue of a truncated section. Removing it keeps
 * the summary's structure honest: the reader never sees a heading with no
 * content under it.
 */
function stripCheckpointHeading(summaryText: string): string {
	if (!summaryText.includes(CHECKPOINT_SECTION_HEADING)) {
		return summaryText;
	}
	return summaryText
		.split("\n")
		.filter((line) => line.trim() !== CHECKPOINT_SECTION_HEADING)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Apply the carry-forward to a summary text.
 *
 * Returns the original text unchanged when there is no accepted record, so
 * a summary without accepted records is never rewritten.
 */
export function applyCheckpointSectionToSummary(
	summaryText: string,
	records: readonly WorkingKnowledgeRecord[],
): string {
	const section = renderCheckpointSection(records);
	const stripped = stripCheckpointSection(summaryText).trimEnd();
	if (!section) {
		return stripped;
	}
	if (!stripped) {
		return section;
	}
	return `${stripped}\n\n${section}`;
}

/**
 * The provider-visible text of a summary message.
 */
function readSummaryTextFromContent(
	message: MessageWithMetadata,
): string | undefined {
	if (typeof message.content === "string") {
		return message.content;
	}
	if (!Array.isArray(message.content)) {
		return undefined;
	}
	const text = message.content
		.filter(
			(block): block is { type: "text"; text: string } =>
				block.type === "text" && typeof block.text === "string",
		)
		.map((block) => block.text)
		.join("\n");
	if (!text) {
		return undefined;
	}
	const prefix = "Context summary:\n\n";
	return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * Rebuild a summary message with a new summary text, keeping every other
 * metadata field and the message envelope unchanged.
 */
function rebuildSummaryMessage(
	message: MessageWithMetadata,
	summary: string,
): MessageWithMetadata {
	const metadata = message.metadata
		? { ...message.metadata, summary }
		: { summary };
	return {
		...message,
		content: [{ type: "text", text: `Context summary:\n\n${summary}` }],
		metadata,
	};
}

/**
 * Apply the deterministic checkpoint carry-forward to a compacted message
 * list.
 *
 * The section is attached to the EXISTING `compaction_summary` message — the
 * message the agentic compaction already produced. No second summary
 * message is created, no provider tool call is added, and every other
 * projected message is preserved unchanged.
 *
 * The accepted records are passed in already-validated: this function is the
 * PROJECTION step, not the validation step.
 */
export function applyCheckpointToCompactedMessages(
	compactedMessages: readonly MessageWithMetadata[],
	records: readonly WorkingKnowledgeRecord[],
): CheckpointApplicationResult {
	const summaryIndex = compactedMessages.findIndex(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	if (summaryIndex === -1) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedRecordCount: records.length,
		};
	}
	const summaryMessage = compactedMessages[summaryIndex];
	const currentSummary =
		(summaryMessage.metadata as { summary?: string } | undefined)?.summary ??
		readSummaryTextFromContent(summaryMessage);
	if (typeof currentSummary !== "string") {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedRecordCount: records.length,
		};
	}
	const nextSummary = applyCheckpointSectionToSummary(currentSummary, records);
	if (nextSummary === currentSummary) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedRecordCount: records.length,
		};
	}
	const nextMessages = [...compactedMessages];
	nextMessages[summaryIndex] = rebuildSummaryMessage(
		summaryMessage,
		nextSummary,
	);
	return {
		messages: nextMessages,
		applied: true,
		carriedRecordCount: records.length,
	};
}
