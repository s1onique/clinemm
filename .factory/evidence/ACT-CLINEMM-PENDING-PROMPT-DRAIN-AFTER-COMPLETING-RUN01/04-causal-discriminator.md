# 04-causal-discriminator.md

## Causal discriminator (per ACT §9)

### Case A — queue during an ordinary non-completing turn

The enqueue happens via `runTurn({delivery: "queue"})` while the gate is closed.
After the gate opens and a fresh user turn runs to completion, the post-turn
drain microtask at `local-runtime-host.ts:1268` fires. The drain dequeues the
prompt and dispatches the continuation. **DRAINS**.

### Case B — queue because BCB intercepted a successful submit_and_exit

The BCB barrier's `enqueueCompletionContinuationIfHeld` fires from
`handleSessionEvent` inside `agent.emit("run-finished")` (which runs inside
`runtime.run()`). The BCB chain calls `sdkHost.send({delivery: "queue"})` which
recursively enters `LocalRuntimeHost.runTurn` -> queue/steer short-circuit ->
`pendingPromptsController.enqueue`. The `scheduleDrain` check
`!session.agent.canStartRun()` returns FALSE at this point (the user's turn is
still in flight, `session.running === true`), so the drain is NOT scheduled by
the BCB chain.

When the user's `runtime.run()` returns, the orchestrator's `finally` block sets
`session.running = false`. Then `runTurn` line 1268 queues the post-turn drain
microtask. After `completeInteractiveTurn` resolves, the drain microtask fires.
`canStartRun() === true`. Drain dequeues the prompt.

**The drain SHOULD fire in production code**, and the bridge test
PPRD-01-BRIDGE / PPRD-02-BRIDGE verify this. Both pass.

## Interpretation

The production code, as analyzed, drains the queued prompt. The bridge tests
demonstrate that. The live defect observed counter state
(`pending_prompt_dequeued=0`) was not reproduced in this ACT's RED.

This ACT closes with verdict `NO_PRODUCTION_CHANGE_NEEDED`. The two new tests
remain as a regression lock against future changes to the drain scheduling
order.

The live defect, if real, would require a separate reproduction strategy that
captures the exact runtime state at the time of the BCB chain's `scheduleDrain`
call. Possible non-exhaustive causes not covered by this ACT:

1. The runtime's `running` flag was NOT cleared at the time of the post-turn
   drain microtask (e.g., the orchestrator's finally block threw an exception
   that was swallowed).
2. `session.aborting === true` at the time of the drain (an explicit abort
   was issued between BCB enqueue and drain).
3. A SECOND `runTurn` call (from a parallel session or user input) raced with
   the BCB chain and altered the session state.
4. The `PendingPromptsController` was constructed with a different
   `getSession`/`send`/`emit` adapter that diverged from production wiring.

All four hypotheses would require LIVE capture evidence to confirm; this ACT
does not have access to that evidence (the sessionId
`1790544756725_zx4dj` has no JSONL captures on the local filesystem).
