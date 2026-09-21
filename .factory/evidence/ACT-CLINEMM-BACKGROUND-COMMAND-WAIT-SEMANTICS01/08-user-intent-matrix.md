# 08 — User-intent matrix

Three independent user intents, mapped against the four candidates.

**Amendment (correction cycle 01, post Factory review)**:
The original matrix exposed a contradiction between the WAIT intent
defined here and the WAIT row of Contract B. The packet honestly
collapses WAIT(v1) to NOTIFY semantics and defers the strict WAIT
promise to a future cycle. See §20.3 for the full rationale.

## 8.1 The three intents

```text
I1 WAIT (v1: UNSUPPORTED as the strong semantic; honest collapse to NOTIFY)
  User text example: "Run this command and wait until it finishes,
  then tell me the result."
  Observable promise (strict, NOT v1):
    agent resumes after terminal; user sees final answer before
    "Your turn" appears (when combined with completion).
  v1 mapping:
    Maps to I2 (NOTIFY). The strong "no Your turn before final answer"
    semantic requires a suspended-tool state machine (Candidate C) that
    the runtime does not have and that is out of v1 scope. v1 user-facing
    doctrine must state this explicitly so users are not surprised.

I2 NOTIFY (v1: PRIMARY contract)
  User text example: "Start this in the background and tell me when
  it finishes. I want to keep working meanwhile."
  Observable promise: agent may yield current turn; on terminal,
  agent gets one bounded continuation (one wake prompt) to inform
  the user.

I3 DETACH (v1: DEFAULT, preserves current behavior)
  User text example: "Start this in the background and return
  immediately. Do not notify me when it ends."
  Observable promise: no agent resurrection; user retains control.

Future-cycle intent (NOT in v1; named for traceability):
  STRICT_WAIT (future):
    notifyOnCompletion:"wait". Strict "final answer before Your turn"
    promise. Requires suspended-tool state machine (Candidate C).
    Out of scope for v1. Tracked but NOT in §14-§18 contract.
```

## 8.2 Candidate × Intent matrix

```text
                I1 WAIT (v1)       I2 NOTIFY (v1)     I3 DETACH (v1)
Candidate A     not honored (live  honored via model  honored
                specimen proved    polling; model     (default)
                model emits done   responsible)
                without polling)

Candidate B     maps to I2         honored via one    honored
                (honest collapse   wake at terminal  (notify=false)
                in v1)             (notify=true)

Candidate C     honored (the       honored (notify    honored
                tool call          path becomes a     (await=false)
                suspends and       corner case of
                resumes on         C)
                terminal)

Candidate D     honored (wait      honored (notify    honored
                mode)              mode)              (detach mode)
```

## 8.3 Failure modes the matrix exposes

```text
A on I1:  The model says "let me wait" and stops polling after 2
          polls. User sees "Your turn" with no result. ← observed.

A on I2:  Same as I1. The model emits done; the agent gets no
          late stimulus; user has to check command_status manually.

A on I3:  Works correctly by accident — the runtime's default
          behavior matches the user request.

B on I1:  Maps to I2 — wake arrives AFTER Your turn. Strict WAIT
          promise is not honored in v1; user-facing doctrine must
          state this.

B on I2:  Honors the request IF notify=true; otherwise the same
          gap as A. ← product surface decision needed.

B on I3:  Honors by default (notify=false is the recommended
          default for backwards compatibility; can be flipped).

C on I1:  Honors the request; tool call suspends. ← requires new
          suspended-tool state machine.

C on I2:  Awkward — notification is an explicit model-visible
          action; suspending the tool call is too strong.

C on I3:  Honors (await=false).

D on I1:  Honors (wait mode). ← requires C's architecture.

D on I2:  Honors (notify mode). ← requires B's implementation.

D on I3:  Honors (detach mode).
```

## 8.4 What this means for the contract decision

- Candidate A fails I1 (WAIT) and I2 (NOTIFY) in observable ways.
- Candidate B honors I2 (NOTIFY) and I3 (DETACH) IF the schema
  exposes the opt-in. I1 (WAIT) is honestly mapped to I2 in v1;
  strict WAIT requires Candidate C (architecture not present).
- Default = notify=false (matches A's current behavior on I3) keeps
  backwards compatibility. notify=true activates the wake.
- Candidate C is correct only for I1 (strict WAIT); awkward for I2.
- Candidate D is correct for all three but inherits C's
  architecture gap.

**Decision implication**: this ACT freezes Candidate B as v1's
contract, with the WAIT(v1) intent honestly mapped to NOTIFY semantics
and the strict WAIT semantic (STRICT_WAIT) named as a future-cycle
item. The default behavior is explicitly set to match today's
(notify=false = current behavior). The user/model can opt into
wake-on-terminal by setting notify=true.
