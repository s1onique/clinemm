#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/reconciliation-data.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — reconciliation records.
 *
 * A reconciliation record preserves a source ambiguity, a conflict, a gap or
 * a cross-link that the source itself establishes. Records are DISTINCT: two
 * unrelated ambiguities are never merged merely because they share a `kind` or
 * a `resolution`.
 *
 * The record kinds used here:
 *
 *   DUPLICATE_REPRESENTATION — one engineering obligation represented in two
 *                              places; the source establishes one authority.
 *   SOURCE_CONFLICT          — the source carries competing claims that the
 *                              reconciliation cannot settle from source alone.
 *   UNRESOLVED_ASSOCIATION   — an association the source leaves open.
 *   CROSS_LINK               — an explicit cross-epic link.
 *   MISSING_INFORMATION      — the source does not carry the information.
 *   INCOMPLETE_COVERAGE      — a source region is accounted for but only
 *                              partially reconciled.
 *   OPERATOR_JUDGEMENT       — a decision the operator must make.
 *   SUPERSEDED                — an identity superseded by a successor.
 */

const SAFE = ".factory/epics/safe-yolo-seatbelt.md";
const APPROVAL = ".factory/epics/approval-protection.md";
const HOSTTEST = ".factory/epics/host-test-infrastructure.md";
const PRODUCT = ".factory/epics/product-config-branding.md";
const ARCH = ".factory/epics/architecture.md";
const RUNTIME = ".factory/epics/runtime-task-progression.md";
const FACTORY = ".factory/epics/factory-infrastructure.md";
const QUALITY = ".factory/epics/quality-substrate.md";
const BOARD = ".factory/epic-board.md";

/** One reconciliation record, pre-serialization. */
export interface ReconciledReconciliationRecord {
	readonly kind: string;
	readonly identities: readonly string[];
	readonly resolution:
		| "UNRESOLVED"
		| "RESOLVED"
		| "DUPLICATE"
		| "CONFLICT"
		| "SUPERSEDED";
	readonly reason: string;
	readonly source_refs: readonly {
		readonly path: string;
		readonly lines: readonly [number, number];
	}[];
}

/**
 * The reconciliation records.
 *
 * W4 Candidate 1 (`TEMP-INTERNAL-CONTROL-CLEANUP` under both product-config
 * and safe-yolo): the source establishes ONE obligation with a primary owner
 * and an explicit cross-link. The record below preserves both
 * representations without duplicating the obligation.
 */
export const RECONCILIATION_RECORDS: readonly ReconciledReconciliationRecord[] =
	[
		{
			kind: "DUPLICATE_REPRESENTATION",
			identities: [
				"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/TEMP-INTERNAL-CONTROL-CLEANUP",
				"EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/TEMP-INTERNAL-CONTROL-CLEANUP",
			],
			resolution: "DUPLICATE",
			reason:
				'W4 Candidate 1 RESOLVED by source inspection. The source establishes ONE engineering obligation represented twice. safe-yolo-seatbelt.md labels its row "TEMP-INTERNAL-CONTROL-CLEANUP (primary owner)" and states "This is the primary owner of the temporary / internal control cleanup inventory; the cross-cutting child in product-config-branding.md Deferred work is the secondary row because the eventual replacement is a settings surface." product-config-branding.md labels its row "TEMP-INTERNAL-CONTROL-CLEANUP (cross-cutting child of settings-parity)" and states "The primary owner is safe-yolo-seatbelt.md (the env controls are owned by the seatbelt substrate); this row in product-config-branding.md is a cross-link because the eventual replacement is a settings surface that lives in EPIC-CLINEMM-BRANDING01-adjacent settings UI." Both rows carry the SAME working label, the SAME proposed-ACT-ID doctrine, the SAME priority (P2 / DEFER), the SAME state (FUTURE / DEFER) and the SAME classification list. The migration therefore keeps the safe-yolo-seatbelt record as the primary owner and retains the product-config-branding record as an explicit CROSS_LINK — the obligation is NOT duplicated, and the cross-link does not silently duplicate it. The two records remain distinct rows so the source\'s two representations stay discoverable.',
			source_refs: [
				{ path: SAFE, lines: [110, 124] },
				{ path: PRODUCT, lines: [93, 100] },
				{ path: PRODUCT, lines: [131, 140] },
			],
		},
		{
			kind: "SOURCE_CONFLICT",
			identities: ["ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01"],
			resolution: "CONFLICT",
			reason:
				"W4 Candidate 2 — the source carries competing representations of one ACT identity, and the reconciliation preserves both rather than selecting one. (a) product-config-branding.md Open work places the ACT under THIS epic with original_status `OPEN / HOLD_FOR_EXECUTION` and states the placement is \"tentative epic placement pending the ACT's §11 owning-epic decision tree\", with the §3 inventory deferred and three epistemic guards held (GUARD_NO_WHOLESALE_UPSTREAM_COPY, GUARD_PRESERVE_DELIBERATE_DIVERGENCE, GUARD_NO_PTAD_TAB). (b) The board's Current frontier table records the SAME lane as `CLOSED_V2` with NEXT = (none), i.e. the operational index treats the settings-surface-parity lane as closed. The board's Active-epics table also does not list a settings-parity lane, and the board's \"Deferred / hold\" table does NOT list it. The migration therefore records the ACT as a BLOCKED obligation under product-config-branding (the epic-file placement is the durable, explicitly-scoped location) with qualification PARTIAL (recon §2 `PASS_RECON_SURFACE_MAPPED` at authorship, §3 inventory deferred) and records the board's `CLOSED_V2` frontier claim as a competing representation for OPERATOR JUDGEMENT. The migration does NOT assert that the ACT is closed: a `CLOSED_V2` frontier-lane state is not an ACT closure verdict, and the epic file's own placement instruction is the more specific authority for the ACT's identity.",
			source_refs: [
				{ path: PRODUCT, lines: [39, 39] },
				{ path: BOARD, lines: [9366, 9366] },
			],
		},
		{
			kind: "OPERATOR_JUDGEMENT",
			identities: ["ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01"],
			resolution: "UNRESOLVED",
			reason:
				"Operator decision required: does the board's `CLOSED_V2` Current-frontier state for the Settings-surface-parity lane retire the ACT, or does the epic file's explicit `OPEN / HOLD_FOR_EXECUTION` placement govern? The source does not settle this, and the ACT's own §11 owning-epic decision tree (which may spawn `EPIC-CLINEMM-SETTINGS-SUBSTRATE01`) has not landed in committed source. This record preserves the ambiguity rather than resolving it. The migration's chosen representation is the epic-file placement, which is the more specific and explicitly-scoped source statement; the competing board claim is preserved here.",
			source_refs: [
				{ path: PRODUCT, lines: [39, 39] },
				{ path: BOARD, lines: [9366, 9366] },
			],
		},
		{
			kind: "CROSS_LINK",
			identities: [
				"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/HOST-TEST-RUNNER",
				"EPIC-CLINEMM-APPROVAL-PROTECTION/HOST-TEST-RUNNER",
				"EPIC-CLINEMM-HOST-TEST-INFRASTRUCTURE/HOST-TEST-RUNNER",
			],
			resolution: "RESOLVED",
			reason:
				'One engineering obligation with THREE source representations, and the source establishes the ownership explicitly: safe-yolo-seatbelt.md and approval-protection.md both point at board row 18 as the working-label home, while host-test-infrastructure.md is the canonical detail file that "gives the working label a canonical detail file so the lane has durable backlog rather than a single-row reference". The source also states the cross-epic requirement: "Author as a new ACT ... do NOT roll the runner into an existing closed ACT (would invalidate closure evidence)". The migration keeps the host-test-infrastructure record as the canonical owner (it owns the durable detail file) and retains the safe-yolo and approval-protection representations as explicit CROSS_LINKs. The obligation is NOT triplicated.',
			source_refs: [
				{ path: SAFE, lines: [44, 44] },
				{ path: HOSTTEST, lines: [38, 40] },
			],
		},
		{
			kind: "DUPLICATE_REPRESENTATION",
			identities: [
				"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/CLASSIC-PROTECTION-RECON01",
				"EPIC-CLINEMM-APPROVAL-PROTECTION/CLASSIC-PROTECTION-RECON01",
			],
			resolution: "DUPLICATE",
			reason:
				"One engineering obligation with two source representations. safe-yolo-seatbelt.md Open work and approval-protection.md Open work both name `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01` with the same status (OPEN / HIGH), the same unblocking condition (`SEATBELT-DEFAULT-ON01` closure now satisfied), and the same first-deliverable description (characterize the path-authority / command-policy / network-read surfaces that take over when Seatbelt is OFF, and compare them to the Seatbelt-confined boundaries to identify any drift). The board's Current frontier table carries the lane once (`Approval / classic | P1 | OPEN | CLASSIC-PROTECTION-RECON01`). Both source representations are retained so each epic's frontier stays complete; the obligation itself is represented once per epic with an explicit RELATED_TO edge between them.",
			source_refs: [
				{ path: SAFE, lines: [45, 45] },
				{ path: APPROVAL, lines: [43, 43] },
			],
		},
		{
			kind: "DUPLICATE_REPRESENTATION",
			identities: [
				"EPIC-CLINEMM-APPROVAL-PROTECTION/EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
				"EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION/EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
			],
			resolution: "DUPLICATE",
			reason:
				"One engineering obligation with two source representations. approval-protection.md Open work names `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` as row 19 (NEXT / HIGH); runtime-task-progression.md Open work names the same ACT as restored to NEXT with the same completion-authority prerequisite (SATISFIED per `SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01` CLOSED / UPSTREAM_SUPERSEDED at `15c7e3374`) and the same remaining gates (operator-driven live editor/non-command specimen + host/Aqua availability). The board's Current frontier table carries the lane once (`Approval / editor-tool | P1 | HOLD | EDITOR-TOOL-APPROVAL-FRICTION-RECON01`). Both representations are retained with an explicit RELATED_TO edge.",
			source_refs: [
				{ path: APPROVAL, lines: [44, 44] },
				{ path: RUNTIME, lines: [78, 78] },
			],
		},
		{
			kind: "SOURCE_CONFLICT",
			identities: [
				"EPIC-CLINEMM-APPROVAL-PROTECTION/EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
			],
			resolution: "CONFLICT",
			reason:
				'The two source representations of the editor/tool recon carry DIFFERENT current states: approval-protection.md\'s Open work records `NEXT / HIGH` (replaces the de-queued BYPASS01 slot), while the board\'s Current frontier table records the SAME lane as `HOLD` with the NEXT column still naming the ACT, and the board\'s "Deferred / hold" table records BYPASS01 as DEFER with the NEXT column "(only if EDITOR-TOOL-APPROVAL-FRICTION-RECON01 rediscovers it)". The runtime-task-progression.md record states the ACT is "Now restored to NEXT with the prior IMPLEMENTATION01 blocker removed". The source therefore disagrees about whether the lane is NEXT or HOLD. Both claims are preserved: the epic-file records carry the more specific and more recent status (NEXT), the board\'s HOLD state is retained as a competing claim, and the conflict is surfaced for operator judgement rather than silently resolved. No acceptance authority is granted by either claim.',
			source_refs: [
				{ path: APPROVAL, lines: [44, 44] },
				{ path: BOARD, lines: [9358, 9358] },
				{ path: RUNTIME, lines: [78, 78] },
			],
		},
		{
			kind: "CROSS_LINK",
			identities: [
				"EPIC-CLINEMM-QUALITY-SUBSTRATE/TYPECHECK-ZERO-BASELINE01",
				"EPIC-CLINEMM-DISTRIBUTION-CI/GITHUB-ACTIONS01",
			],
			resolution: "RESOLVED",
			reason:
				"An explicit DEPENDS_ON relationship stated by the source: quality-substrate.md records that the typecheck umbrella's CI-parity leg is \"tracked under `EPIC-CLINEMM-GITHUB-ACTIONS01` for a future ACT\", and the board's Open-supporting-work table records `Typecheck CI parity | P1 | OPEN | GITHUB-ACTIONS01` with the dependency column naming `GITHUB-ACTIONS01`. The dependency is therefore a source-stated blocking prerequisite, not an inference from chronology. Only DEPENDS_ON establishes local execution prerequisite authority; the relationship carries the required outcome explicitly.",
			source_refs: [
				{ path: QUALITY, lines: [38, 38] },
				{ path: BOARD, lines: [9412, 9412] },
			],
		},
		{
			kind: "CROSS_LINK",
			identities: [
				"EPIC-CLINEMM-ARCHITECTURE/E8",
				"EPIC-CLINEMM-ARCHITECTURE/E9",
				"EPIC-CLINEMM-ARCHITECTURE/ELMIZATION02",
			],
			resolution: "RESOLVED",
			reason:
				'W4 Candidate 3 — the source establishes an explicit three-step ordering. architecture.md Open work states "E8 unblocks E9 (→ effect interpreter work begins)" and "E9 unblocks ELMIZATION02 (→ authority-domain recon starts)", and the same file\'s Reopen / new-work conditions repeat the chain. The board\'s Deferred / hold table records E8 HOLD "after E7 evidence + dependencies justify it" and E9 HOLD "after E8". The migration therefore recovers the actual engineering meanings of E8 and E9 (E8 = retire the remaining legacy writer authority once E7 evidence justifies it; E9 = bounded effect execution / interpreter work sequenced after E8) and records explicit DEPENDS_ON edges with required outcomes. E7 itself is not represented as a work item because the source names it only as a precondition, not as an obligation owned by this epic.',
			source_refs: [
				{ path: ARCH, lines: [38, 45] },
				{ path: BOARD, lines: [9432, 9433] },
			],
		},
		{
			kind: "SUPERSEDED",
			identities: ["ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01"],
			resolution: "SUPERSEDED",
			reason:
				'The historical experimental TypeScript FWMI adapter is preserved as historical evidence and is NOT an active capability. factory-infrastructure.md\'s ACT ledger records it as `SUPERSEDED — the ClineMM-side adapter is DISOWNED; Leamas owns the consumer`, and the Ownership section states the adapter "was an experiment in the wrong repository. It was removed; the evidence package of that ACT is retained as the historical record of the experiment, not as a canonical implementation." The migration therefore does NOT represent the adapter as a work item; it is indexed in `historical-index.json` as a historical execution whose disposition is SUPERSEDED. The FWL02 producer-side obligation is a SEPARATE identity (`EPIC-CLINEMM-FACTORY-INFRASTRUCTURE/FWL02-FWMI-V1-MIGRATION-INTERCHANGE`), and the superseded closure plan at `docs/closure-plans/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01.json` records verdict `SUPERSEDED`.',
			source_refs: [
				{ path: FACTORY, lines: [26, 26] },
				{ path: FACTORY, lines: [28, 44] },
			],
		},
		{
			kind: "MISSING_INFORMATION",
			identities: ["EPIC-CLINEMM-IECR"],
			resolution: "UNRESOLVED",
			reason:
				"IECR_CONSOLIDATED_BOARD_NOT_PRESENT_IN_SOURCE. The committed ClineMM source at SOURCE_HEAD contains no `EPIC-CLINEMM-IECR` epic document, no `.factory/epics/` file for it, and no board row naming it. The consolidated IECR epic board does not exist in Git and is therefore NOT represented in this migration. This is NOT a repository migration defect: the operator has indicated the consolidated IECR epic was never formally delegated to codium-clinemm, and the operator will supply the consolidated conversational IECR epic separately for explicit new-epic registration rather than fabricated historical migration. Individual repository-owned ACT contracts, reports and evidence relating to reasoning continuity, PCK, compaction, observability, recovery and dogfood remain accounted for normally through the ordinary epic records and the historical ACT index.",
			source_refs: [
				{ path: BOARD, lines: [9352, 9421] },
				{ path: FACTORY, lines: [19, 26] },
			],
		},
		{
			kind: "MISSING_INFORMATION",
			identities: ["EPIC-CLINEMM-ARCHITECTURE/E7"],
			resolution: "UNRESOLVED",
			reason:
				'E7 is named by the source ONLY as a precondition for E8 ("E7 evidence and dependencies justify legacy writer retirement") and has no engineering description, acceptance criteria or owning record in the committed source. E7 is therefore NOT invented as a work item. The E8 record carries the E7 precondition as an explicit BLOCKER with its source reference, and the missing E7 obligation is surfaced here for the operator to supply or to confirm that E7 lives outside this repository.',
			source_refs: [
				{ path: ARCH, lines: [38, 38] },
				{ path: ARCH, lines: [43, 43] },
			],
		},
		{
			kind: "MISSING_INFORMATION",
			identities: [
				"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/SEATBELT-ALL-R0-EXECUTION-OBLIGATION-PROPAGATION",
			],
			resolution: "UNRESOLVED",
			reason:
				"The source's deferred block for this item states its classification and its non-ownership relationship (`…CORRECTION02` owns the live investigation; this is a sibling candidate, NOT bundled), and gives the observation site, but the excerpt recovered in this reconciliation does not carry the full acceptance criteria for the sibling recon. The item is therefore represented with criteria_coverage UNKNOWN and qualification UNKNOWN rather than being given invented acceptance criteria. The full text remains recoverable from the committed source archive.",
			source_refs: [{ path: SAFE, lines: [159, 172] }],
		},
		{
			kind: "INCOMPLETE_COVERAGE",
			identities: [".factory/epic-board.md"],
			resolution: "RESOLVED",
			reason:
				"The root epic board is 44,731 lines at SOURCE_HEAD and is a PREPEND-ORDERED historical ACT-report log: roughly the first 9,340 lines are narrative ACT reports and the operational index (Current frontier / Active epics / Open supporting work / Deferred-hold / Historical task census) occupies the region around lines 9352-9541. The operational index region was reconciled section-by-section into the frontier tables and the work-item records. The narrative report region was reconciled at the COLD level: 177 ACT report sections were mechanically indexed by identity, verdict and source range into `historical-index.json`, with 167 distinct identities, 7 carrying competing verdicts (CONFLICTING) and 1 carrying repeated identical verdicts (AMBIGUOUS). The remaining narrative prose (the `Updated:` chronology lines and per-ACT bodies) is accounted for as CONTIGUOUS NARRATIVE HISTORY at the byte level and is preserved verbatim through the committed source archive; it is deliberately NOT reconstructed paragraph-by-paragraph as new work items.",
			source_refs: [
				{ path: BOARD, lines: [1, 78] },
				{ path: BOARD, lines: [9344, 9350] },
				{ path: BOARD, lines: [9443, 9541] },
			],
		},
		{
			kind: "INCOMPLETE_COVERAGE",
			identities: [".factory/epics/command-risk-classification.md"],
			resolution: "RESOLVED",
			reason:
				"This file is 460,166 bytes and contains several full ACT closure narratives (V1 bounded classifier, V1 CORRECTION01 VSCode host parity, V2 parser-assisted framework + HALT_SHIPPING, V2 READONLY-AND-COMPOSITION01). The epic-level state (CLOSED framework; further rules / expansion deferred pending a fresh ACT) and the durable contract conclusions were reconciled semantically into the epic record. The per-ACT closure narratives were accounted for at the COLD level — their identities and verdicts are indexed through the historical ACT index and their complete original bytes remain in the committed source archive — rather than being reconstructed as new work items.",
			source_refs: [
				{
					path: ".factory/epics/command-risk-classification.md",
					lines: [1, 12],
				},
			],
		},
		{
			kind: "INCOMPLETE_COVERAGE",
			identities: [".factory/epics/webview-seam-aop.md"],
			resolution: "RESOLVED",
			reason:
				"This file is 159,285 bytes and contains multiple full ACT closure narratives (AOPC02 Phase A E1/E2/E3 discriminator, AOPC02 PHASE-A-CORRECTION01 real SdkController producer discriminator, and the live-capture sub-ACTs). The epic-level state (CLOSED; all sub-ACTs landed) and the durable conclusions were reconciled semantically. The per-ACT closure narratives were accounted for at the COLD level — identities and verdicts indexed through the historical ACT index; complete original bytes preserved in the committed source archive — not reconstructed as new work items. The RESULT01 sub-ACT's `AWAITING_DOGFOOD` state is preserved as the epic's exit criterion.",
			source_refs: [
				{ path: ".factory/epics/webview-seam-aop.md", lines: [1, 12] },
			],
		},
		{
			kind: "INCOMPLETE_COVERAGE",
			identities: [".factory/epics/context-compaction-token-accounting.md"],
			resolution: "RESOLVED",
			reason:
				'This file is 55,610 bytes with eleven successive "Current frontier update" sections between 2026-09-02 and 2026-11-25. The final frontier state and the durable conclusions were reconciled semantically into the epic record and the board\'s Current-frontier row. The intermediate frontier-update sections are chrono-ordered history, not separate current obligations; they were accounted for as narrative history at the byte level and preserved verbatim in the committed source archive. Only the LATEST frontier is represented as the current obligation.',
			source_refs: [
				{
					path: ".factory/epics/context-compaction-token-accounting.md",
					lines: [23, 30],
				},
				{
					path: ".factory/epics/context-compaction-token-accounting.md",
					lines: [1092, 1095],
				},
			],
		},
		{
			kind: "INCOMPLETE_COVERAGE",
			identities: [".factory/epics/safe-yolo-seatbelt.md"],
			resolution: "RESOLVED",
			reason:
				'This file is 49,311 bytes and its "Current status" bullet is a single very long paragraph enumerating many closed substrate contracts (SEATBELT-DEFAULT-ON01, the workspace-write / network-open / sensitive-read / YOLO-mutation-confinement contracts, SEATBELT-NETWORK-EGRESS-RECON01, SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01, SANDBOX-CAPABILITIES-LIVE-REGRESSION01, SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01, SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02, SEATBELT-SSH-AGENT-AUTHORITY-RECON01 and its implementation successor). The CURRENT obligations were reconciled semantically (Open work section); the closed substrate contracts are historical executions indexed through the historical ACT index, and the closed-contract narrative remains verbatim in the committed source archive. The R5 manual-approval lane was carried forward as an OPEN obligation because the source explicitly keeps it open with a `NEXT_R5_TRIGGER`.',
			source_refs: [{ path: SAFE, lines: [5, 11] }],
		},
		{
			kind: "SOURCE_CONFLICT",
			identities: [
				"ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01",
				"ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01",
				"ACT-CLINEMM-HTEC02-POST-START-LATE-TERMINAL-RELEASE-CORRECTION01",
				"ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01",
				"ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01",
				"ACT-CLINEMM-ROUNDC-LIVE-LATENCY-ATTRIBUTION-01",
				"ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01",
			],
			resolution: "CONFLICT",
			reason:
				"Competing HISTORICAL VERDICTS for one ACT identity, preserved explicitly and NOT silently deduplicated. The board carries more than one report section for each of these seven identities, and the section headers state different verdicts (for example `ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01` appears once as `IN PROGRESS` and once as `BOUNDED P1 REFINEMENTS`; `ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01` appears as `IN_PROGRESS`, `P1_CONTRACT_AMENDMENT_APPLIED` and `WAKE_PATH_BOUNDED`). The historical index therefore records ONE identity per ACT with `reconciliation: CONFLICTING` and carries EVERY competing source reference, so the competing claims remain individually addressable. These are HISTORICAL ASSERTIONS: no competing verdict establishes engineering acceptance, and the migration does not select one as authoritative. Each identity's section ranges are preserved in the historical index's `source_refs`.",
			source_refs: [
				{ path: BOARD, lines: [27790, 27790] },
				{ path: BOARD, lines: [29487, 29487] },
				{ path: BOARD, lines: [31150, 31150] },
				{ path: BOARD, lines: [31833, 31833] },
				{ path: BOARD, lines: [37994, 37994] },
				{ path: BOARD, lines: [38210, 38210] },
				{ path: BOARD, lines: [43932, 43932] },
			],
		},
		{
			kind: "SOURCE_CONFLICT",
			identities: ["ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01-CORRECTION01"],
			resolution: "CONFLICT",
			reason:
				"One ACT identity with MULTIPLE report sections carrying the SAME verdict (`PASS_STRUCTURAL_ONLY`) at different line ranges. The historical index records the identity once with `reconciliation: AMBIGUOUS` and carries both source references, so the repeated representation stays addressable. The verdict is a historical assertion and is not promoted into acceptance. NOTE: `AMBIGUOUS_UNRESOLVED` is NOT a member of the FWMI v1 reconciliation-resolution wire vocabulary (`UNRESOLVED`, `RESOLVED`, `DUPLICATE`, `CONFLICT`, `SUPERSEDED`); the wire `resolution` for this record is `CONFLICT` and the finer-grained distinction lives in this reason. The record is listed here separately from the seven-identity conflict record above because the underlying ambiguity is materially different (repeated identical verdict vs. competing different verdicts) and the ACT requires that distinct reconciliation records remain distinct.",
			source_refs: [
				{ path: BOARD, lines: [4578, 4578] },
				{ path: BOARD, lines: [4579, 4579] },
			],
		},
	];
