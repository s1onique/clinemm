# §6 Capture contract (TEMPORALLY HONEST — pre-§18 second pass)

The minimum complete correspondence contract, derived from the §4 recon + Elm Codec tag set + corrected §5 identity map (second pass, temporally honest). This is the contract the §21 bounded implementation must satisfy and the §18 RED tests must prove.

```text
task_started {
  taskId              // sessionId returned from taskStart.initTask; proven ≡ task.taskId via 5 explicit assignments at rebuild seams
}

run_turn_started {
  runId               // PROVEN_EQUIVALENT_EXISTING_ID (runtime snapshot.runId, surfaced via subscribeRuntimeEvents)
  origin
}

execute_turn_prelude_enter {
  (no runId)          // UNAVAILABLE — runId does not exist at the prelude boundary (prelude fires before
                      //   AgentRuntime.execute() at agent-runtime.ts:1500, AFTER executeTurn's prelude awaits).
                      //   CCARD buffer records the event without runId for offline diagnostic value;
                      //   replay adapter returns INSUFFICIENT_IDENTITY; Elm kernel never sees the event.
                      //   The kernel's activeRun state is set by the later run_started event (same effective
                      //   transition); the PRELUDE_STALL discriminator becomes unobservable in replay
                      //   (accepted trade).
}

agent_turn_done {
  runId               // PROVEN_EQUIVALENT_EXISTING_ID (runtime snapshot.runId, surfaced via subscribeRuntimeEvents)
}

pending_prompt_enqueued {
  promptId
  origin
}

pending_prompt_dequeued {
  promptId
}

continuation_scheduled {
  promptId            // held by SDK host from this capture, keyed by sessionId
}

continuation_started {
  promptId            // held by SDK host from continuation_scheduled capture
  runId               // PROVEN_EQUIVALENT_EXISTING_ID (runtime snapshot.runId, surfaced via the SAME listener)
  // Fires ONLY when a held promptId matches the snapshot's sessionId.
  // If no held prompt matches, the event does NOT fire (no replay-order recovery; Option B is DELETED).
}

terminal_committed {
  jobId
  ownerId             // DIRECT_EXISTING_ID = job.ownerSessionId (set at launch, stable)
  // (no terminalKind) // UNAVAILABLE — no launch-time immutable launchOwnershipKind field on CommandJob today.
                       //   CCARD buffer records terminal_committed WITHOUT terminalKind (just jobId + ownerId);
                       //   replay adapter returns INSUFFICIENT_IDENTITY for it (adapter lines 139-145 already
                       //   enforce this); Elm kernel never sees terminal_committed in v1.
}

terminal_observed {
  jobId
}

submit_and_exit_seen {
  submitId            // SUBMIT_EVENT_ID — coordinator-local nextSubmitSeq counter
}

task_completion_committed {
  completionId        // COMPLETION_COMMIT_EVENT_ID — coordinator-local nextCompletionSeq counter
}
```

Optional but desirable (only if a real identity exists at the seam):

```text
completion_presented {
  completionId        // PROVEN_EQUIVALENT_EXISTING_ID = COMPLETION_COMMIT_EVENT_ID from most recent C10 fire
}
```

## Notes from §4 recon + §5 second-pass correction

- `run_turn_started` and `agent_turn_done` are the CCARD capture stages for run lifecycle; the replay adapter maps `run_turn_started` to the Elm tag `run_started` (see `completion-authority-elm-replay.ts:104-117`). The `runId` is sourced from the runtime snapshot surfaced through `LocalRuntimeHost.subscribeRuntimeEvents` — NOT from `runTurn` parameters (which do not exist), NOT from the caller-side C7 capture (which fires before `runId` is minted).
- `execute_turn_prelude_enter` is captured WITHOUT `runId` at `local-runtime-host.ts:2136` (the first executable line of `executeTurn`, before the first await). The replay adapter returns `INSUFFICIENT_IDENTITY` and the Elm kernel never sees the event. The PRELUDE_STALL discriminator is unobservable in replay; the diagnostic value is preserved in the CCARD buffer for offline analysis.
- `task_started` is captured at `SdkController.initTask:3586` immediately after `taskStart.initTask` returns the `sessionId`. The capture is the EARLIEST reliable task-creation seam — earlier than the first C-stage fire inside `SdkSessionEventCoordinator` (which would only fire after the first prompt round-trip). The capture is gated by the same `captureEnabled` flag as the other CCARD hooks.
- `terminal_observed` is mapped by the adapter from BOTH `wake_created` and `notify_consume_enter` (replay adapter lines 151-157). No new field needed.
- `terminal_committed` is captured WITH `ownerId` (from `job.ownerSessionId`, launch-time immutable) and WITHOUT `terminalKind`. The replay adapter already returns `INSUFFICIENT_IDENTITY` for `terminal_committed` without `terminalKind` (adapter lines 139-145); therefore the Elm kernel never sees `terminal_committed` in v1.
- The contract is **closed**: the Elm Codec has exactly these tags. No new tag values. No schema additions to Authority.elm / Domain.elm / Codec.elm / Main.elm.
- The contract is **private diagnostic evidence**: no proto field, no gRPC field, no MCP protocol change, no public SDK API change, no wire API change, no myc schema change (per §16).

## What this contract guarantees (when the §21 implementation lands) — second pass

1. **No manufactured identity**: every field comes from `DIRECT_EXISTING_ID`, `PROVEN_EQUIVALENT_EXISTING_ID`, `NEW_ID_AT_EVENT_CREATION`, or honestly `UNAVAILABLE` (per §5 corrected classification).
2. **No temporal smuggling**: every identity field on every event corresponds to a fact that genuinely exists at the seam where the event fires. No chronology→identity promotion.
3. **No origin rewrites**: the `origin` field is whatever the production code computes (`explicit_user` / `pending_prompt_drain` / `deferred_continuation` / `background_terminal` / etc.); the adapter preserves it verbatim.
4. **Explicit prompt↔run join** (Option A, single design): `continuation_started` carries BOTH `promptId` and `runId` ONLY when the SDK host's runtime-snapshot listener observes a held prompt whose sessionId matches the snapshot's sessionId. The subsequent `run_turn_started` carries the SAME `runId`. The Elm replay can join by identity, not by event order. If no held prompt matches, the event does NOT fire (no replay-order recovery; Option B is DELETED).
5. **Single authority for `run_turn_started`**: the runtime-snapshot listener owns it. The previous caller-side C7 capture (`onRunTurnStarted` at `vscode-session-host.ts:531-540`) is removed from the Elm contract; it can stay in production for non-Elm observability but its records are never adapted to Elm.
6. **Launch-time immutable ownership**: `ownerId` on `terminal_committed` is `job.ownerSessionId`, set at LAUNCH time in `CommandJobManager.start()` (line 1884) and stable from launch to finalize.
7. **Submit distinctness**: each `submit_and_exit_seen` carries a unique `submitId` minted at the C9 capture seam; re-submits increment the counter, BCB holds do NOT.
8. **Completion distinctness**: each `task_completion_committed` carries a unique `completionId` minted at the C10 capture seam. Same `completionId` may reappear in `completion_presented` if the presentation uses the same durable row.
9. **taskId ≡ sessionId** (PROVEN): `task_started { taskId }` and every other `taskId` field carries `sessionId`, which is proven equivalent to `task.taskId` via 5 explicit production assignments at every rebuild seam (`applyProviderConfigurationInstance:145`, `applyTypedProviderConfigurationInstance:273`, `performRestartActiveSessionForProviderChange:362`, `resumeSessionFromTask:322`, `performRebuildSessionForMode:318`).

## What this contract does NOT guarantee — second pass

- Does NOT fix the cancel→reopen presentation bug (§22 prohibition; deferred to a successor ACT).
- Does NOT touch the Elm kernel's authority rules — only the capture contract that FEEDS the kernel.
- Does NOT touch the BCB barrier, PCCA, CPA, PCRS02/PCRS02C01 invariants — only the producer side that captures them.
- Does NOT introduce a new diagnostic mode — the existing `captureEnabled` dogfood gate is reused.
- Does NOT make `terminal_committed` replayable in v1 (terminalKind is UNAVAILABLE; the kernel never sees the event). This is an accepted trade; lifting it requires a successor ACT that adds a launch-time immutable `launchOwnershipKind` field to `CommandJob`.
- Does NOT make `execute_turn_prelude_enter` replayable in v1 (runId does not exist at the prelude boundary; the kernel never sees the event). This is an accepted trade; the PRELUDE_STALL discriminator becomes unobservable in replay.

## §21 implementation contract (concrete — second pass)

| Action | File:Line | Change |
|---|---|---|
| Add 4 optional fields to CCARD record (NO `terminalKind?`) | `continuation-cardinality-authority.ts:ContinuationCardinalityAuthorityRecord` | Add `runId?`, `submitId?`, `completionId?`, `ownerId?`. (Omit `terminalKind?` since it is UNAVAILABLE.) |
| REMOVE caller-side C7 `run_turn_started` capture from Elm contract | `vscode-session-host.ts:531-540` | The hook stays in production for non-Elm observability but its records are no longer adapted to Elm. (Alternatively: drop the hook entirely if §21 simplifies production code; either choice preserves §22 prohibition.) |
| NEW: 1 `subscribeRuntimeEvents` listener (Option A — sole authority) | `vscode-session-host.ts` (new seam) | On `"run-started"` snapshot: emit `run_turn_started { runId: snapshot.runId, origin }` (unconditional). Also emit `continuation_started { promptId: held.P, runId: snapshot.runId }` ONLY if held prompt matches snapshot.sessionId. On `"run-finished"` / `"run-failed"`: emit `agent_turn_done { runId: snapshot.runId }`. |
| NEW: `task_started` capture at real task-creation seam | `SdkController.initTask:3591` (immediately after `taskStart.initTask` returns sessionId at 3586) | Emit `task_started { taskId: sessionId }`. Gated by the same `captureEnabled` flag. |
| Thread `submitId` / `completionId` | `sdk-session-event-coordinator.ts:1209, 1406` | Coordinator-local counters `nextSubmitSeq` / `nextCompletionSeq`; increment at C9/C10 fires only. |
| Thread `ownerId` (NO `terminalKind`) | `command-job-manager.ts:2657` | Read `job.ownerSessionId` (stable from launch); include in capture payload. Omit `terminalKind` field entirely (it's UNAVAILABLE in v1). |
| Add `completion_presented` (optional) | `sdk-session-event-coordinator.ts:1412` | Reuse most-recent `COMPLETION_COMMIT_EVENT_ID` if added. |

No other production files change. No Elm kernel change. No BCB / PCCA / CPA / PCRS02 / PCRS02C01 / CCARD-1.x invariants change.
