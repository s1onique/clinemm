# C2-CORRECTION02-FIXUP03 — STATE-QUEUE-CONSERVATION

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP03-STATE-QUEUE-CONSERVATION**

Opened after the E7.1 architecture review of `C2-CORRECTION02-FIXUP02`.
The reviewer identified a real production-semantic regression that
must be closed before the live dogfood walk:

- **R6 (BLOCKING):** FIXUP02 introduced a manually-maintained
  `prevStateRef` that desynchronizes from React's pending state
  queue when any other writer calls `setState(...)` (e.g. the
  partial-message subscription at line 874, the local setter
  functions at lines 1186–1249). After FIXUP02, the gRPC snapshot
  handler reads `prevStateRef.current` for the reducer while other
  writers use the functional-updater path that reads React's
  `prevState`. Those two can disagree, and the diagnostic cannot
  detect the disagreement because it is the thing that is wrong.
- **R7:** The new `webview-replica` capture is emitted from
  pre-commit `nextState`, NOT from React-committed state. The
  capture name implies a post-commit semantic that we no longer
  have. Rename or freeze the semantic.
- **R8:** `pendingRawSnapshotsRef` is no longer participating in
  cross-phase correlation; the inbound handler sets and immediately
  consumes its own entry in the same synchronous call. The map is
  dead forensic machinery.

R4 (batched-push cardinality) and R5 (missing-pushId fail-closed)
from the prior reviews remain closed by their proof tests.

---

## 0. Why this fixup exists

FIXUP02 fixed R4 (applied capture per wire push under batching)
but introduced R6 (production-semantic regression). The fix was
correct in the burst case but introduced a parallel authority for
the snapshot path that can drift from React's authoritative queue
when other writers exist.

The audit (the first task of this fixup) must enumerate every
`setState(...)` callsite in `ExtensionStateContextProvider`. If
multiple writers exist, every writer MUST participate in the same
authority, OR every writer MUST be routed through a single
reducer/ref authority so React remains the sole arbiter.

The audit found:

```text
ExtensionStateContextProvider — setState writes:

  (W1) apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:686
       setState(newState)
       # The FIXUP02 snapshot path. Reads prevStateRef.current, NOT
       # React's prevState. R6 finding.

  (W2) apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:874
       setState((prevState) => { ...reducerApplyMessage... })
       # The partial-message subscription. Reads React's prevState
       # via functional updater. Already uses React authority.

  (W3) apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:1186–1249
       setState((prevState) => ({ ...prevState, <field> }))
       # Local setter functions exposed via context
       # (setUserInfo, setShowTaskHistory, ...). All use the
       # functional-updater form. Already use React authority.
```

Two writers (W2, W3) use React's functional updater authority.
One writer (W1) uses a private ref. R6 is real: W1 can read
state that is older than React's pending state when W2 or W3
have queued updates between W1 invocations.

---

## 1. Allowed outcomes

After this fixup:

- R6: every `setState` call that writes the snapshot-derived state
  uses React's functional-updater form. The reducer runs against
  React-authoritative `prevState`. No parallel authority.
- R4: burst-push cardinality is preserved (this is the regression
  risk — see §3 for the mechanism).
- R5: missing `_ptadPushId` continues to fail closed.
- R7: the diagnostic boundary vocabulary is corrected:
  - `webview-raw-incoming` stays as-is (the wire-side arrival).
  - The previously-named `webview-replica` is renamed to
    `webview-reducer-output` and captures the reducer's
    `nextState` for each pushId, regardless of whether React has
    committed it.
  - A NEW `webview-committed` capture is emitted from a
    post-commit `useEffect` reading React-committed `state`, but
    only for the LATEST pushId (i.e. the actual context the
    consumer sees).
- R8: `pendingRawSnapshotsRef` is REMOVED. The reducer output is
  captured inline via a `pendingAppliedByPushRef` queue keyed on
  `_ptadPushId` (R7) and drained by the post-commit effect.

## 2. Forbidden outcomes

- No TaskState reducer change
- No AgentRuntime / LocalRuntimeHost / Hub / Remote change
- No protocol semantic change
- No repair (this is the instrumentation hardening only)
- No changes to the wire shape when PTAD is off

---

## 3. Plan (ceiling = 5 commits)

### Commit 1 — fixup plan + source recon + audit

This file (plan) + `task-state-e71-c2-correction02-fixup03-source-recon.md`
which freezes the writer audit, the R7 vocabulary freeze, and the
exact lines that need to change.

### Commit 2 — restore React authority + per-pushId reducer-output queue

Restore the functional updater for the snapshot path. The reducer
runs INSIDE the updater so it reads React's `prevState` (closes
R6). The reducer's `nextState` is stashed in
`pendingAppliedByPushRef.current` keyed by `_ptadPushId` (this
is the mechanism that keeps R4 closed). The updater is pure — it
only mutates the ref map, no ring-buffer writes.

Pseudocode:

```ts
const pendingAppliedByPushRef = useRef<Map<string | number, ExtensionState>>(new Map())

onResponse(P):
  // RAW capture stays at inbound (R4 + R5 unchanged)
  ...
  if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {
    const pushId = stateData._ptadPushId
    if (pushId === undefined) {
      console.error("[PTAD] webview raw capture without _ptadPushId ...")
    }
    recordPostTerminalAuthoritySnapshot(raw)
  }

  setState((prevState) => {
    // React-authoritative prevState (R6 fix)
    const reducerOut = deriveNextState(prevState, stateData)
    pendingAppliedByPushRef.current.set(stateData._ptadPushId, reducerOut)
    return reducerOut
  })
```

### Commit 3 — reducer-output queue drain (replaces post-commit effect)

A post-commit `useEffect` keyed on `[state]` (only React-committed
state) drains `pendingAppliedByPushRef.current` in arrival order
and emits one `webview-reducer-output` capture per pushId. This
preserves burst-push cardinality (R4) because React calls each
queued functional updater individually even when the resulting
commits are batched — every queued `setState((prev) => ...)` runs
the updater exactly once with the previous queued result as its
`prevState`.

```ts
useEffect(() => {
  if (!isPostTerminalAuthorityDiagnosticEnabled("webview")) return
  if (pendingAppliedByPushRef.current.size === 0) return
  for (const [pushId, reducerOut] of pendingAppliedByPushRef.current) {
    recordPostTerminalAuthoritySnapshot(
      buildWebviewSnapshot(reducerOut, reducerOut, "webview-reducer-output"),
    )
    pendingAppliedByPushRef.current.delete(pushId)
  }
}, [state])
```

The effect runs once per commit, draining all accumulated
reducer outputs for the pushes whose functional updaters ran in
the batch. This is the R4-preserving mechanism.

### Commit 4 — committed/context capture + `pendingRawSnapshotsRef` removal

Add a SECOND post-commit effect that emits a single
`webview-committed` capture from React-committed `state` (with
the LATEST `_ptadPushId`). This is the true downstream/context
class — the state the consumer actually sees.

```ts
useEffect(() => {
  if (!isPostTerminalAuthorityDiagnosticEnabled("webview")) return
  recordPostTerminalAuthoritySnapshot(
    buildWebviewSnapshot(state, state, "webview-committed"),
  )
}, [state])
```

Then REMOVE `pendingRawSnapshotsRef` (R8) since the new design
has no cross-phase correlation that needs a stash. Update the
inbound handler to not write to it.

### Commit 5 — counterexample test + vocabulary freeze

- `c2-correction02-fixup03-state-queue.test.tsx` (NEW): drives
  W2 (partial-message writer) and W1 (snapshot writer) into the
  SAME `act()` with NO yield. Asserts the snapshot writer's
  reducer reads the React-committed state that includes W2's
  contribution. The exact assert: after W1 + W2 + W1, the W1
  reducer output's `clineMessages` includes the partial message.
- The three capture kinds (`webview-raw-incoming`,
  `webview-reducer-output`, `webview-committed`) are exercised
  in the existing composition tests.
- Terminal evidence + the ceiling-exception annotation + the
  FIXUP02 prose refresh (the `prevStateRef` removal must be
  reflected in the FIXUP02 prose).

---

## 4. Acceptance matrix

| ID  | Description                                            | Result   |
| --- | ------------------------------------------------------ | -------- |
| F0  | writer audit identifies all `setState` callsites       | PASS     |
| F1  | snapshot path uses functional updater (R6)             | PASS     |
| F2  | reducer runs against React-authoritative prevState     | PASS     |
| F3  | pendingAppliedByPushRef queue keyed on pushId          | PASS     |
| F4  | post-commit effect drains the queue in arrival order   | PASS     |
| F5  | 3-push burst → 3 raw + 3 reducer-output + 1 committed  | PASS     |
| F6  | counterexample: W2 partial-message interleaved         | PASS     |
| F7  | missing pushId still fails closed (R5)                | PASS     |
| F8  | pendingRawSnapshotsRef REMOVED (R8)                   | PASS     |
| F9  | capture vocabulary: raw-incoming / reducer-output / committed | PASS |
| F10 | existing 557 webview-ui tests still pass               | PASS     |
| F11 | existing 24 PTAD schema tests still pass               | PASS     |
| F12 | exact-HEAD VSIX built                                  | PASS     |
| F13 | protected stashes intact                               | PASS     |
| F14 | worktree clean                                         | PASS     |
| F15 | FIXUP02 prose refreshes prevStateRef removal           | PASS     |

## 5. Verdict

```
PASS_C2_CORRECTION02_FIXUP03
NEXT_ACT = live dogfood walk (now React-queue-conserving AND burst-safe)
          on the new HEAD VSIX
```
