# §7 — CWRA-02: state snapshot at C10

## Safely-readable production state at the EXACT C10 boundary

The harness observes the coordinator's state immediately before and immediately after the C10 capture. The state sources that are safely-readable (no functional state updaters touched, no side effects):

| State field | Source | Value at C10 (LIVE: seq 8, at 1790809536499) | Notes |
|---|---|---|---|
| `activeRun` (Elm model) | Authority.elm `computeHoldReasons` -> `activeRunHeld = model.activeRun /= Nothing` | `Just run_h7wXy0mx` | **The hold that Elm rejects on.** |
| `runIdBySessionId` (production retention) | `apps/vscode/src/sdk/canonical-event-subscription.ts:89` | `run_h7wXy0mx` | The same runId the Elm kernel sees via `agent_turn_done`. |
| `wasTerminalResponseCommittedThisTurn()` (coordinator query) | `MessageTranslatorState.setTerminalResponseCommittedThisTurn` | `true` | Set at `content_end` of attempt_completion. |
| `wasAttemptCompletionSeen()` | `MessageTranslatorState.setAttemptCompletionSeen` | `true` | Set at `content_start` of attempt_completion. |
| `turnComplete` (translator result) | `MessageTranslatorState.translateAgentEvent` | `true` | Set on `type: "done"`. |
| `outstandingAutonomousWork` (coordinator aggregate) | computed in `handleSessionEvent` from `pendingPrompts + activeNotify + ownerStillRunning + unconsumedOwnedTerminalResults` | `false` (gated on `wasTerminalResponseCommittedThisTurn()` AND no held background jobs) | Production semantic of "no semantic work remains before commit". |
| `messageTranslatorState.getMinter().epoch` (identity) | `MessageIdMinter` | `1` (1-indexed) | Used for BCB epoch supersession. |
| `sessions.setRunning(false)` post-condition | `sessions.getActiveSession().isRunning` | `false` (immediately AFTER step 3 in the recon table) | The flag flip is the FIRST state change after C10. |
| `phase` (TurnStateTracker) | `setTurnPhase("completed", ..., "session-event-turn-complete-completed")` | `"completed"` | Authoritative UI phase commit. THIS is what the user sees. |

## LIVE_UNOBSERVABLE fields

The following fields are not safely observable at the exact C10 boundary (they would require direct, non-production access to internal state holders):

- `LocalRuntimeHost.runIdBySessionId` (session-local cache, not exported)
- `LocalRuntimeHost.eventBridge` (private dispatcher)
- `MessageTranslatorState` internal counters (private)
- The Elm `Model` (only reachable through the offline replay harness)

These are LIVE_UNOBSERVABLE per §7. The Elm model state is reconstructed offline via the replay harness (see `04-projected-replay-result.json`).

## Snapshot at C10 vs C8

The crucial observation: at the instant C10 fires (at=1790809536499), `runIdBySessionId` STILL contains `run_h7wXy0mx`. The agent's `run-started` event populated this map at 1790809530796 (the C7 boundary, 6.4 seconds earlier). The Elm kernel, replayed via the projection, sees the same `activeRun = Just run_h7wXy0mx` at the C10 boundary — which is the EXACT hold reason (`ActiveRun`) the kernel uses to fire `TaskCompletionCommittedWhileHeld`.

By the time C8 fires (at=1790809536550, 51ms later), `LocalRuntimeHost.runTurn`'s `onAgentTurnDone` hook invokes `clearRunIdForSession` (via `dispose` at end-of-session, not at C8 itself — the runId remains until the next run). The Elm model, however, would see `activeRun = Nothing` after `AgentTurnDone run_h7wXy0mx` — but C10 fires BEFORE C8, so the kernel never sees the post-C8 state at the C10 moment.
