# Current production seam — SdkTaskStartCoordinator.initTask

```
SYMBOL                              INPUT                                              OUTPUT                 AWAIT?  MUTATES?  FENCE_CHECK?
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
operationToken                      taskOperationFence.begin()                         number                 no      no        no
clearTaskForOperation(operationToken) options.clearTaskForOperation(token)              void                   yes     no         yes (in clearTaskForOperation)
getWorkspaceRoot()                  options.getWorkspaceRoot                           string                 yes     no         no
sessionConfigBuilder.build(args)     {prompt, images, files, historyItem, taskSettings, SessionConfig          yes     no         no
                                     cwd, mode, sessionAutoApprovalOverride}
isCurrent()                         fence.isCurrent(operationToken)                     boolean                no      no         yes (pre-createAndSetTask)
createAndSetTask(taskSessionId)     new TaskProxy + options.setTask                     TaskProxy              no      yes        no
emitInitialTaskMessage(...)         options.messages.appendAndEmit(...)                 void (synchronous emit) no      yes        no
postStateToWebview (fire-and-forget) options.postStateToWebview                          Promise<void>          no      no         no
sessions.startNewSession(input, op) options.sessions.startNewSession                    started|superseded     yes     no         yes (pre+post host.start internally)
sessionId check                     if startResult.sessionId !== taskSessionId         warns, rebinds         no      yes (only task.taskId)   no
setTurnPhase("streaming", ...)      options.setTurnPhase                               void                   no      yes        no
updateTaskHistoryItem(historyItem)   options.taskHistory.updateTaskHistoryItem         void                   yes     no         no
postStateToWebview (streaming post) options.postStateToWebview                          Promise<void>          yes     no         no
fireAndForgetSend(sdkHost, ...)     sessions.fireAndForgetSend                          void                   yes (resolveContextMentions pre-step)  no  no
```

## Identified guard points

1. **Pre-build fence (L186):** if `!isCurrent()`, abandon before createAndSetTask.
2. **Post-startNewSession fence (L220):** if startResultEnvelope.status === "superseded", abandon without mutating shared state.
3. **Initial message ownership (S5):** initial message emit is synchronous within `initTask`, gated by fence.
4. **Turn phase (L263):** `setTurnPhase("streaming")` is sole canonical writer of the new-task → streaming transition.
5. **Cancel fence (L92 of sdk-task-control-coordinator.ts):** `raiseCancelFence()` SYNC before `await sdkHost.abort()`. UNTOUCHED by this ACT.

## SdkTaskStartCoordinatorOptions contract (current)

```
stateManager, sessions, messages, taskHistory, sessionConfigBuilder,
resolveSessionAutoApprovalOverride (CAI-01B REQUIRED),
taskOperationFence (FIX01 REQUIRED),
buildStartSessionInput, createHistoryItemFromSession, clearTask,
clearTaskForOperation (FIX01 REQUIRED),
setTask, onAskResponse, onCancelTask,
getWorkspaceRoot, createTempSessionHost, loadInitialMessages,
resolveContextMentions, isClineManagedProviderActive,
emitClineAuthError, captureProviderApiError? (optional),
postStateToWebview,
setTurnPhase (CORRECTION03 REQUIRED)
```
