# Authority Map — Background Job Liveness Authority Split

> Reconnaissance for `ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01`.
> Maps every production seam that can create, observe, or dispose a
> `CommandJob` so the diagnostic can be wired without architectural drift.

---

## A. CommandJob creation

| Site | File | Notes |
|------|------|-------|
| `manager.start(...)` — single authority for inserting into `this.active` | `apps/vscode/src/sdk/command-job-manager.ts:1791-1792` | `const wasBecomingActive = this.active.size === 0; this.active.set(id, job)`; emits `command_job_process_started` after insertion |
| `manager.start(...)` is called from | `apps/vscode/src/sdk/vscode-run-commands-tool.ts:632-646` (the production `run_commands` backgroundExec branch) | `start = await manager.start({...}, context)` |
| `commandJobManager` instance | `apps/vscode/src/sdk/vscode-session-host.ts:218` (constructed per `VscodeSessionHost.create`) | `const commandJobManager = new CommandJobManager({...})` |

**Insertion invariant**: a job enters `this.active` at exactly ONE point
(`command-job-manager.ts:1792`). The cardinality transition is latched at
the same synchronous seam (`wasBecomingActive`). The active map is the
ONLY authority for "currently supervised by THIS manager".

---

## B. State / status reads by jobId

| Site | File | Notes |
|------|------|-------|
| `manager.status(options)` — public observer | `apps/vscode/src/sdk/command-job-manager.ts:2548-2580` | Single seam. Reads via `this.lookup(jobId)` → `this.active.get ?? this.terminal.get`. If found in `active` and state==`running` and `waitMs>0`, races against `exitTransitions` |
| `command_status` tool | `apps/vscode/src/sdk/command-status-tool.ts:128-156` (`createCommandStatusTool`) | `const status = await manager.status({...})`. Returns `unknown_job` when `lookup` misses |
| `cancel_command` tool | `apps/vscode/src/sdk/command-status-tool.ts:166-211` (`createCancelCommandTool`) | Same `manager.status` for post-cancel observation; calls `manager.cancel` for the mutation |
| `run_commands` RUNNING path | `apps/vscode/src/sdk/vscode-run-commands-tool.ts:658-693` | After `manager.start` returns `running`, the tool emits a structured `RUNNING` payload with `jobId`/`status:"running"`. This is the source of the model-visible `"status":"running"` |
| `lookup` (private) | `apps/vscode/src/sdk/command-job-manager.ts:2636-2638` | The single lookup site used by both `status()` and `cancel()` — checks BOTH maps |

**Status source split risk surface**: any path that constructs a status
text from a job id without going through `manager.status` is a candidate
for **CASE_LA4_STATUS_AUTHORITY_SPLIT**. Today, every production
status-emission site in the read-model uses `manager.status` or a
`snapshot(projectResponseSnapshot(...))` projection built on top of the
manager. The single source of truth is the `lookup(jobId)` call.

---

## C. Cancellation

| Site | File | Notes |
|------|------|-------|
| `manager.cancel(options)` | `apps/vscode/src/sdk/command-job-manager.ts:2596-2634` | Public cancel; emits `command_job_terminal_requested` then awaits `this.terminate(job, "cancel")` |
| `cancel_command` tool | `apps/vscode/src/sdk/command-status-tool.ts:166-211` | Calls `manager.cancel` |
| `VscodeSessionHost.cancelBackgroundCommand` | `apps/vscode/src/sdk/SdkController.ts:3239-3260` (handler); delegated to `host.cancelBackgroundCommand` on the active `sdkHost` | gRPC `cancelBackgroundCommand` RPC handler — the production Cancel button path |
| `VscodeSessionHost.cancelBackgroundCommand` impl | `apps/vscode/src/sdk/vscode-session-host.ts:475-499` (around line 482-485) | Reads `targetIds` (the jobId arg), iterates over `this.commandJobManager.getActiveJobIds()` and calls `manager.cancel({jobId: targetId})` for the matching id |
| `manager.getActiveJobIds()` | `apps/vscode/src/sdk/command-job-manager.ts:2655-2657` | The single enumeration used by `cancelBackgroundCommand` |

**Cancel-by-jobId invariant**: the Cancel button calls
`manager.cancel({jobId})` which calls `this.lookup(jobId)`. If the
authoritative manager for the active session host does NOT contain the
jobId, the cancel returns `unknown_job`. This is the LA1/LA2/LA3/LA4
discriminator the diagnostic must correlate with the active-set state.

---

## D. Finalization / active-map removal

| Site | File | Notes |
|------|------|-------|
| `manager.finalize(job, state, detail)` | `apps/vscode/src/sdk/command-job-manager.ts:2223-2546` | The single terminal-classification seam. Captures the postcondition probe, latches `terminalState`, then deletes from `this.active` at `command-job-manager.ts:2409` |
| `manager.terminate(job, reason)` | `apps/vscode/src/sdk/command-job-manager.ts:2006-2221` (around line 2126 onward) | The private helper that awaits `killTree`/helper-owned termination before triggering `finalize` |
| `manager.dispose()` | `apps/vscode/src/sdk/command-job-manager.ts:2897-2935` | Terminates every active job, clears both maps. Called by `VscodeSessionHost.dispose` |
| `VscodeSessionHost.dispose` | `apps/vscode/src/sdk/vscode-session-host.ts:555-564` | `await this.commandJobManager.dispose(); return this.inner.dispose(reason)` |

**Removal invariant**: `this.active.delete(job.id)` happens inside
`finalize()` and is preceded by a synchronous PGID postcondition probe
(the bounded invariant verdict). Any code path that removes an entry
WITHOUT going through `finalize` is a candidate for **CASE_LA1_PREMATURE_FINALIZATION**.
Today, the only removal sites are:

1. `finalize()` (the legitimate terminal path; postcondition probe gated)
2. `dispose()` (host teardown — terminates then clears)
3. `this.active.clear()` inside `dispose()`

No production code path removes an entry from `active` ad hoc. The
BOCOR capture at Q5 records `activeJobs = []`; if the underlying job's
PGID is still on the OS, the cause is **NOT** a premature removal in
this file (the manager's own seam) — it must be either:
   - LA2: the Q5 manager instance differs from the start manager
   - LA5: a host/session replacement orphaned the start authority

---

## E. Lifecycle publication

| Site | File | Notes |
|------|------|-------|
| `manager.emitCommandJobLifecycle(event)` | `apps/vscode/src/sdk/command-job-manager.ts:1236+` (private emitter; consults `this.onCommandJobLifecycle` sink) | The single fan-out point for the eight lifecycle events |
| `onCommandJobLifecycle` sink | wired by `VscodeSessionHost.create` at `vscode-session-host.ts:263` from `options.onCommandJobLifecycle` → `SdkController.handleCommandJobLifecycle` | The host's authoritative projection updater (telemetry + webview) |
| `SdkController.handleCommandJobLifecycle` | `apps/vscode/src/sdk/SdkController.ts:4264+` (around line 4264) | Forwards each lifecycle event into the telemetry tracker + (when present) the webview reducer |
| `backgroundCommandRunning` projection | derived from `becameActive` / `becameIdle` flags on the run_commands tool's `start` result (see `vscode-run-commands-tool.ts:667-684`); NOT a direct lifecycle consumer | The model-visible / UI-visible projection is built from the runner's `notifyBackgroundStateChange(running, jobId)` callback — the runner is the sole writer |
| `backgroundCommandTaskId` projection | same runner-side projection; cleared via `notifyBackgroundStateChange(false, undefined)` when `becameIdle` is true | The Cancel button visibility is gated on this projection |

**Projection invariant**: the background-state callback fires
exactly twice per managed job — once on start (`becameActive === true`)
and once on the >0→0 terminal transition (`becameIdle === true`). The
LA3 hypothesis (stale projection) requires proving the runner's
`becameIdle` flag was NOT set despite the manager legitimately
removing the job — i.e. either `finalize()` ran but the `.then()` never
fired, or the runner dropped the listener.

---

## F. Manager construction and ownership

| Site | File | Notes |
|------|------|-------|
| `new CommandJobManager({...})` | `apps/vscode/src/sdk/vscode-session-host.ts:218` (inside `VscodeSessionHost.create`) | The single `CommandJobManager` constructor call site in production code. Each `VscodeSessionHost` owns EXACTLY ONE manager instance |
| `VscodeSessionHost.create` callers (production) | `apps/vscode/src/sdk/SdkController.ts` — multiple call sites: `1592` (followups), `1748` (task-control), `1785` (compaction), `2158` (remote-config refresh), `3485` (temp-host), `3745` (temp-host); ALL go through `createTempSessionHost` closures | **CRITICAL**: every call site creates a NEW `VscodeSessionHost` and therefore a NEW `CommandJobManager`. The "primary session" host is the one wired into `activeSession.sdkHost`; the others are temp hosts for transient operations |
| `VscodeSessionHost.dispose` | `apps/vscode/src/sdk/vscode-session-host.ts:555-564` | Disposes the manager. Called when the host is replaced |
| Active session host source | `apps/vscode/src/sdk/SdkController.ts:1903-1918` (the `hasRunningBackgroundJobForOwner`/`getActiveJobOwnershipSnapshot` adapters delegate to `activeSession.sdkHost` cast to `VscodeSessionHost`) | The Q5 guard's manager-instance IS the active session host's manager |

**Manager-instance split risk surface**: every `createTempSessionHost`
closure produces a fresh manager. If the active session host is
replaced mid-flight (e.g. session rebuild, mode switch, tool-set
rebuild), a fresh manager is installed. The OLD manager may still own
the job (no transfer logic exists today) — the new manager's `active`
map is empty. This is the **CASE_LA2 / CASE_LA5** discriminator.

The current code (per `vscode-session-host.ts:190-194`) intentionally
*reuses* the manager across session rebuilds to avoid this exact case —
but that reuse contract is honored only within a single `VscodeSessionHost`
instance lifetime; it does NOT survive a `dispose()` / replacement.

---

## G. Status fallback

| Site | File | Notes |
|------|------|-------|
| `manager.status` (active+terminal lookup) | `apps/vscode/src/sdk/command-job-manager.ts:2548-2580` | Sole status path in production. `lookup` consults BOTH `active` and `terminal`. There is NO separate process-probe fallback (the manager owns the process and trusts the `exitTransition` race) |
| `manager.snapshot` projection | `apps/vscode/src/sdk/command-job-manager.ts:1080-1240` (around `snapshot`, `projectResponseSnapshot`) | Builds the model-visible payload. `state` is taken directly from `job.state` which is set inside `finalize()` |
| `manager.activeCount` / `getActiveJobIds` / `probeOwnedGroups` | `apps/vscode/src/sdk/command-job-manager.ts:2640-2891` | Read-only diagnostics on the active set |
| `VscodeSessionHost.getActiveJobOwnershipSnapshot` | `apps/vscode/src/sdk/vscode-session-host.ts:547-553` | Internal-only accessor (host-side). Used by the BOCOR capture seam |

**Single-source invariant**: every production status emission flows
through `manager.status` → `snapshot` → `projectResponseSnapshot`. There
is no parallel status authority. The LA4 hypothesis (status authority
split) is therefore only achievable if:
   - the Q5 manager differs from the status manager (which routes
     through the SAME `manager.status`), OR
   - the `state` field is being projected out-of-band (e.g. an
     extension webview reducer that tracks `backgroundCommandRunning`
     and `backgroundCommandTaskId` independently of `manager.status`).

The webview projection is precisely the surface that the LA3
hypothesis targets.

---

## Cross-references for the diagnostic

- **manager construction identity** → assign at `vscode-session-host.ts:218` (the only `new CommandJobManager`)
- **host construction identity** → assign at `vscode-session-host.ts:199-208` constructor
- **job_active_inserted** → record immediately after `this.active.set(id, job)` at `command-job-manager.ts:1792`
- **job_finalize_begin** → record at `command-job-manager.ts:2228` (entry of `finalize`, BEFORE state assignment)
- **job_active_removed** → record at `command-job-manager.ts:2409` (`this.active.delete(job.id)`)
- **job_status_lookup** → record at `command-job-manager.ts:2548-2554` (start of `status`)
- **job_cancel_lookup** → record at `command-job-manager.ts:2596-2602` (start of `cancel`)
- **manager_dispose_begin** / **manager_dispose_end** → record at `command-job-manager.ts:2897` and `command-job-manager.ts:2928-2929`
- **guard_snapshot** → already covered by BOCOR (add `managerInstance`/`hostInstance` to the BOCOR record only)

These are the load-bearing seams; the diagnostic captures these and
ONLY these. No stdout-chunk / polling-tick capture.
