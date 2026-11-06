# ACT-CLINEMM-COMPLETED-TASK-COMPACTION-AUTHORITY01 — RECON

ENTRY_HEAD: c0cb2f6797e02fb1ff96672807b7fb8aae767959
BRANCH: main
WORKTREE_AT_ENTRY: clean (verified with `git status --porcelain=v1` before any edit)

## Observed symptom (LIVE_UI_ONLY)

    Task header          : "✓ Complete"
    Composer             : "Start New Task"
    Manual compaction    : "Cannot compact while a response is in progress.
                            Try again once the current turn finishes."
    Purple banner        : deferred completion awaiting observation of
                           unconsumed terminal results
    Visible task/session : 1793873645457_fg2wh
    Task content         : ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02

Classification: LIVE_UI_ONLY. Proves the visible contradiction. Does NOT
prove which side is wrong.

## Ownership map (source paths + line ranges, at ENTRY_HEAD)

| # | Question | Owner | Location |
|---|---|---|---|
| 1 | Who produces the displayed `Complete` state? | `SdkSessionEventCoordinator` — `setTurnPhase("completed", …)` with writerId `session-event-turn-complete-completed` | apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2961 (deferred release), :5525 (immediate commit) |
| 1b | Who projects it to "✓ Complete" / "Start New Task"? | webview `stateLabel` projection from `turnState.phase` | apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts |
| 2 | Who produces `Start New Task`? | same projection — phase `completed` maps to the new-task affordance | webview task-header helpers (see §1b) |
| 3 | Who owns `activeSession.isRunning`? | `SdkSessionLifecycle` — the single mutable flag on `ActiveSession` | apps/vscode/src/sdk/sdk-session-lifecycle.ts:315-326 (`setRunning`), :606 (session start installs `isRunning: true`) |
| 4 | Who decides whether compaction is allowed? | `SdkCompactionCoordinator.compactTask()` — reads `activeSession.isRunning` at the entry check and RE-CHECKS it inside the rebuild mutex | apps/vscode/src/sdk/sdk-compaction-coordinator.ts:210 (entry), :231 (inside mutex), :307 (displayed-task path) |
| 5 | How does compaction select the target? | active session if one exists (by `sessionId`, not object identity); otherwise the displayed task is resumed into an isolated host | apps/vscode/src/sdk/sdk-compaction-coordinator.ts:206-237, :297-340 |
| 6 | Who owns pending terminal observations and deferred completion? | `SdkSessionEventCoordinator.deferredCompletionBarrier` marker + `BackgroundNotifyCoordinator` unconsumed-terminal accounting | apps/vscode/src/sdk/sdk-session-event-coordinator.ts:914 (marker), :2245 (`reevaluateDeferredCompletionBarrier`) |
| 7 | Which event/promise settlement is authoritative for turn completion? | the runtime's `agent_turn_done` capture → `notifyAgentTurnDone` → `reevaluateDeferredCompletionBarrier` | apps/vscode/src/sdk/continuation-cardinality-authority.runtime-capture.ts:106-153, apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3077-3102 |
| 8 | Can a queued/auto-continued turn overlap settlement of the previous turn? | YES. The host-owned BCB continuation is delivered through `sdkHost.send({ delivery: "queue" })` — NOT through `fireAndForgetSend` — so it has NO send-settlement owner | apps/vscode/src/sdk/SdkController.ts:1040-1049 (queue delivery), apps/vscode/src/sdk/sdk-session-lifecycle.ts:965-1040 (`fireAndForgetSend`) |
| 9 | Which synchronization boundary prevents compaction from racing session replacement or new sends? | `SdkSessionRebuildScheduler.runExclusive` (the session-rebuild mutex) + the re-check of `isRunning` and of `sessionId` AFTER acquiring it | apps/vscode/src/sdk/sdk-compaction-coordinator.ts:221-237 |

## Where `isRunning` is set

    true   : sdk-session-lifecycle.ts:606  (session start installs an ACTIVE session)
    true   : sdk-session-event-coordinator.ts:4191  (`pending_prompt_submitted`)
    true   : sdk-followup-coordinator.ts:169, :208
    true   : sdk-mode-coordinator.ts:345
    false  : sdk-session-lifecycle.ts:1026, :1037  (`fireAndForgetSend` settlement — TURN-FENCED by `turnGeneration`)
    false  : sdk-session-event-coordinator.ts:5882  (turn-complete block tail)
    false  : sdk-task-control-coordinator.ts:238, sdk-mode-coordinator.ts:399/:428, sdk-session-lifecycle.ts:753

## The production gap found in recon

`SdkSessionEventCoordinator.handleSessionEvent` performs the turn-end
running-state transition (`sessions.setRunning(false)`) at the TAIL of the
`if (result.sessionEnded || result.turnComplete)` block
(sdk-session-event-coordinator.ts:5882).

The DEFERRED completion path — `reevaluateDeferredCompletionBarrier`
(sdk-session-event-coordinator.ts:2245) — commits the SAME terminal
`completed` phase (line 2961) from a DIFFERENT call frame, and performs NO
running-state transition at all.

Consequence: after a deferred completion is released, the session keeps
`isRunning === true` while the webview projects "✓ Complete" and
"Start New Task". Every `isRunning` consumer then disagrees with the UI:

  * the manual compaction guard rejects (THE LIVE SYMPTOM),
  * the passive rebuild scheduler never drains
    (apps/vscode/src/sdk/sdk-session-rebuild-scheduler.ts:205-215),
  * provider / mode / terminal rebuilds are refused.

## Wrong-target hypothesis — ELIMINATED

`getDisplayedTaskId` returns `this.task?.taskId`, and the task id IS the
session id (apps/vscode/src/sdk/SdkController.ts:1275 `taskId: sessionId`).
The displayed task and the active session are therefore the same
conversation for a live task, so the guard is NOT evaluating a different
session. `WRONG_COMPACTION_TARGET` is ruled out.

## Recon exit

Bounded production call path identified:
`SdkSessionEventCoordinator.reevaluateDeferredCompletionBarrier`
(deferred release) → `sessions.setRunning` (MISSING) vs
`SdkSessionEventCoordinator.handleSessionEvent` (immediate commit) →
`sessions.setRunning(false)` (present at :5882).

Existing executable test seam identified:
`apps/vscode/src/sdk/__tests__/background-completion-barrier01.bcb01.test.ts`
(the real `SdkSessionEventCoordinator` harness) and
`apps/vscode/src/sdk/sdk-session-lifecycle.test.ts` (the real
`SdkSessionLifecycle` harness).
