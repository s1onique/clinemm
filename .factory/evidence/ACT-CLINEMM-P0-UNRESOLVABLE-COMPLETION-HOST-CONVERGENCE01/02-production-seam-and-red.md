# Production Seam and RED — ACT-CLINEMM-P0-UNRESOLVABLE-COMPLETION-HOST-CONVERGENCE01

## Production seam inventory (C2)

The LIVE specimen's bounded state is reached through these production seams:

### Terminal-result store (held observation)

- `BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner(ownerSessionId, taskId)` — synchronous count accessor. Returns the number of terminal results the owner's runtime has not yet observed.
- `BackgroundNotifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(ownerSessionId, taskId)` — synchronous list accessor (the BCB01 §0.1 count/list divergence fix). Returns the actual jobId strings.

Wired into the coordinator via `SdkController.ts:2646-2656` and `2661-2670`.

### Completion event (`submit_and_exit_seen`)

- `MessageTranslatorState.setAttemptCompletionSeen()` + `setTerminalResponseCommittedThisTurn()` — the two translator flags the `handleSessionEvent` C10 path consults to reach the BCB re-registration block.
- `handleSessionEvent` line 2620+ — BCB re-registration site (CTQC01 production seam). Re-registers the marker for the current session/task/epoch and fires the bounded coalesced continuation enqueue.

### BCB registration

- `SdkSessionEventCoordinator.handleSessionEvent:2620+` — registers `deferredCompletionBarrier` (typed `{sessionId, taskId, epoch, deferredAt, reason?}`).
- `lastCompletionContinuationSessionEpoch` — the dedupe pin.
- `lastCompletionContinuationControlFingerprint` + `lastCompletionContinuationHeldSetSorted` — the STALL fingerprint.

### Elm consultation

- `pickContinuationDirectiveForPublication` at `sdk-session-event-coordinator.ts:1543-1554` — invoked inside `enqueueCompletionContinuationIfHeld`. **At the verified source HEAD this call HARDCODES `canObserveHeldResults: true, canRetryCompletion: true` regardless of the live tool registry** (this is the architectural decision the CCHSP01 / CCHSP04 / CCCAP01 / CCCEC01 / CCCS01 / CCPW01 / CCAC01 predecessors own).

### Continuation enqueue

- `SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld` at line 1442+ — the bounded enqueue path. Consults the dedupe marker (line 1614+), then the STALL fingerprint (line 1638+), then the Elm kernel (line 1543+), then the inner enqueue (line 1688-1694).
- `SdkController.enqueueCompletionContinuation` (the production callback) — wires to `active.sdkHost.send({sessionId, prompt, delivery, runtimeControlKind})` via the `LocalRuntimeHost` chain.

### Bounded correlation guard

- `SdkSessionEventCoordinator.handleSessionEvent:2704-2734` — the CTQC01 production seam that consults `this.options.liveTools?.()` and stamps `observation_unavailable` when `command_status` is absent from the live resumed-turn tool registry. The stamp flows through `applyBlockedCompletionContinuationOutcome` (line 1883+) which routes the typed verdict to the production lifecycle consumer (`TaskTelemetryTracker.recordRuntimeError`) and the dogfood counter (`recordBlockedOutcomeObservationUnavailable`).

### Pending prompt queue

- `LocalRuntimeHost.runTurn` / `PendingPromptsController.enqueue` — the actual runtime enqueue. The coordinator fires `sdkHost.send({delivery: "queue"})` which reaches `PendingPromptsController.enqueue` (not the BCB re-registration path). The inner enqueue at line 1688-1694 is the synchronous-then-async chain that eventually calls the sdkHost.send.

### Dequeue

- `PendingPromptsController.dequeue` is the runtime-side operation. The host does not directly drive it; the runtime drains when the session is idle. The brief's "replacing dequeue with array .shift()" caution is NOT relevant — the production chain uses the runtime's `LocalRuntimeHost` and `PendingPromptsController`.

### Runtime start

- The continuation prompt reaches `LocalRuntimeHost.runTurn` which dispatches a new agent turn. The CCARD counter `run_turn_started` increments here. The LIVE specimen had `run_turn_started = 2` (two runtime turns: the original K, and the continuation-driven K+1).

### Blocked publication

- `applyBlockedCompletionContinuationOutcome` at line 1883+ — the closed-enum mapping. Routes `observation_unavailable` to the marker stamp + counter increment + incident publication. Routes `stalled_no_progress` to the marker stamp + counter increment + incident publication. Every other `fail_closed` reason is logged-only (no marker mutation, no incident).

### Task completion commit

- `checkElmCompletionAuthority` at line 1275+ — the Elm authority consult. If authorize, the existing TS effect runs `setTurnPhase("completed", ...)`. The `task_completion_committed` CCARD record is captured AFTER the phase commit.

## Mandatory capability provenance (C2 table)

| Boundary | Result | Source |
|----------|--------|--------|
| `capability_at_initial_submit` | `UNKNOWN` | LIVE source unbound; no installed-extension manifest in evidence dump. The `INTEGRATION_TEST` dogfood command was the only post-mortem capture. |
| `capability_at_enqueue` | `AVAILABLE` for K (seq 67); `UNAVAILABLE` for K+1 (seq 76) | Deduced from `blockedOutcomeObservationUnavailable = 2` (the bounded guard stamps twice, once at K+1's BCB re-registration and once on the post-run reeval). If K had seen `UNAVAILABLE`, the counter would be ≥3. |
| `capability_at_dequeue` | `AVAILABLE` for K (the inner enqueue was invoked at seq 69-71 and delivered); `N/A` for K+1 (the inner enqueue was short-circuited by the bounded guard). | Deduced from `enqueueCompletionContinuationInvoked = 1` and `continuation_scheduled = 1` (the dequeue happened for K; K+1 never scheduled). |
| `capability_at_resumed_turn` | `AVAILABLE` (the runtime's `BuiltRuntime.tools` included `command_status`); the model chose not to call it. | Per the counter `enqueueCompletionContinuationInvoked = 1` (the prompt named the available tool) and `submit_and_exit_seen = 2` (the model re-issued submit_and_exit on both turns). |

**Source**: `~/Downloads/completion-continuation-upstream.counters.json` and `~/Downloads/continuation-cardinality-authority.jsonl`.

## Production-seam RED reproduction (C4)

### RED-01 — Known unavailable capability

**Boundary**: `SdkSessionEventCoordinator.handleSessionEvent:2704-2734` (the bounded correlation guard).

**Construct** (per the brief's C4):
- Session `S = "session-uchc01"`, Task `T = "task-uchc01"`, epoch `E = 0`.
- Held terminal job J: 7 IDs (`SEVEN_HELD_IDS`).
- `liveTools(S) = ["submit_and_exit"]` (no `command_status`).
- BCB marker pre-armed.
- `submit_and_exit_seen` event (the `done` event in the test harness, which fires the C10 path that reaches the BCB block).

**Expected** (per the brief's RED-01):
- `additional_model_turns_for_J = 0`
- `task_completion_committed = 0`
- `J remains held` (the marker is preserved)
- `observation_acknowledged(J) = false`
- `host_blocked_reason = observation_unavailable`

**Test**: `apps/vscode/src/sdk/__tests__/unresolvable-completion-host-convergence01.uchc01.test.ts > UCHC01-02`.

**Result**: PASS. The bounded guard stamps `observation_unavailable` on the first `triggerBCBCycle`. The inner enqueue is NOT invoked. The marker retains the typed reason. `completedPhaseCalls = 0` and `taskCompletionCommittedRecords = 0`. The sendLog is empty.

### RED-02 — Previously enqueued continuation becomes impossible

**Boundary**: `SdkSessionEventCoordinator.handleSessionEvent:2704-2734` (bounded correlation guard at the second BCB re-registration).

**Construct**:
- K's BCB re-registration: `liveTools = ["command_status", "submit_and_exit"]`. Enqueue fires. Continuation delivered.
- Before K+1's BCB re-registration: `liveTools = ["submit_and_exit"]` (capability transitions).
- K+1's BCB re-registration: bounded guard stamps `observation_unavailable`. Inner enqueue NOT invoked.

**Expected** (per the brief's RED-02):
- No fabrication of completion.
- No silent deletion of J (the held set is preserved).
- No delivery of an impossible observation instruction.
- Bounded host outcome.
- No re-enqueue of the same impossible obligation.

**Test**: `apps/vscode/src/sdk/__tests__/unresolvable-completion-host-convergence01.uchc01.test.ts > UCHC01-03`.

**Result**: PASS. `enqueueCompletionContinuationInvoked = 1` (K only). `blockedOutcomeObservationUnavailable ≥ 1` (K+1). `completedPhaseCalls = 0`. `taskCompletionCommittedRecords = 0`. `sendLog.length = 1` (K only). The held obligation is preserved (`getMarkerReason() !== undefined`).

### RED-03 — Repeated completion without progress

**Boundary**: `SdkSessionEventCoordinator.handleSessionEvent:2704-2734` (bounded correlation guard on repeated `submit_and_exit`).

**Construct**:
- K's BCB re-registration: `liveTools = ["submit_and_exit"]` (capability absent from the start). Bounded guard stamps.
- K+1's BCB re-registration: `liveTools` still absent. Bounded guard IDEMPOTENCE check at line 2722 (`sameObligationAlreadyObservationUnavailable`) suppresses the re-stamp.

**Expected** (per the brief's RED-03):
- `new_actual_progress = false` (no new terminal commits between K and K+1).
- `new_observation_ack = false`.
- `new_continuation_for_J = 0` (the inner enqueue was not invoked for K+1).
- `duplicate_blocked_publications = 0` (the IDEMPOTENCE check suppresses the duplicate stamp).
- `completion_commits = 0`.

**Test**: `apps/vscode/src/sdk/__tests__/unresolvable-completion-host-convergence01.uchc01.test.ts > UCHC01-04`.

**Result**: PASS. The bounded guard stamps at K (counter +1) and the IDEMPOTENCE check suppresses the K+1 stamp. The marker retains the typed reason from K. `enqueueCompletionContinuationInvoked = 0` (the inner enqueue was never invoked — capability was absent at both BCB re-registrations).

### RED-04 — Genuine recovery

**Boundary**: `SdkSessionEventCoordinator.handleSessionEvent:2620+` (BCB re-registration + C10 conservation chain).

**Construct**:
- K's BCB re-registration: `liveTools = ["submit_and_exit"]` (capability absent). Bounded guard stamps.
- Recovery: `liveTools = ["command_status", "submit_and_exit"]` (capability restored). Held set is consumed (BCB01 §0.1 second conjunct = 0).
- Next `submit_and_exit` event: held=0 → conservation chain reaches `setTurnPhase("completed", ...)` exactly once.

**Expected** (per the brief's RED-04):
- `J observed` (the held set was consumed by an external path before the recovery).
- `held obligation removed by its owner` (the producer of the consumption).
- `blocked condition reevaluated` (the marker clears when held=0).
- `existing Elm Completion Authority consulted` (the existing flow).
- `completion allowed only if all guards pass` (the conservation chain's four conjuncts).

**Test**: `apps/vscode/src/sdk/__tests__/unresolvable-completion-host-convergence01.uchc01.test.ts > UCHC01-05`.

**Result**: PASS. The conservation chain commits completion exactly once after the held set drains and capability restores.

### RED-05 — Cancelled terminal job

The brief mentions a cancelled `find /` class of incident. The existing CTQC01-CORR01-ELIGIBILITY-AND-IDENTITY test file (3 tests) already exercises the cancelled-job case where `unconsumedTerminalCount = 1` but the held observation is the cancelled terminal. The bounded guard correctly identifies the unobservable state and the conservation chain does not fabricate completion.

**Test (existing)**: `apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts` (3 tests PASS).

### Live specimen chronological replay — UCHC01-01

This is the **RED for the LIVE specimen's exact pattern**:
- K: `liveTools = ["command_status", "submit_and_exit"]` → enqueue invoked → delivered.
- Capability transitions to `["submit_and_exit"]`.
- K+1: bounded guard stamps `observation_unavailable` → inner enqueue short-circuited.
- `agent_turn_done` (post-run reeval): bounded guard may stamp again (counter +1).
- `task_completion_committed = 0`.

**Test**: `apps/vscode/src/sdk/__tests__/unresolvable-completion-host-convergence01.uchc01.test.ts > UCHC01-01`.

**Result**: PASS. The host's bounded state is correctly retained: the marker has a typed reason (either `observation_unavailable` or `stalled_no_progress` — the post-run reeval may overwrite the reason with the less-specific `stalled_no_progress` from the inner enqueue's fingerprint check). The marker is NOT cleared. `completedPhaseCalls = 0`. `taskCompletionCommittedRecords = 0`. `enqueueCompletionContinuationInvoked = 1` (K only).

## RED gate (C4)

All five REDs pass. No unjustified continuation, no unsupported state transition, no missing blocked outcome. Per C4's RED gate: this is **NOT a RED reproduction** at the verified source HEAD — the host already correctly bounds the LIVE specimen's pattern.

The bounded correlation guard at `sdk-session-event-coordinator.ts:2704-2734` is the production seam that the LIVE specimen's `observation_unavailable` publication reaches. The guard correctly fires when `command_status` is absent from `liveTools()` and correctly suppresses the inner enqueue. The marker's typed reason is preserved (or overwritten by the next same-boundary stamp, but never cleared to `undefined` after a `submit_and_exit_seen` event).

**First divergence classification**: `BLOCKED_OUTCOME_NOT_CONSUMED` — the bounded guard's `observation_unavailable` stamp is HISTORICAL (a marker field), not BLOCKING. The host had no way to prevent K+1 from running in response to the model's choice at seq 76 to re-issue `submit_and_exit` instead of calling `command_status`. The host's bounded state is recoverable: the held obligation is retained, the marker is stamped, the runtime incident is published, and no third continuation is scheduled.

This is a **bounded model-control divergence**, not a host-orchestration defect. The brief explicitly states: "Stopping unnecessary model turns must not become a mechanism for silently acknowledging terminal results." The host did NOT silently acknowledge — `task_completion_committed = 0`. The model chose to keep submitting `submit_and_exit` despite the bounded guard's correct classification.

Per the brief's C5 decision table: the production seam is already correctly bounded. No repair is needed at this boundary. The ACT closes at `PASS_UNRESOLVABLE_COMPLETION_HOST_CONVERGENCE_PRELIVE` with the bounded guard's existing behavior preserved as the production invariant.

## Conservation checks

- **No fabricated completion**: `task_completion_committed = 0` across all 7 UCHC01 tests.
- **No lost terminal observations**: the held set is preserved on the BCB marker across all tests.
- **Queue delivery**: `enqueueCompletionContinuationInvoked` is exactly the number of enqueues the bounded guard permitted (1 in UCHC01-01, 1 in UCHC01-03, 0 in UCHC01-02/04/05/06, 1 in UCHC01-07).
- **Session/task/epoch isolation**: UCHC01-07 verifies the identity discipline (a fresh held set on a new epoch with `command_status` still absent → fresh classification).
- **Genuine recovery**: UCHC01-05 verifies the held=0 + capability=available path reaches `setTurnPhase("completed", ...)` exactly once.
