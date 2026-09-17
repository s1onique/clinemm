# ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-POST-RESULT-CONTINUATION-RECON01 — §1 Source-Seam Map

> Scope: post-`RESULT_EXISTS`-session-event continuation scheduling.
>
> Recurring evidence chain from predecessor ACTs:
>
> ```text
> tool execution / waiter hypothesis
>     -> NOT_REPRODUCED              (RECON01, closed)
>
> RESULT_EXISTS publication / fanout
>     -> GREEN                       (RECON02, closed)
>     -> SdkMessageCoordinator.appendAndEmit
>     -> registered session-event fanout CONSERVED
>
> continuation scheduling
>     -> UNKNOWN                     (this ACT, RECON01 of the runtime-task-progression epic)
> ```
>
> Owner: `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`
>
> Predecessor: `ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02` (CLOSED GREEN
> at `[1]->[3]` CONSERVED; first untested boundary = continuation
> scheduling at `[5]`; handoff = RUNTIME_TASK_PROGRESSION).
>
> Parallel operator-gated lane (NOT in scope of this ACT):
> `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`
> (`HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND`).

## Chain (continues from RECON02's chain, frozen at the session-event consumer)

```text
RESULT_EXISTS                                    <- frozen entry seam (predecessor)
  |
[1] result publication         -> SdkMessageCoordinator.appendAndEmit
  |
[2] conversation append         -> MessageStateHandler.addMessages
  |
[3] session-event emission      -> SdkMessageCoordinator.emitSessionEvents
                                  registered listeners:
                                    - WebviewGrpcBridge.createListener
                                      -> ONLY pushes messages to webview
                                      -> NO continuation-scheduling logic
                                  AND (parallel SessionOptions path):
                                    - SdkSessionEventCoordinator.handleSessionEvent
                                      -> drives UI-side turn-phase transitions
                                      -> DOES NOT call into AgentRuntime.execute
  |
[4] session-runtime receives legacy agent event
                                  -> AgentEventBridge -> CoreSessionEvent
                                  -> LocalRuntimeHost.subscribe fans out
                                  -> SessionRuntimeOrchestrator.handleRuntimeEvent
                                     translates AgentRuntimeEvent -> legacy
                                     -> emits to SdkSessionEventCoordinator
  |
[5] continuation scheduling       -> NOT a session-event consumer
                                  -> lives INSIDE AgentRuntime.execute()
                                     -> executeToolCalls() at line 1455
                                     -> emits `message-added` (tool-result)
                                     -> emits `turn-finished` at line 1483
                                     -> LOOP continues at line 1366
                                        while (... iteration < maxIterations)
                                            -> generateAssistantMessageWithOverflowRecovery
                                            -> model stream
                                            -> next tool call OR run finish
                                  -> continuation is SYNCHRONOUS-IN-AWAIT:
                                     no scheduler, no queue, no token
  |
[6] TurnState transition         -> SdkSessionEventCoordinator.setTurnPhase
                                  driven by SDK events (pending_prompt_submitted,
                                  turnComplete, sessionEnded); NOT driven by
                                  AgentRuntime continuation
  |
[7] provider / model response    -> AgentModel.stream
                                  [OUT-OF-SCOPE: provider epic]
  |
[8] UI projection                -> WebviewGrpcBridge.handleSessionEvent +
                                  getStateToPostToWebview +
                                  activity-publication-v1.ts
```

## Boundary inventory (Q1-Q10)

### [3] session-event consumer — production listener

- **Production class:** `WebviewGrpcBridge`
  (`apps/vscode/src/sdk/webview-grpc-bridge.ts:33`).
- **Registered via:** `SdkController` constructor at
  `apps/vscode/src/sdk/SdkController.ts:1630`
  (`this.onSessionEvent(this.grpcBridge.createListener())`).
- **Method body:** `handleSessionEvent(messages, event)`
  (`webview-grpc-bridge.ts:69`):
  1. For each message: `pushPartialMessage(message)`
     (`webview-grpc-bridge.ts:71-73`).
  2. If event is `ended` or `done`/`error`: `pushStateUpdate()`
     (`webview-grpc-bridge.ts:78-87`).
- **Continuation logic in this consumer:** NONE.
- **Internal state:** `getStateFn` callback; `MessageTranslatorState`
  (constructed in SdkController, attached to bridge through the
  callback).

### [3'] session-event consumer — controller-side event handler

- **Production class:** `SdkSessionEventCoordinator`
  (`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:45`).
- **Registered via:** `SdkController` constructor at
  `apps/vscode/src/sdk/SdkController.ts:1084-1088`
  (`sessionOptions.onSessionEvent: (event) => { this.sessionEvents.handleSessionEvent(event)... }`).
- **Continuation logic in this handler:** NONE — only turn-phase
  promotion. Continuation is owned by the inner runtime loop, not by
  this event handler.
- **Method body summary:** translate event -> `TranslationResult` ->
  capture telemetry -> `appendAndEmit` -> if turnComplete set
  phase -> mark session idle -> post state. (Full §1 inventory
  exhaustively documented in
  `.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02/source-seam-map.md`
  lines 56-117 for the session-event consumer shape.)

### [5] continuation scheduling — runtime loop

- **Production class:** `AgentRuntime`
  (`sdk/packages/agents/src/agent-runtime.ts:836`).
- **Public surface:** `run(input)` / `continue(input)` at
  `agent-runtime.ts:854,858`; both delegate to `execute(input)`
  (`agent-runtime.ts:1304`).
- **Continuation mechanism (loop head, line 1366):**
  ```ts
  while (
      this.config.maxIterations === undefined ||
      this.state.iteration < this.config.maxIterations
  ) {
      this.throwIfAborted();
      this.state.iteration += 1;
      await this.emit({ type: "turn-started", ... iteration: this.state.iteration });
      const { message, finishReason } =
          await this.generateAssistantMessageWithOverflowRecovery();
      // ...
      const toolMessages = await this.executeToolCalls(toolCalls);
      for (const toolMessage of toolMessages) {
          this.state.messages.push(toolMessage);
          await this.emit({ type: "message-added", ... message: toolMessage });
      }
      // ...
      await this.emit({ type: "turn-finished", ... });
      // ... (no `if` between turn-finished and the next iteration
      //      UNLESS findCompletingToolMessage / completion reminder
      //      branch fired)
  }
  ```
- **Q3 (synchronous / queued / event-driven / state-driven):**
  **SYNCHRONOUS-IN-THE-AWAIT-SENSE** — `await generateAssistant...`
  and `await executeToolCalls` and `await this.emit` are awaited in
  order inside the same task; the next iteration is a direct
  invocation, not an event subscription or queue dispatch. There is
  no continuation scheduler, no continuation-token, no event-driven
  re-arming.
- **Q4 (gates that suppress continuation):**
  - `state.abort` (via `throwIfAborted()` at line 1370)
  - `maxIterations` ceiling (line 1366-1369)
  - `finishRun("completed")` invocation at line 1445 (no tool calls,
    no completion reminder pending) — terminal exit
  - `finishRun("completed")` invocation at line 1494 (terminal tool
    message, e.g. `attempt_completion`) — terminal exit
  - Thrown `ControlledStopError` (line 1582) /
    `ContextWindowOverflowError` (line 1639) / generic error
    (line 1386,1423,1426) — terminal exit via `catch` block
    (line 1517-1601)
  - `recoverySecondStage.kind === "terminating"` latching
    (handled in tool batch path; not at the loop head, but enforced
    through `await this.executePreparedTool` batch logic)
  - `MistakeTracker.action === "stop"` aborts the runtime via
    `SessionRuntimeOrchestrator.inspectLoopForToolCall`
    (`session-runtime-orchestrator.ts:1471`) and
    `enqueueMistakeRecord`
- **Q5 ("result accepted, continuation not yet scheduled"):** the
  runtime has no such state. The transition from tool execution
  result to next-iteration model request is implicit and immediate
  in the while-loop body — there is no "scheduled but not yet
  entered" state observable from outside.
- **Q6 ("continuation scheduled but not yet entered"):** N/A by
  construction (no scheduler). The closest observable boundary is
  the `tool-finished` AgentRuntimeEvent emission at
  `agent-runtime.ts:1963-1978` (after the next `executeToolCalls`
  completes), which is the LAST event before the next `turn-started`
  event. The `turn-started` event at
  `agent-runtime.ts:1374-1377` is the FIRST event of the next
  iteration.
- **Q7 (TurnState change relative to continuation):** TurnState is
  NOT changed by `AgentRuntime.execute`. It is changed by
  `SdkSessionEventCoordinator.handleSessionEvent` in response to
  legacy `done`/`error`/`session_ended` events (which the runtime
  emits at the end of a run, NOT during continuation).
- **Q8 (diagnostics):**
  - `turnStateTracker` (apps/vscode/src/sdk/turn-state-tracker.ts:22)
    captures `writerId`, `taskId`, `epoch`,
    `previous.{phase,seq,anchorTs}`, `committed.{phase,seq,anchorTs}`
    per write. Phase transitions happen in
    `SdkSessionEventCoordinator.setTurnPhase` on session-event side,
    not on continuation side.
  - `agentRuntime.subscribe` (AgentRuntimeEvent stream) emits
    `turn-started`, `tool-started`, `tool-finished`,
    `turn-finished`, `run-started`, `run-finished`, `run-failed`,
    `usage-updated`, `message-added`, `assistant-message`,
    `status-notice`. Continuation is visible as
    `turn-started { iteration: N+1 }` AFTER
    `turn-finished { iteration: N, toolCallCount: K }`.
- **Q9 (can a production callback return successfully without
  scheduling anything):** YES — the `if (toolCalls.length === 0)`
  branch at line 1430-1452 emits `turn-finished` and returns via
  `finishRun("completed")`. This is the GREEN exit. The RED state we
  are hunting is: toolCalls.length > 0, tool execution produces
  toolMessages, toolMessages are appended + emitted,
  `turn-finished` is emitted, AND the while loop exits without
  entering the next iteration OR emitting `turn-started` for
  iteration+1.
- **Q10 (smallest real production function that owns the
  decision):** `AgentRuntime.execute()` at
  `sdk/packages/agents/src/agent-runtime.ts:1304`. The while-loop
  body at line 1366 is the loop head.

## Existing tests covering this seam

- `sdk/packages/agents/src/agent-runtime.test.ts:707-784` —
  `injects a pending user message after tool results and before the
  next model request`. This is the closest existing test:
  `ScriptedModel` emits `tool-call-delta` for the echo tool,
  `finish: "tool-calls"`, second step receives the tool message +
  the pending-user-message in the request, then emits
  `finish: "stop"`. Asserts `model.requests === 2`, result status
  `completed`, output text `"steered done"`. **This is the canonical
  proof that the inner loop iterates after a tool result is
  appended.** It pins the GREEN path under
  `consumePendingUserMessage` (steering).
- `sdk/packages/agents/src/agent-runtime.test.ts:672-705` —
  `runs a tool and then completes the run` (without steering). Same
  shape without `consumePendingUserMessage`. Asserts
  `model.requests === 2`, `result.status === "completed"`,
  `result.outputText === "done"`. **This is the exact prototype for
  the discriminator.**
- `sdk/packages/agents/src/agent-runtime.test.ts:539-647` — early
  iterations of tool-call runs (recovery-qualification suite).
- `sdk/packages/agents/src/agent-runtime.outcome-integration.test.ts`
  — tool outcome classification during continuation.
- `apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts` —
  coordinator-side turn-phase promotion (UI seam, NOT
  continuation).

## Discriminator choice (Q5/Q10 contract)

The smallest owned boundary is the `AgentRuntime.execute()`
while-loop body. The discriminator is a single production-seam test
that:

1. Drives a real `AgentRuntime.run("...")` with a scripted
   `AgentModel` and a real `AgentTool`.
2. The model emits one tool-call, then `finish: "tool-calls"`, then
   on the second step emits text + `finish: "stop"`.
3. The tool is the existing `createEchoTool()` factory pattern from
   `agent-runtime.test.ts:58-65` (no copy, no extraction — reuse the
   production-shaped `AgentTool` declaration).
4. Asserts that the runtime:
   - reaches `completed` status (NOT `failed`),
   - emits at least one `turn-started { iteration: 1 }` and at
     least one `turn-started { iteration: N>1 }`,
   - calls `model.stream(...)` at least twice (bookkeeping proxy,
     non-strict),
   - in a subsequent model request, the tool message appears in
     the request's `messages` array (assertion of post-tool-result
     continuation into the model loop; semantic invariant).

Forbidden success oracles (per §5 contract; reviewer's CORRECTION01
strengthens this):

- exact listener cardinalities (we observe the runtime's
  AgentRuntimeEvent surface, not user-facing listener counters).
- exact internal counter values.
- exact object identity.
- exact number of TurnState writes.
- exact `runResult.iterations` (reviewer P1: a future valid runtime
  may perform an extra internal iteration / recovery / compaction
  pass that reuses the `AgentRuntime.execute()` machinery; cf.
  upstream #12388; freezing the count would over-fit the prototype).

Allowed semantic success oracle (CORRECTION01):

- The runtime's internal loop actually iterated past the
  tool-result publication: a subsequent model request received the
  tool message (`continuationObserved` causal flag flipped by the
  second scripted step via `findLast(m.role === "tool")` +
  `toMatchObject({type: "tool-result", toolCallId})`) and the
  runtime reached `runResult.status === "completed"`.

## What is NOT observable (intentional gaps to keep this ACT scoped)

- Whether the runtime ever silently drops the tool result into the
  conversation store without producing a continuation. **Test seam:
  assert the SECOND model request received the tool-result message;
  if the runtime dropped the tool result, the request transcript
  would not contain it.**
- Whether the runtime latches into a `terminating` second-stage
  recovery state without re-entering the loop. **Test seam:
  `model.requests.length === 2` is the GREEN exit; if the loop
  bails to `finishRun("failed")` or latches, the second request
  never fires.**
- Whether an `onToolRuntimeOutcome` observer throwing suppresses the
  next iteration. **Test seam: out of scope — no observers
  installed in the discriminator; the GREEN path has none.**
- Whether the `pendingHookContexts` append path breaks the loop
  counter. **Test seam: GREEN path has no hooks; the GREEN exit is
  independent of hook plumbing.**
- Whether the upstream CLI `afterRun` capability hang (#13380)
  applies. **Test seam: irrelevant — this is the VSCode-only
  AgentRuntime inner loop, and there is no afterRun capability
  request in the discriminator path. #13380 is RADAR only.**

## Inventory metadata

```text
HEAD: 610091e584b9ed10132a51f18423a19a5046fd0c
file: .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-POST-RESULT-CONTINUATION-RECON01/source-seam-map.md
inventory author: ACT opening (this turn;
                  CORRECTION01 oracle-strengthening per reviewer P1)
next step: §2 single-probe discriminator
  (sdk/packages/agents/src/agent-runtime.task-progression-post-result-continuation-recon01.test.ts,
   REAL_PRODUCTION_SEAM via real AgentRuntime + real AgentTool + scripted AgentModel;
   COMPOSED_EVIDENCE = SYNTHETIC_REAL through REAL_PRODUCTION_SEAM)
parallel front: ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
  (operator-gated; NOT blocking this ACT)
```
