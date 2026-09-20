# LIVE Qualification — Operator-Driven Procedure

> This file is the LIVE operator procedure per ACT sec 28. The
> operator (not the Cloud Agent) executes this procedure after
> installing the diagnostic build into their real dogfood
> ClineMM instance.

---

## 0. Prerequisites

  - Operator has installed the diagnostic build VSIX (the
    SHA256-bound artifact referenced in `09-vsix-identity.txt`)
    into their real dogfood ClineMM instance.
  - `isDogfoodRuntime(process.env) === true` (this is the
    central dogfood profile identity bit; mirrors BOCOR).
  - The three existing dogfood-only diagnostic dumps are
    available:
      - Cline Debug: Dump Background Owner Correlation (BOCOR)
      - Cline Debug: Dump Background Job Liveness Authority (BJLA)
      - Cline: Dump Turn State Writer Provenance Diagnostic (TSWPD)

## 1. Trigger the LIVE contradiction

In a ClineMM session with a long-running shell command support,
issue (via the run_commands tool or via a model turn that emits
a long-running command):

```text
sh -c 'echo STARTED; sleep 600; echo FINISHED'
```

Wait for the model + tool to enter the Backgrounded state with
the Cancel button visible.

## 2. Wait for the Q5 boundary

The Q5 boundary fires when the run_commands tool returns a
RUNNING(jobId) envelope to the model and the model emits its
final assistant text (or falls silent). At this instant, the
Q5 guard (`hasRunningBackgroundJobForOwner(activeSessionId)`)
evaluates against the `activeJobs` snapshot.

The expected LIVE contradiction (mirroring the prior specimen):

```text
UI / model-visible command:
  jobId = cmd_???
  card  = Backgrounded
  Cancel = visible
  status = running

Q5 guard:
  activeJobs = []
  guardResult = false
```

## 3. Capture the three dumps (in this order, per ACT sec 28)

  1. Cline Debug: Dump Background Job Liveness Authority
     → .factory/evidence/.../10-live-bjla.jsonl
     Records: manager_constructed / job_active_inserted /
              job_status_lookup / job_cancel_lookup /
              background_state_change_published /
              manager_dispose_begin (if any) /
              job_active_removed (if any) /
              job_lifecycle_event_published events, each tagged
              with `managerInstance` (M1, M2, ...) and
              `hostInstance` (H1, H2, ...).

  2. Cline Debug: Dump Background Owner Correlation
     → .factory/evidence/.../11-live-bocor.jsonl
     Records: background_owner_correlation_decision events,
     NOW ENRICHED with managerInstance / hostInstance (the new
     optional fields added by this ACT).

  3. Cline: Dump Turn State Writer Provenance Diagnostic
     → .factory/evidence/.../12-live-tswpd.jsonl
     Records: writerId / epoch / previous / committed tuples for
     every turnState mutation. The writerId at the Q5 boundary
     is "session-event-turn-complete-resumable-straggler-preserve".

## 4. Take the UI screenshot

Preserve a screenshot showing:

  jobId = cmd_???
  card  = Backgrounded
  Cancel = visible
  status = running
  header state (post-Q5; the turnState.phase value)

→ .factory/evidence/.../live-screenshot.png

## 5. Optional discriminator: Cancel click

After all three dumps are captured (DO NOT click Cancel before
the dumps), the operator MAY click Cancel as a discriminator:

  - LA2 / LA5 hypothesis: Cancel returns "unknown_job" (the
    guard manager does not own the job; the start manager does).
  - LA1 hypothesis: Cancel succeeds but the UI projection stays
    stuck "running" (the projection was never updated).
  - LA3 hypothesis: Cancel succeeds and the projection clears
    (the bug was elsewhere).

## 6. Mechanical classification (next ACT)

The next ACT joins the three dumps on the same jobId /
taskId and mechanically classifies the LIVE occurrence:

  LA1  job_active_removed fires BEFORE the PGID postcondition
       probe returns "gone".
  LA2  job_active_inserted.managerInstance !=
       guard_record.managerInstance
       AND job_status_lookup.managerInstance ==
       job_active_inserted.managerInstance
  LA3  job_active_removed fires with terminalState=clean AND
       command_job_primary_group_cleanup.postcondition="gone"
       AND background_state_change_published.running=false
       AND the UI projection stayed "running".
  LA4  job_status_lookup.managerInstance !=
       guard_record.managerInstance AND
       job_status_lookup.source="miss" AND the model-visible
       status reports "running" via a separate authority.
  LA5  manager_dispose_begin fires for M1 AND
       manager_dispose_begin.activeJobIdsBeforeDispose contains
       jobId AND manager_constructed fires for M2 (M2 != M1).
  LA6  none of the above.

## 7. Bounded repair (next ACT)

Per ACT sec 21..24. The bounded repair is the LA-specific seam
listed in `18-repair-diff.txt`.

## 8. After repair: re-qualify

  - Re-run the LIVE procedure.
  - The expected result: `activeJobs=[J]` at the Q5 boundary AND
    `guardResult=true` AND the phase stays at "streaming" (the
    post-Q5-01 "Working" affordance is preserved).
  - If the LIVE GREEN reproduces the bounded repair's
    PASS_CASE_*, the diagnostic + the bounded repair are
    qualified.

## 9. Diagnostic removal

  After qualified LIVE GREEN:
    - Remove BOCOR + BJLA together (per ACT sec 30)
    - Remove the package.json command declarations
    - Remove the registry entries
    - Remove the activation helpers
    - Remove the test files

  UNLESS separately promoted as permanent dogfood observability.

## 10. Result fields

After the operator completes steps 1..5, the operator fills in
the following fields in the next ACT's `result.json`:

  live_subject.task_id       = <captured>
  live_subject.job_id        = <captured>
  live_subject.ui_status     = "running"
  live_subject.manager_active_jobs_at_q5 = 0
  live_subject.guard_available = true
  live_subject.guard_result    = false
  classification               = <LA1..LA6 or NOT_REPRODUCED or CAPTURE_INSUFFICIENT>
  authority.start_manager_instance  = <M?>
  authority.status_manager_instance = <M?>
  authority.guard_manager_instance  = <M?>
  authority.remove_manager_instance = <M?>
  authority.status_source           = <active|terminal|miss>
  authority.active_remove_seen      = <true|false>
  causality.established = true
  causality.ablation    = "EXECUTED"
  repair.performed      = true
  repair.files          = [<bounded-seam files>]
  verdict               = <PASS_CASE_*>
