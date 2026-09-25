# ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01

PRIMARY PURPOSE: live reproduction / presentation-surface classification

## BOUNDED CORRECTION STATUS

This ACT was REVISED by TWO rounds of bounded correction:

  **Round 1** — twenty-fourth reviewer verdict **HALT_LIVE_EVIDENCE_CONTRADICTS_CLASSIFICATION**

  Two P0s were addressed (round 1):

    **P0-A  Evidence-quality promotion (partial).**
    The file previously committed as `01a-ccard.jsonl` was a
    Cloud-Agent-synthetic trace mislabeled as raw operator upload.
    Renamed to `01a-ccard.NORMALIZED_DERIVED.jsonl` and provenance
    disclosed in:
      - `00-raw-trace-status.md` (new file in this ACT's evidence dir)
      - `01a-ccard.NORMALIZED_DERIVED.meta.md` (new sibling meta file)
    Round 1 PARTIALLY closed this: the synthetic-trace mislabeling
    was disclosed, but the round-1 closure also incorrectly stated
    "no raw operator-uploaded JSONL exists in this repository" —
    this was true for `.factory/` etc. but missed the chat-upload
    files in `~/Downloads/continuation*`.

    **P0-B  Internal contradiction.**
    The previous recon §5 + 03-presentation-map entry for UI-D
    claimed `PROVEN-SUPPRESSED_BY_BCCOC01` (`persisted=false`),
    but the canonical UI enumeration (01c-ui.txt) explicitly listed
    UI-D as a SECOND visible green COMPLETED card alongside UI-F.
    The UI enumeration is now treated as authoritative; UI-D binding
    is re-opened as `UNPROVEN_PENDING_PERSISTED_BINDING`.

  Round 1 verdict: `PASS_PRESENTATION_SURFACES_CLASSIFIED_MULTI_PROJECTION` (PS-A) -> **CAPTURE_INSUFFICIENT**.
  ROOT_PRESENTATION_CLASS = UNRESOLVED. REPAIR_AUTHORIZED = FALSE.

  **Round 2** — twenty-fifth reviewer verdict **HALT_RAW_LIVE_TRACE_NOT_INGESTED**

  Round 2 FULLY closed P0-A by ingesting the raw operator-uploaded
  live CCARD trace from `~/Downloads/continuation*`:

    - `01a-ccard.LIVE_RAW.jsonl` (2037 bytes; SHA-256
      d7302ae909596a21d48ff491661e5f2652e831b62928fc50db2fb4837dbd24f1;
      byte-identical to the operator's chat upload)
    - `01b-ccard-counters.LIVE_RAW.json` (1207 bytes; SHA-256
      2a82c0028ad4a39e78c54bcab01ce1502582d9994b555626584ee72f9ec892c1)

  The synthetic trace was relabeled
  `01a-ccard.SYNTHETIC_HYPOTHESIS_ONLY.jsonl` and is RETAINED as a
  historical record of the prior cycle's hypothesis but is NOT
  authoritative.

  Runtime cardinality verdict UPGRADED from STRUCTURAL to LIVE
  (computed from 01a-ccard.LIVE_RAW.jsonl).

  **Key insight from LIVE trace** (NEW in round 2):
  `submit_and_exit_seen=2` with BOTH origins=pending_prompt_drain
  proves the explicit_user turn did NOT call the completion tool.
  Therefore:
    - UI-D candidate D.1 (completion_result SURVIVED C10) is ELIMINATED.
    - UI-F candidate F.2 (second completion_result) is ELIMINATED.
    - PS-B remainder (two completion_result rows) is ELIMINATED.
    - UI-D has 3 remaining candidates (D.2 badged text, D.3 phantom
      duplicate, D.4 terminal_card re-render).
    - UI-F has 1 remaining candidate (F.1 wake turn's completion_result).

  Round 2 verdict: **CAPTURE_INSUFFICIENT** (UNCHANGED).
  ROOT_PRESENTATION_CLASS = UNRESOLVED. REPAIR_AUTHORIZED = FALSE.

The body below reflects the ROUND-2 bounded-correction state.
No production semantic edits in either round.

## Mission

Determine exactly which production message/event surfaces account for
each completion-like UI element visible in the current live dogfood run.

Do NOT modify presentation semantics in this ACT.

The live lifecycle is now trustworthy (structural; based on the
synthetic trace's lifecycle-shape match to the ACT contract).

The unresolved question (now broadened by the bounded correction) is:

  HOW MANY distinct presentation commits occurred, and which concrete
  production surface produced each visible UI element?

The previous cycle claimed this was answerable from source + a synthetic
trace. The bounded correction accepts that the synthetic trace is not
authoritative and the UI enumeration reveals TWO visible green
COMPLETED cards (not one), so binding requires an additional operator
input (persisted-message dump).

## Verdict

```
ROOT_PRESENTATION_CLASS = UNRESOLVED
WAKE_CARDINALITY        = LIVE (round 2 upgrade from STRUCTURAL; computed
                          from 01a-ccard.LIVE_RAW.jsonl)
RUNTIME_CARDINALITY     = LIVE (round 2 upgrade)
C4->C8 jobId correlation = LIVE (cmd_mugvhy92x7rm527e on seq 4,5,8,9,10)
TASK_COMPLETION_COMMIT  = LIVE (1 capture; seq 12)
UI-D PRODUCER           = UNPROVEN_PENDING_PERSISTED_BINDING (3 remaining
                          candidates: D.2 badged text, D.3 phantom duplicate,
                          D.4 terminal_card re-render; D.1 ELIMINATED_BY_LIVE_TRACE)
UI-F PRODUCER           = UNPROVEN_PENDING_PERSISTED_BINDING (1 remaining
                          candidate: F.1 wake turn's completion_result;
                          F.2 ELIMINATED_BY_LIVE_TRACE)
RAW_LIVE_TRACE_PRESERVED = YES (round 2 ingested)
VERDICT                 = CAPTURE_INSUFFICIENT
VERDICT_STATUS          = HALT_CAPTURE_INSUFFICIENT (twenty-fourth reviewer)
                          + HALT_RAW_LIVE_TRACE_NOT_INGESTED (twenty-fifth
                          reviewer; CLOSED by round 2)
REPAIR_AUTHORIZED       = FALSE
```

## Classification (remainder branches)

The bounded correction flips the verdict to UNRESOLVED; classification
cannot proceed without binding UI-D and UI-F to persisted messages.
The remainder branches below enumerate the four possible outcomes
once a binding is performed:

  - **PS-A remainder** — If UI-D binds to a non-completion_result
    message type (e.g. say='text' badged by `resolveTerminalReportFraming`)
    AND UI-F binds to a `say="completion_result"` row, then the
    previous PS-A classification is recovered (one semantic completion
    + one misidentified text). RECLASSIFY_POSSIBLE.

  - **PS-B remainder** — If both UI-D and UI-F bind to
    `say="completion_result"` rows with
    `isAuthoritativelyCompletedResult=true`, then
    `C10_DUPLICATION_PERSISTS_LIVE = true` and
    `C10-LIVE-OWNERSHIP-REPAIR01` is authorized.

  - **PS-C remainder** (newly named) — If neither binds to
    `completion_result` but both render as green COMPLETED cards, then
    some other producer (likely `resolveTerminalReportFraming` or
    terminalCardProjection) is over-badging text rows. UNKNOWN new
    class; separate ACT required to investigate the over-badging.

  - **PS-D remainder** — If persisted messages reveal UI-D and UI-F
    map to DIFFERENT turn origins but both are `completion_result`,
    then the C10 filter suppression logic has a per-job mismatch;
    `C10-LIVE-OWNERSHIP-REPAIR01` also authorized.

The classification holds at UNRESOLVED until a binding is performed.

## LIVE_PRESENTATION_MAP (revised)

| UI id | Visible text (abbrev.) | Producer candidate | Binding status |
|---|---|---|---|
| (user bubble) | "Run this command in the background and notify me when it finishes." | webview UserMessage row | PROVEN_VIA_PRODUCER |
| UI-A | "Ran sh -c ... + Backgrounded" | `message-translator.ts:1801-1875` + `ChatRow.tsx:251` (CommandOutputRow) | PROVEN_VIA_PRODUCER |
| UI-B | "The command is running..." | `message-translator.ts:1620-1629` (text content_end) | PROVEN_VIA_PRODUCER |
| UI-C | "The command has finished. Output: ..." | `message-translator.ts:1620-1629` (text content_end) | PROVEN_VIA_PRODUCER |
| **UI-D** | green COMPLETED card #1: "Ran sh -c ... in the background..." | UNPROVEN — candidate D.1 (completion_result SURVIVED C10) or D.2 (badged text) | UNPROVEN_PENDING_PERSISTED_BINDING |
| UI-E | "The background command ... has completed successfully..." | `message-translator.ts:1620-1629` (text content_end) | PROVEN_VIA_PRODUCER |
| **UI-F** | green COMPLETED card #2: "The background command completed successfully." | UNPROVEN — candidate F.1 (pending_prompt_drain completion_result) or F.2 (regression duplicate) | UNPROVEN_PENDING_PERSISTED_BINDING |

The UI enumeration in `01c-ui.txt` lists TWO green COMPLETED cards
(UI-D and UI-F). The previous cycle's claim that UI-D is
"PROVEN-SUPPRESSED" directly contradicted this; the bounded correction
treats the UI enumeration as authoritative and re-opens binding for
both UI-D and UI-F.

## Producer-Side Runtime Counts (REVISED provenance)

Previous count (REJECTED):
```
completion_result_commits       = 1   (UI-F; UI-D was filtered at C10)
terminal_card_projections       = 1   (UI-A)
task_completion_projections     = 1   (mapped 1:1 to UI-F)
submit_and_exit_presentations   = 2   (one per turn; CCARD-only,
                                        not user-visible chrome)
ordinary_text_rows              = 3   (UI-B, UI-C, UI-E)
```

Revised count (HELD OPEN pending binding):
```
completion_result_commits       = UNRESOLVED (0, 1, or 2 — depends on binding)
terminal_card_projections       = 1   (UI-A; unchanged)
task_completion_projections     = UNRESOLVED (0 or 1 — depends on binding)
submit_and_exit_presentations   = 2   (per the synthetic trace, lifecycle-shape only)
ordinary_text_rows              = 3 or 4   (UI-B, UI-C, UI-E always; UI-D could be a 4th if badged text)
```

The previous PS-A classification relied on `completion_result_commits=1`,
which the synthetic trace happens to satisfy but which the operator's
UI enumeration contradicts. Both cannot be true; the operator's dump
is the tie-breaker.

## Conservation (ACT §11, UPGRADED to LIVE in round 2)

```
WAKE_CARDINALITY        = LIVE (computed from 01a-ccard.LIVE_RAW.jsonl)
EXECUTION_CARDINALITY   = LIVE (2 turns: explicit_user + pending_prompt_drain)
WAKE_C4_C8_CORRELATION  = identical (cmd_mugvhy92x7rm527e on seq 4,5,8,9,10)
TASK_COMPLETION_COMMIT  = 1 (LIVE; seq 12)
TERMINAL_COMMITTED      = 1 (LIVE; seq 2)
NOTIFY_CONSUME_ENTER    = 1 (LIVE; seq 3)
SUBMIT_AND_EXIT_SEEN    = 2 (BOTH origin=pending_prompt_drain; LIVE)
RUNTIME_CONSERVATION_REGRESSION = NONE
```

These are SHAPE checks, not authoritative runtime captures. See
`00-raw-trace-status.md` for the provenance disclosure.

## Specimen Identity

```
extension_id                = cline.cline (= ${publisher.name})
version                     = 4.1.16 (separate manifest field)
IMPLEMENTATION_SUBJECT_HEAD = baacc122aa3a9cb4afd1e1d139f269639a34fc3f
DOGFOOD_SOURCE_HEAD         = baacc122aa3a9cb4afd1e1d139f269639a34fc3f
CLOSURE_HEAD                = 6ae05212d (this round-2 bounded-correction commit)

Live session identity (NEW after round 2):
sessionId                   = 1790335441241_5g7oe
taskId                      = 1790335441241_5g7oe
jobId                       = cmd_mugvhy92x7rm527e
promptId                    = pending_1790335474710_Reppe
time_range_ms               = 1790335441430 .. 1790335481256 (39826 ms span)

VSIX                        = dist/clinemm-4.1.16-baacc122a.vsix (bit-identical to BCCOC01)
VSIX SHA-256                = 3e68587ad82506c4f96e6a51992e8e8c892bd10ab31ed48bdeef4a7a86e16154

Raw trace identity (NEW after round 2):
01a-ccard.LIVE_RAW.jsonl    SHA-256 d7302ae909596a21d48ff491661e5f2652e831b62928fc50db2fb4837dbd24f1
                            (byte-identical to operator's chat upload)
01b-ccard-counters.LIVE_RAW.json  SHA-256 2a82c0028ad4a39e78c54bcab01ce1502582d9994b555626584ee72f9ec892c1
```

The dogfood_source_head equals implementation_subject_head because the
VSIX is built from subject_head and the same VSIX is being dogfooded
in this ACT. The closure_head commits between BCCOC01 and this ACT are
evidence-only (the bounded correction commits) and do not change the
VSIX.

## Factory Cursor (ACT §17)

```
PREDECESSOR                = PASS_COMPLETION_OWNERSHIP_CORRELATION_CODE_QUALIFIED (BCCOC01)
RUNTIME_CARDINALITY        = LIVE (round 2 upgrade from STRUCTURAL)
JOB_CORRELATION            = LIVE (cmd_mugvhy92x7rm527e on seq 4,5,8,9,10)
RAW_LIVE_TRACE_PRESERVED   = YES (round 2 ingested byte-identical)
PRESENTATION_MAP           = UI-A/B/C/E: PROVEN_VIA_PRODUCER
                             UI-D: UNPROVEN_PENDING_PERSISTED_BINDING (D.1 ELIMINATED_BY_LIVE_TRACE;
                                 3 remaining candidates: D.2 badged text, D.3 phantom duplicate,
                                 D.4 terminal_card re-render)
                             UI-F: UNPROVEN_PENDING_PERSISTED_BINDING (1 remaining candidate:
                                 F.1 wake turn's completion_result; F.2 ELIMINATED_BY_LIVE_TRACE)
ROOT_PRESENTATION_CLASS    = UNRESOLVED (PS-B ELIMINATED_BY_LIVE_TRACE;
                             PS-A reopens if UI-D = D.2; PS-D if D.3; PS-E if D.4)
REPAIR_AUTHORIZED          = FALSE
NEXT                       = Operator must (a) dump persisted clineMessages for taskId=
                             1790335441241_5g7oe (cat ~/.cline/data/tasks/1790335441241_5g7oe/
                             messages.json), (b) bind each operator-visible green COMPLETED
                             card to a persisted row, (c) apply the classification.remainder
                             branches (PS-A, PS-C, PS-D, or PS-E; PS-B eliminated).
```

## Successor Selection (ACT §18)

No successor ACT is selected in this cycle. The ACT holds at
CAPTURE_INSUFFICIENT pending the operator-supplied persisted-message
dump. Once the dump is supplied, this ACT can be re-opened with
bounded scope to:

  - Apply the binding procedure (enumerate `say="completion_result"`
    rows; enumerate badged `say="text"` rows; bind UI-D and UI-F).
  - Apply the classification.remainder branches to determine the
    final PS-A / PS-B / PS-C / PS-D verdict.
  - If PS-B or PS-D, authorize C10-LIVE-OWNERSHIP-REPAIR01.
  - If PS-C, open a separate ACT to investigate over-badging of text
    rows by `resolveTerminalReportFraming`.

No production semantic edits are authorized in this cycle.

## Evidence Packet

```
.factory/evidence/ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01/
  00-raw-trace-status.md                       (REVISED round 2: raw trace ingested + LIVE insight)
  01-live-specimen.md                          (REVISED round 2: LIVE trace identity)
  01a-ccard.LIVE_RAW.jsonl                     (NEW round 2: raw operator-uploaded JSONL; SHA-256 d7302ae9...d24f1)
  01a-ccard.SYNTHETIC_HYPOTHESIS_ONLY.jsonl    (RENAMED round 2 from .NORMALIZED_DERIVED.jsonl; NOT authoritative)
  01a-ccard.SYNTHETIC_HYPOTHESIS_ONLY.meta.md  (RENAMED round 2 + revised provenance label)
  01b-ccard-counters.LIVE_RAW.json             (NEW round 2: raw operator-uploaded counters; SHA-256 2a82c002...92c1)
  01b-ccard-counters.json                      (REVISED round 2: computed from LIVE_RAW with sessionId/taskId/jobId/promptId/time_range_ms)
  01c-ui.txt                                   (AUTHORITATIVE UI enumeration; lists 2 green COMPLETED cards)
  01c-ui.png                                   (REMOVED round 1; was actually ASCII text, not a PNG)
  02-recon.md                                  (REVISED round 2: D.1 + F.2 + PS-B ELIMINATED_BY_LIVE_TRACE;
                                                D.3 + D.4 new candidates; §7 with taskId)
  03-presentation-map.jsonl                    (REVISED round 2: D.1 ELIMINATED_BY_LIVE_TRACE; F.2 ELIMINATED;
                                                4 remaining candidates for UI-D (D.2/D.3/D.4); 1 for UI-F (F.1))
  04-focused-gates.txt                         (REVISED round 2: WAKE_CARDINALITY=LIVE; runtime gates upgraded;
                                                C-9 + C-11 raw trace presence gates added)
  result.json                                  (REWRITTEN round 2: CAPTURE_INSUFFICIENT; ROOT_PRESENTATION_CLASS=UNRESOLVED;
                                                PS-B ELIMINATED; bounded_correction_history recorded)
```

## Stop rules honored (per ACT §12)

  - No production semantic edits (§12 mandate).
  - No new tests written (§12 mandate).
  - No protocol expansion (§12 mandate).
  - Source diff for this ACT = **ZERO**.

The bounded correction is purely documentary (renames, headers, prose
revisions). No production code is touched.

## Halt acknowledgments

```
HALT_LIVE_QUALIFICATION_NOT_PERFORMED    = ACKNOWLEDGED
  Cloud Agent context cannot re-run the workload (no LLM credential,
  no live extension host, no Playwright per global CLAUDE.md note).

HALT_RUNTIME_CONSERVATION_REGRESSION     = NONE
  Runtime counts match the LIVE_RAW operator upload
  (terminal_committed=1, wake_created=1, task_completion_committed=1,
   submit_and_exit_seen=2 with both origins=pending_prompt_drain,
   wake C4->C8 jobId identical = cmd_mugvhy92x7rm527e).

HALT_OWNERSHIP_CORRELATION_NOT_SUFFICIENT = N/A
  BCCOC01 already closed this.

HALT_LIVE_EVIDENCE_CONTRADICTS_CLASSIFICATION = TRIGGERED -> CLOSED
  (twenty-fourth reviewer verdict; round-1 bounded correction applied)

HALT_RAW_LIVE_TRACE_NOT_INGESTED         = TRIGGERED -> CLOSED
  (twenty-fifth reviewer verdict; round-2 bounded correction applied;
   raw trace ingested byte-identical as 01a-ccard.LIVE_RAW.jsonl)

CAPTURE_INSUFFICIENT                     = TRIGGERED
  (twenty-fourth reviewer verdict; HOLD pending operator-supplied
   persisted-message dump for taskId=1790335441241_5g7oe)
```
