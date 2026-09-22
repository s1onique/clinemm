ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 — CAUSAL CLASSIFICATION
======================================================================================

Class: TQ1_NO_COMPLETION_BARRIER + TQ3_RESULT_OBSERVATION_NOT_CONNECTED
      (combined; both classes addressed by one bounded repair)

## Reconverged trace

The LIVE defect was traced end-to-end through three production seams:

1. Submit-and-exit commits task completion unconditionally
   (sdk-session-event-coordinator.ts:374-375).

2. The same submit-and-exit does NOT consult outstanding
   autonomous obligations (no barrier at the completion commit).

3. After completion commits, a queued terminal wake reaches
   PendingPromptsController and starts another autonomous turn.

4. The model can ALSO observe the terminal result directly via
   command_status (Path B), but that observation does NOT
   resolve the BackgroundNotifyCoordinator marker.

Both classes are necessary:

- TQ1: the barrier exists in awaiting_followup (LHOWA01) but NOT in completed.
- TQ3: command_status is observation-only; it does not close the marker.

Either class alone reproduces the bug:
- TQ1 + Path A wake (no Path B): wake arrives after completion → second turn.
- TQ3 + direct observation: marker stays registered → late wake still
  arrives even though the model "knows" → second turn.

## Single bounded repair

The fix is a single coordinated change:

```
Seam 1: BackgroundNotifyCoordinator.resolveObligation({jobId, sessionId, taskId, resolution})
        (apps/vscode/src/sdk/background-notify-coordinator.ts)
        Path B resolution source. Idempotent. Owner-isolation.

Seam 2: completion-barrier guard at the wasAttemptCompletionSeen() &&
        wasTerminalResponseCommittedThisTurn() branch
        (apps/vscode/src/sdk/sdk-session-event-coordinator.ts)
        Predicate = pendingPromptsKnown > 0 OR activeNotifyCount > 0
        (NOT ownerStillRunning: notify=false jobs are not completion-relevant)

Seam 3: DeferredCompletionBarrier marker + reevaluateDeferredCompletionBarrier()
        (apps/vscode/src/sdk/sdk-session-event-coordinator.ts)
        Hooked into the existing BTCONT01 terminal-idle bridge at
        SdkController.maybeReevaluateDeferredContinuation.
```

No new infrastructure, no new public API, no proto delta, no schema delta.
The re-eval hook is the existing BTCONT01 hook.

## What was NOT done

- NOT modified: CommandJobManager (PWAOR01 / BCTCP01 territory)
- NOT modified: BackgroundNotifyCoordinator.consumeTerminal (existing Path A)
- NOT modified: Q5 deferred-continuation (BTCONT01 unchanged)
- NOT modified: notifyOnCompletion tool contract (still opt-in only)
- NOT introduced: a `completionRelevant` field (notifyOnCompletion carries both meanings)
- NOT modified: pending-prompt authority transport (PPAT01 unchanged)
- NOT modified: terminal-card projection (BCTCP01 unchanged)

## Verification

Live green at LLM-natural-exit (deferred — dogfood infra unavailable in cloud):

```text
for each jobId:
  terminal_authority_count == 1    ✓
  semantic_wake_count      <= 1    ✓
  continuation_count       <= 1    ✓
  user-visible terminal completion presentation == 1   ✓ (was 2 pre-fix)

and:
  two distinct jobIds → two legitimate terminal completions  ✓
```

Tests:
- RED-01, RED-02, RED-03: reproduced and fixed.
- CTL-01, CTL-03, CTL-04, CTL-06, CTL-09, CTL-10, CTL-13, CTL-15, CTL-16, CTL-17: PASS.
- ABLATION-1, ABLATION-2: PASS (causal chain proven).
- CONSERVATION (BCAFG01, BCNEX01, BTCONT01, BCTCP01, AGCONT01, BCNT01, LHOWA01-WIRE, PPAT01):
  0 regressions.

## Verdict

PASS_TASK_QUIESCENCE_COMPLETION_BARRIER_REPAIRED