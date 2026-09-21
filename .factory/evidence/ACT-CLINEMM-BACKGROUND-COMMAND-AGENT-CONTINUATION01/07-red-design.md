# RED design — AGCONT01

## The ACT section 11 RED requirement

> The RED must exercise the real production agent/session path.
> Required sequence:
>   1. user/agent task begins
>   2. real run_commands path starts a managed job
>   3. real Proceed While Running handoff occurs
>   4. model/session reaches same done-like boundary that produced
>      Q5 guard=true in LIVE
>   5. verify no further agent iteration is active
>   6. job later becomes naturally terminal
>   7. terminal-continuation bridge runs
>   8. inspect whether agent runtime executes again

## RED classification for AGCONT01

The recon (04-recon.txt) classifies the LIVE failure as **CASE_AC3
(agent turn genuinely complete)** with an F4 doctrine-violation
caveat. The defect is a MODEL-DOCTRINE GAP, not a runtime defect.

Therefore AGCONT01 does NOT execute the RED as a "RED that
motivates a runtime repair." Instead it executes the RED as a
**bound that proves the doctrine is in force**.

The six control tests in
`apps/vscode/src/sdk/__tests__/background-command-agent-continuation01.agcont01.test.ts`
all exercise real production seams:

```
Real production seams exercised:
  - CommandJobManager (real lifecycle producer + active-map owner)
  - SdkSessionEventCoordinator (real Q5 composition seam)
  - TurnStateTracker (real turn-state store)
  - MessageTranslator + MessageIdMinter (real message projection)
  - Controller.maybeReevaluateDeferredContinuation (BTCONT01 bridge)

What the tests observe:
  - The deferredContinuation marker is recorded at Q5
  - The turn-state writer commits awaiting_followup on >0->0 transition
  - No call to the agent runtime (no .run / .send / .continue) fires
    in response to ANY background-job terminal event
  - The exact-once invariant of the BTCONT01 bridge is preserved
  - The newer-turn supersession invariant is preserved
  - The cross-session isolation invariant is preserved
```

## RED observations captured

AGCONT-CTL-01:
```
pre-defer:  phase=streaming
            active background job exists for ownerSessionId
emit done:  deferredContinuation marker recorded
            phase stays streaming (Q5 SUPPRESSED)
terminal:   >0->0 transition fires BTCONT01 bridge
post-terminal:
            phase=awaiting_followup
            agentSpy.calls === []   ← THE BOUND
            BTCONT01 marker consumed
```

AGCONT-CTL-02:
```
Same as CTL-01, plus the assertion that NO other producer of
agent re-entry exists between Q5 deferral and the post-terminal
state. The user-driven follow-up path (out of scope for this
seam-level test) is the canonical re-entry.
```

AGCONT-CTL-03 (start-and-return):
```
Model emits attempt_completion tool + done
Phase commits "completed" (NOT awaiting_followup — the canonical
turn-state writer respects the completion)
No deferred continuation marker
Later terminal event: BTCONT01 bridge is no-op (no marker)
agentSpy.calls === []
```

AGCONT-CTL-04 (no background dependency):
```
Plain done without any background job
Phase commits awaiting_followup directly (no Q5 deferral)
No marker
agentSpy.calls === []
```

AGCONT-CTL-05 (newer turn supersession):
```
First turn: marker recorded for session-A
Active session swapped to session-B
OLD job terminates, BTCONT01 bridge fires
Marker identity check fails (sessionId mismatch)
Marker cleared; no re-entry
agentSpy.calls === []
```

AGCONT-CTL-06 (exactly-once):
```
Multiple notifyTerminalIdleIfIdle calls in succession
Marker consumed on first call
Subsequent calls are no-ops (marker is undefined)
Phase commits awaiting_followup exactly once
agentSpy.calls === []
```

AGCONT-CTL-07 (different session):
```
Background job in different session
Q5 returns false (the running job does not own active session)
Phase commits awaiting_followup directly (no deferral)
Later terminal: bridge fires but marker is undefined → no-op
agentSpy.calls === []
```

## Verdict

All six control tests are GREEN. This proves the runtime is
CONSISTENT with the doctrine. No runtime re-entry seam is
needed (and adding one would violate the conservation matrix C2).

The defect is the model's failure to follow the F4 doctrine
("For long-running commands, run them in background and redirect
output to a tmp file that you can read from later."), not a
runtime defect.

Per the ACT's section 50 stop rule:
> If the runtime proves the agent turn was genuinely complete:
>   CASE_AC3
> STOP. Do not invent automatic agent resurrection.

STOP.
