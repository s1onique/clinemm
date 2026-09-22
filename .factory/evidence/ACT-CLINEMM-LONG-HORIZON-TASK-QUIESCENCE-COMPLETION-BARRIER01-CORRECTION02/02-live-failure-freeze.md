ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 / CORRECTION02 — LIVE FAILURE FREEZE
====================================================================================================

(Frozen reproduction per Factory reviewer's screenshots, 2026-09-23.)

## Single-job run

```text
T0 task active
T1 model emits run_commands(notifyOnCompletion=true) with sleep 30
T2 BackgroundNotifyCoordinator.registerMarker(J) registered
T3 model emits command_status(J) → observes terminal state
T4 Path B: command_status → resolveObligation(J) → marker deleted
T5 model invokes submit_and_exit (terminal_response committed)
T6 done agent event → setTurnPhase("completed", ..., "session-event-turn-complete-completed")
T7 phase = "completed" (BUG — wake machinery has not yet been neutralized)
T8 run_commands tool's terminalPromise for J resolves (microtask)
T9 BackgroundNotifyCoordinator.consumeTerminal(J) → marker is GONE → no_marker
    → NO wake is enqueued (the marker layer's first-writer-wins already
      correctly suppressed this) — but if the order is reversed...
T8' (alternate) terminalPromise.then() fired BEFORE step T3 → consumeTerminal(J)
    → marker present → enqueue wake (Path A wins at marker layer)
T9' (alternate) model observes command_status → resolveObligation(J)
    → marker is gone (Path A drained it) → no_marker
    → BUT the wake is still queued. NOBODY discards it.
T10' wake is dequeued by runTurn → autonomous turn starts
T11' model says "task was already completed in my previous turn"
T12' submit_and_exit → COMPLETED #2 (DUPLICATE COMPLETION)
```

## Critical insight

The user's LIVE evidence shows the SECOND order: `terminalPromise.then()`
fires FIRST (because the process exits before the model has a chance to
poll `command_status`), the wake is enqueued, THEN the model polls and
`resolveObligation` returns `no_marker`. The marker layer is
first-writer-wins. The WAKE layer is NOT. The completion barrier
correctly sees `pendingPromptsKnown > 0` and HOLDS, but in the
intervening moments between wake enqueue and wake consumption, the
runtime may still process the wake and start an autonomous turn that
re-commits COMPLETED.

The fix: when `resolveObligation` detects a previously-enqueued wake
for the same jobId, the coordinator MUST call a host-side discard seam
to remove the wake BEFORE runTurn consumes it.

## SECOND_STEP run (stronger case)

```text
T0 task active
T1 model starts notify=true job J with sleep 30
T2 marker registered
T3 model polls command_status, observes terminal (Path B in the same call window)
T4 SECOND_STEP executes (model has undeniably discharged the user's whole request)
T5 submit_and_exit → COMPLETED
T6 LATER: terminalPromise.then() fires → consumeTerminal(J) → no_marker
T7 NO second wake enqueued (current CORRECTION01 behavior preserves this)
T8 BUT: in alternate timing where consumeTerminal fires before the
    model's command_status, the wake IS queued and NOT arbitrated.
```

## Two-job run

```text
T0 task active
T1 model starts A and B both with notify=true
T2 registerMarker(A), registerMarker(B)
T3 A terminalizes first → consumeTerminal(A) → wake queued (Path A wins for A)
T4 model invokes submit_and_exit → barrier HOLDS (B is RUNNING, A has queued wake)
T5 ... but if A's wake is consumed first AND B's wake fires later,
    each generates its own autonomous turn → multiple completions
```

## Pre-fix versus post-fix

| Stage                                     | Pre-fix (TQCB01 / CORRECTION01)                       | Post-fix (CORRECTION02)                       |
|-------------------------------------------|------------------------------------------------------|--------------------------------------------------|
| Path A first, Path B second, wake queued  | wake is redundant → starts second turn              | wake discarded by discard seam → no second turn |
| Path B first, Path A second, no wake      | no wake enqueued → no second turn                    | no wake enqueued → no second turn (unchanged)   |
| Wake consumed first                       | continuation proceeds once → no second completion (Path A delivery) | unchanged                                      |
| notify=false                              | unaffected (no marker, no wake)                     | unaffected (no marker, no wake)                 |
| Two jobs A/B                              | wake arbitration is global (BUG)                    | wake arbitration is per jobId                   |