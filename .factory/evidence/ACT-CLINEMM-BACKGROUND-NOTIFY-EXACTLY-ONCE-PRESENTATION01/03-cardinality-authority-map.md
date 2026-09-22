# Cardinality Authority Map (Recon)

## Production chain — per-stage cardinality authority

```text
CommandJob terminal commit
    ↓ (exactly-once via `if (job.finalized) return`)
BackgroundNotifyCoordinator terminal consumption
    ↓ (exactly-once via `notificationMarkers.delete(jobId)` BEFORE side effects)
terminal wake creation (formatTerminalWakePrompt)
    ↓ (called once per consumeTerminal for one jobId)
PendingPromptsController.enqueue
    ↓ (pushes one entry; FIFO)
pending prompt consumption (drain / shiftNext)
    ↓ (exactly-once per `drainingPendingPrompts` flag)
agent continuation (runTurn)
    ↓ (exactly-once per drained entry)
assistant completion presentation
    ↓ (?? — this is the seam under investigation)
```

## Per-seam classification

### Seam A — CommandJob lifecycle (C1)

| Aspect | Classification |
|---|---|
| File | `apps/vscode/src/sdk/command-job-manager.ts:2414-2760` |
| Source | `private finalize(job, state, detail)` |
| Guard | `if (job.finalized) return` at line 2419 |
| Resolver | `job.terminalTransitionResolve(...)` at line 2740, set to undefined at 2745 |
| Cardinality | EXACTLY_ONCE |

```ts
// command-job-manager.ts:2740
job.terminalTransitionResolve({
    becameIdle: wasBecomingIdle,
    jobId: job.id,
    terminalState,
})
job.terminalTransitionResolve = undefined
```

The transition promise resolves exactly once: `finalize()` is guarded
by the `job.finalized` flag (set to true at line 2420 BEFORE the
resolver is invoked), and the resolver itself is nulled out after
the single call.

**DX1_TERMINAL_DUPLICATED: REFUTED.**

### Seam B — Notify coordinator (C2, C3, C4)

| Aspect | Classification |
|---|---|
| File | `apps/vscode/src/sdk/background-notify-coordinator.ts:299-399` |
| Source | `consumeTerminal(input)` |
| Marker delete | line 315 (`this.notificationMarkers.delete(input.jobId)`) |
| Enqueue | line 369-390 (held drain) + 381-390 (current) |
| Cardinality | EXACTLY_ONCE_MARKER_CONSUMPTION; AT_MOST_ONE_ENQUEUE_PER_TERMINAL |

The marker deletion is the destructive-read gate (line 315). When
the marker is absent, `consumeTerminal` returns `no_marker` without
side effects (line 313). When the marker exists, the wake is
generated ONCE per consumeTerminal call.

For ONE jobId reaching terminal once:
- `consumeTerminal` is called once (single producer — see Seam C)
- The marker is consumed exactly once
- The wake is enqueued exactly once
- The `held` array contains earlier-held terminal notifications,
  drained FIFO before the current one (the bounded multi-job
  semantics); for a SINGLE job, the held array is empty.

**DX2_NOTIFY_SUBSCRIBER_DUPLICATED: REFUTED.**
**DX3_NOTIFY_CONSUMER_NOT_IDEMPOTENT: REFUTED.**

### Seam C — Tool runner wake consumer attachment (C2 invocations)

| Aspect | Classification |
|---|---|
| File | `apps/vscode/src/sdk/vscode-run-commands-tool.ts:753-809` |
| Source | RUNNING path + `notifyRequested === true` |
| Wake consumer | `start.terminalPromise.then(async () => { ... consumeTerminal ... })` |
| Other `.then()` | lines 857, 915, 968 — all fire `notifyBackgroundStateChange(false, jobId, terminalState)` (projection side, not wake side) |
| Cardinality | SINGLE_WAKE_CONSUMER (line 775) |

The tool attaches the wake consumer at line 775 ONLY when:
1. `start.state === "running"` (genuine background handoff)
2. `context.metadata?.notifyOnCompletion === true`
3. `options.backgroundNotifyCoordinator` is set
4. `options.resolveActiveOwner` is set
5. `owner` resolves to a non-undefined value

The consumer is attached to the `start.terminalPromise` resolved
value, which is a single Promise that resolves ONCE. Multiple
`.then()` on the same Promise all fire from the same single
resolution.

**NOTE**: The terminalPromise has 4 `.then()` attachments:
- line 775: `consumeTerminal` (wake consumer)
- line 857: `notifyBackgroundStateChange(false, jobId, terminalState)` (RUNNING path)
- line 915: `notifyBackgroundStateChange(false, jobId, terminalState)` (terminal early-return, gated by `becameActive`)
- line 968: `notifyBackgroundStateChange(false, jobId, terminalState)` (catch path, gated by `becameActive`)

The three `notifyBackgroundStateChange` calls are projection-side
(terminal-card display) and are NOT wake consumers.

**DX2_NOTIFY_SUBSCRIBER_DUPLICATED: REFUTED.**

### Seam D — PendingPromptsController.enqueue (C5, C6)

| Aspect | Classification |
|---|---|
| File | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:238-259` |
| Source | `enqueue(sessionId, entry)` |
| Side effect | `state.pendingPrompts.push(entry)` + `emitPrompts` + `scheduleDrain` |
| Cardinality | SINGLE_PUSH_PER_CALL |

The push is FIFO; one enqueue produces one array entry. The
`scheduleDrain` queues a microtask to drain when the agent is ready.
This seam is single-writer for any single call site.

For ONE jobId with ONE terminal event:
- `enqueue` is called once (single producer — the
  `enqueueTerminalWake` callback fires once per terminal event)
- `state.pendingPrompts` grows by one

**DX4_WAKE_ENQUEUE_DUPLICATED: REFUTED.**

### Seam E — PendingPromptsController.drain (C7)

| Aspect | Classification |
|---|---|
| File | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:306-354` |
| Source | `drain(sessionId)` |
| Guard | `session.drainingPendingPrompts` flag (line 319, cleared at 342) |
| Side effect | `shiftNext()` removes head, then `deps.send(...)` fires the runTurn |
| Cardinality | SINGLE_DRAIN_PER_PROMPT (FIFO) |

The `drainingPendingPrompts` flag prevents reentrant drains; one
prompt → one `runTurn` call.

**DX5_QUEUE_DELIVERY_DUPLICATED: REFUTED.**

### Seam F — runTurn / AgentRuntime (C8, C9)

| Aspect | Classification |
|---|---|
| File | `sdk/packages/core/src/runtime/host/local-runtime-host.ts` (runTurn) |
| Source | `agent.run()` (the orchestrator) |
| Cardinality | SINGLE_MODEL_TURN_PER_PROMPT |

`runTurn` is the canonical one-prompt-one-turn entry point. One
prompt produces one model turn producing one assistant response.

**DX6_AUTONOMOUS_TURN_DUPLICATED: REFUTED.**

### Seam G — Presentation (C10)

| Aspect | Classification |
|---|---|
| File | `apps/vscode/src/sdk/message-translator.ts:2303-2332` |
| Source | `case "pending_prompt_submitted"` |
| Side effect | `result.messages.push({ ..., say: "user_feedback", text: displayPrompt })` |
| Filter | `isSyntheticUserPrompt(prompt)` (apps/vscode/src/sdk/sdk-user-message-mapping.ts:50-66) |
| Cardinality | ?? |

`isSyntheticUserPrompt` returns `true` ONLY for:
- `normalized.startsWith("[TASK RESUMPTION]")`
- `normalized === ACT_MODE_CONTINUATION_PROMPT` (mode-switch)
- `normalized.startsWith("<hook_context")`

The wake prompt starts with "A background command you asked to be
notified about has reached a terminal state." — NOT in the
synthetic allowlist.

→ When the wake is delivered via `pending_prompt_submitted`, the
message translator PUSHES a `say: "user_feedback"` row with the
wake text as `displayPrompt`. This row IS rendered as a visible
`<UserMessage>` by `apps/vscode/webview-ui/src/components/chat/ChatRow.tsx:1066-1076`.

Then the agent processes the wake and produces its own response,
which renders as a separate assistant text row.

For ONE jobId:
- (A) user_feedback row containing the wake prompt text (rendered
  from `pending_prompt_submitted`)
- (B) assistant text row containing the model's response

Both are visible. C10 = 2. C1..C9 = 1.

**First point where 1 becomes 2 is the PRESENTATION seam.**

**DX7_PRESENTATION_DUPLICATED: CONFIRMED.**

## Causal classification

```text
DX7_PRESENTATION_DUPLICATED

  Cause: `message-translator.ts` renders every
  `pending_prompt_submitted` event as a visible
  `say: "user_feedback"` row when the prompt is not in the
  synthetic allowlist at `sdk-user-message-mapping.ts:50-66`.

  The terminal wake prompt does not match any of the three
  synthetic predicates (`[TASK RESUMPTION]`, ACT_MODE_CONTINUATION,
  `<hook_context`); it therefore leaks to the visible transcript.

  Combined with the agent's own assistant response, the user
  sees TWO distinct completion messages for ONE job.

  Lower layers (terminal lifecycle, coordinator, queue, agent
  turn) are all single-writer per jobId — the cardinality 1
  invariant holds all the way to the presentation seam.
```

## Cardinality trace (one jobId, natural exit)

| Stage | Count | Source-of-truth |
|---|---|---|
| C1 terminal lifecycle commits | 1 | `if (job.finalized) return` guard at `command-job-manager.ts:2419` |
| C2 coordinator consumeTerminal calls | 1 | single `.then()` attachment at `vscode-run-commands-tool.ts:775` |
| C3 notification-marker consumptions | 1 | `notificationMarkers.delete(jobId)` at `background-notify-coordinator.ts:315` |
| C4 generated terminal wake prompts | 1 | single call site at `background-notify-coordinator.ts:381-390` |
| C5 PendingPrompts enqueue operations | 1 | `enqueueTerminalWake` callback at `SdkController.ts:706-744` |
| C6 pending_prompts queue entries | 1 | FIFO push at `pending-prompt-service.ts:256` |
| C7 pending prompt submissions / drains | 1 | `drainingPendingPrompts` guard at `pending-prompt-service.ts:319` |
| C8 autonomous runTurn invocations | 1 | single call site at `pending-prompt-service.ts:322` |
| C9 resulting model turns | 1 | one prompt → one `agent.run()` |
| **C10 visible completion messages** | **2** | **wake echo as `user_feedback` + agent's assistant response** |

## Required repair

DX7 is the least dangerous branch (per ACT §11). The repair is:

1. Add a synthetic-prompt predicate that matches the terminal wake
   format (e.g., recognize the bounded-output delimiters as a
   synthetic prompt marker).
2. When `pending_prompt_submitted` carries a wake prompt, the
   message translator MUST filter the visible row (same as
   `[TASK RESUMPTION]` / `ACT_MODE_CONTINUATION_PROMPT`).
3. The agent's assistant response REMAINS the single
   user-visible completion message.

This is the smallest possible diff and does NOT touch:
- CommandJobManager
- BackgroundNotifyCoordinator terminal logic
- PendingPromptsController FIFO
- runTurn / AgentRuntime
- Hub ordering machinery

## P1 correction (review feedback)

The first-pass predicate matched `<bounded-output>` OR
`</bounded-output>` alone, which would have hidden legitimate user
prompts that happen to mention either delimiter (e.g., a user
explaining HTML/XML). The predicate was narrowed to a conjunctive
fingerprint — the formatter-owned prefix
`BACKGROUND_TERMINAL_WAKE_PROMPT_PREFIX` (exported from
`apps/vscode/src/sdk/background-notify-coordinator.ts:52-67`,
referenced by `formatTerminalWakePrompt` and the predicate alike)
AND both bounded-output delimiters. The conjunctive form CANNOT
match any user prompt that does not start with the formatter-owned
prefix. Conservation tests BCNEX-P1-01..03 pin this.
