# ACT-CLINEMM-P0-COMPLETION-REEVALUATION-CAPABILITY-DISCRIMINATOR01 / CRCD01 — 01 Reevaluation capability discriminator

## Reviewer directive (verbatim from the UCHC01 HALT)

> "Do not start another broad review or production repair. Reuse the existing UCHC01/TWQC01 infrastructure for one causal discriminator: ACT-CLINEMM-P0-COMPLETION-REEVALUATION-CAPABILITY-DISCRIMINATOR01. Its entire job is to test both actual reevaluation triggers with a held result and `command_status` unavailable, recording: 1. Whether the trigger reaches `enqueueCompletionContinuationIfHeld`. 2. Whether the real Elm kernel receives `canObserveHeldResults=true` despite unavailable capability. 3. Whether the host actually enqueues, dequeues, and starts another runtime turn for the same unchanged obligation. Require exact session/task/epoch/held-job correlation. Do not inject the fixed Elm sentinel or substitute an in-memory queue. Reuse the real boundary setup from TWQC01. If this reproduces an unjustified continuation, fix that one production boundary, prove ablation, and stop. If it doesn't, preserve the GREEN results and report `NOT_REPRODUCED`; do not invent another repair."

## Three questions the probe answers

| # | Question | Load-bearing observable |
|---|----------|------------------------|
| Q1 | Does the reeval path (terminal-idle / post-run) reach `enqueueCompletionContinuationIfHeld` when capability is unavailable? | `enqueueIfHeldEntered` counter (U8 discriminator at `sdk-session-event-coordinator.ts:1488`) |
| Q2 | Does the real Elm kernel receive `canObserveHeldResults: true` despite the live resumed-turn tool registry not exposing `command_status`? | The `input.capabilities.canObserveHeldResults` argument of every `pickContinuationDirectiveForPublication` call captured by the spied export. |
| Q3 | Does the host actually enqueue, dequeue, and start another runtime turn for the same unchanged obligation? | The `runTurn` spy records every call to the REAL `LocalRuntimeHost.runTurn`; the `agent.run` spy records every model invocation. |

## Real boundaries exercised

- **REAL** `LocalRuntimeHost` from `sdk/packages/core/src/runtime/host/local-runtime-host/` (bypassing the `@cline/core` bundle stub alias via the `@cline-internal/core/runtime/host/local-runtime-host` resolve alias declared only in `apps/vscode/vitest.config.crcd01.ts`).
- **REAL** `PendingPromptsController` (enqueue + drain) via the `@cline-internal/core/runtime/turn-queue/pending-prompt-service` resolve alias.
- **REAL** `pickContinuationDirectiveForPublication` (spied, not stubbed) so the exact capabilities the host passes to the Elm kernel are observable.
- **REAL** `runTurn` chain (spied, not stubbed) so enqueue/dequeue/dispatch events are observable.
- **REAL** `setElmAuthorityProvider(REAL_KERNEL_PATH)` from `elm/completion-authority/vendor/completion-authority.js` (same path the other bridge tests pin).
- **REAL** `buildSdkControllerEnqueueCompletionContinuation` factory from `SdkController.ts:842` (no re-implementation).

## Bypassed / replaced surfaces

NONE. The harness does NOT inject a fixed Elm sentinel, does NOT substitute an in-memory queue, and does NOT bypass any boundary. Every observable is the real production chain.

## Identity discipline

Every test:
- Uses a fresh `sessionId` and `taskId` (sess-crcd01-01..04, task-crcd01-01..04).
- Records the `epoch` at BCB marker pre-arm.
- Asserts the held set is the same on the `enqueueIfHeldEntered` increment and the reeval trigger.

## RED/GREEN timeline

| Step | Test | State |
|------|------|-------|
| Initial write | CRCD01-01, CRCD01-02, CRCD01-03, CRCD01-04 | All 4 FAIL (production defect reproduced at line 1546-1547 — `canObserveHeldResults: true, canRetryCompletion: true` hardcoded regardless of `liveTools()`) |
| Apply fix at line 1559-1566 | Re-run | All 4 PASS (the inner enqueue's `pickContinuationDirectiveForPublication` call now projects truthful capability from `this.options.liveTools?.()`) |
| Verify predecessor | CCUTO01 (14 tests) | 11 PASS, 3 FAIL (the 3 tests were designed against the old "fail-closed footer in prompt" behavior; the new fix fail-closes at the inner enqueue BEFORE the factory, so no prompt is sent for capability-unavailable cases) |
| Update 3 CCUTO01 tests to reflect new bounded behavior | Re-run | All 14 CCUTO01 PASS |
| Combined run | CRCD01 (4) + CCUTO01 (14) + UCHC01 (7) | 25/25 PASS |

## Verdict synthesis

`CRCD_PRODUCTION_DEFECT`. The reeval path at `sdk-session-event-coordinator.ts:1184` calls `enqueueCompletionContinuationIfHeld` which at line 1543-1554 HARDCODED `canObserveHeldResults: true, canRetryCompletion: true` regardless of the live resumed-turn tool registry. The fix projects truthful capability from `this.options.liveTools?.()` (same projection the BCB block at line 2704-2734 uses). Ablation proven: all 4 CRCD01 tests + 14 CCUTO01 tests + 7 UCHC01 tests PASS after the fix. Predecessor tests (UCHC01, CCUTO01, CTQC01-CORR01, CCPW01) all PASS.

## Production change

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts` line 1543-1566: the `pickContinuationDirectiveForPublication` call at the inner enqueue's call site now projects `canObserveHeldResults` and `canRetryCompletion` from `this.options.liveTools?.()`. The `liveTools === undefined` case is treated as `false` (honest "I don't know" → fail-closed at the kernel level via `observation_unavailable`).

## Test infrastructure added

- `apps/vscode/vitest.config.crcd01.ts` — dedicated vitest config mirroring TWQC01 with the `@cline-internal/core/...` aliases.
- `apps/vscode/package.json` — added `test:vitest:crcd01` script.
- `apps/vscode/vitest.config.ts` — added crcd01 test to the `exclude` list (base config does not have the bridge aliases).
- `apps/vscode/tsconfig.json` — added crcd01 test to the `exclude` list (base config does not have the bridge aliases).
