# 01 — RED RESULTS (the original failing evidence)

Evidence class: **SYNTHETIC_REAL** (real manager / BCB / coordinator /
status-tool seams; only the supervisor and the manager's documented
`terminalPostconditionProbe` are injected).

## RED-1 — the IMMEDIATE C10 path (Site A)

`CFC10A01-RED-03-B` in
`apps/vscode/src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts`
was modified (R4 of the ACT) to require:

```typescript
expect(h.completionCommitCount()).toBe(0)
expect(h.tracker.currentPhase).not.toBe("completed")
```

The manager, observation-consumption and injected Elm AUTHORIZE conditions
that reproduced the defect were kept EXACTLY as the predecessor had them:

1. A job is started through the REAL `CommandJobManager` with
   `terminalPostconditionProbe: () => "alive"` and run to terminal.
2. The manager's own `finalize()` classifies the job `containment_failed`
   and removes it from the ACTIVE map (`activeCount === 0`).
3. The non-notify terminal observation is registered and then CONSUMED
   through the REAL `command_status` tool, so the BCB's unconsumed
   observation count drains to 0.
4. The owner's `containment_failed` classification is UNCHANGED.
5. Elm AUTHORIZEs (injected provider).
6. The completion turn is emitted.

### ACTUAL FAILING ASSERTION (against the UNMODIFIED production implementation)

```
 FAIL  src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts >
       ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPRO01 / RED-03 C10 authority discriminator >
       CFC10A01-RED-03-B (RED WITNESS): after the observation is CONSUMED, the C10 commit MUST STAY BLOCKED
       while the containment failure is STILL UNRESOLVED
AssertionError: expected 1 to be +0 // Object.is equality
```

**RED — C10 committed despite unresolved containment.**

Full RED run (both witnesses failing, everything else green):

```
 Test Files  1 failed (1)
      Tests  2 failed | 17 passed (19)
```

## RED-2 — the DEFERRED C10 path (Site B)

A NEW witness `CFC10A01-RED-03-B-DEFERRED` was added to the same file. It
exercises the ACTUAL deferred completion barrier, NOT a re-implementation:

1. **Register the actual deferred completion barrier.** The BCB's
   `heldObligationForC10` conjunct holds the immediate C10 commit, so the
   REAL production barrier registration in `handleSessionEvent` runs and the
   marker is created. Asserted via the production accessor
   `isDeferredCompletionBarrierOutstandingForTesting()`.
2. **Hold it while the terminal observation is outstanding.**
3. **Consume the observation** through the REAL `command_status` tool.
4. **Preserve the same owner's `containment_failed` classification.**
5. **Exercise the actual `reevaluateDeferredCompletionBarrier()` method.**
6. **Assert that no completed-phase write is permitted.**

### ACTUAL FAILING ASSERTION

```
 FAIL  src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts >
       ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPRO01 / RED-03 C10 authority discriminator >
       CFC10A01-RED-03-B-DEFERRED (RED WITNESS): the DEFERRED C10 re-evaluation MUST NOT release the held
       completion while the owner's containment failure is UNRESOLVED
AssertionError: expected 1 to be +0 // Object.is equality
```

**RED — the deferred C10 released the completion over an unresolved
containment failure.**

## No path diverged from the predecessor evidence

Both paths behaved EXACTLY as the predecessor's frozen causal evidence
predicted:

| Frozen finding | Predicted | Observed |
|---|---|---|
| `CommandJobManager.finalize()` deletes from the active map on BOTH paths | activeCount = 0 | confirmed (RED-01-C, still green) |
| A non-`gone` postcondition produces `containment_failed` | classification present | confirmed (RED-01-A/B, still green) |
| The BCB observation count can fall to zero without changing the classification | count 0 + classification intact | confirmed |
| Immediate C10 has no containment-failure conjunct | C10 commits | **confirmed by RED-1** |
| Deferred C10 re-evaluation has no containment-failure conjunct | C10 commits | **confirmed by RED-2** |
| Q5 already has an owner-scoped, fail-closed containment policy | Q5 holds | confirmed (RED-03-E, still green) |
| The required state and owner maps are already wired | no new wiring needed | confirmed |
| The Elm authority has no containment axis | Elm cannot compensate | confirmed (RED-03-D, still green) |

No contradictory evidence was found, so no re-diagnosis was required.

## The intentionally failing witnesses are NOT left in the default suite

Both witnesses now PASS after the repair (19/19 in the predecessor suite).
The RED is preserved as evidence in this file and in the ACT's git history,
not as a failing test.
