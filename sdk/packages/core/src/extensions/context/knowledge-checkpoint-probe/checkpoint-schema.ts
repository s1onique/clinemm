/**
 * ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
 *
 * TEST-LOCAL candidate schema for a Working Knowledge Checkpoint.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API.
 * ============================================================================
 *
 * This file lives under a `knowledge-checkpoint-probe/` directory and is
 * imported ONLY by the ACT's own test and probe files. It introduces no
 * production surface: no new public export, no schema registry, no sidecar
 * field, no tool, no database, and no change to any production module. The
 * ACT is authorized for reproduction and feasibility only.
 *
 * WHAT A CHECKPOINT IS FOR
 * ------------------------
 *
 * Ordinary agentic compaction produces a lossy PROSE projection of the
 * canonical history. The measured baseline (ACT evidence `02-historical-
 * knowledge-baseline.md`) shows the projection reliably carries TOPICS while
 * dropping exact source observations, bounded negative observations, and
 * provider-level identifiers. A checkpoint is a SECOND, structured,
 * DETERMINISTIC carrier that is projected independently of the summarizer
 * prose, so that a bounded set of working-knowledge records survives the
 * compaction boundary.
 *
 * TRUTH IS NOT PRESERVATION
 * -------------------------
 *
 * The schema separates two independent questions that are easy to conflate:
 *
 *   1. Does the record PRESERVE something? (schema validity, binding,
 *      projection reachability) — this module answers this.
 *   2. Is the record FACTUALLY TRUE? (production verification, causal
 *      proof) — this module MUST NOT answer this, and never does.
 *
 * A model-authored `assurance: "runtime_verified"` is a CLAIM the model
 * made, not a fact the runtime established. `assurance` is therefore a
 * MODEL-REPORTED ASSURANCE GRADE, and the validator can only ever downgrade
 * or bound it — it can never promote a record to a stronger grade, and it
 * can never establish that the underlying claim is true.
 *
 * See `checkpoint-validation.ts` for the validation gates.
 */

/**
 * The kind of working knowledge a record represents.
 *
 * These are deliberately NOT verdict grades. A record may be an observation
 * the agent established, a hypothesis it is testing, a decision it made, a
 * constraint it must respect, or an open question it has not answered.
 */
export type KnowledgeKind =
	| "observation"
	| "hypothesis"
	| "decision"
	| "constraint"
	| "open_question";

/**
 * The ASSURANCE the record CLAIMS, as reported by the authoring model.
 *
 * These grades describe how the author believes the record is supported. The
 * validator treats them as CLAIMS: an unverified or model-reported record is
 * never promoted, and a `runtime_verified` claim is never itself treated as
 * proof.
 */
export type Assurance =
	| "runtime_verified"
	| "tool_observed"
	| "model_reported"
	| "unverified";

/**
 * The lifecycle state of a record.
 *
 * `unresolved` is the load-bearing value for this ACT: an investigation
 * TARGET is not a completed finding, and the checkpoint must be able to say
 * so explicitly rather than leaving the reader to infer it.
 */
export type KnowledgeStatus = "active" | "superseded" | "unresolved";

/**
 * ONE working-knowledge record.
 */
export interface WorkingKnowledgeRecord {
	/** A stable, model-chosen identifier, unique within one checkpoint. */
	readonly id: string;
	/** What KIND of working knowledge this is. */
	readonly kind: KnowledgeKind;
	/** The assurance the author CLAIMS for this record. */
	readonly assurance: Assurance;
	/** The statement itself. Free text. UNTRUSTED. */
	readonly statement: string;
	/**
	 * References to the canonical evidence the record rests on.
	 *
	 * These are OPAQUE REFERENCES (canonical message keys or evidence
	 * handles), never raw source excerpts and never raw tool output. A
	 * reference that does not resolve against the canonical history is
	 * DROPPED by the validator, not repaired and not guessed.
	 */
	readonly evidenceRefs: readonly string[];
	/**
	 * The qualifications that prevent the record from being over-read.
	 *
	 * These are what keep a bounded negative observation from being read as
	 * a global nonexistence claim, and what keep an observed startup command
	 * from being read as a proven deployment-drift finding.
	 */
	readonly qualifications: readonly string[];
	/** The lifecycle state of the record. */
	readonly status: KnowledgeStatus;
}

/**
 * A parsed, structurally valid checkpoint document.
 */
export interface WorkingKnowledgeCheckpoint {
	readonly records: readonly WorkingKnowledgeRecord[];
}

/**
 * The EXPERIMENTAL boundedness ceiling for the feasibility probe.
 *
 * These are NOT production defaults. They exist so the probe can MEASURE
 * whether a bounded checkpoint is materially cheaper than the loss it
 * prevents. Every value is asserted by the ACT's own tests.
 */
export const CHECKPOINT_LIMITS = {
	/** Maximum number of records in one checkpoint. */
	MAX_RECORDS: 12,
	/** Maximum characters in one statement. */
	MAX_STATEMENT_CHARS: 240,
	/** Maximum qualifications carried by one record. */
	MAX_QUALIFICATIONS: 3,
	/** Maximum evidence references carried by one record. */
	MAX_EVIDENCE_REFS: 4,
	/** Target total size of the projected section, in estimated tokens. */
	TARGET_TOTAL_TOKENS: 1_500,
} as const;

/** The legal `KnowledgeKind` values, as a runtime-checkable set. */
export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = [
	"observation",
	"hypothesis",
	"decision",
	"constraint",
	"open_question",
];

/** The legal `Assurance` values, as a runtime-checkable set. */
export const ASSURANCE_LEVELS: readonly Assurance[] = [
	"runtime_verified",
	"tool_observed",
	"model_reported",
	"unverified",
];

/** The legal `KnowledgeStatus` values, as a runtime-checkable set. */
export const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = [
	"active",
	"superseded",
	"unresolved",
];
