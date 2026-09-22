ACT-CLINEMM-LONG-HORIZON-TASK-QUIESCENCE-COMPLETION-BARRIER01 / CORRECTION02 — CAUSAL CLASSIFICATION
====================================================================================================

Class: TQ7_TERMINAL_RESULT_DUAL_DELIVERY_RACE
        (NEW primary class; TQCB01 / CORRECTION01 closed TQ1 + TQ3 but
        missed the orthogonal wake-lifecycle arbitration)

## Reconverged trace

The CORRECTION01 LIVE bug was traced end-to-end through three production seams:

1. Submit-and-exit commits task completion unconditionally
   (sdk-session-event-coordinator.ts:374-375). — FIXED IN TQCB01.

2. The same submit-and-exit does NOT consult outstanding autonomous
   obligations (no barrier at the completion commit). — FIXED IN TQCB01.

3. After completion commits, a queued terminal wake reaches
   PendingPromptsController and starts another autonomous turn. —
   PARTIALLY FIXED in TQCB01 (marker deletion is first-writer-wins;
   wake deletion is NOT arbitrated).

4. The model can ALSO observe the terminal result directly via
   command_status (Path B). — FIXED IN TQCB01 (resolveObligation wired
   through command-status-tool.ts).

The TQCB01 / CORRECTION01 barrier correctly holds COMPLETED when
`activeNotifyCount > 0` or `pendingPromptsKnown > 0`. The completion
barrier sees both counters.

But there is a third state the barrier does NOT reason about: a wake
that was enqueued by Path A's consumeTerminal but for which Path B's
resolveObligation is about to be called (or has just been called). The
marker layer is first-writer-wins: when Path A fires first, it deletes
the marker and enqueues the wake; when Path B fires second, it sees no
marker and returns no_marker. The wake is left queued.

If the wake is consumed by runTurn BEFORE the completion barrier
re-checks its state, an autonomous turn starts and the model says
"I already inspected..." → submit_and_exit → COMPLETED #2.

## The orthogonal invariant

The user's spec:

```
RUNNING
  ↓
TERMINAL_AVAILABLE
  ↓
RESULT_RESOLVED

orthogonally:

WAKE_ARMED
  ↓
WAKE_ENQUEUED
  ↓
WAKE_CONSUMED

Completion becomes safe when:
  result is resolved
  AND
  wake cannot still create autonomous work
```

So we need TWO invariants:
  (a) the marker is drained (RESULT_RESOLVED)
  (b) the wake is either CONSUMED legitimately OR SUPERSEDED because
      the result was already incorporated via the OTHER path

The current code satisfies (a) but NOT (b) when Path A wins the
marker race.

## The repair

A bounded dual-delivery arbitration seam:

1. **BackgroundNotifyCoordinator** tracks `wakeEnqueuedJobIds: Set<string>`
   — every jobId whose wake was enqueued by `consumeTerminal`.

2. **`resolveObligation`** checks `wakeEnqueuedJobIds` BEFORE returning.
   If a wake is still queued for the same jobId, the coordinator calls
   a host-side `discardQueuedWake` callback to remove the wake from
   PendingPrompts BEFORE runTurn consumes it.

3. **`SdkController`** provides the `discardQueuedWake` callback that
   lists the active session's pendingPrompts, finds the entry whose
   prompt is a wake for the target jobId (parsed from the
   deterministic prompt prefix + `Job: <jobId>` line), and calls
   `pendingPrompts("delete", ...)`.

4. The return decision from `resolveObligation` is:
   - `{ kind: "resolved" }` if the marker existed OR a wake was
     superseded (semantically, the obligation is resolved)
   - `{ kind: "no_marker" }` if the marker never existed AND no wake
     was superseded (idempotency signal for already-resolved calls)

## Acceptance matrix

| Order                                         | Required outcome                                       | Test           |
|-----------------------------------------------|--------------------------------------------------------|----------------|
| command_status first, wake not yet enqueued | wake never becomes actionable                          | DUAL-1 (PASS)  |
| wake enqueued first, command_status second    | queued wake becomes redundant and discarded          | DUAL-2 (PASS)  |
| wake consumed first                          | continuation proceeds once; later status read harmless | DUAL-3 (PASS)  |
| notify=false                                | unaffected                                             | DUAL-5 (PASS)  |
| two jobs A/B                                | arbitration is per jobId, never global                 | DUAL-4 (PASS)  |
| idempotent duplicate resolveObligation       | second call is no-op, no extra discard                 | (existing)     |
| dispose clears tracker (EPHEMERAL_ONLY)       | diagnostic tracker is empty after dispose             | DUAL-6 (PASS)  |

## What was NOT done

- NOT modified: CommandJobManager (PWAOR01 / BCTCP01 territory)
- NOT modified: BackgroundNotifyCoordinator.consumeTerminal Path A
- NOT modified: Q5 long-horizon predicate
- NOT modified: notifyOnCompletion tool contract (still opt-in only)
- NOT introduced: a `completionRelevant` field (notify-on carries both)
- NOT modified: pending-prompt authority transport (PPAT01 unchanged)
- NOT modified: terminal-card projection (BCTCP01 unchanged)
- NOT introduced: any proto delta
- NOT introduced: any public tool schema delta

## Stop rules honored

```
CommandJobManager redesigned      = false
Q5 long-horizon predicate modified = false
pending-prompt transport rewired  = false
terminal-card projection modified = false
PWAOR abort ownership modified    = false
Hub ordering modified             = false
wake prompt format modified       = false
PROTO_DELTA                       = NO
PUBLIC_TOOL_SCHEMA_DELTA          = NO
```

## Verdict

```
TQ1 completion barrier                              = GREEN (TQCB01)
TQ3 Path-B command_status wired                     = GREEN (TQCB01 / CORRECTION01)
TQ7 dual-delivery arbitration (NEW)                = GREEN (CORRECTION02)

Conservation                                        = GREEN (54/54 across 8 test files,
                                                       excluding pre-existing LHOWA01-GREEN + OWN01 RED)
Type check                                          = clean
Lower layers                                        = UNTOUCHED

VERDICT                                             = PASS_DUAL_DELIVERY_ARBITRATION_REPAIRED_CORRECTION02
```
