# Hypotheses — AGCONT01

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

## Selection

The closest match is **AC3 (CASE_AC3_AGENT_TURN_GENUINELY_COMPLETE)**,
qualified by AC6 (the model-runtime contract is intentionally
non-polling at the runtime layer; the polling contract is on the
model).

## Implication for repair authorization

Per the ACT's section 50 stop rule:

> If the runtime proves the agent turn was genuinely complete:
>   CASE_AC3
> STOP.

STOP.

The "Your turn" + 480s silent job behavior is the correct runtime
response to a `done` event from the AgentRuntime. The defect is
on the model side (the model should not have yielded). Adding a
runtime re-entry seam would resurrect the agent for the
"start and return" case, violating the ACT's conservation matrix
(C2).
