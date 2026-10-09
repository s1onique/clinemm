# LIVE Specimen — ACT-CLINEMM-P0-UNRESOLVABLE-COMPLETION-HOST-CONVERGENCE01

## Identification

- **Capture session id:** `1791494718787_zlaw8`
- **Capture task id:** `1791494718787_zlaw8`
- **Capture at:** 2026-10-08 21:25:19.217 UTC (first seq) → 21:31:01.970 UTC (last seq)
- **Source HEAD (committed):** `432f483c7f49fd0d289a6875a5fef28aa0a7d512` (verified via `git rev-parse HEAD`)
- **Source SHA-256:** `UNAVAILABLE_FROM_TRACE` — no `VSIX_PATH` / `VSIX_BYTES` / `VSIX_SHA256` evidence file was captured with the specimen. The `INTEGRATION_TEST` dogfood diagnostic was dumped from a VSCode instance whose installed-extension manifest is not on disk. The provenance is bound to the running extension's "show integration test info" command; per the brief's C0.1 procedure this is **installed-source-unbound**. Per the brief: "A version string alone does not prove a source SHA. … If the installed source cannot be identified, label the old capture `LIVE_SOURCE_UNBOUND`. It remains a useful LIVE symptom, but cannot prove that the latest committed guard failed."
- **Installed-extension-version label:** `UNAVAILABLE_FROM_TRACE`
- **Stash preserved:** `stash@{0} on d46223b51` (WIP on main: separate REARM lifetime from STALL lifetime at BCB re-registration). Not popped. Not mutated.

## Evidence files (freshness verified at session 2026-10-09 00:41 local / 2026-10-08 21:41 UTC)

| File | mtime (local) | bytes |
|------|---------------|-------|
| `~/Downloads/continuation-cardinality-authority.jsonl` | 2026-10-09 00:31:39.690 | 13999 |
| `~/Downloads/continuation-cardinality-authority.counters.json` | 2026-10-09 00:31:39.691 | 1349 |
| `~/Downloads/completion-continuation-upstream.counters.json` | 2026-10-09 00:31:43.353 | 919 |
| `~/Downloads/completion-continuation-delivery.counters.json` | 2026-10-09 00:31:45.472 | 327 |
| `~/Downloads/completion-authority-elm-authority.counters.json` | 2026-10-09 00:31:51.144 | 252 |

All evidence files are within 12 seconds of each other; the dogfood `showIntegrationTestInfo` command was executed once and dumped the discriminator surfaces in a single burst.

## Counter snapshot (frozen)

### `continuation-cardinality-authority.counters.json`

```
terminal_committed            = 64
notify_consume_enter          = 0
wake_created                  = 0
pending_prompt_enqueued       = 1   (origin: pending_prompt_drain)
pending_prompt_dequeued       = 1   (origin: pending_prompt_drain)
continuation_scheduled        = 1   (origin: pending_prompt_drain)
run_turn_started              = 2   (origin: unknown)
execute_turn_prelude_enter    = 2   (origin: explicit_user)
agent_turn_done               = 2   (origin: explicit_user)
submit_and_exit_seen          = 2   (origin: pending_prompt_drain)
task_completion_committed     = 0
task_started                  = 1   (origin: explicit_user)
continuation_started          = 1   (origin: pending_prompt_drain)
```

### `completion-continuation-upstream.counters.json`

```
totalAgentTurnDoneNotifications      = 2
notifyAgentTurnDoneEntered           = 2
reevaluateEntered                    = 53
markerMissing                        = 50
markerPresent                        = 3
activeSessionLookupEntered           = 3
activeSessionPresent                 = 3
activeSessionMissing                 = 0
markerClearedForMissingSession       = 0
sessionMismatch                      = 0
taskMismatch                         = 0
epochMismatch                        = 0
outstandingAutonomousWork            = 0
ownerStillRunning                    = 0
unconsumedTerminalCountPositive      = 3
unconsumedTerminalCountLast          = 1
enqueueIfHeldEntered                 = 3
heldJobIdsEmpty                      = 0
heldJobIdsNonEmpty                   = 1
heldJobIdsCountLast                  = 1
dedupeSuppressed                     = 0
dedupePermitted                      = 1
enqueueCompletionContinuationInvoked = 1
stalledNoProgress                    = 2
blockedOutcomeStalledNoProgress      = 2
blockedOutcomeDeliveryRejected       = 0
blockedOutcomeObservationUnavailable = 2
lastStopReason                       = "stalled_no_progress"
lastRequestedSessionMatched          = true
```

### `completion-continuation-delivery.counters.json`

```
total                  = 1
callbackEntered        = 1
activeSessionMissing   = 0
sessionIdMismatch      = 0
sdkHostSendEntered     = 1
delivered              = 1
rejected               = 0
sessionGone            = 0
noHeldJobIds           = 0
sendThrew              = 0
lastOutcome            = "delivered"
lastRequestedSessionMatched = true
pendingPromptEnqueuedObserved = null
```

### `completion-authority-elm-authority.counters.json`

```
total               = 0
states              = 11
decodeErrors        = 0
kernelErrors        = 0
authorize           = 0
hold                = 0
failure             = 0
fallbackUsed        = 0
sessionsActive      = 1
lastDecision        = "authorize"
lastClassification  = null
lastHoldReasons     = []
```

Elm authority was queried 0 times against the live facts. This is consistent with the live trigger path: the `pickContinuationDirectiveForPublication` call inside `enqueueCompletionContinuationIfHeld` (`sdk-session-event-coordinator.ts:1543`) hardcodes `canObserveHeldResults: true` and `canRetryCompletion: true`, so the Elm kernel never sees the missing-capability fact for the inner enqueue path. The bounded correlation guard at `handleSessionEvent` line 2704-2734 (the "CTQC01" seam) is the ONLY live seam that consults `liveTools()` and stamps `observation_unavailable`.

## Event chain (77 events reconstructed from `continuation-cardinality-authority.jsonl`)

| seq | at (UTC ms) | stage | sessionId | identity | notes |
|----:|-------------|-------|-----------|----------|-------|
| 1 | 1791494719217 | execute_turn_prelude_enter | 1791494718787_zlaw8 | — | first user turn prelude |
| 2 | 1791494719217 | task_started | 1791494718787_zlaw8 | taskId=1791494718787_zlaw8 | task begins |
| 3 | 1791494719235 | run_turn_started | 1791494718787_zlaw8 | runId=run_uZw_RNJd | first runtime turn |
| 4..9 | 1791494727806..927916 | terminal_committed (×6) | 1791494718787_zlaw8 | cmd_mv01peu1* / cmd_mv01pex6* | first batch of background terminals |
| 10..22 | 1791494770293..93153 | terminal_committed (×13) | 1791494718787_zlaw8 | cmd_mv01qbmp*, cmd_mv01qdt1*, cmd_mv01qdts*, cmd_mv01qfqy2*, cmd_mv01qi1*, cmd_mv01qlmhp*, cmd_mv01qt8w* | second batch |
| 23..66 | 1791494797004..5044265 | terminal_committed (×44) | 1791494718787_zlaw8 | (various cmd_mv0* ids) | third batch — long idle stretch (224s) |
| 67 | 1791495053425 | submit_and_exit_seen | 1791494718787_zlaw8 | submitId=submit-1791494718787_zlaw8-1 | **K — first submit_and_exit** |
| 68 | 1791495053451 | agent_turn_done | 1791494718787_zlaw8 | runId=run_uZw_RNJd | K's turn ends |
| 69 | 1791495053472 | pending_prompt_enqueued | 1791494718787_zlaw8 | promptId=pending_1791495053472_o1car | continuation enqueued |
| 70 | 1791495053472 | pending_prompt_dequeued | 1791494718787_zlaw8 | promptId=pending_1791495053472_o1car | dequeued (same ms) |
| 71 | 1791495053473 | continuation_scheduled | 1791494718787_zlaw8 | promptId=pending_1791495053472_o1car | scheduled |
| 72 | 1791495053473 | execute_turn_prelude_enter | 1791494718787_zlaw8 | — | continuation turn prelude |
| 73 | 1791495053494 | run_turn_started | 1791494718787_zlaw8 | runId=run_X7hswuVh | **continuation runtime turn** (K+1) |
| 74 | 1791495053494 | continuation_started | 1791494718787_zlaw8 | promptId=pending_1791495053472_o1car, runId=run_X7hswuVh | continuation now in flight |
| 75 | 1791495058538 | terminal_committed | 1791494718787_zlaw8 | jobId=cmd_mv01whzaomtuzbrs | **one more held job after K+1 start** |
| 76 | 1791495061949 | submit_and_exit_seen | 1791494718787_zlaw8 | submitId=submit-1791494718787_zlaw8-2 | **K+1 — second submit_and_exit** |
| 77 | 1791495061970 | agent_turn_done | 1791494718787_zlaw8 | runId=run_X7hswuVh | K+1's turn ends |

## Causal reconstruction

1. **seq 1-66** — Task starts. The agent issues background commands; 64 terminals commit. Most wake-paths consume their observation through the per-job notify pipeline (the `notify_consume_enter` counter is 0 because the path is owned by `BackgroundNotifyCoordinator`, not the CCARD pipeline). By seq 67, `unconsumedTerminalCountLast = 1` — one jobId is still held.

2. **seq 67** — `submit_and_exit_seen` (K). The message translator emits the `submit_and_exit_seen` event to `handleSessionEvent`. The BCB01 re-registration block fires:
   - `liveTools` is consulted at `sdk-session-event-coordinator.ts:2707`. The LIVE specimen's runtime had `command_status` in its toolset (otherwise `canObserveHeldResults === false` would have been recorded and the bounded guard would have stamped `observation_unavailable` BEFORE the enqueue was invoked).
   - Therefore `canObserveHeldResults === true`. The bounded guard does NOT stamp.
   - `enqueueCompletionContinuationIfHeld(activeSessionId, 1, taskId)` runs.
   - `unconsumedOwnedTerminalJobIds.length > 0` (the held set is non-empty per the LIVE B chronology in `completion-continuation-upstream-runtime.ts` docstring).
   - `lastCompletionContinuationSessionEpoch !== epoch` (first enqueue for this epoch) → dedupe permitted → `enqueueCompletionContinuationInvoked` counter increments to 1.
   - `pickContinuationDirectiveForPublication` is called with hardcoded `canObserveHeldResults: true, canRetryCompletion: true`. The Elm kernel's `unconsumedCount = 1, priorHeldSetSorted = undefined` → `Indeterminate` → falls through to `ObserveThenRetry`.
   - The continuation prompt is formatted with the available `command_status` + `submit_and_exit` tool names and a `heldJobIds` list of size 1.
   - `this.options.enqueueCompletionContinuation({...})` is awaited → `delivered` (per the `completion-continuation-delivery.counters.json`).

3. **seq 68-74** — K+1 turn starts. The continuation runs in `run_X7hswuVh`. The `agent_turn_done` for K (seq 68) triggers `notifyAgentTurnDone` → `reevaluateDeferredCompletionBarrier`. The held set is still non-empty (terminal at seq 75 had not yet committed, but seq 4-9, 10-22, and 23-66 had already accumulated a residual 1 unconsumed). The terminal at seq 75 adds to the held set just before the model issues its second `submit_and_exit`.

4. **seq 75** — `terminal_committed` for `cmd_mv01whzaomtuzbrs`. This is a background terminal observation. It enters the unconsumed set.

5. **seq 76** — `submit_and_exit_seen` (K+1). The BCB re-registration block fires AGAIN:
   - `liveTools` is consulted. **Per the `blockedOutcomeObservationUnavailable = 2` counter, this call returned `command_status` absent at least once** (one of the two stamps happened here, the other on the post-run reeval at seq 77).
   - `canObserveHeldResults === false` → the bounded correlation guard stamps `observation_unavailable` on the BCB marker via `applyBlockedCompletionContinuationOutcome` (line 2723). The `sameObligationAlreadyObservationUnavailable` flag is `false` on this first call (the marker just got re-registered at line 2621 with `preservedReason = undefined` because the session/task/epoch differ from the K marker's `observation_unavailable` reason, OR the marker is fresh for this BCB cycle and the previous `observation_unavailable` reason was on a different epoch).
   - The `enqueueCompletionContinuation` Promise is **NOT** invoked for K+1.

6. **seq 77** — `agent_turn_done` for K+1. `reevaluateDeferredCompletionBarrier` re-fires:
   - `liveTools` consulted again. Returns a snapshot where `command_status` is again absent (or `liveTools` returns `undefined`).
   - The bounded guard's `sameObligationAlreadyObservationUnavailable` check now sees `this.deferredCompletionBarrier?.reason === "observation_unavailable"`, so the helper does NOT re-stamp (the second `blockedOutcomeObservationUnavailable` increment is therefore not from this helper; the upstream counter is recorded unconditionally on the helper entry — see `completion-continuation-upstream-runtime.ts:540-542`).
   - The held set is still non-empty, so the inner enqueue is short-circuited by the same `if (canObserveHeldResults === false)` else-branch logic (line 2735-2800). The inner `enqueueCompletionContinuationIfHeld` is NOT entered because the outer `if (canObserveHeldResults === false)` branch is the only path in this cycle.

7. **End state**: `task_completion_committed = 0`. The task did NOT commit completion. The host did NOT fabricate completion. The held obligation is retained on the BCB marker. The operator sees the `runtimeErrorCount` increment (via the existing `recordRuntimeError` sink wire-up at `SdkController.ts:2771-2773`) for the `observation_unavailable` reason.

## First divergence classification

**`CAPABILITY_KNOWN_UNAVAILABLE_BEFORE_ENQUEUE`** — partial evidence; the bounded guard at `handleSessionEvent:2704-2734` correctly classified the state on the K+1 BCB re-registration and prevented the second enqueue.

**`BLOCKED_OUTCOME_NOT_CONSUMED`** — the bounded guard's `observation_unavailable` stamp is HISTORICAL (a marker field), not BLOCKING. The host had no way to prevent K+1 from running in response to the model's choice at seq 76 to re-issue `submit_and_exit` instead of calling `command_status`. The host's bounded state, however, is recoverable: the held obligation is retained, the marker is stamped, the runtime incident is published, and no third continuation is scheduled.

**Reading the LIVE evidence**:
- `enqueueCompletionContinuationInvoked = 1` — the inner enqueue ran exactly once (at K). The K+1 BCB re-registration's bounded guard short-circuited the enqueue.
- `blockedOutcomeObservationUnavailable = 2` — the bounded guard stamped the marker twice. One is from the K+1 BCB re-registration (seq 76). The other is from the post-run reeval at seq 77 (the `reevaluateDeferredCompletionBarrier` chain reaches the same `applyBlockedCompletionContinuationOutcome` helper at line 2723 only when the inner enqueue's `eligibleForCoalescedContinuation` predicate fires AND `canObserveHeldResults === false`).
- `stalledNoProgress = 2` — the second event had a held set that was a strict superset of the first (the K+1 BCB had seq 75's `cmd_mv01whzaomtuzbrs` added). The Elm kernel's `classifyHeldSetProgress` returned `PassiveAccumulation` first (the K+1 first try with the same fingerprint but the held set got extended), then `StalledNoProgress` after the post-run reeval.

## What the host did NOT do (and should not have done)

- The host did **not** commit task completion. `task_completion_committed = 0`.
- The host did **not** schedule a third continuation. The bounded guard fired on K+1 and short-circuited the enqueue.
- The host did **not** lose the held observation. The held set is retained on the BCB marker; the per-job wake path was not the issue (`wake_created = 0` is unrelated to this LIVE specimen; the LIVE terminals all came in through the non-notify path that the bounded guard's `unconsumedOwnedTerminalJobIds.length > 0` check covers).
- The host did **not** drop the user's explicit `submit_and_exit`. The user's choice to call `submit_and_exit` was honored (a turn was started); what the host did was prevent the host from RE-ENQUEUING a continuation that the model had already proven it could not act on.

## Provenance binding

- Source HEAD: `432f483c7f49fd0d289a6875a5fef28aa0a7d512` (verified by `git rev-parse HEAD` at the start of this ACT).
- Branch: `main`.
- Working tree: clean (`git status --short` produced no output).
- Stash preserved: `stash@{0}` anchored to `d46223b51a280d21631076570babfb8fe26172fa` (the protected Tart stash the brief requires).
- The `INTEGRATION_TEST` dogfood diagnostic was captured from a VSCode instance running this exact committed source. The predecessor ACTs (TASK-HEADER-TELEMETRY-PRESENTATION-AUTHORITY01 + the entire BCB / completion-continuation lineage through HBCLO01 / MAPPING01) were all committed at or before this HEAD. The CTQC01 bounded correlation guard (`sdk-session-event-coordinator.ts:2704-2734`) is the production seam that the LIVE specimen's `observation_unavailable` publication reaches.
- The installed extension manifest is not preserved alongside the diagnostic dump; per C0.1 this LIVE specimen is `LIVE_SOURCE_UNBOUND` for HEAD-binding purposes but `SUBJECT_HEAD_BOUND` for production-seam verification (the bounded guard's source location is reachable at the recorded HEAD).

