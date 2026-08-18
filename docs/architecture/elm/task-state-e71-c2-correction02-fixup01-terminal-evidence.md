# C2-CORRECTION02-FIXUP01 Terminal Evidence

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP01-REACT-UPDATER-PURITY**

This is the terminal evidence for the fixup. The fixup addresses three
review issues from the E7.1 architecture walkthrough of the prior ACT:

- R1 (BLOCKING): diagnostic writes happened inside a `setState` updater
  function — impure, prone to React Strict Mode double-record.
- R2 (API misuse): `BoundaryClass` enum included `W3_POST_CONTEXT` even
  though the pure three-way `classifyBoundary` could never return it.
- R3 (doc rename): terminal evidence used `ENTRY_HEAD_AT_C2C2 = b40fa2477`
  where the actual ACT entry was `2f1a9999b` and `b40fa2477` was the
  build / dogfood-source head.

---

## 1. Identity

```text
C2R_SOURCE_HEAD                 = 2f1a9999b  (closure of C2-CORRECTION01)
C2C2_FIXUP01_ENTRY_HEAD         = ea5446a79  (closure of C2-CORRECTION02)
C2C2_FIXUP01_BUILD_HEAD         = 46bf32bcd  (React-updater purity fix)
C2C2_FIXUP01_REVIEW_HEAD        = 2b3f72413  (classifier split + StrictMode test)

(Commit chain:)
  a5775868e  docs(elm): C2-CORRECTION02-FIXUP01 plan + source recon
  46bf32bcd  fix(elm): React-updater purity
  2b3f72413  fix+test(elm): R2 classifier split + StrictMode cardinality

C2C2_FIXUP01_PLAN_DOC           = task-state-e71-c2-correction02-fixup01-plan.md
C2C2_FIXUP01_SOURCE_RECON_DOC   = task-state-e71-c2-correction02-fixup01-source-recon.md

VSIX_C2C2_FIXUP01_PATH          = dist/dogfood/clinemm-4.1.10-2b3f72413.vsix
                                   (built after commit 3; see below)

WORKTREE_CLEAN                  = true
PROTECTED_STASHES_INTACT        = true
  PROTECTED_STASH_FORENSIC      = 141372c52
  PROTECTED_STASH_CONTEXT       = 371752f71
```

Historical VSIX files preserved (5 prior + 1 this ACT):

```text
dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix    (RED smoke)
dist/dogfood/clinemm-4.1.10-df3c57edf.vsix    (interim fixture)
dist/dogfood/clinemm-4.1.10-dfab15b3f.vsix    (C2 live diagnostic)
dist/dogfood/clinemm-4.1.10-bc2c794be.vsix    (C2R closure)
dist/dogfood/clinemm-4.1.10-b40fa2477.vsix    (C2-CORRECTION02 raw-incoming)
dist/dogfood/clinemm-4.1.10-2b3f72413.vsix    (this ACT — React-updater purity)
```

---

## 2. R1 fix — what changed

### 2.1 Before (in C2-CORRECTION02, commit `b40fa2477`)

```ts
setState((prevState) => {
    ...
    // RAW emit — inside the updater
    if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {
        recordPostTerminalAuthoritySnapshot(buildWebviewSnapshot(stateData, stateData, "webview-raw-incoming"))
    }

    // ... reducer runs (mutates stateData.turnState in place) ...

    // APPLIED emit — inside the updater, after the reducer
    if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {
        recordPostTerminalAuthoritySnapshot(buildWebviewSnapshot(newState, rawStateDataSnapshot, "webview-replica"))
    }

    return newState
})
```

### 2.2 After (C2-CORRECTION02-FIXUP01, commit `46bf32bcd`)

```ts
// (NEW) Per-pushId ref map, declared near replicaRef
const pendingRawSnapshotsRef = useRef<Map<string, ExtensionState>>(new Map())

// (1) RAW emit — at the inbound boundary, OUTSIDE the updater:
onResponse: (response: any) => {
    ...
    if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {
        const pushId = stateData._ptadPushId ?? "no-push-id"
        // Shallow-clone to insulate from the reducer's in-place mutation
        pendingRawSnapshotsRef.current.set(pushId, { ...stateData, turnState: stateData.turnState })
        recordPostTerminalAuthoritySnapshot(buildWebviewSnapshot(stateData, stateData, "webview-raw-incoming"))
    }

    setState((prevState) => {
        // ... reducer runs (mutates stateData.turnState in place) ...
        return newState   // NO ring-buffer writes inside the updater
    })
}

// (2) APPLIED emit — from a post-commit useEffect, OUTSIDE the updater:
useEffect(() => {
    if (!isPostTerminalAuthorityDiagnosticEnabled("webview")) return
    const pushId = state._ptadPushId ?? "no-push-id"
    const rawSnap = pendingRawSnapshotsRef.current.get(pushId)
    if (!rawSnap) return
    pendingRawSnapshotsRef.current.delete(pushId)
    recordPostTerminalAuthoritySnapshot(buildWebviewSnapshot(state, rawSnap, "webview-replica"))
}, [state._ptadPushId, state])
```

### 2.3 Strict Mode behavior

Under React Strict Mode:

1. The component mounts twice on dev. Each mount's `onResponse`
   handler is a SEPARATE closure with its OWN
   `pendingRawSnapshotsRef`. The pushHandler dispatches the gRPC
   message to the LATEST registered closure; the prior mount's
   closure is unsubscribed. So each gRPC delivery produces EXACTLY
   ONE `webview-raw-incoming` capture, regardless of mount count.

   (Concretely, the StrictMode mount/unmount/remount cycle emits
   `subscribeToState` calls but only the last `unsubscribeFn` is
   the one our `pushHandler` references — see the test SM1.)

2. `setState((prevState) => { ... })` is invoked TWICE under Strict
   Mode and one result is discarded. But the updater is now PURE: it
   has no ring-buffer writes. The double-invocation is benign because
   the discarded return value produces no side effect.

3. The post-commit `useEffect` is also invoked TWICE on dev mount.
   The first invocation drains the entry from the ref map and emits
   the capture. The second invocation finds the map empty (the first
   invocation `delete`d the entry) and short-circuits with a no-op
   return. So EXACTLY ONE `webview-replica` capture is emitted per
   push, regardless of Strict Mode retries.

### 2.4 Wire shape (production default, PTAD OFF)

```text
_ptadEnabled          = undefined           (unchanged)
_ptadPushId           = undefined           (unchanged)
turnState             = unchanged           (no in-place mutation; reducer
                                            still applies seq-gating, just
                                            the diagnostic is moved out)
stateVersion          = undefined           (unchanged on the wire)

production setState body = pure (no ring-buffer writes)
```

Byte-for-byte identical to `b40fa2477` when the workspace-state PTAD
toggle is OFF. Zero production behavior change in the default build.

---

## 3. R2 fix — `ThreeBoundaryClass` / `BoundaryClass` split

```text
apps/vscode/src/shared/post-terminal-authority-diagnostic.ts
  :added   type ThreeBoundaryClass = "NO_DIVERGENCE" | "W1_PRE_APPLY" | "W2_DURING_APPLY" | "W4_MULTI_BOUNDARY"
  :added   type BoundaryClass = ThreeBoundaryClass | "W3_POST_CONTEXT"
  :added   function classifyFullBoundary(ext, raw, applied, consumer?) -> BoundaryClass
  :changed classifyBoundary() return type from BoundaryClass -> ThreeBoundaryClass

The pure helper has no W3 by construction (verified by TypeScript:
  const x: ThreeBoundaryClass = classifyBoundary(...);
  x = "W3_POST_CONTEXT"   // <-- type error at compile time
).
```

### 3.1 Comment correction (the misleading "raw==applied -> W3")

The old comment in the shared module read:

> rawIncoming == applied -> W3_POST_CONTEXT

This was misleading because W1 also has `raw == applied`. The fixup
replaces that comment with the precise rule:

> W3 requires extension == raw == applied AND a separate consumer
> capture that differs from the equal triple. Neither raw==applied
> alone nor any other equality pattern triggers W3.

The new `classifyFullBoundary()` is the only function that can return
W3, and it ONLY returns W3 when ALL THREE of (extension == raw ==
applied) AND consumer is provided AND consumer differs.

---

## 4. R3 fix — doc rename

The C2-CORRECTION02 terminal evidence used the term
`ENTRY_HEAD_AT_C2C2 = b40fa2477` which conflated three distinct
heads. The fixup renames:

```text
ENTRY_HEAD         = 2f1a9999b...   (C2 closure = start of C2-CORRECTION02)
BUILD_HEAD         = b40fa2477...   (the C2-CORRECTION02 build head)
CLOSURE_HEAD       = ea5446a79...   (closure of C2-CORRECTION02)
DOGFOOD_SOURCE_HEAD = b40fa2477...  (the head bound to the dogfood VSIX)

For this C2-CORRECTION02-FIXUP01 ACT:
ENTRY_HEAD         = ea5446a79...   (closure of C2-CORRECTION02)
BUILD_HEAD         = 46bf32bcd...   (the R1 fix head)
REVIEW_HEAD        = 2b3f72413...   (the R2 + StrictMode fix head)
CLOSURE_HEAD       = 2b3f72413...   (= REVIEW_HEAD for this fixup)
DOGFOOD_SOURCE_HEAD = 2b3f72413...  (the head bound to the new VSIX)
```

The renamed file is `task-state-e71-c2-correction02-terminal-evidence.md`
(updated in section "Identity (binding-confirmed)" — see git diff for
the exact change).

---

## 5. Test results

### 5.1 Schema-side (apps/vscode)

```text
post-terminal-authority-diagnostic.test.ts                  10 tests pass   (frozen)
post-terminal-authority-diagnostic.correction02.test.ts    14 tests pass   (+5)

Total: 24 tests, 0 fail.

The 5 new tests:
  C6  pure classifyBoundary returns ThreeBoundaryClass; W3 unreachable from triple
  C7  W3 selected when triple is equal AND consumer capture differs
  C8  NO_DIVERGENCE when triple is equal AND no consumer provided
  C9  NO_DIVERGENCE when triple is equal AND consumer equals triple
  C10 classifyFullBoundary forwards three-way divergence to the underlying classifier
```

### 5.2 Webview-ui production-composition replay

```text
c2-correction02-composition.test.tsx                 4 tests pass   (frozen)
c2-correction02-fixup01-strictmode.test.tsx          2 tests pass   (NEW)
c2-replay-red.test.ts                                7 tests pass   (frozen)
```

The 2 new StrictMode tests prove R1:

- `SM1`: drives the E1-E6 sequence inside `<StrictMode><Provider /></StrictMode>`.
  Asserts EXACTLY N raw records AND EXACTLY N applied records, AND each
  pushId appears exactly once in each ring. This is the cardinality
  contract `webview-raw-incoming(P) = 1` and `webview-replica(P) = 1`
  PROVEN UNDER React Strict Mode.

- `SM2`: single push regression check — exactly one raw record AND one
  applied record even though `<StrictMode>` invokes the useEffect twice
  on dev mount.

### 5.3 Full webview-ui test suite

```text
Test Files  67 passed (67)
Tests       553 passed (553)     (+2 new; previous: 551)
```

### 5.4 TypeScript / Biome / ESLint

```text
NEW_TS_ERRORS  = 0
NEW_BIOME_ERR  = 0
NEW_ESLINT_ERR = 0
```

---

## 6. Acceptance matrix (final)

```text
F0   impurity removed from setState updater                  PASS
F1   raw capture at inbound handler (pre-setState)           PASS
F2   applied capture fires from useEffect (post-commit)      PASS
F3   pushId map persists raw for post-commit useEffect       PASS
F4   wire shape unchanged when PTAD off                      PASS
F5   R2: ThreeBoundaryClass + FullBoundaryClass split        PASS
F6   R3: heads renamed (entry / build / closure / dogfood)   PASS
F7   React.StrictMode cardinality test (1 raw+applied/push)  PASS
F8   existing 11 tests still pass                            PASS
F9   exact-HEAD VSIX built with `fixup01` short SHA          PASS  (2b3f72413)
F10  protected stashes intact                                PASS
F11  worktree clean                                          PASS
```

---

## 7. Verdict

```text
PASS_C2_CORRECTION02_FIXUP01

R1 (PTAD outside the React updater)               = FIXED + REACT-STRICTMODE-PROVEN
R2 (API misuse of W3 in pure helper)              = FIXED + TYPESCRIPT-TYPECHECKED
R3 (head-naming in C2-CORRECTION02 terminal doc)   = FIXED

CAUSE_CLASS_FOR_C2_CORRECTION02                   = UNKNOWN  (still requires the live dogfood walk)

NEXT_ACT                                            = live dogfood walk on the new HEAD
                                                       (2b3f72413) VSIX; the diagnostic is
                                                       now cardinality-safe under React
                                                       Strict Mode, so the live walk can
                                                       produce architecture-grade binary
                                                       boundary evidence.
```

This fixup ACT is closed. The diagnostic is now quality-improved on
all three review dimensions and is ready to drive the live dogfood walk.
