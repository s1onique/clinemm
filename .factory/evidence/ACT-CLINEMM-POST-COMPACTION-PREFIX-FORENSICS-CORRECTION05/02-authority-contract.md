# CORRECTION05 — the three-stage identity contract

This document states the invariant that the CORRECTION05 patch establishes and
that the `STAGE-01`…`STAGE-03` and `THREE-STAGE-01`…`THREE-STAGE-02` witnesses
enforce.

It EXTENDS the CORRECTION03 and CORRECTION04 authority contracts; it does not
replace them. The CORRECTION03 invariants I1–I8 and the CORRECTION04 invariant
I9 remain in force.

---

## 1. The defect

The analyzer's lineage gate makes FIVE identities mandatory on **BOTH** sides of
a comparison:

| Identity | Minted by | Mandatory on |
|---|---|---|
| `cohortId` | the capture writer | both |
| `sessionId` | the RUNTIME | both |
| `iteration` | the RUNTIME | both |
| `preparationRequestId` | the RUNTIME | both |
| `providerAttemptId` / `modelRequestId` | the RUNTIME | both |

Three of the five are produced by the runtime, so the runtime must carry them
on **EVERY** representation stage it captures. The two provider-bound stages
did:

| Stage | Call site | `sessionId` |
|---|---|---|
| B `ai_sdk_prompt` | `sdk/packages/llms/src/providers/ai-sdk.ts:2469` | `request.metadata?.sessionId` |
| C `wire_request` | `sdk/packages/llms/src/providers/provider-request-capture.ts:816` | `request.metadata?.sessionId` |
| **A `runtime_projection`** | **`sdk/packages/agents/src/agent-runtime.ts:3038`** | **ABSENT** |

Stage A passed only `preparationRequestId`, `providerAttemptId` and
`iteration`.

Because the bundle grouping key is
`(cohortId, sessionId, iteration, preparationRequestId, providerAttemptId)`, a
stage A record without a session id falls into a **different bundle** from the
stages B and C of the **same request**. The three-stage request bundle could
therefore never be assembled, and every authoritative comparison was refused.

> **This is a CAPTURE-CONTRACT defect, not a cache diagnosis.** Nothing here
> says anything about Strata's cache behaviour. It says the instrumentation
> could not yet produce the evidence the qualification needs.

---

## 2. The invariant

### I10 — every stage carries the SESSION identity

The runtime MUST pass a non-empty `sessionId` to **every** representation-stage
capture it makes, and that value MUST be the **same** one it puts into the
request metadata for the provider-bound stages.

The runtime already had the identity: `this.config.sessionId` is what it puts
into `request.options.metadata.sessionId` (which the gateway promotes to
`request.metadata.sessionId` for stages B and C). The correction passes the
**already-existing** `this.modelBehaviorTraceIdentity().sessionId` — the same
accessor the very same call site already used for `preparationRequestId` and
`modelRequestId`.

Nothing was added to the capture writer: `recordPrefixForensics()` and
`recordPrefixForensicsRuntimeProjection()` already ACCEPTED `sessionId`. Only
the call site stopped passing it.

### I11 — the three stages of ONE request form ONE bundle

The live gate. Three stages captured with the identities the runtime actually
mints must group into **ONE** bundle carrying **ALL THREE** stages. If any
stage omits the session identity, the request **SPLITS** and the comparison
collapses — which is exactly the failure the defect produced, and is what the
negative control `THREE-STAGE-02` reproduces.

---

## 3. The required witnesses

| Witness | Seam | Control | Result |
|---|---|---|---|
| `STAGE-01` | the REAL `AgentRuntime` | the runtime-projection capture carries a non-empty session identity | **PASS** |
| `STAGE-02` | the REAL `AgentRuntime` | all four runtime-minted identities are PRESENT and non-empty | **PASS** |
| `STAGE-03` | the REAL `AgentRuntime` | stage A's session identity EQUALS the value stages B and C read | **PASS** |
| `THREE-STAGE-01` | the REAL capture writer + the REAL analyzer | three stages of one request form ONE bundle with ALL THREE stages | **PASS** |
| `THREE-STAGE-02` | the REAL capture writer + the REAL analyzer | a MISSING session identity on one stage SPLITS the request | **SPLITS (control)** |

`STAGE-02` asserts each identity is **present** as well as non-empty: an
absent identity is exactly what defeats the lineage gate, so
`expect(x?.trim()).not.toBe("")` would pass for `undefined`.

---

## 4. What is explicitly NOT claimed

- The stale-read **policy** is unchanged by this correction.
- No provider semantics changed. No new inference run was performed. No capture
  instrumentation was added — the capture writer already accepted `sessionId`.
- The synthetic CLI fixtures remain **synthetic**: they establish the
  lineage contract, **not** capture-record hash verification against a live
  capture pipeline.
- `PREFIX_MUTATION_ISOLATED` stays **closed** (a ClineMM rewrite of a historical
  tool result is real and observed).
- `STRATA_PLATEAU_CAUSE_UNPROVEN` stays **OPEN**. The MiniMax capture corpus
  and the queried Strata endpoint are **not established to be the same serving
  path**, and no joined engine/capture evidence exists.

## 5. Consequence for the live qualification

The reviewer set one condition before a costly live forensic run may start:
> *Don't start a costly live forensic run until the three-stage identity check
> succeeds.*

`THREE-STAGE-01` is that check, executed against the REAL capture writer and
the REAL analyzer. It **succeeds**. The condition is met, and the live
installed-runtime Strata qualification may proceed on the same model and engine
configuration, with the source/build identity preserved and the join key
independently verified.

This correction does not itself produce the qualification's evidence, and it
does not change the stale-read policy or the engine's checkpoint placement — it
makes the instrumentation able to carry the evidence that the qualification
needs.
