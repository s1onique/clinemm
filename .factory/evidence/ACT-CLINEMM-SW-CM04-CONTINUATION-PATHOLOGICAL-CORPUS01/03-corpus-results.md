# ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01 — corpus results

ENTRY_HEAD=4b1f3d6914e78a231c6b292ee8f5fcda904239f4

## Per-scenario classification

| Scenario | Classification | Behavior observed | Comment |
|---|---|---|---|
| P1 — simple user turn | **PASS_CURRENT** | completionCommitCount=1, no marker | Negative control |
| P2 — notify-owned J + wake-driven turn | **PASS_CURRENT** | Held at originating (1), commits ONCE after wake | Canonical false-handoff control |
| P3 — pending prompt at turn end | **PASS_CURRENT** | Held, commits after queue drain | pendingPromptsKnown > 0 holds the barrier |
| P4 — queue-empty control | **PASS_CURRENT** | Commits normally | Negative of P3 |
| P5 — steer at queue head | **PASS_CURRENT** | Held, drain order is steer, queue, queue | Steer preempts queue head |
| P6 — wake + ordinary queue prompt | **PASS_CURRENT** | Held, commits ONCE after both drain | No duplicate continuation |
| P7 — wake drained BEFORE submit_and_exit | **PASS_CURRENT** | wasWakeDelivered=true SUPPRESSES origin | Per the C10 framework barrier |
| P8 — lost wake (transport rejected) | **PASS_CURRENT** | wasWakeDispatchFailed=true ALLOWs origin; no phantom prompt | Lost-wake protocol |
| P9 — two notify-owned J | **PASS_CURRENT** | J1 wake HELD until J2 terminal; both delivered; commit ONCE | Dual-delivery arbitration |
| P10 — fast terminal race | **PASS_CURRENT** | Single wake in queue; completion held | No duplicate wake |
| P11 — ask-user-question | **PASS_CURRENT** | No submit_and_exit; user-attention allowed | FALSE_AUTOCONTINUE control |
| P12 — synthetic continuation | **NOT_APPLICABLE** | No plan->act synthetic seam in current source | ClineMM does not implement upstream's synthetic continuation |
| A — duplicate jobIds | **PASS_CURRENT** | Two distinct queue entries | Idempotency is by-call |
| B — stale prompt deleted | **PASS_CURRENT** | Barrier releases after delete | Drain-clear semantics |
| E — two jobIds, one terminal | **PASS_CURRENT** | Completion HELD on the second marker | Multi-job isolation |
| H — sessionId mismatch | **PASS_CURRENT** | Other-session marker does NOT pollute active session | Owner-key projection |

**Overall:** 15 PASS_CURRENT, 1 NOT_APPLICABLE (P12), 0 FAIL_CURRENT.

## FALSE_HANDOFF reproduction: NONE

The corpus did NOT reproduce any FALSE_HANDOFF defect. The C10 framework barrier (`outstandingAutonomousWork` predicate at `sdk-session-event-coordinator.ts:691-733`) correctly HOLDS completion whenever:
- pendingPromptAuthorityUnknown || pendingPromptsKnown > 0 || activeNotifyCount > 0 || perJobOutstandingNotifyWork

The barrier re-evaluation (`reevaluateDeferredCompletionBarrier`) correctly commits the held completion exactly once when all obligations resolve.

## FALSE_AUTOCONTINUE reproduction: NONE

The corpus did NOT reproduce any FALSE_AUTOCONTINUE defect. P11 (ask-user-question) confirms the user-attention boundary is allowed when the originating turn emits a non-terminal event.

## Per-halt disposition

| Halt | Status |
|---|---|
| HALT_REPOSITORY_TRUST | NOT_TRIGGERED |
| HALT_PRODUCTION_SEAM_NOT_EXERCISED | NOT_TRIGGERED |
| HALT_RED_NOT_REPRODUCED | NOT_TRIGGERED |
| HALT_FALSE_HANDOFF_REPRODUCED | NOT_TRIGGERED |
| HALT_FALSE_AUTOCONTINUE_REPRODUCED | NOT_TRIGGERED |
| HALT_PROMPT_LOSS | NOT_TRIGGERED |
| HALT_DUPLICATE_CONTINUATION | NOT_TRIGGERED |
| HALT_SESSION_CROSSTALK | NOT_TRIGGERED |
| HALT_COMPLETION_REGRESSION | NOT_TRIGGERED |
| HALT_EXECUTABLE_GATE_REGRESSION | NOT_TRIGGERED |

## Production seam under test (canonical handoff decision)

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:691-733` — the deferred-completion-barrier admission guard, with the four-conservation predicate `outstandingAutonomousWork`. The harness drives this seam via `coordinator.handleSessionEvent(doneEvent)` (originating turn) and `coordinator.reevaluateDeferredCompletionBarrier()` (Path A / Path B wake-ack).

## Behavior NOT modified

- The C10 framework barrier (PROVEN in ACT-CLINEMM-C10-FILTER-ABLATION01) is untouched.
- The C10 message-layer filter (PROVEN in ACT-CLINEMM-C10-FILTER-ABLATION01) is untouched.
- `BackgroundNotifyCoordinator.consumeTerminal` / `dispatchAndTrackWake` (PROVEN in BNCA-REPAIR01 + LIVE-QUALIFICATION01) is untouched.
- `PendingPromptService` (in `sdk/packages/core`) is untouched.
- No production code is modified by this ACT.

## Verdict

**PASS_CONTINUATION_PATHOLOGICAL_CORPUS**
