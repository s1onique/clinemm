# 11 — Ablation design

## Single-variable discriminator

The ablation differs from the RED only in ONE place:

```text
RED:
  start      → callerAbort.signal attached
  handoff    → start.state === "running" returned
  abort      → callerAbort.abort()                       → job CANCELLED

GREEN (ablation):
  start      → callerAbort.signal attached
  handoff    → start.state === "running" returned
  release    → manager.releaseForegroundAbortOwnership(jobId)   ← ONLY DIFFERENCE
  abort      → callerAbort.abort()                       → job STILL RUNNING
```

Everything else (manager, supervisor, caller signal, command, wait budget,
execution deadline, abort controller, handoff boundary) is identical.

## Implementation of the release method

`apps/vscode/src/sdk/command-job-manager.ts` — new public method on the
manager:

```ts
releaseForegroundAbortOwnership(jobId: string): void {
    const job = this.active.get(jobId)
    if (!job) {
        // No active job — either never existed, already finalized, or
        // moved to the terminal map. Safe no-op in all three cases.
        return
    }
    if (job.abortListener && job.abortSignal) {
        job.abortSignal.removeEventListener("abort", job.abortListener)
        job.abortSignal = undefined
        job.abortListener = undefined
    }
}
```

Production call site at `apps/vscode/src/sdk/vscode-run-commands-tool.ts`
background path, immediately after the `terminalPromise.then(...)`
listener is attached and immediately before the RUNNING envelope is
returned:

```ts
start.terminalPromise.then(({ becameIdle }) => {
    if (becameIdle) {
        notifyBackgroundStateChange(false, undefined)
    }
})
// ACT-CLINEMM-BACKGROUND-COMMAND-PROCEED-WHILE-RUNNING-ABORT-OWNERSHIP-RELEASE01:
// The foreground->background handoff is irrevocably true at this point.
// Per the upstream `sdk/ARCHITECTURE.md §proceed-while-running` contract,
// the executor must release its abort ownership: a later caller-supplied
// abort on the same `context.signal` MUST NOT cancel the detached managed
// job. Release the listener installed by `CommandJobManager.start()` at
// command-job-manager.ts:1986-2010. The release is a no-op when no caller
// signal was attached.
manager.releaseForegroundAbortOwnership(start.jobId)
const runningPayload = { status: "running" as const, jobId: start.jobId, ... }
return JSON.stringify(runningPayload)
```

## Why this is the minimal-bounded repair

- **One method** (`releaseForegroundAbortOwnership`).
- **One call site** (the handoff boundary in `vscode-run-commands-tool.ts:709`).
- **No change** to `CommandJobManager.cancel()`, `CommandJobManager.dispose()`,
  `CommandJobManager.start()`'s listener install path
  (`command-job-manager.ts:1984-2011`), the deadline watchdog
  (`command-job-manager.ts:1956-1981`), or `finalize()` cleanup
  (`command-job-manager.ts:2516-2526`).
- **No change** to public APIs except for the new method itself.
- **No change** to the proto surface, the webview, the gRPC handlers, or
  any other SDK or extension code path.
- **No new diagnostics** added at this point; the existing BJLA capture
  continues to operate (capture-ON sees the request boundary
  identically; capture-OFF is a no-op).

## Properties preserved

1. **Idempotence**: a second `releaseForegroundAbortOwnership(jobId)` call
   on the same job is a safe no-op (the listener fields are already
   unset).
2. **No-op when no signal was attached**: if `start()` was called without
   `context.signal`, the listener fields are never set and the release
   is a structural no-op.
3. **No-op after finalize**: after the job has been moved to the
   `terminal` map (e.g. via natural completion or cancel), the lookup
   in `active` returns `undefined` and the release returns immediately.
   This is the desired behavior because the listener was already
   cleaned up in `finalize()` at line 2522-2526.
4. **No deadline-timer interaction**: the deadline watchdog at
   `command-job-manager.ts:1958-1981` is untouched. The deadline timer
   continues to fire on its own schedule and terminates the job via the
   same `terminate(job, "deadline")` path as before.
5. **No explicit-cancel interaction**: `manager.cancel({ jobId })` still
   routes through `terminate(job, "cancel")` with
   `requestOrigin = "background_cancel_rpc"`. The release does not
   affect this seam.
6. **No extension-shutdown interaction**: `manager.dispose()` still
   iterates the active map and calls `terminate(job, "cancel")` for each
   job. The release does not affect this seam.
