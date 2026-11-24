/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
 *
 * PRODUCTION canonical-evidence collection for the Pre-Compaction Knowledge
 * Checkpoint (PCK).
 *
 * ============================================================================
 * REFERENCE IDENTITY IS NOT SEMANTIC SUPPORT
 * ============================================================================
 *
 * A record that cites a VALID canonical tool-call id is NOT thereby
 * supported by that tool result. The id proves the reference RESOLVES; it
 * says nothing about whether the cited result's content entails the cited
 * statement.
 *
 * NO AUTHORITY LAUNDERING
 * -----------------------
 *
 * The checkpoint is MODEL-AUTHORED data. Attaching it to a compaction
 * summary does not make it a system instruction, a developer instruction, or
 * a verified source finding. Every projected checkpoint identifies itself
 * as model-authored and carries its assurance limitations.
 */

import type { MessageWithMetadata } from "@cline/shared";
import type { BoundedAssurance } from "./closed-vocabulary";

/**
 * The canonical tool-call ids present in a canonical history.
 *
 * An id that is claimed by MORE THAN ONE canonical call is AMBIGUOUS and is
 * EXCLUDED from the returned set. The production evidence-continuity module
 * fails closed on the same condition: a tool-call id is a join key, not a
 * guaranteed-unique identity, and attributing a result to the wrong call is
 * worse than attributing it to none.
 */
export function collectCanonicalToolCallIds(
	messages: readonly MessageWithMetadata[],
): Set<string> {
	const counts = new Map<string, number>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				counts.set(block.id, (counts.get(block.id) ?? 0) + 1);
			}
		}
	}
	const ids = new Set<string>();
	for (const [id, count] of counts) {
		if (count === 1) {
			ids.add(id);
		}
	}
	return ids;
}

/**
 * The canonical MESSAGE ids present in a canonical history.
 */
export function collectCanonicalMessageIds(
	messages: readonly MessageWithMetadata[],
): Set<string> {
	const ids = new Set<string>();
	for (const message of messages) {
		if (typeof message.id === "string" && message.id.trim()) {
			ids.add(message.id);
		}
	}
	return ids;
}

/**
 * The runtime's OBSERVED canonical reference set for ONE session.
 *
 * A reference is admissible ONLY if it is a member of this set. The set is
 * derived from the session's own canonical history, so a reference from an
 * unrelated session history never resolves.
 */
export function collectObservedCanonicalReferences(
	messages: readonly MessageWithMetadata[],
): readonly string[] {
	const references = new Set<string>();
	for (const id of collectCanonicalToolCallIds(messages)) {
		references.add(id);
	}
	for (const id of collectCanonicalMessageIds(messages)) {
		references.add(`id:${id}`);
	}
	return [...references];
}

/**
 * The runtime's own evidence interpreter.
 *
 * It answers ONE question: what is the MAXIMUM assurance the RUNTIME can
 * support for a set of canonical references?
 *
 * It NEVER inspects a model-authored statement, and it NEVER returns
 * `runtime_verified`. It inspects the OBSERVED canonical tool events:
 *
 *   - a canonical tool-call id proves the call EXISTS, so an EXECUTION
 *     status can be established — but its CONTENT is unverified;
 *   - a canonical MESSAGE id proves the message exists, but says nothing
 *     about what it entails.
 *
 * Therefore the maximum assurance for a reference set is `tool_observed`
 * ONLY when the set contains at least one canonical TOOL-CALL id, and
 * `model_reported` otherwise. A syntactically valid reference NEVER raises
 * a claim by itself: a `run_commands` execution that returned "hello" does
 * not make a `SEARCH_RETURNED_NO_MATCH` claim an independently verified
 * search result.
 */
export function interpretCanonicalEvidence(input: {
	readonly canonicalMessages: readonly MessageWithMetadata[];
	readonly references: readonly string[];
}): BoundedAssurance | undefined {
	if (input.references.length === 0) {
		return undefined;
	}
	const toolCallIds = collectCanonicalToolCallIds(input.canonicalMessages);
	const messageIds = collectCanonicalMessageIds(input.canonicalMessages);
	const observed = input.references.filter(
		(reference) =>
			toolCallIds.has(reference) ||
			(reference.startsWith("id:") && messageIds.has(reference.slice(3))),
	);
	if (observed.length === 0) {
		return "unverified";
	}
	// A reference set that includes at least one OBSERVED TOOL CALL
	// establishes that an execution happened, so `tool_observed` is
	// available as the ceiling. A set of MESSAGE references only
	// establishes that messages exist, so its ceiling is `model_reported`.
	if (observed.some((reference) => toolCallIds.has(reference))) {
		return "tool_observed";
	}
	return "model_reported";
}
