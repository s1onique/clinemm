# 14 — Contract decision (frozen)

This is the load-bearing artifact of this ACT. It is the
contract selection.

```text
SELECTED_CONTRACT = B (WS-B_EXPLICIT_NOTIFY_ON_TERMINAL)

SELECTION_REASON (post-CORRECTION02, honest v1 scope):
  - Candidate B passes all ten rubric items D1-D10 WHEN D1 is
    read as "D1a strict WAIT = OUT_OF_V1; D1b v1 WAIT(v1)→NOTIFY
    mapping = YES". The selection basis is: B is the bounded v1
    NOTIFY contract, not "B fully implements literal WAIT".
  - Candidate A fails D1, D4, D8 (observable user-visible
    mismatch with the runtime promise).
  - Candidate C fails D9 (no existing suspended-tool state
    machine — C is the architecture that WOULD enable
    STRICT_WAIT in a future cycle).
  - Candidate D fails D9 (inherits C).
  - B reuses existing seams (PendingPromptsController.enqueue,
    per-job CommandJobManager.onCommandJobLifecycle event,
    identity-correlating machinery at the coordinator seam).

RATIONALE (post-CORRECTION02, honest v1 scope):
  - The fork's run_commands schema currently exposes NO user-intent
    flag (R3 in §3.7). Adding one boolean (`notifyOnCompletion`)
    is the smallest schema change that lets ClineMM offer a
    bounded async terminal-notification contract in v1, WITHOUT
    inventing a new suspended-tool state machine.
  - WAIT(v1) HONESTLY collapses to NOTIFY semantics: the wake is
    a new turn delivered via PendingPromptsController.enqueue
    (delivery:"queue"), and the user may see "Your turn" briefly
    before the wake turn. This is NOT strict WAIT. Strict WAIT
    (STRICT_WAIT — "no Your turn before final answer") is
    deferred to a future cycle requiring the suspended-tool
    state machine (Candidate C architecture). The v1 user-facing
    doctrine states this honestly.
  - Default value (notifyOnCompletion=false) preserves the
    current canonical behavior (Candidate A) for backwards
    compatibility. Existing tasks that rely on the polling model
    continue to work.
  - User/model can opt into wake-on-terminal by passing
    `notifyOnCompletion: true`. The wake is one bounded
    GENERATED PROMPT STRING (per §15.7.2) delivered via
    PendingPromptsController.enqueue, exactly-once, bounded by
    (sessionId, taskId) identity tests per §10.8
    NOTIFICATION_LIFETIME_INVARIANT. (NB: the wake is NOT a
    typed payload — PendingPromptsController accepts only
    prompt: string. The "typed payload" claim is retracted.)
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

## 14.4 RUNTIME_CONTRACT (post-CORRECTION02)

```text
TRIGGER (per-job, exactly-once):
  The wake consumer subscribes to the per-job lifecycle event:
    CommandJobManager.onCommandJobLifecycle(
      event: { event: "command_job_terminal_committed",
               jobId, terminationReason, exitCode, signal, tsMs, ... })
  Source: apps/vscode/src/sdk/command-job-manager.ts:621-...
  Fires EXACTLY ONCE per terminal job.

  NOT the >0 -> 0 cardinal transition (which fires once when the
  LAST job disappears, not on each job's terminal — the previous
  freeze incorrectly conflated the two).

IDENTITY OWNER (coordinator seam, NOT CommandJob):
  On accepted background handoff with notifyOnCompletion:true:
    notificationMarkers.set(jobId, NotificationMarker{
      jobId, sessionId, taskId, notifyOnCompletion: true,
      createdAtMs: now
    })
  The marker is captured at the SdkSessionEventCoordinator seam
  where options.getTask?.()?.taskId is reachable. CommandJob does
  NOT carry taskId.

WAKE CONSUMER (handler on the per-job terminal event):

  for each "command_job_terminal_committed" event:
    j = the terminal job (jobId from event)
    marker = notificationMarkers.get(j.id)
    if marker === undefined OR marker.notifyOnCompletion === false:
      discard (DETACH intent or unknown job)
      return
    notificationMarkers.delete(j.id)

    Apply §10.8 NOTIFICATION_LIFETIME_INVARIANT:
      if marker.sessionId !== activeSession.sessionId: discard (different session)
      if marker.taskId    !== activeSession.getTask()?.taskId: discard (different task)
      if activeSession is undefined: discard (host shutdown / empty repo)
      NOTE: epoch is NOT used for the notify-on-terminal lifetime decision.

    // Compute other same-owner notify markers still active.
    otherNotifyCount = count(notificationMarkers.values()
      where m.sessionId === marker.sessionId
        AND m.taskId    === marker.taskId
        AND m.notifyOnCompletion === true)
    if otherNotifyCount > 0:
      HOLD wake for j in session/coordinator held set
        (FIFO list, keyed by jobId, marker.createdAtMs)
      return

    // j is the LAST same-owner notify=true job terminating.
    DRAIN held wakes for (marker.sessionId, marker.taskId) in FIFO
      for each held wake w:
        enqueue w via PendingPromptsController.enqueue(
          { prompt: formatTerminalWakePrompt(w.payload),
            delivery: "queue" })
    enqueue j's wake via PendingPromptsController.enqueue(
      { prompt: formatTerminalWakePrompt(j.payload),
        delivery: "queue" })

WAKE_PROMPT_FORMAT:
  See §15.7.2 — bounded generated prompt string (hard cap 8 KB,
  soft target 4 KB). NOT a typed payload.

COORDINATION:
  The wake consumer is registered alongside the existing
  turn-state consumer on CommandJobManager.onCommandJobLifecycle.
  Both consumers run independently. The wake consumer's existence
  does not affect the turn-state consumer.
```

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
Per §10.3 (Candidate B behavior) and §10.8 NOTIFICATION_LIFETIME_INVARIANT:
  - delivery = "queue" by default
  - the wake waits behind the user's current turn
  - drain delivers the wake after the current turn finishes with
    a non-error finishReason

LIFETIME: a wake is KEPT (not discarded) under a newer turn, iff
the wake's (sessionId, taskId) still match the active session and
active task. Per §10.8, EPOCH IS NOT USED as a "newer turn means
stale" discriminator for notify-on-terminal.

Alternative delivery: "steer" interrupts the current turn. v1
recommends "queue" (less surprising to the user). This is a
product decision; the implementation ACT may expose the choice
via a separate knob (out of v1 scope).
```

## 14.10 MULTI_JOB

```text
Per §15.7.3 (post-CORRECTION02 coordinator-owned active-notify set):
  - The coordinator owns BOTH the identity map AND the active-notify
    set (Map<jobId, NotificationMarker>).
  - If another same-owner notify=true job is still active, the wake
    for the terminating job is HELD in the session/coordinator
    held set (FIFO by createdAtMs).
  - When the LAST same-owner notify=true job terminates, all held
    wakes for that owner are drained in FIFO order via
    PendingPromptsController.enqueue (delivery:"queue"), followed
    by the current job's wake.

v1 simplification: the held set is bounded by max parallel jobs
(existing maxTerminalJobs limit). Wakes are dropped only when the
session ends (PERSISTENCE = EPHEMERAL_ONLY).
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

Conservation invariant (post-CORRECTION02):
  - The wake consumer MUST NOT fire for any job whose
    notificationMarker.notifyOnCompletion is false (i.e. the job
    is in DETACH intent, or it was never registered in the
    coordinator's notificationMarkers map).
  - The notify=true flag is captured in the COORDINATOR-OWNED
    notificationMarkers map (per §15.7.1 + §15.7.3), NOT on
    CommandJob. CommandJob's footprint is preserved.
  - The wake consumer is a strict superset of the existing
    turn-state consumer; the turn-state consumer runs
    unconditionally (the awaiting_followup transition is the
    existing behavior).
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
