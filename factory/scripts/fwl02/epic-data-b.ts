#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/epic-data-b.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — reconciled epics, part B.
 *
 * Covers approval protection, architecture, approval/MCP authority and the
 * factory-infrastructure substrate.
 */

import type { ReconciledEpic } from "./reconciled-epics.ts";
import { BOARD } from "./reconciled-epics.ts";

const APPROVAL = ".factory/epics/approval-protection.md";
const APPROVAL_MCP = ".factory/epics/approval-mcp-authority.md";
const ARCH = ".factory/epics/architecture.md";
const _FACTORY = ".factory/epics/factory-infrastructure.md";

/** EPIC-CLINEMM-APPROVAL-PROTECTION — the approval-surface substrate. */
export const EPIC_APPROVAL_PROTECTION: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-APPROVAL-PROTECTION",
	source_file: ".factory/epics/approval-protection.md",
	title: "Approval protection",
	original_status:
		"ACTIVE — command-policy recon CLOSED + YOLO approval-bypass DEFER (de-queued) + editor/tool approval-friction recon NEXT + classic-protection recon OPEN + HOST-TEST RUNNER OPEN as the host-only-behaviour dependency",
	lifecycle: "ACTIVE",
	priority: "P1",
	source_priority: "P1",
	exit_criteria: [
		"A new command-risk classifier ACT lands (V1.x or V2.x correction) — append to `command-risk-classification.md` ledger row; defer here.",
		"A new approval-friction recon lands (a future editor/tool ACT, or a future classic-protection ACT) — append to this file's ACT ledger row.",
		"A new temporary YOLO bypass proposal is raised — first check the `defer-not-bypass` rule: any new ACT must prove the substrate is insufficient against the production-equivalent composition, not just propose a workaround.",
		"A new classic (non-Seatbelt) approval protection recon ACT lands — append to this file's ACT ledger row.",
		"A new host-only-behaviour dependency lands — append to this file's ACT ledger row.",
	],
	source_refs: [
		{ path: APPROVAL, lines: [14, 20] },
		{ path: APPROVAL, lines: [42, 66] },
	],
	items: [
		{
			item_id: "EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
			title:
				"ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01 — editor/tool YOLO confirmation-UI recon",
			description:
				"Recon of the non-command / editor-tool YOLO confirmation UI surface. Phase 0 captures one live YOLO confirmation UI and freezes `TOOL_NAME / TOOL_INPUT_KIND / YOLO_EFFECTIVE / SEATBELT_EFFECTIVE / UI_PROMPT_TYPE / PROMPT_OCCURS_BEFORE_OR_AFTER_TOOL_EXECUTION`. Phase 1 traces the `SdkController` non-command tool approval callback at `SdkController.ts:799..818` (where `shouldAutoApproveTool` reads `autoApprovalSettings.actions.editFiles` / `.editFilesExternally` / MCP per-tool flags + session override) and freezes `TOOL_POLICY_SOURCE / SESSION_OVERRIDE_SOURCE / AUTO_APPROVAL_SETTINGS_SOURCE / REQUEST_TOOL_APPROVAL_CALLBACK / FINAL_UI_PROMPT_SEAM`. Phase 2: exact RED with YOLO+Seatbelt on the live-prompt tool; possible outcomes — `callback=ASK` → policy defect, `callback=ALLOW` + UI still prompts → completion/UI seam defect (most likely per upstream #13114), callback never reached → seam moved. Per upstream SDK docs, tool auto-approval is a SEPARATE surface from command policy. SCOPE_BOUNDARY: this ACT is the non-command / editor-tool YOLO confirmation UI surface (frozen §0 invariant: `VS Code interactive Act mode + YOLO_REQUESTED + Seatbelt selected+available + relevant editing permission enabled ⇒ an ordinary native editing tool MUST NOT require an additional user approval before execution`). It is NOT a generic approval-friction catchall: command-policy friction is owned by safe-yolo-seatbelt.md (R5 + workspace-realpath family), and live command-policy ASK is owned by `ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02`. Sibling — not superseded-by — the command-policy lanes.",
			workstream: "approval-protection",
			original_status: "NEXT / HIGH",
			lifecycle: "ACTIVE",
			priority: "P1",
			source_priority: "HIGH",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [
				"Operator-driven live editor/non-command specimen plus host/Aqua availability are the remaining gates; the completion-authority prerequisite is SATISFIED per `SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01` (CLOSED / UPSTREAM_SUPERSEDED at `15c7e3374`).",
			],
			current_act: "ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
			related_acts: ["ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01"],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/captures/specimen-20260827-command-approval01.json",
			],
			reopen_conditions: [
				"A new approval-friction recon lands (a future editor/tool ACT, or a future classic-protection ACT) — append to this file's ACT ledger row.",
			],
			source_refs: [{ path: APPROVAL, lines: [44, 44] }],
			/**
			 * No RELATED_TO edge.
			 *
			 * The runtime-task-progression.md representation of this obligation
			 * was a SECOND REPRESENTATION of the SAME engineering obligation.
			 * The authoritative owner is this epic: the board's Current
			 * frontier lane "Approval / editor-tool" points at
			 * `approval-protection.md`. The secondary representation is
			 * preserved in `reconciliation.json` and in the supplemental
			 * source accounting; it does not become an independent
			 * lifecycle-bearing obligation and therefore carries no edge here.
			 */
			relationships: [],
		},
		{
			item_id: "CLASSIC-PROTECTION-RECON01",
			title:
				"ACT-CLINEMM-CLASSIC-PROTECTION-RECON01 — classic (non-Seatbelt) approval protection recon",
			description:
				"Classic (non-Seatbelt) approval protection recon — the next-frontier after Safe-YOLO is fully closed. Unblocked by `SEATBELT-DEFAULT-ON01` closure (now satisfied). Likely first deliverable: characterize the path-authority / command-policy / network-read surfaces that take over when Seatbelt is OFF, and compare them to the Seatbelt-confined boundaries to identify any drift.",
			workstream: "approval-protection",
			original_status: "OPEN / HIGH",
			lifecycle: "OPEN",
			priority: "P1",
			source_priority: "HIGH",
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-CLASSIC-PROTECTION-RECON01",
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"A new classic (non-Seatbelt) approval protection recon ACT lands — append to this file's ACT ledger row.",
			],
			source_refs: [{ path: APPROVAL, lines: [43, 43] }],
			/**
			 * No RELATED_TO edge.
			 *
			 * The safe-yolo-seatbelt.md representation of this obligation was
			 * a SECOND REPRESENTATION of the SAME engineering obligation. The
			 * authoritative owner is this epic: the board's Current frontier
			 * lane "Approval / classic" points at `approval-protection.md`.
			 * The secondary representation is preserved in
			 * `reconciliation.json` and in the supplemental source
			 * accounting; it does not become an independent lifecycle-bearing
			 * obligation and therefore carries no edge here.
			 */
			relationships: [],
		},
		{
			item_id: "BYPASS01",
			title: "BYPASS01 — temporary YOLO bypass (de-queued)",
			description:
				"Temporary YOLO bypass proposal, de-queued. The board's Deferred / hold table records it as consciously postponed; the source states it is only reconsidered if `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` rediscovers it.",
			workstream: "approval-protection",
			original_status: "DEFER",
			lifecycle: "DEFERRED",
			priority: "P1",
			source_priority: "P1",
			relationships: [],
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"`EDITOR-TOOL-APPROVAL-FRICTION-RECON01` rediscovers the bypass need.",
			],
			source_refs: [{ path: BOARD, lines: [9431, 9431] }],
		},
		{
			item_id: "DESTRUCTIVE-SCOPE-REFINEMENT-RECON",
			title:
				"ACT-CLINEMM-DESTRUCTIVE-SCOPE-REFINEMENT-RECON01 — destructive scope refinement",
			description:
				'Introduce a future REFINE_SCOPE decision between ALLOW/ASK/DENY for broad or selector-based destructive mutations. Core doctrine: `BROAD_MUTATION != AUTHORIZED_MUTATION` — a broad/selector-based action must deterministically estimate/expand impact where safely possible, force an additional model intent-refinement turn, require an exact bounded target set + intended postcondition, re-evaluate normal policy from scratch, and execute only the precise replacement request. The refinement model is NOT an independent reviewer; the host remains authority. Initial exemplars: `rm *.tmp`, `rm -rf generated/`, `find ... -delete`, `git clean -fdx`. Doctrine anchors: upstream Cline approvals allow an agent to reformulate after a denied tool call, so the typed REFINE_SCOPE response plugs into an existing behavioral substrate; a syntactic-only rm/find classifier is demonstrably brittle in other coding agents, so future doctrine must be semantic scope refinement, not more regex. Anti-patterns: NO "Are you sure?" self-review; NO free-form "explain why this is safe" as sufficient proof; NO rm-specific regex-only architecture; NO automatic execution merely because the second model turn agrees.',
			workstream: "approval-protection",
			original_status: "FUTURE / UNIMPLEMENTED",
			lifecycle: "DEFERRED",
			priority: "P1",
			source_priority: "HIGH",
			relationships: [],
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01/reconciliation.md (FW-01, recorded 2026-08-29 by the thread-future-work normalization ACT)",
			],
			reopen_conditions: [
				"A live broad-mutation specimen is captured and the current command-policy surface admits it without a refinement turn.",
				"The command-risk V3 family explicitly needs a typed REFINE_SCOPE family.",
				"Upstream Cline ships an analogous REFINE_SCOPE primitive that warrants a parity recon.",
			],
			source_refs: [{ path: APPROVAL, lines: [67, 130] }],
		},
		{
			item_id: "APPROVAL-TRANSACTION-RECORDER-FUTURE-WORK",
			title: "Approval transaction recorder — future work",
			description:
				'Already carried by the existing `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` "Reopen / new-work conditions" block; recorded here so a future reviewer can find it from this epic\'s deferred section as well. Future seam: the smallest DEFAULT_OFF persistent approval transaction recorder at the real approval entry/terminal seam. Required future fields: schema version, timestamp, session identity, task identity if available, canonical approval / correlation identity, tool name, policy auto-approve state, `shouldAutoApproveTool` result, ENTRY | TERMINAL, approved/rejected/cancelled outcome. Constraints: no policy change; no diagnostic side effect inside semantic state updaters; no heuristic toolName + timestamp identity; no "latest pending approval" correlation; bounded / removable / default-off; reuse canonical approval identity if the current runtime supplies one. The existing `tools/factory/capture-approval-specimen.py` remains the consumer; do not redesign it.',
			workstream: "approval-protection",
			original_status: "FUTURE / UNIMPLEMENTED",
			lifecycle: "DEFERRED",
			priority: "P1",
			source_priority: "HIGH",
			relationships: [],
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: ["ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01"],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01/reconciliation.md (FW-02, recorded 2026-08-29)",
				".factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/captures/specimen-20260827-command-approval01.json",
			],
			reopen_conditions: [],
			source_refs: [{ path: APPROVAL, lines: [132, 167] }],
		},
	],
};

/**
 * EPIC-CLINEMM-ARCHITECTURE — the architectural substrate.
 *
 * The `architecture.md` detail file is the source that RECOVERS the meaning of
 * E8 and E9 (W4 Candidate 3). The previous mechanical extraction produced
 * them without engineering descriptions; the source text below supplies the
 * actual purpose statements.
 */
export const EPIC_ARCHITECTURE: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-ARCHITECTURE",
	source_file: ".factory/epics/architecture.md",
	title: "Architecture",
	original_status: "ACTIVE — open recon + held epics",
	lifecycle: "ACTIVE",
	priority: "P2",
	source_priority: "P2",
	exit_criteria: [
		"E7 evidence and dependencies justify legacy writer retirement (→ unblock E8).",
		"E8 unblocks E9 (→ effect interpreter work begins).",
		"E9 unblocks ELMIZATION02 (→ authority-domain recon starts).",
		"The `NEEDS_CLASSIFICATION` historical rows (`ARCH-01`, `ARCH-02`) get a bounded reclassification ACT.",
	],
	source_refs: [
		{ path: ARCH, lines: [5, 11] },
		{ path: ARCH, lines: [34, 52] },
	],
	items: [
		{
			item_id: "E8",
			title: "E8 — legacy writer retirement",
			description:
				"Retire the remaining legacy writer authority, but only when E7 evidence and dependencies justify it. Explicitly HELD: no action in this board ACT. Reopen condition: E7 evidence and dependencies justify legacy writer retirement.",
			workstream: "architecture",
			original_status: "HOLD",
			lifecycle: "DEFERRED",
			priority: "P2",
			source_priority: "P2",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [
				"E7 evidence and dependencies must justify legacy writer retirement before E8 can be unblocked.",
			],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"E7 evidence and dependencies justify legacy writer retirement (→ unblock E8).",
			],
			source_refs: [
				{ path: ARCH, lines: [38, 38] },
				{ path: BOARD, lines: [9432, 9432] },
			],
			/**
			 * E8 carries NO DEPENDS_ON edge.
			 *
			 * The source states the ordering as `E7 -> E8 -> E9 -> ELMIZATION02`:
			 * "E8 unblocks E9" means E8 COMPLETES BEFORE E9, so the prerequisite
			 * edge belongs to E9 (E9 DEPENDS_ON E8), not to E8. Emitting the edge
			 * on both sides creates a cycle and contradicts the recovered
			 * source description.
			 *
			 * E7 is named by the source ONLY as a precondition for E8, so it is
			 * carried as E8's explicit BLOCKER (above) and is NOT invented as a
			 * work item or as a schedulable edge.
			 */
			relationships: [],
		},
		{
			item_id: "E9",
			title: "E9 — effect interpreter",
			description:
				"Bounded effect execution / interpreter work, sequenced AFTER E8. Explicitly HELD: no action in this board ACT. Reopen condition: E8 unblocks E9, at which point the effect interpreter work begins.",
			workstream: "architecture",
			original_status: "HOLD",
			lifecycle: "DEFERRED",
			priority: "P2",
			source_priority: "P2",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [
				"E8 (legacy writer retirement) must complete before E9 (effect interpreter) begins.",
			],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: ["E8 unblocks E9 (→ effect interpreter work begins)."],
			source_refs: [
				{ path: ARCH, lines: [39, 39] },
				{ path: BOARD, lines: [9433, 9433] },
			],
			relationships: [
				{
					kind: "DEPENDS_ON",
					target: "EPIC-CLINEMM-ARCHITECTURE/E8",
					required_outcome: "E8 completion unblocks E9",
					source_refs: [{ path: ARCH, lines: [44, 44] }],
				},
			],
		},
		{
			item_id: "ELMIZATION02",
			title: "EPIC-CLINEMM-ELMIZATION02 — authority-domain migration",
			description:
				'Migrate deterministic behavioral authority where doing so reduces duplicated state/policy decisions. Target direction: Elm → deterministic state transitions / policy / projections; TypeScript → VS Code APIs + effects; React → rendering / DOM/event adaptation. Forbidden goal: "Rewrite everything in Elm". First post-E9 action: authority-domain recon. Gated on E9.',
			workstream: "architecture",
			original_status: "OPEN",
			lifecycle: "BLOCKED",
			priority: "P2",
			source_priority: "P2",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [
				"E9 (effect interpreter) must complete before ELMIZATION02's authority-domain recon starts.",
			],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"E9 unblocks ELMIZATION02 (→ authority-domain recon starts).",
			],
			source_refs: [{ path: ARCH, lines: [40, 40] }],
			relationships: [
				{
					kind: "DEPENDS_ON",
					target: "EPIC-CLINEMM-ARCHITECTURE/E9",
					required_outcome: "E9 completion unblocks ELMIZATION02",
					source_refs: [{ path: ARCH, lines: [45, 45] }],
				},
			],
		},
	],
};

/**
 * EPIC-CLINEMM-APPROVAL-MCP-AUTHORITY — the MCP auto-approval authority lane.
 *
 * The source's epic file has no "Open work" section; the obligation is stated
 * in its "Current status" block and corroborated by the board's Current
 * frontier table.
 */
export const EPIC_APPROVAL_MCP_AUTHORITY: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-APPROVAL-MCP-AUTHORITY",
	source_file: ".factory/epics/approval-mcp-authority.md",
	title: "Approval / MCP authority",
	original_status: "OPEN — recon ACT has not yet been opened",
	lifecycle: "OPEN",
	priority: "P1",
	source_priority: "P0-if-reproduced",
	exit_criteria: [
		"Sequenced after this ACT (gated on its verdict): a bounded repair ACT only if recon proves a defect, or `SUPERSEDED` closure if recon exonerates.",
	],
	source_refs: [
		{ path: APPROVAL_MCP, lines: [11, 18] },
		{ path: BOARD, lines: [9376, 9376] },
	],
	items: [
		{
			item_id: "MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01",
			title:
				"ACT-CLINEMM-MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01 — MCP auto-approval-off authority recon",
			description:
				'Read-only recon of the MCP auto-approval-off authority boundary (upstream #10499). No production change until the recon resolves the live-vs-structural question. Per the factory causal reviewer (2026-09-01): "Give it its own authority owner." The upstream defect says execution proceeds without approval, which is a fail-closed-against-the-user violation — hence `P0-if-reproduced` (deterministic security boundary). Blocked by: n/a. Sequenced after this ACT (gated on its verdict): a bounded repair ACT only if recon proves a defect, or `SUPERSEDED` closure if recon exonerates.',
			workstream: "approval-mcp-authority",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "P1",
			source_priority: "P0-if-reproduced",
			relationships: [],
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01",
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"A bounded repair ACT only if recon proves a defect, or `SUPERSEDED` closure if recon exonerates.",
			],
			source_refs: [{ path: APPROVAL_MCP, lines: [13, 17] }],
		},
	],
};
