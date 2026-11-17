# Source map — estimator and policy seams

Bound to source HEAD `undefined`.

| Concern | Production seam |
|---|---|
| Serialize system prompt, messages, tools | `sdk/packages/shared/src/llms/tokens.ts` — `estimateRequestInputTokens()` JSON-stringifies one envelope containing `systemPrompt`, `messages`, and `tools`. |
| Character divisor | `tokens.ts` — `CHARS_PER_TOKEN = 3`; `estimateTokens()` applies `ceil(chars / 3)`. |
| Image accounting | `tokens.ts` — `createImageAwareReplacer()` blanks nested image payloads; each image then adds a flat `ESTIMATED_TOKENS_PER_IMAGE = 1600`, not its base64 character count. |
| Compaction estimate | `sdk/packages/core/src/extensions/context/compaction.ts` — `requestInputTokens = estimateRequestInputTokens(systemPrompt, apiMessages, tools)`. |
| Request overhead | `compaction.ts` — `requestOverheadTokens = max(0, requestInputTokens - apiMessageTokens)`. |
| Previous-provider calibration | `compaction.ts` — `underestimateFactor = min(4, max(1, actualPreviousInputTokens / requestInputTokens))` when previous provider input is positive. |
| Ceiling and trigger | `compaction.ts` plus `compaction-shared.ts` — `maxInputTokens = rawMaxInputTokens / underestimateFactor`; `requestTriggerTokens = maxInputTokens * 0.9`; auto compaction iff `requestInputTokens >= requestTriggerTokens`. |
| Final estimate | `sdk/packages/agents/src/agent-runtime.ts` — `buildProviderDispatchRecord()` estimates the **final provider-visible projection** after compaction and `beforeModel` transforms. This can differ from the pre-compaction decision estimate. |
| Final budget guard | `sdk/packages/shared/src/llms/request-budget.ts` — `assertProviderRequestWithinBudget()` measures the same provider-visible representation and throws before dispatch when the estimate exceeds the effective ceiling. |
| Provider usage | The completed provider attempt publishes `inputTokens`, `cacheReadTokens`, and output usage. `inputTokens` is the complete prompt; cache reads are a subset and are never added. |
| Authoritative identities | `compaction.ts` publishes `decisionId`, `preparationRequestId`, and `decisionJoinAuthority`. The runtime publishes per-attempt `modelRequestId`, final projection fingerprint, and provider/model identity. |

## Critical semantic distinction

The compaction decision estimates the **pre-compaction candidate**. The final request-budget estimate is recomputed on the **post-compaction, post-transform provider-visible projection**. Changing one is not semantically equivalent to changing the other. The actual compaction at `1794881611778_557z3#16#15` therefore cannot use its post-compaction provider usage (15,545 tokens) as the label for its 108,242-token pre-compaction estimate.

## Trace join authority

The final trace has 32 compaction decisions, 32 completed provider attempts, and 32 exact `sessionId + preparationRequestId + modelRequestId` joins. `provider_ready` is not used as an identity source.
