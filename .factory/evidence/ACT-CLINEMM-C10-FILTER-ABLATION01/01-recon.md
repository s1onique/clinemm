# ACT-CLINEMM-C10-FILTER-ABLATION01 — Recon

## ENTRY HEAD

```
ENTRY_HEAD=6e4c70b5f24f701c5a68226fc185bb4966ce6d57
```

The current HEAD is the terminal commit of
`ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-LIVE-QUALIFICATION01`
(CAPTURE_INSUFFICIENT[SYSTEM] — non-blocking residue). The framework-level
completion-authority repair is committed and bound; no production code has
changed in this ACT.

## Two distinct C10 seams in production

There are **two distinct C10 seams** in
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts` that this ACT must
disambiguate.

### SEAM A — message-layer completion_result filter (the ABLATION TARGET)

```
apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  L689..L739
```

Predicate (simplified):

```ts
if (result.messages.length > 0) {
    const hasCompletionResult = result.messages.some(
        (m) => m.say === "completion_result"
    )
    if (hasCompletionResult) {
        if (this.options.hasActiveNotify) {
            // Per-job ownership-aware filter (narrow, BCCOC01):
            const ownedJobIds =
                this.options.messageTranslatorState.getLaunchedBackgroundJobIds()
            let ownedAndOutstanding = false
            for (const jid of ownedJobIds) {
                if (this.options.hasActiveNotify(jid)) {
                    ownedAndOutstanding = true
                    break
                }
            }
            if (ownedAndOutstanding) {
                result.messages = result.messages.filter(
                    (m) => m.say !== "completion_result"
                )
            }
        } else {
            // Over-broad aggregate fallback (legacy LHOWA01/PPAT tests):
            const pendingPromptCountRead =
                this.options.getPendingPromptCount?.(activeSession.sessionId) ??
                { available: false }
            const pendingPromptsKnown =
                pendingPromptCountRead.available === true
                    ? pendingPromptCountRead.count : 0
            const activeNotifyCount =
                this.options.getActiveNotifyCount?.(
                    activeSession.sessionId,
                    this.options.getTask?.()?.taskId,
                ) ?? 0
            const outstandingAutonomousWork =
                pendingPromptAuthorityUnknown
                || pendingPromptsKnown > 0
                || activeNotifyCount > 0
            if (outstandingAutonomousWork) {
                result.messages = result.messages.filter(
                    (m) => m.say !== "completion_result"
                )
            }
        }
    }
}
```

Effect: **Filters the `say: "completion_result"` row from the per-event
message batch before `appendAndEmit`.**

What this seam affects:

| Layer                       | Affected?                                     |
|-----------------------------|-----------------------------------------------|
| Persistence (clineMessages) | YES — filtered rows never reach `appendAndEmit`|
| Renderer-visible rows       | YES — same path                               |
| Task phase                  | NO — that is SEAM B                           |
| BNC state                   | NO — read-only consult                        |
| Wake tracking               | NO — read-only consult                        |

Narrow per-job form (BCCOC01 successor): only suppress when an OWNED job
(from `getLaunchedBackgroundJobIds()`) is still outstanding (has an active
notify marker). Legacy fallback (LHOWA01/PPAT aggregate): suppress on ANY
outstanding autonomous work.

This is the message-level filter — older C10 mechanism.


### SEAM B — framework-level completion-commit barrier (NEW REPAIR, NOT UNDER ABLATION)

```
apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  L385..L422  (admission guard in done handler)
  L474..L509  (reevaluateDeferredCompletionBarrier)
  L769..L790  (terminal phase promotion gated on wasTerminalResponseCommittedThisTurn)
```

Predicate (admission guard):

```ts
// L386..L422
const outstandingAutonomousWork =
    pendingPromptAuthorityUnknown
    || pendingPromptsKnown > 0
    || activeNotifyCount > 0
    || perJobOutstandingNotifyWork
if (outstandingAutonomousWork) return

if (perJobSuppressOriginatingCompletion) {
    Logger.warn(...suppressing originating completion commit (BNCA barrier))
    return
}

// commit "completed" phase transition exactly once
this.options.setTurnPhase?.(
    "completed", undefined,
    "session-event-turn-complete-completed",
)
```

Effect: **Refuses the `setTurnPhase("completed", ...)` call (the
load-bearing lifecycle commit) when ANY notify-owned job launched by this
turn has its wake authority delivered.** The wake-driven turn owns terminal
completion for that job.

This is the framework barrier — newer BNCA-01 / BNCA-ABLATION-01 mechanism.
**NOT under ablation.** Must remain intact.

## Relationship between the two seams

| Aspect                       | SEAM A (message filter)               | SEAM B (framework barrier)            |
|------------------------------|---------------------------------------|---------------------------------------|
| Operates on                  | `result.messages` array               | `setTurnPhase("completed", ...)`      |
| Affects persistence          | YES                                   | NO (does not touch messages)          |
| Affects renderer             | YES                                   | NO                                    |
| Affects task phase           | NO                                    | YES (sole authority)                  |
| Protects against             | 2 `say:"completion_result"` rows     | `setTurnPhase("completed")` fires 2x |
| Triggered when               | translator emits completion_result AND outstanding work | `done` reaches "completed" branch AND outstanding work |

**Key insight:** SEAM A and SEAM B protect against different invariants.
SEAM B enforces task-phase exactly-once; SEAM A enforces message-layer
exactly-once. They are NOT redundant by construction.

The ablation question:

> With SEAM B enabled (framework barrier ON), does disabling SEAM A
> (message filter OFF) produce an extra persisted/rendered
> `completion_result` row?

If YES -> SEAM A is necessary (independent presentation invariant).
If NO  -> SEAM A is redundant.


## Tests touching the seams

### SEAM A (message filter) — direct
- `apps/vscode/src/sdk/__tests__/background-command-terminal-presentation-arbitration01.bctpa01.test.ts` (BCTPA01 — primary BCTPA RED/GREEN matrix for SEAM A)
- `apps/vscode/src/sdk/__tests__/background-command-completion-ownership-correlation01.bccoc01.test.ts` (BCCOC01 — per-job ownership-aware successor)
- `apps/vscode/src/sdk/__tests__/background-notify-exactly-once-presentation01.bcnex01.test.ts` (BCNEX01 — exactly-once presentation green)

### SEAM B (framework barrier) — direct
- `apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-framework01.bnca-framework01.test.ts` (BNCA-FRAMEWORK-01 — GREEN for SEAM B)
- `apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-framework-ablation01.bnca-ablation01.test.ts` (BNCA-FRAMEWORK-ABLATION-01 — load-bearing necessity proof for SEAM B)
- `apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-framework-dispatch-failed01.bnca-framework01.test.ts` (BNCA-FRAMEWORK-DISPATCH-FAILED-01)
- `apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-framework-dispatch-failed-ablation01.bnca-ablation01.test.ts` (BNCA-FRAMEWORK-DISPATCH-FAILED-ABLATION-01)

### SEAM B (framework barrier) — RED/witnesses
- `apps/vscode/src/sdk/__tests__/background-notify-completion-authority-c10-red01.bnca-red01.test.ts` (BNCA-RED-02 — live defect pinned)
- `apps/vscode/src/sdk/__tests__/background-notify-completion-authority-fire-and-forget-red01.bnca-red01.test.ts` (BNCA-RED-01)

### SEAM B (framework barrier) — adjunct
- `apps/vscode/src/sdk/__tests__/long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts` (TQCB01 — related completion barrier; reusable fixture)


## What is the C10 message filter doing in production today?

Tracing the production call sequence:

1. **Originating turn launches a background job with `notifyOnCompletion: true`.**
   - `BackgroundNotifyCoordinator.registerMarker({jobId, sessionId, taskId})` is called.
   - `MessageTranslatorState.recordLaunchedBackgroundJob(jobId)` is called.
   - `getLaunchedBackgroundJobIds()` returns `[jobId]`.

2. **Originating turn calls `command_status(J, waitMs > 0)` (H1 short-circuit).**
   - Returns immediately with `state: "running", notification: "pending"`.
   - Path B suppressed.

3. **Originating turn attempts to commit completion** (submits `submit_and_exit` or `attempt_completion`).
   - The translator emits a partial `say: "completion_result"` row at `content_start` and a final `say: "completion_result"` row with `isAuthoritativelyCompletedResult: true` at `content_end` (`message-translator.ts:1758-1794`).
   - These messages flow into `result.messages` of the `done` event.

4. **SEAM B (framework barrier) checks:** if any `launchedBackgroundJobIds[jid]` has `hasActiveNotify(jid) === true` OR `wasWakeDispatchRequested && !wasWakeDelivered && !wasWakeDispatchFailed` OR `wasWakeDelivered === true`:
   - If `wasWakeDelivered === true` -> refuse to commit, log `suppressing originating completion commit (BNCA barrier)`.
   - If marker still alive OR dispatch pending -> refuse to commit (returns from handler without committing `setTurnPhase("completed", ...)`).
   - This is the load-bearing lifecycle enforcement.

5. **SEAM A (message filter) checks:** AFTER SEAM B has either committed or refused, but BEFORE `appendAndEmit`:
   - If `result.messages` contains a `say: "completion_result"` row AND the per-job ownership predicate (`hasActiveNotify(ownedJid)`) is true -> STRIP the row from `result.messages`.
   - Else -> let the row through.
   - This is the **presentation-layer dedup**.

In the live defect transcript (SHA-256 fe1b6bc7...4ae36, taskId=1790335441241_5g7oe), the originating turn's `submit_and_exit` reached the `appendAndEmit` path. After the BNCA repair (SEAM B), the originating turn's `setTurnPhase("completed", ...)` is REFUSED — but the message-layer row might still have been emitted.

## Discriminators

| ID | Question                                                  | Test seam                                       |
|----|-----------------------------------------------------------|-------------------------------------------------|
| D1 | semantic task completion cardinality == 1                 | `tracker.currentPhase`                          |
| D2 | persisted `completion_result` row cardinality == 1        | `result.messages.filter(say=="completion_result").length` |
| D3 | visible duplicate completion presentation                 | structurally derivable from D2                  |
| D4 | non-notify completion behavior unchanged                  | per-job ownership predicate returns false       |
| D5 | lost-wake behavior unchanged (wasWakeDispatchFailed -> ALLOW) | dispatch-failed AB cases                    |
| D6 | multi-job notify isolation                                | per-job ownership is the narrow form            |
| D7 | ordinary explicit_user completion behavior                | completion path with no background jobs         |

## Why this ACT must not assume the answer

The historical prose says SEAM A "prevents two user-visible completion
boxes for one logical terminal event". That claim is true ONLY if SEAM B
does not also block the originating turn's row before `appendAndEmit`.
Looking at the production code:

- SEAM B (framework barrier) blocks `setTurnPhase("completed", ...)` when `wasWakeDelivered` for any owned jobId.
- But **the messages still flow through `result.messages` regardless** — SEAM B does NOT filter `result.messages`.
- SEAM A is what removes the `say: "completion_result"` row from `result.messages` before `appendAndEmit`.

**In the case where SEAM B holds completion (wake-driven turn owns it):**
- The originating turn's `done` event still has `result.messages` containing the `say: "completion_result"` row.
- SEAM A strips it.
- The wake-driven turn later runs `submit_and_exit` and emits its own row.

So **SEAM A is what prevents TWO `say: "completion_result"` rows from
appearing in the persisted transcript when the wake-driven turn eventually
owns completion.**

If SEAM A is removed, even with SEAM B in place, the persisted
`clineMessages` would contain:
- 1 row from the originating turn (`say: "completion_result"` — NOT suppressed at framework barrier)
- 1 row from the wake-driven turn (`say: "completion_result"` — own authority)

That is the exact "STRUCTURAL_PRESENTATION_RISK" /
"REAL_PRESENTATION_DUPLICATION" question this ACT must answer with
executable ablation.

## Predicted outcome (HYPOTHESIS, not assumption)

Hypothesis: **C10 message filter is NECESSARY.** Ablation with SEAM A OFF
will produce TWO persisted `say: "completion_result"` rows in the canonical
notify-owned background job lifecycle (originating turn + wake-driven turn),
even with SEAM B ON.

This will be proven or disproven by
`c10-filter-ablation01.ablation.test.ts`.

## ACT must proceed to ablation

ENTRY_HEAD is clean. Repo trust OK. SEAM A identified. SEAM B identified.
Tests mapped. The next step is RED characterization + ablation matrix per
sections 5-9 of the ACT specification.

No production code changes planned in this ACT beyond what the ablation
decision requires (§10 or §11).

---

## BOUNDED CORRECTION ROUND 1 (added after halt review)

The factory reviewer's `HALT_C10_ABLATION_NOT_ISOLATED` flagged that the
ROUND 0 ablation mechanism (falsifying `hasActiveNotify` /
`getActiveNotifyCount`) was contaminated because both SEAM A AND SEAM B
consult those predicates. See:

  * SEAM A consults `hasActiveNotify` at L710
    (`this.options.hasActiveNotify(jid)`).
  * SEAM A consults `getActiveNotifyCount` at L731 (over-broad fallback).
  * SEAM B consults `hasActiveNotify` at L475
    (`this.options.hasActiveNotify?.(jid)`).
  * SEAM B consults `getActiveNotifyCount` at L491 (`activeNotifyCount`).

To make the ablation isolated, the bounded correction adds a
**SEAM-A-only** test gate:

```
apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  L194..L221  // new option-bag method declaration
  L744..L758  // narrow branch consults shouldFilterCompletionResult when wired
  L773..L787  // over-broad fallback consults shouldFilterCompletionResult when wired
```

New option-bag method:

```ts
shouldFilterCompletionResult?: (ownedJobIds: readonly string[]) => boolean
```

This is consulted EXCLUSIVELY by SEAM A; SEAM B continues to read
`hasActiveNotify` / `wasWakeDelivered` / `isWakeAuthoritySettled` /
`getActiveNotifyCount` through their unchanged option-bag methods.
Production wires nothing (predicate is undefined at runtime), so the
filter falls through to the production-real narrow per-jid lookup
or the over-broad aggregate fallback. External behavior is
unchanged; this is a TEST-ONLY insertion.

The harness's mutable `c10FilterDecision` cell drives this predicate
via the coordinator's closure. `setC10Filter(harness, true)` installs
the production-real lookup; `setC10Filter(harness, false)` installs a
`() => false` constant that neuters SEAM A without touching SEAM B.

### Canonical wake-delivered discriminator (bounded correction acceptance)

```
J registered
consumeTerminal(J)
  -> notifyCoordinator.dispatchAndTrackWake(J)
    -> wakeDispatchRequested += {J}
    -> host.enqueueTerminalWake({kind:"delivered"}) -> returns {kind:"delivered"}
    -> markWakeDelivered(J)        # wasWakeDelivered += {J}; wakeDispatchRequested -= {J}
                                  # marker (hasActiveNotify) drops to false
Re-register the marker (notifyCoordinator.registerMarker(J))
  -> hasActiveNotify(J) === true again (so SEAM A observes an owned
                                 outstanding marker AT emit time)
                                 wasWakeDelivered stays true (immutable
                                 historical state) so SEAM B still holds
                                 the originating commit.
Originating turn emits `done`:

  SEAM A ON :
    shouldFilterCompletionResult returns true (real lookup)
    ownedAndOutstanding = true
    filter runs, completion_result rows dropped
    result.messages.length === 0 for completion_result
    appendAndEmit receives 0 completion_result rows
    deferredCompletionBarrier marker SET (SEAM B holds lifecycle)

  SEAM A OFF:
    shouldFilterCompletionResult returns false
    filter skipped, completion_result rows pass through
    appendAndEmit receives 2 raw rows (partial + final), 1 visible box
    deferredCompletionBarrier marker SET (SEAM B holds lifecycle, identical)

  DIFFERENCE attributable ONLY to SEAM A. SEAM B's lifecycle decision
  is identical across both cases.
```

This is the LOAD-BEARING criterion called out by
`HALT_C10_ABLATION_NOT_ISOLATED`. The pair
`C10-ABLATION-01-NOTIFY-ON` + `C10-ABLATION-01-NOTIFY-OFF` satisfies it
exactly: framework_completion_commits===0 in BOTH cases; the
message-layer outcome differs (0 vs 2 rows).

---

## BOUNDED CORRECTION ROUND 2 (added after halt review 2)

The factory reviewer's `HALT_C10_DISCRIMINATOR_UNREACHABLE_STATE`
flagged that the ROUND 1 discriminator manufactured an
unreachable production state by:

1. Driving the wake to delivery (which drains `notificationMarkers`
   and sets `wasWakeDelivered=true`).
2. **Re-registering** the marker purely for the test, so
   `hasActiveNotify(J) === true` at the originating turn's
   `done` event.

The reviewer is correct: this state
(`hasActiveNotify=true` AND `wasWakeDelivered=true`) is
unreachable in production. `markWakeDelivered` only operates on
`wakeDispatchRequestedJobIds` and `wakeDeliveredJobIds`; it
never re-arms `notificationMarkers`. The `notificationMarkers`
deletion in `consumeTerminal` (line 959) is the terminal event
for the marker — there is no production code path that re-adds
it after a successful wake delivery.

### The actual reachable state at SEAM A evaluation

The originating turn's `done` event arrives BEFORE the
background job's terminal event in the canonical
`notifyOnCompletion=true` flow. The recon already documents
this at L704-706 as the "frozen bug (premature J)" case:

```
frozen bug (premature J):
  ownedJobIds = [J]
  hasActiveNotify(J) = true  ← job still running; wake not yet dispatched
```

In this state:

```
hasActiveNotify(J)            = true   (marker alive; job still running)
wasWakeDispatchRequested(J)   = false  (consumeTerminal has NOT fired)
wasWakeDelivered(J)           = false
wasWakeDispatchFailed(J)      = false
isWakeAuthoritySettled(J)     = false
```

This is the only reachable state at the originating turn's
`done` event where SEAM A's narrow `hasActiveNotify(jid)`
predicate can fire. After `consumeTerminal` drains the marker,
the predicate cannot suppress.

### Bounded correction ROUND 2: natural pre-delivery discriminator

The harness adds a state-capture helper:

```ts
function captureCoordinatorStateFor(h, jobId): CoordinatorStateAtSeamA {
  return {
    hasActiveNotify:          h.notifyCoordinator.hasActiveNotify(jobId),
    wasWakeDispatchRequested: h.notifyCoordinator.wasWakeDispatchRequested(jobId),
    wasWakeDelivered:         h.notifyCoordinator.wasWakeDelivered(jobId),
    wasWakeDispatchFailed:    h.notifyCoordinator.wasWakeDispatchFailed(jobId),
    isWakeAuthoritySettled:   h.notifyCoordinator.isWakeAuthoritySettled(jobId),
  }
}
```

The MATRIX A canonical tests now use the natural pre-delivery
state — NO `consumeTerminal`, NO `markWakeDelivered`, NO
re-registration. The harness captures the state at the moment
SEAM A is about to evaluate and asserts ALL FIVE probes have
the natural pre-delivery values, identical across ON and OFF.

```
  state_at_seam_a (BOTH runs):
    hasActiveNotify            = true
    wasWakeDispatchRequested   = false
    wasWakeDelivered           = false
    wasWakeDispatchFailed      = false
    isWakeAuthoritySettled     = false
```

### Discriminator outcome (ROUND 2)

  ON : hasActiveNotify(J)=true (natural pre-delivery)
       SEAM A narrow per-jid lookup fires
       completion_result row dropped from result.messages
       0 rows reach appendAndEmit
       SEAM B per-job: perJobOutstandingNotifyWork=true
                       outstandingAutonomousWork=true
                       deferred barrier SET
                       setTurnPhase("completed") NOT called
                       completionCommitCount === 0

  OFF: hasActiveNotify(J)=true (natural pre-delivery)
       c10FilterDecision returns false (SEAM A neutered)
       completion_result row NOT dropped
       2 rows / 1 visible box reach appendAndEmit
       SEAM B per-job: perJobOutstandingNotifyWork=true
                       outstandingAutonomousWork=true
                       deferred barrier SET
                       setTurnPhase("completed") NOT called
                       completionCommitCount === 0 (IDENTICAL)

  DIFFERENCE attributable ONLY to SEAM A. SEAM B's lifecycle
  decision is identical across both cases.

### Outcome classification per halt

```
A. hasActiveNotify(J) is still true when SEAM A runs ✓
   -> C10 can genuinely be load-bearing; prove ON=0 rows, OFF=2 rows.
   -> VERIFIED. ON has 0 rows; OFF has 2 rows / 1 visible box.
      SEAM A is load-bearing in the natural pre-delivery state.
```

The halt specified: "If B occurs, do not immediately repair
C10. First classify the real invariant and timing." ROUND 2
demonstrates outcome A in the canonical pre-delivery
chronology (the only reachable production state at the
originating turn's `done` event).
