# 02-recon.md

## Production seams (verbatim from HEAD)

```
PENDING_PROMPT_STORE        = sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts (PendingPromptsController class)
PENDING_PROMPT_ENQUEUE_SEAM = PendingPromptsController.enqueue (line 329) -> service.enqueue + emitPrompts + onEnqueue + scheduleDrain
PENDING_PROMPT_DRAIN_ENTRY  = PendingPromptsController.scheduleDrain (line 409) -> guarded by [empty || aborting || drainingPendingPrompts || !canStartRun()]
PENDING_PROMPT_DEQUEUE_SEAM = PendingPromptsController.drain (line 423) -> guarded by [aborting || drainingPendingPrompts || !canStartRun()] then shiftNext + emit + emitSubmitted + deps.send
PENDING_PROMPT_DRAIN_SCHEDULER (entry #1) = PendingPromptsController.scheduleDrain called from enqueue at line 375
PENDING_PROMPT_DRAIN_SCHEDULER (entry #2) = LocalRuntimeHost.runTurn post-turn drain microtask at line 1269

ACTIVE_RUN_GUARD           = session.agent.canStartRun() (session-runtime-orchestrator.ts:520) => !this.running && !this.shutdownCalled
DRAIN_REENTRANCY_GUARD      = session.drainingPendingPrompts (boolean) — set true in drain() at line 455, reset in finally at line 518
SESSION_OWNER_KEY          = ActiveSession (this.sessions.get(sessionId) inside LocalRuntimeHost)
TURN_DONE_SEAM             = LocalRuntimeHost.runTurn line 1268 — queueMicrotask(() => void this.pendingPromptsController.drain(input.sessionId))
ACTIVE_RUN_CLEAR_SEAM      = session-runtime-orchestrator.ts:1039 — this.running = false (inside executeRunInternal's finally block)
```

## Queue delivery contract

```
QUEUE_DELIVERY_CONTRACT = "delivery:'queue' = store only; scheduleDrain fires only if canStartRun()=true; no autonomous drain guarantee"
ENQUEUE_REQUESTS_DRAIN  = true
```

The `pendingPromptsController.enqueue` synchronously:
1. service.enqueue(session, entry)  — pure data append (dedupes by prompt equality)
2. emitPrompts(session)             — emits pending_prompts event
3. fire onEnqueue callback (C4 hook)
4. scheduleDrain(sessionId, session) — guards on canStartRun; bails if no

If the run is still in flight at enqueue time (the BCB ordering), `canStartRun()` returns false and scheduleDrain bails silently. No deferred retry.

## BCB chain (verbatim from HEAD)

The BackgroundCompletionBarrier's continuation enqueue lives at:
  `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1340`

```
void this.enqueueCompletionContinuationIfHeld(
    activeSession.sessionId,
    unconsumedOwnedTerminalResultsForC10,
    this.options.getTask?.()?.taskId,
)
```

This is `void` (fire-and-forget). The promise is `.then().catch()`ed inside the call site.

`enqueueCompletionContinuationIfHeld` (line 788) calls:
  `this.options.enqueueCompletionContinuation({sessionId, taskId, heldJobIds})`

That callback is `buildSdkControllerEnqueueCompletionContinuation`
(`apps/vscode/src/sdk/SdkController.ts:818`). It awaits:
  `active.sdkHost.send({sessionId, prompt, delivery: "queue"})`

`sdkHost.send` for VSCode routes through VscodeSessionHost.send → LocalRuntimeHost.send → LocalRuntimeHost.runTurn with delivery="queue" → pendingPromptsController.enqueue.

## Run-end ordering

The agent runtime's main loop (`sdk/packages/agents/src/agent-runtime.ts:1684-1700`):

```ts
const terminalToolMessage = this.findCompletingToolMessage(toolCalls, toolMessages);
if (terminalToolMessage) {
    const result = this.finishRun("completed", ...);  // line 1689
    await this.callAfterRunHooks(result);             // line 1694
    await this.emit({                                  // line 1695
        type: "run-finished",
        snapshot: this.snapshot(),
        result,
    });
    return result;
}
```

`finishRun` (line 3928-3954) sets `state.status = "completed"` synchronously. The `run-finished` event fires via `emit` (line 3979) which calls listeners **synchronously** (line 4099 `listener(event)`).

The host's listener is `onSessionEvent: (event) => { this.sessionEvents.handleSessionEvent(event).catch(...) }` (SdkController.ts:1746). It calls `handleSessionEvent` (an async function) WITHOUT awaiting it. The promise is detached.

`handleSessionEvent` (sdk-session-event-coordinator.ts:919) executes synchronously up to its first yield:
  `await zeroCostPromise` at line 961
Then continues asynchronously. The BCB enqueue at line 1340 happens after this first yield.

## Orchestrator's `running` lifecycle

`executeRunInternal` (session-runtime-orchestrator.ts:868) sets `this.running = true` at line 884 and clears it at line 1039 (inside the finally block at line 1025-1042).

```
executeRunInternal:
  this.running = true                          (line 884)
  ...
  runResult = await runtime.run("")            (line 1021)
  finally:
    unsubscribe()                              (line 1026)
    await this.activeTrackerWork                (line 1031) — yields to microtasks
    this.activeRuntime = null                  (line 1038)
    this.running = false                       (line 1039)  ← THE FLIP
```

The `unsubscribe()` happens BEFORE `running = false`. This is important:
- `unsubscribe()` synchronously removes the listener
- But the listener was ALREADY called synchronously when `emit("run-finished")` fired (line 4099 listener is sync)
- So `handleSessionEvent(event).catch(...)` was already invoked BEFORE unsubscribe

## LocalRuntimeHost.runTurn execution

`runTurn` (line 1172-1292):
- Line 1189: canStartRun check
- Line 1204: if delivery === "queue" || "steer", enqueue (no turn start)
- Line 1227: if not queue/steer, fire onRunTurnStarted (C7)
- Line 1234-1292: try/catch around executeTurn
- Line 1268-1272: post-turn drain microtask (only if finishReason !== "error")

The post-turn drain microtask is queued AFTER `await completeInteractiveTurn(...)` resolves (line 1259).

`completeInteractiveTurn` (line 2087-2095) calls `await this.markTurnIdle(session)` which yields to microtasks. **During this microtask yield, the BCB chain's `sdkHost.send` microtasks fire.**