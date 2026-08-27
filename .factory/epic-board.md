# ClineMM Epic Board

Updated: 2026-08-27
Source-of-truth: `.factory/epics/*.md` (19 files) — the per-epic detail files. **This board is a navigation index, not an archive.**
Contract: [`.factory/epics/_index-contract.md`](./epics/_index-contract.md) (frozen maintenance law)
Conservation anchor: `5e96cfd3a` (immutable; see §5 of the contract for the `OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS = ∅` invariant)

This file is intentionally short. Every detailed row links to one epic file. Per the contract's §6, `epic-board.md < 400 lines` (hard cap) with a target of 150–220.

---

## Current frontier

One `NEXT` per lane, named explicitly so the lanes do not collapse into a false single serial queue. See [`.factory/epics/_index-contract.md`](./epics/_index-contract.md) §4 for the frontier-rule rationale.

| Lane | Pri | Work | Detail |
|---|---|---|---|
| Approval / editor-tool | P1 | `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / classic | P1 | `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01` (unblocked post-`SEATBELT-DEFAULT-ON01`) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) · [`approval-protection.md`](./epics/approval-protection.md) |
| Host substrate | P0 | `HOST-TEST RUNNER` (host-only-behaviour dependency for both approval lanes; `HOST_REQUIRED` modifier per contract §2) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| TaskHeader projection | P1 | **CLOSED** (migration at `149fb131e` + THCP11 at `8a7e53742` already landed) | [`task-presentation.md`](./epics/task-presentation.md) |
| Runtime progression | P1 | `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` (RECON + live failure capture; secondary purpose = Cancel-affordance authority on the same ownership seam) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Cost provenance | P1 | `ACT-CLINEMM-TASK-COST-TRUTH-RECON01` (recon — binds TaskHeader `$X.YYYY` to authoritative per-request cost evidence; Bucket C = expected closing condition) | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Settings surface parity | P2 | `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` (recon — inventory + per-entry intent class; NO bespoke PTAD tab; NO wholesale upstream copy; owning epic decided by §11) | [`product-config-branding.md`](./epics/product-config-branding.md) (tentative; §11 of the ACT may move it to a new `EPIC-CLINEMM-SETTINGS-SUBSTRATE01`) |

---

## Active epics

Every epic with `ACTIVE` family-level state (per contract §2 status vocabulary). Priority is orthogonal to status (contract §3).

| Epic | Pri | State | Frontier | Detail |
|---|---|---|---|---|
| Safe-YOLO + Darwin Seatbelt | P0 | ACTIVE (core safety substrate CLOSED; 2 open post-substrate frontiers) | `CLASSIC-PROTECTION-RECON01` (also depends on the `HOST-TEST RUNNER` host-side runner; see Host test infrastructure row below) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Approval protection | P1 | ACTIVE (command-policy CLOSED; `BYPASS01` de-queued; editor-tool recon `NEXT`) | `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` · `CLASSIC-PROTECTION-RECON01` (both depend on the `HOST-TEST RUNNER` host-side runner; see Host test infrastructure row below) | [`approval-protection.md`](./epics/approval-protection.md) |
| Command-risk classification | P1 | CLOSED framework (V1 GREEN, V2 `HALT_SHIPPING`, V2-READONLY STRUCTURAL) | (none — fresh ACT to authorize further expansion) | [`command-risk-classification.md`](./epics/command-risk-classification.md) |
| Quality substrate | P1 | ACTIVE (vitest baseline + typecheck local-seam CLOSED; 2 OPEN acceptance conditions) | `CODE-COVERAGE-BASELINE01` · typecheck CI parity | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Task-presentation | P1 | ACTIVE framework (compacted-history substrate CLOSED; THCP01 CLOSED + THCP11 PASS + OAT01 CLOSED_NOT_REPRODUCED; `TERMINAL-REPORT-COMPLETION-FRAMING01` + `…-CORRECTION01` CLOSED; CURRENT OPEN WORK = none) | (none) | [`task-presentation.md`](./epics/task-presentation.md) |
| Task-control liveness | P1 | CLOSED family (bounded generation-fence repair landed; `LIVE` qualification pending) | (post-sharding review only) | [`task-control-liveness.md`](./epics/task-control-liveness.md) |
| Upstream intake | P2 | CLOSED family (substrate + 4-correction triage cycle landed; 12 EXACT_MAPs + 5 IMPORTs satisfy binding rule) | (triage cycle closed; new issues re-template through substrate) | [`upstream-intake.md`](./epics/upstream-intake.md) |
| Distribution / CI | P2 | ACTIVE (3 open items: GitHub Actions recon, GitHub Distribution, ACT — see file) | `EPIC-CLINEMM-GITHUB-ACTIONS01` · `EPIC-CLINEMM-GITHUB-DISTRIBUTION01` · … | [`distribution-ci.md`](./epics/distribution-ci.md) |
| Extension publishing | P1 | OPEN (`EXTENSION-PUBLISHING01` recon-first: VS Code Marketplace + Open VSX; see file) | `VSCODE-MARKETPLACE-PUBLISH-RECON01` · `OPENVSX-PUBLISH-RECON01` | [`distribution-ci.md`](./epics/distribution-ci.md) |
| Product config / branding | P2 | ACTIVE (cost + consolidation CLOSED; 2 open product fronts) | `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` · `EPIC-CLINEMM-BRANDING01` | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Dynamic editing backends / Dirac | P1 | OPEN (`DIRAC-EDITING-RECON01` first; all downstream BLOCKED on dependency chain) | `DIRAC-EDITING-RECON01` | [`dynamic-editing-backends.md`](./epics/dynamic-editing-backends.md) |
| Host test infrastructure | P1 | OPEN (`HOST-TEST RUNNER` recon first; unblocks real-kernel Seatbelt probes, fresh VSIX dogfood, live approval-UI capture, classic-protection qualification) | `HOST-TEST RUNNER` | [`host-test-infrastructure.md`](./epics/host-test-infrastructure.md) |
| Runtime task progression | P1 | ACTIVE / HIGH (the `Continue`-bug family; `RUNTIME_THINKING_STALL` cluster is RADAR). LIVENESS02 CLOSED; CONTRACT01 CLOSED YES/Option-C; IMPLEMENTATION01 NEXT. | `RUNTIME-TASK-PROGRESSION-RECON01` · `CANCEL-AFFORDANCE-AUTHORITY-RECON` · `COMPLETION-PROTOCOL-LIVENESS02` (CLOSED) · `SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01` (CLOSED) · `SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01` (NEXT) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Tool runtime reliability | P1 | OPEN / HIGH | `TOOL-RUNTIME-RELIABILITY-RECON01` | [`tool-runtime-reliability.md`](./epics/tool-runtime-reliability.md) |
| Architecture | P2 | ACTIVE (1 OPEN; 2 HOLD pending upstream evidence) | `EPIC-CLINEMM-ELMIZATION02` (gated on E9) | [`architecture.md`](./epics/architecture.md) |
| Factory infrastructure | P0 | ACTIVE (substrate-level rules; Git safety CLOSED) | `ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01` (P2 non-blocking) | [`factory-infrastructure.md`](./epics/factory-infrastructure.md) |
## Open supporting work

Cross-cutting / substrate work that does not fit a single epic lane. Every row links to the owning epic.

| Work | Pri | State | Dependency | Detail |
|---|---|---|---|---|
| Typecheck CI parity | P1 | OPEN (PARITY=PARTIAL — local gate only; CI workflow does not gate canonical `tsc`) | `EPIC-CLINEMM-GITHUB-ACTIONS01` | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Code-coverage baseline | P1 | OPEN / HIGH (ratchet ACT closed; baseline itself not yet set) | n/a | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Branding activity-bar icon | P2 | OPEN (first bounded slice of `BRANDING01`; `‖ → --`) | n/a | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Tool-execution semantics (umbrella) | P2 | OPEN — recon `PASS_RECON`; bounded implementation slice `TES-IMPL-01` is mechanism-only; `purpose` / `outcome` / `duration` / `effect` deferred (UNAVAILABLE_FROM_TRACE) | n/a | [`product-config-branding.md`](./epics/product-config-branding.md) · [`.factory/acts/ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01.md`](./acts/ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01.md) |
| Terminal-report completion framing | P2 | CLOSED v2 (CORRECTION01 merged: `isAuthoritativelyCompletedResult` marker stamped at `message-translator.ts:1640`; per-message identity survives phase flips. Two-tier authority: marker primary, legacy ask fallback secondary. Two-row + three-row discriminator tests pass at helper and component layers. M-killer "text says Completed but no marker" still fails closed) | n/a | [`task-presentation.md`](./epics/task-presentation.md) · ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 · ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01 |
| `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` | P1 | OPEN / HIGH (FINAL-CORRECTION upstream IMPORT; upstream #4388 + #12388) | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` | P1 | OPEN / HIGH (FINAL-CORRECTION upstream IMPORT; upstream #7413) | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-CLINEIGNORE-FILTERING01` | P2 | OPEN / MED (FINAL-CORRECTION upstream IMPORT; upstream #9554) | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-PROVIDER-MODEL-DISCOVERY01` | P2 | OPEN / MED (FINAL-CORRECTION upstream IMPORT; upstream #10016) | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |

---

## Deferred / hold

Items that are consciously not current execution debt. Reopen triggers are in the owning epic file.

| Work | State | Reopen trigger | Detail |
|---|---|---|---|
| `BYPASS01` (temporary YOLO bypass) | DEFER (de-queued) | Only if `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` confirms command-policy surface still has residual friction | [`approval-protection.md`](./epics/approval-protection.md) · [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| E8 — legacy writer retirement | HOLD | When E7 evidence and dependencies justify it. **No action in this board ACT.** | [`architecture.md`](./epics/architecture.md) |
| E9 — effect interpreter | HOLD | After E8. **No action in this board ACT.** | [`architecture.md`](./epics/architecture.md) |
| Runtime-task-progression `CLOSED_LIVE` upgrade | DEFER (optional) | When a live ClineMM extension host is available | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Network-policy hardening / allowlisting | DEFER | Post-V1 next slice (host:port allowlist rather than `network*:allow`); ship a fresh ACT, not a follow-on to the closed V1 contracts | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Authenticated-dev credential capabilities | DEFER | `~/.aws/`, `~/.kube/`, `~/.docker/config.json`, `~/.config/gh/hosts.yml` — host-side executor pattern, not raw credential bytes to the model. Design ACT first, per-family implementation ACTs after. | [`authenticated-dev-capabilities.md`](./epics/authenticated-dev-capabilities.md) |

---

## Historical task census

**Purpose: conservation only.** Every `ACT-CLINEMM-*` ID present in the immutable pre-sharding anchor `5e96cfd3a:.factory/epic-board.md` is listed here, grouped by family, so the contract's §5 invariant (`OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS = ∅`) holds. **This is an audit trail, not a status report** — state, priority, and evidence for each ACT live in the owning epic detail file (when sharded) or in `docs/closure-plans/*.json` (when externalized). The 19 detail files (alphabetical: `_index-contract`, `approval-protection`, `architecture`, `authenticated-dev-capabilities`, `closed-foundation`, `command-risk-classification`, `distribution-ci`, `dynamic-editing-backends`, `factory-infrastructure`, `host-test-infrastructure`, `product-config-branding`, `quality-substrate`, `runtime-task-progression`, `safe-yolo-seatbelt`, `task-control-liveness`, `task-presentation`, `tool-runtime-reliability`, `upstream-intake`, `webview-seam-aop`) are the canonical current state for the families they own.

The families below are mostly historical (pre-reduction). They are preserved here as ACT IDs only — no closure narrative, no embedded evidence.

```text
ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01
ACT-CLINEMM-ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01
ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01
ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION01
ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION03
ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION04
ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01
ACT-CLINEMM-CANONICAL-TASK-ACTIVITY-OWNERSHIP01
ACT-CLINEMM-CODE-COVERAGE-BASELINE01
ACT-CLINEMM-CODE-COVERAGE-REPORTER-KEY-CORRECTION01
ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01
ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01
ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01-CORRECTION01
ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01
ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01-CORRECTION01
ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01-CORRECTION01
ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
ACT-CLINEMM-FACTORIZE-F0B-BASELINE-RATCHET01
ACT-CLINEMM-FACTORIZE-F1-PACKAGE-DIRECTION01
ACT-CLINEMM-FACTORIZE-F2-COORDINATOR-TAXONOMY01
ACT-CLINEMM-FACTORIZE-F3-SHADOW-RETIREMENT01
ACT-CLINEMM-FACTORIZE-F4-SDKCONTROLLER-AUTHORITY01
ACT-CLINEMM-FACTORIZE-F5-FORK-DELTA01
ACT-CLINEMM-FACTORIZE-TOOLING01
ACT-CLINEMM-FACTORY-EPIC-BOARD-MARKDOWN-REPAIR01
ACT-CLINEMM-FACTORY-GLOBAL-TASK-CENSUS01
ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01
ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01-CORRECTION01
ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01-CORRECTION02
ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01-CORRECTION03
ACT-CLINEMM-GITHUB-ACTIONS01
ACT-CLINEMM-IN-PHASE-PUBLICATION-FAILURE-MASK-01
ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01
ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION01
ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION02
ACT-CLINEMM-LIVE-EPOCH-REPAIR-QUALIFICATION01
ACT-CLINEMM-LIVE-NEWTASK-DISTILLATION01
ACT-CLINEMM-NEWTASK-COMPACT-ROUTING-COHERENCE01
ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01
ACT-CLINEMM-PUBLISH-CURRENT-MAIN01
ACT-CLINEMM-RATCHET-BRIDGE-EXCLUSION-FIXUP01
ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01
ACT-CLINEMM-RESUME-SUBSCRIPTION-PARITY01
ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01
ACT-CLINEMM-SINGLE-WORKTREE-TRANSITION01
ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01
ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01-CLOSURE-FIX01
ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01-LIVE-QUALIFICATION01
ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01
ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-RUNTIME-SHADOW-REACTIVATION01
ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01
ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01
ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01
ACT-CLINEMM-TASKHEADER-LIVE-TIMER-ZERO-RESET01
ACT-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01
ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01
ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-SUBSTRATE01
ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01
```

Validator interpretation: the audit-trail block above is the canonical "where do the unsharded ACT IDs live" answer. If an ACT is listed both here and in an epic detail file, the detail file wins for current-state claims; the audit-trail block is the authoritative conservation record.

---

## Recently closed transitions

Short transition notes for closures that materially change the live state. Detailed closure claims live in `docs/closure-plans/*.json` and `.factory/evidence/<ACT>/`.

| Work | Verdict | Detail |
|---|---|---|
| Safe-YOLO core safety substrate | CLOSED (5 ACTs across workspace-write / network-open / sensitive-read / YOLO-mutation-confinement + `SEATBELT-DEFAULT-ON01`) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| YOLO approval-friction recon | CLOSED (`PASS_WITH_NONBLOCKING_RESIDUE C1: GO`; production-equivalent composition collapses load-bearing-quadrant ASKs 15 → 3; de-queued `BYPASS01`) | [`approval-protection.md`](./epics/approval-protection.md) |
| Upstream-intake triage cycle | CLOSED (12 surviving `EXACT_MAP`s + 5 `IMPORT`s satisfy the binding rule after 4 corrections) | [`upstream-intake.md`](./epics/upstream-intake.md) |
| Webview-seam AOP | CLOSED (all sub-ACTs landed; family is historical substrate) | [`webview-seam-aop.md`](./epics/webview-seam-aop.md) |
| Closed foundation (historical) | CLOSED (reference-only substrate; live work continues under siblings) | [`closed-foundation.md`](./epics/closed-foundation.md) |
| Main consolidation | CLOSED at `d844177bc` (canonical `main` carries the consolidated state) | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Cost display truth | CLOSED (`ACT-CLINEMM-COST-DISPLAY-TRUTH01` + 2 corrections — canonical cost source contract) | [`product-config-branding.md`](./epics/product-config-branding.md) |
## Maintenance contract

### Index ownership (per [`_index-contract.md`](./epics/_index-contract.md) §1)

```text
epic-board.md     → current navigation / state only
epics/*.md        → durable current conclusions + ACT ledgers + bounded historical context
closure-plans +
  evidence        → exact ACT contract + executable evidence
```

A summary may **narrow** evidence; it must **never strengthen** evidence. When evidence contradicts a row, evidence wins.

### Repository topology (compact)

```text
canonical repository:        ClineMM (this repo)
canonical branch:            main
development topology:        one Git worktree (linked worktrees forbidden by default)
protected evidence:          preserve explicitly named stashes / artifacts
historical architecture:     act/elm-architecture01-e0-e4 (merged, retained temporarily; P2 cleanup)
```

### Remote push safety (compact; full form in [`factory-infrastructure.md`](./epics/factory-infrastructure.md))

```text
NORMAL PUSH:    fast-forward only; requires explicit user / ACT authority; origin/main must be ancestor of local main
FORCE PUSH:     categorically FORBIDDEN — applies to main, feature/release branches, tags, humans, agents, CI
CORRECTION:     create new commits · revert · merge / rebase locally before publication · new branch / ref if needed
                — DO NOT rewrite already-published remote history
```

Enforcement epic: `EPIC-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH01` (ruleset `cline-- protect published history`, id=21037630).

### Board maintenance rule

Update **only rows affected by a meaningful ACT**. Do not rewrite the whole board. Each row should preferably contain: `ID`, `STATUS`, `PRIORITY`, `PURPOSE / SYMPTOM`, `DEPENDENCIES`, `NEXT ACT`, `EVIDENCE / COMMIT`. Avoid giant prose. If an item is closed, preserve enough identity to avoid re-litigation. If evidence contradicts a row, evidence wins; the row becomes P2 stale metadata.

### Task census rule

Every actionable task discussed for ClineMM has one canonical row in this board (or, since the 2026-08-27 reduction, in the per-epic detail files). Future planning authority is this board + per-epic detail files + source/Git/evidence. Routine project-thread archaeology is no longer required. When a new task is discussed, add the row at the next meaningful ACT boundary.

### Status vocabulary

Closed-class per [`_index-contract.md`](./epics/_index-contract.md) §2: `NEXT`, `OPEN`, `BLOCKED`, `HOLD`, `DEFER`, `CLOSED` (+ qualifiers), `SUPERSEDED`, `NEEDS_CLASSIFICATION`, `HOST_REQUIRED` (modifier), `ACTIVE` (family-level). See the contract for the exact meanings; the validator that follows this reduction will enforce the closed-class check.

### Size invariant

```text
epic-board.md  hard cap: < 400 lines     target: 150–220 lines
```

---

See [`_index-contract.md`](./epics/_index-contract.md) for the full maintenance law.
