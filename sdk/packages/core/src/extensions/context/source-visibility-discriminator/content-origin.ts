/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * TEST-LOCAL classification of the ORIGIN of every content block that a
 * checkpoint input view could carry.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement module.
 * ============================================================================
 *
 * WHY ORIGIN CLASSIFICATION IS SEPARATE FROM PRESENCE
 * ---------------------------------------------------
 *
 * A capture that shows an assistant block labelled `text` is NOT sufficient
 * evidence that the block is ordinary publishable assistant text. The
 * transcript can carry a private reasoning block, a runtime annotation, a
 * tool input, or a tool result, and all of them are "in the message".
 *
 * So every candidate block is classified by its ORIGIN before any view is
 * built, and the classification — not the presence of a keyword — decides
 * whether the block may be forwarded.
 *
 * THE FAIL-CLOSED RULE
 * -------------------
 *
 * A block whose origin cannot be established is `UNKNOWN_ORIGIN` and is
 * NEVER forwarded. Private reasoning is never copied, extracted, serialized
 * or published as a checkpoint conclusion.
 */

import type { MessageWithMetadata } from "@cline/shared";

/**
 * The origin of ONE content block in the canonical history.
 */
export type ContentOrigin =
	/** A typed user turn. The task statement and the user's own messages. */
	| "USER_CONTENT"
	/** An assistant block the agent already PUBLISHED as ordinary text. */
	| "ASSISTANT_PUBLIC_TEXT"
	/** Private assistant reasoning. NEVER forwardable. */
	| "ASSISTANT_THINKING"
	/** A tool CALL's declared input. */
	| "TOOL_INPUT"
	/** A tool RESULT. Untrusted content, observed by the runtime. */
	| "TOOL_RESULT"
	/** A runtime-added annotation (metadata, trailers, markers). */
	| "RUNTIME_METADATA"
	/** The origin could not be established. NEVER forwardable. */
	| "UNKNOWN_ORIGIN";

/**
 * The origins that may be forwarded to a checkpoint model.
 *
 * `ASSISTANT_THINKING` and `UNKNOWN_ORIGIN` are deliberately absent: they are
 * the fail-closed set.
 */
export const FORWARDABLE_ORIGINS: readonly ContentOrigin[] = [
	"USER_CONTENT",
	"ASSISTANT_PUBLIC_TEXT",
	"TOOL_RESULT",
] as const;

/** Whether an origin may be forwarded to a checkpoint model. */
export function isForwardableOrigin(origin: ContentOrigin): boolean {
	return FORWARDABLE_ORIGINS.includes(origin);
}

/**
 * Classify ONE content block's origin.
 *
 * The classification is by DATA SHAPE and ROLE, never by a provider id and
 * never by a tool name.
 */
export function classifyBlockOrigin(
	message: Pick<MessageWithMetadata, "role">,
	block: { type?: string } & Record<string, unknown>,
): ContentOrigin {
	switch (block.type) {
		case "thinking":
		case "redacted_thinking":
			// Private reasoning. The distinction between `thinking` and
			// `redacted_thinking` is a DISPLAY concern, not an origin
			// concern: both are the model's private reasoning channel.
			return "ASSISTANT_THINKING";
		case "tool_use":
			return "TOOL_INPUT";
		case "tool_result":
			return "TOOL_RESULT";
		case "text":
			return message.role === "user" ? "USER_CONTENT" : "ASSISTANT_PUBLIC_TEXT";
		case "file":
		case "image":
		case "media":
			// A typed asset block. It is neither user prose, nor assistant
			// prose, nor a tool result; it is content whose origin the
			// checkpoint view does not need, so it fails closed.
			return "RUNTIME_METADATA";
		default:
			return "UNKNOWN_ORIGIN";
	}
}

/**
 * The origin of ONE message, taken from its FIRST recognized block.
 *
 * A message whose blocks are ALL unrecognized is `UNKNOWN_ORIGIN`.
 */
export function classifyMessageOrigin(
	message: MessageWithMetadata,
): ContentOrigin {
	if (!Array.isArray(message.content)) {
		// A string content body. A user string is user content; an assistant
		// string is the assistant's own published text.
		return message.role === "user" ? "USER_CONTENT" : "ASSISTANT_PUBLIC_TEXT";
	}
	let fallback: ContentOrigin = "UNKNOWN_ORIGIN";
	for (const block of message.content) {
		const origin = classifyBlockOrigin(message, block as never);
		if (origin !== "UNKNOWN_ORIGIN") {
			return origin;
		}
		fallback = origin;
	}
	return fallback;
}

/**
 * Every distinct origin present in a canonical history, with its count.
 *
 * The map is the RECEIPT the evidence package records: it names which
 * classes of content exist in the history, and how many blocks of each
 * class there are, WITHOUT carrying any content.
 */
export function countOriginsByClass(
	messages: readonly MessageWithMetadata[],
): Record<ContentOrigin, number> {
	const counts: Record<ContentOrigin, number> = {
		USER_CONTENT: 0,
		ASSISTANT_PUBLIC_TEXT: 0,
		ASSISTANT_THINKING: 0,
		TOOL_INPUT: 0,
		TOOL_RESULT: 0,
		RUNTIME_METADATA: 0,
		UNKNOWN_ORIGIN: 0,
	};
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			counts[classifyMessageOrigin(message)] += 1;
			continue;
		}
		for (const block of message.content) {
			counts[classifyBlockOrigin(message, block as never)] += 1;
		}
	}
	return counts;
}
