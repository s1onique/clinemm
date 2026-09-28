# 02b-ordering-analysis.md

## Ordering analysis (two scenarios)

### Ordering A (BCB enqueue first, then turn-done)

```
1. submit_and_exit tool executes in agent loop
2. finishRun("completed") — state.status = "completed"
3. emit("run-finished") — synchronously fires listener
4. Listener calls handleSessionEvent(event).catch(...) — promise detached
5. handleSessionEvent runs synchronously until await zeroCostPromise (line 961)
6. Microtask yield. emit returns. runtime.run() returns.
7. orchestrator's finally: unsubscribe(), await activeTrackerWork, this.running=false
8. executeRunInternal returns. executeAgentTurn returns. executeTurn returns.
9. runTurn receives result. fires agent_turn_done. awaits completeInteractiveTurn.
10. markTurnIdle yields.
11. handleSessionEvent's microtasks resume: BCB enqueue fires.
12. enqueueCompletionContinuationIfHeld calls sdkHost.send({delivery:"queue"})
13. sdkHost.send awaits a chain — eventually calls LocalRuntimeHost.runTurn with delivery:"queue"
14. runTurn's queue/steer branch: pendingPromptsController.enqueue
15. service.enqueue + emitPrompts + onEnqueue + scheduleDrain
16. scheduleDrain checks canStartRun() — running=false now → returns TRUE
17. scheduleDrain queues drain microtask
18. Eventually the drain microtask fires: drain dequeues prompt and dispatches send
```

Expected: enqueue=1, dequeue=1, dispatched=1. THIS IS GREEN.

### Ordering B (turn-done first, then BCB enqueue)

If somehow the BCB chain's microtasks fire AFTER runTurn's post-turn drain microtask:
```
1-10. (same as A)
11. completeInteractiveTurn returns. session.aborting = false.
12. runTurn's line 1268 queues post-turn drain microtask
13. Post-turn drain microtask fires — but queue is empty (BCB hasn't enqueued yet)
14. drain() returns with no-op
15. Eventually the BCB chain's microtasks fire — enqueue + scheduleDrain
16. scheduleDrain checks canStartRun() — true → queues drain microtask
17. Drain microtask fires — dequeues + dispatches
```

Expected: enqueue=1, dequeue=1, dispatched=1. THIS IS GREEN.

So why does the live defect show dequeue=0?

## Hypothesis: lost wakeup at the run-ownership boundary

The race is NOT between "BCB enqueue first" and "turn-done first". Both orderings produce green in the static analysis above.

The actual race is something else: **when the run ends, the BCB enqueue happens inside the same microtask tick that the run's runtime listener cleanup unwinds, and one of them cancels the drain microtask before it fires.**

Or, more likely:

**The BCB enqueue's scheduleDrain bails (canStartRun()==false at the moment of the BCB enqueue because we're still INSIDE runtime.run()), AND the post-turn drain microtask at line 1269 is queued in the wrong microtask position relative to the BCB enqueue's `enqueue` call.**

In ALL cases analyzed, dequeue should be ≥1.

**So why does the live defect show dequeue=0?**

Hypothesis: the BCB enqueue never fires in the first place because the `run-finished` event is not emitted with the expected payload, OR the BCB barrier never registers, OR the BCB chain's `enqueueCompletionContinuationIfHeld` returns `no_callback` / `not_held` for some reason.

Or — and this is the new hypothesis — **the BCB enqueue's scheduleDrain bails because `session.aborting === true` at the time of enqueue**. This can happen if:
- The submit_and_exit tool internally calls `abort()` or sets `aborting=true`
- The runtime loop's run-finished event fires while `aborting` is still true

## Critical missing piece: deterministic ordering control

The previous ACT's bridge tests do NOT exercise the BCB chain. They call `host.runTurn(...)` to enqueue + a separate `host.runTurn(...)` to trigger. This is **NOT** the BCB ordering.

To reproduce BOTH orderings deterministically, we need:
- A way to enqueue a prompt DURING an active run (mirroring the BCB chain)
- A way to force the BCB enqueue to happen BEFORE the run ends
- A way to force the BCB enqueue to happen AFTER the run ends
- A way to observe the exact intermediate state (queueLength, drainingPendingPrompts, running, etc.) at each microtask hop

The test must drive the REAL PendingPromptsController + LocalRuntimeHost + SessionRuntime chain. NOT a mock.

## Architecture summary

- @cline/core owns stateful session orchestration (ActiveSession lifecycle, drain scheduling, queue persistence)
- @cline/agents owns the stateless run loop (runtime.run resolves with AgentResult, emits run-finished event)
- A successful completesRun tool ends the agent loop synchronously
- The runtime emits run-finished synchronously (listener fire is sync, event handler is async)
- The host owns the post-turn drain microtask at line 1269
- The PendingPromptsController owns the canStartRun gate at line 414
- Both scheduleDrain (from enqueue) and runTurn's post-turn drain microtask converge on canStartRun()

The invariant must be:
  queue non-empty AND session idle (no active run) AND session not aborting
  ⇒ eventually exactly one drain attempt is scheduled

This invariant is NOT guaranteed by the current code if:
- The BCB chain enqueue's scheduleDrain bails AND
- The post-turn drain microtask at line 1269 is queued in the wrong tick

## Repair target (preferred)

A single bounded ownership handoff: an idempotent `requestPendingPromptDrain(sessionId)` primitive that:
- Checks: queue non-empty AND no active run AND not already draining AND session valid AND not aborting
- Schedules a drain microtask ONCE
- Is called from BOTH the enqueue path AND the turn-done path

This makes the missing-wakeup guarantee explicit and provable.

Production delta budget: 1 file (PendingPromptsController.scheduleDrain or a new method on ActiveSession), 1 focused test file.