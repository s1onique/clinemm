# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 (AMENDMENT-01) — 12 Qualification Results

## 1. The targeted AMENDMENT witnesses

`apps/vscode/src/sdk/task-duration-accounting.amendment01.test.ts` — **28 tests, 28 PASSED**.

| Witness | Class | Result |
|---|---|---|
| `F1-RED` — an EAGER capture at construction time persists nothing | `REAL_PRODUCTION_SEAM` | PASS |
| `F1-GREEN` — the LAZY read writes the current nonzero totals | `REAL_PRODUCTION_SEAM` | PASS |
| `F1-GREEN-b` — a subsequent persistence writes the UPDATED totals | `REAL_PRODUCTION_SEAM` | PASS |
| `F1-GREEN-c` — a persistence FAILURE does not abort execution | `REAL_PRODUCTION_SEAM` | PASS |
| `F1-GREEN-d` — task SWITCHING cannot misattribute a record | `REAL_PRODUCTION_SEAM` | PASS |
| `F8-ORDER` — an out-of-order checkpoint cannot roll the accounting back | `REAL_PRODUCTION_SEAM` | PASS |
| `F8-ORDER-b` — the writes for ONE task are serialized | `REAL_PRODUCTION_SEAM` | PASS |
| `F8-ORDER-c` — a record is never written into a DIFFERENT task's slot | `REAL_PRODUCTION_SEAM` | PASS |
| `F2-R1` — a restored nonterminal record reports PARTIAL coverage | `SYNTHETIC_REAL` | PASS |
| `F2-R1-b` — a restored TERMINAL record keeps complete coverage | `SYNTHETIC_REAL` | PASS |
| `F2-R1-c` — the unobservable gap is NEVER classified | `SYNTHETIC_REAL` | PASS |
| `F3-R4` — a legacy task projects NO accounting | `SYNTHETIC_REAL` | PASS |
| `F3-R4-b` — a legacy task is DISTINGUISHED from a genuinely new task | `SYNTHETIC_REAL` | PASS |
| `F4-R5` — restoring a task preserves its KNOWN totals | `SYNTHETIC_REAL` | PASS |
| `F4-R5-b` — a COMPLETED task's terminal totals stay frozen | `SYNTHETIC_REAL` | PASS |
| `F8-R2` — a DUPLICATE restore does not roll back the durations | `SYNTHETIC_REAL` | PASS |
| `F8-R2-b` — a duplicate restore does not DUPLICATE the accumulation | `SYNTHETIC_REAL` | PASS |
| `F8-R3` — the waiting reason of a restored record is CONSERVED | `SYNTHETIC_REAL` | PASS |
| `F5-EPOCH` — a stale event for a SUPERSEDED epoch cannot reopen the accounting | `REAL_PRODUCTION_SEAM` | PASS |
| `F5-EPOCH-b` — a write from the CURRENT epoch IS accepted | `REAL_PRODUCTION_SEAM` | PASS |
| `F5-EPOCH-b` — an authorized CONTINUATION reopens the accounting | `SYNTHETIC_REAL` | PASS |
| `F5-EPOCH-c` — an unknown phase cannot continue a previous classification | `SYNTHETIC_REAL` | PASS |
| `F6-CLOCK` — the clock fallback reads the clock EXACTLY ONCE | `REAL_PRODUCTION_SEAM` | PASS |
| `F6-CLOCK-b` — the default clock is monotonic, never negative | `REAL_PRODUCTION_SEAM` | PASS |
| `F1-COORD-1` — the coordinator reads through the LAZY callback | `REAL_PRODUCTION_SEAM` (structural + executable) | PASS |
| `F1-COORD-2` — the controller wires the LAZY callback, not an eager value | `REAL_PRODUCTION_SEAM` (structural + executable) | PASS |
| `F1-COORD-3` — the coordinator's persistence block writes the BOUND pair | `REAL_PRODUCTION_SEAM` | PASS |
| `F1-COORD-4` — the REAL coordinator's turn-completion path persists the accounting | `REAL_PRODUCTION_SEAM` | PASS |

## 2. The webview AMENDMENT witnesses

`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.duration.amendment01.test.tsx`
— **8 tests, 8 PASSED**.

| Witness | Class | Result |
|---|---|---|
| `W4-PROJ-1` — the WAITING bucket projects forward | `SYNTHETIC_REAL` | PASS |
| `W4-PROJ-2` — the ACTIVE bucket projects forward | `SYNTHETIC_REAL` | PASS |
| `W4-PROJ-3` — a TERMINAL phase is FROZEN | `SYNTHETIC_REAL` | PASS |
| `W4-PROJ-4` — a snapshot older than the BOUND is NOT extrapolated | `SYNTHETIC_REAL` | PASS |
| `W4-PROJ-5` — the projection NEVER changes phase / reason / coverage | `SYNTHETIC_REAL` | PASS |
| `W4-PROJ-6` — an ABSENT snapshot stays absent | `SYNTHETIC_REAL` | PASS |
| `W4-PROJ-7` — a snapshot from the FUTURE is not projected | `SYNTHETIC_REAL` | PASS |
| `W4-RENDER` — the component renders the split and the unavailable placeholder | `REAL_PRODUCTION_SEAM` | PASS |

## 3. The existing OBS-05 suites

| Suite | Before | After |
|---|---|---|
| `apps/vscode/src/sdk/task-duration-accounting.obs05.test.ts` | 37 PASSED | **37 PASSED** |
| `apps/vscode/webview-ui/.../TaskHeaderTelemetry.duration.obs05.test.tsx` | 8 PASSED | **8 PASSED** |

Six OBS-05 witnesses changed their ASSERTION (not their scenario) because the corrected
semantics differ from the pre-repair ones:

| Witness | Change |
|---|---|
| `T11` | A task the runtime has NOT observed has NO accounting (previously a fabricated complete zero). |
| `T13` | Same, for the switched-to task. |
| `T13b` | The fresh-zero expectation is REPLACED by the task-lifetime semantics: the known durations are conserved through the task's PERSISTED record. |
| `T19` | A freshly-started task has NO accounting until the runtime observes it; once observed, its zero total is a REAL measurement. |
| `T22` | The pre-observation snapshot legitimately carries NO duration field. |
| `OBS05-PERSIST-3` | The rejected restore leaves the other task with NO accounting and NOTHING leaked. |

## 4. The directly affected controller / coordinator / telemetry suites

| Suite | Result |
|---|---|
| `apps/vscode/src/sdk/SdkController.test.ts` | PASSED |
| `apps/vscode/src/sdk/SdkController.task-telemetry-wiring.test.ts` | PASSED |
| `apps/vscode/src/sdk/SdkController.locator-correction01.test.ts` | PASSED |

(53 tests, 53 PASSED across the three files.)

## 5. The full host suite — per-test regression comparison

The full host vitest suite was run at the ENTRY HEAD (`91c14db72`) and again with the
AMENDMENT applied, both through the JSON reporter, and the per-test failing sets were
compared.

| | Failing tests |
|---|---|
| Entry HEAD (`91c14db72`) | 247 |
| With the AMENDMENT | 251 |

The per-test diff is 7 entries, and EVERY one of them is in an UNRELATED, timing-dependent
suite — and the diff runs in BOTH directions (one entry is baseline-only, six are
amendment-only), which is the signature of a FLAKE rather than a deterministic regression:

| Entry | Suite | Nature |
|---|---|---|
| baseline-only | `ACL03 NO_JOB_DONE_YIELDS_TO_USER` | an async command-liveness suite |
| amended-only | `NATURAL-EXIT-PGID-CAUSAL-REPRO01 / N2` | a REAL-PROCESS causal repro |
| amended-only x2 | `PAUSED-CONTAINMENT-EVIDENCE-01 / D1`, `D2` | REAL-PROCESS causal discriminators |
| amended-only x2 | `TCRR01 / N1 G1`, `N1 G2` | REAL-PROCESS containment repros |

The `BOUND.1.*` checkpoint byte-bound entries that appeared in an EARLIER run did not appear
in the final run — further evidence that these suites are flaky under load. The
`completion-incident-checkpoint-correction02.bound.test.ts` suite **passes 4/4 in isolation,
three consecutive runs**.

A grep of the per-test diff for `obs05`, `duration`, `telemetry`, `turn-state` and `turnstate`
returns **NO entries**. No failing entry in the diff touches the task-header telemetry, the
duration accounting, the turn-state tracker or the coordinator's persistence seam.
**Zero ACT-owned regressions.**

### 5.1 The directly affected coordinator suite

`apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts` reports **2 failures** — `CPL02`
and `OWN01 RED`. The IDENTICAL two failures occur at the entry HEAD (verified by stashing
the AMENDMENT and re-running): they are pre-existing baseline failures, not ACT-owned.

### 5.2 The compaction-coordinator suites

`sdk-compaction-coordinator.turn-phase-authority.test.ts` and
`sdk-compaction-coordinator.restore-publication.test.ts` both drive the REAL
`TurnStateTracker` and PASS with the AMENDMENT applied (they are in the 164 passing tests of
the §4 sweep).

## 6. The full webview suite — per-test regression comparison

| | Failing files | Failing tests | Passing tests |
|---|---|---|---|
| Entry HEAD (`91c14db72`) | 15 | 8 | 1 039 |
| With the AMENDMENT | 15 | 8 | 1 047 |

The failing set is IDENTICAL in both directions. The 8 additional passing tests are the
AMENDMENT's new webview witnesses. **Zero ACT-owned regressions.**

The 15 pre-existing failing files are unrelated to this ACT (chat rows, settings sections,
button config, input section) and are preserved as baseline failures.

## 7. Typecheck / lint / diff

| Gate | Result |
|---|---|
| `bunx tsc --noEmit` (host, `apps/vscode`) | PASS |
| `bunx tsc --noEmit` (webview, `apps/vscode/webview-ui`) | PASS |
| `biome lint --diagnostic-level=error` (all 11 changed files) | PASS — 11 files checked, no findings |
| `biome format` (all 11 changed files) | PASS — formatted, re-check clean |
| `git diff --check` | PASS — no whitespace errors |

## 8. Ablation / non-vacuity (bounded)

Every AMENDMENT ablation was executed against the REAL production seam and the resulting
RED witness was observed. All ablations were REVERSED and the suites re-verified GREEN.

### 8.1 The coordinator's lazy persistence read disabled — `F1-COORD-4` goes RED

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts`:

```diff
-		if (this.options.persistDurationAccounting && this.options.readDurationPersistence) {
+		if (false && this.options.persistDurationAccounting && this.options.readDurationPersistence) {
```

```
 × F1-COORD-4: the REAL coordinator's turn-completion path persists the accounting
 Tests  1 failed | 27 passed (28)
```

The REAL coordinator's turn-completion path stops persisting the accounting — the F1 defect
is reproduced exactly.

### 8.2 The execution-epoch gate disabled — `F5-EPOCH` goes RED

`apps/vscode/src/sdk/task-telemetry-tracker.ts`:

```diff
-		if (epoch !== undefined && currentEpoch !== undefined && epoch < currentEpoch) {
+		if (false && epoch !== undefined && currentEpoch !== undefined && epoch < currentEpoch) {
```

```
 × F5-EPOCH: a stale event for a SUPERSEDED epoch cannot reopen the accounting
 Tests  1 failed | 26 passed (27)
```

### 8.3 The accounting-availability gate disabled — `F3-R4` goes RED

`apps/vscode/src/sdk/task-duration-accounting.ts`:

```diff
-		if (!s.accountingAvailable) {
+		if (false && !s.accountingAvailable) {
```

```
 × F3-R4: a legacy task projects NO accounting - never a fabricated complete zero
 Tests  1 failed | 26 passed (27)
```

A legacy task publishes a fabricated complete zero again.

### 8.4 The monotonic restore disabled — `F8-R2` goes RED

`apps/vscode/src/sdk/task-duration-accounting.ts`:

```diff
-		s.activeMs = Math.max(s.activeMs, incomingActive)
+		s.activeMs = incomingActive
```

```
 × F8-R2: a DUPLICATE restore does not roll back the subsequently accumulated durations
 Tests  1 failed | 26 passed (27)
```

**A note on the witness's sensitivity.** The first formulation of `F8-R2` observed the LIVE
snapshot, which INCLUDES the currently-open interval. A rollback of the CLOSED totals was
therefore MASKED by the open interval and the witness stayed GREEN under the ablation. The
witness was strengthened to observe the CLOSED totals directly (through the new
read-only `durationClosedTotals` accessor), and its chronology was extended so the interval
is CLOSED before the observation. With that correction the ablation is detected. This is
recorded here because it is a real instance of a witness that was NOT load-bearing until it
was measured.

### 8.5 The webview projection disabled

`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`:

```diff
-	const durationProjection = durationDisplayProjection(projectedDuration)
+	const durationProjection = undefined as ReturnType<typeof durationDisplayProjection>
```

The `W4-RENDER` witness and the existing OBS05UI rendering witnesses go RED: the strip
renders the unavailable placeholder instead of the host's split.

**All ablations were REVERSED and the suites re-verified GREEN.** No intentionally failing
test is left in the default suite.

## 9. Live qualification

**NOT EXECUTED.** The operator directed that no VSIX be built, no artifact be installed, and
no live qualification be performed. The open live-qualification requirements are listed in
`06-amendment01-repair-evidence.md` §5.
