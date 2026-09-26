# ACT-CLINEMM-C10-FILTER-ABLATION01 — Decision (bounded correction ROUND 1)

## RESULT: C10_NECESSARY = TRUE

The C10 message-layer completion_result filter IS load-bearing and cannot
be removed. The framework-level completion-commit barrier (SEAM B) does
NOT subsume the message-layer uniqueness invariant.

## HALT RESOLUTION (bounded correction ROUND 1)

The first round of ablation (ROUND 0) was reviewed and halted as
`HALT_C10_ABLATION_NOT_ISOLATED` because the ablation switch falsified
both `hasActiveNotify` and `getActiveNotifyCount` — predicates that
SEAM B also consults. The result was contamination: SEAM B's
`outstandingAutonomousWork` and `perJobSuppressOriginatingCompletion`
predicates also flipped, making the canonical discriminator
unprovable.

The bounded correction ROUND 1 introduces a **SEAM-A-only** test gate:
the `shouldFilterCompletionResult?: (ownedJobIds) => boolean` option-bag
method on `SdkSessionEventCoordinatorOptions`. This predicate is
consulted EXCLUSIVELY by the message-layer filter at
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:L745..L758`
(narrow branch) and `L774..L786` (over-broad fallback). SEAM B
continues to read `hasActiveNotify` / `wasWakeDelivered` /
`isWakeAuthoritySettled` / `getActiveNotifyCount` through the same
option-bag handlers both before and after the SEAM A flip.

The harness's mutable `c10FilterDecision` cell drives this predicate
via the coordinator's closure. `setC10Filter(harness, true)` installs
the production-real lookup (consults `notifyCoordinator.hasActiveNotify`
per owned jobId). `setC10Filter(harness, false)` installs a
`() => false` constant that neuters SEAM A without touching SEAM B.

## KEY DISCRIMINATOR — CANONICAL WAKE-DELIVERED SETUP

The canonical discriminator required by `HALT_C10_ABLATION_NOT_ISOLATED`
is a setup where SEAM B demonstrably suppresses the originating
completion commit AND the only variation between the two runs is the
SEAM-A message filter:

  J registered
  consumeTerminal(J)
  -> host.enqueueTerminalWake({kind:"delivered"})
  -> notifyCoordinator.markWakeDelivered(J)
  -> hasActiveNotify(J) === false (marker drained)
  -> wasWakeDelivered(J) === true
  Re-register the marker so SEAM A observes an owned outstanding
  marker AT emit time (wasWakeDelivered stays immutable=true so SEAM B
  still holds the originating commit in both SEAM-A-ON and
  SEAM-A-OFF runs).
  Originating turn attempts completion.

In this state:

  SEAM A ON:
    - shouldFilterCompletionResult(ownedJobIds) returns true (real lookup)
    - ownedAndOutstanding = true
    - filter runs -> completion_result rows stripped
    - appendAndEmit receives 0 completion_result rows
    - framework_completion_commits = 0 (SEAM B holds the commit)

  SEAM A OFF:
    - shouldFilterCompletionResult(_) returns false
    - ownedAndOutstanding = false (filter skipped)
    - completion_result rows pass through
    - appendAndEmit receives 2 raw / 1 visible box
    - framework_completion_commits = 0 (SEAM B holds the commit,
      IDENTICAL to ON case)

The ISOLATION property of the bounded correction: framework_completion_commits
is the SAME (0) in BOTH cases; only the message-layer outcome differs.
The difference is attributable solely to SEAM A.

## LOAD-BEARING INVARIANT (PROTECTED_INVARIANT)

```
C10 protects message-layer completion_result row cardinality when
SEAM B (correctly) suppresses the originating lifecycle commit
because the wake-driven turn owns terminal completion for J.

Specifically: the originating turn's `done` event still emits a
say:"completion_result" row into result.messages; that row reaches
appendAndEmit and is persisted unless SEAM A strips it. SEAM B does
NOT consult result.messages.

Without C10 (SEAM A OFF), the originating turn's completion_result row
leaks through even when SEAM B correctly holds the lifecycle commit.
The wake-driven turn later emits its own completion_result row.
Net effect: TWO completion_result rows for ONE logical terminal event.
```

## WHY C10 ≠ SEAM B (distinct invariants)

| Layer | What it governs | Failure mode if absent |
|---|---|---|
| SEAM B (framework) | `setTurnPhase("completed", ...)` lifecycle commit | Task phase advances to "completed" twice (or hangs) |
| SEAM A (message filter) | `result.messages` reaching `appendAndEmit` | One extra `say:"completion_result"` row per originating turn that should be suppressed when the wake-driven turn owns terminal completion |

When SEAM B holds the lifecycle commit (wake-driven turn owns completion),
the originating turn's `done` event still flows through `result.messages`
containing the `say:"completion_result"` row. SEAM A strips it; SEAM B
does NOT.

## ABLATION EVIDENCE SUMMARY (bounded correction ROUND 1)

```
Matrix A — canonical wake-delivered discriminator:
+-----------------------------------+-------+--------------------+-------+
| Test                              | C10   | framework_commits  | rows  |
+-----------------------------------+-------+--------------------+-------+
| C10-ABLATION-01-NOTIFY-ON         | ON    | 0                  | 0     |
| C10-ABLATION-01-NOTIFY-OFF        | OFF   | 0 (identical)      | 2 (1) |
| C10-ABLATION-01-NOTIFY-OFF-MULTI  | OFF   | 0                  | 2 (1) |
+-----------------------------------+-------+--------------------+-------+

Matrix B — non-notify completion:
+-----------------------------------+-------+--------------------+-------+
| C10-ABLATION-02-NON-NOTIFY        | OFF   | 1 (no notify)      | 2 (1) |
+-----------------------------------+-------+--------------------+-------+

Matrix C — lost wake (wake dispatch FAILED):
+-----------------------------------+-------+--------------------+-------+
| C10-ABLATION-03-LOST-WAKE         | OFF   | 1 (wasWakeDispatch | 2 (1) |
|                                   |       | Failed -> ALLOW)   |       |
+-----------------------------------+-------+--------------------+-------+

Matrix D — fast exit (Path B drains marker via resolveObligation):
+-----------------------------------+-------+--------------------+-------+
| C10-ABLATION-04-FAST-EXIT         | OFF   | 1 (Path B wins)    | 2 (1) |
+-----------------------------------+-------+--------------------+-------+

Matrix E — multi-job per-jid narrow isolation:
+-----------------------------------+-------+--------------------+-------+
| C10-ABLATION-05-MULTI-JOB-ON      | ON    | 0 (per-jid narrow) | 0     |
| C10-ABLATION-05-MULTI-JOB-OFF     | OFF   | 0                  | 2 (1) |
+-----------------------------------+-------+--------------------+-------+
(2 = 2 raw rows / (1) = 1 visible box after collapse)
```

The Matrix A pair is the LOAD-BEARING bounded-correction criterion.
The isolation property (framework_commits identical across ON/OFF)
proves the difference is attributable ONLY to SEAM A.

## PRODUCTION DECISION

```
C10_NECESSARY = TRUE
PROTECTED_INVARIANT = "prevents second persisted completion_result row while framework phase completion remains exactly one (independent of the framework-level completion-commit barrier at setTurnPhase(completed))"
PRODUCTION_CHANGE = {
  removed_c10: false,
  added: 1 new TEST-ONLY option-bag method `shouldFilterCompletionResult`,
  external_behavior_change: NONE (predicate is absent in production wiring)
}
```

No production code behavior changed in this ACT. C10 message filter is
retained because the ablation proved it protects an independent
presentation invariant.

## HALTS

  HALT_C10_ABLATION_NOT_ISOLATED -> RESOLVED by bounded correction ROUND 1
    (SEAM-A-only predicate; canonical discriminator with framework_commits=0
     in both ON and OFF; isolation proven)

  No other halts triggered. Predecessor conservation matrix (13 files / 67
  tests) is unchanged and continues to pass.

## FOLLOWUP

None required.

The C10 message filter is load-bearing and is retained.
The framework-level completion-commit barrier (SEAM B) is independently
load-bearing and continues to be enforced at `setTurnPhase("completed", ...)`.

The two layers are NOT redundant. They protect different invariants and
both must remain.
