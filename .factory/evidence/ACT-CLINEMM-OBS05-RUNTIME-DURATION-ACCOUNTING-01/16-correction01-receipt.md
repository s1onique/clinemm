# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (CORRECTION-01) — 16 Compact Receipt

## 0. Scope and verdict

**PASS_STRUCTURAL_ONLY** — OBS-05 is **ACCEPTED_FOR_LIVE_QUALIFICATION**.

The AMENDMENT-02 architecture is **RETAINED unchanged**. No accounting
architecture, restore algorithm, checkpoint-ordering design or public wire
contract was reopened. This pass performed exactly the three bounded
corrections the review requested.

| Retained component | File | Status |
|---|---|---|
| `TurnStateTracker` lifecycle authority | `apps/vscode/src/sdk/turn-state-tracker.ts` | untouched |
| `TaskTelemetryTracker` host ownership | `apps/vscode/src/sdk/task-telemetry-tracker.ts` | extended, not redesigned |
| Interval accumulator | `apps/vscode/src/sdk/task-duration-accounting.ts` | extended, not redesigned |
| Existing `HistoryItem` persistence | `apps/vscode/src/shared/HistoryItem.ts` | untouched |
| Existing runtime-to-webview publication | `apps/vscode/src/sdk/SdkController.ts` | extended, not redesigned |

No new lifecycle state machine, timing service, database, telemetry framework or
public SDK API was introduced. The correction **ADDS three facts** and **removes
no** architectural element.

## 1. The three corrections

### 1.1 Legacy coverage (W1)

**The defect.** A legacy task — one recorded before the accounting existed — has
no persisted accounting record. When it was **resumed**, the live accounting
started from zero and the live part of the session WAS measured, but the
accounting published `coverage: "complete"`. The pre-resumption history was
never observed by the accounting, so a "complete" claim was a **fabrication of
completeness**: the total silently excluded the entire pre-resumption history
while presenting itself as a complete measurement.

The prior `RED-18` witness proved only that the legacy task is **unavailable
before** the resumption. It asserted nothing about the coverage **after** the
resumption, so the defect was invisible to it.

**The correction.** The host now reports the production fact it already knows —
the task HAS a persisted `HistoryItem` but that item carries NO accounting
record — through the **existing restore seam**:

| Seam | Change |
|---|---|
| `TaskDurationAccountant.markHistoricalCoveragePartial()` | the accumulator's historical coverage is downgraded to `partial` |
| `TaskTelemetryTracker.restoreDurationAccounting(taskId, record, hasUnobservedHistory?)` | the existing restore seam carries the production fact; a task with no record and a real history is declared `partial` |
| `SdkController.restoreDurationAccounting` | passes `hasUnobservedHistory = true` when the `HistoryItem` exists and carries no accounting record |

A **genuinely new** task has no `HistoryItem` at all, so it has no unobserved
history: its coverage stays **`complete`**. The distinction is a production
fact, not a heuristic.

**`RED-18` is strengthened** to assert the coverage after the resumption:

```ts
expect(resumed?.coverage === "partial" || resumed === undefined).toBe(true)
expect(resumed?.coverage).not.toBe("complete")
```


### 1.2 Presentation anchor (W2)

**The defect.** The webview's anchor identity was the
`(taskId, elapsedMs, phase)` **triple**. That triple does **not** identify a
PUBLICATION: a **replacement** publication can carry the SAME triple — a
coverage downgrade, a waiting-reason change, or an elapsed that did not
advance. When that happened the anchor was **not** reset, so the replacement
snapshot was **extrapolated from the previous snapshot's anchor**: the
replacement was silently aged by the time that belonged to the previous
publication.

**The correction.** The identity is now the **existing publication identity**
where it is available, and the snapshot's **full content identity** otherwise.

| Seam | Change |
|---|---|
| `TaskDurationSnapshot.publicationId?: number` | the wire publication identity (OPTIONAL — a host that does not project it leaves it absent) |
| `TaskTelemetryTracker.resolveDurationPublicationId()` | mints the identity from the **EXISTING** process-wide `MessageIdMinter.nextSeq()` reader (the same reader as the persistence capture order) — **no parallel counter**; it is minted ONLY when the published content changes, so a re-render of the same publication keeps its identity |
| `TaskHeaderTelemetry.tsx` | the anchor key is the publication identity when present, else the full content identity; the anchor is **derived during render** (React's "adjusting state when props change" pattern) so a replacement is **structurally** unable to use the previous anchor — not even for one committed frame |

The **five-minute clamp** and the explicit **`estimated`** marker are
**RETAINED unchanged** (`W2-COMPONENT-4` pins both). The **quiet gate** is
retained: a re-render of the SAME publication keeps its anchor
(`W2-COMPONENT-3`). **No webview-owned clock** was introduced — the fallback
identity is a pure function of the host's own published values.

### 1.3 Persistence bookkeeping (W3)

**The defect.** The last-written capture-order map holds one entry per task
that has a durably written accounting checkpoint. Its only removal path was
`forgetDurationCaptureGeneration`, which runs when a task is **(re)activated**.
A **retired** task identity is never re-activated, so nothing ever removed its
entry: the map accumulated one entry per task that ever persisted, for the
lifetime of the extension host.

**The correction.** A **bounded eviction** of retired identities.

| Property | How it is preserved |
|---|---|
| The **active** task's ordering authority | its entry is NEVER evicted (`this.taskTelemetry?.currentTask` is retained) |
| An **in-flight** write's comparison basis | a task whose persistence chain is still pending is NEVER evicted |
| **Checkpoint ordering** | a retired task's accounting cannot be written again (the host writes only the ACTIVE task's accounting), so forgetting a retired task's comparison value cannot admit an out-of-order write |
| The bound | `DURATION_WRITTEN_SEQ_CAPACITY = 64` |

The eviction is a **prototype method**, not an arrow-function class field: the
host test harnesses build a controller through the PROTOTYPE without running
the constructor, so an arrow-function field would never be initialized there
and the eviction would **silently never run**. (This is the same hazard the
AMENDMENT-02 evidence documented for `forgetDurationCaptureGeneration`; it was
caught by `RED-24` and fixed before the receipt.)

The eviction runs after a **durable** write (a skipped write does not advance
the bookkeeping and must not) and again when a persistence chain **drains**
(after which the task is no longer in flight and becomes eviction-eligible).


## 2. The witnesses

| Witness | Class | What it pins |
|---|---|---|
| `RED-18` (strengthened) | `SYNTHETIC_REAL` | the SAME legacy task is unavailable OR explicitly **partial** after the resumption |
| `RED-19` | `SYNTHETIC_REAL` | a genuinely NEW task keeps **complete** coverage |
| `RED-20` | `SYNTHETIC_REAL` | a resumed legacy task is **partial** and keeps its live totals; conservation holds exactly |
| `RED-21` | `SYNTHETIC_REAL` | a replacement publication mints a NEW publication identity; the same publication keeps it |
| `RED-22` | `SYNTHETIC_REAL` | a replacement with the SAME `(taskId, elapsedMs, phase)` triple still mints a NEW identity; the coverage downgrade is visible |
| `RED-23` | `SYNTHETIC_REAL` | a NEW task identity does not inherit the previous task's publication identity |
| `RED-24` | `REAL_PRODUCTION_SEAM` | retired task identities do not accumulate indefinitely in the last-written map |
| `RED-25` | `REAL_PRODUCTION_SEAM` | the bounded eviction does NOT weaken the checkpoint ordering of the ACTIVE task |
| `W2-COMPONENT-1` | `REAL_PRODUCTION_SEAM` | a replacement with the SAME triple is NOT extrapolated from the previous anchor |
| `W2-COMPONENT-2` | `REAL_PRODUCTION_SEAM` | a replacement without a publication identity is still distinguished by its CONTENT |
| `W2-COMPONENT-3` | `REAL_PRODUCTION_SEAM` | the SAME publication keeps its anchor across a re-render (the quiet gate survives) |
| `W2-COMPONENT-4` | `REAL_PRODUCTION_SEAM` | the five-minute clamp and the `estimated` marker are RETAINED |

`RED-18` is additionally strengthened **in place** in
`apps/vscode/src/sdk/task-duration-accounting.amendment02.test.ts`, so the
original witness file now asserts the coverage too.

## 3. The targeted suites

```
$ bun x vitest run --config vitest.config.ts \
    src/sdk/task-duration-accounting \
    src/sdk/task-telemetry-tracker.test.ts \
    src/sdk/SdkController.task-telemetry-wiring.test.ts \
    src/sdk/__tests__/task-header-live-timer-zero-reset.ltz01.test.ts \
    src/sdk/__tests__/resume-subscription-parity.rsp01.test.ts \
    src/sdk/__tests__/task-header-live-activity-coherence.lac01.test.ts \
    src/sdk/__tests__/task-header-runtime-error-counter-rec01.test.ts
 Test Files  10 passed (10)
      Tests  187 passed (187)
```

```
$ cd webview-ui && bun x vitest run src/components/chat/task-header/
 Test Files  15 passed (15)
      Tests  222 passed (222)
```

The webview task-header suite includes the 4 new `W2-COMPONENT` witnesses and
the 14 pre-existing AMENDMENT-01/02 duration witnesses — **all GREEN**.

The complete OBS-05 duration witness surface is **91 host + 26 webview**
across the four cycles (37 + 28 + 18 + 8 host; 8 + 8 + 6 + 4 webview).

## 4. The static gates

| Gate | Result |
|---|---|
| Host typecheck (`tsc --noEmit` + `tsconfig.vscode-compat.json`) | PASS, no diagnostics |
| Webview typecheck (`tsc --noEmit`) | PASS, no diagnostics |
| Lint (`biome lint --diagnostic-level=error` + `lint:proto`) | PASS, 3277 files checked, no errors |
| Format (`biome format --changed --since main`) | PASS, no fixes required |

Only the **targeted** suites and the **targeted** static gates were run. The
full repository regression campaign was **NOT** repeated, per the instruction.


## 5. The live matrix — RETAINED IN FULL

The live-qualification matrix is **UNCHANGED**. Every original requirement
remains an explicit qualification requirement. Nothing was narrowed because
the new unit tests pass.

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

**LIVE QUALIFICATION: NOT EXECUTED.** No VSIX was built, no artifact was
installed and no live qualification was performed. VSIX packaging and
installation remain subject to **operator authorization**.

## 6. Residual risk

* The publication identity is **process-local**. A host restart resets it, so
  the first publication after a restart mints a fresh identity. This is
  consistent with the capture order, which is deliberately not persisted
  either (a persisted order would have to survive a process restart).
* The bounded eviction relies on the tracker knowing the **active** task. A
  host that writes an accounting for a task that is neither active nor
  in-flight would lose that task's comparison value. The production path
  writes only the ACTIVE task's accounting.
* A legacy task's coverage is `partial` **from the moment it is resumed**. The
  pre-resumption history remains **unquantified** — it is disclosed, not
  reconstructed. No transcript-based estimation was implemented and none is
  claimed.
* The correction adds one production fact to the restore seam
  (`hasUnobservedHistory`). A host that omits it leaves the resumed legacy task
  at `complete` coverage — the pre-correction behaviour — so the live run must
  confirm that the artifact actually projects the declared coverage.

## 7. Status

**OBS-05 is ACCEPTED_FOR_LIVE_QUALIFICATION.**

Structural qualification **STOPS here**. No further pre-execution review is
required unless a NEW P0 is reproduced.
