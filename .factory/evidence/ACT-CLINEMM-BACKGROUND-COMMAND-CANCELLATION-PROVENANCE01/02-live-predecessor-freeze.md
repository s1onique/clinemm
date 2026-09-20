# 02 — Live predecessor freeze

Provenance: ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01
(BJLA diagnostic commit `bab253afb` on top of `bec53f655`).

## Frozen prior LIVE findings (CLOSED for this ACT)

```text
JOB_ID                  = cmd_mu9v06vyx0bsxj44
JOB_MANAGER             = M2
OWNER_SESSION           = current active session
STATUS_SOURCE           = M2.active
PRE_CANCEL_STATE        = running
PROCESS_CLEANUP         = postcondition=gone
TERMINAL_STATE          = cancelled
ACTIVE_REMOVE_REASON    = cancel
Q5_GUARD                = locally correct / exonerated
TSWPD_WRITER            = session-event-turn-complete-resumable-straggler-preserve
TURN_STATE              = downstream consequence, not primary cause
```

## Refuted alternatives

```text
LA1 premature active removal while process still alive = REFUTED
LA2 manager-instance split                             = REFUTED
LA5 manager replacement                                 = REFUTED
LA4 status-source split                                = NOT OBSERVED
```

## Remaining primary defect

```text
UNEXPECTED_MANAGED_JOB_CANCELLATION
```

— assuming the operator did not click Cancel.
