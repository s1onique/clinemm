/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01
 *
 * The exact runtime BOUNDED-OBJECTIVE contract.
 *
 * WHAT THIS IS
 * ------------
 * R1 (`agents/execution-stagnation`) injects an ADVISORY corrective
 * instruction when a trajectory stalls. R2 goes one step further: when the
 * R1 allowance is exhausted and the trajectory is STILL unproductive, the
 * runtime SELECTS one bounded, independently verifiable objective derived
 * from the parent task and makes it the CURRENT EXECUTION TARGET.
 *
 * The distinction is load-bearing. An advisory asks the model to behave
 * differently; a bounded objective CHANGES what the model is asked to do.
 * The R2 dispatch therefore projects the objective onto the request's
 * privileged channel (the same channel the host's trusted runtime-control
 * continuation uses), NOT onto the advisory message channel R1 uses.
 *
 * WHY THIS LIVES IN `@cline/shared`
 * ---------------------------------
 * The objective has THREE independent producers/consumers that must agree
 * byte-for-byte:
 *
 *   1. the runtime, which SELECTS the objective (via the model),
 *   2. the runtime, which VALIDATES and RENDERS it into the dispatch,
 *   3. the compaction task-contract conservation path, which must be able to
 *      RECOGNISE the active objective in the canonical history so the
 *      objective's identity survives compaction.
 *
 * All three packages already depend on `@cline/shared`, so this module is
 * the single place where the producer's template and the consumer's
 * recogniser are defined together.
 *
 * WHAT THIS MODULE DOES NOT DO
 * -----------------------------
 * It defines no lifecycle authority of its own. It is a PURE contract:
 *
 *   - it does not observe the runtime,
 *   - it does not count activations,
 *   - it does not dispatch anything,
 *   - it does not decide completion.
 *
 * The runtime owns the accounting and the dispatch; this module owns the
 * vocabulary and the validation rules.
 *
 * SCOPE DISCIPLINE
 * -----------------
 * This is a bounded OBJECTIVE contract — one concrete objective with one
 * first step, one mutation scope and one observable verification condition.
 * It is NOT a general-purpose workflow schema, NOT a DAG description, and
 * NOT a plan. A "workflow schema" would let one objective expand into many
 * dependent steps; this contract deliberately cannot express that.
 */

/**
 * The stable prefix of the runtime bounded-objective dispatch instruction.
 *
 * It is DISTINCT from the R1 stagnation notice prefix ("[SYSTEM] Execution
 * has stalled: ...") so that:
 *
 *   - a bounded objective is never mistaken for another advisory nudge, and
 *   - an advisory nudge is never mistaken for a bounded objective.
 */
const BOUNDED_OBJECTIVE_PREFIX =
	"[SYSTEM] Active bounded objective (runtime authority):";

/**
 * The stable suffix of the runtime bounded-objective dispatch instruction.
 */
const BOUNDED_OBJECTIVE_SUFFIX = ".";

/**
 * The field labels of the rendered bounded-objective dispatch. They are a
 * stable, greppable marker so a carried objective can be located and
 * replaced deterministically instead of accumulating copies.
 */
const FIELD_LABELS = {
	parentTask: "Parent task",
	objective: "Objective",
	obligationReferences: "Parent obligation references",
	firstStep: "First action",
	mutationScope: "Permitted mutation scope",
	verificationCondition: "Observable verification condition",
	evidenceReferences: "Existing evidence references",
	successCondition: "Success condition",
	failureCondition: "Failure condition",
} as const;

/**
 * ONE bounded, independently verifiable objective derived from the parent
 * task.
 *
 * The shape is deliberately FLAT. Every field is a bounded string or a
 * bounded list of strings; there is no nesting, no dependency edge, and no
 * sequence of sub-steps. A single objective with a single first step and a
 * single verification condition is what makes the objective independently
 * verifiable and what keeps the recovery bounded.
 */
export interface BoundedObjective {
	/**
	 * The identity of the PARENT task this objective was derived from.
	 *
	 * The parent task remains authoritative throughout: this objective is a
	 * child of it, never a replacement for it.
	 */
	readonly parentTaskId: string;
	/**
	 * ONE concrete objective. It must be a single bounded action, not a
	 * programme of work.
	 */
	readonly objective: string;
	/**
	 * The parent obligations this objective advances.
	 *
	 * These are REFERENCES to obligations that remain OUTSTANDING. The
	 * objective never satisfies them by itself: satisfying them is the
	 * parent's business, and the parent's completion contract is unchanged.
	 */
	readonly obligationReferences: readonly string[];
	/**
	 * The ONE actionable first step.
	 */
	readonly firstStep: string;
	/**
	 * The mutation scope the objective is permitted to touch.
	 */
	readonly mutationScope: string;
	/**
	 * An OBSERVABLE verification condition.
	 *
	 * It must name something that can be checked from the tool outcomes of
	 * the objective's own execution — a command that must succeed, a file
	 * that must change, an artefact that must exist. "The code looks right"
	 * is not observable; "the regression test for X passes" is.
	 */
	readonly verificationCondition: string;
	/**
	 * The established evidence the objective relies on.
	 *
	 * These are REFERENCES to observations that were actually established.
	 * The objective may not invent evidence, and may not claim that an
	 * outstanding obligation is already satisfied.
	 */
	readonly evidenceReferences: readonly string[];
	/**
	 * The condition under which the objective SUCCEEDS.
	 */
	readonly successCondition: string;
	/**
	 * The condition under which the objective FAILS.
	 */
	readonly failureCondition: string;
}

/**
 * The runtime-owned bounded-objective recovery policy.
 *
 * OPT-IN: absent means the runtime behaves EXACTLY as before — no selection
 * inference, no dispatch, no recovery. The limits below are EXPERIMENTAL
 * bounds for this implementation, not permanent production defaults.
 */
export interface BoundedObjectivePolicy {
	/**
	 * Whether the runtime may select and execute a bounded objective at all.
	 *
	 * Defaults to disabled when the policy is absent.
	 */
	readonly enabled?: boolean;
	/**
	 * The maximum number of bounded-objective ACTIVATIONS per parent run.
	 *
	 * Experimental bound: 2.
	 */
	readonly maxActivations?: number;
	/**
	 * The maximum number of EXECUTION ROUNDS per bounded objective.
	 *
	 * Experimental bound: 8.
	 */
	readonly maxObjectiveRounds?: number;
	/**
	 * The maximum number of SELECTION INFERENCES per bounded-objective
	 * activation.
	 *
	 * Experimental bound: 1. A failed selection therefore consumes the
	 * activation's inference allowance and MUST NOT start an unbounded
	 * selection retry loop.
	 */
	readonly maxSelectionInferences?: number;
	/**
	 * OPTIONAL host-supplied judgement of whether a bounded objective has
	 * been VERIFIED.
	 *
	 * The host may know more than the runtime: it owns the command-policy
	 * layer, the workspace, and the executable gates. The callback receives
	 * the observable facts of the objective's execution and returns whether
	 * the objective's verification condition was MET.
	 *
	 * Returning `undefined` means "no opinion" — the runtime then falls
	 * back to its OWN structural check (an executable command that succeeded
	 * during the objective's rounds).
	 *
	 * The callback MUST be pure and side-effect free. It MUST NOT throw; a
	 * throwing callback is treated as "no opinion".
	 */
	readonly verifyObjective?: (
		objective: BoundedObjective,
		facts: BoundedObjectiveObservationFacts,
	) => boolean | undefined;
}

/**
 * The OBSERVABLE facts of a bounded objective's execution.
 *
 * These are the same structural facts the runtime already observes for the
 * stagnation accounting: which tool NAMES were used, whether an edit
 * succeeded, whether a command executed successfully. They contain no tool
 * OUTPUT text, no file contents, and no model reasoning.
 */
export interface BoundedObjectiveObservationFacts {
	/** How many execution rounds the objective consumed. */
	readonly rounds: number;
	/** The host-defined tool names invoked across those rounds. */
	readonly toolNames: readonly string[];
	/** How many native edit attempts the objective's rounds contained. */
	readonly editAttempts: number;
	/** How many of those edit attempts SUCCEEDED. */
	readonly successfulEdits: number;
	/** How many commands executed SUCCESSFULLY during the objective. */
	readonly executedCommands: number;
}

/**
 * The EXPERIMENTAL defaults for the bounded-objective policy.
 *
 * These are bounds for this experimental implementation only. They are NOT
 * permanent production defaults and they are deliberately conservative: a
 * recovery mechanism that cannot prove its own outcome must fail into a
 * truthful internal outcome rather than loop.
 */
export const DEFAULT_BOUNDED_OBJECTIVE_POLICY: Required<
	Pick<
		BoundedObjectivePolicy,
		"maxActivations" | "maxObjectiveRounds" | "maxSelectionInferences"
	>
> = {
	maxActivations: 2,
	maxObjectiveRounds: 8,
	maxSelectionInferences: 1,
};

/**
 * The outcome of validating a selected bounded objective.
 *
 * The validator is the R2 authorisation boundary. An objective that would
 * EXPAND the parent's authority, CONTRADICT the parent's constraints,
 * INVENT evidence, or claim an outstanding obligation is already satisfied
 * is REJECTED — and a rejection never starts another selection attempt.
 */
export type BoundedObjectiveValidation =
	| { readonly valid: true; readonly objective: BoundedObjective }
	| { readonly valid: false; readonly reason: BoundedObjectiveRejectionReason };

/**
 * Why a selected bounded objective was rejected.
 */
export type BoundedObjectiveRejectionReason =
	/** A required field was empty, malformed, or unbounded. */
	| "malformed"
	/** The objective tried to widen the parent's mutation scope. */
	| "scope_expansion"
	/** The objective contradicted a parent constraint. */
	| "constraint_conflict"
	/** The objective asserted evidence that was never established. */
	| "fabricated_evidence"
	/** The objective claimed an outstanding obligation is already satisfied. */
	| "unsupported_completion_claim";

/**
 * The maximum number of characters any single bounded-objective field may
 * contain.
 *
 * A bounded objective is a bounded instruction. An unbounded field is a
 * programme of work wearing an objective's clothes, so the field length is
 * itself an authorisation bound.
 */
export const MAX_BOUNDED_OBJECTIVE_FIELD_LENGTH = 2000;

/**
 * The maximum number of entries any bounded-objective reference list may
 * contain.
 */
export const MAX_BOUNDED_OBJECTIVE_REFERENCE_COUNT = 16;

/**
 * Whether a string is a usable bounded-objective field value.
 */
function isUsableField(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.trim().length > 0 &&
		value.length <= MAX_BOUNDED_OBJECTIVE_FIELD_LENGTH
	);
}

/**
 * Whether a reference list is a usable bounded-objective value.
 */
function isUsableReferenceList(value: unknown): value is string[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.length <= MAX_BOUNDED_OBJECTIVE_REFERENCE_COUNT &&
		value.every((entry) => isUsableField(entry))
	);
}

/**
 * Validate ONE candidate bounded objective.
 *
 * The validator is deliberately CONSERVATIVE and operates ONLY on facts the
 * runtime can establish at the moment of validation:
 *
 *   - the parent task identity,
 *   - the parent's mutation scope (the scope the parent task authorises),
 *   - the parent's constraints,
 *   - the obligations that are STILL OUTSTANDING,
 *   - the observations that were ACTUALLY established.
 *
 * A candidate is REJECTED when it:
 *
 *   - is malformed (a missing/empty/unbounded field),
 *   - proposes a mutation scope that is NOT within the parent's scope,
 *   - contradicts a parent constraint,
 *   - cites evidence that was never established, or
 *   - claims that an outstanding obligation is already satisfied.
 *
 * The function is PURE and never throws.
 */
export function validateBoundedObjective(
	candidate: unknown,
	context: {
		readonly parentTaskId: string;
		/**
		 * The mutation scope the PARENT task authorises, in prose.
		 *
		 * It is carried into the selection prompt so the selection knows
		 * the parent's ceiling.
		 */
		readonly parentMutationScope: string;
		/**
		 * The PATHS the PARENT task authorises, when the parent named any.
		 *
		 * These are the STRUCTURAL ceiling: an objective whose mutation
		 * scope names a path outside every authorised path is rejected as
		 * a scope expansion. When the parent named no path, the list is
		 * empty and the structural check is skipped — the remaining guards
		 * still apply.
		 */
		readonly parentMutationScopePaths?: readonly string[];
		/** The parent's applicable constraints, verbatim. */
		readonly parentConstraints: readonly string[];
		/** The obligations that are STILL OUTSTANDING. */
		readonly outstandingObligations: readonly string[];
		/** The observations that were ACTUALLY established. */
		readonly establishedObservations: readonly string[];
	},
): BoundedObjectiveValidation {
	if (typeof candidate !== "object" || candidate === null) {
		return { valid: false, reason: "malformed" };
	}
	const raw = candidate as Record<string, unknown>;

	const requiredFields = [
		raw.objective,
		raw.firstStep,
		raw.mutationScope,
		raw.verificationCondition,
		raw.successCondition,
		raw.failureCondition,
	] as const;
	for (const field of requiredFields) {
		if (!isUsableField(field)) {
			return { valid: false, reason: "malformed" };
		}
	}
	if (!isUsableReferenceList(raw.obligationReferences)) {
		return { valid: false, reason: "malformed" };
	}
	if (!isUsableReferenceList(raw.evidenceReferences)) {
		return { valid: false, reason: "malformed" };
	}

	// The parent identity is the RUNTIME's, not the model's. A candidate
	// that names a DIFFERENT parent is claiming to act under an authority
	// it was not given.
	const parentTaskId =
		typeof raw.parentTaskId === "string" && raw.parentTaskId.length > 0
			? raw.parentTaskId
			: context.parentTaskId;
	if (parentTaskId !== context.parentTaskId) {
		return { valid: false, reason: "scope_expansion" };
	}

	const objective = raw.objective as string;
	const firstStep = raw.firstStep as string;
	const mutationScope = raw.mutationScope as string;
	const verificationCondition = raw.verificationCondition as string;
	const successCondition = raw.successCondition as string;
	const failureCondition = raw.failureCondition as string;
	const obligationReferences = raw.obligationReferences as string[];
	const evidenceReferences = raw.evidenceReferences as string[];

	// SCOPE EXPANSION: the objective's mutation scope must be INSIDE the
	// parent's authorised scope.
	//
	// The check is a PATH CONTAINMENT test whenever the parent supplies
	// authorised scope PATHS. A candidate scope that names a path outside
	// every authorised path is rejected: that is exactly the case where the
	// objective would widen the parent's authority.
	//
	// When the parent supplies no authorised paths (the parent did not name
	// any), the runtime has no structural ceiling to enforce and the check
	// is skipped. The remaining guards — the parent identity, the
	// constraint check, the fabricated-evidence check and the
	// unsupported-completion-claim check — still apply.
	//
	// The check is deliberately structural. It never inspects command text
	// and never guesses at intent.
	const authorisedPaths = context.parentMutationScopePaths ?? [];
	if (authorisedPaths.length > 0) {
		const candidatePaths = extractScopePaths(mutationScope);
		if (candidatePaths.length > 0) {
			const escaped = candidatePaths.filter(
				(candidatePath) =>
					!authorisedPaths.some(
						(authorisedPath) =>
							candidatePath === authorisedPath ||
							candidatePath.startsWith(`${authorisedPath}/`),
					),
			);
			if (escaped.length > 0) {
				return { valid: false, reason: "scope_expansion" };
			}
		}
	}

	// CONSTRAINT CONFLICT: the objective may not contradict an applicable
	// parent constraint. The check is deliberately conservative: it only
	// rejects when the candidate's own text ASSERTS the negation of a
	// constraint's subject, because a false positive here would silently
	// disable recovery.
	for (const constraint of context.parentConstraints) {
		const negated = negatedSubject(constraint.trim().toLowerCase());
		if (negated.length === 0) {
			continue;
		}
		const haystack =
			`${objective}\n${firstStep}\n${mutationScope}\n${verificationCondition}\n${successCondition}\n${failureCondition}`.toLowerCase();
		if (haystack.includes(negated)) {
			return { valid: false, reason: "constraint_conflict" };
		}
	}

	// FABRICATED EVIDENCE: every cited evidence reference must correspond to
	// an observation that was ACTUALLY established. The match is exact on
	// the reference string, because the selection prompt enumerates the
	// established observations and the candidate must cite them verbatim.
	const established = new Set(
		context.establishedObservations.map((entry) => entry.trim()),
	);
	for (const reference of evidenceReferences) {
		if (!established.has(reference.trim())) {
			return { valid: false, reason: "fabricated_evidence" };
		}
	}

	// UNSUPPORTED COMPLETION CLAIM: the objective may not assert that an
	// OUTSTANDING obligation is already satisfied. The obligation the
	// objective advances is, by definition, still outstanding.
	for (const reference of obligationReferences) {
		const normalizedReference = reference.trim().toLowerCase();
		if (normalizedReference.length === 0) {
			continue;
		}
		const isOutstanding = context.outstandingObligations.some(
			(obligation) => obligation.trim().toLowerCase() === normalizedReference,
		);
		if (!isOutstanding) {
			return { valid: false, reason: "unsupported_completion_claim" };
		}
	}
	const completionClaimHaystack =
		`${objective}\n${successCondition}\n${verificationCondition}`.toLowerCase();
	for (const obligation of context.outstandingObligations) {
		const normalizedObligation = obligation.trim().toLowerCase();
		if (normalizedObligation.length === 0) {
			continue;
		}
		if (
			completionClaimHaystack.includes(
				`${normalizedObligation} is satisfied`,
			) ||
			completionClaimHaystack.includes(`${normalizedObligation} is complete`) ||
			completionClaimHaystack.includes(
				`${normalizedObligation} is already done`,
			) ||
			completionClaimHaystack.includes(
				`no longer outstanding: ${normalizedObligation}`,
			)
		) {
			return { valid: false, reason: "unsupported_completion_claim" };
		}
	}

	return {
		valid: true,
		objective: {
			parentTaskId,
			objective,
			firstStep,
			mutationScope,
			verificationCondition,
			obligationReferences,
			evidenceReferences,
			successCondition,
			failureCondition,
		},
	};
}

/**
 * Extract the FILE PATHS a mutation scope names.
 *
 * The grammar is deliberately minimal: a token that starts with `/` or
 * `./` or `~/` and contains no whitespace is a path. A scope expressed in
 * prose ("the disposable workspace directory") therefore yields NO paths,
 * and the structural scope check is skipped for it — the runtime does not
 * guess at intent.
 *
 * The extraction is structural: it never interprets command text and never
 * evaluates anything.
 */
function extractScopePaths(scope: string): string[] {
	const tokens = scope.split(/[\s,;]+/);
	const paths: string[] = [];
	for (const token of tokens) {
		const trimmed = token.replace(/[).,;:]+$/, "");
		if (
			trimmed.length === 0 ||
			trimmed.includes(" ") ||
			trimmed.includes("*")
		) {
			continue;
		}
		if (
			trimmed.startsWith("/") ||
			trimmed.startsWith("./") ||
			trimmed.startsWith("~/")
		) {
			paths.push(trimmed);
		}
	}
	return paths;
}

/**
 * Extract the subject a parent constraint NEGATES, when the constraint is
 * recognisably a prohibition.
 *
 * The grammar is intentionally tiny: only "do not X" / "don't X" /
 * "never X" produce a subject. Every other constraint form yields the empty
 * string, and an empty result means "no opinion" — the validator then
 * leaves the candidate alone.
 */
function negatedSubject(constraint: string): string {
	const prefixes = ["do not ", "don't ", "never ", "must not ", "mustn't "];
	for (const prefix of prefixes) {
		if (constraint.startsWith(prefix)) {
			return constraint.slice(prefix.length).trim();
		}
	}
	return "";
}

/**
 * Render the runtime bounded-objective dispatch instruction.
 *
 * The rendered text is what the model SEES. It is deliberately NOT an
 * advisory: it names the CURRENT EXECUTION TARGET, states the ONE first
 * action, and states the ONE observable verification condition.
 *
 * The rendering is DETERMINISTIC: the same objective always produces
 * byte-identical text, so a carried objective can be recognised by template
 * equality after compaction.
 */
export function renderBoundedObjectiveInstruction(
	objective: BoundedObjective,
): string {
	const lines = [
		`${BOUNDED_OBJECTIVE_PREFIX} ${objective.objective}${BOUNDED_OBJECTIVE_SUFFIX}`,
		`${FIELD_LABELS.parentTask}: ${objective.parentTaskId}`,
		`${FIELD_LABELS.objective}: ${objective.objective}`,
		`${FIELD_LABELS.obligationReferences}: ${objective.obligationReferences.join("; ")}`,
		`${FIELD_LABELS.firstStep}: ${objective.firstStep}`,
		`${FIELD_LABELS.mutationScope}: ${objective.mutationScope}`,
		`${FIELD_LABELS.verificationCondition}: ${objective.verificationCondition}`,
		`${FIELD_LABELS.evidenceReferences}: ${objective.evidenceReferences.join("; ")}`,
		`${FIELD_LABELS.successCondition}: ${objective.successCondition}`,
		`${FIELD_LABELS.failureCondition}: ${objective.failureCondition}`,
	];
	return lines.join("\n");
}

/**
 * Whether a text is a runtime bounded-objective dispatch instruction,
 * recognised by EXACT template equality against a KNOWN objective.
 */
export function isBoundedObjectiveInstruction(
	text: string,
	objective: BoundedObjective,
): boolean {
	if (typeof text !== "string") {
		return false;
	}
	return text === renderBoundedObjectiveInstruction(objective);
}

/**
 * Split a rendered reference list back into its entries.
 */
function splitReferences(value: string): string[] {
	return value
		.split(";")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

/**
 * Parse a runtime bounded-objective dispatch instruction by its EXACT
 * template shape.
 *
 * The compaction task-contract conservation path does NOT know the
 * objective's parameter values, so it cannot use exact template equality.
 * It therefore parses the template's OWN fixed frames and validates each
 * parameter slot against the exact grammar the renderer produces.
 *
 * Returns `undefined` when the text is not a well-formed dispatch.
 */
export function parseBoundedObjectiveInstruction(
	text: string,
): BoundedObjective | undefined {
	if (typeof text !== "string" || text.length === 0) {
		return undefined;
	}
	const prefixEnd = text.indexOf("\n");
	if (prefixEnd === -1) {
		return undefined;
	}
	const headline = text.slice(0, prefixEnd);
	if (!headline.startsWith(BOUNDED_OBJECTIVE_PREFIX)) {
		return undefined;
	}
	const headlineObjective = headline
		.slice(BOUNDED_OBJECTIVE_PREFIX.length)
		.trim();
	if (!headlineObjective.endsWith(BOUNDED_OBJECTIVE_SUFFIX)) {
		return undefined;
	}
	const objectiveText = headlineObjective
		.slice(0, headlineObjective.length - BOUNDED_OBJECTIVE_SUFFIX.length)
		.trim();
	if (objectiveText.length === 0) {
		return undefined;
	}

	const fieldOrder = [
		FIELD_LABELS.parentTask,
		FIELD_LABELS.objective,
		FIELD_LABELS.obligationReferences,
		FIELD_LABELS.firstStep,
		FIELD_LABELS.mutationScope,
		FIELD_LABELS.verificationCondition,
		FIELD_LABELS.evidenceReferences,
		FIELD_LABELS.successCondition,
		FIELD_LABELS.failureCondition,
	];

	const fields = new Map<string, string>();
	for (let index = 0; index < fieldOrder.length; index += 1) {
		const label = fieldOrder[index];
		const marker = `\n${label}: `;
		const at = text.indexOf(marker);
		if (at === -1) {
			return undefined;
		}
		const start = at + marker.length;
		let end = text.length;
		for (let next = index + 1; next < fieldOrder.length; next += 1) {
			const nextAt = text.indexOf(`\n${fieldOrder[next]}: `, start);
			if (nextAt !== -1 && nextAt < end) {
				end = nextAt;
			}
		}
		const value = text.slice(start, end).trim();
		if (value.length === 0) {
			return undefined;
		}
		fields.set(label, value);
	}

	const objective = fields.get(FIELD_LABELS.objective);
	if (objective !== objectiveText) {
		return undefined;
	}

	return {
		parentTaskId: fields.get(FIELD_LABELS.parentTask) as string,
		objective,
		obligationReferences: splitReferences(
			fields.get(FIELD_LABELS.obligationReferences) as string,
		),
		firstStep: fields.get(FIELD_LABELS.firstStep) as string,
		mutationScope: fields.get(FIELD_LABELS.mutationScope) as string,
		verificationCondition: fields.get(
			FIELD_LABELS.verificationCondition,
		) as string,
		evidenceReferences: splitReferences(
			fields.get(FIELD_LABELS.evidenceReferences) as string,
		),
		successCondition: fields.get(FIELD_LABELS.successCondition) as string,
		failureCondition: fields.get(FIELD_LABELS.failureCondition) as string,
	};
}
