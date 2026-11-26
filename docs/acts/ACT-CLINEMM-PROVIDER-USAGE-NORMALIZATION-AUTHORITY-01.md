# ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01

**C1: GO — bounded reproduction and repair.**

Establish the actual provider usage-normalization authority — output/reasoning
and input/cache — and correct the reproduced defects at their first actual
loss boundary.

CMP-08 auxiliary summarization accounting is NOT reopened.

```text
ENTRY_HEAD:            0d95d0dc2b0a78bcb3b64c9fbc42808af918bd5b
                       (ACT-CLINEMM-PROVIDER-COMPAT-REASONING-CONTINUITY-01)
MERGE_HEAD:            02274b4cd363fea42579fcb8fa304c2535084e85
                       (merge: integrate the local compaction and
                        reasoning-continuity workstream into CMP-09)
VERDICT:               GO_PROVIDER_USAGE_NORMALIZATION_AUTHORITY
```

## 1. The authorities, located in the RESOLVED SDK source

The usage authority is a CHAIN. Each link was read in the actually-resolved
source, not from documentation:

| Link | Artifact | Semantics |
|---|---|---|
| Provider SSE usage frames | Anthropic Messages SSE | `message_start` carries `input_tokens`, `output_tokens`, optionally `output_tokens_details`; `message_delta` carries the FINAL `output_tokens` |
| Provider adapter | `@ai-sdk/anthropic@4.0.94` `convertAnthropicUsage` | `inputTokens.total = input_tokens + cacheCreation + cacheRead` (disjoint counters SUMMED); `outputTokens.total = output_tokens`; `outputTokens.text = total - thinking_tokens`; `outputTokens.reasoning = thinking_tokens` |
| AI SDK normalized usage | `ai@7.0.159` `asLanguageModelUsage` | flat `outputTokens` = `outputTokens.total` (**reasoning-INCLUSIVE**); `outputTokenDetails = { textTokens, reasoningTokens }` |
| AI SDK usage contract | `@ai-sdk/provider` `LanguageModelV4Usage` | `outputTokens.total` = "the total number of output (completion) tokens used"; `text` and `reasoning` are its PARTS |
| ClineMM normalization | `sdk/packages/llms/src/providers/ai-sdk.ts` `normalizeUsage` | the ONE ClineMM normalization authority |
| AgentRuntime usage | `sdk/packages/agents/src/agent-runtime.ts` `updateUsage` | accumulates the per-request usage into the run total |
| Runtime event adapter | `sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts` `translateUsage` | converts the cumulative total into a per-request DELTA; preserves zero-vs-absent for cache metrics |
| Session metrics persistence | `sdk/packages/core/src/services/session-data.ts`, `agent-message-codec.ts` | persists `inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheWriteTokens` per message |
| Overflow-recovery consumption | `agent-runtime.ts:5624` -> `lastRequestInputTokens` -> `prepareTurnForModelRequest` -> `previousRequestInputTokens` -> `compaction.ts` `actualPreviousInputTokens` -> `underestimateFactor` | the provider's COMPLETE prompt scales the compaction budget |


### The established semantics

- **Total input tokens** = the COMPLETE prompt the provider received and
  counted. It INCLUDES the cached portion.
- **Uncached input tokens** = `inputTokens - cacheReadTokens - cacheWriteTokens`.
- **Cache-read / cache-write tokens** = a SUBSET (a partition) of the total
  input, never an addition to it.
- **Total output tokens** = the provider's own output count. Under the AI
  SDK's contract it INCLUDES the reasoning.
- **Visible output / text tokens** = the REMAINDER: `total - reasoning`.
- **Reasoning tokens** = the provider's own breakdown, a SUBSET of the output
  total.
- **Cumulative vs incremental** = the AI SDK's `stream.usage` is the SUM over
  the physical attempts of the turn; the runtime event adapter converts the
  cumulative total into a per-request delta.

**Total output is NEVER the sum of a total and its own reasoning
breakdown.** That additive identity is false under every established
provider contract.

## 2. Reproduced output-normalization defects

Both were reproduced through the REAL production chain (real gateway, real
`@ai-sdk/anthropic`, controlled fetch replacement at the external network
boundary only). No paid inference, no network.

### Defect A — the reasoning breakdown was subtracted from a MULTI-ATTEMPT total

The production retry middleware (`retry-empty-response.ts`) sums
`outputTokens.total` across the physical attempts of a turn, but the
ClineMM normalizer subtracted the reasoning of ONE attempt from that
MULTI-ATTEMPT total.

Measured, before the repair, for a provider reporting `output_tokens: 900`
with `reasoning_tokens: 800` on a turn that made 3 physical attempts:

```text
provider (per attempt)  output_tokens 900   reasoning 800
3 attempts              output total 2700
ClineMM emitted         outputTokens 1900   reasoningTokenCount 800
```

1900 = 2700 - 800: the reasoning of ONE attempt was subtracted from a total
covering THREE. The conservation law `visible + reasoning == total` was
violated (1900 + 800 = 2700 != 2700).

### Defect B — the Anthropic-native `thinking_tokens` breakdown was DROPPED

The Anthropic Messages contract names the reasoning breakdown
`thinking_tokens`; that is the name the resolved `@ai-sdk/anthropic` adapter
itself reads (`usage.output_tokens_details?.thinking_tokens`). The
ClineMM reasoning-path vocabulary did not include it, so the breakdown was
not surfaced at all and the reasoning tokens were unaccounted for.

### The SDK-side boundary that makes Defect B unavoidable through the SDK alone

In the resolved `@ai-sdk/anthropic@4.0.94` streaming path,
`usage.output_tokens_details` is assigned in EXACTLY ONE place: the
`message_delta` handler. The `message_start` handler sets `input_tokens`,
`cache_read_input_tokens` and `cache_creation_input_tokens`, but NOT
`output_tokens_details`. A provider that reports the breakdown in the OPENING
frame therefore leaves the SDK's structured breakdown EMPTY — while the SDK's
`raw` payload still carries it, because the `message_delta` usage is SPREAD
over the `message_start` usage (`rawUsage = { ...rawUsage, ...value.usage }`),
so the opening frame's key survives.


### The repair

**One normalization authority**, at the first actual loss boundaries:

1. `retry-empty-response.ts` `addUsage`: each attempt's breakdown is resolved
   INDEPENDENTLY (its structured field, else its own raw payload) and then
   summed. The aggregate's breakdown is therefore scoped to exactly the
   attempts the aggregate's total covers. A record that reports no breakdown
   at all contributes nothing (its output is unknown, not zero).
2. `ai-sdk.ts` `normalizeUsage`: the reasoning is resolved from the SDK's
   STRUCTURED fields first, then the raw payload, with the Anthropic-native
   `thinking_tokens` name added to the authority list. The VISIBLE output is
   the SDK's own remainder when it could resolve the breakdown (no
   subtraction needed), and otherwise the total minus the reasoning, floored
   at zero.

**Measured, after the repair, same fixture:**

```text
3 attempts              output total 2700
ClineMM emitted         outputTokens 300    reasoningTokenCount 2400
                        300 + 2400 == 2700            CONSERVED
```

Single attempt: `outputTokens 100`, `reasoningTokenCount 800`,
`100 + 800 == 900`. CONSERVED.

### Controls exercised

Opening and final cumulative usage frames; reasoning breakdown in the
opening frame; reasoning breakdown in the final frame; explicit zero
reasoning; absent reasoning; a provider-reported total already including
the reasoning; the Anthropic-native `thinking_tokens` spelling; a streamed
thinking-content fixture (a real `thinking` content block with a
`thinking_delta`); a multi-attempt turn.

**Reasoning counts are NEVER manufactured from text lengths.** The streamed
thinking fixture's reasoning count comes only from the provider's own
reported breakdown; the characters are never converted to tokens.

## 3. Reproduced input/cache normalization defects

**NONE REPRODUCED.** The input/cache normalization is correct and was
PRESERVED unchanged.

- **Anthropic disjoint counters** (`input_tokens=3`, `cache_read=10`,
  `cache_creation=100`): the SDK's `total` is their SUM (113). ClineMM
  reports `inputTokens 113`, `cacheReadTokens 10`, `cacheWriteTokens 100`.
  The cache counters are a PARTITION of the total, not an addition.
- **SDK-normalized total input with a cache breakdown**: preserved verbatim.
- **An established total-inclusive cache accounting** (OpenAI-family
  `prompt_tokens` already including `prompt_tokens_details.cached_tokens`):
  `inputTokens 9096`, `cacheReadTokens 9090` — the cached portion is NOT
  re-added to a total that already includes it.
- **Cumulative usage updates**: the aggregate is the sum over the physical
  attempts, at every layer.
- **Explicit zero and absent cache metrics**: preserved distinctly. The
  runtime event adapter emits `cacheReadTokens: undefined` for a zero delta
  and a real number for a non-zero one; the normalizer reports `0` for an
  explicit zero and `0` for an absent metric, exactly as before.
- **Large cache-read counts**: `inputTokens 1_728_403`,
  `cacheReadTokens 1_562_316` — the cached tokens are NOT subtracted from
  the context occupancy.

**No layer adds cache-read or cache-write usage to a total that already
includes those values, and no layer subtracts them from a total that
excludes them.**


### The overflow-recovery usage authority

`usage.inputTokens` (the COMPLETE prompt) -> `state.lastRequestInputTokens`
-> `previousRequestInputTokens` -> `actualPreviousInputTokens` ->
`underestimateFactor` -> the compaction budget.

The budget compares the provider's COMPLETE prompt against the provider's
context window, so the normalized input must be the complete prompt. Cached
tokens are tokens the provider actually received and counted: subtracting
them would under-state the dispatched request. The conservation control is
in `compaction.estimator-parity01.test.ts` (the existing production seam):
the authority consumed is the complete prompt verbatim, and the under-estimate
factor is computed against it.

## 4. The historical MiniMax disposition

**CAPTURE_INSUFFICIENT — unchanged.** No raw historical provider usage was
recovered, so no historical provider accounting defect is concluded.

The recorded CMP-09 numbers ARE internally consistent with the CURRENT
cache-inclusive semantics:

```text
recorded inputTokens    1_728_403
recorded cacheRead     1_562_316
uncached remainder       166_087   (1_728_403 - 1_562_316)  CONSISTENT
```

and the CURRENT production path produces exactly this shape from a provider
whose complete prompt is 1_728_403, under BOTH the Anthropic-style disjoint
counters and the OpenAI-style total-inclusive counters.

It is NOT established whether the provider's actual prompt was 1_728_403
(exceeding the 1_048_576 effective window) or 166_087 (inside it). The
recorded count exceeds the effective window by 65% while the recorded
estimate before compaction was ~198_547. That is a QUESTION about the
historical provider's own accounting, and it is answered only by raw
historical provider evidence, which does not exist in this capture. The
output-exhaustion observation (18 responses persisting `outputTokens: 1`
despite substantial reasoning) is likewise NOT re-derived here: the repairs
above fix the defect that WOULD produce a wrong count from a provider that
DOES report a breakdown, and they restore the breakdown the Anthropic-native
spelling carries — but a provider that reports NO breakdown still yields no
reasoning count, and none is invented.

## 5. Live usage observability

`CLINEMM_USAGE_OBSERVABILITY=1` arms a NUMERIC-ONLY capture
(`sdk/packages/llms/src/providers/usage-observability-capture.ts`).

**DEFAULT OFF.** Only the exact value `1` arms it. When disarmed, the
disabled path resolves no directory, writes no file, and performs no
serialization and no filesystem access.

It correlates, under the physical request identity:

- the provider's RAW numeric usage fields (by name),
- the AI SDK's normalized numeric usage,
- ClineMM's final normalized numeric usage.

**Numeric allowlist only.** The raw provider payload is traversed by an
explicit allowlist of numeric field names (`input_tokens`, `output_tokens`,
`cache_creation_input_tokens`, `cache_read_input_tokens`, `thinking_tokens`,
`reasoning_tokens`, the OpenAI-family and Google-family equivalents, and the
nested `*_tokens_details` objects). A non-numeric value is skipped, never
coerced. No raw transcript, no reasoning TEXT, no response body, no
credential, no signature, no prompt, no message body, no tool payload. No
new diagnostics framework and no request registry.

**Capture failures must not change execution or accounting**: the whole
capture body is failure-isolated, and the write is atomic (write-then-rename)
with mode 0o600 in a 0o700 directory.

This capture is the operator-local tool that makes the live discriminator
possible; it is opt-in and ships disabled.

## 6. A pre-existing blocking defect found and corrected

The merge commit `02274b4cd` left a stray closing brace at
`sdk/packages/shared/src/llms/request-budget.ts:437` (a conflict-resolution

## 7. Verification

Focused RED/GREEN, exact numerical assertions through the real production
path.

| Suite | Result |
|---|---|
| `sdk/packages/llms` `output-exhaustion-reasoning-usage-forensics01.test.ts` | 11 passed (7 new/re-written conservation controls) |
| `sdk/packages/llms` `ai-sdk.test.ts` | 41 passed |
| `sdk/packages/llms` `middleware/retry-empty-response.test.ts` | 37 passed |
| `sdk/packages/llms` `usage-observability-capture.test.ts` | 6 passed (new) |
| `sdk/packages/agents` `agent-runtime.test.ts` | 152 passed |
| `sdk/packages/core` `compaction.estimator-parity01.test.ts` | 20 passed |
| `sdk/packages/core` `runtime-event-adapter.test.ts` | 43 passed |
| `sdk/packages/core` `agent-events.test.ts` | 5 passed |
| `sdk/packages/core` `compaction.token-evidence-capture01.test.ts` | 5 passed |
| `sdk/packages/core` `compaction.summarization-usage-conservation.cmp08.test.ts` | 24 passed (CMP-08 NOT reopened) |

Affected typechecks: `@cline/llms` CLEAN. `@cline/core` has 45 PRE-EXISTING
errors, identical with and without this ACT's changes, none in this ACT's
files.

Biome: clean on every touched file.

SDK rebuild: `bun run build:sdk` before the cross-package verification.

### Pre-existing failures NOT caused by this ACT

- `sdk/packages/llms`: 18 failures in `ai-sdk-reasoning.test.ts`,
  `request-budget-wire-equivalence.cmp09.test.ts` and the SAP
  `community.process-hygiene*.test.ts` files — identical count with this
  ACT's changes stashed.
- `sdk/packages/agents` `agent-runtime.token-evidence-capture01.test.ts`:
  6 failed / 2 passed — identical with and without this ACT's changes.

## 8. Exit

```text
RAW_PROVIDER_USAGE_AUTHORITY       Anthropic Messages SSE usage frames
                                   (message_start / message_delta); the
                                   provider's own output_tokens INCLUDES the
                                   reasoning; input_tokens EXCLUDES the cache
                                   counters (disjoint).

SDK_USAGE_AUTHORITY                @ai-sdk/anthropic@4.0.94
                                   convertAnthropicUsage +
                                   ai@7.0.159 asLanguageModelUsage:
                                   outputTokens.total is the TOTAL
                                   (reasoning-inclusive); text and reasoning
                                   are its parts; inputTokens.total is the
                                   COMPLETE prompt.

OUTPUT_TOTAL_NORMALIZATION         The visible output is the REMAINDER of the
                                   provider's total, never an addition.
                                   visible + reasoning == total.
                                   REPAIRED.

REASONING_BREAKDOWN_CONSERVATION    The Anthropic-native `thinking_tokens`
                                   breakdown is surfaced, not dropped, and is
                                   scoped to the attempts its total covers.
                                   REPAIRED.

INPUT_TOTAL_NORMALIZATION          The COMPLETE prompt, cache-inclusive, in
                                   both the disjoint-counter and the
                                   total-inclusive provider contracts.
                                   CORRECT — PRESERVED UNCHANGED.

CACHE_BREAKDOWN_CONSERVATION       The cache counters are a PARTITION of the
                                   total input, never an addition to it, and
                                   are never subtracted from the context
                                   occupancy. CORRECT — PRESERVED UNCHANGED.

CUMULATIVE_FRAME_CONSERVATION      The aggregate's breakdown is scoped to
                                   exactly the physical attempts the
                                   aggregate's total covers. REPAIRED.

EXPLICIT_ZERO_CONSERVATION         An explicit zero stays distinguishable
                                   from an absent metric at every layer.
                                   PRESERVED.

PERSISTED_USAGE_CONSERVATION       The persisted per-message outputTokens is
                                   the VISIBLE output; the cache counters
                                   travel beside it as a partition.
                                   PRESERVED.

OVERFLOW_RECOVERY_USAGE_AUTHORITY  The provider's COMPLETE prompt
                                   (usage.inputTokens) is the authority the
                                   compaction budget consumes
                                   (lastRequestInputTokens ->
                                   previousRequestInputTokens ->
                                   actualPreviousInputTokens ->
                                   underestimateFactor). Cached tokens are
                                   NOT subtracted. CONSERVED.

HISTORICAL_MINIMAX_USAGE_DISPOSITION
                                   CAPTURE_INSUFFICIENT. No raw historical
                                   provider usage recovered; no historical
                                   provider accounting defect concluded. The
                                   recorded CMP-09 shape is INTERNALLY
                                   CONSISTENT with the current cache-inclusive
                                   semantics and is reproducible from the
                                   current path.

LIVE_USAGE_OBSERVABILITY           CLINEMM_USAGE_OBSERVABILITY=1, DEFAULT
                                   OFF, numeric allowlist only, failure
                                   isolated, correlated by physical request
                                   identity. No transcript, no reasoning
                                   text, no response body, no credential, no
                                   signature. No new framework, no registry.

FINAL_HEAD                         (see the commit below)

TRACKED_DIRT                       (see the commit below)
```

Verdict: **GO_PROVIDER_USAGE_NORMALIZATION_AUTHORITY**.

Unsupported historical conclusions are qualified separately in section 4 and
are NOT part of the verdict.


artifact). The file did not parse, so the ENTIRE `@cline/shared` package —
and therefore every suite that imports it — failed to collect:

```text
PARSE_ERROR  Unexpected token
  ../shared/src/llms/request-budget.ts:437:1
```

This defect is unrelated to usage normalization, but it blocks every
verification step of this ACT, so it was corrected: the stray brace was
removed. It is a one-character repair with no semantic content.
