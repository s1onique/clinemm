# §6 Capture contract (CORRECTED — pre-§18)

The minimum complete correspondence contract, derived from the §4 recon + Elm Codec tag set + corrected §5 identity map. This is the contract the §21 bounded implementation must satisfy and the §18 RED tests must prove.

```text
task_started {
  taskId              // = activeSession.taskId = activeSession.sessionId (PROVEN_EQUIVALENT_EXISTING_ID)
}

run_turn_started {
  runId               // PROVEN_EQUIVALENT_EXISTING_ID (runtime snapshot.runId, surfaced via subscribeRuntimeEvents)
  origin
}

execute_turn_prelude_enter {
  runId               // same source as run_turn_started
}

agent_turn_done {
  runId               // same source as run_turn_started
}

pending_prompt_enqueued {
  promptId
  origin
}

pending_prompt_dequeued {
  promptId
}

continuation_scheduled {
  promptId
}

continuation_started {
  promptId             // held by SDK host from continuation_scheduled capture
  runId               // surfaced from runtime snapshot at the SAME listener (Option A)
}

terminal_committed {
  jobId
  ownerId             // DIRECT_EXISTING_ID = job.ownerSessionId (set at launch, stable)
  terminalKind        // NEW_ID_AT_EVENT_CREATION — factual enum computed at finalize from LAUNCH metadata
}

terminal_observed {
  jobId
}

submit_and_exit_seen {
  submitId            // renamed SUBMIT_EVENT_ID in §5 — coordinator-local nextSubmitSeq counter
}

task_completion_committed {
  completionId        // renamed COMPLETION_COMMIT_EVENT_ID in §5 — coordinator-local nextCompletionSeq counter
}
```

Optional but desirable (only if a real identity exists at the seam):

```text
completion_presented {
  completionId        // PROVEN_EQUIVALENT_EXISTING_ID = COMPLETION_COMMIT_EVENT_ID from most recent C10 fire
}
```

## Notes from §4 recon + §5 correction

- `run_turn_started` is the CCARD capture stage; the replay adapter maps it to the Elm tag `run_started` (see `completion-authority-elm-replay.ts:104-117`). The `runId` is sourced from the runtime snapshot surfaced through `LocalRuntimeHost.subscribeRuntimeEvents` — NOT from `runTurn` parameters (which do not exist).
- `terminal_observed` is mapped by the adapter from BOTH `wake_created` and `notify_consume_enter` (replay adapter lines 151-157). No new field needed.
- The contract is **closed**: the Elm Codec has exactly these tags. No new tag values. No schema additions to Authority.elm / Domain.elm / Codec.elm / Main.elm.
- The contract is **private diagnostic evidence**: no proto field, no gRPC field, no MCP protocol change, no public SDK API change, no wire API change, no myc schema change (per §16).
- `continuation_started` is OPTIONAL: only required under Option A. Under Option B the event is dropped and the join is recovered via replay order. §18 RED tests cover whichever option §21 selects.

## What this contract guarantees (when the §21 implementation lands)

1. **No manufactured identity**: every field comes from `DIRECT_EXISTING_ID`, `PROVEN_EQUIVALENT_EXISTING_ID`, or `NEW_ID_AT_EVENT_CREATION` (per §5 corrected classification). No `UNVERIFIED` classifications remain.
2. **No origin rewrites**: the `origin` field is whatever the production code computes (`explicit_user` / `pending_prompt_drain` / `deferred_continuation` / `background_terminal` / etc.); the adapter preserves it verbatim.
3. **Explicit prompt↔run join** (Option A): `continuation_started` carries BOTH `promptId` and `runId`, and the subsequent `run_turn_started` carries the SAME `runId`. The Elm replay can join by identity, not by event order. Under Option B the join is recovered by replay order and `continuation_started` is omitted from the contract.
4. **Factual terminal ownership**: `terminalKind` is computed at the terminal transition (`CommandJobManager.finalize`) by inspecting LAUNCH-time metadata (`job.ownerSessionId` set at job creation, plus the launch-time active-session binding). It is NOT derived from `origin`, NOT derived from the notify flag, NOT derived from chronology, and NOT recomputed from the current active-session pointer at finalize time.
5. **Submit distinctness**: each `submit_and_exit_seen` carries a unique `submitId` minted at the C9 capture seam; re-submits increment the counter, BCB holds do NOT.
6. **Completion distinctness**: each `task_completion_committed` carries a unique `completionId` minted at the C10 capture seam. Same `completionId` may reappear in `completion_presented` if the presentation uses the same durable row.
7. **taskId ≡ sessionId** (PROVEN): `task_started { taskId }` and every other `taskId` field carries `options.getTask()?.taskId`, which the production code explicitly assigns equal to `startResult.sessionId` at `sdk-provider-change-coordinator.ts:144-145`.

## What this contract does NOT guarantee

- Does NOT fix the cancel→reopen presentation bug (§22 prohibition; deferred to a successor ACT).
- Does NOT touch the Elm kernel's authority rules — only the capture contract that FEEDS the kernel.
- Does NOT touch the BCB barrier, PCCA, CPA, PCRS02/PCRS02C01 invariants — only the producer side that captures them.
- Does NOT introduce a new diagnostic mode — the existing `captureEnabled` dogfood gate is reused.

## §21 implementation contract (concrete)

| Action | File:Line | Change |
|---|---|---|
| Add 5 optional fields to CCARD record | `continuation-cardinality-authority.ts:ContinuationCardinalityAuthorityRecord` | Add `runId?`, `submitId?`, `completionId?`, `ownerId?`, `terminalKind?` |
| Thread `runId` into 3 capture hooks | `vscode-session-host.ts:531-576` (C7/C8/prelude) | Add `runId` to hook input, source from SDK host's runtime-snapshot listener |
| Add 1 `subscribeRuntimeEvents` listener (Option A) | `vscode-session-host.ts` (new seam) | When `run-started` snapshot arrives, emit `continuation_started` (if a prompt is held) AND `run_turn_started { runId }` |
| Add `task_started` capture | `sdk-session-event-coordinator.ts` first-session observation | One-shot latch: first C-stage fire for previously-unseen `activeSession.sessionId` emits `task_started { taskId }` |
| Thread `submitId` / `completionId` | `sdk-session-event-coordinator.ts:1209, 1406` | Coordinator-local counters `nextSubmitSeq` / `nextCompletionSeq`; increment at C9/C10 fires only |
| Thread `ownerId` / `terminalKind` | `command-job-manager.ts:2657` | Read `job.ownerSessionId` (stable from launch); compute `terminalKind` from LAUNCH metadata only |
| Add `completion_presented` (optional) | `sdk-session-event-coordinator.ts:1412` | Reuse most-recent `COMPLETION_COMMIT_EVENT_ID` if added |

No other production files change. No Elm kernel change. No BCB / PCCA / CPA / PCRS02 / PCRS02C01 / CCARD-1.x invariants change.
