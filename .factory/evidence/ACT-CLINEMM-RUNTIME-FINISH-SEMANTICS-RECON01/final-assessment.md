# ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01 — Final Assessment

ACT_ID: ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01
Authored at: ENTRY_HEAD = 6ecf546f84b6593904357d198c56aadd89fe2a85
Closure:    CLASSIFICATION + EVIDENCE COMMIT. STOP.

------------------------------------------------------------------------
§0 Required fields
------------------------------------------------------------------------

LIVE_REASON                       = UNAVAILABLE_FROM_TRACE
                                       (PTAD captured runtimeStatus, not
                                        AgentDoneEvent.reason; PTAD did
                                        not record which producer fired)

COMPLETED_PRODUCER_COUNT          = 2 (local seam: agent-runtime.ts:1371, 1402)
                                    +1 (hub seam: hub-runtime-host.ts:546-548)

STATUS_COMPLETED_SEMANTICS        = C (overloaded meaning depending on producer)

NON_SEMANTIC_COMPLETION_PRODUCERS = COMPLETION-REMINDER-EXHAUSTION
                                      (under completionPolicy.requireCompletionTool === true)
                                    HUB-DONE-EVENT-FROM-PAYLOAD
                                      (default fallback for unknown reason)

MAX_ITERATIONS_RUNTIME_STATUS     = "aborted" or "failed" (NEVER "completed")
MAX_ITERATIONS_DONE_REASON        = "aborted" (NEVER "max_iterations")
MAX_ITERATIONS_ERROR_EVENT        = YES (when status === "failed", emits run-failed)

FALLBACK_COMPLETION_CLASS         = AMBIGUOUS
                                       (under requireCompletionTool=true: collapses
                                        two distinct meanings into one outcome)
                                       / RUNTIME_INVOCATION_COMPLETION
                                       (under requireCompletionTool=false: natural
                                        model stop IS the canonical done signal)

HOST_OWNED_AUTONOMOUS_CONTINUE_EXISTS = NO
                                       (the API supports one — consumePendingUserMessage
                                        at types.ts:944 — but the live ClineMM
                                        LocalRuntimeHost does NOT wire it)

RFS01 = NOT_EXECUTED        (pre-existing tests cover the submit_and_exit path)
RFS02 = STRUCTURAL_ONLY     (definitive source walk; do not encode bug in stub)
RFS03 = NOT_REPRESENTABLE   (requires real model + tools + completionPolicy config)
RFS04 = NOT_REPRESENTABLE   (no HOST_OWNED continuation primitive wired on host)

OWN01 = 1 failed | 28 passed of 29
       (apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts:780)
CPL   = N/A for THIS ACT (not a CPL ACT)
CRA   = N/A for THIS ACT (not a CRA ACT)

PRIMARY_CAUSAL_CLASSIFICATION     = PRODUCER_SEMANTICS_BUG
FIRST_BROKEN_BOUNDARY             = agent-runtime.ts:1371 — finishRun("completed", finalAssistantMessage)
                                      fires unconditionally when:
                                        toolCalls.length === 0 AND
                                        (completionPolicy.requireCompletionTool === false OR
                                         getCompletionReminderMessages() returned [])
                                      This bypasses the requireCompletionTool=true
                                      configuration by virtue of the reminder-loop
                                      exhaustion. There is NO co-emitted provenance
                                      flag distinguishing this from a genuine
                                      COMPLETION-TOOL-AUTHORITY call at 1402.

NEW_TURN_PHASE_REQUIRED           = UNKNOWN (the producer defect is the first broken
                                        boundary; a new TurnPhase would only be
                                        relevant if the producer is repaired AND
                                        the presentation/translation layer still
                                        cannot represent the truthful ownership
                                        state. Not yet evaluated.)

NEXT_REPAIR_SEAM                  = agent-runtime.ts:1371 (or its caller at 1363-1370)
                                      The repair must attach a provenance flag
                                      (e.g. `completionAuthority: "tool" | "model_stop"`)
                                      to the AgentRunResult and propagate it through
                                      RuntimeEventAdapter.translateRunFinished so
                                      AgentDoneEvent carries it (currently no such
                                      field exists; see types.ts:239-249).

RECOMMENDED_NEXT_ACT              = ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-REPAIR01
                                      (only this; no parallel "ACT-CLINEMM-TURN-PHASE-BARE-DONE-SUCCESSOR01"
                                       yet; the PRESENTATION_PHASE_GAP verdict was
                                       rejected because the producer defect is the
                                       load-bearing cause and downstream presentation
                                       cannot fix it.)

------------------------------------------------------------------------
§1 Why PRODUCER_SEMANTICS_BUG (not HOST_CONTINUATION_BUG or others)
------------------------------------------------------------------------

§1.1 Ruled out: HOST_CONTINUATION_BUG
    Host continuation bug requires: completed is correct for the runtime
    invocation AND a supported host-owned continuation mechanism exists
    AND the VS Code host fails to invoke it.
    EVIDENCE: HOST_OWNED_AUTONOMOUS_CONTINUE_EXISTS = NO. There is no
    wired host-owned continuation primitive on the live ClineMM path.
    Therefore there cannot be a host FAILURE to invoke one. This verdict
    is structurally inapplicable.

§1.2 Ruled out: PRESENTATION_PHASE_GAP
    Presentation phase gap requires: producer semantics are correct AND
    host continuation semantics are correct/intentional AND the remaining
    defect is inability to represent the truthful ownership state.
    EVIDENCE: Producer semantics are NOT correct. agent-runtime.ts:1371
    collapses two distinct meanings into one outcome. This is a producer
    defect; presentation cannot fix it because there is nothing to
    represent truthfully — the runtime emitted a "completed" signal that
    is not justified by any authority observation.

§1.3 Ruled out: COMPOSED_BUG
    Composed bug requires: producer semantics lose one distinction AND
    host continuation/ownership also independently loses another
    necessary distinction.
    EVIDENCE: Producer does lose a distinction (1371 vs 1402). Host
    continuation has NO wired mechanism to lose a distinction in (the
    absence of consumePendingUserMessage wiring is INTENTIONAL, not a
    bug). The host's choice to use a USER_OWNED queue only is a design
    choice, not a defect. There is no independent host defect to compose
    with. This verdict is structurally inapplicable.

§1.4 Ruled out: CAPTURE_INSUFFICIENT
    Capture insufficient requires: executable/source evidence cannot
    discriminate.
    EVIDENCE: The structural source walk has produced a definitive
    answer. Site 1402 is ruled out for the live trace because
    attemptCompletionSeen=false. Site 1371 is the only remaining
    producer that could fire given the live evidence. The bug is
    identified. Evidence IS sufficient.

§1.5 Selected: PRODUCER_SEMANTICS_BUG
    Producer semantics bug requires: a non-semantic runtime stop is
    classified/emitted as completed AND that misclassification is the
    first broken boundary.
    EVIDENCE:
      - agent-runtime.ts:1371 emits status="completed" without any
        terminal-tool observation. This is the canonical "non-semantic
        runtime stop classified as completed" case.
      - The misclassification is the FIRST broken boundary because
        EVERY downstream consumer (RuntimeEventAdapter, LocalRuntimeHost,
        SessionRuntimeOrchestrator, MessageTranslator,
        SdkSessionEventCoordinator, webview) inherits the same
        "completed" status. No downstream component can recover the
        distinction because the runtime itself did not record one.
      - The structural collapse from AgentFinishReason ∈ {5 values}
        down to {3 values} at
        runtime-event-adapter.ts:124-135 (statusToLegacyFinishReason)
        and session-runtime-orchestrator.ts:1570-1584 (deriveFinishReason)
        and hub-runtime-host.ts:546-548 (doneEventFromPayload)
        is a SECOND symptom of the same defect — the runtime loses
        the distinction BOTH at the source (1371 vs 1402) and at
        every downstream translation.

------------------------------------------------------------------------
§2 Live evidence cross-reference
------------------------------------------------------------------------

LIVE TRACE (frame 59):
  task_id               = 1787991478667_tjjyj
  runtimeStatus         = completed
  attemptCompletionSeen = false    ← LIVE: no terminal tool was observed
  terminalResponseCommittedThisTurn = false   ← LIVE: no terminal response was committed
  recoveryBudgetFailures = 0
  toolCalls             = 222
  visible symptom       = Waiting / no autonomous continuation

CROSS-REFERENCE:
  - attemptCompletionSeen=false rules out producer 1402 (COMPLETION-TOOL-AUTHORITY).
    That producer requires a completesRun tool observation.
  - terminalResponseCommittedThisTurn=false is consistent with the same
    ruling-out.
  - runtimeStatus=completed is the symptom that needs explanation.
  - toolCalls=222 indicates the loop ran many iterations (no maxIterations
    exit; loop guard at 1303-1306 did not trigger).
  - recoveryBudgetFailures=0 rules out the bounded-recovery-exhausted path.

THEREFORE: the live producer MUST be 1371 (COMPLETION-REMINDER-EXHAUSTION)
under completionPolicy.requireCompletionTool=true. (This is INFERRED ONLY;
the live trace did not record the completionPolicy value. But under
requireCompletionTool=false, the symptom would have been IMPOSSIBLE to
reproduce at this producer — see classification-table.md §3.)

UNAVAILABLE_FROM_TRACE:
  - AgentDoneEvent.reason (PTAD captured runtimeStatus, not the reason field)
  - completionPolicy.requireCompletionTool
  - the last-turn tool-call set (only cumulative toolCalls was recorded)
  - whether the host attempted to invoke consumePendingUserMessage

These four facts are not load-bearing for the causal classification
because the structural walk already rules out the alternative producers.
The defect is at the source boundary; the missing facts are at the
downstream projection.

------------------------------------------------------------------------
§3 Recommended next ACT
------------------------------------------------------------------------

ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-REPAIR01:

  - Repair the producer at agent-runtime.ts:1371 to either:
      (a) emit a distinct status (e.g. "completed_without_terminal_tool"
          or carry a `completionAuthority` provenance flag), OR
      (b) refuse to call finishRun("completed") when
          completionPolicy.requireCompletionTool === true and no
          completesRun tool was observed in the loop.
  - Propagate the new state through RuntimeEventAdapter.translateRunFinished
    (runtime-event-adapter.ts:440-468) and SessionRuntimeOrchestrator.
    buildLegacyResult (session-runtime-orchestrator.ts:1488-1541).
  - May require a new AgentFinishReason value (e.g. "completed_without_terminal_tool"
    or extend the 5-value enum to include a "completed_runtime_invocation_only"
    variant).
  - Optionally propagate through hub-runtime-host.ts:546-548 to align the
    hub/remote-runtime path.

The repair ACT is OUT OF SCOPE for THIS recon ACT. It must be opened
as a separate ACT after this one's evidence commit.

NO second recon ACT, NO repair opening, NO TurnPhase speculation in THIS ACT.

------------------------------------------------------------------------
§4 Constraints honored
------------------------------------------------------------------------

  - NO production source changes (verified — production files byte-identical
    between PREDECESSOR_RED_SUBJECT_HEAD and HEAD of this ACT).
  - OWN01 RED preserved at 1 failed | 28 passed of 29.
  - Stash preserved (stash@{0} = c2-green-and-c2-p1-delta).
  - Foreign editor-capture residue preserved.
  - PREDECESSOR_RED_SUBJECT_HEAD (f106bc63d), ENTRY_HEAD (6ecf546f8),
    OPEN_HEAD (2401faf4a), and ENTRY_IDENTITY_FIX_HEAD (49f7d730a)
    preserved as references in entry-freeze.txt and the ACT file.
  - LIVE_REASON=completed explicitly NOT asserted.
  - NO new TurnPhase proposed in this ACT.
  - NO MessageTranslator.finishReason propagation in this ACT.
  - NO UI change in this ACT.
  - NO prompt hack, synthetic Continue, or provider/model special case.
  - RFS01..RFS04 outcomes honestly recorded (NOT_EXECUTED / STRUCTURAL_ONLY /
    NOT_REPRESENTABLE) — no fake-green test stubs.