# 04 — Automatic Prime Live (LIVE-C + LIVE-D, operator observes)

## §11 LIVE-C: Automatic prime acquisition

The prime acquisition path runs once per session, driven by the
session-bound MCP lifecycle. The diagnostics scaffold records
acquisition state via the `getMycPrimeLiveDiag(sessionId)` API.

```text
PRIME_REQUEST_COUNT         = PENDING_OPERATOR_LIVE_RUN
PRIME_ATTEMPTED             = PENDING_OPERATOR_LIVE_RUN
PRIME_RESULT_STATUS         = PENDING_OPERATOR_LIVE_RUN
PRIME_RESULT_SESSION_ID     = PENDING_OPERATOR_LIVE_RUN
PRIME_RESULT_BYTES          = PENDING_OPERATOR_LIVE_RUN
PRIME_RESULT_CONTAINS_SENTINEL = PENDING_OPERATOR_LIVE_RUN
```

Target:

```text
PRIME_REQUEST_COUNT         = 1
PRIME_ATTEMPTED             = true
PRIME_RESULT_STATUS         = success
PRIME_RESULT_SESSION_ID     = S
PRIME_RESULT_BYTES          = <bytes containing the token ">
PRIME_RESULT_CONTAINS_SENTINEL = true
```

Failure boundaries:

```text
no automatic prime  -> HALT_AUTOMATIC_PRIME_NOT_INVOKED
prime fails         -> HALT_REAL_MYC_PRIME_FAILED
```

## §12 LIVE-D: Retrieval discriminator

If PRIME_RESULT_CONTAINS_SENTINEL=false, the operator runs externally:

```bash
myc recall "MYC-LIVE05-20260928-A"
MYC_SESSION_ID=<S> myc prime
```

Classify:

```text
recall=false
   -> HALT_SENTINEL_NOT_RETRIEVABLE

recall=true, prime=false
   -> HALT_MYC_PRIME_RETRIEVAL_SEMANTICS

recall=true, prime=true
   -> continue tracing ClineMM (no repair here)
```

## Diagnostic snapshot (operator steps)

Open Codium's Command Palette and run (or use a temporary probe
extension / ext.evaluate if you must):

```
> Cline: Show Current Task Diagnostics
```

Or paste into a Node REPL hooked to the extension host:

```js
const { getMycPrimeLiveDiag } = require('./out/src/sdk/myc-prime-live-diag');
console.log(JSON.stringify(getMycPrimeLiveDiag(<S>), null, 2));
```

The result should contain four sections:

```text
acquisition: {
  attempted: true,
  serverDetected: true,
  status: "ok",
  textPresent: true,
  textBytes: <N>
}
lookup: {
  attempted: true,
  snapshotSessionIdPresent: true,
  matchedRecordedSession: true,
  recordedPrimeFound: true,
  iteration: <N>
}
injection: {
  attempted: true,
  injected: true,
  reason: "ok",
  packetBytes: <N>,
  iteration: 1
}
capture: {
  captureId: "mycprime-<S>-<ts>",
  aiSdkPromptObserved: true
}
```

After the snapshot is taken, record into result.json:

```text
PRIME_REQUEST_COUNT       = 1
PRIME_ATTEMPTED           = true
PRIME_RESULT_STATUS       = success
PRIME_RESULT_BYTES        = <textBytes>
PRIME_RESULT_SESSION_ID   = S
MYC_DIAG_CAPTURE_ID       = <captureId>
```

## Background

The `getMycPrimeLiveDiag` API is the diagnostic surface scaffolded
in ACT-MYC-CLINEMM03-LIVE-DIAG01 (proven by 14 vitest tests in
`sdk/packages/core/src/sdk/__tests__/myc-prime-live-diag.test.ts`).
It is default-off per ACT §3 contract, gated by
`CLINEMM_MYC_PRIME_DIAG=1`. This ACT's recipe in
ACT-MYC-CLINEMM04-LIVE-QUALIFICATION/11-operator-recipe.txt
Step 3 exports that env flag.