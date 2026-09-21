15 — LIVE Cancel (Operator Dogfood, Pending)
=============================================

SCENARIO:
  sleep 60

  Click the **card** Cancel button while running.

EXPECTED:
  background_cancel_rpc fires with the exact jobId
  → job cancelled
  → onBackgroundStateChange(false, undefined) (or per-jobCancel
    variant if cancelBackgroundCommand(jobId) takes the
    single-job fast-path) arrives
  → card terminal/non-cancelable immediately after projection update
  → No stale Cancel button after successful cancellation

This ACT preserves the exact cancelBackgroundCommandByJobId callback
(BCTCP-09 + BGCL-06) and adds the per-job projection update on
cancel so the card reflects terminal immediately even if the
backend's terminalPromise settles after the card posts.
