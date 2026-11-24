/**
 * ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
 *
 * TEST-LOCAL implementations of the THREE bounded publication contracts.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement module.
 * ============================================================================
 *
 * THE THREE CONTRACTS
 * -------------------
 *
 *   A — CLOSED STRUCTURE
 *       The model SELECTS from a closed representation; the HOST assembles
 *       the readable text from runtime-owned templates. There is NO persisted
 *       model-authored string at all.
 *
 *   B — RUNTIME ATTESTATION
 *       The model proposes a record; the host admits only those whose
 *       content class the RUNTIME itself established. "Tool output was
 *       observed" is NOT "tool output is safe to reproduce".
 *
 *   C — EXPLICIT APPROVAL
 *       A trusted actor authorises EXACT content for EXACT destinations in
 *       EXACT sessions. One-shot, content-identity-bound, session-bound,
 *       destination-bound.
 *
 * WHY NOT A CONTENT SCANNER
 * -------------------------
 *
 * Every contract here is enforced by SHAPE. None of them inspects the bytes
 * of a statement for a secret pattern. The decisive adversarial case is an
 * opaque dummy value with no recognisable keyword (S4): a scanner would admit
 * it, and admitting it is exactly the leak. A shape-enforced contract either
 * admits the whole statement (and therefore the dummy) or admits none of it.
 */

import { createHash } from "node:crypto";
import type {
	CandidateRecord,
	PublicationDestination,
} from "./publication-gate";

/**
 * A runtime-owned, CLOSED observation class.
 *
 * These are the atom types a checkpoint record may be built from. Each one
 * carries a runtime-owned LABEL and an OPAQUE reference. The model selects
 * WHICH atom applies and WHICH reference it rests on. The model never writes
 * the readable text.
 */
export type ObservationAtom =
	| "OPERATION_INVOKED"
	| "OPERATION_ARGUMENT_SET"
	| "CONFIGURATION_VALUE_SET"
	| "IMPLEMENTATION_INSPECTED"
	| "SEARCH_RETURNED_NO_MATCH"
	| "QUESTION_REMAINS_OPEN";

/**
 * The runtime-owned label for each observation atom.
 *
 * The label is a CLOSED STRING. It is not a template into which model text
 * is interpolated.
 */
export const OBSERVATION_ATOM_LABELS: Readonly<
	Record<ObservationAtom, string>
> = Object.freeze({
	OPERATION_INVOKED: "operation invoked",
	OPERATION_ARGUMENT_SET: "operation invoked with argument",
	CONFIGURATION_VALUE_SET: "configuration value set",
	IMPLEMENTATION_INSPECTED: "implementation inspected",
	SEARCH_RETURNED_NO_MATCH: "bounded search returned no match",
	QUESTION_REMAINS_OPEN: "question remains open",
});

/**
 * The runtime-owned atom vocabulary.
 */
export const OBSERVATION_ATOMS: readonly ObservationAtom[] = Object.freeze([
	"OPERATION_INVOKED",
	"OPERATION_ARGUMENT_SET",
	"CONFIGURATION_VALUE_SET",
	"IMPLEMENTATION_INSPECTED",
	"SEARCH_RETURNED_NO_MATCH",
	"QUESTION_REMAINS_OPEN",
] as const);

/**
 * A runtime-owned ARGUMENT slot.
 *
 * An argument is a CLOSED ENUM of runtime-recognised command/flag tokens,
 * NOT free text. This is the load-bearing constraint that lets a record
 * carry "the startup script invoked `kc.sh build`" without carrying any
 * model-authored string.
 */
export type RuntimeArgument =
	| "build"
	| "start"
	| "start_optimized"
	| "connect_timeout_3s"
	| "socket_timeout_10s"
	| "none";

/**
 * The runtime-owned label for each argument.
 */
export const RUNTIME_ARGUMENT_LABELS: Readonly<
	Record<RuntimeArgument, string>
> = Object.freeze({
	build: "build",
	start: "start",
	start_optimized: "start --optimized",
	connect_timeout_3s: "connect timeout 3 seconds",
	socket_timeout_10s: "socket timeout 10 seconds",
	none: "none",
});

/**
 * A runtime-owned QUALIFICATION class.
 *
 * A qualification is a CLOSED ENUM. The host renders the runtime-owned
 * sentence. The model may select WHICH qualification applies; it may never
 * author one.
 */
export type QualificationClass =
	| "OBSERVATION_ONLY_NO_CAUSATION"
	| "EFFECTIVE_PATH_NOT_RECONCILED"
	| "BOUNDED_TO_SEARCH_SCOPE"
	| "EXTERNAL_SYSTEMS_NOT_EXAMINED"
	| "RUNTIME_TOGGLE_UNRESOLVED";

/**
 * The runtime-owned qualification sentences.
 */
export const QUALIFICATION_CLASS_LABELS: Readonly<
	Record<QualificationClass, string>
> = Object.freeze({
	OBSERVATION_ONLY_NO_CAUSATION:
		"Observation of recorded behaviour only; it does not establish causation or an incident.",
	EFFECTIVE_PATH_NOT_RECONCILED:
		"The effective production path was not reconciled.",
	BOUNDED_TO_SEARCH_SCOPE:
		"Bounded to the searched scope; absence is not established globally.",
	EXTERNAL_SYSTEMS_NOT_EXAMINED:
		"External systems and scheduled maintenance were not examined.",
	RUNTIME_TOGGLE_UNRESOLVED:
		"The runtime toggle and complete path protection remain unresolved.",
});

/**
 * The runtime-owned qualification vocabulary.
 */
export const QUALIFICATION_CLASSES: readonly QualificationClass[] =
	Object.freeze([
		"OBSERVATION_ONLY_NO_CAUSATION",
		"EFFECTIVE_PATH_NOT_RECONCILED",
		"BOUNDED_TO_SEARCH_SCOPE",
		"EXTERNAL_SYSTEMS_NOT_EXAMINED",
		"RUNTIME_TOGGLE_UNRESOLVED",
	] as const);

/**
 * CANDIDATE A — the CLOSED STRUCTURE proposal.
 *
 * The model's contribution is a SELECTION over runtime-owned vocabularies.
 * There is NO field in which the model can write free text, so there is no
 * channel through which a copied secret or a copied instruction can travel.
 */
/**
 * CANDIDATE A — the CLOSED STRUCTURE proposal.
 *
 * The model's contribution is a SELECTION over runtime-owned vocabularies.
 * There is NO field in which the model can write free text, so there is no
 * channel through which a copied secret or a copied instruction can travel.
 *
 * THE IDENTIFIER IS NOT PART OF THE PROPOSAL
 * ------------------------------------------
 *
 * The proposal deliberately carries NO `id`. The identifier is MINTED BY THE
 * GATE, from a runtime-generated sequence, precisely so a model cannot put
 * content into it. A model-authored identifier is a free-text channel: a
 * shape rule that merely forbids whitespace would admit
 * `FAKE-CREDENTIAL-DO-NOT-USE-7P4x`, and an identifier that IS a secret is
 * still a secret.
 */
export interface ClosedStructureProposal {
	/** The runtime-owned kind. */
	readonly kind:
		| "observation"
		| "hypothesis"
		| "decision"
		| "constraint"
		| "open_question";
	/** The runtime-bounded assurance. */
	readonly assurance: "tool_observed" | "model_reported" | "unverified";
	/** The runtime-owned status. */
	readonly status: "active" | "superseded" | "unresolved";
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
 * The runtime-owned rendering of ONE closed-structure proposal.
 *
 * The output is a `CandidateRecord` in the SAME shape the predecessor's real
 * renderer consumes, so the same renderer can be used to prove that the
 * contract does not leak. Every field of the output is runtime-owned.
 *
 * The identifier is supplied by the caller — the GATE — and is therefore
 * runtime-generated, never model-authored.
 */
export function renderClosedStructureRecord(
	proposal: ClosedStructureProposal,
	identifier: string,
): CandidateRecord {
	const atomLabel = OBSERVATION_ATOM_LABELS[proposal.atom];
	const argumentLabel =
		proposal.argument === undefined
			? undefined
			: RUNTIME_ARGUMENT_LABELS[proposal.argument];
	const statement =
		argumentLabel === undefined ? atomLabel : `${atomLabel}: ${argumentLabel}`;
	const qualifications = (proposal.qualificationClasses ?? []).map(
		(classification) => QUALIFICATION_CLASS_LABELS[classification],
	);
	return {
		id: identifier,
		kind: proposal.kind,
		assurance: proposal.assurance,
		status: proposal.status,
		statement,
		qualifications,
		evidenceRefs: [...proposal.evidenceRefs],
	};
}

/**
 * The rejection of ONE closed-structure proposal.
 */
export interface ClosedStructureRejection {
	readonly code: string;
}

/**
 * The exact set of fields a closed-structure proposal may carry.
 *
 * The gate REJECTS a proposal that carries any field outside this set. That
 * is load-bearing: without it, a caller could smuggle a free-text field
 * past the shape validation simply by adding an unexpected property, and
 * the "there is nowhere to put model text" claim would be false.
 */
export const CLOSED_STRUCTURE_PROPOSAL_FIELDS: readonly string[] =
	Object.freeze([
		"kind",
		"assurance",
		"status",
		"atom",
		"argument",
		"qualificationClasses",
		"evidenceRefs",
	] as const);

/**
 * Validate a closed-structure proposal.
 *
 * The validation is SHAPE-ONLY: the atom, the argument, the qualification
 * classes and the kind/assurance/status must be members of their runtime-owned
 * vocabularies, and the proposal must carry NO field outside the closed
 * field set. No field of the proposal is free text, so there is nothing to
 * scan.
 */
export function validateClosedStructureProposal(
	proposal: ClosedStructureProposal,
): readonly ClosedStructureRejection[] {
	const rejections: ClosedStructureRejection[] = [];
	for (const key of Object.keys(proposal)) {
		if (!CLOSED_STRUCTURE_PROPOSAL_FIELDS.includes(key)) {
			rejections.push({
				code: "PROPOSAL_CARRIES_UNKNOWN_FIELD",
			});
		}
	}
	if (!OBSERVATION_ATOMS.includes(proposal.atom)) {
		rejections.push({
			code: "ATOM_NOT_IN_CLOSED_VOCABULARY",
		});
	}
	if (
		proposal.argument !== undefined &&
		!(Object.keys(RUNTIME_ARGUMENT_LABELS) as RuntimeArgument[]).includes(
			proposal.argument,
		)
	) {
		rejections.push({
			code: "ARGUMENT_NOT_IN_CLOSED_VOCABULARY",
		});
	}
	for (const classification of proposal.qualificationClasses ?? []) {
		if (!QUALIFICATION_CLASSES.includes(classification)) {
			rejections.push({
				code: "QUALIFICATION_CLASS_NOT_IN_CLOSED_VOCABULARY",
			});
		}
	}
	return rejections;
}

/**
 * CANDIDATE B — the RUNTIME ATTESTATION proposal.
 *
 * The model proposes a record whose content is CLASSIFIED by the runtime.
 * The admissible content classes are the runtime's own observations:
 *
 *   - a CLOSED runtime-owned status,
 *   - a CLOSED source-observation type,
 *   - an OPAQUE canonical source reference,
 *   - an EXPLICITLY AUTHORISED AND CLASSIFIED literal.
 *
 * The critical distinction the ACT must enforce is:
 *
 *   "Tool output was observed"  !=  "Tool output is safe to reproduce".
 *
 * So the runtime may attest the STATUS of a tool call, and may attest that a
 * particular source revision was read, but it may NOT attest that the tool
 * result's BODY is publishable. The body is `UNTRUSTED_SOURCE_CONTENT` and
 * stays out.
 */
export type AttestedContentClass =
	| "RUNTIME_OBSERVED_STATUS"
	| "RUNTIME_OBSERVED_SOURCE_REVISION"
	| "RUNTIME_OBSERVED_FILE_PRESENCE"
	| "EXPLICITLY_AUTHORISED_LITERAL";

/**
 * A runtime-attested content item.
 *
 * `literal` is present ONLY for `EXPLICITLY_AUTHORISED_LITERAL`, and even
 * then it is a value the RUNTIME has classified, not a value the model
 * supplied. The class `RUNTIME_OBSERVED_*` carries no literal at all.
 */
export interface AttestedContentItem {
	readonly class: AttestedContentClass;
	/** The runtime-owned label. */
	readonly label: string;
	/** The literal value, only for an explicitly authorised literal. */
	readonly literal?: string;
	/** The canonical reference the attestation rests on. */
	readonly evidenceRef: string;
}

/**
 * The runtime's view of one observed tool call.
 *
 * This is the ONLY thing the runtime can attest about a tool result: its
 * identity, its status, and (separately) the class of the content it
 * carries. The BODY of the result is never part of this structure.
 */
export interface RuntimeToolObservation {
	readonly toolCallId: string;
	readonly succeeded: boolean;
	/** The runtime-classified content class of the result body. */
	readonly bodyClass: "UNTRUSTED_SOURCE_CONTENT" | "RUNTIME_ATTESTED_CONTENT";
	/** The runtime-classified literal, only for an authorised literal. */
	readonly authorisedLiteral?: string;
}

/**
 * Build the runtime-attested content item for ONE tool observation.
 *
 * The `UNTRUSTED_SOURCE_CONTENT` body yields a STATUS item only: the runtime
 * can attest that the command ran and how it ended, but it cannot attest that
 * arbitrary source content is publishable.
 */
export function attestToolObservation(
	observation: RuntimeToolObservation,
): AttestedContentItem | undefined {
	if (observation.bodyClass === "RUNTIME_ATTESTED_CONTENT") {
		if (
			observation.authorisedLiteral === undefined ||
			observation.authorisedLiteral.length === 0
		) {
			return undefined;
		}
		return {
			class: "EXPLICITLY_AUTHORISED_LITERAL",
			label: "authorised literal",
			literal: observation.authorisedLiteral,
			evidenceRef: observation.toolCallId,
		};
	}
	return {
		class: "RUNTIME_OBSERVED_STATUS",
		label: observation.succeeded ? "command succeeded" : "command failed",
		evidenceRef: observation.toolCallId,
	};
}

/**
 * CANDIDATE C — the EXPLICIT APPROVAL proposal.
 *
 * If arbitrary natural-language detail cannot be admitted automatically, a
 * RESTRICTED mode may admit it under an explicit trusted authorisation.
 *
 * The authorisation is bound to:
 *
 *   - the EXACT record identity,
 *   - the EXACT accepted content identity (a digest of the content),
 *   - the SESSION,
 *   - the DESTINATION,
 *   - a ONE-SHOT scope.
 *
 * It is NOT equivalent to default-on autonomous checkpointing, and it is NOT
 * a general approval channel: an approval for one record does not admit a
 * different record, does not survive a content change, does not travel to a
 * different session, and does not travel to a different destination.
 */
export interface PublicationApproval {
	/** The exact record id the approval names. */
	readonly recordId: string;
	/** The SHA-256 digest of the approved content. */
	readonly contentDigest: string;
	/** The session the approval is bound to. */
	readonly sessionId: string;
	/** The destination the approval is bound to. */
	readonly destination: PublicationDestination;
	/** Whether the approval may be consumed more than once. */
	readonly reusable: boolean;
	/** Whether the approval has already been consumed. */
	readonly consumed: boolean;
}

/**
 * The digest of ONE record's publishable content.
 *
 * The digest covers every field that would be rendered, so a change to ANY
 * of them invalidates the approval.
 */
export function digestRecordContent(record: CandidateRecord): string {
	const payload = JSON.stringify({
		id: record.id,
		kind: record.kind,
		assurance: record.assurance,
		status: record.status,
		statement: record.statement,
		qualifications: [...record.qualifications],
		evidenceRefs: [...record.evidenceRefs],
	});
	return createHash("sha256").update(payload).digest("hex");
}

/**
 * The result of evaluating an approval against a record.
 */
export interface ApprovalEvaluation {
	readonly approved: boolean;
	readonly codes: readonly string[];
}

/**
 * Evaluate ONE approval against ONE record and ONE destination.
 *
 * Every binding is checked independently, so the failure mode of each is
 * observable rather than collapsed into one boolean.
 */
export function evaluateApproval(input: {
	readonly approval: PublicationApproval;
	readonly record: CandidateRecord;
	readonly destination: PublicationDestination;
	readonly sessionId: string;
}): ApprovalEvaluation {
	const codes: string[] = [];
	const { approval, record, destination, sessionId } = input;
	if (approval.recordId !== record.id) {
		codes.push("APPROVAL_RECORD_ID_MISMATCH");
	}
	if (approval.contentDigest !== digestRecordContent(record)) {
		codes.push("APPROVAL_CONTENT_IDENTITY_MISMATCH");
	}
	if (approval.sessionId !== sessionId) {
		codes.push("APPROVAL_SESSION_MISMATCH");
	}
	if (approval.destination !== destination) {
		codes.push("APPROVAL_DESTINATION_MISMATCH");
	}
	if (approval.consumed && !approval.reusable) {
		codes.push("APPROVAL_ALREADY_CONSUMED");
	}
	return { approved: codes.length === 0, codes };
}

/**
 * Consume a one-shot approval.
 *
 * The returned approval is a NEW object; the input is not mutated, so a
 * caller cannot accidentally keep a spent approval alive by aliasing it.
 */
export function consumeApproval(
	approval: PublicationApproval,
): PublicationApproval {
	if (approval.reusable) {
		return approval;
	}
	return { ...approval, consumed: true };
}
