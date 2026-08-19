# C2-CORRECTION02-FIXUP04 Source Recon

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE**

---

## 1. R9 — W1 updater impurity in FIXUP03

Current state at HEAD `6f4783937` (FIXUP03 closure):

```ts
// apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:646
setState((prevState) => {
    ... reducer runs ...
    const newState = { ...stateData, autoApprovalSettings: ... }
    // ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP03-STATE-QUEUE-CONSERVATION:
    pendingAppliedByPushRef.current.set(         // ← side effect inside updater
        stateData._ptadPushId,
        { reducerOut: newState, rawWire: rawWireClone },
    )
    return newState
})
```

React's contract: updater functions "must be pure functions of
state and props" and may run twice in Strict Mode with one result
discarded. ([React][1])

The FIXUP03 comment argues:

> "Stashing is idempotent under Strict Mode retries because the
> same pushId is written with the same value twice."

But idempotency under retry does not make the updater pure.
React can:

1. Run the updater for P
2. Decide to discard that render (e.g., a higher-priority update
   supersedes it, or React aborts the render for a different reason)
3. The ref map entry for P persists
4. The drain effect eventually fires and emits a
   `webview-reducer-output` record for an updater result that
   **never belonged to a committed render**

That record is forensic evidence for a transform that the user
never observed. The diagnostic now contains manufactured
intermediate observations.

## 2. R10 — Q1 doesn't test its stated discriminator

Current `c2-correction02-fixup03-state-queue.test.tsx` Q1:

```ts
// The diagnostic captures turnState fields, not clineMessages
// directly. We assert the snapshot is functionally correct:
// E2's reducer-output has _ptadPushId === 2 AND its
// rawIncomingLegacySeq === 4 (E2's wire-side seq).
expect(e2Any.rawIncomingLegacySeq).toBe(4)
expect(e2Any.rawIncomingLegacyPhase).toBe("streaming")
expect(e2Applied.appliedLegacySeq).toBe(4)
expect(e2Applied.appliedLegacyPhase).toBe("streaming")
```

Under FIXUP02's `prevStateRef` architecture, the snapshot reducer
correctly computed E2's seq from `stateData.turnState` (NOT from
`prevState.turnState`). The seq-gating reducer doesn't depend on
W2's contribution to `clineMessages`. So E2's reducer-output seq
would be `4` regardless of FIXUP02 or FIXUP03. The test cannot
distinguish the two architectures.

## 3. R10's real discriminator: committed-context clineMessages

W2's `setState((prevState) => { reducerApplyMessage(...); return { ...prevState, clineMessages: replicaRef.current.messages } })`
MUTATES `clineMessages`. W1's snapshot reducer
`reducerApplyStateSnapshot(replicaRef.current, stateData.clineMessages ?? [], ...)` MERGES the snapshot's clineMessages into the same `replicaRef.current`. So `clineMessages` flows through `replicaRef` regardless of FIXUP02 vs FIXUP04.

The honest discriminator for FIXUP04 vs FIXUP02 is therefore NOT a
user-observable runtime property — it's a React-contract property:
the W1 updater body is pure. This can only be proved by code review
plus static analysis (e.g., a grep-based test asserting no diagnostic
callsites appear inside the updater body).

The runtime witness for the FIXUP04 architecture is therefore the
**end-to-end committed-context conservation** test: drive W1 + W2 +
W1, assert the committed context's `clineMessages` contains all
contributions. This proves:

1. React's functional-updater semantics (queued updaters receive the
   preceding queued result)
2. The convergent-replica reducer correctly merges all sources
3. The committed view the user sees contains the full conversation

It does NOT strictly prove "FIXUP04 is better than FIXUP02", because
both would satisfy this. The FIXUP04 vs FIXUP02 distinction is
purely about React contract purity, which is established by code
review + the static R9 check.

## 4. Pre-existing residue (NOT in FIXUP04 scope)

The W2 partial-message updater mutates `replicaRef.current`:

```ts
// apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:874 (unchanged from FIXUP01)
setState((prevState) => {
    const before = replicaRef.current
    replicaRef.current = reducerApplyMessage(before, partialMessage)
    if (replicaRef.current === before) {
        return prevState
    }
    return { ...prevState, clineMessages: replicaRef.current.messages }
})
```

The W1 snapshot updater also mutates `replicaRef.current`:

```ts
// apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:672 (unchanged from FIXUP01)
replicaRef.current = reducerApplyStateSnapshot(
    replicaRef.current,
    stateData.clineMessages ?? [],
    stateData.epoch ?? 0,
    stateData.stateVersion ?? 0,
    stateData.turnState,
)
```

These are PRE-EXISTING mutations inside functional updaters, NOT
introduced by PTAD. FIXUP04 does NOT attempt to clean them up. The
terminal evidence must acknowledge this honestly:

```text
PTAD_UPDATER_PURITY                  = PASS (zero NEW PTAD side effects
                                           in W1's updater body)
PRE_EXISTING_REPLICA_REF_MUTATION     = EXISTING_RESIDUE
PRE_EXISTING_REPLICA_REF_OUT_OF_SCOPE = true
```

If we want to claim "all updaters in this file are pure", that is
a separate, larger ACT. FIXUP04 is not that ACT.

## 5. Required source edits

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  :REMOVE   const pendingAppliedByPushRef = useRef<...>(...)         (line 570)
  :REMOVE   const rawWireClone = ... inside onResponse               (line 655)
  :REMOVE   pendingAppliedByPushRef.current.set(...) inside updater  (line 713)
  :REMOVE   the post-commit drain effect                             (lines ~1043-1054)
  :KEEP     the webview-committed capture effect                     (lines ~1074-1079)

apps/vscode/src/shared/post-terminal-authority-diagnostic.ts
  :REMOVE   "webview-reducer-output" from PostTerminalAuthorityCaptureKind union
  :KEEP     "extension-push", "webview-raw-incoming", "webview-committed",
            "input-section", "action-buttons", "followup-route"

apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/
  :REWRITE  c2-correction02-composition.test.tsx
            - drop the per-push reducer-output assertions; update for the
              new raw + committed vocabulary
  :REWRITE  c2-correction02-fixup01-strictmode.test.tsx
            - same
  :REWRITE  c2-correction02-fixup02-batching.test.tsx
            - same
  :REPLACE  c2-correction02-fixup03-state-queue.test.tsx
            - rename to c2-correction02-fixup04-committed-witness.test.tsx
            - new R10 Q1: W1+W2+W1 committed-context conservation
            - new R9 Q4: static check that W1 updater body has no side effects

apps/vscode/src/shared/__tests__/
  :UPDATE   post-terminal-authority-diagnostic.test.ts
            - drop webview-reducer-output references
  :UPDATE   post-terminal-authority-diagnostic.correction02.test.ts
            - same
```

## 6. W1/W2/W3/W4 boundary class redefinition

With FIXUP04's simplified diagnostic (raw + committed), the boundary
classes become:

```text
W1 (PRE_APPLY):       extension != raw
                       (something between wire arrival and webview receipt
                       corrupted the snapshot's turnState)

W23 (COMPOSITION):    extension == raw && raw != committed
                       (the reducer mutated state, but committed is the
                        reducer output for the latest pushId only, so
                        multiple pushes in one batch show raw > committed)

W3 (POST_CONTEXT):    extension == raw == committed && consumer differs
                       (committed view diverges from what the React consumer
                        actually reads)

W4 (MULTIPLE):        multiple independent mismatches

NO_DIVERGENCE:        all three equal AND consumer matches
```

This is epistemically stronger than the FIXUP03 three-kind
vocabulary because each capture kind has a clear semantic boundary.

## 7. Documentary updates

The FIXUP03 terminal evidence §2 ("After") code example referenced
the now-removed `pendingAppliedByPushRef` and the reducer-output
drain effect. A "Superseded by FIXUP04" subsection will be added,
analogous to the existing "Superseded by FIXUP03" subsection on
FIXUP02.

The FIXUP03 plan + source-recon docs remain in the history as the
record of an intermediate architecture that proved insufficient.
They will be annotated, not removed.

[1]: https://react.dev/learn/queueing-a-series-of-state-updates
