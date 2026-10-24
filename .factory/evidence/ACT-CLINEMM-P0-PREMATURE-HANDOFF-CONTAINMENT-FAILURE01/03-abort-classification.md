# 03 — Original Abort Classification (R1)

## Result

    ABORT_ORIGIN = UNAVAILABLE_FROM_TRACE

## Why the trace does not identify the abort actor

The available captures were searched for a stop event, a stop reason, and a stop owner.
None carries one. Specifically:

- `post-terminal-authority-diagnostic-extension.jsonl` records the RUNTIME STATUS only
  (`runtimeStatus`, `runtimeModelStreaming`, `runtimePendingToolCount`,
  `shadowStatus`, `shadowRecoveryState`). It records `aborted` but NOT the reason.
- `w-carrier-trace.jsonl` records `carrier_observe` / `runtime_w_observe` /
  `state_publish` only. A `grep` for `aborted` over all 1266 records returns ZERO hits.
- `turn-state-writer-provenance.jsonl` records the LEGACY phase writes only. The run's
  termination did not produce a phase write (the phase stayed `streaming` at seq 3397
  from 09:27:29 until the containment failure at 09:29:30).
- `continuation-cardinality-authority.counters.json` records stage COUNTS only.

## What the trace DOES establish (and this is decisive for causal ordering)

1. The last `runtime_w_observe` is iteration 229 at `1792823301802` (09:28:21.802).
   No further turn was prepared. The model run had ENDED by then.
2. The `runtimeStatus` transition `running` → `aborted` is first observed at
   `1792823327640` (09:28:47.640), stateVersion 3439.
3. The containment failure is at `1792823370468` (09:29:30.468).

    ABORT_OBSERVED_AT  = 1792823327640
    CONTAINMENT_FAIL  = 1792823370468
    DELTA             = 42.828 s  (the abort PRECEDES the containment failure)

**=> The containment failure did NOT cause the abort. The abort is an EARLIER event.**

This ordering is the mechanical refutation of any "the failed containment aborted the
run" hypothesis (H4 in the "containment caused it" direction) and is consistent with the
capture's own note that the Q5 decision at 09:28:47.544 already observed
`guardResult=true` (the job was still running) — i.e. the `done` event that produced the
deferral was already the aborted turn's `done`.

The SDK's aborted-turn path is `LocalRuntimeHost.completeAbortedInteractiveTurn`
(`sdk/packages/core/src/runtime/host/local-runtime-host.ts:2306-2377`), which dispatches
a `done` event with `reason: "aborted"`. The coordinator has NO special case for
`reason: "aborted"` — it flows through the ordinary "done-without-completion" branch,
which is exactly where the Q5 deferral was created. This is CONSISTENT with the
observation that the deferral was created with the job still running.

## Candidate stop paths inspected (source review)

| Candidate | Observable in the captures? | Verdict |
|---|---|---|
| USER_CANCEL | The cancel path writes phase `resumable` (`sdk-task-control-coordinator.ts:160`, `:449`). The phase was `streaming` at 09:28:47, and no `task-control-cancel-*` writer appears in the provenance capture. | REFUTED |
| PROVIDER_FAILURE | Would write phase `error` (`sdk-session-event-coordinator.ts:2976`, `wasErrorSeen()`). No such writer. The phase was `streaming`. | REFUTED (for the phase) |
| TOOL_OR_SUPERVISOR_FAILURE (containment) | The containment failure occurred 42.8 s AFTER the abort. | REFUTED as the abort cause |
| RUNTIME_TERMINATION (internal SDK stop) | Consistent with the observation (no turn prepared after 09:28:21.802), but the reason is not recorded by any enabled capture. | PLAUSIBLE, UNPROVEN |
| NORMAL_INCOMPLETE_TURN | A `done` without a committed terminal response was observed (`attemptCompletionSeen=false`, `terminalResponseCommitted=false`) and the coordinator classified it as done-without-completion. | CONSISTENT, but the "done" itself is the abort's consequence |
| SESSION_INTERRUPTION | No epoch bump occurs after epoch 4 (`controller-epoch-transition-reseed` at 1792821549293 is the last one). | REFUTED |
| Exhausted recovery budget | `recoveryBudgetFailures=3` is present in the telemetry. This is AGGREGATE telemetry, not a per-event stop reason, and the ACT explicitly forbids treating it as proof. | NOT PROVEN |

## The required record

    STOP_EVENT_ID   = unavailable (no capture records a stop event id)
    STOP_TIME       = between 1792823301802 (09:28:21.802, last turn prepared)
                       and 1792823327640 (09:28:47.640, first `aborted` observation)
    STOP_REASON     = unavailable
    STOP_OWNER      = unavailable
    SESSION_ID      = 1792821549321_bwq2x
    EPOCH           = 4
    RUN_ID          = unavailable (the w-carrier trace records iteration numbers, not run ids)
    ACTIVE_JOB_IDS_AT_STOP = cmd_mvm0o260jip25i0b  (still RUNNING — it was the reason
                              the Q5 deferral was created)

## Consequence for this ACT

Per the ACT directive: "If no capture identifies the original abort, record
`ABORT_ORIGIN = UNAVAILABLE_FROM_TRACE`. That does not prevent investigating the
independently observable containment-to-handoff boundary, but it prevents claiming that
this repair fixes the original abort."

=> This ACT repairs the CONTAINMENT-TO-HANDOFF boundary ONLY. It does NOT claim to fix
   the original abort. The original abort remains an OPEN, SEPARATE question.
