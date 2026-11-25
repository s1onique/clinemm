/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1)
 *
 * The exact runtime execution-stagnation recovery contract.
 *
 * WHY THIS LIVES IN `@cline/shared`
 * -------------------------------
 * The stagnation detector is produced by `AgentRuntime` (sdk/packages/agents)
 * and its corrective message MUST be recognisable by the compaction
 * task-contract conservation path (sdk/packages/core), exactly like the
 * runtime completion reminder. Both packages already depend on
 * `@cline/shared`, so this module is the single place where the producer's
 * template and the consumer's recogniser are defined together.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It defines no lifecycle authority of its own. It is a PURE decision
 * function plus a message template:
 *
 *   - it does not observe the runtime,
 *   - it does not count iterations,
 *   - it does not inject anything,
 *   - it does not decide completion.
 *
 * The runtime owns the accounting; this module owns the vocabulary. That
 * keeps a single lifecycle authority (the runtime loop) instead of a
 * parallel one.
 *
 * PRIVACY / HONESTY DISCIPLINE
 * -----------------------------
 * The corrective message describes ONLY OBSERVABLE EXECUTION FACTS that the
 * runtime actually observed:
 *
 *   - how many consecutive execution rounds produced no productive step,
 *   - which tool NAMES were used in those rounds (names are host-defined
 *     tool identifiers, not file contents, not command text, not findings),
 *   - how many times an edit was attempted in those rounds.
 *
 * It NEVER asserts an established finding, never claims a defect was
 * confirmed, never fabricates a tool result, and never impersonates the
 * user. It asks for the NEXT SMALLEST USEFUL EXPERIMENT OR EDIT — it does
 * not dictate a specific one, because the runtime does not know which
 * experiment would be correct.
 */

/**
 * The stable prefix of the runtime execution-stagnation corrective message.
 * It is part of the template identity, not a heuristic.
 */
const EXECUTION_STAGNATION_NOTICE_PREFIX =
	"[SYSTEM] Execution has stalled: the last ";

/**
 * The stable suffix of the runtime execution-stagnation corrective message.
 */
const EXECUTION_STAGNATION_NOTICE_SUFFIX =
	" consecutive execution round(s) produced no productive step. State the single smallest useful experiment or edit that would move this task forward, then perform it now.";

/**
 * The classification of one observed execution round.
 *
 * The runtime classifies each round by the OBSERVABLE shape of the work it
 * contained. The classification is NOT a host/provider string comparison:
 * it is derived from the tool INPUT SHAPE and the tool RESULT OUTCOME, so
 * it works for any host that produces the standard shapes.
 *
 * A host that can classify its OWN tools more precisely than the runtime
 * can (for example a host that knows whether a shell command was a
 * read-only inspection or a real test run) supplies that judgement through
 * {@link ExecutionStagnationPolicy.classifyToolCall}. The runtime NEVER
 * guesses from command TEXT: reading a command's text to decide whether it
 * counts as progress is exactly the provider-specific string matching this
 * mechanism refuses to do.
 */
export type ExecutionRoundProductivity =
	/** The round produced a successful native edit. */
	| "edited"
	/** The round executed a command that ran something (a test, a build, a probe). */
	| "executed"
	/**
	 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01.
	 *
	 * The round attempted an execution whose OUTCOME WAS NOT A SUCCESSFUL
	 * EXECUTION: the command FAILED, or the execution outcome was MISSING.
	 *
	 * WHY THIS VERDICT EXISTS
	 * -----------------------
	 * A failed executable experiment IS valuable engineering evidence — the
	 * agent obtained a real result. But a failed command is not the same
	 * observation as a SUCCESSFUL execution, and conflating the two lets a
	 * generic command failure become positive evidence of progress.
	 *
	 * Before this verdict existed, the host classifier correctly DECLINED a
	 * failed observation (it had no authority to claim success about a
	 * command that failed), but the runtime's fallback then counted the very
	 * same tool call as `"executed"` because it checked only the dispatch
	 * `isError` flag. The host's authoritative negative observation
	 * DISAPPEARED at the fallback.
	 *
	 * A FAILED round therefore does NOT reset the stagnation streak, but it
	 * is also NOT treated as a stall: it is a distinct observation that the
	 * accounting records without claiming progress. A failed test is a real
	 * result, not a stall.
	 */
	| "failed"
	/**
	 * The round only INSPECTED (read a file, searched, listed) — successful,
	 * but not progress toward the deliverable.
	 */
	| "inspected"
	/** The round made no tool call at all. */
	| "idle"
	/**
	 * The round is legitimately waiting on work that is still running
	 * (for example a background command that has not finished). Such a round
	 * MUST NOT count toward the stagnation streak.
	 */
	| "awaiting";

/**
 * One observed execution round, as the runtime reports it.
 */
export interface ExecutionRoundObservation {
	/** The runtime's productivity classification for the round. */
	productivity: ExecutionRoundProductivity;
	/**
	 * The host-defined tool names invoked during the round. Used only to
	 * describe the observable shape of the stalled work; never rendered with
	 * arguments or outputs.
	 */
	toolNames: readonly string[];
	/**
	 * How many native edit attempts the round contained (successful or not).
	 */
	editAttempts: number;
	/**
	 * How many of those edit attempts SUCCEEDED.
	 */
	successfulEdits: number;
}

/**
 * The runtime-owned execution-stagnation policy.
 */
export interface ExecutionStagnationPolicy {
	/**
	 * How many consecutive unproductive execution rounds are required
	 * before a corrective instruction is injected.
	 *
	 * Must be >= 1. A value of 1 means "inject after the first
	 * unproductive round".
	 */
	readonly unproductiveRoundThreshold: number;
	/**
	 * The maximum number of corrective instructions the runtime may inject
	 * for ONE run. This bounds the recovery allowance so a model that
	 * ignores the instruction cannot be nudged forever.
	 */
	readonly maxRecoveryInstructions: number;
	/**
	 * Whether the runtime may inject the corrective instruction at all.
	 * Defaults to disabled when the policy is absent.
	 */
	readonly enabled?: boolean;
	/**
	 * OPTIONAL host-supplied classification of ONE tool call.
	 *
	 * The runtime calls this for every tool call in the round. The host
	 * returns the round-level productivity the call contributes, or
	 * `undefined` to defer to the runtime's own structural classification.
	 *
	 * A host uses this when it can classify its tools more precisely than
	 * the runtime can — for example, a host that knows whether a shell
	 * command was a read-only inspection (`git log`, `grep`) or a real
	 * execution (`vitest run`, `bun test`). The runtime deliberately does
	 * NOT read command text to make this judgement.
	 *
	 * The callback MUST be pure and side-effect free. It MUST NOT change
	 * the tool call, and it MUST NOT throw; a throwing callback is treated
	 * as "no opinion".
	 */
	readonly classifyToolCall?: (
		toolName: string,
		input: unknown,
		result: { output: unknown; isError?: boolean } | undefined,
	) => ExecutionRoundProductivity | undefined;
}

/**
 * The DEFAULT policy.
 *
 * The threshold mirrors the Act-mode prompt's own reconnaissance-to-execution
 * guidance ("aim to make the first meaningful source or regression-test edit
 * within five inspection rounds"), so the runtime's trigger and the
 * prompt's stated target agree instead of contradicting each other.
 *
 * The instruction allowance is deliberately SMALL. Recovery is a nudge, not
 * a supervisor: a model that has already been told twice and still makes no
 * productive step is not stalled, it is failing, and failing must surface
 * as the run's own outcome rather than as an infinite nudge loop.
 */
export const DEFAULT_EXECUTION_STAGNATION_POLICY: ExecutionStagnationPolicy = {
	unproductiveRoundThreshold: 5,
	maxRecoveryInstructions: 2,
	enabled: true,
};

/**
 * Render the exact runtime corrective message for an observed stagnation.
 *
 * The message states OBSERVABLE FACTS ONLY:
 *
 *   - the number of consecutive unproductive rounds,
 *   - the tool names used in those rounds,
 *   - how many edit attempts those rounds contained.
 *
 * It then ASKS for the next smallest useful experiment or edit. It never
 * asserts that a defect was found, never reports a conclusion, and never
 * claims that the task is complete.
 *
 * @param unproductiveRounds how many consecutive unproductive rounds were observed
 * @param toolNames the host-defined tool names used across those rounds
 * @param editAttempts how many native edit attempts those rounds contained
 */
export function buildExecutionStagnationNoticeMessage(
	unproductiveRounds: number,
	toolNames: readonly string[],
	editAttempts: number,
): string {
	const uniqueNames = [
		...new Set(toolNames.filter((name) => name.length > 0)),
	].sort();
	const tools =
		uniqueNames.length > 0 ? uniqueNames.join(", ") : "no tools were used";
	const edits =
		editAttempts > 0
			? ` ${editAttempts} edit attempt(s) were made in those rounds.`
			: " No edit was attempted in those rounds.";
	return (
		`${EXECUTION_STAGNATION_NOTICE_PREFIX}${unproductiveRounds}` +
		`${EXECUTION_STAGNATION_NOTICE_SUFFIX} ` +
		`Observable facts: the ${unproductiveRounds} round(s) used only ${tools}.` +
		edits
	);
}

/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01).
 *
 * The STRUCTURAL shape of the runtime execution-stagnation corrective
 * message, parsed from the template's own fixed frames.
 *
 * WHY A STRUCTURAL RECOGNISER
 * ---------------------------
 * `isExecutionStagnationNoticeMessage()` recognises a notice by byte-exact
 * equality against the template rendered for a KNOWN parameter triple. That
 * is the right primitive for a caller that already knows the triple (the
 * runtime's own accounting).
 *
 * The compaction task-contract conservation path does NOT know the triple: it
 * reads the CANONICAL HISTORY, where the notice's parameters are whatever the
 * runtime observed at the time. To carry the notice forward it must recognise
 * the notice WITHOUT being told its parameters.
 *
 * This recogniser therefore parses the template's OWN fixed frames — the
 * stable prefix, the stable suffix, and the "Observable facts" frame — and
 * validates each parameter slot against the exact grammar the renderer
 * produces. It is NOT a broad string guess:
 *
 *   - every FIXED segment of the template must be present, byte for byte;
 *   - the round count must be a canonical non-negative integer (no leading
 *     zeros, no sign, no whitespace);
 *   - the tool-name slot must be either the renderer's literal empty form
 *     ("no tools were used") or a comma-separated list of non-empty names
 *     that is already SORTED and DUPLICATE-FREE (exactly what the renderer
 *     emits);
 *   - the edit-attempt slot must be either the renderer's literal empty form
 *     or a canonical non-negative integer.
 *
 * A user-authored or unrelated runtime message that merely contains the words
 * "Execution has stalled" is therefore NOT recognised.
 */
export interface ParsedExecutionStagnationNotice {
	/** The consecutive unproductive round count the notice reports. */
	readonly unproductiveRounds: number;
	/** The host-defined tool names the notice lists, in render order. */
	readonly toolNames: readonly string[];
	/** The native edit attempts the notice reports. */
	readonly editAttempts: number;
}

/**
 * The literal the renderer emits for the tool-name slot when no tool was
 * used.
 */
const EXECUTION_STAGNATION_NO_TOOLS = "no tools were used";

/**
 * The literal the renderer emits for the edit-attempt slot when no edit was
 * attempted.
 */
const EXECUTION_STAGNATION_NO_EDITS = "No edit was attempted in those rounds.";

/**
 * The literal the renderer emits for the edit-attempt slot when edits were
 * attempted. The count is a parameter, so the frame is split around it. The
 * frame KEEPS its leading space: it is the separator between the count and
 * the frame, and the renderer always emits exactly one.
 */
const EXECUTION_STAGNATION_EDITS_PREFIX =
	" edit attempt(s) were made in those rounds.";

/**
 * A canonical non-negative integer: digits only, no leading zero (except the
 * single digit "0"), no sign, no whitespace.
 */
function isCanonicalCount(value: string): boolean {
	if (!/^\d+$/.test(value)) {
		return false;
	}
	if (value.length > 1 && value.startsWith("0")) {
		return false;
	}
	return true;
}

/**
 * Whether a tool-name slot is in the exact form the renderer emits: either
 * the literal empty form, or a comma-separated list of non-empty names that
 * is already sorted and duplicate-free.
 */
function isCanonicalToolList(value: string): boolean {
	if (value === EXECUTION_STAGNATION_NO_TOOLS) {
		return true;
	}
	const names = value.split(", ");
	if (names.length === 0) {
		return false;
	}
	for (const name of names) {
		if (name.length === 0) {
			return false;
		}
	}
	// The renderer sorts and de-duplicates. A list that is not already sorted
	// and duplicate-free was NOT produced by the renderer.
	for (let index = 1; index < names.length; index += 1) {
		const previous = names[index - 1];
		const current = names[index];
		if (previous >= current) {
			return false;
		}
	}
	return true;
}

/**
 * Parse a runtime execution-stagnation corrective message by its EXACT
 * template shape.
 *
 * Returns `undefined` when the text is not a well-formed notice. A
 * well-formed notice is one that this module's own renderer could have
 * produced for the returned parameter triple.
 */
export function parseExecutionStagnationNoticeMessage(
	text: string,
): ParsedExecutionStagnationNotice | undefined {
	if (typeof text !== "string" || text.length === 0) {
		return undefined;
	}
	if (!text.startsWith(EXECUTION_STAGNATION_NOTICE_PREFIX)) {
		return undefined;
	}
	let cursor = EXECUTION_STAGNATION_NOTICE_PREFIX.length;
	const roundsEnd = text.indexOf(" ", cursor);
	if (roundsEnd === -1) {
		return undefined;
	}
	const roundsText = text.slice(cursor, roundsEnd);
	if (!isCanonicalCount(roundsText)) {
		return undefined;
	}
	const unproductiveRounds = Number.parseInt(roundsText, 10);
	cursor = roundsEnd;
	if (!text.startsWith(EXECUTION_STAGNATION_NOTICE_SUFFIX, cursor)) {
		return undefined;
	}
	cursor += EXECUTION_STAGNATION_NOTICE_SUFFIX.length;
	const factsPrefix = " Observable facts: the ";
	if (!text.startsWith(factsPrefix, cursor)) {
		return undefined;
	}
	cursor += factsPrefix.length;
	const roundsMarker = " round(s) used only ";
	const roundsMarkerAt = text.indexOf(roundsMarker, cursor);
	if (roundsMarkerAt === -1) {
		return undefined;
	}
	const factsRoundsText = text.slice(cursor, roundsMarkerAt);
	if (factsRoundsText !== roundsText) {
		return undefined;
	}
	cursor = roundsMarkerAt + roundsMarker.length;
	const factsEnd = text.indexOf(".", cursor);
	if (factsEnd === -1) {
		return undefined;
	}
	const toolsText = text.slice(cursor, factsEnd);
	if (!isCanonicalToolList(toolsText)) {
		return undefined;
	}
	const toolNames =
		toolsText === EXECUTION_STAGNATION_NO_TOOLS ? [] : toolsText.split(", ");
	cursor = factsEnd;
	// The renderer emits the tool list, its terminating period, and then the
	// edit-attempt slot. The slot is either the literal "no edits" form or a
	// canonical count followed by the "N edit attempt(s)" frame.
	if (!text.startsWith(" ", cursor + 1)) {
		return undefined;
	}
	cursor += 2;
	if (text.startsWith(EXECUTION_STAGNATION_NO_EDITS, cursor)) {
		// The renderer emits NOTHING after the "no edits" literal.
		if (cursor + EXECUTION_STAGNATION_NO_EDITS.length !== text.length) {
			return undefined;
		}
		return { unproductiveRounds, toolNames, editAttempts: 0 };
	}
	const editsPrefixEnd = text.indexOf(
		EXECUTION_STAGNATION_EDITS_PREFIX,
		cursor,
	);
	if (editsPrefixEnd === -1) {
		return undefined;
	}
	const editsText = text.slice(cursor, editsPrefixEnd);
	if (!isCanonicalCount(editsText)) {
		return undefined;
	}
	const editAttempts = Number.parseInt(editsText, 10);
	// The count must be IMMEDIATELY followed by the frame's single separating
	// space: `editsPrefixEnd` is the frame's leading space, so the count ends
	// exactly one character before it.
	if (editsPrefixEnd !== cursor + editsText.length) {
		return undefined;
	}
	// The renderer emits NOTHING after the edit-attempt frame.
	if (
		editsPrefixEnd + EXECUTION_STAGNATION_EDITS_PREFIX.length !==
		text.length
	) {
		return undefined;
	}
	return { unproductiveRounds, toolNames, editAttempts };
}

/**
 * Recognise a runtime execution-stagnation corrective message by EXACT
 * template equality.
 *
 * A message is recognised only when it is byte-identical to the template
 * this module renders for the SAME (round count, tool names, edit attempt
 * count) triple. Therefore:
 *
 *   - a runtime stagnation notice is recognised,
 *   - an unrelated runtime notice is not,
 *   - a user-authored message that merely resembles the template is not
 *     (the caller additionally requires the runtime-synthetic
 *     classification),
 *   - a truncated or altered notice is not.
 */
export function isExecutionStagnationNoticeMessage(
	text: string,
	unproductiveRounds: number,
	toolNames: readonly string[],
	editAttempts: number,
): boolean {
	if (typeof text !== "string") {
		return false;
	}
	return (
		text ===
		buildExecutionStagnationNoticeMessage(
			unproductiveRounds,
			toolNames,
			editAttempts,
		)
	);
}

/**
 * The runtime's decision at an iteration boundary.
 */
export type ExecutionStagnationDecision =
	/** No intervention. The streak continues to accumulate. */
	| { readonly kind: "none" }
	/**
	 * The streak reached the threshold and the runtime MUST inject exactly
	 * one corrective instruction before the next model request.
	 */
	| {
			readonly kind: "inject";
			/** The consecutive unproductive round count that triggered it. */
			readonly unproductiveRounds: number;
			/** The rendered corrective message. */
			readonly message: string;
			/** The tool names observed across the unproductive rounds. */
			readonly toolNames: readonly string[];
			/** The native edit attempts observed across the unproductive rounds. */
			readonly editAttempts: number;
	  }
	/**
	 * The streak reached the threshold but the run-scoped allowance is
	 * exhausted. The runtime MUST NOT inject again; the run continues on its
	 * own terms and the stall surfaces through the run's normal outcome.
	 */
	| {
			readonly kind: "allowance_exhausted";
			readonly unproductiveRounds: number;
	  };

/**
 * The runtime-owned stagnation accounting.
 *
 * This is deliberately a plain, dependency-free value object: the runtime
 * owns it, mutates it at its own iteration boundary, and hands it to
 * {@link decideExecutionStagnation} to obtain a decision. The decision
 * function NEVER mutates it.
 */
export interface ExecutionStagnationAccounting {
	/** Consecutive unproductive rounds observed so far. */
	readonly unproductiveRounds: number;
	/** How many corrective instructions the runtime has already injected. */
	readonly instructionsInjected: number;
	/** Tool names observed across the current unproductive streak. */
	readonly toolNames: readonly string[];
	/** Native edit attempts observed across the current unproductive streak. */
	readonly editAttempts: number;
}

/**
 * An EMPTY accounting, for the start of a run.
 */
export function createExecutionStagnationAccounting(): ExecutionStagnationAccounting {
	return {
		unproductiveRounds: 0,
		instructionsInjected: 0,
		toolNames: [],
		editAttempts: 0,
	};
}

/**
 * Fold one observed round into the accounting.
 *
 * A PRODUCTIVE round (`edited` / `executed`) RESETS the streak: the streak
 * measures CONSECUTIVE unproductive rounds, so a single productive round
 * clears it. A round that is legitimately `awaiting` also resets the
 * streak, because waiting on running work is not stalling.
 *
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01: a `failed` round
 * does NOT reset the streak, because a failed command is not a SUCCESSFUL
 * execution and therefore not positive evidence of progress. It is also not
 * treated as a stall in its own right: the streak counts it, and the
 * runtime's own corrective instruction asks for the next smallest useful
 * experiment — which is exactly the right response to a failed experiment.
 * A failed test is a real result, not a stall, and this function never
 * claims otherwise.
 *
 * The function is pure: it RETURNS the next accounting and never mutates
 * the input.
 */
export function foldExecutionRound(
	accounting: ExecutionStagnationAccounting,
	observation: ExecutionRoundObservation,
): ExecutionStagnationAccounting {
	if (
		observation.productivity === "edited" ||
		observation.productivity === "executed" ||
		observation.productivity === "awaiting"
	) {
		// The STREAK resets, but the instruction allowance is RUN-SCOPED and
		// survives: a productive round between two stalls must NOT
		// replenish the recovery allowance, otherwise an agent could
		// alternate "one trivial progress step, then stall" forever and the
		// recovery would never be bounded.
		return {
			unproductiveRounds: 0,
			instructionsInjected: accounting.instructionsInjected,
			toolNames: [],
			editAttempts: 0,
		};
	}
	return {
		unproductiveRounds: accounting.unproductiveRounds + 1,
		// The instruction allowance is RUN-SCOPED, so it survives a streak
		// reset. Only a new run resets it.
		instructionsInjected: accounting.instructionsInjected,
		toolNames: [...accounting.toolNames, ...observation.toolNames],
		editAttempts: accounting.editAttempts + observation.editAttempts,
	};
}

/**
 * Decide whether the runtime must inject a corrective instruction.
 *
 * The decision is a pure function of the accounting and the policy. It does
 * NOT mutate the accounting; the caller applies the returned state.
 *
 * The decision uses ONLY information available at the moment it is taken:
 * the rounds observed SO FAR. It never consults future observations.
 */
export function decideExecutionStagnation(
	accounting: ExecutionStagnationAccounting,
	policy: ExecutionStagnationPolicy | undefined,
): ExecutionStagnationDecision {
	if (!policy || policy.enabled === false) {
		return { kind: "none" };
	}
	const threshold = Math.max(1, Math.floor(policy.unproductiveRoundThreshold));
	if (accounting.unproductiveRounds < threshold) {
		return { kind: "none" };
	}
	if (
		accounting.instructionsInjected >=
		Math.max(0, policy.maxRecoveryInstructions)
	) {
		return {
			kind: "allowance_exhausted",
			unproductiveRounds: accounting.unproductiveRounds,
		};
	}
	return {
		kind: "inject",
		unproductiveRounds: accounting.unproductiveRounds,
		message: buildExecutionStagnationNoticeMessage(
			accounting.unproductiveRounds,
			accounting.toolNames,
			accounting.editAttempts,
		),
		toolNames: accounting.toolNames,
		editAttempts: accounting.editAttempts,
	};
}

/**
 * Fold a decision back into the accounting.
 *
 * An `inject` decision increments the run-scoped instruction counter (so
 * the SAME instruction can never be injected without bound) and resets the
 * STREAK (so the next injection needs a FRESH streak of unproductive rounds
 * rather than firing again on the very next round).
 */
export function applyExecutionStagnationDecision(
	accounting: ExecutionStagnationAccounting,
	decision: ExecutionStagnationDecision,
): ExecutionStagnationAccounting {
	if (decision.kind !== "inject") {
		return accounting;
	}
	return {
		unproductiveRounds: 0,
		instructionsInjected: accounting.instructionsInjected + 1,
		toolNames: [],
		editAttempts: 0,
	};
}
