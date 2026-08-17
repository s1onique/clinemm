# Task-State Authority Inventory

**ACT-CLINEMM-ELM-ARCHITECTURE01 / E0**

This document enumerates every existing **task-state authority** in the
pre-Elm-Architecture code base, classifies each, and identifies duplicated
facts that the shadow `TaskModel` is intended to subsume.

The goal is **inventory only**. No production behaviour is changed in E0.

---

## Scope

Searched paths:

- `sdk/packages/agents/src`
- `sdk/packages/core/src` (only the bits observed by the host)
- `apps/vscode/src/sdk`
- `apps/vscode/webview-ui/src` (only the parts that derive task state)

The runtime boundary is `AgentRuntime` (`sdk/packages/agents/src/agent-runtime.ts`).
The host boundary is `VscodeSessionHost` / `SdkController`
(`apps/vscode/src/sdk/`). The webview is purely read-only consumers; the
authorities it observes are reflected from the host or the runtime.

---

## Authority matrix

| Authority                       | Current owner                                       | Kind               | Wired to webview via |
|---------------------------------|----------------------------------------------------|--------------------|----------------------|
| Run lifecycle (`AgentRunStatus`) | `AgentRuntime.state.status`                        | CANONICAL          | `runtime.snapshot().status` (rarely surfaced) |
| Model streaming activity        | `AgentRuntime.state.executionModelStreaming`       | CANONICAL          | `runtime.snapshot().execution.modelStreaming` |
| Tool activity                   | `AgentRuntime.state.pendingToolCalls.length`      | DERIVED (live)     | `runtime.snapshot().execution.tooling` |
| Approval activity               | `AgentRuntime.state.executionAwaitingApproval`    | CANONICAL          | `runtime.snapshot().execution.awaitingApproval` |
| Recovery policy + state         | `RecoveryTracker` (runtime-owned, per `AgentRuntime`) | CANONICAL        | `runtime.snapshot().recovery` and `recovery-state-changed` |
| Recovery projection             | `runtime-recovery-projection.ts`                   | PURE PROJECTION    | `AgentRuntimeRecoverySnapshot` (typed, privacy-projected) |
| Execution projection            | `runtime/state/execution-state.ts`                 | PURE PROJECTION    | `AgentRuntimeExecutionState` |
| Turn presentation phase         | `TurnStateTracker` (host-owned, per `Controller`)  | CANONICAL (host)   | `turnState: TurnState` in `getStateToPostToWebview()` |
| Task telemetry (tool/recovery counters, elapsed) | `TaskTelemetryTracker` (host-owned, per `Controller`) | CANONICAL (host) | `taskTelemetry: TaskHeaderTelemetryStrip` in `getStateToPostToWebview()` |
| Cancel authority                | `SdkController.cancelTask` → `AgentRuntime.abort`  | CANONICAL          | `turnStateTracker.set("resumable")` writes; webview sees `resumable` |
| New-task authority              | `SdkTaskStartCoordinator` (host) → `AgentRuntime.run` | CANONICAL       | `turnStateTracker.set("streaming")` (lifecycle boundary) |
| Resume authority                | `SdkController.reinitExistingTaskFromId`           | CANONICAL          | writes through the same `turnStateTracker` |
| Webview transport               | `WebviewGrpcBridge` / `postStateToWebview`         | SIDE_EFFECT_OWNER  | gRPC postMessage |
| Thinking presentation           | **multiple webview consumers** (legacy fall-through) | PROJECTION / LEGACY_INFERENCE | reads `turnState.phase` + `message.partial` |
| Reasoning prose                 | `AgentRuntimeEvent` `assistant-reasoning-delta`    | PRESENTATION       | translated to `ClineMessage.partial=true` say="reasoning" |
| Tool call prose                 | `AgentRuntimeEvent` `tool-started` / `tool-finished` | PRESENTATION      | translated to `ClineMessage` say="tool" (partial during run) |
| API request prose               | `AgentRuntimeEvent` `usage-updated`                | PRESENTATION       | translated to `ClineMessage` say="api_req_started" |
| Conversation history            | `AgentRuntime.state.messages`                      | CANONICAL (history) | translated to `ClineMessage` history |

---

## Duplicated facts

The current architecture represents the same fact in several places. Each
duplication is a candidate for "this is the bug class" because the
writerships can drift.

### FACT: "Task is actively executing"

| Representation                                           | Owner           |
|----------------------------------------------------------|-----------------|
| `AgentRuntime.state.status === "running"`                | runtime         |
| `AgentRuntime.state.executionModelStreaming === true`    | runtime         |
| `AgentRuntime.state.executionAwaitingApproval === true`  | runtime         |
| `AgentRuntime.state.pendingToolCalls.length > 0`         | runtime         |
| `runtime.snapshot().execution.{modelStreaming,tooling,awaitingApproval}` | projection |
| `TurnStateTracker.phase` ∈ {"streaming","awaiting_approval","awaiting_followup"} | host |
| `message.partial === true` (text/reasoning/tool)        | webview-derived |
| `<ChatRow>` `isReasoningStreaming` (C04 partial-fix)     | webview         |
| `<RequestStartRow>` isThinking (C04 partial-fix)         | webview         |
| `TaskTelemetry` `startedAt/endedAt` (`00:00` while active bug) | webview-derived |
| Control-disabled / button-enabled derivations           | webview + host  |

**This is the live bug class.** E0 specifically names every representation
so the shadow model can identify the divergent ones by class instead of
chasing them through screenshots.

### FACT: "Recovery is currently gated"

| Representation                                                | Owner    |
|---------------------------------------------------------------|---------|
| `RecoveryTracker.state` (`idle`/`recovering`/`warning`/`circuit_open`) | runtime |
| `AgentRuntimeRecoverySnapshot.state`                          | projection |
| `recovery-state-changed` event payload                        | projection |
| `TaskTelemetryTracker.recoveryBudgetFailures` (cumulative)    | host     |

The single source of truth for *current* recovery gating is the runtime
projection. The host holds a cumulative counter (different fact, not a
duplicate of the current gating).

### FACT: "Tool call started"

| Representation                                               | Owner |
|--------------------------------------------------------------|-------|
| `AgentRuntime.state.pendingToolCalls.push(...)`              | runtime |
| `tool-started` event                                         | runtime |
| `TaskTelemetryTracker.recordToolStarted()`                    | host   |
| `ClineMessage` say="tool" with partial=true                  | webview-derived |

The runtime is the canonical source. The host increments a counter
*cumulatively*; the webview derives a renderable row from the partial
message tail. These three are not in conflict today, but the historical
"tool count grows while the partial stays true" sequencing has caused
real regressions; the shadow `TaskModel` will treat them as
non-overlapping projections of the same underlying fact.

### FACT: "Visible task identity"

| Representation                                  | Owner |
|-------------------------------------------------|-------|
| `task.taskId` / `HistoryItem.id`                 | host  |
| `Conversation` / `SessionRecord.sessionId`      | runtime |
| `currentTaskItem` (webview)                      | webview |
| `getDisplayedTaskId()` (host)                    | host  |

The host owns the **visible** task identity. The runtime owns a
**session-scoped** identity (which may be a resumed conversation).
These are correlated but not identical — a resumed task keeps the host's
identity but the runtime may produce a fresh `runId`. The shadow model
holds the host-visible identity only; the runtime/session split is out
of scope for the Elm ACT.

---

## Mutable authorities (would be eliminated by TEA cutover)

| Mutable authority                              | Lifetime | Current mutation sites |
|------------------------------------------------|----------|------------------------|
| `AgentRuntime.state.executionModelStreaming`   | runtime  | `model.stream` finally, `setIdle()`, `restore()` |
| `AgentRuntime.state.executionAwaitingApproval` | runtime  | `requestToolApproval` try/finally, `setIdle()`, `restore()` |
| `AgentRuntime.state.pendingToolCalls`          | runtime  | `prepareTools`, `executePreparedTool`, `setIdle`, `restore` |
| `AgentRuntime.state.status`                    | runtime  | `run()`, `finishRun()`, `abortTask()`, `restore()` |
| `RecoveryTracker.state`                        | runtime  | `recordFailure`, `recordSuccess`, `attemptRepair`, `openCircuit`, `reset`, `restore()` |
| `TurnStateTracker.phase`                       | host     | 12 call sites in `SdkController` + 4 coordinators |
| `TaskTelemetryTracker.*`                       | host     | `startTask`, `endTask`, `recordToolStarted`, `observeTurnPhase`, `observeRecovery` |

During E0–E4 the shadow model observes; it does not retire any of these.
The architecture review for cutover will be a later ACT.

---

## Derived authorities

| Authority                                     | Source                                  |
|-----------------------------------------------|-----------------------------------------|
| `runtime.snapshot().execution`                | `buildExecutionState({...})`            |
| `runtime.snapshot().recovery`                 | `projectRuntimeRecovery({...})`         |
| `TaskTelemetryTracker.get()`                  | aggregates `startedAt`/`endedAt`/counts |

---

## Prose-derived state (webview-only, the bug class)

| Derived                                      | Source                                                 | Risk |
|----------------------------------------------|--------------------------------------------------------|------|
| `isReasoningStreaming` (ChatRow `reasoning`) | `message.partial && turnStateIsStreaming` (C04 fix)    | gated by `turnState`, ok now |
| `RequestStartRow` `isThinking`               | `message.partial` tail inference + `reasoningContent && !hasCost` (C04 fix) | gated by `turnState`, ok now |
| `isTaskRunning` heuristics (anywhere else)   | various                                                | high — to be inventoried in E0 follow-up |
| Button-enabled derivations                   | `phase` ∈ "streaming" → cancel enabled, etc.            | maps to `TurnPhase` projection |
| `awaiting_followup` reading                  | `message.type === "ask"` tail                          | presentation-only, projection depends on host/UI |

Prose state is **forbidden from `TaskModel`** (ELM11). The shadow model
holds lifecycle / activity / recovery / telemetry only; anything that
depends on message text or partial-tail state must be derived in the
projection from `TaskModel` + the host's `hostInteraction` projection
(see `projectHostTurnState`).

---

## Counts

```text
E0_AUTHORITY_COUNT         = 18
E0_MUTABLE_AUTHORITIES     = 7
E0_DERIVED_AUTHORITIES     = 3 (in @cline/agents runtime/state/) + 1 (TaskTelemetry aggregation)
E0_PROSE_DERIVATIONS       = 4 webview consumers identified
E0_DUPLICATED_FACTS        = 4 (active execution, recovery gating, tool call started, visible task identity)
```

The duplicated-fact count of 4 is the upper bound of "facts the shadow
model will subsume". The bug class is dominated by FACT 1 (active
execution); that is what `E4-DIFF-01` reproduces.

---

## Boundary rules observed during recon

These are the architectural rules already enforced in the existing
codebase and that the Elm ACT must not violate in shadow mode:

1. `AgentRuntime.state.execution*` flags are mutated only inside
   `try/finally` blocks around the awaits they bracket.
2. `TurnStateTracker.set()` is the *only* writer of `turnState.phase`;
   shadow adapters MUST NOT call it.
3. `TaskTelemetryTracker` is **observer-only**: it does not feed back
   into `RecoveryTracker`, the runtime, or `TurnStateTracker`.
4. `recovery-state-changed` is emitted by `AgentRuntime` only; the host
   must subscribe, never publish.
5. `AgentRuntimeExecutionState` and `AgentRuntimeRecoverySnapshot` are
   the canonical *projections* the runtime exposes — no consumer
   constructs these projections themselves.
6. The recovery projection lives at `runtime/recovery/runtime-recovery-projection.ts`
   (recovery-specific). The execution projection lives at
   `runtime/state/execution-state.ts` (general, not under recovery).
   The Elm task-state module will sit alongside `execution-state.ts`
   in `runtime/state/` per the same rule ("general runtime state, not
   under recovery").

---

## Decision: shadow location

```text
LOCATION = sdk/packages/agents/src/runtime/state/task-state/
```

Reasoning:

- It is the canonical home for *general runtime/state* in this package.
- It mirrors `runtime/state/execution-state.ts` (precedent).
- It does **not** violate the rule "task-state architecture should not
  sit back under `runtime/recovery/`" (Phase 5 of the ACT).
- It is `@cline/agents`-internal; no public-API expansion.

No `@cline/shared` change is required for E0–E4. The `TaskMsg`,
`TaskModel`, `TaskEffect`, projections, and divergences are entirely
package-internal.

---

## Effect-owner map (for Phase 8 / Phase 9 of the ACT)

| Requested effect          | Owner during E0–E4 (non-authoritative)             |
|---------------------------|----------------------------------------------------|
| `post_state`              | host already does it; shadow emits effects as data |
| `persist_task`            | `TaskHistory` already does it; shadow emits       |
| `request_model`           | `AgentRuntime.run` already does it; shadow emits   |
| `execute_tool`            | `AgentRuntime.executePreparedTool` already does it |
| `request_approval`        | `AgentRuntime.requestToolApproval` already does it |

`EFFECT_EXECUTION_ENABLED = false` during E0–E4.