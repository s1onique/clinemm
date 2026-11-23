/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01 —
 * CORRECTION of the G6 live-probe CORRELATION logic.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 *
 * The original live probe (`adjudication-output-contract.live-probe.ts`)
 * recorded TWO parallel arrays:
 *
 *   turnToolCallCounts: number[]  -- ONE ENTRY PER TURN (every turn)
 *   turnCarriers:       string[]  -- ONE ENTRY PER TURN THAT HAD TEXT
 *
 * and then derived "did the PUBLISHING turn also carry a tool call?" by
 * indexing `turnToolCallCounts` with the PUBLISHING CARRIER's index:
 *
 *   observation.publishedTurnAlsoCarriedToolUse =
 *       (turnToolCallCounts[index] ?? 0) > 0;
 *
 * That is a POSITIONAL BUG. The carrier index and the turn index are only
 * equal while EVERY preceding turn carried text. The moment a turn carries
 * tool use but NO text (a perfectly ordinary tool-only turn), the carrier
 * index and the turn index DIVERGE, and the metric silently reports the
 * tool-call count of a DIFFERENT turn.
 *
 * The second defect was the `publishedAfterToolResult` metric: it was set
 * from `turnText` of a tool-calling turn — text that was emitted BEFORE the
 * tool result was appended to the conversation — and was therefore not
 * tied to the actual adjudication carrier at all.
 *
 * THIS MODULE is the CORRECTED, TURN-ANCHORED correlation. Every carrier
 * keeps the CANONICAL TURN INDEX it came from, and every derived metric is
 * computed from that exact turn.
 *
 * PRODUCTION DELTA: ZERO. This module is a TEST/SCRIPT-LOCAL diagnostic
 * helper. It is not imported by any production module and it is not part of
 * any public API surface.
 */

/**
 * One assistant turn as observed on the provider stream.
 *
 * `text` is the assistant `text` carrier emitted in that turn ("" when the
 * turn carried no text at all). `toolCallIds` are the canonical tool-call
 * ids emitted in that SAME turn.
 */
export interface TurnObservation {
	/** The assistant text emitted in this turn, or "" when there was none. */
	text: string;
	/** The canonical tool-call ids emitted in this turn. */
	toolCallIds: string[];
	/**
	 * How many tool RESULTS had already been appended to the conversation
	 * BEFORE this turn began.
	 *
	 * This is the CHRONOLOGY anchor: a turn with `toolResultsBefore === 0`
	 * is a turn that precedes every tool result; a turn with
	 * `toolResultsBefore >= 1` began after at least one tool result had been
	 * appended.
	 */
	toolResultsBefore: number;
}

/**
 * An assistant-text carrier, anchored to the canonical turn it came from.
 *
 * The turn index is carried EXPLICITLY rather than inferred from a
 * positional index into a parallel array. This is the whole point of the
 * correction.
 */
export interface AnchoredCarrier {
	/** The carrier text. */
	text: string;
	/** The CANONICAL turn index this carrier was emitted in. */
	turnIndex: number;
	/** The tool-call ids emitted in that SAME turn. */
	turnToolCallIds: string[];
	/** How many tool results had been appended before that turn began. */
	toolResultsBefore: number;
}

/**
 * Anchor every assistant-text carrier to its canonical turn index.
 *
 * Turns that carry NO text produce NO carrier, so the carrier array is
 * necessarily SPARSER than the turn array. The turn index travels with
 * the carrier so that no downstream metric can confuse the two.
 */
export function anchorCarriers(
	turns: readonly TurnObservation[],
): AnchoredCarrier[] {
	const anchored: AnchoredCarrier[] = [];
	for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
		const turn = turns[turnIndex];
		if (!turn.text) {
			// A tool-only turn carries NO assistant text and therefore NO
			// carrier. It still ADVANCES the canonical turn index.
			continue;
		}
		anchored.push({
			text: turn.text,
			turnIndex,
			turnToolCallIds: [...turn.toolCallIds],
			toolResultsBefore: turn.toolResultsBefore,
		});
	}
	return anchored;
}

/**
 * The correlation facts derived from an anchored carrier.
 */
export interface CarrierCorrelation {
	/** The canonical turn index the publishing carrier came from. */
	publishedTurnIndex: number;
	/** Whether THAT EXACT turn also carried at least one tool call. */
	publishedTurnAlsoCarriedToolUse: boolean;
	/**
	 * Whether the publishing carrier was emitted in a turn that began
	 * AFTER at least one tool result had been appended to the
	 * conversation.
	 *
	 * This is derived from the CHRONOLOGY (`toolResultsBefore`), not from
	 * the mere presence of text in a tool-calling turn.
	 */
	publishedAfterToolResult: boolean;
	/** The tool-call ids emitted in the publishing turn itself. */
	publishedTurnToolCallIds: string[];
}

/**
 * Derive the correlation facts for ONE publishing carrier.
 *
 * Every field is derived from the carrier's OWN canonical turn. Nothing
 * here is positional, so a preceding tool-only turn can no longer shift
 * the measurement onto the wrong turn.
 */
export function correlateCarrier(carrier: AnchoredCarrier): CarrierCorrelation {
	return {
		publishedTurnIndex: carrier.turnIndex,
		publishedTurnAlsoCarriedToolUse: carrier.turnToolCallIds.length > 0,
		publishedAfterToolResult: carrier.toolResultsBefore > 0,
		publishedTurnToolCallIds: [...carrier.turnToolCallIds],
	};
}

/**
 * Resolve whether a set of evidence references binds to CANONICAL tool
 * calls in the observed conversation.
 *
 * The contract distinguishes SCHEMA VALIDITY from CONTRACT ACCEPTANCE. A
 * candidate can parse perfectly and still be REJECTED because its evidence
 * references do not resolve to a canonical tool call.
 *
 * This function implements the SECOND gate only: canonical reference
 * resolution. It is deliberately INDEPENDENT of schema validity.
 */
export function resolveCanonicalReferences(
	candidate: { evidence_tool_use_ids?: string[] },
	canonicalToolCallIds: readonly string[],
): {
	canonical_refs_resolved: boolean;
	unresolvedIds: string[];
} {
	const canonical = new Set(canonicalToolCallIds);
	const unresolved: string[] = [];
	for (const id of candidate.evidence_tool_use_ids ?? []) {
		if (!canonical.has(id)) {
			unresolved.push(id);
		}
	}
	return {
		canonical_refs_resolved: unresolved.length === 0,
		unresolvedIds: unresolved,
	};
}
