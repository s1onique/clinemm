# 03 — Identity and epoch adversarial evidence

**ACT:** `ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01`

---

## The identity fence

`projectControlSeamTaskState` (`apps/vscode/src/sdk/control-seam/control-seam-authority.ts`)
returns a `taskState` **only** when ALL of the following hold:

```
captured.sessionId == current active sessionId
captured.taskId    == current active taskId
captured.epoch     == current conversation epoch
current epoch is established (not undefined)
```

Otherwise the property is **omitted** from the wire payload. There is no
fabricated `idle`, no inferred completion, and no fallback to a
last-good value.

### The three sequence domains are kept distinct

| Field | Domain | Compared against? |
|---|---|---|
| `taskHeaderPresentation.seq` | presentation / turn-state (`TurnStateTracker.seq`) | **Never** compared with `stateVersion`. Carried through verbatim. |
| `stateVersion` | ExtensionState publication (`minter.nextSeq()`) | The ONLY ordering clock for publications. Strictly greater within one identity+epoch. |
| `epoch` | conversation (`minter.epoch`) | Compared only with another `epoch`. Never regresses. |

The `PublishedTaskStateStore.capture()` guard:

```ts
if (sameIdentity) {
	if (record.epoch < current.epoch) return false                    // I5
	if (record.epoch === current.epoch && record.stateVersion <= current.stateVersion) return false  // I3
}
```

A capture for a **different** identity replaces the record (the owner
changed), but the version fence still applies within one identity, so a
late async publication cannot overwrite a newer accepted record.

---

## Adversarial scenarios and their witnesses

### A1 — Task A completes, task B starts; A's phase must never leak

**Mechanism.** `SdkController.clearTask()` is the universal
task-terminating choke-point and calls
`this.publishedTaskState.invalidate()`. Even if it did not, the identity
check (`published.taskId !== activeTaskId`) would reject A's record for
B.

**Witness.** `R5-1` — the authority is given an active session/task that
does **not** match the published record; `taskState` is `undefined`.

**Result:** PASS.

### A2 — An epoch bump invalidates the old phase

**Mechanism.** Two independent guards:

1. `SdkController.resetMessageTranslatorAndFence()` bumps
   `minter.epoch` and calls `publishedTaskState.invalidate()` — the
   record is dropped at the ownership change.
2. Even without (1), `projectControlSeamTaskState` requires
   `published.epoch === currentEpoch`, and `capture()` refuses an epoch
   regression.

**Witnesses.**

- `R5-2` — after `store.invalidate()`, the authority omits `taskState`.
- `PB05` — a capture carrying `epoch: 4` is REJECTED (`capture()`
  returns `false`) once `epoch: 5` is the current record; the record
  still reads `epoch: 5` / `phase: "streaming"`.

**Result:** PASS.

### A3 — Session replacement under the SAME task id

**Mechanism.** The identity fence compares BOTH the session id and the
task id. A new session under the same task id therefore cannot inherit
the old session's projection.

**Witness.** `R5-3` — the active session is `session-b` while the
published record is bound to `session-a` (same task id `task-a`);
`taskState` is `undefined`.

**Result:** PASS.

### A4 — Foreign-session requests are still refused

**Mechanism.** `ControlSeamServer.handleGetRun` compares the echoed
session id against the ACTIVE session id and refuses a mismatch BEFORE
the payload is built.

**Witness.** `R5-6` — a request echoing `session-foreign` against the
active `session-a` returns `control_seam_foreign_session`.

**Result:** PASS.

### A5 — No active session

**Mechanism.** `readControlSeamRunIdentity` returns `undefined` when
there is no active session; the server maps that to the existing
`control_seam_no_active_run` error.

**Witness.** `R5-4`.

**Result:** PASS.

### A6 — A record absent at startup remains absent

**Mechanism.** The store starts empty. No projection is manufactured
before the first eligible publication.

**Witness.** `R5-5` — the response has NEITHER `taskState` NOR
`taskStatus`; and `PB01` — a constructed-but-never-submitted snapshot
is not exposed.

**Result:** PASS.

### A7 — A late asynchronous publication from an OLD task

**Mechanism.** Two layers:

1. `clearTask()` / `resetMessageTranslatorAndFence()` invalidate the
   record at the ownership change.
2. `capture()` refuses a stale `stateVersion` within the same
   identity+epoch, and refuses an epoch regression.

**Witness.** `PB04` — a `stateVersion: 300` publication lands, then a
late `stateVersion: 299` publication arrives; the record still reads
`stateVersion: 300`, `phase: "streaming"`, `seq: 20`.

**Result:** PASS.

### A8 — The current epoch cannot be established

**Mechanism.** `projectControlSeamTaskState` returns `undefined` when
`currentEpoch === undefined`. The published record is then treated as
NOT identity-bound.

**Witness.** Structural — asserted by the `readCurrentEpoch()` member of
the authority surface and the `currentEpoch === undefined` guard in the
projection function. The controller always supplies
`this.messageTranslatorState.getMinter().epoch`, so this is a defensive

---

## The bounded record

`PublishedTaskStateStore` holds **exactly ONE** record.

| Property | Guarantee |
|---|---|
| Bounded | One record; no history, no diagnostic queue, no ring buffer. |
| Immutable | `read()` returns a frozen record with a frozen projection. `PB07` asserts `Object.isFrozen(record)` and `Object.isFrozen(record.projection)`, and asserts that a mutation attempt throws and does not reach the store's state. |
| Single owner | One instance per `SdkController` (`private readonly publishedTaskState`). |
| No timers / listeners / I/O | The store is a pure record holder with generation fencing. |
| Invalidation | `invalidate()` at epoch transition, task clear, and controller disposal. |

`PB06` asserts that after 50 captures the store still exposes ONE record
(the newest), not 50.

---

## The disabled-seam invariant

The control seam is DEFAULT OFF. When it is off:

- `ControlSeamServer.start()` returns `undefined` without creating a
  socket, a token file, or a listener.
- The capture in `flushStateToWebview()` runs **regardless** of the
  seam's enablement — it is a controller-side publication fact, not a
  seam behaviour.
- The seam's enablement bit is never read by the capture path.

Therefore the disabled seam has **zero** task-state semantic delta, and
enabling the seam cannot change what the ClineMM task header does.

**Classification:** `STRUCTURAL` — the invariant is proven by reading
the enablement resolver (`control-seam-enablement.ts`) and the capture
site; no runtime observation is required because the two code paths are
disjoint.

---

## The failure-sentinel conservation (C2.3)

The Elm task-header authority's bounded failure sentinel is
`{ phase: "idle", source: "host", seq: input.seq }`.

**If the existing publication genuinely contains that sentinel, MCP
reports the exact published value**, including its provenance
(`source: "host"`). The MCP layer does not distinguish a sentinel from a
successfully-selected `idle` — it reports what was published.

**MCP never claims a host fallback was a successful Elm semantic
decision.** The published `source` discriminant is carried verbatim, so
a consumer can see `"host"` provenance. There is:

- **no** cached last-good fallback,
- **no** replacement of the sentinel with an inferred status,
- **no** last-good value held in the `PublishedTaskStateStore` — the
  store holds the EXACT published projection and nothing else.

**Classification:** `STRUCTURAL` — proven by the store's design (one
record, replaced only by an accepted publication) and by `PB03` /
`PB08`, which assert that the recorded projection is byte-for-byte the
published one.

branch in production.

**Result:** PASS (structural).
