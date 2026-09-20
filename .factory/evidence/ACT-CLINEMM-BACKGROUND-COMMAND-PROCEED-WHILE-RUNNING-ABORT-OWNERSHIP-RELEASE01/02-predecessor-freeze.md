# 02 — Predecessor freeze (closure of `ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01`)

This ACT inherits the following state from the predecessor ACT. Every line
below is CLOSED — not re-litigated without contradictory evidence. Full
provenance is in `.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-CANCELLATION-PROVENANCE01/`.

## Frozen prior LIVE findings (CLOSED for this ACT)

```text
LIVE_JOB                = cmd_mu9wmnyuhvgva8cn
JOB_MANAGER             = M2
OWNER_SESSION           = 1789914077854_aq4sy
STATUS_SOURCE           = M2.active
PRE_CANCEL_STATE        = running
PROCESS_CLEANUP         = postcondition=gone
TERMINAL_STATE          = cancelled
ACTIVE_REMOVE_REASON    = cancel
CANCELLATION_LATENCY_S  = 147.3
Q5_GUARD                = EXONERATED
TSWPD_WRITER            = EXONERATED_GIVEN_EMPTY_ACTIVE_SET
TaskHeader              = EXONERATED
```

## Causal chain proven by LIVE

```text
running managed job (M2, cmd_mu9wmnyuhvgva8cn)
  ↓
CALLER ABORT SIGNAL  (context.signal aborted on the foreground tool/turn
                     that started this job)
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

The chain above is CAUSAL (not merely chronological). The
`job_cancellation_requested` capture at the REQUEST BOUNDARY proves the
origin: `requestOrigin = "caller_abort_signal"`,
`firstWriterWins = true`, `currentState = "running"`, `manager = M2`.

## Refuted alternatives

```text
background_cancel_rpc     = REFUTED  (requestOrigin ≠ "background_cancel_rpc")
extension_shutdown       = REFUTED  (requestOrigin ≠ "extension_shutdown")
command_deadline          = REFUTED  (job_active_removed.reason = "cancel", not "deadline")
manager_instance_split    = REFUTED  (all polls hit same M2 active map; no instance drift)
owner_mismatch            = REFUTED  (ownerSessionId held through polls)
tool_cleanup              = REFUTED  (no production caller cancels a registered bg job on cleanup)
task_cancel_button        = REFUTED  (sdkTaskControlCoordinator.cancelTask does NOT touch CommandJobManager)
session_stop              = REFUTED  (sdkHost.stop does NOT call commandJobManager.dispose)
session_replacement       = REFUTED  (endActiveSession does NOT touch host)
```

## Predecessor epistemic boundary (FROZEN)

The predecessor ACT proves:

```text
caller AbortSignal
→ cancellation
→ active set empty
→ Q5 false
→ awaiting_followup
→ Your turn
```

The predecessor ACT does NOT prove:

```text
retaining the caller AbortSignal after the handoff
is the necessary defect
```

## Inherited hypothesis for THIS ACT

```text
ROOT_CAUSE_HYPOTHESIS = retained caller AbortSignal ownership
                        across foreground → background handoff

ABLATION              = NOT_EXECUTED  (must be executed HERE)

PRODUCTION_REPAIR     = NOT_YET_AUTHORIZED
                        (authorized HERE only on RED → GREEN)
```

This ACT executes the ablation on the REAL production handoff seam
(see `03-handoff-authority-map.md`) and either:
  (a) RED reproduces → ablation GREEN → repair authorized, OR
  (b) RED does not reproduce → HALT_RED_NOT_REPRODUCED, OR
  (c) RED reproduces but ablation does not turn GREEN →
        HALT (the listener retention is NOT the necessary cause).

No repair from hypothesis alone. No halt without executable evidence.
