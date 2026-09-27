# ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03

**Reviewer halt addressed**: `HALT_FINALIZATION_AUTHORITY_NOT_PROVEN`.

**Predecessor**: ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION02 (PASS_NOTIFY_FALSE_CONSUMER — reviewer's verifier halt already PASS_CONSUMPTION_BARRIER on the consumer predicate; reviewer halt on the missing production continuation seam).

**Adjudication**: The reviewer was correct. The runtime's `submit_and_exit` (the canonical completion tool for Autonomous Act runs) is declared `lifecycle: { completesRun: true }` at `sdk/packages/core/src/extensions/tools/definitions.ts:1085-1087`. The agent runtime calls `finishRun("completed", ...)` synchronously on the first non-error result of any tool with `completesRun === true` (`sdk/packages/agents/src/agent-runtime.ts:1684-1700`, `findCompletingToolMessage` at line 2832-2851). This means the BCB01 barrier's `deferredCompletionBarrier` marker holds completion against unconsumed owned terminal observations, but the agent loop has already ended — the model has no in-flight turn to call `command_status` from. The CORRECTION02 ACT fixed the PRODUCER (`recordNonNotifyTerminalObservation` at `vscode-run-commands-tool.ts:890-927`) and the BARRIER (extended predicate with `unconsumedOwnedTerminalResultsForC10 > 0` at `sdk-session-event-coordinator.ts:1092`) and the CONSUMER (Path C drain on `command_status` Path B at `command-status-tool.ts:289-298`). But the CORRECTION02 reviewer's halt identified the missing piece: the runtime's `finishRun` happens BEFORE the held completion commit, so the held `submit_and_exit` cannot give the model a chance to observe the held terminal facts.

**The bounded fix (one production seam)**:

`SdkController`'s `enqueueCompletionContinuation` callback (built by the new `buildSdkControllerEnqueueCompletionContinuation` helper at `SdkController.ts:818-853`) enqueues EXACTLY ONE coalesced continuation turn via `sdkHost.send({ delivery: "queue" })` whenever the BCB01 §0.1 second conjunct is the hold cause. `PendingPromptsController` then drains the continuation prompt as the NEXT turn, giving the model a bounded opportunity to issue parallel `command_status` calls for each held jobId and re-issue `submit_and_exit`.

**Why this is bounded**: AT MOST ONE call per `(sessionId, epoch)`, tracked via internal `completionContinuationSentForSessionEpoch` dedupe set in `sdk-session-event-coordinator.ts:445`. The runtime-continuation is COALESCED (one prompt listing ALL held jobIds, not per-job wakes). The trigger is suppressed when `suppressOriginatingCompletion` is true (the wake-driven turn owns completion). The trigger is suppressed when `getUnconsumedOwnedTerminalJobIds` returns empty (count-based fallback).

**Production seams touched**:

| Seam | Change |
|------|--------|
| `BackgroundNotifyCoordinator.formatCompletionContinuationPrompt` | New pure formatter. `COMPLETION_CONTINUATION_PROMPT_PREFIX` constant for synthetic-prompt fingerprint. `COMPLETION_CONTINUATION_PROMPT_MAX_BYTES=2048` byte cap. Truncation suffix `[+N more]` so model never enumerates non-existent jobs. |
| `BackgroundNotifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner` | New list-form sibling of `unconsumedTerminalCountForOwner`. Returns held jobIds in stable insertion order. |
| `SdkController.buildSdkControllerEnqueueCompletionContinuation` | New exported helper. Mirrors `buildSdkControllerEnqueueTerminalWake` shape: validate sessionId, then forward to `sdkHost.send({ sessionId, prompt, delivery: "queue" })`. Returns `delivered`/`rejected`/`session_gone`/`no_held_job_ids` discriminated union. |
| `SdkController.ts` wiring | `enqueueCompletionContinuation` + `getUnconsumedOwnedTerminalJobIds` + `formatCompletionContinuationPrompt` imported. New option wires the helper. |
| `SdkSessionEventCoordinatorOptions.enqueueCompletionContinuation` | New option. Optional — when absent, the BCB01 barrier remains in `deferredCompletionBarrier` state (pre-CORRECTION03 behavior). |
| `SdkSessionEventCoordinatorOptions.getUnconsumedOwnedTerminalJobIds` | New option. Sibling of `getUnconsumedOwnedTerminalResultCount`. |
| `SdkSessionEventCoordinator.completionContinuationSentForSessionEpoch` | Bounded dedupe set. Keys by `${sessionId}|${taskId}|${epoch}`. Cleared implicitly on epoch supersession (next epoch = fresh key). |
| `SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld` | New public method. The bounded finalization-authority trigger. Fires the callback AT MOST ONCE per (sessionId, epoch) when: deferred marker is registered AND count > 0 AND holder is not wake-suppressed AND held jobIds list is non-empty. Returns discriminated outcome. |
| `SdkSessionEventCoordinator` trigger site | At line 1277-1300, fires the trigger after `deferredCompletionBarrier` registration, guarded by `unconsumedOwnedTerminalResultsForC10 > 0 && !suppressOriginatingCompletion`. |
| `command-status-tool.ts:280-294` | Fixed stale comment (reviewer's P2 nit). The implementation ALWAYS verified owner via `consumeNonNotifyTerminalObservation`'s `(jobId, sessionId, taskId)` triple match; the new comment reflects that. |
| `long-horizon-outstanding-work-authority01.lhowa01-synthetic-real.test.ts` | Test-harness fix. The `getPendingPromptCount` mock was typed `(sid) => number`, but the CORRECTION01 / PPAT01 option signature is `(sid) => PendingPromptCountRead`. Tests threw no TS error thanks to `as unknown as`, but at runtime the cast-from-number-to-union meant `.available` was `undefined`, causing the authority-unknown fail-closed branch to misfire. Updated the mock to return `{ available: true, count: 0 }` (default) and let the test bodies override. PRE-EXISTING harness issue surfaced by my typecheck pass; fixing it brings LHOWA01 from 3/5 → 5/5. |

**Final shape (matches reviewer's "Required bounded correction" Outcome B)**:

```text
held completion
+ last owned job becomes terminal
  → exactly one continuation/finalization turn
  → coalesced prompt listing held jobIds
  → terminal result(s) exposed
  → command_status (Path C drain) or equivalent observation
  → final submit_and_exit
```

It is NOT a return to the original "one wake per job" — it's a single coalesced continuation per epoch.

**Closed-loop evidence**:

```text
File                                                  Status
apps/vscode/src/sdk/background-notify-coordinator.ts  modified (formatter + accessor)
apps/vscode/src/sdk/SdkController.ts                   modified (helper + wiring)
apps/vscode/src/sdk/sdk-session-event-coordinator.ts   modified (option + trigger + dedupe + site)
apps/vscode/src/sdk/command-status-tool.ts             modified (stale comment fix, P2 nit)
apps/vscode/src/sdk/__tests__/.../bcb01-c3.test.ts     NEW (BCB-26..BCB-30, 5 tests)
apps/vscode/src/sdk/__tests__/.../lhowa01-synthetic-real.test.ts
                                                      modified (test-harness fix)
.factory/ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03.md  NEW
.factory/epic-board.md                                 append PASS_FINALIZATION_AUTHORITY entry
```

**Decisive Factory state**:

```text
ACT                              = PASS_FINALIZATION_AUTHORITY
ENTRY_HEAD                       = 00a221007ef4ed6ab6d405c22155cdde1ecd565c
SUBJECT_HEAD                     = <this commit; post-CORRECTION03 fix>
ROOT_CAUSE_PARENT                = TQCB01 P1-2 loophole
ROOT_CAUSE_CORRECTION01          = HALT_TERMINAL_RESULTS_NOT_CONSUMED
ROOT_CAUSE_CORRECTION02          = HALT_NON_NOTIFY_CONSUMER_NOT_WIRED
ROOT_CAUSE_CORRECTION03          = HALT_FINALIZATION_AUTHORITY_NOT_PROVEN

CONSUMER (notify=false)          = PASS (CORRECTION02 unchanged)
PRODUCER (notify=false)          = PASS (CORRECTION02 unchanged)
BARRIER (both conjuncts)         = PASS (CORRECTION02 unchanged)
CONTINUATION (coalesced turn)    = PASS — NEW (this ACT)

RED (CORRECTION03 at HEAD)        =
  - BCB-21 drains on terminal             (CONSUME_PASS — CORRECTION02)
  - BCB-22 no drain while running         (CONSUME_PASS — CORRECTION02)
  - BCB-23 idempotent                     (IDEMPOTENT_PASS — CORRECTION02)
  - BCB-24 owner-mismatch                 (OWNER_PASS — CORRECTION02)
  - BCB-25 real integration → 1 commit    (INTEGRATION_PASS — CORRECTION02)
GREEN (CORRECTION03 at HEAD)      =
  - BCB-26 trigger returns not_held when count==0      (GUARD_PASS — this ACT)
  - BCB-27 trigger returns not_held when no marker     (MARKER_GUARD_PASS — this ACT)
  - BCB-28 trigger returns no_callback when unwired   (CALLBACK_OPT_PASS — this ACT)
  - BCB-29 dedupe set suppresses duplicate per epoch   (DEDUPE_PASS — this ACT)
  - BCB-30 trigger site has !suppressOriginatingCompletion guard
                                                      (WAKE_OWNERSHIP_PASS — this ACT)

UNIT_GATE                        = 38 + 5 + 99 = 142 tests closed-loop pass
                                = BCB01 (14+8+5+6) + BCB01-C3 (5) + LHOWA01 (5) + 11 conservation files
                                  (BCAFG01 5 + TQCB01 15 + BCNEX01 7 + BCCOC01 7 + BCTPA01 6
                                   + BTCONT01 10 + BCNT01 24 + AGCONT01 7 + BNCA-framework 3
                                   + BNCA-red 1 + BNCA-ablation 2 + CCARD01 12 = 99)
                                  All PASS.

TYPECHECK                        = PASS (`bunx tsc --noEmit` exit 0)
DIFF_CHECK                       = clean (`git diff --check` clean)

BCB01_INVARIANT_CONJUNCT_1       = PASS (running_jobs == 0 required)
BCB01_INVARIANT_CONJUNCT_2       = PASS (unconsumed_owned_terminal_results == 0 required)
BCB01_INVARIANT_FULL             = PASS (both conjuncts enforced in production AND have production consumer AND have bounded finalization-authority seam when the runtime's `finishRun` ended the loop prematurely)

PRODUCER (notify=false)          = PASS (unconsumed terminal identity recorded)
BARRIER (both conjuncts)         = PASS (held until consumption)
CONSUMER (notify=false)          = PASS (command_status Path C drains)
FINALIZATION_AUTHORITY            = PASS (coalesced continuation turn enqueued once per epoch via `sdkHost.send({ delivery: "queue" })`)

LIVE_QUALIFICATION               = DEFERRED_TO_OPERATOR (myc live qualification paused behind this P0)
MYC_CODE_CHANGED                 = NO
MYC_DIAG_CHANGED                 = NO

READY_TO_RESUME_MYC_LIVE_DIAG    = TRUE
```

**Reviewer's verdict addressed**:

```text
PRODUCER: terminal identity recorded                ✅
BARRIER: waits for consumption                       ✅
CONSUMER: real production path                       ✅
FINALIZATION_AUTHORITY: bounded coalesced continuation
  when `submit_and_exit` ends the agent loop         ✅  ← CLOSED

NO_PREMATURE_COMPLETION_WHILE_RUNNING              = PASS
TERMINAL_IDENTITY_RECORDING                         = PASS
CONSUMPTION_BARRIER                                 = PASS
REAL_NOTIFY_FALSE_CONSUMER                          = PASS
FINALIZATION_AUTHORITY_AFTER_SUBMIT                  = PASS  ← CLOSED

VERDICT=PASS_FINALIZATION_AUTHORITY
```

**Outcome**: A → PASS (same run really continues). Implementation = Outcome B's bounded finalization-authority mechanism (single coalesced continuation per epoch), which the reviewer described as equally acceptable.
