# 01-live-specimen.md

## Purpose
Frozen specimen for ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01
per §3 (specimen freeze) and §10 (identity split per twenty-third + 
twenty-fourth reviewer C1).

## BOUNDED CORRECTION HISTORY

This file is REVISED to reflect two rounds of bounded correction:

### Round 1 (twenty-fourth reviewer verdict HALT_LIVE_EVIDENCE_CONTRADICTS_CLASSIFICATION)

Key changes:
- UI-D binding flipped from PROVEN-SUPPRESSED to UNPROVEN
- UI-F binding flipped from PROVEN-VIA-SYNTHETIC-TRACE to UNPROVEN
- The "operator-uploaded CCARD trace" reference retired in favor of
  "NORMALIZED_DERIVED_FROM_LIVE synthetic trace"
- ROOT_PRESENTATION_CLASS flipped from PS-A to UNRESOLVED
- Verdict flipped from PASS_PRESENTATION_SURFACES_CLASSIFIED to
  CAPTURE_INSUFFICIENT
- Operator follow-up expanded to include a persisted-message dump
  requirement (not just live verification of the rendered webview)
- Round 1 verdict: CAPTURE_INSUFFICIENT. PS-B-eliminated remained
  open. Runtime cardinality verdict was STRUCTURAL (based on the
  synthetic trace's lifecycle-shape match).

### Round 2 (twenty-fifth reviewer verdict HALT_RAW_LIVE_TRACE_NOT_INGESTED)

Key changes:
- Raw operator-uploaded live CCARD JSONL ingested byte-identical as
  01a-ccard.LIVE_RAW.jsonl (SHA-256
  d7302ae909596a21d48ff491661e5f2652e831b62928fc50db2fb4837dbd24f1)
- Raw counters ingested as 01b-ccard-counters.LIVE_RAW.json
  (SHA-256 2a82c0028ad4a39e78c54bcab01ce1502582d9994b555626584ee72f9ec892c1)
- Synthetic trace relabeled 01a-ccard.SYNTHETIC_HYPOTHESIS_ONLY.jsonl
- Runtime cardinality verdict upgraded from STRUCTURAL to LIVE
- Round 2 attempted to read `submit_and_exit_seen.origin` as causal
  turn identity and ELIMINATED D.1, F.2, and PS-B. This inference is
  RETRACTED in round 3 (see below) because `origin` is a diagnostic
  classification, not a proven causal turn identity.

### Round 3 (twenty-sixth reviewer verdict HALT_SUBMIT_AND_EXIT_ORIGIN_MISINTERPRETED)

Key changes:
- New evidence rule recorded:
  ```
  submit_and_exit_seen.origin
    = diagnostic origin classification
    != proven run-turn identity
  ```
- Chronology of submit_and_exit_seen recorded:
  - seq 6 at=1790335477643 → CHRONOLOGICALLY_ASSOCIATED_WITH_EXPLICIT_USER
    + NOT_CAUSALLY_BOUND (falls inside explicit_user turn interval
    run_turn_started seq 1 ... agent_turn_done seq 7; 65 ms before
    pending_prompt_dequeued seq 8)
  - seq 11 at=1790335481227 → CHRONOLOGICALLY_ASSOCIATED_WITH_PENDING_PROMPT_DRAIN
    + NOT_CAUSALLY_BOUND (falls inside pending_prompt_drain turn
    interval run_turn_started seq 10 ... agent_turn_done seq 13;
    0 ms before task_completion_committed seq 12)
- D.1 RESTORED as POSSIBLE (round 2 ELIMINATION retracted)
- F.2 RESTORED as POSSIBLE (round 2 ELIMINATION retracted)
- PS-B remainder RESTORED as POSSIBLE (round 2 ELIMINATION retracted)
- SUBMIT_EXIT_TURN_BINDING = UNPROVEN (new field)
- Operator dump requirement REVISED: enumerate ALL say="completion_result"
  rows (count expected: 0, 1, or 2; not assumed to be 1)
- Round 3 verdict: CAPTURE_INSUFFICIENT (UNCHANGED); runtime
  cardinality: LIVE (UNCHANGED); SUBMIT_EXIT_TURN_BINDING: UNPROVEN

## Frozen specimen

| Field | Value |
|---|---|
| Extension id | `cline.cline` (= `${publisher.name}`; separate from `version`) |
| Extension version | `4.1.16` (manifest field, distinct from extension id) |
| Dogfood source HEAD | `baacc122aa3a9cb4afd1e1d139f269639a34fc3f` (subject commit; no later production-source edits) |
| Repository HEAD at entry | `6b1003574` (closure_head self-referential note) |
| VSIX | `dist/clinemm-4.1.16-baacc122a.vsix` (same artifact as BCCOC01 predecessor; closure_head commits between entries are evidence-only) |
| VSIX sha256 | `3e68587ad82506c4f96e6a51992e8e8c892bd10ab31ed48bdeef4a7a86e16154` (unchanged from BCCOC01; the VSIX is bit-identical because the closure_head commits between entries are evidence-only) |
| VSIX byte size | 14,899,136 |

## Live session identity (NEW after round 2)

| Field | Value |
|---|---|
| sessionId | `1790335441241_5g7oe` |
| taskId | `1790335441241_5g7oe` |
| jobId | `cmd_mugvhy92x7rm527e` |
| promptId | `pending_1790335474710_Reppe` |
| First timestamp | `1790335441430` ms |
| Last timestamp | `1790335481256` ms |
| Span | 39826 ms (~40 s) |

## Source identity notes (per twenty-third reviewer C1)

The reviewer flagged that the prior ACT confused `extension_id` and
`version`. Per VS Code extension packaging: `extension_id` is
`${publisher.name}` (always `cline.cline` for our package), and
`version` is a separate manifest field (here `4.1.16`). The VSIX is
named `${publisher.name}-${version}-${commit}.vsix`. There is NO
property in the manifest called `extension_id` containing the version.
The identity split below is the corrected one.

```
IMPLEMENTATION_SUBJECT_HEAD   = baacc122aa3a9cb4afd1e1d139f269639a34fc3f
CLOSURE_HEAD                  = (set by this round-3 bounded-correction commit)
DOGFOOD_SOURCE_HEAD           = baacc122aa3a9cb4afd1e1d139f269639a34fc3f
```

The dogfood_source_head equals implementation_subject_head because the
VSIX is built from subject_head and the same VSIX is being dogfooded
in this ACT.

## Specimen content (UI surfaces the operator enumerated)

Per the canonical UI enumeration in `01c-ui.txt` (treated as 
authoritative after round-1 bounded correction; two green COMPLETED
cards are explicitly listed):

| UI id | Type | Visible text (abbrev.) | Producer candidate | Binding status |
|---|---|---|---|---|
| (user bubble) | user message | "Run this command in the background and notify me when it finishes." | webview UserMessage row | PROVEN_VIA_PRODUCER |
| UI-A | terminal card | "Ran sh -c ... + Backgrounded" | message-translator.ts:1801-1875 + ChatRow.tsx:251 | PROVEN_VIA_PRODUCER |
| UI-B | text row | "The command is running..." | message-translator.ts:1620-1629 | PROVEN_VIA_PRODUCER |
| UI-C | text row | "The command has finished. Output: ..." | message-translator.ts:1620-1629 | PROVEN_VIA_PRODUCER |
| UI-D | **green COMPLETED card #1** | "Ran sh -c ... in the background..." | UNPROVEN — 4 candidates POSSIBLE (D.1 RESTORED in round 3; D.2, D.3, D.4) | UNPROVEN_PENDING_PERSISTED_BINDING |
| UI-E | text row | "The background command ... has completed successfully..." | message-translator.ts:1620-1629 | PROVEN_VIA_PRODUCER |
| UI-F | **green COMPLETED card #2** | "The background command completed successfully." | UNPROVEN — 2 candidates POSSIBLE (F.1 wake turn's completion_result; F.2 second completion_result RESTORED in round 3) | UNPROVEN_PENDING_PERSISTED_BINDING |

## LIVE runtime cardinality (UPGRADED after round 2)

```
terminal_committed        = 1   ✓  (seq 2)
notify_consume_enter      = 1   ✓  (seq 3)
wake_created              = 1   ✓  (seq 5)
pending_prompt_enqueued   = 1   ✓  (seq 4)
pending_prompt_dequeued   = 1   ✓  (seq 8)
continuation_scheduled    = 1   ✓  (seq 9)
run_turn_started          = 2   ✓  (seq 1 explicit_user + seq 10 pending_prompt_drain)
agent_turn_done           = 2   ✓  (seq 7 explicit_user + seq 13 pending_prompt_drain)
task_completion_committed = 1   ✓  (seq 12)
wake C4->C8 jobId         = identical (cmd_mugvhy92x7rm527e on seq 4, 5, 8, 9, 10)   ✓
submit_and_exit_seen      = 2   (BOTH origin label=pending_prompt_drain;
                                CHRONOLOGICALLY: seq 6 inside explicit_user
                                turn interval; seq 11 inside pending_prompt_drain
                                turn interval; SUBMIT_EXIT_TURN_BINDING=UNPROVEN)
```

All numbers computed from 01a-ccard.LIVE_RAW.jsonl (round-2 ingested).

## LIVE-trace insight (REVISED in round 3)

(Round 2 — RETRACTED in round 3):

  The LIVE trace's `submit_and_exit_seen` pattern (count=2 with
  BOTH origins=pending_prompt_drain) was originally read as proving
  that the explicit_user turn did NOT call the completion tool and
  did NOT emit a `say="completion_result"` row, ELIMINATING UI-D's
  candidate D.1 and the PS-B remainder.

(Round 3 — CURRENT):

  Evidence rule (NEW):
  ```
  submit_and_exit_seen.origin
    = diagnostic origin classification
    != proven run-turn identity
  ```

  Chronology of submit_and_exit_seen records (from LIVE_RAW):
  - seq 6 at=1790335477643 → CHRONOLOGICALLY_ASSOCIATED_WITH_EXPLICIT_USER
    + NOT_CAUSALLY_BOUND (falls inside explicit_user turn interval
    run_turn_started seq 1 ... agent_turn_done seq 7; 65 ms BEFORE
    pending_prompt_dequeued seq 8)
  - seq 11 at=1790335481227 → CHRONOLOGICALLY_ASSOCIATED_WITH_PENDING_PROMPT_DRAIN
    + NOT_CAUSALLY_BOUND (falls inside pending_prompt_drain turn
    interval run_turn_started seq 10 ... agent_turn_done seq 13;
    0 ms before task_completion_committed seq 12)

  Under the corrected rule, no presentation-class candidate can be
  eliminated on the basis of the submit_and_exit_seen pattern.

Remaining candidates for UI-D (all POSSIBLE):
- D.1: completion_result from explicit_user turn (RESTORED in round 3)
- D.2: badged text row by `resolveTerminalReportFraming`
- D.3: phantom duplicate of wake turn's completion_result
- D.4: terminal_card (UI-A) re-rendered with "Completed" badge after wake

Remaining candidates for UI-F (all POSSIBLE):
- F.1: wake turn's completion_result at seq 11
- F.2: second completion_result interpretation (RESTORED in round 3)

PS-B remainder: POSSIBLE (RESTORED in round 3). Two completion_results,
one per turn, remains consistent with the LIVE trace.

## Classification verdict (current)

| Field | Round 1 (retired) | Round 2 (retired) | Round 3 (current) |
|---|---|---|---|
| ROOT_PRESENTATION_CLASS | UNRESOLVED | UNRESOLVED | UNRESOLVED |
| UI-D binding | UNPROVEN_PENDING_PERSISTED_BINDING (D.1, D.2 candidates) | UNPROVEN_PENDING_PERSISTED_BINDING (D.2, D.3, D.4 — D.1 ELIMINATED_BY_LIVE_TRACE) | UNPROVEN_PENDING_PERSISTED_BINDING (4 candidates POSSIBLE: D.1 RESTORED, D.2, D.3, D.4) |
| UI-F binding | UNPROVEN_PENDING_PERSISTED_BINDING (F.1, F.2 candidates) | UNPROVEN_PENDING_PERSISTED_BINDING (F.1 only — F.2 ELIMINATED_BY_LIVE_TRACE) | UNPROVEN_PENDING_PERSISTED_BINDING (2 candidates POSSIBLE: F.1, F.2 RESTORED) |
| RUNTIME_CARDINALITY | STRUCTURAL (synthetic-trace derived) | LIVE (computed from 01a-ccard.LIVE_RAW.jsonl) | LIVE (UNCHANGED from round 2) |
| WAKE_CARDINALITY | STRUCTURAL | LIVE | LIVE |
| EXECUTION_CARDINALITY | STRUCTURAL | LIVE | LIVE |
| C4->C8 jobId correlation | STRUCTURAL | LIVE | LIVE |
| RAW_LIVE_TRACE_PRESERVED | NO (incorrect) | YES (ingested byte-identical) | YES (UNCHANGED from round 2) |
| SUBMIT_EXIT_TURN_BINDING | (not yet defined) | (implied causal) | UNPROVEN (origin label != causal turn identity) |
| PS-A | POSSIBLE | POSSIBLE (recoverable) | POSSIBLE |
| PS-B | POSSIBLE | ELIMINATED_BY_LIVE_TRACE (round 2) | POSSIBLE (round 3 restore) |
| PS-C | POSSIBLE | POSSIBLE | POSSIBLE |
| PS-D | (not yet defined) | POSSIBLE (new) | POSSIBLE |
| PS-E | (not yet defined) | POSSIBLE (new) | POSSIBLE |
| Verdict | CAPTURE_INSUFFICIENT | CAPTURE_INSUFFICIENT | CAPTURE_INSUFFICIENT |
| REPAIR_AUTHORIZED | FALSE | FALSE | FALSE |

## Operator follow-up (EXPANDED after round 3)

1. Dump the persisted `clineMessages` for taskId=`1790335441241_5g7oe`
   (e.g. `cat ~/.cline/data/tasks/1790335441241_5g7oe/messages.json`).
2. Enumerate ALL `say="completion_result"` rows (count expected:
   0, 1, or 2 — NOT assumed to be 1). For each row: record message id,
   text, partial, isAuthoritativelyCompletedResult, turn origin.
3. Enumerate all `say="text"` rows that have a green "Completed" badge
   applied by `resolveTerminalReportFraming`.
4. Bind UI-D and UI-F to specific persisted rows.
5. Apply the classification.remainder branches in `result.json`:
   - If UI-D = badged text (D.2) AND UI-F = wake turn's completion_result (F.1):
     PS-A re-opens (original classification recovered).
   - If UI-D = completion_result from explicit_user turn (D.1) AND
     UI-F = completion_result from pending_prompt_drain turn (F.1):
     PS-B re-opens (two completion_results; C10 did not suppress UI-D).
   - If UI-D = phantom duplicate of wake's completion_result (D.3):
     PS-D remainder (webview-side state propagation has a duplicate-render
     defect; UNKNOWN new class).
   - If UI-D = terminal_card re-render (D.4):
     PS-E remainder (renderer over-badging terminal_card; UNKNOWN new class).
   - If F.2 holds (two completion_results) but UI-D binds to
     something else (D.2/D.3/D.4): PS-C or PS-D or PS-E applies
     with PS-B-style multiplicity.
   - If persisted history cannot distinguish: CAPTURE_INSUFFICIENT
     holds; extend the hold.

## File map (REVISED)

- `00-raw-trace-status.md` — REVISED (round 3): adds evidence rule + chronology block; RETRACTS round-2 inference; RESTORES D.1/F.2/PS-B as POSSIBLE
- `01-live-specimen.md` — this file (REVISED round 3)
- `01a-ccard.LIVE_RAW.jsonl` — round 2: raw operator-uploaded live JSONL (UNCHANGED in round 3)
- `01a-ccard.SYNTHETIC_HYPOTHESIS_ONLY.jsonl` — RENAMED from 01a-ccard.NORMALIZED_DERIVED.jsonl (round 2)
- `01a-ccard.SYNTHETIC_HYPOTHESIS_ONLY.meta.md` — provenance label (REVISED)
- `01b-ccard-counters.LIVE_RAW.json` — round 2: raw operator-uploaded counters (UNCHANGED in round 3)
- `01b-ccard-counters.json` — round 2: computed from LIVE_RAW (UNCHANGED in round 3)
- `01c-ui.txt` — AUTHORITATIVE UI enumeration (operator-transcribed; lists 2 green COMPLETED cards)
- `02-recon.md` — source-bound recon (REVISED round 3: D.1 RESTORED; F.2 RESTORED; PS-B RESTORED)
- `03-presentation-map.jsonl` — machine-readable per-surface mapping (REVISED round 3: D.1 RESTORED; F.2 RESTORED)
- `04-focused-gates.txt` — focused gates (REVISED round 3: SUBMIT_EXIT_TURN_BINDING = UNPROVEN; C-12 gate added)
- `result.json` — verdict + factory cursor (REWRITTEN round 3 with round-3 history entry)
