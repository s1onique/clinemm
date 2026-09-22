ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 — COMPLETION AUTHORITY MAP
==========================================================================================

> Recon of every seam that converts `submit_and_exit` into a task-completion
> commit. Each edge labeled by its epistemic weight.

## 1. Where `submit_and_exit` becomes canonical task completion

### 1.1 Completion tool recognition (translator seam)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/message-translator.ts:1640-1655

The `submit_and_exit` tool_use's `content_end` event sets two flags on
`MessageTranslatorState`:

    setAttemptCompletionSeen()
    setTerminalResponseCommittedThisTurn()

These flags are the canonical authority bits for "the model asked to
finish and a terminal response was actually committed to the chat
transcript" (CRA01-CRA03).
```

### 1.2 Completion commit (coordinator seam)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/sdk-session-event-coordinator.ts:361-413

When the coordinator receives a turnComplete event (the `done` agent
event), it consults the two translator flags above. The completion
commit is:

    if wasAttemptCompletionSeen():
        if wasTerminalResponseCommittedThisTurn():
            setTurnPhase("completed", undefined,
                         "session-event-turn-complete-completed")    <-- COMMIT
        else:
            setTurnPhase("awaiting_followup", ...,
                         "session-event-turn-complete-awaiting-followup-liveness")
    elif wasErrorSeen():
        setTurnPhase("error", ...)
    elif wasTerminalResponseCommittedThisTurn():
        setTurnPhase("awaiting_followup", ...)
    else:
        # Q5 deferred-continuation composition seam (LHOWA01/BTCONT01)
        if outstandingAutonomousWork:
            register DeferredContinuation, suppress commit
        else:
            setTurnPhase("awaiting_followup", ...)

Authority type: PHASE_COMMIT (turn phase becomes "completed").

THIS IS THE LOAD-BEARING SEAM THAT THIS ACT MUST REPAIR.
```

### 1.3 setRunning(false) (lifecycle seam)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/sdk-session-lifecycle.ts:729-732

After `sdkHost.send(...)` settles (the per-send promise from
`fireAndForgetSend`), `setRunning(false)` and `onSendComplete(sessionId)`
fire. The lifecycle seam is NOT the completion commit — it's the
"this turn is done" flip. The completion commit happens one level
higher at the coordinator seam.

    .then(async () => {
        ...
## 3. Production event that identifies a notify-enabled background obligation

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/vscode-run-commands-tool.ts:753-766

When a background command starts with:

    start.state === "running"        (genuine background handoff)
    notifyOnCompletion === true      (model opted in)

    backgroundNotifyCoordinator.registerMarker({
        jobId:     start.jobId,
        sessionId: owner.sessionId,
        taskId:    owner.taskId,
    })

This is the canonical registration boundary. Failed starts
(fast-path synchronous) do NOT register markers — the model has the
result in-band.

Marker lifetime:
    register on RUNNING start
    removed by BackgroundNotifyCoordinator.consumeTerminal on wake
    removed by BackgroundNotifyCoordinator.dispose() on host shutdown
```

## 4. Canonical terminal result observation paths

### 4.1 Path A — terminal wake delivery (existing)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/vscode-run-commands-tool.ts:775-815

After `start.terminalPromise` resolves (the background job reaches a
terminal state), the run_commands tool reads:

    const status = await manager.status({ jobId, waitMs: 0 })
    ...
    BackgroundNotifyCoordinator.consumeTerminal({
        jobId, terminalState, exitCode, reason,
        isContainmentFailed, outputTail,
    })

consumeTerminal() classifies:
    "no_marker"            — no obligation to resolve
    "owner_mismatch"       — owner gone or different (DISCARDED)
    "containment_no_wake"  — containment_failed (no wake)
## 6. Completion authority map summary

```
submit_and_exit tool_use
  ↓
content_end (message-translator.ts:1640-1655)
  ↓ setAttemptCompletionSeen + setTerminalResponseCommittedThisTurn
done agent event
  ↓
sdk-session-event-coordinator.ts:343-642
  ↓ wasAttemptCompletionSeen() branch (line 365-413)
  ↓   if wasTerminalResponseCommittedThisTurn():
  ↓       setTurnPhase("completed", ...)               ← THIS IS THE BUG SEAM
  ↓   else:
  ↓       setTurnPhase("awaiting_followup", ...)
  ↓
sdk-session-lifecycle.ts:729-732
  ↓ setRunning(false) + onSendComplete

Authority gap:
  The line that calls setTurnPhase("completed") does NOT consult
  outstanding autonomous obligations. LHOWA01 only guards the
  done-WITHOUT-completion branch.

  This ACT plugs the gap by adding the same outstandingAutonomousWork
  predicate to the wasAttemptCompletionSeen branch:

    if wasAttemptCompletionSeen():
        if wasTerminalResponseCommittedThisTurn():
            if outstandingAutonomousWork:
                register DeferredCompletionBarrier
                DO NOT call setTurnPhase("completed")        <-- HELD
            else:
                setTurnPhase("completed", ...)              <-- COMMIT
```

## 7. Recon questions answered

1. Where is `submit_and_exit` converted into canonical task completion?
   → `sdk-session-event-coordinator.ts:365-413` at the
     `wasAttemptCompletionSeen()` branch; the load-bearing commit is
     `setTurnPhase("completed", ...)` at line 375.

2. What production event identifies a notify-enabled background obligation?
   → `BackgroundNotifyCoordinator.registerMarker({jobId, sessionId, taskId})`
     at `vscode-run-commands-tool.ts:762-766`; the marker set is the
     canonical authority for outstanding notify-enabled obligations.

3. How can the runtime prove that a terminal result was semantically incorporated?
   → THREE structurally provable paths (Path A wake delivery, Path B
     direct command_status observation, Path C synchronous completion).
     Only Path A is currently wired. This ACT must wire Path B.

4. Where is the last safe boundary at which completion can be held or committed?
   → The same coordinator seam (line 365-413). The completion commit
     becomes a guarded transition:

        setTurnPhase("completed") IFF wasAttemptCompletionSeen() &&
                                    wasTerminalResponseCommittedThisTurn() &&
                                    outstandingAutonomousWork === 0 &&
                                    requiredContinuationInFlight === false
    "held"                 — other markers still active (FIFO HOLD)
    "drained"              — enqueues bounded wake to PendingPromptsController

PROBLEM: this path is the ONLY existing resolution. If the model
observes the result through command_status and calls submit_and_exit
BEFORE this terminalPromise resolves, the marker remains
unresolved until consumeTerminal fires later.
```

### 4.2 Path B — direct command_status observation (UNUSED for resolution)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/command-status-tool.ts:101-156

The `command_status` tool calls `manager.status({jobId, waitMs})` and
returns the snapshot to the model. It is OBSERVATION ONLY — it does
NOT consume the BackgroundNotifyCoordinator marker.

THIS IS THE LIVE BUG SCENARIO: the model polls command_status, sees
the terminal state, and calls submit_and_exit. The task commits as
COMPLETED. Then the run_commands tool's `terminalPromise` resolves,
consumeTerminal enqueues a wake into PendingPromptsController, and
the next turn starts — leading to duplicate autonomous continuation.

This ACT must wire Path B as a resolution path.
```

### 4.3 Path C — synchronous (fast-path) termination

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/vscode-run-commands-tool.ts:735-738

If the command completes within `waitBudgetMs`, the tool returns the
synchronous result in-band (combinedOutput). NO marker is registered
(correction01: notify-on-terminal is for BACKGROUND handoff; sync
terminality is observable in-band).

THERE IS NO OUTSTANDING OBLIGATION for fast-path. This ACT must
NOT introduce a marker here.
```

## 5. Continuation in-flight authority (race boundary)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/sdk-session-lifecycle.ts:729-732
apps/vscode/src/sdk/sdk-session-event-coordinator.ts:321-326

`pending_prompt_submitted` → `sessions.setRunning(true)`
`done` agent event          → `sessions.setRunning(false)` + onSendComplete

In-flight authority lives in `activeSession.isRunning`. The coordinator
reads it at the `done` handler to distinguish:
    - cancelled turn (preserves "resumable" phase)
    - queued-turn straggler (preserves "streaming")
    - real completion (line 359)

For completion-barrier purposes:
    - If a continuation is already validly started before the
      completion commit can fire, the continuation owns the
      obligation-resolution work (LHOWA01/BTCONT01 path).
    - The completion commit MUST be deferred, NOT canceled, when an
      outstanding obligation exists.
```
        this.setRunning(false)
        await this.options.onSendComplete(sessionId)
    })
```

## 2. Existing completion-prevention mechanisms (must be conserved)

### 2.1 LHOWA01 — outstanding autonomous work suppresses `awaiting_followup`

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/sdk-session-event-coordinator.ts:488-630

The `done-without-completion` branch (model stopped WITHOUT calling
`submit_and_exit`) reads:

    ownerStillRunning = hasRunningBackgroundJobForOwner(activeSession.sessionId)
    pendingPromptsKnown = getPendingPromptCount(activeSession.sessionId)
    activeNotifyCount = getActiveNotifyCount(activeSession.sessionId, taskId)

    outstandingAutonomousWork =
        ownerStillRunning || pendingPromptsKnown > 0 || activeNotifyCount > 0

    if outstandingAutonomousWork:
        register DeferredContinuation
        DO NOT call setTurnPhase("awaiting_followup", ...)             <-- DEFERS
    else:
        setTurnPhase("awaiting_followup", ...,
                     "session-event-turn-complete-resumable-straggler-preserve")

LHOWA01 only guards the `awaiting_followup` branch (the
done-WITHOUT-completion path). It does NOT consult
`wasAttemptCompletionSeen()`.

CONSEQUENCE: when the model calls `submit_and_exit` AND outstanding
autonomous work exists, the `wasAttemptCompletionSeen()` branch
fires at line 374-375 and calls `setTurnPhase("completed")` WITHOUT
consulting `outstandingAutonomousWork`. THIS is the bug class this ACT
must repair.
```

### 2.2 BTCONT01 — terminal-idle re-evaluation

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/sdk-session-event-coordinator.ts:200-300

When a background command transitions from running=true to running=false
(the >0->0 cardinal transition), `reevaluateDeferredContinuation()`
re-runs the same defer check and commits `awaiting_followup` exactly
once if the deferral is still valid.

This BTCONT01 path is INVARIANT to completion semantics — it only fires
for the `awaiting_followup` (Q5) branch.
```