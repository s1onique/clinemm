# §10 — CWRA-05: post-C10 failure modes

## Question

Can production have already emitted `task_completion_committed` and then encounter a failure that semantically means the task should not have been considered complete?

## Analysis: NO injectable semantic failure seam between C10 and C8

The C10->C8 interval (51ms in LIVE) contains exactly these production seams:

| Seam | Failure mode | Can it invalidate completion? |
|---|---|---|
| `setTurnPhase("completed", ...)` | TurnPhaseTracker write (in-memory state). A throw here would bubble up via `handleSessionEvent`'s try/finally, but the write is unconditional — it succeeds or the coordinator throws (which propagates to the host's `executeTurn` rejection, killing C8 too). | NO — the write itself has no failure mode that aborts C10 without also aborting C8. |
| `sessions.setRunning(false)` | Boolean flag flip. Cannot throw. | NO. |
| `taskHistory.updateTaskUsage(...)` (fire-and-forget) | Persistence call. Throws are caught by `.catch((error) => Logger.error(...))` at sdk-session-event-coordinator.ts:1727. The error is logged but does NOT abort `handleSessionEvent` (fire-and-forget contract). | NO — the failure is silently logged; the coordinator continues; C10 is still emitted; C8 still fires. |
| `postStateToWebview()` (fire-and-forget) | Webview post. Throws are caught by `.catch((err) => Logger.error(...))` at sdk-session-event-coordinator.ts:1744. | NO — same as above. |
| `leaveExtensionHostHotloopHandleSessionEvent()` | Depth-tracker exit. No-op when diagnostic OFF. | NO. |
| `eventBridge.dispatchAgentEvent(...)` (the Promise that awaited the `done` event propagation) | The Promise resolves with the agent event. If the agent event bridge throws, the host's `executeTurn` rejects — but this happens BEFORE C10 (the bridge's dispatchAgentEvent is what CAUSES the C10 capture). So a failure here aborts C10, not the other way around. | NO — the failure mode is BEFORE C10, not after. |
| `executeTurn()` return | The host's `await this.executeTurn(...)` resolves to the agent result. If the agent's `run()` throws, C10 does NOT fire (the `done` event was never dispatched). If the agent's `run()` succeeds and `eventBridge.dispatchAgentEvent` resolves, C10 fires. If `eventBridge.dispatchAgentEvent` resolves but `executeTurn` rejects AFTER (e.g. session shutdown race), C10 has already fired and C8 will not. This is the ONLY semantic failure mode, but it is a HOST race, not a semantic completion invalidation. | NO — the completion was correct (the agent DID call attempt_completion; the response was committed). The race produces an inconsistent CCARD ring (C10 without C8) but does NOT invalidate the semantic completion. |

## Conclusion

**No meaningful failure point exists in the C10->C8 interval that can invalidate completion.** All failure modes are either:
- Logged-and-suppressed (fire-and-forget)
- Diagnostic-only (no-op when OFF)
- Synchronous bookkeeping that does not affect the semantic state

The only failure mode that produces an inconsistent CCARD ring is the **post-C10 race where the host rejects after `eventBridge.dispatchAgentEvent` resolved**. But this race:
- Does not change the fact that the agent called `attempt_completion` and the response was committed.
- Does not invalidate the `setTurnPhase("completed", ...)` write (or it's already in the TurnPhaseTracker).
- Does not spawn any new work, prompt, or continuation.

## CWRA-05 verdict: NOT_APPLICABLE (no injectable semantic seam)

**Outcome: H1_ELM_TOO_STRICT strongly supported.** The C10->C8 tail is deterministically bookkeeping-only. No semantic completion can be invalidated by any post-C10 event.

Bridge test evidence: `apps/vscode/src/sdk/__tests__/completion-authority-commit-while-run-active-discriminator01.c24-c-bridge.test.ts` test `CWRA-05` PASS (zero `throw`, `failSession`, `abort`, `revert`, `rollback`, `cancel` keywords in the C10->C8 interval).

## Important corollary

The Elm kernel, by treating `activeRun /= Nothing` as a hold, is enforcing the **invariant** that "you cannot commit completion while a run is still semantically active". The question for the discriminator is: **is "agent_turn_done not yet received" equivalent to "the run is semantically active"?**

This ACT's evidence (the C10->C8 interval is exclusively bookkeeping; no semantic activity remains) demonstrates that "agent_turn_done not yet received" is NOT equivalent to "semantically active". The agent's work was complete at C10 (the attempt_completion tool's response was committed; the BCB barrier passed; the deferred continuation machinery did not engage; the `done` event was dispatched). C8 is a downstream bookkeeping signal that arrives 51ms later.
