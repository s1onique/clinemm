ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 — OPERATOR-DEMAND INVENTORY
======================================================================================

> Inventory every production writer of operator-demand signals (i.e.
> every place that AUTHORIZES a true AWAITING_OPERATOR transition).
> Every signal labelled with epistemic weight.

## 1. The canonical operator-demand signals already present in production

### Signal 1.1 — explicit user question (ask: "followup_question" / "question")

```text
[REAL_PRODUCTION_SEAM]

  apps/vscode/src/sdk/message-translator.ts
    → produces a ClineMessage with type="ask", ask="followup_question"
                                OR type="ask", ask="question"
    → askResponse(...) is the operator-demand consumer

  apps/vscode/src/sdk/SdkController.ts:2141 (controller-ask-response writer)
    → writerId = "controller-ask-response"
    → commits "streaming" (the new turn is starting)
    → preceded by an ask message that the webview renders as a question

  → AUTHORITATIVE operator-demand: ask message present + no streaming
    turn yet → AWAITING_OPERATOR is the correct phase.
```

### Signal 1.2 — tool approval request (approval_requested)

```text
[REAL_PRODUCTION_SEAM]

  apps/vscode/src/sdk/message-translator.ts
    → produces a ClineMessage with type="ask", ask="tool" (legacy)
                                OR type="say", say="approval_requested"
    → shadow projection at task-state-shadow-recorder.ts:108
      promotes activity.awaitingApproval=true

  apps/vscode/webview-ui/src/components/chat/task-header/
    → TaskHeader label "Approval" with glyph "?"
    → buttonConfig.ts:394 renders Approve/Reject buttons

  → AUTHORITATIVE operator-demand: approval_requested emitted AND no
    streaming turn → AWAITING_OPERATOR-equivalent (UI: "Approval").
```

### Signal 1.3 — plan-mode response (plan_mode_respond)

```text
[REAL_PRODUCTION_SEAM]

  sdk/packages/core/src/extensions/tools/definitions.ts (plan_mode_respond tool)
    → produces a ClineMessage with type="ask", ask="plan_mode_respond"
    → the agent is awaiting user plan approval

  → AUTHORITATIVE operator-demand: plan_mode_respond ask emitted AND no
    streaming turn → AWAITING_OPERATOR (UI: "Your turn" or plan variant).
```

### Signal 1.4 — api_req_failed (provider error)

```text
[REAL_PRODUCTION_SEAM]

  apps/vscode/src/sdk/message-translator.ts
    → produces a ClineMessage with type="ask", ask="api_req_failed"
    → Q5 Branch 2: wasErrorSeen() === true → setTurnPhase("error", ...)
    → webview shows "Error" + Retry/Start New Task buttons

  → AUTHORITATIVE operator-demand: api_req_failed ask emitted AND
    wasErrorSeen() === true → phase="error" (NOT awaiting_followup).
    This is CORRECT — the harness does NOT commit awaiting_followup when
    an operator-demand signal is present (Branch 2 fires first).
```

### Signal 1.5 — question that the agent asked in its turn

```text
[REAL_PRODUCTION_SEAM]

  Same as Signal 1.1. The agent emits ask: "question" mid-turn, then
  emits done-without-completion (the question IS the completion).

  → In current production, this is handled correctly because
    wasAttemptCompletionSeen() === false (no completion tool called)
    BUT the question message is in the messages array, AND
    Branch 1 (straggler) does not fire, AND
    Branch 2 (error) does not fire, AND
    Branch 3 (completion) does not fire.
    So Branch 4 (Q5) fires and commits awaiting_followup.
    This is CORRECT — the question is in the transcript and the
    webview renders the question.
```

## 2. Signals that are NOT operator-demand (the false-positive family)

### Signal 2.1 — background job RUNNING (BCAFG01)

```text
[REAL_PRODUCTION_SEAM]

  CommandJobManager.hasRunningBackgroundJobForOwner(activeSessionId) === true
    → Q5 Branch 4: defer (BTCONT01 marker registered)
    → phase stays at the prior phase (typically "streaming")

  → NOT operator-demand. The harness correctly does NOT commit
    awaiting_followup. The Phase stays "streaming" (or whatever the
    pre-done phase was) so the operator sees "Backgrounded" + Cancel.
```

### Signal 2.2 — background job terminal-wake pending (BCNT01 / NEW)

```text
[REAL_PRODUCTION_SEAM — EXISTS but invisible to Q5]

  BackgroundNotifyCoordinator.activeNotifyCountForOwner(sid, tid) > 0
    → terminal wake will be enqueued into PendingPromptsController on
      terminality
    → Q5 Branch 4 does NOT consult this
    → DEFECT: Shape D, Shape E

  OR

  PendingPromptsController.list(activeSessionId).length > 0
    → terminal wake already enqueued
    → Q5 Branch 4 does NOT consult this
    → DEFECT: Shape D
```

### Signal 2.3 — deferred-continuation marker armed (BTCONT01)

```text
[REAL_PRODUCTION_SEAM — exists via SdkSessionEventCoordinator.deferredContinuation]

  this.deferredContinuation !== undefined
    → marker is re-evaluated when active job count drops
    → Q5 Branch 4 does NOT consult the marker presence (the marker is
      CREATED in Branch 4 when ownerStillRunning === true; re-evaluated
      by maybeReevaluateDeferredContinuation when job terminates)
    → NOT a defect: BTCONT01 GREEN covers this via the re-evaluation path
```

## 3. The discriminator: operatorDemandPresent

The Q5 Branch 4 must answer ONE yes/no question:

```text
operatorDemandPresent:
    wasErrorSeen()                                          // Signal 1.4
  || wasAttemptCompletionSeen() === false
       && (?? check for outstanding autonomous work ??)
```

In CURRENT production (pre-this-ACT), operatorDemandPresent is
PARTIALLY OBSERVED:
  - wasErrorSeen() → Branch 2 fires first (correct)
  - wasAttemptCompletionSeen() && !terminalResponseCommitted
    → Branch 3 fallback fires (correct — "awaiting_followup" with
      the completion message in the transcript)
  - else (no completion, no error) → Branch 4 fires (Q5)

In Branch 4, the existing condition is:
  ownerStillRunning = hasRunningBackgroundJobForOwner(activeSessionId)

The MISSING condition (post-this-ACT fix):
  outstandingAutonomousWork = ownerStillRunning
                           || pendingPromptCount > 0
                           || activeNotifyCount > 0

Why this is sufficient:
  - If ownerStillRunning === true (Shape A/B), defer (existing BCAFG01).
  - If pendingPromptCount > 0 (Shape D), defer. The wake has already
    been enqueued; the next turn will consume it. Committing
    awaiting_followup NOW would defeat the wake transport.
  - If activeNotifyCount > 0 (Shape E), defer. A marker exists; the
    terminal-wake transport will fire on terminality.
  - Otherwise (Shape F), commit awaiting_followup. Genuine operator
    handoff (e.g., the agent finished and asked nothing).

The discriminator is COMPLETE for the false-positive family. It does
NOT redefine the existing operator-demand signals (Signals 1.1-1.5).

## 4. What "operator demand" is NOT

It is NOT:
  - "model finished streaming" (every done event qualifies; but not
    every done event implies operator input required)
  - "agent has no queued tool calls" (a queued tool call would be
    a separate signal, but absence of one is not operator demand)
  - "background job terminated" (termination is not demand; the
    wake transport handles the continuation)
  - "checkpoint exists" (checkpoints are not demand signals)
  - "task is in plan mode" (plan mode is a tool-policy choice, not
    a demand signal — although plan_mode_respond IS a demand signal)

## 5. Edge cases

### Edge case 5.1 — agent emits done-without-completion while modelStreaming is true (streaming stragglers)

```text
[REAL_PRODUCTION_SEAM]

  Current production: if the agent emits a final chunk
  (text/ts partial=false) and then emits done-without-completion in the
  same event batch, the Q5 commit fires. This is correct — the turn
  is genuinely over.

  No ACT impact. This is the normal flow.
```

### Edge case 5.2 — task is resumed from history

```text
[REAL_PRODUCTION_SEAM]

  Controller.resumeTaskFromHistory / SdkTaskStartCoordinator
    → commits "streaming" via SdkTaskStartCoordinator writer
    → the resumption is NOT an operator-demand signal; it's a
      generation advance (epoch bump)
    → Q5 is not consulted during resume; the phase is committed
      by SdkTaskStartCoordinator directly

  No ACT impact. Resume semantics are owned by other ACTs.
```

### Edge case 5.3 — task is cancelled

```text
[REAL_PRODUCTION_SEAM]

  controller-cancel-task writerId
    → setTurnPhase("resumable", ..., "controller-cancel-task")
    → Q5 Branch 1 fires first on subsequent straggler done events

  No ACT impact. Cancellation semantics are owned by upstream cancel
  path; this ACT does NOT touch the cancel flow.
```

### Edge case 5.4 — extension shutdown during Q5 evaluation

```text
[REAL_PRODUCTION_SEAM]

  SdkController.dispose() → BackgroundNotifyCoordinator.dispose()
    → notificationMarkers.clear(), heldTerminalResults.clear()

  If Q5 fires after dispose() but before the dispose event is fully
  processed, the deferredContinuation marker is still cleared at
  next SdkSessionEventCoordinator construction (the marker is
  per-coordinator-instance).

  No ACT impact. Dispose semantics are owned by the dispose path.
```

## 6. Summary

The Q5 boundary has THREE existing inputs:
  1. `activeSession.isRunning` (owner's streaming state)
  2. `getTurnPhase()` (legacy phase, for straggler detection)
  3. `wasErrorSeen()` (Branch 2 discriminator)
  4. `wasAttemptCompletionSeen()` (Branch 3 discriminator)
  5. `wasTerminalResponseCommittedThisTurn()` (Branch 3 sub-discriminator)
  6. `hasRunningBackgroundJobForOwner(activeSessionId)` (Branch 4
     primary guard, BCAFG01)
  7. `getActiveJobOwnershipSnapshot?.()` (BCOR diagnostic, BOCOR01)

This ACT adds TWO new optional inputs to Branch 4:
  8. `getPendingPromptCount?.(activeSessionId)` (NEW — addresses Shape D)
  9. `getActiveNotifyCount?.(activeSessionId, taskId)` (NEW — addresses Shape E)

Inputs 8 and 9 are STRICT ADDITIONS. They do not change the semantics
of inputs 1-7. Inputs 1-7 continue to drive their existing branches.
Inputs 8-9 only narrow Branch 4's else-branch to defer (instead of
commit) when outstanding autonomous work is detected.

The bounded repair is:
  - Add 2 optional fields to SdkSessionEventCoordinatorOptions
  - Wire them in the SdkController constructor (2 thin adapters)
  - Read them in Branch 4 (1 condition change)
  - Recompute `outstandingAutonomousWork` (1 new local variable)
  - Use it as the new guard condition (1 line change)

Net production diff: ~12-20 lines (excluding tests).




