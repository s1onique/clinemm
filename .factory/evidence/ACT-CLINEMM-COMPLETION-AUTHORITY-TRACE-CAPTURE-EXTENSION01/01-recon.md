# §4 Recon — Production seam map for completion-authority stages

This file documents the **actual current producer** for every completion-authority stage the Elm replay adapter consumes. It is the basis for §5 (identity-source rule), §6 (capture contract), and §21 (bounded implementation).

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
| `task_started` | **MISSING ENTIRELY** — no capture site | — | — | `taskId` | `this.options.getTask?.()?.taskId` is reachable at `SdkSessionEventCoordinator.handleSessionEvent` (used at C9 line 1213 and C10 line 1410). `taskId ≡ sessionId` is PROVEN by the explicit assignment `task.taskId = startResult.sessionId` at `sdk-provider-change-coordinator.ts:144-145`. The capture site is a one-shot latch: first C-stage fire for a previously-unseen `activeSession.sessionId`. |
| `run_turn_started` | `onRunTurnStarted` capture hook → `captureContinuationCardinalityAuthorityRecord` | `apps/vscode/src/sdk/vscode-session-host.ts:531-540` | `stage, origin, sessionId, (jobId?)` | **`runId`** | `runId` is created inside `sdk/packages/agents/src/agent-runtime.ts:1205` (`this.state.runId = createUID("run")`) and surfaced via the runtime snapshot (`agent-runtime.ts:1045`) which propagates through `LocalRuntimeHost.subscribeRuntimeEvents`. The capture hook does NOT currently accept a `runId`; the wiring adds ONE `subscribeRuntimeEvents` listener that emits `run_turn_started { runId }` from the runtime snapshot. |
| `execute_turn_prelude_enter` | `onExecuteTurnPreludeEnter` capture hook | `apps/vscode/src/sdk/vscode-session-host.ts:550-576` | `stage, origin, sessionId, (jobId?)` | **`runId`** | Same as above — produced at the same run-turn scope; the `input` payload needs `runId`. |
| `agent_turn_done` | `onAgentTurnDone` capture hook | `apps/vscode/src/sdk/vscode-session-host.ts:541-549` | `stage, origin, sessionId, (jobId?)` | **`runId`** | Same thread. |
| `pending_prompt_enqueued` | `onEnqueue` capture hook | `apps/vscode/src/sdk/vscode-session-host.ts:496-504` | `stage, origin, sessionId, promptId, (jobId?)` | none (✓ already complete) | `PendingPromptsController.enqueue` already produces a `promptId`. |
| `pending_prompt_dequeued` | `onBeforeDrain` capture hook | `apps/vscode/src/sdk/vscode-session-host.ts:505-516` | `stage, origin, sessionId, promptId, (jobId?)` | none (✓) | `PendingPromptService.shiftNext` (drain) already supplies `promptId`. |
| `continuation_scheduled` | `onBeforeDispatch` capture hook | `apps/vscode/src/sdk/vscode-session-host.ts:517-530` | `stage, origin, sessionId, promptId, (jobId?)` | none (✓) | Same `promptId` scope. |
| `continuation_started` | **MISSING ENTIRELY** — no capture site | — | — | `promptId, runId` | Must fire AFTER `continuation_scheduled` AND when BOTH the held `promptId` and the runtime `runId` are observable. The cleanest seam (Option A): the SAME `subscribeRuntimeEvents` listener that emits `run_turn_started { runId }` also emits `continuation_started { promptId: <held by host from C6>, runId: <from snapshot> }`. Option B fallback: drop the event entirely and recover the join via replay order. See §5 §6 for the final design choice. |
| `terminal_committed` | C1 capture in `CommandJobManager.finalize` | `apps/vscode/src/sdk/command-job-manager.ts:2657-2661` | `stage, origin, jobId` | **`ownerId, terminalKind`** | `CommandJobManager` already has `job.ownerSessionId` (set at LAUNCH time, stable through finalize). `terminalKind` is a factual enum computed at finalize from LAUNCH metadata (NOT from `activeSession` pointer at finalize time). Both are reachable in `CommandJobManager.finalize` context. |
| `terminal_observed` | C2 + C3 captures map to `terminal_observed` in the replay adapter | `apps/vscode/src/sdk/background-notify-coordinator.ts:1102, 1200` | `stage: "wake_created" / "notify_consume_enter", origin, jobId` | none (✓) | The replay adapter collapses both into `terminal_observed`. No new field needed. |
| `submit_and_exit_seen` | C9 capture in `SdkSessionEventCoordinator.handleSessionEvent` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1209-1214` | `stage, origin, sessionId, taskId` | **`submitId`** | One distinct identity per submit attempt. Two submit attempts must produce two different `submitId`s. The most natural place: at the very entry of `handleSessionEvent` for the `agent_event` whose `type === "done"` AND `wasAttemptCompletionSeen && wasTerminalResponseCommittedThisTurn` — that's a single turn-end event, so the per-turn identity already exists (e.g. a `submitAttemptSeq` on the coordinator). |
| `task_completion_committed` | C10 capture in `SdkSessionEventCoordinator.handleSessionEvent` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1406-1411` | `stage, origin, sessionId, taskId` | **`completionId`** | One distinct identity per ACTUAL completion commit (the C10 line is reached only when no completion-continuation enqueue happened — see the `if/else` at lines 1398-1413). The natural identity: derive from `activeSession.sessionId + getTask?.()?.taskId + completionEpoch` where `completionEpoch` is the coordinator's local counter incremented every time the BCB barrier releases a completion commit. |
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