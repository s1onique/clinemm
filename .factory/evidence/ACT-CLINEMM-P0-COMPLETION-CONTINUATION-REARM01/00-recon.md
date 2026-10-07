# ACT-CLINEMM-P0-COMPLETION-CONTINUATION-REARM01 — RECON

## LIVE_FAILURE

- task/session: `1791358295080_gno3g`
- submit_and_exit_seen: **4** (K's submit_and_exit paired with held>0, plus 3 more)
- held terminal observations remaining: **3** at the time of the lost re-arm
- continuation delivery: 2 successful, 0 rejected (callback/send paths healthy)
- Elm completion authority: 1 authorize, 1 hold, 0 failure, 0 fallbackUsed
- `dedupeSuppressed = 4` (every duplicate request blocked)
- `dedupePermitted = 2` (K and the unrelated first send)
- `enqueueCompletionContinuationInvoked = 2`
- `lastStopReason = "dedupe_suppressed"`
- `task_completion_committed` for the affected task: **ABSENT**
- Live chronology tail (post-K's terminal-idle):
  ```
  submit_and_exit_seen (K)
  → pending_prompt_enqueued
  → agent_turn_done
  → pending_prompt_dequeued
  → continuation_scheduled
  → continuation_started
  → submit_and_exit_seen   ← K's own submit_and_exit with held>0
  → agent_turn_done
  → [NO task_completion_committed]
  ```

## CLASSIFICATION

**Type C (lost re-arm) on the completion-continuation dedupe seam.**

The current continuation K runs, observes some of its held jobIds via command_status, but cannot resolve the held count to 0 (e.g. one of the jobs returned a non-final status, OR an observe-only terminal arrives after the K prompt drained, OR the model simply judged one more observation necessary). K reaches `submit_and_exit` again. The BCB01 §0.1 barrier predicate still holds (`unconsumedOwnedTerminalResultsForC10 > 0`). The deferred-completion-barrier marker is re-registered. The bounded finalization-authority trigger at `sdk-session-event-coordinator.ts:1832` invokes `enqueueCompletionContinuationIfHeld(...)`.

## FIRST_DIVERGENT_STAGE

**`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1234-1241`** — the dedupe check in `enqueueCompletionContinuationIfHeld`:

```ts
const continuationSessionEpoch = `${activeSessionId}|${taskId ?? "(none)"}|${epoch}`
if (this.lastCompletionContinuationSessionEpoch === continuationSessionEpoch) {
    recordDedupeSuppressed()
    return Promise.resolve({ kind: "already_sent", continuationSessionEpoch })
}
```

The dedupe key is `${activeSessionId}|${taskId}|${epoch}`. The minter's `epoch` only advances on task boundaries (clear / history open / reinit / cancel — see `apps/vscode/src/sdk/message-id-minter.ts:65`), NOT on `agent_turn_done`. So continuation K and the SUCCESSOR continuation K+1 (fired from K's submit_and_exit_seen → barrier re-register → enqueueCompletionContinuationIfHeld) share the SAME dedupe key. The trigger fires the dedupe lookup; the marker is still pinned from K's earlier send; K+1's request is suppressed → no successor is enqueued.

## ROOT_CAUSE

**Dedupe lifetime too broad.** The single-string dedupe was designed to coalesce TRIPLE duplicate triggers within the SAME turn cycle. But the production seam needs to coalesce within the SAME CURRENT RUN, not within the same epoch. The marker survives across `agent_turn_done` boundaries, which is wrong: when K finishes, K+1 (the next logical turn) must be able to enter.

Concretely: when K's `agent_turn_done` fires (line 1138 → reevaluateDeferredCompletionBarrier), the conservation checks hold (count > 0), the marker is re-registered (line 1052), and the reevaluation returns without advancing any "generation" counter. The dedupe marker is still pinned from K's original send. K's next `submit_and_exit_seen` (still within the same epoch) recomputes the same key and finds it equal → suppressed.

## REPAIR

The bounded semantic change: **clear `lastCompletionContinuationSessionEpoch` on every `agent_turn_done`** (since the dedupe is intended to suppress *during* a single continuation's lifecycle, and `agent_turn_done` marks its end). Equivalent: advance a "continuation generation" counter on `agent_turn_done` and include it in the key.

The chosen shape (minimal change): clear `lastCompletionContinuationSentForTesting` at the entry of `notifyAgentTurnDone` AND when the deferred-completion-barrier marker is freshly registered (i.e., a new submit_and_exit_seen has just re-pinned the barrier). Both paths signal "the current run has finished" → the dedupe is no longer authoritative.

## ELM_SOURCE_DELTA

NONE. The Elm completion authority operates on the held-state / activeRun / completion-authority decision. The bug lives at the TS dedupe seam; the Elm authority correctly returns authorize or hold for each consult. No Elm-side changes in this ACT.

## TS_AUTHORITY_REINTRODUCED

NO. The repair is a bounded dedupe-lifetime change. It does NOT introduce any new authority or new logic — it only advances the dedupe owner generation when the current continuation has finished.

## DEDUPLICATION

PRESERVED. The repair is specifically designed to preserve the BCB-34 invariant ("two same-epoch trigger calls within a single reevaluation → only the first fires"). The dedupe continues to suppress duplicates within a single run.

## SUCCESSOR_OBLIGATION

RETAINED. The continuation K's `submit_and_exit_seen` with held>0 will now produce exactly one K+1 successor. The successor obligation survives K's `agent_turn_done` (conservation REARM-02).

## DOUBLE_COMPLETION

DISPROVEN by REARM-05 (held drains to 0 → no K+1 → completion may commit) and REARM-12 (chain eventually drains → no K+3 once held=0).

## focused tests (RED)

- 3 RED failures:
    - REARM-01: K's submit_and_exit with held=3 must enqueue K+1 (LIVE defect)
    - REARM-02: K's agent_turn_done must preserve re-arm obligation
    - REARM-12: K → K+1 → K+2 chain eventually drains
- 4 PASS (control / conservation):
    - REARM-05: held drains to 0 → no K+1 (already correct)
    - REARM-AB-01: ablation — neutralise dedupe ownership → K+1 IS enqueued (proves dedupe is the cause)
    - REARM-CONS-01: two same-epoch enqueue calls within one K run → only one fires (BCB-34 invariant)
    - REARM-CONS-04: epoch supersession still clears the dedupe