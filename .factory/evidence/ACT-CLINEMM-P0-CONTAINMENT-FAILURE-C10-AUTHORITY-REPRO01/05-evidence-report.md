# 05 — Source-bound evidence report

Every claim below is bound to a source location at ENTRY_HEAD
`e915c785bd1dcdbbed87a3cc1215e589422709a6`, or to a named artifact in the
supplied evidence root. No claim rests on recollection.

## E1 — The C10 barrier has no containment conjunct (SOURCE-BOUND)

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts` L3494-3525 (the
`handleSessionEvent` barrier block):

    const ownerStillRunningForC10 =
        this.options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId) ?? false
    const unconsumedOwnedTerminalResultsForC10 =
        this.options.getUnconsumedOwnedTerminalResultCount?.(activeSession.sessionId) ?? 0
    const unconsumedOwnedTerminalJobIdsForC10 =
        this.options.getUnconsumedOwnedTerminalJobIds?.(activeSession.sessionId, taskId) ?? []
    const heldObligationForC10 =
        unconsumedOwnedTerminalResultsForC10 > 0 || unconsumedOwnedTerminalJobIdsForC10.length > 0
    const suppressOriginatingCompletion = perJobSuppressOriginatingCompletion

    if (
        outstandingAutonomousWork ||
        ownerStillRunningForC10 ||
        heldObligationForC10 ||
        suppressOriginatingCompletion
    ) { /* HOLD — register the deferred-completion-barrier marker */ }

None of these four conjuncts reads the per-job terminal classification.
`ownerStillRunningForC10` is an active-map CARDINALITY question
(`SdkController.ts:2631-2642` -> `host.hasRunningBackgroundJobForOwner`),
and the manager empties the active map on BOTH the clean path and the
containment-failure path (`command-job-manager.ts:2636`).

Machine-verified by CFC10A01-RED-03-E (a source-level assertion on the
actual file, not a recollection) and independently by a direct scan:
the barrier block and the BCB re-evaluation block contain no
`getBackgroundCommandJobStates` / `getBackgroundCommandJobOwners`.

## E2 — The Q5 path DOES fail closed on the same fact (THE DISCRIMINATOR)

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts` L1087-1139
(`reevaluateDeferredContinuation`):

    const jobStates = this.options.getBackgroundCommandJobStates?.()
    if (jobStates) {
        const jobOwners = this.options.getBackgroundCommandJobOwners?.()
        const failedContainmentJobIds = Object.entries(jobStates)
            .filter(([jobId, reason]) => {
                if (reason !== "containment_failed") return false
                if (!jobOwners) return true            // unscoped fallback
                const ownerSessionId = jobOwners[jobId]
                if (ownerSessionId === undefined) return true   // UNKNOWN owner -> fail closed
                return ownerSessionId === activeSession.sessionId
            })
            .map(([jobId]) => jobId)
        if (failedContainmentJobIds.length > 0) {
            Logger.warn(`... NOT releasing deferred Q5 completion ... (PHCF01)`)
            this.deferredContinuation = undefined
            this.options.setTurnPhase?.("resumable", undefined,
                "session-event-turn-complete-containment-failed-resumable")
            return
        }
    }

Its docstring (L961-970) states the invariant in the ACT's own terms:

> "the `>0 -> 0` cardinal transition proves only that the ACTIVE MAP is
> empty -- it does NOT prove that the process group was reaped, because
> the `CommandJobManager` removes a job from the active map on BOTH the
> clean path AND the containment-failure path. A job whose terminal
> reason is `containment_failed` carries an unresolved subprocess-safety
> obligation, so the handoff stays DEFERRED."

The SAME data is already threaded into the coordinator by
`SdkController.ts:2664` / `:2683`. The C10 path simply never asks for it.

## E3 — The Elm completion authority cannot express a containment failure

`apps/vscode/elm/completion-authority/src/Domain.elm` L206-216 — the job
lifecycle vocabulary:

    type JobLifecycle
        = JobRunning
        | JobTerminal ObservationState

    type ObservationState
        = ObservationPending
        | ObservationConsumed

`apps/vscode/elm/completion-authority/src/Authority.elm` L520-597 — the
hold reasons are `ActiveRun`, `PendingPrompt`, `ScheduledContinuation`,
`UnconsumedTerminalObservation`, `RunningBackgroundJob`. There is no
containment hold reason and no containment input. `completionAuthorized`
= `List.isEmpty (computeHoldReasons model)`.

So the Elm gate cannot compensate for the TS barrier's missing conjunct.
This is why RED-03-D (Elm HOLD) suppresses the commit while RED-03-B
(Elm authorize) permits it over an unresolved containment failure.

## E4 — The compact-receipt channel is `gone`-gated (RED-05-A)

`apps/vscode/src/sdk/background-notify-coordinator.ts` L3548:

    if (event.event !== "command_job_terminal_committed") {
        return { kind: "ignored" }
    }

`apps/vscode/src/sdk/command-job-manager.ts` L2677 gates that event:

    if (invariantProven) {
        this.emitCommandJobLifecycle({ event: "command_job_terminal_committed", ... })
        captureContinuationCardinalityAuthorityRecord({ stage: "terminal_committed", ... })
    }

A containment-failed job takes the L2743-2795 branch and emits
`command_job_containment_failed` instead. Therefore **no compact receipt
can ever exist for a containment-failed job**, and the C1
`terminal_committed` cardinality record is likewise never produced for it.

## E5 — The BCB obligation is owner-scoped and the drain carries no containment judgement

`apps/vscode/src/sdk/background-notify-coordinator.ts` L2004-2012:

    const existing = this.nonNotifyTerminalObservations.get(input.jobId)
    if (!existing) return
    if (ownerKey(existing.sessionId, existing.taskId) !== ownerKey(input.sessionId, input.taskId)) {
        return
    }
    this.nonNotifyTerminalObservations.delete(input.jobId)
    this.terminalReceipts.delete(input.jobId)

Verified behaviourally by RED-04-B: a foreign owner CAN read the terminal
fact (the manager's terminal map is process-level) but CANNOT drain the
owner's obligation.

## E6 — The UI does not overclaim the process state

`apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx` L364:
`containment_failed: "Run failed"`.

`apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts`
L174-175: `stateLabel("completed")` -> `{ label: "Complete", glyph: "✓", live: false }`
— derived from the TASK phase, with no per-job containment notion.

So the per-job pill is truthful about the containment failure, and the
header label is a task-phase label. Neither claims that a process was
reaped. The "Complete" label does not assert process safety; it asserts
the task phase. This matters for the ACT's §6 branch: if completion is
permitted by the existing contract, the UI does not claim clean process
termination.

## E7 — The incident itself did NOT reproduce the hypothesized behaviour

See `02-chronology.md` for the full table. The two decisive facts:

- The observation was NEVER consumed: both BCB captures
  (1792854752430 and 1792854831983) report
  `unconsumedOwnedTerminalResultsForC10: 1` and
  `ownedTerminalJobIdsForC10: ["cmd_mvmh3u69j62aclho"]`.
- The C10 was NEVER authorized: `submit_and_exit_seen = 2`,
  `task_completion_committed = 0`, and the turn-state provenance contains
  no `session-event-turn-complete-completed` write for this task.

## E8 — Pre-existing baseline RED in the BCB/PPCA suites (harness defect)

Measured at PRISTINE ENTRY_HEAD with the new suite removed:
`bcb01, bcb01-c, bcb01-c2, bcb01-c3, bcb01-c4, pcca01` ->
`Test Files 6 failed (6)`, `Tests 30 failed | 12 passed (42)`.

Cause: `getElmCompletionAuthorityDecision` became a REQUIRED option
(`sdk-session-event-coordinator.ts:633`) under
ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY.
The older harnesses do not inject it; the call throws inside
`checkElmCompletionAuthority`'s try/catch, which returns false
(fail-closed) and suppresses the C10 commit. The suites that DO inject it
(`c9c10cdap01`, `c9c10scr01`, `bcapt01`, `cpc01`, …) are green.

This is orthogonal to the containment question and is recorded so that the
pre-existing RED is not mis-attributed to it.
