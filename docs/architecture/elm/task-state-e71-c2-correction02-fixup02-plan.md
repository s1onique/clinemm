# C2-CORRECTION02-FIXUP02 — BATCHED-PUSH-CARDINALITY

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP02-BATCHED-PUSH-CARDINALITY**

This is a tiny hardening fixup opened after the E7.1 architecture
review of `C2-CORRECTION02-FIXUP01`. The reviewer identified two real
issues:

- **R4** (BLOCKING for the live diagnostic): when React batches
  multiple wire pushes into a single commit, the post-commit
  `useEffect` only fires once per commit, so the earlier pushes in
  the batch never get their `webview-replica` capture. The current
  architecture proves `webview-replica(P) = 1` per *commit*, not
  per *push*. The diagnostic cannot correlate every raw push to an
  applied observation in the burst case, which is precisely the
  regime we are trying to instrument.
- **R5** (correlation-integrity): the sentinel `stateData._ptadPushId ?? "no-push-id"`
  overwrites itself on every missing-ID push, manufacturing a
  many-to-one correlation in a forensic instrument that must be
  one-to-one.

R1 (impurity), R2 (classifier split), R3 (head naming) from the
prior review remain closed.

---

## 0. Why this fixup exists

`C2-CORRECTION02-FIXUP01` moved the RAW capture out of the React
updater to the inbound `onResponse` handler. That is correct.
But the APPLIED capture is now in a `useEffect` keyed on
`[state._ptadPushId, state]`, and that effect runs *per commit*,
not *per push*. React batches multiple `setState` calls into one
commit when they happen synchronously inside the same task, so:

```text
onResponse(P1)  raw[P1] emitted; pending[P1]=P1; setState(P1)
onResponse(P2)  raw[P2] emitted; pending[P2]=P2; setState(P2)
onResponse(P3)  raw[P3] emitted; pending[P3]=P3; setState(P3)

React commits one state with state._ptadPushId = P3

useEffect drains pending[P3] only
pending[P1], pending[P2] remain forever — never drained
```

The post-commit effect cannot recover the P1/P2 applied observations
because it has no access to those raw payloads in `state`. The
contract `webview-replica(P) = 1` is therefore per-commit, not
per-push, and the burst/batching case is not proven.

The diagnostic depends on `_ptadPushId` being a unique identity
across the realm boundary. Manufacturing a many-to-one fallback
key (`"no-push-id"`) is contrary to the Factory evidence model.

---

## 1. Allowed outcomes

After this fixup:

- R4: one APPLIED record per wire push even when React batches.
- R5: missing `_ptadPushId` fails closed (logs and skips, never
  silently overwrites).
- Batched-cardinality test that drives three pushes inside the
  same `act()` (no yields) and asserts exactly 3 raw AND exactly
  3 applied records.
- Missing-push-id test that asserts no ring-buffer corruption
  when `_ptadPushId` is absent (raw still emits, but with
  `_ptadPushId = undefined`; no pending entry; no applied drain).

## 2. Forbidden outcomes

- No TaskState reducer change
- No AgentRuntime / LocalRuntimeHost / Hub / Remote change
- No protocol semantic change
- No repair (this is the instrumentation hardening only)
- No changes to the wire shape when PTAD is off

---

## 3. Plan (4 commits; ceiling = 4)

### Commit 1 — fixup plan + source recon doc

`docs/architecture/elm/task-state-e71-c2-correction02-fixup02-plan.md`
(new) + `docs/architecture/elm/task-state-e71-c2-correction02-fixup02-source-recon.md`
(new). The plan is this file. The source-recon freezes the exact
lines that contain the batching hole and the sentinel-key hole.

### Commit 2 — push-pinning architecture

The applied capture must be computed at the inbound boundary,
NOT post-commit. The pure state computation (`replicaRef` reducer
+ the newState object) is hoisted out of the updater so it can be
called from `onResponse` directly. The updater stays pure (just
sets state from a `nextState` provided by the closure), and the
applied snapshot is emitted BEFORE React is asked to commit.

The architecture becomes:

```text
onResponse(P):
  raw[P] recorded (captureKind = webview-raw-incoming)
  if (_ptadPushId absent) → fail closed, log, skip pending entry
  pending[P] = rawSnap

  // Compute next state and the APPLIED truth WITHOUT a setState updater
  let nextState = computeNextState(prevState, P, rawSnap)
  pendingAppliedTruth[P] = nextState   // capture for this P

  setState(nextState)   // pure: no updater, just commit the result
```

The post-commit `useEffect` is REMOVED. Instead, after
`setState(nextState)`, the inbound handler emits the applied
snapshot from the locally-captured `pendingAppliedTruth[P]`:

```text
  recordPostTerminalAuthoritySnapshot(
      buildWebviewSnapshot(nextState, rawSnap, "webview-replica"))
  pendingAppliedTruth.delete(P)
```

This guarantees one applied capture per push, regardless of
whether React batches with subsequent pushes.

### Commit 3 — batched-cardinality + missing-push-id tests

- `apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/c2-correction02-fixup02-batching.test.tsx`
  (NEW). Drives 3 pushes (E1, E2, E3) inside a SINGLE `act()`,
  without yields. Asserts EXACTLY 3 raw records AND EXACTLY 3
  applied records, each on its own `_ptadPushId`.
- Adds a sub-case that drives E1 (with pushId) then E2 (with NO
  pushId) inside the same `act()`. Asserts: 2 raw records
  (E1 + E2 with `_ptadPushId = undefined`); 1 applied record
  (only E1, because E2 has no correlation key); no pending-map
  corruption; the missing-pushId emit logs but does not crash
  and does not overwrite E1's pending entry.

### Commit 4 — fixup terminal evidence + ceiling-exception note

- `docs/architecture/elm/task-state-e71-c2-correction02-fixup02-terminal-evidence.md`
  (new). Records commit chain, exact-HEAD VSIX (`-fixup02-*`),
  test counts, R4 fix proof, R5 fix, and final
  HALT_CAPTURE_INSUFFICIENT → READY_FOR_DOFOOD transition.
- Update `task-state-e71-c2-correction02-fixup01-terminal-evidence.md`
  to add the planned-ceiling / actual-commits / ceiling-exception
  annotation block (R-nits item from the review).
- Update `task-state-e71-c2-correction02-fixup01-terminal-evidence.md`
  to reflect the FINAL production type (`Map<string | number, ...>`)
  in the prose, not the pre-width-fix shape.

---

## 4. Acceptance matrix

| ID  | Description                                                | Result   |
| --- | ---------------------------------------------------------- | -------- |
| F0  | applied capture moved out of useEffect                     | PASS     |
| F1  | nextState computed at inbound (NOT inside updater)         | PASS     |
| F2  | applied emit at inbound, AFTER setState call               | PASS     |
| F3  | setState uses nextState directly (no updater function)     | PASS     |
| F4  | batched test: 3 pushes inside 1 act → 3 raw + 3 applied    | PASS     |
| F5  | missing pushId: 2 pushes (one with no id) → no overwrite   | PASS     |
| F6  | R5: missing pushId fails closed (log, skip pending)        | PASS     |
| F7  | existing 553 webview-ui tests still pass                   | PASS     |
| F8  | existing 24 PTAD schema tests still pass                   | PASS     |
| F9  | exact-HEAD VSIX built with `fixup02` short SHA             | PASS     |
| F10 | protected stashes intact (141372c52, 371752f71)            | PASS     |
| F11 | worktree clean                                             | PASS     |

## 5. Verdict

```
PASS_C2_CORRECTION02_FIXUP02
NEXT_ACT = live dogfood walk (now cardinality-safe under React batching)
          on the new HEAD (post-fixup02) VSIX
```
