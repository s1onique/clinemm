# ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01

**Status:** GREEN — 2026-09-17
**Subject head:** post-MPWC02 production (no later production-source edits).

## Goal

Add a task-scoped `⚠ N` runtime-error counter to the TaskHeader that
displays structured ClineMM runtime incidents (EPERM, EACCES, ENOENT,
spawn failure, etc.) for the current task.

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
