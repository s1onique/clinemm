# ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01 — Recon (bounded correction ROUND 1)

ENTRY_HEAD=4b1f3d6914e78a231c6b292ee8f5fcda904239f4

## Mission

Build a deterministic production-faithful pathological corpus for ClineMM continuation semantics so that premature "Your turn", dropped autonomous continuation, duplicate continuation, and completion-vs-pending-prompt races become executable behavioral contracts rather than screenshot-driven debugging.

## Bounded correction ROUND 1 — what this recon says about the bridge seam

The ACT has TWO test files:

1. `apps/vscode/src/sdk/__tests__/continuation-pathological-corpus01.swcm04.test.ts` (BASE; runs under `vitest.config.ts`):
   - 16 tests covering P1..P12 + A/B/E/H.
   - Drives `SdkSessionEventCoordinator + BackgroundNotifyCoordinator + CommandJobManager` composition.
   - Uses a SIMULATED `TestPendingPromptQueue` for the queue mirror.
   - Proves the COMPLETION-BARRIER and NOTIFY-AUTHORITY correctness of the production coordinator seam.

2. `apps/vscode/src/sdk/__tests__/continuation-pathological-corpus01.swcm04.c24-c-bridge.test.ts` (BRIDGE; runs under `vitest.config.c2-4-c-bridge.ts`):
   - 5 tests covering P3, P5, P6, A, B.
   - Drives REAL `LocalRuntimeHost + PendingPromptService + FileSessionService`.
   - No simulated queue mirror. All queue state is read via `host.pendingPrompts.list({ sessionId })` and the production `pendingPromptCapture` hooks.
   - Proves the QUEUE-MECHANICS correctness: enqueue order, steer prepending, drain shift order, delete-before-drain semantics, duplicate-jobId distinctness.

The bridge test was added in response to `HALT_PRODUCTION_SEAM_NOT_EXERCISED`. Per the halt's evidence:

```
COMPLETION_BARRIER_CORPUS    = PASS (base file)
NOTIFY_AUTHORITY_CASES       = PASS (base file)
REAL_PENDING_PROMPT_SERVICE  = EXERCISED (bridge file)
REAL_DRAIN                   = EXERCISED (bridge file)
REAL_RUNTURN_REENTRY         = EXERCISED (bridge file)
STEER_ORDERING               = EXERCISED (bridge file; real PendingPromptService enqueue + drain)
DUPLICATE_CONTINUATION_PROOF = EXERCISED (bridge file; C5/C6 capture hook observation)
```

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
  - FIFO `delivery:"queue"` → push to tail
  - Priority `delivery:"steer"` → unshift to head (line 241-242: "if delivery === 'steer' OR existing.delivery === 'steer', prepend via unshift (steer preempts queue head)")
- `shiftNext(state)` (line 279) — atomic FIFO dequeue
- `consumeSteer(state)` (line 269-276) — atomic priority dequeue
- `delete(input)` (line 318) — explicit delete by promptId
- State persisted in session store

### 2. The C10 framework barrier (PRESERVED, do NOT test)

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (1548 lines):
- L432: `setTurnPhase("awaiting_followup", ...)` — non-terminal idle.
- L546 / L990: `setTurnPhase("completed", ...)` — terminal commit. **This is the canonical "Your turn" handoff point in production.** When this fires, the UI flips to awaiting followup.
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

### 6. The continuation ordering seam (BRIDGE-FILE EXERCISED)

After `executeTurn` returns and `finishReason !== "error"`:
- `queueMicrotask(() => this.pendingPromptsController.drain(input.sessionId))` (local-runtime-host.ts ~line 1275).
- `drain(sessionId)` (`pending-prompt-service.ts:423`): refuses to start if `session.aborting || session.drainingPendingPrompts`; otherwise shifts next, dispatches via `deps.send(...)`, and (recursively if more pending) `await this.drain(sessionId)` after the dispatched turn finishes.

## Production-seam exercise map (after bounded correction)

| Scenario | Production seam | Test file |
|---|---|---|
| P1 — simple user turn | SdkSessionEventCoordinator.setTurnPhase + barrier predicate | base |
| P2 — notify-owned J | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal | base |
| P3 — pending prompt at turn end | LocalRuntimeHost.runTurn + PendingPromptsController.enqueue + drain + runTurn re-entry | **BRIDGE** |
| P4 — queue-empty control | SdkSessionEventCoordinator.setTurnPhase + barrier predicate | base |
| P5 — steer priority | LocalRuntimeHost.runTurn + PendingPromptsController.enqueue (steer unshift) + drain (consumeSteer/shiftNext) | **BRIDGE** |
| P6 — wake + ordinary queue prompt co-exist | LocalRuntimeHost.runTurn + PendingPromptsController.enqueue + drain | **BRIDGE** |
| P7 — wake drained BEFORE submit_and_exit | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal | base |
| P8 — lost wake | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal (rejected ack) | base |
| P9 — two notify-owned J | SdkSessionEventCoordinator + BackgroundNotifyCoordinator dual-delivery arbitration | base |
| P10 — fast terminal race | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal | base |
| P11 — ask-user-question | SdkSessionEventCoordinator (no submit_and_exit path) | base |
| P12 — plan->act synthetic continuation | NOT_APPLICABLE in current source | base |
| A — duplicate jobIds | LocalRuntimeHost.runTurn + PendingPromptsController.enqueue | **BRIDGE** |
| B — stale prompt deleted | LocalRuntimeHost.runTurn + PendingPromptsController.delete + drain | **BRIDGE** |
| E — two jobIds, only one terminal | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal | base |
| H — sessionId mismatch | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal (owner-mismatch short-circuit) | base |

## Bridge test mechanics

The bridge test (`continuation-pathological-corpus01.swcm04.c24-c-bridge.test.ts`):

1. Constructs a `LocalRuntimeHost` via the `@cline-internal/core/runtime/host/local-runtime-host` alias (bypasses the `@cline/core` bundle minifier name-collision).
2. Wires `FileSessionService` for on-disk session storage.
3. Stubs the agent with `run`/`continue`/`canStartRun`/`abort`/`subscribeEvents`/`getMessages`/`shutdown`/`getAgentId`/`getConversationId`. The agent's `run`/`continue` yield once via `setImmediate` to allow the host's drain microtask to settle, then return a synthetic `AgentResult` with `finishReason: "completed"`.
4. **Gate mechanism**: `canStartRun()` returns `ready && !running` where `ready` starts false. Tests leave the gate CLOSED while enqueueing prompts (so `scheduleDrain` is a no-op because `canStartRun` is false at enqueue time), then call `setReady(true)` to release the gate. A subsequent `runTurn({})` with no delivery goes immediate (because canStartRun is now true), executes the agent, then `queueMicrotask(drain)` fires — that drain shifts the queued prompt(s) via the REAL `PendingPromptsController.drain`.
5. **Capture**: `pendingPromptCapture` hooks (`onEnqueue`, `onBeforeDrain`, `onBeforeDispatch`, `onRunTurnStarted`, `onAgentTurnDone`) are wired to a `makeCardinalityCapture` recorder. These hooks fire from INSIDE the real `PendingPromptsController` and `LocalRuntimeHost.runTurn` — NOT from any harness-side mirror.
6. **Assertions**: `expect(capture.filteredBySession(sessionId).filter(r => r.stage === "pending_prompt_dequeued").length).toBe(2)` reads directly from the real captures. There is no harness-side queue object.

## Behavior NOT modified by the bounded correction

- The C10 framework barrier (PROVEN in ACT-CLINEMM-C10-FILTER-ABLATION01) is untouched.
- The C10 message-layer filter (PROVEN in ACT-CLINEMM-C10-FILTER-ABLATION01) is untouched.
- `BackgroundNotifyCoordinator.consumeTerminal` / `dispatchAndTrackWake` (PROVEN in BNCA-REPAIR01 + LIVE-QUALIFICATION01) is untouched.
- `PendingPromptService` (in `sdk/packages/core`) is untouched.
- `LocalRuntimeHost` (in `sdk/packages/core`) is untouched.
- No production code is modified by this ACT.

## Verdict

PASS_CONTINUATION_PATHOLOGICAL_CORPUS.
