# ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 — Recon

**Disposition**: recon-only (RED pending).

**Upstream defect**: `cline/cline#12975` — "Cline: Resume re-executes previously completed
commands instead of continuing with the queued task." On VS Code/JetBrains users can queue
a second request, Stop while that queued work starts, Resume, and see the already-completed
first command sequence replayed.

**Refined upstream chronology** (per Factory reviewer, post-Q1 refinement): Stop happens
**after** the queued P2 has begun processing, not after P2 is merely queued.

```
P1 submitted
  → C1, C2 complete durably (tool results in transcript)
  → P2 queued
  → P2 begins processing (drain fires; P2 is now the active turn)
  → user presses Stop
  → user presses Resume
  → C1, C2 replay  ← the suspected upstream defect
```

Do NOT assume this fork reproduces it. Recon first.

---

## §0 Trust baseline

```
REPOSITORY_ROOT = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
BRANCH          = act/task-interaction-ownership-projection01-live-capture
ENTRY_HEAD      = 6e956bc8724600ded7de6e52653753b24a7ec516
ENTRY_TREE      = clean (git status --porcelain=v1 = "")
protected stashes = stash@{0} (ACT-ELM-02C2 forensic),
                    stash@{1} (CAT-01 forensic)
DOGFOOD_BUILD   = 4.1.10-6e956bc87 (operator-installed Codium build, UI-verified)
NO PUSH / NO FORCE PUSH / NO PUBLISHED-COMMIT AMEND
```

## §2 Inventory — actual production seams

Names discovered by reading the production code; **do not trust prior names**.

### pending-prompt enqueue owner

| Owner | Site | Behavior |
|---|---|---|
| `PendingPromptService.enqueue` | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:137` | Pure-data: appends or dedupes on a `PendingPromptQueueState` |
| `PendingPromptsController.enqueue` | `pending-prompt-service.ts:238` | Thin wrapper; calls `service.enqueue`, emits `pending_prompts`, schedules drain |
| `LocalRuntimeHost.runTurn` (delivery==="queue"/"steer") | `local-runtime-host.ts:1011-1019` | Decides queueing in the host: if `interactive && !canStartRun()`, send to controller.enqueue; otherwise execute immediately |
| `AgentEventBridge.enqueuePendingPrompt` | `local/agent-event-bridge.ts:331-332` | Re-entrant: bridges incoming event back into the queue controller |
| `ClineCore.pendingPrompts` (public API) | `local-runtime-host.ts:288-293` | Exposes `list`/`update`/`delete` for the hub daemon |

**Critical observation:** the queue state lives on `ActiveSession.pendingPrompts`
(`types/session.ts:35`) — **memory only**.

### pending-prompt dequeue / drain owner

| Owner | Site | Behavior |
|---|---|---|
| `PendingPromptsController.scheduleDrain` | `pending-prompt-service.ts:292` | Schedules a microtask drain. Early-returns if queue empty, `aborting`, `drainingPendingPrompts`, or `!canStartRun()` |
| `PendingPromptsController.drain` | `pending-prompt-service.ts:306` | Sets `drainingPendingPrompts=true`; `service.shiftNext()`; `deps.send()` (i.e. `LocalRuntimeHost.runTurn`); on non-error finish, re-microtask for next entry |
| `LocalRuntimeHost.runTurn` (post-completion drain) | `local-runtime-host.ts:1040-1044` | `queueMicrotask(() => controller.drain(sessionId))` after a non-error finish |
| `PendingPromptService.consumeSteer` | `pending-prompt-service.ts:177` | Removes steer-delivered entry from head |

### Stop / cancel owner

| Owner | Site | Behavior |
|---|---|---|
| `LocalRuntimeHost.abort(sessionId, reason)` | `local-runtime-host.ts:1077-1097` | Sets `session.aborting=true`. **Conditionally** discards queue iff `drainingPendingPrompts`. Calls `session.agent.abort(reason)` |
| `LocalRuntimeHost.stopSession` | `local-runtime-host.ts:1099+` | Different seam: ends the interactive session if terminal, otherwise releases the runtime |
| `SdkTaskControlCoordinator.cancelTask` | `apps/vscode/src/sdk/sdk-task-control-coordinator.ts:65` | Host-side path: `raiseCancelFence`, then `sdkHost.abort(sessionId)`. Then writes a synthetic `resume_task` ask + status event |
| `PendingPromptsController.discardQueue` | `pending-prompt-service.ts:276-280` | Drops the entire queue. **Only** invoked from `abort` when `drainingPendingPrompts=true` |

**Critical observation:** the in-memory queue's survival through Stop is conditional on
`drainingPendingPrompts`. If the queued prompt is in flight (draining), Stop wipes the
remaining queue (per the comment at line 1087-1091: "user is cancelling the queued work
itself"). If the queued prompt is NOT yet draining, Stop leaves the queue intact.

### Resume owner

| Owner | Site | Behavior |
|---|---|---|
| `LocalRuntimeHost.restoreSession` | `local-runtime-host.ts:962-993` | Delegates to `SessionVersioningService.restoreCheckpoint(...)` |
| `SessionVersioningService.restoreCheckpoint` | `session/session-versioning-service.ts:134` | Loads source messages via `readMessages(sourceSessionId)`, plans the checkpoint, calls `startSession(startInput)` with `initialMessages` |

**Critical observation:** `restoreSession` produces a **brand-new `ActiveSession`** at
`local-runtime-host.ts:821-849` with **`pendingPrompts: []` (line 844)**. The queue is
NOT rehydrated from any persisted location, because **no persistence boundary includes
the queue** (`PersistedSessionUpdateInput` at `types/session.ts:89-103` does not carry
`pendingPrompts`).

### session persistence / restore owner

| Owner | Site | Behavior |
|---|---|---|
| `PersistedSessionUpdateInput` | `types/session.ts:89-103` | Fields: `status`, `endedAt`, `exitCode`, `prompt`, `metadata`, `title`, `parentSessionId`, `parentAgentId`, `agentId`, `conversationId`, `setRunning`. **`pendingPrompts` is NOT one of them** |
| `LocalRuntimeHost.executeTurn` (`ensureSessionPersisted`) | `local-runtime-host.ts:1771+` | Persists the session row before each turn |
| `LocalRuntimeHost.completeAbortedInteractiveTurn` | `local-runtime-host.ts:1853+` | After abort, flushes the transcript via `persistSessionMessages`. **This is what carries the user's queued P2 message to disk before Stop fully settles** |

### AgentRuntime start / resume boundary

| Owner | Site | Behavior |
|---|---|---|
| `SessionRuntime.canStartRun` | `session-runtime-orchestrator.ts:518` | `!this.running && !this.shutdownCalled` |
| `SessionRuntime.continue` (real agent) | `session-runtime-orchestrator.ts` | After the first run, subsequent turns enter via `continue(...)`, not `run(...)` |

### transcript restoration boundary

| Owner | Site | Behavior |
|---|---|---|
| `ConversationStore(config.initialMessages)` | `session-runtime-orchestrator.ts:432` | Seeds the in-memory transcript from `initialMessages`. **All C1, C2, and P2 user messages that reached `executeTurn` end up here.** |
| `startSession` callback in `restoreCheckpoint` | `local-runtime-host.ts:969-982` | Forwards `context.initialMessages` into the new session's `initialMessages` |

### tool-result persistence boundary

| Owner | Site | Behavior |
|---|---|---|
| `LocalRuntimeHost.completeAbortedInteractiveTurn` | `local-runtime-host.ts:1859-1880` | Stores `session.persistedMessages = session.agent.getMessages()` then invokes `persistSessionMessages` — **this is the durability step** |
| `EventBridge.persistMessages` | `local-runtime-host.ts:299-330` | Invoked on agent events; catches errors to avoid masking the failure surface |

---

## §3 Required chronology (frozen)

```
P1 submitted
  → C1 tool result durably complete in transcript
  → C2 tool result durably complete in transcript
  → P2 enqueued (host.pendingPromptsController.enqueue)
  → P2 begins processing:
       controller.drain shifts P2 → LocalRuntimeHost.runTurn → executeTurn
       → executeAgentTurn → SessionRuntime.run (or .continue)
  → user presses Stop:
       SdkTaskControlCoordinator.cancelTask → sdkHost.abort
       → LocalRuntimeHost.abort
       → session.aborting = true
       → session.drainingPendingPrompts was true → discardQueue clears remaining
       → session.agent.abort(reason)
       → completeAbortedInteractiveTurn → persistSessionMessages flushes transcript
  → user presses Resume:
       restoreSession(sourceId)
       → SessionVersioningService.restoreCheckpoint
       → new ActiveSession built at line 821 with pendingPrompts: []
       → SessionRuntime constructed with initialMessages = persisted transcript
       → SessionRuntime.running = false  (canStartRun() → true)
  → next user action:
       either: send a prompt → runTurn → executeTurn (since canStartRun=true)
       or:     nothing — the queued P2 has no surviving owner
```

The load-bearing question:

> When `restoreSession` produces a new `ActiveSession` with `pendingPrompts: []`, and the
> transcript contains P2 (user message) followed by an in-progress assistant turn, what
> is the truthful next state? Does `canStartRun()` correctly return true (telling the user
> "type something new"), or does the agent resume P2 silently and replay C1, C2?

### State identities (not collapsed)

- **queued request identity** — `ActiveSession.pendingPrompts[i].id` (string)
- **active turn identity** — `SessionRuntime.activeRunId`
- **session identity** — `sessionId` (string)
- **transcript identity** — `ConversationStore` ordering + `agentMessageId`s
- **tool call identity** — `toolCallId` (string)

---

## §4-§7 RED setup (pending)

### Evidence priority

1. real `LocalRuntimeHost` + real `SessionRuntime` orchestrator + real `PendingPromptsController` + real `FileSessionService`
2. synthetic provider/model events only at the external LLM boundary
3. synthetic command executor only if production executor would make the test non-hermetic

### Test files

`apps/vscode/src/sdk/__tests__/queued-prompt-stop-resume-integrity.qpsr01.c24-c-bridge.test.ts`
(under `vitest.config.c2-4-c-bridge.ts`).

### RED scope

`QPSR01_PRIMARY` — the upstream chronology in §3.

`QPSR_CTL01..05` — controls per ACT §6.

### Classification matrix

| Case | Description |
|---|---|
| CASE_Q1 | durable pending-prompt queue is restored, but dequeue/cursor ownership is lost |
| CASE_Q2 | completed tool result exists, but restored transcript presents the old tool request as unresolved |
| CASE_Q3 | resume reconstructs P1/old turn rather than selecting the queued successor |
| CASE_Q4 | command really completed externally, but authoritative session state never committed its result before Stop |
| CASE_Q5 | queue/resume state comes from different epoch/generation identities |
| CASE_F  | NOT_REPRODUCED — all required real-seam paths are coherent |
| CAPTURE_INSUFFICIENT | production state does not expose enough identity to discriminate Q1..Q5 safely |

---

## §13 Dogfood diagnostic conservation

The installed host-ownership diagnostic (entries 299..300 on the board), the PTAD
ring, and the writer-provenance ring are NOT modified by this ACT.

---

## §14 Live observation rule

While this ACT runs in the installed Codium build `4.1.10-6e956bc87`, the operator
watches TaskHeader. If `Idle` appears while the agent is visibly still progressing,
screenshot immediately and run:

```
Cline: Dump Post-Terminal Authority Diagnostic
Cline: Dump Host Ownership Diagnostic
```

The agent does NOT stop its production investigation merely because the diagnostic
exists.

---

## Recon close

Recon complete. RED pending. Do not manufacture a repair. Do not assume #12975
reproduces in this fork — that is exactly what the test will determine.