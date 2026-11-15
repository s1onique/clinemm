/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 4 compaction sidecar parsing.
 *
 * ## Scope
 *
 * This module READS the compaction snapshot sidecar and reports what it
 * contains. It deliberately does NOT redesign compaction, does NOT propose
 * a new memory subsystem, and does NOT change any compaction behaviour.
 * Its only job is to make the Round C compaction evidence measurable.
 *
 * ## Safety invariant (load-bearing)
 *
 * The summary text is DATA. It is measured (character counts) and
 * classified (repeated-contract detection), never executed, never
 * interpreted as an instruction, and never re-emitted into the profile
 * output. Only counts and digests leave this module.
 */

import type { ReplayCompactionSnapshot } from "./types";

/**
 * The shape of the compaction sidecar document.
 */
interface CompactionDocument {
	readonly version?: unknown;
	readonly updated_at?: unknown;
	readonly conversation_id?: unknown;
	readonly source_message_count?: unknown;
	readonly source_prefix_hash?: unknown;
	readonly source_last_message_key?: unknown;
	readonly messages?: unknown;
}

/**
 * The markers that delimit the task contract inside a compaction summary.
 *
 * These are the SAME markers the runtime uses when it re-attaches the
 * standing contract after compaction
 * (`sdk/packages/core/src/extensions/context/task-contract.ts`). Using
 * the production markers — rather than a guessed heading — is what makes
 * the contract measurement trustworthy.
 */
const TASK_CONTRACT_BEGIN_MARKER = "<!-- cline-task-contract:begin -->";
const TASK_CONTRACT_END_MARKER = "<!-- cline-task-contract:end -->";

/**
 * Fallback headings, used only when the runtime markers are absent (for
 * example in a summary produced by a different writer).
 */
const TASK_CONTRACT_MARKERS: readonly string[] = [
	"## Task Contract",
	"### Task Contract",
	"## Contract",
	"## Standing Contract",
	"## Operating Contract",
];

/**
 * Parse a raw compaction sidecar document into the typed snapshot list.
 *
 * Accepts an already-parsed object or the JSON text of one. A document
 * that cannot be parsed yields an empty list rather than throwing.
 */
export function parseCompactionSidecar(
	source: unknown,
): readonly ReplayCompactionSnapshot[] {
	let document: unknown = source;
	if (typeof source === "string") {
		try {
			document = JSON.parse(source);
		} catch {
			return [];
		}
	}
	if (
		document === null ||
		typeof document !== "object" ||
		Array.isArray(document)
	) {
		return [];
	}
	const record = document as CompactionDocument;
	const messages = Array.isArray(record.messages) ? record.messages : [];

	// The summary is the first message's text content in the sidecar.
	let summaryChars = 0;
	let contractChars = 0;
	for (const message of messages) {
		if (
			message === null ||
			typeof message !== "object" ||
			Array.isArray(message)
		) {
			continue;
		}
		const content = (message as Record<string, unknown>).content;
		const blocks = Array.isArray(content) ? content : [];
		for (const block of blocks) {
			if (block === null || typeof block !== "object" || Array.isArray(block)) {
				continue;
			}
			const b = block as Record<string, unknown>;
			if (b.type !== "text" || typeof b.text !== "string") {
				continue;
			}
			summaryChars += b.text.length;
			contractChars += countContractChars(b.text);
		}
	}

	return [
		{
			conversationId:
				typeof record.conversation_id === "string"
					? record.conversation_id
					: undefined,
			sourceMessageCount:
				typeof record.source_message_count === "number"
					? record.source_message_count
					: undefined,
			sourcePrefixHash:
				typeof record.source_prefix_hash === "string"
					? record.source_prefix_hash
					: undefined,
			sourceLastMessageKey:
				typeof record.source_last_message_key === "string"
					? record.source_last_message_key
					: undefined,
			generatedAtUtc:
				typeof record.updated_at === "string" ? record.updated_at : undefined,
			summaryChars,
			contractChars,
			carriedMessageCount: messages.length,
		},
	];
}

/**
 * Count the characters of a summary that belong to the task contract.
 *
 * The contract is delimited by the runtime's own markers. When those are
 * present, the measured span is the whole delimited region. When they are
 * absent, the fallback headings are used: everything from the heading to
 * the end of the summary is attributed to the contract, because that is
 * the block the runtime re-attaches verbatim.
 */
export function countContractChars(summary: string): number {
	const begin = summary.indexOf(TASK_CONTRACT_BEGIN_MARKER);
	if (begin !== -1) {
		const end = summary.indexOf(TASK_CONTRACT_END_MARKER, begin);
		if (end !== -1) {
			return end + TASK_CONTRACT_END_MARKER.length - begin;
		}
		return summary.length - begin;
	}
	for (const marker of TASK_CONTRACT_MARKERS) {
		const index = summary.indexOf(marker);
		if (index === -1) {
			continue;
		}
		return summary.length - index;
	}
	return 0;
}

/**
 * The fraction of a compaction summary occupied by the task contract.
 *
 * Returns `0` for an empty summary so the ratio is always finite and
 * comparable.
 */
export function contractRatio(snapshot: ReplayCompactionSnapshot): number {
	if (snapshot.summaryChars <= 0) {
		return 0;
	}
	return snapshot.contractChars / snapshot.summaryChars;
}
