# Live qualification — DEFERRED

LIVE qualification deferred. The actuator environment does not provide
a VS Code instance; the bounded repair's correctness is established by
the production-seam RED → GREEN + conservation matrix (07, 12, 16).

When LIVE is qualified, this file will document:

  - the bound set of BJLA / BOCOR / TSWPD records
  - the screenshot index
  - the operator-visible behavior (Backgrounded card, Cancel button,
    Job card state, TaskHeader)
  - the diagnostic dump commands executed
  - the dogfood VSIX identity (HEAD / SHA-256 / size / version)

The bounded repair is NOT marked LIVE_GREEN until this step is
completed. The ACT's verdict at the file:close boundary is:

  VERDICT = PASS_RED_REPRODUCED_ABLATION_PENDING → LIVE_GREEN_ABSENT
  (per ACT §46 / §47)

A future ACT (or the Factory reviewer) that runs the LIVE qualification
will mark the verdict as:

  VERDICT = PASS_ROOT_CAUSE_ABLATED_AND_REPAIRED

if the LIVE evidence matches the GREEN invariant (no caller_abort_signal
cancellation record for the detached job after the caller aborts).
