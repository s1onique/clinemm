/**
 * tools/factory/fwmi/contract.ts
 *
 * FWMI v1 — Factory Work Migration Interchange, version 1.
 *
 * This module is the SHARED CONTRACT, verbatim from the operator's brief.
 * It is DATA, not BEHAVIOUR: nothing here knows how a ledger record is
 * written, and nothing here performs an import.
 *
 * The interchange is a MIGRATION TRANSPORT, not a canonical ledger model.
 * Two invariants dominate every consumer of this contract:
 *
 *   1. An imported historical QUALIFICATION assertion is NOT newly verified
 *      evidence. `qualification` values are HISTORICAL SOURCE ASSERTIONS
 *      and must never be promoted into acceptance.
 *   2. `SOURCE_RECONCILIATION_READY` is NOT authoritative cutover approval.
 *      It is a reconciliation-state marker and never an authoritative state
 *      transition.
 *
 * Package layout (produced by codium-clinemm under `.factory/migration/FWL02/`):
 *
 *   source-manifest.json
 *   epics/<EPIC-ID>.json
 *   historical-index.json
 *   reconciliation.json
 *   frontier.md
 *   validation-receipt.json
 *
 * Every JSON artifact carries `schema_version: 1`.
 */

// ---------- Common format ----------

/** The exact schema version every FWMI v1 artifact must carry. */
export const FWMI_SCHEMA_VERSION = 1;

/** Repository identity written by the producer. */
export const FWMI_REPOSITORY = "clinemm";

/** The frozen historical source HEAD for FWL02. */
export const FWL02_FROZEN_SOURCE_HEAD =
	"29774ba05851f9dd5a46a33a90d963ff3ef286d5";

// ---------- Normalized lifecycle vocabulary ----------

/**
 * Normalized lifecycle vocabulary. This is the SOURCE's normalized view of
 * an obligation's standing. `UNRESOLVED` is the explicit "insufficient or
 * conflicting migration information" state — it is materially different from
 * `DEFERRED`, which means "work explicitly postponed".
 */
export const FWMI_LIFECYCLES = [
	"OPEN",
	"ACTIVE",
	"BLOCKED",
	"DEFERRED",
	"TERMINAL",
	"UNRESOLVED",
] as const;
export type FwmiLifecycle = (typeof FWMI_LIFECYCLES)[number];

/**
 * Qualification vocabulary. These are HISTORICAL SOURCE ASSERTIONS about
 * what the source reported — not verified acceptance decisions.
 */
export const FWMI_QUALIFICATIONS = [
	"UNKNOWN",
	"UNQUALIFIED",
	"PARTIAL",
	"STRUCTURAL_ONLY",
	"LIVE_QUALIFIED",
	"ACCEPTED",
	"INSUFFICIENT",
	"REJECTED",
] as const;
export type FwmiQualification = (typeof FWMI_QUALIFICATIONS)[number];

/**
 * Coverage vocabulary. The distinction is load-bearing: an EMPTY
 * dependency list with `COMPLETE` coverage means "there are no
 * dependencies"; an empty list with `UNKNOWN` coverage means "dependencies
 * have not been recovered". These are materially different facts.
 */
export const FWMI_COVERAGES = ["COMPLETE", "PARTIAL", "UNKNOWN"] as const;
export type FwmiCoverage = (typeof FWMI_COVERAGES)[number];

/**
 * Relationship kinds. Only `DEPENDS_ON` represents a local execution
 * prerequisite unless another relationship explicitly establishes such
 * authority.
 */
export const FWMI_RELATIONSHIP_KINDS = [
	"DEPENDS_ON",
	"RELATED_TO",
	"SUPERSEDES",
	"CROSS_LINK",
	"ADDRESSES",
	"EXTERNAL_DEPENDENCY",
] as const;
export type FwmiRelationshipKind = (typeof FWMI_RELATIONSHIP_KINDS)[number];

/** Reconciliation resolutions used by reconciliation records. */
export const FWMI_RESOLUTIONS = [
	"UNRESOLVED",
	"RESOLVED",
	"DUPLICATE",
	"CONFLICT",
	"SUPERSEDED",
] as const;
export type FwmiResolution = (typeof FWMI_RESOLUTIONS)[number];

/** Historical ACT reconciliation status. */
export const FWMI_ACT_RECONCILIATION = [
	"UNAMBIGUOUS",
	"AMBIGUOUS",
	"CONFLICTING",
	"UNRESOLVED",
] as const;
export type FwmiActReconciliation = (typeof FWMI_ACT_RECONCILIATION)[number];

/** Disposition of a source file or section within the manifest. */
export const FWMI_DISPOSITIONS = [
	"indexed",
	"epic",
	"navigation",
	"metadata",
	"narrative",
	"unresolved",
] as const;
export type FwmiDisposition = (typeof FWMI_DISPOSITIONS)[number];

// ---------- Source references ----------

/**
 * A source reference binds a record to the EXACT original bytes it was
 * derived from. Line numbers are one-based and inclusive; `sha256` covers
 * the exact original byte range INCLUDING its original newline bytes, with
 * no text normalization.
 */
export interface FwmiSourceRef {
	readonly path: string;
	readonly start_line: number;
	readonly end_line: number;
	readonly sha256: string;
	/** Explicit source HEAD when the record references a different revision. */
	readonly source_head?: string;
}

// ---------- Relationships ----------

/** A known relationship between records. */
export interface FwmiRelationship {
	readonly kind: FwmiRelationshipKind;
	readonly target: string;
	/** The outcome the dependency requires, when the source stated one. */
	readonly required_outcome?: string;
	readonly source_refs?: readonly FwmiSourceRef[];
}

// ---------- Source manifest ----------

/** One source file inventoried by the producer. */
export interface FwmiManifestFile {
	readonly path: string;
	readonly bytes: number;
	readonly lines: number;
	readonly sha256: string;
	readonly git_blob: string;
	readonly disposition: FwmiDisposition;
}

/** `source-manifest.json`. */
export interface FwmiSourceManifest {
	readonly schema_version: number;
	readonly repository: string;
	readonly source_head: string;
	readonly files: readonly FwmiManifestFile[];
}

// ---------- Epic records ----------

/**
 * One reconciled work-item record. A work item is a PERSISTENT ENGINEERING
 * OBLIGATION. An ACT is an EXECUTION ATTEMPT — several ACTs may address one
 * obligation, and one ACT may address several obligations.
 */
export interface FwmiItem {
	readonly item_id: string;
	readonly title: string;
	readonly description: string;
	readonly workstream: string | null;
	/** The source's own status token, VERBATIM. Never rewritten. */
	readonly original_status: string | null;
	readonly lifecycle: FwmiLifecycle;
	readonly priority: string | null;
	/** HISTORICAL SOURCE ASSERTION. Never promoted to acceptance. */
	readonly qualification: FwmiQualification;
	readonly criteria: readonly string[];
	readonly criteria_coverage: FwmiCoverage;
	readonly dependencies: readonly string[];
	readonly dependency_coverage: FwmiCoverage;
	readonly blockers: readonly string[];
	readonly current_act: string | null;
	readonly related_acts: readonly string[];
	readonly evidence_locators: readonly string[];
	readonly reopen_conditions: readonly string[];
	readonly source_refs: readonly FwmiSourceRef[];
	/** Known relationships beyond the dependency list. */
	readonly relationships?: readonly FwmiRelationship[];
}

/** One epic record. */
export interface FwmiEpic {
	readonly schema_version: number;
	readonly epic_id: string;
	readonly title: string;
	readonly original_status: string | null;
	readonly lifecycle: FwmiLifecycle;
	readonly priority: string | null;
	readonly exit_criteria: readonly string[];
	readonly items: readonly FwmiItem[];
	readonly source_refs: readonly FwmiSourceRef[];
	/** Known relationships beyond the item level (e.g. epic-to-epic edges). */
	readonly relationships?: readonly FwmiRelationship[];
}

// ---------- Historical index ----------

/** One historical ACT index entry. */
export interface FwmiHistoricalAct {
	readonly act_id: string;
	/** The original verdict. Competing verdicts are retained separately. */
	readonly original_verdict: string | null;
	readonly epic_id: string | null;
	readonly work_item_ids: readonly string[];
	readonly evidence_locators: readonly string[];
	readonly source_refs: readonly FwmiSourceRef[];
	readonly reconciliation: FwmiActReconciliation;
}

/** `historical-index.json`. */
export interface FwmiHistoricalIndex {
	readonly schema_version: number;
	readonly records: readonly FwmiHistoricalAct[];
}

// ---------- Reconciliation ----------

/** One reconciliation record: a duplicate, conflict, gap or cross-link. */
export interface FwmiReconciliationRecord {
	readonly kind: string;
	readonly identities: readonly string[];
	readonly resolution: FwmiResolution;
	readonly reason: string;
	readonly source_refs: readonly FwmiSourceRef[];
}

/** `reconciliation.json`. */
export interface FwmiReconciliation {
	readonly schema_version: number;
	readonly records: readonly FwmiReconciliationRecord[];
}

// ---------- Validation receipt ----------

/** `validation-receipt.json`. */
export interface FwmiValidationReceipt {
	readonly schema_version: number;
	readonly verdict: string;
	readonly checks: readonly FwmiReceiptCheck[];
	/** How much of the source was mechanically indexed vs semantically reconciled. */
	readonly mechanical_coverage?: string;
	readonly semantic_coverage?: string;
}

/** One executed check reported by the producer. */
export interface FwmiReceiptCheck {
	readonly id: string;
	readonly status: "PASS" | "FAIL" | "PARTIAL" | "NOT_EXECUTED";
	readonly detail?: string;
}

// ---------- The loaded package ----------

/**
 * A loaded FWMI v1 package. Files are parsed and structurally checked by
 * `load.ts`; SEMANTIC validation happens in `validate.ts`.
 */
export interface FwmiPackage {
	readonly root: string;
	readonly manifest: FwmiSourceManifest;
	readonly epics: readonly FwmiEpic[];
	readonly historicalIndex: FwmiHistoricalIndex;
	readonly reconciliation: FwmiReconciliation;
	readonly receipt: FwmiValidationReceipt;
	/** Raw `frontier.md` bytes, preserved verbatim. */
	readonly frontierMarkdown: string;
}

/**
 * Terminal verdicts the producer may record.
 *
 * `SOURCE_RECONCILIATION_READY` means "repository-derived engineering state
 * is represented in source-bound migration artifacts". It is NOT cutover
 * approval.
 */
export const FWMI_VERDICTS = [
	"SOURCE_RECONCILIATION_READY",
	"PARTIAL_SOURCE_RECONCILIATION",
	"HALT_REPOSITORY_TRUST",
] as const;
export type FwmiVerdict = (typeof FWMI_VERDICTS)[number];

/** True when the verdict asserts reconciliation readiness. */
export function isReconciliationReady(verdict: string): boolean {
	return verdict === "SOURCE_RECONCILIATION_READY";
}

/**
 * The relationship kinds that establish LOCAL EXECUTION PREREQUISITE
 * authority. Every other kind is a conservation edge only.
 */
export const PREREQUISITE_KINDS: ReadonlySet<FwmiRelationshipKind> = new Set([
	"DEPENDS_ON",
]);

/** True when a relationship kind carries local prerequisite authority. */
export function isPrerequisiteKind(kind: FwmiRelationshipKind): boolean {
	return PREREQUISITE_KINDS.has(kind);
}
