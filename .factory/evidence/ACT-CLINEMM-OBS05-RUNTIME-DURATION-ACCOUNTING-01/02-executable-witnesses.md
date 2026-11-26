# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 — 02 Executable Witnesses

## 1. The observational gap, reproduced (`OBSERVABILITY_GAP_REPRODUCED`)

The motivating limitation is real and is reproduced by an executable witness in
`apps/vscode/src/sdk/task-duration-accounting.obs05.test.ts`
(`OBS-05-GAP: the PRE-EXISTING wall-clock accounting cannot distinguish a human-gated
task from a continuously-executing one`).

Two scenarios are driven through the REAL production seam (the real `TurnStateTracker`
publishing to the real `TaskTelemetryTracker`, wired exactly as
`SdkController.ts` wires them):

| Scenario | Chronology | Pre-existing wall clock | New accounting |
|---|---|---|---|
| A — human-gated | 10s execute, 30s at a follow-up question, 15s execute | `startedAt`/`endedAt` identical | active 25 000 ms, waiting 30 000 ms |
| B — continuous | 55s execute | `startedAt`/`endedAt` identical | active 55 000 ms, waiting 0 ms |

**The pre-existing accounting reports the SAME numbers for both scenarios.** That is the
gap: a task that spent most of five hours waiting for a human is indistinguishable from a
task that executed for five hours, so its elapsed duration cannot be used to compare model
execution performance.

The new accounting separates them, from the SAME authoritative runtime evidence.

## 2. The production seam under test

The witnesses drive the real transition owner and read the result back from the real
published wire strip:

```
TurnStateTracker.setWithWriter(phase, ...)      // authoritative lifecycle owner
  -> subscribe(listener)                        // synchronous fan-out after the commit
    -> TaskTelemetryTracker.observeTurnPhase()   // production wiring: SdkController.ts L4730-4732
      -> TaskDurationAccountant.observePhase()   // classification + interval accumulation
        -> TaskTelemetryTracker.get()            // the published wire strip
          -> ExtensionState.taskTelemetry        // SdkController.getStateToPostToWebview()
            -> TaskHeaderTelemetry.tsx           // the webview projection
```

A standalone accumulator test would not prove this chain. Every witness in the matrix
therefore goes through `TurnStateTracker` and asserts on the published strip.

## 3. The qualification matrix (T01–T22)

All rows are covered by `apps/vscode/src/sdk/task-duration-accounting.obs05.test.ts`
(37 tests) and `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.duration.obs05.test.tsx`
(8 tests). The clock is INJECTED (`new TaskTelemetryTracker(clock)`), so the chronology is
exact and no test sleeps.

| ID | Scenario | Test(s) | Result |
|---|---|---|---|
| T01 | Continuous execution → all ACTIVE | `T01` | PASS — active 10 000, waiting 0, unknown 0 |
| T02 | Human question and resume → exact split | `T02`, `T02b` | PASS — active 25 000, waiting 30 000, elapsed 55 000 |
| T03 | Multiple approval gates → cumulative waiting | `T03`, `T03b` | PASS — waiting 17 000, active 13 000 |
| T04 | Slow provider response → ACTIVE | `T04` | PASS — active 45 000, waiting 0 |
| T05 | Automatic retry / backoff → ACTIVE | `T05`, `T05b` | PASS — automatic retry stays ACTIVE (waiting 0); a terminal `error` awaiting a human Retry is WAITING (`RECOVERY_INTERVENTION`) |
| T06 | Required background command → ACTIVE | `T06` | PASS — active 20 000 |
| T07 | Detached background job during a human wait → WAITING | `T07` | PASS — active 5 000, waiting 30 000 |
| T08 | Compaction during execution → no reset, ACTIVE | `T08` | PASS — active 20 000, elapsed 20 000 |
| T09 | Concurrent required operations → no double counting | `T09` | PASS — the UNION (10 000), not the SUM (20 000) |
| T10 | Duplicate lifecycle event → idempotent | `T10`, `T10b`, `T22c` | PASS — a repeated write of the same phase neither closes nor reopens the interval |
| T11 | Stale event / prior epoch → no contamination | `T11`, `T11b` | PASS — a new identity resets; a stale write cannot reopen a frozen epoch |
| T12 | Webview recreation → accounting preserved | `T12` | PASS — the published snapshot is identical |
| T13 | Task switching → no cross-task contamination | `T13`, `T13b` | PASS |
| T14 | Supported runtime recovery → durations preserved | `T14`, `OBS05-PERSIST-2` | PASS — active 30 000, waiting 5 000 across the recovery |
| T15 | Unobservable restart gap → UNKNOWN / partial coverage | `T15`, `OBS05-PERSIST-4` | PASS — coverage `partial`, the gap is NOT attributed and NO duration is invented |
| T16 | Wall-clock regression → no negative duration | `T16` | PASS — every component stays `>= 0` |
| T17 | Terminal completion / cancellation / failure → totals frozen | `T17`, `T17b` | PASS — the totals do not advance over an independent 60 s interval |
| T18 | Explicit continuation after completion → no dormant inflation | `T18` | PASS — a 1 h dormant gap is excluded (active 15 000, elapsed 15 000) |
| T19 | Legacy task without accounting → unavailable, not fabricated | `T19`, `OBS05-PERSIST-5` | PASS — the field is absent, never a zero |
| T20 | Stale UI snapshot → no authoritative extrapolation | `T20` | PASS — the host never mutates a published snapshot; a stale object keeps the stale numbers |
| T21 | Simultaneous human gate + required automatic work → ACTIVE until gated | `T21` | PASS |
| T22 | Repeated mount/unmount → no leaked subscriptions or timers | `T22`, `T22b`, `T22c` | PASS |

Webview rows: `OBS05UI-01..08` — the split renders, the waiting reason is visible, partial
coverage is identified, unknown time is displayed separately, and a legacy task renders
"unavailable" rather than a fabricated zero.

## 4. Persistence and recovery

`OBS05-PERSIST-1..5` cover the persistence seam:

* The persisted record carries the accumulated TOTALS and the phase — never a
  process-local monotonic timestamp (`OBS05-PERSIST-1` asserts the record has no
  `openAnchorMs` / `startedAt` key).
* The restore preserves the known durations and is idempotent (`OBS05-PERSIST-2`).
* A restore for a different task identity is ignored (`OBS05-PERSIST-3`).
* The interval spanning a process restart is NOT claimed (`OBS05-PERSIST-4`) — the
  restored accounting re-opens an interval in the recorded category from the CURRENT
  monotonic clock, so the unobservable gap is never silently classified.
* A legacy task with no record reports unavailable (`OBS05-PERSIST-5`).

## 5. Non-vacuity (ablation) — the load-bearing witnesses are NOT self-referential

The ACT requires the load-bearing accounting witnesses to be shown non-vacuous by
temporarily disabling the relevant transition accounting.

### 5.1 Host ablation — the transition accounting disabled

`apps/vscode/src/sdk/task-telemetry-tracker.ts`, `observeTurnPhase`:

```diff
-		if (isTurnPhase(phase)) {
+		if (false && isTurnPhase(phase)) {
 			this.durationAccountant.observePhase(phase)
 		}
```

```
 Test Files  1 failed (1)
      Tests  29 failed | 8 passed (37)
```

29 of 37 witnesses went RED. The ablation was then REVERSED and the suite returned to
`37 passed (37)`. The accounting is therefore genuinely bound to the production
transition — the witnesses are not self-referential.

### 5.2 Webview ablation — the duration projection disabled

`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`:

```diff
-	const durationProjection = durationDisplayProjection(telemetry.duration)
+	const durationProjection = undefined as ReturnType<typeof durationDisplayProjection>
```

```
 Test Files  1 failed (1)
      Tests  5 failed | 3 passed (8)
```

5 of 8 webview witnesses went RED, and the ablation was REVERSED to
`8 passed (8)`. The rendering is genuinely bound to the host's projected snapshot.

**No intentionally failing test is left in the default suite.** Both ablations were
reverted and the suites re-verified GREEN.
