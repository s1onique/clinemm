# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) — 06 Amendment Repair Evidence

## 0. Scope

This document records the **bounded correctness repair** of the OBS-05 runtime duration
accounting. The architecture is RETAINED unchanged:

| Retained component | File |
|---|---|
| `TurnStateTracker` lifecycle authority | `apps/vscode/src/sdk/turn-state-tracker.ts` |
| `TaskTelemetryTracker` host ownership | `apps/vscode/src/sdk/task-telemetry-tracker.ts` |
| Interval accumulator | `apps/vscode/src/sdk/task-duration-accounting.ts` |
| Existing `HistoryItem` persistence | `apps/vscode/src/shared/HistoryItem.ts` |
| Existing runtime-to-webview publication | `apps/vscode/src/sdk/SdkController.ts` |

No new lifecycle state machine, timing service, database, telemetry framework or public SDK API
was introduced.

## 1. Defects closed (reviewer findings F1–F9)

| Finding | Defect | Repair | Witness |
|---|---|---|---|
| **F1** | The coordinator captured the accounting EAGERLY at construction time (`durationPersistence: this.taskTelemetry.durationPersistence`). No task is active at construction, so the captured value was permanently `undefined` and the persistence seam **never fired**. Every persisted `HistoryItem` was missing its accounting. | The accounting is read **LAZILY** at the persistence boundary through a `readDurationPersistence()` callback. The task identity and the record travel **TOGETHER** (`boundDurationPersistence`), so a destination identity can never be derived independently of an unbound record. | `F1-RED`, `F1-GREEN`, `F1-GREEN-b`, `F1-GREEN-c`, `F1-GREEN-d`, `F1-COORD-1..4` |
| **F2** | A restored nonterminal record reopened an interval across an UNOBSERVABLE gap but kept the record's `"complete"` coverage — the gap was silently classified. | A restored nonterminal record downgrades coverage to `"partial"`. No numeric gap is invented and the gap is never attributed to ACTIVE or WAITING. A TERMINAL record opens no interval, so its dormant interval remains legitimately excluded and its coverage is carried forward verbatim. | `F2-R1`, `F2-R1-b`, `F2-R1-c` |
| **F3** | A legacy task (no persisted record) had its accumulator zeros published as a COMPLETE accounting with a zero elapsed time — a fabricated historical total. | The accumulator carries an explicit `accountingAvailable` flag. It is false until an authoritative phase transition is observed or a record is restored. The tracker then withholds the `duration` wire field entirely, so the webview renders "unavailable". | `F3-R4`, `F3-R4-b` |
| **F4** | Returning to a previously-known task id RESET its accounting to zero, discarding the known durations. | The known durations are conserved through the task's PERSISTED record. The tracker still owns ONE visible-task window — there is **no unbounded per-task in-memory cache**. T13b's fresh-zero expectation was replaced accordingly. | `F4-R5`, `F4-R5-b`; OBS05 `T13b` replaced |
| **F5** | The stale-event witness did not exercise a real execution-epoch discriminator; task identity alone was treated as epoch identity. | The accounting binds to the **EXISTING** conversation/replica epoch fence (`MessageIdMinter.epoch`), which every production phase writer already stamps through `TurnStateWriterIdentity.epoch`. The `TurnStateTracker` now exposes its committed epoch (it does not invent one), and the accounting rejects a write whose epoch is older than the live fence. No parallel epoch counter was introduced. | `F5-EPOCH`, `F5-EPOCH-b`, `F5-EPOCH-c` |
| **F6** | The `process.hrtime` clock fallback called `proc.hrtime()` **TWICE** (seconds then nanoseconds) — two separate readings that can straddle a tick boundary. Machine-suspend continuity was implicitly claimed from monotonic non-regression alone. | Every fallback reads the clock EXACTLY ONCE per call. The machine-suspend **observation limitation is now disclosed honestly** in the wire contract: monotonic non-regression is NOT a proof of continuous observation, and no suspend-continuity is claimed. | `F6-CLOCK`, `F6-CLOCK-b`; `ExtensionMessage.ts` limitation note |
| **F7** | Manually supplied phase sequences were described as executable proof that actual provider, tool, background-job or human-gate lifecycles select those phases. | The evidence is re-classified precisely (§3 below). No claim is made that a synthetic chronology proves a real provider/tool/job/gate lifecycle. The ACT-produced scenarios that CANNOT be safely exercised remain an explicit live-qualification requirement. | §3 |
| **F8** | A duplicate restore rolled back subsequently accumulated durations and reset the interval anchor; the waiting reason of a restored record was lost; the clock fallback read twice. | The restore is monotonic with respect to the accumulated totals (the larger of the two is kept per bucket), a duplicate restore does not re-establish the interval anchor, and the waiting reason is CONSERVED from the record until an authoritative transition supersedes it. | `F8-R2`, `F8-R2-b`, `F8-R3`, `F6-CLOCK` |
| **F9** | P2 wording/whitespace residue. | Batched here (P2, non-blocking). | §6 |

## 2. The persistence ordering repair (W1)

The pre-repair `persistDurationAccounting` was a bare read-modify-write. Several turn
boundaries can be in flight at once, so two overlapping cycles could complete out of order and
an OLDER accounting checkpoint could replace a NEWER one.

The repair:

* the writes for ONE task are **SERIALIZED** through a per-task promise chain;
* a checkpoint that is **not strictly newer** than the one already written for that task is
  **DROPPED** — it cannot roll the persisted accounting back;
* the "newer" comparison uses the **accumulated totals**, not a wall-clock timestamp, so a
  clock adjustment cannot suppress a legitimate newer checkpoint;
* the chain map entry is removed as soon as the chain drains, and the map is created lazily so
  a partially-constructed controller is correct.

The history subsystem itself is **not** replaced — only the write ordering in front of it is
guarded.

## 3. Evidence classification (W5)

The following classes are used throughout this package. Every witness declares its class.

| Class | Meaning |
|---|---|
| `SYNTHETIC_REAL` | the REAL accumulator and the REAL phase tracker driven by a synthetic chronology. It proves the accounting's arithmetic and classification, NOT that a real provider/tool/job/gate produced that phase sequence. |
| `REAL_PRODUCTION_SEAM` | the REAL controller/coordinator persistence or lifecycle entry path was exercised. |
| `STRUCTURAL` | source-derived composition. |
| `NOT_EXECUTED` | an installed-runtime observation that was not available in this environment. |

**What the AMENDMENT witnesses are:**

| Witness | Class |
|---|---|
| `F1-RED` .. `F1-GREEN-d` | `REAL_PRODUCTION_SEAM` — the REAL `SdkController.prototype.persistDurationAccounting` / `readBoundDurationPersistence` methods, driven through a partial controller harness that carries the REAL collaborators. |
| `F1-COORD-1`, `F1-COORD-2` | `REAL_PRODUCTION_SEAM` (structural + executable) — the production wiring shape is pinned (the coordinator reads through the lazy callback; the controller wires a callback, never an eagerly-evaluated value; the identity and the record come from the SAME bound pair). |
| `F1-COORD-3` | `REAL_PRODUCTION_SEAM` — the coordinator's persistence block, driven through the REAL controller persistence method. |
| `F1-COORD-4` | `REAL_PRODUCTION_SEAM` — the REAL `SdkSessionEventCoordinator.handleSessionEvent` turn-completion path with a REAL `done` event, reaching the REAL persistence block. This is the boundary where the F1 defect lived, and ablating it turns this witness RED. |
| `F8-ORDER`, `F8-ORDER-b`, `F8-ORDER-c` | `REAL_PRODUCTION_SEAM` — the REAL persistence method against a recording history store. |
| `F2-*`, `F3-*`, `F4-*`, `F8-R2*`, `F8-R3` | `SYNTHETIC_REAL` — the REAL accumulator and the REAL tracker, driven by a synthetic chronology. |
| `F5-EPOCH`, `F5-EPOCH-b` | `REAL_PRODUCTION_SEAM` — the REAL `TurnStateTracker.setWithWriter` seam carrying the REAL epoch fence into the REAL tracker. |
| `F6-CLOCK`, `F6-CLOCK-b` | `REAL_PRODUCTION_SEAM` — the REAL `defaultMonotonicClock()` with the REAL `performance` global removed to reach the `process.hrtime` fallback. |
| `W4-PROJ-1..7`, `W4-RENDER` | `SYNTHETIC_REAL` (the pure projection) + `REAL_PRODUCTION_SEAM` (the REAL React component). |
| The original OBS05 `T01..T22` matrix | `SYNTHETIC_REAL` — real accumulator + real phase tracker, synthetic chronology. |

**What the AMENDMENT witnesses are NOT:**

The OBS05 `T04` (slow provider), `T06` (required background command), `T07` (detached
background job during a human wait) and `T21` (human gate + required automatic work) rows
remain `SYNTHETIC_REAL`. They exercise the REAL accumulator with a synthetic phase chronology.
They do **NOT** prove that a real provider latency, a real detached command job, or a real
human gate produces those phase transitions. That remains an explicit **live-qualification**
requirement (§5).

## 4. Execution-epoch composition (W3)

The AMENDMENT does **not** introduce redundant epoch tracking. The composition is:

```
MessageIdMinter.epoch                       (EXISTING conversation/replica fence)
  -> TurnStateWriterIdentity.epoch          (EXISTING writer identity)
    -> TurnStateTracker.setWithWriter()     (EXISTING authoritative commit seam)
      -> TurnStateTracker.currentEpoch      (NEW read-only accessor of the committed epoch)
        -> TurnPhaseListener(phase, anchorTs, epoch)   (APPENDED parameter)
          -> TaskTelemetryTracker.observeTurnPhase(phase, anchorTs, epoch)
            -> the epoch gate
```

The gate rejects a write whose epoch is older than the live fence (`readCurrentEpoch`) or
older than the last epoch the accounting accepted. A write with **no** epoch carries no epoch
constraint and is accepted, so the legacy untagged writer path keeps working.

## 5. Live-qualification requirements that remain open

The following CANNOT be safely exercised in this environment and are retained as explicit
live-qualification requirements. No passing witness was manufactured for them.

| Requirement | Why it cannot be exercised here |
|---|---|
| L1 — a real human gate brackets the wait exactly as the synthetic chronology assumes | requires an installed extension host with a real human present |
| L2 — a real slow provider response is classified ACTIVE | requires a live provider |
| L3 — a real required background command keeps the interval ACTIVE | requires a live command job |
| L4 — a real detached background job does not keep the task ACTIVE during a human wait | requires a live command job + a human gate |
| L5 — a real machine suspend / resume | requires a physical suspend event; the host has no suspend-discontinuity evidence |
| L6 — the header's native rendering under a live human gate | requires the installed VSIX |

## 6. Batched P2 corrections

* `TaskDurationSnapshot.coverage` documentation now names the restored-record case explicitly.
* The `TaskDurationPersistence` documentation states that the ABSENCE of the record means
  "recorded without authoritative accounting" and that consumers MUST NOT represent the
  absence as zero active time.
* The machine-suspend observation limitation is disclosed in the wire contract rather than
  implied away.
* The `T11` / `T13` / `T19` / `T22` / `OBS05-PERSIST-3` witnesses now assert the corrected
  semantics (a task the runtime has not observed has NO accounting).

## 7. Verdict

See `11-amendment01-exit-report.md`.
