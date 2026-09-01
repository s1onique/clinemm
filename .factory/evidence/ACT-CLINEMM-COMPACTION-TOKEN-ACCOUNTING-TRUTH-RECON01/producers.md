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

### R0' candidate (REFRAMED 2026-09-02 second review): manual compaction semantic-contract question

The factory causal reviewer (2026-09-02, second reordering) — pivoted
away from the UI projection after a new LIVE specimen ("Context
compacted (manual) · 1M → 72.9k tokens · 1234 → 86 messages") showed
the upstream denominator itself is suspicious. Operator intuition was
that the model was not actually carrying ~1M tokens of active context.

**Source recon (executed 2026-09-02 first pass; superseded by
semantic-contract recon 2026-09-02 second review):**

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

**HALT_ROOT_CAUSE_NOT_ISOLATED (factory causal reviewer, 2026-09-02
second review):**

The previous turn concluded `CASE_B.MANUAL_PROJECTION = MANUAL WRONG
INPUT PROJECTION`. This was an epistemic jump from structural
asymmetry to defect classification. The reviewer correctly
identified that:

1. The producer documents `tokensBefore` as "Full-request token
   estimates, in the same units as the trigger and limit" (sdk/
   packages/core/src/services/telemetry/core-events.ts:773). This
   is the S1 contract (MATERIAL_BEING_COMPACTED).
2. Manual compaction's design comment ("intentionally summarizes
   the full canonical transcript", apps/cli/src/runtime/interactive/
   compaction.ts:86-88) is consistent with S1, NOT S2.
3. Classifying manual compaction as "wrong input" requires the
   producer to claim S2, which it does not.
4. The UI consumer (apps/vscode/webview-ui/src/components/chat/
   task-header/ContextWindow.tsx:175: "Current tokens used in
   this request") implicitly assumes S2.

**Both contracts are valid within their own layer. The defect is
the WIRE between them: AMBIGUOUS_WIRE_CONTRACT (CASE_S3) or
SEMANTIC_LABEL_DEFECT (CASE_S1).**

**Updated verdict (R0' semantic-contract recon, 2026-09-02 second
review):**

- MANUAL_AUTO_INPUT_ASYMMETRY = PROVEN_STRUCTURAL (durable).
- MANUAL_WRONG_INPUT_PROJECTION (R0'.B) = RETRACT_PENDING_SEMANTIC_BIND.
- CASE_B.MANUAL_PROJECTION = PREMATURE / RETRACTED.
- PRODUCER_CONTRACT = S1 (correctly implemented at both manual
  entry points per the design intent; NOT a defect).
- UI_CONSUMER_CONTRACT = S2 (implicit; correctly implemented
  given its assumption; the defect is the assumption itself, not
  the implementation).
- WIRE_CONTRACT = S3 (OVERLOADED_FIELD).
- ROOT_CAUSE_LIKELY = AMBIGUOUS_WIRE_CONTRACT (between the producer's
  S1 and the UI consumer's S2).
- MANUAL_ENTRY_POINTS_AS_DEFECT = RETRACTED (they correctly
  implement S1).

**Repair options (NOT EXECUTED FROM THIS ACT, named for sequencing):**

- (a) Tag the field — emit `tokensBeforeKind` alongside
  `tokensBefore`; consumer uses the ratio only when kind matches.
- (b) Split into two fields — `compactionInputTokensBefore` AND
  `activeContextTokensBefore`; UI uses only the latter.
- (d) Consumer-side reconciliation — for manual mode, do NOT
  rescale `tokensIn`; display a neutral divider. For auto mode,
  keep current rescaling.

Downstream repair ACT (named but NOT opened from this ACT):
**ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01** — separate scope,
separate review. The previous turn's
ACT-CLINEMM-COMPACTION-INPUT-IDENTITY-REPAIR01 is RETRACTED — the
manual entry points are NOT the defect.

R1-R3 (core compaction arithmetic, cumulative-usage non-interference,
repeated-request snapshot) are SUPERSEDED on the recon's current
frontier: the reviewer's HALT explicitly said "Do R1-R3 NOT yet"
because they won't answer the current ambiguity. They become relevant
again after CASE_S1 / CASE_S3 is closed.

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

**R0' (REFRAMED 2026-09-02 second review, after
HALT_ROOT_CAUSE_NOT_ISOLATED):** the structural asymmetry between
manual and auto compaction is real and durable. But the previous
turn's conclusion (manual compaction passes the wrong input) was
an epistemic jump. The semantic-contract recon classifies the
defect as AMBIGUOUS_WIRE_CONTRACT (CASE_S3) or
SEMANTIC_LABEL_DEFECT (CASE_S1), NOT producer defect. The producer
documents S1 (MATERIAL_BEING_COMPACTED); the UI consumer assumes
S2 (ACTIVE_PROVIDER_CONTEXT); the wire does not tag which scale
is in use. The two manual entry points correctly implement S1
per the explicit design intent ("intentionally summarizes the full
canonical transcript"); they are NOT the defect. ROOT_CAUSE_ISOLATED
candidate: the schema/wire between the producer (core-events.ts:773)
and the UI rescaling consumer (getApiMetrics.ts:174-225 +
ContextWindow.tsx:175). Downstream repair ACT =
ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01 (named but NOT
opened from this ACT).

**CASE_B.MANUAL_PROJECTION is RETRACTED** (2026-09-02 second
review); the producer docstring establishes S1, not S2, and the
manual entry points correctly implement S1 per the design intent.

**A.label-only is NOT YET ESTABLISHED.** Q0C (semantic-difference) is
necessary but not sufficient; the semantic-contract recon
classifying the producer/consumer mismatch as CASE_S1 or CASE_S3
is necessary before CASE_A can be cleanly closed.

R1-R3 discriminators: **SUPERSEDED ON CURRENT FRONTIER** (per
reviewer's HALT directive: "Do R1-R3 NOT yet; they won't answer the
current ambiguity"). They become relevant again after CASE_S1 /
CASE_S3 is closed.
