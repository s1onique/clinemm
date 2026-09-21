# 21 — Contract correction 02

CORRECTION02 closes the four contract-authority defects opened by
the Factory causal reviewer's `HALT_WAIT_SEMANTICS_STALE_CONTRACT_AUTHORITY`
verdict. The architectural direction is unchanged. The packet now
contains ONE unambiguous v1 contract.

## 21.1 Defects closed in this cycle

```text
P0 STALE_B_D1_AUTHORITY             = CLOSED  (§7.2 + §14.0 + §14.1 rewritten)
P0 S9_SUPERSESSION_CONTRADICTION    = CLOSED  (§10.3 + §10.5 + §16.9 unified)
P1 STALE_TRIGGER_IDENTITY_TEXT      = CLOSED  (§11.7 + §12.1 + §13.4 +
                                              §14.4 + §17.7 rewritten)
P1 MULTIJOB_NOTIFY_AUTHORITY        = CLOSED  (§15.7.3 rewritten: coordinator
                                              owns both identity map AND
                                              active-notify set)
```

## 21.2 What changed

### 21.2.1 §7.2 Candidate B D1 verdict (P0 #1)

Original text said:

> "D1 Literal 'wait until finished' predictable = YES"

This contradicted §8.1 and §14.1, which explicitly say WAIT(v1)
collapses to NOTIFY semantics and strict WAIT (STRICT_WAIT) is
deferred. Correction02 rewrites §7.2 to:

```text
D1 strict WAIT predictable              = NO / OUT_OF_V1
D1 v1 WAIT(v1) → NOTIFY mapping
   predictable                          = YES
```

The Candidate B summary line is now: "B is the bounded v1 NOTIFY
contract; strict WAIT (STRICT_WAIT) is deferred to a future cycle."

### 21.2.2 §14.0 RATIONALE rewrite (P0 #1)

Original opening said "lets ClineMM honor the user's 'wait until
finished' intent". Rewritten to:

```text
SELECTION_REASON:
  - Candidate B passes all ten rubric items D1-D10 WITH THE
    HONEST v1 SCOPE: strict WAIT is OUT_OF_V1; WAIT(v1) maps
    to NOTIFY semantics.
  - Candidate A fails D1, D4, D8 (observable user-visible
    mismatch with the runtime promise).
  - Candidate C fails D9 (no existing suspended-tool state
    machine — would enable STRICT_WAIT in a future cycle).
  - Candidate D fails D9 (inherits C).
  - B reuses existing seams (PendingPromptsController.enqueue,
    per-job CommandJobManager.onCommandJobLifecycle event,
    identity-correlating machinery at the coordinator seam).
  - B is the smallest-scope change that distinguishes the three
    user intents (wait→notify, notify, detach) via one optional
    schema field.
```

### 21.2.3 §10.3 + §10.5 + §16.9 unified (P0 #2)

The S9 contradiction: §10.3 says wake waits behind T2; §10.5
says epoch mismatch discards the wake. If T2 bumps the epoch,
both rules cannot apply.

Correction02 introduces a new sub-section §10.8
NOTIFICATION_LIFETIME_INVARIANT that supersedes both for the
notify-on-terminal case:

```text
NOTIFICATION_LIFETIME_INVARIANT (v1, notify-on-terminal):

  A wake is preserved (queued) iff all of:
    marker.sessionId === activeSession.sessionId
    marker.taskId    === activeSession.getTask().taskId
  A wake is DISCARDED iff any of:
    marker.sessionId !== activeSession.sessionId (different session)
    marker.taskId    !== activeSession.getTask().taskId (different task)
    activeSession is undefined (host shutdown / empty repo)

  EPOCH IS NOT USED for the notify-on-terminal lifetime decision.

  Why: a notification is explicitly ASYNCHRONOUS across turns. The
  BTCONT epoch semantics were designed for turn-local "did the
  current turn end?" state, not for "should this asynchronous
  notification still fire?". Mechanically reusing BTCONT's epoch
  would discard perfectly valid wakes whenever the user happens
  to send a new message between job-start and job-terminal.

  The wake consumer is REQUIRED to maintain its own lifetime
  invariant. It MAY reuse (sessionId, taskId) identity machinery
  from BTCONT but MUST NOT inherit BTCONT's epoch rule.
```

§10.3 and §10.5 are kept (BTCONT turn-state still uses them) but
gain explicit "this rule applies to the BTCONT turn-state consumer
only" annotations.

§16.9 S9 is rewritten to:
- use the per-job `command_job_terminal_committed` event (not `>0→0`)
- use the §10.8 lifetime invariant (NOT epoch)
- explicitly state: "T2 bumps the epoch; under v1 the wake is
  KEPT because session and task are the same. The wake is queued
  and delivered after T2's non-error finish."

### 21.2.4 §11.7 + §12.1 + §13.4 + §14.4 + §17.7 rewrite (P1 #1)

All five sections previously contained stale authority that
contradicted the §15.7 contract. All five are rewritten to defer
to §15.7.

§11.7 now reads:

> "The wake prompt content is a bounded GENERATED PROMPT STRING
> (per §15.7.2). It is NOT a typed payload; the queue accepts
> prompt strings. The schema lives in code (`formatTerminalWakePrompt`),
> NOT in the queue payload."

§12.1 now reads:

> "What survives a restart: CommandJob's identity (jobId,
> ownerSessionId) and terminal state. The notify=true flag is
> NOT stored on CommandJob — it lives in the coordinator's
> active-notify set (§15.7.3) which is ephemeral and dies with
> the session. The wake is therefore LOST on restart by design."

§13.4 now reads:

> "ClineMM v1 emits a bounded GENERATED PROMPT STRING (per §15.7.2),
> NOT a typed payload. The schema lives in code, not in the queue
> payload. The original packet's 'typed wake payload, not prose'
> claim is retracted."

§14.4 RUNTIME_CONTRACT now uses `command_job_terminal_committed`
event as the trigger, NOT `>0 → 0` cardinal transition, AND uses
the coordinator-owned identity map (NOT originating CommandJob).

§17.7 now reads:

> "The wake subscriber subscribes to the per-job
> `command_job_terminal_committed` lifecycle event (NOT the
> `>0 → 0` cardinal transition). It reads the notifyOnCompletion
> flag from the COORDINATOR-OWNED active-notify set (§15.7.3),
> NOT from the CommandJob record. CommandJob's footprint is
> preserved."

### 21.2.5 §15.7.3 multi-job trigger rewrite (P1 #2)

Original §15.7.3 still queried
`CommandJobManager.active where job.notifyOnCompletion === true`.
This property is not on those jobs by §15.7.1's own rule.

Correction02 rewrites §15.7.3 to make the coordinator authoritative
for the active-notify set:

```text
NOTIFICATION_MARKERS (authoritative owner: SdkSessionEventCoordinator):
  Map<jobId, NotificationMarker>
  NotificationMarker = {
    jobId: string,
    sessionId: string,
    taskId: string | undefined,
    notifyOnCompletion: boolean,
    createdAtMs: number
  }

  On accepted background handoff (notifyOnCompletion:true):
    markers.set(jobId, {jobId, sessionId, taskId, true, now})

  On per-job terminal event (command_job_terminal_committed):
    j = the terminal job
    marker = markers.get(j.id)
    if marker === undefined OR marker.notifyOnCompletion === false:
      discard (DETACH intent or unknown job)
      return
    markers.delete(j.id)
    // Other same-owner notify markers?
    otherNotifyCount = count(markers.values()
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
        enqueue w via PendingPromptsController.enqueue(...)
    enqueue j's wake via PendingPromptsController.enqueue(...)
    delivery = "queue" for all wakes
```

This removes any need to broaden CommandJob or query private
manager state by notification semantics. The coordinator owns:
- identity map (`markers`)
- held set (FIFO list per owner)
- the entire notify-on-terminal decision.

## 21.3 Frozen sub-sections added

- §10.8 NOTIFICATION_LIFETIME_INVARIANT (new sub-section of §10)
- §14.0 SELECTION_REASON rewrite (replaces old opening of §14)
- §15.7.3 MULTI-JOB-TRIGGER rewrite (replaces the stale
  `CommandJobManager.active where job.notifyOnCompletion === true` query)
- §21 CONTRACT_CORRECTION_02 (this file)

## 21.4 Files touched in this cycle

| File | What changed |
|------|--------------|
| 07-contract-candidates.md   | §7.2 Candidate B D1 verdict + summary rewrite |
| 10-concurrency-and-supersession.md | §10.3, §10.5 annotation + NEW §10.8 lifetime invariant |
| 11-terminal-reason-matrix.md | §11.7 wake representation rewrite |
| 12-persistence-scope.md | §12.1 notify flag location rewrite |
| 13-upstream-context.md | §13.4 wake representation rewrite |
| 14-contract-decision.md | §14.0 RATIONALE rewrite; §14.4 RUNTIME_CONTRACT rewrite |
| 16-scenario-suite.md | §16.9 S9 rewrite (per-job event, lifetime invariant) |
| 17-compatibility.md | §17.7 wake subscriber rewrite |
| 19-final-review.txt | updated |
| result.json | updated (correction_cycle 2, p0/p1 closed) |
| .factory/epic-board.md | correction 02 summary |
| 21-contract-correction-02.md | NEW — this document |

## 21.5 Verdict (post correction 02)

```text
VERDICT = PASS_WAIT_SEMANTICS_CONTRACT_FROZEN

EXIT_HEAD = <recorded post-commit in 19 + result.json>
ENTRY_HEAD = 3a201b49c0c2de5a1a7f224e9633d07046400df9

P0 STALE_B_D1_AUTHORITY           = CLOSED
P0 S9_SUPERSESSION_CONTRADICTION  = CLOSED (notification lifetime invariant
                                        added in §10.8; epoch explicitly
                                        excluded from notify-on-terminal
                                        lifetime decision)
P1 STALE_TRIGGER_IDENTITY_TEXT    = CLOSED (5 sections rewritten to defer
                                        to §15.7)
P1 MULTIJOB_NOTIFY_AUTHORITY      = CLOSED (coordinator owns identity map
                                        AND active-notify set)

PRODUCTION_IMPLEMENTATION = AUTHORIZED
  via successor ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01
  bound to this ACT's exit_head.
```

After CORRECTION02 lands, the next step is **C1: GO directly to
`ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01`** — no
additional pre-execution review cycle unless a new P0 appears.
