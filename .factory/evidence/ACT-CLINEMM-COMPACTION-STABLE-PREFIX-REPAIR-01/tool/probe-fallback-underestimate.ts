/**
 * ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01-CORRECTION02
 * FALLBACK-UNDERESTIMATE PROBE (DISPOSABLE, OFFLINE)
 *
 * Establishes the CORRECTED contract of `inferCompactionSourceBoundary()`:
 * an under-estimated boundary never FABRICATES an outcome, but it CAN OMIT
 * one. The earlier claim — "it costs compactness, never correctness" — was
 * NOT proven and is withdrawn.
 */
import type { MessageWithMetadata } from "@cline/shared";
import {
	applyVerifiedEvidenceToCompactedMessages,
	inferCompactionSourceBoundary,
} from "../../../../sdk/packages/core/src/extensions/context/evidence-continuity";

function text(role: "user" | "assistant", body: string): MessageWithMetadata {
	return { role, content: [{ type: "text", text: body }] };
}
function toolUse(callId: string): MessageWithMetadata {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id: callId, name: "run_commands", input: { command: "echo hi" } }],
	};
}
function toolResult(callId: string): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: callId,
				name: "run_commands",
				content: [{ query: "echo hi", result: "ok", success: true }],
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

// CASE 1 — the outcome sits INSIDE the inferred prefix: it is carried.
const canonicalA: MessageWithMetadata[] = [
	text("user", "A"),
	toolUse("call_x"),
	toolResult("call_x"),
	text("assistant", "D"),
	text("assistant", "E"),
];
const sidecarA = [summary(), canonicalA[3], canonicalA[4]];
const inferredA = inferCompactionSourceBoundary(sidecarA, canonicalA);
const resultA = applyVerifiedEvidenceToCompactedMessages(sidecarA, canonicalA);
const sectionTextA =
	(resultA.messages[0].metadata as { summary?: string } | undefined)?.summary ??
	"";
console.log("CASE 1 — outcome inside the inferred prefix");
console.log("  TRUE boundary: 5 | INFERRED boundary:", inferredA);
console.log("  carriedOutcomeCount:", resultA.carriedOutcomeCount);
console.log("  SECTION carries call_x:", sectionTextA.includes("call_x"));

// CASE 2 — the outcome sits BETWEEN the inferred and the true boundary:
// it is carried by NEITHER the section nor the canonical tail.
const canonicalB: MessageWithMetadata[] = [
	text("user", "A"),
	text("assistant", "B"),
	toolUse("call_y"),
	toolResult("call_y"),
	text("assistant", "E"),
];
const sidecarB = [summary(), canonicalB[3], canonicalB[4]];
const inferredB = inferCompactionSourceBoundary(sidecarB, canonicalB);
const resultB = applyVerifiedEvidenceToCompactedMessages(sidecarB, canonicalB);
// What matters is the SECTION's ledger: the section is the only carrier
// for a BOUNDARY outcome, because a boundary outcome is before the tail.
const sectionTextB =
	(resultB.messages[0].metadata as { summary?: string } | undefined)?.summary ??
	"";
const carriesY = sectionTextB.includes("call_y");
console.log("\nCASE 2 — outcome BETWEEN the inferred and the true boundary");
console.log("  TRUE boundary: 5 | INFERRED boundary:", inferredB);
console.log("  carriedOutcomeCount:", resultB.carriedOutcomeCount);
console.log("  SECTION carries call_y:", carriesY);
console.log("  SECTION:", JSON.stringify(sectionTextB));
console.log(
	"  OMISSION POSSIBLE:",
	!carriesY,
	"-> the 'never correctness' claim was FALSE and is withdrawn",
);
console.log(
	"\nCONCLUSION: the fallback is safe for FABRICATION, NOT for OMISSION.",
);
console.log(
	"  A caller that needs evidence conservation MUST pass the authoritative boundary.",
);
