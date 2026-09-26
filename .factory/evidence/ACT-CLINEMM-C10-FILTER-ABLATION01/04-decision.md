# ACT-CLINEMM-C10-FILTER-ABLATION01 — Decision

## Verdict: PASS_C10_ABLATION_RETAINED (bounded correction ROUND 2)

The C10 message-layer completion_result filter at
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:L689..L797` is
LOAD-BEARING and RETAINED.

The bounded correction ROUND 2 (in response to
`HALT_C10_DISCRIMINATOR_UNREACHABLE_STATE`) replaced the
synthetic re-armed discriminator with a NATURAL PRE-DELIVERY
discriminator that operates on the actually reachable production
chronology (the originating turn emits `done` while the background
job is still running; the notify marker is alive).

## Halt review (correction summary)

The ROUND 1 canonical discriminator manufactured an
unreachable production state by:

1. Calling `consumeTerminal(J)` which dispatched and delivered
   the wake (drained `notificationMarkers`, set
   `wasWakeDelivered=true`).
2. Then **re-registering** the marker so
   `hasActiveNotify(J) === true` again at the originating turn's
   `done` event.

The reviewer's halt was correct: that state
(`wasWakeDelivered=true` AND `hasActiveNotify=true`) is
unreachable in production. `markWakeDelivered` only operates on
`wakeDispatchRequestedJobIds` and `wakeDeliveredJobIds`; it
never re-arms `notificationMarkers`. The `notificationMarkers`
deletion in `consumeTerminal` (line 959) is the **terminal**
event for the marker — there is no production path that
re-adds it.

## Bounded correction ROUND 2: natural pre-delivery discriminator

The CORRECT canonical chronology is the one the recon already
described at L704-706 — the FROZEN BUG case:

```
frozen bug (premature J):
  ownedJobIds = [J]
  hasActiveNotify(J) = true  ← the originating turn emits `done`
                              while the background job is still
                              running, BEFORE the wake is dispatched.
```

In this state:

```
hasActiveNotify(J)            = true   (marker alive, job still running)
wasWakeDispatchRequested(J)   = false  (no consumeTerminal yet)
wasWakeDelivered(J)           = false
wasWakeDispatchFailed(J)      = false
isWakeAuthoritySettled(J)     = false
```

This is the only reachable state at the originating turn's
`done` event where SEAM A's narrow `hasActiveNotify(jid)`
predicate can fire. After `consumeTerminal`, the marker is
drained and the predicate cannot suppress.

The harness captures the full state at the moment SEAM A is
about to evaluate (`captureCoordinatorStateFor(h, jobId)`)
and asserts ALL FIVE probes have the natural pre-delivery
values.

## Discriminator (executable, isolated, natural state)

| Test | C10 | state.hasActiveNotify(J) | state.wasWakeDelivered(J) | framework_completion_commits | completion_result_rows | Outcome |
|------|-----|---------------------------|----------------------------|------------------------------|------------------------|---------|
| C10-ABLATION-01-NOTIFY-ON | ON | true | false | 0 | 0 | SUPPRESSED (canonical) |
| C10-ABLATION-01-NOTIFY-OFF | OFF | true | false | 0 (identical) | 2 raw / 1 visible box | LEAKS (canonical discriminator) |
| C10-ABLATION-01-NOTIFY-OFF-MULTI | OFF | true (J1, J2) | false (J1, J2) | 0 | 2 raw / 1 visible box | LEAKS |

**PROTECTED_INVARIANT = "prevents second persisted completion_result row reaching appendAndEmit while the originating turn's framework-level phase is held in the deferred barrier (independent of the framework-level completion-commit barrier at setTurnPhase(completed))"**

## SEAM-A isolation mechanism

Unchanged from ROUND 1: the test-only `shouldFilterCompletionResult`
option-bag method gates SEAM A only. SEAM B continues to read
`hasActiveNotify` / `wasWakeDelivered` /
`isWakeAuthoritySettled` / `getActiveNotifyCount` /
`wasWakeDispatchRequested` / `wasWakeDispatchFailed` through
their original option-bag methods. Production wires nothing.

## Gates (15 files / 78 tests, exit 0, vmThreads pool)

- TypeScript: clean (`TSC_RC=0`)
- Biome lint: clean (`BIOME_RC=0`)
- `git diff --check`: clean
- Raw artifact: 15 files / 78 tests / 11.72s / exit 0; zero
  `ForksPoolWorker / kill EPERM / uncaught` matches in raw lines
- 11 tests across 2 files: c10-filter-ablation01.{baseline,ablation}.test.ts

## Live qualification

Status: NOT_REQUIRED. Per ACT §14, retention requires no new
dogfood if the ACT changed no production behavior. The ONLY
production edit in this ACT is the TEST-ONLY option-bag
method (`shouldFilterCompletionResult`); the predicate is absent
in production wiring, so external behavior is unchanged. The
predecessor dogfood VSIX
(`dist/dogfood/clinemm-4.1.16-521f23482.vsix`, SHA256
`1f1af4ad2eb08f8230dd714b8ee9836f0a7d387bf5d4c49fd6b60f37094d02c7`)
already exercised the full notify-owned lifecycle end-to-end.

## Halt register

```
HALT_C10_DISCRIMINATOR_UNREACHABLE_STATE   RESOLVED (bounded correction ROUND 2: natural pre-delivery state with marker alive; state_at_seam_a captured for all five probes and asserted identical across ON and OFF; canonical discriminator passes)
HALT_C10_ABLATION_NOT_ISOLATED             RESOLVED (ROUND 1; SEAM-A-only predicate + canonical wake-delivered discriminator with framework_completion_commits=0 in BOTH runs)
HALT_FOCUSED_GATE_CLEAN                    RESOLVED (--pool=vmThreads artifact; 0 ForksPoolWorker / kill EPERM / uncaught matches)
HALT_REPOSITORY_TRUST                      NOT_TRIGGERED
HALT_SEAM_B_REGRESSION                     NOT_TRIGGERED
HALT_ZERO_COMPLETION                       NOT_TRIGGERED
HALT_DUPLICATE_TERMINAL_COMPLETION         NOT_TRIGGERED
HALT_NOTIFICATION_LOST                     NOT_TRIGGERED
HALT_MULTI_JOB_AUTHORITY_CROSSTALK         NOT_TRIGGERED
HALT_OOM_REGRESSION                        NOT_TRIGGERED
HALT_EXECUTABLE_GATE_REGRESSION            NOT_TRIGGERED
HALT_ARTIFACT_UNBOUND                      NOT_TRIGGERED
```

## Decisive Factory state

```
ACT                    = PASS_C10_ABLATION_RETAINED
PURPOSE                = necessity / ablation / simplification
BOUNDED_CORRECTION     = ROUND 2 (HALT_C10_DISCRIMINATOR_UNREACHABLE_STATE resolved)
C10_NECESSARY          = TRUE
C10_REMOVED            = FALSE
PROTECTED_INVARIANT    = "in the natural pre-delivery state (marker alive), the narrow hasActiveNotify(jid) predicate suppresses the originating turn's completion_result row before appendAndEmit; this is independent of the framework-level completion-commit barrier"
FRAMEWORK_AUTHORITY    = PRESERVED (SEAM B intact at setTurnPhase('completed', ...))
PRODUCTION_CHANGE      = TEST-ONLY option-bag method `shouldFilterCompletionResult`; external behavior unchanged
TESTS_ADDED            = 11 across 2 files
TESTS_TOTAL            = 78 across 15 files
GATES                  = 15 files / 78 tests / exit 0 / vmThreads / no ForksPool pollution
TYPECHECK              = clean (TSC_RC=0)
LINT                   = clean (BIOME_RC=0)
DIFF_CHECK             = clean
LIVE                   = NOT_REQUIRED
ENTRY_HEAD             = 6e4c70b5f24f701c5a68226fc185bb4966ce6d57
```

**Verdict:** PASS_C10_ABLATION_RETAINED.
