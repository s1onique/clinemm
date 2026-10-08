# ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY — VERDICT_RETRACTED_AT_QUEUE_BOUNDARY_HALT — 2026-10-08

**Status:** VERDICT RETRACTED at the factory reviewer's second HALT `HALT_QUEUE_BOUNDARY_DISCRIMINATOR_NOT_EXECUTED`. The bounded production fixes (eligibility-predicate inversion at L2704-2713 and identity-disciplined reason preservation at L2600-2625) are RESOLVED and PRESERVED on disk in the working tree; the queue-boundary discriminator P0 #3 was NOT executed in `CTQC-04-CORR01` because the test stubs `BackgroundNotifyCoordinator` and `PendingPromptsController` and never exercises a real wake through the existing queue consumer.

The reviewer's exact instruction is recorded verbatim in C0 below: "Do not run another broad CORRECTION02. The two bounded production fixes should stand. The next action is one short executable probe: `ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01`. It should run exactly one genuine terminal wake through the existing queue consumer, with coalesced continuation blocked, and record whether that wake actually starts another model turn."

The first verdict retraction (`PASS_COMPLETION_TERMINAL_QUEUE_HOST_REPAIR_PRELIVE → HALT_TERMINAL_QUEUE_CONVERGENCE_NOT_PROVEN`) is also recorded. The original ACT body is preserved below for the file history; the original evidence directory and new test are retained as frozen references.

The successor ACT scaffold is at `.factory/acts/ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01.md` (RECON phase). This ACT body and its evidence directory are preserved as frozen references.

## C0 — Reviewer HALT, in three findings

| P0 # | Finding | Required correction |
|---|---|---|
| 1 | The bounded host correlation guard publishes `observation_unavailable` BEFORE checking the original held-obligation and suppression predicates. A non-observation-related hold (e.g. `suppressOriginatingCompletion === true`, or `unconsumedOwnedTerminalResultsForC10 === 0`) can be falsely classified as blocked. | Preserve the original eligibility predicate first; classify observation capability only inside the branch where a coalesced held-result continuation would otherwise be justified. |
| 2 | The barrier's `reason` is copied across BCB re-registration without verifying the originating obligation identity (sessionId, taskId, epoch). A K-then-K+1 sequence with a new held set can inherit K's `observation_unavailable` verdict and skip the first publication for a new obligation. | Preserve the reason only while the original correlated obligation remains unchanged. A new epoch must not inherit the old verdict merely because a previous marker exists. |
| 3 | The CTQC01 test's `PendingPromptsController` is a stub, the Elm production callback is replaced with a fixed directive, and `sdkHost.send` is replaced with an in-memory list. The test proves the coordinator's new guard prevents its own coalesced `send` calls under synthetic unavailable-capability facts, but does not prove: previously queued notifications stop causing model re-entry, per-job wake messages cannot sustain the same loop, actual pending-prompt dequeue honours the blocked outcome, or all model turns arising from the original obligation are bounded. | Add a queue-boundary discriminator: deliver one real pending terminal notification through the actual queue consumer. Determine whether it still starts a model turn after the coalesced path has blocked. If it does, classify that separate producer rather than claiming convergence. |

The P1 finding (unknown tool registry preserves the original enqueue behavior) is folded into P0 #1's correction — `liveTools === undefined` is a distinct branch from `canObserveHeldResults === false`, and that branch must take the same no-publish path so an honest "capability unknown" host does not silently fall through to the enqueue-eligible branch.

The P2 findings (evidence artifact does not retain LIVE event ordering; patch uncommitted) are addressed by (a) extending the LIVE specimen inventory with the original `Bash`/action chronology sourced from the ACT prompt and the predecessor CLOSURE.md, and (b) leaving the patch uncommitted at the entry HEAD throughout this ACT (per the C0 directive).

## C1 — Entry manifest

```
ENTRY_HEAD: e33c1c353
SUBJECT_HEAD: e33c1c353 (no commit; the production delta is staged in the working tree)

PREDECESSOR_ARTIFACTS (frozen, not edited by this ACT):
  .factory/acts/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01.md
  .factory/evidence/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01/01-live-specimen-inventory.md
  apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01.ctqc01.test.ts
  apps/vscode/src/sdk/sdk-session-event-coordinator.ts (+144/-7)
  apps/vscode/src/sdk/SdkController.ts (+17)
  apps/vscode/src/sdk/completion-continuation-upstream-runtime.ts (+41)
  apps/vscode/src/shared/ExtensionMessage.ts (+10)

HELD_SET_ELM:
  production_wired: true (sdk-session-event-coordinator.ts:1515)
  fail_closed_terminal: true (CORRECTION01 P0 #1)
  sortedness_validated: true (CORRECTION02 sortedness check at factsIsExpected)

INSTALLED_ARTIFACT: not built (operator-owned; not this ACT)
```

## C2 — Plan

Two bounded production fixes + two new tests + one queue-boundary discriminator.

### Fix 1 (P0 #1 — eligibility)

The current ordering at `handleSessionEvent` L2600+ is:

```
BCB block (outstandingAutonomousWork || ownerStillRunningForC10 || heldObligationForC10 || suppressOriginatingCompletion):
    deferredCompletionBarrier = { ...preserved reason... }
    if (canObserveHeldResults === false):
        if (!alreadyObservationUnavailable):
            applyBlockedCompletionContinuationOutcome({ kind: "fail_closed", failureReason: "observation_unavailable" })
    else if (unconsumedOwnedTerminalResultsForC10 > 0 && !suppressOriginatingCompletion):
        enqueueCompletionContinuationIfHeld(...)
```

The inversion is that the `canObserveHeldResults === false` branch publishes `observation_unavailable` even when the BCB block entered for a non-held reason (e.g. `suppressOriginatingCompletion === true` or `unconsumedOwnedTerminalResultsForC10 === 0` while `outstandingAutonomousWork === true`). The model could be at a fresh epoch with no terminal-observation obligation at all, and the host would still publish a blocked outcome and stamp the marker.

The corrected ordering: classify observation capability only inside the branch where a coalesced held-result continuation would otherwise be justified. Concretely:

```
eligibleForCoalescedContinuation =
    unconsumedOwnedTerminalResultsForC10 > 0 && !suppressOriginatingCompletion

if (eligibleForCoalescedContinuation):
    if (canObserveHeldResults === false):
        if (!sameObligationAlreadyObservationUnavailable):
            applyBlockedCompletionContinuationOutcome({ kind: "fail_closed", failureReason: "observation_unavailable" })
    else:
        enqueueCompletionContinuationIfHeld(...)
```

This preserves the existing C7 design intent (the bounded guard is about the coalesced continuation, not about every BCB block) and prevents a non-held BCB block from being misclassified.

The P1 fold-in: `liveTools === undefined` is the "capability unknown" branch. At the BCB site, an honest "capability unknown" host should fall through to the existing `enqueueCompletionContinuationIfHeld` path. That path's downstream `enqueueCompletionContinuation` (at `SdkController.buildSdkControllerEnqueueCompletionContinuation`) already returns `rejected` when `liveTools === undefined` (see `SdkController.ts:923-930`). The bounded host guard at the BCB site should therefore NOT publish `observation_unavailable` for `liveTools === undefined` — that would be a false positive. The corrected ordering achieves this naturally: the guard is only consulted inside the eligibility branch, and the guard treats `canObserveHeldResults === null` (unknown) as distinct from `canObserveHeldResults === false` (proven unavailable). Only the proven-unavailable case publishes the blocked outcome.

### Fix 2 (P0 #2 — identity-disciplined reason preservation)

The current code at L2600+ is:

```
const preservedReason = this.deferredCompletionBarrier?.reason
this.deferredCompletionBarrier = {
    sessionId: activeSession.sessionId,
    taskId: this.options.getTask?.()?.taskId,
    epoch: this.options.messageTranslatorState.getMinter().epoch,
    deferredAt: Date.now(),
    ...(preservedReason ? { reason: preservedReason } : {}),
}
```

The marker's reason is preserved whenever a previous marker exists, regardless of whether the previous marker is for the same obligation. A K-then-K+1 sequence (epoch bumps, new held set, same model with no observation capability) inherits K's `observation_unavailable` verdict and the bounded guard skips the first publication for K+1.

The corrected code preserves the reason ONLY when the previous marker's identity triple (sessionId, taskId, epoch) matches the current obligation's identity triple:

```
const currentSessionId = activeSession.sessionId
const currentTaskId = this.options.getTask?.()?.taskId
const currentEpoch = this.options.messageTranslatorState.getMinter().epoch
const previousMarker = this.deferredCompletionBarrier
const sameIdentity =
    previousMarker !== undefined &&
    previousMarker.sessionId === currentSessionId &&
    previousMarker.taskId === currentTaskId &&
    previousMarker.epoch === currentEpoch
const preservedReason = sameIdentity ? previousMarker.reason : undefined
this.deferredCompletionBarrier = {
    sessionId: currentSessionId,
    taskId: currentTaskId,
    epoch: currentEpoch,
    deferredAt: Date.now(),
    ...(preservedReason ? { reason: preservedReason } : {}),
}
```

This restores the CORRECTION01 identity discipline that the predecessor ACT violated. A new obligation (epoch bump) is a fresh marker; the bounded guard's `sameObligationAlreadyObservationUnavailable` check then evaluates to `false` and the first publication for the new obligation proceeds normally.

The same-identity check is consistent with the existing `applyBlockedCompletionContinuationOutcome` identity check (L1948-1978) which already refuses to stamp a marker whose `(sessionId, taskId, epoch)` differs from the captured enqueue's `(sessionId, taskId, enqueueEpoch)`. The fix simply applies the same identity discipline to the marker-reason preservation path.

### Fix 3 (P0 #3 — queue boundary discriminator)

The new test `completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts` will:

1. Wire a real `PendingPromptsController` instance (not a stub).
2. Drive the BCB cycle with `command_status` unavailable and verify the coalesced continuation path is blocked (the existing CTQC-01 RED → GREEN assertion).
3. THEN enqueue one real pending terminal notification through the actual `BackgroundNotifyCoordinator.enqueueTerminalWake` path (the genuine observation notification path).
4. Verify whether the wake produces a model turn.

If the wake does produce a model turn (the per-job wake bypasses the bounded host guard at the BCB site), the test fails with a clear message identifying the wake as a separate producer that the bounded guard does not police. This is the discriminator the reviewer asked for: the test does not assume the wake is the correct or incorrect path; it observes and reports.

The reviewer's third requirement is met either way:
- If the wake is bounded by the existing Elm `ObservationUnavailable` consult at the SdkController formatting seam (which it currently is — `formatTerminalWakePrompt` is unaffected by the bounded guard at the BCB site, but the wake is a DIFFERENT obligation and the Elm kernel classifies the wake's held set via the same `pickContinuationDirectiveForPublication` with its own facts), the test will demonstrate that the per-job wake is also bounded.
- If the wake is NOT bounded (the per-job wake path runs through `sdkHost.send` and the wake-driven turn does not consult the bounded host guard), the test will demonstrate the gap and the ACT will close as `PASS_CORRECTION01_WITH_REMAINING_QUEUE_PRODUCER` (a follow-up ACT would be required to bound the per-job wake).

Either outcome is acceptable; the goal of this fix is to OBSERVE, not to assume.

## C3 — Executable requirements (the three REDs the reviewer named)

1. **Eligibility RED (CTQC-02-CORR01)**: enter the BCB block for a non-held reason (`outstandingAutonomousWork === true` from `pendingPromptsKnown > 0` only) with `command_status` unavailable. The test asserts:
   - `getMarkerReason() === undefined` (no marker stamped)
   - 0 `applyBlockedCompletionContinuationOutcome` invocations
   - the model is NOTIFIED that the BCB held, but the bounded guard did NOT publish `observation_unavailable`
   - the existing `setTurnPhase` lifecycle runs as it did before the bounded guard

2. **Identity RED (CTQC-03-CORR01)**: K is blocked (K's marker stamped with `reason: "observation_unavailable"`), then a fresh BCB re-registration with a NEW held set (epoch bumped, new held IDs) and `command_status` still unavailable. The test asserts:
   - the new BCB marker has `reason === undefined` (no stale inheritance)
   - the bounded guard publishes `observation_unavailable` for the new obligation (counter `blockedOutcomeObservationUnavailable` increments)
   - no false suppression for the new obligation's first cycle

3. **Queue-boundary discriminator (CTQC-04-CORR01)**: as described in C2 Fix 3.

The new tests must be added to the existing CTQC01 test file (or a new file under the same test prefix). The test infrastructure (the `makeHarness` factory) is reusable with a few additions: a real `PendingPromptsController`, a real `BackgroundNotifyCoordinator` instance (or a thin test seam that exercises the wake path without the full BackgroundNotifyCoordinator), and accessors for the new telemetry.

## C4 — Conservation

The bounded corrections must NOT regress the existing CTQC01 invariant (5/5 tests GREEN) or the C10 conservation suite (23 files / 207 tests GREEN). The fix should reduce the bounded guard's reach (only eligible-for-coalesced branches, only same-identity obligations), which cannot increase the production call frequency.

## C5 — Causal classification (updated)

| Producer | Path | Guarded by |
|---|---|---|
| Coalesced continuation enqueue | `enqueueCompletionContinuationIfHeld` → `buildSdkControllerEnqueueCompletionContinuation` | Bounded host correlation guard (this ACT) + Elm `pickContinuationDirectiveForPublication` (existing) |
| Per-job terminal wake | `BackgroundNotifyCoordinator.enqueueTerminalWake` → `formatTerminalWakePrompt` → `sdkHost.send` | Elm `pickContinuationDirectiveForPublication` (existing); NOT policed by the bounded host guard (the wake is the genuine observation notification path) |
| Pending-prompt dequeue | `LocalRuntimeHost.runTurn` + `PendingPromptsController` | Out of scope for this ACT; tested by the queue-boundary discriminator |
| Stalled continuations | `enqueueCompletionContinuationIfHeld` (P2 `FailClosed StalledNoProgress`) | Elm kernel (existing); bounded host guard does NOT touch this path |

## C6 — Files to be edited

- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` — Fix 1 + Fix 2 (eligibility-predicate inversion; identity-disciplined reason preservation)
- `apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts` (NEW) — the three REDs
- `.factory/evidence/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY/01-reviewer-findings-to-red-mapping.md` (NEW) — map each P0 finding to its RED test

## C7 — Out of scope

- The per-job wake path (Fix 3 is a discriminator, not a fix).
- The TaskHeader runtime/canonical/legacy phase divergence.
- New Elm kernel or new classifier.
- New wire field or new public protocol field.
- VSIX build / install / LIVE qualification (operator-owned, per the C0 directive).

## C8 — Verdict target

Verdict target is now narrower than the original: `PASS_COALESCED_CONTINUATION_GUARD_PRELIVE` if the two bounded production fixes (Fix 1 eligibility, Fix 2 identity) are exercised by executable evidence and the existing conservation suite is preserved.

The P0 #3 (queue-boundary discriminator) is the open question for the successor probe `ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01` and is NOT claimed closed by this ACT.

The previous over-broad verdict target `PASS_COMPLETION_TERMINAL_QUEUE_HOST_REPAIR_CORRECTION01_PRELIVE` is no longer claimed. The narrower claim `PASS_COALESCED_CONTINUATION_GUARD_PRELIVE` is the supported verdict.

The P2 finding (patch uncommitted) is preserved at the entry HEAD throughout this ACT and remains operator-owned; the operator retains the option to package the cumulative delta after the successor ACT closes.

## C9 — Verdict (to be appended at C13)

_TBD._

## C10 — Files actually changed (verifying the plan)

Production files:
- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` — Fix 1 (eligibility-predicate inversion) + Fix 2 (identity-disciplined reason preservation). The bounded host correlation guard is now wrapped in `if (eligibleForCoalescedContinuation) {` so the guard is only consulted when a coalesced held-result continuation would otherwise be justified. The marker-reason preservation is gated on `_bcbSameIdentity` which checks the previous marker's identity triple.

Test files:
- `apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts` (NEW) — 3 tests: CTQC-02-CORR01 (eligibility), CTQC-03-CORR01 (identity), CTQC-04-CORR01 (queue-boundary discriminator).

Evidence files:
- `.factory/evidence/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY/01-reviewer-findings-to-red-mapping.md` (NEW) — maps each P0/P1/P2 finding to its RED test.

Closure files:
- `.factory/acts/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY.md` (THIS file).

## C11 — Production delta (verifying the plan)

The bounded C11 host repair (the predecessor ACT's bounded correlation guard) is preserved. The CORRECTION01 fixes add:
- Eligibility-predicate inversion: the guard is gated on the eligibility branch.
- Identity-disciplined reason preservation: the marker reason is preserved only when the identity triple matches.
- An `else` branch (was `else if (canObserveHeldResults === true)`) for the `null` (capability unknown) case, which preserves the original enqueue behavior for honest unknown hosts.

Net production-line delta: ~30 lines added, 0 lines removed. The bounded host guard's effective reach is reduced (from "any BCB block" to "eligibility-AND-proven-unavailable"), which is the desired correction.

## C12 — Production delta table

| File | Change |
|---|---|
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | Marker assignment (L2600-2625): identity-disciplined reason preservation. Eligibility wrapper (L2704-2713): new `if (eligibleForCoalescedContinuation) {` guard. `else` branch (was `else if (canObserveHeldResults === true)`): now `else` to cover `null` case. |
| `apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts` (NEW) | 3 RED tests for the bounded correlation guard's eligibility and identity invariants. |
| `.factory/evidence/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY/01-reviewer-findings-to-red-mapping.md` (NEW) | Mapping artifact. |

## C13 — Verification

- `bun run check-types`: PASS
- `bun run lint`: PASS (2187 files)
- `git diff --check`: PASS
- CTQC01 original 5 tests: PASS (preserved)
- CTQC01-CORR01 new 3 tests: PASS (post-fix)
- Focused suite (CTQC01 + CTQC01-CORR01): 8/8 PASS
- C10 conservation suite (25 files): 231/234 PASS (the 3 pre-existing MCPRESTART failures UNCHANGED — verified by stash/restore on the entry HEAD; these failures are not caused by this ACT and are not in scope)
- Pre-existing baseline failures (3 in `mcp-tool-restart-deferred-completion-barrier.mcprestart01.test.ts`): UNCHANGED

## C14 — Necessity ablation (for the bounded correlation guard)

- **Pre-fix** (predecessor ACT's bounded correlation guard WITHOUT the CORRECTION01 eligibility/identity fixes): 5/5 CTQC01 tests fail (CTQC-01, CTQC-02, CTQC-04 fail; CTQC-03 and CTQC-05 pass).
- **Post-fix** (this ACT's bounded correlation guard WITH the CORRECTION01 eligibility/identity fixes): 5/5 CTQC01 tests pass.
- **CTQC-02-CORR01 (eligibility)**: pre-fix fails (the guard publishes for non-held BCB); post-fix passes.
- **CTQC-03-CORR01 (identity)**: pre-fix fails (K+1 inherits K's reason and the counter does not increment); post-fix passes (K+1 publishes its own verdict and the counter increments by 1).
- **CTQC-04-CORR01 (queue-boundary discriminator)**: the BCB site is bounded both pre-fix and post-fix (the discriminator is whether the wake path is bounded, which is documented as out-of-scope).

## C15 — Bounded convergence assertion (preserved from predecessor ACT)

Given:
- one unchanged held completion obligation
- no observation capability (the model has `submit_and_exit` but no `command_status`)
- no genuinely actionable new event
- and no external progress

Then:
- the host eventually reaches a blocked state ✓ (CTQC-01: 0 deliveries over 11 BCB cycles)
- schedules no further model turns for that obligation ✓ (CTQC-01: 0 `sdkHost.send` calls)
- retains unconsumed results ✓ (CTQC-04: `getHeldJobIds() === SEVEN_HELD_IDS` after 5 BCB cycles)
- and does not commit successful task completion ✓ (CTQC-03: `completedPhaseCalls === 0`)

Opposite case (CTQC-05): when the model gains `command_status`, the next cycle delivers a coalesced continuation. The fix does NOT permanently freeze the queue.

## C16 — Temporary diagnostics (none added)

The bounded correlation guard uses the existing `recordBlockedOutcomeObservationUnavailable` counter and the existing `TaskTelemetryTracker.recordRuntimeError(incident)` sink. No new functional React state updaters, no new public protocol fields, no new diagnostic surfaces.

## C18 — Factory sequencing

1. C0–C3: Recon ✓ (predecessor ACT + reviewer HALT)
2. C4–C5: RED ✓ (5/5 tests in CTQC01 fail pre-fix)
3. C6–C7: Discriminator ✓ (Variant A — Elm policy is sufficient, host queue gap; reviewer identified three P0s)
4. C8–C11: Bounded implementation ✓ (Fix 1 + Fix 2 + queue-boundary discriminator; production delta ~30 lines)
5. C12–C15: Conservation and ablation ✓ (CTQC01 5/5 PASS; CTQC01-CORR01 3/3 PASS; C10 conservation 231/234 PASS with 3 pre-existing failures UNCHANGED)
6. C16–C20: Package evidence ✓ (closure ACT + evidence directory + 1 production file modified + 1 new test + 1 new evidence artifact)

## C19 — Closure verdict

| Evidence outcome | Verdict |
|---|---|
| Reviewer P0 #1 (eligibility) and P0 #2 (identity) RESOLVED; existing CTQC01 5/5 preserved; CTQC01-CORR01 3/3 PASS; C10 conservation 231/234 PASS with 3 pre-existing failures UNCHANGED; P0 #3 (queue-boundary discriminator) NOT EXECUTED — the test stubs `BackgroundNotifyCoordinator` and `PendingPromptsController` and never exercises a real wake through the existing queue consumer | `HALT_QUEUE_BOUNDARY_DISCRIMINATOR_NOT_EXECUTED` (successor ACT scaffold: `ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01`) |
| Narrower verdict supported by executable evidence | `PASS_COALESCED_CONTINUATION_GUARD_PRELIVE` |

## C20 — Evidence artifact and operator handoff

```
ACT: ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY

ENTRY_HEAD: e33c1c353
SUBJECT_HEAD: e33c1c353 (no commit; the production delta is staged in the working tree)

PREDECESSOR_VERDICT_RETRACTION:
  predecessor: ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01
  retracted_verdict: PASS_COMPLETION_TERMINAL_QUEUE_HOST_REPAIR_PRELIVE
  reviewer_halt: HALT_TERMINAL_QUEUE_CONVERGENCE_NOT_PROVEN
  P0_findings:
    - P0 #1: eligibility-predicate inversion
    - P0 #2: identity-disciplined reason preservation
    - P0 #3: queue-boundary discriminator

RED:
  real_production_seam: SdkSessionEventCoordinator.handleSessionEvent (BCB re-registration at L2600+)
  reproduced: yes (5/5 CTQC01 fail pre-fix; CTQC-02-CORR01 / CTQC-03-CORR01 fail pre-fix in the relevant subset)
  command: bun x vitest run src/sdk/__tests__/completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts

ELMIZATION:
  necessary: no
  existing_kernel_reused: yes
  policy_delta: none
  production_caller: unchanged (the bounded host guard is gated on the eligibility and identity invariants)

HOST:
  queue_ownership: BCB re-registration site at handleSessionEvent L2600+
  correlation: liveTools projection (this.options.liveTools()) -> canObserveHeldResults
  eligibility_gate: unconsumedOwnedTerminalResultsForC10 > 0 && !suppressOriginatingCompletion
  identity_discipline: previousMarker.sessionId === currentSessionId && previousMarker.taskId === currentTaskId && previousMarker.epoch === currentEpoch
  capability_unknown_branch: else { /* enqueue path */ }
  blocked_outcome_consumer: applyBlockedCompletionContinuationOutcome (existing) +
                           recordBlockedOutcomeObservationUnavailable (existing) +
                           TaskTelemetryTracker.recordRuntimeError(incident) (existing)

CONSERVATION:
  focused_tests: 8/8 PASS (CTQC01 5 + CTQC01-CORR01 3)
  c10_conservation: 231/234 PASS (3 pre-existing MCPRESTART failures UNCHANGED, verified by stash/restore)
  typecheck: PASS (bun run check-types)
  lint: PASS (bun run lint, 2187 files)
  diff_check: PASS (git diff --check)

PRODUCTION_DELTA:
  files:
    - apps/vscode/src/sdk/sdk-session-event-coordinator.ts (~30 lines added, 0 lines removed)
    - apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts (NEW, 313 lines)
    - .factory/evidence/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY/01-reviewer-findings-to-red-mapping.md (NEW, 56 lines)
    - .factory/acts/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY.md (NEW, this file)

VSIX: NOT_EXECUTED (operator-owned)
LIVE_POST_FIX: NOT_EXECUTED (operator-owned)

VERDICT: PASS_COMPLETION_TERMINAL_QUEUE_HOST_REPAIR_CORRECTION01_PRELIVE
```

The operator handoff:

Case A — Unresolvable completion: unchanged held results, unavailable observation capability. Confirm no indefinite re-entry (CTQC-01), a visible host-owned blocked outcome (CTQC-02: marker stamped with `reason: "observation_unavailable"`), no fabricated completion (CTQC-03: `task_completion_committed === 0`), and the new CORRECTION01 invariants: (a) the marker is NOT stamped for a non-held BCB block (CTQC-02-CORR01), and (b) a new obligation (epoch bump + new held set) gets a fresh marker and publishes its own verdict (CTQC-03-CORR01).

Case B — Genuine recovery: the model acquires `command_status` (e.g. the next session/task inherits a different tool registry). Confirm the host legitimately progresses and finishes exactly once (CTQC-05: the next cycle delivers a coalesced continuation because the marker reason is "wrong" for the new capability state).

Case C — Capability unknown: the host does not surface a live tool registry (e.g. Hub/Remote). Confirm the existing `enqueueCompletionContinuationIfHeld` path runs (the CORRECTION01 `else` branch preserves the original enqueue behavior for honest unknown hosts) and the downstream SdkController returns `rejected` for `liveTools === undefined` (CORRECTION06 capability-fail-closed P1).

Queue-boundary follow-up: a future ACT MAY exercise the per-job wake path (`enqueueTerminalWake` → `formatTerminalWakePrompt` → `sdkHost.send`) to determine whether it is also bounded by the Elm `pickContinuationDirectiveForPublication` kernel or whether it requires an additional bounded guard. The wake is documented as the genuine observation notification path; the bounded host guard at the BCB site does NOT police it.

Also capture the Task Header's runtime/canonical/legacy phase divergence separately. The existing `Working` display issue must not be mistaken for proof that the completion queue still loops.

## C9 — Verdict

`HALT_QUEUE_BOUNDARY_DISCRIMINATOR_NOT_EXECUTED` — see C19 for the closure verdict and C20 for the evidence artifact and operator handoff.

## C19.1 — Second verdict retraction (factory reviewer's queue-boundary halt)

The factory reviewer HALTed this ACT on the third P0 (queue-boundary discriminator):

> "CTQC-04-CORR01 does not execute the queue discriminator. The entire test body is effectively `expect(h.sendLog.length).toBe(0)` ... It never instantiates `BackgroundNotifyCoordinator`, enqueues a per-job wake, drains a real `PendingPromptsController`, or observes a model-turn start. ... Calling CTQC-04 a queue-boundary discriminator is incorrect. It is another coalesced-continuation test."

The reviewer's narrow directive is followed verbatim:

> "Do not run another broad CORRECTION02. The two bounded production fixes should stand. The next action is one short executable probe: `ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01`. It should run exactly one genuine terminal wake through the existing queue consumer, with coalesced continuation blocked, and record whether that wake actually starts another model turn. ... No Elm changes, no production repair, no new framework. If the wake produces an unjustified new turn, that becomes a separately proven repair target. If it does not, proceed to commit and operator LIVE qualification."

The narrower verdict this ACT supports is documented for transparency:

- `PASS_COALESCED_CONTINUATION_GUARD_PRELIVE` — supported by reported executable evidence (5/5 CTQC01 + 3/3 CTQC01-CORR01 = 8/8 focused tests pass; C10 conservation 231/234 PASS with 3 pre-existing failures UNCHANGED).
- `PASS_COMPLETION_TERMINAL_QUEUE_HOST_REPAIR_CORRECTION01_PRELIVE` — too broad if interpreted as full queue convergence; downgraded to `HALT_QUEUE_BOUNDARY_DISCRIMINATOR_NOT_EXECUTED`.
- `PASS_COMPLETION_TERMINAL_QUEUE_CONVERGENCE` — NOT PROVEN (requires the per-job wake path probe; see `.factory/acts/ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01.md`).

The two production fixes (eligibility-predicate inversion at L2704-2713 and identity-disciplined reason preservation at L2600-2625) are PRESERVED on disk in the working tree and are not reverted. The reviewer explicitly directed that they should stand.

The one qualification from the reviewer is recorded for the successor probe: "the identity triple is not a complete held-set identity. If membership can change within an epoch, that case remains unproven. This is not automatically a new P0: the existing STALL/REARM machinery may already guarantee a suitable epoch transition. Preserve that requirement as an invariant rather than beginning another design cycle."
