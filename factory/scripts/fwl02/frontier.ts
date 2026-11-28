#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/frontier.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — the frontier document.
 *
 * `frontier.md` is a machine-consumed FWMI v1 artifact: it is the concise,
 * source-bound description of the RECOVERED CURRENT EXECUTION FRONTIER.
 *
 * RECONCILIATION POSTURE (W2):
 *
 *   - An engineering OBLIGATION is separated from an ACT EXECUTION ATTEMPT.
 *   - An ACT closure does NOT necessarily retire its engineering obligation.
 *   - A historical P0 label does NOT remain a current confirmed P0.
 *   - A ready item does NOT carry execution authorization.
 *   - Where source records disagree, the conflict is retained as unresolved
 *     and referenced by its reconciliation record, not silently resolved.
 */

import type { ReconciledEpic } from "./reconciled-epics.ts";
import { RECONCILIATION_RECORDS } from "./reconciliation-data.ts";

/** One frontier entry: a work item that is part of the current work. */
interface FrontierEntry {
	readonly item_id: string;
	readonly title: string;
	readonly workstream: string;
	readonly lifecycle: string;
	readonly priority: string | null;
	readonly original_status: string | null;
	readonly qualification: string;
	readonly current_act: string | null;
	readonly blockers: readonly string[];
	readonly dependencies: readonly string[];
	readonly source_paths: readonly string[];
	readonly note: string | null;
}

/**
 * The frontier entries, recovered from the source's own frontier statements.
 *
 * The board's "Current frontier" table is the operational index; the epic
 * detail files carry the engineering description. The entries below are the
 * union of:
 *
 *   - every board Current-frontier lane whose state is not CLOSED, and
 *   - every epic Open-work item that is not explicitly DEFERRED.
 */
const FRONTIER_ENTRIES: readonly FrontierEntry[] = [
	{
		item_id:
			"EPIC-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY/FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01",
		title: "File-tool workspace-escape authority recon",
		workstream: "file-tool-workspace-realpath-authority",
		lifecycle: "ACTIVE",
		priority: "P0",
		original_status: "OPEN (RECON lane)",
		qualification: "UNQUALIFIED",
		current_act: "ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01",
		blockers: [],
		dependencies: [],
		source_paths: [
			".factory/epic-board.md",
			".factory/epics/file-tool-workspace-realpath-authority.md",
		],
		note: "The board's Current frontier table records this lane as taking priority over the post-Q5-GREEN Waiting qualification (`FRESH_POST_REPAIR_LIVE = PENDING / NON-BLOCKING` does NOT gate this ACT). The lane is `OPEN (RECON lane)` with reviewer verdict `C1: GO_FILE_TOOL_SECURITY_RECON` on commit `217e7f53c`. The live-failure bind is still pending (`NO_LIVE_FAIL_BIND_YET`): the observed `/Projects/Runtime/...` mutation is a containment-boundary candidate, not yet bound to a creator.",
	},
	{
		item_id:
			"EPIC-CLINEMM-APPROVAL-MCP-AUTHORITY/MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01",
		title: "MCP auto-approval-off authority recon",
		workstream: "approval-mcp-authority",
		lifecycle: "OPEN",
		priority: "P0-if-reproduced",
		original_status: "OPEN",
		qualification: "UNQUALIFIED",
		current_act: "ACT-CLINEMM-MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01",
		blockers: [],
		dependencies: [],
		source_paths: [
			".factory/epic-board.md",
			".factory/epics/approval-mcp-authority.md",
		],
		note: "Deterministic security boundary: the upstream defect says execution proceeds without approval, which is a fail-closed-against-the-user violation. Priority is `P0-if-reproduced` — the priority is conditional on recon, and is NOT asserted as a current confirmed P0. Read-only recon; no production change until the live-vs-structural question resolves.",
	},
	{
		item_id:
			"EPIC-CLINEMM-APPROVAL-PROTECTION/EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
		title: "Editor/tool YOLO confirmation-UI recon",
		workstream: "approval-protection",
		lifecycle: "ACTIVE",
		priority: "HIGH",
		original_status: "NEXT / HIGH",
		qualification: "UNKNOWN",
		current_act: "ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
		blockers: [
			"Operator-driven live editor/non-command specimen plus host/Aqua availability are the remaining gates; the completion-authority prerequisite is SATISFIED.",
		],
		dependencies: [],
		source_paths: [
			".factory/epics/approval-protection.md",
			".factory/epics/runtime-task-progression.md",
		],
		note: 'CONFLICTED FRONTIER STATE. The two epic files record the lane as NEXT (approval-protection.md Open work; runtime-task-progression.md Open work states "Now restored to NEXT with the prior IMPLEMENTATION01 blocker removed"), while the board\'s Current frontier table records the SAME lane as `HOLD`. Both claims are preserved; see the SOURCE_CONFLICT reconciliation record. The ACT is authorized to proceed in its recon phases but the live specimen gate is outstanding — readiness is not execution authorization.',
	},
	{
		item_id: "EPIC-CLINEMM-APPROVAL-PROTECTION/CLASSIC-PROTECTION-RECON01",
		title: "Classic (non-Seatbelt) approval protection recon",
		workstream: "approval-protection",
		lifecycle: "OPEN",
		priority: "HIGH",
		original_status: "OPEN / HIGH",
		qualification: "UNQUALIFIED",
		current_act: "ACT-CLINEMM-CLASSIC-PROTECTION-RECON01",
		blockers: [],
		dependencies: [],
		source_paths: [
			".factory/epics/approval-protection.md",
			".factory/epics/safe-yolo-seatbelt.md",
		],
		note: "The next-frontier after Safe-YOLO is fully closed. Unblocked by `SEATBELT-DEFAULT-ON01` closure (now satisfied) — the source states the blocker is resolved, so this is NOT blocked.",
	},
	{
		item_id: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT/HOST-TEST-RUNNER",
		title: "HOST-TEST RUNNER — host-orchestrated end-to-end test runner",
		workstream: "safe-yolo-seatbelt",
		lifecycle: "OPEN",
		priority: "HIGH",
		original_status: "OPEN / HIGH",
		qualification: "UNQUALIFIED",
		current_act: null,
		blockers: [],
		dependencies: [],
		source_paths: [
			".factory/epics/safe-yolo-seatbelt.md",
			".factory/epics/host-test-infrastructure.md",
		],
		note: "Board row 18, `HOST_REQUIRED`. The canonical detail file is host-test-infrastructure.md; the safe-yolo and approval-protection rows are explicit cross-links to the same obligation. Must be authored as a NEW ACT — do NOT roll the runner into an existing closed ACT, which would invalidate closure evidence.",
	},
	{
		item_id: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT/R5-MANUAL-APPROVAL-LANE",
		title: "R5 manual approval lane — open R5 defect trigger",
		workstream: "safe-yolo-seatbelt",
		lifecycle: "OPEN",
		priority: "P0",
		original_status: "OPEN",
		qualification: "UNQUALIFIED",
		current_act: null,
		blockers: [],
		dependencies: [],
		source_paths: [".factory/epics/safe-yolo-seatbelt.md"],
		note: "Not a separate ACT — a standing trigger that reopens the R5 lane when a genuine R5 defect matches the `NEXT_R5_TRIGGER` predicate (mode=all + mandatorySeatbelt=true + all path-bearing operands inside authorized workspace roots + no explicit deny / hard floor / missing evidence, AND `finalDecision=ask` AND the approval UI published).",
	},
	{
		item_id:
			"EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION/RUNTIME-TASK-PROGRESSION-RECON01",
		title: "Runtime task progression recon",
		workstream: "runtime-task-progression",
		lifecycle: "OPEN",
		priority: "HIGH",
		original_status: "HIGH",
		qualification: "UNKNOWN",
		current_act: "ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01",
		blockers: [],
		dependencies: [],
		source_paths: [".factory/epics/runtime-task-progression.md"],
		note: "OWN01 RED reproduced at HEAD `f106bc63d`; OWN02-OWN03-RECON at CAPTURE_INSUFFICIENT. The producer-side successor `ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01` is CLOSED / VERDICT_AMENDED / NOT_LIVE_CAUSE. The source's operational action is `RETURN_TO_SSH_LIVE_QUALIFICATION` and it explicitly says `DO NOT open ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-REPAIR01`.",
	},
	{
		item_id:
			"EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION/CANCEL-AFFORDANCE-AUTHORITY-RECON",
		title: "Cancel-affordance authority recon",
		workstream: "runtime-task-progression",
		lifecycle: "OPEN",
		priority: "HIGH",
		original_status: "HIGH — partial",
		qualification: "INSUFFICIENT",
		current_act: null,
		blockers: [
			"The LIVE four-value capture half is outstanding; the static source-seam map half is already bound.",
		],
		dependencies: [],
		source_paths: [".factory/epics/runtime-task-progression.md"],
		note: "The static source-seam map half is bound by `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` (CLOSED / RECON_ONLY / CAPTURE_INSUFFICIENT). The LIVE capture half requires an operator-driven four-value capture to discriminate `UI_RENDER_DEFECT` from `TURN_STATE_PROJECTION_DEFECT` from benign non-streaming phases.",
	},
	{
		item_id:
			"EPIC-CLINEMM-CONTEXT-COMPACTION-TOKEN-ACCOUNTING/COMPACTION-HEADER-BAR-FRESHNESS-RECON01",
		title: "Post-compaction header-bar freshness recon",
		workstream: "context-compaction-token-accounting",
		lifecycle: "ACTIVE",
		priority: "P1",
		original_status: "OPEN 2026-09-02; RECON_ONLY",
		qualification: "PARTIAL",
		current_act: "ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01",
		blockers: [
			"The recon MUST author the real RED only after the C1/C2/C3 semantic contract is frozen.",
		],
		dependencies: [],
		source_paths: [
			".factory/epic-board.md",
			".factory/epics/context-compaction-token-accounting.md",
		],
		note: "Defect A (cross-scale arithmetic) and Defect B (post-restore publication) are CLOSED at HEAD. Defect C (post-compaction header-bar staleness) is a LIVE consumer-level witness, but FULL_UI_PRODUCTION_SEAM_REPRODUCTION = NOT YET: the committed 2/2 test exercises the shared metrics consumer, NOT the actual ChatView → ContextWindow/TaskHeader render chain. WIRE_KIND_CHANGE = NOT_AUTHORIZED_YET.",
	},
	{
		item_id: "EPIC-CLINEMM-QUALITY-SUBSTRATE/CODE-COVERAGE-BASELINE01",
		title: "Code-coverage baseline",
		workstream: "quality-substrate",
		lifecycle: "OPEN",
		priority: "HIGH",
		original_status: "OPEN / HIGH",
		qualification: "UNQUALIFIED",
		current_act: "ACT-CLINEMM-CODE-COVERAGE-BASELINE01",
		blockers: [],
		dependencies: [],
		source_paths: [
			".factory/epics/quality-substrate.md",
			".factory/epic-board.md",
		],
		note: "The ratchet ACT (`CODE-COVERAGE-RATCHET01`) is closed and ready to enforce non-regression once the baseline is set; the baseline itself is not yet fixed.",
	},
	{
		item_id: "EPIC-CLINEMM-QUALITY-SUBSTRATE/TYPECHECK-ZERO-BASELINE01",
		title: "Typecheck zero-diagnostic baseline — CI parity leg",
		workstream: "quality-substrate",
		lifecycle: "BLOCKED",
		priority: "P1",
		original_status: "CLOSED at local canonical seam; OPEN at CI parity",
		qualification: "PARTIAL",
		current_act: null,
		blockers: [
			"The CI-parity leg is tracked under `EPIC-CLINEMM-GITHUB-ACTIONS01`; the workflow does not currently gate the canonical tsc command.",
		],
		dependencies: ["EPIC-CLINEMM-DISTRIBUTION-CI/GITHUB-ACTIONS01"],
		source_paths: [
			".factory/epics/quality-substrate.md",
			".factory/epic-board.md",
		],
		note: "CLOSED at the local canonical seam; OPEN at CI parity. This is an explicitly source-stated DEPENDS_ON, not an inferred dependency.",
	},
	{
		item_id: "EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/TASK-COST-TRUTH-RECON01",
		title: "Two-layer cost-provenance recon",
		workstream: "product-config-branding",
		lifecycle: "BLOCKED",
		priority: "P1",
		original_status: "OPEN / HOLD_FOR_EXECUTION",
		qualification: "UNKNOWN",
		current_act: "ACT-CLINEMM-TASK-COST-TRUTH-RECON01",
		blockers: [
			"Held until the operational frontier (`EDITOR-TOOL-APPROVAL-FRICTION-RECON01`, `OPEN / WAITING_FOR_LIVE_SPECIMEN`) is bound; sequenced next after that.",
		],
		dependencies: [],
		source_paths: [".factory/epics/product-config-branding.md"],
		note: "Recon-only. The closing condition is `(Layer-1, Layer-2)`. Until §3 produces a specimen, `CORRECTNESS = UNKNOWN` and the dollar amount is NEVER the stop rule.",
	},
	{
		item_id:
			"EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01",
		title: "Upstream settings-surface parity recon",
		workstream: "product-config-branding",
		lifecycle: "BLOCKED",
		priority: "P2",
		original_status: "OPEN / HOLD_FOR_EXECUTION",
		qualification: "PARTIAL",
		current_act: "ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01",
		blockers: [
			"Held until the operational frontier is bound; sequenced after `TASK-COST-TRUTH-RECON01`.",
		],
		dependencies: [],
		source_paths: [
			".factory/epics/product-config-branding.md",
			".factory/epic-board.md",
		],
		note: "CONFLICTED FRONTIER STATE — see the SOURCE_CONFLICT and OPERATOR_JUDGEMENT reconciliation records. The epic file places the ACT here as `OPEN / HOLD_FOR_EXECUTION` with a TENTATIVE placement pending the ACT's §11 owning-epic decision tree; the board's Current frontier table records the same lane as `CLOSED_V2` with no NEXT. The migration does not assert either as a closure.",
	},
	{
		item_id: "EPIC-CLINEMM-ARCHITECTURE/ELMIZATION02",
		title: "ELMIZATION02 — authority-domain migration",
		workstream: "architecture",
		lifecycle: "BLOCKED",
		priority: "P2",
		original_status: "OPEN",
		qualification: "UNKNOWN",
		current_act: null,
		blockers: [
			"E9 (effect interpreter) must complete before ELMIZATION02's authority-domain recon starts.",
		],
		dependencies: ["EPIC-CLINEMM-ARCHITECTURE/E9"],
		source_paths: [".factory/epics/architecture.md"],
		note: 'Target direction: Elm → deterministic state transitions / policy / projections; TypeScript → VS Code APIs + effects; React → rendering / DOM/event adaptation. Forbidden goal: "Rewrite everything in Elm".',
	},
	{
		item_id:
			"EPIC-CLINEMM-FACTORY-INFRASTRUCTURE/GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01",
		title: "Local pre-push force-push guard",
		workstream: "factory-infrastructure",
		lifecycle: "OPEN",
		priority: "P2",
		original_status: "OPEN (P2, non-blocking)",
		qualification: "UNQUALIFIED",
		current_act: "ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01",
		blockers: [],
		dependencies: [],
		source_paths: [
			".factory/epics/factory-infrastructure.md",
			".factory/epic-board.md",
		],
		note: "Defense-in-depth second line behind the GitHub ruleset `cline-- protect published history` (`id=21037630`).",
	},
	{
		item_id: "EPIC-CLINEMM-DISTRIBUTION-CI/GITHUB-ACTIONS01",
		title: "GitHub Actions recon",
		workstream: "distribution-ci",
		lifecycle: "OPEN",
		priority: "P2",
		original_status: "OPEN",
		qualification: "UNQUALIFIED",
		current_act: "ACT-CLINEMM-GITHUB-ACTIONS-RECON01",
		blockers: [],
		dependencies: [],
		source_paths: [
			".factory/epics/distribution-ci.md",
			".factory/epic-board.md",
		],
		note: "Recon first, repair never — the first ACT is a recon, not a repair. This is the dependency target for the quality-substrate typecheck CI-parity leg.",
	},
	{
		item_id:
			"EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY/TOOL-RUNTIME-RELIABILITY-RECON01",
		title: "Tool/command runtime-correctness recon",
		workstream: "tool-runtime-reliability",
		lifecycle: "OPEN",
		priority: "HIGH",
		original_status: "HIGH",
		qualification: "UNKNOWN",
		current_act: null,
		blockers: [],
		dependencies: [],
		source_paths: [".factory/epics/tool-runtime-reliability.md"],
		note: "No ACT authored yet; this is a working label. The deliverable characterizes each of the 7 clusters, promotes only those passing the strict destination-contract test, and does NOT pre-classify cause. The 23 upstream issues remain RADAR / cluster-assigned.",
	},
	{
		item_id: "EPIC-CLINEMM-DYNAMIC-EDITING-BACKENDS/DIRAC-EDITING-RECON01",
		title: "Dirac-style editing-backend recon",
		workstream: "dynamic-editing-backends",
		lifecycle: "OPEN",
		priority: "P1",
		original_status: "OPEN",
		qualification: "UNQUALIFIED",
		current_act: null,
		blockers: [],
		dependencies: [],
		source_paths: [".factory/epics/dynamic-editing-backends.md"],
		note: "No ACT authored yet; this is a working label. Conservative-first ordering: recon first, abstraction second, backend integration third, qualification fourth.",
	},
	{
		item_id: "EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/BRANDING01",
		title: "Visible branding umbrella",
		workstream: "product-config-branding",
		lifecycle: "OPEN",
		priority: "P2",
		original_status: "OPEN",
		qualification: "UNQUALIFIED",
		current_act: "ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01",
		blockers: [],
		dependencies: [],
		source_paths: [".factory/epics/product-config-branding.md"],
		note: "First bounded slice `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01` (board row 24, `NEXT / MED`). Icon: `‖ → --`.",
	},
];

/**
 * Build the frontier markdown. The document is deterministic: the entries are
 * emitted in a fixed order.
 */
export function buildFrontierMarkdown(
	epics: readonly ReconciledEpic[],
): string {
	const lines: string[] = [];
	lines.push("# FWL02 — Recovered current execution frontier");
	lines.push("");
	lines.push(
		"> Recovered from the committed ClineMM engineering documentation by",
		"> `ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01`. The legacy board",
		"> (`.factory/epic-board.md`) remains authoritative until explicit cutover",
		"> approval. This document is a migration artifact, not a new authority.",
	);
	lines.push("");
	lines.push("## Reading rules");
	lines.push("");
	lines.push(
		"- An entry below is an **engineering obligation** recovered from source, not an ACT execution attempt.",
	);
	lines.push(
		"- `original_status` is the source's own status token, verbatim. `lifecycle` is the normalized view. `qualification` is a **historical source assertion**, never a newly verified acceptance.",
	);
	lines.push(
		"- A blocked entry names its blocker explicitly. A deferred obligation is NOT on this frontier.",
	);
	lines.push(
		"- Where source records disagree, the conflict is retained and referenced by its reconciliation record rather than silently resolved.",
	);
	lines.push("");
	lines.push("## Current obligations");
	lines.push("");
	for (const entry of FRONTIER_ENTRIES) {
		lines.push(`### ${entry.item_id}`);
		lines.push("");
		lines.push(`- **Title.** ${entry.title}`);
		lines.push(`- **Workstream.** ${entry.workstream}`);
		lines.push(`- **Lifecycle.** ${entry.lifecycle}`);
		lines.push(`- **Priority.** ${entry.priority ?? "(not stated)"}`);
		lines.push(
			`- **Original status (verbatim).** ${entry.original_status ?? "(not stated)"}`,
		);
		lines.push(`- **Historical qualification.** ${entry.qualification}`);
		lines.push(
			`- **Current ACT.** ${entry.current_act ?? "(none — no ACT is currently executing)"}`,
		);
		if (entry.dependencies.length > 0) {
			lines.push(`- **Depends on.** ${entry.dependencies.join("; ")}`);
		}
		for (const blocker of entry.blockers) {
			lines.push(`- **Blocker.** ${blocker}`);
		}
		if (entry.note) {
			lines.push(`- **Note.** ${entry.note}`);
		}
		lines.push(
			`- **Source.** ${entry.source_paths.map((p) => `\`${p}\``).join(", ")}`,
		);
		lines.push("");
	}
	lines.push("## Deferred obligations (not on the frontier)");
	lines.push("");
	lines.push(
		"Deferred work is explicitly postponed by the source. It is represented in the epic records with `lifecycle: DEFERRED` and is NOT part of the current execution frontier. Unknown source status is never represented as DEFERRED — it is represented as UNRESOLVED.",
	);
	lines.push("");
	for (const epic of epics) {
		for (const item of epic.items) {
			if (item.lifecycle !== "DEFERRED") {
				continue;
			}
			lines.push(
				`- \`${item.item_id}\` — ${item.title} (${item.original_status ?? "status not stated"}).`,
			);
		}
	}
	lines.push("");
	lines.push("## Unresolved engineering interpretation");
	lines.push("");
	lines.push(
		"Records whose migration information is insufficient or conflicting. These are NOT deferred and NOT terminal — they are explicitly unresolved and require operator reconciliation.",
	);
	lines.push("");
	for (const record of RECONCILIATION_RECORDS) {
		if (record.resolution !== "UNRESOLVED") {
			continue;
		}
		lines.push(`- **${record.kind}** — ${record.identities.join(", ")}.`);
	}
	lines.push("");
	lines.push("## IECR disposition");
	lines.push("");
	lines.push("`IECR_CONSOLIDATED_BOARD_NOT_PRESENT_IN_SOURCE`");
	lines.push("");
	lines.push(
		"The committed source contains no `EPIC-CLINEMM-IECR` epic document, no `.factory/epics/` file for it, and no board row naming it. The consolidated IECR epic board was never formally delegated to codium-clinemm; the operator will supply it separately for explicit new-epic registration rather than fabricated historical migration. This is not a repository migration defect.",
	);
	lines.push("");
	lines.push("## Qualification boundary");
	lines.push("");
	lines.push(
		"Actual Leamas import qualification is **NOT_EXECUTED** in this ACT. The mechanical extraction, the semantic reconciliation and the source-integrity verification recorded in `validation-receipt.json` are producer-side checks only. `SOURCE_RECONCILIATION_READY` authorizes operator-executed shadow qualification; it is not authoritative cutover approval.",
	);
	return `${lines.join("\n")}\n`;
}
