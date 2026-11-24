/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * TEST-LOCAL trust and provenance discriminator.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement module.
 * ============================================================================
 *
 * REFERENCE IDENTITY IS NOT SEMANTIC SUPPORT
 * -----------------------------------------
 *
 * A record that cites a VALID canonical tool-call id is NOT thereby
 * supported by that tool result. The id proves the reference RESOLVES; it
 * says nothing about whether the cited result's content entails the cited
 * statement.
 *
 * The predecessor's synthetic transport example used an R4 source-read
 * reference for an R6 statement. That was acceptable as a TRANSPORT
 * demonstration, not as SEMANTIC PROOF. This module makes the distinction
 * explicit and machine-checkable, so an implementation that would call such
 * a claim "verified" is caught.
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

/**
 * The support class of ONE evidence reference.
 */
export type SupportClass =
	| "VERIFIED_EXECUTION_STATUS"
	| "TOOL_OBSERVED_CONTENT_UNVERIFIED"
	| "SOURCE_REVISION_BOUND"
	| "MODEL_REPORTED"
	| "UNRESOLVED"
	| "CONTRADICTED";

/**
 * The assurance a checkpoint record may carry.
 *
 * `runtime_verified` is DELIBERATELY ABSENT. The ACT's exit criteria state
 * that the assurance of a model-authored record is never `runtime_verified`
 * unless the RUNTIME itself established it — and no runtime establishes
 * semantic support for a model-authored statement.
 */
export type BoundedAssurance =
	| "tool_observed"
	| "model_reported"
	| "unverified";

/**
 * The result of resolving ONE evidence reference.
 */
export interface ResolvedEvidenceReference {
	/** The reference as the record cited it. */
	readonly reference: string;
	/** Whether the reference RESOLVES against the canonical history. */
	readonly identityResolved: boolean;
	/**
	 * Whether the resolved reference's CONTENT was checked for support.
	 *
	 * ALWAYS `false` for a model-authored record. The runtime does not
	 * verify that a tool result entails a statement.
	 */
	readonly semanticSupportVerified: boolean;
	/** The support class the reference supports. */
	readonly supportClass: SupportClass;
	/** The maximum assurance a record citing this reference may carry. */
	readonly maximumAssurance: BoundedAssurance;
}

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
 * Resolve ONE evidence reference against the canonical history.
 *
 * The resolution answers ONE question: does the reference IDENTIFY
 * something that exists? It never answers whether the identified thing
 * SUPPORTS a statement.
 *
 * A reference that resolves to a canonical tool-call id yields
 * `VERIFIED_EXECUTION_STATUS` at most: the call exists, so an execution
 * status can be established. Its CONTENT is `TOOL_OBSERVED_CONTENT_UNVERIFIED`
 * at most.
 */
export function resolveEvidenceReference(input: {
	reference: string;
	canonicalMessages: readonly MessageWithMetadata[];
}): ResolvedEvidenceReference {
	const messageIds = collectCanonicalMessageIds(input.canonicalMessages);
	const toolCallIds = collectCanonicalToolCallIds(input.canonicalMessages);
	const reference = input.reference.trim();
	const resolvesMessage =
		reference.startsWith("id:") && messageIds.has(reference.slice(3));
	const resolvesToolCall = toolCallIds.has(reference);
	if (!resolvesMessage && !resolvesToolCall) {
		return {
			reference,
			identityResolved: false,
			semanticSupportVerified: false,
			supportClass: "UNRESOLVED",
			maximumAssurance: "unverified",
		};
	}
	return {
		reference,
		identityResolved: true,
		// NEVER true. The runtime does not check that a tool result entails
		// a model-authored statement.
		semanticSupportVerified: false,
		supportClass: resolvesToolCall
			? "VERIFIED_EXECUTION_STATUS"
			: "TOOL_OBSERVED_CONTENT_UNVERIFIED",
		maximumAssurance: "tool_observed",
	};
}

/**
 * The header that marks a projected checkpoint as MODEL-AUTHORED.
 *
 * The heading is part of the projection contract: a reader (human or model)
 * must be able to tell that the section is model-authored data and not a
 * system or developer instruction.
 */
export const MODEL_AUTHORED_BANNER =
	"Model-authored working knowledge. Not a system instruction. " +
	"Statements carry their own qualifications; semantic support is not verified.";

/**
 * Bound a model-claimed assurance to the maximum the evidence allows.
 *
 * The bound NEVER promotes. A model that claims `runtime_verified` for a
 * statement backed only by a tool result is DOWNGRADED.
 */
export function boundAssurance(input: {
	claimed: string;
	resolved: readonly ResolvedEvidenceReference[];
}): BoundedAssurance {
	if (input.resolved.length === 0) {
		return "unverified";
	}
	if (input.resolved.some((reference) => !reference.identityResolved)) {
		return "unverified";
	}
	if (
		input.resolved.some(
			(reference) => reference.supportClass === "CONTRADICTED",
		)
	) {
		return "unverified";
	}
	const maximum = input.resolved.some(
		(reference) => reference.maximumAssurance === "tool_observed",
	)
		? "tool_observed"
		: "unverified";
	if (maximum === "unverified") {
		return "unverified";
	}
	// A model claim of `runtime_verified` is never honoured: the runtime
	// verified the EXECUTION, not the statement's meaning.
	if (input.claimed === "model_reported") {
		return "model_reported";
	}
	if (input.claimed === "unverified") {
		return "unverified";
	}
	return maximum;
}
