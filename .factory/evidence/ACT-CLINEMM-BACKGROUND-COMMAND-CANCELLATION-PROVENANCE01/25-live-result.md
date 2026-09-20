# 25 — LIVE RESULT (added after the dogfood VSIX captured a real cycle)

## Subject

```text
jobId            = cmd_mu9wmnyuhvgva8cn
managerInstance  = M2
sessionId        = 1789914077854_aq4sy
ownerSessionId   = 1789914077854_aq4sy (matches activeSessionId)
dogfood VSIX     = clinemm-4.1.16-bjla-cancellation-provenance01.vsix
                   SHA-256 5195db3af3e3f09e95ec2dcfacfafe45694e13244d5a8957276366ce937c71e5
                   built from HEAD 640cc388131ad8071e7a2feccb456c580d1d09a5
```

## Pre-cancel state

```text
job_inserted   manager=M2  status=running
job_poll#1     manager=M2  status=running
job_poll#2     manager=M2  status=running
job_poll#N     manager=M2  status=running
   (all polls hit the same active map keyed by M2; no instance drift)
   (all polls carried the same ownerSessionId == 1789914077854_aq4sy;
    no owner drift)
```

## Cancellation request — REQUEST chain (this ACT's contribution)

```text
event             = job_cancellation_requested
requestOrigin     = caller_abort_signal
jobId             = cmd_mu9wmnyuhvgva8cn
manager           = M2
sessionId         = 1789914077854_aq4sy
currentState      = running   <-- verified at the request boundary, BEFORE
                                   this.terminate() mutated anything
firstWriterWins   = true      <-- the FIRST-WRITER-WINS latch
                                   (job.terminationPromise) was unset at this
                                   instant; this is the unique requester
                                   for this LIVE cycle
capturedAt        = T (ms resolution; ~147.3 s after the job was inserted)
```

`requestOrigin = caller_abort_signal` is the **only** `requestOrigin`
that maps to a production caller attaching
`context.signal.addEventListener("abort", …, { once: true })` in
`CommandJobManager.start`
(`apps/vscode/src/sdk/command-job-manager.ts:1943-1953`). It is the
internal label that the LIVE specimen carries on the wire.

## Cancellation — MUTATION chain (predecessor ACT's contribution)

```text
command_job_termination_started(J)                   [first-writer-wins latch fires]
command_job_primary_group_cleanup(J, postcondition=gone)
process_terminality_record(J, state=cancelled, pgid cleared)
job_active_removed(J, previousState=running,
                   terminalState=cancelled,
                   reason=cancel,
                   pid/pgid preserved from supervisor)
background_state_change(running=false)
```

All on the same `M2` manager and same `jobId`. The cleanup
postcondition was observed as `gone`.

## Downstream consequences (conserved)

```text
BOCOR (Q5) guard       = false
                       activeSessionId       = 1789914077854_aq4sy
                       queriedOwnerSessionId = 1789914077854_aq4sy
                       manager               = M2
                       activeJobs            = []
                       guardResult           = false
                       capturedAt            = T + 5 ms
                       (5 ms after the command_job_termination_started event)

TSWPD                  = streaming → awaiting_followup
                       writerId = session-event-turn-complete-resumable-straggler-preserve
                       capturedAt = T + ~5 ms

UI                     = "Your turn"
                       (the projection flips from running=false on the
                        same activeSessionId)
```

## Causal chain (verbatim, causal not just chronological)

```text
running managed job (M2, cmd_mu9wmnyuhvgva8cn)
      ↓
CALLER ABORT SIGNAL     <-- context.signal aborted on the
                            foreground tool/turn that started
                            this job
      ↓
CommandJobManager cancels job
      ↓
active map becomes empty
      ↓
Q5 correctly returns false
      ↓
awaiting_followup
      ↓
Your turn
```

## Exoneration matrix (verbatim)

```text
background_cancel_rpc           = REFUTED
extension_shutdown              = REFUTED
command_deadline                = REFUTED
CommandJobManager               = BEHAVING_CORRECTLY_GIVEN_ABORT
Q5 guard                        = EXONERATED
TSWPD writer                    = EXONERATED_GIVEN_EMPTY_ACTIVE_SET
TaskHeader                      = EXONERATED
manager-instance split          = REFUTED
owner mismatch                  = REFUTED
```

## Why this is causal, not just chronological

1. The `job_cancellation_requested` record carries
   `requestOrigin = "caller_abort_signal"` and was emitted at the
   REQUEST BOUNDARY with `currentState = "running"`. This proves the
   job was still running at the moment of the cancellation request.
2. The MUTATION chain (`command_job_termination_started` →
   `pgid_cleanup` → `process_terminality_record` →
   `job_active_removed`) is the same chain that ANY caller of
   `manager.terminate(reason="cancel")` would have produced.
3. The only difference between the LIVE specimen and any of the
   refuted candidates is the `requestOrigin` label. No
   `manager_dispose_begin` event fired in the dump (refuting
   `extension_shutdown`); no `cancelBackgroundCommand` gRPC call
   arrived (refuting `background_cancel_rpc`); `job_active_removed.reason`
   was `"cancel"` not `"deadline"` (refuting `command_deadline`).
4. The same manager M2 is observed across insert, polls, terminate,
   active delete, and BOCOR guard. The ownerSessionId == activeSessionId
   holds throughout. There is no instance/owner split.
5. The Q5 guard and TSWPD writer both fired only because the active
   set became empty. They are exonerated because they correctly
   responded to the empty active set; they are NOT independent
   defects.

## Architectural root cause (per `sdk/ARCHITECTURE.md`)

`sdk/ARCHITECTURE.md` §proceed-while-running states:

> "The executor removes its abort and timeout ownership, resolves the
> tool call with the current bounded output and a temporary log
> path, and continues draining the process into that log."

The `backgroundExec` path of `VscodeRunCommands` does NOT perform
this contract step. `CommandJobManager.start(..., context)` installs
`context.signal.addEventListener("abort", listener, { once: true })`
on the caller's signal
(`apps/vscode/src/sdk/command-job-manager.ts:1947-1953`)
and the listener is NEVER released when the foreground tool returns
RUNNING. The job is supposed to be detached at that point — but the
abort listener is still attached, and any later abort on the original
signal cancels the supposedly detached job.

This is the contract defect the LIVE specimen proves.

## STOP-rule scope

Per ACT §34: STOP after (a) the cancellation requester is proven and
(b) the bounded repair is authorized. Do NOT change Q5, TaskHeader,
CommandJobManager architecture, owner/session identity, status
authority, PGID helper semantics, `submit_and_exit`, or terminal
row mutation. One cancellation request. One caller. One repair.

## Next ACT (C1: GO)

`ACT-CLINEMM-BACKGROUND-COMMAND-PROCEED-WHILE-RUNNING-ABORT-OWNERSHIP-RELEASE01`
— bounded repair that removes the caller's `AbortSignal` listener
from the managed background `CommandJob` at the
foreground→background handoff, while preserving all conservation
invariants (C1–C15 in `19-conservation.txt`) and the documented
contract of the proceed-while-running lifecycle.