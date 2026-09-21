# 14 — Contract decision (frozen)

This is the load-bearing artifact of this ACT. It is the
contract selection.

```text
SELECTED_CONTRACT = B

SELECTION_REASON:
  - Candidate B passes all ten rubric items D1-D10.
  - Candidate A fails D1, D4, D8 (observable user-visible mismatch).
  - Candidate C fails D9 (no existing suspended-tool state machine).
  - Candidate D fails D9 (inherits C).
  - B reuses existing seams (PendingPromptsController.enqueue,
    identity-correlating machinery, CommandJobManager.onTerminalEvent).
  - B is the smallest-scope change that distinguishes all three
    user intents (wait / notify / detach) via a structured schema
    field.

RATIONALE:
  - The fork's run_commands schema currently exposes NO user-intent
    flag (R3 in §3.7). Adding one boolean (`notifyOnCompletion`)
    is the smallest schema change that lets ClineMM honor the
    user's "wait until finished" intent without inventing
    a new suspended-tool state machine.
  - Default value (notifyOnCompletion=false) preserves the
    current canonical behavior (Candidate A) for backwards
    compatibility. Existing tasks that rely on the polling model
    continue to work.
  - User/model can opt into wake-on-terminal by passing
    `notifyOnCompletion: true`. The wake is one bounded stimulus
    delivered via PendingPromptsController.enqueue, exactly-once,
    bounded by sessionId/taskId/epoch identity tests.
  - The wake is structured (typed payload, not prose) so the
    model can react deterministically without parsing natural
    language.
```

## 14.1 Selected semantic table

| Intent (v1) | Schema flag | Model may end current turn? | Terminal wakes agent? | User receives immediate turn? | Strict WAIT promise? |
| ----------- | ----------- | --------------------------- | --------------------- | ----------------------------- | -------------------- |
| wait (maps to notify in v1)  | `notifyOnCompletion: true`  | yes  | yes, later           | yes (then wake arrives)       | NO (strict WAIT deferred to future cycle) |
| notify                       | `notifyOnCompletion: true`  | yes  | yes, later           | yes (then wake arrives)       | n/a                  |
| detach                       | `notifyOnCompletion: false` | yes  | no                   | yes                           | n/a                  |

**Amendment (correction cycle 01)**: the original WAIT row promised
"yes (then wake arrives)" — a contradiction with the strict WAIT
intent definition in §8.1 ("user sees final answer before Your turn
appears"). The honest v1 contract collapses WAIT(v1) to NOTIFY
semantics and names the strict WAIT semantic `STRICT_WAIT`, deferred
to a future cycle requiring the suspended-tool state machine
(Candidate C). The current row is now: "wait (maps to notify in
v1)" with the strict WAIT promise explicitly marked NO.

**Future-cycle row (NOT in v1 contract, recorded for traceability)**:
```text
| STRICT_WAIT (future cycle) | notifyOnCompletion:"wait" | yes (tool suspends) | yes (after wake on resume) | NO | YES |
```

## 14.2 USER_INTENTS (v1)

```text
WAIT (v1, honest collapse):
  User text: "Run this command and wait until it finishes, then
  tell me the result."
  Strict semantic (NOT honored in v1): agent resumes after terminal;
  user sees final answer before "Your turn" appears.
  Mapped to (v1): run_commands with notifyOnCompletion: true.
  Result (v1): identical to NOTIFY — model may end turn; agent
  receives one wake prompt at terminal; wake prompt contains the
  exit status + output tail; agent resumes in a NEW turn and
  informs the user. The user MAY see "Your turn" briefly before
  the wake turn (because the wake is delivery:"queue", not
  strict-synchronous).
  User-facing doctrine MUST state this honestly: WAIT(v1) honors
  the user's intent best-effort but does not block user control.

NOTIFY (v1):
  User text: "Start this in the background and tell me when it
  finishes."
  Mapped to: run_commands with notifyOnCompletion: true.
  Result: identical to WAIT(v1) — one wake at terminal.

DETACH (v1, default):
  User text: "Start this in the background and return immediately."
  Mapped to: run_commands with notifyOnCompletion: false (default).
  Result: identical to today's behavior — no wake, model responsible
  for polling if it cares.

STRICT_WAIT (future cycle, NOT v1):
  User text: same as WAIT.
  Strict semantic (honored if Candidate C architecture is funded):
  agent resumes after terminal; user sees final answer before
  "Your turn" appears.
  Mapped to: run_commands with notifyOnCompletion:"wait" (future).
  Result (future): tool call suspends; resumes on terminal; agent
  resumes in the SAME turn and informs the user; no "Your turn"
  interlude.
  Out of scope for v1. Tracked but not in §14-§18 contract.
```

## 14.3 MODEL_CONTRACT

```text
NEW INSTRUCTION (proposed wording, finalized in §15):

"For a long-running command, set notifyOnCompletion:true to
receive one completion notification when the command exits. The
notification carries the exit code, signal, and a bounded tail
of stdout/stderr. Default is false: no notification is sent and
the current behavior (poll via command_status or follow up
manually) applies. The notification is delivered at most once,
even if the command exits multiple times."
```

The model is told:
- The flag exists.
- The default is conservative.
- The wake is bounded (one, typed).
- Failure modes are reported.

The model is NOT told to "wait" via this flag. It is told to
REQUEST notification via this flag. The wait semantic is a
model-side interpretation of "I will wait for the wake."

## 14.4 RUNTIME_CONTRACT

```text
On the >0 -> 0 cardinal transition of a notifyOnCompletion=true job:

  if previousRunning && !running && taskId === undefined:
    if (notifyOnCompletion) {
        capture terminal payload (jobId, state, exitCode, signal,
        stdoutTail, stderrTail, elapsedMs)
        bind to (sessionId, taskId, epoch) of the originating
        CommandJob
        if conservation rules pass (sessionId matches, taskId
        matches, epoch matches, no other notify=true job still
        running for this owner):
            enqueue wake prompt on the owning session via
            PendingPromptsController.enqueue with
            delivery:"queue"
            (steer is NOT the default for v1; steer interrupts
            the user's current turn)
        else:
            hold the wake (multi-job case) or discard (supersession
            case) per the conservation rules
    }
```

The wake consumer is registered alongside the existing
turn-state consumer on the CommandJobManager's
`onCommandJobLifecycle` callback. Both consumers run
independently; the wake consumer's existence does not affect
the turn-state consumer.

## 14.5 TERMINAL_SUCCESS

```text
state = "exited", exitCode = 0:
  - wake prompt content: "Background command {jobId} finished
    successfully (exit 0)."
  - payload: { jobId, state, exitCode: 0, stdoutTail, stderrTail,
    elapsedMs }
  - wake delivered exactly once.
```

## 14.6 TERMINAL_FAILURE

```text
state = "exited", exitCode != 0:
  - wake prompt content: "Background command {jobId} finished
    with exit code {exitCode}."
  - payload: { jobId, state, exitCode, stdoutTail, stderrTail,
    elapsedMs }
  - wake delivered exactly once.

state = "spawn_failed":
  - wake prompt content: "Background command {jobId} failed to
    start: {error}."
  - payload: { jobId, state: "spawn_failed", error, elapsedMs }
  - wake delivered exactly once.

state = "containment_failed":
  - NO WAKE. Diagnostic warning only (per §11.3).
```

## 14.7 CANCEL

```text
User/model cancels via cancel_command:
  state transitions to "cancelled" via the existing lifecycle.
  - wake prompt content: "Background command {jobId} was
    cancelled."
  - payload: { jobId, state: "cancelled", stdoutTail, stderrTail,
    elapsedMs }
  - wake delivered exactly once.

Conservation rules apply (same identity test).
```

## 14.8 DEADLINE

```text
state = "deadline_exceeded":
  - wake prompt content: "Background command {jobId} exceeded the
    host execution deadline and was terminated."
  - payload: { jobId, state: "deadline_exceeded", exitCode, signal,
    stdoutTail, stderrTail, elapsedMs }
  - wake delivered exactly once.
  - The wake does NOT auto-retry; it is informational.

Conservation rules apply.
```

## 14.9 NEWER_TURN

```text
Per §10.3:
  - delivery = "queue" by default
  - the wake waits behind the user's current turn
  - drain delivers the wake after the current turn finishes with
    a non-error finishReason

Alternative delivery: "steer" interrupts the current turn. v1
recommends "queue" (less surprising to the user). This is a
product decision; the implementation ACT may expose the choice
via a separate knob (out of v1 scope).
```

## 14.10 MULTI_JOB

```text
Per §10.4:
  - The wake consumer reuses the
    `hasRunningBackgroundJobForOwner(activeSession.sessionId)`
    check.
  - If another notify=true job is still running for the owning
    session, the wake is HELD.
  - When the last notify=true job terminates, the held wakes are
    delivered together (in job-start order, FIFO).

v1 simplification: deliver one wake per terminal event for the
owning session. The held-wake case is correctly handled by the
existing `hasRunningBackgroundJobForOwner` invariant.
```

## 14.11 PERSISTENCE

```text
PERSISTENCE = EPHEMERAL_ONLY for v1 (per §12).

A wake that is in-flight at host restart is LOST. The user-facing
doctrine states this explicitly.
```

## 14.12 FIRE_AND_FORGET_CONSERVATION

```text
DEFAULT notifyOnCompletion = false.

This preserves today's behavior (Candidate A) for any existing
task that does not opt in. Fire-and-forget is the default, not
the exception.

Conservation invariant: the wake consumer MUST NOT fire for
any job whose notifyOnCompletion flag is false. The wake
consumer is a strict superset of the existing turn-state
consumer; the turn-state consumer runs unconditionally (the
awaiting_followup transition is the existing behavior).
```

## 14.13 IMPLEMENTATION_AUTHORIZED

```text
IMPLEMENTATION_AUTHORIZED = NO

This ACT freezes the contract. The bounded implementation ACT
(see §18-successor-authorization.md) is the next step. NO
production code is modified by this ACT.
```

## 14.14 Summary line for the result.json verdict

```text
SELECTED_CONTRACT = B (WS-B_EXPLICIT_NOTIFY_ON_TERMINAL)
DEFAULT = notifyOnCompletion=false (preserves current behavior)
PERSISTENCE = EPHEMERAL_ONLY (v1)
IMPLEMENTATION_AUTHORIZED = NO
PRODUCTION_CHANGE = NONE
```
