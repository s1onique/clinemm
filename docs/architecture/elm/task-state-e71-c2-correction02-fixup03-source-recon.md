# C2-CORRECTION02-FIXUP03 Source Recon

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP03-STATE-QUEUE-CONSERVATION**

---

## 1. Writer audit (R6)

Every `setState(...)` call site in `ExtensionStateContextProvider`,
at the head `9227288f5` (FIXUP02 closure):

```text
W1: apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:686
    setState(newState)
    reads: prevStateRef.current          # R6 finding: NOT React-authoritative
    writes: the snapshot-derived full state

W2: apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:874
    setState((prevState) => {
        const before = replicaRef.current
        replicaRef.current = reducerApplyMessage(before, partialMessage)
        if (replicaRef.current === before) {
            return prevState                  # stale/ignored
        }
        return { ...prevState, clineMessages: replicaRef.current.messages }
    })
    reads: React's prevState via functional updater
    writes: a single field (clineMessages)

W3: apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:1186–1249
    13 setters:
      setUserInfo        (prev) => ({ ...prev, userInfo })
      setShowTaskHistory (prev) => ({ ...prev, showTaskHistory })
      setShowWelcome     (prev) => ({ ...prev, showWelcome })
      setShowMcp         (prev) => ({ ...prev, showMcp })
      setShowAccount     (prev) => ({ ...prev, showAccount })
      setShowAnnouncement(prev) => ({ ...prev, shouldShowAnnouncement })
      setMcpServers      (prev) => ({ ...prev, mcpServers })
      setTelemetrySetting(prev) => ({ ...prev, telemetrySetting })
      setDistinctId      (prev) => ({ ...prev, distinctId })
      setGlobalClineRulesToggles    (prev) => ({ ...prev, globalClineRulesToggles })
      setLocalClineRulesToggles     (prev) => ({ ...prev, localClineRulesToggles })
      setLocalCursorRulesToggles    (prev) => ({ ...prev, localCursorRulesToggles })
      setLocalWindsurfRulesToggles  (prev) => ({ ...prev, localWindsurfRulesToggles })
      setLocalAgentsRulesToggles    (prev) => ({ ...prev, localAgentsRulesToggles })
      setLocalWorkflowToggles       (prev) => ({ ...prev, localWorkflowToggles })
    reads: React's prevState via functional updater
    writes: a single field
```

Summary: 3 writer sites (W1, W2, W3). W2 and W3 use React's
functional updater. W1 uses `prevStateRef.current`. **R6 is real**:
if W2 or W3 queues an update between two W1 invocations, W1 will
read `prevStateRef.current` (the previous W1 result) and miss the
W2/W3 updates that React will apply to the actual `prevState`.

The fix is straightforward: W1 must use the functional-updater
form so React's authoritative `prevState` is the source of truth.
The reducer is pure, so it can run inside the updater.

---

## 2. R4-preserving mechanism (counterexample resolution)

R4 said: applied capture must be emitted per push, not per React
commit. The FIXUP02 mechanism was: read `prevStateRef.current`,
call `setState(newState)` directly, emit applied synchronously.
The FIXUP03 mechanism is: queue a functional updater that runs
against React-authoritative `prevState`, stash the reducer output
in `pendingAppliedByPushRef.current`, and drain the queue from a
post-commit effect.

Does the queue drain work under React 18+ automatic batching?

Yes. React specifically documents that functional updaters are
queued and each receives the result of the prior queued update.
The reducer runs exactly once per `setState` call, regardless of
how many commits are batched. So `pendingAppliedByPushRef.current`
accumulates ALL pushIds whose functional updaters ran in the
batch, and the post-commit effect drains them all in arrival
order.

The applied capture therefore corresponds to the reducer's output
for each pushId (named `webview-reducer-output`), NOT to
React-committed state. That is R7's vocabulary correction: the
capture is a reducer-output event, not a committed-state event.

A separate `webview-committed` capture (one per React commit,
the latest pushId's reducer output as React sees it after the
batch) is emitted from a second effect. This is the true
context/consumer view.

---

## 3. R8 — pendingRawSnapshotsRef removal

After FIXUP03, the inbound handler does NOT need to stash anything
for cross-phase correlation because the reducer output is captured
directly in the functional updater (no asynchronous bridge). The
`pendingRawSnapshotsRef` is dead machinery.

Lines that reference `pendingRawSnapshotsRef.current` are removed.
The variable is removed. The bookkeeping (set/delete) is removed.

The reducer output IS the applied-truth capture, so no separate
"raw-applied correlation" structure is needed.

---

## 4. Required source edits

```text
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  :REMOVE   const prevStateRef = useRef<ExtensionState | null>(null)         (line 562)
  :REMOVE   const pendingRawSnapshotsRef = useRef<Map<string | number, ExtensionState>>(new Map())
                                                                       (line 550)
  :REMOVE   prevStateRef.current = newState                                (line 680)
  :REMOVE   pendingRawSnapshotsRef.current.set(...)                        (line 670)
  :REMOVE   pendingRawSnapshotsRef.current.delete(pushId)                  (line 700)
  :CHANGE   setState(newState)                  =>  setState((prevState) => { ... reducer ...; return reducerOut })
  :CHANGE   const pushId = stateData._ptadPushId ?? "no-push-id"
              =>  fail-closed (pushId === undefined ⇒ log + skip)
  :ADD      const pendingAppliedByPushRef = useRef<Map<string | number, ExtensionState>>(new Map())
  :ADD      pendingAppliedByPushRef.current.set(pushId, reducerOut)        (inside updater)
  :ADD      useEffect(() => { drain pendingAppliedByPushRef.current → webview-reducer-output },
                       [state])
  :ADD      useEffect(() => { webview-committed capture },
                       [state])

apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/
  :NEW      c2-correction02-fixup03-state-queue.test.tsx
            - 3-push burst: 3 raw + 3 reducer-output + 1 committed
            - W2 interleaved: snapshot reads React-authoritative prevState
            - missing pushId still fails closed
  :UPDATE   c2-correction02-composition.test.tsx
            - assertions for the renamed capture kind: webview-replica
              is now webview-reducer-output; a new webview-committed
              kind exists.
```

---

## 5. Documentary updates

The FIXUP02 prose and the FIXUP01 prose both describe the removed
`prevStateRef`. The FIXUP02 terminal evidence's §2.2 "After" code
example references `prevStateRef` and the `setState(newState)`
direct call. The FIXUP03 commit 5 must refresh those to show
the restored functional updater and the new capture vocabulary.
