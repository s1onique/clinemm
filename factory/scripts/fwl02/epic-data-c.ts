#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/epic-data-c.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — reconciled epics, part C.
 *
 * Covers the product-facing, substrate and runtime lanes.
 */

import type { ReconciledEpic } from "./reconciled-epics.ts";
import { BOARD } from "./reconciled-epics.ts";

const PRODUCT = ".factory/epics/product-config-branding.md";
const FACTORY = ".factory/epics/factory-infrastructure.md";
const HOSTTEST = ".factory/epics/host-test-infrastructure.md";
const QUALITY = ".factory/epics/quality-substrate.md";
const _RUNTIME = ".factory/epics/runtime-task-progression.md";
const _CTX = ".factory/epics/context-compaction-token-accounting.md";
const _FILETOOL = ".factory/epics/file-tool-workspace-realpath-authority.md";
const _DIST = ".factory/epics/distribution-ci.md";
const _DYNAMIC = ".factory/epics/dynamic-editing-backends.md";
const _TOOLRUNTIME = ".factory/epics/tool-runtime-reliability.md";
const _TASKPRES = ".factory/epics/task-presentation.md";
const _TASKCTRL = ".factory/epics/task-control-liveness.md";
const _UPSTREAM = ".factory/epics/upstream-intake.md";
const _CLOSEDFOUND = ".factory/epics/closed-foundation.md";
const _WEBVIEW = ".factory/epics/webview-seam-aop.md";
const _COMMANDRISK = ".factory/epics/command-risk-classification.md";
const _AUTHDEV = ".factory/epics/authenticated-dev-capabilities.md";

/**
 * EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING — the product-facing lane.
 *
 * W4 Candidate 2 (`ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01`) is
 * reconciled here: the source places the obligation under THIS epic's Open
 * work with an explicit "tentative epic placement pending the ACT's §11 owning
 * epic decision tree", and the board's Current frontier table records the
 * Settings-surface-parity lane as `CLOSED_V2` with no NEXT. Both facts are
 * preserved; the conflict is recorded in `reconciliation.json`.
 */
export const EPIC_PRODUCT_CONFIG_BRANDING: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING",
	source_file: ".factory/epics/product-config-branding.md",
	title: "Product config / branding",
	original_status:
		"ACTIVE — closed cost/consolidation substrate + 2 open product fronts",
	lifecycle: "ACTIVE",
	priority: "P2",
	exit_criteria: [
		"Cost display observed diverging from the canonical cost source.",
		"Main branch loses the consolidated state (i.e. a non-canonical branch re-emerges as a long-lived side).",
		"A new visible-branding ACT lands that supersedes `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01`.",
		"`ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` §11 decides to spawn `EPIC-CLINEMM-SETTINGS-SUBSTRATE01` — at that point this row migrates to the new epic detail file and this row collapses to a durable cross-reference link.",
	],
	source_refs: [
		{ path: PRODUCT, lines: [5, 11] },
		{ path: PRODUCT, lines: [34, 49] },
	],
	items: [
		{
			item_id:
				"EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/TOOL-EXECUTION-SEMANTICS01",
			title:
				"EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01 — tool-execution semantics telemetry umbrella",
			description:
				"The umbrella epic is board row 20. Its first ACT `TOOL-EXECUTION-SEMANTICS-RECON01` already closed `PASS_RECON`. The bounded implementation slice `ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01` (= working label `TES-IMPL-01`) landed the mechanism-only TaskHeader projection. The V2 outcome slice `ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01` (= working label `TES-OUT-01`) closed `PASS_STRUCTURAL_ONLY` and adds the bounded RUNTIME-OUTCOME projection (`✓ / ✕ / … / ?`) next to the unchanged mechanism strip. Per the recon verdict, mechanism/outcome/duration are REAL; `purpose` is `UNAVAILABLE_FROM_TRACE` and must remain UNAVAILABLE in the projection. Do NOT infer semantic purpose from command/tool arguments — classify only from the canonical registered tool identity (`apply_patch` / native write tool → EDIT; `run_commands` / `execute_command` → COMMAND; native read/search → READ/SEARCH; `mcp_*` → MCP; structurally unknown → OTHER/UNKNOWN). Still deferred under this epic: subprocess-terminal exit statuses, tool duration aggregation, effect classification, retry/recovery deduplication, and any new model-behavior events.",
			workstream: "product-config-branding",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "P2",
			qualification: "STRUCTURAL_ONLY",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [
				"ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-RECON01",
				"ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01",
				"ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01",
			],
			evidence_locators: [
				"docs/architecture/elm/task-state-tes01-tool-execution-semantics-recon-evidence.md",
			],
			reopen_conditions: [
				"Main branch loses the consolidated state (i.e. a non-canonical branch re-emerges as a long-lived side).",
			],
			source_refs: [{ path: PRODUCT, lines: [36, 36] }],
		},
		{
			item_id: "EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/BRANDING01",
			title: "EPIC-CLINEMM-BRANDING01 — visible branding umbrella",
			description:
				"The umbrella epic is board row 21. Its first bounded slice is `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01` (board row 24, `NEXT / MED`). Icon: `‖ → --`. Preserve VS Code monochrome / theming behavior.",
			workstream: "product-config-branding",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "P2",
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01",
			related_acts: ["ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01"],
			evidence_locators: [],
			reopen_conditions: [
				"A new visible-branding ACT lands that supersedes `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01`.",
			],
			source_refs: [{ path: PRODUCT, lines: [37, 37] }],
		},
		{
			item_id: "EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/TASK-COST-TRUTH-RECON01",
			title:
				"ACT-CLINEMM-TASK-COST-TRUTH-RECON01 — two-layer cost-provenance recon",
			description:
				"Recon-only; binds `TASK_DISPLAYED_COST` to authoritative per-request cost evidence AND to a truthful billing-semantic label. Authored 2026-08-27 at the launch commit (Layer-1 arithmetic recon) and re-framed 2026-08-27 (Layer-2 billing-semantic layer added in response to an expert product/accounting review against a real MiniMax Ultra Token Plan task). The reframe DID NOT supersede `EPIC-CLINEMM-COST-DISPLAY-TRUTH01` (CLOSED) — the Layer-2 framework adds a NEW presentation-truth layer ABOVE the closed display-source contract. The closing condition is `(Layer-1, Layer-2)`: `(C, I)` → C1 GO (`COST_PROVENANCE_ARITHMETIC_VERIFIED`); `(A/B/D/E, *)` → RED-LAYER-1 + accumulator-repair ACT; `(C, II)` (the canonical MiniMax Ultra case) → RED-LAYER-2 + `PASS_COST_PROVENANCE_PRESENTATION_REPAIR_V1`; `(C, III)` and `(*, H)` → corresponding Layer-2-G / Layer-2-H presentation-repair ACTs. Until §3 produces a specimen, `CORRECTNESS = UNKNOWN` and the dollar amount is NEVER the stop rule. HELD until the operational frontier (`EDITOR-TOOL-APPROVAL-FRICTION-RECON01`, `OPEN / WAITING_FOR_LIVE_SPECIMEN`) is bound; sequenced next after that.",
			workstream: "product-config-branding",
			original_status: "OPEN / HOLD_FOR_EXECUTION",
			lifecycle: "BLOCKED",
			priority: "P1",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [
				"Held until the operational frontier (`EDITOR-TOOL-APPROVAL-FRICTION-RECON01`, `OPEN / WAITING_FOR_LIVE_SPECIMEN`) is bound; sequenced next after that.",
			],
			current_act: "ACT-CLINEMM-TASK-COST-TRUTH-RECON01",
			related_acts: ["ACT-CLINEMM-TASK-COST-TRUTH-RECON01"],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-TASK-COST-TRUTH-RECON01/probe-minimax-ultra-billing-semantics.md",
			],
			reopen_conditions: [
				"Cost display observed diverging from the canonical cost source.",
			],
			source_refs: [{ path: PRODUCT, lines: [38, 38] }],
		},
		{
			item_id:
				"EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01",
			title:
				"ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01 — upstream settings-surface parity recon",
			description:
				"Status: tentative epic placement pending the ACT's §11 owning-epic decision tree. If the candidate restore list (§5) has ≥ 3 entries spanning distinct categories, the ACT will spawn `EPIC-CLINEMM-SETTINGS-SUBSTRATE01`; otherwise this row's detail file link is the durable answer. Authored 2026-08-27 at the launch commit; recon §2 `PASS_RECON_SURFACE_MAPPED` at authorship, §3 inventory deferred. Three epistemic guards held by the ACT: NO wholesale upstream copy (`GUARD_NO_WHOLESALE_UPSTREAM_COPY`), preserve deliberate fork divergence (`GUARD_PRESERVE_DELIBERATE_DIVERGENCE` — Seatbelted-YOLO possibly replacing upstream plain-YOLO is a candidate supersession requiring §6 evidence, not an assumption), NO bespoke PTAD tab (`GUARD_NO_PTAD_TAB` — PTAD may fold into an existing Advanced/Diagnostics section, but never a top-level tab). The recon MUST classify each missing setting as `MISSING_ACCIDENTALLY` / `REMOVED_INTENTIONALLY` / `SUPERSEDED_BY_CLINEMM` / `UPSTREAM_NOT_APPLICABLE` / `PRESENT_IN_BOTH`; only the first class drives a candidate restore. HELD until the operational frontier is bound; sequenced after `TASK-COST-TRUTH-RECON01`.",
			workstream: "product-config-branding",
			original_status: "OPEN / HOLD_FOR_EXECUTION",
			lifecycle: "BLOCKED",
			priority: "P2",
			qualification: "PARTIAL",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [
				"Held until the operational frontier is bound; sequenced after `TASK-COST-TRUTH-RECON01`.",
			],
			current_act: "ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01",
			related_acts: ["ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01"],
			evidence_locators: [],
			reopen_conditions: [
				"`ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` §11 decides to spawn `EPIC-CLINEMM-SETTINGS-SUBSTRATE01` — at that point this row migrates to the new epic detail file and this row collapses to a durable cross-reference link.",
			],
			source_refs: [{ path: PRODUCT, lines: [39, 39] }],
			relationships: [
				{
					kind: "RELATED_TO",
					target:
						"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/TEMP-INTERNAL-CONTROL-CLEANUP",
					source_refs: [{ path: PRODUCT, lines: [39, 39] }],
				},
			],
		},
		{
			item_id:
				"EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/TEMP-INTERNAL-CONTROL-CLEANUP",
			title:
				"TEMP-INTERNAL-CONTROL-CLEANUP — cross-cutting child of settings-parity",
			description:
				'This is the SECONDARY cross-cutting row; the primary owner is safe-yolo-seatbelt.md (the env controls are owned by the seatbelt substrate). This row is a cross-link because the eventual replacement is a settings surface that lives in EPIC-CLINEMM-BRANDING01-adjacent settings UI. See safe-yolo-seatbelt.md Deferred work for the primary row. It is an inventory + classification task: each temporary / internal control must be classified as KEEP_INTERNAL / REPLACE_WITH_SETTING / REMOVE_AFTER_SUCCESSOR / DEBUG_ONLY before any cleanup ACT can be opened. No inventory exists yet; opening a "cleanup" ACT without the inventory would be premature. Ideal long-term shape: upstream Settings remain recognizable + ClineMM-only section(s) are additive, minimizing future upstream sync cost. Cross-links to existing substrate (do NOT duplicate): safe-yolo-seatbelt.md Deferred FW-05 (seatbelt-user-facing settings surface cross-link); safe-yolo-seatbelt.md Deferred FW-11 (TEMP-INTERNAL-CONTROL-CLEANUP primary owner); product-config-branding.md Deferred FW-11 (cross-link); ACT-CLINEMM-PTAD-ENV-OPTIN01 ledger (PTAD env var history); ACT-CLINEMM-SEATBELT-DEFAULT-ON01 ledger (default-ON posture); ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01 §15 (frozen SSH credential authority contract — settings surface must NOT renegotiate). Constraints: no implementation in this backlog ACT; no env-var removal; no Seatbelt behavior change; no SSH-agent code change; the env controls remain valid until a stable settings surface can fully cover them.',
			workstream: "product-config-branding",
			original_status: "FUTURE / DEFER",
			lifecycle: "DEFERRED",
			priority: "P2",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-UPSTREAM-PARITY-AND-SETTINGS-BACKLOG-REFINEMENT01/reconciliation.md (Track C, recorded 2026-08-29 by this ACT)",
			],
			reopen_conditions: [
				"A future ACT is opened whose mission is the temporary / internal control inventory; the inventory must be produced before any cleanup ACT is opened.",
			],
			source_refs: [{ path: PRODUCT, lines: [93, 152] }],
			relationships: [
				{
					kind: "CROSS_LINK",
					target:
						"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/TEMP-INTERNAL-CONTROL-CLEANUP",
					source_refs: [{ path: PRODUCT, lines: [131, 136] }],
				},
			],
		},
		{
			item_id: "EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/BRANDING-DEMO-JAN1-ICON",
			title:
				"ACT-CLINEMM-BRANDING-DEMO-JAN1-ICON01 — January 1 demo icon decoration",
			description:
				"On January 1, make the ClineMM extension icon subtly shiny / festive. This is a deliberately tiny end-to-end demo task for product / UI release plumbing. Why a deferred row (not an ACT yet): no existing backlog entry owns date-driven icon decoration; the existing EPIC-CLINEMM-BRANDING01 umbrella's first bounded slice is the icon-replacement ACT (different concern: `‖ → --`); adding a DEMO/LOW backlog row under the umbrella epic keeps the eventual ACT visible without promoting it to NEXT. Constraints carried into any future ACT: deterministic date seam (e.g. `Date.now()` within a configurable date range, or a build-time `JAN1_DEMO_ENABLED` flag — NOT a clock-driven side effect without an explicit toggle); testable without waiting for January 1; no external network dependency; no large branding redesign (single decorative treatment on Jan 1 only; preserve the normal icon on every other date); easy revert / removal. This is a demo task, not product-critical work; the DEMO/LOW priority is intentional and must not be promoted ahead of any P0 / P1 work.",
			workstream: "product-config-branding",
			original_status: "FUTURE / UNIMPLEMENTED",
			lifecycle: "DEFERRED",
			priority: "DEMO / LOW",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01/reconciliation.md (FW-09, recorded 2026-08-29 by the thread-future-work normalization ACT)",
			],
			reopen_conditions: [],
			source_refs: [{ path: PRODUCT, lines: [51, 90] }],
		},
	],
};

/** EPIC-CLINEMM-FACTORY-INFRASTRUCTURE — the factory substrate + FWL02 lane. */
export const EPIC_FACTORY_INFRASTRUCTURE: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-FACTORY-INFRASTRUCTURE",
	source_file: ".factory/epics/factory-infrastructure.md",
	title: "Factory infrastructure",
	original_status: "ACTIVE (substrate-level rules)",
	lifecycle: "ACTIVE",
	priority: "P0",
	exit_criteria: [
		"Git safety: repository ruleset `cline-- protect published history` (`id=21037630`) blocks force pushes to `main`. `BYPASS_ACTOR_COUNT = 0`. Reopen conditions: ruleset disabled; `non_fast_forward` removed; any bypass actor added; branch protection changed to allow force pushes; default branch moves out of `refs/heads/main`; ownership/topology changes.",
	],
	source_refs: [
		{ path: FACTORY, lines: [5, 18] },
		{ path: FACTORY, lines: [19, 55] },
	],
	items: [
		{
			item_id:
				"EPIC-CLINEMM-FACTORY-INFRASTRUCTURE/GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01",
			title:
				"ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01 — local pre-push force-push guard",
			description:
				"Defense-in-depth local pre-push hook. The remote-side protection is the GitHub ruleset `cline-- protect published history` (`id=21037630`); the local guard is the second line. Status: OPEN (P2, non-blocking).",
			workstream: "factory-infrastructure",
			original_status: "OPEN (P2, non-blocking)",
			lifecycle: "OPEN",
			priority: "P2",
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01",
			related_acts: ["ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01"],
			evidence_locators: [],
			reopen_conditions: [
				"Git safety: repository ruleset `cline-- protect published history` (`id=21037630`) blocks force pushes to `main`. `BYPASS_ACTOR_COUNT = 0`. Reopen conditions: ruleset disabled; `non_fast_forward` removed; any bypass actor added; branch protection changed to allow force pushes; default branch moves out of `refs/heads/main`; ownership/topology changes.",
			],
			source_refs: [
				{ path: FACTORY, lines: [24, 24] },
				{ path: FACTORY, lines: [47, 47] },
			],
		},
		{
			item_id:
				"EPIC-CLINEMM-FACTORY-INFRASTRUCTURE/FWL02-FWMI-V1-MIGRATION-INTERCHANGE",
			title: "FWL02 — FWMI v1 migration interchange (producer side)",
			description:
				"The producer emits a source-bound FWMI v1 interchange package (source manifest, epic records, historical index, reconciliation manifest). The operator runs the shadow migration EXTERNALLY, against the real package, in the Leamas repository, once both sides are ready. The consumer side is owned by Leamas and is NOT implemented here. The exchange contract is documented at `docs/factory/work-ledger-interchange.md` in the Leamas repository. Leamas is the SOLE implementation owner of the Factory Work Ledger and of its FWMI v1 import consumer; the consumer lives in the existing Go ledger domain, importer, transaction store, evidence authority and rendering mechanisms of the Leamas repository. There is no second ledger implementation in ClineMM, no universal Markdown parser and no architectural expansion. The `ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01` adapter was an experiment in the wrong repository. It was removed; the evidence package of that ACT is retained as the historical record of the experiment, not as a canonical implementation.",
			workstream: "factory-infrastructure",
			original_status: "OPEN",
			lifecycle: "ACTIVE",
			priority: "P1",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01",
			related_acts: ["ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01"],
			evidence_locators: [
				"docs/closure-plans/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01.json",
			],
			reopen_conditions: [],
			source_refs: [
				{ path: FACTORY, lines: [26, 26] },
				{ path: FACTORY, lines: [28, 44] },
				{ path: FACTORY, lines: [48, 54] },
				{ path: BOARD, lines: [9421, 9421] },
			],
		},
		{
			item_id:
				"EPIC-CLINEMM-FACTORY-INFRASTRUCTURE/HUSKY-TOOLCHAIN-PATH-PORTABILITY01",
			title:
				"HUSKY-TOOLCHAIN-PATH-PORTABILITY01 — repository hook tool discovery portability",
			description:
				"Make repository hooks reliably discover required developer tools across Apple Silicon Homebrew, Intel Homebrew, Linuxbrew, Nix / GUI / non-login environments. Current state (do NOT touch in this backlog ACT): `.husky/pre-commit` enumerates Homebrew prefixes for darwin-arm64, darwin-x86_64, and Linuxbrew for the gitleaks binary; the gitleaks branch fails CLOSED if gitleaks cannot be located. The `cd apps/vscode && bunx lint-staged` step does NOT enumerate prefixes; bun / bunx are operator-side PATH-injected. Constraints carried into any future ACT: recon first; no machine-specific tracked symlinks; no broad global PATH mutation unless evidence justifies it; prefer bounded per-tool discovery if opened (e.g. `command -v` chain with documented fallbacks); do NOT silently weaken the gitleaks requirement.",
			workstream: "factory-infrastructure",
			original_status: "FUTURE / DEFER",
			lifecycle: "DEFERRED",
			priority: "P2",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01/reconciliation.md (FW-06, recorded 2026-08-29 by the thread-future-work normalization ACT)",
			],
			reopen_conditions: [
				"Another operator / CI environment reproduces the failure (a new hook-related tool dropped from PATH on a fresh checkout).",
				"Factory decides developer-tool portability warrants proactive work (e.g. a cluster of PATH-shadowing findings that would benefit from a unified resolution).",
			],
			source_refs: [{ path: FACTORY, lines: [58, 100] }],
		},
		{
			item_id: "EPIC-CLINEMM-FACTORY-INFRASTRUCTURE/UPSTREAM-CATCHUP-RECON01",
			title:
				"ACT-CLINEMM-UPSTREAM-CATCHUP-RECON01 — upstream fork-distance catch-up",
			description:
				'Reduce fork-from-upstream distance deliberately, without sacrificing ClineMM-specific architecture. Operate the upstream-sync cadence that `docs/factory/upstream-sync.md` already establishes as doctrine but does NOT yet own as a backlog ACT. Doctrinal substrate (already exists; do not duplicate): upstream = https://github.com/cline/cline.git (immutable); origin = s1onique/clinemm; ClineMM consumes upstream via MERGE, never rebase; conflict evidence contract `docs/factory/sync/<YYYY-MM-DD>/{upstream_commit.txt,merge_commit.txt,conflict_report.md}`; branch topology factory/*, product/* (reserved), sync/* (transient); divergence measurement `factory/inventories/repository.json#upstream.{commit_oid,tree_oid,merge_base_with_upstream,ahead,behind}`; release tags `factory/inventories/repository.json#tags.nearest`. Historical baseline snapshot (frozen at ACT-CLINEMM-FORK-BASELINE01-CORRECTION02; the future ACT must refresh this): upstream.commit_oid = c564045d8135c0c1c330b21d47b68b74917ce614; merge_base_with_upstream = c564045d8135c0c1c330b21d47b68b74917ce614; working_copy.ahead = 17; working_copy.behind = 0. User-visible (NON-AUTHORITATIVE) divergence snapshot: FORK_AHEAD_OF_UPSTREAM = 861 commits; UPSTREAM_AHEAD_OF_FORK = 176 commits; LABEL = OBSERVED_UI_SNAPSHOT; SOURCE = GitHub UI compare / pull-request page; DATE_OBSERVED = 2026-08-29; CANONICAL_GIT_DIVERGENCE = NOT_MEASURED_IN_THIS_ACT. Strategy (carried into the new ACT): progressive bounded sync slices, NOT a 176-commit blind mega-merge — per upstream cluster choose MERGE_UPSTREAM_SLICE / PORT_THEMATIC_SERIES / MANUAL_PORT / DO_NOT_IMPORT. Hard invariants: preserve ClineMM Seatbelt / Safe-YOLO semantics; preserve explicit completion authority (per the ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01 family); preserve Factory evidence tooling; NO silent regression to upstream plain-YOLO semantics; NO wholesale replacement of ClineMM-specific runtime seams. Forbidden: NO `git merge upstream/main` as the first operation; NO giant rebase without conflict inventory; NO semantic conflict resolution based solely on "prefer ours/theirs"; NO deleting fork-specific functionality merely to make sync easy. Constraints: no actual upstream merge / rebase / cherry-pick in this backlog ACT; no upstream remote is configured in this clone, so the future ACT must start by configuring the canonical upstream remote (or document that the operator declined to do so).',
			workstream: "factory-infrastructure",
			original_status: "FUTURE / UNIMPLEMENTED",
			lifecycle: "DEFERRED",
			priority: "HIGH",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-UPSTREAM-PARITY-AND-SETTINGS-BACKLOG-REFINEMENT01/reconciliation.md (Track B, recorded 2026-08-29 by this ACT)",
			],
			reopen_conditions: [],
			source_refs: [{ path: FACTORY, lines: [102, 212] }],
		},
	],
};

/** EPIC-CLINEMM-HOST-TEST-INFRASTRUCTURE — the host-orchestrated runner lane. */
export const EPIC_HOST_TEST_INFRASTRUCTURE: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-HOST-TEST-INFRASTRUCTURE",
	source_file: ".factory/epics/host-test-infrastructure.md",
	title: "Host test infrastructure",
	original_status:
		"ACTIVE — fresh epic opened at FUTURE-BACKLOG-CENSUS01 (2026-08-27). No ACT authored yet; `HOST-TEST RUNNER` is the working label and remains a label until canonical ACT ID is assigned per FACT-001 in `.factory/epics/factory-infrastructure.md`.",
	lifecycle: "ACTIVE",
	priority: "P1",
	exit_criteria: [
		"A Seatbelt / approval / classic-protection ACT needs host-only evidence and the runner does not yet cover the required corpus (→ new runner ACT scoped).",
		"The runner is observed widening authority / leaking secrets / being used as a covert bypass (→ HALT the runner ACT and any consumer).",
	],
	source_refs: [
		{ path: HOSTTEST, lines: [5, 10] },
		{ path: HOSTTEST, lines: [31, 59] },
	],
	items: [
		{
			item_id: "EPIC-CLINEMM-HOST-TEST-INFRASTRUCTURE/HOST-TEST-RUNNER",
			title: "HOST-TEST RUNNER — author the host-orchestrated runner",
			description:
				"Authoring ACT must ship: (a) the runner binary / script, (b) the corpus/result schema, (c) at least one minimal invocation per dependent ACT (real-kernel Seatbelt probe + fresh VSIX dogfood + live approval-UI capture), (d) the audit-log contract (ACT ID, source HEAD, corpus file path, runner version, host OS / kernel, start/end wall time, full result; appended to `.factory/evidence/<ACT>/`). No widening of authority: the runner runs as the host user, does not gain Seatbelt privileges the user lacks, and is not a covert YOLO bypass. A separate ACT is also required (NOT part of the runner ACT) to reclassify prior per-test Vitest `skipIf(!HAS_SUBSTRATE)` callers from `SKIP` to `HOST_REQUIRED` via the runner.",
			workstream: "host-test-infrastructure",
			original_status: "OPEN / HIGH",
			lifecycle: "OPEN",
			priority: "HIGH",
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"A Seatbelt / approval / classic-protection ACT needs host-only evidence and the runner does not yet cover the required corpus (→ new runner ACT scoped).",
				"The runner is observed widening authority / leaking secrets / being used as a covert bypass (→ HALT the runner ACT and any consumer).",
			],
			source_refs: [
				{ path: HOSTTEST, lines: [33, 33] },
				{ path: HOSTTEST, lines: [38, 46] },
			],
			relationships: [
				{
					kind: "CROSS_LINK",
					target: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT/HOST-TEST-RUNNER",
					source_refs: [{ path: HOSTTEST, lines: [38, 40] }],
				},
			],
		},
	],
};

/** EPIC-CLINEMM-QUALITY-SUBSTRATE — the typecheck / coverage substrate. */
export const EPIC_QUALITY_SUBSTRATE: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-QUALITY-SUBSTRATE",
	source_file: ".factory/epics/quality-substrate.md",
	title: "Quality substrate",
	original_status:
		"ACTIVE — closed substrate + open frontier (typecheck umbrella partially open at CI parity + code-coverage baseline still open)",
	lifecycle: "ACTIVE",
	priority: "P1",
	exit_criteria: [
		"Vitest baseline regresses (any failure count > 0).",
		"Runtime-task-progression defect reproduces at the canonical seam.",
		"Typecheck baseline regresses on the canonical `tsc --noEmit -p apps/vscode/tsconfig.json` (the gate is GREEN twice on prior commit; future runs must also exit 0 with 0 diagnostics).",
		"Code-coverage baseline moves without an explicit ACT authorizing the move.",
	],
	source_refs: [
		{ path: QUALITY, lines: [5, 11] },
		{ path: QUALITY, lines: [36, 53] },
	],
	items: [
		{
			item_id: "EPIC-CLINEMM-QUALITY-SUBSTRATE/TYPECHECK-ZERO-BASELINE01",
			title:
				"TYPECHECK-ZERO-BASELINE01 — typecheck zero-diagnostic baseline (CI parity leg)",
			description:
				"Status: CLOSED at the local canonical seam (canonical `tsc --noEmit -p apps/vscode/tsconfig.json` exits 0 with 0 diagnostics); OPEN at CI parity (PARITY=PARTIAL — `apps/vscode/package.json:check-types` is the local gate; `.github/workflows/ext-vscode-test.yml` does not currently gate the canonical tsc command). The CI-parity leg is tracked under `EPIC-CLINEMM-GITHUB-ACTIONS01` for a future ACT.",
			workstream: "quality-substrate",
			original_status: "CLOSED at local canonical seam; OPEN at CI parity",
			lifecycle: "BLOCKED",
			priority: "P1",
			qualification: "PARTIAL",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [
				"The CI-parity leg is tracked under `EPIC-CLINEMM-GITHUB-ACTIONS01`; the workflow does not currently gate the canonical tsc command.",
			],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"Typecheck baseline regresses on the canonical `tsc --noEmit -p apps/vscode/tsconfig.json`.",
			],
			source_refs: [{ path: QUALITY, lines: [38, 38] }],
			relationships: [
				{
					kind: "DEPENDS_ON",
					target: "EPIC-CLINEMM-DISTRIBUTION-CI/GITHUB-ACTIONS01",
					required_outcome:
						"CI parity leg closed by the GitHub Actions recon/repair ACT",
					source_refs: [{ path: QUALITY, lines: [38, 38] }],
				},
			],
		},
		{
			item_id: "EPIC-CLINEMM-QUALITY-SUBSTRATE/CODE-COVERAGE-BASELINE01",
			title: "CODE-COVERAGE-BASELINE01 — code-coverage baseline",
			description:
				"Status: OPEN / HIGH. The ratchet ACT (`CODE-COVERAGE-RATCHET01`) is closed and ready to enforce non-regression once the baseline is set; the baseline itself is not yet fixed.",
			workstream: "quality-substrate",
			original_status: "OPEN / HIGH",
			lifecycle: "OPEN",
			priority: "HIGH",
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependencies: [],
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-CODE-COVERAGE-BASELINE01",
			related_acts: ["ACT-CLINEMM-CODE-COVERAGE-BASELINE01"],
			evidence_locators: [".factory/quality/code-coverage-baseline.json"],
			reopen_conditions: [
				"Code-coverage baseline moves without an explicit ACT authorizing the move.",
				"Vitest baseline regresses (any failure count > 0).",
			],
			source_refs: [{ path: QUALITY, lines: [39, 39] }],
		},
	],
};
