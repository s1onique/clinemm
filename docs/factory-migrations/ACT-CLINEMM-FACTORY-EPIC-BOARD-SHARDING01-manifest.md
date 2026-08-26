# Migration Manifest — ACT-CLINEMM-FACTORY-EPIC-BOARD-SHARDING01

Source: `.factory/epic-board.md` (6,346 lines, 1.1 MB, 37 `## ` sections, 192 ACT-CLINEMM-* IDs, 15 epic/family IDs).

Goal: Losslessly extract historical/detail blocks into `.factory/epics/*.md`, then reduce `epic-board.md` to a 100–250-line index (hard cap 400). The validator (commit 4 of this ACT) takes the immutable pre-sharding commit `5e96cfd3a` as its left-hand authority and asserts `OLD_ACT_IDS - NEW_ACT_IDS = ∅` (plus the related invariants listed under [Acceptance gate](#acceptance-gate-commit-4-validator-must-report-all-pass)).

## ID inventory

| Class | Count | Source |
|---|---|---|
| `ACT-CLINEMM-*` unique IDs in board | 192 | `grep -oE "ACT-CLINEMM-[A-Z0-9-]+" .factory/epic-board.md \| sort -u` |
| `AOPC0X` / `AOC0X` / `LIVE-CAPTURE0X` family IDs | 15 | same |
| Already-external closure plans in `docs/closure-plans/` | 9 | `ls docs/closure-plans/` |

Raw ID lists are **not** committed under this directory. They live only as ephemeral build artifacts under `.factory-staging-sharding01/inventory/` (gitignored via the `.factory-staging-*` pattern in `.gitignore`). The validator uses the immutable pre-sharding commit `5e96cfd3a` as its left-hand authority instead, see `OLD_ACT_IDS` / `NEW_ACT_IDS` under [Acceptance gate](#acceptance-gate-commit-4-validator-must-report-all-pass) below.


## Mapping — current board sections → destination epic files

Sections are numbered 1..37 matching `grep -nE '^## ' .factory/epic-board.md`. Every section is accounted for.

| # | Source section (current board) | Lines | Destination file | Migration kind |
|---|---|---|---|---|
| 1 | `## Board contract` (L10-19) | 10 | `.factory/epics/_index-contract.md` | SUMMARIZED_INDEX |
| 2 | `## Repository topology` (L20-86) | 67 | `.factory/epics/_index-contract.md` | SUMMARIZED_INDEX |
| 3 | `## Git safety` (L87-163) | 77 | `.factory/epics/factory-infrastructure.md` | VERBATIM |
| 4 | `## Canonical task index` (L164-318) | 155 | `.factory/epics/_index-contract.md` | SUMMARIZED_INDEX |
| 5 | `## Closed foundation` (L319-381) | 63 | `.factory/epics/closed-foundation.md` | VERBATIM |
| 6 | `## Immediate critical path` (L382-487) | 106 | `.factory/epics/_index-contract.md` | SUMMARIZED_INDEX |
| 7 | AOPC02 Phase A (L488-625) | 138 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 8 | AOPC02 PHASE-A-CORRECTION01 (L626-898) | 273 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 9 | AOPC02 PHASE-A-CORRECTION02 (L899-1176) | 278 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 10 | AOPC02 PHASE-A-CORRECTION03 (L1177-1471) | 295 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 11 | AOPC02 PHASE B (L1472-1600) | 129 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 12 | AOPC02 PHASE B REPAIR01-CORRECTION01 (L1601-1868) | 268 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 13 | AOPC02 PHASE B REPAIR01-CORRECTION01 GATE FIXUP (L1869-2056) | 188 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 14 | AOC01 (L2057-2247) | 191 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 15 | AOC02 (L2248-2865) | 618 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 16 | LIVE-CAPTURE01 (L2866-3097) | 232 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 17 | RESULT01 (L3098-3201) | 104 | `.factory/epics/webview-seam-aop.md` | VERBATIM |
| 18 | `## Context / compaction` (L3202-3336) | 135 | `.factory/epics/task-presentation.md` | VERBATIM |
| 19 | `## Task state / presentation` (L3337-3377) | 41 | `.factory/epics/task-presentation.md` | VERBATIM |
| 20 | `## Product telemetry` (L3378-3574) | 197 | `.factory/epics/product-config-branding.md` | VERBATIM |
| 21 | `## Product configuration / branding` (L3575-3606) | 32 | `.factory/epics/product-config-branding.md` | VERBATIM |
| 22 | `## Architecture` (L3607-3643) | 37 | `.factory/epics/architecture.md` | VERBATIM |
| 23 | `## Quality substrate` (L3644-3848) | 205 | `.factory/epics/quality-substrate.md` | VERBATIM |
| 24 | `## Factorize doctrine` (L3849-3895) | 47 | `.factory/epics/factory-infrastructure.md` | VERBATIM |
| 25 | `## Upstream intake` (L3896-4094) | 199 | `.factory/epics/upstream-intake.md` | VERBATIM |
| 26 | `## Distribution / CI` (L4095-4141) | 47 | `.factory/epics/distribution-ci.md` | VERBATIM |
| 27 | `## P2 / deferred residue` (L4142-4154) | 13 | `.factory/epics/_index-contract.md` | SUMMARIZED_INDEX |
| 28 | `## Historical aliases / superseded IDs` (L4155-4205) | 51 | `.factory/epics/_index-contract.md` | VERBATIM |
| 29 | `## Deferred (post-census)` (L4206-4226) | 21 | `.factory/epics/_index-contract.md` | SUMMARIZED_INDEX |
| 30 | TASK-CONTROL-LIVENESS01 / FIX01 (L4227-4385) | 159 | `.factory/epics/task-control-liveness.md` | VERBATIM |
| 31 | QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 (L4386-4503) | 118 | `.factory/epics/task-control-liveness.md` | VERBATIM |
| 32 | `## ACT closure — STOP THIS BUG FAMILY` (L4504-4544) | 41 | `.factory/epics/task-control-liveness.md` | VERBATIM |
| 33 | `## Board maintenance rule` (L4545-4554) | 10 | `.factory/epics/factory-infrastructure.md` | VERBATIM |
| 34 | V1 bounded command-risk classifier (L4555-4621) | 67 | `.factory/epics/command-risk-classification.md` | VERBATIM |
| 35 | V1 CORRECTION01 VSCode host parity (L4622-4698) | 77 | `.factory/epics/command-risk-classification.md` | VERBATIM |
| 36 | V2 parser-assisted (L4699-5967) | 1269 | `.factory/epics/command-risk-classification.md` | VERBATIM |
| 37 | V2 READONLY-AND-COMPOSITION01 (L5968-6346) | 379 | `.factory/epics/command-risk-classification.md` | VERBATIM |

Total: 6,346 lines mapped (subject to drift in section boundaries; the validator re-checks line accounting during commit 4).

## Already-external closure plans (link-only, not duplicated)

| # | ACT | Path |
|---|---|---|
| C1 | ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01 | docs/closure-plans/ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01.json |
| C2 | ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01 | docs/closure-plans/ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01.json |
| C3 | ACT-CLINEMM-LEAMAS-CLOSURE-PROTOCOL-V1-FULL-CLOSURE-CANARY02 | docs/closure-plans/ACT-CLINEMM-LEAMAS-CLOSURE-PROTOCOL-V1-FULL-CLOSURE-CANARY02.json |
| C4 | ACT-CLINEMM-LEAMAS-V2-CURRENT-TIP-CLOSURE-CANARY01 | docs/closure-plans/ACT-CLINEMM-LEAMAS-V2-CURRENT-TIP-CLOSURE-CANARY01.json |
| C5 | ACT-CLINEMM-MAIN-INTEGRATION-AND-CLOSURE-PROTOCOL-V1-DOGFOOD01 | docs/closure-plans/ACT-CLINEMM-MAIN-INTEGRATION-AND-CLOSURE-PROTOCOL-V1-DOGFOOD01.json |
| C6 | ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01-CORRECTION02 | docs/closure-plans/ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01-CORRECTION02.json |
| C7 | ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01 | docs/closure-plans/ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01.json |
| C8 | ACT-CLINEMM-TOOL-PROTOCOL-BOUNDED-RECOVERY01-CORRECTION01 | docs/closure-plans/ACT-CLINEMM-TOOL-PROTOCOL-BOUNDED-RECOVERY01-CORRECTION01.json |
| C9 | ACT-CLINEMM-TOOL-PROTOCOL-BOUNDED-RECOVERY01 | docs/closure-plans/ACT-CLINEMM-TOOL-PROTOCOL-BOUNDED-RECOVERY01.json |

These 9 IDs are NOT in the board's 192-ACT count (already externalized). They will be LINKED FROM the relevant epic file (no body duplication).


## New epic-file taxonomy (12 files)

| File | Subjects | Why this grouping |
|---|---|---|
| `.factory/epics/_index-contract.md` | Board contract, Repository topology, Canonical task index (summary), Immediate critical path, P2 residue, Historical aliases | Index-side material the new short board will need to reference directly |
| `.factory/epics/factory-infrastructure.md` | Git safety, Factorize doctrine, Board maintenance rule | Cross-cutting factory/mechanics |
| `.factory/epics/safe-yolo-seatbelt.md` | SEATBELT-DEFAULT-ON, SAFE-YOLO-*, MACOS-SEATBELT-* families, the recon closed in commit 1 (5e96cfd3) | The approval/substrate epic family already covered by darwin-seatbelt-* tests |
| `.factory/epics/approval-protection.md` | HOST-TEST-RUNNER, CLASSIC-PROTECTION-RECON01, EDITOR-TOOL-APPROVAL-FRICTION-RECON01 (NEXT, queued) | Approval work outside command policy |
| `.factory/epics/command-risk-classification.md` | V1 + V2 + READONLY-AND-COMPOSITION parser-assisted command-risk classifier | The 58 COMMAND-* ACTs related to command-risk |
| `.factory/epics/webview-seam-aop.md` | AOPC01/AOPC02 + AOC01 + AOC02 + LIVE-CAPTURE01 + RESULT01 | Application-ownership/projection/control coherence |
| `.factory/epics/task-control-liveness.md` | TASK-CONTROL-LIVENESS01, TASK-COMPLETION-*, QUEUED-PROMPT-STOP-RESUME-INTEGRITY01, FIX01 | Task lifecycle work |
| `.factory/epics/task-presentation.md` | Context/compaction, Task state/presentation, TASKHEADER-*, COMPACTION-* | Task visibility/projection |
| `.factory/epics/product-config-branding.md` | Product telemetry, Product config/branding, BRANDING-ACTIVITYBAR-ICON01 | Product-level work |
| `.factory/epics/distribution-ci.md` | Distribution/CI, publishing, dual-registry, CODE-COVERAGE-*, dynamic-editing backends (Dirac) | Release infra + non-command tool backends |
| `.factory/epics/quality-substrate.md` | Quality substrate, FACTORIZE-F0/F1/F2/F3/F4/F5, FACTORY-*, FACTORIZE-INTAKE, COMPACTION work | Codebase-quality substrate |
| `.factory/epics/upstream-intake.md` | Upstream intake, ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR, FOLLOWUP-*, USER-*, closing-canonary ACTs | External/upstream tracking |
| `.factory/epics/architecture.md` | Architecture overview | Cross-cutting system architecture note |
| `.factory/epics/closed-foundation.md` | Closed foundation (historical) | Already-closed-passed substrate |
| `.factory/epics/_epic-orphan-sink.md` | Anything that does not cleanly map to a family above | Safety net so no content is silently dropped |

~12–15 detail files (the manifest's mapping table names 12 primary destinations; `_index-contract.md`, `architecture.md`, `closed-foundation.md`, and the optional `_epic-orphan-sink.md` are supporting locations that are created only if a section actually needs them, so the precise count is decided during extraction). Sink is only populated if a section cannot cleanly map to any of the 12 primary destinations.

## What each epic file MUST contain (per the reviewer's template)

```markdown
# EPIC-...

## Current status
Status:
Priority:
Current frontier:
Blocked by:

## Contract / durable conclusions
Only claims we still rely on.

## ACT ledger
| ACT | Verdict | Head | Purpose |
|---|---|---|---|

## Open work
- ...

## Deferred work
- ...

## Historical detail
### ACT-...
<the bulky text currently embedded in epic-board.md>
```

## Acceptance gate (commit 4 validator MUST report all PASS)

The validator's left-hand authority is the **immutable pre-sharding commit**, not hand-maintained ID lists:

```text
MIGRATION_SOURCE_HEAD = 5e96cfd3a
                    = the recon-closure commit frozen immediately before this ACT
                    = also the last commit at which .factory/epic-board.md was the
                      single-file authority for all ACT IDs
```

It computes the OLD vs NEW ACT-ID sets itself:

```text
OLD_ACT_IDS =
  grep -oE 'ACT-CLINEMM-[A-Z0-9-]+' <(git show 5e96cfd3a:.factory/epic-board.md)
  | sort -u

NEW_ACT_IDS =
  grep -oE 'ACT-CLINEMM-[A-Z0-9-]+'
    <(cat .factory/epic-board.md .factory/epics/*.md
        | linked-closure-plan IDs from docs/closure-plans/*.json)
  | sort -u
```

And asserts:

```text
OLD_ACT_IDS - NEW_ACT_IDS = ∅           # load-bearing
```

A validator that computes against the immutable commit is stronger than line-accounting: after index reduction the old physical line boundaries intentionally disappear, so lines are kept only as migration diagnostics not as a permanent invariant.

```
MIGRATION_MANIFEST_COMPLETE      = PASS
OLD_ACT_IDS - NEW_ACT_IDS        = ∅
INDEX_LINES                      < 400
INDEX_LINKS                      = VALID
OPEN_FRONTIER_PRESERVED          = PASS
CLOSED_VERDICTS_PRESERVED        = PASS
git diff --check                 = PASS
```

The validator lives in `tools/factory/validate-epic-board.ts`.

## Notes

- The migration is **lossless**: every ACT ID in the current board will appear (a) in a detail file's ACT ledger, or (b) in a closure plan linked from a detail file, or (c) in the new index. The validator enforces this exactly via the `OLD_ACT_IDS - NEW_ACT_IDS = ∅` check (left-hand authority is the immutable pre-sharding commit `5e96cfd3a`).
- The **content** is moved verbatim where practical. The index is the only place where prose is summarized (to ~250 lines).
- No production code is involved.
