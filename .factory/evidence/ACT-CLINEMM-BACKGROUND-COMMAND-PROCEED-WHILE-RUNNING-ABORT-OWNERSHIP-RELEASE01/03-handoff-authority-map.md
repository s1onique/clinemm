# 03 — Handoff authority map (the REAL production seam)

Source files inspected:
- `apps/vscode/src/sdk/vscode-run-commands-tool.ts` (the production `run_commands` tool, foreground + background paths)
- `apps/vscode/src/sdk/command-job-manager.ts` (the production CommandJobManager, where the caller AbortSignal listener is installed and where it is cleaned up)
- `apps/vscode/src/sdk/sdk-foreground-command-coordinator.ts` (separate; only relevant for `vscodeTerminal` foreground mode — NOT used by `backgroundExec`)

## A. CommandJobManager.start() — where context.signal listener is attached

`apps/vscode/src/sdk/command-job-manager.ts:1983-2012`:

```ts
// Honor caller-supplied AbortSignal as a cancel, not a deadline.
if (context?.signal) {
    job.abortSignal = context.signal
    job.abortListener = () => {
        if (job.finalized || job.state !== "running") return
        captureBackgroundJobLivenessAuthorityRecord({
            event: "job_cancellation_requested",
            ...
            requestOrigin: "caller_abort_signal",
            ...
        })
        void this.terminate(job, "cancel")
    }
    if (context.signal.aborted) {
        job.abortListener()
    } else {
        context.signal.addEventListener("abort", job.abortListener, { once: true })
    }
## D. timeout ownership

`apps/vscode/src/sdk/command-job-manager.ts:1956-1981`:

```ts
// Deadline watchdog — the only timer allowed to call killTree.
// Tracked on the job so finalize() can clear it.
job.deadlineTimer = setTimeout(() => {
    if (job.finalized || job.state !== "running") return
    captureBackgroundJobLivenessAuthorityRecord({ ... requestOrigin: "command_deadline" ... })
    void this.terminate(job, "deadline")
}, effectiveDeadlineMs)
job.deadlineTimer.unref()
```

The deadline watchdog is installed at `start()` and remains armed for the full job lifetime. It is cleared ONLY in `finalize()` (line 2518-2521):

```ts
if (job.deadlineTimer) {
    clearTimeout(job.deadlineTimer)
    job.deadlineTimer = undefined
}
```

**CURRENT_CLINEMM_BACKGROUND_DEADLINE_CONTRACT = `DEFERRED`** — upstream architecture (§proceed-while-running of `sdk/ARCHITECTURE.md`) requires the executor to release timeout ownership too, but THIS ACT's hypothesis is only about AbortSignal ownership. The deadline timer ownership is unchanged unless RED→GREEN specifically reveals it is also load-bearing. (It is not — the LIVE specimen's `job_active_removed.reason` was `"cancel"`, not `"deadline"`, and the deadline timer would still need to clear naturally at completion regardless.)

## E. natural terminal cleanup

`apps/vscode/src/sdk/command-job-manager.ts:2516-2526` (inside `finalize()`):

```ts
// INVARIANT (timer hygiene): clear any leftover watchdog / abort
// listener so high command volume doesn't accumulate timers.
if (job.deadlineTimer) {
    clearTimeout(job.deadlineTimer)
    job.deadlineTimer = undefined
}
if (job.abortListener && job.abortSignal) {
    job.abortSignal.removeEventListener("abort", job.abortListener)
    job.abortSignal = undefined
    job.abortListener = undefined
}
```

The abort listener is removed WHEN THE JOB FINALIZES (terminal). It is NOT removed at the handoff boundary. This is the bounded defect.

## F. explicit cancel

`apps/vscode/src/sdk/vscode-session-host.ts:494-512`:
- `cancelBackgroundCommand(jobId)` → `commandJobManager.cancel({ jobId })` → `manager.terminate(job, "cancel")` with `requestOrigin = "background_cancel_rpc"`.

This seam is independent of the caller AbortSignal listener. It targets by jobId and remains operational regardless of listener state.

## G. extension shutdown

`apps/vscode/src/sdk/command-job-manager.ts:3031-3116`:
- `manager.dispose()` iterates activeIds and calls `this.terminate(job, "cancel")` for each.
- Only invoked via `VscodeSessionHost.dispose()` → `SdkSessionLifecycle.dispose()` → `SdkController.dispose()` at extension deactivation.

This seam is also independent of the caller AbortSignal listener.

## H. The handoff boundary (decision)

There is NO existing internal "release / detach / proceed / background" seam. The minimal point where "foreground tool returns RUNNING" becomes irrevocably true is the line `return JSON.stringify(runningPayload)` at `vscode-run-commands-tool.ts:709` — but the tool function's return is the LAST thing that happens at the call site. The architecturally clean point to release the abort listener is INSIDE `manager.start()`'s caller (the `vscode-run-commands-tool` background path), immediately AFTER `manager.start()` returns and the RUNNING case is detected, and BEFORE the JSON is returned.

**Equivalently**: we can add a method to `CommandJob` (e.g. `releaseForegroundOwnership()`) that the `vscode-run-commands-tool` background path calls at the handoff. The minimal API surface is a single method on the job record (or the manager itself).

## I. Summary — the bounded defect

```text
caller context.signal attached during start
  (command-job-manager.ts:2010)
  ↓
job enters managed active map
  (state = "running")
  ↓
foreground tool performs Proceed While Running handoff
  (vscode-run-commands-tool.ts:674-709, returns RUNNING)
  ↓
foreground tool returns RUNNING
  ↓
original AbortSignal listener remains attached
  (no release seam exists)
  ↓
later caller signal aborts
  ↓
listener fires (command-job-manager.ts:1986)
  ↓
manager.terminate(job, "cancel") with origin = "caller_abort_signal"
  (command-job-manager.ts:2005)
  ↓
detached job CANCELLED  ← THIS IS THE DEFECT
```

This matches the LIVE causal chain proven by the predecessor ACT.

}
```

**Identity storage**: the listener is stored on `job.abortListener` (and the signal on `job.abortSignal`). The listener is registered with `{ once: true }`, but the registration has no abort path — once attached, the listener persists until either (i) the signal aborts and the listener fires (cancels the job) or (ii) the job finalizes and the listener is removed in `finalize()`.

## B. VscodeRunCommands backgroundExec — the production foreground→background handoff

`apps/vscode/src/sdk/vscode-run-commands-tool.ts:592-709` (key lines):

```ts
if (executionMode === "backgroundExec") {
    const manager = options.commandJobManager
    // ...
    let start: Awaited<ReturnType<typeof manager.start>> | undefined
    try {
        start = await manager.start(
            { command, cwd: commandCwd || cwd, shell, env: { SHELL: shell }, waitBudgetMs, executionDeadlineMs, maxOutputChars: MAX_RESPONSE_OUTPUT_CHARS },
            context,  // <-- context.signal is threaded through here
        )
        // ...
        if (start.state === "running") {
            start.terminalPromise.then(({ becameIdle }) => { ... })
            const runningPayload = { status: "running" as const, jobId: start.jobId, elapsedMs: start.elapsedMs, deadlineRemainingMs: start.deadlineRemainingMs, outputTruncated: start.outputTruncated, stdout: start.stdout }
            return JSON.stringify(runningPayload)  // <-- the foreground tool returns RUNNING
        }
        // ...
    }
}
```

**The handoff is `start.state === "running"` → `return JSON.stringify(runningPayload)` (line 709).**

At that moment:
- The job is in `manager.active` with `state = "running"`.
- The deadline watchdog (`job.deadlineTimer`) is armed and ticking.
- The caller-supplied `context.signal` listener (`job.abortListener`) is attached and will fire on abort.
- The tool call resolves back to the model with `{ status: "running", jobId, ... }`.
- **The caller-supplied AbortSignal listener remains attached for the full job lifetime.**

There is NO code path at the handoff that releases the caller's abort ownership.

## C. Existing detach representation

There is NO existing internal "released / detached / proceeded / backgrounded" flag on `CommandJob`. The handoff is purely a return value (the JSON payload above). The job remains in `manager.active` indefinitely until natural completion, deadline, or cancellation.

**Implication**: there is no existing internal seam to call for a release operation. Any release operation must be a NEW seam.
