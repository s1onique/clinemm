# Causal Discriminator — AGCONT01

## The discriminator question

At the moment a CommandJob becomes terminal, is there a runtime
obligation to re-enter the agent?

## Discriminator 1: Is there an existing re-entry seam?

Method: Search for production call sites that invoke the agent
runtime (AgentRuntime.run / .send / .continue / session.runTurn)
in response to a CommandJob terminal event.

Result: NONE.

The CommandJobManager publishes terminal lifecycle events
(`command_job_terminal_committed`,
`command_job_primary_group_cleanup`). These are consumed by:

1. SdkController.handleCommandJobLifecycle → TaskTelemetryTracker
   (gauge projection only)
2. SdkController.updateBackgroundCommandState → cards projection
   + BTCONT01 bridge (turn-state projection only)

Neither path invokes AgentRuntime.run / .send / .continue.

The upstream Cline SDK's `background-terminal` plugin DOES emit a
steer_message into the owning session on terminal completion, but
that plugin is NOT integrated into ClineMM's run_commands tool
(it is a CLI plugin example).

## Discriminator 2: Is the agent turn genuinely complete?

Method: Trace the AgentRuntime's done semantics.

When the AgentRuntime emits `agent_event { type: "done" }`, the
runtime has decided the agent's responsibility for that turn is
fulfilled. This is a provider-agnostic end-of-turn signal at the
SESSION level (the session is still alive; the turn is done; the
runtime has emitted its final iteration event).

If the model emits `done`, the runtime MUST honor it as end-of-turn
or risk contradicting the model's state machine. The Q5 composition
seam at SdkSessionEventCoordinator:281 correctly honors `done`:

```
result.sessionEnded || result.turnComplete:
   if active phase is resumable: preserve (straggler)
   elif error was seen: setTurnPhase("error", ...)
   elif attempt_completion seen: setTurnPhase("completed", ...)
   elif background job running for owner: SUPPRESS awaiting_followup
        (record deferredContinuation marker)
   else: setTurnPhase("awaiting_followup", ...)
```

The "background job running for owner" branch is the Q5 SUPPRESS.
It defers the awaiting_followup phase transition. It does NOT
defer the agent's responsibility for the turn — the agent has
already declared itself done.

## Discriminator 3: Does the F4 doctrine say re-entry is required?

Method: Inspect the canonical run_commands tool description
(visible to the model).

Per `sdk/packages/core/src/extensions/tools/definitions.ts:669-676`:

> "For long-running commands, run them in background and redirect
>  output to a tmp file that you can read from later."

This is the F4 doctrine: the model is responsible for picking the
right execution mode AND for polling when the user asks to wait.

The doctrine does NOT say "the runtime will re-invoke the model
when the background command finishes." It says "the model should
poll."

## Discriminator 4: What if a re-entry seam were added?

Method: Walk through the consequences of adding
`session.send(steer_message)` to CommandJobManager.finalize().

For the "wait until it finishes" case (LIVE specimen), this would
correctly re-enter the agent and produce DONE: FINISHED.

For the "start and return" case (AGCONT-CTL-03), this would ALSO
re-enter the agent, contradicting the model's `attempt_completion`.
The model said "I'm done"; the runtime would say "no, do more".

This violates conservation C2 ("fire-and-forget: terminal event
does NOT resurrect completed agent") and is forbidden by the
ACT's stop rule:

> Do not:
> * wake the model for every terminal background job;

## Verdict

The runtime correctly honors the model's `done` event. The defect
is on the model side: the model violated the F4 doctrine by
yielding control prematurely. Adding a runtime re-entry seam
would resurrect the agent for the "start and return" case, which
violates the conservation matrix.

CASE_AC3_AGENT_TURN_GENUINELY_COMPLETE.

Per the ACT's stop rule, STOP.
