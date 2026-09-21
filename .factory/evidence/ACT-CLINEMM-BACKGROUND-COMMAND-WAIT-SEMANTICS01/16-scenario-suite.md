# 16 — Scenario suite (frozen, correction cycle 01)

Eleven scenarios from the ACT body §30, mapped against the
selected Contract B.

For each scenario: agent wake, user notification, "Your turn"
timing, terminal result owner.

**Amendment (correction cycle 01)**:
- S1-S4 originally tested "wait + outcome"; they are retitled
  to "NOTIFY (via wait intent, v1 honest collapse)" to reflect
  that WAIT(v1) collapses to NOTIFY semantics. Strict WAIT
  (no Your turn interlude) is unsupported in v1.
- S7/S8 retained — they test DETACH (the default).
- S9 (newer user turn before terminal): corrected to use the
  correct delivery:"queue" behavior.
- S10 (two background jobs): corrected to use PER-JOB terminal
  events (`command_job_terminal_committed`) rather than the
  >0→0 cardinal transition.
- S11 (extension restart): unchanged.
- S1, S7, S9: terminal-event language corrected to match §15.7.3.

## 16.1 S1 — NOTIFY (via WAIT intent, v1 honest collapse) + natural success

```text
Setup:
  User: "Run this and wait until it finishes."
  (v1 collapses this to NOTIFY semantics — see §8.1, §14.1.)
  Model: run_commands { commands: ["sleep 5; echo done"], notifyOnCompletion: true }
  Model: emits done

Flow:
  - command starts, becomes RUNNING
  - model yields (emits done)
  - turn-state commits awaiting_followup (existing BTCONT01 path)
  - User sees "Your turn" briefly (existing awaiting_followup state)
  - command exits 0
  - "command_job_terminal_committed" event fires (per-job, exactly once)
  - notifyOnCompletion:true → wake consumer fires
  - otherNotifyCount = 0 (only one job) → no hold
  - PendingPromptsController.enqueue with delivery:"queue"
  - session is idle (no current turn); drain runs immediately
  - wake prompt delivered as a new turn (bounded generated prompt
    string per §15.7.2)
  - agent resumes, observes the wake payload, may run follow-up
    tools (read_files, etc.) and produce the final answer

Answers:
  agent wake:     yes (one wake at terminal)
  user notify:    yes (via the wake turn's output)
  Your turn:      yes (briefly between done and wake; then wake turn)
                 NOTE: this is the v1 NOTIFY semantic. Strict WAIT
                 ("no Your turn before final answer") is unsupported
                 in v1 — see §8.1 STRICT_WAIT.
  terminal owner: the wake consumer (subscribed to
                  CommandJobManager.onCommandJobLifecycle event
                  "command_job_terminal_committed")
```

## 16.2 S2 — NOTIFY (via WAIT intent) + nonzero exit

```text
Setup:
  User: "Run this and wait until it finishes."
  Model: run_commands { commands: ["false"], notifyOnCompletion: true }
  Model: emits done

Flow:  same as S1 with exit code 1.

Answers:
  agent wake:     yes (exit code 1 in wake payload)
  user notify:    yes (via the wake turn's output)
  Your turn:      yes (briefly, then wake turn)
                 (NOTIFY v1 semantic — strict WAIT unsupported)
  terminal owner: the wake consumer
```

## 16.3 S3 — NOTIFY (via WAIT intent) + deadline

```text
Setup:
  User: "Run this and wait until it finishes."
  Model: run_commands { commands: ["sleep 9999"], notifyOnCompletion: true,
                        bashTimeoutMs: 30000 }
  The command is backgrounded after wait budget; runs in background
  until host execution deadline.

Flow:
  - command becomes RUNNING
  - model yields
  - command exceeds EXECUTION_DEADLINE_MS → state = deadline_exceeded
  - "command_job_terminal_committed" event fires
  - notifyOnCompletion:true → wake consumer fires
  - wake prompt content says "exceeded the host execution deadline
    and was terminated" (per §15.7.2 deadline_verb)

Answers:
  agent wake:     yes (deadline_exceeded in wake payload)
  user notify:    yes (via the wake turn's output)
  Your turn:      yes (briefly, then wake turn)
  terminal owner: the wake consumer
```

## 16.4 S4 — NOTIFY (via WAIT intent) + explicit cancel

```text
Setup:
  User: "Run this in background, then cancel it after 30 seconds."
  Model: run_commands { commands: ["sleep 9999"], notifyOnCompletion: true }
  Model: emits done
  Model: 30 seconds later (new turn), cancel_command { jobId }

Flow:
  - command becomes RUNNING
  - model yields
  - user-initiated cancel
  - state = cancelled
  - "command_job_terminal_committed" event fires
  - notifyOnCompletion:true → wake consumer fires
  - wake prompt content says "was cancelled" (per §15.7.2)

Answers:
  agent wake:     yes (cancelled in wake payload)
  user notify:    yes
  Your turn:      yes
  terminal owner: the wake consumer
```

## 16.5 S5 — notify + natural success

```text
Setup:
  User: "Start this and tell me when it finishes."
  Model: run_commands { commands: ["sleep 5; echo done"], notifyOnCompletion: true }
  Model: emits done

Flow:  identical to S1 (notify=true == wait=true in v1).

Answers:
  agent wake:     yes
  user notify:    yes
  Your turn:      yes (briefly, then wake turn)
  terminal owner: the wake consumer
```

## 16.6 S6 — notify + failure

```text
Setup:  similar to S5 with exit code 1.

Answers:
  agent wake:     yes (exit code 1 in wake payload)
  user notify:    yes
  Your turn:      yes (briefly, then wake turn)
  terminal owner: the wake consumer
```

## 16.7 S7 — detach + natural success

```text
Setup:
  User: "Start this in background, return immediately, don't notify."
  Model: run_commands { commands: ["sleep 5; echo done"],
                        notifyOnCompletion: false }   ← default

Flow:
  - command becomes RUNNING
  - model yields
  - command exits 0
  - "command_job_terminal_committed" event fires (per-job, exactly once)
  - notifyOnCompletion:false → wake consumer discards the event
    (per §15.7.3: j.notifyOnCompletion !== true → discard)
  - awaiting_followup committed by existing turn-state consumer
  - user can poll command_status or follow up manually

Answers:
  agent wake:     no (notifyOnCompletion is false)
  user notify:    no (existing awaiting_followup transition is the
                only user-visible signal)
  Your turn:      yes (briefly between done and terminal)
  terminal owner: the turn-state consumer (existing BTCONT01 path)
```

## 16.8 S8 — detach + failure

```text
Setup:  similar to S7 with exit code 1.

Answers:
  agent wake:     no
  user notify:    no
  Your turn:      yes
  terminal owner: the turn-state consumer
```

## 16.9 S9 — newer user turn before terminal (post-CORRECTION02)

```text
Setup:
  T1: run_commands { commands: ["sleep 600"], notifyOnCompletion: true }
  T1: model emits done → awaiting_followup
  T2: user sends unrelated prompt → new turn starts
  ... command exits 0 ...

Flow (post-CORRECTION02, per §15.7.3 + §10.8 lifetime invariant):
  - Background handoff accepted:
    notificationMarkers.set(jobId, {jobId, sessionId, taskId,
                                    notifyOnCompletion: true,
                                    createdAtMs: now})
  - T2 starts (existing runTurn path). T2 may bump the epoch.
  - command exits 0 during T2
  - "command_job_terminal_committed" event fires (PER-JOB, exactly once)
  - wake consumer reads marker from notificationMarkers map
    (NOT from CommandJob)
  - §10.8 NOTIFICATION_LIFETIME_INVARIANT:
      marker.sessionId === activeSession.sessionId   → KEEP
      marker.taskId    === activeSession.taskId      → KEEP
      (T2 may have bumped the epoch; epoch is NOT used for
       notify-on-terminal lifetime decision — see §10.8)
  - delivery:"queue" → wake joins the existing PendingPromptsController
    queue
  - T2 finishes (non-error)
  - drain runs; wake prompt is delivered as a new turn

Answers:
  agent wake:     yes (kept across newer turn; waits behind T2)
  user notify:    yes (after T2 completes)
  Your turn:      yes (after T2's completion and before wake turn)
  terminal owner: the wake consumer
  lifetime:       KEPT (per §10.8); NOT discarded by epoch bump

NOTE (post-CORRECTION02): The previous S9 used `>0 -> 0` cardinal
transition AND epoch-based discard. Both were stale. The corrected
S9 uses the per-job `command_job_terminal_committed` event (per
§15.7.3) and the §10.8 lifetime invariant (per-session + per-task
identity, NO epoch). T2 bumping the epoch does NOT discard the
wake.
```

## 16.10 S10 — two background jobs (per-job terminal events)

```text
Setup:
  J1: run_commands { commands: ["sleep 5"], notifyOnCompletion: true }
  J2: run_commands { commands: ["sleep 10"], notifyOnCompletion: true }
  Model emits done.

Flow (corrected — uses per-job terminal events per §15.7.3):
  - J1, J2 both RUNNING in CommandJobManager.active
  - J1, J2 identity captured at coordinator seam
    (sessionId, taskId, epoch, notifyOnCompletion) per §15.7.1
  - model yields
  - J1 exits 0
  - "command_job_terminal_committed" event fires for J1 (per-job)
  - wake consumer: j=J1, notifyOnCompletion:true
    otherNotifyCount = 1 (J2 still running, notify=true)
    → HOLD wake for J1 in session/coordinator held set
  - J2 exits 0
  - "command_job_terminal_committed" event fires for J2 (per-job)
  - wake consumer: j=J2, notifyOnCompletion:true
    otherNotifyCount = 0 (J1 is gone)
    → DRAIN held wakes: J1 (FIFO first) → enqueue
    → enqueue J2's wake
  - both wakes delivered in FIFO order via PendingPromptsController.enqueue

Answers:
  agent wake:     yes (two wakes, in job-start order)
  user notify:    yes (via the wake turns)
  Your turn:      yes (briefly between done and the first wake;
                  then each wake turn follows in turn)
  terminal owner: the wake consumer (per-job terminal events)
  held set:       session/coordinator seam, FIFO by createdAtMs

NOTE (corrected): the original S10 incorrectly described the
>0→0 cardinal transition firing twice. That transition fires ONCE
when the LAST job disappears. The corrected flow uses the
per-job "command_job_terminal_committed" event, which fires
exactly once per terminal job. The held set + FIFO drain
correctly handles the multi-job case.
```

## 16.11 S11 — extension restart

```text
Setup:
  T1: run_commands { commands: ["sleep 600"], notifyOnCompletion: true }
  T1: model emits done
  User restarts VS Code (extension host restarts).

Flow:
  - Before restart: CommandJob still RUNNING in CommandJobManager
  - Extension host shutdown terminates the process group via the
    existing cleanup path
  - On restart: CommandJobManager rebuilds with empty state
  - The original CommandJob is gone (in-memory only, ephemeral)
  - User sees awaiting_followup from before the restart
  - User can send a follow-up; agent gets a new turn
  - The wake is LOST (PERSISTENCE = EPHEMERAL_ONLY per §12)

Answers:
  agent wake:     NO (wake lost on restart)
  user notify:    YES (user sees awaiting_followup; can follow up)
  Your turn:      YES (existing awaiting_followup from before restart)
  terminal owner: N/A (no terminal event happened on the original
                job's identity; the job was force-terminated by
                host shutdown, not by natural terminal)

v1 scope: ephemeral-only is acceptable.
```

## 16.12 Coverage table

```text
| # | Scenario                              | All rows defined? |
|---|---------------------------------------|-------------------|
| S1| NOTIFY (via WAIT) + natural success   | YES               |
| S2| NOTIFY (via WAIT) + nonzero exit      | YES               |
| S3| NOTIFY (via WAIT) + deadline          | YES               |
| S4| NOTIFY (via WAIT) + explicit cancel   | YES               |
| S5| notify + natural success              | YES               |
| S6| notify + failure                      | YES               |
| S7| detach + natural success              | YES               |
| S8| detach + failure                      | YES               |
| S9| newer user turn before terminal       | YES               |
|S10| two background jobs (per-job events)  | YES               |
|S11| extension restart                     | YES               |

No UNRESOLVED rows. Contract freeze gate G1-G13 (§44) is satisfied.

NOTE (correction cycle 01): S1-S4 were retitled from "wait + X" to
"NOTIFY (via WAIT) + X" to reflect the honest collapse in §8.1
and §14.1. Strict WAIT (no Your turn interlude) is unsupported
in v1; STRICT_WAIT is deferred to a future cycle requiring
Candidate C architecture.
```
