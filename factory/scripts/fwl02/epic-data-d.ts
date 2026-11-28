#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/epic-data-d.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — reconciled epics, part D.
 *
 * Covers the runtime / progression lane, the compaction lane, the file-tool
 * security lane, and the remaining substrate lanes.
 */

import type { ReconciledEpic } from "./reconciled-epics.ts";
import { BOARD } from "./reconciled-epics.ts";

const RUNTIME = ".factory/epics/runtime-task-progression.md";
const CTX = ".factory/epics/context-compaction-token-accounting.md";
const FILETOOL = ".factory/epics/file-tool-workspace-realpath-authority.md";
const DIST = ".factory/epics/distribution-ci.md";
const DYNAMIC = ".factory/epics/dynamic-editing-backends.md";
const TOOLRUNTIME = ".factory/epics/tool-runtime-reliability.md";
const TASKPRES = ".factory/epics/task-presentation.md";
const TASKCTRL = ".factory/epics/task-control-liveness.md";
const UPSTREAM = ".factory/epics/upstream-intake.md";
const CLOSEDFOUND = ".factory/epics/closed-foundation.md";
const WEBVIEW = ".factory/epics/webview-seam-aop.md";
const COMMANDRISK = ".factory/epics/command-risk-classification.md";
const AUTHDEV = ".factory/epics/authenticated-dev-capabilities.md";

/**
 * EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION — the autonomous-execution progression lane.
 *
 * The source's own `Current status` block states the operational action
 * explicitly: `RETURN_TO_SSH_LIVE_QUALIFICATION`
 * (`ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01`), and
 * `DO NOT open ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-REPAIR01`.
 */
export const EPIC_RUNTIME_TASK_PROGRESSION: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION",
	source_file: ".factory/epics/runtime-task-progression.md",
	title: "Runtime task progression",
	original_status:
		"OPEN — fresh epic opened at FUTURE-BACKLOG-CENSUS01-CORRECTION01. The canonical ACT `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` is OPEN with OWN01 RED reproduced at HEAD `f106bc63d` and OWN02-OWN03-RECON at CAPTURE_INSUFFICIENT.",
	lifecycle: "OPEN",
	priority: "P1",
	source_priority: "HIGH",
	exit_criteria: [
		"A new user-visible non-progressing-task symptom is reproduced at the local canonical seam (→ reopen `RUNTIME-TASK-PROGRESSION-RECON01` or open a per-symptom ACT).",
		"A `RUNTIME_THINKING_STALL` upstream issue graduates from RADAR to IMPORT against this epic (requires a strict destination-contract test against the recon evidence).",
		"A Cancel-affordance authority defect is reproduced at the local canonical seam (→ unblock `CANCEL-AFFORDANCE-AUTHORITY-RECON`).",
	],
	source_refs: [
		{ path: RUNTIME, lines: [5, 13] },
		{ path: RUNTIME, lines: [72, 86] },
	],
	items: [
		{
			item_id: "RUNTIME-TASK-PROGRESSION-RECON01",
			title:
				"ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 — runtime progression recon",
			description:
				"First ACT: bounded RECON + exact live RED. The deliverable is a markdown document that (a) characterizes the failure modes observed in our local recurrence, (b) maps each observed mode to one or more upstream signals (RADAR), (c) proposes a bounded RED-family test seam (not implementation), (d) does NOT pre-classify cause. Do not implement any production change in this ACT. The umbrella ACT is OPEN with OWN01 RED reproduced at HEAD `f106bc63d` and OWN02-OWN03-RECON at CAPTURE_INSUFFICIENT; the producer-side recon successor `ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01` is CLOSED / VERDICT_AMENDED / NOT_LIVE_CAUSE. Strongest preserved structural findings: `agent-runtime.ts:1371` IS a real latent defect under `requireCompletionTool=true`; the downstream AgentFinishReason collapse is a real latent defect; neither is the live cause.",
			workstream: "runtime-task-progression",
			original_status: "HIGH",
			lifecycle: "OPEN",
			priority: "P1",
			source_priority: "HIGH",
			relationships: [],
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01",
			related_acts: [
				"ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01",
				"ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01",
			],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/OWN02-OWN03-RECON/recon-report.md",
				".factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/background-job-authority-topology.md",
			],
			reopen_conditions: [
				"A new user-visible non-progressing-task symptom is reproduced at the local canonical seam.",
			],
			source_refs: [{ path: RUNTIME, lines: [73, 73] }],
		},
		{
			item_id: "CANCEL-AFFORDANCE-AUTHORITY-RECON",
			title:
				"CANCEL-AFFORDANCE-AUTHORITY-RECON — Cancel-affordance authority recon",
			description:
				'HIGH — partial. The static source-seam map half is bound by `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` (CLOSED / RECON_ONLY / CAPTURE_INSUFFICIENT at `162dfb137` over `15c7e3374`): proves `turnState.phase === "streaming"` is the predicate, `SdkTaskControlCoordinator.cancelTask` is the SDK owner, and upstream-vs-ClineMM Cancel button structure is byte-identical (no removal in either source). The LIVE capture half remains open: the four-value capture (`turnState.phase`, `foregroundCommandRunning`, `backgroundCommandRunning`, lastMessage.{type, say, ask, partial}) discriminates `UI_RENDER_DEFECT` from `TURN_STATE_PROJECTION_DEFECT` from benign non-streaming phases. First deliverable on resumption: a regression that fails when the invariant is violated in either direction (idle+Cancel visible, or active+Cancel absent). Do not invent a third authority; the invariant is already durable.',
			workstream: "runtime-task-progression",
			original_status: "HIGH — partial",
			lifecycle: "OPEN",
			priority: "P1",
			source_priority: "HIGH",
			relationships: [],
			qualification: "INSUFFICIENT",
			criteria: [
				"C04_CURRENT_CANCEL_OWNER_IDENTIFIED = PASS (SdkTaskControlCoordinator.cancelTask).",
				"C05_CURRENT_RENDER_PREDICATE_IDENTIFIED = PASS (streaming-phase-only).",
				"C07_UPSTREAM_COMPARISON = PASS (byte-identical Cancel).",
				"C09_LIVE_RENDER_INPUTS_CAPTURED = NOT_CAPTURED (no turnState dump; phase unknown).",
				"C10_FIRST_BROKEN_BOUNDARY = UNBOUND (two candidates remain; requires LIVE phase capture).",
				"C12_CAUSAL_DISCRIMINATOR = NOT_APPLICABLE (requires LIVE phase to discriminate).",
				"C14_CANCEL_AUTOAPPROVE_INDEPENDENCE = PASS (predicate independent).",
				"C15_CANCEL_NOT_COMPLETION = PASS (cancel does NOT emit task.completed).",
				"C16_CANCEL_NOT_CLEAR = PASS (cancel ≠ clearTask).",
				"C17_LONG_RUNNING_CANCEL = PASS (foreground_command_running config exposes Cancel + Proceed).",
				"C23_LIVE_CANCEL_VISIBLE = NOT_TESTED (would require LIVE UI).",
				"C24_LIVE_CANCEL_EFFECTIVE = NOT_TESTED.",
			],
			criteria_coverage: "COMPLETE",
			dependency_coverage: "COMPLETE",
			blockers: [
				"The LIVE four-value capture half is outstanding; the static source-seam map half is already bound.",
			],
			current_act: null,
			related_acts: ["ACT-CLINEMM-TASK-CANCEL-UI-RECON01"],
			evidence_locators: [],
			reopen_conditions: [
				"A Cancel-affordance authority defect is reproduced at the local canonical seam (→ unblock `CANCEL-AFFORDANCE-AUTHORITY-RECON`).",
			],
			source_refs: [
				{ path: RUNTIME, lines: [74, 74] },
				{
					path: ".factory/acts/ACT-CLINEMM-TASK-CANCEL-UI-RECON01.md",
					lines: [479, 506],
				},
			],
		},
		{
			item_id: "CLOSED-LIVE-UPGRADE",
			title: "RUNTIME-TASK-PROGRESSION `CLOSED_LIVE` upgrade",
			description:
				"The optional future `CLOSED_LIVE` upgrade of `RUNTIME-TASK-PROGRESSION01`, deferred until a live ClineMM recurrence is available. The board's Deferred / hold table records it as consciously postponed.",
			workstream: "runtime-task-progression",
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
			reopen_conditions: ["Only after a fresh live ClineMM recurrence."],
			source_refs: [{ path: BOARD, lines: [9434, 9434] }],
		},
	],
};

/**
 * EPIC-CLINEMM-CONTEXT-COMPACTION-TOKEN-ACCOUNTING — the compaction lane.
 *
 * The board's Current frontier table records Defect A CLOSED at `cb5b52239`
 * (Strategy-D), Defect B CLOSED at HEAD, and Defect C (post-compaction
 * header-bar staleness) as a LIVE consumer-level witness. The NEXT column
 * names `ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01` (OPEN 2026-09-02;
 * RECON_ONLY; option α chosen over option β; PROD_DELTA = ZERO).
 */
export const EPIC_CONTEXT_COMPACTION: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-CONTEXT-COMPACTION-TOKEN-ACCOUNTING",
	source_file: ".factory/epics/context-compaction-token-accounting.md",
	title: "Context / compaction",
	original_status:
		"DISCRIMINATOR EXECUTED + FORM-REVIEW HARDENED + REVIEWER-DISPOSITION PASS_WITH_ONE_P1_FIX + C1: GO. Recon ACT is CLOSED_WITH_RESIDUE (CASE_A — Cross-scale ratio-transfer mismatch REPRODUCED, LIKELY_CAUSE = CROSS_SCALE_RATIO_TRANSFER_ASSUMPTION, ROOT_CAUSE = NOT_YET_PROMOTED).",
	lifecycle: "ACTIVE",
	priority: "P1",
	source_priority: "P1",
	exit_criteria: [
		"The three admissible header-bar contracts are classified by the recon: C1 (bar = last provider observation, label fix only), C2 (bar = working-context estimate, projection fix), C3 (bar changes semantic source after compaction, wire-contract fix).",
	],
	source_refs: [
		{ path: CTX, lines: [23, 112] },
		{ path: BOARD, lines: [9377, 9377] },
	],
	items: [
		{
			item_id: "COMPACTION-HEADER-BAR-FRESHNESS-RECON01",
			title:
				"ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01 — post-compaction header-bar freshness recon",
			description:
				"RECON_ONLY / option α (narrow recon) chosen over option β (wire-contract `kind` discriminator); production delta ZERO; no new review round. Defect A (cross-scale arithmetic) and Defect B (post-restore publication) remain CLOSED at HEAD (`cb5b52239` + `sdk-compaction-coordinator.ts:365-396` trailing postStateToWebview). Defect C (post-compaction header-bar staleness) is a LIVE consumer-level witness; FULL_UI_PRODUCTION_SEAM_REPRODUCTION = NOT YET per the empirical P1 (the 2/2 test exercises the shared metrics consumer, NOT the actual ChatView → ContextWindow/TaskHeader render chain; the recon MUST author the real RED only after the C1/C2/C3 semantic contract is frozen). Recon question: what does the header bar represent immediately after compaction and before the next API request? WIRE_KIND_CHANGE = NOT_AUTHORIZED_YET (option β deferred until recon proves C3). Downstream repair ladder NOT pre-decided: C1 → ACT-CLINEMM-COMPACTION-HEADER-LABEL-REPAIR01; C2 → ACT-CLINEMM-COMPACTION-HEADER-PROJECTION-REPAIR01; C3 → ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01.",
			workstream: "context-compaction-token-accounting",
			original_status: "OPEN 2026-09-02; RECON_ONLY",
			lifecycle: "ACTIVE",
			priority: "P1",
			source_priority: "P1",
			relationships: [],
			qualification: "PARTIAL",
			criteria: [
				"ACT body committed with `OPEN / RECON_ONLY` status.",
				"Entry-freeze committed.",
				"**One** compact `semantic-contract.md` committed (not seven evidence files).",
				"Decisive matrix in that file filled in with the C1/C2/C3 verdict.",
				"`semantic-contract.md` names the chain-of-trust for the verdict and a single short recommendation (one of: HALT_NO_INTENT_FROZEN / C1 → bounded label ACT / C2 → bounded projection ACT / C3 → bounded wire-contract ACT). The recommendation is NOT pre-decided.",
				"`bun run check-types` clean on `apps/vscode`.",
				"`bun run test:vitest` clean on the `src/sdk/**` and `src/shared/**` scopes (the suites that pin defect A closure).",
				"`bun test src/shared/__tests__/getApiMetrics.test.ts` continues to be 24/24 GREEN.",
				"No production code change.",
				"No PR; this ACT is recon-only and the closure path is the verdict, not a code merge.",
			],
			criteria_coverage: "COMPLETE",
			dependency_coverage: "COMPLETE",
			blockers: [
				"The recon MUST author the real RED only after the C1/C2/C3 semantic contract is frozen.",
			],
			current_act: "ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01",
			related_acts: [
				"ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01",
				"ACT-CLINEMM-COMPACTION-PRESENTATION-FRESHNESS-EMPIRICAL01",
			],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01/entry-freeze.txt",
				".factory/evidence/ACT-CLINEMM-COMPACTION-PRESENTATION-FRESHNESS-EMPIRICAL01/findings.md",
			],
			reopen_conditions: [],
			source_refs: [
				{ path: BOARD, lines: [9377, 9377] },
				{
					path: ".factory/acts/ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01.md",
					lines: [538, 560],
				},
			],
		},
	],
};

/**
 * EPIC-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY — the file-tool security lane.
 *
 * The board's Current frontier table records the lane as `OPEN (RECON lane)`
 * with reviewer verdict `C1: GO_FILE_TOOL_SECURITY_RECON` on commit
 * `217e7f53c`, and states that this lane takes priority over the post-Q5-GREEN
 * Waiting qualification.
 */
export const EPIC_FILE_TOOL_REALPATH: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY",
	source_file: ".factory/epics/file-tool-workspace-realpath-authority.md",
	title: "File-tool workspace-escape authority",
	original_status: "OPEN (RECON lane)",
	lifecycle: "ACTIVE",
	priority: "P0",
	source_priority: "P0",
	exit_criteria: [
		"Q1 endpoint enumeration + Q2/Q3 sanitization regime + Q3 base-directory authority + Q4 lowest composition seam + Q5 RED matrix with A/B/C/D controls must complete before any repair is authorized.",
	],
	source_refs: [
		{ path: FILETOOL, lines: [6, 21] },
		{ path: FILETOOL, lines: [71, 160] },
		{ path: BOARD, lines: [9368, 9368] },
	],
	items: [
		{
			item_id: "FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01",
			title:
				"ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 — file-tool workspace-escape authority recon",
			description:
				"OPEN / `RECON_LANE_AUTHORIZED / NO_LIVE_FAIL_BIND_YET` per the Factory causal reviewer verdict `C1: GO_FILE_TOOL_SECURITY_RECON` on commit `217e7f53c`. Live evidence anchor: a model-controlled host file mutation created `/Projects/Runtime/...` outside the workspace while shell-side deletion later hit Seatbelt denial (containment-boundary candidate; the post-Q5-GREEN umbrella ACT cannot host this). Production files changed at ENTRY: 0. Q1 endpoint enumeration + Q2/Q3 sanitization regime + Q3 base-directory authority + Q4 lowest composition seam + Q5 RED matrix with A/B/C/D controls (A. model name has traversal `..` with global base → write target escapes workspace MUST be refused; B. model name is absolute path → MUST be refused; C. clean alphanumeric + global base → ALLOWED (control / no false positive); D. clean alphanumeric + workspace-resolved base → ALLOWED (regression-preserving)). NO production repair until Q5 RED authored + Factory reviewer authorizes. Conservation: ACAS01 vitest 4/4 PASS preserved; BHTD01 vitest 6/6 PASS preserved; Q5RR01 vitest 6/6 PASS preserved. Parallel-lanes note: `FRESH_POST_REPAIR_LIVE` for Q5 runs in parallel and does NOT gate this ACT; if this ACT closes REPAIR_AUTHORIZED, a bounded child ACT follows the contract ACT / implementation ACT / Q5-RED matrix discipline used for `BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01`.",
			workstream: "file-tool-workspace-realpath-authority",
			original_status: "OPEN / RECON_LANE_AUTHORIZED / NO_LIVE_FAIL_BIND_YET",
			lifecycle: "ACTIVE",
			priority: "P0",
			source_priority: "P0",
			relationships: [],
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01",
			related_acts: [
				"ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01",
			],
			evidence_locators: [
				".factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/00-scope.md",
				".factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/entry-freeze.txt",
			],
			reopen_conditions: [
				"Live evidence captured that binds a real creator of the escape (the live-failure bind is still pending).",
			],
			source_refs: [
				{ path: BOARD, lines: [9368, 9368] },
				{ path: FILETOOL, lines: [135, 152] },
			],
		},
	],
};

/** EPIC-CLINEMM-DISTRIBUTION-CI — release infrastructure. */
export const EPIC_DISTRIBUTION_CI: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-DISTRIBUTION-CI",
	source_file: ".factory/epics/distribution-ci.md",
	title: "Distribution / CI",
	original_status: "ACTIVE — all 3 items open",
	lifecycle: "ACTIVE",
	priority: "P2",
	source_priority: "P2",
	exit_criteria: [
		"Artifact trust binding: every published artifact must carry `SOURCE_HEAD`, `VERSION`, `PATH`, `BYTE_SIZE`, `SHA256`, and (where relevant) `installed version`.",
	],
	source_refs: [
		{ path: DIST, lines: [5, 11] },
		{ path: DIST, lines: [20, 46] },
	],
	items: [
		{
			item_id: "GITHUB-ACTIONS01",
			title: "EPIC-CLINEMM-GITHUB-ACTIONS01 — GitHub Actions recon",
			description:
				"First ACT: `ACT-CLINEMM-GITHUB-ACTIONS-RECON01` — recon existing workflows, actual failing jobs, package-manager topology, typecheck / test / build gates, VSIX packaging, permissions / secrets, release triggers. **GitHub Actions recon first, repair never** — the first ACT is a recon, not a repair. No repair in this board ACT.",
			workstream: "distribution-ci",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "P2",
			source_priority: "P2",
			relationships: [],
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-GITHUB-ACTIONS-RECON01",
			related_acts: ["ACT-CLINEMM-GITHUB-ACTIONS-RECON01"],
			evidence_locators: [],
			reopen_conditions: [],
			source_refs: [{ path: DIST, lines: [37, 37] }],
		},
		{
			item_id: "GITHUB-DISTRIBUTION01",
			title: "EPIC-CLINEMM-GITHUB-DISTRIBUTION01 — GitHub distribution",
			description:
				"Two distinct questions, do not conflate: (A) publish a Cline-- distributable artifact to GitHub (likely primary artifact: VSIX via GitHub Release asset); (B) determine whether any package genuinely belongs in GitHub Packages. Artifact trust binding: `SOURCE_HEAD`, `VERSION`, `PATH`, `BYTE_SIZE`, `SHA256`, installed version where relevant. Rule: do not rebuild a supposedly identical release artifact after qualification unless reproducibility is separately proven.",
			workstream: "distribution-ci",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "P2",
			source_priority: "P2",
			relationships: [],
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [],
			source_refs: [{ path: DIST, lines: [38, 38] }],
		},
		{
			item_id: "DOGFOOD-SINGLE-WORKTREE-CLEANUP01",
			title:
				"ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01 — drop the detached dogfood worktree",
			description:
				"Symptom: the dogfood builder still creates a detached temporary Git worktree, contrary to the current one-worktree repository policy. Goal: package/install dogfood without linked Git worktree topology, if safely possible. **Do not execute in this ACT** (per the source's own instruction). Status: OPEN (P2).",
			workstream: "distribution-ci",
			original_status: "OPEN (P2)",
			lifecycle: "OPEN",
			priority: "P2",
			source_priority: "P2",
			relationships: [],
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: "ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01",
			related_acts: ["ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01"],
			evidence_locators: [],
			reopen_conditions: [],
			source_refs: [{ path: DIST, lines: [39, 39] }],
		},
		{
			item_id: "EXTENSION-PUBLISHING01",
			title:
				"EPIC-CLINEMM-EXTENSION-PUBLISHING01 — publish to VS Code Marketplace + Open VSX",
			description:
				'Publish ClineMM "like Cline does" to VS Code Marketplace + Open VSX; lives under the `distribution-ci.md` detail file rather than requiring a new detail file. First ACT under the umbrella: `VSCODE-MARKETPLACE-PUBLISH-RECON01` — recon the VS Code Marketplace publish path (publisher account, PAT scopes, vsce tooling, release asset shape). Second ACT: `OPENVSX-PUBLISH-RECON01` — recon the Open VSX / Codium publish path (namespace, token, ovsx tooling, mirror). `DUAL-REGISTRY-RELEASE-AUTOMATION01` is BLOCKED on the two recon ACTs; `RELEASE-IDENTITY-AND-PROVENANCE01` is BLOCKED on dual-registry; `PUBLISHING-QUALIFICATION01` is BLOCKED on provenance.',
			workstream: "distribution-ci",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "P1",
			source_priority: "P1",
			relationships: [],
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [],
			source_refs: [
				{ path: DIST, lines: [26, 30] },
				{ path: BOARD, lines: [9395, 9395] },
			],
		},
	],
};

/**
 * EPIC-CLINEMM-DYNAMIC-EDITING-BACKENDS — the Dirac-style editing-backend lane.
 *
 * The source states the ordering as recon → abstraction → backend integration →
 * qualification, and explicitly forbids collapsing it. All items below the
 * recon are BLOCKED on their declared dependency, so their lifecycle is
 * BLOCKED rather than OPEN.
 */
export const EPIC_DYNAMIC_EDITING: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-DYNAMIC-EDITING-BACKENDS",
	source_file: ".factory/epics/dynamic-editing-backends.md",
	title: "Dynamic editing backends / Dirac",
	original_status:
		"ACTIVE — fresh epic opened at FUTURE-BACKLOG-CENSUS01 (2026-08-27). No ACT authored yet; the items below are working labels (canonical ACT IDs are assigned per FACT-001 in `.factory/epics/factory-infrastructure.md`).",
	lifecycle: "ACTIVE",
	priority: "P1",
	source_priority: "P1",
	exit_criteria: [
		"A user-visible benefit of a non-native backend is reproduced in production-equivalent tests against the Cline-native path (→ the BLOCK on `EDIT-BACKEND-ABSTRACTION01` is reconsidered).",
		"The Cline-native edit path widens authority / weakens approval / skips the audit trail (→ HOLD all backend work until repaired).",
	],
	source_refs: [
		{ path: DYNAMIC, lines: [5, 11] },
		{ path: DYNAMIC, lines: [22, 46] },
	],
	items: [
		{
			item_id: "DIRAC-EDITING-RECON01",
			title: "DIRAC-EDITING-RECON01 — Dirac-style editing-backend recon",
			description:
				"Working-label recon. Must characterize: the current edit path (which calls, which authority, which audit), which Dirac-style mechanics are *actually* needed (not all of them), and the minimum abstraction surface required to plug a non-native backend. Do not implement anything in this ACT. Target modes are `cline-native`, `dirac`, `auto`; `auto` selects per-file using the backend's claimed suitability for the file class. The Cline-native edit path is the safety baseline: no new backend may widen filesystem authority, weaken approval semantics, or skip the existing audit trail; the Cline-native path remains the default unless the user explicitly opts in. Hash-anchored / AST-aware mechanics are a *candidate* capability, not a *proven* one — every claim must come from a bounded recon, not a marketing description. Conservative-first ordering: recon first, abstraction second, backend integration third, qualification fourth.",
			workstream: "dynamic-editing-backends",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "P1",
			source_priority: "P1",
			relationships: [],
			qualification: "UNQUALIFIED",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"A user-visible benefit of a non-native backend is reproduced in production-equivalent tests against the Cline-native path.",
			],
			source_refs: [{ path: DYNAMIC, lines: [35, 35] }],
		},
		{
			item_id: "EDIT-BACKEND-ABSTRACTION01",
			title: "EDIT-BACKEND-ABSTRACTION01 — editing-backend abstraction",
			description:
				"Define the backend interface + capability declaration; do NOT integrate any non-native backend in this ACT. The backend interface must be capability-based (declare what you support, not what you are); allow per-session and per-call override; preserve audit-trail parity. BLOCKED on the recon.",
			workstream: "dynamic-editing-backends",
			original_status: "BLOCKED on recon",
			lifecycle: "BLOCKED",
			priority: "P1",
			source_priority: "P1",
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: ["BLOCKED on `DIRAC-EDITING-RECON01`."],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [
				"A user-visible benefit of a non-native backend is reproduced in production-equivalent tests against the Cline-native path (→ the BLOCK is reconsidered).",
			],
			source_refs: [{ path: DYNAMIC, lines: [36, 36] }],
			relationships: [
				{
					kind: "DEPENDS_ON",
					target: "EPIC-CLINEMM-DYNAMIC-EDITING-BACKENDS/DIRAC-EDITING-RECON01",
					required_outcome:
						"The recon lands and scopes the minimum abstraction surface",
					source_refs: [{ path: DYNAMIC, lines: [25, 25] }],
				},
			],
		},
	],
};

/**
 * EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY — the tool/command runtime-correctness lane.
 */
export const EPIC_TOOL_RUNTIME_RELIABILITY: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY",
	source_file: ".factory/epics/tool-runtime-reliability.md",
	title: "Tool runtime reliability",
	original_status:
		"OPEN — fresh epic opened at FUTURE-BACKLOG-CENSUS01-CORRECTION01. No ACT authored yet; the items below are working labels (canonical ACT IDs are assigned per FACT-001 in `.factory/epics/factory-infrastructure.md`).",
	lifecycle: "OPEN",
	priority: "P1",
	source_priority: "HIGH",
	exit_criteria: [
		"A cluster reproduces at the local canonical seam (→ the cluster ACT gets unblocked and authored as a bounded repair ACT).",
		"An upstream `RELATED_TOOL_RUNTIME` issue graduates from RADAR to IMPORT against this epic.",
		"A new cluster is observed locally that does not fit the 7-cluster taxonomy (→ the umbrella taxonomy is amended in a separate ACT).",
	],
	source_refs: [
		{ path: TOOLRUNTIME, lines: [5, 12] },
		{ path: TOOLRUNTIME, lines: [73, 86] },
	],
	items: [
		{
			item_id: "TOOL-RUNTIME-RELIABILITY-RECON01",
			title:
				"TOOL-RUNTIME-RELIABILITY-RECON01 — tool/command runtime-correctness recon",
			description:
				'First ACT: bounded RECON + exact live RED. The deliverable is a markdown document that (a) characterizes each of the 7 clusters against local ClineMM evidence, (b) promotes only the clusters that pass the strict destination-contract test against this epic, (c) leaves the rest as RADAR with a clear re-promotion path, (d) does NOT pre-classify cause. No production change in this ACT. Scope boundary: tool-runtime-reliability = "did an individual tool/command execute, return, time out, parse, route, retry, terminate correctly?"; runtime-task-progression = "after that event, did the overall agent/task make the correct state transition and continue?"; tool-execution-semantics = "telemetry classification of what the tool was (mechanism / outcome / duration / effect-class / purpose)". These three questions are separately answerable and must NOT be merged into a single epic. Correction-03 cluster inventory: terminal-timeout / wait lifecycle 9; tool-call parsing 5; MCP routing / approval / validation 3; shell integration 2; tool loop / retry 2; file-edit reliability 1; tool-approval UX 1 (total 23 upstream issues, recorded as RADAR / cluster-assigned; none graduated to IMPORT yet).',
			workstream: "tool-runtime-reliability",
			original_status: "HIGH",
			lifecycle: "OPEN",
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
			evidence_locators: [".factory/upstream/cline-upstream-triage.md"],
			reopen_conditions: [
				"A cluster reproduces at the local canonical seam (→ the cluster ACT gets unblocked and authored as a bounded repair ACT).",
				"An upstream `RELATED_TOOL_RUNTIME` issue graduates from RADAR to IMPORT against this epic.",
			],
			source_refs: [{ path: TOOLRUNTIME, lines: [75, 75] }],
		},
	],
};

/**
 * EPIC-CLINEMM-TASK-PRESENTATION — the presentation substrate.
 *
 * The source states the current frontier is **no open work**; the remaining
 * item is the LIVE qualification of OBS-05, which the source records as a
 * reopen trigger rather than an open obligation. The epic is retained as
 * discoverable even though its operational item collection is empty.
 */
export const EPIC_TASK_PRESENTATION: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-TASK-PRESENTATION",
	source_file: ".factory/epics/task-presentation.md",
	title: "Task presentation",
	original_status: "ACTIVE — closed substrate + closed frontier",
	lifecycle: "ACTIVE",
	priority: "P1",
	source_priority: "P1",
	exit_criteria: [
		"New compaction authority appears that bypasses `COMPACTION-STATE-AUTHORITY01`.",
		"Context accounting observed diverging between producer and any consumer.",
		"User-context ceiling becomes soft in production.",
		"A new second independent lifecycle classifier appears in the TaskHeader source (re-open trigger for `TASKHEADER-CANONICAL-PROJECTION01`).",
		"Live evidence captured that distinguishes agent-active elapsed from wall-clock elapsed and the user demands the distinction (re-open trigger for `TASKHEADER-OWNER-AWARE-TIMING01`).",
	],
	source_refs: [
		{ path: TASKPRES, lines: [5, 11] },
		{ path: TASKPRES, lines: [42, 58] },
	],
	items: [],
};

/** EPIC-CLINEMM-TASK-CONTROL-LIVENESS — the message-coordinator bug-family closure. */
export const EPIC_TASK_CONTROL_LIVENESS: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-TASK-CONTROL-LIVENESS",
	source_file: ".factory/epics/task-control-liveness.md",
	title: "Task control liveness",
	original_status:
		'CLOSED family (the generation-fence repair is bounded; the queued-prompt integrity work is bounded; the bug-family closure is a structural statement of how to recognize this class of bug in future reviews. The "live" qualification against a live Cline-- extension host is not asserted here — the source-verbatim is "bounded generation-fence repair landed"; exact-head LIVE qualification = pending).',
	lifecycle: "TERMINAL",
	priority: "P1",
	source_priority: "P1",
	exit_criteria: [
		"Any new message-coordinator invariant violation should be evaluated against the bug-family signature before starting a fresh ACT.",
	],
	source_refs: [
		{ path: TASKCTRL, lines: [5, 11] },
		{ path: TASKCTRL, lines: [27, 34] },
	],
	items: [
		{
			item_id: "R3-R4-ADVERSARIAL-SCHEDULES",
			title: "R3/R4 task-control adversarial schedules",
			description:
				"Deferred adversarial schedule hunting for the R3 / R4 task-control lane. The board's Deferred / hold table records this item as consciously postponed; the source states the current frontier for this domain is post-sharding review.",
			workstream: "task-control-liveness",
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
				"Any new message-coordinator invariant violation should be evaluated against the bug-family signature before starting a fresh ACT.",
			],
			source_refs: [{ path: BOARD, lines: [9438, 9438] }],
		},
	],
};

/** EPIC-CLINEMM-UPSTREAM-INTAKE — the upstream triage cycle (closed substrate). */
export const EPIC_UPSTREAM_INTAKE: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-UPSTREAM-INTAKE",
	source_file: ".factory/epics/upstream-intake.md",
	title: "Upstream intake",
	original_status:
		"CLOSED (the closed-substrate / first-triage / four-corrections cycle is complete and the cumulative invariant holds: 12 surviving EXACT_MAPs and 5 IMPORTs satisfy the binding rule)",
	lifecycle: "TERMINAL",
	priority: "P2",
	source_priority: "P2",
	exit_criteria: [
		"A new upstream intake cycle is needed (substrate is re-runnable; this is normal and not a defect).",
		"A new lexical-overlap defect class is identified in a future triage cycle.",
		"The binding invariant is violated by a future cycle (an upstream issue is cited as evidence for a canonical epic whose failure contract it does not reproduce).",
	],
	source_refs: [
		{ path: UPSTREAM, lines: [5, 11] },
		{ path: UPSTREAM, lines: [30, 72] },
	],
	items: [
		{
			item_id: "CHECKPOINT-RELIABILITY01",
			title: "EPIC-CLINEMM-CHECKPOINT-RELIABILITY01 — checkpoint reliability",
			description:
				'Cross-cutting supporting work recorded as OPEN on the board\'s "Open supporting work" table, owned by the upstream-intake detail file. The board states the dependency as n/a.',
			workstream: "upstream-intake",
			original_status: "OPEN",
			lifecycle: "OPEN",
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
			reopen_conditions: [],
			source_refs: [{ path: BOARD, lines: [9417, 9417] }],
		},
		{
			item_id: "MCP-PROCESS-LIFECYCLE01",
			title: "EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01 — MCP process lifecycle",
			description:
				'Cross-cutting supporting work recorded as OPEN on the board\'s "Open supporting work" table, owned by the upstream-intake detail file. The board states the dependency as n/a. The tool-runtime-reliability epic cross-references it as a durable sibling for the MCP routing / approval / validation cluster (3 issues) and does NOT subsume it.',
			workstream: "upstream-intake",
			original_status: "OPEN",
			lifecycle: "OPEN",
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
			reopen_conditions: [],
			source_refs: [{ path: BOARD, lines: [9418, 9418] }],
		},
		{
			item_id: "CLINEIGNORE-FILTERING01",
			title: "EPIC-CLINEMM-CLINEIGNORE-FILTERING01 — .clineignore filtering",
			description:
				'Cross-cutting supporting work recorded as OPEN on the board\'s "Open supporting work" table, owned by the upstream-intake detail file. The board states the dependency as n/a.',
			workstream: "upstream-intake",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "P2",
			source_priority: "P2",
			relationships: [],
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [],
			source_refs: [{ path: BOARD, lines: [9419, 9419] }],
		},
		{
			item_id: "PROVIDER-MODEL-DISCOVERY01",
			title:
				"EPIC-CLINEMM-PROVIDER-MODEL-DISCOVERY01 — provider model discovery",
			description:
				'Cross-cutting supporting work recorded as OPEN on the board\'s "Open supporting work" table, owned by the upstream-intake detail file. The board states the dependency as n/a.',
			workstream: "upstream-intake",
			original_status: "OPEN",
			lifecycle: "OPEN",
			priority: "P2",
			source_priority: "P2",
			relationships: [],
			qualification: "UNKNOWN",
			criteria: [],
			criteria_coverage: "UNKNOWN",
			dependency_coverage: "COMPLETE",
			blockers: [],
			current_act: null,
			related_acts: [],
			evidence_locators: [],
			reopen_conditions: [],
			source_refs: [{ path: BOARD, lines: [9420, 9420] }],
		},
	],
};

/** EPIC-CLINEMM-CLOSED-FOUNDATION — the closed historical foundation. */
export const EPIC_CLOSED_FOUNDATION: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-CLOSED-FOUNDATION",
	source_file: ".factory/epics/closed-foundation.md",
	title: "Closed foundation",
	original_status: "CLOSED (historical)",
	lifecycle: "TERMINAL",
	priority: "P3",
	source_priority: "P3 / reference-only",
	exit_criteria: [
		"See `task-presentation.md` and `webview-seam-aop.md` for in-flight work that builds on this substrate.",
	],
	source_refs: [
		{ path: CLOSEDFOUND, lines: [5, 11] },
		{ path: CLOSEDFOUND, lines: [16, 37] },
	],
	items: [],
};

/** EPIC-CLINEMM-WEBVIEW-SEAM-AOP — the closed AOP substrate. */
export const EPIC_WEBVIEW_SEAM_AOP: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-WEBVIEW-SEAM-AOP",
	source_file: ".factory/epics/webview-seam-aop.md",
	title: "Webview seam AOP",
	original_status:
		"CLOSED (all sub-ACTs landed; family is historical substrate)",
	lifecycle: "TERMINAL",
	priority: "P2",
	source_priority: "P2",
	exit_criteria: [
		"The RESULT01 sub-ACT (`…LIVE-CAPTURE01-RESULT01`) is `AWAITING_DOGFOOD` — when it lands, it will be recorded in the epic detail file.",
	],
	source_refs: [
		{ path: WEBVIEW, lines: [5, 11] },
		{ path: WEBVIEW, lines: [37, 44] },
	],
	items: [],
};

/** EPIC-CLINEMM-COMMAND-RISK-CLASSIFICATION — the closed command-risk framework. */
export const EPIC_COMMAND_RISK_CLASSIFICATION: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-COMMAND-RISK-CLASSIFICATION",
	source_file: ".factory/epics/command-risk-classification.md",
	title: "Command-risk classification",
	original_status:
		"CLOSED framework (V1 GREEN, V2 framework with HALT_SHIPPING posture; V2-READONLY-COMPOSITION01 STRUCTURAL and shipped as bounded auto-approve for safe `&&` chains)",
	lifecycle: "TERMINAL",
	priority: "P1",
	source_priority: "P1",
	exit_criteria: [
		"Further rules / expansion is deferred pending a fresh ACT (see the V2 ACT ledger row).",
	],
	source_refs: [
		{ path: COMMANDRISK, lines: [5, 11] },
		{ path: COMMANDRISK, lines: [19, 40] },
	],
	items: [],
};

/** EPIC-CLINEMM-AUTHENTICATED-DEV-CAPABILITIES — the deferred credential-capability family. */
export const EPIC_AUTHENTICATED_DEV_CAPABILITIES: ReconciledEpic = {
	epic_id: "EPIC-CLINEMM-AUTHENTICATED-DEV-CAPABILITIES",
	source_file: ".factory/epics/authenticated-dev-capabilities.md",
	title: "Authenticated dev capabilities",
	original_status:
		"DEFER (intentionally not current execution debt; do **not** auto-promote without a fresh ACT — see reopen conditions below).",
	lifecycle: "DEFERRED",
	priority: "P1",
	source_priority: "P1",
	exit_criteria: [
		"The user asks for an authenticated capability that the current ClineMM cannot provide safely (→ the design ACT gets prioritized).",
		"An upstream Cline-- change exposes a credential surface that conflicts with the V1 boundary (→ the design ACT must precede any bridge ACT).",
		"A bounded credential-helper integration is proven safe in another ClineMM epic and can be reused (→ unblock the corresponding per-family ACT).",
	],
	source_refs: [
		{ path: AUTHDEV, lines: [5, 11] },
		{ path: AUTHDEV, lines: [37, 60] },
	],
	items: [
		{
			item_id: "AUTH-DEV-CAP-DESIGN01",
			title: "AUTH-DEV-CAP-DESIGN01 — per-family credential-capability design",
			description:
				"Design space only. The deliverable is a markdown document under `.factory/epics/authenticated-dev-capabilities.md` that names: each credential family, the proposed host-side executor pattern, the audit-log contract, and an explicit **per-family opt-in surface** the user would toggle. No source code, no credential bytes, no live invocation in the design ACT. The V1 sensitive-read confinement contract was deliberately scoped to SSH / GnuPG / macOS-keychain and EXCLUDED `~/.aws/`, `~/.kube/`, `~/.docker/config.json`, `~/.config/gh/hosts.yml`; the design ACT must propose how to handle the excluded surfaces without breaking the V1 boundary. The four per-family implementation ACTs (`AUTH-DEV-CAP-AWS01`, `AUTH-DEV-CAP-KUBE01`, `AUTH-DEV-CAP-DOCKER01`, `AUTH-DEV-CAP-GH01`) are all explicitly DEFER on the design ACT landing.",
			workstream: "authenticated-dev-capabilities",
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
				"The user asks for an authenticated capability that the current ClineMM cannot provide safely.",
				"An upstream Cline-- change exposes a credential surface that conflicts with the V1 boundary.",
				"A bounded credential-helper integration is proven safe in another ClineMM epic and can be reused.",
			],
			source_refs: [{ path: AUTHDEV, lines: [47, 56] }],
		},
	],
};
