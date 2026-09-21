# 06 — Reentry-seam inventory

Recon at HEAD `3a201b49c`. Inventory of every existing async
session stimulus mechanism. Each is classified for fitness to the
contract-decision purpose.

## 6.1 `PendingPromptsController.enqueue`

**Source**: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`
**Wired in**: `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1061-1068`

**Mechanism**: a `(sessionId, { prompt, delivery })` entry is added to
the per-session queue. When `canStartRun()` returns true, `drain()`
shifts the head entry and routes it through `deps.send` → `runTurn`
→ `executeTurn` → `markTurnRunning`. Drain schedules itself via
`queueMicrotask` after every non-error finish.

**Classification for our purpose**: `EXISTS_AND_REUSABLE`.

This is the canonical post-`done` agent-re-entry seam. It supports:
- immediate (no delivery → executeTurn directly),
- queue (waits behind current work, drains after),
- steer (interrupts current work, runs immediately).

It is NOT specific to background commands; it is the general
"send a prompt to a session" surface. A wake-on-terminal contract
could route through it without inventing a new mechanism.

**Caveat**: requires a session-bound `runTurn` to be authorized.
The contract ACT must specify who decides wake is allowed (host
gate, model prompt gate, user-intent flag, or runtime-default).

## 6.2 `AgentEventBridge.handlePluginEvent`

**Source**: `sdk/packages/core/src/runtime/host/local/agent-event-bridge.ts:180-241`

**Mechanism**: handles `steer_message` / `queue_message` /
`pending_prompt` plugin events, routes them to
`deps.enqueuePendingPrompt(targetSessionId, { prompt, delivery })`.

The `delivery` mapping:
```text
event.name === "steer_message"  → delivery = "steer"
event.name === "queue_message"  → delivery = "queue"
event.name === "pending_prompt" → delivery = payload.delivery
                                   (default "queue")
```

**Classification for our purpose**: `EXISTS_AND_REUSABLE` with a
specific use shape.

Upstream's `background-terminal` example plugin uses exactly this:
```ts
globalThis.__clinePluginHost?.emitEvent?.("steer_message", { sessionId, prompt })
```
Source: `sdk/examples/plugins/background-terminal.ts:167-175`. On
child process `close`/`error`, the plugin writes the completion
message and emits `steer_message` with the captured sessionId.

This is the upstream precedent. ClineMM's `run_commands` path does
NOT use it today (the CommandJobManager publishes terminal events
to the host-owned `updateBackgroundCommandState` callback, not via
the plugin host).

## 6.3 `plugin.steer_message` host authority

The plugin host is a host-owned construct (`globalThis.__clinePluginHost`).
The ClineMM host exposes it only to installed plugins via the
plugin sandbox. The fork's `run_commands` tool is not a plugin — it
is a host-owned builtin.

**Classification for our purpose**: `EXISTS_BUT_WRONG_SEMANTICS`
for the contract purpose. The plugin event bridge is correct in
shape but it is plugin-shaped (requires plugin host context), not
host-builtin-shaped. Routing `run_commands` terminal through it
would require either:
- turning `run_commands` into a plugin (rejected: it is a host
  builtin with command-policy authority),
- or extending `AgentEventBridge.handlePluginEvent` to also accept
  host-builtin emissions (a small surface change).

## 6.4 `reevaluateDeferredContinuation`

**Source**: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:140-200`

**Mechanism**: when a background CommandJob transitions
`>0 → 0` and the active session still has a deferred marker,
checks:
- marker.sessionId === activeSession.sessionId
- marker.taskId === activeSession.getTask().taskId
- marker.epoch === current minter epoch
- `hasRunningBackgroundJobForOwner(activeSession.sessionId) === false`

If all pass, commits `awaiting_followup` via
`setTurnPhase("awaiting_followup", ...)` and clears the marker.

**Classification for our purpose**: `EXISTS_BUT_WRONG_SEMANTICS`
for wake-on-terminal. It is a turn-state writer, not an
agent-runtime call. It produces the `awaiting_followup` phase
that the user reads as "Your turn" / "Waiting" — it does NOT
invoke the agent.

**However**: it does enforce the four conservation rules
(`sessionId` / `taskId` / `epoch` / `owner-still-running`) that
any wake-on-terminal implementation must also enforce. These rules
are reusable.

## 6.5 `LocalRuntimeHost.runTurn`

**Source**: `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1044-1095`

**Mechanism**: the canonical "send a prompt to a session" entry
point. Decides:
- `delivery = input.delivery ?? (session.interactive && !canStartRun ? "queue" : undefined)`
- if `delivery` is queue/steer, enqueues and returns undefined.
- else executes the turn; after non-error finish, drains queued
  prompts.

**Classification for our purpose**: `EXISTS_AND_REUSABLE`. This is
the seam that any wake-on-terminal contract would target. It is
already wired to the queueing controller; the contract ACT would
just need to define the wake trigger and the wake prompt shape.

## 6.6 The host-owned `CommandJobManager.onTerminalEvent` callback

**Source**: `apps/vscode/src/sdk/command-job-manager.ts` (lifecycle events).

The CommandJobManager publishes terminal lifecycle via the
`onCommandJobLifecycle` callback registered at construction time
in `sdk-session-lifecycle.ts:622-624`. Today this callback flows to
`SdkController.updateBackgroundCommandState` for turn-state projection.

**Classification for our purpose**: `EXISTS_AND_REUSABLE` with a
NEW consumer needed. The terminal event itself is the wake
trigger. The contract ACT needs to define whether a SECOND consumer
(notification-wake) is registered alongside the existing
turn-state consumer, and how identity is preserved across both.

## 6.7 Identity-correlating machinery

The existing identity machinery in
`reevaluateDeferredContinuation` covers:
- `sessionId` from `AgentToolContext.sessionId` captured at job
  creation (per ACT-CLINEMM-BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01).
- `taskId` from `getTask()?.taskId` at re-evaluation time.
- `epoch` from `messageTranslatorState.getMinter().epoch`.

**Classification for our purpose**: `EXISTS_AND_REUSABLE`. Any
wake-on-terminal implementation MUST be bound to the same identity
test the turn-state writer uses. This is the conservation rule
set; reusing it is necessary, not optional.

## 6.8 Stale-card projection

**Source**: `apps/vscode/src/sdk/background-job-liveness-authority.ts`,
`task-header-canonical-task-activity-ownership.cta01.test.ts`, and
the broader BGCL01 evidence set.

The TaskHeader rendering shows a `⎇ N` gauge while a background
job is RUNNING. When the job becomes terminal, the gauge clears
(via the same `onBackgroundStateChange(false, undefined)` callback).
There is a LIVE-PROVEN defect that the gauge can stay stale
("stale card") in certain card-rendering paths — see
`ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01` for the
deferred successor.

**Classification for our purpose**: `EXISTS_BUT_STALE_DEFECT`
and OUT OF SCOPE for this ACT. The contract decision does NOT
depend on the card UI. The card-defect successor ACT remains
the right place to fix card projection.

## 6.9 Summary table

```text
| Seam                                          | Classification                  |
|-----------------------------------------------|---------------------------------|
| PendingPromptsController.enqueue               | EXISTS_AND_REUSABLE             |
| AgentEventBridge.handlePluginEvent             | EXISTS_BUT_WRONG_SEMANTICS      |
|                                               | (plugin-shaped)                 |
| reevaluateDeferredContinuation                 | EXISTS_BUT_WRONG_SEMANTICS      |
|                                               | (turn-state writer, not agent)  |
| LocalRuntimeHost.runTurn                       | EXISTS_AND_REUSABLE             |
| CommandJobManager.onTerminalEvent callback     | EXISTS_AND_REUSABLE             |
| Identity-correlating machinery                 | EXISTS_AND_REUSABLE             |
| Stale-card projection                          | EXISTS_BUT_STALE_DEFECT / OOS   |
```

**Conclusion**: every seam needed for Candidate B/D already
exists in some form. Candidate B/D is not blocked by absent
runtime infrastructure. The decision is product-shaped, not
runtime-shaped.
