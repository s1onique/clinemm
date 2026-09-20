# 14 — Cancellation timeline (per LIVE specimen)

The LIVE specimen is `cmd_mu9v06vyx0bsxj44`. The frozen sequence from the
predecessor ACT (`ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01`)
shows the MUTATION chain. After this ACT, the REQUEST chain is now also
capturable for every LIVE run.

```text
PRE-LIVE (frozen from predecessor ACT):

  t0   managed CommandJob = RUNNING
       manager = M2
       status source = M2.active
       owner = current active session
       pid/pgid = <production values>
       state = "running"

  t1   command_job_termination_started          [mutation boundary]
       (this is the FIRST-WRITER-WINS gate)

  t2   command_job_primary_group_cleanup        [mutation boundary]
       (postcondition = "gone")

  t3   process_terminality_record               [mutation boundary]
       (state = "cancelled", pgid cleared)

  t4   job_active_removed                       [mutation boundary]
       (previousState = "running", terminalState = "cancelled",
        reason = "cancel", pid/pgid preserved from supervisor)

  t5   BOCOR guard = false                      [downstream consequence]

  t6   TSWPD writes "session-event-turn-complete-resumable-straggler-preserve"
                                                       [downstream consequence]

  t7   UI shows "Your turn"                     [downstream consequence]


POST-LIVE (added by this ACT):

  Each t1..t4 event will now ALSO carry a job_cancellation_requested
  record emitted at the REQUEST BOUNDARY (tA, BEFORE t1). The first such
  record carries `firstWriterWins=true` and the threaded `requestOrigin`:

      tA   job_cancellation_requested            [REQUEST BOUNDARY]
           origin = "<one of background_cancel_rpc | manager_dispose |
                      extension_shutdown | command_deadline |
                      caller_abort_signal | other:<bounded id>>"
           firstWriterWins = true
           managerInstance = M2
           jobId = cmd_mu9v06vyx0bsxj44
           currentState = "running"
           capturedAt = <ms just before t1>

  The tA event is emitted BEFORE this.terminate() mutates anything
  (so it is verifiable that the job was still in the "running" state
  at the moment of the cancellation request). The Cardinality invariant
  guarantees EXACTLY ONE tA record per LIVE cycle that initiated the
  termination; subsequent cancel calls (idempotent) return early at
  `job.state !== "running"` and do not emit additional tA records.
```

## Mechanically-classifiable LIVE chain (after this ACT)

```text
job J active in M2
↓
job_cancellation_requested(J, origin=X)              ← THIS ACT
↓
command_job_termination_started(J)                   ← predecessor ACT
↓
command_job_primary_group_cleanup(J, postcondition=gone)
↓
job_active_removed(J, terminalState=cancelled, reason=cancel)
↓
BOCOR guard = false                                  ← Q5
↓
TSWPD writes "awaiting_followup"                     ← TSWPD
↓
UI "Your turn"
```

`X` is the discriminator that this ACT makes observable. The next LIVE
run will resolve `X` to exactly one of the bounded origin values.
