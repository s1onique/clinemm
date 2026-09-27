# 02-recon.md

## PENDING_PROMPT_STORE

`sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`

Production classes:
- `PendingPromptsController` (line 298) - owns `service.enqueue(...)` (sync append)
- `PendingPromptService` (line 135) - pure-data enqueue/consumeSteer/shiftNext/requeueFront/clear

State: per-session `ActiveSession.pendingPrompts: PendingPromptEntry[]`.

## PENDING_PROMPT_ENQUEUE_SEAM

`PendingPromptsController.enqueue(sessionId, entry)` at line 329:
1. `service.enqueue(session, entry)` - pure-data append (dedupes by prompt equality)
2. `emitPrompts(session)` - emit `pending_prompts` event
3. Fire `onEnqueue` callback (C4 hook)
4. `scheduleDrain(sessionId, session)`

## PENDING_PROMPT_DRAIN_ENTRY

`PendingPromptsController.scheduleDrain(sessionId, session)` at line 409:

```ts
if (
  session.pendingPrompts.length === 0 ||
  session.aborting ||
  session.drainingPendingPrompts ||
  !session.agent.canStartRun()
) {
  return;
}
queueMicrotask(() => { void this.drain(sessionId); });
```

`PendingPromptsController.drain(sessionId)` at line 423: real shift+send loop.

## PENDING_PROMPT_DEQUEUE_SEAM

`PendingPromptsController.drain` line 432 -> `service.shiftNext(session)` then `emitPrompts` then `emitSubmitted` then `deps.send(...)`. C5 (`onBeforeDrain`) fires before the destructive shift; C6 (`onBeforeDispatch`) fires immediately before the actual `deps.send` call.

## PENDING_PROMPT_SCHEDULER_SEAM

Two bounded entry points in production:
1. `scheduleDrain` from `enqueue` (line 375)
2. `runTurn` post-turn drain microtask (`sdk/packages/core/src/runtime/host/local-runtime-host.ts:1268-1272`):
```ts
if (result.finishReason !== "error") {
  queueMicrotask(() => {
    void this.pendingPromptsController.drain(input.sessionId);
  });
}
```

There is NO third entry at the turn-shutdown boundary. The drain microtask is the only way to fire after a `completesRun` tool terminates the run.

## PENDING_PROMPT_REENTRANCY_GUARD

`session.drainingPendingPrompts` (boolean) is the reentrancy guard. Set to true on drain entry (line 455), reset in `finally` (line 518).

## PENDING_PROMPT_ACTIVE_RUN_GUARD

`session.agent.canStartRun()` returns `!this.running && !this.shutdownCalled` (`session-runtime-orchestrator.ts:520-522`). This is the load-bearing gate. The drain refuses to start a new agent run while one is active.

`SessionRuntime.running` is flipped to `false` in the orchestrator's `finally` block (`session-runtime-orchestrator.ts:1039`) after `runtime.run()` resolves and `await this.activeTrackerWork` settles.

## PENDING_PROMPT_SESSION_OWNER

Per-session. `PendingPromptsController` takes `deps.getSession(sessionId)` to look up `ActiveSession`.

## WHO_DRAINS_AFTER_EXPLICIT_USER_TURN

`LocalRuntimeHost.runTurn` post-turn drain microtask (line 1268). Fires AFTER `completeInteractiveTurn` resolves (which sets `session.aborting=false` and calls `markTurnIdle` -> `updateStatus("idle")`).

## WHO_DRAINS_AFTER_BACKGROUND_WAKE

Identical: same post-turn drain microtask. The wake-driven `runTurn` ends the same way as an explicit user turn.

## WHO_DRAINS_AFTER_PENDING_PROMPT_TURN

The pending prompt turn IS a `runTurn`. So same answer: post-turn drain microtask.

## WHO_DRAINS_AFTER_COMPLETES_RUN

**THIS IS THE LOAD-BEARING QUESTION.**

The completing run is the *same* runTurn that just executed `submit_and_exit`. The turn ends via:
1. `runtime.run()` resolves (after `finishRun("completed")` inside the agent loop)
2. `executeAgentTurn` returns
3. `runTurn` calls `await this.completeInteractiveTurn(session, result.finishReason)` (line 1259)
4. `runTurn` schedules post-turn drain microtask (line 1268)

The BCB barrier's `enqueueCompletionContinuationIfHeld` fires DURING `runtime.run()` (synchronous event-emit chain) via `SdkSessionEventCoordinator.handleSessionEvent` triggered by `agent.emit({type:"run-finished"})`. The continuation prompt is enqueued via `sdkHost.send({delivery:"queue"})` which routes back through `LocalRuntimeHost.runTurn` -> queue/steer short-circuit -> `pendingPromptsController.enqueue(...)`.

Critical question: does `pendingPromptsController.enqueue(...)` succeed AND does its `scheduleDrain` succeed BEFORE the user's original run relinquishes ownership?

- At the BCB microtask fire time (during `agent.emit("run-finished")`), `this.running === true` in the orchestrator. The BCB-triggered `runTurn` enters the queue/steer short-circuit and calls `pendingPromptsController.enqueue`. `scheduleDrain` sees `canStartRun() === false` -> bails. Prompt sits in the queue.
- After `runtime.run()` returns, the orchestrator's finally block sets `this.running = false`.
- `runTurn` post-turn drain microtask fires (line 1268). `canStartRun() === true`. Drain proceeds. Prompt is shifted and dispatched.

This SHOULD work in the simple case. But the live defect shows zero dequeues. Why?

The reason is that for the BCB barrier CORRECTION04 path (terminal-idle re-evaluation), the BCB barrier's `enqueueCompletionContinuationIfHeld` fires from `reevaluateDeferredCompletionBarrier`. That callback is invoked from `maybeReevaluateDeferredContinuation` (in SdkController.ts:4979, called from `updateBackgroundCommandState`).

The chronology: at the time the background command transitions to terminal and `reevaluateDeferredCompletionBarrier` runs, the agent has ALREADY completed the user's submit_and_exit turn. So `this.running === false`. So `canStartRun() === true`. So the BCB-triggered `enqueue` call SHOULD succeed at scheduling its drain.


## ROOT_CAUSE_HYPOTHESIS

The BCB barrier's CORRECTION03 trigger fires the continuation enqueue from inside `handleSessionEvent`. The BCB chain is async (`sdkHost.send` -> `vscode-session-host.send` -> `LocalRuntimeHost.runTurn` -> `pendingPromptsController.enqueue` -> `scheduleDrain`). The chain involves multiple awaits.

The key timing problem:

1. `runtime.run()` (user's original turn) calls `agent.emit("run-finished")` synchronously
2. Bridge dispatches `handleSessionEvent` synchronously. It runs sync code up to `await zeroCostPromise` (line 961) and suspends. BCB microtask queued.
3. `runtime.run()` returns.
4. Orchestrator's `finally` block: `await this.activeTrackerWork` -> sets `this.running = false`.
5. BCB microtask runs: `handleSessionEvent` continues. Reaches BCB barrier. Calls `enqueueCompletionContinuationIfHeld` (async, returns Promise).
6. The Promise's chain executes: `sdkHost.send({delivery:"queue"})` -> `vscode-session-host.send` -> `LocalRuntimeHost.runTurn` -> `pendingPromptsController.enqueue` -> `scheduleDrain`.
7. Inside `scheduleDrain`: `canStartRun()` is now TRUE (running=false). Drain microtask queued.
8. The drain microtask fires: prompt is shifted, C5 fires, C6 fires, `deps.send` is called for the continuation turn.
9. The continuation turn runs. C7, C8 fire.

For CORRECTION03 path (BCB barrier registration during run-finished event with `unconsumedOwnedTerminalResultsForC10 > 0`): the prompt IS enqueued and the drain SHOULD fire.

For CORRECTION04 path (terminal-idle re-evaluation): the BCB barrier's `enqueueCompletionContinuationIfHeld` is called from `reevaluateDeferredCompletionBarrier`, which is called from `updateBackgroundCommandState`. At this point, the agent has ALREADY completed its turn (so `running=false`, `canStartRun()=true`). The prompt is enqueued and the drain should fire.

**LIVE DEFECT OBSERVED COUNTERS:** `pending_prompt_enqueued=1`, `pending_prompt_dequeued=0`, `continuation_scheduled=0`.

If the prompt is enqueued (C4 fires once) but never dequeued (C5 never fires), the drain never fires. The `scheduleDrain` check `!session.agent.canStartRun()` must have returned TRUE (blocking the drain) at the time of the enqueue.

For CORRECTION03 path, this is consistent with the BCB microtask firing BEFORE the orchestrator's finally sets `running=false`. So `canStartRun() === false` -> drain bails. Then the post-turn drain microtask fires (line 1268), but by then the BCB-triggered enqueue has already settled (because the BCB microtask chain has been awaiting `sdkHost.send` which resolves once `runTurn` returns). The order of microtasks is FIFO, so the drain microtask from `scheduleDrain` (queued INSIDE the BCB microtask) runs AFTER the BCB microtask completes. The post-turn drain microtask (queued at line 1268) runs AFTER `completeInteractiveTurn` resolves.

Wait actually the microtask queue is FIFO. The BCB microtask runs first. Inside the BCB microtask, the `scheduleDrain` queues a drain microtask. The drain microtask runs after the BCB microtask completes (since it's FIFO). The post-turn drain microtask runs after `completeInteractiveTurn` resolves.

So the BCB-triggered drain microtask fires first. `canStartRun()` is true. The prompt is dequeued. `continuation_scheduled` fires. `deps.send` is called.

But the live defect shows `pending_prompt_dequeued=0` and `continuation_scheduled=0`. So the BCB-triggered drain microtask is NOT firing. Why?

**HYPOTHESIS:** The BCB-triggered enqueue's `scheduleDrain` is called when `canStartRun() === false`. This blocks the drain. By the time `canStartRun()` becomes true (post-turn), the BCB-triggered drain microtask is NOT queued (because it bailed at `scheduleDrain`). The post-turn drain microtask fires (line 1268) but the queue is empty (because the BCB-triggered enqueue already added and removed... no wait, the enqueue added the prompt. The post-turn drain sees the prompt in the queue. Why doesn't it dequeue?

Unless the post-turn drain microtask ALSO bails on `canStartRun() === false`. That would happen if the post-turn drain microtask fires BEFORE `running = false` is set in the orchestrator's finally.

Wait, let me re-check the timing. The post-turn drain microtask is queued at line 1269. This is AFTER `await this.completeInteractiveTurn(...)` resolves. `completeInteractiveTurn` awaits `markTurnIdle` -> `updateStatus` -> `this.invoke(...)`. The `invoke` is async (file I/O). So the chain definitely yields to microtasks.

By the time the drain microtask fires, the orchestrator's finally block has definitely run (it ran before `executeTurn` returned). So `running === false`. So `canStartRun() === true`. So the post-turn drain SHOULD work.

I must be missing something. Let me write the test and run it to see what actually happens.

