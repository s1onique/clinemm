# EPIC-APPROVAL-PROTECTION

> Approval-protection surface across **command** (V1/V2 risk classification) + **editor / non-command tool** (YOLO confirmation UI, MCP tool auto-approval) + **classic** (non-Seatbelt path-authority when Seatbelt is OFF) approval decisions. This file is the human-readable owner of:
>
> ```text
> command approval
> editor / tool approval
> classic protection
> temporary bypass decisions
> ```
>
> See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: ACTIVE — **command-policy recon CLOSED** + **YOLO approval-bypass DEFER (de-queued)** + **editor/tool approval-friction recon NEXT** + **classic-protection recon OPEN** + **`HOST-TEST RUNNER` OPEN** as the host-only-behaviour dependency for both classic-protection and editor/tool recon qualifications.
- Priority: P1 (substrate for the Safe-YOLO + seatbelt-confined approval surface)
- Current frontier: 2 OPEN items (`HOST-TEST RUNNER` row 18, `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01` row 22) + 1 NEXT (`ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` row 19). See "Open work" below.
- Blocked by: n/a for command-policy / YOLO-residual surface (CLOSED). Classic-protection recon was unblocked by `SEATBELT-DEFAULT-ON01` closure (now satisfied per `.factory/epics/safe-yolo-seatbelt.md`).

## Contract / durable conclusions

- **Command policy itself does NOT justify a YOLO bypass.** Per board row 17 (PASS_WITH_NONBLOCKING_RESIDUE C1: GO, `ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01` + CORRECTION02 applied): the production-equivalent composition (real `buildPathAuthorityEvidence` + real `realpathSync(workspace)`) collapses the load-bearing-quadrant ASK count from **15 → 3**. The 3 environment-specific `.factory` realpath failures (`realpath-failed-enoent` under the IDE sandboxed authoring shell; not exercised on an unsandboxed normal host) are **environment-specific, not a general command-policy defect**. This is what de-queued `BYPASS01` (row 20): defer-not-bypass.
- **Production-equivalent-path evidence collapses the synthetic ASK set.** The recon's production-equivalent composition is the canonical test surface for any future "command policy is too noisy" claim. A fresh ACT must prove the substrate is insufficient against this composition, not just propose a workaround. Synthetic-ASK or pure-test-environment compositions are insufficient evidence.
- **Actual observed friction moved to the non-command / editor-tool surface.** Per row 19 (NEXT): the live YOLO confirmation UI for non-command tools is the natural next ACT. The recon must capture **TOOL_NAME / TOOL_INPUT_KIND / YOLO_EFFECTIVE / SEATBELT_EFFECTIVE / UI_PROMPT_TYPE / PROMPT_OCCURS_BEFORE_OR_AFTER_TOOL_EXECUTION** (the last is critical — upstream #13114 says the prompt occurs AFTER file creation, which is a UI-projection / completion-seam defect, not an approval-ordering defect).
- **Classic (non-Seatbelt) approval protection recon is the next-frontier after Safe-YOLO is fully closed.** Per row 22 (OPEN): `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01`. Unblocked now that `SEATBELT-DEFAULT-ON01` has closed (see `.factory/epics/safe-yolo-seatbelt.md`). Likely shape: observe whether the Seatbelt-confined `$HOME` / network / secret boundaries are also enforced when Seatbelt is OFF, where the host's path-authority / command-policy surface takes over.
- **Editor/tool approval friction recon is gated on `HOST-TEST RUNNER`.** Per row 18 (OPEN): the Safe-YOLO substrate probes proved RED-on-kernel, GREEN-on-kernel, byte-equality across canonical / override=all via `describe.skipIf(!HAS_SUBSTRATE)(...)` (Vitest runtime skip). The editor/tool recon needs a similar real-prompt-capture capability to characterize `PROMPT_OCCURS_BEFORE_OR_AFTER_TOOL_EXECUTION` reliably on a live prompt — `HOST-TEST RUNNER` is the natural dependency. Per `.factory/epics/_index-contract.md` status vocabulary, any ACT that asserts a real-prompt / real-kernel approval property must include a `host_test_runner` artifact or explicitly mark `HOST_REQUIRED`.

## ACT ledger

| ACT / Source ID | Verdict | Board row | Canonical evidence | Purpose |
|---|---|---|---|---|
| Command-risk classification family (V1 bounded + V2 parser-assisted + V2-READONLY-AND-COMPOSITION01) — see [`command-risk-classification.md`](./command-risk-classification.md) | CLOSED (V1 GREEN, V2 framework HALT_SHIPPING, V2-READONLY STRUCTURAL) | (umbrella ACTs) | [`.factory/evidence/ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01/`, `ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01-CORRECTION01/`, `ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-ASSISTED01/`, `ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01/`](../evidence/) | Command-risk classification framework (the substrate for the command approval surface) |
| `ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01` (+ CORRECTION01, + CORRECTION02) | CLOSED (PASS_WITH_NONBLOCKING_RESIDUE C1: GO) | row 17, ~L6346 | [`docs/closure-plans/ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01.json`](../../docs/closure-plans/ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01.json), [`.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/`](../evidence/act-seatbelt-yolo-approval-friction-recon01/) | YOLO approval friction recon — collapsed load-bearing-quadrant ASKs 15 → 3 via production-equivalent composition |
| `BYPASS01` (de-queued) | DEFER | row 20 | (de-queued per row 17 CORRECTION02) | Temporary YOLO bypass; no longer indicated (residual is environment-specific) |
| `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` | **NEXT / HIGH** (recon §2 complete; live specimen §3 deferred behind IMPLEMENTATION01 dogfood) | row 19 | [`.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/source-seam-map.md`](../evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/source-seam-map.md) (Phase 1/2 frozen at HEAD `f8dca1fda` / TREE `6f2e01b56`; verdict `PASS_RECON_SEAM_MAPPED`) | Editor / non-command tool approval friction recon — §2 source-seam map captured (T0..T9 traced; `buildToolPolicies` forces `autoApprove:false` for edit tools → `shouldAutoApproveTool` is the only ALLOW gate → `isToolAutoApproved` reads `effective.actions.editFiles`); live-prompt capture (§3), discriminator (§4), RED (§6), ablation (§7), and bounded repair (§8) deferred behind predecessor `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01` dogfood |
| `HOST-TEST RUNNER` | **OPEN / HIGH** (host-only-behaviour dependency for the editor/tool recon and for classic-protection host qualification) | row 18 | (none yet — to be authored; see `.factory/epics/safe-yolo-seatbelt.md`) | Host-orchestrated end-to-end approval dogfood; the natural next layer above the substrate probes |
| `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01` | **OPEN / HIGH** (next-frontier after Safe-YOLO is fully closed) | row 22 | (none yet — to be authored) | Classic (non-Seatbelt) approval protection recon — observe whether Seatbelt-confined boundaries are also enforced when Seatbelt is OFF |
| (deferred) progressive approval classification | **OPEN / P1→P2** | — | (none — this row is the durable backlog entry; per-family classification ACTs are to be authored) | Progressively classify every residual approval family so any broad escape hatch (`BYPASS01`-style) becomes unnecessary. Per the SEATBELT-YOLO-APPROVAL-FRICTION-RECON01 CORRECTION02 verdict, the residual is environment-specific, not a general command-policy defect — but the *family-by-family* classification work continues so a future reader does not have to re-litigate why each family is on the path-authority / command-policy surface. |

## Open work

Two OPEN items + one NEXT:

- **`HOST-TEST RUNNER`** (row 18, OPEN / HIGH). Status: host-only-behaviour dependency for the editor/tool recon (`ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` Phase 0 / 1 / 2) and for classic-protection host qualification. Author as a new ACT (the row 18 working label `HOST-TEST RUNNER` is the working name; the ACT ID is assigned at ACT creation per FACT-001 naming doctrine in `.factory/epics/factory-infrastructure.md`); do NOT roll the runner into an existing closed ACT (would invalidate closure evidence). See `.factory/epics/safe-yolo-seatbelt.md` for the full open-work description.
- **`ACT-CLINEMM-CLASSIC-PROTECTION-RECON01`** (row 22, OPEN / HIGH). Status: classic (non-Seatbelt) approval protection recon — the next-frontier after Safe-YOLO is fully closed. Unblocked by `SEATBELT-DEFAULT-ON01` closure (now satisfied). Likely first deliverable: characterize the path-authority / command-policy / network-read surfaces that take over when Seatbelt is OFF, and compare them to the Seatbelt-confined boundaries to identify any drift. See `.factory/epics/safe-yolo-seatbelt.md` for the related NEXT pointer.
- **`ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01`** (row 19, NEXT / HIGH). Status: replaces the de-queued `BYPASS01` slot. Phase 0 captures one live YOLO confirmation UI and freezes `TOOL_NAME / TOOL_INPUT_KIND / YOLO_EFFECTIVE / SEATBELT_EFFECTIVE / UI_PROMPT_TYPE / PROMPT_OCCURS_BEFORE_OR_AFTER_TOOL_EXECUTION`. Phase 1 traces the `SdkController` non-command tool approval callback at `SdkController.ts:799..818` (`shouldAutoApproveTool` reads `autoApprovalSettings.actions.editFiles` / `.editFilesExternally` / MCP per-tool flags + session override) and freezes `TOOL_POLICY_SOURCE / SESSION_OVERRIDE_SOURCE / AUTO_APPROVAL_SETTINGS_SOURCE / REQUEST_TOOL_APPROVAL_CALLBACK / FINAL_UI_PROMPT_SEAM`. Phase 2: exact RED with YOLO+Seatbelt on the live-prompt tool; possible outcomes — `callback=ASK` → policy defect, `callback=ALLOW` + UI still prompts → completion/UI seam defect (most likely per upstream #13114), callback never reached → seam moved. Per upstream SDK docs: tool auto-approval is a **separate** surface from command policy.

Reopen / new-work conditions:

- A new command-risk classifier ACT lands (V1.x or V2.x correction) — append to `command-risk-classification.md` ledger row; defer here.
- A new approval-friction recon lands (a future editor/tool ACT, or a future classic-protection ACT) — append to this file's ACT ledger row.
- A new temporary YOLO bypass proposal is raised — first check the **`defer-not-bypass`** rule: any new ACT must prove the substrate is insufficient against the production-equivalent composition (row 17 CORRECTION02), not just propose a workaround. The production-equivalent composition already collapses the load-bearing-quadrant ASKs from 15 → 3; most "approval friction" is environment-specific, not a general command-policy defect.
- A new classic (non-Seatbelt) approval protection recon ACT lands — append to this file's ACT ledger row.
- A new host-only-behaviour dependency (e.g. a new `HOST-TEST RUNNER` artifact, or a future ACT that depends on it) lands — append to this file's ACT ledger row.
