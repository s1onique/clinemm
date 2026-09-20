# 03 — Cancellation authority map

Inventory of every production caller capable of initiating termination for a
managed `CommandJob` in the current code base (HEAD = `bab253afb`).

The single sink for cancellation is `CommandJobManager.terminate(job, reason)`
(`apps/vscode/src/sdk/command-job-manager.ts:2083`), invoked indirectly
through `CommandJobManager.cancel(options)` (`command-job-manager.ts:2713`).
The first writer wins (latched via `job.terminationPromise`), and the public
`cancel()` is the only host-facing public cancel seam.

| # | Caller site | Chain | Reason | Classification | File:line |
|---|-------------|-------|--------|----------------|-----------|
| A | Explicit UI Cancel button → `cline.cancelBackgroundCommand` gRPC | webview click → `MessageRenderer.tsx:112` (background-cancel RPC, NOT task-cancel) → `useMessageHandlers.ts:573` → gRPC `TaskService.cancelBackgroundCommand` → `cancelBackgroundCommand.ts` (proto handler) → `Controller.cancelBackgroundCommand` → `SdkController.cancelBackgroundCommand` (`SdkController.ts:3250`) → `VscodeSessionHost.cancelBackgroundCommand` (`vscode-session-host.ts:494`) → `commandJobManager.cancel({jobId})` (`vscode-session-host.ts:506`) → `manager.terminate(job, "cancel")` | `cancel` | REAL_PRODUCTION_SEAM | `vscode-session-host.ts:506` → `command-job-manager.ts:2083` |
| B | Task/session cancel-button (ChatView Cancel button) | `MessageRenderer.tsx:112` (task-cancel button NOT background) → `useMessageHandlers.ts:573` cancel button routes to `taskControl.cancelTask()` (NOT background) → `SdkTaskControlCoordinator.cancelTask` (`sdk-task-control-coordinator.ts:76`) → `sdkHost.abort(sessionId)` → `SessionRuntime` stop (does NOT directly call `commandJobManager.cancel`) → DOES NOT cancel background jobs at this seam | n/a — does NOT touch `CommandJobManager` | STRUCTURAL (not a CommandJob cancel seam) | `sdk-task-control-coordinator.ts:95` |
| C | Command deadline timer | `setTimeout` watchdog installed in `CommandJobManager.start()` (`command-job-manager.ts:1936`) → `void this.terminate(job, "deadline")` | `deadline` | REAL_PRODUCTION_SEAM | `command-job-manager.ts:1938` |
| D | Caller AbortSignal | `context.signal` listener installed in `CommandJobManager.start()` (`command-job-manager.ts:1943-1953`) → `void this.terminate(job, "cancel")` | `cancel` | REAL_PRODUCTION_SEAM | `command-job-manager.ts:1947` |
| E | `CommandJobManager.dispose()` | `CommandJobManager.dispose()` (`command-job-manager.ts:3031`) iterates `activeIds` and calls `await this.terminate(job, "cancel")` for each → ONLY invoked via `VscodeSessionHost.dispose(reason)` (`vscode-session-host.ts:590-599`) → that itself is only invoked from `SdkSessionLifecycle.dispose()` (`sdk-session-lifecycle.ts:493-502`) → that itself is only invoked from `SdkController.dispose()` (`SdkController.ts:2294`) at extension deactivation | `cancel` | REAL_PRODUCTION_SEAM | `command-job-manager.ts:3050` |
| F | Extension shutdown/reload | `SdkController.dispose()` → `SdkSessionLifecycle.dispose()` → `sharedHost.dispose()` → `VscodeSessionHost.dispose()` → `commandJobManager.dispose()` → `terminate(job, "cancel")` for every active job | `cancel` (reason is `SdkSessionLifecycle.dispose`) | REAL_PRODUCTION_SEAM | `sdk-session-lifecycle.ts:493-502` |
| G | Host/session disposal | NO direct session-level disposal of `CommandJobManager` during normal session transitions — `trackSessionStop` calls `sdkHost.stop(sessionId)` (`sdk-session-lifecycle.ts:550`) which delegates to `VscodeSessionHost.stop` → `this.inner.stop(sessionId)` (`vscode-session-host.ts:439`). `VscodeSessionHost.stop` does NOT call `commandJobManager.dispose()` or `cancel` — it only stops the session via the wrapped `inner`. Background jobs survive session transitions. | n/a | STRUCTURAL (not a CommandJob cancel seam) | `vscode-session-host.ts:438-440` |
| H | `clearTask` / `endActiveSession` | `SdkTaskControlCoordinator.clearTask` → `sessions.endActiveSession("clearTask")` (`sdk-task-control-coordinator.ts:151`) → only stops the session, not the host, so background CommandJobs are preserved | n/a | STRUCTURAL | `sdk-task-control-coordinator.ts:151` |
| I | Session abort | `sdkHost.abort(sessionId)` → `SessionRuntime` abort. Does NOT cancel CommandJobs at the host seam. | n/a | STRUCTURAL | `sdk-task-control-coordinator.ts:95` |
| J | Tool/run cleanup | The `vscode-run-commands-tool` foreground coordinator calls `commandJobManager.cancel({jobId})` only on `cancelPendingSave()` / wait-budget timeout paths — but those are tied to the foreground wait budget, not the managed background path. **No INFERRED** cleanup-triggered cancellation of a registered background CommandJob was found in the production seam. | `cancel` if it ever fires for a detached background job | STRUCTURAL (production confirmation needed) | `vscode-run-commands-tool.ts` |
| K | Session replacement (`startNewSession`) | `startNewSession` → `endActiveSession("startNewSession")` (`sdk-session-lifecycle.ts:309`) → only stops the previous session, NOT the host. The shared host (and its CommandJobManager) survives replacement. | n/a | STRUCTURAL | `sdk-session-lifecycle.ts:309` |

## Discovered production cancellation seams (REAL_PRODUCTION_SEAM)

```text
A. BackgroundCancelRpc → manager.cancel(origin="background_cancel_rpc") → terminate(reason="cancel")
C. CommandDeadline     → manager.terminate(reason="deadline")
D. CallerAbortSignal   → manager.terminate(reason="cancel", origin="caller_abort_signal")
E. ManagerDispose      → manager.dispose → terminate(reason="cancel", origin="extension_shutdown")
F. ExtensionShutdown   → manager.dispose (via host.dispose via lifecycle.dispose)
```

## Negative space (STRUCTURAL — does NOT cancel background jobs)

```text
B. TaskCancelButton    → sdkHost.abort(sessionId)  [no CommandJob touch]
G. SessionStop         → sdkHost.stop(sessionId)   [no CommandJob touch]
H. clearTask           → endActiveSession           [no host.dispose]
I. SessionAbort        → sdkHost.abort(sessionId)  [no CommandJob touch]
J. ToolCleanup         → wait-budget / save-cancel [no CommandJob touch]
K. SessionReplacement  → endActiveSession          [no host.dispose]
```

## Real REQUESTER candidates for a cancellation with reason="cancel"

Only three real production callers of `manager.terminate(reason="cancel")`
exist (paths A, D, E+F). The CP candidates map onto these as:

```text
CP1 BackgroundCancelRpc — public cancelBackgroundCommand gRPC path (A);
                          a non-operator programmatic caller hitting the
                          same seam would also label here (e.g. the
                          automatic "old command vs. new command pending"
                          cleanup path discussed in cline/cline#8251).
CP2 HostOrSessionDispose — manager.dispose path (E+F) — extension shutdown OR host disposal
CP3 SessionAbortPropagation — D (caller AbortSignal) — NOT a session abort but a
                            user-supplied AbortSignal. The current production
                            seam has no documented propagation of session abort
                            into background CommandJob cancel; if such a path
                            exists it must be the caller's signal.
CP5 ToolCleanup        — NO production caller found in the recon that cancels a
                       registered background CommandJob on tool cleanup.
CP6 ExtensionRuntimeTeardown — same as CP2 (the only dispose caller is the
                              controller-shutdown path).
```

CP4 (command deadline) is a distinct reason (`deadline`, not `cancel`) so it
is recorded separately but cannot explain the LIVE evidence (the LIVE
`job_active_removed.reason` is `cancel`, not `deadline`).

## Authoritative classification before LIVE

```text
LIVE_REQUESTER_UNKNOWN_AT_ENTRY = true
FIRST_PRODUCTION_SEAM           = BackgroundCancelRpc OR CallerAbortSignal OR HostDispose
CARDINALITY                     = exactly ONE primary REQUESTER per LIVE cycle
```
