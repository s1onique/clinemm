# LIVE Failure Freeze — AGCONT01

## Live subject
- Task ID:    1789935XXX_YYYY (operator-provided specimen)
- Job ID:     cmd_muac7cvi11hmne3x
- Owner:      (same as Task ID)
- Trigger:    "Run this command and wait until it finishes:\n\n              sh -c 'echo STARTED; sleep 480; echo FINISHED'"

## Model behavior (subjective)
1. Calls `run_commands` with `is_background: true`.
2. Reports: "The command is running. Let me wait for it to finish."
3. Polls a couple of times: "Still running. Let me wait longer."
4. Stops emitting text or tool calls.
5. Provider/runtime emits a `done` event WITHOUT an attempt_completion tool call.

## Q5 deferral freeze (LIVE, replicated in BTCONT01 specimen 1789935070156_oneah)
- currentPhase:           streaming
- candidatePhase:         awaiting_followup
- guardAvailable:         true
- guardResult:            true (defer)
- activeJobs:             [{cmd_muac7cvi11hmne3x, running, ownerSessionId}]
- candidateWriterId:      session-event-turn-complete-resumable-straggler-preserve
- deferredContinuation:   RECORDED (sessionId, taskId, epoch)

## Terminal lifecycle freeze
- process exits naturally at +480s
- process_terminality_record (termination_started)
- process_terminality_record (primary_group_cleanup, postcondition=gone)
- job_active_removed (previousState=running, terminalState=exited)
- process_terminality_record (terminal_committed)
- background_state_change_published(running=false, jobId=undefined)

## Post-terminal-continuation (BTCONT01 fix in effect)
- reevaluateDeferredContinuation() fires
- marker.sessionId === activeSession.sessionId  ✓
- marker.taskId === currentTaskId              ✓
- marker.epoch === currentEpoch                ✓
- hasRunningBackgroundJobForOwner === false    ✓
- COMMITS awaiting_followup (BTCONT writer fires)

## User-visible result
- UI: "Your turn"
- Chat history: last assistant message contains "Let me wait longer."
- Background command logs: contain "STARTED" but NOT "FINISHED" (terminal happened after defer)
- Model iteration count:  unchanged (no further AgentRuntime turn)

## Final requested output
- User asked: "After it finishes, tell me exactly: DONE: FINISHED"
- Received: NOTHING

## Defect summary
- TURN_CONTINUATION = PASS  (Q5 correctly committed awaiting_followup)
- AGENT_REENTRY      = ABSENT (AgentRuntime never resumed to observe terminal job)
- REQUESTED_OUTPUT   = MISSING (DONE: FINISHED never produced)

## P0 hypothesis boundary
The runtime now correctly UNSTRANDS the awaiting_followup phase at job
terminality. But "Your turn" is presented for work that the agent
itself had committed to observe (the model said "let me wait"). The
turn-state machine is sound; the agent-state machine did not see the
terminal event.

The remaining question — posed by this ACT — is whether the
agent-state machine SHOULD see the terminal event at all, or whether
"the model said it would wait" is a thing the runtime can ignore
under the ClineMM product contract.

## Stale card parallel
- Stale BackgroundCommand card after terminal: LIVE PROVEN (BTCONT card-projection successor)
- Stale Cancel button after terminal:        LIVE PROVEN
- These are NOT in scope for this ACT (projection defects, not continuation defects).
