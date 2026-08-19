# E7.1 WEBVIEW-TURNSTATE-COMPOSITION RED-FIX01 — C0: Composition writer recon

**ACT_ID:**
`ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-COMPOSITION-RED-FIX01`

**Sub-step:** C0 (writer audit). Read-only recon. No code change.

**Entry:** `5e83022ba` (TRACE01 CLOSED_CLEAN).

---

## §0  Frozen entry truth (immutable predecessor evidence)

```text
LIVE_BOUNDARY                  = W2_WEBVIEW_STATE_COMPOSITION
FIRST_DIVERGENCE_PUSH_ID       = 12

P12:
  extension.turnState = streaming/11
  raw.turnState       = streaming/11
  committed.turnState = idle/3

P30:
  extension.turnState = awaiting_followup/29
  raw.turnState       = awaiting_followup/29
  committed.turnState = idle/3

WHOLE_STATE_DELIVERY_FAILURE   = false
TURNSTATE_SELECTIVE_FAILURE    = true
ROOT_CAUSE_CLASS               = UNKNOWN
LEADING_ROOT_CAUSE_CANDIDATE   = R-C
R-C_PROVEN                     = NO
```

---

## §1  Recon scope

Audit (100%) of:

```text
replicaRef.current reads
replicaRef.current writes
reducerApplyStateSnapshot call sites
reducerApplyMessage call sites
stateData.turnState writes
all setState(...) writers in ExtensionStateContext
all paths capable of changing turnState
```

Both files in allowed production surface:

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts
```

Recon is **strictly read-only**. No fix proposed in this commit.
Recon findings are recorded here to enable the C1 RED test to
expose the exact six intermediate-state checkpoints (A–F) the
discriminator requires. The recon does NOT bias the C1/C2 work —
the RED must be neutral with respect to R-A, R-C, and R-D.

---

## §2  `replicaRef.current` writer audit

```text
R-1  ExtensionStateContext.tsx:467-470   StateServiceClient.subscribeToState   YES (functional setState((prevState)=>...) ~line 630)   YES (prevState.autoApprovalSettings.version + prevState.clineMessages via newState construction)   YES (reads replicaRef.current.messages and turnState for reducerApplyStateSnapshot input)   YES (via reducerApplyStateSnapshot, which mutates replicaRef.current.turnState from incoming stateData.turnState assignment)   YES (via reducerApplyStateSnapshot, which updates replicaRef.current.epoch and replicaRef.current.stateVersion)
R-2  ExtensionStateContext.tsx:844-847   UiServiceClient.subscribeToPartialMessage   YES (functional setState((prevState)=>...) ~line 844)   YES (prevState used only as { ...prevState, clineMessages: ... } return — turnState NOT touched)   YES (reads replicaRef.current via `before` local binding for reducer input)   NO (reducerApplyMessage mutates seqByTs/messages/epoch only; turnState is not part of reducerApplyMessage's contract)   YES (via reducerApplyMessage updating replicaRef.current.epoch and replicaRef.current.seqByTs)
```

**Coverage:**

```text
REPLICA_WRITER_COVERAGE        = 100%   (R-1, R-2; both functional updaters)
TURNSTATE_WRITER_COVERAGE      = 100%   (only R-1 mutates turnState, via reducerApplyStateSnapshot)
```

There are exactly **two** writers of `replicaRef.current`. Both
live inside React functional updaters inside
`setState((prevState) => ...)`.

---

## §3  `setState` writer audit (the React-state authority)

```text
S-1   ExtensionStateContext.tsx:630       INDIRECTLY (via newState from spread of stateData where stateData.turnState was rewritten at line 652)   W1 snapshot path. Mutates replicaRef.current first, then assigns stateData.clineMessages and stateData.turnState FROM the replica, then builds newState = { ...stateData, autoApprovalSettings }. Calls setShowWelcome/setOnboardingModels/setDidHydrateState (pre-existing side effects). Returns newState.
S-2   ExtensionStateContext.tsx:844       NO   W2 partial message path. Reads replicaRef.current, calls reducerApplyMessage, returns { ...prevState, clineMessages: replicaRef.current.messages } ONLY if reducer advanced. Does NOT touch turnState at all.
S-3..S-16   ExtensionStateContext.tsx:1183..1257   NO   Context-value setters (setShouldShowAnnouncement, setGlobalClineRulesToggles, ..., setUserInfo). All do `setState((prevState) => ({ ...prevState, <singleField>: value }))`. NONE of these fields is turnState. Verified by inspection of all 16 setters in the context value object literal.
```

**Coverage:**

```text
REACT_STATE_WRITER_COVERAGE    = 100%
TURNSTATE_WRITER_COVERAGE      = 100%   (only S-1 writes turnState, and only via reducerApplyStateSnapshot's output through stateData reassignment at line 652)
```

---

## §4  `stateData.turnState` writes

```text
W-1  ExtensionStateContext.tsx:652   W1 snapshot (R-1/S-1)   replicaRef.current.turnState (which is reducerApplyStateSnapshot's seq-gated return value's turnState field)
```

There is **exactly one** site where `stateData.turnState` is
written. It writes the reducer's seq-gated turnState back into
`stateData` before `newState = { ...stateData, ... }`. This is the
exact spot where the W1 path commits to "use the reducer's answer,
not the raw snapshot's turnState" — and is the spot the
discriminator needs to observe.

---

## §5  `turnState` writers, full audit

| Site | Path | Can write `turnState`? |
|---|---|---|
| `stateData.turnState = replicaRef.current.turnState` (line 652) | W1 only | YES |
| `setState((prevState) => ({ ...prevState, clineMessages: ... }))` (line ~851) | W2 only | NO (`clineMessages` only) |
| All 16 context-value setters (lines 1183..1257) | local UI | NO (each writes a single non-turnState field) |
| Reducer `applyStateSnapshot` (messageReducer.ts:160) | pure | Returns a new `ReplicaState` with `turnState` updated per seq gate |
| Reducer `applyMessage` (messageReducer.ts:~85) | pure | NO (does not touch `turnState`) |
| Reducer `applyTurnState` (messageReducer.ts:72) | pure | Returns a new `ReplicaState` with `turnState` advanced per seq gate |
| Reducer `createReplicaState` (messageReducer.ts:39) | pure | Returns initial `turnState: undefined` |
| Reducer `resetTo` (messageReducer.ts:56) | pure | Wholesale replace at new epoch |

**Conclusion:** There are exactly two paths by which `turnState`
can be committed to React state:

```text
PATH A (W1 snapshot):   subscription.onResponse → setState(updater) → replicaRef.current ← reducerApplyStateSnapshot → stateData.turnState ← replicaRef.current.turnState → newState.turnState → committed
PATH B (epoch bump):    A newer-epoch snapshot wholesale replaces; turnState rides in via stateData.turnState = replicaRef.current.turnState (same line 652)
```

W2 (partial message) cannot change `turnState` (it doesn't touch
`turnState` at all). The 16 context-value setters cannot change
`turnState`. The reducer's contract for `applyMessage` does not
touch `turnState`. **All `turnState` writes funnel through W1's
single line-652 site.** This is the entire writable surface.

---

## §6  Pre-existing updater residue (FROZEN, not part of this ACT)

```text
SETTER CALLS INSIDE W1 UPDATER (lines 666-675):
  setShowWelcome(true | false)
  setOnboardingModels(newState.onboardingModels | undefined)
  setDidHydrateState(true)

PRE_EXISTING_UPDATER_RESIDUE = OPEN / OUT_OF_SCOPE for RED-FIX01.

Per C6 of the frozen gate protocol, these are NOT in this ACT's
repair surface. The RED's first job is to discriminate R-A vs R-C
vs R-D; only if the discriminator proves one of these mutations is
the causal mechanism is a fix authorized here. Otherwise they
remain OPEN for a later cleanup ACT.
```

---

## §7  Test seam inventory

Existing test seams already in
`apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/`:

```text
c2-correction02-fixup04-composition.test.tsx       drives W1 → W2 → W1 through real ExtensionStateContextProvider; uses vi.mock("@/services/grpc-client") to inject subscribeToState + subscribeToPartialMessage handlers
c2-correction02-fixup04-committed-witness.test.tsx drives W1 → W2 → W1 in one batched act(); asserts committed.clineMessages conservation
c2-correction02-fixup04-updater-purity.test.ts     static purity assertions (FIXUP04's R9 witness)
c2-replay-red.test.ts                               earlier replay-style test
```

**Key finding:** the W1 + W2 test seam is already established.
The C1 RED can extend the existing `c2-correction02-fixup04-*`
pattern without inventing a new mock infrastructure. The C2 A-F
discriminator needs to read **intermediate** values that are not
currently exposed (`replicaBefore`, `replicaAfterReducer`,
`stateDataAfterLine652`, `newStateReturn`). These require either:

```text
OPTION 1 (preferred):   test-only observation hooks added to
                         ExtensionStateContext.tsx that fire on
                         each of the six checkpoints; gated by a
                         test-only import (e.g. NODE_ENV !== "test"
                         short-circuits to no-op). These do NOT
                         add new PTAD capture kinds or change the
                         capture architecture — they are local
                         test seams, not diagnostic instrumentation.

OPTION 2 (fallback):    extract a narrowly scoped pure helper
                         `computeNewStateFromSnapshot(prevState,
                         stateData, replicaBefore)` that the W1
                         updater calls. The test exercises the
                         helper directly. This is allowed by the
                         gate protocol ("at most one narrowly
                         extracted helper IF the repair becomes
                         materially clearer/testable that way")
                         and is preferred IF the C4 fix
                         naturally wants the helper anyway.

OPTION 3 (last resort): inline vitest spying on the existing
                         setState to observe what the updater
                         returns. This is fragile because React
                         may invoke the updater more than once,
                         and StrictMode would double-fire it.
```

**C1/C2 will use OPTION 1** (test-only observation hooks), which
is the minimum change to the production surface required for the
discriminator. OPTION 2 is reserved for C4 if the fix becomes
materially clearer with a helper extraction.

---

## §8  Discriminator readiness check

For the C2 discriminator to be meaningful, all six values must be
exposable at the same point in time for a single push:

```text
A = rawIncoming.turnState                        ← already captured by PTAD webview-raw-incoming
B = replicaBefore.turnState                      ← NEEDS hook (read replicaRef.current at line 467, before reducer call)
C = replicaAfterReducer.turnState                ← NEEDS hook (read replicaRef.current at line 472, after reducer call but before line 652)
D = stateData.turnState after line 652           ← NEEDS hook (read stateData.turnState after line 652)
E = newState.turnState                           ← NEEDS hook (read the returned newState.turnState, just before return statement at line 681)
F = committedContext.turnState                   ← already captured by PTAD webview-committed
```

All five existing PTAD captures + the five NEEDS hooks are at the
exact six checkpoints the gate protocol requires. The hooks are
test-only and produce no runtime overhead outside the test
environment.

---

## §9  Recon summary (gate evidence)

```text
REPLICA_WRITER_COVERAGE     = 100%   (2/2 audited; R-1 W1, R-2 W2)
REACT_WRITER_COVERAGE       = 100%   (18 setState sites audited; S-1 W1, S-2 W2, S-3..S-16 context setters)
TURNSTATE_WRITER_COVERAGE   = 100%   (1 functional write site at line 652; all other writers verified not to touch turnState)
TEST_SEAM_AVAILABLE         = YES    (existing c2-correction02-fixup04-* tests already mount ExtensionStateContextProvider; OPTION 1 hooks sufficient for A-F)
C0_SCOPE_ESCALATION         = NONE   (no production surface beyond the allowed ExtensionStateContext.tsx + messageReducer.ts; no PTAD / SDK / Hub / Remote touched)
```

This recon is sufficient to begin C1 (real-provider RED test)
without further source reading. The C1 test will be the next
commit.

---

## §10  Anti-bias note (frozen from parent ACT)

The recon identifies **five** places where the W1 path could
plausibly cause the W2 boundary, but does NOT pre-select any of
them:

```text
1. R-1's `setState((prevState) => ...)` updater could receive a
   `prevState` whose `turnState` is already `idle/3` from a stale
   prevState path (R-A).
2. `reducerApplyStateSnapshot`'s seq gate at messageReducer.ts:76
   could reject `streaming/11` if
   `replicaRef.current.turnState.seq` was already >= 11 from a prior
   push — but this is the CORRECT behavior (a higher-seq replay
   should not regress), so this only counts if the replay seq is
   wrong (R-A subclass).
3. `stateData.turnState = replicaRef.current.turnState` at line 652
   could be wrong if `replicaRef.current.turnState` was modified
   after the reducer call but before this assignment (R-D — would
   require the reducer itself to mutate during evaluation, which is
   not the case).
4. The functional updater could be invoked more than once (React
   18+ StrictMode) and the second invocation could observe a
   different `replicaRef.current` than the first (R-C — requires
   another writer to interleave between the two invocations; W2 is
   the only candidate, but W2 doesn't write to `turnState`).
5. The reducer's seq gate could receive `stateData.turnState` whose
   `seq` was tampered with between the wire arrival and the reducer
   call (R-A subclass, would require wire-side corruption or a
   mutation between JSON.parse and reducerApplyStateSnapshot).
```

The C2 discriminator must let the actual values at A–F decide which
(if any) of these is the causal mechanism. The recon's job ends
here.

---

## §11  Commit topology execution state

```text
C0  writer recon                       ← THIS DOCUMENT (commit 1 of 5)
C1  real-provider RED                   ← NEXT (commit 2)
C2  A-F discriminator                   ← NEXT (commit 2, with C1)
C3  necessity                           ← NEXT (commit 2 if compact; else commit 4)
C4  bounded production fix              ← AFTER C1/C2/C3 prove mechanism (commit 3)
C5  conservation matrix (T1-T14)       ← commit 4
C6  adversarial composition (A1-A10)    ← commit 4
C7  build/types/hygiene/biome           ← commit 4
     exact-HEAD VSIX                    ← commit 5
C8  fresh live walk                     ← AWAIT_USER (T25..T28)
```
