# ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01 — maxIterations Trace

ACT_ID: ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01
Authored at: ENTRY_HEAD = 6ecf546f84b6593904357d198c56aadd89fe2a85
Label: STRUCTURAL (full source walk; no live RED for this path)

------------------------------------------------------------------------
§0 The exact chain (line-numbered)
------------------------------------------------------------------------

The maxIterations path is the THIRD producer in the AgentRuntime run loop.
It does NOT produce status="completed". It produces "failed" or "aborted".

CHAIN:

  1. Loop guard (sdk/packages/agents/src/agent-runtime.ts:1303-1306):
         while (
             this.config.maxIterations === undefined ||
             this.state.iteration < this.config.maxIterations
         ) {
             ...
         }
     When state.iteration reaches maxIterations, the while-condition
     becomes false and the loop exits WITHOUT executing the next
     iteration's body. There is no in-loop throw here; the loop simply
     ends.

  2. Fall-through throw (sdk/packages/agents/src/agent-runtime.ts:1417-1419):
         throw new Error(
             `Agent runtime exceeded maxIterations (${this.config.maxIterations})`,
         );
     This is the ONLY site where the literal "exceeded maxIterations"
     error message is constructed. After the loop exits, control
     reaches this line unconditionally.

  3. Catch owner (sdk/packages/agents/src/agent-runtime.ts:1420-1510):
         catch (error) {
             const normalized =
                 error instanceof Error ? error : new Error(String(error));
             const isControlledStop = normalized instanceof ControlledStopError;
             const isAborted = this.abortController.signal.aborted || isControlledStop;
             const status = isAborted ? "aborted" : "failed";
             ...
             const result: AgentRunResult = {
                 ...,
                 status,
                 iterations: this.state.iteration,
                 outputText: textFromMessage(lastAssistantMessage),
                 messages: cloneMessages(this.state.messages),
                 usage: cloneUsage(this.state.usage),
                 error:
                     normalized instanceof ControlledStopError &&
                     normalized.message === "bounded_recovery_exhausted"
                         ? normalized
                         : status === "failed"
                             ? normalized
                             : undefined,
             };
             ...
             if (status === "failed") {
                 await this.emit({
                     type: "run-failed",
                     snapshot: this.snapshot(),
                     error: normalized,
                     errorClass,
                 });
             } else {
                 await this.emit({
                     type: "run-finished",
                     snapshot: this.snapshot(),
                     result,
                 });
             }
             return result;
         }

  4. AgentRuntimeEvent → RuntimeEventAdapter translation:
     The catch-block emits EITHER "run-failed" (→ AgentErrorEvent with
     recoverable: false) OR "run-finished" with status="aborted" (→
     AgentDoneEvent with reason="aborted").

     Critically: AgentRuntimeEvent["run-finished"] with status="failed"
     DOES NOT EXIST. The catch block only emits run-finished when
     status="aborted", and run-failed when status="failed".

  5. AgentDoneEvent / AgentErrorEvent emission (sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts:247-258):
         case "run-finished":
             return this.translateRunFinished(event.result);
         case "run-failed":
             return [
                 {
                     type: "error",
                     error: event.error,
                     errorClass: event.errorClass,
                     recoverable: false,
                     iteration: event.snapshot.iteration,
                 },
             ];
     The "failed" branch emits an AgentErrorEvent; the "aborted" branch
     emits an AgentDoneEvent via translateRunFinished with
     statusToLegacyFinishReason("aborted") = "aborted".

  6. LocalRuntimeHost reception (sdk/packages/core/src/runtime/host/local-runtime-host.ts:1021-1044):
         const result = await this.executeTurn(...);
         if (!session.interactive) {
             await this.finalizeSingleRun(session, result.finishReason);
         } else {
             await this.completeInteractiveTurn(session, result.finishReason);
         }
         ...
         if (result.finishReason !== "error") {
             queueMicrotask(() => {
                 void this.pendingPromptsController.drain(input.sessionId);
             });
         }

  7. SessionRuntimeOrchestrator reception (sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1488-1541):
     buildLegacyResult calls deriveFinishReason(runResult):
         switch (runResult.status) {
             case "completed": return "completed";
             case "aborted":  return "aborted";
             case "failed":   return "error";
         }
     → AgentResult.finishReason === "aborted" or "error" (NEVER "max_iterations").

------------------------------------------------------------------------
§1 What is emitted (per status produced by maxIterations path)
------------------------------------------------------------------------

  status="aborted":
    AgentRuntimeEvent:  run-finished
    AgentDoneEvent:     type="done", reason="aborted", text, iterations, usage
    AgentErrorEvent:    NOT emitted
    Host reception:     completeInteractiveTurn("aborted"); drain queue (yes)
    Final AgentResult:  finishReason="aborted"

  status="failed":
    AgentRuntimeEvent:  run-failed
    AgentDoneEvent:     NOT emitted
    AgentErrorEvent:    type="error", recoverable: false, iteration, error, errorClass
    Host reception:     completeInteractiveTurn("error"); drain queue (NO; error skip at 1040-1043)
    Final AgentResult:  finishReason="error"

------------------------------------------------------------------------
§2 The "max_iterations" AgentFinishReason is dead
------------------------------------------------------------------------

CONFIRMED: there is NO production code path that produces
AgentFinishReason === "max_iterations". The runtime's catch block
collapses maxIterations exhaustion into "aborted" or "failed", and the
legacy adapter (`statusToLegacyFinishReason`) does not contain a
`max_iterations` case.

The only production code that references the string "max_iterations"
in an AgentFinishReason-aware switch is:

  apps/cli/src/acp/acpAgent.ts:933  (case "max_iterations" in ACP stopReason mapping)
  sdk/packages/core/src/runtime/host/local-runtime-host.ts:1840  (case "max_iterations" in SessionStatus mapping)

Neither of these is a producer of AgentDoneEvent.reason. They are
consumers of AgentFinishReason that happen to handle the value, but
the value can never reach them.

------------------------------------------------------------------------
§3 Live traceability
------------------------------------------------------------------------

The live OWN01 trace (live-20260829T134901Z/post-terminal-authority-diagnostic-extension.jsonl
frame 59) shows:

  runtimeStatus        = completed
  toolCalls            = 222
  recoveryBudgetFailures = 0

These facts are INCOMPATIBLE with the maxIterations path:

  - maxIterations path produces status="aborted" or "failed", NOT "completed".
  - maxIterations path does not produce 222 toolCalls without first
    hitting the loop exit (loop guard at 1303-1306 ends the loop when
    iteration >= maxIterations).

Therefore: the OWN01 trace did NOT take the maxIterations path. This
producer is RULED OUT as the live cause of OWN01.

------------------------------------------------------------------------
§4 RFS03 (maxIterations executable probe)
------------------------------------------------------------------------

PROBE PURPOSE: Set a deliberately tiny maxIterations value, run through
the REAL AgentRuntime production seam, capture the resulting
AgentRunResult.status / AgentDoneEvent.reason / AgentErrorEvent / event
sequence.

OUTCOME: NOT EXECUTED in this ACT.

WHY:
  - The OWN01 RED test (sdk-session-event-coordinator.test.ts) exercises
    the adapter/translator/coord pathway with a stub session; the live
    trace rules out the maxIterations path (see §3 above).
  - Writing a real AgentRuntime RFS03 would require wiring a real model
    provider, a real tool set, and a real session through the SDK,
    which is not feasible in this read-only recon ACT.
  - The structural source walk has already produced a definitive
    answer (status="aborted" or "failed"; never "completed").

MARK: RFS03 = NOT_REPRESENTABLE without new infrastructure.
