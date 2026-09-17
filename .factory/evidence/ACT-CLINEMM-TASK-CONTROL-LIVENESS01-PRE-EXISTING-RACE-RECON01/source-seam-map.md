# Current production seam map

## SdkTaskControlCoordinator (apps/vscode/src/sdk/sdk-task-control-coordinator.ts)

| Method | Lines | Synchrony | Fence handling | Notes |
|---|---|---|---|---|
| `cancelTask()` | 76-117 | async | `raiseCancelFence` SYNC before await abort (line 92) | Comment at 87-91 explicitly states ordering is causal: "abort first would leave a window where a straggler gets the new epoch" |
| `clearTask()` | 119-126 | async | `fence.begin()` at entry (line 124) | External user intent advances the fence |
| `clearTaskForOperation(token)` | 138-177 | async | FENCE check at 142 BEFORE destructive work, fence check at 156 AFTER `await endActiveSession` | Used by `initTask` so the initTask's own token is preserved (a naive `clearTask()` would self-supersede) |
| `showTaskWithId(taskId)` | 192-308 | async | `fence.begin()` at entry (line 193); fence check at 216, 240, 260 (load-bearing check before task view mutation) | Generation is allocated **before** the history lookup so newest selection always owns newest generation |

## SdkTaskStartCoordinator (apps/vscode/src/sdk/sdk-task-start-coordinator.ts)

| Method | Lines | Synchrony | Fence handling | Notes |
|---|---|---|---|---|
| `initTask(...)` | 107-298 | async | `fence.begin()` at entry (line 119); `isCurrent()` checks at 186, 186-191, 220-228 (post-start fence) | Captures operation token, calls `clearTaskForOperation(token)` (NOT `clearTask()`) so the internal clear does not self-supersede |
| `createAndSetTask(sessionId)` | 392-400 | sync | — | Synchronously calls `this.options.setTask(task)` (which routes through `startOptions.setTask` → `controlOptions.setTask` in fixture) |
| `getCurrentMode()` | 387-390 | sync | — | Reads stateManager |
| `reinitExistingTaskFromId(...)` | (after line 200) | async | Same fence pattern | Sets `setTurnPhase("streaming")` after `startNewSession` resolves |

## SdkSessionLifecycle (apps/vscode/src/sdk/sdk-session-lifecycle.ts)

| Method | Lines | Synchrony | Fence handling | Notes |
|---|---|---|---|---|
| `startNewSession(startInput, operationToken?)` | 221-362 | async | Pre-host.start fence at 264 (returns "superseded"); post-host.start fence at 330 (returns "superseded" + `trackSessionStop` to dispose just-started session) | Load-bearing: post-host.start check is what closes the wedge race window |
| `endActiveSession(reason, opts?)` | 175-196 | async | — | Synchronously clears activeSession reference at line 179 (returns `clearActiveSessionReference()`) |
| `getActiveSession()` | 135-137 | sync | — | |
| `setRunning(running)` | 139-148 | sync | — | |

## TaskOperationFence (apps/vscode/src/sdk/task-operation-fence.ts)

| Method | Lines | Synchrony | Notes |
|---|---|---|---|
| `begin()` | 54-56 | sync | Returns `++this.generation` |
| `isCurrent(token)` | 63-65 | sync | Returns `token === this.generation` (no `current()` accessor on purpose — see file:32-42) |

## State ownership

| State | Owner | Mutation | Protection |
|---|---|---|---|
| `taskViewGeneration` (== `taskOperationFence.generation`) | `TaskOperationFence` | sync increment via `begin()` | generation equality at every async re-entry |
| `activeSession` | `SdkSessionLifecycle` | async end/start | lifecycle ownership; fence via `isOperationCurrent` |
| `isRunning` | `SdkSessionLifecycle.setRunning` | sync setter | — |
| TaskProxy | `SdkTaskControlCoordinator` (via `setTask`) | sync setter in createAndSetTask | fence-checked before any await boundary |
| message state | `SdkMessageCoordinator` | via appenders | — |
| turnPhase | `setTurnPhase` (passed in options) | sync setter | written only by start coordinator post-start |
| cancel epoch | `raiseCancelFence` (passed in options) | sync bump | straggler-event epoch filter |
| `TaskOperationFence` | itself | — | different from taskViewGeneration: it solves task-operation lifecycle authority |

## SdkTaskStartCoordinatorOptions (required fields today)

```text
stateManager, sessions, messages, taskHistory, sessionConfigBuilder,
resolveSessionAutoApprovalOverride, taskOperationFence,
buildStartSessionInput, createHistoryItemFromSession, clearTask,
clearTaskForOperation, setTask, onAskResponse, onCancelTask,
getWorkspaceRoot, createTempSessionHost, loadInitialMessages,
resolveContextMentions, isClineManagedProviderActive,
emitClineAuthError, captureProviderApiError?, postStateToWebview,
setTurnPhase
```

## SdkTaskControlCoordinatorOptions (required fields today)

```text
sessions, interactions, messages, taskHistory, taskOperationFence,
getTask, setTask, onAskResponse, resetMessageTranslator,
postStateToWebview, clearTaskSettings, setTurnPhase,
raiseCancelFence?
```
