ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 — LIVE DIAGNOSTICS INDEX
=========================================================================

For LIVE qualification of the notify-on-terminal contract,
the existing diagnostic rings carry the load-bearing data.
No new diagnostic framework was introduced (per §32 N32
constraint).

Existing rings consumed:

  1. background_job_liveness_authority (BJLA) ring
     File: apps/vscode/src/sdk/background-job-liveness-authority.ts
     Captures: command_job_lifecycle events including
       command_job_terminal_committed +
       command_job_containment_failed. Carries manager-instance
       identity + activeCount gauge.

  2. host-ownership-capture + post-terminal-authority-diagnostic
     rings
     Files: apps/vscode/src/sdk/host-ownership-capture* +
            apps/vscode/src/sdk/post-terminal-authority-diagnostic*
     Captures: terminal-vs-task ownership verdict. Useful for
     cross-checking that the wake consumer's owner_mismatch
     decision agrees with the post-terminal ownership diagnostic.

NEW (one bounded record, optional):
  BackgroundNotifyCoordinator.recordNotifyDecision emits a
  NotifyDecisionRecord to the host-supplied sink. The default
  sink is a no-op; tests wire it to an in-memory decisions array.
  Production code does not need to opt in; if it does, the
  sink can forward to the existing dogfood diagnostic profile.

Decision taxonomy (BCNT):
  - no_marker          (duplicate terminal event, marker evicted)
  - owner_mismatch     (cross-session / cross-task)
  - containment_no_wake (N9)
  - held               (other notify jobs outstanding)
  - drained            (FIFO drain to PendingPrompts)

LIVE diagnostic query (operator):
  - Trigger a notify=true background job.
  - After terminal event, inspect
    BackgroundNotifyCoordinator.decisions via the dogfood
    profile dump command (if the host wires a sink) OR
    inspect the in-memory ring via the debug-harness ext.evaluate
    seam.
  - For a natural terminal, expect exactly one
    {decision: "drained"} record with the matching jobId.
  - For containment_failed, expect exactly one
    {decision: "containment_no_wake"} record.
