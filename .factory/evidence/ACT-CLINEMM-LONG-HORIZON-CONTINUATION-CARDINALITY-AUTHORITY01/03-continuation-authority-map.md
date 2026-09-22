# 03 — Continuation Authority Map

The full inventory of every production source capable of starting another
model turn for one `(sessionId, taskId, jobId)`. Used to drive the
C1..C10 capture instrumentation in this ACT.

## C1 — terminal_committed

- **File / line**: `apps/vscode/src/sdk/command-job-manager.ts:2643`
- **Trigger**: `CommandJobManager.finalize` commits `command_job_terminal_committed`
  AFTER the active-map delete.
- **Identity**: jobId is the canonical terminal-fact identity.
- **Calls runTurn**: NO.
- **Can fire after submit_and_exit**: YES (the LIVE bug case).

## C2 — notify_consume_enter

- **File / line**: `apps/vscode/src/sdk/background-notify-coordinator.ts:389`
  (`BackgroundNotifyCoordinator.consumeTerminal`).
- **Trigger**: per-job terminal transition from `CommandJobManager`'s
  lifecycle event bus.
- **Identity**: jobId.
- **Calls runTurn**: NO.

## C3 — wake_created

- **File / line**: `apps/vscode/src/sdk/background-notify-coordinator.ts:459`
  (held-batch) and `:487` (current-terminal) — both inside
  `consumeTerminal` immediately after `formatTerminalWakePrompt` +
  `options.enqueueTerminalWake`.
- **Trigger**: `BackgroundNotifyCoordinator` decides the wake is
  deliverable (Path A: no remaining notify jobs).
- **Identity**: jobId + sessionId + taskId.
- **Calls runTurn**: NO (transports to the queue).

## C4 — pending_prompt_enqueued

- **File / line**: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`
  `PendingPromptsController.enqueue` (capture hook `onEnqueue`).
- **Trigger**: wake callback / explicit user follow-up.
- **Identity**: sessionId + promptId (+ jobId when supplied by host).
- **Calls runTurn**: NO (queues for drain).

## C5 — pending_prompt_dequeued

- **File / line**: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`
  `PendingPromptsController.drain` (capture hook `onBeforeDrain`).
- **Trigger**: the queue controller destructively shifts the next
  entry off the queue (i.e. the dequeue moment, NOT the dispatch).
- **Identity**: sessionId + promptId (+ jobId when supplied by host).
- **Fires per shift**: YES (exactly once per `service.shiftNext(...)`
  non-empty result). A re-entry into the drain loop for the SAME
  entry is NOT possible; if `send()` fails the entry is `requeueFront`'d
  and a fresh `shiftNext` is required to dequeue it again.
- **Calls runTurn**: NO. (Dispatches via `this.deps.send(...)` which
  in turn calls `runTurn`; that fires C7.)

## C6 — continuation_scheduled

- **File / line**: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`
  `PendingPromptsController.drain` (capture hook `onBeforeDispatch`).
- **Trigger**: the queue controller is about to actually invoke
  `this.deps.send(...)` to start the next autonomous turn.
- **Independence**: structurally distinct from C5 — it is the
  IMMEDIATELY-PRECEDING observation seam. A duplicate dispatch path
  (two sends for one shifted entry, e.g. an upstream code path that
  re-enters `send` for the same shifted entry) crosses C6 twice while
  C5 still fires exactly once.
- **Identity**: sessionId + promptId + origin + jobId.
- **Calls runTurn**: yes (via `this.deps.send(...)`).

## C7 — run_turn_started

- **File / line**: `sdk/packages/core/src/runtime/host/local-runtime-host.ts`
  `LocalRuntimeHost.runTurn` (capture hook `onRunTurnStarted`).
- **Trigger**: every actual autonomous turn start (NOT for the
  queue/steer short-circuit, but the short-circuit is captured at C4
  instead).
- **Origin derivation** (post P0 fix): the host derives
  `origin` from `input.delivery`:
    - `queue`   → `pending_prompt_drain`
    - `steer`   → `deferred_continuation`
    - undefined → `explicit_user`
- **Identity**: sessionId + delivery + origin + jobId.

## C8 — agent_turn_done

- **File / line**: `sdk/packages/core/src/runtime/host/local-runtime-host.ts`
  `LocalRuntimeHost.runTurn` after `executeTurn` resolves (capture
  hook `onAgentTurnDone`).
- **Trigger**: agent turn finish (any finishReason).
- **Origin derivation**: same as C7 (post P0 fix).
- **Identity**: sessionId + finishReason + delivery + origin + jobId.

## C9 — submit_and_exit_seen

- **File / line**: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:499`
  (inside `wasTerminalResponseCommittedThisTurn()` branch).
- **Trigger**: completion tool's terminal response committed AND
  turn-end path is promoting phase.
- **Identity**: sessionId + taskId.

## C10 — task_completion_committed

- **File / line**: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:566`
  (the `setTurnPhase("completed", ...)` call site).
- **Trigger**: completion commit seam (the canonical phase transition).
- **Identity**: sessionId + taskId.
