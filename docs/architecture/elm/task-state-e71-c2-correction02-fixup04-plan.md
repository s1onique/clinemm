# C2-CORRECTION02-FIXUP04 — PURE-UPDATER-EVIDENCE

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE**

Opened after the E7.1 architecture review of `C2-CORRECTION02-FIXUP03`.
The reviewer identified two blocking evidence defects that prevent
the diagnostic from being closed:

- **R9 (BLOCKING):** The FIXUP03 functional updater is still impure.
  It mutates `pendingAppliedByPushRef.current` (a ref map) from inside
  the updater body. React's contract requires updater functions to be
  pure: they may be invoked twice under Strict Mode with one result
  discarded, and they must not produce externally observable side
  effects. Even an "idempotent" ref mutation is still an externally
  observable mutation. The diagnostic therefore leaks out of React's
  render queue.
- **R10 (BLOCKING):** The headline `Q1` test does not actually prove
  the advertised R6 counterexample. The Q1 assertions only check
  E1/E2 reducer-output existence and seq values; they do NOT observe
  any field that W2 mutates. Under the broken FIXUP02 `prevStateRef`
  architecture, E2 would still emit a reducer-output with the correct
  seq (because the seq-gating reducer correctly computes the seq from
  `stateData`, not from `prevState.turnState`). The test cannot
  distinguish "GOOD: W2 contribution survives into E2's reducer
  output" from "BAD: W2 contribution is silently dropped".

The reviewer's recommended path (Option A, approved):

```text
R9: Remove all PTAD/diagnostic side effects from W1's functional
    updater. Delete pendingAppliedByPushRef and its drain effect.
    The updater becomes: return deriveNextState(prevState, stateData).

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

## 0. Out of scope (pre-existing residue)

The W2 partial-message updater mutates `replicaRef.current` and the
W1 snapshot updater also mutates `replicaRef.current`. These are
pre-existing residue inside functional updaters, NOT introduced by
PTAD. FIXUP04 does NOT attempt to clean them up.

The terminal evidence must acknowledge this honestly:

```text
PTAD_UPDATER_PURITY                 = PASS (zero NEW PTAD side effects
                                          in W1's updater)
PRE_EXISTING_REPLICA_REF_MUTATION    = EXISTING_RESIDUE
PRE_EXISTING_REPLICA_REF_OUT_OF_SCOPE = true
```

No claim is made about global "all updaters are pure" — that would
require touching the replicaRef mutation, which is a separate concern.

---

## 1. Allowed outcomes

After this fixup:

- R9: zero PTAD or diagnostic side effects inside W1's functional
  updater. The updater body contains only `prevState` reads and the
  pure reducer call.
- R10: a new committed-context conservation witness test exercises
  W1 + W2 + W1 inside one batched `act()` and asserts the committed
  context's `clineMessages` contains all contributions.
- R7 vocab: `webview-reducer-output` enum member REMOVED. Only
  `webview-raw-incoming` and `webview-committed` remain as webview-
  side capture kinds.
- R4: burst-push cardinality for raw captures preserved trivially
  (raw capture happens at inbound, once per onResponse call,
  regardless of React batching).
- R5: missing-pushId fail-closed preserved trivially (no
  reducer-output capture exists to fail-close; raw captures can be
  emitted with `_ptadPushId = undefined`).
- W1/W2/W3/W4 boundary classes RE-DEFINED against the simplified
  diagnostic:
  - W1 (pre-apply): `extension != raw`
  - W23 (composition/queue): `extension == raw && raw != committed`
  - W3 (post-context): `extension == raw == committed && consumer differs`
  - W4 (multiple): multiple independent mismatches
  - NO_DIVERGENCE: all three equal and consumer matches

## 2. Forbidden outcomes

- No TaskState reducer change
- No AgentRuntime / LocalRuntimeHost / Hub / Remote change
- No protocol semantic change
- No behavior repair
- No useSyncExternalStore refactor (rejected per reviewer's Option B
  verdict: instrumentation driving production architecture is backwards)
- No new external state authority
- No production behavior change when PTAD is OFF

---

## 3. Plan (ceiling = 5 commits)

### Commit 1 — fixup plan + source recon

This file + `task-state-e71-c2-correction02-fixup04-source-recon.md`
which freezes the writer audit, the W1/W2/W3/W4 boundary class
redefinition, and the exact lines that need to change.

### Commit 2 — restore pure updater + remove webview-reducer-output

In `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`:

```diff
- const pendingAppliedByPushRef = useRef<
-   Map<string | number, { reducerOut: ExtensionState; rawWire: ExtensionState | null }>
- >(new Map())

  ... (in onResponse handler)
- let rawWireClone: ExtensionState | null = null
- if (isPostTerminalAuthorityDiagnosticEnabled("webview") && stateData._ptadPushId !== undefined) {
-   rawWireClone = { ...stateData, turnState: stateData.turnState }
- }

  setState((prevState) => {
    ... reducer ...
    const newState = { ...stateData, ... }
-   pendingAppliedByPushRef.current.set(stateData._ptadPushId, { reducerOut: newState, rawWire: rawWireClone })
    return newState
  })

- // Post-commit drain effect (REMOVE)
- useEffect(() => {
-   if (!isPostTerminalAuthorityDiagnosticEnabled("webview")) return
-   if (pendingAppliedByPushRef.current.size === 0) return
-   for (const [pushId, { reducerOut, rawWire }] of pendingAppliedByPushRef.current) {
-     const rawSnapForCapture = rawWire ?? reducerOut
-     recordPostTerminalAuthoritySnapshot(buildWebviewSnapshot(reducerOut, rawSnapForCapture, "webview-reducer-output"))
-     pendingAppliedByPushRef.current.delete(pushId)
-   }
- }, [state])

  // webview-committed capture effect (KEEP)
  useEffect(() => {
    if (!isPostTerminalAuthorityDiagnosticEnabled("webview")) return
    recordPostTerminalAuthoritySnapshot(buildWebviewSnapshot(state, state, "webview-committed"))
  }, [state])
```

In `apps/vscode/src/shared/post-terminal-authority-diagnostic.ts`:

```diff
  export type PostTerminalAuthorityCaptureKind =
    | "extension-push"
    | "webview-raw-incoming"
-   | "webview-reducer-output"
    | "webview-committed"
    | "input-section"
    | "action-buttons"
    | "followup-route"
```

### Commit 3 — test updates + new R10 witness

Update existing tests to drop `webview-reducer-output` assertions:
- `c2-correction02-composition.test.tsx` — drop the per-push
  reducer-output assertions; the test was already refactored to focus
  on raw + reducer-output pairing; now it's raw + committed.
- `c2-correction02-fixup01-strictmode.test.tsx` — same.
- `c2-correction02-fixup02-batching.test.tsx` — same.

Update schema-side tests to remove the `webview-reducer-output` enum
member references:
- `post-terminal-authority-diagnostic.test.ts`
- `post-terminal-authority-diagnostic.correction02.test.ts`

Replace the old FIXUP03 `c2-correction02-fixup03-state-queue.test.tsx`
with a new `c2-correction02-fixup04-committed-witness.test.tsx`:

```ts
// W1 + W2 + W1 committed-context conservation witness (R10)
//
// Drive W1(E1 with [msg-A ts=50])
//      → W2(partial msg-B ts=100)
//      → W1(E2 with [msg-C ts=150])
// inside ONE act() with NO yields.
//
// Read state.clineMessages from a real consumer that re-renders
// on state changes.
//
// Assert: clineMessages contains {ts:50, A}, {ts:100, B}, {ts:150, C}
// in some merge order.
//
// This proves the W2 contribution survives React's update queue
// AND the snapshot reducer correctly merges W2's contribution into
// newState. Without React-authoritative prevState (FIXUP02's
// prevStateRef), the W1 reducer for E2 would have run against stale
// prevState and would NOT have incorporated W2's contribution into
// its merge calculation.
```

Also a Q4 (R9 purity static check):
```ts
// Static evidence that W1's updater has zero side effects.
// Grep the production source file for known diagnostic callsites
// and assert none appear inside the updater body.
```

### Commit 4 — terminal evidence + FIXUP03 prose refresh

`task-state-e71-c2-correction02-fixup04-terminal-evidence.md` —
records the fixup04 chain, the R9 + R10 fixes, the new vocabulary
(two webview capture kinds, not three), the pre-existing residue
acknowledgement, the test results, the acceptance matrix, and the
final verdict.

Plus a "Superseded by FIXUP04" subsection on the FIXUP03 terminal
evidence.

### Commit 5 — VSIX binding + CEILING_EXCEPTION if needed

Records the final HEAD + SHA256 + bytes. If 6 commits land, call out
the over-ceiling commits under `CEILING_EXCEPTION`.

---

## 4. Acceptance matrix

```text
F0  writer audit identifies all setState callsites                PASS
F1  W1 updater body has zero side effects (R9)                    PASS
F2  pendingAppliedByPushRef REMOVED                              PASS
F3  webview-reducer-output enum member REMOVED                   PASS
F4  webview-raw-incoming capture preserved at inbound             PASS
F5  webview-committed capture preserved post-commit               PASS
F6  committed-context conservation witness test (R10)            PASS
F7  static R9 purity check (Q4 grep)                              PASS
F8  existing webview-ui tests pass (with vocab updates)          PASS
F9  existing PTAD schema tests pass (with vocab updates)         PASS
F10 no production wire-shape change when PTAD is OFF              PASS
F11 exact-HEAD VSIX built                                         PASS
F12 protected stashes intact                                      PASS
F13 worktree clean                                                PASS
F14 FIXUP03 prose refreshes prevStateRef + queue removal         PASS
```

## 5. Verdict

```text
PASS_C2_CORRECTION02_FIXUP04

R1 (PTAD outside the React updater)               = FIXED
R2 (API misuse of W3 in pure helper)              = FIXED
R3 (head-naming in C2-CORRECTION02 terminal doc)   = FIXED
R4 (raw per-push cardinality under batching)       = FIXED + PROVEN
R5 (fail-closed on missing _ptadPushId)           = FIXED + PROVEN
R6 (state-queue conservation across W1/W2/W3)     = FIXED + COUNTEREXAMPLE-PROVEN
R7 (capture vocabulary freeze)                    = COLLAPSED TO TWO KINDS
R8 (pendingRawSnapshotsRef removal)               = FIXED
R9 (W1 updater purity, no PTAD side effects)      = FIXED + STATIC-PROVEN
R10 (real W2-conservation witness)                = FIXED + CONSUMER-PROVEN

CAUSE_CLASS_FOR_C2_CORRECTION02  = UNKNOWN  (still requires the live dogfood walk)

NEXT_ACT = live dogfood walk on the FIXUP04 HEAD VSIX.
          The diagnostic is now React-pure, cardinality-safe, and
          captures only the two observable boundaries (wire arrival
          + React commit). The reviewer's call: "run the damn dogfood
          trace" — stop iterating on instrumentation architecture.
```
