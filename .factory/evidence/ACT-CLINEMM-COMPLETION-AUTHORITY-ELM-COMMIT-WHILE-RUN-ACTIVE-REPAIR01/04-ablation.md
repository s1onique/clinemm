# §11 — Ablation: necessity of the run-scoped suppression

## Method

The repair's only behavior change is in `Authority.completionCommitHoldReasons`:

```elm
completionCommitHoldReasons model =
    let
        suppressActiveRun =
            model.commitReadyRun == model.activeRun
    in
    computeHoldReasons model
        |> List.filter (\r -> not (suppressActiveRun && r == ActiveRun))
```

`commitReadyRun` is bound to `model.activeRun` at `SubmitAndExitSeen`
and invalidated on every `RunStarted`, `AgentTurnDone`,
`ExecuteTurnPreludeEnter`, and `ContinuationStarted` (any event that
transitions `activeRun`).

Ablation: temporarily revert the suppression to `False` so that
`completionCommitHoldReasons` returns the unmodified `computeHoldReasons`
list.

Same kernel, same tests, same Authoring Elm. Only the suppression is
removed.

## Two ablation runs

### Ablation #1 — pre-R11 (4 tests, see 04-ablation-red-raw.txt)

```
TEST RUN FAILED
Duration: 134 ms
Passed:   24
Failed:   6
```

Failed tests (the original 6 RED):

| Test | Failure |
|---|---|
| ELM-CWRA-R01 | `Just (TaskCompletionCommittedWhileHeld ActiveRun)` — exact predecessor divergence reproduced. |
| ELM-CWRA-R02 | Same root cause: C10 rejected → late C8 sees `task=Active`. |
| ELM-CWRA-R04 | Expected `PendingPrompt or ScheduledContinuation`, got `active_run`. |
| ELM-CWRA-R07 | First commit rejected, never reaches `DuplicateCompletionRef`. |
| ELM-CWRA-R09 | Same as R01. |
| ELM-CWRA-R10 | First commit rejected; `task` stays `Active`. |

### Ablation #2 — post-R11 (31 tests, see 04b-ablation-r11-red-raw.txt)

```
TEST RUN FAILED
Duration: 153 ms
Passed:   25
Failed:   6
```

Failed tests (the same 6 RED; R11 GREEN even with suppression off
because R11 expects `TaskCompletionCommittedWhileHeld ActiveRun` which
the ablated kernel emits):

| Test | Failure |
|---|---|
| ELM-CWRA-R01 | Same. |
| ELM-CWRA-R02 | Same. |
| ELM-CWRA-R04 | Same. |
| ELM-CWRA-R07 | Same. |
| ELM-CWRA-R09 | Same. |
| ELM-CWRA-R10 | Same. |

R11 is GREEN under ablation because the test EXPECTS rejection; the
ablation unconditionally rejects ActiveRun, which matches R11's
expectation. R11 only meaningfully turns RED when the suppression is
active AND the run binding is incorrect (as it was in the original
`submitCount >= 1` repair, where a stale R1 submit authorized R2's
commit).

## Restoration GREEN result

After restoring the suppression, elm-test re-run:

```
TEST RUN PASSED
Duration: 164 ms
Passed:   31
Failed:   0
```

All 31 tests GREEN, including:
- R01/R02/R09 — the predecessor's REAL chronology accepted.
- R11 — the run-scope invariant holds (stale R1 submit does NOT
  authorize R2's commit).
- All 24 pre-existing tests — invariant regression suite.
- R03/R05 — conservation: ActiveRun STILL blocks when no submit was
  observed for the active run.
- R06 — mismatched `AgentTurnDone` still rejects.
- R07/R10 — duplicate completion and post-completion resurrection
  still rejected.

## Necessity proven

The ablation proves that:

1. The pre-repair kernel **rejects** the REAL chronology with the
   exact predecessor violation `TaskCompletionCommittedWhileHeld
   active_run`. This is the original divergence.
2. The repaired kernel **accepts** the REAL chronology AND **rejects**
   the stale-submit cross-run case (R11).
3. The suppression rule is the **minimal** change that fixes the
   divergence AND preserves the temporal-identity invariant: removing
   it reintroduces the divergence; restoring it removes the
   divergence and re-enables the valid case.

The repair is necessary, not redundant.

## What ablation does NOT change

- `computeHoldReasons` (the canonical hold set) is unchanged.
- The `ActiveRun` constructor is NOT removed; it remains a
  `HoldReason` for ALL non-`TaskCompletionCommitted` queries.
- `presentationAuthorized`, `completionAuthorized`, and `deriveEffects`
  are unchanged.
- All non-`ActiveRun` HoldReasons remain blocking under the
  suppression (e.g. PendingPrompt, ScheduledContinuation,
  UnconsumedTerminalObservation, RunningBackgroundJob).

