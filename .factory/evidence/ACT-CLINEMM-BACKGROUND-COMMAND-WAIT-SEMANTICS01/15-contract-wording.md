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
    fires exactly once per terminal job)
  - on each event:
    - look up identity at the session/coordinator seam
      (NOT on CommandJob — see §15.7 below)
    - check conservation rules (sessionId, taskId, epoch,
      hasRunningBackgroundJobForOwner)
    - if notifyOnCompletion:true AND conservation pass AND no
      other notify=true job for owner:
      enqueue a bounded generated prompt string via
      PendingPromptsController.enqueue with delivery:"queue"
    - if notifyOnCompletion:true AND another notify=true job still
      running for owner: HOLD the wake in the session/coordinator
      held set (FIFO by job-start order)
    - else: discard (notify=false is the default)

NOTIFICATION_IDENTITY_OWNER (frozen, see §15.7):
  - session/coordinator-owned, NOT CommandJob-owned
  - Captured at run_commands call time at the
    SdkSessionEventCoordinator seam (or equivalent where
    options.getTask().taskId is reachable)
  - Per-session identity map keyed by jobId:
      Map<jobId, { sessionId, taskId, epoch, notifyOnCompletion }>
  - Cleared on terminal-committed (after wake enqueue) and on
    session end

WAKE_REPRESENTATION (frozen, see §15.7):
  - Bounded generated prompt string (not typed payload)
  - PendingPromptsController.enqueue accepts only { prompt: string }
  - The "typed" schema lives in code (formatTerminalWakePrompt),
    NOT in the queue payload

NO change to:
  - run_commands schema (only addition: optional boolean)
  - CommandJobManager internal CommandJob record structure
    (CommandJob does NOT capture taskId/epoch; the coordinator
    seam owns those identities)
  - command_status / cancel_command / Proceed While Running
  - reevaluateDeferredContinuation (the turn-state consumer)
  - the Q5 deferral marker
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
    - sessionId:   AgentToolContext.sessionId (already present)
    - taskId:      options.getTask().taskId at call time
                   (may be undefined if not in a task context)
    - epoch:       coordinator-managed epoch counter
                   (bumped on task reset, follow-up start, etc.)
  Stored in a per-session identity map keyed by jobId:
    Map<jobId, { sessionId, taskId, epoch, notifyOnCompletion }>
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

### 15.7.3 Multi-job trigger (frozen)

```text
TRIGGER = per-job terminal lifecycle event
  Event: CommandJobManager.onCommandJobLifecycle(
    event: { event: "command_job_terminal_committed",
             jobId, terminationReason, exitCode, signal, tsMs, ... }
  )
  Source: apps/vscode/src/sdk/command-job-manager.ts:621-...
  Per-job, fires EXACTLY ONCE per terminal job.

NOT the >0 -> 0 cardinal transition (which fires once when the LAST
job disappears, not on each job's terminal — the previous freeze
incorrectly conflated the two).

For each "command_job_terminal_committed" event:
  let j = the terminal job
  if j.notifyOnCompletion !== true:
    discard (DETACH intent; no wake)
    return
  let otherNotifyCount = count of jobs in CommandJobManager.active
    where job.id != j.id AND job.notifyOnCompletion === true
  if otherNotifyCount > 0:
    HOLD wake for j in session/coordinator held set
    return
  // j.notifyOnCompletion === true AND no other notify=true jobs
  // still running for the owning session
  DRAIN all held wakes for the owning session in FIFO order
  enqueue each held wake via PendingPromptsController.enqueue
  enqueue j's wake via PendingPromptsController.enqueue

Held wake key: (jobId, ownerSessionId, notifyOnCompletion, createdAtMs)
Held set lives at the session/coordinator seam (per §15.7.1).
At most one FIFO list per owner session.
v1 cap: bounded by max parallel jobs (existing maxTerminalJobs limit).
Wakes are dropped only when the session ends (PERSISTENCE = EPHEMERAL_ONLY).
```
