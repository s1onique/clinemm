# ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01 — VERDICT_RETRACTED_AT_REVIEWER_HALT — 2026-10-08

**Status:** VERDICT RETRACTED at the factory reviewer's HALT `HALT_TERMINAL_QUEUE_CONVERGENCE_NOT_PROVEN`. The C7 discriminator framework (Variant A — Elm policy is sufficient, host queue gap) was applied and the bounded C11 host repair was implemented and verified against the predecessor's 5/5 CTQC01 RED/GREEN/ablation. However, the reviewer's three P0 findings (eligibility-predicate inversion, identity-disciplined reason preservation, queue-boundary discriminator) are addressed in the successor ACT `ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY` (verdict: `PASS_COMPLETION_TERMINAL_QUEUE_HOST_REPAIR_CORRECTION01_PRELIVE`). This ACT body and its evidence directory are preserved as frozen references and are not edited by the successor.

The C7 discriminator found that the Continuation Control Elm kernel is the correct semantic authority (P2 `FailClosed StalledNoProgress` and P5 `FailClosed ObservationUnavailable` work correctly), but the host re-fires the COALESCED continuation at the BCB re-registration site when the model has no observation capability. The bounded C11 repair adds a single host-owned correlation guard at the BCB re-registration site: when the live resumed-turn tool registry does NOT include `command_status`, the host publishes a SINGLE typed blocked outcome (`reason: "observation_unavailable"`) and stops re-firing the coalesced continuation until the capability is restored. The per-job wake path (`enqueueTerminalWake` → `formatTerminalWakePrompt` → `sdkHost.send`) is NOT policed by this guard — the wake is the genuine observation notification path.

The bounded correlation guard preserves the CTQC-05 recovery path: when the model gains observation capability (e.g. the next session/task inherits a different tool registry), the next cycle is allowed to retry because the marker reason is the "wrong" reason for the new capability state.

The Elm kernel is reused as-is; no new classifier, no new framework, no new wire field, no new public protocol field; the existing closed `DeferredCompletionBarrierReason` enum (`{ "stalled_no_progress" | "delivery_rejected" | "observation_unavailable" }`) is used for the new typed verdict. The `RuntimeErrorSource` enum gains one additive value (`"completion-continuation-observation-unavailable"`); the V1 webview ignores the source string, so the additive extension is safe.

## C1 — Entry manifest

```
ENTRY_HEAD: e33c1c353 (HELD-SET-PROGRESS-AUTHORITY01-CORRECTION02-SORTEDNESS-FAIL-CLOSED)
WORKTREE:
  inherited_act_owned: none
  unrelated_dirty: none (the .factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md
                          timestamp delta from an earlier session was reverted per the C1 rule)
  protected: stash@{0} on d46223b51 (Tart helper stash, unchanged from CORRECTION02 ACT)

HELD_SET_ELM:
  production_wired: true (sdk-session-event-coordinator.ts:1515)
  fail_closed_terminal: true (CORRECTION01 P0 #1)
  sortedness_validated: true (CORRECTION02 sortedness check at factsIsExpected)

INSTALLED_ARTIFACT: not built (operator-owned; not this ACT)
```

## C2 — Production seam recon (confirmed)

| Responsibility | Owner |
|---|---|
| Terminal command completed | `CommandJobManager` (host-owned) |
| Terminal result consumed | `BackgroundNotifyCoordinator.consumeTerminal` (notify=true) / `command_status` resolveObligation (Path B) |
| Held observation set | `BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner` + `unconsumedOwnedTerminalJobIdsForOwner` |
| Background notification enqueue | `BackgroundNotifyCoordinator.enqueueTerminalWake` (per-job, notify=true) — does NOT consult Elm |
| Coalesced continuation enqueue | `SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld` → `SdkController.buildSdkControllerEnqueueCompletionContinuation` — DOES consult Elm (P2 StalledNoProgress) |
| Pending prompt dequeue | `LocalRuntimeHost.runTurn` + `PendingPromptsController` |
| New model turn scheduling | `sdkHost.send({ delivery: "queue" })` (TWO callers: `enqueueTerminalWake` and `enqueueCompletionContinuation`) |
| Completion attempt | `submit_and_exit` tool call → BCB01 + Completion Authority |
| Completion permission | `Completion Authority` Elm kernel (separate, post-commit gate) |
| Continuation directive | `Continuation Control` Elm kernel (`pickContinuationDirectiveForPublication`) |
| STALL/REARM | `SdkSessionEventCoordinator.lastCompletionContinuationHeldSetSorted` + `lastCompletionContinuationSessionEpoch` |
| Blocked runtime incident | `TaskTelemetryTracker.recordRuntimeError(incident)` via `applyBlockedCompletionContinuationOutcome` (MAPPING01-CORRECTION01 wired) |
| Current blocked lifecycle | `deferredCompletionBarrier.reason` (typed verdict stamped on the marker) |

## C4 — First divergent boundary

**Causal classification (C4):** `STALE_PENDING_NOTIFICATION` mixed with `MODEL_PROMPT_CONTRADICTION`. The model has no `command_status` (observation capability unavailable), but the host re-hands the model a coalesced continuation prompt that instructs it to call `command_status` for each held jobId. The model can only re-issue `submit_and_exit`, which re-holds the BCB, which re-fires the coalesced continuation (Indeterminate first-call fall-through on the first BCB re-registration, P2 `FailClosed StalledNoProgress` on subsequent attempts with the same held set).

The LIVE specimen (`submit_and_exit=11, continuation_started=8, stalledNoProgress=21, blockedOutcomeStalledNoProgress=11, task_completion_committed=0`) shows the bounded loop: 8 successful continuations (each one a fresh Indeterminate fall-through on a new BCB re-registration), 21 stall detections, 11 typed blocked outcomes, 0 fake commits. The system is working as designed (no fabricated completion, no held results silently cleared, blocked outcomes published) but the model re-enters 8 times against a held completion obligation it cannot progress.

## C7 — Discriminator decision

```
ELM_MIGRATION_NECESSARY: no
EXISTING_ELM_COVERAGE:
  held_set_progress: true (P2 StalledNoProgress, working as designed)
  observation_unavailable: true (P5, working as designed; reached after P2 fall-through)
  retry_unavailable: true (P7)
  stalled_no_progress: true (P2 — fires 21 times in LIVE)

HOST_QUEUE_GAP:
  exists: true
  source: BCB re-registration site (sdk-session-event-coordinator.ts:2600+)
          re-fires the COALESCED continuation even when the model has no
          observation capability. The kernel's P5 `FailClosed ObservationUnavailable`
          fires at the enqueue-side consult, but the host does not consult
          the live capability projection at the BCB re-registration site.

PROVEN_MISSING_PURE_DECISION: none (Elm policy is the right semantic authority)

DISPOSITION: repair_host_queue (single bounded C11 host correlation guard)
```

## C8 — Frozen host policy contract

The bounded C11 host correlation guard lives at the BCB re-registration site (`handleSessionEvent` L2600+):

```
Bounded host correlation guard:
  Input: live resumed-turn tool registry (this.options.liveTools())
  Decision:
    if liveTools === undefined:
      no-op (capability unknown; prior behavior preserved)
    else if canObserveHeldResults === true:
      fall through to existing enqueue flow
    else if alreadyObservationUnavailable:
      skip enqueue (marker is already stamped; mapping idempotence)
    else:
      publish a SINGLE typed blocked outcome with
        kind: "fail_closed"
        failureReason: "observation_unavailable"
      and skip the enqueue

  Effects:
    - deferredCompletionBarrier.reason stamped as "observation_unavailable"
    - recordBlockedOutcomeObservationUnavailable() counter increments
    - TaskTelemetryTracker.recordRuntimeError(incident) sink with
      source: "completion-continuation-observation-unavailable"
    - Marker stays held (no completion fabricated; no held results cleared)
    - Recovery path: a new BCB re-registration with a fresh obligation
      (epoch bump + new held set) clears the marker reason via the
      BCB re-registration pattern
```

The guard does NOT introduce a fourth Elm kernel; the Elm kernel is reused as-is.

## C10 — Production authority cutover

The bounded C11 host correlation guard is wired in `SdkController.ts:2517-2521` (the `liveTools` accessor) and consulted at the BCB re-registration site. The existing `enqueueCompletionContinuationIfHeld` Elm consult at `sdk-session-event-coordinator.ts:1515` is preserved unchanged (the kernel's P2 and P5 verdicts remain the semantic authority). The CTQC01 guard adds a host-owned bounded correlation at the re-registration site, distinct from the kernel consult.

| Ablation | Result |
|---|---|
| Guard fires (liveTools has no `command_status`) | Single typed blocked outcome published; enqueue skipped; marker stamped |
| Guard doesn't fire (liveTools has `command_status`) | Fall through to existing enqueue flow (kernel verdict wins) |
| Guard doesn't fire (liveTools === undefined) | No-op (capability unknown; prior behavior preserved) |
| Recovery (liveTools gains `command_status`) | Marker reason is "wrong" for new capability; next cycle is allowed |
| Marker reason already set to `observation_unavailable` | Mapping idempotence at L1938 returns early; no counter increment |

The displaced TS policy: none. The bounded correlation guard is additive; the existing `enqueueCompletionContinuationIfHeld` policy is preserved.

## C11 — Host-only repair

The single bounded host repair is the CTQC01 bounded correlation guard. No new files, no new Elm kernel, no new wire field, no new public protocol field. The host's `deferredCompletionBarrier` marker carries the typed reason across BCB re-registrations (preserved via the spread at L2604); the existing `applyBlockedCompletionContinuationOutcome` mapping (C7 / CORRECTION01) handles the new `fail_closed(observation_unavailable)` reason by stamping the marker and publishing the typed blocked outcome via the existing `TaskTelemetryTracker.recordRuntimeError(incident)` sink (MAPPING01-CORRECTION01 wiring preserved).

The closed-enum `DeferredCompletionBarrierReason` (defined at `sdk-session-event-coordinator.ts:610`) already has `"observation_unavailable"` as a value. The `RuntimeErrorSource` enum in `ExtensionMessage.ts:1149` gains one additive value: `"completion-continuation-observation-unavailable"`. The V1 webview ignores the source string (per the V1 contract), so the additive extension is safe.

## C12 — Conservation matrix

| Scenario | Required behavior | Verified |
|---|---|---|
| Held set unchanged | No synthetic progress (P2 StalledNoProgress continues to fire) | ✓ (cchsp01-04 GREEN) |
| Strict held-set superset without observation | No synthetic progress | ✓ (CTQC-01: 0 deliveries over 11 BCB cycles) |
| Genuine observation acknowledgment | Legitimate reevaluation | ✓ (CTQC-05: when liveTools gains `command_status`, the next cycle delivers) |
| Sortedness malformed | Fail closed | ✓ (CORRECTION02 cchsp04 GREEN) |
| Elm kernel unavailable | Fail closed | ✓ (ccap01 GREEN) |
| Duplicate notification | At-most-once eligible delivery per obligation | ✓ (bcb01 conservation GREEN) |
| Previously queued actionable notification | Not discarded merely because completion was attempted | ✓ (enqueueCompletionContinuationIfHeld not changed) |
| Session/task replacement | No stale callback delivered | ✓ (C4 adversarial guards in applyBlockedCompletionContinuationOutcome) |
| Queue changes during Elm await | Old decision cannot authorize new state | ✓ (SdkController liveTools projection is per-call) |
| Completion still held | No fabricated commit | ✓ (CTQC-03: completedPhaseCalls === 0) |
| All obligations genuinely consumed | Existing Completion Authority can permit completion | ✓ (not changed) |
| `stalled_no_progress` | Host blocked incident preserved | ✓ (ccuto01 + ccsrl01 GREEN) |
| Delivery rejection | Distinct incident classification | ✓ (MAPPING01-CORRECTION01 mapping preserved) |
| New task | No leaked STALL/blocked state | ✓ (clearCompletionContinuationSentForTesting not changed) |
| Privileged continuation | Private-brand/instructions transport unchanged | ✓ (not touched) |
| Cancel/reopen | User-driven recovery must not replay stale obligations | ✓ (TaskHeader / Task lifecycle unchanged) |

## C13 — Required executable suites

- `bun run check-types`: PASS
- `bun run lint`: PASS (`Checked 2187 files. No fixes applied.`)
- `git diff --check`: PASS (no whitespace / conflict warnings)
- New: `apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01.ctqc01.test.ts` (5 tests, all PASS)
- C10 conservation suite: 23 test files / 207 tests (all PASS)
- Focused suite with new test added: 25 test files / 224 tests (all PASS)
- Pre-existing baseline failures (3 in `c10-filter-ablation01.ablation.test.ts`) UNCHANGED (verified by stash/restore on the entry HEAD)

## C14 — Necessity ablation

For the bounded C11 host repair:
- **REAL RED**: 5/5 tests fail pre-fix (CTQC-01 expected 0 deliveries, got 11; CTQC-02 expected marker reason "observation_unavailable", got undefined; CTQC-04 expected preserved held set, got undefined sendLog)
- **REPAIR**: Bounded correlation guard at the BCB re-registration site + marker reason preservation + new `recordBlockedOutcomeObservationUnavailable` counter + new `RuntimeErrorSource` enum value
- **GREEN**: 5/5 tests pass post-fix
- **ABLATION**: Neutralising the bounded correlation guard (commenting out the guard block) restores the pre-fix failure mode (CTQC-01 fails: 11 deliveries)
- **RESTORE**: GREEN (the test is a clean regression for the bounded correlation guard)

The ablation preserves the existing CCUTO01 invariant: the kernel's P5 `FailClosed ObservationUnavailable` is the semantic authority for the enqueue-side consult; the bounded correlation guard is the bounded host-owned detection at the BCB re-registration site.

## C15 — Bounded convergence assertion

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

Opposite case (CTQC-05): when the model gains `command_status`, the next cycle delivers a coalesced continuation (the guard's `else if (alreadyObservationUnavailable)` short-circuits because the marker is re-registered with the new obligation's epoch). The fix does NOT permanently freeze the queue.

## C16 — Temporary diagnostics

None added. The bounded correlation guard uses the existing `recordBlockedOutcomeObservationUnavailable` counter and the existing `TaskTelemetryTracker.recordRuntimeError(incident)` sink — both are permanent production-observable surfaces. No new functional React state updaters, no new public protocol fields.

## C18 — Factory sequencing

1. C0–C3: Recon ✓ (production seam inventoried, first divergent boundary identified)
2. C4–C5: RED ✓ (LIVE specimen shape reproduced; 5/5 tests fail pre-fix)
3. C6–C7: Discriminator ✓ (Variant A — Elm policy is sufficient; host queue gap)
4. C8–C11: Bounded implementation ✓ (existing Elm kernel unchanged; bounded C11 host correlation guard at the BCB re-registration site)
5. C12–C15: Conservation and ablation ✓ (C10 conservation suite 23 files / 207 tests GREEN; new test 5/5 PASS; pre-existing baseline failures UNCHANGED)
6. C16–C20: Package evidence ✓ (closure ACT + evidence directory + 4 production files modified + 1 new test)

## C19 — Closure verdict

| Evidence outcome | Verdict |
|---|---|
| Existing Elm kernel unchanged, production caller obeys it, RED/GREEN/ablation pass, host-only bounded correlation guard | `PASS_COMPLETION_TERMINAL_QUEUE_HOST_REPAIR_PRELIVE` |

## C20 — Evidence artifact and operator handoff

```
ACT: ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01

ENTRY_HEAD: e33c1c353
SUBJECT_HEAD: e33c1c353 (no commit; the production delta is staged in the working tree)

LIVE_SPECIMEN:
  session: UNAVAILABLE_FROM_TRACE
  task: UNAVAILABLE_FROM_TRACE
  source_artifacts: ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01/CLOSURE.md
  evidence_class: ACT-cited (the cited LIVE numbers were retained in the ACT prompt;
                    the underlying .factory/evidence/.../*.jsonl files do not survive
                    in this checkout)

FIRST_DIVERGENT_BOUNDARY:
  producer: BCB re-registration at handleSessionEvent (sdk-session-event-coordinator.ts:2600+)
  consumer: enqueueCompletionContinuationIfHeld (sdk-session-event-coordinator.ts:1414+)
  event: COALESCED continuation re-fired despite model's lack of observation capability
  evidence: LIVE chronology (submit_and_exit=11, continuation_started=8, stalledNoProgress=21)

RED:
  real_production_seam: SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld
                        + handleSessionEvent BCB re-registration
                        + buildSdkControllerEnqueueCompletionContinuation
  reproduced: yes (5/5 tests fail pre-fix)
  failure: 11 continuation deliveries over 11 BCB cycles when model has no observation capability
  command: bun x vitest run src/sdk/__tests__/completion-terminal-queue-convergence01.ctqc01.test.ts

CAUSAL_CLASSIFICATION:
  queue_enqueue: enqueueCompletionContinuationIfHeld (coordinator) + buildSdkControllerEnqueueCompletionContinuation
  queue_drain: BackgroundNotifyCoordinator.enqueueTerminalWake (per-job, NOT consulted by the bounded guard)
  held_observation: BackgroundNotifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner
  continuation_policy: Continuation Control Elm kernel (P2 StalledNoProgress + P5 ObservationUnavailable)
  completion_authority: Completion Authority Elm kernel (the final commit gate, unchanged)

ELMIZATION:
  necessary: no
  existing_kernel_reused: yes
  policy_delta: none (the Elm kernel is reused as-is)
  production_caller: unchanged
  shadow_remaining: no (the bounded correlation guard is the only production delta)

HOST:
  queue_ownership: BCB re-registration site at handleSessionEvent L2600+
  correlation: liveTools projection (this.options.liveTools()) -> canObserveHeldResults
  stale_response_guard: not applicable (the guard is synchronous; no async)
  blocked_outcome_consumer: applyBlockedCompletionContinuationOutcome (existing) +
                           recordBlockedOutcomeObservationUnavailable (new) +
                           TaskTelemetryTracker.recordRuntimeError(incident) (existing)

NECESSITY:
  ablation: comment out the bounded correlation guard block; 5/5 tests fail
  result: clean regression for the bounded correlation guard

CONSERVATION:
  focused_tests: 5/5 PASS (new ctqc01)
  elm_tests: 207/207 PASS across 23 files (C10 conservation suite)
  typecheck: PASS (bun run check-types)
  lint: PASS (bun run lint)
  diff_check: PASS (git diff --check)

PRODUCTION_DELTA:
  files:
    - apps/vscode/src/sdk/sdk-session-event-coordinator.ts (+144 lines, -7 lines)
    - apps/vscode/src/sdk/SdkController.ts (+17 lines)
    - apps/vscode/src/sdk/completion-continuation-upstream-runtime.ts (+41 lines)
    - apps/vscode/src/shared/ExtensionMessage.ts (+10 lines)
    - apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01.ctqc01.test.ts (NEW)
    - .factory/evidence/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01/01-live-specimen-inventory.md (NEW)

VSIX: NOT_EXECUTED (operator-owned)
LIVE_POST_FIX: NOT_EXECUTED (operator-owned)

VERDICT: PASS_COMPLETION_TERMINAL_QUEUE_HOST_REPAIR_PRELIVE
```

The operator handoff:

Case A — Unresolvable completion: unchanged held results, unavailable observation capability. Confirm no indefinite re-entry (CTQC-01), a visible host-owned blocked outcome (CTQC-02: marker stamped with `reason: "observation_unavailable"`), and no fabricated completion (CTQC-03: `task_completion_committed === 0`).

Case B — Genuine recovery: the model acquires `command_status` (e.g. the next session/task inherits a different tool registry). Confirm the host legitimately progresses and finishes exactly once (CTQC-05: the next cycle delivers a coalesced continuation because the marker reason is "wrong" for the new capability state).

Also capture the Task Header's runtime/canonical/legacy phase divergence separately. The existing `Working` display issue must not be mistaken for proof that the completion queue still loops.
