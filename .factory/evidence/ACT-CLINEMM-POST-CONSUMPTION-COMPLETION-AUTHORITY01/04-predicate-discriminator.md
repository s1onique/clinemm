# 04 — Predicate discriminator (live RED → single false predicate)

The PCCA-01 / PCCA-05 RED tests snapshot the SEAM B predicate state at
the second submit_and_exit. The snapshot proves which conjunct remains
false.

## Second-submit snapshot (entry HEAD)

```text
SECOND_SUBMIT_OWNER_STILL_RUNNING               = false
  (job is containment_failed; no live background jobs for the session)
SECOND_SUBMIT_UNCONSUMED_TERMINALS              = 1     ← THE FALSE CONJUNCT
  (the non-notify observation was registered by the runner at
   vscode-run-commands-tool.ts:892-913 unconditionally for every
   terminal state including containment_failed; command_status returned
   the terminal snapshot at command-status-tool.ts:307-326 but the
   Path C drain at line 295-304 was gated out by the
   `snap.state !== "containment_failed"` guard at line 245.)
SECOND_SUBMIT_OUTSTANDING_AUTONOMOUS_WORK       = false
  (no notify markers; pending prompt count = 0 after the BCB continuation
   drain consumed the pending finalization prompt)
SECOND_SUBMIT_SUPPRESS_ORIGINATING_COMPLETION   = false
  (notify=false job has no perJobSuppressOriginatingCompletion flag;
   notify=true wake is not involved)
SECOND_SUBMIT_FINALIZATION_AUTHORITY            = true
  (deferredCompletionBarrier.sessionId+taskId+epoch matches the active
   session/task/epoch)
SECOND_SUBMIT_PENDING_PROMPTS                   = 0
  (BCB continuation prompt already drained)
```

## Single false conjunct

```text
SECOND_SUBMIT_UNCONSUMED_TERMINALS = 1
```

The BCB barrier (SEAM B) holds exactly on this conjunct. The fourth
conjunct — `unconsumedOwnedTerminalResultsForC10 > 0` — is the BCB01
§0.1 second-conjunct load-bearing check. It counts every observation
the BackgroundNotifyCoordinator holds for the session, including the
non-notify observation that the runner registered at terminalPromise.

## Repair rule (ACT §16 → H1)

```text
If: command_status returns terminal result, unconsumed remains > 0
Then: repair only the consumption path.
```

The Path C drain must fire for `containment_failed` terminal state on
non-notify observations. Path B (the notify=true resolveObligation
call) keeps its `containment_failed` exclusion because the wake
consumer is the load-bearing authority for notify=true containment_failed
jobs (the wake has no listener for that terminal class).

## Discriminator matrix

| Test                                         | notify=false drain | notify=true wake | Barrier after   |
|----------------------------------------------|-------------------|------------------|-----------------|
| PCCA-01: containment_failed, drain+commit    | DRAIN (NEW)       | n/a              | releases, commit|
| PCCA-02: containment_failed, notify=true      | n/a (notify=true) | SUPPRESSED       | held (perJobS) |
| PCCA-03: containment_failed, drain idempotent| PASS              | n/a              | held (drained) |
| PCCA-05: full chronology                     | DRAIN, commit     | n/a              | releases, commit|

Path B's `containment_failed` exclusion is preserved (notify=true wake
remains authority). Path C's exclusion is removed (non-notify drain
fires).