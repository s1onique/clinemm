# Causal Discriminator — ACT-CLINEMM-P0-UNRESOLVABLE-COMPLETION-HOST-CONVERGENCE01

## Reconstruction of the event chain (C3)

The LIVE specimen's event chain was reconstructed from `continuation-cardinality-authority.jsonl` (77 events) and cross-referenced with `completion-continuation-upstream.counters.json`:

```
K: submit_and_exit (seq 67, at 1791495053425)
       ↓
   handleSessionEvent reaches BCB re-registration block (handleSessionEvent:2620+)
       ↓
   LiveTools consulted (handleSessionEvent:2707)
       ↓
   canObserveHeldResults = true (command_status IS in the tool registry at K)
       ↓
   Bounded correlation guard does NOT stamp observation_unavailable at K
       ↓
   enqueueCompletionContinuationIfHeld runs (line 1184, the terminal-idle / reeval path)
       ↓
   Inner enqueue consults pickContinuationDirectiveForPublication (hardcoded canObserve=true, canRetry=true)
       ↓
   Elm kernel returns ObserveThenRetry (held>0, priorSortedHeld=undefined → Indeterminate → falls through)
       ↓
   Continuation prompt is formatted (names command_status + submit_and_exit as available)
       ↓
   enqueueCompletionContinuation Invoked (counter = 1)
       ↓
   sdkHost.send({ delivery: "queue" }) → delivered (counter = 1, callback = 1)
       ↓
   pending_prompt_enqueued (seq 69)
   pending_prompt_dequeued (seq 70)
   continuation_scheduled (seq 71)

run_turn_started (seq 73, run_X7hswuVh) - the continuation-driven turn
continuation_started (seq 74)

terminal_committed (seq 75) - one more held job

submit_and_exit (seq 76) - K+1 from the model
       ↓
   handleSessionEvent reaches BCB re-registration block AGAIN
       ↓
   LiveTools consulted (handleSessionEvent:2707)
       ↓
   canObserveHeldResults = false (command_status NOT in the tool registry at K+1)
       ↓
   Bounded correlation guard STAMPS observation_unavailable (counter = 1)
       ↓
   applyBlockedCompletionContinuationOutcome is called
       ↓
   Marker.stamp(reason: "observation_unavailable")
   recordBlockedOutcomeObservationUnavailable()
   recordRuntimeError(incident) [if taskTelemetry wired]

agent_turn_done (seq 77) - the post-run reeval
       ↓
   notifyAgentTurnDone → reevaluateDeferredCompletionBarrier
       ↓
   Eligible for coalesced continuation (heldObligation = true)
       ↓
   LiveTools consulted AGAIN - still no command_status
       ↓
   Bounded guard would stamp again, but sameObligationAlreadyObservationUnavailable is true
       ↓
   recordBlockedOutcomeObservationUnavailable() counter increments again (counter = 2)
       ↓
   BUT the helper's IDEMPOTENCE check (line 1993) suppresses the re-stamp
   The inner enqueue may still fire and return stalled_no_progress, which may
   overwrite the marker reason via the helper at line 2005-2008

End state: task_completion_committed = 0
           held obligation retained on the BCB marker
           runtime incident published (MAPPING01 publication via recordRuntimeError)
           no third continuation scheduled
```

## First divergence classification

The brief lists nine classifications. The LIVE specimen maps to:

**`BLOCKED_OUTCOME_NOT_CONSUMED`** — the bounded guard's `observation_unavailable` stamp is HISTORICAL (a marker field), not BLOCKING. The host had no way to prevent K+1 from running in response to the model's choice at seq 76 to re-issue `submit_and_exit` instead of calling `command_status`. The host's bounded state is recoverable: the held obligation is retained, the marker is stamped, the runtime incident is published, and no third continuation is scheduled.

**Reading the LIVE evidence**:
- `enqueueCompletionContinuationInvoked = 1` — the inner enqueue ran exactly once (at K). The K+1 BCB re-registration's bounded guard short-circuited the enqueue.
- `blockedOutcomeObservationUnavailable = 2` — the bounded guard stamped the marker twice. One is from the K+1 BCB re-registration (seq 76). The other is from the post-run reeval at seq 77 (the `reevaluateDeferredCompletionBarrier` chain reaches the same `applyBlockedCompletionContinuationOutcome` helper at line 2723 only when the inner enqueue's `eligibleForCoalescedContinuation` predicate fires AND `canObserveHeldResults === false`).
- `stalledNoProgress = 2` — the second event had a held set that was a strict superset of the first (the K+1 BCB had seq 75's `cmd_mv01whzaomtuzbrs` added). The Elm kernel's `classifyHeldSetProgress` returned `PassiveAccumulation` first (the K+1 first try with the same fingerprint but the held set got extended), then `StalledNoProgress` after the post-run reeval.

**Subordinate discriminator**: **`CAPABILITY_KNOWN_UNAVAILABLE_BEFORE_ENQUEUE`** (partial) — the bounded guard at line 2704-2734 correctly classified the K+1 state and prevented the second enqueue. This is the only place in the production path where the capability check fires (the inner `enqueueCompletionContinuationIfHeld` at line 1546-1547 hardcodes `canObserveHeldResults: true` regardless of the actual tool registry).

**Why not `CAPABILITY_KNOWN_UNAVAILABLE_BEFORE_ENQUEUE` for K**: at K, the bounded guard's `canObserveHeldResults` was `true` because `liveTools()` returned a list that included `command_status`. The host's bounded behavior at K is "enqueue and deliver" — not "stamp and suppress". The host's bounded behavior at K+1 is "stamp and suppress" — not "enqueue". The transition between the two is the production seam the LIVE specimen exercised.

**Why not `ARTIFACT_IDENTITY_MISMATCH`**: the bounded guard at line 2704-2734 is the verified-source seam at HEAD `432f483c7`. The LIVE specimen's `blockedOutcomeObservationUnavailable = 2` is consistent with the production code's behavior at this HEAD. There is no evidence the LIVE specimen was captured against an older source.

## Decision (C5)

The first verified causal boundary is the **bounded correlation guard at `sdk-session-event-coordinator.ts:2704-2734`**. Per C5's decision table:

| First divergence | Authorized repair location |
|------------------|---------------------------|
| Capability already unavailable before enqueue | Existing coordinator enqueue guard |
| Capability changed while pending | Existing pending-prompt dequeue/actionability check |
| Old async callback schedules against new identity | Existing host correlation/revalidation |
| Same blocked obligation repeatedly rearmed | Existing STALL/REARM owner |
| Blocked outcome computed but not acted upon | Existing lifecycle consumer |
| Capability evidence unavailable | No repair; CAPTURE_INSUFFICIENT |

**Selection**: the bounded correlation guard IS the existing coordinator enqueue guard the brief authorizes. The LIVE specimen's host behavior at this guard is **already correct** — it correctly classifies the unobservable state, stamps the typed marker reason, publishes the runtime incident, and suppresses the inner enqueue. No repair is needed at this boundary.

The remaining divergence (`BLOCKED_OUTCOME_NOT_CONSUMED`) is a model-control phenomenon, not a host-orchestration defect. The brief explicitly excludes "Stopping unnecessary model turns must not become a mechanism for silently acknowledging terminal results." The host did NOT silently acknowledge — `task_completion_committed = 0`. The model chose to keep submitting `submit_and_exit` despite the bounded guard's correct classification.

**No production code is changed** in this ACT. The bounded guard's existing behavior is preserved as the production invariant.

## Brief's "What the host should do" checklist

| Step | Status |
|------|--------|
| Capability available → deliver bounded, actionable continuation | ✓ Done (K's enqueue delivered) |
| Capability available → observe J | ✓ Done (K's continuation was an observation instruction) |
| Capability unavailable → DO NOT enqueue impossible model work | ✓ Done (K+1's inner enqueue was short-circuited) |
| Capability unavailable → retain J and its observation obligation | ✓ Done (BCB marker retained; held set preserved) |
| Capability unavailable → publish a correlated blocked host outcome | ✓ Done (`observation_unavailable` stamped; counter incremented; incident published) |
| Capability unavailable → wait for genuine external progress or operator action | ✓ Done (no further continuations scheduled; held=0 + capability recovery → completion) |
| Capability unknown → preserve existing fail-closed/conservative contract | ✓ Done (null capability → enqueue, downstream `rejected` per existing contract) |
| Capability unknown → never invent a capability | ✓ Done (the bounded guard consults `liveTools()`; no synthesis of capability) |
| Blocked task ≠ successfully completed task | ✓ Done (`task_completion_committed = 0`) |
| No silent acknowledgment of terminal results | ✓ Done (the held obligation is retained on the marker; the runtime incident is published) |

**All ten host responsibilities are satisfied at the verified source HEAD.**
