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
