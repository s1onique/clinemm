# 02 — Recon: authoritative predicate and consumer seam

## Authority predicate (frozen)

```text
task_completion_committed
⇒
  owned_background_jobs_nonterminal   == 0     (BCB01 §0.1 first conjunct)
  AND unconsumed_owned_terminal_results == 0  (BCB01 §0.1 second conjunct)
  AND outstanding_autonomous_work       == false
  AND completion authority is valid     (notify=suppression not stuck)
```

Both `owned_background_jobs_nonterminal` and
`unconsumed_owned_terminal_results` are exposed through option-bag
methods on the coordinator; SEAM B
(`sdk-session-event-coordinator.ts:1352-1412`) consults them via
`hasRunningBackgroundJobForOwner` and
`getUnconsumedOwnedTerminalResultCount` respectively.

## C10 sites

```text
C10_SITE_A = sdk-session-event-coordinator.ts:1049-1164
             (completion_result row message-layer filter — CPA01 repair
              already extends it with hasRunningBackgroundJobForOwner
              and getUnconsumedOwnedTerminalResultCount for both narrow
              and over-broad branches.)

C10_SITE_B = sdk-session-event-coordinator.ts:1238-1412
             (BCB barrier at submit_and_exit, consults the same two
              option-bag methods plus per-job wake authority.)
```

## Command-status consumption

```text
COMMAND_STATUS_TERMINAL_OBSERVATION_SEAM = apps/vscode/src/sdk/command-status-tool.ts:240-306
NOTIFY_CONSUME_SEAM  (Path A/B)          = line 240-261 (resolveObligation for notify=true)
NON_NOTIFY_CONSUME_SEAM (Path C)         = line 295-304 (consumeNonNotifyTerminalObservation for notify=false)
OWNER_MATCH_CHECK    (Path C)            = line 295 (hasActiveNotify guard prevents cross-path drain)
REEVALUATION_AFTER_CONSUMPTION          = NONE — command_status is a pure drain; reevaluation
                                           is driven by the runner's terminalPromise listener
                                           via updateBackgroundCommandState → reevaluateDeferredCompletionBarrier
                                           (SdkController.ts:4979-4984)
```

## Finalization authority identity

```text
FINALIZATION_CONTINUATION_IDENTITY = (sessionId, taskId, epoch) dedupe key
FINALIZATION_AUTHORITY_MARKER      = deferredCompletionBarrier.sessionId+taskId+epoch triple
                                       (sdk-session-event-coordinator.ts:1367-1372)
FINALIZATION_AUTHORITY_LIFETIME    = until deferredCompletionBarrier is cleared
                                       (line 750 — released on commit)
FINALIZATION_AUTHORITY_CLEAR_SEAM  = this.deferredCompletionBarrier = undefined
                                       (line 591-606 epoch-supersession; line 750 release)
```

Marker is **epoch-scoped** (carries the held submit_and_exit's epoch).
The dedupe key for the bounded continuation enqueue is also epoch-scoped.

## Consumer guard defect (the smoking gun)

`command-status-tool.ts:240-246` carries:

```text
if (
  !suppressPathB &&
  options.backgroundNotifyCoordinator &&
  options.resolveActiveOwner &&
  snap.state !== "running" &&
  snap.state !== "containment_failed"     // ← load-bearing exclusion
) {
  ...
  // Path A — drain notify=true marker (line 249-263)
  ...
  // Path C — drain non-notify observation (line 264-304)
  ...
}
```

The `containment_failed` exclusion was added in
`ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01` (TQCB01) and inherited by
`CORRECTION02`. The intent was to mirror the Path A wake-consumer
behavior (notify=true wakes have no listener for containment_failed
jobs). But the non-notify record path at
`vscode-run-commands-tool.ts:892-913` registers the observation
UNCONDITIONALLY for every terminal state, including
`containment_failed`. The Path C drain was meant to be the production
consumer for those observations; the inherited guard skips the drain
for `containment_failed`, leaving the observation registered
indefinitely.

The BCB barrier at SEAM B holds on
`unconsumedOwnedTerminalResultsForC10 > 0` — and the count never
decrements after `command_status` returns. The second
`submit_and_exit` therefore never reaches
`task_completion_committed`.

## Hypotheses in scope

```text
H1  command_status returned result but observation count did not drain
H2  observation drained, but ownerStillRunning remained true
H3  observation drained, but outstandingAutonomousWork remained true
H4  observation drained, but perJobSuppressOriginatingCompletion remained true
H5  observation drained, but finalization authority marker was absent/stale
H6  all predicates were good, but commit transition was not reevaluated
H7  commit transition occurred, but capture/event was missing
```

The recon discriminates H1 from H6 by direct inspection. The drain
count returns 1 after `command_status` on a `containment_failed` job;
SEAM B's predicate then continues to evaluate to "hold". H1 is the
correct diagnosis. H6 does not apply (SEAM B does re-evaluate at every
turn-complete and submit_and_exit).