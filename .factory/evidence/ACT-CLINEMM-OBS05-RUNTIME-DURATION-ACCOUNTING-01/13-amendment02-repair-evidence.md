# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02) — 13 Amendment Repair Evidence

## 0. Scope

This document records the **bounded checkpoint-conservation repair** of the OBS-05
runtime duration accounting. The architecture accepted in the preceding reviews is
**RETAINED unchanged**:

| Retained component | File |
|---|---|
| `TurnStateTracker` lifecycle authority | `apps/vscode/src/sdk/turn-state-tracker.ts` |
| `TaskTelemetryTracker` host ownership | `apps/vscode/src/sdk/task-telemetry-tracker.ts` |
| Interval accumulator | `apps/vscode/src/sdk/task-duration-accounting.ts` |
| Existing `HistoryItem` persistence | `apps/vscode/src/shared/HistoryItem.ts` |
| Existing runtime-to-webview publication | `apps/vscode/src/sdk/SdkController.ts` |

No new lifecycle state machine, timing service, database, telemetry framework or public
SDK API was introduced. **No checkpoint reconciliation subsystem, no second lifecycle
state machine, no generic timing service and no speculative telemetry infrastructure was
introduced.** The repair REMOVES logic (the per-bucket `Math.max` merge, the
totals-as-ordering-token predicate, the unbounded last-written record cache) rather than
adding guards around it.

## 1. The reproduced defects (W1)

All three restore counterexamples were reproduced with the REAL `TaskDurationAccountant`
and the REAL `TaskTelemetryTracker` driven by an injected clock, BEFORE the repair.

| Defect | Observed (RED) | Required |
|---|---|---|
| **RED-01** stale active checkpoint during a human gate | `waitingMs` 5000 → **0**; the live phase was rewritten; the interval anchor was reset | `activeMs=10000`, `waitingMs=5000`, `elapsedMs=15000`, `phase=waiting`, `waitingReason=USER_INPUT`, unchanged; then `waitingMs=8000`, `elapsedMs=18000` |
| **RED-02** restore of a live checkpoint | elapsed **1000 → 2000** (the open interval was duplicated) | elapsed stays **1000**; the next second produces exactly **2000** |
| **RED-03** stale terminal checkpoint after continuation | active **12000 → 10000**; the live phase was re-frozen to `terminal` | active stays **12000**; phase stays `active`; the next second produces exactly **13000** |

The root cause was the same in all three: the restore MERGED a persisted record into the
live accounting using a per-bucket `Math.max`, and re-established the open interval's
anchor. A merge of two observations taken at different times is not a restore — it is an
average of two timelines, and it cannot distinguish an OLDER record from a NEWER one.

## 2. The restore-ownership simplification (W2)

**The repair removes the merge and replaces it with ONE authoritative rule:**

> THE RESTORE IS AUTHORIZED EXACTLY ONCE, AT TASK ACTIVATION, BEFORE THE LIVE ACCOUNTING
> BEGINS.

The live accounting begins at the FIRST authoritative phase transition (`observePhase`).
From that moment on the live accounting holds a NEWER lifecycle phase, a NEWER interval
anchor and NEWER accumulated totals than any persisted record can carry, so a record
applied then is an **observation of the past** and is **explicitly rejected**.

Two independent facts carry the authority (both in the accumulator's own state, not a new
subsystem):

| Flag | Meaning |
|---|---|
| `restoreConsumed` | the authorization is consumed by the FIRST restore. A second restore is rejected even when no phase transition has been observed yet, because it would re-establish the open interval's anchor and lose the time accrued since the first restore. |
| `liveAccountingStarted` | after the first authoritative phase transition the live accounting is strictly newer than any persisted record. |

A rejected restore touches **nothing**: it does not alter an accumulated total, does not
change the lifecycle phase, does not reset an open interval's anchor and does not freeze a
live accounting.

### What is preserved

| Preserved property | Witness |
|---|---|
| Initial nonterminal restore with partial coverage | `RED-05`, `F2-R1` |
| Initial terminal restore with frozen totals | `RED-06`, `F2-R1-b`, `F4-R5-b` |
| Waiting-reason conservation | `RED-07`, `F8-R3` |
| Authorized continuation | `RED-03`, `F5-EPOCH-b` |

### The legacy resume witness (W2 requirement)

`RED-18` covers **the same legacy task before and after resumption**: before the
resumption the accounting is absent (`hasDurationAccounting === false`, the `duration`
wire field is withheld, `durationPersistence` is `undefined`); after the resumption
(the production switch-away-and-back path) it is **still** absent — the legacy task never
claims a complete historical accounting. Only the live part of the resumed session is
accounted, and it is accounted from zero, never as a fabricated historical total.

### What is explicitly NOT done

- No overlapping intervals are merged: the restore applies the record **as a whole**.
- No open anchor is reset through an obsolete restore: the anchor is established exactly
  once, by the first (authorized) restore.
- No additional independently maintained execution-epoch counter was introduced: the
  existing `MessageIdMinter.epoch` fence remains the epoch authority.

## 3. The checkpoint-ordering repair (W3)

### The defect

The persistence guard compared the **accumulated totals**:

```ts
candidateTotal > writtenTotal   // REMOVED
```

The totals are **not an ordering token**. A lifecycle change that does not accrue any
measurable time produces an EQUAL total, so the totals comparison silently DROPPED a
legitimate newer checkpoint:

| Reproduced case | Pre-repair | Required |
|---|---|---|
| ACTIVE checkpoint followed by a TERMINAL checkpoint with identical totals | the TERMINAL checkpoint was dropped | it persists |
| COMPLETE coverage followed by PARTIAL coverage with identical totals | the PARTIAL checkpoint was dropped | it persists |
| an equal-duration waiting-reason transition | the transition was dropped | it persists |

### The repair

The **capture order** is the checkpoint freshness authority. It is minted at the moment
the projection is READ, so it orders the checkpoints in the order the host OBSERVED them.
It reuses the **EXISTING** process-wide `MessageIdMinter.nextSeq()` counter that already
orders every other host-side observation — **no parallel counter is introduced**.

The capture order travels **with** the bound pair:

```
TaskTelemetryTracker.boundDurationPersistence
  -> { taskId, record, captureSeq }
       -> coordinator reads the pair, passes all three to the persistence seam
            -> SdkController.persistDurationAccounting(taskId, record, captureSeq)
```

so an ordering token can never be derived independently of the record it orders.

### The durability and cleanup repairs

| Defect | Pre-repair | Repair |
|---|---|---|
| A persistence attempt before the `HistoryItem` exists | the write returned silently, but the checkpoint was still marked as written, so the later retry was blocked | `writeDurationAccountingRecord` returns whether the write was DURABLE; a skipped write does **not** advance the freshness bookkeeping, so the checkpoint stays eligible for a later retry (`RED-12`) |
| The persistence chain leaked its map entry | the cleanup compared the map's stored promise (`next.catch(...)`) against `next`, which never matched | the cleanup compares against the stored **chain tail** (`RED-13`) |
| The last-written accounting cache was unbounded | a full `TaskDurationPersistence` record was retained per task, forever | only the capture ORDER (a number) is retained, and it is pruned when the task is (re)activated |

### What is NOT done

- The history subsystem is not redesigned: the write is still a single
  read-modify-write of the task's existing `HistoryItem` slot.

## 4. The presentation correction (W4)

### The defect

The presentation-only forward projection STOPPED at the five-minute bound and returned
the host's ORIGINAL snapshot verbatim. The displayed value therefore **jumped backwards**:
at `bound - 1ms` the header showed `snapshot.elapsed + bound`, and one millisecond later
it showed `snapshot.elapsed` again. A user watching a quiet human gate saw the wait
counter run up and then snap back.

### The repair

The projection is now **MONOTONE across the freshness boundary**:

- inside the bound, the projection advances normally;
- AT the bound, the projection is **CLAMPED** to the bound (the value keeps its last
  projected magnitude instead of snapping back);
- BEYOND the bound, the projection stops advancing and the result is explicitly marked
  **`stale`**.

The `stale` flag is the "explicitly identify the value as estimated or stale" contract:
the component renders an **`estimated`** marker (`task-header-duration-estimated`) and a
disclosing tooltip, so the value is never presented as a current measurement.

No existing bounded-refresh mechanism for the duration snapshot exists in this codebase,
and the ACT forbids a high-frequency full-state publication loop, so the explicit
uncertainty route was taken.

| Requirement | Status |
|---|---|
| Snapshot identity and presentation anchor bound coherently | `W4-COMPONENT-2` (a new snapshot never uses an older snapshot's anchor) |
| No new snapshot uses an older snapshot's anchor | `W4-COMPONENT-2` |
| No extrapolation across task or execution identity changes | the snapshot identity is the `(taskId, elapsedMs, phase)` triple; a different identity resets the anchor |
| No independent accumulated webview clock | the projection is a pure function of the host's snapshot plus the elapsed wall time since its publication |
| No high-frequency full-state publication loop | none added |
| Terminal values remain frozen | `W4-BOUNDARY-3`, `W4-COMPONENT-3` |
| The original elapsed clock and accounted elapsed are clearly distinguished | the header's wall-clock elapsed and the accounted elapsed are separate readouts with separate accessible names |

## 5. The remaining evidence gaps (W5)

### Bounded source inspection

| Inspected seam | Finding |
|---|---|
| Actual outgoing-task persistence | The coordinator reads the bound pair LAZILY at the turn boundary and passes the identity, the record and the capture order together. No unbound record can be written. |
| Actual incoming-task restoration | The controller restores at exactly two activation seams (`initTask` and `reinitExistingTaskFromId`), both immediately after `startTask` and BEFORE any live accounting begins. |
| Existing rejection authority for stale writes | The `MessageIdMinter.epoch` fence (`readCurrentEpoch` + `lastAccountedEpoch`) remains the epoch authority; an untagged write carries no epoch constraint and is still accepted, so the legacy untagged writer path keeps working (`RED-17`). |
| Unknown-phase handling | **REPAIRED.** See below. |

### The unknown-phase handling (W5 requirement)

The pre-repair behaviour was to **IGNORE** an unrecognized phase string, so the PREVIOUS
classification silently continued: a task that was waiting on a human kept accruing
WAITING time even though the authoritative phase had become something the accounting does
not understand.

The repair closes the current interval and opens an **UNKNOWN** one — the existing
explicit uncertainty mechanism; no new category is introduced. The time after an
unrecognized phase is reported as unclassifiable rather than attributed to the previous
category, and the conservation identity still holds exactly (`RED-15`).

The `F5-EPOCH-c` witness was updated from the pre-repair assertion ("the unknown phase is
IGNORED entirely") to the corrected assertion ("the unknown phase moves the accounting to
the explicit uncertainty mechanism"). The change is recorded here rather than hidden.

## 6. The live-qualification matrix (W5 — unchanged)

The live qualification matrix **retains the original requirements**. It was NOT narrowed
because the new unit tests pass.

| Requirement | Status |
|---|---|
| Real execution and human waiting | NOT EXECUTED — requires an installed extension host with a real human present |
| Webview recreation | NOT EXECUTED — requires the installed artifact |
| Resume and completion | NOT EXECUTED — requires the installed artifact |
| Terminal stability | NOT EXECUTED — requires the installed artifact |
| Task switching and restoration | NOT EXECUTED — requires the installed artifact |
| Extension-host recovery | NOT EXECUTED — requires the installed artifact |
| Conservation | pinned by the executable witnesses; confirmed live only by the installed run |
| Actual background-job and provider lifecycle classification | NOT EXECUTED — a real provider latency, a real required background command and a real detached background job during a human wait cannot be exercised here |
| Machine-suspend observation limitations | NOT EXECUTED — a physical suspend event is required; the monotonic-clock limitation remains DISCLOSED in the wire contract and is not claimed away |

These remain **explicit qualification requirements**, not passed claims.

## 7. Verdict

See `14-amendment02-exit-report.md`.
