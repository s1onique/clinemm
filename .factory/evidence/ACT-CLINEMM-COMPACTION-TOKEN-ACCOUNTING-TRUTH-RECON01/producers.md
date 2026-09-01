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

## Q0D — Sub-finding: provider-normalized vs estimated

**Correction (factory causal reviewer, 2026-09-02):** the previous
draft of this section called the header field "provider-reported exact
usage." Soften this to **"provider-normalized request-input accounting
snapshot"** until the MiniMax adapter / provider event normalization is
verified. Upstream precedent (issue #11037) showed that treating
normalized provider fields as naively additive led to a wrong value
under specific OpenAI-compatible adapters; the source-comment claim
that buckets are disjoint is encouraging but not yet executable
evidence.

The header field reads from `tokensIn` / `cacheReads` / `cacheWrites`
in the `api_req_started` message — those are **provider-normalized
request-input accounting** values for the last request. They are NOT
provider-billed totals (`tokensOut` is excluded by design). The
disjoint-bucket claim relies on the `normalizeUsageEvent` seam at
`apps/vscode/src/sdk/message-translator.ts:86-110`. Future recon step
must verify this seam against the MiniMax adapter end-to-end.

The divider field reads from `tokensBefore` / `tokensAfter` written
by the SDK — those are **ESTIMATES** (`estimateRequestInputTokens` /
`estimateMessageTokens`). They are NOT provider-reported.

The estimates are written into the divider. The header rescales by
`tokensAfter / tokensBefore` (i.e. uses the ESTIMATED divider ratio
to rescale the PROVIDER-NORMALIZED last request). This is the source
of the divider-rescale behavior.

This is a bounded pattern: the divider's `tokensBefore` and
`tokensAfter` are ESTIMATES of the working-context payload. They are
not provider-billed totals. The header's per-request value is a
provider-normalized snapshot, not an exact provider bill.

### R0 candidate (NEW): post-compaction header projection

The factory causal reviewer (2026-09-02, first reordering) noted that
the LIVE symptom (`~7.1k` header vs `680.1k → 28.9k` divider) is
numerically consistent with the production rescaling:

```text
shrinkFraction = 28_900 / 680_100 ≈ 0.04249
header         = ceil(167_100 × 0.04249) = 7_101
```

i.e. the displayed header value is the LAST REQUEST INPUT multiplied
by the COMPACTION SHRINK RATIO. R0-A is now retained as a documentary
witness (LIVE_ARITHMETIC_BIND_PROVEN) — see ACT §6 R0-A. R0-B was
HALT_RED_NOT_REPRODUCED (the "three permitted quantities" oracle was
unfounded). R0-C was inconclusive (the doc comment actually matches
the behavior). Both removed.

### R0' candidate (NEW): manual compaction wrong-input projection

The factory causal reviewer (2026-09-02, second reordering) — pivoted
away from the UI projection after a new LIVE specimen ("Context
compacted (manual) · 1M → 72.9k tokens · 1234 → 86 messages") showed
the upstream denominator itself is suspicious. Operator intuition was
that the model was not actually carrying ~1M tokens of active context.

**Source recon (executed 2026-09-02):**

```text
apps/cli/src/runtime/interactive/compaction.ts:99-100
  manual /compact passes:
    messages:    input.messages  (canonical full transcript)
    apiMessages: input.messages  (SAME as canonical)

apps/vscode/src/sdk/sdk-compaction.ts:101-102
  SdkCompactionCoordinator.compactTask() passes:
    messages:    input.messages  (canonical full transcript)
    apiMessages: input.messages  (SAME as canonical)

sdk/packages/core/src/extensions/context/compaction.ts:309
  strategy computes:
    requestInputTokens = estimateRequestInputTokens({
      systemPrompt, messages: context.apiMessages, tools })
  This value is what feeds `tokensBefore` in the compaction metadata.

sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1149
  For AUTO compaction the orchestrator computes:
    apiMessages = await this.prepareProviderMessagesForApi(messages)
  This goes through messageBuilder.buildForApi() and any registered
  messageBuilder plugins — i.e., the SAME pipeline that constructs
  the next provider-bound request.
```

**CAUSAL FINDING:** Manual compaction's `apiMessages = canonical`
while the next provider-bound request's projection goes through
`buildForApi`. For manual compaction, `tokensBefore` measures the
canonical transcript (intended: "size of full history being
summarized"), not the provider-bound working context the UI labels.

For AUTO compaction, `apiMessages = prepareProviderMessagesForApi(
canonical)` → CONSISTENT with the next request's projection.

This is **R0'.B (WRONG_PROJECTION)** for manual compaction + UI
interaction. The TaskHeader / shared-metrics layer is not at fault —
it correctly consumes what `tokensBefore` says. The defect lives in
the two manual entry points (CLI + VSCode) that pass canonical as
`apiMessages`. Ownership migrates to SDK entry-point normalization.

Downstream repair ACT (named but NOT opened from this ACT):
**ACT-CLINEMM-COMPACTION-INPUT-IDENTITY-REPAIR01** — separate scope,
separate review.

R1-R3 (core compaction arithmetic, cumulative-usage non-interference,
repeated-request snapshot) remain supplementary discriminators; their
territory is unaffected by this finding.

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

**R0-A (LIVE_ARITHMETIC_BIND_PROVEN):** production rescaling
(`getApiMetrics.ts:174-225`) returns ~7.1k for the LIVE-symptom input
(167.1k × 0.04249). Documentary witness only.

**R0-B / R0-C (WITHDRAWN, 2026-09-02 second reordering):** "three
permitted quantities" oracle was unfounded; doc-comment-vs-behavior
assertion was inconclusive.

**R0' (NEW, load-bearing next discriminator, 2026-09-02 second
reordering):** manual compaction's `apiMessages = canonical` at both
entry points (CLI + VSCode). The TaskHeader / shared-metrics layer
consumes `tokensBefore` correctly; the defect lives in the SDK
compaction bridges. Source-recon bound; awaits real-trace specimen
for full proof. ROOT_CAUSE_ISOLATED candidate at:
- `apps/cli/src/runtime/interactive/compaction.ts:99-100`
- `apps/vscode/src/sdk/sdk-compaction.ts:101-102`

**A.label-only is NOT YET ESTABLISHED.** Q0C (semantic-difference) is
necessary but not sufficient; R0' source-recon must complete before
CASE_A is valid. R0-A alone does NOT close CASE_A — it only proves
arithmetic.

R1-R3 discriminators: **NOT YET RUN**. Authoring them is the next
recon step (auto-path supplementary).
