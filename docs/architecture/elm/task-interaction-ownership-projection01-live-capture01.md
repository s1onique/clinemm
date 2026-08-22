# ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01

**Disposition**: TEMPORARY INSTRUMENTATION SHIPPED, AWAITING LIVE CAPTURE.

**Parent ACT**: `ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01` (RECON — IN_PROGRESS).
**Predecessor**: `ACT-CLINEMM-CANONICAL-TASK-ACTIVITY-OWNERSHIP01` (HALTED at Factory review with disposition `HALT_TASK_LIFETIME_NOT_ACTIVITY_AUTHORITY`).
**First purpose**: acquire LIVE evidence, NOT repair.

This document is the architecture / contract / evidence record for the
temporary host-ownership instrumentation. It records:

1. **What was instrumented** — the smallest seam that lets a single
   state-post publication carry six host-side facts alongside the
   existing PTAD identity (`stateVersion` + `_ptadPushId`).
2. **What the instrumentation does NOT do** — projection, mutation,
   public product API, message/wire field, polling, or timers.
3. **What the instrumentation gates** — D1..D7 review-mandated tests
   that prove the diagnostic is safe.
4. **What a real LIVE capture will produce** — exact row shape for the
   O1..O5 classification.

## Reviewer-mandated constraints (C1: GO EVIDENCE)

> The instrumentation must be:
>
>   - DEFAULT_OFF
>   - explicitly opt-in
>   - bounded
>   - removable
>   - zero semantic delta while disabled
>   - no public product API
>   - no message/protocol field
>   - no mutation of runtime/session state
>   - no side effects inside functional React updaters
>
> No timers. No polling state machine. No activity heuristics.

All nine constraints are enforced by code AND by D1..D7 tests.

## Architecture

### Existing surfaces reused

| Surface | Used for |
|---------|----------|
| `RuntimeHost.captureHostOwnershipFacts?(sessionId): HostOwnershipFactsSnapshot \| undefined` (NEW, optional) | raw host-side reads |
| `ClineCore.captureHostOwnershipFacts(sessionId)` (NEW) | proxy chain `ClineCore -> LocalRuntimeHost -> ActiveSession` |
| `SdkSessionHost.captureHostOwnershipFacts?(sessionId)` (NEW, optional) | interface seam for the VSCode-side adapter |
| `VscodeSessionHost.captureHostOwnershipFacts(sessionId)` (NEW) | the only implementation, delegates to `ClineCore` |
| `SdkSessionLifecycle.getActiveSession()?.isRunning` (EXISTING) | host-side `sessionIsRunning` mirror |
| `SdkController.getStateToPostToWebview()` (EXISTING) | the synchronized state-post boundary that already mints `_ptadPushId` |
| `recordPostTerminalAuthoritySnapshot(...)` (EXISTING) | reference: the synchronized capture pattern |

### New surfaces added

| Surface | Where | Purpose |
|---------|-------|---------|
| `HostOwnershipFactsSnapshot` type | `sdk/packages/core/src/runtime/host/runtime-host.ts` (re-exported from `@cline/core`) | typed shape for the six raw host facts + the DIAGNOSTIC_DERIVATION_ONLY `candidateAwaitingFollowup` field |
| `enableHostOwnershipDiagnostic()` / `disableHostOwnershipDiagnostic()` / `isHostOwnershipDiagnosticEnabled()` / `setHostOwnershipDiagnosticBufferSize(n)` / `clearHostOwnershipDiagnostic()` / `recordHostOwnershipFacts(s)` / `getHostOwnershipDiagnostic()` | `apps/vscode/src/shared/host-ownership-diagnostic.ts` | the bounded ring buffer + opt-in enable switch |
| `deriveCandidateAwaitingFollowup(facts): boolean \| undefined` | same module | HYPOTHESIS_ONLY formula, isolated so production projection paths cannot reach it without the explicit import |
| `captureFromActiveSession(stateVersion, _ptadPushId, activeSession)` | `apps/vscode/src/sdk/host-ownership-capture/index.ts` | the synchronized capture helper, called at the same state-post boundary as PTAD |
| Optional `hostOwnershipFacts?: HostOwnershipFactsSnapshot` on `TaskShadowRecordInput` and `TaskShadowDifferentialRecord` | `apps/vscode/src/sdk/task-state-shadow-recorder.ts` | per-observation-granular diagnostic (independent of PTAD) |
| Optional `getHostOwnershipFacts?: () => HostOwnershipFactsSnapshot \| undefined` on `TaskShadowCoordinatorDeps` and `TaskShadowHostWiringDeps` | `apps/vscode/src/sdk/task-state-shadow-coordinator.ts` / `host-wiring.ts` | wiring of the per-observation-granular capture |

### What the recorder path does NOT do

- Does NOT participate in classification (`classify(input)`) or arbitration (`arbitrate(input, classification)`). The recorder merely stamps the optional field onto the bounded record.
- Does NOT participate in projection. `selectTaskHeaderPresentation` / `TaskHeaderTelemetry` / the canonical `projectTurnState` / `projectHostTurnState` paths do not import this module.
- Does NOT influence the shadow model. The comparator does not read this module.

## Synchronization: how `stateVersion` + `_ptadPushId` correlate the two captures

Both the PTAD capture and the synchronized host-ownership capture run in
the same `SdkController.getStateToPostToWebview()` invocation. Both
receive the same `stateVersion` and `_ptadPushId`. Both are synchronous,
no-op-when-disabled.

The per-observation-granular recorder path runs on every
`coordinator.observe(...)` call (much higher frequency) and stamps
`hostOwnershipFacts` onto the recorder's `seq` + `timestamp`. The two
captures are joined on `_ptadPushId` (PTAD) or `seq` + `timestamp`
(recorder) but neither is the load-bearing identity for the LIVE
capture. The PTAD identity (`stateVersion` + `_ptadPushId`) is what
the ACT-canonical repro flow uses.

## D1..D7 tests (reviewer-mandated)

```
D1 disabled => no records / no semantic delta              ← host-ownership-diagnostic.live-capture01.test.ts
D2 exact host values round-trip unchanged                  ← same
D3 missing host/session => values recorded as unavailable   ← same
D4 pendingPromptCount and drainingPendingPrompts remain distinct  ← same
D5 lastInteractiveTurnFinishReason remains raw source value ← same
D6 bounded ring behavior                                   ← same
D7 no diagnostic value is consumed by TaskHeader projection ← same
```

All seven pass under the `apps/vscode/src/shared/host-ownership-diagnostic.live-capture01.test.ts`
vitest file (15 tests total, includes 6 hypothesis-only formula sanity
checks).

## What a real LIVE capture will produce

For each `_ptadPushId`, the synchronized capture produces a
`HostOwnershipFactsSnapshot` with these exact fields:

```
_ptadPushId               number (or undefined when PTAD is off)
capturedAt                Date.now()
lastInteractiveTurnFinishReason   AgentFinishReason | undefined
sessionStatus                    string | undefined
sessionIsRunning                 boolean | undefined
pendingPromptCount               number | undefined
drainingPendingPrompts           boolean | undefined
agentCanStartRun                 boolean | undefined
candidateAwaitingFollowup        boolean | undefined (DIAGNOSTIC_DERIVATION_ONLY)
```

A successful live reproduction of the LIVE-T1 symptom will stamp the
above on the EXACT `_ptadPushId` whose PTAD entry reads `taskHeaderPhase=Idle`,
`runtimeStatus=idle`, `shadowStatus=idle`, `legacyPhase=idle`.

## O1..O5 classification (the post-capture decision)

The ACT plan prescribes five mutually exclusive classifications once
a real capture is in hand:

```
CASE_O1_QUEUED_DRAIN_OWNS_PROGRESS
  header is Idle while:
    drainingPendingPrompts === true
  OR:
    pendingPromptCount > 0 and agentCanStartRun === true
  -> queued successor spans the gap; truthful TaskHeader = Working.

CASE_O2_ACTIVE_HOST_TURN_NOT_PROJECTED
  session.isRunning or session.status proves active host ownership
  while TaskHeader remains idle.
  -> producer-side drop; the legacy tracker is missing a state-post.

CASE_O3_RECOVERY_SUCCESSOR_OWNS_PROGRESS
  previous finish was non-user-owned and a recovery/auto successor owns
  progress.
  -> the producer missed a recovery continuation; truthful TaskHeader
     = Working.

CASE_O4_USER_WAITING_WITH_ASYNC_TAIL
  previous turn is genuinely user-owned,
  no queued/draining/scheduled successor exists,
  and observed tool/message changes are merely completion tail.
  -> TaskHeader Waiting may be truthful; visible activity does NOT
     prove Working.

CASE_O5_HOST_SIGNALS_INSUFFICIENT
  LIVE system progress is proven, but none of the existing host signals
  identifies its owner.
  -> the only case that authorizes considering a new explicit
     forwardProgressOwner dimension.

CAPTURE_INSUFFICIENT
  required signals or publication correlation unavailable.
```

Only after a real capture classifies into one of O1..O5 can the
successor ACT (wiring the proven existing host ownership signal into
canonical TaskState projection) be authorized.

## Removal trigger

This temporary instrumentation is removed in its entirety at the first
of:

1. **root cause classified** — a real LIVE capture lands in O1, O2, O3,
   or O4 with high confidence, and the successor ACT has been opened
   to wire the proven signal.
2. **capture insufficient** — the LIVE capture fails to correlate the
   six fields at the same `_ptadPushId`, or the diagnostic is gated by
   a Hub/Remote host that omits `captureHostOwnershipFacts?`.
3. **successor evidence supersedes it** — the successor ACT decides
   that a different capture shape (or no capture at all) is needed.

The removal sequence is:

1. revert the SDK / SDK wiring / recorder changes,
2. delete `apps/vscode/src/shared/host-ownership-diagnostic.ts`,
3. delete `apps/vscode/src/sdk/host-ownership-capture/`,
4. delete the two test files,
5. revert the `PRIVACY_ALLOWED_KEYS` allowlist addition,
6. revert the `vitest.config.ts` include-list addition,
7. revert the `@cline/core` `HostOwnershipFactsSnapshot` re-export,
8. remove the board row.

No production-side semantic change is expected to remain after the
removal: every change is opt-in (`isHostOwnershipDiagnosticEnabled()`),
gated (`deps.isHostOwnershipDiagnosticEnabled?.() !== true`), or a
non-mutating read-through (`captureHostOwnershipFacts(sessionId)`).

## Quality gates against this branch

* bun run check-types       0 diagnostics (proto regen + tsc + compat + webview tsc)
* bun run lint              PASS
* bun run test:unit         1076/1076 PASS
* bun run test:vitest       2012/2012 PASS (includes 15 new host-ownership-diagnostic tests + 4 new capture-helper tests)
* bun run build:sdk         PASS

## Files changed

### New
- `apps/vscode/src/shared/host-ownership-diagnostic.ts` (193 lines)
- `apps/vscode/src/shared/host-ownership-diagnostic.live-capture01.test.ts` (295 lines, 15 tests, D1..D7)
- `apps/vscode/src/sdk/host-ownership-capture/index.ts` (~80 lines)
- `apps/vscode/src/sdk/host-ownership-capture.live-capture01.test.ts` (100 lines, 4 tests)
- `docs/architecture/elm/task-interaction-ownership-projection01-live-capture01.md` (this file)

### Modified
- `sdk/packages/core/src/runtime/host/runtime-host.ts` — added `HostOwnershipFactsSnapshot` type + optional `captureHostOwnershipFacts?` method on `RuntimeHost`
- `sdk/packages/core/src/runtime/host/local-runtime-host.ts` — implemented `captureHostOwnershipFacts(sessionId)` (read-only over `ActiveSession`)
- `sdk/packages/core/src/ClineCore.ts` — added proxy method `captureHostOwnershipFacts(sessionId)`
- `sdk/packages/core/src/index.ts` — re-export `HostOwnershipFactsSnapshot`
- `apps/vscode/src/sdk/session-host.ts` — added optional `captureHostOwnershipFacts?` to `SdkSessionHost`
- `apps/vscode/src/sdk/vscode-session-host.ts` — implemented `captureHostOwnershipFacts(sessionId)` (delegates to `ClineCore`)
- `apps/vscode/src/sdk/task-state-shadow-recorder.ts` — added optional `hostOwnershipFacts` field on both `TaskShadowRecordInput` and `TaskShadowDifferentialRecord`
- `apps/vscode/src/sdk/task-state-shadow-coordinator.ts` — added optional `getHostOwnershipFacts?` dependency; `applyAndRecord` reads through it on every observation
- `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts` — added `getHostOwnershipFacts?` and `isHostOwnershipDiagnosticEnabled?` to `TaskShadowHostWiringDeps`; coordinator creation reads through them
- `apps/vscode/src/sdk/SdkController.ts` — calls `captureHostOwnershipFactsAtStatePost(snapshot.stateVersion, ptadPushId, this.sessions.getActiveSession())` next to the existing PTAD capture in `getStateToPostToWebview()`
- `apps/vscode/src/sdk/__tests__/task-state-shadow-recorder.test.ts` — added `"hostOwnershipFacts"` to `PRIVACY_ALLOWED_KEYS`
- `apps/vscode/vitest.config.ts` — added `src/shared/host-ownership-diagnostic.live-capture01.test.ts` to the include list
