# ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01

PRIMARY PURPOSE: live reproduction / presentation-surface classification

## BOUNDED CORRECTION STATUS

This ACT was REVISED by a bounded correction after the twenty-fourth
reviewer verdict **HALT_LIVE_EVIDENCE_CONTRADICTS_CLASSIFICATION**.

Two P0s were closed by this correction:

  **P0-A  Evidence-quality promotion.**
  The file previously committed as `01a-ccard.jsonl` was a
  Cloud-Agent-synthetic trace mislabeled as raw operator upload.
  It has been renamed to `01a-ccard.NORMALIZED_DERIVED.jsonl` and
  provenance has been disclosed in:
    - `00-raw-trace-status.md` (new file in this ACT's evidence dir)
    - `01a-ccard.NORMALIZED_DERIVED.meta.md` (new sibling meta file)

  **P0-B  Internal contradiction.**
  The previous recon §5 + 03-presentation-map entry for UI-D claimed
  `PROVEN-SUPPRESSED_BY_BCCOC01` (persisted=false), but the canonical
  UI enumeration (01c-ui.txt) explicitly listed UI-D as a SECOND
  visible green COMPLETED card alongside UI-F. The UI enumeration is
  now treated as authoritative; UI-D binding is re-opened as
  `UNPROVEN_PENDING_PERSISTED_BINDING`.

The verdict has flipped from `PASS_PRESENTATION_SURFACES_CLASSIFIED_MULTI_PROJECTION`
(PS-A) to **CAPTURE_INSUFFICIENT** (verdict_status `HALT_CAPTURE_INSUFFICIENT`).
ROOT_PRESENTATION_CLASS is `UNRESOLVED`. REPAIR_AUTHORIZED remains
`FALSE`. No production semantic edits. The runtime cardinality verdict
remains `PASS` (based on the synthetic trace's lifecycle-shape match
to the ACT contract; this is structural, not authoritative).

The operator follow-up has been EXPANDED: in addition to the
previously-required live verification of the rendered webview, the
operator must now also supply a persisted-message dump for the
specimen session so that UI-D and UI-F can be bound to specific
persisted rows.

The body below reflects the BOUNDED-CORRECTION state. The previous
PS-A verdict is retained as a remainder branch (see §Classification
remainder) but is NOT the current verdict.

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
WAKE_CARDINALITY        = HEALTHY (structural only)
RUNTIME_CARDINALITY     = PASS (structural only)
UI-D PRODUCER           = UNPROVEN_PENDING_PERSISTED_BINDING
UI-F PRODUCER           = UNPROVEN_PENDING_PERSISTED_BINDING
RAW_LIVE_TRACE_PRESERVED = NO
VERDICT                 = CAPTURE_INSUFFICIENT
VERDICT_STATUS          = HALT_CAPTURE_INSUFFICIENT (twenty-fourth reviewer)
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

## Conservation (ACT §11, structural only)

```
WAKE_CARDINALITY        = HEALTHY (structural; synthetic-trace derived)
EXECUTION_CARDINALITY   = EXPLAINED (structural)
WAKE_C4_C8_CORRELATION  = identical (J on seq 4..10)
TASK_COMPLETION_COMMIT  = 1 (synthetic-trace derived)
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
CLOSURE_HEAD                = (to be set by this bounded-correction commit)
VSIX                        = dist/clinemm-4.1.16-baacc122a.vsix (bit-identical to BCCOC01)
```

The dogfood_source_head equals implementation_subject_head because the
VSIX is built from subject_head and the same VSIX is being dogfooded
in this ACT. The closure_head commits between BCCOC01 and this ACT are
evidence-only (the bounded correction commits) and do not change the
VSIX.

## Factory Cursor (ACT §17)

```
PREDECESSOR                = PASS_COMPLETION_OWNERSHIP_CORRELATION_CODE_QUALIFIED (BCCOC01)
RUNTIME_CARDINALITY        = HEALTHY (structural)
JOB_CORRELATION            = HEALTHY
PRESENTATION_MAP           = UI-A/B/C/E: PROVEN_VIA_PRODUCER | UI-D/UI-F: UNPROVEN_PENDING_PERSISTED_BINDING
ROOT_PRESENTATION_CLASS    = UNRESOLVED
REPAIR_AUTHORIZED          = FALSE
NEXT                       = Operator must (a) dump persisted clineMessages for the specimen
                             session, (b) bind each operator-visible green COMPLETED card to a
                             persisted row, (c) apply the classification.remainder branches.
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
  00-raw-trace-status.md                       (NEW: provenance disclosure)
  01-live-specimen.md                          (REVISED: bounded correction header + revised verdict)
  01a-ccard.NORMALIZED_DERIVED.jsonl           (RENAMED from 01a-ccard.jsonl)
  01a-ccard.NORMALIZED_DERIVED.meta.md         (NEW: provenance label)
  01b-ccard-counters.json                      (REVISED: provenance header)
  01c-ui.txt                                   (AUTHORITATIVE UI enumeration; lists 2 green COMPLETED cards)
  01c-ui.png                                   (REMOVED; was actually ASCII text, not a PNG)
  02-recon.md                                  (REVISED: §3 neutral walkthrough; §5 retired; §7 expanded operator follow-up)
  03-presentation-map.jsonl                    (REVISED: UI-D + UI-F marked UNPROVEN)
  04-focused-gates.txt                         (REVISED: classification gates + halts updated)
  result.json                                  (REWRITTEN: CAPTURE_INSUFFICIENT; ROOT_PRESENTATION_CLASS=UNRESOLVED)
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
  Runtime counts match the synthetic trace's lifecycle-shape contract
  (terminal_committed=1, wake_created=1, task_completion_committed=1).

HALT_OWNERSHIP_CORRELATION_NOT_SUFFICIENT = N/A
  BCCOC01 already closed this.

HALT_LIVE_EVIDENCE_CONTRADICTS_CLASSIFICATION = TRIGGERED -> CLOSED
  (twenty-fourth reviewer verdict; bounded correction applied)

CAPTURE_INSUFFICIENT                     = TRIGGERED
  (twenty-fourth reviewer verdict; HOLD pending operator-supplied
   persisted-message dump)
```
