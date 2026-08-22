# ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION01

**Disposition**: ADDRESSES 3 P0 BLOCKERS + 1 P1 FROM LIVE-CAPTURE01 REVIEW.

**Predecessor ACT**: `ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01` (head `2d1b044d3`), reviewed with disposition `HALT_CAPTURE_NOT_OPERABLE_OR_IDENTITY_BOUND`.

**Parent ACT**: `ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01` (RECON / LIVE_CAPTURE).

## Reviewer blockers addressed

| # | Severity | Blocker | Resolution |
|---|----------|---------|------------|
| 1 | P0 | Capture discarded `stateVersion`, `taskId`, `sessionId`, `epoch` | `HostOwnershipFactsSnapshot` now REQUIRES `stateVersion` and OPTIONALLY carries `_ptadPushId`, `taskId`, `sessionId`, `epoch`. The unused `HostOwnershipIdentity` interface was deleted. Every ring record now joins to the existing PTAD identity on the SAME five fields. |
| 2 | P0 | No operator surface (no `package.json` command, no registry entry, no extension.ts registration) | Added `cline.debug.toggleHostOwnershipDiagnostic` and `cline.debug.dumpHostOwnershipDiagnostic`. Workspace-scoped toggle (mirrors PTAD / TSWPD). Dump writes `<globalStorageUri>/host-ownership-diagnostic.jsonl` with the exact same JSONL shape as PTAD. `SdkController.getStateToPostToWebview` syncs the ring state on every push so the workspace flag flips take effect immediately. |
| 3 | P0 | "No public product API" contradicted by `RuntimeHost.captureHostOwnershipFacts?`, `ClineCore.captureHostOwnershipFacts()`, `SdkSessionHost.captureHostOwnershipFacts?`, `HostOwnershipFactsSnapshot` re-export | Reverted: `RuntimeHost` clean, `SdkSessionHost` clean, `HostOwnershipFactsSnapshot` NOT re-exported from `@cline/core`. `LocalRuntimeHost.captureHostOwnershipFacts` and `ClineCore.captureHostOwnershipFacts` are kept as **class methods** (not interface methods). The apps/vscode probe accesses them via a host-only `VscodeSessionHost.readHostFacts` (NOT on the `SdkSessionHost` interface — same precedent as `cancelBackgroundCommand`). |
| 4 | P1 | D3 bypassed the real capture helper | `D3` test rewritten to drive the real `captureAndRecordHostOwnershipFacts` with absent probe, and asserts that a correlated `observationAvailable: false` row is recorded (NOT no row). |

## Reviewer simplification addressed

The per-observation-granular recorder path (`hostOwnershipFacts` on
`TaskShadowRecordInput` / `TaskShadowDifferentialRecord`, `getHostOwnershipFacts?`
on coordinator / host-wiring, privacy allowlist addition) was removed.
The synchronized state-post capture is the load-bearing artifact; the
recorder-side duplication added 4 production files without carrying
information that the PTAD-correlated ring cannot already provide.

## Reviewer P1 / D3 corrected

D3 now exercises the REAL capture helper. The test asserts that:

* when `probe` is undefined, a row is STILL recorded with
  `observationAvailable: false` and all six raw fields undefined;
* the identity fields (`stateVersion`, `_ptadPushId`, `taskId`,
  `sessionId`, `epoch`) are STILL stamped;
* when `probe.readHostFacts` returns `undefined`, the same row shape
  is recorded;
* when `probe.readHostFacts` returns facts, `observationAvailable: true`
  + the six raw fields are stamped.

This eliminates the prior ambiguity where "no row" could mean any of
several failure modes.

## Architecture after CORRECTION01

### Public `@cline/core` delta

| Surface | Before | After |
|---------|--------|-------|
| `RuntimeHost` interface | unchanged | **unchanged** (no `captureHostOwnershipFacts?` added) |
| `LocalRuntimeHost` class | had `captureHostOwnershipFacts(sessionId)` | **kept as class method only** (not in interface) |
| `ClineCore` class | had `captureHostOwnershipFacts(sessionId)` | **kept as class method only** |
| `HostOwnershipFactsSnapshot` re-export | re-exported from `@cline/core` | **REMOVED**; the shape is now `HostOwnershipFactsSnapshotInternal` in `runtime-host.ts` (NOT re-exported) |

### apps/vscode surface

| Surface | Before | After |
|---------|--------|-------|
| `SdkSessionHost` interface | had `captureHostOwnershipFacts?` | **clean** (no addition) |
| `VscodeSessionHost` class | had `captureHostOwnershipFacts(sessionId)` | now has `readHostFacts(sessionId)` (NOT on `SdkSessionHost`) + exports `HostOwnershipHostFacts` shape |
| `HostOwnershipProbe` (duck-typed) | n/a | NEW local interface in `apps/vscode/src/sdk/host-ownership-capture/index.ts` |
| `captureAndRecordHostOwnershipFacts` | sync | now **async** (probe can be async) |
| `captureFromActiveSession` | took 3 args | takes 5 args (stateVersion, _ptadPushId, taskId, epoch, activeSession), async |
| `SdkController.getStateToPostToWebview` | sync capture call | `await` async capture |
| `TaskShadowRecorder.hostOwnershipFacts` | added | **REMOVED** |
| `TaskShadowCoordinatorDeps.getHostOwnershipFacts?` | added | **REMOVED** |
| `TaskShadowHostWiringDeps.getHostOwnershipFacts?` + `isHostOwnershipDiagnosticEnabled?` | added | **REMOVED** |
| Privacy allowlist `hostOwnershipFacts` | added | **REMOVED** |

### Operator surface (NEW)

| Surface | Where |
|---------|-------|
| `cline.debug.toggleHostOwnershipDiagnostic` | `apps/vscode/src/registry.ts` + `apps/vscode/package.json` + `apps/vscode/src/extension.ts:608` |
| `cline.debug.dumpHostOwnershipDiagnostic` | `apps/vscode/src/registry.ts` + `apps/vscode/package.json` + `apps/vscode/src/extension.ts:618` |
| Workspace-state key `hostOwnershipDiagnosticEnabled` | `apps/vscode/src/sdk/host-ownership-diagnostic-runtime.ts:50` |
| Dump file `<globalStorageUri>/host-ownership-diagnostic.jsonl` | `apps/vscode/src/sdk/host-ownership-diagnostic-runtime.ts:52` |

## Quality gates (against this commit)

* bun run check-types   0 diagnostics (proto regen + tsc + compat + webview tsc)
* bun run lint          PASS
* bun run test:unit     1076/1076 PASS (no regression)
* bun run test:vitest   2021/2021 PASS (includes 28 new tests: 15 shared + 7 capture-helper + 6 runtime)

## New tests (28 total)

### `apps/vscode/src/shared/host-ownership-diagnostic.live-capture01.test.ts` (15 tests)

* D1 disabled => no records / no semantic delta
* D2 + CORRECTION01 identity roundtrip (5-field)
* D2 raw six values roundtrip
* D3 missing host/session => correlated unavailable row (identity preserved)
* D4 pendingPromptCount and drainingPendingPrompts remain distinct
* D5 lastInteractiveTurnFinishReason remains raw source value
* D6 bounded ring behavior (drops oldest first)
* D7 no diagnostic value consumed by TaskHeader projection
* deriveCandidateAwaitingFollowup (HYPOTHESIS_ONLY) -- 6 sanity checks

### `apps/vscode/src/sdk/host-ownership-capture.live-capture01.test.ts` (7 tests)

* no-op when diagnostic disabled
* writes correlated unavailable row when probe absent
* writes correlated unavailable row when probe has no readHostFacts
* exact five-field identity roundtrip through REAL helper
* records observationAvailable=true + candidateAwaitingFollowup on success
* captureFromActiveSession no-ops on missing activeSession
* captureFromActiveSession passes the activeSession.sdkHost as probe

### `apps/vscode/src/sdk/__tests__/host-ownership-diagnostic-runtime.live-capture01.test.ts` (6 tests)

* fresh install remains OFF (workspace state undefined)
* toggle ON sets workspace state, enables ring
* toggle twice returns OFF
* dump produces JSONL with the exact identity-bound record
* dump works even when diagnostic is disabled (preserves existing ring)
* dump creates the globalStorageUri directory if missing (mkdir-recursive)

## Files changed (CORRECTION01 commit)

### Modified
- `apps/vscode/src/shared/host-ownership-diagnostic.ts` (193 -> 215 lines, identity-bound snapshot)
- `apps/vscode/src/shared/host-ownership-diagnostic.live-capture01.test.ts` (full rewrite)
- `apps/vscode/src/sdk/host-ownership-capture/index.ts` (sync -> async, probe shape, identity fields)
- `apps/vscode/src/sdk/host-ownership-capture.live-capture01.test.ts` (full rewrite, real-helper D3)
- `apps/vscode/src/sdk/SdkController.ts` (workspace-state sync + await capture call + identity fields)
- `apps/vscode/src/sdk/session-host.ts` (reverted to clean)
- `apps/vscode/src/sdk/vscode-session-host.ts` (readHostFacts host-only seam, no SdkSessionHost change)
- `apps/vscode/src/sdk/task-state-shadow-recorder.ts` (reverted)
- `apps/vscode/src/sdk/task-state-shadow-coordinator.ts` (reverted)
- `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts` (reverted)
- `apps/vscode/src/sdk/__tests__/task-state-shadow-recorder.test.ts` (privacy allowlist reverted)
- `sdk/packages/core/src/runtime/host/runtime-host.ts` (interface unchanged; `HostOwnershipFactsSnapshotInternal` added)
- `sdk/packages/core/src/runtime/host/local-runtime-host.ts` (class method only)
- `sdk/packages/core/src/ClineCore.ts` (class method only; internal type)
- `sdk/packages/core/src/index.ts` (no re-export)
- `apps/vscode/src/registry.ts` (added two commands)
- `apps/vscode/src/extension.ts` (registered two commands)
- `apps/vscode/package.json` (added two command declarations)
- `apps/vscode/biome.jsonc` (ignored the new runtime file for the useCacheService plugin)
- `docs/architecture/elm/task-interaction-ownership-projection01-live-capture01.md` (header updated)

### New
- `apps/vscode/src/sdk/host-ownership-diagnostic-runtime.ts` (119 lines, runtime adapter)
- `apps/vscode/src/sdk/__tests__/host-ownership-diagnostic-runtime.live-capture01.test.ts` (151 lines, 6 tests)
- `docs/architecture/elm/task-interaction-ownership-projection01-live-capture01-correction01.md` (this file)

## What this ACT enables

After CORRECTION01, an operator can:

1. Open a Codium workspace with the freshly-built extension from this branch head.
2. Run `Cline: Toggle Host Ownership Diagnostic` from the command palette.
3. Reproduce the LIVE-T1 symptom (toolCalls incrementing while TaskHeader=Idle).
4. Run `Cline: Dump Host Ownership Diagnostic` from the command palette.
5. Open the JSONL file at the path the dump message reports.
6. For each `_ptadPushId` row, join to the PTAD capture on the SAME five identity fields.
7. Read the six raw host-side facts + `observationAvailable` + `candidateAwaitingFollowup` (HYPOTHESIS_ONLY).
8. Classify O1..O5 (or `CAPTURE_INSUFFICIENT`).

The capture is now actually operable for dogfood.

## Removal trigger (UNCHANGED from LIVE-CAPTURE01)

First of:

1. **root cause classified** — a real LIVE capture lands in O1, O2, O3,
   or O4 with high confidence.
2. **capture insufficient** — the LIVE capture fails to correlate the
   six fields at the same identity, or the diagnostic is gated by a
   Hub/Remote host that omits `readHostFacts`.
3. **successor evidence supersedes it** — the successor ACT decides
   that a different capture shape (or no capture at all) is needed.

Removal sequence is unchanged from LIVE-CAPTURE01; the only difference
is that `runtime-host.ts` keeps the `HostOwnershipFactsSnapshotInternal`
interface (internal to `@cline/core` only).


---

# CORRECTION02 (supersedes CORRECTION01)

**Disposition**: ADDRESSES 2 P0 + 1 P1 FROM CORRECTION01 REVIEW.

**Reviewer halt**: `HALT_CAPTURE_TEMPORAL_BINDING_AND_PUBLIC_SURFACE_NOT_CLOSED`.

## What changed

| Reviewer finding | Resolution |
|------------------|------------|
| **P0 #1**: `await` of an already-resolved Promise yields execution; the capture path crossed a microtask boundary between snapshot identity stamp and host-facts read — the same labels could end up stamped onto a later observation. | **Restored synchronous capture end-to-end.** `HostOwnershipProbe.readHostFacts` returns sync; `VscodeSessionHost.readHostFacts` returns sync; `captureAndRecordHostOwnershipFacts` returns `void`; `captureFromActiveSession` returns `void`. The capture path is now a single JavaScript turn with no microtask boundary. New TEMPORAL BINDING test mutates an external marker inside the probe synchronously and asserts the marker is observed BEFORE `captureAndRecordHostOwnershipFacts` returns. |
| **P0 #2**: `ClineCore.captureHostOwnershipFacts()` is a public method on the public `ClineCore` class, which is documented as the app-facing session API. CORRECTION01's "reachable only through the in-package ClineCore class" was a visibility game. | **Added explicit `PUBLIC API DELTA: yes / PROVISIONAL` labeling** on both `ClineCore.captureHostOwnershipFacts` and `LocalRuntimeHost.captureHostOwnershipFacts`, matching the existing `ClineCore.getActiveRuntimeSnapshot` precedent (PUBLIC API DELTA: yes, PROVISIONAL). The honest acknowledgment is that this method is a public API surface delta. Removal sequence is documented in the board row. |
| **P1**: `captureFromActiveSession(..., undefined)` produced no row, contradicting the documented "missing session => correlated unavailable row" claim. | When `activeSession === undefined` AND the diagnostic is enabled, `captureFromActiveSession` now writes a correlated `observationAvailable: false` row stamped with `stateVersion` + `_ptadPushId` + `taskId` + `epoch`. No host facts are synthesized. |

## Quality gates (CORRECTION02)

* bun run check-types   0 diagnostics
* bun run lint          PASS
* bun run test:unit     1076/1076 PASS
* bun run test:vitest   2023/2023 PASS (2 new: synchronous-signature + temporal-binding)

## New tests (CORRECTION02)

In `apps/vscode/src/sdk/host-ownership-capture.live-capture01.test.ts`:

* `SYNCHRONOUS signature: returns void, not Promise` — asserts the helper's return type is `void`, not `Promise<void>`.
* `TEMPORAL BINDING: probe mutation is observed synchronously inside the helper call` — the load-bearing structural test. Mutates an external marker inside the probe and asserts the marker is observed BEFORE the helper returns. With any `await` boundary, the marker would still be `false` when the helper returns; the next microtask would set it. The assertion proves the boundary is gone.

Plus the P1 fix test:

* `captureFromActiveSession: P1 fix - missing activeSession writes correlated unavailable row` — `stateVersion`/`_ptadPushId`/`taskId`/`epoch` are stamped verbatim, `sessionId` is undefined, `observationAvailable` is `false`.

## Reviewer invariants preserved from CORRECTION01

```
OPERATOR COMMAND SURFACE     = PRESENT (toggle + dump commands + package.json + registry)
TOGGLE DEFAULT-OFF           = PROVEN (workspace-state key, fresh install returns false)
DUMP JSONL                   = PRESENT (globalStorageUri/host-ownership-diagnostic.jsonl)
IDENTITY FIELDS IN ARTIFACT  = PROVEN (stateVersion + _ptadPushId + taskId + sessionId + epoch)
UNAVAILABLE PROBE ROW        = PROVEN (correlated observationAvailable=false)
TASKSHADOW DUPLICATION       = REMOVED (recorder + coordinator + host-wiring cleaned)
OBSERVATION LOCAL SEAM       = PRESERVED (VscodeSessionHost.readHostFacts is host-only, NOT on SdkSessionHost interface)
@cline/core BARREL UNCHANGED = PROVEN (HostOwnershipFactsSnapshotInternal NOT re-exported)
RUNTIMEHOST INTERFACE UNCHANGED = PROVEN (no captureHostOwnershipFacts? added)
NO PROTO/WIRE CHANGE         = PROVEN
```

## What is honest now (vs CORRECTION01)

CORRECTION01 claimed "no public API" while leaving `ClineCore.captureHostOwnershipFacts` on the public app-facing class. CORRECTION02 fixes that by **explicitly labeling** the method as a PROVISIONAL public API delta, matching the existing `getActiveRuntimeSnapshot` precedent. The barrel export does not change; the `RuntimeHost` interface does not change; the new method is on a public class with an honest label.

Removal is unchanged: first of (root cause classified, capture insufficient, successor evidence supersedes this diagnostic). When that fires, both the method and the diagnostic module are deleted in their entirety.
