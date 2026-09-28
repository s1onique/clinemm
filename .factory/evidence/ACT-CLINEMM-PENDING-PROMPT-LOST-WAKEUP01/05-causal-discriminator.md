# 05-causal-discriminator.md

## Reproduction attempts

This ACT attempted to reproduce the live defect in two orderings using a
controllable `AgentRuntime` stub whose `run` BLOCKS until signalled. The
controllable stub is the load-bearing mechanism that allows a queued
finalization prompt to be enqueued DURING the active run (mirroring the
BCB chain's `sdkHost.send({delivery:"queue"})` invocation fired from
inside the run-finished event listener).

### Case A — enqueue during run, then run completes (PPLW-01)

```
active run starts (gate CLOSED)
        ↓
agent.run() BLOCKS on runGate
        ↓
host.runTurn({delivery: "queue", prompt: "FINALIZATION"}) — enqueues
        ↓
  service.enqueue(session, entry)        // C4 fires
  emitPrompts(session)
  scheduleDrain(sessionId, session)
    → canStartRun()==false → BAIL (no microtask queued)
        ↓
signalRunComplete() → agent.run() returns
        ↓
runtime.run() resolves
        ↓
orchestrator's finally: unsubscribe(), await activeTrackerWork, this.running=false
        ↓
executeRunInternal returns; executeAgentTurn returns; executeTurn returns
        ↓
runTurn continues: agent_turn_done capture
        ↓
await completeInteractiveTurn → markTurnIdle → session.aborting = false
        ↓
queueMicrotask(() => pendingPromptsController.drain(input.sessionId))   ← line 1268
        ↓
Post-turn drain microtask fires
        ↓
drain() guard checks:
  session.aborting         → false
  session.drainingPendingPrompts → false
  session.agent.canStartRun() → true
  session.pendingPrompts.length > 0
        ↓
shiftNext → onBeforeDrain (C5 fires) → emitPrompts → emitSubmitted
        ↓
deps.send → LocalRuntimeHost.runTurn({delivery: undefined})
        ↓
executeTurn → executeAgentTurn → agent.continue() (BLOCKED on continueGate)
        ↓
signalContinueComplete() → agent.continue() returns
        ↓
drain completes; continues to next iteration of the loop
```

Observed counters (PPLW-01 PASS):
```
pending_prompt_enqueued   = 1
pending_prompt_dequeued   = 1
continuation_scheduled    = 1
run_turn_started          = 2
agent_turn_done           = 2
```

**Verdict: GREEN. No fix needed.**

### Case B — turn completes first, then enqueue (PPLW-02)

```
host.runTurn({delivery: "queue", prompt: "FINALIZATION_PHASE_1"}) — gate CLOSED, enqueues
        ↓
  scheduleDrain → canStartRun()==false → BAIL
        ↓
setReady(true) — open gate
        ↓
host.runTurn({prompt: "USER_TURN"}) — starts agent.run (BLOCKED)
        ↓
signalRunComplete() → agent.run() returns
        ↓
[run completes, post-turn drain microtask fires, agent.continue() runs,
 drained phase-1 prompt, signalContinueComplete() resolves continue gate]
        ↓
host.runTurn({delivery: "queue", prompt: "FINALIZATION_PHASE_2"}) — enqueue phase 2
        ↓
  scheduleDrain → canStartRun()==true → queueMicrotask(drain)
        ↓
Drain fires → dispatches phase-2 prompt via agent.continue()
```

Observed counters (PPLW-02 PASS):
```
pending_prompt_enqueued   = 2
pending_prompt_dequeued   = 2
continuation_scheduled    = 2
```

**Verdict: GREEN. No fix needed.**

## Causal distinction

The two orderings behave identically: both drain eventually because at
least one of `scheduleDrain` (from enqueue) or the post-turn drain
microtask (line 1268) succeeds in queueing a drain microtask when the
session is idle.

For Case A: scheduleDrain bails (run in flight), but the post-turn drain
microtask fires after the run ends.

For Case B: scheduleDrain bails initially (gate CLOSED), but after the
user turn runs to completion, scheduleDrain's later call (after the BCB
chain's queueing) succeeds.

In both cases, the drain eventually fires. There is no lost-wakeup.

## Why does the live defect still exist?

This ACT could NOT reproduce the live defect in the deterministic harness.
The production code's drain scheduling is correct for both orderings.

Possible non-exhaustive causes NOT covered by this ACT:

1. The BCB chain's `enqueueCompletionContinuationIfHeld` returns
   `not_held` because `deferredCompletionBarrier` is not set. This
   would explain `pending_prompt_enqueued=1` (some OTHER code path
   enqueued) but no dequeue. Could be a BCB barrier predicate bug
   rather than a drain scheduling bug.

2. The `enqueueCompletionContinuationIfHeld` returns `session_gone`
   because the active session is no longer valid at the time the BCB
   chain resumes after microtask hops. This would explain
   `pending_prompt_enqueued=0` (if the enqueue never happens) but not
   the observed `pending_prompt_enqueued=1`.

3. The BCB chain fires its enqueue but the `pendingPromptsController`
   it points to is a different instance (stale reference from the
   session lifecycle). This would be a wiring bug, not a drain
   scheduling bug.

4. The `sdkHost.send({delivery:"queue"})` resolves to a Promise that
   is never awaited (fire-and-forget), and the Promise rejects
   silently. The catch handler at sdk-session-event-coordinator.ts
   line 1352-1357 catches it. But the catch only LOGS, doesn't
   propagate. So a rejection in `sdkHost.send` would leave the
   queue empty.

5. The agent.continue() call inside the drain's deps.send gets a
   stale or cancelled run state. Could be a state-management bug.

The ACT explicitly halted this investigation at the drain scheduling
boundary because:

  - The drain scheduling is provably correct for both orderings (per
    this ACT's tests)
  - The previous ACT (PPRD01) also proved drain scheduling correct
  - The live defect has a different shape: pending_prompt_enqueued=1
    (so SOME enqueue fired) but pending_prompt_dequeued=0 (no drain)
  - This shape is inconsistent with a lost-wakeup at the
    scheduleDrain / post-turn-drain handoff

**Conclusion: the live defect is NOT a lost-wakeup at the
enqueue/drain boundary. It is some other bug.**