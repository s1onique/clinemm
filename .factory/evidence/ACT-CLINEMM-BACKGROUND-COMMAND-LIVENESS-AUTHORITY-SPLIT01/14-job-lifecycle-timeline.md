# Job Lifecycle Timeline — Expected Shape

> The TIMELINE below is the EXPECTED shape after the next ACT's
> operator-driven LIVE reproduction. This file is the post-capture
> schema; the actual records land in `10-live-bjla.jsonl`.

The diagnostic captures the load-bearing lifecycle seams at
T0..T8 (per ACT sec 16). For one jobId `J`, the expected
chronological chain is:

```text
T0  manager_constructed
       managerInstance = M?
       hostInstance    = H?

T1  job_start_requested
       (no record yet — start is requested by run_commands;
        the manager captures T2 instead)

T2  job_active_inserted
       managerInstance = M?           (same as T0)
       hostInstance    = H?           (carries the host binding)
       taskId          = T
       jobId           = J
       ownerSessionId  = S
       state           = "running"
       pid             = <supervisor root pid or null>
       pgid            = <supervisor pgid or null>

     job_lifecycle_event_published (immediate follower of T2)
       managerInstance = M?
       eventName       = "command_job_process_started"
       jobId           = J

T3  status_lookup
       managerInstance = M?
       hostInstance    = H?
       jobId           = J
       source          = "active"
       returnedState   = "running"

T4  optional host/session/manager replacement
       (LA5 discriminator — fires ONLY if a replacement occurred)
       manager_dispose_begin
         managerInstance = M?
         activeJobIdsBeforeDispose = ["J"] OR []
       manager_dispose_end
         managerInstance = M?
         activeJobIdsAfterDispose = []
       manager_constructed (the NEW manager)
         managerInstance = M2 (M2 != M?)

T5  active.delete(jobId)  — OR manager change
       job_active_removed (LA1 discriminator — fires ONLY if the
                          manager legitimately removes the job)
         managerInstance = M?
         jobId           = J
         previousState   = "running"
         terminalState   = "exited" / "cancelled" /
                           "deadline_exceeded" / "spawn_failed" /
                           "containment_failed"
         reason          = "natural" / "cancel" / "deadline" /
                           <production reason or null>
         pid             = <root pid or null>
         pgid            = <pgid or null>

T6  status_lookup (post-removal probe)
       managerInstance = M?
       source          = "terminal" OR "miss" OR "active" (if LA2)

T7  BOCOR decision (the Q5 boundary)
       managerInstance = M? (Q5 guard manager — MAY differ from T0/T2)
       hostInstance    = H?
       activeJobs      = []    ← THE LIVE SPECIMEN'S KEY FIELD
       guardResult     = false ← THE LIVE SPECIMEN'S KEY FIELD

T8  TSWPD transition (independent of BJLA — captured by the
    existing TSWPD ring)
       writerId        = "session-event-turn-complete-resumable-straggler-preserve"
       previous        = { phase: "streaming", seq: 20 }
       committed       = { phase: "awaiting_followup", seq: 203 }
```

================================================================
JOIN: BJLA → BOCOR → TSWPD
================================================================

The three dumps must be joined on:

  - same `taskId` (1789903873206_g5qvj for the LIVE specimen)
  - same `jobId` (cmd_mu9qjxmwxl5hasi8)
  - chronological order (T2 → T7 → T8)

The join is the load-bearing evidence the next ACT will use to
classify the LIVE occurrence.

================================================================
EXPECTED MECHANICAL CLASSIFICATION
================================================================

Per the LIVE specimen:

  T7.managerInstance != T2.managerInstance  →  CASE_LA2_MANAGER_INSTANCE_SPLIT

  OR

  T5 (job_active_removed) is OBSERVED with terminalState !=
  containment_failed AND T6 (status probe) returns "running" →
  CASE_LA1_PREMATURE_FINALIZATION

  OR

  T2.managerInstance == T5.managerInstance == T7.managerInstance
  AND T5 NOT observed AND T6 returns "running"  →
  CASE_LA3_STALE_PROJECTION (projection stuck true)

  OR

  T2.managerInstance != T7.managerInstance AND T6 returns "running"
  AND T6.managerInstance != T2.managerInstance  →
  CASE_LA4_STATUS_AUTHORITY_SPLIT (status read from a third path)

  OR

  T4 fires (manager_dispose_begin / dispose_end for M1) AND
  T5 NOT observed AND T6 returns "running"  →
  CASE_LA5_MANAGER_REPLACEMENT_STRANDS_ACTIVE_JOB

The exact classification is the next ACT's responsibility.
