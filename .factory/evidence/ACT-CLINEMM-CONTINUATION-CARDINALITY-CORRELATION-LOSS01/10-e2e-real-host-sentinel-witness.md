# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 10-e2e-real-host-sentinel-witness

PHASE 10 — END-TO-END REAL-HOST SENTINEL WITNESS (post-review)

## Status

PASS — added after the FACTORY reviewer's HALT_CORRELATION_END_TO_END_NOT_PROVEN
verdict. The original CCCL01 RED proved only that a sentinel jobId reaches
the `sdkHost.send(...)` mock; the reviewer correctly noted this was not the
stronger stop condition the ACT required (one sentinel C4→C8). This file
documents the bounded real-host witness that closes the gap.

## Witness file

`apps/vscode/src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01-e2e-real-host.c24-c-bridge.test.ts`

## Chain driven

The witness drives the REAL production chain (no mocks past `sdkHost.send`):

```
BackgroundNotifyCoordinator.consumeTerminal(jobId=SENTINEL)  // producer
  -> real `enqueueTerminalWake` callback (with jobId)
  -> real `buildSdkControllerEnqueueTerminalWake` closure
  -> real `sdkHost.send` -> real `LocalRuntimeHost.runTurn`
  -> real `PendingPromptsController.enqueue`  (C4 fires)
  -> real `PendingPromptsController.drain`
    -> C5 fires (onBeforeDrain)
    -> C6 fires (onBeforeDispatch)
  -> real `deps.send` -> real `LocalRuntimeHost.runTurn`
    -> C7 fires (onRunTurnStarted, delivery=undefined,
                 jobId=SENTINEL)
    -> real `executeTurn` -> real `SessionRuntime` ->
       real `AgentRuntime` (synthetic step model)
    -> C8 fires (onAgentTurnDone, delivery=undefined,
                 jobId=SENTINEL)
```

The capture hooks (onEnqueue, onBeforeDrain, onBeforeDispatch,
onRunTurnStarted, onAgentTurnDone) are wired through the real
`pendingPromptCapture` option on `LocalRuntimeHost`, exactly mirroring
the production wiring in `apps/vscode/src/sdk/vscode-session-host.ts`.

## Tests

- **CCCL01-E2E-01**: one sentinel jobId traverses the REAL chain.
  Asserts all five C4-C8 records carry `jobId === SENTINEL`, C7/C8
  `deriveOrigin(delivery=undefined, jobId=SENTINEL) === "pending_prompt_drain"`,
  agent.run/continue called exactly once, queue empty at settle, session
  status = "idle", and `delivery` is NOT forwarded from drain to the
  second runTurn call (preserves the OOM repair invariant).

- **CCCL01-E2E-02**: RED pre-fix discriminator. Drives `runTurn({
  delivery: "queue" })` WITHOUT a jobId -- simulating the pre-fix
  producer shape. Asserts all five C4-C8 records observe `jobId ===
  undefined` and C7/C8 `deriveOrigin` returns `"explicit_user"` (the
  pre-fix failure mode). Together with CCCL01-E2E-01, this proves
  the capture ring is sensitive to whether the producer carries jobId
  through -- i.e. the test is genuinely exercising the correlation
  seam.

## Result

Both tests pass. The producer-side invariant
("CCCL01 = sentinel reaches sdkHost.send") and the
downstream-side invariant ("CCCL01-E2E = sentinel reaches C8 with
identical jobId across the real chain") are both proven.

The ACT's stated stop condition (one sentinel C4→C8 with identical
jobId, C7/C8 origin = pending_prompt_drain) is now backed by executable
evidence at the production boundary.

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

## Constraint compliance (ACT §7)

- [x] no new public protocol field — `jobId` was already on `SendSessionInput`
- [x] delivery NOT restored across drain → send (OOM repair preserved;
      CCCL01-E2E-01 asserts `"delivery"` is absent from the agent-stub
      call args)
- [x] OOM repair NOT touched
- [x] queue/steer execution semantics unchanged
- [x] deriveOrigin precedence unchanged
- [x] preservation invariants intact (CCCL01-E2E-02 explicitly
      demonstrates the `deriveOrigin(undefined, undefined) ===
      "explicit_user"` invariant holds)
