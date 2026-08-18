# C2-CORRECTION02-FIXUP02 Source Recon

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP02-BATCHED-PUSH-CARDINALITY**

This is the source-recon doc for the fixup. It freezes the exact line
ranges where the React-batching hole and the sentinel-key hole live in
the current code (`9928cb140`) and the call sites that need to move.

---

## 1. Existing capture sites (the broken ones)

### 1.1 R4 — post-commit applied capture collapses burst

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  :589-598  RAW capture at inbound onResponse              (correct)
  :600-650  setState((prevState) => { ... })                (pure now)
  :996-1010 useEffect keyed on [state._ptadPushId, state]   (WRONG for batched)
```

The useEffect drains `pendingRawSnapshotsRef.current.get(pushId)` for
the pushId carried by the *currently committed* state. When React
batches multiple `setState` calls into a single commit, only the
LAST pushId is visible in `state._ptadPushId`. The earlier pushes
(P1, P2 in the example below) sit forever in the pending map and
never get an applied capture.

```text
onResponse(P1): raw[P1] emitted; pending[P1]=raw; setState(P1)
onResponse(P2): raw[P2] emitted; pending[P2]=raw; setState(P2)
onResponse(P3): raw[P3] emitted; pending[P3]=raw; setState(P3)
React commits → state._ptadPushId = P3
useEffect drains pending[P3]  ← only one applied emit
pending[P1], pending[P2]       ← orphaned forever
```

### 1.2 R5 — sentinel key creates many-to-one correlation

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  :590  const pushId = stateData._ptadPushId ?? "no-push-id"
  :591  pendingRawSnapshotsRef.current.set(pushId, rawSnap)
```

Every push without `_ptadPushId` writes to the SAME `"no-push-id"`
slot. Two missing-ID pushes overwrite one another. The Factory
evidence model requires one-to-one correlation, so the sentinel
must fail closed.

---

## 2. Required moves

### 2.1 R4 — applied capture at inbound boundary

The applied snapshot must be emitted ONCE PER PUSH, regardless of
React batching. The architecture moves the reducer computation
OUT of the setState updater so the inbound handler can compute
`nextState` itself, then both call `setState(nextState)` (without
an updater) AND emit the applied capture from the locally-captured
`pendingAppliedTruth[P]`.

The setState updater is removed entirely. The component holds the
"prevState" via a separate ref so the inbound handler can compute
the next state directly.

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  :NEW  let prevStateRef = useRef<ExtensionState>(initialState)   // new ref

  :NEW  onResponse(P):
          ... existing toggle symmetry, raw capture, pushId read ...

          // Compute next state OUTSIDE the React updater:
          let nextState = computeNextState(prevStateRef.current, P, stateData)

          prevStateRef.current = nextState
          setState(nextState)        // pure: no updater function

          // Emit applied AT THE INBOUND BOUNDARY (NOT post-commit):
          if (pendingAppliedTruth.has(P)) {
              let appliedSnap = pendingAppliedTruth.get(P)
              recordPostTerminalAuthoritySnapshot(
                  buildWebviewSnapshot(nextState, rawSnap, "webview-replica"))
              pendingAppliedTruth.delete(P)
          }
```

The `useEffect` at line 996 is REMOVED entirely.

### 2.2 R5 — fail closed on missing pushId

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  :NEW  if (stateData._ptadPushId === undefined) {
            // Fail closed: log to console.error, DO NOT manufacture
            // correlation. The raw capture still emits (with
            // _ptadPushId = undefined) so the diagnostic captures the
            // arrival, but no pending entry is set and no applied
            // capture is emitted (since there is no correlation key).
            console.error("[PTAD] webview raw capture without _ptadPushId",
                          "— failing closed; correlation will be missing")
        } else {
            const pushId = stateData._ptadPushId
            pendingRawSnapshotsRef.current.set(pushId, rawSnap)
        }
```

### 2.3 React batching behavior

Under React 18+ automatic batching, multiple `setState` calls
inside the same synchronous task (including inside a single
`onResponse` callback that schedules multiple `setState` calls) are
coalesced into a single commit. The new architecture works BECAUSE:

1. RAW emits happen synchronously at each inbound delivery (one per
   `onResponse` call), regardless of when React commits.
2. APPLIED emits also happen synchronously at each inbound delivery,
   but they read from `pendingAppliedTruth[P]` which was populated
   for that specific pushId.

So even when React batches three `setState` calls into one commit,
each inbound handler has already emitted its own raw AND applied
capture, in order, before React runs the batched commit.

### 2.4 Strict Mode behavior

Under React Strict Mode, the inbound handler runs once per delivery
(not React-controlled; it's a gRPC stream callback). The
`prevStateRef` mutation is the only state mutation, and it is
synchronous. Strict Mode does not double-invoke refs. So the
cardinality contract holds under Strict Mode AND under batching.

---

## 3. R4 + R5 source edits

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  :REMOVE   useEffect at line 996 (the post-commit applied capture)
  :ADD      prevStateRef = useRef(initialState)
  :REPLACE  setState((prevState) => { ... }) with setState(nextState)
  :HOIST    the reducer computation (replicaRef.current = reducerApplyStateSnapshot(...))
            and newState assembly out of the updater to onResponse
  :CHANGE   const pushId = stateData._ptadPushId ?? "no-push-id"
            to fail-closed (log + skip pending entry) when pushId is undefined

apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/
  :NEW      c2-correction02-fixup02-batching.test.tsx
            - 3 pushes in 1 act, no yields
            - assert: 3 raw AND 3 applied, each on its own pushId
            - sub-case: 1 pushId + 1 missing-pushId in 1 act
              assert: 2 raw + 1 applied, no overwrite
```

---

## 4. Documentary nits (from the FIXUP01 review)

The fixup01 terminal evidence doc has two stale pieces of prose
the reviewer flagged:

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx (history)
  (FIXUP01 ORIGINAL) useRef<Map<string, ExtensionState>>
  (FIXUP01 FINAL)    useRef<Map<string | number, ExtensionState>>
```

The terminal evidence doc reproduces the original prose in the
"After (C2-CORRECTION02-FIXUP01)" code example, which is now
out of date. The fixup02 commit 4 will refresh that snippet to
match the final production shape.

The fixup01 plan also said "ceiling = 4 commits" but six commits
landed (4 plan commits + 1 TS2345 width-fix + 1 doc refresh). The
fixup02 commit 4 will add a `PLANNED_COMMIT_CEILING = 4 / ACTUAL_COMMITS = 6 /
CEILING_EXCEPTION = build-discovered type-width defect + evidence refresh` block
to the fixup01 terminal evidence.
