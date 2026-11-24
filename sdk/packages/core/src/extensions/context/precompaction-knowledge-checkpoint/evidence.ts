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
 * ============================================================================
 * CORRECTION02 — THE COMPLETE RENDERED PROPOSITION MUST BE ESTABLISHED
 * ============================================================================
 *
 * CORRECTION01 replaced MEMBERSHIP with ATOM-SCOPED SUPPORT: a cited event
 * had to be unambiguously joined, AFFIRMATIVELY SUCCESSFUL and of the TOOL
 * CLASS the atom requires. That closed the CROSS-CLASS false attribution,
 * but it left the SAME-CLASS false attribution open.
 *
 * The remaining counterexamples are all SAME-CLASS:
 *
 *   successful search returning 42 matches   -> SEARCH_RETURNED_NO_MATCH
 *   successful `echo hello`                   -> OPERATION_INVOKED: build
 *   successful `echo hello`                   -> OPERATION_ARGUMENT_SET:
 *                                                start --optimized
 *   read configuration holding a 30s timeout -> CONFIGURATION_VALUE_SET:
 *                                                connect timeout 3 seconds
 *   successful directory listing             -> IMPLEMENTATION_INSPECTED
 *
 * In every one of those cases the runtime established three facts — the
 * reference RESOLVED, the execution SUCCEEDED, and the tool was of the RIGHT
 * CLASS — and NONE of them says anything about whether the observed result
 * SUPPORTS the rendered claim. The interpreter never even received the
 * selected `argument`, so it could not have compared the rendered argument
 * with the observed operation even in principle.
 *
 * THE REQUIRED INVARIANT
 * ----------------------
 *
 *   Evidence actually supports the COMPLETE RENDERED CLAIM
 *     -> `tool_observed`
 *   otherwise
 *     -> `model_reported`
 *
 * THE BOUNDED REPAIR — SIMPLIFICATION, NOT A NEW ENGINE
 * -------------------------------------------------------
 *
 * This correction REMOVES the atom/class table rather than extending it. The
 * runtime now establishes a claim only through evidence it ALREADY owns and
 * ALREADY computes deterministically:
 *
 *   - The PRODUCTION command classifier (`classifyCommand()`, owned by
 *     `evidence-continuity.ts`) turns a tool call's own declared input into
 *     a FINITE, ALLOWLISTED classification (`helm template`, `make build`,
 *     `git status`, ...). It is already fail-closed, already free of
 *     user-controlled text, and already regression-tested.
 *
 *   - A CLOSED, RUNTIME-OWNED table says which classifications establish
 *     which RUNTIME ARGUMENT.
 *
 * So the interpreter verifies the COMPLETE RENDERED PROPOSITION for the
 * operation atoms: the cited event must be a command execution whose own
 * runtime-owned classification is one the selected argument requires. A
 * successful `echo hello` cannot establish `build`; a successful
 * `make build` cannot establish `start --optimized`.
 *
 * For every OTHER atom there is NO deterministic runtime-owned rule that
 * establishes the complete rendered proposition:
 *
 *   - a bounded search that returned 42 matches does not establish "no
 *     match", and deciding otherwise needs a semantic interpreter;
 *   - a directory listing does not establish "the implementation was
 *     inspected";
 *   - a configuration that holds a 30-second timeout does not establish
 *     "connect timeout 3 seconds";
 *   - an absence of support is never established by a tool.
 *
 * Those atoms are therefore bounded at `model_reported`. The working
 * knowledge is PRESERVED — the record is still published, still carries the
 * runtime-owned statement and qualifications — but it no longer MISREPRESENTS
 * ITS AUTHORITY. That is the whole point of the checkpoint: preserve useful
 * working knowledge across compaction WITHOUT misrepresenting its authority.
 *
 * This is NOT a general-purpose semantic verification engine. It is a
 * CLOSED, TOTAL table of runtime arguments against classifications the
 * production system already computes.
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
import { classifyCommand } from "../evidence-continuity";
import type {
	BoundedAssurance,
	ObservationAtom,
	RuntimeArgument,
} from "./closed-vocabulary";

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
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02: this table
 * is GONE, and that is the point of the correction.
 *
 * A tool CLASS says what KIND of operation ran. It says nothing about
 * whether the operation's RESULT supports the rendered claim, so it can
 * never by itself establish a proposition. The predecessor's atom/class
 * table therefore still allowed a successful search returning 42 matches to
 * be published as "bounded search returned no match".
 *
 * It is RETAINED here only as a DECLARED, CLOSED vocabulary of the tool
 * classes the runtime recognises, so the classification of an event stays
 * inspectable and total. Support is decided by
 * `RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS` and by the interpreter.
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
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02
 *
 * The PRODUCTION command classifications that deterministically establish
 * each RUNTIME ARGUMENT.
 *
 * ============================================================================
 * WHY THIS TABLE IS THE WHOLE CONTRACT
 * ============================================================================
 *
 * The checkpoint's `RuntimeArgument` vocabulary renders a claim like
 * "operation invoked: build". For the runtime to publish that with
 * `tool_observed`, it must DETERMINISTICALLY establish that the cited
 * evidence really performed a `build`.
 *
 * The production system ALREADY computes exactly that: `classifyCommand()`
 * (owned by `evidence-continuity.ts`) reduces a tool call's own declared
 * input to a FINITE, ALLOWLISTED classification such as `make build`,
 * `helm template` or `git status`. It is already:
 *
 *   - fail-closed (an ambiguous shell chain yields NO classification),
 *   - free of user-controlled text (only an allowlist entry is ever
 *     returned),
 *   - regression-tested in production, and
 *   - already the mechanism the rest of the system uses to decide that an
 *     operation was verified.
 *
 * So the checkpoint does NOT need a semantic interpreter. It needs one
 * CLOSED table that says which of those existing classifications establish
 * which argument.
 *
 * THE EMPTY SET IS THE NORM
 * -------------------------
 *
 * An argument with an EMPTY set has NO deterministic runtime-owned evidence
 * that establishes it, so a claim rendering that argument is bounded at
 * `model_reported`. That is the correct, conservative outcome — the
 * working knowledge survives, and its authority is not overstated.
 *
 * The `start` / `start_optimized` arguments are empty on purpose: the
 * production allowlist carries no `start` classification, because a bare
 * `start` word is not decidable from a command line. The timeout arguments
 * are empty because they are CONFIGURATION VALUES, not commands: no
 * deterministic runtime-owned rule reads a configuration file's timeout and
 * compares it with "connect timeout 3 seconds".
 */
export const RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS: Readonly<
	Record<RuntimeArgument, readonly string[]>
> = Object.freeze({
	// `make build` is the only allowlisted classification that establishes a
	// BUILD.
	build: Object.freeze(["make build"]),
	// No allowlisted classification establishes a bare `start`.
	start: Object.freeze([]),
	// No allowlisted classification establishes `start --optimized`.
	start_optimized: Object.freeze([]),
	// A configuration value is not a command; nothing classifies it.
	connect_timeout_3s: Object.freeze([]),
	// A configuration value is not a command; nothing classifies it.
	socket_timeout_10s: Object.freeze([]),
	// The explicit absence of an argument establishes nothing.
	none: Object.freeze([]),
});

/**
 * The OBSERVATION ATOMs the runtime can establish at `tool_observed`.
 *
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02: the
 * operation atoms are the only ones the runtime can establish, because the
 * operation's OWN command classification is deterministic runtime-owned
 * evidence for the rendered argument.
 *
 * Every other atom is bounded at `model_reported`. That is not a defect: it
 * is the truthful ceiling. A bounded search that returned 42 matches does
 * not establish "no match"; a directory listing does not establish "the
 * implementation was inspected"; a configuration holding a 30-second
 * timeout does not establish "connect timeout 3 seconds"; and an absence of
 * support is never established by a tool.
 */
export const DETERMINISTICALLY_ESTABLISHABLE_ATOMS: readonly ObservationAtom[] =
	Object.freeze(["OPERATION_INVOKED", "OPERATION_ARGUMENT_SET"] as const);

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
	/**
	 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02
	 *
	 * The PRODUCTION command CLASSIFICATION of the call's own declared input.
	 *
	 * It is computed by the production `classifyCommand()`, so it is:
	 *
	 *   - deterministic,
	 *   - fail-closed (an ambiguous shell chain yields NO classification),
	 *   - drawn from a finite allowlist, and
	 *   - free of any user-controlled text.
	 *
	 * This is the runtime-owned evidence the operation atoms are verified
	 * against. It is EMPTY for a call the classifier does not recognise,
	 * which is the common case and is NOT a defect.
	 */
	readonly commandClassifications: readonly string[];
}

/**
 * ACT-CLINEMM-PCK-EXACT-HEAD-PACKAGING-01 — C1 EXECUTION-AUTHORITY PREFLIGHT
 *
 * The AUTHORITATIVE executable-command fields of a tool call, per TOOL.
 *
 * ============================================================================
 * WHY THE BOUNDARY IS PER TOOL AND NOT A GLOBAL KEY LIST
 * ============================================================================
 *
 * The CORRECTION02 implementation walked a GLOBAL key list:
 *
 *   command, commands, query, script, path, file_path, filePath
 *
 * That is broader than an executable-command boundary. `path`,
 * `file_path` and `filePath` are the READ-REQUEST fields of the
 * production `read_files` schema, and `query` / `script` are not
 * authoritative executable-command fields of the production
 * `run_commands` schema either.
 *
 * The consequence was a FALSE ASSURANCE: a `read_files` call whose FILE
 * PATH was the string "make build" was classified as a BUILD INVOCATION,
 * and reached `tool_observed`. A file named "make build" is not a
 * command, and a command is never inferred from a path.
 *
 * The production schemas (INSPECTED, not assumed):
 *
 *   sdk/packages/core/src/extensions/tools/schemas.ts
 *
 *     RunCommandsInputSchema (the CANONICAL, strict run_commands shape)
 *         { commands: string[], notifyOnCompletion?: boolean }
 *       The executable-bearing field is `commands`, an ARRAY of complete
 *       shell command strings.
 *
 *       The lenient union additionally accepts `{command}`, `{cmd}`, a
 *       bare array and a bare string, and
 *       `normalizeRunCommandsToolInput()` canonicalises the confirmed
 *       Flint shape `{command: "<JSON array>"}` into `{commands: [...]}`
 *       BEFORE schema validation. So `commands` is the field the runtime
 *       actually executes, and `command` / `cmd` are the accepted
 *       compatibility spellings of the SAME field.
 *
 *     ReadFilesInputSchema
 *         { files: ReadFileRequest[] }
 *       A request carries `path` (and the tolerant aliases `file_path` /
 *       `filePath`). THERE IS NO EXECUTABLE COMMAND IN A READ REQUEST.
 *
 * So the boundary is: for a COMMAND EXECUTION tool, read the
 * executable-command fields; for every other tool, read NOTHING.
 *
 * ============================================================================
 * THE BOUNDARY IS THE PRODUCTION SCHEMA'S, NOT A NEW ONE
 * ============================================================================
 *
 * This is NOT another classifier. `classifyCommand()` still does the
 * classification; this table only decides WHICH VALUES are eligible to
 * be classified. A tool that is not listed here contributes NO
 * classification at all, so it can never establish an operation.
 */
export const COMMAND_EXECUTION_INPUT_FIELDS: Readonly<
	Record<string, readonly string[]>
> = Object.freeze({
	// The production `run_commands` executable-bearing field, plus the
	// compatibility spellings the production normaliser and lenient union
	// accept for the SAME field.
	run_commands: Object.freeze(["commands", "command", "cmd"]),
});

/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02
 *
 * The command CLASSIFICATIONS of a tool call's own declared input.
 *
 * ACT-CLINEMM-PCK-EXACT-HEAD-PACKAGING-01: the derivation is SCOPED TO THE
 * TOOL. Only a tool whose schema declares an executable-command field
 * contributes classifications, and only under THAT tool's authoritative
 * field names.
 *
 * The OUTPUT is never read. A classification is a property of what the
 * runtime was ASKED to run, so a `make build` classification is established
 * by the call's own input plus the result's own success signal — not by
 * anything the tool printed.
 *
 * The traversal remains DELIBERATELY SHALLOW, mirroring the production
 * evidence-continuity module: only the call's own declared input is read,
 * and the depth is bounded.
 */
function collectCommandClassifications(
	toolName: string,
	input: unknown,
): readonly string[] {
	const fields = COMMAND_EXECUTION_INPUT_FIELDS[toolName];
	if (fields === undefined) {
		// The tool's schema declares NO executable-command field, so the
		// call establishes no command classification. A read_files call
		// whose PATH happens to be "make build" establishes nothing.
		return [];
	}
	const classifications: string[] = [];
	const push = (value: unknown): void => {
		if (typeof value === "string") {
			const label = classifyCommand(value);
			if (label && !classifications.includes(label)) {
				classifications.push(label);
			}
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				push(item);
			}
		}
	};
	const visit = (value: unknown, depth: number): void => {
		if (depth > 3) {
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				visit(item, depth + 1);
			}
			return;
		}
		if (!value || typeof value !== "object") {
			return;
		}
		for (const [key, nested] of Object.entries(
			value as Record<string, unknown>,
		)) {
			// ONLY the tool's OWN authoritative executable-command fields
			// are eligible. A metadata field — a path, a query, a script
			// label — is never an executable command.
			if (fields.includes(key)) {
				push(nested);
				continue;
			}
			if (nested && typeof nested === "object") {
				visit(nested, depth + 1);
			}
		}
	};
	visit(input, 0);
	return classifications;
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
	const callsById = new Map<
		string,
		{ readonly toolName: string; readonly input: unknown }
	>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				callCounts.set(block.id, (callCounts.get(block.id) ?? 0) + 1);
				if (!callsById.has(block.id)) {
					callsById.set(block.id, {
						toolName: block.name,
						input: (block as { input?: unknown }).input,
					});
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
	for (const [toolCallId, call] of callsById) {
		const toolName = call.toolName;
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
			commandClassifications: collectCommandClassifications(
				toolName,
				call.input,
			),
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
 * support for a set of canonical references, GIVEN the COMPLETE rendered
 * claim the model selected?
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
 * CORRECTION01 required the cited event to be unambiguously joined,
 * AFFIRMATIVELY SUCCESSFUL and of the class the atom requires. That closed
 * the CROSS-CLASS false attribution.
 *
 * ============================================================================
 * CORRECTION02 — THE COMPLETE RENDERED PROPOSITION MUST BE ESTABLISHED
 * ============================================================================
 *
 * CORRECTION01 left the SAME-CLASS false attribution open, because a tool
 * CLASS says what KIND of operation ran, not whether its RESULT supports
 * the claim:
 *
 *   successful search returning 42 matches   -> SEARCH_RETURNED_NO_MATCH
 *   successful `echo hello`                   -> OPERATION_INVOKED: build
 *   successful `echo hello`                   -> OPERATION_ARGUMENT_SET:
 *                                                start --optimized
 *
 * The interpreter now verifies the COMPLETE RENDERED PROPOSITION:
 *
 *   1. The ATOM must be one the runtime can establish at all. Only the
 *      OPERATION atoms can: for every other atom there is no deterministic
 *      runtime-owned rule that establishes the rendered claim.
 *
 *   2. The RENDERED ARGUMENT must be deterministically establishable. The
 *      interpreter now RECEIVES the selected argument — the predecessor
 *      never did, so it could not compare the rendered argument with the
 *      observed operation even in principle.
 *
 *   3. A cited event must be a COMMAND EXECUTION that is unambiguously
 *      joined, AFFIRMATIVELY SUCCESSFUL, and whose own runtime-owned
 *      command CLASSIFICATION is one the selected argument requires.
 *
 * A reference that resolves but does not establish the complete rendered
 * proposition leaves the ceiling at `model_reported`, so the claim is
 * DOWNGRADED rather than published as a false observation.
 */
export function interpretCanonicalEvidence(input: {
	readonly canonicalMessages: readonly MessageWithMetadata[];
	readonly references: readonly string[];
	/**
	 * The observation atom the model selected.
	 *
	 * It is REQUIRED, because the atom is what decides which kind of
	 * evidence can establish the claim. An atom with no deterministic
	 * runtime-owned rule is permanently bounded at `model_reported`.
	 */
	readonly atom: ObservationAtom;
	/**
	 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02
	 *
	 * The runtime argument the model selected, if any.
	 *
	 * It is REQUIRED for the operation atoms, because the rendered claim is
	 * "operation invoked: <argument>" — the ARGUMENT is part of the
	 * proposition, and the interpreter must verify it against the observed
	 * operation rather than the tool class alone.
	 */
	readonly argument?: RuntimeArgument;
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
	// (1) The atom must be establishable by deterministic runtime-owned
	// evidence at all.
	if (!DETERMINISTICALLY_ESTABLISHABLE_ATOMS.includes(input.atom)) {
		// No deterministic runtime-owned rule establishes this atom's
		// rendered proposition, so NO tool observation can establish it.
		return "model_reported";
	}
	// (2) The rendered ARGUMENT must be deterministically establishable.
	//
	// `OPERATION_INVOKED` renders the atom label alone, so it accepts the
	// explicit absence of an argument. `OPERATION_ARGUMENT_SET` renders
	// "operation invoked with argument: <argument>", so an argument is
	// REQUIRED: without one the rendered proposition is incomplete.
	const argument = input.argument;
	if (input.atom === "OPERATION_ARGUMENT_SET" && argument === undefined) {
		return "model_reported";
	}
	const requiredClassifications =
		argument === undefined
			? []
			: (RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS[argument] ?? []);
	// (3) A cited event must be a command execution whose own runtime-owned
	// classification is one the selected argument requires.
	const events = collectCanonicalToolEvents(input.canonicalMessages);
	const supporting = events.some(
		(event) =>
			observed.includes(event.toolCallId) &&
			event.succeeded &&
			event.evidenceClass === "command_execution" &&
			event.commandClassifications.some((classification) =>
				requiredClassifications.includes(classification),
			),
	);
	if (supporting) {
		return "tool_observed";
	}
	// The references RESOLVE, but no cited event ESTABLISHES the complete
	// rendered proposition. The claim survives at the truthful ceiling.
	return "model_reported";
}
