/**
 * ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
 *
 * TEST-LOCAL CONTROLLED publication gate for a model-authored checkpoint.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement module.
 * ============================================================================
 *
 * WHERE THE GATE SITS
 * -------------------
 *
 * The gate is the EARLIEST SHARED publication function that BOTH persistence
 * and provider-visible projection must traverse:
 *
 *   model-authored record
 *        |
 *        v
 *   [ CONTROLLED PUBLICATION GATE ]   <-- this module
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
 * THE GATE'S RULE
 * ---------------
 *
 * A record is admitted only if EVERY field is runtime-owned under the
 * selected contract. There is no content inspection: the gate compares the
 * record's FIELDS against the closed vocabularies, and compares the record's
 * rendered content against the exact content that was authorised.
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
	type ClosedStructureProposal,
	digestRecordContent,
	evaluateApproval,
	type PublicationApproval,
	renderClosedStructureRecord,
	validateClosedStructureProposal,
} from "./candidate-contracts";
import type {
	CandidateRecord,
	PublicationDecision,
	PublicationDestination,
} from "./publication-gate";

/**
 * The closed vocabularies the gate accepts for the enum-valued fields.
 */
export const ALLOWED_KINDS = [
	"observation",
	"hypothesis",
	"decision",
	"constraint",
	"open_question",
] as const;

/**
 * The closed vocabularies the gate accepts for the bounded assurance.
 *
 * `runtime_verified` is absent by construction: the gate can only ever
 * receive a BOUNDED assurance, and a bounded assurance is never
 * `runtime_verified`.
 */
export const ALLOWED_BOUNDED_ASSURANCES = [
	"tool_observed",
	"model_reported",
	"unverified",
] as const;

/**
 * The closed vocabularies the gate accepts for the status.
 */
export const ALLOWED_STATUSES = ["active", "superseded", "unresolved"] as const;

/**
 * The runtime-owned content of ONE admitted record.
 *
 * The gate emits this, never the raw model record. The renderer consumes
 * this, so a record that did not pass the gate has no path to a renderer.
 */
export interface AdmittedRecord {
	readonly id: string;
	readonly kind: string;
	readonly assurance: string;
	readonly status: string;
	readonly statement: string;
	readonly qualifications: readonly string[];
	readonly evidenceRefs: readonly string[];
	/**
	 * The contract that admitted this record.
	 *
	 * The contract identity is carried so the evidence trail can attribute
	 * every published byte to the mechanism that authorised it.
	 */
	readonly contract:
		| "CLOSED_STRUCTURE"
		| "RUNTIME_ATTESTATION"
		| "EXPLICIT_APPROVAL";
}

/**
 * The outcome of gating a set of candidate records.
 */
export interface GateOutcome {
	readonly decision: PublicationDecision;
	readonly admitted: readonly AdmittedRecord[];
}

/**
 * The reason codes the gate emits.
 */
export const GATE_CODES = {
	KIND_NOT_ALLOWED: "KIND_NOT_ALLOWED",
	ASSURANCE_NOT_ALLOWED: "ASSURANCE_NOT_ALLOWED",
	STATUS_NOT_ALLOWED: "STATUS_NOT_ALLOWED",
	FIELD_CONTENT_NOT_RUNTIME_OWNED: "FIELD_CONTENT_NOT_RUNTIME_OWNED",
	IDENTIFIER_NOT_OPAQUE: "IDENTIFIER_NOT_OPAQUE",
	REFERENCE_NOT_CANONICAL: "REFERENCE_NOT_CANONICAL",
	APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
	APPROVAL_INVALID: "APPROVAL_INVALID",
	PROPOSAL_SHAPE_INVALID: "PROPOSAL_SHAPE_INVALID",
} as const;

/**
 * An identifier is OPAQUE when it contains no whitespace, no separator, and
 * no character that could carry content across a field boundary.
 *
 * This is a SHAPE rule, not a content rule: it does not ask whether the
 * identifier looks like a secret, it asks whether the identifier is capable
 * of CONTAINING content at all.
 */
export function isOpaqueIdentifier(value: string): boolean {
	return (
		value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._-]+$/.test(value)
	);
}

/**
 * A canonical reference is OPAQUE when it is either a bare tool-call id or
 * an `id:<message id>` handle.
 */
export function isCanonicalReference(value: string): boolean {
	if (value.startsWith("id:")) {
		const messageId = value.slice(3);
		return messageId.length > 0 && isOpaqueIdentifier(messageId);
	}
	return isOpaqueIdentifier(value);
}

/**
 * The closed-structure gate.
 *
 * The model's proposal is validated against the runtime-owned vocabularies
 * and then RENDERED BY THE HOST. The rendered record's free-text fields are
 * the runtime's own strings, so no model-authored byte reaches the output.
 *
 * The proposal carries no free-text field at all, so the gate cannot be
 * bypassed by putting content in the wrong place — there is nowhere to put
 * it.
 *
 * THE IDENTIFIER IS MINTED HERE
 * -----------------------------
 *
 * The gate assigns the record identifier from a runtime-generated sequence.
 * The model never names the record, so the identifier cannot become a
 * content channel.
 */
export function gateClosedStructure(input: {
	readonly proposals: readonly ClosedStructureProposal[];
	/**
	 * The canonical references the RUNTIME observed.
	 *
	 * This set is runtime-supplied, NOT model-supplied. A reference the
	 * model proposes is only admitted if it is a member of this set.
	 *
	 * WHY THIS SET IS RUNTIME-SUPPLIED AND NOT A SHAPE RULE
	 * ---------------------------------------------------
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
	 * The prefix for the runtime-generated identifiers.
	 *
	 * It is runtime-owned. It defaults to a fixed literal so a caller
	 * cannot smuggle content in through the prefix either.
	 */
	readonly identifierPrefix?: string;
}): GateOutcome {
	const codes: string[] = [];
	const admitted: AdmittedRecord[] = [];
	const rejected: string[] = [];
	const prefix = input.identifierPrefix ?? "pck";
	const observed = new Set(input.canonicalReferences);
	let sequence = 0;
	for (const proposal of input.proposals) {
		const rejections = validateClosedStructureProposal(proposal);
		if (rejections.length > 0) {
			codes.push(GATE_CODES.PROPOSAL_SHAPE_INVALID);
			rejected.push(`${prefix}-${sequence}`);
			continue;
		}
		if (!proposal.evidenceRefs.every((reference) => observed.has(reference))) {
			codes.push(GATE_CODES.REFERENCE_NOT_CANONICAL);
			rejected.push(`${prefix}-${sequence}`);
			continue;
		}
		// A record that claims `tool_observed` MUST cite at least one
		// canonical reference. Otherwise the reference resolver has nothing
		// to resolve and the assurance bound would reduce the claim.
		if (
			proposal.assurance === "tool_observed" &&
			proposal.evidenceRefs.length === 0
		) {
			codes.push(GATE_CODES.REFERENCE_NOT_CANONICAL);
			rejected.push(`${prefix}-${sequence}`);
			continue;
		}
		const identifier = `${prefix}-${sequence}`;
		sequence += 1;
		const rendered = renderClosedStructureRecord(proposal, identifier);
		admitted.push({
			id: rendered.id,
			kind: rendered.kind,
			assurance: rendered.assurance,
			status: rendered.status,
			statement: rendered.statement,
			qualifications: rendered.qualifications,
			evidenceRefs: rendered.evidenceRefs,
			contract: "CLOSED_STRUCTURE",
		});
	}
	return {
		decision: {
			admitted: codes.length === 0,
			codes,
			rejectedRecordIds: rejected,
		},
		admitted,
	};
}

/**
 * The runtime-attestation gate.
 *
 * A candidate record is admitted only when EVERY one of its free-text fields
 * is the EXACT text the runtime attested. The gate compares strings for
 * EQUALITY against the runtime's own attested values — it never classifies
 * the candidate's text, and it never admits a record whose statement merely
 * "looks like" an attested value.
 *
 * The runtime's attestation set is the closed vocabulary of attested items
 * plus, optionally, an explicitly authorised literal. A tool result whose
 * body class is `UNTRUSTED_SOURCE_CONTENT` contributes NO body text to the
 * attested set, so nothing from it can be admitted.
 */
export function gateRuntimeAttestation(input: {
	readonly records: readonly CandidateRecord[];
	/**
	 * The runtime-attested statements the host is willing to publish.
	 *
	 * These are the runtime's OWN strings. A candidate whose statement is not
	 * a member of this set is rejected.
	 */
	readonly attestedStatements: readonly string[];
	/**
	 * The runtime-attested qualification strings.
	 */
	readonly attestedQualifications?: readonly string[];
	/**
	 * The canonical references the runtime observed.
	 */
	readonly canonicalReferences?: readonly string[];
}): GateOutcome {
	const codes: string[] = [];
	const admitted: AdmittedRecord[] = [];
	const rejected: string[] = [];
	const attestedStatements = new Set(input.attestedStatements);
	const attestedQualifications = new Set(input.attestedQualifications ?? []);
	const canonicalReferences = new Set(input.canonicalReferences ?? []);
	for (const record of input.records) {
		if (!isOpaqueIdentifier(record.id)) {
			codes.push(GATE_CODES.IDENTIFIER_NOT_OPAQUE);
			rejected.push(record.id);
			continue;
		}
		if (!(ALLOWED_KINDS as readonly string[]).includes(record.kind)) {
			codes.push(GATE_CODES.KIND_NOT_ALLOWED);
			rejected.push(record.id);
			continue;
		}
		if (
			!(ALLOWED_BOUNDED_ASSURANCES as readonly string[]).includes(
				record.assurance,
			)
		) {
			codes.push(GATE_CODES.ASSURANCE_NOT_ALLOWED);
			rejected.push(record.id);
			continue;
		}
		if (!(ALLOWED_STATUSES as readonly string[]).includes(record.status)) {
			codes.push(GATE_CODES.STATUS_NOT_ALLOWED);
			rejected.push(record.id);
			continue;
		}
		if (!attestedStatements.has(record.statement)) {
			codes.push(GATE_CODES.FIELD_CONTENT_NOT_RUNTIME_OWNED);
			rejected.push(record.id);
			continue;
		}
		if (
			!record.qualifications.every((qualification) =>
				attestedQualifications.has(qualification),
			)
		) {
			codes.push(GATE_CODES.FIELD_CONTENT_NOT_RUNTIME_OWNED);
			rejected.push(record.id);
			continue;
		}
		if (
			canonicalReferences.size > 0 &&
			!record.evidenceRefs.every((reference) =>
				canonicalReferences.has(reference),
			)
		) {
			codes.push(GATE_CODES.REFERENCE_NOT_CANONICAL);
			rejected.push(record.id);
			continue;
		}
		// A record that claims `tool_observed` MUST cite at least one
		// canonical reference. Without one, the reference resolver has
		// nothing to resolve and the assurance bound would reduce the claim
		// to `model_reported`. The gate refuses the stronger claim rather
		// than publishing an unsupported one.
		if (
			record.assurance === "tool_observed" &&
			record.evidenceRefs.length === 0
		) {
			codes.push(GATE_CODES.REFERENCE_NOT_CANONICAL);
			rejected.push(record.id);
			continue;
		}
		admitted.push({
			id: record.id,
			kind: record.kind,
			assurance: record.assurance,
			status: record.status,
			statement: record.statement,
			qualifications: record.qualifications,
			evidenceRefs: record.evidenceRefs,
			contract: "RUNTIME_ATTESTATION",
		});
	}
	return {
		decision: {
			admitted: codes.length === 0,
			codes,
			rejectedRecordIds: rejected,
		},
		admitted,
	};
}

/**
 * The explicit-approval gate.
 *
 * A candidate record is admitted only when a trusted authorisation covers its
 * EXACT content, in the EXACT session, for the EXACT destination, and the
 * authorisation has not been consumed.
 */
export function gateExplicitApproval(input: {
	readonly records: readonly CandidateRecord[];
	readonly approvals: readonly PublicationApproval[];
	readonly destination: PublicationDestination;
	readonly sessionId: string;
}): GateOutcome {
	const codes: string[] = [];
	const admitted: AdmittedRecord[] = [];
	const rejected: string[] = [];
	for (const record of input.records) {
		if (!isOpaqueIdentifier(record.id)) {
			codes.push(GATE_CODES.IDENTIFIER_NOT_OPAQUE);
			rejected.push(record.id);
			continue;
		}
		const matching = input.approvals.filter(
			(approval) => approval.recordId === record.id,
		);
		if (matching.length === 0) {
			codes.push(GATE_CODES.APPROVAL_REQUIRED);
			rejected.push(record.id);
			continue;
		}
		const evaluations = matching.map((approval) =>
			evaluateApproval({
				approval,
				record,
				destination: input.destination,
				sessionId: input.sessionId,
			}),
		);
		const evaluation = evaluations.find((result) => result.approved);
		if (!evaluation) {
			// The SPECIFIC reason codes are propagated, so the failure mode
			// of each binding is observable rather than collapsed into one
			// opaque boolean.
			for (const candidate of evaluations) {
				for (const code of candidate.codes) {
					if (!codes.includes(code)) {
						codes.push(code);
					}
				}
			}
			if (codes.length === 0) {
				codes.push(GATE_CODES.APPROVAL_INVALID);
			}
			rejected.push(record.id);
			continue;
		}
		admitted.push({
			id: record.id,
			kind: record.kind,
			assurance: record.assurance,
			status: record.status,
			statement: record.statement,
			qualifications: record.qualifications,
			evidenceRefs: record.evidenceRefs,
			contract: "EXPLICIT_APPROVAL",
		});
	}
	return {
		decision: {
			admitted: codes.length === 0,
			codes,
			rejectedRecordIds: rejected,
		},
		admitted,
	};
}

/**
 * Convert ADMITTED records back into the `ProjectableRecord` shape that the
 * predecessor's REAL renderer consumes.
 *
 * The conversion is total and lossless in the direction that matters: an
 * admitted record's rendered bytes are exactly the admitted bytes. There is
 * no path from a NON-admitted record to this function's output.
 */
export function toProjectableRecords(
	admitted: readonly AdmittedRecord[],
): readonly {
	id: string;
	kind: string;
	assurance: string;
	status: string;
	statement: string;
	qualifications: readonly string[];
	evidenceRefs: readonly string[];
}[] {
	return admitted.map((record) => ({
		id: record.id,
		kind: record.kind,
		assurance: record.assurance,
		status: record.status,
		statement: record.statement,
		qualifications: record.qualifications,
		evidenceRefs: record.evidenceRefs,
	}));
}

/**
 * The digest of ONE admitted record's publishable content.
 *
 * The evidence trail uses it to bind a published byte-string to the exact
 * authorised content.
 */
export function digestAdmittedRecord(record: AdmittedRecord): string {
	return digestRecordContent({
		id: record.id,
		kind: record.kind,
		assurance: record.assurance,
		status: record.status,
		statement: record.statement,
		qualifications: record.qualifications,
		evidenceRefs: record.evidenceRefs,
	});
}
