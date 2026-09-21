ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 — REQUIRED CAUSAL DISCRIMINATOR
=========================================================================================

> The Q5 boundary must answer ONE yes/no question:
> `operatorDemandPresent`.
> This document inventories the discriminator and confirms that the
> information IS observable at the writer boundary.

## 1. The `operatorDemandPresent` discriminator tuple

At the Q5 boundary (sdk-session-event-coordinator.ts:387-514),
the writer captures:

```text
writerId
sessionId
taskId
modelTurnEnded            (always true on entry to Branch 4)
taskCompleted             (Branch 3 covered; Branch 4 means no completion tool used)
activeManagedJobs         (activeJobs.length — already captured via BOCOR01)
pendingTerminalWake       (NEW: count of background-job terminal wakes enqueued into PendingPromptsController)
operatorDemandPresent     (derived from wasErrorSeen / wasAttemptCompletionSeen /
                          pending user questions / approval requests)
continuationAvailable     (NEW: count of pending prompts already in PendingPromptsController)
```

Of these, the ACT adds two NEW fields to the canonical projection:

```text
pendingTerminalWake: number  // count of wakes enqueued by BackgroundNotifyCoordinator
                              // for the active session + task. Backed by the existing
                              // BackgroundNotifyCoordinator.activeNotifyCountForOwner(sid, tid).
                              // (NOT the consumed marker count; the marker is consumed
                              //  in consumeTerminal and the wake has already been enqueued.)

continuationAvailable: number  // count of queued prompts in PendingPromptsController.
                                // Backed by the existing PendingPromptsController.list({sessionId}).length
                                // reach through SdkController.getStateToPostToWebview()
                                // (line 4937) or directly through the host.pendingPrompts accessor.
```

These two are sufficient to distinguish:

```text
  Shape A: activeManagedJobs > 0           (already covered by hasRunningBackgroundJobForOwner)
  Shape D: pendingTerminalWake > 0 || continuationAvailable > 0
                                            (the new projection — wakes enqueued)
  Shape F: all of the above are zero        (genuine operator handoff)
```

## 2. Why the discriminator is COMPLETE

The Q5 guard chain must answer: "is operator input required?"

Existing pre-Branch-4 checks (Branches 1, 2, 3):
  - Straggler after cancel   (Branch 1) — preserves "resumable"
  - Provider error           (Branch 2) — sets "error"
  - Completion tool used     (Branch 3) — sets "completed" / "awaiting_followup"

These already capture EXPLICIT operator-demand signals. They are
NOT the defect locus.

Branch 4 (the defect locus) receives:
  - The agent emitted `done` (model turn ended)
  - No completion tool was used (otherwise Branch 3 fired)
  - No error was seen (otherwise Branch 2 fired)
  - No straggler-after-cancel (otherwise Branch 1 fired)

Branch 4 asks: "the agent stopped without explicit completion;
is the operator the next action, or is autonomous work outstanding?"

The CURRENT answer: "operator" — because the guard chain only
checks `hasRunningBackgroundJobForOwner`.

The COMPLETE answer: "operator iff no outstanding autonomous work".

Outstanding autonomous work is represented by:
  1. `hasRunningBackgroundJobForOwner(activeSessionId)` — existing
  2. `BackgroundNotifyCoordinator.activeNotifyCountForOwner(sid, tid)` — existing
  3. `PendingPromptsController.list({sessionId}).length` — existing

ALL THREE are existing canonical projections. None require new state.
None require new infrastructure. The bounded repair is: consult all
three at the Q5 boundary.

## 3. CAPTURE_INSUFFICIENT verdict — NOT applicable

The ACT §5 specifies:
```text
If that information is not observable at the writer boundary:
    CAPTURE_INSUFFICIENT
    and add only the smallest DEFAULT-OFF/dogfood diagnostic necessary.
```

Information visibility at the Q5 boundary:

| Projection                          | Observable at Q5? | How |
|-------------------------------------|--------------------|-----|
| `hasRunningBackgroundJobForOwner`   | YES                | wired option, BCAFG01 |
| `BackgroundNotifyCoordinator.activeNotifyCountForOwner` | YES (refactor needed) | needs new option wired in SdkController |
| `PendingPromptsController.list({sessionId}).length`     | YES (cached count needed) | needs new option wired in SdkController |
| `wasErrorSeen()`                    | YES                | message-translator |
| `wasAttemptCompletionSeen()`        | YES                | message-translator |

The ACT author can observe the autonomous-work state at the Q5
boundary by adding TWO optional fields to `SdkSessionEventCoordinatorOptions`:

```typescript
getPendingPromptCount?: (sessionId: string | undefined) => number
getActiveNotifyCount?: (sessionId: string | undefined, taskId: string | undefined) => number
```

These are thin synchronous adapters on existing canonical sources
(`host.pendingPrompts.list({sessionId}).length` and
`backgroundNotifyCoordinator.activeNotifyCountForOwner(sid, tid)`).

NO new diagnostics are required. The projection is observably
complete. `CAPTURE_INSUFFICIENT` does NOT apply.

## 4. The capture happens at the writer boundary (Q5)

The capture point is `sdk-session-event-coordinator.ts:387-514`
(the existing Q5 BOCOR capture at line 459-481). The existing capture
records:

```typescript
captureBackgroundOwnerCorrelationRecord({
    event: "background_owner_correlation_decision",
    capturedAt: Date.now(),
    taskId: ...,
    sessionEventSessionId: ...,
    activeSessionId: activeSession.sessionId,
    currentPhase: "streaming",
    candidatePhase: "awaiting_followup",
    guardAvailable: typeof hasRunningBackgroundJobForOwner === "function",
    queriedOwnerSessionId: activeSession.sessionId,
    guardResult: typeof ownerStillRunning === "boolean" ? ownerStillRunning : null,
    activeJobs: getActiveJobOwnershipSnapshot?.() ?? [],
    candidateWriterId: "session-event-turn-complete-resumable-straggler-preserve",
    // NEW FIELDS (post-this-ACT):
    // pendingPromptCount: getPendingPromptCount?.(activeSession.sessionId) ?? 0,
    // activeNotifyCount: getActiveNotifyCount?.(activeSession.sessionId, this.options.getTask?.()?.taskId) ?? 0,
})
```

The capture is gated by the existing `setBackgroundOwnerCorrelationCaptureEnabled`
toggle (default OFF in public, ON in dogfood). Zero semantic delta
when OFF — the if/else evaluates exactly as before.

## 5. The bounded repair shape (re-stated for clarity)

```typescript
// inside Branch 4 (done-without-completion):

// Existing capture (BCAFG01 + BOCOR01):
const ownerStillRunning = this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId) ?? false

// NEW (this ACT):
const pendingPromptCount = this.options.getPendingPromptCount?.(activeSession.sessionId) ?? 0
const activeNotifyCount = this.options.getActiveNotifyCount?.(
    activeSession.sessionId,
    this.options.getTask?.()?.taskId,
) ?? 0
const outstandingAutonomousWork =
    ownerStillRunning || pendingPromptCount > 0 || activeNotifyCount > 0

// REPLACE:
if (ownerStillRunning) { defer + register DeferredContinuation marker }
else { commit awaiting_followup }

// WITH:
if (outstandingAutonomousWork) {
    // Same defer path as BCAFG01 + BTCONT01 — register the marker
    // so terminal-idle re-evaluation commits awaiting_followup exactly
    // once, after the queued wakes have been delivered.
    this.deferredContinuation = {
        sessionId: activeSession.sessionId,
        taskId: this.options.getTask?.()?.taskId,
        epoch: this.options.messageTranslatorState.getMinter().epoch,
        deferredAt: Date.now(),
    }
} else {
    // Genuine operator handoff (Shape F).
    this.options.setTurnPhase?.(
        "awaiting_followup",
        undefined,
        "session-event-turn-complete-resumable-straggler-preserve",
    )
}
```

This adds:
  - 2 new optional fields to `SdkSessionEventCoordinatorOptions` (~4 lines)
  - 2 thin adapters in SdkController (~6 lines)
  - 3 new local reads in Branch 4 (~9 lines)
  - 1 condition change in the if/else (~3 lines)
  - 1 BOCOR capture enrichment (~2 lines)
  - Total: ~24 lines of production diff (excluding tests)


## 6. Production wire-up in SdkController (sketch)

```typescript
// apps/vscode/src/sdk/SdkController.ts

// In the SdkSessionEventCoordinator options (near line 1075):
this.sessionEvents = new SdkSessionEventCoordinator({
    // ... existing options ...
    hasRunningBackgroundJobForOwner: (sid) =>
        this.sessions?.getActiveSession()?.sessionId === sid
            ? this.commandJobManager.hasRunningBackgroundJobForOwner(sid)
            : false,
    // NEW:
    getPendingPromptCount: (sid) => {
        // Synchronous accessor: read the LAST published pendingPrompts
        // count from the controller's in-memory projection.
        return this.lastKnownPendingPromptCountBySession.get(sid ?? "") ?? 0
    },
    getActiveNotifyCount: (sid, tid) => {
        return this.backgroundNotifyCoordinator?.activeNotifyCountForOwner(sid ?? "", tid) ?? 0
    },
})

// At line 4937 (inside getStateToPostToWebview), capture the count:
if (activeSession) {
    try {
        const queuedPrompts = await activeSession.sdkHost.pendingPrompts("list", {
            sessionId: activeSession.sessionId,
        })
        this.lastKnownPendingPromptCountBySession.set(
            activeSession.sessionId,
            queuedPrompts.length,
        )
    } catch (error) {
        Logger.error("[SdkController] Failed to list pending prompts:", error)
    }
}
```

This keeps the Q5 seam SYNCHRONOUS (required for Branch 4 — no awaits)
by reading the LAST PUBLISHED count from a per-session map. The map is
populated by `getStateToPostToWebview()` which is already called
after every state change. The map converges to the live count within
one webview-state-push interval (typically <100ms).

This is the smallest possible synchronous accessor for `pendingPromptCount`
that does NOT introduce an async boundary at the Q5 seam.

## 7. The bounded repair does NOT introduce a new TurnPhase

The existing vocabulary:
  - streaming
  - awaiting_approval
  - awaiting_followup    (← the false-positive we are removing)
  - completed
  - error
  - resumable
  - compacting

The bounded repair does NOT add any new phase. The defer path
preserves the prior phase (typically "streaming") so the webview
shows the prior UI state. The BTCONT01 terminal-idle re-evaluation
commits "awaiting_followup" exactly once, after the queued wakes
have been delivered to the next turn.

If the queued prompt is a wake from a background command, the next
turn consumes it as autonomous work. The webview shows the next
turn's progress.

If the queued prompt is a USER-supplied follow-up (sent while the
turn was active), the same path applies: defer, terminal-idle
re-evaluation commits "awaiting_followup" after the follow-up has
been delivered. The user sees their follow-up being processed.

The success condition is:
```text
AWAITING_OPERATOR  ⇔  operator input is actually required
```

This is preserved. The bounded repair only prevents the
FALSE-POSITIVE AWAITING_OPERATOR.
