ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 — TURN-AUTHORITY MAP
============================================================================

> Full production chain from `agent_event done` → coordinator →
> turn-phase writer. Every arrow labelled with its epistemic weight
> (REAL_PRODUCTION_SEAM / STRUCTURAL / INFERRED / LIVE_UNOBSERVABLE).

## 1. Entry: `agent_event(done)` flows into the coordinator

```text
                          [REAL_PRODUCTION_SEAM]
  agent_runtime
    → session-termination fallback at
       sdk/packages/agents/src/agent-runtime.ts:1313-1336
    → session-termination events emitted with payload { sessionId,
       reason: "completed" | "aborted" | "error" }
    → emitted through CoreSessionEventBus

                  ↓ [REAL_PRODUCTION_SEAM]

  ClineCore / LocalRuntimeHost (sdk/packages/core)
    → session.host.subscribeRuntimeEvents()
    → forwards to SdkSessionHost

                  ↓ [REAL_PRODUCTION_SEAM]

  apps/vscode/src/sdk/vscode-session-host.ts
    → onRuntimeEvent() at vscode-session-host.ts:582 (per
       background-owner-correlation.ts:8)
    → forwards to SdkController.sessionEvents

                  ↓ [REAL_PRODUCTION_SEAM]

  apps/vscode/src/sdk/SdkController.ts:996-1020
    → Controller constructor wires the
       BackgroundNotifyCoordinator AND the SdkSessionEventCoordinator
    → sessionEvents = new SdkSessionEventCoordinator({...options})

                  ↓ [REAL_PRODUCTION_SEAM]

  apps/vscode/src/sdk/SdkController.ts:2075
    → sessionEvents.handleSessionEvent(event)
    → calls SdkSessionEventCoordinator.handleSessionEvent
```

## 2. Coordinator decision branch (the load-bearing seam)

```text
                  [REAL_PRODUCTION_SEAM]

  apps/vscode/src/sdk/sdk-session-event-coordinator.ts:232
    handleSessionEvent(event):
      - filters stale sessions (line 236)
      - translates session event → translation result (line 249)
      - dispatches based on event.type and translation result

                  ↓ [REAL_PRODUCTION_SEAM]

  apps/vscode/src/sdk/sdk-session-event-coordinator.ts:281
    if (result.sessionEnded || result.turnComplete) {
      // Five branches, in this priority order:

      // Branch 1: straggler after cancel (line 297)
      [REAL_PRODUCTION_SEAM]
      if (!activeSession.isRunning && getTurnPhase() === "resumable") {
        → DO NOTHING (preserve resumable)
      }

      // Branch 2: provider error (line 299)
      [REAL_PRODUCTION_SEAM]
      if (wasErrorSeen()) {
        → setTurnPhase("error", "session-event-turn-complete-error")
      }

      // Branch 3: completion tool used (line 303)
      [REAL_PRODUCTION_SEAM]
      if (wasAttemptCompletionSeen()) {
        if (wasTerminalResponseCommittedThisTurn()) {
          → setTurnPhase("completed",
                         "session-event-turn-complete-completed")
        } else {
          // completion protocol liveness — no committed terminal response
          [REAL_PRODUCTION_SEAM]
          if (wasTerminalResponseCommittedThisTurn()) {
            → setTurnPhase("awaiting_followup",
                           "session-event-turn-complete-awaiting-followup")
          } else {
            // Branch 4: done-without-completion (Q5 composition seam)
            [REAL_PRODUCTION_SEAM — the Q5 RED was here]
            ...
          }
        }
      }
    }
```

## 3. The Q5 done-without-completion branch (THE defect locus)

```text
                  [REAL_PRODUCTION_SEAM]

  apps/vscode/src/sdk/sdk-session-event-coordinator.ts:387-514
    (the exact line numbers from production source):

    // Capture BOCOR record (Q5 decision boundary)
    captureBackgroundOwnerCorrelationRecord({
        guardAvailable: typeof hasRunningBackgroundJobForOwner === "function",
        queriedOwnerSessionId: activeSession.sessionId,
        guardResult: typeof ownerStillRunning === "boolean" ? ownerStillRunning : null,
        activeJobs: getActiveJobOwnershipSnapshot?.() ?? [],
        candidateWriterId: "session-event-turn-complete-resumable-straggler-preserve",
        // ...
    });

    // THE Q5 GUARD CHAIN:
    const ownerStillRunning =
        this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId);

    if (ownerStillRunning) {
      // Guard fires: owner has a RUNNING background job
      // → defer awaiting_followup, register DeferredContinuation marker
      [REAL_PRODUCTION_SEAM — BCAFG01 GREEN at this point]
      this.deferredContinuation = {
        sessionId, taskId, epoch, deferredAt
      };
    } else {
      // Guard silent: no RUNNING background job
      // → commit awaiting_followup UNCONDITIONALLY
      [REAL_PRODUCTION_SEAM — THIS IS THE DEFECT LOCUS]
      Logger.warn("[SdkController] done with no committed terminal
                   response; yielding turn as awaiting_followup (liveness)");

      this.options.setTurnPhase?.(
        "awaiting_followup",
        undefined,
        "session-event-turn-complete-resumable-straggler-preserve"
      );
    }
```

## 4. The defect locus: `ownerStillRunning === false` does NOT imply operator-handoff

The Q5 guard chain has ONE binary input:
  `hasRunningBackgroundJobForOwner(activeSessionId) === boolean`

This input is the canonical REI projection (RealJobStillRunning). It
answers the question "does THIS owner still have a RUNNING job?".

But there are SIX distinct shapes of "outstanding autonomous work":

```text
  Shape A. RUNNING job (BCAFG01 owner)
    hasRunningBackgroundJobForOwner(activeSessionId) === true
    → ownerStillRunning === true
    → defer (BTCONT01 marker recorded)
    → CORRECT: ACTUALLY outstanding work

  Shape B. RUNNING job with notify-marker registered (BCNT01 owner)
    hasRunningBackgroundJobForOwner(activeSessionId) === true
    AND backgroundNotifyCoordinator.activeNotifyCountForOwner(sid, tid) > 0
    → ownerStillRunning === true
    → defer
    → CORRECT: outstanding work AND wake will be enqueued on terminal

  Shape C. STOPPED job (deferred-continuation marker armed)
    hasRunningBackgroundJobForOwner(activeSessionId) === false
    AND this.deferredContinuation !== undefined
    AND marker.sessionId === activeSession.sessionId
    AND marker.taskId === taskId
    → ownerStillRunning === false
    → commit awaiting_followup
    → ALREADY HANDLED by BTCONT01 — this is the post-terminal-02 GREEN
       path where the re-evaluateDeferredContinuation commits exactly
       once after all jobs are gone.

  Shape D. STOPPED job (terminal-wake ALREADY enqueued, no Q5 marker yet)
    hasRunningBackgroundJobForOwner(activeSessionId) === false
    AND this.deferredContinuation === undefined
    AND backgroundNotifyCoordinator has NO active markers
      BUT pendingPromptsController.list(activeSessionId).length > 0
    → ownerStillRunning === false
    → commit awaiting_followup ← THE DEFECT
    → CORRECT BEHAVIOR: respect the queued wake — preserve streaming,
       commit deferred-continuation marker so terminal-idle re-evaluation
       (which already exists) commits awaiting_followup after the wake
       has been delivered. NOT awaiting_followup NOW.

  Shape E. STOPPED job (terminal-wake PENDING, notify-marker exists)
    hasRunningBackgroundJobForOwner(activeSessionId) === false
    AND this.deferredContinuation === undefined
    AND backgroundNotifyCoordinator.activeNotifyCountForOwner(sid, tid) > 0
    → ownerStillRunning === false
    → commit awaiting_followup ← ALSO A DEFECT (smaller window)
    → Edge case: held-result marker could be present while no jobs
      are running if consumeTerminal deferred the wake due to
      REMAINING_NOTIFY_COUNT > 0 and then ALL remaining markers
      were cleared by some other path.

  Shape F. STOPPED job (no outstanding work)
    hasRunningBackgroundJobForOwner(activeSessionId) === false
    AND this.deferredContinuation === undefined
    AND pendingPromptsController.list(activeSessionId).length === 0
    AND backgroundNotifyCoordinator.activeNotifyCountForOwner(sid, tid) === 0
    → ownerStillRunning === false
    → commit awaiting_followup ← CORRECT (genuine operator handoff)
```

The DEFECT is Shape D (and edge-case Shape E).

The Q5 guard chain has NO visibility into:
  1. The BackgroundNotifyCoordinator active marker count
  2. The PendingPromptsController queue length

So when Shape D occurs (terminal-wake already enqueued, agent
emits done-without-completion), the Q5 seam commits awaiting_followup
even though a queued prompt is sitting in the queue.

## 5. Concrete RED reproduction of Shape D

The defect requires a specific chronology. The actual production
chronology is:

```text
  T0: agent starts run_commands(notifyOnCompletion: true)
      [REAL_PRODUCTION_SEAM]
      → tool execute() returns { state: "running", jobId: "j1" }
      → vscode-run-commands-tool.ts registers notifyOnCompletion metadata
      → BackgroundNotifyCoordinator.registerMarker(jobId=j1, sid, tid)
      → activeJobs count = 1

  T1: J1 terminates QUICKLY (faster than model emits done)
      [REAL_PRODUCTION_SEAM]
      → CommandJobManager: terminalPromise resolves
      → onTerminal(jobId=j1, terminalState="completed")
      → BackgroundNotifyCoordinator.consumeTerminal(j1):
          - marker exists, no remaining markers, owner matches
          - DRAIN: enqueueTerminalWake({ sessionId, prompt })
          - activeSession.sdkHost.send({ ..., delivery: "queue" })
          - LocalRuntimeHost.runTurn: delivery="queue" → controller.enqueue
          - PendingPromptsController.enqueue(...) ← QUEUED PROMPT
          - held.delete, marker.delete
          - returns { kind: "drained", drainedCount: 1, enqueuedNow: true }
      → CommandJobManager: onBackgroundStateChange(running=false, jobId=j1)
      → SdkController.updateBackgroundCommandState(false, j1)
        → Controller.maybeReevaluateDeferredContinuation(true, false, ...)
        → sessionEvents.reevaluateDeferredContinuation():
          - NO DeferredContinuation marker exists yet (Q5 has not fired)
          - return without committing

  T2: agent emits done-without-completion
      [REAL_PRODUCTION_SEAM]
      → SdkSessionEventCoordinator.handleSessionEvent(agent_event done)
      → result.turnComplete === true
      → Branch 4 (Q5): guard = hasRunningBackgroundJobForOwner(activeSessionId)
      → ownerStillRunning === false (J1 is gone since T1)
      → *** DEFECT: setTurnPhase("awaiting_followup", ...) ***
      → Phase = "awaiting_followup"

  T3: webview shows "Your turn" (awaiting_followup)
      [REAL_PRODUCTION_SEAM — webview label authority]
      The queued prompt from T1 sits in PendingPromptsController, waiting.
      No autonomous turn starts.
      The user sees "Your turn" but the model already has work outstanding
      in the queue that, if respected, would start an autonomous turn.
```

This is the false-positive "Your turn". The user's question
"why does the harness hand off to the operator when the task has
unfinished autonomous work and no operator input is required?"
maps directly to Shape D.

## 6. Repair authority at the Q5 boundary (revised)

The bounded repair is to add ONE additional read at the Q5 boundary:

```text
at sdk-session-event-coordinator.ts:387-514 (Branch 4 / done-without-completion):

  BEFORE the if (ownerStillRunning) check:
    const ownerStillRunning = ...
    const pendingPromptCount = this.options.getPendingPromptCount?.(activeSessionId) ?? 0
    const activeNotifyCount = this.options.getActiveNotifyCount?.(activeSessionId, this.options.getTask?.()?.taskId) ?? 0
    const outstandingAutonomousWork = ownerStillRunning || pendingPromptCount > 0 || activeNotifyCount > 0

  REPLACE:
    if (ownerStillRunning) { defer + register DeferredContinuation marker }
    else { commit awaiting_followup }

  WITH:
    if (outstandingAutonomousWork) {
      // Same defer path as before — register the marker so terminal-idle
      // re-evaluation commits awaiting_followup exactly once, after the
      // outstanding wake has been delivered to the next turn.
      this.deferredContinuation = {
        sessionId: activeSession.sessionId,
        taskId: this.options.getTask?.()?.taskId,
        epoch: this.options.messageTranslatorState.getMinter().epoch,
        deferredAt: Date.now(),
      }
    } else {
      // Genuine operator handoff (Shape F).
      setTurnPhase("awaiting_followup", ..., writerId)
    }
```

This is a STRICT SUPERSET of the existing BCAFG01 + BTCONT01 path.
The marker-preserved-on-defer semantics remain unchanged. The only
difference: Shape D and Shape E are now also deferred, and the
terminal-idle re-evaluation commits awaiting_followup once the
pending prompts have been delivered.

The new option `getPendingPromptCount` is added to
`SdkSessionEventCoordinatorOptions` and wired by SdkController to a
thin adapter that calls `host.pendingPrompts.list({ sessionId }).length`.

The new option `getActiveNotifyCount` is added (or, equivalently,
the existing `BackgroundNotifyCoordinator.activeNotifyCountForOwner`
is exposed via an option) and wired by SdkController to the existing
coordinator.

## 7. Why this is the smallest correct repair

The repair:
  1. Adds ONE new condition (`outstandingAutonomousWork`) that
     combines three existing canonical projections:
     - hasRunningBackgroundJobForOwner (BCAFG01)
     - pendingPromptsController.list (PendingPrompts)
     - BackgroundNotifyCoordinator.activeNotifyCountForOwner (BCNT01)
  2. Re-uses the existing DeferredContinuation marker (BTCONT01)
     — no new marker type.
  3. Re-uses the existing Controller.maybeReevaluateDeferredContinuation
     bridge (BTCONT01) — no new bridge.
  4. Preserves the existing conservation rules (BTCONT-CTL-01..07).
  5. Does NOT touch the TaskHeader projection (separate concern).
  6. Does NOT redefine the operator-demand signals (kept as
     `operatorDemandPresent` per ACT §5 — see discriminator file).
  7. Does NOT add a new TurnPhase value. The existing
     `awaiting_followup` is correct; we just defer the COMMIT
     until the autonomous work has been consumed.


