# ACT-CLINEMM-C10-FILTER-ABLATION01 — Decision

## RESULT: C10_NECESSARY = TRUE

The C10 message-layer completion_result filter IS load-bearing. It cannot
be removed without regressing the message/presentation-layer cardinality
invariant that is independent of the framework-level completion-commit
barrier (SEAM B).

## KEY DISCRIMINATOR

`C10-ABLATION-01-NOTIFY-OFF` is the load-bearing test. With the C10
filter DISABLED but the framework barrier (SEAM B) enabled:

  - notify-owned J is launched, marker registered
  - originating turn attempts completion
  - SEAM B sees no wake delivered, ALLOWs the lifecycle commit
  - C10 OFF -> completion_result row is NOT stripped from result.messages
  - The completion_result row reaches `appendAndEmit` and is persisted

Result with C10 OFF: 1 extra persisted completion_result row from the
originating turn. This row would NOT have been filtered by SEAM B
because SEAM B only governs `setTurnPhase("completed", ...)`, NOT the
message batch that flows through `appendAndEmit`.

## LOAD-BEARING INVARIANT

```
C10 protects message-layer completion_result row cardinality when
SEAM B ALLOWs the lifecycle commit but the originating turn's
completion_result row should still be suppressed because the wake-
driven turn is the canonical terminal-completion authority for the
notify-owned job.

Without C10 (SEAM A OFF), the originating turn's completion_result row
is emitted regardless of which turn owns the wake-driven completion.
```

## WHY THIS IS NOT REDUNDANT WITH SEAM B

The two layers protect distinct invariants:

| Layer | What it governs | Failure mode if absent |
|---|---|---|
| SEAM B (framework) | `setTurnPhase("completed", ...)` | Task phase would advance to "completed" twice |
| SEAM A (message filter) | `result.messages` reaching `appendAndEmit` | One extra `say:"completion_result"` row per originating turn that is suppressed for the wake-driven turn to take over |

When SEAM B holds the lifecycle commit (wake-driven turn owns completion),
the originating turn's `done` event still flows through `result.messages`
containing the `say:"completion_result"` row. SEAM A strips it. SEAM B
does NOT.

If SEAM A is removed:

  - In the wake-driven case (wake delivered): SEAM B holds the lifecycle
    commit; the originating turn's completion_result row leaks through.
    The wake-driven turn later emits its own row. Result: 2 visible
    completion boxes for one logical terminal event.

  - In the fast-exit case (marker consumed, no wake): SEAM B ALLOWs the
    lifecycle commit; the originating turn's completion_result row
    leaks through. Result: same as today (1 visible box). No regression.

  - In the lost-wake case (dispatch FAILED): SEAM B ALLOWs the
    lifecycle commit; the originating turn's completion_result row
    leaks through. Result: same as today (1 visible box). No regression.

So the regression is specifically in the WAKE-DRIVEN case, which is the
canonical notify-owned background job lifecycle.

## ABLATION EVIDENCE SUMMARY

| Test | SEAM A | Outcome | Framework commits | completion_result rows | Visible boxes |
|------|--------|---------|--------------------|----------------------|---------------|
| C10-ABLATION-01-NOTIFY-ON | ON | SUPPRESSED | 0 | 0 | 0 |
| C10-ABLATION-01-NOTIFY-OFF | OFF | LEAKS | 1 | 2 | 1 |
| C10-ABLATION-01-NOTIFY-OFF-MULTI | OFF | LEAKS (per-job isolation lost) | 0 | 2 | 1 |
| C10-ABLATION-02-NON-NOTIFY | OFF | UNCHANGED | 1 | 2 | 1 |
| C10-ABLATION-03-LOST-WAKE | OFF | UNCHANGED | 1 | 2 | 1 |
| C10-ABLATION-04-FAST-EXIT | OFF | UNCHANGED | 1 | 2 | 1 |
| C10-ABLATION-05-MULTI-JOB-ON | ON | SUPPRESSED | 0 | 0 | 0 |
| C10-ABLATION-05-MULTI-JOB-OFF | OFF | LEAKS | 0 | 2 | 1 |

The leak in NOTIFY-OFF (when wake-driven turn owns completion in
production) is the load-bearing regression.

## PRODUCTION DECISION

`C10_NECESSARY = TRUE`

`PROTECTED_INVARIANT = "prevents second persisted completion_result row while framework phase completion remains exactly one"`

`PRODUCTION_CHANGE = { removed_c10: false }`

No production code changed in this ACT. C10 message filter is retained
because the ablation proved it protects an independent presentation
invariant.

## HALTS

No new P0 exposed. No halts triggered.

## FOLLOWUP

None required. The C10 message filter is load-bearing and is retained.
The framework-level completion-commit barrier (SEAM B) is independently
load-bearing and continues to be enforced at `setTurnPhase("completed", ...)`.

The two layers are NOT redundant. They protect different invariants and
both must remain.

