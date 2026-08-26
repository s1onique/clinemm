# FACTORY INDEX CONTRACT

> This file freezes **how** `.factory/epic-board.md`, `.factory/epics/*.md`, and the evidence / closure-plan corpora relate to each other. It defines **rules** — not history. If a reader needs to know **what** an epic contains, follow the detail-file link; if they need to know **how this index is to be maintained**, they are in the right place.
>
> See `.factory/epic-board.md` for the active index and links to in-flight epics.

## 1. Authority hierarchy

There are three owners, each with a sharply bounded scope.

```text
.factory/epic-board.md
  owns:
    current priority
    current state
    current / next frontier
    detail-file link (one link per epic row)

.factory/epics/*.md
  own:
    durable current conclusions
    ACT ledger
    open / deferred work
    bounded historical context

docs/closure-plans/* + .factory/evidence/*
  own:
    exact ACT contract
    executable evidence
    exact closure claims
```

A summary may **narrow** evidence (e.g. summarize a 4-phase closure into "CLOSED, 4/4 GREEN") but must **never strengthen** evidence (e.g. claim `CLOSED_CLEAN` when the evidence only proves `CLOSED_WITH_RESIDUE`). When evidence contradicts a board row, **evidence wins**; the row becomes P2 stale metadata per the board-maintenance rule in `.factory/epics/factory-infrastructure.md`.

## 2. Status vocabulary

These tokens are **frozen** for use across `.factory/epic-board.md`, `.factory/epics/*.md`, closure plans, and the future validator. They are **closed-class** — adding a new token requires amending this file.

| Status | Meaning |
| --- | --- |
| `NEXT` | The immediate authorized frontier. The single ACT (or tightly-coupled cluster) a maintainer should pick up next. |
| `OPEN` | Valid unfinished work, but **not** the immediate frontier. Carries dependencies or sequencing constraints that defer it past `NEXT`. |
| `BLOCKED` | Executable only after a named prerequisite is satisfied. The blocker must be named in the same row. |
| `HOLD` | Intentionally inactive pending an explicit external condition or evidence (e.g. live-prompt capture, external merge). |
| `DEFER` | Consciously postponed. **Not** current execution debt; do not auto-promote without a fresh ACT. |
| `CLOSED` | Bounded contract completed. May carry qualifiers: `CLOSED_CLEAN`, `CLOSED_WITH_RESIDUE`, `CLOSED_NOT_REPRODUCED`, `CLOSED_RECON_SUPERSEDED`, `CLOSED_PASS`. Qualifiers never weaken the closure; they sharpen it. |
| `SUPERSEDED` | Retained historically; the successor ACT owns future work. The successor must be named. |
| `NEEDS_CLASSIFICATION` | Historical item preserved but the contract is unresolved. Carries a backlog obligation. |
| `HOST_REQUIRED` | Claim requires execution **outside** the current sandbox / substrate (e.g. real-kernel Seatbelt probe, live-prompt capture, unsandboxed-host dogfood). |
| `ACTIVE` | Epic / family has completed substrate plus unfinished current work. Usually contains one or more `NEXT`, `OPEN`, `BLOCKED`, or `HOLD` children. Used as a **family-level** state distinct from work-item scheduling state — see the dual-state note below. |

**HOST_REQUIRED rule.** A claim that asserts a real-kernel, real-prompt, or unsandboxed-host property **must** either:

```text
(1) be backed by host-runner / live evidence under .factory/evidence/<ACT>/, or
(2) explicitly carry the HOST_REQUIRED marker in the verdict.
```

No third option. The marker is not a status degradation — it is a **truth condition** for the claim. The `approval-protection.md` editor/tool recon (`PROMPT_OCCURS_BEFORE_OR_AFTER_TOOL_EXECUTION`) and the `safe-yolo-seatbelt.md` real-kernel Seatbelt probes (`describe.skipIf(!HAS_SUBSTRATE)(...)`) both rely on this rule.

**`HOST_REQUIRED` is a qualification modifier, not a mutually-exclusive status.** It may accompany any of the work-item scheduling states. The validator MUST recognize composite forms such as `OPEN / HOST_REQUIRED` and `CLOSED / HOST_REQUIRED` (the latter denoting a closure whose qualification is bounded to a host-required environment — e.g. a kernel-mode Seatbelt probe whose closure is partial without an unsandboxed-host run). It is **not** a third axis of the closed-class status set.

**Two-axis model (V1).** For practical purposes this contract recognizes two distinct, non-exclusive state axes:

```text
Family-level state:    ACTIVE | CLOSED | SUPERSEDED | …
Work-item scheduling:  NEXT | OPEN | BLOCKED | HOLD | DEFER | CLOSED (+ qualifiers) | …
HOST_REQUIRED:         qualification modifier (may accompany any work-item scheduling state)
```

V1 keeps the family-level and work-item axes in one closed-class table for tooling simplicity, but the semantic distinction is acknowledged here so a future V2 may split them without breaking the contract's intent.

## 3. Priority semantics

Priority is **orthogonal** to status. A `NEXT` item may be any priority; a `CLOSED` item may have been P0 or P2. Conflating them — e.g. asserting "P1 == NEXT" — is a category error.

```text
P0 = correctness / evidence / safety blocker
P1 = high-value bounded implementation or substrate work
P2 = documentary / product / hygiene / deferred correctness residue
```

A `P2` ACT that introduces a safety defect still has the defect; priority describes **resource allocation**, not **correctness**. Status describes **state**.

## 4. Frontier rules

The short board has **one clearly identifiable immediate frontier** per priority lane. If several independent lanes genuinely have `NEXT` work, the lane is named explicitly rather than collapsing them into a single serial queue.

```text
NEXT (single):       EDITOR-TOOL-APPROVAL-FRICTION-RECON01   (approval / editor-tool lane)

OPEN adjacent:
  HOST-TEST RUNNER                                (host-test runner lane, host-only-behaviour dependency)
  CLASSIC-PROTECTION-RECON01                      (approval / classic lane, unblocked post-SEATBELT-DEFAULT-ON01)
```

The board must show dependencies visibly. A `NEXT` row whose prerequisites are `OPEN` must link to them.

## 5. Conservation rules

These rules govern migration integrity. The migration source head is **frozen** — never rebase this anchor.

```text
MIGRATION_SOURCE_HEAD = 5e96cfd3a

required:
  OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS = ∅
    (the union of ACT-CLINEMM-* IDs present in MIGRATION_SOURCE_HEAD:.factory/epic-board.md
     must be a subset of the ACT-CLINEMM-* IDs present in the current repository, across
     board + epics/*.md + docs/closure-plans/*.json + .factory/evidence/<ACT>/filenames)

not required:
  CURRENT_REPOSITORY_ACT_IDS - OLD_ACT_IDS = ∅
    (new ACTs may legitimately appear; e.g. the +7 IDs currently in
    docs/closure-plans/*.json that were externalized from the closure-plan JSONs
    after the pre-sharding anchor)
```

The current `+7` IDs are legitimate:

```text
ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION02
ACT-CLINEMM-LEAMAS-CLOSURE-PROTOCOL-V1-FULL-CLOSURE-CANARY02
ACT-CLINEMM-LEAMAS-V2-CURRENT-TIP-CLOSURE-CANARY01
ACT-CLINEMM-MAIN-INTEGRATION-AND-CLOSURE-PROTOCOL-V1-DOGFOOD01
ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01-CORRECTION02
ACT-CLINEMM-TOOL-PROTOCOL-BOUNDED-RECOVERY01
ACT-CLINEMM-TOOL-PROTOCOL-BOUNDED-RECOVERY01-CORRECTION01
```

(These were externalized into `docs/closure-plans/*.json` after the `5e96cfd3a` anchor was frozen; the anchor is left as-is on purpose. Any future migration source head must be a strict superset of `5e96cfd3a`, never a rebase.)

A summary that introduces an ACT ID **not** present in any of `OLD_ACT_IDS ∪ CURRENT_REPOSITORY_ACT_IDS` is a **fabrication** and must be removed. (This rule is the reason `.factory/epics/safe-yolo-seatbelt.md` and `.factory/epics/approval-protection.md` defer ACT-ID claims to canonical sources and link evidence directories rather than naming their ACT IDs in prose.)

## 6. Human-readability rules

The short board is a navigation artifact. It is **not** an archive.

```text
hard cap:    epic-board.md < 400 lines
target:      150–220 lines
no verbatim ACT closure reports
no giant prose table cells
no embedded evidence artifacts (link instead)
no historical narrative longer than a short transition note
no BOARD_WAVE prose (this is the old wave-summary convention; do not reintroduce)
```

The migration's reason for being is **readability of the current state at a glance**. Every line that does not serve that purpose is debt.

## 7. Link rules

Use **relative repository links** for all intra-repository Markdown targets. They survive branches, forks, and local clones; absolute URLs do not.

```text
good:   .factory/evidence/<ACT>/
        docs/closure-plans/<ACT>.json
        .factory/epics/<epic>.md
bad:    https://github.com/<org>/<repo>/blob/<sha>/.factory/...
```

Validator later checks actual filesystem resolution against these relative targets.

## What this contract does NOT own

To prevent this file from becoming `epic-board-v2.md` under a different name:

```text
no old BOARD_WAVE prose
no closure summaries
no ACT evidence (link to closure plan / evidence dir instead)
no historical SHA narration
no large deferred inventories already owned by an epic
no verbatim migration history
```

When in doubt: **rules belong here, content belongs in the detail files, exact claims belong in the closure plans.**

---

See `.factory/epic-board.md` for the live index.
