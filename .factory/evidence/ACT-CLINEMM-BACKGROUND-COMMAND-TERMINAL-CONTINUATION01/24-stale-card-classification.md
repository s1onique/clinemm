# 24 — Stale Card Classification (correction cycle 1)

## Honest classification

The reviewer correctly flagged that the stale-card conclusion was over-promoted
to "closed" in the previous ACT closure. The honest state after correction
cycle 1:

```
STALE_CARD_LIVE_FAILURE = PROVEN          (LIVE specimen bjla rows 13-21)
STALE_CARD_REPAIR       = STRUCTURALLY_EXPECTED / LIVE_PENDING
```

## Why "STRUCTURALLY_EXPECTED" and not "PASS"

The green "Backgrounded/Cancel" button's stale state IS structurally fixed
by the same repair:

1. The >0->0 cardinal transition fires `onBackgroundStateChange(false, undefined)`.
2. `SdkController.updateBackgroundCommandState(false, undefined)` runs.
3. The body calls `this.postStateToWebview()` which posts the new
   `backgroundCommandRunning=false` projection to the webview.
4. The webview's TaskHeader / button affordance flips from
   "Backgrounded/Cancel" back to the appropriate state.

The same single code path in `updateBackgroundCommandState` is the
load-bearing wire for BOTH:
  - the canonical reevaluation (BTCONT-BRIDGE-01)
  - the projection flip (the existing card-stale fix from
    ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01)

## Why "LIVE_PENDING" and not "REPAIRED"

Operator-side dogfood has not run the 600s specimen post-repair. Until a
real human sits through the deadline on a real dogfood build and confirms
the button no longer goes stale, the LIVE qualification is pending.

The structural argument is sound, but the LIVE evidence is not yet
captured. This ACT does not close the stale-card question; it only
confirms the structural fix is in place.
