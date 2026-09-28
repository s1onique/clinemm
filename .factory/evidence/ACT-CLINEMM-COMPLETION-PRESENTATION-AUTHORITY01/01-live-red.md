# 01 — Live RED (transcript/UI chronology)

Observed during `ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01` (same real
session). The dogfood diagnostic/profile gates all passed, but the
transcript display showed:

```text
first ✓ Completed
↓
BCB finalization prompt:
  Held terminal observations: 2
↓
command_status ×2
↓
second ✓ Completed
```

Chronology (frozen):

| order | surface event                                                    | authority implication                                  |
|-------|------------------------------------------------------------------|--------------------------------------------------------|
| 1     | first ✓ Completed                                                | user-visible authoritative marker BEFORE authority     |
| 2     | runtime issues BCB finalization prompt (2 held observations)     | BCB barrier still holds (running OR unconsumed work)  |
| 3     | command_status ×2                                                | agent drains the held terminal facts                   |
| 4     | second ✓ Completed                                               | user-visible authoritative marker AFTER authority     |

The two markers correspond to two `submit_and_exit` calls for ONE logical
task (the BCB continuation path makes the second one necessary because the
first one was held). The defect is NOT duplicate authority (BCB held
correctly); it is duplicate PRESENTATION.

**Frozen classification (per ACT §2):**

```text
LIVE_DUPLICATE_VISIBLE_COMPLETION = REAL
LIVE_DOUBLE_AUTHORITATIVE_COMMIT = UNPROVEN
```

## Why this matters

The BCB/C10 framework authority machinery (BCB01, BCTPA01, BNCA01,
TQCB01, etc.) all worked end-to-end. The continuation substrate worked
(`pending_prompt_enqueued = pending_prompt_dequeued = continuation_scheduled = 1`).
What broke is the user-visible **completion box** appeared TWICE for ONE
authoritative task completion.

The downstream consequence the user observed:
- a "completed" affordance they could have acted on while the agent had
  not yet observed the held terminal facts
- a second "completed" affordance after the real authority transition,
  which visually looks like duplicate work

## What this ACT is NOT

- NOT a BCB scheduling fix. The continuation fired correctly.
- NOT a `command_status` consumer fix. The consumer drained correctly.
- NOT a duplicate-authority fix. Authority committed exactly once.
- NOT a `submit_and_exit` lifecycle fix. `completesRun=true` is the
  correct semantics for the upstream contract.
- NOT a semantic text dedupe. We do not hash/diff answer content.

## What this ACT IS

A targeted fix at the C10 message-layer **completion_result row filter**
in `sdk-session-event-coordinator.ts`. The filter that decides whether
to suppress `say:"completion_result"` from the persisted transcript
when the BCB barrier holds is consulted at the wrong predicate: it
only checks `hasActiveNotify` (notify markers) and the over-broad
`pendingPromptCount || activeNotifyCount` aggregate. It does NOT consult
the SAME predicates the BCB barrier at SEAM B already holds on:
`ownerStillRunningForC10` and `unconsumedOwnedTerminalResultsForC10`.

So when the held work is fire-and-forget background jobs that are
already terminal (notify=false, marker gone, but observations still
unconsumed), the message-layer filter passes the completion_result row
through and the user sees the premature ✓ Completed.