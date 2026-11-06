# ACT-CLINEMM-COMPLETED-TASK-COMPACTION-AUTHORITY01 — CAUSALITY

## 1. Classification

    STALE_RUNTIME_BUSY

Proven condition: the relevant turn is IDLE, but the runtime activity flag
(`activeSession.isRunning`) remains `true`.

Repair ownership: the LIFECYCLE PRODUCER of the running-state transition
(`SdkSessionLifecycle.setRunning(false)`), reached from the deferred
completion release path that commits the terminal phase.

Alternatives considered and ELIMINATED:

| Candidate | Verdict | Why |
|---|---|---|
| `PREMATURE_UI_COMPLETE` | eliminated | The completion commit is AUTHORITIZED (Elm authority + every conservation predicate cleared) and the terminal `completed` phase is the production-intended commit. The UI is not lying; the runtime flag is stale. |
| `WRONG_COMPACTION_TARGET` | eliminated | `getDisplayedTaskId()` returns `this.task?.taskId`, and the task id IS the session id (`SdkController.ts:1275 taskId: sessionId`). For a live task the displayed task and the active session are the same conversation. The guard reads the CORRECT session's `isRunning`. |
| `TURN_SETTLEMENT_RACE` | eliminated | The lifecycle's `turnGeneration` fence (`sdk-session-lifecycle.ts:984-991`) is intact and was exercised: in the reproduction the earlier turn's send settlement was correctly SUPERSEDED (no stale write). The defect is a MISSING settlement, not a racing one. |
| `DEFERRED_COMPLETION_PENDING` | eliminated as the cause | The purple banner is a legitimate statement about the held obligation at the moment it was published. By the time the completion is RELEASED, the obligation is settled (the release's predicates all cleared). The banner is a historical row, not the cause of the compaction rejection. |
| `OTHER_PROVEN_CAUSE` | not applicable | The mechanism above is a direct, proven cause. |

## 2. The causal chain (all links are production code)

    T1  user message → SdkSessionLifecycle.startNewSession
        → ActiveSession{ isRunning: true }                    (sdk-session-lifecycle.ts:606)

    T2  SdkSessionLifecycle.fireAndForgetSend → sdkHost.send(...)   (sdk-session-lifecycle.ts:965)
        → the turn's outbound promise is owned by the lifecycle
        → its settlement is TURN-FENCED by `turnGeneration`         (sdk-session-lifecycle.ts:984-991)

    T3  turn ends: `done` event → SdkSessionEventCoordinator.handleSessionEvent
        → the completion authority HOLDS → the deferred-completion marker is registered
        → `return` at sdk-session-event-coordinator.ts:5457
        → *** the turn-end `setRunning(false)` at :5882 is SKIPPED ***

    T4  the BCB continuation is enqueued through
        `active.sdkHost.send({ delivery: "queue", runtimeControlKind:
        "completion_continuation_control" })`                    (SdkController.ts:1040-1049)
        → *** this turn has NO `fireAndForgetSend` settlement owner ***

    T5  Core drains the queued continuation → `pending_prompt_submitted`
        → SdkSessionEventCoordinator calls `sessions.setRunning(true)`  (:4191)
        → the session is busy again

    T6  the continuation turn ends → the completion is STILL deferred (the authority
        holds) → `return` at :5457 → again no `setRunning(false)`
        → the runtime's `agent_turn_done` capture fires
        → `notifyAgentTurnDone` → `reevaluateDeferredCompletionBarrier`      (:3077, :2245)

    T7  the deferred completion is RELEASED:
        every conservation predicate clears, the authority AUTHORIZEs,
        `setTurnPhase("completed", …)` is written                        (:2961)
        → the webview projects "✓ Complete" + "Start New Task"
        → *** but NO running-state transition happens → isRunning stays true ***

    T8  the user presses Compact → SdkCompactionCoordinator.compactTask()
        → reads `activeSession.isRunning` === true                       (:210)
        → emits "Cannot compact while a response is in progress."        (:211)
        → *** THE LIVE SYMPTOM ***

## 3. Observed state trace (from the real production seam)

The reproduction instruments the REAL `SdkSessionLifecycle` and prints the
authoritative flag at each step:

    isRunning after the held `done` event        : true    (T3 skipped :5882)
    isRunning after the earlier send settles     : false   (T2's fenced settlement corrected it)
    isRunning after the continuation drain       : true    (T5 — the continuation turn started)
    isRunning after the deferred release         : true    (T7 — the release performed NO transition)

    phase after the deferred release             : "completed"   (the UI says "✓ Complete")

    ⇒  phase === "completed"  AND  isRunning === true   — the contradiction.

## 4. Necessity / ablation (executable)

The repair is ONE production statement:

    apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3015
        this.options.sessions.setRunning(false)

ABLATION: removing exactly that line (and nothing else) restores the
failure. See `red.txt` — the ablated run fails EXACTLY ONE test:

    × RED-CONTINUATION: after the BCB continuation turn, a Complete task
      must be compactable
    AssertionError: expected [ Array(1) ] to not include
      'Cannot compact while a response is in…'

The other 5 cases (the negative controls and the conservation cases) PASS
in the ablated run as well — so the repair is NECESSARY for the defect and
does not merely move a goalpost for the controls.

## 5. Why the repair is safe (no guard weakened)

1. **It is the SAME lifecycle transition the immediate commit path already
   uses.** `SdkSessionEventCoordinator.handleSessionEvent` calls
   `sessions.setRunning(false)` at the tail of the turn-complete block
   (:5882). The deferred commit path now performs the identical transition
   at the identical semantic moment (the terminal completion commit). No
   new state machine, no second canonical authority.

2. **The release's own conservation predicates already prove idleness.**
   The release is reachable only after ALL of these clear:
   `pendingPromptAuthorityUnknown === false` (the pending-prompt authority
   was AVAILABLE — fail-closed, not assumed),
   `pendingPromptsKnown === 0`, `activeNotifyCount === 0`,
   `perJobOutstandingNotifyWork === false`, `ownerStillRunning === false`,
   `unconsumedOwnedTerminalResultCount === 0` and no unconsumed owned
   terminal job ids, `perJobSuppressOriginatingCompletion === false`,
   `unresolvedContainmentFailuresForDeferredC10.length === 0`.
   Every HOLD branch of the release path `return`s BEFORE the new line.

3. **The release is IDENTITY-FENCED.** The marker must match the active
   session id, the active task id and the current epoch; a mismatch
   clears the marker and returns before reaching the new line
   (:2285-2420).

4. **The compaction guard is NOT weakened.** It keeps reading `isRunning`.
   A genuinely running turn is still `isRunning === true` — proven by the
   NEGATIVE CONTROL case ("a genuinely running turn stays blocked from
   compaction") and by the CONSERVATION case ("a DEFERRED completion that
   is still HELD keeps compaction blocked").

5. **Turn identity and queued-turn handling are untouched.** The
   lifecycle's `turnGeneration` fence is neither read nor written by the
   repair, so a superseded turn still cannot mark the session idle. The
   release's queued-prompt predicate still HOLDS the completion while any
   prompt is queued.

6. **The `onDidBecomeIdle` side effect now fires for the deferred turn
   end**, exactly as it does for a non-deferred turn end. This is a
   REPAIR of a missing notification (the passive rebuild scheduler could
   never drain a deferred-completed session), not a new behaviour.

## 6. Scope discipline

The repair does NOT touch:
  * the compaction guard (it still reads `isRunning`),
  * the deferred-completion barrier's predicates or hold branches,
  * the Elm completion authority,
  * the lifecycle's `turnGeneration` fence,
  * the compaction mutex (`rebuilds.runExclusive`) or its re-check.

The unrelated pre-existing worktree modification
(`.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md`,
a timestamp-only regeneration from an earlier ACT) was NOT staged and NOT
modified by this ACT.
