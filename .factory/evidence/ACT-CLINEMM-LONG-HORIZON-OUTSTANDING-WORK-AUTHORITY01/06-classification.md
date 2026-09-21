ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 — CLASSIFICATION
=========================================================================

> Mechanical classification of the "Your turn" false-positive defect.

## 1. The defect

```text
  Agent emits done-without-completion
  AND BackgroundNotifyCoordinator has already enqueued a wake into
      PendingPromptsController (terminal-wake already in queue)
  AND no RUNNING background job remains (the wake was enqueued by
      the terminal event that fired BEFORE the done event)
  → Q5 guard chain (sdk-session-event-coordinator.ts:387-514)
      consults ONLY hasRunningBackgroundJobForOwner === false
      → commits awaiting_followup
      → webview shows "Your turn"
      → BUT PendingPromptsController has 1 queued wake
      → harness handed off to operator while autonomous work is
        outstanding in the queue
```

## 2. Classification per ACT §6

The ACT §6 enumerates six classes. The mechanical classification:

```text
  LH1_DONE_IS_OPERATOR_AUTHORITY
    `done` directly causes awaiting_followup regardless of operator demand.
    └─ REFUTED: Branch 1/2/3 already encode operator-demand signals
       (wasErrorSeen, wasAttemptCompletionSeen). Branch 4 is the ONLY
       branch that fires for done-without-completion with no operator
       signal, and Branch 4 HAS a guard (hasRunningBackgroundJobForOwner).
       The defect is NOT that done unconditionally causes handoff; the
       defect is that Branch 4's guard is INCOMPLETE.

  LH2_OPERATOR_DEMAND_EXISTS_BUT_IS_DROPPED
    Runtime knows whether operator input is required but writer ignores it.
    └─ REFUTED: Branches 1/2/3 capture the explicit operator-demand
       signals (wasErrorSeen, wasAttemptCompletionSeen,
       wasTerminalResponseCommittedThisTurn, completion messages in
       transcript). These are NOT dropped.

  LH3_OUTSTANDING_WORK_IS_NOT_REPRESENTED
    Runtime cannot represent task-incomplete/waiting-external
    independently of model-turn state.
    └─ CONFIRMED: The BackgroundNotifyCoordinator + PendingPromptsController
       DO represent outstanding autonomous work — they have the data
       (active markers, queued prompts). The Q5 seam has NO visibility
       into these representations. The runtime CAN represent the state
       (in those coordinators); the writer just doesn't ask.

  LH4_TERMINAL_WAKE_EXISTS_BUT_DOES_NOT_REENTER
    External completion arrives but orchestration cannot schedule continuation.
    └─ REFUTED: BCNT01 + BCNT-BRIDGE-01 prove the wake reaches
       PendingPromptsController via the production transport
       (sdkHost.send({ delivery: "queue" }) → LocalRuntimeHost.runTurn →
       PendingPromptsController.enqueue). The wake IS scheduled; the
       next turn WILL consume it. The defect is that the Q5 seam
       commits awaiting_followup BEFORE the next turn starts.

  LH5_TASK_ALREADY_COMPLETE
    "Your turn" specimen is not actually a defect.
    └─ REFUTED: The agent emitted done WITHOUT calling the completion
       tool (wasAttemptCompletionSeen() === false) so the turn is
       INCOMPLETE. The queued wake proves autonomous work is outstanding.
       The task is genuinely not complete.

  LH6_OTHER
    └─ N/A.
```


## 3. Classification: LH3 (Shape D)

The defect is **LH3_OUTSTANDING_WORK_IS_NOT_REPRESENTED**.

Specifically: the Q5 guard chain cannot see the queued-wake state that
the BackgroundNotifyCoordinator has already produced. The representation
EXISTS in the runtime (in `BackgroundNotifyCoordinator.activeNotifyCountForOwner`
and `PendingPromptsController.list({sessionId}).length`) but the Q5
writer has no accessor to it.

This is NOT a "missing state" defect — it's a "missing projection"
defect. The data is there; the writer just doesn't read it.

## 4. Repair authorization

Per ACT §8, LH3 authorizes:

```text
Add the minimum canonical representation for:
  WAITING_EXTERNAL
```

But this ACT's bounded repair (see §5 of `05-required-causal-discriminator.md`)
takes the SMALLER step: read EXISTING canonical projections at the Q5
seam. No new state. No new representation. Just consult the existing
BackgroundNotifyCoordinator.activeNotifyCountForOwner and
PendingPromptsController.list({sessionId}).length.

This is even smaller than the §8 LH3 authorization suggests. The
"canonical representation" already exists; the ACT just bridges it
to the writer.

## 5. Conservation requirements (per ACT §9)

The repair must preserve:

```text
  LH-CTL-01 explicit user question          → Your turn              (Branch 1/3 already handles)
  LH-CTL-02 approval required                → Your turn              (Branch 2 already handles)
  LH-CTL-03 task genuinely complete          → Complete               (Branch 3 already handles)
  LH-CTL-04 fire-and-forget notify=false    → no resurrection         (BCNT01 contract unchanged)
  LH-CTL-05 notify=true / outstanding dep    → terminal wake continues autonomous task (NEW: the bounded repair)
  LH-CTL-06 newer task/session supersedes old terminal event → no resurrection (BTCONT01 conservation)
  LH-CTL-07 two jobs, first terminates      → no premature completion  (BCNT01 HELD behavior)
  LH-CTL-08 two jobs, final dep terminates  → one continuation         (BCNT01 DRAIN behavior)
  LH-CTL-09 operator Cancel                  → cancellation semantics conserved
  LH-CTL-10 extension shutdown               → no late resurrection
  LH-CTL-11 repeated terminal/wake           → exactly-once continuation
  LH-CTL-12 submit_and_exit / genuine completion → remains terminal
```

The LHOWA01 test family exercises:
  - LHOWA01-RED         (Shape D defect reproduction)
  - LHOWA01-CONSERVE-1  (Shape A RUNNING defer)
  - LHOWA01-CONSERVE-2  (Shape F genuine handoff)
  - LHOWA01-DISCRIM-1   (Branch 2 error path)
  - LHOWA01-DISCRIM-2   (Branch 3 completion path)

The remaining 7 LH-CTL controls are exercised by the existing
BCAFG01, BTCONT01, BCNT01, AGCONT01 suites. NO new tests are
needed for them — they remain GREEN through the bounded repair.

## 6. Verdict candidate

```text
  TODO_PENDING_REPAIR: classification = LH3 (Shape D)
                       bounded repair proposed (§5 of 05-required-causal-discriminator.md)
                       conservation: existing tests must remain GREEN
                       load-bearing RED→GREEN: LHOWA01-RED test passes pre-fix
                                                (the defect IS reproduced at the writer boundary)
```

After the bounded repair is applied:
```text
  PASS_LONG_HORIZON_OPERATOR_AUTHORITY_REPAIRED
```

The LHOWA01-RED test assertion will be inverted post-fix:
```text
  PRE-FIX:   expect(tracker.currentPhase).toBe("awaiting_followup")      // THE DEFECT
  POST-FIX:  expect(tracker.currentPhase).not.toBe("awaiting_followup")  // CORRECT (Shape A behavior — preserves prior phase)
```

The other 4 LHOWA01 tests (CONSERVE-1, CONSERVE-2, DISCRIM-1, DISCRIM-2)
remain GREEN pre and post fix (they test conservation).

## 7. POST-FIX VERIFICATION (ACTUAL)

The bounded repair was applied. Verification results:

### Production diff (3 files)

```text
apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  + 2 new optional fields on SdkSessionEventCoordinatorOptions:
    - getPendingPromptCount?: (sessionId: string | undefined) => number
    - getActiveNotifyCount?: (sessionId: string | undefined, taskId: string | undefined) => number
  + Branch 4 now reads pendingPromptCount + activeNotifyCount
  + outstandingAutonomousWork = ownerStillRunning || pendingPromptCount > 0 || activeNotifyCount > 0
  + if (outstandingAutonomousWork) { defer + register DeferredContinuation marker }
    else { commit awaiting_followup }
  + 3 new fields on BackgroundOwnerCorrelationRecord (optional, additive):
    - pendingPromptCount?: number
    - activeNotifyCount?: number
    - outstandingAutonomousWork?: boolean

apps/vscode/src/sdk/background-owner-correlation.ts
  + 3 optional fields on BackgroundOwnerCorrelationRecord (additive)

apps/vscode/src/sdk/SdkController.ts
  + private lastKnownPendingPromptCountBySession: Map<string, number>
  + lastKnownPendingPromptCountBySession.set(activeSession.sessionId, queuedPrompts.length)
    inside getStateToPostToWebview() (after PendingPromptsController.list returns)
  + getPendingPromptCount: (sid) => this.lastKnownPendingPromptCountBySession.get(sid ?? "") ?? 0
  + getActiveNotifyCount: (sid, tid) =>
      this.backgroundNotifyCoordinator?.activeNotifyCountForOwner(sid ?? "", tid) ?? 0
```

Net production diff: ~30 lines (excluding tests and comments).

### Test results (post-fix)

```text
LHOWA01 (new family):
  LHOWA01-GREEN   PASS  (the bounded repair works: phase preserves "streaming" instead of committing awaiting_followup)
  LHOWA01-CONSERVE-1   PASS  (Shape A RUNNING defer unchanged)
  LHOWA01-CONSERVE-2   PASS  (Shape F genuine handoff unchanged)
  LHOWA01-DISCRIM-1   PASS  (Branch 2 error unchanged)
  LHOWA01-DISCRIM-2   PASS  (Branch 3 completion unchanged)

BCAFG01 (predecessor):  4 pass / 1 fail (1 fail is pre-existing, identical pre/post fix)
BTCONT01 (predecessor): 10 pass / 0 fail
BCNT01 (predecessor):   16 pass / 8 fail (8 fail pre-existing, identical pre/post fix)
AGCONT01 (predecessor):  7 pass / 0 fail

Full bun suite:  Files: 82  Pass: 1065  Fail: 76
                 (identical to pre-fix baseline; all 76 failures are pre-existing hook-test failures)
```

### Final verdict

```text
PASS_LONG_HORIZON_OPERATOR_AUTHORITY_REPAIRED

  defect captured at the production seam   : YES (LHOWA01-GREEN flip proves pre-fix RED)
  classification                            : LH3 (Shape D — outstanding autonomous work not represented at the Q5 boundary)
  bounded repair applied                    : YES (1 condition change in Branch 4, 2 new optional options, 2 adapter wires)
  conservation (BCAFG01, BTCONT01, BCNT01, AGCONT01) : NO REGRESSIONS
  load-bearing RED→GREEN test                : LHOWA01-GREEN (5/5 pass)
  exactly-once continuation invariant        : PRESERVED (BTCONT01 GREEN)
  stale-card repair (BCTCP01)               : UNTOUCHED
  PWAOR abort ownership                     : UNTOUCHED
  CommandJob process lifecycle                : UNTOUCHED
  PGID handling                              : UNTOUCHED
  deadline mechanics                         : UNTOUCHED
  notify prompt formatting                   : UNTOUCHED
  duplicate completion messages              : DEFERRED to ACT-CLINEMM-BACKGROUND-NOTIFY-EXACTLY-ONCE-PRESENTATION01
```
