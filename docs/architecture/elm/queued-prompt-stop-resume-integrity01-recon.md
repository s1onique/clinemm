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

## §15 Real composition discriminator (QPSR02_REAL_COMPOSITION)

### Why §15 is needed

After Factory review, the `e6272bb4e` QPSR01 commit was found to exercise only the **host queue + abort control seam** with a stub agent. The load-bearing RED was NOT reproduced because:

1. `QPSR01_PRIMARY` ends at `host.abort(...)` — no Resume gesture, no post-resume agent invocation.
2. `makeAgentStub()` returns empty `messages`/`toolCalls` — no durable `C1`/`C2` tool results exist in the transcript.
3. `host.restoreSession({ restore: { messages: true } })` end-to-end was NOT invoked.

### What §15 actually exercises

**Test file**: `apps/vscode/src/sdk/__tests__/queued-prompt-stop-resume-integrity.qpsr01.c24-c-bridge.test.ts` — `QPSR02_REAL_COMPOSITION` block.

**Production seam composition**:

```
real LocalRuntimeHost (via @cline-internal/core bridge alias)
+ real SessionRuntime orchestrator (via @cline-internal/core bridge alias)
+ real AgentRuntime (via @cline/agents)
+ real FileSessionService (via @cline-internal/core bridge alias)
+ real ConversationStore (SessionRuntime's internal store)

synthetic_real:
+ scripted StepModel (data-dependent on the messages array)
+ counter-backed C1 and C2 AgentTools (each tool's `execute` increments a distinct counter)

NOT_EXERCISED:
+ VS Code approval UI (replaced with synthetic_real requestToolApproval = approve-all)
+ real LLM provider (StepModel stands in)
+ the CLI/desktop-app sidecar paths (out of scope)
+ the checkpoint / restoreSession path (production Resume in VS Code is
  startSession({ sessionId, prompt }) on the live session — NOT restoreSession)
```

### Chronology (QPSR02)

```
T0  startSession({ sessionId: S, prompt: P1_text, ... })
    AgentRuntime seeded with empty initialMessages.

T1  runTurn({ sessionId: S, prompt: P1_text })
    StepModel turn 1 — emit tool-call-delta for C1, finish reason="tool-calls"
    requestToolApproval → approve
    C1's execute() fires → C1 counter = 1
    StepModel turn 2 — emit tool-call-delta for C2, finish reason="tool-calls"
    requestToolApproval → approve
    C2's execute() fires → C2 counter = 1
    StepModel turn 3 — emit text-delta "P1 complete", finish reason="stop"
    → AgentRuntime.run completes → ConversationStore now contains
       [user-P1, asst(C1), tool(C1_result), asst(C2), tool(C2_result), asst-text]
    Host session.status = "idle"

T2  runTurn({ sessionId: S, prompt: P2_text, delivery: "queue" })
    pendingPromptsController.enqueue(P2)
    Microtask drain fires → agent.continue()
    StepModel turn 1 — emit tool-call-delta for C3, finish reason="tool-calls"
    (C3 is the queued-P2 tool — different tool from C1/C2, NOT a replay)

T3  host.abort(S, "user-pressed-stop")
    session.aborting = true
    session.agent.abort() reached exactly once
    completeAbortedInteractiveTurn settles status="idle"

T4  (RESUME) runTurn({ sessionId: S, prompt: P2_REATTEMPT })
    This is the upstream-chronology "Resume" gesture — the live
    session receives a new prompt. The ConversationStore MUST
    already contain the T1 transcript (user-P1, asst C1, tool C1,
    asst C2, tool C2, asst text).
    StepModel turn 1 — INSPECT messages:
      if it contains tool-result for C1 AND tool-result for C2:
        emit text-delta "Continuing P2 with prior context." finish:stop
        (PASS — model is faithful to transcript; no replay)
      else:
        emit tool-call-delta for C1_replay (the "honest" replay
        the agent SHOULD emit if its working transcript is broken
        and lacks the prior tool result)
        (FAIL — defect reproduced: CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST)

T5  Assertions:
    expect(c1Count).toBe(1)   ← C1 never re-executed
    expect(c2Count).toBe(1)   ← C2 never re-executed
    (C3 may or may not have executed depending on T2 — recorded but not load-bearing.)
    session.status === "idle"
    conversation store transcript invariants:
      user-P1, asst(C1), tool(C1_result), asst(C2), tool(C2_result)
      are ALL still present in the conversation store
```

### Classification outcomes

| Outcome | Classification |
|---------|----------------|
| `c1Count === 1 && c2Count === 1` AND StepModel emitted text continuation | `HALT_RED_NOT_REPRODUCED` — upstream defect not present at this seam |
| `c1Count === 1 && c2Count === 1` AND StepModel emitted tool-call replay | `CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST` (contradiction — model emitted replay but tool didn't fire) |
| `c1Count > 1` OR `c2Count > 1` | `CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST` — upstream defect reproduced |

### §15.1 What this test deliberately does NOT exercise

1. **`host.restoreSession({ restore: { messages: true } })`** — the production Resume path in VS Code uses `startSession({ sessionId, prompt })` on the LIVE session, NOT `restoreSession`. `restoreSession` is only used by `editMessageAndRegenerate`. So this ACT targets the production resume path.
2. **The `pendingPrompts` queue's persistence across Stop** — recon §3 showed `pendingPrompts: []` after restore, but the production Resume path doesn't restore — it stays on the live session. The in-memory `pendingPrompts` controller IS the source of truth for queue state on Resume.
3. **Workspace restoration** — `restore.workspace: false` is what VS Code uses for message-only Resume.

---

## §15.2 QPSR03_PRODUCTION_CHRONOLOGY (Factory reviewer disposition closure)

After the Factory reviewer's `HALT_TEST_SEAM_INVALID` disposition against `e5a699695`, the third commit (`e6272bb4e` + `e5a699695` + QPSR03) closed both P0s:

### P0 #1 closure — upstream-precise queue precondition

QPSR02 submitted P2 only AFTER P1 finished, so the `delivery: "queue"`
label never had to exercise the genuine queue path. QPSR03 enforces the
upstream chronology by:

1. Starting P1 WITHOUT awaiting completion
2. Waiting for `c1Count === 1` (C1 has executed, agent is mid-iteration)
3. THEN submitting P2 with `delivery: "queue"` (canStartRun() === false)
4. Requiring the `pending_prompts` event (with P2 in `prompts[]` and
   `delivery === "queue"`) to fire BEFORE the drain
5. Awaiting P1, which triggers the queue drain
6. Requiring the `pending_prompt_submitted` event to fire with P2

The queue precondition (`!canStartRun() && interactive → "queue"`) is
genuinely exercised. Witness #2 (`p2EnqueueObserved >= 1`) and Witness #3
(`p2DrainCount >= 1`) together prove it.

### P0 #2 closure — production Resume entrypoint

Production Resume (per `SdkFollowupCoordinator.resumeSessionFromTask`)
is THREE steps:

```
1. prepareTaskResumeStartInput → loadInitialMessages(host, taskId)
2. sessions.startNewSession({ ...resumeStart, interactive: true })
3. fireAndForgetSend(sdkHost, sessionId, prompt) → sdkHost.send → host.runTurn
```

QPSR02 bypassed steps (1) and (2) and only exercised step (3) on the
LIVE first-host session. QPSR03 mirrors production exactly:

| QPSR03 action | Production mirror |
|---|---|
| `firstHost.readLiveSessionMessages(sessionId)` | `loadInitialMessages(sessionHost, taskId)` |
| `firstHost.dispose()` | `clearTaskForOperation(token)` |
| Construct SECOND `LocalRuntimeHost` against SAME `FileSessionService` | Lifecycle creates fresh `SdkSessionHost` against shared session backend |
| `secondHost.startSession({ sessionId, initialMessages, ... })` | `sessions.startNewSession({ ...resumeStart, interactive: true })` |
| `secondHost.runTurn({ sessionId, prompt: "Resume P2" })` | `fireAndForgetSend(sdkHost, sessionId, prompt)` → `sdkHost.send` → `host.runTurn` |

Witness #4 proves the production Resume entrypoint is exercised end to
end (not the simplified live-session `runTurn` shortcut).

### Tool deferral

C3's executor races its release-promise against the abort signal passed
through `AgentToolContext.signal`. Without the signal, the deferred
executor would block `executeTurn` from returning forever; `agent.abort()`
flips the signal which unblocks the executor and lets `executeTurn` throw,
which `runTurn`'s try/catch catches and routes through
`completeAbortedInteractiveTurn` (status: "idle"). This lets the test
deterministically land Stop while C3 is the current tool — mirroring
the upstream issue's exact failure window.

### Chronology (QPSR03)

```
T0  startSession({ sessionId: S })           // no prompt
T1  runTurn({ sessionId: S, prompt: P1 })   // NOT awaited
    StepModel: C1 → C2 → text → completed
    ConversationStore: [user-P1, asst(C1), tool(C1), asst(C2), tool(C2), asst-text]
    Witness #1: waitForCounterAtLeast(c1Count, 1) → c1Count === 1
                session.status === "running"
T2  runTurn({ sessionId: S, prompt: P2, delivery: "queue" })
    pendingPromptsController.enqueue(P2)
    Witness #2: pending_prompts event with P2 in prompts[]
                session canStartRun() is FALSE → queue is real
T3  await p1Promise → P1 completes → canStartRun() flips TRUE
    scheduleDrain → drain → runTurn → C3.execute() (deferred)
    Witness #3: pending_prompt_submitted event for P2
                c3Count >= 1 (C3 currently executing)
T4  firstHost.abort(sessionId, "user-pressed-stop")
    session.aborting = true
    session.agent.abort(reason) → abortController.signal aborted
    C3.execute() unblocks via signal
    executeTurn throws → completeAbortedInteractiveTurn → status: "idle"
    Witness #4 prep: readLiveSessionMessages(sessionId) → initialMessages
    Witness #4 prep: firstHost.dispose() (release C3 first)
T5  new secondHost = new LocalRuntimeHost(...)
    Witness #4: secondHost.startSession({ initialMessages, ... })
    Witness #4: secondHost.runTurn({ sessionId, prompt: "Resume P2" })
                → resume-only StepModel → inspects initialMessages
                → tool-result for C1 + C2 are present
                → emits text-delta "Continuing P2 with prior context."
                → no replay
T6  expect(c1Count) === 1
    expect(c2Count) === 1
    expect(p2EnqueueObserved) >= 1
    expect(p2DrainCount) >= 1
    expect(finishReason) === "completed"
```

### Classification outcomes (QPSR03)

| Outcome | Classification |
|---|---|
| `c1Count === 1 && c2Count === 1` AND `p2EnqueueObserved >= 1` AND `p2DrainCount >= 1` | `HALT_RED_NOT_REPRODUCED` — full upstream-chronology + production-Resume seam. Transcript conservation survives Stop→Resume. |
| `c1Count > 1` OR `c2Count > 1` | `CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST` — defect reproduced. The resumed Session emitted a C1 tool call because the loaded transcript lacked the prior C1/C2 tool results. |

### §15.2.1 What this test deliberately does NOT exercise

1. **The `host.restoreSession({ restore: { messages: true } })` path** — recon §15.1 covers this. Production Resume uses `startSession-with-history`, NOT `restoreSession`. QPSR03 mirrors the production path exactly.
2. **Workspace restoration** — `restore.workspace: false` is what VS Code uses for message-only Resume; not relevant to the queue + transcript conservation discriminator.
3. **The CLI / desktop-app sidecar paths** — out of scope; QPSR03 mirrors the VS Code path.
4. **The full SdkController** — QPSR03 mirrors the production Resume entrypoint semantics (`loadInitialMessages` + `startNewSession` + `fireAndForgetSend`) using only `LocalRuntimeHost` methods. The SdkController is a thin wrapper around these primitives; if the seam fails at the `LocalRuntimeHost` level, the SdkController cannot recover.

---

## Recon close

Recon complete. Real-composition discriminators implemented (QPSR01 host controls + QPSR02 real composition + QPSR03 production-Resume entrypoint). Do not manufacture a repair.
reproduces in this fork — that is exactly what the test will determine.