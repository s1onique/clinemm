/**
 * ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01
 *
 * C2.1 — THE REPAIRED SOURCE-BOUNDARY WITNESS.
 *
 * The witness exercises the REAL production continuation-assembly path:
 *
 *     applyTaskContractToCompactedMessages()
 *       -> applyVerifiedEvidenceToCompactedMessages()
 *         -> createSessionCompactionState()
 *           -> projectSessionCompactionState()
 *
 * The point of the exercise is the PAIR of controls:
 *
 *   - NEGATIVE: at the ORIGINAL boundary, a synthetic post-boundary
 *     observation is INACCESSIBLE.
 *   - POSITIVE: at a DELIBERATELY ADVANCED boundary, the same observation
 *     IS visible.
 *
 * Without the positive control, the negative control would be consistent
 * with a carry-forward that ignores its source entirely.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
} from "../../../session/models/session-compaction";
import { applyVerifiedEvidenceToCompactedMessages } from "../evidence-continuity";
import { applyTaskContractToCompactedMessages } from "../task-contract";
import {
	buildContaminatedHistory,
	rederivePrefixAtBoundary,
	runNegativeControl,
	runPositiveControl,
} from "./boundary-witness";
import { computeSourcePrefixHash, POST_BOUNDARY_MARKER } from "./source-prefix";

/**
 * Build a canonical history whose LAST message is a verified tool outcome
 * carrying the synthetic marker.
 *
 * The marker is placed in a TOOL RESULT, so the carry-forward's verified
 * outcome ledger can pick it up. That is what makes the POSITIVE control
 * meaningful: it shows the carry-forward really does read its source.
 */
function buildCanonicalHistory(input: {
	readonly preBoundaryCount: number;
	readonly postBoundaryCount: number;
	readonly marker?: string;
}): MessageWithMetadata[] {
	const messages: MessageWithMetadata[] = [];
	for (let index = 0; index < input.preBoundaryCount; index += 1) {
		messages.push({
			role: "user",
			content: [{ type: "text", text: `pre-boundary ${index}` }],
			ts: index,
		});
	}
	for (let index = 0; index < input.postBoundaryCount; index += 1) {
		messages.push({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: `call-${index}`,
					name: "run_commands",
					content: [
						{
							type: "text",
							text: input.marker ?? `post-boundary ${index}`,
						},
					],
					is_error: false,
				},
			],
			ts: 1000 + index,
		});
	}
	return messages;
}

/**
 * The PRODUCTION continuation-assembly path.
 *
 * It is the SAME path the predecessor's replay used, so the witness measures
 * the real seam rather than a stand-in.
 *
 * The CRITICAL detail: the carry-forward's `sourceMessageCount` is the
 * HISTORICAL BOUNDARY, and the retained tail comes from the FULL canonical
 * history. An assembler that derived the boundary from a collection's length
 * would reproduce the defect this witness exists to detect.
 */
async function assembleContinuation({
	canonical,
	boundary,
}: {
	canonical: readonly MessageWithMetadata[];
	boundary: number;
}): Promise<{ prefixDerived: string; full: string }> {
	const summaryMessage = {
		role: "user",
		content: [{ type: "text", text: "Context summary:\n\n## Goal\ntest" }],
		metadata: {
			kind: "compaction_summary",
			displayRole: "system",
			summary: "## Goal\ntest",
			details: { readFiles: [], modifiedFiles: [] },
			tokensBefore: 0,
			generatedAt: 0,
		},
	} as unknown as MessageWithMetadata;
	const compacted = [summaryMessage];
	const contracted = await applyTaskContractToCompactedMessages(
		compacted,
		canonical,
		{ sourceMessageCount: boundary } as never,
	);
	const evidenced = applyVerifiedEvidenceToCompactedMessages(
		contracted.messages,
		canonical,
		{ sourceMessageCount: boundary },
	);
	const state = createSessionCompactionState({
		sourceMessages: canonical,
		compactedMessages: evidenced.messages,
		conversationId: "witness",
	});
	// The state's own boundary is the FULL canonical length; the persisted
	// boundary is what selects the retained tail.
	const projected = projectSessionCompactionState(
		{ ...state, source_message_count: boundary },
		canonical,
	);
	const messages = projected ?? [];
	// The PREFIX-DERIVED content is the compacted head: the summary and the
	// carried sections. It is the compacted message list BEFORE the retained
	// tail is appended, so it is computed from the carry-forward's own
	// result rather than by slicing the projection.
	const prefixDerived = JSON.stringify(evidenced.messages);
	return {
		prefixDerived,
		full: JSON.stringify(messages),
	};
}

describe("C2.1 — the repaired source-boundary witness", () => {
	const BOUNDARY = 4;
	const POST_BOUNDARY_COUNT = 2;

	it("NEGATIVE: the re-derived prefix identity is preserved", async () => {
		const canonical = buildCanonicalHistory({
			preBoundaryCount: BOUNDARY,
			postBoundaryCount: POST_BOUNDARY_COUNT,
		});
		const originalHash = computeSourcePrefixHash(canonical, BOUNDARY);
		const contaminated = buildContaminatedHistory({ canonical });
		const result = await runNegativeControl({
			originalCanonical: canonical,
			contaminatedCanonical: contaminated.canonical,
			boundary: BOUNDARY,
			originalPrefixHash: originalHash,
			assemble: assembleContinuation,
		});
		expect(result.prefixIdentityPreserved).toBe(true);
		expect(result.derivedPrefixHash).toBe(originalHash);
		expect(result.boundary).toBe(BOUNDARY);
	});

	it("NEGATIVE: the contaminated history really IS contaminated", async () => {
		const canonical = buildCanonicalHistory({
			preBoundaryCount: BOUNDARY,
			postBoundaryCount: POST_BOUNDARY_COUNT,
		});
		const originalHash = computeSourcePrefixHash(canonical, BOUNDARY);
		const contaminated = buildContaminatedHistory({ canonical });
		const result = await runNegativeControl({
			originalCanonical: canonical,
			contaminatedCanonical: contaminated.canonical,
			boundary: BOUNDARY,
			originalPrefixHash: originalHash,
			assemble: assembleContinuation,
		});
		// The contamination window GREW: the synthetic observation added
		// post-boundary messages. Without this, the control would be vacuous.
		expect(result.contaminatedPostBoundaryMessageCount).toBe(
			result.cleanPostBoundaryMessageCount + contaminated.synthetic.length,
		);
	});

	it("NEGATIVE: the synthetic observation is INACCESSIBLE at the boundary", async () => {
		const canonical = buildCanonicalHistory({
			preBoundaryCount: BOUNDARY,
			postBoundaryCount: POST_BOUNDARY_COUNT,
		});
		const originalHash = computeSourcePrefixHash(canonical, BOUNDARY);
		const contaminated = buildContaminatedHistory({ canonical });
		const result = await runNegativeControl({
			originalCanonical: canonical,
			contaminatedCanonical: contaminated.canonical,
			boundary: BOUNDARY,
			originalPrefixHash: originalHash,
			assemble: assembleContinuation,
		});
		expect(result.markerInClean).toBe(false);
		expect(result.markerInContaminated).toBe(false);
		// The PREFIX-DERIVED content is byte-identical: the summary and the
		// carried sections are derived from the boundary prefix alone, so
		// appending messages after the boundary cannot change them.
		expect(result.prefixDerivedIdentical).toBe(true);
	});

	it("POSITIVE: advancing the boundary DELIBERATELY makes the observation visible", async () => {
		// The synthetic observation is placed where the carry-forward's
		// verified-outcome ledger can see it, so the positive control is a
		// control over the REAL read path.
		const canonical = buildCanonicalHistory({
			preBoundaryCount: BOUNDARY,
			postBoundaryCount: 0,
		});
		const contaminated = buildContaminatedHistory({ canonical });
		const positive = await runPositiveControl({
			contaminatedCanonical: contaminated.canonical,
			boundary: BOUNDARY,
			syntheticMessageCount: contaminated.synthetic.length,
			assemble: assembleContinuation,
		});
		expect(positive.advancedBoundary).toBe(
			BOUNDARY + contaminated.synthetic.length,
		);
		expect(positive.markerVisibleAtAdvancedBoundary).toBe(true);
	});

	it("the PAIR establishes both directions", async () => {
		const canonical = buildCanonicalHistory({
			preBoundaryCount: BOUNDARY,
			postBoundaryCount: 0,
		});
		const originalHash = computeSourcePrefixHash(canonical, BOUNDARY);
		const contaminated = buildContaminatedHistory({ canonical });
		const negative = await runNegativeControl({
			originalCanonical: canonical,
			contaminatedCanonical: contaminated.canonical,
			boundary: BOUNDARY,
			originalPrefixHash: originalHash,
			assemble: assembleContinuation,
		});
		const positive = await runPositiveControl({
			contaminatedCanonical: contaminated.canonical,
			boundary: BOUNDARY,
			syntheticMessageCount: contaminated.synthetic.length,
			assemble: assembleContinuation,
		});
		// The negative control: inaccessible.
		expect(negative.markerInContaminated).toBe(false);
		expect(negative.prefixDerivedIdentical).toBe(true);
		expect(negative.prefixIdentityPreserved).toBe(true);
		// The positive control: accessible.
		expect(positive.markerVisibleAtAdvancedBoundary).toBe(true);
	});

	it("the re-derived prefix never grows with the history", () => {
		const canonical = buildCanonicalHistory({
			preBoundaryCount: BOUNDARY,
			postBoundaryCount: POST_BOUNDARY_COUNT,
		});
		const contaminated = buildContaminatedHistory({ canonical });
		const derived = rederivePrefixAtBoundary({
			canonical: contaminated.canonical,
			boundary: BOUNDARY,
		});
		expect(derived.messages.length).toBe(BOUNDARY);
		expect(
			derived.messages.some((message) =>
				JSON.stringify(message.content).includes(POST_BOUNDARY_MARKER),
			),
		).toBe(false);
	});
});
