ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 — PRODUCT INVARIANT
============================================================================

> Frozen contract candidate (per ACT §2). This is the ACT's
> candidate definition of the long-horizon operator-authority invariant.
> It is NOT a finalized product decision until closure.

## 1. The invariant

```text
AWAITING_OPERATOR  <=>  the harness has an actual operator dependency

where "operator dependency" means ANY of:
  - explicit user question was emitted (ask: question / follow_up_question)
  - tool/permission approval was requested and not yet granted
  - plan/act transition requires user selection
  - retry that needs user intervention (api_req_failed with no auto-retry path)
  - any other product-flagged operator-demand signal
```

## 2. The four-state model

```text
                 (model is running)
        ┌───────────────────────────────┐
        │             active             │  ← setTurnPhase("streaming")
        └───────────────┬───────────────┘
                        │ agent emits done (turn_complete, no completion tool)
                        │
                        ▼
        ┌───────────────────────────────────────────────────────────────┐
        │ operatorDemandPresent?                                         │
        │                                                               │
        │   YES  ─────────────►  AWAITING_OPERATOR  (UI: "Your turn")   │
        │                                                               │
        │   NO                                                          │
        │     │                                                         │
        │     ├─ outstandingBackgroundWake?  ─►  waiting_external       │
        │     │                                    (preserve streaming  │
        │     │                                     or dedicated phase; │
        │     │                                     NO operator handoff)│
        │     │                                                         │
        │     ├─ queuedPromptExists?  ─────►  continued autonomously    │
        │     │                            (next turn consumes the    │
        │     │                             pending prompt; no handoff) │
        │     │                                                         │
        │     └─ (none of the above)   ──────►  AWAITING_OPERATOR       │
        │                                        (UI: "Your turn")      │
        └───────────────────────────────────────────────────────────────┘
```

## 3. The prohibition (load-bearing)

```text
MODEL_DONE alone MUST NOT authorize AWAITING_OPERATOR
```

The previous ACT chain (AGCONT01, BCAFG01, BTCONT01) established that
the system has a STRONG TENDENCY to collapse `done → awaiting_followup`
because:

  1. The Q5 composition seam at SdkSessionEventCoordinator:223-514
     is the SOLE place that decides the terminal phase from a
     done-without-completion event.
  2. Before BCAFG01, that branch unconditionally committed
     awaiting_followup even when hasRunningBackgroundJobForOwner
     returned true (LIVE RED, post-terminal-02 specimen).
  3. BTCONT01 added the deferred-continuation marker, but the
     marker is consulted ONLY on the terminal-idle re-evaluation,
     not BEFORE the initial awaiting_followup commit.
  4. BCNT01 implemented an opt-in notify-on-terminal path, but
     the marker presence is not consulted by the Q5 composition seam
     — only hasRunningBackgroundJobForOwner is.

So a session that:
  (a) has an outstanding background CommandJob (RUNNING), AND
  (b) opted in via `notifyOnCompletion: true`, AND
  (c) the agent emits `done-without-completion`

WILL currently commit awaiting_followup at Q5 (because the
BackgroundNotifyCoordinator's marker is invisible to the Q5
seam), even though the BackgroundNotifyCoordinator has a
pending terminal-wake transport that will, on terminality,
deliver a prompt to PendingPromptsController which the next turn
will consume as autonomous work.

The visible symptom is:

```
Working  →  agent emits done
         →  Backgrounded job still RUNNING (Cancel button visible)
         →  TaskHeader flips to "Your turn" (awaiting_followup)
         →  operator sees "Your turn" while work is outstanding
         →  background job terminates
         →  BackgroundNotifyCoordinator enqueues a prompt
         →  prompt sits in queue until operator does anything
         →  operator confused: "why am I being asked when there's
              work outstanding that the model asked for?"
```

## 4. The bounded repair authority (LH1)

The repair AUTHORITY in this ACT (LH1 — see classification §6) is:

```text
at the Q5 done-without-completion branch:
  if not operatorDemandPresent:
    if backgroundNotifyCoordinator.activeNotifyCountForOwner(activeSessionId, taskId) > 0:
      # outstanding autonomous wake; preserve streaming, do NOT commit awaiting_followup
      # register the deferred-continuation marker (BTCONT01 reuse) so terminal-idle
      # re-evaluation commits awaiting_followup exactly once, after the wake has been
      # delivered
      pass
```

This is the smallest correct repair. It re-uses:

  - The existing BackgroundNotifyCoordinator (BCNT01)
  - The existing DeferredContinuation marker (BTCONT01)
  - The existing Controller.maybeReevaluateDeferredContinuation bridge
  - The existing BTCONT-CTL-* conservation rules

It introduces:

  - ONE additional read of `BackgroundNotifyCoordinator.activeNotifyCountForOwner`
    at the Q5 decision boundary
  - The smallest possible semantic: "if a wake is queued, suppress awaiting_followup
    and register a deferred marker"

## 5. What this ACT explicitly does NOT redefine

This ACT does NOT redefine:

  - The completion-tool authority (submit_and_exit / attempt_completion).
    That is owned by upstream `submit_and_exit` per
    ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01.
  - The cancellation semantics. That is owned by upstream cancel path
    (controller-cancel-task writer identity).
  - The webview label "Your turn". That is owned by
    ACT-CLINEMM-AWAITING-FOLLOWUP-USER-ACTION-SEMANTICS01.
  - The TaskHeader projection. That is owned by
    ACT-CLINEMM-TASKHEADER-* and E7.1 lines.
  - The pending-prompt queue contract. That is owned by the
    PendingPromptsController.

This ACT touches exactly ONE production seam:

```text
sdk-session-event-coordinator.ts:223-514
  the done-without-completion branch
```

The bounded repair is: add ONE new condition to the existing Q5 guard
chain. The new condition reads an existing accessor on an existing
coordinator (BCNT01) and routes to an existing deferral path (BTCONT01).

## 6. Why this is not "Your turn should disappear"

The success condition is NOT "Your turn disappeared". It is:

```text
AWAITING_OPERATOR  ⇔  operator input is actually required
```

Genuine operator dependencies — explicit questions, tool approval,
permission requests, plan/act transitions, retry decisions — MUST
still surface as "Your turn". AWAITING_OPERATOR is the correct
phase for those.

The ACT only targets the FALSE AWAITING_OPERATOR — the case where
the harness commits awaiting_followup despite the existence of
an outstanding autonomous wake that will deliver a prompt into
PendingPromptsController on terminality.

## 7. Verdicts (allowed)

```text
PASS_LONG_HORIZON_OPERATOR_AUTHORITY_REPAIRED
PASS_CASE_LH5_NOT_A_DEFECT
CAPTURE_INSUFFICIENT
HALT_RED_NOT_REPRODUCED
HALT_OPERATOR_DEMAND_AUTHORITY_UNRESOLVED
```

The closing verdict MUST be one of these.

A `PASS_LONG_HORIZON_OPERATOR_AUTHORITY_REPAIRED` verdict requires:

  - RED reproduced on the real production seam (synthetic-real OK)
  - Classification = LH1 (or LH3 with bounded canonical state addition)
  - Bounded repair applied (one new condition on one seam)
  - Conservation: every existing test in the relevant families
    (BCAFG, BTCONT, BCNT, AGCONT) remains GREEN
  - Load-bearing LH-CTL-* suite (12 controls per ACT §9) GREEN
  - Exactly-once continuation invariant preserved
  - Stale-card repair (BCTCP01) and BTCONT-CTL-06/07 conservation unchanged

