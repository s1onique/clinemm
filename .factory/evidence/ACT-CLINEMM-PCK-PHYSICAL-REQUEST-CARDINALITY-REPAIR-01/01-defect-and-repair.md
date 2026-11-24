# ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01 — THE DEFECT AND THE REPAIR

## 1. THE CONTRACT THAT WAS VIOLATED

The PCK's own module states the contract in `runtime.ts` § "NO RETRY LOOP":

> On provider failure, timeout, cancellation, invalid JSON, an unknown atom, an
> unknown field, an invalid reference, an oversized output or an unsupported
> assurance, the attempt TERMINATES. The ordinary compaction continues using its
> existing failure policy. There is no automatic second checkpoint generation.

That contract was enforced ONLY at the **PCK-ATTEMPT** level. `runPckAttempt()`
contains no loop, and `MAX_PCK_GENERATION_ATTEMPTS = 2` bounds the attempt
budget. Nothing bounded the **PHYSICAL** provider-request boundary BENEATH it.

## 2. THE THREE APPLICABLE RETRY AUTHORITIES

The authorisation required exercising every applicable retry authority. All
three were located, and all three applied to the PCK request UNCONDITIONALLY.

| # | Authority | Location | Default |
|---|---|---|---|
| 1 | AI SDK request-INITIATION retry (`maxRetries`) | `sdk/packages/llms/src/providers/ai-sdk.ts` — `MODEL_REQUEST_MAX_RETRIES = 3` | 3 retries |
| 2 | AI SDK POST-STREAM-START provider-error retry (`streamRetries`) | `sdk/packages/llms/src/providers/ai-sdk.ts` — `MODEL_STREAM_MAX_RETRIES = 3` | 3 retries |
| 3 | Empty-response / transient-network middleware | `sdk/packages/llms/src/providers/middleware/retry-empty-response.ts` via `withEmptyResponseRetry()` — applied as the OUTERMOST wrap at the single AI SDK composition point | 3 attempts |

There is NO request-scoped opt-out for any of them, and no provider-specific
retry mechanism beyond these three was found in the PCK's transport path
(`generateSummary` -> `createHandlerAsync` -> the gateway -> `ai-sdk.ts` ->
`streamText`).

The worst case was therefore **3 x 3 x 3 = 27 physical provider requests** for a
single PCK attempt.

## 3. THE REPRODUCTION

The RED witness drives the REAL production transport (`createHandlerAsync` ->
the gateway -> `ai-sdk.ts` -> `streamText`) with a stubbed `fetch` and counts the
stub invocations. It does not re-implement the retry logic.

Observed on 2026-11-24:

```
PCK_CARDINALITY_DIAGNOSTIC 429=4 500=4 401=1
```

| Failure class | Physical requests | Reading |
|---|---|---|
| HTTP 429 (rate limited) | **4** | 1 initial + 3 `MODEL_REQUEST_MAX_RETRIES` retries |
| HTTP 500 (server error) | **4** | 1 initial + 3 `MODEL_REQUEST_MAX_RETRIES` retries |
| HTTP 401 (auth) | 1 | already correct: a non-retryable error terminates |

The RED witness is retained as an ISOLATED receipt, excluded from the default
suite and runnable on demand:

```
bun run test:red:pck-physical-request-cardinality
```

Its `R1.1` FAILS with `expected 4 to be 1` — that failure IS the receipt.

### THE WALL-CLOCK CONSEQUENCE

The retries also cost TIME, not just requests. The 429 case took **14 038 ms**
of backoff in the harness, against **3 ms** for the repaired request.

That is the mechanism behind the reviewer's observation that "the unsuccessful
checkpoint consumed 180 seconds": 180 s is the PCK's own deadline
(`DEFAULT_PCK_DEADLINE_MS = 180_000`), and the retry backoff is what pushed
the attempt into it. The repair removes the backoff, not merely the extra
requests.

## 4. THE REPAIR

### 4.1 A NEW, ENUMERATED, REQUEST-SCOPED CHANNEL

The repair adds a **dedicated** request-scoped channel. It is deliberately
SEPARATE from the existing `inferencePolicy`:

- `inferencePolicy` is an operator-OPT-IN, MODEL-SPECIFIC contract (the Qwen
  scope).
- the physical-request policy is a HOST-ASSERTED contract about how many
  physical requests a request may make.

Conflating them would have dragged the Qwen opt-in scope over the cardinality
contract, which the authorisation explicitly forbids: "The no-retry contract
applies to all PCK models. The Qwen-specific non-thinking, temperature, JSON
mode and output-token policies remain restricted to their existing opt-in
scope."

`sdk/packages/shared/src/llms/gateway.ts` gains:

```ts
export interface GatewayRequestPhysicalPolicy {
    readonly retryPolicy?: GatewayRequestRetryPolicy;
}

export interface GatewayRequestRetryPolicy {
    readonly maxRetries?: number;
    readonly streamRetries?: number;
    readonly emptyResponseAttempts?: number;
}
```

Every field is OPTIONAL and ENUMERATED, exactly like the inference policy, so
an unrelated caller cannot smuggle an arbitrary transport knob through the
shared request type.

### 4.2 THE PROJECTION

```text
ProviderConfig.requestPolicy
  -> buildGatewayRequest()            sdk/packages/llms/src/providers/compat.ts
  -> GatewayStreamRequest.requestPolicy
  -> ai-sdk.ts stream()
```

`buildGatewayRequest` carries the policy only when it is present:

```ts
...(config.requestPolicy ? { requestPolicy: config.requestPolicy } : {}),
```

so every request that does not assert one keeps its pre-ACT shape exactly.

### 4.3 THE ONE PLACE ALL THREE AUTHORITIES ARE ARMED

`ai-sdk.ts` is the single composition point every AI SDK vendor flows through,
so it is the single place the budgets are resolved:

```ts
const retryPolicy = request.requestPolicy?.retryPolicy;
const requestMaxRetries =
    retryPolicy?.maxRetries ?? MODEL_REQUEST_MAX_RETRIES;
const streamMaxRetries =
    retryPolicy?.streamRetries ?? MODEL_STREAM_MAX_RETRIES;
const emptyResponseAttempts =
    retryPolicy?.emptyResponseAttempts ?? undefined;
```

Each authority then consumes its budget:

| Authority | Before | After |
|---|---|---|
| `maxRetries:` | `MODEL_REQUEST_MAX_RETRIES` | `requestMaxRetries` |
| `streamRetries:` | `MODEL_STREAM_MAX_RETRIES` | `streamMaxRetries` |
| `withEmptyResponseRetry(..., emptyResponseAttempts)` | middleware default | `emptyResponseAttempts` |

`withEmptyResponseRetry` gained a fourth, OPTIONAL parameter. When it is
absent the middleware's own default budget is used, so every existing caller —
including the vendor-level `retryEmptyResponses` tuning and the `false` opt-out
— is unchanged.

### 4.4 THE PCK'S OWN POLICY

`sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/physical-request-policy.ts`:

```ts
export const PCK_PHYSICAL_REQUEST_POLICY = {
    retryPolicy: {
        maxRetries: 0,
        streamRetries: 0,
        emptyResponseAttempts: 1,
    },
} as const;
```

`applyPckPhysicalRequestPolicy()` returns a NEW configuration. It never writes
into the configuration it was given, so the shared summarizer/agent
configuration is left exactly as it was and the policy can never leak into an
unrelated request.

### 4.5 THE PRODUCTION SEAM

`local-runtime-host.ts` applies the policy UNCONDITIONALLY — for every PCK
model, every provider and every operator:

```ts
const pckCheckpointProviderConfig =
    applyPckPhysicalRequestPolicy(effectiveCheckpointProviderConfig);
return await generateSummary({
    providerConfig: pckCheckpointProviderConfig,
    ...
});
```

It is applied AFTER the inference policy, and the two are independent channels
on the SAME configuration. The inference policy keeps its own opt-in scope; the
physical-request policy does not depend on it.

## 5. WHAT IS PRESERVED

| Property | Evidence |
|---|---|
| Ordinary working-agent retries | `G1.3 CONSERVATION` — a request without the policy still issues > 1 physical request |
| Ordinary summarizer retries | same control — the policy is applied only to the PCK's OWN configuration object |
| The Qwen inference-policy opt-in scope | `G1.8 SEAM` — the inference policy still requires the opt-in, and its four parameters are unchanged |
| Default/None reasoning semantics | untouched — no file in that path was modified |
| Checkpoint input / deadline / vocabulary / output budget | untouched |
| The shared provider configuration | `G1.5` — the source configuration is byte-identical after the application |

## 6. THE CAUSAL ABLATION

`G1.4 NON-VACUITY` removes the policy and observes the defect return:

```text
withPolicy    -> 1 physical request
withoutPolicy -> 4 physical requests
```

The GREEN result is therefore caused by the policy, not by the test harness.
