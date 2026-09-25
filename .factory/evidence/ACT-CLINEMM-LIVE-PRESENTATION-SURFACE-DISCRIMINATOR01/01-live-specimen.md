# 01-live-specimen.md

## Purpose
Frozen specimen for ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01
per §3 (specimen freeze) and §10 (identity split per twenty-third + 
twenty-fourth reviewer C1).

## BOUNDED CORRECTION (twenty-fourth reviewer verdict)

This file is REVISED to reflect the bounded correction after
twenty-fourth reviewer verdict HALT_LIVE_EVIDENCE_CONTRADICTS_CLASSIFICATION.
See `00-raw-trace-status.md` in this directory for the full disclosure
of the synthetic-trace provenance issue and the procedure for re-opening
this ACT.

Key changes from the previous version:
- UI-D binding flipped from PROVEN-SUPPRESSED to UNPROVEN
- UI-F binding flipped from PROVEN-VIA-SYNTHETIC-TRACE to UNPROVEN
- The "operator-uploaded CCARD trace" reference retired in favor of
  "NORMALIZED_DERIVED_FROM_LIVE synthetic trace"
- ROOT_PRESENTATION_CLASS flipped from PS-A to UNRESOLVED
- Verdict flipped from PASS_PRESENTATION_SURFACES_CLASSIFIED to
  CAPTURE_INSUFFICIENT
- Operator follow-up expanded to include a persisted-message dump
  requirement (not just live verification of the rendered webview)

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

## Source identity notes (per twenty-third reviewer C1)

The reviewer flagged that the prior ACT confused `extension_id` and
`version`. Per VS Code extension packaging: `extension_id` is
`${publisher.name}` (always `cline.cline` for our package), and
`version` is a separate manifest field (here `4.1.16`). The VSIX is
named `${publisher.name}-${version}-${commit}.vsix`. There is NO
property in the manifest called `extension_id` containing the version.
The identity split below is the corrected one.

Note: the implementation_subject_head and the closure_head differ
because the closure_head may have later evidence-only commits
(act + board updates). The VSIX is built from the
implementation_subject_head commit; the closure_head only records
the latest durable repository state.

```
IMPLEMENTATION_SUBJECT_HEAD   = baacc122aa3a9cb4afd1e1d139f269639a34fc3f
CLOSURE_HEAD                  = 020a4efbaa8fa196be39b074249d527c71735ad3 (prior cycle's commits, evidence-only)
                               (will be updated by this bounded-correction commit)
DOGFOOD_SOURCE_HEAD           = baacc122aa3a9cb4afd1e1d139f269639a34fc3f
```

The dogfood_source_head equals implementation_subject_head because the
VSIX is built from subject_head and the same VSIX is being dogfooded
in this ACT. Per twenty-fourth reviewer: "VSIX is bit-identical because
the closure_head commits between entries are evidence-only (and the
VSIX is not rebuilt)".

## Specimen content (UI surfaces the operator enumerated)

Per the canonical UI enumeration in `01c-ui.txt` (treated as 
authoritative after bounded correction; two green COMPLETED cards
are explicitly listed):

| UI id | Type | Visible text (abbrev.) | Producer candidate | Binding status |
|---|---|---|---|---|
| (user bubble) | user message | "Run this command in the background and notify me when it finishes." | webview UserMessage row | PROVEN_VIA_PRODUCER |
| UI-A | terminal card | "Ran sh -c ... + Backgrounded" | message-translator.ts:1801-1875 + ChatRow.tsx:251 | PROVEN_VIA_PRODUCER |
| UI-B | text row | "The command is running..." | message-translator.ts:1620-1629 | PROVEN_VIA_PRODUCER |
| UI-C | text row | "The command has finished. Output: ..." | message-translator.ts:1620-1629 | PROVEN_VIA_PRODUCER |
| UI-D | **green COMPLETED card #1** | "Ran sh -c ... in the background..." | UNPROVEN | UNPROVEN_PENDING_PERSISTED_BINDING |
| UI-E | text row | "The background command ... has completed successfully..." | message-translator.ts:1620-1629 | PROVEN_VIA_PRODUCER |
| UI-F | **green COMPLETED card #2** | "The background command completed successfully." | UNPROVEN | UNPROVEN_PENDING_PERSISTED_BINDING |

The previous cycle claimed UI-D was "PROVEN-SUPPRESSED_BY_BCCOC01"
(persisted=false). The UI enumeration directly contradicts that
claim. The bounded correction accepts the UI enumeration as
authoritative and re-opens UI-D (and UI-F) binding.

## Lifecycle trace provenance

The trace previously committed as `01a-ccard.jsonl` is a
**Cloud-Agent-synthetic trace**, not a raw operator upload. Its
identifiers are placeholders (sessionId=`s_live`, taskId=`t_live`,
jobId=`J`). The lifecycle shape it describes matches the contract
required by BCCOC01, so the **structural cardinality verdict**
(WAKE_CARDINALITY=HEALTHY, TASK_COMPLETION_COMMIT=1, etc.) still
holds, but **the trace is NOT authoritative** for any claim about
which specific persisted message produced UI-D or UI-F.

See `00-raw-trace-status.md` and `01a-ccard.NORMALIZED_DERIVED.meta.md`
for the full provenance disclosure.

## Classification verdict (UPDATED after bounded correction)

| Field | Previous (rejected) | Current |
|---|---|---|
| ROOT_PRESENTATION_CLASS | PS-A | UNRESOLVED |
| UI-D binding | PROVEN-SUPPRESSED_BY_BCCOC01 | UNPROVEN_PENDING_PERSISTED_BINDING |
| UI-F binding | PROVEN (synthetic-trace-derived) | UNPROVEN_PENDING_PERSISTED_BINDING |
| Verdict | PASS_PRESENTATION_SURFACES_CLASSIFIED_MULTI_PROJECTION | CAPTURE_INSUFFICIENT |
| Verdict status | PROVISIONAL_CODE_QUALIFIED | HALT_CAPTURE_INSUFFICIENT |
| REPAIR_AUTHORIZED | FALSE | FALSE |

## Operator follow-up (EXPANDED)

The previous cycle's operator follow-up was limited to live verification
of the rendered webview (verify UI-D is NOT visible; if visible, 
reclassify as PS-B). After bounded correction, the operator must also
provide a persisted-message dump for the specimen session so that
binding can be performed at the message-row level:

1. Dump `cat ~/.cline/data/.../<taskId>/messages.json` (or equivalent).
2. Enumerate all `say="completion_result"` rows; record message id,
   text, partial, isAuthoritativelyCompletedResult, turn origin.
3. Enumerate all `say="text"` rows that have a green "Completed" badge
   applied by `resolveTerminalReportFraming`.
4. Bind UI-D and UI-F to specific persisted rows.
5. Apply the classification.remainder branches in `result.json`.

If the dump reveals UI-D is a `say="completion_result"` row that
SURVIVED the C10 filter, then C10_DUPLICATION_PERSISTS_LIVE = true
and `C10-LIVE-OWNERSHIP-REPAIR01` is authorized.

If the dump reveals UI-D is a `say="text"` row with a green "Completed"
badge applied by `resolveTerminalReportFraming`, then a new
presentation-class (PS-C, currently unnamed) is opened and a separate
ACT is required to investigate the over-badging.

## File map

- `00-raw-trace-status.md` — provenance disclosure (NEW)
- `01-live-specimen.md` — this file
- `01a-ccard.NORMALIZED_DERIVED.jsonl` — renamed from 01a-ccard.jsonl
- `01a-ccard.NORMALIZED_DERIVED.meta.md` — provenance label (NEW)
- `01b-ccard-counters.json` — provenance-tagged counters
- `01c-ui.txt` — AUTHORITATIVE UI enumeration (operator-transcribed)
- `02-recon.md` — source-bound recon (revised)
- `03-presentation-map.jsonl` — machine-readable per-surface mapping (revised)
- `04-focused-gates.txt` — focused gates (revised)
- `result.json` — verdict + factory cursor (rewritten)
