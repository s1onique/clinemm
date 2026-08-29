# ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01 — Classification Table

ACT_ID: ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01
Authored at: ENTRY_HEAD = 6ecf546f84b6593904357d198c56aadd89fe2a85
Label: STRUCTURAL (every classification is source-derived)

------------------------------------------------------------------------
§0 Required rows
------------------------------------------------------------------------

The ACT requires the following rows, each classified into exactly one of:
  SEMANTIC_COMPLETION | TOOL_COMPLETION | MODEL_STOP_ONLY |
  LOOP_EXHAUSTION | HOST_FALLBACK | UNKNOWN

  | Path                                 | Class                | Note                                |
  |--------------------------------------|----------------------|-------------------------------------|
  | explicit completion tool path        | SEMANTIC_COMPLETION  | line 1402 / 1397-1414               |
  | fallback/session-termination path    | HOST_FALLBACK        | line 1371 (see §1 below)            |
  | natural model-stop path              | MODEL_STOP_ONLY      | line 1371 (when requireCompletionTool=false) |
  | maxIterations path                   | LOOP_EXHAUSTION      | line 1417/1425 — produces "failed"  |
  | abort path                           | ABORT_THROWS (not "completed") | multiple lines; never emits completed |
  | error path                           | ERROR_THROWS (not "completed") | multiple lines; never emits completed |

  Paths that CANNOT produce status === "completed": maxIterations, abort,
  error. They emit "failed" or "aborted".

------------------------------------------------------------------------
§1 The fallback / session-termination path
------------------------------------------------------------------------

There is no single site named "session-termination fallback" in
agent-runtime.ts. The phrase is used in:

  apps/vscode/src/sdk/message-translator.ts:402-411
  apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts:585-595, 1100-1110

In both cases the phrase refers to:

  agent-runtime.ts:1371 (the COMPLETION-REMINDER-EXHAUSTION producer)
  with the configuration condition:
      completionPolicy.requireCompletionTool === true
      (i.e., the runtime is configured to REQUIRE a completion tool)

In this configuration, COMPLETION-REMINDER-EXHAUSTION fires when:
  1. The model returned zero tool calls on the terminal turn.
  2. The completion-reminder loop has nothing more to nudge with.
  3. The runtime calls finishRun("completed", ...) ANYWAY, without ever
     observing a submit_and_exit / completing tool.

This is the FIRST-BROKEN-BOUNDARY. The runtime's semantic collapse:

  "no more tool calls + no reminder text + no terminal-tool observation"
      → status="completed"

is correct ONLY when completionPolicy.requireCompletionTool === false
(natural model stop is the canonical "done" signal). It is INCORRECT
when completionPolicy.requireCompletionTool === true (the runtime
configured itself to require a terminal tool that never fired).

When the bug manifests, the user sees a "done" UI with bare debug/think
text and no terminal submission. This matches OWN01's symptom exactly:
  runtimeStatus        = completed
  attemptCompletionSeen = false
  terminalResponseCommittedThisTurn = false

  → exactly the COMPLETION-REMINDER-EXHAUSTION path under
    requireCompletionTool === true.

------------------------------------------------------------------------
§2 STATUS_COMPLETED_SEMANTICS = ?
------------------------------------------------------------------------

Answer: C (overloaded meaning depending on producer)

  COMPLETION-TOOL-AUTHORITY (agent-runtime.ts:1402):
    status="completed" means SEMANTIC_COMPLETION.
    Bounded by: a completesRun tool was observed and did not error.

  COMPLETION-REMINDER-EXHAUSTION (agent-runtime.ts:1371):
    status="completed" means SEMANTIC_COMPLETION when
      completionPolicy.requireCompletionTool === false
        (natural model stop is the canonical "done" signal).
    status="completed" means MODEL_STOP_COERCED when
      completionPolicy.requireCompletionTool === true
        (runtime wanted a completion tool, didn't get one, and labeled
         the run "completed" anyway).
    These two cases are indistinguishable at the AgentDoneEvent boundary
    because both producers emit the SAME AgentDoneEvent { reason: "completed" }.

The boundary that loses the distinction:
  agent-runtime.ts:1371 — finishRun("completed", finalAssistantMessage)
  AND
  agent-runtime.ts:1402 — finishRun("completed", finalAssistantMessage,
                                textFromToolMessage(terminalToolMessage))

Both call sites pass the literal string "completed" without attaching a
provenance flag (e.g., `completionAuthority: "tool" | "model_stop"`).
The `textFromToolMessage(terminalToolMessage)` third arg at 1402 is only
used as the outputText; it is NOT exposed as a discriminator.

------------------------------------------------------------------------
§3 Cross-check against the live bug
------------------------------------------------------------------------

OWN01 bug: bare done + no terminal commit + no attempt_completion + no
user-yield authority → user sees "Waiting" with no autonomous continuation.

If the live session was running with completionPolicy.requireCompletionTool
=== true (the YOLO/team-custom shape), and the model returned a bare-text
terminal turn without invoking submit_and_exit, then:

  PRODUCER ID: COMPLETION-REMINDER-EXHAUSTION
  Class: HOST_FALLBACK (semantically; the runtime coerced a non-terminal
                          stop into "completed" by configuration, not by
                          authority)
  → status="completed", text=non-terminal, attemptCompletionSeen=false
  → matches OWN01 symptoms.

If the live session was running with completionPolicy.requireCompletionTool
=== false (the default non-YOLO shape), then COMPLETION-REMINDER-EXHAUSTION
is canonical SEMANTIC_COMPLETION / MODEL_STOP_ONLY and OWN01's symptom
would have been IMPOSSIBLE to reproduce at this producer.

The OWN01 RED test (apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts:780)
explicitly constructs a stub session in which the runtime emits a
done(reason="completed") event WITHOUT any terminal tool observation
(see test comment lines 580-595, 760-770). It exercises the
adapter/translator/coord pathway, NOT the runtime's actual config.
So the live causal classification is INFERRED ONLY — the OWN01 test
does not pin down which configuration produced the original OWN01 bug.

------------------------------------------------------------------------
§4 NON_SEMANTIC_COMPLETION_PRODUCERS (raw list)
------------------------------------------------------------------------

  1. COMPLETION-REMINDER-EXHAUSTION (agent-runtime.ts:1371) — when configured
     with requireCompletionTool=true, the runtime coerces a non-terminal
     stop into status="completed". This is the only production producer
     that can fire without a canonical terminal-tool observation.

  2. HUB-RUNTIME-HOST-DONE-EVENT-FROM-PAYLOAD (hub-runtime-host.ts:534-567)
     — defaults an unknown reasonCandidate to "completed". Only on the
     hub/remote-runtime path, NOT on the local-vs-code seam.

------------------------------------------------------------------------
§5 Summary
------------------------------------------------------------------------

  STATUS_COMPLETED_SEMANTICS                 = C (overloaded)
  COMPLETED_PRODUCER_COUNT                   = 2 (local seam: agent-runtime.ts:1371, 1402)
                                              +1 (hub seam: hub-runtime-host.ts:546-548)
  NON_SEMANTIC_COMPLETION_PRODUCERS          = COMPLETION-REMINDER-EXHAUSTION (under
                                              requireCompletionTool=true),
                                              HUB-DONE-EVENT-FROM-PAYLOAD
                                              (default fallback)
  FIRST_BROKEN_BOUNDARY (conjectured)        = agent-runtime.ts:1371 — a finishRun call
                                              that bypasses the requireCompletionTool
                                              gate by virtue of the reminder-loop
                                              exhaustion.
  FIRST_BROKEN_BOUNDARY (live UNKNOWN)       = cannot be pinned from the OWN01 RED
                                              alone; depends on the live config.

NO LIVE confirmation of which producer fired on the OWN01 trace.