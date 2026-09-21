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

NOTE (post-CORRECTION02): §10.3 applies to the CANDIDATE B wake
consumer. The T2→wake queueing rule is correct as long as the
wake's (sessionId, taskId) still match the active session and
task (see §10.8 NOTIFICATION_LIFETIME_INVARIANT). It does NOT
contradict §10.5 — §10.5 is the BTCONT turn-state consumer rule;
§10.8 is the notify-on-terminal wake consumer rule. They are
separate consumers with separate lifetime invariants.
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

## 10.5 Supersession rule (BTCONT turn-state consumer)

If a job's terminal event fires after the session has moved to a
newer turn/task:

```text
The BTCONT turn-state writer MUST discard if:
  - marker.sessionId !== activeSession.sessionId
    (different-session terminality)
  - marker.taskId !== activeSession.getTask().taskId
    (task identity changed)
  - marker.epoch !== currentMinterEpoch
    (newer epoch supersedes)

These are the BTCONT turn-state consumer's conservation rules.
The turn-state writer uses them.

SCOPE NOTE (post-CORRECTION02): §10.5 governs the BTCONT
turn-state writer ONLY. The notify-on-terminal wake consumer is
a SEPARATE consumer with its own lifetime invariant (see §10.8).
The wake consumer does NOT inherit BTCONT's epoch rule —
mechanically reusing BTCONT's epoch would discard perfectly valid
wakes whenever the user happens to send a new message between
job-start and job-terminal (a notification is explicitly
asynchronous across turns).
```

## 10.8 NOTIFICATION_LIFETIME_INVARIANT (notify-on-terminal wake consumer, v1)

This is the wake consumer's lifetime decision. It supersedes §10.5
for the notify-on-terminal case. It is recorded here so the
implementation ACT has a single unambiguous rule.

```text
A wake is PRESERVED (queued for delivery:"queue") iff ALL of:
  marker.sessionId === activeSession.sessionId
  marker.taskId    === activeSession.getTask().taskId

A wake is DISCARDED iff ANY of:
  marker.sessionId !== activeSession.sessionId
    (different session — wake belongs to a stale or different session)
  marker.taskId    !== activeSession.getTask().taskId
    (different task — wake belongs to a previous task)
  activeSession is undefined
    (host shutdown, host restart, empty repo — no agent to wake)

EPOCH IS NOT USED for the notify-on-terminal lifetime decision.

Why: a notification is explicitly ASYNCHRONOUS across turns.
BTCONT's epoch semantics were designed for turn-local "did the
current turn end?" state, not for "should this asynchronous
notification still fire?". Mechanically reusing BTCONT's epoch
would discard perfectly valid wakes whenever the user sends a new
message between job-start and job-terminal.

Identity machinery REUSE: the wake consumer MAY reuse (sessionId,
taskId) identity machinery from BTCONT (the
hasRunningBackgroundJobForOwner check, the reevaluateDeferredContinuation
helper, etc.) but MUST maintain its OWN lifetime invariant.

Concrete consequence for S9 (newer user turn before terminal):
  T2 bumps the epoch; under v1, the wake is KEPT because session
  and task are the same. The wake is queued and delivered after
  T2's non-error finish.
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
