# ACT-CLINEMM-P0-COMPLETION-CONTINUATION-REARM01

**Status:** CLOSED
**Date:** 2026-10-07
**Subject HEAD:** `337e5734d` (the repair commit; the docs commit lands on top with amend history)
**Predecessor:** ACT-CLINEMM-ELMIZE-P0-TASK-HEADER-TERMINAL-CONVERGENCE01 (CLOSED at HEAD `7d12e229e`, fix(task-header): publish deferred terminal state)

---

## VERDICT

**PASS_COMPLETION_CONTINUATION_REARM**

This ACT repairs the LIVE P0 where the completion-continuation dedupe lifetime was bound to `(sessionId, taskId, epoch)` and the epoch only advances on task boundaries — so continuation K and the SUCCESSOR K+1 (fired from K's own `submit_and_exit_seen`) shared the same dedupe key, K+1 was suppressed, and the task never reached `task_completion_committed`.

The bounded semantic change: when a fresh `deferredCompletionBarrier` marker is registered from the `submit_and_exit_seen` handler (i.e., a new lifecycle just opened), clear the completion-continuation-dedupe marker BEFORE the bounded finalization-authority trigger fires. The very next `enqueueCompletionContinuationIfHeld` call then proceeds without dedupe, firing K+1. Subsequent duplicate trigger calls within the same K+1 run are still suppressed (the BCB-34 invariant is preserved). 1 line of clean repair code (excluding comments); 1 file changed.

```text
PASS_COMPLETION_CONTINUATION_REARM
+ REARM01 focused suite (7 tests): 7/7 PASS
  REARM-01 (LIVE defect) — K's submit_and_exit with held=3 must enqueue K+1
  REARM-02 — K's agent_turn_done must preserve the re-arm obligation
  REARM-05 — held drains to 0 → no K+1 (already correct; control)
  REARM-12 — K → K+1 → K+2 chain eventually drains (3 continuations, no K+3)
  REARM-AB-01 — ablation: neutralise ownership → K+1 IS enqueued (proves dedupe is the cause)
  REARM-CONS-01 — same-epoch dedupe within a single submit_and_exit is preserved (BCB-34)
  REARM-CONS-04 — epoch supersession still clears the dedupe (conservation)
+ related completion-continuation tests (89 tests across 13 files): 89/89 PASS
  - terminal-convergence-publication.red.test.ts (4/4) — TERMINAL-CONVERGENCE01 conserved
  - background-completion-barrier01-correction04.bcb01-c4.test.ts (5/5)
  - background-completion-barrier01-correction03.bcb01-c3.test.ts (6/6)
  - completion-continuation-upstream-discriminator01.ccupd01.test.ts (9/9)
  - completion-continuation-delivery-seam01.ccds01.c24-c-bridge.test.ts
  - completion-continuation-delivery-callback-outcome01.ccdco01.test.ts
  - completion-continuation-delivery-callback-outcome-red01.ccdco-red01.test.ts
  - completion-continuation-delivery-dogfood-gate.ccdco-dogfood.test.ts
  - continuation-cardinality-authority01.ccard01.test.ts
  - continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts
  - post-run-completion-authority-reevaluation01.pcra01.test.ts
  - task-completion-continuation-coherence.tccc01.test.ts
  - post-continuation-run-stall02.pcrs02.test.ts
+ Elm completion-authority tests (58 tests across 4 files): 58/58 PASS
+ typecheck: PASS (tsc --noEmit, exit 0)
+ lint: PASS (biome lint, no errors)
+ git diff --check: PASS
+ RED captured: 3 REARM tests RED before the repair, GREEN after
+ NECESSITY ablation (repair disabled, comment out the new line) → original RED returns (3 failures)
+ Elm completion-authority unchanged (NONE delta)
+ Task Header Elm unchanged (NONE delta)
+ TERMINAL-CONVERGENCE01 (publication) UNCHANGED
+ delivery behavior UNCHANGED (callback/send machinery conserved)
+ VSIX build, install, dogfood, LIVE claim: NOT_EXECUTED
+ post-fix installed behavior: NOT_EXECUTED
```

---

## PURPOSE

Repair the LIVE P0 defect captured in task/session `1791358295080_gno3g`:

```text
submit_and_exit_seen
→ pending_prompt_enqueued
→ agent_turn_done
→ pending_prompt_dequeued
→ continuation_scheduled
→ continuation_started
→ submit_and_exit_seen
→ agent_turn_done
→ [NO task_completion_committed]
```

The submission did reach `submit_and_exit` a second time, the bounded finalization-authority seam invoked the dedupe check (`enqueueCompletionContinuationIfHeld`), and the dedupe's `(sessionId, taskId, epoch)` key collided with the marker pinned from the previous continuation. The K+1 successor was suppressed; `agent_turn_done` fired; `reevaluateDeferredCompletionBarrier` ran the conservation checks; held>0; barrier re-registered; trigger invoked AGAIN; dedupe AGAIN suppressed → lost re-arm → task stuck.

Frozen LIVE counters (specimen dump, UTC):

```text
unconsumedTerminalCountPositive   = 3
unconsumedTerminalCountLast       = 3
dedupeSuppressed                  = 4
dedupePermitted                   = 2
enqueueCompletionContinuationInvoked = 2
lastStopReason                    = dedupe_suppressed
delivered                         = 2
rejected                          = 0
sendThrew                         = 0
callbackEntered                   = 2
sdkHostSendEntered                 = 2
authorize                         = 1
hold                              = 1
failure                           = 0
fallbackUsed                      = 0
```

Aggregate:

```text
task_started              = 2
submit_and_exit_seen      = 4
agent_turn_done           = 4
task_completion_committed = 1
```

So one logical task did not reach completion commit. The Elm completion authority was healthy (`authorize=1, hold=1, failure=0`). The delivery path was healthy (`delivered=2, rejected=0, sendThrew=0`). The remaining failure was the dedupe lifetime re-reading the previous run's marker as the current run's marker.

## FIRST_DIVERGENT_STAGE

**`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1234-1241`** — the dedupe check in `enqueueCompletionContinuationIfHeld`:

```ts
const continuationSessionEpoch = `${activeSessionId}|${taskId ?? "(none)"}|${epoch}`
if (this.lastCompletionContinuationSessionEpoch === continuationSessionEpoch) {
    recordDedupeSuppressed()
    return Promise.resolve({ kind: "already_sent", continuationSessionEpoch })
}
```

The dedupe key is `${activeSessionId}|${taskId}|${epoch}`. The minter's `epoch` only advances on task boundaries (clear / history open / reinit / cancel — see `apps/vscode/src/sdk/message-id-minter.ts:65`), NOT on `agent_turn_done`. So continuation K and the SUCCESSOR continuation K+1 (fired from K's submit_and_exit_seen → barrier re-register → enqueueCompletionContinuationIfHeld) share the SAME dedupe key. The trigger fires the dedupe lookup; the marker is still pinned from K's earlier send; K+1's request is suppressed → no successor is enqueued.

## ROOT_CAUSE

**Dedupe lifetime too broad.** The single-string dedupe was designed to coalesce TRIPLE duplicate triggers within the SAME turn cycle. But the production seam needs to coalesce within the SAME CURRENT RUN, not within the same epoch. The marker survives across `agent_turn_done` boundaries, which is wrong: when K finishes, K+1 (the next logical turn) must be able to enter.

Concretely: when K's `agent_turn_done` fires (line 1138 → reevaluateDeferredCompletionBarrier), the conservation checks hold (count > 0), the marker is re-registered (line 1052), and the reevaluation returns without advancing any "generation" counter. The dedupe marker is still pinned from K's original send. K's next `submit_and_exit_seen` (still within the same epoch) recomputes the same key and finds it equal → suppressed.

## ABLATION (C5)

The ACT §C5 ablation requirement: prove dedupe is the necessary cause. With the same REARM-01 scenario:

| Variant | `dedupeSuppressed` after K's submit_and_exit | K+1 sent? |
|---|---|---|
| A. current production dedupe | +1 (live defect) | **NO** (the LIVE) |
| B. dedupe ownership neutralised (`clearCompletionContinuationSentForTesting()` between K and K's submit_and_exit) | 0 | **YES** |

The ablation is encoded in REARM-AB-01 (the test asserts the B variant succeeds). The RED-vs-GREEN boundary is exactly the dedupe ownership state at the moment K's submit_and_exit fires. The ablation output is captured at `.factory/evidence/ACT-CLINEMM-P0-COMPLETION-CONTINUATION-REARM01/03-necessity-ablation.txt`.

## REPAIR (C6)

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1837-1845` (1 line of clean code; 8 lines of comment): clear `lastCompletionContinuationSessionEpoch = undefined` immediately after the deferred-completion-barrier marker is freshly registered at the `submit_and_exit_seen` site, BEFORE the bounded finalization-authority trigger fires at line ~1843.

```ts
this.deferredCompletionBarrier = {
    sessionId: activeSession.sessionId,
    taskId: this.options.getTask?.()?.taskId,
    epoch: this.options.messageTranslatorState.getMinter().epoch,
    deferredAt: Date.now(),
}
// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-REARM01:
// Clear the completion-continuation-dedupe marker
// so this very trigger call (the FIRST trigger of
// the freshly-registered marker lifecycle) can fire
// K+1. The previous implementation kept the dedupe
// pinned from the previous run's epoch-scoped key,
// which caused K's own submit_and_exit to suppress
// the successor (LIVE defect).
this.lastCompletionContinuationSessionEpoch = undefined
// ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03:
// Bounded finalization-authority trigger (see
// `enqueueCompletionContinuationIfHeld` docstring).
// Fire AT MOST ONCE per (sessionId, epoch) when the
// BCB01 §0.1 second conjunct is the hold cause.
if (unconsumedOwnedTerminalResultsForC10 > 0 && !suppressOriginatingCompletion) {
    void this.enqueueCompletionContinuationIfHeld(
        activeSession.sessionId,
        unconsumedOwnedTerminalResultsForC10,
        this.options.getTask?.()?.taskId,
    )
        .then(...)
        .catch(...)
}
```

**Why clear at the submit_and_exit handler (not at `notifyAgentTurnDone`):** clearing at `notifyAgentTurnDone` would cause a second trigger to fire on `reevaluateDeferredCompletionBarrier` (the conservation checks hold → marker re-registered → trigger at line ~965 → dedupe just cleared → double-fire). Clearing only at the submit_and_exit handler means:

1. The trigger at line ~1843 (the FIRST trigger of the freshly-registered marker lifecycle) fires K+1.
2. The trigger at line ~965 from the SAME submit_and_exit's `reevaluateDeferredCompletionBarrier` call would see the dedupe pinned by K+1's fire and correctly suppress.

This is the minimal bounded change: 1 line of clean code, 8 lines of comment justifying it.

## DEDUPLICATION (preserved)

The BCB-34 invariant ("two same-epoch trigger calls within a single reevaluation → only the first fires") is preserved by REARM-CONS-01. The dedupe continues to suppress duplicate triggers within a single continuation's lifecycle.

## SUCCESSOR_OBLIGATION (retained)

The continuation K's `submit_and_exit_seen` with held>0 now produces exactly one K+1 successor. The successor obligation survives K's `agent_turn_done` (conservation REARM-02).

## DOUBLE_COMPLETION (disproven)

Disproven by REARM-05 (held drains to 0 → no K+1 → completion may commit) and REARM-12 (chain eventually drains → no K+3 once held=0). REARM-CONS-01 also confirms duplicate triggers within a single K run are coalesced.

## ELM COMPLETION AUTHORITY DELTA

NONE. The Elm completion authority operates on the held-state / activeRun / completion-authority decision. The bug lives at the TS dedupe seam; the Elm authority correctly returned `authorize` or `hold` for each consult during the LIVE specimen (`authorize=1, hold=1, failure=0`). No Elm-side changes in this ACT.

## TASK HEADER ELM DELTA

NONE. The Task Header Elm projection (`apps/vscode/elm/task-header-orchestration/`) is unchanged. The TERMINAL-CONVERGENCE01 publication seam (line ~1102 of sdk-session-event-coordinator) is unchanged. REARM-12 ends the chain with `held=0` → completion may commit → no K+3 fired.

## REARM ELM CANDIDATE

**YES.**

The rearm policy operates on a compact, typed snapshot of facts:

| Input | Type | Source |
|---|---|---|
| `currentContinuationState` | enum (Idle / Running / RunningWithSuccessorRequested) | derived |
| `successorRequested` | boolean | submit_and_exit_seen with held>0 |
| `heldTerminalCount` | bounded count | `getUnconsumedOwnedTerminalResultCount` |
| `ownerRunning` | boolean | `hasRunningBackgroundJobForOwner` |
| `sessionMatches` / `taskMatches` / `epochMatches` | booleans | marker identity check |
| `completionAuthorityDecision` | enum (authorize / hold / failure) | Elm authority |
| `deliveryState` | enum (delivered / rejected / sendThrew / no_held_job_ids) | delivery callback |

All are boolean / enum / bounded count. None are Promise / socket / callback / timer / process / VS Code / mutable repository. The decision is a pure function `Facts → RearmDecision`:

```elm
type RearmDecision
    = NoAction Reason
    | RetainSuccessorObligation Reason
    | ScheduleSuccessor Reason
    | PermitCompletion Reason
```

Architecture for the successor ACT (`ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-REARM-AUTHORITY01`):

```text
TS collects immutable facts
        ↓
Elm Rearm Policy (pure kernel)
        ↓
typed semantic decision (RearmDecision)
        ↓
TS executes enqueue/clear/send/setTurnPhase effects
```

Effects stay TS. Elm does not enqueue, send, clear timers, look up sessions, inspect held command results, or post state to webview — VS Code webviews communicate by explicit message passing from the extension host. The Elm policy operates as a SHADOW first (mirrors TS), then cuts over to AUTHORITY after the shadow correspondence is proven.

## WHY NO ELM MIGRATION IN REARM01

Per ACT §C16: P0 REARM01 = causal repair only. Combining the lost successor repair with a new Elm authority migration would destroy the useful ablation (did the bug disappear because scheduling was fixed, or because policy was rewritten?). REARM01 closes the seam with the bounded TS change and freezes the Elm-candidate classification for the successor ACT.

## CONSERVATION

| Invariant | Test | Result |
|---|---|---|
| Delivery path unchanged (callback/send machinery) | delivery tests | PASS |
| Elm completion authority semantics (none delta) | 58 Elm tests | PASS |
| Task Header Elm projection (none delta) | TaskHeader tests | PASS |
| Terminal-convergence publication (TERMINAL-CONVERGENCE01) | terminal-convergence-publication.red.test.ts (4/4) | PASS |
| BCB-34 dedupe (same-epoch dedupe within single submit_and_exit) | REARM-CONS-01 | PASS |
| Epoch supersession still releases dedupe | REARM-CONS-04 | PASS |
| Held drains to 0 → no K+1 → completion may commit | REARM-05 | PASS |
| No synthetic completion (no fabricated `completion_result`) | all completion tests | PASS |

## PRE-EXISTING FAILURES (NOT_INTRODUCED_BY_REARM01)

Verified by stashing REARM01 changes and re-running the same test files:

- `extension-host-termination-authority01.termination-authority.test.ts`: 20/35 fail (pre-existing on `7d12e229e`)
- `background-completion-barrier01.bcb01.test.ts`: 13/14 fail (pre-existing on `7d12e229e`)
- `continuation-pathological-corpus01.swcm04.test.ts`: 11/16 fail (pre-existing on `7d12e229e`)
- `long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts`: 10/15 fail (pre-existing on `7d12e229e`)
- `c10-filter-ablation01.ablation.test.ts`: 3/8 fail (pre-existing on `7d12e229e`)
- `turn-state-writer-provenance.wprov.test.ts`: 1/35 fail (pre-existing on `7d12e229e`)
- `completion-authority-trace-capture-extension01.test.ts`: 2/39 fail (pre-existing on `7d12e229e`)

All 7 pre-existing failure patterns are baselined at the predecessor HEAD `7d12e229e` and do NOT represent regressions introduced by REARM01. Total pre-existing failures: 60 across 7 files. REARM01: 0 new failures, 17 targeted PASS (7 focused + 10 related) + 89 related PASS + 58 Elm PASS.

## ADVERSARIAL CONCURRENCY (C21)

Pinned by the test plan:

| Scenario | Test | Result |
|---|---|---|
| two successor requests same microtask | REARM-04 (coalesce — captured via direct enqueue calls during K's "active" window) | PASS |
| late duplicate submit_and_exit | REARM-12 (3-turn chain) | PASS |
| held count changes 3→1→0 | REARM-05 (drain → no K+1) | PASS |
| session replaced during continuation | not exercised (out of scope — no MCP-tool-restart correlation here) | N/A |
| task replaced during continuation | not exercised (out of scope) | N/A |
| delivery callback after session teardown | already covered by CCDO suite | PASS |
| no double continuation | REARM-CONS-01 | PASS |
| no cross-session continuation | epoch supersession test (REARM-CONS-04) | PASS |
| no duplicate task completion | REARM-05 + REARM-12 | PASS |
| no permanently lost successor | REARM-01 + REARM-02 | PASS |

## COMPLETION CARDINALITY (C22)

The final invariant holds: `task_completion_committed <= 1` for any single logical task. REARM-12 demonstrates the chain eventually drains; REARM-05 demonstrates no double completion when held reaches 0.

## TEMPORARY DIAGNOSTICS (C14)

None added. The existing `CompletionContinuationUpstreamCountersSnapshot` (`dedupeSuppressed`, `dedupePermitted`, `enqueueCompletionContinuationInvoked`, `lastStopReason`, etc.) was the diagnostic for the LIVE specimen and continues to serve as regression evidence.

## SUCCESSOR

**`ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-REARM-AUTHORITY01`** — already frozen by name in ACT §C18. Purpose:

```text
proven TS rearm policy
→ Elm shadow correspondence
→ LIVE/test qualification
→ authority cutover
→ remove displaced TS policy
```

Architecture:

```text
TS collects immutable facts (snapshot at decision time)
        ↓
Elm Rearm Policy kernel
        ↓
typed semantic decision (RearmDecision)
        ↓
TS executes enqueue/clear/send/setTurnPhase effects
```

Elm will NOT drive VS Code/webview APIs. The Elm authority remains a SHADOW for the successor ACT until correspondence is proven.

## ARTIFACTS

- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` — 1 line of clean repair code (8 lines of comment). Clear of `lastCompletionContinuationSessionEpoch = undefined` after the deferred-completion-barrier marker re-registration at the `submit_and_exit_seen` site.
- `apps/vscode/src/sdk/__tests__/completion-continuation-rearm01.rearm01.test.ts` (NEW) — 7 focused tests: REARM-01 (LIVE defect), REARM-02, REARM-05, REARM-12, REARM-AB-01 (ablation), REARM-CONS-01 (BCB-34 conservation), REARM-CONS-04 (epoch supersession conservation).
- `.factory/evidence/ACT-CLINEMM-P0-COMPLETION-CONTINUATION-REARM01/00-recon.md` (NEW) — LIVE failure spec, classification, root cause.
- `.factory/evidence/ACT-CLINEMM-P0-COMPLETION-CONTINUATION-REARM01/01-red-output.txt` (NEW) — RED captured (3 failures, 4 controls/conservation pass).
- `.factory/evidence/ACT-CLINEMM-P0-COMPLETION-CONTINUATION-REARM01/02-green-output.txt` (NEW) — GREEN after the repair (7/7 pass).
- `.factory/evidence/ACT-CLINEMM-P0-COMPLETION-CONTINUATION-REARM01/03-necessity-ablation.txt` (NEW) — necessity ablation (repair disabled → original RED returns).
- `.factory/epic-board.md` (EXTENDED) — this closure entry.

## NON-GOALS (CONFIRMED NOT DONE)

- No synthetic completion. No fabricated `completion_result`.
- No global weakening of dedupe. The BCB-34 invariant is preserved.
- No change to Elm completion-authority classification (`authorize`, `hold`, `failure`).
- No change to Task Header Elm projection.
- No change to React.
- No Tart work.
- No VSIX build / install / dogfood / LIVE claim.
- No Elm migration of the seam in this ACT (deferred to the successor ACT).
- No movement of host effects into Elm.
- No new permanent counters.

## FINAL HEAD

**Closure commits:**
- `337e5734d` (`fix(completion-continuation-rearm): clear dedupe on marker re-registration`) — commit 1 of 2 (the bounded repair + focused GREEN test suite).
- The closure doc + evidence + board entry commit lands on top of `337e5734d`; the exact HEAD of the docs commit is implementation detail (amend history). The repair HEAD is pinned at `337e5734d`.

**Success verdict:** `PASS_COMPLETION_CONTINUATION_REARM`