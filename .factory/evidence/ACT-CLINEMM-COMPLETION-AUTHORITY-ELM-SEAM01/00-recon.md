# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01 — RECON

## AUTHORITY_INPUT_BOUNDARY

The pre-effect decision site is the completion-commit guard in
`SdkSessionEventCoordinator`. Two convergent sites share one effect:

1. **Initial-dispatch C10 commit seam**
   `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1377-1442`
   - L1377: `if (outstandingAutonomousWork || ownerStillRunningForC10 || unconsumedOwnedTerminalResultsForC10 > 0 || suppressOriginatingCompletion)` decides whether to register the deferred-completion-barrier marker OR proceed.
   - L1431-1440: `captureContinuationCardinalityAuthorityRecord({stage: "task_completion_committed", ...completionId: \`completion-${sessionId}-${++this.nextCompletionCommitEventId}\`})` — the CCARD C10 record.
   - L1441: `this.options.setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")` — the AUTHORITATIVE UI phase commit effect.

2. **Deferred-completion re-entry seam**
   `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:607-773`
   `reevaluateDeferredCompletionBarrier()` — checks the same eight predicates; on success clears the marker and invokes:
   - L772: `this.options.setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")` — same effect.

Both sites converge on the same effect: `setTurnPhase("completed", ..., "session-event-turn-complete-completed")`.

## CURRENT_TS_DECISION

Eight stacked TS predicates; the effect fires only when ALL are false / zero:

| Predicate                                          | Where      | Stops commit when                                    |
|----------------------------------------------------|------------|------------------------------------------------------|
| `pendingPromptAuthorityUnknown`                    | L635       | `unavailable !== true`                               |
| `pendingPromptsKnown > 0`                          | L636       | count > 0                                            |
| `activeNotifyCount > 0`                            | L637       | count > 0                                            |
| `perJobOutstandingNotifyWork`                      | L646-666   | true                                                 |
| `ownerStillRunning` (BCB01)                        | L680       | `hasRunningBackgroundJobForOwner(...) === true`      |
| `unconsumedOwnedTerminalResultCount > 0` (BCB01-c01)| L695      | count > 0                                            |
| `outstandingAutonomousWork`                        | L668       | any of the above                                     |
| `perJobSuppressOriginatingCompletion` (BNCA)       | L647/L759  | true                                                 |

For the C10 dispatch site (L1377-1423): same set on lines 1377-1382.

## EFFECT_BOUNDARY

`setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")` at L772 (reentry) and L1441 (initial dispatch).

This is the AUTHORITATIVE UI phase commit. It drives `TurnStateTracker.setWithWriter("completed", ...)` via the SdkController adapter.

## CURRENT_CCARD_OBSERVATION_BOUNDARY

The Elm shadow observer hooks into the CCARD helper `captureContinuationCardinalityAuthorityRecord` at `apps/vscode/src/sdk/continuation-cardinality-authority.ts:261-320`.

For the C10 commit record (L1431-1440 in coordinator), the helper:
- (a) appends to the bounded buffer
- (c) calls `observeElmShadowFireAndForget(rec)` — the shadow's `enqueueRecord` is sync and immediately starts dispatching to the Elm kernel for that session

Crucially: the Elm kernel session is per-sessionId, persisted on a `Map<string, ShadowKernelSession>` keyed by `record.sessionId`. Every prior event for the same sessionId has been forwarded to the same kernel. By the time the C10 record is captured at L1431, the kernel's outbound state carries the full completion model.

## SAFE_PRE_EFFECT_INPUTS

At the moment L1441 is about to fire:
- the Elm kernel's outbound state for this `sessionId` is fully updated to include the `task_completion_committed(completionId)` event that was just dispatched
- `kernelHandle.drainOutbound()` returns the last `state` record carrying `encodeModel newModel`
- `encodeModel` writes: `{task, activeRun, commitReadyRun, committedCompletion, presentedCompletion, jobs, prompts, runs, promptEntries, continuationEntries}`
- The Elm `completionAuthorized model` (= `List.isEmpty (computeHoldReasons model)`) is computable from this state.

## LIVE_UNOBSERVABLE_INPUTS

None. The kernel is fully observable from TS via `kernelHandle.send` + `kernelHandle.drainOutbound`.

## ARCHITECTURE NOTES

The Elm kernel already has `completionAuthorized : Model -> Bool` (Authority.elm:599). The outbound port already sends `encodeModel newModel` (Main.elm:84-92). The shadow observer already populates the per-session kernel synchronously.

What is needed is the authority bridge:
1. A new TS module that, given a sessionId, queries the per-session kernel synchronously and returns the closed decision.
2. A new env-gated enable seam (mirror of the shadow profile).
3. A new constructor option on `SdkSessionEventCoordinatorOptions` so dependency injection at the production seam is the only test seam.
4. Default `getElmCompletionAuthorityDecision = () => ({kind: "authorize"})` so OFF path is byte-identical.

## RED DESIGN

The RED test:
- Real `SdkSessionEventCoordinator` with complete harness.
- `getElmCompletionAuthorityDecision: () => ({kind: "hold", reason: "test_red"})` at construction.
- Scenario where all eight TS predicates evaluate to "commit" (no holds).
- Without Elm-wired option, `setTurnPhase` called ONCE.
- With Elm-wired option, `setTurnPhase` called ZERO times → proves Elm owns the decision.

Inverse of GREEN: GREEN injects `authorize`; RED injects `hold`.

## NOTES

- Elm vendor JS (sha=034f70b7...) already has `completionAuthorized` exposed indirectly via the outbound model's state.
- We are NOT extending the Elm wire contract.
- We are NOT adding any new Msg tag.
- We are NOT modifying `Authority.elm` or `Main.elm`.
- The Elm kernel source SHA must remain unchanged for `ELM_SOURCE_CHANGED=false`.
