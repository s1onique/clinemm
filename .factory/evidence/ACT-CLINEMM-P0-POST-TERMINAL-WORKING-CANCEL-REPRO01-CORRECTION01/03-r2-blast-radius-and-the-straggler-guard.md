# R2 — The blast radius, and the straggler-guard collision (the load-bearing finding)

## The focused suite was NOT sufficient — the full suite was required

The correction's own 9-test suite and the directly adjacent conservation suites
were GREEN (195/195) after the first implementation pass. The FULL
`apps/vscode` vitest suite (5,073 tests) was still required, and it exposed
**22 NEW failures** that the focused sweep could not see.

This is the single most important process fact of this ACT: **a bounded repair
to a shared production seam (`SdkSessionEventCoordinator`) has a blast radius
that no focused suite can bound.** The predecessor ACT's own board entry warns
of a pre-existing baseline of BCB-INT failures; without a measured baseline the
22 new failures would have been indistinguishable from noise.

## The measurement method (baseline vs. after, machine-compared)

Both runs used the SAME command and the SAME machine-parsed reporter:

```bash
bun x vitest run --config vitest.config.ts --pool=threads \
  --reporter=json --outputFile=<path>
```

The baseline was captured by stashing ONLY this ACT's files
(`git stash push -u -- <the five ACT-owned paths>`), re-running, and restoring.
The comparison is a per-test-id set difference of the two JSON reports, so the
comparison is EXACT — no `grep`, no truncated console output, no inference.

```text
baseline total 5060   after total 5069
NEW FAILURES (regressions): 22
NEWLY PASSING: 0
```

(The 9 extra test ids in the "after" run are the new CORRECTION01 suite plus
the renamed RED-suite test ids.)

## The 22 regressions: TWO distinct root causes, both real defects in the repair

### ROOT CAUSE 1 — the straggler-guard collision (12 of the 22)

**Symptom:** the C10 `task_completion_committed` count dropped from 1 to 0 in
the suites that drive a HELD submit followed by a LEGITIMATE second submit
(`CPA-04`, `CPA-03`, `CPA-07`, `CONS-02`, `CONS-05`, `CONS-06`, `PTBPC-03`,
`BNCA-FRAMEWORK-DISPATCH-FAILED-01`, `UCHC01-01`, `UCHC01-03`).

**Cause:** the turn-complete straggler guard keys on the PHASE VALUE:

```ts
if (!activeSession.isRunning && this.options.getTurnPhase?.() === "resumable") {
    Logger.debug("[SdkController] turn-complete straggler after cancel; preserving resumable phase")
}
```

The CANCEL path sets `resumable` before aborting, and a straggling turn-complete
must not clobber it. The BCB-hold `resumable` has a DIFFERENT cause (the
completion is HELD, not the run cancelled) but the SAME phase value. The guard
could not tell them apart, so it swallowed the ENTIRE completion-commit path:
once the held obligation was consumed and the agent re-issued `submit_and_exit`,
the C10 commit was suppressed as a "cancel straggler" and the task stranded in
`resumable` forever.

**This is a REGRESSION the repair introduced, not a pre-existing condition.**
Fixing it by suppressing the `streaming` re-assertion alone (boundary B2) does
not touch it; it is caused by boundary B1's new `resumable` write.

**The fix:** the coordinator now knows whether IT published the `resumable`.

- a new private flag `bcbHoldResumablePublished`, SET immediately before the
  BCB-hold write and CLEARED immediately after every OTHER phase write in this
  coordinator, so it can never describe a `resumable` this coordinator did not
  publish. It is also cleared at every deferred-completion-barrier clearing
  site (session / task / epoch supersession), because at that point the BCB
  hold no longer describes the committed phase.

**A NOTE ON THE IMPLEMENTATION SHAPE (a rejected first attempt):** the flag was
initially maintained by routing every phase write in this coordinator through a
single `publishTurnPhase(phase, anchorTs, writerId)` wrapper. That refactor
BROKE a source-text pin in
`containment-failure-c10-authority-repair01.cfc10ar01.test.ts` (CFC10AR01-M5-C),
which asserts the literal source text
`setTurnPhase?.("resumable", undefined, "session-event-turn-complete-containment-failed-resumable")`.
The wrapper was therefore REJECTED and the flag maintenance was done with
narrow, explicit assignments around the individual call sites instead — the
direct `setTurnPhase?.(...)` calls are PRESERVED, so the source-text pin holds.
This is recorded because the rejected approach is the obvious one and its
rejection is not obvious.

The guard becomes:

```ts
if (
    !activeSession.isRunning &&
    this.options.getTurnPhase?.() === "resumable" &&
    !this.bcbHoldResumablePublished
) {
    // the CANCEL straggler: preserve the cancel-set `resumable`
}
```

A `resumable` published by any OTHER writer (the cancel path,
`controller-cancel-task`, `task-control-cancel-no-active-session`, the
containment-failure hold) is never mistaken for a BCB hold.

### ROOT CAUSE 2 — the typed blocked verdict was being clobbered (10 of the 22)

**Symptom:** `BOCR01-07` expected `error` and got `resumable`;
`HBCLO-30` expected the marker reason `stalled_no_progress` and got
`observation_unavailable`; `HBOP-11` expected `delivery_rejected` and got
`observation_unavailable`.

**Cause:** the host has a TYPED BLOCKED VERDICT surface. When the model cannot
observe the held results, the host publishes a typed blocked outcome
(`observation_unavailable`) and owns the terminal phase — the `error` write by
the `session-event-bcb-blocked-observation-unavailable` writer. The bounded
`sameObligationAlreadyObservationUnavailable` guard deliberately does NOT
re-publish it on a BCB re-registration. B1's `resumable` write therefore
CLOBBERED that typed `error` verdict on the second cycle, replacing a specific
claim ("the model could not observe the held results") with a less specific one
("the run was abandoned").

**The fix:** B1 must not fire when a typed blocked verdict already exists for
THIS SAME obligation. The `preservedReason` computed at the marker registration
is exactly that discriminator — it is carried over ONLY when the previous
marker had the SAME identity triple (`sessionId` / `taskId` / `epoch`), i.e.
the SAME obligation:

```ts
if (preservedReason !== "observation_unavailable") {
    this.publishTurnPhase("resumable", undefined, "session-event-bcb-hold-resumable")
}
```

The typed blocked verdict remains the authority for its own obligation; B1 only
publishes when no typed verdict owns the cycle.
