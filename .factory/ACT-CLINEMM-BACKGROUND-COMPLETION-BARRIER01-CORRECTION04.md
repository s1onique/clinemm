# ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION04

**Reviewer halt addressed:** `HALT_FINALIZATION_TRIGGER_AT_WRONG_TRANSITION`.

**Predecessor:** ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03 (PASS_FINALIZATION_AUTHORITY — built the right mechanism but fired at the wrong transition; P1 dedupe halt surfaced).

**Adjudication:** The reviewer was right. The CORRECTION03 trigger fires inside the C10 completion processing branch (inside `handleSessionEvent` at line 1277-1300). At that moment in the live chronology:

```text
submit_and_exit (with job J still RUNNING)
↓
unconsumed terminal results === 0 (J hasn't terminated yet)
↓
trigger guard `unconsumedOwnedTerminalResultsForC10 > 0` is FALSE
↓
trigger does NOT fire
```

Then `submit_and_exit`'s `lifecycle.completesRun === true` ends the agent loop (`finishRun("completed", ...)` at agent-runtime.ts:1684-1700). Later, the last job J becomes terminal and `reevaluateDeferredCompletionBarrier` runs from the terminal-idle event. The CORRECTION03 implementation just returned (`if (unconsumedOwnedTerminalResultCount > 0) return;`) without firing the continuation. Result: held completion stays held forever; "Your turn" / `awaiting_followup` UI message; the agent never gets a chance to observe the terminal fact.

**The bounded fix (no redesign of CORRECTION03):**

The CORRECTION03 trigger site at line 1277-1300 is preserved as a fast-path for the case where the observation is already registered at submit_and_exit time. The CORRECTION04 fix is to ALSO fire the trigger at the `reevaluateDeferredCompletionBarrier` terminal-idle re-evaluation transition — when:

```text
deferredCompletionBarrier != undefined
AND ownerStillRunning == false
AND unconsumedOwnedTerminalResultCount > 0
```

Concretely, in `reevaluateDeferredCompletionBarrier` at `sdk-session-event-coordinator.ts:652-653`, the early-return `if (ownerStillRunning) return;` is followed by the existing `if (unconsumedOwnedTerminalResultCount > 0) return;` — and CORRECTION04 replaces the bare return with the trigger fire (`void this.enqueueCompletionContinuationIfHeld(...)`) then return. The `void` keyword ensures fire-and-forget semantics so the re-evaluation never blocks on the host's ack.

**P1 fix (dedupe state bounded):**

CORRECTION03 used `Set<string>` keyed by `(sessionId, taskId, epoch)`. The Set grows unboundedly across epoch advances (only adds keys; never cleans up). CORRECTION04 replaces the Set with a single `lastCompletionContinuationSessionEpoch` string field. `O(1)` memory regardless of coordinator lifetime.

**Production seam change (one new site, no redesign)**:

`reevaluateDeferredCompletionBarrier` now fires the coalesced continuation trigger instead of returning silently when the BCB01 §0.1 second conjunct (`unconsumedOwnedTerminalResultCount > 0`) is the active hold. Single fire-and-forget path. Dedupe key matches the marker’s epoch so the trigger fires at most once per epoch even when `reevaluateDeferredCompletionBarrier` is invoked multiple times (e.g. via multiple terminal-idle callbacks).

**Live chronology, before vs. after**:

```text
BEFORE (CORRECTION03):
J running
↓
submit_and_exit
↓ trigger fires inside handleSessionEvent — but guard `unconsumed > 0` is FALSE → no fire
↓
agent loop ends
↓
J terminal → reevaluateDeferredCompletionBarrier → JUST RETURNS → no continuation
↓ → no model turn → "Your turn" / awaiting_followup
↓ → unconsumed count remains N forever → HALT_FINALIZATION_TRIGGER_AT_WRONG_TRANSITION

AFTER (CORRECTION04):
J running
↓
submit_and_exit
↓ trigger fires inside handleSessionEvent — guard `unconsumed > 0` is FALSE → no fire
↓
agent loop ends
↓
J terminal → reevaluateDeferredCompletionBarrier (terminal-idle)
↓ → CORRECTION04 trigger fires; coalesced prompt lists J; pending prompts drained by runtime
↓ → next model turn: model calls command_status J, observes terminal, calls submit_and_exit again
↓ → BCB01 §0.1 second conjunct drops to 0 → reevaluateDeferredCompletionBarrier commits
   "completed" phase exactly once
↓
exactly 1 task_completion_committed
```

**Closed-loop evidence**:

```text
File                                                                Status
apps/vscode/src/sdk/sdk-session-event-coordinator.ts                modified (CORRECTION04 trigger + P1 dedupe bounded state)
apps/vscode/src/sdk/__tests__/.../bcb01-c4.test.ts                 NEW (BCB-31..BCB-35, 5 tests)
.factory/ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION04.md  NEW
.factory/epic-board.md                                              append PASS_TRIGGER_AT_TERMINAL_IDLE entry
```

**Decisive Factory state**:

```text
ACT                              = PASS_TRIGGER_AT_TERMINAL_IDLE
ENTRY_HEAD                       = 00a221007ef4ed6ab6d405c22155cdde1ecd565c
SUBJECT_HEAD                     = <this commit; post-CORRECTION04 fix>
ROOT_CAUSE_PARENT                = TQCB01 P1-2 loophole
ROOT_CAUSE_CORRECTION01          = HALT_TERMINAL_RESULTS_NOT_CONSUMED
ROOT_CAUSE_CORRECTION02          = HALT_NON_NOTIFY_CONSUMER_NOT_WIRED
ROOT_CAUSE_CORRECTION03          = HALT_FINALIZATION_AUTHORITY_NOT_PROVEN
ROOT_CAUSE_CORRECTION04          = HALT_FINALIZATION_TRIGGER_AT_WRONG_TRANSITION + P1 dedupe unbounded

CONSUMER (notify=false)          = PASS (CORRECTION02 unchanged)
PRODUCER (notify=false)          = PASS (CORRECTION02 unchanged)
BARRIER (both conjuncts)         = PASS (CORRECTION02 unchanged)
CONTINUATION AT INITIAL DONE     = PASS (CORRECTION03 unchanged)
CONTINUATION AT TERMINAL-IDLE    = PASS — NEW (this ACT)
DEDUPE BOUNDED STATE             = PASS — NEW (this ACT, fixes P1)

UNIT_GATE                        = 43 BCB01 family + LHOWA01 + 99 conservation = 142 tests closed-loop pass
TYPECHECK                        = PASS (`bunx tsc --noEmit` exit 0)
DIFF_CHECK                       = clean (`git diff --check` clean)

BCB01_INVARIANT_CONJUNCT_1       = PASS (running_jobs == 0 required)
BCB01_INVARIANT_CONJUNCT_2       = PASS (unconsumed_owned_terminal_results == 0 required)
BCB01_INVARIANT_FULL             = PASS (both conjuncts enforced, production consumer present,
                                          AND bounded finalization-authority seam fires BOTH at
                                          initial-done AND at terminal-idle re-evaluation)

LIVE_QUALIFICATION               = DEFERRED_TO_OPERATOR (myc live qualification paused behind this P0)
READY_TO_RESUME_MYC_LIVE_DIAG    = TRUE
```

**Reviewer's verdict addressed**:

```text
PRODUCER: terminal identity recorded                ✅
BARRIER: waits for consumption                       ✅
CONSUMER: real production path                       ✅
COALESCED_CONTINUATION_MECHANISM                    ✅
TRIGGER_ON_INITIAL_DONE                             ✅ PRESENT (CORRECTION03)
TRIGGER_ON_LATER_LAST-JOB-TERMINAL                   ✅ PRESENT (CORRECTION04, NEW)
DEDUPE BOUNDED (P1)                                  ✅ FIXED (single string marker, O(1) memory)

NO_PREMATURE_COMPLETION_WHILE_RUNNING                = PASS
TERMINAL_IDENTITY_RECORDING                          = PASS
CONSUMPTION_BARRIER                                  = PASS
REAL_NOTIFY_FALSE_CONSUMER                           = PASS
FINALIZATION_AUTHORITY_AFTER_SUBMIT_INITIAL_DONE      = PASS
FINALIZATION_AUTHORITY_AFTER_SUBMIT_TERMINAL_IDLE     = PASS  ← CLOSED (CORRECTION04, NEW)

VERDICT=PASS_TRIGGER_AT_TERMINAL_IDLE
```

**Implementation minimality audit (per reviewer's "Do not redesign")**:

CORRECTION03 machinery (formatter, helper, option, trigger method, dedupe, initial-done site) — **unchanged**. Only:
1. ONE new trigger fire call in `reevaluateDeferredCompletionBarrier` (replaces the existing bare early-return)
2. ONE field rename (`Set<string>` → `string | undefined`) in `completionContinuationSentForSessionEpoch` → `lastCompletionContinuationSessionEpoch`
3. Two test-only backdoor signature updates (string equality instead of Set.has)

No behavioral changes to:
- Producer (vscode-run-commands-tool.ts:890)
- Barrier predicate (sdk-session-event-coordinator.ts:1085+ and reevaluateDeferredCompletionBarrier)
- Consumer (command-status-tool.ts:289-298 Path C drain)
- Initial-done trigger (sdk-session-event-coordinator.ts:1277-1300)
- PendingPromptsController (unchanged)

**Successor:** ACT-MYC-CLINEMM04 (myc live qualification resumption).
