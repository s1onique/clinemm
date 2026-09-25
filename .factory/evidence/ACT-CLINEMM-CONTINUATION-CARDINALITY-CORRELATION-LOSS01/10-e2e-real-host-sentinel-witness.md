# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 10-e2e-real-host-sentinel-witness

PHASE 10 — DOWNSTREAM REAL-HOST SENTINEL WITNESS (post-review)

## Status — corrected per FACTORY re-review

PASS as a **composed-proof contributor**, NOT as a monolithic end-to-end witness.

The FACTORY reviewer's second pass correctly identified that this file
overclaims in two places:

1. The witness does NOT drive `BackgroundNotifyCoordinator.consumeTerminal`.
   It directly invokes `LocalRuntimeHost.runTurn(...)` with a supplied
   `jobId`. Therefore the producer side (`consumeTerminal` → `sdkHost.send`)
   is proven by the SEPARATE CCCL01 file; this witness only proves that
   once a sentinel arrives at `runTurn`, it survives the downstream chain.

2. The witness's `deriveOrigin` is a LOCAL reconstruction of the production
   precedence rules, not the production private `deriveOrigin` closure in
   `vscode-session-host.ts:445-453`. The C7/C8 origin conclusion therefore
   composes with the SEPARATE `derive-origin-precedence.test.ts` (2/2 PASS).

The honest statement of the witness's contribution is:

```
CCCL01-E2E proves:
  REAL LocalRuntimeHost.runTurn(jobId=SENTINEL)
    -> PendingPromptsController.enqueue  (C4 fires)
    -> drain -> C5 (onBeforeDrain)
    -> C6 (onBeforeDispatch)
    -> deps.send -> LocalRuntimeHost.runTurn (second call)
    -> C7 (onRunTurnStarted)
    -> executeTurn -> agent stub (delivery NOT forwarded)
    -> C8 (onAgentTurnDone)
  ALL five C4-C8 records carry jobId === SENTINEL (downstream
  preservation is REAL, not mocked).
```

The end-to-end proof is composed from:
- CCCL01: producer (`consumeTerminal` → `sdkHost.send`) with jobId
- CCCL01-E2E: downstream (runTurn → C8) preserves a supplied jobId
- `derive-origin-precedence.test.ts`: production precedence rules for `pending_prompt_drain`

This is documented in the corrected stop-condition verdict at
`08-stop-condition-verdict.md` (verdict renamed to
`PASS_CONTINUATION_CORRELATION_RESTORED_COMPOSED`).

## Witness file

`apps/vscode/src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01-e2e-real-host.c24-c-bridge.test.ts`

## Chain driven (precise)

```
[test code]
  LocalRuntimeHost.runTurn({ jobId: SENTINEL, delivery: "queue" })
    -> REAL PendingPromptsController.enqueue  (C4 fires)
    -> REAL PendingPromptsController.drain
       -> C5 fires (onBeforeDrain)
       -> C6 fires (onBeforeDispatch)
    -> REAL deps.send -> REAL LocalRuntimeHost.runTurn (second call)
       -> C7 fires (onRunTurnStarted, delivery=undefined,
                    jobId=SENTINEL -- preserved through deps.send
                    payload line 503 in pending-prompt-service.ts)
       -> REAL executeTurn -> REAL SessionRuntime -> REAL AgentRuntime
          (synthetic step model; agent-stub captures the call args;
           "delivery" is absent from those args, proving OOM repair
           is conserved)
       -> C8 fires (onAgentTurnDone, same derivation as C7)
```

The capture hooks (onEnqueue, onBeforeDrain, onBeforeDispatch,
onRunTurnStarted, onAgentTurnDone) are wired through the real
`pendingPromptCapture` option on `LocalRuntimeHost`, exactly mirroring
the production wiring in `apps/vscode/src/sdk/vscode-session-host.ts:445-509`.

The test does NOT exercise:
- `BackgroundNotifyCoordinator.consumeTerminal`
- `enqueueTerminalWake` callback construction in `SdkController`
- the `active.sdkHost.send` call site that calls `runTurn`
- the production `deriveOrigin` closure

These gaps are filled by CCCL01 (the producer side) and
`derive-origin-precedence.test.ts` (the production precedence rules).

## Tests

- **CCCL01-E2E-01**: a supplied sentinel jobId traverses the
  REAL `LocalRuntimeHost` downstream chain. Asserts all five
  C4-C8 records carry `jobId === SENTINEL` (downstream
  preservation), agent.run called exactly once, queue empty at
  settle, session status = "idle", and `delivery` is NOT forwarded
  from drain to the second `runTurn` call (preserves the OOM repair
  invariant).

- **CCCL01-E2E-02**: RED pre-fix discriminator. Drives
  `runTurn({ delivery: "queue" })` WITHOUT a jobId -- simulating
  the pre-fix producer shape (runTurn called without jobId).
  Asserts all five C4-C8 records observe `jobId === undefined`.
  Together with CCCL01-E2E-01, this proves the capture ring is
  sensitive to whether `runTurn` carries jobId through -- i.e. the
  test is genuinely exercising the correlation seam at the
  `runTurn` boundary, not coincidentally seeing the same value.

## Result

Both tests pass (2/2 PASS in 52ms).

## Constraint compliance (ACT §7)

- [x] no new public protocol field — `jobId` was already on `SendSessionInput`
- [x] delivery NOT restored across drain → send (OOM repair preserved;
      CCCL01-E2E-01 asserts `"delivery"` is absent from the agent-stub
      call args)
- [x] OOM repair NOT touched
- [x] queue/steer execution semantics unchanged
- [x] deriveOrigin precedence unchanged (production closure not modified;
      this test reconstructs the same precedence locally for the
      assertion only)
- [x] preservation invariants intact (CCCL01-E2E-02 explicitly
      demonstrates `deriveOrigin(undefined, undefined) === "explicit_user"`
      via the local reconstruction -- this is a structural check on the
      same precedence rules, not a check on the production function
      instance)

## Run

```
cd apps/vscode
bun run test:vitest:c2-4-c-bridge \
  src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01-e2e-real-host.c24-c-bridge.test.ts
```

Output:

```
✓ src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01-e2e-real-host.c24-c-bridge.test.ts (2 tests) 52ms
Test Files  1 passed (1)
Tests  2 passed (2)
```

