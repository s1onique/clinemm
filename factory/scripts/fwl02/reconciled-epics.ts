#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/reconciled-epics.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — the RECONCILED SOURCE DATA.
 *
 * This module is the human-reconciled engineering state recovered from the
 * committed ClineMM documentation at SOURCE_HEAD. It is DATA ONLY: it declares
 * which source ranges carry which engineering assertion, so the generator can
 * bind every assertion to its exact committed bytes.
 *
 * Every entry names the source file and the one-based inclusive line range
 * that establishes the claim. The generator computes the SHA-256 of those
 * bytes from the committed git blob; it never hashes working-tree text.
 *
 * RECONCILIATION POSTURE (the rules this data was recovered under):
 *
 *   - An engineering OBLIGATION is separated from an ACT EXECUTION ATTEMPT.
 *   - A historical ACT verdict is a historical ASSERTION, never a newly
 *     verified acceptance.
 *   - An unknown source status is NEVER silently normalized to DEFERRED.
 *   - A DEFERRED item is work the source explicitly postponed.
 *   - TERMINAL is a historically retired obligation.
 *   - UNRESOLVED is insufficient or conflicting migration information.
 *   - Dependencies are NOT inferred from chronology; only explicit
 *     dependency statements become DEPENDS_ON edges.
 */

import type {
	FwmiCoverage,
	FwmiLifecycle,
	FwmiQualification,
	FwmiRelationship,
} from "./contract.ts";

/**
 * A source-bound assertion. `path` + `lines` identify the exact committed
 * byte range; the generator resolves it into a digest-bearing source ref.
 */
export interface Bound {
	readonly path: string;
	readonly lines: readonly [number, number];
}

/** A reconciled work item, pre-serialization. */
export interface ReconciledItem {
	readonly item_id: string;
	readonly title: string;
	readonly description: string;
	readonly workstream: string | null;
	readonly original_status: string | null;
	readonly lifecycle: FwmiLifecycle;
	readonly priority: string | null;
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
	readonly source_refs: readonly Bound[];
	readonly relationships?: readonly ReconciledRelationship[];
}

/** A reconciled relationship, pre-serialization. */
export interface ReconciledRelationship {
	readonly kind: FwmiRelationship["kind"];
	readonly target: string;
	readonly required_outcome?: string;
	readonly source_refs: readonly Bound[];
}

/** A reconciled epic, pre-serialization. */
export interface ReconciledEpic {
	readonly epic_id: string;
	readonly title: string;
	readonly original_status: string | null;
	readonly lifecycle: FwmiLifecycle;
	readonly priority: string | null;
	readonly exit_criteria: readonly string[];
	readonly items: readonly ReconciledItem[];
	readonly source_refs: readonly Bound[];
	readonly relationships?: readonly ReconciledRelationship[];
	/** The source file this epic was recovered from. */
	readonly source_file: string;
}

/**
 * Workstream identities. The source does not name workstreams explicitly as
 * such, so the workstream is derived from the epic detail file that owns the
 * obligation — the epic's own durable identity. The derivation is recorded
 * here so it is explicit and reviewable rather than implicit.
 */
export const WORKSTREAMS = {
	FACTORY_INFRASTRUCTURE: "factory-infrastructure",
	APPROVAL_PROTECTION: "approval-protection",
	APPROVAL_MCP_AUTHORITY: "approval-mcp-authority",
	ARCHITECTURE: "architecture",
	AUTHENTICATED_DEV_CAPABILITIES: "authenticated-dev-capabilities",
	CLOSED_FOUNDATION: "closed-foundation",
	COMMAND_RISK_CLASSIFICATION: "command-risk-classification",
	CONTEXT_COMPACTION: "context-compaction-token-accounting",
	DISTRIBUTION_CI: "distribution-ci",
	DYNAMIC_EDITING_BACKENDS: "dynamic-editing-backends",
	HOST_TEST_INFRASTRUCTURE: "host-test-infrastructure",
	PRODUCT_CONFIG_BRANDING: "product-config-branding",
	QUALITY_SUBSTRATE: "quality-substrate",
	RUNTIME_TASK_PROGRESSION: "runtime-task-progression",
	SAFE_YOLO_SEATBELT: "safe-yolo-seatbelt",
	TASK_CONTROL_LIVENESS: "task-control-liveness",
	TASK_PRESENTATION: "task-presentation",
	TOOL_RUNTIME_RELIABILITY: "tool-runtime-reliability",
	UPSTREAM_INTAKE: "upstream-intake",
	WEBVIEW_SEAM_AOP: "webview-seam-aop",
} as const;

/** The board file — the operational index that owns the frontier tables. */
export const BOARD = ".factory/epic-board.md";
/** The frozen navigation / maintenance contract. NOT an epic. */
export const INDEX_CONTRACT = ".factory/epics/_index-contract.md";
