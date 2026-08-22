# ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01 — RECON

**Disposition**: recon-only. No repair authorized yet.

**Predecessor**: ACT-CLINEMM-CANONICAL-TASK-ACTIVITY-OWNERSHIP01
**Halted with**: `HALT_TASK_LIFETIME_NOT_ACTIVITY_AUTHORITY`
**Restart condition**: identify the existing working-vs-waiting discriminator from host-side interaction ownership, then freeze a RED.

## Five-question recon

### Q1: Where is `lastInteractiveTurnFinishReason` written and cleared?

**Where written** (3 sites, all in `sdk/packages/core/src/runtime/host/local-runtime-host.ts`):

- `local-runtime-host.ts:847` — initialized to `undefined` in the session constructor.
- `local-runtime-host.ts:1780` — written inside `completeInteractiveTurn(session, finishReason)` immediately before `markTurnIdle(session)`:

```ts
session.lastInteractiveTurnFinishReason = finishReason
await this.markTurnIdle(session)
```

- `local-runtime-host.ts:1786, 1805` — read-only consumers: `resolveInteractiveStopStatus` and `resolveInteractiveStopExitCode`.

**Where cleared**: **NOWHERE**. `markTurnIdle` does not clear it. `executeTurn` (which begins a new user turn) does not clear it. The field persists across `markTurnRunning` of the next turn and is only replaced on the NEXT `completeInteractiveTurn`.

**Consequence**: during the gap between `markTurnIdle` (previous turn ended) and the next user turn's `completeInteractiveTurn` (overwrites it), `lastInteractiveTurnFinishReason` continues to report the **previous** turn's finish reason. If the previous turn ended user-owned (finishReason=`"completed"` with no completion tool), the field still says `"completed"` while the user is waiting — that's the truthful "user owns forward progress" signal.

**However**, the field does NOT distinguish between "previous turn ended user-owned AND no successor scheduled" (Waiting) and "previous turn ended user-owned AND a queued prompt is draining now" (Working — system owns forward progress via the queued drain).

### Q3: Why is `hostInteraction.awaitingFollowup` present in the canonical projection API but never supplied?

`selectors.ts:86-92` defines `projectHostTurnState(model, hostInteraction: { readonly awaitingFollowup: boolean })`:

```ts
export function projectHostTurnState(
    model: TaskModel,
    hostInteraction: { readonly awaitingFollowup: boolean },
): ShadowTurnPhase {
    if (hostInteraction.awaitingFollowup) return "awaiting_followup"
    return projectTurnState(model)
}
```

The signature exists because the canonical projection needs the host-interaction half of the truth table. But the canonical shadow wiring (`apps/vscode/src/sdk/task-state-shadow-host-wiring.ts`) only ever calls `TaskState.projectTurnState(model)` — never `projectHostTurnState`. The wiring has no `hostInteraction` source.

**No producer-side value of `awaitingFollowup` exists today.** The boolean is reserved but never supplied. CLTC01 / CLTCC explicitly rejected a `getRuntimeActivityState: () => "idle" | "active"` shape for the same reason (compressing an 8-state domain to one bit and trying to reconstruct `awaiting_followup` from it).

### Q2 / Q4: During the fresh LIVE `toolCalls 186→190` interval, what would that host-interaction value have been?

Cannot answer from the repo alone — the PTAD capture JSONL is not checked in. To answer Q4 the recon must install the exact-build-head VSIX in a fresh workspace, reproduce the multi-substep gap, and capture both `taskHeaderPresentation` and a fresh `awaitingFollowup` probe value.

**Hypothesis (from architecture, not runtime evidence)**: the LIVE-T1 window has `toolCalls` incrementing AND `legacyPhase === "idle"`. Plausible causes (descending likelihood):

1. **Queued-prompt drain in flight between turns.** `completeInteractiveTurn` ran (set legacy to `awaiting_followup` momentarily, then `markTurnIdle` flipped session.status to idle; the legacy tracker flipped to `"idle"` on the next state-post). A queued prompt is now draining via `PendingPromptsController.drain()` → `runTurn` → `executeTurn` → `markTurnRunning`. Between `markTurnIdle` (previous turn) and `markTurnRunning` (queued drain), `session.status === "idle"` AND `lastInteractiveTurnFinishReason` still equals the previous turn's finish. If the previous turn was user-owned, then `awaitingFollowup === true` (stale-but-truthful for the user's perspective) but the system IS executing more work. The truthful TaskHeader in this instant is `Working` (system owns the queued drain), not `Waiting` — but neither value is recoverable from `awaitingFollowup` alone.

2. **Background command completion events flowing through the canonical stream after the turn ended.** `agent_event(content_start, tool)` for a foreground/background tool continuation that arrived after `markTurnIdle`. `onToolStarted` callback fires → `recordToolStarted` increments. The session is still active (the host hasn't shut it down), so canonical events still flow. `session.status === "idle"` but `toolCalls` ticks. Here `awaitingFollowup` would also be true (stale), and the truthful TaskHeader is "Waiting" — the tool event is the tail of the previous turn, not new forward progress.

3. **Recovery continuation under a non-`completed` finishReason.** If the previous turn ended in `error` / `aborted` / `mistake_limit` / `max_iterations`, the recovery second stage may schedule a follow-up tool call. `toolCalls` would tick. Here `awaitingFollowup` would be `false` (the previous turn did not end user-owned), but the system IS executing more work. The truthful TaskHeader is `Working`, and the stale-finish-reason discriminator would correctly say `false`.

These three cases are not distinguishable from a single `awaitingFollowup` boolean. They are distinguishable only by combining `awaitingFollowup` (stale-but-truthful signal of who last owned forward progress) with **what the system is doing right now** — specifically whether a queued/auto/scheduled successor is in flight or imminent.

### Q5: Is there an existing host-owned "successor scheduled / turn still owned by system" signal for the ambiguous case?

**Partial yes**:

- `session.drainingPendingPrompts: boolean` (active-session field) — true while `PendingPromptsController.drain()` is in flight.
- `session.pendingPrompts.length` — count of queued prompts waiting.
- `session.status: "idle" | "running" | "pending" | "failed" | "cancelled" | "completed"` — host-tracked, mirrors `LocalRuntimeHost.session.status` with a one-tick delay.
- `ActiveSession.isRunning: boolean` — host-side mirror, exposed via `sessions.getActiveSession()?.isRunning`. Flipped at `pending_prompt_submitted` (true) and `turn-complete` / `turn-error` / abort paths (false).

But none of these are currently surfaced as a single "system owns forward progress" signal. The closest existing signal is:

```text
session.isRunning === true
```

This is what I rejected in the previous turn as "the granularity error I already discovered". Let me revisit that.

`session.isRunning` flips to `true` on `pending_prompt_submitted` (sdk-session-event-coordinator.ts:82) and back to `false` in the turn-complete / turn-error handlers (sdk-session-event-coordinator.ts:228, sdk-mode-coordinator.ts:404, sdk-task-control-coordinator.ts:93, sdk-followup-coordinator.ts:184, sdk-session-lifecycle.ts:379/594/606).

Looking at the LIVE-T1 chronology:
- User sends prompt → `pending_prompt_submitted` → `session.isRunning = true`, legacy → `"streaming"`.
- (N iterations, both stay true / streaming)
- Turn completes → `session.isRunning = false` (sdk-session-event-coordinator.ts:228: `this.options.sessions.setRunning(false)`).
- `completeInteractiveTurn` → `markTurnIdle` → `session.status = "idle"` (LocalRuntimeHost side).
- Legacy tracker momentarily `idle`.
- (gap)
- Queued drain → `runTurn` → `pending_prompt_submitted` → `session.isRunning = true`, legacy → `"streaming"`.

So **`session.isRunning` also goes `false → true` at the gap boundary**. It does NOT survive the gap any better than `legacyPhase`.

The reasoning behind my prior rejection was correct: `session.isRunning` is at user-turn granularity (just like `legacyPhase`), not at task-level ownership granularity. It cannot bridge the gap.

### What's actually needed: a hybrid discriminator

The truth table for "who owns forward progress right now" is:

| Legacy tracker | session.isRunning | queued drain / successor | truthful TaskHeader |
|----------------|-------------------|---------------------------|---------------------|
| `streaming` | true | n/a | **Working** (system owns) |
| `awaiting_followup` | false | no queued successor | **Waiting** (user owns) |
| `awaiting_followup` | false | queued drain in flight | **Working** (system owns via queued drain) |
| `idle` | false | no queued successor | **Idle** (gap between user turns) |
| `idle` | false | queued drain in flight | **Working** (gap-bridge case — system owns via queued drain) |
| `compacting` | n/a | n/a | **Compacting** (host override) |
| terminal (completed / error / resumable) | false | n/a | **Complete / Error / Paused** |

The live capture row `toolCalls 186→190, legacy=idle, runtime=idle, shadow=idle` lands in the **last meaningful row** — "gap-bridge case: queued drain in flight".

The cleanest host-owned signal for that row is: **whether a queued-prompt drain is in flight or imminent**. That signal is `session.drainingPendingPrompts === true || session.pendingPrompts.length > 0` (combined with `LocalRuntimeHost.session.agent.canStartRun()` which is true when no run is in flight but queued prompts are drainable).

But: the *gap-bridge row* is precisely the load-bearing one I cannot freeze from architecture alone. I need to reproduce it on a real VS Code host with the diagnostic recording on, observe `taskHeaderPresentation` + `drainingPendingPrompts` + `pendingPrompts.length` + `lastInteractiveTurnFinishReason` + `awaitingFollowup` (if a producer is wired) at the exact instants the user observed `toolCalls` ticking while the header read `Idle`.

## Provisional working-vs-waiting truth table (NOT FROZEN)

The `awaitingFollowup` boolean from the canonical selector signature is reserved but unwired. The host-side signals that exist:

| Host signal | Granularity | Survives gap? | What it means |
|-------------|-------------|---------------|---------------|
| `lastInteractiveTurnFinishReason === "completed"` | per-previous-turn-end | yes (stale through gap) | previous turn ended user-owned; user has not acted yet |
| `lastInteractiveTurnFinishReason` in error/aborted/mistake_limit/max_iterations | per-previous-turn-end | yes | previous turn ended terminal/abnormal; user has not acted yet |
| `session.isRunning` | per-user-turn | **no** (collapses to false at the gap) | a user turn is in flight on the session |
| `session.pendingPrompts.length > 0` AND `session.agent.canStartRun()` | per-queued | yes | a queued prompt will drain imminently unless something else stops it |
| `session.drainingPendingPrompts === true` | per-queued-drain-in-flight | n/a (transient) | a queued drain is currently in flight |

A truthful `awaitingFollowup` producer would be approximately:

```text
awaitingFollowup = (
    lastInteractiveTurnFinishReason === "completed"   // user-owned previous turn
) AND NOT (
    session.pendingPrompts.length > 0                  // queued successor will run
    AND session.agent.canStartRun()                    // session can accept it
) AND NOT (
    session.drainingPendingPrompts === true            // queued drain in flight now
)
```

The truth table for the canonical TaskHeader projection under this discriminator:

| task exists | awaitingFollowup | stronger phase | expected |
|-------------|------------------|----------------|---------|
| yes         | false            | streaming      | Working (system owns via active turn) |
| yes         | false            | none/idle      | Working (system owns via queued drain) |
| yes         | true             | none/idle      | Waiting (user owns; no queued successor) |
| yes         | true             | streaming      | Working (system owns via active turn; older awaitingFollowup stale) |
| terminal    | irrelevant       | completed      | Complete |
| terminal    | irrelevant       | error          | Error |
| terminal    | irrelevant       | resumable      | Paused |
| no task     | false            | none           | Idle |
| n/a         | n/a              | compacting     | Compacting (host override) |

The critical row is **`task exists + awaitingFollowup=false + no stronger phase`** — that's the LIVE-T1 gap-bridge case. The honest answer requires runtime evidence that a queued drain is in fact in flight during the user's observed `toolCalls` tick, not architecture-only inference.

## Why the host-side `awaitingFollowup` must be produced in `LocalRuntimeHost` (or its SdkSessionLifecycle adapter), not in the consumer

The `awaitingFollowup` boolean encodes a host-interaction decision: "given everything the host knows about the session's prior turn and queued successors, who owns forward progress right now?" This decision requires:

1. `lastInteractiveTurnFinishReason` — only the host owns this.
2. `pendingPrompts.length` and `drainingPendingPrompts` — only the host owns these.
3. `session.agent.canStartRun()` — only the runtime/host owns this.

The canonical shadow substrate and the producer-side SdkController cannot compute this from a model alone. The producer must sit at the host-or-session boundary, NOT in `@cline/agents` or the webview.

The natural producer is `SdkSessionLifecycle` (host-side adapter that already wraps the session and exposes `getActiveSession()`). The consumer that needs it is `task-state-shadow-host-wiring` (which already calls back into host-provided `getArbiterSnapshot`).

## What is NOT yet authorized for the successor ACT

1. ❌ Wiring `awaitingFollowup` into the canonical selector. Must wait for runtime evidence.
2. ❌ Adding `forwardProgressOwner` as a new field. Reserved as fallback if recon proves `awaitingFollowup` is insufficient.
3. ❌ Any `isTaskActive`-style task-lifetime bridge (the rejected shape).
4. ❌ Telemetry-derived or message-tail-derived heuristic for the gap-bridge row.

## What IS authorized for the successor ACT

1. ✅ Runtime recon: install the exact-build-head VSIX in a fresh workspace, reproduce the multi-substep gap with PTAD ON, and capture:
   - `taskHeaderPresentation` at the gap instants.
   - `lastInteractiveTurnFinishReason` at the gap instants.
   - `session.isRunning`, `session.status`, `session.pendingPrompts.length`, `session.drainingPendingPrompts` at the gap instants.
   - Whether the `toolCalls` tick during the gap was caused by a queued drain, a recovery continuation, or a stray background command completion.
2. ✅ Once runtime evidence confirms which row(s) of the truth table the LIVE-T1 gap actually falls into, design a producer for `awaitingFollowup` (or its successor concept) on the host boundary.
3. ✅ Wire that producer into `task-state-shadow-host-wiring` so the canonical selector can consult it via `projectHostTurnState`.
4. ✅ Freeze a RED for the LIVE-T1 reproduction using the runtime-captured signals.
5. ✅ Ablate only the new ownership dimension; keep `taskIsActive` as an outer fence if useful.
