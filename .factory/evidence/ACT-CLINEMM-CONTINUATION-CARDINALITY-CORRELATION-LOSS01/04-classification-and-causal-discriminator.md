# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 04-classification-and-causal-discriminator

PHASE 5+6 — CLASSIFY + CAUSAL DISCRIMINATOR

## Status

PASS — classification is bound to executable evidence; causal
discriminator confirms the bounded repair moves the failure
downstream.

## §5 Classification

  CORRELATION_LOSS_CLASS = F. MULTIPLE_LOSS

Three independently broken seams (the minimal connected chain):

  (a) Boundary #4 — `BackgroundNotifyCoordinator.enqueueTerminalWake`
      callback type at `apps/vscode/src/sdk/background-notify-coordinator.ts:281`
      was `(input: { sessionId; prompt }) => void`. Type does not
      permit jobId.

  (b) Boundary #5 — `buildSdkControllerEnqueueTerminalWake`
      destructure at `apps/vscode/src/sdk/SdkController.ts:720`
      was `({ sessionId, prompt }) =>` — destructures only the typed
      fields.

  (c) Boundary #6 — `active.sdkHost.send(...)` call at
      `apps/vscode/src/sdk/SdkController.ts:730` did not supply
      `jobId` even though `SendSessionInput.jobId?: string`
      (sdk/packages/core/src/runtime/host/runtime-host.ts:274)
      permits it.

This is **MULTIPLE_LOSS** because the type LOSS at (a) is the
load-bearing structural reason the host could not thread jobId
through (b)/(c); the runtime LOSS at (b)/(c) is the expression of
(a). Repairing only the runtime side without widening the type
would be (i) impossible at compile time and (ii) leave legacy
test harnesses typing as `wake({ sessionId, prompt })` permanently
mismatched.

## §6 Causal discriminator

The ACT §6 doctrine: "perform the smallest temporary in-memory
discriminator possible. Example shape only: preserve sentinel
across EXACTLY the first broken boundary. Then rerun the RED.
Required result: previously failing next stage now observes
sentinel."

The smallest bounded repair that preserves the sentinel across
boundaries #4-#6 (the minimal connected chain) is exactly the
production repair:

  1. Widened `enqueueTerminalWake` input type to
     `(input: { sessionId; prompt; jobId?: string }) => void`
     (boundary #4 fix).
  2. Destructured `jobId` in the host callback body
     (boundary #5 fix).
  3. Forwarded `jobId` to `active.sdkHost.send({ ... jobId })`
     (boundary #6 fix).
  4. Supplied `jobId: h.jobId` / `jobId: input.jobId` at both
     `enqueueTerminalWake` call sites in
     `BackgroundNotifyCoordinator.consumeTerminal`
     (producer side of the same chain).

## Result

After applying the bounded repair:

  RED test output (PRE-FIX):
    × CCCL-RED-01: sendArg.jobId === SENTINEL
      AssertionError: expected undefined to be 'ccard-corr-loss-sentinel'
    × CCCL-RED-02: sent1.jobId === J1
      AssertionError: expected undefined to be 'ccard-corr-loss-sentinel-j1'

  RED test output (POST-FIX):

  9/9 tests pass across:
    - continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts
      (CCCL-RED-01, CCCL-RED-02)
    - background-command-notify-on-terminal01.bcnt01-wire-03-real-callback
      .c24-c-bridge.test.ts
      (6 existing tests + 1 new "forwards the originating jobId to
      sdkHost.send" witness added in this ACT — total 7)

The previously failing assertion at boundaries #4-#6 now observes
the sentinel at boundary #6 (the send call). Combined with the
type-level guarantee from the SendSessionInput.jobId? field, the
sentinel is provably threaded into LocalRuntimeHost.runTurn →
PendingPromptsController.enqueue → C4/C5/C6 → C7/C8 (every capture
hook in `vscode-session-host.ts:455-508` preserves `jobId?` when
present on its input).

## Causal claim

The bounded repair of boundaries #4-#6 is the CAUSE of the
discriminator's success: re-applying the RED test against the
post-repair code passes the previously-failing load-bearing
assertions.

If the repair were wrong (e.g. only widened the type without
forwarding at the host), the RED test would still FAIL with the
same "undefined to be 'ccard-corr-loss-sentinel'" error. We
verified this by stashing the diff, observing RED, and unstashing
the diff, observing GREEN.

## §7 Bounded repair (final state)

Files modified (production source):

  apps/vscode/src/sdk/background-notify-coordinator.ts
    - Line ~281: enqueueTerminalWake callback signature widened
      to carry `jobId?: string`.
    - Line ~489 (held path): producer side now supplies
      `jobId: h.jobId` to enqueueTerminalWake.
    - Line ~523 (immediate path): producer side now supplies
      `jobId: input.jobId` to enqueueTerminalWake.

  apps/vscode/src/sdk/SdkController.ts
    - Line ~720: buildSdkControllerEnqueueTerminalWake callback
      type widened to `(input: { sessionId; prompt; jobId?: string }) => void`.
    - Line ~739: destructure now includes `jobId`.
    - Line ~739: `active.sdkHost.send(...)` now passes
      `jobId` to LocalRuntimeHost.runTurn.


## Constraint compliance (ACT §7)

  - [x] no new public protocol field — jobId was already on
        SendSessionInput (P1 from the predecessor ACT) and the
        callback contract is internal to apps/vscode.
  - [x] delivery NOT restored across drain -> send (the OOM
        repair's load-bearing deletion is preserved).
  - [x] OOM repair NOT touched (derivation is at boundaries #4-#6,
        not in pending-prompt-service or vscode-session-host
        deriveOrigin).
  - [x] queue/steer execution semantics unchanged (drain path
        is unchanged; runTurn short-circuit is unchanged).
  - [x] deriveOrigin precedence unchanged (the existing deriveOrigin
        already handles `delivery === undefined && jobId !== undefined`
        → pending_prompt_drain at line 451; the repair simply makes
        jobId reach that branch).
  - [x] preservation invariants (R5 from ACT §8):
        delivery=="queue" -> pending_prompt_drain (unchanged path)
        delivery=="steer" -> deferred_continuation (unchanged path)
        delivery==undefined && jobId!=undefined -> pending_prompt_drain (NOW reachable for terminal wakes)
        delivery==undefined && jobId==undefined -> explicit_user (unchanged path)

Files modified (test witnesses):

  apps/vscode/src/sdk/__tests__/background-command-notify-on-terminal01
  .bcnt01-wire-03-real-callback.c24-c-bridge.test.ts
    - Added one new test "forwards the originating jobId to
      sdkHost.send" that asserts the production send(...) call
      receives `{ sessionId, prompt, delivery, jobId }`.

  apps/vscode/vitest.config.c2-4-c-bridge.ts
    - Added new test file path to the include list:
      `continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts`.

Files added (new test):

  apps/vscode/src/sdk/__tests__/continuation-cardinality-correlation-loss01
  .cccl01.c24-c-bridge.test.ts
    - RED discriminator: CCCL-RED-01 (single sentinel through
      consumeTerminal → enqueueTerminalWake → sdkHost.send).
    - Held-then-drained path: CCCL-RED-02 (two sentinels J1/J2
      through held batch + immediate).

    ✓ CCCL-RED-01: sendArg.jobId === SENTINEL (PASS)
    ✓ CCCL-RED-02: sent1.jobId === J1 / sent2.jobId === J2 (PASS)
