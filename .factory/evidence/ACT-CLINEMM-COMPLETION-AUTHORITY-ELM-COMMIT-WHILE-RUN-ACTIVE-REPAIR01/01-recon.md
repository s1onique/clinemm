# §4 — Elm authority recon (source-only)

Source recon. No production changes.

## Surface

Read:

- `apps/vscode/elm/completion-authority/src/Domain.elm` (400 lines)
- `apps/vscode/elm/completion-authority/src/Authority.elm` (883 lines)
- `apps/vscode/elm/completion-authority/src/Codec.elm` (358 lines)
- `apps/vscode/elm/completion-authority/tests/CompletionAuthorityTest.elm` (417 lines)

## Answers

**R1. Where is `activeRun` set?**

`Authority.elm`:

- L142 `ExecuteTurnPreludeEnter runRef` — sets `activeRun = Just runRef`.
- L155 `RunStarted` while a prior run is active — sets `activeRun = Just newRef`.
- L164 `RunStarted` from `Nothing` — sets `activeRun = Just newRef`.
- L345/355/365 `ContinuationStarted` — sets `activeRun = Just runRef`.

**R2. Where is `activeRun` cleared?**

`Authority.elm`:

- L182 `handleAgentTurnDone` when `closingRef == active` — sets `activeRun = Nothing`.
- L156 `RunStarted` (with prior active run) — sets `activeRun = Just newRef` (transfers, does NOT clear).

**R3. Where does `ActiveRun` become a `HoldReason`?**

`Authority.elm:439-532` `computeHoldReasons`:

```elm
activeRunHeld = model.activeRun /= Nothing
```

Then in the result list (L506-510):

```elm
[ if activeRunHeld then Just ActiveRun else Nothing
, ...
] |> List.filterMap identity
```

`ActiveRun` is a `HoldReason` constructor in `Domain.elm:248`.

**R4. What exact branch handles `TaskCompletionCommitted`?**

`Authority.elm:376-400` `handleTaskCompletionCommitted`:

```elm
case model.committedCompletion of
    Just existing -> (model, [], Just (DuplicateCompletionRef existing completionRef))
    Nothing ->
        case computeHoldReasons model of
            firstReason :: _ -> (model, [], Just (TaskCompletionCommittedWhileHeld firstReason))
            [] -> ({ model | task = CompletionCommitted, committedCompletion = Just completionRef }, [], Nothing)
```

The C10 rejection is driven entirely by `computeHoldReasons`.

**R5. What facts does the model already possess when `SubmitAndExitSeen` occurs?**

`Authority.elm:128-129`:

```elm
SubmitAndExitSeen _ -> ({ model | submitCount = model.submitCount + 1 }, [], Nothing)
```

So when C10 (`TaskCompletionCommitted`) arrives in the REAL chronology, the model already has `submitCount >= 1` because C9 fired first.

In production, `submit_and_exit_seen` (C9) is emitted by `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1231` only when:

- `wasTerminalResponseCommittedThisTurn() === true` (the attempt_completion tool's `content_end` was observed), AND
- `!outstandingAutonomousWork` (no held background jobs, no queued prompts, no active notify markers, no running owned jobs).

This means: the moment `submitCount` becomes `>= 1` in the Elm model, the production code path has already proven the BCB barrier is clear (`!outstandingAutonomousWork`).

**R6. Is `submitCount` sufficient to distinguish (a) genuinely active run vs (b) semantically completed run awaiting late `AgentTurnDone`?**

**Yes.** At the moment C10 (`TaskCompletionCommitted`) arrives:

- **Case (a)**: `submitCount == 0` AND `activeRun /= Nothing`. The run is genuinely unresolved (no submit seen, so the completion-ready boundary was never reached). ActiveRun must block.
- **Case (b)**: `submitCount >= 1` AND `activeRun /= Nothing`. The submit was observed, which means the BCB barrier cleared in production. The `activeRun` is therefore the bookkeeping artifact of a run whose `AgentTurnDone` has not yet been delivered but whose semantic completion has been declared.

The `submitCount` field is the existing factual boundary between these two states.

**R7. What other `HoldReason`s can coexist with `ActiveRun`?**

`Authority.elm:439-532` — all five `HoldReason` constructors can coexist with `ActiveRun`:

- `ActiveRun` (L506-510)
- `PendingPrompt` (L511-515)
- `ScheduledContinuation` (L516-520)
- `UnconsumedTerminalObservation` (L521-525)
- `RunningBackgroundJob` (L526-530)

**R8. Can `AgentTurnDone` legally arrive after `model.task = CompletionCommitted` today?**

`Authority.elm:91-97`: if `model.task == Completed`, then any non-cancellation msg is `EventAfterCompletion`. But `CompletionCommitted` is a distinct state from `Completed` (Domain.elm:180-181). So an `AgentTurnDone` arriving after `task = CompletionCommitted` but before `CompletionPresented` (which transitions to `Completed`) is NOT rejected today.

Looking at `handleAgentTurnDone` (L176-204), it does not inspect `model.task`. So `AgentTurnDone` can arrive after `CompletionCommitted` and clear `activeRun` without violating anything.

**R9. Would accepting late `AgentTurnDone` require any new model state?**

**No.** The existing `handleAgentTurnDone` already handles the `closingRef == active` case by clearing `activeRun`. Today the model simply rejects C10 first because of `ActiveRun` in `computeHoldReasons`. If `ActiveRun` is suppressed at C10-time (after submit), the existing `AgentTurnDone` handler already does the right thing — it clears `activeRun` and consumes the matching `PromptRunning`.

**R10. Can the repair be expressed entirely using existing Model + Msg facts?**

**Yes.** The Model already has `submitCount : Int`. The Msg already has `SubmitAndExitSeen SubmitRef`, `TaskCompletionCommitted CompletionRef`, and `AgentTurnDone RunRef`. No new Msg constructor is required; no new Model field is required; no JS/TS flag is required.

## Decision gate

**Existing Elm input IS sufficient** — `submitCount >= 1` is the existing factual boundary that distinguishes "genuinely unresolved run" from "semantic completion established, AgentTurnDone bookkeeping not yet observed."

We do NOT need to add a new Elm fact. We do NOT need to add a JS/TS flag.

The repair is expressible as a single suppression in `computeHoldReasons` (or in `handleTaskCompletionCommitted`): `ActiveRun` is suppressed only when the model has already observed `submitCount >= 1`, because the production C9 path proves the BCB barrier was clear when submit was emitted.

## Sibling Elm facts observed during recon

- The Elm `submitCount` field already mirrors the production monotonic submit counter.
- `SubmitAndExitSeen` has been the elm-side trigger for `submitCount` since SHADOW01; the field predates this ACT.
- `ELM-AUTH-15` (the load-bearing Elm happy path: `RunStarted R1, AgentTurnDone R1, SubmitAndExitSeen → AuthorizeTaskCompletion`) continues to work because its chronology has `AgentTurnDone` BEFORE `SubmitAndExitSeen`, so `submitCount == 1` AND `activeRun == Nothing` — both required to fire `AuthorizeTaskCompletion` are still satisfied.
- `ELM-AUTH-09` (the load-bearing Elm rejection: `RunStarted R1 + TaskCompletionCommitted C1 → TaskCompletionCommittedWhileHeld ActiveRun`) needs to be examined: in that test the chronology is `RunStarted` then `TaskCompletionCommitted` with NO prior `SubmitAndExitSeen`. `submitCount == 0` means the new rule does NOT suppress ActiveRun — so `ELM-AUTH-09` continues to reject. **This test must remain unchanged.**

## Review-cycle refinement

ACT review identified that `submitCount >= 1` is a task-level fact, not
a run-scoped fact. A stale submit from an earlier, already-closed run
must NOT authorize a later run's completion. The expert supplied the
adversarial sequence:

```
TaskStarted T
RunStarted R1
SubmitAndExitSeen S1
AgentTurnDone R1
RunStarted R2
TaskCompletionCommitted C2
```

After this sequence, `submitCount == 1` (from R1's submit), but R2 is
genuinely active and not completion-ready. The original
`submitCount >= 1` suppression would accept C2.

The refinement introduces a run-scoped binding field `commitReadyRun`
in `Domain.Model`. It is set at `SubmitAndExitSeen` to the current
`activeRun`, and invalidated on every event that transitions
`activeRun` (RunStarted, AgentTurnDone, ExecuteTurnPreludeEnter,
ContinuationStarted). The suppression gate becomes
`commitReadyRun == activeRun`, which proves the submit was observed
for THIS run and no subsequent run-bound event has occurred.

This preserves the original repair's intent (accept late C10 of the
active run) while closing the cross-run authorization hole.
