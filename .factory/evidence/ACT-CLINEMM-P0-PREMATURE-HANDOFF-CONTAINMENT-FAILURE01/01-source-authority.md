# 01 — Source Authority Map (PHCF01)

ENTRY_HEAD = 8b901a0c449994fa7f43ec586dcfd4091812b6e3  (branch `main`)
Repository trust: tracked dirt at entry was the PRE-EXISTING, unrelated
`ACT-CLINEMM-MYC-REAL-WORKFLOW-AUTOCAPTURE01` additive work in
`apps/vscode/src/extension.ts`, `SdkController.ts`, `dogfood-diagnostic-profile.ts`,
`hooks-adapter.ts`, `myc-prime-automation.ts`, `sdk-compaction-coordinator.ts`,
`sdk-session-lifecycle.ts`, `services/mcp/McpHub.ts` plus untracked
`myc-evaluation-*` files. It is PRESERVED and NOT part of this ACT.
Protected stash at entry: `stash@{0} WIP on main: 026a64d1b PTLL01-CORR01 ...` — untouched.

## Production ownership map (the real lifecycle)

| # | Boundary | Authoritative owner | File:line | Session/Task/Epoch | Observable postcondition | Error path |
|---|---|---|---|---|---|---|
| 1 | `CommandJobManager.start()` | CommandJobManager | `command-job-manager.ts:1935` | owner=launch session | `active.set(jobId)` | spawn failure → `finalize(job,"spawn_failed")` |
| 2 | Active-map insertion | CommandJobManager | `command-job-manager.ts:1935` | job.ownerSessionId | active map non-empty | — |
| 3 | Background `running=true` | host projection | `SdkController.ts:5395-5430` (via `updateBackgroundCommandState(true, jobId)`) | taskId=jobId | `backgroundCommandJobStates[jobId]="running"` | — |
| 4 | `agent_turn_done` / `done` w/o completion | SdkSessionEventCoordinator | `sdk-session-event-coordinator.ts:3616-3647` | session/task/epoch | phase stays `streaming`; `deferredContinuation` marker written | `outstandingAutonomousWork` true → defer |
| 5 | Supervised terminality | CommandJobManager | `command-job-manager.ts:2450` (`finalize`) | job identity | — | — |
| 6 | **Process-group postcondition probe** | CommandJobManager | `command-job-manager.ts:2532` (`this.terminalPostconditionProbe(savedPgid)`) | PGID | `gone` \| `alive` \| `eperm` \| `unknown` | `gone` → clean; else → `terminalState="containment_failed"`, `job.terminationFailed` latched (`command-job-manager.ts:2556-2570`) |
| 7 | `command_job_residual_detected` | CommandJobManager | `command-job-manager.ts:2578-2588` | jobId, pgid | residual observed | — |
| 8 | **Active-map removal** | CommandJobManager | `command-job-manager.ts:2636` (`this.active.delete(job.id)`) | jobId | active map shrinks | **RUNS ON BOTH CLEAN AND FAILURE PATHS** |
| 9 | `command_job_containment_failed` | CommandJobManager | `command-job-manager.ts:2787-2794` | jobId, pgid, containmentFailed | failure event + `reportRuntimeError({errorClass:"command_containment_failed"})` (`:2781`) | runtime-error sink → `TaskTelemetryTracker.recordRuntimeError` (⚠ N counter) |
| 10 | `terminalTransitionResolve` | CommandJobManager | `command-job-manager.ts:2809-2815` | `{becameIdle, jobId, terminalState}` | **exact terminal reason carried** | — |
| 11 | Runner terminal publication | vscode-run-commands-tool | `vscode-run-commands-tool.ts:1754-1755` | jobId, terminalState | `onBackgroundStateChange(false, jobId, terminalState)` | — |
| 12 | Host projection recompute | SdkController | `SdkController.ts:5326-5489` (`updateBackgroundCommandState`) | per-job map | `anyRunning` derived from map; `>0->0` flip | terminal monotonicity guard (`:5420-5429`) |
| 13 | **Bridge to coordinator** | SdkController | `SdkController.ts:5531-5549` (`maybeReevaluateDeferredContinuation`) | previousRunning/running/taskId | **THE TERMINAL REASON IS DROPPED HERE** | — |
| 14 | **Deferred-handoff decision** | SdkSessionEventCoordinator | `sdk-session-event-coordinator.ts:873-1002` (`reevaluateDeferredContinuation`) | marker{sessionId,taskId,epoch} | `awaiting_followup` commit | — |
| 15 | Canonical phase writer | TurnStateTracker | `sdk-session-event-coordinator.ts:1002` | writer `session-event-turn-complete-resumable-straggler-preserve` | phase commit (exactly once) | — |
| 16 | Webview publication | SdkController | `SdkController.ts:5505` (`postStateToWebview`) | stateVersion | published phase | — |

## THE DEFECT (narrowest seam)

Boundary 13 → 14. `maybeReevaluateDeferredContinuation` forwards only
`(previousRunning, running, taskId)`. The exact terminal reason
(`containment_failed`) IS available at boundary 11/12 but is NOT forwarded.
Boundary 14 therefore decides using ONLY
`hasRunningBackgroundJobForOwner(sessionId)` — an ACTIVE-MAP CARDINALITY
question (boundary 8) — which CANNOT distinguish:

    MANAGED_JOB_REMOVED   !=   PROCESS_CONTAINMENT_VERIFIED

The `CommandJobManager` removes the job from the active map on BOTH the clean
path AND the containment-failure path, so an empty active map proves nothing
about the OS process group.

## Precedent for the correct contract (already in production)

`background-notify-coordinator.ts:3440` / `:3474-3481` — the existing
production policy for a failed containment is explicit:

    containment_failed -> containment_no_wake

A failed containment MUST NOT release autonomous work. The deferred
user handoff is such a release, so the SAME contract applies to boundary 14.

## Existing error authority (no duplicate introduced)

- `command_containment_failed` runtime-error incident → `TaskTelemetryTracker.recordRuntimeError` → `TaskHeaderTelemetryStrip.runtimeErrorCount` (the ⚠ N counter). `command-job-manager.ts:2779-2786`.
- `backgroundCommandJobStates[jobId] = "containment_failed"` → already published to the webview (`src/shared/ExtensionMessage.ts:497`) and already rendered by `ChatRow.tsx:280-289` as the exact pill reason.

## Narrowest repair seam

Boundary 14 (the deferred-handoff decision), fed by the EXISTING per-job
terminal projection the host already owns (`Controller.backgroundCommandJobStates`).
No new state, no new protocol field, no new phase.
