ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 — LIVE FAILURE FREEZE
===================================================================================

Frozen reproduction of the LIVE defect pattern (per `01-entry-state.txt` §Fresh
LIVE evidence and the recon chain).

## Single-job LIVE pattern

```
T0 task active
T1 model emits run_commands(notifyOnCompletion=true) with sleep 30
T2 BackgroundNotifyCoordinator.registerMarker(J) registered
T3 model emits command_status(J) → observes terminal state
T4 model invokes submit_and_exit (terminal_response committed)
T5 done agent event → setTurnPhase("completed", ..., "session-event-turn-complete-completed")
T6 phase = "completed" (BUG)
T7 run_commands tool's terminalPromise for J resolves
T8 BackgroundNotifyCoordinator.consumeTerminal(J) → "drained"
T9 enqueueTerminalWake(PendingPromptsController) → wake queued
T10 LocalRuntimeHost.runTurn dequeues wake → next turn starts
T11 second autonomous turn → second submit_and_exit
T12 final phase remains "completed" but the model has now executed
    an EXTRA turn after the "task was already done"
```

## Multi-job LIVE pattern

```
T0 task active
T1 model starts A and B both with notify=true
T2 BackgroundNotifyCoordinator.registerMarker(A), registerMarker(B)
T3 A terminalizes first → consumeTerminal(A) drains, A RESOLVED
T4 model invokes submit_and_exit (terminal_response committed)
T5 done agent event → setTurnPhase("completed", ..., "session-event-turn-complete-completed")
T6 phase = "completed" (BUG — B is still RUNNING!)
T7 run_commands tool's terminalPromise for B resolves
T8 BackgroundNotifyCoordinator.consumeTerminal(B) → "drained"
T9 enqueueTerminalWake → wake queued
T10 second autonomous turn → duplicate completion
```

## Cross-session LIVE pattern (CTL-08)

```
T0 task-A active
T1 model starts jobId J with notify=true for task-A
T2 marker registered for (session-A, task-A)
T3 session-B starts (different task) → calls submit_and_exit
T4 task-A's outstanding J does NOT block session-B's completion
```

(Behavior verified in TQCB-CTL-07 / TQCB-CTL-08.)

## Cross-task LIVE pattern (CTL-07)

```
T0 task-A active
T1 model starts jobId J with notify=true for task-A
T2 marker registered for (session-X, task-A)
T3 task-B starts (same session, different task)
T4 task-B calls submit_and_exit
T5 task-A's outstanding J does NOT block task-B's completion
```

(Behavior verified in TQCB-CTL-07.)

## Pre-fix versus post-fix

| Stage | Pre-fix behavior | Post-fix behavior |
|-------|------------------|-------------------|
| T6 (single-job) | `completed` (premature) | held (deferredCompletionBarrier) |
| T6 (multi-job) | `completed` (premature, B still running) | held (B is unresolved) |
| T11/T12 | duplicate turn / duplicate submit_and_exit | blocked (marker is RESOLVED before completion commit) |
| Task-B submit_and_exit (cross-task) | `completed` | `completed` (no J from task-A) |
| Session-B submit_and_exit (cross-session) | `completed` | `completed` (no J from session-A) |
| Resolved J's late wake (race) | starts another turn | no_marker → discarded |
| Two distinct jobIds, both notified | one completion (race-dependent) | two legitimate terminal completions |