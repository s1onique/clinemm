ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 — LIVE NEGATIVE
===================================================================

LIVE QUALIFICATION: DEFERRED (same reasoning as 16-live-positive.md).

Executable coverage that qualifies this in lieu of LIVE:
  - BCNT-02 (notifyOnCompletion omitted -> zero wake, zero
    marker): the production tool's lifted block skips
    registration when notifyOnCompletion is not exactly true.
    The marker map stays empty. No wake is queued.
  - BCNT-03 (notifyOnCompletion: false explicit -> zero wake,
    zero marker): same as above with the explicit-false
    payload.
  - BCNT-12 (ephemeral marker loss after dispose): the
    coordinator's dispose() drops all markers without
    persistence; subsequent consumeTerminal is a no-op.

Operator dogfood cycle (next ACT):
  1. Build dogfood VSIX from the post-ACT HEAD.
  2. Open a Cline session.
  3. Prompt the model:
       "Start this in the background and return immediately:
        sh -c 'sleep 30; echo FINISHED'"
  4. Confirm:
       - tool input does NOT contain notifyOnCompletion: true
         (the model may omit it or set it explicitly to false)
       - the tool returns RUNNING + jobId
       - the current turn ends
       - the job completes
       - NO unsolicited model continuation fires (the
         agent does not speak again until the user pings)
