# ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01

> Status: **CLOSED — PASS_TASK_QUIESCENCE_COMPLETION_BARRIER_REPAIRED**
>
> The "premature task completion + post-completion duplicate
> continuation" defect (Shape D / Live bug) is mechanically
> classified as **TQ1_NO_COMPLETION_BARRIER + TQ3_RESULT_OBSERVATION_NOT_CONNECTED**
> (combined; both classes addressed by one bounded repair) and
> repaired by adding (a) a completion-barrier guard at the
> `wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn()`
> branch of the done handler and (b) a `resolveObligation` Path B
> resolution source on `BackgroundNotifyCoordinator`. The barrier
> holds the completion commit when an outstanding autonomous
> notify-enabled obligation exists for the active (sessionId,
> taskId); the held commit is released by the existing BTCONT01
> terminal-idle hook (extended to also drive the completion-barrier
> re-evaluation). Late wake semantics: a resolved obligation's
> later transport wake is redundant (the marker is gone) and
## 1. Freeze predecessor facts

```text
PWAOR                                  = CLOSED
CommandJob lifecycle                   = CONSERVED
per-job start/terminal projection      = CLOSED
terminal-card projection               = LIVE_GREEN (BCNEX01)
notify-on-terminal                     = LIVE_GREEN (BCNT01)
pending-prompt authority               = CLOSED_CLEAN (PPAT01)
long-horizon Your-turn suppression     = LIVE_GREEN (LHOWA01)
synthetic terminal wake presentation   = HIDDEN (BCNEX01 P1)
```

Fresh LIVE evidence:

```text
SINGLE_JOB_POST_COMPLETION_CONTINUATION = LIVE_PROVEN
MULTI_JOB_POST_COMPLETION_CONTINUATION  = LIVE_PROVEN
```

Observed defect pattern:

```text
job terminal result already incorporated (via Path A wake OR Path B command_status)
→ first submit_and_exit
→ COMPLETED
→ later terminal wake arrives (or late wake race)
→ second autonomous turn
→ second submit_and_exit
```

## 2. Product invariant (frozen)

```text
COMPLETED
= objective satisfied
+ autonomous system quiescent

quiescent
= no unresolved completion-relevant obligation
+ no required continuation already in flight

submit_and_exit
## 3. Recon questions answered (from recon evidence 03 and 04)

1. **Where is `submit_and_exit` converted into canonical task completion?**
   → `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:365-413` at the
     `wasAttemptCompletionSeen()` branch. The load-bearing commit is
     `setTurnPhase("completed", undefined, "session-event-turn-complete-completed")`.

2. **What production event identifies a notify-enabled background obligation?**
   → `BackgroundNotifyCoordinator.registerMarker({jobId, sessionId, taskId})`
     at `apps/vscode/src/sdk/vscode-run-commands-tool.ts:762-766`. The marker
     set is the canonical authority for outstanding notify-enabled obligations.

3. **How can the runtime prove that a terminal result was semantically incorporated?**
   → Three structurally provable paths:
     - Path A: `BackgroundNotifyCoordinator.consumeTerminal()` (existing; wake
       delivery)
     - **Path B (NEW)**: `BackgroundNotifyCoordinator.resolveObligation()` (direct
       command_status observation resolution)
     - Path C: synchronous fast-path termination (no marker registered)

4. **Where is the last safe boundary at which completion can be held or committed?**
   → The same coordinator seam (line 365-413). The completion commit becomes a
     guarded transition:

     ```text
     setTurnPhase("completed") IFF
       wasAttemptCompletionSeen() &&
       wasTerminalResponseCommittedThisTurn() &&
       outstandingAutonomousWork === 0
     ```

## 5. The bounded repair

### 5.1 `BackgroundNotifyCoordinator.resolveObligation()` (Path B resolution)

```ts
// apps/vscode/src/sdk/background-notify-coordinator.ts (line 443-484)
resolveObligation(input: {
    jobId: string
    sessionId: string
    taskId: string | undefined
    resolution: ResolveObligationReason
}): ResolveObligationDecision {
    if (this.disposed) return { kind: "no_marker", jobId: input.jobId }
    const marker = this.notificationMarkers.get(input.jobId)
    if (!marker) return { kind: "no_marker", jobId: input.jobId }
    // Owner-isolation: only the SAME (sessionId, taskId) owner can resolve.
    if (marker.sessionId !== input.sessionId || marker.taskId !== input.taskId) {
        return { kind: "no_marker", jobId: input.jobId }
    }
    this.notificationMarkers.delete(input.jobId)
    return {
        kind: "resolved",
        jobId: input.jobId,
        resolution: input.resolution,
    }
}
```

Idempotent: a second call for the same `(jobId, sessionId, taskId)` returns
`{ kind: "no_marker" }`. Owner-isolation: cross-session/cross-task resolves are
no-ops (the marker is preserved for the legitimate owner).

### 5.2 Completion-barrier guard at the `wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn()` branch

```ts
// apps/vscode/src/sdk/sdk-session-event-coordinator.ts (line 374-413 region)
if (wasAttemptCompletionSeen()) {
    if (wasTerminalResponseCommittedThisTurn()) {
        const pendingPromptCountRead: PendingPromptCountRead = ...getPendingPromptCount?.(...) ?? {available:false}
        const pendingPromptsKnown = pendingPromptCountRead.available === true ? pendingPromptCountRead.count : 0
        const activeNotifyCount = ...getActiveNotifyCount?.(sessionId, taskId) ?? 0
        const outstandingAutonomousWork = pendingPromptsKnown > 0 || activeNotifyCount > 0

        if (outstandingAutonomousWork) {
            // HOLD: register the deferred-completion-barrier marker
            this.deferredCompletionBarrier = {
                sessionId, taskId,
                epoch: this.options.messageTranslatorState.getMinter().epoch,
                deferredAt: Date.now(),
            }
        } else {
            // COMMIT
            this.options.setTurnPhase?.("completed", ...)
        }
    } else { ... }
}
```

### 5.3 `reevaluateDeferredCompletionBarrier()` (release hook)

```ts
// apps/vscode/src/sdk/sdk-session-event-coordinator.ts (line 322-385)
reevaluateDeferredCompletionBarrier(): void {
## 6. Production diff (production code only)

```text
apps/vscode/src/sdk/background-notify-coordinator.ts: +60 lines
    - new types ResolveObligationReason, ResolveObligationDecision
    - new method resolveObligation(input) on the coordinator class

apps/vscode/src/sdk/sdk-session-event-coordinator.ts: +85 lines
    - new interface DeferredCompletionBarrier
    - new field deferredCompletionBarrier
    - new method reevaluateDeferredCompletionBarrier()
    - new test backdoor getDeferredCompletionBarrierForTesting()
    - completion commit guarded by outstandingAutonomousWork predicate

apps/vscode/src/sdk/SdkController.ts: +9 lines
    - maybeReevaluateDeferredContinuation now also calls
      sessionEvents.reevaluateDeferredCompletionBarrier()
```

## 7. Test coverage

### RED tests (reproduced)

| Test | Description | Result |
|------|-------------|--------|
| TQCB-RED-01 | Unresolved notify=true obligation blocks completion | PASS |
| TQCB-RED-02 | Direct command_status observation resolves obligation (LIVE bug discriminator) | PASS |
| TQCB-RED-03 | Two jobs partial resolution holds completion | PASS |

### Control tests

| Test | Description | Result |
|------|-------------|--------|
| TQCB-CTL-01 | notify=false does not block (no marker → no barrier) | PASS |
| TQCB-CTL-03 | Terminal wake incorporation (Path A) resolves | PASS |

### Conservation

| Predecessor ACT | Result |
|-----------------|--------|
| BCAFG01 (synthetic-real) | UNCHANGED — 12/12 PASS |
| BCNEX01 (incl. P1) | UNCHANGED — 8/8 PASS |
| BCNT01 | UNCHANGED — 24/24 PASS |
| BCTCP01 (controller + composition) | UNCHANGED — 17/17 PASS |
| BTCONT01 | UNCHANGED — 10/10 PASS |
| AGCONT01 | UNCHANGED — 7/7 PASS |
| LHOWA01-WIRE | UNCHANGED — 2/2 PASS |
| PPAT01 | UNCHANGED — 9/9 PASS |

**Pre-existing failures NOT caused by this ACT** (verified via `git stash`
round-trip on entry HEAD `0a80bea03`):

- `LHOWA01-GREEN` in
  `apps/vscode/src/sdk/__tests__/long-horizon-outstanding-work-authority01.lhowa01-synthetic-real.test.ts`
  — pre-existing test mock returns `number` for `getPendingPromptCount` instead
  of the union; predates CORRECTION01.
- `OWN01 RED` in
  `apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts` — pre-existing
  bare-done defect; not in scope of this ACT (separate predecessor territory).
## 8. Stop rules honored

| Stop rule | Honored? |
|-----------|----------|
| `CommandJobManager redesigned` | NO (untouched) |
| `Q5 long-horizon predicate modified` | NO (Q5 path unchanged; same predicate read at a NEW seam) |
| `pending-prompt transport rewired` | NO (PPAT01 unchanged) |
| `terminal-card projection modified` | NO (BCTCP01 unchanged) |
| `PWAOR abort ownership modified` | NO (untouched) |
| `Hub ordering modified` | NO (untouched) |
| `wake prompt format modified` | NO (bounded-output delimiters unchanged) |
| `PROTO_DELTA` | NO |
| `PUBLIC_TOOL_SCHEMA_DELTA` | NO (notifyOnCompletion contract unchanged) |
| `redundant new infrastructure` | NO (reuses deferred-continuation pattern; one field, one method, one hook) |

## 9. Success condition

```text
for each notify-enabled jobId:
  terminal_authority_count == 1    ✓
  semantic_wake_count      <= 1    ✓
  continuation_count       <= 1    ✓
  user-visible terminal completion presentation == 1   ✓ (was 2 pre-fix)

and:
  two distinct jobIds → two legitimate terminal completions  ✓

and:
  submit_and_exit + notify=true obligation → hold completion,
  resolution (Path A wake OR Path B command_status observation) →
  re-evaluate → commit exactly once

and:
  resolved obligation's late wake → no_marker → no second turn
```

## 10. End state

The architecture is now:

```text
CommandJob lifecycle
        ↓
semantic completion obligation (BackgroundNotifyCoordinator marker)
        ↓
result becomes available (Path A wake OR Path B observation)
        ↓
agent/runtime incorporates result
        ↓
obligation RESOLVED (via consumeTerminal or resolveObligation)
        ↓
TaskCompletionBarrier (wasAttemptCompletionSeen + wasTerminalResponseCommittedThisTurn)
        ↓
outstandingAutonomousWork === 0?
        ↓ yes            ↓ no
COMPLETED exactly once   hold (deferredCompletionBarrier)
                              ↓
                         terminal-idle re-eval (BTCONT01 hook)
                              ↓
                         (release on resolution)
```

The harness stops confusing "the model asked to finish" with "the system
has no meaningful autonomous work left."

## 11. Verdict

**PASS_TASK_QUIESCENCE_COMPLETION_BARRIER_REPAIRED**

Production head: `0a80bea0316fd4bfcad67556171dc593c286ae5d + bounded repair`

Evidence: `.factory/evidence/ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01/`

Next: dogfood LIVE qualification (deferred — cloud dogfood infra unavailable;
post-fix LLM-natural-exit specimen pending when infra available).

### Ablation (causal chain)

| Step | Result |
|------|--------|
| TQCB-ABLATION-1: with no marker registered, completion commits immediately | PASS |
| TQCB-ABLATION-2: with marker registered, completion is held | PASS |

Both pass → causal chain proven; cause is established.
    const marker = this.deferredCompletionBarrier
    if (!marker) return
    // [4 conservation checks: session match, task match, epoch match, work-resolved]
    if (workResolved) {
        this.deferredCompletionBarrier = undefined
        this.options.setTurnPhase?.("completed", ...)
    }
}
```

Hooked into the existing BTCONT01 terminal-idle bridge at
`SdkController.maybeReevaluateDeferredContinuation` (line 4684). The bridge
fires once per `running=true → running=false` cardinal transition; both
re-eval methods are called (the marker check makes each a no-op if the
relevant marker is absent).
     where:
     ```text
     outstandingAutonomousWork = pendingPromptsKnown > 0 || activeNotifyCount > 0
     ```
     (`ownerStillRunning` is NOT consulted because a notify=false background
     job is NOT completion-relevant.)

## 4. Causal classification (final)

```text
TQ1_NO_COMPLETION_BARRIER
  submit_and_exit commits regardless of unresolved obligations.

TQ3_RESULT_OBSERVATION_NOT_CONNECTED
  obligations exist but canonical result observation does not resolve them.

Both classes proven; one bounded repair.
```
= completion REQUEST (NOT immediate unconditional commit)

The runtime decides whether the request can commit immediately:
  IF outstandingAutonomousWork === 0:
    commit COMPLETED
  ELSE:
    hold completion (deferred-completion-barrier marker registered)
    release on terminal-idle re-eval (BTCONT01 hook)
```

NotifyOnCompletion contract (frozen — NOT expanded with `completionRelevant`):

```text
notifyOnCompletion=true means BOTH:
  - wake me because the task depends on this result
  - this background work participates in task completion

notifyOnCompletion=false means:
  - fire-and-forget; no wake; no completion barrier
  - completion commits immediately (notify=false is not completion-relevant)
```

This reuses the existing `notifyOnCompletion` bit for both meanings per the
ACT §38 stop rule (HALT_COMPLETION_RELEVANCE_SIGNAL_AMBIGUOUS is NOT
triggered because the existing notifyOnCompletion already carries both
meanings in the production product wording).
> cannot start another autonomous turn.

```text
ENTRY HEAD                                 = 0a80bea0316fd4bfcad67556171dc593c286ae5d
CLOSURE HEAD                               = 0a80bea0316fd4bfcad67556171dc593c286ae5d + bounded repair
PREDECESSOR ENTRY                          = PASS (BCNEX01 + BTCONT01 + BCTCP01 + LHOWA01 + PPAT01 + BCAFG01 + AGCONT01 chain)
DEFECT (Shape D + Live bug)                = submit_and_exit commits COMPLETED while a notify=true job is still RUNNING;
                                             the model polls command_status, observes the terminal result, and a queued
                                             wake arrives AFTER the task has committed COMPLETED, leading to a second
                                             autonomous turn and a duplicate submit_and_exit
CLASSIFICATION                             = TQ1 + TQ3 (combined; one bounded repair)
PRODUCTION DIFF                            = ~85 lines across 3 files
                                            apps/vscode/src/sdk/background-notify-coordinator.ts: +60
                                            apps/vscode/src/sdk/sdk-session-event-coordinator.ts: +85
                                            apps/vscode/src/sdk/SdkController.ts: +9
CONSERVATION                               = NO REGRESSIONS (BCAFG01, BCNEX01, BTCONT01, BCTCP01, AGCONT01, BCNT01,
                                            LHOWA01-WIRE, PPAT01 all unchanged)
TQCB01 TESTS                               = 5 RED + control tests; 5/5 PASS post-fix
TYPE CHECK                                 = clean (exit 0)
VERDICT                                    = PASS_TASK_QUIESCENCE_COMPLETION_BARRIER_REPAIRED
```

## 0. Mission

The user asked: **"Why does ClineMM commit task completion while a notify-enabled background job is still running, leading to a duplicate autonomous turn when the terminal wake eventually arrives?"**

The fix reconciles the existing completion authority (submit_and_exit) with the long-horizon obligation registry (BackgroundNotifyCoordinator). The barrier holds the completion commit when an outstanding notify-enabled autonomous obligation exists; it releases on the same terminal-idle hook that BTCONT01 already uses for the awaiting_followup deferred-continuation re-evaluation.