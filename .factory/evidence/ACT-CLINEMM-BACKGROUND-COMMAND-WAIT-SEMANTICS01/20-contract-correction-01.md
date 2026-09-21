# 20 — Bounded contract correction cycle 01

## 20.1 Why this artifact exists

The Factory causal reviewer returned `HALT_WAIT_SEMANTICS_CONTRACT_NOT_FROZEN`
on the initial submission. Two P0s and three P1s were opened. This artifact
records the bounded contract correction.

**Authority form**:
```text
FACTORY_CAUSAL_REVIEWER_VERDICT =
  HALT_WAIT_SEMANTICS_CONTRACT_NOT_FROZEN

P0 CONTRACT_FREEZE_NOT_DURABLE         = OPEN
P0 WAIT_NOTIFY_SEMANTIC_CONTRADICTION   = OPEN

P1 MULTI_JOB_TRIGGER_CONTRACT           = FIX_ONCE
P1 NOTIFICATION_IDENTITY_OWNER          = FIX_ONCE
P1 WAKE_PAYLOAD_SURFACE                 = FIX_ONCE

CORRECTION_SCOPE = 1 bounded contract correction cycle
                  (no production work; no more research ACT)
```

The 18-numbered evidence files plus `result.json` are amended in place
(supersession: this artifact documents the diff). The board and `result.json`
are regenerated to reflect the corrected contract.

## 20.2 P0 #1 — contract durability fix

**Before**: the initial submission had 20 files as untracked working-tree
content + 1 modified board; `git status --short` was dirty; `result.json`
claimed `tracked_dirt_introduced=false` and `git status --short: clean`,
both of which were false for the state actually submitted.

**After (this correction cycle)**:
1. The whole contract packet (board + evidence directory) is committed as
   ONE docs/evidence-only commit.
2. The commit's HEAD is discovered and recorded as `EXIT_HEAD`.
3. `result.json.exit_head` and `19-final-review.txt` reflect the
   actual post-commit HEAD.
4. `result.json.scope_discipline.tracked_dirt_introduced` reflects the
   pre-commit state honestly (was `false` because the dirt is
   intentionally created by this ACT; after commit it is `true` for
   this ACT's footprint but `false` for the running tree).
5. `git status --short` is verified clean BEFORE submission.

The successor ACT binds to the post-commit HEAD, not to a
dirty-worktree HEAD.

## 20.3 P0 #2 — WAIT/NOTIFY contradiction fix

The original intent definitions:
```text
I1 WAIT:
  "Run this command and wait until it finishes, then tell me the result."
  Observable promise:
    agent resumes after terminal; user sees final answer before
    "Your turn" appears (when combined with completion).
```

The original Contract B freezing:
```text
WAIT:
  notifyOnCompletion:true
  Model may end current turn? YES
  Terminal wakes agent? YES, later
  User receives immediate turn? YES (then wake arrives)
```

These are two different product semantics. The packet admitted the
collapse: `"wait" and "notify" collapse to the SAME runtime behavior for v1.`

**Decision: Option 1 — narrow v1 honestly.**

```text
WAIT (v1):
  UNSUPPORTED as the strong "no Your turn before final answer" semantic.
  Maps to the NOTIFY semantic. Users who need strict WAIT semantics are
  deferred to a future cycle that funds the suspended-tool state machine
  (Candidate C). User-facing doctrine states this explicitly.

NOTIFY (v1):
  notifyOnCompletion:true. One wake at terminal via PendingPromptsController.
  Agent may yield current turn. Wake arrives as a new turn via delivery:queue.

DETACH (v1):
  notifyOnCompletion:false (default). No wake. Current behavior preserved.

STRICT_WAIT (future cycle, NOT v1):
  notifyOnCompletion:"wait". Requires suspended-tool state machine (C).
  Strict "final answer before Your turn" promise. Out of scope.
```

After this correction, the contract uses one definition consistently:
- The intent matrix names `WAIT (v1) = NOTIFY` and labels the strong
  WAIT semantic `STRICT_WAIT (future cycle)`.
- The selected semantic table (Contract B) covers only NOTIFY and DETACH.
- STRICT_WAIT is named as deferred.
- Scenario S1's "Your turn: yes (briefly between done and wake)" is
  rewritten to describe the NOTIFY behavior (because S1 now tests
  the NOTIFY intent — strict WAIT is unsupported in v1).

`08`, `14`, `15`, `16`, board, `result.json` all updated to match.

## 20.4 P1 #1 — multi-job trigger fix

**Before**: the original freeze reused the `>0 → 0` cardinal transition
(per-owner gauge) for each terminal event. This is wrong: the `>0 → 0`
transition fires ONCE when the LAST job disappears, not on every job's
terminal.

**After (this correction cycle)**:

The wake consumer subscribes to the PER-JOB terminal lifecycle event:

```text
CommandJobManager.onCommandJobLifecycle(
  event: { event: "command_job_terminal_committed",
           jobId, terminationReason, exitCode, signal, ... }
)
```

Source: `apps/vscode/src/sdk/command-job-manager.ts:621-...` — this
event is per-job, fires exactly once per terminal job, and carries
the jobId + terminationReason + exitCode + signal + tsMs.

**Multi-job rule (corrected)**:
```text
For each "command_job_terminal_committed" event:
  let j = the terminal job
  let otherNotifyCount = count of jobs in CommandJobManager.active
    where job.id != j.id AND job.notifyOnCompletion === true
  if otherNotifyCount > 0:
    HOLD wake for j; do not enqueue
  else:
    DRAIN all held wakes for the owning session, in FIFO order;
    then enqueue j's wake
```

A held wake is keyed by `(jobId, ownerSessionId, notifyOnCompletion,
createdAtMs)`. The held set lives at the session/coordinator seam
(NOT on CommandJob — see P1 #2 below). At most one FIFO list per
owner session.

v1 simplification: the held set is bounded by max parallel jobs (the
existing `maxTerminalJobs` limit). Wakes are dropped only when the
session ends (per PERSISTENCE = EPHEMERAL_ONLY).

The BTCONT marker has `(sessionId, taskId, epoch)` triple because it is
recorded at `SdkSessionEventCoordinator`, NOT because `CommandJob`
captures them. Same owner seam for the held-set.

## 20.5 P1 #2 — notification identity owner freeze

Recon (§06, command-job-manager.ts:927-1030) confirmed:
```text
CommandJob captures:
  - ownerSessionId (from AgentToolContext.sessionId at construction)
  - NO taskId (does not exist on AgentToolContext at construction time)
  - NO epoch (not in scope for CommandJob)
```

The BTCONT marker captures `(sessionId, taskId, epoch)` at the
`SdkSessionEventCoordinator` seam, by reading `options.getTask?.()?.taskId`
and an internal epoch counter. This is the SAME owner seam for the
notification marker.

**Freeze (corrected)**:

```text
NOTIFICATION_IDENTITY_OWNER = session/coordinator-owned
  Recorded at SdkSessionEventCoordinator construction (or equivalent
  coordinator seam where options.getTask().taskId is reachable).
  Captured at run_commands call time:
    - sessionId   (already on AgentToolContext; bind at construction)
    - taskId      (read options.getTask().taskId at run_commands time;
                   may be undefined if not in a task context)
    - epoch       (coordinator-managed epoch counter; bumped on
                   task reset, follow-up start, etc.)
  Stored in a per-session identity map keyed by jobId:
    Map<jobId, { sessionId, taskId, epoch, notifyOnCompletion }>
  Cleared on terminal-committed (after wake enqueue) and on session
  end.

The wake consumer reads from this map; it does NOT read from
CommandJob directly. This keeps CommandJob unchanged (the bounded
internal command-job-manager.ts footprint is preserved).

Implementation is the responsibility of the bounded implementation
successor ACT. This ACT freezes the OWNER, not the implementation.
```

This freeze acknowledges that the current `CommandJob` does not
have `taskId` and prohibits silently broadening `CommandJob` to
add it (which would either leak task identity into the snapshot or
require new encapsulation work).

## 20.6 P1 #3 — wake payload surface freeze

Recon (§06, pending-prompt-service.ts:238-247) confirmed:
```text
PendingPromptsController.enqueue(
  sessionId: string,
  entry: {
    prompt: string;
    mode?: AgentMode;
    delivery: "queue" | "steer";
    userImages?: string[];
    userFiles?: string[];
  }
): void
```

`PendingPromptsController.enqueue` is **prompt-shaped**: it accepts a
`prompt: string`, not a typed payload. There is no typed-event seam
in the current codebase.

The original contract incorrectly promised "typed wake payload, not
prose". This is unproven.

**Freeze (corrected)**:

```text
WAKE_REPRESENTATION = bounded generated prompt string
  Generated by the wake consumer (in the bounded implementation ACT).
  Schema (final-string form):
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
    - stdoutTail / stderrTail are bounded ~80 lines (per existing
      maxRetainedOutputChars / maxResponseOutputChars limits)
    - elapsedMs = tsMs - startedAtMs

  The wake prompt is bounded in total characters (cap = 8 KB hard
  limit; cap = 4 KB soft target).

This freeze HONORS the existing prompt-shaped surface. The successor
ACT generates the string via a single function
(`formatTerminalWakePrompt(payload)`) so the schema is testable and
diff-stable across versions.

The "typed payload" claim from the original packet is retracted. The
typed schema lives in code, NOT in the queue payload.
```

## 20.7 Correction cycle scope

```text
FILES_AMENDED:
  08-user-intent-matrix.md     (P0 #2: WAIT = NOTIFY in v1; STRICT_WAIT deferred)
  14-contract-decision.md      (P0 #2: WAIT row removed from semantic table;
                                     STRICT_WAIT row added as future-cycle)
  15-contract-wording.md       (P1 #3: wake = bounded generated prompt string,
                                     schema frozen; P1 #2: identity owner frozen)
  16-scenario-suite.md         (P0 #2: S1-S4 retitled as NOTIFY;
                                     P1 #1: S10 uses per-job terminal events)
  18-successor-authorization.md  (P1 #1, #2, #3: implementation brief updated)
  19-final-review.txt          (false claims removed; post-commit HEAD recorded)
  result.json                  (all five fields updated; exit_head = post-commit)
  .factory/epic-board.md       (corrected summary)
  THIS_ARTIFACT (20)           (correction record)

FILES_UNCHANGED:
  01, 02, 03, 04, 05, 06, 07, 09, 10, 11, 12, 13, 17
  (recon and compat evidence stands)

PRODUCTION_FILES_TOUCHED: 0
TEST_FILES_TOUCHED: 0
EXIT_HEAD: (post-commit, recorded in 19 + result.json)
```

## 20.8 Post-correction freeze summary

```text
SELECTED_CONTRACT = B (WS-B_EXPLICIT_NOTIFY_ON_TERMINAL) — UNCHANGED
DEFAULT = notifyOnCompletion=false (preserves current behavior) — UNCHANGED
PERSISTENCE = EPHEMERAL_ONLY (v1) — UNCHANGED

WAIT (v1) = NOTIFY (honest collapse; documented in 08, 14, 15, 16)
WAIT (strict) = STRICT_WAIT (future cycle; requires Candidate C architecture)

NOTIFY (v1):
  notifyOnCompletion:true -> one wake at terminal
  Wake consumer subscribed to CommandJobManager.onCommandJobLifecycle
    event: "command_job_terminal_committed" (per-job, fires exactly once)
  Wake representation: bounded generated prompt string
    (format frozen in 15.7 / 20.6)
  Delivery: "queue" by default (waits behind current turn)
  Identity: (sessionId, taskId, epoch) bound at run_commands call
    time, captured at SdkSessionEventCoordinator seam
    (NOT on CommandJob)
  Multi-job: held set at the session/coordinator seam; FIFO drain
    when the last notify=true job terminates (per-job terminal
    events drive the held-set, NOT >0->0 cardinal transitions)

DETACH (v1):
  notifyOnCompletion:false -> no wake; current behavior preserved

TERMINAL_REASONS = {exited, deadline_exceeded, cancelled, spawn_failed}
containment_failed = NO wake (UNSAFE_TO_DECLARE_TERMINAL)

FIRE_AND_FORGET = conserved (default behavior; wake consumer dormant)

RUNTIME_NLP_INFERENCE = FORBIDDEN

STALE_CARD = LIVE_PROVEN_SEPARATE (deferred to
  ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01)

SUCCESSOR = ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01
  (bounded; binding HEAD = exit_head of THIS ACT)
```

## 20.9 Verdict (post-correction)

```text
VERDICT = PASS_WAIT_SEMANTICS_CONTRACT_FROZEN

EXIT_HEAD = 769281892e43401bcf81f7e22765f24b60eb5932
ENTRY_HEAD = 3a201b49c0c2de5a1a7f224e9633d07046400df9

P0 CONTRACT_FREEZE_NOT_DURABLE         = CLOSED (single docs/evidence-only
                                              commit landed;
                                              HEAD = 769281892e43401bcf81f7e22765f24b60eb5932;
                                              git status --short: clean)
P0 WAIT_NOTIFY_SEMANTIC_CONTRADICTION   = CLOSED (WAIT = NOTIFY in v1 honestly;
                                              STRICT_WAIT deferred)
P1 MULTI_JOB_TRIGGER_CONTRACT           = CLOSED (per-job terminal event)
P1 NOTIFICATION_IDENTITY_OWNER          = CLOSED (session/coordinator-owned)
P1 WAKE_PAYLOAD_SURFACE                 = CLOSED (bounded generated prompt)

PRODUCTION_IMPLEMENTATION = AUTHORIZED
  via successor ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01
  bound to exit_head = 769281892e43401bcf81f7e22765f24b60eb5932.
```
