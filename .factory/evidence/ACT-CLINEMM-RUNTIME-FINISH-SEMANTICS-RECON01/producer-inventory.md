# ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01 — Producer Inventory

ACT_ID: ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01
Authored at: ENTRY_HEAD = 6ecf546f84b6593904357d198c56aadd89fe2a85
Label: STRUCTURAL (every producer below was located by source walk; no live-trace event capture)

------------------------------------------------------------------------
§0 Two enums, three reachable sets
------------------------------------------------------------------------

The runtime layer has TWO separate enums.

AgentRunStatus (sdk/packages/shared/src/agent.ts:144-149) — internal runtime-result:
    "idle" | "running" | "completed" | "aborted" | "failed"

AgentFinishReason (sdk/packages/shared/src/agents/types.ts:589-594) — public, on
AgentDoneEvent (types.ts:239-249):
    "completed" | "max_iterations" | "aborted" | "mistake_limit" | "error"

The translation from AgentRunStatus → AgentFinishReason is one-to-one on the
canonical "3 reachable values" subset:
    sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts:124-135
    function statusToLegacyFinishReason(status: "completed"|"aborted"|"failed")
      → "completed" | "aborted" | "error"

The same 3-value collapse exists in:
    sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1570-1584
    function deriveFinishReason(runResult: AgentRunResult|undefined)

And in the hub-host:
    sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts:534-567
    function doneEventFromPayload — uses isAgentFinishReason check + a special-case
    that maps "failed" → "error" and ANY non-AgentFinishReason → "completed" (line 546-548)

DEAD ENUM VALUES at production emission: max_iterations and mistake_limit
are STRUCTURALLY unreachable in AgentDoneEvent.reason through the normal
adapter / orchestrator / hub-host paths. They are NOT mapped in
statusToLegacyFinishReason, NOT mapped in deriveFinishReason, NOT handled by
doneEventFromPayload. Confirmed by exhaustive matches on `case "max_iterations":`
in production:
    sdk/packages/core/src/runtime/host/local-runtime-host.ts:1840-1841
      case "max_iterations":
      case "mistake_limit":
        return "cancelled";
This is in resolveInteractiveStopStatus (line 1830-1847), which is a SessionStatus
derivation, NOT a finish-reason derivation. The string "cancelled" here is the
*SessionStatus* on the host, NOT the *AgentFinishReason* on the AgentDoneEvent.

Likewise in cli/AC/desktop-app:
    apps/cli/src/acp/acpAgent.ts:933-935
        case "max_iterations": return "max_turn_requests";
        case "mistake_limit":  return "cancelled";
    apps/examples/desktop-app/webview/hooks/chat-session/types.ts:85-90
        (uses the full AgentFinishReason type, but no production site emits
        max_iterations or mistake_limit)

------------------------------------------------------------------------
§1 Every reachable AgentRunResult.status === "completed" producer
------------------------------------------------------------------------

PRODUCER ID: COMPLETION-TOOL-AUTHORITY
  File:   sdk/packages/agents/src/agent-runtime.ts
  Lines:  1397-1414
  Trigger: A successful tool call whose lifecycle.completesRun === true
           (line 2451 — the findCompletingToolMessage predicate)
           Currently ONLY submit_and_exit satisfies this predicate in the
           built-in tool set (sdk/packages/core/src/extensions/tools/definitions.ts:1035-1038).
  Code:
      const terminalToolMessage = this.findCompletingToolMessage(toolCalls, toolMessages);
      if (terminalToolMessage) {
          const result = this.finishRun("completed", finalAssistantMessage,
              textFromToolMessage(terminalToolMessage) || undefined);
          await this.callAfterRunHooks(result);
          await this.emit({ type: "run-finished", snapshot: this.snapshot(), result });
          return result;
      }
  REQUIRES_COMPLETION_TOOL     = YES (any tool with lifecycle.completesRun===true)
  REQUIRES_TERMINAL_RESPONSE   = YES (the completing tool's text becomes outputText)
  MODEL_STOP_REQUIRED          = NO
  MAX_ITERATIONS_RELEVANT      = NO
  MISTAKE_LIMIT_RELEVANT       = NO
  HOST_FALLBACK                = NO
  SEMANTIC_MEANING: GENUINE SEMANTIC COMPLETION — the agent's last action was an
                    explicit terminal submission tool call. This is the ONLY
                    authoritative source of "the task is done" in the runtime.
  EVIDENCE_LABEL: REAL_PRODUCTION_SEAM (verified — present at agent-runtime.ts:1402)

PRODUCER ID: COMPLETION-REMINDER-EXHAUSTION
  File:   sdk/packages/agents/src/agent-runtime.ts
  Lines:  1356-1378
  Trigger: A model turn produced ZERO tool calls AND the completion-reminder
           loop produced no further completion-reminder text (i.e. either
           completionPolicy.requireCompletionTool === false, or
           getCompletionReminderMessages() returned []).
  Code:
      if (toolCalls.length === 0) {
          await this.emit({ type: "turn-finished", ..., toolCallCount: 0 });
          const completionReminderMessages = this.getCompletionReminderMessages();
          if (completionReminderMessages.length > 0) {
              for (const reminderMessage of completionReminderMessages) {
                  await this.addUserReminderMessage(reminderMessage);
              }
              continue;
          }
          const result = this.finishRun("completed", finalAssistantMessage);
          await this.callAfterRunHooks(result);
          await this.emit({ type: "run-finished", snapshot: this.snapshot(), result });
          return result;
      }
  REQUIRES_COMPLETION_TOOL     = NO  (the model explicitly returned no tools)
  REQUIRES_TERMINAL_RESPONSE   = NO  (the model returned bare text without a terminal tool)
  MODEL_STOP_REQUIRED          = YES (no tool calls)
  MAX_ITERATIONS_RELEVANT      = YES (loop runs until either a completing tool fires
                                     or the completion-reminder-loop exhausts; if
                                     maxIterations is hit, see PRODUCER MAX-ITERATIONS-THROW below)
  MISTAKE_LIMIT_RELEVANT       = NO
  HOST_FALLBACK                = NO
  SEMANTIC_MEANING: AMBIGUOUS — the model produced bare text and chose not to
                    call a terminal tool. The runtime treats "no tool calls
                    after one last reminder" as completion.
                    - If completionPolicy.requireCompletionTool === false
                      (the default for non-YOLO, non-team configs), this is
                      the canonical "natural model stop" path and is
                      semantically equivalent to submission.
                    - If completionPolicy.requireCompletionTool === true
                      (YOLO, team, custom configs) AND the model failed to
                      invoke a required completion tool, the model is being
                      COERCED into completion by the runtime — the model's
                      output was NOT terminal. THIS is the canonical
                      "session-termination fallback" that the predecessor
                      ACT and prior recon documents identify.

  This producer is the FIRST-BROKEN-BOUNDARY candidate. It does not require
  a terminal tool and does not require a terminal response.

  EVIDENCE_LABEL: REAL_PRODUCTION_SEAM (verified — present at agent-runtime.ts:1371)

PRODUCER ID: MAX-ITERATIONS-THROW
  File:   sdk/packages/agents/src/agent-runtime.ts
  Lines:  1417-1419 (throw) → 1420-1510 (catch)
  Trigger: Loop condition at line 1303-1306 is false because
           state.iteration >= config.maxIterations.
  Code (throw):
      throw new Error(`Agent runtime exceeded maxIterations (${this.config.maxIterations})`);
  Code (catch — produces AgentRunResult with status):
      const isAborted = this.abortController.signal.aborted || isControlledStop;
      const status = isAborted ? "aborted" : "failed";
      ...
      const result: AgentRunResult = { ..., status, ... };
      ...
      if (status === "failed") {
          await this.emit({ type: "run-failed", ..., error: normalized, errorClass });
      } else {
          await this.emit({ type: "run-finished", ..., result });
      }
      return result;
  REQUIRES_COMPLETION_TOOL     = NO
  REQUIRES_TERMINAL_RESPONSE   = NO
  MODEL_STOP_REQUIRED          = NO (model never finished — loop was bounded)
  MAX_ITERATIONS_RELEVANT      = YES (this IS the max-iterations path)
  MISTAKE_LIMIT_RELEVANT       = NO
  HOST_FALLBACK                = NO
  SEMANTIC_MEANING: NEVER produces status === "completed". It produces
                    "failed" (default) or "aborted" (if ControlledStopError
                    OR abortController was aborted). After statusToLegacyFinishReason
                    this becomes AgentFinishReason === "error" or "aborted".
                    The "max_iterations" AgentFinishReason is therefore DEAD
                    at the AgentRunResult → AgentDoneEvent boundary.
  EVIDENCE_LABEL: REAL_PRODUCTION_SEAM (verified — present at agent-runtime.ts:1417/1425)

PRODUCER ID: ABORT-THROW
  File:   sdk/packages/agents/src/agent-runtime.ts
  Lines:  1318-1319, 1322-1326, 1348-1352 (multiple internal throws, all
          converge on the catch at 1420)
  Trigger: throwIfAborted() at 1307/1322 OR model-returned
           finishReason === "aborted" at 1318-1319 OR
           finishReason === "max-tokens" && no tool calls (1348-1349)
           OR finishReason === "error" && no tool calls (1351-1353).
  Status produced: "aborted" (if ControlledStopError / abort signal) or "failed".
  NEVER produces "completed".
  SEMANTIC_MEANING: ABORT or RUNTIME FAILURE — NOT semantic completion.
  EVIDENCE_LABEL: REAL_PRODUCTION_SEAM (verified — multiple throws, all converge)

PRODUCER ID: COMPLETE-ABORTED-INTERACTIVE-TURN (host-side)
  File:   sdk/packages/core/src/runtime/host/local-runtime-host.ts
  Lines:  1853-1925
  Trigger: A run throws AND session.interactive && session.aborting are both true
           (called from runTurn's catch block at 1047-1048).
  Code:
      this.eventBridge.dispatchAgentEvent(session.sessionId, session.config, {
          type: "done",
          reason: "aborted",
          text: "",
          iterations: 0,
          usage,
      });
  REASON EMITTED: "aborted" (NOT "completed").
  EVIDENCE_LABEL: REAL_PRODUCTION_SEAM (verified — local-runtime-host.ts:1895-1901)

PRODUCER ID: AGENT-RUNTIME-CATCH-EMIT-FAIL
  File:   sdk/packages/agents/src/agent-runtime.ts
  Lines:  1495-1501
  Trigger: catch block, status === "failed"
  Emit: { type: "run-failed", snapshot, error, errorClass }
        → translates via RuntimeEventAdapter to:
        { type: "error", error, errorClass, recoverable: false, iteration }
        (NOT a "done" event. There is no AgentDoneEvent for a failed run.)
  EVIDENCE_LABEL: REAL_PRODUCTION_SEAM (verified)

PRODUCER ID: SESSION-RUNTIME-ORCHESTRATOR-BUILD-LEGACY-RESULT
  File:   sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
  Lines:  1488-1541
  Trigger: After runtime.run()/runtime.continue() resolves at 997-999.
  Produces: AgentResult (host-facing type) with finishReason derived via
            deriveFinishReason(runResult) (line 1570-1584):
                "completed" if runResult.status === "completed"
                "aborted"  if runResult.status === "aborted"
                "error"    if runResult.status === "failed"
                "error"    if runResult === undefined
            So AgentResult.finishReason === "completed" ONLY when the
            underlying AgentRuntime emitted status === "completed".
  EVIDENCE_LABEL: REAL_PRODUCTION_SEAM (verified — orchestrator.ts:1496-1498, 1570-1584)

PRODUCER ID: HUB-RUNTIME-HOST-DONE-EVENT-FROM-PAYLOAD
  File:   sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts
  Lines:  534-567
  Trigger: Hub receives a "done"-style reply envelope from a remote runtime.
  Code:
      const reasonCandidate = payload?.reason ?? result?.finishReason;
      const reason = isAgentFinishReason(reasonCandidate)
          ? reasonCandidate
          : reasonCandidate === "failed"
              ? "error"
              : "completed";   // <-- DEFAULT: anything unknown → "completed"
  This is the ONLY producer that can emit "completed" for a status that is
  neither explicitly "completed" nor anything else — it defaults UNKNOWN to
  "completed". This is a SECOND possible first-broken-boundary candidate:
  if a remote runtime signals an ambiguous finish reason (e.g., it
  foreground-collapses to a string), the hub host will label it "completed"
  even though it may have been a max-iterations or mistake_limit.
  EVIDENCE_LABEL: REAL_PRODUCTION_SEAM (verified — hub-runtime-host.ts:534-567)
  ADDITIONAL NOTE: This producer is RELEVANT to cline-hub / remote-runtime
  scenarios, NOT to the local-vs-code seam. The OWN01 RED test exercises
  the LOCAL seam; this producer is not on the live OWN01 path. But it is
  a structurally identical misclassification shape (unknown → "completed"
  default) that could resurface if the OWN01 fix is later ported to hub.

------------------------------------------------------------------------
§2 PRODUCERS THAT CANNOT EMIT status === "completed"
------------------------------------------------------------------------

  - MAX-ITERATIONS-THROW: always "aborted" or "failed".
  - ABORT-THROW (any internal throw): always "aborted" or "failed".
  - COMPLETE-ABORTED-INTERACTIVE-TURN: always reason === "aborted".
  - AGENT-RUNTIME-CATCH-EMIT-FAIL: emits AgentErrorEvent, not AgentDoneEvent.

------------------------------------------------------------------------
§3 LITERAL PRODUCTION SEAM SUMMARY
------------------------------------------------------------------------

  EXACT count of distinct sites that produce AgentRunResult.status === "completed"
  (or its downstream AgentFinishReason === "completed" equivalent):

      1. COMPLETION-TOOL-AUTHORITY          (agent-runtime.ts:1402)
      2. COMPLETION-REMINDER-EXHAUSTION     (agent-runtime.ts:1371)

  EXACT count of distinct sites that produce AgentDoneEvent.reason === "completed"
  in production code:

      1. COMPLETION-TOOL-AUTHORITY → translates via runtime-event-adapter
      2. COMPLETION-REMINDER-EXHAUSTION → translates via runtime-event-adapter
      3. HUB-RUNTIME-HOST-DONE-EVENT-FROM-PAYLOAD (default fallback; hub-only)

  ALL THREE call into finishRun / isAgentFinishReason with NO preservation of
  any distinction between:
      (a) "the agent called submit_and_exit" (COMPLETION-TOOL-AUTHORITY)
      (b) "the model returned bare text and the completion-reminder loop
           gave up" (COMPLETION-REMINDER-EXHAUSTION)

  The downstream adapter at runtime-event-adapter.ts:440-468 collapses both
  into the same AgentDoneEvent { reason: "completed", text, iterations, usage }.

------------------------------------------------------------------------
§4 LIVE TRACE FOR THE OWN01 SPECIFIC CASE
------------------------------------------------------------------------

LIVE (captured 20260829T134901Z, frame 59 in post-terminal-authority-diagnostic-extension.jsonl):

  task_id               = 1787991478667_tjjyj
  runtimeStatus         = completed
  attemptCompletionSeen = false
  terminalResponseCommittedThisTurn = false
  recoveryBudgetFailures = 0
  toolCalls             = 222
  visible symptom       = Waiting / no autonomous continuation
  next projected phase  = awaiting_followup

STRUCTURAL (from production source):

  - finishRun("completed", ...) callsites: agent-runtime.ts:1371, 1402.
  - 1371: model returned zero tool calls + completion-reminder exhausted.
  - 1402: a completesRun tool fired (only submit_and_exit in built-in set).

UNAVAILABLE_FROM_TRACE:

  - actual live AgentDoneEvent.reason (PTAD did not capture event.reason; PTAD
    captures runtimeStatus, not the AgentDoneEvent stream).
  - whether the model emitted ANY tool calls on the terminal turn
    (PTAD does not record the last-turn tool-call set; only cumulative toolCalls).

INFERRED (structural, but cannot be promoted to LIVE):

  - the live AgentDoneEvent.reason was almost certainly "completed" (because
    runtimeStatus === "completed"), since runtimeStatus is derived from
    AgentRunResult.status via the same adapter.
  - HOWEVER, the producer site (1371 vs 1402) is NOT observable from the
    live trace.

NO LIVE_REASON=completed claim is asserted.