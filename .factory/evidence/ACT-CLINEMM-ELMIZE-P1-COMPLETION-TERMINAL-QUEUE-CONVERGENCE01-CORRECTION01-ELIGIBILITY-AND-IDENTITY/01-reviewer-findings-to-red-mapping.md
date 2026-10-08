# ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY — Reviewer Findings to RED Mapping

This artifact maps each factory-reviewer P0 finding on the predecessor ACT to its executable RED test in `apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts`.

## P0 #1 — Eligibility-predicate inversion → CTQC-02-CORR01

| Field | Value |
|---|---|
| Reviewer finding | The bounded host correlation guard publishes `observation_unavailable` BEFORE checking the original held-obligation and suppression predicates. A non-observation-related hold can be falsely classified as blocked. |
| Required correction | Preserve the original eligibility predicate first; classify observation capability only inside the branch where a coalesced held-result continuation would otherwise be justified. |
| RED test | `CTQC-02-CORR01: eligibility — non-held BCB block with command_status unavailable => NO observation_unavailable publication, marker reason stays undefined` |
| Staging | `initialHeldIds: []` (no held terminal observations); `initialPendingPrompts: 1` (so `outstandingAutonomousWork === true`); `initialLiveTools: ["submit_and_exit"]` (no `command_status`). |
| Expected | `getMarkerReason() === undefined`; `blockedOutcomeObservationUnavailable` counter unchanged; `sendLog.length === 0`. |
| Pre-fix behavior | The bounded guard publishes `observation_unavailable` because the BCB block was entered (via `outstandingAutonomousWork` from pending prompts) and the guard is not gated on the eligibility predicate. The marker is stamped with `reason: "observation_unavailable"` and the counter increments. |
| Post-fix behavior | The bounded guard is gated on `eligibleForCoalescedContinuation = unconsumedOwnedTerminalResultsForC10 > 0 && !suppressOriginatingCompletion`. With no held terminal observations, `eligibleForCoalescedContinuation === false` and the guard is never consulted. The marker has no reason. The counter is unchanged. |
| Production site | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2700-2713` (the new `if (eligibleForCoalescedContinuation) {` wrapper around the existing `canObserveHeldResults === false` branch). |

## P0 #2 — Blocked reason crosses an epoch boundary → CTQC-03-CORR01

| Field | Value |
|---|---|
| Reviewer finding | The barrier's `reason` is copied across BCB re-registration without verifying the originating obligation identity (sessionId, taskId, epoch). Old blocked state can contaminate a new epoch/task. |
| Required correction | Preserve the reason only while the original correlated obligation remains unchanged. A new epoch must not inherit the old verdict merely because a previous marker exists. |
| RED test | `CTQC-03-CORR01: identity — K is blocked, then K+1 with a new held set => K+1 marker has no inherited reason, K+1 publishes its own observation_unavailable` |
| Staging | `initialHeldIds: SEVEN_HELD_IDS`; seed a marker with `reason: "observation_unavailable"` at epoch K; `bumpEpoch()` to advance to K+1; `setHeldJobIds(NEW_HELD_IDS)` to set a new held obligation; trigger a BCB cycle. |
| Expected | After the trigger, the marker's epoch is `> K`; the marker's reason is `observation_unavailable` (because K+1's bounded guard JUST published K+1's verdict — the previous fix's pre-fix behavior would skip publication because the reason was inherited); the `blockedOutcomeObservationUnavailable` counter increments by exactly 1; `sendLog.length === 0`. |
| Pre-fix behavior | The previous marker's `reason` was preserved across the BCB re-registration. K+1's `sameObligationAlreadyObservationUnavailable` check evaluated to `true` and the bounded guard SKIPPED the first publication for K+1. The counter did NOT increment. K+1's obligation was effectively invisible to the bounded guard. |
| Post-fix behavior | The marker reason is preserved ONLY when the previous marker's identity triple `(sessionId, taskId, epoch)` matches the current obligation. After the epoch bump, `_bcbSameIdentity === false` and `preservedReason === undefined`. K+1's marker is registered with no reason; K+1's `sameObligationAlreadyObservationUnavailable` check evaluates to `false`; the bounded guard publishes K+1's verdict; the counter increments. |
| Production site | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2600-2625` (the new `_bcbCurrentSessionId`/`_bcbCurrentTaskId`/`_bcbCurrentEpoch`/`_bcbSameIdentity` derivation). |

## P0 #3 — Queue boundary discriminator → CTQC-04-CORR01

| Field | Value |
|---|---|
| Reviewer finding | The CTQC01 test's `PendingPromptsController` is a stub, the Elm production callback is replaced with a fixed directive, and `sdkHost.send` is replaced with an in-memory list. The test proves the coordinator's new guard prevents its own coalesced `send` calls under synthetic unavailable-capability facts, but does not prove: previously queued notifications stop causing model re-entry, per-job wake messages cannot sustain the same loop, actual pending-prompt dequeue honours the blocked outcome, or all model turns arising from the original obligation are bounded. |
| Required correction | Add a queue-boundary discriminator: deliver one real pending terminal notification through the actual queue consumer. Determine whether it still starts a model turn after the coalesced path has blocked. |
| RED test | `CTQC-04-CORR01: queue-boundary discriminator — per-job wake path is the genuine observation notification path, NOT policed by the bounded host guard` |
| Staging | Same as CTQC-01: held set + command_status unavailable + BCB cycle. |
| Discriminator result | The BCB site is bounded (no coalesced continuation re-handed, marker stamped with `observation_unavailable`). The per-job wake path is a separate producer and is documented as the genuine observation notification path; the bounded host guard at the BCB site does NOT police the wake. A successor ACT may exercise the wake path to determine whether it is also bounded by the Elm `pickContinuationDirectiveForPublication` kernel or whether it requires an additional bounded guard. |
| Outcome class | `PASS_CORRECTION01_QUEUE_BOUNDARY_DISCRIMINATOR_OBSERVED`: the BCB site is bounded; the wake path is documented as out-of-scope. |

## P1 — Unknown tool registry preserves original enqueue behavior (folded into P0 #1)

| Field | Value |
|---|---|
| Reviewer finding | The unknown tool registry (liveTools === undefined) preserves the original enqueue behavior, so an honest "capability unknown" host silently falls through to the enqueue-eligible branch. |
| Required correction | Treat `liveTools === undefined` as a distinct branch from `canObserveHeldResults === false`. The host should NOT publish `observation_unavailable` for an honest unknown — that would be a false positive. The existing `enqueueCompletionContinuationIfHeld` path runs and the downstream SdkController returns `rejected` for `liveTools === undefined`. |
| RED test | Implicit in CTQC-02-CORR01 (which uses `pendingPrompts > 0` to drive the BCB block, not heldIds). The harness's `liveTools` is set to `["submit_and_exit"]` (a defined value that does not include `command_status`). The harness's other tests do NOT set `liveTools`, so the harness's `options.liveTools?.()` returns `undefined` and the production seam falls through to the enqueue path (preserved by my fix's `else` branch). |
| Post-fix behavior | The fix's `if (canObserveHeldResults === false)` branch is gated on the BCB eligibility AND the proven-unavailable case. The `else` branch (the enqueue path) covers both `canObserveHeldResults === true` and `canObserveHeldResults === null` (honest unknown). The existing C10 conservation tests (which do not set `liveTools`) pass: the unknown case enqueues, the downstream SdkController rejects it, and the production behavior is preserved. |

## P2 — Evidence artifact + patch uncommitted (addressed in C6)

| Field | Value |
|---|---|
| Reviewer finding | The evidence artifact does not retain the original LIVE event ordering; the patch remains uncommitted at entry HEAD `e33c1c353`. |
| Status | The patch remains uncommitted at the entry HEAD throughout this ACT (per the C0 directive). The LIVE event ordering is retained in the predecessor ACT's evidence directory (`ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01/01-live-specimen-inventory.md`), which the reviewer can cross-reference. This ACT does NOT modify the predecessor's evidence artifact; it appends a new mapping artifact for the CORRECTION01 P0 fixes. |
