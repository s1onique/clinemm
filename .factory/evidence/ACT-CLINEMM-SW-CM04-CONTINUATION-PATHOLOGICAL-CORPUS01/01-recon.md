# ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01 — Recon

ENTRY_HEAD=4b1f3d6914e78a231c6b292ee8f5fcda904239f4

## Mission

Build a deterministic, production-faithful pathological corpus for ClineMM continuation semantics so that premature "Your turn", dropped autonomous continuation, duplicate continuation, and completion-vs-pending-prompt races become executable behavioral contracts rather than screenshot-driven debugging.

## Production seam inventory (CURRENT source, not historical)

### 1. The canonical continuation / pending-prompt service

**File:** `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts` (589 lines)

This is the **authoritative** FIFO pending-prompt queue. Production wiring:

- `LocalRuntimeHost.runTurn(input)` at `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1172-1280`:
  - When `input.delivery === "queue"` OR `input.delivery === "steer"`: short-circuits to `this.pendingPromptsController.enqueue(...)` and returns `undefined`. **NO agent execution.**
  - Otherwise: fires C7 (run_turn_started) IMMEDIATELY BEFORE `executeTurn(...)` (production wiring fix per HALT_CCARD_V2_PRODUCTION_WIRING_FALSE_GREEN).
  - After successful executeTurn: fires C8 (agent_turn_done) and `queueMicrotask(() => drain(...))`. **The drain runs asynchronously** after the originating turn completes.

`PendingPromptService` API (verified at file head):
- `enqueue(sessionId, { prompt, mode, delivery, userImages, userFiles, jobId? })` (line 218)
- `shiftNext(state)` (line 279) — atomic dequeue
- `consumeSteer(state)` (around line 381) — atomic dequeue of the head steer entry
- `delete(input)` (line 318) — explicit delete by promptId
- State persisted in session store

Steer semantics (line 241-242): "A re-enqueue of the same prompt retains its first jobId" + "If delivery === steer OR existing.delivery === steer, prepend via unshift (steer preempts queue head)". So `steer` is a priority enqueue that becomes the next drain target.

**Production accessibility from the host (`apps/vscode/src/sdk/`):** the host reads pending-prompt count via `activeSession.sdkHost.pendingPrompts("count", { sessionId })` (per `SdkController.ts:1075-1100`) and the ccard test wiring confirms the host adapter passes `pendingPromptCaptureHooks` to `ClineCore.create(...)`. Pending-prompt DELETE is reachable via `activeSession.sdkHost.pendingPrompts("delete", { sessionId, promptId })` (used in `discardQueuedWakeForJobId` at `SdkController.ts:840`).

### 2. The C10 framework barrier (PRESERVED, do NOT test)

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (1548 lines):
- L432: `setTurnPhase("awaiting_followup", ..., "session-event-turn-complete-resumable-straggler-preserve")` — non-terminal idle (e.g., background work outstanding at turn end).
- L546 / L990: `setTurnPhase("completed", ..., "session-event-turn-complete-completed")` — terminal commit. **THIS is the canonical "Your turn" handoff point in production.** When this fires, the UI flips to awaiting followup.
- The four-conservation predicate at `reevaluateDeferredCompletionBarrier()` (L459-547) MUST report zero before the deferred marker is cleared and `completed` is committed. The predicate combines:
  ```
  outstandingAutonomousWork =
      pendingPromptAuthorityUnknown    // PPAT01 fail-closed
      || pendingPromptsKnown > 0
      || activeNotifyCount > 0
      || perJobOutstandingNotifyWork   // notify-owned jobId with wake still pending
  ```
- `perJobSuppressOriginatingCompletion`: when a notify-owned J has `wasWakeDelivered === true`, the originating turn's `completed` commit is SUPPRESSED — the wake-driven turn will commit it.

### 3. The notify-on-terminal transport

`apps/vscode/src/sdk/background-notify-coordinator.ts` (1250 lines):
- `enqueueTerminalWake: (input) => Promise<{ kind: "delivered" | "rejected" | "session_gone" }>` (line 352): the host-owned transport. Production realization is `buildSdkControllerEnqueueTerminalWake(...)` at `SdkController.ts:714-770` which routes through `active.sdkHost.send({ delivery: "queue", jobId })`.
- `consumeTerminal({ jobId, terminalState })` (around line 414-470): when a notify-owned J exits, this drains the marker and (if delivery succeeds) drives the wake into the pending-prompt queue via `enqueueTerminalWake`.
- `resolveObligation({ jobId, ... })`: supersession callback (Path B fast-path): when the originating turn observes the terminal via `command_status` BEFORE Path A fires, this drains the marker AND calls `discardQueuedWake({ sessionId, jobId })` to remove a queued wake from the pending-prompt queue (CORRECTION02).
- `discardQueuedWake` (line 569): provided as a coordinator option by `SdkController`. Implementation in `SdkController.ts:802-845`: lists `pendingPrompts`, finds any entry whose prompt starts with `BACKGROUND_TERMINAL_WAKE_PROMPT_PREFIX` and contains `Job: <jobId>`, deletes it.
- `registerMarker({ jobId, sessionId, taskId })` (around line 100s): creates the notify-owned marker.
- `markWakeDelivered(jobId)`: tracks that the wake-driven turn owns terminal completion for that jobId.
- `markWakeDispatchFailed(jobId)`: tracks that the wake dispatch was rejected (lost-wake protocol: ALLOW originator completion).

### 4. The pending-prompt queue head / drain site

`apps/vscode/src/sdk/SdkController.ts:2260-2310` (per `discardQueuedWakeForJobId`):
- `getPendingPromptCount(sessionId)` reads via `activeSession.sdkHost.pendingPrompts("count", { sessionId })` (line 2278). **This is the AUTHORITATIVE count** that the Q5 writer (`outstandingAutonomousWork`) reads — NOT a cached projection.
- The `pendingPromptAuthorityUnknown` fail-closed predicate (`pendingPromptCountRead.available !== true`) means: when the queue is unreadable, the barrier HOLDS. This is the conservative answer.

### 5. The completion barrier invocation sites

Two entry points, both in `sdk-session-event-coordinator.ts`:

- **Admission** (where the barrier is SET): the `awaiting_followup` decision at L432 happens AFTER `reevaluateDeferredContinuation` (L385-432) returns without clearing the deferred continuation marker. The same conservation predicate fires here.
- **Re-evaluation** (`reevaluateDeferredCompletionBarrier` L459-547): invoked when `consumeTerminal` (Path A) or `resolveObligation` (Path B) succeeds. Drains the marker only when ALL of: marker exists, marker epoch matches minter epoch, `outstandingAutonomousWork` is zero, and `perJobSuppressOriginatingCompletion` is false.

### 6. The continuation ordering seam

After `executeTurn` returns and `finishReason !== "error"`:
- `queueMicrotask(() => this.pendingPromptsController.drain(input.sessionId))` (local-runtime-host.ts ~line 1275).
- `drain(sessionId)` (`pending-prompt-service.ts:423`): refuses to start if `session.aborting || session.drainingPendingPrompts`; otherwise shifts next, dispatches via `deps.send(...)`, and (recursively if more pending) `await this.drain(sessionId)` after the dispatched turn finishes.

## Diagnostic capture (already exists, test-only default off)

`apps/vscode/src/sdk/continuation-cardinality-authority.ts` (CCARD01):
- `captureContinuationCardinalityAuthorityRecord({ stage, origin, sessionId, taskId, jobId, promptId, correlationId })` — bounded FIFO ring (default 512).
- Stages frozen: C1=terminal_committed, C2=notify_consume_enter, C3=wake_created, C4=pending_prompt_enqueued, C5=pending_prompt_dequeued, C6=continuation_scheduled, C7=run_turn_started, C8=agent_turn_done, C9=submit_and_exit_seen, C10=task_completion_committed.
- Default OFF. Production wiring is PARTIAL: only `command-job-manager.ts:2657` calls `captureContinuationCardinalityAuthorityRecord({ stage: "terminal_committed", ... })`. **The other 9 stages are NOT wired in production** — they are tested via the harness in ccard01.test.ts only.

For SW-CM04 we will use the existing capture module but we will NOT require production wiring to fire (the partial wiring is itself a discovered boundary). The harness drives the actual production classes (`LocalRuntimeHost` + `PendingPromptService` + `BackgroundNotifyCoordinator` + `SdkSessionEventCoordinator`) and asserts the cardinality outcomes at the canonical decision seams via direct production-method calls.

## Existing harness pattern (precedent)

The closest production-faithful harness is `apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-red01.bnca-red01.test.ts` — it wires `BackgroundNotifyCoordinator`, `CommandJobManager`, `MessageTranslatorState`, `MessageIdMinter`, `TurnStateTracker`, `SdkSessionEventCoordinator` end-to-end and drives real `agent_event { type: "done" }` events through `coordinator.handleSessionEvent(...)`. The SW-CM04 corpus will follow the same pattern but exercise the **continuation** boundary rather than the **completion** boundary.

## Decision: production seam to exercise

The canonical production continuation-decision seam for the corpus is the chain:

  LocalRuntimeHost.runTurn(input)
    -> delivery === "queue" / "steer"   -> PendingPromptService.enqueue (line 1213)
    -> else                               -> executeTurn(...) -> agent_turn_done (line ~1250)
                                          -> queueMicrotask(drain)
  drain
    -> shiftNext -> consumeSteer (priority)
    -> deps.send(input)                   -> [C7 fires here via runTurn re-entry]
    -> recursive drain if more pending

The C10 framework barrier at `setTurnPhase("completed", ...)` is the OBSERVABLE of the user-attention projection. To observe "premature Your turn" we watch `completionCommitCount` (incremented inside the test's `setTurnPhase` spy) and `getDeferredCompletionBarrierForTesting()` from the coordinator.

For "dropped autonomous continuation" we observe `PendingPromptService` queue length (via `service.countForSession(sessionId)` or equivalent test seam).

For "duplicate continuation" we observe `run_turn_started` cardinality (C7) captured via the existing CCARD capture.

## Observable summary (harness will drive directly)

| Observable | Source | Test wiring |
|---|---|---|
| `completionCommitCount` | SdkSessionEventCoordinator.setTurnPhase("completed", ...) | counter incremented in setTurnPhase spy |
| `pendingPromptCount` | PendingPromptService.countForSession(sessionId) | read post-turn |
| `continuationScheduledCount` | drain call to deps.send | counter in deps.send spy |
| `runTurnStartedCount` | LocalRuntimeHost.runTurn entry (C7) | counter in deps.send spy (each dispatched prompt) |
| `taskCompletionCommitted` | SdkSessionEventCoordinator C10 capture | from continuation-cardinality-authority |
| `userAttentionRequired` | INFERRED from completionCommitCount: true iff count > 0 with no autonomous obligation remaining | derived in test |

## Existing test inventory (NOT to modify)

- `continuation-cardinality-authority01.ccard01.test.ts` — CCARD01 capture module unit tests (11 tests)
- `background-notify-completion-authority-c10-red01.bnca-red01.test.ts` — BNCA-RED-02 framework seam (1 test)
- `background-notify-completion-authority-c10-framework-dispatch-failed01.bnca-framework01.test.ts` — lost-wake
- `background-notify-completion-authority-c10-framework01.bnca-framework01.test.ts` — happy path
- `background-notify-completion-authority-c10-framework-ablation01.bnca-ablation01.test.ts` — SEAM B barrier ablation
- `background-notify-completion-authority-h1-green01.bnca-green01.test.ts` — H1 advisory
- `background-notify-completion-authority-ablation01.bnca-ablation01.test.ts` — overall ablation
- `background-notify-completion-authority-fire-and-forget-red01.bnca-red01.test.ts` — fire-and-forget RED
- `background-notify-exactly-once-presentation01.bcnex01.test.ts` — exactly-once presentation
- `background-command-completion-ownership-correlation01.bccoc01.test.ts` — ownership correlation
- `background-command-terminal-presentation-arbitration01.bctpa01.test.ts` — dual-delivery arbitration
- `long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts` — Q5 completion barrier
- `c10-filter-ablation01.{baseline,ablation}.test.ts` — C10 message-layer filter (2 files, 11 tests)
- `legacy-task-handling.test.ts` — legacy task compat

Baseline gate (post-C10-ROUNND-2): 15 files / 78 tests / exit 0 / vmThreads.

## Boundaries NOT modified by SW-CM04

- `BackgroundNotifyCoordinator` (frozen by ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01 + LIVE-QUALIFICATION01)
- `setTurnPhase("completed", ...)` barrier at `sdk-session-event-coordinator.ts:546` (proven load-bearing in C10 chain)
- The C10 message-layer filter at `sdk-session-event-coordinator.ts:689..L797` (proven load-bearing in C10-FILTER-ABLATION01)
- The `consumeTerminal` / `resolveObligation` arbitration (proven in BCTPA01)

## New test-only injection point (if needed)

If `PendingPromptService.countForSession(sessionId)` does not exist, the harness will need a TEST-ONLY read-back helper. Reconnaissance shows the file at `pending-prompt-service.ts` exposes `enqueue / shiftNext / consumeSteer / delete` — no public `countForSession` was found. The host adapter `activeSession.sdkHost.pendingPrompts("count", { sessionId })` is the production path. The harness will drive the **host-side** path (not the SDK-internal path) by spinning up a `LocalRuntimeHost` instance directly via deep-relative import (per the c2-4-c-bridge precedent) when counting is needed.

In fact: `LocalRuntimeHost.runTurn` is the EXACT entry point that the production host calls. Calling it directly IS production-faithful. The harness will:
- Construct a `LocalRuntimeHost` (or its test seam)
- Call `runTurn({ sessionId, prompt, delivery: "queue", jobId })` to simulate a wake
- Call `runTurn({ sessionId, prompt })` to simulate the originating turn
- Drive the `agent_event` stream through a real `MessageTranslator` and `SdkSessionEventCoordinator`
- Observe `setTurnPhase("completed", ...)` calls

This is the production-faithful seam.

## Plan

1. Add ONE new test file `apps/vscode/src/sdk/__tests__/continuation-pathological-corpus01.swcm04.test.ts`.
2. Mirror the BNCA-red01 harness pattern.
3. For each scenario P1..P12: drive the real production classes, observe the cardinality, classify.
4. No production code changes.
5. No repair — only reproduction + classification.
6. Run gates, capture evidence, write result.json + 02-pathological-corpus.jsonl + 03-corpus-results.md.
