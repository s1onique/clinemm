# 11 — Terminal reason matrix

Per ACT rubric §23 — classify every terminal reason for the
notify=true wake.

## 11.1 CommandJobState (from §3.5)

```text
- running
- exited
- deadline_exceeded
- cancelled
- spawn_failed
- containment_failed
```

## 11.2 Classification

```text
REASON              CLASS                       WAKE?
exited (0)          TERMINAL_AND_REPORTABLE      yes
exited (nonzero)    TERMINAL_AND_REPORTABLE      yes
deadline_exceeded   TERMINAL_AND_REPORTABLE      yes
cancelled           TERMINAL_AND_REPORTABLE      yes
                    (user-initiated)
spawn_failed        TERMINAL_AND_REPORTABLE      yes
containment_failed  UNSAFE_TO_DECLARE_TERMINAL   no (warn only)
```

## 11.3 Why containment_failed is UNSAFE

`containment_failed` is the post-`SIGTERM`+`SIGKILL` probe result
from the `CommandJobManager.finalize()` synchronous postcondition.
The job's `finalize()` returned `alive` / `eperm` / `unknown` (or
no PGID was resolvable). The bounded invariant
`CLEAN_TERMINAL CommandJob ⇒ PRIMARY OWNED PGID GONE` is NOT
proven. The job is still on the OS or unproven to be gone.

For a notify-on-terminal wake, declaring `containment_failed` as
"the command has finished and you can resume" would be
unsafe — the process tree may still be alive, and waking the
agent to act on a false "done" would be a worst-case UX.

Recommended v1 rule: do NOT wake on `containment_failed`. Emit
the existing warning through the existing diagnostic channels.
The job is still TERMINAL from the manager's perspective for
projection purposes; the wake just does not fire.

## 11.4 Deadline semantics (S3)

For Candidate B, `deadline_exceeded`:

```text
- The wake prompt content says: "Your background command
  {jobId} exceeded the host execution deadline. It has been
  terminated."
- The wake is delivered exactly once.
- The wake does NOT auto-retry; it is informational.
- If the model wants to retry, it can issue a new run_commands.
```

## 11.5 Cancel semantics (S4)

For Candidate B, `cancelled` (via `cancel_command`):

```text
- The wake prompt content says: "Your background command
  {jobId} was cancelled."
- The wake is delivered exactly once.
- Cancellation is initiated by the model (or by the user via the
  Cancel button), so this is a known event; the wake serves as
  confirmation.
```

## 11.6 Failure semantics (S2, S6)

For Candidate B, `exited (nonzero)` and `spawn_failed`:

```text
- The wake prompt content says: "Your background command
  {jobId} finished. Exit code: {exitCode}. Signal: {signal}.
  First lines of output: {outputTruncatedTail}."
- The wake is delivered exactly once.
- The wake enables the model to surface failure to the user
  without polling.
```

## 11.7 What this ACT freezes

```text
For Candidate B (v1):
  - Wake on: exited, deadline_exceeded, cancelled, spawn_failed.
  - Do NOT wake on: containment_failed (UNSAFE_TO_DECLARE_TERMINAL).

The wake prompt content is a bounded GENERATED PROMPT STRING
(per §15.7.2). It is NOT a typed payload; the
PendingPromptsController.enqueue seam accepts only prompt strings
({ prompt: string, delivery: "queue"|"steer", ... }). The wake
prompt carries:
  - jobId
  - terminalState (one of: exited, deadline_exceeded, cancelled,
    spawn_failed)
  - exitCode (when present)
  - signal (when present)
  - stdoutTail (bounded, last ~80 lines)
  - stderrTail (bounded, last ~80 lines)
  - elapsedMs

The "schema" of the wake prompt lives in CODE
(`formatTerminalWakePrompt` in the bounded implementation ACT),
NOT in the queue payload. The schema is testable and diff-stable
across versions. The previous "structured payload (not prose)"
wording is retracted; the correct wording is "bounded generated
prompt string, schema lives in code".

The exact prompt format is the responsibility of the bounded
implementation ACT, not this contract-selection ACT.
```
