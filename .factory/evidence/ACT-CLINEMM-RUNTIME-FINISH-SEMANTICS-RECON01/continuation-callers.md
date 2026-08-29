# ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01 — Continuation Owners

ACT_ID: ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01
Authored at: ENTRY_HEAD = 6ecf546f84b6593904357d198c56aadd89fe2a85
Label: STRUCTURAL (full source walk)

------------------------------------------------------------------------
§0 Inventory
------------------------------------------------------------------------

Every call site in production code that invokes:

  - session.agent.run(...)
  - session.agent.continue(...)
  - runtime.run(...)
  - runtime.continue(...)
  - pendingPromptsController.drain(...)
  - session.agent.canStartRun() (the gate)

Classified by ownership category:
  USER_OWNED          = explicit user gesture (button click / keystroke / queue submission)
  HOST_OWNED          = programmatic host-driven continuation without user gesture
  INTERNAL_RECOVERY   = automatic internal bookkeeping (mistake limit, loop detector)
  TEAM_ONLY           = multi-agent/team coordination only
  TOOL_FLOW           = triggered by a tool result returning further work
  OTHER               = anything not classified above

  ADDS_USER_MESSAGE = YES|NO    (does the call site add a user-role message?)
  CAN_CONTINUE_WITHOUT_USER_INPUT = YES|NO (does it require a queued/external prompt?)
  AVAILABLE_AFTER_STATUS_COMPLETED = YES|NO (can it be invoked once a run finished?)
  USED_BY_VSCODE_HOST = YES|NO (does the local-vs-code host code path use it?)

------------------------------------------------------------------------
§1 Caller table
------------------------------------------------------------------------

CALLER ID: LOCAL_HOST_EXECUTE_AGENT_TURN
  File:   sdk/packages/core/src/runtime/host/local-runtime-host.ts
  Lines:  1961-2009 (success), 2010-2038 (catch)
  Code:   const runFn = shouldContinue
              ? () => session.agent.continue(prompt, userImages, userFiles)
              : () => session.agent.run(prompt, userImages, userFiles);
          const result = await this.runWithAuthRetry(session, runFn, baselineMessages);
  Ownership:   USER_OWNED (always — this is reached only from runTurn with a prompt)
  ADDS_USER_MESSAGE = YES (always — prompt is passed in)
  CAN_CONTINUE_WITHOUT_USER_INPUT = NO (a prompt is REQUIRED)
  AVAILABLE_AFTER_STATUS_COMPLETED = YES (runTurn's post-completion drain
                                          will eventually re-enter via the queue)
  USED_BY_VSCODE_HOST = YES (the ONLY entry point)

CALLER ID: SESSION_RUNTIME_ORCHESTRATOR_INTERNAL_RUN
  File:   sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
  Lines:  996-1000
  Code:   if (input.isContinue) {
              runResult = await runtime.continue(undefined);
          } else {
              runResult = await runtime.run("");
          }
  Ownership:   TOOL_FLOW (the orchestrator is invoked by LocalRuntimeHost with
                  a prompt that has already been prepared; the actual user input
                  arrived via LocalRuntimeHost.runTurn, not here)
  ADDS_USER_MESSAGE = NO (empty string / undefined passed to runtime)
  CAN_CONTINUE_WITHOUT_USER_INPUT = YES (the runtime receives empty input)
  AVAILABLE_AFTER_STATUS_COMPLETED = YES (orchestrator is reusable per-run)
  USED_BY_VSCODE_HOST = YES (transitively, via LocalRuntimeHost)

CALLER ID: PENDING_PROMPTS_CONTROLLER_DRAIN
  File:   sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts
  Lines:  306-360 (drain method)
  Trigger call sites:
    sdk/packages/core/src/runtime/host/local-runtime-host.ts:1041-1043
        queueMicrotask(() => { void this.pendingPromptsController.drain(input.sessionId); });
    sdk/packages/core/src/runtime/host/local-runtime-host.ts:1907-1909
        queueMicrotask(() => { void this.pendingPromptsController.drain(session.sessionId); });
    sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:223 (in update)
    sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:234 (in delete)
    sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:258 (in enqueue)
    sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:301-303 (in scheduleDrain)
  Code:
      async drain(sessionId: string): Promise<void> {
          const session = this.deps.getSession(sessionId);
          if (!session) return;
          if (session.aborting || session.drainingPendingPrompts) return;
          if (!session.agent.canStartRun()) return;
          const { entry: next } = this.service.shiftNext(session);
          if (!next) return;
          this.emitPrompts(session);
          this.emitSubmitted(session, next);
          session.drainingPendingPrompts = true;
          try {
              const result = await this.deps.send({
                  sessionId,
                  prompt: next.prompt,
                  ...,
              });
              ...
          }
      }
  Ownership:   USER_OWNED (the queue only has entries the user explicitly enqueued)
  ADDS_USER_MESSAGE = YES (next.prompt is sent via deps.send → runTurn)
  CAN_CONTINUE_WITHOUT_USER_INPUT = NO (queue must be non-empty)
  AVAILABLE_AFTER_STATUS_COMPLETED = YES (drain fires after EVERY non-error run completion;
                                          at line 1041 it triggers when finishReason !== "error")
  USED_BY_VSCODE_HOST = YES (transitively, via LocalRuntimeHost.runTurn)

CALLER ID: AGENT_RUNTIME_CONSUME_PENDING_USER_MESSAGE
  File:   sdk/packages/shared/src/agents/types.ts:944 (callback declaration)
          sdk/packages/agents/src/agent-runtime.ts (consumePendingUserMessage usage)
  Purpose: Optional callback invoked at the top of each agent loop iteration
           (after the first). If it returns a non-empty string, that string
           is injected as a user message into the conversation before the next API call.
  Ownership:   HOST_OWNED (the runtime pulls a user message from the host each iteration)
  ADDS_USER_MESSAGE = YES (when the callback returns non-empty)
  CAN_CONTINUE_WITHOUT_USER_INPUT = PARTIAL (can supply a fake "continue" prompt but
                                           that's a HOST_OWNED injection mechanism)
  AVAILABLE_AFTER_STATUS_COMPLETED = YES (each iteration, post-status)
  USED_BY_VSCODE_HOST = NO (the LocalRuntimeHost does NOT wire this callback; see comment
                            below)
  Note:        This is THE supported HOST_OWNED continuation primitive in the
               AgentRuntime API. The ClineMM host does NOT use it. The LocalRuntimeHost
               uses pendingPromptsController.drain instead, which is a USER_OWNED queue.

CALLER ID: TEAM_ONLY_SPAWN_AGENT_TOOL
  File:   sdk/packages/core/src/extensions/tools/team/multi-agent.ts:267-271
  Code:   try {
              ...
              this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, result });
              return result;
          }
  Ownership:   TEAM_ONLY (multi-agent/team coordination)
  USED_BY_VSCODE_HOST = NO (orchestration-only path)

CALLER ID: TEAM_SESSION_COORDINATOR_CAN_AUTO_CONTINUE
  File:   sdk/packages/core/src/session/team/team-session-coordinator.ts:176-180
  Code:   const canAutoContinue =
              finishReason === "completed" || finishReason === "max_iterations";
          if (!canAutoContinue) {
              return false;
          }
  Ownership:   TEAM_ONLY (only used inside team coordinator; never reaches the local-vs-code path)
  USED_BY_VSCODE_HOST = NO

CALLER ID: CLI_AGENT_EXAMPLE_RUN_CONTINUE
  File:   apps/examples/cli-agent/src/index.ts:87-89
  Ownership:   USER_OWNED (interactive REPL; user types messages)
  USED_BY_VSCODE_HOST = NO (example only)

------------------------------------------------------------------------
§2 Central question: HOST_OWNED_AUTONOMOUS_CONTINUE_EXISTS = ?
------------------------------------------------------------------------

The question: after a run returns status="completed" WITHOUT adding a
new user message, can the host trigger another provider iteration
without inventing a fake user prompt?

ANSWER: NO — not on the live ClineMM host path.

Evidence:

  - The only HOST_OWNED continuation primitive in the AgentRuntime API
    is `consumePendingUserMessage` (AgentConfig.consumePendingUserMessage,
    declared at sdk/packages/shared/src/agents/types.ts:944). This callback
    lets the runtime pull a user message from the host each iteration.
    The host could in principle return a synthetic "continue" prompt
    here without an explicit user gesture.

  - HOWEVER, the LocalRuntimeHost does NOT wire this callback. The
    ClineMM host has chosen to use the pendingPromptsController.drain
    queue exclusively. That queue is USER_OWNED — it only contains
    entries the user explicitly enqueued (via sendToActiveSession /
    PendingPromptsController.enqueue).

  - The remaining continuation sites (orchestrator.run("") /
    orchestrator.continue(undefined)) are NOT HOST_OWNED continuations
    of a completed run — they are TRANSPORT: they forward a runTurn
    request into the AgentRuntime. LocalRuntimeHost.runTurn is itself
    USER_OWNED (the user's keystroke / button click invokes it).

Therefore:

  HOST_OWNED_AUTONOMOUS_CONTINUE_EXISTS = NO

  (the API supports one, the host does not wire it; the host has only
   a USER_OWNED queue)

This is NOT necessarily a bug. The host may legitimately choose to
require user approval before every autonomous continuation. The OWN01
bug does NOT depend on this choice — OWN01 is about the runtime
emitting status="completed" for a non-semantic stop, NOT about the
host failing to invoke a continuation primitive.

------------------------------------------------------------------------
§3 RFS04 (continuation characterization probe)
------------------------------------------------------------------------

PROBE PURPOSE: after a run that returns status="completed" WITHOUT
adding a new user message, invoke the actual supported continuation
primitive if source says that is legal. Capture: whether another
provider iteration starts, whether messages are preserved, whether a
synthetic user message is added, whether task can progress autonomously.

OUTCOME: NOT_EXECUTABLE.

WHY:
  - The supported primitive is consumePendingUserMessage (HOST_OWNED).
  - The host does NOT wire this callback on the live path.
  - To execute RFS04, one would need to (a) invent the callback's
    semantics, (b) re-architect the host, or (c) use a fake user
    message — all FORBIDDEN by the ACT constraints.

MARK: HOST_AUTOCONTINUE_PROBE = NOT_REPRESENTABLE
      (the live host has no HOST_OWNED continuation primitive wired)
