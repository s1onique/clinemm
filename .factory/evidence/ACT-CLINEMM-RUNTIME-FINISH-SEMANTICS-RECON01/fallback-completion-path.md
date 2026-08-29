# ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01 — Fallback Completion Path

ACT_ID: ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01
Authored at: ENTRY_HEAD = 6ecf546f84b6593904357d198c56aadd89fe2a85
Label: STRUCTURAL (full source walk + cross-references to live trace)

------------------------------------------------------------------------
§0 What is the "fallback / session-termination fallback"
------------------------------------------------------------------------

There is no single site named "session-termination fallback" in
agent-runtime.ts. The phrase appears in two places in the apps/vscode
side, both referring to the SAME producer:

  agent-runtime.ts:1371 — the COMPLETION-REMINDER-EXHAUSTION producer
                          (under completionPolicy.requireCompletionTool === true)

The references are:

  apps/vscode/src/sdk/message-translator.ts:402-411 (comment block)
  apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts:585-595 (RED test comment)
  apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts:1100-1110 (RED test comment)

The phrase is load-bearing: it identifies the path that produces
status="completed" WITHOUT a canonical terminal-tool observation. It is
the FIRST-BROKEN-BOUNDARY candidate for the OWN01 bug.

------------------------------------------------------------------------
§1 What state reaches this fallback
------------------------------------------------------------------------

The COMPLETION-REMINDER-EXHAUSTION producer (agent-runtime.ts:1371) is
reached when ALL of the following hold:

  1. The model produced ZERO tool calls on the current iteration
     (the `if (toolCalls.length === 0)` block at 1356).
  2. The completion-reminder loop has nothing more to nudge with:
       - Either completionPolicy.requireCompletionTool === false
         (no required tools, so no reminder messages exist), OR
       - getCompletionReminderMessages() returned an empty array
         (the loop has already nudged as many times as configured).
  3. The agent's last assistant message is `finalAssistantMessage`
     (already pushed to state.messages at 1334).

The runtime then calls:

      const result = this.finishRun("completed", finalAssistantMessage);

This is the FALLBACK COMPLETION PATH. It does NOT require:
  - A successful submit_and_exit / completesRun tool call.
  - A committed terminal response in the conversation transcript.
  - An explicit user-yield (ask_question / etc.).

It DOES require:
  - A model turn with zero tool calls.
  - The completion-reminder loop having nothing more to say.

------------------------------------------------------------------------
§2 Does it call finishRun("completed")?
------------------------------------------------------------------------

YES. The exact line:

  sdk/packages/agents/src/agent-runtime.ts:1371
      const result = this.finishRun("completed", finalAssistantMessage);

finishRun (sdk/packages/agents/src/agent-runtime.ts:3487-3513):
  - Sets state.status = "completed".
  - Clears executionModelStreaming and executionAwaitingApproval (terminal lifecycle).
  - Returns AgentRunResult with status: "completed".

The result is then:
  - Passed to callAfterRunHooks(result) (line 1372).
  - Emitted as { type: "run-finished", snapshot, result } (line 1373-1377).
  - Returned to the caller (line 1378).

------------------------------------------------------------------------
§3 Can it emit completed when no completion tool was observed
------------------------------------------------------------------------

YES — this is the structural defect under OWN01 review.

The condition `if (toolCalls.length === 0)` at 1356 is reached when
the model itself produced no tool calls. If the model "intended" to
call submit_and_exit but somehow emitted bare text instead (model error,
context truncation, model policy override), the runtime has NO check
that confirms a terminal-tool observation occurred before declaring
completion. It simply trusts the absence of tool calls + absence of
reminder text as a sufficient signal.

This is correct semantics when completionPolicy.requireCompletionTool
=== false (the default): a model that decides "I have nothing more to
do, no tools to call" is genuinely done. This is the canonical
"natural model stop" path.

This is INCORRECT semantics when completionPolicy.requireCompletionTool
=== true: the runtime explicitly configured itself to require a
terminal tool. When no terminal tool is observed and the reminder loop
gives up, the runtime collapses this into "completed" anyway. The
runtime's own configuration is being IGNORED by this code path.

------------------------------------------------------------------------
§4 RFS02 (fallback completion probe)
------------------------------------------------------------------------

PROBE PURPOSE: arrange a run where:
  - model/provider returns a normal successful stop
  - no completion tool is invoked
  - no explicit user-yield tool is invoked

Then capture: AgentRunResult.status, AgentDoneEvent.reason, toolCalls,
output, final message state.

The OWN01 RED test exercises a STUB session in this configuration
(apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts:780 —
"OWN01 RED: bare done + no terminal commit + no attempt_completion + no
user-yield authority MUST NOT yield to awaiting_followup 3ms"). That
test asserts a downstream property (the coord must NOT emit
awaiting_followup) without going through the AgentRuntime production
seam. It does NOT pin down what finishRun("completed") would actually
emit if it reached the runtime with this configuration.

OUTCOME: NOT EXECUTED in this ACT.

WHY:
  - The OWN01 RED test already covers the downstream consequence.
  - Writing a real RFS02 would require a real provider, real tools,
    real completionPolicy.requireCompletionTool=true config. Not
    feasible in this read-only recon ACT.
  - The structural source walk has already produced a definitive
    answer: when requireCompletionTool=true and the model returns
    bare text, finishRun("completed", finalAssistantMessage) fires
    unconditionally at 1371.

MARK: RFS02 = STRUCTURAL_ONLY (definitive answer from source).

------------------------------------------------------------------------
§5 FALLBACK_COMPLETION_CLASS
------------------------------------------------------------------------

The producer at agent-runtime.ts:1371 is structurally ambiguous:

  - If completionPolicy.requireCompletionTool === false:
      FALLBACK_COMPLETION_CLASS = RUNTIME_INVOCATION_COMPLETION
      (the model stop IS the natural completion signal)

  - If completionPolicy.requireCompletionTool === true:
      FALLBACK_COMPLETION_CLASS = AMBIGUOUS
      (the runtime wanted a completion tool, didn't get one, and labeled
       the run completed anyway — this collapses two distinct meanings
       into one outcome)

The OWN01 bug is ONLY reproducible in the second configuration. Under
the default non-YOLO shape, this producer is canonically correct and
cannot manifest the OWN01 symptoms.

There is NO code site that emits status="completed" AND simultaneously
records "no completion tool was observed". The runtime simply does not
have this distinction in its state model. The downstream adapter
collapses both paths into the same AgentDoneEvent { reason: "completed" }.
