# R0 — Production ownership map

**Incident:** `1792958891945_k2wrd` / epoch 12
**ENTRY_HEAD:** `2754314dbe2e9bcd1053019daf9c744d12c7ce97`
**Scope:** inspection only. No production change.

## The chain under investigation

```
runtime termination
  -> completion/BCB admission
  -> actual phase writer
  -> host projection
  -> webview phase
  -> button configuration
```

## Seam-by-seam

| # | Seam | File:line | Behaviour in the LIVE run |
|---|------|-----------|--------------------------|
| 1 | Runtime termination | `sdk/packages/core/src/runtime/host/local-runtime-host.ts:2351` | `completeAbortedInteractiveTurn` dispatches `done(reason:"aborted")`; `state.status = "aborted"` (`sdk/packages/agents/src/agent-runtime.ts:1712`). The runtime is DEAD afterwards. |
| 2 | Translator turn-end | `apps/vscode/src/sdk/message-translator.ts:2123-2192` | `done` sets `turnComplete = true`. `reason === "error"` sets `errorSeen`; `reason === "aborted"` does NOT. No completion row is synthesized. |
| 3 | C9 capture | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3548` | Fires when `wasTerminalResponseCommittedThisTurn()` — the LIVE run captured **two** C9 records. |
| 4 | BCB admission | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3742-3748` | `heldObligationForC10` (LIVE: 4 unconsumed terminal results / 4 jobIds) → the C10 commit is HELD. |
| 5 | BCB hold branch | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3781-3787` | Registers `deferredCompletionBarrier` and **returns WITHOUT any phase write**. This is the load-bearing gap: the hold path produces NO terminal projection. |
| 6 | Actual phase writer (LIVE) | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3279` | `pending_prompt_submitted` → `setTurnPhase("streaming", …, "session-event-pending-prompt-submitted")` — **UNCONDITIONAL**. The LIVE `turn-state-writer-provenance.jsonl` confirms this writer produced the final `streaming` (seq 132499). |
| 7 | Deferred-continuation release | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1110-1271` | `reevaluateDeferredContinuation` releases `awaiting_followup` when the owner has no running job. Requires a `deferredContinuation` marker (a DIFFERENT marker from the BCB marker). |
| 8 | Deferred-barrier release | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1759-2242` | `reevaluateDeferredCompletionBarrier` re-runs the predicate chain; on a hold it returns WITHOUT a phase write. On release it commits `completed` through `checkElmCompletionAuthority`. |
| 9 | Elm authority | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1432-1524` | `authorize` → commit; `hold` / `failure` → suppress. The LIVE counters show `hold: 5`, `failure: 4`, `authorize: 0` — **no authorize ever fired**, so no C10 was possible. |
| 10 | TurnStateTracker | `apps/vscode/src/sdk/turn-state-tracker.ts:96-153` | The single authoritative phase store. `setWithWriter` stamps the writer provenance. |
| 11 | Host projection (Elm) | `apps/vscode/src/sdk/SdkController.ts:6329-6355` → `apps/vscode/elm/task-header-orchestration/src/Orchestration.elm` | The Elm kernel is the SOLE production TaskHeader authority. LIVE: `legacy/streaming`. |
| 12 | Webview phase | `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:116-156` | Applies the projection, fenced by `seq`. LIVE: extension push and webview commit MATCH at state version 132749. |
| 13 | Button configuration | `apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts:409-459` | `streaming` → `BUTTON_CONFIGS.partial` → `secondaryText: "Cancel"`, `secondaryAction: "cancel"`. LIVE capture confirms `Cancel`. |

## Which step is missing / deliberately suppressed

**Step 5 is the missing step.** The BCB hold path (`sdk-session-event-coordinator.ts:3781-3787`)
registers the deferred marker and returns **without any phase write**. The BCB HOLD is
CORRECT (the completion must not commit while an obligation remains) — but a HOLD that
leaves the host phase at an ACTIVE value (`streaming`) has no truthful projection. The
host therefore continues to claim "work in progress".

**Step 6 is the unguarded step.** `pending_prompt_submitted` writes `streaming`
unconditionally — it does not consult the runtime's liveness, the BCB marker, or the
deferred continuation. It is the LAST writer in the LIVE run, so it is the proximate
cause of the surviving `streaming` seq.

**The projection steps (11-13) are NOT defective.** They faithfully render the host
state they are given (see `02-r1-controlled-red.md`, R2-01..R2-04).

## Classification against the five candidate causes

| Candidate | Verdict | Evidence |
|-----------|---------|----------|
| 1. A legitimately held C10 | **PARTLY TRUE, but not the defect.** | The BCB hold IS legitimate (4 real held jobIds, LIVE `bcb-observation-unavailable-capture.jsonl`). But a legitimate hold must still publish a TRUTHFUL NON-RUNNING projection. The LIVE projection claims ACTIVE work. |
| 2. A missing terminal phase transition | **YES — THIS IS THE DEFECT.** | The BCB hold path writes no terminal phase (`sdk-session-event-coordinator.ts:3781-3787`); the runtime is dead so no later event can. |
| 3. A stale or invalid presentation binding | **NO.** | `publicationShadowBinding = UNBOUND` is the standing classification for every shadow publication (`apps/vscode/src/sdk/activity-publication-v1.ts:148`). R2-04 proves that a BOUND stamp yields `shadow/completed`. The binding is not stale — it is correctly UNBOUND, and the Elm UNBOUND-demotion guard correctly refuses to let an UNBOUND shadow demote an ACTIVE legacy phase. |
| 4. An undelivered / unconsumed continuation | **NOT THE CAUSE — but a REAL RESIDUE.** | The LIVE delivery counters report `delivered: 1` with `pendingPromptEnqueuedObserved: null` — the enqueue was NOT independently observed. The LIVE `continuation-cardinality-authority.jsonl` DOES record `pending_prompt_enqueued` (seq 2139) and `pending_prompt_dequeued` (seq 2141), so the prompt WAS enqueued and drained. The continuation was consumed; it did not rescue the phase. |
| 5. A later valid continuation that had not yet occurred | **NOT EXCLUDED — this is the residual.** | The LIVE capture ends at 1792961475571 with the runtime `aborted`. A later continuation could legitimately re-enter `streaming`. But it could not have occurred before the capture ended: the runtime was already `aborted` from 1792961416077 (the FIRST captured push), i.e. 59 seconds before the capture end. The `aborted` status is therefore NOT a post-terminal artifact of the capture window. |

## The `aborted` discriminator (framework termination vs explicit user cancellation)

- **Explicit user cancellation** → `SdkController.cancelTask()` (`SdkController.ts:4293`)
  writes `resumable` FIRST ("Fence first: mark resumable before aborting"), then aborts.
  The LIVE provenance shows NO `controller-cancel-task` writer for task
  `1792958891945_k2wrd` — the task was never user-cancelled.
- **Framework termination** → `done(reason:"aborted")` reaches the coordinator with no
  phase write on the BCB-hold path.
- The LIVE run therefore suffered FRAMEWORK termination, and the coordinator has no
  `aborted`-reason branch (R1-06 proves `reason:"error"` reaches `error` while
  `reason:"aborted"` does not).

## LIVE provenance (frozen)

From `~/.vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm/turn-state-writer-provenance.jsonl`:

```
1792961350743  session-event-turn-complete-resumable-straggler-preserve  streaming(89522)      -> awaiting_followup(132079)
1792961350744  session-event-pending-prompt-submitted                    awaiting_followup(132079) -> streaming(132080)
1792961423228  session-event-pending-prompt-submitted                    streaming(132080)     -> streaming(132499)
```

From `continuation-cardinality-authority.jsonl` (same session):

```
1792961423166  seq 2138  submit_and_exit_seen          (C9 #1)
1792961423220  seq 2139  pending_prompt_enqueued
1792961423227  seq 2140  agent_turn_done
1792961423228  seq 2141  pending_prompt_dequeued
1792961423229  seq 2142  continuation_scheduled
1792961423229  seq 2143  execute_turn_prelude_enter
1792961475412  seq 2146  submit_and_exit_seen          (C9 #2)
1792961475479  seq 2147  agent_turn_done
                                                    task_completion_committed: 0
```

The final `agent_turn_done` at 1792961475479 is 67 ms before the capture ends at
1792961475571 — and it produced NO phase write, because the BCB held the completion and
the hold path writes no phase.
