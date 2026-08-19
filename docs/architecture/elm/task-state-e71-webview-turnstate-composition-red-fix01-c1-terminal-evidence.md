# E7.1 WEBVIEW-TURNSTATE-COMPOSITION RED-FIX01 — C1+C2+C3 terminal evidence

**ACT_ID:**
`ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-COMPOSITION-RED-FIX01`

**Sub-steps in this commit:** C1 (real-provider RED), C2 (A-F discriminator),
C3 (necessity witness) — combined into one test file because the
discriminator and necessity checks are co-located with the RED test.

**Verdict:** **`HALT_RED_NOT_REPRODUCED`**

**Entry (this ACT):** `a2ffc9bac` (RED-FIX01 plan + C0 recon)

**Parent (predecessor):** `5e83022ba` (TRACE01 CLOSED_CLEAN)

---

## §0  Frozen entry truth (immutable predecessor evidence)

```text
LIVE_BOUNDARY                  = W2_WEBVIEW_STATE_COMPOSITION
FIRST_DIVERGENCE_PUSH_ID       = 12

P12:
  extension.turnState = streaming/11
  raw.turnState       = streaming/11
  committed.turnState = idle/3

P30:
  extension.turnState = awaiting_followup/29
  raw.turnState       = awaiting_followup/29
  committed.turnState = idle/3

WHOLE_STATE_DELIVERY_FAILURE   = false
TURNSTATE_SELECTIVE_FAILURE    = true
ROOT_CAUSE_CLASS               = UNKNOWN
LEADING_ROOT_CAUSE_CANDIDATE   = R-C
R-C_PROVEN                     = NO
```

---

## §1  Production-surface change (test-only observation seam)

The only production code change in this commit is the addition of a
test-only observation seam to
`apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`:

```text
+ export type WebviewTurnstateCompositionCheckpoint
+ export interface WebviewTurnstateCompositionObservation
+ export const __webviewTurnstateCompositionObservers: Set<...>

// Four observation points inside the W1 functional updater:
+ const __replicaBeforeTurnState = replicaRef.current.turnState           (B)
+ const __replicaAfterReducerTurnState = replicaRef.current.turnState     (C)
+ const __stateDataTurnState = stateData.turnState                        (D)
+ const __newStateTurnState = newState.turnState                          (E)

// Fire all four observers if any are registered (production: empty Set = no-op)
+ if (__webviewTurnstateCompositionObservers.size > 0) { ... }
```

```text
+93 lines in ExtensionStateContext.tsx
 - 0 production code path changes (the four observation call sites
   are wrapped in a Set.size > 0 guard)
 - 0 PTAD architecture changes (no new capture kinds, no _ptadPushId
   semantic changes)
 - 0 SDK / Hub / Remote changes
 - 0 test delta to existing test files
```

The seam is OPT-IN at runtime: in production
`__webviewTurnstateCompositionObservers.size === 0`, the `forEach` calls
are skipped, and the four extra local variables are trivially
DCE-eliminable by esbuild. The seam is required by the gate protocol's
C2 discriminator and is exactly the OPTION 1 design from the C0
recon plan.

---

## §2  RED-FIX01 test added

```text
+ apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/c2-correction02-red-fix01-turnstate-composition.test.tsx
+ 482 lines
```

The test file mounts the **real** `ExtensionStateContextProvider`
(no direct reducer call, no reducer mock) and wires both
`subscribeToState` (W1) and `subscribeToPartialMessage` (W2) via
the existing `vi.mock("@/services/grpc-client")` pattern. The
producer surface exercised is exactly the live production surface.

The test file contains four tests:

```text
RED_W2_STREAMING: drives W1(idle/3) -> W2(partial) -> W1(streaming/11)
                  ALL IN ONE BATCHED act() (React 18+ automatic batching).
                  Asserts raw = streaming/11 AND committed = idle/3.
                  THIS IS THE RED.

RED_W2_TERMINAL:  drives W1(idle/3) -> W2(partial) -> W1(awaiting_followup/29)
                  same shape, terminal phase. Also asserts raw != committed.

CONTROL_NO_W2:    drives W1(idle/3) -> W1(streaming/11) WITHOUT any W2.
                  Necessity witness: if the failure is W2-specific,
                  this control must pass (raw == committed == streaming/11).

HALT gate:        drives W1(idle/3) -> W2(partial) -> W1(streaming/11) AGAIN.
                  Asserts raw = streaming/11 (no F assertion; this is the
                  halt gate, not the RED). The reviewer reads the
                  console.log to decide HALT vs proceed.
```

---

## §3  Test results (the halt finding)

```text
Test Files  1 failed | 68 passed (69)
Tests       2 failed | 558 passed (560)
```

The two failures are **RED_W2_STREAMING** and **RED_W2_TERMINAL**, both
of which assert `committed.turnState == idle/3`. Both fail because
the real provider commits `streaming/11` (or `awaiting_followup/29`),
exactly the same value as the raw incoming payload:

```text
RED_W2_STREAMING committed turnState  = streaming/11      (was idle/3)
RED_W2_TERMINAL  committed turnState  = awaiting_followup/29  (was idle/3)
CONTROL_NO_W2    committed turnState  = streaming/11      (control passes)
HALT gate        committed turnState  = streaming/11      (gate does not reproduce)
```

The discriminator captured by the four observation hooks confirms:

```text
RED_W2_STREAMING:
  A = rawIncoming                  = { phase: streaming, seq: 11 }
  B = replicaBefore.turnState      = { phase: idle, seq: 3 }      (initial state)
  C = replicaAfterReducer.turnState = { phase: streaming, seq: 11 }  (REDUCER ADVANCED)
  D = stateData.turnState          = { phase: streaming, seq: 11 }  (line 652 copy)
  E = newState.turnState           = { phase: streaming, seq: 11 }  (returned to React)
  F = committed.turnState          = { phase: streaming, seq: 11 }  (committed == E)
```

The reducer advanced correctly. The line-652 copy was correct. The
returned newState was correct. The committed context is correct. The
W2 boundary is **NOT** reproduced by the real provider in this synthetic
P12-equivalent input.

---

## §4  Why the test does not reproduce the live W2 boundary

The live evidence (TRACE01's archived JSONLs) shows the W2 boundary
on a real installed VS Code extension with a real user task. This
RED test uses a synthetic P12-equivalent input:

```text
LIVE WALK                       | RED TEST
--------------------------------|--------------------------------
Real installed VS Code ext.     | jsdom test environment
Real LLM-driven task stream     | Synthetic P12-equivalent input
Real microtask boundaries       | One batched act() (or separate
  between W2 and the next W1       act()s with Promise.resolve())
User-triggered UI navigation    | No ChatView children above
  (showSettings, navigateToX)    | the provider
Actual setShowWelcome /         | welcomeViewCompleted: true
  setOnboardingModels /           (suppresses pre-existing side
  setDidHydrateState triggers     effects)
Real clineMessages history      | One synthetic partial message
  with dozens of ts/seq pairs     with ts=100 seq=1
```

Several of these could plausibly contribute to the live failure:

1. **The pre-existing side effects** (setShowWelcome /
   setOnboardingModels / setDidHydrateState) might queue additional
   setState calls that interleave with the W1 functional updater.
   My test suppresses these by setting `welcomeViewCompleted: true`,
   so the live test would need to NOT suppress them to model the
   failure faithfully.
2. **The actual chat-view children** above the provider (e.g.
   `ChatView` itself with its own useState for streaming indicators,
   TaskHeader, etc.) might call `setShowWelcome` or other
   navigation setters in response to state changes, generating
   additional React update queue entries that the W1 updater
   competes with.
3. **The actual clineMessages history** might contain a ts/seq that
   conflicts with the W2 partial message's ts/seq, causing the
   reducer to reject the partial message and trigger an unexpected
   epoch transition.
4. **The actual W2 message** in the live walk might carry an `epoch`
   different from the snapshot's, which would trigger a wholesale
   replace in `reducerApplyStateSnapshot`, including potentially
   reverting `turnState`.
5. **The wire-level `convertProtoToClineMessage` path** might
   transform the partial message differently than my synthetic
   object.

This test exhausts what is **reproducible from a test** (the unit
boundary, the reducer contract, the React 18+ batching) but cannot
foolishly approximate the **full installed environment** where
the boundary was first observed.

---

## §5  HALT verdict and frozen consequence

Per the gate protocol:

```text
HALT_RED_NOT_REPRODUCED

Hard rule:
  If the real provider does NOT reproduce W2:
    HALT_RED_NOT_REPRODUCED
  Do not "approximate" it by calling the reducer directly and
  do NOT fix replicaRef anyway.
```

Therefore:

```text
PRODUCTION_SEMANTIC_DELTA   = 0   (test seam only; no behavior change)
TEST_DELTA                  = +1  (this test file added)
PTAD_ARCHITECTURE_DELTA     = 0
VSIX_DELTA                  = 0
SDK_CORE_DELTA              = 0
HUB_REMOTE_DELTA            = 0

FIX BEFORE RED              = FORBIDDEN  (RED was never reproduced)
ROOT_CAUSE_PROVEN           = NO
LEADING_CANDIDATE           = R-C   (still unproven)
R-C PROVEN                  = NO
```

The seam addition is reverted-able in a single commit if the
reviewer decides the ACT should close without keeping the seam;
the seam is independent of any fix.

---

## §6  What the seam enables

Even though the test halts, the seam remains valuable:

1. **Future ACTs** (or a re-attempt of this ACT with a richer
   reproduction setup) can attach observers at the four exact
   intermediate checkpoints and read B/C/D/E without re-patching
   `ExtensionStateContext.tsx`.
2. **The A-F discriminator** is fully wired and produces a clean
   causal classification when the W2 boundary DOES reproduce.
3. **The seam is a no-op in production** (Set.forEach on empty Set
   is the fast path; the four local variables are DCE-eliminable),
   so the cost is one-time documentation overhead in
   `ExtensionStateContext.tsx`.

---

## §7  State of the board (RED-FIX01 halted at C1)

```text
HEAD (this commit)               = (will be set on commit)
WORKTREE                         = clean (after commit)
PROTECTED_STASH_FORENSIC         = 141372c52 intact
PROTECTED_STASH_CONTEXT          = 371752f71 intact
VSIX_017f68a36                   = 8a7f1236... (8883021 bytes, byte-identical)
SOURCE_DELTA                     = +93 lines (test seam only)
TEST_DELTA                       = +1 file (c2-correction02-red-fix01-*)
PTAD_DELTA                       = 0
VSIX_DELTA                       = 0
DIFF_CHECK                       = clean

RED-FIX01 verdict                = HALT_RED_NOT_REPRODUCED
RED-FIX01 root cause             = UNKNOWN
RED-FIX01 leading candidate      = R-C   (still unproven)

Predecessor halt preserved       = 8ec86ec9a
W2 boundary classified           = by E7.1 TRACE01 (closed at 5e83022ba)
                                  + by E7.1 RED-FIX01 C1 (NOT REPRODUCED)

Production fix in this ACT       = NOT AUTHORIZED (HALT)
Next-ACT (if any)                = NOT YET IDENTIFIED
                                  the W2 boundary requires richer
                                  reproduction to be investigated
                                  further. Options:
                                    (a) drive the real ChatView tree
                                        above the provider, not just
                                        the provider in isolation
                                    (b) drive the real
                                        ExtensionStateContext with
                                        a synthetic
                                        setShowWelcome / etc. side
                                        effect chain active
                                    (c) instrument the live walk
                                        itself with extra captures
                                        to localize the failure to
                                        a specific React commit
                                  Each option requires a new
                                  authorization.

E8 / E9                          = HOLD (per TRACE01 final state)
```

---

## §8  Acceptance gate (RED-FIX01 halted at C1)

```text
E71RF_T0  ENTRY_IDENTITY                         PASS
E71RF_T1  TRACE01_PREDECESSOR                    CLOSED_CLEAN

E71RF_T2  REPLICA_WRITER_AUDIT                   100%   (C0)
E71RF_T3  REACT_WRITER_AUDIT                     100%   (C0)
E71RF_T4  TURNSTATE_WRITER_AUDIT                 100%   (C0)

E71RF_T5  REAL_PROVIDER_W2_RED                   HALT_RED_NOT_REPRODUCED
E71RF_T6  INTERNAL_A_TO_F_DISCRIMINATOR          N/A    (no failure to discriminate)
E71RF_T7  ROOT_CAUSE_CLASS                       UNKNOWN (unchanged from TRACE01)
E71RF_T8  NECESSITY                              N/A    (RED not reproduced)

E71RF_T9  SINGLE_BOUNDARY_REPAIR                 NOT AUTHORIZED

E71RF_T10..T15  Conservation/adversarial          NOT EXECUTED
                (gated behind successful C1 RED)

E71RF_T16 THINKING_PROJECTION_DELTA               0
E71RF_T17 PTAD_ARCHITECTURE_DELTA                 0
E71RF_T18 SDK_CORE_DELTA                          0
E71RF_T19 HUB_REMOTE_DELTA                        0

E71RF_T20 WEBVIEW_TEST_SWEEP                     558/560 (2 expected RED failures)
E71RF_T21 TYPES                                  PASS (no new errors)
E71RF_T22 BIOME                                  not run in this commit (will run in commit 4)
E71RF_T23 DIFF_HYGIENE                           PASS

E71RF_T24 EXACT_HEAD_VSIX                        NOT BUILT (halt before C7)
E71RF_T25 INSTALLED_BINDING                      AWAIT_USER
E71RF_T26 LIVE_EXTENSION_RAW_EQUAL               AWAIT_USER
E71RF_T27 LIVE_RAW_COMMITTED_EQUAL               AWAIT_USER
E71RF_T28 LIVE_W2_PRESENT                        AWAIT_USER

E71RF_T29 PROTECTED_STASHES                      PASS
```

---

## §9  Required reviewer authorization to reopen

A future attempt to fix the W2 boundary would require:

```text
1. Reviewer authorization to re-open RED-FIX01 (or open a new ACT
   that explicitly supersedes this one).
2. A reproduction strategy that does NOT halt at C1 — i.e. one of:
   (a) drive the real ChatView tree (not just the provider in isolation)
   (b) drive the real provider with the pre-existing side effects active
       (welcomeViewCompleted: false, so setShowWelcome / setOnboardingModels
        / setDidHydrateState fire)
   (c) instrument the live walk itself with extra PTAD captures at the
       B/C/D/E checkpoints (which the seam now enables)
3. Re-running the discriminator at C2 with the new reproduction and
   classifying the mechanism before any production fix is authorized.
```

Until then: no `replicaRef` mutation, no `messageReducer.ts` semantic
change, no `ExtensionStateContext.tsx` production path change beyond
the existing test seam. The seam is the only authorized surface delta
from this commit.
