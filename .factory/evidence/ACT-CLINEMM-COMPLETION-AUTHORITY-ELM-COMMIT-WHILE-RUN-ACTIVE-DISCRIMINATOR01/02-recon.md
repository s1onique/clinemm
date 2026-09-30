# §3 — Seam table for C8, C9, C10

Source recon only. No production changes.

## Boundary table

| Boundary | Exact source | What it means |
|---|---|---|
| C9 | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1231` | The coordinator receives an `agent_event` whose inner event is `type: "done"` AND `messageTranslatorState.wasTerminalResponseCommittedThisTurn()` returns true AND `!outstandingAutonomousWork`. The C9 record is emitted by `captureContinuationCardinalityAuthorityRecord({ stage: "submit_and_exit_seen", ... })`. The `submitId` is a monotonic coordinator-local counter. C9 is the **agent's declared intent to complete the task**. It is upstream of C10 in the same handler. |
| C10 | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1431` | After the C9 branch (in the same `done` handler), the coordinator emits C10 by `captureContinuationCardinalityAuthorityRecord({ stage: "task_completion_committed", ... })`. The `completionId` is a monotonic coordinator-local counter. C10 is the **coordinator's authoritative commit of the task completion phase transition** (`setTurnPhase("completed", ...)` fires immediately after, at line 1441). C10 fires INSIDE `LocalRuntimeHost.executeTurn` (the coordinator's `handleSessionEvent` is called synchronously from the runtime event bridge during the agent's `done` dispatch). |
| C8 | `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1321` | After `await this.executeTurn(...)` resolves (line 1301) and BEFORE `finalizeSingleRun` / `completeInteractiveTurn` (line 1328/1331), the host invokes `this.pendingPromptCaptureHooks.onAgentTurnDone(...)`. The `runId` is read from `runIdBySessionId` retained by `canonical-event-subscription.ts:89`. C8 fires AFTER `executeTurn` returns — i.e. it is the host's `try`-block post-await bookkeeping. |
| presentation | `apps/vscode/src/sdk/SdkController.ts` webview post | Deliberately out of scope per §3 / §0 of the ACT. |


## Factual Q&A from code

**Q1. What exact statement emits C10?**

```ts
// apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1431
captureContinuationCardinalityAuthorityRecord({
    stage: "task_completion_committed",
    origin: "pending_prompt_drain",
    sessionId: activeSession.sessionId,
    taskId: this.options.getTask?.()?.taskId,
    completionId: `completion-${activeSession.sessionId}-${++this.nextCompletionCommitEventId}`,
})
```

The `origin` is hard-coded to `pending_prompt_drain` because the C10 emission is gated on `wasAttemptCompletionSeen()` (the attempt_completion tool came from a pending-prompt drain).

**Q2. What conditions have been satisfied immediately before C10?**

In `handleSessionEvent` (sdk-session-event-coordinator.ts:1192 onward):
- `result.sessionEnded === true || result.turnComplete === true` (the `done` event arrived and the translator set turnComplete)
- `result.turnComplete` is set by the translator's `done` handler (message-translator.ts:2278)
- `wasAttemptCompletionSeen() === true` (the attempt_completion tool's `content_start` was observed)
- `wasTerminalResponseCommittedThisTurn() === true` (the attempt_completion tool's `content_end` was observed with terminal response)
- `!outstandingAutonomousWork` (no held background jobs, no queued prompts, no active notify markers, no running owned jobs)


**Q3. What code still executes after C10 but before C8?**

Reading the call graph top-down from `handleSessionEvent` (sdk-session-event-coordinator.ts:1192) through `runTurn` (local-runtime-host.ts:1225):

| Step | Source | Effect |
|---|---|---|
| 1. C10 capture | sdk-session-event-coordinator.ts:1431 | CCARD ring buffer write |
| 2. `setTurnPhase("completed", ...)` | sdk-session-event-coordinator.ts:1441 | TurnPhaseTracker write: phase = "completed" |
| 3. `sessions.setRunning(false)` | sdk-session-event-coordinator.ts:1718 | Flag flip on the active session |
| 4. `taskHistory.updateTaskUsage(...)` (fire-and-forget) | sdk-session-event-coordinator.ts:1721-1730 | Token-usage persistence (returns immediately to the caller) |
| 5. `postStateToWebview()` (fire-and-forget, gated by `result.messages.length > 0 \|\| result.sessionEnded \|\| result.turnComplete`) | sdk-session-event-coordinator.ts:1738-1747 | Webview state projection |
| 6. `leaveExtensionHostHotloopHandleSessionEvent()` (diagnostic-only) | sdk-session-event-coordinator.ts:1754 | Depth tracker exit (no-op when diagnostic OFF) |
| 7. `handleSessionEvent` returns | sdk-session-event-coordinator.ts:1756 | Awaits the event-bridge's `await eventBridge.dispatchAgentEvent(...)` to settle |
| 8. `executeTurn` resolves to the host | local-runtime-host.ts:1301 → 1313 | `const result = await this.executeTurn(...)` |
| 9. C8 capture: `onAgentTurnDone({...})` | local-runtime-host.ts:1320-1327 | CCARD ring buffer write |
| 10. `finalizeSingleRun` or `completeInteractiveTurn` | local-runtime-host.ts:1328-1331 | C8 → C9/C10 are not adjacent; the actual gap ends here |

**Q4. Can that remaining code mutate task/agent state?**

Steps 1, 2, 3, 6, 7, 9 are NO state mutation (they are observer writes or diagnostic depth trackers).
Steps 4, 5 are fire-and-forget promises whose handlers are token-usage persistence and webview projection, neither of which touches the run/agent state shape.

**Q5. Can it spawn/consume work, prompts, terminals, retries, continuations?**

No. The C10->C8 interval contains no `runTurn`, no `executeTurn`, no `enqueuePrompt`, no `scheduleContinuation`, no `drainPendingPrompts`. The only effect on the queue is `completeInteractiveTurn`'s drain (step 10), which fires AFTER C8 — outside the C10->C8 interval.

**Q6. Does C8 occur in finally/teardown/bookkeeping, or at semantic completion?**

Bookkeeping. The C8 capture lives at `local-runtime-host.ts:1321` between `await executeTurn(...)` (line 1301) and `await this.finalizeSingleRun(...)` (line 1329). The capture is the host's host-side bookkeeping for the run that just finished — the agent's `done` event already committed the semantic completion inside `executeTurn`'s `eventBridge.dispatchAgentEvent` call.

**Q7. Can C10 happen if C8 will never subsequently happen?**

Yes — the LIVE trace (seq 8 -> seq 9 with 51ms gap) demonstrates this is the steady-state ordering. C10 is emitted from inside `executeTurn`'s teardown (specifically, the agent's `done` dispatch propagates through `eventBridge -> handleSessionEvent` synchronously). If `executeTurn` throws AFTER C10 (rare but possible: e.g. `completeInteractiveTurn` aborts), C8 will not fire. The completion authority is in an **inconsistent** state in that case: the CCARD ring has C10 but no C8.

**Q8. Can multiple C10s occur for one run?**

No. The C10 capture is gated by `wasTerminalResponseCommittedThisTurn()`, which is set ONCE per attempt_completion tool's `content_end` and cleared at `clearTurnOutcome()` (called at `pending_prompt_submitted`). A subsequent `done` in the SAME turn would still see the flag set, but the BCB barrier (`outstandingAutonomousWork`) and the deferred continuation machinery (`reevaluateDeferredCompletionBarrier`) ensure idempotence. The Elm kernel also rejects duplicate `TaskCompletionCommitted` with `DuplicateCompletionRef existing completionRef` (Authority.elm:382).


## Complete C10 -> C8 interval (51ms observed in LIVE trace)

The exact sequence observed at `at=1790809536499` (C10) through `at=1790809536550` (C8):

```
C10 at 1790809536499: task_completion_committed (origin=pending_prompt_drain)
setTurnPhase("completed", ...)
sessions.setRunning(false) (bookkeeping flag flip)
Promise.resolve(taskHistory.updateTaskUsage(...)) (fire-and-forget)
Promise.resolve(postStateToWebview()) (fire-and-forget)
leaveExtensionHostHotloopHandleSessionEvent (diagnostic, no-op when OFF)
await eventBridge.dispatchAgentEvent completes
executeTurn() returns to runTurn
C8 at 1790809536550: agent_turn_done (origin=explicit_user, runId=run_h7wXy0mx)
```

There is no `await`-boundary that could host a new model/tool turn, prompt creation, or continuation schedule in that interval. The interval is bounded by:
- the synchronous return from `handleSessionEvent`,
- the resolution of the `eventBridge.dispatchAgentEvent` Promise,
- the synchronous emission of `onAgentTurnDone`.
