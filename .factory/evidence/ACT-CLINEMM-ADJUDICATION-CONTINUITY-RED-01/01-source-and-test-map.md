# 01 — Source and test map

**Source HEAD:** `a493eff078ec5c8f2b6c874ad8f4a85009d1b64f`
**Session:** `1795394987994_fpu77` · **Subject revision:** Keycloak `42de653b59708e712d694aeb9732f822b7f8fe5b` (branch `optimize-ftls`)

---

## 1. Production modules inspected (read-only)

All paths were verified to exist at `ENTRY_HEAD`; **none moved**.

| Path | Role | Label |
|---|---|---|
| `sdk/packages/core/src/extensions/context/agentic-compaction.ts` | the agentic compaction path (`runAgenticCompaction`) | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/compaction-shared.ts` | serializer, cut index, summary request | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/budget-projection/project.ts` | **the source-selection boundary** (`buildBudgetProjection`, `resolveProjectionPolicy`, `dropThinkingBlocks`) | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/budget-projection/types.ts` | budget projection types (`BudgetPolicyIntent`) | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/summary-generation.ts` | the summarizer injection boundary (`generateSummary`) | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/compaction.ts` | the state-aware compaction projection (`createCompactionStateAwarePrepareTurn`) | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/task-contract.ts` | task-contract carry-forward | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/extensions/context/evidence-continuity.ts` | verified-outcome carry-forward, `MAX_CARRIED_OUTCOMES`, `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED` | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/session/services/message-builder.ts` | the provider-visible projection (`MessageBuilder.buildForApi`) | REAL_PRODUCTION_SEAM |
| `sdk/packages/core/src/session/models/session-compaction.ts` | the persisted sidecar model | REAL_PRODUCTION_SEAM |

### 1.1 The exact production sequence, confirmed against the source

The ACT supplied a reconnaissance map and required that the "exact function
invocation order" be confirmed against the current production source rather
than assumed. **Confirmed**, with the call sites:

| Order | Call | Site |
|---|---|---|
| 1 | `findCutIndex(messages, preserveRecentTokens, estimateMessageTokens)` | `agentic-compaction.ts:65` → `compaction-shared.ts:596` |
| 2 | `findLatestSummaryIndex(messagesToSummarize)` | `agentic-compaction.ts:75` → `compaction-shared.ts:571` |
| 3 | `newMessagesToFold = messagesToSummarize.slice(latestSummaryIndex + 1)` | `agentic-compaction.ts:81-84` |
| 4 | `buildAgenticSummaryInputBudget({messages: newMessagesToFold, …})` | `agentic-compaction.ts:140` → `agentic-compaction.ts:31` |
| 5 | → `buildBudgetProjection({…, policyIntent: "agentic_summary"})` | `budget-projection/project.ts:479` |
| 6 | → `resolveProjectionPolicy("agentic_summary")` → `dropThinkingBlocks: true` | `budget-projection/project.ts:25-43` |
| 7 | → `dropThinkingBlocks(messages, …)` — **THE BOUNDARY** | `budget-projection/project.ts:506-515` → `:297` |
| 8 | `serializeConversation(summaryInputBudget.messages)` | `agentic-compaction.ts:162` → `compaction-shared.ts:438` |
| 9 | → `serializeMessage(message)` | `compaction-shared.ts:387` |
| 10 | → thinking truncation `truncateText(block.thinking, 2_000)` | `compaction-shared.ts:400` → `:142` |
| 11 | → tool-result projection → `[result omitted]` | `compaction-shared.ts:344` → `:308` → `:258` |
| 12 | `buildSummaryRequest({previousSummary, conversationText, fileOps})` | `agentic-compaction.ts:163` → `compaction-shared.ts:943` |
| 13 | `generateSummary({providerConfig, systemPrompt, request})` | `agentic-compaction.ts:189` → `summary-generation.ts:4` |
| 14 | → `handler.createMessage(systemPrompt, [{role:"user", content: request}])` | `summary-generation.ts:23` |
| 15 | `ensureFilesSection(rawSummary, fileOps)` | `agentic-compaction.ts:222` → `compaction-shared.ts:933` |
| 16 | `buildSummaryMessage({summary, fileOps, …})` | `agentic-compaction.ts:228` → `compaction-shared.ts:1042` |
| 17 | `applyTaskContractToCompactedMessages(result.messages, context.messages, …)` | `compaction.ts:1566` → `task-contract.ts:358` |
| 18 | `applyVerifiedEvidenceToCompactedMessages(… , canonicalMessages, …)` | `compaction.ts:1604` → `evidence-continuity.ts:2173` |
| 19 | `MessageBuilder.buildForApi(messages)` | `session/services/message-builder.ts:219` |

**One material deviation from the ACT's reconnaissance map** was found and is
recorded here: the ACT's map placed "thinking truncation" inside
`serializeMessage()` as a candidate boundary. That is correct **as code**, but
the map did not show that the thinking blocks are **already gone** before the
serializer runs. The **budget projection** (§6, §7 of that map) precedes the
serializer and removes them unconditionally. The map is correct about the
serializer; it was **incomplete about the projection**.

### 1.2 The boundary in code

```ts
// sdk/packages/core/src/extensions/context/budget-projection/project.ts:25-43
function resolveProjectionPolicy(intent: BudgetPolicyIntent): ProjectionPolicy {
    switch (intent) {
        case "agentic_summary":
        case "basic_compaction_projection":
            return {
                protectLatestTypedUser: true,
                protectLiveTailFromDrop: true,
                dropUnsafeOutsideLiveTail: true,
                dropThinkingBlocks: true,          // ◄── THE BOUNDARY
            };
        case "normal_provider_request":
            return {
                protectLatestTypedUser: true,
                protectLiveTailFromDrop: true,
                dropUnsafeOutsideLiveTail: false,
                dropThinkingBlocks: false,
            };
    }
}
```

```ts
// sdk/packages/core/src/extensions/context/budget-projection/project.ts:504-515
let messages = cloneMessages(options.messages);
let originalIndexes = messages.map((_, index) => index);
if (policy.dropThinkingBlocks) {
    const prunedThinking = pruneEmptyMessages(
        dropThinkingBlocks(messages, originalIndexes, actions),
        originalIndexes,
        actions,
        "unsafe_to_truncate",
    );
    messages = prunedThinking.messages;
    originalIndexes = prunedThinking.originalIndexes;
}
```

The removal happens **before** the `estimatedTokens <= options.targetTokens`
early return at `project.ts:539` — so it is **unconditional**, not a
budget-pressure artefact.

---

## 2. Test inventory

| File | Role | Status |
|---|---|---|
| `sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.red01.test.ts` | **the RED receipt** — 5 scenarios | **intentionally FAILING** (exit 1) |
| `sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts` | discriminators + ablation + security/conservation controls — 23 tests | **PASSING** |
| `sdk/packages/core/vitest.red.adjudication-continuity-red01.config.ts` | dedicated RED runner config | new |
| `sdk/packages/core/vitest.config.ts` | default-suite **exclusion** of the RED witness | modified (test harness only) |
| `sdk/packages/core/package.json` | `test:red:adjudication-continuity-red01` script | modified (test harness only) |

### 2.1 Existing suites consulted (read-only)

| File | Relevance |
|---|---|
| `src/extensions/context/compaction.evidence-fidelity01.test.ts` | the **precedent** for this ACT: a production-seam RED with the summarizer mocked at the same `createHandlerAsync` boundary, a dedicated `vitest.red.*.config.ts`, and the same `vitest.config.ts` exclusion pattern. Its pattern was followed exactly. |
| `src/extensions/context/compaction.summary-churn01.red.test.ts` | the precedent for a RED isolated from the default suite |
| `src/extensions/context/compaction.roundc-fidelity-recon02.test.ts` | the Round C fidelity recon (the same subject session) |
| `src/extensions/context/evidence-continuity.test.ts` | the verified-outcome continuity suite |
| `src/extensions/context/task-contract-conservation.test.ts` | the task-contract conservation suite |

---

## 3. The summarizer injection boundary

```ts
// sdk/packages/core/src/extensions/context/summary-generation.ts:4-23
export async function generateSummary(options: {…}) {
    const handler = await createHandlerAsync(…);
    …
    for await (const chunk of handler.createMessage(options.systemPrompt, [
        { role: "user", content: options.request },
    ])) { … }
}
```

`createHandlerAsync` comes from `@cline/llms`. The RED suite mocks **that
module** (the existing seam):

```ts
const createHandlerMock = vi.fn();
vi.mock("@cline/llms", () => ({
    createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));
```

and captures the **exact request string** the production code passed:

```ts
createMessage: vi.fn((_systemPrompt: string, messages: unknown[]) => {
    const first = messages[0] as { content?: string } | undefined;
    capturedSummarizerRequest = first?.content ?? "";
    …
}),
```

The captured string is the real production `buildSummaryRequest()` output. It is
**never re-derived** in the test.

---

## 4. Historical artifacts consumed (PRIVATE — outside Git)

| Role | Path | Label |
|---|---|---|
| Canonical messages | `~/.vscodium-roz/cline-data/sessions/1795394987994_fpu77/1795394987994_fpu77.messages.json` | REAL |
| Compaction sidecar | `…/1795394987994_fpu77.compaction.json` | REAL |
| Session metadata | `…/1795394987994_fpu77.json` | REAL |
| Compaction candidate `#37#36` | `~/.vscodium-roz/cline-data/private/compaction-candidates/1795394987994_fpu77_37_36-…json` | REAL |
| Compaction candidate `#63#62` | `…/1795394987994_fpu77_63_62-…json` | REAL |
| Summarizer captures ×7 | `~/.vscodium-roz/cline-data/provider-request-captures/cap_41f75c5386d5db78.ai_sdk_prompt.{1..7}.provider-request.json` | REAL |

A read-only frozen copy of the first five was used for all analysis:
`/tmp/cline-recon-rX/`. **The live session directory was not written to.**

---

## 5. Subject repository

| Property | Value |
|---|---|
| Path | `/Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak` |
| Branch | `optimize-ftls` |
| HEAD | `42de653b59708e712d694aeb9732f822b7f8fe5b` |
| Observed identically at canonical idx | 3, 75, 155 |

**No source change occurred between the first and the last R4 read** — established
from three independent observations of `git rev-parse HEAD` inside tool results,
not from a single reading. This is load-bearing for the G7 control "a finding
whose source revision changes after adjudication".

---

## 6. Boundary ownership, re-verified

| Boundary | Covered canonical prefix | Covered length | Verification |
|---|---|---|---|
| **36→37** | `0..73` | **74** | candidate `#37#36` `apiMessages` = 74; last id `msg_NFcQJe45` → canonical idx **73** ✔ |
| **62→63** | `0..125` | **126** | sidecar `source_last_message_key = id:msg_7ztXgjkW` → canonical idx **125**; `source_message_count = 126` ✔ |

Both match the ACT's stated table exactly.

**Witness eligibility:**

| Witness | Canonical idx | Inside 36→37 (`0..73`)? | Inside 62→63 (`0..125`)? | Eligible at |
|---|---|---|---|---|
| R8 | 28 | **YES** | (already folded) | 36→37 |
| R7 | 40 | **YES** | (already folded) | 36→37 |
| R3 | 64 | **YES** | (already folded) | 36→37 |
| R4 (progress) | 124 | no | **YES** | 62→63 |

Membership was verified against the **captured candidate snapshots' own
`apiMessages` id lists**, not against an index arithmetic assumption: the ids
`msg_6ttuJ879` (28), `msg_2TMSPY6J` (40) and `msg_b7kphE6s` (64) **are present**
in candidate `#37#36`, and `msg_r8qDJLKQ` (124) **is present** in candidate
`#63#62` and **absent** from `#37#36`.

---

## 7. What was NOT inspected

Per the ACT's non-goals: the `beforeModel` completion checkpoint, `submit_and_exit`
and terminal-tool behaviour, malformed `commands:null`, llama.cpp/Strata prompt
caching, and any live-model behaviour.
