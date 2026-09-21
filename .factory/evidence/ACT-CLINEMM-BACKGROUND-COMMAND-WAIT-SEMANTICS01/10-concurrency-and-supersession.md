# 10 — Concurrency and supersession

## 10.1 Scenario: newer user turn before terminal (S9)

```text
T1:
  start J with notify=true (Candidate B)

before J finishes:
T2:
  user sends unrelated prompt → session accepts new turn
```

When J eventually becomes terminal, what happens?

## 10.2 Candidate behavior

```text
A:  No wake at all. T2 is unaffected. ← current implementation.

B:  T2 is mid-flight. The wake prompt is enqueued with
    delivery:"queue" (the recommended default) — it waits behind
    T2 and drains after T2's non-error finish. The wake prompt
    arrives AFTER T2 completes.
    Alternative: delivery:"steer" would interrupt T2 mid-turn.

C:  The suspension is per-tool-call. T2 cannot start until J
    becomes terminal (the turn is suspended). When J terminates,
    the suspended turn resumes. T2 cannot start during the
    suspension.

D:  Per mode:
      wait → like C
      notify → like B
      detach → like A
```

## 10.3 What this ACT freezes for Candidate B

```text
S9 (newer turn before terminal) under Candidate B:

  When the terminal event fires while a newer turn is mid-flight:
    - delivery = "queue" (waits behind current turn)
    - the wake prompt joins the same PendingPromptsController queue
    - T2 finishes, drain runs, the wake prompt is delivered
    - the wake prompt is a NEW turn, scoped to the wake, not the
      continuation of T2

This rule is conservative. It matches the existing
PendingPromptsController behavior; no new turn-state machine
needed.
```

## 10.4 Multi-job (S10)

```text
Two background jobs, both notify=true:

J1 starts.
J2 starts.
J1 terminates first.
J2 terminates later.

Under Candidate B:
  - J1 terminal → enqueue wake for J1 (delivery:"queue")
  - J2 still running → wake for J1 is held (NOT delivered)
  - J2 terminal → enqueue wake for J2 (delivery:"queue")
  - session drains both wakes in order
  - two distinct wake prompts; both delivered; both exactly-once
```

This is handled by the existing identity-correlating machinery in
`reevaluateDeferredContinuation` (the `hasRunningBackgroundJobForOwner`
check at line 199). A wake consumer that reuses this check will
hold a wake for J1 until J2 also terminates.

## 10.5 Supersession rule

If a job's terminal event fires after the session has moved to a
newer turn/task:

```text
The wake MUST be discarded if:
  - marker.sessionId !== activeSession.sessionId
    (different-session terminality)
  - marker.taskId !== activeSession.getTask().taskId
    (task identity changed)
  - marker.epoch !== currentMinterEpoch
    (newer epoch supersedes)

These are the same conservation rules as the turn-state writer.
The wake consumer MUST reuse them.
```

## 10.6 The empty-repo case

If the session has no current active session (host shutdown, host
restart), the wake MUST be discarded. There is no agent to wake.

## 10.7 What this means for the contract decision

For Candidate B, the concurrency rules are:

- Single-job wake: delivered at terminal.
- Multi-job: held until all of the owning session's notify=true
  jobs are terminal.
- Newer-turn precedence: wake joins the queue (delivery:"queue").
- Supersession: bound to sessionId + taskId + epoch.
- Empty-repo: discarded.

All five rules are implementable via existing seams
(§6.7 identity-correlating machinery + §6.1 PendingPromptsController).
No new state machine required.
