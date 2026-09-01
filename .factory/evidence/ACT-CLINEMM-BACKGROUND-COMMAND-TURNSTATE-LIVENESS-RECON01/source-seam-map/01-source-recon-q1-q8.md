ACT_ID    = ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01
SECTION   = PHASE_1 / SOURCE RECON
SUBJECT   = HEAD 2a0cfbd85848ec441f9f2aec84dc3564813bc0b2 (= origin/main)
DATE      = 2026-09-01

THIS FILE ANSWERS Q1..Q8 OF THE ACT MISSION.

================================================================
Q1. WHO SETS backgroundCommandRunning = true?
================================================================

SHORT ANSWER: The projection flips in `SdkController.updateBackgroundCommandState(running, taskId)`,
which is wired from the `onBackgroundStateChange` callback that the run_commands background path
fires when `commandJobManager.start(...)` returns a `state === "running"` result.

PRODUCTION CHAIN (REAL_PRODUCTION_SEAM, traced at HEAD 2a0cfbd85848ec441f9f2aec84dc3564813bc0b2):

  CommandJobManager.start(...)              apps/vscode/src/sdk/command-job-manager.ts:441
    returns StartCommandJobResult with:
      - state = "running"  (wait budget expired while job still alive)
      - becameActive = true  (this was the 0->1 cardinality transition)
      - terminalPromise: Promise<TerminalTransition>
      - jobId: string

  createVscodeRunCommandsTool(...)          apps/vscode/src/sdk/vscode-run-commands-tool.ts:113
    Background-mode execute path: line 591-693.

  background-mode execute (line 658-693):
    if (start.state === "running") {
      if (start.becameActive) {
        notifyBackgroundStateChange(true, start.jobId)   // line 668
      }
      start.terminalPromise.then(({becameIdle}) => {
        if (becameIdle) notifyBackgroundStateChange(false, undefined)  // line 680-684
      })
      return JSON.stringify(runningPayload)
    }

  notifyBackgroundStateChange(...)          apps/vscode/src/sdk/vscode-run-commands-tool.ts:618-628
    options.onBackgroundStateChange?.(running, jobId)

  onBackgroundStateChange wire              apps/vscode/src/sdk/vscode-runtime-builder.ts:76/125
                                              apps/vscode/src/sdk/vscode-session-host.ts:120 (pass-through)

  SdkController constructor wire            apps/vscode/src/sdk/SdkController.ts:1159-1163
    onBackgroundStateChange: (running, jobId) =>
      this.updateBackgroundCommandState(running, jobId)

  SdkController.updateBackgroundCommandState(...)  apps/vscode/src/sdk/SdkController.ts:3686-3698
    if (no-op transition) return
    this.backgroundCommandRunning = running     // <-- THE PROJECTION FLIP
    this.backgroundCommandTaskId  = taskId
    this.postStateToWebview().catch(...)        // debounced re-publication

PRODUCTION-SEAM PROOF (verified by direct grep against current HEAD):
  `grep -rn 'backgroundCommandRunning\s*=' apps/vscode/src` →
    only hit in production code is the line 3686/3687 read-back + line 3690 flip;
    the cancelBackgroundCommand site at line 2797 is the ONLY other production write,
    and it sets it to `false`.

The four writers/readers:
  READ     SdkController.getStateToPostToWebview()  line 3799
  WRITE+   SdkController.updateBackgroundCommandState  line 3690
  WRITE-   SdkController.cancelBackgroundCommand  line 2797
  CALLBACK CommandJobManager.start state="running"  vscode-run-commands-tool.ts:668

================================================================
Q2. AT THAT EXACT TRANSITION (background flips TRUE), WHAT HAPPENS TO TurnState?
================================================================

SHORT ANSWER: NOTHING. The background-state callback is a UI projection. It does NOT
interact with `turnStateTracker` or `messageTranslatorState` or any TurnState producer.

PROOF — read `SdkController.updateBackgroundCommandState` end-to-end
(apps/vscode/src/sdk/SdkController.ts:3686-3698):

    updateBackgroundCommandState(running: boolean, taskId?: string): void {
        if (this.backgroundCommandRunning === running && this.backgroundCommandTaskId === taskId) {
            return
        }
        this.backgroundCommandRunning = running
        this.backgroundCommandTaskId  = taskId
        this.postStateToWebview().catch(...)
    }

That body:
  - does NOT call turnStateTracker.set(...)
  - does NOT call turnStateTracker.setWithWriter(...)
  - does NOT call messageTranslatorState anything
  - does NOT call setRunning(false|true) on the SdkSessionLifecycle
  - does NOT call sessions.handleSessionEvent
  - does NOT emit any CoreSessionEvent

It only updates the two projection fields + posts state. The comment block above it
(apps/vscode/src/sdk/SdkController.ts:3680-3684) is explicit about this being a
projection-only seam.

ACL02's structural-absence finding
(`apps/vscode/src/sdk/__tests__/acl02-runtime-seam.c24-c-bridge.test.ts:152-186`)
is the documentary witness for this property:

    "the background-execution pipeline ends at
     `SdkController.updateBackgroundCommandState`,
     which only updates a UI projection."

So the answer to Q2 is precise:
  TurnState is unchanged at the moment the background flips to TRUE.
  Whatever TurnState was BEFORE the run_commands call returns RUNNING(jobId)
  is what TurnState still is AFTER.

================================================================
Q3. DOES foreground→background PROMOTION INTENTIONALLY RELEASE THE AGENT WHILE
    PRESERVING A RUNNING JOB?
================================================================

YES — by construction.

The wait budget is the load-bearing mechanism. Default = DEFAULT_WAIT_BUDGET_MS
(= 15s, defined in apps/vscode/src/sdk/command-job-manager.ts).

When `manager.start()` returns a `state === "running"` envelope:

  apps/vscode/src/sdk/vscode-run-commands-tool.ts:594-606

    "WAIT_BUDGET_MS (default 15s) controls how long this tool invocation waits
     before returning control to the model. Expiry does NOT terminate the
     process — the tool returns RUNNING + jobId.

     EXECUTION_DEADLINE_MS (default 10 min) is the host-owned maximum
     lifetime. Expiry terminates the owned process tree and records
     DEADLINE_EXCEEDED. The model may follow up via the `command_status` tool."

The tool returns `JSON.stringify({status:"running", jobId, elapsedMs,
deadlineRemainingMs, outputTruncated, stdout})` to the model (line 685-693). The
model then sees `{status:"running", jobId: <id>}` and is expected to follow up
via `command_status` when it wants to learn the outcome. THIS IS THE INTENDED
INTENTIONAL DETACHMENT.

The host DOES NOT block the model turn on the running job — the agent loop resumes
immediately after the tool call returns. The process is owned by CommandJobManager
and supervised under the execution deadline.

So the contract is unambiguous:
  - HOST_DEFERRED_FOREGROUND: foreground run_commands auto-crossed the wait budget →
    the tool returns RUNNING(jobId) autonomously, model turns over to either
    follow-up or end-turn
  - MODEL_INTENTIONAL_BACKGROUND: model formulates detached execution + persists
    output (the "long-running → redirect to tmp file → read later" pattern)

The tool description (validated by ACL06 in async-command-turn-liveness.acl01.test.ts)
documents the MODEL_INTENTIONAL_BACKGROUND intent. The schema (validated by ACL04)
does NOT carry a typed `intent` field — so the two cases are not yet
distinguishable to a downstream tool-policy consumer.

For the current ACT the precise answer to Q3 is:

  YES, foreground→background promotion INTENTIONALLY releases the agent turn.
  The model receives `{status:"running", jobId}` and is expected to continue
  without further synchronous blocking. The process stays alive under
  CommandJobManager.

  That is a HOST_DEFERRED_FOREGROUND transition.

================================================================
Q4. IS TurnState "idle" INTENDED TO MEAN:
    (a) model idle
    (b) turn idle
    (c) no foreground tool
    (d) task fully quiescent?
================================================================

We have to derive this from the producer side, not from naming.

The TurnState producers (read from `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`
and `apps/vscode/src/sdk/sdk-task-control-coordinator.ts` and
`apps/vscode/src/sdk/SdkController.ts`):

  Phase-transition writes to `turnStateTracker` (all writers enumerated in
  `apps/vscode/src/shared/turn-state-writer-provenance.ts`):

    writerId                                                | trigger
    --------------------------------------------------------+-------------------------
    "task-start-init-task"                                  | new turn → streaming
    "controller-ask-response"                               | user answer → streaming
    "session-event-turn-complete-completed"                 | agent done with completion → completed
    "session-event-turn-complete-awaiting-followup"         | agent done w/o completion → awaiting_followup
    "session-event-turn-complete-awaiting-followup-liveness"| done w/o completion + no terminal
    "session-event-turn-complete-resumable-straggler-..."   | straggler rescue → awaiting_followup
    "session-event-turn-complete-resumable-yield-..."       | resumable yield → resumable
    "session-event-pending-prompt-submitted"                | provider-failure retry → streaming
    "task-control-resumable-ask"                            | ask user → resumable
    "task-control-cancel-task"                              | cancel → resumable
    "task-control-clear-task"                               | clear → idle
    "task-control-show-task"                                | show → idle
    "followup-on-follow-up-abandoned"                       | followup abandoned → idle
    "followup-on-resume-failed"                             | resume failed → error
    "controller-on-send-error"                              | send error → error
    "controller-epoch-transition-reseed"                    | epoch reseed → idle

  The `idle` writes (filtered to writers that explicitly write idle):
    - "task-control-clear-task"
    - "followup-on-follow-up-abandoned"
    - "controller-epoch-transition-reseed"

  The `setRunning(false)` path (apps/vscode/src/sdk/sdk-session-lifecycle.ts:139-148)
    activeSession.isRunning = false
    options.onDidBecomeIdle?.()   <-- SdkController.handleSessionBecameIdle
                                  <-- SdkController.sessionRebuilds.sessionBecameIdle()
                                  <-- NO TurnState write at this exact moment

  THE `idle` WRITE is reserved for:
    - clearTask / epoch-reseed / explicit followup-abandoned.
    It is NOT used to mean "model stream finished"; that path
    writes `awaiting_followup` (with `done-without-completion` semantics) or
    `completed` (with attempt_completion) per the
    `session-event-turn-complete-*` writerIds above.

So "idle" semantically means:
  (b) turn-idle AND task-active  (no model stream in flight, no completion-anchored
                                   followup pending, no resumable ask in flight)
                                   but the task is still the active task
                                   (currentTaskItem is still set)

It does NOT mean:
  - "no background job" (backgroundCommandRunning is independent)
  - "no foreground terminal command" (foregroundCommandRunning is independent)
  - "task fully quiescent" (the task may have a live background job)

The webview UI consumers (ActionButtons + Composer) check independent ownership:
  apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts:399-426
    case "idle":  return BUTTON_CONFIGS.default      // NO Cancel
  apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts:435-446
    getButtonConfigFromState(messages, turnState, mode, foregroundCommandRunning)

So the design says: "idle" means model/turn-quiet. The Cancel button does NOT
account for backgroundCommandRunning — there is a separate Cancel-background-command
button flow (apps/vscode/src/core/controller/task/cancelBackgroundCommand.ts →
apps/vscode/src/sdk/SdkController.cancelBackgroundCommand at line 2767-2799).

================================================================
Q5. IS A BACKGROUND COMMAND CONSIDERED PART OF THE SAME ACTIVE TURN?
================================================================

NO (by the producer side).

A `run_commands` call that returns RUNNING(jobId) is:
  - Synchronously: a tool call that the agent issued during its turn
  - Asynchronously: a process whose lifetime is decoupled from the turn

The producer-side evidence:

  apps/vscode/src/sdk/vscode-run-commands-tool.ts:594-606 (comment block):
    "WAIT_BUDGET_MS (default 15s) controls how long this tool invocation waits
     before returning control to the model. Expiry does NOT terminate the
     process — the tool returns RUNNING + jobId.
     EXECUTION_DEADLINE_MS (default 10 min) is the host-owned maximum lifetime."

  apps/vscode/src/sdk/vscode-run-commands-tool.ts:685-693:
    return JSON.stringify(runningPayload)
    // The model receives `{status: "running", jobId: "..."}` and is
    // expected to either follow up with `command_status` or end the turn.

  apps/vscode/src/sdk/sdk-foreground-command-coordinator.ts:39-54
  (foreground path — for comparison):
    register(handle): const wasRunning = this.isRunning; ...
    return () => { ... notifyIfChanged(wasRunningBefore) }
    // The foreground path uses handle.detach() for "Proceed While Running",
    // which PRESERVES the foreground command's terminal-emission status.

The CONTRACT distinction is unambiguous in source:
  Foreground command running → foregroundCommandRunning = true
                                    ↳ drives UI button "Proceed While Running"
                                    ↳ BUTTON_CONFIGS.foreground_command_running
  Background command running → backgroundCommandRunning = true
                                    ↳ drives UI button "Cancel Background Command"
                                    ↳ in `useMessageHandlers.ts:569-572` only when
                                      backgroundCommandRunning is true

But NEITHER foregroundCommandRunning NOR backgroundCommandRunning is wired into the
TurnState pipeline. Neither producer mutates `turnStateTracker`. The two projection
flags are pure UI side-effects, with their own independent handlers.

So the producer-side contract says: a background command is NOT part of the same
active turn. TurnState and backgroundCommandRunning are orthogonal.

================================================================
Q6. DOES COMMAND DETACHMENT RETURN A TOOL RESULT SUCH AS "RUNNING", CAUSING
    NORMAL TOOL COMPLETION TO SET TurnState IDLE?
================================================================

PARTIALLY YES — and this is the load-bearing chain for the live defect.

Tool-result handling for a `run_commands` tool call that returns RUNNING(jobId):

  apps/vscode/src/sdk/vscode-run-commands-tool.ts:658-693
    // RUNNING: model receives {status:"running", jobId, ...}
    if (start.becameActive) notifyBackgroundStateChange(true, start.jobId)
    start.terminalPromise.then(({becameIdle}) => {
        if (becameIdle) notifyBackgroundStateChange(false, undefined)
    })
    return JSON.stringify(runningPayload)

The tool returns its payload SYNCHRONOUSLY to the agent loop. After this tool
return, the agent loop continues — it sees `{status: "running", jobId}` and may
either:
  (a) end the turn with a text response (so the session-event-coordinator
      handler at sdk-session-event-coordinator.ts:166-228 fires
      `setTurnPhase("awaiting_followup", ...)` per
      `session-event-turn-complete-*` writerId),
  (b) call `command_status` (which is a new tool call → another synchronous
      tool invocation → another return envelope, etc.),
  (c) call other tools / end the turn with attempt_completion,
  (d) stay silent (the harness drives the agent forward).

In production, when the model decides the background work is fine and the
agent's turn reaches its natural end (the typical post-background pattern: the
model says "the dev server is starting in the background; I'll check on it when
needed"), the session-event-coordinator receives an `agent_event` of type "done"
with the appropriate reason — which transitions `TurnState → awaiting_followup`
(or `completed` if attempt_completion was used).

CRITICAL: NEITHER the foreground→background promotion NOR the
run_commands RUNNING(jobId) return envelope sets TurnState to "idle" directly.
The "idle" writers are:
  - "task-control-clear-task"
  - "followup-on-follow-up-abandoned"
  - "controller-epoch-transition-reseed"

NONE of these are triggered by `commandJobManager.start(...)` returning
`{state: "running"}`. So the live defect is NOT that "tool result RUNNING
causes TurnState to be set to idle" — that direct causal chain does not exist.

The actual sequence (from the live specimen) appears to be:

  1. Agent emits run_commands with a long-running dev server
  2. CommandJobManager.start(...) returns {state: "running", jobId}
  3. run_commands tool returns JSON.stringify({status:"running", jobId, ...})
     to the model
  4. Model emits a final assistant text (no attempt_completion,
     no ask_question)
  5. Agent.run() completes with finishReason="awaiting_followup"
  6. LocalRuntimeHost.completeInteractiveTurn → markTurnIdle (line 2164)
     ↳ THIS is where session.status flips to "idle" on the canonical substrate
  7. Canonical event "agent_event:done" propagates back to the host
     through the proxy/subscription path
     (apps/vscode/src/sdk/runtime-events-proxy.ts + vscode-session-host.ts:543)
  8. SdkSessionEventCoordinator.handleSessionEvent receives agent_event:done
     ↳ at apps/vscode/src/sdk/sdk-session-event-coordinator.ts:166-228
     ↳ since there was a committed terminal response (or via the
       "done-without-completion" → awaiting_followup yield), it writes
       TurnState = awaiting_followup
  9. The model turn is over. The next user message sends the task back into
     a new turn cycle. The background job continues to live under
     CommandJobManager.

  But the operator's live specimen shows:
    turnPhase = idle  (NOT awaiting_followup)

  This is interesting — the live specimen sees `idle`, not `awaiting_followup`.
  That means the model either:
    (a) hit the `done-without-completion` path and got "resumable" / "idle"
        through a different writer (epoch-reseed, followup-abandoned,
        clear-task),
    OR
    (b) the agent_event:done was processed but the session-event-coordinator's
        setTurnPhase("awaiting_followup") fired on a different epoch than
        the publication (so the webview's epoch-rejection filter dropped it),
    OR
    (c) there was a sequence where clearTask or epoch-reseed ran AFTER the
        `awaiting_followup` write, washing the phase back to idle.

  This is one of the discriminator questions for PHASE 4 / CAUSAL DISCRIMINATOR.
  The exact transition is currently UNKNOWN — there is no in-production trace
  instrumentation that captures which writerId fired on which epoch.

================================================================
Q7. IS THERE ANY LATER EVENT THAT RE-RAISES TurnState WHILE THE BACKGROUND
    JOB IS STILL ACTIVE?
================================================================

NO (in the existing producer surface).

Producers enumerated in §Q4 above. None of them reads `backgroundCommandRunning`
or `commandJobManager.getActiveJobIds()` or any other background-job liveness
indicator. The TurnStateTracker is therefore unaffected by background-job
completion, cancellation, or re-promotion.

In particular:
  - `terminalPromise.then(...)` at vscode-run-commands-tool.ts:680-684 fires
    `notifyBackgroundStateChange(false, undefined)` (the projection reset),
    but that callback does NOT touch turnStateTracker.
  - `cancelBackgroundCommand` at SdkController.ts:2767-2799 sets
    `this.backgroundCommandRunning = false`, no TurnState mutation.
  - The async-terminal-event listener (if any existed) would NOT raise
    TurnState; ACL02 STRUCTURAL ABSENT witness confirms there is no
    async-terminal successor surface.

So: as long as no NEW turn begins (user message → streaming), the background
job's completion or cancellation does NOT re-raise TurnState. The
backgroundCommandRunning projection is decoupled.

================================================================
Q8. WHO CONSUMES BACKGROUND COMPLETION AND DOES IT BELONG TO THE ORIGINAL
    TURN OR A SEPARATE ASYNC LIFECYCLE?
================================================================

There are TWO consumers of background completion:

  (A) The UI projection (backgroundCommandRunning flip back to false):
      apps/vscode/src/sdk/vscode-run-commands-tool.ts:680-684
        start.terminalPromise.then(({becameIdle}) => {
            if (becameIdle) notifyBackgroundStateChange(false, undefined)
        })
      This is a UI-projection-only consumer; it does NOT touch TurnState,
      does NOT touch the agent loop, does NOT trigger any followup.

  (B) The command_status tool (apps/vscode/src/sdk/command-status-tool.ts):
      This is an explicit polling surface; the model calls it during a future
      turn to query a specific jobId's state. It returns a JSON envelope;
      it does NOT touch TurnState.

  (C) The cancel_command tool (apps/vscode/src/sdk/command-status-tool.ts):
      Same as command_status but mutating.

There is NO consumer that "promotes background completion back to TurnState".
The async-terminal-event-driven agent-wakeup is STRUCTURAL ABSENT per ACL02.

The async lifecycle is therefore:

  Original turn
    -> run_commands tool call
    -> CommandJobManager.start(...)
    -> state="running" envelope returned to model
    -> backgroundCommandRunning flips TRUE
    -> agent turns may continue / end naturally
    -> background process continues under CommandJobManager
    -> at some point (deadline_exceeded / exit_code / cancel) the process
       completes
    -> start.terminalPromise.then(({becameIdle}) => ...) fires
    -> backgroundCommandRunning flips FALSE
    -> ... and that is it. The original turn is over. The agent does not
       re-wake.

If the user then sends a new message, a new turn starts. That new turn starts
with `TurnState = streaming` (writerId "controller-ask-response" or
"task-start-init-task"). The background job may or may not still be alive
(if `becameIdle` already flipped it to false, the job completed;
if `becameIdle` has not yet fired, the job may still be in flight).

So the background completion belongs to a SEPARATE async lifecycle from
the original turn. The producer-side contract is consistent with this:
  - TurnState is per-turn bookkeeping
  - backgroundCommandRunning is per-process-bookkeeping owned by CommandJobManager
  - These two are orthogonal.

================================================================
SUMMARY OF THE 8 RECON ANSWERS
================================================================

Q1.  backgroundCommandRunning = true is set in
     SdkController.updateBackgroundCommandState (line 3690),
     triggered by the onBackgroundStateChange callback fired
     at vscode-run-commands-tool.ts:668 when CommandJobManager.start
     returns state="running" with becameActive=true.

Q2.  At the exact transition: NOTHING happens to TurnState.
     updateBackgroundCommandState is a projection-only seam.
     TurnState is unchanged from its pre-tool-call value.

Q3.  Foreground→background promotion IS intentional detachment:
     the wait budget expires, the tool returns RUNNING(jobId),
     the model resumes control, the process continues under
     CommandJobManager until the execution deadline.

Q4.  "idle" means model/turn-quiet. Background jobs are separate
     bookkeeping. The semantic intent is (b) turn-idle, NOT (d)
     task fully quiescent.

Q5.  A background command is NOT considered part of the same
     active turn. The producer-side contract treats the two as
     orthogonal: TurnState per-turn, backgroundCommandRunning
     per-process.

Q6.  The tool result RUNNING(jobId) does NOT directly set TurnState
     to idle. The actual cause of the observed `idle` is downstream:
     the agent's natural turn end (model emits final text or stays
     silent) -> agent_event:done -> setTurnPhase("awaiting_followup")
     or a "done-without-completion" liveness yield. The exact
     transition to "idle" (and not "awaiting_followup") in the live
     specimen is UNKNOWN at this recon level.

Q7.  NO event re-raises TurnState while a background job is alive.
     The TurnStateTracker has no producer that reads background-job
     state. The projection reset (backgroundCommandRunning flips to
     false) does NOT touch TurnState.

Q8.  The async-terminal completion has TWO consumers:
     (A) UI projection reset (backgroundCommandRunning flip back to false)
     (B) command_status / cancel_command polling tools
     It does NOT belong to the original turn -- it is a separate
     async lifecycle. The original turn ended when the model issued
     its terminal text (or fell silent); the background process
     continues independently under CommandJobManager.

================================================================
END OF SOURCE RECON Q1..Q8
================================================================