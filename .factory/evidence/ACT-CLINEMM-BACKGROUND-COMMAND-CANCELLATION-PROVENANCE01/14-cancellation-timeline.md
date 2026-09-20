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

## LIVE specimen (added after the dogfood VSIX captured a real cycle)

The LIVE run on the dogfood VSIX (HEAD 640cc3881, SHA-256 5195db3a...)
produced the following observed timeline for `cmd_mu9wmnyuhvgva8cn`:

```text
t = 0       job_inserted (manager=M2, sessionId=1789914077854_aq4sy)
            → state=running, ownerSessionId=1789914077854_aq4sy

t + ~poll#1 status_lookup (manager=M2) → state=running
t + ~poll#2 status_lookup (manager=M2) → state=running
t + ~poll#N status_lookup (manager=M2) → state=running
            (all polls hit the same M2 active map; no instance drift;
             all polls carry the same ownerSessionId)

t ≈ 147.3 s REQUEST BOUNDARY (this ACT's contribution)
            job_cancellation_requested
              requestOrigin    = caller_abort_signal
              jobId            = cmd_mu9wmnyuhvgva8cn
              manager          = M2
              sessionId        = 1789914077854_aq4sy
              currentState     = running
              firstWriterWins  = true
              capturedAt       = T (ms resolution)

t = T       MUTATION BOUNDARY (predecessor ACT's contribution)
            command_job_termination_started
              manager = M2
              jobId   = cmd_mu9wmnyuhvgva8cn
              [FIRST-WRITER-WINS latch fires here]

t = T       command_job_primary_group_cleanup
              postcondition = gone

t = T       process_terminality_record
              state  = cancelled
              pgid cleared

t = T       job_active_removed
              previousState  = running
              terminalState  = cancelled
              reason         = cancel
              pid/pgid preserved from supervisor

t = T       background_state_change
              running = false

t = T + 5 ms  DOWNSTREAM (BOCOR / Q5)
              activeSessionId       = 1789914077854_aq4sy
              queriedOwnerSessionId = 1789914077854_aq4sy
              manager               = M2
              activeJobs            = []
              guardResult           = false

t = T + 5 ms  DOWNSTREAM (TSWPD)
              prior_state           = streaming
              new_state             = awaiting_followup
              writerId              = session-event-turn-complete-
                                      resumable-straggler-preserve

t = T + ~5 ms DOWNSTREAM (UI)
              TaskHeader flips to "Your turn"
              Backgrounded card / Cancel button become stale
              (secondary projection issue; deferred)
```

The exact ordering of `t ≈ 147.3 s` → `t = T` is the LIVE causal
evidence:

```text
running managed job (M2, cmd_mu9wmnyuhvgva8cn)
  ↓
CALLER ABORT SIGNAL  (context.signal aborted on the foreground
                       tool/turn that started this job)
  ↓
CommandJobManager cancels job  (job_cancellation_requested →
                                  command_job_termination_started →
                                  pgid_cleanup → process_terminality_record
                                  → job_active_removed)
  ↓
active map becomes empty
  ↓
Q5 correctly returns false
  ↓
awaiting_followup
  ↓
Your turn
```

`X` resolved to `caller_abort_signal`, classifying this LIVE occurrence
as `CASE_CP3_CALLER_ABORT_SIGNAL`. The full exoneration matrix and
the architectural root cause are in `25-live-result.md`.
