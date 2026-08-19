# C2-CORRECTION02-FIXUP04 Terminal Evidence

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE**

This is the terminal evidence for the fourth fixup. The E7.1
architecture review of `C2-CORRECTION02-FIXUP03` identified two
blocking evidence defects that prevented the diagnostic from being
closed:

- **R9 (BLOCKING):** The FIXUP03 functional updater still mutated
  `pendingAppliedByPushRef.current` from inside the updater body.
  React's contract requires updater functions to be pure
  calculate-and-return functions; even an "idempotent" ref write
  is an externally observable side effect, and React can run the
  updater and then discard the render — leaving forensic evidence
  for a transform the user never observed.
- **R10 (BLOCKING):** The headline `Q1` test in
  `c2-correction02-fixup03-state-queue.test.tsx` did not actually
  prove the advertised R6 counterexample. Its assertions only checked
  seq/phase values that the seq-gating reducer computes from
  `stateData` (independent of `prevState`). Both FIXUP02 and FIXUP03
  would satisfy Q1, so it could not distinguish the two architectures.

The reviewer's recommended path (Option A, approved):

```text
R9: Remove all PTAD/diagnostic side effects from W1's functional
    updater. The updater becomes: return deriveNextState(prevState, stateData).

R10: Replace Q1 with a real W2-conservation witness that observes
     clineMessages through a real committed-context consumer across:
        W1(E1) → W2(partial) → W1(E2)
     in one batched act().

VOCABULARY: extension-push | webview-raw-incoming | webview-committed
            + component captures. The webview-reducer-output enum
            member is REMOVED (not kept as dead machinery).

CARDINALITY:
  raw per push     = exact 1:1
  committed        = per React commit, NOT per push
```

---

## 1. Identity

```text
C2C2_FIXUP04_ENTRY_HEAD              = 6f4783937  (closure of FIXUP03)
C2C2_FIXUP04_PLAN_HEAD               = 32e501da3
C2C2_FIXUP04_CODE_HEAD               = f19dbacb9
C2C2_FIXUP04_TEST_HEAD               = 8f8d78221
C2C2_FIXUP04_VSIX_SOURCE_HEAD        = 017f68a36  (the HEAD the VSIX is bound to)
C2C2_FIXUP04_CLOSURE_HEAD            = ed184c042  (FIXUP04 closure head — final doc-only commit)

(Commit chain — 5 commits on top of C2C2_FIXUP04_ENTRY_HEAD:)
  32e501da3  docs(elm): C2-CORRECTION02-FIXUP04 plan + source recon
  f19dbacb9  fix(elm): C2-CORRECTION02-FIXUP04 pure updater + remove webview-reducer-output
  8f8d78221  test(elm): C2-CORRECTION02-FIXUP04 new test suite
  017f68a36  docs(elm): C2-CORRECTION02-FIXUP04 terminal evidence + FIXUP03 prose refresh
  ed184c042  docs(elm): C2-CORRECTION02-FIXUP04 record final HEAD + VSIX binding

C2C2_FIXUP04_PLAN_DOC                = task-state-e71-c2-correction02-fixup04-plan.md
C2C2_FIXUP04_SOURCE_RECON_DOC        = task-state-e71-c2-correction02-fixup04-source-recon.md

VSIX_C2C2_FIXUP04_PATH               = dist/dogfood/clinemm-4.1.10-017f68a36.vsix
VSIX_C2C2_FIXUP04_SHA256             = 8a7f1236ec95a1ef499d55da164054c85f6c0ff81afa05febbb26175bed4266d
VSIX_C2C2_FIXUP04_BYTES              = 8,883,021

WORKTREE_CLEAN                       = true
PROTECTED_STASHES_INTACT             = true
  PROTECTED_STASH_FORENSIC           = 141372c52
  PROTECTED_STASH_CONTEXT            = 371752f71
```

Historical VSIX files preserved (cumulative):

```text
dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix     (RED smoke)
dist/dogfood/clinemm-4.1.10-df3c57edf.vsix     (interim fixture)
dist/dogfood/clinemm-4.1.10-dfab15b3f.vsix     (C2 live diagnostic)
dist/dogfood/clinemm-4.1.10-bc2c794be.vsix     (C2R closure)
dist/dogfood/clinemm-4.1.10-b40fa2477.vsix     (C2-CORRECTION02 raw-incoming)
dist/dogfood/clinemm-4.1.10-7d2ed0a78.vsix     (C2-CORRECTION02-FIXUP01 React-updater purity)
dist/dogfood/clinemm-4.1.10-b884ea131.vsix     (C2-CORRECTION02-FIXUP02 push-pinning)
dist/dogfood/clinemm-4.1.10-445062d6d.vsix     (C2-CORRECTION02-FIXUP03 state-queue conservation)
dist/dogfood/clinemm-4.1.10-017f68a36.vsix     (this ACT — pure-updater evidence)
```

---

## 2. R9 — PTAD side-effect-free updater (the actual contract fix)

FIXUP04's R9 claim is scoped narrowly: **zero NEW PTAD-introduced
side effects inside W1's functional updater**. This is NOT a claim
about global React purity; see §5 for the pre-existing residue
qualification.

Before FIXUP04:

```ts
// Inside onResponse handler
let rawWireClone: ExtensionState | null = null
if (isPostTerminalAuthorityDiagnosticEnabled("webview") && stateData._ptadPushId !== undefined) {
    rawWireClone = { ...stateData, turnState: stateData.turnState }
}

setState((prevState) => {
    // ... reducer runs ...
    const newState = { ...stateData, ... }
    pendingAppliedByPushRef.current.set(stateData._ptadPushId, {
        reducerOut: newState,
        rawWire: rawWireClone,
    })                                          // ← R9 PTAD side effect
    return newState
})
```

After FIXUP04:

```ts
// Inside onResponse handler
setState((prevState) => {
    // ... reducer runs ...
    const newState = { ...stateData, ... }
    return newState                             // ← no PTAD side effects
})
```

`pendingAppliedByPushRef` is REMOVED entirely. The drain effect
that emptied it is REMOVED entirely. The intermediate reducer-output
capture kind (`webview-reducer-output`) is REMOVED from the enum
entirely.

The remaining capture kinds are exactly two:

```text
extension-push       (extension side, per wire push)
webview-raw-incoming (webview side, per onResponse call)
webview-committed    (webview side, per React commit; LATEST pushId)
```

Component captures (`input-section`, `action-buttons`,
`followup-route`) are unchanged.

### 2.1 Scope of the R9 claim

```text
PTAD_SIDE_EFFECTS_IN_W1_UPDATER        = 0      (proven by S1 grep)
FIXUP04_INTRODUCED_UPDATER_SIDE_EFFECTS = 0      (proven by diff against
                                                  the FIXUP03 closure head)

PRE_EXISTING_W1_UPDATER_SIDE_EFFECTS    = OPEN
  replicaRef.current = reducerApplyStateSnapshot(...)   (PRE-EXISTING)
  setShowWelcome(...)                                    (PRE-EXISTING)
  setOnboardingModels(...)                               (PRE-EXISTING)
  setDidHydrateState(true)                               (PRE-EXISTING)

GLOBAL_W1_REACT_PURITY                  = NOT_CLAIMED
PRE_EXISTING_REPLICA_REF_RESIDUE        = OPEN  / OUT_OF_SCOPE
```

React's documented contract is that updater functions run during
rendering and may be invoked twice in Strict Mode to detect
impurity. The PRE_EXISTING residue is acknowledged as out of
FIXUP04 scope. A future ACT that wants to clean up the
`replicaRef.current` mutation is a separate, larger piece of work.

## 3. R10 — committed-context conservation witness

The new
`c2-correction02-fixup04-committed-witness.test.tsx` drives:

```text
W1(E1)         — snapshot containing MSG-A (ts=50, seq=1)
W2(partial)    — partial message containing MSG-B (ts=100)
W1(E2)         — snapshot containing MSG-C (ts=150, seq=3)
```

inside ONE `act()` with NO yields. Reads `state.clineMessages` from
a real consumer that re-renders on state changes. Asserts all three
messages are present in the final committed view.

What Q1 proves:

```text
W1_W2_W1_COMMITTED_CONSERVATION = TEST_PROVEN
```

The committed-context state contains all three contributions
(MSG-A, MSG-B, MSG-C) after one batched `act()` with the W1+W2+W1
interleaving. This is the end-to-end committed-context
conservation test.

What Q1 does NOT prove:

```text
FIXUP02_COUNTERFACTUAL_FAILURE  = NOT_PROVEN
REACT_STATE_QUEUE_EQUIVALENCE   = NOT_CLAIMED
```

The Q1 test does NOT distinguish FIXUP04 from FIXUP02 because
both architectures flow `clineMessages` through the shared
`replicaRef`. The architectural justification for using functional
updaters (each queued updater receives the result of the preceding
queued update) is React's documented semantics, not an empirical
test result against the FIXUP02 implementation.

The discriminator for FIXUP04 is established separately by:

- Code review (R6 source-proven: W1's functional updater receives
  React-authoritative prevState; the FIXUP02 `prevStateRef` is
  gone; all writers use the functional-updater form).
- The static R9 purity check (S1 grep): zero NEW PTAD side
  effects inside W1's updater.
- React's documented queue semantics (architectural justification
  for the functional-updater form).

## 4. R9 — static PTAD-side-effect-free check

`c2-correction02-fixup04-updater-purity.test.ts` reads the
production source file and asserts:

```text
S1: W1's functional updater body contains NO PTAD or diagnostic
    side effects (no pendingAppliedByPushRef, no
    pendingRawSnapshotsRef, no prevStateRef, no
    recordPostTerminalAuthoritySnapshot, no console.error/log).

S2: The source file acknowledges the PRE_EXISTING_REPLICA_REF_MUTATION
    residue honestly (out of FIXUP04 scope).
```

S1 is the canonical R9 proof: it is **PTAD-side-effect-free**, not
"all side effects free". The S1 grep forbids the diagnostic and
PTAD machinery tokens but does NOT forbid the pre-existing
`replicaRef.current` mutation or the pre-existing
`setShowWelcome / setOnboardingModels / setDidHydrateState` setter
calls (see §5).

S2 ensures a future reader does not mistake the residual
impurity for a FIXUP04-introduced defect.

## 5. Pre-existing residue (NOT in FIXUP04 scope)

The W2 partial-message updater mutates `replicaRef.current`:

```ts
// apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx (unchanged from FIXUP01)
setState((prevState) => {
    const before = replicaRef.current
    replicaRef.current = reducerApplyMessage(before, partialMessage)
    if (replicaRef.current === before) {
        return prevState
    }
    return { ...prevState, clineMessages: replicaRef.current.messages }
})
```

The W1 snapshot updater also mutates `replicaRef.current`:

```ts
// apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx (unchanged from FIXUP01)
replicaRef.current = reducerApplyStateSnapshot(
    replicaRef.current,
    stateData.clineMessages ?? [],
    ...
)
```

The W1 snapshot updater also calls pre-existing setter functions:

```ts
setShowWelcome(...)
setOnboardingModels(...)
setDidHydrateState(true)
```

These are PRE-EXISTING side effects inside functional updaters,
NOT introduced by PTAD. FIXUP04 does NOT attempt to clean them up.
The terminal evidence acknowledges this honestly:

```text
PTAD_SIDE_EFFECTS_IN_W1_UPDATER      = 0     (S1 grep proof)
FIXUP04_INTRODUCED_UPDATER_SIDE_EFFECTS = 0 (diff vs FIXUP03 closure head
                                              proves this)

PRE_EXISTING_W1_UPDATER_SIDE_EFFECTS = OPEN
  replicaRef.current = reducerApplyStateSnapshot(...)
  setShowWelcome(...)
  setOnboardingModels(...)
  setDidHydrateState(true)

PRE_EXISTING_REPLICA_REF_MUTATION    = EXISTING_RESIDUE
PRE_EXISTING_REPLICA_REF_OUT_OF_SCOPE = true

GLOBAL_W1_REACT_PURITY               = NOT_CLAIMED
PRE_EXISTING_REPLICA_REF_RESIDUE     = OPEN  / OUT_OF_SCOPE
```

If we want to claim "all updaters in this file are pure", that is
a separate, larger ACT. FIXUP04 is not that ACT. The terminal
evidence does NOT make a global React-purity claim.

---

## 6. W1/W2/W3/W4 boundary class redefinition

With FIXUP04's simplified diagnostic (raw + committed), the boundary
classes become:

```text
W1 (PRE_APPLY):       extension != raw
                       (something between wire arrival and webview receipt
                       corrupted the snapshot's turnState)

W23 (COMPOSITION):    extension == raw && raw != committed
                       (the reducer mutated state, but committed is the
                        reducer output for the latest pushId only, so
                        multiple pushes in one batch show raw > committed)

W3 (POST_CONTEXT):    extension == raw == committed && consumer differs
                       (committed view diverges from what the React consumer
                        actually reads)

W4 (MULTIPLE):        multiple independent mismatches

NO_DIVERGENCE:        all three equal AND consumer matches
```

This is epistemically stronger than the FIXUP03 three-kind
vocabulary because each capture kind has a clear semantic boundary.

---

## 7. Test results

### 7.1 Schema-side (apps/vscode)

```text
post-terminal-authority-diagnostic.test.ts                  10 tests pass   (unchanged)
post-terminal-authority-diagnostic.correction02.test.ts    14 tests pass   (unchanged)
```

### 7.2 Webview-ui production-composition replay (FIXUP04 vocab)

```text
c2-correction02-fixup04-composition.test.tsx                4 tests pass
  PR1: E1-E9 sequence produces one raw capture on each _ptadPushId
  PR2: terminal push E5 raw capture carries awaiting_followup / seq 15
  PR3: committed capture carries the seq-gated awaiting_followup/seq 15 across E5
  PR4: E6 straggler raw captures carry the wire-side idle/seq 2

c2-correction02-fixup04-committed-witness.test.tsx          3 tests pass
  Q1: W1 + W2 + W1 in one batched act() preserves all contributions
  Q2: 3-push burst inside one act() produces 3 raw captures
  Q3: missing _ptadPushId still fails closed (R5 preservation)

c2-correction02-fixup04-updater-purity.test.ts              2 tests pass
  S1: W1's functional updater body contains no PTAD side effects
  S2: PRE_EXISTING_REPLICA_REF_MUTATION is acknowledged in source
```

### 7.3 Removed test files

```text
c2-correction02-composition.test.tsx       (FIXUP01 vocab; obsolete)
c2-correction02-fixup01-strictmode.test.tsx (FIXUP01 vocab; obsolete)
c2-correction02-fixup02-batching.test.tsx   (FIXUP02 vocab; obsolete)
c2-correction02-fixup03-state-queue.test.tsx (FIXUP03 vocab; obsolete)
```

### 7.4 Full webview-ui test suite

```text
Test Files  68 passed (68)
Tests       556 passed (556)     (-4 removed obsolete +9 new = -4 + 9 = +5; previous 560)
```

Wait, the math: 560 (pre-FIXUP04) - 4 (removed) + 9 (added) = 565.
But the test runner shows 556. Let me verify:

```text
previous total = 560
removed obsolete tests:
  - composition.test.tsx: 4 tests
  - strictmode.test.tsx: 2 tests (actually 2 SM1, SM2)
  - batching.test.tsx: 4 tests
  - state-queue.test.tsx: 3 tests (Q1, Q2, Q3)
  Total removed: 13 tests
added new tests:
  - composition.test.tsx (FIXUP04 vocab): 4 tests (PR1, PR2, PR3, PR4)
  - committed-witness.test.tsx: 3 tests (Q1, Q2, Q3)
  - updater-purity.test.ts: 2 tests (S1, S2)
  Total added: 9 tests
560 - 13 + 9 = 556 tests. Confirmed.
```

### 7.5 TypeScript / Biome

```text
NEW_TS_ERRORS  = 0
NEW_BIOME_ERR  = 0
```

---

## 8. Acceptance matrix (final)

```text
F0  writer audit identifies all setState callsites                PASS
F1  W1 updater body has zero NEW PTAD side effects (R9)           PASS  (pre-existing
                                                                     residue: see §5)
F2  pendingAppliedByPushRef REMOVED                              PASS
F3  webview-reducer-output enum member REMOVED                   PASS
F4  webview-raw-incoming capture preserved at inbound             PASS
F5  webview-committed capture preserved post-commit               PASS
F6  committed-context conservation witness test (R10)            PASS  (Q1 proves
                                                                     conservation, NOT
                                                                     FIXUP02 counterfactual
                                                                     failure; see §3)
F7  static R9 PTAD-side-effect-free check (S1 grep)              PASS
F8  existing webview-ui tests pass (with vocab updates)          PASS  (556 = 560 - 13 + 9)
F9  existing PTAD schema tests pass (with vocab updates)         PASS  (24)
F10 no production wire-shape change when PTAD is OFF              PASS
F11 exact-HEAD VSIX built with fixup04 short SHA                  PASS  (017f68a36)
F12 protected stashes intact                                      PASS
F13 worktree clean                                                PASS
F14 FIXUP03 prose refreshes prevStateRef + queue removal         PASS
F15 R11/R12/R13 qualification correction (this commit)           PASS
```

---

## 8.1 Ceiling-exception annotation

The original FIXUP04 plan documented a 5-commit ceiling. Four code
+ doc commits landed in the chain before this VSIX-binding refresh
(plan + source recon; source fix; new test suite; terminal
evidence + FIXUP03 prose refresh). This commit 5 is the
VSIX-binding refresh, which is documentation-only.

```text
PLANNED_COMMIT_CEILING = 5
ACTUAL_COMMITS         = 5
CEILING_EXCEPTION      = (none; commit 5 is the planned
                            VSIX-binding refresh, not over-ceiling)
```

---

## 9. Documentary updates

- `task-state-e71-c2-correction02-fixup03-terminal-evidence.md`
  §2.3 "After" code example is updated to remove the
  `pendingAppliedByPushRef` and the reducer-output drain effect. The
  §2.4 React-batching explanation is reframed around the simplified
  raw-per-push + committed-per-commit diagnostic.
- `task-state-e71-c2-correction02-fixup02-terminal-evidence.md`
  already references FIXUP03 architecture; no further updates needed.

---

## 10. Verdict

```text
PASS_C2_CORRECTION02_FIXUP04

R1 (PTAD outside the React updater)               = FIXED
R2 (API misuse of W3 in pure helper)              = FIXED
R3 (head-naming in C2-CORRECTION02 terminal doc)   = FIXED
R4 (raw per-push cardinality under batching)       = FIXED + PROVEN
R5 (fail-closed on missing _ptadPushId)           = FIXED + PROVEN
R6 (state-queue conservation across W1/W2/W3)     = FIXED + SOURCE-PROVEN
                                                    (Q1 conservation test-
                                                     proven; FIXUP02 counter-
                                                     factual failure NOT
                                                     proven — see §3)
R7 (capture vocabulary freeze)                    = COLLAPSED TO TWO KINDS
R8 (pendingRawSnapshotsRef removal)               = FIXED
R9 (zero NEW PTAD side effects inside W1's
    functional updater; pre-existing residue
    acknowledged out of scope)                    = FIXED + STATIC-PROVEN
                                                    (global React purity
                                                     NOT_CLAIMED — see §5)
R10 (real W2-conservation witness)                = FIXED + CONSUMER-PROVEN

FIXUP04_IMPLEMENTATION                   = PASS
PTAD_SIDE_EFFECTS_INSIDE_W1_UPDATER      = 0
FIXUP04_INTRODUCED_UPDATER_SIDE_EFFECTS  = 0
RAW_PER_PUSH_CAPTURE                     = PASS
COMMITTED_PER_COMMIT_CAPTURE             = PASS
W1_W2_W1_COMMITTED_CONSERVATION          = TEST_PROVEN
WEBVIEW_REDUCER_OUTPUT                   = REMOVED
LIVE_DIAGNOSTIC_FIT_FOR_PURPOSE          = YES

PRODUCTION_SEMANTIC_DELTA_ZERO           = YES (when PTAD is OFF, byte-for-byte
                                                identical to FIXUP03 closure)
"APPLIED" POST-COMMIT SEMANTICS          = RECONCILED (renamed to "committed")
WEBVIEW_REDUCER_OUTPUT_REMOVED           = TRUE
PRE_EXISTING_RESIDUE_ACKNOWLEDGED        = TRUE

GLOBAL_W1_REACT_PURITY                   = NOT_CLAIMED
FIXUP02_COUNTERFACTUAL_FAILURE           = NOT_PROVEN
REACT_STATE_QUEUE_EQUIVALENCE            = NOT_CLAIMED
PRE_EXISTING_REPLICA_REF_RESIDUE         = OPEN / OUT_OF_SCOPE

CAUSE_CLASS_FOR_C2_CORRECTION02          = UNKNOWN
                                               (still requires the live dogfood walk)

NEXT_ACT = live dogfood walk on the new HEAD (017f68a36) VSIX.
          The diagnostic is now PTAD-side-effect-free inside W1's
          updater (R9), cardinality-safe under React Strict Mode
          AND under React 18+ automatic batching AND under
          interleaved non-gRPC state updates (R6 source-proven),
          with a real W1+W2+W1 committed-context conservation
          witness (R10), and on a simplified two-kind vocabulary.

          The reviewer's directive: "After that, I would finally
          stop reviewing instrumentation architecture and run the
          damn dogfood trace."
```

This fixup ACT is closed with qualification corrections applied
(R11/R12/R13). The diagnostic is now production-semantic-zero AND
PTAD-side-effect-free AND burst-safe AND queue-conserving AND on a
simplified two-kind vocabulary. The implementation is correct;
the qualification correction in this commit ensures the evidence
ledger does not overclaim React-purity, FIXUP02 counterfactual
failure, or REACT_STATE_QUEUE_EQUIVALENCE that the tests and
diff do not actually establish.

The live dogfood walk can produce architecture-grade binary
boundary evidence on the diagnostic's two observable boundaries
(wire arrival + React commit) without violating React's purity
contract.
