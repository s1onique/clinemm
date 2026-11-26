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
			/**
			 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01
			 * (AMENDMENT-01) — P1.
			 *
			 * The provider-visible position of the tool event's RESULT.
			 *
			 * It is SEPARATE from the invocation position because a
			 * completed tool event legitimately occupies BOTH: the
			 * `tool_use` block that declared it and the `tool_result` block
			 * that answered it. Collecting them together made a NORMAL
			 * completed event look like an AMBIGUITY, so the decisive
			 * engineering evidence could never be authorized.
			 *
			 * It is ABSENT when the RESULT is not visible. The invocation
			 * alone cannot authorize an observed OUTCOME.
			 */
			readonly providerResultMessageIndex: number | undefined;
			/** The provider-visible block index of the RESULT. */
			readonly providerResultBlockIndex: number | undefined;
			/**
			 * Whether the reference denotes a TOOL EVENT.
			 *
			 * It is the discriminator the source-completeness rule uses: a
			 * tool event is the DECISIVE engineering evidence.
			 */
			readonly toolEvent: boolean;
			/**
			 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
			 * — F1.
			 *
			 * Whether the reference holds RESULT AUTHORITY.
			 *
			 * ====================================================================
			 * INVOCATION AUTHORITY DOES NOT IMPLY RESULT AUTHORITY
			 * ====================================================================
			 *
			 * A visible `tool_use` block proves only that a call was REQUESTED. The
			 * OUTCOME lives in the `tool_result` block that answers it, and that
			 * block is a SEPARATE piece of provider-visible material with its own
			 * visibility, authorization and truncation state.
			 *
			 * Result authority therefore requires ALL of:
			 *
			 *   - the RESULT is provider-visible (a `tool_result` block for this
			 *     call id exists in the projection),
			 *   - the RESULT is AUTHORIZED (the canonical message carrying it is
			 *     inside the authorized source interval),
			 *   - the RESULT is NOT TRUNCATED (the projection did not elide the
			 *     material the outcome depends on), and
			 *   - the RESULT is NOT PRIVATE REASONING.
			 *
			 * When result authority is absent, the reference is STILL a citable
			 * INVOCATION — it just cannot establish an OBSERVED OUTCOME. The two
			 * authorities are deliberately separate fields, so a consumer can never
			 * read one as the other.
			 */
			readonly resultAuthority: boolean;
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
			providerResultMessageIndex: undefined,
			providerResultBlockIndex: undefined,
			toolEvent: false,
			// A MESSAGE reference never carries RESULT AUTHORITY: it denotes
			// the message, not the outcome of a tool call.
			resultAuthority: false,
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
		// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01
		// (AMENDMENT-01) — P1.
		//
		// The INVOCATION and the RESULT are counted SEPARATELY. A normal
		// completed tool event has one of each, and the pair is COMPLEMENTARY
		// evidence, not an ambiguity.
		//
		// A DUPLICATE identity — two invocations, or two results, for the
		// same call id — IS an ambiguity, because it cannot be attributed to
		// either.
		const invocations = providerPositions.filter(
			(position) => position.kind === "invocation",
		);
		const results = providerPositions.filter(
			(position) => position.kind === "result",
		);
		if (invocations.length > 1 || results.length > 1) {
			bindings.set(toolCallId, unresolved(toolCallId, "ambiguous"));
			continue;
		}
		if (invocations.length === 0) {
			bindings.set(toolCallId, unresolved(toolCallId, "absent"));
			continue;
		}
		// The invocation is visible. The RESULT may or may not be: an
		// invocation-only event is CITABLE, but it cannot authorize an
		// observed OUTCOME, because the outcome lives in the result.
		const invocation = invocations[0];
		const result = results.length === 1 ? results[0] : undefined;
		// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
		// — F1.
		//
		// The RESULT AUTHORITY is a SEPARATE determination from the
		// invocation's visibility. A visible `tool_use` block does NOT
		// make the answered `tool_result` an authorized observation.
		const resultAuthority =
			result !== undefined &&
			isResultAuthorized({
				canonicalMessages: canonical,
				toolCallId,
				authorizedMessageCount: input.authorizedMessageCount,
				providerMessages: input.providerMessages,
				providerResult: result,
			});
		bindings.set(toolCallId, {
			reference: toolCallId,
			status: "resolved",
			providerMessageIndex: invocation.messageIndex,
			providerBlockIndex: invocation.blockIndex,
			providerResultMessageIndex: result?.messageIndex,
			providerResultBlockIndex: result?.blockIndex,
			toolEvent: true,
			// The OUTCOME authority. It is TRUE only when the RESULT is
			// visible, authorized and non-truncated.
			resultAuthority,
		});
	}

	return bindings;
}

/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — F1.
 *
 * Whether the RESULT of a tool call holds RESULT AUTHORITY.
 *
 * ====================================================================
 * THE RESULT IS AUTHORIZED ONLY WHEN IT IS VISIBLE, AUTHORIZED AND
 * COMPLETE
 * ====================================================================
 *
 * The canonical history can hold a `tool_result` block for a call whose
 * RESULT the model never saw: the projection may drop it, merge it away
 * or truncate it. Retaining that canonical block would let the
 * interpreter establish an OUTCOME the model cannot see, which is the
 * exact failure this ACT closes.
 *
 * The determination therefore requires ALL of:
 *
 *   1. AUTHORIZATION — the canonical message carrying the RESULT is
 *      INSIDE the authorized source interval, and it is NOT a
 *      reasoning-only message.
 *   2. VISIBILITY — the provider projection really carries a
 *      `tool_result` block for this call id at the recorded position.
 *   3. COMPLETENESS — neither the canonical result nor the
 *      provider-visible result carries a truncation marker.
 *
 * Any failure is a FALSE, so the authority is absent. The helper never
 * repairs, reconstructs or substitutes material.
 */
function isResultAuthorized(input: {
	readonly canonicalMessages: readonly MessageWithMetadata[];
	readonly toolCallId: string;
	readonly authorizedMessageCount: number;
	readonly providerMessages: readonly ProviderVisibleMessage[];
	readonly providerResult: ProviderToolPosition;
}): boolean {
	// (1) AUTHORIZATION: the canonical message carrying the RESULT must be
	// inside the authorized source interval.
	const canonicalResultIndexes: number[] = [];
	for (const [canonicalIndex, message] of input.canonicalMessages.entries()) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (
				block.type === "tool_result" &&
				block.tool_use_id === input.toolCallId
			) {
				canonicalResultIndexes.push(canonicalIndex);
			}
		}
	}
	// NO canonical result, or MORE THAN ONE: the outcome cannot be
	// attributed to this call, so it authorizes nothing.
	if (canonicalResultIndexes.length !== 1) {
		return false;
	}
	const canonicalResultIndex = canonicalResultIndexes[0];
	if (canonicalResultIndex >= input.authorizedMessageCount) {
		// The RESULT is OUTSIDE the authorized source interval, so it
		// is not an authorized extraction source even though the
		// INVOCATION is inside it.
		return false;
	}
	const canonicalResultMessage = input.canonicalMessages[canonicalResultIndex];
	if (isReasoningOnlyMessage(canonicalResultMessage)) {
		// A reasoning-only message is not an authorized extraction
		// source.
		return false;
	}
	// (2) VISIBILITY: the provider projection really carries the RESULT.
	const providerResultMessage =
		input.providerMessages[input.providerResult.messageIndex];
	if (!providerResultMessage || !Array.isArray(providerResultMessage.content)) {
		return false;
	}
	const providerResultBlock =
		providerResultMessage.content[input.providerResult.blockIndex];
	if (!providerResultBlock || typeof providerResultBlock !== "object") {
		return false;
	}
	const providerResultRecord = providerResultBlock as {
		type?: unknown;
		tool_use_id?: unknown;
	};
	if (
		providerResultRecord.type !== "tool_result" ||
		providerResultRecord.tool_use_id !== input.toolCallId
	) {
		// The recorded position does not hold THIS call's result.
		return false;
	}
	// (3) COMPLETENESS: the material the outcome depends on must be
	// COMPLETE on both sides. A truncated result cannot establish an
	// outcome, because the elided material may be the outcome.
	if (containsTruncationMarker(canonicalResultMessage.content)) {
		return false;
	}
	if (containsTruncationMarker(providerResultBlock)) {
		return false;
	}
	return true;
}

/**
 * The provider-visible position of ONE side of a tool event.
 */
interface ProviderToolPosition {
	readonly messageIndex: number;
	readonly blockIndex: number;
	/**
	 * Whether the position is the INVOCATION (`tool_use`) or the RESULT
	 * (`tool_result`).
	 */
	readonly kind: "invocation" | "result";
}

/**
 * The provider-visible positions of the tool call and its result.
 *
 * The two sides are returned SEPARATELY, because a completed tool event
 * legitimately occupies BOTH: the `tool_use` block that DECLARED it and the
 * `tool_result` block that ANSWERED it. Collecting them into one list
 * made a normal completed event indistinguishable from a duplicate
 * identity.
 */
function findProviderToolPositions(
	providerMessages: readonly ProviderVisibleMessage[],
	toolCallId: string,
): readonly ProviderToolPosition[] {
	const positions: ProviderToolPosition[] = [];
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
			if (record.type === "tool_use" && record.id === toolCallId) {
				positions.push({ messageIndex, blockIndex, kind: "invocation" });
				continue;
			}
			if (record.type === "tool_result" && record.tool_use_id === toolCallId) {
				positions.push({ messageIndex, blockIndex, kind: "result" });
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

/**
 * The AUTHORIZED TOOL-EVENT references: the decisive engineering evidence.
 *
 * A tool event is decisive only when BOTH its invocation AND its result are
 * provider-visible, because the OUTCOME lives in the result. An
 * invocation-only event is citable but cannot establish an observed
 * outcome.
 */
export function collectAuthorizedToolEventReferences(
	bindings: ReadonlyMap<string, ProviderVisibleBinding>,
): readonly string[] {
	const events: string[] = [];
	for (const binding of bindings.values()) {
		if (
			binding.status === "resolved" &&
			binding.toolEvent &&
			// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
			// — F1: the decisive predicate is the RESULT AUTHORITY, not the
			// mere PRESENCE of a provider-visible result position. A result
			// position exists for a result that was truncated or whose
			// canonical carrier was outside the authorized interval; neither
			// establishes an observed outcome.
			binding.resultAuthority
		) {
			events.push(binding.reference);
		}
	}
	return events;
}

/**
 * Narrow the CANONICAL history to the AUTHORIZED, VISIBLE sources.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 *
 * The publication gate's authority is the set of references it may cite.
 * The EXISTING canonical interpreter then interprets THOSE references. It
 * reads the canonical history, so it can establish an event whose RESULT the
 * model cannot see.
 *
 * The narrowed view closes that: it contains ONLY the canonical material
 * that the B' source authority covers. An event whose result was truncated,
 * filtered, merged away or out of the authorized interval is ABSENT from it,
 * so the existing interpreter — which is NOT weakened — cannot establish it.
 *
 * The narrowing is applied to the INTERPRETER'S INPUT, never to the
 * interpreter itself.
 *
 * ============================================================================
 * THE RULES
 * ============================================================================
 *
 *   - A canonical message is KEPT only when its own reference is
 *     AUTHORIZED. A message the projection merged away, truncated, or placed
 *     outside the authorized interval is DROPPED, so its content cannot
 *     re-enter the evidence through another message's identity.
 *   - A canonical message with NO id is DROPPED: it has no citable
 *     reference, so it can never be authorized.
 *   - Within a KEPT message, a `tool_use` or `tool_result` block whose tool
 *     reference is NOT authorized is DROPPED, so an excluded observation
 *     cannot silently reintroduce unauthorized evidence.
 */
export function narrowCanonicalMessagesToAuthority(
	canonicalMessages: readonly MessageWithMetadata[],
	bindings: ReadonlyMap<string, ProviderVisibleBinding>,
): readonly MessageWithMetadata[] {
	const authorized = new Set(collectAuthorizedReferences(bindings));
	// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
	// — F1.
	//
	// The RESULT-AUTHORIZED references. A `tool_result` block is
	// retained ONLY when the reference it answers holds RESULT
	// AUTHORITY: the result is visible, authorized and non-truncated.
	//
	// The INVOCATION authority and the RESULT authority are DIFFERENT
	// things. A visible `tool_use` block proves a call was requested;
	// it does NOT prove the call's outcome. Retaining a canonical
	// `tool_result` on invocation authority alone let the interpreter
	// join the call to its result and establish an OUTCOME the model
	// cannot see — an observation the model was never given.
	const resultAuthorized = new Set<string>();
	for (const binding of bindings.values()) {
		if (binding.status === "resolved" && binding.resultAuthority) {
			resultAuthorized.add(binding.reference);
		}
	}
	const narrowed: MessageWithMetadata[] = [];
	for (const message of canonicalMessages) {
		const id = message.id;
		if (typeof id !== "string" || id.length === 0) {
			continue;
		}
		if (!authorized.has(`id:${id}`)) {
			continue;
		}
		if (!Array.isArray(message.content)) {
			narrowed.push(message);
			continue;
		}
		const blocks = message.content.filter((block) => {
			if (block.type === "tool_use") {
				return authorized.has(block.id);
			}
			if (block.type === "tool_result") {
				// The RESULT is retained only under RESULT authority.
				return resultAuthorized.has(block.tool_use_id);
			}
			// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01
			// (AMENDMENT-01) — F1.
			//
			// PRIVATE REASONING is excluded from the interpreter's
			// evidence input, INCLUDING in a mixed-content message. A
			// reasoning block is wire-visible but it is not an
			// authorized extraction source, and a private deliberation
			// must never become evidence for a published observation.
			if (block.type === "thinking" || block.type === "redacted_thinking") {
				return false;
			}
			return true;
		});
		narrowed.push({ ...message, content: blocks } as MessageWithMetadata);
	}
	return narrowed;
}
