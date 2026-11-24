# ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01 — ENTRY AND SOURCE IDENTITY

```text
ACT:        ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01
TYPE:       bounded production repair (one physical-request cardinality defect)
ENTRY_HEAD: 821b20e7a68d5481ac535ca7a94ff51db0b72f5f
BRANCH:     main
VERDICT:    GO_PCK_INPUT_BUDGET_RECON
```

## PREDECESSOR

The review of `ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01` accepted that
ACT (implementation commit `b7e9bafdc`) and authorised this ACT with the VERDICT
target `GO_PCK_INPUT_BUDGET_RECON`.

The review's authorisation, verbatim in substance:

> Primary objective: enforce the existing PCK no-automatic-retry contract at the
> physical provider-request boundary.
>
> Inspect and exercise all applicable retry authorities:
> - MODEL_REQUEST_MAX_RETRIES
> - MODEL_STREAM_MAX_RETRIES
> - withEmptyResponseRetry()
> - Provider-specific retry mechanisms
>
> Reproduce the violation before repairing it.
>
> Preserve working-agent and ordinary summarizer retries.
>
> The no-retry contract applies to all PCK models. The Qwen-specific non-thinking,
> temperature, JSON mode and output-token policies remain restricted to their
> existing opt-in scope.
>
> Preserve the newly repaired Default/None semantics.
>
> Do not change the checkpoint input representation, deadline, vocabulary, or output
> budget in this ACT.
>
> Historical second-request ownership remains UNRESOLVED unless authoritative evidence
> establishes it.

## THE BOUNDARIES THIS ACT DID NOT CROSS

| Boundary | Disposition |
|---|---|
| Checkpoint input representation | UNCHANGED |
| Checkpoint deadline | UNCHANGED |
| Checkpoint vocabulary | UNCHANGED |
| Checkpoint output budget | UNCHANGED |
| Qwen inference-policy opt-in scope | UNCHANGED |
| Default/None reasoning semantics | UNCHANGED |
| Working-agent retries | UNCHANGED |
| Ordinary summarizer retries | UNCHANGED |
| Historical second-request ownership | UNRESOLVED (out of scope) |
| Packaging / installation | NOT PERFORMED (forbidden by the authorisation) |

## SOURCE IDENTITY

The implementation touches exactly four production files and adds three test
artifacts:

| File | Role |
|---|---|
| `sdk/packages/shared/src/llms/gateway.ts` | the enumerated request-scoped physical-request policy types |
| `sdk/packages/llms/src/providers/config.ts` | the provider-configuration carrier |
| `sdk/packages/llms/src/providers/compat.ts` | the configuration -> gateway-request projection |
| `sdk/packages/llms/src/providers/ai-sdk.ts` | the ONE place all three retry authorities are armed |
| `sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/physical-request-policy.ts` | the PCK's own policy (NEW) |
| `sdk/packages/core/src/runtime/host/local-runtime-host.ts` | the production PCK seam |
| `sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/pck-physical-request-cardinality.red01.test.ts` | the isolated RED receipt (NEW) |
| `sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/pck-physical-request-cardinality.test.ts` | the GREEN companion (NEW) |
| `sdk/packages/core/vitest.red.pck-physical-request-cardinality.config.ts` | the RED witness's dedicated config (NEW) |
