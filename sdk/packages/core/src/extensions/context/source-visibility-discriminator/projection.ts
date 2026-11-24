/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * TEST-LOCAL deterministic projection of a model-authored working-knowledge
 * checkpoint into a compacted message list.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement module.
 * ============================================================================
 *
 * WHY A SEPARATE PROJECTION
 * -------------------------
 *
 * The summarizer's prose is a LOSSY PROJECTION: it drops an observation that
 * actually happened. The checkpoint therefore does not depend on the
 * summarizer repeating anything. The section below is rendered from the
 * ACCEPTED records alone and is attached to the EXISTING
 * `compaction_summary` message.
 *
 * THE PROJECTION IS CLOSED AND MODEL-AUTHORED
 * -------------------------------------------
 *
 *   - no second summary message is created,
 *   - no provider tool call is added,
 *   - every other projected message is preserved unchanged,
 *   - the section is stripped before it is written, so a LATER compaction
 *     REPLACES it rather than appending a second copy,
 *   - the section carries the MODEL-AUTHORED banner, so a reader can never
 *     mistake it for a system instruction or a verified source finding,
 *   - the assurance shown is the BOUNDED assurance, never a model-claimed
 *     `runtime_verified`.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { MODEL_AUTHORED_BANNER } from "./trust";

/**
 * The stable, greppable marker for the carried section.
 */
export const CHECKPOINT_SECTION_HEADING =
	"## Working knowledge checkpoint (model-authored, bounded)";

const CHECKPOINT_BEGIN_MARKER = "<!-- cline-knowledge-checkpoint:begin -->";
const CHECKPOINT_END_MARKER = "<!-- cline-knowledge-checkpoint:end -->";

/**
 * The maximum number of accepted records carried into one summary.
 */
export const MAX_CARRIED_CHECKPOINT_RECORDS = 12;

/**
 * The maximum characters of one carried record line.
 */
export const MAX_CARRIED_CHECKPOINT_LINE_CHARS = 320;

/**
 * ONE projected record.
 *
 * The assurance is the BOUNDED assurance. The statement is the model's own
 * text, and the qualifications are the model's own qualifications.
 */
export interface ProjectableRecord {
	readonly id: string;
	readonly kind: string;
	readonly assurance: string;
	readonly status: string;
	readonly statement: string;
	readonly qualifications: readonly string[];
	readonly evidenceRefs: readonly string[];
}

/**
 * The outcome of applying the checkpoint projection.
 */
export interface CheckpointApplicationResult {
	readonly messages: MessageWithMetadata[];
	readonly applied: boolean;
	readonly carriedRecordCount: number;
}

/**
 * Render the deterministic carry-forward section for the accepted records.
 */
export function renderCheckpointSection(
	records: readonly ProjectableRecord[],
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
		MODEL_AUTHORED_BANNER,
		CHECKPOINT_BEGIN_MARKER,
		...lines,
		CHECKPOINT_END_MARKER,
	].join("\n");
}

/**
 * Remove any previously carried checkpoint section from a summary text.
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
 */
export function applyCheckpointSectionToSummary(
	summaryText: string,
	records: readonly ProjectableRecord[],
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
 * The section is attached to the EXISTING `compaction_summary` message. No
 * second summary message is created, no provider tool call is added, and
 * every other projected message is preserved unchanged.
 */
export function applyCheckpointToCompactedMessages(
	compactedMessages: readonly MessageWithMetadata[],
	records: readonly ProjectableRecord[],
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
