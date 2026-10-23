# 02 — Exact-Epoch Causal Classification (R1)

## 2.1 Evidence availability — DECLARED INSUFFICIENT for the historical epoch

The ACT-supplied captures dated `2026-10-23` are **not present** in the
repository or in the known ClineMM `globalStorage` capture directory (that
directory contains no ClineMM extension directory at all — only
`dirac-run.dirac`, `emptyWindowChatSessions`, `state.vscdb`, `storage.json`).

Consequences, stated precisely:

- `FINAL_C9_IDENTITY` — **UNAVAILABLE_FROM_TRACE**
  (needs `submitId` for the seq=624 C9 from
  `continuation-cardinality-authority(20261023-131644)`).
- `ELM_DECISION_FOR_FINAL_ATTEMPT` — **UNAVAILABLE_FROM_TRACE**
  (needs the per-epoch Elm decision; only AGGREGATE counters were supplied,
  and §1.5 of the ACT forbids composing aggregates into an exact-epoch proof).
- `BCB_JOB_IDS_AFTER_OBSERVATION` / `BCB_COUNT_AFTER_OBSERVATION` —
  **UNAVAILABLE_FROM_TRACE**
  (needs `bcb-observation-unavailable-capture(6).jsonl`).
- `PENDING_PROMPT_AUTHORITY`, `SCHEDULED_CONTINUATION_STATE`,
  `RUNNING_OWNER_STATE` — **UNAVAILABLE_FROM_TRACE**.
- `FINAL_PHASE_WRITER` — **UNAVAILABLE_FROM_TRACE**
  (needs `turn-state-writer-provenance(20261023-131638)`; the only captures
  present are dated 2026-10-12 / 2026-08-29 and describe DIFFERENT incidents).

The §1.4 claim that "all five [held job IDs] were observed" is explicitly
**NOT promoted**: the BCB capture showing five held obligations predates the
reported observations, and the terminal-status response is not evidence of BCB
consumption. Both sub-claims (observation actually consumed; obligation
settled under the correct owner) remain `UNAVAILABLE_FROM_TRACE`.

Therefore this ACT does **not** assert an exact-epoch historical cause. It
instead establishes the defect class at the REAL production seam (R2), which
is the §5-authorized path, and states the historical cause as
`UNAVAILABLE_FROM_TRACE`.

## 2.2 Causal classification of the reproduced defect

Two INDEPENDENT defects, each at its own production boundary:

### L1 — Case B/A hybrid: BCB held, then continuation STRANDED

Classification: **`Case B — Continuation stranded`**, with the entry condition
`Case A — BCB held` cleared correctly.

Chain:

1. Five task-owned terminal obligations registered in the BCB
   (`recordNonNotifyTerminalObservation`).
2. `submit_and_exit` captured (C9). BCB admission HOLDS and registers
   `deferredCompletionBarrier` (epoch-bound).
3. Terminal-idle re-evaluation fires the bounded coalesced continuation
   listing all five jobIds — conservation is correct here.
4. The model observes four of five. Held set still non-empty; C10 correctly
   held (this is Case A behaving correctly).
5. The model observes the FIFTH and LAST. The held set becomes empty. The
   drain trigger now fires the re-evaluation; every TS predicate is
   satisfied, so the Elm completion authority is reached and HOLDs on
   `scheduled_continuation` — the coalesced continuation is still outstanding.
   The marker is re-registered; C10 is NOT committed.
6. The continuation is consumed. Its causal dependency clears.
7. **DEFECT:** no event re-drives `reevaluateDeferredCompletionBarrier`.
   The marker survives with every obligation predicate already false, and C10
   is **never attempted**. `legacyPhase` remains `streaming`, so the TaskHeader
   renders `BUTTON_CONFIGS.partial` (`secondaryAction: "cancel"`) forever.

Note the safety property held throughout: the Elm HOLD was respected at step 5.
The defect is NOT a bypass — it is a MISSING RE-EVALUATION after the hold's
dependency legitimately cleared.

### L2 — Case F: cancellation defect

Classification: **`Case F — Cancellation defect`**.

`sdk-task-control-coordinator.ts` early-returned on `!activeSession` before
`raiseCancelFence`, `setTurnPhase` and `postStateToWebview`. A Cancel against a
task view whose SDK session had gone away therefore produced NO lifecycle
transition: the committed webview state still said `streaming`, the Cancel
affordance persisted, and re-clicking re-entered the same no-op. The
DEFAULT_OFF `cancel-liveness-diagnostic` names this exact signature
`H-A = (req=1, acc=0, inv=0, cmp=0, pub=0)`.

### Cases explicitly excluded

| Case | Verdict | Why |
|---|---|---|
| C — Elm hold | NOT the defect | The Elm HOLD was honored; the defect is the missing re-evaluation AFTER it cleared. Bypassing the HOLD was never done and is forbidden. |
| D — Publication failure | EXCLUDED | No C10 was committed in epoch 18, so there was nothing to publish. A publication failure requires actual C10 evidence, which is absent. |
| E — Legitimate unfinished task | EXCLUDED | After step 6 no obligation and no active run remained. Completion was permitted and simply never attempted. |

## 2.3 Answers to the §4.1 required fields

```text
FINAL_C9_IDENTITY                 = UNAVAILABLE_FROM_TRACE
FINAL_AGENT_TURN_DONE_IDENTITY    = UNAVAILABLE_FROM_TRACE
BCB_MARKER_IDENTITY               = UNAVAILABLE_FROM_TRACE
BCB_COUNT_AFTER_OBSERVATION       = UNAVAILABLE_FROM_TRACE
BCB_JOB_IDS_AFTER_OBSERVATION     = UNAVAILABLE_FROM_TRACE
PENDING_PROMPT_AUTHORITY          = UNAVAILABLE_FROM_TRACE
SCHEDULED_CONTINUATION_STATE      = UNAVAILABLE_FROM_TRACE
RUNNING_OWNER_STATE               = UNAVAILABLE_FROM_TRACE
ELM_DECISION_FOR_FINAL_ATTEMPT    = UNAVAILABLE_FROM_TRACE
FINAL_C10_EFFECT                  = NEVER ATTEMPTED (reproduced at the real seam)
FINAL_PHASE_WRITER                = UNAVAILABLE_FROM_TRACE
```

"Did the final `agent_turn_done` cause a barrier reevaluation and did that
reevaluation reach the Elm gate?" — At the real seam: the reevaluation DID run
and DID reach the Elm gate (proved by `h.elm.holds` containing
`scheduled_continuation`). What was missing was the NEXT reevaluation, after the
hold's dependency cleared.

## 2.4 Smallest necessary capture (had evidence been insufficient to proceed)

A single file would have closed the historical epoch: a per-epoch,
identity-correlated `continuation-cardinality-authority` capture containing
`{sessionId, taskId, epoch, submitId, completionId}` for the seq=618..625 range,
plus the Elm decision record for that exact epoch. Recorded so a successor can
qualify the LIVE half without re-deriving the structural cause.
