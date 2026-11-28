#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/contract.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — FWMI v1 wire contract.
 *
 * This module is DATA, not BEHAVIOUR. It declares the Factory Work Migration
 * Interchange (FWMI) version 1 wire shapes exactly as the operator's Go
 * consumer expects them. Nothing here knows how a ledger record is written and
 * nothing here performs an import.
 *
 * Two invariants dominate every consumer of this contract:
 *
 *   1. An imported historical QUALIFICATION assertion is NOT newly verified
 *      evidence. `qualification` values are HISTORICAL SOURCE ASSERTIONS and
 *      must never be promoted into acceptance.
 *   2. `SOURCE_RECONCILIATION_READY` is NOT authoritative cutover approval.
 *      It is a reconciliation-state marker and never an authoritative state
 *      transition.
 *
 * Package layout produced by ClineMM under `.factory/migration/FWL02/`:
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

import type { FwmiSourceRef } from "./source-refs.ts";

/** Re-exported so consumers can import the wire shape from the contract module. */
export type { FwmiSourceRef };

/** The exact schema version every FWMI v1 artifact must carry. */
export const FWMI_SCHEMA_VERSION = 1;

/** Repository identity written by the producer. */
export const FWMI_REPOSITORY = "clinemm";

/**
 * Normalized lifecycle vocabulary. This is the SOURCE's normalized view of an
 * obligation's standing. `UNRESOLVED` is the explicit "insufficient or
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
 * Qualification vocabulary. These are HISTORICAL SOURCE ASSERTIONS about what
 * the source reported — not verified acceptance decisions.
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
 * Coverage vocabulary. The distinction is load-bearing: an EMPTY dependency
 * list with `COMPLETE` coverage means "there are no dependencies"; an empty
 * list with `UNKNOWN` coverage means "dependencies have not been recovered".
 */
export const FWMI_COVERAGES = ["COMPLETE", "PARTIAL", "UNKNOWN"] as const;
export type FwmiCoverage = (typeof FWMI_COVERAGES)[number];

/** Relationship kinds. Only `DEPENDS_ON` carries local prerequisite authority. */
export const FWMI_RELATIONSHIP_KINDS = [
	"DEPENDS_ON",
	"RELATED_TO",
	"SUPERSEDES",
	"CROSS_LINK",
	"ADDRESSES",
	"EXTERNAL_DEPENDENCY",
] as const;
export type FwmiRelationshipKind = (typeof FWMI_RELATIONSHIP_KINDS)[number];

/**
 * The normalized priority vocabulary of the native ledger.
 *
 * The source board and the source epic files state priorities in their own
 * words (`HIGH`, `MED`, `LOW`, `DEMO / LOW`, `P0-if-reproduced`, `P1`, `P2`,
 * `P3`). The FWMI wire carries the NORMALIZED value; the source's own wording
 * is preserved verbatim in the record's `original_status` and in the
 * supplemental source accounting, never rewritten in place.
 *
 * The normalization is a mapping of the SOURCE's stated priority, not an
 * assertion of the current operational priority: a source that says
 * `P0-if-reproduced` is not a confirmed current P0 and is therefore carried as
 * `P1` with its conditional wording preserved, because the condition is not
 * established.
 */
export const FWMI_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type FwmiPriority = (typeof FWMI_PRIORITIES)[number];

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

/** A known relationship between records. */
export interface FwmiRelationship {
	readonly kind: FwmiRelationshipKind;
	readonly target: string;
	/** The outcome the dependency requires, when the source stated one. */
	readonly required_outcome?: string;
	readonly source_refs?: readonly FwmiSourceRef[];
}

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

/**
 * One reconciled work-item record. A work item is a PERSISTENT ENGINEERING
 * OBLIGATION. An ACT is an EXECUTION ATTEMPT — several ACTs may address one
 * obligation, and one ACT may address several obligations.
 *
 * WIRE COMPATIBILITY (against the actual Leamas Go consumer):
 *
 *   - `item_id` is LOCAL to its parent epic. The consumer derives the scoped
 *     identity as `epic_id + "/" + item_id`, so a globally-scoped `item_id`
 *     would double-scope the identity and break the consumer's duplicate
 *     detection.
 *   - `dependencies` carries EVERY relationship kind, not only prerequisites.
 *     The consumer's `WorkItem` shape has no separate `relationships` field
 *     and its strict decoder rejects an unknown field.
 *   - `schema_version` is REQUIRED on the nested work item.
 */
export interface FwmiItem {
	readonly schema_version: number;
	/** The item identity, LOCAL to its parent epic (e.g. "E8"). */
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
	readonly dependencies: readonly FwmiRelationship[];
	readonly dependency_coverage: FwmiCoverage;
	readonly blockers: readonly string[];
	readonly current_act: string | null;
	readonly related_acts: readonly string[];
	readonly evidence_locators: readonly string[];
	readonly reopen_conditions: readonly string[];
	readonly source_refs: readonly FwmiSourceRef[];
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
}

/** One historical ACT index entry. */
export interface FwmiHistoricalAct {
	readonly schema_version: number;
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

/** One reconciliation record: a duplicate, conflict, gap or cross-link. */
export interface FwmiReconciliationRecord {
	readonly schema_version: number;
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

/** One executed check reported by the producer. */
export interface FwmiReceiptCheck {
	readonly id: string;
	readonly status: "PASS" | "FAIL" | "PARTIAL" | "NOT_EXECUTED";
	readonly detail?: string;
}

/** `validation-receipt.json`. */
export interface FwmiValidationReceipt {
	readonly schema_version: number;
	readonly verdict: string;
	readonly checks: readonly FwmiReceiptCheck[];
	/** How much of the source was mechanically indexed vs semantically reconciled. */
	readonly mechanical_coverage?: string;
	readonly semantic_coverage?: string;
}

/** Terminal verdicts the producer may record. */
export const FWMI_VERDICTS = [
	"SOURCE_RECONCILIATION_READY",
	"PARTIAL_SOURCE_RECONCILIATION",
	"HALT_REPOSITORY_TRUST",
] as const;
export type FwmiVerdict = (typeof FWMI_VERDICTS)[number];

/** The relationship kinds that establish LOCAL EXECUTION PREREQUISITE authority. */
export const PREREQUISITE_KINDS: ReadonlySet<FwmiRelationshipKind> = new Set([
	"DEPENDS_ON",
]);

/** True when a relationship kind carries local prerequisite authority. */
export function isPrerequisiteKind(kind: FwmiRelationshipKind): boolean {
	return PREREQUISITE_KINDS.has(kind);
}
