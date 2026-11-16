# ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02 — Production Boundary Map

Source HEAD: `d397d90c002e9fab136b346771965209d28c6455` (branch `main`).
Every path and function name below was read at that HEAD. Nothing here is
inferred from the ACT's diagram.

---

## A. Canonical result → summarizer

```
canonical tool_use / tool_result
  → SDK conversation state
  → createContextCompactionPrepareTurn          compaction.ts:333
  → runAgenticCompaction                        agentic-compaction.ts:52
  → findCutIndex                                 compaction-shared.ts:567
  → previousSummary + newMessagesToFold          agentic-compaction.ts:74-87
  → buildBudgetProjection                        budget-projection/project.ts:479
  → serializeConversation                        compaction-shared.ts:409
  → flattenToolResultContent                     compaction-shared.ts:321
  → buildSummaryRequest                          compaction-shared.ts:914
  → generateSummary                              summary-generation.ts
  → installed compaction summary                 agentic-compaction.ts:227-235
  → evidence-continuity/task-contract augmentation
                                                 compaction.ts:1182-1207, 1258-1270
  → subsequent provider-visible request
```

### The six boundaries the ACT asked for

| # | Question | Real source | Function |
|---|---|---|---|
| 1 | Where are tool results converted/normalized? | `compaction-shared.ts:321` | `flattenToolResultContent` → `truncateToolResultContentForCompaction` → `renderToolResultBlocks` → `renderStructuredToolPayload` |
| 2 | Where is result content truncated or omitted? | `compaction-shared.ts:236-263`, `286-319` | `OMITTED_STRUCTURED_RESULT_MARKER = "[result omitted]"`; `UNSUPPORTED_TOOL_RESULT_MARKER`; `TOOL_RESULT_CHAR_LIMIT = 2000` |
| 3 | Where is the summarizer input constructed? | `agentic-compaction.ts:161-167` | `serializeConversation(summaryInputBudget.messages)` → `buildSummaryRequest({previousSummary, conversationText, fileOps})` |
| 4 | Where do previous summaries replace original history? | `agentic-compaction.ts:75-87` | `findLatestSummaryIndex` → `getCompactionSummaryMetadata(...).summary` → `previousSummary`; `newMessagesToFold` is the segment AFTER the last summary |
| 5 | Where are verified outcomes selected and bounded? | `evidence-continuity.ts:659-816` | `extractVerifiedToolOutcomes`; `MAX_CARRIED_OUTCOMES = 12`; `outcomes.splice(0, outcomes.length - 12)` keeps the 12 MOST RECENT |
| 6 | Where is the final provider-visible continuation produced? | `compaction.ts:1162-1250` (re-compaction) and `1252-1285` (first compaction) | `applyTaskContractToCompactedMessages` → `applyVerifiedEvidenceToCompactedMessages` → `createSessionCompactionState` → `saveState` → `publishWorkingContextEstimate` |

---

## B. Compaction trigger

```
canonical messages
  → provider-visible request projection      session-runtime-orchestrator.ts:1846
                                              prepareProviderMessagesForApi
  → request token estimate                    compaction.ts:385-389
                                              estimateRequestInputTokens (shared/src/llms/tokens.ts)
  → model/input budget resolution             compaction.ts:398-408
                                              resolveEffectiveMaxInputTokens + applyUserContextCeiling
  → provider usage calibration                compaction.ts:435-447
                                              underestimateFactor (MAX_INPUT_UNDERESTIMATE_FACTOR = 4)
  → compaction trigger                        compaction.ts:448-455
                                              requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO (0.9)
                                              shouldCompact = requestInputTokens >= requestTriggerTokens
  → retained-tail selection                   compaction-shared.ts:567 findCutIndex
  → compaction                                agentic-compaction.ts:52
  → next model request
```

### Trigger constants (read at HEAD)

- `COMPACTION_TRIGGER_RATIO = 0.9` — `compaction-shared.ts:20`
- `DEFAULT_MAX_INPUT_TOKENS = 128_000` — `compaction-shared.ts:16`
- `MAX_INPUT_UNDERESTIMATE_FACTOR = 4` — `compaction-shared.ts:28`
- `DEFAULT_PRESERVE_RECENT_TOKENS = 20_000` — `compaction-shared.ts:30`
- `TOOL_RESULT_CHAR_LIMIT = 2_000` — `compaction-shared.ts:36`
- `DEFAULT_MAX_TOOL_RESULT_CHARS = 8_000` — `session/services/message-builder.ts:30`

### The estimator's input

`estimateRequestInputTokens` (`sdk/packages/shared/src/llms/tokens.ts`) measures
`JSON.stringify({systemPrompt, messages, tools}).length / 3` plus a flat 1600
tokens per image. The `messages` it receives is `context.apiMessages`.

`context.apiMessages` equals the provider-visible projection ONLY when the
caller threads the provider transform. In this fork:
`local-runtime-host.ts:1063-1070` wires `prepareApiMessages` to
`agent.prepareProviderMessagesForApi`, and `compaction.ts:1171` uses it for the
re-compaction path.

---

## C. First observable loss boundary

**There are TWO distinct losses, at TWO different boundaries. They must not be
collapsed.**

### Loss 1 — the result BODY (policy-driven, deliberate)

`compaction-shared.ts:247-264` (`renderStructuredToolPayload`) replaces every
arbitrary output string with `[result omitted]`. A structured `run_commands`
payload `{query, result, success}` therefore reaches the summarizer as:

```
[succeeded] helm template: [result omitted]
```

The Round C reconstruction measured **487** deliberately omitted result bodies
across the covered 263-message prefix. This is the stated confidentiality
policy, not a defect.

### Loss 2 — the command CLASSIFICATION (allowlist-matching miss)

`evidence-continuity.ts:476-516` (`classifyCommand`) matches the command's
**leading words** against a finite allowlist. `compaction-shared.ts:247-264`
calls it on the same payload.

**Every Round C command begins with `cd <path> && <cmd>`.** `cd` is not in
`COMMAND_CLASSIFICATION_ALLOWLIST`, so the classification is **empty** for
every Round C call. The carried verified-outcome line therefore degrades to:

```
- run_commands (call_c82e47fda7704342b2f74298): succeeded — 10 commands
```

— with **no indication of what was run**. All 12 carried outcomes have this
shape.

This is the earliest boundary at which the **evidence identity** is lost. It
is not the stated policy: the module's header explicitly says the carried
section preserves "the command CLASSIFICATION(S) the call declared". The
classification is empty only because the leading-word match misses.

The two mechanisms are independent and were separated by the production-seam
discriminators:

- `serializeConversation is the summarizer-input projection and it omits
  arbitrary output` — the body omission (policy).
- `R7/R1 boundary: a cd <path> && <cmd> chain yields NO command
  classification` and its control `R7/R1 control: a DIRECT command ... DOES
  yield a carried command classification` — the classification miss.

### Not a loss boundary: post-summary augmentation

`applyVerifiedEvidenceToCompactedMessages` (`evidence-continuity.ts:1065`) IS
present in the installed Round C continuation, with all 12 carried lines. The
post-summary stage did **not** lose the evidence.

### Not a loss boundary: the 12-outcome bound

The bound is exactly `MAX_CARRIED_OUTCOMES = 12`, and the Round C ledger
carried exactly 12. The bound is working as specified. The Round C probes
(`call_c82e47fda7704342b2f74298`, `call_60c171e0942a444ba7d5469a`,
`call_b44848a49e8f47cb91209629`) are all among the 12 carried outcomes, so
the bound did **not** evict them.

---

## D. Diagnostic inventory (no new instrumentation was added)

Existing, already-instrumented boundaries used by this ACT:

| Boundary | Where | What it carries |
|---|---|---|
| `compaction` diagnostics | `compaction.ts:497-539` via `observeCompactionTrace` | `compactionInitiated`, `effectiveMaxInputTokens`, `inputBudgetSource`, `shouldCompact` |
| `compaction` completed | `compaction.ts:832-868` | message counts, evidence-reference before/after/retained/dropped/replaced |
| `provider_ready` | `sdk/packages/agents/src/agent-runtime.ts:4422-4431` | `providerRequestBytes`, `providerMessageCount`, `toolResultIncludedCount`, `toolResultShortenedCount`, `toolResultOmittedCount` |
| `provider_submitted` | latency trace sink | `inputTokens`, `outputTokens`, `cacheReadTokens` |

**Gap:** the Round C trace's `compaction` diagnostics carry only
`{compactionInitiated, effectiveMaxInputTokens}` — the richer payload
(`requestInputTokens`, `requestTriggerTokens`, `underestimateFactor`) was not
captured. That is why matched-request attribution is `CAPTURE_INSUFFICIENT`.

No DEFAULT_OFF instrumentation was installed, because the existing seams plus
the source-faithful reconstruction were sufficient for the decisive
measurements.

---

## E. The R1/R7 negative controls

| Control | Result |
|---|---|
| R1 outer-shell success + failed inner Helm | GREEN — a successful outer status does not certify a rendered image; the inner failure is canonical (`rc=1`, Go-template error) and is not carried as a success |
| R1 no-pipefail wrapper | GREEN — the wrapper's status comes from the last pipeline element, never from Helm |
| R7 empty/failed grep | GREEN — a failed grep is rendered `[failed]`, never promoted to a successful evidence source |
| R7 mixed batch | GREEN — each payload is classified by its own status |
