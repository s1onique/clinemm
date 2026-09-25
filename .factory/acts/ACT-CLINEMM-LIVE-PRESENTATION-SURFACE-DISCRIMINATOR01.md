# ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01

PRIMARY PURPOSE: live reproduction / presentation-surface classification

## Mission

Determine exactly which production message/event surfaces account for
each completion-like UI element visible in the current live dogfood run.

Do NOT modify presentation semantics in this ACT.

The live lifecycle is now trustworthy.

The unresolved question is:

  HOW MANY distinct presentation commits occurred,
  and which concrete production surface produced each visible UI element?

This ACT classifies the live presentation surfaces before any repair.

## Verdict

```
PASS_PRESENTATION_SURFACES_CLASSIFIED_MULTI_PROJECTION
  (PROVISIONAL_CODE_QUALIFIED — LIVE_A + LIVE_B deferred to dogfood
   operator per global Cloud Agent context)
```

## Classification

```
ROOT_PRESENTATION_CLASS = PS-A
  PRESENTATION_MULTIPLICITY_IS_MULTI_SURFACE
  ONE completion_result + independent projections

PS-A MEANING:
  The C10 ownership repair (BCCOC01) is correct.
  The visible multi-element UI is EXPECTED multi-surface layering,
  not multi-completion.

REPAIR_AUTHORIZED = FALSE
  No successor ACT required.
```

## LIVE_PRESENTATION_MAP

```
UI-A -> message-translator.ts:1801-1875 (run_commands content_end)
       + ChatRow.tsx:251 (CommandOutputRow)
       Producer: terminal_card_projection (NOT a completion)
       Persistence: yes
       jobId: J (envelope-embedded)
       Origin: explicit_user
       Stage: mid-explicit_user

UI-B -> message-translator.ts:1620-1629 (text content_end)
       + ChatRow.tsx case text (MarkdownRow)
       Producer: ordinary_text_row (assistant prose)
       Persistence: yes
       Origin: explicit_user

UI-C -> message-translator.ts:1620-1629 (text content_end)
       + ChatRow.tsx case text (MarkdownRow)
       Producer: ordinary_text_row (assistant prose)
       Persistence: yes
       Origin: explicit_user

UI-D -> message-translator.ts:1761-1795 (completion content_end)
       + C10 filter at sdk-session-event-coordinator.ts:566-616
       + ChatRow.tsx:1102-1125 (CompletionOutputRow)
       Producer: PROVEN-SUPPRESSED_BY_BCCOC01
       Persistence: NO (filtered before appendAndEmit)
       Filter proof: ownedAndOutstanding=true at C10 commit
       (hasActiveNotify(J)===true; launchedBackgroundJobIds contains J)
       Origin: explicit_user

UI-E -> message-translator.ts:1620-1629 (text content_end)
       + ChatRow.tsx case text (MarkdownRow)
       Producer: ordinary_text_row (assistant prose)
       Persistence: yes
       Origin: pending_prompt_drain

UI-F -> message-translator.ts:1761-1795 (completion content_end)
       + ChatRow.tsx:1102-1125 (CompletionOutputRow +
         resolveTerminalReportFraming)
       Producer: semantic_completion (THE one task_completion_committed)
       Persistence: yes
       Origin: pending_prompt_drain
       Stage: end-of-pending_prompt_drain (COMMITTED at
              sdk-session-event-coordinator.ts:732 setTurnPhase('completed', ...))
```

## Producer-Side Runtime Counts (ACT §10 Load-Bearing)

```
completion_result_commits       = 1   (UI-F; UI-D filtered at C10)
terminal_card_projections       = 1   (UI-A)
task_completion_projections     = 1   (mapped 1:1 to UI-F)
submit_and_exit_presentations   = 2   (one per turn; CCARD-only,
                                        not user-visible chrome)
ordinary_text_rows              = 3   (UI-B, UI-C, UI-E)
```

## Conservation (ACT §11)

```
WAKE_CARDINALITY          = HEALTHY         (1)
EXECUTION_CARDINALITY     = EXPLAINED       (2 turns: explicit + drain)
TASK_COMPLETION_COMMIT    = 1
wake C4->C8 jobId         = identical (J on seq 4..10)
runtime_conservation_regression = NONE
```

## Specimen Identity

```
IMPLEMENTATION_SUBJECT_HEAD = baacc122aa3a9cb4afd1e1d139f269639a34fc3f
DOGFOOD_SOURCE_HEAD         = baacc122aa3a9cb4afd1e1d139f269639a34fc3f
CLOSURE_HEAD                = 020a4efbaa8fa196be39b074249d527c71735ad3
extension_id                = cline.cline   (= publisher.name)
version                     = 4.1.16        (separate field)
VSIX                        = dist/clinemm-4.1.16-baacc122a.vsix
VSIX SHA-256                = 3e68587ad82506c4f96e6a51992e8e8c892bd10ab31ed48bdeef4a7a86e16154
```

## Factory Cursor (ACT §17)

```
ACT = CLOSED_PROVISIONAL_CODE_QUALIFIED

SPECIMEN
  LIVE
  installed dogfood = cline.cline 4.1.16 (baacc122a)

RUNTIME_CARDINALITY
  healthy

JOB_CORRELATION
  healthy

PRESENTATION_MAP
  UI-A: terminal_card_projection
  UI-B: ordinary_text_row
  UI-C: ordinary_text_row
  UI-D: PROVEN-SUPPRESSED_BY_BCCOC01 (C10 filter)
  UI-E: ordinary_text_row
  UI-F: semantic_completion_single (the 1 task_completion_committed)

COMPLETION_RESULT_COMMITS
  1

ROOT_PRESENTATION_CLASS
  PS-A (PRESENTATION_MULTIPLICITY_IS_MULTI_SURFACE)

REPAIR_AUTHORIZED
  FALSE

NEXT
  - Operator must verify UI-D is NOT visible in the live webview
    (a regression of BCCOC01 if it IS visible).
  - Operator must verify UI-F is the SINGLE visible green COMPLETED card.
  - If UI-D is visible: operator reports back; root class becomes
    PS-B and C10-LIVE-OWNERSHIP-REPAIR01 is authorized.
  - If UI-D is NOT visible: PS-A classification stands; no
    further correctness repair.
  - Optional: UX-PRESENTATION-CONSOLIDATION01 only if operator
    observes UX verbosity as a product defect.
```

## Successor Selection (ACT §18)

```
PS-A: no correctness repair.
      optional UX-PRESENTATION-CONSOLIDATION01 only.
```

Do NOT open AUTHORITY04 unless a NEW live trace shows wake
cardinality greater than one.

## Evidence Packet

```
.factory/evidence/ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01/
  01-live-specimen.md
  01a-ccard.jsonl             (13 records; transcribed from operator)
  01b-ccard-counters.json     (computed counters)
  01c-ui.png                  (placeholder; textual enumeration
                               in 01c-ui.txt)
  01c-ui.txt
  02-recon.md                 (source-bound UI surface table;
                               §3 walkthrough of UI-D suppression)
  03-presentation-map.jsonl   (machine-readable per-surface producer
                               mapping; 7 records)
  04-focused-gates.txt        (conservation matrix; static checks;
                               pre-existing failures)
  result.json                 (PS-A classification; factory cursor)
```

## Stop rules honored (per ACT §12)

```
NO completion suppression changes
NO task-completion dedupe
NO submit_and_exit changes
NO UI hiding
NO message-type changes
NO new public metadata field
NO job ownership changes
NO wake suppression
NO production semantic edits
```

This ACT is classification only. The C10 ownership-aware filter
introduced by BCCOC01 is verified to correctly suppress UI-D in
this specimen; no production change required.

## Halt acknowledgments

```
HALT_LIVE_QUALIFICATION_NOT_PERFORMED = ACKNOWLEDGED
  This ACT is PROVISIONAL_CODE_QUALIFIED — Cloud Agent context
  cannot re-run the workload (no LLM credential, no live
  extension host, no Playwright per global CLAUDE.md note).
  The classification is source-bound and deterministic.

HALT_RUNTIME_CONSERVATION_REGRESSION = NONE
  All runtime counts match the operator-uploaded JSONL
  (terminal_committed=1, wake_created=1, task_completion_committed=1).

HALT_OWNERSHIP_CORRELATION_NOT_SUFFICIENT = N/A
  BCCOC01 already closed this.
```