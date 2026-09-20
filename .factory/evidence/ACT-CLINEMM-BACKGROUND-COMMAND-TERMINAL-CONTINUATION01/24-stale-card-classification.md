# Stale Card Classification — BTCONT01

## Live-proven
- Backgrounded / Cancel button visible after terminality: LIVE_PROVEN
  (bjla rows 17, 18, 21; foreground-style "running" projection frozen)

## Same-root-cause discriminator

The TaskHeader card renders `backgroundCommandRunning` + the
command-row's frozen `{"status":"running"}` JSON. Both are projections
of:
  1. `SdkController.backgroundCommandRunning` (flipped by
     `updateBackgroundCommandState` which now ALSO drives the
     continuation re-evaluation)
  2. `command_row.tool_result` (immutable historical row written at the
     earlier poll that returned RUNNING)

The repair in this ACT updates #1 at the SAME >0->0 cardinal transition
that flips `backgroundCommandRunning` to `false`. The webview already
redraws the footer when the projection flips (verified by
`updateBackgroundCommandState` calling `postStateToWebview`). So the
GREEN button-flip is "fixed incidentally" by this ACT.

The frozen `{"status":"running"}` row in the chat transcript is a
historical record (per ACT §30: "Do not mutate historical output").
The card that renders the green "Backgrounded / Cancel" affordance
IS projected from `backgroundCommandRunning` and IS fixed.

## Classification
- Card projection: SAME_SHARED_CONSUMER (incidental fix)
- Frozen command-row JSON: STAYS (historical)

## Successor
No successor ACT required for the live button-affordance; the fix is
incidental. If a future ACT needs to also retitle the frozen row text
(e.g. "Cancelled" badge), it should route through the canonical
`command_row` write path (out of scope for this ACT).
