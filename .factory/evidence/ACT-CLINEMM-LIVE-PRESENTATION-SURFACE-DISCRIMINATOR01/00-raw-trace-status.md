00-raw-trace-status.md
======================

REVISED per twenty-fifth reviewer verdict
HALT_RAW_LIVE_TRACE_NOT_INGESTED. This bounded correction ingests
the raw operator-uploaded live CCARD trace that was attached to the
conversation but had not yet been ingested into the repository.

Purpose
-------
Disclose the provenance of the trace used in this ACT so that no
reader can mistake a normalized / synthetic derivative for the
authoritative live evidence.

Status of raw operator-uploaded JSONL (REVISED)
----------------------------------------------

**The raw operator-uploaded JSONL HAS been ingested into this ACT
in this bounded correction.**

The raw live CCARD trace was uploaded in the conversation context as
`~/Downloads/continuation-cardinality-authority.jsonl` and
`~/Downloads/continuation-cardinality-authority.counters.json`.
Both files have been copied byte-for-byte (verified via SHA-256)
into this ACT's evidence directory:

  - `01a-ccard.LIVE_RAW.jsonl`        (2037 bytes)
    SHA-256: d7302ae909596a21d48ff491661e5f2652e831b62928fc50db2fb4837dbd24f1
    Source:   ~/Downloads/continuation-cardinality-authority.jsonl
    Records:  13 (live wall-clock timestamps; epoch ms)
    sessionId = 1790335441241_5g7oe
    jobId     = cmd_mugvhy92x7rm527e
    taskId    = 1790335441241_5g7oe
    promptId  = pending_1790335474710_Reppe
    time span: 39826 ms (~40 s)

  - `01b-ccard-counters.LIVE_RAW.json` (1207 bytes)
    SHA-256: 2a82c0028ad4a39e78c54bcab01ce1502582d9994b555626584ee72f9ec892c1
    Source:   ~/Downloads/continuation-cardinality-authority.counters.json

No normalization, transcription, or modification was performed on
these files. They are byte-identical to the operator's upload
(verified via `diff -q`).

The previously-committed synthetic trace (now relabeled
`01a-ccard.SYNTHETIC_HYPOTHESIS_ONLY.jsonl`) is RETAINED as a
historical record of the prior cycle's hypothesis but is NOT
authoritative.

Why P0-A was only partially closed in the previous bounded correction
----------------------------------------------------------------------

The previous bounded correction (twenty-fourth reviewer verdict)
correctly noted that the file committed in this ACT as
`01a-ccard.jsonl` was a synthetic trace mislabeled as raw operator
upload. It then incorrectly claimed "no raw operator-uploaded JSONL
exists in this repository" and "RAW_SOURCE = NONE" /
"AUTHORITATIVE_LIVE_TRACE = MISSING".

The truth is that the raw trace WAS uploaded in the conversation
context but had not been ingested into the repository. The search
across `.factory/`, `.factory/tmp/`, and `/tmp` was correct for
those locations, but it failed to also check the operator's
`~/Downloads/continuation*` upload directory.

This second bounded correction (twenty-fifth reviewer verdict)
rectifies that omission.

What is now actually proven
---------------------------

  - RUNTIME_CARDINALITY        = LIVE (computed from the raw
                                    operator-uploaded JSONL; not
                                    from the synthetic derivative)
  - WAKE_CARDINALITY           = LIVE (1 wake_created; 1 pending_
                                    prompt_enqueued; 1 pending_
                                    prompt_dequeued; 1 continuation_
                                    scheduled; all on
                                    cmd_mugvhy92x7rm527e)
  - C4->C8 jobId correlation   = LIVE (identical: cmd_mugvhy92x7rm527e
                                    on seq 4, 5, 8, 9, 10)
  - TASK_COMPLETION_COMMIT     = LIVE (1 capture; seq 12)
  - TERMINAL_COMMITTED         = LIVE (1 capture; seq 2)
  - NOTIFY_CONSUME_ENTER       = LIVE (1 capture; seq 3)
  - RUN_TURN_STARTED           = LIVE (2; explicit_user at seq 1 +
                                    pending_prompt_drain at seq 10)
  - AGENT_TURN_DONE            = LIVE (2; explicit_user at seq 7 +
                                    pending_prompt_drain at seq 13)
  - SUBMIT_AND_EXIT_SEEN       = LIVE (2; BOTH with origin=
                                    pending_prompt_drain at seq 6 and
                                    seq 11; the explicit_user turn
                                    did NOT call the completion tool
                                    and therefore did NOT produce a
                                    say="completion_result" row)
  - PRESENTATION_CLASS         = UNRESOLVED (cannot classify
                                    PS-A / PS-B / PS-C / PS-D without
                                    binding the two visible green
                                    COMPLETED cards to actual
                                    persisted Cline messages)
  - UI-D PRODUCER              = UNPROVEN_PENDING_PERSISTED_BINDING
                                    (the LIVE trace's
                                    submit_and_exit_seen being on
                                    pending_prompt_drain twice means
                                    explicit_user did NOT emit a
                                    completion_result; UI-D must
                                    therefore be either badged text
                                    by resolveTerminalReportFraming
                                    (D.2), or something else entirely)
  - UI-F PRODUCER              = UNPROVEN_PENDING_PERSISTED_BINDING
                                    (most likely the wake turn's
                                    completion_result at seq 11, but
                                    needs persisted-message binding
                                    to confirm)
  - RAW_LIVE_TRACE_PRESERVED   = YES (ingested in this correction)
  - REPAIR_AUTHORIZED          = FALSE

Key insight from the LIVE trace that the synthetic trace obscured
----------------------------------------------------------------

The previous cycle's synthetic trace had
`submit_and_exit_seen = 2` with origins `[explicit_user, pending_
prompt_drain]`. The LIVE trace has `submit_and_exit_seen = 2` with
origins `[pending_prompt_drain, pending_prompt_drain]` (verified by
the operator-uploaded counters file).

This means **the explicit_user turn did NOT call the completion
tool**. It produced `agent_turn_done` at seq 7 without ever
emitting a `say="completion_result"` row. So UI-D (the first visible
green COMPLETED card) **cannot** be an explicit_user
`completion_result` row — that row simply does not exist in the
specimen session.

This significantly narrows the candidate producers for UI-D:

  - Candidate D.1 (completion_result SURVIVED C10) is ELIMINATED
    by the LIVE trace's `submit_and_exit_seen` pattern.
  - Candidate D.2 (badged text row from resolveTerminalReportFraming)
    becomes the PRIOR candidate.
  - A new candidate D.3 emerges: the wake turn's completion_result
    row (seq 11) is the only completion_result in the session, so
    UI-D could be a *phantom* projection — the same single row
    rendered twice by different webview consumers, or the webview
    receiving the row's update twice.
  - A new candidate D.4 emerges: the green COMPLETED card could be
    rendered from a non-completion_result surface (e.g. the
    `terminal_card` UI-A getting re-rendered with a "Completed"
    badge after wake).

Binding to persisted messages remains the only way to disambiguate.

Required operator inputs to re-open (UNCHANGED)
-----------------------------------------------

  - The persisted Cline messages (`clineMessages`) for the specimen
    session `taskId=1790335441241_5g7oe`, either as a JSON dump or
    a `cat` of the relevant
    `~/.cline/data/tasks/<taskId>/messages.json`. The operator
    should identify:
      * message id (or timestamp + sequence) of each
        `say="completion_result"` row (expected: exactly 1),
      * its `text` field,
      * its `partial` flag,
      * its `isAuthoritativelyCompletedResult` flag,
      * the turn that produced it (expected: pending_prompt_drain).

  - The persisted SDK conversation history (`apiConversationHistory`)
    for the same session, so the wake turn's assistant turn can be
    cross-referenced.

  - The webview-side `extensionState.clineMessages` snapshot if it
    differs from the persisted one (rare but possible if a save was
    lost).

Once these are supplied, the ACT can be re-opened with bounded
scope: bind each green COMPLETED card to a specific persisted
message record, then classify.

Status of this correction
-------------------------

This bounded correction:

  - Ingests the raw live JSONL as `01a-ccard.LIVE_RAW.jsonl`
    (byte-identical; SHA-256 verified).
  - Ingests the raw live counters as `01b-ccard-counters.LIVE_RAW.json`.
  - Renames the synthetic file to `01a-ccard.SYNTHETIC_HYPOTHESIS_ONLY.jsonl`
    with updated provenance label.
  - Recomputes `01b-ccard-counters.json` from the LIVE_RAW file.
  - Updates the recon / result / presentation-map / focused-gates /
    ACT body / epic board to reflect:
      - WAKE_CARDINALITY = LIVE (upgraded from STRUCTURAL)
      - RUNTIME_CARDINALITY = LIVE (upgraded from STRUCTURAL)
      - C4->C8 jobId = LIVE (upgraded from STRUCTURAL)
      - PRESENTATION_CLASS = UNRESOLVED (UNCHANGED; binding still
        requires persisted-message dump)
      - VERDICT = CAPTURE_INSUFFICIENT (UNCHANGED)
      - REPAIR_AUTHORIZED = FALSE (UNCHANGED)

No production code is modified.

END OF FILE
