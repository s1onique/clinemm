/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C0 — the REAL workload acquisition and EXACT compaction-boundary recovery.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * For a REAL persisted session it recovers, with cryptographic exactness:
 *
 *   - the RAW-FILE identity of the canonical history and of the compaction
 *     sidecar (SHA-256 over the file bytes),
 *   - the PARSED-AND-RESERIALIZED canonical-message-array digest (a
 *     DIFFERENT identity from the raw-file digest — the ACT explicitly
 *     requires the two not be compared as though they were interchangeable),
 *   - the EXACT source prefix of the persisted compaction decision, verified
 *     by recomputing the production `sourcePrefixHash` over the canonical
 *     prefix and comparing it with the sidecar's `source_prefix_hash`,
 *   - the retained-tail boundary,
 *   - the shape of the persisted compacted state (summary / task contract /
 *     verified-outcome sections / retained tail).
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * The recovered histories, sidecars and their prose stay in the GITIGNORED
 * `tmp/` tree. This script prints AGGREGATE, non-reversible facts only:
 * counts, digests, section names, section lengths and classification flags.
 *
 * No message text, no tool output, no credential and no private repository
 * excerpt is printed or written to any tracked location.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { formatDisplayUserInput } from "@cline/shared";
import { canonicalSourceMessages } from "../src/session/models/session-compaction";

/**
 * The production `sourcePrefixHash` — REIMPLEMENTED VERBATIM from
 * `sdk/packages/core/src/session/models/session-compaction.ts`.
 *
 * It is reproduced here rather than imported because the production function
 * is NOT exported with a caller-chosen `count`. The reproduction is therefore
 * VERIFIED against the sidecar's own `source_prefix_hash`: an exact match is
 * the proof that the recomputation is faithful AND that the recovered prefix
 * is the exact historical source prefix.
 */
function sourcePrefixHash(
	messages: readonly MessageWithMetadata[],
	count = messages.length,
): string {
	const hash = createHash("sha256");
	hash.update("cline-session-compaction-source-v2\n");
	hash.update(`${count}\n`);
	for (const message of messages.slice(0, count)) {
		hash.update(JSON.stringify(sourceMessageHashInput(message)));
		hash.update("\n");
	}
	return `sha256:${hash.digest("hex")}`;
}

function sourceMessageHashInput(message: MessageWithMetadata): unknown[] {
	const normalized = normalizeMessageForSourceHash(message);
	return [
		["role", normalized.role],
		["content", normalized.content],
		["agent", normalized.agent ?? null],
		["sessionId", normalized.sessionId ?? null],
		["metadata", normalized.metadata ?? null],
		["modelInfo", normalized.modelInfo ?? null],
		["metrics", normalized.metrics ?? null],
	];
}

function normalizeMessageForSourceHash(
	message: MessageWithMetadata,
): MessageWithMetadata {
	if (message.role !== "user") {
		return message;
	}
	if (typeof message.content === "string") {
		return {
			...message,
			content: formatDisplayUserInput(message.content),
		};
	}
	return {
		...message,
		content: message.content.map((part) =>
			part.type === "text"
				? { ...part, text: formatDisplayUserInput(part.text) }
				: part,
		),
	};
}

function sectionLength(
	text: string,
	beginMarker: string,
	endMarker: string,
): number {
	const begin = text.indexOf(beginMarker);
	const end = text.indexOf(endMarker);
	if (begin < 0 || end < 0 || end < begin) {
		return 0;
	}
	return end + endMarker.length - begin;
}

function messageKey(message: MessageWithMetadata | undefined): string {
	if (!message) {
		return "";
	}
	if (typeof message.id === "string" && message.id.trim()) {
		return `id:${message.id.trim()}`;
	}
	return `content:${message.role}`;
}

interface PersistedSession {
	readonly version?: number;
	readonly updated_at?: string;
	readonly agent?: string;
	readonly sessionId?: string;
	readonly origin?: {
		readonly source?: string;
		readonly mode?: string;
		readonly version?: string;
	};
	readonly messages: MessageWithMetadata[];
}

interface PersistedCompactionState {
	readonly version: number;
	readonly updated_at: string;
	readonly conversation_id?: string;
	readonly source_message_count: number;
	readonly source_prefix_hash?: string;
	readonly source_last_message_key?: string;
	readonly messages: MessageWithMetadata[];
	readonly system_prompt?: string;
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The DIGEST OF THE PARSED AND RESERIALIZED CANONICAL MESSAGE ARRAY.
 *
 * This is a DIFFERENT identity from the raw-file digest: the raw file
 * carries envelope fields (version, origin, system_prompt, updated_at) that
 * the canonical array does not, and the reserialization normalises key
 * order. The two are recorded separately and never compared to each other.
 */
function canonicalArrayDigest(
	messages: readonly MessageWithMetadata[],
): string {
	return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}

const sessionId = process.argv[2];
if (!sessionId) {
	console.error(
		"usage: knowledge-loss-discriminator.acquire.ts <sessionId> [sessionsRoot]",
	);
	process.exit(2);
}

const sessionsRoot =
	process.argv[3] ?? join(homedir(), ".vscodium-roz", "cline-data", "sessions");

const sessionDir = join(sessionsRoot, sessionId);
const messagesPath = join(sessionDir, `${sessionId}.messages.json`);
const compactionPath = join(sessionDir, `${sessionId}.compaction.json`);

if (!existsSync(messagesPath)) {
	console.error(`the session history does not exist: ${messagesPath}`);
	process.exit(2);
}

const persisted = JSON.parse(
	readFileSync(messagesPath, "utf8"),
) as PersistedSession;
const canonicalMessages = persisted.messages ?? [];
const canonical = canonicalSourceMessages(canonicalMessages);

const acquisition = {
	acquisition: "REAL_SESSION_CANONICAL_HISTORY",
	sessionId: persisted.sessionId ?? sessionId,
	sessionSource: persisted.origin?.source ?? "unknown",
	sessionMode: persisted.origin?.mode ?? "unknown",
	sessionExtensionVersion: persisted.origin?.version ?? "unknown",
	sessionUpdatedAt: persisted.updated_at ?? "unknown",
	sessionAgent: persisted.agent ?? "unknown",
	rawFileSha256: {
		canonicalHistory: sha256File(messagesPath),
		...(existsSync(compactionPath)
			? { compactionState: sha256File(compactionPath) }
			: {}),
	},
	canonicalArraySha256: canonicalArrayDigest(canonicalMessages),
	canonicalMessageCount: canonicalMessages.length,
	canonicalSourceMessageCount: canonical.length,
	displayOnlyMessageCount: canonicalMessages.length - canonical.length,
} as const;

if (!existsSync(compactionPath)) {
	console.log(JSON.stringify({ ...acquisition, compaction: null }, null, 2));
	process.exit(0);
}

const state = JSON.parse(
	readFileSync(compactionPath, "utf8"),
) as PersistedCompactionState;

const boundary = state.source_message_count;
const prefix = canonical.slice(0, boundary);
const recomputedPrefixHash = sourcePrefixHash(prefix, boundary);
const boundaryMessage = canonical[boundary - 1];
const tail = canonical.slice(boundary);

const compactedMessages = state.messages ?? [];

const summaryMessage = compactedMessages[0];
const summaryText =
	summaryMessage && typeof summaryMessage.content === "string"
		? summaryMessage.content
		: summaryMessage &&
				Array.isArray(summaryMessage.content) &&
				summaryMessage.content[0]?.type === "text"
			? ((summaryMessage.content[0] as { text?: string }).text ?? "")
			: "";

const compaction = {
	compactionStateVersion: state.version,
	compactionStateUpdatedAt: state.updated_at,
	conversationId: state.conversation_id ?? null,
	sourceMessageCount: boundary,
	sourcePrefixHash: state.source_prefix_hash ?? null,
	sourceLastMessageKey: state.source_last_message_key ?? null,
	// The EXACTNESS PROOF: the recomputed production prefix hash over the
	// canonical prefix equals the sidecar's own recorded prefix hash.
	recomputedPrefixHash,
	prefixHashMatchesSidecar:
		!!state.source_prefix_hash &&
		recomputedPrefixHash === state.source_prefix_hash,
	prefixMessageCount: prefix.length,
	boundaryMessageId: boundaryMessage?.id ?? null,
	boundaryMessageKeyMatchesSidecar:
		!!state.source_last_message_key &&
		messageKey(boundaryMessage) === state.source_last_message_key,
	retainedTailMessageCount: tail.length,
	retainedTailFirstMessageId: tail[0]?.id ?? null,
	compactedMessageCount: compactedMessages.length,
	// The SHAPE of the persisted compacted state. Section NAMES and LENGTHS
	// only — no prose.
	compactedStateShape: {
		summaryMessageRole: summaryMessage?.role ?? null,
		summaryChars: summaryText.length,
		hasTaskContractSection: summaryText.includes(
			"<!-- cline-task-contract:begin -->",
		),
		taskContractChars: sectionLength(
			summaryText,
			"<!-- cline-task-contract:begin -->",
			"<!-- cline-task-contract:end -->",
		),
		hasVerifiedOutcomeSection: summaryText.includes(
			"<!-- cline-evidence:begin -->",
		),
		verifiedOutcomeChars: sectionLength(
			summaryText,
			"<!-- cline-evidence:begin -->",
			"<!-- cline-evidence:end -->",
		),
		// A PCK section would be a knowledge checkpoint block. Its ABSENCE is
		// the W1 historical fact this ACT records.
		hasKnowledgeCheckpointSection: /working knowledge checkpoint/i.test(
			summaryText,
		),
		adjudicationSectionChars: sectionLength(
			summaryText,
			"<!-- cline-adjudication:begin -->",
			"<!-- cline-adjudication:end -->",
		),
	},
} as const;

console.log(JSON.stringify({ ...acquisition, compaction }, null, 2));
