# 03 — Hot-Path Map

Source: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`,
`apps/vscode/src/sdk/turn-state-tracker.ts`,
`sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`,
`apps/vscode/src/shared/services/Logger.ts`.

## 5.1 Session event ingress

`SdkSessionEventCoordinator.handleSessionEvent(event: CoreSessionEvent)` is the
load-bearing entry point. It is registered as `onSessionEvent` callback on
`SdkSessionLifecycle` and fired for every `CoreSessionEvent` the runtime emits.

Callers (callers-of-`handleSessionEvent`, via `deps.emit` of the
`PendingPromptsController.emitPrompts`/`emitSubmitted` channels and other SDK
event sources):

| Event type                | Emitted from                                                                                       | Synchronous? |
|---------------------------|----------------------------------------------------------------------------------------------------|--------------|
| `pending_prompts`         | `PendingPromptsController.update` / `.delete` / `.enqueue` / `.consumeSteer` / `.discardQueue` / `.drain` (post-shift) / `.drain` (post-requeue) | yes |
| `pending_prompt_submitted`| `PendingPromptsController.drain` (post-shift) / `.consumeSteer`                                     | yes |
| `agent_event`             | agent-runtime / gRPC subscribe path                                                                 | yes |
| `session_ended`           | SessionRuntime / SDK lifecycle                                                                       | yes |

For ONE ordinary background-command completion lifecycle:

| Step                                    | `pending_prompts` events | `pending_prompt_submitted` events |
|-----------------------------------------|------------------------:|---------------------------------:|
| 1. user types "run in background"       |                       1 |                                0 |
| 2. user sends → `enqueue`               |                       1 |                                0 |
| 3. drain picks up → shift + dispatch    |                       1 |                                1 |
| 4. `runTurn` runs to completion         |                       0 |                                0 |
| 5. session ends → `setRunning(false)`   |                       0 |                                0 |
| TOTAL                                   |                       3 |                                1 |
## 5.2 Turn-state mutation

`handleSessionEvent` calls `this.options.setTurnPhase?.(...)` from 9 distinct
sites (terminal-end, error, attempt_completion, awaiting_followup, etc.). All
sites route through the same `setTurnPhase(phase, anchorTs, writerId)`
callback which delegates to `TurnStateTracker.setWithWriter`.

`TurnStateTracker.setWithWriter` (apps/vscode/src/sdk/turn-state-tracker.ts:96):

```text
setWithWriter(phase, anchorTs, identity)
  → mutate { phase, anchorTs, seq }
  → recordTurnStateWriterProvenance(record)        // D-knob only
  → for (const listener of [...this.listeners])
        try { listener(phase, anchorTs) } catch {}  // fan-out to TaskTelemetryTracker
```

**Critical property:** `setWithWriter` does NOT short-circuit when
`previousPhase === currentPhase`. Every call:

1. advances `seq` (always),
2. fires the TSWPD diagnostic stamp (when the D-knob is ON),
3. fan-outs to ALL subscribed listeners (synchronously).

The TSWPD stamp alone (when D is enabled) is a bounded in-memory ring append
with no I/O. The listener fan-out IS the production cost — `TaskTelemetryTracker`
is one such listener.

## 5.3 Event feedback edges

Directed map of session-event feedback edges in the production seam:

```text
background command lifecycle
  → emit `pending_prompts` (PendingPromptsController.enqueue)
    → deps.emit → SdkSessionEventCoordinator.handleSessionEvent
      → logQueueEvents → Logger.log → Logger.#output → Logger.output
        → for each subscriber: subscriber(msg)  [SYNC I/O WAIT]
      → translateSessionEvent (in-process)
      → captureProviderApiError (conditional)
      → messages.appendAndEmit (in-process)
      → setTurnPhase (turn-state mutation + listener fan-out)
        → TaskTelemetryTracker.onTurnPhase (per-listener cost)
      → postStateToWebview (async — does NOT block this path)
```

There is **NO** `handleSessionEvent → state write → emit → handleSessionEvent`
feedback loop in the production seam. The dispatch path is one-way synchronous
within `handleSessionEvent`, then returns to the event loop.

The only re-entry risk is if a synchronous subscriber to `outputChannel` or a
synchronous handler of `setTurnPhase` listeners emits another `pending_prompts`
event. The hot profile shows NO evidence of such re-entry
(`maxNestedHandleDepth` would have been > 1 if it occurred).

## 5.4 Logging inventory

| Site                                          | Payload construction                                       | Stringification | Stack capture | Sync file write | Per-event count |
|-----------------------------------------------|------------------------------------------------------------|-----------------|---------------|-----------------|----------------:|
| `logQueueEvents` (Coordinator)                 | template literal with `count`, `prompt.substring(0, 80)`   | one concat      | none          | YES (outputChannel.appendLine) | 1 log / event |
| `handleSessionEvent` stale-session branch     | template literal                                           | one concat      | none          | YES             | 1 / stale event |
| `handleSessionEvent` straggler branch         | template literal                                           | one concat      | none          | YES             | 1 / straggler |
| `Logger.error(...)` in coordinator catches     | `err.message`                                              | one concat      | none          | YES             | rare |
| `Logger.warn(...)` (awaiting_followup, defer) | template literal                                           | one concat      | none          | YES             | 1 / terminal event |

All `Logger.*` calls funnel through `Logger.#output` (the private composer)
which does:

```text
Logger.#output(level, message, error, args):
  let fullMessage = message
  if (Logger.isVerbose && args.length > 0) {
    fullMessage += ` ${args.map(JSON.stringify).join(" ")}`
  }
  const errorSuffix = error?.message ? ` ${error.message}` : ""
  const ts = new Date().toISOString()
  Logger.output(`${ts} ${level} ${fullMessage}${errorSuffix}`.trimEnd())
```

And `Logger.output` iterates the `subscribers` Set, calling each subscriber
synchronously. The `outputChannel.appendLine` subscriber is the dominant one
and blocks the extension-host thread on synchronous IPC.

**Conclusion (recon, no causal claim yet):** `logQueueEvents` is the single
biggest source of per-event synchronous log work in the hot path. It is
invoked unconditionally on every session event.

That is **4 `handleSessionEvent` calls per ordinary background lifecycle**,
each currently invoking `Logger.log` synchronously via `logQueueEvents`.
