/**
 * ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01
 *
 * C1 — the FROZEN SOURCE PREFIX.
 *
 * ============================================================================
 * WHAT IT IS
 * ============================================================================
 *
 * A frozen, cryptographically-identified view of the canonical history AS IT
 * WAS at the historical compaction boundary.
 *
 * The predecessor ACT (COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01)
 * replayed the historical compaction over the correct prefix but then handed
 * the FULL canonical history to the carry-forward mechanisms. Those mechanisms
 * take a `sourceMessageCount` boundary and derive their carried sections from
 * the canonical prefix up to that boundary. Passing the full length made the
 * "boundary prefix" the WHOLE history, so the carry-forwards could observe
 * information acquired AFTER the boundary that the replayed continuation was
 * supposed to be blind to.
 *
 * This module makes the boundary EXPLICIT and ENFORCEABLE:
 *
 *   - `freezeSourcePrefix()` captures the exact prefix and its identity.
 *   - `postBoundaryMessageCount()` measures the contamination window.
 *
 * ============================================================================
 * WHY IT IS NOT "ANOTHER SOURCE-IDENTITY FRAMEWORK"
 * ============================================================================
 *
 * The ACT forbids one. This is NOT one: it is the SAME boundary the
 * persisted sidecar already records (`source_message_count` +
 * `source_prefix_hash`), re-expressed as an explicit, checkable value that
 * the replay passes everywhere instead of recomputing it from a growing
 * history.
 */

import { createHash } from "node:crypto";
import type { MessageWithMetadata, TextContent } from "@cline/shared";

/**
 * The PRODUCTION `sourcePrefixHash` domain separator.
 *
 * It is copied VERBATIM from
 * `sdk/packages/core/src/session/models/session-compaction.ts` so that a
 * prefix frozen here has the SAME identity as the one the production sidecar
 * recorded.
 */
export const SOURCE_PREFIX_HASH_DOMAIN = "cline-session-compaction-source-v2\n";

/**
 * A FROZEN source prefix.
 *
 * The `messages` are the canonical messages that belonged to the compacted
 * prefix, in order. They are the ONLY authority the replay may consult.
 */
export interface FrozenSourcePrefix {
	/** The session the prefix came from. */
	readonly sessionId: string;
	/**
	 * The number of canonical messages that belonged to the compacted prefix.
	 * This is the EXACT historical boundary.
	 */
	readonly boundary: number;
	/**
	 * The identity of the prefix, recomputed with the production hash.
	 *
	 * It MUST equal the sidecar's own `source_prefix_hash` for the frozen
	 * prefix to be the exact historical one.
	 */
	readonly prefixHash: string;
	/** The frozen prefix itself. */
	readonly messages: readonly MessageWithMetadata[];
	/**
	 * The number of canonical messages in the FULL history the prefix was
	 * taken from. It is recorded so that the post-boundary contamination can
	 * be MEASURED rather than asserted.
	 */
	readonly fullCanonicalLength: number;
}

/**
 * The production message normalization for the source hash.
 *
 * A `user` message's display text is normalized through
 * `formatDisplayUserInput()` before hashing. The normalizer is INJECTED by
 * the caller so that this module has no dependency beyond the hash itself and
 * can be exercised from a bare context test.
 */
export type SourceHashNormalizer = (
	message: MessageWithMetadata,
) => MessageWithMetadata;

/**
 * Compute the PRODUCTION source-prefix hash over the first `count` messages.
 *
 * The exact input shape is the production one: a domain separator, the count,
 * and then one JSON line per message.
 */
export function computeSourcePrefixHash(
	messages: readonly MessageWithMetadata[],
	count: number,
	normalize: SourceHashNormalizer = (message) => message,
): string {
	const hash = createHash("sha256");
	hash.update(SOURCE_PREFIX_HASH_DOMAIN);
	hash.update(`${count}\n`);
	for (const message of messages.slice(0, count)) {
		const normalized = normalize(message);
		hash.update(
			JSON.stringify([
				["role", normalized.role],
				["content", normalized.content],
				["agent", normalized.agent ?? null],
				["sessionId", normalized.sessionId ?? null],
				["metadata", normalized.metadata ?? null],
				["modelInfo", normalized.modelInfo ?? null],
				["metrics", normalized.metrics ?? null],
			]),
		);
		hash.update("\n");
	}
	return `sha256:${hash.digest("hex")}`;
}

/**
 * Freeze the EXACT historical source prefix of a workload.
 *
 * `canonical` MUST already be the CANONICAL message collection (the
 * display-only messages excluded) — the same collection the persisted
 * boundary was counted over.
 *
 * The returned prefix carries the boundary AND its identity. A caller that
 * passes a different boundary to a carry-forward is then a BUG the caller can
 * detect, because the frozen boundary is available to compare against.
 */
export function freezeSourcePrefix(input: {
	readonly sessionId: string;
	readonly canonical: readonly MessageWithMetadata[];
	readonly boundary: number;
	readonly expectedPrefixHash?: string;
	readonly normalize?: SourceHashNormalizer;
}): FrozenSourcePrefix {
	if (input.boundary < 0 || input.boundary > input.canonical.length) {
		throw new Error(
			`the boundary ${input.boundary} is outside the canonical history of ${input.canonical.length} messages`,
		);
	}
	const messages = input.canonical.slice(0, input.boundary);
	const prefixHash = computeSourcePrefixHash(
		input.canonical,
		input.boundary,
		input.normalize,
	);
	if (
		input.expectedPrefixHash !== undefined &&
		input.expectedPrefixHash !== prefixHash
	) {
		throw new Error(
			`the frozen prefix does not match the recorded identity: expected ${input.expectedPrefixHash}, computed ${prefixHash}`,
		);
	}
	return {
		sessionId: input.sessionId,
		boundary: input.boundary,
		prefixHash,
		messages,
		fullCanonicalLength: input.canonical.length,
	};
}

/**
 * The number of canonical messages that lie AFTER the frozen boundary.
 *
 * This is the CONTAMINATION WINDOW: the number of messages the carry-forward
 * mechanisms would have been able to observe had the full history been passed
 * as the boundary instead of the frozen one.
 */
export function postBoundaryMessageCount(prefix: FrozenSourcePrefix): number {
	return Math.max(0, prefix.fullCanonicalLength - prefix.boundary);
}

/**
 * A SYNTHETIC post-boundary observation.
 *
 * It exists for ONE purpose: to PROVE that the reconstructed continuation at
 * the decision boundary cannot be changed by information that arrived after
 * it. The observation is deliberately loud — it carries a distinctive marker
 * string — so that its absence from the continuation is unambiguous.
 */
export const POST_BOUNDARY_MARKER = "SYNTHETIC-POST-BOUNDARY-OBSERVATION";

/**
 * The TOOL-CALL ID of the synthetic observation.
 *
 * It is derived from the marker so that the observation is detectable in
 * EVERY route a carry-forward can publish it:
 *
 *   - the verified-outcome section carries the tool-call id;
 *   - the retained tail carries the message content;
 *   - the source-file-fact section carries the payload's own text.
 *
 * A marker that only appeared in one of those routes would make the
 * positive control dependent on which route happens to publish it.
 */
export const POST_BOUNDARY_TOOL_USE_ID = "synthetic-post-boundary-observation";

/**
 * Build a synthetic post-boundary assistant/tool message pair.
 *
 * The message carries the marker in BOTH a text block and a tool-result body,
 * so that the check covers the two routes by which post-boundary content
 * could enter a continuation: the retained tail and the carried sections.
 */
export function buildSyntheticPostBoundaryMessages(): MessageWithMetadata[] {
	return [
		{
			role: "assistant",
			content: [
				{
					type: "text",
					text: `${POST_BOUNDARY_MARKER}: this observation was acquired AFTER the compaction boundary and must never appear in a continuation reconstructed at that boundary.`,
				},
				{
					type: "tool_use",
					id: POST_BOUNDARY_TOOL_USE_ID,
					name: "run_commands",
					input: { commands: ["echo synthetic-post-boundary-observation"] },
				},
			],
			ts: 0,
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: POST_BOUNDARY_TOOL_USE_ID,
					name: "run_commands",
					content: [
						{
							success: true,
							result: `${POST_BOUNDARY_MARKER}: echo synthetic-post-boundary-observation`,
						} as unknown as TextContent,
					],
					is_error: false,
				},
			],
			ts: 0,
		},
	];
}
