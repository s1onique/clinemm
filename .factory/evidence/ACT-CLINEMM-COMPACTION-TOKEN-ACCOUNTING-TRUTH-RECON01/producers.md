# Q0A-Q0C Producer-binding (2026-09-02)

Recon step 1: bind the two LIVE UI fields to their producers, then walk
each producer backward to its data source. This file answers Q0A, Q0B, Q0C
per ACT §4.

## Q0A — What exact producer generates "Context compacted · 680.1k → 28.9k tokens"?

**Renderer (webview):**

```text
apps/vscode/webview-ui/src/components/chat/CompactionRow.tsx:46-48
```

The label function `formatCompactionLabel(info)` produces the literal
text:

```text
Context compacted · 680.1k → 28.9k tokens · 142 → 6 messages
```

via:

```ts
const parts: string[] = [info.mode === "manual" ? "Context compacted (manual)" : "Context compacted"]
if (typeof info.tokensBefore === "number" && typeof info.tokensAfter === "number") {
    parts.push(`${formatTokenCount(info.tokensBefore)} → ${formatTokenCount(info.tokensAfter)} tokens`)
}
if (typeof info.messagesBefore === "number" && typeof info.messagesAfter === "number") {
    parts.push(`${info.messagesBefore} → ${info.messagesAfter} messages`)
}
return parts.join(" · ")
```

with `formatTokenCount` at `CompactionRow.tsx:7-14` doing the `k`/`M`
formatting. The `info` object comes from
`parseCompactionInfo(message.text)` at `CompactionRow.tsx:18-32`,
which `JSON.parse`s the `say:"compaction"` message's text body. The
text body is the `metadata` block built by the SDK compaction
pipeline.

**Translator (extension host):**

```text
apps/vscode/src/sdk/message-translator.ts:1230-1241
```

The translator reads `metadata.tokensBefore` and `metadata.tokensAfter`
from the SDK's status-notice payload and copies them into the
`ClineCompactionInfo` shape that the webview consumes. It explicitly
guards with `asFiniteNumber` to handle non-finite values.

**SDK producer (the load-bearing site):**

```text
sdk/packages/core/src/extensions/context/compaction.ts:562-583
```

```ts
context.emitStatusNotice?.(`${noticePrefix}compacted`, {
    kind: statusReason,
    reason: statusReason,
    phase: "completed",
    iteration: context.iteration,
    tokensBefore: requestInputTokens,
    tokensAfter: afterRequestTokens,
    messagesBefore: beforeMessageCount,
    messagesAfter: result.messages.length,
    maxInputTokens,
});
```

with the same fields also going into telemetry via
`captureCompactionExecuted(config.telemetry, { ..., tokensBefore:
requestInputTokens, tokensAfter: afterRequestTokens, tokensSaved:
requestInputTokens - afterRequestTokens, ... })` at the same file
(lines 583-602).

**Semantic claim: this is `WORKING_CONTEXT_ESTIMATE`, not
`SESSION_CUMULATIVE_USAGE`.**

Walking the producers backward:

```text
compaction.ts:309-313
  const requestInputTokens = estimateRequestInputTokens({
      systemPrompt: context.systemPrompt,
      messages: context.apiMessages,
      tools: context.tools,
  });

compaction.ts:555-556
  const afterRequestTokens = requestOverheadTokens + afterMessageTokens;
```

So:

```text
tokensBefore  := estimateRequestInputTokens({systemPrompt, messages, tools})
                = WORKING_CONTEXT_ESTIMATE(M)   (the actual provider-bound
                                                 prompt projection for M)

tokensAfter   := requestOverheadTokens + sum(estimateMessageTokens(msg))
                = WORKING_CONTEXT_ESTIMATE(M')  (the resulting projection
                                                 for M')
```

**Invariant I2 holds by construction**: same estimator
(`estimateRequestInputTokens` / `estimateMessageTokens`) reads and
writes both `tokensBefore` and `tokensAfter`. No provider-billing
tokens are added (no `tokensOut` injection). No historical session
cumulative usage is added.

**Invariant I3 holds by construction**: `tokensAfter` describes the
resulting working-context projection (the message array that will
be sent next), not cumulative historical provider usage.

## Q0B — What exact producer generates the header's ~7.1k?

The TaskHeader context-window bar uses the
`getLastApiReqContextInputTokens` function:

```text
apps/vscode/src/shared/getApiMetrics.ts:174
```

Per the doc comment at lines 137-167:

```text
The **provider-independent** semantic quantity that should drive the
UI's context-occupancy bar (e.g. the percentage shown in the TaskHeader
context indicator). It is computed as

    tokensIn + cacheReads + cacheWrites

where `tokensIn`, `cacheReads`, and `cacheWrites` are the **disjoint**
buckets emitted by the producer seam in
`apps/vscode/src/sdk/message-translator.ts::normalizeUsageEvent`
(input is split into uncached, cache-read, and cache-write components).

This matches the AI SDK's `inputTokens.total` contract: both
`@ai-sdk/anthropic` (which emits
`inputTokens.total = usage.input_tokens + cache_creation_input_tokens + cache_read_input_tokens`)
and `@ai-sdk/openai-compatible` (which emits
`inputTokens.total = usage.prompt_tokens` with
`noCache = prompt_tokens - cached_tokens`) converge on the same inclusive
total.

It is **not** the billed request activity
(`tokensIn + tokensOut + cacheWrites + cacheReads`) — output tokens
describe the previous response, not the current request's input occupancy.
```

So the `~7.1k` header value is:

```text
REQUEST_INPUT_TOKENS_of_last_request
   = tokensIn
   + cacheReads
   + cacheWrites

(rescaled by any completed compactions that postdate the last request,
 via shrinkFraction = (tokensAfter / tokensBefore) at lines 178-191)
```

`getLastApiReqTotalTokens` (the cost/activity variant) explicitly
EXCLUDES `tokensOut` from the context-input semantic. The header uses
the context-input variant, NOT the cost variant.

**Semantic claim: this is `REQUEST_INPUT_TOKENS` of the LAST request,
NOT `SESSION_CUMULATIVE_USAGE`.**

## Q0C — What semantic quantity does each field claim?

| UI field | Producer | Truth domain | Notes |
|---|---|---|---|
| `Context compacted · 680.1k → 28.9k tokens` (divider row) | `CompactionRow.tsx:46-48` ← `message-translator.ts:1234-1235` ← `compaction.ts:576-577` | `COMPACTION_BEFORE_TOKENS` / `COMPACTION_AFTER_TOKENS` (per-payload working-context estimate) | Same estimator as `WORKING_CONTEXT_ESTIMATE(M)` / `WORKING_CONTEXT_ESTIMATE(M')`. |
| `~7.1k` (TaskHeader context-window bar) | `getLastApiReqContextInputTokens` at `getApiMetrics.ts:174` | `REQUEST_INPUT_TOKENS` of the LAST request (provider-normalized context-input occupancy, disjoint buckets) | Excludes `tokensOut`. Rescaled by post-last-request compactions. |

**These two fields intentionally describe different semantic quantities.**

The compaction marker (`680.1k → 28.9k`) describes the
**WORKING-CONTEXT ESTIMATE BEFORE/AFTER COMPACTION**, captured at the
moment compaction runs.

The header (`~7.1k`) describes the **PROVIDER-NORMALIZED CONTEXT-INPUT
OCCUPANCY OF THE LAST ACTUAL REQUEST** that the model processed.

These can legitimately differ:

- A request that happened before compaction ran, with its OWN
  context-input occupancy, is what the header shows.
- The next request's working-context estimate (which is what
  compaction considered) is what the divider shows.
- Between them, the divider-rescale (`getApiMetrics.ts:178-191`)
  updates the header to track the divider's `tokensAfter` value.

**Sub-case A.label-only (label ambiguity): the LIVE symptom
"obviously inconsistent compaction/context accounting" is at minimum
partially explained by Q0C — the two UI fields are intentionally
different metrics.**

A separate question (R1-R3 territory) remains: does the working-context
estimate that `compaction.ts:576-577` writes to the divider also feed
into the next request's actual payload? And does the per-request
usage that `getApiMetrics.ts:174` reads stay a snapshot of THAT
request, not a cumulative total?

These questions are for the discriminators (R1-R3) in the next recon
step. They cannot be settled by producer-binding alone.

## Q0D — Sub-finding: provider-reported vs estimated

The header field reads from `tokensIn` / `cacheReads` / `cacheWrites`
in the `api_req_started` message — those are **provider-reported**
exact usage for the last request (I7 satisfied: not an estimate).

The divider field reads from `tokensBefore` / `tokensAfter` written
by the SDK — those are **ESTIMATES** (`estimateRequestInputTokens` /
`estimateMessageTokens`). They are NOT provider-reported.

The estimates are written into the divider. The header rescales by
`tokensAfter / tokensBefore` (i.e. uses the ESTIMATED divider ratio
to rescale the PROVIDER-REPORTED last request). This is consistent
with I7 (estimates labeled/treated as estimates) and is the source
of the divider-rescale behavior.

This is a bounded pattern: the divider's `tokensBefore` and
`tokensAfter` are ESTIMATES of the working-context payload. They are
not provider-billed totals.

---

## Open followups (for next recon step)

1. **R1 — Same-payload accounting.** Construct synthetic M, run the
   production estimator, run the production compaction pipeline, and
   assert `COMPACTION_BEFORE_TOKENS == estimator(M)` and
   `COMPACTION_AFTER_TOKENS == estimator(M')` to prove I2 by execution.
2. **R2 — Cumulative-usage non-interference.** Vary historical session
   usage by ~1M and assert the working-context estimate is unchanged.
3. **R3 — Repeated request snapshot.** Three sequential distinct
   payloads produce three independent working-context estimates; never
   a cumulative sum.
4. **Q5-Q12** of the §4 recon (threshold authority, abort authority,
   MODEL_INPUT_BUDGET, overflowRecovery effect, cache staleness).

## Status

Q0A-Q0C: **PRODUCERS BOUND**. Both UI fields trace back to their
producers, and each producer's source code already separates truth
domains. The additive-arithmetic anti-pattern does NOT appear in
either producer.

R1-R3 discriminators: **NOT YET RUN**. Authoring them is the next
recon step.