# §4 Recon — Production seam map for completion-authority stages (TEMPORALLY HONEST — second pass)

This file documents the **actual current producer** for every completion-authority stage the Elm replay adapter consumes. It is the basis for §5 (identity-source rule), §6 (capture contract), and §21 (bounded implementation). The current version incorporates the reviewer's second-pass P0 corrections (temporal honesty): `runId` does not exist at the prelude boundary, `runId` does not exist at the caller-side C7 hook, `task_started` must fire at the real task-creation seam, and `terminalKind` is `UNAVAILABLE` in v1.

## Topology

There is exactly **one capture seam** for stages C1–C10 + `execute_turn_prelude_enter`:

```
apps/vscode/src/sdk/continuation-cardinality-authority.ts
  → captureContinuationCardinalityAuthorityRecord({ stage, origin, sessionId, taskId, jobId, promptId, correlationId })
  → module-level `captureEnabled` gate (DEFAULT_OFF; flipped by the dogfood diagnostic profile)
  → bounded FIFO ring (DEFAULT_BUFFER_SIZE = 512)
## Exact seam table (current producer per stage)

| Stage | Producer function | File:Line | Current fields supplied | Required new fact | Real source |
|---|---|---|---|---|---|
| `task_started` | **MISSING ENTIRELY** — no capture site | — | — | `taskId` | **CORRECTED (second pass)**: capture fires at `SdkController.initTask:3591`, immediately after `taskStart.initTask(...)` returns the `sessionId` (line 3586). The `taskId` field is the `sessionId` itself, provably equivalent to the eventual `task.taskId` via 5 explicit production assignments at every rebuild seam (`applyProviderConfigurationInstance:145`, `applyTypedProviderConfigurationInstance:273`, `performRestartActiveSessionForProviderChange:362`, `resumeSessionFromTask:322`, `performRebuildSessionForMode:318`). This is the EARLIEST reliable task-creation seam — earlier than the first C-stage fire inside `SdkSessionEventCoordinator` (which would only fire after the first prompt round-trip). |
| `run_turn_started` | **CHANGED (second pass)**: caller-side `onRunTurnStarted` hook REMOVED from Elm contract; replaced by 1 `subscribeRuntimeEvents` listener that fires on the FIRST `"run-started"` event from a new turn | `apps/vscode/src/sdk/vscode-session-host.ts:531-540` (caller-side, no longer adapted to Elm) + NEW listener at vscode-session-host.ts | `stage, origin, sessionId, (jobId?)` (caller-side, kept for non-Elm observability) | **`runId`** (ONLY in the new snapshot-listener-based capture) | **CORRECTED (second pass)**: `runId` is created inside `sdk/packages/agents/src/agent-runtime.ts:1500` (`this.state.runId = createUID("run")`) AFTER `LocalRuntimeHost.runTurn` → `executeTurn` (prelude + 5 awaits) → `executeAgentTurn` → `agent.run`. The caller-side C7 hook at `vscode-session-host.ts:531-540` fires BEFORE `runId` is minted (verified at `local-runtime-host.ts:1278-1284`); it cannot carry the genuine `runId` without manufacturing identity. The §21 implementation adds ONE `subscribeRuntimeEvents` listener that emits `run_turn_started { runId: snapshot.runId }` from the runtime snapshot at the ONLY boundary where `runId` genuinely exists. SINGLE AUTHORITY; the caller-side hook is removed from the Elm contract. |
| `execute_turn_prelude_enter` | `onExecuteTurnPreludeEnter` capture hook | `apps/vscode/src/sdk/vscode-session-host.ts:550-576` AND `sdk/packages/core/src/runtime/host/local-runtime-host.ts:2136` | `stage, origin, sessionId, (jobId?)` | **(no runId)** | **CORRECTED (second pass)**: prelude fires at `local-runtime-host.ts:2136` (the first executable line of `executeTurn`, before the first await). At that instant, `runId` does NOT exist (mint happens at `agent-runtime.ts:1500`, AFTER executeTurn's prelude awaits: `prepareTurnInput`, `ensureSessionPersisted`, `refreshActiveSessionGitMetadata`, `syncOAuthCredentials`, `markTurnRunning`, then `executeAgentTurn` → `agent.run` → `AgentRuntime.execute`). The CCARD buffer records the event WITHOUT `runId` for offline diagnostic value; the replay adapter returns `INSUFFICIENT_IDENTITY` and the Elm kernel never sees the event. The PRELUDE_STALL discriminator (C7 + prelude vs. C7 alone) is preserved in the CCARD buffer for offline analysis but is unobservable in Elm replay. Accepted trade. |
| `agent_turn_done` | **CHANGED (second pass)**: caller-side `onAgentTurnDone` hook REMOVED from Elm contract; replaced by the same `subscribeRuntimeEvents` listener that fires on the FIRST `"run-finished"` / `"run-failed"` event after the corresponding `"run-started"` | `apps/vscode/src/sdk/vscode-session-host.ts:541-549` (caller-side, no longer adapted to Elm) + NEW listener | `stage, origin, sessionId, (jobId?)` (caller-side, kept for non-Elm observability) | **`runId`** (ONLY in the new snapshot-listener-based capture) | Same `subscribeRuntimeEvents` listener as `run_turn_started`. The snapshot's `runId` is observed at runtime snapshot emission time (after `AgentRuntime.execute()` mints it). SINGLE AUTHORITY. |
| `pending_prompt_enqueued` | `onEnqueue` capture hook | `apps/vscode/src/sdk/vscode-session-host.ts:496-504` | `stage, origin, sessionId, promptId, (jobId?)` | none (✓ already complete) | `PendingPromptsController.enqueue` already produces a `promptId`. |
| `pending_prompt_dequeued` | `onBeforeDrain` capture hook | `apps/vscode/src/sdk/vscode-session-host.ts:505-516` | `stage, origin, sessionId, promptId, (jobId?)` | none (✓) | `PendingPromptService.shiftNext` (drain) already supplies `promptId`. |
| `continuation_scheduled` | `onBeforeDispatch` capture hook | `apps/vscode/src/sdk/vscode-session-host.ts:517-530` | `stage, origin, sessionId, promptId, (jobId?)` | none (✓) | Same `promptId` scope. The SDK host now HOLDS this `promptId` keyed by `sessionId` until the next `run-started` snapshot for the same session. |
| `continuation_started` | **MISSING ENTIRELY** — no capture site | — | — | `promptId, runId` | **CORRECTED (second pass)**: must fire from the SAME `subscribeRuntimeEvents` listener as `run_turn_started`, on the FIRST `"run-started"` event for a given session, ONLY IF a held promptId matches the snapshot's sessionId. If no held prompt matches, the event does NOT fire (Option B deleted by reviewer). The SDK host holds the `promptId` from the most recent `continuation_scheduled` capture keyed by `sessionId`. |
| `terminal_committed` | C1 capture in `CommandJobManager.finalize` | `apps/vscode/src/sdk/command-job-manager.ts:2657-2661` | `stage, origin, jobId` | **`ownerId`** (only) | **CORRECTED (second pass)**: `CommandJobManager` already has `job.ownerSessionId` (set at LAUNCH time at line 1884, stable through finalize). `ownerId` is reachable and is `DIRECT_EXISTING_ID`. **`terminalKind` is UNAVAILABLE in v1** — there is no launch-time immutable `launchOwnershipKind` field on `CommandJob` today. The CCARD capture includes `ownerId: job.ownerSessionId` but does NOT include `terminalKind`. The replay adapter returns `INSUFFICIENT_IDENTITY` for `terminal_committed` without `terminalKind` (adapter lines 139-145); the Elm kernel never sees `terminal_committed` in v1. |
| `terminal_observed` | C2 + C3 captures map to `terminal_observed` in the replay adapter | `apps/vscode/src/sdk/background-notify-coordinator.ts:1102, 1200` | `stage: "wake_created" / "notify_consume_enter", origin, jobId` | none (✓) | The replay adapter collapses both into `terminal_observed`. No new field needed. |
| `submit_and_exit_seen` | C9 capture in `SdkSessionEventCoordinator.handleSessionEvent` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1209-1214` | `stage, origin, sessionId, taskId` | **`submitId`** (SUBMIT_EVENT_ID — coordinator-local counter) | One distinct identity per submit attempt. Two submit attempts produce two different `submitId`s. Renamed to `SUBMIT_EVENT_ID` (coordinator-local `nextSubmitSeq` counter) — not a durable business ID; honest about its lifetime. |
| `task_completion_committed` | C10 capture in `SdkSessionEventCoordinator.handleSessionEvent` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1406-1411` | `stage, origin, sessionId, taskId` | **`completionId`** (COMPLETION_COMMIT_EVENT_ID — coordinator-local counter) | One distinct identity per ACTUAL completion commit (the C10 line is reached only when no completion-continuation enqueue happened — see the `if/else` at lines 1398-1413). Renamed to `COMPLETION_COMMIT_EVENT_ID` (coordinator-local `nextCompletionSeq` counter) — not a durable business ID; honest about its lifetime. |
| `completion_presented` | **MISSING ENTIRELY** — no capture site | — | — | `completionId` (if available) | The presentation path lives in `apps/vscode/src/...` UI / webview layers. Per the ACT §6, this is "optional but desirable". The simplest entry: tap the `setTurnPhase("completed", ...)` call site at line 1412 — the SAME completion commit. If presentation uses the same durable completion row, the same `completionId` carries through. **Default-on behavior: capture only if the same identity is reachable; otherwise skip.** |

## How each capture currently uses the `captureEnabled` seam

- `continuation-cardinality-authority.ts:107-113` — `captureEnabled` is the **single module-level boolean**. `captureContinuationCardinalityAuthorityRecord` short-circuits at line 207 (`if (!captureEnabled) return`). When OFF, every call site is a complete no-op: zero allocation, zero allocation of the record object, zero counter increments.
- Dogfood activation: the predecessor ACT pinned the seam to be flipped by the **dogfood diagnostic profile resolver** (`dogfood-diagnostic-profile.ts`). There is **no env var, no workspace toggle, no webview surface**; the production path is `captureEnabled = false` unless the diagnostic profile is active.
  → counter via stageCounters
```

The Elm replay adapter (`apps/vscode/src/sdk/completion-authority-elm-replay.ts`) **already defines the full stage→Msg mapping** including `task_started`, `run_turn_started`, `execute_turn_prelude_enter`, `agent_turn_done`, `terminal_committed`, `terminal_observed` (via `wake_created` + `notify_consume_enter`), `pending_prompt_enqueued/dequeued`, `continuation_scheduled`, `submit_and_exit_seen`, `task_completion_committed`, `completion_presented`. The mapping uses the closed tag set defined in `apps/vscode/elm/completion-authority/src/Codec.elm`.
## What the §3 halt + this recon confirms

The Elm replay adapter **already accepts the full §6 schema** (it has the cases; they classify correctly). The CCARD capture seam **already captures 9 of the 11 required stages**, including all the `pending_prompt_*` and `continuation_scheduled`/`wake_created`/`notify_consume_enter`/`terminal_committed`/`run_turn_started`/`execute_turn_prelude_enter`/`agent_turn_done`/`submit_and_exit_seen`/`task_completion_committed` events.

**What is genuinely missing in production:**

1. **Identity fields not currently captured** (schema-level gap):
   - `runId` on `run_turn_started` / `execute_turn_prelude_enter` / `agent_turn_done`
   - `submitId` on `submit_and_exit_seen`
   - `completionId` on `task_completion_committed` (and `completion_presented` if added)
   - `ownerId` + factual `terminalKind` on `terminal_committed`
2. **Capture sites not currently emitting** (recorder-level gap):
   - `task_started` lifecycle event (entire seam missing)
   - `continuation_started` event (entire seam missing)
   - `completion_presented` event (entire seam missing — optional per §6)

Both gaps can be closed by:

- adding the **new identity keys** (`runId`, `submitId`, `completionId`, `ownerId`, `terminalKind`) to the CCARD `ContinuationCardinalityAuthorityRecord` interface, with corresponding optional keys on `captureContinuationCardinalityAuthorityRecord`'s input, AND
- threading the new keys at the existing capture sites (no new site for the already-captured stages), AND
- adding 1 new capture site for `task_started` (lifecycle boundary), 1 new capture site for `continuation_started` (between `continuation_scheduled` and `run_turn_started`), and 1 optional capture site for `completion_presented` (if a real completionId exists at the presentation seam).

## Existing test infrastructure I can build on

- `apps/vscode/src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts` — direct unit tests of the CCARD recorder (existing 9-stage coverage).
- `apps/vscode/src/sdk/__tests__/completion-authority-elm-historical-replay01.test.ts` — HR-01..HR-08 + 8 adapter self-invariants (18/18 PASS as of ENTRY_HEAD b15a91f40).
- `apps/vscode/src/sdk/__tests__/post-continuation-run-stall02-correction01.pcrs02c01.c24-c-bridge.test.ts` — real-host integration test that exercises C7/C8/execute_turn_prelude_enter through the `LocalRuntimeHost.runTurn` chain. This is the **best existing template** for TCE-01 / TCE-07 / TCE-08 / TCE-09 / TCE-10 / TCE-11.
- `apps/vscode/src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01-e2e-real-host.c24-c-bridge.test.ts` — e2e real-host integration test for C4/C5/C6. This is the **best existing template** for TCE-02 / TCE-10.
- `apps/vscode/src/sdk/__tests__/post-consumption-completion-authority01.pcca01.test.ts` — covers submit_and_exit_seen + task_completion_committed via real BCB barrier. This is the **best existing template** for TCE-03 / TCE-04 / TCE-12.
- `apps/vscode/src/sdk/__tests__/background-job-liveness-authority.bclas06.test.ts` — covers terminal lifecycle + ownership. This is the **best existing template** for TCE-05 / TCE-09 / TCE-11.

## What's NOT touched

- Authority.elm / Domain.elm / Codec.elm / Main.elm — FROZEN per ACT §16 (no Elm semantic changes).
- The replay adapter (`completion-authority-elm-replay.ts`) — FROZEN (it already accepts the schema).
- BCB barrier, PCCA, CPA, PCRS02/PCRS02C01, CCARD invariants — FROZEN (the producer side is what changes).
- The dogfood profile resolver — already enables CCARD; no new wiring needed.
- MCP / myc / React / webview — untouched.