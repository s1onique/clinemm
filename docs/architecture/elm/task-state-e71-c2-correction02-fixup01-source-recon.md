# C2-CORRECTION02-FIXUP01 Source Recon

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP01-REACT-UPDATER-PURITY**

This is the source-recon doc for the fixup. It freezes the exact line
ranges where the reactivity impurity lives in the current code
(`b40fa2477`) and the call sites that need to move.

---

## 1. Existing capture sites (the impure ones)

These are the two `recordPostTerminalAuthoritySnapshot` calls inside
the `setState((prevState) => { ... })` updater:

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  :572  if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {    (RAW guard)
  :573      recordPostTerminalAuthoritySnapshot(                       (RAW emit)
  :579          buildWebviewSnapshot(stateData, stateData, "webview-raw-incoming"),
  :580      )
  :581  }
  ...
  :599  const rawStateDataSnapshot = { ...stateData, turnState: stateData.turnState }
  :604  stateData.turnState = replicaRef.current.turnState              (in-place mutation)
  :635  if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {   (APPLIED guard)
  :640      recordPostTerminalAuthoritySnapshot(                       (APPLIED emit)
  :641          buildWebviewSnapshot(newState, rawStateDataSnapshot, "webview-replica"),
  :642      )
  :643  }
  :645  return newState                                                  (updater return)
  :646  })                                                               (updater close)
```

Both `recordPostTerminalAuthoritySnapshot` calls are inside the
updater. Under React Strict Mode the updater may be invoked twice
and one result discarded, so each call could append twice.

---

## 2. Required moves

### 2.1 RAW — move to inbound boundary

The raw capture should run inside `onResponse` BEFORE `setState` is
called. The data needed is `stateData` (the parsed JSON payload),
identical to what the current raw emit sees.

New site:

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  :548   (inside the onResponse handler, after try { const stateData = ... })
  :NEW   const webviewRecorderOn = isPostTerminalAuthorityDiagnosticEnabled("webview")
  :NEW   if (webviewRecorderOn) {                                    (RAW guard, op-cap opts in)
  :NEW       const pushId = stateData._ptadPushId ?? "no-push-id"
  :NEW       pendingRawSnapshotsRef.current.set(pushId, {
  :NEW           raw: stateData,                                     (frozen before mutation)
  :NEW           ts: Date.now(),
  :NEW       })
  :NEW       // RAW emit — bound to pushId, deduplicated per-pushId:
  :NEW       recordPostTerminalAuthoritySnapshot(
  :NEW           buildWebviewSnapshot(stateData, stateData, "webview-raw-incoming"),
  :NEW       )
  :NEW   }
  ...
  :560   setState((prevState) => { ... pure ... return newState })   (NO ring writes)
```

### 2.2 APPLIED — move to a commit-time useEffect

The applied capture should fire once per committed state transition
from `useEffect` outside the updater. The matching raw snapshot is
read from a ref the inbound handler populated.

New effect body:

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  :NEW   useEffect(() => {
  :NEW       if (!isPostTerminalAuthorityDiagnosticEnabled("webview")) return
  :NEW       const pushId = state._ptadPushId ?? "no-push-id"
  :NEW       const rawSnap = pendingRawSnapshotsRef.current.get(pushId)
  :NEW       if (!rawSnap) return
  :NEW       pendingRawSnapshotsRef.current.delete(pushId)
  :NEW       recordPostTerminalAuthoritySnapshot(
  :NEW           buildWebviewSnapshot(state, rawSnap.raw, "webview-replica"),
  :NEW       )
  :NEW   }, [state._ptadPushId, state])
```

The dependency `[state._ptadPushId, state]` fires exactly once per
distinct push id, because React batches commits per state update and
Strict Mode does not re-fire effects for already-committed state.

### 2.3 `stateData.turnState` mutation stays inside the updater

The reducer still needs `stateData.turnState = replicaRef.current.turnState`
to compute `newState`. That mutation stays inside the updater. It is
NO LONGER needed for the diagnostic because the raw snapshot was
already saved at the inbound boundary BEFORE any mutation.

The `rawStateDataSnapshot` clone can be removed (it was only used to
keep a wire-side view alive past the reducer mutation; that role
moves to the ref).

### 2.4 Strict Mode behavior

Under Strict Mode, the updater runs twice on first mount with
discarded results. Effects also run twice on mount, with the second
run cleanup + re-run. With the ref pattern:

- Inbound handler runs once per push (onResponse is not React Strict-
  Mode affected; it fires from the gRPC stream, not from React).
- The ref map dedupes by push id. If a stray updater re-runs due to
  Strict Mode, no diagnostic capture re-runs inside it.
- The useEffect dependency `[state._ptadPushId, state]` re-runs on
  each committed state. Strict Mode re-runs the effect cleanup and
  re-runs the effect (cleanup then effect; the second run sees a
  clean ref map because the first effect drained the entry).

The cardinality contract holds under React Strict Mode.

---

## 3. R2 source edits

```text
apps/vscode/src/shared/post-terminal-authority-diagnostic.ts
  :REPLACE  BoundaryClass                        -> ThreeBoundaryClass
  :REPLACE  classifyBoundary() return type        -> ThreeBoundaryClass
  :NEW      classifyFullBoundary() that takes:
              extension, raw, applied, and an optional consumerDifferences
              (e.g. inputSection vs applied turnState diff, or followup-route
              vs applied divergence); returns FullBoundaryClass union.
```

The C2-CORRECTION02 tests should:

- assert `classifyBoundary()` returns only one of
  `NO_DIVERGENCE | W1_PRE_APPLY | W2_DURING_APPLY | W4_MULTI_BOUNDARY`
- add a NEW test for `classifyFullBoundary()` proving:
  - consumer divergence + equal extension/raw/applied -> W3_POST_CONTEXT
  - any extension != raw != applied combination -> W4_MULTI_BOUNDARY
  - extension == raw == applied && no consumer diff -> NO_DIVERGENCE

---

## 4. R3 doc rename

Update `task-state-e71-c2-correction02-terminal-evidence.md`:

```text
ENTRY_HEAD            = 2f1a9999b...
BUILD_HEAD            = b40fa2477...
CLOSURE_HEAD          = ea5446a79...
DOGFOOD_SOURCE_HEAD   = b40fa2477...
```

(The C2R closure HEAD sits between ENTRY and CLOSURE; this ACT does
not change the entry head or the closure head itself.)
