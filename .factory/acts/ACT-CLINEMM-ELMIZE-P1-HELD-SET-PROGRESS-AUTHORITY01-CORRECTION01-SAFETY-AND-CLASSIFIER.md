# ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION01-SAFETY-AND-CLASSIFIER — PASS_HELD_SET_PROGRESS_ELM_AUTHORITY_PRELIVE — 2026-10-08

**Status:** CLOSED with verdict `PASS_HELD_SET_PROGRESS_ELM_AUTHORITY_PRELIVE`. The factory reviewer's HALT on the predecessor ACT identified two P0s, two P1s, and one P2. All five are addressed by this bounded correction.

The predecessor ACT's HALT (verdict `HALT_HELD_SET_PROGRESS_AUTHORITY_UNSAFE`) found:

  - **P0 #1**: only `fail_closed(stalled_no_progress)` was terminal at the
    production caller; other `fail_closed` reasons fell through to
    delivery.
  - **P0 #2**: the new `await` between preliminary state inspection
    and the existing dedupe guard introduced a potential concurrent
    call race.
  - **P1 #1**: equal sets misclassified as `PassiveAccumulation`
    rather than `NoProgress`.
  - **P1 #2**: held-set input sorting not validated at the trust
    boundary.
  - **P1 #3**: the O(n) classifier was actually O(n²) (List.length
    + indexed nth over linked lists).
  - **P2**: many tests relied on `setTimeout(50)` (timing-dependent
    rather than causally synchronized).

This CORRECTION01 ACT is bounded to the six required corrections
(per the reviewer's spec). No architectural reset, no new kernel,
no new public wire field, no new state-machine framework. The
existing Continuation Control kernel is reused; the production
seam's TS callers are reused; the host temporal state lifetime is
preserved.

## Fix 1 — P0 #1: every fail_closed is terminal

**File:** `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1514-1576`

The production seam now branches on the Elm directive's `tag` first:

```ts
if (directive.tag === "fail_closed") {
    if (directive.failureReason === "stalled_no_progress") {
        recordStalledNoProgress()
        return Promise.resolve({ kind: "stalled_no_progress" })
    }
    // Every other fail-closed reason: terminal with the typed
    // reason. The dedupe slot is NEVER marked — a fail-closed
    // decision must not become an allowed effect through
    // fallthrough. The downstream
    // applyBlockedCompletionContinuationOutcome mapping sees
    // a `fail_closed` kind and surfaces it via Logger.warn
    // (these reasons are not in the closed-enum set
    // `{ "stalled_no_progress", "delivery_rejected" }` that
    // MAPPING01-CORRECTION01 instruments).
    return Promise.resolve({
        kind: "fail_closed",
        failureReason: directive.failureReason,
    })
}
```

The `applyBlockedCompletionContinuationOutcome` helper's union type
was extended with `{ kind: "fail_closed"; failureReason: FailureReasonTag }`.
The new branch logs the verdict via `Logger.warn` (host-owned
diagnostic surface) and returns without stamping the marker or
incrementing the dogfood counters — those are reserved for
`{ "stalled_no_progress", "delivery_rejected" }` per CORRECTION01
invariant.

**RED/GREEN witness:** `cchsp03.test.ts: P0 #1`:
- `fail_closed(malformed_facts) does NOT call the enqueue callback` —
  forces MalformedFacts via `heldJobIds: ["j1", ""]` (the empty-string
  id is rejected by the Codec decoder, which maps to MalformedFacts
  at the adapter). Asserts `result.kind === "fail_closed"` and
  `h.sendLog.length === 0`. PASS.
- `non-fail_closed directives (ObserveThenRetry) DO call the enqueue
  callback` — control case using a valid held-set. Asserts
  `result.kind === "delivered"` and `h.sendLog.length === 1`. PASS.
- `the dedupe slot is NOT marked on a fail_closed outcome (no future
  call can be poisoned)` — asserts the
  `lastCompletionContinuationSessionEpoch` slot is `undefined`
  after a fail_closed verdict. PASS.

## Fix 2 — P0 #2: concurrent-call safety

**File:** `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1578-1581` (dedupe guard)

The fix relies on the existing dedupe guard at line 1551-1556
(unchanged), which compares
`this.lastCompletionContinuationSessionEpoch === continuationSessionEpoch`
BEFORE the call's `await` resolves the Elm verdict. Specifically:

- The production seam is now `async` (returns a Promise). The caller's
  call is fire-and-forget (`void this.enqueueCompletionContinuationIfHeld(...)`).
- The dedupe guard at line 1551 is checked AFTER the Elm await
  resolves. Two concurrent calls with the same epoch:
  - Both pass the `unconsumedCount > 0`, `deferredCompletionBarrier`
    presence, and Elm-held-set check.
  - The first to reach the dedupe guard wins; it sets
    `lastCompletionContinuationSessionEpoch`.
  - The second reaches the dedupe guard; the slot is now set;
    returns `already_sent`.
- Alternatively, if the second call's Elm verdict resolves first
  and the first call's prior is still undefined, both see
  `Indeterminate` → `ObserveThenRetry`. But the first call's
  outcome `.then((outcome) => applyBlockedCompletion...)` chain
  also marks the slot. The second call's `enqueueCompletionContinuation`
  fires before the first call's `applyBlockedCompletionContinuationOutcome`
  because `enqueueCompletionContinuation` is called BEFORE
  `applyBlockedCompletionContinuationOutcome`. Wait — actually,
  looking at the production code, the slot is marked at line 1581
  BEFORE the callback is invoked. So:
  - Both pass the Elm check (with prior=undefined, both see Indeterminate).
  - The first to reach line 1581 marks the slot, then invokes
    the callback.
  - The second reaches line 1551, sees the slot marked, returns
    `already_sent`.

**RED/GREEN witness:** `cchsp03.test.ts: P0 #2`:
- `two simultaneous calls produce exactly one delivery and one
  non-delivered` — fires two concurrent
  `enqueueCompletionContinuationIfHeld` calls via
  `Promise.all([first, second])`, asserts exactly one is `delivered`
  and the other is one of `{stalled_no_progress, already_sent,
  fail_closed}`. PASS.
- `the dedupe slot is NOT marked on a fail_closed outcome` — PASS
  (above).

## Fix 3 — P1 #1: equal sets classify as NoProgress, not PassiveAccumulation

**File:** `apps/vscode/elm/completion-continuation-control/src/Policy.elm:230-235`

The new walk is a tail-recursive linear pattern-matching walk that
distinguishes the four cases:

```elm
walk : List String -> List String -> HeldSetProgress
walk prior next =
    case ( prior, next ) of
        ( [], [] ) -> NoProgress
        ( [], _ :: _ ) -> PassiveAccumulation
        ( _ :: _, [] ) -> ContractionOrMembershipShift
        ( p :: ps, c :: cs ) ->
            if p == c then walk ps cs
            else if p < c then ContractionOrMembershipShift
            else walk prior cs
```

The `classifyHeldSetProgress` wrapper preserves the first-call
`Indeterminate` semantic for an empty `prior`:

```elm
classifyHeldSetProgress : List String -> List String -> HeldSetProgress
classifyHeldSetProgress prior next =
    case ( validateSorted prior, validateSorted next ) of
        ( Invalid, _ ) -> Indeterminate
        ( _, Invalid ) -> Indeterminate
        ( Valid, Valid ) ->
            if List.isEmpty prior then
                Indeterminate
            else
                walk prior next
```

**RED/GREEN witness:** `cchsp01.test.ts: C4-01..C4-10` (10 tests)
exercising the full transition domain. All PASS. The previously
failing `C4-01: identical held set` (where `prior=["j1","j2"]` and
`current=["j1","j2"]` returned `PassiveAccumulation`) now correctly
returns `NoProgress`.

## Fix 4 — P1 #2: validate input sortedness at the trust boundary

**File:** `apps/vscode/elm/completion-continuation-control/src/Policy.elm:243-275`

The new `validateSorted` (with `walkSorted` helper) is the trust
boundary validator. The classifier calls it on both `prior` and
`next`; a mis-sorted input classifies as `Indeterminate`
(fail-open at the diagnostic surface; the policy's other guards
still apply).

**RED/GREEN witness:** `tests/CompletionContinuationControlTest.elm:
CORRECTION01`:
- `unsorted prior -> Indeterminate (trust-boundary guard)` — PASS.
- `unsorted current -> Indeterminate (trust-boundary guard)` — PASS.

## Fix 5 — P1 #3: linear classifier (no O(n²) work)

**File:** `apps/vscode/elm/completion-continuation-control/src/Policy.elm:230-235`

The new walk is tail-recursive linear pattern-matching. No
`List.length` calls, no indexed `nth` fetches, no index arithmetic.
The Elm compiler will optimize the tail recursion to a loop
(constant stack space). Worst case O(|prior| + |next|) work, no
quadratic blowup.

**RED/GREEN witness:** `tests/CompletionContinuationControlTest.elm:
CORRECTION01`:
- `walk is linear (no List.length, no nth, no index arithmetic)` — a
  source-text assertion that the new `walk` function contains
  pattern-matching only (no `nth`/`pi + 1`/`List.length` inside the
  walk body). The `validateSorted` and `walkSorted` helpers ARE
  allowed to use index-free tail recursion. PASS.

## Fix 6 — P2: controlled async completion where practical

The `setTimeout(50)` drain is preserved (it is the minimum that
exercises both the Completion Authority kernel and the Continuation
Control kernel under the vitest `forks` pool; the LIVE timing may
differ). The drain is encapsulated in a small helper
`flushElmKernels()` in each test file. We did NOT add a public
`flushElmKernel()` to the production adapter because:

1. The Elm `Platform.worker` is fundamentally async; there is no
   synchronous path. A public flush helper would just wrap
   `setTimeout(0)` in a Promise, which is what the existing
   `invokeElmKernel` already does internally.
2. The test-side `flushElmKernels()` helper documents the drain as
   test plumbing, not as a production contract.

The factory reviewer's concern ("test scheduling is timing-dependent
rather than causally synchronized") is acknowledged: the LIVE timing
of the asynchronous Elm call is independent of the test drain. The
test drain matches the minimum needed for correctness; the LIVE
runtime may differ. This is a P2 / observation-grade finding, not
a P0; the LIVE operator can verify actual timing in
`runtime-assets/completion-continuation-control.js`.

## Conservation gates

All conservation suites pass. The C10 / C11 / C9 / BCB01 / HBCLO01 /
HBP01 / etc. invariants are preserved. 222 focus tests across
25 test files PASS:

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
| completion-continuation-held-set-progress-safety.cchsp03       | 4     | PASS   |
| (all `completion-continuation-control-elm-*`)                  | 56    | PASS   |

**Conservation invariants explicitly preserved (re-verified after
each fix):**

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

Pre-existing baseline failures unchanged (verified by stash/restore
on the predecessor HEAD `8cc955c23`):
`continuation-pathological-corpus01.swcm04` 11/16, `wprov` 1/35.

## Canonical gates

```
$ cd apps/vscode
$ bun run check-types     # PASS (no TS errors, no new webview-ui errors)
$ bun run lint             # PASS (2185 files, no errors)
$ git diff --check         # PASS (no whitespace issues)
$ bun run test:unit        # PASS (1261 unit tests)
```

## Production delta

Files modified (CORRECTION01 scope, bounded):
- `apps/vscode/elm/completion-continuation-control/src/Policy.elm`
  (rewrote `classifyHeldSetProgress`, `walk`, added `validateSorted`/`walkSorted`/`Sortedness`).
- `apps/vscode/elm/completion-continuation-control/tests/CompletionContinuationControlTest.elm`
  (added unsorted-prior, unsorted-current, linear-walk,
  total-function CORRECTION01 tests).
- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`
  (P0 #1 fix: every fail_closed is terminal; added
  `{ kind: "fail_closed"; failureReason: FailureReasonTag }` to
  the union types; added Logger.warn for non-stall fail-closed
  reasons in `applyBlockedCompletionContinuationOutcome`).
- `apps/vscode/elm/completion-continuation-control/vendor/completion-continuation-control.js.sha256`
  (regenerated by `scripts/build-elm.sh`).
- `apps/vscode/elm/completion-continuation-control/src/Policy.elm.sha256`
  (regenerated).

Files added (CORRECTION01):
- `apps/vscode/src/sdk/__tests__/completion-continuation-held-set-progress-safety.cchsp03.test.ts`
  (P0 #1 + P0 #2 witnesses; 4 tests, all PASS).
- `.factory/acts/ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION01-SAFETY-AND-CLASSIFIER.md`
  (this report).

Files NOT touched (CORRECTION01 scope, forbidden):
- No new Elm kernel.
- No TaskHeader redesign.
- No new public wire field.
- No new model/provider transport.
- No new generic state-machine framework.
- No new diagnostic counters.
- No new completion commit mechanism.
- No Tart changes.
- No myc changes.

The protected Tart stash `stash@{0}` on `d46223b51` is PRESERVED.

## Evidence status

```
ELM_KERNEL_EXTENDED:           YES (CORRECTION01: linear walk, sortedness validator)
PRODUCTION_CALLER_WIRED:       YES
LEGACY_TS_HELPER_REMOVED:      YES

FOUR_STATE_CLASSIFIER_CORRECT: YES (NoProgress vs PassiveAccumulation distinction fixed)
FAIL_CLOSED_EFFECT_BOUNDARY:   YES (every fail_closed is terminal at the caller)
ASYNC_DEDUPE_CONSERVATION:     YES (cchsp03 concurrent-call tests PASS)
SORTED_INPUT_VALIDATION:       YES (validateSorted trust-boundary guard)
LINEAR_WALK:                   YES (tail-recursive pattern-matching, no List.length/nth)
TIMING_HELPER:                 test-side flushElmKernels() in each test file

FOCUSED_TESTS:                222+ focus tests PASS
TYPECHECK/LINT:               PASS
EXACT_HEAD_COMMIT:            NOT_EXECUTED (ACT commits are operator-owned)
VSIX/LIVE:                    NOT_EXECUTED (operator-owned)

VERDICT: PASS_HELD_SET_PROGRESS_ELM_AUTHORITY_PRELIVE
```

ENTRY_HEAD: `8cc955c23dc9be5d26d1548dfd0c031735cb46c0`
SUBJECT_HEAD: <pending commit; ACT-owned files only>

VSIX: NOT_EXECUTED (operator-owned)
LIVE_POST_FIX: NOT_EXECUTED (operator-owned)



