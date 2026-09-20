# Terminal Continuation Authority Map - BTCONT01

Edge labels: REAL_PRODUCTION_SEAM (verified), STRUCTURAL (named but not necessarily observed LIVE), LIVE (observed in this specimen), LIVE_UNOBSERVABLE (LIVE but cannot be re-observed without operator action), INFERRED (deduced from code).

## Chain 1 - Q5 deferral

session_done_event -> SdkSessionEventCoordinator.handleSessionEvent
  (REAL_PRODUCTION_SEAM - apps/vscode/src/sdk/sdk-session-event-coordinator.ts)
  -> result.turnComplete branch (LIVE)
  -> done-without-completion sub-branch
    (REAL_PRODUCTION_SEAM - sdk-session-event-coordinator.ts:265-378)
  -> ownerStillRunning = options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId)
    (REAL_PRODUCTION_SEAM - line 308)
    delegate: VscodeSessionHost.hasRunningBackgroundJobForOwner
      -> CommandJobManager.hasRunningBackgroundJobForOwner
        (REAL_PRODUCTION_SEAM - command-job-manager.ts:2994)
    iterates active map filtering state==="running" && ownerSessionId===queried
  -> IF ownerStillRunning === true
    -> SUPPRESS awaiting_followup transition (LIVE - BOCOR row 1 guardResult=true)
    -> BOCOR record captured (LIVE - jsonl line 1)
  -> ELSE
    -> setTurnPhase("awaiting_followup", ..., "session-event-turn-complete-resumable-straggler-preserve")
      (REAL_PRODUCTION_SEAM - line 372-376)

State available at deferral:
- event.payload.sessionId        - session/event identity (REAL_PRODUCTION_SEAM)
- activeSession.sessionId       - active session identity (REAL_PRODUCTION_SEAM)
- options.getTask?.()?.taskId   - task id (REAL_PRODUCTION_SEAM)
- tracker.currentPhase          - pre-existing phase (REAL_PRODUCTION_SEAM, via getTurnPhase)
- tracker.epoch / minter.epoch  - fence (REAL_PRODUCTION_SEAM)
- ownerStillRunning boolean     - the Q5 guard result (REAL_PRODUCTION_SEAM)
- options.getActiveJobOwnershipSnapshot?.() - live snapshot (REAL_PRODUCTION_SEAM, BOCOR only)

No state is recorded that the deferral happened. The BOCOR ring captures the observation, but that is a forensic log, not a re-entrancy token.

## Chain 2 - CommandJob terminal lifecycle publication

CommandJobManager.finalize()
  -> emitCommandJobLifecycle({event: "command_job_primary_group_cleanup", postcondition: "gone", jobState: "deadline_exceeded"})
    (REAL_PRODUCTION_SEAM - command-job-manager.ts:2237-2402)
  -> emitCommandJobLifecycle({event: "command_job_terminal_committed"})
    (REAL_PRODUCTION_SEAM - command-job-manager.ts:2605-2628, post-delete emit)
  -> background_state_change_published(running=false, jobId=null)
    (REAL_PRODUCTION_SEAM - vscode-run-commands-tool.ts:621-636)
  -> SdkController.handleCommandJobLifecycle (REAL_PRODUCTION_SEAM - SdkController.ts:4272)
    forwards to TaskTelemetryTracker.recordActiveCommandJobs
  -> SdkController.updateBackgroundCommandState (REAL_PRODUCTION_SEAM - SdkController.ts:4183-4195)
    updates backgroundCommandRunning=false, backgroundCommandTaskId=undefined
    posts state to webview

Identity preserved across the chain (LIVE):
- jobId                       (LIVE - bjla row 3)
- job.ownerSessionId          (LIVE - bjla row 3 = "1789935070156_oneah")
- job.state final             (LIVE - bjla row 18 = "deadline_exceeded")
- event.activeCommandJobs     (REAL_PRODUCTION_SEAM)

Identity lost across the chain:
- The "I owe a continuation because I deferred a Q5 decision" fact
  - this never left the BOCOR diagnostic ring and has no
    producer-side handle pointing back at the Q5 layer.

## Chain 3 - SdkSessionEventCoordinator reception of lifecycle

Confirmed absence:
  grep -rn 'reevaluateDeferredTurn\|reevaluate\|onCommandJobLifecycle.*coordinator\|SdkSessionEventCoordinator.*jobTerminal'
    -> NO MATCHES

  grep -rn 'command_job_terminal_committed\|command_job_primary_group_cleanup' apps/vscode/src/sdk | grep -v command-job-manager | grep -v __tests__ | grep -v test
    -> only: vscode-run-commands-tool.ts (run_commands wrapper)
    -> only: SdkController.ts:4272 (handleCommandJobLifecycle) and SdkController.ts:4183 (updateBackgroundCommandState)
    -> ONLY the TaskHeader projection + the gauge are updated
    -> The SdkSessionEventCoordinator is NOT a lifecycle consumer

There is no consumer for command_job_terminal_committed (or any terminal sibling event) in the canonical session/turn coordinator.

## Chain 4 - Deferred continuation state

  grep -rn 'deferredContinuation\|deferredTurn\|pendingTurnCompletion\|straggler.*deferred\|turnOwed'
    -> NO MATCHES

The BOCOR ring holds a forensic observation of the suppression, not a re-entrancy token.

## Chain 5 - streaming ownership distinction

  grep -n 'streaming' apps/vscode/src/sdk/turn-state-tracker.ts
    -> no discriminator between "model/runtime working" vs "Q5-suppressed waiting"
    -> currentPhase is a single TurnPhase enum value; semantics are external

The TurnStateTracker does not differentiate "actively streaming because runtime is working" from "streaming because Q5 deferred". The distinction lives only in the Q5 ownerStillRunning guard result and the surrounding log/BOCOR capture.

## Conclusion

- The terminal lifecycle event reaches the host (updateBackgroundCommandState updates the projection).
- It does NOT reach the canonical session/turn coordinator.
- The Q5 deferral leaves no bounded re-entrancy token.
- There is exactly one missing consumer: SdkSessionEventCoordinator must be told "the matching background job J owned by activeSession S just became terminal - please re-evaluate the deferred continuation, if any."

This is TC1 - missing terminal continuation consumer in code form. The job identity is preserved (M2/H2, ownerSessionId, jobId, epoch-bindable task identity). The deferred continuation is NOT represented (TC3) but the wire can be simple: re-drive the existing awaiting_followup decision using the same Q5 logic, gating on the live hasRunningBackgroundJobForOwner lookup at the moment of the terminal event. If the lookup returns false and the active session is still the same, the existing branch will commit awaiting_followup. If the active session has moved on, no-op.
