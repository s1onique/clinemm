# State ownership map (before this ACT)

| State | Owner | Mutation | Protection |
|---|---|---|---|
| `taskViewGeneration` (= `TaskOperationFence.generation`) | `TaskOperationFence` (singleton) | sync increment via `begin()` | generation equality at every async re-entry |
| `activeSession` | `SdkSessionLifecycle` | async end/start (sync reference swap at endActiveSession line 179) | lifecycle ownership; fence via `isOperationCurrent` |
| `isRunning` | `SdkSessionLifecycle.setRunning` | sync setter | — |
| TaskProxy | `SdkTaskControlCoordinator` (via `setTask`) | sync setter in `createAndSetTask` | fence-checked before any await boundary |
| message state | `SdkMessageCoordinator` | via appenders | — |
| turnPhase | `setTurnPhase` (passed in options) | sync setter | written only by start coordinator post-start |
| cancel epoch | `raiseCancelFence` (passed in options) | sync bump | straggler-event epoch filter |
| `pendingStops` map | `SdkSessionLifecycle` | async trackSessionStop | stop-before-start for same-id starts |
| session lifecycle instance | `SdkSessionLifecycle` (singleton per fixture) | reference swap | — |

## Fence-first ordering (current production)
1. `cancelTask`: `raiseCancelFence()` SYNC → `await sdkHost.abort(...)` →
   setRunning(false) → append resume_task → postStateToWebview
2. `clearTask`: `fence.begin()` → `clearTaskForOperation(token)` →
   fence check BEFORE destructive work → await endActiveSession → fence
   check AFTER await → setTask(undefined) → clearTaskSettings → resetMessageTranslator
3. `showTaskWithId`: `fence.begin()` (synchronous generation allocation) →
   fence check before stopping active session → await endActiveSession →
   fence check → await history reads → fence check before setTask →
   fence check before setTurnPhase → postStateToWebview
4. `initTask`: `fence.begin()` → `clearTaskForOperation(token)` →
   await config build → fence check → createAndSetTask →
   emitInitialTaskMessage → postStateToWebview (fire-and-forget) →
   await startNewSession (which threads the operationToken through its
   own pre-/post-host.start fence checks)

## Read/write audit

| Reader | State | Authority |
|---|---|---|
| `state.task` (getTask in coordinator) | TaskProxy | read-only for showTaskWithId (line 244), clearTaskForOperation (line 165) |
| `lifecycle.getActiveSession()` | ActiveSession | read-only for cancelTask (line 79), clearTask (no-op), showTaskWithId (line 231), endActiveSession (line 179) |
| `isOperationCurrent(token)` | fence generation | consulted by SdkSessionLifecycle (lines 264, 277, 291, 306, 330) |
| `isCurrent()` (per-instance closure) | fence generation | consulted by SdkTaskStartCoordinator (lines 186, 220) and SdkTaskControlCoordinator (lines 142, 156, 195) |
