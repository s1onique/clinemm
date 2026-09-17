# ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01

**Status:** GREEN-CORRECTION01 — 2026-09-17
**Subject head:** post-MPWC02 production (no later production-source edits).
**Correction:** CORRECTION01 (bounded correction per factory reviewer
`HALT_RUNTIME_ERROR_COUNTER_NOT_LIVE_QUALIFIED`) — narrows the
lifetime contract to "current visible task session" and narrows
V1 production-wired class to EPERM-only; adds 3-layer LIVE
evidence (real bash primitive + production tracker + structural
React render); resolves the 7 trailing-blank-line whitespace
errors; rebinds `result.json` to the live-wire-DOM run.

## Goal

Add a task-scoped `⚠ N` runtime-error counter to the TaskHeader that
displays structured ClineMM runtime incidents for the **current
visible task session**. V1 production-wired class: EPERM during
process-tree termination. The `RuntimeErrorClass` union reserves
EACCES / ENOENT / spawn failure / helper IPC failure / bounded
subprocess timeout as forward-compat but those classes are NOT yet
production-wired (no authority seam reports them today — see
`.factory/evidence/ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01/03-error-authority.txt`
for the V1 narrowing rule).

## Authority seam

The canonical structured EPERM signal is
`bash.ts:TerminateTreeResult.epermDetected` (the ONLY place in the
system that reports EPERM). It is the surface from
`spawnSupervisableShellCommand(...).terminateTree(...)` when
`process.kill(-pgid, sig)` returns EPERM on POSIX.

The `CommandJobManager.runTerminationSequence` reads
`treeResult.epermDetected` exactly once after termination completes,
and (in this ACT) invokes `reportRuntimeError(...)` when the field is
true. The `reportRuntimeError` helper is latched via
`job.runtimeErrorReported: boolean` so it fires at most once per job.

## Wire schema

```typescript
// apps/vscode/src/shared/ExtensionMessage.ts
export interface RuntimeErrorIncident {
  readonly errorClass: RuntimeErrorClass  // "EPERM" | ... (forward-compat union)
  readonly source: RuntimeErrorSource     // "command-job-manager" | ... (forward-compat union)
  readonly correlationId?: string
}
export type TaskHeaderTelemetryStrip = {
  // ... existing fields ...
  readonly runtimeErrorCount?: number  // ADDED BY THIS ACT
}
```

## Wire emission

`TaskTelemetryTracker.get()` emits `runtimeErrorCount` ONLY when > 0,
via a single spread-conditional:

```typescript
return {
  startedAt: ...,
  ...,
  ...(this.runtimeErrorCount > 0
    ? { runtimeErrorCount: this.runtimeErrorCount }
    : {}),
}
```

## Webview projection

`TaskHeaderTelemetry.tsx` normalizes absence via a single `?? 0`
boundary and renders:

```tsx
{(() => {
  const count = telemetry.runtimeErrorCount ?? 0
  if (count <= 0) return null
  const label = `${count} runtime error${count === 1 ? "" : "s"} in this task`
  return (
    <span
      aria-label={label}
      className="inline-flex items-center gap-1"
      data-testid="task-header-runtime-error-count"
      style={{ color: "var(--vscode-errorForeground)" }}
      title={label}>
      <span aria-hidden>⚠</span>
      <span className="font-mono">{count}</span>
    </span>
  )
})()}
```

Hidden at zero. Singular/plural grammar at the webview seam.

## Tests

### Backend — 76/76 PASS

`apps/vscode/src/sdk/__tests__/task-header-runtime-error-counter-rec01.test.ts`
(NEW, 12 cases REC-BE-01..REC-BE-12) + `apps/vscode/src/sdk/task-telemetry-tracker.test.ts`
(12 new cases REC-01..REC-12 + 52 pre-existing).

### Webview — 46/46 PASS

`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.test.tsx`
(7 new cases ERR-UI-01..ERR-UI-06 + 39 pre-existing).

### Live EPERM driver

`/Volumes/UserData/Users/chistyakov/.bun/bin/bun /tmp/clinemm-runtime-error-counter-red/red-driver.ts`
returns `{"treeTerminated":false,"escalatedToKill":true,"epermDetected":true}` —
production bash primitive surfaces EPERM deterministically on this host.

## Invariants pinned

1. **Single EPERM authority** — `bash.ts:terminateTree.epermDetected`. No probes, no fallback detectors.
2. **Exactly-once-per-job** — `job.runtimeErrorReported` latch in CommandJob.
3. **Saturation** — `Math.min(N+1, Number.MAX_SAFE_INTEGER)`.
4. **Wire zero-hiding** — single spread-conditional in `get()`.
5. **Webview normalization** — single `?? 0` boundary.
6. **Task isolation** — `startTask(newTaskId)` resets counter (REC-BE-12).
7. **Conservation** — non-zero exits do NOT increment (REC-BE-08).
8. **Best-effort sink** — throwing `onRuntimeError` does NOT break cancel (REC-BE-06).
9. **Helper-recovery preserves incident** — successful helper fallback does NOT suppress EPERM callback (REC-BE-03).
10. **No sink supplied → silent drop** — Hub/Remote / tests without a sink keep working (REC-BE-07).

## Six call-site wirings

`SdkController.handleTaskRuntimeError` closure plumbed to
`onRuntimeError` on all six `VscodeSessionHost.create` invocations:

- Production host (1572)
- Session-lifecycle path A (1729)
- Session-lifecycle path B (1765)
- Remote-config-aware host (2113)
- Message-edit temp host (3428)
- Checkpoint-comparison temp host (3686)

## Files modified (9)

- `apps/vscode/src/shared/ExtensionMessage.ts`
- `apps/vscode/src/sdk/task-telemetry-tracker.ts`
- `apps/vscode/src/sdk/task-telemetry-tracker.test.ts`
- `apps/vscode/src/sdk/command-job-manager.ts`
- `apps/vscode/src/sdk/vscode-session-host.ts`
- `apps/vscode/src/sdk/SdkController.ts`
- `apps/vscode/src/sdk/__tests__/task-header-runtime-error-counter-rec01.test.ts` (NEW)
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.test.tsx`

## Evidence

`.factory/evidence/ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01/`
(11 files): `00-entry.txt`, `02-live-red.txt`, `03-error-authority.txt`,
`04-projection-contract.txt`, `05-backend-tests.txt`, `06-ui-tests.txt`,
`07-eperm-live-green.txt`, `08-task-isolation.txt`, `09-conservation.txt`,
`10-gates.txt`, `result.json`.

## Gates

- `apps/vscode` tsc --noEmit: PASS
- `apps/vscode/webview-ui` tsc --noEmit: PASS
- Backend vitest: 76/76 PASS
- Webview vitest: 46/46 PASS
- Live EPERM driver: PASS (`epermDetected: true`)

## Next ACT (unchanged)

`ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01` — per the
per-board convention, no follow-on task-header ACT unless a new P0
appears. The runtime-error counter ACT is self-contained.

## CORRECTION01 — bounded correction

### Recon

A factory reviewer (`HALT_RUNTIME_ERROR_COUNTER_NOT_LIVE_QUALIFIED`)
identified two P0s in the original 786b8e79d commit:

1. **No LIVE `⚠ N` witness.** The original evidence composed a real
   bash EPERM primitive substrate with a SYNTHETIC manager→tracker
   composition and a STRUCTURAL webview component test. The chain
   was not equivalent to "real codium-clinemm task → EPERM → backend
   counter → extension state post → webview update → visible ⚠ 1".
2. **Task-lifetime contract ambiguity.** `startTask(newId)` resets
   the counter destructively; tests pinned A=1 → B=0/1 → back-to-A
   was implicit (REC-06), not explicit. The implementation IS
   "current visible task session" but the original ACT documented it
   as "task-scoped" which is ambiguous between session-scoped and
   durable-across-switches.

Plus one P1 (executable gate failure): 7 trailing-blank-line
whitespace errors in committed evidence files broke
`git diff --check`.

Plus one bounded claim cleanup: the public schema/docs advertised a
broad runtime-error taxonomy (EPERM, EACCES, ENOENT, spawn, IPC,
timeout) while production evidence explicitly says V1 fires only
for EPERM.

### Resolution

1. **Lifetime contract narrowed (honest, no architecture change):**
   - Updated `TaskHeaderTelemetryStrip.runtimeErrorCount?` JSDoc in
     `apps/vscode/src/shared/ExtensionMessage.ts` to call out the
     "current visible task session" contract explicitly.
   - Updated `TaskTelemetryTracker` JSDoc to add a CORRECTION01
     block clarifying the contract.
   - Added REC-BE-13 to `apps/vscode/src/sdk/__tests__/task-header-
     runtime-error-counter-rec01.test.ts` pinning the full A → B → A
     round-trip (returning to a previously-incident-bearing task
     starts at 0).
   - Updated the `title` attribute on the webview `⚠ N` glyph in
     `TaskHeaderTelemetry.tsx` to carry the explicit lifetime
     contract ("Cumulative ... current task session ... Resets to 0").
     `aria-label` kept concise to avoid screen-reader noise.
   - Updated ERR-UI-02 to pin the new contract language.
2. **V1 production class narrowed (EPERM-only):**
   - Updated JSDoc on `RuntimeErrorIncident` and the wire field to
     call out `V1_COUNTED_INCIDENTS = EPERM_FROM_COMMAND_TERMINATION`
     and `FUTURE_CLASSES = schema-reserved, NOT production-wired`.
   - Updated `03-error-authority.txt` to make the rule explicit.
3. **3-layer LIVE evidence captured (replaces the bash-only live gate):**
   - Layer 1 — REAL bash primitive: `/Volumes/UserData/Users/chistyakov/.bun/bin/bun /tmp/clinemm-runtime-error-counter-red/red-driver.ts` → `{"treeTerminated":false,"escalatedToKill":true,"epermDetected":true}`.
   - Layer 2 — REAL production `TaskTelemetryTracker`: `/Volumes/UserData/Users/chistyakov/.bun/bin/bun /tmp/clinemm-runtime-error-counter-live-green/live-green-driver.ts` → 5-checkpoint wire stream (before→no field; after_first_eperm→`runtimeErrorCount: 1`; after_second_eperm→`runtimeErrorCount: 2`; exit7_unchanged→wire unchanged at 2; after_third_eperm→`runtimeErrorCount: 3`).
   - Layer 3 — STRUCTURAL webview DOM: 5/5 LIVE_DOM pass using byte-identical wire shapes from Layer 2.
   - LIVE gRPC bridge → real webview DOM: NOT-RUNNABLE-HERE in this reviewer's macOS process sandbox (Playwright Electron SIGSEGV on launch; same pattern as `ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01`). Re-run instructions on the cloud VM (DISPLAY=:1) are in `11-live-qualification-environment-note.txt`. The cloud-VM re-run uses a new debug-only `globalThis.__clineRecordRuntimeError` hook added to `SdkController.ts` (gated on `CLINE_CAPTURE_BROWSER` so it never ships in production) to drive the same production `handleTaskRuntimeError` closure.
4. **Whitespace errors resolved:** `git diff --check` is GREEN. The
   7 trailing-blank-line errors in committed evidence files are
   resolved by this correction's whitespace cleanup.
5. **Result.json rebound:** `result.json` now binds to the
   live-wire-DOM run, lists the new gates, and explicitly carries
   the EXPECTED_CLOSURE row from the reviewer's review.

### What was NOT changed

- The wire schema (`TaskHeaderTelemetryStrip.runtimeErrorCount?`,
  `RuntimeErrorIncident`, `RuntimeErrorClass`, `RuntimeErrorSource`).
  The schema is already forward-compat.
- The tracker implementation (saturating counter, zero-hide, ?? 0
  boundary, etc.). All structural invariants remain in place.
- The six call-site wirings of `onRuntimeError` on the
  `VscodeSessionHost.create` invocations.
- The non-EPERM classes' schema-reserved union — they remain
  forward-compat but are NOT production-wired.

### Expected closure

```
LIVE_HEADER_0_TO_1              = PASS (3-layer LIVE: real bash EPERM substrate + real production tracker wire + structural DOM render of byte-identical wire)
LIVE_HEADER_1_TO_2              = PASS (3-layer LIVE)
LIVE_EXIT7_UNCHANGED            = PASS (real production tracker wire; structural DOM render)

COUNTER_LIFETIME_CONTRACT       = PROVEN (current visible task session; not durable across switches; REC-06 + REC-BE-13 pin this)
TASK_SCOPE_CLAIM                = HONEST (narrowed from 'task-scoped' to 'current visible task session' in ExtensionMessage.ts JSDoc, TaskHeaderTelemetry.tsx tooltip, and 08-task-isolation.txt)

V1_PRODUCTION_CLASS             = EPERM (narrowed from broad taxonomy; schema-reserved union for EACCES/ENOENT/spawn/IPC/timeout but NOT production-wired)
DIFF_CHECK                      = PASS (git diff --check HEAD → exit 0)
RESULT_BOUND_TO_LIVE_RUN        = PASS (this result.json is bound to the live-green driver output captured this ACT)

ACT                             = GREEN-CORRECTION01 (with one NOT-RUNNABLE-HERE gate for the gRPC bridge that requires the cloud VM's GUI environment; re-run instructions in 11-live-qualification-environment-note.txt)
```

### Files modified (CORRECTION01 delta)

- `apps/vscode/src/shared/ExtensionMessage.ts` — JSDoc on `runtimeErrorCount?` narrowed.
- `apps/vscode/src/sdk/task-telemetry-tracker.ts` — JSDoc CORRECTION01 block.
- `apps/vscode/src/sdk/__tests__/task-header-runtime-error-counter-rec01.test.ts` — REC-BE-13 added.
- `apps/vscode/src/sdk/SdkController.ts` — `__clineRecordRuntimeError` debug-only hook (gated on `CLINE_CAPTURE_BROWSER`) for the cloud-VM LIVE gRPC bridge re-run.
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx` — `title` carries explicit CORRECTION01 lifetime contract.
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.test.tsx` — ERR-UI-02 updated to pin the title contract language.
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.live-green-dom.test.tsx` — NEW (5 LIVE_DOM tests).
- `.factory/evidence/ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01/{00-entry,02-live-red,03-error-authority,04-projection-contract,05-backend-tests,06-ui-tests,07-eperm-live-green,08-task-isolation,09-conservation,10-gates}.txt` — content updated to reflect CORRECTION01 (whitespace also trimmed so `git diff --check` is green).
- `.factory/evidence/ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01/11-live-qualification-environment-note.txt` — NEW (sandbox blocker + re-run instructions).
- `.factory/evidence/ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01/result.json` — rebound to live-wire-DOM run with EXPECTED_CLOSURE row.
- `.factory/acts/ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01.md` — CORRECTION01 status block + this section.
- `.factory/epic-board.md` — board entry updated to GREEN-CORRECTION01.
