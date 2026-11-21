/**
 * ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01-CORRECTION02
 * CANONICAL-BOUNDARY-INDEX-MISMATCH PROBE (DISPOSABLE, OFFLINE)
 *
 * Reproduces the reviewer's P0 counterexample against the REAL seams:
 *   - Phase A: a NEW compaction over a history that INTERLEAVES a
 *     display-only message between the tool_use and the tool_result.
 *   - Phase B: persisted-sidecar RESTORATION over the same history.
 *
 * The discriminator: the successful tool_result sits AFTER raw index
 * `source_message_count - 1`, while still INSIDE the canonical source
 * boundary. A raw slice therefore drops it, while a canonical slice keeps it.
 */
import type { MessageWithMetadata } from "@cline/shared";
import {
	applyVerifiedEvidenceToCompactedMessages,
} from "../../../../sdk/packages/core/src/extensions/context/evidence-continuity";
import {
	countCanonicalSourceMessages,
	createSessionCompactionState,
	projectSessionCompactionState,
} from "../../../../sdk/packages/core/src/session/models/session-compaction";

function text(role: "user" | "assistant", body: string): MessageWithMetadata {
	return { role, content: [{ type: "text", text: body }] };
}
function displayOnly(body: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text: body }],
		metadata: { displayOnly: true, displayRole: "error" },
	};
}
function toolUse(callId: string): MessageWithMetadata {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id: callId, name: "run_command", input: { command: "echo hi" } }],
	};
}
function toolResult(callId: string, body: string): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: callId,
				name: "run_command",
				content: [{ query: body, result: "ok", success: true }],
			},
		],
	};
}
function summary(): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text: "Context summary:\n\n## Goal\nG" }],
		metadata: {
			kind: "compaction_summary",
			displayRole: "system",
			userRunSpan: 1,
			summary: "## Goal\nG",
			details: { readFiles: [], modifiedFiles: [] },
			tokensBefore: 1000,
			generatedAt: 1,
		},
	};
}

// RAW:  0 USER task | 1 DISPLAY | 2 ASSISTANT tool_use | 3 USER tool_result
// CANON:0 USER task |       -        | 1 ASSISTANT tool_use | 2 USER tool_result
const history: MessageWithMetadata[] = [
	text("user", "Adjudicate the findings."),
	displayOnly("a transient display-only notice"),
	toolUse("call_a"),
	toolResult("call_a", "OK: the command ran successfully"),
];

const canonicalCount = countCanonicalSourceMessages(history);
console.log("raw history length:", history.length);
console.log("CANONICAL source_message_count:", canonicalCount);
console.log(
	"tool_result RAW index:",
	history.findIndex((m) => (m.content?.[0] as { type?: string })?.type === "tool_result"),
);
console.log(
	"tool_result CANONICAL index:",
	history
		.filter((m) => m.metadata?.displayOnly !== true)
		.findIndex((m) => (m.content?.[0] as { type?: string })?.type === "tool_result"),
);
console.log(
	"DISCRIMINATOR (result raw index >= canonical count):",
	history.findIndex((m) => (m.content?.[0] as { type?: string })?.type === "tool_result") >=
		canonicalCount,
);

// --- PHASE A: the NEW compaction path (what the pipeline calls) ---
const phaseA = applyVerifiedEvidenceToCompactedMessages(
	[summary()],
	history,
	{ sourceMessageCount: canonicalCount },
);
const phaseAText = JSON.stringify(phaseA.messages);
console.log("\n--- PHASE A (new compaction) ---");
console.log("carriedOutcomeCount:", phaseA.carriedOutcomeCount);
console.log("carries call_a:", phaseAText.includes("call_a"));
console.log("RESULT PRESENT:", phaseAText.includes("call_a") ? "YES" : "NO -- EVIDENCE LOST");

// --- PHASE B: persisted-sidecar restoration ---
const state = createSessionCompactionState({
	sourceMessages: history,
	compactedMessages: [summary()],
	conversationId: "c",
});
console.log("\n--- PHASE B (persisted-sidecar restoration) ---");
console.log("persisted source_message_count:", state.source_message_count);
const projected = projectSessionCompactionState(state, history);
if (!projected) {
	console.log("projection FAILED");
} else {
	const phaseB = applyVerifiedEvidenceToCompactedMessages(
		projected,
		history,
		{ sourceMessageCount: state.source_message_count },
	);
	const phaseBText = JSON.stringify(phaseB.messages);
	console.log("carriedOutcomeCount:", phaseB.carriedOutcomeCount);
	console.log("carries call_a:", phaseBText.includes("call_a"));
	console.log("RESULT PRESENT:", phaseBText.includes("call_a") ? "YES" : "NO -- EVIDENCE LOST");
}
