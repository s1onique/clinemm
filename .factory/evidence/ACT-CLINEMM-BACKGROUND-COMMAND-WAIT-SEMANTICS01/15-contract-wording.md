# 15 — Contract wording (frozen)

These are the exact words that will live in production-facing
doctrine if the bounded implementation ACT lands.

## 15.1 New tool schema (frozen)

```ts
// in sdk/packages/core/src/extensions/tools/schemas.ts

export const RunCommandsInputSchema = z
    .object({
        commands: z
            .array(CommandInputSchema)
            .describe("Array of complete shell command strings to execute."),

        // ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01:
        // opt-in flag for the bounded async completion notification
        // (Contract B from ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01).
        // Defaults to false: preserves current canonical behavior
        // (no terminal->agent re-entry).
        notifyOnCompletion: z
            .boolean()
            .optional()
            .describe(
                "If true, the host will deliver one completion notification " +
                "to this session when the command exits. The notification " +
                "carries the exit code, signal, and a bounded tail of " +
                "stdout/stderr. Default false: no notification is sent and " +
                "the current behavior (poll via command_status) applies. " +
                "The notification is delivered at most once."
            ),
    })
    .strict();
```

## 15.2 Updated tool description (frozen, append to F4)

```text
"...For long-running commands, run them in background and redirect
output to a tmp file that you can read from later. To receive an
automatic completion notification when a long-running background
command exits, set notifyOnCompletion:true on the run_commands
call. The notification carries the exit code, signal, and a
bounded tail of stdout/stderr, and is delivered at most once.
Without notifyOnCompletion, the current behavior applies: no
notification is sent and the command can be observed via
command_status or cancel_command."
```

This is the **only** model-visible change. The F4 sentence
remains; an opt-in sentence is appended.

## 15.3 User-facing doctrine (frozen wording for the user-visible docs)

```text
"Background commands may opt into completion notification. When
notifyOnCompletion is true on a run_commands call, the host
delivers one notification when the command exits. The notification
is best-effort: it may be delayed if the session is busy, and it
may be lost across host restarts. If you need durable notification
or strict ordering, use command_status to poll, or cancel_command
to verify the outcome."
```

## 15.4 What this ACT does NOT add to the model prompt

```text
- NO instruction that the model MUST poll.
- NO instruction that the model MUST NOT emit done while a job is
  running (the current "background + tmp file + poll" semantic is
  preserved).
- NO instruction that the model MUST issue notifyOnCompletion:true
  for any specific user phrasing.
- NO inference of intent from natural-language prose inside runtime
  code.
```

## 15.5 What this ACT adds to the runtime

```text
ONE new consumer on CommandJobManager.onCommandJobLifecycle:
  - subscribe to "command_job_terminal_committed" events (per-job,
    fires exactly once per terminal job) — NOT the >0 → 0
    cardinal transition.
  - on each event:
    - look up the NotificationMarker in the coordinator-owned
      notificationMarkers map (NOT on CommandJob — see §15.7)
    - apply §10.8 NOTIFICATION_LIFETIME_INVARIANT
      (sessionId + taskId match; epoch NOT used)
    - if notifyOnCompletion:true AND lifetime check passes AND no
      other same-owner notify=true marker active:
      drain the held set (FIFO) + enqueue a bounded generated
      prompt string via PendingPromptsController.enqueue with
      delivery:"queue"
    - if notifyOnCompletion:true AND lifetime check passes AND
      another same-owner notify=true marker active:
      HOLD the wake in the session/coordinator held set
      (FIFO by createdAtMs)
    - else (lifetime fails OR notify=false OR marker absent):
      discard

NOTIFICATION_IDENTITY_OWNER (frozen, see §15.7.1 + §15.7.3):
  - session/coordinator-owned, NOT CommandJob-owned
  - Captured at run_commands call time at the
    SdkSessionEventCoordinator seam (or equivalent where
    options.getTask().taskId is reachable)
  - Per-session identity map keyed by jobId:
      Map<jobId, NotificationMarker>
      NotificationMarker = {
        jobId, sessionId, taskId, notifyOnCompletion, createdAtMs
      }
    Epoch is NOT part of NotificationMarker (post-CORRECTION02).
  - This map is BOTH the identity map AND the source of the
    active-notify set (post-CORRECTION02). The wake consumer
    queries this map for everything; it does NOT read from
    CommandJobManager for notification semantics.
  - Cleared on terminal-committed (after wake enqueue) and on
    session end

WAKE_REPRESENTATION (frozen, see §15.7.2):
  - Bounded generated prompt string (not typed payload)
  - PendingPromptsController.enqueue accepts only { prompt: string }
  - The "typed" schema lives in code (formatTerminalWakePrompt),
    NOT in the queue payload
  - The original packet's "typed wake payload" claim is retracted.

NO change to:
  - run_commands schema (only addition: optional boolean)
  - CommandJobManager internal CommandJob record structure
    (CommandJob does NOT capture taskId/notifyOnCompletion/epoch;
    the coordinator seam owns all notification identity)
  - command_status / cancel_command / Proceed While Running
  - reevaluateDeferredContinuation (the BTCONT turn-state
    consumer — its lifetime invariant uses epoch; the wake
    consumer has its OWN lifetime invariant per §10.8)
  - the BTCONT Q5 deferral marker
  - any card / TaskHeader / webview / protobuf surface
```

## 15.6 What this ACT explicitly does NOT do

Per ACT body §27 and §40:

```text
PRODUCTION_CHANGE = NONE
PRODUCTION_REPAIR = NOT_AUTHORIZED_IN_THIS_ACT

The bounded implementation ACT (see §18-successor-authorization.md)
will own the production change.
```
## 15.7 Frozen implementation details (correction cycle 01)

These are the load-bearing seams that the bounded implementation ACT
must honor. They were corrected in cycle 01 in response to the
Factory causal reviewer's P1 findings.

### 15.7.1 Notification identity owner (frozen)

```text
NOTIFICATION_IDENTITY_OWNER = session/coordinator-owned
  Owner seam: SdkSessionEventCoordinator construction (or equivalent
  coordinator seam where options.getTask().taskId is reachable).
  Captured at run_commands call time:
    - sessionId:           AgentToolContext.sessionId (already present)
    - taskId:              options.getTask().taskId at call time
                           (may be undefined if not in a task context)
    - notifyOnCompletion:  the boolean passed in by the model
    - createdAtMs:         Date.now() at handoff time (for FIFO)
  NOTE (post-CORRECTION02): epoch is NOT part of NotificationMarker.
  The wake consumer's lifetime invariant (per §10.8) does NOT use
  epoch. Epoch is the BTCONT turn-state consumer's mechanism; the
  wake consumer has its own (sessionId, taskId) check.
  Stored in a per-session identity map keyed by jobId:
    Map<jobId, NotificationMarker>
    NotificationMarker = {
      jobId: string,
      sessionId: string,
      taskId: string | undefined,
      notifyOnCompletion: boolean,
      createdAtMs: number
    }
  This map is BOTH the identity map AND the source of the
  active-notify set (post-CORRECTION02). The wake consumer queries
  THIS map for everything; it does NOT read from CommandJob
  directly. CommandJob's footprint is preserved.
  Cleared on terminal-committed (after wake enqueue) and on session
  end.

WHY NOT ON COMMANDJOB:
  - Recon (§06, command-job-manager.ts:927-1030) confirmed
    CommandJob captures only ownerSessionId at construction.
  - taskId does NOT exist on AgentToolContext at job construction
    time (sdk/packages/shared/src/agent.ts:348-355).
  - Adding taskId to CommandJob would either leak identity into
    CommandJobSnapshot (violating the P1 no-leak invariant from
    ACT-CLINEMM-BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01) or
    require new encapsulation work.
  - The BTCONT marker at sdk-session-event-coordinator.ts:177-178
    already reads options.getTask?.()?.taskId at the COORDINATOR
    seam. The notification marker uses the SAME owner seam, NOT
    CommandJob.

The wake consumer reads from this map; it does NOT read from
CommandJob directly. CommandJob's footprint is preserved.
```

### 15.7.2 Wake representation (frozen)

```text
WAKE_REPRESENTATION = bounded generated prompt string
  PendingPromptsController.enqueue accepts only:
    { prompt: string, mode?: AgentMode, delivery: "queue"|"steer",
      userImages?: string[], userFiles?: string[] }
  (sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:238-247)
  There is NO typed-event seam in the current codebase.

WAKE_PROMPT_FORMAT (final-string form, generated by
`formatTerminalWakePrompt(payload)` in the bounded implementation ACT):

  "Background command {jobId} {terminal_verb}: {exitCode_or_signal}.
   stdoutTail: {bounded_tail}.
   stderrTail: {bounded_tail}.
   elapsedMs: {ms}."

  Where:
    - terminal_verb is one of:
        "exited successfully"          (state=exited, exitCode=0)
        "exited with code {exitCode}"  (state=exited, exitCode!=0)
        "exceeded the host execution deadline and was terminated"
                                            (state=deadline_exceeded)
        "was cancelled"                  (state=cancelled)
        "failed to start: {error}"       (state=spawn_failed)
    - stdoutTail / stderrTail: bounded ~80 lines
      (per existing maxRetainedOutputChars / maxResponseOutputChars
       limits)
    - elapsedMs: tsMs - startedAtMs

  Total prompt bounded:
    - hard cap = 8 KB
    - soft target = 4 KB

WHY THIS FORM:
  - Honors the existing prompt-shaped surface.
  - The "typed" schema lives in CODE (formatTerminalWakePrompt),
    NOT in the queue payload. The schema is testable and
    diff-stable across versions.
  - The original packet's "typed wake payload, not prose" claim
    is retracted.
```

### 15.7.3 Multi-job trigger (frozen, post-CORRECTION02)

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

  The coordinator owns BOTH:
    - the identity map (`markers`) and
    - the active-notify set (the subset where
      m.notifyOnCompletion === true, partitioned by
      (m.sessionId, m.taskId) into per-owner FIFO lists).
  CommandJob does NOT carry notifyOnCompletion. The wake consumer
  MUST NOT query CommandJobManager for notification semantics.

TRIGGER = per-job terminal lifecycle event
  Event: CommandJobManager.onCommandJobLifecycle(
    event: { event: "command_job_terminal_committed",
             jobId, terminationReason, exitCode, signal, tsMs, ... }
  )
  Source: apps/vscode/src/sdk/command-job-manager.ts:621-...
  Per-job, fires EXACTLY ONCE per terminal job.
  NOT the >0 -> 0 cardinal transition.

NOTIFICATION LIFETIME (per §10.8):
  Apply §10.8 NOTIFICATION_LIFETIME_INVARIANT before any hold/drain
  decision. Discard on session/task mismatch or empty-repo. Epoch
  is NOT used.

WAKE CONSUMER (handler on per-job terminal event):

  for each "command_job_terminal_committed" event:
    j = the terminal job (jobId from event)
    marker = markers.get(j.id)
    if marker === undefined OR marker.notifyOnCompletion === false:
      discard (DETACH intent or unknown job)
      return
    markers.delete(j.id)

    // §10.8 lifetime check
    if marker.sessionId !== activeSession?.sessionId: return (discard)
    if marker.taskId    !== activeSession?.getTask?.()?.taskId: return (discard)
    if activeSession === undefined: return (discard; empty repo)

    // Compute other same-owner notify markers still active.
    otherNotifyCount = count(markers.values()
      where m.sessionId === marker.sessionId
        AND m.taskId    === marker.taskId
        AND m.notifyOnCompletion === true)

    if otherNotifyCount > 0:
      HOLD wake for j in coordinator held set
        (FIFO list keyed by (marker.sessionId, marker.taskId),
         ordered by marker.createdAtMs)
      return

    // j is the LAST same-owner notify=true job terminating.
    let held = heldSet.get((marker.sessionId, marker.taskId))
    heldSet.delete((marker.sessionId, marker.taskId))
    if held:
      for each w in held (FIFO order):
        enqueue w via PendingPromptsController.enqueue(
          { prompt: formatTerminalWakePrompt(w.payload),
            delivery: "queue" })
    enqueue j's wake via PendingPromptsController.enqueue(
      { prompt: formatTerminalWakePrompt(j.payload),
        delivery: "queue" })

HELD SET:
  Held set lives at the session/coordinator seam (per §15.7.1).
  Per-owner FIFO list keyed by (sessionId, taskId), bounded by
  createdAtMs.
  v1 cap: bounded by max parallel jobs (existing maxTerminalJobs limit).
  Wakes are dropped only when the session ends (PERSISTENCE =
  EPHEMERAL_ONLY).
```
