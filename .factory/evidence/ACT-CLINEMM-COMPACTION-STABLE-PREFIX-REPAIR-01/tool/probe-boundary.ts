/**
 * ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01 — CORRECTION01
 * BOUNDARY-EQUIVALENCE PROBE (DISPOSABLE, OFFLINE)
 */
import type { MessageWithMetadata } from "@cline/shared";
import { inferCompactionSourceBoundary } from "../../../../sdk/packages/core/src/extensions/context/evidence-continuity";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
} from "../../../../sdk/packages/core/src/session/models/session-compaction";

function msg(role: "user" | "assistant", text: string): MessageWithMetadata {
	return { role, content: [{ type: "text", text }] };
}

// CANONICAL: A B C D E
const canonical: MessageWithMetadata[] = [
	msg("user", "A"),
	msg("assistant", "B"),
	msg("assistant", "C"),
	msg("assistant", "D"),
	msg("assistant", "E"),
];

// A SIDECAR that RETAINS canonical messages D and E before its boundary.
// This is the production RE-COMPACTION shape: the compaction result is
// [summary, ...messages.slice(cutIndex)] over the compactor's input.
const sidecarMessages: MessageWithMetadata[] = [
	{ role: "user", content: [{ type: "text", text: "Context summary:\n\n## Goal\nG" }], metadata: { kind: "compaction_summary", displayRole: "system", userRunSpan: 1, summary: "## Goal\nG", details: { readFiles: [], modifiedFiles: [] }, tokensBefore: 1000, generatedAt: 1 } },
	canonical[3],
	canonical[4],
];

const state = createSessionCompactionState({
	sourceMessages: canonical,
	compactedMessages: sidecarMessages,
	conversationId: "c",
});
console.log("source_message_count (authoritative):", state.source_message_count);

const projected = projectSessionCompactionState(state, canonical)!;
console.log("projected length:", projected.length);

const inferred = inferCompactionSourceBoundary(projected, canonical);
console.log("INFERRED boundary:", inferred);
console.log("AUTHORITATIVE boundary:", state.source_message_count);
console.log("MATCH:", inferred === state.source_message_count);

// The DISPLAY-ONLY divergence: createSessionCompactionState filters
// displayOnly messages, so source_message_count != context.messages.length.
const withDisplayOnly: MessageWithMetadata[] = [
	msg("user", "A"),
	{ role: "user", content: [{ type: "text", text: "display-only" }], metadata: { displayOnly: true, displayRole: "error" } },
	msg("assistant", "B"),
];
const s2 = createSessionCompactionState({
	sourceMessages: withDisplayOnly,
	compactedMessages: [{ role: "user", content: [{ type: "text", text: "Context summary:\n\n## Goal\nG" }], metadata: { kind: "compaction_summary", displayRole: "system", userRunSpan: 1, summary: "## Goal\nG", details: { readFiles: [], modifiedFiles: [] }, tokensBefore: 1000, generatedAt: 1 } }],
	conversationId: "c",
});
console.log();
console.log("context.messages.length (Phase A passes this):", withDisplayOnly.length);
console.log("persisted source_message_count:", s2.source_message_count);
console.log("DIVERGES:", withDisplayOnly.length !== s2.source_message_count);
