# LIVE Failure Freeze — BTCONT01

## Live subject
- Task ID:    1789935070156_oneah
- Job ID:     cmd_mua94lrk2w8jyomn
- Manager:    M2 (host H2)
- Owner:      1789935070156_oneah

## Q5 deferral freeze (BOCOR row 1, 1789935252484)
- currentPhase:       streaming
- candidatePhase:     awaiting_followup
- guardAvailable:     true
- queriedOwnerSessionId: 1789935070156_oneah
- activeSessionId:    1789935070156_oneah
- guardResult:        true (defer)
- activeJobs:         [{cmd_mua94lrk2w8jyomn, running, 1789935070156_oneah}]
- candidateWriterId:  session-event-turn-complete-resumable-straggler-preserve
- managerInstance:    M2
- hostInstance:       H2

## Terminal lifecycle freeze (BJLA rows 13-21, 1789935673300-1789935673307)
- job_cancellation_requested: requestOrigin=command_deadline, sessionId=1789935070156_oneah, currentState=running
- process_terminality_record (termination_started): jobId=cmd_mua94lrk2w8jyomn, postcondition=null, pgid=31172
- process_terminality_record (primary_group_cleanup): jobId=cmd_mua94lrk2w8jyomn, postcondition=gone, jobState=deadline_exceeded
- job_active_removed: previousState=running, terminalState=deadline_exceeded, reason=deadline, pid=31172, pgid=31172
- process_terminality_record (terminal_committed): jobId=cmd_mua94lrk2w8jyomn, jobState=deadline_exceeded, pgid=null
- background_state_change_published: running=false, jobId=null

## TSWPD sequence freeze (post-terminality, manual wake-up)
- 1789935927437 controller-cancel-task: streaming -> resumable
- 1789935929031 controller-ask-response:  resumable -> streaming
- 1789935929032 controller-epoch-transition-reseed
- 1789935930966 session-event-turn-complete-resumable-straggler-preserve: streaming -> awaiting_followup
  (writer that should have fired AUTOMATICALLY at 1789935673307)

## Process terminality postcondition
- process group: gone (ESRCH from process.kill(-pgid, 0))
- active map:   empty
- background:   running=false

## Stranded turn phase
- phase remains streaming after terminality
- NO TSWPD writer ran for 1789935673307 -> 1789935927437 (15 min 4 s)

## Manual wake-up control
- Bottom task Cancel -> controller-cancel-task
- Resume -> controller-ask-response
- Existing Q5 path commits awaiting_followup
  (BOCOR row 2 guardResult=false; activeJobs=[])
