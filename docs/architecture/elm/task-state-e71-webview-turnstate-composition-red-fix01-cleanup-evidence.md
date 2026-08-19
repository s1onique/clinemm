# E7.1 WEBVIEW-TURNSTATE-COMPOSITION RED-FIX01 — cleanup evidence

**ACT_ID:**
`ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-COMPOSITION-RED-FIX01`

**Sub-step:** cleanup (post-C1 halt)

**Verdict (this commit):** **`HALT_RED_NOT_REPRODUCED / CLOSED_HALTED_CLEAN`**

**Entry (this commit):** `ec4415b6e` (C1+C2+C3 halt, with seam)

**Predecessor (entry branch):** `5e83022ba` (TRACE01 CLOSED_CLEAN)

---

## §0  Why this commit exists

The C1 commit (`ec4415b6e`) deliberately admitted a 93-line
test-only observation seam into production source
(`apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`) on
the reasoning that the seam was a no-op in production and a
re-investigation substrate for future ACTs.

The reviewer (`R1` + `R2` in the post-halt review) correctly
rejected that:

1. The seam is not actually zero production delta — it adds an
   exported mutable singleton, four observation call sites, and a
   runtime branch. The "DCE-eliminable" claim was too strong.
2. The retained test suite had two intentionally failing tests.
3. The discriminator's `observations.find()` was not correlate-
   safe to the second W1 push.
4. The discriminator's local `rawIncoming` field was read **after**
   `stateData.turnState = replicaRef.current.turnState`, so it
   was not literally raw incoming truth.

This cleanup commit reverts the seam and converts the two failing
tests into passing "RED not reproduced" witnesses. The discriminator
substrate is removed because the synthetic RED did not reproduce it
— keeping it for "future re-attempts" would be the kind of forensic
scaffolding that becomes permanent architectural residue.

---

## §1  Production surface delta (this commit)

```text
FINAL_PRODUCTION_DELTA = 0
```

The 93-line observation seam added by `ec4415b6e` is reverted. The
current `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`
is byte-identical to its pre-C1 state ("8ec86ec9a" / "a2ffc9bac^" /
"5e83022ba" — all three are equivalent since C0 only modified docs).

```text
NO files in apps/vscode/src/core/controller/ touched
NO files in apps/vscode/src/sdk/ touched
NO files in apps/vscode/src/api/ touched
NO files in apps/vscode/src/services/ touched
NO files in apps/vscode/src/shared/ touched
NO files in apps/vscode/src/hosts/ touched
NO files in apps/vscode/webview-ui/src/components/ touched
NO files in apps/vscode/webview-ui/src/context/ touched  (the seam is gone)
NO package.json / tsconfig / biome.jsonc / vitest.config* touched
NO PTAD architecture touched
NO _ptadPushId semantics touched
NO diagnostic capture kinds touched
NO VSIX touched
NO Hub / Remote touched
NO LLM credential required
```

The production surface in this commit is functionally identical to
the pre-RED-FIX01 surface.

---

## §2  Test surface delta (this commit)

```text
+ apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/c2-correction02-red-fix01-turnstate-composition.test.tsx (rewritten)
+ 481 lines
```

The original test file had 4 tests:
- RED_W2_STREAMING: failed (RED was not reproduced)
- RED_W2_TERMINAL: failed (RED was not reproduced)
- CONTROL_NO_W2: passed
- HALT gate: passed

The rewritten test file has 4 tests, all passing:
1. **`RED_W2_STREAMING_absent`** — asserts that the real provider
   commits `streaming/11` for a W1->W2->W1 batched sequence (i.e.
   the RED is ABSENT). A == F.
2. **`RED_W2_TERMINAL_absent`** — same shape for the terminal form
   (`awaiting_followup/29`). A == F.
3. **`CONTROL_NO_W2`** — control witness (W1->W1 without W2).
   A == F.
4. **`CONSUMER_WITNESS`** — a real `useExtensionState()` consumer
   reads `streaming/11` after the W1->W2->W1 sequence. This proves
   the close-clean not just via PTAD captures but via the live
   consumer path that the production UI actually subscribes to.

The A==F assertions are the canonical close-clean witness: the
synthetic P12-equivalent input is correctly committed by the
real provider, end-to-end. The discriminator's misleading local
`rawIncoming` field is removed entirely (it was the seam's bug
anyway: it was read after `stateData.turnState` had been rewritten).

The discriminator's `observations.find()` correlation issue is
moot — the rewritten test does not use the discriminator at all.
It reads only A (PTAD webview-raw-incoming) and F (PTAD
webview-committed) for the final pair.

Caveat (R3): in this synthetic fixture the producer does **not**
stamp `_ptadPushId` on the wire payload, so PTAD is in fail-closed
mode and the two captures may carry undefined push IDs.

```text
SYNTHETIC_FIXTURE_PUSH_CORRELATION = UNAVAILABLE (_ptadPushId undefined)

A_F_PAIRING = controlled-sequence / latest-observation
```

This does not undermine the A==F result, because:

1. The test controls the complete event sequence within one
   `act()` call, so the chronology is exact.
2. The fourth witness (`CONSUMER_WITNESS`) reads from a real
   `useExtensionState()` consumer after the same controlled
   sequence, proving the close-clean not just via PTAD captures
   but via the live consumer path the production UI subscribes to.

The push-ID correlation is available in the LIVE trace (TRACE01
captures carry real `_ptadPushId` values), but it is not used to
distinguish W1/W2 ordering in this synthetic GREEN-witness
fixture.

---

## §3  Test results (full webview sweep)

```text
Test Files  69 passed (69)
Tests       560 passed (560)
```

```text
RED_FIX01_CANONICAL_TEST_GATE = PASS
```

The default test suite is green. No knowingly failing tests. Two
intentionally failing tests from the prior commit were converted
to passing witnesses.

(Biome lint clean): `bun run lint -- <test-file>` returns no errors.
(Biome format clean): `biome format --check` returns no errors.
(Typecheck clean): `bun run check-types` returns 46 pre-existing
errors, zero of which are in `ExtensionStateContext.tsx` or the
RED-FIX01 test file.

---

## §4  The close-clean marker

The discriminator's full output for the synthetic P12-equivalent
input (captured before the seam was reverted) is preserved in
the prior terminal-evidence document
(`task-state-e71-webview-turnstate-composition-red-fix01-c1-terminal-evidence.md`).

```text
RED_W2_STREAMING_AB_FOR_SYNTHETIC_P12_EQUIVALENT:
  A = rawIncoming                  = { phase: streaming, seq: 11 }
  B = replicaBefore.turnState      = { phase: idle, seq: 3 }
  C = replicaAfterReducer.turnState = { phase: streaming, seq: 11 }
  D = stateData.turnState          = { phase: streaming, seq: 11 }
  E = newState.turnState           = { phase: streaming, seq: 11 }
  F = committed.turnState          = { phase: streaming, seq: 11 }
```

This is the empirical close-clean fact: the production surface
correctly commits raw truth for the simple synthetic P12-equivalent
input. The discriminator output is preserved as a forensic witness,
not as a live instrumentation API.

---

## §4.5  Bounded claim set (R2)

The cleanup-evidence text — and the chat summary that introduced
it — must avoid overstating what the synthetic GREEN-witness
fixture actually proves. The bounded claim set is:

```text
REDUCER_SIMPLE_SEQ_GATE_DEFECT    = NOT_SUPPORTED
LINE_652_SIMPLE_COPY_DEFECT       = NOT_SUPPORTED
SIMPLE_W1_W2_W1_BATCH_FAILURE     = NOT_REPRODUCED
MINIMAL_W1_W2_W1_BATCHING_HYPOTHESIS = NOT_REPRODUCED

ROOT_CAUSE                        = UNKNOWN
MISSING_LIVE_DIMENSION            = PROVEN_TO_EXIST
GLOBAL_REPLICA_QUEUE_INTERACTION  = NOT_EXCLUDED
```

What this means:

- The cleanup test proves that the **particular synthetic**
  W1→W2→W1 batched shape (with `welcomeViewCompleted: true`,
  default PTAD fail-closed mode, synthetic partial message
  proto-shape, and a single `act()` call wrapping the three
  callbacks) does **not** reproduce the live W2 boundary.
- It does **not** globally exclude interaction between
  `replicaRef` and React's pending-state queue in the real trace,
  because the exact live epoch/stateVersion/message/order/timing
  context has not yet been reconstructed.
- React applies queued updater functions against pending state in
  order, and batching can process multiple updates as one render
  batch. The updater path also contains pre-existing external
  mutations/setters, while React explicitly expects updater
  functions to be pure. These constraints are not exercised by
  the synthetic GREEN-witness fixture.
- The "missing live dimension" claim is the genuine progress:
  some live-state dimension matters that the synthetic fixture
  does not reproduce.

The next ACT
(`LIVE-SHAPE-REPRODUCTION01`) is the rigorous attempt to
identify that missing dimension by introducing one live-trace
attribute at a time, with an ablation rule for each.

---

## §5  State of the board

```text
HEAD (this commit)               = (will be set on commit)
WORKTREE                         = clean (after commit)
PROTECTED_STASH_FORENSIC         = 141372c52 intact
PROTECTED_STASH_CONTEXT          = 371752f71 intact
VSIX_017f68a36                   = 8a7f1236... (8883021 bytes, byte-identical)
SOURCE_DELTA                     = 0
TEST_DELTA                       = 1 file rewrited (RED-FIX01 test, GREEN)
PTAD_DELTA                       = 0
VSIX_DELTA                       = 0
DIFF_CHECK                       = clean

TRACE01                          = CLOSED_CLEAN (5e83022ba)
RED-FIX01                        = HALT_RED_NOT_REPRODUCED / CLOSED_HALTED_CLEAN
  C0 writer recon                 = closed at a2ffc9bac
  C1 real-provider RED            = halted at ec4415b6e (NOT REPRODUCED)
  production seam                 = REVERTED (this commit)
  canonical test gate             = PASS (560/560)

NEXT
  LIVE-SHAPE-REPRODUCTION01       = 🟢 AUTHORIZED (to be opened next ACT)
```

---

## §6  Next ACT authorization (LIVE-SHAPE-REPRODUCTION01)

The reviewer recommended the next ACT:

```text
ACT-CLINEMM-ELM-ARCHITECTURE01-
E7.1-WEBVIEW-TURNSTATE-LIVE-SHAPE-REPRODUCTION01
```

Mission:

> Starting from the known-green minimal provider fixture, reconstruct
> the live W1/W2 input shape incrementally from existing TRACE01
> evidence until the first added production-realistic dimension turns
> the fixture RED. Stop at that first causal delta. No production fix
> in the same phase unless the mechanism becomes uniquely proven and
> the ACT explicitly contains a gated repair phase.

Recommended isolation ladder:

```text
BASE
  idle/3 → partial → streaming/11
  current result: GREEN

E1  exact snapshot epoch values
E2  exact snapshot stateVersion values
E3  exact partial-message epoch
E4  exact partial-message ts/seq
E5  actual preceding message history
E6  exact live W1/W2 ordering
E7  exact microtask/macrotask boundaries
E8  welcome/onboarding side-effect state
```

Specifically recommended first hypothesis from the review:

```text
W1: epoch = E, turnState = idle/3
W2: epoch = E+1
W1: epoch = E, turnState = streaming/11

Hypothesis: the final W1 becomes stale against the replica epoch
and leaves old turnState in place.
```

This is the high-value next experiment because it follows directly
from a known cross-field authority dependency in the same replica
(W2 updates replica epoch via `reducerApplyMessage`; W1 reads
snapshot epoch via `reducerApplyStateSnapshot`). It is much
stronger than constructing the full ChatView tree and observing
twenty new variables simultaneously.

The next ACT is **authorized** but not opened in this commit. It
requires a separate authorization round to lock in the exact
isolation ladder, the test surface, and the halt-vs-continue
verdict criteria.

---

## §7  Acceptance gate (RED-FIX01 closed-halted-clean)

```text
E71RF_T0  ENTRY_IDENTITY                         PASS
E71RF_T1  TRACE01_PREDECESSOR                    CLOSED_CLEAN

E71RF_T2  REPLICA_WRITER_AUDIT                   100%   (C0)
E71RF_T3  REACT_WRITER_AUDIT                     100%   (C0)
E71RF_T4  TURNSTATE_WRITER_AUDIT                 100%   (C0)

E71RF_T5  REAL_PROVIDER_W2_RED                   HALT_RED_NOT_REPRODUCED
E71RF_T6  INTERNAL_A_TO_F_DISCRIMINATOR          N/A    (no failure to discriminate)
E71RF_T7  ROOT_CAUSE_CLASS                       UNKNOWN (unchanged from TRACE01)
E71RF_T8  NECESSITY                              N/A    (RED not reproduced; cannot
                                                              establish a necessity
                                                              for a failure that did
                                                              not occur)

E71RF_T9  SINGLE_BOUNDARY_REPAIR                 NOT AUTHORIZED

E71RF_T10..T15  Conservation/adversarial          NOT EXECUTED
                (gated behind successful C1 RED)

E71RF_T16 THINKING_PROJECTION_DELTA               0
E71RF_T17 PTAD_ARCHITECTURE_DELTA                 0
E71RF_T18 SDK_CORE_DELTA                          0
E71RF_T19 HUB_REMOTE_DELTA                        0

E71RF_T20 WEBVIEW_TEST_SWEEP                     PASS   (560/560)
E71RF_T21 TYPES                                  PASS   (no new errors)
E71RF_T22 BIOME                                  PASS   (lint + format clean)
E71RF_T23 DIFF_HYGIENE                           PASS

E71RF_T24 EXACT_HEAD_VSIX                        NOT BUILT (halt before C7)
E71RF_T25 INSTALLED_BINDING                      AWAIT_USER
E71RF_T26 LIVE_EXTENSION_RAW_EQUAL               AWAIT_USER
E71RF_T27 LIVE_RAW_COMMITTED_EQUAL               AWAIT_USER
E71RF_T28 LIVE_W2_PRESENT                        AWAIT_USER

E71RF_T29 PROTECTED_STASHES                      PASS
```

---

## §8  What this commit does NOT do

- It does not open the next ACT.
- It does not advance the root-cause analysis.
- It does not change any production code.
- It does not change any test seam instrumentation.
- It does not rebuild the VSIX.
- It does not require live dogfood.
- It does not require LLM credentials.

It is the bounded cleanup that the post-halt review correctly required
before any further investigation can proceed.

---

## §9  Final disposition

```text
RED-FIX01 =
  CLOSED_HALTED_CLEAN

  C0 writer recon                 = closed at a2ffc9bac
  C1 real-provider RED            = halted at ec4415b6e (NOT REPRODUCED)
  C1 production seam              = REVERTED at 24aeb6464
  cleanup corrections             = applied at (this docs commit)
  canonical test gate             = PASS (560/560 GREEN)
  claim set                        = BOUNDED (§4.5)

LIVE-SHAPE-REPRODUCTION01 =
  AUTHORIZED

  plan document                   = (separate docs commit, this branch)
  isolation ladder                = E1..E10 with ablation rule
  acceptance gate                 = LSR_T0..T17
  allowed outcomes                = PASS_LIVE_SHAPE_CAUSAL_DIMENSION_FOUND
                                    PASS_LIVE_SHAPE_REPRODUCTION_LADDER_PARTIAL
  production fix                  = NOT AUTHORIZED in this ACT

HEAD                            = (this docs commit's parent; +1 ahead)
VSIX_017f68a36                  = unchanged, byte-identical
STASHES                         = 141372c52 + 371752f71 intact
```
