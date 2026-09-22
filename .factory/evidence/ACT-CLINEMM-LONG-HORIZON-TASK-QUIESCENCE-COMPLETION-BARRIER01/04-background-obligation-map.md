ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 — BACKGROUND OBLIGATION MAP
============================================================================================

> Recon of the notify-enabled background obligation lifecycle as the
> ACT's source-of-truth for outstanding autonomous work.

## 1. Obligation registration boundary

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/vscode-run-commands-tool.ts:753-766

The obligation is registered EXACTLY when:

    (a) start.state === "running"
        (genuine background handoff; fast-path synchronous
         terminality returns the result in-band and registers
         nothing)
    (b) notifyOnCompletion === true
        (model opted in via the run_commands input shape;
         default is false)
    (c) backgroundNotifyCoordinator is wired
        (production code MUST continue to work when this option
         is omitted; the no-coordinator path is fire-and-forget)
    (d) resolveActiveOwner returns a value
        (the (sessionId, taskId) owner key)

When ALL FOUR are satisfied:

    options.backgroundNotifyCoordinator.registerMarker({
        jobId:     start.jobId,
        sessionId: owner.sessionId,
        taskId:    owner.taskId,
    })

Marker identity triple:
    jobId      = unique per start, immutable
## 2. Obligation resolution boundaries (three paths)

### 2.1 Path A — terminal wake delivery

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/vscode-run-commands-tool.ts:775-815

Boundary: start.terminalPromise resolves AND the listener fetches
terminal classification via manager.status(). Then
BackgroundNotifyCoordinator.consumeTerminal is invoked.

Decision tree:
    "no_marker"            → ignore (no obligation)
    "owner_mismatch"       → ignore (different task/session)
    "containment_no_wake"  → ignore (containment failed)
    "held"                 → keep in heldTerminalResults FIFO
    "drained"              → enqueueTerminalWake (wake pushed)

Resolution side-effect:
    notificationMarkers.delete(jobId)  (line 332)
    → the marker is consumed; the obligation is gone.
```

### 2.2 Path B — direct command_status observation (TO BE WIRED)

```
[NEW_REAL_PRODUCTION_SEAM — this ACT]
apps/vscode/src/sdk/command-status-tool.ts:101-156

Boundary: command_status returns a snapshot whose `state` is terminal
(exited | cancelled | deadline_exceeded | spawn_failed | containment_failed).

Resolution side-effect:
    BackgroundNotifyCoordinator.resolveObligation({
        jobId, sessionId, taskId,
        resolution: "canonical_status_observed",
    })

    → notificationMarkers.delete(jobId) ONLY if the marker exists
      AND sessionId+taskId match.
    → records a decision for the diagnostic ring.

CORRECTNESS GUARD:
    command_status is OBSERVATION-ONLY and the production tool
    already exists at the canonical path. Wiring it as a
    resolution source does NOT change the tool's security class
## 3. Owner-key semantics

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/background-notify-coordinator.ts:255-257

export function ownerKey(sessionId: string, taskId: string | undefined): string {
    return `${sessionId}\u0000${taskId ?? ""}`
}

Owner key for obligation registration:
    (sessionId, taskId) — NO epoch.

Cross-task isolation:
    obligation for (session-A, task-A)
    does NOT block completion of (session-A, task-B)
    does NOT block completion of (session-B, task-A)
```

## 4. Where (sessionId, taskId, jobId) first all coexist

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/vscode-run-commands-tool.ts:760-766

The run_commands tool is the canonical site where the triple
(sessionId, taskId, jobId) all coexist for the first time:

    const owner = options.resolveActiveOwner()
    if (owner) {
        options.backgroundNotifyCoordinator.registerMarker({
            jobId:     start.jobId,
            sessionId: owner.sessionId,
            taskId:    owner.taskId,
        })
    }

At this seam:
    jobId      = freshly minted by manager.start()
    sessionId  = resolveActiveOwner() sessionId
    taskId     = resolveActiveOwner() taskId

No earlier seam needs to know all three; the obligation registry only
needs the triple at registration and resolution time. Resolution can
be called from:
    - run_commands terminalPromise handler (Path A) — has jobId, can
      re-resolve owner
    - command_status execute handler (Path B) — has jobId, can re-
      resolve owner from activeSession
    - explicit resolve call (test/synthetic path)
```

## 5. v1 obligation scope (freeze)

```
Completion-relevant obligations in this ACT:
    managed background command
    AND notifyOnCompletion=true
    AND owned by current task

NOT completion-relevant by default:
    notifyOnCompletion=false command
    dev server
    watcher
    detached daemon
    explicit fire-and-forget command
    unrelated user queued prompt
    background work belonging to another task/session
```

## 6. Conservation with notify=false

```
notifyOnCompletion=false
  → registerMarker NOT called
  → no obligation
  → submit_and_exit commits immediately (existing behavior)
  → completion barrier is a no-op for this case

This is the EXISTING behavior and MUST be conserved exactly.
The completion barrier MUST NOT introduce any state delta for the
notify=false path.
```
    (read-only) or its presentation to the model.

    The model's call to command_status returns the canonical
    terminal result. The agent then "knows" the result and
    calls submit_and_exit. The barrier holds the completion
    commit until the resolution is recorded; the resolution is
    recorded as a side effect of the same canonical observation.

    Without this wiring, the marker remains registered and the
    wake arrives LATER (Path A's terminalPromise fires after the
    model has already moved on). The result is the LIVE bug:
    submit_and_exit committed → wake arrives → second turn.
```

### 2.3 Path C — synchronous completion (no obligation)

```
[REAL_PRODUCTION_SEAM]
apps/vscode/src/sdk/vscode-run-commands-tool.ts:735-738

If the command finishes within `waitBudgetMs`, the tool returns the
result in-band. No marker was ever registered. There is no outstanding
obligation.

This ACT MUST NOT introduce a marker here. The fast-path is
explicitly fire-and-forget.
```
    sessionId  = immutable for the session lifetime
    taskId     = immutable for the task lifetime
    epoch      = NOT PART OF IDENTITY (N4 from BCNEX01)

NOT registered for:
    - synchronous (fast-path) terminality
    - notifyOnCompletion=false
    - failed starts (start.state !== "running")
    - undefined owner
    - other-session registrations (owner_mismatch at consume)
```