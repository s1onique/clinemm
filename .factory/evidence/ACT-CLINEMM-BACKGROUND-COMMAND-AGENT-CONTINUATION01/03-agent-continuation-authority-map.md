# Agent Continuation Authority Map — AGCONT01

Edge labels: REAL_PRODUCTION_SEAM (verified), STRUCTURAL (named but not
necessarily observed LIVE), LIVE (observed in the BTCONT01 specimen and
frozen here), LIVE_UNOBSERVABLE (LIVE but cannot be re-observed without
operator action), INFERRED (deduced from code).

## Chain 1 — Model iteration termination (the "done" boundary)

The model emits natural-language text and possibly tool calls. The agent
runtime normalizes provider finish reasons to a single canonical
"done" event:

```
provider stream end
  -> AgentRuntime emits agent_event { type: "done" }
       (sdk/packages/agents/src/agent-runtime.ts)
  -> RuntimeEventAdapter / HubRuntimeHost forward as:
       CoreSessionEvent { type: "agent_event", payload: { event: { type: "done", ... } } }
  -> SdkSessionEventCoordinator.handleSessionEvent
       (apps/vscode/src/sdk/sdk-session-event-coordinator.ts:232)
  -> MessageTranslator.translateSessionEvent marks result.turnComplete = true
       (apps/vscode/src/sdk/message-translator.ts:2222-2225)
  -> SdkSessionEventCoordinator enters the result.turnComplete branch
       (apps/vscode/src/sdk/sdk-session-event-coordinator.ts:281)
  -> "done-without-completion" sub-branch at line 308 fires
       ownerStillRunning = options.hasRunningBackgroundJobForOwner(...)
  -> IF ownerStillRunning === true:
       record deferredContinuation marker (BTCONT01)
       SUPPRESS awaiting_followup (LIVE - BTCONT specimen row 1)
  -> ELSE:
       setTurnPhase("awaiting_followup", "session-event-turn-complete-...")
       (LIVE - BTCONT specimen rows post-terminal)
```

Question A: Did the model emit end_turn, tool_use, done?
Answer (LIVE): "done" — the agent's `run()` returned. The agent runtime
itself considered the turn complete and emits the `done` event as the
final iteration boundary. The provider's stop_reason was already mapped
inside the AgentRuntime; by the time the runtime emits `done`, it has
already decided the agent's responsibility for this turn is fulfilled.

This is the load-bearing fact for AC3 vs AC6 discrimination: a `done`
event from the AgentRuntime is an end-of-turn signal at the SESSION
level, NOT at the TURN level. The session is still alive; the turn is
done; further turns require an external stimulus (user message, queued
prompt, OR an architectural re-entry seam).

## Chain 2 — Q5 input semantics (`awaiting_followup`)

`setTurnPhase("awaiting_followup", ...)` writes a single
`TurnStateTracker` field. The phase is consumed by:
- the webview footer (Your turn / Waiting indicator)
- the TSWPD ring (forensic observation)
- the session-event-projector (legacy compat)

It does NOT mean:
- the agent runtime is suspended awaiting resume
- a re-entry stimulus is queued
- a tool continuation is pending
- the model can resume without an external stimulus

It DOES mean (per the canonical turn-state machine):
- the user can send a follow-up message (which the
  SdkFollowupCoordinator / SdkTaskStartCoordinator will translate to
  a new turn)
- the model is idle until then

This is the load-bearing distinction of the ACT (section 20 of the
freeze). `awaiting_followup` is a USER-FACING phase, not an
AGENT-RESUMING phase.

## Chain 3 — Existing agent re-entry mechanisms

Inventory of production seams that can restart AgentRuntime.run() for
the SAME session without a fresh user message:

```
1. Pending prompts queue
   apps/vscode/src/sdk/... PendingPromptsController
   apps/vscode/src/sdk/... sdk-task-start-coordinator
   - drains queued user messages via session.send
   - NOT a runtime continuation seam; requires a queued user prompt

2. SdkFollowupCoordinator.continueIdleSession
   apps/vscode/src/sdk/sdk-followup-coordinator.ts
   - invoked by askResponse (user-driven)
   - invokes host.prepareTaskResumeStartInput
   - NOT automatic

3. hooks
   sdk/packages/core/src/hooks/...
   - agent_end / agent_start hooks can emit automation events
   - NOT bound to background-job terminal events

4. team-runtime mailbox / team_progress
   sdk/packages/core/src/extensions/tools/team/multi-agent.ts
   - mailbox delivery can re-enter the team coordinator
   - NOT a background-command terminal seam

5. background-terminal plugin (UPSTREAM EXAMPLE, NOT INTEGRATED)
   sdk/examples/plugins/background-terminal.ts
   - upstream uses steer_message into owning session on terminal
   - this is a CLI plugin example, not production runtime
```

There is NO existing production seam that maps a CommandJob terminal
event to "AgentRuntime: please re-run so the model can observe the
terminal result." The architecturally closest pattern (upstream CLI
plugin) does this via text-prompt steer, but that pattern requires a
fresh prompt to be injected into the conversation.

## Chain 4 — Background command terminal data

At the moment of terminality (CommandJobManager.finalize), the
runtime has:
- jobId (LIVE, BTCONT01 freeze)
- ownerSessionId (LIVE, BTCONT01 freeze)
- taskId (correlatable via session)
- state final (LIVE: exited / deadline_exceeded / cancelled)
- exitCode / signal (available via CommandJob.getStateSnapshot())
- output log paths (canonical under `<globalStorage>/tasks/<taskId>/...`)
- activeCommandJobs count (the >0->0 cardinal signal wired to
  SdkController.updateBackgroundCommandState)

The originating toolCallId is NOT preserved at the manager level —
the CommandJob does not know which run_commands tool call spawned it.
The toolCallId binding is lost between the message-translator and the
CommandJobManager.

## Chain 5 — Streaming ownership distinction

TurnStateTracker.currentPhase has no discriminator between:
- "agent runtime is actively streaming the next model response"
- "Q5 deferred the previous turn's awaiting_followup while a
   background job is alive"

Both states present as `currentPhase === "streaming"`. The only
runtime state that distinguishes them is the
`SdkSessionEventCoordinator.deferredContinuation` marker (added by
the BTCONT01 fix) and the `hasRunningBackgroundJobForOwner` lookup
itself.

This means: even if a re-entry mechanism existed and fired on the
terminal event, it would have NO discrimination primitive that says
"this deferral was a wait-until-finished obligation" vs "this
deferral was a fire-and-forget with the model having voluntarily
yelled at the user mid-stride."

## Chain 6 — Verdict

The runtime has:
- the identity (jobId, ownerSessionId, taskId, epoch) to correlate
  a terminal event with a specific session/turn;
- the deferred-continuation marker to know that a Q5 deferral is
  pending;
- a canonical turn-state writer that commits awaiting_followup on
  the >0->0 transition (BTCONT01 GREEN);
- NO representation that distinguishes "wait until finished" from
  "fire and forget";
- NO production agent-runtime continuation seam bound to background
  command terminal events;
- NO pre-existing primitive that asks the model to inspect the
  CommandJob state when the job becomes terminal.

The two facts together imply:

- If "wait until finished" is a ClineMM product contract, then a new
  re-entry seam IS required, AND a new discrimination primitive IS
  required so that fire-and-forget does not resurrect the agent.

- If "wait until finished" is NOT a product contract (the model is
  expected to keep polling and the user is expected to nudge it back
  on resume), then no repair is required and the LIVE behavior is
  correct. The model should call `get_command_output` or similar
  before yielding, or the user must explicitly resume.

The question for the ACT's C-section is: does ClineMM have any
production doctrine that distinguishes these two contracts? If yes,
we can repurpose an existing primitive. If no, we must HALT.
