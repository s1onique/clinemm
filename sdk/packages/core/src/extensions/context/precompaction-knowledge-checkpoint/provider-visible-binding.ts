/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C3.1
 *
 * REQUEST-LOCAL canonical-reference-to-provider-visible-position BINDINGS.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 *
 * The predecessor recon established the precise missing seam:
 *
 *   "the candidate lists the reference LABELS in the suffix without their
 *    content, and the canonical ids are dropped by the projection, so the
 *    model cannot resolve which content a reference denotes. This is the
 *    precise missing seam: the canonical-id <-> provider-visible-position
 *    binding is not carried on the wire."
 *
 * This module PRODUCES that binding, at the authoritative projection
 * boundary, from the REAL provider-visible projection. It never
 * reconstructs an approximately equivalent projection.
 *
 * ============================================================================
 * THE BINDING IS REQUEST-LOCAL
 * ============================================================================
 *
 * The binding is derived from ONE (canonical history, provider-visible
 * projection) PAIR. It is not a global table and it is not persisted: it
 * describes what THIS request's provider-visible surface actually shows.
 *
 * ============================================================================
 * FAIL-CLOSED RESOLUTION
 * ============================================================================
 *
 * A canonical reference is RESOLVED only when it is simultaneously:
 *
 *   - WITHIN the authorized source interval,
 *   - VISIBLE in the provider-visible projection,
 *   - UNAMBIGUOUS (exactly one candidate position), and
 *   - NOT reasoning-only (private reasoning is not an authorized
 *     extraction source).
 *
 * Every other case yields an UNRESOLVED binding with a DISTINCT, observable
 * reason. An unresolved binding NEVER authorizes a citation: the mere
 * existence of a canonical ID in the canonical history is not authority.
 */

import type { MessageWithMetadata } from "@cline/shared";

/**
 * WHY a canonical reference did not resolve.
 *
 * Every value is DISTINCT and OBSERVABLE, so a consumer can tell an absent
 * source from an ambiguous one from an out-of-interval one.
 */
export type ProviderVisibleBindingReason =
	/** The canonical anchor has no position in the provider projection. */
	| "absent"
	/** The canonical anchor matches MORE THAN ONE provider-visible position. */
	| "ambiguous"
	/** The canonical anchor is OUTSIDE the authorized source interval. */
	| "out_of_interval"
	/** The anchor resolves only to PRIVATE REASONING content. */
	| "private_reasoning"
	/** The provider-visible content was TRUNCATED. */
	| "truncated";

/**
 * The resolution of ONE canonical reference.
 */
export type ProviderVisibleBinding =
	| {
			/** The canonical reference key (e.g. `id:msg_1`). */
			readonly reference: string;
			/** The resolution is RESOLVED and citable. */
			readonly status: "resolved";
			/** The index of the provider-visible MESSAGE. */
			readonly providerMessageIndex: number;
			/**
			 * The index of the provider-visible CONTENT BLOCK, when the
			 * reference denotes a single block. ABSENT when the reference
			 * denotes the whole message.
			 */
			readonly providerBlockIndex: number | undefined;
	  }
	| {
			/** The canonical reference key. */
			readonly reference: string;
			/** The resolution is UNRESOLVED and NON-AUTHORIZING. */
			readonly status: "unresolved";
			/** WHY the reference did not resolve. */
			readonly reason: ProviderVisibleBindingReason;
	  };

/**
 * The TRUNCATION markers the production projection inserts.
 *
 * Their presence means the provider-visible content is INCOMPLETE, so an
 * assurance that depends on the omitted material cannot be granted.
 */
const TRUNCATION_MARKERS: readonly string[] = [
	"...[truncated ",
	"...[assistant text truncated",
];

/**
 * The provider-visible projection, as the production projection emits it.
 *
 * It is the SAME shape `MessageBuilder.buildForApi` returns: the canonical
 * message's `id` is PRESERVED for every message that survives the
 * projection, and it is DROPPED for a message the projection merges into a
 * predecessor. The binding therefore resolves on `id`, and a canonical
 * message whose id the projection dropped resolves to `absent` — which is
 * the recon's missing seam made explicit.
 */
export interface ProviderVisibleMessage {
	readonly role: string;
	readonly id?: string;
	readonly content: unknown;
}

/**
 * Whether a message consists ONLY of private reasoning blocks.
 *
 * A message with NO content blocks at all is not reasoning-only: it
 * carries nothing, and it is handled by the visibility rules instead.
 */
function isReasoningOnlyMessage(message: MessageWithMetadata): boolean {
	if (!Array.isArray(message.content) || message.content.length === 0) {
		return false;
	}
	return message.content.every(
		(block) => block.type === "thinking" || block.type === "redacted_thinking",
	);
}

/**
 * Whether ANY string in the value carries a production truncation marker.
 */
function containsTruncationMarker(value: unknown): boolean {
	if (typeof value === "string") {
		return TRUNCATION_MARKERS.some((marker) => value.includes(marker));
	}
	if (Array.isArray(value)) {
		return value.some((entry) => containsTruncationMarker(entry));
	}
	if (value && typeof value === "object") {
		return Object.values(value as Record<string, unknown>).some((entry) =>
			containsTruncationMarker(entry),
		);
	}
	return false;
}

/**
 * ============================================================================
 * THE BINDING
 * ============================================================================
 *
 * Build the request-local canonical-reference-to-provider-visible-position
 * bindings for ONE (canonical history, provider-visible projection) pair.
 *
 * THE ORDER OF THE CHECKS IS LOAD-BEARING
 * ---------------------------------------
 *
 *   1. AUTHORIZATION: a reference OUTSIDE the authorized source interval is
 *      rejected FIRST. Data that is physically visible in the parent
 *      projection is NOT automatically authorized for extraction, and the
 *      existence of a canonical ID is not authority.
 *   2. VISIBILITY: a reference with no provider-visible position is
 *      `absent`. The production projection DROPS the id of a message it
 *      merges into a predecessor, so a canonical reference can be present
 *      in the canonical history and still have NO position the model can
 *      resolve.
 *   3. AMBIGUITY: a reference matching MORE THAN ONE provider-visible
 *      position is `ambiguous`. It cannot be attributed to either.
 *   4. PRIVATE REASONING: a reference resolving ONLY to reasoning content
 *      is `private_reasoning`. It is wire-visible but is not an authorized
 *      extraction source.
 *   5. TRUNCATION: a reference whose provider-visible content was truncated
 *      is `truncated`, so no assurance is granted on material the model
 *      cannot see.
 */
export function buildProviderVisibleBindings(input: {
	/** The CANONICAL history the checkpoint is derived from. */
	readonly canonicalMessages: readonly MessageWithMetadata[];
	/** The REAL provider-visible projection of that history. */
	readonly providerMessages: readonly ProviderVisibleMessage[];
	/**
	 * The AUTHORIZED SOURCE INTERVAL: the number of leading CANONICAL
	 * messages the compaction decision authorizes for extraction.
	 *
	 * It is the compaction decision's own source authority, so a canonical
	 * reference beyond it is never authorized even when it is visible.
	 */
	readonly authorizedMessageCount: number;
}): ReadonlyMap<string, ProviderVisibleBinding> {
	const bindings = new Map<string, ProviderVisibleBinding>();
	const canonical = input.canonicalMessages;

	// The provider-visible positions, INDEXED by the canonical message id.
	// A provider message may carry the id of the canonical message it
	// renders, so the index is a LIST: the same id appearing twice is an
	// AMBIGUITY, not a certainty.
	const providerIndexByCanonicalId = new Map<string, number[]>();
	for (const [
		providerIndex,
		providerMessage,
	] of input.providerMessages.entries()) {
		const id = providerMessage.id;
		if (typeof id !== "string" || id.length === 0) {
			continue;
		}
		const existing = providerIndexByCanonicalId.get(id);
		if (existing) {
			existing.push(providerIndex);
		} else {
			providerIndexByCanonicalId.set(id, [providerIndex]);
		}
	}

	// The canonical tool-call ids, INDEXED to the canonical message they
	// were declared in. The tool-call id is the reference the gate checks,
	// so the binding must resolve for it too.
	const canonicalMessageIndexByToolCallId = new Map<string, number[]>();
	for (const [canonicalIndex, message] of canonical.entries()) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_use") {
				continue;
			}
			const existing = canonicalMessageIndexByToolCallId.get(block.id);
			if (existing) {
				existing.push(canonicalIndex);
			} else {
				canonicalMessageIndexByToolCallId.set(block.id, [canonicalIndex]);
			}
		}
	}

	const unresolved = (
		reference: string,
		reason: ProviderVisibleBindingReason,
	): ProviderVisibleBinding => ({ reference, status: "unresolved", reason });

	// The MESSAGE references: `id:<canonical message id>`.
	for (const [canonicalIndex, message] of canonical.entries()) {
		const id = message.id;
		if (typeof id !== "string" || id.length === 0) {
			continue;
		}
		const reference = `id:${id}`;
		if (canonicalIndex >= input.authorizedMessageCount) {
			bindings.set(reference, unresolved(reference, "out_of_interval"));
			continue;
		}
		const providerIndexes = providerIndexByCanonicalId.get(id) ?? [];
		if (providerIndexes.length === 0) {
			bindings.set(reference, unresolved(reference, "absent"));
			continue;
		}
		if (providerIndexes.length > 1) {
			bindings.set(reference, unresolved(reference, "ambiguous"));
			continue;
		}
		if (isReasoningOnlyMessage(message)) {
			bindings.set(reference, unresolved(reference, "private_reasoning"));
			continue;
		}
		const providerMessage = input.providerMessages[providerIndexes[0]];
		if (
			!containsTruncationMarker(message.content) &&
			containsTruncationMarker(providerMessage.content)
		) {
			bindings.set(reference, unresolved(reference, "truncated"));
			continue;
		}
		bindings.set(reference, {
			reference,
			status: "resolved",
			providerMessageIndex: providerIndexes[0],
			providerBlockIndex: undefined,
		});
	}

	// The TOOL-CALL references: the canonical tool-call id.
	for (const [
		toolCallId,
		canonicalIndexes,
	] of canonicalMessageIndexByToolCallId.entries()) {
		if (canonicalIndexes.length > 1) {
			bindings.set(toolCallId, unresolved(toolCallId, "ambiguous"));
			continue;
		}
		const canonicalIndex = canonicalIndexes[0];
		if (canonicalIndex >= input.authorizedMessageCount) {
			bindings.set(toolCallId, unresolved(toolCallId, "out_of_interval"));
			continue;
		}
		const providerPositions = findProviderToolPositions(
			input.providerMessages,
			toolCallId,
		);
		if (providerPositions.length === 0) {
			bindings.set(toolCallId, unresolved(toolCallId, "absent"));
			continue;
		}
		if (providerPositions.length > 1) {
			bindings.set(toolCallId, unresolved(toolCallId, "ambiguous"));
			continue;
		}
		bindings.set(toolCallId, {
			reference: toolCallId,
			status: "resolved",
			providerMessageIndex: providerPositions[0].messageIndex,
			providerBlockIndex: providerPositions[0].blockIndex,
		});
	}

	return bindings;
}

/**
 * The provider-visible positions of the tool call and its result.
 *
 * A tool call contributes TWO positions in the provider projection: the
 * `tool_use` block that DECLARED it and the `tool_result` block that
 * ANSWERED it. Both are returned, so the caller can decide whether the
 * event is fully visible.
 */
function findProviderToolPositions(
	providerMessages: readonly ProviderVisibleMessage[],
	toolCallId: string,
): readonly { messageIndex: number; blockIndex: number }[] {
	const positions: { messageIndex: number; blockIndex: number }[] = [];
	for (const [messageIndex, message] of providerMessages.entries()) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const [blockIndex, block] of message.content.entries()) {
			if (!block || typeof block !== "object") {
				continue;
			}
			const record = block as {
				type?: unknown;
				id?: unknown;
				tool_use_id?: unknown;
			};
			if (
				(record.type === "tool_use" && record.id === toolCallId) ||
				(record.type === "tool_result" && record.tool_use_id === toolCallId)
			) {
				positions.push({ messageIndex, blockIndex });
			}
		}
	}
	return positions;
}

/**
 * The canonical references that RESOLVED to an authorized, visible,
 * unambiguous provider-visible position.
 *
 * These are the ONLY references the publication gate may admit. Every other
 * reference is non-authorizing.
 */
export function collectAuthorizedReferences(
	bindings: ReadonlyMap<string, ProviderVisibleBinding>,
): readonly string[] {
	const authorized: string[] = [];
	for (const binding of bindings.values()) {
		if (binding.status === "resolved") {
			authorized.push(binding.reference);
		}
	}
	return authorized;
}
