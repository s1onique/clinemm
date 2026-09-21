STRUCTURAL NO-INVOCATION RECON - AGCONT01
==========================================

> **CORRECTION CYCLE 2 NOTE (Factory reviewer, 2026-09-21):**
>
> The original "Conclusion (load-bearing)" section at the bottom
> of this file claimed the structural recon establishes the
> CASE_AC3_AGENT_TURN_GENUINELY_COMPLETE classification. That is
> replaced. The structural recon establishes ONLY:
>
>   1. ClineMM's run_commands terminal path leads to
>      setTurnPhase("awaiting_followup", ...) and stops.
>   2. There is no consumer of "background-terminal" events that
>      calls the agent runtime, emits pending_prompt / steer_message,
>      or invokes host.runTurn / session.runTurn / agent.send.
>   3. The upstream example plugin with notifyParent IS NOT used by
>      ClineMM's run_commands.
>
> It does NOT establish that this structural absence is the correct
> product semantic for the user's "wait until finished" intent.
> The bounded observation under this ACT is that the current
> implementation has no automatic re-entry seam. Whether that is
> the correct product semantic is HALT_PRODUCT_CONTRACT_REQUIRED
> (successor ACT: ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01).

Per the Factory reviewer correction cycle 1:

  "I would NOT require another synthetic test merely to prove
   absence of a call site. Structural recon can prove no
   terminal->AgentRuntime consumer exists."

This document is the load-bearing argument for the structural
absence claim. The product-semantics claim is NOT load-bearing
on this evidence alone.

## Chain: from background-terminal event to AgentRuntime

The ClineMM run_commands tool's terminal event path is:

  vscode-run-commands-tool.ts:636
    options.onBackgroundStateChange?.(running, jobId)
   ->
  SdkController.ts:1309
    onBackgroundStateChange: (running, jobId) =>
        this.updateBackgroundCommandState(running, jobId)
   ->
  SdkController.ts:4183 updateBackgroundCommandState
    Controller.maybeReevaluateDeferredContinuation(
      previousRunning, running, taskId, this.sessionEvents)
   ->
  SdkController.ts:4240 maybeReevaluateDeferredContinuation
    if (previousRunning && !running && taskId === undefined) {
        sessionEvents.reevaluateDeferredContinuation()
    }
   ->
  sdk-session-event-coordinator.ts:160 reevaluateDeferredContinuation
    this.options.setTurnPhase?.(
        "awaiting_followup", undefined,
        "session-event-turn-complete-resumable-straggler-preserve")
   ->
  turnStateTracker.setWithWriter(phase, ...)
  -- (TURN-PHASE WRITE; NO AGENT RUNTIME CALL)

There is NO hop that calls host.runTurn, agent.send,
enqueuePendingPrompt, emitEvent("steer_message"),
emitEvent("pending_prompt"), or any equivalent agent-runtime
re-entry API.

## Grep evidence: absence of AgentRuntime consumer

Searching every production file in apps/vscode/src/sdk/ for
agent-re-entry call sites in the background-terminal chain:

  $ grep -rn 'enqueuePendingPrompt|pending_prompt|steer_message|host.runTurn|session.runTurn|host.resume|agent.send|sendMessage|sessionEvents.runTurn' \
      apps/vscode/src/sdk/vscode-run-commands-tool.ts \
      apps/vscode/src/sdk/command-job-manager.ts \
      apps/vscode/src/sdk/vscode-session-host.ts \
      apps/vscode/src/sdk/vscode-runtime-builder.ts \
      apps/vscode/src/sdk/sdk-session-event-coordinator.ts \
      apps/vscode/src/sdk/SdkController.ts | grep -v test

  Output (only passive event observers; no emitters):
    sdk-session-event-coordinator.ts:243:
      if (event.type === "pending_prompts")
    sdk-session-event-coordinator.ts:259:
      if (event.type === "pending_prompt_submitted")
    sdk-session-event-coordinator.ts:541:
      event.type === "pending_prompt_submitted"
    sdk-session-event-coordinator.ts:727:
      if (event.type === "pending_prompts")
    sdk-session-event-coordinator.ts:735:
      if (event.type === "pending_prompt_submitted")

All five are READ-ONLY handlers (Logger.log / setTurnPhase /
clearTurnOutcome). None of them emit a pending_prompt / steer
message or invoke the agent runtime.

## Grep evidence: absence in vscode-run-commands-tool.ts

  $ grep -n 'onBackgroundStateChange|runTurn|sendMessage|enqueuePendingPrompt' \
      apps/vscode/src/sdk/vscode-run-commands-tool.ts

  108:  onBackgroundStateChange?: (running: boolean, jobId: string | undefined) => void
  636:   options.onBackgroundStateChange?.(running, jobId)
  639:   options.onBackgroundStateChange callback threw (running=...)

Only the callback DEFINITION, the FIRE, and the ERROR handler.
No agent runtime call.

## Grep evidence: absence in command-job-manager.ts

  $ grep -n 'runTurn|sendMessage|enqueuePendingPrompt|emitEvent' \
      apps/vscode/src/sdk/command-job-manager.ts

  No matches.

## What vscode-run-commands-tool.ts DOES do on terminal

  1. options.onBackgroundStateChange(false, undefined) fires
     (only on the >0->0 cardinal transition, the BTCONT01 condition).
  2. The callback goes to SdkController.updateBackgroundCommandState.
  3. updateBackgroundCommandState calls
     maybeReevaluateDeferredContinuation(previousRunning, false, undefined, ...).
  4. That calls sessionEvents.reevaluateDeferredContinuation().
  5. That commits awaiting_followup to TurnStateTracker.

Nothing else happens. There is no agent runtime call anywhere in
this chain.

## What the upstream background-terminal EXAMPLE PLUGIN does

The upstream sdk/examples/plugins/background-terminal.ts is a
SEPARATE plugin with its own start_background_command and
get_background_command tools. It defaults notifyParent: true
and on terminal emits a steer_message event via the plugin host.

ClineMM does NOT register this plugin. ClineMM uses its OWN
run_commands tool (the F4 doctrine tool) which has a different
shape (no notifyParent parameter, no jobId).

  $ grep -rn 'start_background_command|notifyParent|get_background_command' \
      apps/vscode/ --include='*.ts' | grep -v test

  No matches.

Therefore the upstream example's automatic-continuation pattern is
NOT applied to ClineMM's run_commands.

## Conclusion (load-bearing) — CORRECTION CYCLE 2

The structural recon establishes the STRUCTURAL OBSERVATION:

  1. ClineMM's run_commands terminal path leads to
     setTurnPhase("awaiting_followup", ...) and stops.
  2. There is no consumer of "background-terminal" events that
     calls the agent runtime, emits pending_prompt / steer_message,
     or invokes host.runTurn / session.runTurn / agent.send.
  3. The upstream example plugin with notifyParent IS NOT used by
     ClineMM's run_commands.

The structural argument is sufficient to prove the production
absence of automatic agent re-entry on background-terminal events.
The unconnected agentSpy in the AGCONT01 focused test suite is
corroborating evidence, not load-bearing.

The structural argument does NOT establish the product-semantics
claim. See correction cycle 2 banner at top.

## Remaining open question (product semantics) — CORRECTION CYCLE 2

The F4 quote does NOT establish a categorical prohibition on
automatic re-entry. It tells the model "use tmp file" but does
not forbid the runtime from adding a notify-on-terminal pattern.

The structural recon confirms ClineMM's runtime HAS NO such pattern
(by absence), but does not prove such a pattern is forbidden by
doctrine. The right interpretation is:

  - Structural observation: NO automatic re-entry seam exists.
  - Doctrinal observation: F4 puts the background command management
    burden on the MODEL (tmp-file convention), but does not
    categorically forbid the runtime from adding notify-on-terminal.
  - Product question (out of scope for AGCONT01): should ClineMM
    adopt an opt-in notify-on-terminal pattern (model-side opt-in,
    perhaps gated by a per-tool parameter), matching the upstream
    example plugin? That is a product-surface decision, not a
    runtime defect.

The AGCONT01 ACT halts with the bounded observation:

  - CURRENT_TURN_ENDED                     = PROVEN (model emitted done)
  - TERMINAL_TO_AGENT_REENTRY_SEAM_EXISTS  = ABSENT (proved structurally)
  - BTCONT_TURN_STATE_CONTINUATION         = PASS (BTCONT01 GREEN)
  - WAIT_UNTIL_FINISHED_PRODUCT_CONTRACT   = UNRESOLVED

The ACT halts with HALT_PRODUCT_CONTRACT_REQUIRED on the
broader question (successor ACT:
ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01).

A successor ACT for the product-surface question would need:
  - product-management input on the desired semantics
  - UX design for how the user opts in
  - cost/benefit analysis vs the F4 tmp-file convention
