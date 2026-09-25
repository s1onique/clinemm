# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 03-red-discriminator

PHASE 3+4 — CORRELATION SENTINEL + RED REQUIREMENT

## Status

PASS — RED reproduced the live defect.

## Sentinel

  jobId = "ccard-corr-loss-sentinel"   (CCCL-RED-01)
  jobId = "ccard-corr-loss-sentinel-j1" / "-j2"   (CCCL-RED-02, held-then-drained)

The sentinel is unique enough to be fingerprinted in any future
production log without collision with real production jobIds.

## Test file

  apps/vscode/src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts

The test imports the REAL production classes:

  - `BackgroundNotifyCoordinator` from
    `apps/vscode/src/sdk/background-notify-coordinator.ts`
  - `buildSdkControllerEnqueueTerminalWake` from
    `apps/vscode/src/sdk/SdkController.ts` (the EXACT factory the live
    `Controller` constructor passes to `new BackgroundNotifyCoordinator`)
  - `ContinuationCardinalityAuthority` capture ring from
    `apps/vscode/src/sdk/continuation-cardinality-authority.ts`
  - `ActiveSession` interface from
    `apps/vscode/src/sdk/cline-session-factory.ts`

The test runs under
`apps/vscode/vitest.config.c2-4-c-bridge.ts` (which carries the `@/sdk/...`
and `vscode` aliases the test needs; same as the precedent
`bcnt01-wire-03-real-callback.c24-c-bridge.test.ts`).

## Test execution chain

The test drives the same chain that produces C3 wake_created in
production:

```
coordinator.registerMarker({jobId: SENTINEL, ...})
  ↓
coordinator.consumeTerminal({jobId: SENTINEL, ...})
  ↓ (C2 capture: notify_consume_enter — observes jobId)
  ↓ (C3 capture: wake_created — observes jobId)
  ↓ (calls this.options.enqueueTerminalWake({sessionId, prompt}))
buildSdkControllerEnqueueTerminalWake({...})({sessionId, prompt})
  ↓ (calls active.sdkHost.send({sessionId, prompt, delivery: "queue"}))
sdkHost.send mock
```

The test inspects the captured wake_created record AND the actual
production `send(...)` call argument.

## Expected (per ACT §4)

  wake_created.jobId === SENTINEL          (PASSES — sanity)
  send({...}).jobId   === SENTINEL          (FAILS — defect)
  send({...}).sessionId === session.sessionId (PASSES — sanity)
  send({...}).delivery === "queue"          (PASSES — sanity)
  host warns.length  === 0                  (PASSES — no error)

## Actual (RED output)

Full output: `03-red-discriminator-output.txt`.

CCCL-RED-01 (single sentinel):
```
FAIL src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts
> CCCL01 -- RED: wake_created.jobId must reach sdkHost.send(input)
> CCCL-RED-01: BackgroundNotifyCoordinator.consumeTerminal -> send() preserves jobId sentinel
AssertionError: expected undefined to be 'ccard-corr-loss-sentinel' // Object.is equality

- Expected: "ccard-corr-loss-sentinel"
+ Received: undefined

   115|   expect(sentArg?.["sessionId"]).toBe(session.sessionId)
   116|   expect(sentArg?.["delivery"]).toBe("queue")
   117|   expect(sentArg?.["jobId"]).toBe(SENTINEL)
       |                              ^
   118|
   119|   expect(warns).toHaveLength(0)
```

CCCL-RED-02 (held-then-drained — two sentinels):
```
FAIL src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts
> CCCL01 -- RED: wake_created.jobId must reach sdkHost.send(input)
> CCCL-RED-02: held-then-drained second jobId also reaches sdkHost.send(input)
AssertionError: expected undefined to be 'ccard-corr-loss-sentinel-j1' // Object.is equality

- Expected: "ccard-corr-loss-sentinel-j1"
+ Received: undefined

   164|   expect(sent1?.["sessionId"]).toBe(session.sessionId)
   165|   expect(sent2?.["sessionId"]).toBe(session.sessionId)
   166|   expect(sent1?.["jobId"]).toBe(J1)
       |                            ^
```

Both RED tests fail at the load-bearing assertion:

  send(...).jobId === SENTINEL  (undefined !== SENTINEL)

## Discriminator (per ACT §4)

The first failing assertion is the discriminator:

  JOB_ID_FIRST_LOST_HERE = active.sdkHost.send(...) call site (SdkController.ts:730)
  i.e. boundary #6 in 02-recon.md.

## §4 RED requirement satisfied

The RED test reproducibly fails for the SAME root cause as the live
failure: jobId is present at the producer (consumeTerminal), present
in the wake_created record, but never reaches `sdkHost.send(...)`.

The recon's predicted loss boundary #4 (callback type) is the load-
bearing structural reason; boundary #6 (host call) is the runtime
expression of the same defect. The repair must fix BOTH.

This ACT does NOT yet repair — first the causal discriminator (§6)
will confirm that fixing boundary #4+#6 actually moves the failure
downstream (i.e. the post-repair C4-C8 hooks will then observe the
sentinel).
