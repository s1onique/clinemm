# 01-live-red.md

## LIVE FAILURE=REAL (per ACT §2)

Fresh live evidence (per ACT body):
```
pending_prompt_enqueued    = 1
pending_prompt_dequeued    = 0
continuation_scheduled     = 0

run_turn_started          = 2
agent_turn_done           = 2

submit_and_exit_seen       = 1
task_completion_committed  = 0
```

## Failure shape

```
submit_and_exit
        ↓
BCB finalization prompt enqueued
        ↓
current run ends
        ↓
queue remains non-empty
        ↓
no dequeue
        ↓
no continuation
        ↓
no authoritative task completion
        ↓
UI remains Working / Cancel
```

## Classification

```
LIVE_FAILURE=REAL
BOUNDARY=PENDING_PROMPT_LOST_WAKEUP
```

## Why this ACT exists

The predecessor ACT (`ACT-CLINEMM-PENDING-PROMPT-DRAIN-AFTER-COMPLETING-RUN01`)
closed with verdict `NO_PRODUCTION_CHANGE_NEEDED` because its bridge tests
(PPRD-01-BRIDGE, PPRD-02-BRIDGE) PASS on the current production code.

That ACT also analyzed — but did NOT deterministically reproduce — the
"two orderings" hypothesis:

  Ordering A (enqueue first): enqueue → turn-done → drain
  Ordering B (turn-done first): turn-done → enqueue → drain

The predecessor ACT argued both should drain correctly in production because:

  - Both scheduleDrain (from enqueue) AND the runTurn post-turn drain
    microtask (line 1269) check `canStartRun()` before firing
  - `canStartRun()` flips to true only in the orchestrator's finally block
    AFTER `runtime.run()` resolves
  - Therefore, by the time the post-turn drain microtask fires, the
    BCB enqueue (which happened DURING the run) has already happened, and
    both drains coalesce on the same promise

But the live defect counter state shows otherwise. The fresh live evidence
shows:
  - enqueue=1 (BCB did enqueue)
  - dequeue=0 (NEITHER drain path fired)

This means at least one of these is true:
  (1) The orchestrator's `running=false` flip never happens at the
      post-turn drain microtask fire time
  (2) The BCB chain enqueue's scheduleDrain bails for a DIFFERENT
      reason than `canStartRun()` — e.g. `session.aborting=true`
  (3) The post-turn drain microtask at line 1269 is queued in the
      WRONG microtask order and gets cancelled before firing
  (4) The queue is mutated by another drain path that consumes the
      prompt before the captured counter fires

This ACT's job is to reproduce BOTH orderings deterministically and
isolate the load-bearing cause.