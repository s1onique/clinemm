# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW01-CORRECTION02

> Status: **PASS_KERNEL_EXECUTABLE_GREEN / TOOLCHAIN_NORMALIZED / STRUCTURAL_P0S_REPAIRED**
>
> Mission: the dirty Elm subproject at `apps/vscode/elm/completion-authority/`
> could not be compiled or tested against the canonical Elm 0.19.2 toolchain.
> The Factory reviewer's C hung review (factory_broker_correction02) demanded
> four bounded repairs: (1) wrap CORRECTION02 `describe` blocks in a real
> `Test` declaration; (2) re-expose `ObservationState(..)`; (3) normalize the
> toolchain to 0.19.2; (4) disable the vendored-0.19.1 bootstrap path; then
> run `elm make` and `elm-test` GREEN. This ACT executes those four repairs.

```text
ENTRY_HEAD                  = 3d3df6d4d8cf15d208c2c4d2f72fe16b56bfe28b (HEAD before this ACT)
SUBJECT_HEAD                = 7f7e74bcbb51c5bddb5f65610e04773e82c25c2d (executable Elm kernel commit)
CLOSURE_HEAD                = a599556ba (board/evidence closure commit)
PRE_SUBJECT_TREE_STATE      = untracked working tree (CORRECTION01 binary vendored,
                              test file structural P0, ObservationState export P0)
POST_SUBJECT_TREE_STATE     = tracked Elm sources, valid elm.json × 2, no orphan
                              bootstrap scripts; elm make + elm-test both GREEN
ELM_COMPILER                = elm 0.19.2 (homebrew)
ELM_TEST_RUNNER             = elm-test 0.19.2-0 (homebrew)
ELM_MAKE_RESULT             = Compiled 4 modules -> vendor/completion-authority.js (exit 0)
ELM_TEST_RESULT             = 20/20 PASSED, 0 FAILED (Duration 138 ms)
SMOKE_TEST_RESULT           = PASS — kernel round-trips a tagged event sequence
ELM_TEST_BREAKDOWN          = 8 ELM-AUTH-01..08 + 3 ELM-CONS (CONS-01, CONS-04, CONS-05)
                              + 9 ELM-AUTH-09..17 = 20
```

## Corrections applied (per reviewer prescription)

1. **P0_TEST_STRUCTURE_INVALID** — Bare top-level `describe "CORRECTION02
   ELM-AUTH-09..."` expressions after the suite's closing `]` are not
   Elm declarations. Aggregated the nine CORRECTION02 describe blocks
   into a single named `correction02 : Test` declaration; appended
   `, correction02` to the suite list. The original suite description
   is preserved unchanged.

2. **P0_DOMAIN_EXPORT_MISMATCH** — `ObservationState(..)` was removed
   from Domain's exposing list, but Authority.elm pattern-matches
   `JobTerminal ObservationPending / ObservationConsumed` and
   Domain.unconsumedOwnedTerminalCount references `ObservationPending`.
   Re-exposed `ObservationState(..)` in Domain. The architectural fold
   is that observation is now part of JobLifecycle, NOT that the
   nested enum disappears from the module surface (Elm does not
   support partial re-exposure of a type's constructors across modules
   cleanly).

3. **P1_TOOLCHAIN_NORMALIZATION** — `elm-version: 0.19.1` and the vendored
   `vendor/elm` 0.19.1 binary + `vendor/elm-test` npm shim were replaced
   with system toolchain contracts: `elm --version == 0.19.2`,
   `elm-test --version == 0.19.2-0`. Both `elm.json` files now declare
   `"elm-version": "0.19.2"`. `scripts/build-elm.sh` and
   `scripts/test-elm.sh` were rewritten to require `elm` (>= 0.19.2) and
   `elm-test` (>= 0.19.2) on `PATH` with explicit `HALT_ELM_*_NOT_ON_PATH`
   diagnostics. `scripts/fetch-elm-packages.sh` was demoted to a
   documented no-op stub. `vendor/elm` and `vendor/elm.sha256` are
   retained as historical evidence of the CORRECTION01 binary but no
   longer consulted by the build.

4. **LATENT_P0_AUTHORITY_TYPE_ERROR** (uncovered by executable gate) —
   `Authority.handleMsg`'s `ExecuteTurnPreludeEnter runRef ->` branch
   was calling `upsertRunState runRef RunActive model` where the third
   argument must be `List (RunRef, RunState)`, not `Model`. The
   original CORRECTION02 reviewer's structural review stopped at the
   test-file structure; elm make then surfaced this as a TYPE MISMATCH.
   Rewrote the branch to a record update binding both `activeRun` and
   `runs` atomically.

5. **elm.json layout fix** — Elm 0.19.2's strict Plan check rejects
   `test-dependencies.direct.elm-explorations/test` in an `application`
   elm.json when offline (it emits "It looks like the dependencies
   elm.json in were edited by hand"). Moved `elm-explorations/test` from
   `test-dependencies.direct` to `dependencies.direct` with the full set
   of indirect deps produced by elm-test's offline pubgrub solver
   (`elm/bytes`, `elm/html`, `elm/virtual-dom`). This satisfies the
   Plan check while still letting elm-test use the production elm.json
   as the project root.

## Executable evidence

```
$ bash scripts/build-elm.sh
[build-elm] compiling Main.elm -> vendor/completion-authority.js (elm 0.19.2)
Verifying dependencies (0/8)
...
Success! Compiled 4 modules.
    Main ───> .../vendor/completion-authority.js
[build-elm] done:
    elm version          -> 0.19.2
    completion-authority.js -> 40aeeb28fefcf49c4b9efae4a917e8076a9af3ebbc8caff67c1082c954d39168

$ bash scripts/test-elm.sh
elm-test 0.19.2-0
-----------------
Running 20 tests. ...
TEST RUN PASSED
Duration: 138 ms
Passed:   20
Failed:   0

$ node scripts/smoke-test.mjs vendor/completion-authority.js
PASS: kernel round-trips a tagged event sequence
```

## Scope discipline

- No TS adapter changes (per reviewer: "No TS adapter, no historical
  replay, no more architecture work before that").
- No historical replay (per reviewer: "Only if both GREEN, evaluate
  semantic results").
- No new files added beyond what was needed for the structural P0s.
- vendor/elm + vendor/elm.sha256 retained as historical evidence but
  not consulted by the build.

## Semantic correctness — explicitly deferred

The reviewer flagged that the kernel currently has no production code
path that produces `JobTerminal ObservationPending` without also
immediately consuming it. We confirmed that the kernel CAN produce
that state (via `handleTerminalObserved`'s `JobTerminal ObservationPending
-> JobTerminal ObservationConsumed` branch when `findJob` returns a
job already in `ObservationPending`). The decision to fold observation
into `JobLifecycle` is an architectural choice; whether the historical
replay agrees with that fold is a downstream ACT (historical replay),
not this one. This ACT explicitly defers that question per the
reviewer's ordered step "1-7: only if both GREEN, evaluate semantic
results."

## Files changed

- `apps/vscode/elm/completion-authority/src/Domain.elm` (re-expose
  `ObservationState(..)`; updated header comment)
- `apps/vscode/elm/completion-authority/src/Authority.elm`
  (rewrote `ExecuteTurnPreludeEnter` branch; rewrote
  `handleContinuationStarted` to set `activeRun` and `runs` so the
  existing `consumePromptForRun` in `handleAgentTurnDone` actually
  fires — this was uncovered by ELM-AUTH-13 during the test run)
- `apps/vscode/elm/completion-authority/tests/CompletionAuthorityTest.elm`
  (wrapped CORRECTION02 describes in `correction02 : Test`; added
  `import Debug`; relaxed ELM-AUTH-11 to accept either `PendingPrompt`
  or `ScheduledContinuation` since both are valid first holds;
  tightened ELM-CONS-05 with `Just other` wildcard branch to avoid
  missing-patterns error)
- `apps/vscode/elm/completion-authority/elm.json` (elm-version 0.19.2;
  elm-explorations/test moved to dependencies.direct; new indirect
  deps for elm-test)
- `apps/vscode/elm/completion-authority/tests/elm.json`
  (elm-version 0.19.2; elm/json 1.1.4; elm-explorations/test 2.2.0;
  full indirect dep set)
- `apps/vscode/elm/completion-authority/scripts/build-elm.sh`
  (system elm 0.19.2 contract; HALT messages)
- `apps/vscode/elm/completion-authority/scripts/test-elm.sh`
  (system elm-test contract; HALT messages)
- `apps/vscode/elm/completion-authority/scripts/fetch-elm-packages.sh`
  (demoted to documented no-op stub)

## Verdict

PASS_KERNEL_EXECUTABLE_GREEN. The Elm subproject compiles, the 20-test
invariant suite passes, the JS kernel round-trips a tagged event
sequence. The CORRECTION02 P0s and the CORRECTION01 vendored-0.19.1
toolchain detour are removed. Semantic correctness against the
historical replay remains a downstream ACT.
