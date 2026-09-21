# 04 — Model contract recon

Every model-visible instruction about background commands, classified.

## 4.1 Source: `run_commands` tool description (F4)

**Location**: `sdk/packages/core/src/extensions/tools/definitions.ts:669-676`

The full description is in §3.1. The sentence about background
commands is:

```text
"For long-running commands, run them in background and redirect
output to a tmp file that you can read from later."
```

**Classification**: **RECOMMENDATION**

Why:
- The verb "run them in background" is an instruction, not a
  description of what the runtime does. It tells the model how to
  structure its command (use &, redirect to /tmp/foo, etc.).
- The phrase "redirect output to a tmp file" tells the model where
  to capture output that exceeds the wait budget / output cap.
- The phrase "read from later" tells the model that it may (and
  should) re-read the file in a subsequent turn.

What F4 does NOT say:
- F4 does NOT say "the runtime will notify you when the command
  finishes."
- F4 does NOT say "you MUST poll until the command finishes."
- F4 does NOT say "you may emit `done` while a background command
  is in flight."
- F4 does NOT distinguish `wait`, `notify`, or `detach` semantic.

## 4.2 Source: `command_status` tool description

**Location**: `apps/vscode/src/sdk/command-status-tool.ts:104-110`

```text
"Inspect the state of a long-running shell command previously launched
via run_commands. ... does not terminate the child. To terminate a
running command, use cancel_command."
```

**Classification**: **DESCRIPTION**

Observes the model-visible boundary: command_status is read-only and
does not terminate. The model can poll for completion without going
through command-policy approval.

## 4.3 Source: `cancel_command` tool description

**Location**: `apps/vscode/src/sdk/command-status-tool.ts:169-174`

```text
"Terminate a long-running shell command previously launched via
run_commands. Pass the jobId returned by run_commands. The owned
process tree is terminated via SIGTERM, escalating to SIGKILL
after a short grace period. Idempotent: re-cancelling an
already-terminal or already-cancelled job is a no-op."
```

**Classification**: **DESCRIPTION** of authority (mutating) and
idempotency.

## 4.4 What the model-visible instructions collectively establish

```text
ESTABLISHED:
  - Long-running commands may be backgrounded by the model itself
    (using shell redirection).
  - The CommandJobManager is the host-owned authoritative lifetime
    of a backgrounded run_commands invocation.
  - command_status is the model-facing polling primitive.
  - cancel_command is the model-facing termination primitive.

NOT ESTABLISHED:
  - The runtime does NOT promise the model a re-entry stimulus on
    terminal.
  - The runtime does NOT forbid the model from emitting `done`
    while a background command is in flight.
  - The runtime does NOT expose any user-intent flag (wait / notify
    / detach / completionBehavior).
  - There is no obligation on the model to poll, nor is there a
    promise of late notification.
```

## 4.5 What the LIVE specimen demonstrated

The LIVE 480s specimen (cmd_muac7cvi11hmne3x, AGCONT01) showed:

```text
User: "Run this command and wait until it finishes.
       sh -c 'echo STARTED; sleep 480; echo FINISHED'"

Model said:
  "The command is running. Let me wait for it to finish."
  "Still running. Let me wait longer."

Model emitted: done

Observed:
  - The model claimed it would wait.
  - The model stopped polling after 2 polls.
  - The model emitted done WITHOUT attempting completion (no
    attempt_completion content_end).
  - The command eventually finished naturally (sleep 480 elapsed).
  - BTCONT01 fired; awaiting_followup committed.
  - No agent iteration produced the "FINISHED" output.
```

This specimen proves (per AGCONT01):
- F4 is descriptive, not prescriptive — the model can interpret
  "wait" however it wants, including by abandoning the wait.
- The runtime has no obligation machinery to enforce a "wait"
  contract that F4 does not establish.
- The user's expectation "wait until finished" was NOT met by the
  model; this is a model-doctrine gap (model emitted done without
  observing the terminal), not a runtime defect.

**For the contract decision**: this specimen is the load-bearing
argument that Candidate A (model-polling-only) depends on the model
doing something it has demonstrated it cannot reliably do for
multi-minute waits.

## 4.6 Classification table

```text
| Instruction                                | Class          |
|-------------------------------------------|----------------|
| "long-running … run in background …"      | RECOMMENDATION |
| "redirect output to a tmp file"            | RECOMMENDATION |
| "read from later"                          | RECOMMENDATION |
| command_status exists (read-only polling)  | DESCRIPTION    |
| command_status does not terminate          | DESCRIPTION    |
| cancel_command terminates                  | DESCRIPTION    |
| cancel_command is idempotent                | DESCRIPTION    |
| runtime notifies on terminal               | ABSENT         |
| runtime forbids done while running         | ABSENT         |
| runtime exposes wait/notify/detach flag    | ABSENT         |
```

## 4.7 What this means for the contract decision

If ClineMM wants the runtime to take responsibility for any
"wait"-class obligation, the contract must include BOTH:
- a new model-visible schema field or instruction, AND
- a new runtime seam that consumes it.

The F4 description is the only existing surface for this. It is a
RECOMMENDATION, not a contract. Reframing it as a contract is a
product decision.
