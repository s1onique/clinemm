#!/usr/bin/env bun

/**
 * factory/scripts/fwl02/epic-index.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — the reconciled epic set.
 *
 * This module is the single ordered list of every ACTUAL epic recovered from
 * the committed source, plus the reconciliation records and the historical ACT
 * index.
 *
 * EPIC SET MEMBERSHIP RULE (W1): `.factory/epics/_index-contract.md` is a
 * NAVIGATION / MAINTENANCE CONTRACT, not an epic. It is inventoried in the
 * source manifest with disposition `navigation` and it never becomes an epic
 * record. Every other `.factory/epics/*.md` file IS an actual epic and is
 * retained — including epics whose operational item collection is empty
 * (`task-presentation.md`, `closed-foundation.md`, `webview-seam-aop.md`,
 * `command-risk-classification.md`).
 */

import { EPIC_SAFE_YOLO_SEATBELT } from "./epic-data-a.ts";
import {
	EPIC_APPROVAL_MCP_AUTHORITY,
	EPIC_APPROVAL_PROTECTION,
	EPIC_ARCHITECTURE,
} from "./epic-data-b.ts";
import {
	EPIC_FACTORY_INFRASTRUCTURE,
	EPIC_HOST_TEST_INFRASTRUCTURE,
	EPIC_PRODUCT_CONFIG_BRANDING,
	EPIC_QUALITY_SUBSTRATE,
} from "./epic-data-c.ts";
import {
	EPIC_AUTHENTICATED_DEV_CAPABILITIES,
	EPIC_CLOSED_FOUNDATION,
	EPIC_COMMAND_RISK_CLASSIFICATION,
	EPIC_CONTEXT_COMPACTION,
	EPIC_DISTRIBUTION_CI,
	EPIC_DYNAMIC_EDITING,
	EPIC_FILE_TOOL_REALPATH,
	EPIC_RUNTIME_TASK_PROGRESSION,
	EPIC_TASK_CONTROL_LIVENESS,
	EPIC_TASK_PRESENTATION,
	EPIC_TOOL_RUNTIME_RELIABILITY,
	EPIC_UPSTREAM_INTAKE,
	EPIC_WEBVIEW_SEAM_AOP,
} from "./epic-data-d.ts";
import type { ReconciledEpic } from "./reconciled-epics.ts";

/**
 * Every actual epic, ordered by epic_id so the package is deterministic.
 *
 * The set corresponds exactly to the 22 tracked `.factory/epics/*.md` files
 * MINUS `_index-contract.md` (navigation, not an epic) = 21 actual epics.
 */
export const RECONCILED_EPICS: readonly ReconciledEpic[] = [
	EPIC_APPROVAL_MCP_AUTHORITY,
	EPIC_APPROVAL_PROTECTION,
	EPIC_ARCHITECTURE,
	EPIC_AUTHENTICATED_DEV_CAPABILITIES,
	EPIC_CLOSED_FOUNDATION,
	EPIC_COMMAND_RISK_CLASSIFICATION,
	EPIC_CONTEXT_COMPACTION,
	EPIC_DISTRIBUTION_CI,
	EPIC_DYNAMIC_EDITING,
	EPIC_FACTORY_INFRASTRUCTURE,
	EPIC_FILE_TOOL_REALPATH,
	EPIC_HOST_TEST_INFRASTRUCTURE,
	EPIC_PRODUCT_CONFIG_BRANDING,
	EPIC_QUALITY_SUBSTRATE,
	EPIC_RUNTIME_TASK_PROGRESSION,
	EPIC_SAFE_YOLO_SEATBELT,
	EPIC_TASK_CONTROL_LIVENESS,
	EPIC_TASK_PRESENTATION,
	EPIC_TOOL_RUNTIME_RELIABILITY,
	EPIC_UPSTREAM_INTAKE,
	EPIC_WEBVIEW_SEAM_AOP,
].sort((left, right) =>
	left.epic_id < right.epic_id ? -1 : left.epic_id > right.epic_id ? 1 : 0,
);
