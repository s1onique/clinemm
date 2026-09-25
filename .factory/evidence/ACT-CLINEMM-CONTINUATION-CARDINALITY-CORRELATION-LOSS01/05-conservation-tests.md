# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 05-conservation-tests

PHASE 8 — CONSERVATION TESTS

## Status

PASS — every conservation assertion from ACT §8 is exercised by
real production seams and either passes or is explicitly
rationalized below.

## R1–R12 mapping

| # | Assertion | Test file | Result | Notes |
|---|-----------|-----------|--------|-------|
| R1 | terminal wake jobId reaches PendingPromptEntry | ccc01 + bcnt01-wire.c24-c-bridge | PASS | The CCCL01-RED-01 sentinel drives `consumeTerminal` → `enqueueTerminalWake` → `sdkHost.send({jobId})` → `LocalRuntimeHost.runTurn` (real production) → `PendingPromptsController.enqueue` (production). The wake_created capture record (line 484) carries jobId; the new RED discriminator confirms send(...).jobId === SENTINEL. The PendingPromptEntry preservation is bound by `pending-prompt-service.test.ts` DRP-DRAIN-CONSERVE suite. |
| R2 | C4 preserves jobId | continuation-cardinality-authority01.ccard01.test.ts | PASS | Capture module + production adapter at `vscode-session-host.ts:455-463` thread `jobId` through. CCARD01 captures the canonical record; production adapter wires the input through unchanged. |
| R3 | C5 preserves same jobId | pending-prompt-service.test.ts + vscode-session-host.ts:464-475 | PASS | `onBeforeDrain` at `pending-prompt-service.ts:445-452` reads `next.jobId` from the dequeued entry (which got it from enqueue); the production adapter at `vscode-session-host.ts:464-475` records the captured jobId. |
| R4 | C6 preserves same jobId | pending-prompt-service.test.ts + vscode-session-host.ts:476-489 | PASS | Same pattern as C5; `onBeforeDispatch` at `pending-prompt-service.ts:467-473`. |
| R5 | drain -> send preserves jobId but does NOT preserve delivery | pending-prompt-service.drain-semantics.test.ts | PASS | The OOM repair's load-bearing invariant — `delivery` is dropped at `pending-prompt-service.ts:503` (NOT spread), while `jobId` IS spread at line 503 (`...(next.jobId !== undefined ? { jobId: next.jobId } : {})`). The drain-semantics test asserts this dual behavior directly. |
| R6 | C7 observes same jobId and origin=pending_prompt_drain | derive-origin-precedence.test.ts + local-runtime-host.ts:1227-1233 | PASS | `deriveOrigin` at `vscode-session-host.ts:445-453` handles `delivery === undefined && jobId !== undefined` → `pending_prompt_drain` (line 451). Pre-repair: `input.jobId === undefined` for terminal-wake-driven runs, so deriveOrigin fell through to `explicit_user`. Post-repair: `input.jobId === SENTINEL`, deriveOrigin returns `pending_prompt_drain`. |
| R7 | C8 observes same jobId and origin=pending_prompt_drain | Same as R6 | PASS | The C8 capture hook is the same code path; the deriveOrigin call at `vscode-session-host.ts:504` returns `pending_prompt_drain` when jobId is present. |
| R8 | steer + jobId remains deferred_continuation | vscode-session-host.ts:450 + derive-origin-precedence.test.ts | PASS | `deriveOrigin` precedence is `delivery === "queue"` first (line 449), then `delivery === "steer"` (line 450), then `jobId !== undefined` (line 451). A steer wake with jobId would resolve to `deferred_continuation` first (line 450). The repair does NOT change deriveOrigin. |
| R9 | explicit queue caller semantics unchanged | pending-prompt-service.test.ts + bcnt01-wire-03 | PASS | `runTurn({ delivery: "queue" })` without jobId still derives `pending_prompt_drain` via `delivery === "queue"` branch. `runTurn({ delivery: "steer" })` still derives `deferred_continuation`. `runTurn({})` (no fields) still derives `explicit_user`. The 6 existing bcnt01-wire-03 tests (excluding the new jobId-forwarding witness) cover this. |
| R10 | OOM repair drain-semantics tests remain GREEN | pending-prompt-service.drain-semantics.test.ts | PASS | 4/4 tests in the drain-semantics suite pass. The OOM repair's deletion of `delivery` forwarding across drain -> send is preserved. |
| R11 | predecessor CLINEMM_OOM_DISC01 scaffolding remains absent | (static check) | PASS | `grep -r CLINEMM_OOM_DISC01 apps/vscode/src` returns no production-source matches (only the evidence directory references). The constructor attestation, env var, and esbuild `--define` were all removed in the OOM repair and have not been re-introduced. |
| R12 | no extra run/continuation is manufactured by the correlation fix | (static check + RED test) | PASS | The RED test runs `consumeTerminal` exactly once and asserts `send` was called exactly once for the single-wake case, exactly twice for the held-then-drained case (one per held item, one for the current). No extra dispatch is manufactured. The repair changes ONLY which fields are forwarded, never the call shape or count. |


## Test counts (final, post-repair)

  apps/vscode (base config):
    continuation-cardinality-authority01.ccard01.test.ts    : 12 PASS
    background-notify-exactly-once-presentation01.bcnex01   :  7 PASS
    derive-origin-precedence.test.ts                        :  2 PASS
    background-command-notify-on-terminal01.bcnt01.test.ts  : 24 PASS
    TOTAL base                                               : 45 PASS

  apps/vscode (bridge config):
    continuation-cardinality-correlation-loss01.cccl01      :  2 PASS  (NEW)
    background-command-notify-on-terminal01.bcnt01-wire-03
      -real-callback.c24-c-bridge                            :  7 PASS  (+1 NEW)
    background-command-notify-on-terminal01.bcnt01-wire
      -c24-c-bridge                                          :  1 PASS
    TOTAL bridge                                             : 10 PASS

  sdk/packages/core:
    pending-prompt-service.test.ts                          : 10 PASS
    pending-prompt-service.drain-semantics.test.ts          :  4 PASS
    TOTAL sdk turn-queue                                     : 14 PASS

  GRAND TOTAL                                                : 69 PASS

## Pre-existing failures (NOT caused by this ACT)

These failures are pre-existing and are documented in the
predecessor ACTs / .clinerules:

  sdk/packages/core/src/runtime/host/local-runtime-host.test.ts
    > persists active manual compaction state against the
      persisted transcript
    STATUS: pre-existing — relates to currentWorkingContextEstimate
    drift (see `.clinerules/sdk-transport-integration.md`
    HALT_RUNTIME_SNAPSHOT_DOES_NOT_CARRY_W_OPERANDS). NOT caused
    by this ACT. Verified via git stash before/after.

  apps/vscode/src/sdk/SdkController.test.ts
    > SDK remote-config coordination (3 tests)
    STATUS: pre-existing — relates to remote-config readiness
    wiring. NOT caused by this ACT. Verified via git stash
    before/after.

These are ACT-owned-DIAGNOSTIC-free for this ACT (the new RED
discriminator does NOT add new diagnostics). Baseline diagnostics
may remain baseline per ACT §9.
