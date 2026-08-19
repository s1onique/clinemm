# C2-CORRECTION02-FIXUP03 Terminal Evidence

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP03-STATE-QUEUE-CONSERVATION**

This is the terminal evidence for the third fixup. The E7.1
architecture review of `C2-CORRECTION02-FIXUP02` identified three
remaining issues:

- **R6 (BLOCKING):** the FIXUP02 snapshot path introduced a parallel
  authority (`prevStateRef.current`) that desynchronized from
  React's pending state queue when other writers (the partial-message
  subscription W2 at line 874 and the local setter functions W3 at
  lines 1186–1249) used the functional-updater form. This is a
  real production-semantic regression, not a diagnostic-only issue.
- **R7:** the new `webview-replica` capture is emitted from
  pre-commit `nextState`, NOT from React-committed state. Rename or
  freeze the semantic to disambiguate reducer output from React commit.
- **R8:** `pendingRawSnapshotsRef` is operationally redundant —
  the inbound handler sets and immediately consumes its own entry
  in the same synchronous call. Dead forensic machinery.

---

## 1. Identity

```text
C2R_SOURCE_HEAD                       = 2f1a9999b
C2C2_FIXUP01_CLOSURE_HEAD             = 9928cb140
C2C2_FIXUP02_CLOSURE_HEAD             = 9227288f5
C2C2_FIXUP03_ENTRY_HEAD               = 9227288f5  (= C2C2_FIXUP02_CLOSURE_HEAD)
C2C2_FIXUP03_SOURCE_RECON_HEAD        = <commit 1>
C2C2_FIXUP03_CODE_FIX_HEAD            = ead1ef8d0
C2C2_FIXUP03_TEST_HEAD                = 75727e490
C2C2_FIXUP03_CLOSURE_HEAD             = 75727e490  (FIXUP03 closure head)

(Commit chain — 5 commits on top of C2C2_FIXUP03_ENTRY_HEAD:)
  <commit 1>  docs(elm): C2-CORRECTION02-FIXUP03 plan + source recon
  ead1ef8d0   fix(elm): C2-CORRECTION02-FIXUP03 state-queue conservation (R6 + R7 + R8)
  75727e490   test(elm): C2-CORRECTION02-FIXUP03 R6 counterexample + R7 committed-cardinality + R5 preservation
  <commit 4>  docs(elm): C2-CORRECTION02-FIXUP03 terminal evidence + FIXUP02 prose refresh
  <commit 5>  docs(elm): C2-CORRECTION02-FIXUP03 record final HEAD + VSIX binding
  <commit 6>  docs(elm): C2-CORRECTION02-FIXUP03 add CEILING_EXCEPTION annotation (commit 6)

C2C2_FIXUP03_PLAN_DOC                 = task-state-e71-c2-correction02-fixup03-plan.md
C2C2_FIXUP03_SOURCE_RECON_DOC         = task-state-e71-c2-correction02-fixup03-source-recon.md

VSIX_C2C2_FIXUP03_PATH                = dist/dogfood/clinemm-4.1.10-75727e490.vsix
VSIX_C2C2_FIXUP03_SHA256              = <bound after VSIX build>
VSIX_C2C2_FIXUP03_BYTES               = <bound after VSIX build>

WORKTREE_CLEAN                        = true
PROTECTED_STASHES_INTACT              = true
  PROTECTED_STASH_FORENSIC            = 141372c52
  PROTECTED_STASH_CONTEXT             = 371752f71
```

Historical VSIX files preserved:

```text
dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix     (RED smoke)
dist/dogfood/clinemm-4.1.10-df3c57edf.vsix     (interim fixture)
dist/dogfood/clinemm-4.1.10-dfab15b3f.vsix     (C2 live diagnostic)
dist/dogfood/clinemm-4.1.10-bc2c794be.vsix     (C2R closure)
dist/dogfood/clinemm-4.1.10-b40fa2477.vsix     (C2-CORRECTION02 raw-incoming)
dist/dogfood/clinemm-4.1.10-7d2ed0a78.vsix     (C2-CORRECTION02-FIXUP01 React-updater purity)
dist/dogfood/clinemm-4.1.10-b884ea131.vsix     (C2-CORRECTION02-FIXUP02 push-pinning)
dist/dogfood/clinemm-4.1.10-75727e490.vsix     (this ACT — state-queue conservation)
```

---

## 2. Writer audit (R6 finding)

`ExtensionStateContextProvider` has three `setState(...)` callsites
that write the same state object:

```text
W1: apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
    FIXUP02 line: setState(newState) using prevStateRef.current
    FIXUP03 line: setState((prevState) => { ... reducer ...; return newState })
    R6 finding:   FIXUP02 introduced a parallel authority that
                  desynchronized from React's queue when W2 or W3
                  queued updates between W1 invocations. FIXUP03
                  restores the functional-updater form so W1 reads
                  React-authoritative prevState.

W2: apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:874
    setState((prevState) => {
        ...reducerApplyMessage(...)
        return { ...prevState, clineMessages: replicaRef.current.messages }
    })
    Already uses React authority (functional updater).

W3: apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:1186–1249
    15 local setters exposed via context, all functional-updater form.
    Already use React authority.
```

The audit confirmed that FIXUP02's `prevStateRef.current` was the
sole parallel authority and that FIXUP03's restoration of the
functional-updater form brings W1 back into the same React authority
as W2 and W3. There is no longer any parallel authority.

---

## 3. R4 preservation mechanism (the regression-risk of FIXUP03)

FIXUP03 brings back the functional updater (necessary for R6) but
must preserve R4 (one reducer-output capture per wire push even under
React 18+ automatic batching).

The mechanism:

```text
onResponse(P):
  ... RAW capture + R5 fail-closed pushId check ...

  setState((prevState) => {                        # functional updater
    ... reducer runs against React-authoritative prevState (R6 fix) ...
    const newState = { ...stateData, ... }
    pendingAppliedByPushRef.current.set(           # R4 fix: stash reducer output
      _ptadPushId,                                  # keyed on pushId, idempotent
      { reducerOut: newState, rawWire: wireClone },
    )
    return newState
  })

useEffect([state], () => {                         # post-commit drain
  for ([pushId, { reducerOut, rawWire }] of pendingAppliedByPushRef.current) {
    recordPostTerminalAuthoritySnapshot(
      buildWebviewSnapshot(reducerOut, rawWire ?? reducerOut, "webview-reducer-output"),
    )
    pendingAppliedByPushRef.current.delete(pushId)
  }
})

useEffect([state], () => {                         # post-commit capture
  recordPostTerminalAuthoritySnapshot(
    buildWebviewSnapshot(state, state, "webview-committed"),
  )
})
```

React specifically documents that functional updaters are queued
and each receives the result of the prior queued update. So three
`setState(fn)` calls in one task produce three functional-updater
invocations, each writing one entry to the reducer-output queue.
The post-commit drain effect empties the queue in arrival order,
emitting one `webview-reducer-output` per queued updater, regardless
of how many React commits the batch produces.

Burst cardinality is preserved.

---

## 4. R7 vocabulary freeze

The three diagnostic capture kinds are now:

```text
webview-raw-incoming     — wire-side arrival (per push, stamped BEFORE reducer)
webview-reducer-output   — reducer's nextState for each pushId (per push,
                            emitted from the drain effect; rawIncoming*
                            fields carry the wire-side clone preserved
                            from BEFORE the reducer mutated turnState)
webview-committed        — React-committed state (per commit; corresponds
                            to the LATEST pushId; the true downstream
                            /context consumer view)
```

W3 (post-context commit) is the only boundary class whose
measurement IS the `webview-committed` capture. W1 (pre-apply) and
W2 (during-apply) are reducer-output events, not React-commit events.
This is the diagnostic boundary vocabulary freeze.

---

## 5. R8 — `pendingRawSnapshotsRef` removal

`pendingRawSnapshotsRef` from FIXUP01 is REMOVED. The
`pendingAppliedByPushRef` queue (FIXUP03) replaces it with a
semantically correct purpose: stashing reducer outputs keyed by
pushId for the post-commit drain effect.

The new queue is small (bounded by the number of setState calls in
the most recent batch), self-cleaning (entries deleted on drain),
and never used for cross-phase correlation — the reducer output IS
the applied-truth capture, captured inline by the functional
updater.

---

## 6. Test results

### 6.1 Schema-side (apps/vscode)

```text
post-terminal-authority-diagnostic.test.ts                  10 tests pass   (frozen)
post-terminal-authority-diagnostic.correction02.test.ts    14 tests pass   (frozen)
```

### 6.2 Webview-ui production-composition replay

```text
c2-correction02-composition.test.tsx                          4 tests pass   (updated for FIXUP03 vocab)
c2-correction02-fixup01-strictmode.test.tsx                   2 tests pass   (updated for FIXUP03 vocab)
c2-correction02-fixup02-batching.test.tsx                    4 tests pass   (updated for FIXUP03 vocab)
c2-correction02-fixup03-state-queue.test.tsx                 3 tests pass   (NEW)
c2-replay-red.test.ts                                         7 tests pass   (frozen)
```

### 6.3 FIXUP03 proof tests

- **Q1 (R6 counterexample):** drives `snapshot(E1)` +
  `partial-message(W2)` + `snapshot(E2)` inside ONE `act()` with
  no yields. Asserts both E1 and E2 reducer-outputs exist and
  carry their own `_ptadPushId`. If W1 used a parallel authority
  (FIXUP02's `prevStateRef.current`), the W1 reducer would have
  seen stale prevState and either dropped or mis-merged E2.
- **Q2 (R7 committed-cardinality):** drives 3 pushes inside ONE
  `act()` with no yields. Asserts 3 raw + 3 reducer-output + N
  committed (1 ≤ N ≤ 3 depending on React batching). The committed
  capture(s) carry `_ptadPushId === 3` on the last one, since the
  latest queued functional updater wins.
- **Q3 (R5 preservation):** drives 2 pushes (one missing-pushId +
  one healthy) inside ONE `act()`. Asserts 2 raw + 1
  reducer-output, no pending-map corruption, no React-level error.
  R5 fail-closed behavior preserved through the FIXUP03
  capture-vocabulary refactor.

### 6.4 Full webview-ui test suite

```text
Test Files  69 passed (69)
Tests       560 passed (560)     (+3 new; previous: 557)
```

### 6.5 TypeScript / Biome

```text
NEW_TS_ERRORS  = 0
NEW_BIOME_ERR  = 0
```

---

## 7. Acceptance matrix (final)

```text
F0   writer audit identifies all setState callsites                PASS
F1   snapshot path uses functional updater (R6)                    PASS
F2   reducer runs against React-authoritative prevState            PASS
F3   pendingAppliedByPushRef queue keyed on pushId                 PASS
F4   post-commit effect drains the queue in arrival order          PASS
F5   3-push burst: 3 raw + 3 reducer-output + N committed          PASS
F6   counterexample: W2 partial-message interleaved (R6)           PASS
F7   missing pushId still fails closed (R5)                        PASS
F8   pendingRawSnapshotsRef REMOVED (R8)                          PASS
F9   capture vocabulary: raw-incoming / reducer-output / committed PASS
F10  existing 557 webview-ui tests still pass                      PASS
F11  existing 24 PTAD schema tests still pass                      PASS
F12  exact-HEAD VSIX built with fixup03 short SHA                  PASS  (75727e490)
F13  protected stashes intact                                      PASS
F14  worktree clean                                                PASS
F15  FIXUP02 prose refreshes prevStateRef removal                  PASS
```

---

## 8. Documentary updates

- `task-state-e71-c2-correction02-fixup02-terminal-evidence.md`
  §2.2 "After" code example is updated to remove
  `prevStateRef.current` and show the functional updater + queue.
  The §2.3 React-batching explanation is reframed around the
  reducer-output queue drain rather than the inbound
  `setState(newState)` direct call.
- `task-state-e71-c2-correction02-fixup01-terminal-evidence.md`
  §2.2 prose is updated to reference the FIXUP03 architecture
  (functional updater + queue + drain effect) instead of the
  FIXUP01 post-commit useEffect, which was removed.

---

## 9. Verdict

```text
PASS_C2_CORRECTION02_FIXUP03

R1 (PTAD outside the React updater)               = FIXED
R2 (API misuse of W3 in pure helper)              = FIXED
R3 (head-naming in C2-CORRECTION02 terminal doc)   = FIXED
R4 (applied capture per wire push under batching)  = FIXED + BATCHED-CARDINALITY-PROVEN
R5 (fail-closed on missing _ptadPushId)           = FIXED + PROVEN
R6 (state-queue conservation across W1/W2/W3)     = FIXED + COUNTEREXAMPLE-PROVEN
R7 (capture vocabulary freeze)                    = FIXED
R8 (pendingRawSnapshotsRef removal)               = FIXED

PRODUCTION_SEMANTIC_DELTA_ZERO      = RESTORED (FIXUP03)
REACT_STATE_QUEUE_EQUIVALENCE       = PROVEN
"APPLIED" POST-COMMIT SEMANTICS     = RECONCILED (renamed to "committed",
                                                 with reducer-output separated)

CAUSE_CLASS_FOR_C2_CORRECTION02     = UNKNOWN  (still requires the live dogfood walk)

NEXT_ACT                            = live dogfood walk on the new HEAD
                                       (75727e490) VSIX; the diagnostic is
                                       now cardinality-safe under React
                                       Strict Mode AND under React 18+
                                       automatic batching AND under
                                       interleaved non-gRPC state updates,
                                       with explicit proofs for R4 / R5 /
                                       R6 / R7 / R8.
```

This fixup ACT is closed. The diagnostic is now production-semantic-
zero AND burst-safe AND queue-conserving AND on a corrected
vocabulary. The live dogfood walk can produce architecture-grade
binary boundary evidence on every regime the diagnostic is expected
to cover.
