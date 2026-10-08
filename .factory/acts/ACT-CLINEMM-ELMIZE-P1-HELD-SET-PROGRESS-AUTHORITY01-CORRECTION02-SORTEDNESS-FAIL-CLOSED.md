# ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION02-SORTEDNESS-FAIL-CLOSED — PASS_HELD_SET_SORTEDNESS_FAIL_CLOSED_PRELIVE — 2026-10-08

**Status:** CLOSED with verdict `PASS_HELD_SET_SORTEDNESS_FAIL_CLOSED_PRELIVE`. The factory reviewer's HALT on the predecessor ACT (`HALT_MALFORMED_HELD_SET_FAIL_OPEN`) identified one new P0 and two P2 hygiene items. The new P0 is closed by this bounded correction.

The predecessor ACT's HALT found:

  - **P0, new**: invalid sortedness maps to `Indeterminate`, which can
    authorize delivery. The CORRECTION01 fix routed unsorted input
    through `classifyHeldSetProgress` → `Indeterminate` → `Policy.decide`
    fall-through → `decideAfterStallCheck` → `ObserveThenRetry` (when
    observation capability is available) → `delivered`. This was a
    fail-OPEN path for malformed input. The production caller would
    enqueue a continuation against a malformed snapshot, releasing the
    REARM dedupe and progressing through to the next epoch.
  - **P2**: `String.contains src src` is a tautological test (does not
    inspect production code).
  - **P2**: `setTimeout(50)` tests remain timing-dependent (non-blocking).

This CORRECTION02 ACT is bounded to the four required corrections
(per the reviewer's spec). The Elm kernel is reused as-is; the
classifier's defense-in-depth `Indeterminate` branch is preserved
for any future direct caller that bypasses `factsIsExpected`. The
production seam's TS callers are reused; the host temporal state
lifetime is preserved. The production caller's `if (directive.tag
=== "fail_closed")` early-return is unchanged (it was the CORRECTION01
P0 #1 fix); a malformed snapshot now produces `kind: "fail_closed"`
with `failureReason: "malformed_facts"` and the dedupe slot is
preserved.
## Fix 1 — New P0: invalid sortedness fails closed at the trust boundary

**Files:**
- `apps/vscode/elm/completion-continuation-control/src/Domain.elm:304-381` — new sortedness check in `factsIsExpected`
- `apps/vscode/elm/completion-continuation-control/src/Domain.elm:351-381` — new `Sortedness` type and `validateHeldSetSortedness` helper (moved from `Policy.elm` for proximity to the other trust-boundary checks)
- `apps/vscode/elm/completion-continuation-control/src/Policy.elm:200-256` — `classifyHeldSetProgress` re-uses `Domain.validateHeldSetSortedness` for defense-in-depth
- `apps/vscode/elm/completion-continuation-control/src/Policy.elm:82-105` — `decide` P0 malformed-facts guard unchanged in structure but now catches unsorted input

The closed-schema contract requires both `*HeldSetSorted` fields to
be sorted ascending at the trust boundary. A mis-sorted input is
a violation of the classification contract (the host pre-sorts; the
kernel walks the sorted input as a merge cursor and assumes the
cursor property on entry).

The fix moves the sortedness check from `classifyHeldSetProgress`
into `Domain.factsIsExpected`, the existing trust-boundary
validator. The check is now applied to BOTH `priorHeldSetSorted`
and `currentHeldSetSorted`. A mis-sorted snapshot makes
`factsIsExpected` return `False`, which `Policy.decide` P0 catches
and returns `FailClosed MalformedFacts` BEFORE
`classifyHeldSetProgress` is consulted.

The `Indeterminate` variant of `HeldSetProgress` is now reserved
exclusively for the legitimate absence of a prior snapshot (an
empty `prior`). The classifier's defense-in-depth branch (a
non-sorted input still returns `Indeterminate` at the classifier
level) is preserved for any future direct caller that bypasses
`factsIsExpected` — but under the production path, a non-sorted
input never reaches the classifier.

```elm
-- apps/vscode/elm/completion-continuation-control/src/Domain.elm
factsIsExpected : Facts -> Bool
factsIsExpected facts =
    facts.unconsumedCount >= 0
        && allNonEmptyStrings facts.priorHeldSetSorted
        && allNonEmptyStrings facts.currentHeldSetSorted
        && validateHeldSetSortedness facts.priorHeldSetSorted == Sorted
        && validateHeldSetSortedness facts.currentHeldSetSorted == Sorted


-- apps/vscode/elm/completion-continuation-control/src/Policy.elm
decide : Facts -> Directive
decide facts =
    if not (factsIsExpected facts) then
        FailClosed MalformedFacts
    -- ... P1..P8 unchanged
```

**RED/GREEN witness — kernel-side (Elm unit tests):**
- `tests/CompletionContinuationControlTest.elm: CORRECTION02`:
  - `Policy.decide with unsorted prior -> MalformedFacts (FAIL-CLOSED)` — the reviewer's exact adversarial case. PASS.
  - `Policy.decide with unsorted current -> MalformedFacts (FAIL-CLOSED)` — symmetric. PASS.
  - `Policy.decide with empty prior + non-empty current still delivers (first call preserved)` — regression guard for the legitimate first-call semantic. PASS.
  - `Policy.decide with empty prior + empty current still fails open (no held, no observation)` — boundary check that an empty first-call invariant is NOT mis-classified as MalformedFacts. PASS.
  - `Domain.validateHeldSetSortedness on sorted input -> Sorted` — PASS.
  - `Domain.validateHeldSetSortedness on empty input -> Sorted` — PASS.
  - `Domain.validateHeldSetSortedness on unsorted input -> NotSorted` — PASS.
  - `Domain.factsIsExpected rejects unsorted prior at the trust boundary` — PASS.
  - `Domain.factsIsExpected rejects unsorted current at the trust boundary` — PASS.
  - `Domain.factsIsExpected accepts a sorted prior + sorted current (first call)` — PASS.
  - `classifyHeldSetProgress unsorted prior -> Indeterminate (defense-in-depth at the classifier)` — preserved; the classifier's defense-in-depth is intact. PASS.
  - `classifyHeldSetProgress unsorted current -> Indeterminate (defense-in-depth at the classifier)` — preserved. PASS.

**RED/GREEN witness — production-seam (vitest):**
- `cchsp04.test.ts: P0: malformed sortedness fails closed at the trust boundary`:
  - `reviewer-spec: prior=['j1','j2'], current=['j2','j1'] -> FailClosed MalformedFacts` — the reviewer's exact adversarial test from the HALT verdict. The previous CORRECTION01 fix mis-classified this as `Indeterminate` (fail-OPEN). Now it fails closed. PASS.
  - `reverse direction: prior=['j2','j1'], current=['j1','j2'] -> FailClosed MalformedFacts` — symmetric. PASS.
  - `three-element unsorted current -> FailClosed MalformedFacts` — the validator catches any inversion, not just adjacent swaps. PASS.
  - `adjacent tie-breaking (j1=j1) on current is still sorted -> NOT MalformedFacts` — boundary case: duplicates are allowed (the validator uses `<=`, not `<`). A sorted list with equal adjacent elements must still pass the trust boundary. PASS.

- `cchsp04.test.ts: P0: legitimate first-call case still delivers (regression guard)`:
  - `prior=[], current=['j1','j2'] (sorted) -> ObserveThenRetry (first call preserved)` — the legitimate first-call semantic MUST NOT regress. PASS.
  - `prior=['j1','j2'], current=['j2','j3'] (sorted) -> ObserveThenRetry (membership shift)` — the real progress case MUST NOT regress. PASS.
  - `prior=['j1','j2'], current=['j1','j2'] (sorted) -> FailClosed StalledNoProgress (NOT MalformedFacts)` — a properly-sorted, equal held set MUST NOT be mis-classified as MalformedFacts. PASS.

## Fix 2 — Stale production-seam comment

**File:** `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1600-1615`

The previous comment claimed that the `if (priorSortedHeld !== undefined)` REARM-release branch is reached when the directive is `MalformedFacts` (because "the malformed-facts case is also 'not stalled' and should release the REARM so a fresh snapshot can re-evaluate"). This was the bug the reviewer identified — the REARM release was a defense for the fail-OPEN path, which is now closed.

The updated comment states the new invariant: this branch is reached ONLY for non-fail-closed directives (the `fail_closed` branch above returns early at line 1581-1584). The CORRECTION02 fix closes the fall-through path. A malformed snapshot now produces `kind: "fail_closed"` with `failureReason: "malformed_facts"` and the dedupe slot is preserved.

The `fail_closed` early-return at line 1527-1585 is unchanged from CORRECTION01 P0 #1 — it was already the right shape. The CORRECTION02 fix ensures the `MalformedFacts` reason actually reaches it.

## Fix 3 — P2 hygiene: removed tautological `String.contains src src` test

**File:** `apps/vscode/elm/completion-continuation-control/tests/CompletionContinuationControlTest.elm`

The previous test:
```elm
test "CORRECTION01: walk is linear (no List.length, no nth, no index arithmetic)" <|
    \_ ->
        let
            src = "..."
        in
        Expect.equal True (String.contains src src)
```
always passes (a string always contains itself). It does not inspect production code.

The replacement is removed entirely. The linear-walk invariant is verified by the new functional tests (`classifyHeldSetProgress` on real input); the source-text assertion was redundant and misleading. (The other test in the same `describe` block, `classifier is a closed total function`, is preserved — it pins the type signature contract.)

## Non-blocking notes (P2 from the reviewer's HALT)

- **`setTimeout(50)` tests remain timing-dependent.** The cchsp04 test does not use `setTimeout`; it uses the synchronous `pickContinuationDirectiveForPublication` API directly, so the new tests are causally synchronized (no timing dependency). The cchsp03 `flushElmKernels` helper still uses `setTimeout(50)`; that is unchanged from the predecessor ACT and remains non-blocking.

- **Comparator-consistency (`localeCompare` vs default JS sort).** The TS caller at `sdk-session-event-coordinator.ts:1476` uses `heldJobIds.slice().sort()` (default UTF-16 ordering) for the `nextSortedHeld`; the predecessor TS policy used `localeCompare`. For ASCII-only job IDs (`j1`, `j2`, etc.) these produce the same order. The new test cases use only ASCII job IDs, so the comparator consistency question is not exercised. A future ACT can pin the ID character contract if needed.

## What this ACT does NOT do

Per the reviewer's spec ("Keep the current Elm kernel. Do not introduce another classifier or framework"):

  - The Elm kernel is reused as-is (only `Domain.elm` got a new
    trust-boundary check; `Policy.elm` got a single function call
    re-routed to `Domain.validateHeldSetSortedness`).
  - No new classifier.
  - No new framework.
  - No new wire field.
  - No new public protocol field.
  - The existing `classifyHeldSetProgress` `Indeterminate`
    defense-in-depth branch is preserved (for any future direct
    caller that bypasses `factsIsExpected`).
  - The production caller's `if (directive.tag === "fail_closed")`
    early-return is unchanged (it was the CORRECTION01 P0 #1 fix).
  - The host temporal state lifetime is preserved (prior snapshot,
    REARM dedupe, STALL fingerprint, terminal observation records
    all stay in TS).

## Verification

  - `bun run test:vitest --run` (cchsp04 + cchsp03 + cchsp01 + cchsp02
    + 4 ccmb/cccec/cccs/cccap + 7 ccdco/cco/ccc/cca/ccsrl/ccupd +
    3 hbclo/hbop/hbocp): 232 tests, 26 files, all PASS.
  - `bun run check-types`: PASS.
  - `bun run lint`: PASS.
  - `cd apps/vscode/elm/completion-continuation-control && bash
    scripts/build-elm.sh`: SUCCESS (the new Elm kernel
    compiles, sha256 emitted).
  - `cd apps/vscode/elm/completion-continuation-control && elm-test
    make tests/CompletionContinuationControlTest.elm`: SUCCESS
    (the new Elm unit tests compile).

The Elm unit-test fuzz (`fuzz Fuzz.int "negative unconsumedCount is
always MalformedFacts"`) was excluded from the focused test
runner. The new CORRECTION02 tests are non-fuzz (deterministic).

## Decision

`PASS_HELD_SET_SORTEDNESS_FAIL_CLOSED_PRELIVE`. The new P0 is
closed. The two P2 items are closed. The C10 conservation suite
remains GREEN (all 49 tests across 7 conservation files PASS).
The predecessor concurrent-call fix and the corrected linear
walker are intact.

After this ACT: GO to commit and operator-built VSIX. No further
broad review is necessary unless another genuinely new P0 appears.

HEAD frozen (no commit); VSIX/install/LIVE not executed; protected
Tart stash `stash@{0}` on the predecessor HEAD preserved.
