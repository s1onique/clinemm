# Hypotheses — BTCONT01

## TC1 — terminal event visible but no continuation consumer exists
**Status:** CONFIRMED via recon.
- BJLA shows terminal events ARE published to host (rows 14-21).
- SdkController.updateBackgroundCommandState receives the projection update.
- BUT no consumer asks the canonical turn owner to re-evaluate.

## TC2 — terminal event loses owning session identity
**Status:** REFUTED.
- job.ownerSessionId is preserved end-to-end (bjla row 3: 1789935070156_oneah).
- BTCONT-CTL-05 confirms: session B's terminal event does not affect session A.

## TC3 — Q5 deferral leaves no durable "continuation owed" fact
**Status:** CONFIRMED via recon.
- grep -rn 'deferredContinuation' finds no production state.
- BTCONT-CTL-03 proves this matters: without epoch binding, a late
  terminal event could mutate a newer turn.

## TC4 — continuation exists but is gated incorrectly
**Status:** REFUTED.
- No continuation consumer exists, so no guard to be wrong.

## TC5 — terminal event arrives at a replaced/stale host
**Status:** REFUTED.
- BTCONT-CTL-05 (different session) and the LIVE evidence
  (managerInstance=M2, hostInstance=H2 in BOCOR row 1) prove the
  canonical authority owns both Q5 defer and the terminal lifecycle.

## TC6 — other proven cause
**Status:** N/A.

## Causal verdict
- Primary cause:  TC1 + TC3 hybrid (TC1: missing consumer;
                                       TC3: no durable deferred-continuation marker).
- Secondary cause: stale command-row projection (deferred to
  ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01 unless
  recon proves identical seam).
