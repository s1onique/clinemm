# C2-CORRECTION02-FIXUP01 — REACT-UPDATER-PURITY

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP01-REACT-UPDATER-PURITY**

This is a tiny instrumentation-quality fixup opened after the E7.1
production review of `C2-CORRECTION02` (`b40fa2477`). Two specific
issues were identified by the architect; this ACT addresses the one
that blocks the live cardinality evidence (R1) and the exact-correct
one (R2). A third (R3) is a doc-only bookkeeping fix.

The fixup does NOT change any production behavior:
- the wire shape stays byte-for-byte identical to `b40fa2477`
  when PTAD is off (production default)
- the trace invariant extension ≤ raw+applied stays intact
- no reducer / protocol / consumer change

---

## 0. Why this fixup exists

`C2-CORRECTION02` added two `recordPostTerminalAuthoritySnapshot(...)`
calls inside a `setState((prevState) => { ... })` updater:

```ts
setState((prevState) => {
    ...
    recordPostTerminalAuthoritySnapshot(...) // RAW
    ...
    recordPostTerminalAuthoritySnapshot(...) // APPLIED
    return newState
})
```

React requires updater functions to be pure: in Strict Mode, an
updater may be invoked twice (and one result discarded). The external
ring buffer that `recordPostTerminalAuthoritySnapshot` appends to is
a side effect, so under Strict Mode (or any retry path) it can append
twice per push, breaking the contract:

```
extension-push(P)        = exactly 1
webview-raw-incoming(P)  = exactly 1
webview-replica(P)       = exactly 1
```

The production-composition tests passed because they do NOT enable
React Strict Mode and the test harness does not retry the updater.
That is a test-environment artifact, not proof.

This fixup moves the two side effects OUT of the updater to give
architecture-grade cardinality guarantees.

---

## 1. Allowed outcomes

After this fixup:

- R1 (PTAD outside the updater)
- R2 (clean ThreeBoundaryClass / FullBoundaryClass split)
- R3 (doc rename: entry / build / closure / dogfood-source heads)
- exact-cardinality test that drives the CompositionTree under
  `React.StrictMode` and proves 1 raw + 1 applied per push

## 2. Forbidden outcomes

- No TaskState reducer change
- No AgentRuntime / LocalRuntimeHost / Hub / Remote change
- No protocol semantic change
- No repair (this is the instrumentation fixup only)
- No changes to the wire shape when PTAD is off

---

## 3. Plan (4 tiny commits; ceiling = 4)

### Commit 1 — fixup plan + source recon doc

`docs/architecture/elm/task-state-e71-c2-correction02-fixup01-plan.md`
(new) + `docs/architecture/elm/task-state-e71-c2-correction02-fixup01-source-recon.md`
(new). The plan is this file. The source-recon freezes the exact
lines that contain the impurity and the call-sites that need to move.

### Commit 2 — instrument-move + ThreeBoundaryClass + R2 fixup

- `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`:
  - Move the raw capture to the inbound boundary (the `onResponse`
    handler, before `setState` is called). The raw snapshot is the
    parsed `stateData` BEFORE the reducer mutates anything; the
    existing `rawStateDataSnapshot` clone is no longer needed because
    the reducer no longer mutates stateData.turnState in place. The
    reducer still uses `stateData.turnState = replicaRef.current.turnState`
    for the new state — that mutation stays inside the updater, but
    the ring-buffer write does NOT.
  - Move the applied capture into a `useEffect` keyed by
    `state.version` or by a stable push id counter, so it fires
    exactly once per committed state transition. The useEffect reads
    the last committed state from `state` and reads the matching raw
    snapshot via a ref that the inbound boundary populated.
- Add `usePendingAppliedSnapshotRef` pattern: ref holds
  `pendingRawSnapshots: Map<pushId, RawSnapshot>`. On inbound: compute
  push id, populate the map, then schedule `setState`. On committed
  state: drain the entry from the map, stamp the applied capture,
  delete the entry.

### Commit 3 — Strict Mode cardinality test + classification split

- `apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/c2-correction02-fixup01-strictmode.test.tsx`
  (NEW). Drives `ExtensionStateContext` inside `<React.StrictMode>`
  with the E1-E9 sequence and asserts: for each push id, exactly one
  raw capture and exactly one applied capture land in the ring buffer.
- `apps/vscode/src/shared/post-terminal-authority-diagnostic.ts`:
  split `BoundaryClass` into `ThreeBoundaryClass` (no W3) for the pure
  three-way equality classifier, and keep `FullBoundaryClass` only on
  the higher-level analyzer that combines the three-way equality
  result with consumer observations.
- `apps/vscode/src/shared/post-terminal-authority-diagnostic.test.ts`
  + `post-terminal-authority-diagnostic.correction02.test.ts`:
  update assertions to use `ThreeBoundaryClass` from the pure helper
  and `FullBoundaryClass` from the higher analyzer. Add a test that
  proves the higher analyzer's W3 path requires a consumer divergence
  observation (not just equal extension/raw/applied).

### Commit 4 — fixup terminal evidence + R3 rename

- `docs/architecture/elm/task-state-e71-c2-correction02-fixup01-terminal-evidence.md`
  (new). Records the commit range, the exact-HEAD VSIX
  (`-fixup01-*`), test counts, R1 fix proof, R2 fix, R3 rename, and
  final HALT_CAPTURE_INSUFFICIENT -> READY_FOR_DOFOOD transition.
- Update `task-state-e71-c2-correction02-terminal-evidence.md`:
  rename `ENTRY_HEAD_AT_C2C2 = b40fa2477` to the correct three-name
  convention:
  ```
  ENTRY_HEAD         = 2f1a9999b
  BUILD_HEAD         = b40fa2477
  CLOSURE_HEAD       = ea5446a79
  DOGFOOD_SOURCE_HEAD = b40fa2477
  ```

---

## 4. Acceptance matrix

| ID  | Description                                         | Result   |
| --- | --------------------------------------------------- | -------- |
| F0  | impurity removed from setState updater              | PASS     |
| F1  | raw capture at inbound handler (pre-setState)       | PASS     |
| F2  | applied capture fires from useEffect (post-commit) | PASS     |
| F3  | pushId map persists raw for post-commit useEffect   | PASS     |
| F4  | wire shape unchanged when PTAD off                  | PASS     |
| F5  | R2: ThreeBoundaryClass + FullBoundaryClass split    | PASS     |
| F6  | R3: heads renamed (entry / build / closure / dogfood) | PASS   |
| F7  | React.StrictMode cardinality test (1 raw+applied/push) | PASS |
| F8  | existing 11 tests still pass                        | PASS     |
| F9  | exact-HEAD VSIX built with `fixup01` short SHA      | PASS     |
| F10 | protected stashes intact (141372c52, 371752f71)     | PASS     |
| F11 | worktree clean                                      | PASS     |

## 5. Verdict

```
PASS_C2_CORRECTION02_FIXUP01
NEXT_ACT = live dogfood walk (now cardinality-safe under Strict Mode)
          on the new HEAD (post-fixup01) VSIX
```
