# ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01 — Probe Results

ACT_ID: ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01
Authored at: ENTRY_HEAD = 6ecf546f84b6593904357d198c56aadd89fe2a85

------------------------------------------------------------------------
§0 Summary
------------------------------------------------------------------------

| Probe   | Purpose                                            | Outcome                          | Reason                          |
|---------|----------------------------------------------------|----------------------------------|---------------------------------|
| RFS01   | Establish positive baseline for genuine            | NOT_EXECUTED                     | Pre-existing tests cover this;  |
|         | semantic completion (submit_and_exit path)         |                                  | structural walk is definitive   |
| RFS02   | Capture fallback completion (no terminal tool)     | STRUCTURAL_ONLY                  | Definitive source walk          |
| RFS03   | Capture maxIterations exhaustion                   | NOT_REPRESENTABLE                | Requires new infrastructure     |
|         |                                                    |                                  | (model + tools + completionPolicy) |
| RFS04   | HOST_OWNED_AUTONOMOUS_CONTINUE probe               | NOT_REPRESENTABLE                | Live host has no HOST_OWNED     |
|         |                                                    |                                  | continuation primitive wired    |

------------------------------------------------------------------------
§1 RFS01 (semantic completion baseline) — NOT_EXECUTED
------------------------------------------------------------------------

PROBE PURPOSE:
  Arrange a successful explicit completion-tool path (submit_and_exit fires).
  Require: semantic completion tool observed; result.status captured;
           done reason captured; terminal completion authority captured.

PRE-EXISTING COVERAGE:
  apps/vscode/src/sdk/__tests__/seatbelt-yolo-completion-authority-integration01.red.test.ts:347
  pins requireCompletionTool: true. The submit_and_exit tool is defined at
  sdk/packages/core/src/extensions/tools/definitions.ts:1035-1038 with
  lifecycle.completesRun: true.

WHY NOT EXECUTED IN THIS ACT:
  - Submit-and-exit tool fires are heavily exercised by the existing
    seatbelt-yolo-completion-authority-integration01 RED and other tests.
  - The structural source walk has already produced a definitive answer:
    COMPLETION-TOOL-AUTHORITY at agent-runtime.ts:1402 produces
    status="completed" with the terminalToolMessage as outputText.
  - Re-running RFS01 against a real provider would add no new evidence
    beyond what the source walk already establishes.

------------------------------------------------------------------------
§2 RFS02 (fallback completion probe) — STRUCTURAL_ONLY
------------------------------------------------------------------------

PROBE PURPOSE:
  Arrange a run where:
    model/provider returns a normal successful stop
    no completion tool is invoked
    no explicit user-yield tool is invoked
  Capture:
    AgentRunResult.status
    AgentDoneEvent.reason
    toolCalls
    output
    final message state

FINDING (structural):
  When completionPolicy.requireCompletionTool === true and the model
  emits bare text on the terminal turn:
    PRODUCER ID: COMPLETION-REMINDER-EXHAUSTION (agent-runtime.ts:1371)
    fires unconditionally. status="completed". outputText = the bare text.
    No "no-completion-tool-observed" flag is recorded.

  When completionPolicy.requireCompletionTool === false:
    Same producer fires. status="completed". Same collapse. But the
    semantics differ — this is the canonical natural-stop path.

DETAILS: see fallback-completion-path.md.

DO NOT ENCODE THE LIVE BUG INTO A STUB. The ACT forbids it.

------------------------------------------------------------------------
§3 RFS03 (maxIterations probe) — NOT_REPRESENTABLE
------------------------------------------------------------------------

PROBE PURPOSE:
  Set a deliberately tiny maxIterations value, run through the REAL
  AgentRuntime production seam, capture result.status, done event reason,
  error event presence, emitted event sequence, iteration count.

WHY NOT REPRESENTABLE:
  - The ACT forbids modifying production code.
  - The probe requires a real model provider + real tools + a real
    completionPolicy + a real session. Wiring all of these is not a
    recon activity.
  - The OWN01 RED test exercises the adapter/translator/coord pathway
    with a stub session, NOT the runtime's actual config.
  - The structural source walk has already produced a definitive answer:
    status="aborted" or "failed", never "completed".

DETAILS: see max-iterations-path.md §3.

------------------------------------------------------------------------
§4 RFS04 (HOST_OWNED continuation characterization) — NOT_REPRESENTABLE
------------------------------------------------------------------------

PROBE PURPOSE:
  After a run that returns status="completed" WITHOUT adding a new
  user message, invoke the actual supported continuation primitive
  if source says that is legal. Capture: whether another provider
  iteration starts; messages preserved?; synthetic user message added?;
  task can progress autonomously?

FINDING (structural):
  - The supported primitive is consumePendingUserMessage
    (AgentConfig.consumePendingUserMessage, sdk/packages/shared/src/agents/types.ts:944).
    This is a HOST_OWNED callback: the runtime pulls a user message
    from the host each iteration.
  - The ClineMM LocalRuntimeHost does NOT wire this callback on the
    live path. The host uses pendingPromptsController.drain instead,
    which is USER_OWNED.
  - The host has NO wired HOST_OWNED continuation primitive.

WHY NOT REPRESENTABLE:
  - To execute RFS04, one would have to (a) wire the
    consumePendingUserMessage callback, (b) invent its semantics
    (where the "synthetic continue" message comes from), or (c) use
    a fake user message. All are FORBIDDEN by the ACT.
  - HOST_AUTOCONTINUE_PROBE = NOT_REPRESENTABLE.

DETAILS: see continuation-callers.md §2-§3.

------------------------------------------------------------------------
§5 Cross-reference: what does the live trace establish vs. not
------------------------------------------------------------------------

LIVE (captured 20260829T134901Z, frame 59):
  task_id               = 1787991478667_tjjyj
  runtimeStatus         = completed
  attemptCompletionSeen = false
  terminalResponseCommittedThisTurn = false
  recoveryBudgetFailures = 0
  toolCalls             = 222
  visible symptom       = Waiting / no autonomous continuation

ESTABLISHED FROM LIVE TRACE:
  - The runtime reported status="completed".
  - No terminal completion tool was observed during the run.
  - No terminal response was committed.
  - The session stalled in a "Waiting" UI with no autonomous continuation.

NOT ESTABLISHED FROM LIVE TRACE:
  - Whether completionPolicy.requireCompletionTool was true or false.
  - Which producer (1371 vs 1402) actually fired.
  - Whether the model emitted bare text or a non-terminal tool call
    on the final turn.
  - Whether the host attempted to invoke a continuation primitive.

ESTABLISHED FROM STRUCTURAL WALK:
  - The only two producer sites that can produce status="completed":
    agent-runtime.ts:1371 (COMPLETION-REMINDER-EXHAUSTION)
    agent-runtime.ts:1402 (COMPLETION-TOOL-AUTHORITY)
  - Site 1402 is ruled out for the live trace because
    attemptCompletionSeen=false (no terminal-tool observation).
  - Site 1371 is therefore the live producer — IF the live trace
    confirmed requireCompletionTool=true. (It didn't; see "NOT
    ESTABLISHED" above.)
  - Without that confirmation, the producer site is INFERRED ONLY.