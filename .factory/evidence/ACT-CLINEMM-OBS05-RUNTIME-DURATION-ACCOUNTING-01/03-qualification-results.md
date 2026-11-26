# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 — 03 Qualification Results

## 1. Production delta

| File | Change |
|---|---|
| `apps/vscode/src/sdk/task-duration-accounting.ts` | **NEW** — the pure, interval-based ACTIVE/WAITING/UNKNOWN accumulator. Owns the phase→category mapping, the injectable monotonic clock, the discontinuity handling, and the persistence projection. |
| `apps/vscode/src/sdk/task-telemetry-tracker.ts` | The existing host-side accumulator now feeds the duration accountant from the SAME authoritative phase transition (`observeTurnPhase`), resets it on a new task identity / `clear()`, publishes the snapshot on the existing wire strip, and exposes the persistence projection + restore seam. |
| `apps/vscode/src/shared/ExtensionMessage.ts` | The wire shape: `TaskDurationSnapshot` + `TaskDurationWaitingReason`, and the OPTIONAL `duration` field on the EXISTING `TaskHeaderTelemetryStrip`. No new RPC, no new event stream, no new public SDK contract. |
| `apps/vscode/src/shared/HistoryItem.ts` | The OPTIONAL persisted `duration` record (`TaskDurationPersistence`) beside the task's existing wall-clock epoch. |
| `apps/vscode/src/sdk/SdkController.ts` | Persists the accounting at the authoritative turn boundary into the task's existing `HistoryItem` slot; restores it on both the init and the RESUME seam. |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | The persistence seam is invoked at the SAME authoritative turn boundary as the existing usage persistence. |
| `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts` | Pure display helpers: `formatDuration`, `waitingReasonLabel`, `durationDisplayProjection`. |
| `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx` | Renders the split in the existing telemetry strip, using the existing design system. No new dependency. |

**No second lifecycle state machine was introduced.** The accounting reads the SAME
`TurnStateTracker` phase stream the existing tracker already observes.

## 2. Test delta

| File | Tests |
|---|---|
| `apps/vscode/src/sdk/task-duration-accounting.obs05.test.ts` | **37** — the production-seam matrix T01..T22, the observational-gap witness, and the persistence witnesses. |
| `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.duration.obs05.test.tsx` | **8** — the rendering witnesses. |

## 3. Gates

| Gate | Command | Result |
|---|---|---|
| Targeted production-seam tests | `bunx vitest run src/sdk/task-duration-accounting.obs05.test.ts` | **37 passed** |
| Webview tests (new) | `bunx vitest run src/components/chat/task-header/TaskHeaderTelemetry.duration.obs05.test.tsx` | **8 passed** |
| Existing tracker tests | `bunx vitest run src/sdk/task-telemetry-tracker.test.ts` | **64 passed** (unchanged) |
| Existing wiring test | `bunx vitest run src/sdk/SdkController.task-telemetry-wiring.test.ts` | **6 passed** (unchanged) |
| Extension typecheck | `bunx tsc --noEmit` (apps/vscode) | **CLEAN** |
| Webview typecheck | `bunx tsc --noEmit` (apps/vscode/webview-ui) | **CLEAN** |
| Lint | `bun run lint` (apps/vscode) | **CLEAN** — 3191 files checked, 0 errors |

### 3.1 Regression baseline (pre-existing failures, unchanged by this ACT)

The webview suite has PRE-EXISTING failures on the clean tree. They were measured by
stashing this ACT's changes and re-running:

| Suite | Clean tree (baseline) | With this ACT |
|---|---|---|
| `apps/vscode/webview-ui` — vitest | 15 failed files / **8 failed** / 1031 passed | 15 failed files / **8 failed** / 1031 passed **+ the 8 new OBS05 tests** |

The failure SET is identical (the same `@react-aria/toggle` module-resolution error and the
same 8 assertion failures in `TemporaryExternalPathsSection`,
`chat-existing-model-label-trigger`, `buttonConfig` and `InputSection`). **This ACT adds
zero new failures.**

`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.test.tsx` also fails
identically on the clean tree (the same `@react-aria/toggle` resolution error) — confirmed
by the stash-and-rerun baseline.

### 3.2 Host-suite regression baseline (exact test-level diff)

The host vitest suite has a large PRE-EXISTING failure set at the entry HEAD. The
regression was measured by running the suite at the ENTRY HEAD
(`3701158a1ceadf7705b84df5455ae57d9e443f7f`) and at the ACT head, capturing the
per-test failure sets as JSON, and diffing them.

| | Entry HEAD | With this ACT |
|---|---|---|
| Failing tests | 246 | 246 |
| Failing files | 70 | 70 |

The per-test diff (`NEW FAILURES` / `FIXED`) is EMPTY in both directions.

**One regression was found and closed during this comparison.** The first implementation
called a NEW `SdkController` method (`restoreDurationAccounting`) unconditionally from
`initTask`. The `SdkController.test.ts` harness builds a PARTIAL controller that implements
only a subset of the class, so the call threw
`this.restoreDurationAccounting is not a function` and aborted the task start. The
observation-side restore now goes through an optional bound property invoked with `?.`
inside a `try/catch`, so a restore problem degrades to "no accounting restored" instead of
aborting the task. `SdkController.test.ts` is back to **44/44 GREEN**.

The two `sdk-session-event-coordinator.test.ts` failures (`CPL02`, `OWN01`) are confirmed
PRE-EXISTING — both appear verbatim in the entry-HEAD baseline failure set.

## 4. Non-vacuity (ablation)

See `02-executable-witnesses.md` §5:

* Host ablation (the transition accounting disabled): **29 of 37** witnesses went RED.
* Webview ablation (the duration projection disabled): **5 of 8** witnesses went RED.

Both ablations were REVERSED and the suites re-verified GREEN
(`37 passed` / `8 passed`). **No intentionally failing test remains in the default suite.**

## 5. Semantic correction found by the executable witness

`T05b` exposed a defect in the FIRST implementation: the `error` phase was classified as
FROZEN, so the interval the task spends parked awaiting a human Retry was dropped from
EVERY bucket — elapsed time vanished and the conservation identity held only because the
vanished time was not counted at all.

The corrected mapping classifies `error` as **WAITING** with reason
`RECOVERY_INTERVENTION`, and `completed` as the only **FROZEN** state. The correction is
recorded in `01-authority-and-semantics.md` §2.1.1.

This is a bounded correction inside the ACT's own semantic contract; it changes NO
execution, approval, cancellation or recovery behaviour.
