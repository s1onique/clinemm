# 05 — `done` semantics (load-bearing)

Recon at HEAD `3a201b49c`. The `done` event is the signal that
separates the four candidates; getting its semantics wrong
invalidates the contract decision.

## 5.1 What `agent_event(type="done")` means

**Source**: `apps/vscode/src/sdk/message-translator.ts:2009-2078`

The translator's `case "done":` branch:

- Sets `result.turnComplete = true` (line 2223-2225 — the wrapping
  `case "agent_event"` branch also checks `agentEvent.type === "done"`).
- Calls `finalizeDanglingCompaction(state, messages, "cancelled")`
  to close any open compaction divider.
- If `event.reason === "error"`, calls `state.setErrorSeen()` so
  the coordinator can render the "Retry / Start New Task" footer.
- DOES NOT synthesize a `completion_result` row from prior
  assistant text or from `done.text`. (CRA03 boundary.)
- Leaves `attemptCompletionSeen` / `terminalResponseCommittedThisTurn`
  as the SOLE authority for whether the turn promoted to "completed".

In short: **the `done` event marks the end of one agent iteration,
not the end of the logical task.** The runtime distinguishes these
explicitly via the completion-tool `content_end`.

## 5.2 What `done` means at the session-event coordinator

**Source**: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:281-360`

After `done` reaches the coordinator (via `result.turnComplete === true`):

- If `getTurnPhase() === "resumable"`: preserve (straggler from a
  cancelled turn).
- Else if `wasErrorSeen()`: phase = `error`.
- Else if `wasAttemptCompletionSeen()`:
  - If `wasTerminalResponseCommittedThisTurn()`: phase = `completed`.
  - Else (CRA03 / CPL01 liveness): phase = `awaiting_followup`
    with explicit log warning.
- Else (no completion tool seen): phase = `awaiting_followup`.

**The phase transition `awaiting_followup` is the canonical signal
that the agent has yielded the turn to the user.** It does NOT
encode "agent will resume automatically on any stimulus." It does
NOT mean "a re-entry is queued."

## 5.3 Can a session accept external stimulus after `done`?

Yes, via three existing mechanisms:

1. **`PendingPromptsController.enqueue`** (steer_message /
   queue_message / pending_prompt bridge)
   — `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1061-1068`
   enqueues an entry; `LocalRuntimeHost.runTurn` then chooses
   `delivery = "queue" | "steer"` when the agent cannot start a new
   run. The queue drains automatically after a non-error finish.

2. **`AgentEventBridge.handlePluginEvent`** (for `steer_message` /
   `queue_message` / `pending_prompt` plugin events)
   — `sdk/packages/core/src/runtime/host/local/agent-event-bridge.ts:180-241`
   routes these to `deps.enqueuePendingPrompt(targetSessionId, { prompt, delivery })`.

3. **User follow-up via the webview/CLI**
   — `apps/vscode/src/sdk/sdk-followup-coordinator.ts` /
   `apps/cli/src/runtime/interactive/session-runtime.ts`. Always
   routed through `runTurn` → either immediate execution or
   `controller.enqueue`.

**There is no other authorized way to start a new agent iteration
on a session.** Any of the three above requires:
- A `delivery` value (`"queue"` or `"steer"` or undefined → immediate),
- A `sessionId` that matches the active session,
- For plugin events: an `emitEvent("steer_message", { sessionId, prompt })`
  call into the plugin host.

The CommandJobManager does NOT call any of these today. Its terminal
event only updates `updateBackgroundCommandState(false, undefined)`,
which feeds the deferred-continuation marker (turn-state writer only).

## 5.4 Does `done` mean "all tool obligations discharged"?

**No.** The runtime distinguishes:
- `done` (agent iteration ended) — may happen with outstanding
  background obligations. The predecessor ACT's LIVE specimen is
  exactly this: model emitted `done` with a background CommandJob
  still RUNNING.
- `attempt_completion` content_end (canonical terminal response
  committed) — this is what the runtime treats as "user-visible
  completion" for the green box.
- `terminalResponseCommittedThisTurn` (the strictest authority) —
  the `done` handler explicitly does NOT set this; only the
  completion-tool `content_end` does (per CRA03 corrections).

A `done` while a background CommandJob is RUNNING is therefore a
**legitimate runtime state** in current code. The BTCONT01 fix
ensures `awaiting_followup` is committed when that background
CommandJob eventually becomes terminal.

## 5.5 Cross-turn resumption

When the user sends a follow-up after `done` + `awaiting_followup`:

- The webview/CLI sends the follow-up via `sdkHost.send(prompt)` or
  `sdkHost.runTurn({ sessionId, prompt })`.
- `LocalRuntimeHost.runTurn` checks `canStartRun()`. If true, the
  turn starts immediately. If false (the session is still
  processing or another turn is mid-flight), the prompt is queued
  via `PendingPromptsController.enqueue`.
- A queued prompt drains automatically when the previous turn
  finishes with a non-error finishReason
  (`LocalRuntimeHost.runTurn:1089-1093`).

**Crucial implication for candidates B/D**: if a notify-on-terminal
stimulus arrives while a newer user-initiated turn is mid-flight
(Scenario S9 — newer user turn before terminal), the existing
`PendingPromptsController` already handles this. The question for
B/D is whether the notify-on-terminal prompt is `delivery: "queue"`
(waits behind current work) or `delivery: "steer"` (interrupts).

## 5.6 Summary for contract decision

```text
DONE_MEANS:
  - The agent iteration that was running has ended.
  - The session may now accept external stimuli.
  - Outstanding async obligations (background commands, queued
    subagent completions, etc.) are NOT extinguished.

CAN_ACCEPT_POST_DONE_STIMULUS:
  - YES, via PendingPromptsController.enqueue (any session).
  - YES, via plugin steer_message / queue_message (any session
    with a registered plugin host).
  - YES, via user follow-up (webview/CLI).
  - No other authorized mechanism exists.

OUTSTANDING_OBLIGATIONS_AT_DONE:
  - The runtime currently projects them as turn-state (awaiting_followup
    on terminal). It does NOT translate them into agent re-entry.

QUEUEING_BEHAVIOR:
  - delivery:"queue" → waits behind current work
  - delivery:"steer" → interrupts current work
  - both delivered via PendingPromptsController → runTurn → executeTurn
```

## 5.7 Why this is load-bearing for the contract decision

If the contract says "the runtime MUST wake the agent on terminal"
(Candidate B or D), the runtime must:
1. Carry the wake intent somewhere durable (currently absent — see §3.5).
2. On terminal, translate that intent into a `PendingPromptsController.enqueue`
   call with a defined `delivery`.
3. Bind the wake to the exact session/task/generation identity
   (the existing conservation rules in
   `reevaluateDeferredContinuation` already do this for turn-state;
   an analogous identity test must apply to the wake).

The seams exist (Candidate B/D is implementable). The decision is
product-shaped, not runtime-shaped.
