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
	/**
	 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
	 *
	 * The objective cited a PARENT OBLIGATION REFERENCE that the runtime
	 * never offered.
	 *
	 * This is a REFERENCE-VALIDATION failure. It is deliberately a DISTINCT
	 * reason from `unsupported_completion_claim`: an unknown reference says
	 * nothing about whether the objective falsely claims completion. Folding
	 * the two together made every reference mistake look like an attempted
	 * completion fabrication, which is both a false diagnosis and a false
	 * accusation against the model's proposal.
	 */
	| "unknown_obligation_reference"
	/** The objective claimed an outstanding obligation is already satisfied. */
	| "unsupported_completion_claim";

// ---------------------------------------------------------------------------
// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01
//
// THE PARENT-OBLIGATION REFERENCE VOCABULARY.
//
// WHY THIS EXISTS
// ---------------
// The R2 selection context used to enumerate the parent's OUTSTANDING
// OBLIGATIONS as the runtime's TERMINAL-COMPLETION sentence alone:
//
//   "Call the terminal completion tool submit_and_exit only after every
//    parent obligation is satisfied"
//
// That is the parent's COMPLETION MECHANICS, not its ENGINEERING WORK. The
// parent's concrete requirements (the ones the user actually asked for) were
// therefore absent from the reference vocabulary, and the selection could not
// cite them. The frozen live witness
// (`cap_run_kR2y9UwW_ca62cf1370aaed21.ai_sdk_prompt.1.provider-request.json`)
// shows exactly that: a parent task carrying requirements A1, A2 and A3, and
// a selection context whose ONLY outstanding obligation was the terminal
// completion sentence.
//
// The reference vocabulary corrects this WITHOUT introducing a task
// decomposition subsystem and WITHOUT any additional inference:
//
//   - the RUNTIME derives a small, STABLE vocabulary from the parent's OWN
//     user-authored text,
//   - the vocabulary is a set of REFERENCES (identifiers), never invented
//     sub-obligations,
//   - the selection cites a reference id; the validator resolves that id
//     against the vocabulary the runtime offered.
//
// The vocabulary is therefore a PROJECTION of the parent's own words, not a
// new statement of what the parent owes.
//
// WHAT THE IDENTIFIERS ARE
// ------------------------
// A reference id has the shape `parent-task:<key>`:
//
//   - `parent-task:original` — the original authorized parent task as a
//     whole. It is ALWAYS present, so a parent whose text carries no
//     recognisable requirement headings still has an honest, explicit
//     reference to its own authorized task.
//   - `parent-task:<KEY>` — one requirement heading the parent task itself
//     named, where `<KEY>` is the heading's own label (`A1`, `A2`, `A3`,
//     ...). The KEY is the parent's own text, not a runtime invention.
//
// The KEY is derived STRUCTURALLY from a markdown ATX heading:
//
//   ## A1 — Preserve original exception authority
//   ### A2. Preserve explicit optional zero metrics
//   ## B1 - Another requirement
//
// A heading's label is the leading token of the heading text when it looks
// like a short requirement label (`A1`, `A2.3`, `B-1`, `REQ-7`). A heading
// with no such label contributes NO reference: the runtime does not invent an
// identifier for a requirement the parent did not label.
//
// WHAT THE VOCABULARY DOES NOT DO
// -------------------------------
//   - it does NOT claim any sub-obligation is satisfied or outstanding in
//     the model's sense — it only says "this requirement exists in the
//     parent's own text",
//   - it does NOT decompose the parent into a task graph,
//   - it does NOT add inference: it is a structural scan of the parent's
//     own text,
//   - it does NOT relax the parent's authority: the parent's scope,
//     constraints, tools and sandbox remain exactly as they were.
// ---------------------------------------------------------------------------

/**
 * The stable id of the ORIGINAL authorized parent task.
 *
 * It is always part of the vocabulary, so the reference projection never
 * degenerates into "no reference at all".
 */
export const PARENT_TASK_ORIGINAL_REFERENCE_ID = "parent-task:original";

/**
 * The prefix every runtime-owned parent-obligation reference id carries.
 */
export const PARENT_TASK_REFERENCE_ID_PREFIX = "parent-task:";

/**
 * ONE reference into the parent's own authored requirements.
 */
export interface ParentObligationReference {
	/**
	 * The stable identifier the selection cites.
	 *
	 * Stable means: the SAME parent text always yields the SAME id, so the
	 * reference survives a compaction and can be validated by exact
	 * equality.
	 */
	readonly id: string;
	/**
	 * The parent's OWN label for the requirement.
	 *
	 * It is the heading text the parent authored, reproduced verbatim. It is
	 * display context for the model; the AUTHORITY of the reference is the
	 * id, never the label.
	 */
	readonly label: string;
}

/**
 * The maximum number of requirement references the runtime will offer.
 *
 * The vocabulary is deliberately SMALL. It is a reference list, not a
 * decomposition of the parent: an unbounded list would turn the selection
 * context into a plan.
 */
export const MAX_PARENT_OBLIGATION_REFERENCE_COUNT = 16;

/**
 * Whether a token looks like a REQUIREMENT LABEL.
 *
 * The grammar is intentionally tiny: a short run of letters/digits with
 * optional separators, of which at least one character is a digit.
 *
 * "A1" -> yes, "A2.3" -> yes, "B-1" -> yes, "REQ-7" -> yes,
 * "Verification" -> no (no digit), "Do" -> no, "12" -> no (no letter).
 *
 * It is NOT a natural language engine: it recognises the canonical
 * requirement-label shape and refuses to guess beyond it.
 */
function isRequirementLabel(token: string): boolean {
	return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]+(?:[.\-_][A-Za-z0-9]+)*$/.test(
		token,
	);
}

/**
 * Extract the requirement label from a markdown ATX heading's text.
 *
 * Returns `undefined` when the heading carries no recognisable label.
 */
function requirementLabelOf(headingText: string): string | undefined {
	const trimmed = headingText.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	// The label is the leading token, optionally followed by a separator
	// (`A1 —`, `A1.`, `A1 -`, `A1:`).
	const match =
		/^([A-Za-z0-9]+(?:[.\-_][A-Za-z0-9]+)*)\s*(?:[.—–\-:.)]|$)/.exec(trimmed);
	const token = match?.[1];
	if (!token || !isRequirementLabel(token)) {
		return undefined;
	}
	return token;
}

/**
 * Build the runtime-owned PARENT-OBLIGATION REFERENCE VOCABULARY from the
 * parent's own user-authored text.
 *
 * The function is PURE and never throws.
 *
 * It ALWAYS returns at least `parent-task:original`, and it adds one
 * reference per REQUIREMENT-HEADED section the parent itself labelled.
 *
 * It performs NO inference and NO decomposition: it scans the parent's own
 * text for its own headings. A parent that names no labelled requirement
 * yields exactly one reference — an honest representation of "the parent's
 * concrete obligations are not individually enumerable from its text", with
 * an explicit reference to the original authorized parent task.
 */
export function buildParentObligationReferences(
	parentText: string,
): ParentObligationReference[] {
	const references: ParentObligationReference[] = [
		{
			id: PARENT_TASK_ORIGINAL_REFERENCE_ID,
			label: "The original authorized parent task (user authority)",
		},
	];
	if (typeof parentText !== "string" || parentText.trim().length === 0) {
		return references;
	}
	const seenIds = new Set<string>(references.map((entry) => entry.id));
	const seenLabels = new Set<string>();
	for (const line of parentText.split(/\r?\n/)) {
		const heading = /^#{1,6}\s+(.*)$/.exec(line);
		if (!heading) {
			continue;
		}
		const headingText = (heading[1] ?? "").trim();
		const label = requirementLabelOf(headingText);
		if (!label) {
			continue;
		}
		if (seenLabels.has(label)) {
			// The parent repeated the label: the FIRST occurrence wins, so the
			// vocabulary stays a set rather than an accumulating list.
			continue;
		}
		seenLabels.add(label);
		const id = `${PARENT_TASK_REFERENCE_ID_PREFIX}${label}`;
		if (seenIds.has(id)) {
			continue;
		}
		seenIds.add(id);
		references.push({ id, label: headingText });
		if (references.length >= MAX_PARENT_OBLIGATION_REFERENCE_COUNT) {
			break;
		}
	}
	return references;
}

/**
 * Whether a string is a well-formed runtime-owned parent-obligation
 * reference id.
 */
export function isParentObligationReferenceId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.startsWith(PARENT_TASK_REFERENCE_ID_PREFIX) &&
		value.length > PARENT_TASK_REFERENCE_ID_PREFIX.length
	);
}

/**
 * ONE OBSERVED FACT about the R2 selection boundary.
 *
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
 *
 * The frozen live witness proved that the EXISTING provider-request capture
 * observes the selection REQUEST but not the selection RESPONSE: the live
 * selector's reply was unavailable, so the historical rejection cause could
 * not be recovered.
 *
 * These facts are the SMALLEST set that makes the next live discriminator
 * decidable:
 *
 *   - the correlation identity of the run,
 *   - the identity of the selector request that was dispatched,
 *   - the GENERATED objective text (the model's own reply),
 *   - the PARSED objective proposal (the JSON object the runtime parsed),
 *   - the EXACT validation disposition and the failing field or reference.
 *
 * What is DELIBERATELY absent:
 *
 *   - provider-owned reasoning text or signatures,
 *   - credentials,
 *   - unrelated transcript contents,
 *   - any inference about whether the objective was semantically aligned.
 */
export interface BoundedObjectiveSelectionObservation {
	/** The run id the selection belonged to. */
	readonly runId?: string;
	/** The agent id the selection belonged to. */
	readonly agentId?: string;
	/** The parent task the selection was derived from. */
	readonly parentTaskId: string;
	/**
	 * The identity of the SELECTOR REQUEST that was dispatched.
	 *
	 * It is the runtime's own selection-inference ordinal for the run, so
	 * it joins the observation to the captured provider request.
	 */
	readonly selectionOrdinal: number;
	/**
	 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01):
	 * the EXACT identity of the SELECTOR REQUEST, as the EXISTING
	 * provider-request capture names it.
	 *
	 * The runtime mints this id and puts it in the selection request's
	 * transport metadata under the EXISTING `captureId` key. The existing
	 * provider-request capture (`sdk/packages/llms/src/providers/
	 * provider-request-capture.ts`) already honours an explicit
	 * `correlation.captureId`, so the CAPTURED REQUEST FILE is named
	 * `<selectorRequestId>.ai_sdk_prompt.<n>.provider-request.json`.
	 *
	 * The captured RESPONSE artifact carries the SAME id, so the response
	 * joins to its request by EXACT IDENTITY — not by timestamp proximity
	 * and not merely by a non-empty parent-task identifier.
	 */
	readonly selectorRequestId?: string;
	/**
	 * The GENERATED objective text — the model's raw reply to the selector
	 * request.
	 *
	 * It is the model's own output, never provider-owned reasoning.
	 */
	readonly generatedText: string;
	/**
	 * The PARSED objective proposal, when the runtime could parse one.
	 */
	readonly parsedProposal?: unknown;
	/**
	 * The EXACT validation disposition.
	 *
	 * `"valid"` when the objective was accepted; the rejection reason when
	 * it was not; `"unparsable"` when the reply yielded no candidate.
	 */
	readonly disposition:
		| "valid"
		| "unparsable"
		| BoundedObjectiveRejectionReason;
	/**
	 * The failing FIELD or REFERENCE, when the disposition was a rejection.
	 *
	 * It names the specific field or reference that failed, so the next
	 * live discriminator does not have to re-derive it from the proposal.
	 */
	readonly failingField?: string;
	/**
	 * The failing REFERENCE, when the disposition was a reference
	 * rejection.
	 */
	readonly failingReference?: string;
}

/**
 * The OPT-IN, HOST-SUPPLIED observation sink for the R2 selection
 * boundary.
 *
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
 *
 * DEFAULT OFF: the sink is ABSENT unless a host supplies one, and the
 * runtime pays a single null check at the boundary.
 *
 * It is READ-ONLY: the runtime reports facts and never reads a decision
 * back, so the sink can never influence the selection, the validation, or
 * the completion authority.
 */
export interface BoundedObjectiveSelectionTraceSink {
	/**
	 * Report ONE observed selection-boundary fact.
	 *
	 * The implementation MUST NOT throw. A throwing sink is swallowed by
	 * the runtime.
	 */
	onSelectionObservation?: (
		observation: BoundedObjectiveSelectionObservation,
	) => void | Promise<void>;
}

/**
 * The DIAGNOSIS of a rejected bounded objective: WHICH field or reference
 * failed.
 *
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
 *
 * The validator reports a REASON; this function reports the SPECIFIC field
 * or reference that failed, so the next live discriminator does not have to
 * re-derive it from the proposal.
 *
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01):
 * `failingField` is present ONLY when the VALIDATOR ESTABLISHES that
 * particular field. Where the validator does NOT establish a single field,
 * `failingField` is OMITTED. An omitted field is an HONEST "the validator
 * did not establish which field failed"; it is not a claim that some other
 * field failed.
 *
 * It is a PURE function and never throws.
 */
export interface BoundedObjectiveRejectionDiagnosis {
	/**
	 * The candidate field that failed, WHEN THE VALIDATOR ESTABLISHED IT.
	 *
	 * It is ABSENT when the rejection reason does not identify one field.
	 */
	readonly failingField?: string;
	/** The candidate reference that failed, when one can be named. */
	readonly failingReference?: string;
}

/**
 * Diagnose WHICH field or reference of a rejected candidate failed.
 *
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01).
 *
 * TRUTHFUL ATTRIBUTION.
 *
 * The rejection REASON is preserved EXACTLY and the RAW proposal is never
 * rewritten. The `failingField` is reported ONLY for the reasons whose
 * check provably runs against ONE named field:
 *
 *   - `unknown_obligation_reference` -> `obligationReferences`
 *     (the reference check reads that list, and the offending reference
 *     can be named),
 *   - `fabricated_evidence` -> `evidenceReferences`
 *     (the evidence check reads that list).
 *
 * The OTHER reasons are raised against a JOINED haystack or against a
 * MULTI-FIELD condition, so the validator does NOT establish one field:
 *
 *   - `constraint_conflict` is raised by the authority-escalation scan over
 *     ALL required fields, by the per-constraint scan over the same joined
 *     haystack, and by the read-only-scope/first-step PAIR. It is not
 *     established to be `firstStep`.
 *   - `scope_expansion` is raised by the candidate's OWN `mutationScope`
 *     AND by a path that appears in ANY of the required fields. It is not
 *     established to be `mutationScope`.
 *   - `unsupported_completion_claim` is raised over the joined
 *     `objective + successCondition + verificationCondition` haystack. It is
 *     not established to be `successCondition`.
 *   - `malformed` is raised against ANY of the six required fields OR
 *     against either reference list. It is not established to be one field,
 *     and it is not established to be the candidate as a whole.
 *
 * For those reasons the diagnosis reports NO field. The raw proposal and
 * the exact reason remain available to the caller, so nothing is lost: the
 * next discriminator can decide the field itself.
 *
 * The diagnosis is STRUCTURAL: it re-runs the reference checks the
 * validator performs and reports the first offending entry. It performs no
 * semantic judgement and never claims that the objective was aligned.
 */
export function describeBoundedObjectiveRejection(
	candidate: unknown,
	reason: BoundedObjectiveRejectionReason,
	context: {
		readonly parentObligationReferences?: readonly ParentObligationReference[];
		readonly outstandingObligations: readonly string[];
	},
): BoundedObjectiveRejectionDiagnosis {
	// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01): a
	// non-object candidate has NO field to attribute, so NO field is
	// reported. The reason itself is preserved by the caller.
	if (typeof candidate !== "object" || candidate === null) {
		return {};
	}
	const raw = candidate as Record<string, unknown>;
	if (reason === "unknown_obligation_reference") {
		const references = Array.isArray(raw.obligationReferences)
			? (raw.obligationReferences as unknown[])
			: [];
		const offered = context.parentObligationReferences ?? [];
		const offeredIds = new Set(offered.map((entry) => entry.id));
		const outstanding = new Set(
			context.outstandingObligations.map((entry) => entry.trim().toLowerCase()),
		);
		for (const reference of references) {
			if (typeof reference !== "string") {
				continue;
			}
			const trimmed = reference.trim();
			if (trimmed.length === 0) {
				continue;
			}
			const resolves =
				offeredIds.size > 0
					? offeredIds.has(trimmed)
					: outstanding.has(trimmed.toLowerCase());
			if (!resolves) {
				return {
					failingField: "obligationReferences",
					failingReference: trimmed,
				};
			}
		}
		return { failingField: "obligationReferences" };
	}
	if (reason === "fabricated_evidence") {
		return { failingField: "evidenceReferences" };
	}
	// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01): the
	// remaining reasons do NOT establish one field, so NO field is
	// reported. Naming one would be a claim the validator never made.
	return {};
}

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
		/**
		 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
		 *
		 * The PARENT-OBLIGATION REFERENCE VOCABULARY the runtime offered to
		 * the selection.
		 *
		 * Each entry is a reference the selection MAY cite. A citation that
		 * resolves against this vocabulary is an AUTHORISED reference; a
		 * citation that does not is a REFERENCE-VALIDATION failure, not
		 * evidence of a false completion claim.
		 *
		 * When the vocabulary is absent the reference check is skipped and
		 * the legacy verbatim-match against `outstandingObligations` applies
		 * — so a host that has not adopted the projection keeps its existing
		 * behaviour.
		 */
		readonly parentObligationReferences?: readonly ParentObligationReference[];
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

	// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
	//
	// PARENT-OBLIGATION REFERENCE RESOLUTION.
	//
	// The historical check compared the cited reference against the
	// OUTSTANDING-OBLIGATION LIST and reported a mismatch as
	// `unsupported_completion_claim`. That conflated two unrelated findings:
	//
	//   1. "this reference does not exist" — a REFERENCE-VALIDATION failure,
	//   2. "this objective falsely asserts that an obligation is already
	//      satisfied" — a COMPLETION-CLAIM failure.
	//
	// The conflation was load-bearing and harmful: the live selection could
	// not cite the parent's real engineering requirement A1 (because A1 was
	// never offered), and the resulting rejection was diagnosed as a false
	// completion claim.
	//
	// When the runtime offers a REFERENCE VOCABULARY, the citation is
	// resolved against THAT vocabulary by exact id equality. An id the
	// runtime never offered is `unknown_obligation_reference` — a distinct,
	// accurate finding.
	//
	// When no vocabulary is offered (a host that has not adopted the
	// projection), the legacy verbatim match against the outstanding list
	// applies unchanged.
	const offeredReferences = context.parentObligationReferences;
	if (offeredReferences && offeredReferences.length > 0) {
		const offeredIds = new Set(offeredReferences.map((entry) => entry.id));
		for (const reference of obligationReferences) {
			const normalizedReference = reference.trim();
			if (normalizedReference.length === 0) {
				continue;
			}
			if (!offeredIds.has(normalizedReference)) {
				return { valid: false, reason: "unknown_obligation_reference" };
			}
		}
	} else {
		for (const reference of obligationReferences) {
			const normalizedReference = reference.trim().toLowerCase();
			if (normalizedReference.length === 0) {
				continue;
			}
			const isOutstanding = context.outstandingObligations.some(
				(obligation) => obligation.trim().toLowerCase() === normalizedReference,
			);
			if (!isOutstanding) {
				return { valid: false, reason: "unknown_obligation_reference" };
			}
		}
	}
	// UNSUPPORTED COMPLETION CLAIM: the objective may not assert that an
	// OUTSTANDING obligation is already satisfied. The obligation the
	// objective advances is, by definition, still outstanding.
	//
	// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
	//
	// The historical check fired on the mere PRESENCE of the completion
	// phrase next to an obligation's text, which produced three defects:
	//
	//   - a FUTURE-ORIENTED success condition ("<obligation> is satisfied
	//     once the focused test reports PASS") was rejected even though it
	//     asserts nothing about the present,
	//   - a NEGATED claim ("<obligation> is NOT satisfied until ...") was
	//     ACCEPTED even though it names the obligation's completion state,
	//   - the ENGLISH completion-phrase vocabulary had to grow to cover
	//     phrasings that the check should never have matched.
	//
	// The check now asks a NARROWER and CORRECT question: does the candidate
	// ASSERT, in the present or the past, that the obligation is complete?
	// The recognised phrase set is UNCHANGED — it is not extended — but it
	// is now applied only to ASSERTED completions.
	const completionClaimHaystack =
		`${objective}\n${successCondition}\n${verificationCondition}`.toLowerCase();
	for (const obligation of context.outstandingObligations) {
		const normalizedObligation = obligation.trim().toLowerCase();
		if (normalizedObligation.length === 0) {
			continue;
		}
		if (
			assertsObligationCompletion(completionClaimHaystack, normalizedObligation)
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
 * The RECOGNISED COMPLETION-PHRASE VOCABULARY.
 *
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01: this list is UNCHANGED.
 * The correction does not extend the English phrase vocabulary; it applies
 * the EXISTING phrases to the RIGHT question (an asserted completion) and
 * rejects negated claims that the historical check let through.
 */
const COMPLETION_PHRASES: readonly string[] = [
	"is satisfied",
	"is complete",
	"is already done",
];

/**
 * The RECOGNISED COMPLETION-PHRASE PATTERN.
 *
 * It matches any of the EXISTING completion phrases, with an OPTIONAL
 * NEGATION word permitted between the auxiliary and the participle
 * ("is NOT satisfied").
 *
 * The pattern adds NO new completion phrase: the alternation is exactly the
 * EXISTING `COMPLETION_PHRASES` list. The optional negation capture group
 * exists so that a NEGATED claim can be recognised as a negated claim
 * rather than being missed entirely (which is how the historical check
 * accepted it).
 */
const COMPLETION_PHRASE_PATTERN = new RegExp(
	`\\b(is)\\s+(not\\s+|never\\s+|no\\s+longer\\s+)?(${COMPLETION_PHRASES.map(
		(entry) => entry.replace(/^is\s+/, ""),
	).join("|")})\\b`,
);

/**
 * The PREFIX that marks an obligation as no longer outstanding.
 *
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01): the
 * PREDECESSOR recognized the SPACED form
 * `no longer outstanding: ${normalizedObligation}` — the separator space is
 * part of the recognized form. The prefix below therefore RETAINS the
 * separator so the predecessor's recognition semantics are conserved
 * EXACTLY. The prefix is a COMPLETION ASSERTION in its own right and
 * carries no negation/future marker of its own.
 */
const NO_LONGER_OUTSTANDING_PREFIX = "no longer outstanding: ";

/**
 * Whether a candidate's text ASSERTS that an obligation is already
 * complete.
 *
 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
 *
 * The historical check asked "does the text CONTAIN `<obligation> is
 * satisfied`?" — a question about SUBSTRING PRESENCE. That is the wrong
 * question: it conflated three different statements.
 *
 *   1. ASSERTED (past or present): "the obligation is satisfied".
 *      -> REJECTED. The objective asserts completion it cannot establish.
 *   2. FUTURE-ORIENTED (conditioned on an observable event that has not
 *      happened): "the obligation is satisfied once the focused test
 *      reports PASS".
 *      -> CONSERVED. A success CONDITION is exactly what the bounded
 *      objective is supposed to carry, and it asserts nothing about the
 *      present. It must not establish that completion HAS occurred.
 *   3. NEGATED: "the obligation is NOT satisfied until the focused test
 *      reports PASS", "the obligation is not yet satisfied".
 *      -> REJECTED. A negated completion claim still names the obligation's
 *      completion state, and it is the shape a candidate uses to assert
 *      that the completion state is already known. It must not be accepted
 *      by accident.
 *
 * The check is deliberately LEXICAL and bounded: it recognises the
 * EXISTING phrase list, plus the EXISTING "no longer outstanding: " prefix
 * (with its separator space), and it classifies the clause in which the
 * phrase occurs. It does not attempt to understand the sentence, and it
 * does not add new English phrases.
 *
 * The function is PURE and never throws.
 */
function assertsObligationCompletion(
	haystack: string,
	normalizedObligation: string,
): boolean {
	// The "no longer outstanding: " form (WITH the separator space the
	// predecessor recognized) is a COMPLETION ASSERTION in its own right
	// and carries no negation/future marker of its own.
	if (
		haystack.includes(`${NO_LONGER_OUTSTANDING_PREFIX}${normalizedObligation}`)
	) {
		return true;
	}
	// The obligation may be separated from the completion phrase by an
	// optional NEGATION ("<obligation> is NOT satisfied"). The scan
	// therefore searches for the obligation, then classifies the phrase
	// that follows it.
	//
	// IMPORTANT: the obligation's OWN text frequently already ends in a
	// completion phrase ("... only after every parent obligation is
	// satisfied"). The phrase occurrence therefore has to be searched
	// STRICTLY AFTER the obligation's own text, otherwise every mention
	// of the obligation would trivially look like a completion claim.
	//
	// The NEGATION may sit BETWEEN the auxiliary and the participle
	// ("is NOT satisfied"), so the search permits an optional negation
	// word inside the phrase span.
	let at = haystack.indexOf(normalizedObligation);
	while (at !== -1) {
		const obligationEnd = at + normalizedObligation.length;
		const afterObligation = haystack.slice(obligationEnd);
		const phraseMatch = COMPLETION_PHRASE_PATTERN.exec(afterObligation);
		if (phraseMatch) {
			const phraseAt = phraseMatch.index;
			const between = afterObligation.slice(0, phraseAt);
			// Only a short, non-substantive span may sit between the
			// obligation and the phrase; otherwise the two texts are
			// unrelated and the match is not a completion claim.
			const spanIsTight =
				between.length <= 32 &&
				!/[a-z0-9]{4,}/.test(between.replace(/\bnot\b/g, ""));
			if (spanIsTight) {
				// The negation may be INSIDE the phrase span ("is not
				// satisfied") or immediately BEFORE it.
				const negated =
					phraseMatch[2] !== undefined || containsNegationMarker(between);
				const conditional = containsFutureConditionMarker(
					haystack.slice(obligationEnd + phraseAt + phraseMatch[0].length),
				);
				// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
				//
				// A FUTURE-ORIENTED condition is CONSERVED: it states what
				// WILL make the objective succeed, and it therefore asserts
				// nothing about the present. The historical check rejected
				// it purely because the completion PHRASE was present.
				//
				// An ASSERTED completion and a NEGATED completion claim are
				// both REJECTED. The negated form is rejected because it
				// still asserts that the obligation's completion state is
				// already known — and the historical check ACCEPTED it by
				// accident, because "is not satisfied" does not contain the
				// substring "is satisfied".
				if (conditional && !negated) {
					// Conserve the future-oriented condition; keep scanning
					// for any other occurrence.
				} else {
					return true;
				}
			}
		}
		at = haystack.indexOf(normalizedObligation, at + 1);
	}
	return false;
}

/**
 * The NEGATION MARKERS the completion-claim classifier recognises.
 *
 * The list is small and explicit. It is NOT extended by this ACT beyond
 * the canonical English negations of a completion statement.
 */
const NEGATION_MARKERS: readonly string[] = ["not", "never", "no longer"];

/**
 * Whether the text contains a negation marker.
 *
 * The marker must appear as a WORD (a token boundary on BOTH sides), so
 * that an obligation whose own text happens to contain the letters "not"
 * (for example "canonicalization") is not mistaken for a negation.
 */
function containsNegationMarker(text: string): boolean {
	for (const marker of NEGATION_MARKERS) {
		let at = text.indexOf(marker);
		while (at !== -1) {
			const before = at === 0 ? " " : (text[at - 1] as string);
			const afterIndex = at + marker.length;
			const after =
				afterIndex >= text.length ? " " : (text[afterIndex] as string);
			if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
				return true;
			}
			at = text.indexOf(marker, at + 1);
		}
	}
	return false;
}

/**
 * The FUTURE-CONDITION MARKERS the completion-claim classifier recognises.
 *
 * A conditional marker makes the completion statement a CONDITION on an
 * event that has not happened yet. It is therefore not an assertion that
 * completion HAS occurred.
 */
const FUTURE_CONDITION_MARKERS: readonly string[] = [
	"once ",
	"when ",
	"after ",
	"if ",
	"unless ",
	"until ",
	"whenever ",
	"as soon as ",
];

/**
 * Whether the text carries a future-condition marker.
 *
 * The marker must appear at a TOKEN BOUNDARY and must be the FIRST
 * meaningful word of the continuation, so that a later clause's conditional
 * ("... is satisfied. The test passes when the module builds") cannot
 * retroactively turn an asserted completion into a condition.
 */
function containsFutureConditionMarker(text: string): boolean {
	const trimmed = text.replace(/^[\s,;:.]+/, "");
	for (const marker of FUTURE_CONDITION_MARKERS) {
		if (trimmed.startsWith(marker)) {
			return true;
		}
	}
	return false;
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
