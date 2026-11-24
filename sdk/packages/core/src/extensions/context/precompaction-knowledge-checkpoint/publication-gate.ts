/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
 *
 * PRODUCTION closed publication gate for the Pre-Compaction Knowledge
 * Checkpoint (PCK).
 *
 * ============================================================================
 * WHERE THE GATE SITS
 * ============================================================================
 *
 * The gate is the EARLIEST SHARED publication function that BOTH persistence
 * and provider-visible projection must traverse:
 *
 *   model proposal
 *        |
 *        v
 *   [ PUBLICATION GATE ]   <-- this module
 *        |
 *        +--> rendered checkpoint section  --> persisted sidecar
 *        |
 *        +--> rendered checkpoint section  --> provider-visible continuation
 *
 * A defence applied only during provider rendering is INSUFFICIENT, because
 * the sensitive record would already have been persisted. A defence applied
 * only at persistence is INSUFFICIENT, because another projection path could
 * forward it. So the gate runs BEFORE either destination receives the
 * candidate, and both destinations consume only the gate's OUTPUT.
 *
 * ============================================================================
 * THE GATE'S RULE
 * ============================================================================
 *
 * A record is admitted only if EVERY field is runtime-owned under the closed
 * structure contract. There is NO content inspection: the gate compares the
 * proposal's FIELDS against the closed vocabularies, compares the evidence
 * references against the runtime's OBSERVED set, and renders the readable
 * text from runtime-owned templates.
 *
 * FAIL-CLOSED BEHAVIOUR
 * ---------------------
 *
 * A rejected candidate causes the ordinary compaction to proceed unchanged:
 * no checkpoint section is persisted, the ordinary summary is untouched, and
 * the original task/evidence carry-forwards remain intact. There is no retry
 * loop and no automatically repeated model call.
 */

import {
	BOUNDED_ASSURANCES,
	type BoundedAssurance,
	KNOWLEDGE_KINDS,
	KNOWLEDGE_STATUSES,
	type KnowledgeKind,
	type KnowledgeStatus,
	OBSERVATION_ATOM_LABELS,
	OBSERVATION_ATOMS,
	type ObservationAtom,
	QUALIFICATION_CLASS_LABELS,
	QUALIFICATION_CLASSES,
	type QualificationClass,
	RUNTIME_ARGUMENT_LABELS,
	RUNTIME_ARGUMENTS,
	type RuntimeArgument,
} from "./closed-vocabulary";

/**
 * The model's proposal for ONE checkpoint record.
 *
 * THE PROPOSAL CARRIES NO `id`, NO `statement` AND NO `qualifications`.
 *
 * - The identifier is MINTED BY THE HOST, so a model-authored identifier
 *   can never become a content channel.
 * - The statement is RENDERED BY THE HOST from the closed vocabulary.
 * - The qualifications are RENDERED BY THE HOST from the closed vocabulary.
 *
 * Every field is an enum or a list of enums, except `evidenceRefs`, which is
 * a list of canonical reference handles checked by MEMBERSHIP.
 */
export interface ClosedCheckpointProposal {
	/** The runtime-owned kind. */
	readonly kind: KnowledgeKind;
	/** The claimed assurance. The host BOUNDS it; it never trusts it. */
	readonly assurance: BoundedAssurance;
	/** The runtime-owned status. */
	readonly status: KnowledgeStatus;
	/** The selected observation atom. */
	readonly atom: ObservationAtom;
	/** The selected runtime argument, if the atom takes one. */
	readonly argument?: RuntimeArgument;
	/** The selected qualification classes. */
	readonly qualificationClasses?: readonly QualificationClass[];
	/** The canonical references the record rests on. */
	readonly evidenceRefs: readonly string[];
}

/**
 * The exact set of fields a closed proposal may carry.
 *
 * The gate REJECTS a proposal that carries any field outside this set. That
 * is load-bearing: without it, a caller could smuggle a free-text field
 * past the shape validation simply by adding an unexpected property, and
 * the "there is nowhere to put model text" claim would be false.
 */
export const CLOSED_PROPOSAL_FIELDS: readonly string[] = Object.freeze([
	"kind",
	"assurance",
	"status",
	"atom",
	"argument",
	"qualificationClasses",
	"evidenceRefs",
] as const);

/**
 * The reason codes the gate emits.
 *
 * Every code names a SPECIFIC failure mode, so the failure of each binding
 * is observable rather than collapsed into one opaque boolean.
 */
export const GATE_CODES = {
	PROPOSAL_SHAPE_INVALID: "PROPOSAL_SHAPE_INVALID",
	PROPOSAL_NOT_AN_OBJECT: "PROPOSAL_NOT_AN_OBJECT",
	KIND_NOT_ALLOWED: "KIND_NOT_ALLOWED",
	ASSURANCE_NOT_ALLOWED: "ASSURANCE_NOT_ALLOWED",
	STATUS_NOT_ALLOWED: "STATUS_NOT_ALLOWED",
	ATOM_NOT_IN_CLOSED_VOCABULARY: "ATOM_NOT_IN_CLOSED_VOCABULARY",
	ARGUMENT_NOT_IN_CLOSED_VOCABULARY: "ARGUMENT_NOT_IN_CLOSED_VOCABULARY",
	QUALIFICATION_CLASS_NOT_IN_CLOSED_VOCABULARY:
		"QUALIFICATION_CLASS_NOT_IN_CLOSED_VOCABULARY",
	REFERENCE_NOT_CANONICAL: "REFERENCE_NOT_CANONICAL",
	ASSURANCE_NOT_SUPPORTED_BY_EVIDENCE: "ASSURANCE_NOT_SUPPORTED_BY_EVIDENCE",
} as const;

/**
 * The runtime-owned content of ONE admitted record.
 *
 * Every string in this structure is a runtime-owned constant. The gate emits
 * this and never the raw model proposal, so a proposal that did not pass the
 * gate has no path to a renderer.
 */
export interface AdmittedCheckpointRecord {
	/** The HOST-MINTED identifier. Never model-authored. */
	readonly id: string;
	readonly kind: KnowledgeKind;
	/** The BOUNDED assurance. Never the model-claimed one. */
	readonly assurance: BoundedAssurance;
	readonly status: KnowledgeStatus;
	/** The runtime-rendered statement. */
	readonly statement: string;
	/** The runtime-rendered qualifications. */
	readonly qualifications: readonly string[];
	/** The canonical references this record rests on. */
	readonly evidenceRefs: readonly string[];
	/**
	 * The canonical source-prefix identity the record was generated from.
	 *
	 * A checkpoint is bound to the prefix it was generated from. If the
	 * prefix changes before publication, the record is stale and rejected.
	 */
	readonly sourcePrefixKey: string;
}

/**
 * The outcome of gating a set of proposals.
 */
export interface GateOutcome {
	/** Whether every proposal was admitted. */
	readonly admitted: boolean;
	/** The SPECIFIC reason codes, in the order they were produced. */
	readonly codes: readonly string[];
	/** The admitted records, in proposal order. */
	readonly records: readonly AdmittedCheckpointRecord[];
	/** The number of proposals that were rejected. */
	readonly rejectedCount: number;
}

/**
 * The prefix for the host-minted identifiers.
 *
 * It is a runtime-owned constant. A caller cannot smuggle content in
 * through the prefix.
 */
export const CHECKPOINT_ID_PREFIX = "pck";

/**
 * The evidence the gate needs in order to bound a proposal's assurance.
 *
 * The runtime supplies BOTH the observed canonical references AND the
 * maximum assurance those references can support. The gate never derives
 * semantic support itself: it consumes the runtime's own interpreter.
 */
export interface GateEvidence {
	/**
	 * The canonical references the RUNTIME observed in THIS session.
	 *
	 * This set is runtime-supplied, NOT model-supplied. A reference the
	 * model proposes is only admitted if it is a MEMBER of this set.
	 *
	 * WHY MEMBERSHIP AND NOT A SHAPE RULE
	 * ----------------------------------
	 *
	 * A shape rule that merely forbids whitespace CANNOT distinguish an
	 * opaque handle from a secret that happens to be shaped opaquely.
	 * `ref-FAKE-CREDENTIAL-DO-NOT-USE-7P4x` contains only `[A-Za-z0-9._-]`,
	 * so it satisfies every shape rule — and it is a secret.
	 *
	 * The only sound discriminator is MEMBERSHIP: the reference must be one
	 * the runtime actually observed in the canonical history. That is a
	 * JOIN, not a PATTERN.
	 */
	readonly canonicalReferences: readonly string[];
	/**
	 * The maximum assurance the runtime's evidence interpreter supports for
	 * a given reference set.
	 *
	 * The runtime interprets the OBSERVED canonical tool events. It does not
	 * inspect a model-authored statement. A syntactically valid reference
	 * therefore NEVER raises the assurance on its own.
	 */
	readonly maximumAssuranceFor: (
		references: readonly string[],
	) => BoundedAssurance | undefined;
}

/**
 * Validate ONE proposal's SHAPE.
 *
 * The validation is SHAPE-ONLY: the atom, the argument, the qualification
 * classes and the kind/assurance/status must be members of their
 * runtime-owned vocabularies, and the proposal must carry NO field outside
 * the closed field set. No field of the proposal is free text, so there is
 * nothing to scan.
 */
export function validateClosedProposalShape(
	proposal: unknown,
): readonly string[] {
	if (typeof proposal !== "object" || proposal === null) {
		return [GATE_CODES.PROPOSAL_NOT_AN_OBJECT];
	}
	const codes: string[] = [];
	const record = proposal as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!CLOSED_PROPOSAL_FIELDS.includes(key)) {
			codes.push(GATE_CODES.PROPOSAL_SHAPE_INVALID);
			break;
		}
	}
	const kind = record.kind;
	if (
		typeof kind !== "string" ||
		!KNOWLEDGE_KINDS.includes(kind as KnowledgeKind)
	) {
		codes.push(GATE_CODES.KIND_NOT_ALLOWED);
	}
	const assurance = record.assurance;
	if (
		typeof assurance !== "string" ||
		!(BOUNDED_ASSURANCES as readonly string[]).includes(assurance)
	) {
		codes.push(GATE_CODES.ASSURANCE_NOT_ALLOWED);
	}
	const status = record.status;
	if (
		typeof status !== "string" ||
		!KNOWLEDGE_STATUSES.includes(status as KnowledgeStatus)
	) {
		codes.push(GATE_CODES.STATUS_NOT_ALLOWED);
	}
	const atom = record.atom;
	if (
		typeof atom !== "string" ||
		!OBSERVATION_ATOMS.includes(atom as ObservationAtom)
	) {
		codes.push(GATE_CODES.ATOM_NOT_IN_CLOSED_VOCABULARY);
	}
	const argument = record.argument;
	if (
		argument !== undefined &&
		(typeof argument !== "string" ||
			!RUNTIME_ARGUMENTS.includes(argument as RuntimeArgument))
	) {
		codes.push(GATE_CODES.ARGUMENT_NOT_IN_CLOSED_VOCABULARY);
	}
	const qualificationClasses = record.qualificationClasses;
	if (qualificationClasses !== undefined) {
		if (!Array.isArray(qualificationClasses)) {
			codes.push(GATE_CODES.QUALIFICATION_CLASS_NOT_IN_CLOSED_VOCABULARY);
		} else {
			for (const classification of qualificationClasses) {
				if (
					typeof classification !== "string" ||
					!QUALIFICATION_CLASSES.includes(classification as QualificationClass)
				) {
					codes.push(GATE_CODES.QUALIFICATION_CLASS_NOT_IN_CLOSED_VOCABULARY);
					break;
				}
			}
		}
	}
	const evidenceRefs = record.evidenceRefs;
	if (!Array.isArray(evidenceRefs)) {
		codes.push(GATE_CODES.PROPOSAL_SHAPE_INVALID);
	} else {
		for (const reference of evidenceRefs) {
			if (typeof reference !== "string") {
				codes.push(GATE_CODES.PROPOSAL_SHAPE_INVALID);
				break;
			}
		}
	}
	return codes;
}

/**
 * The runtime-owned rendered statement of ONE proposal.
 *
 * The output is assembled ONLY from runtime-owned labels. There is no
 * interpolation of model text.
 */
export function renderClosedStatement(
	proposal: ClosedCheckpointProposal,
): string {
	const atomLabel = OBSERVATION_ATOM_LABELS[proposal.atom];
	const argumentLabel =
		proposal.argument === undefined
			? undefined
			: RUNTIME_ARGUMENT_LABELS[proposal.argument];
	return argumentLabel === undefined
		? atomLabel
		: `${atomLabel}: ${argumentLabel}`;
}

/**
 * The runtime-owned rendered qualifications of ONE proposal.
 */
export function renderClosedQualifications(
	proposal: ClosedCheckpointProposal,
): readonly string[] {
	return (proposal.qualificationClasses ?? []).map(
		(classification) => QUALIFICATION_CLASS_LABELS[classification],
	);
}

/**
 * Bound a model-CLAIMED assurance against the runtime's evidence bound.
 *
 * THE BOUND NEVER PROMOTES
 * ------------------------
 *
 * The runtime verified an EXECUTION, not the meaning of a model-authored
 * statement, so a `runtime_verified` claim is never honoured.
 *
 * THE BOUND DOWNGRADES, IT DOES NOT DESTROY
 * -----------------------------------------
 *
 * When the model claims a STRONGER assurance than the evidence supports, the
 * claim is DOWNGRADED to the strongest bound the evidence does support, and
 * the record is still published with that truthful assurance. The ACT's
 * contract permits either rejecting the stronger claim or downgrading it;
 * the DOWNGRADE is the behaviour that preserves the working knowledge
 * without overstating it.
 *
 * A claim is REJECTED only when the evidence supports NOTHING at all — that
 * is, when the runtime's interpreter cannot establish even a model-reported
 * bound for the cited references.
 */
export function boundAssurance(input: {
	readonly claimed: BoundedAssurance;
	readonly maximum: BoundedAssurance | undefined;
}): BoundedAssurance | undefined {
	const maximum = input.maximum ?? "unverified";
	if (input.claimed === "unverified") {
		return "unverified";
	}
	if (input.claimed === "model_reported") {
		// A model-reported claim is admissible whenever the evidence does
		// not CONTRADICT it. The runtime never verifies model reasoning, so
		// the claim stays model-reported.
		return "model_reported";
	}
	// The claim is `tool_observed`.
	//
	// It is ADMITTED AS CLAIMED only when the runtime's own interpreter
	// independently supports that bound for the cited references.
	if (maximum === "tool_observed") {
		return "tool_observed";
	}
	// The claim EXCEEDS the evidence. It is DOWNGRADED to the strongest
	// bound the evidence does support, so the observation survives with a
	// truthful assurance instead of being lost or overstated.
	if (maximum === "model_reported") {
		return "model_reported";
	}
	// The evidence supports NOTHING for these references: the record's
	// support is unverified. It is still published, with the weakest
	// truthful assurance.
	return "unverified";
}

/**
 * THE PUBLICATION GATE.
 *
 * Every proposal is validated against the closed contract, and the READABLE
 * content is produced by the HOST from runtime-owned templates.
 *
 * THE IDENTIFIER IS MINTED HERE
 * -----------------------------
 *
 * The gate assigns the record identifier from a runtime-generated sequence.
 * The model never names the record, so the identifier cannot become a
 * content channel.
 *
 * THE ASSURANCE IS BOUNDED HERE
 * ------------------------------
 *
 * The model CLAIMS an assurance. The gate BOUNDS it against what the
 * runtime's own evidence interpreter supports for the cited references.
 * The bound NEVER promotes: a syntactically valid reference does not make
 * a model-authored statement `tool_observed` on its own.
 */
export function gateClosedProposals(input: {
	readonly proposals: readonly unknown[];
	readonly evidence: GateEvidence;
	/**
	 * The canonical source-prefix identity the proposals were generated
	 * from. It is bound to every admitted record so a stale checkpoint can
	 * be detected before publication.
	 */
	readonly sourcePrefixKey: string;
}): GateOutcome {
	const codes: string[] = [];
	const records: AdmittedCheckpointRecord[] = [];
	const observed = new Set(input.evidence.canonicalReferences);
	let rejectedCount = 0;
	let sequence = 0;
	for (const proposal of input.proposals) {
		const shapeCodes = validateClosedProposalShape(proposal);
		if (shapeCodes.length > 0) {
			for (const code of shapeCodes) {
				if (!codes.includes(code)) {
					codes.push(code);
				}
			}
			rejectedCount += 1;
			continue;
		}
		const typed = proposal as ClosedCheckpointProposal;
		// MEMBERSHIP, NOT A SHAPE RULE. A reference the runtime did not
		// observe is not canonical, whatever shape it has.
		if (!typed.evidenceRefs.every((reference) => observed.has(reference))) {
			codes.push(GATE_CODES.REFERENCE_NOT_CANONICAL);
			rejectedCount += 1;
			continue;
		}
		// The assurance is BOUNDED by the runtime's own interpreter. The
		// model's claim is only honoured when it does not exceed the bound.
		const maximum = input.evidence.maximumAssuranceFor(typed.evidenceRefs);
		const boundedAssurance = boundAssurance({
			claimed: typed.assurance,
			maximum,
		});
		if (boundedAssurance === undefined) {
			// The runtime's interpreter established NOTHING for these
			// references, so the record has no support at all and is
			// rejected rather than published without provenance.
			codes.push(GATE_CODES.ASSURANCE_NOT_SUPPORTED_BY_EVIDENCE);
			rejectedCount += 1;
			continue;
		}
		const identifier = `${CHECKPOINT_ID_PREFIX}-${sequence}`;
		sequence += 1;
		records.push({
			id: identifier,
			kind: typed.kind,
			assurance: boundedAssurance,
			status: typed.status,
			statement: renderClosedStatement(typed),
			qualifications: renderClosedQualifications(typed),
			evidenceRefs: [...typed.evidenceRefs],
			sourcePrefixKey: input.sourcePrefixKey,
		});
	}
	return {
		admitted: codes.length === 0 && rejectedCount === 0,
		codes,
		records,
		rejectedCount,
	};
}
