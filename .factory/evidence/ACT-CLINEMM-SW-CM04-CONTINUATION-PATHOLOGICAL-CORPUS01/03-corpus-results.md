# ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01 — corpus results (bounded correction ROUND 1)

ENTRY_HEAD=4b1f3d6914e78a231c6b292ee8f5fcda904239f4

## Per-scenario classification (BOUNDED CORRECTION ROUND 1)

The bounded correction adds a second test file
(`continuation-pathological-corpus01.swcm04.c24-c-bridge.test.ts`) that
drives the REAL `LocalRuntimeHost` + REAL `PendingPromptsController` for
the queue-mechanics scenarios. This resolves `HALT_PRODUCTION_SEAM_NOT_EXERCISED`.

| Scenario | Classification | Production seam exercised | Test file |
|---|---|---|---|
| P1 — simple user turn | **PASS_CURRENT** | SdkSessionEventCoordinator.setTurnPhase + barrier predicate | base |
| P2 — notify-owned J + wake-driven turn | **PASS_CURRENT** | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal | base |
| P3 — pending prompt at turn end | **PASS_CURRENT** (REAL drain) | LocalRuntimeHost.runTurn + PendingPromptService.enqueue + drain + runTurn re-entry | **BRIDGE** |
| P4 — queue-empty control | **PASS_CURRENT** | SdkSessionEventCoordinator.setTurnPhase + barrier predicate | base |
| P5 — steer at queue head | **PASS_CURRENT** (REAL drain) | LocalRuntimeHost.runTurn + PendingPromptService.enqueue (steer unshift) + drain (shiftNext) | **BRIDGE** |
| P6 — wake + ordinary queue prompt co-exist | **PASS_CURRENT** (REAL drain) | LocalRuntimeHost.runTurn + PendingPromptService.enqueue + drain | **BRIDGE** |
| P7 — wake drained BEFORE submit_and_exit | **PASS_CURRENT** | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal | base |
| P8 — lost wake (transport rejected) | **PASS_CURRENT** | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal (rejected ack) | base |
| P9 — two notify-owned J | **PASS_CURRENT** | SdkSessionEventCoordinator + BackgroundNotifyCoordinator dual-delivery arbitration | base |
| P10 — fast terminal race | **PASS_CURRENT** | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal | base |
| P11 — ask-user-question | **PASS_CURRENT** | SdkSessionEventCoordinator (no submit_and_exit path) | base |
| P12 — plan->act synthetic continuation | **NOT_APPLICABLE** | No such seam in current ClineMM source | base |
| A — duplicate jobIds | **PASS_CURRENT** (REAL drain) | LocalRuntimeHost.runTurn + PendingPromptService.enqueue | **BRIDGE** |
| B — stale prompt deleted | **PASS_CURRENT** (REAL delete + drain) | LocalRuntimeHost.runTurn + PendingPromptService.delete + drain | **BRIDGE** |
| E — two jobIds, one terminal | **PASS_CURRENT** | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal | base |
| H — sessionId mismatch | **PASS_CURRENT** | SdkSessionEventCoordinator + BackgroundNotifyCoordinator.consumeTerminal (owner-mismatch short-circuit) | base |

**Overall:** 15 PASS_CURRENT, 1 NOT_APPLICABLE (P12), 0 FAIL_CURRENT.
- Base file: 16 tests / 1 file / 11 PASS_CURRENT (P1, P2, P4, P7-P11, E, H) + 1 NOT_APPLICABLE (P12) + 4 PASS_CURRENT (P3, P5, P6, A, B) but driven via simulated queue
- Bridge file: 5 tests / 1 file / 5 PASS_CURRENT (P3, P5, P6, A, B) driven via REAL PendingPromptService + drain + runTurn re-entry

## Bridge real-class evidence (P3, P5, P6, A, B)

The bridge test file (`continuation-pathological-corpus01.swcm04.c24-c-bridge.test.ts`)
asserts REAL cardinality through the production `pendingPromptCapture` hooks:

| Bridge test | C4 enqueue | C5 dequeue | C6 dispatch | C7 runTurn | C8 agentDone | Queue final |
|---|---|---|---|---|---|---|
| P3-BRIDGE | 1 | 1 | 1 | 2 (1 trigger + 1 drained) | 2 | empty |
| P5-BRIDGE | 3 | 3 (order: steer, queue, queue) | 3 | 4 (1 trigger + 3 drained) | 4 | empty |
| P6-BRIDGE | 2 (one with jobId=J) | 2 | 2 | 3 (1 trigger + 2 drained) | 3 | empty |
| A-BRIDGE | 2 (both jobId=J; distinct queue entries) | 0 (not drained) | 0 | 0 (queue not drained yet) | 0 | 2 entries |
| B-BRIDGE | 1 (deleted before drain) | 0 | 0 | 1 (trigger only) | 1 | empty |

## FALSE_HANDOFF reproduction: NONE

The corpus did NOT reproduce any FALSE_HANDOFF defect. The C10 framework barrier (`outstandingAutonomousWork` predicate at `sdk-session-event-coordinator.ts:691-733`) correctly HOLDS completion whenever:
- pendingPromptAuthorityUnknown || pendingPromptsKnown > 0 || activeNotifyCount > 0 || perJobOutstandingNotifyWork

The barrier re-evaluation (`reevaluateDeferredCompletionBarrier`) correctly commits the held completion exactly once when all obligations resolve.

## FALSE_AUTOCONTINUE reproduction: NONE

The corpus did NOT reproduce any FALSE_AUTOCONTINUE defect. P11 (ask-user-question) confirms the user-attention boundary is allowed when the originating turn emits a non-terminal event.

## Real PendingPromptService + drain + runTurn re-entry reproduction: PASS

The bridge test proves the REAL `PendingPromptService` + drain + `LocalRuntimeHost.runTurn` re-entry chain correctly:
1. Appends FIFO for `delivery:"queue"`; unshift-prepends for `delivery:"steer"`.
2. Shifts the head entry on drain (steer preempts queue head).
3. Re-enters `runTurn` exactly once per drained prompt via `queueMicrotask(drain)`.
4. Does NOT dedupe by `jobId`.
5. Honors `pendingPrompts.delete({ sessionId, promptId })` BEFORE drain sees the entry.

No prompt loss, no duplicate continuation, correct steer ordering — all verified via real production hooks.

## Per-halt disposition

| Halt | Status |
|---|---|
| HALT_REPOSITORY_TRUST | NOT_TRIGGERED |
| HALT_PRODUCTION_SEAM_NOT_EXERCISED | **RESOLVED** (bounded correction ROUND 1: bridge test drives real LocalRuntimeHost + real PendingPromptService + real drain for P3/P5/P6/A/B) |
| HALT_RED_NOT_REPRODUCED | NOT_TRIGGERED |
| HALT_FALSE_HANDOFF_REPRODUCED | NOT_TRIGGERED |
| HALT_FALSE_AUTOCONTINUE_REPRODUCED | NOT_TRIGGERED |
| HALT_PROMPT_LOSS | NOT_TRIGGERED |
| HALT_DUPLICATE_CONTINUATION | NOT_TRIGGERED |
| HALT_SESSION_CROSSTALK | NOT_TRIGGERED |
| HALT_COMPLETION_REGRESSION | NOT_TRIGGERED |
| HALT_EXECUTABLE_GATE_REGRESSION | NOT_TRIGGERED |
| HALT_ARTIFACT_UNBOUND | NOT_TRIGGERED |

## Production seam under test

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:691-733` — the deferred-completion-barrier admission guard (BASE file). The harness drives this seam via `coordinator.handleSessionEvent(doneEvent)` (originating turn) and `coordinator.reevaluateDeferredCompletionBarrier()` (Path A / Path B wake-ack).

`sdk/packages/core/src/runtime/host/local-runtime-host.ts:1172-1280` and `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts` — the continuation chain (BRIDGE file). The harness drives this seam via `host.runTurn({ delivery, prompt, jobId })` with gate-controlled `canStartRun()`.

## Behavior NOT modified

- The C10 framework barrier (PROVEN in ACT-CLINEMM-C10-FILTER-ABLATION01) is untouched.
- The C10 message-layer filter (PROVEN in ACT-CLINEMM-C10-FILTER-ABLATION01) is untouched.
- `BackgroundNotifyCoordinator.consumeTerminal` / `dispatchAndTrackWake` (PROVEN in BNCA-REPAIR01 + LIVE-QUALIFICATION01) is untouched.
- `PendingPromptService` (in `sdk/packages/core`) is untouched.
- `LocalRuntimeHost` (in `sdk/packages/core`) is untouched.
- No production code is modified by this ACT.

## Verdict

**PASS_CONTINUATION_PATHOLOGICAL_CORPUS**

The bounded correction ROUND 1 resolved `HALT_PRODUCTION_SEAM_NOT_EXERCISED`:
- COMPLETION_BARRIER_CORPUS = PASS (real SdkSessionEventCoordinator + real BackgroundNotifyCoordinator, base file)
- NOTIFY_AUTHORITY_CASES = PASS (real notify-owned marker + dual-delivery arbitration, base file)
- REAL_PENDING_PROMPT_SERVICE = EXERCISED (bridge file)
- REAL_DRAIN = EXERCISED (bridge file)
- REAL_RUNTURN_REENTRY = EXERCISED (bridge file)
- STEER_ORDERING = EXERCISED via real drain (bridge file)
- DUPLICATE_CONTINUATION_PROOF = EXERCISED via C5/C6 capture (bridge file)

The continuation / handoff boundary is provably correct on current HEAD. The corpus is permanent regression coverage. C10 chain (C10-FILTER-ABLATION01 PASS_C10_ABLATION_RETAINED, BNCA-REPAIR01 PASS_WITH_NONBLOCKING_RESIDUE) and BackgroundNotifyCoordinator authority remain UNCHANGED. The next SW-CM backlog item can proceed on a confirmed-clean continuation substrate.
