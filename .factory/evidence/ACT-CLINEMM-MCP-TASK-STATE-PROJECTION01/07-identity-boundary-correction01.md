# ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — IDENTITY-BOUNDARY CORRECTION01

**Date:** 2026-11-17
**Scope:** one bounded controller-identity witness (the reviewer's P1), plus the
production fix it exposed.
**Outcome:** the P1 was a REAL production defect, not only a coverage gap.
The defect is fixed and covered by a production-controller witness that is
RED against the pre-correction code.

---

## 1. The reviewer's P1 (verbatim scope)

> The publication tests use the real `sendStateUpdate()` and real store, but
> connect them through a test-local `captureFromSubmittedState()` helper. That
> helper mirrors `SdkController.capturePublishedTaskState()` instead of invoking
> the actual controller capture method. This leaves one important scenario
> incompletely verified: What happens if the active session changes while an
> asynchronous state submission is completing? The published snapshot belongs to
> session A. The eventual capture must not accidentally bind that snapshot to
> session B.
>
> **Bounded correction:** one production-controller witness establishing that the
> captured `sessionId`, `taskId`, `epoch` and `stateVersion` originate from a
> consistent publication identity. Include the task-switch-during-publication
> case. If the existing code already guarantees this, record the proof and make
> no changes.

## 2. Finding: the defect WAS real

The pre-correction production capture read the identity LIVE, AFTER the awaited
publication handoff:

```ts
// apps/vscode/src/sdk/SdkController.ts (pre-correction)
private capturePublishedTaskState(state: ExtensionState): void {
    ...
    const sessionId = this.sessions?.getActiveSession()?.sessionId   // LIVE READ
    const taskId = this.task?.taskId                                 // LIVE READ
    ...
}
```

The call site is:

```ts
// apps/vscode/src/sdk/SdkController.ts
const state = await this.getStateToPostToWebview()
const handedOff = await sendStateUpdate(state)   // <-- real suspension point
if (handedOff) {
    this.capturePublishedTaskState(state)          // <-- reads the LIVE identity
}
```

`await sendStateUpdate(state)` is a genuine suspension point (JSON
serialization + gRPC stream fan-out). The active session can change while the
publication is in flight. The live read then returns the NEW session's
identity, and the OLD session's TaskHeader projection is captured bound to the
NEW session's identity.

The pre-existing consistency guard in `getStateToPostToWebview()` does NOT
cover this window: it verifies `this.task === snapshotTask &&
getActiveSession() === snapshotSession` BEFORE the `sendStateUpdate` await.

**Consequence:** `clinemm_get_run` could report session B's `taskId` with
session A's `phase` / `epoch` / `stateVersion` — a cross-identity mis-binding
of exactly the fact the projection exists to expose faithfully.

## 3. RED evidence (behavioural, not a collection failure)

The witness is at
`apps/vscode/src/sdk/__tests__/mcp-task-state-identity-boundary01.test.ts`.

It drives the REAL production methods:

```
SdkController.prototype.flushStateToWebview()      [REAL]
  -> getStateToPostToWebview()                    [REAL, stubbed builder]
    -> attachPublishedTaskStateIdentity(...)      [REAL]
  -> await sendStateUpdate(state)                 [REAL handoff, mocked to
                                                    switch the active session
                                                    mid-flight]
  -> SdkController.prototype.capturePublishedTaskState(state)  [REAL]
    -> PublishedTaskStateStore.capture(...)       [REAL]
```

With the pre-correction LIVE identity read restored (the capture reverted in
place, everything else unchanged), the witness is RED:

```
 ❯ src/sdk/__tests__/mcp-task-state-identity-boundary01.test.ts (4 tests | 1 failed)

   × IB02: a task switch DURING the publication does NOT rebind session A's
            projection to session B

AssertionError: expected 'session-b' to be 'session-a' // Object.is equality
 ❯ src/sdk/__tests__/mcp-task-state-identity-boundary01.test.ts:207:35
    205|
    206|   // The record is bound to the identity that PRODUCED the snapshot.
    207|   expect(store.read()?.sessionId).toBe("session-a")
```

That is the exact defect the reviewer asked to rule out: **session A's
projection was bound to session B's identity.**

This is a BEHAVIOURAL RED (the assertion observes the mis-binding), not a
collection failure.


## 4. The fix

The publication identity is now sampled ONCE, synchronously, at snapshot
CONSTRUCTION time — where the controller already samples `snapshotTask` and
`snapshotSession` and already consistency-checks them — and travels WITH the
submitted snapshot until the capture reads it.

New carrier (in `apps/vscode/src/sdk/published-task-state.ts`):

- `PUBLISHED_TASK_STATE_IDENTITY` — a `Symbol` key (can never collide with a
  wire field name, can never be produced by `JSON.parse` of a remote payload).
- `attachPublishedTaskStateIdentity(state, identity)` — defines the carrier as
  a **non-enumerable own property**.
- `readPublishedTaskStateIdentity(state)` — reads it back, validating that
  both ids are non-empty strings.

Controller changes:

- `getStateToPostToWebview()` attaches the carrier to the exact snapshot
  object it returns, using the already-verified `snapshotSession` /
  `snapshotTask`.
- `capturePublishedTaskState()` reads ONLY the carrier. A snapshot without a
  carrier is REJECTED rather than bound to a guessed identity.

### Invariants preserved

| Invariant | Status |
| --- | --- |
| No second task-state authority | PRESERVED — the carrier carries identity only; the phase is still the Elm-selected value on the submitted state |
| Webview wire payload byte-for-byte unchanged | PRESERVED — the carrier is non-enumerable, so `JSON.stringify` omits it (asserted by witness IB03) |
| `running` remains independent of `taskState.phase` | UNCHANGED |
| Phase / label vocabulary | UNCHANGED (shared mapping untouched) |
| Operation registry / protocol version | UNCHANGED (no new MCP operation, no proto change) |
| Store shape | UNCHANGED (one bounded immutable record, same generation fences) |

### Why a superseded record is safe

The control-seam read path already fences on the CURRENT active identity
(`projectControlSeamTaskState` compares the record's `sessionId` / `taskId` /
`epoch` against the live active ones). So a record bound to a now-superseded
identity is simply NOT projected — it is never mis-attributed to the new owner.
Witness IB02 asserts both halves of this.


## 5. GREEN evidence

```
 ✓ src/sdk/__tests__/mcp-task-state-identity-boundary01.test.ts (4 tests) 4ms
 ✓ src/sdk/control-seam/control-seam.publication-boundary01.test.ts (8 tests) 9ms

 Test Files  2 passed (2)
      Tests  12 passed (12)
```

The ACT's own publication-boundary suite no longer uses a test-local mirror:
`captureFromSubmittedState()` now invokes the REAL production
`SdkController.prototype.capturePublishedTaskState` against the REAL store
(and attaches the carrier exactly as the production builder does).

### Regression gates

| Gate | Result |
| --- | --- |
| New identity-boundary witness | 4/4 PASS |
| Publication-boundary (now driving the REAL capture) | 8/8 PASS |
| Control-seam family (6 files) | 92/94 PASS — the 2 failures are `control-seam.owner-exclusivity.cor02.test.ts` (COR02-R1/R2), reproduced IDENTICALLY at the pristine baseline with the change stashed (environment/socket artifact, NOT ACT-owned) |
| Task-header Elm authority | 173/173 PASS |
| Webview label matrix + React updater purity | 50/50 PASS |
| Host typecheck (`tsc --noEmit`) | EXIT 0 |
| Webview typecheck (`tsc --noEmit`) | EXIT 0 |
| Biome lint (4 scoped files) | EXIT 0 |

### Full-suite parity (the decisive regression gate)

| | Failing files | Failing tests | Passing files | Passing tests |
| --- | --- | --- | --- | --- |
| Baseline (change stashed) | 63 | 168 | 423 | 5573 |
| After the correction | 63 | 168 | 424 | 5577 |
| Delta | 0 | 0 | +1 | +4 |

The failing-file SETS are byte-identical (`diff` of the sorted 63-file lists is
EMPTY in both directions). The change adds one passing file and four passing
tests, and zero regressions.

## 6. Scope discipline

- No VSIX was built.
- Codex was not run.
- No task was created, resumed, cancelled or modified.
- The installed-host qualification remains PENDING, exactly as the reviewer's
  "Next: installed qualification" section describes, to be performed by the
  operator AFTER this single identity-boundary check.

## 7. Changed files

| File | Change |
| --- | --- |
| `apps/vscode/src/sdk/published-task-state.ts` | NEW: publication-identity carrier (`Symbol` key, attach, read) |
| `apps/vscode/src/sdk/SdkController.ts` | Capture reads the carrier instead of the live identity; the snapshot builder attaches the carrier |
| `apps/vscode/src/sdk/control-seam/control-seam.publication-boundary01.test.ts` | The mirrored helper is replaced by an invocation of the REAL production capture |
| `apps/vscode/src/sdk/__tests__/mcp-task-state-identity-boundary01.test.ts` | NEW: the bounded production-controller identity witness (IB01..IB04) |
