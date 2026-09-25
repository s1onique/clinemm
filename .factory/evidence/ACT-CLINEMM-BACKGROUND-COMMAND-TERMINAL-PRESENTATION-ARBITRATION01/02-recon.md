ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01 — RECON
========================================================================

## Repository trust at ACT entry

```text
HEAD    = 24e7ef263
status  = clean (no tracked dirt)
```

Ancestry (last 5 commits):

```text
24e7ef263 ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01: relabel closure as COMPOSED proof (corrects overclaim)
4b76a5348 ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01: add real-host e2e sentinel witness (closes FACTORY HALT_CORRELATION_END_TO_END_NOT_PROVEN)
64f54a945 ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01: bounded jobId-thread repair (boundaries #4-#6)
16881f671 ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01 / CORRECTION01: ACT file + evidence artifacts + epic board delta
0a97b445c ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01 / CORRECTION01: P1 deriveOrigin precedence fix + conservation assertions
```

## Frozen live specimen CCARD cardinality (operator observation)

Per ACT §0 — the operator-observed specimen frozen for this ACT:

```text
terminal_committed          = 1
notify_consume_enter        = 1
wake_created                = 1

pending_prompt_enqueued     = 1
pending_prompt_dequeued     = 1
continuation_scheduled      = 1

run_turn_started            = 2
  origins:
    explicit_user
    pending_prompt_drain

agent_turn_done             = 2
  origins:
    explicit_user
    pending_prompt_drain

task_completion_committed   = 1
```

This confirms:
- terminal/wake/queue cardinality = 1 (one terminal, one wake, one drain)
- TWO agent turns executed (explicit_user + wake_drain)
- ONE task completion committed (the wake_drain turn; the explicit_user turn's completion was held by deferred-completion-barrier)
- TWO_WAKES_HYPOTHESIS = REFUTED_FOR_THIS_SPECIMEN

## Observed presentation duplication

For the same jobId J:

```
presentation A:
    say: "completion_result" — emitted by the explicit_user turn
    text: agent's "I've started the command" intermediate response
    → visible as a chat row

presentation B:
    say: "completion_result" — emitted by the pending_prompt_drain turn
    text: agent's actual command result after wake
    → visible as a chat row
```

Both `say:"completion_result"` rows are visible. The `attemptCompletionSeen` /
`wasTerminalResponseCommittedThisTurn` predicate fires twice. The
`deferred-completion-barrier` correctly holds the phase transition (only ONE
`setTurnPhase("completed", ...)`), but BOTH completion messages are already
pushed to the webview before the barrier check.

## Lifecycle boundary table (source-bound)

| seq | lifecycle boundary | jobId | turn origin | execution effect | presentation effect | source |
|-----|--------------------|-------|-------------|------------------|---------------------|--------|
| 1 | user types request | n/a | n/a | start runTurn | n/a | (webview input) |
| 2 | runTurn(explicit_user) | none | explicit_user | session.isRunning=true | n/a | `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1185-1218` |
| 3 | agent calls run_commands(background, notify=true) | n/a | explicit_user | tool invocation | partial tool row pushed (partial) | `apps/vscode/src/sdk/vscode-run-commands-tool.ts:742-822` |
| 4 | CommandJobManager.start(...) → RUNNING | JOB | explicit_user | registerMarker + tool returns `{status:"running", jobId}` | tool row finalized → visible | `apps/vscode/src/sdk/command-job-manager.ts:2419`; `vscode-run-commands-tool.ts:752-822` |
| 5 | agent turn continues; calls attempt_completion | JOB | explicit_user | content_start "completion_result" (partial) | partial completion row pushed → visible | `apps/vscode/src/sdk/message-translator.ts:1424-1433` |
| 6 | attempt_completion content_end | JOB | explicit_user | completion row finalized + say:"completion_result" | **PRESENTATION A pushed via appendAndEmit** | `apps/vscode/src/sdk/message-translator.ts:1556-1574`; `sdk-session-event-coordinator.ts:474` |
| 7 | agent emits done | JOB | explicit_user | result.turnComplete=true | n/a | `apps/vscode/src/sdk/message-translator.ts:2224` |
| 8 | handleSessionEvent: turnComplete, attemptCompletionSeen, outstandingAutonomousWork=true | JOB | explicit_user | `deferredCompletionBarrier` set; `setTurnPhase("completed", ...)` HELD | n/a (phase held) | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:501-575` |
| 9 | background command completes; terminalPromise resolves | JOB | n/a | `consumeTerminal(...)` → wake → `enqueueTerminalWake(...)` | n/a | `apps/vscode/src/sdk/background-notify-coordinator.ts:299-399, 487-538` |
| 10 | PendingPromptsController.enqueue(wake) | JOB | pending_prompt_drain (queued) | queue entry pushed | n/a | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:238-259` |
| 11 | drain() → runTurn(wake_drain) | JOB | pending_prompt_drain | session.isRunning=true | n/a | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:306-354`; `local-runtime-host.ts:1185-1218` |
| 12 | `pending_prompt_submitted` event | JOB | pending_prompt_drain | `isSyntheticUserPrompt(wake)` → true (existing BCNEX01 filter) → 0 user_feedback rows | n/a | `apps/vscode/src/sdk/message-translator.ts:2303-2332` |
| 13 | agent processes wake, calls attempt_completion | JOB | pending_prompt_drain | content_start "completion_result" (partial) | partial completion row pushed → visible | `apps/vscode/src/sdk/message-translator.ts:1424-1433` |
| 14 | attempt_completion content_end | JOB | pending_prompt_drain | completion row finalized + say:"completion_result" | **PRESENTATION B pushed via appendAndEmit** | `apps/vscode/src/sdk/message-translator.ts:1556-1574` |
| 15 | agent emits done | JOB | pending_prompt_drain | result.turnComplete=true; outstandingAutonomousWork=false | n/a | `apps/vscode/src/sdk/message-translator.ts:2224`; `sdk-session-event-coordinator.ts:553-572` |
| 16 | handleSessionEvent: turnComplete, attemptCompletionSeen, outstandingAutonomousWork=false | JOB | pending_prompt_drain | `task_completion_committed` fired; `setTurnPhase("completed", ...)` | n/a | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:572-577` |

## Where 1 becomes 2 (boundary classification)

| seam | count | boundary |
|------|-------|----------|
| C1 terminal_committed | 1 | CommandJobManager.finalize |
| C2 notify_consume_enter | 1 | BackgroundNotifyCoordinator.consumeTerminal |
| C3 wake_created | 1 | formatTerminalWakePrompt + enqueueTerminalWake |
| C4 pending_prompt_enqueued | 1 | PendingPromptsController.enqueue |
| C5 pending_prompt_dequeued | 1 | drain / shiftNext |
| C6 continuation_scheduled | 1 | LocalRuntimeHost.runTurn immediate path |
| C7 run_turn_started | 2 | explicit_user + pending_prompt_drain (two distinct executions) |
| C8 agent_turn_done | 2 | explicit_user + pending_prompt_drain (two distinct executions) |
| C9 submit_and_exit_seen | 2 | one per turn's attempt_completion |
| **C10 user-visible completion_result messages** | **2** | **one per turn's attempt_completion content_end** |

The duplication is at C10 (the message presentation seam), specifically
at the `appendAndEmit` call in `handleSessionEvent` (line 474 in
`sdk-session-event-coordinator.ts`).

## Why each turn legitimately executes

The frozen CCARD shows `run_turn_started = 2` and `agent_turn_done = 2`. The
ACT spec (and prior ACT §1) explicitly accepts this as legitimate:

```text
Execution cardinality may legitimately be:
  explicit_user run
  +
  pending_prompt_drain run
if the first turn remains alive for unrelated reasons.
```

The defect is NOT in the execution cardinality (C1..C9 are exactly-once per
jobId — confirmed by prior ACT closure).

The defect is at C10: two turns each emit one `say:"completion_result"` message
to the webview, producing two user-visible terminal completion presentations
for ONE logical terminal event.

## Existing presentation arbitration inventory

Inventoryed before introducing any new concept:

| concept | location | purpose |
|---------|----------|---------|
| `isSyntheticUserPrompt(text)` | `apps/vscode/src/sdk/sdk-user-message-mapping.ts:72-110` | filters wake echo user_feedback row (BCNEX01 closure) |
| `wasAttemptCompletionSeen()` | `apps/vscode/src/sdk/message-translator.ts` (state) | tracks whether `attempt_completion` was emitted this turn |
| `wasTerminalResponseCommittedThisTurn()` | `apps/vscode/src/sdk/message-translator.ts` (state) | guards phase transition to "completed" |
| `deferredCompletionBarrier` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:209-232` | holds `setTurnPhase("completed", ...)` when `outstandingAutonomousWork` is true |
| `outstandingAutonomousWork` predicate | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:553-561` | `(pendingPromptAuthorityUnknown \\|\\| pendingPromptsKnown > 0 \\|\\| activeNotifyCount > 0)` |
| `reevaluateDeferredCompletionBarrier` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:337-374` | re-fires held completion when obligations resolve |

## The load-bearing gap

The existing `deferredCompletionBarrier` correctly HOLDS the phase transition
(`setTurnPhase("completed", ...)`) when outstanding autonomous work exists.

But it does NOT suppress the `say:"completion_result"` messages that have
already been pushed via `appendAndEmit` BEFORE the barrier check fires.

The current filter at `sdk-session-event-coordinator.ts:463-468` only strips
`ask:"completion_result"` / `ask:"resume_completed_task"` when
`!activeSession.isRunning`. It does NOT strip `say:"completion_result"`, and
it does NOT consider the `outstandingAutonomousWork` predicate.

## Causal discriminator

Classification: **E. PRESENTATION_COMMIT_DUPLICATED**

Justification (per ACT §8):
- C1..C9 are exactly-once (terminal lifecycle, notify, wake, queue, drain, runTurn, agent turn)
- The duplication is at C10: two distinct turns each emit one
  `say:"completion_result"` message via `appendAndEmit`
- The semantic execution IS correct (both turns do their work; one is the
  intermediate "started the command", the other is the terminal "the command
  completed with output X")
- The duplicate commit is at the `appendAndEmit` presentation seam, where
  the `outstandingAutonomousWork` predicate is NOT consulted before push

## Presentation authority decision (per ACT §10)

The wake_drain turn is the legitimate terminal presentation authority for
`notifyOnCompletion=true` jobs.

Rationale:
1. The wake_drain turn has the actual command result (the explicit_user turn
   only has "running, will notify").
2. The wake_drain turn owns user-visible response completion (the user asks
   for the command result, not for "I started it").
3. If the terminal event occurs while the original turn is still alive (e.g.,
   the user gave the agent more work to do after the background command), the
   wake can drain later and the wake_drain turn presents the result without
   losing notification.
4. The explicit_user turn's `attempt_completion` is an INTERMEDIATE state
   ("I've started the command"); it should not produce a terminal completion
   box.
5. Exactly-once presentation is conserved: the deferred-completion-barrier
   holds the phase; the message-level filter (this ACT's repair) suppresses
   the completion_result message when `outstandingAutonomousWork` is true.

## Bounded repair surface

The minimal-diff repair: extend the existing filter at
`sdk-session-event-coordinator.ts:463-468` to ALSO suppress
`say:"completion_result"` and `ask:"completion_result"` messages when
`outstandingAutonomousWork === true` for the active session/task.

This is NOT a new protocol field. It is NOT a new state. It is NOT a UI
dedupe. It is NOT a string/content match. It IS the SAME predicate the
existing `deferredCompletionBarrier` uses — the predicate is the load-bearing
identity for "this turn's completion attempt is premature".

The repair is the SMALLEST POSSIBLE DIFF that closes C10 → 1 while
conserving:
- C1..C9 = 1 (unchanged)
- deferred-completion-barrier semantics (unchanged)
- task_completion_committed for the wake_drain turn (unchanged)
- OOM repair (unchanged)
- C4→C8 correlation (unchanged)
- queue/steer semantics (unchanged)
- synthetic-prompt predicate (unchanged)

It touches only ONE message filter and adds NO new fields, NO new state,
NO new protocol, NO new public API.

## Out-of-scope reaffirmation (per ACT §3)

This ACT does NOT:
- Reopen delivery-semantics OOM repair
- Reopen jobId correlation repair
- Reopen deriveOrigin precedence
- Reopen wake duplication as the leading hypothesis
- Hide duplicate UI cards
- Add UI-only dedupe
- Add string/content equality dedupe
- Add timer/race heuristic
- Add arbitrary "if turn still active" without authoritative lifecycle predicate
- Restore `delivery` across drain → send
- Add a permanent diagnostic public field
