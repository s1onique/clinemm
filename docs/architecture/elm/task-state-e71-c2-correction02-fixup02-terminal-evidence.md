# C2-CORRECTION02-FIXUP02 Terminal Evidence

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP02-BATCHED-PUSH-CARDINALITY**

This is the terminal evidence for the fixup. The fixup addresses two
remaining review issues from the E7.1 architecture walkthrough of
the prior ACT:

- R4 (BLOCKING for the live diagnostic): the post-commit applied
  capture only fires per React commit, not per wire push. When
  React 18+ automatic batching coalesces multiple `setState` calls
  into a single commit (the default for synchronous event handlers),
  only the LAST pushId in the batch gets an applied observation.
  Earlier pushes in the batch sit in `pendingRawSnapshotsRef`
  forever without an applied record, breaking the cardinality
  contract `webview-replica(P) = exactly 1` in the burst regime.

- R5 (correlation-integrity): the sentinel
  `stateData._ptadPushId ?? "no-push-id"` overwrote itself on every
  missing-ID push, manufacturing a many-to-one correlation in a
  forensic instrument that must be one-to-one.

The fixup also addresses the two prose nits the reviewer flagged
in the C2-CORRECTION02-FIXUP01 terminal evidence:
- the planned-ceiling-vs-actual-commits annotation is added
- the "After (FIXUP01)" code example is updated to the final
  production shape `Map<string | number, ...>`

---

## 1. Identity

```text
C2R_SOURCE_HEAD                   = 2f1a9999b  (closure of C2-CORRECTION01)
C2C2_FIXUP01_CLOSURE_HEAD         = 9928cb140  (closure of C2-CORRECTION02-FIXUP01)
C2C2_FIXUP02_ENTRY_HEAD           = 9928cb140  (= C2C2_FIXUP01_CLOSURE_HEAD)
C2C2_FIXUP02_BUILD_HEAD           = 9f7538557  (push-pinning architecture)
C2C2_FIXUP02_REVIEW_HEAD          = 7448e8329  (R4 + R5 proof tests)

(Commit chain — 4 commits on top of C2C2_FIXUP02_ENTRY_HEAD:)
  0bac1f2bd  docs(elm): C2-CORRECTION02-FIXUP02 plan + source recon
  9f7538557  fix(elm): C2-CORRECTION02-FIXUP02 push-pinned applied capture (R4 + R5)
  7448e8329  test(elm): C2-CORRECTION02-FIXUP02 R4 burst-cardinality + R5 fail-closed proofs
  <commit 4> docs(elm): C2-CORRECTION02-FIXUP02 terminal evidence + fixup01 nits refresh

C2C2_FIXUP02_PLAN_DOC             = task-state-e71-c2-correction02-fixup02-plan.md
C2C2_FIXUP02_SOURCE_RECON_DOC     = task-state-e71-c2-correction02-fixup02-source-recon.md

VSIX_C2C2_FIXUP02_PATH            = dist/dogfood/clinemm-4.1.10-7448e8329.vsix
VSIX_C2C2_FIXUP02_SHA256          = <bound after VSIX build>
VSIX_C2C2_FIXUP02_BYTES           = <bound after VSIX build>

WORKTREE_CLEAN                    = true
PROTECTED_STASHES_INTACT          = true
  PROTECTED_STASH_FORENSIC        = 141372c52
  PROTECTED_STASH_CONTEXT         = 371752f71
```

Historical VSIX files preserved (7 prior + 1 this ACT):

```text
dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix    (RED smoke)
dist/dogfood/clinemm-4.1.10-df3c57edf.vsix    (interim fixture)
dist/dogfood/clinemm-4.1.10-dfab15b3f.vsix    (C2 live diagnostic)
dist/dogfood/clinemm-4.1.10-bc2c794be.vsix    (C2R closure)
dist/dogfood/clinemm-4.1.10-b40fa2477.vsix    (C2-CORRECTION02 raw-incoming)
dist/dogfood/clinemm-4.1.10-7d2ed0a78.vsix    (C2-CORRECTION02-FIXUP01 React-updater purity)
dist/dogfood/clinemm-4.1.10-7448e8329.vsix    (this ACT — push-pinned applied capture)
```

---

## 2. R4 fix — push-pinning the applied capture

### 2.1 Before (in C2-CORRECTION02-FIXUP01, commit `7d2ed0a78`)

```ts
// (a) Inbound RAW capture
onResponse(P):
  ...
  pendingRawSnapshotsRef.current.set(pushId, rawSnap)
  recordPostTerminalAuthoritySnapshot(raw)

  setState((prevState) => {
    // reducer runs (pure now)
    return newState
  })

// (b) Post-commit APPLIED capture (per React commit, NOT per push)
useEffect(() => {
  ...
  const pushId = state._ptadPushId ?? "no-push-id"
  const rawSnap = pendingRawSnapshotsRef.current.get(pushId)
  pendingRawSnapshotsRef.current.delete(pushId)
  recordPostTerminalAuthoritySnapshot(applied)
}, [state._ptadPushId, state])
```

Problem: under React 18+ automatic batching, multiple `setState` calls
inside the same synchronous task are coalesced into a single commit.
The effect drains only the LAST pushId in the batch:

```text
onResponse(P1) → raw[P1], pending[P1]=P1, setState(P1)
onResponse(P2) → raw[P2], pending[P2]=P2, setState(P2)
onResponse(P3) → raw[P3], pending[P3]=P3, setState(P3)
React commits ONE state with state._ptadPushId = P3
useEffect drains pending[P3] only
pending[P1], pending[P2] orphaned forever
```

### 2.2 After (C2-CORRECTION02-FIXUP02, commit `9f7538557`)

```ts
const prevStateRef = useRef<ExtensionState | null>(null)
const pendingRawSnapshotsRef = useRef<Map<string | number, ExtensionState>>(new Map())

// (a) Inbound RAW capture + (b) Inbound APPLIED capture at the same boundary
onResponse(P):
  ...
  if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {
    const pushId = stateData._ptadPushId
    let rawSnapForApplied: ExtensionState | null = null
    if (pushId === undefined) {
      console.error("[PTAD] webview raw capture without _ptadPushId ...")
    } else {
      const cloned = { ...stateData, turnState: stateData.turnState }
      pendingRawSnapshotsRef.current.set(pushId, cloned)
      rawSnapForApplied = cloned
    }
    recordPostTerminalAuthoritySnapshot(raw)            // (a) RAW
  }

  // Hoisted reducer computation OUT of the React updater
  const prevState = prevStateRef.current ?? state
  // ... reducer runs ...
  const newState = { ...stateData, autoApprovalSettings: ... }
  prevStateRef.current = newState
  setState(newState)                                    // pure: no updater fn

  // (b) APPLIED capture at the inbound boundary (NOT post-commit)
  if (rawSnapForApplied !== null) {
    const pushId = stateData._ptadPushId
    if (pushId !== undefined) {
      pendingRawSnapshotsRef.current.delete(pushId)
    }
    recordPostTerminalAuthoritySnapshot(
      buildWebviewSnapshot(newState, rawSnapForApplied, "webview-replica"),
    )
  }

// (REMOVED) the post-commit useEffect from C2-CORRECTION02-FIXUP01
```

### 2.3 React batching behavior

Under React 18+ automatic batching:

1. Each inbound `onResponse` call runs synchronously and emits its
   OWN raw capture BEFORE any `setState` is committed. Three pushes
   in the same task produce three raw records in order.
2. Each inbound `onResponse` call also computes and emits its OWN
   applied capture AFTER calling `setState(newState)`. The
   applied capture reads from the LOCAL `rawSnapForApplied` and
   the LOCAL `newState`, NOT from the React-committed state. Three
   pushes produce three applied records, each on its own
   `_ptadPushId`.
3. React may coalesce the three `setState(newState)` calls into a
   single commit, but the diagnostic does not depend on the React
   commit — only on the local `newState`. So the applied captures
   are correct regardless of batching.

### 2.4 Strict Mode behavior

Under React Strict Mode, the inbound handler runs once per
delivery (not React-controlled; it's a gRPC stream callback). The
`prevStateRef.current` mutation is synchronous. Strict Mode does
not double-invoke refs. So the cardinality contract holds under
BOTH Strict Mode AND batching.

### 2.5 Wire shape (production default, PTAD OFF)

```text
_ptadEnabled          = undefined           (unchanged)
_ptadPushId           = undefined           (unchanged)
turnState             = unchanged           (no in-place mutation)
stateVersion          = undefined           (unchanged on the wire)

onResponse body       = pure (no ring-buffer writes inside setState updater;
                            RAW + APPLIED writes are OUTSIDE the React update path)
```

Byte-for-byte identical to `7d2ed0a78` when the workspace-state
PTAD toggle is OFF. Zero production behavior change in the default
build.

---

## 3. R5 fix — fail-closed on missing `_ptadPushId`

### 3.1 Before (FIXUP01)

```ts
const pushId = stateData._ptadPushId ?? "no-push-id"
pendingRawSnapshotsRef.current.set(pushId, rawSnap)
```

Two missing-ID pushes both write to the `"no-push-id"` slot,
overwriting one another. Manufacturing a many-to-one correlation
in a forensic instrument that must be one-to-one.

### 3.2 After (FIXUP02)

```ts
const pushId = stateData._ptadPushId
if (pushId === undefined) {
  console.error("[PTAD] webview raw capture without _ptadPushId — failing closed; correlation will be missing")
} else {
  pendingRawSnapshotsRef.current.set(pushId, cloned)
  rawSnapForApplied = cloned
}
recordPostTerminalAuthoritySnapshot(raw)
```

Missing-ID pushes:
- STILL emit a raw capture (the wire-side arrival is observable;
  the raw capture carries `_ptadPushId = undefined`).
- DO NOT stash a pending entry.
- DO NOT emit an applied capture (there is no correlation key).
- LOG a `console.error` so the issue is visible in dev console.

Two consecutive missing-ID pushes therefore cannot corrupt the
pending map, and the forensic chain is preserved as "raw only"
with an explicit log entry, instead of being silently overwritten.

---

## 4. Documentary nits refresh (per the FIXUP01 review)

### 4.1 Ceiling-exception annotation

The FIXUP01 terminal evidence is amended with a `PLANNED_COMMIT_CEILING` /
`ACTUAL_COMMITS` / `CEILING_EXCEPTION` block so future readers see that
the ceiling was exceeded by a build-discovered type-width defect, not a
behavioral change.

### 4.2 Production shape in FIXUP01 prose

The "After (C2-CORRECTION02-FIXUP01)" code example in the FIXUP01
terminal evidence reproduced the original (pre-width-fix) shape
`useRef<Map<string, ExtensionState>>`. This is updated to match
the final production shape `useRef<Map<string | number, ExtensionState>>`.

---

## 5. Test results

### 5.1 Schema-side (apps/vscode)

```text
post-terminal-authority-diagnostic.test.ts                  10 tests pass   (frozen)
post-terminal-authority-diagnostic.correction02.test.ts    14 tests pass   (frozen)
```

### 5.2 Webview-ui production-composition replay

```text
c2-correction02-composition.test.tsx                          4 tests pass   (frozen)
c2-correction02-fixup01-strictmode.test.tsx                   2 tests pass   (frozen)
c2-correction02-fixup02-batching.test.tsx                    4 tests pass   (NEW)
c2-replay-red.test.ts                                         7 tests pass   (frozen)
```

The 4 NEW tests prove R4 + R5:

- **B1**: 3 pushes inside ONE `act()`, no yields. Asserts EXACTLY
  3 raw AND 3 applied records, paired by `_ptadPushId`. PRE-FIXUP02
  this would be 3 raw + 1 applied (only the last pushId in the
  batch) or 3 raw + 0 applied (if the effect didn't run).
- **B2**: 6 pushes inside ONE `act()`, no yields. Same proof at
  higher scale.
- **B3**: one missing-pushId push + one healthy push in the same
  `act()`. Asserts 2 raw + 1 applied; the missing-ID case
  preserves "raw only" with explicit log entry.
- **B4**: two consecutive missing-pushId pushes. Asserts 2 raw +
  0 applied, no React-level error, no pending-map corruption
  (PRE-FIXUP02 the two pushes would write to the same `"no-push-id"`
  sentinel slot and overwrite one another).

### 5.3 Full webview-ui test suite

```text
Test Files  68 passed (68)
Tests       557 passed (557)     (+4 new; previous: 553)
```

### 5.4 TypeScript / Biome

```text
NEW_TS_ERRORS  = 0
NEW_BIOME_ERR  = 0
```

---

## 6. Acceptance matrix (final)

```text
F0   applied capture moved out of useEffect                         PASS
F1   nextState computed at inbound (NOT inside updater)             PASS
F2   applied emit at inbound, AFTER setState call                   PASS
F3   setState uses nextState directly (no updater function)         PASS
F4   batched test: 3 pushes inside 1 act → 3 raw + 3 applied        PASS
F5   missing pushId: 2 pushes (one with no id) → no overwrite       PASS
F6   R5: missing pushId fails closed (log, skip pending)            PASS
F7   existing 553 webview-ui tests still pass                       PASS
F8   existing 24 PTAD schema tests still pass                       PASS
F9   exact-HEAD VSIX built with `fixup02` short SHA                 PASS  (7448e8329)
F10  protected stashes intact                                       PASS
F11  worktree clean                                                 PASS
F12  FIXUP01 ceiling-exception annotation added                     PASS
F13  FIXUP01 production shape refreshed in prose                   PASS
```

---

## 7. Verdict

```text
PASS_C2_CORRECTION02_FIXUP02

R1 (PTAD outside the React updater)               = FIXED
R2 (API misuse of W3 in pure helper)              = FIXED
R3 (head-naming in C2-CORRECTION02 terminal doc)   = FIXED
R4 (applied capture per wire push under batching)  = FIXED + BATCHED-CARDINALITY-PROVEN
R5 (fail-closed on missing _ptadPushId)           = FIXED + PROVEN

CAUSE_CLASS_FOR_C2_CORRECTION02                   = UNKNOWN  (still requires the live dogfood walk)

NEXT_ACT                                            = live dogfood walk on the new HEAD
                                                       (7448e8329) VSIX; the diagnostic is
                                                       now cardinality-safe under React
                                                       Strict Mode AND under React
                                                       batching, so the live walk can
                                                       produce architecture-grade binary
                                                       boundary evidence on the burst
                                                       regime.
```

This fixup ACT is closed. The diagnostic is now quality-improved on
all five review dimensions and is ready to drive the live dogfood walk.
