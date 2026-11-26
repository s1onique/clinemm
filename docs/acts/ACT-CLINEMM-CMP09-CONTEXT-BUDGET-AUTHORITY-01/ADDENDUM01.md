# ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 — ADDENDUM-01

**RETRY EXPENDITURE versus CONTEXT OCCUPANCY.**
**C1: GO — the defect is REAL, REPRODUCED through the production chain, and
REPAIRED at the authority-loss boundary.**

This addendum is an INTEGRATED extension of the existing CMP-09 amendment. It
is **not** a separate ACT, and it introduces **no** diagnostics framework.

```text
ENTRY_HEAD:   97471773c (ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01)
PREDECESSOR:  16c67824e (fix(core): measure the request the provider actually
              receives)
VERDICT:      GO_CMP09_RETRY_EXPENDITURE_AUTHORITY
```

## 1. The question

`PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01` established that the AI SDK's
`stream.usage` is the SUM over the **physical attempts** of a turn, and that
the production retry middleware (`retry-empty-response.ts`) aggregates the
discarded attempts' usage into the emitted finish part.

The overflow-recovery chain consumes `usage.inputTokens` through
`lastRequestInputTokens` -> `previousRequestInputTokens` ->
`actualPreviousInputTokens` -> `underestimateFactor` -> the compaction BUDGET:

```ts
// sdk/packages/core/src/extensions/context/compaction.ts
const underestimateFactor =
  actualPreviousInputTokens > 0 && requestInputTokens > 0
    ? Math.min(MAX_INPUT_UNDERESTIMATE_FACTOR,
        Math.max(1, actualPreviousInputTokens / requestInputTokens))
    : 1;
const maxInputTokens = rawMaxInputTokens / underestimateFactor;
const requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO;
const shouldCompact = requestInputTokens >= requestTriggerTokens;
```

`underestimateFactor` is a **CONTEXT-OCCUPANCY calibration**. It compares the
provider's count for the PREVIOUS request against the estimator's count for
the CURRENT request, so BOTH sides must describe the occupancy of ONE
request.

**The question:** was AGGREGATE EXPENDITURE being mistaken for SINGLE-REQUEST
CONTEXT OCCUPANCY?

**The answer: YES.** The defect is reproduced below and repaired.

## 2. The authority chain, located in the RESOLVED source

| Link | Artifact | Semantics |
|---|---|---|
| Retry middleware | `sdk/packages/llms/src/providers/middleware/retry-empty-response.ts` `addUsage` / `withAggregatedUsage` | SUMS `inputTokens.total` over the physical attempts; the emitted finish carries the AGGREGATE |
| AI SDK normalization | `sdk/packages/llms/src/providers/ai-sdk.ts` `normalizeUsage` | `inputTokens` = the aggregate |
| Compat projection | `sdk/packages/llms/src/providers/compat.ts` `case "usage"` | `inputTokens: event.usage.inputTokens` — the aggregate |
| Agent-model adapter | `sdk/packages/core/src/services/llms/apihandler-agent-model-adapter.ts` | `usage.inputTokens` — the aggregate |
| **THE AUTHORITY BOUNDARY** | `sdk/packages/agents/src/agent-runtime.ts` `case "usage"` | `this.state.lastRequestInputTokens = event.usage.inputTokens` — **the aggregate became the occupancy** |
| Budget consumer | `agent-runtime.ts` `prepareTurnForModelRequest` -> `previousRequestInputTokens` -> `compaction.ts` | consumes it as the PREVIOUS REQUEST'S occupancy |

## 3. The reproduction

Through the **REAL** gateway, the **REAL** `@ai-sdk/anthropic` transport, the
**REAL** production retry middleware, the **REAL** `AgentRuntime` and the
**REAL** compaction seam, with the external network boundary substituted and
nothing else. No paid inference, no network.

PAIRED TRAJECTORIES with an IDENTICAL PROMPT and an IDENTICAL per-attempt
provider reporting (N = 2,000 input tokens per physical attempt):

| Trajectory | Physical attempts / request | Physical attempts total | Runtime session input (aggregate) | Published `previousRequestInputTokens` (BEFORE the repair) |
|---|---:|---:|---:|---:|
| SINGLE | 1 | 2 | 4,000 | **2,000** (the individual request) |
| MULTI | 3 | 6 | 12,000 | **6,000** (the AGGREGATE) |

**The aggregate expenditure is real and correct** — the provider billed every
attempt, and the runtime's session total grew with the attempt count exactly.
**But the aggregate reached the CONTEXT authority.** The compaction seam then
computed its calibration against 6,000 instead of 2,000:

```text
individual request (P = 2,000):  underestimateFactor 1.8587  trigger 507,720.50
aggregate over 3 attempts (6,000): underestimateFactor 4 (CLAMPED)  trigger 235,929.60
```

The aggregate therefore **manufactured a budget squeeze** — a 2.15x tighter
trigger — for a request the provider would have accepted. Retries ALONE
changed the compaction decision.

### The discriminator

`sdk/packages/core/src/extensions/context/compaction.retry-expenditure-vs-context-occupancy.cmp09.test.ts`

| Control | Assertion |
|---|---|
| CMP09-RETRY-01 | the aggregate session input consumption GROWS with the physical attempt count (the expenditure is conserved) |
| CMP09-RETRY-02 | the context occupancy stays associated with the INDIVIDUAL request: the multi trajectory's published count EQUALS the single trajectory's |
| CMP09-RETRY-03 | additional retries ALONE must not manufacture a context-window overflow: the compaction verdict, the calibration and the trigger are IDENTICAL in both trajectories |
| CMP09-RETRY-04 | the aggregate expenditure is PRESERVED for billing while the context authority stays on the individual request; the two quantities are never conflated |
| CMP09-RETRY-05 | the estimator calibration is computed against the INDIVIDUAL request; the aggregate's squeeze is exactly what the repair removes |

The RED receipt of the observed defect is retained, isolated and excluded from
the default suite, exactly as the established convention requires:

- `sdk/packages/core/src/extensions/context/compaction.retry-expenditure-vs-context-occupancy.cmp09.red01.test.ts`
- `sdk/packages/core/vitest.red.cmp09-retry-expenditure.config.ts`
- `bun run test:red:cmp09-retry-expenditure`

**RED against the repaired behaviour (the expected, correct outcome):**

```text
AssertionError: expected 2000 to be 6000
```

i.e. the boundary now publishes the INDIVIDUAL request's occupancy (2,000)
where the predecessor published the AGGREGATE (6,000).

## 4. The repair

**The two quantities are separated at the boundary that conflates them, and
each is bound to its own authority.**

### 4.0 CORRECTION-01 — the bounded correction

The reviewer independently executed the production stamping function, the
reader and the runtime assignment, and found two defects in the predecessor's
repair:

**A1 (P0) — the MISSING physical-request occupancy.** The predecessor's
runtime read `requestInputTokens ?? event.usage.inputTokens`, so whenever the
served attempt's measurement was unavailable the AGGREGATE EXPENDITURE
re-entered as the CONTEXT OCCUPANCY:

```text
aggregate=6000, served=2000 -> occupancy=2000   (correct)
aggregate=4000, served=undefined -> occupancy=4000  (incorrect)
aggregate=4000, served=0        -> occupancy=4000  (incorrect)
aggregate=4000, served=-1       -> occupancy=4000  (incorrect)
```

The root cause is that the predecessor carried ONE number where the fact is
THREE-VALUED. The correction replaces it with a **THREE-VALUED PHYSICAL-REQUEST
OCCUPANCY AUTHORITY**:

| State | Meaning | Occupancy |
|---|---|---|
| `single` | the turn made exactly ONE physical attempt | the aggregate IS the request's occupancy (the LEGACY shape) |
| `known` | several attempts; the SERVED attempt's own prompt size is established | the served attempt's count |
| `unknown` | several attempts; the served attempt's prompt size was NOT established | **NONE** — the authority is DENIED |

`unknown` is an EXPLICIT denial, not an absence: it is what forbids the
aggregate fallback. The runtime now **CLEARS** the previous occupancy when
the authority is denied, so a STALE occupancy is never silently attributed to
the current request, and an INVALID measurement grants no authority either.

**A2 (P1) — the MEASUREMENT PROVENANCE.** The predecessor carried the marker
inside `usage.raw`, which the resolved `@ai-sdk/anthropic@4.0.94` adapter sets
to the **PROVIDER'S OWN** raw usage payload (`raw: rawUsage ?? usage`). The
reviewer's shape — a raw marker of `1` with an aggregate of `4000` — was
therefore reachable, and the provider's field established the MIDDLEWARE-OWNED
occupancy authority.

The correction moves the authority to the **existing metadata seam**: the
finish part's `providerMetadata`, under the `cline` namespace.
`providerMetadata` is `Record<string, JSONObject>` keyed by the OWNING
provider's name (`anthropic`, `google`, `vertex`, ...), so the `cline`
namespace is middleware-owned and a provider cannot forge it.

**The seam required one small correction to actually carry it.** The AI SDK's
`streamText` emits its OWN `finish` part WITHOUT `providerMetadata`; the
MODEL's metadata arrives on the `finish-step` part. The predecessor's
`finish-step` handler discarded it. It is now captured, and the `finish`
handler MERGES rather than replaces, so the authority survives the
`stream.usage` path (where the usage is preferred over the finish part's own
usage) without disturbing the provider's own metadata.

### 4.1 The mechanism

1. **`retry-empty-response.ts`** — the middleware stamps the THREE-VALUED
   occupancy authority onto the finish part's `providerMetadata` under the
   `cline` namespace (`physicalRequestOccupancy`). The value is read from the
   SERVED attempt's OWN usage, never from the aggregate; the aggregate is
   untouched.
2. **`ai-sdk.ts`** — `finish-step` captures the model's `providerMetadata`;
   `finish` merges it; `normalizeUsage` reads the authority from the
   middleware-owned `cline` namespace ONLY, and surfaces it as
   `requestOccupancy`.
3. **`compat.ts` / `apihandler-agent-model-adapter.ts` / `stream.ts`** —
   carry it beside the aggregate, verbatim.
4. **`agent-runtime.ts`** — **THE AUTHORITY BOUNDARY**. The CONTEXT authority
   consumes the three-valued authority; the BILLING authority (`updateUsage`)
   keeps accumulating the aggregate unchanged.

### The constraints, honoured

| Constraint | How it is honoured |
|---|---|
| **Preserve aggregate billing/accounting** | `usage.inputTokens` remains the aggregate; `updateUsage` still accumulates it; the runtime's session total still grows with the attempt count (CMP09-RETRY-01, CMP09-RETRY-04) |
| **Do not subtract cached tokens** | the served attempt's count is the provider's own COMPLETE prompt, read verbatim; no cache arithmetic is introduced |
| **Do not divide totals by an assumed retry count** | the count comes from the SERVED attempt's OWN usage; no division by any attempt count occurs anywhere |
| **Do not modify thresholds** | `COMPACTION_TRIGGER_RATIO`, `MAX_INPUT_UNDERESTIMATE_FACTOR` and `rawMaxInputTokens` are unchanged; the trigger's THRESHOLD never moved (CMP09-RETRY-05) |
| **No separate diagnostics framework** | one field on the existing usage record, carried by the existing middleware; no registry, no capture, no new framework |
| **No new ACT** | this is an ADDENDUM to the existing CMP-09 amendment |

### The preserved behaviour

- The cache counters remain a PARTITION of the total input; they are never
  subtracted from the occupancy.
- The persisted per-message usage and the session totals are unchanged.
- A request with NO retries is bit-for-bit unchanged: the served attempt IS
  the only attempt, so the individual count equals the aggregate.
- A provider that establishes no per-request count leaves the aggregate as
  the only reported input count — the previous behaviour, unchanged.

## 5. The historical iteration-23 attribution

**HYPOTHESIS_ONLY — unchanged and NOT re-attributed.**

The addendum establishes that the aggregate expenditure COULD reach the
context authority, and that it DID in the reproduced trajectory. It does
**not** establish that it DID in the historical run, because:

- the historical run's ACTUAL physical-attempt cardinality for the
  iteration-23 request is **not established** (no per-attempt capture
  exists), and
- the historical run's usage SCOPE (whether the recorded `inputTokens` covered
  one attempt or several) is **not established** either.

The recorded CMP-09 shape remains **INTERNALLY CONSISTENT** with the current
cache-inclusive semantics and reproducible from the current path, and the
historical disposition remains **CAPTURE_INSUFFICIENT**. The predecessor's
conclusion that the iteration-23 compaction was an **overflow recovery**
(`overflow_recovery_compaction`) and NOT the proactive budget trigger is
**not disturbed**: the overflow-recovery path does not consume
`underestimateFactor` at all — it forces the deterministic basic strategy
regardless of the estimate.

**What the addendum changes is the LIVE behaviour, not the historical
attribution.**

## 6. Verification

### 6.1 The addendum's own verification

| Suite | Result |
|---|---|
| `sdk/packages/core` `compaction.retry-expenditure-vs-context-occupancy.cmp09.test.ts` | **9 passed** (the discriminator: 5 causal + 4 authority controls) |
| `sdk/packages/core` `test:red:cmp09-retry-expenditure` | **2 failed / 1 passed** — the retained RED receipts (see 6.3) |
| `sdk/packages/core` `src/extensions/context/` (whole directory) | 1290 passed / 1290, 2 skipped |
| `sdk/packages/llms` `middleware/retry-empty-response.test.ts` | 37 passed |
| `sdk/packages/llms` `ai-sdk.test.ts` | 41 passed |
| `sdk/packages/llms` `compat.test.ts` | 23 passed |
| `sdk/packages/llms` `ai-sdk.retry-empty-response.test.ts` | 18 passed |
| `sdk/packages/llms` `routing/output-exhaustion-reasoning-usage-forensics01.test.ts` | 11 passed |
| `sdk/packages/llms` `usage-observability-capture.test.ts` | 6 passed |
| `sdk/packages/agents` `agent-runtime.test.ts` | 152 passed |
| `sdk/packages/core` `compaction.estimator-parity01.test.ts` | 20 passed |
| `sdk/packages/core` `compaction.context-budget-authority.cmp09.test.ts` | 2 passed |
| `sdk/packages/core` `compaction.summarization-usage-conservation.cmp08.test.ts` | 24 passed |
| `sdk/packages/core` `compaction.token-evidence-capture01.test.ts` | 5 passed |
| `sdk/packages/core` `apihandler-agent-model-adapter.test.ts` | 22 passed |

### 6.2 The correction's verification

| Control | Assertion |
|---|---|
| CMP09-RETRY-06 | an ESTABLISHED occupancy is the individual request's count |
| CMP09-RETRY-07 | an EXPLICITLY UNREPORTED occupancy grants NO occupancy authority (five shapes: `unknown` with absent/zero/negative value, and `known` with zero/negative value) |
| CMP09-RETRY-08 | a LEGACY single-request usage keeps the aggregate as the occupancy (both the no-authority shape and the `single` state) |
| CMP09-RETRY-09 | an UNTRUSTED raw marker cannot establish occupancy authority — asserted against the PRODUCTION reader, including that a PROVIDER's own namespace cannot establish it |
| CMP09-RETRY-10 | a SUBSEQUENT request after an unreported measurement gets NO stale occupancy |

Typechecks: `@cline/shared` CLEAN, `@cline/llms` CLEAN, `@cline/agents` CLEAN.
`@cline/core`: **45 pre-existing errors — IDENTICAL to the baseline**, none in
any touched file.

Biome: clean on every touched file.

SDK rebuild: `bun run build:sdk` — shared, llms, agents, core all built.

Inference requests: **0**. No network. No secret. No transcript. No VSIX
packaging.

### 6.3 The RED receipts, and what they do and do not establish

The RED witness is retained, isolated and excluded from the default suite:

- `sdk/packages/core/src/extensions/context/compaction.retry-expenditure-vs-context-occupancy.cmp09.red01.test.ts`
- `sdk/packages/core/vitest.red.cmp09-retry-expenditure.config.ts`
- `bun run test:red:cmp09-retry-expenditure`

```text
× R1.1: the AGGREGATE EXPENDITURE reached the CONTEXT-OCCUPANCY authority
        AssertionError: expected 2000 to be 6000
✓ R1.2 (A1): the predecessor's AGGREGATE-FALLBACK SHAPE is GONE
× R1.3 (A2): a PROVIDER-SUPPLIED raw marker established the occupancy authority
        AssertionError: expected 4000 to be 1
```

**R1.1 and R1.3 are HISTORICAL-BEHAVIOUR assertions**: they describe what the
predecessor DID, so they fail against the repaired behaviour.

**Their evidentiary weight is bounded, and stated plainly.** A
historical-behaviour assertion failing against repaired code is NOT, on its
own, sufficient to establish RED against the defective predecessor. The
INDEPENDENT evidence is the predecessor's own execution, which is preserved:

- **R1.1** — the addendum's own predecessor execution: the real gateway, the
  real retry middleware, the real `AgentRuntime` and the real compaction seam
  published **6,000** (the aggregate) where the individual request's occupancy
  was **2,000** (section 3), and the compaction verdict diverged.
- **R1.3 (A2)** — the REVIEWER's independent execution of the production
  stamping function, the reader and the runtime assignment: a provider-supplied
  raw marker of `1` with an aggregate of `4000` and missing served-attempt
  input usage produced an occupancy of **1**.

**R1.2 (A1) is a STRUCTURAL assertion, not a historical-behaviour one.** The
repair REMOVED the predecessor's `requestInputTokens` field, so the
predecessor's two-valued fallback has no representation left in the repaired
runtime. R1.2 therefore asserts the REPAIRED behaviour on the current shape
AND that the predecessor's aggregate-fallback expression no longer exists in
the production runtime source — which is what makes the fallback impossible.
The independent evidence for A1 is the reviewer's own execution, preserved
above.

**The historical attribution is NOT reopened.**

## 7. Exit

```text
RETRY_EXPENDITURE_IS_AGGREGATE       CONFIRMED. The middleware aggregates the
                                     physical attempts' usage; the aggregate is
                                     the correct BILLING quantity.
RETRY_AGGREGATE_REACHED_OCCUPANCY    CONFIRMED (RED, reproduced). The runtime
                                     assigned the aggregate to
                                     `lastRequestInputTokens`, and the
                                     compaction budget consumed it as the
                                     PREVIOUS REQUEST'S OCCUPANCY.
RETRY_ALONE_MANUFACTURED_OVERFLOW    CONFIRMED. The aggregate inflated
                                     `underestimateFactor` (1.8587 -> 4,
                                     clamped) and tightened the trigger
                                     (507,720.50 -> 235,929.60), changing
                                     the compaction decision for a request
                                     the provider would have accepted.
OCCUPANCY_AUTHORITY_REPAIRED         The SERVED attempt's individual prompt
                                     size now travels beside the aggregate
                                     and is what the CONTEXT authority
                                     consumes. REPAIRED.
AGGREGATE_EXPENDITURE_CONSERVATION   PRESERVED. The session input total still
                                     grows with the physical attempt count.
CACHED_TOKEN_SUBTRACTION             NONE introduced.
RETRY_COUNT_DIVISION                 NONE introduced.
THRESHOLD_MODIFICATION               NONE. The trigger's threshold never moved.

--- CORRECTION-01 ---

KNOWN_OCCUPANCY_CONSERVATION         CONFIRMED. An ESTABLISHED occupancy is the
                                     individual request's count, independent of
                                     the retry cardinality (CMP09-RETRY-06).
UNKNOWN_OCCUPANCY_DENIAL             CONFIRMED. An EXPLICITLY UNREPORTED
                                     occupancy grants NO authority: the
                                     aggregate never re-enters as the
                                     occupancy, in ANY of the five shapes
                                     (absent / zero / negative under both
                                     `unknown` and `known`)
                                     (CMP09-RETRY-07).
LEGACY_SINGLE_REQUEST_CONSERVATION   CONFIRMED. A usage that carries no
                                     occupancy authority, and the `single`
                                     state, keep the aggregate as the
                                     occupancy (CMP09-RETRY-08).
STALE_OCCUPANCY_DENIAL               CONFIRMED. A denied authority CLEARS the
                                     previous occupancy, so a stale value is
                                     never silently attributed to the current
                                     request (CMP09-RETRY-10).
MEASUREMENT_PROVENANCE                CONFIRMED. The authority travels in the
                                     MIDDLEWARE-OWNED `cline` namespace of the
                                     finish part's `providerMetadata`. A
                                     PROVIDER-supplied `usage.raw` field, and
                                     a PROVIDER's own metadata namespace,
                                     cannot establish it (CMP09-RETRY-09,
                                     asserted against the PRODUCTION reader).
                                     The reviewer's shape WAS reachable
                                     through the resolved SDK
                                     (`raw: rawUsage ?? usage`).
COMPACTION_CALIBRATION_CONSERVATION   CONFIRMED. The estimator calibration and
                                     the trigger are computed against the
                                     INDIVIDUAL request and are IDENTICAL
                                     across the single- and multi-attempt
                                     trajectories (CMP09-RETRY-05).

HISTORICAL_ITERATION_23_ATTRIBUTION  HYPOTHESIS_ONLY (unchanged). The
                                     historical retry cardinality and usage
                                     scope remain unestablished. NOT reopened.

FINAL_HEAD                           the commit that adds this addendum — the
                                     subject is
                                     "ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01
                                     (ADDENDUM-01 CORRECTION-01): bind the context
                                     occupancy to the individual physical request"
                                     (the hash is self-referential, so it is
                                     identified by its subject and resolved as
                                     `git log --format=%H --grep` rather than
                                     embedded)
TRACKED_DIRT                         0 (the working tree is clean at FINAL_HEAD)
INFERENCE_REQUESTS                   0
```

### 6.4 The witness diffs

The GREEN witness and the RED receipt are the two files below. Both are
new files; the production diff is the authority-boundary change in
`sdk/packages/agents/src/agent-runtime.ts` (`case "usage"`) plus the
middleware's stamping and the reader, listed in section 4.1.

```text
GREEN  sdk/packages/core/src/extensions/context/
         compaction.retry-expenditure-vs-context-occupancy.cmp09.test.ts
       (9 controls: CMP09-RETRY-01..10)

RED    sdk/packages/core/src/extensions/context/
         compaction.retry-expenditure-vs-context-occupancy.cmp09.red01.test.ts
       (R1.1, R1.2, R1.3)

CONFIG sdk/packages/core/vitest.red.cmp09-retry-expenditure.config.ts
SCRIPT sdk/packages/core/package.json -> test:red:cmp09-retry-expenditure
       (the RED file is EXCLUDED from the default suite)
```

Verdict: **GO_CMP09_RETRY_EXPENDITURE_AUTHORITY**.
