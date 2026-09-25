# 02 - Recon of Production Seams

## Goal

Identify the exact seams where terminal-completion authority for a
notify-owned background job is created, observed, and discarded; then
characterize the live race between the originating turn's synchronous
poll (Path B via `command_status`) and the wake listener (Path A via
`BackgroundNotifyCoordinator.consumeTerminal`).

## The two competing paths (already partially discriminated in TQCB01)

| Path | Source                                                            | Triggering seam                                                     | Effect on marker | Effect on queue                       |
|------|-------------------------------------------------------------------|---------------------------------------------------------------------|------------------|---------------------------------------|
| A    | `start.terminalPromise.then(...)` listener in run_commands tool   | `vscode-run-commands-tool.ts:808`                                  | drain + enqueue  | enqueue wake via sdkHost.send         |
| B    | `command_status(jobId, waitMs>0)`                                 | `command-status-tool.ts:192`                                       | drain            | discardQueuedWake (fire-and-forget)   |

The marker layer is first-writer-wins. The wake layer was supposed to be
discarded via `discardQueuedWake` when Path B wins. The live defect
shows this does NOT work in production.

## Production seam inventory

| seam                                        | jobId available | notify ownership available | current turn identity available | terminal state available | mutates authority? | source                                                   |
|---------------------------------------------|-----------------|----------------------------|---------------------------------|--------------------------|--------------------|----------------------------------------------------------|
| run_commands start                          | YES             | YES (created)              | YES (resolveActiveOwner)        | NO                       | YES                | vscode-run-commands-tool.ts:755-816                      |
| marker registration (Path A arm)            | YES             | YES                        | YES                             | NO                       | YES                | vscode-run-commands-tool.ts:786-810                      |
| command_status request                      | YES (input)     | NO (no coordinator lookup) | NO                              | NO                       | NO                 | command-status-tool.ts:140                               |
| command_status wait                         | YES (input)     | NO                         | NO                              | YES (after wait)         | NO                 | command-job-manager.ts:2828 (Promise.race on exitTrans) |
| command_status terminal return              | YES (input)     | YES (via options lookup)   | YES (via resolveActiveOwner)    | YES                      | YES (Path B)       | command-status-tool.ts:184-204                           |
| terminal_committed (finalize)               | YES             | YES                        | (job-owned)                     | YES                      | YES (Path A)       | command-job-manager.ts:2415                              |
| notify consume (Path A)                     | YES             | YES                        | YES                             | YES                      | YES                | vscode-run-commands-tool.ts:836                          |
| wake creation (enqueueTerminalWake)         | YES (jobId)     | YES                        | YES                             | YES                      | YES                | SdkController.ts:738 (sdkHost.send)                      |
| pending enqueue (PendingPromptsController)  | YES             | YES                        | (queue owner)                   | YES                      | NO                 | LocalRuntimeHost.runTurn                                 |
| pending drain (shiftNext)                   | YES             | YES                        | (queue owner)                   | YES                      | YES (runTurn)      | PendingPromptService.shiftNext                           |
| submit_and_exit executor                    | NO (tool-level) | NO                         | NO                              | NO                       | YES (completesRun) | submit_and_exit tool / lifecycle                         |
| task_completion commit                      | NO              | NO                         | YES (turn-owned)                | NO                       | YES (terminal)     | sdk-session-event-coordinator.ts:660 (C10)               |

## Earliest safe authority boundary

`BackgroundNotifyCoordinator.registerMarker({jobId, sessionId, taskId})`
in `vscode-run-commands-tool.ts:786` — at this seam, the framework
knows (jobId, sessionId, taskId, notify-owned) and has registered an
explicit obligation.

## The race that breaks dual-delivery arbitration in production

### Sequence (proven from live transcript + recon)

1. `run_commands(notifyOnCompletion=true)` registers a marker and
   attaches the listener.
2. `command_status(J, waitMs=30000)` is invoked by the originating
   turn. `manager.status()` is awaiting `exitTransitions.get(J)`.
3. Process exits. `childProcess.exit` resolves.
4. Inside the `.then` handler at command-job-manager.ts:1971:
   `finalize()` runs.
5. Inside `finalize()` (line 2750):
   `job.terminalTransitionResolve({becameIdle, jobId, terminalState})`
   resolves the deferred. Microtask queued: listener .then chain.
6. The `.then` handler returns. `childProcess.exit` promise settles.
   Microtask queued: `command_status`'s `await` continuation.
7. Microtask queue drains:
   - listener runs: `await manager.status({J, waitMs:0})` returns
     immediately with `state="exited"`. Then `consumeTerminal(...)`
     fires. Inside consumeTerminal (coordinator line 535): the marker
     is drained, the wake is enqueued via
     `options.enqueueTerminalWake({...})` →
     `SdkController.ts:738` `void active.sdkHost.send(...).catch(...)`.
     The `void` and `.catch` mean the sdkHost.send is FIRE-AND-FORGET.
   - command_status continues: `snap.state !== "running"` →
     `resolveObligation(...)` drains (no-op, marker gone) → fires
     `discardQueuedWake(...)` → `discardQueuedWakeForJobId` →
     `discardQueuedWakeForJobIdOnHost(...)`. That function calls
     `host.pendingPrompts("list", { sessionId })` (awaited), then
     `host.pendingPrompts("delete", { sessionId, promptId })` **NOT
     awaited**. It returns `{ kind: "discarded" }` or
     `{ kind: "not_found" }`.

### Where it breaks

`sdkHost.send` is fire-and-forget. The wake has NOT yet landed in
`pendingPrompts` when `command_status`'s `pendingPrompts.list` runs.
Either:

- (a) The wake has not been queued yet → `list` returns `[]` →
  `not_found`. Wake later lands, fires runTurn, second completion.
- (b) The wake has just been queued → `list` finds it → `delete`
  fires (not awaited). Wake may or may not be removed before the
  next `runTurn` starts.

Both branches can produce two submit_and_exit completions.

## Why "synchronous discard" is the only safe repair

The discard must happen BEFORE `sdkHost.send` can start a runTurn.
The only synchronous authority boundary is at the coordinator seam
(inside `consumeTerminal`). The discard cannot happen there
because at the moment of `consumeTerminal` the marker is being
drained for the FIRST time — Path B has not run yet.

Three viable directions exist:

1. **H1** — originating turn must NOT synchronously wait a notify-
   owned job to terminal state. `command_status(J, waitMs>0)` for a
   notify-owned active J MUST NOT block through J's terminal
   transition. The wake owns terminal completion by definition.

2. **H2** — originating turn is allowed to observe terminal state,
   but the moment it does, it must atomically consume the marker
   AND cancel the wake. The wake must never fire after Path B
   observation.

3. **H3** — internal claim operation. First successful Path B OR
   Path A wins; the loser becomes a no-op.

H1 is the cleanest because it matches the user's explicit intent
("notify me when it finishes" implies wake ownership). H2 preserves
status-poll semantics. H3 is the most general but adds the most
state.

## What's safe to do, what isn't

Per the ACT's preserved invariant list, the following MUST remain
unchanged:

- C4→C8 cardinality intact (jobId preserved)
- terminal_committed(J) <= 1
- wake_created(J) <= 1
- OOM repair (drain still does not forward delivery)
- deriveOrigin precedence
- non-notify command_status(waitMs>0) semantics

The defect lives in the NOTIFY-OWNED path ONLY.

## Sources

- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/background-notify-coordinator.ts (consumeTerminal, resolveObligation, registerMarker)
- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/vscode-run-commands-tool.ts:755-836 (Path A arm + listener)
- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/command-status-tool.ts:140-220 (Path B seam)
- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/command-job-manager.ts:2415-2760 (finalize + terminalTransitionResolve)
- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/SdkController.ts:738 (enqueueTerminalWake fire-and-forget) + 3783-3797 (discardQueuedWakeForJobId)
- /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/__tests__/long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts:537-690 (existing TQCB dual-delivery arbitration tests; they cover coordinator-layer correctness but DO NOT exercise the production fire-and-forget discard race)
