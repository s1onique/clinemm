# ACT-CLINEMM-COMPACTION-ESTIMATOR-PARITY-01 — Request Accounting Map

Source HEAD: `c1aff630fdf6669b9b1e63ec927796e6f5423f07` · Branch `main` ·
Repository `s1onique/clinemm`

This map establishes which request representation each measured quantity
belongs to, so that only like-for-like comparisons are made.

---

## 1. The four representations

| Symbol | Representation | Produced by | Source |
|---|---|---|---|
| **D** | Pre-compaction DECISION candidate | The compaction resolver, over `context.apiMessages` + system prompt + tools | `sdk/packages/core/src/extensions/context/compaction.ts:406-414` |
| **P** | Post-compaction prepared request | The compaction strategies' output, re-projected by the runtime | `compaction.ts:620-700`, `session-runtime-orchestrator.ts:1799-1828` |
| **W** | FINAL provider-dispatched request | After every `beforeModel` hook mutation, immediately before provider dispatch | `sdk/packages/agents/src/agent-runtime.ts:2790-2852` |
| **U** | Provider-reported usage for **W** | The provider's own usage block, normalized | `sdk/packages/llms/src/providers/ai-sdk.ts:1269-1302` |

### D — the decision candidate

```ts
// sdk/packages/core/src/extensions/context/compaction.ts:406-422
const apiMessageTokens = context.apiMessages.reduce(
    (total, message) => total + estimateMessageTokens(message), 0);
const requestInputTokens = estimateRequestInputTokens({
    systemPrompt: context.systemPrompt,
    messages: context.apiMessages,
    tools: context.tools,
});
const requestOverheadTokens = Math.max(
    0, requestInputTokens - apiMessageTokens);
```

`context.apiMessages` is the **API-safe projection**, not the raw canonical
history: the orchestrator populates it via `prepareProviderMessagesForApi` →
`MessageBuilder.buildForApi` **before** the trigger reads it
(`session-runtime-orchestrator.ts:1775`, `:1846-1856`). The upstream v4.1.26
"estimate re-compaction against API-safe projected messages" correction is
therefore **already present** in this fork.

**D includes**: system prompt, tool declarations and schemas, provider-visible
messages, JSON structural overhead, structured tool-result content (as
serialized), and a flat per-image cost instead of the base64 payload.

### W — the dispatched request

The final budget guard runs at the real dispatch seam, AFTER all `beforeModel`
mutations, over the provider-visible projection:

```ts
// sdk/packages/agents/src/agent-runtime.ts:2829-2836
if (typeof this.requestBudgetCeilingTokens === "number") {
    assertProviderRequestWithinBudget({
        systemPrompt: request.systemPrompt ?? "",
        messages: toProviderVisibleMessages(request.messages),
        tools: request.tools,
        maxRequestTokens: this.requestBudgetCeilingTokens,
    });
}
```

`assertProviderRequestWithinBudget` calls the **same**
`estimateRequestInputTokens` (`sdk/packages/shared/src/llms/request-budget.ts:269-297`).
The compaction policy and the final budget guard therefore cannot disagree
about the size of the same request; the production-seam suite asserts this
equality directly.

### D versus W

D and W are the **same message set** unless a `beforeModel` hook replaces the
messages or the tool inventory, or compaction intervenes. The Round C trace
confirms this empirically: `providerReady.providerRequestBytes` tracks
`compaction_decision.apiMessagesJsonChars` within ~1,000–4,000 bytes (the
system prompt plus tool schemas) on every non-compacting request.

---

## 2. The estimator

`sdk/packages/shared/src/llms/tokens.ts`

```ts
export const CHARS_PER_TOKEN = 3;

export function estimateTokens(chars: number): number {
    return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}

export function estimateRequestInputTokens(request: TokenEstimatedRequest): number {
    // JSON.stringify({ systemPrompt, messages, tools }, imageAwareReplacer)
    // → estimateTokens(serialized.length) + images * 1_600
}
```

Properties, as established by the production-seam suite
(`sdk/packages/core/src/extensions/context/compaction.estimator-parity01.test.ts`):

| Component | Counted? | Evidence |

---

## 3. Provider usage normalization

### The installed AI SDK contract (AI SDK v7, `@ai-sdk/openai-compatible` 3.0.82)

`node_modules/@ai-sdk/openai-compatible/dist/index.js:40-59`

```js
function convertOpenAICompatibleChatUsage(usage) {
    const promptTokens = usage.prompt_tokens ?? 0;
    const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
    return {
        inputTokens: {
            total: promptTokens,                    // COMPLETE prompt
            noCache: promptTokens - cacheReadTokens,
            cacheRead: cacheReadTokens,             // SUBSET of total
            cacheWrite: void 0,
        },
        ...
    };
}
```

And `ai@7.0.159` `LanguageModelUsage`:

```ts
type LanguageModelUsage = {
    inputTokens: number | undefined;          // TOTAL prompt tokens
    inputTokenDetails: {
        noCacheTokens: number | undefined;     // uncached portion
        cacheReadTokens: number | undefined;   // cached portion (subset)
        cacheWriteTokens: number | undefined;
    };
};
```

### ClineMM's normalization

`sdk/packages/llms/src/providers/ai-sdk.ts:1269-1302`

```ts
inputTokens:
    getNestedUsageValue(usage, "inputTokens", "total") ||   // ← TOTAL
    getUsageValue(usage, "inputTokens", "input_tokens", "prompt_tokens") || ...
cacheReadTokens:
    getNestedUsageValue(usage, "inputTokens", "cacheRead") ||
    getNestedUsageValue(usage, "inputTokenDetails", "cacheReadTokens") ||
    ...
```

**ClineMM reads `usage.inputTokens.total` — the COMPLETE prompt — and reports
`cacheReadTokens` separately as the cached SUBSET.**

### Cache-token interpretation — the load-bearing conclusion

> `inputTokens` and `cacheReadTokens` are **NOT disjoint**.
> `cacheReadTokens ⊆ inputTokens`.
> The complete prompt token count is `inputTokens` **ALONE**.
> Adding `cacheReadTokens` to `inputTokens` would **double-count** the cached
> portion.

This is confirmed empirically by the Round C session itself:

| Observation | Value |
|---|---|
| `providerRequestBytes / inputTokens` — median over 107 non-compacting pairs | **3.473** chars/token |
| Coefficient of variation of that rate | **0.0732** (very tight) |
| `(inputTokens + cacheReadTokens) / providerRequestBytes` — implied chars/token | 3.127 with **CV 0.2214** (loose) |

`inputTokens` is the quantity that is *proportional to the wire payload*; adding
`cacheReadTokens` breaks that proportionality. The cached tokens are already
inside `inputTokens`.

Note also `ai-sdk.ts:1180-1183`, where the **cost** formula subtracts
`cacheReadTokens + cacheWriteTokens` from `inputTokens` before applying the
input price. That subtraction is only correct if cached tokens are a **subset**
of `inputTokens` — the code's own cost arithmetic confirms the contract.

---

## 4. The compaction trigger

---

## 5. Request identity — what exists and what does not

| Identity | Scope | In the trace export? |
|---|---|---|
| `decisionId` = `(sessionId, iteration, decisionOrdinal)` | one eligibility decision | **Yes** — decision side only |
| `decisionOrdinal` | per-session monotonic counter | **Yes** |
| `modelRequestId` = `createUID("model_request", 21)` | one dispatched provider request | **No** — minted at `agent-runtime.ts:2915`, **after** the decision seam, and not in `LATENCY_METADATA_ALLOWLIST` |

The compaction decision is published at `compaction.ts:529-618`, BEFORE
`modelRequestId` is minted. The source states this explicitly
(`compaction.ts:580-585`):

> The `modelRequestId` is NOT available here: it is minted in
> `streamPreparedRequest`, AFTER this seam returns. The decision therefore
> carries its OWN stable identity — `(sessionId, iteration, decisionOrdinal)` —
> and the provider-dispatch join is established later, at the seam that owns
> the request id.

**Consequence:** there is **no authoritative join** in the exported trace
between a decision and the provider usage of the request that decision
pre-empted or authorized. The historical pairing is therefore
`INFERRED_CHRONOLOGICAL_PAIRING`.

The inferred pairing used in this ACT is **order-preserving**: each decision
pairs with the FIRST provider completion that starts strictly after it. A naive
positional `zip(decisions, completions)` is **wrong** here — there are 114
decisions and 113 completions, and a compaction decision is followed by a
compaction EXECUTION rather than by the provider request it pre-empted, so a
positional zip pairs the sixth compaction decision with the POST-compaction
provider request and silently shifts every later pair.

---

## 6. Source locations

| Concern | Location |
|---|---|
| `CHARS_PER_TOKEN`, `estimateTokens`, `estimateRequestInputTokens` | `sdk/packages/shared/src/llms/tokens.ts` |
| `estimateProviderRequestInputTokens`, `assertProviderRequestWithinBudget` | `sdk/packages/shared/src/llms/request-budget.ts` |
| Compaction resolver, trigger, underestimate factor | `sdk/packages/core/src/extensions/context/compaction.ts:402-620` |
| `resolveEffectiveMaxInputTokens`, user ceiling | `sdk/packages/core/src/extensions/context/compaction-shared.ts:75-140` |
| `estimateMessageTokens` / `createTokenEstimator` | `sdk/packages/core/src/extensions/context/compaction-shared.ts:417-443` |
| API-safe projection | `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1846-1856` |
| Final dispatch budget guard | `sdk/packages/agents/src/agent-runtime.ts:2829-2836` |
| Provider usage normalization | `sdk/packages/llms/src/providers/ai-sdk.ts:1269-1302` |
| AI SDK openai-compatible usage mapping | `node_modules/@ai-sdk/openai-compatible/dist/index.js:40-59` |
| AI SDK `LanguageModelUsage` type | `node_modules/ai/dist/index.d.ts:344-362` |
| Trace metadata allowlist | `sdk/packages/core/src/observability/latency/latency-trace.ts:280-325` |


`sdk/packages/core/src/extensions/context/compaction.ts:423-480`

```ts
const modelMaxInputTokens = resolveEffectiveMaxInputTokens({...});
const ceilingAdjustedMaxInputTokens = applyUserContextCeiling(
    modelMaxInputTokens, sanitizedUserContextCeiling);
if (effectiveMode === "auto" && ceilingAdjustedMaxInputTokens === undefined) {
    return undefined;                       // unknown limit → no decision
}
const rawMaxInputTokens = ceilingAdjustedMaxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
const actualPreviousInputTokens = context.previousRequestInputTokens > 0 ? ... : 0;
const underestimateFactor =
    actualPreviousInputTokens > 0 && requestInputTokens > 0
        ? Math.min(MAX_INPUT_UNDERESTIMATE_FACTOR,
                   Math.max(1, actualPreviousInputTokens / requestInputTokens))
        : 1;
const maxInputTokens = rawMaxInputTokens / underestimateFactor;
const requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO;
const shouldCompact = requestInputTokens >= requestTriggerTokens;
```

- `resolveEffectiveMaxInputTokens` (`compaction-shared.ts:75-94`): a reported
  `maxInputTokens` is authoritative but capped by `contextWindow`; a
  context-window-only model gets `contextWindow * CONTEXT_WINDOW_INPUT_RATIO`.
- The trigger is **inclusive** (`>=`).
- `underestimateFactor` scales the **budget** (not the trigger) when the
  provider's previous count proves the estimator under-counted. It only ever
  engages in the under-counting direction (`Math.max(1, …)`) and is capped.
- `actualPreviousInputTokens` is the **previous** request's provider usage. It
  is never the current candidate's usage, which no provider ever reported
  because the candidate was not submitted.

|---|---|---|
| System prompt | **Yes** | `withSystem > withoutExtras` |
| Tool declarations and schemas | **Yes** | `withTools > withSystem` |
| Provider-visible messages | **Yes** | the estimator's input |
| JSON structural overhead | **Yes** | serialized envelope > bare text length |
| Structured tool results | **Yes** | serialized as part of the message |
| Images / encoded media | **Flat 1,600 per image**, NOT the base64 length | `createImageAwareReplacer` |
| Reasoning / history metadata | Only insofar as it is serialized into a message | — |
| Message serialization overhead | **Yes** | envelope framing |

`estimateMessageTokens` (`compaction-shared.ts:417-443`) uses the same
`CHARS_PER_TOKEN` and the same image handling, memoized per message object.
