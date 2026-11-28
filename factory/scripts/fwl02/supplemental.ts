#!/usr/bin/env bun
/**
 * factory/scripts/fwl02/supplemental.ts
 *
 * ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01 — supplemental evidence.
 *
 * These artifacts are MIGRATION EVIDENCE, not canonical ledger state. They are
 * clearly distinguished from the four machine-consumed FWMI inputs:
 *
 *   machine-consumed  source-manifest.json, epics/*.json,
 *                     historical-index.json, reconciliation.json,
 *                     frontier.md, validation-receipt.json
 *   supplemental      source-accounting.json,
 *                     decisions-and-knowledge-index.json,
 *                     source-delta.md
 *
 * The supplemental artifacts carry the accounting detail the FWMI v1 wire
 * schema has no field for: per-section source dispositions, the decisions and
 * reusable findings that are not representable as work items, and the exact
 * delta between the first shadow-migration source and the package's source.
 *
 * Run with: bun factory/scripts/fwl02/supplemental.ts
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	FWL02_FROZEN_SOURCE_HEAD,
	gitText,
	readCommittedBytes,
	resolveCommit,
	splitCommittedLines,
} from "./source-refs.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const PACKAGE_DIR = join(REPO_ROOT, ".factory/migration/FWL02");
const SOURCE_HEAD = resolveCommit(FWL02_FROZEN_SOURCE_HEAD, REPO_ROOT);

/** The first shadow-migration source head. */
const FIRST_SHADOW_HEAD = "29774ba05851f9dd5a46a33a90d963ff3ef286d5";

/**
 * Per-section source dispositions.
 *
 * Every relevant source region is classified. The classification vocabulary
 * mirrors the ACT's list:
 *   current_obligation | deferred_obligation | historical_execution |
 *   historical_terminal_obligation | decision | reusable_finding |
 *   cross_link | duplicate_representation | navigation_or_metadata |
 *   narrative_history | unresolved
 */
interface SectionDisposition {
	readonly path: string;
	readonly start_line: number;
	readonly end_line: number;
	readonly dispositions: readonly string[];
	readonly note: string;
}

const SECTION_DISPOSITIONS: readonly SectionDisposition[] = [
	{
		path: ".factory/epic-board.md",
		start_line: 1,
		end_line: 9343,
		dispositions: ["historical_execution", "narrative_history"],
		note: "Prepend-ordered historical ACT report log at heading level 1. 177 report sections were mechanically indexed by identity, verdict and exact source range into `historical-index.json`. The per-ACT prose bodies and the `Updated:` chronology lines are contiguous narrative history, preserved verbatim in the committed source archive and deliberately not reconstructed as work items.",
	},
	{
		path: ".factory/epic-board.md",
		start_line: 9344,
		end_line: 9351,
		dispositions: ["navigation_or_metadata"],
		note: "Board provenance header: the source-of-truth statement (`Source-of-truth: .factory/epics/*.md` — the per-epic detail files. **This board is a navigation index, not an archive.**), the contract link, the conservation anchor `5e96cfd3a`, and the size cap. Navigation and metadata, not an epic.",
	},
	{
		path: ".factory/epic-board.md",
		start_line: 9352,
		end_line: 9380,
		dispositions: ["current_obligation", "navigation_or_metadata"],
		note: "The Current frontier table — 21 lanes with their state and NEXT. This is the operational index the migration's frontier records are reconciled from. Lanes recorded CLOSED / CLOSED_STRUCTURAL / CLOSED_V2 carry no current obligation; lanes recorded OPEN / HOLD / ACTIVE do.",
	},
	{
		path: ".factory/epic-board.md",
		start_line: 9381,
		end_line: 9405,
		dispositions: [
			"current_obligation",
			"navigation_or_metadata",
			"historical_terminal_obligation",
		],
		note: "The Active epics table — 16 rows. Every epic with an ACTIVE family-level state is represented as an epic record, including the ones whose Frontier column is `(none)`. CLOSED epics are represented as TERMINAL epics and remain discoverable.",
	},
	{
		path: ".factory/epic-board.md",
		start_line: 9406,
		end_line: 9424,
		dispositions: ["current_obligation", "cross_link"],
		note: "The Open supporting work table — 9 cross-cutting rows plus the FWL02 producer row. Each row's Detail link determines the owning epic; the rows are represented in their owning epic's item collection.",
	},
	{
		path: ".factory/epic-board.md",
		start_line: 9425,
		end_line: 9442,
		dispositions: ["deferred_obligation"],
		note: "The Deferred / hold table — 9 rows. Every row is represented with `lifecycle: DEFERRED` in its owning epic. A DEFERRED row is work the source explicitly postponed; it is not part of the operational frontier.",
	},
	{
		path: ".factory/epic-board.md",
		start_line: 9443,
		end_line: 9541,
		dispositions: ["narrative_history", "historical_execution"],
		note: 'The Historical task census — a conservation-only ACT-ID listing grouped by family, explicitly "an audit trail, not a status report". The identities it lists are already covered by the historical ACT index; the region is accounted for as narrative history plus the already-indexed ACT identities.',
	},
	{
		path: ".factory/epic-board.md",
		start_line: 9542,
		end_line: 44731,
		dispositions: ["historical_execution", "narrative_history"],
		note: "The TRAILING region of the board — the range the previous source accounting stopped at. It is NOT narrative-only: it carries the board's maintenance contract, its status / priority vocabulary, its size invariant and, above all, 205 further ACT report sections at heading level 2 (`## ACT-... — VERDICT — date`). Those 205 sections belong to 149 DISTINCT historical ACT identities that the level-1-only extraction had silently skipped, which is why the previous accounting reported 167 identities. Every one of those identities is now mechanically indexed by identity, verdict and exact source range into `historical-index.json` with its own disposition (289 UNAMBIGUOUS, 2 AMBIGUOUS, 25 CONFLICTING over 316 distinct identities in total). The 25 conflicting identities are surfaced by the SOURCE_CONFLICT reconciliation records; the remainder are accounted for at the COLD level — identity, verdict and exact source range — with their complete original bytes preserved verbatim in the committed source archive. The report bodies and `Updated:` chronology lines inside this range are accounted for as contiguous narrative history at the byte level and are deliberately NOT reconstructed paragraph-by-paragraph as new work items. No outstanding obligation was found in this range that the operational index and the per-epic detail files do not already own; the 149 identities are historical EXECUTIONS, not current obligations.",
	},
	{
		path: ".factory/epics/_index-contract.md",
		start_line: 1,
		end_line: 177,
		dispositions: ["navigation_or_metadata", "decision"],
		note: "The frozen maintenance contract: authority hierarchy, closed-class status vocabulary, priority semantics, frontier rules, conservation rules, human-readability rules and link rules. It is NAVIGATION and METADATA — it never becomes an independent epic — but it is the authority for the status vocabulary this migration normalizes against, and its `HOST_REQUIRED` rule is a decision the migration preserves.",
	},
	{
		path: ".factory/epics/safe-yolo-seatbelt.md",
		start_line: 5,
		end_line: 11,
		dispositions: [
			"current_obligation",
			"historical_terminal_obligation",
			"decision",
		],
		note: "A single very long Current-status bullet enumerating the closed substrate contracts AND the still-open R5 manual-approval lane, AND the `RETURN_TO_SSH_LIVE_QUALIFICATION` operational action. Split: the closed contracts are historical terminal obligations (indexed through the historical ACT index); the R5 lane is a current obligation.",
	},
	{
		path: ".factory/epics/safe-yolo-seatbelt.md",
		start_line: 42,
		end_line: 58,
		dispositions: [
			"current_obligation",
			"historical_terminal_obligation",
			"reusable_finding",
		],
		note: "The Open work section. The `WORKSPACE_IS_DATA_AUTHORITY_BOUNDARY` policy conclusion and the `NEXT_R5_TRIGGER` predicate are REUSABLE FINDINGS carried into the R5 lane's description.",
	},
	{
		path: ".factory/epics/safe-yolo-seatbelt.md",
		start_line: 60,
		end_line: 176,
		dispositions: ["deferred_obligation", "reusable_finding"],
		note: "The Deferred work section — the seatbelt-user-facing settings surface cross-link (FW-05), the TEMP-INTERNAL-CONTROL-CLEANUP primary-owner row (FW-11), the SINGLE-R0 execution-obligation sibling and the network-policy hardening row.",
	},
	{
		path: ".factory/epics/architecture.md",
		start_line: 34,
		end_line: 52,
		dispositions: ["current_obligation", "deferred_obligation", "cross_link"],
		note: "The Open work section — E8 (legacy writer retirement), E9 (effect interpreter) and EPIC-CLINEMM-ELMIZATION02. These are the W4 Candidate 3 records: the source states their actual engineering meanings and their explicit unblocking chain, which the migration recovers.",
	},
	{
		path: ".factory/epics/product-config-branding.md",
		start_line: 34,
		end_line: 49,
		dispositions: ["current_obligation", "cross_link", "unresolved"],
		note: "The Open work section — the tool-execution-semantics umbrella, the branding umbrella, TASK-COST-TRUTH-RECON01, and the W4 Candidate 2 record `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` whose epic placement is explicitly tentative.",
	},
	{
		path: ".factory/epics/product-config-branding.md",
		start_line: 50,
		end_line: 299,
		dispositions: ["deferred_obligation", "cross_link", "unresolved"],
		note: "The Deferred work section — the branding demo row, the TEMP-INTERNAL-CONTROL-CLEANUP cross-cutting child row (W4 Candidate 1) and the settings-surface-parity backlog row.",
	},
	{
		path: ".factory/epics/approval-protection.md",
		start_line: 42,
		end_line: 66,
		dispositions: [
			"current_obligation",
			"historical_terminal_obligation",
			"cross_link",
			"decision",
		],
		note: "The Open work section — HOST-TEST RUNNER, CLASSIC-PROTECTION-RECON01, EDITOR-TOOL-APPROVAL-FRICTION-RECON01 and the closed R5 contract row. The 2026-08-31 product-policy decision (E3 resolution: `SESSION_OVERRIDE=ALL` + effective Seatbelt confinement ⇒ ALL means ALL for native editor tools) is a DECISION and is preserved verbatim.",
	},
	{
		path: ".factory/epics/approval-protection.md",
		start_line: 67,
		end_line: 168,
		dispositions: ["deferred_obligation", "reusable_finding"],
		note: "The Deferred work section — the DESTRUCTIVE-SCOPE-REFINEMENT recon (with its `BROAD_MUTATION != AUTHORIZED_MUTATION` doctrine) and the approval-transaction-recorder future work. Both carry reusable findings into their item descriptions.",
	},
	{
		path: ".factory/epics/runtime-task-progression.md",
		start_line: 5,
		end_line: 13,
		dispositions: [
			"current_obligation",
			"historical_terminal_obligation",
			"reusable_finding",
		],
		note: "The Current status block. It records the OPERATIONAL ACTION (`RETURN_TO_SSH_LIVE_QUALIFICATION`), the explicit DO-NOT (`DO NOT open ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-REPAIR01`), and the preserved structural findings (the two latent defects that are NOT the live cause). These are reusable findings.",
	},
	{
		path: ".factory/epics/runtime-task-progression.md",
		start_line: 72,
		end_line: 86,
		dispositions: [
			"current_obligation",
			"historical_terminal_obligation",
			"unresolved",
		],
		note: "The Open work section — the umbrella recon, the CANCEL-AFFORDANCE recon (LIVE capture half still open), the closed LIVENESS02 / CONTRACT01 / IMPLEMENTATION01 records and the restored EDITOR-TOOL-APPROVAL-FRICTION NEXT.",
	},
	{
		path: ".factory/epics/factory-infrastructure.md",
		start_line: 28,
		end_line: 44,
		dispositions: ["decision", "historical_terminal_obligation"],
		note: "The Ownership section — the DECISION that Leamas is the sole implementation owner of the ledger and its FWMI consumer, and that ClineMM is the producer. The superseded experimental adapter's disposition is preserved here and in the reconciliation manifest.",
	},
	{
		path: ".factory/epics/quality-substrate.md",
		start_line: 36,
		end_line: 53,
		dispositions: ["current_obligation", "cross_link"],
		note: "The Open work section — the typecheck umbrella (CLOSED at the local seam, OPEN at CI parity) and the code-coverage baseline. The CI-parity dependency on `EPIC-CLINEMM-GITHUB-ACTIONS01` is an explicit source-stated DEPENDS_ON.",
	},
	{
		path: ".factory/epics/context-compaction-token-accounting.md",
		start_line: 23,
		end_line: 112,
		dispositions: [
			"current_obligation",
			"historical_terminal_obligation",
			"reusable_finding",
		],
		note: "The Current status block — the discriminator result, the BROKEN_CONSUMER_SEAM and the three admissible header-bar contracts. The reusable finding (cross-scale ratio transfer is invalid for working contexts large enough to engage buildForApi's truncation budgets) is preserved in the item description.",
	},
	{
		path: ".factory/epics/command-risk-classification.md",
		start_line: 1,
		end_line: 460166,
		dispositions: [
			"narrative_history",
			"historical_execution",
			"reusable_finding",
			"decision",
		],
		note: "The closed V1/V2 command-risk framework with its full ACT closure narratives. The framework's durable contract conclusions (the risk tiers, the HALT_SHIPPING posture) are RECLAIMABLE reusable findings; the per-ACT closure narratives are accounted for at the COLD level.",
	},
	{
		path: ".factory/epics/webview-seam-aop.md",
		start_line: 1,
		end_line: 159285,
		dispositions: [
			"narrative_history",
			"historical_execution",
			"reusable_finding",
		],
		note: "The closed AOP substrate with its full ACT closure narratives. The AOP extension-point contract is a reusable finding; the per-ACT closure narratives are accounted for at the COLD level.",
	},
	{
		path: ".factory/epics/upstream-intake.md",
		start_line: 30,
		end_line: 72,
		dispositions: [
			"historical_terminal_obligation",
			"reusable_finding",
			"decision",
		],
		note: "The ACT ledger and the cumulative disposition table. The four triage dispositions (IMPORT / MAP_EXISTING / RADAR / REJECT) and the binding invariant are DECISIONS; the snapshot contract and the size policy are reusable findings.",
	},
	{
		path: ".factory/epics/approval-mcp-authority.md",
		start_line: 11,
		end_line: 18,
		dispositions: ["current_obligation", "decision"],
		note: 'The Current status block — the `P0-if-reproduced` priority (conditional, NOT a current confirmed P0) and the factory causal reviewer\'s DECISION: "Give it its own authority owner." This is why the lane has its own epic record rather than being folded into approval-protection.',
	},
	{
		path: ".factory/epics/file-tool-workspace-realpath-authority.md",
		start_line: 6,
		end_line: 160,
		dispositions: ["current_obligation", "decision", "reusable_finding"],
		note: "The security lane's own detail file. The CORRECTED invariant (every model-controlled mutation must remain inside the writable root(s) explicitly authorized for THAT tool invocation, NOT a global workspace root) is a DECISION; the Q5 RED matrix with its A/B/C/D controls is the reusable finding bound to the obligation.",
	},
	{
		path: ".factory/epics/distribution-ci.md",
		start_line: 20,
		end_line: 46,
		dispositions: ["current_obligation", "decision", "reusable_finding"],
		note: "The ACT ledger and Open work. The two distinct distribution questions, the artifact trust binding and the reproducibility rule are DECISIONS and reusable findings.",
	},
	{
		path: ".factory/epics/host-test-infrastructure.md",
		start_line: 5,
		end_line: 59,
		dispositions: ["current_obligation", "decision", "cross_link"],
		note: "The canonical detail file for the HOST-TEST RUNNER lane. The trust model, the bounded-inputs rule, the machine-readable-output rule and the audit-trail contract are DECISIONS bound to the obligation.",
	},
	{
		path: ".factory/epics/dynamic-editing-backends.md",
		start_line: 5,
		end_line: 46,
		dispositions: ["current_obligation", "decision", "reusable_finding"],
		note: "The Dirac-style editing-backend lane. The target modes, the Cline-native safety baseline and the conservative-first ordering are DECISIONS and reusable findings bound to the recon obligation.",
	},
	{
		path: ".factory/epics/tool-runtime-reliability.md",
		start_line: 5,
		end_line: 86,
		dispositions: ["current_obligation", "decision", "reusable_finding"],
		note: "The tool/command runtime-correctness lane. The three-way scope boundary (runtime correctness vs. task progression vs. telemetry classification) is a DECISION; the 7-cluster Correction-03 inventory is a reusable finding.",
	},
	{
		path: ".factory/epics/task-presentation.md",
		start_line: 5,
		end_line: 99,
		dispositions: [
			"current_obligation",
			"historical_terminal_obligation",
			"reusable_finding",
		],
		note: "The presentation substrate. Its Current status states **no open work**; the epic record is retained with an empty item collection so the closed substrate remains discoverable. The reopen conditions are preserved as the epic's exit criteria.",
	},
	{
		path: ".factory/epics/task-control-liveness.md",
		start_line: 5,
		end_line: 43,
		dispositions: [
			"deferred_obligation",
			"historical_terminal_obligation",
			"reusable_finding",
		],
		note: "The closed bug-family with the deferred R3/R4 adversarial schedules. The bug-family signature is a reusable finding preserved in the epic's exit criteria.",
	},
	{
		path: ".factory/epics/authenticated-dev-capabilities.md",
		start_line: 5,
		end_line: 60,
		dispositions: ["deferred_obligation", "decision", "reusable_finding"],
		note: "The deferred credential-capability family. The V1 sensitive-read confinement scope (SSH / GnuPG / macOS-keychain INCLUDED; `~/.aws/`, `~/.kube/`, `~/.docker/config.json`, `~/.config/gh/hosts.yml` EXCLUDED) is a DECISION and a reusable finding.",
	},
	{
		path: ".factory/epics/closed-foundation.md",
		start_line: 1,
		end_line: 47,
		dispositions: ["historical_terminal_obligation", "narrative_history"],
		note: "The closed historical foundation. Retained as a TERMINAL epic with an empty item collection so the closed substrate remains discoverable.",
	},
];

/**
 * Decisions and reusable findings.
 *
 * These are engineering conclusions that the FWMI v1 wire schema has no field
 * for. They are preserved here as source-bound MIGRATION EVIDENCE — they are
 * NOT canonical ledger state and they do NOT create work items.
 */
interface DecisionOrFinding {
	readonly id: string;
	readonly kind: "decision" | "reusable_finding";
	readonly title: string;
	readonly statement: string;
	readonly path: string;
	readonly start_line: number;
	readonly end_line: number;
}

const DECISIONS_AND_FINDINGS: readonly DecisionOrFinding[] = [
	{
		id: "DEC-CLINEMM-LEAMAS-OWNS-LEDGER",
		kind: "decision",
		title:
			"Leamas is the sole implementation owner of the Factory Work Ledger and its FWMI consumer",
		statement:
			"Leamas is the SOLE implementation owner of the Factory Work Ledger and of its FWMI v1 import consumer. The consumer lives in the existing Go ledger domain, importer, transaction store, evidence authority and rendering mechanisms of the Leamas repository. ClineMM is the PRODUCER of the FWMI v1 migration data; the destination remains `.leamas/ledger/`. There is no second ledger implementation in ClineMM, no universal Markdown parser and no architectural expansion.",
		path: ".factory/epics/factory-infrastructure.md",
		start_line: 30,
		end_line: 38,
	},
	{
		id: "DEC-CLINEMM-FWL02-ADAPTER-SUPERSEDED",
		kind: "decision",
		title: "The experimental ClineMM FWMI adapter is superseded and disowned",
		statement:
			"The `ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01` adapter was an experiment in the wrong repository. It was removed; the evidence package of that ACT is retained as the historical record of the experiment, not as a canonical implementation. The ClineMM-side adapter is DISOWNED; Leamas owns the consumer.",
		path: ".factory/epics/factory-infrastructure.md",
		start_line: 40,
		end_line: 43,
	},
	{
		id: "DEC-CLINEMM-INDEX-STATUS-VOCABULARY",
		kind: "decision",
		title:
			"The closed-class status vocabulary and the HOST_REQUIRED truth condition",
		statement:
			"The status tokens NEXT / OPEN / BLOCKED / HOLD / DEFER / CLOSED / SUPERSEDED / NEEDS_CLASSIFICATION / HOST_REQUIRED / ACTIVE are frozen for use across the board, the epic files, closure plans and the future validator; adding a new token requires amending the index contract. A claim that asserts a real-kernel, real-prompt, or unsandboxed-host property MUST either be backed by host-runner / live evidence under `.factory/evidence/<ACT>/`, or explicitly carry the HOST_REQUIRED marker in the verdict. The marker is not a status degradation — it is a truth condition for the claim.",
		path: ".factory/epics/_index-contract.md",
		start_line: 35,
		end_line: 70,
	},
	{
		id: "DEC-CLINEMM-BOARD-MAINTENANCE-RULE",
		kind: "decision",
		title: "The board maintenance rule",
		statement:
			"At the end of a meaningful ACT, update only rows affected by that ACT. Do not rewrite the whole board. Each row should preferably contain: ID, STATUS, PRIORITY, PURPOSE / SYMPTOM, DEPENDENCIES, NEXT ACT, EVIDENCE / COMMIT. Avoid giant prose. If an item is closed, preserve enough identity to avoid re-litigation. If evidence contradicts a board row, evidence wins; the row becomes P2 stale metadata.",
		path: ".factory/epics/factory-infrastructure.md",
		start_line: 15,
		end_line: 15,
	},
	{
		id: "DEC-CLINEMM-EVIDENCE-WINS",
		kind: "decision",
		title: "A summary may narrow evidence but must never strengthen it",
		statement:
			'A summary may narrow evidence (e.g. summarize a 4-phase closure into "CLOSED, 4/4 GREEN") but must never strengthen evidence (e.g. claim `CLOSED_CLEAN` when the evidence only proves `CLOSED_WITH_RESIDUE`). When evidence contradicts a board row, evidence wins; the row becomes P2 stale metadata per the board-maintenance rule.',
		path: ".factory/epics/_index-contract.md",
		start_line: 30,
		end_line: 33,
	},
	{
		id: "DEC-CLINEMM-ALL-MEANS-ALL-EDITOR-TOOLS",
		kind: "decision",
		title:
			"Session override ALL + effective Seatbelt confinement ⇒ ALL means ALL for native editor tools",
		statement:
			"SESSION_OVERRIDE=ALL AND effective Seatbelt confinement is active ⇒ ALL means ALL for native editor tools as well. Persisted editFiles=false is a baseline/default preference, NOT a hard deny against an explicit task-scoped ALL override. Explicit DENY / disabled capability remains non-overridable by ALL alone. E3 verdict: PASS_BY_PRODUCT_CONTRACT (resolved 2026-08-31; the structural finding that `override=all` lifts persisted `editFiles=false` is the intended behavior, NOT a defect).",
		path: ".factory/epics/approval-protection.md",
		start_line: 44,
		end_line: 44,
	},
	{
		id: "DEC-CLINEMM-DEFER-NOT-BYPASS",
		kind: "decision",
		title: "The defer-not-bypass rule",
		statement:
			'A new temporary YOLO bypass proposal must first check the defer-not-bypass rule: any new ACT must prove the substrate is insufficient against the production-equivalent composition, not just propose a workaround. The production-equivalent composition already collapses the load-bearing-quadrant ASKs from 15 → 3; most "approval friction" is environment-specific, not a general command-policy defect.',
		path: ".factory/epics/approval-protection.md",
		start_line: 61,
		end_line: 63,
	},
	{
		id: "DEC-CLINEMM-MCP-OWN-AUTHORITY-OWNER",
		kind: "decision",
		title: "The MCP auto-approval-off lane gets its own authority owner",
		statement:
			'Per the factory causal reviewer (2026-09-01): "Give it its own authority owner." The MCP auto-approval-off authority boundary therefore has its own epic record rather than being folded into the approval-protection epic. Priority is P0-if-reproduced — conditional on recon, not an asserted current confirmed P0.',
		path: ".factory/epics/approval-mcp-authority.md",
		start_line: 13,
		end_line: 17,
	},
	{
		id: "DEC-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT",
		kind: "decision",
		title:
			"Every model-controlled mutation must stay inside the per-tool authorized writable root",
		statement:
			"The CORRECTED invariant: every model-controlled mutation must remain inside the writable root(s) explicitly authorized for THAT tool invocation, NOT a global workspace root. Workspace-universal containment was WRONG / OVERBROAD and would misclassify legitimate global skill / rule / hook creation as escapes. The contract is: resolve the path lexically against the authoritative base; find and canonicalize the nearest existing ancestor; ensure that ancestor is within `authorized_root(tool)`; protect against symlink traversal/replacement; perform the mutation. Seatbelt is explicitly NOT in scope.",
		path: ".factory/epic-board.md",
		start_line: 9336,
		end_line: 9336,
	},
	{
		id: "DEC-CLINEMM-UPSTREAM-TRIAGE-DISPOSITIONS",
		kind: "decision",
		title: "The four upstream triage dispositions and the binding invariant",
		statement:
			"Four dispositions for triage: IMPORT (promote into a Cline-- epic/ACT), MAP_EXISTING (already covered by an existing Cline-- epic), RADAR (worth watching but not importing yet), REJECT (out of scope or value-not-worth-effort). Binding invariant (post-Correction-04): an upstream issue cannot be cited as evidence for a canonical epic whose failure contract it does not reproduce. The lexical-overlap remediation removed 48 false-mapping rows cumulatively (60 → 43 → 40 → 17 → 12).",
		path: ".factory/epics/upstream-intake.md",
		start_line: 21,
		end_line: 27,
	},
	{
		id: "DEC-CLINEMM-DISTRIBUTION-TWO-QUESTIONS",
		kind: "decision",
		title: "GitHub distribution is two distinct questions",
		statement:
			"(A) Publish a Cline-- distributable artifact to GitHub (likely primary artifact: VSIX via GitHub Release asset). (B) Determine whether any package genuinely belongs in GitHub Packages. The two must not be conflated. Artifact trust binding: SOURCE_HEAD, VERSION, PATH, BYTE_SIZE, SHA256, and (where relevant) installed version. Reproducibility rule: do not rebuild a supposedly identical release artifact after qualification unless reproducibility is separately proven.",
		path: ".factory/epics/distribution-ci.md",
		start_line: 14,
		end_line: 18,
	},
	{
		id: "DEC-CLINEMM-HOST-RUNNER-AUTHORITY",
		kind: "decision",
		title: "The host-test runner does not widen authority",
		statement:
			"The runner runs as the host user; the runner does not gain Seatbelt privileges the user does not have, and it does not use the runner as a covert YOLO bypass. Inputs are a declared corpus (commands + expected exit codes + optional timeouts), not arbitrary shell from the agent. Outputs are machine-readable with classified failures. Every invocation logs ACT ID, source HEAD, corpus path, runner version, host OS / kernel, start/end wall time and full result.",
		path: ".factory/epics/host-test-infrastructure.md",
		start_line: 14,
		end_line: 29,
	},
	{
		id: "DEC-CLINEMM-CLINE-NATIVE-BASELINE",
		kind: "decision",
		title: "The Cline-native edit path is the safety baseline",
		statement:
			"No new backend may widen filesystem authority, weaken approval semantics, or skip the existing audit trail. The Cline-native path remains the default unless the user explicitly opts in. Backends are pluggable, not fork-bound: each backend is identified by name + capability declaration; selection is explicit per-session or per-call, not implicit by environment. Conservative-first ordering: recon first, abstraction second, backend integration third, qualification fourth — do not collapse this sequence.",
		path: ".factory/epics/dynamic-editing-backends.md",
		start_line: 14,
		end_line: 21,
	},
	{
		id: "DEC-CLINEMM-TOOL-RUNTIME-SCOPE-BOUNDARY",
		kind: "decision",
		title:
			"Runtime correctness, task progression and telemetry classification are three separate questions",
		statement:
			'tool-runtime-reliability = "did an individual tool/command execute, return, time out, parse, route, retry, terminate correctly?"; runtime-task-progression = "after that event, did the overall agent/task make the correct state transition and continue?"; tool-execution-semantics = "telemetry classification of what the tool was (mechanism / outcome / duration / effect-class / purpose)". These three questions are separately answerable and must NOT be merged into a single epic. Per FACT-001, every working label remains a working label until the recon evidence lands; no speculative single-cause fix.',
		path: ".factory/epics/tool-runtime-reliability.md",
		start_line: 14,
		end_line: 51,
	},
	{
		id: "DEC-CLINEMM-AUTH-DEV-V1-SCOPE",
		kind: "decision",
		title: "The V1 sensitive-read confinement scope",
		statement:
			"The V1 sensitive-read confinement contract was deliberately scoped to SSH / GnuPG / macOS-keychain and EXCLUDED `~/.aws/`, `~/.kube/`, `~/.docker/config.json`, `~/.config/gh/hosts.yml`. The design ACT for the deferred family must propose how to handle the excluded surfaces without breaking the V1 boundary.",
		path: ".factory/epics/authenticated-dev-capabilities.md",
		start_line: 10,
		end_line: 10,
	},
	{
		id: "FIND-CLINEMM-WORKSPACE-IS-DATA-AUTHORITY-BOUNDARY",
		kind: "reusable_finding",
		title: "WORKSPACE_IS_DATA_AUTHORITY_BOUNDARY",
		statement:
			"`host_workspace_realpath_authority` IS the data-authority boundary, NOT a pre-Seatbelt convenience; `ALL` does NOT bypass it. The outside-read policy recon closed with `NOT_A_DEFECT_POLICY_EXPECTED` and the specimen `54T24A8CE5` = `CLOSED_EXPECTED`. This finding is reusable: it decides the R5 lane's data-boundary question without re-deriving it.",
		path: ".factory/epics/safe-yolo-seatbelt.md",
		start_line: 46,
		end_line: 46,
	},
	{
		id: "FIND-CLINEMM-NEXT-R5-TRIGGER",
		kind: "reusable_finding",
		title: "The NEXT_R5_TRIGGER predicate",
		statement:
			'The next genuine R5 defect must satisfy `mode=all + mandatorySeatbelt=true + all path-bearing operands INSIDE authorized workspace roots + no explicit deny / hard floor / missing evidence` BUT `finalDecision=ask AND approval UI published`. After `f56e87af0+` lands, dogfood should watch for "an unexpected prompt on a fully-authorized, all-inside request."',
		path: ".factory/epics/safe-yolo-seatbelt.md",
		start_line: 46,
		end_line: 46,
	},
	{
		id: "FIND-CLINEMM-BROAD-MUTATION-NOT-AUTHORIZED",
		kind: "reusable_finding",
		title: "BROAD_MUTATION != AUTHORIZED_MUTATION",
		statement:
			'A broad or selector-based destructive mutation must deterministically estimate/expand impact where safely possible, force an additional model intent-refinement turn, require an exact bounded target set + intended postcondition, re-evaluate normal policy from scratch, and execute only the precise replacement request. The refinement model is NOT an independent reviewer; the host remains authority. Anti-patterns: NO "Are you sure?" self-review; NO free-form "explain why this is safe" as sufficient proof; NO rm-specific regex-only architecture; NO automatic execution merely because the second model turn agrees.',
		path: ".factory/epics/approval-protection.md",
		start_line: 69,
		end_line: 87,
	},
	{
		id: "FIND-CLINEMM-CROSS-SCALE-RATIO-INVALID",
		kind: "reusable_finding",
		title: "Cross-scale ratio transfer is invalid for large working contexts",
		statement:
			"Cross-scale ratio transfer is invalid for working contexts large enough to engage buildForApi's truncation budgets. The discriminator reproduced a 66.6% relative divergence (manualRatio 0.000210 vs workingContextRatio 0.000629) on a realistic canonical case (assistant text > 200K cap), while the trivial canonical case (no truncation engaged) stayed GREEN as the positive control. The broken consumer seam applies a compactor H-space ratio to provider-input P-space tokensIn. The UI consumer math is internally consistent given the bad assumption.",
		path: ".factory/epics/context-compaction-token-accounting.md",
		start_line: 23,
		end_line: 112,
	},
	{
		id: "FIND-CLINEMM-RUNTIME-LATENT-NOT-LIVE-CAUSE",
		kind: "reusable_finding",
		title:
			"The two preserved latent defects are NOT the live cause of the runtime stall",
		statement:
			"`agent-runtime.ts:1371` IS a real latent defect under `requireCompletionTool=true`; the downstream AgentFinishReason collapse is a real latent defect; NEITHER is the live cause. The producer seam was exonerated for the live incident: the post-evidence discriminator capture bound the live `completionPolicy.requireCompletionTool = undefined` (mode=act, autoApprovalSettings.useBrowser=false ⇒ isYoloSessionRequested=false ⇒ enableSubmitAndExit=false ⇒ submit_and_exit NOT registered ⇒ completionPolicy=undefined), so 1371 fired under the non-defect configuration (= RUNTIME_INVOCATION_COMPLETION). The live defect re-routes to the host ownership-transition / awaiting_followup seam.",
		path: ".factory/epics/runtime-task-progression.md",
		start_line: 7,
		end_line: 7,
	},
	{
		id: "FIND-CLINEMM-TASK-CANCEL-INVARIANT",
		kind: "reusable_finding",
		title: "The Cancel-affordance invariant and its four-value discriminator",
		statement:
			'`turnState.phase === "streaming"` is the predicate and `SdkTaskControlCoordinator.cancelTask` is the SDK owner; upstream-vs-ClineMM Cancel button structure is byte-identical (no removal in either source). The LIVE discriminator is a four-value capture (`turnState.phase`, `foregroundCommandRunning`, `backgroundCommandRunning`, lastMessage.{type, say, ask, partial}), which separates `UI_RENDER_DEFECT` from `TURN_STATE_PROJECTION_DEFECT` from benign non-streaming phases. The invariant is already durable: idle+Cancel visible, or active+Cancel absent. Do not invent a third authority.',
		path: ".factory/epics/runtime-task-progression.md",
		start_line: 74,
		end_line: 74,
	},
	{
		id: "FIND-CLINEMM-PURPOSE-UNAVAILABLE-FROM-TRACE",
		kind: "reusable_finding",
		title: "Tool-execution semantic purpose is UNAVAILABLE_FROM_TRACE",
		statement:
			"Mechanism/outcome/duration are REAL; `purpose` is `UNAVAILABLE_FROM_TRACE` and must remain UNAVAILABLE in the projection. Do NOT infer semantic purpose from command/tool arguments — classify only from the canonical registered tool identity (`apply_patch` / native write tool → EDIT; `run_commands` / `execute_command` → COMMAND; native read/search → READ/SEARCH; `mcp_*` → MCP; structurally unknown → OTHER/UNKNOWN).",
		path: ".factory/epics/product-config-branding.md",
		start_line: 36,
		end_line: 36,
	},
	{
		id: "FIND-CLINEMM-COMMAND-RISK-TIERS",
		kind: "reusable_finding",
		title: "The V1/V2 command-risk framework and its HALT_SHIPPING posture",
		statement:
			"The bounded command-risk classifier shipped as a framework with a HALT_SHIPPING posture; the V2 parser-assisted framework is structurally complete and further rules/expansion is deferred pending a fresh ACT. The V2 READONLY-AND-COMPOSITION01 slice shipped as a bounded auto-approve for safe `&&` chains. The tier lattice and the hard-floor semantics are the reusable substrate for the command-policy lanes; the epic is represented as TERMINAL with its expansion deferred.",
		path: ".factory/epics/command-risk-classification.md",
		start_line: 12,
		end_line: 19,
	},
	{
		id: "FIND-CLINEMM-AOP-EXTENSION-CONTRACT",
		kind: "reusable_finding",
		title: "The webview AOP extension-point contract",
		statement:
			"The AOPC02 Phase A E1/E2/E3 discriminator and its real-SdkController producer discriminator established the extension-side AOP contract: deterministic behavioural authority lives at the extension seam, and the real producer correlation was proven at the SdkController publication seam. All sub-ACTs landed; the family is historical substrate.",
		path: ".factory/epics/webview-seam-aop.md",
		start_line: 12,
		end_line: 20,
	},
	{
		id: "FIND-CLINEMM-UPSTREAM-SNAPSHOT-CONTRACT",
		kind: "reusable_finding",
		title: "The upstream snapshot contract and size policy",
		statement:
			"Stored fields per issue: number, title, url, created_at, updated_at, comments, reactions, interactions, labels. EXCLUDED: body, comment bodies, reactions breakdown, avatar URLs, assignee objects, milestone description, user profile metadata, API payload copies. Deterministic ordering: interactions DESC, updated_at DESC, number DESC. Size policy: preferred ≤ 1 MiB; acceptable ≤ 2 MiB; truncation is NEVER silent — total_open_issue_count, committed_issue_count, truncated and selection_policy are always recorded.",
		path: ".factory/epics/upstream-intake.md",
		start_line: 14,
		end_line: 19,
	},
];

/** Compute the exact file-level delta between two revisions. */
function computeDelta(
	fromRev: string,
	toRev: string,
): Array<{ path: string; status: string; fromSha: string; toSha: string }> {
	const from = new Map<string, string>();
	const to = new Map<string, string>();
	for (const line of gitText(
		["ls-tree", "-r", "--format=%(objectname) %(path)", fromRev],
		REPO_ROOT,
	).split("\n")) {
		if (!line.trim()) {
			continue;
		}
		const [oid, ...rest] = line.trim().split(" ");
		from.set(rest.join(" "), oid ?? "");
	}
	for (const line of gitText(
		["ls-tree", "-r", "--format=%(objectname) %(path)", toRev],
		REPO_ROOT,
	).split("\n")) {
		if (!line.trim()) {
			continue;
		}
		const [oid, ...rest] = line.trim().split(" ");
		to.set(rest.join(" "), oid ?? "");
	}
	const paths = new Set([...from.keys(), ...to.keys()]);
	const delta: Array<{
		path: string;
		status: string;
		fromSha: string;
		toSha: string;
	}> = [];
	for (const path of [...paths].sort()) {
		const fromSha = from.get(path);
		const toSha = to.get(path);
		if (fromSha === toSha) {
			continue;
		}
		const status =
			fromSha === undefined
				? "added"
				: toSha === undefined
					? "removed"
					: "modified";
		delta.push({ path, status, fromSha: fromSha ?? "", toSha: toSha ?? "" });
	}
	return delta;
}

/**
 * One SECONDARY REPRESENTATION of an engineering obligation.
 *
 * The authoritative obligation is the one that carries the lifecycle; this
 * entry records the other representations of the SAME obligation, with the
 * epic that carried them and the source range that established them.
 */
interface SecondaryRepresentation {
	/** The scoped identity of the AUTHORITATIVE obligation. */
	readonly authoritative_obligation: string;
	/** The scoped identity of this SECONDARY representation. */
	readonly secondary_representation: string;
	/** The epic that carried the secondary representation. */
	readonly represented_in_epic: string;
	/** Why the source establishes shared ownership for this obligation. */
	readonly ownership_basis: string;
	/** The source ranges that establish the secondary representation. */
	readonly source_ranges: readonly {
		readonly path: string;
		readonly lines: readonly [number, number];
	}[];
}

/**
 * The secondary representations conserved out of the obligation collection.
 *
 * Each group is ONE engineering obligation. The authoritative obligation is
 * the one the source establishes as the owner; the secondary representations
 * are preserved here, source-referenced, and carry no lifecycle authority.
 */
const SECONDARY_REPRESENTATIONS: readonly SecondaryRepresentation[] = [
	{
		authoritative_obligation:
			"EPIC-CLINEMM-HOST-TEST-INFRASTRUCTURE/HOST-TEST-RUNNER",
		secondary_representation:
			"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/HOST-TEST-RUNNER",
		represented_in_epic: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT",
		ownership_basis:
			"safe-yolo-seatbelt.md Open work carries the row as " +
			"`HOST-TEST RUNNER` (row 18) with the status OPEN / HIGH and the full open-work description; host-test-infrastructure.md is the canonical detail file that gives the working label a durable detail file.",
		source_ranges: [
			{ path: ".factory/epics/safe-yolo-seatbelt.md", lines: [44, 44] },
		],
	},
	{
		authoritative_obligation:
			"EPIC-CLINEMM-HOST-TEST-INFRASTRUCTURE/HOST-TEST-RUNNER",
		secondary_representation:
			"EPIC-CLINEMM-APPROVAL-PROTECTION/HOST-TEST-RUNNER",
		represented_in_epic: "EPIC-CLINEMM-APPROVAL-PROTECTION",
		ownership_basis:
			"approval-protection.md Open work carries the row as row 18 and explicitly defers to safe-yolo-seatbelt.md: `See .factory/epics/safe-yolo-seatbelt.md for the full open-work description`.",
		source_ranges: [
			{ path: ".factory/epics/approval-protection.md", lines: [42, 42] },
		],
	},
	{
		authoritative_obligation:
			"EPIC-CLINEMM-APPROVAL-PROTECTION/CLASSIC-PROTECTION-RECON01",
		secondary_representation:
			"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/CLASSIC-PROTECTION-RECON01",
		represented_in_epic: "EPIC-CLINEMM-SAFE-YOLO-SEATBELT",
		ownership_basis:
			"safe-yolo-seatbelt.md Open work carries the same ACT with the same status, unblocking condition and first-deliverable description; the board's Current frontier lane `Approval / classic` names approval-protection.md as the Detail link, which is the authoritative placement.",
		source_ranges: [
			{ path: ".factory/epics/safe-yolo-seatbelt.md", lines: [45, 45] },
		],
	},
	{
		authoritative_obligation:
			"EPIC-CLINEMM-APPROVAL-PROTECTION/EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
		secondary_representation:
			"EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION/EDITOR-TOOL-APPROVAL-FRICTION-RECON01",
		represented_in_epic: "EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION",
		ownership_basis:
			"runtime-task-progression.md Open work names the same ACT as restored to NEXT with the same completion-authority prerequisite and the same remaining gates; the board's Current frontier lane `Approval / editor-tool` names approval-protection.md as the Detail link, which is the authoritative placement.",
		source_ranges: [
			{ path: ".factory/epics/runtime-task-progression.md", lines: [78, 78] },
		],
	},
	{
		authoritative_obligation:
			"EPIC-CLINEMM-SAFE-YOLO-SEATBELT/TEMP-INTERNAL-CONTROL-CLEANUP",
		secondary_representation:
			"EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/TEMP-INTERNAL-CONTROL-CLEANUP",
		represented_in_epic: "EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING",
		ownership_basis:
			"product-config-branding.md carries the row as the cross-cutting child and states the ownership explicitly: `The primary owner is safe-yolo-seatbelt.md (the env controls are owned by the seatbelt substrate)`.",
		source_ranges: [
			{ path: ".factory/epics/product-config-branding.md", lines: [93, 100] },
			{ path: ".factory/epics/product-config-branding.md", lines: [131, 140] },
		],
	},
];

/**
 * An assessment that was ONCE authoritative for a source identity and has
 * since been superseded by a corrected one.
 *
 * The FWMI v1 wire schema carries ONE authoritative reconciliation record per
 * reconciliation identity: the consumer derives the durable migration
 * identity from the record's kind, resolution and identities, and rejects two
 * distinct records that claim the same identity. A superseded assessment
 * therefore cannot remain a second reconciliation record for the same
 * identity — it is retained HERE, as source-bound supplemental migration
 * evidence, so the earlier reading of the source stays recoverable and
 * auditable without re-entering the machine-consumed wire package.
 */
interface SupersededAssessment {
	/** The source identity the assessment described. */
	readonly identity: string;
	/** The reconciliation kind the assessment carried. */
	readonly kind: string;
	/** The reconciliation resolution the assessment carried. */
	readonly resolution: string;
	/** What the superseded assessment claimed. */
	readonly superseded_claim: string;
	/** Why it was superseded, and by what. */
	readonly superseded_by: string;
	/** The source ranges the superseded assessment relied on. */
	readonly source_ranges: readonly {
		readonly path: string;
		readonly lines: readonly [number, number];
	}[];
}

/**
 * The assessments that were superseded by the corrected reconciliation.
 *
 * The board's historical ACT inventory was first reconciled as 177 ACT report
 * sections carrying 167 distinct identities. That inventory was INCOMPLETE: the
 * level-1-only header pattern skipped the trailing board region's 205
 * level-2 report sections, hiding 149 further historical ACT identities. The
 * corrected inventory indexes 361 report sections carrying 316 distinct
 * identities. The earlier assessment is retained here so the incomplete
 * reading stays recoverable.
 */
const SUPERSEDED_ASSESSMENTS: readonly SupersededAssessment[] = [
	{
		identity: ".factory/epic-board.md",
		kind: "INCOMPLETE_COVERAGE",
		resolution: "RESOLVED",
		superseded_claim:
			"The root epic board is 44,731 lines at SOURCE_HEAD and is a PREPEND-ORDERED historical ACT-report log: roughly the first 9,340 lines are narrative ACT reports and the operational index (Current frontier / Active epics / Open supporting work / Deferred-hold / Historical task census) occupies the region around lines 9352-9541. The operational index region was reconciled section-by-section into the frontier tables and the work-item records. The narrative report region was reconciled at the COLD level: 177 ACT report sections were mechanically indexed by identity, verdict and source range into `historical-index.json`, with 167 distinct identities, 7 carrying competing verdicts (CONFLICTING) and 1 carrying repeated identical verdicts (AMBIGUOUS). The remaining narrative prose (the `Updated:` chronology lines and per-ACT bodies) is accounted for as CONTIGUOUS NARRATIVE HISTORY at the byte level and is preserved verbatim through the committed source archive; it is deliberately NOT reconstructed paragraph-by-paragraph as new work items.",
		superseded_by:
			"INCOMPLETE AND SUPERSEDED. The 167-identity inventory did NOT cover the complete intended historical source. The level-1-only report-section header pattern matched the prepend-ordered report log and skipped every level-2 report section in the trailing board region 9,542-44,731, which carries 205 further report sections belonging to 149 distinct historical ACT identities. The corrected extraction indexes BOTH heading levels: 361 report sections carrying 316 distinct identities (289 UNAMBIGUOUS, 2 AMBIGUOUS, 25 CONFLICTING). The count was not tuned to preserve the earlier value. The corrected assessment is the single authoritative reconciliation record for this identity in `reconciliation.json`; this entry retains the obsolete reading as supplemental migration evidence only.",
		source_ranges: [
			{ path: ".factory/epic-board.md", lines: [1, 78] },
			{ path: ".factory/epic-board.md", lines: [9344, 9350] },
			{ path: ".factory/epic-board.md", lines: [9443, 9541] },
		],
	},
];

/** Write the supplemental artifacts. */
function main(): void {
	// ---- source-accounting.json -----------------------------------------
	const accounting = {
		schema_version: 1,
		kind: "FWL02_SUPPLEMENTAL_MIGRATION_EVIDENCE",
		note: "Supplemental migration evidence, NOT canonical ledger state and NOT a machine-consumed FWMI v1 input. It carries the per-section source accounting the FWMI v1 wire schema has no field for.",
		source_head: SOURCE_HEAD,
		first_shadow_migration_head: FIRST_SHADOW_HEAD,
		section_dispositions: SECTION_DISPOSITIONS.map((section) => ({
			path: section.path,
			start_line: section.start_line,
			end_line: section.end_line,
			dispositions: section.dispositions,
			note: section.note,
		})),
		/**
		 * The SECONDARY REPRESENTATIONS of one engineering obligation.
		 *
		 * The FWMI v1 wire schema carries ONE lifecycle-bearing work item per
		 * obligation. Where the source represents one obligation in several
		 * places, exactly one representation is authoritative and the others
		 * are retained HERE — with their source references and their owning
		 * epic — instead of becoming independent schedulable obligations.
		 *
		 * This is the accounting the wire schema has no field for: it is the
		 * record of WHERE a representation was dropped from the obligation
		 * collection, so no source representation is silently lost.
		 */
		secondary_representations: SECONDARY_REPRESENTATIONS.map((entry) => ({
			...entry,
		})),
		/**
		 * The assessments that were superseded by a corrected one.
		 *
		 * The wire schema carries ONE authoritative reconciliation record per
		 * reconciliation identity, so a superseded assessment cannot remain a
		 * second record for the same identity. It is retained here instead:
		 * the earlier reading of the source stays recoverable and auditable
		 * without re-entering the machine-consumed wire package.
		 */
		superseded_assessments: SUPERSEDED_ASSESSMENTS.map((entry) => ({
			...entry,
		})),
	};
	writeFileSync(
		join(PACKAGE_DIR, "source-accounting.json"),
		`${JSON.stringify(accounting, null, 2)}\n`,
		"utf8",
	);

	// ---- decisions-and-knowledge-index.json ------------------------------
	const knowledge = {
		schema_version: 1,
		kind: "FWL02_SUPPLEMENTAL_MIGRATION_EVIDENCE",
		note: "Supplemental migration evidence, NOT canonical ledger state. Decisions and reusable findings are not representable in the FWMI v1 wire schema; they are preserved here, source-bound, rather than discarded or forced into an invented wire field.",
		source_head: SOURCE_HEAD,
		decisions: DECISIONS_AND_FINDINGS.filter(
			(entry) => entry.kind === "decision",
		),
		reusable_findings: DECISIONS_AND_FINDINGS.filter(
			(entry) => entry.kind === "reusable_finding",
		),
	};
	writeFileSync(
		join(PACKAGE_DIR, "decisions-and-knowledge-index.json"),
		`${JSON.stringify(knowledge, null, 2)}\n`,
		"utf8",
	);

	// ---- source-delta.md -------------------------------------------------
	const delta = computeDelta(FIRST_SHADOW_HEAD, SOURCE_HEAD);
	const firstShadowBoard = readCommittedBytes(
		".factory/epic-board.md",
		FIRST_SHADOW_HEAD,
		REPO_ROOT,
	);
	const firstShadowLines = splitCommittedLines(firstShadowBoard).length;
	const currentBoard = readCommittedBytes(
		".factory/epic-board.md",
		SOURCE_HEAD,
		REPO_ROOT,
	);
	const currentLines = splitCommittedLines(currentBoard).length;
	const deltaMarkdown = [
		"# FWL02 — Source delta since the first shadow migration",
		"",
		"> Supplemental migration evidence. This is NOT a machine-consumed FWMI v1 input.",
		"",
		"## Repository identity",
		"",
		"| Field | Value |",
		"|---|---|",
		`| Entry head (this ACT's starting point) | \`${SOURCE_HEAD}\` |`,
		`| First shadow-migration source head | \`${FIRST_SHADOW_HEAD}\` |`,
		`| Source head of this package (FROZEN) | \`${SOURCE_HEAD}\` |`,
		"",
		"## Why the source head is frozen",
		"",
		"The package's source head is an EXPLICIT committed revision, not `HEAD`.",
		"The package's own publication commit advances `HEAD`; deriving the source head",
		"from `HEAD` at generation time would rebind every assertion to the publication",
		"commit itself and make the package non-reproducible and self-referential. The",
		"frozen head is the repository state the migration was reconciled FROM:",
		"`e196d0e6243f40ebfd76d2cf0db7bda74e97d6d6`.",
		"",
		"## Board size change",
		"",
		"| Measurement | First shadow migration | This package | Delta |",
		"|---|---:|---:|---:|",
		`| Root epic board lines | ${firstShadowLines} | ${currentLines} | ${currentLines - firstShadowLines} |`,
		`| Root epic board bytes | ${firstShadowBoard.length} | ${currentBoard.length} | ${currentBoard.length - firstShadowBoard.length} |`,
		"",
		"## Files changed between the two source heads",
		"",
		"| Path | Status | From blob | To blob |",
		"|---|---|---|---|",
		...delta.map(
			(entry) =>
				`| \`${entry.path}\` | ${entry.status} | \`${entry.fromSha.slice(0, 12)}\` | \`${entry.toSha.slice(0, 12)}\` |`,
		),
		"",
		"## What the delta contains",
		"",
		"The delta between the first shadow-migration source and this package's source head is",
		"exactly the three-commit experimental FWMI adapter episode and its supersession:",
		"",
		"1. `95234b6b6` — the experimental TypeScript FWMI adapter was implemented in ClineMM.",
		"2. `1d8a204df` — the adapter's evidence packet was bound to its final head.",
		"3. `e196d0e62` — the adapter was DISOWNED and removed. Ownership was clarified:",
		"   Leamas is the sole implementation owner of the ledger and its FWMI consumer;",
		"   ClineMM is the producer of the migration data.",
		"",
		"Two of the three commits touch the engineering-state documentation:",
		"",
		"- `.factory/epic-board.md` gains ONE row — the FWL02 producer-side row in the",
		'  board\'s "Open supporting work" table.',
		"- `.factory/epics/factory-infrastructure.md` gains the superseded-adapter ledger",
		'  row, a new "Ownership" section, and the FWL02 producer-side Open-work bullet.',
		"",
		"The third commit and the adapter evidence packet are NOT engineering-state",
		"documentation: they are the historical record of the superseded experiment. The",
		"migration preserves that record's disposition (the adapter is SUPERSEDED and is",
		"NOT an active capability) without treating its importer as a live capability.",
		"",
		"## Consequence for the migration",
		"",
		"Because the source head advanced, the board grew by one line and one byte-bound",
		"row relative to the first shadow migration. The migration binds every assertion to",
		"the CURRENT source head, so the FWL02 producer-side obligation is represented as a",
		"current work item rather than being absent. The first shadow migration's counts",
		"are NOT target values for this package; the recovered inventory is reported from",
		"the actual source.",
		"",
		"## The CORRECTION-02 correction of the reconciled inventory",
		"",
		"This package is the CORRECTED successor of the original FWL02 producer package.",
		"The correction changed the PRODUCER's reconciliation, not the source: the source",
		"head is unchanged at `e196d0e6243f40ebfd76d2cf0db7bda74e97d6d6`, and every",
		"assertion is still bound to the exact committed bytes it was derived from.",
		"",
		"Four bounded defects were corrected:",
		"",
		"1. **Wire compatibility.** The package emitted a `relationships` field that the",
		"   actual Leamas Go consumer does not have, omitted the nested `schema_version` on",
		"   every work item, historical record and reconciliation record, and used a",
		"   globally-scoped `item_id`. The consumer's strict decoder rejected all three.",
		"   All relationship kinds now live in the `dependencies` array, every nested record",
		"   carries `schema_version: 1`, and every item identity is local to its epic.",
		"2. **Prerequisite direction.** The architecture package emitted E8 DEPENDS_ON E9",
		"   alongside E9 DEPENDS_ON E8, a cycle that contradicted the recovered `E7 -> E8",
		"   -> E9 -> ELMIZATION02` ordering. The reversed edge is withdrawn; E7 remains an",
		"   explicit blocker on E8 and is not invented as an obligation.",
		"3. **One authoritative obligation per identity.** Four duplicate groups carried",
		"   independent lifecycle-bearing records. Each group now has exactly one",
		"   authoritative obligation; the secondary representations are conserved in the",
		"   reconciliation records and in `source-accounting.json`.",
		"4. **Historical source accounting.** The board's trailing region 9,542-44,731 was",
		"   assumed to be narrative history. It is not: it carries 205 further ACT report",
		"   sections at heading level 2, belonging to 149 distinct historical identities",
		"   the level-1-only extraction had skipped. The corrected extraction indexes 361",
		"   report sections carrying 316 distinct identities.",
		"",
		"The corrected inventory is therefore NOT the previous one: 45 obligations (not 50)",
		"and 316 historical identities (not 167). Neither count was tuned to reproduce a",
		"previous value; both are what the actual source yields under the corrected",
		"reconciliation.",
		"",
	].join("\n");
	writeFileSync(join(PACKAGE_DIR, "source-delta.md"), deltaMarkdown, "utf8");

	console.log(
		JSON.stringify(
			{
				sections: SECTION_DISPOSITIONS.length,
				decisions: knowledge.decisions.length,
				reusable_findings: knowledge.reusable_findings.length,
				delta_files: delta.length,
			},
			null,
			2,
		),
	);
}

main();
