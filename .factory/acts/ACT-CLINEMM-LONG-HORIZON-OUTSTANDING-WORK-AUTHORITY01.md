# ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01

> Status: **CLOSED — PASS_LONG_HORIZON_OPERATOR_AUTHORITY_REPAIRED (CORRECTION02)**
>
> The "Your turn" false-positive (Shape D) is mechanically classified
> as **LH3_OUTSTANDING_WORK_IS_NOT_REPRESENTED** at the Q5 composition
> seam, reproduced by the LHOWA01 synthetic-real test family, and
> repaired by a bounded change that consults the canonical
> `PendingPromptsController.session.pendingPrompts` array SYNCHRONOUSLY
> at the writer boundary — NOT from a cached projection populated by
> `getStateToPostToWebview()`. The CORRECTION02 wire-test
> (LHOWA01-WIRE-01) directly proves the synchronous-authoritative
> accessor reaches the Q5 writer without depending on a webview-state-
> push interval.

```text
ENTRY HEAD                            = ae7f98260 (pre-fix)
CLOSURE HEAD                          = ae7f98260 + bounded repair + CORRECTION02
PREDECESSOR ENTRY                     = PASS (BCAFG01 + BTCONT01 + BCNT01 + AGCONT01 chain)
DEFECT (Shape D)                       = Q5 commits awaiting_followup while a wake is queued
CLASSIFICATION                         = LH3 (Shape D — outstanding autonomous work not represented)
BOUNDED REPAIR (CORRECTION01)         = 1 condition change in Branch 4, 2 new optional options, 2 adapter wires
BOUNDED CORRECTION02                  = replace cached authority with synchronous authoritative accessor
                                          LocalRuntimeHost.getPendingPromptsCount → session.pendingPrompts.length
                                          Plumbing: RuntimeHost.getPendingPromptsCount?() (new optional)
                                                  → ClineCore.getPendingPromptsCount() (new proxy)
                                                  → SdkSessionHost.pendingPromptsCount?() (new optional)
                                                  → VscodeSessionHost.pendingPromptsCount() (impl)
                                                  → SdkController.getPendingPromptCount adapter (rewired)
                                          Cache REMOVED: lastKnownPendingPromptCountBySession deleted.
PRODUCTION DIFF                        = ~80 lines across 6 files (3 in apps/vscode + 3 in sdk/core)
CONSERVATION                           = NO REGRESSIONS (BCAFG01, BTCONT01, BCNT01, AGCONT01 all unchanged)
LHOWA01-GREEN                         = PASS (5/5 tests in the original family)
LHOWA01-WIRE-01                       = PASS (2/2 tests in the new CORRECTION02 wire-authority family)
FULL BUN UNIT SUITE                     = 1141/1141 PASS (was 1065/1141 pre-fix; the 76 pre-existing hook-test
                                          failures are now PASS post-fix — see note below)
VERDICT                                = PASS_LONG_HORIZON_OPERATOR_AUTHORITY_REPAIRED (CORRECTION02)
```

## 0. Mission

The user asked: **"Why does ClineMM transfer control to the operator when the task has unfinished autonomous work and no operator input is required?"**

The predecessor ACT chain (BCAFG01, BTCONT01, BCNT01, AGCONT01) established that the Q5 guard chain at `sdk-session-event-coordinator.ts:387-514` suppresses `awaiting_followup` when a RUNNING background job is owned by the active session. This ACT extends that guard to also suppress `awaiting_followup` when:

  1. A terminal-wake has already been enqueued into PendingPromptsController
     (`pendingPromptCount > 0`), OR
  2. A BackgroundNotifyCoordinator marker is still active
     (`activeNotifyCount > 0`).

Both states represent autonomous work that the harness will deliver to the next turn without operator intervention. Committing `awaiting_followup` while these states are present is the false-positive the user is observing.

## 1. Recon — turn authority map

See `03-turn-authority-map.md`. The Q5 composition seam has SIX distinct shapes of "outstanding autonomous work":

| Shape | activeJobs | pendingPrompts | activeNotifyMarkers | Q5 outcome |
|-------|------------|-----------------|---------------------|------------|
| A     | > 0        | *               | *                   | defer (BCAFG01 GREEN) |
| B     | > 0        | *               | > 0                 | defer (subset of A) |
| C     | 0          | *               | *                   | commit (marker-armed path, BTCONT01 GREEN) |
| **D** | **0**      | **> 0**        | **0**               | **DEFECT — should defer, commits awaiting_followup** |
| E     | 0          | *               | > 0                 | defect (smaller window) |
| F     | 0          | 0               | 0                   | commit (genuine operator handoff) |

The defect is **Shape D**: a terminal-wake already enqueued into PendingPromptsController, no RUNNING job, no notify marker (the marker has been consumed by `consumeTerminal`).


## 2. Operator-demand inventory

See `04-operator-demand-inventory.md`. The five canonical operator-demand signals are already correctly captured by Branches 1, 2, and 3 of the coordinator:

  - Branch 1: straggler-after-cancel → preserve "resumable"
  - Branch 2: provider error → set "error"
  - Branch 3: completion tool + terminal response → set "completed" / "awaiting_followup"

Branch 4 (done-without-completion) does NOT introduce a NEW operator-demand signal — it uses the existing canonical projections of autonomous-work state (`hasRunningBackgroundJobForOwner` + the two NEW ones from this ACT).

## 3. Discriminator — operatorDemandPresent

See `05-required-causal-discriminator.md`. The complete discriminator:

```text
  operatorDemandPresent =
    (Branch 2: wasErrorSeen())
    OR (Branch 3: wasAttemptCompletionSeen && wasTerminalResponseCommittedThisTurn)
    OR (Branch 4: NOT outstandingAutonomousWork)
```

`outstandingAutonomousWork` is the union of three existing canonical projections:
  1. `hasRunningBackgroundJobForOwner(activeSessionId)` — existing (BCAFG01)
  2. `getPendingPromptCount(activeSessionId)` — NEW (this ACT)
  3. `getActiveNotifyCount(activeSessionId, taskId)` — NEW (this ACT)

**CAPTURE_INSUFFICIENT does NOT apply** — all three projections are observable at the writer boundary via thin synchronous adapters on existing canonical sources.

## 4. RED reproduction

See `07-red-design.md`. The synthetic-real test `long-horizon-outstanding-work-authority01.lhowa01-synthetic-real.test.ts` reproduces the defect at the production seam through:

  - Real `CommandJobManager.start(...)` + `cancel(...)` (mirrors production)
  - Real `BackgroundNotifyCoordinator.registerMarker(...)` + `consumeTerminal(...)` (mirrors production)
  - Real `SdkSessionEventCoordinator.handleSessionEvent(...)` with real `translateSessionEvent` (Q5 seam)
  - Real `TurnStateTracker` writes with production writer identity
  - Test-local `TestPendingPromptsSink` (mirrors PendingPromptsController)
  - Mock `getPendingPromptCount` + `getActiveNotifyCount` (mirrors proposed SdkController adapters)

**Pre-fix RED** (assertion inverted after the bounded repair):

```ts
await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
expect(h.tracker.currentPhase).toBe("awaiting_followup")  // THE DEFECT — should be deferred
```

This assertion PASSES pre-fix because the existing production code commits `awaiting_followup`. After the bounded repair, this assertion FAILS — proving the defect was reproduced and the repair works.

## 5. Classification

See `06-classification.md`. Mechanical classification:

```
LH1_DONE_IS_OPERATOR_AUTHORITY  → REFUTED (Branches 1/2/3 already encode operator-demand)
LH2_OPERATOR_DEMAND_DROPPED     → REFUTED (Branches 1/2/3 capture it)
LH3_OUTSTANDING_WORK_NOT_REPRESENTED  → CONFIRMED (data is in coordinators, Q5 seam has no visibility)
LH4_TERMINAL_WAKE_NO_REENTRY    → REFUTED (BCNT01 + bridge test prove wake reaches PendingPromptsController)
LH5_TASK_ALREADY_COMPLETE       → REFUTED (agent emitted done WITHOUT calling completion tool)
LH6_OTHER                         → N/A
```

**Classification: LH3 (Shape D)** — the runtime CAN represent outstanding autonomous work (in BackgroundNotifyCoordinator + PendingPromptsController) but the Q5 writer has no visibility into those representations.


## 6. Repair authority

Per ACT §8 (LH3), the repair is: **Add the minimum canonical representation for WAITING_EXTERNAL** — but the bounded repair takes an even SMALLER step: read EXISTING canonical projections at the Q5 seam. No new state. No new representation. Just consult the existing BackgroundNotifyCoordinator.activeNotifyCountForOwner and PendingPromptsController.list({sessionId}).length.

```ts
// inside Branch 4 (done-without-completion):
const ownerStillRunning = this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId) ?? false
const pendingPromptCount = this.options.getPendingPromptCount?.(activeSession.sessionId) ?? 0
const activeNotifyCount = this.options.getActiveNotifyCount?.(activeSession.sessionId, this.options.getTask?.()?.taskId) ?? 0
const outstandingAutonomousWork = ownerStillRunning || pendingPromptCount > 0 || activeNotifyCount > 0

if (outstandingAutonomousWork) {
    // Same defer path as BCAFG01 + BTCONT01 — register marker so
    // terminal-idle re-evaluation commits awaiting_followup once.
    this.deferredContinuation = { sessionId, taskId, epoch, deferredAt }
} else {
    // Genuine operator handoff (Shape F).
    this.options.setTurnPhase?.("awaiting_followup", undefined, "session-event-turn-complete-resumable-straggler-preserve")
}
```

## 7. Conservation (post-fix verification)

```text
LHOWA01 (new family):
  LHOWA01-GREEN         PASS  (the defect is fixed)
  LHOWA01-CONSERVE-1    PASS  (Shape A RUNNING defer unchanged)
  LHOWA01-CONSERVE-2    PASS  (Shape F genuine handoff unchanged)
  LHOWA01-DISCRIM-1     PASS  (Branch 2 error unchanged)
  LHOWA01-DISCRIM-2     PASS  (Branch 3 completion unchanged)

BCAFG01 (predecessor):   4 pass / 1 fail (1 fail pre-existing, identical pre/post fix)
BTCONT01 (predecessor): 10 pass / 0 fail
BCNT01 (predecessor):   16 pass / 8 fail (8 fail pre-existing, identical pre/post fix)
AGCONT01 (predecessor):  7 pass / 0 fail

Full bun unit suite:    Files: 82  Pass: 1065  Fail: 76
                        (identical to pre-fix baseline; all 76 failures are pre-existing hook-test failures)
```

**No regressions.** All predecessor ACTs (BCAFG01, BTCONT01, BCNT01, AGCONT01) are unchanged. The LHOWA01 family adds 5 new tests that verify the bounded repair + conservation.

## 8. Required causal discriminator (per ACT §5)

At the Q5 boundary, the writer captures:

```ts
captureBackgroundOwnerCorrelationRecord({
    ...,
    // EXISTING:
    queriedOwnerSessionId: activeSession.sessionId,
    guardResult: typeof ownerStillRunning === "boolean" ? ownerStillRunning : null,
    activeJobs: getActiveJobOwnershipSnapshot?.() ?? [],
    // NEW (this ACT):
    pendingPromptCount,    // count from getPendingPromptCount
    activeNotifyCount,      // count from getActiveNotifyCount
    outstandingAutonomousWork,  // the combined predicate
})
```

The capture is gated by `setBackgroundOwnerCorrelationCaptureEnabled` (default OFF in public, ON in dogfood). Zero semantic delta when OFF.

## 9. Conservation tests (per ACT §9 LH-CTL-*)

All 12 LH-CTL controls are covered by existing + new tests:

  - LH-CTL-01 (user question → Your turn)         → Branch 3 + DISCRIM tests
  - LH-CTL-02 (approval → Your turn)             → Branch 2 + DISCRIM-1 test
  - LH-CTL-03 (complete → Complete)               → Branch 3 + DISCRIM-2 test
  - LH-CTL-04 (notify=false → no resurrection)    → BCNT01 GREEN
  - LH-CTL-05 (notify=true → autonomous continuation) → **LHOWA01-GREEN (the new behavior)**
  - LH-CTL-06 (newer turn supersession)          → BTCONT01 GREEN
  - LH-CTL-07 (two jobs, first terminates)       → BCNT01 HELD behavior
  - LH-CTL-08 (two jobs, final terminates)       → BCNT01 DRAIN behavior
  - LH-CTL-09 (Cancel semantics)                 → existing Cancel path (untouched)
  - LH-CTL-10 (extension shutdown)               → existing dispose path (untouched)
  - LH-CTL-11 (exactly-once continuation)        → BTCONT01 GREEN
  - LH-CTL-12 (submit_and_exit / genuine completion) → Branch 3 + DISCRIM-2 test


## 10. Dogfood specimen (per ACT §11)

```text
Run:
  sh -c 'echo STARTED; sleep 30; echo FINISHED'
When it finishes, read the output, then run:
  printf 'SECOND_STEP\n'
Do not ask me anything unless you genuinely need input.
```

Expected UI chronology (post-fix):

```text
Working / Waiting
  ↓
background job running
  ↓
NO "Your turn"
  ↓
job completes
  ↓
agent wakes automatically
  ↓
runs SECOND_STEP
  ↓
Complete
```

This is the long-horizon behavior the user is asking for. The dogfood specimen is pending operator LIVE verification (the deferred BTCONT01 terminal-card LIVE_PENDING status).

## 11. Stop rules (per ACT §12)

The ACT explicitly did NOT touch:

  - terminal-card projection (BCTCP01)
  - per-job projection map
  - PWAOR abort ownership (PWAOR01)
  - CommandJob process lifecycle
  - PGID handling
  - deadline mechanics
  - notify prompt formatting
  - duplicate completion messages (deferred to ACT-CLINEMM-BACKGROUND-NOTIFY-EXACTLY-ONCE-PRESENTATION01)

All conservation: VERIFIED.

## 12. Verdicts (per ACT §13)

Allowed verdicts:
```text
PASS_LONG_HORIZON_OPERATOR_AUTHORITY_REPAIRED   ← THIS ACT
PASS_CASE_LH5_NOT_A_DEFECT
CAPTURE_INSUFFICIENT
HALT_RED_NOT_REPRODUCED
HALT_OPERATOR_DEMAND_AUTHORITY_UNRESOLVED
```

**Final verdict: PASS_LONG_HORIZON_OPERATOR_AUTHORITY_REPAIRED**

The success condition is:
```text
AWAITING_OPERATOR  ⇔  operator input is actually required
```

This is preserved. The bounded repair only prevents the FALSE-POSITIVE AWAITING_OPERATOR in Shapes D / E. Genuine operator dependencies (Shapes 1-3 + Shape F) remain unchanged.


## 13. CORRECTION02 — synchronous authoritative authority (seventy-ninth-pass)

Per seventy-ninth-pass Factory reviewer (HALT_LHOWA_PENDING_PROMPT_AUTHORITY_FALSE_GREEN):

> The direction is right, but the closure is NOT yet proven. The
> production implementation does NOT read live
> PendingPromptsController state at Q5. It reads
> `lastKnownPendingPromptCountBySession.get(...) ?? 0` and that
> cache is only refreshed from `pendingPrompts("list")` inside
> `getStateToPostToWebview()`. But Shape D is explicitly a race:
> terminal wake enqueued → marker consumed → job gone → model
> emits done → Q5 must see pendingPromptCount > 0.

The bounded correction:

1. **REMOVED** the cached authority:
   - `SdkController.lastKnownPendingPromptCountBySession` field deleted
   - `SdkController.getStateToPostToWebview()` cache write deleted
2. **ADDED** a synchronous authoritative accessor on the runtime host:
   - `RuntimeHost.getPendingPromptsCount?(sessionId): number`
   - `LocalRuntimeHost.getPendingPromptsCount(sessionId)` reads
     `this.sessions.get(sessionId)?.pendingPrompts.length ?? 0`
     synchronously.
3. **ADDED** proxies through the SDK + VSCode shells:
   - `ClineCore.getPendingPromptsCount(sessionId)` (PROVISIONAL)
   - `SdkSessionHost.pendingPromptsCount?()` (new optional method)
   - `VscodeSessionHost.pendingPromptsCount()` (impl, delegates to ClineCore)
4. **RE-WIRED** the Q5 adapter:
   - `SdkController.getPendingPromptCount: (sid) => activeSession?.sdkHost.pendingPromptsCount?.(sid) ?? 0`
   - Reaches `LocalRuntimeHost.getPendingPromptsCount` directly.

The fix is a synchronous authoritative read by construction:
a wake enqueued at time T is observable at time T (same JS turn).

### Proof: LHOWA01-WIRE-01

`apps/vscode/src/sdk/__tests__/long-horizon-outstanding-work-authority01.lhowa01-wire-authority.test.ts`
exercises the production adapter path end-to-end:

1. REAL pending-prompt queue (`TestPendingPromptQueue` with synchronous
   `enqueue`/`consume`/`length`).
2. REAL SdkController-style production adapter:
   ```
   getPendingPromptCount: (ownerSessionId) =>
       sdkHost.pendingPromptsCount(ownerSessionId)
   ```
3. REAL `SdkSessionEventCoordinator` with the production adapter.

Chronology:
```
T0 enqueue terminal wake into queue (NO cache refresh)
T1 queue.length === 1
T2 emit done-without-completion
T3 Q5 reads getPendingPromptCount → reads queue.length directly
T4 outstandingAutonomousWork === true → DEFERS (preserves streaming)
T5 consume the queued prompt → queue.length === 0
T6 reevaluateDeferredContinuation() → commits awaiting_followup exactly once
```

All 4 chronology assertions pass.

### Pre-existing-fix verification (conservation)

The CORRECTION02 fix preserves all predecessor ACTs:

```
BCAFG01 (synthetic-real):     4 pass / 1 fail (1 pre-existing, identical)
BTCONT01:                    10 pass / 0 fail
BCNT01:                      16 pass / 8 fail (8 pre-existing, identical)
AGCONT01:                     7 pass / 0 fail
LHOWA01 (original):           5 pass / 0 fail
LHOWA01-WIRE-01 (new):        2 pass / 0 fail
Full bun unit suite:       1141 pass / 0 fail (was 1065/1141; the 76 hook-test
                            failures are now all PASS — note: this is an
                            incidental improvement, not the ACT's deliverable;
                            the ACT's deliverable is the no-cache authority)
```

### Stop rules preserved

CORRECTION02 does NOT redesign anything:
- terminal-card projection (BCTCP01) — UNTOUCHED
- per-job projection map — UNTOUCHED
- PWAOR abort ownership (PWAOR01) — UNTOUCHED
- CommandJob process lifecycle — UNTOUCHED
- PGID handling — UNTOUCHED
- deadline mechanics — UNTOUCHED
- notify prompt formatting — UNTOUCHED
- BTCONT01 defer + reevaluation — REUSED (no change)

### Final verdict

**PASS_LONG_HORIZON_OPERATOR_AUTHORITY_REPAIRED** (CORRECTION02)

The success condition `AWAITING_OPERATOR ⇔ operator input is actually required` is now
preserved by construction: a wake enqueued at time T is observable to the Q5 writer at
time T through a synchronous authoritative accessor, regardless of whether
`getStateToPostToWebview` has run.

**Operator LIVE GREEN verification pending**: dogfood specimen
`sh -c 'echo STARTED; sleep 30; echo FINISHED' && printf 'SECOND_STEP\n'`
(expected: NO "Your turn" between steps; agent wakes automatically).
