# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-02) — 15 Qualification Results

## 1. The RED reproduction (W1)

The three restore counterexamples were reproduced with the REAL `TaskDurationAccountant`
and the REAL `TaskTelemetryTracker` driven by an injected clock, BEFORE the repair, in
`apps/vscode/src/sdk/task-duration-accounting.amendment02.test.ts`.

| Witness | Observed at RED | Required |
|---|---|---|
| `RED-01` | `waitingMs` was **0** (was 5000); the live phase was rewritten; the anchor was reset | `activeMs=10000`, `waitingMs=5000`, `elapsedMs=15000`, `phase=waiting`, `waitingReason=USER_INPUT` — unchanged; then `waitingMs=8000`, `elapsedMs=18000` |
| `RED-02` | elapsed was **2000** (was 1000) | elapsed stays **1000**; the next second produces exactly **2000** |
| `RED-03` | active was **10000** (was 12000); the phase was re-frozen | active stays **12000**; phase stays `active`; the next second produces exactly **13000** |

The exact RED output was:

```
 × RED-01 ... AssertionError: expected +0 to be 5000
 × RED-02 ... AssertionError: expected 2000 to be 1000
 × RED-03 ... AssertionError: expected 10000 to be 12000
 Tests  3 failed | 4 passed (7)
```

## 2. The GREEN witnesses (W6)

| Witness | Class | What it pins |
|---|---|---|
| `RED-01` | `SYNTHETIC_REAL` | a stale active checkpoint during a human gate alters nothing |
| `RED-02` | `SYNTHETIC_REAL` | restoring the live projection does not duplicate the open interval |
| `RED-03` | `SYNTHETIC_REAL` | a stale terminal checkpoint does not re-freeze a continued accounting |
| `RED-04` | `SYNTHETIC_REAL` | a legacy task has NO accounting |
| `RED-05` | `SYNTHETIC_REAL` | the initial nonterminal restore reports PARTIAL coverage and re-opens the recorded category |
| `RED-06` | `SYNTHETIC_REAL` | the initial terminal restore freezes the totals |
| `RED-07` | `SYNTHETIC_REAL` | the waiting reason of a restored record is conserved |
| `RED-08` | `REAL_PRODUCTION_SEAM` | an equal-duration TERMINAL checkpoint persists after an ACTIVE one |
| `RED-09` | `REAL_PRODUCTION_SEAM` | an equal-duration PARTIAL coverage checkpoint persists after a COMPLETE one |
| `RED-10` | `REAL_PRODUCTION_SEAM` | an equal-duration waiting-reason transition persists |
| `RED-11` | `REAL_PRODUCTION_SEAM` | an older checkpoint cannot replace a newer one |
| `RED-12` | `REAL_PRODUCTION_SEAM` | a write before the `HistoryItem` exists is not durable, and the SAME checkpoint retries successfully |
| `RED-13` | `REAL_PRODUCTION_SEAM` | a drained persistence chain removes its map entry |
| `RED-14` | `SYNTHETIC_REAL` | the bound pair carries a strictly monotonic capture order |
| `RED-15` | `SYNTHETIC_REAL` | an unrecognized phase opens an explicit UNKNOWN interval |
| `RED-16` | `SYNTHETIC_REAL` | a task switch never inherits another task's accounting |
| `RED-17` | `SYNTHETIC_REAL` | a superseded-epoch write cannot reopen the accounting; the current epoch is accepted |
| `RED-18` | `SYNTHETIC_REAL` | the SAME legacy task is unavailable BEFORE and AFTER resumption |
| `W4-BOUNDARY-1..3` | `SYNTHETIC_REAL` | the projection never jumps backwards; the stale flag; terminal stays frozen |
| `W4-COMPONENT-1..3` | `REAL_PRODUCTION_SEAM` | the component through a quiet gate and the freshness expiry; a new snapshot never uses an older anchor; terminal stays frozen |

## 3. The targeted suites

```
$ bun x vitest run src/sdk/task-duration-accounting.amendment01.test.ts \
    src/sdk/task-duration-accounting.amendment02.test.ts \
    src/sdk/task-duration-accounting.obs05.test.ts \
    src/sdk/task-telemetry-tracker.test.ts \
    src/sdk/SdkController.task-telemetry-wiring.test.ts
 Test Files  5 passed (5)
      Tests  153 passed (153)
```


## 4. The bounded ablations (W6)

One bounded ablation per distinct repaired mechanism. Each was applied to the REAL
production seam and each turned its load-bearing witness RED. Each was then reverted and
the suite re-verified GREEN.

| Ablation | Witnesses that turned RED | Verdict |
|---|---|---|
| Remove the restore-authority guard (`restoreConsumed` + `liveAccountingStarted`) | `RED-01`, `RED-03` | LOAD-BEARING |
| Remove the capture-order freshness guard | `RED-11`, `F8-ORDER` | LOAD-BEARING |
| Always mark a write as durable | `RED-12` | LOAD-BEARING |

The `RED-12` witness was **strengthened** during the ablation pass: its first formulation
retried with a NEWER capture order, which the freshness guard would have admitted even
without the durability fix, so it was NOT load-bearing. The witness now retries with the
**SAME** capture order, which is exactly the case the durability fix governs. The
correction is recorded here rather than hidden.

## 5. The regression delta (W6)

### The host suite

The full `apps/vscode/src/sdk` vitest suite was run at the entry HEAD
(`23af44c205696f1563f9f4bc922b998639ee6ef9`) and again with the AMENDMENT applied, both
through the JSON reporter, and the per-test failing sets were compared.

| | passed | failed |
|---|---|---|
| entry HEAD | 5728 | 253 |
| with the AMENDMENT | 5748 | 251 |

The per-test diff after the fix is **1 added + 3 removed**, and EVERY entry in it is in the
UNRELATED process-containment / command-job timing families:

| Entry | Direction | Classification |
|---|---|---|
| `natural-exit-pgid-causal-repro01.nepcr01.test.ts :: C1` | added (failing) | FLAKE — it PASSES in isolation with the AMENDMENT applied, and a DIFFERENT test in the same file (`C2`, a deadline/PGID timing test) fails instead |
| `background-completion-barrier01-correction02.bcb01-c2.test.ts :: BCB-21` | removed (now passing) | FLAKE |
| `background-completion-barrier01-correction02.bcb01-c2.test.ts :: BCB-23` | removed (now passing) | FLAKE |
| `background-completion-barrier01.bcb01.test.ts :: BCB-INT-01` | removed (now passing) | FLAKE |

The three suites were then run **in isolation at the entry HEAD** (with the AMENDMENT
stashed) and produced the **IDENTICAL** result — `9 failed | 21 passed (30)` — to the same
run with the AMENDMENT applied. They are pre-existing environment-dependent
process-containment failures, completely unaffected by this change. The AMENDMENT-01
evidence documented the same families as flaky, failing in BOTH directions across runs.

**ZERO ACT-owned failures or diagnostics.** No failure in either set touches the duration
accounting, the persistence seam, the coordinator or the webview header.

### The regression that WAS found and fixed

The FIRST pass of the comparison surfaced **three real regressions**, all with the same
root cause:

* `SdkController.test.ts :: does not enter task startup until initial remote config is
  ready` — the new capture-generation pruning called a prototype getter
  (`this.durationWrittenSeq.delete(...)`) on a partial controller harness whose
  `initTask` is invoked through `SdkController.prototype.initTask.call(plainObject)`. The
  prototype getter is not available on a plain object.
* `completion-continuation-stall-lifetime01.ccslt01.test.ts :: STALL-LIFETIME-01` and
  `STALL-LIFETIME-02` — the same root cause, through the same production seam.

**FIX.** The pruning was moved into an arrow-function class field
(`forgetDurationCaptureGeneration`), which — like the existing
`restoreDurationAccountingSafely` — is `undefined` on a partial harness and therefore
tolerated by the `?.` call site. The map is read through
`this.durationPersistedTotals?.delete(taskId)`, so a missing map is tolerated too. The
pruning remains an OBSERVATION-side effect and can never break task startup.

After the fix, both suites PASS in isolation. The correction is recorded here rather than
hidden.

### The webview suite

```
WEB BASE passed=848 failed=67
WEB CUR  passed=854 failed=67
ADDED (regressions): 0
REMOVED (fixed): 0
```

The webview failing set is **byte-IDENTICAL** before and after, and the AMENDMENT added 6
passing tests. Zero webview regressions, and zero OBS-05-related webview failures in
either set (the single textual match on "duration" is an unrelated "4h duration" path
setting).

## 6. The static gates

| Gate | Result |
|---|---|
| Host typecheck (`tsc --noEmit -p tsconfig.json`) | PASS, no diagnostics |
| Webview typecheck (`tsc --noEmit -p tsconfig.json`) | PASS, no diagnostics |
| Lint (`biome lint --diagnostic-level=error` + `lint:proto`) | PASS, 3250 files checked, no errors |
| Format (`biome format --changed --since main`) | PASS, no fixes required |
| `git diff --check` | PASS, no whitespace errors |
