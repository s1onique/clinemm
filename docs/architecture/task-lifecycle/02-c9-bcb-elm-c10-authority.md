# Chart 02 — C9 / BCB / Elm / C10 Completion Authority

Who may commit task completion, and how the pieces interact.

This is the chart that explains the LIVE incident.

## The four actors

| Actor | What it is | Where |
|---|---|---|
| **C9** | `submit_and_exit_seen` — a cardinality CAPTURE that fires when the completion tool's terminal response was committed AND the turn-end path is promoting phase. **An attempt, not a completion.** | `sdk-session-event-coordinator.ts` (the `captureContinuationCardinalityAuthorityRecord({stage: "submit_and_exit_seen", submitId})` call) |
| **BCB** | Background Completion Barrier — the TS-predicate HOLD on the C10 commit. | `sdk-session-event-coordinator.ts` (the barrier block) + `background-notify-coordinator.ts` |
| **Elm** | The Elm completion-authority kernel. The MANDATORY authority for the C10 commit. No silent TS fallback. | `completion-authority-elm-authority.ts`, `completion-authority-elm-authority-runtime.ts` |
| **C10** | `task_completion_committed` — the canonical task-completion commit. Fires AT the `setTurnPhase("completed", …)` effect. **The single authority for "the task completed".** | `sdk-session-event-coordinator.ts` (the `captureContinuationCardinalityAuthorityRecord({stage: "task_completion_committed", completionId})` call) |

## The C9 → C10 chain

```mermaid
stateDiagram-v2
    direction TB

    [*] --> TurnRunning : turn starts

    TurnRunning --> C9Captured : completion tool content_end
    note right of C9Captured
        C9 = submit_and_exit_seen
        Fires ONLY when:
          - terminal response committed this turn
          - the turn-end path is promoting phase
        This is an ATTEMPT.
        It does NOT mean the task completed.
    end note

    C9Captured --> C10Blocked : BCB hold predicate true
    C9Captured --> ElmConsulted : BCB hold predicate false

    state C10Blocked {
        direction TB
        [*] --> PendingPromptUnknown
        PendingPromptUnknown --> PendingPromptKnown : getPendingPromptCount().available === true
        PendingPromptKnown --> OutstandingAutonomousWork : pendingPrompts > 0 OR activeNotifyCount > 0 OR perJobOutstandingNotifyWork
        OutstandingAutonomousWork --> OwnerStillRunning : hasRunningBackgroundJobForOwner
        OwnerStillRunning --> HeldObligation : unconsumedOwnedTerminalResults > 0 OR unconsumedOwnedTerminalJobIds.length > 0
        HeldObligation --> Suppressed : wake was delivered (per-job)
        Suppressed --> [*]
    }

    C10Blocked --> C10Committed : obligations resolve (reevaluateDeferredCompletionBarrier)

    ElmConsulted --> ElmHold : Elm decision = hold
    ElmConsulted --> ElmFailure : Elm decision = failure
    ElmConsulted --> C10Committed : Elm decision = authorize

    ElmHold --> C10Withheld : C10 commit SUPPRESSED
    ElmFailure --> C10Withheld : C10 commit SUPPRESSED

## Load-bearing transitions

### A-01 — C9 capture (`submit_and_exit_seen`)

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (the `captureContinuationCardinalityAuthorityRecord({stage: "submit_and_exit_seen", …})` call inside the turn-end promotion branch) |
| predicate | `wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn()` — evaluated in the turn-end path |
| effect | One bounded cardinality record with a coordinator-local monotonic `submitId`. **No phase write. No completion commit.** |
| test | `apps/vscode/src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts` |
| kind | observed |

**A C9 is an ATTEMPT.** The LIVE incident recorded `C9 = 2 observed
attempts` and `C10 = 0 observed commits` — two attempts, no completion.
That is the correct shape for a held task.

### A-02 — the BCB hold predicate

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (the barrier block) |
| predicate | `outstandingAutonomousWork \|\| ownerStillRunningForC10 \|\| heldObligationForC10 \|\| suppressOriginatingCompletion` |
| effect | The C10 commit is NOT taken; a `DeferredCompletionBarrier` marker is registered with the `(sessionId, taskId, epoch)` triple; a bounded completion-continuation may be enqueued |
| test | `apps/vscode/src/sdk/__tests__/long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts`, `background-completion-barrier01.bcb01.test.ts` |
| kind | observed |

The conjuncts:

| Conjunct | Source | Meaning |
|---|---|---|
| `pendingPromptAuthorityUnknown` | `getPendingPromptCount(...).available !== true` | Fail-closed: "do not know" ⇒ hold |
| `pendingPromptsKnown > 0` | same read | A queued prompt is outstanding |
| `activeNotifyCount > 0` | `getActiveNotifyCount(sessionId, taskId)` | A notify-owned background job is alive |
| `perJobOutstandingNotifyWork` | `hasActiveNotify(jid)` per launched jobId | Wake authority in flight for a launched job |
| `ownerStillRunningForC10` | `hasRunningBackgroundJobForOwner(sessionId)` | The owner still owns a RUNNING background job |
| `heldObligationForC10` | `getUnconsumedOwnedTerminalResultCount(sessionId)` / `getUnconsumedOwnedTerminalJobIds(sessionId, taskId)` | Terminal observations are held, not yet observed |
| `suppressOriginatingCompletion` | `wasWakeDelivered(jid)` | The wake-driven turn owns the terminal completion |

### A-03 — the Elm consult

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (`checkElmCompletionAuthority`) |
| predicate | `getElmCompletionAuthorityDecision(sessionId)` returns `{kind: "authorize"}`. `hold` and `failure` both return `false` — **there is NO silent TS fallback** (`completion-authority-elm-authority.ts`). |
| effect | `true` → the C10 commit proceeds. `false` → the C10 commit is SUPPRESSED and a `DeferredCompletionBarrier` marker is registered (the liveness repair from `ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01`). |
| test | `apps/vscode/src/sdk/__tests__/completion-authority-elm-first-seam01.case01.test.ts`, `completion-authority-elm-real-provider01.test.ts` |
| kind | observed |

**The Elm kernel is fed the factual CCARD stages** through
`captureContinuationCardinalityAuthorityRecord` →
`enqueueElmAuthorityRecord`. The filter is
`AUTHORITY_STAGES` in `completion-authority-elm-authority-runtime.ts`:
it EXCLUDES the post-decision stages (`task_completion_committed`,
`completion_presented`, `task_cancelled`) so the kernel is never told
the outcome before it decides.

### A-04 — the C10 commit

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (the `setTurnPhase("completed", …)` call) |
| predicate | ALL of: turn complete; a completion tool was seen; a terminal response was committed this turn; no error was seen; NOT (BCB hold); Elm authorized |
| effect | `setTurnPhase("completed", undefined, "session-event-turn-complete-completed")` AND `captureContinuationCardinalityAuthorityRecord({stage: "task_completion_committed", completionId})` — the C10 record, minted AFTER the effect |
| test | `apps/vscode/src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01.test.ts` (GREEN control) |
| kind | observed |

### A-05 — the C10 commit is EXACTLY ONCE

| Field | Value |
|---|---|
| source | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (`this.nextCompletionCommitEventId`) |
| predicate | The C10 capture is the ONLY event-creating seam for `completionId`; the increment is monotonic per coordinator instance |
| effect | One C10 ⇒ one `completionId`; two real C10 commits ⇒ two distinct `completionId`s. Presentation, reopen, and BCB do NOT mint `completionId`s. |
| test | `apps/vscode/src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts` |

## The LIVE incident, traced

```
SESSION = 1792824738628_cw4og
EPOCH   = 8
C9      = 2 observed attempts
C10     = 0 observed commits
LEGACY  = streaming
UI      = Working / Cancel
ROW     = finalized completion_result
```

### What the evidence DOES establish

| Fact | Where it comes from |
|---|---|
| The task did NOT complete. | `C10 = 0` — the C10 capture is the ONLY event-creating seam for the completion commit, and it did not fire. |
| The task phase is `streaming`. | The legacy phase writer never wrote `completed`. `streaming` → TaskHeader "Working" (`taskHeaderTelemetryHelpers.ts:146`). |
| Two completion ATTEMPTS were made. | `C9 = 2` — two `submit_and_exit_seen` captures, each with a distinct monotonic `submitId`. |
| A finalized `completion_result` row exists. | The completion tool's `content_end` fired (the `content_end` is what finalizes the row). |
| A completion attempt was HELD. | The LIVE counter `C9 = 2` with `C10 = 0` is the signature of a held attempt. |

### What the evidence does NOT establish

The reported "missing terminal observation" is a **discriminator, not a
proven final cause**. Two candidate causes both produce the
`C9 = 2 / C10 = 0` signature:

1. The **TS-predicate BCB hold** (held terminal observations).
2. The **Elm authority HOLD / FAILURE**.

The LIVE row evidence discriminates between them:

| Path | What happens to the completion row |
|---|---|
| BCB (TS-predicate) hold | The **message-layer completion filter** REMOVES the row from the published set. The row is never visible to the user, so it cannot present as authoritative completion. |
| Elm HOLD / FAILURE | The row is **NOT filtered** — it stays published WITH the `isAuthoritativelyCompletedResult` marker, and the webview renders the green "Completed" badge. |

**A finalized `completion_result` row that the user can SEE therefore
excludes the pure-BCB path and implicates the Elm path.**

### The causal chain (confirmed by the RED witness)

```
1. content_end (submit_and_exit)
   -> message-translator.ts publishes say:"completion_result",
      partial=false, isAuthoritativelyCompletedResult: true
      (STAMPED UNCONDITIONALLY at this seam)

2. done event
   -> coordinator turn-end promotion branch
   -> BCB hold predicate false (no outstanding work)
   -> checkElmCompletionAuthority(...) === false   [Elm HOLD or FAILURE]

3. C10 commit SUPPRESSED
   -> setTurnPhase("completed", ...) NOT called
   -> phase stays "streaming"
   -> TaskHeader says "Working"
   -> C10 capture never fires

4. The published row KEEPS isAuthoritativelyCompletedResult: true
   -> webview resolveTerminalReportFraming() PRIMARY marker path
   -> green "Completed" badge
```

**Step 1 vs step 3 is the defect.** The marker asserts "this row IS a
terminal completion" at PUBLICATION time, but the authority to commit
is decided LATER — and may never be granted.

### The repair

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts`:
`promoteCompletionAuthorityMarker(event)`.

The invariant is TEMPORAL: an authoritative completion must never be
PUBLISHED before its C10 commit. So the LIVE `content_end` publishes the
finalized `completion_result` row WITHOUT the
`isAuthoritativelyCompletedResult` marker, and the C10 COMMIT publishes
the marker: the coordinator re-publishes the current turn's completion
row with the SAME `ts` and the marker ADDED. The message store upserts by
`ts` and the webview's `applyMessage` reducer merges by `ts`, so the row
is replaced in place: the summary TEXT stays visible, and the
"Completed" badge appears exactly when — and only when — the C10
committed.

Both C10 paths promote the row: the immediate turn-complete path and the
deferred `reevaluateDeferredCompletionBarrier` path.

The promotion is a PUBLICATION of the C10 authority, not a second
completion authority: the C10 commit IS the authority, and the seam is
only ever called from a successful commit.

**Why the earlier retraction design was insufficient.** The first
repair stamped the marker at publication time and retracted it later
when the Elm authority rejected the completion. That is retrospective:
the webview receives the publication and the retraction as SEPARATE
messages over an event-based channel, so it can render the first one
before the second arrives — the final projection was correct, but the
temporal invariant was violated. The retraction also had a second
defect: the DEFERRED C10 path could later AUTHORIZE and COMMIT without
ever restoring the removed marker, leaving a legitimate, committed
completion with NO badge.

| kind | observed |


    C10Committed --> [*]
    C10Withheld --> [*]
```
