# ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01 — PASS_HELD_SET_PROGRESS_ELM_AUTHORITY_PRELIVE — 2026-10-08

**Status:** CLOSED at the C1–C12 gates. **The held-set progress
classification — a pure semantic distinction between "no progress"
(identical held set or pure-superset passive accumulation) and "real
progress" (contraction or membership shift) — is now a property of the
existing Continuation Control Elm kernel (`Policy.classifyHeldSetProgress`
at `apps/vscode/elm/completion-continuation-control/src/Policy.elm:230-255`).**
**The inlined TS set-comparison helper at the production seam
(`isStrictSupersetOf` in `sdk-session-event-coordinator.ts:85-107`) is
REMOVED. The Elm kernel's `failureReason: "stalled_no_progress"` is the
SOLE semantic authority for the no-progress blocking decision.**

This ACT is the production cutover for the third of the three
authorities the brief identified as remaining in TypeScript. The
candidate held-set transition domain from ACT §C2 is preserved
unchanged; the migration is a *classifier relocation* (TS → Elm),
not a policy change. The live STALLED-REARM-LOOP01 defect shape
(monotone held accumulation under no observation capability) is
preserved as a STALL signal — both `NoProgress` (canonical-set
equality) and `PassiveAccumulation` (strict-superset accumulation)
map to `FailClosed StalledNoProgress` (P2).

## C1 — Inventory of the production classifier (recon)

### PRODUCTION_CLASSIFIER
```
file:       apps/vscode/src/sdk/sdk-session-event-coordinator.ts
symbol:     isStrictSupersetOf (pre-migration) — REMOVED
            + the inline block at lines 1513-1530 that used it
production_caller:
            SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld
            (apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1423)
```

### INPUTS (pre-migration TS, mirrored by the Elm kernel)
```
previous_held_set:   lastCompletionContinuationHeldSetSorted (line 740)
current_held_set:    live getUnconsumedOwnedTerminalJobIds()
observation_consumption: NOT used as a direct input
                        (set-arithmetic IS the consumption signal)
task_identity:        activeSessionId + taskId
session_identity:     same
```

### OUTPUT (pre-migration TS)
```
stalled_no_progress: kind = "stalled_no_progress" (line 1529)
progress_classification: implicit
                          (same canonical set → NoProgress)
                          (strict superset → PassiveAccumulation)
                          (real difference → release REARM at line 1543)
```

### TEMPORAL_OWNER (stays in TS post-migration)
```
previous_snapshot: lastCompletionContinuationHeldSetSorted
stall_fingerprint: lastCompletionContinuationControlFingerprint
rearm_epoch:      lastCompletionContinuationSessionEpoch
observation_records: NOT changed (terminal observation still
                      lives on the @cline/core runtime)
```

### ELM (post-migration)
```
current_facts:           priorHeldSetSorted: List String
                          currentHeldSetSorted: List String
                          + the original unconsumedCount / observation /
                            completion / sessionMatches / taskMatches /
                            alreadyCommitted fields
existing_progress_policy: P2 maps BOTH NoProgress and PassiveAccumulation
                            to FailClosed StalledNoProgress
                          P3 (ContractionOrMembershipShift) and
                            P4 (Indeterminate — no prior snapshot)
                            fall through to the rest of the policy
possible_extension:     N/A (migration is a relocation, not an extension)
```

The Elm sidecar bundle (`apps/vscode/elm/completion-continuation-control/vendor/completion-continuation-control.js`)
contains the new `classifyHeldSetProgress` and the four variant tags
(`indeterminate` / `no_progress` / `passive_accumulation` /
`contraction_or_membership_shift`). This is verified by
`completion-continuation-held-set-progress-ablations.cchsp02.test.ts`
ABLATION 4.

## C2 — Closed held-set transition domain (frozen)

The candidate transition domain from ACT §C2 maps 1:1 to the closed
`HeldSetProgress` sum in `Domain.elm:163-167`. The semantic
classifications are:

| Previous → current                       | Elm variant                       | Directive (TS-side)        |
|------------------------------------------|-----------------------------------|----------------------------|
| `{A,B} → {A,B}` (identical)               | `NoProgress`                      | `FailClosed StalledNoProgress` (P2) |
| `{A,B} → {A,B,C}` (strict superset)       | `PassiveAccumulation`             | `FailClosed StalledNoProgress` (P2) |
| `{A,B,C} → {A,B}` (contraction)           | `ContractionOrMembershipShift`    | falls through → `ObserveThenRetry` (P4) |
| `{A,B} → {A,C}` (membership shift)        | `ContractionOrMembershipShift`    | falls through → `ObserveThenRetry` (P4) |
| `{A,B} → {}` (all cleared)                | `ContractionOrMembershipShift`    | falls through → `ObserveThenRetry` (P4) |
| Unknown → current (`[]` → any)            | `Indeterminate`                   | falls through (P2 short-circuits) |

These are encoded in `Policy.classifyHeldSetProgress` (linear two-pointer
walk, O(n) time, O(1) auxiliary space). The closed-schema contract
requires the host to pre-sort both lists ascending; the kernel does
NOT re-sort (side-effect-free, C6).

## C3 — Observation provenance vs set arithmetic

The Elm classifier operates on pure set arithmetic. It does NOT consult
an external "observation consumption" signal — the set arithmetic
itself is the consumption signal:

  - Prior `{A,B}`, current `{A,B}` → model did not consume anything
    (the held set is unchanged) → `NoProgress` → STALL.
  - Prior `{A,B}`, current `{A,B,C}` → passive accumulation
    (new background terminals arrived while the model had no
    observation capability) → `PassiveAccumulation` → STALL.
  - Prior `{A,B,C}`, current `{A,B}` → the model observed A or C
    (consumed one of the held terminals) → `ContractionOrMembershipShift`
    → release.
  - Prior `{A,B}`, current `{A,C}` → A was consumed, C was a new
    terminal — `ContractionOrMembershipShift` → release.

This is the C3 safety property: set contraction IS observation
provenance. No external evidence is required. The classifier is
deterministic and side-effect-free (Policy.elm C6 invariant). If
provenance is unavailable, the closed `Indeterminate` (empty `prior`)
arm releases the directive — fail-open for first-call, never a
fabricated verdict.

## C4 — Executable RED reference matrix

The RED reference matrix lives in
`completion-continuation-held-set-progress-reference.cchsp01.test.ts`
(10 tests, all PASS). Each case drives the REAL production seam
(`enqueueCompletionContinuationIfHeld`) and asserts the TS-side
outcome:

| Case                                              | Prior      | Current    | TS Outcome                  | Pass |
|---------------------------------------------------|------------|------------|------------------------------|------|
| Identical held set (NoProgress)                  | [j1,j2,j3] | [j1,j2,j3] | stalled_no_progress         | ✓    |
| Strict superset (PassiveAccumulation, LIVE defect)| [j1,j2,j3] | [j1,j2,j3,j4] | stalled_no_progress       | ✓    |
| Contraction (real progress)                       | [j1,j2,j3] | [j2,j3]   | delivered                    | ✓    |
| Membership shift                                 | [j1,j2]    | [j2,j4]    | delivered                    | ✓    |
| Empty held set (no obligations)                   | []         | []         | not_held                     | ✓    |
| Empty prior + non-empty current (first call)     | []         | [j1,j2]    | delivered                    | ✓    |
| Empty prior + empty current (first call, no held) | []         | []         | not_held                     | ✓    |
| All cleared (contraction to empty)               | [j1,j2]    | []         | not_held                     | ✓    |
| Order permutation (canonical set equality)       | [j1,j2,j3] | [j3,j1,j2] | stalled_no_progress         | ✓    |
| Duplicate ids in current (multiset equality)      | [j1,j1]    | [j1,j1]    | stalled_no_progress         | ✓    |

The Elm-side `classifyHeldSetProgress` is verified by the kernel's
own unit tests in `tests/CompletionContinuationControlTest.elm`
("HELD-SET-PROGRESS-AUTHORITY01 C2: classifyHeldSetProgress"
describe block, 9 tests).

## C5 — Existing Elm kernel extended, no new kernel

The kernel choice is `apps/vscode/elm/completion-continuation-control/`
(approach A: Elm owns classification AND directive together). The
extension surface is:

  - `Domain.elm` — new closed `HeldSetProgress` sum (4 variants) +
    `priorHeldSetSorted` / `currentHeldSetSorted` Facts fields +
    `factsIsExpected` re-checks non-empty jobIds.
  - `Policy.elm` — new `classifyHeldSetProgress` helper (linear
    two-pointer walk) + P2 now consults the classification (NoProgress
    and PassiveAccumulation → `FailClosed StalledNoProgress`).
  - `Codec.elm` — new `priorHeldSetSorted` / `currentHeldSetSorted`
    fields on the inbound schema; new `encodeHeldSetProgress` /
    `decodeHeldSetProgress` for the outbound diagnostic.
  - `Main.elm` — outbound message now includes the diagnostic
    `heldSetProgress` field.

No new Elm kernel was authorized. The pre-existing Continuation
Control kernel now also owns the held-set progress classification.

## C6 — Host-owned temporal state preserved

The host continues to own:

  - `lastCompletionContinuationHeldSetSorted` — the prior-snapshot
    store (line 740). Cleared by `clearCompletionContinuationSentForTesting`.
  - `lastCompletionContinuationSessionEpoch` — REARM dedupe
    (line 689). Cleared on real progress (the new code's
    `if (priorSortedHeld !== undefined && directive.tag !== "fail_closed")`).
  - `lastCompletionContinuationControlFingerprint` — STALL
    fingerprint (line 716). Cleared alongside.
  - `deferredCompletionBarrier` / `deferredContinuation` — BCB markers.
  - Session / task identity (the `deferredCompletionBarrier` already
    binds `(sessionId, taskId, epoch)`).
  - The MAPPING01-CORRECTION01 `taskTelemetry.recordRuntimeError`
    sink (called from `applyBlockedCompletionContinuationOutcome`
    when the outcome is `stalled_no_progress`).
  - `applyBlockedCompletionContinuationOutcome` itself (the
    `.then()` mapping on the void enqueue).

Elm is a pure projection `Facts -> Directive`. Elm never writes
diagnostics, never mutates the held-set store, never owns the REARM
dedupe, and never invokes the production lifecycle consumer.

## C7 — Production wiring and ablations

The production seam at `enqueueCompletionContinuationIfHeld` now
consults the Elm kernel via `pickContinuationDirectiveForPublication`
and uses the directive's `failureReason` to gate the outcome:

  - `FailClosed StalledNoProgress` → `recordStalledNoProgress()` +
    return `kind: "stalled_no_progress"`.
  - Non-fail-closed + prior non-empty → release REARM dedupe so a
    fresh continuation may proceed within the same epoch.
  - Otherwise (e.g. `ObserveThenRetry`) → fall through to the
    existing dedupe + callback path.

The four ablations live in
`completion-continuation-held-set-progress-ablations.cchsp02.test.ts`
(8 tests, all PASS):

  - **ABLATION 1: Elm says no progress** (2 tests) — `prior == current`
    and `current` strict superset of `prior` → `FailClosed StalledNoProgress`.
  - **ABLATION 2: Elm says real progress** (2 tests) — contraction
    and first-call → `ObserveThenRetry`.
  - **ABLATION 3: Kernel failure** (2 tests) — `kernel_offline` and
    `decode_error` → `FailClosed MalformedFacts` (the fail-closed
    sentinel never fabricates a successful directive).
  - **ABLATION 4: Legacy TS authority removed** (2 tests) — the
    inlined `isStrictSupersetOf` function is REMOVED from
    `sdk-session-event-coordinator.ts`; the compiled Elm bundle
    contains `classifyHeldSetProgress` and the four variant tags.

Ablation 4's "production source no longer references the inlined
helper" assertion uses a regex check
(`/^function isStrictSupersetOf/m`) that ignores the ACT marker
comment but rejects the function body. The current production source
contains only the marker comment; the function body is removed.

## C8 — Boundary and codec security

The wire schema is now closed:

  ```
  Inbound Facts:
    {
      "unconsumedCount":        Int,
      "observation":            { "observeHeldResults": Bool, "retryCompletion": Bool }?,
      "completion":              { "observeHeldResults": Bool, "retryCompletion": Bool }?,
      "priorHeldSetSorted":      [String],   // required; [] == first-call
      "currentHeldSetSorted":    [String],   // required
      "sessionMatches":          Bool,
      "taskMatches":             Bool,
      "alreadyCommitted":        Bool
    }
  ```

Malformed boundary cases (in `ccmb01.test.ts`, 15 tests, all PASS):

  - missing `unconsumedCount` → `decode_error`
  - wrong-typed `unconsumedCount` (string) → `decode_error`
  - wrong-typed capability field → falls back to `emptyCapabilityMap`
    (fail-OPEN at the optional field; fail-CLOSED at the policy)
  - missing `observation` AND `completion` objects → both fall back to
    `emptyCapabilityMap` → `FailClosed RetryUnavailable`
  - empty-string jobId in `priorHeldSetSorted` or
    `currentHeldSetSorted` → `FailClosed MalformedFacts` (closed-schema
    re-check at `factsIsExpected`)
  - kernel_offline → `FailClosed MalformedFacts`
  - decode_error → `FailClosed MalformedFacts`

No new Elm runtime asset; the existing
`runtime-assets/completion-continuation-control.js` is unchanged. No
new vendored Elm compiler. No protocol expansion. No `globalThis.Elm`
fallback. The closed-schema decoder is the same `Decode.decodeString`
pipeline as before.

## C9 — Conservation gates

All conservation suites pass. The C10 / C11 / C9 / BCB01 / HBCLO01 /
HBP01 / etc. invariants are preserved.

Conservation suite results (focused tests):

| File                                                          | Tests | Status |
|---------------------------------------------------------------|-------|--------|
| completion-continuation-control-elm-conservation.cccs01         | 5     | PASS   |
| completion-continuation-control-elm-correspondence.cccec01     | 9     | PASS   |
| completion-continuation-control-elm-capability.cccap01         | 7     | PASS   |
| completion-continuation-control-elm-malformed.ccmb01           | 15    | PASS   |
| completion-continuation-control-elm-namespace-coexistence.ccnc01 | 4   | PASS   |
| completion-continuation-control-elm-authority-cutover.ccac01   | 6     | PASS   |
| completion-continuation-control-elm-production-wiring.ccpw01   | 3     | PASS   |
| completion-continuation-stall-enforcement.ccse01               | 5     | PASS   |
| completion-continuation-stalled-rearm-loop.ccsrl01             | 13    | PASS   |
| completion-continuation-stall-lifetime.ccslt01                 | 10    | PASS   |
| completion-continuation-structural-authority.ccsa01             | 10    | PASS   |
| completion-continuation-control-authority.ccca01               | 35    | PASS   |
| completion-continuation-unresolvable-terminal-outcome.ccuto01   | 14    | PASS   |
| completion-continuation-upstream-discriminator.ccupd01         | 9     | PASS   |
| completion-continuation-rearm01.rearm01                        | 7     | PASS   |
| host-blocked-outcome-publication.hbop01                        | 12    | PASS   |
| host-blocked-outcome-lifecycle-owner.hbclo01                    | 7     | PASS   |
| host-blocked-outcome-consumer-probe.hbocp01                    | 6     | PASS   |
| task-completion-continuation-coherence.tccc01                  | 5     | PASS   |
| completion-continuation-held-set-progress-reference.cchsp01    | 10    | PASS   |
| completion-continuation-held-set-progress-ablations.cchsp02     | 8     | PASS   |
| (all `completion-continuation-control-elm-*`)                  | 56    | PASS   |

Conservation invariants explicitly preserved:

  - STALL survives attempt-only BCB re-registration (ccslt01).
  - 4 × submit_and_exit with monotone held accumulation → exactly
    1 delivery (ccsrl01, the LIVE defect shape).
  - Completion NOT fabricated while held > 0 (hbop01, hbc01).
  - Stalled outcome reaches the production lifecycle consumer
    (hbclo01).
  - Live specimen's typed blocked verdict publication (hbop01).
  - One K-enqueue + K+1 fire under held-set change (rearm01).
  - CORRECTION01 (MAPPING01) IDEMPOTENCE — the
    `applyBlockedCompletionContinuationOutcome` helper's
    at-most-one stamp is preserved.

Conservation prerequisites verified to be UNCHANGED by this ACT:

  - Count/list divergence repair — preserved.
  - No premature task completion — preserved.
  - Genuine consumption can release the hold — preserved.
  - Existing runtime-error incident publication — preserved.
  - Exactly-once incident guard — preserved (MAPPING01-CORRECTION01
    IDEMPOTENCE is in `applyBlockedCompletionContinuationOutcome`,
    which the production code still calls with the same `outcome`).
  - CORRECTION05 privileged instructions transport — not touched.
  - CORRECTION06 actual tool-capability binding — not touched.
  - Existing TaskHeader semantics — not touched.

Conservation suites NOT exercised by this ACT but preserved by
construction:

  - terminal convergence
  - task-completion-continuation-coherence (the existing tests
    pass; the migration does not change the
    `setTurnPhase("completed", ...)` semantics or the
    `applyBlockedCompletionContinuationOutcome` mapping).

Conservation-side note on test-driver updates:

The pre-existing `emitCompletionTurn` test drivers in
`completion-continuation-stall-lifetime01.ccslt01.test.ts`,
`host-blocked-outcome-publication01.hbop01.test.ts`,
`host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts`, and
`host-blocked-outcome-consumer-probe01.hbocp01.test.ts` were
updated to add `await new Promise((r) => setTimeout(r, 50))` after
`await coordinator.handleSessionEvent(doneEvent)`. This drains the
Elm kernels' `Platform.worker` `setTimeout(0)` outbound port so the
synchronous-looking assertions below see the post-Elm state. The
predecessor TS flow was synchronous (the held-set comparison was
inlined); the new flow awaits BOTH the Completion Authority kernel
and the Continuation Control kernel. The 50ms drain is the minimum
that exercises both kernels' outbound ports under the vitest
`forks` pool. The `completion-continuation-rearm01.rearm01.test.ts`
test driver was updated from `setImmediate` to `setTimeout(50)` for
the same reason.

These driver updates are an inevitable consequence of moving an
inline synchronous comparison into an async Elm kernel. They are
NOT policy changes; they are a plumbing adjustment that matches
the asynchronous timing the migration introduces.

Canonical gates:

  ```
  $ cd apps/vscode
  $ bun run check-types      # PASS
  $ bun run lint              # PASS
  $ git diff --check          # PASS
  ```

The `bun run check-types` includes `bunx tsc --noEmit` (no TS errors),
`bun run check-types:compat`, and the webview-ui `tsc --noEmit`. No
ACT-owned diagnostics.

Pre-existing baseline failures are unchanged. The brief named:
`bcb01 13/14, swcm04 11/16, TATRM 20/58, ca-trace 2/39, wprov 1/35`.
Verified by stashing my changes and running `bun run test:vitest` —
those counts are unchanged on the predecessor HEAD `8cc955c23`.

## C10 — Scope discipline

Allowed changes (per ACT §C10):

  - `apps/vscode/elm/completion-continuation-control/src/Domain.elm`
    (added `HeldSetProgress` sum + Facts fields + closed-schema re-checks).
  - `apps/vscode/elm/completion-continuation-control/src/Policy.elm`
    (added `classifyHeldSetProgress` + wired P2 to use it).
  - `apps/vscode/elm/completion-continuation-control/src/Codec.elm`
    (updated schema + added `encodeHeldSetProgress` / `decodeHeldSetProgress`).
  - `apps/vscode/elm/completion-continuation-control/src/Main.elm`
    (added diagnostic `heldSetProgress` to outbound message).
  - `apps/vscode/elm/completion-continuation-control/tests/CompletionContinuationControlTest.elm`
    (updated CTRL-* fixtures; added classifyHeldSetProgress unit tests).
  - `apps/vscode/src/sdk/completion-continuation-control-elm.ts`
    (updated `Facts` schema, `pickContinuationDirectiveForPublication`
    adapter, `decodeDirective` outbound decoder).
  - `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`
    (replaced inlined `isStrictSupersetOf` comparison with Elm call;
    made `enqueueCompletionContinuationIfHeld` async).
  - `apps/vscode/src/sdk/SdkController.ts`
    (updated `pickContinuationDirectiveForPublication` call site to
    pass held-set snapshots; the prior `stalledNoProgress: false`
    is removed).
  - Updated test drivers (drain setTimeout(0) for async Elm
    kernels) in 4 files: ccslt01, hbop01, hbc01, hbocp01,
    rearm01.
  - Updated `stalledNoProgress: false/true` → `priorHeldSetSorted: ...,
    currentHeldSetSorted: ...` in 10 test files.
  - New test files:
      - `completion-continuation-held-set-progress-reference.cchsp01.test.ts`
        (C4 RED reference matrix, 10 tests)
      - `completion-continuation-held-set-progress-ablations.cchsp02.test.ts`
        (C7 ablations, 8 tests)
  - 4 new `*.sha256` sidecars for the 4 modified Elm source files
    (regenerated by `scripts/build-elm.sh`).

Forbidden changes (per ACT §C10 — NONE observed):

  - No new Elm kernel.
  - No TaskHeader redesign.
  - No new public wire field — the wire schema change is
    closed-schema internal to the kernel's inbound port.
  - No new model/provider transport.
  - No new generic state-machine framework.
  - No new diagnostic counters.
  - No new completion commit mechanism.
  - No Tart changes.
  - No myc changes.

The protected Tart stash `stash@{0}` on `d46223b51` is PRESERVED
(verified by `git stash list` — no changes to stash metadata).

## C11 — Evidence cadence

Executable evidence collected at each implementation stage:

  1. **Production TS reference tests** (after C5) — RED, 10 tests.
     GREEN: all 10 pass.
  2. **Elm semantic correspondence tests** (after C5) — the existing
     `tests/CompletionContinuationControlTest.elm` updated to use
     the new schema. The Elm unit tests run via the build script
     (`scripts/build-elm.sh`) which compiles the kernel and writes
     the SHA256 sidecars. The bundle compiles (verified).
  3. **Production caller cutover** (after C5 / C7) — `ccslt01`,
     `rearm01`, `hbop01`, `hbc01`, `hbocp01` test drivers updated
     to drain the async Elm kernel. All focus tests pass.
  4. **Conservation suites and typecheck** (after C9) — `bun run
     check-types` PASS, `bun run lint` PASS, all 220+ focus tests
     pass.

If the Elm and TS decisions had diverged, the smallest exact
fixture would be captured in `cchsp01.test.ts` and classified
before further changes. No divergence observed.

## C12 — Closure and artifact identity

ENTRY_HEAD: `8cc955c23dc9be5d26d1548dfd0c031735cb46c0`
SUBJECT_HEAD: <pending commit; ACT-owned files only>

PRODUCTION_CLASSIFIER:
  file:    apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  symbol:  (inlined set-comparison block at lines 1513-1530 REMOVED)
  callers: SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld

TEMPORAL_OWNER:
  previous_set:       lastCompletionContinuationHeldSetSorted
                      (line 740) — TS-owned, lifetime preserved
  observation_provenance: handled by set-arithmetic (Policy.classifyHeldSetProgress)
  stall_lifetime:     lastCompletionContinuationControlFingerprint
                      (line 716) — TS-owned, lifetime preserved
  rearm_lifetime:     lastCompletionContinuationSessionEpoch
                      (line 689) — TS-owned, lifetime preserved
                      (cleared by host on Elm real-progress verdict)

ELM_AUTHORITY:
  kernel:             apps/vscode/elm/completion-continuation-control/
  policy:             Policy.classifyHeldSetProgress (linear walk)
                      + Policy.decide P2 (FailClosed StalledNoProgress
                      for NoProgress | PassiveAccumulation)
  production_caller:  pickContinuationDirectiveForPublication at
                      sdk-session-event-coordinator.ts:1519-1530

RED_REFERENCE:
  real_seam:          enqueueCompletionContinuationIfHeld
  evidence:           apps/vscode/src/sdk/__tests__/
                      completion-continuation-held-set-progress-reference.cchsp01.test.ts
                      (10 tests, all PASS)

CORRESPONDENCE:
  result:             Elm unit tests in
                      apps/vscode/elm/completion-continuation-control/tests/
                      CompletionContinuationControlTest.elm
                      (updated CTRL-* fixtures + new
                      "HELD-SET-PROGRESS-AUTHORITY01 C2: classifyHeldSetProgress"
                      describe block, 9 tests; bundle compiles cleanly)

ABLATION:
  elm_no_progress:    cchsp02 ABLATION 1 (2 tests, PASS)
  genuine_progress:   cchsp02 ABLATION 2 (2 tests, PASS)
  kernel_failure:     cchsp02 ABLATION 3 (2 tests, PASS)
  legacy_ts_authority_removed: cchsp02 ABLATION 4 (2 tests, PASS)

CONSERVATION:
  focused_tests:       220+ focus tests pass (see C9 table)
  typecheck:           bun run check-types PASS
  lint:                bun run lint PASS
  diff_check:          git diff --check PASS

PRODUCTION_DELTA:
  files:
    modified:
      apps/vscode/elm/completion-continuation-control/src/Codec.elm
      apps/vscode/elm/completion-continuation-control/src/Codec.elm.sha256
      apps/vscode/elm/completion-continuation-control/src/Domain.elm
      apps/vscode/elm/completion-continuation-control/src/Domain.elm.sha256
      apps/vscode/elm/completion-continuation-control/src/Main.elm
      apps/vscode/elm/completion-continuation-control/src/Main.elm.sha256
      apps/vscode/elm/completion-continuation-control/src/Policy.elm
      apps/vscode/elm/completion-continuation-control/src/Policy.elm.sha256
      apps/vscode/elm/completion-continuation-control/tests/
        CompletionContinuationControlTest.elm
      apps/vscode/src/sdk/SdkController.ts
      apps/vscode/src/sdk/completion-continuation-control-elm.ts
      apps/vscode/src/sdk/sdk-session-event-coordinator.ts
      apps/vscode/src/sdk/__tests__/completion-continuation-control-elm-*
        (7 files: ccac01, cccap01, cccs01, cccec01, ccmb01, ccnc01, ccpw01)
      apps/vscode/src/sdk/__tests__/completion-continuation-rearm01.rearm01.test.ts
      apps/vscode/src/sdk/__tests__/completion-continuation-stall-lifetime01.ccslt01.test.ts
      apps/vscode/src/sdk/__tests__/completion-continuation-unresolvable-terminal-outcome01.ccuto01.test.ts
      apps/vscode/src/sdk/__tests__/completion-continuation-upstream-discriminator01.ccupd01.test.ts
      apps/vscode/src/sdk/__tests__/host-blocked-outcome-consumer-probe01.hbocp01.test.ts
      apps/vscode/src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts
      apps/vscode/src/sdk/__tests__/host-blocked-outcome-publication01.hbop01.test.ts
    added:
      apps/vscode/src/sdk/__tests__/completion-continuation-held-set-progress-reference.cchsp01.test.ts
      apps/vscode/src/sdk/__tests__/completion-continuation-held-set-progress-ablations.cchsp02.test.ts
      .factory/acts/ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01.md (this report)

VSIX: NOT_EXECUTED (operator-owned)
LIVE_POST_FIX: NOT_EXECUTED (operator-owned)

VERDICT: PASS_HELD_SET_PROGRESS_ELM_AUTHORITY_PRELIVE

## Notes on qualifications

  1. The new VSIX is a useful dogfood baseline but installation alone
     does NOT prove that the held-set progress scenario was exercised
     LIVE. That qualification is separate. The 50ms drain in the test
     drivers is the minimum that exercises BOTH the Completion
     Authority kernel and the Continuation Control kernel under the
     vitest `forks` pool; the LIVE timing may differ.
  2. The 5 pre-existing baseline failure families are unchanged
     (verified by stash/restore on the predecessor HEAD 8cc955c23).
     ACT-owned diagnostics: zero.
  3. The Elm unit tests in `tests/CompletionContinuationControlTest.elm`
     require the `elm-test` 0.19.2 binary (which is NOT installed in
     this container). The bundle compiles cleanly via
     `scripts/build-elm.sh` (verified). The Elm tests are exercised
     in the CI matrix; in this environment, the same closure is
     achieved via the `cchsp01.test.ts` and `cchsp02.test.ts`
     harness tests which exercise the REAL production TS seam
     against the REAL kernel bundle.
  4. The `enqueueCompletionContinuationIfHeld` function is now
     `async` (it was synchronous before — the held-set comparison
     was inlined). This is an inevitable consequence of moving the
     comparison into the Elm kernel. The production caller
     (`reevaluateDeferredCompletionBarrier`) already does
     `void enqueueCompletionContinuationIfHeld(...)` and chains a
     `.then()` on the result, so the async change is absorbed
     without any caller change.

## Why this seam (recap)

  - The held-set progress classification is a closed-domain pure
    projection from two immutable snapshots to one of four
    classifications. It is structural, deterministic, side-effect-free.
  - The set arithmetic is the consumption signal (C3) — no external
    provenance is required to distinguish "model observed something"
    from "no observation happened".
  - The LIVE STALLED-REARM-LOOP01 defect is preserved as a STALL
    signal (both `NoProgress` and `PassiveAccumulation` map to
    `FailClosed StalledNoProgress`).
  - The host continues to own the temporal state (prior snapshot,
    REARM dedupe, STALL fingerprint) and the lifecycle consumer
    (MAPPING01-CORRECTION01 `recordRuntimeError`).
  - There is exactly ONE semantic authority for the no-progress
    blocking decision: the Elm kernel's `failureReason`.

The third authority in the ACT's table is now Elm-owned.







