/**
 * ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01
 *
 * C2.3 — THE PROJECTION WITNESS.
 *
 * ============================================================================
 * WHAT THE ACT ASKS FOR
 * ============================================================================
 *
 *   "Do not construct a persisted state from the full canonical history and
 *   subsequently overwrite only its source-message count.
 *
 *    Construct internally consistent source identity and boundary state
 *    through the production seam.
 *
 *    Assert that the production projector accepts it.
 *
 *    Do not convert undefined projection into an empty successful
 *    continuation.
 *
 *    The negative control must distinguish prefix-derived sections from the
 *    legitimately retained post-boundary tail."
 *
 * ============================================================================
 * THE DEFECT THIS AVOIDS
 * ============================================================================
 *
 * The production projector REFUSES a state whose `source_prefix_hash` does
 * not match the hash of the first `source_message_count` canonical messages:
 *
 *     sourcePrefixHash(sourceMessages, state.source_message_count) ===
 *         state.source_prefix_hash
 *
 * A state built from the FULL canonical history and then given a smaller
 * `source_message_count` therefore FAILS that check, and the projection is
 * `undefined`.
 *
 * An `undefined` projection is NOT an empty successful continuation. It is
 * the projector saying "this state does not describe a boundary I can
 * reconstruct". Conflating the two is the defect this witness guards
 * against, so every case here asserts the projector ACCEPTED the state.
 *
 * ============================================================================
 * THE POST-BOUNDARY TAIL
 * ============================================================================
 *
 * The negative control must distinguish the PREFIX-DERIVED content — the
 * summary and the carried sections, which come from the boundary prefix —
 * from the RETAINED TAIL, which legitimately comes from the messages AFTER
 * the boundary.
 *
 * A contaminated history has MORE tail, so its full projection legitimately
 * differs. The invariant is that the PREFIX-DERIVED part is byte-identical.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
} from "../../session/models/session-compaction";
import {
	applySourceBoundEvidenceToCompactedMessages,
	setSourceBoundEvidenceCarryForwardForTesting,
} from "./source-bound-evidence";
import { selectTaskConditionedEvidenceAtBoundary } from "./task-conditioned-evidence-selection";

const restore: Array<() => void> = [];

function enable(): void {
	restore.push(setSourceBoundEvidenceCarryForwardForTesting(true));
}

/**
 * The restore must run after every case.
 */
async function withRestore(fn: () => void | Promise<void>): Promise<void> {
	try {
		await fn();
	} finally {
		while (restore.length > 0) {
			restore.pop()?.();
		}
	}
}

function invocation(index: number): MessageWithMetadata {
	return {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id: `call_${index}`,
				name: "read_files",
				input: { query: `src/subject/Subject${index}.java` },
			},
		],
		ts: index,
	} as unknown as MessageWithMetadata;
}

function result(index: number): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: `call_${index}`,
				name: "read_files",
				content: [
					{
						success: true,
						query: `src/subject/Subject${index}.java`,
						result: `class Subject${index} { static final int VALUE_${index} = ${index}; }`,
					},
				],
				is_error: false,
			},
		],
		ts: index,
	} as unknown as MessageWithMetadata;
}

function summaryMessage(summary = "## Goal\nwork"): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text: `Context summary:\n\n${summary}` }],
		metadata: {
			kind: "compaction_summary",
			displayRole: "system",
			summary,
			details: { readFiles: [], modifiedFiles: [] },
			tokensBefore: 0,
			generatedAt: 0,
		},
	} as unknown as MessageWithMetadata;
}

/**
 * The CANONICAL history: six invocation/result pairs.
 */
function canonicalHistory(): MessageWithMetadata[] {
	const messages: MessageWithMetadata[] = [];
	for (let index = 0; index < 6; index += 1) {
		messages.push(invocation(index), result(index));
	}
	return messages;
}

describe("C2.3 — the projection witness", () => {
	it("the production projector ACCEPTS an internally consistent state", async () => {
		await withRestore(() => {
			enable();
			const canonical = canonicalHistory();
			const boundary = 8;
			const selection = selectTaskConditionedEvidenceAtBoundary({
				messages: canonical,
				sourceMessageCount: boundary,
			});
			const carried = applySourceBoundEvidenceToCompactedMessages(
				[summaryMessage()],
				canonical,
				{
					sourceMessageCount: boundary,
					selectedFragments: selection.fragments,
				},
			);
			expect(carried.applied).toBe(true);
			// The state is built by the PRODUCTION constructor over the SAME
			// prefix the boundary names, so its identity is internally
			// consistent by construction.
			const state = createSessionCompactionState({
				sourceMessages: canonical.slice(0, boundary),
				compactedMessages: carried.messages,
				conversationId: "witness",
			});
			expect(state.source_message_count).toBe(boundary);
			// The production projector ACCEPTS it. An `undefined` here would
			// be a REFUSAL, not an empty continuation.
			const projected = projectSessionCompactionState(state, canonical);
			expect(projected).toBeDefined();
			expect(projected?.length).toBeGreaterThan(0);
			// The projection carries the summary AND the retained tail.
			expect(projected?.[0].metadata?.kind).toBe("compaction_summary");
		});
	});

	it("REFUSES a state whose identity does not match its boundary", async () => {
		await withRestore(() => {
			enable();
			const canonical = canonicalHistory();
			// The FORBIDDEN construction: the state is built over the FULL
			// canonical history and its count is then OVERWRITTEN.
			const state = createSessionCompactionState({
				sourceMessages: canonical,
				compactedMessages: [summaryMessage()],
				conversationId: "witness",
			});
			const tampered = {
				...state,
				source_message_count: 8,
			};
			// The projector REFUSES it. The witness asserts the refusal is
			// visible as `undefined`, so it can never be confused with an
			// empty successful continuation.
			expect(
				projectSessionCompactionState(tampered, canonical),
			).toBeUndefined();
		});
	});

	it("distinguishes the PREFIX-DERIVED content from the retained tail", async () => {
		await withRestore(() => {
			enable();
			const canonical = canonicalHistory();
			const boundary = 8;
			const selection = selectTaskConditionedEvidenceAtBoundary({
				messages: canonical,
				sourceMessageCount: boundary,
			});
			const carried = applySourceBoundEvidenceToCompactedMessages(
				[summaryMessage()],
				canonical,
				{
					sourceMessageCount: boundary,
					selectedFragments: selection.fragments,
				},
			);
			const state = createSessionCompactionState({
				sourceMessages: canonical.slice(0, boundary),
				compactedMessages: carried.messages,
				conversationId: "witness",
			});
			const clean = projectSessionCompactionState(state, canonical);
			expect(clean).toBeDefined();

			// The CONTAMINATED history: two MORE messages AFTER the boundary.
			// The boundary is UNCHANGED, so the prefix is unchanged.
			const contaminated = [...canonical, invocation(6), result(6)];
			const contaminatedState = createSessionCompactionState({
				sourceMessages: canonical.slice(0, boundary),
				compactedMessages: carried.messages,
				conversationId: "witness",
			});
			const contaminatedProjection = projectSessionCompactionState(
				contaminatedState,
				contaminated,
			);
			expect(contaminatedProjection).toBeDefined();

			// The PREFIX-DERIVED content — the summary and the carried
			// section — is BYTE-IDENTICAL. It is derived from the boundary
			// prefix alone.
			expect(contaminatedProjection?.[0]).toEqual(clean?.[0]);
			// The RETAINED TAIL legitimately DIFFERS: the contaminated history
			// has two more messages after the boundary.
			expect(contaminatedProjection?.length).toBe((clean?.length ?? 0) + 2);
			// The synthetic observation IS visible in the tail: that is what
			// makes the tail difference a REAL difference and not a defect.
			const tailText = JSON.stringify(contaminatedProjection?.slice(1));
			expect(tailText).toContain("Subject6");
			// And it is NOT in the clean tail.
			expect(JSON.stringify(clean?.slice(1))).not.toContain("Subject6");
		});
	});
});
