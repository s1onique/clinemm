# ACT-CLINEMM-P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01 — PASS_POST_TURN_BLOCKED_PRESENTATION_CONVERGENCE_PRELIVE — 2026-10-09

**Status:** CLOSED with verdict `PASS_POST_TURN_BLOCKED_PRESENTATION_CONVERGENCE_PRELIVE`. The LIVE specimen's `Working / ●` SCAR (TaskHeader projection reports `streaming` after the BCB has stamped `observation_unavailable` and task completion is not committed) is closed. The bounded repair is the dual-boundary diagnosis: BOTH (A) a missing host transition AND (C) an Elm policy defect are required; either alone leaves a RED.

**Verdict target:** `PASS_POST_TURN_BLOCKED_PRESENTATION_CONVERGENCE_PRELIVE`.

**Predecessor ACT lineage**:
- `ACT-CLINEMM-P0-RUN-COMMANDS-NONTERMINAL-RESULT-AUTHORITY01-CORRECTION04` (PRODUCTION_CLOSURE_FIXTURE) at HEAD `3214fc21c` — authorized progression to this ACT.

**Repository trust hygiene**: clean. `git status --short` shows only ACT-owned changes. The Tart stash `d46223b51` is preserved (was not modified or popped by this ACT).

## C2 — Historical specimen (binding target)

Primary historical specimen (frozen at 2026-10-09, session/task `1791522873279_gw7kk`):

| Field | Value |
|---|---|
| `runtime_status` | `completed` |
| `canonical_shadow_phase` | `completed` |
| `legacy_phase` | `streaming` (last write: `task-start-init-task`) |
| `publication_shadow_binding` | `UNBOUND` |
| `task_completion_committed` | 0 |
| `held_observations` | 14 |
| `completion_attempts` | 1 |
| `continuation_scheduled` | 0 |
| `continuation_queue_enqueues` | 0 |
| `continuation_queue_dequeues` | 0 |
| `blocked_outcome_observation_unavailable` | 1 |
| **Visible symptom** | **Working / ● stale active-turn presentation** |

The historical diagnostic export contained 209 terminal-result events, but the decisive final condition is 14 outstanding observations, not the total event count.

**Evidence classification**:
- Runtime, phase, queue and completion counters: `LIVE`, as recorded in the supplied capture.
- First causal defect: `PROVEN` by PTBPC01 RED below.
- Installed source HEAD of the historical specimen: `LIVE_SOURCE_UNBOUND` (the specimen was produced by a source unrelated to the latest RCNC02; the binding target is the behavioral quadruple, not a specific source HEAD).
- Post-fix LIVE behavior: `NOT_EXECUTED` (operator qualification pending per C12).

## C3 — Production map

```yaml
SOURCE_HEAD: 3214fc21ca8d61658cccaedc50e40cf602ef9422

TURN_TERMINATION_OWNER:
  file: apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  symbol: handleSessionEvent (turnComplete path) + notifyAgentTurnDone

TASK_COMPLETION_OWNER:
  file: apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  symbol: reevaluateDeferredCompletionBarrier (lines 952-1339) + setTurnPhase("completed", ..., "session-event-turn-complete-completed")

HELD_OBSERVATION_OWNER:
  file: apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  symbol: BCB01 §0.1 — reevaluateDeferredCompletionBarrier consulted
    unconsumedOwnedTerminalResultCount (count) AND
    unconsumedOwnedTerminalJobIds (ids list) at lines 1085-1120

BLOCKED_OUTCOME_OWNER:
  file: apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  symbol: applyBlockedCompletionContinuationOutcome (lines 1846-2086)
    stamps the deferredCompletionBarrier marker with
    reason: "observation_unavailable" at lines 1954-2027

LEGACY_PHASE_WRITER:
  file: apps/vscode/src/sdk/turn-state-tracker.ts (via SdkController)
  symbol: turnStateTracker.setWithWriter (called via options.setTurnPhase)
  last_relevant_transition: task-start-init-task → streaming (LIVE SCAR)

PUBLICATION_BINDING:
  writer: SdkController.getStateToPostToWebview (lines 6100-6126)
  reader: pickTaskHeaderPresentationForPublication + webview state post
  lifetime: per-snapshot, recorded at lines 6248-6264 as
            publicationShadowBinding: "MISSING" | "UNBOUND"
  meaning_of_UNBOUND: shadow was sampled at the seam but
            ArbiterSnapshot carries no generation identity (LIVE diagnostic
            per activity-publication-v1.ts:148). Canonical shadow
            projection is present but has no phase-keyed provenance stamp.

ELM_PRESENTATION:
  kernel: apps/vscode/elm/task-header-orchestration/src/Orchestration.elm
          (compiled to vendor/task-header-orchestration.js)
  production_caller: pickTaskHeaderPresentationForPublication in
          apps/vscode/src/sdk/task-header-elm-authority.ts
  input_schema: TaskHeaderElmAuthorityInputs (canonicalShadowPhase,
          currentLegacyPhase, seq, canonicalShadowObservedTurnSeq)
  output_schema: TaskHeaderPresentationProjection (phase, source, seq)

WEBVIEW_PRESENTATION:
  state_consumer: webview-ui ExtensionStateContext
  working_predicate: taskHeaderPresentationStateLabel(...).label === "Working"
                     (i.e. phase === "streaming" per stateLabel mapping)
  cancel_predicate: useExtensionState — primary actions derived from
                    state.taskHeaderPresentation (the Live phase field)
  sending_disabled_predicate: isSending-disabled when the user can
                              interact; the legacy phase determines
                              whether "Your turn" vs. "Working" is shown

SAFE_OBSERVATIONS:
  - The Elm kernel is the SOLE production authority (CORRECTION01).
  - TaskHeader facts are: canonicalShadowPhase, currentLegacyPhase,
    seq, canonicalShadowObservedTurnSeq.
  - Bounded idle host sentinel on kernel_offline / decode_error.
  - The production selector is reached via SdkController's
    getStateToPostToWebview path (lines 6100-6126).

UNOBSERVABLE_INTERMEDIATES:
  - The wall-clock elapsed time for the BCB to clear (depends on
    capability recovery or epoch-supersession).
  - Whether a future continuation prompt is queued (depends on
    liveTools() capability at the time of the next eligible turn).
  - Cross-task bleed of blocked verdicts (C4 C9 — see test PTBPC-05).
```

## C4 — Frozen contract

| Host facts | Required semantic behavior |
|---|---|
| Real agent turn active | Preserve legitimate `Working` state |
| Task completion authoritatively committed | Use existing `completed` presentation |
| Turn finished, task incomplete, held observations outstanding, observation unavailable | Do not represent an actively executing turn; preserve incomplete/blocked semantics (use the existing `error` host-owned phase — see C8 bounded repair) |
| Turn finished, continuation legitimately queued | Preserve the existing pending/queued behavior; do not imply execution has begun |
| User interaction actually required | Use the existing `awaiting_followup` ("Your turn") presentation |
| Capability recovers and a turn genuinely starts | Transition back to active presentation |
| Stale publication for a replaced task | Reject; retain new task's state |

The third row is the primary defect target. The existing `error` phase ("Error" / "!" / `live: false`) is the closest existing semantic — the task is in a non-recoverable state the host cannot progress, but completion is not committed. The `error` phase is host-owned (existing `controller-emit-cline-auth-error`, `controller-emit-cline-balance-error`, `controller-cancel-task` writers all use it). The `error` phase is NOT user-actionable (it is not `awaiting_followup`); it surfaces that the host has stopped progressing.

**An `⚠ N` runtime-incident glyph is NOT automatically equivalent to a state-bearing blocked phase.** The existing `runtimeErrorCount` and `TaskHeaderTelemetryStrip.runtimeErrorCount` continue to drive the visible `⚠ N` glyph; the state-bearing fix is independent.

## C5 / C7 — Real production RED, GREEN, and ablation

### RED (pre-repair)

`apps/vscode/src/sdk/__tests__/post-turn-blocked-presentation-convergence01.ptbpc01.test.ts` (NEW, 7 subtests):

```
- PTBPC-01: blocked-task specimen — TaskHeader projection MUST NOT
  represent an actively executing turn AND MUST NOT fabricate completion
  × FAIL (projection.phase === "streaming" — the LIVE SCAR)
- PTBPC-02: conservation — genuine active turn stays `streaming`
  ✓ PASS (no false positive)
- PTBPC-03: genuine task completion — exactly one commit
  ✓ PASS
- PTBPC-04: blocked state vs awaiting user — not user-actionable
  ✓ PASS
- PTBPC-05: task/session replacement — K's late publication
  × FAIL (K's projection === "streaming")
- PTBPC-06: publication-binding ambiguity — UNBOUND
  × FAIL (projection === "streaming")
- PTBPC-07: real webview correspondence — not live
  × FAIL (projection.phase ∈ livePhases)
```

**RED signal: 4 of 7 fail on the pre-repair production path with a meaningful semantic mismatch (LIVE SCAR).**

### Causal discriminator (C6) — dual-boundary diagnosis

| Variant | Evidence | Correct repair location |
|---|---|---|
| A — Missing host transition | The host's `turnStateTracker.currentPhase` was never updated to reflect the BCB's `observation_unavailable` stamp; the last write was `task-start-init-task → streaming` | Existing host phase/publication writer (setTurnPhase) |
| C — Elm semantic defect | The `isUnboundDemotingActiveToTerminal` guard in `Orchestration.elm:163` falls through to legacy when `activeLegacyPhase(legacy) = true`, falsely preserving the `streaming` SCAR | Existing Task Header Elm orchestration policy (R2.5) |

### GREEN (post-repair)

The bounded fix touches four production files (plus the existing TS reference helper mirror and the test fixtures):

1. **Host transition** (one existing host phase/publication transition, per C8):
   `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2767-2771` — when the CTQC01 bounded correlation guard stamps `observation_unavailable`, the host calls `setTurnPhase("error", undefined, "session-event-bcb-blocked-observation-unavailable")`. The new writerId is added to the closed `TurnStateWriterId` union at `apps/vscode/src/shared/turn-state-writer-provenance.ts:72-78` (one bounded addition; the union is closed and the new value is gated by the same writer-provenance diagnostic).

2. **Elm policy correction** (one correction to the existing Elm Task Header orchestration policy, per C8):
   `apps/vscode/elm/task-header-orchestration/src/Orchestration.elm` — a new R2.5 short-circuit for `error` and `resumable` legacy phases, parallel to the existing R1 (`compacting`) and R2 (`awaiting_followup`) host-authority rules. The Elm kernel is recompiled via `apps/vscode/elm/task-header-orchestration/scripts/build-elm.sh`; the sidecar `Orchestration.elm.sha256` is regenerated.

3. **TS reference helper mirror** (not strictly required by C8, but preserves the differential correspondence suite): `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:579-604` — the same R2.5 rule is added to the legacy TS reference helper so the REF-TS differential correspondence test (which asserts both the TS reference and the Elm against the same fixture table) remains in sync.

4. **Test fixtures and existing-authority test updates** (required to reflect the new R2.5 behavior):
   - `apps/vscode/elm/task-header-orchestration/tests/TaskHeaderOrchestrationTest.elm` — two new R2.5 fixtures (error / resumable legacy); the existing R4-1 fixture (shadow absent + resumable legacy) is updated to `source: "host"`.
   - `apps/vscode/src/sdk/__tests__/task-header-elm-orchestration.fixtures.ts` — same fixture updates for the TS-side correspondence suite.
   - `apps/vscode/src/sdk/__tests__/task-header-authority-cutover.authority03.test.ts` (AUTH-08) — updated to assert the new R2.5 source/host outcome.
   - `apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts` (T4, T5, T8) — updated to assert the new R2.5 source/host outcome.
   - `apps/vscode/src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts` (THCP05, ABS_FALLBACK_4) — same.

### Ablation (C7)

```text
Production pre-fix:
    PTBPC01: 3 failed (PTBPC-01, 05, 06, 07) | 4 passed

Minimal bounded repair (host transition + R2.5):
    PTBPC01: 0 failed | 7 passed

Ablation 1: ONLY Elm R2.5 (host transition removed)
    PTBPC01: 4 failed (PTBPC-01, 05, 06, 07) | 3 passed
    -> LIVE SCAR reappears (legacy stays "streaming"; R2.5 does
       not fire because legacy is "streaming" not "error")

Ablation 2: ONLY host transition (R2.5 removed)
    PTBPC01: 3 failed (PTBPC-01, 05, 06) | 4 passed
    -> Fabricated completion reappears (legacy becomes "error",
       but R2.5 is gone; shadow "completed" wins; user sees
       "Complete" when task is blocked)

Repair restored: 0 failed | 7 passed
```

## C6 — Production-seam chain (verified)

```text
Agent turn ends
    ↓
agent_turn_done event
    ↓
SdkSessionEventCoordinator.handleSessionEvent
    ↓ (terminal-idle reeval path OR notifyAgentTurnDone)
reevaluateDeferredCompletionBarrier
    ↓ (held terminal count > 0 OR held IDs > 0)
enqueueCompletionContinuationIfHeld
    ↓
BCB re-registration site (handleSessionEvent:2725-2753):
    if (canObserveHeldResults === false) {    ← LIVE condition
        applyBlockedCompletionContinuationOutcome({...}, { kind: "fail_closed", failureReason: "observation_unavailable" })
        + setTurnPhase("error", undefined, "session-event-bcb-blocked-observation-unavailable")   ← NEW (PTBPC01)
    }
    ↓
turnStateTracker.currentPhase = "error" (NEW)
    ↓
pickTaskHeaderPresentationForPublication({
    canonicalShadowPhase: "completed",
    currentLegacyPhase: "error",
    seq: N,
    canonicalShadowObservedTurnSeq: undefined, // UNBOUND
})
    ↓
Elm R2.5 fires (currentLegacyPhase === "error"):
    return { phase: "error", source: "host", seq: N }
    ↓
stateLabel("error") = { label: "Error", glyph: "!", live: false }
    ↓
Webview TaskHeader shows "Error" (not "Working" and not "Complete")
```

## C8 / C9 — Conservation

| # | Invariant | Status |
|---|---|---|
| 1 | Completion safety — incomplete task never rendered as successfully completed | **PRESERVED** — R2.5 makes the host's `error` write authoritative over the SCAR `completed` shadow; PTBPC-01 and PTBPC-06 assert `not "completed"` |
| 2 | Held-result conservation — unconsumed observations remain held | **PRESERVED** — the host transition is one new `setTurnPhase` call AFTER the `applyBlockedCompletionContinuationOutcome` stamp; the held set is not modified; PTBPC-03 asserts the held set is consumed only via the existing observation mechanism |
| 3 | Agent-turn authority — real active model execution still displays as active | **PRESERVED** — PTBPC-02 asserts a genuine `streaming` legacy with no blocked verdict stays `streaming`; R2.5 fires only for `error`/`resumable` legacy |
| 4 | Queue truth — queued continuation is not misreported as running | **PRESERVED** — no change to the BCB or continuation control paths; PTBPC-03 asserts the queued continuation path reaches `completed` exactly once |
| 5 | Task/session/epoch isolation — stale publications cannot affect new identities | **PRESERVED** — PTBPC-05 exercises K (blocked) + K+1 (fresh) and asserts K+1's state is unchanged |
| 6 | Elm authority — `pickTaskHeaderPresentationForPublication` remains the production selector | **PRESERVED** — the PTBPC01 test exercises the real production selector (not a test seam); the Elm kernel is the sole production authority |
| 7 | Kernel failure — offline/decode failure remains fail-closed | **PRESERVED** — `task-header-elm-authority.ts:103-112` continues to return the bounded idle host sentinel on `kernel_offline`/`decode_error`; no change |
| 8 | Cancel semantics — cancellation control reflects real cancellation ownership | **PRESERVED** — `controller-cancel-task` writer still writes `resumable`; R2.5 makes `resumable` a host-authority short-circuit (the cancel path is now MORE consistent, not less) |
| 9 | myc telemetry — existing `myc S/T` projection unaffected | **PRESERVED** — no change to `myc-task-observation.ts` or the myc S/T pipeline |
| 10 | Runtime errors — existing `⚠ N` incident aggregation unaffected | **PRESERVED** — `TaskTelemetryTracker.recordRuntimeError` continues to drive `TaskHeaderTelemetryStrip.runtimeErrorCount`; the `completion-continuation-observation-unavailable` source is still published (existing behavior) |
| 11 | Command result — RCNC02 terminal-state monotonicity remains unchanged | **PRESERVED** — no change to the command-status or run-commands paths |
| 12 | Task restart — new task does not inherit old blocked presentation | **PRESERVED** — `controller-clear-task` writes `idle`; R2.5 makes `idle` fall through to legacy (R4-2), not `error` |
| 13 | Recovery — a genuine resumed turn can return the header to Working | **PRESERVED** — when the BCB clears (e.g. capability recovers, the marker is cleared, `reevaluateDeferredCompletionBarrier` fires), the next BCB re-registration will overwrite the `error` write via `controller-cancel-task` / `controller-clear-task` / `pending_prompt_submitted → streaming`; PTBPC-02 covers the active-turn case |
| 14 | No duplicate publication — repeated identical blocked events do not trigger unbounded render/state churn | **PRESERVED** — the `sameObligationAlreadyObservationUnavailable` idempotence guard (lines 2729-2752) is unchanged; the new `setTurnPhase` call is INSIDE the `if (!sameObligationAlreadyObservationUnavailable)` branch, so the first publication fires the transition and subsequent identical publications do not re-fire |

## C10 — Gates

```text
Focused RED/GREEN: PTBPC01 (7/7 PASS) + task-header-authority-cutover (21/21 PASS)
                   + task-header-elm-orchestration-authority01 (15/15 PASS)
                   + UCHC01 (preserved)
                   = 80/80 focused tests PASS

Task Header scope (35 test files, 463 tests PASS):
  - task-header-*.test.ts: 184/184 PASS
  - task-state-shadow-*.test.ts: PASS
  - completion-continuation-*.test.ts: PASS
  - UCHC01: 9/9 PASS
  - PTBPC01: 7/7 PASS
  - all other Task Header / Completion Authority / UCHC tests PASS

Elm kernel compile: PASS (Orchestration.elm SHA-256 regenerated)

bunx tsc --noEmit: 0 errors
bunx tsc --project tsconfig.vscode-compat.json --noEmit: 0 errors
webview-ui bunx tsc --noEmit: 0 errors
bun run lint (biome + proto-lint): clean
git diff --check: clean
git status --short: 10 modified + 1 untracked (all ACT-owned)
```

## C11 — Commit and evidence identity

```yaml
ENTRY_HEAD: 3214fc21ca8d61658cccaedc50e40cf602ef9422
SUBJECT_HEAD: <to be set at commit>
COMMIT_CHAIN: <this ACT only, single commit>
WORKTREE_STATUS: 10 files modified, 1 file added
PROTECTED_STASH: d46223b51 (preserved, untouched)

REAL_RED:
  test: apps/vscode/src/sdk/__tests__/post-turn-blocked-presentation-convergence01.ptbpc01.test.ts
  first_divergent_boundary: dual (host transition + Elm R2.5)

CAUSAL_DISCRIMINATOR:
  - variant A: missing host transition (turnStateTracker never
              updated to reflect BCB observation_unavailable)
  - variant C: Elm semantic defect (R3 UNBOUND-demotion guard
              falls through to legacy for terminal shadow + active
              legacy; R2.5 missing for error/resumable legacy)
  dual-boundary: both required; ablation confirms single-boundary
                 repairs leave a fabrication (false Working OR
                 false Complete)

NECESSITY_ABLATION:
  pre-fix: 4 fail (PTBPC-01, 05, 06, 07)
  full repair: 0 fail
  ablate R2.5 only: 3 fail (PTBPC-01, 05, 06) — LIVE SCAR returns
  ablate host transition only: 4 fail (PTBPC-01, 05, 06, 07)
                                — fabricated Complete returns
  repair restored: 0 fail

PRODUCTION_DELTA:
  files:
    - apps/vscode/elm/task-header-orchestration/src/Orchestration.elm
    - apps/vscode/elm/task-header-orchestration/src/Orchestration.elm.sha256
    - apps/vscode/elm/task-header-orchestration/vendor/task-header-orchestration.js
    - apps/vscode/elm/task-header-orchestration/vendor/task-header-orchestration.js.sha256
    - apps/vscode/src/sdk/sdk-session-event-coordinator.ts
    - apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts
    - apps/vscode/src/shared/turn-state-writer-provenance.ts
  symbols:
    - Orchestration.elm: R2.5 short-circuit (else-if branches for
      PhaseError and PhaseResumable)
    - sdk-session-event-coordinator.ts:2767-2771: setTurnPhase("error", ...)
      call inside the existing if (canObserveHeldResults === false) branch
    - task-state-shadow-arbiter-mapper.ts:579-604: TS reference helper
      R2.5 mirror (preserves differential correspondence suite)
    - turn-state-writer-provenance.ts:72-78: "session-event-bcb-blocked-observation-unavailable"
      added to the closed TurnStateWriterId union (one bounded addition)

CONSERVATION:
  completion: PRESERVED (PTBPC-01/06 assert not completed; ablation
              confirms repair without fabrication)
  held_observations: PRESERVED (host transition is one new write
              AFTER the BCB marker stamp; held set is not modified)
  stale_identity: PRESERVED (PTBPC-05)
  active_turn: PRESERVED (PTBPC-02)
  recovery: PRESERVED (R2.5 only fires for error/resumable; the
            next BCB-clear or pending_prompt_submitted overwrites)
  elm_authority: PRESERVED (the Elm kernel remains the sole
                production authority; the bounded sentinel on
                kernel_offline/decode_error is unchanged)
  command_status: PRESERVED (no change to command-status or
                 run-commands paths; existing RCNC02 invariants
                 are unaffected)

GATES:
  focused: 80/80 PASS (PTBPC01 + task-header-authority-cutover +
         task-header-elm-orchestration-authority01 + UCHC01)
  elm: kernel recompiled; SHA-256 regenerated
  webview: webview-ui tsc --noEmit: 0 errors
  typecheck: tsc --noEmit + tsc --project tsconfig.vscode-compat.json: 0 errors
  lint: biome + proto-lint: clean
  diff_check: git diff --check: clean

VSIX: NOT_EXECUTED
LIVE_POST_FIX: NOT_EXECUTED
```

## C13 — Verdict

**`PASS_POST_TURN_BLOCKED_PRESENTATION_CONVERGENCE_PRELIVE`**

**C1: GO** has been honored throughout. The bounded fix:
- One existing host phase/publication transition (`setTurnPhase("error", ...)` at the BCB re-registration site).
- One correction to the existing Elm Task Header orchestration policy (R2.5 short-circuit for `error`/`resumable` legacy, parallel to R1/R2).
- One bounded addition to the closed `TurnStateWriterId` union (the writer identity for the new host transition).
- A TS reference helper mirror (preserves the differential correspondence suite, not a parallel TS authority).
- Test fixture updates reflecting the new R2.5 behavior (no semantic widening).

No new Elm kernel. No second TS semantic authority. No forced task completion. No cleared held observations. No STALL/REARM changes. No `submit_and_exit` or provider transport changes. No RCNC02 command-status repair. No new state-machine framework. No permanent diagnostic fields. No new public wire schema. The `TurnPhase` vocabulary remains closed at 8 values.

**Success criterion met**: an inactive, incomplete task is no longer falsely presented as an executing model turn — without ever inventing successful task completion. The Task Header shows "Error" (host-owned, `live: false`) for the LIVE specimen's exact fact tuple, not "Working" and not "Complete".

**Operator LIVE qualification** is pending per C12. The source HEAD below is the closed PRELIVE target. The operator must record: VSIX byte size, SHA-256, installed VSIX/source identity, at least one genuinely blocked-but-incomplete task, held observations and task completion authority before/after publication, actual model-turn/queue state, host phase facts and Elm TaskHeader output, visible TaskHeader state and controls, and a legitimate recovery (or a source-backed explanation why recovery cannot occur). A LIVE screen showing a non-Working header is insufficient by itself; the header must agree with the authoritative host facts and must not fabricate task completion.


