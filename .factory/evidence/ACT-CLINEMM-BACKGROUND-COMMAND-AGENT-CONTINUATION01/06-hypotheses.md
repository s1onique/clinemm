# Hypotheses — AGCONT01

> **SUPERSEDED BY CORRECTION CYCLE 2 (Factory reviewer, 2026-09-21):**
>
> The original "AC3 PARTIALLY TRUE + AC6 TRUE" selection is superseded.
> The bounded observation distinguishes two questions:
>
> 1. Did the current agent turn end? **YES** (model emitted done).
> 2. Did ending that turn legitimately discharge the user's
>    outstanding "wait until finished" obligation? **UNKNOWN**.
>
> The runtime's structural choice to NOT re-enter the agent on
> terminal is canonical but does NOT prove it discharges the user's
> obligation. The broader product question is
> HALT_PRODUCT_CONTRACT_REQUIRED.

## AC1 — agent obligation is lost at Q5 deferral
**Status**: NOT REPRODUCIBLE.

The deferredContinuation marker carries { sessionId, taskId, epoch }.
This is sufficient identity to correlate a terminal event with the
original deferring turn. The marker is NOT a re-entry handle, but
that is orthogonal: if re-entry were required, a seam could be
built on top of the marker identity.

The marker DOES NOT encode "the agent owes work to be resumed" — it
encodes "the awaiting_followup phase transition is owed." These
are distinct concepts, but neither is "lost" at Q5.

## AC2 — obligation exists but terminal event does not wake agent
**Status**: NOT REPRODUCIBLE.

The CommandJobManager publishes the terminal lifecycle (active
count goes from >0 to 0). The SdkController routes this through
`updateBackgroundCommandState(false, undefined)` (line 4183-4207).
The BTCONT01 fix added the consumer `reevaluateDeferredContinuation()`
(line 4200) that wakes the turn-state projection. There is no
analogous consumer that wakes the agent runtime. This is a missing
feature, not a missing consumer for an existing wake.

Adding such a consumer would:
- Create a new mechanism (Section 22 of ACT forbids direct
  CommandJobManager -> model.run wiring; require existing
  re-entry API).
- Be conservatively forbidden: it would resurrect the agent
  for the "start and return" semantic (C2 conservation).

## AC3 — agent correctly finished its turn
**Status**: PARTIALLY TRUE.

The AgentRuntime emitted `done` because the model chose to. The
runtime's contract is:

- `done` ⇒ agent considers its turn complete
- `awaiting_followup` ⇒ user may respond
- `streaming` ⇒ model is producing output

These three phases form the canonical turn-state machine. The
model's `done` was a legitimate end-of-turn event from the
runtime's perspective.

However, the model's INTENT (per its own prose) was to continue
waiting. The model did not follow its own intent. This is a
model-side failure, not a runtime defect.

## AC4 — originating tool-call identity is lost
**Status**: NOT REPRODUCIBLE.

CommandJob has jobId; session has sessionId; TaskProxy has taskId.
The CommandJob's ownerSessionId field is preserved end-to-end.
The toolCallId binding between the run_commands tool call and
the spawned CommandJob is NOT preserved, but if a re-entry
mechanism were added, the sessionId alone would be sufficient —
the re-entry message can reference the jobId without knowing
which run_commands tool call spawned it.

## AC5 — re-entry exists but is rejected by stale generation/epoch
**Status**: NOT REPRODUCIBLE.

No re-entry seam exists at all. The epoch check in
`reevaluateDeferredContinuation` (line 187-191) is healthy.

## AC6 — model/runtime policy intentionally stops polling
**Status**: TRUE.

The model's `done` event is the runtime's signal that the agent
considers its turn finished. The runtime has no authority to
re-invoke the model. The doctrine (F4 in 04-recon.txt) says the
model should poll; the model did not poll enough.

The runtime is acting correctly per the canonical turn-state
machine.

## AC7 — other proven cause
**Status**: NULL.

## Selection (CORRECTION CYCLE 2)

The bounded observation matches **AC3** in the narrow sense that
the agent's current turn genuinely ended (model emitted done).
The runtime's structural choice to NOT re-enter the agent on
terminal is canonical.

But the bounded observation does NOT match AC3 in the broader
sense that "ending the turn legitimately discharged the user's
'wait until finished' obligation." The user's outstanding work
remained MISSING after natural completion. The structural absence
of a re-entry seam is canonical but does NOT establish that the
user's intent was honored.

The combined AC3 + AC6+ observation is therefore:

```
CURRENT_TURN_ENDED = PROVEN (bounded)
USER_WAIT_OBLIGATION_DISCHARGED = UNPROVEN (HALT_PRODUCT_CONTRACT_REQUIRED)
```

## Implication for repair authorization (CORRECTION CYCLE 2)

Per the ACT's section 50 stop rule (bounded):

> If the runtime proves the current agent turn genuinely ended:
>   CASE_AC3 (bounded)
> STOP. Do not invent automatic agent resurrection under THIS ACT's scope.

STOP.

Per the ACT's section 50 stop rule (broader):

> If product semantics cannot distinguish:
>   wait for result
> from:
>   fire-and-forget
> STOP

The product semantics in ClineMM's run_commands path genuinely
cannot distinguish these at the runtime level. STOP.

**The "Your turn" + 480s silent job behavior is the canonical
runtime response to a `done` event from the AgentRuntime, but it
is NOT established that this is the correct product semantic for
the user's "wait until finished" intent. That is a separate
product question: ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01.**
