# LIVE Witness

## LIVE T0

The model initiated an autonomous run via `run_command` (the upstream
Cline tool). The command was:

  sh -c 'echo STARTED; sleep 600; echo FINISHED'

That tool returned RUNNING + jobId. The model then monitored the
job via `command_status` calls.

  jobId      = cmd_mu9mh0uahxjkxbo3
  card       = Backgrounded
  Cancel     = visible (operator-observable in the webview UI)
  runtime    = running (the `sleep 600` did not finish; the job
              stayed in the manager's `active` map with state="running")
  header     = Working
  model      = visibly continuing autonomous work (the operator
              observed model output mentioning "let me continue
              monitoring it" and "I should monitor it and then submit
              when complete")

## LIVE T1

The SAME jobId stayed observable/cancellable from the webview:

  jobId      = cmd_mu9mh0uahxjkxbo3   (UNCHANGED)
  card       = Backgrounded            (UNCHANGED)
  Cancel     = visible                 (UNCHANGED)
  runtime    = running                 (UNCHANGED)

But the header transitioned:

  header     = Your turn               (CHANGED from Working)

The model output still described "the command is still running"
and "let me continue monitoring periodically" — autonomous
behavior was not interrupted at the model layer.

## TSWPD capture (canonical writer witness)

  taskId  = 1789897019328_sn0k5
  epoch   = 16
  previous.phase   = streaming
  previous.seq     = 2353
  writerId         = session-event-turn-complete-resumable-straggler-preserve
  requested.phase  = awaiting_followup
  committed.phase  = awaiting_followup
  committed.seq    = 2460

## Classification

  LIVE_MANAGED_JOB_CONTINUES       = TRUE
  LIVE_HEADER_TRANSITION           = Working → Your turn
  WEBVIEW_HEADER_PROJECTION_DEFECT = REFUTED
    (header correctly tracks committed.phase)
  CAUSAL_PHASE_WRITER              =
    session-event-turn-complete-resumable-straggler-preserve

## What the operator needs explained

  Why did the writer commit `awaiting_followup` while the active
  session still visibly owned a RUNNING managed `CommandJob`?

  Per the existing Q5 contract at sdk-session-event-coordinator.ts:274-291
  the writer at this writerId is GUARDED by
  `hasRunningBackgroundJobForOwner(activeSession.sessionId)`. The fact
  that this writerId is what committed is proof that the guard EITHER
  returned `false` OR the optional chain short-circuited to undefined
  (treated as falsy).
