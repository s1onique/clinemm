# ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01

```text
ACT:        ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01
TYPE:       bounded production repair (one physical-request cardinality defect)
ENTRY_HEAD: 821b20e7a68d5481ac535ca7a94ff51db0b72f5f
BRANCH:     main
VERDICT:    GO_PCK_INPUT_BUDGET_RECON
EVIDENCE:   .factory/evidence/ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01/
```

## PRIMARY OBJECTIVE

Enforce the existing PCK no-automatic-retry contract at the PHYSICAL
provider-request boundary.

## THE DEFECT

The PCK's contract (`runtime.ts` § "NO RETRY LOOP") terminates a failed
attempt with no automatic second generation. It was enforced ONLY at the
PCK-ATTEMPT level. The PHYSICAL boundary beneath it carried THREE independent
retry authorities, all applied unconditionally:

1. `MODEL_REQUEST_MAX_RETRIES = 3` — the AI SDK's request-initiation retry.
2. `MODEL_STREAM_MAX_RETRIES = 3` — the AI SDK's post-stream-start provider-error retry.
3. `withEmptyResponseRetry()` — the empty-response / transient-network middleware.

Worst case: 3 x 3 x 3 = 27 physical provider requests for one PCK attempt.

## THE REPRODUCTION

Measured against the REAL production transport on 2026-11-24:

```
PCK_CARDINALITY_DIAGNOSTIC 429=4 500=4 401=1
```

The 4 is 1 initial request plus 3 request-initiation retries. The 401 case was
already correct. The retries also cost 14 038 ms of backoff, against 3 ms for
the repaired request — the mechanism behind the observed 180 s unsuccessful
checkpoint, whose 180 s is the PCK's own deadline.

The RED witness is an ISOLATED receipt, excluded from the default suite:

```
bun run test:red:pck-physical-request-cardinality
```

Its `R1.1` FAILS with `expected 4 to be 1`.

## THE REPAIR

A NEW, ENUMERATED, request-scoped channel — deliberately SEPARATE from the
opt-in `inferencePolicy`, so the Qwen opt-in scope is not disturbed:

```ts
export interface GatewayRequestRetryPolicy {
    readonly maxRetries?: number;
    readonly streamRetries?: number;
    readonly emptyResponseAttempts?: number;
}
```

It flows `ProviderConfig.requestPolicy` -> `buildGatewayRequest()` ->
`GatewayStreamRequest.requestPolicy` -> `ai-sdk.ts`, where the ONE place all
three authorities are armed resolves the budgets.

The PCK's own policy is `{ maxRetries: 0, streamRetries: 0,
emptyResponseAttempts: 1 }`, applied UNCONDITIONALLY in the production seam —
for every PCK model, every provider and every operator — and it produces a NEW
configuration, so the shared summarizer/agent configuration is never mutated.

## THE BOUNDARIES PRESERVED

- Ordinary working-agent and summarizer retries: UNCHANGED (`G1.3 CONSERVATION`).
- The Qwen inference-policy opt-in scope: UNCHANGED (`G1.8 SEAM`).
- Default/None reasoning semantics: UNCHANGED.
- Checkpoint input representation, deadline, vocabulary, output budget: UNCHANGED.
- Historical second-request ownership: UNRESOLVED (out of scope).
- Packaging / installation: NOT PERFORMED.

## VERIFICATION

| Gate | Result |
|---|---|
| RED reproduction | `expected 4 to be 1` — the defect, isolated |
| ACT-owned GREEN suite | 8 / 8 pass |
| Causal ablation | with policy 1, without policy 4 |
| Typecheck delta | 45 -> 45, delta 0 |
| Core regression (failing file set) | identical to baseline, delta 0 |
| `src/extensions/context/` suite | 968 pass, 2 skip |
| `@cline/shared` suite | 611 pass, 6 skip |
| `@cline/llms` retry/gateway suites | 246 pass |

## VERDICT

`GO_PCK_INPUT_BUDGET_RECON`
