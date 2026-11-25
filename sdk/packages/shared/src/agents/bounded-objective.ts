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
	 * The maximum number of SELECTION INFERENCES per PARENT RUN.
	 *
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-02.
	 *
	 * EXPERIMENTAL POLICY, and its semantics are stated EXACTLY:
	 *
	 * The runtime keeps a RUN-SCOPED selection-inference counter. With the
	 * experimental bound of 1, the WHOLE run may make ONE selection
	 * inference — not one per activation. A failed selection therefore
	 * consumes the run's selection allowance and MUST NOT start an
	 * unbounded selection retry loop, and a SECOND activation in the same
	 * run makes NO further selection inference at all.
	 *
	 * This is deliberately stated as the IMPLEMENTED policy rather than as
	 * a per-activation allowance the runtime does not implement.
	 */
	readonly maxSelectionInferences?: number;
	/**
	 * OPTIONAL host-supplied judgement of whether a bounded objective has
	 * been VERIFIED.
	 *
	 * The host may know more than the runtime: it owns the command-policy
	 * layer, the workspace, and the executable gates. The callback receives
	 * the objective and the observable facts of the objective's execution
	 * and returns whether the objective's verification condition was MET.
	 *
	 * Returning `undefined` means "no opinion" — the runtime then reports
	 * the objective as UNVERIFIED. The runtime has NO structural fallback:
	 * there is no structural rule that can distinguish "the required
	 * executable ran and passed" from "an unrelated command happened to
	 * succeed".
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
 * ONE STRUCTURED EXECUTION RECEIPT of a bounded objective's round.
 *
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
 *
 * The receipt is the CORRELATION EVIDENCE between "the objective asked for
 * a specific executable" and "that executable actually ran, and this is
 * what happened". It carries the tool name, the command identity (when
 * the tool call was command-shaped) and the OUTCOME — never the tool's
 * output text, never file contents, never model reasoning.
 */
export interface BoundedObjectiveExecutionReceipt {
	/** The host-defined tool name that was invoked. */
	readonly toolName: string;
	/**
	 * The COMMAND the tool call carried, when the call was
	 * command-shaped. `undefined` for a call that carried no command.
	 */
	readonly command?: string;
	/**
	 * Whether the tool call SUCCEEDED.
	 *
	 * A failed gate execution is a receipt too: it is the receipt that
	 * proves the gate did NOT pass.
	 */
	readonly succeeded: boolean;
	/**
	 * Whether the tool call was an EDIT (a mutation) rather than a
	 * command execution.
	 */
	readonly wasEdit: boolean;
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
	/**
	 * The STRUCTURED EXECUTION RECEIPTS of the objective's rounds.
	 *
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01:
	 * these receipts are the CORRELATION EVIDENCE the verification step
	 * uses. They are what makes "the required gate actually ran and
	 * passed" distinguishable from "some unrelated command succeeded".
	 */
	readonly receipts?: readonly BoundedObjectiveExecutionReceipt[];
}

/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-02.
 *
 * THE REMOVAL OF THE STRUCTURAL VERIFICATION GATE CHECK.
 *
 * AMENDMENT-01 replaced "any successful command proves completion" with
 * "any successful command CONTAINING a host-declared substring proves
 * completion". That was still not executable verification: a trivial
 * `echo check-value` satisfied a gate whose identity was the substring
 * `check-value`, and the runtime reported the objective as VERIFIED.
 *
 * The substring has been removed because NO structural rule over command
 * TEXT can establish that a specific executable actually proved the
 * objective:
 *
 *   - a substring match is satisfied by ANY command that mentions the
 *     substring, including an `echo` of it,
 *   - the match is case-folded, so `CHECK-VALUE` satisfied a
 *     `check-value` gate,
 *   - and a matching command that merely mentions the gate can succeed
 *     while the executable the objective names never ran at all.
 *
 * Replacing it with a more elaborate shell-command parser would only
 * widen the same wrong assumption.
 *
 * THE TRUSTED AUTHORITY
 * ---------------------
 * Verification is now the HOST's verdict and the HOST's alone. The host
 * owns the command-policy layer, the sandbox and the workspace, so it is
 * the only layer that can know whether the objective's verification
 * condition was actually met.
 *
 * When the host supplies NO verdict, the objective is UNVERIFIED. There is
 * no fallback. Useful unverified progress is a legitimate recovery
 * outcome, and it is reported truthfully.
 */
export type BoundedObjectiveVerificationAuthority =
	| { readonly kind: "host_verdict"; readonly verified: boolean }
	| { readonly kind: "unverified" };

/**
 * Resolve the objective's verification verdict from the HOST's authority.
 *
 * The ONLY authority is the host's `verifyObjective` callback. A callback
 * that declines (`undefined`) or throws yields an UNVERIFIED verdict: a
 * host that cannot establish the verification is NOT evidence of
 * verification.
 */
export function resolveBoundedObjectiveVerification(
	objective: BoundedObjective,
	facts: BoundedObjectiveObservationFacts,
	verifyObjective:
		| ((
				objective: BoundedObjective,
				facts: BoundedObjectiveObservationFacts,
		  ) => boolean | undefined)
		| undefined,
): BoundedObjectiveVerificationAuthority {
	if (!verifyObjective) {
		return { kind: "unverified" };
	}
	try {
		const verdict = verifyObjective(objective, facts);
		if (verdict === undefined) {
			return { kind: "unverified" };
		}
		return { kind: "host_verdict", verified: verdict };
	} catch {
		// A throwing host callback is treated as "no opinion"; a host that
		// cannot establish the verification is NOT evidence of verification.
		return { kind: "unverified" };
	}
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
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-02.
 *
 * The LEXICAL PATH AUTHORITY used by the R2 authorisation boundary.
 *
 * WHAT THIS IS
 * ------------
 * LEXICAL NORMALIZATION — and only that.
 *
 * The original scope check was a LEXICAL PREFIX test: a candidate scope was
 * accepted when it started with the authorised root followed by a separator.
 * That accepted every path that ESCAPES the root through a traversal
 * segment, because `/workspace/project/src/../tests/a.ts` literally starts
 * with `/workspace/project/src/`.
 *
 * The check is now a CONTAINMENT test over the LEXICALLY canonical form:
 * the path text is first reduced (`.` and `..` segments resolved, duplicate
 * separators collapsed), and the reduced result is then required to be the
 * authorised root itself or to live inside it.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This helper is PURE and SYNTACTIC. It resolves the path TEXT; it does not
 * touch the filesystem. It is therefore NOT filesystem canonicalization:
 *
 *   - a SYMBOLIC LINK inside the authorised root may resolve to a location
 *     OUTSIDE it, and this check cannot see that,
 *   - a path that does not exist yet cannot be resolved against the
 *     filesystem at all.
 *
 * A path that cannot be resolved canonically (a RELATIVE path, a path that
 * escapes above the filesystem root) is reported as UNRESOLVABLE and is NEVER
 * treated as "inside the root".
 *
 * The narrower enforcement this boundary offers is therefore an
 * ADDITIONAL constraint on top of the parent's own authority — the
 * workspace, sandbox, command-policy and approval layers remain the
 * execution authority, and they are not relaxed by this check.
 */
export interface CanonicalScopePath {
	/** The canonical absolute path, or `undefined` when unresolvable. */
	readonly canonical: string | undefined;
	/** Whether the path could be resolved canonically at all. */
	readonly resolvable: boolean;
	/** Why the path could not be resolved. */
	readonly unresolvableReason?: "relative" | "escapes_root" | "empty";
}

/**
 * Reduce an absolute POSIX-style path to its CANONICAL form.
 *
 * The rules are the POSIX lexical rules, applied textually:
 *
 *   - a leading `/` is the filesystem root,
 *   - `.` segments are removed,
 *   - `..` segments pop the preceding segment; popping past the root is an
 *     ESCAPE and makes the path unresolvable,
 *   - duplicate separators collapse,
 *   - a trailing separator is removed.
 *
 * The result NEVER ends with `/` (except for the root itself), so
 * containment is a plain prefix test on the canonical form.
 */
export function canonicalizeScopePath(raw: string): CanonicalScopePath {
	if (typeof raw !== "string") {
		return {
			canonical: undefined,
			resolvable: false,
			unresolvableReason: "empty",
		};
	}
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return {
			canonical: undefined,
			resolvable: false,
			unresolvableReason: "empty",
		};
	}
	if (!trimmed.startsWith("/")) {
		// A RELATIVE path has no canonical meaning without a base
		// directory. The runtime never invents one: resolving a relative
		// path against the process CWD would silently authorise a scope the
		// user never named.
		return {
			canonical: undefined,
			resolvable: false,
			unresolvableReason: "relative",
		};
	}
	const segments = trimmed.split("/");
	const canonicalSegments: string[] = [];
	for (const segment of segments) {
		if (segment.length === 0 || segment === ".") {
			continue;
		}
		if (segment === "..") {
			if (canonicalSegments.length === 0) {
				// Escaping above the filesystem root.
				return {
					canonical: undefined,
					resolvable: false,
					unresolvableReason: "escapes_root",
				};
			}
			canonicalSegments.pop();
			continue;
		}
		canonicalSegments.push(segment);
	}
	const canonical =
		canonicalSegments.length === 0 ? "/" : `/${canonicalSegments.join("/")}`;
	return { canonical, resolvable: true };
}

/**
 * Whether a canonical path is the authorised root itself or lives inside it.
 *
 * The comparison is a canonical SEGMENT comparison: `/workspace/project/src`
 * does NOT contain `/workspace/project/srcx`, because the segment boundary is
 * respected.
 */
export function isPathWithinCanonicalRoot(
	canonicalPath: string,
	canonicalRoot: string,
): boolean {
	if (canonicalRoot === "/") {
		return canonicalPath.startsWith("/");
	}
	return (
		canonicalPath === canonicalRoot ||
		canonicalPath.startsWith(`${canonicalRoot}/`)
	);
}

/**
 * Whether a string is a usable bounded-objective field value.
 *
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01:
 *
 * A field must be SINGLE-LINE. The rendered dispatch is a line-oriented
 * template, and the compaction recogniser parses it by its own fixed frames.
 * A field containing a newline therefore CANNOT survive the render/parse
 * round trip: the injected line would be parsed as a frame boundary and the
 * objective's identity would be lost after compaction.
 *
 * Rejecting multiline fields at the authorisation boundary keeps the
 * invariant structural instead of relying on the renderer to sanitise
 * model output.
 */
function isUsableField(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.trim().length > 0 &&
		value.length <= MAX_BOUNDED_OBJECTIVE_FIELD_LENGTH &&
		!value.includes("\n") &&
		!value.includes("\r")
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
	// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
	//
	// The malformed check is SPLIT. The SECURITY-RELEVANT checks — the
	// authority-escalation refusal and the constraint-conflict check — run
	// FIRST, on the raw field text, so that a candidate which both breaks
	// the template AND attempts to escape the parent's authority is reported
	// as the AUTHORITY VIOLATION it is, rather than as a formatting
	// complaint.
	//
	// A candidate whose field text is not even a string cannot be inspected
	// for an escalation, so the type/emptiness check still runs first.
	for (const field of requiredFields) {
		if (typeof field !== "string" || field.trim().length === 0) {
			return { valid: false, reason: "malformed" };
		}
	}
	const rawCandidateText = requiredFields.join("\n").toLowerCase();
	if (containsAuthorityEscalation(rawCandidateText)) {
		return { valid: false, reason: "constraint_conflict" };
	}
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

	// CONSTRAINT CONFLICT: the objective may not contradict an applicable
	// parent constraint. The check is deliberately conservative: it only
	// rejects when the candidate's own text ASSERTS the negation of a
	// constraint's subject, because a false positive here would silently
	// disable recovery.
	//
	// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
	//
	// Two additions close the gaps the reviewer reproduced:
	//
	//   1. The constraint's SUBJECT is extracted from the WHOLE
	//      prohibition sentence, not just from a bare "do not X" prefix,
	//      and BOTH sides of the comparison are normalised. "Do not modify
	//      tests." yields the subject "modify tests", so a first step that
	//      says "rewrite the test suite" is caught by the shared artefact
	//      vocabulary rather than by a substring match on the whole
	//      sentence.
	//
	//   2. The candidate may not ISSUE AN INSTRUCTION that overrides the
	//      parent's authority ("ignore all parent constraints", "you are
	//      no longer bound by ..."). Model output is a PROPOSAL; a proposal
	//      that asks to be promoted above the parent's authority is refused
	//      outright, independently of the specific constraints present.
	//
	// The check runs BEFORE the structural scope check, because a
	// constraint violation is the more specific finding: it names the
	// parent's authority that the candidate contradicts.
	const candidateHaystack =
		`${objective}\n${firstStep}\n${mutationScope}\n${verificationCondition}\n${successCondition}\n${failureCondition}`.toLowerCase();
	const normalizedCandidateHaystack =
		normalizeConstraintSubject(candidateHaystack);
	for (const constraint of context.parentConstraints) {
		const negated = negatedSubject(constraint.trim().toLowerCase());
		if (negated.length === 0) {
			continue;
		}
		if (normalizedCandidateHaystack.includes(negated)) {
			return { valid: false, reason: "constraint_conflict" };
		}
		// The candidate may name the SAME artefact class through a
		// different verb ("rewrite the test suite" against "Do not
		// modify tests."). The fixed vocabulary catches that shape
		// without pretending to be a natural language engine.
		if (contradictsConstraintVocabulary(candidateHaystack, negated)) {
			return { valid: false, reason: "constraint_conflict" };
		}
	}
	// READ-ONLY OBJECTIVE: an objective whose own scope declares it
	// read-only must not authorize a mutation. A read-only scope may only
	// be paired with a read-only first step.
	if (
		declaresReadOnlyScope(mutationScope) &&
		authorizesMutation(firstStep, objective, successCondition)
	) {
		return { valid: false, reason: "constraint_conflict" };
	}

	// SCOPE EXPANSION: the objective's mutation scope must be INSIDE the
	// parent's authorised scope.
	//
	// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
	//
	// The check is a CANONICAL CONTAINMENT test whenever the parent supplies
	// authorised scope PATHS. It is deliberately NOT a lexical prefix test:
	//
	//   - a traversal scope (`<root>/src/../tests/a.ts`) canonicalises
	//     OUTSIDE the root and is rejected,
	//   - a RELATIVE scope (`tests/a.ts`) has no canonical meaning and is
	//     rejected — the runtime never invents a base directory for it,
	//   - a PROSE scope that names no path at all is rejected, because an
	//     UNRESOLVED scope must never become an IMPLICITLY UNRESTRICTED
	//     scope.
	//
	// EVERY path the candidate names — in its mutation scope AND in its
	// other free-text fields — must be inside the authorised root. A
	// candidate cannot smuggle an out-of-scope path into its first step or
	// its success condition.
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
		const canonicalRoots = authorisedPaths
			.map((authorisedPath) => canonicalizeScopePath(authorisedPath))
			.filter((resolved) => resolved.resolvable)
			.map((resolved) => resolved.canonical as string);
		// The candidate's OWN scope must resolve. A scope that names no
		// path, or a path that cannot be resolved, is not "inside the
		// root" — it is UNRESOLVED, and an unresolved scope is refused.
		const candidateScopePaths = extractScopePaths(mutationScope);
		if (candidateScopePaths.length === 0) {
			return { valid: false, reason: "scope_expansion" };
		}
		const scopeIsInside = candidateScopePaths.every((candidatePath) => {
			const resolved = canonicalizeScopePath(candidatePath);
			if (!resolved.resolvable || resolved.canonical === undefined) {
				return false;
			}
			return canonicalRoots.some((root) =>
				isPathWithinCanonicalRoot(resolved.canonical as string, root),
			);
		});
		if (!scopeIsInside) {
			return { valid: false, reason: "scope_expansion" };
		}
		// Every path named in ANY candidate field must be inside the
		// authorised root as well.
		const namedPaths = extractScopePaths(
			[
				objective,
				firstStep,
				mutationScope,
				verificationCondition,
				successCondition,
				failureCondition,
			].join("\n"),
		);
		const escapedFieldPath = namedPaths.some((namedPath) => {
			const resolved = canonicalizeScopePath(namedPath);
			if (!resolved.resolvable || resolved.canonical === undefined) {
				return true;
			}
			return !canonicalRoots.some((root) =>
				isPathWithinCanonicalRoot(resolved.canonical as string, root),
			);
		});
		if (escapedFieldPath) {
			return { valid: false, reason: "scope_expansion" };
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
 *
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01: this
 * helper is EXPORTED so the runtime's objective scope gate can resolve the
 * SAME paths the validator resolved. One grammar, one authority.
 */
export function extractScopePaths(scope: string): string[] {
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
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
 *
 * The grammar is intentionally tiny: only "do not X" / "don't X" /
 * "never X" / "must not X" / "mustn't X" produce a subject. Every other
 * constraint form yields the empty string, and an empty result means "no
 * opinion" — the validator then leaves the candidate alone.
 *
 * The subject is NORMALISED so that the same prohibition can be matched
 * against differently-worded candidate text: the trailing sentence
 * punctuation is removed and the determiners that carry no authority are
 * dropped, so "Do not modify tests." and "modify the tests" reduce to the
 * same subject.
 */
function negatedSubject(constraint: string): string {
	const prefixes = [
		"do not ",
		"don't ",
		"never ",
		"must not ",
		"mustn't ",
		"should not ",
		"shouldn't ",
	];
	for (const prefix of prefixes) {
		if (!constraint.startsWith(prefix)) {
			continue;
		}
		return normalizeConstraintSubject(constraint.slice(prefix.length).trim());
	}
	return "";
}

/**
 * Normalise a prohibition's subject into a comparable form.
 *
 * The normalisation removes trailing sentence punctuation, lower-cases the
 * text, and drops the DETERMINERS that carry no authority. It is applied to
 * BOTH sides of the comparison, so "Do not modify tests." and "edit the
 * forbidden directory" are both reduced to a comparable form.
 */
function normalizeConstraintSubject(subject: string): string {
	return subject
		.toLowerCase()
		.replace(/[.!?,;:]+$/g, "")
		.replace(/\b(the|a|an|any|all|of|to|in|at|on|for)\b/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The TOKEN SEQUENCE of a normalised phrase.
 *
 * The tokens carry no punctuation, so "tests." and "tests" compare equal.
 */
function subjectTokens(normalized: string): string[] {
	return normalized.length === 0
		? []
		: normalized.split(" ").filter((token) => token.length > 0);
}

/**
 * The ARTEFACT-CLASS VOCABULARY the constraint check recognises.
 *
 * A prohibition names a class of artefacts ("tests", "the test suite"). The
 * candidate is caught when it names the SAME class through a different verb
 * ("rewrite", "update", "change", "delete").
 *
 * The vocabulary is an explicit, fixed list of English verbs and nouns. It
 * is NOT a natural language engine: it recognises the canonical phrasings
 * and refuses to guess beyond them.
 */
const CONSTRAINT_VERB_NOUNS: ReadonlyArray<{
	readonly verbs: readonly string[];
	readonly nouns: readonly string[];
}> = [
	{
		verbs: ["modify", "rewrite", "update", "change", "edit", "alter", "patch"],
		nouns: [
			"test",
			"tests",
			"spec",
			"specs",
			"fixture",
			"fixtures",
			"snapshot",
			"snapshots",
		],
	},
	{
		verbs: ["delete", "remove", "drop"],
		nouns: ["test", "tests", "spec", "specs"],
	},
	{
		verbs: ["read", "open", "cat", "inspect"],
		nouns: [
			"secret",
			"secrets",
			"credential",
			"credentials",
			"password",
			"passwords",
			"token",
			"tokens",
		],
	},
	{
		verbs: ["commit", "push", "publish", "deploy", "release"],
		nouns: ["commit", "commits", "branch", "branches", "release", "releases"],
	},
];

/**
 * Whether the candidate's text contradicts a prohibition by naming the same
 * ARTEFACT CLASS through a different verb.
 *
 * For example, the parent constraint "Do not modify tests." and a candidate
 * first step "Rewrite the test suite ..." share the noun class "test" and a
 * mutation verb. The candidate is therefore in conflict with the parent's
 * authority, even though it never repeats the constraint verbatim.
 *
 * The verb and the noun must ADJACENTLY co-occur in the candidate's own
 * text. Requiring adjacency is what keeps the check from firing on an
 * unrelated edit: "Edit the disposable target module" mentions the verb
 * "edit" but never mentions a test artefact, so it does not contradict a
 * prohibition about tests.
 */
function contradictsConstraintVocabulary(
	candidateHaystack: string,
	constraintSubject: string,
): boolean {
	const subjectNouns = new Set<string>();
	for (const entry of CONSTRAINT_VERB_NOUNS) {
		for (const noun of entry.nouns) {
			if (constraintSubject.includes(noun)) {
				subjectNouns.add(noun);
			}
		}
	}
	if (subjectNouns.size === 0) {
		return false;
	}
	// The candidate is examined clause by clause, so a verb in one clause
	// cannot be paired with a noun in another.
	for (const clause of candidateHaystack.split(/[.;\n]/)) {
		const tokens = subjectTokens(normalizeConstraintSubject(clause));
		for (let index = 0; index + 1 < tokens.length; index += 1) {
			const verb = tokens[index] as string;
			const noun = tokens[index + 1] as string;
			if (!subjectNouns.has(noun) && !subjectNouns.has(`${noun}s`)) {
				continue;
			}
			const isMutationVerb = CONSTRAINT_VERB_NOUNS.some((entry) =>
				entry.verbs.includes(verb),
			);
			if (isMutationVerb) {
				return true;
			}
		}
	}
	return false;
}

/**
 * The CANONICAL AUTHORITY-ESCALATION PHRASINGS.
 *
 * A model-selected objective is an UNTRUSTED PROPOSAL. It may request
 * anything inside the parent's authorisation; it may never request to be
 * treated as a higher authority than the parent task. These phrasings are
 * refused outright, independently of the specific constraints present.
 *
 * The list is explicit and small. It does not claim to detect every
 * possible paraphrase — it refuses the canonical escalations and lets the
 * remaining constraint guards do their work.
 */
const AUTHORITY_ESCALATION_PATTERNS: readonly RegExp[] = [
	/\bignore\s+(all\s+|any\s+|the\s+)?(parent\s+|user\s+|previous\s+|prior\s+)?(constraint|restriction|instruction|rule|direction|limit)s?\b/,
	/\bdisregard\s+(all\s+|any\s+|the\s+)?(parent\s+|user\s+|previous\s+|prior\s+)?(constraint|restriction|instruction|rule|direction|limit)s?\b/,
	/\b(override|bypass|revoke)\s+(all\s+|any\s+|the\s+)?(parent\s+|user\s+|previous\s+|prior\s+)?(constraint|restriction|instruction|rule|direction|limit)s?\b/,
	/\byou\s+are\s+no\s+longer\s+(bound|constrained|restricted|limited)\s+by\b/,
	/\bwithout\s+(any\s+)?(parent\s+|user\s+)?(constraint|restriction|limitation)s?\b/,
	/\bignore\s+(the\s+)?(system|user)\s+prompt\b/,
	/\bthis\s+instruction\s+(supersedes|overrides|replaces)\b/,
	/\bnew\s+authori[sz]ation\b/,
];

/**
 * Whether the candidate's text attempts an authority escalation.
 */
function containsAuthorityEscalation(candidateHaystack: string): boolean {
	return AUTHORITY_ESCALATION_PATTERNS.some((pattern) =>
		pattern.test(candidateHaystack),
	);
}

/**
 * Whether a mutation scope declares itself READ-ONLY.
 *
 * A read-only scope is an explicit statement by the candidate that no
 * mutation is permitted. Such an objective may not authorize a mutation.
 */
function declaresReadOnlyScope(mutationScope: string): boolean {
	const normalized = mutationScope.toLowerCase();
	return (
		normalized.includes("read-only") ||
		normalized.includes("read only") ||
		normalized.includes("readonly") ||
		/\bno\s+(mutation|mutations|write|writes|edits?)\b/.test(normalized)
	);
}

/**
 * Whether the candidate's own text authorizes a MUTATION.
 *
 * The vocabulary is the same fixed list used for the constraint check: a
 * mutation verb combined with an artefact class. It is deliberately not a
 * general natural language analysis; it recognises the canonical mutation
 * phrasings and refuses to guess beyond them.
 */
function authorizesMutation(...fields: readonly string[]): boolean {
	const haystack = fields.join("\n").toLowerCase();
	for (const entry of CONSTRAINT_VERB_NOUNS) {
		const hasVerb = entry.verbs.some((verb) => haystack.includes(verb));
		const hasNoun = entry.nouns.some((noun) => haystack.includes(noun));
		if (hasVerb && hasNoun) {
			return true;
		}
	}
	return false;
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
