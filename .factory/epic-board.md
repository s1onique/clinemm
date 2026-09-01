# ClineMM Epic Board

Updated: 2026-09-01 (P2_BOARD_READABILITY_MICROFIX + frontier correction per factory causal reviewer: add Approval/MCP and Context/compaction frontier rows; both have new ACT IDs that are NOT derivable from existing epic detail files, per reviewer directive to avoid corrupting TOOL-RUNTIME-RELIABILITY-RECON01 causal ownership)

Source-of-truth: `.factory/epics/*.md` (19 files) — the per-epic detail files. **This board is a navigation index, not an archive.**
Contract: [`.factory/epics/_index-contract.md`](./epics/_index-contract.md) (frozen maintenance law)
Conservation anchor: `5e96cfd3a` (immutable; see §5 of the contract for the `OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS = ∅` invariant)

This file is intentionally short. Every detailed row links to one epic file. Per the contract’s §6, `epic-board.md < 400 lines` (hard cap) with a target of 150–220.

---

## Current frontier

One `NEXT` per lane. Closed items are not `NEXT`. See [`.factory/epics/_index-contract.md`](./epics/_index-contract.md) §4 for the frontier-rule rationale.

| Lane | Pri | State | NEXT | Detail |
|---|--:|---|---|---|
| Approval / editor-tool | P1 | HOLD | `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / classic | P1 | `OPEN` | `CLASSIC-PROTECTION-RECON01` | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / Seatbelt-ALL LIVE failure | P1 | `OPEN` | `SEATBELT-ALL-WORKSPACE-REALPATH-*` | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / outside-read under ALL+Seatbelt | P1 | `OPEN` | `SEATBELT-ALL-OUTSIDE-READ-POLICY-*` | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / dogfood diagnostic profile | P1 | HOLD | (operator restart + V header truth) | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / runtime identity | P1 | `CLOSED_STRUCTURAL` | (none — `RUNTIME-IDENTITY-RECON01` lands) | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / Seatbelt SSH credential authority | P1 | `OPEN` | `SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01` | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Cost provenance | P1 | `HOLD` | `TASK-COST-TRUTH-RECON01` (TWO-LAYER recon) | [`task-presentation.md`](./epics/task-presentation.md) |
| Settings surface parity | P2 | `CLOSED_V2` | (none) | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Runtime progression | P1 | HOLD | `FRESH_POST_REPAIR_LIVE` (post-REPAIR01) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Task-start coordinator pre-existing REDs | P1 | `CLOSED` | (none) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Runtime finish semantics | P1 | `CLOSED` | (none) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Seatbelt network egress | P0 | `CLOSED` | (none) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| TaskHeader projection | P1 | `CLOSED` | (none) | [`task-presentation.md`](./epics/task-presentation.md) |
| Host substrate (host-test runner) | P0 | OPEN | `HOST-TEST RUNNER` (`HOST_REQUIRED`) | [`host-test-infrastructure.md`](./epics/host-test-infrastructure.md) |
| Build substrate / dogfood | P0 | `CLOSED` | (none) | [`factory-infrastructure.md`](./epics/factory-infrastructure.md) |
| Approval / MCP | P0 | OPEN | `MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01` (upstream #10499) | [`approval-mcp-authority.md`](./epics/approval-mcp-authority.md) |
| Context / compaction | P1 | OPEN | `COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` | [`context-compaction-token-accounting.md`](./epics/context-compaction-token-accounting.md) |

---

## Active epics

Every epic with `ACTIVE` family-level state (per contract §2 status vocabulary). Priority is orthogonal to status (contract §3). Detail files own the narrative.

| Epic | Pri | State | Frontier | Detail |
|---|--:|---|---|---|
| Safe-YOLO + Darwin Seatbelt | P0 | ACTIVE | `CLASSIC-PROTECTION-RECON01` + `HOST-TEST RUNNER` | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Approval protection | P1 | ACTIVE | `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` + `CLASSIC-PROTECTION-RECON01` | [`approval-protection.md`](./epics/approval-protection.md) |
| Command-risk classification | P1 | CLOSED | (none — fresh ACT to authorize expansion) | [`command-risk-classification.md`](./epics/command-risk-classification.md) |
| Quality substrate | P1 | ACTIVE | `CODE-COVERAGE-BASELINE01` + typecheck CI parity | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Task-presentation | P1 | ACTIVE | (none — substrate closed; awaiting fresh work) | [`task-presentation.md`](./epics/task-presentation.md) |
| Task-control liveness | P1 | CLOSED | (post-sharding review only) | [`task-control-liveness.md`](./epics/task-control-liveness.md) |
| Upstream intake | P2 | CLOSED | (triage cycle closed) | [`upstream-intake.md`](./epics/upstream-intake.md) |
| Distribution / CI | P2 | ACTIVE | `GITHUB-ACTIONS01` + `GITHUB-DISTRIBUTION01` | [`distribution-ci.md`](./epics/distribution-ci.md) |
| Extension publishing | P1 | OPEN | `VSCODE-MARKETPLACE-PUBLISH-RECON01` + `OPENVSX-PUBLISH-RECON01` | [`distribution-ci.md`](./epics/distribution-ci.md) |
| Product config / branding | P2 | ACTIVE | (see file for 2 open product frontings) | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Dynamic editing backends / Dirac | P1 | OPEN | `DIRAC-EDITING-RECON01` first | [`dynamic-editing-backends.md`](./epics/dynamic-editing-backends.md) |
| Host test infrastructure | P1 | OPEN | `HOST-TEST RUNNER` recon first | [`host-test-infrastructure.md`](./epics/host-test-infrastructure.md) |
| Tool runtime reliability | P1 | OPEN | `TOOL-RUNTIME-RELIABILITY-RECON01` | [`tool-runtime-reliability.md`](./epics/tool-runtime-reliability.md) |
| Architecture | P2 | ACTIVE | `ELMIZATION02` (gated on E9) | [`architecture.md`](./epics/architecture.md) |
| Factory infrastructure | P0 | ACTIVE | `GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01` (P2) | [`factory-infrastructure.md`](./epics/factory-infrastructure.md) |
| Upstream sync (structural merge) | P1 | CLOSED | (none) | (`.factory/acts/ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01.md`) |

---

## Open supporting work

Cross-cutting / substrate work that does not fit a single epic lane. Every row links to the owning epic.

| Work | Pri | State | Dependency | Detail |
|---|--:|---|---|---|
| Typecheck CI parity | P1 | OPEN | `GITHUB-ACTIONS01` | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Code-coverage baseline | P1 | OPEN | n/a | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Branding activity-bar icon | P2 | OPEN | n/a | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Tool-execution semantics | P2 | OPEN | n/a | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Terminal-report completion framing | P2 | CLOSED | n/a | [`task-presentation.md`](./epics/task-presentation.md) |
| `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` | P1 | OPEN | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` | P1 | OPEN | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-CLINEIGNORE-FILTERING01` | P2 | OPEN | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-PROVIDER-MODEL-DISCOVERY01` | P2 | OPEN | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |

---

## Deferred / hold

Consciously postponed or awaiting named prerequisites. Detail files carry the WHY.

| Item | State | NEXT | Detail |
|---|---|---|---|
| `BYPASS01` (temporary YOLO bypass) | DEFER | (only if `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` rediscovers it) | [`approval-protection.md`](./epics/approval-protection.md) |
| E8 — legacy writer retirement | HOLD | after E7 evidence + dependencies justify it | [`architecture.md`](./epics/architecture.md) |
| E9 — effect interpreter | HOLD | after E8 | [`architecture.md`](./epics/architecture.md) |
| Runtime-task-progression `CLOSED_LIVE` upgrade | DEFER | (only after a fresh live ClineMM recurrence) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Network-policy hardening / allowlisting | DEFER | (post-V1; see file) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Authenticated-dev credential capabilities | DEFER | (see file) | [`authenticated-dev-capabilities.md`](./epics/authenticated-dev-capabilities.md) |
| Single-R0 Seatbelt execution-obligation propagation | DEFER | (see file) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| R3/R4 task-control adversarial schedules | DEFER | (lane-hunting R3 / R4) | [`task-control-liveness.md`](./epics/task-control-liveness.md) |
| Temporary approval diagnostics removal cleanup | DEFER | (see file) | [`approval-protection.md`](./epics/approval-protection.md) |

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
ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01
ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
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

| Date | Lane | Verdict | Detail |
|---|---|---|---|
| 2026-09-01 | Approval / classic | CLOSED | [`approval-protection.md`](./epics/approval-protection.md) (correlation ACT `0bbf3c1d7`: CORRELATION_HYPOTHESIS_ELIMINATED at the correlation layer; product-level #10783 immunity NOT YET PROVEN) |
| 2026-09-01 | Runtime progression | CLOSED | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| 2026-08-31 | Approval / dogfood | CLOSED | [`approval-protection.md`](./epics/approval-protection.md) |
| 2026-08-31 | Seatbelt outside-read | CLOSED | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| 2026-08-31 | Upstream sync integration | CLOSED | (`.factory/acts/ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01.md`) |
| 2026-08-31 | Settings sandbox capabilities | CLOSED | [`product-config-branding.md`](./epics/product-config-branding.md) |
| 2026-08-31 | Approval specimen capture | CLOSED | [`approval-protection.md`](./epics/approval-protection.md) |
| 2026-08-31 | Upstream sync recon | CLOSED | (`.factory/acts/ACT-CLINEMM-UPSTREAM-SYNC-RECON01.md`) |
| 2026-08-31 | Seatbelt SSH credential authority | CLOSED | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| 2026-08-31 | Cost display truth | CLOSED | [`task-presentation.md`](./epics/task-presentation.md) |
| 2026-08-29 | Settings surface parity | CLOSED | [`product-config-branding.md`](./epics/product-config-branding.md) |
| earlier | Main consolidation | CLOSED | [`product-config-branding.md`](./epics/product-config-branding.md) |
| earlier | Safe-YOLO core safety substrate | CLOSED | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| earlier | YOLO approval-friction recon | CLOSED | [`approval-protection.md`](./epics/approval-protection.md) |
| earlier | Upstream-intake triage cycle | CLOSED | [`upstream-intake.md`](./epics/upstream-intake.md) |
| earlier | Webview-seam AOP | CLOSED | [`webview-seam-aop.md`](./epics/webview-seam-aop.md) |
| earlier | Closed foundation | CLOSED | [`closed-foundation.md`](./epics/closed-foundation.md) |

---

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
