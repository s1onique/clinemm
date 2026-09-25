00-raw-trace-status.md
======================

REVISED per twenty-fifth reviewer verdict
HALT_RAW_LIVE_TRACE_NOT_INGESTED, then revised again per
twenty-sixth reviewer verdict HALT_SUBMIT_AND_EXIT_ORIGIN_MISINTERPRETED.

Round 2 (twenty-fifth) ingested the raw operator-uploaded live CCARD
trace byte-identical. Round 3 (twenty-sixth) retracts the round-2
inference that submit_and_exit_seen.origin identifies the execution
turn. The origin label is a diagnostic classification, NOT a proven
turn-identity assertion. See "Evidence rule" section below.

Purpose
-------
Disclose the provenance of the trace used in this ACT so that no
reader can mistake a normalized / synthetic derivative for the
authoritative live evidence, and so that no reader can mistake a
diagnostic origin label for a proven causal turn identity.

Status of raw operator-uploaded JSONL (UNCHANGED from round 2)
-------------------------------------------------------------

**The raw operator-uploaded JSONL HAS been ingested into this ACT.**

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

Evidence rule (NEW, round 3; twenty-sixth reviewer)
---------------------------------------------------

```
submit_and_exit_seen.origin
  = diagnostic origin classification
  != proven run-turn identity
```

The `origin` field on a JSONL record labels what diagnostic path
produced the record, not which Cline / SDK turn causally owns the
record. Two submit_and_exit_seen records in this session both carry
`origin="pending_prompt_drain"`, but that does NOT prove both belong
to the later `pending_prompt_drain` turn. Provenance labels and
causal turn identity are different concepts and must not be
conflated. This is the Factory distinction the ACT has been
protecting throughout its history.

Round-3 chronology of submit_and_exit_seen events (from LIVE_RAW)
-----------------------------------------------------------------

```
seq 1   at=1790335441430  run_turn_started(explicit_user)
seq 2   at=1790335474709  terminal_committed         origin=background_terminal
seq 3   at=1790335474710  notify_consume_enter       origin=background_terminal
seq 4   at=1790335474711  pending_prompt_enqueued    origin=pending_prompt_drain
seq 5   at=1790335474711  wake_created               origin=background_terminal
seq 6   at=1790335477643  submit_and_exit_seen       origin=pending_prompt_drain
seq 7   at=1790335477708  agent_turn_done            origin=explicit_user
seq 8   at=1790335477709  pending_prompt_dequeued    origin=pending_prompt_drain
seq 9   at=1790335477709  continuation_scheduled     origin=pending_prompt_drain
seq 10  at=1790335477709  run_turn_started(pending_prompt_drain)
seq 11  at=1790335481227  submit_and_exit_seen       origin=pending_prompt_drain
seq 12  at=1790335481227  task_completion_committed  origin=pending_prompt_drain
seq 13  at=1790335481256  agent_turn_done            origin=pending_prompt_drain
```

Labeled:

```
seq 6 (at=1790335477643):
  CHRONOLOGICALLY_ASSOCIATED_WITH_EXPLICIT_USER
  NOT_CAUSALLY_BOUND
  Reason: seq 6 at=1790335477643 falls chronologically INSIDE the
  explicit_user turn interval (run_turn_started seq 1 at=1790335441430
  ... agent_turn_done seq 7 at=1790335477708). It is 65 ms BEFORE
  pending_prompt_dequeued seq 8 at=1790335477709 (the start of the
  pending_prompt_drain turn). The origin label says
  "pending_prompt_drain"; the wall-clock chronology says the
  event happened during the explicit_user turn. The label and
  the chronology are not equal. The chronology is sufficient to
  establish that seq 6 is not causally executed by the later
  pending_prompt_drain turn; causal identity beyond that is
  NOT proven.

seq 11 (at=1790335481227):
  CHRONOLOGICALLY_ASSOCIATED_WITH_PENDING_PROMPT_DRAIN
  NOT_CAUSALLY_BOUND
  Reason: seq 11 at=1790335481227 falls chronologically INSIDE the
  pending_prompt_drain turn interval (run_turn_started seq 10
  at=1790335477709 ... agent_turn_done seq 13 at=1790335481256).
  Also: seq 12 task_completion_committed at=1790335481227 is
  exactly 0 ms after seq 11, which is strong (though not
  dispositive) evidence that seq 11 is the completion-tool
  observation for the pending_prompt_drain turn.
```

Consequence for round-2 inference (RETRACTED in round 3)
--------------------------------------------------------

Round 2 claimed (incorrectly under the evidence rule above):

> submit_and_exit_seen=2 with both origin=pending_prompt_drain
> proves the explicit_user turn did NOT call the completion tool
> and did NOT emit a say="completion_result" row.
> Therefore D.1, F.2, and PS-B are ELIMINATED.

Round 3 retracts that chain of inference. The corrected reading is:

  - submit_and_exit_seen=2 is LIVE.
  - submit_and_exit_seen=2 with both `origin="pending_prompt_drain"`
    is LIVE.
  - The wall-clock chronology of submit_and_exit_seen records
    relative to run_turn_started / agent_turn_done records is LIVE.
  - From the chronology, seq 6 is chronologically inside the
    explicit_user turn and seq 11 is chronologically inside the
    pending_prompt_drain turn.
  - From the chronology alone, we CANNOT conclude "only one
    completion_result exists". Two completion_results — one per
    turn — remains consistent with the LIVE trace.
  - We CANNOT eliminate D.1, F.2, or PS-B on the basis of the
    submit_and_exit_seen origin labels.
  - We CANNOT promote them either, because the chronology does
    not by itself prove causal turn-identity.

Restored candidate set after round 3:

```
UI-D:
  D.1 completion_result from explicit_user turn       POSSIBLE  (round 3 restore)
  D.2 badged text row from resolveTerminalReportFraming POSSIBLE
  D.3 phantom projection of wake turn's completion_result POSSIBLE
  D.4 terminal_card re-rendered with badge after wake POSSIBLE

UI-F:
  F.1 wake turn's completion_result (seq 11)           POSSIBLE
  F.2 second completion_result interpretation         POSSIBLE  (round 3 restore)

PS-A / PS-B / PS-C / PS-D / PS-E:
  UNRESOLVED  (no branch can be selected without persisted
               message binding)
```

What is now actually proven (LIVE; round 2; unchanged in round 3)
-----------------------------------------------------------------

  - RUNTIME_CARDINALITY        = LIVE (computed from the raw
                                    operator-uploaded JSONL; not
                                    from the synthetic derivative)
  - WAKE_CARDINALITY           = LIVE (1 wake_created; 1 pending_
                                    prompt_enqueued; 1 pending_
                                    prompt_dequeued; 1 continuation_
                                    scheduled; all on
                                    cmd_mugvhy92x7rm527e)
  - C4->C8 jobId correlation   = LIVE (identical: cmd_mugvhy92x7rm527e
                                    on seq 4,5,8,9,10)
  - RUN_TURN_STARTED           = LIVE (2; explicit_user at seq 1 +
                                    pending_prompt_drain at seq 10)
  - AGENT_TURN_DONE            = LIVE (2; explicit_user at seq 7 +
                                    pending_prompt_drain at seq 13)
  - SUBMIT_AND_EXIT_SEEN       = LIVE (2 records; one chronologically
                                    inside explicit_user turn, one
                                    chronologically inside
                                    pending_prompt_drain turn;
                                    causal turn identity NOT proven
                                    by origin label)
  - TASK_COMPLETION_COMMITTED  = LIVE (1; seq 12 at=1790335481227,
                                    exactly 0 ms after seq 11)
  - PRESENTATION_CLASS         = UNRESOLVED (cannot classify
                                    PS-A / PS-B / PS-C / PS-D / PS-E
                                    without binding the two visible
                                    green COMPLETED cards to actual
                                    persisted Cline messages)
  - UI-D PRODUCER              = UNPROVEN_PENDING_PERSISTED_BINDING
                                    (4 candidates POSSIBLE: D.1, D.2,
                                    D.3, D.4)
  - UI-F PRODUCER              = UNPROVEN_PENDING_PERSISTED_BINDING
                                    (2 candidates POSSIBLE: F.1, F.2)
  - RAW_LIVE_TRACE_PRESERVED   = YES (ingested in round 2)
  - SUBMIT_EXIT_TURN_BINDING   = UNPROVEN (origin label not equal to
                                    causal turn identity)
  - REPAIR_AUTHORIZED          = FALSE

Required operator inputs to re-open (UNCHANGED)
----------------------------------------------

  - The persisted Cline messages (`clineMessages`) for the specimen
    session `taskId=1790335441241_5g7oe`, either as a JSON dump or
    a `cat` of the relevant
    `~/.cline/data/tasks/<taskId>/messages.json`. The operator
    should identify:
      * ALL `say="completion_result"` rows (record count, not
        assumption of 1);
      * their `text` field, `partial` flag, and
        `isAuthoritativelyCompletedResult` flag;
      * the persisted-message id / timestamp of each;
      * the persisted-message id / timestamp of each `say="text"`
        row near a "Completed" badge;
      * the persisted-message id / timestamp of the terminal_card
        re-render candidate (D.4).

  - The persisted SDK conversation history (`apiConversationHistory`)
    for the same session, so the wake turn's assistant turn can be
    cross-referenced.

  - The webview-side `extensionState.clineMessages` snapshot if it
    differs from the persisted one (rare but possible if a save was
    lost).

Once these are supplied, the ACT can be re-opened with bounded
scope: bind each green COMPLETED card to a specific persisted
message record, then classify using the four branches above.

Status of round 3 bounded correction
------------------------------------

This bounded correction (twenty-sixth reviewer verdict):

  - KEEPS the raw files and LIVE cardinality upgrades exactly as
    ingested in round 2.
  - RETRACTS the round-2 inference that
    `submit_and_exit_seen.origin` identifies the execution turn.
  - RESTORES D.1, F.2, and PS-B as POSSIBLE candidates.
  - ADDS the explicit evidence rule
    (`submit_and_exit_seen.origin != proven run-turn identity`).
  - RECORDS the round-3 chronology of both submit_and_exit_seen
    events and labels them
    CHRONOLOGICALLY_ASSOCIATED_WITH_EXPLICIT_USER /
    CHRONOLOGICALLY_ASSOCIATED_WITH_PENDING_PROMPT_DRAIN +
    NOT_CAUSALLY_BOUND.
  - KEEPS the reopen condition unchanged (persisted-message dump
    for taskId=1790335441241_5g7oe).
  - KEEPS VERDICT = CAPTURE_INSUFFICIENT.
  - KEEPS REPAIR_AUTHORIZED = FALSE.

No production code is modified.

END OF FILE
