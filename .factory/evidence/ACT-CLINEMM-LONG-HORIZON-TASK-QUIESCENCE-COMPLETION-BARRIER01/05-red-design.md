ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 — RED / GREEN DESIGN
======================================================================================

> The RED tests are written first. They define the canonical contract
> for completion-barrier semantics. Each test is structurally-tied to
> a recon-mapped production seam.

## Test file

`apps/vscode/src/sdk/__tests__/long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts`

## Production seams exercised

The test file exercises the FULL PRODUCTION CHAIN where practical:

1. **BackgroundNotifyCoordinator** (real production class):
   - `registerMarker({jobId, sessionId, taskId})` for obligation registration
   - `consumeTerminal({jobId, ...})` for Path A wake delivery (existing)
   - `resolveObligation({jobId, sessionId, taskId, resolution})` (NEW)
     for Path B command_status observation resolution
   - `activeNotifyCountForOwner(sessionId, taskId)` for outstanding count

## RED tests

### TQCB-RED-01 — unresolved running job blocks completion

```ts
Production-shaped chronology:
    T0 task active
    T1 start job B with notifyOnCompletion=true
    T2 register completion obligation B
    T3 B still running
    T4 model invokes submit_and_exit
        → completion tool content_end sets
          setAttemptCompletionSeen + setTerminalResponseCommittedThisTurn
    T5 done agent event
        → setTurnPhase decision at sdk-session-event-coordinator.ts:374

Pre-fix RED:
    setTurnPhase("completed") fires → task COMPLETED.
    Queue length = 1 (wake to be enqueued later).

Post-fix GREEN:
    outstandingAutonomousWork === true
    → setTurnPhase("completed") is SUPPRESSED
    → a DeferredCompletionBarrier marker is registered
    → phase remains "streaming" (pre-existing convention from LHOWA01)

Assertion:
    expect(tracker.currentPhase).not.toBe("completed")
    expect(coordinator.deferredCompletionBarrier).toBeDefined()
```

### TQCB-RED-02 — direct terminal observation resolves obligation

```ts
Production-shaped chronology:
    T0 obligation J registered (notify=true, RUNNING start)
    T1 J terminalizes (sleep 0.05 done)
    T2 model observes canonical terminal state via command_status
       → resolveObligation({jobId, resolution: "canonical_status_observed"})
    T3 model invokes submit_and_exit (terminal_response committed)
    T4 done agent event
        → completion barrier fires
        → outstandingAutonomousWork === 0 → setTurnPhase("completed")

Assertion:
    expect(tracker.currentPhase).toBe("completed")
    expect(coordinator.completionCommitCount).toBe(1)
    expect(notifyCoordinator.activeNotifyCountForOwner(sessionId, taskId)).toBe(0)

CRITICAL TEST: this is the LIVE bug discriminator. Before the
fix, the marker would NOT be resolved by command_status and the
barrier would hold the completion indefinitely. After the fix, the
resolveObligation call clears the marker, and the completion commits.
```

### TQCB-RED-03 — two jobs partial resolution holds completion

```ts
Production-shaped chronology:
    A notify=true (jobId: A)
    B notify=true (jobId: B)
    Both RUNNING, both registered as obligations.

    T1 A terminalizes → wake consumed (Path A) → A RESOLVED
    T2 model invokes submit_and_exit → completion requested

Pre-fix RED:
    setTurnPhase("completed") fires; B is still RUNNING.

Post-fix GREEN:
    outstandingAutonomousWork === true (B still active)
    → setTurnPhase("completed") SUPPRESSED
    → DeferredCompletionBarrier registered

    T3 B terminalizes → wake consumed (Path A) → B RESOLVED
    T4 terminal-idle re-evaluation (BTCONT01 reuses the
       deferred-completion-barrier re-evaluation hook)
       → outstandingAutonomousWork === 0
       → setTurnPhase("completed") fires EXACTLY ONCE

Assertion:
    expect(tracker.currentPhase).toBe("completed")
    expect(coordinator.completionCommitCount).toBe(1)  // exactly-once
```
2. **SdkSessionEventCoordinator** (real production class):
   - `wasAttemptCompletionSeen()` + `wasTerminalResponseCommittedThisTurn()`
     at the `done` agent event branch (line 365-413)
## Control tests (TQCB-CTL-01..18)

### TQCB-CTL-01 — notify=false does not block

```ts
    start daemon with notifyOnCompletion=false
    (no marker registered)
    submit_and_exit

Assertion:
    setTurnPhase("completed") fires immediately.
```

### TQCB-CTL-02 — notify=true active job DOES block

Already covered by TQCB-RED-01.

### TQCB-CTL-03 — terminal wake incorporation resolves

```ts
    register obligation J
    J terminalizes
    consumeTerminal fires (Path A) → marker consumed
    submit_and_exit

Assertion:
    setTurnPhase("completed") fires.
```

### TQCB-CTL-04 — command_status terminal observation resolves

Already covered by TQCB-RED-02.

### TQCB-CTL-05 — queued stale wake after resolution does not start turn

```ts
    register obligation J
    J terminalizes
    command_status returns terminal → resolveObligation (Path B)
    submit_and_exit → COMPLETED
    later terminalPromise for J fires (race)
    consumeTerminal({jobId: J, ...}) → "no_marker" (already resolved)

Assertion:
    no second turn fired (no new runTurn calls)
    setTurnPhase("completed") was called exactly once
```

### TQCB-CTL-06 — two distinct jobs resolve independently

```ts
    register obligation A
    register obligation B
    resolveObligation(A) → A RESOLVED
    submit_and_exit → barrier HOLDS (B still active)
    resolveObligation(B) → B RESOLVED
    terminal-idle re-eval → setTurnPhase("completed") fires

Assertion:
    setTurnPhase("completed") fires EXACTLY ONCE
```

### TQCB-CTL-07 — different task doesn't block

```ts
    register obligation J for (session-A, task-A)
    task B starts
    submit_and_exit for task B
    J for task-A is STILL active

Assertion:
    setTurnPhase("completed") fires (task-A's J does not block task B)
```

### TQCB-CTL-08 — different session doesn't block

```ts
    register obligation J for (session-A, task-A)
    session-B starts
### TQCB-CTL-09 — repeated terminal event idempotent

```ts
    register obligation J
    consumeTerminal(J) — first call
    consumeTerminal(J) — second call (duplicate terminalPromise race)

Assertion:
    first call → marker consumed (no marker)
    second call → "no_marker" (already resolved)
    no error, no state corruption
```

### TQCB-CTL-10 — repeated resolution idempotent

```ts
    register obligation J
    resolveObligation(J) — first call
    resolveObligation(J) — second call (duplicate command_status race)

Assertion:
    first call → marker consumed
    second call → no-op
    activeNotifyCountForOwner = 0
```

### TQCB-CTL-11 — submit_and_exit repeated does not duplicate completion

```ts
    register obligation J
    J terminalizes + wake consumed
    submit_and_exit → COMPLETED (exactly once)
    (subsequent turns cannot call submit_and_exit because task is COMPLETED)

Assertion:
    setTurnPhase("completed") called exactly once
    no double-finalization
```

### TQCB-CTL-12 — operator user message unaffected

```ts
    register obligation J
    operator sends a user message
    submit_and_exit (interleaved)

Assertion:
    operator message path is unaffected by completion barrier
    (the barrier only governs autonomous completion)
```

### TQCB-CTL-13 — cancellation terminal result

```ts
    register obligation J
    cancel_command(J)
    J reaches terminal state with reason "cancelled"

Assertion:
    consumeTerminal(J) resolves the marker (Path A)
    submit_and_exit → COMPLETED
```

### TQCB-CTL-14 — deadline terminal result

```ts
    register obligation J with executionDeadlineMs: 50
    wait > 50ms
    J reaches terminal state with reason "deadline_exceeded"

Assertion:
    consumeTerminal(J) resolves the marker (Path A)
    submit_and_exit → COMPLETED
```

### TQCB-CTL-15 — spawn failure terminal result

```ts
    register obligation J
    J fails to spawn → terminal state "spawn_failed"

Assertion:
    consumeTerminal(J) resolves the marker (Path A)
    submit_and_exit → COMPLETED
```

### TQCB-CTL-16 — extension shutdown

```ts
    register obligation J
    coordinator.dispose() / BackgroundNotifyCoordinator.dispose()
    (extension shutdown)

Assertion:
    no throw, all markers cleared
    activeNotifyCountForOwner = 0
```

### TQCB-CTL-17 — long-horizon SECOND_STEP continues correctly

```ts
    register obligation J
    model polls command_status, observes terminal
    submit_and_exit → barrier HOLDS (J unresolved at that instant)
    coordinator barrier waits → J is RESOLVED via Path B
    → setTurnPhase("completed") fires

Assertion:
    the model does NOT need a second submit_and_exit
    completion commits exactly once
```
## Conservation

The RED tests also include conservation assertions:

- BCAFG01 (RUNNING job still defers awaiting_followup) — UNCHANGED
- LHOWA01 (queued wake suppresses awaiting_followup) — UNCHANGED
- BCNEX01 (exactly-once presentation) — UNCHANGED
- BTCONT01 (deferred continuation re-eval) — EXTENDED to include
  completion-barrier re-eval (but the deferred-continuation marker
  logic is reused, not duplicated)
- BCTCP01 (terminal-card projection) — UNCHANGED

## Composition

The tests use the REAL production classes:
    BackgroundNotifyCoordinator
    SdkSessionEventCoordinator
    MessageTranslatorState
    TurnStateTracker
    MessageIdMinter

They do NOT use stubs for the load-bearing seams. The wake-delivery
sink is the only test seam (mirrors SdkController's
enqueueTerminalWake, which is `sdkHost.send(...)` in production).

## Test scaffolding (harness)

The harness mirrors the LHOWA01 synthetic-real harness pattern:

```ts
class TestPendingPromptsSink {
    public readonly queued: QueuedPrompt[] = []
    enqueue({sessionId, prompt}): void { this.queued.push({sessionId, prompt}) }
    count(): number { return this.queued.length }
}

function makeHarness(opts): {
    coordinator: SdkSessionEventCoordinator
    tracker: TurnStateTracker
    translatorState: MessageTranslatorState
    notifyCoordinator: BackgroundNotifyCoordinator
    wakeSink: TestPendingPromptsSink
    ...
}
```

## Ablation

Tests proving the barrier is the load-bearing seam:

1. **Disable barrier**: outstanding J + submit_and_exit → premature
   "completed". (Pre-fix behavior.)

2. **Enable barrier**: outstanding J + submit_and_exit → held. (GREEN.)

3. **Disable result-resolution correlation**: command_status returns
   terminal but resolveObligation is NOT wired → barrier holds
   indefinitely (no completion commit). (RED for the resolution path.)

4. **Enable result-resolution correlation**: command_status returns
   terminal AND resolveObligation IS wired → barrier releases on
   resolution → COMPLETED. (GREEN.)

If the ablation test fails:
    HALT_CAUSE_NOT_ESTABLISHED

### TQCB-CTL-18 — terminal-card projection conserved

```ts
    register obligation J
    J terminalizes (any terminal state)
    consumeTerminal(J) → fired

Assertion:
    terminal-card projection (BCTCP01) is UNCHANGED
    exactly-one terminal card (the LIVE GREEN preservation)
```
    submit_and_exit for session-B
    J for (session-A, task-A) is STILL active

Assertion:
    setTurnPhase("completed") fires (J does not cross session boundaries)
```
   - The completion commit `setTurnPhase("completed", ...)` is the
     load-bearing seam that this ACT guards.
   - The deferred-continuation marker (BTCONT01) is reused (extended)
     for the completion-barrier case.

3. **MessageTranslatorState** (real production class):
   - `setAttemptCompletionSeen()`
   - `setTerminalResponseCommittedThisTurn()`
   - `clearTurnOutcome()`

4. **TurnStateTracker** (real production class):
   - `setWithWriter(phase, anchorTs, {writerId})`
   - `currentPhase`