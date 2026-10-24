# Verified ownership map — C9/C10 completion slice

ENTRY_HEAD: `4a66459e9d6ee94d2947e82f30f5ce39793ccb6f`

| Stage | Production seam | Owner | Observable? | Classification |
|---|---|---|---|---|
| Completion fact | `message-translator.ts` completion-tool `content_end` | TypeScript | Yes: finalized `completion_result` row, without live authority marker | REAL_PRODUCTION_SEAM |
| C9 capture | `sdk-session-event-coordinator.ts` `handleSessionEvent` | TypeScript | Yes when CCARD capture is enabled: `submit_and_exit_seen` | REAL_PRODUCTION_SEAM |
| C9/C10 policy | `completion-authority-elm-authority-runtime.ts` / Elm completion-authority kernel | Elm | Yes: closed authorize/hold/failure decision consumed by TS | REAL_PRODUCTION_SEAM |
| Decision consumption | `sdk-session-event-coordinator.ts` `checkElmCompletionAuthority` | TypeScript | Yes: policy result controls the subsequent effect path | REAL_PRODUCTION_SEAM |
| Phase write request | `handleSessionEvent` / `reevaluateDeferredCompletionBarrier` `setTurnPhase("completed", ...)` | TypeScript | Yes as a requested effect, not by itself as a commit | REAL_PRODUCTION_SEAM |
| Phase commit | `turn-state-tracker.ts` `TurnStateTracker.setWithWriter` | TypeScript | Yes: snapshot phase becomes `completed` before listeners run | REAL_PRODUCTION_SEAM |
| Marker promotion | `sdk-session-event-coordinator.ts` `promoteCompletionAuthorityMarker` | TypeScript | Yes: same-`ts` update with `isAuthoritativelyCompletedResult=true` | REAL_PRODUCTION_SEAM |
| Webview presentation | `terminalReportFraming.ts` `resolveTerminalReportFraming` + `messageReducer.ts` `applyMessage` | TypeScript | Yes: completed framing and one visible row after reducer merge | REAL_PRODUCTION_SEAM |

## A-05 recon result

The documented A-05 retraction description was stale at ENTRY_HEAD. Current production semantics are commit-driven:

- The live completion row is published without `isAuthoritativelyCompletedResult`.
- Elm HOLD/FAILURE suppresses the C10 and therefore publishes no authoritative marker.
- A later successful immediate or deferred C10 promotes the same row by adding the marker.

The contract and diagrams now describe this verified behavior. No production policy behavior was changed.
