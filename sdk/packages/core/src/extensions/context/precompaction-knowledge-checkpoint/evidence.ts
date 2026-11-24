/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01
 *
 * PRODUCTION canonical-evidence collection and ATOM-SCOPED SEMANTIC SUPPORT
 * for the Pre-Compaction Knowledge Checkpoint (PCK).
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
 * ============================================================================
 * CORRECTION01 — ATOM-SCOPED SUPPORT, NOT REFERENCE MEMBERSHIP
 * ============================================================================
 *
 * The predecessor implementation inferred `tool_observed` from REFERENCE
 * MEMBERSHIP alone: "the cited set contains a canonical tool-call id".
 * That established only that a CALL EXISTED. It did NOT establish that the
 * call's RESULT SUPPORTS the selected observation atom.
 *
 * The concrete counterexample the correction closes:
 *
 *   the canonical history contains  `run_commands` -> `echo hello`
 *   the model selects              SEARCH_RETURNED_NO_MATCH
 *   the predecessor published      assurance=tool_observed
 *                                   statement="bounded search returned no match"
 *
 * "bounded search returned no match" is not entailed by "echo hello", and a
 * reader of the published checkpoint would reasonably believe the runtime
 * observed a search. That is a FALSE OBSERVATION.
 *
 * THE BOUNDED CORRECTION
 * ----------------------
 *
 * The runtime now establishes support ATOM BY ATOM, against a CLOSED,
 * RUNTIME-OWNED table:
 *
 *   - an OBSERVATION ATOM names the TOOL CLASS that can support it,
 *   - a canonical tool event is only counted when it is
 *       (a) unambiguously joined to its call,
 *       (b) affirmatively SUCCESSFUL, and
 *       (c) of the class the atom requires,
 *   - a reference that resolves but does not SUPPORT the atom leaves the
 *     claim at `model_reported`.
 *
 * This is NOT a general-purpose semantic verification engine. It is a
 * CLOSED, TOTAL, RUNTIME-OWNED table of six atoms against three tool
 * classes. An atom with no supportable class can never reach
 * `tool_observed`, and an unknown atom is rejected by the publication gate
 * before it ever reaches this module.
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
import type { BoundedAssurance, ObservationAtom } from "./closed-vocabulary";

/**
 * A RUNTIME-OWNED class of tool.
 *
 * The class is what makes an observation atom SUPPORTABLE. It is a closed,
 * bounded vocabulary: a tool whose name is not a member of any class
 * supports NOTHING, so a record that cites it can never reach
 * `tool_observed`.
 */
export type ToolEvidenceClass =
	/** A tool that EXECUTED something: a command, a script, a process. */
	| "command_execution"
	/** A tool that READ something: a file, a source file, a listing. */
	| "source_read"
	/** A tool that SEARCHED something: a bounded content or name search. */
	| "search";

/**
 * The runtime-owned tool NAMES that belong to each evidence class.
 *
 * The table is CLOSED and RUNTIME-OWNED. It is a CLASSIFICATION of tool
 * names, not a content rule: it says what KIND of operation a tool
 * performs, so the runtime can decide whether that operation can support
 * the selected atom.
 *
 * A name that is not a member of any class is UNCLASSIFIED, and an
 * unclassified tool supports NOTHING.
 */
export const TOOL_EVIDENCE_CLASS_MEMBERS: Readonly<
	Record<ToolEvidenceClass, readonly string[]>
> = Object.freeze({
	command_execution: Object.freeze(["run_commands"]),
	source_read: Object.freeze(["read_files", "read_file", "list_files"]),
	search: Object.freeze(["search_files", "grep_search", "codebase_search"]),
});

/**
 * The tool class each OBSERVATION ATOM requires for `tool_observed`.
 *
 * THE TABLE IS THE WHOLE SEMANTIC CONTRACT
 * ----------------------------------------
 *
 * It is CLOSED and TOTAL over the six runtime-owned atoms:
 *
 *   OPERATION_INVOKED / OPERATION_ARGUMENT_SET
 *       an operation was invoked. Only a COMMAND EXECUTION can establish
 *       that.
 *
 *   CONFIGURATION_VALUE_SET / IMPLEMENTATION_INSPECTED
 *       something was read and its content was inspected. Only a SOURCE
 *       READ can establish that.
 *
 *   SEARCH_RETURNED_NO_MATCH
 *       a BOUNDED SEARCH found nothing. Only a SEARCH can establish that.
 *       A command execution CANNOT: `echo hello` is not a search, and a
 *       failed grep is not a bounded search with a recorded scope.
 *
 *   QUESTION_REMAINS_OPEN
 *       an absence of support. NO tool class can establish it, so it is
 *       permanently bounded at `model_reported`.
 */
export const OBSERVATION_ATOM_REQUIRED_CLASS: Readonly<
	Record<ObservationAtom, ToolEvidenceClass | undefined>
> = Object.freeze({
	OPERATION_INVOKED: "command_execution",
	OPERATION_ARGUMENT_SET: "command_execution",
	CONFIGURATION_VALUE_SET: "source_read",
	IMPLEMENTATION_INSPECTED: "source_read",
	SEARCH_RETURNED_NO_MATCH: "search",
	QUESTION_REMAINS_OPEN: undefined,
});

/**
 * Classify a tool NAME into its runtime-owned evidence class.
 */
export function classifyToolEvidenceClass(
	toolName: string | undefined,
): ToolEvidenceClass | undefined {
	if (typeof toolName !== "string") {
		return undefined;
	}
	for (const [evidenceClass, members] of Object.entries(
		TOOL_EVIDENCE_CLASS_MEMBERS,
	)) {
		if ((members as readonly string[]).includes(toolName)) {
			return evidenceClass as ToolEvidenceClass;
		}
	}
	return undefined;
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
 * ONE canonical tool event: a call joined to its result.
 *
 * The event is only admitted when the join is UNAMBIGUOUS. The same
 * fail-closed discipline the production evidence-continuity module applies
 * is applied here: a call id claimed by more than one call, or answered by
 * more than one result, cannot be attributed to either, so it supports
 * NOTHING.
 */
export interface CanonicalToolEvent {
	/** The canonical tool-call id. */
	readonly toolCallId: string;
	/** The tool's runtime-owned name. */
	readonly toolName: string;
	/** The runtime-owned evidence class of the tool, when it has one. */
	readonly evidenceClass: ToolEvidenceClass | undefined;
	/** Whether the result AFFIRMATIVELY succeeded. */
	readonly succeeded: boolean;
}

/**
 * Build the canonical tool-event ledger for ONE session.
 *
 * The ledger pairs every canonical `tool_use` with the canonical
 * `tool_result` that answers it, and records the tool's class and the
 * result's OWN success signal.
 *
 * THE SUCCESS SIGNAL IS AFFIRMATIVE
 * ---------------------------------
 *
 * A result counts as successful ONLY when its own payload carries an
 * explicit `success: true`. `isError: false` is NOT a success signal: it
 * says only that no error was reported. This mirrors the rule the
 * production evidence-continuity module already applies, so the checkpoint
 * cannot claim a stronger execution status than the rest of the system
 * does.
 */
export function collectCanonicalToolEvents(
	messages: readonly MessageWithMetadata[],
): readonly CanonicalToolEvent[] {
	const callCounts = new Map<string, number>();
	const callsById = new Map<string, string>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				callCounts.set(block.id, (callCounts.get(block.id) ?? 0) + 1);
				if (!callsById.has(block.id)) {
					callsById.set(block.id, block.name);
				}
			}
		}
	}
	const resultCounts = new Map<string, number>();
	/** The tool results, keyed by the tool-call id they answer. */
	const resultsById = new Map<
		string,
		{ readonly toolName?: string; readonly succeeded: boolean }
	>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_result") {
				continue;
			}
			resultCounts.set(
				block.tool_use_id,
				(resultCounts.get(block.tool_use_id) ?? 0) + 1,
			);
			if (resultsById.has(block.tool_use_id)) {
				continue;
			}
			resultsById.set(block.tool_use_id, {
				toolName:
					typeof (block as { name?: unknown }).name === "string"
						? ((block as { name?: string }).name as string)
						: undefined,
				succeeded: classifyToolResultSuccess(block),
			});
		}
	}
	const events: CanonicalToolEvent[] = [];
	for (const [toolCallId, toolName] of callsById) {
		// AMBIGUOUS CALL: the id was claimed by more than one call, so
		// neither claim can be trusted.
		if ((callCounts.get(toolCallId) ?? 0) !== 1) {
			continue;
		}
		// AMBIGUOUS RESULT: the call was answered by more than one result.
		if ((resultCounts.get(toolCallId) ?? 0) !== 1) {
			continue;
		}
		const result = resultsById.get(toolCallId);
		if (!result) {
			// NO RESULT: the call was never answered, so nothing about its
			// outcome can be established.
			continue;
		}
		// A result that DECLARES a different tool name than the call is
		// not joined to that call.
		if (result.toolName !== undefined && result.toolName !== toolName) {
			continue;
		}
		events.push({
			toolCallId,
			toolName,
			evidenceClass: classifyToolEvidenceClass(toolName),
			succeeded: result.succeeded,
		});
	}
	return events;
}
/**
 * Whether a canonical tool result AFFIRMATIVELY succeeded.
 *
 * The rule is deliberately strict, and it mirrors the production
 * evidence-continuity module:
 *
 *   - any payload with `success: false` or `isError: true` FAILS the whole
 *     result,
 *   - a payload with `success: true` contributes a success,
 *   - a payload with NEITHER leaves the result UNVERIFIED, because "no
 *     evidence of failure" is not "evidence of success".
 */
function classifyToolResultSuccess(resultBlock: {
	is_error?: boolean;
	content: unknown;
}): boolean {
	if (resultBlock.is_error === true) {
		return false;
	}
	const payloads =
		Array.isArray(resultBlock.content) &&
		resultBlock.content.every((item) => item && typeof item === "object")
			? (resultBlock.content as Record<string, unknown>[])
			: [];
	let sawSuccess = false;
	for (const payload of payloads) {
		if (payload.success === false || payload.isError === true) {
			return false;
		}
		if (payload.success === true) {
			sawSuccess = true;
			continue;
		}
		// A payload with no affirmative success signal leaves the result
		// UNVERIFIED rather than successful.
		return false;
	}
	return sawSuccess;
}

/**
 * The runtime's own evidence interpreter.
 *
 * It answers ONE question: what is the MAXIMUM assurance the RUNTIME can
 * support for a set of canonical references, GIVEN the observation atom the
 * model selected?
 *
 * It NEVER inspects a model-authored statement, and it NEVER returns
 * `runtime_verified`.
 *
 * ============================================================================
 * CORRECTION01 — THE ATOM DECIDES WHAT CAN SUPPORT THE CLAIM
 * ============================================================================
 *
 * The predecessor derived `tool_observed` from reference MEMBERSHIP: "the
 * cited set contains a canonical tool-call id". That established only that
 * a CALL EXISTED. It did NOT establish that the call's RESULT SUPPORTS
 * the selected observation atom, so a `run_commands`/`echo hello` event
 * could be published as "bounded search returned no match".
 *
 * The interpreter now requires BOTH:
 *
 *   1. the cited set contains a canonical tool event that is unambiguously
 *      joined, AFFIRMATIVELY SUCCESSFUL, and
 *   2. that event's evidence CLASS is the class the selected atom
 *      REQUIRES (see `OBSERVATION_ATOM_REQUIRED_CLASS`).
 *
 * A reference that resolves but does not SUPPORT the atom leaves the
 * ceiling at `model_reported`, so the claim is DOWNGRADED rather than
 * published as a false observation.
 */
export function interpretCanonicalEvidence(input: {
	readonly canonicalMessages: readonly MessageWithMetadata[];
	readonly references: readonly string[];
	/**
	 * The observation atom the model selected.
	 *
	 * It is REQUIRED, because the atom is what decides which kind of
	 * evidence can support the claim. An atom with no supportable class
	 * (`QUESTION_REMAINS_OPEN`) is permanently bounded at `model_reported`.
	 */
	readonly atom: ObservationAtom;
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
	const requiredClass = OBSERVATION_ATOM_REQUIRED_CLASS[input.atom];
	if (requiredClass === undefined) {
		// The atom names no supportable evidence class, so NO tool
		// observation can establish it.
		return "model_reported";
	}
	const events = collectCanonicalToolEvents(input.canonicalMessages);
	const supporting = events.some(
		(event) =>
			observed.includes(event.toolCallId) &&
			event.succeeded &&
			event.evidenceClass === requiredClass,
	);
	if (supporting) {
		return "tool_observed";
	}
	// The references RESOLVE, but no cited event SUPPORTS this atom. The
	// claim survives at the truthful ceiling.
	return "model_reported";
}
