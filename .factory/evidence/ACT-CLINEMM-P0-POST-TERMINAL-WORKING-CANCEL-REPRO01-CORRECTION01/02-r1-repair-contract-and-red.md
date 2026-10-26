# R1 — The bounded repair, the safety RED, and the exact inversion

## The bounded repair contract (as proposed by the predecessor ACT)

The predecessor's board entry proposed exactly two boundaries. Both are implemented.

```text
1. Hold path publishes a truthful non-running phase.
   At the BCB hold site, publish the EXISTING `resumable` phase (the
   established "the run was abandoned" affordance already used by the
   containment-failure hold at `:1259` and by the cancel path).
   NO new phase. NO `completed`. The BCB HOLD, the Elm authority, the
   containment guards and the epoch identity triple are all untouched.

2. The pending-prompt writer does not re-assert `streaming` over a
   terminal phase.
   NO automatic `completed`. NO new protocol field. NO React side effect.
```

## What was ACTUALLY implemented (and the one place the proposal was refined)

### B1 — the BCB hold path publishes the EXISTING `resumable` phase

**Production site:** `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`,
immediately after the deferred-completion-barrier marker registration in the
BCB hold block (the block that begins at the `if (outstandingAutonomousWork ||
ownerStillRunningForC10 || heldObligationForC10 || suppressOriginatingCompletion
|| unresolvedContainmentFailuresForC10.length > 0)` predicate).

```ts
this.options.setTurnPhase?.("resumable", undefined, "session-event-bcb-hold-resumable")
```

**Why `resumable` and not something else:** it is the EXISTING, established
production affordance for "the run was abandoned before it produced a terminal
response, so Resume is the honest next action". The same phase is published by:

- the containment-failure hold (`session-event-turn-complete-containment-failed-resumable`),
- the cancel path (`task-control-cancel-no-active-session`).

The webview button map (`resumable -> BUTTON_CONFIGS.resume_task`) and the Elm
TaskHeader projection already know it. **NO new phase is introduced.**

**What B1 explicitly does NOT do:**

- It does NOT write `completed`. The Elm completion authority is NOT consulted on
  the hold path, and no C10 `task_completion_committed` record is emitted.
- It does NOT clear, weaken or bypass the BCB HOLD.
- It does NOT touch the containment guards, the Elm authority, or the epoch
  identity triple.
- The barrier's own release path (`reevaluateDeferredCompletionBarrier`) remains
  the ONLY writer of a terminal phase for the held obligation. When the barrier
  later AUTHORIZEs the held completion, it overwrites this `resumable` with
  `completed`.

### B2 — the `pending_prompt_submitted` writer does not re-assert `streaming`

**Production site:** the `pending_prompt_submitted` branch of
`handleSessionEvent`, at the `session-event-pending-prompt-submitted` write.

**The discriminator is the EXISTING BCB barrier authority, not the phase and not
the runtime status.** The new private helper
`isDeferredCompletionBarrierLiveFor(sessionId)` consults the SAME identity triple
(`sessionId`, `taskId`, `epoch`) that the barrier's own re-evaluation path uses.
A marker for a different session, a different task, or a superseded epoch does
NOT hold the active turn, so the guard cannot leak across a task/session/epoch
replacement.

```ts
private isDeferredCompletionBarrierLiveFor(sessionId: string): boolean {
    const marker = this.deferredCompletionBarrier
    if (!marker) return false
    if (marker.sessionId !== sessionId) return false
    const taskId = this.options.getTask?.()?.taskId
    if (marker.taskId !== taskId) return false
    const currentEpoch = this.options.messageTranslatorState.getMinter().epoch
    return marker.epoch === currentEpoch
}
```

**Why the phase and the runtime status are NOT valid discriminators** (this is
the load-bearing refinement of the predecessor's proposal, and it is why the
proposal's wording "does not re-assert `streaming` over a terminal phase" was
NOT implemented literally):

- **The phase alone cannot discriminate.** The PINNED T-08 contract
  (`lifecycle-transition-contract-verifier.ts:651-654`, verified by
  `turn-phase-contract01.tpc01.test.ts`) REQUIRES `pending_prompt_submitted` to
  activate `streaming` from FOUR distinct terminal source states:
  `awaiting_followup` (T-08), `completed` (T-08a), `error` (T-08b) and
  `resumable` (T-08c). A "do not clobber a terminal phase" rule would break
  three pinned edges. The barrier-hold discriminator leaves all four intact.
- **The runtime status alone cannot discriminate.** The LIVE carrier trace shows
  a NEW runtime iteration beginning ~53 ms after the harmful write, so a stale
  `aborted` reading is not a reliable discriminator.

The marker is deliberately NOT cleared by `pending_prompt_submitted`, so the
guard is checkable AT that seam with no new state.

## The REFUSAL to implement the proposal literally (R1-06)

The predecessor's proposed boundary 2 was worded as "does not re-assert `streaming`
over a terminal phase". Implemented literally, that breaks the PINNED T-08a
contract (`completed -> streaming` on `pending_prompt_submitted`), which is
verified by `turn-phase-contract01.tpc01.test.ts` (60 tests).

The correction's own first-draft RED suite asserted that literal reading
(R1-06: "a `pending_prompt_submitted` does NOT clobber an existing `completed`
phase"). **That assertion was CORRECTED, not the production code.** The
corrected suite carries:

- `PTWCR01C01-R1-06` — the BCB-hold guard does NOT clobber an existing
  `completed` phase (the guard is scoped to the live-barrier case), and
- `PTWCR01C01-R1-06b` — the PINNED T-08a contract is PRESERVED: a
  `pending_prompt_submitted` over `completed` with NO live barrier still
  activates `streaming`.

This is the only place where the CORRECTION01 repair contract deviated from the
predecessor's proposal wording, and the deviation is REQUIRED by a pinned
contract. It is recorded here because the deviation is load-bearing, not
incidental.

## The safety RED that had to go GREEN

`apps/vscode/src/sdk/__tests__/post-terminal-working-cancel-correction01.ptwcr01c01.test.ts`
— 9 tests, all GREEN.

| ID | Assertion | Purpose |
|---|---|---|
| R1-01 | the phase after the LIVE sequence is `resumable`, NOT `streaming` | the core RED |
| R1-02 | ZERO `completed` commits, ZERO C10 records | negative witness for premature `completed` |
| R1-03 | the deferred marker is PRESERVED | the hold is a HOLD, not a release |
| R1-04 | the projection seams select `host/resumable`; the button is NOT `Cancel` | the user-visible symptom |
| R1-05 | a LEGITIMATE new turn still activates `streaming` | the repair does not suppress activation |
| R1-06 | the BCB-hold guard does not clobber `completed` | the guard is narrowly scoped |
| R1-06b | the PINNED T-08a contract is PRESERVED | the proposal's literal reading is refused |
| R1-07 | a STALE session notification cannot alter the current task | the epoch/session guard |
| R1-08 | a provider ERROR still reaches the `error` phase | the repair does not mask real failures |

## The RED suite inversion (the predecessor's file, reconciled in place)

The predecessor ACT committed its RED REPRODUCTION suite as a SEPARATE commit
(`674bdd43b`, `PASS_P0_RED_REPRODUCED`). Its assertions stated that the defect
was PRESENT. The repair inverts them, so the suite was **reconciled in place**:
the test IDs and their causal roles are PRESERVED, and only the asserted OUTCOME
changes, from "the defect is present" to "the defect is absent".

The precedent is the sibling ACT `ACT-CLINEMM-P0-POST-TERMINAL-LIFECYCLE-LIVENESS01`
(`cb39c81e4`), whose RED suite was written to flip green with its repair.

Inverted assertions:

| ID | Before (RED) | After (GREEN) |
|---|---|---|
| R1-01 | phase is `streaming`; NO terminal phase; last writer is the pending-prompt writer | phase is `resumable`; the pending-prompt writer committed NOTHING; the last writer is `session-event-bcb-hold-resumable` |
| R1-06 | the aborted runtime is left at `streaming` | the aborted runtime is at `resumable` and NOT at `error` (the `error` CONTROL is unchanged) |
| R3-02 | the hold produces NO terminal phase at all | the hold produces ONLY `resumable` and NEVER `completed` / `error` / `awaiting_followup` |
| R3-03 | after a conservative re-evaluation the phase is STILL `streaming` | after a conservative re-evaluation the phase is STILL `resumable` and STILL no completion phase |

The R3-02 inversion is STRONGER than the original: the original forbade ALL
terminal phases, the repaired form forbids every COMPLETION phase and REQUIRES
the truthful `resumable`.

## The negative witness for premature `completed` — carried forward and still GREEN

- `PTWCR01C01-R1-02` — ZERO `completed` commits, ZERO C10
  `task_completion_committed` records, ONE C9 `submit_and_exit_seen`.
- `PTWCR01-R1-02` / `PTWCR01-R1-05` (predecessor suite, unchanged) — no C10 and
  no `completed` under ANY Elm verdict while the hold is present.
- `PTWCR01-R3-04` (predecessor suite, unchanged) — the release path commits
  exactly one C10 only after the obligation is consumed, through the Elm
  authority.
